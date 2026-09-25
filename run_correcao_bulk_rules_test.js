'use strict';
/* Regras do banco para a correção de bulk reprovado (2026-09-25), no emulador real:
   firebase emulators:exec --only database --config firebase.retrabalhos-test.json --project demo-operacao "node run_correcao_bulk_rules_test.js"
   - a Qualidade abre a correção: regrava ops/{op}/manipulacao inteiro (ciclo
     novo + histórico) numa transação -- e não mexe no resto da OP;
   - quem manipula grava o excedente na OP (quantidade, embalagens, separação
     reaberta) e soma o empenho em estoque/;
   - Logística e perfis sem Operação não abrem correção. */
const assert = require('assert/strict');
const admin = require('./functions/node_modules/firebase-admin');
const M = require('./public/shared/manipulacao.js');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9023') throw new Error('Teste exige emulador local 9023.');
const URL = 'http://127.0.0.1:9023?ns=demo-operacao-default-rtdb';
const raiz = admin.initializeApp({projectId: 'demo-operacao', databaseURL: URL}, 'raiz');
const como = (uid) => admin.initializeApp({projectId: 'demo-operacao', databaseURL: URL, databaseAuthVariableOverride: {uid}}, uid).database();
const negado = (p) => assert.rejects(p, /PERMISSION_DENIED|permission_denied/i);

(async () => {
  const reprovado = {status: 'REPROVADO', previstos: {A: {mpCodigo: 'A', previsto: 100}},
    manipulacao: {rendimento: 98}, analise: {decisao: 'REPROVADO'}};
  await raiz.database().ref().set({
    usuarios: {
      cq: {role: 'qualidade'},
      prod: {role: 'production'},
      man: {role: 'gestor', modulos: {manipulacao: true}},
      log: {role: 'logistica'},
      nada: {role: 'gestor'}
    },
    ops: {'26300-01': {lote: '26300/01', status: 'Programado', qtdPlanejada: 1000,
      materiaisConsumo: {f1: {mpCodigo: 'EP-1', quantidade: 1000, origem: 'bom'}},
      separacaoConcluida: {em: 'x', itens: {'EP-1': 1000}},
      manipulacao: reprovado}},
    estoque: {'EP-1': {saldoAtual: 5000, saldoEmpenhado: 1000, empenhos: {'26300-01': {qtdEmpenhada: 1000}}}}
  });
  const cq = como('cq'), prod = como('prod'), man = como('man'), log = como('log'), nada = como('nada');
  const dados = {rncNumero: 'RNC-1', motivo: 'turvo', entradaKg: 98, itens: [{mpCodigo: 'SOL', quantidade: 30}], quem: 'CQ'};

  // Logística e perfil sem Operação: não abrem correção.
  await negado(log.ref('ops/26300-01/manipulacao').set(M.montarCorrecao(reprovado, dados)));
  await negado(nada.ref('ops/26300-01/manipulacao').set(M.montarCorrecao(reprovado, dados)));

  // Qualidade abre pela transação, como a tela.
  const res = await cq.ref('ops/26300-01/manipulacao').transaction((atual) => {
    if (!atual) return atual;
    if (atual.status !== 'REPROVADO') return;
    return M.montarCorrecao(atual, dados);
  });
  assert.equal(res.committed, true);
  const f = (await raiz.database().ref('ops/26300-01/manipulacao').once('value')).val();
  assert.equal(f.status, 'CORRECAO_ABERTA');
  assert.equal(f.historico.c1.analise.decisao, 'REPROVADO');
  // ...mas a Qualidade não mexe na quantidade da OP.
  await negado(cq.ref('ops/26300-01/qtdPlanejada').set(1333));

  // Quem manipula (papel production e módulo manipulacao) grava o excedente.
  for (const quem of [prod, man]) {
    await quem.ref().update({
      'ops/26300-01/qtdPlanejadaOriginal': 1000,
      'ops/26300-01/qtdPlanejada': 1333,
      'ops/26300-01/excedenteBulk': {unidades: 333, qtdBase: 1000, qtdNova: 1333},
      'ops/26300-01/materiaisConsumo': {f1: {mpCodigo: 'EP-1', quantidade: 1333, quantidadeOriginal: 1000, origem: 'bom'}},
      'ops/26300-01/separacaoParcial': {itens: {'EP-1': 1000}, em: 't'},
      'ops/26300-01/separacaoConcluida': null,
      'ops/26300-01/separacaoReaberta': {motivo: 'Excedente do bulk corrigido', em: 't'},
      'ops/26300-01/manipulacao/manipulacao/excedente': {unidades: 333}
    });
    const r = await quem.ref('estoque/EP-1').transaction((a) => {
      if (!a) return a;
      a.empenhos['26300-01'].qtdEmpenhada = 1333; a.saldoEmpenhado = 1333; return a;
    });
    assert.equal(r.committed, true);
  }
  const op = (await raiz.database().ref('ops/26300-01').once('value')).val();
  assert.equal(op.qtdPlanejada, 1333);
  assert.equal(op.separacaoConcluida, undefined);
  await negado(log.ref('ops/26300-01/qtdPlanejada').set(1));

  console.log('run_correcao_bulk_rules_test: OK (Qualidade abre a correção e só isso; Manipulação grava o excedente e o empenho; Logística/sem Operação barrados)');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
