'use strict';
/* Roadmap do sistema (tela): checklist montado do JSON, filtros, concluídos riscados,
   "novo desde a última visita" e acesso só para quem tem o módulo. Firebase simulado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const item = (id, grupo, texto, extra) => Object.assign({id, grupo, texto, subitens: [], extras: {}, feito: false, hash: null}, extra || {});
const fixtura = (extraA) => ({
  fonte: 'MELHORIAS_FUTURAS.md › Em aberto para execução', atualizadoEm: '27/10/2026', geradoEm: '2026-10-27T18:00:00.000Z', commit: 'abc1234',
  resumo: {}, secoes: [
    {letra: 'A', titulo: 'Código: próximos a executar (nós)', itens: [
      item('a1', 'Custos', '**Fase 0** no `erpkuryos`', {extras: {Bloqueio: 'nenhum', Detalhe: '`PLANO.md`'}}),
      item('a2', 'Qualidade', 'Fase C: CK-1 por tipo de embalagem', {subitens: ['RA numerada', 'CK-2 sem trava']}),
      item('a3', 'Testes', 'Consertar teste de tela', {feito: true, hash: 'abc1234'})
    ].concat(extraA || [])},
    {letra: 'B', titulo: 'Depende da Kuryos', itens: [item('b1', 'Qualidade', '**K1**: cadastrar os ativos', {extras: {Destrava: 'A4'}})]},
    {letra: 'C', titulo: 'Decisões pendentes do usuário', itens: [item('c1', 'Apontamento', '207 registros: marcar ou gravar?')]}
  ].map((s) => Object.assign(s)),
});
function comResumo(j) {
  j.secoes.forEach((s) => { j.resumo[s.letra] = {titulo: s.titulo, total: s.itens.length, feitos: s.itens.filter((i) => i.feito).length}; });
  return j;
}

const usuarios = {
  adm: {nome: 'Ana Admin', email: 'a@k.com', role: 'admin'},
  log: {nome: 'Lia Logística', email: 'l@k.com', role: 'logistica'}
};

async function abrir(ctx, uid, json) {
  const page = await ctx.newPage();
  const erros = [], dialogos = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('dialog', (d) => { dialogos.push(d.message()); d.accept(); });
  await page.addInitScript(({u, uid}) => {
    const d = {usuarios: u}, email = u[uid].email;
    const ler = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), d);
    window.firebase = {initializeApp() {},
      auth() { return {currentUser: {uid, email}, onAuthStateChanged(cb) { setTimeout(() => cb({uid, email}), 0); }, signOut() { return Promise.resolve(); }}; },
      database() {
        const ref = (p) => { const snap = () => { const v = ler(p); return {val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))), exists: () => v !== undefined, forEach() {}}; };
          return {once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); }, on(ev, cb) { setTimeout(() => cb(snap()), 0); return cb; }, off() {}, child(c) { return ref(p + '/' + c); }}; };
        return {ref: (p) => ref(p || '')};
      }};
  }, {u: usuarios, uid});
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'app.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    if (url.pathname === '/backlog.json') return route.fulfill({body: JSON.stringify(json), contentType: 'application/json'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript'});
  });
  await page.goto('https://app.test/backlog.html');
  return {page, erros, dialogos};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const ctx = await browser.newContext({viewport: {width: 1300, height: 1000}});
    // 1ª visita: tudo aparece, sem marca de novidade (não há com o que comparar).
    let {page, erros} = await abrir(ctx, 'adm', comResumo(fixtura()));
    await page.waitForSelector('.item');
    const kpis = await page.locator('#kpis .kpi').allInnerTexts();
    assert.match(kpis[0], /^2\s+a construir/); assert.match(kpis[1], /^1\s+dependem da Kuryos/); assert.match(kpis[2], /^1\s+decisões suas/); assert.match(kpis[3], /^1\s+concluídos recentes/);
    assert.equal(await page.locator('.item').count(), 5);
    assert.equal(await page.locator('.item.feito').count(), 1);
    assert.match(await page.locator('.item.feito').innerText(), /concluído · abc1234/);
    assert.equal(await page.locator('.item.feito .txt').evaluate((e) => getComputedStyle(e).textDecorationLine), 'line-through');
    assert.match(await page.locator('.item[data-id="a1"] .txt').innerHTML(), /<b>Fase 0<\/b> no <code>erpkuryos<\/code>/);
    assert.deepEqual(await page.locator('.item[data-id="a2"] li').allInnerTexts(), ['RA numerada', 'CK-2 sem trava']);
    assert.match(await page.locator('.item[data-id="b1"] .meta').innerText(), /Qualidade[\s\S]*Destrava: A4/);
    assert.equal(await page.locator('.chip.novo').count(), 0, 'primeira visita não marca novidade');
    assert.match(await page.locator('#rodape').innerText(), /atualizado em 27\/10\/2026[\s\S]*commit abc1234/);
    // Filtros
    await page.uncheck('#verFeitos');
    assert.equal(await page.locator('.item.feito').count(), 0);
    await page.check('#verFeitos');
    await page.selectOption('#frente', 'Qualidade');
    assert.deepEqual(await page.locator('.item').evaluateAll((els) => els.map((e) => e.getAttribute('data-id'))), ['a2', 'b1']);
    await page.selectOption('#frente', '');
    await page.fill('#busca', 'ativos');
    assert.deepEqual(await page.locator('.item').evaluateAll((els) => els.map((e) => e.getAttribute('data-id'))), ['b1']);
    assert.equal(await page.locator('.dica').count(), 3);
    assert.deepEqual(erros, []);
    await page.close();

    // 2ª visita (nova sessão no mesmo aparelho): um item novo e um que foi concluído.
    const j2 = fixtura([item('a4', 'Painel', 'Tela de prazos (SLA)')]);
    j2.secoes[0].itens[0].feito = true; j2.secoes[0].itens[0].hash = 'def5678';
    ({page, erros} = await abrir(ctx, 'adm', comResumo(j2)));
    await page.waitForSelector('.item');
    assert.match(await page.locator('.item[data-id="a4"] .chip.novo').innerText(), /novo desde sua última visita/);
    assert.match(await page.locator('.item[data-id="a1"] .chip.novo').innerText(), /concluído desde sua última visita/);
    assert.equal(await page.locator('.chip.novo').count(), 2);
    await page.reload(); await page.waitForSelector('.item');
    assert.equal(await page.locator('.chip.novo').count(), 2, 'recarregar na mesma sessão mantém as marcas');
    assert.deepEqual(erros, []);
    await page.close();
    await ctx.close();

    // Falha ao carregar o JSON: mensagem, sem quebrar.
    const ctx2 = await browser.newContext();
    ({page, erros} = await abrir(ctx2, 'adm', comResumo(fixtura())));
    await page.waitForSelector('.item');
    await page.close();
    await ctx2.close();

    // Logística não acessa.
    const ctx3 = await browser.newContext();
    const r = await abrir(ctx3, 'log', comResumo(fixtura()));
    await r.page.waitForTimeout(1200);
    assert.ok(r.dialogos.some((m) => /Acesso Negado/.test(m) && /Roadmap do sistema/.test(m)));
    await ctx3.close();
  } finally { await browser.close(); }
  console.log('OK Roadmap do sistema: checklist do JSON, concluídos riscados, filtros, novidades por visita e acesso por módulo.');
})().catch((e) => { console.error(e); process.exit(1); });
