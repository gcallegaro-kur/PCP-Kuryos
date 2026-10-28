'use strict';
/* Cancelamento de RNC (28/10/2026).

   Caso que originou isto: a reprovação do rótulo da BIOFLORA foi aberta duas
   vezes no mesmo dia (`RNC-2026-009` e `RNC-2026-010`, mesmo lote, mesmo
   evento). Encerrar a duplicata exigia causa raiz e ação corretiva -- ou seja,
   inventar análise para uma RNC sem fato próprio -- e ainda a contaria nos
   indicadores como NC tratada.

   O que este teste trava:
   - cancelar exige motivo escrito, e preserva registro, número e lote;
   - não se cancela RNC concluída nem RNC que já carrega anuência do cliente
     (é ela a prova, e o lote em concessão aponta para o número dela);
   - a sequência NÃO reaproveita o número cancelado;
   - o relatório da RNC cancelada sai marcado como cancelado. */
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const LaudoCQ = require('./public/shared/laudo-cq.js');
const FiltroQualidade = require('./public/shared/filtro-qualidade.js');

// Banco falso: `transaction(fn)` com retorno undefined aborta, como no SDK.
function fakeDb(dados) {
  const store = JSON.parse(JSON.stringify(dados));
  const get = (p) => p.split('/').reduce((o, k) => (o == null ? o : o[k]), store);
  const set = (p, v) => {
    const partes = p.split('/');
    const folha = partes.pop();
    partes.reduce((o, k) => (o[k] = o[k] || {}), store)[folha] = v;
  };
  return {
    store,
    ref: (path) => ({
      transaction: (fn) => {
        const antes = get(path);
        const depois = fn(antes === undefined ? null : JSON.parse(JSON.stringify(antes)));
        if (depois === undefined) return Promise.resolve({committed: false, snapshot: {val: () => antes}});
        set(path, depois);
        return Promise.resolve({committed: true, snapshot: {val: () => depois}});
      }
    })
  };
}

// utils.js é script clássico (globais, sem module.exports): carrega inteiro.
const ctx = {Object, String, Number, Array, Promise, Date, Math, JSON, isFinite, isNaN,
  parseInt, parseFloat, console, RegExp, Error, setTimeout, encodeURIComponent, decodeURIComponent,
  window: {}, document: {createElement: () => ({style: {}, appendChild() {}, setAttribute() {}}),
    head: {appendChild() {}}, body: {appendChild() {}}, getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => []},
  localStorage: {getItem: () => null, setItem() {}, removeItem() {}},
  navigator: {userAgent: 'node'}, location: {href: '', search: ''}, alert() {}, fetch: () => Promise.reject(new Error('sem rede'))};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/shared/utils.js', 'utf8'), ctx);
const {cancelarRnc, RNC_STATUS, proximoNumeroRnc} = ctx;

// ── O estado existe e sai das filas ──
assert.ok(RNC_STATUS.CANCELADA, 'faltou o status CANCELADA');
assert.equal(RNC_STATUS.CANCELADA.aberta, false,
  'RNC cancelada não pode continuar contando como aberta: ela não tem o que tratar');

// O lote REPROVADO que o cancelamento não pode tocar.
const LOTE_REPROVADO = {status: 'REPROVADO', saldoLote: 6850, loteOrigem: 'AK-2026-000671',
  qualidade: {decisao: 'REPROVADO', inspecionadoEm: '2026-10-28T12:00:00.000Z'}};
function base() {
  return {
    nao_conformidades: {
      'RNC-2026-009': {numero: 'RNC-2026-009', status: 'ABERTA', itemCodigo: 'ES-00323',
        loteKey: 'AK-2026-000671', descricao: 'Rótulo reprovou no teste de exposição ao perfume.'},
      'RNC-2026-010': {numero: 'RNC-2026-010', status: 'EM_ANALISE', itemCodigo: 'RÓTULO B´BALM',
        descricao: 'Mesma ocorrência do rótulo SEA SAPHIRE.'},
      'RNC-2026-008': {numero: 'RNC-2026-008', status: 'CONCLUIDA', causaRaiz: 'x', acaoCorretiva: 'y',
        disposicao: 'DESCARTE'},
      'RNC-2026-007': {numero: 'RNC-2026-007', status: 'AGUARDANDO_CLIENTE', itemCodigo: 'ES-00323',
        loteKey: 'AK-2026-000671',
        consultaCliente: {contatoNome: 'Marina', meio: 'E-mail', notificadoEm: '2026-10-28',
          resposta: {decisao: 'LIBEROU', autorizadoPor: 'Marina Alves', anexos: [{url: 'x.pdf'}]}}}
    },
    estoque_lotes: {'ES-00323': {'AK-2026-000671': LOTE_REPROVADO}}
  };
}

