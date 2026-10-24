'use strict';
/* Padrão de nome do material (shared/nome-material.js) e a ligação com o salvar de Cadastros. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const N = require('./public/shared/nome-material');

const mats = {
  'EP-00101': {mpCodigo: 'EP-00101', tipo: 'EP', mpNome: 'FRASCO R.24/410 HIDRA C/RECRAVE BODY SPLASH 200ML'},
  'ES-00010': {mpCodigo: 'ES-00010', tipo: 'ES', mpNome: 'TAMPA SOBRETAMPA HIDRA SANGEL 200ML'},
  'MPGR-1': {mpCodigo: 'MPGR-1', tipo: 'MPGR', mpNome: 'ALCOOL 96 GL'}
};
const v = (nome, tipo, atual) => N.validar(nome, tipo, atual || null, mats);
const erros = (nome, tipo, atual) => v(nome, tipo, atual).erros.join(' | ');

// nomes bons
assert.equal(v('FRASCO R.24/410 HIDRA PET FORNECEDOR X 200ML', 'EP').ok, true);
assert.equal(v('ROTULO BODY SPLASH AMBAR REAL 200ML', 'ES').ok, true);
assert.equal(v('CAIXA DE EMBARQUE 48 UNID. 371X280X197MM BODY SPLASH 200ML', 'ET').ok, true);
// genéricos e curtos
assert.match(erros('FRASCO', 'EP'), /só o tipo do item/);
assert.match(erros('Válvula', 'EP'), /só o tipo do item/, 'sem acento/caixa');
assert.match(erros('TAMPA ROSCA', 'EP'), /curto demais/);
assert.match(erros('FRASCO BODY SPLASH CRISTAL FORNECEDOR', 'EP'), /Falta a medida/);
assert.equal(v('ALCOOL ETILICO', 'MPGR').ok, true, 'matéria-prima não exige medida');
assert.match(erros('AB', 'MPGR'), /curto demais/);
assert.match(erros('', 'EP'), /Informe o nome/);
// duplicado (sem acento, caixa, pontuação e espaços)
assert.match(erros('frasco r.24/410 hidra c/recrave  body splash 200ml', 'EP'), /Já existe o material com este nome: EP-00101/);
assert.match(erros('FRASCO R.24/410 HIDRA C/RECRAVE BODY SPLASH 200ML', 'ES'), /Já existe/, 'dentro da família de embalagem, mesmo com tipo diferente');
assert.equal(v('FRASCO R.24/410 HIDRA C/RECRAVE BODY SPLASH 200ML', 'EP', 'EP-00101').ok, true, 'o próprio material não conta como duplicado');
assert.equal(v('ALCOOL 96 GL', 'MPES').ok, true, 'matéria-prima só compara dentro do mesmo tipo');
assert.match(erros('ALCOOL 96 GL', 'MPGR'), /Já existe/);
// o salvar de Cadastros usa a regra (e deixa material inativo de fora)
const html = fs.readFileSync(__dirname + '/public/cadastros.html', 'utf8');
assert.match(html, /<script src="shared\/nome-material\.js"><\/script>/);
assert.match(html, /if \(document\.getElementById\('fAtivo-mat'\)\.checked\) \{\s*var vNome = NomeMaterial\.validar\(nome, tipo,/);
assert.match(html, /showAlert\('Nome do material: ' \+ vNome\.erros\.join\(' '\), 'danger'\); return;/);
console.log('OK nome do material: padrão (tipo+descrição+medida), genéricos, curtos, duplicados e ligação com o salvar.');
