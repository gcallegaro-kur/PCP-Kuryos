'use strict';
/* Dossiê do lote: campos de data na tela real (Firebase simulado). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const ops = {
  a: {lote: '26250/02', produto: 'BODY SPLASH A', cliente: 'MISS ROSE', status: 'Concluído', dataEmissao: '2026-10-10T08:00:00', dataInicioReal: '2026-10-15T13:00:00Z', dataFimReal: '2026-10-15T20:00:00Z', confirmadoEm: '2026-10-16T12:00:00Z'},
  b: {lote: '26251/01', produto: 'HIDRATANTE B', cliente: 'GLOW', status: 'Concluído', dataInicioReal: '2026-10-14T20:00:00', dataFimReal: '2026-10-16T10:00:00'},
  e: {lote: '26254/01', produto: 'SEM DATA E', cliente: 'LEGADO', status: 'Concluído'},
  f: {lote: '25014/02', produto: 'ANTIGO F', cliente: 'MISS ROSE', status: 'Concluído', dataInicioReal: '2025-01-16T07:00:00', dataFimReal: '2025-01-16T09:45:00'}
};

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1500, height: 1100}});
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    await page.addInitScript((o) => {
      const db = {usuarios: {u1: {nome: 'Ana', email: 'a@k.com', role: 'admin'}}, ops: o};
      window.__iniciado = false;
      const get = (p) => p.split('/').filter(Boolean).reduce((x, k) => (x == null ? undefined : x[k]), db);
      const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
      window.firebase = {
        initializeApp() { window.__iniciado = true; },
        auth() { return {currentUser: {uid: 'u1', email: 'a@k.com'}, onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'a@k.com', displayName: 'Ana'}), 0); }, signOut() { return Promise.resolve(); }}; },
        storage() { return {ref() { return {}; }}; },
        database() { return {ref(p) { p = p || ''; const snap = () => ({val: () => clone(p ? get(p) : db), exists: () => get(p) !== undefined, forEach() {}});
          return {path: p, once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); }, on(ev, cb) { setTimeout(() => cb(snap()), 0); return cb; }, off() {}, child() { return this; },
            orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; }}; }}; }
      };
    }, ops);
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'd.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + url.pathname.slice(1);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    await page.goto('https://d.test/dossie_lote.html');
    await page.waitForSelector('#dResultados tr.clicavel', {timeout: 10000});
    const linhas = () => page.locator('#dResultados tr.clicavel').allInnerTexts().then((a) => a.map((t) => t.split(/[\t\n]/)[0].trim()).sort());
    assert.equal((await linhas()).length, 4, 'sem filtro: todos');
    assert.match(await page.locator('#dResultados tr', {hasText: '26250/02'}).innerText(), /15\/10\/26/, 'coluna Produção');
    assert.match(await page.locator('#dResultados tr', {hasText: '26251/01'}).innerText(), /14\/10 → 16\/10\/26/, 'produção em dois dias');

    // Data digitada no campo de busca.
    await page.fill('#dBusca', '15/10/2026');
    await page.waitForFunction(() => document.querySelectorAll('#dResultados tr.clicavel').length === 2, null, {timeout: 5000});
    assert.deepEqual(await linhas(), ['26250/02', '26251/01']);
    assert.match(await page.locator('#dResumoBusca').innerText(), /2 lote\(s\) encontrado\(s\)/);
    await page.fill('#dBusca', '');

    // Campo "De" (só o dia), padrão = produção.
    await page.fill('#dDe', '2026-10-16');
    await page.waitForFunction(() => document.querySelectorAll('#dResultados tr.clicavel').length === 1, null, {timeout: 5000});
    assert.deepEqual(await linhas(), ['26251/01'], 'produção que atravessa o dia 16');
    // Intervalo + campo emissão.
    await page.selectOption('#dCampoData', 'emissao');
    await page.fill('#dDe', '2026-10-01'); await page.fill('#dAte', '2026-10-31');
    await page.waitForFunction(() => document.querySelectorAll('#dResultados tr.clicavel').length === 1 && /26250/.test(document.querySelector('#dResultados').innerText), null, {timeout: 5000});
    // Data + texto + produção de 2025.
    await page.selectOption('#dCampoData', 'producao');
    await page.fill('#dDe', '2025-01-01'); await page.fill('#dAte', '2025-12-31'); await page.fill('#dBusca', 'rose');
    await page.waitForFunction(() => document.querySelectorAll('#dResultados tr.clicavel').length === 1 && /25014/.test(document.querySelector('#dResultados').innerText), null, {timeout: 5000});
    await page.fill('#dDe', '2030-01-01'); await page.fill('#dAte', '2030-12-31');
    await page.waitForFunction(() => /Nenhum lote encontrado/.test(document.querySelector('#dResultados').innerText), null, {timeout: 5000});
    // Limpar volta ao padrão (o texto "rose" continua).
    await page.click('#dLimparData');
    await page.waitForFunction(() => document.querySelectorAll('#dResultados tr.clicavel').length === 2, null, {timeout: 5000});
    assert.equal(await page.inputValue('#dDe'), ''); assert.equal(await page.inputValue('#dAte'), '');
    assert.deepEqual(erros, [], 'sem erro de página: ' + erros.join(' | '));
  } finally { await browser.close(); }
  console.log('OK Dossiê do lote: busca por data (digitada e por intervalo/campo), coluna Produção.');
})().catch((e) => { console.error(e); process.exit(1); });
