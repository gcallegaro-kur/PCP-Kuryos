'use strict';
/* UI do encerramento de pedido (08/10/2026): tela Pedidos (PCP) e Comercial,
   com Firebase simulado em memória (o mesmo de run_espelho_cadastro_ui_test.js).
   - 95% produzido aparece como "Pronto para encerrar" (aviso), não Concluído;
   - encerrar o pedido inteiro pela linha, com motivo; reabrir com motivo;
   - o Salvar do formulário não reabre mais em silêncio;
   - Comercial encerra o pedido inteiro pelo botão "Encerrar pedido". */
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
      },
      storage() { return {ref() { return {put() { return Promise.resolve({ref: {getDownloadURL: () => Promise.resolve('')}}); }}; }}; }
    };
  }, estadoInicial);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'cad.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://cad.test/' + pagina);
  try {
    await page.waitForFunction(() => window.currentUser && window.currentUser.nome, null, {timeout: 12000});
  } catch (e) {
    console.log('DBG url', page.url(), 'erros', errors, await page.evaluate(() => [document.title, typeof window.currentUser, document.body.innerText.slice(0, 200)]));
    throw e;
  }
  return {page, errors};
}

function estado() {
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    pedidos: {
      '05__FBBS0002': {id: '05', parentPedidoId: '05', sku: 'FBBS0002', produto: 'BODY SPLASH SORVETE 120ML', cliente: 'FEBELLA BEAUTY', qtdTotal: 10000, produzido: 9549, status: 'Produção Parcial', priority: 71},
      '05__FBHD0002': {id: '05', parentPedidoId: '05', sku: 'FBHD0002', produto: 'HIDRATANTE SORVETE 120ML', cliente: 'FEBELLA BEAUTY', qtdTotal: 10000, produzido: 9900, status: 'Produção Parcial', priority: 72},
      '05__FBBS0003': {id: '05', parentPedidoId: '05', sku: 'FBBS0003', produto: 'BODY SPLASH AMBER 200ML', cliente: 'FEBELLA BEAUTY', qtdTotal: 10000, produzido: 9107, statusManual: 'encerrado'},
      '07__X1': {id: '07', parentPedidoId: '07', sku: 'X1', produto: 'PERFUME X', cliente: 'DAPOP', qtdTotal: 1000, produzido: 100, status: 'Em Produção', priority: 3}
    },
    pedidos_comerciais: {
      '05': {cliente: 'FEBELLA BEAUTY', dataPedido: '2026-04-30', status: 'LIBERADO_PCP', itens: [{sku: 'FBBS0002', qtd: 10000}, {sku: 'FBHD0002', qtd: 10000}, {sku: 'FBBS0003', qtd: 10000}]},
      '07': {cliente: 'DAPOP', dataPedido: '2026-08-01', status: 'LIBERADO_PCP', itens: [{sku: 'X1', qtd: 1000}]}
    },
    produtos: {}, ops: {}, programacao: {}, clientes: {}, config: {}, estoque_lotes: {}, comercial_eventos: {}
  };
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const est = estado();
    est.pedidos['07__CONC'] = {id: '07', parentPedidoId: '07', sku: 'CONC', produto: 'PERFUME CONCLUIDO COM SALDO', cliente: 'DAPOP', qtdTotal: 1000, produzido: 800, status: 'Concluído', priority: 4};
    est.pedidos['07__OK'] = {id: '07', parentPedidoId: '07', sku: 'OK', produto: 'PERFUME CONCLUIDO CHEIO', cliente: 'DAPOP', qtdTotal: 500, produzido: 500, status: 'Concluído', priority: 5};
    est.pedidos_comerciais['07'].itens.push({sku: 'CONC', qtd: 1000}, {sku: 'OK', qtd: 500});
    const {page, errors} = await abrir(browser, est, 'pedidos.html');
    await page.locator('#tableBody tr', {hasText: 'CONCLUIDO COM SALDO'}).first().waitFor({timeout: 10000});
    assert.equal(await page.locator('#tableBody tr', {hasText: 'CONCLUIDO CHEIO'}).count(), 0, 'concluída cheia não pede ação');
    await page.selectOption('#filterStatus', 'saldo');
    assert.equal(await page.locator('#tableBody tr', {hasText: 'CONCLUIDO COM SALDO'}).count(), 1);
    await page.selectOption('#filterStatus', '');
    const comSaldo = page.locator('#tableBody tr', {hasText: 'CONCLUIDO COM SALDO'});
    const cheio = page.locator('#tableBody tr', {hasText: 'CONCLUIDO CHEIO'});
    assert.equal(await cheio.locator('[data-action="reabrir-saldo"]').count(), 0, 'concluída de verdade não oferece reabrir');
    assert.equal(await comSaldo.locator('[data-action="delete"]').count(), 0, 'pedido comercial sem lixeira');
    await comSaldo.locator('[data-action="reabrir-saldo"]').click();
    await page.waitForSelector('#encPedDlg');
    assert.match(await page.locator('#encPedDlg').innerText(), /Reabrir saldo do pedido #07/);
    await page.click('#encConfirmar');
    await page.waitForFunction(() => /motivo da reabertura/i.test(document.getElementById('encErro').innerText));
    assert.equal(await page.evaluate(() => window.__db.pedidos['07__CONC'].status), 'Concluído', 'sem motivo nada grava');
    await page.fill('#encTexto', 'cliente quer receber o saldo');
    await page.click('#encConfirmar');
    await page.waitForFunction(() => window.__db.pedidos['07__CONC'].status === 'Produção Parcial', null, {timeout: 8000});
    const hist = await page.evaluate(() => Object.values(window.__db.pedidos['07__CONC'].encerramentoHistorico || {}));
    assert.equal(hist.length, 1); assert.equal(hist[0].acao, 'SALDO_REABERTO'); assert.equal(hist[0].saldo, 200);
    assert.equal(await page.evaluate(() => window.__db.pedidos['07__OK'].status), 'Concluído');
    await page.waitForFunction(() => !document.querySelector('#tableBody [data-key="07__CONC"][data-action="reabrir-saldo"]'));
    assert.deepEqual(errors, []);
    console.log('OK Pedidos (PCP): Reabrir saldo em linha Concluída com saldo, com motivo e histórico.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
