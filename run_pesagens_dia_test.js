'use strict';
/* Pesagens do dia + pendências (21/10/2026). */
const assert = require('node:assert/strict');
const P = require('./public/shared/pesagens-dia.js');

assert.equal(P.diaLocal('2026-10-20T01:30:00Z'), '2026-10-19', 'madrugada UTC ainda é o dia anterior em SP');
assert.equal(P.diaLocal('2026-10-20T11:21:35Z'), '2026-10-20');
assert.equal(P.horaLocal('2026-10-20T11:21:35Z'), '08:21');
assert.equal(P.diaLocal('lixo'), '');
assert.equal(P.somaDias('2026-10-31', 1), '2026-11-01'); assert.equal(P.diasEntre('2026-10-21', '2026-10-25'), 4);

const prev = {m1: {mpCodigo: 'MP1', mpNome: 'Água', previsto: 10, unidade: 'kg'}, m2: {mpCodigo: 'MP2', mpNome: 'Óleo', previsto: 5, unidade: 'kg'}};
const foto = {caminho: 'x.jpg', url: 'http://f/x.jpg'};
const parc = (peso, em, por, extra) => Object.assign({peso, em, por, loteMaterial: 'L1', foto}, extra);
const ops = {
  a: {lote: '26001/01', produto: 'HID A', cliente: 'C1', status: 'Programado', dataEmissao: '2026-10-10T10:00:00Z', formulaVersao: 'v1', skuPedidoKey: 'P1__A',
    manipulacao: {status: 'AGUARDANDO_PESAGEM', previstos: prev, pesagem: {parcelas: {
      m1: {p1: parc(10, '2026-10-20T11:00:00Z', 'Ana'), p2: parc(3, '2026-10-20T12:00:00Z', 'Ana', {foto: null}), p3: parc(99, '2026-10-20T12:30:00Z', 'Ana', {canceladaEm: 'x'})},
      m2: {p4: parc(5, '2026-10-19T12:00:00Z', 'Beto')}}}}},
  b: {lote: '26002/01', produto: 'HID B', cliente: 'C2', status: 'Programado', dataEmissao: '2026-10-10T10:00:00Z', formulaVersao: 'v1', skuPedidoKey: 'P2__B'},
  c: {lote: '26003/01', produto: 'HID C', cliente: 'C3', status: 'Programado', dataEmissao: '2026-10-10T10:00:00Z', formulaVersao: 'v1', skuPedidoKey: 'P3__C', manipulacao: {status: 'LIBERADO', previstos: prev}},
  d: {lote: '26004/01', produto: 'HID D', cliente: 'C4', status: 'Programado', dataEmissao: '2026-10-10T10:00:00Z', formulaVersao: 'v1', skuPedidoKey: 'P4__D'},
  e: {lote: '26005/01', produto: 'ANTIGA', status: 'Programado', dataEmissao: '2026-09-01T10:00:00Z', formulaVersao: 'v1', skuPedidoKey: 'P5__E'},
  f: {lote: '26006/01', produto: 'KIT', status: 'Programado', dataEmissao: '2026-10-10T10:00:00Z', skuPedidoKey: 'P6__F'},
  g: {lote: '26007/01', produto: 'JA ENVASOU', status: 'Em Produção', dataEmissao: '2026-10-10T10:00:00Z', formulaVersao: 'v1', skuPedidoKey: 'P1__A', produzidoLinha: 100},
  h: {lote: '26008/01', produto: 'FUTURA', status: 'Programado', dataEmissao: '2026-10-10T10:00:00Z', formulaVersao: 'v1', skuPedidoKey: 'P8__H'},
  i: {lote: '26009/01', produto: 'JANELA', status: 'Programado', dataEmissao: '2026-10-10T10:00:00Z', formulaVersao: 'v1', skuPedidoKey: 'P9__I'},
  j: {lote: '26010/01', produto: 'CONCLUIDA', status: 'Concluído', dataEmissao: '2026-10-10T10:00:00Z', formulaVersao: 'v1', skuPedidoKey: 'P4__D'}
};

