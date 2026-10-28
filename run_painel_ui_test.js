'use strict';
/* Painel de Controle (tela): KPIs, cobrança por setor, etapas com itens, cópia da cobrança
   e acesso só para quem tem o módulo. Firebase simulado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const antes = (h) => new Date(Date.now() - h * 3600000).toISOString();
const dados = () => ({
  usuarios: {
    adm: {nome: 'Ana Admin', email: 'a@k.com', role: 'admin'},
    log: {nome: 'Lia Logística', email: 'l@k.com', role: 'logistica'},
    dir: {nome: 'Dino Diretor', email: 'd@k.com', role: 'gestor', modulos: {painel: true}}
  },
  config: {},
  ops: {
    'B-1': {status: 'Programado', lote: 'B/01', produto: 'Beta', qtdPlanejada: 100, formulaVersao: 'F1__v1', separacaoConcluida: true,
      manipulacao: {status: 'PESADO', pesagem: {fim: antes(6)}}},
    'E-1': {status: 'Programado', lote: 'E/01', produto: 'Eta', qtdPlanejada: 100, formulaVersao: 'F1__v1', separacaoConcluida: true,
      manipulacao: {status: 'AGUARDANDO_CQ', manipulacao: {fim: antes(50)}}},
    'C-1': {status: 'Programado', lote: 'C/01', produto: 'Gama', qtdPlanejada: 100, formulaVersao: 'F1__v1', separacaoConcluida: true,
      manipulacao: {status: 'CONFERIDO', conferencia: {em: antes(2)}}}
  },
  conferencias_pa: {}, agendamentos_expedicao: {}, nao_conformidades: {n1: {status: 'ABERTA', numero: 'RNC-1', criadoEm: antes(100)}},
  solicitacoes_compra: {}, pedidos_compra: {}, devolucoes_cliente: {}, solicitacoes_descarte: {},
  pedidos: {'P1__SKU1': {id: 'P1', produto: 'Body Splash', cliente: 'Miss Rose', qtdTotal: 1000, produzido: 960, ultimoApontamento: antes(24 * 10)}}
});

async function abrir(browser, uid) {
  const page = await browser.newPage({viewport: {width: 1400, height: 1000}});
  const erros = [], dialogos = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('dialog', (d) => { dialogos.push(d.message()); d.accept(); });
  await page.addInitScript(({d, uid}) => {
    const ler = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), d);
    const email = d.usuarios[uid].email;
    window.__copiado = null;
    Object.defineProperty(navigator, 'clipboard', {value: {writeText(t) { window.__copiado = t; return Promise.resolve(); }}, configurable: true});
    window.firebase = {initializeApp() {},
      auth() { return {currentUser: {uid, email}, onAuthStateChanged(cb) { setTimeout(() => cb({uid, email}), 0); }, signOut() { return Promise.resolve(); }}; },
      database() {
        const ref = (p) => {
          const snap = () => { const v = ler(p); return {val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))), exists: () => v !== undefined, forEach() {}}; };
          return {once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); }, on(ev, cb) { setTimeout(() => cb(snap()), 0); return cb; }, off() {}, child(c) { return ref(p + '/' + c); },
            set() { return Promise.resolve(); }, update() { return Promise.resolve(); }, push() { return Promise.resolve(); }, transaction() { return Promise.resolve({}); }};
        };
        return {ref: (p) => ref(p || '')};
      }};
  }, {d: dados(), uid});
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'app.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript'});
  });
  await page.goto('https://app.test/painel.html');
  return {page, erros, dialogos};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // Admin: números, setores, etapas e cobrança.
    let {page, erros} = await abrir(browser, 'adm');
    await page.waitForSelector('#fases details.etapa');
    const kpis = await page.locator('#kpis .kpi').allInnerTexts();
    assert.match(kpis[0], /^4\s+itens atrasados/, 'conferência de pesagem + CQ do bulk + RNC + pedido pronto parado');
    assert.match(kpis[1], /^1\s+etapas críticas/, 'CQ do bulk há 50h, prazo 24h');
    assert.match(kpis[2], /^5\s+itens em fila/);
    const setores = await page.locator('#setores .setor h3').allInnerTexts();
    assert.equal(setores[0], 'Qualidade', 'o setor com mais atraso vem primeiro');
    assert.equal(await page.locator('#setores .setor').first().evaluate((e) => e.classList.contains('quente')), true);
    assert.equal(await page.locator('[data-cobrar="Manipulação"]').isDisabled(), true, 'sem atraso, sem cobrança');
    // Comercial: o pedido pronto para encerrar aparece e dá para cobrar.
    assert.ok(setores.includes('Comercial'));
    await page.locator('details.etapa[data-id="pedido_encerrar"] summary').click();
    assert.match(await page.locator('details.etapa[data-id="pedido_encerrar"] .itens').innerText(), /P1 — Body Splash \(Miss Rose\)[\s\S]*96% produzido \(960 de 1000 un\)|P1 — Body Splash \(Miss Rose\)[\s\S]*10 dias/);
    assert.equal(await page.locator('details.etapa[data-id="pedido_encerrar"] .abrir').getAttribute('href'), 'pedidos.html');
    // Etapas vazias ficam ocultas até pedir.
    assert.equal(await page.locator('details.etapa[data-id="rotulagem"]').count(), 0);
    await page.check('#verVazias');
    assert.equal(await page.locator('details.etapa[data-id="rotulagem"]').count(), 1);
    await page.uncheck('#verVazias');
    // Abrir uma etapa mostra os itens, e a escolha sobrevive a uma atualização.
    await page.locator('details.etapa[data-id="cq_granel"] summary').click();
    assert.match(await page.locator('details.etapa[data-id="cq_granel"] .itens').innerText(), /E\/01 — Eta[\s\S]*passou do prazo de 24h[\s\S]*2 dias/);
    assert.equal(await page.locator('details.etapa[data-id="cq_granel"] .abrir').getAttribute('href'), 'qualidade.html?tab=fila');
    await page.check('#verVazias'); await page.uncheck('#verVazias');
    assert.equal(await page.locator('details.etapa[data-id="cq_granel"]').evaluate((e) => e.open), true, 'etapa aberta continua aberta');
    if (process.env.PAINEL_SCREENSHOT) await page.screenshot({path: process.env.PAINEL_SCREENSHOT, fullPage: true});
    // Cobrança copiada.
    await page.locator('[data-cobrar="Qualidade"]').click();
    await page.waitForFunction(() => window.__copiado);
    const texto = await page.evaluate(() => window.__copiado);
    assert.match(texto, /^Pendências fora do prazo — Qualidade \(3\):/);
    assert.match(texto, /Bulk aguardando análise \(1\):\n {3}- E\/01 — Eta — há 2 dias/);
    assert.match(texto, /RNC-1/);
    assert.match(await page.locator('[data-cobrar="Qualidade"]').innerText(), /Copiado/);
    assert.equal(await page.locator('#unified-navbar a[href="painel.html"]').count(), 1, 'link no menu para quem tem o módulo');
    assert.deepEqual(erros, []);
    await page.close();

    // Quem recebeu o módulo vê; Logística não.
    ({page, erros} = await abrir(browser, 'dir'));
    await page.waitForSelector('#fases details.etapa');
    await page.close();
    let r = await abrir(browser, 'log');
    await r.page.waitForTimeout(1200);
    assert.ok(r.dialogos.some((m) => /Acesso Negado/.test(m) && /Painel de Controle/.test(m)), 'Logística recebe Acesso Negado citando o módulo');
    await r.page.close();
  } finally { await browser.close(); }
  console.log('OK Painel de Controle: KPIs, setores por atraso, etapas com itens, cobrança copiada e acesso por módulo.');
})().catch((e) => { console.error(e); process.exit(1); });
