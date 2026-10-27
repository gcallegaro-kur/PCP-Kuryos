'use strict';
/* Regras do rascunho do laudo (27/10), no emulador real:
   firebase emulators:exec --project demo-mp --only database --config firebase.retrabalhos-test.json "node run_rascunho_cq_rules_test.js"
   - Qualidade (papel ou módulo), PCP e admin gravam e apagam; os demais não;
   - todos os logados leem; registro sem tipo/dados/atualizadoEm, tipo estranho ou grande demais é recusado. */
const assert = require('assert/strict');
const admin = require('./functions/node_modules/firebase-admin');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9023') throw new Error('Teste exige emulador local 9023.');
const URL = 'http://127.0.0.1:9023?ns=demo-mp-default-rtdb';
const raiz = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL}, 'raiz');
const apps = {};
const como = (uid) => (apps[uid] || (apps[uid] = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL, databaseAuthVariableOverride: {uid: uid}}, uid))).database();
const negado = (p) => assert.rejects(p, /permission[ _]denied/i);
const reg = (extra) => Object.assign({tipo: 'LAUDO', dados: '{"campos":{}}', atualizadoEm: '2026-10-27T14:00:00Z', por: 'Ana'}, extra || {});
const N = 'qualidade_rascunhos/';

(async () => {
  await raiz.database().ref().set({usuarios: {
    cq: {role: 'qualidade'}, mod: {role: 'production', modulos: {qualidade: true}}, pcp: {role: 'pcp'},
    adm: {role: 'admin'}, op: {role: 'production', modulos: {apontamento: true}}, log: {role: 'logistica'}
  }});
  await como('cq').ref(N + 'pa_26280-01').set(reg());
  await como('mod').ref(N + 'granel_26300-01').set(reg({tipo: 'GRANEL'}));
  await como('pcp').ref(N + 'lote_A__L1').set(reg());
  await como('adm').ref(N + 'lote_A__L1').set(reg({por: 'Admin'}));
  await negado(como('op').ref(N + 'pa_26280-01').set(reg()));
  await negado(como('log').ref(N + 'pa_26280-01').remove());
  assert.equal((await como('log').ref(N + 'pa_26280-01/por').get()).val(), 'Ana', 'todos leem');
  await negado(como('cq').ref(N + 'x').set({tipo: 'LAUDO', dados: '{}'}));
  await negado(como('cq').ref(N + 'x').set(reg({tipo: 'OUTRO'})));
  await negado(como('cq').ref(N + 'x').set(reg({dados: {campos: {}}})));
  await negado(como('cq').ref(N + 'x').set(reg({dados: 'a'.repeat(200001)})));
  await como('cq').ref(N + 'pa_26280-01').remove();
  assert.equal((await como('cq').ref(N + 'pa_26280-01').get()).exists(), false, 'Qualidade apaga ao decidir');
  console.log('OK regras do rascunho do laudo: Qualidade/PCP/admin gravam e apagam, demais não; todos leem; formato validado.');
  await Promise.all(Object.values(apps).concat([raiz]).map((a) => a.delete()));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
