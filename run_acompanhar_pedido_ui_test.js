'use strict';
/* UI: aba Acompanhar pedido (ex-Documentos e histórico, 21/10/2026). Pedido: ver andamento por
   produto e encerrar/reabrir UMA linha sem sair da tela; edição de quantidade/preço manda para a Gestão. */
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
    await page.evaluate(() => firebase.database().ref().update({
      'pedidos/PED-0019__OUTRO': {id: 'PED-0019', parentPedidoId: 'PED-0019', sku: 'OUTRO', produto: 'SEGUNDO ITEM', qtdTotal: 500, produzido: 500, status: 'Concluído'}
    }));
    await page.click('.tabs button[data-tab="docs"]');
    assert.match(await page.locator('.tabs button.active').innerText(), /Acompanhar pedido/);
    await page.selectOption('#dPedido', 'PED-0019');
    const corpo = await page.locator('#docResumo').innerText();
    assert.match(corpo, /Em andamento \(1 linha a produzir\)/);
    assert.match(corpo, /GLOW MAKE UP/);
    assert.match(corpo, /GLMKAM04/);
    assert.match(corpo, /SEGUNDO ITEM/);
    assert.match(corpo, /Produzida/);
    assert.equal(await page.locator('#docResumo [data-ac="encerrar"]').count(), 1, 'só a linha em produção oferece Encerrar');
    assert.equal(await page.getAttribute('#docEditar', 'href'), 'gestao_comercial.html?tab=pedidos&pedido=PED-0019');
    assert.equal(await page.locator('#aditivo').count(), 0, 'aditivo sem alteração saiu da tela');
    assert.match(await page.locator('#timeline').innerText(), /Pedido liberado ao PCP/, 'evento com nome legível');

    await page.click('#docResumo [data-ac="encerrar"]');
    await page.waitForSelector('#encPedDlg');
    assert.equal(await page.locator('#encLinha').count(), 0, 'a linha já vem escolhida do botão');
    await page.selectOption('#encMotivo', 'CLIENTE_ACEITOU_MENOS');
    await page.click('#encConfirmar');
    await page.waitForFunction(() => window.__db.pedidos['PED-0019__GLMKAM04'].statusManual === 'encerrado');
    assert.equal(await page.evaluate(() => window.__db.pedidos['PED-0019__OUTRO'].statusManual || null), null, 'só a linha escolhida');
    await page.waitForSelector('#docResumo [data-ac="reabrir"]');
    assert.match(await page.locator('#docResumo').innerText(), /Produção concluída ou encerrada/);

    await page.click('#docResumo [data-ac="reabrir"]');
    await page.fill('#encTexto', 'cliente pediu o saldo de volta');
    await page.click('#encConfirmar');
    await page.waitForFunction(() => !window.__db.pedidos['PED-0019__GLMKAM04'].statusManual);
    assert.deepEqual(errors, []);
    console.log('OK Comercial: Acompanhar pedido mostra andamento por produto e encerra/reabre uma linha.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
