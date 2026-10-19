'use strict';
/* Regras do banco de Manutenção › Ativos (19/10), no emulador real:
   firebase emulators:exec --project demo-mp --only database --config firebase.retrabalhos-test.json "node run_ativos_rules_test.js"
   - todo usuário logado LÊ o cadastro (os outros módulos consomem);
   - grava só admin ou quem tem o módulo manutencao;
   - ativo incompleto ou com situação inventada não entra;
   - histórico de situação só acrescenta (nem o admin reescreve). */
const assert = require('assert/strict');
const admin = require('./functions/node_modules/firebase-admin');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9023') throw new Error('Teste exige emulador local 9023.');
const URL = 'http://127.0.0.1:9023?ns=demo-mp-default-rtdb';
const raiz = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL}, 'raiz');
const apps = {};
const como = (uid) => (apps[uid] || (apps[uid] = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL, databaseAuthVariableOverride: {uid: uid}}, uid))).database();
const negado = (p) => assert.rejects(p, /permission[ _]denied/i);
const ativo = (extra) => Object.assign({codigo: 'RT-01', nome: 'Reator', tipo: 'REATOR', area: 'MANIPULACAO', situacao: 'OPERACIONAL'}, extra || {});

(async () => {
  await raiz.database().ref().set({usuarios: {
    adm: {role: 'admin'}, man: {role: 'pcp', modulos: {manutencao: true}}, op: {role: 'production', modulos: {apontamento: true}}, cq: {role: 'qualidade'}
  }});
  await como('man').ref('ativos/a1').set(ativo());
  await como('adm').ref('ativos/a2').set(ativo({codigo: 'EV-01', tipo: 'ENVASADORA', area: 'ENVASE'}));
  await negado(como('op').ref('ativos/a3').set(ativo({codigo: 'X'})));
  await negado(como('cq').ref('ativos/a1/nome').set('mudado'));
  assert.equal((await como('op').ref('ativos/a1/codigo').get()).val(), 'RT-01', 'operação lê');
  assert.equal((await como('cq').ref('ativos/a2/tipo').get()).val(), 'ENVASADORA', 'qualidade lê');
  await negado(como('man').ref('ativos/a4').set({codigo: 'Z', nome: 'Z'}));
  await negado(como('man').ref('ativos/a1/situacao').set('QUEBRADO'));
  await como('man').ref().update({'ativos/a1/situacao': 'EM_MANUTENCAO', 'ativos/a1/situacaoMotivo': 'vedação', 'ativos_historico/a1/h1': {de: 'OPERACIONAL', para: 'EM_MANUTENCAO', em: 'x', motivo: 'vedação'}});
  assert.equal((await como('op').ref('ativos/a1/situacao').get()).val(), 'EM_MANUTENCAO');
  await negado(como('adm').ref('ativos_historico/a1/h1/motivo').set('apagado'));
  await negado(como('adm').ref('ativos_historico/a1/h1').remove());
  await negado(como('op').ref('ativos_historico/a1/h2').set({de: 'a', para: 'b', em: 'x'}));
  await negado(como('man').ref('ativos_historico/a1/h3').set({de: 'a'}));
  await como('man').ref('ativos/a2').remove();
  assert.equal((await como('adm').ref('ativos/a2').get()).exists(), false, 'quem cadastra pode excluir');
  console.log('OK regras de Ativos: leitura para todos os logados, gravação com o módulo, validação e histórico só acrescenta.');
  await Promise.all(Object.values(apps).concat([raiz]).map((a) => a.delete()));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
