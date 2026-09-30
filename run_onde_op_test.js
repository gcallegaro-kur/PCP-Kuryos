'use strict';
/* Onde está a OP que não pode ser alocada no envase (shared/onde-op.js). */
const assert = require('node:assert/strict');
const Manipulacao = require('./public/shared/manipulacao.js');
const OndeOp = require('./public/shared/onde-op.js');

const onde = (op, tipo) => OndeOp.onde(op, {tipo, Manipulacao});
const base = {lote: '26300/01', status: 'Em Andamento', formulaVersao: 'v1', dataEmissao: '2026-09-29T12:00:00.000Z'};
const com = (extra) => Object.assign({}, base, extra);

// OP com fórmula, sem bulk iniciado: ainda não entrou na Manipulação.
let r = onde(com({}));
assert.equal(r.disponivel, false);
assert.equal(r.codigo, 'SEM_BULK');
assert.match(r.texto, /Ainda não entrou na Manipulação \(separação de materiais ainda não feita\)/);
assert.match(onde(com({separacaoParcial: {itens: {}}})).texto, /separação de materiais parcial/);
assert.match(onde(com({separacaoConcluida: {itens: {}}})).texto, /materiais já separados/);

// Cada estado do bulk vira setor + texto.
const esperado = {
  AGUARDANDO_PESAGEM: ['Manipulação', /aguardando pesagem/],
  PESADO: ['Manipulação', /aguardando conferência/],
  CONFERIDO: ['Manipulação', /aguardando manipular/],
  EM_MANIPULACAO: ['Manipulação', /manipulando/],
  AGUARDANDO_CQ: ['Qualidade', /bulk aguardando análise/],
  REPROVADO: ['Qualidade', /reprovado/],
  CORRECAO_ABERTA: ['Manipulação', /correção/],
};
Object.keys(esperado).forEach((st) => {
  const x = onde(com({manipulacao: {status: st}}));
  assert.equal(x.disponivel, false, st);
  assert.equal(x.setor, esperado[st][0], st);
  assert.match(x.texto, esperado[st][1], st);
  assert.ok(x.texto.startsWith('Na ' + esperado[st][0]), x.texto);
});
assert.equal(onde(com({manipulacao: {status: 'LIBERADO'}})).disponivel, true);

// Rotulagem não depende do bulk.
assert.equal(onde(com({manipulacao: {status: 'EM_MANIPULACAO'}}), 'rotulagem').disponivel, true);

// Aberta em outro posto: diz onde e desde quando (cada setor com seus campos).
r = onde(com({manipulacao: {status: 'LIBERADO'}, abertaDesde: '2026-09-30T10:05:00', abertaLinha: 'Linha 03'}));
assert.equal(r.codigo, 'ABERTA');
assert.match(r.texto, /Já está aberta na Linha 03 desde 30\/09 10:05/);
assert.equal(onde(com({manipulacao: {status: 'LIBERADO'}, abertaDesde: '2026-09-30T10:05:00', abertaLinha: 'Linha 03'}), 'rotulagem').disponivel, true);
assert.match(onde(com({abertaDesdeRot: '2026-09-30T10:05:00', abertaRotulagem: 'Rotulagem 01'}), 'rotulagem').texto, /Rotulagem 01/);

// Estados finais vencem o bulk.
assert.equal(onde(com({status: 'Cancelado', motivoCancelamento: 'cliente desistiu'})).texto, 'Cancelada (cliente desistiu)');
assert.match(onde(com({status: 'Aguardando Confirmação'})).texto, /aguardando confirmação do PCP/);
assert.equal(onde(com({status: 'Concluído'})).codigo, 'CONCLUIDA');
assert.equal(onde(null).codigo, 'NAO_ENCONTRADA');

// OP antiga (antes do portão) e retrabalho seguem disponíveis.
assert.equal(onde(com({dataEmissao: '2026-09-01T12:00:00.000Z'})).disponivel, true);
assert.equal(onde(com({tipoOrdem: 'RETRABALHO'})).disponivel, true);

// Resumo por setor.
assert.equal(OndeOp.resumo([
  onde(com({manipulacao: {status: 'PESADO'}})),
  onde(com({manipulacao: {status: 'EM_MANIPULACAO'}})),
  onde(com({manipulacao: {status: 'AGUARDANDO_CQ'}})),
  onde(com({})),
  onde(com({manipulacao: {status: 'LIBERADO'}, abertaDesde: '2026-09-30T10:05:00', abertaLinha: 'Linha 2'})),
  onde(com({manipulacao: {status: 'LIBERADO'}})),
]), '2 na Manipulação, 1 na Qualidade, 1 sem bulk iniciado, 1 aberta em outra linha');

console.log('onde-op: ok');
