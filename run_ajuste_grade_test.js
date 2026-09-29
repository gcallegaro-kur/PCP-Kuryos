const assert = require('assert');
const path = require('path');
const A = require(path.join(__dirname, 'public', 'shared', 'ajuste-grade.js'));

// Turno 07–17 com pausa 12–13, seg–sex.
const cal = {turnos: ['A'], horarios: {A: '07:00'}, fim: {A: '17:00'}, pausas: {A: {inicio: '12:00', fim: '13:00'}}, diasSemana: [1, 2, 3, 4, 5]};
const linhas = ['Linha 1', 'Linha 2'];
const slot = (ped, mph, extra) => Object.assign({pedidoKey: ped, produto: ped, sku: ped, mediaPorHora: mph}, extra || {});
// Terça 29/09, 08:30. Na Linha 1: A 09–11 (500/h), B 11 e 13–14, vago 15, C 16.
function grade() {
  return {
    '2026-09-29': {
      '08_00': {env1: slot('A', 500)},
      '09_00': {env1: slot('A', 500)}, '10_00': {env1: slot('A', 500)},
      '11_00': {env1: slot('B', 300)}, '13_00': {env1: slot('B', 300)}, '14_00': {env1: slot('B', 300)},
      '16_00': {env1: slot('C', 200)}
    }
  };
}
const agora = new Date(2026, 8, 29, 8, 30);
const base = {linha: 'Linha 1', linhasCfg: linhas, agora, cal, dias: 3};

// ── O que a grade ainda reserva: só depois da hora corrente ─────────────
assert.strictEqual(A.reservadoFuturo(grade(), 'A', agora), 1250, 'das 08:00 só a meia hora que falta; 09 e 10 inteiras');
assert.strictEqual(A.indiceDaLinha({linha1: 'Linha 2'}, 'Linha 2', linhas), 1, 'nome gravado na hora vence o cadastro');
assert.strictEqual(A.indiceDaLinha({linha2: 'Linha 1'}, 'Linha 2', linhas), null, 'posição do cadastro ocupada por outra linha');

// ── Mais lento: faltam 1.800, a grade reserva 1.250 → +2 h ──────────────
{
  const r = A.planejar({...base, programacao: grade(), pedidoKey: 'A', pedido: {qtdTotal: 2000, produzido: 200}});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.horas, 2);
  const u = r.updates;
  // A ganha 11:00 e 13:00. B (11, 13, 14) passa a 14, 15, 16: o vago das 15
  // absorve uma das duas horas; a outra empurra C (16h) para o próximo horário
  // vago, 07:00 do dia seguinte (o turno acaba às 17h).
  assert.strictEqual(u['programacao/2026-09-29/11_00/env1'].pedidoKey, 'A');
  assert.strictEqual(u['programacao/2026-09-29/13_00/env1'].pedidoKey, 'A');
  assert.strictEqual(u['programacao/2026-09-29/14_00/env1'], undefined, 'B continua às 14');
  assert.strictEqual(u['programacao/2026-09-29/15_00/env1'].pedidoKey, 'B', 'B ocupa o vago das 15');
  assert.strictEqual(u['programacao/2026-09-29/16_00/env1'].pedidoKey, 'B');
  assert.strictEqual(u['programacao/2026-09-30/07_00/env1'].pedidoKey, 'C', 'C vai para o próximo horário vago');
  assert.deepStrictEqual(r.movidos.sort(), ['B', 'C']);
  assert.strictEqual(u['programacao/2026-09-29/11_00/env1'].mediaPorHora, 500, 'novas horas no ritmo do pedido');
  assert.ok(Object.values(u).every((v) => v === null || !('lote' in v) || v.pedidoKey !== 'A'), 'hora nova não herda lote de OP');
  assert.match(r.resumo, /Acrescentar 2 h ao pedido na Linha 1 \(faltam 1800 un; a grade reservava 1250 un a 500 un\/h\)\. Empurra 2 outro/);
  assert.ok(Object.keys(u).every((k) => /^programacao\/\d{4}-\d{2}-\d{2}\/\d{2}_00\/env\d$/.test(k)), 'só caminhos planos de slot');
}

// ── Folga logo depois: não empurra ninguém ─────────────────────────────
{
  const g = grade();
  const r = A.planejar({...base, programacao: g, pedidoKey: 'C', pedido: {qtdTotal: 400, produzido: 0}});
  assert.strictEqual(r.horas, 1);
  assert.deepStrictEqual(Object.keys(r.updates), ['programacao/2026-09-30/07_00/env1']);
  assert.deepStrictEqual(r.movidos, []);
  assert.match(r.resumo, /sem empurrar ninguém/);
}

