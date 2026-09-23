/* Devolução de cliente (GAP-02 de FLUXOS_DO_SISTEMA.md).

   Decisões do usuário (2026-09-23):
   - O COMERCIAL autoriza a devolução, ligada à carga (saída/NF) original, e a
     LOGÍSTICA recebe a mercadoria em QUARENTENA contra essa autorização.
   - Destinos: reintegrar ao estoque, retrabalho, descarte e reenvio ao cliente.
     Quem decide é a QUALIDADE, no laudo do palete devolvido, que cai sozinho
     na Fila de Inspeção como qualquer lote em quarentena:
       Liberar  -> reintegrado (volta a ser expedível; reenvio é expedir de novo)
       Reter    -> retrabalho (OP {lote}-RTn no Controle de OPs)
       Reprovar -> descarte (Descarte e Logística Reversa)
   - O pedido tem o EXPEDIDO ESTORNADO no recebimento físico: a unidade volta
     ao estoque, e a conta produzido = expedido + em estoque continua fechando.

   Fluxo de status: AUTORIZADA -> RECEBIDA (servidor, receberDevolucaoCliente)
   ou AUTORIZADA -> CANCELADA. Depois de RECEBIDA o andamento de cada item vem
   do próprio palete (situacao), sem status paralelo para manter em sincronia.

   Funções PURAS: sem DOM e sem Firebase. Cópia byte a byte em
   functions/devolucao_cliente.js (run_devolucao_cliente_test.js confere). */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DevolucaoCliente = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var MOTIVOS = {
    AVARIA_TRANSPORTE: 'Avaria no transporte',
    QUALIDADE: 'Problema de qualidade do produto',
    ERRO_PEDIDO: 'Erro de pedido ou de separação',
    COMERCIAL: 'Acordo comercial (troca, excesso)',
    OUTRO: 'Outro'
  };

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function fmt(v) { return n(v).toLocaleString('pt-BR'); }
  function texto(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 500); }
  function sanitizeKey(str) {
    if (!str) return '';
    return String(str).trim().replace(/[./[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60);
  }
  function lista(v) { return Array.isArray(v) ? v : Object.keys(v || {}).map(function(k) { return v[k]; }); }
  function entradas(v) { return Array.isArray(v) ? v.map(function(x, i) { return [String(i), x]; }) : Object.keys(v || {}).map(function(k) { return [k, v[k]]; }); }
  // "0014__X" e "14__X" são a mesma linha do backlog (mesma regra da Expedição).
  function normChave(k) {
    var p = texto(k).split('__');
    if (p.length < 2) return texto(k);
    return (/^\d+$/.test(p[0]) ? String(parseInt(p[0], 10)) : p[0]) + '__' + p.slice(1).join('__');
  }
  function resolverChave(pedidos, k) {
    if (!k) return '';
    if ((pedidos || {})[k]) return k;
    var alvo = normChave(k);
    var achadas = Object.keys(pedidos || {}).filter(function(c) { return normChave(c) === alvo; });
    return achadas.length === 1 ? achadas[0] : k;
  }

  /* Quanto de cada item de carga já está comprometido em devolução (autorizada
     conta pelo autorizado; recebida pelo que chegou; cancelada não conta). */
  function jaDevolvido(devolucoes, cargaKey, idx) {
    var total = 0;
    Object.keys(devolucoes || {}).forEach(function(k) {
      var d = devolucoes[k] || {};
      if (d.cargaKey !== cargaKey || d.status === 'CANCELADA') return;
      lista(d.itens).forEach(function(i) {
        if (!i || String(i.idx) !== String(idx)) return;
        total += d.status === 'RECEBIDA' ? n(i.qtdRecebida) : n(i.qtdAutorizada);
      });
    });
    return total;
  }

  /* Saídas físicas de um pedido comercial com o que ainda dá para devolver. */
  function saidasDoPedido(base, pedidoId) {
    var cargas = (base && base.expedicoes_comerciais) || {};
    var devolucoes = (base && base.devolucoes_cliente) || {};
    return Object.keys(cargas).map(function(ck) {
      var c = cargas[ck] || {};
      if (c.legado || /cancel/i.test(c.status || '')) return null;
      var doPedido = c.pedidoId === pedidoId || !!(c.pedidos && c.pedidos[pedidoId]);
      if (!doPedido) return null;
      var itens = entradas(c.itens).map(function(e) {
        var i = e[1] || {};
        if (i.pedidoId && i.pedidoId !== pedidoId) return null;
        var qtd = n(i.qtd);
        if (!(qtd > 0)) return null;
        return {idx: e[0], sku: i.sku || '', descricao: i.descricao || '', opKey: i.opKey || '', opLote: i.opLote || '',
          skuPedidoKey: i.skuPedidoKey || '', itemKey: i.itemKey || sanitizeKey(i.sku), identificadorPalete: i.identificadorPalete || '',
          validade: i.validade || null, qtd: qtd, devolvivel: Math.max(qtd - jaDevolvido(devolucoes, ck, e[0]), 0)};
      }).filter(Boolean);
      if (!itens.length) return null;
      return {cargaKey: ck, numero: c.numero || ck, data: c.data || '', nf: c.nf || '', serie: c.serie || '', itens: itens};
    }).filter(Boolean).sort(function(a, b) { return String(b.data).localeCompare(String(a.data)); });
  }

  /* dados: {pedidoId, cargaKey, itens: [{idx, qtd}], motivoTipo, motivo, nfDevolucao} */
  function validarAutorizacao(dados, base) {
    var d = dados || {}, erros = [];
    var pc = ((base && base.pedidos_comerciais) || {})[d.pedidoId];
    if (!pc) erros.push('Escolha o pedido.');
    var saida = pc ? saidasDoPedido(base, d.pedidoId).find(function(s) { return s.cargaKey === d.cargaKey; }) : null;
    if (pc && !saida) erros.push('Escolha a saída (carga) de onde a mercadoria volta.');
    var informado = false;
    (d.itens || []).forEach(function(r) {
      var q = Number(r.qtd);
      if (r.qtd === '' || r.qtd == null || q === 0) return;
      informado = true;
      var it = saida && saida.itens.find(function(i) { return String(i.idx) === String(r.idx); });
      if (!it) { erros.push('Item da carga não encontrado.'); return; }
      if (!Number.isInteger(q) || q < 0) { erros.push(it.sku + ': a quantidade tem que ser um número inteiro.'); return; }
      if (q > it.devolvivel) { erros.push(it.sku + ': só ' + fmt(it.devolvivel) + ' un. desta carga ainda podem voltar.'); return; }

    });
    if (saida && !informado) erros.push('Informe a quantidade de pelo menos um item.');
    if (!MOTIVOS[d.motivoTipo]) erros.push('Escolha o tipo de motivo.');
    if (texto(d.motivo).length < 10) erros.push('Descreva o motivo (pelo menos 10 caracteres).');
    return {ok: !erros.length, erros: erros, saida: saida};
  }

  function montarAutorizacao(dados, base, meta) {
    var d = dados || {}, m = meta || {};
    var pc = base.pedidos_comerciais[d.pedidoId];
    var saida = saidasDoPedido(base, d.pedidoId).find(function(s) { return s.cargaKey === d.cargaKey; });
    var itens = (d.itens || []).filter(function(r) { return Number(r.qtd) > 0; }).map(function(r) {
      var it = saida.itens.find(function(i) { return String(i.idx) === String(r.idx); });
      return {idx: it.idx, sku: it.sku, descricao: it.descricao, opKey: it.opKey, opLote: it.opLote, skuPedidoKey: it.skuPedidoKey,
        itemKey: it.itemKey, identificadorPalete: it.identificadorPalete, validade: it.validade, qtdAutorizada: Number(r.qtd)};
    });
    return {
      numero: m.numero, status: 'AUTORIZADA',
      pedidoComercialId: d.pedidoId, pedidoNumero: pc.numeroFormatado || d.pedidoId, numeroPedidoCliente: pc.numeroPedidoCliente || '',
      cliente: pc.cliente || '', clienteKey: pc.clienteKey || '',
      cargaKey: saida.cargaKey, cargaNumero: saida.numero, dataSaida: saida.data, nfOriginal: [saida.nf, saida.serie].filter(Boolean).join('/'),
      motivoTipo: d.motivoTipo, motivo: texto(d.motivo, 2000), nfDevolucao: texto(d.nfDevolucao, 60) || null,
      itens: itens, totalAutorizado: itens.reduce(function(s, i) { return s + i.qtdAutorizada; }, 0),
      autorizadoEm: m.agora, autorizadoPor: m.autor || '',
      historico: {a: {tipo: 'AUTORIZADA', em: m.agora, por: m.autor || ''}}
    };
  }

  function erro(code, message) { var e = new Error(message); e.code = code; throw e; }

  /* Recebimento físico. Roda no SERVIDOR (receberDevolucaoCliente): a
     Logística não escreve em pedidos/, e o estorno do expedido tem que ir no
     mesmo update da entrada do palete.
     ctx: {devKey, dev, pedidos, pedidoComercial, enderecos, dados: {itens: [{i, qtdRecebida, enderecoKey}], observacao, nfDevolucao}, autor, agora} */
  function prepararRecebimento(ctx) {
    var dev = ctx.dev, devKey = ctx.devKey, agora = ctx.agora, autor = ctx.autor || '';
    if (!dev) erro('not-found', 'Devolução não encontrada.');
    if (dev.status !== 'AUTORIZADA') erro('failed-precondition', 'Esta devolução não está aguardando recebimento (situação: ' + (dev.status || '—') + ').');
    var dados = ctx.dados || {}, pedidos = ctx.pedidos || {}, pc = ctx.pedidoComercial || null, enderecos = ctx.enderecos || {};
    var recebidos = {};
    (dados.itens || []).forEach(function(r) { recebidos[String(r.i)] = r; });
    var itens = lista(dev.itens);
    var updates = {}, total = 0, estornoPedido = {}, estornoComercial = {};
    var raiz = 'devolucoes_cliente/' + devKey + '/';
    itens.forEach(function(it, i) {
      var r = recebidos[String(i)] || {};
      var q = r.qtdRecebida === '' || r.qtdRecebida == null ? 0 : Number(r.qtdRecebida);
      if (!Number.isInteger(q) || q < 0) erro('invalid-argument', it.sku + ': quantidade recebida inválida.');
      if (q > n(it.qtdAutorizada)) erro('invalid-argument', it.sku + ': chegou mais (' + fmt(q) + ') do que o autorizado (' + fmt(it.qtdAutorizada) + '). Peça ao Comercial uma nova autorização para a diferença.');
      updates[raiz + 'itens/' + i + '/qtdRecebida'] = q;
      if (!q) return;
      var end = enderecos[r.enderecoKey];
      if (!r.enderecoKey || !end || end.ativo === false) erro('failed-precondition', it.sku + ': escolha um endereço ativo para o palete devolvido.');
      total += q;
      var itemKey = it.itemKey || sanitizeKey(it.sku);
      var loteKey = 'dev_' + sanitizeKey(devKey) + '_i' + i;
      var ident = String(dev.numero || devKey).replace(/[^A-Za-z0-9-]/g, '-') + '-I' + (i + 1);
      updates['estoque_lotes/' + itemKey + '/' + loteKey] = {
        itemTipo: 'produto', itemCodigo: it.sku, itemNome: it.descricao || null, unidade: 'un',
        skuPedidoKey: it.skuPedidoKey || null, cliente: dev.cliente || null,
        loteOrigem: it.opLote || null, opKey: it.opKey || null, opLote: it.opLote || null, identificadorPalete: ident,
        caixasFechadas: 0, unidadesPorCaixa: null, unidadesCaixaParcial: 0, saldoLote: q, qtdOriginal: q,
        enderecoKey: r.enderecoKey, enderecoCodigo: end.codigo || r.enderecoKey, validade: it.validade || null,
        origemTipo: 'devolucao_cliente', origemRef: devKey, status: 'QUARENTENA',
        devolucao: {id: devKey, numero: dev.numero || devKey, cargaKey: dev.cargaKey, motivoTipo: dev.motivoTipo, motivo: dev.motivo,
          identificadorPaleteOriginal: it.identificadorPalete || null, recebidaEm: agora, recebidaPor: autor},
        criadoEm: agora, atualizadoEm: agora, criadoPor: autor
      };
      updates['movimentos_estoque/' + itemKey + '/' + loteKey] = {
        tipo: 'devolucao_cliente', motivo: 'ENTRADA POR DEVOLUÇÃO DE CLIENTE (QUARENTENA)', qtd: q, saldoApos: q,
        ref: devKey, loteKey: loteKey, enderecoKey: r.enderecoKey, enderecoCodigo: end.codigo || r.enderecoKey,
        itemTipo: 'produto', itemCodigo: it.sku, itemNome: it.descricao || null, unidade: 'un',
        opKey: it.opKey || null, skuPedidoKey: it.skuPedidoKey || null, autor: autor, em: agora
      };
      updates[raiz + 'itens/' + i + '/itemKey'] = itemKey;
      updates[raiz + 'itens/' + i + '/loteKey'] = loteKey;
      updates[raiz + 'itens/' + i + '/enderecoKey'] = r.enderecoKey;
      var pk = resolverChave(pedidos, it.skuPedidoKey);
      if (pk && pedidos[pk]) estornoPedido[pk] = (estornoPedido[pk] || 0) + q;
      if (pc) {
        var ent = entradas(pc.itens).find(function(e) { return e[1] && e[1].sku === it.sku; });
        if (ent) estornoComercial[ent[0]] = (estornoComercial[ent[0]] || 0) + q;
      }
    });
    if (!(total > 0)) erro('invalid-argument', 'Informe o que chegou. Se nada chegou, não confirme o recebimento.');
    // Estorno do expedido: a unidade volta a ser estoque. "devolvido" fica
    // como informação ao lado (Gestão Comercial, conciliação).
    Object.keys(estornoPedido).forEach(function(pk) {
      var l = pedidos[pk] || {};
      updates['pedidos/' + pk + '/expedido'] = Math.max(n(l.expedido) - estornoPedido[pk], 0);
      updates['pedidos/' + pk + '/devolvido'] = n(l.devolvido) + estornoPedido[pk];
    });
    Object.keys(estornoComercial).forEach(function(ik) {
      var item = (entradas(pc.itens).find(function(e) { return e[0] === ik; }) || [])[1] || {};
      var base = 'pedidos_comerciais/' + dev.pedidoComercialId + '/itens/' + ik + '/';
      updates[base + 'expedido'] = Math.max(n(item.expedido) - estornoComercial[ik], 0);
      updates[base + 'devolvido'] = n(item.devolvido) + estornoComercial[ik];
    });
    updates[raiz + 'status'] = 'RECEBIDA';
    updates[raiz + 'totalRecebido'] = total;
    updates[raiz + 'recebimento'] = {em: agora, por: autor, observacao: texto(dados.observacao, 2000) || null,
      nfDevolucao: texto(dados.nfDevolucao, 60) || dev.nfDevolucao || null,
      divergente: total !== n(dev.totalAutorizado)};
    updates[raiz + 'historico/r'] = {tipo: 'RECEBIDA', em: agora, por: autor, total: total};
    if (dev.cargaKey) updates['expedicoes_comerciais/' + dev.cargaKey + '/devolucoes/' + devKey] = {numero: dev.numero || devKey, qtd: total, em: agora};
    if (dev.pedidoComercialId) updates['comercial_eventos/' + dev.pedidoComercialId + '/' + devKey + '_recebida'] = {tipo: 'DEVOLUCAO_RECEBIDA', devKey: devKey, total: total, em: agora, por: autor};
    return {updates: updates, total: total};
  }

  /* Andamento de cada item, lido do palete. estoqueLotes = estoque_lotes. */
  var ETAPAS = {
    AGUARDANDO_RECEBIMENTO: {rotulo: 'Aguardando recebimento na Logística', final: false},
    NAO_RECEBIDO: {rotulo: 'Não chegou', final: true},
    AGUARDANDO_QUALIDADE: {rotulo: 'Em quarentena — aguardando a Qualidade', final: false},
    REINTEGRADO: {rotulo: 'Reintegrado ao estoque (pode ser reenviado)', final: true},
    REENVIADO: {rotulo: 'Reenviado ao cliente', final: true},
    RETRABALHO: {rotulo: 'Retido — retrabalho', final: false},
    DESCARTE: {rotulo: 'Reprovado — segregar para descarte', final: false},
    DESCARTADO: {rotulo: 'Descartado', final: true},
    CANCELADA: {rotulo: 'Autorização cancelada', final: true}
  };
  function etapaItem(dev, it, estoqueLotes) {
    if (dev.status === 'CANCELADA') return 'CANCELADA';
    if (dev.status !== 'RECEBIDA') return 'AGUARDANDO_RECEBIMENTO';
    if (!(n(it.qtdRecebida) > 0)) return 'NAO_RECEBIDO';
    var l = ((estoqueLotes || {})[it.itemKey] || {})[it.loteKey];
    if (!l) return 'AGUARDANDO_QUALIDADE';
    if (l.status === 'EXPEDIDO' || l.expedicaoId) return 'REENVIADO';
    if (l.status === 'QUARENTENA') return 'AGUARDANDO_QUALIDADE';
    if (l.status === 'LIBERADO_EXPEDICAO' || l.status === 'APROVADO_CONCESSAO') return 'REINTEGRADO';
    if (l.status === 'RETIDO') return 'RETRABALHO';
    if (l.status === 'DESCARTADO') return 'DESCARTADO';
    if (l.status === 'REPROVADO' || l.status === 'AGUARDANDO_DESCARTE') return n(l.saldoLote) > 0 ? 'DESCARTE' : 'DESCARTADO';
    return n(l.saldoLote) > 0 ? 'AGUARDANDO_QUALIDADE' : 'DESCARTADO';
  }
  function situacao(dev, estoqueLotes) {
    var itens = lista((dev || {}).itens).map(function(it, i) {
      var e = etapaItem(dev, it, estoqueLotes);
      return {i: i, sku: it.sku, descricao: it.descricao, opLote: it.opLote, qtdAutorizada: n(it.qtdAutorizada),
        qtdRecebida: it.qtdRecebida == null ? null : n(it.qtdRecebida), itemKey: it.itemKey, loteKey: it.loteKey,
        etapa: e, rotulo: ETAPAS[e].rotulo, final: ETAPAS[e].final};
    });
    var concluida = itens.length > 0 && itens.every(function(i) { return i.final; });
    return {itens: itens, concluida: concluida,
      rotulo: dev.status === 'CANCELADA' ? 'Cancelada' : dev.status === 'AUTORIZADA' ? 'Autorizada — aguardando chegada'
        : concluida ? 'Concluída' : 'Recebida — em andamento'};
  }

  /* Devolvido por linha do backlog, para a conciliação e a Gestão Comercial. */
  function devolvidoPorPedido(devolucoes) {
    var out = {};
    Object.keys(devolucoes || {}).forEach(function(k) {
      var d = devolucoes[k] || {};
      if (d.status !== 'RECEBIDA') return;
      lista(d.itens).forEach(function(it) {
        var q = n(it && it.qtdRecebida);
        if (!(q > 0) || !it.skuPedidoKey) return;
        (out[it.skuPedidoKey] = out[it.skuPedidoKey] || []).push({devKey: k, numero: d.numero || k, qtd: q, opKey: it.opKey || null, opLote: it.opLote || null});
      });
    });
    return out;
  }

  return {MOTIVOS: MOTIVOS, ETAPAS: ETAPAS, saidasDoPedido: saidasDoPedido, validarAutorizacao: validarAutorizacao,
    montarAutorizacao: montarAutorizacao, prepararRecebimento: prepararRecebimento, situacao: situacao,
    devolvidoPorPedido: devolvidoPorPedido, jaDevolvido: jaDevolvido, sanitizeKey: sanitizeKey};
});
