'use strict';
/* E-mail ao PCP quando a produção encerra uma OP (2026-09-15).
   Parte 1: regras puras (functions/op_encerrada.js).
   Parte 2: o GATILHO real de functions/index.js, carregado com firebase-admin,
   firebase-functions e o Microsoft Graph simulados -- a lição do repo é que a
   unidade passar não prova a ligação (caminho do gatilho, transição, envio,
   marca de deduplicação). */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const OE = require(path.join(__dirname, 'functions', 'op_encerrada.js'));

// ── 1. Regras ────────────────────────────────────────────────────────────
assert.equal(OE.deveNotificar('Em Produção', 'Aguardando Confirmação'), true);
assert.equal(OE.deveNotificar(null, 'Aguardando Confirmação'), true, 'OP criada/gravada direto no status também avisa');
assert.equal(OE.deveNotificar('Aguardando Confirmação', 'Aguardando Confirmação'), false, 'regravar o mesmo status não reenvia');
assert.equal(OE.deveNotificar('Aguardando Confirmação', 'Concluído'), false, 'confirmação do PCP não avisa');
assert.equal(OE.deveNotificar('Em Produção', 'Concluído'), false);
assert.equal(OE.deveNotificar('Em Produção', null), false, 'OP apagada não avisa');

assert.deepEqual(OE.destinatarios({}), ['pcp@kuryos.com.br']);
assert.deepEqual(OE.destinatarios(null), ['pcp@kuryos.com.br']);
assert.deepEqual(OE.destinatarios({emailConfirmacaoOp: []}), ['pcp@kuryos.com.br'], 'lista vazia cai no padrão');
assert.deepEqual(OE.destinatarios({emailConfirmacaoOp: ['lixo', '']}), ['pcp@kuryos.com.br'], 'só inválidos cai no padrão');
assert.deepEqual(OE.destinatarios({emailConfirmacaoOp: 'pcp@kuryos.com.br; gustavo@kuryos.com.br, pcp@kuryos.com.br'}),
  ['pcp@kuryos.com.br', 'gustavo@kuryos.com.br'], 'texto separado e sem duplicata');
assert.deepEqual(OE.destinatarios({emailNotificacoes: ['outro@x.com']}), ['pcp@kuryos.com.br'],
  'não usa a lista geral de alertas -- o aviso é do PCP');

const regs = {
  a: {tipo: 'apontamento_total', lote: '26254/01', timestamp: '2026-09-15T15:00:00Z'},
  b: {tipo: 'fechamento_op', lote: '26254/01', timestamp: '2026-09-15T17:00:00Z', justificativaDivergencia: 'antigo'},
  c: {tipo: 'fechamento_op', lote: '26254/01', timestamp: '2026-09-15T19:00:00Z', justificativaDivergencia: 'Faltou frasco <b>',
    perdas: [{tipo: 'Frasco', quantidade: 12, especificacao: 'riscado'}, {tipo: 'Tampa', quantidade: 0}]},
  d: {tipo: 'fechamento_op', lote: 'OUTRA', timestamp: '2026-09-15T20:00:00Z'},
};
assert.equal(OE.fechamentoDaOp(regs, '26254/01').timestamp, '2026-09-15T19:00:00Z', 'fechamento mais recente desta OP');
assert.equal(OE.fechamentoDaOp(regs, 'NADA'), null);
assert.equal(OE.fechamentoDaOp(null, '26254/01'), null);
assert.equal(OE.dataLocal('2026-09-16T02:30:00Z'), '2026-09-15', 'dia de registros é o de Brasília, não UTC');

const op = {lote: '26254/01', produto: 'BODY SPLASH FORÇA DO LEAO', sku: 'MRARBS05', cliente: 'MISS RÔSE', linha: 'Linha 1',
  qtdPlanejada: 4368, produzidoLinha: 4100, produzido: 4100, dataInicioReal: '2026-09-15T12:21:04Z', dataFimReal: '2026-09-15T19:00:00Z',
  status: 'Aguardando Confirmação'};
