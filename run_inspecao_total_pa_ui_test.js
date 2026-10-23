'use strict';
/* Inspeção total de PA: a tela real (Firebase simulado e com estado):
   designar -> registrar resultado por motivo -> decidir (parcial, 2 motivos). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const pal = (n) => ({itemTipo: 'produto', itemCodigo: 'SKU1', itemNome: 'BODY SPLASH X', unidade: 'un', opKey: '26280-01', opLote: '26280/01', loteOrigem: '26280/01',
  paleteNumero: n, identificadorPalete: 'PA-26280-01-P' + n, caixasFechadas: n === 1 ? 60 : 30, unidadesCaixaParcial: 0, unidadesPorCaixa: 24,
  saldoLote: n === 1 ? 1440 : 720, status: 'INSPECAO_TOTAL', origemTipo: 'conferencia_pa', enderecoCodigo: 'A-0' + n});
const dados = {
  usuarios: {u1: {nome: 'Ana', email: 'a@k.com', role: 'admin'}, u2: {nome: 'Luana', email: 'l@k.com', role: 'production'}},
  config: {linhas: ['Linha 1', 'Linha 2']},
  nao_conformidades: {},
  estoque_lotes: {SKU1: {pa_1: pal(1), pa_2: pal(2)}},
  ops: {'26280-01': {lote: '26280/01', sku: 'SKU1', produto: 'BODY SPLASH X', cliente: 'CLI', status: 'Concluído', produzidoLinha: 2160,
    inspecaoTotal: {estado: 'AGUARDANDO_DESIGNACAO', sinalizacao: {por: 'Qua', em: '2026-10-23T10:00:00.000Z', motivo: 'Frascos vazando', saldoLote: 2160, qtdPaletes: 2}}}}
};

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1500, height: 1200}});
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.addInitScript((d) => {
      const db = d, ouvintes = [];
      const get = (p) => p.split('/').filter(Boolean).reduce((x, k) => (x == null ? undefined : x[k]), db);
      const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
      const put = (p, v) => {
        const ks = p.split('/').filter(Boolean); let o = db;
        ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
        if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = clone(v);
      };
      let seq = 0;
      const avisar = () => setTimeout(() => ouvintes.forEach((l) => l.cb({val: () => clone(get(l.p)), exists: () => get(l.p) !== undefined, forEach() {}})), 0);
      const ref = (p, filtro) => {
        p = p || '';
        const snap = () => { let v = clone(p ? get(p) : db); if (filtro && v) v = Object.fromEntries(Object.entries(v).filter(([k]) => k >= filtro.de && k <= filtro.ate)); return {val: () => v, exists: () => v != null, forEach() {}}; };
        return {path: p, update() { return Promise.resolve(); },
          once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); },
          on(ev, cb) { ouvintes.push({p, cb}); setTimeout(() => cb(snap()), 0); return cb; }, off() {}, child() { return this; },
          set(v) { put(p, v); avisar(); return Promise.resolve(); },
          remove() { put(p, null); avisar(); return Promise.resolve(); },
          push() { return Object.assign(Promise.resolve(), {key: 'k' + (++seq)}); },
          transaction(fn) {
            const atual = clone(get(p)); const r = fn(atual);
            if (r === undefined) return Promise.resolve({committed: false});
            put(p, r); avisar(); return Promise.resolve({committed: true, snapshot: {val: () => clone(get(p))}});
          },
          orderByKey() { return {startAt: (de) => ({endAt: (ate) => ref(p, {de, ate: ate.replace('', '￿')})})}; }, orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; }};
      };
      const raiz = ref('');
      raiz.update = function(u) { Object.keys(u || {}).forEach((k) => put(k, u[k])); avisar(); return Promise.resolve(); };
      window.__db = db;
      window.firebase = {
        initializeApp() {},
        auth() { return {currentUser: {uid: 'u1', email: 'a@k.com'}, onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'a@k.com', displayName: 'Ana'}), 0); }, signOut() { return Promise.resolve(); }}; },
        storage() { return {ref() { return {}; }}; },
        database() { return {ref(p) { return p ? ref(p) : raiz; }}; }
      };
    }, dados);
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'd.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + url.pathname.slice(1);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    await page.goto('https://d.test/inspecao_total.html');
    await page.waitForSelector('#tbDesig [data-acao=designar]', {timeout: 10000});
    assert.match(await page.locator('#tbDesig').innerText(), /26280\/01[\s\S]*2\.160[\s\S]*Frascos vazando/);
    assert.equal((await page.locator('#kpis .kpi b').allInnerTexts())[0], '1');

    // 1) Designar
    await page.click('#tbDesig [data-acao=designar]');
    await page.fill('#dResp', ''); await page.click('#dOk');
    assert.match(await page.locator('#dErro').innerText(), /Escolha quem/);
    await page.fill('#dResp', 'Luana'); await page.fill('#dPrazo', '8'); await page.click('#dOk');
    await page.waitForSelector('#tbInsp [data-acao=resultado]', {timeout: 5000});
    assert.match(await page.locator('#tbInsp').innerText(), /Luana[\s\S]*faltam 7h|faltam 8h/);
    assert.equal(await page.evaluate(() => window.__db.ops['26280-01'].inspecaoTotal.estado), 'EM_INSPECAO');

    // 2) Resultado: inspeção parcial exige justificativa; depois completa com dois motivos
    await page.click('#tbInsp [data-acao=resultado]');
    await page.waitForSelector('#rPaletes .pal');
    const pals = page.locator('#rPaletes .pal');
    await pals.nth(0).locator('[data-add]').click(); await pals.nth(0).locator('[data-add]').click();
    await pals.nth(0).locator('.r-mot').nth(0).fill('Tampa solta'); await pals.nth(0).locator('.r-qtd').nth(0).fill('40');
    await pals.nth(0).locator('.r-mot').nth(1).fill('Rótulo torto'); await pals.nth(0).locator('.r-qtd').nth(1).fill('20');
    await pals.nth(1).locator('[data-add]').click();
    await pals.nth(1).locator('.r-mot').nth(0).fill('tampa solta'); await pals.nth(1).locator('.r-qtd').nth(0).fill('5');
    await pals.nth(1).locator('.r-insp').fill('700');
    assert.equal(await page.locator('#rJustBox').isVisible(), true, 'pede justificativa quando há unidade sem inspeção');
    await page.click('#rOk');
    assert.match(await page.locator('#rErro').innerText(), /inspeção é TOTAL/);
    await pals.nth(1).locator('.r-insp').fill('720');
    await page.click('#rOk');
    await page.waitForSelector('#tbDec [data-acao=decidir]', {timeout: 5000});
    assert.match(await page.locator('#tbDec').innerText(), /2\.160[\s\S]*65[\s\S]*Tampa solta \(45\)[\s\S]*Rótulo torto \(20\)/);

    // 3) Decidir: reprovar 42 de "tampa solta" (posto) e 20 de "rótulo torto"
    await page.click('#tbDec [data-acao=decidir]');
    await page.waitForSelector('#decLinhas tr[data-k]');
    assert.match(await page.locator('#decResumo').innerText(), /2\.095 un liberadas.*65 un reprovadas.*2 OP/);
    await page.locator('#decLinhas tr[data-k=tampa_solta] .d-rep').fill('42');
    await page.locator('#decLinhas tr[data-k=tampa_solta] .d-tipo').selectOption('posto');
    await page.locator('#decLinhas tr[data-k=tampa_solta] .d-nome').fill('Posto 1');
    assert.match(await page.locator('#decResumo').innerText(), /2\.098 un liberadas.*62 un reprovadas.*2 OP/);
    await page.fill('#decObs', 'Tampa: 3 aceitas');
    await page.click('#decOk');
    await page.waitForFunction(() => /Nada decidido|26280\/01-RT1/.test(document.querySelector('#tbFim').innerText) && /RT1/.test(document.querySelector('#tbFim').innerText), null, {timeout: 8000});
    const fim = await page.locator('#tbFim').innerText();
    assert.match(fim, /26280\/01[\s\S]*2\.098[\s\S]*62[\s\S]*26280\/01-RT1[\s\S]*Tampa solta \(42\)[\s\S]*26280\/01-RT2[\s\S]*Rótulo torto \(20\)/);

    const est = await page.evaluate(() => ({e: window.__db.estoque_lotes.SKU1, ops: window.__db.ops, nc: window.__db.nao_conformidades}));
    assert.equal(est.e.pa_1.status, 'LIBERADO_EXPEDICAO'); assert.equal(est.e.pa_1.saldoLote, 1380); assert.equal(est.e.pa_2.saldoLote, 718);
    assert.equal(est.ops['26280-01-RT1'].qtdPlanejada, 42); assert.equal(est.ops['26280-01-RT1'].linha, 'Posto 1'); assert.equal(est.ops['26280-01-RT2'].qtdPlanejada, 20);
    assert.equal(est.ops['26280-01'].qualidadePA.decisao, 'LIBERADO_EXPEDICAO');
    assert.equal(Object.keys(est.nc).length >= 1, true, 'RNC aberta');
    assert.equal((await page.locator('#kpis .kpi b').allInnerTexts()).join(','), '0,0,0,0');
    assert.deepEqual(erros, [], 'sem erro de página: ' + erros.join(' | '));
  } finally { await browser.close(); }
  console.log('OK Inspeção total de PA: designar, resultado por motivo, decisão parcial com 2 OPs de retrabalho e liberação do restante.');
})().catch((e) => { console.error(e); process.exit(1); });
