'use strict';
/* Sugestão de compra de produto rotulado em MASSA (g/kg). Bug de 30/09:
   "Produto cadastrado com unidade de volume "g" -- só sei calcular a partir de
   ml ou L" ao gerar solicitação de compra de HDR-MISS-0005 (hidratante 200g),
   enquanto o Emitir OP calculava o mesmo produto sem problema. A conta precisa
   dar o MESMO resultado nos dois lugares. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ctx = {console: {log() {}, warn() {}, error() {}}, window: {}, document: undefined, setTimeout, Promise};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/shared/utils.js', 'utf8'), ctx, {filename: 'utils.js'});
const explodir = (...a) => JSON.parse(JSON.stringify(ctx.explodirMateriaisNecessarios(...a)));

// A conta do Emitir OP (public/emitir_op.html, recalcular) reproduzida aqui.
function contaEmitirOp(produto, pecas) {
  const val = parseFloat(produto.volume) || 0, un = produto.unidadeVolume.toLowerCase();
  const dens = parseFloat(produto.densidadeGranel), over = parseFloat(produto.overfillPct) || 0, perda = parseFloat(produto.perdaProcessoPct) || 0;
  const pesoNominalG = un === 'g' ? val : un === 'kg' ? val * 1000 : val * dens;
  const volNominalMl = un === 'ml' ? val : un === 'l' ? val * 1000 : pesoNominalG / dens;
  const volumeGranelL = pecas * volNominalMl * (1 + over / 100) * (1 + perda / 100) / 1000;
  return {massaLoteKg: volumeGranelL * dens, volumeGranelL};
}

const formula = {itens: {a: {mpCodigo: 'MPGR-1', mpNome: 'AGUA', percentualMM: 80}, b: {mpCodigo: 'MPES-1', mpNome: 'FRAGRANCIA', percentualMM: 20}}};
const bom = {itens: {f: {materialCodigo: 'EP-1', materialNome: 'POTE', qtdPorPeca: 1}}};

// HDR-MISS-0005: 200 g, densidade 0,95, overfill 1,5%, perda 2%.
const p0005 = {volume: '200', unidadeVolume: 'g', densidadeGranel: 0.95, overfillPct: 1.5, perdaProcessoPct: 2};
const r = explodir(p0005, 1760, formula, bom, null);
assert.equal(r.ok, true, JSON.stringify(r));
const ref = contaEmitirOp(p0005, 1760);
assert.ok(Math.abs(r.massaLoteKg - ref.massaLoteKg) < 0.001, 'massa igual à do Emitir OP: ' + r.massaLoteKg + ' x ' + ref.massaLoteKg);
assert.ok(Math.abs(r.volumeGranelL - ref.volumeGranelL) < 0.001, 'volume igual');
// 1.760 un x 200 g x 1,015 x 1,02 = 364,426 kg (à mão).
assert.ok(Math.abs(r.massaLoteKg - 364.426) < 0.001, String(r.massaLoteKg));
const agua = r.itens.find(i => i.mpCodigo === 'MPGR-1'), frag = r.itens.find(i => i.mpCodigo === 'MPES-1');
assert.ok(Math.abs(agua.quantidade - r.massaLoteKg * 0.8) < 0.002, 'fórmula rateia a massa');
assert.ok(Math.abs(frag.quantidade - r.massaLoteKg * 0.2) < 0.002);
assert.equal(r.itens.find(i => i.mpCodigo === 'EP-1').quantidade, 1760, 'BOM em unidades');

// kg vale 1000 g.
const pKg = Object.assign({}, p0005, {volume: '0.2', unidadeVolume: 'kg'});
assert.ok(Math.abs(explodir(pKg, 1760, formula, bom, null).massaLoteKg - r.massaLoteKg) < 0.001);
// Densidade desconhecida (-1 ou ausente): a massa sai igual; só o volume do granel fica nulo.
for (const d of [-1, undefined, 0]) {
  const x = explodir(Object.assign({}, p0005, {densidadeGranel: d}), 1760, formula, bom, null);
  assert.equal(x.ok, true);
  assert.ok(Math.abs(x.massaLoteKg - r.massaLoteKg) < 0.001);
  assert.equal(x.volumeGranelL, null);
}
// Faltando peso ou quantidade: erro claro.
assert.equal(explodir(Object.assign({}, p0005, {volume: ''}), 100, formula, bom, null).ok, false);
assert.equal(explodir(p0005, 0, formula, bom, null).ok, false);

// ml e L seguem como sempre (o comportamento de 'volume' não mudou).
const pMl = {volume: '200', unidadeVolume: 'ml', densidadeGranel: 0.95, overfillPct: 1.5, perdaProcessoPct: 2};
const rMl = explodir(pMl, 1760, formula, bom, null);
const refMl = contaEmitirOp(pMl, 1760);
assert.ok(Math.abs(rMl.massaLoteKg - refMl.massaLoteKg) < 0.001);
assert.ok(Math.abs(rMl.massaLoteKg - 346.204) < 0.01, 'bate com a massa gravada na OP 26267/02: ' + rMl.massaLoteKg);
assert.equal(explodir(Object.assign({}, pMl, {densidadeGranel: -1}), 1760, formula, bom, null).ok, false, 'ml sem densidade continua pedindo densidade');
// Unidade desconhecida: mensagem atualizada, sem quebrar.
const rx = explodir(Object.assign({}, pMl, {unidadeVolume: 'oz'}), 10, formula, bom, null);
assert.equal(rx.ok, false);
assert.match(rx.erro, /ml, L, g ou kg/);

console.log('explosão de material para produto em massa (g/kg): OK — mesma conta do Emitir OP');
