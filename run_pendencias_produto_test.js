'use strict';
/* Pendências de cadastro do produto (08/10/2026) -- shared/pendencias-produto.js. */
const assert = require('node:assert/strict');
const P = require('./public/shared/pendencias-produto.js');
let n = 0; const ok = (nome, fn) => { fn(); n++; console.log('ok -', nome); };

const produtos = {
  A: {sku: 'A', ativo: 'Ativo'}, B: {sku: 'B', ativo: 'Ativo'}, C: {sku: 'C', ativo: 'Ativo'}, D: {sku: 'D', ativo: 'Inativo'}
};
const formulas = {
  A__v1: {codProduto: 'A', versao: 'v1', status: 'RASCUNHO', itens: {i1: {}}},
  A__v2: {codProduto: 'A', versao: 'v2', status: 'APROVADA', itens: {i1: {}}},
  B__v1: {codProduto: 'B', versao: 'v1', status: 'RASCUNHO', revisado: false, itens: {i1: {}}},
  C__v1: {codProduto: 'C', versao: 'v1', status: 'RASCUNHO', itens: {}}
};
const bom = {A__v1: {codProduto: 'A', status: 'APROVADA', itens: {x: {}}}, B__v1: {codProduto: 'B', itens: {x: {}}}};
const especs = {X__v1: {itens: {e: {}}, status: 'APROVADA'}}; // sem codProduto: usa a chave

const idx = P.indexar(formulas, bom, especs);

ok('situação por componente: aprovada, a aprovar, sem', () => {
  assert.deepEqual(P.doProduto('A', idx), {formula: 'OK', bom: 'OK', espec: 'SEM'});
  assert.deepEqual(P.doProduto('B', idx), {formula: 'A_APROVAR', bom: 'A_APROVAR', espec: 'SEM'});
  assert.equal(P.doProduto('C', idx).formula, 'SEM', 'versão vazia = sem cadastro');
  assert.equal(P.doProduto('X', idx).espec, 'OK', 'codProduto ausente: vem da chave');
});

ok('resumo conta só ativos, separando sem cadastro e a aprovar', () => {
  const r = P.resumo(produtos, idx);
  assert.equal(r.ativos, 3);
  assert.deepEqual(r.formula, {pendente: 2, sem: 1, aAprovar: 1});
  assert.deepEqual(r.bom, {pendente: 2, sem: 1, aAprovar: 1});
  assert.deepEqual(r.espec, {pendente: 3, sem: 3, aAprovar: 0});
  assert.equal(r.algum, 3);
});

ok('filtro: pendentes do componente, só ativos', () => {
  const lista = (c) => Object.keys(produtos).filter((k) => P.filtra(k, produtos[k], c, idx));
  assert.deepEqual(lista('formula'), ['B', 'C']);
  assert.deepEqual(lista('bom'), ['B', 'C']);
  assert.deepEqual(lista('espec'), ['A', 'B', 'C'], 'inativo D fica de fora');
  assert.deepEqual(lista(''), ['A', 'B', 'C', 'D'], 'sem filtro, todos');
});

console.log(`\nrun_pendencias_produto_test: ${n} OK`);
