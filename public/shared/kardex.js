/* Kardex de estoque (usuário, 01/10: "ver um histórico kardex de cada item do
   estoque, vendo onde entrou, onde saiu, onde foi consumido, onde foi ajustado,
   com log de tudo ... fazer auditoria do que entra e do que sai, apurando
   inventário"; e os produtos intermediários, em construção noutra sessão,
   também precisam aparecer).

   FONTE: o log append-only movimentos_estoque/{itemKey}/{id} = {tipo, motivo,
   qtd, saldoApos, ref, loteKey, enderecoKey, enderecoCodigo, itemTipo,
   itemCodigo, itemNome, unidade, autor, em}. Qualquer item que grave ali
   aparece aqui, inclusive tipos novos (intermediário) -- tipo desconhecido vira
   "Outro" e entra no saldo pelo sinal.

   DUAS RAZÕES -- o ponto que decide se a conta fecha. O mesmo log mistura
   movimentos do SALDO DO ITEM (estoque/{m}.saldoAtual, só materiais) com
   movimentos de LOTE/ENDEREÇO (estoque_lotes). Um consumo de produção, por
   exemplo, grava 'consumo_producao' (saldo) E 'consumo' (baixa FEFO do lote):
   somar os dois conta a saída duas vezes. Transferência de lote dividido grava
   qtd POSITIVA sem mudar nada (sessão "Produto reprovado e retrabalhado",
   01/10). Por isso cada tipo diz em qual razão conta:
     - item com estoque/{key} (materiais): razão do ITEM;
     - item só em estoque_lotes (PA, e o que mais nascer só com lote): razão
       dos LOTES.
   Medido na base em 01/10 com estas regras: 120 de 147 materiais e 23 de 31
   produtos fecham exatamente; o resto tem saldo sem movimento registrado (log
   começou em 03/09; lote criado sem log), que o kardex mostra como linha
   própria em vez de esconder.

   Testado em run_kardex_test.js (inclui ensaio contra a base). */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Kardex = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  // natureza: ENTRADA, SAIDA, CONSUMO, PERDA, AJUSTE, TRANSFERENCIA, QUALIDADE
  // razao: 'item' (conta no saldo do item), 'lote' (conta no saldo dos lotes),
  //        'ambas', 'nenhuma' (informativo).
  var TIPOS = {
    recebimento_pc:            {rotulo: 'Recebimento (PC)',          natureza: 'ENTRADA',  razao: 'ambas'},
    producao_op:               {rotulo: 'Entrada de produção',        natureza: 'ENTRADA',  razao: 'lote'},
    conferencia_pa:            {rotulo: 'Entrada de PA (conferência)', natureza: 'ENTRADA', razao: 'lote'},
    devolucao_cliente:         {rotulo: 'Devolução de cliente',       natureza: 'ENTRADA',  razao: 'lote'},
    consumo_producao:          {rotulo: 'Consumo na produção (OP)',   natureza: 'CONSUMO',  razao: 'item'},
    consumo_manipulacao:       {rotulo: 'Consumo na manipulação',     natureza: 'CONSUMO',  razao: 'item'},
    consumo:                   {rotulo: 'Baixa do lote (FEFO)',       natureza: 'CONSUMO',  razao: 'lote'},
    perda:                     {rotulo: 'Perda de produção',          natureza: 'PERDA',    razao: 'item'},
    expedicao_pa:              {rotulo: 'Expedição (carga)',          natureza: 'SAIDA',    razao: 'lote'},
    saida_manual:              {rotulo: 'Saída manual do lote',       natureza: 'SAIDA',    razao: 'lote'},
    descarte_logistica_reversa:{rotulo: 'Descarte / log. reversa',    natureza: 'SAIDA',    razao: 'lote'},
    devolucao_fornecedor:      {rotulo: 'Devolução ao fornecedor',    natureza: 'SAIDA',    razao: 'item'},
    cancelamento_recebimento:  {rotulo: 'Recebimento cancelado',      natureza: 'AJUSTE',   razao: 'item'},
    ajuste_manual:             {rotulo: 'Ajuste de saldo',            natureza: 'AJUSTE',   razao: 'item'},
    inventario:                {rotulo: 'Ajuste de inventário (lote)', natureza: 'AJUSTE',  razao: 'lote'},
    transferencia:             {rotulo: 'Transferência de endereço',  natureza: 'TRANSFERENCIA', razao: 'nenhuma'},
    qualidade:                 {rotulo: 'Laudo da Qualidade',         natureza: 'QUALIDADE', razao: 'nenhuma'},
    // Sintético (não existe no banco): lote importado da planilha antiga,
    // que nunca teve movimento de entrada no log.
    implantacao_lote:          {rotulo: 'Saldo implantado (planilha)', natureza: 'AJUSTE',  razao: 'lote'},
    // Material em processo (sessão "Material em Processo", 01/10): bombonas e
    // tanques de bulk (bombonas_bulk/{cod}/historico) e sobras/retidos
    // (material_processo/). Não passam por movimentos_estoque; o kardex os
    // converte em movimentos (movimentosMaterialProcesso, abaixo).
    mp_encher:                 {rotulo: 'Bulk na bombona/tanque',      natureza: 'ENTRADA',  razao: 'ambas'},
    mp_ajuste:                 {rotulo: 'Ajuste de kg na bombona',     natureza: 'AJUSTE',   razao: 'ambas'},
    mp_esvaziar:               {rotulo: 'Bombona esvaziada',           natureza: 'SAIDA',    razao: 'ambas'},
    mp_sobra:                  {rotulo: 'Sobra declarada na OP',       natureza: 'ENTRADA',  razao: 'ambas'},
    mp_usado:                  {rotulo: 'Sobra reaproveitada',         natureza: 'CONSUMO',  razao: 'ambas'},
    mp_descartado:             {rotulo: 'Sobra descartada',            natureza: 'PERDA',    razao: 'ambas'},
    mp_devolvido:              {rotulo: 'Sobra devolvida ao estoque',  natureza: 'SAIDA',    razao: 'ambas'}
  };
  var ORIGENS_SEM_LOG = {legado_planilha: 'planilha antiga'};
  var NATUREZAS = {
    ENTRADA: 'Entrada', SAIDA: 'Saída', CONSUMO: 'Consumo', PERDA: 'Perda',
    AJUSTE: 'Ajuste', TRANSFERENCIA: 'Transferência', QUALIDADE: 'Qualidade', OUTRO: 'Outro'
  };

  function num(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function arred(x) { return Math.round(x * 1000) / 1000; }
  function tipoInfo(tipo) {
    return TIPOS[tipo] || {rotulo: tipo ? String(tipo).replace(/_/g, ' ') : 'Movimento', natureza: 'OUTRO', razao: 'ambas'};
  }
  // Conta no saldo desta razão?
  function conta(tipo, razao) {
    var r = tipoInfo(tipo).razao;
    return r === 'ambas' || r === razao;
  }

  /* Razão do item: 'item' quando existe estoque/{key} (saldo agregado),
     senão 'lote'. */
  function razaoDoItem(estoqueItem) {
    return estoqueItem && estoqueItem.saldoAtual != null ? 'item' : 'lote';
  }

  function saldoDosLotes(lotes) {
    return arred(Object.keys(lotes || {}).reduce(function(s, k) { return s + num((lotes[k] || {}).saldoLote); }, 0));
  }

  /* montar({movimentos, estoqueItem, lotes, desde, ate})
     -> {razao, saldoSistema, saldoLog, semOrigem, linhas, periodo, alertas}
     linhas: em ordem cronológica, com saldo corrido que TERMINA no saldo do
     sistema (o "sem origem" entra como primeira linha). */
  function montar(o) {
    var opts = o || {};
    var razao = opts.razao || razaoDoItem(opts.estoqueItem);
    var saldoSistema = opts.saldoSistema != null ? arred(num(opts.saldoSistema))
      : razao === 'item' ? arred(num(opts.estoqueItem && opts.estoqueItem.saldoAtual)) : saldoDosLotes(opts.lotes);
    var movs = Object.keys(opts.movimentos || {}).map(function(id) {
      var m = opts.movimentos[id] || {};
      return Object.assign({id: id}, m);
    }).filter(function(m) { return m.em; });
    // Lote importado da planilha (legado_planilha) entra como implantação:
    // quantidade = saldo do lote menos o que o log já movimentou nele, para o
    // lote fechar sozinho. Data = criação do lote, ou antes do 1º movimento.
    if (razao === 'lote') {
      var primeiro = movs.reduce(function(min, m) { return !min || m.em < min ? m.em : min; }, null);
      Object.keys(opts.lotes || {}).forEach(function(lk) {
        var lote = opts.lotes[lk] || {};
        if (!ORIGENS_SEM_LOG[lote.origemTipo]) return;
        var movido = movs.filter(function(m) { return m.loteKey === lk && conta(m.tipo, 'lote'); })
          .reduce(function(s, m) { return s + num(m.qtd); }, 0);
        var q = arred(num(lote.saldoLote) - movido);
        if (Math.abs(q) <= 0.001) return;
        movs.push({id: '~implantacao_' + lk, tipo: 'implantacao_lote', qtd: q, sintetico: true, loteKey: lk,
          enderecoKey: lote.enderecoKey || null, enderecoCodigo: lote.enderecoCodigo || null,
          motivo: 'Lote ' + (lote.loteInterno || lote.loteOrigem || lote.lote || lk) + ' importado da ' + ORIGENS_SEM_LOG[lote.origemTipo],
          em: lote.criadoEm || lote.dataRecebimento || (primeiro ? primeiro : '2026-01-01T00:00:00.000Z')});
      });
    }
    movs.sort(function(a, b) { return String(a.em).localeCompare(String(b.em)) || String(a.id).localeCompare(String(b.id)); });

    var saldoLog = arred(movs.reduce(function(s, m) { return s + (conta(m.tipo, razao) ? num(m.qtd) : 0); }, 0));
    var semOrigem = arred(saldoSistema - saldoLog);

    var saldo = semOrigem;
    var alertas = [];
    var anterior = null; // último movimento que conta e tem saldoApos (razão do item)
    // saldoApos é só conferência, nunca fonte: estorno de recebimento e
    // devolução ao fornecedor gravam null, e ajustarEstoque grava null quando a
    // transaction não comita. Os efeitos desses entram no acumulado até o
    // próximo saldoApos conhecido, para não acusar elo quebrado falso.
    var acumDesdeAnterior = 0;
    var linhas = movs.map(function(m) {
      var info = tipoInfo(m.tipo);
      var contaAqui = conta(m.tipo, razao);
      var efeito = contaAqui ? num(m.qtd) : 0;
      saldo = arred(saldo + efeito);
      // Elo quebrado: entre dois movimentos com saldoApos, o saldo mudou mais
      // do que os movimentos registrados explicam -> houve alteração sem log.
      if (razao === 'item' && contaAqui) acumDesdeAnterior = arred(acumDesdeAnterior + efeito);
      if (razao === 'item' && contaAqui && m.saldoApos != null && isFinite(Number(m.saldoApos))) {
        if (anterior) {
          var esperado = arred(num(anterior.saldoApos) + acumDesdeAnterior);
          var dif = arred(num(m.saldoApos) - esperado);
          if (Math.abs(dif) > 0.001) {
            alertas.push({tipo: 'ELO', em: m.em, id: m.id, diferenca: dif,
              texto: 'Entre ' + anterior.em + ' e ' + m.em + ' o saldo mudou ' + (dif > 0 ? '+' : '') + dif + ' sem movimento registrado'});
          }
        }
        anterior = m;
        acumDesdeAnterior = 0;
      }
      return {
        id: m.id, em: m.em, tipo: m.tipo || '', rotulo: info.rotulo, natureza: info.natureza,
        motivo: m.motivo || '', qtdInformada: num(m.qtd), efeito: efeito, conta: contaAqui,
        saldo: saldo, saldoApos: m.saldoApos != null ? num(m.saldoApos) : null,
        ref: m.ref || null, loteKey: m.loteKey || null,
        enderecoKey: m.enderecoKey || null, enderecoCodigo: m.enderecoCodigo || null,
        autor: m.autor || null, rnc: m.rncNumero || null, sintetico: !!m.sintetico,
        cliente: (m.propriedade && (m.propriedade.clienteNome || m.propriedade.clienteKey)) || null
      };
    });
    if (Math.abs(semOrigem) > 0.001) {
      alertas.unshift({tipo: 'SEM_ORIGEM', diferenca: semOrigem,
        texto: 'Saldo de ' + semOrigem + ' sem movimento registrado (anterior ao log ou gravado fora dele)'});
    }

    // Período: saldo inicial = saldo corrido antes de "desde".
    var desde = opts.desde || null, ate = opts.ate || null;
    var noPeriodo = linhas.filter(function(l) {
      return (!desde || l.em >= desde) && (!ate || l.em <= ate);
    });
    var antes = linhas.filter(function(l) { return desde && l.em < desde; });
    var saldoInicial = antes.length ? antes[antes.length - 1].saldo : semOrigem;
    var totais = {ENTRADA: 0, SAIDA: 0, CONSUMO: 0, PERDA: 0, AJUSTE: 0, OUTRO: 0};
    noPeriodo.forEach(function(l) {
      if (!l.conta) return;
      var k = totais[l.natureza] != null ? l.natureza : 'OUTRO';
      totais[k] = arred(totais[k] + l.efeito);
    });
    var saldoFinal = noPeriodo.length ? noPeriodo[noPeriodo.length - 1].saldo
      : (ate ? (linhas.filter(function(l) { return l.em <= ate; }).slice(-1)[0] || {saldo: semOrigem}).saldo : saldoSistema);
    if (!noPeriodo.length && !ate) saldoFinal = saldoInicial;

    return {
      razao: razao, saldoSistema: saldoSistema, saldoLog: saldoLog, semOrigem: semOrigem,
      conciliado: Math.abs(semOrigem) <= 0.001 && !alertas.some(function(a) { return a.tipo === 'ELO'; }),
      linhas: linhas, alertas: alertas,
      periodo: {desde: desde, ate: ate, saldoInicial: saldoInicial, saldoFinal: saldoFinal, totais: totais,
        linhas: noPeriodo}
    };
  }

  /* Catálogo de itens para a busca: cadastro de materiais e produtos + tudo
     que tem saldo ou movimento (é por aqui que o intermediário entra sem
     depender de cadastro). */
  function catalogo(c) {
    var d = c || {};
    var out = {};
    function por(key, info) {
      var atual = out[key] || {key: key};
      Object.keys(info).forEach(function(k) { if (info[k] != null && info[k] !== '' && atual[k] == null) atual[k] = info[k]; });
      out[key] = atual;
    }
    function sk(v) { return String(v || '').replace(/[.#$[\]\/]/g, '-'); }
    Object.keys(d.materiais || {}).forEach(function(k) {
      var m = d.materiais[k]; if (!m || !m.mpCodigo) return;
      por(sk(m.mpCodigo), {codigo: m.mpCodigo, nome: m.mpNome, unidade: m.unidade, itemTipo: 'material', grupo: m.tipo || null});
    });
    Object.keys(d.produtos || {}).forEach(function(k) {
      var p = d.produtos[k]; if (!p || !p.sku) return;
      por(sk(p.sku), {codigo: p.sku, nome: p.descricao, unidade: 'un', itemTipo: 'produto', grupo: 'PA'});
    });
    Object.keys(d.estoque || {}).forEach(function(k) {
      var e = d.estoque[k] || {};
      por(k, {codigo: e.materialCodigo || k, nome: e.materialNome, unidade: e.unidade, itemTipo: 'material'});
    });
    // Material em processo antes do log: os movimentos sintéticos não trazem
    // itemCodigo, e o primeiro a preencher o código vence.
    Object.keys(d.processo || {}).forEach(function(k) {
      var p = d.processo[k];
      por(k, {codigo: p.codigo, nome: p.nome, unidade: p.unidade, itemTipo: 'intermediario', grupo: p.grupo});
    });
    [d.estoqueLotes || {}, d.movimentos || {}].forEach(function(fonte) {
      Object.keys(fonte).forEach(function(k) {
        if (k.charAt(0) === '_') return; // movimentos_estoque/_enderecos etc.
        var regs = fonte[k] || {};
        var algum = regs[Object.keys(regs)[0]] || {};
        por(k, {codigo: algum.itemCodigo || k, nome: algum.itemNome, unidade: algum.unidade, itemTipo: algum.itemTipo || 'outro'});
      });
    });
    Object.keys(out).forEach(function(k) {
      out[k].temMovimento = !!(d.movimentos && d.movimentos[k]);
      out[k].temSaldo = !!((d.estoque && d.estoque[k]) || (d.estoqueLotes && d.estoqueLotes[k]) || (d.processo && d.processo[k]));
    });
    return out;
  }

  // Opções de montar() para um item, inclusive material em processo.
  function opcoesDoItem(d, k) {
    var proc = d.processo && d.processo[k];
    return {movimentos: (d.movimentos || {})[k], estoqueItem: (d.estoque || {})[k], lotes: (d.estoqueLotes || {})[k],
      razao: proc ? 'lote' : undefined, saldoSistema: proc ? proc.saldo : undefined};
  }

  /* Conciliação geral (auditoria): um resumo por item que tem saldo ou
     movimento, ordenado pela maior diferença sem origem. */
  function conciliacao(c) {
    var d = c || {};
    var cat = catalogo(d);
    return Object.keys(cat).filter(function(k) { return cat[k].temMovimento || cat[k].temSaldo; }).map(function(k) {
      var r = montar(opcoesDoItem(d, k));
      var ultimo = r.linhas.length ? r.linhas[r.linhas.length - 1].em : null;
      return {key: k, codigo: cat[k].codigo, nome: cat[k].nome || '', itemTipo: cat[k].itemTipo, unidade: cat[k].unidade || '',
        razao: r.razao, saldoSistema: r.saldoSistema, saldoLog: r.saldoLog, semOrigem: r.semOrigem,
        elos: r.alertas.filter(function(a) { return a.tipo === 'ELO'; }).length,
        movimentos: r.linhas.length, ultimo: ultimo, conciliado: r.conciliado};
    }).sort(function(a, b) {
      return (a.conciliado ? 1 : 0) - (b.conciliado ? 1 : 0) || Math.abs(b.semOrigem) - Math.abs(a.semOrigem) ||
        String(a.codigo).localeCompare(String(b.codigo));
    });
  }

  /* Material em processo -> movimentos do kardex.
     Itens (chave com prefixo "proc_", que não colide com cadastro):
       bulk de um lote  -> proc_bulk_{lote}: bombonas (histórico ENCHER/AJUSTE/
                           ESVAZIAR, delta = kgDepois − kgAntes) + sobra de BULK
                           sem recipiente (com recipiente, a bombona já conta);
       frasco rotulado  -> proc_rot_{sku|produto};
       componente       -> proc_comp_{materialCodigo}.
     Sobra: entrada em `em`; baixa (USADO/DESCARTADO/DEVOLVIDO) sai em baixa.em.
     Saldo do sistema = kg nas bombonas do lote + sobras EM_PROCESSO. */
  function movimentosMaterialProcesso(o) {
    var d = o || {};
    var movimentos = {}, itens = {};
    function sk(v) { return String(v || '').replace(/[.#$\[\]\/\s]/g, '-'); }
    function item(key, info) {
      itens[key] = itens[key] || Object.assign({key: key, itemTipo: 'intermediario', saldo: 0}, info);
      return itens[key];
    }
    function mov(key, id, m) { (movimentos[key] = movimentos[key] || {})[id] = m; }
    Object.keys(d.bombonas || {}).forEach(function(cod) {
      var rec = d.bombonas[cod] || {};
      var c = rec.conteudo || null;
      if (c && c.lote) {
        var it = item('proc_bulk_' + sk(c.lote), {codigo: 'BULK ' + c.lote, nome: 'Bulk' + (c.produto ? ' — ' + c.produto : ''), unidade: 'kg', grupo: 'BULK'});
        it.saldo = arred(it.saldo + num(c.kg));
      }
      Object.keys(rec.historico || {}).forEach(function(hid) {
        var h = rec.historico[hid] || {};
        if (!h.lote || !h.em) return;
        var key = 'proc_bulk_' + sk(h.lote);
        item(key, {codigo: 'BULK ' + h.lote, nome: 'Bulk', unidade: 'kg', grupo: 'BULK'});
        var tipo = h.tipo === 'ENCHER' ? 'mp_encher' : h.tipo === 'ESVAZIAR' ? 'mp_esvaziar' : 'mp_ajuste';
        mov(key, cod + '_' + hid, {tipo: tipo, qtd: arred(num(h.kgDepois) - num(h.kgAntes)), em: h.em, ref: h.opKey || null,
          motivo: h.motivo || (h.origem ? 'Origem: ' + h.origem : ''), enderecoCodigo: cod, autor: h.por || null,
          itemTipo: 'intermediario', unidade: 'kg'});
      });
    });
    Object.keys(d.materialProcesso || {}).forEach(function(id) {
      var r = d.materialProcesso[id] || {};
      if (!r.tipo || !r.em) return;
      var key, info;
      if (r.tipo === 'BULK') {
        if (r.recipienteCodigo) return; // a bombona já registra este bulk
        key = 'proc_bulk_' + sk(r.lote);
        info = {codigo: 'BULK ' + r.lote, nome: 'Bulk' + (r.produto ? ' — ' + r.produto : ''), unidade: r.unidade || 'kg', grupo: 'BULK'};
      } else if (r.tipo === 'FRASCO_ROTULADO') {
        key = 'proc_rot_' + sk(r.sku || r.produto);
        info = {codigo: 'ROTULADO ' + (r.sku || r.produto || ''), nome: 'Frascos rotulados' + (r.produto ? ' — ' + r.produto : ''), unidade: r.unidade || 'un', grupo: 'ROTULADO'};
      } else {
        key = 'proc_comp_' + sk(r.materialCodigo || r.descricao);
        info = {codigo: 'EM PROCESSO ' + (r.materialCodigo || ''), nome: (r.descricao || 'Componente') + ' (sobra em processo)', unidade: r.unidade || '', grupo: 'COMPONENTE'};
      }
      var it = item(key, info);
      if (r.produto && /^Bulk$/.test(it.nome)) it.nome = 'Bulk — ' + r.produto;
      var q = arred(num(r.qtd));
      mov(key, id + '_e', {tipo: 'mp_sobra', qtd: q, em: r.em, ref: r.lote || r.opKey || null, motivo: r.descricao || '',
        autor: r.declaradoPor || null, itemTipo: 'intermediario', unidade: info.unidade,
        propriedade: r.donoNome ? {clienteNome: r.donoNome} : null});
      if (r.status && r.status !== 'EM_PROCESSO') {
        var b = r.baixa || {};
        mov(key, id + '_s', {tipo: r.status === 'USADO' ? 'mp_usado' : r.status === 'DESCARTADO' ? 'mp_descartado' : 'mp_devolvido',
          qtd: -q, em: b.em || r.em, ref: r.lote || r.opKey || null, motivo: b.motivo || '', autor: b.por || null,
          itemTipo: 'intermediario', unidade: info.unidade});
      } else {
        it.saldo = arred(it.saldo + q);
      }
    });
    return {movimentos: movimentos, itens: itens};
  }

  /* Junta o material em processo aos dados do kardex, em cópias (o banco não
     é tocado): movimentos sintéticos + d.processo com o saldo de cada item. */
  function comMaterialProcesso(d) {
    var mp = movimentosMaterialProcesso({bombonas: d.bombonas, materialProcesso: d.materialProcesso});
    return Object.assign({}, d, {movimentos: Object.assign({}, d.movimentos || {}, mp.movimentos), processo: mp.itens});
  }

  function csv(item, r) {
    var cab = ['Data/hora', 'Movimento', 'Natureza', 'Motivo', 'Referência', 'Lote', 'Endereço', 'Cliente', 'Autor', 'Qtd informada', 'Efeito no saldo', 'Saldo'];
    function q(v) { var s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    function n(v) { return v == null ? '' : String(v).replace('.', ','); }
    var linhas = [['Item', (item && item.codigo) || '', (item && item.nome) || ''].map(q).join(';'), cab.join(';')];
    if (Math.abs(r.semOrigem) > 0.001) linhas.push(['', 'Saldo sem movimento registrado', 'AJUSTE', '', '', '', '', '', '', '', n(r.semOrigem), n(r.semOrigem)].map(q).join(';'));
    r.linhas.forEach(function(l) {
      linhas.push([l.em, l.rotulo, NATUREZAS[l.natureza] || l.natureza, l.motivo, l.ref, l.loteKey, l.enderecoCodigo || l.enderecoKey, l.cliente, l.autor,
        n(l.qtdInformada), n(l.efeito), n(l.saldo)].map(q).join(';'));
    });
    return linhas.join('\n');
  }

  return {TIPOS: TIPOS, NATUREZAS: NATUREZAS, tipoInfo: tipoInfo, conta: conta, razaoDoItem: razaoDoItem,
    saldoDosLotes: saldoDosLotes, montar: montar, opcoesDoItem: opcoesDoItem,
    movimentosMaterialProcesso: movimentosMaterialProcesso, comMaterialProcesso: comMaterialProcesso, catalogo: catalogo, conciliacao: conciliacao, csv: csv};
});
