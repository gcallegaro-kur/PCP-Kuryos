'use strict';
/* Tela Movimentar (WMS, 29/09) de ponta a ponta: tela real com utils.js
   (transferirLoteEndereco / separarParcialLoteEndereco de verdade),
   seletor-endereco.js e auth_check.js; Firebase simulado em memória
   (mesmo harness de run_manipulacao_ui_test.js). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  const ap = (u) => ({em: new Date().toISOString(), nome: u, uid: 'x'});
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    config: {linhas: ['Linha 1']},
    clientes: {MISS: {nome: 'MISS ROSE'}},
    materiais: {'MPGR-1': {tipo: 'MPGR', mpCodigo: 'MPGR-1', mpNome: 'ALCOOL', unidade: 'kg', ativo: true}, 'EP-1': {tipo: 'EP', mpCodigo: 'EP-1', mpNome: 'FRASCO', unidade: 'un', ativo: true}},
    produtos: {
      'SKU-OK': {sku: 'SKU-OK', descricao: 'PRODUTO TUDO APROVADO', cliente: 'MISS ROSE', clienteKey: 'MISS', volume: 200, unidadeVolume: 'ml', densidadeGranel: 0.9, prazoValidadeMeses: 24, ativo: 'Ativo'},
      'SKU-BOM': {sku: 'SKU-BOM', descricao: 'PRODUTO SEM BOM APROVADO', cliente: 'MISS ROSE', clienteKey: 'MISS', volume: 200, unidadeVolume: 'ml', densidadeGranel: 0.9, prazoValidadeMeses: 24, ativo: 'Ativo'}
    },
    formulas: {
      'SKU-OK__v1': {codProduto: 'SKU-OK', versao: 'v1', status: 'APROVADA', somaPercentual: 100, aprovadoPD: ap('a'), aprovadoQualidade: ap('b'), itens: {a: {mpCodigo: 'MPGR-1', mpNome: 'ALCOOL', percentualMM: 100}}},
      'SKU-BOM__v1': {codProduto: 'SKU-BOM', versao: 'v1', status: 'APROVADA', somaPercentual: 100, aprovadoPD: ap('a'), aprovadoQualidade: ap('b'), itens: {a: {mpCodigo: 'MPGR-1', mpNome: 'ALCOOL', percentualMM: 100}}}
    },
    bom: {
      'SKU-OK__v1': {codProduto: 'SKU-OK', versao: 'v1', status: 'APROVADA', aprovadoPCP: ap('c'), aprovadoComercial: ap('d'), itens: {a: {materialCodigo: 'EP-1', materialNome: 'FRASCO', qtdPorPeca: 1}}},
      'SKU-BOM__v1': {codProduto: 'SKU-BOM', versao: 'v1', itens: {a: {materialCodigo: 'EP-1', materialNome: 'FRASCO', qtdPorPeca: 1}}}
    },
    especificacoes: {
      'SKU-OK__v1': {codProduto: 'SKU-OK', versao: 'v1', status: 'APROVADA', aprovadoPD: ap('a'), aprovadoQualidade: ap('b'), itens: {}},
      'SKU-BOM__v1': {codProduto: 'SKU-BOM', versao: 'v1', status: 'APROVADA', aprovadoPD: ap('a'), aprovadoQualidade: ap('b'), itens: {}}
    },
    ops: {}, pedidos: {}, estoque: {}
  };
}

async function abrir(browser, uid, estadoInicial, pagina) {
  const page = await browser.newPage({viewport: {width: 1500, height: 1200}});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // confirm() aceita; prompt() responde o que o teste deixou em page.__respostaPrompt.
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? (page.__respostaPrompt || '') : undefined));
  await page.addInitScript(({data, quem}) => {
    const db = data;
    window.__db = db;
    window.__iniciado = false;
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    // Listeners vivos: a tela reage a on('value'), como no Firebase de verdade.
    const ouvintes = [];
    const notificar = (bruto) => {
      // update() na raiz manda caminhos com barra inicial: normaliza os dois
      // lados, senão o ouvinte de 'ops' nunca casa com '/ops/...'.
      const p = partes(bruto).join('/');
      ouvintes.forEach((o) => {
        const alvo = partes(o.path).join('/');
        if (!alvo || p === alvo || p.indexOf(alvo + '/') === 0 || alvo.indexOf(p + '/') === 0) o.avisar();
      });
    };
    const gravar = (p, v) => {
      const ks = partes(p); let o = db;
      ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
      if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = structuredClone(v);
      notificar(p);
    };
    let seq = 0;
    const exige = (q) => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
    const perfil = db.usuarios[quem];
    window.firebase = {
      functions() { return {httpsCallable: () => async () => ({data: {}})}; },
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() {
        exige('auth');
        return {currentUser: {uid: quem, email: perfil.email},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: quem, email: perfil.email, displayName: perfil.nome}), 0); },
          signOut() { return Promise.resolve(); }};
      },
      storage() {
        exige('storage');
        window.__arquivos = window.__arquivos || {};
        return {ref(caminho) {
          return {
            put(arq, meta) { window.__arquivos[caminho] = {bytes: arq.size, tipo: (meta && meta.contentType) || arq.type}; return Promise.resolve(); },
            getDownloadURL() { return Promise.resolve('https://storage.test/' + caminho); },
            delete() { delete window.__arquivos[caminho]; return Promise.resolve(); }
          };
        }};
      },
      database() {
        exige('database');
        const ref = (path) => {
          const valor = () => { const v = ler(path); return v === undefined ? null : structuredClone(v); };
          const snap = () => { const v = valor(); return {val: () => v, exists: () => v !== null, key: partes(path).pop(),
            forEach(cb) { Object.entries(v || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
          return {path, key: partes(path).pop(),
            once(ev, cb) { const sn = snap(); if (cb) cb(sn); return Promise.resolve(sn); },
            on(ev, cb) {
              const avisar = () => cb(snap());
              ouvintes.push({path: path, avisar: avisar});
              setTimeout(avisar, 0);
              return cb;
            },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, limitToLast() { return this; }, startAt() { return this; },
            push(v) {
              seq++;
              const filho = ref(path + '/-M' + seq);
              if (v === undefined) return filho;
              gravar(filho.path, v);
              const pr = Promise.resolve(filho); pr.key = filho.key; return pr;
            },
            set(v) { gravar(path, v); return Promise.resolve(); },
            update(obj) { Object.entries(obj).forEach(([k, v]) => gravar(path + '/' + k, v)); return Promise.resolve(); },
            remove() { gravar(path, null); return Promise.resolve(); },
            transaction(fn) { const r = fn(valor()); if (r !== undefined) gravar(path, r);
              return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        };
        return {ref: (p) => ref(p || '')};
      }
    };
  }, {data: estadoInicial || dados(), quem: uid});
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'mn.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://mn.test/' + (pagina || 'manipulacao.html'));
  await page.waitForSelector('.kt-sidebar', {timeout: 8000});
  await page.waitForFunction(() => window.currentUser && window.currentUser.nome);
  return {page, errors};
}


(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser, 'u1', dados(), 'emitir_op.html');
    await page.waitForFunction(() => typeof selecionarProduto === 'function' && typeof allProdutos !== 'undefined' && Object.keys(allProdutos).length === 2 && Object.keys(allBom).length === 2, null, {timeout: 10000});
    const estado = () => page.evaluate(() => ({bloqueio: emissaoBloqueadaMotivo, desabilitado: document.getElementById('btnEmitir').disabled, aviso: document.getElementById('formulaWarning').innerText, classe: document.getElementById('formulaWarning').className}));

    // Produto com a BOM sem aprovação: bloqueia e diz o que falta, quem aprova e onde
    await page.evaluate(() => selecionarProduto('SKU-BOM'));
    let e = await estado();
    assert.match(e.bloqueio, /Não dá para emitir: SKU-BOM/); assert.match(e.bloqueio, /BOM \(PCP e Comercial\)/);
    assert.ok(!/Fórmula \(/.test(e.bloqueio) && !/Especificação \(/.test(e.bloqueio), 'só lista o que falta');
    assert.equal(e.desabilitado, true); assert.match(e.aviso, /⛔/); assert.match(e.classe, /alert-danger/);
    await page.evaluate(() => emitirOP());
    assert.equal(Object.keys((await page.evaluate(() => window.__db.ops || {}))).length, 0, 'nenhuma OP gravada');
    assert.match(await page.locator('body').innerText(), /Não dá para emitir/);

    // Produto com as três aprovações: libera
    await page.evaluate(() => selecionarProduto('SKU-OK'));
    e = await estado();
    assert.equal(e.bloqueio, ''); assert.equal(e.desabilitado, false);
    assert.doesNotMatch(e.classe, /alert-danger/); assert.equal(await page.locator('#formulaWarning').isVisible(), false, 'aviso escondido');

    // Voltar ao bloqueado: o bloqueio volta (não fica "lembrado" do produto anterior)
    await page.evaluate(() => selecionarProduto('SKU-BOM'));
    e = await estado(); assert.equal(e.desabilitado, true); assert.ok(e.bloqueio);
    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    console.log('OK Emitir OP: sem Fórmula + BOM + Especificação aprovadas bloqueia (diz o que falta e quem aprova); com as três, libera.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
