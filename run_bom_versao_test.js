'use strict';
/* BOM da versão da fórmula: a chave "produto__versão" já existiu como V1 e v1. Com a chave exata errada a
   conta usava BOM vazio sem avisar (BBSJBS03-2 e DPHNPC01, 05/10). bomDaVersao tolera só a caixa da letra. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = {console: {log() {}, warn() {}, error() {}}, window: {}, document: undefined, setTimeout, Promise};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/shared/utils.js', 'utf8'), ctx, {filename: 'utils.js'});
const B = (o) => ({itens: o});
const bom = {'AAA__V1': B({x: 1}), 'AAA__v1': B({y: 2}), 'BBB__v1': B({z: 3}), 'CCC__v1': B({w: 4}), 'DDD__v10': B({k: 5})};

assert.deepEqual(JSON.parse(JSON.stringify(ctx.bomDaVersao(bom, 'AAA', 'V1'))), {itens: {x: 1}}, 'chave exata tem preferência');
assert.deepEqual(JSON.parse(JSON.stringify(ctx.bomDaVersao(bom, 'AAA', 'v1'))), {itens: {y: 2}});
assert.deepEqual(JSON.parse(JSON.stringify(ctx.bomDaVersao(bom, 'BBB', 'V1'))), {itens: {z: 3}}, 'fórmula V1 acha o BOM v1');
assert.deepEqual(JSON.parse(JSON.stringify(ctx.bomDaVersao(bom, 'CCC', 'v1'))), {itens: {w: 4}});
assert.equal(ctx.bomDaVersao(bom, 'BBB', 'V2'), null, 'não adivinha outra versão (PRF-AFEE: fórmula V2, BOM só v1)');
assert.equal(ctx.bomDaVersao(bom, 'DDD', 'v1'), null, 'v1 não é v10');
assert.equal(ctx.bomDaVersao(bom, 'ZZZ', 'v1'), null);
assert.equal(ctx.bomDaVersao(null, 'AAA', 'v1'), null);

// Ponta a ponta: a explosão de materiais passa a enxergar os frascos do BOM mesmo com V1 x v1
const produto = {sku: 'BBB', volume: 100, unidadeVolume: 'ml', densidadeGranel: 1};
const formula = {versao: 'V1', itens: {a: {mpCodigo: 'MP-1', mpNome: 'MP', percentualMM: 100}}};
const bomReal = {itens: {i: {materialCodigo: 'EP-1', materialNome: 'FRASCO', qtdPorPeca: 1}}};
const sem = JSON.parse(JSON.stringify(ctx.explodirMateriaisNecessarios(produto, 100, formula, {itens: {}}, {})));
const com = JSON.parse(JSON.stringify(ctx.explodirMateriaisNecessarios(produto, 100, formula, bomReal, {})));
assert.equal(sem.itens.filter((i) => i.origem === 'bom').length, 0, 'BOM vazio: nenhuma embalagem na conta (o defeito)');
assert.equal(com.itens.filter((i) => i.origem === 'bom').length, 1);
console.log('OK BOM da versão: acha V1/v1 pela caixa, não adivinha versão, e a explosão passa a incluir as embalagens.');
