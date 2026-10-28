'use strict';
/* Desmembrar palete na Montar Carga, de ponta a ponta: tela e módulos reais,
   Firebase simulado em memória com escrita viva (a grade se redesenha depois). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {fixture} = require('./run_expedicao_test');

const clone = (x) => JSON.parse(JSON.stringify(x));
function cenario() {
  const data = fixture(); // PA001: pa_op1_p1 = 12 cx × 24 + parcial 7 = 295 un, liberado
  const base = data.estoque_lotes.PA001.pa_op1_p1;
  data.estoque_lotes.PA001.cheio = {...clone(base), identificadorPalete: 'PA-OP1-P9', paleteNumero: 9, caixasFechadas: 1, unidadesCaixaParcial: 0, saldoLote: 24, qtdOriginal: 24};
  data.estoque_lotes.PA001.agendado = {...clone(base), identificadorPalete: 'PA-OP1-P8', paleteNumero: 8, caixasFechadas: 5, unidadesCaixaParcial: 0, saldoLote: 120, qtdOriginal: 120};
  data.agendamentos_expedicao = data.agendamentos_expedicao || {};
  data.agendamentos_expedicao.ag1 = {status: 'AGENDADO', cliente: 'Cliente A', paletes: [{itemKey: 'PA001', loteKey: 'agendado', quantidade: 120, saldoAntes: 120}]};
  return data;
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1500, height: 1000}}), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((data) => {
      window.__data = data; const ouvintes = [];
      const partes = (p) => String(p || '').split('/').filter(Boolean);
      const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), window.__data);
      const copia = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
      const avisar = (path) => { const raiz = partes(path)[0]; ouvintes.forEach((o) => { if (o.path === raiz) o.cb({val: () => copia(window.__data[raiz]) || {}}); }); };
      const gravar = (p, v) => {
        const ks = partes(p); let o = window.__data;
        ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
        if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = copia(v);
      };
      let seq = 0;
      const ref = (path) => ({path, key: partes(path).pop(),
        once: async () => ({val: () => copia(ler(path))}),
        push: () => ({key: 'k' + (++seq)}),
        transaction: async (fn) => {
          const atual = copia(ler(path)); const novo = fn(atual);
          if (novo === undefined) return {committed: false, snapshot: {val: () => atual}};
          if (novo !== null) { gravar(path, novo); avisar(path); }
          return {committed: novo !== null, snapshot: {val: () => novo}};
        },
        update: async (u) => { Object.keys(u).forEach((k) => gravar((path ? path + '/' : '') + k, u[k])); Object.keys(u).forEach((k) => avisar(k)); }
      });
      window.firebase = {initializeApp() {}, database() { return {ref}; }, functions() { return {httpsCallable() { return async () => ({data: {}}); }}; }};
      window.kuryosDatabaseURL = (x) => x; window.kuryosConnectEmulatorsIfLocal = () => {};
      window.escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
      window.dbOnValue = (r, cb) => { ouvintes.push({path: r.path, cb}); cb({val: () => copia(window.__data[r.path]) || {}}); };
      window.currentUser = {nome: 'Carlos Logística'};
    }, cenario());
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'expedicao.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const name = url.pathname.slice(1);
      if (name === 'auth_check.js' || name === 'shared/utils.js') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + name;
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file), contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    await page.goto('https://expedicao.test/expedicao.html');
    await page.waitForFunction(() => document.querySelectorAll('[data-palete]').length >= 3);

    const antes = await page.locator('[data-palete]').count();

    // ── 1. Botão só onde faz sentido ─────────────────────────────────────
    assert.equal(await page.locator('[data-desmembrar="PA001/pa_op1_p1"]').count(), 1, 'palete com 12 cx + parcial pode');
    assert.equal(await page.locator('[data-desmembrar="PA001/cheio"]').count(), 0, 'uma caixa só não se divide');
    assert.equal(await page.locator('[data-desmembrar="PA001/agendado"]').count(), 0, 'palete numa carga agendada não se mexe');

    // ── 2. Modal: soma errada não deixa confirmar ────────────────────────
    await page.click('[data-desmembrar="PA001/pa_op1_p1"]');
    const modal = page.locator('#dmLinhas');
    await modal.waitFor();
    assert.match(await page.locator('#dmMsg').innerText(), /Sobram \d+ caixa|Faltam \d+ caixa|dois paletes|vazio/, 'começa com o palete 2 vazio');
    assert.equal(await page.locator('#dmOk').isDisabled(), true);
    await page.fill('[data-dm="0"][data-campo="caixas"]', '7');
    await page.fill('[data-dm="1"][data-campo="caixas"]', '4');
    assert.match(await page.locator('#dmMsg').innerText(), /Faltam 1 caixa/);
    assert.equal(await page.locator('#dmOk').isDisabled(), true);
    // Parcial nos dois: recusa (é uma caixa só).
    await page.fill('[data-dm="1"][data-campo="caixas"]', '5');
    await page.fill('[data-dm="1"][data-campo="parcial"]', '7');
    assert.match(await page.locator('#dmMsg').innerText(), /uma caixa só/);
    // A parcial (7 un) fica toda no palete 2.
    await page.fill('[data-dm="0"][data-campo="parcial"]', '');
    assert.match(await page.locator('#dmMsg').innerText(), /Confere: 12 caixas \+ parcial de 7 un em 2 paletes/);
    assert.equal(await page.locator('#dmOk').isDisabled(), false);

    // ── 3. Confirma: a grade mostra os dois paletes, total preservado ────
    await page.click('#dmOk');
    await page.waitForFunction(() => !document.getElementById('dmLinhas'));
    assert.match(await page.locator('#resultado').innerText(), /Palete desmembrado em 2: PA-26254-01-P1 e PA-26254-01-P10\./);
    const lotes = await page.evaluate(() => window.__data.estoque_lotes.PA001);
    const filhos = Object.entries(lotes).filter(([k, l]) => l.desmembramento && l.desmembramento.deLoteKey === 'pa_op1_p1');
    assert.equal(filhos.length, 1);
    const [, novo] = filhos[0];
    assert.equal(lotes.pa_op1_p1.caixasFechadas, 7); assert.equal(lotes.pa_op1_p1.saldoLote, 168); assert.equal(lotes.pa_op1_p1.unidadesCaixaParcial, 0);
    assert.equal(novo.caixasFechadas, 5); assert.equal(novo.saldoLote, 127); assert.equal(novo.unidadesCaixaParcial, 7);
    assert.equal(168 + 127, 295, 'total de unidades preservado');
    assert.equal(novo.status, lotes.pa_op1_p1.status); assert.equal(novo.enderecoKey, lotes.pa_op1_p1.enderecoKey);
    const movs = await page.evaluate(() => Object.values(window.__data.movimentos_estoque.PA001));
    assert.equal(movs.length >= 1, true);
    assert.equal(movs.some((m) => m.motivo === 'DESMEMBRAMENTO DE PALETE' && m.qtd === 127 && m.autor === 'Carlos Logística'), true);
    // A grade se redesenhou: os dois paletes aparecem e cada um ainda pode ser dividido de novo se couber.
    assert.equal(await page.locator('[data-palete]').count(), antes + 1, 'a grade ganhou o palete novo');
    assert.match(await page.locator('#paletes').innerText(), /7 cx × 24/);
    assert.match(await page.locator('#paletes').innerText(), /5 cx × 24 \+ 1 parcial · 7 un/);

    // ── 4. Celular continua cabendo com o modal aberto ───────────────────
    await page.setViewportSize({width: 390, height: 844});
    await page.click('[data-desmembrar="PA001/pa_op1_p1"]');
    await page.locator('#dmLinhas').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.click('#dmFechar');
    assert.equal(await page.locator('#dmLinhas').count(), 0, 'Cancelar fecha sem gravar');
    assert.deepEqual(errors, [], 'erros de página: ' + errors.join(' | '));
    console.log('run_desmembrar_palete_ui_test: OK');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
