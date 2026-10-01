'use strict';
/* Kardex de estoque (01/10), na tela real: busca de item (material,
   produto e intermediário sem cadastro), saldo corrido que termina no saldo do
   sistema, linhas que não mudam o saldo em cinza, saldo sem movimento
   registrado, implantação de lote da planilha, filtro de período, CSV,
   conciliação e celular sem rolagem lateral. Firebase simulado em memória. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const H = (s) => new Date(s + '-03:00').toISOString();

function dados() {
  return {
    usuarios: {pcp: {nome: 'Gustavo', email: 'pcp@kuryos.com', role: 'pcp'}},
    config: {linhas: ['Linha 1']},
    materiais: {m1: {mpCodigo: 'EP-00095', mpNome: 'FRASCO 120ML', tipo: 'EP', unidade: 'un'}, m2: {mpCodigo: 'EP-00051', mpNome: 'TAMPA', tipo: 'EP', unidade: 'un'}},
    produtos: {p1: {sku: 'GLMKAM01', descricao: 'ÁGUA MICELAR'}},
    enderecos_estoque: {e1: {codigo: 'MP-A-01'}, e2: {codigo: 'PA-B-02'}},
    estoque: {
      'EP-00095': {materialCodigo: 'EP-00095', saldoAtual: 4100, unidade: 'un'},
      'EP-00051': {materialCodigo: 'EP-00051', saldoAtual: -377, unidade: 'un'}
    },
    estoque_lotes: {
      'EP-00095': {L1: {itemTipo: 'material', itemCodigo: 'EP-00095', loteInterno: 'FR-1', saldoLote: 4100, enderecoKey: 'e1', status: 'LIBERADO'}},
      'GLMKAM01': {
        LEG: {itemTipo: 'produto', itemCodigo: 'GLMKAM01', origemTipo: 'legado_planilha', loteInterno: '26200/01', saldoLote: 1000, enderecoKey: 'e2', status: 'LIBERADO'},
        N1: {itemTipo: 'produto', itemCodigo: 'GLMKAM01', origemTipo: 'conferencia_pa', loteInterno: '26247/06', saldoLote: 1661, enderecoKey: 'e2', status: 'LIBERADO'}
      },
      'BULK-26270-01': {B1: {itemTipo: 'intermediario', itemCodigo: 'BULK-26270/01', itemNome: 'BULK BODY SPLASH', unidade: 'kg', saldoLote: 480}}
    },
    bombonas_bulk: {'BB-0007': {codigo: 'BB-0007', tipo: 'BOMBONA', conteudo: {lote: '26280/01', produto: 'BODY SPLASH IDOLA', kg: 120}, historico: {
      h1: {tipo: 'ENCHER', kgAntes: 0, kgDepois: 200, lote: '26280/01', opKey: '26280-01', origem: 'MANIPULACAO', por: 'Léo', em: H('2026-09-30T15:00')},
      h2: {tipo: 'AJUSTE', kgAntes: 200, kgDepois: 120, lote: '26280/01', motivo: 'retirada para envase', por: 'Léo', em: H('2026-10-01T08:00')}}}},
    material_processo: {},
    contagens_inventario: {c1: {enderecoKey: 'e1', enderecoCodigo: 'MP-A-01', contadoEm: H('2026-09-30T17:00'), contadoPor: 'Lia', ajusteAplicado: false,
      linhas: [{itemCodigo: 'EP-00095', saldoEsperado: 4100, qtdContada: 4100, diferenca: 0, tipo: 'ok'}]}},
    movimentos_estoque: {
      'EP-00095': {
        a: {tipo: 'recebimento_pc', motivo: 'RECEBIMENTO', qtd: 5000, saldoApos: null, ref: 'PC-0012', loteKey: 'L1', enderecoKey: 'e1', itemTipo: 'material', itemCodigo: 'EP-00095', autor: 'Ana', em: H('2026-09-10T08:00')},
        b: {tipo: 'consumo_producao', motivo: 'CONSUMO DE PRODUÇÃO', qtd: -1000, saldoApos: 4000, ref: '26271/02', itemTipo: 'material', itemCodigo: 'EP-00095', em: H('2026-09-20T10:00')},
        c: {tipo: 'consumo', motivo: 'CONSUMO DE PRODUÇÃO', qtd: -1000, saldoApos: 4000, ref: '26271/02', loteKey: 'L1', itemTipo: 'material', itemCodigo: 'EP-00095', em: H('2026-09-20T10:00')},
        d: {tipo: 'transferencia', motivo: 'TRANSFERÊNCIA ENTRE ENDEREÇOS', qtd: 300, saldoApos: null, ref: 'e1 -> e2', loteKey: 'L1', itemTipo: 'material', itemCodigo: 'EP-00095', em: H('2026-09-25T10:00')},
        e: {tipo: 'ajuste_manual', motivo: 'AJUSTE DE INVENTÁRIO', qtd: 100, saldoApos: 4100, ref: 'contagem', itemTipo: 'material', itemCodigo: 'EP-00095', autor: 'Gustavo', em: H('2026-09-30T16:00')}
      },
      'GLMKAM01': {
        x: {tipo: 'conferencia_pa', motivo: 'ENTRADA PA CONFERIDA E ENDEREÇADA', qtd: 1661, loteKey: 'N1', itemTipo: 'produto', itemCodigo: 'GLMKAM01', em: H('2026-09-29T10:00')},
        y: {tipo: 'expedicao_pa', motivo: 'SAÍDA DE PA POR PALETE', qtd: -200, loteKey: 'LEG', itemTipo: 'produto', itemCodigo: 'GLMKAM01', ref: 'carga-7', em: H('2026-09-30T10:00')}
      },
      'BULK-26270-01': {
        i: {tipo: 'producao_intermediario', motivo: 'BULK FECHADO', qtd: 480, itemTipo: 'intermediario', itemCodigo: 'BULK-26270/01', itemNome: 'BULK BODY SPLASH', unidade: 'kg', em: H('2026-09-30T12:00')}
      }
    }
  };
}

async function abrir(browser, uid, pagina) {
  const page = await browser.newPage({viewport: {width: 1400, height: 1000}, acceptDownloads: true});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.clock.install({time: new Date('2026-10-01T09:00:00-03:00')});
  await page.addInitScript(({data, uid}) => {
    const db = data;
    window.__db = db;
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const exige = () => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]'"); };
    const email = db.usuarios[uid].email;
    window.firebase = {
      initializeApp() { window.__iniciado = true; },
      auth() {
        exige();
        return {currentUser: {uid, email}, onAuthStateChanged(cb) { setTimeout(() => cb({uid, email}), 0); }, signOut() { return Promise.resolve(); }};
      },
      database() {
        exige();
        const ref = (path) => {
          const valor = () => { const v = ler(path); return v === undefined ? null : structuredClone(v); };
          const snap = () => { const v = valor(); return {val: () => v, exists: () => v !== null, key: partes(path).pop(),
            forEach(cb) { Object.entries(v || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
          return {path, key: partes(path).pop(),
            once(ev, cb) { const sn = snap(); if (cb) cb(sn); return Promise.resolve(sn); },
            on(ev, cb) { setTimeout(() => cb(snap()), 0); return cb; },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, limitToLast() { return this; }, startAt() { return this; }, endAt() { return this; },
            push() { return Promise.resolve(); }, set() { return Promise.resolve(); }, update() { return Promise.resolve(); },
            remove() { return Promise.resolve(); }, transaction() { return Promise.resolve({committed: false}); }};
        };
        return {ref: (p) => ref(p || '')};
      }
    };
  }, {data: dados(), uid});
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'app.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript'});
  });
  await page.goto('https://app.test/' + pagina);
  await page.waitForFunction(() => window.currentUser && window.currentUser.role, null, {timeout: 8000});
  return {page, errors};
}

const cab = (page, re) => page.waitForFunction((src) => new RegExp(src).test(((document.querySelector('.item-cab h2') || {}).textContent) || ''), re, {timeout: 8000});
const linhasMov = (page) => page.locator('#itemConteudo table').first().locator('tbody tr').allInnerTexts();

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser, 'pcp', 'kardex.html?item=EP-00095');
    // ── Material aberto pelo link ──
    await cab(page, 'EP-00095');
    assert.match(await page.locator('.item-cab').innerText(), /Embalagem · Saldo do item[\s\S]*Conciliado/);
    const tiles = await page.locator('#itemConteudo .tiles').innerText();
    assert.match(tiles, /4\.100 un\s*Saldo no sistema/);
    assert.match(tiles, /\+5\.000\s*Entradas/);
    assert.match(tiles, /-1\.000\s*Saídas, consumos e perdas/);
    assert.match(tiles, /\+100\s*Ajustes/);
    const linhas = await linhasMov(page);
    assert.equal(linhas.length, 6, linhas.join('\n---\n'));
    assert.match(linhas[0], /Contagem de inventário[\s\S]*Contado 4100 · sistema 4100 · confere[\s\S]*MP-A-01[\s\S]*Lia/);
    linhas.shift();
    assert.match(linhas[0], /Ajuste[\s\S]*Gustavo[\s\S]*100[\s\S]*4\.100/, 'mais recente em cima, saldo final = sistema');
    assert.match(linhas[1], /Transferência[\s\S]*não altera o saldo \(\+300 no lote\)/);
    assert.match(linhas[1], /MP-A-01 → PA-B-02/, 'endereços pelo código, não pela chave');
    assert.match(linhas[2], /Baixa do lote \(FEFO\)[\s\S]*não altera o saldo/);
    assert.match(linhas[3], /Consumo na produção[\s\S]*26271\/02[\s\S]*1\.000[\s\S]*4\.000/);
    assert.match(linhas[4], /Recebimento[\s\S]*PC-0012[\s\S]*FR-1[\s\S]*MP-A-01[\s\S]*Ana[\s\S]*5\.000/);
    assert.equal(await page.locator('#itemConteudo tr.info').count(), 3, 'transferência, baixa do lote e contagem não mudam o saldo: cinza');
    // Sem informativos.
    await page.uncheck('#fInfo');
    assert.equal((await linhasMov(page)).length, 3);
    await page.check('#fInfo');
    // Período: últimos 7 dias (desde 24/09 09:00).
    await page.selectOption('#fPeriodo', '7');
    const tiles7 = await page.locator('#itemConteudo .tiles').innerText();
    assert.match(tiles7, /4\.000\s*Saldo no início do período/);
    assert.match(tiles7, /4\.100\s*Saldo no fim do período/);
    await page.selectOption('#fPeriodo', '');
    // CSV.
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnCsv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    assert.match(csv, /Data\/hora;Movimento;Natureza/);
    assert.match(csv, /Consumo na produção \(OP\);Consumo;CONSUMO DE PRODUÇÃO;26271\/02/);

    // ── Busca: produto com lote da planilha ──
    await page.fill('#fItem', 'micelar');
    await page.waitForSelector('.sug');
    await page.locator('.sug').first().click();
    await cab(page, 'GLMKAM01');
    assert.match(await page.locator('.item-cab').innerText(), /Produto acabado · Soma dos lotes[\s\S]*Conciliado/);
    const lp = await linhasMov(page);
    assert.match(lp[lp.length - 1], /Saldo implantado \(planilha\)[\s\S]*26200\/01 importado da planilha antiga[\s\S]*importação[\s\S]*1\.200/);
    assert.match(lp[0], /Expedição[\s\S]*carga-7[\s\S]*200[\s\S]*2\.661/);
    assert.match(await page.locator('#itemConteudo').textContent(), /Lotes com saldo \(2\)[\s\S]*Soma: 2\.661/);

    // ── Intermediário sem cadastro aparece pela busca ──
    await page.fill('#fItem', 'BULK-26270');
    await page.waitForSelector('.sug');
    assert.match(await page.locator('.sug').first().innerText(), /BULK-26270\/01[\s\S]*Intermediário/);
    await page.locator('.sug').first().click();
    await cab(page, 'BULK-26270');
    assert.match(await page.locator('#itemConteudo').innerText(), /Intermediário[\s\S]*Conciliado[\s\S]*480/);

    // ── Bulk em bombona (Material em Processo) ──
    await page.fill('#fItem', '26280');
    await page.waitForSelector('.sug');
    assert.match(await page.locator('.sug').first().innerText(), /BULK 26280\/01 — Bulk — BODY SPLASH IDOLA[\s\S]*Intermediário/);
    await page.locator('.sug').first().click();
    await cab(page, 'BULK 26280');
    assert.match(await page.locator('.item-cab').innerText(), /Material em processo \(bombonas e sobras\)[\s\S]*Conciliado/);
    const lb = await linhasMov(page);
    assert.match(lb[0], /Ajuste de kg na bombona[\s\S]*retirada para envase[\s\S]*BB-0007[\s\S]*Léo[\s\S]*80[\s\S]*120/);
    assert.match(lb[1], /Bulk na bombona[\s\S]*26280-01[\s\S]*200/);

    // ── Material com saldo anterior ao log ──
    await page.fill('#fItem', 'EP-00051');
    await page.waitForSelector('.sug');
    await page.locator('.sug').first().click();
    await cab(page, 'EP-00051');
    assert.match(await page.locator('.item-cab').innerText(), /Divergente/);
    assert.match(await page.locator('.alertas').innerText(), /-377 un no saldo sem movimento registrado/);
    assert.equal(await page.locator('tr.sem-origem').count(), 1);

    // ── Conciliação ──
    await page.click('.aba[data-aba="conc"]');
    await page.waitForFunction(() => /Itens \(/.test(document.getElementById('cTitulo').textContent));
    assert.match(await page.locator('#cTiles').innerText(), /5\s*Itens com saldo ou movimento[\s\S]*4\s*Conciliados[\s\S]*1\s*Com saldo sem movimento/);
    assert.equal(await page.locator('#cBody tr').count(), 1, 'padrão: só divergentes');
    assert.match(await page.locator('#cBody').innerText(), /EP-00051[\s\S]*-377[\s\S]*nunca contado/);
    await page.selectOption('#cSituacao', '');
    assert.equal(await page.locator('#cBody tr').count(), 5);
    assert.match(await page.locator('#cBody tr', {hasText: 'EP-00095'}).innerText(), /30\/09\/26 17:00 · confere/);
    await page.selectOption('#cTipo', 'INT');
    assert.equal(await page.locator('#cBody tr').count(), 2, 'bulk do lote e bulk em bombona');
    await page.locator('#cBody tr', {hasText: 'BULK-26270'}).locator('[data-abrir]').click();
    await page.waitForFunction(() => document.getElementById('pItem').classList.contains('on') && /BULK-26270/.test(document.querySelector('.item-cab h2').textContent));

    // ── Celular: nada vaza para o lado ──
    await page.setViewportSize({width: 375, height: 760});
    await page.goto('https://app.test/kardex.html?item=EP-00095');
    await cab(page, 'EP-00095');
    const larg = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(larg <= 375, 'rolagem lateral no celular: ' + larg);
    if (process.env.KARDEX_SHOT) {
      await page.screenshot({path: process.env.KARDEX_SHOT + '/kardex_cel.png'});
      await page.setViewportSize({width: 1400, height: 1000});
      await page.screenshot({path: process.env.KARDEX_SHOT + '/kardex_desk.png', fullPage: true});
      await page.click('.aba[data-aba="conc"]');
      await page.selectOption('#cSituacao', '');
      await page.screenshot({path: process.env.KARDEX_SHOT + '/kardex_conc.png', fullPage: true});
    }

    assert.deepEqual(errors, [], 'erros de JS: ' + errors.join(' | '));
    console.log('OK Kardex: material, produto com lote da planilha, intermediário sem cadastro, saldo sem origem, período, CSV, conciliação e celular.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
