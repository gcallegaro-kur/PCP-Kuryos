'use strict';
/* Relatório de Expedição: filtros cruzados, agrupamento, totais e CSV.
   O caso que motivou a tela, e o primeiro teste aqui, é o do usuário:
   "tudo que expedi da Afeer, do item x, y e z, entre as datas p e q". */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

// Duas cargas da Afeer (uma dentro do período pedido, outra fora), uma de
// outro cliente e uma de furto -- o suficiente para provar que cada filtro
// realmente corta, e que os totais somam só o que sobrou.
function cargas() {
  return {
    LEG_A: {legado: true, numero: 'LEG-A', nf: '1001', status: 'Expedido (legado)',
      cliente: 'AFEER OF ARABIAN', data: '2026-03-10', transportadora: 'TRANSLOG', placa: 'ABC1D23',
      itens: {
        i1: {sku: 'PRF-AFEE-0025', descricao: 'ASAD BOURBON 30ML', qtd: 600, caixasFechadas: 50,
             unidadesPorCaixa: 12, pesoTotalKg: 85, pedidoNumero: '0017', opLote: '26253/03'},
        i2: {sku: 'PRF-AFEE-0006', descricao: 'OUD NIGHT', qtd: 240, caixasFechadas: 20,
             unidadesPorCaixa: 12, pesoPorCaixaKg: 4, pedidoNumero: '0017', opLote: '26253/04'}
      }},
    LEG_B: {legado: true, numero: 'LEG-B', nf: '1002', status: 'Expedido (legado)',
      cliente: 'AFEER OF ARABIAN', data: '2026-07-22', transportadora: 'TRANSLOG',
      itens: {i1: {sku: 'PRF-AFEE-0025', descricao: 'ASAD BOURBON 30ML', qtd: 1200,
                   caixasFechadas: 100, unidadesPorCaixa: 12, pedidoNumero: '0017', opLote: '26301/01'}}},
    LEG_C: {legado: true, numero: 'LEG-C', nf: '1003', status: 'Expedido (legado)',
      cliente: 'MISS ROSE', data: '2026-03-15', transportadora: 'OUTRA',
      itens: {i1: {sku: 'HDR-MISS-0002', descricao: 'HIDRATANTE', qtd: 1776,
                   caixasFechadas: 37, unidadesPorCaixa: 48, pedidoNumero: '0023', opLote: '26244/03'}}},
    LEG_D: {legado: true, numero: 'LEG-D', status: 'Furto (legado)',
      cliente: 'AFEER OF ARABIAN', data: '2026-03-20',
      itens: {i1: {sku: 'PRF-AFEE-0025', descricao: 'ASAD BOURBON 30ML', qtd: 24, caixasFechadas: 2,
                   unidadesPorCaixa: 12, pedidoNumero: '', opLote: '26253/03',
                   vinculoPendente: true, vinculoMotivo: 'Pedido nao encontrado'}}}
  };
}

