'use strict';
/* chaveNome / opcoesPorNome (shared/utils.js, 19/10/2026): o mesmo cliente
   em grafias diferentes ("MISS RÔSE", "MISS ROSE", "Miss Rose") é UMA opção
   de filtro, e escolher a opção acha todas as grafias. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = {window: {}, console};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/shared/utils.js', 'utf8'), ctx, {filename: 'utils.js'});
const {chaveNome, opcoesPorNome} = ctx;

assert.equal(chaveNome('MISS RÔSE'), 'MISS ROSE');
assert.equal(chaveNome('  Miss   Rose '), 'MISS ROSE');
assert.equal(chaveNome('Briá Beauty'), chaveNome('BRIA BEAUTY'));
assert.equal(chaveNome('Glow Make Up'), chaveNome('GLOW  MAKE UP'));
assert.equal(chaveNome(null), '');
assert.equal(chaveNome(0), '0');
assert.notEqual(chaveNome('SEUNOURA'), chaveNome('SEUNOURA BEAUTY LTDA'), 'nome diferente continua diferente');

const ops = opcoesPorNome(['MISS RÔSE', 'MISS ROSE', 'Miss Rose', 'MISS RÔSE', 'Briá Beauty', 'BRIA BEAUTY', 'BRIA BEAUTY', '', null, 'AFEER']);
assert.deepEqual(JSON.parse(JSON.stringify(ops)), [
  {chave: 'AFEER', nome: 'AFEER'},
  {chave: 'BRIA BEAUTY', nome: 'BRIA BEAUTY'},
  {chave: 'MISS ROSE', nome: 'MISS RÔSE'}
], 'uma opção por cliente, com a grafia mais usada');

// Os pontos de filtro comparam pela chave, não pelo texto cru.
const fontes = {
  'public/shared/necessidade-pedidos-tela.js': /chaveNome\(p\.cliente\) !== S\.cli/,
  'public/cadastros.html': /chaveNome\(p\.cliente\) !== filtCli/,
  'public/planejamento.html': /chaveNome\(p\.cliente\) !== cli/,
  'public/shared/expedicao-grade-tela.js': /chaveClienteExp\(l\.cliente\)===filtroCliente/,
  'public/dashboard_analise.html': /cliAgg\[k\]/
};
for (const [f, re] of Object.entries(fontes)) assert.match(fs.readFileSync(f, 'utf8'), re, f);
assert.doesNotMatch(fs.readFileSync('public/shared/necessidade-pedidos-tela.js', 'utf8'), /p\.cliente !== S\.cli/);
console.log('run_chave_nome_test: OK');
