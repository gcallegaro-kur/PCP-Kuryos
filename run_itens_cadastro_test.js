'use strict';
/* Item de fórmula/BOM/OP precisa existir no cadastro (shared/itens-cadastro.js). */
const assert = require('node:assert/strict');
const IC = require('./public/shared/itens-cadastro.js');

const materiais = {
  'MPES-00094': {mpCodigo: 'MPES-00094', mpNome: 'ESSENCIA LILAH ECO HS - GF49767', ativo: true},
  k2: {mpCodigo: 'MPGR-00140', mpNome: 'CORANTE AMARELO/VERMELHO', ativo: false},
  k3: {mpCodigo: 'EP-00095', mpNome: 'FRASCO'},
};

// Tudo cadastrado e ativo (ativo ausente conta como ativo).
assert.deepEqual(IC.problemas({a: {mpCodigo: 'MPES-00094'}, b: {mpCodigo: ' EP-00095 '}}, materiais), []);

// Os três motivos.
const p = IC.problemas({
  i1: {mpCodigo: '', pendente: true, textoOriginalGeradorOPs: 'MUSC 50'},
  i2: {mpCodigo: '', percentualMM: 0},
  i3: {mpCodigo: 'MPGR-99999'},
  i4: {mpCodigo: 'MPGR-00140'},
  i5: null,
}, materiais);
assert.deepEqual(p.map((x) => x.chave + ':' + x.motivo), ['i1:SEM_CODIGO', 'i2:SEM_CODIGO', 'i3:NAO_CADASTRADO', 'i4:INATIVO']);
assert.match(p[0].texto, /"MUSC 50", da importação/);
assert.match(p[1].texto, /linha vazia/);
assert.match(p[3].texto, /CORANTE AMARELO\/VERMELHO está inativo/);

// BOM usa materialCodigo.
assert.equal(IC.problemas({b1: {materialCodigo: 'EP-00095'}}, materiais, 'materialCodigo').length, 0);
assert.equal(IC.problemas({b1: {materialCodigo: 'EP-00095'}}, materiais).length, 1, 'campo errado = sem código');

// Mensagem: cita até 4 e conta o resto.
assert.equal(IC.mensagem([], 'x'), '');
const cinco = IC.problemas({a: {mpCodigo: 'X1'}, b: {mpCodigo: 'X2'}, c: {mpCodigo: 'X3'}, d: {mpCodigo: 'X4'}, e: {mpCodigo: 'X5'}}, materiais);
assert.match(IC.mensagem(cinco, 'A Fórmula tem'), /^A Fórmula tem 5 item\(ns\) fora do cadastro de materiais: X1 .*X4 não existe no cadastro de materiais; e mais 1\.$/);

console.log('itens-cadastro: ok');