const texto = (page, sel) => page.locator(sel).innerText();

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1400, height: 1100}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(data => {
      window.fixtureRel = data;
      window.firebase = {initializeApp() {}, database() { return {ref(path) { return {path}; }}; }};
      window.kuryosDatabaseURL = x => x;
      window.kuryosConnectEmulatorsIfLocal = () => {};
      window.dbOnValue = (ref, cb) => cb({val: () => structuredClone(data)});
    }, cargas());
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'rel.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const name = url.pathname.slice(1);
      if (name === 'auth_check.js' || name === 'shared/utils.js') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + name;
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file),
        contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    await page.goto('https://rel.test/relatorio_expedicao.html');

    // ── 1. Sem filtro: tudo aparece e os totais batem ────────────────────
    // 600+240+1200+1776+24 = 3840 unidades em 5 linhas / 4 cargas.
    assert.equal(await page.locator('#corpo tr').count(), 5, 'todas as linhas sem filtro');
    assert.match(await texto(page, '#totais'), /3\.840/, 'total de unidades sem filtro');
    assert.match(await texto(page, '#totais'), /4\s*carga/i);
    assert.match(await texto(page, '#chips'), /todo o histórico/);

    // ── 2. O caso do usuário: cliente + itens + período ──────────────────
    await page.selectOption('#fCliente', ['AFEER OF ARABIAN']);
    await page.selectOption('#fSku', ['PRF-AFEE-0025', 'PRF-AFEE-0006']);
    await page.fill('#fDe', '2026-03-01');
    await page.fill('#fAte', '2026-03-31');
    // Sobram as 2 linhas da carga A (600+240) e o furto de março (24) = 864.
    assert.equal(await page.locator('#corpo tr').count(), 3, 'recorte cliente+itens+período');
    assert.match(await texto(page, '#totais'), /864/, 'soma só o que está no recorte');
    const corpo = await texto(page, '#corpo');
    assert.ok(!corpo.includes('HDR-MISS'), 'item de outro cliente não pode entrar');
    assert.ok(!corpo.includes('26301/01'), 'saída de julho está fora do período');
    assert.match(await texto(page, '#chips'), /AFEER OF ARABIAN/);

    // ── 3. Situação separa furto de expedido ─────────────────────────────
    await page.selectOption('#fStatus', ['Furto (legado)']);
    assert.equal(await page.locator('#corpo tr').count(), 1);
    assert.match(await texto(page, '#corpo'), /vínculo pendente/, 'linha sem pedido fica sinalizada');
    assert.match(await texto(page, '#totais'), /Sem pedido/i);
    await page.selectOption('#fStatus', []);

    // ── 4. Peso: soma o informado e deriva do kg/cx quando só ele existe ─
    // Carga A: 85 kg do item 1 + 20 caixas x 4 kg = 80 do item 2 = 165.
    await page.selectOption('#fStatus', ['Expedido (legado)']);
    assert.match(await texto(page, '#totais'), /165/, 'peso derivado de kg por caixa');
    await page.selectOption('#fStatus', []);

    // ── 5. Agrupar por item, com totais por grupo ────────────────────────
    await page.selectOption('#fAgrupar', 'sku');
    assert.match(await texto(page, '#tituloTabela'), /agrupado por item/i);
    const agrupado = await texto(page, '#corpo');
    assert.match(agrupado, /ASAD BOURBON/);
    assert.match(agrupado, /624/, 'ASAD soma 600 expedido + 24 de furto no período');
    assert.equal(await page.locator('#corpo tr').count(), 2, 'dois itens no recorte');

    // ── 6. Ordenação por clique no cabeçalho ─────────────────────────────
    await page.locator('#cabecalho th[data-campo="unidades"]').click();
    const primeira = await page.locator('#corpo tr').first().innerText();
    assert.match(primeira, /ASAD BOURBON/, 'maior volume primeiro ao ordenar desc');

    // ── 7. Limpar devolve o recorte inteiro ──────────────────────────────
    await page.locator('#btnLimpar').click();
    assert.equal(await page.locator('#corpo tr').count(), 5);
    assert.match(await texto(page, '#totais'), /3\.840/);

    // ── 8. CSV sai no formato que o Excel pt-BR abre direto ──────────────
    await page.fill('#fLivre', 'afeer');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#btnCsv').click()
    ]);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    assert.ok(csv.charCodeAt(0) === 0xFEFF, 'BOM para o Excel não quebrar acento');
    assert.ok(csv.split('\r\n')[0].includes(';'), 'separador ; para o Excel pt-BR');
    assert.ok(!/HDR-MISS/.test(csv), 'o CSV exporta o recorte filtrado, não tudo');
    assert.ok(/PRF-AFEE-0025/.test(csv));
    assert.match(download.suggestedFilename(), /^expedicao_\d{4}-\d{2}-\d{2}\.csv$/);

    // ── 9. Busca sem acento e sem caixa ──────────────────────────────────
    await page.locator('#btnLimpar').click();
    await page.fill('#fLivre', 'AFEER');
    const comMaiuscula = await page.locator('#corpo tr').count();
    await page.fill('#fLivre', 'afeer');
    assert.equal(await page.locator('#corpo tr').count(), comMaiuscula, 'busca ignora caixa');
    assert.equal(comMaiuscula, 4, 'as 4 linhas da Afeer');

    // ── 10. Celular: a tela continua utilizável ──────────────────────────
    await page.setViewportSize({width: 390, height: 844});
    assert.ok(await page.locator('#fCliente').isVisible(), 'filtros visíveis no celular');
    assert.ok(await page.locator('#totais').isVisible());

    assert.deepEqual(errors, [], 'nenhum erro de página');
    console.log('OK Relatório de Expedição: filtros cruzados, período, agrupamento, totais, peso, ordenação, CSV e celular.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
