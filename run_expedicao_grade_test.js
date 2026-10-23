'use strict';
const assert = require('node:assert/strict');
const grade = require('./public/shared/expedicao-grade');
const palete = (caixas, multiplo, parcial) => ({caixasFechadas: caixas, unidadesPorCaixa: multiplo,
  unidadesCaixaParcial: parcial, saldoLote: caixas * multiplo + parcial});
const misto = palete(12, 24, 7), parcial = palete(0, 24, 7), fechado = palete(4, 24, 0);
assert.equal(grade.composicao(misto).resumo, '12 cx × 24 + 1 parcial com 7 = 295 un');
assert.equal(grade.composicao(misto).volumes, 13);
assert.equal(grade.composicao(parcial).resumo, '1 parcial com 7 = 7 un');
assert.equal(grade.composicao(parcial).volumes, 1);
assert.equal(grade.composicao(fechado).texto, '4 cx × 24');
assert.equal(grade.composicao({...misto, saldoLote: 270}).valida, false, 'Saldo alterado não pode exibir composição antiga como válida');
assert.equal(grade.composicao(palete(0, null, 7)).volumes, 1, 'Parcial sem múltiplo continua sendo uma caixa');
assert.equal(grade.composicao({saldoLote: 7}).valida, false, 'Legado sem conferência não pode inventar caixas');
assert.equal(grade.composicao(palete(1, 24, 24)).valida, false);
assert.equal(grade.composicao(palete(1, 24, -1)).valida, false);
assert.deepEqual(grade.totais([misto, parcial, fechado]), {paletes: 3, unidades: 398, caixasFechadas: 16, caixasParciais: 2, volumes: 18, composicoesPendentes: 0});
assert.equal(grade.diasEstoque('2026-09-01T20:00:00Z', '2026-09-11'), 10);
assert.equal(grade.diasEstoque('2026-09-11', '2026-09-01'), null);
assert.equal(grade.diasEstoque('2026-02-30', '2026-09-11'), null);
console.log('OK grade Expedição: caixas fechadas/parciais, volumes, saldo divergente, dados ausentes e dias em estoque.');

// Mesmo cliente com grafias diferentes (23/10/2026): "Miss Rose" x "MISS ROSE" x
// "MISS RÔSE" é UM cliente. Pedidos sem clienteKey comparavam o texto cru.
{
  const l = (cliente, clienteKey) => ({cliente, clienteKey: clienteKey || '', frete: {enderecoEntrega: 'Rua A', tipo: 'ENTREGA'}});
  const r = grade.selecionarTodos([l('Miss Rose'), l('MISS ROSE'), l('MISS RÔSE'), l(' miss  rose ', '')], []);
  assert.equal(r.selecionar.length, 4, 'as quatro grafias formam uma carga só');
  assert.equal(r.ignoradas, 0);
  const outro = grade.selecionarTodos([l('Miss Rose'), l('Bria Beauty')], []);
  assert.equal(outro.selecionar.length, 0, 'cliente diferente continua barrado');
  assert.match(outro.motivo, /2 clientes/);
  const misto = grade.selecionarTodos([l('Miss Rose'), l('MISS ROSE', 'MISS')], []);
  assert.equal(misto.selecionar.length, 2, 'com cadastro de um lado só, vale o nome');
  const cadastros = grade.selecionarTodos([l('Miss Rose', 'MISS'), l('Miss Rose', 'OUTRO')], []);
  assert.equal(cadastros.selecionar.length, 0, 'cadastros diferentes dos dois lados: clientes diferentes');
  console.log('OK grade Expedição: mesmo cliente com grafias diferentes.');
}
