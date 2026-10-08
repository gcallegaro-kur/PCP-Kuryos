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
    // ── Pedidos (PCP) ──
    const {page, errors} = await abrir(browser, estado(), 'pedidos.html');
    const linha = (txt) => page.locator('#tableBody tr', {hasText: txt});
    await linha('SORVETE 120ML').first().waitFor({timeout: 10000});
    assert.match(await linha('BODY SPLASH SORVETE').innerText(), /Pronto para encerrar/, '95% é aviso');
    assert.doesNotMatch(await linha('BODY SPLASH SORVETE').innerText(), /✓ Concluído/);
    assert.match(await linha('PERFUME X').innerText(), /Em andamento/);
    // Clicar no aviso abre o encerramento.
    await linha('BODY SPLASH SORVETE').locator('[data-action="encerrar"]').click();
    await page.waitForSelector('#encPedDlg');
    const dlg = await page.locator('#encPedDlg').innerText();
    assert.match(dlg, /Encerrar pedido #05/);
    assert.match(dlg, /Todas as 2 linhas abertas do pedido #05/, 'a já encerrada não conta');
    await page.check('input[name="encEscopo"][value="todas"]');
    await page.click('#encConfirmar'); // sem motivo
    await page.waitForFunction(() => /Escolha o motivo/.test(document.getElementById('encErro').innerText));
    assert.equal(await page.evaluate(() => window.__db.pedidos['05__FBBS0002'].statusManual), undefined);
    await page.selectOption('#encMotivo', 'CLIENTE_ACEITOU_MENOS');
    await page.fill('#encTexto', 'Febella aceitou o entregue');
    await page.click('#encConfirmar');
    await page.waitForFunction(() => window.__db.pedidos['05__FBHD0002'].statusManual === 'encerrado', null, {timeout: 8000});
    const p1 = await page.evaluate(() => window.__db.pedidos);
    for (const k of ['05__FBBS0002', '05__FBHD0002']) {
      assert.equal(p1[k].statusManual, 'encerrado');
      assert.equal(p1[k].encerramento.motivo, 'Cliente aceitou receber menos');
      assert.equal(p1[k].encerramento.por, 'Gustavo');
      assert.equal(p1[k].encerramento.origem, 'PCP');
    }
    assert.equal(p1['05__FBBS0002'].encerramento.saldoNaoProduzido, 451);
    assert.equal(p1['05__FBBS0003'].encerramento, undefined, 'a que já estava encerrada fica como estava');
    assert.equal(p1['07__X1'].statusManual, undefined, 'outro pedido intacto');
    await page.waitForSelector('#encPedDlg', {state: 'detached'});

    // Editar e salvar não reabre (antes, "Automático" reabria em silêncio).
    await page.selectOption('#filterStatus', '');
    await linha('HIDRATANTE SORVETE').locator('[data-action="edit"]').click();
    await page.waitForSelector('#modalBg.open');
    assert.equal(await page.locator('#fStatusManual').isDisabled(), true);
    assert.match(await page.locator('#fStatusHint').innerText(), /Encerrado por Gustavo \(PCP\).*Cliente aceitou receber menos/);
    assert.equal(await page.locator('#btnReabrir').isVisible(), true);
    await page.fill('#fPriority', '5');
    await page.click('#btnSalvar');
    await page.waitForFunction(() => window.__db.pedidos['05__FBHD0002'].priority === 5, null, {timeout: 8000});
    assert.equal(await page.evaluate(() => window.__db.pedidos['05__FBHD0002'].statusManual), 'encerrado', 'salvar não reabre');
    assert.ok(await page.evaluate(() => window.__db.pedidos['05__FBHD0002'].encerramento), 'salvar preserva o encerramento');

    // Reabrir com motivo.
    await page.waitForSelector('#modalBg.open', {state: 'hidden'}).catch(() => {});
    await linha('HIDRATANTE SORVETE').locator('[data-action="edit"]').click();
    await page.waitForSelector('#modalBg.open');
    await page.click('#btnReabrir');
    await page.waitForSelector('#encPedDlg');
    await page.click('#encConfirmar');
    await page.waitForFunction(() => /motivo da reabertura/i.test(document.getElementById('encErro').innerText));
    await page.fill('#encTexto', 'cliente pediu o saldo');
    await page.click('#encConfirmar');
    await page.waitForFunction(() => !window.__db.pedidos['05__FBHD0002'].statusManual, null, {timeout: 8000});
    const h = Object.values(await page.evaluate(() => window.__db.pedidos['05__FBHD0002'].encerramentoHistorico));
    assert.deepEqual(h.map((x) => x.acao).sort(), ['ENCERRADO', 'REABERTO']);
    assert.match(await linha('HIDRATANTE SORVETE').innerText(), /Pronto para encerrar/, 'reaberta volta a ser aviso');
    assert.deepEqual(errors, [], 'erros em Pedidos: ' + errors.join(' | '));
    await page.close();

    // ── Comercial ──
    const est2 = estado();
    est2.usuarios.u1 = {nome: 'Diego', email: 'g@kuryos.com', role: 'gestor', modulos: {comercial: true}};
    const c = await abrir(browser, est2, 'comercial.html');
    await c.page.evaluate(() => { const b = [...document.querySelectorAll('.tabs button')].find((x) => /Documentos|aditivo|cancel/i.test(x.textContent)); if (b) b.click(); });
    await c.page.waitForFunction(() => document.querySelectorAll('#dPedido option').length > 1, null, {timeout: 10000});
    await c.page.selectOption('#dPedido', '05');
    await c.page.click('#encerrarPed');
    await c.page.waitForSelector('#encPedDlg');
    assert.match(await c.page.locator('#encPedDlg').innerText(), /2 linhas do pedido #05/);
    await c.page.selectOption('#encMotivo', 'ATENDIDO_TOLERANCIA');
    await c.page.click('#encConfirmar');
    await c.page.waitForFunction(() => window.__db.pedidos['05__FBBS0002'].statusManual === 'encerrado' && window.__db.pedidos['05__FBHD0002'].statusManual === 'encerrado', null, {timeout: 8000});
    const pc = await c.page.evaluate(() => window.__db);
    assert.equal(pc.pedidos['05__FBBS0002'].encerramento.origem, 'COMERCIAL');
    assert.equal(pc.pedidos['05__FBBS0002'].encerramento.por, 'Diego');
    const ev = Object.values(pc.comercial_eventos['05'] || {});
    assert.ok(ev.some((e) => e.tipo === 'ENCERRAMENTO' && /FBBS0002/.test(e.texto)), 'linha do tempo do Comercial registra');
    assert.deepEqual(c.errors.filter((e) => !/favicon/.test(e)), [], 'erros no Comercial: ' + c.errors.join(' | '));
    console.log('OK encerramento de pedido: 95% vira aviso; PCP encerra o pedido inteiro com motivo, salvar não reabre, reabrir com motivo; Comercial encerra e registra na linha do tempo.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
