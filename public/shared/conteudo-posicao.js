/* Conteúdo de uma posição do WMS: itens, volumes, peso e quantidades.

   Pedido do usuário (2026-09-15): no mapa do WMS, clicar numa posição e
   enxergar o que está no palete -- itens, volumes, peso e quantidades. Antes o
   detalhe mostrava só item, lote, validade, status e saldo.

   Regras (nunca inventar número; sem dado, o valor é DESCONHECIDO, não zero):
   - Produto acabado: volumes pela composição do palete (caixas fechadas + a
     parcial, que conta como volume); peso pela mesma regra da Expedição
     (ExpedicaoGrade.pesoPalete: planilha > kg/cx do palete > kg/cx do cadastro).
   - Material: volumes = os do recebimento (qtdVolumes). Se parte do lote já
     saiu, avisa que eram os volumes do recebimento -- não rateia.
     Peso: unidade KG -> o próprio saldo; unidade L com densidade no cadastro
     -> saldo × densidade; unidade UN com pesoUnitario no cadastro (GRAMAS,
     cadastros.html) -> saldo × peso ÷ 1000. É o peso dos itens, sem a caixa. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./expedicao-grade.js'));
  else root.ConteudoPosicao = factory(root.ExpedicaoGrade);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(ExpedicaoGrade) {
  'use strict';

  function positivo(v) { var n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
  function arred(v, casas) { var f = Math.pow(10, casas == null ? 3 : casas); return Math.round(v * f) / f; }
  function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); }
  function porCodigo(dict, codigo, campo) {
    dict = dict || {};
    if (!codigo) return null;
    if (dict[codigo]) return dict[codigo];
    var chave = String(codigo).replace(/[.#$[\]\/]/g, '-');
    if (dict[chave]) return dict[chave];
    var k = Object.keys(dict).find(function(x) { return (dict[x] || {})[campo] === codigo; });
    return k ? dict[k] : null;
  }

  function pesoMaterial(lote, material) {
    var saldo = positivo(lote.saldoLote), un = norm(lote.unidade || (material || {}).unidade);
    if (saldo == null) return {kg: null, falta: 'saldo'};
    if (un === 'KG') return {kg: arred(saldo), fonte: 'QUANTIDADE_KG'};
    if (un === 'G') return {kg: arred(saldo / 1000), fonte: 'QUANTIDADE_KG'};
    if (un === 'L' || un === 'LT' || un === 'LITRO' || un === 'LITROS') {
      var dens = positivo((material || {}).densidade);
      return dens != null ? {kg: arred(saldo * dens), fonte: 'DENSIDADE'} : {kg: null, falta: 'densidade no cadastro do material'};
    }
    var gramas = positivo((material || {}).pesoUnitario);
    if (gramas != null) return {kg: arred(saldo * gramas / 1000), fonte: 'PESO_UNITARIO'};
    return {kg: null, falta: 'peso unitário no cadastro do material'};
  }

  function volumesMaterial(lote) {
    var receb = lote.recebimento || {}, n = positivo(receb.qtdVolumes);
    if (n == null) return {n: null, texto: null};
    var parcial = positivo(lote.qtdOriginal) != null && Number(lote.saldoLote) < Number(lote.qtdOriginal);
    return {n: n, parcial: parcial, texto: n + (n === 1 ? ' volume' : ' volumes') + (parcial ? ' no recebimento (parte do lote já saiu)' : '')};
  }

  function analisarLote(itemKey, loteKey, lote, cadastros) {
    lote = lote || {}; cadastros = cadastros || {};
    var pa = lote.itemTipo === 'produto', codigo = lote.itemCodigo || itemKey;
    var item = {
      itemKey: itemKey, loteKey: loteKey, tipo: pa ? 'PA' : 'MP', codigo: codigo, nome: lote.itemNome || '',
      lote: lote.identificadorPalete || lote.loteInterno || lote.loteOrigem || loteKey,
      // "NA"/"NÃO INFORMADO" é a ausência de lote do fornecedor, não um lote.
      loteFornecedor: !pa && lote.loteInterno && lote.loteOrigem && lote.loteOrigem !== lote.loteInterno &&
        !/^(NA|N\/A|NAO INFORMADO|SEM LOTE|-)$/.test(norm(lote.loteOrigem)) ? lote.loteOrigem : null,
      saldo: Number(lote.saldoLote) || 0, original: positivo(lote.qtdOriginal), unidade: lote.unidade || (pa ? 'un' : ''),
      status: lote.status || '', validade: lote.dataValidade || lote.validade || null,
      entrada: lote.dataRecebimento || lote.dataEntradaEstoque || lote.criadoEm || null
    };
    if (pa) {
      var produto = ExpedicaoGrade.produtoDoSku(cadastros.produtos, codigo), c = ExpedicaoGrade.composicao(lote);
      item.volumes = c.valida ? {n: c.volumes, texto: c.texto} : {n: null, texto: null, falta: 'composição das caixas'};
      item.peso = ExpedicaoGrade.pesoPalete(lote, produto);
      item.origem = [lote.opLote ? 'OP ' + lote.opLote : null, lote.cliente || null, lote.pedidoId ? 'pedido ' + lote.pedidoId : null].filter(Boolean).join(' · ');
    } else {
      var material = porCodigo(cadastros.materiais, codigo, 'mpCodigo'), receb = lote.recebimento || {};
      item.volumes = volumesMaterial(lote);
      item.peso = pesoMaterial(lote, material);
      item.origem = [receb.fornecedorNome || null, receb.notaFiscal ? 'NF ' + receb.notaFiscal : null].filter(Boolean).join(' · ');
    }
    return item;
  }

  // lotes: [{itemKey, loteKey, lote}] da posição. cadastros: {produtos, materiais}.
  function analisar(lotes, cadastros) {
    var itens = (lotes || []).filter(function(x) { return x && x.lote && Number(x.lote.saldoLote) > 0; })
      .map(function(x) { return analisarLote(x.itemKey, x.loteKey, x.lote, cadastros); })
      .sort(function(a, b) { return a.tipo.localeCompare(b.tipo) || a.codigo.localeCompare(b.codigo, 'pt-BR', {numeric: true}); });
    var porUnidade = {}, volumes = 0, semVolumes = 0, kg = 0, semPeso = 0;
    itens.forEach(function(i) {
      var u = i.unidade || '—';
      porUnidade[u] = arred((porUnidade[u] || 0) + i.saldo);
      if (i.volumes && i.volumes.n != null) volumes += i.volumes.n; else semVolumes++;
      if (i.peso && i.peso.kg != null) kg = arred(kg + i.peso.kg); else semPeso++;
    });
    return {itens: itens, totais: {itens: itens.length, porUnidade: porUnidade, volumes: volumes, semVolumes: semVolumes, kg: kg, semPeso: semPeso}};
  }

  // Lotes com saldo numa posição, a partir de estoque_lotes.
  function lotesDaPosicao(estoqueLotes, enderecoKey) {
    var out = [];
    Object.keys(estoqueLotes || {}).forEach(function(itemKey) {
      Object.keys(estoqueLotes[itemKey] || {}).forEach(function(loteKey) {
        var l = estoqueLotes[itemKey][loteKey];
        if (l && l.enderecoKey === enderecoKey && Number(l.saldoLote) > 0) out.push({itemKey: itemKey, loteKey: loteKey, lote: l});
      });
    });
    return out;
  }

  var FONTE_PESO = {PLANILHA: 'planilha', PALETE: 'kg/cx do palete', CADASTRO: 'kg/cx do cadastro',
    QUANTIDADE_KG: 'quantidade em kg', DENSIDADE: 'densidade do cadastro', PESO_UNITARIO: 'peso unitário do cadastro'};
  function textoFontePeso(peso) { return peso && peso.fonte ? (FONTE_PESO[peso.fonte] || '') : ''; }

  return {analisar: analisar, analisarLote: analisarLote, lotesDaPosicao: lotesDaPosicao, pesoMaterial: pesoMaterial,
    volumesMaterial: volumesMaterial, textoFontePeso: textoFontePeso};
});
