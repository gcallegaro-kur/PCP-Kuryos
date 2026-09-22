'use strict';
/* UI: cliente que também é fornecedor (e o contrário), na tela real de
   Cadastros, com Firebase simulado em memória. Pedido do usuário (21/09):
   um botão dentro do cadastro individual para duplicar o cadastro do outro
   lado -- sem digitar tudo de novo e sem criar empresa repetida. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    clientes: {
      MISS: {nome: 'MISS RÔSE COSMETICOS', codigo: 'MISS', cnpj: '12.345.678/0001-90', cidade: 'São Paulo', uf: 'SP',
        condicaoPagamento: '30/60', site: 'missrose.com.br', enderecoFaturamento: 'Rua das Flores, 100, Centro, São Paulo/SP',
        ativo: true, contatosVersao: 1,
        contatos: {c1: {nome: 'Bruno Comercial', email: 'bruno@miss.com', telefone: '11 8888-0000', areas: ['COMERCIAL'], principais: ['COMERCIAL']}}},
      GLOW: {nome: 'GLOW MAKE UP', codigo: 'GLOW', cnpj: '55.555.555/0001-55', ativo: true}
    },
    fornecedores: {
      f1: {razaoSocial: 'EMBALAGENS ARAÇÁ INDUSTRIA LTDA', nomeFantasia: 'Araçá Pack', cnpj: '98765432000155',
        cep: '01310100', logradouro: 'Av. Paulista', numero: '900', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP',
        condicaoPagamento: '28 DDL', contatoNome: 'Carla Vendas', contatoEmail: 'carla@aracapack.com.br',
        contatoTelefone: '11 7777-0000', tipos: ['EMBALAGEM'], ativo: true, revisado: true},
      f2: {razaoSocial: 'GLOW MAKE UP DISTRIBUIDORA', nomeFantasia: 'Glow Distribuidora', cnpj: '55555555000155', ativo: true}
    },
    materiais: {}, produtos: {}, formulas: {}, bom: {}, especificacoes: {}, categorias: {}, config: {}, estoque: {}
  };
}

async function abrir(browser, estadoInicial, pagina) {
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
            push(v) {
              seq++;
              const filho = ref(path + '/-N' + seq);
              if (v === undefined) return filho;
              gravar(filho.path, v);
              const pr = Promise.resolve(filho); pr.key = filho.key; return pr;
            },
            set(v) { gravar(path, v); return Promise.resolve(); },
            update(obj) { Object.entries(obj).forEach(([k, v]) => gravar(path + '/' + k, v)); return Promise.resolve(); },
            remove() { gravar(path, null); return Promise.resolve(); },
            transaction(fn) { const r = fn(valor()); if (r !== undefined) gravar(path, r); return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        };
        return {ref: (p) => ref(p || '')};
      }
    };
  }, estadoInicial || dados());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'cad.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://cad.test/' + (pagina || 'cadastros.html?tab=clientes'));
  try {
    await page.waitForFunction(() => window.currentUser && window.currentUser.nome, null, {timeout: 12000});
  } catch (e) {
    console.log('DBG url', page.url(), 'erros', errors, await page.evaluate(() => [document.title, typeof window.currentUser, document.body.innerText.slice(0, 200)]));
    throw e;
  }
  return {page, errors};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser);

    // ── Cliente -> Fornecedor ──
    await page.waitForSelector('#tableBody-cli .btn-edit-cli');
    await page.click('#tableBody-cli .btn-edit-cli[data-key="MISS"]');
    await page.waitForSelector('#modalBg-cli.open');
    await page.click('#cliVirarFornecedor-cli');
    // Abriu a aba de fornecedores, com o cadastro já preenchido.
    await page.waitForSelector('#modalFornecedor-forn.open');
    assert.equal(await page.locator('#maintab-fornecedores').evaluate((e) => e.classList.contains('active')), true, 'troca de aba junto');
    assert.equal(await page.inputValue('#fnRazaoSocial-forn'), 'MISS RÔSE COSMETICOS');
    assert.equal(await page.inputValue('#fnCnpj-forn'), '12.345.678/0001-90');
    assert.equal(await page.inputValue('#fnCidade-forn'), 'São Paulo');
    assert.equal(await page.inputValue('#fnCondicaoPagamento-forn'), '30/60');
    assert.equal(await page.inputValue('#fnContatoNome-forn'), 'Bruno Comercial', 'contato comercial do cliente vira contato do fornecedor');
    assert.equal(await page.inputValue('#fnClienteVinculado-forn'), 'MISS RÔSE COSMETICOS', 'vínculo já preenchido');
    const aviso = await page.locator('#fnDupHint-forn').innerText();
    assert.match(aviso, /copiados do cliente/i);
    assert.match(aviso, /tipo de fornecedor/i, 'diz o que falta preencher');
    assert.match(aviso, /Rua das Flores, 100/, 'endereço do cliente vem como aviso, não chutado no CEP');
    assert.equal(await page.inputValue('#fnLogradouro-forn'), '', 'endereço estruturado não é inventado');

    await page.locator('.fn-tipo-chk').first().check();
    await page.click('#modalFornecedorSave-forn');
    await page.waitForFunction(() => window.__db.clientes.MISS.fornecedorVinculadoKey);
    const db1 = await page.evaluate(() => window.__db);
    const novoForn = db1.clientes.MISS.fornecedorVinculadoKey;
    assert.ok(db1.fornecedores[novoForn], 'fornecedor criado');
    assert.equal(db1.fornecedores[novoForn].razaoSocial, 'MISS RÔSE COSMETICOS');
    assert.equal(db1.fornecedores[novoForn].clienteVinculadoKey, 'MISS', 'os dois lados ficam ligados');
    assert.equal(db1.fornecedores[novoForn].ativo, true);

    // Clicar de novo não duplica: avisa que já existe o vínculo.
    await page.click('[data-maintab="clientes"]');
    await page.click('#tableBody-cli .btn-edit-cli[data-key="MISS"]');
    await page.waitForSelector('#modalBg-cli.open');
    await page.click('#cliVirarFornecedor-cli');
    await page.waitForFunction(() => /já está vinculado/.test(document.getElementById('alertBox').innerText));
    assert.equal(await page.locator('#modalFornecedor-forn.open').count(), 0, 'não abre outro cadastro');
    await page.click('#modalCancelBtn-cli');

    // ── Empresa que já existe do outro lado: vincula em vez de duplicar ──
    await page.click('#tableBody-cli .btn-edit-cli[data-key="GLOW"]');
    await page.waitForSelector('#modalBg-cli.open');
    await page.click('#cliVirarFornecedor-cli');
    await page.waitForFunction(() => /Já existe o fornecedor/.test(document.getElementById('alertBox').innerText));
    assert.equal(await page.inputValue('#cliFornecedorVinculado-cli'), 'Glow Distribuidora', 'mesmo CNPJ: vincula ao que já existe');
    assert.equal(await page.locator('#modalFornecedor-forn.open').count(), 0);
    await page.click('#modalSaveBtn-cli');
    await page.waitForFunction(() => window.__db.clientes.GLOW.fornecedorVinculadoKey === 'f2');

    // ── Fornecedor -> Cliente ──
    await page.click('[data-maintab="fornecedores"]');
    await page.waitForSelector('.fn-edit-forn[data-key="f1"]');
    await page.click('.fn-edit-forn[data-key="f1"]');
    await page.waitForSelector('#modalFornecedor-forn.open');
    await page.click('#fnVirarCliente-forn');
    await page.waitForSelector('#modalBg-cli.open');
    assert.equal(await page.locator('#maintab-clientes').evaluate((e) => e.classList.contains('active')), true);
    assert.equal(await page.inputValue('#fNome-cli'), 'Araçá Pack');
    assert.equal(await page.inputValue('#fCodigo-cli'), 'ARACAPACK', 'código sugerido a partir do nome');
    assert.equal(await page.inputValue('#fCnpj-cli'), '98765432000155');
    assert.equal(await page.inputValue('#fEnderecoFaturamento-cli'), 'Av. Paulista, 900, Bela Vista, São Paulo, SP, CEP 01310100',
      'endereço do fornecedor é estruturado: dá para montar o texto do cliente');
    assert.equal(await page.inputValue('#cliFornecedorVinculado-cli'), 'Araçá Pack');
    assert.match(await page.locator('#cliDupHint-cli').innerText(), /copiados do fornecedor/i);
    await page.click('#modalSaveBtn-cli');
    await page.waitForFunction(() => window.__db.clientes.ARACAPACK);
    const db2 = await page.evaluate(() => window.__db);
    assert.equal(db2.clientes.ARACAPACK.fornecedorVinculadoKey, 'f1');
    assert.equal(db2.fornecedores.f1.clienteVinculadoKey, 'ARACAPACK', 'os dois lados ficam ligados');
    assert.equal(db2.clientes.ARACAPACK.contatoComNome, 'Carla Vendas', 'contato do fornecedor vira contato comercial do cliente');
    assert.equal(db2.clientes.ARACAPACK.detentorAnvisa, 'cliente');
    // O cadastro original não foi tocado além do vínculo.
    assert.equal(db2.fornecedores.f1.razaoSocial, 'EMBALAGENS ARAÇÁ INDUSTRIA LTDA');
    assert.equal(db2.fornecedores.f1.tipos[0], 'EMBALAGEM');

    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    console.log('OK Cadastros: cliente vira fornecedor e fornecedor vira cliente com um botão, sem duplicar empresa já cadastrada e com os dois lados vinculados.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
