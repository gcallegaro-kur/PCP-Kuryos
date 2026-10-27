'use strict';
/* Busca e filtros na Fila de Inspeção e nas RNCs (27/10/2026), na tela real,
   e o link direto para uma RNC (?tab=rnc&rnc=...) usado pelo Histórico e
   Indicadores. Firebase simulado e com estado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const hoje = new Date();
const diasAtras = (n) => new Date(hoje.getTime() - n * 86400000).toISOString();
const mp = (codigo, nome, pc, nf, dias, extra) => Object.assign({itemTipo: 'material', itemCodigo: codigo, itemNome: nome, status: 'QUARENTENA',
  saldoLote: 100, unidade: 'kg', loteOrigem: 'F-' + nf, loteInterno: 'AK-' + nf, criadoEm: diasAtras(dias), dataRecebimento: diasAtras(dias).slice(0, 10),
  origemTipo: 'recebimento_pc', origemRef: pc, enderecoCodigo: 'R-' + nf,
  recebimento: {notaFiscal: nf, qtdAmostragem: 2, condicoesVeiculo: 5, condicoesEmbalagem: 5}}, extra || {});
const pal = (n) => ({itemTipo: 'produto', itemCodigo: 'SKU1', itemNome: 'BODY SPLASH NÉCTAR', unidade: 'un', opKey: '26280-01', opLote: '26280/01',
  loteOrigem: '26280/01', paleteNumero: n, identificadorPalete: 'PA-26280-01-P' + n, caixasFechadas: 30, saldoLote: 720,
  status: 'QUARENTENA', origemTipo: 'conferencia_pa', enderecoCodigo: 'A-0' + n, criadoEm: diasAtras(1)});

function dados() {
  return {
    usuarios: {u1: {nome: 'Ana Qualidade', email: 'q@kuryos.com', role: 'qualidade'}},
    pedidos_compra: {pc1: {fornecedorNome: 'Química Sul', numeroFormatado: 'PC-0101'}, pc2: {fornecedorNome: 'Embalagens Norte', numeroFormatado: 'PC-0102'}},
    estoque_lotes: {
      'MPGR-001': {L1: mp('MPGR-001', 'ÁLCOOL DE CEREAIS', 'pc1', '555', 10)},
      'MPGR-002': {L2: mp('MPGR-002', 'GLICERINA BIDESTILADA', 'pc1', '556', 1)},
      'EP-00106': {L3: mp('EP-00106', 'FRASCO 200ML', 'pc2', '777', 5)},
      'MPGR-009': {L9: mp('MPGR-009', 'FRAGRÂNCIA LEÃO', 'pc1', '444', 30, {status: 'REPROVADO',
        qualidade: {decisao: 'REPROVADO', inspecionadoEm: diasAtras(2), inspecionadoPor: 'Daiene'}})},
      SKU1: {pa_1: pal(1), pa_2: pal(2)}
    },
    materiais: {'EP-00106': {mpCodigo: 'EP-00106', tipo: 'EP'}, 'MPGR-001': {mpCodigo: 'MPGR-001', tipo: 'MPGR'}},
    ops: {
      '26280-01': {lote: '26280/01', sku: 'SKU1', produto: 'BODY SPLASH NÉCTAR'},
      '26300-01': {lote: '26300/01', sku: 'SKU2', produto: 'CREME LEÃO DO DESERTO', cliente: 'MISS RÔSE',
        manipulacao: {status: 'AGUARDANDO_CQ', previstos: {}, manipulacao: {fim: diasAtras(0), por: 'Bia', rendimento: 175}}}
    },
    qualidade_rascunhos: {'lote_MPGR-002__L2': {tipo: 'LAUDO', dados: '{"campos":{}}', atualizadoEm: diasAtras(0), por: 'Ana Qualidade'}},
    nao_conformidades: {
      'RNC-2026-0031': {numero: 'RNC-2026-0031', status: 'ABERTA', classificacao: 'MAIOR', origem: 'RECEBIMENTO', fornecedorNome: 'Química Sul',
        itemCodigo: 'MPGR-009', loteKey: 'L9', loteOrigem: 'F-444', descricao: 'Odor alterado na fragrância', abertaEm: '2026-10-20T11:00:00.000Z', abertaPor: 'Daiene'},
      'RNC-2026-0032': {numero: 'RNC-2026-0032', status: 'CONCLUIDA', classificacao: 'MENOR', origem: 'CLIENTE', descricao: 'Reclamação de vazamento',
        causaRaiz: 'Tampa com torque baixo', abertaEm: '2026-09-02T11:00:00.000Z'},
      'RNC-2026-0033': {numero: 'RNC-2026-0033', status: 'EM_ANALISE', classificacao: 'CRITICA', origem: 'PRODUCAO', descricao: 'Granel turvo',
        opLote: '26300/01', abertaEm: '2026-10-25T09:00:00.000Z'}
    }
  };
}

async function abrir(browser, caminho) {
  const page = await browser.newPage({viewport: {width: 1600, height: 1100}});
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript((inicial) => {
    const db = JSON.parse(JSON.stringify(inicial));
    window.__db = db; window.__iniciado = false;
    const exige = (q) => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
    const get = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const set = (p, v) => {
      const ks = p.split('/').filter(Boolean); let o = db;
      ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
      if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
    };
    const ouvintes = [];
    const avisa = () => ouvintes.forEach((o) => setTimeout(() => o.cb({val: () => { const v = get(o.p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); }, exists: () => get(o.p) !== undefined}), 0));
    window.firebase = {
      initializeApp() { window.__iniciado = true; },
      auth() { exige('auth'); return {currentUser: {uid: 'u1', email: 'q@kuryos.com', displayName: 'Ana Qualidade'},
        onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'q@kuryos.com', displayName: 'Ana Qualidade'}), 0); }, signOut() { return Promise.resolve(); }}; },
      storage() { return {ref() { return {put: () => Promise.resolve(), getDownloadURL: () => Promise.resolve('')}; }}; },
      database() {
        exige('database');
        return {ref(p) {
          p = p || '';
          const snap = () => ({val: () => { const v = p ? get(p) : db; return v === undefined ? null : JSON.parse(JSON.stringify(v)); }, exists: () => get(p) !== undefined, forEach() {}});
          return {path: p,
            once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); },
            on(ev, cb) { ouvintes.push({p, cb}); setTimeout(() => cb(snap()), 0); return cb; }, off() {}, child() { return this; },
            orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
            set(v) { set(p, v); avisa(); return Promise.resolve(); },
            update(u) { Object.keys(u).forEach((k) => set((p ? p + '/' : '') + k, u[k])); avisa(); return Promise.resolve(); },
            remove() { set(p, null); avisa(); return Promise.resolve(); },
            push() { return Object.assign(Promise.resolve(), {key: 'k1'}); },
            transaction(fn) { const r = fn(get(p) === undefined ? null : JSON.parse(JSON.stringify(get(p)))); if (r !== undefined) { set(p, r); avisa(); }
              return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        }};
      }
    };
  }, dados());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'q.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://q.test/' + caminho);
  return {page, erros};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const shot = process.env.FILTRO_SHOT;
  try {
    // ════ Fila de Inspeção ════
    const {page, erros} = await abrir(browser, 'qualidade.html?tab=fila&tipo=mp');
    const fila = () => page.locator('#qFilaBody').innerText();
    await page.waitForFunction(() => /MPGR-001/.test(document.querySelector('#qFilaBody').innerText), null, {timeout: 8000});
    assert.match(await page.locator('#qFilaTitulo').textContent(), /Matéria-prima \(2\)/);
    assert.equal(await page.locator('#qLimparFiltros').isVisible(), false);
    assert.equal(await page.locator('#qFiltroResumo').isVisible(), false);

    // Busca: sem acento, palavras soltas; NF e posição também.
    await page.fill('#qBusca', 'alcool cereais');
    await page.waitForFunction(() => !/MPGR-002/.test(document.querySelector('#qFilaBody').innerText));
    assert.match(await fila(), /MPGR-001/);
    assert.match(await page.locator('#qFilaTitulo').textContent(), /\(1 de 2\)/);
    assert.equal(await page.locator('#qStatFila').innerText(), '2', 'o topo segue mostrando a fila inteira');
    await page.fill('#qBusca', '556');
    await page.waitForFunction(() => /MPGR-002/.test(document.querySelector('#qFilaBody').innerText) && !/MPGR-001/.test(document.querySelector('#qFilaBody').innerText));
    await page.fill('#qBusca', 'PC-0102');
    await page.waitForFunction(() => /Nada com esse filtro nesta aba/.test(document.querySelector('#qFilaBody').innerText));
    // O resumo aponta onde está: na aba Embalagem.
    assert.match(await page.locator('#qFiltroResumo').innerText(), /nada nesta aba.*também em Embalagem \(1\)/s);
    assert.match(await page.locator('#qTipos').innerText(), /Embalagem\s*1/);
    await page.click('#qFiltroResumo [data-filtro-ver-tudo]');
    await page.waitForFunction(() => /EP-00106/.test(document.querySelector('#qFilaBody').innerText));
    // Busca pelo cliente acha o granel no cartão de bulk.
    await page.fill('#qBusca', 'miss rose');
    await page.waitForFunction(() => /26300\/01/.test(document.querySelector('#qGranelBody').innerText));
    assert.equal(await page.locator('#qCardGranel').isVisible(), true);
    assert.equal(await page.locator('#qFilaBody [data-laudo-lote], #qFilaBody [data-laudo-op]').count(), 0);
    if (shot) await page.screenshot({path: shot + '_fila_busca.png'});

    // Limpar.
    await page.click('#qLimparFiltros');
    await page.waitForFunction(() => /MPGR-001/.test(document.querySelector('#qFilaBody').innerText) && /SKU1/.test(document.querySelector('#qFilaBody').innerText));
    assert.equal(await page.inputValue('#qBusca'), '');

    // Fornecedor: só os que estão na fila; grafia normalizada.
    const opcoes = await page.locator('#qFiltroForn option').allInnerTexts();
    assert.deepEqual(opcoes, ['Todo fornecedor / origem', 'Embalagens Norte', 'Produção interna', 'Química Sul']);
    await page.selectOption('#qFiltroForn', 'Química Sul');
    await page.waitForFunction(() => !/EP-00106|SKU1/.test(document.querySelector('#qFilaBody').innerText));
    assert.match(await fila(), /MPGR-001[\s\S]*MPGR-002|MPGR-002[\s\S]*MPGR-001/);
    assert.equal(await page.locator('#qCardGranel').isVisible(), false, 'granel é Produção interna');
    // + espera > 7 dias: só o de 10 dias.
    await page.selectOption('#qFiltroEspera', '7');
    await page.waitForFunction(() => !/MPGR-002/.test(document.querySelector('#qFilaBody').innerText));
    assert.match(await fila(), /MPGR-001/);
    // Situação: em preenchimento (MPGR-002 tem rascunho).
    await page.selectOption('#qFiltroEspera', '');
    await page.selectOption('#qFiltroSituacao', 'preenchimento');
    await page.waitForFunction(() => /MPGR-002/.test(document.querySelector('#qFilaBody').innerText) && !/MPGR-001/.test(document.querySelector('#qFilaBody').innerText));
    await page.selectOption('#qFiltroSituacao', 'nao_iniciado');
    await page.waitForFunction(() => /MPGR-001/.test(document.querySelector('#qFilaBody').innerText) && !/MPGR-002/.test(document.querySelector('#qFilaBody').innerText));
    await page.click('#qLimparFiltros');

    // Laudos recentes respeitam a busca; o link da RNC abre a RNC com o detalhe.
    await page.fill('#qBusca', 'fragrancia');
    await page.waitForFunction(() => /MPGR-009/.test(document.querySelector('#qHistBody').innerText));
    await page.fill('#qBusca', 'glicerina');
    await page.waitForFunction(() => /Nenhum laudo recente com essa busca/.test(document.querySelector('#qHistBody').innerText));
    await page.fill('#qBusca', '');
    await page.waitForFunction(() => /MPGR-009/.test(document.querySelector('#qHistBody').innerText));
    await page.locator('#rncFiltroClasse').evaluate((s) => { s.value = 'CRITICA'; }); // filtro antigo que esconderia a RNC
    await page.click('#qHistBody .ir-rnc');
    await page.waitForSelector('#tab-rnc.active');
    assert.equal(await page.inputValue('#rncSearch'), 'RNC-2026-0031');
    assert.equal(await page.inputValue('#rncFiltroClasse'), '', 'o atalho limpa os outros filtros');
    assert.match(await page.locator('#rncBody .rnc-det').innerText(), /Odor alterado na fragrância/);

    // ════ RNCs ════
    await page.click('#rncLimpar');
    await page.waitForFunction(() => /\(2 de 3\)|\(2\)/.test(document.getElementById('rncCount').textContent));
    assert.match(await page.locator('#rncCount').textContent(), /\(2\)/, 'padrão: abertas e em análise, sem "de"');
    assert.equal(await page.locator('#rncLimpar').isVisible(), false);
    await page.selectOption('#rncFiltroStatus', '');
    await page.fill('#rncSearch', 'tampa torque');
    await page.waitForFunction(() => /RNC-2026-0032/.test(document.getElementById('rncBody').innerText) && !/0031/.test(document.getElementById('rncBody').innerText));
    assert.match(await page.locator('#rncCount').textContent(), /\(1 de 3\)/);
    await page.fill('#rncSearch', '');
    await page.selectOption('#rncFiltroOrigem', 'PRODUCAO');
    await page.waitForFunction(() => /RNC-2026-0033/.test(document.getElementById('rncBody').innerText) && !/0031|0032/.test(document.getElementById('rncBody').innerText));
    await page.selectOption('#rncFiltroOrigem', '');
    assert.deepEqual(await page.locator('#rncFiltroForn option').allInnerTexts(), ['Todo fornecedor', 'Química Sul']);
    await page.selectOption('#rncFiltroForn', 'Química Sul');
    await page.waitForFunction(() => /RNC-2026-0031/.test(document.getElementById('rncBody').innerText) && !/0032|0033/.test(document.getElementById('rncBody').innerText));
    await page.selectOption('#rncFiltroForn', '');
    await page.fill('#rncDe', '2026-10-01');
    await page.fill('#rncAte', '2026-10-21');
    await page.waitForFunction(() => /RNC-2026-0031/.test(document.getElementById('rncBody').innerText) && !/0032|0033/.test(document.getElementById('rncBody').innerText));
    assert.equal(await page.locator('#rncLimpar').isVisible(), true);
    if (shot) await page.screenshot({path: shot + '_rnc.png'});
    await page.click('#rncLimpar');
    assert.equal(await page.inputValue('#rncFiltroStatus'), 'ABERTAS');
    assert.equal(await page.inputValue('#rncDe'), '');
    assert.deepEqual(erros, [], 'sem erro de página: ' + erros.join(' | '));
    await page.close();

    // ════ Link direto do Histórico e Indicadores ════
    const link = await abrir(browser, 'qualidade.html?tab=rnc&rnc=RNC-2026-0032');
    await link.page.waitForFunction(() => document.querySelector('#rncBody .rnc-det'), null, {timeout: 8000});
    assert.equal(await link.page.inputValue('#rncSearch'), 'RNC-2026-0032');
    assert.equal(await link.page.inputValue('#rncFiltroStatus'), '', 'concluída aparece: situação vai para Todas');
    assert.match(await link.page.locator('#rncBody .rnc-det').innerText(), /Tampa com torque baixo/);
    assert.match(await link.page.locator('#rncCount').textContent(), /\(1 de 3\)/);
    // RNC de lote laudado: o detalhe oferece o laudo do lote.
    const l2 = await abrir(browser, 'qualidade.html?tab=rnc&rnc=RNC-2026-0031');
    await l2.page.waitForSelector('#rncBody [data-rnc-laudo-item="MPGR-009"]', {timeout: 8000});
    if (shot) await l2.page.screenshot({path: shot + '_rnc_link.png'});
    assert.deepEqual(link.erros.concat(l2.erros), []);
    // E o Histórico passa o número no link.
    assert.match(fs.readFileSync('public/qualidade_historico.html', 'utf8'), /qualidade\.html\?tab=rnc&rnc=' \+ encodeURIComponent\(a\.rnc\)/);
  } finally { await browser.close(); }
  console.log('OK busca e filtros da Qualidade: fila (busca, fornecedor, espera, situação, abas e granel, laudos recentes), RNCs (origem, fornecedor, período) e link direto para uma RNC com o detalhe aberto.');
})().catch((e) => { console.error(e); process.exit(1); });
