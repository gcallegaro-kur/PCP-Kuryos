'use strict';
/* Entrada avulsa de PA, ponta a ponta nas telas reais (Firebase simulado, com
   estado): Devoluções (lançar) -> Qualidade (laudar) -> Expedição (vincular). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const dadosIniciais = () => ({
  usuarios: {u1: {nome: 'Ana Logística', email: 'l@kuryos.com', role: 'admin'}},
  produtos: {PA001: {sku: 'PA001', descricao: 'BODY SPLASH ANTIGO', unCx: 24}},
  enderecos_estoque: {A1: {codigo: 'DOCA-01', area: 'DOCA', ativo: true}},
  pedidos: {'PED-002__PA001': {id: 'PED-002', parentPedidoId: 'PED-002', sku: 'PA001', produto: 'BODY SPLASH ANTIGO', cliente: 'Cliente B', qtdTotal: 500, produzido: 0}},
  pedidos_comerciais: {'PED-002': {numeroFormatado: 'PED-002', clienteKey: 'cb', cliente: 'Cliente B', status: 'LIBERADO_PCP', frete: {tipo: 'CIF', enderecoEntrega: 'Rua B, 2'}, itens: [{sku: 'PA001', qtd: 500, expedido: 0}]}}
});

async function abrir(browser, pagina, inicial) {
  const page = await browser.newPage({viewport: {width: 1700, height: 1200}});
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript((ini) => {
    const db = JSON.parse(JSON.stringify(ini));
    window.__db = db; window.__iniciado = false;
    const exige = (q) => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
    const get = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const set = (p, v) => {
      const ks = p.split('/').filter(Boolean); let o = db;
      ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
      if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
    };
    const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
    const ouvintes = [];
    const avisa = () => ouvintes.forEach((o) => setTimeout(() => o.cb({val: () => clone(get(o.p)), exists: () => get(o.p) !== undefined, forEach() {}}), 0));
    let seq = 0;
    window.firebase = {
      initializeApp() { window.__iniciado = true; },
      auth() { exige('auth'); return {currentUser: {uid: 'u1', email: 'l@kuryos.com', displayName: 'Ana Logística'},
        onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'l@kuryos.com', displayName: 'Ana Logística'}), 0); }, signOut() { return Promise.resolve(); }}; },
      storage() { return {ref() { return {}; }}; },
      functions() { return {httpsCallable() { return () => Promise.resolve({data: {}}); }}; },
      database() {
        exige('database');
        return {ref(p) {
          p = p || '';
          const snap = () => ({val: () => clone(p ? get(p) : db), exists: () => get(p) !== undefined, forEach() {}});
          return {path: p,
            once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); },
            on(ev, cb) { ouvintes.push({p, cb}); setTimeout(() => cb(snap()), 0); return cb; }, off() {}, child() { return this; },
            orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
            set(v) { set(p, v); avisa(); return Promise.resolve(); },
            update(u) { Object.keys(u).forEach((k) => set((p ? p + '/' : '') + k, u[k])); avisa(); return Promise.resolve(); },
            remove() { set(p, null); avisa(); return Promise.resolve(); },
            push(v) { const k = 'k' + (++seq); const r = Object.assign(Promise.resolve(), {key: k}); if (v !== undefined) set(p + '/' + k, v); return r; },
            transaction(fn) {
              const atual = clone(get(p)); const r = fn(atual);
              if (r === undefined) return Promise.resolve({committed: false, snapshot: snap()});
              set(p, r); avisa(); return Promise.resolve({committed: true, snapshot: snap()});
            }};
        }};
      }
    };
  }, inicial);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'a.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://a.test/' + pagina);
  return {page, erros};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    let estado;
    // 1. Logística lança a entrada avulsa em Devoluções.
    {
      const {page, erros} = await abrir(browser, 'devolucoes.html', dadosIniciais());
      await page.waitForSelector('#tabAvulsa:not([hidden])', {timeout: 10000});
      await page.click('#tabAvulsa');
      await page.waitForFunction(() => document.querySelectorAll('#vEndereco option').length > 0 && document.querySelectorAll('#vProdutos option').length > 0, null, {timeout: 8000});
      // Sem preencher nada: recusa com os motivos.
      await page.click('#vSalvar');
      assert.match(await page.locator('#vErros').innerText(), /produto cadastrado/);
      await page.fill('#vProduto', 'PA001 — BODY SPLASH ANTIGO');
      await page.fill('#vLote', 'L-2024/17');
      await page.fill('#vQtd', '295');
      await page.fill('#vValidade', '2030-03-31');
      await page.selectOption('#vMotivoTipo', 'DEVOLUCAO_SEM_ORIGEM');
      await page.fill('#vCliente', 'CLIENTE VELHO');
      await page.fill('#vNf', 'NF 9981');
      await page.fill('#vMotivo', 'Cliente devolveu lote antigo, sem OP no sistema.');
      assert.match(await page.locator('#vCaixas').innerText(), /12 caixa\(s\) fechada\(s\) \+ 1 caixa parcial com 7 un\. \(24 un\.\/caixa\)/);
      await page.click('#vSalvar');
      await page.waitForFunction(() => window.__db.estoque_lotes && window.__db.estoque_lotes.PA001, null, {timeout: 8000});
      estado = await page.evaluate(() => window.__db);
      const lote = Object.values(estado.estoque_lotes.PA001)[0];
      assert.equal(lote.status, 'QUARENTENA'); assert.equal(lote.origemTipo, 'entrada_avulsa_pa'); assert.equal(lote.saldoLote, 295);
      assert.equal(lote.entradaAvulsa.lancadaPor, 'Ana Logística');
      assert.equal(Object.values(estado.movimentos_estoque.PA001)[0].tipo, 'entrada_avulsa_pa');
      await page.waitForFunction(() => /Na Qualidade/.test(document.querySelector('#vLista').innerText), null, {timeout: 8000});
      assert.deepEqual(erros, [], 'devoluções sem erro: ' + erros.join(' | '));
      await page.close();
    }
    // 2. Qualidade laudo o palete (fila avulsa, sem OP) e libera.
    {
      const {page, erros} = await abrir(browser, 'qualidade.html?tab=fila&tipo=pa', estado);
      await page.waitForFunction(() => /Laudar/.test(document.querySelector('#qFilaBody').innerText), null, {timeout: 10000});
      const fila = await page.locator('#qFilaBody').innerText();
      assert.doesNotMatch(fila, /Laudar lote/, 'sem OP não há lote para agrupar: laudo do palete');
      assert.match(fila, /L-2024\/17/);
      await page.click('#qFilaBody [data-laudo-lote]');
      await page.waitForSelector('#modalLaudoBg.open', {timeout: 5000});
      assert.match(await page.locator('#modalLaudoTitle').innerText(), /Liberação de palete/);
      assert.match(await page.locator('#qCk7Amostra').innerText(), /9 de 12 caixa|10 de 13 caixa|caixa/);
      await page.fill('#qObservacao', 'Aspecto e rótulo conferidos; item antigo devolvido.');
      await page.click('#qBtnLiberar');
      await page.waitForFunction(() => Object.values(window.__db.estoque_lotes.PA001)[0].status === 'LIBERADO_EXPEDICAO', null, {timeout: 8000});
      const lote = Object.values(await page.evaluate(() => window.__db.estoque_lotes.PA001))[0];
      assert.equal(lote.qualidade.decisao, 'LIBERADO_EXPEDICAO');
      estado = await page.evaluate(() => window.__db);
      assert.deepEqual(erros, [], 'qualidade sem erro: ' + erros.join(' | '));
      await page.close();
    }
    // 3. Expedição: pendente sem pedido -> vincula -> disponível.
    {
      const {page, erros} = await abrir(browser, 'expedicao.html', estado);
      await page.waitForSelector('#paletes', {timeout: 10000});
      await page.waitForFunction(() => /sem pedido/i.test(document.querySelector('#paletes').innerText) || document.querySelector('[data-vincular]'), null, {timeout: 12000});
      const antes = await page.locator('#paletes').innerText();
      assert.match(antes, /Estoque próprio sem pedido: vincule o palete/);
      assert.match(antes, /Pendente/);
      await page.click('[data-vincular]');
      await page.waitForSelector('#vincPedido', {timeout: 5000});
      assert.match(await page.locator('#vincPedido').innerText(), /PED-002 · Cliente B · saldo a produzir 500 de 500/);
      await page.click('#vincOk');
      await page.waitForFunction(() => Object.values(window.__db.estoque_lotes.PA001)[0].skuPedidoKey === 'PED-002__PA001', null, {timeout: 8000});
      await page.waitForFunction(() => /Disponível/.test(document.querySelector('#paletes').innerText), null, {timeout: 8000});
      assert.match(await page.locator('#paletes').innerText(), /Trocar pedido/);
      // Desfazer devolve o palete a "sem pedido".
      await page.click('[data-vincular]');
      await page.waitForSelector('#vincDesfazer');
      await page.click('#vincDesfazer');
      await page.waitForFunction(() => !Object.values(window.__db.estoque_lotes.PA001)[0].skuPedidoKey, null, {timeout: 8000});
      assert.deepEqual(erros, [], 'expedição sem erro: ' + erros.join(' | '));
      await page.close();
    }
  } finally { await browser.close(); }
  console.log('OK Entrada avulsa de PA: lançar (Devoluções) -> laudar (Qualidade) -> vincular a pedido (Expedição).');
})().catch((e) => { console.error(e); process.exit(1); });
