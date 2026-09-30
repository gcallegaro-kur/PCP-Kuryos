'use strict';
/* Andon do Dashboard: rotulagem, postos, cadeia do lote e fila da Qualidade
   (pedido do usuário, 30/09). Tela real, Firebase simulado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const HOJE = new Date();
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const AMANHA = new Date(HOJE.getTime() + 86400000);

function dados() {
  const h = (horas) => new Date(Date.now() - horas * 3600000).toISOString();
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    config: {linhas: ['Linha 1', 'Linha 2'], rotulagem: ['Rotulagem 01', 'Rotulagem 02'], postosTrabalho: ['Celofane']},
    estado_linhas: {Rotulagem_02: {status: 'parada', setor: 'rotulagem', inicioParada: h(0.5), motivoParada: 'Falta de Material', lote: 'B/01'}},
    atividadesPosto: {a1: {nome: 'Celofane', operador: 'Ana', abertoEm: h(1)}},
    ops: {
      'OP-A': {lote: 'A/01', produto: 'BODY A', status: 'Em Produção', qtdPlanejada: 1000, produzidoRotulagem: 400, abertaDesdeRot: h(3), abertaRotulagem: 'Rotulagem 01', abertaDesde: h(5), abertaLinha: 'Linha 1', produzidoLinha: 800},
      'OP-B': {lote: 'B/01', produto: 'BODY B', status: 'Em Produção', qtdPlanejada: 500, produzidoRotulagem: 0, abertaDesdeRot: h(1), abertaRotulagem: 'Rotulagem 02'},
      'OP-M': {lote: 'M/01', produto: 'HIDRATANTE M', cliente: 'CLIENTE', status: 'Em Produção', qtdPlanejada: 300,
        manipulacao: {status: 'PESADO', pesagem: {inicio: h(30), fim: h(10)}}},
      'OP-LOG': {lote: 'LOG/01', produto: 'PERFUME LOG', status: 'Concluído', produzidoLinha: 300, qtdPlanejada: 300, confirmadoEm: h(60)}
    },
    estoque_lotes: {
      'MPGR-1': {a: {itemTipo: 'material', itemCodigo: 'MPGR-00001', itemNome: 'GLICERINA', status: 'QUARENTENA', saldoLote: 50, criadoEm: h(72)}},
      'EP-1': {b: {itemTipo: 'material', itemCodigo: 'EP-00092', itemNome: 'FRASCO', status: 'QUARENTENA', saldoLote: 900, criadoEm: h(3)}}
    },
    conferencias_pa: {},
    nao_conformidades: {r1: {status: 'ABERTA'}, r2: {status: 'CONCLUIDA'}},
    registros: {}, paradas_historico: {}, pedidos: {}, programacao: {}, produtos: {}
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
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, limitToLast() { return this; }, endAt() { return this; },
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
    const {page, errors} = await abrir(browser, 'dashboard.html');
    await page.waitForFunction(() => /Nada esperando|esperando além do normal/.test(document.getElementById('cadeiaResumo').innerText), null, {timeout: 10000});

    // Faixa da cadeia, na ordem do processo, com contagens.
    const chips = await page.locator('#cadeiaFaixa .cadeia-chip').allInnerTexts();
    assert.equal(chips.length, 6, chips.join(' | '));
    const txt = (k) => page.locator('#cadeiaFaixa [data-cadeia="' + k + '"]').innerText();
    assert.match(await txt('manipulacao'), /1/);
    assert.match(await txt('envase'), /1/);
    assert.match(await txt('rotulagem'), /2/);
    assert.match(await txt('conferencia_pa'), /1/);
    // Manipulação há 10 h (limite 8 h) e Conferência de PA há 60 h (limite 48 h): atenção.
    assert.ok(await page.locator('#cadeiaFaixa [data-cadeia="manipulacao"].atencao').count(), 'manipulação esperando além do normal');
    assert.ok(await page.locator('#cadeiaFaixa [data-cadeia="conferencia_pa"].atencao').count());
    assert.equal(await page.locator('#cadeiaFaixa [data-cadeia="envase"].atencao').count(), 0);
    assert.match(await page.locator('#cadeiaResumo').innerText(), /esperando além do normal/);

    // Fila da Qualidade: matéria-prima há 72 h entra em atenção; RNC concluída não conta.
    const fila = await page.locator('#cadeiaFila').innerText();
    assert.match(fila, /Matéria-prima 1/);
    assert.match(fila, /Embalagem 1/);
    assert.match(fila, /1 RNC aberta/);
    assert.ok(await page.locator('#cadeiaFila [data-cadeia="fila:mp"].atencao').count());
    assert.equal(await page.locator('#cadeiaFila [data-cadeia="fila:embalagem"].atencao').count(), 0);

    // O detalhe abre por clique e fecha no segundo clique.
    assert.equal((await page.locator('#cadeiaDetalhe').innerText()).trim(), '');
    await page.click('#cadeiaFaixa [data-cadeia="manipulacao"]');
    assert.match(await page.locator('#cadeiaDetalhe').innerText(), /M\/01/);
    assert.match(await page.locator('#cadeiaDetalhe').innerText(), /Pesado/);
    await page.click('#cadeiaFaixa [data-cadeia="manipulacao"]');
    assert.equal((await page.locator('#cadeiaDetalhe').innerText()).trim(), '');
    await page.click('#cadeiaFila [data-cadeia="fila:mp"]');
    assert.match(await page.locator('#cadeiaDetalhe').innerText(), /GLICERINA/);

    // Rotuladoras: uma operando (com a OP e %), uma parada com o motivo.
    const cards = await page.locator('#rotulagemGrid .andon-db-card').allInnerTexts();
    assert.equal(cards.length, 2);
    assert.match(cards[0], /Rotulagem 01/);
    assert.match(cards[0], /OPERANDO/);
    assert.match(cards[0], /A\/01/);
    assert.match(cards[0], /400 \/ 1\.000/);
    assert.match(cards[0], /40%/);
    assert.match(cards[1], /PARADA: Falta de Material/);
    assert.equal(await page.locator('#rotulagemGrid .andon-db-card.stopped').count(), 1);
    // Postos abertos agora.
    assert.match(await page.locator('#postosAndon').innerText(), /Celofane/);
    // O Andon das linhas de envase segue no lugar.
    assert.ok((await page.locator('.andon-dashboard-grid').first().innerText()).includes('Linha 1'));
    if (process.env.ANDON_SCREENSHOT) await page.screenshot({path: process.env.ANDON_SCREENSHOT});
    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    console.log('OK Andon: cadeia do lote, fila da Qualidade, rotuladoras e postos.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
