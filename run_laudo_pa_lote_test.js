'use strict';
/* Laudo único de PA por LOTE (OP), não por palete — decisão de 16/10/2026.
   Regras puras + gravação contra um banco de mentira com a semântica que
   importa (transaction que aborta, update multi-path, remove). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const L = require(path.join(__dirname, 'public', 'shared', 'laudo-pa-lote.js'));
const IPA = require(path.join(__dirname, 'public', 'shared', 'inspecao-pa.js'));

// utils.js real: qualidadeDoLaudo e rotuloStatusLote.
const ctx = {console, Math, String, Number, Object, Array, JSON, Date, RegExp, parseInt, parseFloat, isNaN, document: undefined};
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/shared/utils.js', 'utf8'), ctx);
assert.equal(typeof ctx.qualidadeDoLaudo, 'function');

const pal = (n, extra) => Object.assign({
  itemTipo: 'produto', itemCodigo: 'SKU1', itemNome: 'BODY SPLASH X', unidade: 'un', opKey: '26280-01', opLote: '26280/01', loteOrigem: '26280/01',
  paleteNumero: n, identificadorPalete: 'PA-26280-01-P' + n, caixasFechadas: n === 1 ? 61 : 30, unidadesCaixaParcial: 0,
  saldoLote: n === 1 ? 1464 : 720, status: 'QUARENTENA', origemTipo: 'conferencia_pa', enderecoCodigo: 'A-0' + n, criadoEm: '2026-10-10T10:00:00Z'
}, extra || {});

function base() {
  return {
    SKU1: {pa_1: pal(1), pa_2: pal(2), pa_3: pal(3, {status: 'AGUARDANDO_CONFERENCIA'}),
      dev_1: pal(1, {origemTipo: 'devolucao_cliente', identificadorPalete: 'DEV-1'}),
      lib_1: pal(1, {opKey: '26270-01', status: 'LIBERADO_EXPEDICAO'})},
    MAT1: {m1: {itemTipo: 'material', status: 'QUARENTENA', itemCodigo: 'MAT1'}}
  };
}

// ── Fila: um item por OP; devolução fica avulsa; liberado não volta ───────
{
  const fila = L.filaLotes(base());
  assert.equal(fila.length, 1);
  assert.equal(fila[0].opKey, '26280-01');
  assert.equal(fila[0].paletes.length, 2, 'dois paletes conferidos, um laudo');
  assert.equal(fila[0].aguardandoConferencia, 1);
  assert.equal(fila[0].saldoTotal, 2184);
  assert.equal(fila[0].caixasTotal, 91);
  assert.deepEqual(fila[0].enderecos, ['A-01', 'A-02']);
  assert.deepEqual(fila[0].paletes.map((p) => p.loteKey), ['pa_1', 'pa_2'], 'ordem por número do palete');
}

// ── Amostragem por palete ────────────────────────────────────────────────
{
  const g = L.filaLotes(base())[0];
  const am = L.amostragemPorPalete(g.paletes, IPA.amostragem);
  assert.equal(am.porPalete.length, 2);
  assert.equal(am.porPalete[0].caixas, 61); assert.equal(am.porPalete[0].amostra, 9);   // √61 = 7,8 -> 8 + 1
  assert.equal(am.porPalete[1].caixas, 30); assert.equal(am.porPalete[1].amostra, 7);   // √30 = 5,5 -> 6 + 1
  assert.equal(am.caixasLote, 91); assert.equal(am.caixasAmostradas, 16);
  assert.match(L.textoAmostragem(am), /Palete PA-26280-01-P1 \(A-01\): 9 de 61.*Palete PA-26280-01-P2 \(A-02\): 7 de 30.*total 16 de 91/);
  // Palete sem caixas informadas não quebra.
  const vazio = L.amostragemPorPalete([{loteKey: 'x', lote: pal(1, {caixasFechadas: 0})}], IPA.amostragem);
  assert.equal(vazio.porPalete[0].amostra, 0);
}

// ── Plano de gravação: ops + espelho idêntico em cada palete ──────────────
{
  const g = L.filaLotes(base())[0];
  const am = L.amostragemPorPalete(g.paletes, IPA.amostragem);
  const q = ctx.qualidadeDoLaudo({decisao: 'LIBERADO_EXPEDICAO', observacao: 'ok', ck7: {resumo: '20C / 0NC'}, resumoCk7: '20C / 0NC'}, 'Ana', '2026-10-16T10:00:00.000Z');
  const plano = L.planejarGravacao({opKey: '26280-01', opLote: '26280/01', itemCodigo: 'SKU1', loteOrigem: '26280/01',
    paletes: g.paletes, qualidade: q, amostragem: am, agora: '2026-10-16T10:00:00.000Z', autor: 'Ana', pushKeys: {pa_1: 'k1', pa_2: 'k2'}});
  const u = plano.updates;
  const laudo = u['ops/26280-01/qualidadePA'];
  assert.equal(laudo.decisao, 'LIBERADO_EXPEDICAO');
  assert.equal(laudo.qtdPaletes, 2); assert.equal(laudo.saldoLote, 2184);
  assert.equal(laudo.amostragemPaletes.length, 2);
  ['pa_1', 'pa_2'].forEach((k, i) => {
    assert.equal(u['estoque_lotes/SKU1/' + k + '/status'], 'LIBERADO_EXPEDICAO');
    const mirror = u['estoque_lotes/SKU1/' + k + '/qualidade'];
    assert.equal(mirror.decisao, 'LIBERADO_EXPEDICAO');
    assert.equal(mirror.inspecionadoPor, 'Ana'); assert.equal(mirror.inspecionadoEm, laudo.inspecionadoEm);
    assert.equal(mirror.resumoCk7, laudo.resumoCk7, 'mesmas informações em todos os paletes');
    assert.equal(mirror.laudoLote, '26280-01'); assert.equal(mirror.espelhoDeLote, true);
    assert.equal(mirror.amostragemPalete.caixas, i === 0 ? 61 : 30, 'cada palete guarda a sua amostra');
    assert.equal(u['movimentos_estoque/SKU1/' + (i ? 'k2' : 'k1')].qtd, 0);
    // O que a Expedição exige do palete (regra em expedicao.js).
    assert.ok(['LIBERADO_EXPEDICAO', 'APROVADO_CONCESSAO'].includes(u['estoque_lotes/SKU1/' + k + '/status']));
    assert.equal(mirror.decisao, u['estoque_lotes/SKU1/' + k + '/status']);
  });
}

// ── Banco de mentira ──────────────────────────────────────────────────────
function bancoFalso(dados) {
  const db = JSON.parse(JSON.stringify(dados));
  const get = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), db);
  const set = (p, v) => {
    const ks = p.split('/').filter(Boolean); let o = db;
    ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
    if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
  };
  let seq = 0; const log = {updates: 0};
  return {db, log, ref(p) {
    return {
      once: () => Promise.resolve({val: () => (get(p) === undefined ? null : JSON.parse(JSON.stringify(get(p))))}),
      transaction(fn) {
        const atual = get(p) === undefined ? null : JSON.parse(JSON.stringify(get(p)));
        const r = fn(atual);
        if (r === undefined) return Promise.resolve({committed: false});
        set(p, r); return Promise.resolve({committed: true, snapshot: {val: () => get(p)}});
      },
      remove() { set(p, null); return Promise.resolve(); },
      push() { return Object.assign(Promise.resolve(), {key: 'push' + (++seq)}); },
      update(u) { log.updates++; Object.keys(u || {}).forEach((k) => set(k, u[k])); return Promise.resolve(); },
    };
  }};
}
// db.ref().push() sem argumento devolve só a chave; ref(p).push(obj) não é usado aqui.
const deps = (rncs) => ({qualidadeDoLaudo: ctx.qualidadeDoLaudo, rotuloStatusLote: ctx.rotuloStatusLote,
  abrirRnc: (dbRef, dados) => { rncs.push(dados); return Promise.resolve({ok: true, numero: 'RNC-1'}); }});

(async () => {
  const mk = () => bancoFalso({estoque_lotes: base(), ops: {'26280-01': {lote: '26280/01'}}});
  const entrada = (b) => { const g = L.filaLotes(b.db.estoque_lotes)[0]; return {g, am: L.amostragemPorPalete(g.paletes, IPA.amostragem)}; };

  // Liberar: grava o lote inteiro de uma vez.
  {
    const b = mk(), rncs = [], {g, am} = entrada(b);
    const r = await L.registrarLaudoPaLote(b, g.opKey, g.paletes, {decisao: 'LIBERADO_EXPEDICAO', observacao: 'ok'}, 'Ana',
      {itemCodigo: 'SKU1', loteOrigem: '26280/01', opLote: '26280/01', amostragem: am}, deps(rncs));
    assert.equal(r.ok, true); assert.equal(r.paletes, 2); assert.equal(r.saldo, 2184);
    assert.equal(b.db.ops['26280-01'].qualidadePA.decisao, 'LIBERADO_EXPEDICAO');
    assert.equal(b.db.estoque_lotes.SKU1.pa_1.status, 'LIBERADO_EXPEDICAO');
    assert.equal(b.db.estoque_lotes.SKU1.pa_2.status, 'LIBERADO_EXPEDICAO');
    assert.equal(b.db.estoque_lotes.SKU1.pa_3.status, 'AGUARDANDO_CONFERENCIA', 'palete sem conferência não é tocado');
    assert.equal(b.db.estoque_lotes.SKU1.dev_1.status, 'QUARENTENA', 'devolução tem laudo próprio');
    assert.equal(b.log.updates, 1, 'um único update multi-path');
    assert.equal(rncs.length, 0);
    // Segundo clique / outra sessão: não decide de novo nem sobrescreve.
    const antes = JSON.stringify(b.db);
    const r2 = await L.registrarLaudoPaLote(b, g.opKey, g.paletes, {decisao: 'REPROVADO'}, 'Bia', {itemCodigo: 'SKU1', amostragem: am}, deps(rncs));
    assert.equal(r2.ok, false); assert.match(r2.erro, /já tem laudo/);
    assert.equal(JSON.stringify(b.db), antes, 'nada mudou');
    // A fila some.
    assert.equal(L.filaLotes(b.db.estoque_lotes).length, 0);
  }

  // Reprovar: uma RNC para o lote, todos os paletes reprovados.
  {
    const b = mk(), rncs = [], {g, am} = entrada(b);
    const r = await L.registrarLaudoPaLote(b, g.opKey, g.paletes, {decisao: 'REPROVADO', observacao: 'rótulo trocado'}, 'Ana',
      {itemCodigo: 'SKU1', loteOrigem: '26280/01', opLote: '26280/01', amostragem: am}, deps(rncs));
    assert.equal(r.ok, true); assert.equal(r.rnc, 'RNC-1');
    assert.equal(rncs.length, 1, 'uma RNC por lote, não por palete');
    assert.equal(rncs[0].qtdEnvolvida, 2184); assert.match(rncs[0].acaoImediata, /todos os paletes/);
    assert.equal(b.db.estoque_lotes.SKU1.pa_1.status, 'REPROVADO'); assert.equal(b.db.estoque_lotes.SKU1.pa_2.status, 'REPROVADO');
  }

  // Concessão exige quem autorizou; decisão inválida; palete mudou no meio.
  {
    const b = mk(), {g, am} = entrada(b);
    const sem = await L.registrarLaudoPaLote(b, g.opKey, g.paletes, {decisao: 'APROVADO_CONCESSAO'}, 'Ana', {amostragem: am}, deps([]));
    assert.equal(sem.ok, false); assert.match(sem.erro, /autorizou/);
    const inv = await L.registrarLaudoPaLote(b, g.opKey, g.paletes, {decisao: 'XPTO'}, 'Ana', {amostragem: am}, deps([]));
    assert.equal(inv.ok, false);
    assert.equal(b.db.ops['26280-01'].qualidadePA, undefined, 'nada reservado nos dois casos');
    b.db.estoque_lotes.SKU1.pa_2.status = 'RETIDO'; // alguém mexeu no meio
    const meio = await L.registrarLaudoPaLote(b, g.opKey, g.paletes, {decisao: 'LIBERADO_EXPEDICAO'}, 'Ana', {itemCodigo: 'SKU1', amostragem: am}, deps([]));
    assert.equal(meio.ok, false); assert.match(meio.erro, /não está mais em quarentena/);
    assert.equal(b.db.ops['26280-01'].qualidadePA, undefined, 'reserva devolvida');
    assert.equal(b.db.estoque_lotes.SKU1.pa_1.status, 'QUARENTENA', 'nenhum palete foi liberado pela metade');
  }

  // Falha ao gravar: a reserva é devolvida e dá para tentar de novo.
  {
    const b = mk(), {g, am} = entrada(b);
    const upd = b.ref().update; b.ref = ((orig) => (p) => { const r = orig(p); if (!p) r.update = () => Promise.reject(new Error('rede caiu')); return r; })(b.ref.bind(b));
    const r = await L.registrarLaudoPaLote(b, g.opKey, g.paletes, {decisao: 'LIBERADO_EXPEDICAO'}, 'Ana', {itemCodigo: 'SKU1', amostragem: am}, deps([]));
    assert.equal(r.ok, false); assert.match(r.erro, /rede caiu/);
    assert.equal(b.db.ops['26280-01'].qualidadePA, undefined, 'reserva solta após a falha');
  }

  // ── Herança (palete que chega depois herda o lote) ───────────────────────
  {
    const b = mk(), {g, am} = entrada(b);
    await L.registrarLaudoPaLote(b, g.opKey, g.paletes, {decisao: 'LIBERADO_EXPEDICAO', observacao: 'ok'}, 'Ana', {itemCodigo: 'SKU1', amostragem: am}, deps([]));
    const laudo = b.db.ops['26280-01'].qualidadePA;
    const h = L.heranca(laudo, '26280-01', '2026-10-17T08:00:00Z');
    assert.equal(h.status, 'LIBERADO_EXPEDICAO');
    assert.equal(h.qualidade.herdado, true); assert.equal(h.qualidade.laudoLote, '26280-01');
    assert.equal(h.qualidade.paletes, undefined, 'a lista de paletes do lote não vai para o palete');
    assert.equal(L.heranca(null, 'x'), null);
    assert.equal(L.heranca({decisao: 'RESERVADO'}, 'x'), null, 'reserva em andamento não é decisão');
    // Palete fora da amostragem do laudo aparece como "sem amostragem".
    const novos = L.paletesSemAmostragem(laudo, [{loteKey: 'pa_1'}, {loteKey: 'pa_3'}]);
    assert.deepEqual(novos.map((p) => p.loteKey), ['pa_3']);
  }

  // ── Telas ─────────────────────────────────────────────────────────────────
  const q = fs.readFileSync('public/qualidade.html', 'utf8');
  assert.ok(/shared\/laudo-pa-lote\.js/.test(q) && /function linhaFilaLotePa/.test(q) && /function chamarRegistroLaudo/.test(q));
  assert.ok(/Laudar lote/.test(q) && /Liberação de lote/.test(q) && /Amostra por palete/.test(q));
  assert.ok(/laudosLoteVistos/.test(q), 'histórico: um laudo por lote');
  const rules = fs.readFileSync('database.rules.json', 'utf8');
  assert.ok(/"qualidadePA"/.test(rules), 'regra do banco para ops/{op}/qualidadePA');
  console.log('run_laudo_pa_lote_test: OK');
})().catch((e) => { console.error(e); process.exit(1); });
