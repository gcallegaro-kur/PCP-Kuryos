/* Separação consolidada por material (2026-09-25).
   Pedido do usuário: "se tenho várias OPs, ainda que de SKUs diferentes, que
   demandem o mesmo frasco, eu solicito a quantidade total de frascos (olhando
   prioridades a partir do planejamento)".

   Funções PURAS (sem Firebase): a tela separacao_materiais.html lê os dados e
   grava; aqui só se decide ordem, soma e de qual lote sai cada parte.

   Por que a soma NÃO é um FEFO único do total: material de cliente só serve à
   OP daquele cliente (sugerirAlocacaoFefo). Então o plano roda OP a OP, na
   ordem do planejamento, descontando de um saldo simulado -- e só depois soma
   por material/endereço. O separador vê um total por posição; por baixo, cada
   parte continua amarrada à sua OP (origemRef do pedaço separado), que é o que
   a pesagem e o consumo usam para achar o material da OP.

   Se a posição tiver menos do que o total (ou o separador pegar menos), quem
   fica sem é a OP de MENOR prioridade -- `distribuir`. */
(function (raiz) {
  'use strict';

  var ENCERRADAS = { 'Cancelado': 1, 'Concluído': 1, 'Aguardando Confirmação': 1 };
  var r3 = function (n) { return Math.round((Number(n) || 0) * 1000) / 1000; };

  // Grupo 0: já está na linha (precisa do material agora). Grupo 1: tem data
  // programada no Planejamento. Grupo 2: emitida sem programação -- vai por
  // último, na ordem de emissão.
  function prioridadeOp(op) {
    op = op || {};
    var emLinha = op.abertaDesde || op.dataInicioReal;
    if (emLinha) return { grupo: 0, data: String(emLinha), rotulo: 'Em produção' + (op.abertaLinha || op.linha ? ' · ' + (op.abertaLinha || op.linha) : '') };
    if (op.dataInicioPlanejada) return { grupo: 1, data: String(op.dataInicioPlanejada), rotulo: 'Programada' + (op.linha ? ' · ' + op.linha : '') };
    return { grupo: 2, data: String(op.dataEmissao || ''), rotulo: 'Sem programação' };
  }

  function compararOps(a, b) {
    var pa = prioridadeOp(a.op), pb = prioridadeOp(b.op);
    if (pa.grupo !== pb.grupo) return pa.grupo - pb.grupo;
    if (pa.data !== pb.data) return pa.data < pb.data ? -1 : 1;
    var la = String(a.op.lote || a.opKey), lb = String(b.op.lote || b.opKey);
    return la < lb ? -1 : (la > lb ? 1 : 0);
  }

  // O que ainda falta separar desta OP, só embalagem (origem 'bom' -- mesmo
  // escopo da separação por OP). Desconta o que separações consolidadas
  // anteriores já levaram (separacaoParcial). OP marcada como separada não
  // pede mais nada, igual à lista "Pendentes" da tela.
  function necessidadeRestante(op) {
    if (!op || op.separacaoConcluida) return [];
    var ja = (op.separacaoParcial && op.separacaoParcial.itens) || {};
    var porMp = {};
    Object.keys(op.materiaisConsumo || {}).forEach(function (k) {
      var it = op.materiaisConsumo[k];
      if (!it || it.origem !== 'bom' || !it.mpCodigo) return;
      var m = porMp[it.mpCodigo] || (porMp[it.mpCodigo] = { mpCodigo: it.mpCodigo, mpNome: it.mpNome || '', unidade: it.unidade || '', quantidade: 0 });
      m.quantidade += Number(it.quantidade) || 0;
    });
    return Object.keys(porMp).map(function (cod) {
      var m = porMp[cod];
      m.quantidade = r3(Math.max(0, m.quantidade - (Number(ja[cod]) || 0)));
      return m;
    }).filter(function (m) { return m.quantidade > 0; });
  }

  // OPs que entram na visão: abertas, com BOM de embalagem pendente, com início
  // até `ate` (YYYY-MM-DD, inclusive). OPs já na linha entram sempre; as sem
  // programação só com `incluirSemData`.
  function opsNoHorizonte(ops, ate, incluirSemData) {
    return Object.keys(ops || {}).map(function (k) { return { opKey: k, op: ops[k] }; })
      .filter(function (e) {
        var op = e.op;
        if (!op || !op.materiaisConsumo || ENCERRADAS[op.status]) return false;
        if (!necessidadeRestante(op).length) return false;
        var p = prioridadeOp(op);
        if (p.grupo === 0) return true;
        if (p.grupo === 2) return !!incluirSemData;
        return !ate || p.data.slice(0, 10) <= ate;
      })
      .sort(compararOps);
  }

  // entradas: [{opKey, op, clienteKey}] JÁ na ordem de prioridade.
  // lotesPorItem: estoque_lotes (por itemKey). fefo: sugerirAlocacaoFefo.
  function planejar(entradas, lotesPorItem, bloqueados, fefo, sanitizeKey) {
    var saldoSim = {}; // itemKey -> loteKey -> saldo ainda livre na simulação
    var materiais = {}; var ordemMat = [];

    entradas.forEach(function (e, idx) {
      necessidadeRestante(e.op).forEach(function (n) {
        var itemKey = sanitizeKey(n.mpCodigo);
        var lotes = lotesPorItem[itemKey] || {};
        if (!saldoSim[itemKey]) saldoSim[itemKey] = {};
        // Pedaço já separado (origemTipo separacao_op) está na fábrica, com
        // dono: não é origem para separar de novo.
        var vista = {};
        Object.keys(lotes).forEach(function (lk) {
          var l = lotes[lk];
          if (!l || l.origemTipo === 'separacao_op') return;
          var livre = saldoSim[itemKey][lk] != null ? saldoSim[itemKey][lk] : (Number(l.saldoLote) || 0);
          var copia = {}; Object.keys(l).forEach(function (c) { copia[c] = l[c]; });
          copia.saldoLote = livre;
          vista[lk] = copia;
        });
        var plano = fefo(n.mpCodigo, n.quantidade, vista, bloqueados || {}, { clienteKey: e.clienteKey || null });

        var mat = materiais[n.mpCodigo];
        if (!mat) {
          mat = materiais[n.mpCodigo] = { mpCodigo: n.mpCodigo, mpNome: n.mpNome, unidade: n.unidade, necessario: 0, alocado: 0, faltante: 0, ops: [], linhas: {} , ordemLinhas: [] };
          ordemMat.push(n.mpCodigo);
        }
        var alocadoOp = 0;
        plano.alocacoes.forEach(function (a) {
          saldoSim[itemKey][a.loteKey] = r3((vista[a.loteKey].saldoLote || 0) - a.qtdSugerida);
          alocadoOp += a.qtdSugerida;
          var lin = mat.linhas[a.loteKey];
          if (!lin) {
            lin = mat.linhas[a.loteKey] = { loteKey: a.loteKey, enderecoKey: a.enderecoKey, enderecoCodigo: a.enderecoCodigo,
              dataValidade: a.dataValidade, loteInterno: (lotes[a.loteKey] || {}).loteInterno || null, doCliente: a.doCliente || null, qtd: 0, partes: [] };
            mat.ordemLinhas.push(a.loteKey);
          }
          lin.qtd = r3(lin.qtd + a.qtdSugerida);
          lin.partes.push({ opKey: e.opKey, opLote: e.op.lote || e.opKey, prioridade: idx, qtd: a.qtdSugerida });
        });
        alocadoOp = r3(alocadoOp);
        mat.necessario = r3(mat.necessario + n.quantidade);
        mat.alocado = r3(mat.alocado + alocadoOp);
        mat.faltante = r3(mat.necessario - mat.alocado);
        mat.ops.push({ opKey: e.opKey, opLote: e.op.lote || e.opKey, produto: e.op.produto || e.op.sku || '', sku: e.op.sku || '',
          prioridade: prioridadeOp(e.op), necessario: n.quantidade, alocado: alocadoOp, faltante: r3(n.quantidade - alocadoOp) });
      });
    });

    return ordemMat.map(function (cod) {
      var m = materiais[cod];
      // Rota do separador: FEFO já ordenou dentro de cada OP; aqui ordena as
      // posições pelo endereço para uma volta só no galpão.
      m.linhas = m.ordemLinhas.map(function (lk) { return m.linhas[lk]; })
        .sort(function (a, b) { var x = a.enderecoCodigo || '', y = b.enderecoCodigo || ''; return x < y ? -1 : (x > y ? 1 : 0); });
      delete m.ordemLinhas;
      return m;
    });
  }

  // O separador informou `qtdInformada` numa posição que o plano repartia em
  // `partes`. Menos que o plano: a falta cai nas OPs de menor prioridade.
  // Mais que o plano: limita ao plano (sobra não tem dono).
  function distribuir(partes, qtdInformada) {
    var resta = Math.max(0, Number(qtdInformada) || 0);
    return partes.slice().sort(function (a, b) { return a.prioridade - b.prioridade; }).map(function (p) {
      var q = r3(Math.min(p.qtd, resta));
      resta = r3(resta - q);
      var out = {}; Object.keys(p).forEach(function (c) { out[c] = p[c]; });
      out.qtd = q;
      return out;
    });
  }

  var api = { prioridadeOp: prioridadeOp, compararOps: compararOps, necessidadeRestante: necessidadeRestante,
    opsNoHorizonte: opsNoHorizonte, planejar: planejar, distribuir: distribuir };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  raiz.SeparacaoConsolidada = api;
})(typeof window !== 'undefined' ? window : globalThis);
