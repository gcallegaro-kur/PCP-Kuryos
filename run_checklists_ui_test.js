'use strict';
/* Modelos de checklist (19/10/2026): criar os modelos iniciais, editar, publicar versão nova, histórico com diferenças. Firebase simulado ao vivo (o de run_pendencias_produto_ui_test.js). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');


async function abrir(browser, estadoInicial, pagina) {
  const page = await browser.newPage({viewport: {width: 1500, height: 1100}});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript((data) => {
    const db = data;
    window.__db = db;
    let iniciado = false;
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const ouvintes = [];
    const notificar = (bruto) => {
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
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); iniciado = true; },
      auth() {
        if (!iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (auth)");
        return {currentUser: {uid: 'u1', email: 'g@kuryos.com'},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), 0); },
          signOut() { return Promise.resolve(); }};
      },
      database() {
        if (!iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (database)");
        const ref = (path) => {
          const valor = () => { const v = ler(path); return v === undefined ? null : structuredClone(v); };
          const snap = () => { const v = valor(); return {val: () => v, exists: () => v !== null, key: partes(path).pop(),
            forEach(cb) { Object.entries(v || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
          return {path, key: partes(path).pop(),
            once(ev, cb) { const sn = snap(); if (cb) cb(sn); return Promise.resolve(sn); },
            on(ev, cb) { const avisar = () => cb(snap()); ouvintes.push({path, avisar}); setTimeout(avisar, 0); return cb; },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, limitToLast() { return this; }, startAt() { return this; },
            push(v) {
              seq++;
              const filho = ref(path + '/-N' + seq);
              if (v === undefined) return filho;
              gravar(filho.path, v);
              const pr = Promise.resolve(filho); pr.key = filho.key; return pr;
            },
            set(v) { gravar(path, v); return Promise.resolve(); },
            update(obj) { Object.entries(obj).forEach(([k, v]) => gravar(path + '/' + k, v)); return Promise.resolve(); },
            remove() { gravar(path, null); return Promise.resolve(); },
            transaction(fn) { const r = fn(valor()); if (r !== undefined) gravar(path, r); return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        };
        return {ref: (p) => ref(p || '')};
      }
    };
  }, estadoInicial);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'ck.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://ck.test/' + pagina);
  try {
    await page.waitForFunction(() => window.currentUser && window.currentUser.nome, null, {timeout: 12000});
  } catch (e) {
    console.log('DBG url', page.url(), 'erros', errors, await page.evaluate(() => [document.title, typeof window.currentUser, document.body.innerText.slice(0, 200)]));
    throw e;
  }
  return {page, errors};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page: p, errors} = await abrir(browser, {usuarios: {u1: {nome: 'Daiene', email: 'cq@kuryos.com', role: 'admin'}}, config: {}}, 'checklists_cq.html');
    await p.waitForSelector('#btnPadrao');
    assert.match(await p.locator('#btnPadrao').innerText(), /CK-3, CK-4, CK-5/);
    await p.click('#btnPadrao');
    await p.waitForFunction(() => document.querySelectorAll('.mod').length === 3);
    const db = () => p.evaluate(() => window.__db.checklist_modelos);
    let m = await db();
    const ck4 = Object.keys(m).find((k) => m[k].codigo === 'CK-4');
    assert.equal(m[ck4].versaoAtual, 1);
    assert.equal(m[ck4].versoes[1].criadaPor, 'Daiene');
    assert.ok(m[ck4].versoes[1].itens.length >= 8);
    assert.match(await p.locator('#mods').innerText(), /CK-3[\s\S]*versão 1/);

    // Abrir o CK-4, mudar um texto, incluir uma pergunta e publicar a versão 2.
    await p.click(`[data-mod="${ck4}"]`);
    await p.waitForFunction(() => /CK-4/.test(document.querySelector('#editor h2').innerText));
    const n1 = await p.locator('#itens .it').count();
    await p.locator('#itens .it').first().locator('.tx').fill('Bicos, mangueiras, pistões e válvulas desmontados');
    await p.click('#btnAddItem');
    await p.locator('#itens .it').last().locator('.tx').fill('Filtro trocado conforme o plano');
    await p.locator('#itens .it').last().locator('[data-f="critico"]').check();
    assert.equal(await p.locator('#itens .it').count(), n1 + 1);
    assert.match(await p.locator('.publicar').innerText(), /1 nova\(s\), 0 removida\(s\), 1 alterada\(s\)/);
    await p.fill('#nota', 'Após RNC do filtro');
    await p.click('#btnPublicar');
    await p.waitForFunction((id) => window.__db.checklist_modelos[id].versaoAtual === 2, ck4);
    m = await db();
    assert.equal(m[ck4].versoes[1].itens[0].texto, 'Bicos, mangueiras e pistões desmontados', 'versão 1 intacta');
    assert.equal(m[ck4].versoes[2].itens[0].texto, 'Bicos, mangueiras, pistões e válvulas desmontados');
    assert.equal(m[ck4].versoes[2].nota, 'Após RNC do filtro');
    assert.equal(m[ck4].versoes[2].itens.slice(-1)[0].critico, true);

    // Sem mudanças, não publica.
    await p.waitForFunction(() => /Igual à versão 2/.test(document.querySelector('.publicar').innerText));
    assert.equal(await p.locator('#btnPublicar').isDisabled(), true);

    // Tipo AMOSTRAS mostra os campos de amostras; erro de validação aparece.
    await p.locator('#itens .it').last().locator('[data-f="tipo"]').selectOption('AMOSTRAS');
    await p.waitForSelector('#itens .it:last-child [data-f="amostras.n"]');
    await p.locator('#itens .it').last().locator('[data-f="amostras.nominalModo"]').selectOption('FIXO');
    await p.click('#btnPublicar');
    assert.match(await p.locator('#pubErro').innerText(), /valor nominal/);
    await p.locator('#itens .it').last().locator('[data-f="amostras.nominalModo"]').selectOption('PRODUTO');
    await p.click('#btnRascunho');
    await p.waitForFunction((id) => !!window.__db.checklist_modelos[id].rascunho, ck4);
    assert.match(await p.locator('#mods').innerText(), /rascunho/);

    // Histórico com as diferenças.
    await p.click('[data-aba="historico"]');
    const h = await p.locator('#editor').innerText();
    assert.match(h, /Versão 2[\s\S]*Após RNC do filtro[\s\S]*\+ Filtro trocado conforme o plano[\s\S]*✎ Bicos, mangueiras, pistões e válvulas desmontados[\s\S]*Versão 1/);
    if (process.env.CK_SHOT) { await p.click('[data-aba="editar"]'); await p.screenshot({path: process.env.CK_SHOT, fullPage: false}); }
    assert.deepEqual(errors, [], 'erros: ' + errors.join(' | '));
    console.log('OK Modelos de checklist: modelos iniciais, edição, publicação de versão nova (antiga intacta), validação, rascunho e histórico com diferenças.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
