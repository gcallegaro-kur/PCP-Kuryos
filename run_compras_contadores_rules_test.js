'use strict';
/* Numeração de Compras (2026-09-24), no emulador real:
   firebase emulators:exec --only database --config firebase.retrabalhos-test.json "node run_compras_contadores_rules_test.js"
   Quem tem só o módulo Compras reserva o número de SC, cotação e PC (antes:
   PERMISSION_DENIED, e o PC "nunca era criado"); o contador só sobe; o resto
   de config continua fechado para Compras. */
const assert = require('assert/strict');
const admin = require('./functions/node_modules/firebase-admin');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9023') throw new Error('Teste exige emulador local 9023.');
const URL = 'http://127.0.0.1:9023?ns=demo-compras-default-rtdb';
const raiz = admin.initializeApp({projectId: 'demo-compras', databaseURL: URL}, 'raiz');
const como = (uid) => admin.initializeApp({projectId: 'demo-compras', databaseURL: URL, databaseAuthVariableOverride: {uid}}, uid).database();
const negado = (p) => assert.rejects(p, /PERMISSION_DENIED|permission_denied/i);

(async () => {
  await raiz.database().ref().set({
    usuarios: {cmp: {role: 'gestor', modulos: {compras: true}}, log: {role: 'logistica'}, adm: {role: 'admin'}},
    config: {contadores: {pedidoCompra: 9, solicitacaoCompra: 4}, linhas: ['Linha 1']}
  });
  const cmp = como('cmp'), log = como('log'), adm = como('adm');
  // Mesmo caminho do app: nextSequential faz transaction +1.
  const r = await cmp.ref('config/contadores/pedidoCompra').transaction((c) => (c || 0) + 1);
  assert.equal(r.committed, true);
  assert.equal(r.snapshot.val(), 10);
  await cmp.ref('config/contadores/solicitacaoCompra').transaction((c) => (c || 0) + 1);
  await cmp.ref('config/contadores/processoCotacao').transaction((c) => (c || 0) + 1);
  // Só sobe.
  await negado(cmp.ref('config/contadores/pedidoCompra').set(3));
  await negado(cmp.ref('config/contadores/pedidoCompra').set('PC-1'));
  // O resto de config segue fechado para Compras e para quem não tem Compras.
  await negado(cmp.ref('config/linhas').set([]));
  await negado(cmp.ref('config/contadores/pedido').set(99));
  await negado(log.ref('config/contadores/pedidoCompra').transaction((c) => (c || 0) + 1));
  // Admin continua podendo tudo em config (e o contador segue só subindo).
  await adm.ref('config/linhas').set(['Linha 1', 'Linha 2']);
  await adm.ref('config/contadores/pedidoCompra').transaction((c) => (c || 0) + 1);
  console.log('run_compras_contadores_rules_test: OK (Compras numera SC/cotação/PC; só sobe; resto de config fechado)');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
