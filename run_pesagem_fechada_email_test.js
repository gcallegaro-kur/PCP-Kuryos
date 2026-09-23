'use strict';
/* E-mail à Qualidade/P&D quando a pesagem do bulk é fechada (2026-09-23).
   Parte 1: regras puras (functions/pesagem_fechada.js).
   Parte 2: o GATILHO real de functions/index.js com firebase-admin,
   firebase-functions e o Microsoft Graph simulados (caminho do gatilho,
   transição, chave, destinatários, envio e marca de deduplicação). */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const PF = require(path.join(__dirname, 'functions', 'pesagem_fechada.js'));

// ── 1. Regras ────────────────────────────────────────────────────────────
assert.equal(PF.deveNotificar('AGUARDANDO_PESAGEM', 'PESADO'), true);
assert.equal(PF.deveNotificar(null, 'PESADO'), true);
assert.equal(PF.deveNotificar('PESADO', 'PESADO'), false, 'regravar não reenvia');
assert.equal(PF.deveNotificar('PESADO', 'CONFERIDO'), false, 'conferir não avisa');

assert.equal(PF.chaveLigada({}), false);
assert.equal(PF.chaveLigada({conferenciaPesagem: {ativa: false}}), false);
assert.equal(PF.chaveLigada({conferenciaPesagem: {ativa: true}}), true);

// Mesma regra de podeConferirPesagem (auth_check.js).
assert.equal(PF.podeConferir({role: 'qualidade'}), true, 'Qualidade no padrão do perfil confere');
assert.equal(PF.podeConferir({role: 'qualidade', modulos: {qualidade: true}}), false, 'Qualidade personalizada precisa da marca');
assert.equal(PF.podeConferir({role: 'production', modulos: {conferencia_pesagem: true}}), true, 'P&D marcado confere');
assert.equal(PF.podeConferir({role: 'admin'}), false, 'admin não confere: libera com motivo');
assert.equal(PF.podeConferir({role: 'production'}), false);
assert.equal(PF.podeConferir({role: 'pending', modulos: {conferencia_pesagem: true}}), false, 'pendente não recebe');

const usuarios = {
  r: {nome: 'Roberta', email: 'Roberta@Kuryos.com.br', role: 'qualidade'},
  y: {nome: 'Yasmim Fantini', email: 'yasmim@kuryos.com.br', role: 'production', modulos: {conferencia_pesagem: true, apontamento: true}},
  p: {nome: 'Pesador', email: 'pesador@kuryos.com.br', role: 'production', modulos: {manipulacao: true}},
  a: {nome: 'Admin', email: 'adm@kuryos.com.br', role: 'admin'},
  s: {nome: 'Sem email', role: 'qualidade'}
};
assert.deepEqual(PF.destinatarios(usuarios, {}), ['roberta@kuryos.com.br', 'yasmim@kuryos.com.br']);
assert.deepEqual(PF.destinatarios(usuarios, {emailConferenciaPesagem: 'pd@kuryos.com.br; roberta@kuryos.com.br, lixo'}),
  ['roberta@kuryos.com.br', 'yasmim@kuryos.com.br', 'pd@kuryos.com.br'], 'lista extra, sem duplicata nem inválido');

