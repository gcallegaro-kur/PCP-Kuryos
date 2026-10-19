'use strict';
/* Lista suspensa única (19/10/2026, shared/lista-suspensa.js): o <datalist>
   da Entrada avulsa de PA vira a lista do sistema -- busca sem acento e por
   palavras, código em destaque, teclado, escolha preenche e dispara
   input/change. E o attachAutocomplete antigo delega para ela. Firebase
   simulado (o de run_propriedade_estoque_ui_test.js). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    'usuarios/u1': {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'},
    config: {}, clientes: {}, pedidos: {}, pedidos_comerciais: {}, expedicoes_comerciais: {}, devolucoes_cliente: {}, estoque_lotes: {},
    produtos: {
      AMABBS01: {sku: 'AMABBS01', descricao: 'BODY MIST TESOURO DO OASIS'},
      AMABBS02: {sku: 'AMABBS02', descricao: 'BODY MIST JARDINS DO ORIENTE'},
      AMABBS03: {sku: 'AMABBS03', descricao: 'BODY MIST FLOR DO DESERTO'},
      AMABBS04: {sku: 'AMABBS04', descricao: 'BODY MIST PÉROLA DO DESERTO'},
      'HDR-MISS-0002': {sku: 'HDR-MISS-0002', descricao: 'HIDRATANTE LEÃO DO DESERTO BOURBON 200g'}
    },
    enderecos_estoque: {A1: {codigo: 'GAL-1.1.1', area: 'GALPAO', ativo: true, rua: 1, nivel: 1, predio: 1}},
    materiais: {}
  };
}

async function abrir(browser, pagina, host) {
  const context = await browser.newContext({viewport: {width: 1500, height: 1100}, timezoneId: 'America/Sao_Paulo'});
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
        return {onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), 0); },
          signOut() { return Promise.resolve(); }, currentUser: {email: 'g@kuryos.com'}};
      },
      functions() { return {httpsCallable: callable}; },
      app() { return {functions: () => ({httpsCallable: callable})}; },
      database() {
        exige('database');
        // Caminho aninhado resolve a partir do nó carregado mais próximo (estoque/VAL-1 dentro de estoque).
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
            // Como o SDK: a promessa resolve com uma referência comum (não "thenable",
            // senão Promise.all ficaria resolvendo a própria referência para sempre).
            child(p) { return ref(path + '/' + p); }, push(v) { const caminho = path + '/k' + Math.random().toString(36).slice(2, 8); if (v !== undefined) window.__writes.push({op: 'push', path, v}); return Object.assign(ref(caminho), {then: (a, b) => Promise.resolve(ref(caminho)).then(a, b)}); },
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
  }, {data: dados()});
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== host) return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://' + host + '/' + pagina);
  await page.waitForFunction(() => window.KtListaSuspensa, null, {timeout: 8000});
  await page.waitForTimeout(400);
  return {page, errors, context};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const d = await abrir(browser, 'devolucoes.html', 'dev.test');
    const p = d.page;
    await p.evaluate(() => { document.getElementById('tabAvulsa').hidden = false; document.getElementById('tabAvulsa').click(); });
    await p.waitForFunction(() => document.querySelectorAll('#vProdutos option').length === 5);
    const campo = p.locator('#vProduto');
    assert.equal(await campo.getAttribute('list'), null, 'o datalist nativo saiu do campo');
    assert.equal(await campo.getAttribute('data-kt-lista'), 'vProdutos');
    await campo.click();
    const lista = p.locator('.kt-ac-list.open');
    await lista.waitFor();
    assert.equal(await lista.locator('.kt-ac-item').count(), 5);
    assert.equal(await lista.locator('.kt-ac-item').first().locator('.kt-ac-cod').innerText(), 'AMABBS01', 'código em destaque');
    // Busca sem acento e por palavras, em qualquer ordem.
    await campo.fill('deserto perola');
    assert.deepEqual(await lista.locator('.kt-ac-cod').allInnerTexts(), ['AMABBS04']);
    assert.match(await lista.locator('mark').first().innerText(), /PÉROLA|DESERTO/);
    await campo.fill('deserto');
    assert.deepEqual(await lista.locator('.kt-ac-cod').allInnerTexts(), ['AMABBS03', 'AMABBS04', 'HDR-MISS-0002']);
    if (process.env.LS_SHOT) await p.screenshot({path: process.env.LS_SHOT, clip: {x: 0, y: 0, width: 1500, height: 700}});
    if (process.env.LS_SHOT) { await campo.press('Escape'); await p.click('#vMotivoTipo'); await p.waitForTimeout(300); await p.screenshot({path: process.env.LS_SHOT.replace('.png', '_select.png'), clip: {x: 0, y: 0, width: 1500, height: 800}}); await p.keyboard.press('Escape'); await campo.fill('deserto'); }
    // Teclado: ↓ ↓ Enter escolhe o segundo; a tela recebe input e change.
    await p.evaluate(() => { window.__ev = []; const c = document.getElementById('vProduto'); ['input', 'change'].forEach((t) => c.addEventListener(t, () => window.__ev.push(t))); });
    await campo.press('ArrowDown'); await campo.press('ArrowDown'); await campo.press('Enter');
    assert.equal(await campo.inputValue(), 'AMABBS04 — BODY MIST PÉROLA DO DESERTO');
    assert.deepEqual(await p.evaluate(() => window.__ev), ['input', 'change']);
    assert.equal(await p.locator('.kt-ac-list.open').count(), 0, 'fechou ao escolher');
    // Nada encontrado: aviso, não lista vazia.
    await campo.fill('xyzw');
    assert.match(await p.locator('.kt-ac-list.open .kt-ac-vazio').innerText(), /Nada encontrado/);
    await campo.press('Escape');
    // Datalist desenhado depois também é convertido.
    await p.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<input id="novo" list="vProdutos">'));
    await p.waitForFunction(() => !document.getElementById('novo').hasAttribute('list') && document.getElementById('novo').classList.contains('kt-ac-input'));
    // attachAutocomplete (utils.js) delega para a lista nova.
    await p.evaluate(() => { const i = document.createElement('input'); i.id = 'velho'; document.body.appendChild(i); attachAutocomplete(i, () => [{value: 'A', label: 'A — Alfa'}, 'Beta']); });
    await p.click('#velho');
    assert.deepEqual(await p.locator('.kt-ac-list.open .kt-ac-item').allInnerTexts(), ['A\nAlfa', 'Beta']);
    assert.deepEqual(d.errors, []);
    console.log('OK Lista suspensa: datalist convertido, busca sem acento por palavras, código em destaque, teclado, input/change, campo novo e attachAutocomplete.');
    await d.context.close();
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
