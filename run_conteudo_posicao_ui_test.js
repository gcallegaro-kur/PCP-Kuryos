'use strict';
/* WMS: clicar numa posição do Mapa por rua mostra o conteúdo do palete --
   itens, volumes, peso e quantidades. estoque.html, utils.js e auth_check.js
   reais; Firebase simulado fiel ao SDK. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    'usuarios/u1': {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'},
    'config/areasEndereco': [{nome: 'FÁBRICA', sigla: 'FAB', ativo: true}],
    estrutura_ruas: {'FAB-1': {area: 'FÁBRICA', sigla: 'FAB', codigoRua: 1, niveis: 1, predios: 3}},
    enderecos_estoque: {
      'FAB-1-1-1': {area: 'FÁBRICA', codigo: 'FAB-1.1.1', rua: 1, nivel: 1, predio: 1, sigla: 'FAB', ativo: true, geradoDe: 'FAB-1'},
      'FAB-1-1-2': {area: 'FÁBRICA', codigo: 'FAB-1.1.2', rua: 1, nivel: 1, predio: 2, sigla: 'FAB', ativo: true, geradoDe: 'FAB-1'},
      'FAB-1-1-3': {area: 'FÁBRICA', codigo: 'FAB-1.1.3', rua: 1, nivel: 1, predio: 3, sigla: 'FAB', ativo: true, geradoDe: 'FAB-1'}
    },
    produtos: {'PRF-AFEE-0014': {sku: 'PRF-AFEE-0014', descricao: 'PERFUME ZAFIYR 30ML', kgCaixa: 1.7, unCx: 12}},
    materiais: {'EP-00036': {mpCodigo: 'EP-00036', mpNome: 'VALVULA EASY LOCK', unidade: 'un'},
                'EP-00167': {mpCodigo: 'EP-00167', mpNome: 'FRASCO 200ML', unidade: 'un', pesoUnitario: 20}},
    estoque_lotes: {
      'PRF-AFEE-0014': {pa: {itemTipo: 'produto', itemCodigo: 'PRF-AFEE-0014', itemNome: 'PERFUME ZAFIYR 30ML', saldoLote: 1895, qtdOriginal: 1895, unidade: 'un',
        caixasFechadas: 157, unidadesPorCaixa: 12, unidadesCaixaParcial: 11, identificadorPalete: 'PA-26251-15-P1', opLote: '26251/15', cliente: 'AFEER OF ARABIAN',
        status: 'QUARENTENA', enderecoKey: 'FAB-1-1-1', enderecoCodigo: 'FAB-1.1.1'}},
      'EP-00036': {l1: {itemTipo: 'material', itemCodigo: 'EP-00036', itemNome: 'VALVULA EASY LOCK', saldoLote: 7300, qtdOriginal: 7300, unidade: 'un',
        loteInterno: 'AK-2026-000577', loteOrigem: 'NA', dataRecebimento: '2026-09-14', dataValidade: '2026-12-31', status: 'QUARENTENA', enderecoKey: 'FAB-1-1-1', enderecoCodigo: 'FAB-1.1.1',
        recebimento: {qtdVolumes: 2, fornecedorNome: 'LOMAR PACK', notaFiscal: '18413'}}},
      'EP-00167': {l2: {itemTipo: 'material', itemCodigo: 'EP-00167', itemNome: 'FRASCO 200ML', saldoLote: 1000, qtdOriginal: 1500, unidade: 'un',
        loteInterno: 'AK-2026-000580', status: 'LIBERADO', enderecoKey: 'FAB-1-1-2', enderecoCodigo: 'FAB-1.1.2', recebimento: {qtdVolumes: 3, fornecedorNome: 'VIDROS SA'}}}
    }
  };
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1500, height: 1100}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(({data}) => {
      window.__iniciado = false;
      const exige = q => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
      const get = path => { if (path in data) return data[path]; const partes = path.split('/'); let n = data[partes[0]]; for (const p of partes.slice(1)) n = n == null ? undefined : n[p]; return n === undefined ? null : n; };
      window.firebase = {
        initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
        auth() { exige('auth'); return {onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), 0); }, signOut() { return Promise.resolve(); }, currentUser: {email: 'g@kuryos.com'}}; },
        functions() { return {httpsCallable: () => () => Promise.resolve({data: {}})}; },
        database() {
          exige('database');
          const ref = path => {
            const snap = () => ({val: () => structuredClone(get(path)), exists: () => get(path) != null});
            return {path, key: 'k1', once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); },
              on(ev, cb) { setTimeout(() => cb(snap()), 0); return cb; }, off() {}, child(p) { return ref(path + '/' + p); },
              orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
              set() { return Promise.resolve(); }, update() { return Promise.resolve(); }, push() { return Promise.resolve(); }, remove() { return Promise.resolve(); },
              transaction(fn) { const v = fn(structuredClone(get(path))); return Promise.resolve({committed: true, snapshot: {val: () => v}}); }};
          };
          return {ref};
        }
      };
    }, {data: dados()});
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'wms.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + url.pathname.slice(1);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    await page.goto('https://wms.test/estoque.html');
    await page.waitForSelector('.kt-sidebar', {timeout: 8000});
    await page.click('.tab[data-tab="posicoes"]');
    await page.click('#btnVerMapa-end');
    await page.waitForSelector('#mapaVisualGrid-end .mapa-cell[data-endereco-key="FAB-1-1-1"]');

    // ── 1. Palete com PA e material: resumo e linha a linha ──────────────
    await page.click('#mapaVisualGrid-end .mapa-cell[data-endereco-key="FAB-1-1-1"]');
    await page.waitForSelector('#mapaDetalheCard-end', {state: 'visible'});
    assert.match(await page.textContent('#mapaDetalheTitulo-end'), /FAB-1\.1\.1 · FÁBRICA — 2 itens/);
    const resumo = await page.innerText('#mapaDetalheResumo-end');
    assert.match(resumo, /2\s*itens no palete/);
    assert.match(resumo, /9\.195 un\s*quantidade/);
    assert.match(resumo, /160\s*volumes/, '158 do palete de PA + 2 do recebimento');
    assert.match(resumo, /~268,6 kg\s*1 item\(ns\) sem peso/, 'peso aproximado quando falta dado em algum item');
    assert.match(resumo, /2 Quarentena|2 QUARENTENA|2 Em quarentena/i);
    const linhas = await page.locator('#mapaDetalheBody-end tr').allInnerTexts();
    assert.equal(linhas.length, 2);
    const mp = linhas.find(l => /EP-00036/.test(l)), pa = linhas.find(l => /PRF-AFEE-0014/.test(l));
    assert.doesNotMatch(mp, /fornecedor: NA/, '"NA" é lote não informado, não aparece como lote do fornecedor');
    assert.match(mp, /AK-2026-000577[\s\S]*LOMAR PACK · NF 18413[\s\S]*entrada 14\/09\/2026[\s\S]*2 volumes[\s\S]*7\.300 un[\s\S]*sem peso unitário no cadastro/);
    assert.match(mp, /31\/12\/2026/, 'validade no dia certo: data pura não pode voltar um dia pelo fuso');
    assert.match(pa, /PA-26251-15-P1[\s\S]*OP 26251\/15 · AFEER OF ARABIAN[\s\S]*157 cx × 12 \+ 1 parcial com 11[\s\S]*1\.895 un[\s\S]*268,6[\s\S]*kg\/cx do cadastro/);

    // ── 2. Material com saída parcial: peso pelo cadastro, aviso de volumes ─
    await page.click('#mapaVisualGrid-end .mapa-cell[data-endereco-key="FAB-1-1-2"]');
    await page.waitForFunction(() => /FAB-1\.1\.2/.test(document.getElementById('mapaDetalheTitulo-end').textContent));
    const l2 = await page.innerText('#mapaDetalheBody-end');
    assert.match(l2, /3 volumes no recebimento \(parte do lote já saiu\)/);
    assert.match(l2, /1\.000 un[\s\S]*de 1\.500/);
    assert.match(l2, /\b20\b[\s\S]*peso unitário do cadastro/, '1.000 × 20 g = 20 kg');
    assert.match(await page.innerText('#mapaDetalheResumo-end'), /20 kg\s*peso total/);

    // ── 3. Posição livre ──────────────────────────────────────────────────
    await page.click('#mapaVisualGrid-end .mapa-cell[data-endereco-key="FAB-1-1-3"]');
    await page.waitForFunction(() => /posição livre/.test(document.getElementById('mapaDetalheTitulo-end').textContent));
    assert.match(await page.textContent('#mapaDetalheBody-end'), /Posição livre/);
    assert.equal((await page.textContent('#mapaDetalheResumo-end')).trim(), '');

    assert.deepEqual(errors, [], 'erros de página: ' + errors.join(' | '));
    console.log('OK WMS: detalhe da posição com itens, volumes, peso, quantidades, origem e posição livre.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
