'use strict';
/* GAP-02 no servidor: receberDevolucaoCliente (functions/index.js) contra o
   emulador de banco, e as regras novas de devolucoes_cliente.
     firebase emulators:exec --only database --config firebase.retrabalhos-test.json --project demo-operacao "node run_devolucao_cliente_server_test.js" */
const assert = require('assert/strict');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9023') throw new Error('Teste exige emulador local 9023.');
const NS = 'demo-operacao-default-rtdb'; // as regras do config só valem no namespace do projeto
const URL = 'http://127.0.0.1:9023?ns=' + NS;
process.env.FIREBASE_CONFIG = JSON.stringify({projectId: 'demo-operacao', databaseURL: URL});
process.env.GCLOUD_PROJECT = 'demo-operacao';
const fn = require('./functions/index.js');
const admin = require('./functions/node_modules/firebase-admin');
const raiz = admin.apps.find(a => a && a.name === '[DEFAULT]') || admin.initializeApp({projectId: 'demo-operacao', databaseURL: URL});
const como = uid => admin.initializeApp({projectId: 'demo-operacao', databaseURL: URL, databaseAuthVariableOverride: {uid}}, 'u-' + uid).database();

const dev = {numero: 'DEV-2026-001', status: 'AUTORIZADA', pedidoComercialId: 'PED-0002', cliente: 'MISS RÔSE', cargaKey: 'exp_A',
  motivoTipo: 'AVARIA_TRANSPORTE', motivo: 'Caixas amassadas', totalAutorizado: 120,
  itens: [{idx: '0', sku: 'MRARBS04', descricao: 'NÉCTAR', opKey: '26257-17', opLote: '26257/17', skuPedidoKey: 'PED-0002__MRARBS04', itemKey: 'MRARBS04', qtdAutorizada: 120}]};
const chamar = (uid, data) => fn.receberDevolucaoCliente.run({auth: {uid, token: {email: uid + '@k.com'}}, data});

(async () => {
  const db = raiz.database();
  let n = 0;
  await db.ref().set({
    usuarios: {lg: {nome: 'João Logística', role: 'logistica'}, cm: {nome: 'Ana', role: 'production', modulos: {comercial: true}},
      op: {nome: 'Operador', role: 'production'}, ad: {nome: 'Gustavo', role: 'admin'}},
    pedidos: {'PED-0002__MRARBS04': {id: 'PED-0002', parentPedidoId: 'PED-0002', sku: 'MRARBS04', expedido: 1000, produzido: 1000}},
    pedidos_comerciais: {'PED-0002': {cliente: 'MISS RÔSE', itens: [{sku: 'MRARBS04', qtd: 1000, expedido: 1000}]}},
    enderecos_estoque: {DOC_1: {codigo: 'DOC-1.1.1', ativo: true}},
    expedicoes_comerciais: {exp_A: {numero: 'EXP-A', status: 'EXPEDIDO'}},
    devolucoes_cliente: {'DEV-2026-001': dev}
  });
  const itens = [{i: 0, qtdRecebida: 110, enderecoKey: 'DOC_1'}];

  // 1. Permissão: quem não é da Logística não recebe.
  await assert.rejects(chamar('op', {devKey: 'DEV-2026-001', itens}), /não pode receber/); n++;
  await assert.rejects(fn.receberDevolucaoCliente.run({data: {devKey: 'DEV-2026-001'}}), /Faça login/); n++;

  // 2. Recusa sem gravar nada (e sem deixar a trava presa).
  await assert.rejects(chamar('lg', {devKey: 'DEV-2026-001', itens: [{i: 0, qtdRecebida: 500, enderecoKey: 'DOC_1'}]}), /do que o autorizado/); n++;
  assert.equal((await db.ref('devolucoes_cliente/DEV-2026-001/recebendo').once('value')).val(), null, 'trava liberada após recusa'); n++;
  assert.equal((await db.ref('pedidos/PED-0002__MRARBS04/expedido').once('value')).val(), 1000, 'nada estornado'); n++;

  // 3. Recebimento: tudo num update só.
  const r = await chamar('lg', {devKey: 'DEV-2026-001', itens, observacao: '10 un. não vieram'});
  assert.deepEqual([r.ok, r.total], [true, 110]); n++;
  const s = (await db.ref().once('value')).val();
  assert.equal(s.devolucoes_cliente['DEV-2026-001'].status, 'RECEBIDA'); n++;
  assert.equal(s.devolucoes_cliente['DEV-2026-001'].recebimento.por, 'João Logística', 'autor vem do cadastro'); n++;
  assert.equal(s.devolucoes_cliente['DEV-2026-001'].recebendo, undefined, 'sem trava residual'); n++;
  assert.equal(s.estoque_lotes.MRARBS04['dev_DEV-2026-001_i0'].status, 'QUARENTENA'); n++;
  assert.equal(s.pedidos['PED-0002__MRARBS04'].expedido, 890, 'estorno no backlog'); n++;
  assert.equal(s.pedidos_comerciais['PED-0002'].itens[0].expedido, 890, 'estorno no comercial'); n++;
  assert.equal(s.expedicoes_comerciais.exp_A.devolucoes['DEV-2026-001'].qtd, 110); n++;

  // 4. Repetir não recebe duas vezes (retry do navegador).
  const r2 = await chamar('lg', {devKey: 'DEV-2026-001', itens});
  assert.equal(r2.jaRecebida, true); n++;
  assert.equal((await db.ref('pedidos/PED-0002__MRARBS04/expedido').once('value')).val(), 890, 'sem estorno duplo'); n++;

  // 5. Trava vigente de outra sessão recusa.
  await db.ref('devolucoes_cliente/DEV-2026-002').set(Object.assign({}, dev, {numero: 'DEV-2026-002', recebendo: {token: 'x', em: new Date().toISOString(), por: 'Outro'}}));
  await assert.rejects(chamar('lg', {devKey: 'DEV-2026-002', itens}), /Outra pessoa está confirmando/); n++;

  // 6. Regras: Comercial cria AUTORIZADA e cancela; não marca RECEBIDA; Logística não escreve pelo navegador.
  const cm = como('cm'), lg = como('lg');
  await cm.ref('devolucoes_cliente/DEV-2026-003').set(Object.assign({}, dev, {numero: 'DEV-2026-003'})); n++;
  await assert.rejects(cm.ref('devolucoes_cliente/DEV-2026-004').set(Object.assign({}, dev, {status: 'RECEBIDA'})), /permission_denied/i); n++;
  await cm.ref('devolucoes_cliente/DEV-2026-003').set(Object.assign({}, dev, {numero: 'DEV-2026-003', status: 'CANCELADA'})); n++;
  await assert.rejects(cm.ref('devolucoes_cliente/DEV-2026-003').set(Object.assign({}, dev, {status: 'AUTORIZADA'})), /permission_denied/i, 'cancelada não reabre'); n++;
  await assert.rejects(cm.ref('devolucoes_cliente/DEV-2026-001/status').set('AUTORIZADA'), /permission_denied/i, 'recebida não volta'); n++;
  await assert.rejects(lg.ref('devolucoes_cliente/DEV-2026-005').set(dev), /permission_denied/i, 'Logística não cria pelo navegador'); n++;
  // Contador: só +1.
  await cm.ref('contadores_devolucao/2026').set(1); n++;
  await cm.ref('contadores_devolucao/2026').set(2); n++;
  await assert.rejects(cm.ref('contadores_devolucao/2026').set(9), /permission_denied/i, 'contador não pula'); n++;

  console.log('devolução de cliente (servidor + regras): ' + n + ' asserções OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
