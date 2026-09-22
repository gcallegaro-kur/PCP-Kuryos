'use strict';
/* Abrir uma OP de retrabalho a partir do Controle de OPs.

   Correção de rumo do usuário (22/09): retrabalho é uma OP, alocável em
   linha, rotulagem ou posto. O que este teste prova, na tela real:
   - a OP nasce com o número {lote}-RT1 e some do caminho da produção nova
     (sem pedido, sem BOM);
   - dá para mandar para um POSTO, não só para linha;
   - o segundo retrabalho do mesmo lote vira -RT2;
   - OP de retrabalho não oferece abrir retrabalho de si mesma. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'adm@kuryos.com', role: 'admin'}},
    config: {linhas: ['Linha 1', 'Linha 2'], rotulagem: ['Rotulagem 1'],
      postosTrabalho: ['Bancada 1', 'Bancada 2']},
    produtos: {}, pedidos_comerciais: {}, enderecos_estoque: {}, pedidos: {},
    paradas_historico: {}, registros: {},
    ops: {
      '26216-04': {lote: '26216/04', sku: 'PRF-TAWUS-30', produto: 'PERFUME TAWUS 30ML',
        cliente: 'DAPOP', status: 'Concluído', qtdPlanejada: 900, produzidoLinha: 867,
        produzido: 867, skuPedidoKey: '0017__PRF', validade: '2028-08-01',
        dataEmissao: '2026-08-01T10:00:00.000Z', emitidoPor: 'Gustavo',
        materiaisConsumo: {a: {mpCodigo: 'EP-01', quantidade: 900, origem: 'bom'}}},
    },
  };
}

async function abrir(browser) {
  const page = await browser.newPage({viewport: {width: 1500, height: 1000}});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(({data}) => {
    const db = data;
    window.__db = db;
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const gravar = (p, v) => {
      const ks = partes(p); let o = db;
      ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
      if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = structuredClone(v);
    };
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); },
      auth() {
        return {currentUser: {uid: 'u1', email: 'adm@kuryos.com'},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'adm@kuryos.com', displayName: 'Gustavo'}), 0); },
          signOut() { return Promise.resolve(); }};
      },
      database() {
        const ref = (path) => {
          const valor = () => { const v = ler(path); return v === undefined ? null : structuredClone(v); };
          const snap = () => { const v = valor(); return {val: () => v, exists: () => v !== null, key: partes(path).pop(),
            forEach(cb) { Object.entries(v || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
          return {path, key: partes(path).pop(),
            once(ev, cb) { const sn = snap(); if (cb) cb(sn); return Promise.resolve(sn); },
            on(ev, cb) { setTimeout(() => cb(snap()), 0); return cb; },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, limitToLast() { return this; },
            set(v) { gravar(path, v); return Promise.resolve(); },
            update(obj) { Object.entries(obj).forEach(([k, v]) => gravar(path + '/' + k, v)); return Promise.resolve(); },
            remove() { gravar(path, null); return Promise.resolve(); },
            transaction(fn) { const r = fn(valor()); if (r !== undefined) gravar(path, r);
              return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        };
        return {ref: (p) => ref(p || '')};
      },
    };
  }, {data: dados()});
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'ops.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://ops.test/ops.html');
  await page.waitForFunction(() => window.currentUser && window.currentUser.role === 'admin');
  /* O Controle de OPs esconde Concluído/Cancelado por padrão, de
     propósito (ver o comentário na tela). Quem vai abrir um retrabalho
     chega pelo filtro de status ou pela busca do lote. */
  await page.selectOption('#opsFiltroStatus', 'Concluído');
  await page.waitForSelector('[onclick^="abrirRetrabalhoModal"]', {timeout: 8000});
  return {page, errors};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser);

    // ── 1. O botão só existe em OP que não é retrabalho ────────────────
    assert.equal(await page.locator('[onclick^="abrirRetrabalhoModal"]').count(), 1);

    await page.click('[onclick^="abrirRetrabalhoModal"]');
    await page.waitForSelector('#rtNovoBg.open');
    const info = await page.locator('#rtNovoInfo').innerText();
    assert.match(info, /PERFUME TAWUS 30ML/);
    assert.match(info, /867 un\. produzidas/);
    assert.match(info, /26216\/04-RT1/, 'a tela mostra o número que vai sair');
    assert.equal(await page.locator('#rtNovoQtd').inputValue(), '867',
      'sugere retrabalhar o que foi produzido');
    if (process.env.RTOP_SCREENSHOT) await page.screenshot({path: process.env.RTOP_SCREENSHOT, fullPage: true});

    // ── 2. Motivo é obrigatório ────────────────────────────────────────
    await page.click('#rtNovoConfirmar');
    assert.match(await page.locator('#rtNovoErro').innerText(), /motivo/i);
    assert.equal(await page.evaluate(() => Object.keys(window.__db.ops).length), 1, 'nada gravado');

    // ── 3. Destino posto: os recursos mudam com o tipo ─────────────────
    await page.selectOption('#rtNovoDestinoTipo', 'posto');
    assert.deepEqual(
      await page.locator('#rtNovoDestinoNome option').allTextContents(), ['Bancada 1', 'Bancada 2'],
      'posto lista os postos cadastrados, não as linhas');
    await page.selectOption('#rtNovoDestinoTipo', 'rotulagem');
    assert.deepEqual(await page.locator('#rtNovoDestinoNome option').allTextContents(), ['Rotulagem 1']);
    await page.selectOption('#rtNovoDestinoTipo', 'posto');
    await page.selectOption('#rtNovoDestinoNome', 'Bancada 2');

    await page.fill('#rtNovoMotivo', 'Sedimentação do corante, formando precipitado.');
    await page.fill('#rtNovoQtd', '867');
    await page.click('#rtNovoConfirmar');
    await page.waitForFunction(() => window.__db.ops['26216-04-RT1']);

    const rt = await page.evaluate(() => window.__db.ops['26216-04-RT1']);
    assert.equal(rt.lote, '26216/04-RT1');
    assert.equal(rt.tipoOrdem, 'RETRABALHO');
    assert.equal(rt.retrabalhoDe, '26216/04');
    assert.equal(rt.retrabalhoDestino, 'posto');
    assert.equal(rt.linha, 'Bancada 2', 'o posto vai no mesmo campo que o Painel de Turno lê');
    assert.equal(rt.qtdPlanejada, 867);
    assert.equal(rt.produto, 'PERFUME TAWUS 30ML');
    assert.equal(rt.cliente, 'DAPOP');
    assert.equal(rt.status, 'Não Iniciado');
    // As duas ausências que impedem contar produção duas vezes.
    assert.equal(rt.skuPedidoKey, '', 'não credita pedido');
    assert.deepEqual(rt.materiaisConsumo, {}, 'não baixa BOM');
    // A OP original fica intacta.
    const orig = await page.evaluate(() => window.__db.ops['26216-04']);
    assert.equal(orig.produzidoLinha, 867);
    assert.equal(orig.status, 'Concluído');
    assert.equal(orig.skuPedidoKey, '0017__PRF');

    // ── 4. Segundo retrabalho do mesmo lote vira -RT2 ──────────────────
    await page.evaluate(() => { opsGlobal = window.__db.ops; recalculateAndRenderOps(); });
    await page.click('[onclick^="abrirRetrabalhoModal(\'26216-04\')"]');
    await page.waitForSelector('#rtNovoBg.open');
    assert.match(await page.locator('#rtNovoInfo').innerText(), /26216\/04-RT2/);
    assert.match(await page.locator('#rtNovoInfo').innerText(), /já tem 1 retrabalho/);

    // ── 5. OP de retrabalho não abre retrabalho de si mesma ────────────
    assert.equal(await page.locator('[onclick^="abrirRetrabalhoModal(\'26216-04-RT1\')"]').count(), 0);

    assert.deepEqual(errors, [], 'erros de página: ' + errors.join(' | '));
    console.log('run_retrabalho_op_ui_test: OK — OP de retrabalho aberta num posto, sem pedido e sem BOM.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
