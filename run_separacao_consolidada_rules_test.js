'use strict';
/* Regras do banco para a Separação de Materiais (2026-09-25), no emulador real:
   firebase emulators:exec --project demo-separacao --only database --config firebase.retrabalhos-test.json "node run_separacao_consolidada_rules_test.js"
   (sem --project o emulador aplica as regras a outro namespace e tudo passa aberto)
   A tela é da Logística, mas `ops` só aceitava PCP/produção/planejamento: o
   separador movia o material e recebia PERMISSION_DENIED ao marcar a OP.
   - papel `logistica` ou módulo Logística gravam separacaoParcial e
     separacaoConcluida -- e só isso da OP;
   - quem não tem nada disso continua barrado. */
const assert = require('assert/strict');
const admin = require('./functions/node_modules/firebase-admin');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9023') throw new Error('Teste exige emulador local 9023.');
const URL = 'http://127.0.0.1:9023?ns=demo-separacao-default-rtdb';
const raiz = admin.initializeApp({projectId: 'demo-separacao', databaseURL: URL}, 'raiz');
const como = (uid) => admin.initializeApp({projectId: 'demo-separacao', databaseURL: URL, databaseAuthVariableOverride: {uid}}, uid).database();
const negado = (p) => assert.rejects(p, /PERMISSION_DENIED|permission_denied/i);

(async () => {
  await raiz.database().ref().set({
    usuarios: {
      log: {role: 'logistica'},
      mod: {role: 'gestor', modulos: {logistica: true}},
      nada: {role: 'gestor'}
    },
    ops: {'26300-01': {lote: '26300/01', status: 'Programado'}, '26301-01': {lote: '26301/01', status: 'Em Produção', abertaDesde: '2026-09-25T10:00:00Z', abertaLinha: 'Linha 1'}},
    estoque_lotes: {'FR-1': {l1: {saldoLote: 700}}}
  });
  const log = como('log'), mod = como('mod'), nada = como('nada');

  // Papel logística: separa (lote) e marca a OP.
  await log.ref('estoque_lotes/FR-1/l1').transaction((a) => { if (!a) return a; a.saldoLote -= 300; return a; });
  await log.ref('ops/26300-01/separacaoParcial').transaction((a) => ({itens: {'FR-1': ((a && a.itens && a.itens['FR-1']) || 0) + 300}, em: 'x', por: 'Separador'}));
  await log.ref('ops/26300-01/separacaoConcluida').set({em: 'x', por: 'Separador', itens: {'FR-1': 300}, via: 'consolidada'});
  // Módulo Logística (outro papel): idem, também em OP já aberta na linha.
  await mod.ref('ops/26301-01/separacaoParcial').set({itens: {'FR-1': 100}, em: 'x', por: 'M'});
  await mod.ref('ops/26301-01/separacaoConcluida').set({em: 'x', por: 'M', itens: {'FR-1': 100}});

  // ...mas não mexem no resto da OP.
  await negado(log.ref('ops/26300-01/status').set('Concluído'));
  await negado(mod.ref('ops/26301-01/abertaLinha').set('Linha 2'));
  await negado(log.ref('ops/26300-01').update({separacaoConcluida: null, status: 'Cancelado'}));
  // Sem papel nem módulo: barrado.
  await negado(nada.ref('ops/26300-01/separacaoParcial').set({itens: {}}));
  await negado(nada.ref('ops/26300-01/separacaoConcluida').set({em: 'x'}));

  const op = (await raiz.database().ref('ops/26300-01').once('value')).val();
  assert.equal(op.status, 'Programado');
  assert.deepEqual(op.separacaoParcial.itens, {'FR-1': 300});
  console.log('run_separacao_consolidada_rules_test: OK (Logística grava só a separação da OP)');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
