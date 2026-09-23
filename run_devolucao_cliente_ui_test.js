'use strict';
/* GAP-02 na tela real (devolucoes.html): Comercial autoriza -> Logística
   recebe (o callable roda a regra do servidor aqui no Node) -> Qualidade
   decide no laudo -> a tela acompanha o destino. Firebase simulado com
   listeners. node run_devolucao_cliente_ui_test.js */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const D = require('./public/shared/devolucao-cliente.js');

let BANCO = {
  usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
  config: {},
  pedidos_comerciais: {'PED-0002': {numeroFormatado: 'PED-0002', cliente: 'MISS RÔSE', clienteKey: 'MISS', numeroPedidoCliente: '28', status: 'LIBERADO_PCP',
    itens: [{sku: 'MRARBS04', qtd: 1000, expedido: 1000}]}},
  pedidos: {'PED-0002__MRARBS04': {id: 'PED-0002', parentPedidoId: 'PED-0002', sku: 'MRARBS04', cliente: 'MISS RÔSE', qtdTotal: 1000, produzido: 1000, expedido: 1000}},
  expedicoes_comerciais: {exp_A: {numero: 'EXP-A', pedidoId: 'PED-0002', pedidos: {'PED-0002': {}}, data: '2026-09-20', nf: '4512', status: 'EXPEDIDO',
    itens: [{pedidoId: 'PED-0002', sku: 'MRARBS04', descricao: 'NÉCTAR', opKey: '26257-17', opLote: '26257/17', skuPedidoKey: 'PED-0002__MRARBS04',
      itemKey: 'MRARBS04', identificadorPalete: 'PA-26257-17-P1', validade: '2029-09-01', qtd: 1000}]}},
  enderecos_estoque: {GAL_1: {codigo: 'GAL-1.1.1', area: 'GALPAO', ativo: true}, DOC_1: {codigo: 'DOC-1.1.1', area: 'DOCA', ativo: true}},
  estoque_lotes: {}, devolucoes_cliente: {}, contadores_devolucao: {}, comercial_eventos: {}
};

