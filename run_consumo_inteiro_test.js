'use strict';
/* Consumo inteiro, "1 a cada N peças" e material sem controle de estoque
   (shared/utils.js, 01/10). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = {console, window: {}, document: undefined, setTimeout, Promise};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/shared/utils.js', 'utf8'), ctx, {filename: 'utils.js'});
const U = ctx;

// Unidade discreta x contínua.
assert.equal(U.ehUnidadeDiscreta('un'), true);
assert.equal(U.ehUnidadeDiscreta('rolo'), true);
assert.equal(U.ehUnidadeDiscreta('kg'), false);
assert.equal(U.ehUnidadeDiscreta('L'), false);

// "1 a cada N": campo novo ou a fração antiga redonda.
assert.equal(U.pecasPorUnidadeBom({pecasPorUnidade: 48, qtdPorPeca: 0.020833}), 48);
assert.equal(U.pecasPorUnidadeBom({qtdPorPeca: 0.020833}), 48);
assert.equal(U.pecasPorUnidadeBom({qtdPorPeca: 0.041667}), 24);
assert.equal(U.pecasPorUnidadeBom({qtdPorPeca: 0.0625}), 16);
assert.equal(U.pecasPorUnidadeBom({qtdPorPeca: 1}), null);
assert.equal(U.pecasPorUnidadeBom({qtdPorPeca: 0.3}), null, '1/0,3 = 3,33 não é redondo');

// Quantidade para N peças: inteiro, para cima.
const caixa = {qtdPorPeca: 0.020833};
assert.equal(U.qtdBomParaPecas(caixa, 960, 'un'), 20);
assert.equal(U.qtdBomParaPecas(caixa, 961, 'un'), 21, 'caixa começada é caixa gasta');
assert.equal(U.qtdBomParaPecas(caixa, 797, 'un'), 17);
assert.equal(U.qtdBomParaPecas({qtdPorPeca: 1}, 797, 'un'), 797);
assert.equal(U.qtdBomParaPecas({qtdPorPeca: 0.0125}, 100, 'kg'), 1.25, 'contínuo segue fracionado');

// Consumo por apontamento: diferença dos acumulados. Soma exata, nunca fração.
const pontos = [0, 864, 1661, 1700, 1750];
let total = 0;
for (let i = 1; i < pontos.length; i++) {
  const q = U.consumoBomIncremental(caixa, pontos[i - 1], pontos[i], 'un');
  assert.equal(q, Math.round(q), 'consumo inteiro');
  total += q;
}
assert.equal(total, Math.ceil(1750 / 48), '37 caixas para 1.750 peças, em qualquer quantidade de apontamentos');
assert.equal(U.consumoBomIncremental(caixa, 48, 49, 'un'), 1, 'abriu a 2ª caixa');
assert.equal(U.consumoBomIncremental(caixa, 49, 60, 'un'), 0, 'mesma caixa');

// explodirMateriaisNecessarios: BOM discreto inteiro.
const r = U.explodirMateriaisNecessarios({volume: 200, unidadeVolume: 'ml', densidadeGranel: 1}, 797,
  {itens: {a: {mpCodigo: 'AGUA', percentualMM: 100}}}, {itens: {c: {materialCodigo: 'CX', qtdPorPeca: 0.020833}, f: {materialCodigo: 'FR', qtdPorPeca: 1}}},
  {CX: {mpCodigo: 'CX', unidade: 'un'}, FR: {mpCodigo: 'FR', unidade: 'un'}});
assert.equal(r.itens.find((i) => i.mpCodigo === 'CX').quantidade, 17);
assert.equal(r.itens.find((i) => i.mpCodigo === 'FR').quantidade, 797);

// Sem controle de estoque.
const materiais = {'MPGR-00132': {mpCodigo: 'MPGR-00132', mpNome: 'ÁGUA', controlaEstoque: false}, x: {mpCodigo: 'EP-1'}, y: {mpCodigo: 'EP-2', controlaEstoque: true}};
assert.equal(U.materialSemControleEstoque('MPGR-00132', materiais), true);
assert.equal(U.materialSemControleEstoque('EP-1', materiais), false, 'padrão: controla');
assert.equal(U.materialSemControleEstoque('EP-2', materiais), false);
assert.equal(U.materialSemControleEstoque('NAO-EXISTE', materiais), false);

console.log('consumo-inteiro: ok');
