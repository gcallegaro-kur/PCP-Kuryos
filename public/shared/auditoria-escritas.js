/* Auditoria geral: TODA gravação feita pelas telas vira um evento.

   Pedido do usuário (23/10/2026): "toda e qualquer movimentação no sistema"
   -- a conferência de PA do lote 26295/01 só dava para descobrir lendo o
   banco; a tela de Auditoria só conhecia programação e apontamento.

   Por que um gancho central e não uma chamada em cada tela: instrumentar
   tela por tela foi o que deixou a auditoria parcial (o que ninguém
   instrumentou fica de fora). Todas as páginas carregam auth_check.js, que
   carrega este módulo; ele envolve set/update/push/remove/transaction do
   Reference do Firebase e grava um evento em `auditoria_geral/{dia}/{id}`
   DEPOIS que a gravação deu certo.

   O que o evento guarda: quem (login), quando, de qual tela, qual caminho,
   quais campos e um resumo curto do valor. NUNCA o valor inteiro (fotos,
   fórmulas, listas grandes) e nunca o valor de nós sensíveis (usuários, RH,
   feedback, clima). O log é best-effort: se falhar, a operação já aconteceu
   e segue -- é reflexo, não pré-requisito.

   O que este módulo NÃO vê: gravações do servidor (Cloud Functions) -- elas
   entram pelo mesmo nó via SDK admin quando as Functions forem republicadas
   (o billing está fechado). O "quem" delas continua dentro do próprio dado.

   Funções puras testadas em run_auditoria_escritas_test.js; só `instalar`
   toca no Firebase. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AuditoriaEscritas = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var NO = 'auditoria_geral';
  var METODOS = ['set', 'update', 'push', 'remove', 'transaction'];
  var VERBOS = {set: 'gravou', update: 'alterou', push: 'incluiu', remove: 'EXCLUIU', transaction: 'atualizou'};

  // Nós que não são "movimentação" (o próprio log, contadores internos, travas).
  var IGNORAR = /^(auditoria_geral|eventos_auditoria|contadores_[^/]+|contador_[^/]+|recebimentos_locks|devolucoes_operacoes|recebimentos_operacoes|lotes_internos|\.info)(\/|$)|^usuarios\/[^/]+\/(ultimoAcesso|visto|presenca|lastSeen)/;
  // Nós cujo valor não vai para o log (só o caminho e os campos).
  var SENSIVEL = /^(usuarios|usuarios_removidos|rh_[^/]+|feedback_[^/]+|clima_[^/]+|custos_precos|precos_venda)(\/|$)/;

  /* Catálogo: caminho -> módulo e rótulo legível. A ordem importa (o mais
     específico primeiro). O que não casar vira módulo "Outros" com o próprio
     caminho -- nunca some. */
  var CATALOGO = [
    [/^conferencias_pa\//, 'Logística', 'conferência de PA'],
    [/^ops\/[^/]+\/qualidadePA/, 'Qualidade', 'laudo do PA'],
    [/^ops\/[^/]+\/manipulacao\/pesagem\/parcelas/, 'Manipulação', 'pesagem'],
    [/^ops\/[^/]+\/manipulacao\/analise/, 'Qualidade', 'análise do bulk'],
    [/^ops\/[^/]+\/manipulacao/, 'Manipulação', 'manipulação do bulk'],
    [/^ops\/[^/]+\/confirmacaoEtapas/, 'PCP', 'confirmação de etapa da OP'],
    [/^ops\//, 'PCP', 'ordem de produção'],
    [/^registros\//, 'Produção', 'apontamento'],
    [/^perdas\//, 'Produção', 'perda'],
    [/^paradas_historico\//, 'Produção', 'parada de linha'],
    [/^(estado_linhas|atividadesPosto|turnosIniciados|turnosEncerrados|intervalosApontados)\//, 'Produção', 'estado da linha / posto'],
    [/^programacao\//, 'PCP', 'grade de programação'],
    [/^(alocacoes_planejamento|ajustes_planejamento|sequenciamento|rearranjos_linhas)\//, 'PCP', 'planejamento'],
    [/^pedidos\//, 'PCP', 'pedido'],
    [/^pedidos_comerciais\//, 'Comercial', 'pedido comercial'],
    [/^(orcamentos|comercial_[^/]+|documentos_comerciais|expedicoes_comerciais|notificacoes_comercial)\//, 'Comercial', 'comercial'],
    [/^pedidos_compra\//, 'Compras', 'pedido de compra'],
    [/^solicitacoes_compra\//, 'Compras', 'solicitação de compra'],
    [/^(cotacoes|processos_cotacao)\//, 'Compras', 'cotação'],
    [/^(fornecedores)\//, 'Compras', 'fornecedor'],
    [/^estoque_lotes\//, 'Logística', 'lote/palete em estoque'],
    [/^estoque\//, 'Logística', 'saldo de estoque'],
    [/^movimentos_estoque\//, 'Logística', 'movimento de estoque'],
    [/^(enderecos_estoque|estrutura_ruas|contagens_inventario)\//, 'Logística', 'endereçamento / inventário'],
    [/^(agendamentos_expedicao|devolucoes_cliente)\//, 'Logística', 'expedição / devolução'],
    [/^(solicitacoes_descarte)\//, 'Logística', 'descarte'],
    [/^(nao_conformidades)\//, 'Qualidade', 'não conformidade'],
    [/^(inspecoes_cq|liberacao_linha|assepsia_linhas|checklist_modelos|qualidade_intermediarios|especificacoes|specs_mp_propostas)\//, 'Qualidade', 'controle de qualidade'],
    [/^(retrabalhos|retrabalhos_linhas)\//, 'Qualidade', 'retrabalho'],
    [/^(produtos|materiais|formulas|bom|clientes|insumos|sku_historico|historico_materiais|solicitacoes_cadastro_produto)\//, 'Cadastros', 'cadastro'],
    [/^(ativos|ativos_historico)\//, 'Manutenção', 'ativo'],
    [/^(auditorias_5s|acoes_5s|ciencia_5s|ocorrencias_5s|auditoria5s_config)\//, 'Auditoria 5S', 'auditoria 5S'],
    [/^(usuarios|usuarios_removidos)\//, 'Administração', 'usuário'],
    [/^(config|parametros_pa)\//, 'Administração', 'configuração'],
    [/^rh_/, 'RH', 'RH'],
    [/^(feedback_|clima_)/, 'RH', 'feedback / clima']
  ];

  function texto(v, max) {
    var s = String(v == null ? '' : v).trim();
    return max ? s.slice(0, max) : s;
  }

  function normalizar(caminho) {
    return texto(caminho).replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  }

  function ignorado(caminho) { return IGNORAR.test(normalizar(caminho)); }

  function classificar(caminho) {
    var c = normalizar(caminho);
    for (var i = 0; i < CATALOGO.length; i++) {
      if (CATALOGO[i][0].test(c)) return {modulo: CATALOGO[i][1], rotulo: CATALOGO[i][2]};
    }
    return {modulo: 'Outros', rotulo: c.split('/')[0] || 'dado'};
  }

  // "ops/26295-01/..." e "conferencias_pa/26295-01/..." -> lote "26295/01".
  function loteDoCaminho(caminho) {
    var m = /^(?:ops|conferencias_pa|perdas)\/(\d{4,6}-\d{1,3})(?:\/|$)/.exec(normalizar(caminho));
    return m ? m[1].replace('-', '/') : null;
  }

  /* Resumo curto e seguro de um valor: campos de primeiro nível, strings
     cortadas, objetos aninhados só pelo nome do campo. */
  function resumir(valor, max) {
    max = max || 400;
    if (valor === undefined) return null;
    if (valor === null) return 'apagado';
    if (typeof valor !== 'object') return texto(valor, 160);
    var partes = [];
    Object.keys(valor).slice(0, 20).forEach(function(k) {
      var v = valor[k], s;
      if (v === null) s = 'apagado';
      else if (typeof v === 'object') s = '{…}';
      else s = texto(v, 60);
      partes.push(k + '=' + s);
    });
    var r = partes.join(', ');
    return r.length > max ? r.slice(0, max - 1) + '…' : r;
  }

  function diaLocal(em) {
    var d = em instanceof Date ? em : new Date(em || Date.now());
    if (isNaN(d.getTime())) d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* Monta o evento de UMA gravação. `caminho` é o do Reference; no update
     de várias chaves (db.ref().update({'a/b': 1, 'c/d': 2})) as chaves são
     caminhos e o evento lista os campos. Devolve null se for para ignorar. */
  function montarEvento(d) {
    var metodo = texto(d.metodo);
    if (METODOS.indexOf(metodo) < 0) return null;
    var base = normalizar(d.caminho);
    var valor = d.valor;
    var alvos = [base], campos = [];
    if (metodo === 'update' && valor && typeof valor === 'object') {
      campos = Object.keys(valor);
      alvos = campos.map(function(k) { return normalizar(base ? base + '/' + k : k); });
      if (!alvos.length) return null;
    }
    var relevantes = alvos.filter(function(a) { return !ignorado(a); });
    if (!relevantes.length) return null;
    var principal = relevantes[0];
    var cls = classificar(principal);
    var sensivel = SENSIVEL.test(principal);
    var resumo = null;
    if (!sensivel) {
      if (metodo === 'update' && base === '' ) resumo = null;       // multi-path: os campos já dizem tudo
      else if (metodo !== 'remove') resumo = resumir(valor);
    }
    var u = d.usuario || {};
    var em = d.em instanceof Date ? d.em.toISOString() : texto(d.em) || new Date().toISOString();
    var modulos = {};
    relevantes.forEach(function(a) { modulos[classificar(a).modulo] = 1; });
    var registro = {
      metodo: metodo,
      caminho: texto(principal, 200),
      campos: campos.length ? texto(campos.slice(0, 12).join(', ') + (campos.length > 12 ? ' (+' + (campos.length - 12) + ')' : ''), 400) : null,
      resumo: resumo ? texto(resumo, 400) : null,
      modulo: cls.modulo,
      rotulo: cls.rotulo,
      lote: loteDoCaminho(principal) || (relevantes.map(loteDoCaminho).filter(Boolean)[0] || null),
      alvos: relevantes.length > 1 ? relevantes.length : null,
      pagina: texto(d.pagina, 60) || null,
      porUid: texto(u.uid, 128) || 'desconhecido',
      porNome: texto(u.nome, 120) || null,
      papel: texto(u.role, 40) || null,
      em: em
    };
    return {dia: diaLocal(em), registro: registro};
  }

  // Frase para a linha de tempo: "Diego Costa alterou a conferência de PA da OP 26295/01".
  function descrever(ev) {
    var e = ev || {};
    var quem = e.porNome || 'Alguém';
    var verbo = VERBOS[e.metodo] || 'mexeu em';
    var f = quem + ' ' + verbo + ' ' + (e.rotulo ? ('' + (e.metodo === 'push' ? 'um(a) ' : 'o(a) ') + e.rotulo) : 'dado');
    if (e.lote) f += ' da OP ' + e.lote;
    if (e.pagina) f += ' (tela ' + String(e.pagina).replace(/\.html$/, '') + ')';
    return f + '.';
  }

  /* Instala o gancho. `contexto()` devolve {usuario, pagina} no momento da
     gravação (o usuário só existe depois do login). Idempotente. */
  function instalar(firebase, contexto) {
    try {
      var Ref = firebase && firebase.database && firebase.database.Reference;
      if (!Ref || !Ref.prototype || Ref.prototype.__auditoriaGeral) return false;
      var P = Ref.prototype;
      var originais = {};
      METODOS.forEach(function(m) { originais[m] = P[m]; });

      var gravar = function(ref, dados) {
        try {
          var ctx = contexto() || {};
          if (!ctx.usuario || !ctx.usuario.uid) return;       // sem login não há autor; as regras também recusariam
          var ev = montarEvento(Object.assign({}, dados, {usuario: ctx.usuario, pagina: ctx.pagina}));
          if (!ev) return;
          var p = originais.push.call(ref.root.child(NO + '/' + ev.dia), ev.registro);
          if (p && p.then) p.then(null, function() {});
        } catch (e) { /* best-effort */ }
      };
      var caminhoDe = function(ref) {
        try { return decodeURIComponent(new URL(ref.toString()).pathname); } catch (e) { return ''; }
      };

      METODOS.forEach(function(m) {
        P[m] = function() {
          var ref = this, args = arguments;
          var r = originais[m].apply(ref, args);
          try {
            var caminho = caminhoDe(ref);
            if (m === 'push' && (args.length === 0 || args[0] === undefined)) return r;   // push() sem valor só gera a chave
            if (m === 'transaction') {
              if (r && r.then) r.then(function(res) {
                if (res && res.committed) gravar(ref, {metodo: m, caminho: caminho, valor: res.snapshot && res.snapshot.val()});
              }, function() {});
            } else if (r && r.then) {
              var valor = m === 'remove' ? undefined : args[0];
              r.then(function() { gravar(ref, {metodo: m, caminho: caminho, valor: valor}); }, function() {});
            }
          } catch (e) { /* o gancho nunca atrapalha a gravação */ }
          return r;
        };
      });
      P.__auditoriaGeral = true;
      return true;
    } catch (e) { return false; }
  }

  return {
    NO: NO, METODOS: METODOS, ignorado: ignorado, classificar: classificar, loteDoCaminho: loteDoCaminho,
    resumir: resumir, montarEvento: montarEvento, descrever: descrever, instalar: instalar, diaLocal: diaLocal
  };
});
