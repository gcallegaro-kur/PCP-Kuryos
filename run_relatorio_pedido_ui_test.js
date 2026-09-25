'use strict';
/* Relatório de Pedido, tela de verdade (2026-09-25): relatorio_pedido.html com
   Firebase simulado.
   - abre direto pelo link ?pedido=; seletor lista por número exato;
   - cabeçalho com totais; tabela por item; clique abre os lotes;
   - perdas por tipo no item e no lote; CSV baixa com uma linha por lote;
   - impressão mostra todos os lotes; menu tem o link para PCP e Comercial;
   - celular sem rolagem horizontal da página. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {base} = require('./run_relatorio_pedido_fixture.js');

function dados(role) {
  return Object.assign({'usuarios/u1': {nome: 'PCP', email: 'p@kuryos.com', role: role || 'pcp'}, config: {}}, base());
}

async function abrir(browser, viewport, url, role) {
  const context = await browser.newContext({viewport: viewport || {width: 1400, height: 1000}, timezoneId: 'America/Sao_Paulo'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(({data}) => {
    window.__writes = [];
    window.__iniciado = false;
    const exige = (q) => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
    const callable = () => () => Promise.resolve({data: {}});
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() {
        exige('auth');
        return {onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'p@kuryos.com', displayName: 'PCP'}), 0); },
          signOut() { return Promise.resolve(); }, currentUser: {email: 'p@kuryos.com'}};
      },
      functions() { return {httpsCallable: callable}; },
      app() { return {functions: () => ({httpsCallable: callable})}; },
      database() {
        exige('database');
        const valor = (path) => {
          if (path in data) return data[path];
          const partes = String(path || '').split('/');
          for (let i = partes.length - 1; i > 0; i--) {
            const base = partes.slice(0, i).join('/');
            if (base in data) return partes.slice(i).reduce((o, k) => (o == null ? undefined : o[k]), data[base]);
          }
          return undefined;
        };
        const ref = (path) => {
          const snap = {val: () => (valor(path) === undefined ? null : structuredClone(valor(path))), exists: () => valor(path) !== undefined, key: String(path).split('/').pop()};
          return {path, key: 'k' + Math.random().toString(36).slice(2, 8),
            once(ev, cb) { if (cb) cb(snap); return Promise.resolve(snap); },
            on(ev, cb) { setTimeout(() => cb(snap), 0); return cb; }, off() {},
            child(p) { return ref(path + '/' + p); },
            push(v) { const caminho = path + '/k' + Math.random().toString(36).slice(2, 8); if (v !== undefined) window.__writes.push({op: 'push', path, v}); return Object.assign(ref(caminho), {then: (a, b) => Promise.resolve(ref(caminho)).then(a, b)}); },
            orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
            set(v) { window.__writes.push({op: 'set', path, v}); return Promise.resolve(); },
            update(v) { window.__writes.push({op: 'update', path: path || '/', v}); return Promise.resolve(); },
            remove() { return Promise.resolve(); },
            transaction(fn) {
              const antes = valor(path) === undefined ? null : structuredClone(valor(path));
              const v = fn(antes);
              window.__writes.push({op: 'transaction', path, v: v === undefined ? null : structuredClone(v)});
              return Promise.resolve({committed: v !== undefined, snapshot: {val: () => v, exists: () => v != null}});
            }};
        };
        return {ref, ServerValue: {TIMESTAMP: 0}};
      }
    };
  }, {data: dados(role)});
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'rel.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://rel.test/' + (url || 'relatorio_pedido.html'));
  await page.waitForFunction(() => window.RelatorioPedido && document.getElementById('sTxt').textContent === 'Atualizado', null, {timeout: 8000});
  return {page, errors, context};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'}).catch(() => chromium.launch({headless: true, channel: 'msedge'}));
  let n = 0;
  const ok = (nome) => { n++; console.log('ok -', nome); };
  {
    const {page: p, errors, context} = await abrir(browser, null, 'relatorio_pedido.html?pedido=0008');
    assert.equal(await p.inputValue('#selPedido'), '0008');
    const cab = await p.locator('#relatorio .card').first().innerText();
    assert.match(cab, /Pedido 0008 · MISS ROSE/);
    assert.match(cab, /Nº do cliente: PO-77/);
    assert.match(cab, /18\.000\s+PEDIDO/i);
    assert.match(cab, /16\.700\s+PRODUZIDO\s+92,8% do pedido/i);
    assert.match(cab, /12\.200\s+EXPEDIDO/i);
    assert.match(cab, /3\.200\s+EM ESTOQUE/i);
    ok('link direto abre o pedido com os totais');

    const itens = await p.locator('tr.item').allInnerTexts();
    assert.equal(itens.length, 3);
    assert.match(itens[0], /MRARBS06[\s\S]*Produção Parcial[\s\S]*10\.000[\s\S]*9\.000[\s\S]*90%[\s\S]*1\.000[\s\S]*4\.800[\s\S]*3\.200[\s\S]*2[\s\S]*Frascos: 24[\s\S]*Rótulos: 5[\s\S]*Válvula: 2/);
    assert.match(itens[1], /MRARBS07[\s\S]*Devolvido \(estorno\): -100[\s\S]*Cartuchos: 16/);
    assert.match(itens[2], /MRARBS08[\s\S]*Encerrado[\s\S]*Rótulos \(envase\): 12/);
    assert.match(await p.locator('tr.total').innerText(), /Total do pedido[\s\S]*18\.000[\s\S]*16\.700/);
    ok('um item por linha: pedido, produzido, a produzir, expedido, estoque, lotes, perdas por tipo');

    assert.equal(await p.locator('tr[data-lotes="0"]').isVisible(), false);
    await p.click('tr.item[data-i="0"]');
    const lotes = await p.locator('tr[data-lotes="0"]').innerText();
    assert.match(lotes, /26146\/01[\s\S]*Concluído[\s\S]*Linha 02[\s\S]*10\/09\/2026[\s\S]*5\.000[\s\S]*5\.000[\s\S]*4\.800[\s\S]*200[\s\S]*Frascos: 24[\s\S]*0,6%/);
    assert.match(lotes, /26147\/01[\s\S]*3\.000/);
    assert.doesNotMatch(lotes, /26148\/01/, 'OP cancelada fora');
    assert.match(lotes, /Sem OP identificada[\s\S]*1\.000/);
    ok('clique no item abre os lotes com produzido, expedido, estoque e perdas');

    const [download] = await Promise.all([p.waitForEvent('download'), p.click('#btnCsv')]);
    assert.equal(download.suggestedFilename(), 'relatorio-pedido-0008.csv');
    const csv = fs.readFileSync(await download.path(), 'utf8');
    assert.equal(csv.charCodeAt(0), 0xfeff, 'BOM para o Excel abrir acentos');
    assert.equal(csv.trim().split('\r\n').length, 5);
    assert.match(csv, /26146\/01;Concluído;Linha 02;5000;5000;4800;200/);
    ok('CSV baixa com uma linha por lote');

    await p.emulateMedia({media: 'print'});
    assert.equal(await p.locator('tr[data-lotes="1"]').isVisible(), true, 'impressão abre todos os lotes');
    assert.equal(await p.locator('.toolbar').isVisible(), false);
    await p.emulateMedia({media: 'screen'});
    ok('impressão sai com todos os lotes e sem a barra de busca');

    await p.fill('#busca', 'febella');
    assert.deepEqual(await p.locator('#selPedido option').allInnerTexts(), ['Selecione o pedido (1)...', '05 · FEBELLA · 30/04/2026 · 1 item · 1 em aberto']);
    await p.selectOption('#selPedido', '05');
    assert.match(page_url(p), /\?pedido=05$/);
    assert.match(await p.locator('#relatorio').innerText(), /Pedido 05 · FEBELLA/);
    ok('busca e troca de pedido (link atualizado)');

    assert.equal(await p.locator('a[href="relatorio_pedido.html"]').count(), 1, 'PCP: um link só no menu');
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    const {page: p, errors, context} = await abrir(browser, {width: 375, height: 812}, 'relatorio_pedido.html?pedido=0008', 'pcp');
    await p.click('tr.item[data-i="0"]');
    const largura = await p.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(largura <= 376, 'scrollWidth ' + largura);
    ok('celular sem rolagem horizontal da página');
    assert.deepEqual(errors, []);
    await context.close();
  }
  await browser.close();
  console.log(`\n${n} testes ok`);
})().catch((e) => { console.error(e); process.exit(1); });

function page_url(p) { return p.url(); }
