'use strict';
/* Pesagens: tela real (Firebase simulado) — pesado no dia e pendências. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const soma = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const prev = {m1: {mpCodigo: 'MP1', mpNome: 'Água', previsto: 10, unidade: 'kg'}, m2: {mpCodigo: 'MP2', mpNome: 'Óleo', previsto: 5, unidade: 'kg'}};
const em = hoje + 'T15:00:00Z';
const ops = {
  a: {lote: '26001/01', produto: 'HID A', cliente: 'C1', status: 'Programado', dataEmissao: '2026-10-10T10:00:00Z', formulaVersao: 'v1', skuPedidoKey: 'P1__A',
    manipulacao: {status: 'AGUARDANDO_PESAGEM', previstos: prev, pesagem: {parcelas: {m1: {p1: {peso: 10, em, por: 'Ana', loteMaterial: 'L1', foto: {caminho: 'x', url: 'http://f/x.jpg'}}}}}}},
  b: {lote: '26002/01', produto: 'HID B', cliente: 'C2', status: 'Programado', dataEmissao: '2026-10-10T10:00:00Z', formulaVersao: 'v1', skuPedidoKey: 'P2__B'}
};
const grade = {[soma(hoje, 1)]: {'08:00': {L1: {pedidoKey: 'P2__B'}}}, [soma(hoje, 4)]: {'08:00': {L1: {pedidoKey: 'P1__A'}}}};

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1500, height: 1100}});
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    await page.addInitScript((d) => {
      const db = {usuarios: {u1: {nome: 'Ana', email: 'a@k.com', role: 'admin'}}, ops: d.ops, programacao: d.grade};
      const get = (p) => p.split('/').filter(Boolean).reduce((x, k) => (x == null ? undefined : x[k]), db);
      const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
      window.firebase = {
        initializeApp() {},
        auth() { return {currentUser: {uid: 'u1', email: 'a@k.com'}, onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'a@k.com', displayName: 'Ana'}), 0); }, signOut() { return Promise.resolve(); }}; },
        storage() { return {ref() { return {}; }}; },
        database() { return {ref(p) { p = p || ''; const snap = () => ({val: () => clone(p ? get(p) : db), exists: () => get(p) !== undefined, forEach() {}});
          return {path: p, update() { return Promise.resolve(); }, set() { return Promise.resolve(); }, push() { return Promise.resolve(); }, once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); }, on(ev, cb) { setTimeout(() => cb(snap()), 0); return cb; }, off() {}, child() { return this; },
            orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; }}; }}; }
      };
    }, {ops, grade});
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'd.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + url.pathname.slice(1);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    await page.goto('https://d.test/pesagens.html');
    await page.waitForSelector('#dLinhas tr td', {timeout: 10000});

    // Pesado no dia (hoje)
    assert.match(await page.locator('#dResumo').innerText(), /1 pesagem/);
    assert.match(await page.locator('#dPorOper').innerText(), /Ana/);
    assert.match(await page.locator('#dLinhas').innerText(), /26001\/01[\s\S]*MP1[\s\S]*Água[\s\S]*L1[\s\S]*10[\s\S]*ver foto/);
    assert.match(await page.locator('#dPorOp').innerText(), /1 de 2[\s\S]*incompleta/);
    // Outro dia: vazio
    await page.fill('#dData', soma(hoje, -3));
    await page.waitForFunction(() => /Nenhuma pesagem registrada/.test(document.querySelector('#dResumo').innerText), null, {timeout: 5000});
    assert.match(await page.locator('#dLinhas').innerText(), /Nada pesado/);
    await page.click('#dHoje');
    await page.waitForFunction(() => /1 pesagem/.test(document.querySelector('#dResumo').innerText), null, {timeout: 5000});
    // Filtro por operador que não existe volta a "Todos"
    await page.selectOption('#dOper', 'Ana');
    assert.match(await page.locator('#dResumo').innerText(), /1 pesagem/);

    // Pendências: B envasa amanhã sem pesagem (fora da meta); A está na janela (4 dias)
    assert.equal((await page.locator('#pBadge').innerText()).trim(), '1', 'selo: 1 para cobrar');
    await page.click('.aba[data-aba=pend]');
    const linhas = await page.locator('#pLinhas tr').allInnerTexts();
    assert.equal(linhas.length, 2);
    assert.match(linhas[0], /Fora da meta[\s\S]*26002\/01[\s\S]*em 1d[\s\S]*não iniciada/);
    assert.match(linhas[1], /Já pode pesar[\s\S]*26001\/01[\s\S]*em 4d[\s\S]*1 de 2/);
    // Meta maior (5 dias) torna A cobrável
    await page.fill('#pIdeal', '5'); await page.fill('#pJanela', '6');
    await page.waitForFunction(() => document.querySelector('#pBadge').innerText.trim() === '2', null, {timeout: 5000});
    assert.deepEqual(erros, [], 'sem erro de página: ' + erros.join(' | '));
  } finally { await browser.close(); }
  console.log('OK Pesagens: pesado no dia, filtro de operador, pendências e meta configurável.');
})().catch((e) => { console.error(e); process.exit(1); });
