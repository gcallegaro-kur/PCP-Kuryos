'use strict';
/* UI do painel de pendências de Produtos (08/10/2026), Cadastros,
   Firebase simulado em memória (o mesmo de run_espelho_cadastro_ui_test.js):
   contagem entre os ativos, clique filtra, clique de novo tira, combina com a
   busca e com Ativos/Inativos, atualiza ao vivo. */
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
      }
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
    clientes: {MISS: {nome: 'MISS RÔSE', codigo: 'MISS', ativo: true}},
    produtos: {
      'PA-1': {sku: 'PA-1', descricao: 'PRODUTO APROVADO', cliente: 'MISS RÔSE', ativo: 'Ativo', categoria: 'CORPORAL'},
      'PB-2': {sku: 'PB-2', descricao: 'PRODUTO RASCUNHO', cliente: 'MISS RÔSE', ativo: 'Ativo', categoria: 'CORPORAL'},
      'PC-3': {sku: 'PC-3', descricao: 'PRODUTO SEM NADA', cliente: 'MISS RÔSE', ativo: 'Ativo', categoria: 'PERFUMARIA'},
      'PD-4': {sku: 'PD-4', descricao: 'PRODUTO INATIVO', cliente: 'MISS RÔSE', ativo: 'Inativo', categoria: 'PERFUMARIA'}
    },
    formulas: {
      'PA-1__v1': {codProduto: 'PA-1', versao: 'v1', status: 'APROVADA', itens: {i: {}}},
      'PB-2__v1': {codProduto: 'PB-2', versao: 'v1', status: 'RASCUNHO', itens: {i: {}}}
    },
    bom: {'PA-1__v1': {codProduto: 'PA-1', versao: 'v1', status: 'APROVADA', itens: {i: {}}}},
    especificacoes: {
      'PA-1__v1': {codProduto: 'PA-1', versao: 'v1', status: 'APROVADA', itens: {e: {}}},
      'PB-2__v1': {codProduto: 'PB-2', versao: 'v1', status: 'APROVADA', itens: {e: {}}}
    },
    materiais: {}, fornecedores: {}, categorias: {}, config: {}, estoque: {}, solicitacoes_cadastro_produto: {}
  };
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser, estado(), 'cadastros.html?tab=produtos');
    await page.waitForFunction(() => document.getElementById('statPendFormula-prod').textContent === '2', null, {timeout: 10000});
    const txt = (id) => page.locator('#' + id).innerText();
    assert.equal(await txt('statPendFormula-prod'), '2');
    assert.equal(await txt('statPendFormulaSub-prod'), '1 sem cadastro · 1 a aprovar');
    assert.equal(await txt('statPendBom-prod'), '2');
    assert.equal(await txt('statPendEspec-prod'), '1');
    const linhas = async () => (await page.locator('#tableBody-prod tr .sku-cell').allInnerTexts()).sort();
    assert.deepEqual(await linhas(), ['PA-1', 'PB-2', 'PC-3', 'PD-4']);

    await page.click('[data-dash-prod="formula"]');
    await page.waitForFunction(() => document.querySelectorAll('#tableBody-prod tr .sku-cell').length === 2);
    assert.deepEqual(await linhas(), ['PB-2', 'PC-3']);
    assert.equal(await page.getAttribute('[data-dash-prod="formula"]', 'aria-pressed'), 'true');
    assert.match(await page.locator('#tableBody-prod tr', {hasText: 'PB-2'}).innerText(), /Fórmula: a aprovar/);
    assert.match(await page.locator('#tableBody-prod tr', {hasText: 'PC-3'}).innerText(), /Fórmula: sem cadastro/);
    assert.match(await txt('filtroPend-prod'), /fórmula pendente/);

    await page.click('[data-dash-prod="espec"]');
    await page.waitForFunction(() => document.querySelectorAll('#tableBody-prod tr .sku-cell').length === 1);
    assert.deepEqual(await linhas(), ['PC-3'], 'inativo não entra');
    // Busca combina com o filtro do painel.
    await page.fill('#searchInput-prod', 'aprovado');
    await page.waitForFunction(() => /Nenhum produto/.test(document.getElementById('tableBody-prod').innerText));
    await page.fill('#searchInput-prod', '');
    // Clicar de novo tira o filtro.
    await page.click('[data-dash-prod="espec"]');
    await page.waitForFunction(() => document.querySelectorAll('#tableBody-prod tr .sku-cell').length === 4);
    assert.equal(await page.locator('#filtroPend-prod').isVisible(), false);
    // Ativos / Inativos também filtram.
    await page.click('[data-dash-prod="Inativo"]');
    await page.waitForFunction(() => document.querySelectorAll('#tableBody-prod tr .sku-cell').length === 1);
    assert.equal(await page.inputValue('#filterAtivo-prod'), 'Inativo');
    await page.click('[data-dash-prod="bom"]');
    await page.waitForFunction(() => document.querySelectorAll('#tableBody-prod tr .sku-cell').length === 2);
    assert.equal(await page.inputValue('#filterAtivo-prod'), '', 'pendência sempre entre os ativos');
    await page.click('#limparPend-prod');
    await page.waitForFunction(() => document.querySelectorAll('#tableBody-prod tr .sku-cell').length === 4);
    // Ao vivo: aprovar a fórmula do PB-2 atualiza o painel.
    await page.evaluate(() => { window.__db.formulas['PB-2__v1'].status = 'APROVADA'; });
    await page.evaluate(() => firebase.database().ref('formulas/PB-2__v1/status').set('APROVADA'));
    await page.waitForFunction(() => document.getElementById('statPendFormula-prod').textContent === '1');
    if (process.env.ETQ_SHOTS) await page.locator('.stats-pend').screenshot({path: process.env.ETQ_SHOTS + '/dash-prod.png'});
    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    console.log('OK Cadastros › Produtos: painel de Fórmula/BOM/Especificação pendentes (ativos), clicável, filtra, combina com a busca e atualiza ao vivo.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
