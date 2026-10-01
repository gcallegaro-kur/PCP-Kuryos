'use strict';
/* Painel de Turno (form.html) com a tela real: o botão "Mudar de linha / trocar OPs"
   aparece para admin e PCP nos cards de linha com OP alocada, mesmo com o login
   chegando DEPOIS dos dados (corrida de carregamento). Firebase simulado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados(role) {
  const h = (horas) => new Date(Date.now() - horas * 3600000).toISOString();
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: role}},
    config: {linhas: ['Linha 1', 'Linha 2', 'Linha 3', 'Linha 4'], rotulagem: ['Rotulagem 01'], postosTrabalho: ['Celofane']},
    estado_linhas: {Linha_2: {status: 'parada', setor: 'linha', inicioParada: h(2), motivoParada: 'Falta de Material', lote: '26258/05'}},
    ops: {
      'OP-A': {lote: '26258/05', produto: 'BODY SPLASH', status: 'Produção Parcial', qtdPlanejada: 2820, produzidoLinha: 900, abertaDesde: h(5), abertaLinha: 'Linha 2', setupInicio: h(6), setupFim: h(5.5)},
      'OP-B': {lote: '26251/16', produto: 'PERFUME', status: 'Aguardando Confirmação', qtdPlanejada: 1400, abertaDesde: h(90), abertaLinha: 'Linha 3'}
    },
    pedidos: {}, produtos: {}, registros: {}, programacao: {}, turnosIniciados: {}, turnosEncerrados: {}, atividadesPosto: {}, paradas_historico: {}
  };
}

async function abrirPagina(browser, role, atraso, pagina) {
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
  }, {data: dados(role), atraso: atraso});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'tr.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://tr.test/form.html');
  await page.waitForSelector('.kt-sidebar', {timeout: 8000});
  return {page, errors};
}


(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    for (const [role, esperado] of [['admin', 1], ['pcp', 1], ['production', 0], ['qualidade', 0]]) {
      for (const atraso of [0, 1500]) {
        const {page, errors} = await abrirPagina(browser, role, atraso);
        await page.waitForFunction(() => window.currentUser && window.currentUser.role, null, {timeout: 10000});
        await page.waitForTimeout(atraso ? 2500 : 800);
        const n = await page.locator('[data-rearranjar-lote]').count();
        if (process.env.DEBUG_PAINEL) console.log(JSON.stringify(await page.evaluate(() => ({role: window.currentUser && window.currentUser.role, cards: document.querySelectorAll('#turnoGridLinhas .andon-card').length, html: document.getElementById('turnoGridLinhas').innerText.slice(0, 700), visivel: !!document.getElementById('turnoGridLinhas').offsetParent, ops: Object.keys(opsCache || {})}))));
        assert.equal(n, esperado, role + ' (login ' + atraso + ' ms depois): botões = ' + n + ' erros: ' + errors.join(' | '));
        if (esperado) {
          assert.match(await page.locator('[data-rearranjar-lote]').first().innerText(), /Mudar de linha/);
          assert.equal(await page.locator('[data-rearranjar-lote]').first().getAttribute('data-rearranjar-origem'), 'Linha 2');
        }
        // Linhas sem OP alocada não têm o que mover: sem botão (só "+ Alocar OP").
        // Qualidade nem abre o Painel de Turno (vai para a própria tela): sem painel, sem botão.
        if (role !== 'qualidade') assert.ok((await page.locator('#turnoGridLinhas .andon-card').count()) >= 4, role + ': cards do painel');
        await page.close();
      }
    }
    console.log('OK Painel de Turno: botão de rearranjo para admin e PCP, mesmo com login tardio; produção e qualidade não veem.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
