'use strict';
/* Histórico de Produção, tela de verdade: coluna Início → Término, "?" no
   registro antigo, visão condensada por OP, horas/un/h na aba Por OP e o que
   o modal grava ao editar início/término. utils.js, auth_check.js e o módulo
   reais; Firebase simulado que registra cada escrita. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const Z = s => new Date(s + '-03:00').toISOString(); // hora da fábrica -> ISO

function dados() {
  return {
    'usuarios/u1': {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'},
    config: {linhas: ['Linha 1', 'Linha 2'], rotulagem: ['Rotulagem 01'], postosTrabalho: [], turnos: ['Turno 01']},
    pedidos: {},
    perdas: {},
    ops: {
      'OP1-01': {lote: 'OP1/01', produto: 'BODY SPLASH CEU', sku: 'SKU1', status: 'Em Produção', qtdPlanejada: 2000, produzidoLinha: 1802, linha: 'Linha 1', mediaPorHora: 999},
      '26219-03': {lote: '26219/03', produto: 'BODY SPLASH NUVEM', sku: 'SKU2', status: 'Concluído', qtdPlanejada: 4480, produzidoLinha: 4272, linha: 'Linha 2'}
    },
    'registros/2026-09-10': {
      antigo1: {hora: '14_00', linha: 'Linha 1', lote: 'OP1/01', produto: 'BODY SPLASH CEU', quantidade: 202, operador: 'Ana'},
      per1: {data: '2026-09-10', hora: '12:00', linha: 'Linha 1', lote: 'OP1/01', produto: 'BODY SPLASH CEU', quantidade: 1000,
        tipo: 'apontamento_total', qtdTotalOP: 1000, periodoInicio: Z('2026-09-10T07:00'), periodoFim: Z('2026-09-10T12:00'),
        horasTrabalhadas: 5, fonte: 'painel', timestamp: Z('2026-09-10T12:00'), sku: 'SKU1', operador: 'Ana'},
      per2: {data: '2026-09-10', hora: '16:00', linha: 'Linha 1', lote: 'OP1/01', produto: 'BODY SPLASH CEU', quantidade: 600,
        tipo: 'apontamento_total', qtdTotalOP: 1600, periodoInicio: Z('2026-09-10T13:00'), periodoFim: Z('2026-09-10T16:00'),
        horasTrabalhadas: 3, operador: 'Ana'}
    },
    'registros/2026-09-11': {
      troca: {data: '2026-09-11', hora: '16:00', linha: 'Linha 2', lote: '26219/03', produto: 'BODY SPLASH NUVEM', quantidade: 4416,
        tipo: 'apontamento_total', qtdTotalOP: 4272, periodoInicio: Z('2026-09-10T16:35'), periodoFim: Z('2026-09-11T16:05'), horasTrabalhadas: 22}
    },
    'registros/2026-09-15': {
      noite: {data: '2026-09-15', hora: '06:00', linha: 'Linha 2', lote: '', produto: 'SEM LOTE', quantidade: 50,
        periodoInicio: Z('2026-09-14T22:00'), periodoFim: Z('2026-09-15T06:00'), horasTrabalhadas: 7}
    }
  };
}

async function abrir(browser, largura) {
  const context = await browser.newContext({viewport: {width: largura || 1700, height: 1200}, timezoneId: 'America/Sao_Paulo'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(({data}) => {
    window.__writes = [];
    window.__iniciado = false;
    const exige = q => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
    let pushN = 0;
    const grava = (op, path, valor) => { window.__writes.push({op, path: path || '/', valor: JSON.parse(JSON.stringify(valor === undefined ? null : valor))}); return Promise.resolve(); };
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() {
        exige('auth');
        return {onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), 0); },
          signOut() { return Promise.resolve(); }};
      },
      database() {
        exige('database');
        return {ref(path) {
          const snap = {val: () => (path in data ? structuredClone(data[path]) : null), exists: () => path in data};
          return {path,
            once(ev, cb) { if (cb) cb(snap); return Promise.resolve(snap); },
            on(ev, cb) { setTimeout(() => cb(snap), 0); return cb; },
            off() {}, child() { return this; }, orderByChild() { return this; }, equalTo() { return this; },
            push(v) { const key = 'novo' + (++pushN); if (v !== undefined) grava('push', path + '/' + key, v); return {key, then: f => Promise.resolve().then(f)}; },
            set(v) { return grava('set', path, v); }, update(v) { return grava('update', path, v); }, remove() { return grava('remove', path, null); },
            transaction(fn) { const r = fn(structuredClone(snap.val())); grava('transaction', path, r); return Promise.resolve({committed: true, snapshot: {exists: () => r != null, val: () => r}}); }};
        }};
      }
    };
  }, {data: dados()});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'hist.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://hist.test/historico.html');
  await page.waitForFunction(() => window.HistoricoApontamentos && document.getElementById('fDataIni'));
  await page.fill('#fDataIni', '2026-09-01');
  await page.fill('#fDataFim', '2026-09-15');
  await page.click('#btnCarregar');
  await page.waitForFunction(() => /registros/.test(document.getElementById('tableCount').textContent));
  return {page, errors, context};
}

(async () => {
  // Sem o Chromium do Playwright baixado, usa o Edge que vem no Windows.
  const browser = await chromium.launch().catch(() => chromium.launch({channel: 'msedge'}));
  let n = 0;
  const ok = nome => { n++; console.log('ok -', nome); };
  try {
    const {page, errors, context} = await abrir(browser);

    // ── Coluna Início → Término ──
    const linhaTexto = key => page.locator('#tableBody tr', {has: page.locator('[data-key="' + key + '"][data-action="edit"]')}).innerText();
    assert.match(await page.locator('#wrapRegistros thead').innerText(), /INÍCIO → TÉRMINO/i);
    const noite = await linhaTexto('noite');
    assert.match(noite, /14\/09\/26 22:00/);
    assert.match(noite, /→ 15\/09\/26 06:00/);
    const antigo = await linhaTexto('antigo1');
    assert.match(antigo, /10\/09\/26 14:00/);
    assert.match(antigo, /→ \?/);
    assert.doesNotMatch(antigo, /15:00/, 'não presume a hora cheia + 1');
    ok('coluna mostra início e término com data; antigo com "?"');

    // ── Condensado ──
    await page.check('#fCondensar');
    await page.waitForSelector('#wrapCondensado tbody tr.cond-row');
    assert.equal(await page.locator('#wrapRegistros').isVisible(), false);
    assert.match(await page.locator('#tableCount').textContent(), /3 OP\/setor · 5 registros · 1 com erro/);
    const op1 = page.locator('tr.cond-row', {hasText: 'OP1/01'});
    const op1Txt = await op1.innerText();
    assert.match(op1Txt, /10\/09\/26 07:00/);
    assert.match(op1Txt, /→ 10\/09\/26 16:00/);
    assert.match(op1Txt, /1\.802/);
    assert.match(op1Txt, /8h trabalhadas/);
    assert.match(op1Txt, /200 un\/h/, '1.600 un em 8h; o antigo sem término fica fora');
    assert.match(op1Txt, /sem 202 un\. de 1 reg\. sem término/);
    assert.match(op1Txt, /1 registro sem término/);
    assert.match(op1Txt, /✓ confere/, 'acumulado 1.600 bate com a soma até o checkpoint; total da OP 1.802 bate com tudo');
    const troca = page.locator('tr.cond-row', {hasText: '26219/03'});
    assert.match(await troca.getAttribute('class'), /erro/);
    assert.match(await troca.innerText(), /Acumulado informado 4272, soma dos apontamentos até ali 4416/);
    assert.match(await troca.innerText(), /mais de 12h seguidas/);
    assert.match(await page.locator('tr.cond-row', {hasText: 'SEM LOTE'}).innerText(), /sem lote/);
    ok('condensado: período, horas, un/h e conferência por OP');

    const det = page.locator('tr.cond-det').nth(await op1.evaluate(el => +el.dataset.idx));
    assert.equal(await det.isVisible(), false);
    await op1.click();
    assert.equal(await det.isVisible(), true);
    assert.equal(await det.locator('tbody tr').count(), 3);
    assert.match(await det.locator('tbody tr').first().innerText(), /10\/09\/26 07:00/, 'detalhe em ordem de início');
    ok('linha condensada abre os apontamentos da OP');

    // ── Edição a partir do detalhe: muda o início de um período ──
    await det.locator('[data-key="per1"][data-action="edit"]').click();
    await page.waitForSelector('#editModalBg.open');
    assert.equal(await page.inputValue('#eInicio'), '2026-09-10T07:00');
    assert.equal(await page.inputValue('#eTermino'), '2026-09-10T12:00');
    await page.fill('#eInicio', '2026-09-10T06:30');
    assert.match(await page.locator('#ePeriodoHint').innerText(), /Duração 5h30 · 5h30 trabalhadas|Duração 5h30\./);
    assert.match(await page.locator('#ePeriodoHint').innerText(), /dia 10\/09\/2026/);
    await page.evaluate(() => { window.__writes = []; });
    await page.click('#editBtnSave');
    await page.waitForFunction(() => window.__writes.some(w => w.path === 'registros/2026-09-10/per1'));
    const w1 = (await page.evaluate(() => window.__writes)).find(w => w.path === 'registros/2026-09-10/per1');
    assert.equal(w1.op, 'update');
    assert.equal(w1.valor.periodoInicio, '2026-09-10T09:30:00.000Z');
    assert.equal(w1.valor.periodoFim, '2026-09-10T15:00:00.000Z');
    assert.equal(w1.valor.horasTrabalhadas, 5.5);
    assert.equal(w1.valor.hora, '06:30');
    assert.equal(w1.valor.data, '2026-09-10');
    ok('editar início grava período, hora e horas trabalhadas');

    // ── Salvar sem mexer no período: não reescreve horário ──
    await page.uncheck('#fCondensar');
    await page.locator('#tableBody [data-key="antigo1"][data-action="edit"]').click();
    await page.waitForSelector('#editModalBg.open');
    assert.equal(await page.inputValue('#eInicio'), '2026-09-10T14:00');
    assert.equal(await page.inputValue('#eTermino'), '');
    assert.match(await page.locator('#ePeriodoHint').innerText(), /“\?”/);
    await page.fill('#eObs', 'conferido');
    await page.evaluate(() => { window.__writes = []; });
    await page.click('#editBtnSave');
    await page.waitForFunction(() => window.__writes.some(w => w.path === 'registros/2026-09-10/antigo1'));
    const w2 = (await page.evaluate(() => window.__writes)).find(w => w.path === 'registros/2026-09-10/antigo1');
    assert.equal('hora' in w2.valor, false);
    assert.equal('periodoInicio' in w2.valor, false);
    assert.equal(w2.valor.obs, 'conferido');
    ok('salvar sem mexer no período não toca em hora/período');

    // ── Validação: término apagado num registro que tinha término ──
    await page.locator('#tableBody [data-key="per2"][data-action="edit"]').click();
    await page.waitForSelector('#editModalBg.open');
    await page.fill('#eTermino', '');
    await page.evaluate(() => { window.__writes = []; });
    await page.click('#editBtnSave');
    assert.match(await page.locator('#editAlertBox').innerText(), /término gravado/);
    assert.equal((await page.evaluate(() => window.__writes)).length, 0);
    await page.click('#editBtnCancel');
    ok('não deixa apagar o término de um período');

    // ── Período que sai do dia: move o nó sem perder campos ──
    await page.locator('#tableBody [data-key="noite"][data-action="edit"]').click();
    await page.waitForSelector('#editModalBg.open');
    await page.fill('#eInicio', '2026-09-12T08:00');
    await page.fill('#eTermino', '2026-09-12T17:00');
    assert.match(await page.locator('#ePeriodoHint').innerText(), /dia 12\/09\/2026 \(sai de 15\/09\/2026\)/);
    await page.evaluate(() => { window.__writes = []; });
    await page.click('#editBtnSave');
    await page.waitForFunction(() => window.__writes.some(w => w.path === '/'));
    const mov = (await page.evaluate(() => window.__writes)).find(w => w.path === '/').valor;
    assert.equal(mov['registros/2026-09-15/noite'], null);
    const novaChave = Object.keys(mov).find(k => k.startsWith('registros/2026-09-12/'));
    assert.ok(novaChave, 'vai para o dia do início');
    assert.equal(mov[novaChave].periodoInicio, '2026-09-12T11:00:00.000Z');
    assert.equal(mov[novaChave].horasTrabalhadas, 8, 'mantém a 1h de pausa descontada');
    assert.equal(mov[novaChave].data, '2026-09-12');
    ok('mudar de dia move o registro com período e horas');

    // ── Aba Por OP: horas trabalhadas e produção por hora ──
    await page.click('#tabOP');
    const opHtml = await page.locator('#opGroups').innerHTML();
    assert.match(opHtml, /Horas trabalhadas \(envase\)/);
    assert.match(opHtml, /<strong>8h<\/strong> em 3 apontamentos/);
    assert.match(opHtml, /<strong>200 un\/h<\/strong>/);
    assert.match(opHtml, /último ritmo gravado na OP: 999 un\/h/);
    assert.match(opHtml, /8h trabalhadas · 200 un\/h/, 'resumo no cabeçalho da OP');
    assert.match(opHtml, /fora da conta: 1 registro sem término, 202 un\./);
    ok('Por OP mostra horas trabalhadas e un/h pelos apontamentos');

    // ── CSV ──
    await page.click('#tabRegistros');
    const csv = await page.evaluate(() => new Promise(res => {
      const orig = URL.createObjectURL;
      URL.createObjectURL = b => { b.text().then(res); return 'blob:x'; };
      document.getElementById('btnExportCSV').click();
      URL.createObjectURL = orig;
    }));
    assert.match(csv.split('\n')[0], /^﻿?Data;Início;Término;Produto/);
    assert.match(csv, /10\/09\/26 14:00;\?;/);
    await page.check('#fCondensar');
    const csvOp = await page.evaluate(() => new Promise(res => {
      URL.createObjectURL = b => { b.text().then(res); return 'blob:x'; };
      document.getElementById('btnExportCSV').click();
    }));
    assert.match(csvOp.split('\n')[0], /Início;Término;Produto;Setor;Linhas;Qtd \(soma\)/);
    assert.match(csvOp, /OP1\/01;.*;3;8;200;1;/);
    ok('CSV com início/término e CSV condensado por OP');

    assert.deepEqual(errors, []);
    await context.close();

    // ── Celular ──
    const cel = await abrir(browser, 390);
    await cel.page.check('#fCondensar');
    await cel.page.waitForSelector('tr.cond-row');
    const larguraBody = await cel.page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 1);
    assert.equal(larguraBody, true, 'tabela rola dentro do próprio contêiner');
    assert.deepEqual(cel.errors, []);
    await cel.context.close();
    ok('celular sem rolagem horizontal da página');
  } finally {
    await browser.close();
  }
  console.log('\n' + n + ' casos ok');
})().catch(e => { console.error(e); process.exit(1); });
