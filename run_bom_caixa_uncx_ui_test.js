'use strict';
/* BOM e Fórmula mostram o nome ATUAL do material (cadastros.html), não a cópia gravada no item. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    config: {linhas: ['Linha 1']},
    clientes: {MISS: {nome: 'MISS ROSE'}},
    materiais: {
      'EP-1': {tipo: 'EP', mpCodigo: 'EP-1', mpNome: 'FRASCO R.24/410 HIDRA BODY SPLASH 200ML', unidade: 'un', ativo: true},
      'ET-9': {tipo: 'ET', mpCodigo: 'ET-9', mpNome: 'CAIXA DE EMBARQUE 406X306X184 BODY SPLASH 200ML', unidade: 'un', ativo: true}
    },
    produtos: {
      'SKU-COM': {sku: 'SKU-COM', descricao: 'PRODUTO COM UN/CX', clienteKey: 'MISS', unCx: 48},
      'SKU-SEM': {sku: 'SKU-SEM', descricao: 'PRODUTO SEM UN/CX', clienteKey: 'MISS'}
    },
    bom: {
      'SKU-COM__v1': {codProduto: 'SKU-COM', versao: 'v1', status: 'RASCUNHO', itens: {
        a: {materialCodigo: 'EP-1', materialNome: 'FRASCO', qtdPorPeca: 1, posicao: 1},
        b: {materialCodigo: 'ET-9', materialNome: 'CAIXA', qtdPorPeca: 0.016667, pecasPorUnidade: 60, posicao: 2}}},
      'SKU-SEM__v1': {codProduto: 'SKU-SEM', versao: 'v1', status: 'RASCUNHO', itens: {
        b: {materialCodigo: 'ET-9', materialNome: 'CAIXA', qtdPorPeca: 0.016667, pecasPorUnidade: 60, posicao: 1}}}
    },
    formulas: {
      'SKU-COM__v1': {codProduto: 'SKU-COM', versao: 'v1', status: 'RASCUNHO', itens: {}},
      'SKU-SEM__v1': {codProduto: 'SKU-SEM', versao: 'v1', status: 'RASCUNHO', itens: {}}
    },
    especificacoes: {}
  };
}

async function abrir(browser, pagina) {
  const page = await browser.newPage({viewport: {width: 1600, height: 1100}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(({data}) => {
    const db = data;
    window.__db = db;
    window.__iniciado = false;
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const gravar = (p, v) => {
      const ks = partes(p); let o = db;
      ks.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
      if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = structuredClone(v);
    };
    let seq = 0;
    const exige = q => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() {
        exige('auth');
        return {currentUser: {uid: 'u1', email: 'g@kuryos.com'},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), 0); },
          signOut() { return Promise.resolve(); }};
      },
      database() {
        exige('database');
        const ref = (path, filtro) => {
          const valor = () => {
            let v = ler(path);
            if (filtro && v && typeof v === 'object') v = Object.fromEntries(Object.entries(v).filter(([k]) => k >= filtro));
            return v === undefined ? null : structuredClone(v);
          };
          const snap = () => { const v = valor(); return {val: () => v, exists: () => v !== null, key: partes(path).pop(), forEach(cb) { Object.entries(v || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
          return {path, key: partes(path).pop(),
            once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); },
            on(ev, cb) { setTimeout(() => cb(snap()), 0); return cb; },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
            startAt(k) { return ref(path, k); },
            push() { seq++; return ref(path + '/-T' + seq); },
            set(v) { gravar(path, v); return Promise.resolve(); },
            update(obj) { Object.entries(obj).forEach(([k, v]) => gravar(path + '/' + k, v)); return Promise.resolve(); },
            remove() { gravar(path, null); return Promise.resolve(); },
            transaction(fn) { const r = fn(valor()); if (r !== undefined) gravar(path, r); return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        };
        return {ref: (p) => ref(p || '')};
      }
    };
  }, {data: dados()});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'tr.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://tr.test/' + pagina);
  await page.waitForSelector('.kt-sidebar', {timeout: 8000});
  return {page, errors};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser, 'cadastros.html?tab=formulas');
    const db = () => page.evaluate(() => window.__db);
    const abrirProduto = async (sku) => {
      await page.fill('#fProdutoBusca-form', sku);
      await page.click('#produtoResultados-form [data-key="' + sku + '"]');
      await page.click('[data-tab="form-bom"]');
      await page.waitForSelector('#bomBody-form tr[data-item]');
    };

    // Produto com un/cx 48: a caixa mostra 48 (e não os 60 gravados), travada; o frasco continua editável
    await abrirProduto('SKU-COM');
    const caixa = page.locator('#bomBody-form tr[data-item="b"] .b-pecas');
    assert.equal(await caixa.inputValue(), '48', 'mostra o un/cx do produto, não o 60 que estava gravado');
    assert.equal(await caixa.getAttribute('readonly') !== null, true);
    assert.match(await page.locator('#bomBody-form tr[data-item="b"]').innerText(), /un\/cx do produto/);
    assert.equal(await page.locator('#bomBody-form tr[data-item="a"] .b-qtd').getAttribute('readonly'), null, 'frasco segue editável');
    // gravar a caixa grava SEMPRE o un/cx do produto
    await page.evaluate(() => { const el = document.querySelector('#bomBody-form tr[data-item="b"] .b-pecas'); el.dispatchEvent(new Event('change', {bubbles: true})); });
    await page.waitForFunction(() => window.__db.bom['SKU-COM__v1'].itens.b.pecasPorUnidade === 48, null, {timeout: 5000});
    const b = (await db()).bom['SKU-COM__v1'].itens.b;
    assert.deepEqual([b.pecasPorUnidade, b.qtdPorPeca], [48, 0.020833], 'qtd = 1 ÷ 48');

    // Produto SEM un/cx: não grava a caixa e manda cadastrar
    await page.fill('#fProdutoBusca-form', 'SKU-SEM');
    await page.click('#produtoResultados-form [data-key="SKU-SEM"]');
    await page.waitForSelector('#bomBody-form tr[data-item="b"]');
    assert.match(await page.locator('#bomBody-form tr[data-item="b"]').innerText(), /cadastre o un\/cx do produto/);
    await page.evaluate(() => { const el = document.querySelector('#bomBody-form tr[data-item="b"] .b-pecas'); el.removeAttribute('readonly'); el.value = '60'; el.dispatchEvent(new Event('change', {bubbles: true})); });
    await page.waitForFunction(() => /unidades por caixa/.test(document.body.innerText), null, {timeout: 5000});
    assert.equal((await db()).bom['SKU-SEM__v1'].itens.b.pecasPorUnidade, 60, 'nada foi gravado');
    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    console.log('OK BOM: a caixa de embarque usa o un/cx do produto (travado, 1 ÷ un/cx); sem un/cx no produto, não grava.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
