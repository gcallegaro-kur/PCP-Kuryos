'use strict';
/* Compras: botão "Encerrar saldo" no PC recebido em parte (caso PC-0038) e
   "Ajustar quantidade" no PC enviado sem recebimento. Tela de verdade,
   Firebase simulado com estado (transaction incluída). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const dados = (papel, modulos) => ({
  usuarios: {u1: Object.assign({nome: 'Gustavo', email: 'g@kuryos.com', role: papel}, modulos ? {modulos} : {})},
  pedidos_compra: {
    pc38: {numero: 38, numeroFormatado: 'PC-0038', status: 'RECEBIDO_PARCIAL', fornecedorNome: 'D. A. BRASIL', dataCriacao: '2026-10-07T16:40:40Z',
      valorTotalEstimado: 30000, recebimentos: {REC1: {data: '2026-10-09'}},
      itens: {i1: {materialCodigo: 'MPGR-00127', materialNome: 'ÁLCOOL 96°GL', unidade: 'kg', qtd: 6000, qtdCotada: 6000, qtdEmUnidadeEstoque: 6000,
        qtdRecebida: 5000, precoUnit: 5, custoTotalNaDecisao: 30000}}},
    pc40: {numero: 40, numeroFormatado: 'PC-0040', status: 'ENVIADO', fornecedorNome: 'EMBALAGENS SA', dataCriacao: '2026-10-08T10:00:00Z',
      valorTotalEstimado: 1000,
      itens: {a: {materialCodigo: 'EP-1', materialNome: 'FRASCO', unidade: 'un', qtd: 1000, qtdCotada: 1000, qtdEmUnidadeEstoque: 1000, qtdRecebida: 0, precoUnit: 1, custoTotalNaDecisao: 1000}}}
  }
});

async function abrir(browser, papel, modulos) {
  const page = await browser.newPage({viewport: {width: 1600, height: 1100}});
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript((inicial) => {
    const db = JSON.parse(JSON.stringify(inicial));
    window.__db = db; window.__iniciado = false;
    const exige = (q) => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
    const get = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const set = (p, v) => {
      const ks = p.split('/').filter(Boolean); let o = db;
      ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
      if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
    };
    const ouvintes = [];
    const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
    const avisa = () => ouvintes.forEach((o) => setTimeout(() => o.cb({val: () => clone(get(o.p)), exists: () => get(o.p) !== undefined, forEach() {}}), 0));
    let seq = 0;
    window.firebase = {
      initializeApp() { window.__iniciado = true; },
      auth() { exige('auth'); return {currentUser: {uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'},
        onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), 0); }, signOut() { return Promise.resolve(); }}; },
      storage() { return {ref() { return {}; }}; },
      functions() { return {httpsCallable() { return () => Promise.resolve({data: {}}); }}; },
      database() {
        exige('database');
        return {ref(p) {
          p = p || '';
          const snap = () => ({val: () => clone(p ? get(p) : db), exists: () => get(p) !== undefined, forEach() {}});
          return {path: p,
            once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); },
            on(ev, cb) { ouvintes.push({p, cb}); setTimeout(() => cb(snap()), 0); return cb; }, off() {}, child() { return this; },
            orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
            set(v) { set(p, v); avisa(); return Promise.resolve(); },
            update(u) { Object.keys(u).forEach((k) => set((p ? p + '/' : '') + k, u[k])); avisa(); return Promise.resolve(); },
            remove() { set(p, null); avisa(); return Promise.resolve(); },
            push(v) { const k = 'k' + (++seq); const r = Object.assign(Promise.resolve(), {key: k}); if (v !== undefined) set(p + '/' + k, v); return r; },
            transaction(fn) {
              const atual = clone(get(p));
              const r = fn(atual);
              if (r === undefined) return Promise.resolve({committed: false, snapshot: snap()});
              set(p, r); avisa(); return Promise.resolve({committed: true, snapshot: snap()});
            }};
        }};
      }
    };
  }, dados(papel, modulos));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'c.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://c.test/compras.html?tab=pedidos');
  return {page, erros};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // Admin: os dois botões aparecem; o PC-0038 é encerrado com o que chegou.
    {
      const {page, erros} = await abrir(browser, 'admin');
      await page.waitForSelector('.tab[data-tab="pedidos"]', {timeout: 10000});
      await page.click('.tab[data-tab="pedidos"]');
      await page.waitForSelector('.pc-ajustar', {state: 'visible', timeout: 10000});
      const rotulos = await page.locator('.pc-ajustar').allInnerTexts();
      assert.ok(rotulos.some((t) => /Encerrar saldo/.test(t)), 'PC recebido em parte: Encerrar saldo');
      assert.ok(rotulos.some((t) => /Ajustar quantidade/.test(t)), 'PC enviado sem recebimento: Ajustar quantidade');

      await page.locator('tr', {hasText: 'PC-0038'}).locator('.pc-ajustar').click();
      await page.waitForSelector('#modalAjustarPC.open');
      assert.match(await page.locator('#pcAjTitulo').innerText(), /Encerrar saldo — PC-0038/);
      assert.match(await page.locator('#pcAjItens').innerText(), /6\.000.*5\.000.*−1\.000/s);
      // Sem motivo: não grava.
      await page.click('#pcAjConfirmar');
      assert.equal(await page.evaluate(() => window.__db.pedidos_compra.pc38.status), 'RECEBIDO_PARCIAL');
      await page.fill('#pcAjMotivo', 'Fornecedor só tinha 5.000 L; ajustado por telefone em 07/10.');
      await page.click('#pcAjConfirmar');
      await page.waitForFunction(() => window.__db.pedidos_compra.pc38.status === 'RECEBIDO_TOTAL', null, {timeout: 8000});
      const pc = await page.evaluate(() => window.__db.pedidos_compra.pc38);
      assert.equal(pc.itens.i1.qtd, 5000); assert.equal(pc.itens.i1.qtdOriginal, 6000); assert.equal(pc.itens.i1.qtdRecebida, 5000);
      assert.equal(pc.valorTotalEstimado, 25000);
      assert.equal(pc.ajustes.AJ001.tipo, 'ENCERRAR_SALDO'); assert.equal(pc.ajustes.AJ001.por, 'Gustavo');
      await page.waitForFunction(() => !document.querySelector('tr') || ![...document.querySelectorAll('tr')].some((tr) => /PC-0038/.test(tr.innerText) && tr.querySelector('.pc-ajustar')), null, {timeout: 8000});
      assert.match(await page.locator('tr', {hasText: 'PC-0038'}).first().innerText(), /Revisão 1 · saldo encerrado/);

      // Ajustar a quantidade do PC-0040 (enviado, nada recebido).
      await page.locator('tr', {hasText: 'PC-0040'}).locator('.pc-ajustar').click();
      await page.waitForSelector('#modalAjustarPC.open');
      assert.match(await page.locator('#pcAjTitulo').innerText(), /Ajustar quantidade — PC-0040/);
      await page.fill('.pc-aj-qtd', '700');
      await page.fill('#pcAjMotivo', 'Cliente reduziu o pedido em 300 un.');
      await page.click('#pcAjConfirmar');
      await page.waitForFunction(() => window.__db.pedidos_compra.pc40.revisao === 1, null, {timeout: 8000});
      const pc40 = await page.evaluate(() => window.__db.pedidos_compra.pc40);
      assert.equal(pc40.status, 'ENVIADO'); assert.equal(pc40.itens.a.qtd, 700); assert.equal(pc40.itens.a.custoTotalNaDecisao, 700);
      assert.equal(pc40.ajustes.AJ001.itens.a.qtdAntes, 1000);
      assert.deepEqual(erros, [], 'sem erro de página: ' + erros.join(' | '));
      await page.close();
    }
    // O Compras (papel qualquer com o módulo `compras`) também ajusta; antes só o admin.
    {
      const {page, erros} = await abrir(browser, 'gestor', {compras: true});
      await page.waitForSelector('.tab[data-tab="pedidos"]', {timeout: 10000});
      await page.click('.tab[data-tab="pedidos"]');
      await page.waitForSelector('.pc-ajustar', {state: 'visible', timeout: 10000});
      assert.equal(await page.locator('.pc-ajustar').count(), 2, 'Compras vê Encerrar saldo e Ajustar quantidade');
      await page.locator('tr', {hasText: 'PC-0038'}).locator('.pc-ajustar').click();
      await page.fill('#pcAjMotivo', 'Fornecedor só tinha 5.000; combinado com o comercial.');
      await page.click('#pcAjConfirmar');
      await page.waitForFunction(() => window.__db.pedidos_compra.pc38.status === 'RECEBIDO_TOTAL', null, {timeout: 8000});
      assert.equal(await page.evaluate(() => window.__db.pedidos_compra.pc38.ajustes.AJ001.por), 'Gustavo');
      assert.deepEqual(erros, [], 'sem erro de página: ' + erros.join(' | '));
      await page.close();
    }
  } finally { await browser.close(); }
  console.log('OK Compras: encerrar saldo do PC recebido em parte (PC-0038) e ajustar quantidade antes de receber, para o Compras e o administrador.');
})().catch((e) => { console.error(e); process.exit(1); });
