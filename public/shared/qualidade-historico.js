/* Histórico e dashboard da Qualidade (29/09).

   Pedido do usuário: "um histórico de análises da qualidade, consultando cada
   laudo, aprovação e etc, junto com dashboard de análise, montagem de KPIs".

   Uma análise = uma decisão da Qualidade sobre algo:
   - lote em estoque (matéria-prima, embalagem, palete de produto acabado):
     estoque_lotes/{item}/{lote}.qualidade -- gravado por
     registrarLaudoQualidade (utils.js);
   - bulk (análise do granel, fase de manipulação do lote):
     ops/{op}.manipulacao.analise, e cada ciclo de correção anterior em
     manipulacao.historico/c{n}.analise -- a reprovação que abriu a correção
     também é uma análise e conta.
   Nada é gravado aqui: o histórico é LIDO de onde a decisão já mora.

   Funções puras, testadas em run_qualidade_historico_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QualidadeHistorico = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var TIPOS = {
    mp: {rotulo: 'Matéria-prima'}, embalagem: {rotulo: 'Embalagem'},
    bulk: {rotulo: 'Bulk'}, pa: {rotulo: 'Produto acabado'}
  };
  var ORDEM_TIPOS = ['mp', 'embalagem', 'bulk', 'pa'];
  // Resultado de uma decisão, em quatro baldes. LIBERADO_EXPEDICAO é o
  // LIBERADO do palete; concessão é aprovação com autorização nominal.
  var RESULTADOS = {
    APROVADO: {rotulo: 'Aprovado'}, CONCESSAO: {rotulo: 'Aprovado c/ concessão'},
    REPROVADO: {rotulo: 'Reprovado'}, RETIDO: {rotulo: 'Retido'}
  };
  function resultadoDe(decisao) {
    var d = String(decisao || '').toUpperCase();
    if (d === 'LIBERADO' || d === 'LIBERADO_EXPEDICAO') return 'APROVADO';
    if (d === 'APROVADO_CONCESSAO') return 'CONCESSAO';
    if (d === 'REPROVADO') return 'REPROVADO';
    if (d === 'RETIDO') return 'RETIDO';
    return null;
  }

  function txt(v) { return String(v == null ? '' : v).trim(); }
  function ms(v) { var t = v ? new Date(v).getTime() : NaN; return isNaN(t) ? null : t; }
  // Mesma regra de roteiroDoLote (qualidade.html): EP/ES/ET no cadastro = embalagem.
  function tipoDoLote(lote, materiais) {
    if ((lote || {}).itemTipo === 'produto') return 'pa';
    var cod = txt(lote.itemCodigo).toUpperCase();
    var m = null;
    Object.keys(materiais || {}).some(function(k) {
      var x = materiais[k] || {};
      if (txt(x.mpCodigo).toUpperCase() === cod || k.toUpperCase() === cod) { m = x; return true; }
      return false;
    });
    return m && /^(EP|ES|ET)$/.test(txt(m.tipo).toUpperCase()) ? 'embalagem' : 'mp';
  }
  // Quando o lote chegou à Qualidade: recebimento (material) ou conferência (palete).
  function entradaDoLote(l) {
    var r = l.recebimento || {}, c = l.conferencia || {};
    return ms(c.conferidoEm) || ms(r.recebidoEm) || ms(l.dataRecebimento && (l.dataRecebimento + 'T12:00:00')) || ms(l.criadoEm);
  }
  function contarNcEnsaios(ensaios) {
    var nc = 0;
    Object.keys(ensaios || {}).forEach(function(k) { if ((ensaios[k] || {}).conforme === false) nc++; });
    return nc;
  }

  /* Todas as análises decididas. ctx: {materiais, pedidosCompra, rncs}. */
  function coletar(estoqueLotes, ops, ctx) {
    var c = ctx || {}, out = [];
    var rncPorLote = {}, rncPorOpLote = {};
    Object.keys(c.rncs || {}).forEach(function(n) {
      var r = c.rncs[n] || {};
      if (r.loteKey) rncPorLote[r.loteKey] = n;
      if (r.opLote) rncPorOpLote[r.opLote] = rncPorOpLote[r.opLote] || n;
    });
    Object.keys(estoqueLotes || {}).forEach(function(itemKey) {
      Object.keys(estoqueLotes[itemKey] || {}).forEach(function(loteKey) {
        var l = estoqueLotes[itemKey][loteKey];
        var q = l && l.qualidade;
        var res = q && resultadoDe(q.decisao);
        if (!res || !q.inspecionadoEm) return;
        var tipo = tipoDoLote(l, c.materiais);
        var pc = l.origemTipo === 'recebimento_pc' && l.origemRef ? (c.pedidosCompra || {})[l.origemRef] : null;
        var entrada = entradaDoLote(l), em = ms(q.inspecionadoEm);
        var ck7 = q.ck7 || {};
        out.push({
          id: itemKey + '/' + loteKey, tipo: tipo, itemCodigo: txt(l.itemCodigo) || itemKey, itemNome: txt(l.itemNome),
          lote: txt(l.loteOrigem || l.loteInterno || (l.recebimento || {}).loteInterno) || loteKey, loteKey: loteKey,
          origem: tipo === 'pa' ? txt(l.cliente) : txt(pc && pc.fornecedorNome),
          fornecedorKey: pc ? txt(pc.fornecedorKey) : '',
          decisao: q.decisao, resultado: res, em: em, por: txt(q.inspecionadoPor), autorizadoPor: txt(q.autorizadoPor),
          observacao: txt(q.observacao), entrada: entrada, leadHoras: entrada && em && em >= entrada ? (em - entrada) / 3600000 : null,
          ensaiosNc: contarNcEnsaios(q.ensaios), ensaiosTotal: Object.keys(q.ensaios || {}).length,
          criticosNc: (ck7.criticosNC || 0), pesoForaPa: tipo === 'pa' && ck7.pesagem ? ck7.pesagem.conforme === false : false,
          pesoAvaliadoPa: tipo === 'pa' && !!(ck7.pesagem && ck7.pesagem.conforme != null),
          rnc: rncPorLote[loteKey] || null, opKey: txt(l.opKey), ciclo: null
        });
      });
    });
    Object.keys(ops || {}).forEach(function(opKey) {
      var op = ops[opKey] || {}, f = op.manipulacao;
      if (!f) return;
      var ciclos = [];
      Object.keys(f.historico || {}).forEach(function(k) {
        var h = f.historico[k] || {};
        ciclos.push({ciclo: parseInt(String(k).replace(/\D/g, ''), 10) || 1, fase: h});
      });
      ciclos.push({ciclo: parseInt(f.ciclo || 1, 10) || 1, fase: f});
      ciclos.forEach(function(cy) {
        var a = (cy.fase || {}).analise || {};
        var res = resultadoDe(a.decisao);
        if (!res || !a.em) return;
        var entrada = ms(((cy.fase || {}).manipulacao || {}).fim), em = ms(a.em);
        out.push({
          id: opKey + '#c' + cy.ciclo, tipo: 'bulk', itemCodigo: txt(op.sku), itemNome: txt(op.produto),
          lote: txt(op.lote) || opKey, loteKey: opKey, origem: txt(op.cliente), fornecedorKey: '',
          decisao: a.decisao, resultado: res, em: em, por: txt(a.por), autorizadoPor: '', observacao: txt(a.observacao),
          entrada: entrada, leadHoras: entrada && em && em >= entrada ? (em - entrada) / 3600000 : null,
          ensaiosNc: contarNcEnsaios(a.ensaios), ensaiosTotal: Object.keys(a.ensaios || {}).length,
          criticosNc: 0, pesoForaPa: false, pesoAvaliadoPa: false,
          rnc: ((cy.fase || {}).correcao || {}).rncNumero || (f.correcao || {}).rncNumero || rncPorOpLote[txt(op.lote)] || null,
          opKey: opKey, ciclo: cy.ciclo
        });
      });
    });
    out.sort(function(a, b) { return b.em - a.em; });
    return out;
  }

  /* O que ainda espera a Qualidade, por tipo, com a espera mais longa. */
  function pendentes(estoqueLotes, ops, ctx, agora) {
    var c = ctx || {}, t = (agora || new Date()).getTime();
    var out = {mp: [], embalagem: [], bulk: [], pa: []};
    Object.keys(estoqueLotes || {}).forEach(function(ik) {
      Object.keys(estoqueLotes[ik] || {}).forEach(function(lk) {
        var l = estoqueLotes[ik][lk];
        if (!l || l.status !== 'QUARENTENA') return;
        var e = entradaDoLote(l);
        out[tipoDoLote(l, c.materiais)].push({id: ik + '/' + lk, dias: e ? (t - e) / 86400000 : null});
      });
    });
    Object.keys(ops || {}).forEach(function(k) {
      var f = (ops[k] || {}).manipulacao;
      if (!f || f.status !== 'AGUARDANDO_CQ') return;
      var e = ms((f.manipulacao || {}).fim);
      out.bulk.push({id: k, dias: e ? (t - e) / 86400000 : null});
    });
    var r = {};
    ORDEM_TIPOS.forEach(function(tp) {
      var dias = out[tp].map(function(x) { return x.dias; }).filter(function(d) { return d != null; });
      r[tp] = {qtd: out[tp].length, maisAntigoDias: dias.length ? Math.max.apply(null, dias) : null};
    });
    return r;
  }

  function quantil(lista, q) {
    var v = lista.filter(function(x) { return x != null && isFinite(x); }).sort(function(a, b) { return a - b; });
    if (!v.length) return null;
    var pos = (v.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  }
  function resumo(lista) {
    var r = {total: lista.length, APROVADO: 0, CONCESSAO: 0, REPROVADO: 0, RETIDO: 0};
    lista.forEach(function(a) { r[a.resultado]++; });
    r.taxaAprovacao = r.total ? (r.APROVADO + r.CONCESSAO) / r.total : null;
    r.taxaReprovacao = r.total ? r.REPROVADO / r.total : null;
    r.leadMedianaH = quantil(lista.map(function(a) { return a.leadHoras; }), 0.5);
    r.leadP90H = quantil(lista.map(function(a) { return a.leadHoras; }), 0.9);
    return r;
  }
  function inicioDaSemana(t) {
    var d = new Date(t); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // segunda
    return d.getTime();
  }

  /* KPIs do período. opts: {desde (ms), ate (ms), tipo ('' = todos), semanas (n)} */
  function kpis(analises, opts) {
    var o = opts || {};
    var no = analises.filter(function(a) {
      return (o.desde == null || a.em >= o.desde) && (o.ate == null || a.em <= o.ate) && (!o.tipo || a.tipo === o.tipo);
    });
    var porTipo = {};
    ORDEM_TIPOS.forEach(function(t) { porTipo[t] = resumo(no.filter(function(a) { return a.tipo === t; })); });

    // Bulk aprovado na 1ª análise: por OP, o ciclo 1 foi liberado?
    var opsBulk = {};
    no.filter(function(a) { return a.tipo === 'bulk'; }).forEach(function(a) {
      var cur = opsBulk[a.opKey];
      if (!cur || a.ciclo < cur.ciclo) opsBulk[a.opKey] = a;
    });
    var primeiros = Object.keys(opsBulk).map(function(k) { return opsBulk[k]; });
    var primeiraPassagem = primeiros.length
      ? primeiros.filter(function(a) { return a.ciclo === 1 && a.resultado !== 'REPROVADO'; }).length / primeiros.length : null;

    // Fornecedores (MP e embalagem): quem mais reprova, taxa sobre o que entregou.
    var forn = {};
    no.filter(function(a) { return (a.tipo === 'mp' || a.tipo === 'embalagem') && a.origem; }).forEach(function(a) {
      var f = forn[a.origem] = forn[a.origem] || {nome: a.origem, total: 0, reprovados: 0, concessoes: 0};
      f.total++;
      if (a.resultado === 'REPROVADO') f.reprovados++;
      if (a.resultado === 'CONCESSAO') f.concessoes++;
    });
    var fornecedores = Object.keys(forn).map(function(k) { var f = forn[k]; f.taxaReprovacao = f.reprovados / f.total; return f; })
      .sort(function(a, b) { return (b.reprovados - a.reprovados) || (b.total - a.total) || (a.nome < b.nome ? -1 : 1); });

    var analistas = {};
    no.forEach(function(a) { var k = a.por || '—'; analistas[k] = (analistas[k] || 0) + 1; });

    // Série semanal por resultado, das N semanas até `ate` (ou hoje).
    var nSem = o.semanas || 8;
    var fimSem = inicioDaSemana(o.ate || Date.now());
    var semanas = [];
    for (var i = nSem - 1; i >= 0; i--) {
      var ini = fimSem - i * 7 * 86400000;
      var s = {inicio: ini, APROVADO: 0, CONCESSAO: 0, REPROVADO: 0, RETIDO: 0, total: 0};
      analises.forEach(function(a) {
        if ((o.tipo && a.tipo !== o.tipo) || inicioDaSemana(a.em) !== ini) return;
        s[a.resultado]++; s.total++;
      });
      semanas.push(s);
    }

    var pa = no.filter(function(a) { return a.tipo === 'pa'; });
    var paAvaliados = pa.filter(function(a) { return a.pesoAvaliadoPa; });
    return {
      geral: resumo(no), porTipo: porTipo, primeiraPassagemBulk: primeiraPassagem, opsBulk: primeiros.length,
      fornecedores: fornecedores,
      analistas: Object.keys(analistas).map(function(k) { return {nome: k, total: analistas[k]}; }).sort(function(a, b) { return b.total - a.total; }),
      semanas: semanas,
      pesoForaPa: paAvaliados.filter(function(a) { return a.pesoForaPa; }).length, paletesPesados: paAvaliados.length,
      criticosPa: pa.filter(function(a) { return a.criticosNc > 0; }).length,
      comRnc: no.filter(function(a) { return a.rnc; }).length
    };
  }

  // Busca sem acento em item, lote, origem, analista, RNC e observação.
  function semAcento(s) { return txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function filtrar(analises, f) {
    var o = f || {};
    var termos = semAcento(o.busca).split(/\s+/).filter(Boolean);
    return analises.filter(function(a) {
      if (o.tipo && a.tipo !== o.tipo) return false;
      if (o.resultado && a.resultado !== o.resultado) return false;
      if (o.desde != null && a.em < o.desde) return false;
      if (o.ate != null && a.em > o.ate) return false;
      if (!termos.length) return true;
      var alvo = semAcento([a.itemCodigo, a.itemNome, a.lote, a.origem, a.por, a.rnc, a.observacao].join(' '));
      return termos.every(function(t) { return alvo.indexOf(t) >= 0; });
    });
  }

  /* ── Pipeline semanal (29/09) ──
     Pedido do usuário: "um pipeline semanal, acompanhando como foi a semana
     anterior". Cada coisa que passou pela Qualidade é um item com ENTRADA
     (chegou para análise) e, se já decidida, DECISÃO. Numa semana:
       em aberto no início + entraram − decididas = em aberto no fim
     A conta fecha por construção: um item que entrou e foi decidido na
     mesma semana está nas duas parcelas do meio. */
  function itensFluxo(estoqueLotes, ops, ctx) {
    var itens = coletar(estoqueLotes, ops, ctx).map(function(a) {
      // Decidido sem data de entrada conhecida: conta como entrou e saiu
      // no mesmo instante -- aparece nas decisões sem inventar fila.
      return {id: a.id, tipo: a.tipo, entrada: a.entrada != null ? a.entrada : a.em, decisao: a.em, resultado: a.resultado, analise: a};
    });
    var c = ctx || {};
    Object.keys(estoqueLotes || {}).forEach(function(ik) {
      Object.keys(estoqueLotes[ik] || {}).forEach(function(lk) {
        var l = estoqueLotes[ik][lk];
        if (!l || l.status !== 'QUARENTENA') return;
        var e = entradaDoLote(l);
        if (e != null) itens.push({id: ik + '/' + lk, tipo: tipoDoLote(l, c.materiais), entrada: e, decisao: null, resultado: null});
      });
    });
    Object.keys(ops || {}).forEach(function(k) {
      var f = (ops[k] || {}).manipulacao;
      if (!f || f.status !== 'AGUARDANDO_CQ') return;
      var e = ms((f.manipulacao || {}).fim);
      if (e != null) itens.push({id: k + '#c' + (parseInt(f.ciclo || 1, 10) || 1), tipo: 'bulk', entrada: e, decisao: null, resultado: null});
    });
    return itens;
  }

  function contarSemana(itens, ini, fim) {
    var r = {abertoInicio: 0, entraram: 0, decididas: 0, abertoFim: 0,
      APROVADO: 0, CONCESSAO: 0, REPROVADO: 0, RETIDO: 0, tempos: [], analises: []};
    itens.forEach(function(it) {
      var aberto = function(t) { return it.entrada < t && (it.decisao == null || it.decisao >= t); };
      if (aberto(ini)) r.abertoInicio++;
      if (it.entrada >= ini && it.entrada < fim) r.entraram++;
      if (it.decisao != null && it.decisao >= ini && it.decisao < fim) {
        r.decididas++; r[it.resultado]++;
        if (it.analise) { r.analises.push(it.analise); if (it.analise.leadHoras != null) r.tempos.push(it.analise.leadHoras); }
      }
      if (aberto(fim)) r.abertoFim++;
    });
    r.taxaAprovacao = r.decididas ? (r.APROVADO + r.CONCESSAO) / r.decididas : null;
    r.tempoMedianoH = quantil(r.tempos, 0.5);
    delete r.tempos;
    r.analises.sort(function(a, b) { return b.em - a.em; });
    return r;
  }

  /* A semana que começa em `inicioSemana` (segunda 00:00), no total e por
     tipo, e a anterior para comparação. opts.tipo filtra. */
  function pipelineSemana(itens, inicioSemana, opts) {
    var o = opts || {};
    var lista = o.tipo ? itens.filter(function(i) { return i.tipo === o.tipo; }) : itens;
    var ini = inicioDaSemana(inicioSemana), fim = ini + 7 * 86400000, iniAnt = ini - 7 * 86400000;
    var porTipo = {};
    ORDEM_TIPOS.forEach(function(t) {
      if (o.tipo && t !== o.tipo) return;
      porTipo[t] = contarSemana(itens.filter(function(i) { return i.tipo === t; }), ini, fim);
    });
    return {inicio: ini, fim: fim, semana: contarSemana(lista, ini, fim), anterior: contarSemana(lista, iniAnt, ini), porTipo: porTipo};
  }
  // A última semana COMPLETA antes de `agora` (a "semana anterior").
  function semanaAnterior(agora) { return inicioDaSemana(agora) - 7 * 86400000; }

  return {
    TIPOS: TIPOS, ORDEM_TIPOS: ORDEM_TIPOS, RESULTADOS: RESULTADOS, resultadoDe: resultadoDe,
    tipoDoLote: tipoDoLote, coletar: coletar, pendentes: pendentes, kpis: kpis, filtrar: filtrar,
    quantil: quantil, inicioDaSemana: inicioDaSemana,
    itensFluxo: itensFluxo, pipelineSemana: pipelineSemana, semanaAnterior: semanaAnterior
  };
});
