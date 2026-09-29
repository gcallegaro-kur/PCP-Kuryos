'use strict';
/* Regras do nó `sequenciamento` (Sequência por setor, 2026-09-29), no emulador:
   firebase emulators:exec --only database --config firebase.retrabalhos-test.json --project demo-sequencia "node run_sequencia_setor_rules_test.js"
   - PCP (papel pcp/admin ou Emitir OP marcado) ordena e informa ritmo;
   - o setor só lê -- a fila é do PCP;
   - só entram os campos previstos, em caminhos planos. */
const assert = require('assert/strict');
const admin = require('./functions/node_modules/firebase-admin');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9023') throw new Error('Teste exige emulador local 9023.');
const URL = 'http://127.0.0.1:9023?ns=demo-sequencia-default-rtdb';
const raiz = admin.initializeApp({projectId: 'demo-sequencia', databaseURL: URL}, 'raiz');
const como = (uid) => admin.initializeApp({projectId: 'demo-sequencia', databaseURL: URL, databaseAuthVariableOverride: {uid}}, uid).database();
const negado = (p) => assert.rejects(p, /PERMISSION_DENIED|permission_denied/i);

(async () => {
  await raiz.database().ref().set({
    usuarios: {
      pcp: {role: 'pcp'},
      emissor: {role: 'gestor', modulos: {emitir_op: true}},
      op: {role: 'production', modulos: {apontamento: true, planejamento: true}},
      log: {role: 'logistica'}
    }
  });
  const pcp = como('pcp'), emissor = como('emissor'), op = como('op'), log = como('log');

  // PCP ordena com caminhos planos, como a tela grava.
  await pcp.ref().update({
    'sequenciamento/ordem/envase/26300-01/posicao': 1,
    'sequenciamento/ordem/envase/26300-01/recurso': 'Linha 1',
    'sequenciamento/ritmos/rotulagem/Rotuladora 1/unPorHora': 300,
    'sequenciamento/atualizadoEm': '2026-09-29T10:00:00Z',
    'sequenciamento/atualizadoPor': 'PCP'
  });
  await emissor.ref('sequenciamento/ritmos/manipulacao/Manipulação/horasPorLote').set(4);
  await pcp.ref('sequenciamento/ritmos/rotulagem/Rotuladora 1/unPorHora').remove();

  // O setor lê a fila...
  const lida = await op.ref('sequenciamento/ordem/envase').once('value');
  assert.equal(lida.val()['26300-01'].posicao, 1);
  await log.ref('sequenciamento').once('value');
  // ...e não mexe nela, nem quem tem Planejamento sem ser PCP.
  await negado(op.ref('sequenciamento/ordem/envase/26300-01/posicao').set(2));
  await negado(log.ref('sequenciamento/ordem/separacao/26300-01/posicao').set(1));

  // Só os campos e setores previstos.
  await negado(pcp.ref('sequenciamento/ordem/expedicao/26300-01/posicao').set(1));
  await negado(pcp.ref('sequenciamento/ordem/envase/26300-01/posicao').set(0));
  await negado(pcp.ref('sequenciamento/ordem/envase/26300-01/status').set('x'));
  await negado(pcp.ref('sequenciamento/ritmos/envase/Linha 1/unPorHora').set(-5));
  await negado(pcp.ref('sequenciamento/lixo').set(1));

  console.log('OK regras sequenciamento: PCP/Emitir OP ordenam e dão ritmo; setor só lê; campos fechados.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