// ── Do dia ──
const d20 = P.pesagensDoDia(ops, '2026-10-20');
assert.equal(d20.parcelas.length, 3, 'p1, p2 e a cancelada');
assert.equal(d20.totais.pesagens, 2); assert.equal(d20.totais.canceladas, 1);
assert.equal(d20.totais.kg, 13, 'cancelada não soma'); assert.equal(d20.totais.semFoto, 1);
assert.equal(d20.porOperador.length, 1); assert.equal(d20.porOperador[0].por, 'Ana'); assert.equal(d20.porOperador[0].pesagens, 2);
assert.equal(d20.porOperador[0].primeira, '08:00'); assert.equal(d20.porOperador[0].ultima, '09:00');
assert.equal(d20.porOp.length, 1); assert.equal(d20.porOp[0].mpsPrevistas, 2);
assert.equal(d20.porOp[0].mpsPesadas, 2, 'MP1 (13 kg) e MP2 (5 kg, pesada ontem)'); assert.equal(d20.porOp[0].completa, true);
assert.equal(d20.parcelas[0].mpNome, 'Água'); assert.equal(d20.parcelas[0].fotoUrl, 'http://f/x.jpg');
const d19 = P.pesagensDoDia(ops, '2026-10-19'); assert.equal(d19.totais.pesagens, 1); assert.equal(d19.porOperador[0].por, 'Beto');
assert.equal(P.pesagensDoDia(ops, '2026-01-01').totais.pesagens, 0); assert.equal(P.pesagensDoDia({}, '2026-10-20').porOp.length, 0);

// ── Pendências ──
const grade = {
  '2026-10-21': {'08:00': {L1: {pedidoKey: 'P1__A', sku: 'A'}}},
  '2026-10-23': {'08:00': {L1: {pedidoKey: 'P2__B'}}},
  '2026-10-25': {'09:00': {L1: {pedidoKey: 'P9__I'}}},
  '2026-11-10': {'09:00': {L1: {pedidoKey: 'P8__H'}}},
  '2026-10-01': {'09:00': {L1: {pedidoKey: 'P4__D'}}},   // velho demais: não conta
  '1926-09-01': {'09:00': {L1: {pedidoKey: 'P4__D'}}}
};
const r = P.pendencias(ops, grade, '2026-10-21');
const porLote = Object.fromEntries(r.itens.map((i) => [i.lote, i]));
assert.deepEqual(Object.keys(porLote).sort(), ['26001/01', '26002/01', '26004/01', '26008/01', '26009/01'], 'só quem exige bulk, aberta, sem pesagem concluída e sem envase');
assert.equal(porLote['26001/01'].situacao, 'ATRASADA'); assert.equal(porLote['26001/01'].diasAteEnvase, 0);
assert.equal(porLote['26001/01'].mpsPesadas, 2); // só 26001 foi pesada nas duas MPs mas o estado ainda é "aguardando"
assert.equal(porLote['26002/01'].situacao, 'FORA_META'); assert.equal(porLote['26002/01'].diasAteEnvase, 2); assert.equal(porLote['26002/01'].pesarAte, '2026-10-20');
assert.equal(porLote['26002/01'].semRegistro, true);
assert.equal(porLote['26009/01'].situacao, 'NA_JANELA'); assert.equal(porLote['26009/01'].diasAteEnvase, 4);
assert.equal(porLote['26008/01'].situacao, 'FUTURA');
assert.equal(porLote['26004/01'].situacao, 'SEM_DATA');
assert.deepEqual(r.contagem, {ATRASADA: 1, FORA_META: 1, NA_JANELA: 1, FUTURA: 1, SEM_DATA: 1}); assert.equal(r.cobrar, 2);
assert.deepEqual(r.itens.map((i) => i.situacao), ['ATRASADA', 'FORA_META', 'NA_JANELA', 'FUTURA', 'SEM_DATA'], 'ordem: mais urgente primeiro');
assert.equal(porLote['26001/01'].dividemData, 2, 'a OP que já envasou divide o pedido/SKU');
// parâmetro: meta de 5 dias empurra a janela
const r5 = P.pendencias(ops, grade, '2026-10-21', {ideal: 5, janela: 6});
assert.equal(r5.itens.find((i) => i.lote === '26009/01').situacao, 'FORA_META');
// pesagem concluída some da lista
const feito = JSON.parse(JSON.stringify(ops)); feito.b.manipulacao = {status: 'PESADO', previstos: prev};
assert.ok(!P.pendencias(feito, grade, '2026-10-21').itens.some((i) => i.lote === '26002/01'));
// correção aberta volta a ser pendência
feito.b.manipulacao.status = 'CORRECAO_ABERTA';
assert.ok(P.pendencias(feito, grade, '2026-10-21').itens.some((i) => i.lote === '26002/01'));

const txt = P.textoCobranca(r);
assert.match(txt, /26001\/01 HID A — envase 21\/10 \(HOJE\/ATRASADO\)/); assert.match(txt, /26002\/01 HID B — envase 23\/10 \(em 2d\) — pesagem não iniciada/);
assert.doesNotMatch(txt, /26009/);
assert.match(P.textoCobranca({itens: []}), /em dia/);
console.log('run_pesagens_dia_test: OK');
