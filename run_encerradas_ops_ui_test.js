'use strict';
/* Controle de OPs sem poluição (opção A): a lista principal só tem o que pede
   ação; OP concluída com PA todo liberado vai para "Encerradas"; concluída
   com PA na Qualidade continua na principal. Tela real, Firebase simulado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const HOJE = new Date();
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const AMANHA = new Date(HOJE.getTime() + 86400000);

function dados() {
  const dia = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const op = (lote, extra) => Object.assign({lote: lote, sku: 'SKU1', produto: 'PRODUTO ' + lote, cliente: 'CLIENTE X',
    skuPedidoKey: '0001__SKU1', qtdPlanejada: 1000, produzidoLinha: 1000, produzido: 1000, linha: 'Linha 1'}, extra);
  const pal = (opKey, saldo, status) => ({itemTipo: 'produto', opKey: opKey, saldoLote: saldo, status: status, origemTipo: 'conferencia_pa', skuPedidoKey: '1__SKU1'});
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    config: {linhas: ['Linha 1']},
    ops: {
      'A-ATIVA': op('A/01', {status: 'Em Produção', produzidoLinha: 300, produzido: 300, emFila: {desde: dia(1), setor: 'linha', linhaAnterior: 'Linha 2', motivo: 'Falta de componente — válvulas', por: 'Ana'}}),
      'B-ENCERRADA': op('B/01', {status: 'Concluído', confirmadoEm: dia(20)}),
      'C-QUALIDADE': op('C/01', {status: 'Concluído', confirmadoEm: dia(20)}),
      'D-LOGISTICA': op('D/01', {status: 'Concluído', confirmadoEm: dia(1)}),
      'E-ANTIGA': op('E/01', {status: 'Concluído'})
    },
    pedidos: {
      '0001__SKU1': {id: '0001', sku: 'SKU1', produto: 'P', cliente: 'CLIENTE X', parentPedidoId: '0001', qtdTotal: 5000, produzido: 300, status: 'Em Produção', priority: 3, dataEntregaPcp: '2026-09-20'},
      '0002__ATENDIDO': {id: '0002', sku: 'ATENDIDO', produto: 'PEDIDO JA ATENDIDO', cliente: 'CLIENTE Y', parentPedidoId: '0002', qtdTotal: 1000, produzido: 1000},
      '0003__FALTA': {id: '0003', sku: 'FALTA', produto: 'PEDIDO SEM OP', cliente: 'CLIENTE Z', parentPedidoId: '0003', qtdTotal: 2000, produzido: 0}
    },
    pedidos_comerciais: {'0001': {cliente: 'CLIENTE X', total_qtd: 5000, itens: [{sku: 'SKU1', qtd: 5000}]}},
    estoque_lotes: {SKU1: {
      b1: pal('B-ENCERRADA', 1000, 'LIBERADO_EXPEDICAO'),
      c1: pal('C-QUALIDADE', 700, 'LIBERADO_EXPEDICAO'),
      c2: pal('C-QUALIDADE', 300, 'QUARENTENA')
    }},
    conferencias_pa: {
      'B-ENCERRADA': {finalizadoEm: dia(19)}, 'C-QUALIDADE': {finalizadoEm: dia(19)},
      'D-LOGISTICA': {contagens: {x: {qtd: 10}}}
    },
    material_processo: {m1: {opKey: 'A-ATIVA', tipo: 'BULK', qtd: 330, unidade: 'kg', status: 'EM_PROCESSO'}, m2: {opKey: 'A-ATIVA', tipo: 'FRASCO_ROTULADO', qtd: 1200, unidade: 'un', status: 'EM_PROCESSO'}, m3: {opKey: 'A-ATIVA', tipo: 'BULK', qtd: 99, unidade: 'kg', status: 'USADO'}},
    expedicoes_comerciais: {}, solicitacoes_descarte: {}, devolucoes_cliente: {}, produtos: {}, enderecos_estoque: {}, paradas_historico: {}
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
    const {page, errors} = await abrir(browser, 'ops.html');
    await page.waitForFunction(() => /Concluídas, com produto acabado pendente/i.test(document.getElementById("ops-tbody").innerText), null, {timeout: 8000}).catch(async e => { console.log("TBODY:", await page.locator("#ops-tbody").innerText(), "ERRS:", errors); throw e; });
    const principal = await page.locator('#ops-tbody').innerText();

    // Lista principal: só o que pede ação.
    assert.match(principal, /A\/01/, 'OP ativa aparece');
    assert.match(principal, /C\/01/, 'concluída com PA na Qualidade continua na principal');
    assert.match(principal, /D\/01/, 'concluída recente sem conferência espera a Logística');
    assert.doesNotMatch(principal, /B\/01/, 'concluída e liberada sai da principal');
    assert.doesNotMatch(principal, /E\/01/, 'histórico antigo sai da principal');
    assert.match(principal, /Na Qualidade/);
    assert.match(principal, /Aguardando Logística/);
    // Pedido já atendido não é "aguardando emissão"; o que falta produzir é.
    assert.doesNotMatch(principal, /PEDIDO JA ATENDIDO/);
    assert.doesNotMatch(principal, /PEDIDO SEM OP/, 'backlog de emissão vem recolhido');
    assert.match(principal, /Aguardando Emissão de OP \(1\)/i);
    await page.click('#hdrSemOp');
    await page.waitForFunction(() => /PEDIDO SEM OP/.test(document.getElementById('ops-tbody').innerText));
    // Prioridade e entrega do PCP vêm do item do pedido (leitura).
    const linhaA = page.locator('#ops-tbody tr', {hasText: 'A/01'});
    assert.equal((await linhaA.locator('td').nth(6).innerText()).trim(), '3', 'coluna Prio.');
    assert.match(await linhaA.locator('td').nth(7).innerText(), /20\/09\/2026/);
    assert.match(await linhaA.locator('td').nth(7).innerText(), /em atraso/);
    assert.ok((await page.locator('#opsThead th').allInnerTexts()).some(t => /Entrega \(PCP\)/i.test(t)));
    // OP devolvida à fila e material retido aparecem como chips na linha da OP.
    const chips = await linhaA.innerText();
    assert.match(chips, /Em fila: Falta de componente/);
    assert.match(chips, /330 kg de bulk/);
    assert.match(chips, /1\.200 frascos rotulados/);
    assert.doesNotMatch(chips, /99 kg/, 'o que já teve baixa não conta como retido');
    // Secundário recolhido: previsão/emitido por ficam dentro de <details>.
    assert.ok(await page.locator('#ops-tbody tr', {hasText: 'A/01'}).count() >= 1);

    // Aba Encerradas: as duas concluídas sem pendência, busca funciona.
    await page.click('#tabBtnEncerradas');
    await page.waitForFunction(() => /B\/01/.test(document.getElementById('enc-tbody').innerText), null, {timeout: 8000});
    const enc = await page.locator('#enc-tbody').innerText();
    assert.match(enc, /B\/01/);
    assert.match(enc, /E\/01/);
    assert.doesNotMatch(enc, /C\/01|D\/01|A\/01/);
    assert.match(await page.locator('#encResumo').innerText(), /2 de 2 encerradas/);
    await page.fill('#encBusca', 'B/01');
    await page.waitForFunction(() => !/E\/01/.test(document.getElementById('enc-tbody').innerText));
    assert.match(await page.locator('a[href*="dossie_lote.html?op=B-ENCERRADA"]').first().getAttribute('href'), /B-ENCERRADA/);
    if (process.env.ENC_SCREENSHOT) await page.screenshot({path: process.env.ENC_SCREENSHOT});

    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    console.log('OK Controle de OPs: principal só com o que pede ação, Encerradas com busca e dossiê.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
