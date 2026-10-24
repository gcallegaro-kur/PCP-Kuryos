'use strict';
/* O apontamento baixa o material que a OP USOU (Substituir na emissão), não o do BOM padrão.
   Antes: a baixa e a reserva caíam sempre no código do BOM (EP-00106 em -71.999). Roda a
   função REAL de form.html (baixarEstoqueConsumo) com o utils.js real e o estoque simulado. */
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');

const ctx = vm.createContext({console, window: {currentUser: {nome: 'Teste'}}, document: {}, localStorage: {}});
vm.runInContext(fs.readFileSync(__dirname + '/public/shared/utils.js', 'utf8'), ctx);

// ── 1. A regra pura ──
const sub = vm.runInContext('substituicoesDaOp', ctx), aplicar = vm.runInContext('aplicarSubstituicoesOp', ctx);
const op = {materiaisConsumo: {
  b_a: {origem: 'bom', mpCodigo: 'EP-106', substituiMpCodigo: 'EP-101'},
  b_b: {origem: 'bom', mpCodigo: 'ES-14', substituiMpCodigo: null},
  b_c: {origem: 'bom', mpCodigo: 'ET-69', substituiMpCodigo: 'ET-18'},
  f_x: {origem: 'formula', mpCodigo: 'MP-2', substituiMpCodigo: 'MP-2'}}};
assert.deepEqual(JSON.parse(JSON.stringify(sub(op))), {'EP-101': 'EP-106', 'ET-18': 'ET-69'}, 'só o que mudou de verdade');
assert.deepEqual(JSON.parse(JSON.stringify(sub({}))), {}); assert.deepEqual(JSON.parse(JSON.stringify(sub(null))), {});
const mats = {'EP-106': {mpCodigo: 'EP-106', mpNome: 'FRASCO B'}};
const base = [{mpCodigo: 'EP-101', mpNome: 'FRASCO A', quantidade: 1000, unidade: 'un', origem: 'bom'}, {mpCodigo: 'ES-14', mpNome: 'SOBRETAMPA', quantidade: 1000, unidade: 'un', origem: 'bom'}];
const r = aplicar(base, op, mats);
assert.deepEqual(JSON.parse(JSON.stringify(r.map((i) => [i.mpCodigo, i.mpNome, i.quantidade, i.substituiDe || null]))), [['EP-106', 'FRASCO B', 1000, 'EP-101'], ['ES-14', 'SOBRETAMPA', 1000, null]]);
assert.equal(aplicar(base, {}, mats), base, 'sem substituição devolve a mesma lista');
const soma = aplicar([{mpCodigo: 'EP-101', quantidade: 10, origem: 'bom'}, {mpCodigo: 'EP-106', quantidade: 5, origem: 'bom'}], op, mats);
assert.deepEqual(JSON.parse(JSON.stringify(soma.map((i) => [i.mpCodigo, i.quantidade]))), [['EP-106', 15]], 'dois itens no mesmo código se somam');

// ── 2. A função real do apontamento ──
const src = fs.readFileSync(__dirname + '/public/form.html', 'utf8');
const ini = src.indexOf('function baixarEstoqueConsumo('), fim = src.indexOf('// pedidos/{key}.produzido representa venda');
assert.ok(ini > 0 && fim > ini, 'função encontrada em form.html');
const chamadas = {ajustes: [], empenhos: [], wms: []};
Object.assign(ctx, {
  allFormulasForm: {'SKU-1__v1': {codProduto: 'SKU-1', versao: 'v1', status: 'APROVADA', itens: {}}},
  allBomForm: {'SKU-1__v1': {itens: {
    a: {materialCodigo: 'EP-101', materialNome: 'FRASCO A', qtdPorPeca: 1},
    b: {materialCodigo: 'ES-14', materialNome: 'SOBRETAMPA', qtdPorPeca: 1},
    c: {materialCodigo: 'ET-18', materialNome: 'CAIXA', qtdPorPeca: 1 / 48, pecasPorUnidade: 48}}}},
  allProdutosForm: {'SKU-1': {sku: 'SKU-1', densidadeGranel: -1}},   // sem densidade: baixa só a embalagem do BOM
  allMateriaisForm: {'EP-101': {mpCodigo: 'EP-101', mpNome: 'FRASCO A', unidade: 'un'}, 'EP-106': {mpCodigo: 'EP-106', mpNome: 'FRASCO B', unidade: 'un'},
    'ES-14': {mpCodigo: 'ES-14', mpNome: 'SOBRETAMPA', unidade: 'un'}, 'ET-18': {mpCodigo: 'ET-18', mpNome: 'CAIXA 406', unidade: 'un'}, 'ET-69': {mpCodigo: 'ET-69', mpNome: 'CAIXA 371', unidade: 'un'}},
  ajustarEstoque: (db, cod, delta, tipo, ref) => { chamadas.ajustes.push([cod, delta]); return Promise.resolve(); },
  baixarEmpenho: (db, ref, cod, q) => { chamadas.empenhos.push([cod, q]); return Promise.resolve(); },
  baixaWmsSegura: (tipo, cod, q) => { chamadas.wms.push([cod, q]); return Promise.resolve(); },
  clienteKeyDaOp: () => 'MISS', db: {}
});
vm.runInContext(src.slice(ini, fim), ctx);
const baixar = vm.runInContext('baixarEstoqueConsumo', ctx);
const opBase = (mc) => ({lote: '26300/01', sku: 'SKU-1', produzidoLinha: 960, produzido: 960, materiaisConsumo: mc});
const resumo = () => ({a: chamadas.ajustes.map((x) => [x[0], x[1]]).sort(), e: chamadas.empenhos.map((x) => [x[0], x[1]]).sort(), w: chamadas.wms.map((x) => [x[0], x[1]]).sort()});
const limpar = () => { chamadas.ajustes.length = chamadas.empenhos.length = chamadas.wms.length = 0; };

(async () => {
  // sem substituição: baixa o do BOM (comportamento de sempre)
  await baixar(opBase({}), 960, 'consumo_producao', '26300/01');
  let x = resumo();
  assert.deepEqual(x.a, [['EP-101', -960], ['ES-14', -960], ['ET-18', -20]]);
  assert.deepEqual(x.e, [['EP-101', 960], ['ES-14', 960], ['ET-18', 20]]);
  limpar();
  // com substituição: frasco B no lugar do A e caixa 371 no lugar da 406 -- baixa, reserva e WMS vão para os códigos usados
  await baixar(opBase(op.materiaisConsumo ? {b_a: {origem: 'bom', mpCodigo: 'EP-106', substituiMpCodigo: 'EP-101'}, b_c: {origem: 'bom', mpCodigo: 'ET-69', substituiMpCodigo: 'ET-18'}} : {}), 960, 'consumo_producao', '26300/01');
  x = resumo();
  assert.deepEqual(x.a, [['EP-106', -960], ['ES-14', -960], ['ET-69', -20]], 'estoque: baixa o que a OP usou');
  assert.deepEqual(x.e, [['EP-106', 960], ['ES-14', 960], ['ET-69', 20]], 'reserva: libera no código em que foi feita');
  assert.deepEqual(x.w, [['EP-106', 960], ['ES-14', 960], ['ET-69', 20]], 'WMS: lote do código usado');
  assert.ok(!x.a.some((i) => i[0] === 'EP-101' || i[0] === 'ET-18'), 'o do BOM padrão não é baixado');
  console.log('OK apontamento baixa o material que a OP usou (substituição), com reserva e WMS no mesmo código; sem substituição, o do BOM.');
})().catch((e) => { console.error(e); process.exit(1); });
