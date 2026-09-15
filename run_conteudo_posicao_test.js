/* Conteúdo de uma posição do WMS (public/shared/conteudo-posicao.js).
   Pedido do usuário (2026-09-15): clicar numa posição e ver itens, volumes,
   peso e quantidades. Cada bloco trava uma regra; sem dado, desconhecido --
   nunca zero. */
const assert = require('assert');
const path = require('path');
const CP = require(path.join(__dirname, 'public', 'shared', 'conteudo-posicao.js'));

const produtos = {PA1: {sku: 'PA1', kgCaixa: 1.7, unCx: 12}};
const materiais = {
  'EP-00167': {mpCodigo: 'EP-00167', unidade: 'un', pesoUnitario: 202},   // gramas
  'MP-KG': {mpCodigo: 'MP-KG', unidade: 'kg'},
  'MP-L': {mpCodigo: 'MP-L', unidade: 'L', densidade: 0.8},
  'MP-L-SEM': {mpCodigo: 'MP-L-SEM', unidade: 'L'},
  'EP-00036': {mpCodigo: 'EP-00036', unidade: 'un'},
  'outra-chave': {mpCodigo: 'ES-001', unidade: 'un', pesoUnitario: 25}
};
const cad = {produtos, materiais};

// ── 1. Peso de material ─────────────────────────────────────────────────
assert.deepEqual(CP.pesoMaterial({saldoLote: 1000, unidade: 'un'}, materiais['EP-00167']), {kg: 202, fonte: 'PESO_UNITARIO'}, 'pesoUnitario é em gramas');
assert.deepEqual(CP.pesoMaterial({saldoLote: 25.5, unidade: 'KG'}, materiais['MP-KG']), {kg: 25.5, fonte: 'QUANTIDADE_KG'});
assert.deepEqual(CP.pesoMaterial({saldoLote: 100, unidade: 'L'}, materiais['MP-L']), {kg: 80, fonte: 'DENSIDADE'});
assert.equal(CP.pesoMaterial({saldoLote: 100, unidade: 'L'}, materiais['MP-L-SEM']).kg, null, 'litro sem densidade não vira kg');
assert.equal(CP.pesoMaterial({saldoLote: 7300, unidade: 'un'}, materiais['EP-00036']).kg, null, 'sem peso unitário: desconhecido');
assert.match(CP.pesoMaterial({saldoLote: 7300, unidade: 'un'}, null).falta, /peso unitário/);

// ── 2. Volumes de material: os do recebimento, sem rateio ──────────────
assert.deepEqual(CP.volumesMaterial({saldoLote: 7300, qtdOriginal: 7300, recebimento: {qtdVolumes: 2}}), {n: 2, parcial: false, texto: '2 volumes'});
let v = CP.volumesMaterial({saldoLote: 5000, qtdOriginal: 7300, recebimento: {qtdVolumes: 2}});
assert.equal(v.n, 2); assert.match(v.texto, /no recebimento \(parte do lote já saiu\)/);
assert.equal(CP.volumesMaterial({saldoLote: 10, qtdOriginal: 10, recebimento: {qtdVolumes: 1}}).texto, '1 volume');
assert.equal(CP.volumesMaterial({saldoLote: 10}).n, null, 'lote sem recebimento (endereçamento inicial) não tem volumes');

// ── 3. Produto acabado: composição e peso da regra da Expedição ─────────
const pa = CP.analisarLote('PA1', 'p1', {itemTipo: 'produto', itemCodigo: 'PA1', itemNome: 'Perfume', saldoLote: 1895, qtdOriginal: 1895,
  caixasFechadas: 157, unidadesPorCaixa: 12, unidadesCaixaParcial: 11, identificadorPalete: 'PA-26251-15-P1', opLote: '26251/15', cliente: 'AFEER', status: 'QUARENTENA'}, cad);
