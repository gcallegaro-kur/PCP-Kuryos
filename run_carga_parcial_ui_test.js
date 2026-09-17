'use strict';
/* UI: faturamento da carga e saída parcial na Expedição (2026-09-17).
   Tela real (expedicao.html + agenda-pa-tela.js + expedicao-grade-tela.js);
   callables executam as funções puras do servidor sobre um estado em memória. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs'), assert = require('node:assert/strict');
const {fixture} = require('./run_expedicao_test');
const {prepararAgenda} = require('./functions/agenda_expedicao');
const {prepararSaida} = require('./functions/expedicao');
const {prepararFaturamento} = require('./functions/faturamento_carga');
const agora = '2026-09-11T18:00:00Z';
const LONGO = {timeout: 60000};

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
    const state = fixture(); const errors = []; let page;
    state.produtos = {PA001: {sku: 'PA001', descricao: 'Creme', kgCaixa: 8}};
    function aplicar(updates) { for (const [path, value] of Object.entries(updates)) { const ps = path.split('/'); let n = state; for (const p of ps.slice(0, -1)) n = n[p] || (n[p] = {}); n[ps.at(-1)] = structuredClone(value); } }
    await context.exposeFunction('serverPA', async (name, dados) => {
      let result;
      if (name === 'salvarAgendamentoExpedicaoPA') {
        const a = prepararAgenda(state, dados, 'Logística', 'u1', agora); state.agendamentos_expedicao = state.agendamentos_expedicao || {}; state.agendamentos_expedicao[dados.agendaKey] = a; result = {agendaKey: dados.agendaKey, revisao: a.revisao};
      } else if (name === 'faturamentoCargaPA') {
        const p = prepararFaturamento(state, dados, 'Logística', 'u1', agora); if (!p.repetida) state.agendamentos_expedicao[dados.agendaKey] = p.agenda; result = {revisao: p.agenda.revisao};
      } else if (name === 'confirmarExpedicaoPA') {
        const p = prepararSaida(state, dados, 'Logística', 'u1', agora); aplicar(p.updates); result = {numero: p.carga.numero, cargaKey: p.cargaKey};
      } else throw new Error('Callable inesperada: ' + name);
      setTimeout(() => page.evaluate((st) => { for (const [no, cbs] of Object.entries(window.listenersPA || {})) for (const cb of cbs) cb({val: () => structuredClone(st[no] || {})}); }, state).catch(() => null), 0);
      return {data: result};
    });
    await context.addInitScript((st) => {
      window.listenersPA = {};
      window.firebase = {initializeApp() {}, database() { return {ref(path) { return {path}; }}; }, functions() { return {httpsCallable(name) { return (data) => window.serverPA(name, data).catch((e) => { throw Object.assign(new Error(String(e.message || e).replace(/^.*Error: /, '')), {code: 'functions/failed-precondition'}); }); }}; }};
      window.kuryosDatabaseURL = (x) => x; window.kuryosConnectEmulatorsIfLocal = () => {};
      window.escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
      window.dbOnValue = (ref, cb) => { (window.listenersPA[ref.path] ||= []).push(cb); cb({val: () => structuredClone(st[ref.path] || {})}); };
    }, state);
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url()), name = url.pathname.slice(1);
      if (url.hostname !== 'expedicao.test' || name === 'auth_check.js' || name === 'shared/utils.js') return route.fulfill({body: '', contentType: 'text/javascript'});
      if (!fs.existsSync('public/' + name)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync('public/' + name), contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    page = await context.newPage();
    page.on('pageerror', (err) => errors.push(err.message));
    const respostasPrompt = [];
    page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? (respostasPrompt.shift() || '') : undefined));
    await page.goto('https://expedicao.test/expedicao.html');

    // ── Agendar ────────────────────────────────────────────────────────
    await page.locator('[data-palete="PA001/pa_op1_p1"]').check();
    await page.locator('#dataAgendada').fill('2026-09-20');
    await page.locator('#transportadora').fill('Transp X');
    await page.locator('#agendar').click();
    await page.waitForFunction(() => document.getElementById('resultado').textContent.includes('Carga agendada'), null, LONGO);
    const agendaKey = Object.keys(state.agendamentos_expedicao)[0];
    await page.waitForFunction(() => /Faturamento não solicitado/.test(document.getElementById('agendaPA').innerText), null, LONGO);
    assert.equal(await page.locator('#agendaPA [data-cancelar]').count(), 1, 'antes de faturar a agenda pode ser cancelada');

    // ── Solicitar faturamento ──────────────────────────────────────────
    respostasPrompt.push('Coleta às 8h');
    await page.locator('#agendaPA [data-solicitar]').click();
    await page.waitForFunction(() => /Faturamento solicitado/.test(document.getElementById('agendaPA').innerText), null, LONGO);
    const sol = Object.values(state.agendamentos_expedicao[agendaKey].faturamento.solicitacoes)[0];
    assert.equal(sol.observacoes, 'Coleta às 8h');
    assert.equal(sol.totalValor, 3540, '295 un × R$ 12,00');
    assert.equal(sol.itens[0].numeroPedidoCliente, 'PO-123');

    // ── Registrar NF ───────────────────────────────────────────────────
    await page.locator('#agendaPA [data-nf]').click();
    assert.equal(await page.locator('.agenda-nf-modal [name="valor"]').inputValue(), '3540', 'valor sugerido pela solicitação');
    await page.locator('.agenda-nf-modal [data-registrar-nf]').click();
    assert.equal(state.agendamentos_expedicao[agendaKey].faturamento.status, 'SOLICITADO', 'sem número não registra');
    await page.locator('.agenda-nf-modal [name="numero"]').fill('1500');
    await page.locator('.agenda-nf-modal [name="serie"]').fill('1');
    await page.locator('.agenda-nf-modal [data-registrar-nf]').click();
    await page.waitForFunction(() => /Faturado · NF 1500\/1/.test(document.getElementById('agendaPA').innerText), null, LONGO);
    assert.equal(await page.locator('#agendaPA [data-cancelar]').count(), 0, 'carga faturada não oferece cancelar');

    // ── 1ª viagem: parcial ─────────────────────────────────────────────
    await page.locator('#agendaPA [data-abrir]').click();
    await page.waitForFunction(() => !document.getElementById('carregamento').hidden, null, LONGO);
    assert.match(await page.locator('#agendaAtiva').innerText(), /NF 1500\/1 registrada/);
    assert.equal(await page.locator('#nf').isVisible(), false, 'NF vem da carga; campo manual some');
    await page.locator('#carregamento [data-modo="PA001/pa_op1_p1"]').selectOption('PARCIAL');
    await page.locator('#carregamento [data-caixas="PA001/pa_op1_p1"]').fill('8');
    assert.match(await page.locator('#carregamentoTotal').innerText(), /192 un carregadas · 103 un ficam aguardando embarque/);
    await page.locator('#carregamento [data-parcial="PA001/pa_op1_p1"]').check();
    assert.match(await page.locator('#carregamentoTotal').innerText(), /199 un carregadas · 96 un ficam/);
    await page.locator('#carregamento [data-parcial="PA001/pa_op1_p1"]').uncheck();
    if (process.env.CARGA_SCREENSHOT) await page.screenshot({path: process.env.CARGA_SCREENSHOT, fullPage: false, clip: {x: 0, y: (await page.locator('#formCarga').boundingBox()).y, width: 1440, height: 900}});
    await page.locator('#data').fill('2026-09-11');
    await page.locator('#salvar').click();
    await page.waitForFunction(() => /103 un ficaram aguardando embarque/.test(document.getElementById('resultado').textContent), null, LONGO);
    assert.equal(state.estoque_lotes.PA001.pa_op1_p1.saldoLote, 103);
    assert.equal(state.agendamentos_expedicao[agendaKey].status, 'EXPEDIDO_PARCIAL');
    const carga1 = Object.values(state.expedicoes_comerciais)[0];
    assert.equal(carga1.nf, '1500'); assert.equal(carga1.totalUnidades, 192);
    await page.waitForFunction(() => /Aguardando embarque: 103 un/.test(document.getElementById('agendaPA').innerText), null, LONGO);

    // ── 2ª viagem: o resto, mesma NF ───────────────────────────────────
    await page.locator('#agendaPA [data-abrir]').click();
    await page.waitForFunction(() => /viagem 2 \(mesma NF\)/.test(document.getElementById('carregamento').innerText), null, LONGO);
    assert.match(await page.locator('#carregamento').innerText(), /4 cx × 24/, 'composição que ficou');
    await page.locator('#salvar').click();
    await page.waitForFunction(() => /Saída confirmada/.test(document.getElementById('resultado').textContent) && !/ficaram/.test(document.getElementById('resultado').textContent), null, LONGO);
    assert.equal(state.estoque_lotes.PA001.pa_op1_p1.saldoLote, 0);
    assert.equal(state.agendamentos_expedicao[agendaKey].status, 'EXPEDIDO');
    const cargas = Object.values(state.expedicoes_comerciais);
    assert.equal(cargas.length, 2);
    assert.equal(cargas.find((c) => c.viagem === 2).nf, '1500');
    assert.equal(state.pedidos_comerciais['PED-001'].itens[0].expedido, 305, '10 anteriores + 295');
    await page.waitForFunction(() => /Viagem 2 \(mesma NF\)/.test(document.getElementById('lista').innerText), null, LONGO);
    assert.match(await page.locator('#lista').innerText(), /parcial · ficou 103 un/);
    assert.equal(await page.locator('#agendaPA [data-abrir]').count(), 0);

    await page.setViewportSize({width: 390, height: 844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'celular sem rolagem lateral');
    assert.deepEqual(errors, []);
    console.log('OK UI carga parcial: solicitar faturamento, registrar NF, conferência por palete (parcial por caixas), saldo aguardando embarque, 2ª viagem com a mesma NF e histórico.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
