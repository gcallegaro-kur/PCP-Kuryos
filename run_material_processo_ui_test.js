'use strict';
/* Material em Processo (01/10): cadastrar bombonas/tanques, registrar bulk com lote,
   validade e dono, etiqueta, ajuste/esvaziar, bulk sem recipiente, sobras e baixa.
   Tela real; Firebase simulado em memória (avisa os ouvintes a cada gravação). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados(role) {
  const h = (horas) => new Date(Date.now() - horas * 3600000).toISOString();
  return {
    usuarios: {u1: {nome: 'Joseilton', email: 'j@kuryos.com', role: role}},
    config: {linhas: ['Linha 1', 'Linha 2']},
    ops: {
      '26267-04': {lote: '26267/04', produto: 'BODY SPLASH IDOLA 120ML', sku: 'WKBS0006', cliente: 'WIKE MAKE', status: 'Em Produção',
        validade: '2029-09-24T19:54:38Z', dataEmissao: h(30), pesoTeoricoUnG: 100, produzidoLinha: 0, qtdPlanejada: 5000,
        manipulacao: {status: 'LIBERADO', manipulacao: {inicio: h(5), fim: h(4), rendimento: 546.6}}},
      '26274-01': {lote: '26274/01', produto: 'HIDRATANTE ROSA RAINHA 200g', sku: 'HDR-MISS-0006', cliente: 'MISS RÔSE', status: 'Programado',
        validade: '2029-10-01T10:00:00Z', dataEmissao: h(20), pesoTeoricoUnG: 200, produzidoLinha: 0, qtdPlanejada: 1760,
        manipulacao: {status: 'LIBERADO', manipulacao: {inicio: h(3), fim: h(2), rendimento: 330}}},
      '26300-01': {lote: '26300/01', produto: 'SEM BULK', status: 'Programado', dataEmissao: h(2)}
    },
    bombonas_bulk: {}, contador_bombonas: {},
    material_processo: {
      m1: {opKey: '26267-04', lote: '26267/04', produto: 'BODY SPLASH IDOLA 120ML', tipo: 'FRASCO_ROTULADO', descricao: 'Frascos já rotulados que sobraram', qtd: 1200, unidade: 'un',
        donoTipo: 'CLIENTE', donoNome: 'WIKE MAKE', origem: 'PAUSA', declaradoPor: 'Ana', em: h(8), status: 'EM_PROCESSO'}
    }
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
            remove() { gravar(path, null); notificar(); return Promise.resolve(); },
            transaction(fn) { const r = fn(valor()); if (r !== undefined) { gravar(path, r); notificar(); } return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        };
        return {ref: (p) => ref(p || '')};
      }
    };
  }, {data: dados(role), atraso: atraso});
  await page.addInitScript(() => { window.open = () => ({document: {write: (h) => { window.__etq = h; }, close() {}}}); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'tr.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://tr.test/material_processo.html');
  await page.waitForSelector('.kt-sidebar', {timeout: 8000});
  return {page, errors};
}



const dentro = (page, seletor) => page.locator('.modal-fundo ' + seletor);
const db = (page) => page.evaluate(() => window.__db);
(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrirPagina(browser, 'pcp', 0);
    await page.waitForFunction(() => /Nenhuma bombona cadastrada/.test(document.getElementById('corpoBombonas').innerText), null, {timeout: 10000});

    // ── 1. Bulk sem bombona: as duas OPs com bulk manipulado; a sem bulk não ──
    await page.waitForFunction(() => !document.getElementById('cardSemRecipiente').hidden);
    const sem = await page.locator('#corpoSemRecipiente').innerText();
    assert.match(sem, /26267\/04/);
    assert.match(sem, /26274\/01/);
    assert.doesNotMatch(sem, /26300\/01/, 'OP sem fase de bulk não entra');
    assert.match(sem, /546,6 kg/);

    // ── 2. Cadastrar 2 bombonas de 200 kg ──
    await page.click('#btnNovas');
    await dentro(page, '#nvTipo').selectOption('BOMBONA');
    await dentro(page, '#nvQtd').fill('2');
    await dentro(page, '#nvCap').fill('200');
    await page.getByRole('button', {name: 'Cadastrar', exact: true}).click();
    await page.waitForFunction(() => Object.keys(window.__db.bombonas_bulk || {}).length === 2, null, {timeout: 8000});
    let d = await db(page);
    assert.deepEqual(Object.keys(d.bombonas_bulk).sort(), ['BB-0001', 'BB-0002']);
    assert.equal(d.bombonas_bulk['BB-0001'].capacidadeKg, 200);
    assert.equal(d.contador_bombonas.BB, 2);
    await page.waitForFunction(() => /BB-0001, BB-0002/.test(document.getElementById('aviso').innerText));
    await page.click('#btnImprimirNovas');
    const etqVazia = await page.evaluate(() => window.__etq);
    assert.match(etqVazia, /BB-0001/);
    assert.match(etqVazia, /VAZIA/);
    assert.match(etqVazia, /Preencher ao receber o bulk/);

    // ── 3. Registrar 150 kg da 26267/04 (a partir da lista "sem recipiente") ──
    await page.locator('#corpoSemRecipiente [data-op="26267-04"]').click();
    assert.equal(await dentro(page, '#rbOp').inputValue(), '26267-04');
    assert.equal(await dentro(page, '#rbVal').inputValue(), '2029-09-24', 'validade vem da OP');
    assert.match(await dentro(page, '#rbDono').innerText(), /Cliente — WIKE MAKE/);
    await dentro(page, '#rbRec').selectOption('BB-0001');
    await dentro(page, '#rbKg').fill('150');
    await dentro(page, '#rbLocal').fill('Sala de manipulação');
    await page.getByRole('button', {name: 'Registrar e etiquetar'}).click();
    await page.waitForFunction(() => window.__db.bombonas_bulk['BB-0001'].conteudo && window.__db.bombonas_bulk['BB-0001'].conteudo.kg === 150, null, {timeout: 8000});
    d = await db(page);
    let b1 = d.bombonas_bulk['BB-0001'];
    assert.equal(b1.conteudo.lote, '26267/04');
    assert.equal(b1.conteudo.validade, '2029-09-24');
    assert.equal(b1.conteudo.donoTipo, 'CLIENTE');
    assert.equal(b1.conteudo.donoNome, 'WIKE MAKE');
    assert.equal(b1.conteudo.local, 'Sala de manipulação');
    assert.equal(Object.values(b1.historico)[0].tipo, 'ENCHER');
    // A lista "sem recipiente" desconta: 546,6 − 150 = 396,6.
    await page.waitForFunction(() => /396,6 kg/.test(document.getElementById('corpoSemRecipiente').innerText));
    // Etiqueta cheia: lote, kg, validade e dono.
    await page.click('#btnImprimirEnch');
    const etq = await page.evaluate(() => window.__etq);
    assert.match(etq, /BB-0001/);
    assert.match(etq, /26267\/04/);
    assert.match(etq, /150 kg/);
    assert.match(etq, /24\/09\/2029/);
    assert.match(etq, /WIKE MAKE/);
    assert.match(etq, /BODY SPLASH IDOLA/);

    // ── 4. Complemento do mesmo lote soma; outro lote na mesma bombona é recusado; capacidade vale ──
    await page.locator('#corpoBombonas [data-encher="BB-0001"]').click();
    await dentro(page, '#rbOp').selectOption('26267-04');
    await dentro(page, '#rbKg').fill('60');
    await page.getByRole('button', {name: 'Registrar e etiquetar'}).click();
    await page.waitForFunction(() => /Passa da capacidade/.test(document.querySelector('.modal-fundo .erro').innerText));
    assert.equal((await db(page)).bombonas_bulk['BB-0001'].conteudo.kg, 150, 'estourou a capacidade: nada gravado');
    await dentro(page, '#rbKg').fill('30');
    await page.getByRole('button', {name: 'Registrar e etiquetar'}).click();
    await page.waitForFunction(() => window.__db.bombonas_bulk['BB-0001'].conteudo.kg === 180);
    await page.locator('#corpoBombonas [data-encher="BB-0001"]').click();
    await dentro(page, '#rbOp').selectOption('26274-01');
    await dentro(page, '#rbKg').fill('10');
    await page.getByRole('button', {name: 'Registrar e etiquetar'}).click();
    await page.waitForFunction(() => /já tem bulk do lote 26267\/04/.test(document.querySelector('.modal-fundo .erro').innerText));
    assert.equal((await db(page)).bombonas_bulk['BB-0001'].conteudo.kg, 180, 'lotes não se misturam');
    await page.getByRole('button', {name: 'Cancelar'}).click();

    // ── 5. Dono KURYOS e validade informada à mão (OP sem validade) ──
    await page.locator('#corpoBombonas [data-encher="BB-0002"]').click();
    await dentro(page, '#rbOp').selectOption('26274-01');
    await dentro(page, '#rbDono').selectOption('KURYOS');
    await dentro(page, '#rbKg').fill('80');
    await dentro(page, '#rbVal').fill('');
    await page.getByRole('button', {name: 'Registrar e etiquetar'}).click();
    await page.waitForFunction(() => /Informe a validade/.test(document.querySelector('.modal-fundo .erro').innerText));
    await dentro(page, '#rbVal').fill('2029-10-01');
    await page.getByRole('button', {name: 'Registrar e etiquetar'}).click();
    await page.waitForFunction(() => window.__db.bombonas_bulk['BB-0002'].conteudo && window.__db.bombonas_bulk['BB-0002'].conteudo.donoTipo === 'KURYOS');

    // ── 6. Ajustar kg e esvaziar, sempre com motivo e histórico ──
    await page.locator('#corpoBombonas [data-ajustar="BB-0001"]').click();
    await dentro(page, '#ajKg').fill('120');
    await dentro(page, '#ajMot').selectOption('Retirado para o envase');
    await page.getByRole('button', {name: 'Salvar ajuste'}).click();
    await page.waitForFunction(() => window.__db.bombonas_bulk['BB-0001'].conteudo.kg === 120);
    await page.locator('#corpoBombonas [data-esvaziar="BB-0002"]').click();
    await dentro(page, '#ajMot').selectOption('Outro');
    await page.getByRole('button', {name: 'Esvaziar', exact: true}).last().click();
    await page.waitForFunction(() => /Descreva o motivo/.test(document.querySelector('.modal-fundo .erro').innerText));
    await dentro(page, '#ajDet').fill('teste de limpeza');
    await page.getByRole('button', {name: 'Esvaziar', exact: true}).last().click();
    await page.waitForFunction(() => !window.__db.bombonas_bulk['BB-0002'].conteudo);
    d = await db(page);
    const tipos = Object.values(d.bombonas_bulk['BB-0001'].historico).map((x) => x.tipo);
    assert.deepEqual(tipos, ['ENCHER', 'ENCHER', 'AJUSTE']);
    assert.equal(Object.values(d.bombonas_bulk['BB-0002'].historico).pop().tipo, 'ESVAZIAR');
    await page.locator('#corpoBombonas [data-hist="BB-0001"]').click();
    assert.match(await page.locator('#corpoBombonas').innerText(), /AJUSTE 180 → 120 kg/);

    // ── 7. Sobras e retidos: lista e baixa ──
    await page.click('#abaSobras');
    assert.match(await page.locator('#corpoSobras').innerText(), /Frascos já rotulados que sobraram/);
    assert.match(await page.locator('#resumoSobras').innerText(), /1\.200 frascos rotulados/);
    await page.locator('#corpoSobras [data-baixa="m1"]').click();
    await page.getByRole('button', {name: 'Dar baixa', exact: true}).last().click();
    await page.waitForFunction(() => /Informe o motivo/.test(document.querySelector('.modal-fundo .erro').innerText));
    await dentro(page, '#bxMot').fill('usado na OP 26280/01');
    await dentro(page, '#bxSit').selectOption('USADO');
    await page.getByRole('button', {name: 'Dar baixa', exact: true}).last().click();
    await page.waitForFunction(() => window.__db.material_processo.m1.status === 'USADO');
    assert.equal((await db(page)).material_processo.m1.baixa.motivo, 'usado na OP 26280/01');
    assert.match(await page.locator('#resumoSobras').innerText(), /Nada em processo agora/);

    if (process.env.MP_SCREENSHOT) { await page.click('#abaBombonas'); await page.screenshot({path: process.env.MP_SCREENSHOT, fullPage: true}); }
    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    await page.close();

    // ── 8. Qualidade só lê: sem botões de gravar ──
    const q = await abrirPagina(browser, 'qualidade', 0);
    await q.page.waitForFunction(() => window.currentUser && window.currentUser.role === 'qualidade', null, {timeout: 10000});
    await q.page.waitForFunction(() => /Nenhuma bombona cadastrada/.test(document.getElementById('corpoBombonas').innerText));
    assert.equal(await q.page.locator('#btnNovas').isHidden(), true);
    assert.equal(await q.page.locator('#btnRegistrar').isHidden(), true);
    console.log('OK Material em Processo: bombonas, bulk com lote/validade/dono, etiqueta, ajuste, sobras e baixa; Qualidade só lê.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
