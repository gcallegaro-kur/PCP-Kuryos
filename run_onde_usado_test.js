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
  MRARBS04__v2: {codProduto: 'MRARBS04', versao: 'v2', status: 'APROVADA', itens: {a: {mpCodigo: 'MPGR-00132', percentualMM: 90}, z: {mpCodigo: '', percentualMM: 1}}},
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
assert.deepEqual(i['MPGR-00132'].map((u) => u.sku + ':' + u.status), ['MRARBS04:APROVADA', 'WKBS0002:APROVADA'], 'produto inativo fica de fora');
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

// Vigente = o que as contas usam (01/10, EP-00106 x EP-00101): fórmula aprovada de maior número
// (um rascunho mais novo NÃO passa na frente) e o BOM de MESMA chave da fórmula escolhida.
const prod2 = {AAA: {sku: 'AAA', descricao: 'A'}, BBB: {sku: 'BBB', descricao: 'B'}};
const v = O.indice({
  produtos: prod2,
  formulas: {
    AAA__v1: {codProduto: 'AAA', versao: 'v1', status: 'APROVADA', itens: {}},
    AAA__v2: {codProduto: 'AAA', versao: 'v2', status: 'RASCUNHO', itens: {}},
    BBB__V1: {codProduto: 'BBB', versao: 'V1', status: 'RASCUNHO', itens: {}}
  },
  bom: {
    AAA__v1: {codProduto: 'AAA', versao: 'v1', itens: {a: {materialCodigo: 'FRASCO-VELHO', qtdPorPeca: 1}}},
    AAA__v2: {codProduto: 'AAA', versao: 'v2', itens: {a: {materialCodigo: 'FRASCO-NOVO', qtdPorPeca: 1}}},
    // duplicata só na caixa da letra: a fórmula é V1, então o BOM é o BBB__V1
    BBB__V1: {versao: null, itens: {a: {materialCodigo: 'FRASCO-NOVO', qtdPorPeca: 1}}},
    BBB__v1: {codProduto: 'BBB', versao: 'v1', itens: {a: {materialCodigo: 'FRASCO-VELHO', qtdPorPeca: 1}}}
  }
});
assert.deepEqual((v['FRASCO-VELHO'] || []).map((u) => u.sku), ['AAA'], 'rascunho v2 não substitui a v1 aprovada; a duplicata BBB__v1 fica de fora');
assert.deepEqual((v['FRASCO-NOVO'] || []).map((u) => u.sku), ['BBB'], 'BBB usa o BOM da chave da fórmula (V1)');
assert.equal(O.produtosDistintos([].concat(v['FRASCO-VELHO'], v['FRASCO-NOVO'])).length, 2, 'nenhum produto aparece duas vezes');

console.log('onde-usado: ok');