assert.equal(pa.tipo, 'PA');
assert.equal(pa.volumes.n, 158, '157 caixas + a parcial');
assert.equal(pa.volumes.texto, '157 cx × 12 + 1 parcial com 11');
assert.equal(pa.peso.kg, 268.6);
assert.equal(pa.peso.fonte, 'CADASTRO');
assert.equal(pa.lote, 'PA-26251-15-P1');
assert.equal(pa.origem, 'OP 26251/15 · AFEER');
const legado = CP.analisarLote('G', 'l', {itemTipo: 'produto', itemCodigo: 'G', saldoLote: 1848, caixasFechadas: 77, unidadesPorCaixa: 24, pesoTotalKg: 646.8, pedidoId: '0019'}, cad);
assert.equal(legado.peso.kg, 646.8); assert.equal(legado.peso.fonte, 'PLANILHA');
assert.equal(CP.textoFontePeso(legado.peso), 'planilha');
const semComposicao = CP.analisarLote('X', 'l', {itemTipo: 'produto', itemCodigo: 'X', saldoLote: 50}, cad);
assert.equal(semComposicao.volumes.n, null); assert.match(semComposicao.volumes.falta, /composição/);

// ── 4. Material: lote interno, lote do fornecedor, origem ───────────────
const mp = CP.analisarLote('EP-00036', 'l1', {itemTipo: 'material', itemCodigo: 'EP-00036', saldoLote: 7300, qtdOriginal: 7300, unidade: 'un',
  loteInterno: 'AK-2026-000577', loteOrigem: 'F-99', recebimento: {qtdVolumes: 2, fornecedorNome: 'LOMAR PACK', notaFiscal: '18413'}, dataRecebimento: '2026-09-14'}, cad);
assert.equal(mp.lote, 'AK-2026-000577', 'lote interno é o que a etiqueta mostra');
assert.equal(mp.loteFornecedor, 'F-99');
assert.equal(CP.analisarLote('E', 'l', {itemTipo: 'material', itemCodigo: 'E', saldoLote: 1, loteInterno: 'AK-1', loteOrigem: 'NÃO INFORMADO'}, cad).loteFornecedor, null, 'lote não informado não aparece');
assert.equal(mp.origem, 'LOMAR PACK · NF 18413');
assert.equal(mp.entrada, '2026-09-14');
assert.equal(CP.analisarLote('ES-001', 'l', {itemTipo: 'material', itemCodigo: 'ES-001', saldoLote: 40, unidade: 'un'}, cad).peso.kg, 1, 'material achado pelo campo mpCodigo');

// ── 5. Posição: totais misturando PA e material, sem esconder o que falta ─
const estoque = {
  PA1: {p1: {itemTipo: 'produto', itemCodigo: 'PA1', saldoLote: 1895, caixasFechadas: 157, unidadesPorCaixa: 12, unidadesCaixaParcial: 11, enderecoKey: 'FAB-1-1-1'}},
  'EP-00036': {l1: {itemTipo: 'material', itemCodigo: 'EP-00036', saldoLote: 7300, unidade: 'un', recebimento: {qtdVolumes: 2}, enderecoKey: 'FAB-1-1-1'}},
  'MP-KG': {l2: {itemTipo: 'material', itemCodigo: 'MP-KG', saldoLote: 20, unidade: 'kg', enderecoKey: 'FAB-1-1-1'},
            zerado: {itemTipo: 'material', itemCodigo: 'MP-KG', saldoLote: 0, unidade: 'kg', enderecoKey: 'FAB-1-1-1'},
            outro: {itemTipo: 'material', itemCodigo: 'MP-KG', saldoLote: 5, unidade: 'kg', enderecoKey: 'GAL-1-1-1'}}
};
const lotes = CP.lotesDaPosicao(estoque, 'FAB-1-1-1');
assert.equal(lotes.length, 3, 'lote zerado e de outra posição ficam fora');
const r = CP.analisar(lotes, cad);
assert.equal(r.totais.itens, 3);
assert.deepEqual(r.totais.porUnidade, {un: 9195, kg: 20}, 'quantidade separada por unidade, nunca somando un com kg');
assert.equal(r.totais.volumes, 160, '158 do palete + 2 do recebimento');
assert.equal(r.totais.semVolumes, 1, 'material sem recebimento conta como sem volumes');
assert.equal(r.totais.kg, 288.6, '268,6 do PA + 20 kg');
assert.equal(r.totais.semPeso, 1, 'EP-00036 sem peso unitário');
assert.deepEqual(r.itens.map(i => i.tipo), ['MP', 'MP', 'PA'], 'ordenado por tipo e código');
assert.deepEqual(CP.analisar([], cad).totais, {itens: 0, porUnidade: {}, volumes: 0, semVolumes: 0, kg: 0, semPeso: 0});
assert.ok(!/NaN|undefined/.test(JSON.stringify(r)), 'sem sentinela vazando');

console.log('run_conteudo_posicao_test: OK');