// ── Mais rápido: sobra → libera as últimas horas, não puxa ninguém ──────
{
  const r = A.planejar({...base, programacao: grade(), pedidoKey: 'B', pedido: {qtdTotal: 900, produzido: 450}});
  // Falta 450; reservado 900 (3 × 300). Libera 14:00 (fica 600 ≥ 450), não 13:00 (300 < 450).
  assert.strictEqual(r.horas, -1);
  assert.deepStrictEqual(r.updates, {'programacao/2026-09-29/14_00/env1': null});
  assert.deepStrictEqual(r.movidos, []);
  assert.match(r.resumo, /Liberar 1 h do fim do pedido na Linha 1.*Ninguém é puxado para a frente/);
}

// ── No plano: nada a fazer ──────────────────────────────────────────────
{
  const r = A.planejar({...base, programacao: grade(), pedidoKey: 'A', pedido: {qtdTotal: 1100, produzido: 100}});
  assert.strictEqual(r.horas, 0);
  assert.deepStrictEqual(r.updates, {});
  assert.match(r.resumo, /Nada a ajustar/);
}

// ── Pedido que ficou todo para trás: entra no primeiro horário ──────────
{
  const g = {'2026-09-28': {'10_00': {env1: slot('Z', 400)}}, '2026-09-29': {'09_00': {env1: slot('B', 300)}}};
  const r = A.planejar({...base, programacao: g, pedidoKey: 'Z', pedido: {qtdTotal: 800, produzido: 0, mediaPorHora: 400}});
  assert.strictEqual(r.horas, 2);
  // Linha livre às 08:30: o atrasado começa já, na hora corrente.
  assert.strictEqual(r.updates['programacao/2026-09-29/08_00/env1'].pedidoKey, 'Z');
  assert.strictEqual(r.updates['programacao/2026-09-29/09_00/env1'].pedidoKey, 'Z');
  assert.strictEqual(r.updates['programacao/2026-09-29/10_00/env1'].pedidoKey, 'B', 'B empurrado para depois');
  // Hora corrente ocupada por outro pedido (rodando): nada entra antes dele.
  const g2 = {'2026-09-29': {'08_00': {env1: slot('B', 300)}}};
  const r2 = A.planejar({...base, programacao: g2, pedidoKey: 'Z', pedido: {qtdTotal: 400, produzido: 0, mediaPorHora: 400}});
  assert.deepStrictEqual(Object.keys(r2.updates), ['programacao/2026-09-29/09_00/env1']);
  // Linha do último horário futuro do pedido (é depois dele que as horas entram).
  const g3 = grade();
  g3['2026-09-30'] = {'07_00': {env2: slot('A', 500)}};
  assert.strictEqual(A.linhaDoPedido(g3, 'A', linhas, agora), 'Linha 2');
  assert.strictEqual(A.linhaDoPedido(grade(), 'A', linhas, agora), 'Linha 1');
  assert.strictEqual(A.linhaDoPedido(grade(), 'Z', linhas, agora), null);
}

// ── Erros claros em vez de gravar meia grade ────────────────────────────
{
  const semRitmo = A.planejar({...base, programacao: {}, pedidoKey: 'Q', pedido: {qtdTotal: 100}});
  assert.strictEqual(semRitmo.ok, false);
  assert.match(semRitmo.erro, /não tem ritmo/);
  const cheia = {};
  ['2026-09-29', '2026-09-30', '2026-10-01'].forEach((d) => {
    cheia[d] = {};
    [7, 8, 9, 10, 11, 13, 14, 15, 16].forEach((h) => { cheia[d][String(h).padStart(2, '0') + '_00'] = {env1: slot('X', 100)}; });
  });
  const semVaga = A.planejar({...base, programacao: cheia, pedidoKey: 'X', pedido: {qtdTotal: 99999, produzido: 0}});
  assert.strictEqual(semVaga.ok, false);
  assert.match(semVaga.erro, /Não há .* h vagas na Linha 1/);
  const semTurno = A.planejar({...base, cal: {turnos: []}, programacao: grade(), pedidoKey: 'A', pedido: {qtdTotal: 5000}});
  assert.match(semTurno.erro, /não tem horário de turno/);
}

// ── Outra linha não é tocada; reservado conta todas as linhas ───────────
{
  const g = grade();
  g['2026-09-29']['15_00'] = {env2: slot('A', 500)};
  const r = A.planejar({...base, programacao: g, pedidoKey: 'A', pedido: {qtdTotal: 2000, produzido: 250}});
  assert.strictEqual(r.reservado, 1750, 'meia hora das 08 + 09 + 10 + as 15h da Linha 2');
  assert.strictEqual(r.horas, 0);
}

console.log('run_ajuste_grade_test.js: OK');
