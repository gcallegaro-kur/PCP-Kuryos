/* Dossiê do lote: tudo o que aconteceu com uma OP, num lugar só.

   Pedido do usuário (2026-09-18): "quero auditar a op 26250/02, pesquiso por
   ela, ou pelo cliente, ou pelo nome, e ele me traz tudo o que foi pesado,
   junto com a op de fabricação completa".

   O lote não mora num nó só -- cada setor grava o seu pedaço:
     ops/{opKey}                       a OP e a fase de granel (manipulacao)
     registros/{data}/{id}             apontamentos de envase (campo lote)
     paradas_historico/{id}            paradas de linha (campo lote)
     perdas/{opKey}/{id}               perdas de embalagem no envase
     movimentos_estoque/{item}/{id}    consumo de material (ref = lote)
     estoque_lotes/{sku}/{palete}      paletes de PA, com conferência e laudo
     conferencias_pa/{opKey}           contagens da Logística
     nao_conformidades/{numero}        RNCs ligadas ao lote
   Este módulo só LÊ e junta; não grava nada. Funções puras, testadas em
   run_dossie_lote_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./manipulacao.js'));
  else root.DossieLote = factory(root.Manipulacao);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Manipulacao) {
  'use strict';

  function texto(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  // Busca sem acento e sem caixa: "Rôse" acha "ROSE", "leao" acha "LEÃO".
  function normalizar(v) {
    return texto(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
  }
  // "26250/02", "26250-02", "26250.02" e "2625002" são o mesmo lote.
  function compacto(v) { return normalizar(v).replace(/[^a-z0-9]/g, ''); }
  function lista(no) {
    return Object.keys(no || {}).map(function(k) {
      var v = no[k];
      return v && typeof v === 'object' ? Object.assign({id: k}, v) : null;
    }).filter(Boolean);
  }
  function porData(campo) {
    return function(a, b) { return String(a[campo] || '').localeCompare(String(b[campo] || '')); };
  }

  /* Busca por lote, cliente, produto, SKU ou pedido. Todas as palavras
     digitadas precisam aparecer (em qualquer campo). Mais recente primeiro. */
  function buscar(ops, termo, limite) {
    var palavras = normalizar(termo).split(' ').filter(Boolean);
    var max = limite || 50;
    var achados = Object.keys(ops || {}).map(function(k) { return Object.assign({key: k}, ops[k]); })
      .filter(function(o) { return o && (o.lote || o.produto); })
      .filter(function(o) {
        if (!palavras.length) return true;
        var campos = [o.lote, o.key, o.cliente, o.produto, o.sku, o.skuPedidoKey, o.linha].map(texto).join(' ');
        var solto = normalizar(campos), junto = compacto(campos);
        return palavras.every(function(p) {
          var pc = compacto(p);
          return solto.indexOf(p) >= 0 || (pc && junto.indexOf(pc) >= 0);
        });
      });
    // Quem digitou o lote exato quer aquele lote em cima.
    var alvo = compacto(termo);
    achados.sort(function(a, b) {
      var ea = compacto(a.lote) === alvo ? 1 : 0, eb = compacto(b.lote) === alvo ? 1 : 0;
      if (ea !== eb) return eb - ea;
      return String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')) ||
        String(b.lote || '').localeCompare(String(a.lote || ''));
    });
    return {total: achados.length, itens: achados.slice(0, max)};
  }

  function acharOp(ops, chaveOuLote) {
    if (!chaveOuLote) return null;
    if (ops && ops[chaveOuLote]) return chaveOuLote;
    var alvo = compacto(chaveOuLote);
    return Object.keys(ops || {}).find(function(k) {
      return compacto((ops[k] || {}).lote) === alvo || compacto(k) === alvo;
    }) || null;
  }

  /* A fase de granel, pronta para auditar: por MP o previsto, o total, cada
     pesagem (inclusive as canceladas, riscadas) com a foto, e a conferência. */
  function montarGranel(op) {
    var f = Manipulacao.fase(op);
    if (!f) return {existe: false};
    var previstos = f.previstos || {};
    var pes = f.pesagem || {};
    var conf = (f.conferencia || {}).itens || {};
    var linhas = Manipulacao.linhasPesagem(previstos, pes).map(function(l) {
      var n = 0;
      var parcelas = Manipulacao.parcelasDoItem(pes, l.itemKey, true).map(function(p) {
        if (!p.canceladaEm) n++;
        return Object.assign({}, p, {ordem: p.canceladaEm ? null : n});
      });
      var avulsas = parcelas.length ? [] : Manipulacao.fotosDoItem(pes, l.itemKey);
      return Object.assign({}, l, {
        todasParcelas: parcelas, fotosAvulsas: avulsas,
        // O que o FEFO mandou usar no início da pesagem x o que foi usado.
        planoFefo: Manipulacao.situacaoLotes(((pes.planoLotes || {})[l.itemKey]) || [], parcelas.filter(function(p) { return !p.canceladaEm; })),
        // Quem guardou a embalagem de volta, onde e quando.
        devolucao: Manipulacao.devolucaoDoItem(pes, l.itemKey),
        conferencia: conf[l.itemKey] || null
      });
    });
    return {
      existe: true, status: Manipulacao.estado(op), rotulo: Manipulacao.rotulo(Manipulacao.estado(op)),
      linhas: linhas, resumo: Manipulacao.resumoManipulacao(previstos, f),
      pesagem: {inicio: pes.inicio || null, fim: pes.fim || null, por: pes.por || null, baixaAplicada: !!pes.baixaAplicada},
      conferencia: {por: (f.conferencia || {}).por || null, em: (f.conferencia || {}).em || null},
      manipulacao: f.manipulacao || {},
      analise: f.analise || null
    };
  }

  function montar(opKey, fontes) {
    var F = fontes || {};
    var op = (F.ops || {})[opKey];
    if (!op) return null;
    var lote = texto(op.lote), cLote = compacto(lote);
    var mesmoLote = function(v) { return v && compacto(v) === cLote; };

    var apontamentos = [];
    Object.keys(F.registros || {}).forEach(function(dia) {
      lista(F.registros[dia]).forEach(function(r) { if (mesmoLote(r.lote)) apontamentos.push(Object.assign({dia: dia}, r)); });
    });
    apontamentos.sort(porData('timestamp'));

    var paradas = lista(F.paradas).filter(function(p) { return mesmoLote(p.lote); }).sort(porData('inicio'));

    var perdas = [];
    Object.keys(F.perdas || {}).forEach(function(k) {
      lista(F.perdas[k]).forEach(function(p) {
        if (k === opKey || mesmoLote(p.lote)) {
          (Array.isArray(p.perdas) ? p.perdas : lista(p.perdas)).forEach(function(x) {
            perdas.push({data: p.data || null, timestamp: p.timestamp || null, linha: p.linha || null, tipo: x.tipo, quantidade: num(x.quantidade)});
          });
        }
      });
    });
    perdas.sort(porData('timestamp'));

    // Consumo de material, somado por item (o que saiu do estoque para o lote).
    var consumoPorItem = {};
    Object.keys(F.movimentos || {}).forEach(function(item) {
      lista(F.movimentos[item]).forEach(function(m) {
        if (!mesmoLote(m.ref)) return;
        var c = consumoPorItem[item] = consumoPorItem[item] || {itemCodigo: m.itemCodigo || item, itemNome: m.itemNome || '', unidade: m.unidade || '', qtd: 0, movimentos: []};
        c.qtd += num(m.qtd);
        c.movimentos.push(m);
      });
    });
    var consumos = Object.keys(consumoPorItem).map(function(k) {
      var c = consumoPorItem[k];
      c.qtd = Math.round(c.qtd * 1000) / 1000;
      // Consumo é saída: conta pelo valor absoluto. Em 10/09 um defeito de
      // densidade lançou consumos POSITIVOS (o estoque subiu em vez de
      // descer); o dossiê mostra a quantidade e marca o lançamento, não
      // esconde -- é exatamente o tipo de coisa que a auditoria procura.
      var consumosMov = c.movimentos.filter(function(m) { return /^consumo/.test(m.tipo || ''); });
      c.consumido = Math.round(consumosMov.reduce(function(s, m) { return s + Math.abs(num(m.qtd)); }, 0) * 1000) / 1000;
      c.sinalInvertido = consumosMov.filter(function(m) { return num(m.qtd) > 0; }).length;
      c.tipos = c.movimentos.map(function(m) { return m.tipo; }).filter(function(t, i, a) { return t && a.indexOf(t) === i; });
      c.movimentos.sort(porData('em'));
      return c;
    }).sort(function(a, b) { return String(a.itemCodigo).localeCompare(String(b.itemCodigo)); });

    var paletes = [];
    Object.keys(F.estoqueLotes || {}).forEach(function(item) {
      lista(F.estoqueLotes[item]).forEach(function(l) {
        if (l.itemTipo === 'produto' && (l.opKey === opKey || mesmoLote(l.opLote) || mesmoLote(l.loteOrigem))) paletes.push(l);
      });
    });
    paletes.sort(function(a, b) { return num(a.paleteNumero) - num(b.paleteNumero) || String(a.id).localeCompare(String(b.id)); });

    var conferenciaPa = (F.conferenciasPa || {})[opKey] || null;
    var contagensPa = conferenciaPa ? lista(conferenciaPa.contagens).sort(porData('contadoEm')) : [];

    var rncs = lista(F.naoConformidades).filter(function(r) {
      return r.conferenciaOpKey === opKey || r.opKey === opKey || mesmoLote(r.loteOrigem) || mesmoLote(r.lote);
    }).sort(porData('abertaEm'));

    var granel = montarGranel(op);
    var totalApontado = apontamentos.reduce(function(s, r) { return s + num(r.qtdIncrementoConfirmado != null ? r.qtdIncrementoConfirmado : r.quantidade); }, 0);

    return {
      opKey: opKey, op: op, lote: lote, granel: granel,
      apontamentos: apontamentos, totalApontado: totalApontado,
      paradas: paradas, perdas: perdas, consumos: consumos,
      paletes: paletes, conferenciaPa: conferenciaPa, contagensPa: contagensPa, rncs: rncs,
      linhaDoTempo: linhaDoTempo(op, granel, apontamentos, paradas, contagensPa, paletes, rncs)
    };
  }

  // Tudo o que aconteceu, em ordem: é o que um auditor lê primeiro.
  function linhaDoTempo(op, granel, apontamentos, paradas, contagensPa, paletes, rncs) {
    var ev = [];
    var add = function(em, etapa, oque, quem) { if (em) ev.push({em: em, etapa: etapa, oque: oque, quem: quem || null}); };
    add(op.dataEmissao, 'OP', 'OP emitida (' + num(op.qtdPlanejada) + ' un planejadas)', op.emitidoPor);
    if (granel.existe) {
      add(granel.pesagem.inicio, 'Pesagem', 'Pesagem iniciada', granel.pesagem.por);
      granel.linhas.forEach(function(l) {
        l.todasParcelas.forEach(function(p) {
          add(p.em, 'Pesagem', (p.ordem ? p.ordem + 'ª pesagem' : 'Pesagem') + ' de ' + l.mpCodigo + ': ' + num(p.peso) + ' ' + l.unidade + ' (lote ' + (p.loteMaterial || '—') + ')' + (p.foto ? ' com foto' : ' SEM FOTO'), p.por);
          if (p.canceladaEm) add(p.canceladaEm, 'Pesagem', 'Pesagem de ' + l.mpCodigo + ' (' + num(p.peso) + ' ' + l.unidade + ') cancelada: ' + (p.motivoCancelamento || ''), p.canceladaPor);
        });
      });
      add(granel.pesagem.fim, 'Pesagem', 'Pesagem fechada; estoque baixado (' + granel.resumo.pesadoTotal + ' kg)', granel.pesagem.por);
      add(granel.conferencia.em, 'Conferência', 'Pesagem conferida', granel.conferencia.por);
      add(granel.manipulacao.inicio, 'Manipulação', 'Manipulação iniciada', granel.manipulacao.por);
      add(granel.manipulacao.fim, 'Manipulação', 'Manipulação fechada' + (granel.manipulacao.rendimento != null ? ' (rendimento ' + num(granel.manipulacao.rendimento) + ' kg)' : ''), granel.manipulacao.fechadoPor || granel.manipulacao.por);
      if (granel.analise) add(granel.analise.em, 'Qualidade', 'Granel ' + (granel.analise.decisao === 'LIBERADO' ? 'liberado' : granel.analise.decisao === 'REPROVADO' ? 'reprovado' : granel.analise.decisao || 'analisado'), granel.analise.por);
    }
    add(op.dataInicioReal, 'Envase', 'Início do envase' + (op.linha ? ' na ' + op.linha : ''), null);
    apontamentos.forEach(function(r) {
      add(r.timestamp, 'Envase', 'Apontamento: ' + num(r.qtdIncrementoConfirmado != null ? r.qtdIncrementoConfirmado : r.quantidade) + ' un' + (r.tipo === 'fechamento_op' ? ' (fechamento)' : ''), r.operador);
    });
    paradas.forEach(function(p) { add(p.inicio, 'Envase', 'Parada: ' + (p.motivo || '—') + ' (' + num(p.duracao) + ' min)', null); });
    add(op.dataFimReal, 'Envase', 'Fim do envase (' + num(op.produzido) + ' un)', null);
    add(op.confirmadoEm, 'OP', 'OP confirmada/encerrada', op.confirmadoPor);
    contagensPa.forEach(function(c) { add(c.contadoEm, 'Logística', 'Contagem de PA: ' + num(c.total) + ' un', c.contadoPor); });
    paletes.forEach(function(l) {
      var q = l.qualidade;
      if (q) add(q.inspecionadoEm, 'Qualidade', 'Palete ' + (l.identificadorPalete || l.id) + ': ' + (q.decisao || '—'), q.inspecionadoPor);
    });
    rncs.forEach(function(r) { add(r.abertaEm, 'Qualidade', 'RNC ' + (r.numero || r.id) + ' aberta' + (r.classificacao ? ' (' + r.classificacao + ')' : ''), r.abertaPor); });
    return ev.sort(porData('em'));
  }

  return {
    normalizar: normalizar, compacto: compacto, buscar: buscar, acharOp: acharOp,
    montar: montar, montarGranel: montarGranel
  };
});
