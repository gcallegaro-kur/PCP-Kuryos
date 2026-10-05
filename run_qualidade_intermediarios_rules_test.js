'use strict';
/* Regras do banco da validação da Qualidade dos frascos rotulados (05/10), no emulador real:
   firebase emulators:exec --project demo-mp --only database --config firebase.retrabalhos-test.json "node run_qualidade_intermediarios_rules_test.js"
   Só Qualidade (papel ou módulo) e admin gravam; todo autenticado lê; o status é restrito. */
const assert = require('assert/strict');
const admin = require('./functions/node_modules/firebase-admin');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9023') throw new Error('Teste exige emulador local 9023.');
const URL = 'http://127.0.0.1:9023?ns=demo-mp-default-rtdb';
const raiz = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL}, 'raiz');
const apps = {};
const como = (uid) => (apps[uid] || (apps[uid] = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL, databaseAuthVariableOverride: {uid: uid}}, uid))).database();
const negado = (p) => assert.rejects(p, /permission[ _]denied/i);
const val = (status) => ({status: status, por: 'Fulano', em: '2026-10-05T10:00:00Z'});

(async () => {
  await raiz.database().ref().set({
    usuarios: {
      qua: {role: 'qualidade'}, adm: {role: 'admin'}, pcp: {role: 'pcp'}, prod: {role: 'production'}, rot: {role: 'rotulagem'},
      mod: {role: 'gestor', modulos: {qualidade: true}}
    }
  });
  for (const uid of ['qua', 'adm', 'mod']) {
    const d = como(uid);
    await d.ref('qualidade_intermediarios/op_' + uid).set(val('LIBERADO'));
    await d.ref('qualidade_intermediarios/op_' + uid).set(val('REPROVADO'));
    await d.ref('qualidade_intermediarios/op_' + uid).set(val('PENDENTE'));
  }
  // Quem opera a fábrica e o PCP leem, mas não validam pela Qualidade.
  for (const uid of ['pcp', 'prod', 'rot']) {
    const d = como(uid);
    assert.equal((await d.ref('qualidade_intermediarios/op_qua/status').get()).val(), 'PENDENTE', uid + ' lê');
    await negado(d.ref('qualidade_intermediarios/op_x').set(val('LIBERADO')));
  }
  const q = como('qua');
  await negado(q.ref('qualidade_intermediarios/op_y').set({status: 'TALVEZ', por: 'x', em: 'y'}));      // status inválido
  await negado(q.ref('qualidade_intermediarios/op_y').set({status: 'LIBERADO'}));                         // sem quem/quando
  await q.ref('qualidade_intermediarios/op_y').set(val('LIBERADO'));
  await q.ref('qualidade_intermediarios/op_y').remove();                                                  // desfazer é permitido
  console.log('OK regras de qualidade_intermediarios: Qualidade/admin gravam, os demais só leem, status e autoria obrigatórios.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
