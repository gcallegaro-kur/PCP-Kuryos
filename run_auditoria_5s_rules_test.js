'use strict';
/* Regras do banco da Auditoria 5S (06/10), no emulador real:
   firebase emulators:exec --project demo-mp --only database --config firebase.retrabalhos-test.json "node run_auditoria_5s_rules_test.js"
   - quem opera o módulo registra; auditoria FECHADA não muda mais (nem para o admin);
   - configuração só o admin; ciência uma vez por papel;
   - ocorrências (nome de pessoa): leitura só RH/admin/gestão/auditores; o líder registra mas não lista. */
const assert = require('assert/strict');
const admin = require('./functions/node_modules/firebase-admin');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9023') throw new Error('Teste exige emulador local 9023.');
const URL = 'http://127.0.0.1:9023?ns=demo-mp-default-rtdb';
const raiz = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL}, 'raiz');
const apps = {};
const como = (uid) => (apps[uid] || (apps[uid] = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL, databaseAuthVariableOverride: {uid: uid}}, uid))).database();
const negado = (p) => assert.rejects(p, /permission[ _]denied/i);
const fechada = (extra) => Object.assign({tipo: 'LIDER', setor: 'Produção', data: '2026-10-06', itens: {1: {r: 'C'}}, resultado: {status: 'VERDE'}, assinatura: {uid: 'lid', nome: 'L', em: 'x'}, fechadaEm: '2026-10-06T20:00:00Z'}, extra || {});

(async () => {
  await raiz.database().ref().set({
    usuarios: {
      adm: {role: 'admin'}, lid: {role: 'production', modulos: {auditoria5s: true}}, aud: {role: 'qualidade', modulos: {auditoria5s: true}},
      dir: {role: 'gestor', modulos: {auditoria5s: true}}, ges: {role: 'gestor', modulos: {auditoria5s: true}}, rh: {role: 'rh'},
      sem: {role: 'production', modulos: {apontamento: true}}
    },
    auditoria5s_config: {usuarios: {lid: {papel: 'LIDER', setores: ['Produção']}, aud: {papel: 'AUDITOR'}, dir: {papel: 'DIRETORIA'}, ges: {papel: 'GESTAO'}}}
  });

  // Auditoria: quem tem o módulo registra; quem não tem, não nem lê.
  await como('lid').ref('auditorias_5s/a1').set(fechada());
  await como('aud').ref('auditorias_5s/a2').set(fechada({tipo: 'QUALIDADE'}));
  await negado(como('sem').ref('auditorias_5s/a3').set(fechada()));
  await negado(como('sem').ref('auditorias_5s/a1').get());
  assert.equal((await como('aud').ref('auditorias_5s/a1/setor').get()).val(), 'Produção');
  // Registro incompleto não entra
  await negado(como('lid').ref('auditorias_5s/a4').set({tipo: 'LIDER', setor: 'Produção'}));
  // Fechada = imutável, até para o admin
  await negado(como('lid').ref('auditorias_5s/a1/setor').set('Expedição'));
  await negado(como('adm').ref('auditorias_5s/a1').set(fechada({setor: 'Expedição'})));
  await negado(como('adm').ref('auditorias_5s/a1').remove());
  assert.equal((await como('adm').ref('auditorias_5s/a1/setor').get()).val(), 'Produção');

  // Configuração: só admin escreve; todo autenticado lê
  await como('adm').ref('auditoria5s_config/parametros').set({verde: 0.85, amarelo: 0.7});
  await negado(como('lid').ref('auditoria5s_config/usuarios/lid/papel').set('GESTAO'));
  await negado(como('aud').ref('auditoria5s_config/parametros').set({verde: 0.1}));
  assert.equal((await como('sem').ref('auditoria5s_config/parametros/verde').get()).val(), 0.85);

  // Ações e ciência: ciência é uma vez só por papel
  await como('lid').ref('acoes_5s/ac1').set({auditoriaId: 'a1', status: 'ABERTA'});
  await como('lid').ref('acoes_5s/ac1/status').set('RESOLVIDA');
  await negado(como('sem').ref('acoes_5s/ac1/status').set('RESOLVIDA'));
  await como('dir').ref('ciencia_5s/a1/gerencia').set({uid: 'dir', nome: 'Diretor', em: 'x'});
  await negado(como('dir').ref('ciencia_5s/a1/gerencia').set({uid: 'dir', nome: 'Outro', em: 'y'}));
  await negado(como('lid').ref('ciencia_5s/a1/lider').set({nome: 'sem uid'}));

  // Ocorrências individuais: o líder registra, mas só RH/admin/gestão/auditores/diretoria leem
  const oc = {data: '2026-10-06', setor: 'Produção', colaboradorNome: 'Fulano', descricao: 'Item 4', registradoPorUid: 'lid'};
  await como('lid').ref('ocorrencias_5s/o1').set(oc);
  await negado(como('lid').ref('ocorrencias_5s/o1').get());
  await negado(como('lid').ref('ocorrencias_5s').get());
  await negado(como('sem').ref('ocorrencias_5s').get());
  for (const uid of ['adm', 'rh', 'ges', 'aud', 'dir']) assert.equal((await como(uid).ref('ocorrencias_5s/o1/setor').get()).val(), 'Produção', uid + ' lê');
  await negado(como('lid').ref('ocorrencias_5s/o2').set({data: 'x'}));                       // sem os campos mínimos
  await negado(como('lid').ref('ocorrencias_5s/o1/descricao').set('trocado'));               // líder não reescreve
  await como('ges').ref('ocorrencias_5s/o1/anulada').set(true);                              // gestão/admin podem anular
  console.log('OK regras da Auditoria 5S: registro fechado imutável, configuração só do admin, ciência única e ocorrências restritas.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
