'use strict';
/* UI: botão Resumo em Pedidos e Orçamentos (pedido do usuário em 22/09).
   Tela real do Comercial, Firebase simulado em memória. O que este teste
   trava: o pedido NÃO é editável por aqui (manda para a Gestão Comercial,
   que segura a cadeia), o orçamento é, e o aceito não é. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    clientes: {GLOW: {nome: 'GLOW MAKE UP', codigo: 'GLOW', cnpj: '55.555.555/0001-55', ativo: true}},
    produtos: {GLMKAM04: {sku: 'GLMKAM04', descricao: 'ÁGUA MICELAR', clienteKey: 'GLOW'}},
    pedidos_comerciais: {
      'PED-0019': {
        numeroFormatado: 'PED-0019', tipo: 'PEDIDO_COMERCIAL', status: 'LIBERADO_PCP', cliente: 'GLOW MAKE UP',
        clienteKey: 'GLOW', clienteCadastro: {cnpj: '55.555.555/0001-55'}, dataPedido: '2026-08-01',
        numeroPedidoCliente: 'PO-8821', percentualNF: 100, prazoPagamento: '28 dias',
        frete: {tipo: 'CIF', prazo: 'entrega em 5 dias', enderecoEntrega: 'Rua A, 100'},
        observacoes: 'Entregar pela manhã', totalValor: 7400, criadoEm: '2026-08-01T10:00:00Z',
        itens: [{sku: 'GLMKAM04', descricao: 'ÁGUA MICELAR', qtd: 1000, valorUnitario: 7.5, desconto: 100}],
        historico: [{tipo: 'LIBERADO_PCP', em: '2026-08-01T10:00:00Z', descricao: 'Pedido confirmado e liberado ao PCP'}]
      }
    },
    // Backlog do PCP: é o que dá o andamento por item no resumo.
    pedidos: {'PED-0019__GLMKAM04': {id: 'PED-0019', parentPedidoId: 'PED-0019', sku: 'GLMKAM04', produto: 'ÁGUA MICELAR', qtdTotal: 1000, produzido: 400}},
    orcamentos: {
      'ORC-0007': {numeroFormatado: 'ORC-0007', tipo: 'ORCAMENTO', status: 'EM_ELABORACAO', cliente: 'PROSPECTO NOVO',
        cnpj: '11222333000181', contato: 'Marcos', email: 'marcos@prospecto.com', validade: '2026-10-31',
        prazoPagamento: '30 dias', frete: {tipo: 'FOB'}, evidencia: 'Briefing por e-mail', totalValor: 24000,
        itens: [{descricao: 'SÉRUM FACIAL 30ML', especificacao: 'frasco âmbar', qtd: 2000, valorUnitario: 12, desconto: 0}],
        criadoEm: '2026-09-01T09:00:00Z'},
      'ORC-0008': {numeroFormatado: 'ORC-0008', tipo: 'ORCAMENTO', status: 'ACEITO', cliente: 'CLIENTE ACEITOU',
        validade: '2026-09-30', totalValor: 500, itens: [{descricao: 'ITEM ACEITO', qtd: 50, valorUnitario: 10}],
        criadoEm: '2026-09-02T09:00:00Z'}
    },
    solicitacoes_cadastro_produto: {}, notificacoes_comercial: {}, config: {}
  };
}

async function abrir(browser) {
  const page = await browser.newPage({viewport: {width: 1500, height: 1100}});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript((data) => {
    const db = data;
    window.__db = db;
    let iniciado = false;
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const ouvintes = [];
    const notificar = (bruto) => {
      const p = partes(bruto).join('/');
      ouvintes.forEach((o) => {
        const alvo = partes(o.path).join('/');
        if (!alvo || p === alvo || p.indexOf(alvo + '/') === 0 || alvo.indexOf(p + '/') === 0) o.avisar();
      });
    };
    const gravar = (p, v) => {
      const ks = partes(p); let o = db;
      ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
      if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = structuredClone(v);
      notificar(p);
    };
    let seq = 0;
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); iniciado = true; },
      auth() {
        if (!iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (auth)");
        return {currentUser: {uid: 'u1', email: 'g@kuryos.com'},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), 0); },
          signOut() { return Promise.resolve(); }};
      },
      storage() {
        if (!iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (storage)");
        window.__arquivos = window.__arquivos || {};
        return {ref(caminho) {
          return {put(arq) { window.__arquivos[caminho] = arq && arq.size; return Promise.resolve(); },
            getDownloadURL() { return Promise.resolve('https://storage.test/' + caminho); },
            delete() { delete window.__arquivos[caminho]; return Promise.resolve(); }};
        }};
      },
      database() {
        if (!iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (database)");
        const ref = (path) => {
          const valor = () => { const v = ler(path); return v === undefined ? null : structuredClone(v); };
          const snap = () => { const v = valor(); return {val: () => v, exists: () => v !== null, key: partes(path).pop(),
            forEach(cb) { Object.entries(v || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
          return {path, key: partes(path).pop(),
            once(ev, cb) { const sn = snap(); if (cb) cb(sn); return Promise.resolve(sn); },
            on(ev, cb) { const avisar = () => cb(snap()); ouvintes.push({path, avisar}); setTimeout(avisar, 0); return cb; },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, limitToLast() { return this; }, startAt() { return this; },
            push(v) { seq++; const filho = ref(path + '/-N' + seq); if (v === undefined) return filho; gravar(filho.path, v);
              const pr = Promise.resolve(filho); pr.key = filho.key; return pr; },
            set(v) { gravar(path, v); return Promise.resolve(); },
            update(obj) { Object.entries(obj).forEach(([k, v]) => gravar(path + '/' + k, v)); return Promise.resolve(); },
            remove() { gravar(path, null); return Promise.resolve(); },
            transaction(fn) { const r = fn(valor()); if (r !== undefined) gravar(path, r); return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        };
        return {ref: (p) => ref(p || '')};
      }
    };
  }, dados());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'com.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://com.test/comercial.html');
  await page.waitForFunction(() => window.currentUser && window.currentUser.nome);
  return {page, errors};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser);

    // ── 1. Resumo do pedido: documento inteiro, com andamento do PCP ────
    await page.waitForSelector('#pedList .res');
    await page.click('#pedList .res[data-k="PED-0019"]');
    await page.waitForSelector('#resumoBg.open');
    assert.match(await page.locator('#resumoTitulo').innerText(), /Pedido comercial PED-0019 · GLOW MAKE UP/);
    const corpo = await page.locator('#resumoBody').innerText();
    assert.match(corpo, /Liberado ao PCP/);
    assert.match(corpo, /55\.555\.555\/0001-55/);
    assert.match(corpo, /PO-8821/);
    assert.match(corpo, /01\/08\/2026/, 'data em formato brasileiro');
    assert.match(corpo, /ÁGUA MICELAR/);
    assert.match(corpo, /R\$\s*7\.400,00/);
    assert.match(corpo, /400/, 'produzido vem do backlog do PCP');
    assert.match(corpo, /600/, 'saldo a produzir');
    assert.match(corpo, /Entregar pela manhã/);
    assert.match(corpo, /Pedido confirmado e liberado ao PCP/, 'histórico no resumo');

    // ── 2. Pedido não edita aqui: manda para a Gestão Comercial ─────────
    assert.equal(await page.locator('#resumoEditar').count(), 0, 'sem edição inline em pedido');
    const linkGestao = page.locator('#resumoFoot a');
    assert.equal(await linkGestao.getAttribute('href'), 'gestao_comercial.html?tab=pedidos&pedido=PED-0019');
    assert.match(await linkGestao.getAttribute('title'), /backlog do PCP, OP, programação/);
    assert.equal(await page.locator('#resumoPdf').count(), 1, 'o PDF fica a um clique da lista');
    await page.click('#resumoFechar');
    await page.waitForFunction(() => !document.getElementById('resumoBg').classList.contains('open'));

    // ── 3. Orçamento: edição acontece aqui, com histórico ───────────────
    await page.click('.tabs button[data-tab="orc"]');
    await page.click('#orcList .res[data-k="ORC-0007"]');
    await page.waitForSelector('#resumoBg.open');
    assert.match(await page.locator('#resumoBody').innerText(), /frasco âmbar/);
    await page.click('#resumoEditar');
    await page.waitForSelector('#edCliente');
    assert.equal(await page.inputValue('#edCliente'), 'PROSPECTO NOVO');

    // Validação antes de gravar: item sem quantidade não passa.
    await page.fill('[data-ed="qtd"][data-i="0"]', '0');
    await page.click('#resumoSalvar');
    await page.waitForSelector('#edErros:visible');
    assert.match(await page.locator('#edErros').innerText(), /quantidade tem que ser maior que zero/);
    assert.equal((await page.evaluate(() => window.__db.orcamentos['ORC-0007'].itens[0].qtd)), 2000, 'nada gravado com erro');

    await page.fill('[data-ed="qtd"][data-i="0"]', '2500');
    await page.fill('#edValidade', '2026-11-30');
    await page.click('#resumoSalvar');
    await page.waitForFunction(() => window.__db.orcamentos['ORC-0007'].itens[0].qtd === 2500);
    const orc = await page.evaluate(() => window.__db.orcamentos['ORC-0007']);
    assert.equal(orc.totalValor, 30000, 'total recalculado no salvar, não digitado');
    assert.equal(orc.validade, '2026-11-30');
    assert.equal(orc.atualizadoPor, 'Gustavo');
    const hist = Object.values(orc.historico || {}).map((h) => h.descricao).join(' ');
    assert.match(hist, /Orçamento editado: validade, item 1/, 'o histórico nomeia o item alterado, não só "itens"');
    assert.match(await page.locator('#resumoBody').innerText(), /R\$\s*30\.000,00/, 'a tela já mostra o novo total');

    // ── 4. Orçamento aceito não edita: explica por quê ──────────────────
    await page.click('#resumoFechar');
    await page.click('#orcList .res[data-k="ORC-0008"]');
    await page.waitForSelector('#resumoBg.open');
    assert.equal(await page.locator('#resumoEditar').count(), 0);
    assert.match(await page.locator('#resumoFoot').innerText(), /solicitações de cadastro de produto/);
    await page.click('#resumoFechar');

    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    console.log('OK Comercial: resumo do pedido com andamento do PCP e PDF, edição de orçamento com histórico, pedido só pela Gestão Comercial e aceito bloqueado.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
