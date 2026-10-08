'use strict';
/* "O que comprar": tela real (o_que_comprar.html) com Firebase simulado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  const produto = (sku, cliente, key) => ({sku, cliente, clienteKey: key, volume: 100, unidadeVolume: 'ml', densidadeGranel: 1, overfillPct: 0, perdaProcessoPct: 0, ativo: 'Ativo'});
  const formula = (sku) => ({codProduto: sku, versao: 'v1', status: 'APROVADA', itens: {f2: {mpCodigo: 'MPGR-ALC', mpNome: 'ÁLCOOL', percentualMM: 10}}});
  const bom = (sku) => ({codProduto: sku, versao: 'v1', itens: {b1: {materialCodigo: 'EP-FRASCO', materialNome: 'FRASCO 100ML', qtdPorPeca: 1}, b2: {materialCodigo: 'EP-VALV', materialNome: 'VALVULA', qtdPorPeca: 1}}});
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    config: {linhas: ['Linha 1']},
    produtos: {'SKU-A': produto('SKU-A', 'MISS ROSE', 'MISS'), 'SKU-B': produto('SKU-B', 'BIOFLORA', 'BIO'), 'SKU-SEM': produto('SKU-SEM', 'X', 'X')},
    formulas: {'SKU-A__v1': formula('SKU-A'), 'SKU-B__v1': formula('SKU-B')},
    bom: {'SKU-A__v1': bom('SKU-A'), 'SKU-B__v1': bom('SKU-B')},
    materiais: {
      'EP-FRASCO': {mpCodigo: 'EP-FRASCO', tipo: 'EP', mpNome: 'FRASCO 100ML', unidade: 'un'},
      'EP-VALV': {mpCodigo: 'EP-VALV', tipo: 'EP', mpNome: 'VALVULA', unidade: 'un'},
      'MPGR-ALC': {mpCodigo: 'MPGR-ALC', tipo: 'MPGR', mpNome: 'ÁLCOOL', unidade: 'kg'}
    },
    pedidos: {
      '0001__SKU-A': {id: '0001', sku: 'SKU-A', produto: 'BODY A', cliente: 'MISS ROSE', qtdTotal: 1000, produzido: 0, dataEntregaPcp: '2026-10-20', priority: 2},
      '0002__SKU-B': {id: '0002', sku: 'SKU-B', produto: 'BODY B', cliente: 'BIOFLORA', qtdTotal: 1000, produzido: 200, dataEntregaPcp: '2026-10-10', priority: 1},
      '0004__SKU-SEM': {id: '0004', sku: 'SKU-SEM', produto: 'SEM CADASTRO', cliente: 'X', qtdTotal: 100, produzido: 0},
      // 95,5% produzido, sem encerrar: Pedidos já mostra Concluído; aqui não pode pedir material (Febella 05, 08/10).
      '0005__SKU-A': {id: '0005', sku: 'SKU-A', produto: 'BODY A', cliente: 'FEBELLA', qtdTotal: 10000, produzido: 9549, status: 'Produção Parcial'},
      // 94%: ainda pede.
      '0006__SKU-A': {id: '0006', sku: 'SKU-A', produto: 'BODY A', cliente: 'FEBELLA', qtdTotal: 1000, produzido: 940, status: 'Produção Parcial'}
    },
    estoque: {
      'EP-FRASCO': {materialCodigo: 'EP-FRASCO', saldoAtual: 1500, saldoEmpenhado: 300, empenhos: {'OP-OUTRO': {qtdEmpenhada: 300}}, ajustes: {a: {ajustadoEm: '2026-10-01T10:00:00Z'}}},
      'EP-VALV': {materialCodigo: 'EP-VALV', saldoAtual: 1000, saldoEmpenhado: 0, porCliente: {MISS: {clienteNome: 'MISS ROSE', saldoAtual: 600}}},
      'MPGR-ALC': {materialCodigo: 'MPGR-ALC', saldoAtual: -40, saldoEmpenhado: 0}
    },
    ops: {'OP-OUTRO': {skuPedidoKey: '9999__SKU-Z'}},
    pedidos_compra: {pc1: {numeroFormatado: 'PC-0001', status: 'ENVIADO', dataPrevistaEntrega: '2026-10-15', fornecedorNome: 'FORN', itens: {i1: {materialCodigo: 'EP-FRASCO', qtd: 700, qtdRecebida: 100}}}},
    solicitacoes_compra: {s1: {numeroFormatado: 'SC-0001', status: 'PENDENTE', itens: {a: {materialCodigo: 'EP-VALV', qtd: 200}}}},
    config_contadores: {}
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
    const {page, errors} = await abrir(browser, 'o_que_comprar.html');
    await page.waitForFunction(() => document.querySelectorAll('#pgrade .pc').length === 4, null, {timeout: 8000});
    assert.equal(await page.locator('#pgrade .pc', {hasText: '0005'}).count(), 0, 'pedido com 95% produzido não aparece (como em Pedidos: concluído)');
    assert.equal(await page.locator('#pgrade .pc', {hasText: '0006'}).count(), 1, 'com 94% ainda aparece');
    assert.match(await page.locator('#pgrade .pc', {hasText: '0004'}).innerText(), /não dá para calcular/);
    assert.equal(await page.locator('#acao').isHidden(), true, 'sem pedido escolhido não há ação');

    // Um pedido: BIOFLORA, 800 pçs
    await page.locator('#pgrade .pc', {hasText: 'Pedido 0002'}).click();
    await page.waitForSelector('#resultado .hero');
    let txt = await page.locator('#resultado').innerText();
    assert.match(txt, /3 materiais para atender este pedido/);
    assert.match(txt, /2 precisam ser comprados/);
    assert.match(page.url(), /p=0002__SKU-B/, 'a escolha vai para a URL');
    // Válvula: precisa 800; 400 do estoque geral (os outros 600 são da MISS), 200 já pedidos numa solicitação, 200 faltam
    const valv = page.locator('.mat', {hasText: 'VALVULA'});
    assert.match(await valv.innerText(), /Estoque\s*400/);
    assert.match(await valv.innerText(), /Falta 200/);
    assert.match(await valv.innerText(), /Em compra\s*200/);
    // O frasco está coberto pelo estoque (1.200 livres)
    assert.match(await page.locator('.mat.coberto', {hasText: 'FRASCO'}).innerText(), /Coberto/);
    // Álcool: saldo negativo vira aviso, não "falta maior"
    assert.match(await page.locator('.mat', {hasText: 'ÁLCOOL'}).innerText(), /saldo negativo/);
    assert.match(txt, /Atenção ao estoque/);

    // Expandir mostra a conta
    await page.locator('.mat', {hasText: 'VALVULA'}).locator('.mhd').click();
    await page.waitForSelector('.mat .det');
    const det = await page.locator('.mat .det').innerText();
    assert.match(det, /por que precisa disso/i);
    assert.match(det, /como cada pedido é atendido/i);

    // Dois pedidos: o que entrega antes (0002) é o 1º; trocar a ordem muda quem leva o estoque
    await page.locator('#pgrade .pc', {hasText: 'Pedido 0001'}).click();
    await page.waitForFunction(() => document.querySelectorAll('#resultado .ped').length === 2);
    let ordem = await page.locator('#resultado .ped b').allInnerTexts();
    assert.match(ordem[0], /0002/);
    await page.locator('[data-sobe]').nth(1).click();
    await page.waitForFunction(() => /0001/.test(document.querySelector('#resultado .ped b').innerText));
    ordem = await page.locator('#resultado .ped b').allInnerTexts();
    assert.match(ordem[0], /0001/, 'ordem manual aplicada');
    assert.match(page.url(), /p=/);

    // Filtro pelo resumo
    await page.click('#resultado [data-est="falta"]');
    await page.waitForFunction(() => document.querySelectorAll('.mat.falta').length > 0 && document.querySelectorAll('.mat.coberto').length === 0);
    await page.click('#limpaEst');

    // Solicitar compra: só o que falta, sem repetir o que já está em compra
    await page.click('#btnSolicitar');
    await page.waitForSelector('#mSol');
    const modal = await page.locator('#mSol').innerText();
    assert.match(modal, /VALVULA/);
    await page.click('#solOk');
    await page.waitForFunction(() => Object.keys(window.__db.solicitacoes_compra || {}).length === 2, null, {timeout: 8000});
    const sc = Object.values(await page.evaluate(() => window.__db.solicitacoes_compra)).find((s) => s.origemTela === 'o_que_comprar');
    assert.equal(sc.status, 'PENDENTE');
    assert.deepEqual(sc.pedidoKeys.slice().sort(), ['0001__SKU-A', '0002__SKU-B']);
    const itens = Object.values(sc.itens);
    assert.ok(itens.every((i) => i.qtd > 0 && i.obs && /falta/.test(i.obs)));
    assert.ok(!itens.some((i) => i.materialCodigo === 'EP-FRASCO' && i.qtd > 1000), 'sem comprar de novo o que está coberto');
    assert.match(sc.numeroFormatado, /^SC-/);
    await page.waitForSelector('.toast');

    // Limpar
    await page.click('#btnNenhum');
    await page.waitForFunction(() => document.querySelectorAll('#resultado .hero').length === 0);

    if (process.env.OQC_SCREENSHOT) {
      await page.locator('#pgrade .pc', {hasText: 'Pedido 0002'}).click();
      await page.locator('#pgrade .pc', {hasText: 'Pedido 0001'}).click();
      await page.waitForSelector('#resultado .hero');
      await page.locator('.mat', {hasText: 'VALVULA'}).locator('.mhd').click();
      await page.screenshot({path: process.env.OQC_SCREENSHOT, fullPage: true});
    }
    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    console.log('OK O que comprar (tela): escolha de pedidos, resumo, disputa e ordem, detalhe, e solicitação só do que falta.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
