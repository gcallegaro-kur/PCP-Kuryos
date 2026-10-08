'use strict';
/* Encerramento de pedido (08/10/2026) -- shared/encerramento-pedido.js.
   PCP e Comercial encerram; motivo obrigatório; 95% vira só aviso. */
const assert = require('node:assert/strict');
const E = require('./public/shared/encerramento-pedido.js');
let n = 0; const ok = (nome, fn) => { fn(); n++; console.log('ok -', nome); };

// Pedido 05 da Febella como estava em 08/10.
const PED = () => ({
  '05__FBBS0002': {id: '05', parentPedidoId: '05', sku: 'FBBS0002', produto: 'SORVETE 120', qtdTotal: 10000, produzido: 9549, status: 'Produção Parcial'},
  '05__FBHD0002': {id: '05', parentPedidoId: '05', sku: 'FBHD0002', produto: 'HIDRATANTE', qtdTotal: 10000, produzido: 9900, status: 'Produção Parcial'},
  '05__FBMF0002': {id: '05', parentPedidoId: '05', sku: 'FBMF0002', produto: 'MOUSSE', qtdTotal: 10000, produzido: 9984, status: 'Produção Parcial'},
  '05__FBBS0003': {id: '05', parentPedidoId: '05', sku: 'FBBS0003', qtdTotal: 10000, produzido: 9107, statusManual: 'encerrado'},
  '05__FBBS0005': {id: '05', parentPedidoId: '05', sku: 'FBBS0005', qtdTotal: 10000, produzido: 14147, status: 'Concluído'},
  '050__X': {id: '050', parentPedidoId: '050', sku: 'X', qtdTotal: 10, produzido: 0},
  'PED-0010__A': {id: 'PED-0010', parentPedidoId: 'PED-0010', sku: 'A', qtdTotal: 1000, produzido: 940}
});

ok('situação: 95% é aviso (pronto), não concluído', () => {
  const p = PED();
  assert.equal(E.situacao(p['05__FBBS0002']), 'pronto');
  assert.equal(E.situacao(p['05__FBMF0002']), 'pronto');
  assert.equal(E.situacao(p['05__FBBS0003']), 'encerrado');
  assert.equal(E.situacao(p['05__FBBS0005']), 'concluido');
  assert.equal(E.situacao(p['PED-0010__A']), 'andamento', '94%');
  assert.equal(E.situacao({qtdTotal: 100, produzido: 100}), 'concluido', '100% conclui');
});

ok('linhas do pedido: não confunde 05 com 050', () => {
  assert.deepEqual(E.linhasDoPedido(PED(), '05'), ['05__FBBS0002', '05__FBBS0003', '05__FBBS0005', '05__FBHD0002', '05__FBMF0002']);
});

ok('encerrar o pedido inteiro: só as abertas, com quem/quando/motivo/saldo', () => {
  const p = PED();
  const r = E.montarEncerramento(p, E.linhasDoPedido(p, '05'), {motivoTipo: 'CLIENTE_ACEITOU_MENOS', texto: 'cliente ok', por: 'Diego', origem: 'COMERCIAL', agora: '2026-10-08T15:00:00Z'});
  assert.equal(r.ok, true);
  // FBBS0005 (Concluído) e FBBS0003 (já encerrada) ficam como estão.
  assert.deepEqual(r.linhas.map((l) => l.key), ['05__FBBS0002', '05__FBHD0002', '05__FBMF0002']);
  assert.equal(r.updates['pedidos/05__FBBS0002/statusManual'], 'encerrado');
  const reg = r.updates['pedidos/05__FBBS0002/encerramento'];
  assert.deepEqual([reg.motivo, reg.texto, reg.por, reg.origem, reg.saldoNaoProduzido, reg.em], ['Cliente aceitou receber menos', 'cliente ok', 'Diego', 'COMERCIAL', 451, '2026-10-08T15:00:00Z']);
  assert.equal(r.updates['pedidos/05__FBBS0005/statusManual'], undefined, 'concluída não é tocada');
  assert.equal(r.updates['pedidos/05__FBBS0003/statusManual'], undefined, 'não regrava quem já encerrou');
  const hist = Object.keys(r.updates).filter((k) => /encerramentoHistorico/.test(k));
  assert.equal(hist.length, 3);
  assert.equal(new Set(hist).size, 3, 'chaves de histórico distintas');
});

ok('motivo obrigatório; "Outro" exige texto; usuário obrigatório', () => {
  const p = PED(), k = ['05__FBBS0002'];
  assert.match(E.montarEncerramento(p, k, {por: 'x'}).erro, /motivo/);
  assert.match(E.montarEncerramento(p, k, {motivoTipo: 'OUTRO', por: 'x'}).erro, /Descreva/);
  assert.equal(E.montarEncerramento(p, k, {motivoTipo: 'OUTRO', texto: 'y', por: 'x'}).ok, true);
  assert.match(E.montarEncerramento(p, k, {motivoTipo: 'ATENDIDO_TOLERANCIA'}).erro, /Usuário/);
  assert.match(E.montarEncerramento(p, ['05__FBBS0003'], {motivoTipo: 'ATENDIDO_TOLERANCIA', por: 'x'}).erro, /Nada a encerrar/);
});

ok('reabrir: motivo obrigatório; cancelamento do Comercial só o Comercial reabre', () => {
  const p = PED();
  p['05__FBHD0002'].statusManual = 'encerrado'; p['05__FBHD0002'].encerramento = {em: 'x'};
  p['05__FBMF0002'].statusManual = 'encerrado'; p['05__FBMF0002'].canceladoPorComercial = true;
  assert.match(E.montarReabertura(p, ['05__FBHD0002'], {por: 'a'}).erro, /motivo/);
  const r = E.montarReabertura(p, ['05__FBHD0002', '05__FBMF0002'], {texto: 'cliente pediu o saldo', por: 'Ana', origem: 'PCP', agora: '2026-10-08T16:00:00Z'});
  assert.deepEqual(r.linhas.map((l) => l.key), ['05__FBHD0002']);
  assert.equal(r.updates['pedidos/05__FBHD0002/statusManual'], null);
  assert.equal(r.updates['pedidos/05__FBHD0002/encerramento'], null);
  const rc = E.montarReabertura(p, ['05__FBMF0002'], {texto: 'x', por: 'Diego', origem: 'COMERCIAL'});
  assert.equal(rc.ok, true);
  assert.equal(rc.updates['pedidos/05__FBMF0002/canceladoPorComercial'], null);
});

ok('descrição para o hover', () => {
  const d = E.descricao({encerramento: {por: 'Diego', origem: 'COMERCIAL', em: '2026-10-08T15:00:00Z', motivo: 'Cliente aceitou receber menos', texto: 'ok', saldoNaoProduzido: 451}});
  assert.equal(d, 'Encerrado por Diego (Comercial) em 08/10/2026: Cliente aceitou receber menos — ok. Ficaram 451 un sem produzir.');
  assert.equal(E.descricao({canceladoPorComercial: true}), 'Saldo cancelado pelo Comercial');
});

console.log(`\nrun_encerramento_pedido_test: ${n} OK`);
