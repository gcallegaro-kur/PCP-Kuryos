'use strict';
/* Transferência de OP entre pedidos (ops.html) e as proteções da tela de
   Pedidos (salvar sem apagar campos, quantidade no pedido comercial, excluir
   item com OP). Telas reais com utils.js e auth_check.js reais; o Firebase
   simulado guarda o banco em memória e aplica update/set/transaction, para o
   teste conferir o que a tela gravaria. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const HOJE = new Date();
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const AMANHA = new Date(HOJE.getTime() + 86400000);

function dados() {
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    config: {linhas: ['Linha 1', 'Linha 2']},
    ops: {
      '26257-17': {lote: '26257/17', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR DAS TAMARAS', cliente: 'MISS RÔSE',
        skuPedidoKey: '14__MRARBS04', status: 'Em Produção', linha: 'Linha 1', qtdPlanejada: 4320, produzidoLinha: 3696, produzido: 3696},
      '26257-18': {lote: '26257/18', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR DAS TAMARAS', cliente: 'MISS RÔSE',
        skuPedidoKey: '14__MRARBS04', status: 'Programado', qtdPlanejada: 4320}
    },
    pedidos: {
      '0014__MRARBS04': {id: '0014', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR DAS TAMARAS', cliente: 'MISS RÔSE', parentPedidoId: '0014',
        qtdTotal: 10000, produzido: 3696, status: 'Em Produção', priority: 20, mediaPorHora: 69431, dataPedido: '2026-08-01', valorUnitario: 3.2,
        apontamentosAplicados: {'-a1': {quantidade: 2000, lote: '26257/17'}, '-a2': {quantidade: 1696, lote: '26257/17'}}},
      '0040__MRARBS04': {id: '0040', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR DAS TAMARAS', cliente: 'MISS RÔSE', parentPedidoId: '0040',
        qtdTotal: 39158, produzido: 0, status: 'Não Iniciado', priority: 30},
      '0041__MRARBS01': {id: '0041', sku: 'MRARBS01', produto: 'BODY SPLASH AURORA IMPERIAL', cliente: 'MISS RÔSE', parentPedidoId: '0041', qtdTotal: 40000, produzido: 0}
    },
    pedidos_comerciais: {
      '0014': {cliente: 'MISS RÔSE', total_qtd: 70000, itens: [{sku: 'MRARBS01', qtd: 40000}, {sku: 'MRARBS02', qtd: 20000}, {sku: 'MRARBS04', qtd: 10000}]},
      '0040': {cliente: 'MISS RÔSE', total_qtd: 39158, itens: [{sku: 'MRARBS04', qtd: 39158}]},
      '0041': {cliente: 'MISS RÔSE', total_qtd: 40000, itens: [{sku: 'MRARBS01', qtd: 40000}]}
    },
    estoque_lotes: {MRARBS04: {
      pa_26257_17_p1: {itemTipo: 'produto', opKey: '26257-17', saldoLote: 1500, origemTipo: 'conferencia_pa', skuPedidoKey: '14__MRARBS04'},
      pa_26257_17_p2: {itemTipo: 'produto', opKey: '26257-17', saldoLote: 0, origemTipo: 'conferencia_pa', skuPedidoKey: '14__MRARBS04'}
    }},
    programacao: {
      [ymd(AMANHA)]: {'08_00': {env1: {pedidoKey: '14__MRARBS04', lote: '26257/17'}, env2: {pedidoKey: '14__MRARBS04', lote: '26257/18'}}}
    },
    alocacoes_planejamento: {a1: {pedidoKey: '0014__MRARBS04', qtdConsumida: 8640, status: 'vinculado',
      opsVinculadas: {'26257-17': {qtd: 4320}, '26257-18': {qtd: 4320}}}},
    expedicoes_comerciais: {}, conferencias_pa: {}, solicitacoes_descarte: {}, produtos: {}, enderecos_estoque: {}, paradas_historico: {}
  };
}

async function abrir(browser, pagina) {
  const page = await browser.newPage({viewport: {width: 1600, height: 1100}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(({data}) => {
    const db = data;
    window.__db = db;
    window.__iniciado = false;
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const gravar = (p, v) => {
      const ks = partes(p); let o = db;
      ks.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
      if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = structuredClone(v);
    };
    let seq = 0;
    const exige = q => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() {
        exige('auth');
        return {currentUser: {uid: 'u1', email: 'g@kuryos.com'},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), 0); },
          signOut() { return Promise.resolve(); }};
      },
      database() {
        exige('database');
        const ref = (path, filtro) => {
          const valor = () => {
            let v = ler(path);
            if (filtro && v && typeof v === 'object') v = Object.fromEntries(Object.entries(v).filter(([k]) => k >= filtro));
            return v === undefined ? null : structuredClone(v);
          };
          const snap = () => { const v = valor(); return {val: () => v, exists: () => v !== null, key: partes(path).pop(), forEach(cb) { Object.entries(v || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
          return {path, key: partes(path).pop(),
            once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); },
            on(ev, cb) { setTimeout(() => cb(snap()), 0); return cb; },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
            startAt(k) { return ref(path, k); },
            push() { seq++; return ref(path + '/-T' + seq); },
            set(v) { gravar(path, v); return Promise.resolve(); },
            update(obj) { Object.entries(obj).forEach(([k, v]) => gravar(path + '/' + k, v)); return Promise.resolve(); },
            remove() { gravar(path, null); return Promise.resolve(); },
            transaction(fn) { const r = fn(valor()); if (r !== undefined) gravar(path, r); return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        };
        return {ref: (p) => ref(p || '')};
      }
    };
  }, {data: dados()});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'tr.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://tr.test/' + pagina);
  await page.waitForSelector('.kt-sidebar', {timeout: 8000});
  return {page, errors};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // ── OPs: transferir 26257/17 do 0014 para o 0040 ───────────────────
    const {page, errors} = await abrir(browser, 'ops.html');
    const botao = page.locator('button[onclick="abrirTransferenciaOp(\'26257-17\')"]');
    await botao.waitFor({timeout: 8000});
    await page.waitForFunction(() => window.currentUser && window.currentUser.role === 'admin');
    await botao.click();
    await page.waitForSelector('#trOpDestino');
    const opcoes = await page.locator('#trOpDestino option').allTextContents();
    assert.equal(opcoes.length, 2, 'Selecione + só o pedido aberto do mesmo SKU: ' + opcoes.join(' | '));
    assert.match(opcoes[1], /#0040/);
    assert.equal(await page.locator('#trOpConfirmar').isDisabled(), true);

    await page.selectOption('#trOpDestino', '0040__MRARBS04');
    await page.waitForFunction(() => /Produção que vai junto/.test(document.getElementById('trOpResumo').innerText));
    const resumo = await page.locator('#trOpResumo').innerText();
    assert.match(resumo, /Produção que vai junto: 3\.696 un/);
    assert.match(resumo, /Paletes em estoque que mudam de pedido: 1 \(1\.500 un\)/);
    assert.match(resumo, /já saíram/);
    if (process.env.TRANSF_SCREENSHOT) await page.screenshot({path: process.env.TRANSF_SCREENSHOT});

    await page.click('#trOpConfirmar');
    assert.equal(await page.locator('#trOpErro').isVisible(), true, 'motivo obrigatório');
    await page.fill('#trOpMotivo', 'Conciliação com o cliente');
    await page.click('#trOpConfirmar');
    await page.waitForFunction(() => !document.getElementById('trOpResumo'), null, {timeout: 8000});

    const db = await page.evaluate(() => window.__db);
    const op = db.ops['26257-17'];
    assert.equal(op.skuPedidoKey, '0040__MRARBS04');
    assert.equal(op.parentPedidoId, '0040');
    const tr = Object.values(op.transferenciasPedido);
    assert.equal(tr.length, 1);
    assert.equal(tr[0].status, 'CONCLUIDA');
    assert.equal(tr[0].qtd, 3696);
    assert.equal(tr[0].origem, '0014__MRARBS04');
    assert.equal(tr[0].motivo, 'Conciliação com o cliente');
    assert.equal(db.pedidos['0014__MRARBS04'].produzido, 0);
    assert.deepEqual(db.pedidos['0014__MRARBS04'].apontamentosAplicados || {}, {});
    assert.equal(db.pedidos['0040__MRARBS04'].produzido, 3696);
    assert.deepEqual(Object.keys(db.pedidos['0040__MRARBS04'].apontamentosAplicados).sort(), ['-a1', '-a2']);
    assert.equal(db.estoque_lotes.MRARBS04.pa_26257_17_p1.skuPedidoKey, '0040__MRARBS04');
    assert.equal(db.estoque_lotes.MRARBS04.pa_26257_17_p2.skuPedidoKey, '14__MRARBS04', 'palete expedido fica');
    assert.equal(db.programacao[ymd(AMANHA)]['08_00'].env1.pedidoKey, '0040__MRARBS04');
    assert.equal(db.programacao[ymd(AMANHA)]['08_00'].env2.pedidoKey, '14__MRARBS04', 'outra OP não muda');
    assert.equal(db.alocacoes_planejamento.a1.qtdConsumida, 4320);
    assert.equal(db.alocacoes_planejamento.a1.opsVinculadas['26257-17'], undefined);
    assert.equal(db.ops['26257-18'].skuPedidoKey, '14__MRARBS04');
    assert.deepEqual(errors, [], 'erros em ops.html: ' + errors.join(' | '));
    await page.close();

    // ── OPs: retomada de transferência interrompida ────────────────────
    {
      const r = await abrir(browser, 'ops.html');
      await r.page.waitForFunction(() => window.currentUser && window.currentUser.role === 'admin');
      // Simula queda depois do passo 1: OP já no destino, pedidos intocados.
      await r.page.evaluate(() => {
        const o = window.__db.ops['26257-17'];
        o.skuPedidoKey = '0040__MRARBS04';
        o.transferenciasPedido = {'-X': {status: 'EM_ANDAMENTO', origem: '0014__MRARBS04', destino: '0040__MRARBS04', em: new Date().toISOString()}};
        window.opsGlobal = window.__db.ops;
      });
      await r.page.evaluate(() => { opsGlobal = structuredClone(window.__db.ops); abrirTransferenciaOp('26257-17'); });
      await r.page.waitForFunction(() => /não terminou/.test(document.body.innerText));
      await r.page.waitForFunction(() => /3\.696 un/.test((document.getElementById('trOpResumo') || {}).innerText || ''));
      await r.page.click('#trOpConfirmar');
      await r.page.waitForFunction(() => !document.getElementById('trOpResumo'), null, {timeout: 8000});
      const d2 = await r.page.evaluate(() => window.__db);
      assert.equal(d2.pedidos['0014__MRARBS04'].produzido, 0);
      assert.equal(d2.pedidos['0040__MRARBS04'].produzido, 3696);
      assert.equal(d2.ops['26257-17'].transferenciasPedido['-X'].status, 'CONCLUIDA');
      assert.deepEqual(r.errors, []);
      await r.page.close();
    }

    // ── Pedidos: excluir item com OP é bloqueado ───────────────────────
    {
      const p = await abrir(browser, 'pedidos.html');
      await p.page.waitForFunction(() => typeof conciliacaoFontes !== 'undefined' && conciliacaoFontes.ops !== null);
      await p.page.evaluate(() => openDelete('0014__MRARBS04'));
      assert.equal(await p.page.locator('#delModalBg.open').count(), 0, 'modal de exclusão não abre');
      assert.match(await p.page.locator('body').innerText(), /Este item tem OP \(26257\/17, 26257\/18\)/);
      await p.page.evaluate(() => openDelete('0041__MRARBS01'));
      assert.equal(await p.page.locator('#delModalBg.open').count(), 1, 'item sem OP pode ser excluído');
      await p.page.evaluate(() => closeDelModal());

      // ── Pedidos: salvar edição preserva campos e ajusta o comercial ────
      await p.page.waitForFunction(() => allPedidos && allPedidos['0014__MRARBS04']);
      await p.page.evaluate(() => openEdit('0014__MRARBS04'));
      await p.page.fill('#fQtdTotal', '12000');
      await p.page.click('#btnSalvar');
      await p.page.waitForFunction(() => window.__db.pedidos['0014__MRARBS04'].qtdTotal === 12000, null, {timeout: 8000});
      const d3 = await p.page.evaluate(() => window.__db);
      const ped = d3.pedidos['0014__MRARBS04'];
      assert.equal(Object.keys(ped.apontamentosAplicados).length, 2, 'apontamentosAplicados preservado');
      assert.equal(ped.mediaPorHora, 69431);
      assert.equal(ped.dataPedido, '2026-08-01');
      assert.equal(ped.valorUnitario, 3.2);
      assert.ok(ped.status, 'status não some ao salvar (a própria tela o recalcula)');
      assert.equal(ped.produzido, 3696);
      assert.equal(d3.pedidos_comerciais['0014'].itens[2].qtd, 12000);
      assert.equal(d3.pedidos_comerciais['0014'].total_qtd, 72000);
      assert.equal(d3.pedidos_comerciais['0014'].itens[0].qtd, 40000);
      assert.deepEqual(p.errors, [], 'erros em pedidos.html: ' + p.errors.join(' | '));
      await p.page.close();
    }

    console.log('OK Transferência de OP: resumo, gravação completa, retomada; Pedidos: exclusão bloqueada, edição preserva campos e ajusta o comercial.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
