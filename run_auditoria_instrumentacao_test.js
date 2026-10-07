'use strict';
/* Executa as funções do chão de fábrica que ganharam eventos de auditoria,
 * procurando ReferenceError.
 *
 * Por que existe: em 07/10/2026 o evento RETOMAR_LINHA foi inserido em
 * `resumeLine(linha, state)` referenciando uma variável `lote` que NÃO existe
 * ali (o lote vem em `state.lote`). O erro estourava ao MONTAR o objeto do
 * argumento -- portanto no chamador, antes de `registrarEventoAuditoria` ser
 * invocada -- e o try/catch de dentro dela não protegia nada. Resultado em
 * produção: o operador clicava "Sim" em "Confirmar retomada?" e NADA
 * acontecia; a linha não retomava e o modal não fechava.
 *
 * Nenhuma checagem de sintaxe pega isso: `lote` é um identificador válido.
 * Só executar a função revela. É o que este teste faz.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/form.html', 'utf8');

// Mesmo extrator usado em run_apontamento_encerramento_test.js
function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Função não encontrada em form.html: ' + name);
  const open = source.indexOf('{', start);
  let depth = 0, quote = null, escaped = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('Função incompleta: ' + name);
}

let n = 0;
const eq = (a, b, m) => { n++; assert.equal(a, b, m); };
const ok = (c, m) => { n++; assert.ok(c, m); };

/* Promise de banco que registra o caminho escrito e nunca rejeita. */
function fakeDb(escritas) {
  const ref = (p) => ({
    set: (v) => { escritas.push({ op: 'set', path: p, val: v }); return Promise.resolve(); },
    update: (v) => { escritas.push({ op: 'update', path: p, val: v }); return Promise.resolve(); },
    push: (v) => { escritas.push({ op: 'push', path: p, val: v }); return Promise.resolve({ key: 'k1' }); },
    remove: () => { escritas.push({ op: 'remove', path: p }); return Promise.resolve(); }
  });
  return { ref };
}

// ── resumeLine: o caso que quebrou a fábrica ───────────────────────────────
{
  const escritas = [], eventos = [];
  const ctx = {
    console, Promise, Date, Math, parseFloat, parseInt, String, Number, Object,
    db: fakeDb(escritas),
    sanitizeKey: (s) => String(s).replace(/[.#$[\]/]/g, '_'),
    RetrabalhosTela: { avisar: () => false },
    setorDoRecurso: () => 'linha',
    registrarEventoAuditoria: (d) => { eventos.push(d); },
    showSuccess: () => {},
    confirmingResumeLinha: null,
    renderPainelTurno: () => {},
    updateAndonFormUI: () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction('resumeLine'), ctx);

  const state = {
    inicioParada: new Date(Date.now() - 20 * 60000).toISOString(),
    setor: 'linha', pedidoId: '0019', produto: 'HIDRATANTE FLOR 200 ML',
    lote: '26278/04', motivoParada: 'Falta de Material'
  };
  // Antes da correção, esta chamada lançava ReferenceError: lote is not defined
  assert.doesNotThrow(() => ctx.resumeLine('Linha 1', state),
    'resumeLine lançou — é exatamente o bug que travou a retomada em produção');
  n++;

  // E o efeito que importa: o update que REATIVA a linha precisa ter acontecido
  const ativou = escritas.find((e) => e.op === 'update' && /estado_linhas/.test(e.path) && e.val && e.val.status === 'ativa');
  ok(ativou, 'resumeLine tem que gravar status=ativa em estado_linhas — sem isso a linha não retoma');
  const parada = escritas.find((e) => e.op === 'push' && /paradas_historico/.test(e.path));
  ok(parada, 'e registrar a parada encerrada no histórico');
  eq(parada.val.lote, '26278/04', 'a parada leva o lote vindo de state.lote');

  // O evento de auditoria usa state.lote, não uma variável solta
  eq(eventos.length, 1, 'gera um evento de auditoria');
  eq(eventos[0].acao, 'RETOMAR_LINHA', 'da ação certa');
  eq(eventos[0].lote, '26278/04', 'com o lote tirado de state.lote');
  eq(eventos[0].linhaDe, 'Linha 1', 'e a linha retomada');
  ok(/Falta de Material/.test(eventos[0].motivo), 'o motivo da parada entra no evento');

  // Linha parada sem lote (acontece: parada de fim de turno) não pode quebrar
  const escritas2 = [], eventos2 = [];
  const ctx2 = Object.assign({}, ctx, { db: fakeDb(escritas2), registrarEventoAuditoria: (d) => eventos2.push(d) });
  vm.createContext(ctx2);
  vm.runInContext(extractFunction('resumeLine'), ctx2);
  assert.doesNotThrow(() => ctx2.resumeLine('Linha 2', { inicioParada: null }),
    'retomar linha sem lote nem motivo não pode quebrar');
  n++;
  eq(eventos2[0].lote, null, 'sem lote, o evento grava null e segue');
  ok(escritas2.some((e) => e.op === 'update' && e.val && e.val.status === 'ativa'),
    'e a linha retoma do mesmo jeito');
}

// ── rememberOPForLine: quem põe a OP na linha ──────────────────────────────
{
  const escritas = [], eventos = [];
  const ctx = {
    console, Promise, Date, Math, String, Object,
    db: fakeDb(escritas),
    sanitizeKey: (s) => String(s).replace(/[.#$[\]/]/g, '_'),
    configLinhas: ['Linha 1', 'Linha 2', 'Linha 3'],
    latestAndonStates: { 'Linha 1': { opAtual: { lote: '26278/03' } } },
    findOpByLote: () => ({ produto: 'HIDRATANTE FLOR 200 ML' }),
    registrarEventoAuditoria: (d) => { eventos.push(d); }
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction('rememberOPForLine'), ctx);

  assert.doesNotThrow(() => ctx.rememberOPForLine('Linha 1', '26278/04'), 'rememberOPForLine não pode lançar');
  n++;
  ok(escritas.some((e) => /opAtual/.test(e.path) && e.val && e.val.lote === '26278/04'),
    'grava a OP lembrada da linha — é o comportamento original, que não pode ter se perdido');

  // Linha fora de config não grava (regra original)
  const escritas3 = [];
  const ctx3 = Object.assign({}, ctx, { db: fakeDb(escritas3) });
  vm.createContext(ctx3);
  vm.runInContext(extractFunction('rememberOPForLine'), ctx3);
  ctx3.rememberOPForLine('Rotulagem 01', '26278/04');
  eq(escritas3.length, 0, 'linha fora de config.linhas continua sendo ignorada');
}

console.log('OK instrumentacao do apontamento: ' + n + ' verificacoes — resumeLine e rememberOPForLine ' +
  'executam sem ReferenceError, a linha volta a ficar ativa e a OP lembrada continua sendo gravada.');
