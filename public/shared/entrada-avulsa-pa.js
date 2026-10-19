/* Entrada avulsa de produto acabado (sem OP, sem carga de origem).

   Pedido do usuário (22/10/2026): chegou devolução de um item antigo, sem OP e
   sem saída registrada no sistema, e não havia como fazê-lo aparecer como
   estoque de PA. Decisões dele:
   - passa pelo LAUDO da Qualidade antes de valer como estoque;
   - é estoque PRÓPRIO da Kuryos, que será vendido a OUTRO cliente;
   - se sabe cliente de origem, NF de devolução, lote e validade;
   - acontece de vez em quando, então vira tela, não script.

   Como funciona:
   1. A Logística lança o palete: nasce em QUARENTENA, sem pedido, com origem
      `entrada_avulsa_pa`. Nada em produção, OP, pedido ou conciliação é tocado.
   2. A Qualidade laudo como qualquer palete (fila avulsa — não há OP para
      agrupar por lote).
   3. Liberado, aparece no estoque de PA (WMS, Consulta de Estoque, Kardex).
   4. Para vender, vincula-se o palete a um PEDIDO do mesmo SKU (vincular()).
      Na saída, o servidor credita o pedido como "atendido por estoque"
      (`produzido` e `atendidoPorEstoque`), porque a unidade não passou pela
      linha: sem isso o pedido atendido continuaria aberto para sempre.

   Funções PURAS (validar, montarPalete, candidatosPedido, validarVinculo) e
   duas que gravam (registrar, vincular/desvincular), com banco injetado. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EntradaAvulsaPA = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var ORIGEM = 'entrada_avulsa_pa';
  var MOTIVOS = {
    DEVOLUCAO_SEM_ORIGEM: 'Devolução de cliente sem origem no sistema (item antigo)',
    SOBRA_ESTOQUE: 'Produto acabado encontrado / sobra sem registro',
    OUTRO: 'Outro'
  };
  var MOTIVO_MINIMO = 10;

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function texto(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 500); }
  function sanitizeKey(s) { return !s ? '' : String(s).trim().replace(/[./[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60); }
  function dataValida(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
    var d = new Date(s + 'T00:00:00Z');
    return isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function ehAvulso(l) { return !!l && l.origemTipo === ORIGEM; }

  // Produto pelo SKU (chave do nó ou campo sku, sem diferenciar caixa).
  function acharProduto(produtos, sku) {
    var alvo = String(sku || '').trim().toUpperCase(), achado = null;
    Object.keys(produtos || {}).some(function(k) {
      var p = produtos[k] || {};
      if (String(k).toUpperCase() === alvo || String(p.sku || '').toUpperCase() === alvo) { achado = {key: k, produto: p}; return true; }
      return false;
    });
    return achado;
  }

  /* dados: {sku, qtd, unidadesPorCaixa, loteOrigem, validade, enderecoKey,
     motivoTipo, motivo, clienteOrigem, nfDevolucao, idempotencyKey}
     ctx: {produtos, enderecos, hoje}.  Devolve {erros:[], produto, endereco, caixas}. */
  function validar(dados, ctx) {
    var d = dados || {}, c = ctx || {}, erros = [];
    var ach = acharProduto(c.produtos, d.sku);
    if (!ach) erros.push('Escolha um produto cadastrado.');
    var qtd = n(d.qtd);
    if (!(qtd > 0) || Math.floor(qtd) !== qtd) erros.push('Informe a quantidade em unidades (número inteiro maior que zero).');
    var mult = d.unidadesPorCaixa === '' || d.unidadesPorCaixa == null ? 0 : n(d.unidadesPorCaixa);
    if (d.unidadesPorCaixa !== '' && d.unidadesPorCaixa != null && (!(mult > 0) || Math.floor(mult) !== mult)) erros.push('Unidades por caixa deve ser um inteiro maior que zero.');
    if (!texto(d.loteOrigem)) erros.push('Informe o lote que está na caixa (a rastreabilidade depende dele).');
    if (!dataValida(d.validade)) erros.push('Informe a validade (AAAA-MM-DD).');
    else if (c.hoje && d.validade < c.hoje) erros.push('Produto com validade vencida não entra como estoque.');
    var end = (c.enderecos || {})[d.enderecoKey];
    if (!d.enderecoKey || !end || end.ativo === false) erros.push('Escolha um endereço ativo.');
    if (!MOTIVOS[d.motivoTipo]) erros.push('Escolha o tipo de motivo.');
    if (texto(d.motivo).length < MOTIVO_MINIMO) erros.push('Descreva o motivo (mínimo ' + MOTIVO_MINIMO + ' caracteres).');
    if (d.motivoTipo === 'DEVOLUCAO_SEM_ORIGEM' && !texto(d.clienteOrigem)) erros.push('Informe o cliente que devolveu.');
    var caixas = {fechadas: 0, parcial: 0};
    if (qtd > 0 && mult > 0) { caixas.fechadas = Math.floor(qtd / mult); caixas.parcial = qtd - caixas.fechadas * mult; }
    else if (qtd > 0) { caixas.fechadas = 0; caixas.parcial = 0; }
    return {erros: erros, produto: ach, endereco: end || null, caixas: caixas, mult: mult};
  }

  // Registro do palete + movimento. PURA: recebe o produto/endereço já resolvidos.
  function montarPalete(dados, validado, autor, agora) {
    var d = dados, p = validado.produto.produto, end = validado.endereco;
    var itemKey = sanitizeKey(validado.produto.key);
    var loteKey = 'avu_' + sanitizeKey(d.idempotencyKey);
    var ident = 'AV-' + sanitizeKey(d.loteOrigem).replace(/_/g, '-').slice(0, 24) + '-' + sanitizeKey(d.idempotencyKey).slice(0, 6).toUpperCase();
    var qtd = n(d.qtd);
    var palete = {
      itemTipo: 'produto', itemCodigo: p.sku || validado.produto.key, itemNome: p.descricao || null, unidade: 'un',
      loteOrigem: texto(d.loteOrigem, 60), identificadorPalete: ident, paleteNumero: 1,
      caixasFechadas: validado.caixas.fechadas, unidadesPorCaixa: validado.mult > 0 ? validado.mult : null,
      unidadesCaixaParcial: validado.caixas.parcial, saldoLote: qtd, qtdOriginal: qtd,
      enderecoKey: d.enderecoKey, enderecoCodigo: end.codigo || d.enderecoKey,
      validade: d.validade, dataValidade: d.validade,
      origemTipo: ORIGEM, origemRef: texto(d.nfDevolucao, 60) || null, status: 'QUARENTENA',
      propriedade: {tipo: 'KURYOS'},
      entradaAvulsa: {motivoTipo: d.motivoTipo, motivo: texto(d.motivo, 2000), clienteOrigem: texto(d.clienteOrigem, 120) || null,
        nfDevolucao: texto(d.nfDevolucao, 60) || null, lancadaPor: autor || null, lancadaEm: agora},
      criadoEm: agora, atualizadoEm: agora, criadoPor: autor || null
    };
    var movimento = {
      tipo: ORIGEM, motivo: 'ENTRADA AVULSA DE PA — ' + MOTIVOS[d.motivoTipo].toUpperCase() + ' (QUARENTENA)', qtd: qtd, saldoApos: qtd,
      ref: texto(d.nfDevolucao, 60) || null, loteKey: loteKey, enderecoKey: d.enderecoKey, enderecoCodigo: end.codigo || d.enderecoKey,
      itemTipo: 'produto', itemCodigo: palete.itemCodigo, itemNome: palete.itemNome, unidade: 'un', autor: autor || null, em: agora
    };
    return {itemKey: itemKey, loteKey: loteKey, palete: palete, movimento: movimento};
  }

  /* Grava. A chave do palete vem da idempotência: repetir o mesmo envio (duplo
     clique, rede ruim) não cria um segundo palete. */
  function registrar(dbRef, dados, ctx, autor) {
    var v = validar(dados, ctx);
    if (v.erros.length) return Promise.resolve({ok: false, erros: v.erros});
    if (!/^[A-Za-z0-9_-]{12,80}$/.test(dados.idempotencyKey || '')) return Promise.resolve({ok: false, erros: ['Identificador da operação inválido.']});
    var agora = new Date().toISOString();
    var m = montarPalete(dados, v, autor, agora);
    var ref = dbRef.ref('estoque_lotes/' + m.itemKey + '/' + m.loteKey);
    return ref.once('value').then(function(s) {
      if (s.val()) return {ok: true, repetida: true, itemKey: m.itemKey, loteKey: m.loteKey, identificador: s.val().identificadorPalete};
      var u = {};
      u['estoque_lotes/' + m.itemKey + '/' + m.loteKey] = m.palete;
      u['movimentos_estoque/' + m.itemKey + '/' + m.loteKey] = m.movimento;
      return dbRef.ref().update(u).then(function() {
        return {ok: true, repetida: false, itemKey: m.itemKey, loteKey: m.loteKey, identificador: m.palete.identificadorPalete};
      });
    });
  }

  function pedidoFechado(p) {
    p = p || {};
    return /encerrad|cancelad/i.test(p.statusManual || '') || p.canceladoPorComercial === true ||
      /cancelad/i.test(p.pedidoComercialStatus || '') || /encerr|cancel/i.test(p.status || '');
  }

  // Pedidos que podem receber este palete: mesmo SKU, abertos, com cliente.
  function candidatosPedido(base, palete) {
    var pedidos = (base && base.pedidos) || {};
    return Object.keys(pedidos).filter(function(k) {
      var p = pedidos[k] || {};
      return String(p.sku || '') === String(palete.itemCodigo || '') && !!p.cliente && !pedidoFechado(p) && n(p.qtdTotal) - n(p.produzido) > 0;
    }).map(function(k) {
      var p = pedidos[k];
      return {key: k, id: p.id || k, cliente: p.cliente, produto: p.produto || '', qtdTotal: n(p.qtdTotal), produzido: n(p.produzido),
        saldo: Math.max(n(p.qtdTotal) - n(p.produzido), 0)};
    }).sort(function(a, b) { return String(a.cliente).localeCompare(String(b.cliente)) || String(a.id).localeCompare(String(b.id), undefined, {numeric: true}); });
  }

  function validarVinculo(base, itemKey, loteKey, pedidoKey) {
    var lote = ((base.estoque_lotes || {})[itemKey] || {})[loteKey];
    if (!lote) return 'Palete não encontrado.';
    if (!ehAvulso(lote)) return 'Só paletes de entrada avulsa são vinculados a pedido por aqui.';
    if (n(lote.saldoLote) <= 0 || lote.expedicaoId) return 'Este palete já foi expedido.';
    if (lote.status !== 'LIBERADO_EXPEDICAO' && lote.status !== 'APROVADO_CONCESSAO') return 'O palete ainda não foi liberado pela Qualidade.';
    var ped = (base.pedidos || {})[pedidoKey];
    if (!ped) return 'Escolha um pedido.';
    if (String(ped.sku || '') !== String(lote.itemCodigo || '')) return 'O pedido é de outro produto (' + (ped.sku || 'sem SKU') + ').';
    if (pedidoFechado(ped)) return 'O pedido está encerrado ou cancelado.';
    if (!ped.cliente) return 'O pedido não tem cliente.';
    return '';
  }

  function vincular(dbRef, base, itemKey, loteKey, pedidoKey, autor) {
    var erro = validarVinculo(base, itemKey, loteKey, pedidoKey);
    if (erro) return Promise.resolve({ok: false, erro: erro});
    var agora = new Date().toISOString(), ref = dbRef.ref('estoque_lotes/' + itemKey + '/' + loteKey);
    // Transaction: confere de novo no banco (a saída pode ter acontecido agora).
    return ref.transaction(function(l) {
      if (!l) return l;
      if (!ehAvulso(l) || n(l.saldoLote) <= 0 || l.expedicaoId) return;
      l.skuPedidoKey = pedidoKey;
      l.vinculoPedido = {pedidoKey: pedidoKey, por: autor || null, em: agora};
      l.atualizadoEm = agora;
      return l;
    }).then(function(r) {
      return r && r.committed ? {ok: true} : {ok: false, erro: 'O palete mudou enquanto você vinculava. Atualize e tente de novo.'};
    });
  }

  function desvincular(dbRef, itemKey, loteKey, autor) {
    var ref = dbRef.ref('estoque_lotes/' + itemKey + '/' + loteKey);
    return ref.transaction(function(l) {
      if (!l) return l;
      if (!ehAvulso(l) || l.expedicaoId || n(l.saldoLote) <= 0) return;
      l.skuPedidoKey = null; l.vinculoPedido = null; l.atualizadoEm = new Date().toISOString();
      return l;
    }).then(function(r) { return r && r.committed ? {ok: true} : {ok: false, erro: 'Não foi possível desvincular (palete já expedido?).'}; });
  }

  return {
    ORIGEM: ORIGEM, MOTIVOS: MOTIVOS, MOTIVO_MINIMO: MOTIVO_MINIMO, ehAvulso: ehAvulso, acharProduto: acharProduto,
    validar: validar, montarPalete: montarPalete, registrar: registrar, candidatosPedido: candidatosPedido,
    validarVinculo: validarVinculo, vincular: vincular, desvincular: desvincular
  };
});
