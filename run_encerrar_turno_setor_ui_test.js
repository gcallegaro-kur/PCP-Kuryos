'use strict';
/* Encerrar turno por setor (05/10): quem fecha o envase não é perguntado sobre a rotulagem (e vice-versa),
   e uma linha/rotuladora já fechada ("Fim de turno") e não retomada não é perguntada de novo.
   Tela real (form.html); Firebase simulado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados(role) {
  const h = (horas) => new Date(Date.now() - horas * 3600000).toISOString();
  return {
    usuarios: {u1: {nome: 'Lider', email: 'l@kuryos.com', role: role}},
    config: {linhas: ['Linha 1', 'Linha 2'], rotulagem: ['Rotulagem 01', 'Rotulagem 02'], postosTrabalho: []},
    estado_linhas: {
      Linha_1: {status: 'ativa', setor: 'linha', lote: '26271/01'},
      Linha_2: {status: 'parada', setor: 'linha', motivoParada: 'Fim de turno', inicioParada: h(1), lote: '26272/01'},
      Rotulagem_01: {status: 'parada', setor: 'rotulagem', motivoParada: 'Fim de turno', inicioParada: h(1), lote: '26271/01'},
      Rotulagem_02: {status: 'ativa', setor: 'rotulagem', lote: '26273/01'}
    },
    ops: {
      '26271-01': {lote: '26271/01', produto: 'BODY A', cliente: 'WIKE', sku: 'A', status: 'Em Produção', qtdPlanejada: 1000, produzidoLinha: 200, produzidoRotulagem: 900, abertaDesde: h(5), abertaLinha: 'Linha 1', abertaDesdeRot: h(6), abertaRotulagem: 'Rotulagem 01'},
      '26272-01': {lote: '26272/01', produto: 'BODY B', cliente: 'WIKE', sku: 'B', status: 'Em Produção', qtdPlanejada: 1000, produzidoLinha: 300, abertaDesde: h(5), abertaLinha: 'Linha 2'},
      '26273-01': {lote: '26273/01', produto: 'BODY C', cliente: 'WIKE', sku: 'C', status: 'Em Produção', qtdPlanejada: 1000, produzidoRotulagem: 100, abertaDesdeRot: h(4), abertaRotulagem: 'Rotulagem 02'}
    },
    material_processo: {}, pedidos: {}, produtos: {}, registros: {}, programacao: {}, turnosIniciados: {}, turnosEncerrados: {}, atividadesPosto: {}, paradas_historico: {}
  };
}

async function abrirPagina(browser, role, atraso) {
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
  await page.goto('https://tr.test/form.html');
  await page.waitForSelector('.kt-sidebar', {timeout: 8000});
  return {page, errors};
}





const nomesPendentes = (page) => page.evaluate(() => [...document.querySelectorAll('#turnoConfirmBox .tp-name')].map((x) => x.textContent.trim()));

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrirPagina(browser, 'admin', 0);
    await page.waitForFunction(() => window.currentUser && window.currentUser.role === 'admin', null, {timeout: 10000});
    await page.waitForTimeout(800);
    const dialogos = [];
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => { dialogos.push(d.message()); d.accept(); });

    // Área do envase: só as linhas. A Linha 2 já foi fechada ("Fim de turno") e ninguém retomou; as rotuladoras não entram.
    await page.evaluate(() => escolherSetorVisao('envase'));
    await page.click('#btnEncerrarTurno');
    await page.waitForSelector('#turnoConfirmBox .tp-name');
    let nomes = await nomesPendentes(page);
    assert.deepEqual(nomes, ['Linha 1 · OP 26271/01'], 'envase: só a linha ativa, sem rotulagem e sem a linha já fechada: ' + nomes.join(' | '));

    // Área da rotulagem: só a rotuladora ativa; a Rotulagem 01 já foi encerrada por quem opera.
    await page.evaluate(() => { document.getElementById('turnoConfirmBox').innerHTML = ''; escolherSetorVisao('rotulagem'); });
    await page.click('#btnEncerrarTurno');
    await page.waitForSelector('#turnoConfirmBox .tp-name');
    nomes = await nomesPendentes(page);
    assert.deepEqual(nomes, ['Rotulagem 02 · OP 26273/01'], 'rotulagem: só a rotuladora ativa: ' + nomes.join(' | '));

    // Se a única rotuladora aberta já foi fechada, o aviso diz isso em vez de pedir dados.
    await page.evaluate(() => { document.getElementById('turnoConfirmBox').innerHTML = ''; latestAndonStates.Rotulagem_02.status = 'parada'; latestAndonStates.Rotulagem_02.motivoParada = 'Fim de turno'; });
    dialogos.length = 0;
    await page.click('#btnEncerrarTurno');
    await page.waitForTimeout(300);
    assert.ok(dialogos.some((m) => /Nada a fechar/.test(m) && /Rotulagem 02/.test(m)), 'avisa que já foi fechada: ' + dialogos.join(' | '));
    assert.equal(await page.locator('#turnoConfirmBox .tp-name').count(), 0);

    // Retomar (status volta a ativa): a pergunta reaparece.
    await page.evaluate(() => { latestAndonStates.Rotulagem_02.status = 'ativa'; delete latestAndonStates.Rotulagem_02.motivoParada; });
    await page.click('#btnEncerrarTurno');
    await page.waitForSelector('#turnoConfirmBox .tp-name');
    assert.deepEqual(await nomesPendentes(page), ['Rotulagem 02 · OP 26273/01']);

    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
  } finally {
    await browser.close();
  }
  console.log('OK Encerrar turno por setor: envase não pergunta a rotulagem (e vice-versa) e linha já fechada não é perguntada de novo.');
})().catch((e) => { console.error(e); process.exit(1); });
