'use strict';
/* Motor de checklists editáveis (19/10/2026) -- shared/checklists.js e modelos padrão. */
const assert = require('node:assert/strict');
const C = require('./public/shared/checklists.js');
const P = require('./public/shared/checklists-modelos-padrao.js');
let n = 0; const ok = (nome, fn) => { fn(); n++; console.log('ok -', nome); };

ok('modelos padrão são válidos e com ids únicos', () => {
  assert.deepEqual(P.MODELOS.map((m) => m.codigo), ['CK-3', 'CK-4', 'CK-5']);
  const todos = {};
  P.MODELOS.forEach((m) => {
    const itens = C.normalizarItens(m.itens);
    assert.deepEqual(C.validarItens(itens), [], m.codigo);
    itens.forEach((it) => { assert.ok(!todos[it.id], 'id repetido entre modelos: ' + it.id); todos[it.id] = 1; });
  });
  const fa = C.normalizarItens(P.MODELOS[2].itens).find((it) => it.id === 'c5f1');
  assert.deepEqual(fa.amostras, {n: 32, unidade: 'g', nominal: 'PRODUTO', tolInfPct: 3, tolSupPct: null}, 'first article: 32 un, −3%');
});

ok('normalizar e validar perguntas', () => {
  const it = C.normalizarItem({texto: '  Limpo? ', tipo: 'XYZ'});
  assert.equal(it.texto, 'Limpo?'); assert.equal(it.tipo, 'SNA'); assert.equal(it.papel, 'QUALIDADE'); assert.equal(it.foto, 'NC');
  assert.match(it.id, /^i[a-z0-9]+$/);
  const erros = C.validarItens(C.normalizarItens([
    {id: 'a', texto: ''}, {id: 'a', texto: 'dup'},
    {id: 'b', texto: 'm', tipo: 'MEDIDA', medida: {min: 5, max: 1}},
    {id: 'c', texto: 'am', tipo: 'AMOSTRAS', amostras: {n: 3}},
    {id: 'd', texto: 'esc', tipo: 'ESCOLHA', opcoes: ['só uma']},
    {id: 'e', texto: 'txt', tipo: 'TEXTO', critico: true}
  ])).join(' | ');
  assert.match(erros, /Pergunta 1: escreva o texto/);
  assert.match(erros, /Pergunta 2: identificador repetido/);
  assert.match(erros, /mínimo é maior que o máximo/);
  assert.match(erros, /valor nominal/);
  assert.match(erros, /ao menos 2 opções/);
  assert.match(erros, /só pergunta Sim\/Não, medida ou amostras pode ser crítica/);
  assert.match(C.validarItens([]).join(), /pelo menos uma pergunta/);
});

ok('publicar: versão 1, depois 2; igual não publica; histórico imutável por caminho novo', () => {
  const itens = [{id: 'a', texto: 'Limpo?'}];
  const r1 = C.publicar('m1', {codigo: 'CK-9'}, itens, {por: 'Daiene', agora: 't1', nota: 'inicial'});
  assert.equal(r1.numero, 1);
  assert.equal(r1.updates['checklist_modelos/m1/versaoAtual'], 1);
  assert.equal(r1.updates['checklist_modelos/m1/versoes/1'].criadaPor, 'Daiene');
  assert.equal(r1.updates['checklist_modelos/m1/rascunho'], null);
  const modelo = {versaoAtual: 1, versoes: {1: r1.updates['checklist_modelos/m1/versoes/1']}};
  assert.match(C.publicar('m1', modelo, itens, {agora: 't2'}).erro, /Nada mudou desde a versão 1/);
  const r2 = C.publicar('m1', modelo, [{id: 'a', texto: 'Limpo e seco?'}, {id: 'b', texto: 'Sem odor?'}], {agora: 't2'});
  assert.equal(r2.numero, 2);
  assert.ok(!('checklist_modelos/m1/versoes/1' in r2.updates), 'não reescreve a versão anterior');
  assert.deepEqual(C.diferencas(modelo.versoes[1].itens, r2.updates['checklist_modelos/m1/versoes/2'].itens),
    {incluidos: ['Sem odor?'], removidos: [], alterados: ['Limpo e seco?']});
  assert.match(C.publicar('m1', modelo, [{id: 'x', texto: ''}], {}).erro, /escreva o texto/);
  assert.equal(C.versaoAtual({versaoAtual: 1, versoes: {1: {itens: itens}}}).numero, 1);
});

