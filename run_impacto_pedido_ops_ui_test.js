'use strict';
/* GAP-05 nas telas reais: mudança de pedido chega às OPs.

     Gestão Comercial (reduz abaixo das OPs) ─┐
                                              ├─> pendencias_pcp ─> Controle de OPs (PCP cancela ou mantém)
     Comercial (Cancelar saldo com OP aberta) ┘

   O banco é um só e passa de tela em tela. Firebase simulado com listeners
   que disparam de novo a cada gravação (mesmo harness de
   run_gestao_comercial_ui_test.js). node run_impacto_pedido_ops_ui_test.js */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

let BANCO = {
  usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
  config: {linhas: ['Linha 1'], rotulagem: [], postosTrabalho: []},
  clientes: {MISS: {nome: 'MISS RÔSE', codigo: 'MISS', condicaoPagamento: '30/45/60', ativo: true}},
  produtos: {
    MRARBS04: {sku: 'MRARBS04', descricao: 'BODY SPLASH NÉCTAR', cliente: 'MISS RÔSE', clienteKey: 'MISS', ativo: 'Ativo'},
    MRARBS03: {sku: 'MRARBS03', descricao: 'BODY SPLASH ECLIPSE', cliente: 'MISS RÔSE', clienteKey: 'MISS', ativo: 'Ativo'}
  },
  precos_venda: {},
  pedidos_comerciais: {
    'PED-0002': {numeroFormatado: 'PED-0002', cliente: 'MISS RÔSE', clienteKey: 'MISS', dataPedido: '2026-09-01', numeroPedidoCliente: '28',
      prazoPagamento: '30/45/60', status: 'LIBERADO_PCP', versao: 1, historico: [{tipo: 'LIBERADO_PCP'}],
      itens: [{sku: 'MRARBS04', produtoKey: 'MRARBS04', descricao: 'BODY SPLASH NÉCTAR', qtd: 39158, valorUnitario: 2.7, desconto: 0}]},
    'PED-0003': {numeroFormatado: 'PED-0003', cliente: 'MISS RÔSE', clienteKey: 'MISS', dataPedido: '2026-09-05', numeroPedidoCliente: '31',
      status: 'LIBERADO_PCP', versao: 1, historico: [{tipo: 'LIBERADO_PCP'}],
      itens: [{sku: 'MRARBS03', produtoKey: 'MRARBS03', descricao: 'BODY SPLASH ECLIPSE', qtd: 8000, valorUnitario: 2.5, desconto: 0}]}
  },
  pedidos: {
    'PED-0002__MRARBS04': {id: 'PED-0002', parentPedidoId: 'PED-0002', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR', cliente: 'MISS RÔSE',
      qtdTotal: 39158, produzido: 3696, apontamentosAplicados: {a: {quantidade: 3696, lote: '26257/17'}}},
    'PED-0003__MRARBS03': {id: 'PED-0003', parentPedidoId: 'PED-0003', sku: 'MRARBS03', produto: 'BODY SPLASH ECLIPSE', cliente: 'MISS RÔSE',
      qtdTotal: 8000, produzido: 0}
  },
  ops: {
    '26257-17': {lote: '26257/17', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR', cliente: 'MISS RÔSE', skuPedidoKey: 'PED-0002__MRARBS04',
      parentPedidoId: 'PED-0002', status: 'Em Produção', qtdPlanejada: 20000, produzidoLinha: 3696, dataInicioReal: '2026-09-10T10:00:00'},
    '26257-18': {lote: '26257/18', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR', cliente: 'MISS RÔSE', skuPedidoKey: 'PED-0002__MRARBS04',
      parentPedidoId: 'PED-0002', status: 'Programado', qtdPlanejada: 15000},
    '26260-01': {lote: '26260/01', sku: 'MRARBS03', produto: 'BODY SPLASH ECLIPSE', cliente: 'MISS RÔSE', skuPedidoKey: 'PED-0003__MRARBS03',
      parentPedidoId: 'PED-0003', status: 'Programado', qtdPlanejada: 8000}
  },
  expedicoes_comerciais: {}, estoque_lotes: {}, conferencias_pa: {}, solicitacoes_descarte: {}, programacao: {},
  alocacoes_planejamento: {}, orcamentos: {}, solicitacoes_cadastro_produto: {}, registros: {}, paradas_historico: {},
  pendencias_pcp: {}
};

