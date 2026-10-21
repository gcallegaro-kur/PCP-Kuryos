'use strict';
/* Dossiê do lote: busca por data (21/10/2026). Regra pura + a tela. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require(path.join(__dirname, 'public', 'shared', 'dossie-lote.js'));

const ops = {
  a: {lote: '26250/02', produto: 'BODY SPLASH A', cliente: 'MISS ROSE', dataEmissao: '2026-10-10T08:00:00', dataInicioReal: '2026-10-15T13:00:00Z', dataFimReal: '2026-10-15T20:00:00Z', confirmadoEm: '2026-10-16T12:00:00Z'},
  // produção que ATRAVESSA a meia-noite e o dia (início 14/10, fim 16/10)
  b: {lote: '26251/01', produto: 'HIDRATANTE B', cliente: 'GLOW', dataInicioReal: '2026-10-14T20:00:00', dataFimReal: '2026-10-16T10:00:00'},
  // sem fuso: vale como está; 23:30Z de 15/10 = 20:30 de 15/10 em São Paulo
  c: {lote: '26252/01', produto: 'PERFUME C', cliente: 'AFEER', dataInicioReal: '2026-10-15T23:30:00Z', dataFimReal: '2026-10-16T01:30:00Z'},
  // 02:00Z de 16/10 = 23:00 de 15/10 em São Paulo (o dia local é o 15)
  d: {lote: '26253/01', produto: 'ESPUMA D', cliente: 'SEUNOURA', dataInicioReal: '2026-10-16T02:00:00Z', dataFimReal: '2026-10-16T02:30:00Z'},
  e: {lote: '26254/01', produto: 'SEM DATA E', cliente: 'LEGADO'},
  f: {lote: '25014/02', produto: 'ANTIGO F', cliente: 'MISS ROSE', dataInicioReal: '2025-01-16T07:00:00', dataFimReal: '2025-01-16T09:45:00'}
};
const lotes = (r) => r.itens.map((o) => o.lote).sort();

// ── dia local ───────────────────────────────────────────────────────────────
assert.equal(D.diaLocal('2026-10-15T20:00:00.000Z'), '2026-10-15');
assert.equal(D.diaLocal('2026-10-16T02:00:00Z'), '2026-10-15', 'Z convertido para São Paulo');
assert.equal(D.diaLocal('2026-07-29T15:49:54'), '2026-07-29', 'sem fuso vale como está');
assert.equal(D.diaLocal('2026-10-16'), '2026-10-16');
assert.equal(D.diaLocal(''), ''); assert.equal(D.diaLocal('lixo'), ''); assert.equal(D.diaLocal(null), '');
assert.deepEqual(D.datasDaOp(ops.a), {emissao: '2026-10-10', inicio: '2026-10-15', fim: '2026-10-15', confirmacao: '2026-10-16', producaoDe: '2026-10-15', producaoAte: '2026-10-15'});
assert.equal(D.datasDaOp({dataFimReal: '2026-10-15T10:00:00'}).producaoDe, '2026-10-15', 'só o fim: produção naquele dia');

// ── palavra que é data ──────────────────────────────────────────────────────
assert.deepEqual(D.dataDaPalavra('15/10/2026'), {dia: '2026-10-15'});
assert.deepEqual(D.dataDaPalavra('5/1/26'), {dia: '2026-01-05'});
assert.deepEqual(D.dataDaPalavra('15-10-2026'), {dia: '2026-10-15'});
assert.deepEqual(D.dataDaPalavra('2026-10-15'), {dia: '2026-10-15'});
assert.deepEqual(D.dataDaPalavra('15/10'), {diames: '10-15'});
for (const nao of ['26250/02', '26250', 'miss', '15', '2026', '15/10/2026/1', '']) assert.equal(D.dataDaPalavra(nao), null, nao);

// ── Data digitada no campo de busca ─────────────────────────────────────────
assert.deepEqual(lotes(D.buscar(ops, '15/10/2026')), ['26250/02', '26251/01', '26252/01', '26253/01'].sort(), 'produzido no dia (inclusive atravessando o dia e o fuso)');
assert.deepEqual(lotes(D.buscar(ops, '16/10/2026')), ['26250/02', '26251/01'], 'confirmação e produção que atravessa o dia; o 26252 terminou 22:30 do dia 15 em São Paulo');
assert.deepEqual(lotes(D.buscar(ops, '10/10/2026')), ['26250/02'], 'emissão');
assert.deepEqual(lotes(D.buscar(ops, '16/01')), ['25014/02'], 'dia/mês de qualquer ano');
assert.deepEqual(lotes(D.buscar(ops, '15/10/2026 miss')), ['26250/02'], 'data + texto');
assert.deepEqual(lotes(D.buscar(ops, '15/10/2026 glow')), ['26251/01']);
assert.equal(D.buscar(ops, '01/01/2030').total, 0);
assert.ok(!lotes(D.buscar(ops, '15/10/2026')).includes('26254/01'), 'OP sem data não aparece em busca por data');
assert.deepEqual(lotes(D.buscar(ops, '26250/02')), ['26250/02'], 'lote continua sendo lote, não data');
assert.equal(D.buscar(ops, '').total, 6, 'sem termo: todas');

// ── Filtro por intervalo ────────────────────────────────────────────────────
const f = (campo, de, ate) => lotes(D.buscar(ops, '', 50, {campo, de, ate}));
assert.deepEqual(f('producao', '2026-10-15'), ['26250/02', '26251/01', '26252/01', '26253/01'].sort(), 'só "De" = aquele dia');
assert.deepEqual(f('producao', '2026-10-16', '2026-10-16'), ['26251/01']);
assert.deepEqual(f('producao', '2026-10-01', '2026-10-31'), ['26250/02', '26251/01', '26252/01', '26253/01'].sort());
assert.deepEqual(f('producao', '2025-01-01', '2025-12-31'), ['25014/02']);
assert.deepEqual(f('producao', '', '2025-12-31'), ['25014/02'], 'só "Até": tudo até essa data');
assert.deepEqual(f('producao', '2026-10-16', ''), ['26251/01'], 'só De = o dia (não "em diante")');
assert.deepEqual(f('emissao', '2026-10-01', '2026-10-31'), ['26250/02']);
assert.deepEqual(f('confirmacao', '2026-10-16'), ['26250/02']);
assert.deepEqual(f('producao', '2026-10-17', '2026-10-30'), []);
// Combina com texto.
assert.deepEqual(lotes(D.buscar(ops, 'miss rose', 50, {campo: 'producao', de: '2026-10-01', ate: '2026-10-31'})), ['26250/02']);
// Ordem: produção mais recente primeiro (o 26251 termina dia 16).
assert.deepEqual(D.buscar(ops, '', 50, {campo: 'producao', de: '2025-01-01', ate: '2026-12-31'}).itens.map((o) => o.lote), ['26251/01', '26250/02', '26253/01', '26252/01', '25014/02'], 'mais recente primeiro; empate: emissão e lote');
// Sem filtro de data nada muda (ordem por emissão, como antes).
assert.equal(D.buscar(ops, 'rose').total, 2);

// ── Tela ────────────────────────────────────────────────────────────────────
const html = fs.readFileSync('public/dossie_lote.html', 'utf8');
for (const id of ['dDe', 'dAte', 'dCampoData', 'dLimparData']) assert.ok(new RegExp('id="' + id + '"').test(html), id);
assert.ok(/DossieLote\.buscar\(allOps, termo, 40, filtroData\)/.test(html) && /<th>Produção<\/th>/.test(html) && /function producaoDa/.test(html));
console.log('run_dossie_busca_data_test: OK');
