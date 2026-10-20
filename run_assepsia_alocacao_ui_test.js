'use strict';
/* Assepsia ANTES de alocar a OP (20/10/2026): portão do apontamento (form.html) e preparação da próxima OP na Liberação de linha. Firebase simulado ao vivo (o de run_pendencias_produto_ui_test.js). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

async function abrir(browser, estadoInicial, pagina) {
  const page = await browser.newPage({viewport: {width: 1500, height: 1100}});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { page.__dialogos = (page.__dialogos || []).concat(d.message()); d.accept(); });
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
    if (url.hostname !== 'aloc.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://aloc.test/' + pagina);
  try {
    await page.waitForFunction(() => window.currentUser && window.currentUser.nome, null, {timeout: 12000}).catch(() => {});
  } catch (e) {
    console.log('DBG url', page.url(), 'erros', errors, await page.evaluate(() => [document.title, typeof window.currentUser, document.body.innerText.slice(0, 200)]));
    throw e;
  }
  return {page, errors};
}


function estado(trava) {
  return {
    usuarios: {u1: {nome: 'Jessica', email: 'op@kuryos.com', role: 'admin'}},
    config: {linhas: ['Linha 1'], rotulagem: ['Rotulagem 01'], liberacaoLinha: {trava: trava, limiteLotes: 15}},
    ops: {
      '26290-01': {lote: '26290/01', sku: 'HDR-1', produto: 'HIDRATANTE A', status: 'Programado'},
      '26291-01': {lote: '26291/01', sku: 'HDR-2', produto: 'HIDRATANTE B', status: 'Programado'}
    },
    // Última assepsia hoje para o HDR-1: o mesmo SKU dispensa; outro SKU pede assepsia.
    assepsia_linhas: {LINHA_1: {linha: 'Linha 1', ultima: {em: new Date(Date.now() - 3600e3).toISOString(), sku: 'HDR-1'}, lotesDesde: 2}},
    liberacao_linha: {}, ativos: {}, registros: {}, estado_linhas: {}, pedidos: {}, produtos: {}
  };
}
(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // Trava LIGADA: outro SKU barra ao alocar; o mesmo SKU passa e grava a dispensa.
    let r = await abrir(browser, estado(true), 'form.html');
    let p = r.page;
    await p.waitForFunction(() => typeof bloquearSeAssepsiaPendente === 'function' && typeof LiberacaoLinha === 'object');
    await p.waitForTimeout(800);
    let barrou = await p.evaluate(() => bloquearSeAssepsiaPendente(findOpByLote('26291/01'), 'Linha 1', 'ser alocada'));
    assert.equal(barrou, true, 'troca de produto sem assepsia: barra com a trava');
    assert.match(p.__dialogos.join(' | '), /26291\/01 não pode ser alocada na Linha 1: a linha precisa de assepsia antes de receber esta OP \(Troca de produto/);
    let passou = await p.evaluate(() => bloquearSeAssepsiaPendente(findOpByLote('26290/01'), 'Linha 1', 'ser alocada'));
    assert.equal(passou, false, 'mesma fórmula no mesmo dia: passa');
    await p.waitForFunction(() => window.__db.liberacao_linha && window.__db.liberacao_linha['26290-01'] && window.__db.liberacao_linha['26290-01'].ck4);
    const disp = await p.evaluate(() => window.__db.liberacao_linha['26290-01']);
    assert.equal(disp.ck4.status, 'DISPENSADA');
    assert.match(disp.ck4.motivo, /2 de 15 lotes/);
    assert.equal(disp.linha, 'Linha 1');
    assert.equal(await p.evaluate(() => bloquearSeAssepsiaPendente(findOpByLote('26291/01'), 'Rotulagem 01', 'ser alocada')), false, 'rotulagem não pede assepsia de envase');
    // Assepsia aprovada para a OP: passa.
    await p.evaluate(() => firebase.database().ref('liberacao_linha/26291-01/ck4').set({id: 'x', status: 'APROVADO'}));
    assert.equal(await p.evaluate(() => bloquearSeAssepsiaPendente(findOpByLote('26291/01'), 'Linha 1', 'ser alocada')), false);
    assert.deepEqual(r.errors, [], 'erros (trava ligada): ' + r.errors.join(' | '));
    await p.close();

    // Trava DESLIGADA: só avisa (faixa de erro), não barra.
    r = await abrir(browser, estado(false), 'form.html');
    p = r.page;
    await p.waitForFunction(() => typeof bloquearSeAssepsiaPendente === 'function');
    await p.waitForTimeout(800);
    assert.equal(await p.evaluate(() => bloquearSeAssepsiaPendente(findOpByLote('26291/01'), 'Linha 1', 'ser alocada')), false);
    assert.equal((p.__dialogos || []).length, 0, 'sem alerta bloqueante');
    assert.match(await p.locator('#avisoLiberacao').innerText(), /Linha 1, lote 26291\/01: a linha precisa de assepsia/);
    // O aviso do fim de setup (first article) também aparece -- antes chamava um showAlert que esta tela não tem.
    await p.evaluate(() => bloquearSeLinhaNaoLiberada(findOpByLote('26290/01'), 'começar o envase', true));
    assert.match(await p.locator('#avisoLiberacao').innerText(), /lote 26290\/01: Falta o setup \/ first article|lote 26290\/01: Falta a assepsia/);
    assert.deepEqual(r.errors, [], 'erros (trava desligada): ' + r.errors.join(' | '));
    await p.close();

    // Tela de Liberação de linha: preparar a próxima OP antes de alocar.
    r = await abrir(browser, Object.assign(estado(false), {checklist_modelos: {}, inspecoes_cq: {}}), 'liberacao_linha.html');
    p = r.page;
    await p.waitForFunction(() => document.querySelectorAll('#fLinha option').length > 1);
    await p.selectOption('#fLinha', 'Linha 1');
    await p.waitForSelector('#fProxima');
    await p.fill('#fProxima', '26291/01 — HIDRATANTE B');
    await p.click('#bPreparar');
    await p.waitForFunction(() => /26291\/01/.test(document.getElementById('lista').innerText) && document.querySelector('.card.op'));
    assert.match(await p.locator('.card.op').first().innerText(), /26291\/01[\s\S]*Antes de alocar a OP na linha[\s\S]*Troca de produto/);
    assert.deepEqual(r.errors, [], 'erros (tela): ' + r.errors.join(' | '));
    console.log('OK Assepsia antes de alocar: trava barra troca de produto, dispensa gravada na mesma fórmula, rotulagem livre, aprovada libera; sem trava só avisa; próxima OP preparada na tela.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