async function abrir(browser, papel, modulos) {
  BANCO.usuarios.u1.role = papel;
  if (modulos) BANCO.usuarios.u1.modulos = modulos; else delete BANCO.usuarios.u1.modulos;
  const page = await browser.newPage({viewport: {width: 1400, height: 950}});
  const errors = [], respostas = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { const r = respostas.shift(); return d.type() === 'prompt' ? d.accept(r == null ? '' : r) : d.accept(); });
  await page.exposeFunction('__servidor', async (nome, payload, base) => {
    try {
      if (nome !== 'receberDevolucaoCliente') return {base, data: {ok: true}};
      const dev = base.devolucoes_cliente[payload.devKey];
      if (dev && dev.status === 'RECEBIDA') return {base, data: {ok: true, jaRecebida: true}};
      const plano = D.prepararRecebimento({devKey: payload.devKey, dev, pedidos: base.pedidos, pedidoComercial: base.pedidos_comerciais[dev.pedidoComercialId],
        enderecos: base.enderecos_estoque, autor: 'Gustavo', agora: '2026-09-24T09:00:00.000Z',
        dados: {itens: payload.itens, observacao: payload.observacao, nfDevolucao: payload.nfDevolucao}});
      return {base, updates: plano.updates, data: {ok: true, total: plano.total}};
    } catch (e) { return {erro: e.message}; }
  });
  await page.addInitScript(({data}) => {
    const db = data; window.__db = db;
    const partes = p => String(p || '').split('/').filter(Boolean);
    const ler = p => String(p).replace(/^\//, '') === '.info/connected' ? true : partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const gravar = (p, v) => { const ks = partes(p); let o = db; ks.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = structuredClone(v); };
    const ouvintes = [];
    const snapDe = path => { const v = ler(path); const c = v === undefined ? null : structuredClone(v); return {val: () => c, exists: () => c !== null, key: partes(path).pop()}; };
    const avisar = cs => ouvintes.forEach(o => { if (cs.some(c => c === o.path || c.startsWith(o.path + '/') || o.path.startsWith(c + '/'))) setTimeout(() => o.cb(snapDe(o.path)), 0); });
    window.__gravarMuitos = ups => { Object.entries(ups).forEach(([k, v]) => gravar(k, v)); avisar(Object.keys(ups)); };
    window.firebase = {
      initializeApp() {},
      auth() { return {currentUser: {uid: 'u1', email: 'g@kuryos.com'}, onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com'}), 0); }, signOut() { return Promise.resolve(); }}; },
      functions() { return {httpsCallable(nome) { return payload => window.__servidor(nome, structuredClone(payload), structuredClone(db)).then(r => {
        if (r.erro) return Promise.reject(new Error(r.erro));
        if (r.updates) window.__gravarMuitos(r.updates);
        return {data: r.data};
      }); }}; },
      database() {
        const ref = path => ({path, key: partes(path).pop(),
          once(ev, cb) { const s = snapDe(path); if (cb) cb(s); return Promise.resolve(s); },
          on(ev, cb) { ouvintes.push({path, cb}); setTimeout(() => cb(snapDe(path)), 0); return cb; }, off() {},
          child(c) { return ref(path + '/' + c); }, orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
          set(v) { gravar(path, v); avisar([path]); return Promise.resolve(); },
          update(obj) { const cs = Object.keys(obj).map(k => path + '/' + k); Object.entries(obj).forEach(([k, v]) => gravar(path + '/' + k, v)); avisar(cs); return Promise.resolve(); },
          remove() { gravar(path, null); avisar([path]); return Promise.resolve(); },
          transaction(fn) { const a = ler(path); const r = fn(a === undefined ? null : structuredClone(a)); if (r !== undefined) { gravar(path, r); avisar([path]); } return Promise.resolve({committed: r !== undefined, snapshot: snapDe(path)}); }});
        return {ref: p => ref(p || '')};
      }
    };
  }, {data: BANCO});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'dev.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://dev.test/devolucoes.html');
  await page.waitForFunction(r => window.currentUser && window.currentUser.role === r, papel);
  await page.waitForFunction(() => (document.getElementById('conn') || {}).textContent === 'Conectado', null, {timeout: 8000});
  return {page, errors, respostas};
}
async function fechar(page, errors, etapa) {
  BANCO = await page.evaluate(() => window.__db);
  const graves = errors.filter(e => !/ResizeObserver|Failed to fetch/.test(e));
  assert.deepEqual(graves, [], 'erro de JavaScript em ' + etapa + ': ' + graves.join(' | '));
  await page.close();
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  let passos = 0;
  try {
    // ── 1. Comercial autoriza 120 un. da carga EXP-A ──────────────────
    {
      const {page, errors} = await abrir(browser, 'production', {comercial: true});
      assert.equal(await page.locator('#tabAutorizar').isVisible(), true, 'Comercial vê Autorizar');
      assert.equal(await page.locator('#tabReceber').isVisible(), false, 'Comercial não vê Receber');
      await page.click('#tabAutorizar');
      await page.selectOption('#aPedido', 'PED-0002');
      await page.waitForFunction(() => document.getElementById('aCarga').value === 'exp_A');
      assert.match(await page.locator('#aItens').innerText(), /PA-26257-17-P1/);
      await page.fill('#aItens input[data-idx="0"]', '1500');
      await page.selectOption('#aMotivoTipo', 'AVARIA_TRANSPORTE');
      await page.fill('#aMotivo', 'Caixas amassadas na entrega; cliente recusou parte.');
      await page.click('#aSalvar');
      assert.match(await page.locator('#aErros').innerText(), /só 1\.000 un\. desta carga ainda podem voltar/);
      assert.equal(Object.keys(await page.evaluate(() => window.__db.devolucoes_cliente)).length, 0, 'nada gravado com erro');
      await page.fill('#aItens input[data-idx="0"]', '120');
      await page.click('#aSalvar');
      await page.waitForFunction(() => window.__db.devolucoes_cliente['DEV-2026-001'], null, {timeout: 5000});
      const dev = await page.evaluate(() => window.__db.devolucoes_cliente['DEV-2026-001']);
      assert.deepEqual([dev.status, dev.totalAutorizado, dev.autorizadoPor, dev.nfOriginal], ['AUTORIZADA', 120, 'Gustavo', '4512']);
      assert.equal(await page.evaluate(() => window.__db.contadores_devolucao['2026']), 1, 'contador anual');
      assert.ok(await page.evaluate(() => window.__db.comercial_eventos['PED-0002']['DEV-2026-001_autorizada']), 'evento no pedido');
      await page.click('.tabs button[data-tab="lista"]');
      assert.match(await page.locator('#lista').innerText(), /DEV-2026-001[\s\S]*Aguardando chegada/);
      passos++;
      await fechar(page, errors, 'autorizar');
    }

    // ── 2. Logística recebe 110 (10 não vieram) na Doca ───────────────
    {
      const {page, errors} = await abrir(browser, 'logistica');
      assert.equal(await page.locator('#tabAutorizar').isVisible(), false, 'Logística não autoriza');
      await page.click('#tabReceber');
      await page.selectOption('#rDev', 'DEV-2026-001');
      await page.waitForSelector('#rItens input[data-campo="q"]');
      assert.equal(await page.locator('#rItens select[data-i="0"]').inputValue(), 'DOC_1', 'endereço sugerido é a Doca');
      await page.fill('#rItens input[data-campo="q"]', '110');
      await page.fill('#rObs', '10 un. não vieram');
      await page.click('#rSalvar');
      await page.waitForFunction(() => window.__db.devolucoes_cliente['DEV-2026-001'].status === 'RECEBIDA', null, {timeout: 5000});
      await page.waitForFunction(() => /Recebido: 110 un\. em quarentena/.test(document.getElementById('alert').textContent));
      const db = await page.evaluate(() => window.__db);
      assert.equal(db.pedidos['PED-0002__MRARBS04'].expedido, 890, 'estorno do expedido');
      assert.equal(db.estoque_lotes.MRARBS04['dev_DEV-2026-001_i0'].status, 'QUARENTENA');
      assert.match(await page.locator('#rDev').innerText(), /Nenhuma devolução autorizada/, 'some da fila de recebimento');
      passos++;
      await fechar(page, errors, 'receber');
    }

    // ── 3. Qualidade: acompanha e o destino muda com o laudo ─────────
    {
      const {page, errors} = await abrir(browser, 'qualidade');
      assert.equal(await page.locator('#tabAutorizar').isVisible(), false);
      assert.equal(await page.locator('#tabReceber').isVisible(), false);
      assert.match(await page.locator('#lista').innerText(), /Recebida — em andamento/);
      assert.equal(await page.locator('#stQualidade').innerText(), '1');
      await page.click('[data-ver="DEV-2026-001"]');
      assert.match(await page.locator('#mItens').innerText(), /Em quarentena — aguardando a Qualidade[\s\S]*Qualidade: laudar o palete/);
      assert.equal(await page.locator('#mItens a[href="qualidade.html?tab=fila"]').count(), 1, 'atalho para a fila');
      // A Qualidade libera o palete (fluxo real: registrarLaudoQualidade na fila).
      await page.evaluate(() => window.__gravarMuitos({
        'estoque_lotes/MRARBS04/dev_DEV-2026-001_i0/status': 'LIBERADO_EXPEDICAO',
        'estoque_lotes/MRARBS04/dev_DEV-2026-001_i0/qualidade': {decisao: 'LIBERADO_EXPEDICAO'}}));
      await page.waitForFunction(() => /Reintegrado ao estoque/.test(document.getElementById('mItens').innerText));
      assert.match(await page.locator('#mTitulo').innerText(), /Concluída/);
      assert.match(await page.locator('#mHistorico').innerText(), /recebida por Gustavo[\s\S]*quantidade diferente da autorizada[\s\S]*10 un\. não vieram/);
      assert.equal(await page.locator('#mCancelarDev').isVisible(), false, 'recebida não cancela');
      passos++;
      await fechar(page, errors, 'qualidade');
    }

    // ── 4. Comercial cancela uma autorização que não chegou ───────────
    {
      const {page, errors, respostas} = await abrir(browser, 'production', {comercial: true});
      await page.click('#tabAutorizar');
      await page.selectOption('#aPedido', 'PED-0002');
      await page.waitForFunction(() => document.getElementById('aCarga').value === 'exp_A');
      assert.match(await page.locator('#aItens').innerText(), /890/, 'só o que não voltou pode voltar');
      await page.fill('#aItens input[data-idx="0"]', '50');
      await page.selectOption('#aMotivoTipo', 'COMERCIAL');
      await page.fill('#aMotivo', 'Troca combinada com o cliente, 50 un.');
      await page.click('#aSalvar');
      await page.waitForFunction(() => window.__db.devolucoes_cliente['DEV-2026-002']);
      await page.click('.tabs button[data-tab="lista"]');
      await page.click('[data-ver="DEV-2026-002"]');
      respostas.push('Cliente desistiu da troca');
      await page.click('#mCancelarDev');
      await page.waitForFunction(() => window.__db.devolucoes_cliente['DEV-2026-002'].status === 'CANCELADA');
      assert.equal(await page.evaluate(() => window.__db.devolucoes_cliente['DEV-2026-002'].cancelamento.motivo), 'Cliente desistiu da troca');
      await page.waitForFunction(() => /cancelada por Gustavo: Cliente desistiu da troca/.test(document.getElementById('mHistorico').innerText));
      passos++;
      await fechar(page, errors, 'cancelar');
    }

    console.log('devolução de cliente UI: ' + passos + ' etapas OK');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
