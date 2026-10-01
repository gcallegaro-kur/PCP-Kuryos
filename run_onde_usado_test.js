'use strict';
/* Onde o material é usado (shared/onde-usado.js). */
const assert = require('node:assert/strict');
const O = require('./public/shared/onde-usado.js');

const produtos = {
  WKBS0002: {sku: 'WKBS0002', descricao: 'BODY SPLASH JARDIM 120ML', cliente: 'WIKE MAKE'},
  MRARBS04: {sku: 'MRARBS04', descricao: 'BODY SPLASH NÉCTAR', cliente: 'MISS RÔSE'},
  VELHO01: {sku: 'VELHO01', descricao: 'DESCONTINUADO', ativo: false},
};
const formulas = {
  WKBS0002__v1: {codProduto: 'WKBS0002', versao: 'v1', status: 'APROVADA', itens: {a: {mpCodigo: 'MPES-00094', percentualMM: 2}, b: {mpCodigo: 'MPGR-00132', percentualMM: 36.85}}},
  // v1 substituída pela v2: só a v2 conta.
  MRARBS04__v1: {codProduto: 'MRARBS04', versao: 'v1', status: 'APROVADA', itens: {a: {mpCodigo: 'MPES-00094', percentualMM: 3}}},
  MRARBS04__v2: {codProduto: 'MRARBS04', versao: 'v2', status: 'RASCUNHO', itens: {a: {mpCodigo: 'MPGR-00132', percentualMM: 90}, z: {mpCodigo: '', percentualMM: 1}}},
  // OBSOLETA nunca é vigente, mesmo sendo a mais alta.
  WKBS0002__v3: {codProduto: 'WKBS0002', versao: 'v3', status: 'OBSOLETA', itens: {a: {mpCodigo: 'MPGR-99999', percentualMM: 1}}},
  VELHO01__v1: {codProduto: 'VELHO01', versao: 'v1', status: 'APROVADA', itens: {a: {mpCodigo: 'MPGR-00132', percentualMM: 50}}},
};
const bom = {
  WKBS0002__v1: {codProduto: 'WKBS0002', versao: 'v1', status: 'APROVADA', itens: {
    f: {materialCodigo: 'EP-00095', qtdPorPeca: 1}, c: {materialCodigo: 'ET-00049', qtdPorPeca: 0.020833},
    // mesmo material duas vezes no mesmo BOM soma
    r1: {materialCodigo: 'ES-00149', qtdPorPeca: 1}, r2: {materialCodigo: 'ES-00149', qtdPorPeca: 1}}},
  MRARBS04__v2: {codProduto: 'MRARBS04', versao: 'v2', itens: {f: {materialCodigo: 'EP-00095', qtdPorPeca: 1}}},
};

const i = O.indice({formulas, bom, produtos});
assert.deepEqual(i['MPES-00094'].map((u) => u.sku), ['WKBS0002'], 'a v1 do MRARBS04 foi substituída pela v2');
assert.equal(i['MPES-00094'][0].via, 'Fórmula');
assert.equal(i['MPES-00094'][0].quantidade, 2);
assert.equal(i['MPES-00094'][0].unidadeQtd, '%');
assert.equal(i['MPES-00094'][0].cliente, 'WIKE MAKE');
assert.deepEqual(i['MPGR-00132'].map((u) => u.sku + ':' + u.status), ['MRARBS04:RASCUNHO', 'WKBS0002:APROVADA'], 'produto inativo fica de fora');
assert.equal(i['MPGR-99999'], undefined, 'versão obsoleta não conta');
assert.equal(i[''], undefined, 'item sem código é ignorado');
assert.deepEqual(i['EP-00095'].map((u) => u.sku + ':' + u.via + ':' + u.unidadeQtd), ['MRARBS04:BOM:por peça', 'WKBS0002:BOM:por peça']);
assert.equal(i['ES-00149'].length, 1);
assert.equal(i['ES-00149'][0].quantidade, 2);

// Fórmula e BOM do mesmo produto contam como 1 produto.
const misto = O.indice({formulas: {P__v1: {codProduto: 'P', versao: 'v1', itens: {a: {mpCodigo: 'X', percentualMM: 1}}}},
  bom: {P__v1: {codProduto: 'P', versao: 'v1', itens: {a: {materialCodigo: 'X', qtdPorPeca: 1}}}}, produtos: {P: {sku: 'P'}}});
assert.equal(misto.X.length, 2);
assert.equal(O.produtosDistintos(misto.X).length, 1);
assert.match(O.textoBusca(i['MPES-00094']), /WKBS0002 BODY SPLASH JARDIM 120ML WIKE MAKE/);

console.log('onde-usado: ok');
