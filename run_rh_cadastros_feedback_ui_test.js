'use strict';
/* RH › Colaboradores alimenta o diretório do Feedback da Semana: setor do cargo como padrão, setor próprio, vínculo de login de
   qualquer papel (não só gestor), troca e remoção de vínculo, desligamento. Tela real, Firebase simulado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dadosComSetores(perfil) {
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: perfil}, uOp: {nome: 'Operadora Teste', email: 'op@kuryos.com', role: 'production'}, uPend: {nome: 'Pendente', role: 'pending'}},
    rh_cargos: {cg1: {nome: 'Operador', setor: 'Rotulagem', ativo: true}},
    rh_colaboradores: {c1: {nome: 'Maria Silva', status: 'Ativo', cargoKey: 'cg1', tipoContrato: 'CLT'}},
    rh_colaboradores_publico: {c1: {nome: 'Maria Silva', status: 'Ativo', cargoKey: 'cg1'}},
    feedback_diretorio: {}, feedback_diretorio_por_uid: {}
  };
}
async function abrir(browser, pagina, perfil) {
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
      storage() { return {ref: (p) => ({put() { return Promise.resolve(); }, getDownloadURL() { return Promise.resolve('https://fotos.test/' + p); }})}; },
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
  }, {data: dadosComSetores(perfil), atraso: atraso});
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






const db = (page) => page.evaluate(() => window.__db);

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const r = await abrir(browser, 'rh_cadastros.html', 'rh');
    const page = r.page;
    await page.waitForSelector('#tableBody-col tr td strong, #tableBody-col tr td', {timeout: 8000});
    await page.waitForFunction(() => /Maria Silva/.test(document.querySelector('#tableBody-col').innerText), null, {timeout: 8000});
    // edita a Maria: setor próprio + login de operador (role production)
    await page.locator('#tableBody-col tr', {hasText: 'Maria Silva'}).locator('button').first().click();
    await page.waitForSelector('#fSetor-col');
    assert.equal(await page.inputValue('#fSetor-col'), '', 'setor próprio em branco: vale o do cargo');
    assert.ok((await page.locator('#dlSetores-col option').count()) >= 1, 'sugestão de setores já usados');
    await page.fill('#fSetor-col', 'Produção');
    await page.focus('#fLogin-col'); await page.fill('#fLogin-col', 'Operadora');
    await page.waitForSelector('.kt-ac-item');
    assert.match(await page.locator('.kt-ac-item').first().innerText(), /Operadora Teste/, 'login de qualquer papel pode ser vinculado');
    assert.equal(await page.locator('.kt-ac-item', {hasText: 'Pendente'}).count(), 0, 'usuário pendente não');
    await page.locator('.kt-ac-item').first().click();
    await page.click('#modalSaveBtn-col');
    await page.waitForFunction(() => window.__db.feedback_diretorio && window.__db.feedback_diretorio.c1);
    let d = await db(page);
    const semNulos = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));   // o banco real descarta nulos
    assert.deepEqual(semNulos(d.feedback_diretorio.c1), {nome: 'Maria Silva', setor: 'PRODUÇÃO', setorChave: 'producao', status: 'Ativo', tipo: 'colaborador'});
    assert.equal(d.feedback_diretorio_por_uid.uOp, 'c1');
    assert.equal(d.rh_colaboradores_publico.c1.setor, 'PRODUÇÃO'); assert.equal(d.rh_colaboradores.c1.setor, 'PRODUÇÃO');
    assert.ok(!JSON.stringify(d.feedback_diretorio).includes('uOp'), 'o login não vai para o diretório lido por todos');
    // limpa o setor: volta ao do cargo
    await page.locator('#tableBody-col tr', {hasText: 'Maria Silva'}).locator('button').first().click();
    await page.waitForSelector('#fSetor-col');
    await page.fill('#fSetor-col', '');
    await page.click('#modalSaveBtn-col');
    await page.waitForFunction(() => window.__db.feedback_diretorio.c1.setor === 'Rotulagem');
    // desliga: o vínculo de login sai do diretório
    await page.locator('#tableBody-col tr', {hasText: 'Maria Silva'}).locator('button').first().click();
    await page.waitForSelector('#btnAbrirDesligar-col');
    await page.click('#btnAbrirDesligar-col');
    await page.click('#dConfirmBtn-col');
    await page.waitForFunction(() => window.__db.feedback_diretorio.c1.status === 'Desligado');
    d = await db(page);
    assert.ok(!d.feedback_diretorio_por_uid || !d.feedback_diretorio_por_uid.uOp, 'desligado perde o vínculo');
    assert.deepEqual(r.errors, []);
    console.log('OK UI RH › Colaboradores: setor (próprio ou do cargo), vínculo de login de qualquer papel e diretório do Feedback em dia (troca e desligamento).');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
