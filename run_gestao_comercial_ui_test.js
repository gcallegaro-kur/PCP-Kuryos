'use strict';
/* Gestão Comercial (gestao_comercial.html): todas as abas carregam, a tabela
   de preços grava vigência e a edição de pedido grava as duas cópias (comercial
   e PCP) com versão, respeitando as travas. Tela real com utils.js e
   auth_check.js reais; Firebase simulado em memória, com listeners que
   disparam de novo a cada gravação. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    config: {},
    clientes: {MISS: {nome: 'MISS RÔSE', codigo: 'MISS', condicaoPagamento: '30/45/60'}},
    produtos: {
      MRARBS04: {sku: 'MRARBS04', descricao: 'BODY SPLASH NÉCTAR', cliente: 'MISS RÔSE', clienteKey: 'MISS'},
      MRARBS03: {sku: 'MRARBS03', descricao: 'BODY SPLASH ECLIPSE', cliente: 'MISS RÔSE', clienteKey: 'MISS'},
      MRARBS02: {sku: 'MRARBS02', descricao: 'BODY SPLASH DEUSA', cliente: 'MISS RÔSE', clienteKey: 'MISS'}
    },
    precos_venda: {MRARBS03: {vigencias: {a: {preco: 2.5, inicio: '2026-01-01', criadoPor: 'X'}}}},
    pedidos_comerciais: {
      'PED-0002': {numeroFormatado: 'PED-0002', cliente: 'MISS ROSE', clienteKey: 'MISS', dataPedido: '2026-09-01', numeroPedidoCliente: '28',
        prazoPagamento: '30/45/60', percentualNF: 50, status: 'LIBERADO_PCP', emailDiretoria: {status: 'ENVIADO', destinatarios: ['dir@kuryos.com.br'], em: '2026-09-16T12:00:00Z'}, frete: {tipo: 'FOB', prazo: '3 dias'}, historico: [{tipo: 'LIBERADO_PCP'}],
        itens: [{sku: 'MRARBS04', produtoKey: 'MRARBS04', descricao: 'BODY SPLASH NÉCTAR', qtd: 39158, valorUnitario: 2.7, desconto: 0},
          {sku: 'MRARBS03', produtoKey: 'MRARBS03', descricao: 'BODY SPLASH ECLIPSE', qtd: 7411, valorUnitario: 2.7, desconto: 0}]}
    },
    pedidos: {
      'PED-0002__MRARBS04': {id: 'PED-0002', parentPedidoId: 'PED-0002', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR', cliente: 'MISS ROSE', qtdTotal: 39158, produzido: 3696, apontamentosAplicados: {a: {quantidade: 3696, lote: '26257/17'}}},
      'PED-0002__MRARBS03': {id: 'PED-0002', parentPedidoId: 'PED-0002', sku: 'MRARBS03', produto: 'BODY SPLASH ECLIPSE', cliente: 'MISS ROSE', qtdTotal: 7411, produzido: 0}
    },
    ops: {'26257-17': {lote: '26257/17', skuPedidoKey: 'PED-0002__MRARBS04', status: 'Em Produção', dataInicioReal: '2026-09-10T10:00:00'}},
    expedicoes_comerciais: {E1: {legado: true, tipoLegado: 'EXPEDIDO', data: '2026-09-12', cliente: 'MISS RÔSE', itens: {a: {qtd: 1000, pedidoKey: 'PED-0002__MRARBS04'}}}},
    estoque_lotes: {}, conferencias_pa: {}, solicitacoes_descarte: {}, programacao: {}
  };
}

async function abrir(browser) {
  const page = await browser.newPage({viewport: {width: 1500, height: 1000}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(({data}) => {
    const db = data; window.__db = db; window.__iniciado = false;
    const partes = p => String(p || '').split('/').filter(Boolean);
    const ler = p => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const gravar = (p, v) => { const ks = partes(p); let o = db; ks.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = structuredClone(v); };
    const ouvintes = []; let seq = 0;
    const avisar = caminhos => ouvintes.forEach(o => {
      if (caminhos.some(c => c === o.path || c.startsWith(o.path + '/') || o.path.startsWith(c + '/'))) setTimeout(() => o.cb(snapDe(o.path)), 0);
    });
    const snapDe = path => { const v = ler(path); const c = v === undefined ? null : structuredClone(v); return {val: () => c, exists: () => c !== null}; };
    const exige = q => { if (!window.__iniciado) throw new Error('sem app (' + q + ')'); };
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() { exige('auth'); return {currentUser: {uid: 'u1', email: 'g@kuryos.com'}, onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com'}), 0); }, signOut() { return Promise.resolve(); }}; },
      database() {
        exige('database');
        const ref = path => ({path, key: partes(path).pop(),
          once(ev, cb) { const s = snapDe(path); if (cb) cb(s); return Promise.resolve(s); },
          on(ev, cb) { ouvintes.push({path, cb}); setTimeout(() => cb(snapDe(path)), 0); return cb; }, off() {},
          child(c) { return ref(path + '/' + c); }, orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, startAt() { return this; },
          push() { seq++; return ref(path + '/-N' + seq); },
          set(v) { gravar(path, v); avisar([path]); return Promise.resolve(); },
          update(obj) { const cs = Object.keys(obj).map(k => (path ? path + '/' : '') + k); Object.entries(obj).forEach(([k, v]) => gravar((path ? path + '/' : '') + k, v)); avisar(cs); return Promise.resolve(); },
          remove() { gravar(path, null); avisar([path]); return Promise.resolve(); },
          transaction(fn) { const atual = ler(path); const r = fn(atual === undefined ? null : structuredClone(atual)); if (r !== undefined) { gravar(path, r); avisar([path]); } return Promise.resolve({committed: r !== undefined, snapshot: snapDe(path)}); }});
        return {ref: p => ref(p || '')};
      }
    };
  }, {data: dados()});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'gc.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://gc.test/gestao_comercial.html');
  await page.waitForFunction(() => /Atualizado/.test(document.getElementById('sTxt').textContent), null, {timeout: 10000});
  await page.waitForFunction(() => window.currentUser && window.currentUser.role === 'admin');
  return {page, errors};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser);

    // ── Visão geral e abas ──────────────────────────────────────────────
    assert.match(await page.locator('#kpis').innerText(), /CARTEIRA A ENTREGAR/i);
    for (const tab of ['carteira', 'clientes', 'prazos', 'faturamento', 'precos', 'geral']) {
      await page.click('#abas .tab[data-tab="' + tab + '"]');
      assert.equal(await page.locator('#tab-' + tab).isVisible(), true, 'aba ' + tab);
    }
    await page.click('#abas .tab[data-tab="clientes"]');
    assert.match(await page.locator('#tabClientes').innerText(), /MISS RÔSE/);
    assert.equal(await page.locator('#tabClientes tr.clicavel').count(), 1, 'MISS ROSE e MISS RÔSE são um cliente');

    // ── Tabela de preços: define preço com vigência ────────────────────
    await page.click('#abas .tab[data-tab="precos"]');
    await page.fill('#prcBusca', 'MRARBS02');
    await page.locator('#tabPrecos button[data-sku="MRARBS02"]').click();
    await page.fill('#mpPreco', '');
    await page.click('#mpSalvar');
    assert.equal(await page.locator('#mpErro').isVisible(), true, 'preço e motivo obrigatórios');
    await page.fill('#mpPreco', '2.8');
    await page.fill('#mpMotivo', 'Tabela 2026');
    await page.click('#mpSalvar');
    await page.waitForFunction(() => !document.getElementById('modalPreco').classList.contains('open'));
    const vig = Object.values((await page.evaluate(() => window.__db.precos_venda.MRARBS02)).vigencias)[0];
    assert.equal(vig.preco, 2.8);
    assert.equal(vig.motivo, 'Tabela 2026');
    assert.equal(vig.criadoPor, 'Gustavo');
    await page.waitForFunction(() => /R\$\s?2,80/.test(document.getElementById('tabPrecos').innerText));

    // ── E-mail da diretoria: configuração ──────────────────────────────
    await page.click('#abas .tab[data-tab="carteira"]');
    assert.match(await page.locator('#notaDiretoria').innerText(), /Nenhum e-mail da diretoria/);
    await page.click('#btnDiretoria');
    await page.fill('#dirEmails', ['diretoria@kuryos.com.br', 'errado'].join('\n'));
    await page.click('#dirSalvar');
    assert.match(await page.locator('#dirErro').innerText(), /inválido: errado/);
    await page.fill('#dirEmails', ['Diretoria@kuryos.com.br', 'financeiro@kuryos.com.br', 'diretoria@kuryos.com.br'].join('\n'));
    await page.click('#dirSalvar');
    await page.waitForFunction(() => /diretoria@kuryos.com.br, financeiro@kuryos.com.br/.test(document.getElementById('notaDiretoria').innerText));
    assert.deepEqual(await page.evaluate(() => window.__db.config.emailDiretoria), ['diretoria@kuryos.com.br', 'financeiro@kuryos.com.br']);
    assert.equal(await page.evaluate(() => window.__db.config.emailFinanceiro), undefined, 'financeiro vazio não grava');
    await page.click('#btnDiretoria');
    await page.fill('#finEmails', 'Fin@kuryos.com.br');
    await page.click('#dirSalvar');
    await page.waitForFunction(() => window.__db.config.emailFinanceiro && window.__db.config.emailFinanceiro[0] === 'fin@kuryos.com.br');
    assert.deepEqual(await page.evaluate(() => window.__db.config.emailDiretoria), ['diretoria@kuryos.com.br', 'financeiro@kuryos.com.br'], 'salvar os dois não apaga a diretoria');

    // ── Carteira: editar pedido ─────────────────────────────────────────
    await page.click('#abas .tab[data-tab="carteira"]');
    await page.locator('#tabCarteira tr.clicavel', {hasText: 'PED-0002'}).click();
    assert.match(await page.locator('#tabCarteira').innerText(), /PDF enviado à diretoria/);
    await page.locator('[data-editar="PED-0002"]').click();
    await page.waitForSelector('#modalEdicao.open');
    assert.match(await page.locator('#edItens').innerText(), /mín\. 3\.696/);
    assert.equal(await page.locator('#edItens [data-rem="0"]').isDisabled(), true, 'item com OP não é removível');

    // Trava de quantidade.
    await page.fill('#edItens input[data-i="0"][data-f="qtd"]', '3000');
    await page.fill('#edMotivo', 'Conciliação com o cliente');
    await page.waitForFunction(() => /abaixo do já produzido/.test(document.getElementById('edPreview').innerText));
    assert.equal(await page.locator('#edSalvar').isDisabled(), true);

    // Edição válida: Néctar 40.000, previsão, item novo com preço de tabela sugerido.
    await page.fill('#edItens input[data-i="0"][data-f="qtd"]', '40000');
    await page.fill('#edCampos [data-campo="previsaoComercialEntrega"]', '2026-11-30');
    await page.click('#edAddItem');
    await page.selectOption('#edItens select[data-i="2"]', 'MRARBS02');
    assert.match(await page.locator('#edItens input[data-i="2"][data-f="valorUnitario"]').getAttribute('placeholder'), /tabela atual 2\.8/, 'sem preço na data do pedido, sugere o de hoje');
    await page.fill('#edItens input[data-i="2"][data-f="qtd"]', '20000');
    await page.waitForFunction(() => /Item novo MRARBS02/.test(document.getElementById('edPreview').innerText));
    const preview = await page.locator('#edPreview').innerText();
    assert.match(preview, /O que muda na versão 2/);
    assert.match(preview, /MRARBS04 quantidade: 39\.158 → 40\.000/);
    assert.match(preview, /Previsão de entrega: — → 2026-11-30/);
    await page.click('#edSalvar');
    await page.waitForFunction(() => !document.getElementById('modalEdicao').classList.contains('open'), null, {timeout: 8000});

    const db = await page.evaluate(() => window.__db);
    const pc = db.pedidos_comerciais['PED-0002'];
    assert.equal(pc.versao, 2);
    assert.equal(pc.previsaoComercialEntrega, '2026-11-30');
    assert.equal(pc.itens.length, 3);
    assert.equal(pc.itens[0].qtd, 40000);
    assert.equal(pc.total_qtd, 40000 + 7411 + 20000);
    assert.equal(pc.versoes.v2.motivo, 'Conciliação com o cliente');
    assert.equal(pc.historico[1].tipo, 'EDITADO');
    assert.equal(db.pedidos['PED-0002__MRARBS04'].qtdTotal, 40000);
    assert.equal(Object.keys(db.pedidos['PED-0002__MRARBS04'].apontamentosAplicados).length, 1, 'linha do PCP não é regravada inteira');
    assert.equal(db.pedidos['PED-0002__MRARBS02'].qtdTotal, 20000);
    assert.equal(db.pedidos['PED-0002__MRARBS02'].parentPedidoId, 'PED-0002');

    // Versões visíveis depois de salvar.
    await page.waitForSelector('[data-versoes="PED-0002"]');
    await page.locator('[data-versoes="PED-0002"]').click();
    const versoes = await page.locator('#vsLista').innerText();
    assert.match(versoes, /Versão 2/);
    assert.match(versoes, /Motivo: Conciliação com o cliente/);
    assert.match(versoes, /Versão 1 · pedido original/);
    await page.click('#vsFechar');

    // Concorrência: outra pessoa salvou no meio -> não sobrescreve.
    await page.locator('[data-editar="PED-0002"]').click();
    await page.waitForSelector('#modalEdicao.open');
    await page.fill('#edItens input[data-i="1"][data-f="qtd"]', '7500');
    await page.fill('#edMotivo', 'Segunda edição');
    await page.waitForFunction(() => !document.getElementById('edSalvar').disabled);
    await page.evaluate(() => { window.__db.pedidos_comerciais['PED-0002'].versao = 3; });
    await page.click('#edSalvar');
    await page.waitForFunction(() => /Não salvou/.test(document.getElementById('edPreview').innerText));
    assert.equal((await page.evaluate(() => window.__db.pedidos_comerciais['PED-0002'].itens[1].qtd)), 7411, 'nada gravado');

    assert.deepEqual(errors, [], 'erros de página: ' + errors.join(' | '));
    console.log('OK Gestão Comercial: abas, clientes unificados, preço com vigência, edição com trava, versão, duas cópias e concorrência.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
