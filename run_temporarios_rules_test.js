'use strict';
/* Regras do banco dos Temporários (06/10), no emulador real:
   firebase emulators:exec --project demo-mp --only database --config firebase.retrabalhos-test.json "node run_temporarios_rules_test.js"
   - só RH Central e administrador leem e escrevem (CPF, Pix, pagamento); ninguém mais, nem PCP, gestor ou operador;
   - os valores gravados são validados (presença OK/NC/F/FA, categoria SALARIO/VT, valor e horas positivos). */
const assert = require('assert/strict');
const admin = require('./functions/node_modules/firebase-admin');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9023') throw new Error('Teste exige emulador local 9023.');
const URL = 'http://127.0.0.1:9023?ns=demo-mp-default-rtdb';
const raiz = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL}, 'raiz');
const apps = {};
const como = (uid) => (apps[uid] || (apps[uid] = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL, databaseAuthVariableOverride: {uid: uid}}, uid))).database();
const negado = (p) => assert.rejects(p, /permission[ _]denied/i);

(async () => {
  await raiz.database().ref().set({
    usuarios: {adm: {role: 'admin'}, rh: {role: 'rh'}, pcp: {role: 'pcp'}, ges: {role: 'gestor'}, prod: {role: 'production'}, qual: {role: 'qualidade', modulos: {rh_temporarios: true}}}
  });
  const temp = {nome: 'Ana Souza', documento: '111.111.111-11', pix: '11999990000', status: 'Ativo'};
  const nos = ['rh_temporarios/t1', 'rh_temporarios_config/valorHora', 'rh_temporarios_presenca/2026-09-21/t1', 'rh_temporarios_atrasos/a1', 'rh_temporarios_pagamentos/p1', 'rh_temporarios_semanas/2026-09-21/horasSexta'];
  const valores = [temp, 12.22, 'OK', {tempId: 't1', data: '2026-09-21', horas: 1}, {tempId: 't1', data: '2026-09-21', valor: 53, categoria: 'VT'}, 8];
  for (const uid of ['rh', 'adm']) for (let i = 0; i < nos.length; i++) await como(uid).ref(nos[i]).set(valores[i]);
  for (const uid of ['rh', 'adm']) for (const n of nos) assert.notEqual((await como(uid).ref(n).get()).val(), undefined, uid + ' lê ' + n);
  // ninguém além do RH/admin, nem com o módulo marcado
  for (const uid of ['pcp', 'ges', 'prod', 'qual']) {
    for (const n of nos) { await negado(como(uid).ref(n).get()); await negado(como(uid).ref(n).set(valores[nos.indexOf(n)])); }
    await negado(como(uid).ref('rh_temporarios').get());
  }
  // validação do conteúdo
  await negado(como('rh').ref('rh_temporarios/t2').set({documento: 'sem nome'}));
  await negado(como('rh').ref('rh_temporarios/t2').set({nome: ''}));
  await negado(como('rh').ref('rh_temporarios_presenca/2026-09-22/t1').set('XX'));
  await como('rh').ref('rh_temporarios_presenca/2026-09-22/t1').set('FA');
  await negado(como('rh').ref('rh_temporarios_pagamentos/p2').set({tempId: 't1', data: '2026-09-21', valor: 53, categoria: 'OUTRO'}));
  await negado(como('rh').ref('rh_temporarios_pagamentos/p2').set({tempId: 't1', data: '2026-09-21', valor: -5, categoria: 'SALARIO'}));
  await negado(como('rh').ref('rh_temporarios_pagamentos/p2').set({tempId: 't1', data: '2026-09-21', categoria: 'SALARIO'}));
  await negado(como('rh').ref('rh_temporarios_atrasos/a2').set({tempId: 't1', data: '2026-09-21', horas: 0}));
  await negado(como('rh').ref('rh_temporarios_atrasos/a2').set({tempId: 't1', data: '2026-09-21', horas: 13}));
  await como('rh').ref('rh_temporarios_atrasos/a2').set({tempId: 't1', data: '2026-09-22', horas: 2.5});
  await como('rh').ref('rh_temporarios_pagamentos/p2').update({tempId: 't1', data: '2026-09-22', valor: 300, categoria: 'SALARIO', semana: '2026-09-21'});
  console.log('OK regras dos Temporários: só RH e administrador leem/escrevem; presença, categoria, valor e horas validados.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
