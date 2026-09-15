'use strict';
/* Guarda de repositório: transação do RTDB não pode abortar no null.

   BUG REAL (2026-09-14). finalizarConferenciaPA fazia:

       confRef.transaction((atual) => { if (!atual) return; ... })

   O SDK chama o callback com o valor do CACHE LOCAL primeiro. Depois de um
   `.once()` o cache já esfriou, então a PRIMEIRA passada vem `null` --  e
   devolver `undefined` ABORTA a transação ali mesmo, sem nunca falar com o
   servidor. Resultado: `committed: false`, e o código reportava "Outra sessão
   já está finalizando esta OP" para uma OP que não tinha lock nenhum. Nenhuma
   conferência de PA conseguiu finalizar em produção por causa disso.

   Medido no emulador do Database, com firebase-admin 12.7.0:
       if (!atual) return;        -> passadas [null]        committed=false
       if (!atual) return atual;  -> passadas [null, dado]   committed=true

   A forma certa é devolver o próprio valor (null): o SDK então busca no
   servidor e reexecuta o callback com o dado real. Todas as outras transações
   do repo já faziam assim; só essa não. Este teste vale para o repo inteiro,
   para o mesmo deslize não voltar em outro lugar. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ── 1. A semântica, para quem ler este teste entender o porquê ───────────
// Fake FIEL ao SDK: primeira passada com o cache (null), undefined aborta.
function transacaoComoOSdk(valorNoServidor, atualizar) {
  const passadas = [];
  let cache = null; // depois de um .once(), é isto que o SDK tem em mãos
  let proposto = atualizar(cache);
  passadas.push('null');
  if (proposto === undefined) return {committed: false, passadas, valor: valorNoServidor};
  cache = valorNoServidor;
  proposto = atualizar(structuredClone(cache));
  passadas.push('dado');
  if (proposto === undefined) return {committed: false, passadas, valor: valorNoServidor};
  return {committed: true, passadas, valor: proposto};
}

const servidor = {status: 'AGUARDANDO_CONCILIACAO'};
const errado = transacaoComoOSdk(servidor, (a) => { if (!a) return; a.marcado = true; return a; });
assert.deepEqual(errado.passadas, ['null']);
assert.equal(errado.committed, false, 'devolver undefined no null aborta a transação');

const certo = transacaoComoOSdk(servidor, (a) => { if (!a) return a; a.marcado = true; return a; });
assert.deepEqual(certo.passadas, ['null', 'dado']);
assert.equal(certo.committed, true, 'devolver o próprio null faz o SDK reexecutar com o dado do servidor');
assert.equal(certo.valor.marcado, true);

// ── 2. Varre TODAS as transações do servidor atrás do padrão que aborta ──
const dir = path.join(__dirname, 'functions');
const arquivos = fs.readdirSync(dir).filter(n => n.endsWith('.js'));
const suspeitas = [];
arquivos.forEach((nome) => {
  const linhas = fs.readFileSync(path.join(dir, nome), 'utf8').split('\n');
  linhas.forEach((linha, i) => {
    if (!/\.transaction\(/.test(linha)) return;
    // Janela larga de propósito: o guard de null mora no começo do corpo, mas
    // pode vir depois de um bloco de comentário. Com 6 linhas a varredura
    // passava por cima justamente do caso que originou este teste.
    const corpo = linhas.slice(i, i + 30).join(' ');
    // `return;` ou `return undefined;` logo depois de um teste de ausência.
    const m = corpo.match(/if\s*\(\s*!\s*[A-Za-z_$][\w$]*\s*\)\s*return\s*(?:undefined\s*)?;/);
    if (m) suspeitas.push(nome + ':' + (i + 1) + '  ' + m[0]);
  });
});
assert.deepEqual(suspeitas, [],
  'transação que devolve undefined quando o valor é null aborta sem consultar o servidor:\n  ' +
  suspeitas.join('\n  ') + '\n  Use `return <valor>;` (o próprio null) para o SDK reexecutar.');

// ── 3. O site do bug especificamente, com a lição registrada ─────────────
const index = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
const trecho = index.slice(index.indexOf('const lock = await confRef.transaction('));
assert.ok(trecho, 'transação do lock da Conferência de PA não encontrada');
assert.ok(/if \(!atual\) return atual;/.test(trecho.slice(0, 1200)),
  'o lock da Conferência de PA precisa devolver o próprio valor no null');
assert.ok(/Não há Conferência de PA registrada para esta OP/.test(index),
  'nó inexistente não pode ser reportado como disputa de sessão');

console.log('run_transacoes_null_test: OK (' + arquivos.length + ' arquivos de functions varridos)');