ok('avaliar: pendente, NC, crítico, NA e foto', () => {
  const itens = C.normalizarItens([
    {id: 'a', texto: 'Limpo', critico: true, foto: 'NC'},
    {id: 'b', texto: 'Sem odor'},
    {id: 'c', texto: 'Tempo', tipo: 'MEDIDA', medida: {min: 10, unidade: 'min'}, papel: 'EXECUTOR', foto: 'NUNCA'},
    {id: 'd', texto: 'Agente', tipo: 'ESCOLHA', opcoes: ['Água', 'Álcool 70%'], papel: 'EXECUTOR', foto: 'NUNCA'},
    {id: 'e', texto: 'Obs', tipo: 'TEXTO', obrigatorio: false, foto: 'NUNCA'},
    {id: 'f', texto: 'Etiqueta', foto: 'SEMPRE'}
  ]);
  let r = C.avaliar(itens, {});
  assert.equal(r.resultado, 'INCOMPLETO');
  assert.deepEqual(r.pendentes, ['a', 'b', 'c', 'd', 'f']);
  r = C.avaliar(itens, {a: {r: 'NA'}, b: {r: 'NA'}, c: {valor: '12'}, d: {escolha: 'Água'}, f: {r: 'S', fotos: [{url: 'x'}]}});
  assert.deepEqual(r.pendentes, ['a'], 'crítico não aceita NA');
  r = C.avaliar(itens, {a: {r: 'N'}, b: {r: 'S'}, c: {valor: '8'}, d: {escolha: 'Água'}, f: {r: 'S'}});
  assert.deepEqual(r.ncs, ['a', 'c']);
  assert.deepEqual(r.criticosNC, ['a']);
  assert.deepEqual(r.faltaFoto, ['a', 'f'], 'NC pede foto; SEMPRE pede foto');
  assert.equal(r.resultado, 'INCOMPLETO', 'sem as fotos não fecha');
  r = C.avaliar(itens, {a: {r: 'N', fotos: [1]}, b: {r: 'S'}, c: {valor: '8'}, d: {escolha: 'Água'}, f: {r: 'S', fotos: [1]}});
  assert.equal(r.resultado, 'REPROVADO');
  assert.match(r.itens.find((x) => x.id === 'c').detalhe, /8 fora de 10–… min/);
  r = C.avaliar(itens, {a: {r: 'S'}, b: {r: 'S'}, c: {valor: '10'}, d: {escolha: 'Água'}, f: {r: 'S', fotos: [1]}});
  assert.equal(r.resultado, 'APROVADO');
  // Só a parte do executor.
  r = C.avaliar(itens, {c: {valor: '10'}, d: {escolha: 'Água'}}, {papel: 'EXECUTOR'});
  assert.equal(r.resultado, 'APROVADO');
  assert.equal(r.itens.length, 2);
});

ok('first article: 32 amostras, nominal do produto, −3%', () => {
  const it = C.normalizarItens(P.MODELOS[2].itens).find((x) => x.id === 'c5f1');
  const boas = Array.from({length: 32}, (_, i) => 180 + (i % 3));
  let e = C.avaliarAmostras(it, boas, 180);
  assert.deepEqual([e.n, e.media, e.min, e.max, e.limiteInf, e.abaixo], [32, 180.97, 180, 182, 174.6, 0]);
  e = C.avaliarAmostras(it, boas.slice(0, 31).concat([174]), 180);
  assert.equal(e.abaixo, 1);
  const itens = [it];
  assert.equal(C.avaliar(itens, {c5f1: {valores: boas.slice(0, 10)}}, {nominalProduto: 180}).resultado, 'INCOMPLETO', 'menos de 32');
  assert.equal(C.avaliar(itens, {c5f1: {valores: boas}}, {}).resultado, 'INCOMPLETO', 'sem nominal não julga');
  assert.equal(C.avaliar(itens, {c5f1: {valores: boas}}, {nominalProduto: 180}).resultado, 'APROVADO');
  const rep = C.avaliar(itens, {c5f1: {valores: boas.slice(0, 31).concat([174])}}, {nominalProduto: 180});
  assert.equal(rep.resultado, 'REPROVADO');
  assert.deepEqual(rep.criticosNC, ['c5f1']);
});

console.log(`\nrun_checklists_test: ${n} OK`);
