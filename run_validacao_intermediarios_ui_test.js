'use strict';
/* Validação da Qualidade dos frascos rotulados (material_processo.html) e o estoque de
   intermediários na Consulta de Estoque. Tela real, Firebase simulado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados(role) {
  const agora = new Date().toISOString();
  return {
    usuarios: {u1: {nome: 'Quali', email: 'q@kuryos.com', role: role}},
    config: {linhas: ['Linha 1']},
    ops: {
      // rotulagem 1000, envasou 300, 20 frascos perdidos no envase: 680 rotulados esperando o envase
      'OP-R1': {lote: 'R/01', sku: 'SKU-Y', produto: 'BODY Y', cliente: 'WIKE', status: 'Em Produção', produzidoRotulagem: 1000, produzidoLinha: 300, qtdPlanejada: 1000, abertaDesde: agora, abertaDesdeRot: agora,
        manipulacao: {status: 'LIBERADO', manipulacao: {rendimento: 100}}, pesoTeoricoUnG: 100},
      'OP-B2': {lote: 'B/02', sku: 'SKU-X', produto: 'BODY X', cliente: 'MISS ROSE', status: 'Programado', qtdPlanejada: 500, pesoTeoricoUnG: 100, manipulacao: {status: 'AGUARDANDO_QUALIDADE', manipulacao: {rendimento: 40}}}
    },
    produtos: {}, materiais: {}, estoque: {}, estoque_lotes: {}, bom: {}, formulas: {}, bombonas_bulk: {}, material_processo: {},
    perdas: {'OP-R1': {p1: {perdas: [{tipo: 'Frascos', quantidade: 20, etapa: 'envase'}]}}},
    qualidade_intermediarios: {}
  };
}

async function abrir(browser, pagina, role) {
  const atraso = 0;
  const page = await browser.newPage({viewport: {width: 1600, height: 1100}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(({data, atraso}) => {
    window.__atrasoLogin = atraso;
    const db = data;
    window.__db = db;
    window.__iniciado = false;
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    window.__ouvintes = [];
    const notificar = () => window.__ouvintes.forEach((o) => o.cb(o.snap()));
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
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), window.__atrasoLogin || 0); },
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
            on(ev, cb) { window.__ouvintes.push({cb, snap}); setTimeout(() => cb(snap()), 0); return cb; },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
            startAt(k) { return ref(path, k); },
            push(v) { seq++; const filho = ref(path + '/-T' + seq); if (v !== undefined) { gravar(filho.path, v); notificar(); } const pr = Promise.resolve(filho); pr.key = filho.key; pr.path = filho.path; return pr; },
            set(v) { gravar(path, v); notificar(); return Promise.resolve(); },
            update(obj) { Object.entries(obj).forEach(([k, v]) => gravar(path + '/' + k, v)); notificar(); return Promise.resolve(); },
            remove() { gravar(path, null); return Promise.resolve(); },
            transaction(fn) { const r = fn(valor()); if (r !== undefined) { gravar(path, r); notificar(); } return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        };
        return {ref: (p) => ref(p || '')};
      }
    };
  }, {data: dados(role), atraso: atraso});
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
    // Operação só vê: a validação é da Qualidade
    let r = await abrir(browser, 'material_processo.html?aba=sobras', 'production');
    await r.page.waitForSelector('#cardValidacao:not([hidden])', {timeout: 8000});
    let txt = await r.page.locator('#cardValidacao').innerText();
    assert.match(txt, /R\/01/);
    assert.match(txt, /680 un/);
    assert.match(txt, /Aguardando Qualidade/);
    assert.match(txt, /só a Qualidade valida/);
    assert.equal(await r.page.locator('#cardValidacao [data-v]').count(), 0);
    assert.deepEqual(r.errors, [], 'erros: ' + r.errors.join(' | '));
    await r.page.close();

    // A Qualidade libera
    r = await abrir(browser, 'material_processo.html?aba=sobras', 'qualidade');
    await r.page.waitForSelector('#cardValidacao [data-v="LIBERADO"]', {timeout: 8000});
    await r.page.locator('#cardValidacao [data-v="LIBERADO"]').click();
    await r.page.waitForFunction(() => window.__db.qualidade_intermediarios && window.__db.qualidade_intermediarios['OP-R1']);
    const v = await r.page.evaluate(() => window.__db.qualidade_intermediarios['OP-R1']);
    assert.equal(v.status, 'LIBERADO');
    assert.equal(v.qtd, 680);
    assert.equal(v.por, 'Quali', 'quem validou fica registrado');
    assert.deepEqual(r.errors, [], 'erros: ' + r.errors.join(' | '));
    await r.page.close();

    // O PCP vê na Consulta: liberado x aguardando
    const dadosPcp = async () => {
      const pg = await abrir(browser, 'consulta_estoque.html?aba=inter', 'pcp');
      return pg;
    };
    r = await dadosPcp();
    await r.page.waitForFunction(() => /Frascos rotulados aguardando/.test(document.getElementById('estInter').innerText), null, {timeout: 8000});
    let ei = await r.page.locator('#estInter').innerText();
    assert.match(ei, /Bulk liberado/);
    assert.match(ei, /BODY Y/);
    assert.match(ei, /680 un/, 'frascos rotulados da OP R/01, ainda aguardando a Qualidade nesta carga');
    assert.match(ei, /BODY X/);
    assert.match(ei, /40,0 kg|40 kg/, 'bulk da B/02 ainda sem liberação');
    assert.deepEqual(r.errors, [], 'erros: ' + r.errors.join(' | '));
    await r.page.close();
  } finally {
    await browser.close();
  }
  console.log('OK Intermediários: Qualidade valida frascos rotulados, a operação só vê, e o PCP consulta liberado x aguardando.');
})().catch((e) => { console.error(e); process.exit(1); });
