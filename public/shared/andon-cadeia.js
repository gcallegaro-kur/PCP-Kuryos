/* Andon: rotulagem, manipulação e qualidade.

   Pedido do usuário (2026-09-30): entender no Andon/Dashboard também como
   estão a rotulagem, a manipulação e a qualidade, sem poluir a tela -- por
   padrão só o que está fora do normal; o detalhe abre por clique.

   Quatro visões sobre dados que já existem (nenhuma grava nada):
     rotuladoras()  cada rotuladora: operando / parada / livre, com a OP
     postos()       postos de trabalho abertos agora
     funilManipulacao()  onde estão as OPs na fase de bulk e há quanto tempo
     filaQualidade()     o que espera a Qualidade, por tipo, e a espera mais antiga
     cadeia()       a faixa Manipulação → Qualidade do bulk → Envase →
                    Rotulagem → Conferência de PA → Qualidade do PA

   Funções puras, testadas em run_andon_cadeia_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./manipulacao.js'), require('./situacao-op.js'), require('./progresso-op.js'));
  else root.AndonCadeia = factory(root.Manipulacao, root.SituacaoOp, root.ProgressoOp);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Manipulacao, SituacaoOp, ProgressoOp) {
  'use strict';

  var HORA = 3600000;
  // Quanto tempo parado numa etapa já merece atenção. Não são metas da fábrica
  // (ninguém as definiu): são o ponto em que a faixa muda de cor. Ajustáveis.
  var LIMITES_H = {PESADO: 8, CONFERIDO: 8, EM_MANIPULACAO: 12, AGUARDANDO_CQ: 24, REPROVADO: 24, QUALIDADE: 48, LOGISTICA: 48};

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function ms(iso) { var t = Date.parse(iso || ''); return isNaN(t) ? null : t; }
  function horasDesde(iso, agora) { var t = ms(iso); return t == null ? null : Math.max(0, (agora - t) / HORA); }
  function opViva(o) { return !!o && o.status !== 'Cancelado' && o.status !== 'Concluído' && o.status !== 'Aguardando Confirmação'; }
  function chaveRecurso(nome) { return String(nome).replace(/[.#$\[\]\/ ]/g, '_'); }

  /* ── Rotuladoras ───────────────────────────────────────────────── */
  function rotuladoras(nomes, ops, estadoLinhas, agora, sanitize) {
    var chave = sanitize || chaveRecurso;
    return (nomes || []).map(function(nome) {
      var op = null;
      Object.keys(ops || {}).forEach(function(k) {
        var o = ops[k];
        if (o && o.abertaDesdeRot && o.abertaRotulagem === nome && opViva(o)) op = Object.assign({key: k}, o);
      });
      var st = (estadoLinhas || {})[chave(nome)] || {};
      var parada = st.status === 'parada';
      var planejado = op ? n(op.qtdPlanejada) : 0;
      var produzido = op ? n(op.produzidoRotulagem) : 0;
      return {
        nome: nome,
        estado: parada ? 'parada' : op ? 'operando' : 'livre',
        parada: parada ? {motivo: st.motivoParada || 'Parada', desdeMin: st.inicioParada ? Math.round((horasDesde(st.inicioParada, agora) || 0) * 60) : null, lote: st.lote || null} : null,
        op: op ? {lote: op.lote, produto: op.produto || '', produzido: produzido, planejado: planejado,
          pct: planejado > 0 ? Math.min(100, Math.round(produzido / planejado * 100)) : 0,
          emSetup: !!(op.setupInicioRot && !op.setupFimRot)} : null
      };
    });
  }

  /* ── Postos de trabalho (atividadesPosto = abertos agora) ───────── */
  function postos(atividades, agora) {
    return Object.keys(atividades || {}).map(function(id) {
      var a = atividades[id] || {};
      return {id: id, nome: a.nome || '—', operador: a.operador || '', produto: a.produto || '',
        desdeMin: a.abertoEm ? Math.round((horasDesde(a.abertoEm, agora) || 0) * 60) : null};
    }).sort(function(a, b) { return String(a.nome).localeCompare(String(b.nome)); });
  }

  /* ── Funil da manipulação (bulk) ────────────────────────────────── */
  var ETAPAS_MANIP = [
    {k: 'AGUARDANDO_PESAGEM', rot: 'Aguardando pesagem'},
    {k: 'PESADO', rot: 'Pesado, aguarda conferência'},
    {k: 'CONFERIDO', rot: 'Liberado para manipular'},
    {k: 'EM_MANIPULACAO', rot: 'Em manipulação'},
    {k: 'AGUARDANDO_CQ', rot: 'Bulk aguardando análise'},
    {k: 'REPROVADO', rot: 'Bulk reprovado'}
  ];

  // Desde quando a OP está nessa etapa (o campo depende da etapa).
  function desdeDaEtapa(op, etapa) {
    var f = Manipulacao.fase(op) || {};
    var man = f.manipulacao || {}, pes = f.pesagem || {};
    if (etapa === 'PESADO') return pes.fim || pes.inicio || null;
    if (etapa === 'CONFERIDO') return (f.conferencia || {}).em || pes.fim || null;
    if (etapa === 'EM_MANIPULACAO') return man.inicio || null;
    if (etapa === 'AGUARDANDO_CQ') return man.fim || null;
    if (etapa === 'REPROVADO') return (f.analise || {}).em || null;
    return pes.inicio || op.dataEmissao || null;   // AGUARDANDO_PESAGEM
  }

  function funilManipulacao(ops, agora) {
    var etapas = ETAPAS_MANIP.map(function(e) { return {k: e.k, rot: e.rot, itens: [], maisAntigoH: 0, atencao: false}; });
    var por = {};
    etapas.forEach(function(e) { por[e.k] = e; });
    Object.keys(ops || {}).forEach(function(k) {
      var o = ops[k];
      if (!o || o.status === 'Cancelado' || !Manipulacao.fase(o)) return;
      var est = Manipulacao.estado(o);
      // Correção aberta é, na prática, pesagem de novo.
      var chave = est === 'CORRECAO_ABERTA' ? 'AGUARDANDO_PESAGEM' : est;
      if (!por[chave]) return;   // LIBERADO e demais: bulk pronto, nada a esperar
      var h = horasDesde(desdeDaEtapa(o, chave), agora);
      por[chave].itens.push({opKey: k, lote: o.lote || k, produto: o.produto || '', cliente: o.cliente || '', horas: h, correcao: est === 'CORRECAO_ABERTA'});
    });
    etapas.forEach(function(e) {
      e.itens.sort(function(a, b) { return (b.horas || 0) - (a.horas || 0); });
      e.maisAntigoH = e.itens.length ? Math.round((e.itens[0].horas || 0) * 10) / 10 : 0;
      var lim = LIMITES_H[e.k];
      e.atencao = !!lim && e.itens.some(function(i) { return i.horas != null && i.horas > lim; });
    });
    return etapas;
  }

  /* ── Fila da Qualidade ──────────────────────────────────────────── */
  // EP/ES/ET = embalagem; o resto do material, MP (mesma regra da Qualidade).
  function tipoDoLote(itemTipo, itemCodigo) {
    if (itemTipo === 'produto') return 'pa';
    return /^(EP|ES|ET)-/.test(String(itemCodigo || '')) ? 'embalagem' : 'mp';
  }

  function filaQualidade(estoqueLotes, ops, rncs, agora) {
    var tipos = {mp: [], embalagem: [], pa: []};
    Object.keys(estoqueLotes || {}).forEach(function(item) {
      Object.keys(estoqueLotes[item] || {}).forEach(function(k) {
        var l = estoqueLotes[item][k];
        if (!l || l.status !== 'QUARENTENA') return;
        var desde = l.dataRecebimento ? l.dataRecebimento + 'T12:00:00Z' : l.criadoEm;
        tipos[tipoDoLote(l.itemTipo, l.itemCodigo)].push({codigo: l.itemCodigo, nome: l.itemNome || '', saldo: n(l.saldoLote), horas: horasDesde(desde, agora)});
      });
    });
    var bulk = funilManipulacao(ops, agora).filter(function(e) { return e.k === 'AGUARDANDO_CQ' || e.k === 'REPROVADO'; });
    var bulkItens = [];
    bulk.forEach(function(e) { e.itens.forEach(function(i) { bulkItens.push(Object.assign({situacao: e.k}, i)); }); });
    function resumo(rot, itens) {
      var maisAntigoH = itens.reduce(function(m, i) { return Math.max(m, i.horas || 0); }, 0);
      return {rot: rot, total: itens.length, itens: itens.sort(function(a, b) { return (b.horas || 0) - (a.horas || 0); }),
        maisAntigoH: Math.round(maisAntigoH * 10) / 10, atencao: itens.length > 0 && maisAntigoH > LIMITES_H.QUALIDADE};
    }
    var abertas = Object.keys(rncs || {}).filter(function(k) { var s = (rncs[k] || {}).status; return s === 'ABERTA' || s === 'EM_ANALISE'; }).length;
    var out = {
      mp: resumo('Matéria-prima', tipos.mp), embalagem: resumo('Embalagem', tipos.embalagem),
      bulk: resumo('Bulk', bulkItens), pa: resumo('Produto acabado', tipos.pa),
      rncAbertas: abertas
    };
    out.bulk.atencao = bulk.some(function(e) { return e.atencao; });
    return out;
  }

  /* ── Faixa da cadeia ────────────────────────────────────────────── */
  // `contexto`: {ops, estoqueLotes, conferenciasPa, rncs}. Cada etapa diz
  // quantas OPs estão ali AGORA e se algo está esperando mais do que deve.
  function cadeia(contexto, agora) {
    var ops = contexto.ops || {};
    var funil = funilManipulacao(ops, agora);
    var fila = filaQualidade(contexto.estoqueLotes, ops, contexto.rncs, agora);
    var qualidadePorOp = ProgressoOp.paletesPorOp(contexto.estoqueLotes);
    var emManip = funil.filter(function(e) { return ['AGUARDANDO_PESAGEM', 'PESADO', 'CONFERIDO', 'EM_MANIPULACAO'].indexOf(e.k) >= 0; });
    var manipItens = [];
    emManip.forEach(function(e) { e.itens.forEach(function(i) { manipItens.push(Object.assign({etapa: e.rot}, i)); }); });
    var envase = [], rotul = [], logistica = [], qualidadePa = [];
    Object.keys(ops).forEach(function(k) {
      var o = ops[k];
      if (!o) return;
      if (opViva(o) && o.abertaDesde) envase.push({opKey: k, lote: o.lote || k, produto: o.produto || '', horas: horasDesde(o.abertaDesde, agora)});
      if (opViva(o) && o.abertaDesdeRot) rotul.push({opKey: k, lote: o.lote || k, produto: o.produto || '', horas: horasDesde(o.abertaDesdeRot, agora)});
      if (o.status === 'Concluído') {
        var s = SituacaoOp.situacao(o, qualidadePorOp[k], (contexto.conferenciasPa || {})[k] || null, agora);
        var desde = o.confirmadoEm || o.dataFimReal || null;
        if (s.estado === 'AGUARDA_LOGISTICA') logistica.push({opKey: k, lote: o.lote || k, produto: o.produto || '', horas: horasDesde(desde, agora), motivo: s.motivo});
        if (s.estado === 'NA_QUALIDADE') qualidadePa.push({opKey: k, lote: o.lote || k, produto: o.produto || '', horas: horasDesde(desde, agora), motivo: s.motivo});
      }
    });
    function atencaoPorIdade(itens, limite) { return itens.some(function(i) { return i.horas != null && i.horas > limite; }); }
    [envase, rotul, logistica, qualidadePa, manipItens].forEach(function(l) { l.sort(function(a, b) { return (b.horas || 0) - (a.horas || 0); }); });
    var etapas = [
      {k: 'manipulacao', rot: 'Manipulação', itens: manipItens, atencao: emManip.some(function(e) { return e.atencao; })},
      {k: 'qualidade_bulk', rot: 'Qualidade do bulk', itens: fila.bulk.itens, atencao: fila.bulk.atencao},
      {k: 'envase', rot: 'Envase', itens: envase, atencao: false},
      {k: 'rotulagem', rot: 'Rotulagem', itens: rotul, atencao: false},
      {k: 'conferencia_pa', rot: 'Conferência de PA', itens: logistica, atencao: atencaoPorIdade(logistica, LIMITES_H.LOGISTICA)},
      {k: 'qualidade_pa', rot: 'Qualidade do PA', itens: qualidadePa, atencao: atencaoPorIdade(qualidadePa, LIMITES_H.QUALIDADE)}
    ];
    etapas.forEach(function(e) { e.total = e.itens.length; });
    return {etapas: etapas, fila: fila, semAtencao: etapas.every(function(e) { return !e.atencao; })};
  }

  function rotuloTempo(horas) {
    if (horas == null) return '—';
    if (horas < 1) return Math.max(1, Math.round(horas * 60)) + ' min';
    if (horas < 48) return (Math.round(horas * 10) / 10).toString().replace('.', ',') + ' h';
    return Math.round(horas / 24) + ' dias';
  }

  return {LIMITES_H: LIMITES_H, ETAPAS_MANIP: ETAPAS_MANIP, rotuladoras: rotuladoras, postos: postos, funilManipulacao: funilManipulacao,
    filaQualidade: filaQualidade, cadeia: cadeia, tipoDoLote: tipoDoLote, rotuloTempo: rotuloTempo};
});