const email = OE.montarEmail(op, '26254-01', OE.fechamentoDaOp(regs, '26254/01'));
assert.equal(email.assunto, '✅ OP 26254/01 encerrada — confirmar no PCP (BODY SPLASH FORÇA DO LEAO)');
assert.match(email.corpo, /4\.100 de 4\.368 un\. \(93,9%\)/);
assert.match(email.corpo, /faltaram 268 un\./);
assert.match(email.corpo, /MISS RÔSE/);
assert.match(email.corpo, /15\/09\/2026,? 09:21/, 'horário em Brasília');
assert.match(email.corpo, /Faltou frasco &lt;b&gt;/, 'texto do operador escapado');
assert.match(email.corpo, /12 — Frasco: riscado/);
assert.doesNotMatch(email.corpo, /Tampa/, 'perda zerada não aparece');
assert.match(email.corpo, /href="https:\/\/prod-kuryos\.web\.app\/ops\.html"/);
const acima = OE.montarEmail(Object.assign({}, op, {produzidoLinha: 4500}), '26254-01', null);
assert.match(acima.corpo, /132 un\. acima do planejado/);
assert.doesNotMatch(acima.corpo, /Justificativa/);
const semPlano = OE.montarEmail({lote: 'X/1', produzido: 10}, 'X-1', null);
assert.match(semPlano.corpo, /sem quantidade planejada/);
assert.equal(OE.montarEmail({}, 'K-1', null).resumo.lote, 'K-1', 'sem lote usa a chave');

// ── 2. O gatilho real ────────────────────────────────────────────────────
function criarDb(dados) {
  const partes = (p) => String(p || '').split('/').filter(Boolean);
  const get = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), dados);
  const set = (p, v) => {
    const ks = partes(p), last = ks.pop(); let o = dados;
    ks.forEach((k) => { o = o[k] || (o[k] = {}); });
    if (v === null) delete o[last]; else o[last] = v;
  };
  const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
  const snap = (p) => ({val: () => clone(get(p)), exists: () => get(p) != null});
  return {
    ref(p) {
      return {
        once: async () => snap(p),
        set: async (v) => set(p, clone(v)),
        update: async (v) => { Object.entries(v).forEach(([k, val]) => set(p + '/' + k, clone(val))); },
        // Fiel ao SDK: 1ª passada com o cache (null), depois o valor real.
        transaction: async (fn) => {
          let out = fn(null);
          if (out === undefined) return {committed: false, snapshot: snap(p)};
          if (get(p) != null) { out = fn(clone(get(p))); if (out === undefined) return {committed: false, snapshot: snap(p)}; }
          set(p, out);
          return {committed: true, snapshot: snap(p)};
        },
        push: () => ({key: 'k' + Math.random().toString(36).slice(2)}),
        orderByChild() { return this; }, equalTo() { return this; },
      };
    },
  };
}

const dados = {};
const db = criarDb(dados);
const gatilhos = {};
const fakeFunctions = new Proxy({}, {get: (_, nome) => {
  if (nome === 'HttpsError') return class HttpsError extends Error {};
  if (nome === 'defineSecret') return (n) => ({value: () => 'segredo-' + n});
  return (opts, handler) => ({opts, handler: handler || opts, tipo: nome});
}});
const fakeAdmin = {initializeApp() {}, database: Object.assign(() => db, {ServerValue: {increment: (n) => ({'.sv': {increment: n}})}})};
const loadOriginal = Module._load;
Module._load = function(req, parent, isMain) {
  if (req === 'firebase-admin') return fakeAdmin;
  if (req.startsWith('firebase-functions')) return fakeFunctions;
  return loadOriginal.apply(this, arguments);
};
const enviados = [];
let graphFalha = false;
global.fetch = async (url, init) => {
  if (String(url).includes('login.microsoftonline.com')) return {ok: true, json: async () => ({access_token: 't'})};
  if (String(url).includes('/sendMail')) {
    if (graphFalha) return {ok: false, status: 503, text: async () => 'indisponível'};
    enviados.push(JSON.parse(init.body).message);
    return {ok: true, json: async () => ({})};
  }
  throw new Error('fetch inesperado ' + url);
};
const index = require(path.join(__dirname, 'functions', 'index.js'));
Module._load = loadOriginal;

