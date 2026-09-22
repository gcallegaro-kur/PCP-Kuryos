'use strict';
/* Pedidos: colunas Expedido e Conferência (Produzido = Expedido + Em estoque)
   nas duas tabelas. Carrega a tela de verdade, com utils.js e auth_check.js
   reais e um Firebase simulado fiel ao SDK (database() só depois de
   initializeApp; on('value') entrega snapshot por caminho). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    'usuarios/u1': {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'},
    pedidos: {
      '0019__GLMKAM04': {id: '0019', produto: 'GLOW MICELAR', qtdTotal: 1000, produzido: 1000, parentPedidoId: '0019', linha: 'Linha 1'},
      '0017__PRF-AFEE-0014': {id: '0017', produto: 'ZAFIYR 30ML', qtdTotal: 3000, produzido: 2916, parentPedidoId: '0017', linha: 'Linha 2'},
      '0017__NADA': {id: '0017', produto: 'ITEM SEM SAIDA', qtdTotal: 1000, produzido: 500, parentPedidoId: '0017', linha: 'Linha 2'},
      '0021__DIV': {id: '0021', produto: 'ITEM DIVERGENTE', qtdTotal: 200, produzido: 100, parentPedidoId: '0021', linha: 'Linha 1'}
    },
    pedidos_comerciais: {
      '0019': {cliente: 'GLOW MAKE UP', dataPedido: '2026-08-01', total_qtd: 1000, itens: [{sku: 'GLMKAM04', descricao: 'GLOW MICELAR', qtd: 1000}]},
      '0017': {cliente: 'AFEER', dataPedido: '2026-08-02', total_qtd: 4000,
        itens: [{sku: 'PRF-AFEE-0014', descricao: 'ZAFIYR 30ML', qtd: 3000}, {sku: 'NADA', descricao: 'ITEM SEM SAIDA', qtd: 1000}]},
      '0021': {cliente: 'OUTRO', dataPedido: '2026-08-03', total_qtd: 200, itens: [{sku: 'DIV', descricao: 'ITEM DIVERGENTE', qtd: 200}]}
    },
    ops: {
      // Duas OPs do mesmo item: é o que a quebra por OP tem que separar.
      '26244-16': {skuPedidoKey: '19__GLMKAM04', lote: '26244/16', produzido: 750},
      '26244-17': {skuPedidoKey: '19__GLMKAM04', lote: '26244/17', produzido: 250},
      '26251-15': {skuPedidoKey: '17__PRF-AFEE-0014', lote: '26251/15', produzido: 2916}
    },
    expedicoes_comerciais: {
      LEG_1: {legado: true, tipoLegado: 'EXPEDIDO', itens: {a: {qtd: 750, pedidoKey: '0019__GLMKAM04', opKey: '26244-16', opLote: '26244/16'}}},
      LEG_2: {legado: true, tipoLegado: 'FURTO', itens: {a: {qtd: 50, skuPedidoKey: '19__GLMKAM04', opKey: '26244-17', opLote: '26244/17'}}},
      LEG_3: {legado: true, tipoLegado: 'EXPEDIDO', itens: {a: {qtd: 1020, pedidoKey: '0017__PRF-AFEE-0014', opKey: '26251-15', opLote: '26251/15'}}},
      LEG_4: {legado: true, tipoLegado: 'EXPEDIDO', itens: {a: {qtd: 90, pedidoKey: '0021__DIV'}}}
    },
    estoque_lotes: {
      GLMKAM04: {p1: {itemTipo: 'produto', saldoLote: 200, opKey: '26244-17', opLote: '26244/17'}},
      'PRF-AFEE-0014': {pa: {itemTipo: 'produto', saldoLote: 1895, opKey: '26251-15', opLote: '26251/15'}}
    },
    conferencias_pa: {'26251-15': {finalizadoEm: '2026-09-15T01:20:02Z', opLote: '26251/15', rncNumero: 'RNC-PA-26251-15',
      conciliacao: {diferenca: -1, motivo: 'PERDA_OU_AVARIA'}}},
    solicitacoes_descarte: {}
  };
}

async function abrir(browser, opts) {
  const page = await browser.newPage({viewport: {width: 1700, height: 1200}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({data, segurar}) => {
    window.__iniciado = false;
    const exige = q => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
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
          const snap = {val: () => (path in data ? structuredClone(data[path]) : null)};
          return {path,
            once(ev, cb) { if (cb) cb(snap); return Promise.resolve(snap); },
            on(ev, cb) { if (segurar && path === segurar) return cb; setTimeout(() => cb(snap), 0); return cb; },
            off() {}, child() { return this; }, orderByChild() { return this; }, equalTo() { return this; },
            set() { return Promise.resolve(); }, update() { return Promise.resolve(); }, remove() { return Promise.resolve(); }};
        }};
      }
    };
  }, {data: dados(), segurar: (opts || {}).segurar || null});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'ped.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://ped.test/pedidos.html');
  await page.waitForSelector('.kt-sidebar', {timeout: 8000});
  return {page, errors};
}

const linha = (page, texto) => page.locator('#tableBody tr', {hasText: texto});

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser);
    await page.selectOption('#filterStatus', '');
    await page.waitForFunction(() => document.querySelector('#tableBody') && /OK|Diferença/.test(document.querySelector('#tableBody').innerText), null, {timeout: 8000});

    // ── 0. Cabeçalho e colspans casam ──────────────────────────────────
    const ths = (await page.locator('#tabPanelOps thead th').allTextContents()).map(t => t.trim());
    assert.ok(ths.includes('Expedido') && ths.includes('Conferência'), 'colunas novas no cabeçalho: ' + ths.join('|'));
    assert.equal(ths.length, 15, 'a tabela por SKU tem 15 colunas');
    assert.equal(await page.locator('#tableBody tr').first().locator('td').count(), 15, 'linha com o mesmo número de colunas do cabeçalho');

    // ── 1. OK exato, com expedido de fato + furto e estoque no WMS ─────
    const glow = linha(page, 'GLOW MICELAR');
    assert.match(await glow.innerText(), /800 \/ 1\.000/, 'expedido = 750 de fato + 50 furto');
    assert.match(await glow.innerText(), /80%/);
    assert.match(await glow.innerText(), /✓ OK\b/);
    assert.match(await glow.innerText(), /Em estoque: 200/);
    const tituloExp = await glow.locator('td .prog-wrap[title]').last().getAttribute('title');
    assert.match(tituloExp, /Furto: 50/, 'hover do expedido abre os motivos');

    // ── 2. Divergência apontada pela Logística fecha a conta ───────────
    const zaf = linha(page, 'ZAFIYR 30ML');
    assert.match(await zaf.innerText(), /✓ OK · divergência apontada/);
    const tituloConf = await zaf.locator('.badge[title]').last().getAttribute('title');
    assert.match(tituloConf, /Apontado na Conferência \(OP 26251\/15\): -1 · PERDA_OU_AVARIA/);
    assert.match(tituloConf, /Expedido \+ Em estoque: 2\.915/);

    // ── 3. Sem registro é cinza; divergente é vermelho com a diferença ──
    const nada = linha(page, 'ITEM SEM SAIDA');
    assert.match(await nada.innerText(), /Sem registro de saída/);
    assert.equal(await nada.locator('.badge-gray', {hasText: 'Sem registro'}).count(), 1);
    const div = linha(page, 'ITEM DIVERGENTE');
    assert.match(await div.innerText(), /⚠ Diferença -10/);
    assert.equal(await div.locator('.badge-red', {hasText: 'Diferença'}).count(), 1);

    // ── 4. Filtro da conferência ────────────────────────────────────────
    await page.selectOption('#filterConferencia', 'SEM_REGISTRO');
    assert.equal(await page.locator('#tableBody tr').count(), 1);
    await page.selectOption('#filterConferencia', 'DIVERGENTE');
    assert.equal(await page.locator('#tableBody tr').count(), 1);
    assert.match(await page.locator('#tableBody tr').first().innerText(), /ITEM DIVERGENTE/);
    await page.selectOption('#filterConferencia', '');

    // ── 5. Ordenar pela conferência põe o que pede atenção no topo ──────
    await page.click('#tabPanelOps thead th[data-col="conferencia"]');
    assert.match(await page.locator('#tableBody tr').first().innerText(), /ITEM DIVERGENTE/);

    // ── 6. Agrupado por linha: cabeçalho de grupo cobre todas as colunas ─
    await page.selectOption('#groupBySel', 'linha');
    assert.equal(await page.locator('#tableBody tr.group-header td').first().getAttribute('colspan'), '15');
    await page.selectOption('#groupBySel', '');

    // ── 7. Pedidos Comerciais: soma dos itens, situação do pior item ────
    await page.evaluate(() => switchPedidosTab('comerciais'));
    await page.selectOption('#filterStatusComercial', '');
    const thsPc = await page.locator('#tabPanelComerciais thead th').allInnerTexts();
    assert.equal(thsPc.length, 10);
    assert.equal(await page.locator('#pcTableBody tr').first().locator('td').count(), 10);
    const pc17 = page.locator('#pcTableBody tr', {hasText: '#0017'});
    assert.match(await pc17.innerText(), /1\.020 \/ 4\.000/);
    assert.match(await pc17.innerText(), /Sem registro de saída/, 'um item OK e outro sem registro: vale o pior');
    assert.match(await pc17.innerText(), /Em estoque: 1\.895/);
    assert.match(await page.locator('#pcTableBody tr', {hasText: '#0019'}).innerText(), /✓ OK\b/);
    assert.match(await page.locator('#pcTableBody tr', {hasText: '#0021'}).innerText(), /⚠ Diferença -10/);

    // ── 8. Detalhe OP por OP (pedido do usuário em 22/09) ──────────────
    // No pedido comercial agregado: abre pela célula de conferência.
    await page.click('#pcTableBody tr:has-text("#0019") [data-op-det]');
    await page.waitForSelector('#modalOpBg.open');
    assert.match(await page.locator('#modalOpTitle').innerText(), /OP por OP — Pedido #0019/);
    let corpo = await page.locator('#modalOpBody').innerText();
    assert.match(corpo, /26244\/17[\s\S]*26244\/16/, 'lote mais novo primeiro');
    assert.match(corpo, /Total do pedido/);
    await page.click('#modalOpClose');
    await page.waitForSelector('#modalOpBg.open', {state: 'detached'}).catch(() => null);

    // Na tabela por SKU: a mesma conta, linha a linha.
    await page.evaluate(() => switchPedidosTab('ops'));
    await page.click('#tableBody tr:has-text("GLOW MICELAR") [data-op-det]');
    await page.waitForSelector('#modalOpBg.open');
    const linhasOp = await page.locator('#modalOpBody tbody tr').allInnerTexts();
    assert.equal(linhasOp.length, 3, 'duas OPs + o total');
    assert.match(linhasOp[0], /26244\/17/);
    assert.match(linhasOp[0], /250/, 'produzido da OP');
    assert.match(linhasOp[0], /Furto 50/, 'o motivo da saída acompanha a OP');
    assert.match(linhasOp[0], /200/, 'em estoque nesta OP');
    assert.match(linhasOp[0], /OK/);
    assert.match(linhasOp[1], /26244\/16[\s\S]*750/);
    assert.match(linhasOp[2], /Total do pedido[\s\S]*1\.000[\s\S]*800[\s\S]*200/);
    assert.doesNotMatch(await page.locator('#modalOpBody').innerText(), /não estão atribuídas/, 'as OPs explicam todo o produzido');
    await page.click('#modalOpClose');

    // A OP com divergência apontada mostra a RNC na própria linha.
    await page.click('#tableBody tr:has-text("ZAFIYR 30ML") [data-op-det]');
    await page.waitForSelector('#modalOpBg.open');
    corpo = await page.locator('#modalOpBody').innerText();
    assert.match(corpo, /26251\/15/);
    assert.match(corpo, /Conferência apontou -1 · PERDA_OU_AVARIA · RNC-PA-26251-15/);
    await page.click('#modalOpClose');

    // Saída que não diz de qual OP veio não some: aparece como "sem OP".
    await page.click('#tableBody tr:has-text("ITEM DIVERGENTE") [data-op-det]');
    await page.waitForSelector('#modalOpBg.open');
    corpo = await page.locator('#modalOpBody').innerText();
    assert.match(corpo, /Sem OP identificada/);
    assert.match(corpo, /saída sem OP registrada/);
    assert.match(corpo, /não estão atribuídas a nenhuma OP/, 'avisa o produzido que nenhuma OP explica');
    await page.click('#modalOpClose');

    assert.deepEqual(errors, [], 'erros de página: ' + errors.join(' | '));
    await page.close();

    // ── 8. Fonte que ainda não chegou: "carregando", nunca zero ─────────
    const lento = await abrir(browser, {segurar: 'solicitacoes_descarte'});
    await lento.page.selectOption('#filterStatus', '');
    await lento.page.waitForFunction(() => /GLOW MICELAR/.test(document.querySelector('#tableBody').innerText));
    const txt = await linha(lento.page, 'GLOW MICELAR').innerText();
    assert.match(txt, /carregando…/);
    assert.doesNotMatch(txt, /Sem registro|Diferença/, 'sem todas as fontes não pode acusar nada');
    assert.deepEqual(lento.errors, []);

    console.log('OK Pedidos: Expedido e Conferência nas duas tabelas, detalhe OP por OP com motivo/estoque/RNC, filtro, ordenação, agrupamento e carregamento.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
