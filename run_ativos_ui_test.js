'use strict';
/* Manutenção › Ativos (19/10/2026): cadastro, código sugerido, padrões por
   tipo, duplicado barrado, filtros do painel, mudança de situação com motivo
   e histórico. Firebase simulado (o de run_propriedade_estoque_ui_test.js). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    'usuarios/u1': {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'},
    config: {linhas: ['Linha 1', 'Linha 2'], rotulagem: ['Rotulagem 01'], postos: ['Celofane']},
    ativos: {
      k1: {codigo: 'EV-01', nome: 'Envasadora pistão', tipo: 'ENVASADORA', area: 'ENVASE', linha: 'Linha 1', situacao: 'OPERACIONAL', exigeAssepsia: true, exigeCalibracao: false},
      k2: {codigo: 'BL-01', nome: 'Balança 30 kg', tipo: 'BALANCA', area: 'LABORATORIO', situacao: 'OPERACIONAL', exigeAssepsia: false, exigeCalibracao: true, calibracaoPeriodicidadeMeses: 12}
    }
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
  await page.waitForFunction(() => window.Ativos && document.querySelector('#lista table'), null, {timeout: 8000});
  await page.waitForTimeout(400);
  return {page, errors, context};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const r = await abrir(browser, 'ativos.html', 'at.test');
    const p = r.page;
    const linhas = () => p.locator('#lista tbody tr .cod').allInnerTexts();
    assert.deepEqual(await linhas(), ['BL-01', 'EV-01']);
    assert.match(await p.locator('#painel').innerText(), /2\s*EQUIPAMENTOS/i);
    assert.match(await p.locator('.kt-sidebar').innerText(), /MANUTENÇÃO[\s\S]*Ativos/i, 'grupo novo no menu');

    // Novo reator: código sugerido pela sigla, padrões do tipo.
    await p.click('#btnNovo');
    assert.equal(await p.inputValue('#aCodigo'), 'RT-01');
    assert.equal(await p.inputValue('#aArea'), 'MANIPULACAO');
    assert.equal(await p.isChecked('#aAsep'), true);
    await p.selectOption('#aTipo', 'ENVASADORA');
    assert.equal(await p.inputValue('#aCodigo'), 'EV-02', 'trocar o tipo troca a sugestão');
    assert.equal(await p.inputValue('#aArea'), 'ENVASE');
    await p.selectOption('#aTipo', 'REATOR');
    await p.fill('#aNome', 'Reator inox 500 kg');
    await p.fill('#aCap', '500');
    await p.click('#aSalvar');
    await p.waitForFunction(() => window.__writes.some((w) => w.op === 'set' && /^ativos\//.test(w.path)));
    const gravado = await p.evaluate(() => window.__writes.find((w) => w.op === 'set' && /^ativos\//.test(w.path)).v);
    assert.equal(gravado.codigo, 'RT-01');
    assert.equal(gravado.capacidade, 500);
    assert.equal(gravado.capacidadeUnidade, 'kg');
    assert.equal(gravado.exigeAssepsia, true);
    assert.equal(gravado.situacao, 'OPERACIONAL');
    assert.equal(gravado.criadoPor, 'Gustavo');

    // Código repetido (sem caixa) é barrado.
    await p.click('#btnNovo');
    await p.selectOption('#aTipo', 'ENVASADORA');
    await p.fill('#aCodigo', 'ev-01');
    await p.fill('#aNome', 'Outra');
    await p.click('#aSalvar');
    assert.match(await p.locator('#aErros').innerText(), /Já existe um equipamento com o código EV-01/);
    await p.click('#aCancelar');

    // Painel filtra: "Pedem calibração" só a balança.
    await p.click('[data-card="cal"]');
    assert.deepEqual(await linhas(), ['BL-01']);
    await p.click('[data-card="cal"]');
    await p.fill('#fBusca', 'pistao');
    assert.deepEqual(await linhas(), ['EV-01']);
    await p.fill('#fBusca', '');

    // Situação: parar exige motivo; grava situação + histórico num update só.
    await p.click('[data-situacao="k1"]');
    await p.click('#sSeg [data-s="EM_MANUTENCAO"]');
    await p.click('#sSalvar');
    assert.match(await p.locator('#sErro').innerText(), /motivo/);
    await p.fill('#sMotivo', 'Troca do bico dosador');
    await p.click('#sSalvar');
    await p.waitForFunction(() => window.__writes.some((w) => w.op === 'update' && w.v['ativos/k1/situacao']));
    const u = await p.evaluate(() => window.__writes.find((w) => w.op === 'update' && w.v['ativos/k1/situacao']).v);
    assert.equal(u['ativos/k1/situacao'], 'EM_MANUTENCAO');
    const hist = Object.keys(u).find((k) => k.startsWith('ativos_historico/k1/'));
    assert.deepEqual([u[hist].de, u[hist].para, u[hist].motivo], ['OPERACIONAL', 'EM_MANUTENCAO', 'Troca do bico dosador']);
    if (process.env.AT_SHOT) await p.screenshot({path: process.env.AT_SHOT, fullPage: true});
    assert.deepEqual(r.errors, [], 'erros: ' + r.errors.join(' | '));
    console.log('OK Ativos: cadastro com código sugerido e padrões do tipo, duplicado barrado, filtros do painel, situação com motivo e histórico, menu Manutenção.');
    await r.context.close();
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
