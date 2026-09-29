'use strict';
/* Controle de OPs: a barra principal mostra PRODUTO ACABADO (estoque +
   expedido) e o hover lista cada etapa. Tela real, Firebase simulado. */
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
        skuPedidoKey: '14__MRARBS04', status: 'Em Produção', linha: 'Linha 1', qtdPlanejada: 4320, produzidoLinha: 3696, produzido: 3696, produzidoRotulagem: 4320},
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
    const {page, errors} = await abrir(browser, 'ops.html');
    const barra = page.locator('tr', {hasText: '26257/17'}).locator('div[title*="Produto acabado"]').first();
    await barra.waitFor({timeout: 8000});
    // Só 1.500 un de PA conferido (palete com saldo): rotulagem completa não enche a barra.
    await page.waitForFunction(() => /1\.500 \/ 4\.320 un/.test(document.querySelector('tr div[title*="Produto acabado"]').innerText), null, {timeout: 8000});
    const linha = page.locator('tr', {hasText: '26257/17'});
    const texto = await linha.locator('div[title*="Produto acabado"]').first().innerText();
    assert.match(texto, /1\.500 \/ 4\.320 un/);
    assert.match(texto, /35%/);
    assert.ok(!/Rotulagem/i.test(texto.replace(/PRODUTO ACABADO/i, '')), 'a barra não mostra mais rotulagem: ' + texto);
    const dica = await barra.getAttribute('title');
    assert.match(dica, /Envase: 3\.696 \/ 4\.320 un \(86%\)/);
    assert.match(dica, /Rotulagem: 4\.320 \/ 4\.320 un \(100%\)/);
    assert.match(dica, /Produto acabado \(conferido\): 1\.500 \/ 4\.320 un \(35%\)/);
    assert.match(dica, /Expedido: 0 \/ 4\.320 un/);
    if (process.env.PROG_SCREENSHOT) await page.screenshot({path: process.env.PROG_SCREENSHOT});
    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    console.log('OK Controle de OPs: barra de produto acabado + hover por etapa.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
