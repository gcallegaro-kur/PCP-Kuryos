'use strict';
/* Histórico e indicadores da Qualidade (29/09), na tela real:
   indicadores do período (aprovação, reprovação, tempo até a decisão, bulk
   na 1ª análise, fila), gráfico semanal, tabela por tipo e por fornecedor;
   histórico com busca e link para emitir o laudo -- que abre a emissão na
   própria tela da Qualidade. Firebase simulado em memória. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const H = (s) => new Date(s + '-03:00').toISOString();

function dados() {
  return {
    usuarios: {cq: {nome: 'Daiene', email: 'cq@kuryos.com', role: 'qualidade'}},
    config: {linhas: ['Linha 1']},
    materiais: {m1: {mpCodigo: 'MP-1', mpNome: 'ÁLCOOL CEREAIS', tipo: 'MPGR'}, m2: {mpCodigo: 'EP-9', mpNome: 'FRASCO 200ML', tipo: 'EP'}},
    pedidos_compra: {pc1: {fornecedorKey: 'f1', fornecedorNome: 'QUÍMICA SUL'}, pc2: {fornecedorKey: 'f2', fornecedorNome: 'FRASCOS BR'}},
    nao_conformidades: {'RNC-2026-0007': {numero: 'RNC-2026-0007', loteKey: 'l_mp2', status: 'ABERTA'}},
    especificacoes: {}, parametros_pa: {}, produtos: {}, fornecedores: {},
    estoque_lotes: {
      'MP-1': {
        l_mp1: {itemCodigo: 'MP-1', itemNome: 'ÁLCOOL CEREAIS', itemTipo: 'material', status: 'LIBERADO', origemTipo: 'recebimento_pc', origemRef: 'pc1',
          unidade: 'kg', saldoLote: 200, recebimento: {recebidoEm: H('2026-09-21T08:00'), loteInterno: 'AK-1'},
          qualidade: {decisao: 'LIBERADO', inspecionadoEm: H('2026-09-21T14:00'), inspecionadoPor: 'Daiene'}},
        l_mp2: {itemCodigo: 'MP-1', itemNome: 'ÁLCOOL CEREAIS', itemTipo: 'material', status: 'REPROVADO', origemTipo: 'recebimento_pc', origemRef: 'pc1',
          unidade: 'kg', saldoLote: 50, recebimento: {recebidoEm: H('2026-09-22T08:00'), loteInterno: 'AK-2'},
          qualidade: {decisao: 'REPROVADO', inspecionadoEm: H('2026-09-24T08:00'), inspecionadoPor: 'Daiene', observacao: 'Odor fora do padrão'}},
        l_q: {itemCodigo: 'MP-1', itemTipo: 'material', status: 'QUARENTENA', dataRecebimento: '2026-09-25', criadoEm: H('2026-09-25T09:00')}
      },
      'EP-9': {
        l_ep: {itemCodigo: 'EP-9', itemNome: 'FRASCO 200ML', itemTipo: 'material', status: 'APROVADO_CONCESSAO', origemTipo: 'recebimento_pc', origemRef: 'pc2',
          unidade: 'un', saldoLote: 1000, recebimento: {recebidoEm: H('2026-09-22T10:00')},
          qualidade: {decisao: 'APROVADO_CONCESSAO', inspecionadoEm: H('2026-09-22T16:00'), inspecionadoPor: 'Lia', autorizadoPor: 'Gustavo'}}
      }
    },
    ops: {
      '26300-01': {lote: '26300/01', sku: 'SKU1', produto: 'BODY SPLASH', cliente: 'MISS RÔSE', status: 'Concluído', manipulacao: {
        ciclo: 2, status: 'LIBERADO', correcao: {rncNumero: 'RNC-2026-0009'},
        manipulacao: {fim: H('2026-09-23T09:00')}, analise: {decisao: 'LIBERADO', por: 'Daiene', em: H('2026-09-23T09:20')},
        historico: {c1: {manipulacao: {fim: H('2026-09-22T09:00')}, analise: {decisao: 'REPROVADO', por: 'Daiene', em: H('2026-09-22T11:00')}}}}}
    }
  };
}

async function abrir(browser, uid, pagina) {
  const page = await browser.newPage({viewport: {width: 1400, height: 1000}});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.clock.install({time: new Date('2026-09-29T09:00:00-03:00')});
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

const titulo = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('histTitulo').textContent), re.source, {timeout: 4000})
  .catch(async (e) => { console.log('TITULO REAL:', await page.locator('#histTitulo').innerText(), '| linhas:', await page.locator('#tbHist').innerText()); throw e; });

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser, 'cq', 'qualidade_historico.html');
    await page.waitForFunction(() => /Análises decididas/.test(document.getElementById('tiles').innerText), null, {timeout: 8000});
    const tiles = await page.locator('#tiles').innerText();
    // 5 análises: 2 MP, 1 embalagem, 2 ciclos de bulk.
    assert.match(tiles, /5\s*Análises decididas/);
    assert.match(tiles, /60%\s*Aprovação/, '2 aprovadas + 1 concessão de 5');
    assert.match(tiles, /2\s*Reprovações/);
    assert.match(tiles, /0%\s*Bulk aprovado na 1ª análise/, 'a 26300/01 reprovou no ciclo 1');
    assert.match(tiles, /1\s*Aguardando a Qualidade agora/);
    // Por tipo: tempo do bulk em minutos/horas, da MP em dias.
    const tipos = await page.locator('#tbTipos').innerText();
    assert.match(tipos, /Matéria-prima\s*2\s*50%\s*1\s*0\s*0/);
    assert.match(tipos, /Bulk\s*2\s*50%\s*1\s*0\s*0\s*1,2 h/, 'mediana de 20 min e 2 h');
    assert.match(await page.locator('#tbForn').innerText(), /QUÍMICA SUL\s*2\s*1\s*0\s*50%/);
    // Gráfico: legenda presente; 8 semanas; a de 21/09 com as 5.
    assert.match(await page.locator('#legenda').innerText(), /Aprovado[\s\S]*Reprovado/);
    assert.equal(await page.locator('#graf .graf-col').count(), 8);
    assert.match(await page.locator('#graf').innerText(), /5/);
    // Filtro por tipo.
    await page.selectOption('#fTipo', 'embalagem');
    await page.waitForFunction(() => /^1\s*Análises decididas/.test(document.getElementById('tiles').innerText));
    assert.equal(await page.locator('#tbTipos tr').count(), 1);
    await page.selectOption('#fTipo', '');

    // ── Histórico: busca sem acento, resultado, link do laudo ──
    await page.click('.aba[data-aba="hist"]');
    await titulo(page, /Análises \(5\)/);
    await page.fill('#fBusca', 'alcool sul');
    await titulo(page, /Análises \(2\)/);
    await page.selectOption('#fResultado', 'REPROVADO');
    await titulo(page, /Análises \(1\)/);
    const linha = await page.locator('#tbHist tr').first().innerText();
    assert.match(linha, /AK-2[\s\S]*QUÍMICA SUL[\s\S]*Reprovado[\s\S]*Odor fora do padrão[\s\S]*Daiene[\s\S]*2 dias[\s\S]*RNC-2026-0007/);
    assert.equal(await page.locator('#tbHist a', {hasText: 'Laudo'}).getAttribute('href'), 'qualidade.html?emitir=MP-1&lote=l_mp2');
    // Bulk não tem laudo emitível; tem Dossiê.
    await page.selectOption('#fResultado', '');
    await page.fill('#fBusca', '26300/01');
    await page.waitForFunction(() => /BODY SPLASH/.test(document.getElementById('tbHist').textContent) && !/ÁLCOOL/.test(document.getElementById('tbHist').textContent));
    await titulo(page, /Análises \(2\)/);
    assert.equal(await page.locator('#tbHist a', {hasText: 'Laudo'}).count(), 0);
    assert.equal(await page.locator('#tbHist a', {hasText: 'Dossiê'}).count(), 2);
    assert.match(await page.locator('#tbHist').innerText(), /correção, ciclo 2[\s\S]*1ª análise/);
    // O menu da Qualidade leva à página.
    assert.equal(await page.locator('.kt-sidebar a[href="qualidade_historico.html"]').count(), 1);
    if (process.env.QH_SCREENSHOT) {
      await page.click('.aba[data-aba="dash"]');
      await page.screenshot({path: process.env.QH_SCREENSHOT, fullPage: true});
    }
    assert.deepEqual(errors, [], 'erros: ' + errors.join(' | '));
    await page.close();

    // ── O link "Laudo" abre a emissão na tela da Qualidade ──
    const q = await abrir(browser, 'cq', 'qualidade.html?emitir=MP-1&lote=l_mp2');
    await q.page.waitForSelector('#modalEmitirBg.open', {timeout: 8000});
    assert.match(await q.page.locator('#qEmitResumo').innerText(), /ÁLCOOL CEREAIS[\s\S]*F0070/);
    assert.deepEqual(q.errors, []);

    console.log('OK Histórico e indicadores da Qualidade: KPIs, gráfico semanal, por tipo e fornecedor; histórico com busca, resultado, Laudo/Dossiê; link abre a emissão.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
