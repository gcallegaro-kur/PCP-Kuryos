'use strict';
/* Regras da liberação de linha (19/10), no emulador real:
   firebase emulators:exec --project demo-mp --only database --config firebase.retrabalhos-test.json "node run_liberacao_linha_rules_test.js"
   - operador (apontamento) e Qualidade gravam; quem não é da operação nem da Qualidade, não;
   - inspeção APROVADA não muda mais e nenhuma inspeção é apagada;
   - todos os logados leem (o apontamento consulta o índice da OP). */
const assert = require('assert/strict');
const admin = require('./functions/node_modules/firebase-admin');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9023') throw new Error('Teste exige emulador local 9023.');
const URL = 'http://127.0.0.1:9023?ns=demo-mp-default-rtdb';
const raiz = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL}, 'raiz');
const apps = {};
const como = (uid) => (apps[uid] || (apps[uid] = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL, databaseAuthVariableOverride: {uid: uid}}, uid))).database();
const negado = (p) => assert.rejects(p, /permission[ _]denied/i);
const insp = (extra) => Object.assign({modeloId: 'm4', versao: 1, opKey: '26290-01', status: 'EXECUCAO', modeloCodigo: 'CK-4'}, extra || {});

(async () => {
  await raiz.database().ref().set({usuarios: {
    cq: {role: 'qualidade'}, op: {role: 'production', modulos: {apontamento: true}}, log: {role: 'logistica', modulos: {logistica: true}}
  }});
  await como('op').ref().update({'inspecoes_cq/i1': insp(), 'liberacao_linha/26290-01/ck4': {id: 'i1', status: 'EXECUCAO'}});
  await como('op').ref('inspecoes_cq/i1/respostas/c4x1').set({r: 'S'});
  await negado(como('log').ref('inspecoes_cq/i2').set(insp()));
  await negado(como('log').ref('liberacao_linha/26290-01/ck4/status').set('APROVADO'));
  assert.equal((await como('log').ref('liberacao_linha/26290-01/ck4/status').get()).val(), 'EXECUCAO', 'logística lê');
  await negado(como('op').ref('inspecoes_cq/i3').set({status: 'EXECUCAO'}));
  await como('cq').ref().update({'inspecoes_cq/i1/status': 'APROVADO', 'liberacao_linha/26290-01/ck4/status': 'APROVADO', 'assepsia_linhas/LINHA_1/lotesDesde': 0});
  await negado(como('cq').ref('inspecoes_cq/i1/status').set('EXECUCAO'));
  await negado(como('op').ref('inspecoes_cq/i1/respostas/c4x1').set({r: 'N'}));
  await negado(como('cq').ref('inspecoes_cq/i1').remove());
  await negado(como('log').ref('assepsia_linhas/LINHA_1/lotesDesde').set(5));
  console.log('OK regras da liberação de linha: operação e Qualidade gravam, aprovada é imutável, nada se apaga, todos leem.');
  await Promise.all(Object.values(apps).concat([raiz]).map((a) => a.delete()));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
