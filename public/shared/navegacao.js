/* Navegação do sistema: UM registro de telas que alimenta o menu lateral e a
   tela inicial (27/10/2026).

   Por que existe: o menu era montado à mão em auth_check.js, link a link, cada
   um com a sua condição de módulo -- e a mesma tela aparecia em até quatro
   blocos, com `!temMod(...)` para esconder as repetições. Aqui cada tela é
   declarada UMA vez, com a sua "casa" (o bloco onde mora). Quem pode abrir a
   página (módulos, shared/auth_check.js) vê o link; ninguém vê o mesmo link
   duas vezes. O menu nunca oferece o que daria "Acesso Negado".

   Módulo puro (sem DOM): recebe o contexto da pessoa e devolve dados.
     ctx = {podeAbrir(pagina), temMod(modulo), setores: {producao, manipulacao, rotulagem, gestao}} */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KuryosNav = factory();
})(typeof window !== 'undefined' ? window : this, function() {
  'use strict';

  /* Ordem dos blocos: do pedido do cliente até a saída da carga, depois o apoio. */
  var BLOCOS = ['Analytics', 'Comercial', 'Pedidos e Rastreio', 'PCP', 'Compras', 'Armazém', 'Operação',
    'Qualidade', 'Expedição', 'Manutenção', 'Cadastros', 'ADM', 'RH', 'Ajuda'];

  var EXPEDICAO = ['expedicao.html', 'faturamento.html', 'cargas.html'];

  /* b: bloco (texto, ou função do contexto quando a casa depende de quem olha);
     s: subtítulo dentro do bloco; q: condição extra além de poder abrir a página;
     fam: páginas que também marcam este link como ativo;
     o: posição dentro do bloco (número ou função do contexto); sem ele vale a ordem do registro. */
  var TELAS = [
    // ── Analytics
    {p: 'dashboard.html', r: 'Dashboard Diário', i: 'dashboard', b: 'Analytics'},
    {p: 'dashboard_analise.html', r: 'Dashboard Geral', i: 'history', b: 'Analytics'},

    // ── Comercial
    {p: 'comercial.html', r: 'Pedidos e Orçamentos', i: 'list', b: 'Comercial'},
    {p: 'gestao_comercial.html', r: 'Gestão Comercial', i: 'chart', b: 'Comercial'},
    // Devolução de cliente: o Comercial autoriza, a Logística recebe, a Qualidade acompanha.
    {p: 'devolucoes.html', r: 'Devoluções de Cliente', i: 'history', o: 1000,
      b: function(c) { return c.temMod('comercial') ? 'Comercial' : c.temMod('logistica') ? 'Armazém' : 'Qualidade'; }},

    // ── Pedidos e Rastreio: acompanhar pedido e lote de ponta a ponta
    {p: 'pedidos.html', r: 'Pedidos', i: 'list', b: 'Pedidos e Rastreio'},
    {p: 'relatorio_pedido.html', r: 'Relatório de Pedido', i: 'chart',
      b: function(c) { return c.temMod('comercial') && !c.temMod('pedidos') ? 'Comercial' : 'Pedidos e Rastreio'; }},
    // Dossiê é ferramenta de gestão: PCP (emitir_op) ou Qualidade, nunca o operador.
    {p: 'dossie_lote.html', r: 'Dossiê do Lote', i: 'history', o: 1000,
      b: function(c) { return c.temMod('emitir_op') ? 'Pedidos e Rastreio' : 'Qualidade'; }},
    {p: 'historico.html', r: 'Histórico de Apontamentos', i: 'history', o: 1001,
      b: function(c) { return c.setores.producao || c.setores.rotulagem ? 'Operação' : 'Pedidos e Rastreio'; },
      s: function(c) { return c.setores.producao ? 'Produção' : c.setores.rotulagem ? 'Rotulagem' : null; }},

    // ── PCP
    {p: 'planejamento.html', r: 'Planejamento', i: 'calendar', b: 'PCP'},
    {p: 'ops.html', r: 'Controle de OPs', i: 'gear', b: 'PCP'},
    {p: 'emitir_op.html', r: 'Emitir OP', i: 'pencil', b: 'PCP'},
    {p: 'pesagens.html', i: 'flask',
      r: function(c) { return c.temMod('planejamento') || c.temMod('emitir_op') ? 'Pesagens' : 'Pesagens do dia'; },
      b: function(c) { return c.temMod('planejamento') || c.temMod('emitir_op') ? 'PCP' : 'Operação'; },
      s: function(c) { return c.temMod('planejamento') || c.temMod('emitir_op') ? null : 'Manipulação'; }},
    {p: 'insumos.html', r: 'Matriz de Insumos (MRP)', i: 'box', b: 'PCP'},
    // O que comprar: escolhe pedidos e vê o que falta, material a material.
    {p: 'o_que_comprar.html', r: 'O que comprar', i: 'cart',
      b: function(c) { return c.temMod('pedidos') || c.temMod('planejamento') ? 'PCP' : 'Compras'; }},

    // ── Compras
    {p: 'compras.html', r: 'Compras', i: 'cart', b: 'Compras'},

    // ── Armazém: estoque, endereços e o fluxo físico do material
    {p: 'consulta_estoque.html', r: 'Consulta de Estoque', i: 'warehouse', b: 'Armazém', s: 'Estoque'},
    {p: 'estoque.html', h: 'estoque.html?tab=agregado', r: 'Estoque', i: 'warehouse', b: 'Armazém', s: 'Estoque'},
    {p: 'estoque.html', h: 'estoque.html?tab=posicoes', r: 'WMS', i: 'warehouse', b: 'Armazém', s: 'Estoque'},
    {p: 'titularidade.html', r: 'Titularidade do Estoque', i: 'tag', b: 'Armazém', s: 'Estoque'},
    {p: 'kardex.html', r: 'Kardex', i: 'list', b: 'Armazém', s: 'Estoque'},
    {p: 'movimentar.html', r: 'Movimentar material', i: 'truck', b: 'Armazém', s: 'Estoque'},
    {p: 'logistica.html', r: 'Agendamentos', i: 'truck', b: 'Armazém', s: 'Fluxo'},
    {p: 'proximas_ordens.html', h: 'proximas_ordens.html?setor=separacao', r: 'Próximas Separações', i: 'list', b: 'Armazém', s: 'Fluxo',
      q: function(c) { return c.temMod('logistica'); }},
    {p: 'separacao_materiais.html', r: 'Separação de Materiais', i: 'clipboard', b: 'Armazém', s: 'Fluxo'},
    {p: 'estoque.html', h: 'estoque.html?tab=conferenciapa', r: 'Conferência de PA', i: 'clipboard', b: 'Armazém', s: 'Fluxo'},
    {p: 'descarte.html', r: 'Descarte e Reversa', i: 'clipboard', b: 'Armazém', s: 'Fluxo'},

    // ── Operação: cada setor com a sua tela de trabalho, o seu histórico e o seu estoque
    {p: 'proximas_ordens.html', h: 'proximas_ordens.html?setor=envase', r: 'Próximas Ordens', i: 'list', b: 'Operação', s: 'Produção',
      q: function(c) { return c.setores.producao; }},
    {p: 'form.html', r: 'Apontamento', i: 'pencil', b: 'Operação',
      s: function(c) { return c.setores.producao ? 'Produção' : 'Rotulagem'; },
      q: function(c) { return c.setores.producao || c.setores.rotulagem; }},
    {p: 'liberacao_linha.html', r: 'Liberação de linha', i: 'flask',
      b: function(c) { return c.temMod('qualidade') ? 'Qualidade' : 'Operação'; },
      s: function(c) { return c.temMod('qualidade') ? null : 'Produção'; },
      q: function(c) { return c.temMod('qualidade') || c.setores.producao; }},
    // Inspeção total de PA: a Qualidade decide, o PCP acompanha e a Produção executa.
    {p: 'inspecao_total.html', r: 'Inspeção Total de PA', i: 'flask',
      b: function(c) { return c.temMod('qualidade') ? 'Qualidade' : c.temMod('planejamento') ? 'PCP' : 'Operação'; },
      s: function(c) { return c.temMod('qualidade') || c.temMod('planejamento') ? null : 'Produção'; }},
    {p: 'estoque_setor.html', h: 'estoque_setor.html?setor=producao', r: 'Estoque da Fábrica', i: 'warehouse', b: 'Operação', s: 'Produção',
      q: function(c) { return c.setores.producao; }},
    {p: 'proximas_ordens.html', h: 'proximas_ordens.html?setor=manipulacao', r: 'Próximas Ordens', i: 'list', b: 'Operação', s: 'Manipulação',
      q: function(c) { return c.setores.manipulacao; }},
    {p: 'manipulacao.html', i: 'flask', b: 'Operação', s: 'Manipulação',
      r: function(c) { return c.setores.manipulacao ? 'Pesagem e Manipulação' : 'Conferência de Pesagem'; },
      q: function(c) { return c.setores.manipulacao || c.temMod('conferencia_pesagem'); }},
    {p: 'estoque_setor.html', h: 'estoque_setor.html?setor=manipulacao', r: 'Estoque da Manipulação', i: 'warehouse', b: 'Operação', s: 'Manipulação',
      q: function(c) { return c.setores.manipulacao; }},
    {p: 'proximas_ordens.html', h: 'proximas_ordens.html?setor=rotulagem', r: 'Próximas Ordens', i: 'list', b: 'Operação', s: 'Rotulagem',
      q: function(c) { return c.setores.rotulagem; }},
    {p: 'estoque_setor.html', h: 'estoque_setor.html?setor=rotulagem', r: 'Estoque dos Rótulos', i: 'warehouse', b: 'Operação', s: 'Rotulagem',
      q: function(c) { return c.setores.rotulagem; }},
    // Material em processo (bulk em bombona e sobras): quem opera, quem guarda e quem libera.
    {p: 'material_processo.html', r: 'Material em Processo', i: 'warehouse', b: 'Operação'},

    // ── Qualidade
    {p: 'qualidade.html', h: 'qualidade.html?tab=fila', r: 'Fila de Inspeção', i: 'flask', b: 'Qualidade'},
    {p: 'qualidade.html', h: 'qualidade.html?tab=rnc', r: 'Não Conformidades', i: 'alert', b: 'Qualidade'},
    {p: 'qualidade_historico.html', r: 'Histórico e Indicadores', i: 'chart', b: 'Qualidade'},
    {p: 'retrabalhos.html', r: 'Retrabalhos', i: 'history', b: 'Qualidade'},
    {p: 'checklists_cq.html', r: 'Modelos de checklist', i: 'clipboard', b: 'Qualidade'},
    {p: 'auditoria_5s.html', r: 'Auditoria 5S', i: 'clipboard', b: 'Qualidade'},

    // ── Expedição: três etapas que a própria tela encadeia (shared/cargas-fluxo.js)
    {p: 'expedicao.html', r: 'Expedição de Vendas', i: 'truck', b: 'Expedição', fam: EXPEDICAO},
    {p: 'relatorio_expedicao.html', r: 'Relatório de Expedição', i: 'clipboard', b: 'Expedição'},

    // ── Manutenção, Cadastros, ADM
    {p: 'ativos.html', r: 'Ativos', i: 'gear', b: 'Manutenção'},
    {p: 'cadastros.html', r: 'Cadastros', i: 'tag', b: 'Cadastros'},
    {p: 'admin.html', r: 'Ajustes / Config', i: 'sliders', b: 'ADM'},
    {p: 'usuarios.html', r: 'Usuários', i: 'people', b: 'ADM'},
    {p: 'auditoria.html', r: 'Auditoria', i: 'history', b: 'ADM'},

    // ── RH
    {p: 'rh_dashboard.html', r: 'Dash', i: 'dashboard', b: 'RH'},
    {p: 'rh_cadastros.html', r: 'Colaboradores', i: 'people', b: 'RH'},
    {p: 'rh_avaliacao.html', r: 'Avaliação de Desempenho', i: 'pencil', b: 'RH'},
    {p: 'rh_ferias.html', r: 'Férias', i: 'calendar', b: 'RH'},
    {p: 'rh_temporarios.html', r: 'Temporários', i: 'clipboard', b: 'RH'},
    {p: 'feedback.html', r: 'Feedback da Semana', i: 'pencil', b: 'RH'},
    {p: 'rh_feedback.html', r: 'Feedback e Clima', i: 'chart', b: 'RH'},

    // ── Ajuda: manuais abrem para qualquer autenticado; o módulo só escolhe QUAL oferecer
    {p: 'manuais.html', r: 'Manuais de Operação', i: 'book', b: 'Ajuda'},
    {p: 'manual_apontamento.html', r: 'Apontamento', i: 'book', b: 'Ajuda',
      q: function(c) { return c.temMod('apontamento') || c.temMod('rotulagem') || c.temMod('manipulacao'); }},
    {p: 'manual_pcp.html', r: 'Planejamento e OPs', i: 'book', b: 'Ajuda', q: function(c) { return c.temMod('planejamento'); }},
    {p: 'manual_comercial.html', r: 'Pedidos e MRP', i: 'book', b: 'Ajuda', q: function(c) { return c.temMod('pedidos') || c.temMod('comercial'); }},
    {p: 'manual_compras.html', r: 'Compras', i: 'book', b: 'Ajuda', q: function(c) { return c.temMod('compras'); }},
    {p: 'manual_logistica.html', r: 'Recebimento', i: 'book', b: 'Ajuda', q: function(c) { return c.temMod('logistica'); }},
    {p: 'manual_estoque.html', r: 'Estoque e WMS', i: 'book', b: 'Ajuda', q: function(c) { return c.temMod('logistica'); }},
    {p: 'manual_qualidade.html', r: 'Qualidade', i: 'book', b: 'Ajuda', q: function(c) { return c.temMod('qualidade'); }},
    {p: 'manual_auditoria_5s.html', r: 'Auditoria 5S', i: 'book', b: 'Ajuda', q: function(c) { return c.temMod('auditoria5s'); }},
    {p: 'manual_ativos.html', r: 'Ativos', i: 'book', b: 'Ajuda', q: function(c) { return c.temMod('manutencao'); }},
    {p: 'manual_temporarios.html', r: 'Temporários', i: 'book', b: 'Ajuda', q: function(c) { return c.temMod('rh_temporarios'); }},
    {p: 'manual_feedback.html', r: 'Feedback e Clima', i: 'book', b: 'Ajuda', q: function(c) { return c.temMod('feedback'); }},
    {p: 'manual_cadastros.html', r: 'Cadastros', i: 'book', b: 'Ajuda', q: function(c) { return c.temMod('cadastros'); }},
    {p: 'manual_admin.html', r: 'Administração', i: 'book', b: 'Ajuda', q: function(c) { return c.temMod('usuarios'); }},
    // A referência completa descreve o sistema INTEIRO, inclusive o que a pessoa não acessa.
    {p: 'manual_referencia.html', r: 'Referência do Sistema', i: 'book', b: 'Ajuda'}
  ];

  function valor(v, ctx) { return typeof v === 'function' ? v(ctx) : v; }

  /* Telas com mais de uma casa entram na ordem natural de cada bloco: na
     Qualidade logo depois das Não Conformidades; no PCP depois de Emitir OP. */
  function pos(h) { for (var i = 0; i < TELAS.length; i++) { if ((TELAS[i].h || TELAS[i].p) === h) return i; } return 0; }
  function tela(p) { for (var i = 0; i < TELAS.length; i++) { if (TELAS[i].p === p) return TELAS[i]; } return null; }
  tela('inspecao_total.html').o = function(c) {
    return c.temMod('qualidade') ? pos('qualidade.html?tab=rnc') + 0.5 : c.temMod('planejamento') ? pos('emitir_op.html') + 0.5 : pos('inspecao_total.html');
  };
  tela('liberacao_linha.html').o = function(c) { return c.temMod('qualidade') ? pos('qualidade.html?tab=rnc') + 0.6 : pos('liberacao_linha.html'); };
  tela('pesagens.html').o = function(c) {
    return c.temMod('planejamento') || c.temMod('emitir_op') ? pos('emitir_op.html') + 0.6 : pos('manipulacao.html') + 0.5;
  };

  /* Telas visíveis para a pessoa, já agrupadas por bloco (na ordem de BLOCOS) e
     por subtítulo. Um bloco sem nenhuma tela some. */
  function blocos(ctx) {
    var porBloco = {};
    var vistos = {};
    TELAS.forEach(function(t) {
      if (!ctx.podeAbrir(t.p)) return;
      if (t.q && !t.q(ctx)) return;
      var href = t.h || t.p;
      if (vistos[href]) return;
      vistos[href] = true;
      var nome = valor(t.b, ctx);
      (porBloco[nome] = porBloco[nome] || []).push({
        p: t.p, h: href, r: valor(t.r, ctx), i: t.i, s: valor(t.s, ctx) || null, fam: t.fam || null,
        o: t.o !== undefined ? valor(t.o, ctx) : TELAS.indexOf(t)
      });
    });
    return BLOCOS.filter(function(n) { return porBloco[n] && porBloco[n].length; }).map(function(n) {
      // Itens do mesmo subtítulo ficam juntos, na ordem em que o subtítulo apareceu.
      var itens = porBloco[n].sort(function(a, b) { return a.o - b.o; }), ordem = [], porSub = {};
      itens.forEach(function(it) {
        var k = it.s || '';
        if (!porSub[k]) { porSub[k] = []; ordem.push(k); }
        porSub[k].push(it);
      });
      var lista = [];
      ordem.forEach(function(k) { porSub[k].forEach(function(it) { lista.push(it); }); });
      return {nome: n, itens: lista};
    });
  }

  /* ── Tela inicial: o que está esperando por esta pessoa ──
     Cada cartão declara de quais nós do banco precisa, quem o vê (a página de
     destino precisa abrir) e como contar. Quem não vê o cartão também não gera
     a leitura dos dados dele. */
  var CARTOES = [
    {id: 'inspecao_total', titulo: 'Inspeção total de PA', pagina: 'inspecao_total.html', fontes: ['ops'],
      calcular: function(d, lib) {
        if (!lib.InspecaoTotalPA) return null;
        var fila = lib.InspecaoTotalPA.fila(d.ops).filter(function(f) { return f.estado !== 'DECIDIDA'; });
        if (!fila.length) return null;
        var semResp = 0, vencidas = 0, decidir = 0;
        fila.forEach(function(f) {
          if (f.estado === 'AGUARDANDO_DESIGNACAO') semResp++;
          if (f.estado === 'AGUARDANDO_DECISAO') decidir++;
          var sit = lib.InspecaoTotalPA.situacaoPrazo(f.insp, lib.agora);
          if (sit && sit.vencido) vencidas++;
        });
        var partes = [];
        if (semResp) partes.push(semResp + ' sem responsável');
        if (vencidas) partes.push(vencidas + ' com prazo vencido');
        if (decidir) partes.push(decidir + ' aguardando decisão');
        return {n: fila.length, tom: vencidas ? 'alerta' : 'aviso', texto: partes.join(' · ') || 'em andamento'};
      }},
    {id: 'pesagens', titulo: 'Pesagens para cobrar', pagina: 'pesagens.html', fontes: ['ops', 'programacao'],
      q: function(c) { return c.temMod('planejamento') || c.temMod('emitir_op'); },
      calcular: function(d, lib) {
        if (!lib.PesagensDia) return null;
        var r = lib.PesagensDia.pendencias(d.ops, d.programacao, lib.hoje, {ideal: 3, janela: 5});
        if (!r.cobrar) return null;
        var a = r.contagem.ATRASADA || 0, f = r.contagem.FORA_META || 0;
        var partes = [];
        if (a) partes.push(a + ' com envase hoje ou atrasado');
        if (f) partes.push(f + ' fora da meta');
        return {n: r.cobrar, tom: a ? 'alerta' : 'aviso', texto: partes.join(' · ')};
      }},
    {id: 'cargas_faturar', titulo: 'Cargas a faturar', pagina: 'faturamento.html', fontes: ['agendamentos_expedicao'],
      calcular: function(d, lib) {
        if (!lib.CargasPA) return null;
        var c = lib.CargasPA.contagem(d.agendamentos_expedicao);
        var n = (c.AGENDADA || 0) + (c.FATURAMENTO_SOLICITADO || 0);
        return n ? {n: n, tom: 'aviso', texto: 'agendadas ou com faturamento solicitado'} : null;
      }},
    {id: 'cargas_carregar', titulo: 'Cargas para carregar', pagina: 'cargas.html', fontes: ['agendamentos_expedicao'],
      calcular: function(d, lib) {
        if (!lib.CargasPA) return null;
        var c = lib.CargasPA.contagem(d.agendamentos_expedicao);
        var n = (c.FATURADA || 0) + (c.AGUARDANDO_EMBARQUE || 0);
        return n ? {n: n, tom: 'aviso', texto: 'faturadas, aguardando carregamento e saída'} : null;
      }},
    {id: 'rnc_abertas', titulo: 'Não conformidades abertas', pagina: 'qualidade.html', href: 'qualidade.html?tab=rnc', fontes: ['nao_conformidades'],
      q: function(c) { return c.temMod('qualidade'); },
      calcular: function(d) {
        var n = 0;
        Object.keys(d.nao_conformidades || {}).forEach(function(k) { if ((d.nao_conformidades[k] || {}).status === 'ABERTA') n++; });
        return n ? {n: n, tom: 'aviso', texto: 'aguardando alguém assumir'} : null;
      }}
  ];

  /* Cartões que esta pessoa pode ver (a página de destino abre e a condição extra vale). */
  function cartoesVisiveis(ctx) {
    return CARTOES.filter(function(c) { return ctx.podeAbrir(c.pagina) && (!c.q || c.q(ctx)); });
  }

  /* Nós do banco que os cartões visíveis precisam ler, sem repetir. */
  function fontesNecessarias(cartoes) {
    var vistos = {}, out = [];
    cartoes.forEach(function(c) { c.fontes.forEach(function(f) { if (!vistos[f]) { vistos[f] = true; out.push(f); } }); });
    return out;
  }

  /* Calcula cada cartão; o que não tem pendência (ou falha) simplesmente não aparece. */
  function pendencias(cartoes, dados, lib) {
    var out = [];
    cartoes.forEach(function(c) {
      var r = null;
      try { r = c.calcular(dados, lib || {}); } catch (e) { r = null; }
      if (r && r.n) out.push({id: c.id, titulo: c.titulo, href: c.href || c.pagina, n: r.n, tom: r.tom, texto: r.texto});
    });
    out.sort(function(a, b) { return (a.tom === 'alerta' ? 0 : 1) - (b.tom === 'alerta' ? 0 : 1); });
    return out;
  }

  return {BLOCOS: BLOCOS, TELAS: TELAS, CARTOES: CARTOES, EXPEDICAO: EXPEDICAO, blocos: blocos,
    cartoesVisiveis: cartoesVisiveis, fontesNecessarias: fontesNecessarias, pendencias: pendencias};
});