(async () => {
  // ── Motivo é obrigatório: é ele que explica o número que fica na base ──
  let db = fakeDb(base());
  let r = await cancelarRnc(db, 'RNC-2026-010', {motivo: '   '}, 'Roberta');
  assert.equal(r.ok, false, 'cancelou sem motivo');
  assert.match(r.erro, /motivo/i);
  assert.equal(db.store.nao_conformidades['RNC-2026-010'].status, 'EM_ANALISE',
    'recusa não pode deixar a RNC mexida');

  r = await cancelarRnc(db, 'RNC-2026-010', {motivo: 'duplicata', duplicataDe: 'RNC-2026-010'}, 'Roberta');
  assert.equal(r.ok, false, 'aceitou a própria RNC como a que permanece válida');

  r = await cancelarRnc(db, 'RNC-2026-999', {motivo: 'duplicata'}, 'Roberta');
  assert.equal(r.ok, false, 'cancelou RNC que não existe');
  assert.match(r.erro, /não encontrada/i);

  // ── O caso real: a 010 é duplicata da 009 ──
  r = await cancelarRnc(db, 'RNC-2026-010',
    {motivo: 'Duplicata: o mesmo lote AK-2026-000671 já está registrado na RNC-2026-009.',
      duplicataDe: 'RNC-2026-009'}, 'Roberta');
  assert.equal(r.ok, true, r.erro);
  const canc = db.store.nao_conformidades['RNC-2026-010'];
  assert.equal(canc.status, 'CANCELADA');
  assert.equal(canc.canceladaPor, 'Roberta');
  assert.ok(canc.canceladaEm, 'sem data de cancelamento não há como auditar');
  assert.equal(canc.duplicataDe, 'RNC-2026-009');
  assert.match(canc.motivoCancelamento, /Duplicata/);
  assert.equal(canc.numero, 'RNC-2026-010', 'o número tem de continuar no registro');
  assert.equal(canc.descricao, 'Mesma ocorrência do rótulo SEA SAPHIRE.',
    'cancelar não apaga o que foi descrito na abertura');

  // ── Cancelar NÃO mexe no lote: o bloqueio é do laudo e da RNC que fica ──
  assert.deepEqual(db.store.estoque_lotes['ES-00323']['AK-2026-000671'], LOTE_REPROVADO,
    'o cancelamento da duplicata tocou o lote — material reprovado não se libera por ato administrativo');
  assert.equal(db.store.nao_conformidades['RNC-2026-009'].status, 'ABERTA',
    'cancelar a duplicata não pode alterar a RNC que fica');

  // ── Não se cancela duas vezes, nem RNC concluída ──
  r = await cancelarRnc(db, 'RNC-2026-010', {motivo: 'de novo'}, 'Roberta');
  assert.equal(r.ok, false, 'cancelou a mesma RNC duas vezes');
  assert.match(r.erro, /já está cancelada/i);

  r = await cancelarRnc(db, 'RNC-2026-008', {motivo: 'me arrependi'}, 'Roberta');
  assert.equal(r.ok, false, 'cancelou RNC concluída');
  assert.equal(db.store.nao_conformidades['RNC-2026-008'].causaRaiz, 'x');

  // ── RNC com anuência do cliente é a prova: não se cancela ──
  r = await cancelarRnc(db, 'RNC-2026-007', {motivo: 'duplicata', duplicataDe: 'RNC-2026-009'}, 'Roberta');
  assert.equal(r.ok, false, 'cancelou a RNC que carrega a anuência do cliente');
  assert.match(r.erro, /resposta do cliente/i);
  assert.equal(db.store.nao_conformidades['RNC-2026-007'].status, 'AGUARDANDO_CLIENTE');

  // ── A sequência não reaproveita número cancelado ──
  assert.equal(proximoNumeroRnc(db.store.nao_conformidades, 2026), 'RNC-2026-011',
    'o próximo número não pode cair sobre o número cancelado: a sequência é o rastro');

  // ── Filtros: sai do padrão "abertas", mas é achável pelo motivo ──
  const aberta = (s) => !!(RNC_STATUS[s] || {}).aberta;
  const cancelada = Object.assign({_key: 'RNC-2026-010'}, db.store.nao_conformidades['RNC-2026-010']);
  assert.equal(FiltroQualidade.passaRnc(cancelada, {status: 'ABERTAS'}, aberta), false,
    'RNC cancelada continuava na lista padrão de abertas');
  assert.equal(FiltroQualidade.passaRnc(cancelada, {status: 'CANCELADA'}, aberta), true);
  assert.equal(FiltroQualidade.passaRnc(cancelada, {status: '', busca: 'duplicata'}, aberta), true,
    'não se acha a RNC cancelada pelo motivo do cancelamento');

  // ── O relatório sai dizendo que está cancelado ──
  const doc = LaudoCQ.paginaRnc({numero: 'RNC-2026-010', dataAbertura: '2026-10-28',
    produto: 'ROTULO BODY SPLASH B.BALM SEA SAPHIRE 200ML', classificacao: 'MAIOR',
    cancelada: true, canceladaEm: '2026-10-28T18:00:00.000Z', canceladaPor: 'Roberta Ramos',
    motivoCancelamento: 'Duplicata do mesmo lote.', duplicataDe: 'RNC-2026-009'});
  assert.ok(doc.includes('RNC CANCELADA'), 'o relatório da RNC cancelada saiu sem a faixa de cancelamento');
  assert.ok(doc.includes('Duplicata do mesmo lote.'), 'faltou o motivo no relatório');
  assert.ok(doc.includes('RNC-2026-009'), 'faltou dizer qual RNC permanece válida');
  assert.ok(doc.indexOf('RNC CANCELADA') < doc.indexOf('IDENTIFICAÇÃO DA NÃO CONFORMIDADE'),
    'a faixa tem de vir antes do corpo: é a primeira coisa que se lê na folha');

  const docValido = LaudoCQ.paginaRnc({numero: 'RNC-2026-009', dataAbertura: '2026-10-28'});
  assert.ok(!docValido.includes('CANCELADA'),
    'RNC válida saiu marcada como cancelada');

  console.log('run_rnc_cancelamento_test.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
