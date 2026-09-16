/* Transferência de OP entre pedidos.

   Pedido do usuário (2026-09-16, conciliação de pedidos com o cliente): OPs
   já emitidas precisavam passar para o pedido certo. O lápis da tela de OPs
   só trocava ops/{lote}.parentPedidoId -- o número mostrado --, enquanto tudo
   que conta (apontamento, conciliação, expedição, planejamento) segue
   ops/{lote}.skuPedidoKey. E o produzido já apontado ficava no pedido antigo.

   Uma transferência move, com o mesmo id:
     ops/{op}.skuPedidoKey / parentPedidoId       vínculo da OP
     pedidos/{origem|destino}.produzido            produção da OP
     pedidos/{...}.apontamentosAplicados           registro por lote (dedupe)
     estoque_lotes paletes com saldo               senão a Expedição bloqueia
                                                   ("vínculo mudou após a
                                                   conferência")
     programacao futura com este lote              senão o apontador não acha
                                                   a OP pela grade
     alocacoes_planejamento                        devolve a capacidade do
                                                   pedido antigo (igual ao
                                                   cancelamento)

   Paletes já expedidos ficam no pedido antigo: a saída aconteceu contra ele.

   Quanto se move: os apontamentos que o pedido registrou com o lote desta OP
   (apontamentosAplicados) -- número exato. OP antiga, anterior a esse
   registro, não tem rastro por lote; aí vale o envase da OP, limitado à parte
   do produzido do pedido que também não tem rastro. Os dois números aparecem
   separados na tela antes de confirmar.

   Retomada: cada passo é idempotente pelo id da transferência. Se algo cair
   no meio, a OP fica com a transferência EM_ANDAMENTO e a tela oferece
   concluir com o mesmo id e os mesmos pedidos. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TransferenciaOP = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function arred(v) { return Math.round(n(v) * 1000) / 1000; }

  // "0014__SKU" e "14__SKU" são o mesmo pedido (a base tem os dois formatos).
  function normalizarChave(k) {
    var partes = String(k || '').split('__');
    if (partes.length < 2) return String(k || '');
    var id = /^\d+$/.test(partes[0]) ? String(parseInt(partes[0], 10)) : partes[0];
    return id + '__' + partes.slice(1).join('__');
  }
  function resolverChave(pedidos, k) {
    if (!k) return '';
    pedidos = pedidos || {};
    if (pedidos[k]) return k;
    var alvo = normalizarChave(k);
    var achadas = Object.keys(pedidos).filter(function(c) { return normalizarChave(c) === alvo; });
    return achadas.length === 1 ? achadas[0] : '';
  }

  function pedidoFechado(p) {
    p = p || {};
    return /encerrad|cancelad/i.test(p.statusManual || '') || p.canceladoPorComercial === true ||
      /cancelad/i.test(p.pedidoComercialStatus || '');
  }
  function produzidoEnvase(op) {
    op = op || {};
    return n(op.produzidoLinha != null ? op.produzidoLinha : op.produzido);
  }
  function aplicacoesDoLote(pedido, lote) {
    var todas = (pedido && pedido.apontamentosAplicados) || {}, doLote = {}, qtd = 0, totalRegistrado = 0;
    Object.keys(todas).forEach(function(id) {
      var a = todas[id] || {};
      totalRegistrado += n(a.quantidade);
      if (lote && String(a.lote || '') === String(lote)) { doLote[id] = a; qtd += n(a.quantidade); }
    });
    return {aplicacoes: doLote, qtd: arred(qtd), totalRegistrado: arred(totalRegistrado)};
  }
  // Parte da OP que o pedido não registrou por lote (OP anterior ao registro).
  function qtdSemRegistro(pedido, op) {
    if (!pedido) return 0;
    var reg = aplicacoesDoLote(pedido, op.lote);
    var faltaNaOp = Math.max(produzidoEnvase(op) - reg.qtd, 0);
    var semRastroNoPedido = Math.max(n(pedido.produzido) - reg.totalRegistrado, 0);
    return arred(Math.min(faltaNaOp, semRastroNoPedido));
  }

  function transferenciaPendente(op) {
    var t = (op && op.transferenciasPedido) || {};
    var id = Object.keys(t).find(function(k) { return t[k] && t[k].status === 'EM_ANDAMENTO'; });
    return id ? Object.assign({id: id}, t[id]) : null;
  }

  // Pedidos que podem receber a OP: mesmo SKU, abertos, diferentes da origem.
  function candidatosDestino(base, opKey) {
    var op = (base.ops || {})[opKey] || {}, pedidos = base.pedidos || {};
    var origem = normalizarChave(op.skuPedidoKey);
    return Object.keys(pedidos).filter(function(k) {
      var p = pedidos[k] || {};
      return p.sku && String(p.sku) === String(op.sku) && !pedidoFechado(p) && normalizarChave(k) !== origem;
    }).sort(function(a, b) {
      return String(pedidos[a].id || a).localeCompare(String(pedidos[b].id || b), undefined, {numeric: true});
    });
  }

  function paletesDaOp(estoqueLotes, opKey, lote) {
    var ativos = [], expedidos = 0;
    Object.keys(estoqueLotes || {}).forEach(function(itemKey) {
      Object.keys(estoqueLotes[itemKey] || {}).forEach(function(loteKey) {
        var l = estoqueLotes[itemKey][loteKey] || {};
        if (l.itemTipo !== 'produto') return;
        var daOp = l.opKey === opKey || l.origemRef === opKey || (lote && (l.opLote === lote || l.loteOrigem === lote));
        if (!daOp) return;
        if (n(l.saldoLote) > 0) ativos.push({itemKey: itemKey, loteKey: loteKey, saldo: n(l.saldoLote), legado: l.origemTipo === 'legado_planilha' && l.legado === true});
        else expedidos++;
      });
    });
    return {ativos: ativos, expedidos: expedidos};
  }

  /* Monta o que a transferência vai fazer, sem gravar nada.
     base: {ops, pedidos, estoque_lotes}; retomada: transferência EM_ANDAMENTO. */
  function planejar(base, opKey, destinoKeyInformado, retomada) {
    base = base || {};
    var pedidos = base.pedidos || {}, op = (base.ops || {})[opKey];
    var erros = [], avisos = [];
    if (!op) return {erros: ['OP não encontrada.'], avisos: avisos};
    if (op.status === 'Cancelado') erros.push('OP cancelada não é transferida.');

    var origemKey = retomada ? retomada.origem : resolverChave(pedidos, op.skuPedidoKey);
    var destinoKey = retomada ? retomada.destino : resolverChave(pedidos, destinoKeyInformado);
    var origem = origemKey ? pedidos[origemKey] : null, destino = destinoKey ? pedidos[destinoKey] : null;

    if (!destino) erros.push('Escolha um pedido de destino que exista.');
    else if (!retomada) {
      if (normalizarChave(destinoKey) === normalizarChave(op.skuPedidoKey)) erros.push('A OP já está neste pedido.');
      if (String(destino.sku || '') !== String(op.sku || '')) erros.push('O pedido de destino é de outro produto (' + (destino.sku || 'sem SKU') + ').');
      if (pedidoFechado(destino)) erros.push('O pedido de destino está encerrado ou cancelado.');
    }
    if (!retomada && op.skuPedidoKey && !origem) avisos.push('O pedido atual da OP (' + op.skuPedidoKey + ') não existe mais. Só o vínculo muda; nenhuma produção é somada ao destino.');
    if (!op.skuPedidoKey) avisos.push('A OP não tinha pedido. Só o vínculo é criado; a produção já apontada não é somada ao destino.');
    if (op.abertaDesde || op.abertaLinha || op.abertaDesdeRot || op.abertaRotulagem) {
      avisos.push('A OP está com apontamento aberto. Apontamento enviado durante a transferência pode cair no pedido antigo -- o ideal é transferir com a linha parada.');
    }

    var registrado = aplicacoesDoLote(origem, op.lote);
    var semRegistro = qtdSemRegistro(origem, op);
    if (semRegistro > 0) avisos.push(semRegistro.toLocaleString('pt-BR') + ' un desta OP são anteriores ao registro por lote; o número vem do envase da OP.');

    var paletes = paletesDaOp(base.estoque_lotes, opKey, op.lote);
    if (paletes.expedidos) avisos.push(paletes.expedidos + ' palete(s) desta OP já saíram e continuam contando no pedido antigo.');

    var qtd = arred(registrado.qtd + semRegistro);
    if (destino && n(destino.qtdTotal) > 0 && n(destino.produzido) + qtd > n(destino.qtdTotal)) {
      avisos.push('O destino passa a ter mais produzido (' + (n(destino.produzido) + qtd).toLocaleString('pt-BR') + ') que a quantidade do pedido (' + n(destino.qtdTotal).toLocaleString('pt-BR') + ').');
    }

    return {
      erros: erros, avisos: avisos, opKey: opKey, lote: op.lote || opKey, sku: op.sku || '',
      origemKey: origem ? origemKey : '', destinoKey: destino ? destinoKey : '',
      parentDestino: destino ? (destino.parentPedidoId || destino.id || '') : '',
      qtdRegistrada: registrado.qtd, qtdSemRegistro: semRegistro, qtd: qtd,
      paletes: paletes.ativos, saldoPaletes: arred(paletes.ativos.reduce(function(s, p) { return s + p.saldo; }, 0)),
      paletesExpedidos: paletes.expedidos
    };
  }

  // ── Funções de transaction (idempotentes pelo id) ─────────────────────
  // ctx: {id, lote, qtdSemRegistro, origemKey, destinoKey, em, por}.
  // aplicarSaida grava em ctx.movido o que saiu; aplicarEntrada usa isso.
  function aplicarSaida(pedido, ctx) {
    if (!pedido) { ctx.movido = {aplicacoes: {}, qtd: 0}; return pedido; }
    var feitas = pedido.transferenciasOP || {};
    if (feitas[ctx.id]) {
      ctx.movido = {aplicacoes: feitas[ctx.id].aplicacoes || {}, qtd: n(feitas[ctx.id].qtd)};
      return pedido;
    }
    var reg = aplicacoesDoLote(pedido, ctx.lote);
    var semRastro = Math.max(n(pedido.produzido) - reg.totalRegistrado, 0);
    var qtd = arred(reg.qtd + Math.min(n(ctx.qtdSemRegistro), semRastro));
    var restantes = Object.assign({}, pedido.apontamentosAplicados || {});
    Object.keys(reg.aplicacoes).forEach(function(id) { delete restantes[id]; });
    pedido.apontamentosAplicados = restantes;
    pedido.produzido = arred(Math.max(n(pedido.produzido) - qtd, 0));
    if (pedido.status === 'Concluído' && n(pedido.qtdTotal) > 0 && pedido.produzido < n(pedido.qtdTotal)) {
      pedido.status = pedido.produzido > 0 ? 'Produção Parcial' : 'Não Iniciado';
    }
    feitas[ctx.id] = {tipo: 'SAIDA', lote: ctx.lote, destino: ctx.destinoKey, qtd: qtd, aplicacoes: reg.aplicacoes, em: ctx.em, por: ctx.por};
    pedido.transferenciasOP = feitas;
    ctx.movido = {aplicacoes: reg.aplicacoes, qtd: qtd};
    return pedido;
  }

  function aplicarEntrada(pedido, ctx) {
    if (!pedido) return pedido;
    var feitas = pedido.transferenciasOP || {};
    if (feitas[ctx.id]) return pedido;
    var movido = ctx.movido || {aplicacoes: {}, qtd: 0};
    var aplicacoes = Object.assign({}, pedido.apontamentosAplicados || {});
    var jaTinha = 0;
    Object.keys(movido.aplicacoes || {}).forEach(function(id) {
      if (aplicacoes[id]) jaTinha += n(movido.aplicacoes[id].quantidade);
      else aplicacoes[id] = movido.aplicacoes[id];
    });
    var qtd = arred(Math.max(n(movido.qtd) - jaTinha, 0));
    pedido.apontamentosAplicados = aplicacoes;
    pedido.produzido = arred(n(pedido.produzido) + qtd);
    if (n(pedido.qtdTotal) > 0 && pedido.produzido >= n(pedido.qtdTotal) && !/cancelad/i.test(pedido.statusManual || '')) pedido.status = 'Concluído';
    else if ((!pedido.status || pedido.status === 'Não Iniciado') && pedido.produzido > 0) pedido.status = 'Produção Parcial';
    feitas[ctx.id] = {tipo: 'ENTRADA', lote: ctx.lote, origem: ctx.origemKey, qtd: qtd, em: ctx.em, por: ctx.por};
    pedido.transferenciasOP = feitas;
    return pedido;
  }

  // ── Atualizações multipath (relativas à raiz) ─────────────────────────
  function atualizacoesPaletes(plano) {
    var u = {};
    (plano.paletes || []).forEach(function(p) {
      var base = 'estoque_lotes/' + p.itemKey + '/' + p.loteKey + '/';
      u[base + 'skuPedidoKey'] = plano.destinoKey;
      // Palete legado compara skuPedidoKeyOrigem com a OP (expedicao_regras).
      if (p.legado) u[base + 'skuPedidoKeyOrigem'] = plano.destinoKey;
      u[base + 'atualizadoEm'] = plano.em || null;
    });
    return u;
  }

  // Slots de hoje (hora atual em diante) e futuros com este lote.
  function atualizacoesProgramacao(programacao, plano, hojeYMD, horaAtual) {
    var u = {}, origem = normalizarChave(plano.origemKey);
    Object.keys(programacao || {}).forEach(function(data) {
      if (data < hojeYMD) return;
      Object.keys(programacao[data] || {}).forEach(function(hora) {
        if (data === hojeYMD && parseInt(String(hora).split(/[_:]/)[0], 10) < horaAtual) return;
        var h = programacao[data][hora] || {};
        Object.keys(h).forEach(function(slotKey) {
          var s = h[slotKey];
          if (slotKey.indexOf('env') !== 0 || !s || typeof s !== 'object') return;
          if (String(s.lote || '') !== String(plano.lote)) return;
          if (origem && normalizarChave(s.pedidoKey) !== origem) return;
          u['programacao/' + data + '/' + hora + '/' + slotKey + '/pedidoKey'] = plano.destinoKey;
        });
      });
    });
    return u;
  }

  // Mesma regra do cancelamento de OP (ops.html): tira só a parte desta OP.
  function atualizacoesAlocacoes(alocacoes, lote, sanitize) {
    var u = {}, chave = sanitize ? sanitize(lote) : lote;
    Object.keys(alocacoes || {}).forEach(function(k) {
      var v = alocacoes[k];
      var vinc = v && v.opsVinculadas && v.opsVinculadas[chave];
      if (!vinc) return;
      u['alocacoes_planejamento/' + k + '/opsVinculadas/' + chave] = null;
      u['alocacoes_planejamento/' + k + '/qtdConsumida'] = Math.max(n(v.qtdConsumida) - n(vinc.qtd), 0);
      u['alocacoes_planejamento/' + k + '/status'] = 'congelado';
    });
    return u;
  }

  return {
    normalizarChave: normalizarChave, resolverChave: resolverChave, pedidoFechado: pedidoFechado,
    candidatosDestino: candidatosDestino, transferenciaPendente: transferenciaPendente, planejar: planejar,
    aplicarSaida: aplicarSaida, aplicarEntrada: aplicarEntrada,
    atualizacoesPaletes: atualizacoesPaletes, atualizacoesProgramacao: atualizacoesProgramacao,
    atualizacoesAlocacoes: atualizacoesAlocacoes
  };
});
