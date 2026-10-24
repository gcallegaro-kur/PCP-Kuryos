'use strict';
/* BOM e Fórmula mostram o nome ATUAL do material (cadastros.html), não a cópia gravada no item. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    config: {linhas: ['Linha 1']},
    materiais: {
      'EP-1': {tipo: 'EP', mpCodigo: 'EP-1', mpNome: 'FRASCO NOME NOVO', unidade: 'un'},
      'MPGR-1': {tipo: 'MPGR', mpCodigo: 'MPGR-1', mpNome: 'ALCOOL CEREAL NOVO', unidade: 'kg'}
    },
    produtos: {'SKU-X': {sku: 'SKU-X', descricao: 'BODY SPLASH', clienteKey: 'MISS'}},
    bom: {'SKU-X__v1': {codProduto: 'SKU-X', versao: 'v1', status: 'APROVADA', itens: {
      a: {materialCodigo: 'EP-1', materialNome: 'FRASCO NOME ANTIGO', qtdPorPeca: 1, posicao: 1},
      b: {materialCodigo: 'EP-9', materialNome: 'ITEM FORA DO CADASTRO', qtdPorPeca: 1, posicao: 2}}}},
    formulas: {'SKU-X__v1': {codProduto: 'SKU-X', versao: 'v1', status: 'APROVADA', somaPercentual: 100, itens: {
      a: {mpCodigo: 'MPGR-1', mpNome: 'ALCOOL NOME ANTIGO', fase: 'A', ordemAdicao: 1, percentualMM: 100}}}},
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
    await page.fill('#fProdutoBusca-form', 'SKU-X');
    await page.click('#produtoResultados-form [data-key="SKU-X"]');
    await page.waitForSelector('#bomBody-form', {state: 'attached'});
    await page.click('[data-tab="form-bom"]');
    const bom = await page.locator('#bomBody-form').innerText();
    assert.match(bom, /EP-1 — FRASCO NOME NOVO/, 'BOM mostra o nome do cadastro: ' + bom);
    assert.ok(!/NOME ANTIGO/.test(bom), 'sem o nome velho');
    assert.match(bom, /EP-9 — ITEM FORA DO CADASTRO/, 'material fora do cadastro cai na cópia gravada');
    await page.click('[data-tab="form-formula"]');
    const form = await page.locator('#tab-form-formula').innerText();
    assert.match(form, /MPGR-1 — ALCOOL CEREAL NOVO/, 'Fórmula mostra o nome do cadastro: ' + form);
    assert.ok(!/NOME ANTIGO/.test(form));
    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    console.log('OK Cadastros: BOM e Fórmula mostram o nome atual do material; sem cadastro, a cópia gravada.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
