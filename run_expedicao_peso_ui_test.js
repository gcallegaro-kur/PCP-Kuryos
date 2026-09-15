'use strict';
/* Expedição na tela: colunas de peso, painel de peso (liberado, aguardando
   Qualidade, teórico da Conferência de PA) e "Selecionar todos" respeitando
   filtros e as regras de carga do servidor. Mesmo arranjo de
   run_expedicao_ui_test.js (Firebase simulado, tela e módulos reais). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {fixture} = require('./run_expedicao_test');
const {prepararFinalizacao} = require('./functions/conferencia_pa');

const agora = '2026-09-11T18:00:00.000Z';
const clone = x => JSON.parse(JSON.stringify(x));
function aplicar(base, updates) {
  for (const [path, value] of Object.entries(updates)) {
    const partes = path.split('/'); let n = base;
    for (const p of partes.slice(0, -1)) n = n[p] || (n[p] = {});
    n[partes.at(-1)] = clone(value);
  }
}

function cenario() {
  const data = fixture(); // Cliente A: pa_op1_p1 liberado, 12 cx × 24 + parcial 7 = 295 un
  // Segundo palete liberado do Cliente A (mesma OP, mesma carga possível)
  data.estoque_lotes.PA001.pa_op1_p2 = {...clone(data.estoque_lotes.PA001.pa_op1_p1), identificadorPalete: 'PA-OP1-P2'};
  // Palete em quarentena do Cliente A: aguardando Qualidade
  data.estoque_lotes.PA001.quarentena = {...clone(data.estoque_lotes.PA001.pa_op1_p1), identificadorPalete: 'PA-QUARENTENA', status: 'QUARENTENA', qualidade: null};
  // Cliente B: OP, pedido e conferência próprios, liberado. MESMO destino e
  // frete do A de propósito: o cliente é a única diferença que barra a carga.
  const op2 = {status: 'Concluído', sku: 'PA001', lote: '26254/02', produto: 'Creme', cliente: 'Cliente B', produzidoLinha: 100, skuPedidoKey: 'PED-002__PA001', dataFimReal: agora};
  const conf2 = {qtdApontada: 100, contagens: {c1: {total: 100, contadoEm: agora, paletes: {p1: {numero: 1, caixasFechadas: 4, unidadesPorCaixa: 24, unidadesCaixaParcial: 4, qtdUnidades: 100, enderecoKey: 'A1'}}}}};
  data.ops.op2 = op2; data.conferencias_pa.op2 = conf2;
  data.pedidos['PED-002__PA001'] = {id: 'PED-002', parentPedidoId: 'PED-002', sku: 'PA001', cliente: 'Cliente B', produzido: 100};
  data.pedidos_comerciais['PED-002'] = {numeroFormatado: 'PED-002', clienteKey: 'c2', cliente: 'Cliente B', status: 'LIBERADO_PCP', frete: {tipo: 'CIF', enderecoEntrega: 'Rua A, 100'}, itens: [{sku: 'PA001', qtd: 100}]};
  aplicar(data, prepararFinalizacao({opKey: 'op2', op: op2, conf: conf2, enderecos: data.enderecos_estoque, lotesItem: data.estoque_lotes.PA001, autor: 'Conferente', agora}).updates);
  const p2 = data.estoque_lotes.PA001.pa_op2_p1;
  p2.status = 'LIBERADO_EXPEDICAO'; p2.qualidade = {decisao: 'LIBERADO_EXPEDICAO', inspecionadoPor: 'CQ', em: agora};
  // Cadastro: 5 kg/cx para PA001; SEMKG sem peso
  data.produtos = {PA001: {sku: 'PA001', descricao: 'Creme', unCx: 24, kgCaixa: 5}, SEMKG: {sku: 'SEMKG', descricao: 'Sem peso', unCx: 12}};
  // OPs produzidas sem palete: aguardam PCP / Conferência de PA
  data.ops.op3 = {status: 'Aguardando Confirmação', sku: 'PA001', lote: '26255/01', produto: 'Creme', cliente: 'Cliente A', produzidoLinha: 500, skuPedidoKey: 'PED-001__PA001', dataFimReal: agora};
  data.ops.op4 = {status: 'Concluído', sku: 'SEMKG', lote: '26255/02', produto: 'Sem peso', cliente: 'Cliente A', produzidoLinha: 100, dataFimReal: agora};
  // OP antiga, antes do corte da Conferência de PA: NÃO é pendência
  data.ops.opAntiga = {status: 'Concluído', sku: 'PA001', lote: '25001/01', produzidoLinha: 999, dataFimReal: '2026-08-01T10:00:00.000Z'};
  return data;
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1500, height: 1000}}), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const data = cenario();
    await page.addInitScript(data => {
      window.firebase = {initializeApp() {}, database() { return {ref(path) { return {path}; }}; }, functions() { return {httpsCallable() { return async () => ({data: {}}); }}; }};
      window.kuryosDatabaseURL = x => x; window.kuryosConnectEmulatorsIfLocal = () => {};
      window.escapeHtml = v => String(v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
      window.dbOnValue = (ref, cb) => cb({val: () => structuredClone(data[ref.path] || {})});
    }, data);
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'expedicao.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const name = url.pathname.slice(1);
      if (name === 'auth_check.js' || name === 'shared/utils.js') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + name;
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file), contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    await page.goto('https://expedicao.test/expedicao.html');
    await page.waitForFunction(() => document.querySelectorAll('[data-palete]').length === 4);

    // ── 1. Colunas de peso sempre visíveis, alinhadas ao cabeçalho ───────
    const ths = (await page.locator('.stock-grid thead th').allTextContents()).map(t => t.trim());
    assert.equal(ths.length, 15);
    assert.ok(ths.includes('Kg/cx') && ths.includes('Peso (kg)'));
    assert.equal(await page.locator('#paletes tr').first().locator('td').count(), 15);
    const linhaP1 = page.locator('#paletes tr', {has: page.locator('[data-palete="PA001/pa_op1_p1"]')});
    assert.match(await linhaP1.innerText(), /\b5\b[\s\S]*\b65\b[\s\S]*cadastro/, '13 volumes (12 cx + parcial) × 5 kg = 65 kg, fonte cadastro');

    // ── 2. Painel de peso ────────────────────────────────────────────────
    const painel = await page.locator('#pesoResumo').innerText();
    assert.match(painel, /Liberado para expedir\s*155 kg\s*3 palete\(s\) · 690 un/, 'A: 65 + 65; B: 5 volumes × 5 = 25');
    assert.match(painel, /Aguardando Qualidade\s*~65 kg\s*1 palete\(s\) · 295 un/);
    assert.match(painel, /Aguardando Conferência de PA · teórico\s*~105 kg · 1 sem peso\s*2 OP\(s\) · 600 un/, '500 ÷ 24 → 21 volumes × 5 kg; SEMKG sem kg/cx; OP antiga fora');
    await page.locator('#pesoResumo summary').click();
    const ops = await page.locator('#pesoResumo details tbody tr').allInnerTexts();
    assert.equal(ops.length, 2);
    assert.match(ops.join('\n'), /26255\/01[\s\S]*Aguardando confirmação do PCP[\s\S]*500[\s\S]*21[\s\S]*105/);
    assert.match(ops.join('\n'), /26255\/02[\s\S]*sem kg por caixa no cadastro do produto/);

    // ── 3. Selecionar todos sem filtro: dois clientes -> pede filtro ─────
    assert.equal(await page.locator('#selecionarTodos').innerText(), 'Selecionar todos (3)');
    await page.click('#selecionarTodos');
    assert.match(await page.locator('#resultado').innerText(), /2 clientes\. Filtre um cliente/);
    assert.equal(await page.locator('[data-palete]:checked').count(), 0, 'não pode montar carga que o servidor recusa');

    // ── 4. Filtra o Cliente A e seleciona todos ──────────────────────────
    await page.selectOption('#filtroCliente', 'Cliente A');
    assert.equal(await page.locator('#selecionarTodos').innerText(), 'Selecionar todos (2)');
    assert.match(await page.locator('#pesoResumo').innerText(), /Liberado para expedir\s*130 kg/, 'o painel segue o filtro');
    await page.click('#selecionarTodos');
    assert.equal(await page.locator('[data-palete]:checked').count(), 2);
    assert.match(await page.locator('#selecaoResumo').innerText(), /2 palete\(s\) · 590 un · 24 cx completas \+ 2 parciais · 130 kg/);
    assert.match(await page.locator('#resumo').innerText(), /Peso da carga: 130 kg/);
    assert.equal(await page.locator('#selecionarTodos').isDisabled(), true, 'nada mais a selecionar neste filtro');

    // ── 5. Tira o filtro: o Cliente B não entra na carga do A ────────────
    await page.selectOption('#filtroCliente', '');
    assert.equal(await page.locator('#selecionarTodos').innerText(), 'Selecionar todos (1)');
    await page.click('#selecionarTodos');
    assert.match(await page.locator('#resultado').innerText(), /1 palete\(s\) de outro cliente, destino ou CIF\/FOB ficaram de fora/);
    assert.equal(await page.locator('[data-palete]:checked').count(), 2, 'seleção do A intacta');

    // ── 6. Nova seleção limpa; celular continua cabendo ──────────────────
    await page.click('#limpar');
    assert.equal(await page.locator('[data-palete]:checked').count(), 0);
    assert.equal(await page.locator('#selecaoResumo').innerText(), 'Nenhum palete selecionado');
    await page.setViewportSize({width: 390, height: 844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'tela deve caber no celular');

    assert.deepEqual(errors, [], 'erros de página: ' + errors.join(' | '));
    console.log('OK UI Expedição: colunas de peso, painel liberado/Qualidade/teórico, selecionar todos com filtro e regras de carga.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