const op = {
  lote: '26260/01', produto: 'BODY SPLASH NÉCTAR <b>', sku: 'MRARBS04', cliente: 'MISS RÔSE',
  manipulacao: {
    status: 'PESADO',
    previstos: {
      'MPGR-001': {mpCodigo: 'MPGR-001', mpNome: 'ALCOOL CEREAIS', unidade: 'kg', previsto: 108, ordem: 0},
      'MPES-003': {mpCodigo: 'MPES-003', mpNome: 'FRAGRANCIA', unidade: 'kg', previsto: 9, ordem: 2},
      'MPGR-002': {mpCodigo: 'MPGR-002', mpNome: 'AGUA', unidade: 'kg', previsto: 63, ordem: 1}
    },
    pesagem: {por: 'Operador João', inicio: '2026-09-23T11:00:00Z', fim: '2026-09-23T11:42:00Z',
      itens: {'MPGR-001': {pesado: 108, loteMaterial: 'AK-2026-000576'}, 'MPGR-002': {pesado: 63.2, loteMaterial: 'AK-2026-000601'},
        'MPES-003': {pesado: 9.5, loteMaterial: 'AK-2026-000610', justificativa: 'sobra na embalagem'}}}
  }
};
const linhas = PF.linhasDaPesagem(op.manipulacao);
assert.deepEqual(linhas.map((l) => l.codigo), ['MPGR-001', 'MPGR-002', 'MPES-003'], 'ordem da fórmula');
assert.equal(linhas[2].desvio, 5.56);
const email = PF.montarEmail(op, '26260-01');
assert.equal(email.assunto, '⚖️ Pesagem do lote 26260/01 fechada — conferir antes da manipulação (BODY SPLASH NÉCTAR <b>)');
assert.match(email.corpo, /NÉCTAR &lt;b&gt;/, 'nome escapado no corpo');
assert.match(email.corpo, /Operador João/);
assert.match(email.corpo, /23\/09\/2026,? 08:42/, 'horário de Brasília');
assert.match(email.corpo, /42 min/);
assert.match(email.corpo, /AK-2026-000601/);
assert.match(email.corpo, /Fora da tolerância de 2%:<\/strong> MPES-003 — sobra na embalagem/);
assert.doesNotMatch(email.corpo, /Fora da tolerância[^<]*MPGR-002/, '0,3% está dentro');
assert.match(email.corpo, /href="https:\/\/prod-kuryos\.web\.app\/manipulacao\.html"/);
assert.equal(email.resumo.foraTolerancia, 1);

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
const fakeFunctions = new Proxy({}, {get: (_, nome) => {
  if (nome === 'HttpsError') return class HttpsError extends Error {};
  if (nome === 'defineSecret') return (n) => ({value: () => 'segredo-' + n});
  return (opts, handler) => ({opts, handler: handler || opts, tipo: nome});
}});
const fakeAdmin = {initializeApp() {}, database: Object.assign(() => db, {ServerValue: {increment: (n) => ({'.sv': {increment: n}})}})};
const loadOriginal = Module._load;
Module._load = function(req) {
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

const gatilho = index.onPesagemFechada;
assert.ok(gatilho && gatilho.handler, 'onPesagemFechada exportado');
assert.equal(gatilho.tipo, 'onValueWritten');
assert.equal(gatilho.opts.ref, '/ops/{opKey}/manipulacao/status', 'gatilho no status da fase de bulk');
assert.equal(gatilho.opts.instance, 'prod-kuryos-default-rtdb');
assert.equal(gatilho.opts.secrets.length, 4, 'leva os segredos do Graph');

const evento = (id, antes, depois, opKey) => ({
  id, params: {opKey: opKey || '26260-01'},
  data: {before: {val: () => antes}, after: {val: () => depois}},
});

(async () => {
  dados.ops = {'26260-01': JSON.parse(JSON.stringify(op))};
  dados.usuarios = usuarios;
  dados.config = {conferenciaPesagem: {ativa: false}};

  // Chave desligada: registra IGNORADO, não envia.
  await gatilho.handler(evento('ev0', 'AGUARDANDO_PESAGEM', 'PESADO'));
  assert.equal(enviados.length, 0);
  assert.equal(dados.notificacoes_pesagem['26260-01'].ev0.status, 'IGNORADO');
  assert.match(dados.notificacoes_pesagem['26260-01'].ev0.motivo, /desligada/);

  // Chave ligada: envia a Roberta e Yasmim.
  dados.config.conferenciaPesagem.ativa = true;
  await gatilho.handler(evento('ev1', 'AGUARDANDO_PESAGEM', 'PESADO'));
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].toRecipients.map((r) => r.emailAddress.address), ['roberta@kuryos.com.br', 'yasmim@kuryos.com.br']);
  assert.equal(enviados[0].body.contentType, 'HTML');
  assert.match(enviados[0].subject, /Pesagem do lote 26260\/01 fechada/);
  const marca = dados.notificacoes_pesagem['26260-01'].ev1;
  assert.equal(marca.status, 'ENVIADO');
  assert.deepEqual(marca.destinatarios, ['roberta@kuryos.com.br', 'yasmim@kuryos.com.br']);

  // Mesma entrega repetida e transições que não são o fechamento: nada.
  await gatilho.handler(evento('ev1', 'AGUARDANDO_PESAGEM', 'PESADO'));
  await gatilho.handler(evento('ev2', 'PESADO', 'CONFERIDO'));
  await gatilho.handler(evento('ev3', 'PESADO', 'PESADO'));
  assert.equal(enviados.length, 1, 'sem reenvio');

  // Conferida antes do envio: IGNORADO.
  dados.ops['26260-01'].manipulacao.status = 'CONFERIDO';
  await gatilho.handler(evento('ev4', 'AGUARDANDO_PESAGEM', 'PESADO'));
  assert.equal(enviados.length, 1);
  assert.equal(dados.notificacoes_pesagem['26260-01'].ev4.status, 'IGNORADO');

  // Ninguém com e-mail e a permissão: IGNORADO com o motivo à vista.
  dados.ops['26260-01'].manipulacao.status = 'PESADO';
  dados.usuarios = {p: usuarios.p};
  await gatilho.handler(evento('ev5', 'AGUARDANDO_PESAGEM', 'PESADO'));
  assert.equal(enviados.length, 1);
  assert.match(dados.notificacoes_pesagem['26260-01'].ev5.motivo, /ninguém/);

  // Graph fora do ar: ERRO registrado e propagado.
  dados.usuarios = usuarios;
  graphFalha = true;
  await assert.rejects(gatilho.handler(evento('ev6', 'AGUARDANDO_PESAGEM', 'PESADO')), /503/);
  assert.equal(dados.notificacoes_pesagem['26260-01'].ev6.status, 'ERRO');

  console.log('run_pesagem_fechada_email_test: OK (regras + gatilho real com Graph simulado)');
})().catch((e) => { console.error(e); process.exit(1); });