async function abrir(browser, pagina, papel, esperar) {
  BANCO.usuarios.u1.role = papel;
  const page = await browser.newPage({viewport: {width: 1500, height: 1000}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.__respostas = [];
  page.on('dialog', d => {
    const r = page.__respostas.shift();
    if (r === false) return d.dismiss();
    return d.type() === 'prompt' ? d.accept(r == null ? d.defaultValue() : r) : d.accept();
  });
  await page.addInitScript(({data}) => {
    const db = data; window.__db = db; window.__iniciado = false;
    const partes = p => String(p || '').split('/').filter(Boolean);
    const ler = p => {
      if (String(p).replace(/^\//, '') === '.info/connected') return true;
      return partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    };
    const gravar = (p, v) => { const ks = partes(p); let o = db; ks.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = structuredClone(v); };
    const ouvintes = []; let seq = 0;
    const avisar = caminhos => ouvintes.forEach(o => {
      if (caminhos.some(c => c === o.path || c.startsWith(o.path + '/') || o.path.startsWith(c + '/') || o.path === '')) setTimeout(() => o.cb(snapDe(o.path)), 0);
    });
    const snapDe = path => { const v = ler(path); const c = v === undefined ? null : structuredClone(v);
      return {val: () => c, exists: () => c !== null, key: partes(path).pop(),
        forEach(cb) { Object.entries(c || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() { return {currentUser: {uid: 'u1', email: 'g@kuryos.com'}, onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com'}), 0); }, signOut() { return Promise.resolve(); }}; },
      functions() { return {httpsCallable() { return () => Promise.resolve({data: {ok: true}}); }}; },
      storage() { return {ref() { return {put() { return Promise.resolve(); }, getDownloadURL() { return Promise.resolve(''); }}; }}; },
      database() {
        const ref = path => ({path, key: partes(path).pop(),
          once(ev, cb) { const s = snapDe(path); if (cb) cb(s); return Promise.resolve(s); },
          on(ev, cb) { ouvintes.push({path, cb}); setTimeout(() => cb(snapDe(path)), 0); return cb; }, off() {},
          child(c) { return ref(path + '/' + c); }, orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; },
          startAt() { return this; }, limitToLast() { return this; },
          push(v) { seq++; const f = ref(path + '/-N' + seq); if (v === undefined) return f; gravar(f.path, v); avisar([f.path]); const pr = Promise.resolve(f); pr.key = f.key; return pr; },
          set(v) { gravar(path, v); avisar([path]); return Promise.resolve(); },
          update(obj) { const cs = Object.keys(obj).map(k => (path ? path + '/' : '') + k); Object.entries(obj).forEach(([k, v]) => gravar((path ? path + '/' : '') + k, v)); avisar(cs); return Promise.resolve(); },
          remove() { gravar(path, null); avisar([path]); return Promise.resolve(); },
          transaction(fn) { const atual = ler(path); const r = fn(atual === undefined ? null : structuredClone(atual)); if (r !== undefined) { gravar(path, r); avisar([path]); } return Promise.resolve({committed: r !== undefined, snapshot: snapDe(path)}); }});
        return {ref: p => ref(p || '')};
      }
    };
  }, {data: BANCO});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'gap.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://gap.test/' + pagina);
  await page.waitForFunction(r => window.currentUser && window.currentUser.role === r, papel);
  if (esperar) await esperar(page);
  return {page, errors};
}
async function fechar(page, errors, etapa) {
  BANCO = await page.evaluate(() => window.__db);
  const graves = errors.filter(e => !/ResizeObserver|Failed to fetch|Chart is not defined/.test(e));
  assert.deepEqual(graves, [], 'erro de JavaScript em ' + etapa);
  await page.close();
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  let passos = 0;
  try {
    // ── 1. Gestão Comercial: reduzir PED-0002 de 39.158 para 30.000 ────
    // Comprometido = 3.696 produzido + 16.304 a fazer na 26257/17 + 15.000 na 26257/18 = 35.000.
    {
      const {page, errors} = await abrir(browser, 'gestao_comercial.html', 'admin',
        p => p.waitForFunction(() => /Atualizado/.test(document.getElementById('sTxt').textContent), null, {timeout: 10000}));
      await page.click('#abas .tab[data-tab="carteira"]');
      await page.locator('#tabCarteira tr.clicavel', {hasText: 'PED-0002'}).click();
      await page.locator('[data-editar="PED-0002"]').click();
      await page.waitForSelector('#modalEdicao.open');
      await page.fill('#edItens input[data-i="0"][data-f="qtd"]', '30000');
      await page.fill('#edMotivo', 'Cliente reduziu o pedido');
      await page.waitForFunction(() => /OPs que passam do novo total/.test(document.getElementById('edPreview').innerText));
      const prev = await page.locator('#edPreview').innerText();
      assert.match(prev, /comprometido 35\.000/, 'prévia mostra o comprometido');
      assert.match(prev, /sobram 5\.000/, 'prévia mostra o excesso');
      assert.match(prev, /26257\/17, 26257\/18/, 'prévia lista as OPs');
      passos++;
      await page.waitForFunction(() => !document.getElementById('edSalvar').disabled);
      await page.click('#edSalvar');
      await page.waitForFunction(() => window.__db.pendencias_pcp && window.__db.pendencias_pcp['PED-0002__v2'], null, {timeout: 5000});
      const db = await page.evaluate(() => window.__db);
      assert.equal(db.pedidos['PED-0002__MRARBS04'].qtdTotal, 30000, 'a nova quantidade foi gravada');
      const pend = db.pendencias_pcp['PED-0002__v2'];
      assert.equal(pend.tipo, 'PEDIDO_REDUZIDO');
      assert.equal(pend.status, 'ABERTA');
      assert.deepEqual(Object.keys(pend.ops).sort(), ['26257-17', '26257-18']);
      assert.equal(pend.itens[0].excesso, 5000);
      assert.notEqual(db.ops['26257-18'].status, 'Cancelado', 'o Comercial não cancela OP');
      passos++;
      await fechar(page, errors, 'Gestão Comercial');
    }

    // ── 2. Comercial: Cancelar saldo do PED-0003, que tem OP Programada ─
    {
      const {page, errors} = await abrir(browser, 'comercial.html', 'admin',
        p => p.waitForFunction(() => typeof pedidos !== 'undefined' && pedidos['PED-0003'] && typeof pcpItens !== 'undefined' && pcpItens['PED-0003__MRARBS03']));
      page.__respostas.push(true);          // confirm do cancelamento
      await page.evaluate(() => {
        const sel = document.getElementById('dPedido');
        if (![...sel.options].some(o => o.value === 'PED-0003')) sel.add(new Option('PED-0003', 'PED-0003'));
        sel.value = 'PED-0003';
        document.getElementById('dMotivo').value = 'Cliente desistiu da linha';
        document.getElementById('cancelar').click();
      });
      await page.waitForFunction(() => window.__db.pendencias_pcp['PED-0003__cancelamento'], null, {timeout: 5000});
      await page.waitForFunction(() => /1 OP aberta foi enviada ao PCP/.test(document.getElementById('alert').textContent), null, {timeout: 5000});
      const db = await page.evaluate(() => window.__db);
      assert.equal(db.pedidos_comerciais['PED-0003'].status, 'CANCELADO');
      assert.equal(db.pedidos['PED-0003__MRARBS03'].statusManual, 'encerrado', 'o cancelamento continua encerrando o backlog');
      const pend = db.pendencias_pcp['PED-0003__cancelamento'];
      assert.equal(pend.tipo, 'PEDIDO_CANCELADO');
      assert.equal(pend.numeroPedidoCliente, '31');
      assert.deepEqual(Object.keys(pend.ops), ['26260-01']);
      assert.notEqual(db.ops['26260-01'].status, 'Cancelado', 'o Comercial não cancela OP');
      passos++;
      await fechar(page, errors, 'Comercial');
    }

    // ── 3. Controle de OPs como PCP: decide cada OP ───────────────────
    {
      const {page, errors} = await abrir(browser, 'ops.html', 'pcp',
        p => p.waitForFunction(() => !document.getElementById('pendenciasPcpBox').hidden, null, {timeout: 8000}));
      const box = page.locator('#pendenciasPcpBox');
      assert.match(await box.innerText(), /3 OPs de pedidos alterados pelo Comercial/);
      assert.match(await box.innerText(), /Pedido reduzido · Pedido PED-0002 \/ cliente 28/);
      assert.match(await box.innerText(), /Pedido cancelado · Pedido PED-0003 \/ cliente 31/);
      assert.match(await box.innerText(), /39\.158 → 30\.000, sobram 5\.000/);
      passos++;

      // Mantém a 26257/17 (já está produzindo), com motivo.
      page.__respostas.push('Já em produção; excedente vira estoque');
      await box.locator('tr', {hasText: '26257/17'}).getByRole('button', {name: 'Manter'}).click();
      await page.waitForFunction(() => window.__db.pendencias_pcp['PED-0002__v2'].ops['26257-17'].decisao === 'MANTIDA');
      const mant = await page.evaluate(() => window.__db.pendencias_pcp['PED-0002__v2'].ops['26257-17']);
      assert.equal(mant.motivoMantida, 'Já em produção; excedente vira estoque');
      assert.equal(mant.mantidaPor, 'Gustavo');

      // Manter sem motivo não grava.
      page.__respostas.push('   ');
      page.__respostas.push(true);          // alert "Informe o motivo"
      await box.locator('tr', {hasText: '26257/18'}).getByRole('button', {name: 'Manter'}).click();
      assert.equal(await page.evaluate(() => window.__db.pendencias_pcp['PED-0002__v2'].ops['26257-18'].decisao), undefined, 'sem motivo, nada gravado');
      passos++;

      // Cancela a 26257/18 pelo fluxo que já existe (sem produção: pede motivo).
      page.__respostas.push('Pedido reduzido pelo cliente');
      await box.locator('tr', {hasText: '26257/18'}).getByRole('button', {name: /Cancelar OP/}).click();
      await page.waitForFunction(() => window.__db.ops['26257-18'].status === 'Cancelado');
      await page.waitForFunction(() => window.__db.pendencias_pcp['PED-0002__v2'].status === 'RESOLVIDA', null, {timeout: 5000});
      const res = await page.evaluate(() => window.__db.pendencias_pcp['PED-0002__v2']);
      assert.equal(res.resolvidoPor, 'Gustavo', 'resolve sozinha quando nada fica pendente');
      assert.notEqual(await page.evaluate(() => window.__db.ops['26257-17'].status), 'Cancelado', 'a mantida segue rodando');
      passos++;

      // Sobra só o PED-0003 no painel.
      await page.waitForFunction(() => !/PED-0002/.test(document.getElementById('pendenciasPcpBox').innerText));
      assert.match(await box.innerText(), /1 OP de pedido alterado pelo Comercial/);
      page.__respostas.push('Cliente cancelou');
      await box.locator('tr', {hasText: '26260/01'}).getByRole('button', {name: /Cancelar OP/}).click();
      await page.waitForFunction(() => window.__db.pendencias_pcp['PED-0003__cancelamento'].status === 'RESOLVIDA', null, {timeout: 5000});
      await page.waitForFunction(() => document.getElementById('pendenciasPcpBox').hidden);
      passos++;
      await fechar(page, errors, 'Controle de OPs (PCP)');
    }

    // ── 4. Papel sem poder de decisão vê o aviso, sem botões ──────────
    {
      BANCO.pendencias_pcp.X__v9 = {tipo: 'PEDIDO_REDUZIDO', status: 'ABERTA', pedidoComercialId: 'PED-0002', cliente: 'MISS RÔSE',
        itens: [{sku: 'MRARBS04', qtdAntes: 30000, qtdNova: 20000, excesso: 100}],
        ops: {'26257-17': {opKey: '26257-17', lote: '26257/17', sku: 'MRARBS04', qtdPlanejada: 20000, produzido: 3696}}};
      const {page, errors} = await abrir(browser, 'ops.html', 'production',
        p => p.waitForFunction(() => !document.getElementById('pendenciasPcpBox').hidden, null, {timeout: 8000}));
      assert.match(await page.locator('#pendenciasPcpBox').innerText(), /Só PCP ou administrador decidem/);
      assert.equal(await page.locator('#pendenciasPcpBox button').count(), 0, 'sem botões para quem não decide');
      passos++;
      await fechar(page, errors, 'Controle de OPs (produção)');
    }

    console.log('impacto-pedido-ops UI: ' + passos + ' etapas OK');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
