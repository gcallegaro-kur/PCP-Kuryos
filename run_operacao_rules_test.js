'use strict';
/* Regras do banco para o módulo Operação (2026-09-23), no emulador real:
   firebase emulators:exec --only database --config firebase.retrabalhos-test.json "node run_operacao_rules_test.js"
   - Qualidade (papel) e Conferência de Pesagem (marca) gravam a fase de bulk
     da OP -- e só ela: o resto da OP continua fechado para eles;
   - quem só tem Manipulação/Rotulagem marcados escreve onde a tela escreve
     (OP, estoque, movimentos, lotes, registros);
   - quem não tem nada disso continua barrado. */
const assert = require('assert/strict');
const admin = require('./functions/node_modules/firebase-admin');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9023') throw new Error('Teste exige emulador local 9023.');
const URL = 'http://127.0.0.1:9023?ns=demo-operacao-default-rtdb';
const raiz = admin.initializeApp({projectId: 'demo-operacao', databaseURL: URL}, 'raiz');
const como = (uid) => admin.initializeApp({projectId: 'demo-operacao', databaseURL: URL, databaseAuthVariableOverride: {uid}}, uid).database();
const negado = (p) => assert.rejects(p, /PERMISSION_DENIED|permission_denied/i);

(async () => {
  await raiz.database().ref().set({
    usuarios: {
      cq: {role: 'qualidade'},
      pd: {role: 'gestor', modulos: {conferencia_pesagem: true}},
      man: {role: 'gestor', modulos: {manipulacao: true}},
      rot: {role: 'gestor', modulos: {rotulagem: true}},
      log: {role: 'logistica'},
      nada: {role: 'gestor'}
    },
    ops: {'26260-01': {lote: '26260/01', status: 'Programado', manipulacao: {status: 'PESADO'}}},
    estoque: {'MP-1': {saldoAtual: 10}}
  });
  const cq = como('cq'), pd = como('pd'), man = como('man'), rot = como('rot'), log = como('log'), nada = como('nada');
  const conf = {status: 'CONFERIDO', 'conferencia/por': 'X', 'conferencia/modo': 'CONFERENCIA_PESAGEM'};

  // Qualidade e P&D: conferem a pesagem (e a Qualidade libera o bulk)...
  await cq.ref('ops/26260-01/manipulacao').update(conf);
  await raiz.database().ref('ops/26260-01/manipulacao/status').set('PESADO');
  await pd.ref('ops/26260-01/manipulacao').update(conf);
  await cq.ref('ops/26260-01/manipulacao').update({status: 'LIBERADO', 'analise/decisao': 'LIBERADO'});
  // ...mas não mexem no resto da OP.
  await negado(cq.ref('ops/26260-01/status').set('Concluído'));
  await negado(pd.ref('ops/26260-01/qtdPlanejada').set(1));

  // Quem só tem Manipulação: pesa (fase da OP), baixa estoque e lotes, registra movimento.
  await man.ref('ops/26260-01/manipulacao/pesagem/inicio').set('2026-09-23T11:00:00Z');
  await man.ref('estoque/MP-1/saldoAtual').set(5);
  await man.ref('movimentos_estoque/MP-1').push({tipo: 'consumo_manipulacao', qtd: -5});
  await man.ref('estoque_lotes/MP-1/L1').set({saldoLote: 5});
  // Só Rotulagem: aponta (registros) e grava na OP.
  await rot.ref('registros/2026-09-23').push({linha: 'Rotuladora 1', quantidade: 10});
  await rot.ref('ops/26260-01/produzidoRotulagem').set(10);

  // Sem módulo da Operação nem papel: barrado, como antes.
  await negado(nada.ref('ops/26260-01/manipulacao/status').set('CONFERIDO'));
  await negado(nada.ref('estoque/MP-1/saldoAtual').set(0));
  await negado(log.ref('ops/26260-01/manipulacao/status').set('CONFERIDO'));
  await negado(pd.ref('estoque/MP-1/saldoAtual').set(0));

  console.log('run_operacao_rules_test: OK (Qualidade/P&D só na fase de bulk; Manipulação/Rotulagem escrevem onde a tela escreve)');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
