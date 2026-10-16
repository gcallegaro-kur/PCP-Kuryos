'use strict';
/* Qualidade: a fila de PA mostra UM item por lote (OP), o laudo abre com a
   amostra palete a palete e a decisão grava o lote inteiro. Tela de verdade,
   utils.js e auth_check.js reais, Firebase simulado e com estado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const pal = (n, extra) => Object.assign({
  itemTipo: 'produto', itemCodigo: 'SKU1', itemNome: 'BODY SPLASH X', unidade: 'un', opKey: '26280-01', opLote: '26280/01', loteOrigem: '26280/01',
  paleteNumero: n, identificadorPalete: 'PA-26280-01-P' + n, caixasFechadas: n === 1 ? 61 : 30, unidadesCaixaParcial: 0,
  saldoLote: n === 1 ? 1464 : 720, status: 'QUARENTENA', origemTipo: 'conferencia_pa', enderecoCodigo: 'A-0' + n, criadoEm: '2026-10-10T10:00:00Z'
}, extra || {});

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1600, height: 1100}});
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    page.on('dialog', (d) => d.accept());
    const dados = {
      'usuarios/u1': {nome: 'Ana Qualidade', email: 'q@kuryos.com', role: 'qualidade'},
      estoque_lotes: {SKU1: {pa_1: pal(1), pa_2: pal(2)}},
      ops: {'26280-01': {lote: '26280/01', sku: 'SKU1', produto: 'BODY SPLASH X'}}
    };
    await page.addInitScript((inicial) => {
      const db = JSON.parse(JSON.stringify(inicial));
      window.__db = db; window.__iniciado = false; window.__updates = [];
      const exige = (q) => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
      const get = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), db);
      const set = (p, v) => {
        const ks = p.split('/').filter(Boolean); let o = db;
        ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
        if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
      };
      const ouvintes = [];
      const avisa = () => ouvintes.forEach((o) => setTimeout(() => o.cb({val: () => { const v = get(o.p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); }, exists: () => get(o.p) !== undefined}), 0));
      let seq = 0;
      window.firebase = {
        initializeApp() { window.__iniciado = true; },
        auth() { exige('auth'); return {currentUser: {uid: 'u1', email: 'q@kuryos.com', displayName: 'Ana Qualidade'},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'q@kuryos.com', displayName: 'Ana Qualidade'}), 0); }, signOut() { return Promise.resolve(); }}; },
        storage() { return {ref() { return {put: () => Promise.resolve(), getDownloadURL: () => Promise.resolve('')}; }}; },
        database() {
          exige('database');
          return {ref(p) {
            p = p || '';
            const snap = () => ({val: () => { const v = p ? get(p) : db; return v === undefined ? null : JSON.parse(JSON.stringify(v)); }, exists: () => get(p) !== undefined, forEach() {}});
            return {path: p,
              once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); },
              on(ev, cb) { ouvintes.push({p, cb}); setTimeout(() => cb(snap()), 0); return cb; }, off() {}, child(c) { return this; },
              orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
              set(v) { set(p, v); avisa(); return Promise.resolve(); },
              update(u) { window.__updates.push(Object.keys(u)); Object.keys(u).forEach((k) => set((p ? p + '/' : '') + k, u[k])); avisa(); return Promise.resolve(); },
              remove() { set(p, null); avisa(); return Promise.resolve(); },
              push(v) { const k = 'k' + (++seq); const r = Object.assign(Promise.resolve(), {key: k}); if (v !== undefined) set(p + '/' + k, v); return r; },
              transaction(fn) {
                const atual = get(p) === undefined ? null : JSON.parse(JSON.stringify(get(p)));
                const r = fn(atual);
                if (r === undefined) return Promise.resolve({committed: false, snapshot: snap()});
                set(p, r); avisa(); return Promise.resolve({committed: true, snapshot: snap()});
              }};
          }};
        }
      };
    }, dados);
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'q.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + url.pathname.slice(1);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    await page.goto('https://q.test/qualidade.html?tab=fila&tipo=pa');
    await page.waitForSelector('#qFilaBody', {timeout: 8000});

    // Fila: um item por lote, com os dois paletes dentro.
    await page.waitForFunction(() => /Laudar lote/.test(document.querySelector('#qFilaBody').innerText), null, {timeout: 8000});
    const fila = await page.locator('#qFilaBody').innerText();
    assert.match(fila, /2 palete\(s\)/);
    assert.match(fila, /91 caixa/);
    assert.equal(await page.locator('#qFilaBody [data-laudo-op]').count(), 1, 'uma linha para o lote inteiro');
    assert.doesNotMatch(fila, /Laudar\s*$/m);

    // Laudo do lote: título, amostra palete a palete.
    await page.click('#qFilaBody [data-laudo-op]');
    await page.waitForSelector('#modalLaudoBg.open', {timeout: 5000});
    assert.match(await page.locator('#modalLaudoTitle').innerText(), /Liberação de lote/);
    const amostra = await page.locator('#qCk7Amostra').innerText();
    assert.match(amostra, /Palete PA-26280-01-P1.*9 de 61/s);
    assert.match(amostra, /Palete PA-26280-01-P2.*7 de 30/s);
    assert.match(amostra, /Total: 16 de 91/);
    assert.match(await page.locator('#qLoteInfo').innerText(), /2 palete\(s\) — um só laudo para o lote inteiro/);
    assert.match(await page.locator('#qBtnLiberar').innerText(), /Liberar lote para expedição/);

    // Reter o lote: grava UM laudo e os dois paletes mudam juntos.
    await page.fill('#qObservacao', 'Rótulo com mancha — reter o lote');
    await page.click('#qBtnReter');
    await page.waitForFunction(() => window.__db.ops['26280-01'].qualidadePA && window.__db.ops['26280-01'].qualidadePA.decisao, null, {timeout: 8000});
    const est = await page.evaluate(() => ({
      laudo: window.__db.ops['26280-01'].qualidadePA,
      p1: window.__db.estoque_lotes.SKU1.pa_1, p2: window.__db.estoque_lotes.SKU1.pa_2,
      updates: window.__updates.filter((u) => u.includes('ops/26280-01/qualidadePA')).length
    }));
    assert.equal(est.laudo.decisao, 'RETIDO'); assert.equal(est.laudo.qtdPaletes, 2);
    assert.equal(est.p1.status, 'RETIDO'); assert.equal(est.p2.status, 'RETIDO');
    assert.equal(est.p1.qualidade.laudoLote, '26280-01'); assert.equal(est.p2.qualidade.inspecionadoEm, est.p1.qualidade.inspecionadoEm);
    assert.equal(est.laudo.amostragemPaletes.length, 2);
    assert.equal(est.updates, 1, 'um único update multi-path grava o laudo e os dois paletes');
    await page.waitForFunction(() => !/Laudar lote/.test(document.querySelector('#qFilaBody').innerText), null, {timeout: 8000});
    assert.deepEqual(erros, [], 'sem erro de página: ' + erros.join(' | '));
  } finally { await browser.close(); }
  console.log('OK Qualidade: PA por lote — fila com um item por OP, amostra por palete, decisão grava o lote inteiro.');
})().catch((e) => { console.error(e); process.exit(1); });
