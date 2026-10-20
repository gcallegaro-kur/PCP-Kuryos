'use strict';
/* Regras dos modelos de checklist (19/10), no emulador real:
   firebase emulators:exec --project demo-mp --only database --config firebase.retrabalhos-test.json "node run_checklists_rules_test.js"
   - todo logado lê (o operador preenche com o modelo); edita só a Qualidade/admin;
   - versão publicada é imutável, nem o admin reescreve ou apaga. */
const assert = require('assert/strict');
const admin = require('./functions/node_modules/firebase-admin');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9023') throw new Error('Teste exige emulador local 9023.');
const URL = 'http://127.0.0.1:9023?ns=demo-mp-default-rtdb';
const raiz = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL}, 'raiz');
const apps = {};
const como = (uid) => (apps[uid] || (apps[uid] = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL, databaseAuthVariableOverride: {uid: uid}}, uid))).database();
const negado = (p) => assert.rejects(p, /permission[ _]denied/i);
const v = (t) => ({itens: [{id: 'a', texto: t}], criadaEm: 'x'});

(async () => {
  await raiz.database().ref().set({usuarios: {
    adm: {role: 'admin'}, cq: {role: 'qualidade'}, cqm: {role: 'pcp', modulos: {qualidade: true}}, op: {role: 'production', modulos: {apontamento: true}}
  }});
  await como('cq').ref().update({'checklist_modelos/m1/codigo': 'CK-4', 'checklist_modelos/m1/nome': 'Assepsia', 'checklist_modelos/m1/versoes/1': v('Limpo?'), 'checklist_modelos/m1/versaoAtual': 1});
  assert.equal((await como('op').ref('checklist_modelos/m1/versoes/1/itens/0/texto').get()).val(), 'Limpo?', 'operador lê');
  await como('cqm').ref().update({'checklist_modelos/m1/versoes/2': v('Limpo e seco?'), 'checklist_modelos/m1/versaoAtual': 2, 'checklist_modelos/m1/rascunho': null});
  await negado(como('cq').ref('checklist_modelos/m1/versoes/1').set(v('mudado')));
  await negado(como('adm').ref('checklist_modelos/m1/versoes/1/itens/0/texto').set('mudado'));
  await negado(como('adm').ref('checklist_modelos/m1/versoes/2').remove());
  await negado(como('adm').ref('checklist_modelos/m1').remove());
  await negado(como('op').ref('checklist_modelos/m1/nome').set('x'));
  await negado(como('op').ref().update({'checklist_modelos/m2/codigo': 'CK-9', 'checklist_modelos/m2/nome': 'X'}));
  await negado(como('cq').ref().update({'checklist_modelos/m3/nome': 'sem código'}));
  await como('cq').ref('checklist_modelos/m1/rascunho').set({itens: [{id: 'a', texto: 'rascunho'}], em: 'y'});
  await como('cq').ref('checklist_modelos/m1/nome').set('Assepsia — linha');
  assert.equal((await como('op').ref('checklist_modelos/m1/versoes/1/itens/0/texto').get()).val(), 'Limpo?', 'versão 1 intacta');
  console.log('OK regras dos modelos de checklist: leitura para todos, edição da Qualidade, versão publicada imutável.');
  await Promise.all(Object.values(apps).concat([raiz]).map((a) => a.delete()));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
