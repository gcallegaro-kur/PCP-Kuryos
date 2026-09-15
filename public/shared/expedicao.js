(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExpedicaoPA = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  function key(v) { return String(v || '').trim().replace(/[./[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60); }
  function analisar(base, itemKey, loteKey, hoje) {
    var lote = (base.estoque_lotes[itemKey] || {})[loteKey] || {};
    var op = (base.ops || {})[lote.opKey] || {};
    var skuPedidoKey = lote.skuPedidoKey || op.skuPedidoKey || '';
    var demanda = (base.pedidos || {})[skuPedidoKey] || {};
    var pedidoId = demanda.parentPedidoId || key(demanda.id);
    var comercial = (base.pedidos_comerciais || {})[pedidoId];
    var conf = (base.conferencias_pa || {})[lote.opKey] || {};
    var endereco = (base.enderecos_estoque || {})[lote.enderecoKey];
    // Palete LEGADO: produto acabado que já estava físico no galpão antes do
    // WMS existir, importado da planilha "Controle de Entradas, Saidas e
    // Estoque". A Conferência de PA e o laudo da Qualidade nunca aconteceram
    // no sistema -- exigi-los aqui obrigaria a FORJAR esses registros na
    // importação, que é o que não se pode fazer. Então esses dois portões são
    // dispensados e só para essa origem; todos os outros (saldo, validade,
    // endereço ativo, OP concluída, vínculo do pedido, cancelamento) continuam
    // valendo igual. A origem fica à vista: status LEGADO_ESTOQUE e
    // identificador com prefixo LEG-.
    var legado = lote.origemTipo === 'legado_planilha' && lote.legado === true;
    var origemValida = lote.origemTipo === 'conferencia_pa' || legado;
    var vinculoGravado = legado ? lote.skuPedidoKeyOrigem : lote.skuPedidoKey;
    var motivo = '';
    if (lote.itemTipo !== 'produto' || !origemValida || !lote.identificadorPalete) motivo = 'Sem palete de PA conferido';
    else if (!Number.isInteger(Number(lote.saldoLote)) || Number(lote.saldoLote) <= 0 || lote.expedicaoId) motivo = 'Sem saldo disponível';
    else if (!legado && !['LIBERADO_EXPEDICAO', 'APROVADO_CONCESSAO'].includes(lote.status)) motivo = 'Aguardando liberação da Qualidade';
    else if (!legado && (!lote.qualidade || lote.qualidade.decisao !== lote.status)) motivo = 'Laudo da Qualidade ausente ou divergente';
    else if (lote.validade && String(lote.validade).slice(0, 10) < hoje) motivo = 'Palete vencido';
    else if (!endereco || endereco.ativo === false || lote.aguardandoEnderecoDefinitivo) motivo = 'Aguardando endereço definitivo ativo';
    else if (op.status !== 'Concluído' || op.sku !== lote.itemCodigo || key(op.sku) !== itemKey) motivo = 'OP ou produto inconsistente';
    else if (!legado && (!conf.finalizadoEm || !lote.conferencia || conf.finalizacaoId !== lote.conferencia.finalizacaoId)) motivo = 'Conferência de PA não finalizada';
    else if (!skuPedidoKey || !pedidoId || demanda.sku !== lote.itemCodigo || !demanda.cliente) motivo = 'Pedido de origem ausente; regularize o vínculo da OP no PCP';
    // No palete legado, skuPedidoKey guarda a chave RECONSTRUÍDA (a que existe
    // em /pedidos); a da OP é a antiga, sem zero à esquerda. Comparar as duas
    // acusaria mudança de vínculo em todo palete importado. O que se compara
    // então é skuPedidoKeyOrigem, a chave da OP no momento da importação --
    // a proteção continua valendo, contra o campo certo.
    else if (vinculoGravado && op.skuPedidoKey !== vinculoGravado) motivo = 'Vínculo do pedido mudou após a conferência';
    else if ([demanda.status, demanda.pedidoComercialStatus, comercial && comercial.status].some(function(s) { return /cancelad/i.test(s || ''); })) motivo = 'Pedido cancelado';
    else if (comercial && !Object.values(comercial.itens || {}).some(function(i) { return i.sku === lote.itemCodigo; })) motivo = 'Produto não consta no pedido comercial';
    var pedido = comercial || demanda;
    return {itemKey: itemKey, loteKey: loteKey, lote: lote, op: op, demanda: demanda, comercial: comercial || null,
      skuPedidoKey: skuPedidoKey, pedidoId: pedidoId, pedidoNumero: pedido.numeroFormatado || demanda.id || pedidoId,
      cliente: pedido.cliente || op.cliente || '', clienteKey: pedido.clienteKey || '',
      frete: pedido.frete || {}, endereco: endereco || {}, motivo: motivo, disponivel: !motivo, legado: legado};
  }
  function listar(base, hoje) {
    var linhas = [];
    Object.entries(base.estoque_lotes || {}).forEach(function(item) {
      Object.entries(item[1] || {}).forEach(function(entry) {
        if (entry[1].itemTipo === 'produto' && Number(entry[1].saldoLote) > 0) linhas.push(analisar(base, item[0], entry[0], hoje));
      });
    });
    return linhas.sort(function(a, b) { return Number(b.disponivel) - Number(a.disponivel) || String(a.lote.validade || '9999').localeCompare(String(b.lote.validade || '9999')) || String(a.lote.identificadorPalete).localeCompare(String(b.lote.identificadorPalete)); });
  }
  return {analisar: analisar, listar: listar};
});
