'use strict';
/* Tela inicial: o que espera pela pessoa (cartões) e as áreas dela (atalhos),
   a partir do mesmo registro do menu (shared/navegacao.js). Firebase simulado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const dados = () => ({
  usuarios: {
    log: {nome: 'Lia Logística', email: 'l@k.com', role: 'logistica'},
    qua: {nome: 'Quito Qualidade', email: 'q@k.com', role: 'qualidade'},
    rot: {nome: 'Rafa Rótulos', email: 'r@k.com', role: 'rotulagem'},
    pen: {nome: 'Paula Pendente', email: 'p@k.com', role: 'pending'}
  },
  agendamentos_expedicao: {a1: {status: 'AGENDADA'}, a2: {status: 'AGENDADA'}, a3: {status: 'EXPEDIDO_PARCIAL'}},
  nao_conformidades: {n1: {status: 'ABERTA'}},
  ops: {
    '1-1': {lote: '1/01', produto: 'A', inspecaoTotal: {estado: 'AGUARDANDO_DESIGNACAO', sinalizacao: {em: '2026-10-26T10:00:00Z'}}},
    '2-1': {lote: '2/01', produto: 'B', inspecaoTotal: {estado: 'EM_INSPECAO', designacao: {prazoEm: '2000-01-01T00:00:00Z'}, sinalizacao: {em: '2026-10-25T10:00:00Z'}}}
  },
  programacao: {}
});

async function abrir(browser, uid) {
  const page = await browser.newPage({viewport: {width: 1400, height: 1000}});
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(({d, uid}) => {
    const ler = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), d);
    const email = d.usuarios[uid].email;
    window.firebase = {initializeApp() {},
      auth() { return {currentUser: {uid, email}, onAuthStateChanged(cb) { setTimeout(() => cb({uid, email}), 0); }, signOut() { return Promise.resolve(); }}; },
      database() {
        const ref = (p) => {
          const snap = () => { const v = ler(p); return {val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))), exists: () => v !== undefined, forEach() {}}; };
          return {once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); }, on(ev, cb) { setTimeout(() => cb(snap()), 0); return cb; }, off() {}, child(c) { return ref(p + '/' + c); },
            set() { return Promise.resolve(); }, update() { return Promise.resolve(); }, push() { return Promise.resolve(); }, transaction() { return Promise.resolve({}); }};
        };
        return {ref: (p) => ref(p || '')};
      }};
  }, {d: dados(), uid});
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'app.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript'});
  });
  await page.goto('https://app.test/inicio.html');
  await page.waitForSelector('#unified-navbar');
  return {page, erros};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // Logística: cartões das cargas, áreas de Armazém e Expedição, nada de PCP.
    let {page, erros} = await abrir(browser, 'log');
    await page.waitForSelector('#pend .cartao');
    assert.match(await page.locator('#ola').innerText(), /^(Bom dia|Boa tarde|Boa noite), Lia$/);
    const cart = await page.locator('#pend .cartao').allInnerTexts();
    assert.equal(cart.length, 2);
    assert.match(cart.join('|'), /2\s+Cargas a faturar/); assert.match(cart.join('|'), /1\s+Cargas para carregar/);
    assert.equal(await page.locator('#pend .cartao').first().getAttribute('href'), 'faturamento.html');
    const areas = await page.locator('#areas .area h3').allInnerTexts();
    assert.ok(areas.includes('Armazém') && areas.includes('Expedição') && !areas.includes('PCP') && !areas.includes('Compras'));
    assert.equal(await page.locator('#unified-navbar .kt-nav-top .kt-nav-link.active').count(), 1, 'Início marcado no menu');
    assert.equal(await page.locator('#areas a[href="estoque.html?tab=posicoes"]').count(), 1);
    // Celular: sem rolagem horizontal e alvos de toque de 44 px nos atalhos.
    await page.setViewportSize({width: 375, height: 800});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'sem rolagem horizontal no celular');
    const alt = await page.$$eval('#areas a, #pend .cartao', (els) => els.map((x) => x.getBoundingClientRect().height));
    assert.ok(alt.every((h) => h >= 44), 'alvos de toque >= 44 px');
    assert.deepEqual(erros, []);
    await page.close();

    // Qualidade: inspeção total com prazo vencido (alerta, primeiro) e RNC aberta.
    ({page, erros} = await abrir(browser, 'qua'));
    await page.waitForSelector('#pend .cartao');
    const q = await page.locator('#pend .cartao').allInnerTexts();
    assert.match(q[0], /2\s+Inspeção total de PA[\s\S]*1 sem responsável · 1 com prazo vencido/);
    assert.equal(await page.locator('#pend .cartao').first().evaluate((a) => a.classList.contains('alerta')), true);
    assert.match(q.join('|'), /1\s+Não conformidades abertas/);
    assert.equal(await page.locator('#pend .cartao').nth(1).getAttribute('href'), 'qualidade.html?tab=rnc');
    assert.deepEqual(erros, []);
    await page.close();

    // Rotulagem: sem cartões, a seção some; só o atalho da Operação.
    ({page, erros} = await abrir(browser, 'rot'));
    await page.waitForSelector('#areas .area');
    assert.equal(await page.locator('#secPend').isVisible(), false);
    assert.ok((await page.locator('#areas .area h3').allInnerTexts()).includes('Operação'));
    assert.deepEqual(erros, []);
    if (process.env.INICIO_SCREENSHOT) { await page.close(); ({page} = await abrir(browser, 'qua')); await page.waitForSelector('#pend .cartao'); await page.screenshot({path: process.env.INICIO_SCREENSHOT}); }
    await page.close();
  } finally { await browser.close(); }
  console.log('OK Início: cartões por perfil (cargas, inspeção total, RNC), alerta primeiro, áreas do registro e seção oculta sem pendência.');
})().catch((e) => { console.error(e); process.exit(1); });
