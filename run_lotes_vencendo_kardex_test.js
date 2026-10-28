'use strict';
/* Lotes Vencendo (estoque.html): cada linha leva ao Kardex do item. Executa a função
   real da tela com um DOM mínimo e confere os links, que o Kardex resolve por `?item=`. */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('public/estoque.html', 'utf8');
const ini = html.indexOf('function renderLotesVencendo() {');
const fim = html.indexOf('/* ═══', ini);
assert.ok(ini > 0 && fim > ini, 'renderLotesVencendo não encontrada em estoque.html');
const fonte = html.slice(ini, fim);

const dia = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const lotes = {
  MP_A: {l1: {itemCodigo: 'MPES-00142', itemNome: 'ÁLCOOL', loteOrigem: 'L1', dataValidade: dia(-3), saldoLote: 10, unidade: 'kg', enderecoCodigo: 'A-01'}},
  'MP B/2': {l2: {itemNome: 'SEM CÓDIGO', loteOrigem: 'L2', dataValidade: dia(5), saldoLote: 4, unidade: 'un'}},
  MP_C: {l3: {itemCodigo: 'MPES-9', itemNome: 'LONGE', dataValidade: dia(400), saldoLote: 1}, l4: {itemCodigo: 'MPES-9', dataValidade: dia(2), saldoLote: 0}}
};
const nos = {lvDias: {value: '30'}, lvCount: {textContent: ''}, lvBody: {innerHTML: ''}};
const render = new Function('document', 'todosOsLotes', 'escapeHtml', 'fmtNum', 'fmtData', fonte + '; return renderLotesVencendo;')(
  {getElementById: (id) => nos[id]},
  () => Object.keys(lotes).flatMap((k) => Object.keys(lotes[k]).map((l) => ({itemKey: k, loteKey: l, lote: lotes[k][l]}))),
  (s) => String(s).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c])),
  (n) => String(n), (d) => d
);
render();
assert.equal(nos.lvCount.textContent, 'Lotes vencendo em até 30 dias (2)', 'só com saldo e dentro do prazo; o de 400 dias e o sem saldo ficam de fora');
const links = [...nos.lvBody.innerHTML.matchAll(/href="(kardex\.html\?item=[^"]*)"/g)].map((m) => m[1]);
assert.deepEqual(links, ['kardex.html?item=MPES-00142', 'kardex.html?item=MP%20B%2F2'], 'usa o código do item; sem código, a chave (com escape)');
assert.equal((nos.lvBody.innerHTML.match(/<tr>/g) || []).length, 2);
assert.match(nos.lvBody.innerHTML, /Ver kardex/);
assert.equal((nos.lvBody.innerHTML.match(/<td/g) || []).length, 14, '7 colunas por linha');

// Tabela vazia e cabeçalho acompanham as 7 colunas.
lotes.MP_A.l1.saldoLote = 0; lotes['MP B/2'].l2.saldoLote = 0; render();
assert.match(nos.lvBody.innerHTML, /colspan="7"/);
assert.match(html, /<th style="text-align:right">Saldo<\/th><th><\/th><\/tr><\/thead>\s*<tbody id="lvBody"><tr><td colspan="7"/);

// O Kardex abre o item por `?item=` (chave ou código).
const kardex = fs.readFileSync('public/kardex.html', 'utf8');
assert.match(kardex, /get\('item'\)/); assert.match(kardex, /k === alvo \|\| catalogoAtual\[k\]\.codigo === alvo/);

console.log('run_lotes_vencendo_kardex_test: OK');
