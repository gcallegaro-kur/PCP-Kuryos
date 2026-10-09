'use strict';
/* Consulta de Estoque: a tela real (consulta_estoque.html) com Firebase simulado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const ymd = (dias) => { const d = new Date(Date.now() + dias * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

function dados() {
  const agora = new Date().toISOString();
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    config: {linhas: ['Linha 1']},
    materiais: {
      'EP-1': {tipo: 'EP', mpNome: 'FRASCO PET 120ML', unidade: 'un'},
      'EP-2': {tipo: 'EP', mpNome: 'VALVULA SPRAY 24/410', unidade: 'un'},
      'ES-1': {tipo: 'ES', mpNome: 'ROTULO BODY SPLASH', unidade: 'un'},
      'MPGR-1': {tipo: 'MPGR', mpNome: 'ALCOOL CEREAL', unidade: 'kg'}
    },
    estoque: {
      'EP-1': {materialCodigo: 'EP-1', materialNome: 'FRASCO PET 120ML', saldoAtual: 6000, saldoEmpenhado: 1000, unidade: 'un', empenhos: {'OP-X': {lote: 'X/01', qtdEmpenhada: 600, sku: 'SKU-X', criadoEm: agora}, 'OP-FIM': {lote: '26244/02', qtdEmpenhada: 400, sku: 'SKU-Z', criadoEm: agora}}, ultimaAtualizacao: agora, ultimaMovimentacao: {em: agora, tipo: 'ajuste_manual', qtd: 6000, ref: 'contagem'}},
      'EP-2': {materialCodigo: 'EP-2', materialNome: 'VALVULA SPRAY 24/410', saldoAtual: 3000, saldoEmpenhado: 0, unidade: 'un', porCliente: {MISS: {clienteNome: 'MISS ROSE', saldoAtual: 3000}}, ajustes: {a1: {ajustadoEm: agora}}},
      'ES-1': {materialCodigo: 'ES-1', materialNome: 'ROTULO BODY SPLASH', saldoAtual: 100, saldoEmpenhado: 800, unidade: 'un'},
      'MPGR-1': {materialCodigo: 'MPGR-1', materialNome: 'ALCOOL CEREAL', saldoAtual: 90, saldoEmpenhado: 0, unidade: 'kg'}
    },
    estoque_lotes: {
      'MPGR-1': {l1: {itemTipo: 'material', saldoLote: 40, status: 'LIBERADO', dataValidade: ymd(10), loteInterno: 'AK-2026-000001', enderecoCodigo: 'GAL-1.1.1'},
        l2: {itemTipo: 'material', saldoLote: 30, status: 'LIBERADO', dataValidade: ymd(-2), loteInterno: 'AK-2026-000002', enderecoCodigo: 'GAL-1.1.2'},
        l3: {itemTipo: 'material', saldoLote: 20, status: 'QUARENTENA', dataValidade: ymd(400), loteInterno: 'AK-2026-000003', enderecoCodigo: 'DOC-1.1.1'}},
      'SKU-PA': {p1: {itemTipo: 'produto', itemCodigo: 'SKU-PA', itemNome: 'BODY SPLASH ZAHRA 120ml', cliente: 'BRIA BEAUTY', saldoLote: 4849, status: 'LIBERADO_EXPEDICAO', enderecoCodigo: 'DOC-1.1.1', identificadorPalete: 'PA-1'}}
    },
    ops: {
      'OP-X': {lote: 'X/01', sku: 'SKU-X', produto: 'BODY SPLASH IDOLA', cliente: 'MISS ROSE', status: 'Programado', qtdPlanejada: 1000, pesoTeoricoUnG: 100,
        manipulacao: {status: 'LIBERADO', manipulacao: {rendimento: 100}},
        materiaisConsumo: {a: {origem: 'bom', mpCodigo: 'EP-1', mpNome: 'FRASCO PET 120ML', quantidade: 1000}, b: {origem: 'bom', mpCodigo: 'EP-2', mpNome: 'VALVULA SPRAY 24/410', quantidade: 1000}}},
      'OP-Y': {lote: 'Y/01', sku: 'SKU-X', produto: 'BODY SPLASH IDOLA', cliente: 'MISS ROSE', status: 'Em Produção', qtdPlanejada: 1000, pesoTeoricoUnG: 100, produzidoLinha: 400,
        manipulacao: {status: 'LIBERADO', manipulacao: {rendimento: 100}},
        materiaisConsumo: {a: {origem: 'bom', mpCodigo: 'ES-1', mpNome: 'ROTULO BODY SPLASH', quantidade: 1000}}},
      'OP-FIM': {lote: '26244/02', sku: 'SKU-Z', produto: 'HIDRATANTE CEU INFINITO 200g', status: 'Concluído', qtdPlanejada: 400}
    },
    produtos: {'SKU-X': {sku: 'SKU-X', clienteKey: 'MISS', descricao: 'IDOLA', volume: 120, unidadeVolume: 'ml'}},
    bom: {}, formulas: {},
    material_processo: {r1: {opKey: 'OP-Y', tipo: 'BULK', qtd: 20, unidade: 'kg', status: 'EM_PROCESSO', lote: 'Y/01', donoNome: 'MISS ROSE', sku: 'SKU-X', produto: 'BODY SPLASH IDOLA', declaradoEm: agora}},
    bombonas_bulk: {}
  };
}

async function abrir(browser, pagina) {
  const page = await browser.newPage({viewport: {width: 1600, height: 1100}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(({data}) => {
    const db = data;
    window.__db = db;
    window.__iniciado = false;
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const gravar = (p, v) => {
      const ks = partes(p); let o = db;
      ks.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
      if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = structuredClone(v);
    };
    let seq = 0;
    const exige = q => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() {
        exige('auth');
        return {currentUser: {uid: 'u1', email: 'g@kuryos.com'},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), 0); },
          signOut() { return Promise.resolve(); }};
      },
      database() {
        exige('database');
        const ref = (path, filtro) => {
          const valor = () => {
            let v = ler(path);
            if (filtro && v && typeof v === 'object') v = Object.fromEntries(Object.entries(v).filter(([k]) => k >= filtro));
            return v === undefined ? null : structuredClone(v);
          };
          const snap = () => { const v = valor(); return {val: () => v, exists: () => v !== null, key: partes(path).pop(), forEach(cb) { Object.entries(v || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
          return {path, key: partes(path).pop(),
            once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); },
            on(ev, cb) { setTimeout(() => cb(snap()), 0); return cb; },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
            startAt(k) { return ref(path, k); },
            push() { seq++; return ref(path + '/-T' + seq); },
            set(v) { gravar(path, v); return Promise.resolve(); },
            update(obj) { Object.entries(obj).forEach(([k, v]) => gravar(path + '/' + k, v)); return Promise.resolve(); },
            remove() { gravar(path, null); return Promise.resolve(); },
            transaction(fn) { const r = fn(valor()); if (r !== undefined) gravar(path, r); return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        };
        return {ref: (p) => ref(p || '')};
      }
    };
  }, {data: dados()});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'tr.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://tr.test/' + pagina);
  await page.waitForSelector('.kt-sidebar', {timeout: 8000});
  return {page, errors};
}



(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser, 'consulta_estoque.html');
    await page.waitForFunction(() => document.querySelectorAll('#corpo tr[data-c]').length >= 4, null, {timeout: 8000});
    assert.equal(await page.locator('#corpo tr[data-c]').count(), 5, 'EP-1, EP-2, ES-1, MPGR-1 e o PA');
    const kpis = await page.locator('#kpis').innerText();
    assert.match(kpis, /Itens com saldo/);
    assert.match(kpis, /Bulk aguardando envase/);
    // Padrão: ordem alfabética (previsível). Por urgência, vêm primeiro ES-1 (empenho maior que o saldo) e MPGR-1 (vencido).
    assert.equal(await page.locator('#corpo tr[data-c]').first().getAttribute('data-c'), 'MPGR-1', 'A–Z: ALCOOL primeiro');
    await page.selectOption('#fOrdem', 'gravidade');
    await page.waitForFunction(() => document.querySelector('#corpo tr[data-c]').getAttribute('data-c') !== 'MPGR-1' || document.querySelectorAll('#corpo tr.sel').length === 0);
    const primeira = await page.locator('#corpo tr[data-c]').first().getAttribute('data-c');
    assert.ok(['ES-1', 'MPGR-1'].includes(primeira), 'urgentes no topo, veio ' + primeira);
    await page.selectOption('#fOrdem', 'nome');

    // Busca instantânea: palavras em qualquer ordem, sem acento; acha por lote.
    await page.fill('#q', 'valvula 24');
    await page.waitForFunction(() => document.querySelectorAll('#corpo tr[data-c]').length === 1);
    assert.equal(await page.locator('#corpo tr[data-c]').first().getAttribute('data-c'), 'EP-2');
    assert.match(await page.locator('#corpo tr[data-c]').first().innerText(), /do cliente: MISS ROSE/);
    await page.fill('#q', 'ak-2026-000003');
    await page.waitForFunction(() => { const t = document.querySelectorAll('#corpo tr[data-c]'); return t.length === 1 && t[0].getAttribute('data-c') === 'MPGR-1'; });
    assert.equal(await page.locator('#corpo tr[data-c]').first().getAttribute('data-c'), 'MPGR-1');
    assert.match(page.url(), /q=ak-2026-000003/, 'a busca vai para a URL');
    await page.fill('#q', 'zzzz');
    await page.waitForFunction(() => /Nada encontrado/.test(document.getElementById('corpo').innerText));
    await page.click('#btnLimpar2');
    await page.waitForFunction(() => document.querySelectorAll('#corpo tr[data-c]').length === 5);

    // Filtros com contagem viva
    const chipVencido = page.locator('#fTag [data-t="vencido"]');
    assert.match(await chipVencido.innerText(), /Vencido\s*1/);
    await chipVencido.click();
    await page.waitForFunction(() => document.querySelectorAll('#corpo tr[data-c]').length === 1);
    assert.equal(await page.locator('#corpo tr[data-c]').first().getAttribute('data-c'), 'MPGR-1');
    await page.click('#fTag [data-t=""]');
    await page.click('#fGrupo [data-g="EP"]');
    await page.waitForFunction(() => document.querySelectorAll('#corpo tr[data-c]').length === 2);
    await page.click('#fGrupo [data-g=""]');
    await page.waitForFunction(() => document.querySelectorAll('#corpo tr[data-c]').length === 5);
    await page.selectOption('#fCliente', 'MISS');
    await page.waitForFunction(() => document.querySelectorAll('#corpo tr[data-c]').length === 1);
    await page.selectOption('#fCliente', '');
    await page.waitForFunction(() => document.querySelectorAll('#corpo tr[data-c]').length === 5);

    // Drawer: recados em português, lotes na ordem FEFO, onde é usado carregado.
    await page.locator('#corpo tr[data-c="MPGR-1"]').click();
    await page.waitForSelector('#drawer.on');
    await page.waitForFunction(() => /Nenhuma fórmula ou BOM vigente usa/.test(document.getElementById('drawer').innerText));
    const dr = await page.locator('#drawer').innerText();
    assert.match(dr, /ALCOOL CEREAL/);
    assert.match(dr, /30 kg vencidos/);
    assert.match(dr, /20 kg em quarentena/);
    assert.ok(dr.indexOf('AK-2026-000002') < dr.indexOf('AK-2026-000001'), 'o lote que vence primeiro vem primeiro');
    assert.match(await page.locator('#drawer a[href^="kardex.html?item=MPGR-1"]').innerText(), /Kardex/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('drawer').classList.contains('on'));
    await page.locator('#corpo tr[data-c="ES-1"]').click();
    await page.waitForSelector('#drawer.on');
    const drEs = await page.locator('#drawer').innerText();
    assert.match(drEs, /OPs reservaram 800 e só há 100/);
    assert.match(drEs, /Faltam 700/);
    await page.keyboard.press('Escape');

    // Atalho "/" foca a busca
    // Empenho: a tela tem que dizer QUEM segura e o que já pode ser solto
    await page.locator('#corpo tr[data-c="EP-1"]').click();
    await page.waitForSelector('#drawer.on');
    const drEp = await page.locator('#drawer').innerText();
    assert.match(drEp, /quem está segurando \(2 OPs?\)/i, 'a seção do empenho existe, com a contagem de OPs (o <h3> sai em maiúsculas por CSS)');
    assert.match(drEp, /X\/01/, 'lista a OP que reservou');
    assert.match(drEp, /BODY SPLASH IDOLA/, 'e o que ela produz, não só o lote');
    assert.match(drEp, /26244\/02/, 'inclusive a reserva presa');
    assert.match(drEp, /OP concluída/i, 'marcando que aquela OP já acabou');
    assert.match(drEp, /400 un presos em OP que já encerrou/i, 'com o aviso do que dá para soltar, e quanto');
    assert.match(drEp, /Total reservado\s+1\.000 un/i, 'e o total conferindo com o Empenhado de cima');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('drawer').classList.contains('on'));

    await page.locator('h1').click();
    await page.keyboard.press('/');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'q');
    await page.keyboard.press('Tab');

    // Intermediários x embalagens
    await page.click('#abaInter');
    await page.waitForFunction(() => document.querySelectorAll('#gradeInter .cartao').length === 2);
    const cartaoX = page.locator('#gradeInter .cartao', {hasText: 'X/01'});
    assert.match(await cartaoX.innerText(), /Embalagem completa/, 'OP-X é dona do empenho do frasco e a válvula é da MISS');
    const ty = await page.locator('#gradeInter .cartao', {hasText: 'Y/01'}).innerText();
    assert.match(ty, /Trava em: ROTULO BODY SPLASH/);
    assert.match(ty, /60 kg|60,0 kg/, 'tira o que já foi envasado');
    assert.match(page.url(), /aba=inter/);
    await page.click('#fEstado [data-ei="bloqueado"]');
    await page.waitForFunction(() => document.querySelectorAll('#gradeInter .cartao').length === 1);
    assert.match(await page.locator('#retidos').innerText(), /Bulk/);
    assert.match(await page.locator('#retidos').innerText(), /MISS ROSE/);
    if (process.env.CE_SCREENSHOT) await page.screenshot({path: process.env.CE_SCREENSHOT + '-inter.png', fullPage: true});
    await page.click('#abaItens');
    if (process.env.CE_SCREENSHOT) { await page.locator('#corpo tr[data-c="MPGR-1"]').click(); await page.waitForSelector('#drawer.on'); await page.waitForTimeout(400); await page.screenshot({path: process.env.CE_SCREENSHOT + '-itens.png'}); }

    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    console.log('OK Consulta de Estoque (tela): busca, filtros vivos, drawer, atalhos e intermediários x embalagens.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
