'use strict';
/* Regras do banco para o material em processo (01/10), no emulador real:
   firebase emulators:exec --project demo-mp --only database --config firebase.retrabalhos-test.json "node run_material_processo_rules_test.js"
   Opera a fábrica (produção, PCP, admin, rotulagem, logística ou módulo de operação) grava
   bombonas, contador e itens retidos; Qualidade/Comercial só leem; o contador só sobe. */
const assert = require('assert/strict');
const admin = require('./functions/node_modules/firebase-admin');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9023') throw new Error('Teste exige emulador local 9023.');
const URL = 'http://127.0.0.1:9023?ns=demo-mp-default-rtdb';
const raiz = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL}, 'raiz');
const apps = {};
const como = (uid, real) => (apps[uid] || (apps[uid] = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL, databaseAuthVariableOverride: {uid: real || uid}}, uid).database()));
const negado = (p) => assert.rejects(p, /permission[ _]denied/i);

(async () => {
  await raiz.database().ref().set({
    usuarios: {
      prod: {role: 'production'}, pcp: {role: 'pcp'}, adm: {role: 'admin'}, rot: {role: 'rotulagem'}, log: {role: 'logistica'},
      qua: {role: 'qualidade'}, com: {role: 'comercial'},
      man: {role: 'gestor', modulos: {manipulacao: true}}
    },
    bombonas_bulk: {'BB-0001': {codigo: 'BB-0001', tipo: 'BOMBONA', conteudo: null}},
    contador_bombonas: {BB: 1}
  });
  // Quem opera a fábrica grava tudo isso.
  for (const uid of ['prod', 'pcp', 'adm', 'rot', 'log', 'man']) {
    const d = como(uid);
    await d.ref('bombonas_bulk/BB-' + uid).set({codigo: 'BB-' + uid, tipo: 'BOMBONA', conteudo: null});
    await d.ref('material_processo/m_' + uid).set({opKey: 'x', tipo: 'BULK', qtd: 10, status: 'EM_PROCESSO'});
    const r = await d.ref('contador_bombonas/BB').transaction((c) => (c || 0) + 1);
    assert.equal(r.committed, true, uid + ' reserva número');
  }
  // Qualidade e Comercial leem, não gravam.
  for (const uid of ['qua', 'com']) {
    const d = como(uid);
    assert.equal((await d.ref('bombonas_bulk/BB-0001/codigo').get()).val(), 'BB-0001', uid + ' lê');
    await negado(d.ref('bombonas_bulk/BB-0001/conteudo').set({kg: 1}));
    await negado(d.ref('material_processo/zzz').set({qtd: 1}));
    await negado(d.ref('contador_bombonas/BB').set(999));
  }
  // O contador só sobe e só aceita número.
  const pcp = como('pcp2', 'pcp');
  const atual = (await pcp.ref('contador_bombonas/BB').get()).val();
  await negado(pcp.ref('contador_bombonas/BB').set(atual - 1));
  await negado(pcp.ref('contador_bombonas/BB').set('BB-9'));
  await pcp.ref('contador_bombonas/TQ').transaction((c) => (c || 0) + 1);   // prefixo novo nasce
  // Sem login: nada.
  const anon = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL, databaseAuthVariableOverride: null}, 'anon').database();
  await negado(anon.ref('bombonas_bulk/BB-0001/codigo').get());
  await negado(anon.ref('bombonas_bulk/BB-x').set({a: 1}));
  console.log('OK regras do material em processo: operação grava; Qualidade/Comercial só leem; contador só sobe; anônimo barrado.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
