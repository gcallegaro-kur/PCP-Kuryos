'use strict';
/* Regras do banco para o encerramento de pedido (08/10/2026), no emulador:
   firebase emulators:exec --only database --config firebase.retrabalhos-test.json --project demo-operacao "node run_encerramento_pedido_rules_test.js"
   - PCP (papel ou módulo Pedidos) e Comercial (módulo) encerram e reabrem;
   - produção/rotulagem seguem gravando o produzido (transaction no pedido
     inteiro), mas não encerram nem reabrem. */
const assert = require('assert/strict');
const admin = require('./functions/node_modules/firebase-admin');
const E = require('./public/shared/encerramento-pedido.js');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9023') throw new Error('Teste exige emulador local 9023.');
const URL = 'http://127.0.0.1:9023?ns=demo-operacao-default-rtdb';
const raiz = admin.initializeApp({projectId: 'demo-operacao', databaseURL: URL}, 'raiz');
const como = (uid) => admin.initializeApp({projectId: 'demo-operacao', databaseURL: URL, databaseAuthVariableOverride: {uid}}, uid).database();
const negado = (p) => assert.rejects(p, /PERMISSION_DENIED|permission_denied/i);

(async () => {
  await raiz.database().ref().set({
    usuarios: {
      pcp: {role: 'pcp'}, com: {role: 'gestor', modulos: {comercial: true}}, ped: {role: 'gestor', modulos: {pedidos: true}},
      prod: {role: 'production'}, rot: {role: 'rotulagem'}
    },
    pedidos: {
      '05__A': {id: '05', parentPedidoId: '05', sku: 'A', qtdTotal: 10000, produzido: 9549},
      '05__B': {id: '05', parentPedidoId: '05', sku: 'B', qtdTotal: 10000, produzido: 9900},
      '06__C': {id: '06', parentPedidoId: '06', sku: 'C', qtdTotal: 100, produzido: 10}
    }
  });
  const ler = async () => (await raiz.database().ref('pedidos').once('value')).val();
  const pcp = como('pcp'), com = como('com'), ped = como('ped'), prod = como('prod'), rot = como('rot');

  // Produção e rotulagem: apontamento continua (transaction no nó inteiro).
  for (const q of [prod, rot]) {
    const r = await q.ref('pedidos/06__C').transaction((p) => { if (!p) return p; p.produzido = (p.produzido || 0) + 5; return p; });
    assert.equal(r.committed, true);
  }
  assert.equal((await ler())['06__C'].produzido, 20);
  // ...mas não encerram.
  const enc = (p, quem) => E.montarEncerramento(p, ['05__A'], {motivoTipo: 'ATENDIDO_TOLERANCIA', por: quem, origem: 'PCP'}).updates;
  await negado(prod.ref().update(enc(await ler(), 'prod')));
  await negado(rot.ref('pedidos/05__A/statusManual').set('encerrado'));
  await negado(prod.ref('pedidos/05__A').transaction((p) => { if (!p) return p; p.statusManual = 'encerrado'; return p; }));

  // PCP encerra a linha A.
  await pcp.ref().update(enc(await ler(), 'PCP'));
  let d = await ler();
  assert.equal(d['05__A'].statusManual, 'encerrado');
  assert.equal(d['05__A'].encerramento.saldoNaoProduzido, 451);
  // Produção não reabre (apagando o status) nem troca o encerramento...
  await negado(prod.ref('pedidos/05__A/statusManual').remove());
  await negado(prod.ref('pedidos/05__A/encerramento/em').set('2020-01-01'));
  // ...mas segue gravando produzido na linha encerrada sem mexer no status.
  await prod.ref('pedidos/05__A/produzido').set(9600);

  // Comercial encerra o pedido 05 inteiro (sobra a B).
  d = await ler();
  const r2 = E.montarEncerramento(d, E.linhasDoPedido(d, '05'), {motivoTipo: 'CLIENTE_ACEITOU_MENOS', por: 'Diego', origem: 'COMERCIAL'});
  assert.deepEqual(r2.linhas.map((l) => l.key), ['05__B']);
  await com.ref().update(r2.updates);
  d = await ler();
  assert.equal(d['05__B'].encerramento.origem, 'COMERCIAL');

  // Módulo Pedidos reabre com motivo.
  const r3 = E.montarReabertura(d, ['05__B'], {texto: 'cliente quer o saldo', por: 'Ana', origem: 'PCP'});
  await ped.ref().update(r3.updates);
  d = await ler();
  assert.equal(d['05__B'].statusManual, undefined);
  assert.equal(d['05__B'].encerramento, undefined);
  assert.equal(Object.values(d['05__B'].encerramentoHistorico).map((h) => h.acao).sort().join(','), 'ENCERRADO,REABERTO');

  console.log('run_encerramento_pedido_rules_test: OK (PCP, módulo Pedidos e Comercial encerram/reabrem; produção e rotulagem apontam mas não encerram nem reabrem)');
  await Promise.all(admin.apps.map((a) => a.delete()));
})().catch((e) => { console.error(e); process.exit(1); });
