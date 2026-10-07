'use strict';
/* Temporários (rh_temporarios.html): grade de convocação, fechamento (com a regra da legenda), pagamento,
   atraso, cadastro, histórico, parâmetros e bloqueio de quem não é RH. Tela real, Firebase simulado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const SEG = '2026-09-21';
function dadosComSetores(perfil) {
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: perfil}},
    rh_temporarios: {
      t1: {nome: 'Ana Souza', status: 'Ativo', telefone: '(11) 90000-0001', documento: '111.111.111-11'},
      t2: {nome: 'Beto Lima', status: 'Ativo'},
      t3: {nome: 'Carla Dias', status: 'Inativo'}
    },
    rh_temporarios_presenca: {},
    rh_temporarios_atrasos: {},
    rh_temporarios_pagamentos: {},
    rh_temporarios_config: {},
    rh_temporarios_semanas: {}
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






function T(i) { const d = new Date(Date.UTC(2026, 8, 21 + i)); return d.toISOString().slice(0, 10); }
const db = (page) => page.evaluate(() => window.__db);
const celula = (page, id, d) => page.locator('[data-cel="' + id + '|' + d + '"]');
async function clicar(page, id, d, n) { for (let i = 0; i < n; i++) await celula(page, id, d).click(); }
const irParaSemana = async (page) => { await page.fill('#semData', SEG); await page.dispatchEvent('#semData', 'change'); };

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // ── quem não é RH não entra (a página nem abre; as regras do banco também barram) ──
    let r = await abrir(browser, 'rh_temporarios.html', 'rh');
    const acesso = await r.page.evaluate(() => ['rh', 'admin', 'pcp', 'gestor', 'production', 'qualidade'].map(role => [role, podeAbrirPagina({role: role}, 'rh_temporarios.html')]));
    assert.deepEqual(acesso, [['rh', true], ['admin', true], ['pcp', false], ['gestor', false], ['production', false], ['qualidade', false]]);
    await r.page.close();

    // ── RH ──
    r = await abrir(browser, 'rh_temporarios.html', 'rh');
    const page = r.page;
    await page.waitForSelector('[data-aba="semana"]', {timeout: 8000});
    await irParaSemana(page);
    await page.waitForSelector('[data-cel="t1|' + SEG + '"]');
    let txt = await page.locator('#conteudo').innerText();
    assert.match(txt, /Ana Souza/); assert.match(txt, /Beto Lima/); assert.ok(!/Carla Dias/.test(txt), 'inativo sem movimento fica fora da grade');
    // Ana: OK nos cinco dias (um clique = OK)
    for (let i = 0; i < 5; i++) await clicar(page, 't1', T(i), 1);
    let d = await db(page);
    assert.equal(d.rh_temporarios_presenca[T(0)].t1, 'OK'); assert.equal(d.rh_temporarios_presenca[T(4)].t1, 'OK');
    // ciclo: OK -> NC -> F -> FA -> branco
    await clicar(page, 't2', T(0), 4); d = await db(page);
    assert.equal(d.rh_temporarios_presenca[T(0)].t2, 'FA');
    await clicar(page, 't2', T(0), 1); d = await db(page);
    assert.ok(!d.rh_temporarios_presenca[T(0)] || d.rh_temporarios_presenca[T(0)].t2 == null, 'volta ao branco');
    // "todos OK" na segunda marca só quem está em branco
    await page.click('[data-todos="' + T(0) + '"]');
    d = await db(page);
    assert.equal(d.rh_temporarios_presenca[T(0)].t2, 'OK'); assert.equal(d.rh_temporarios_presenca[T(0)].t1, 'OK');
    // Beto: terça NC, quarta F -> semana reduzida
    await clicar(page, 't2', T(1), 2); await clicar(page, 't2', T(2), 3);
    d = await db(page);
    assert.equal(d.rh_temporarios_presenca[T(1)].t2, 'NC'); assert.equal(d.rh_temporarios_presenca[T(2)].t2, 'F');
    assert.match(await page.locator('table.grade tbody tr', {hasText: 'Beto Lima'}).innerText(), /Reduzida/);
    assert.match(await page.locator('table.grade tbody tr', {hasText: 'Ana Souza'}).innerText(), /Cheia/);

    // ── fechamento ──
    await page.click('[data-aba="fechamento"]');
    await page.waitForSelector('#folhaPrint');
    await irParaSemana(page);
    // Ana: 4 x 110 + 97,77 = 537,77; sem VT pago, 5 dias de VT a pagar (53,00) = 590,77
    assert.match(await page.locator('#folhaPrint tbody tr', {hasText: 'Ana Souza'}).innerText(), /590,77/);
    // Beto: 1 OK x 70 + 1 VT a pagar (10,60) = 80,60
    assert.match(await page.locator('#folhaPrint tbody tr', {hasText: 'Beto Lima'}).innerText(), /80,60/);
    await page.locator('#folhaPrint tbody tr', {hasText: 'Ana Souza'}).locator('[data-calc]').click();
    await page.waitForSelector('#mfCalc');
    assert.match(await page.locator('#mfCalc').innerText(), /VT a pagar/); assert.match(await page.locator('#mfCalc').innerText(), /590,77/);
    await page.click('#fechaCalc');

    // ── pagamento: VT fora do múltiplo é barrado; VT certo e salário entram ──
    await page.locator('#folhaPrint tbody tr', {hasText: 'Ana Souza'}).locator('[data-pagar]').click();
    await page.waitForSelector('#pgSalvar');
    assert.equal(await page.inputValue('#pgValor'), '590,77', 'Pagar pré-preenche o valor em aberto');
    await page.selectOption('#pgCat', 'VT'); await page.fill('#pgValor', '50');
    await page.click('#pgSalvar');
    assert.match(await page.locator('#pgErros').innerText(), /múltiplo/);
    await page.fill('#pgValor', '53'); await page.fill('#pgData', SEG); await page.click('#pgSalvar');
    await page.waitForFunction(() => Object.keys(window.__db.rh_temporarios_pagamentos || {}).length === 1);
    d = await db(page);
    const vt = Object.values(d.rh_temporarios_pagamentos)[0];
    assert.equal(vt.categoria, 'VT'); assert.equal(vt.valor, 53); assert.equal(vt.semana, SEG);
    await page.waitForSelector('#pgSalvar');
    await page.selectOption('#pgTemp', 't1'); await page.selectOption('#pgCat', 'SALARIO'); await page.fill('#pgValor', '300'); await page.fill('#pgData', T(8)); await page.fill('#pgSemana', SEG);
    await page.click('#pgSalvar');
    await page.waitForFunction(() => Object.keys(window.__db.rh_temporarios_pagamentos || {}).length === 2);
    d = await db(page);
    assert.ok(Object.values(d.rh_temporarios_pagamentos).some(g => g.categoria === 'SALARIO' && g.semana === SEG && g.valor === 300));
    await page.click('[data-aba="fechamento"]');
    await irParaSemana(page);
    await page.waitForSelector('#folhaPrint');
    // Ana: VT de 5 dias pago -> fechamento 537,77; pago 300; em aberto 237,77
    const ana = await page.locator('#folhaPrint tbody tr', {hasText: 'Ana Souza'}).innerText();
    assert.match(ana, /537,77/); assert.match(ana, /237,77/);

    // ── atraso ──
    await page.click('[data-aba="atrasos"]');
    await page.waitForSelector('#atSalvar');
    await page.selectOption('#atTemp', 't1'); await page.fill('#atData', T(1)); await page.fill('#atHoras', '1'); await page.click('#atSalvar');
    await page.waitForFunction(() => Object.keys(window.__db.rh_temporarios_atrasos || {}).length === 1);
    await page.fill('#atHoras', '0'); await page.click('#atSalvar');
    assert.match(await page.locator('#atErros').innerText(), /horas de atraso/);
    await page.click('[data-aba="fechamento"]');
    await irParaSemana(page);
    assert.match(await page.locator('#folhaPrint tbody tr', {hasText: 'Ana Souza'}).innerText(), /525,55/, '537,77 − 1 h × 12,22');

    // ── cadastro ──
    await page.click('[data-aba="cadastro"]');
    await page.click('#btnNovo');
    await page.fill('#c_nome', 'ana souza'); await page.click('#ctSalva');
    assert.match(await page.locator('#ctErros').innerText(), /Já existe/);
    await page.fill('#c_nome', 'Davi Rocha'); await page.fill('#c_setor', 'Produção'); await page.fill('#c_pix', '11999990000'); await page.click('#ctSalva');
    await page.waitForFunction(() => Object.values(window.__db.rh_temporarios).some(t => t.nome === 'Davi Rocha'));
    d = await db(page);
    const davi = Object.values(d.rh_temporarios).find(t => t.nome === 'Davi Rocha');
    assert.equal(davi.status, 'Ativo'); assert.equal(davi.setor, 'Produção'); assert.equal(davi.pix, '11999990000');
    await page.locator('tr', {hasText: 'Ana Souza'}).locator('[data-edit]').click();
    await page.fill('#c_telefone', ''); await page.click('#ctSalva');
    await page.waitForFunction(() => !window.__db.rh_temporarios.t1.telefone);
    assert.equal((await db(page)).rh_temporarios.t1.documento, '111.111.111-11', 'editar não apaga os outros campos');

    // ── histórico ──
    await page.click('[data-aba="historico"]');
    await page.waitForSelector('#ordHist');
    const hist = await page.locator('table tbody tr', {hasText: 'Ana Souza'}).innerText();
    assert.match(hist, /100%/); assert.match(hist, /21\/09\/2026/);

    // ── parâmetros e feriados ──
    await page.click('[data-aba="parametros"]');
    await page.waitForSelector('#pSalvar');
    assert.match(await page.locator('#conteudo').innerText(), /lista inicial da planilha/);
    await page.fill('#p_valorHora', '13,00'); await page.click('#pSalvar');
    await page.waitForFunction(() => window.__db.rh_temporarios_config.valorHora === 13);
    await page.fill('#fData', '2026-09-23'); await page.fill('#fNome', 'Feriado de teste'); await page.click('#fAdd');
    await page.waitForFunction(() => window.__db.rh_temporarios_config.feriados && window.__db.rh_temporarios_config.feriados['2026-09-23']);
    d = await db(page);
    assert.ok(Object.keys(d.rh_temporarios_config.feriados).length > 10, 'ao adicionar, a lista inicial é preservada');
    await page.click('[data-aba="semana"]');
    await irParaSemana(page);
    await page.waitForSelector('span.cl.FER');
    assert.match(await page.locator('table.grade thead').innerText(), /FER/);
    assert.deepEqual(r.errors, []);
    console.log('OK UI Temporários: grade, ciclo de marcação, fechamento, pagamento (VT barrado), atraso, cadastro, histórico, parâmetros e bloqueio de quem não é RH.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
