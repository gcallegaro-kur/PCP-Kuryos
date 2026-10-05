'use strict';
/* Conciliação da rotulagem: rotulado = envasado + perdas (frasco rotulado) + sobra declarada. Sem trava. */
const assert = require('node:assert/strict');
const CR = require('./public/shared/conciliacao-rotulagem.js');

const perdasEnvase = [{perdas: [
  {tipo: 'Frascos', quantidade: 20, etapa: 'envase', materialCodigo: 'EP-1'},
  {tipo: 'Rótulos', quantidade: 99, etapa: 'envase'},                       // rótulo perdido no envase: não é frasco rotulado
  {tipo: 'Produto envasado (un)', quantidade: 10, etapa: 'envase', produto: true},
  {tipo: 'Bulk (kg)', quantidade: 3, etapa: 'envase', produto: true},      // kg, não conta
  {tipo: 'Frascos', quantidade: 50, etapa: 'rotulagem'}                     // estragou ao rotular: nunca foi "rotulado"
]}];

// Perdas que entram na conta
const p = CR.perdasDoEnvase(perdasEnvase);
assert.deepEqual([p.frascos, p.produto, p.rotulagem, p.total], [20, 10, 50, 30]);
assert.deepEqual(CR.perdasDoEnvase([{tipo: 'Frascos', quantidade: 5, etapa: 'envase'}]).total, 5, 'aceita lista achatada');
assert.equal(CR.perdasDoEnvase(null).total, 0);

// Fechou certinho: 1000 rotulados = 900 envasados + 30 perdas + 70 de sobra
let op = {produzidoRotulagem: 1000, produzidoLinha: 900, contagemSobras: {a: {em: 'x'}}};
let c = CR.conciliar(op, perdasEnvase, [{tipo: 'FRASCO_ROTULADO', qtd: 70, status: 'EM_PROCESSO'}]);
assert.equal(c.estado, 'conciliada');
assert.equal(c.diferenca, 0);
assert.equal(c.saldoEmLinha, 70);
assert.equal(c.sobraDeclarada, 70);

// Sobra não declarada, OP encerrada: ficam 70 sem explicação
c = CR.conciliar({produzidoRotulagem: 1000, produzidoLinha: 900, contagemSobras: {a: {em: 'x'}}}, perdasEnvase, []);
assert.equal(c.estado, 'divergente');
assert.equal(c.diferenca, 70);
assert.match(CR.resumo(c).texto, /faltam explicar 70 un/);

// Dentro da tolerância informativa (0,5% de 1000 = 5): conciliada
c = CR.conciliar({produzidoRotulagem: 1000, produzidoLinha: 965, contagemSobras: {a: {em: 'x'}}}, perdasEnvase, []);
assert.equal(c.diferenca, 5);
assert.equal(c.estado, 'conciliada');
assert.equal(c.tolerancia, 5);

// OP em andamento (envase rodando): o saldo é ESTOQUE de frasco rotulado, não divergência
c = CR.conciliar({produzidoRotulagem: 1000, produzidoLinha: 300, abertaDesde: '2026-10-05T10:00:00Z', abertaDesdeRot: '2026-10-05T08:00:00Z'}, [], []);
assert.equal(c.estado, 'em_estoque');
assert.equal(c.saldoEmLinha, 700);
assert.match(CR.resumo(c).texto, /700 frascos rotulados em estoque/);

// Envasou mais do que rotulou (rotulagem sem apontar tudo)
c = CR.conciliar({produzidoRotulagem: 500, produzidoLinha: 900, contagemSobras: {a: 1}}, [], []);
assert.equal(c.estado, 'envasou_mais');
assert.equal(c.diferenca, -400);

// Caso real 26271/01: envase 3.840, rotulagem aberta e sem apontamento
c = CR.conciliar({produzidoRotulagem: 0, produzidoLinha: 3840, abertaDesdeRot: '2026-10-02T11:44:44Z', setupInicioRot: 'x'}, [], []);
assert.equal(c.estado, 'nao_apontada');
assert.match(CR.resumo(c).texto, /rotulagem sem apontamento/);

// Sem rotulagem nenhuma: nada a mostrar
assert.equal(CR.conciliar({produzidoLinha: 0}, [], []).estado, 'sem_dados');
assert.equal(CR.resumo(CR.conciliar({}, [], [])).texto, '');
// A sobra cancelada não conta
c = CR.conciliar({produzidoRotulagem: 100, produzidoLinha: 90, contagemSobras: {a: 1}}, [], [{tipo: 'FRASCO_ROTULADO', qtd: 10, status: 'CANCELADO'}]);
assert.equal(c.sobraDeclarada, 0);

// Sem trava: o módulo só descreve; não há função que bloqueie
assert.equal(typeof CR.bloquear, 'undefined');

console.log('OK Conciliação da rotulagem: balanço, perdas do envase, tolerância informativa, estoque em linha e caso 26271/01.');
