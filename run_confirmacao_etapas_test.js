'use strict';
/* PCP confirma cada encerramento de setor (shared/confirmacao-etapas.js). */
const assert = require('node:assert/strict');
const CE = require('./public/shared/confirmacao-etapas.js');

const ops = {
  // Rotulagem antes do envase: só a rotulagem a confirmar, OP segue ativa.
  '26273-03': {lote: '26273/03', status: 'Não Iniciado', qtdPlanejada: 1750,
    confirmacaoEtapas: {rotulagem: {status: 'AGUARDANDO', quantidade: 1750, fechadoEm: '2026-09-30T14:54:00Z', local: 'Rotuladora 1', operador: 'Ana'}}},
  // Envase e rotulagem fechados, OP pronta: duas linhas; só a última conclui.
  '26270-01': {lote: '26270/01', status: 'Aguardando Confirmação', qtdPlanejada: 1000,
    confirmacaoEtapas: {envase: {status: 'AGUARDANDO', quantidade: 990, fechadoEm: '2026-09-30T10:00:00Z'},
      rotulagem: {status: 'AGUARDANDO', quantidade: 990, fechadoEm: '2026-09-30T12:00:00Z'}}},
  // Antiga, pronta e sem etapa: conclusão avulsa.
  '26251-16': {lote: '26251/16', status: 'Aguardando Confirmação', qtdPlanejada: 1400},
  // Etapa já confirmada não aparece; cancelada nunca aparece.
  '26260-01': {lote: '26260/01', status: 'Em Produção', confirmacaoEtapas: {envase: {status: 'CONFIRMADO', quantidade: 10}}},
  '26260-02': {lote: '26260/02', status: 'Cancelado', confirmacaoEtapas: {envase: {status: 'AGUARDANDO', quantidade: 10}}},
};

const p = CE.pendentes(ops);
assert.deepEqual(p.map((x) => x.op.lote + ':' + x.etapa), ['26270/01:envase', '26270/01:rotulagem', '26273/03:rotulagem']);
assert.equal(p[2].quantidade, 1750);
assert.equal(p[2].local, 'Rotuladora 1');
assert.equal(p[2].concluiOp, false, 'OP não pronta: confirmar a rotulagem não conclui');
assert.equal(p[0].concluiOp, false, 'ainda falta a rotulagem');
assert.equal(p[1].concluiOp, false);

// Depois de confirmar o envase, a rotulagem é a última e conclui a OP.
ops['26270-01'].confirmacaoEtapas.envase.status = 'CONFIRMADO';
assert.equal(CE.concluiAoConfirmar(ops['26270-01'], 'rotulagem'), true);
assert.equal(CE.precisaConclusaoAvulsa(ops['26270-01']), false, 'tem etapa pendente: conclui pela etapa');
ops['26270-01'].confirmacaoEtapas.rotulagem.status = 'CONFIRMADO';
assert.equal(CE.precisaConclusaoAvulsa(ops['26270-01']), true, 'tudo confirmado e ainda Aguardando: botão de conclusão');

assert.equal(CE.precisaConclusaoAvulsa(ops['26251-16']), true);
assert.equal(CE.precisaConclusaoAvulsa(ops['26273-03']), false);

// Caminhos planos.
assert.deepEqual(CE.updatesConfirmacao('26273-03', 'rotulagem', 'PCP', '2026-10-01T10:00:00Z'), {
  'ops/26273-03/confirmacaoEtapas/rotulagem/status': 'CONFIRMADO',
  'ops/26273-03/confirmacaoEtapas/rotulagem/confirmadoPor': 'PCP',
  'ops/26273-03/confirmacaoEtapas/rotulagem/confirmadoEm': '2026-10-01T10:00:00Z',
});

console.log('confirmacao-etapas: ok');