const gatilho = index.onOpEncerrada;
assert.ok(gatilho && gatilho.handler, 'onOpEncerrada exportado');
assert.equal(gatilho.tipo, 'onValueWritten');
assert.equal(gatilho.opts.ref, '/ops/{opKey}/status', 'gatilho no status da OP');
assert.equal(gatilho.opts.instance, 'prod-kuryos-default-rtdb');
assert.equal(gatilho.opts.secrets.length, 4, 'leva os segredos do Graph');

const evento = (id, antes, depois, opKey) => ({
  id, params: {opKey: opKey || '26254-01'},
  data: {before: {val: () => antes}, after: {val: () => depois}},
});

(async () => {
  dados.ops = {'26254-01': Object.assign({}, op)};
  dados.config = {emailNotificacoes: ['geral@kuryos.com.br']};
  dados.registros = {'2026-09-15': regs};

  // Transição real: envia uma vez, para o PCP, com o fechamento do operador.
  await gatilho.handler(evento('ev1', 'Em Produção', 'Aguardando Confirmação'));
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].toRecipients, [{emailAddress: {address: 'pcp@kuryos.com.br'}}]);
  assert.equal(enviados[0].body.contentType, 'HTML');
  assert.match(enviados[0].subject, /OP 26254\/01 encerrada/);
  assert.match(enviados[0].body.content, /Faltou frasco/);
  const marca = dados.notificacoes_op_encerrada['26254-01'].ev1;
  assert.equal(marca.status, 'ENVIADO');
  assert.equal(marca.statusAnterior, 'Em Produção');
  assert.deepEqual(marca.destinatarios, ['pcp@kuryos.com.br']);

  // Mesma entrega repetida (retry do Functions): não duplica.
  await gatilho.handler(evento('ev1', 'Em Produção', 'Aguardando Confirmação'));
  assert.equal(enviados.length, 1, 'mesmo event.id não reenvia');

  // Regravação do status e confirmação do PCP: nada.
  await gatilho.handler(evento('ev2', 'Aguardando Confirmação', 'Aguardando Confirmação'));
  await gatilho.handler(evento('ev3', 'Aguardando Confirmação', 'Concluído'));
  assert.equal(enviados.length, 1);

  // PCP confirmou antes de o envio acontecer: registra IGNORADO, não envia.
  dados.ops['26254-01'].status = 'Concluído';
  await gatilho.handler(evento('ev4', 'Em Produção', 'Aguardando Confirmação'));
  assert.equal(enviados.length, 1);
  assert.equal(dados.notificacoes_op_encerrada['26254-01'].ev4.status, 'IGNORADO');

  // Outra OP encerrada: novo e-mail; config sobrescreve destinatários.
  dados.ops['26255-02'] = {lote: '26255/02', produto: 'OUTRO', qtdPlanejada: 100, produzidoLinha: 100, status: 'Aguardando Confirmação'};
  dados.config.emailConfirmacaoOp = ['pcp@kuryos.com.br', 'gustavo@kuryos.com.br'];
  await gatilho.handler(evento('ev5', 'Em Produção', 'Aguardando Confirmação', '26255-02'));
  assert.equal(enviados.length, 2);
  assert.deepEqual(enviados[1].toRecipients.map((r) => r.emailAddress.address), ['pcp@kuryos.com.br', 'gustavo@kuryos.com.br']);

  // Graph fora do ar: registra ERRO e propaga (fica no log do Functions).
  dados.ops['26256-03'] = {lote: '26256/03', status: 'Aguardando Confirmação'};
  graphFalha = true;
  await assert.rejects(gatilho.handler(evento('ev6', 'Em Produção', 'Aguardando Confirmação', '26256-03')), /503/);
  assert.equal(dados.notificacoes_op_encerrada['26256-03'].ev6.status, 'ERRO');
  assert.match(dados.notificacoes_op_encerrada['26256-03'].ev6.erro, /503/);

  console.log('run_op_encerrada_email_test: OK (regras + gatilho real com Graph simulado)');
})().catch((e) => { console.error(e); process.exit(1); });
