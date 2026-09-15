'use strict';
/* Propriedade do estoque, telas de verdade (2026-09-15):
   - Compras: PC mostra de quem é e o que falta; "🔗 Cliente/pedido" grava o
     vínculo por item (pedidos do cliente pelo produto, vários, concluídos só
     sob pedido); dono fixo pela natureza; "Marcar Enviado" barra PC incompleto.
   - Logística: recebimento trava PC sem vínculo e mostra dono/destino.
   - Estoque: filtro de cliente com as duas vistas, coluna dono/destino e
     ajuste de saldo por dono.
   Firebase simulado fiel ao SDK que registra cada escrita. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const vinc = {clienteKey: 'MRAR', clienteNome: 'MISS ROSE', pedidos: ['0006']};
function dados() {
  return {
    'usuarios/u1': {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'},
    config: {},
    clientes: {MRAR: {nome: 'MISS ROSE', ativo: true}, SEUNO: {nome: 'SEUNOURA BEAUTY LTDA', ativo: true}},
    produtos: {MRARBS05: {clienteKey: 'MRAR', cliente: 'MISS RÔSE'}, MRARBS08: {clienteKey: 'MRAR'}, 'BSP-SEUN-0001': {cliente: 'SEUNOURA', clienteKey: 'SEUNO'}},
    pedidos: {
      '0006__MRARBS05': {id: '0006', parentPedidoId: '0006', sku: 'MRARBS05', cliente: 'MISS RÔSE', status: 'Produção Parcial', qtdTotal: 10, produzido: 1},
      '0011__MRARBS08': {id: '0011', parentPedidoId: '0011', sku: 'MRARBS08', cliente: 'MISS RÔSE', status: 'Concluído', qtdTotal: 10, produzido: 10},
      '26__HID-SEUN-0001': {id: '26', sku: 'HID-SEUN-0001', cliente: 'SEUNOURA', status: 'Não Iniciado', qtdTotal: 5, produzido: 0}
    },
    fornecedores: {f1: {nomeFantasia: 'FLASH ETIQUETAS'}},
    materiais: {'VAL-1': {mpCodigo: 'VAL-1', mpNome: 'VÁLVULA 24/410', unidade: 'un', ativo: true}, 'FR-1': {mpCodigo: 'FR-1', mpNome: 'FRASCO', unidade: 'un', ativo: true}},
    pedidos_compra: {
      pc1: {status: 'ABERTO', numeroFormatado: 'PC-0007', fornecedorKey: 'f1', fornecedorNome: 'FLASH ETIQUETAS', dataCriacao: '2026-09-15T10:00:00Z',
        itens: {i1: {materialCodigo: 'VAL-1', materialNome: 'VÁLVULA 24/410', qtd: 100, unidade: 'un'}, i2: {materialCodigo: 'FR-1', materialNome: 'FRASCO', qtd: 50, unidade: 'un'}}},
      pc3: {status: 'RECEBIDO_PARCIAL', numeroFormatado: 'PC-0004', naturezaMovimentacao: 'REMESSA_TERCEIRO', origemNome: 'LOMAR PACK', dataCriacao: '2026-09-10T10:00:00Z',
        itens: {i1: {materialCodigo: 'VAL-1', materialNome: 'VÁLVULA 24/410', qtd: 100, qtdRecebida: 40, unidade: 'un'}}},
      pcOk: {status: 'ENVIADO', numeroFormatado: 'PC-0008', naturezaMovimentacao: 'REMESSA_CLIENTE', origemNome: 'MISS ROSE', dataCriacao: '2026-09-15T11:00:00Z',
        itens: {i1: {materialCodigo: 'VAL-1', materialNome: 'VÁLVULA 24/410', qtd: 100, qtdRecebida: 0, unidade: 'un', vinculo: vinc}}}
    },
    enderecos_estoque: {DOC: {codigo: 'DOC-1.1.1', area: 'DOCA', ativo: true, rua: 1, nivel: 1, predio: 1}, A1: {codigo: 'GAL-1.1.1', area: 'GALPAO', ativo: true, rua: 1, nivel: 1, predio: 1}},
    estoque: {'VAL-1': {materialCodigo: 'VAL-1', materialNome: 'VÁLVULA 24/410', unidade: 'un', saldoAtual: 170, porCliente: {MRAR: {saldoAtual: 100, clienteNome: 'MISS ROSE'}}}},
    estoque_lotes: {'VAL-1': {
      c1: {itemTipo: 'material', itemCodigo: 'VAL-1', itemNome: 'VÁLVULA 24/410', unidade: 'un', saldoLote: 100, status: 'LIBERADO', enderecoKey: 'DOC', enderecoCodigo: 'DOC-1.1.1',
        loteInterno: 'AK-2026-000701', propriedade: {tipo: 'CLIENTE', clienteKey: 'MRAR', clienteNome: 'MISS ROSE'}, destino: vinc},
      k1: {itemTipo: 'material', itemCodigo: 'VAL-1', itemNome: 'VÁLVULA 24/410', unidade: 'un', saldoLote: 50, status: 'LIBERADO', enderecoKey: 'A1', enderecoCodigo: 'GAL-1.1.1',
        loteInterno: 'AK-2026-000702', propriedade: {tipo: 'KURYOS', clienteKey: null, clienteNome: null}, destino: vinc},
      g1: {itemTipo: 'material', itemCodigo: 'VAL-1', itemNome: 'VÁLVULA 24/410', unidade: 'un', saldoLote: 20, status: 'LIBERADO', enderecoKey: 'A1', enderecoCodigo: 'GAL-1.1.1', loteOrigem: 'ANTIGO'}
    }}
  };
}

async function abrir(browser, pagina, host) {
  const context = await browser.newContext({viewport: {width: 1500, height: 1100}, timezoneId: 'America/Sao_Paulo'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(({data}) => {
    window.__writes = [];
    window.__iniciado = false;
    const exige = (q) => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
    const callable = () => () => Promise.resolve({data: {}});
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() {
        exige('auth');
        return {onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), 0); },
          signOut() { return Promise.resolve(); }, currentUser: {email: 'g@kuryos.com'}};
      },
      functions() { return {httpsCallable: callable}; },
      app() { return {functions: () => ({httpsCallable: callable})}; },
      database() {
        exige('database');
        // Caminho aninhado resolve a partir do nó carregado mais próximo (estoque/VAL-1 dentro de estoque).
        const valor = (path) => {
          if (path in data) return data[path];
          const partes = String(path || '').split('/');
          for (let i = partes.length - 1; i > 0; i--) {
            const base = partes.slice(0, i).join('/');
            if (base in data) return partes.slice(i).reduce((o, k) => (o == null ? undefined : o[k]), data[base]);
          }
          return undefined;
        };
        const ref = (path) => {
          const snap = {val: () => (valor(path) === undefined ? null : structuredClone(valor(path))), exists: () => valor(path) !== undefined, key: String(path).split('/').pop()};
          return {path, key: 'k' + Math.random().toString(36).slice(2, 8),
            once(ev, cb) { if (cb) cb(snap); return Promise.resolve(snap); },
            on(ev, cb) { setTimeout(() => cb(snap), 0); return cb; }, off() {},
            // Como o SDK: a promessa resolve com uma referência comum (não "thenable",
            // senão Promise.all ficaria resolvendo a própria referência para sempre).
            child(p) { return ref(path + '/' + p); }, push(v) { const caminho = path + '/k' + Math.random().toString(36).slice(2, 8); if (v !== undefined) window.__writes.push({op: 'push', path, v}); return Object.assign(ref(caminho), {then: (a, b) => Promise.resolve(ref(caminho)).then(a, b)}); },
            orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
            set(v) { window.__writes.push({op: 'set', path, v}); return Promise.resolve(); },
            update(v) { window.__writes.push({op: 'update', path: path || '/', v}); return Promise.resolve(); },
            remove() { return Promise.resolve(); },
            transaction(fn) {
              const antes = valor(path) === undefined ? null : structuredClone(valor(path));
              const v = fn(antes);
              window.__writes.push({op: 'transaction', path, v: v === undefined ? null : structuredClone(v)});
              return Promise.resolve({committed: v !== undefined, snapshot: {val: () => v, exists: () => v != null}});
            }};
        };
        return {ref, ServerValue: {TIMESTAMP: 0}};
      }
    };
  }, {data: dados()});
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== host) return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://' + host + '/' + pagina);
  await page.waitForFunction(() => window.PropriedadeEstoque, null, {timeout: 8000});
  await page.waitForTimeout(400);
  return {page, errors, context};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'}).catch(() => chromium.launch({headless: true, channel: 'msedge'}));
  let n = 0;
  const ok = (nome) => { n++; console.log('ok -', nome); };
  try {
    // ── Compras ──
    const c = await abrir(browser, 'compras.html', 'cmp.test');
    let p = c.page;
    await p.evaluate(() => { const t = document.querySelector('[data-tab="pedidos"]') || Array.from(document.querySelectorAll('.tab')).find((x) => /Pedidos de Compra/.test(x.textContent)); if (t) t.click(); });
    await p.waitForSelector('#pcBody tr');
    const linhaPc1 = p.locator('#pcBody tr', {hasText: 'PC-0007'});
    assert.match(await linhaPc1.innerText(), /🏭 Kuryos/);
    assert.match(await linhaPc1.innerText(), /falta cliente\/pedido — não pode ser recebido/);
    assert.match(await p.locator('#pcBody tr', {hasText: 'PC-0008'}).innerText(), /📦 Material do cliente · MISS ROSE · pedido 0006/);
    assert.match(await p.locator('#pcBody tr', {hasText: 'PC-0004'}).innerText(), /❔ Dono não definido/);
    ok('lista de PCs mostra de quem é, destino e o que falta');

    // Marcar Enviado com rota confirmada mas sem vínculo: barra e abre o modal.
    await p.evaluate(() => {
      allPedidosCompra.pc1.rota = {statusConfirmacao: 'CONFIRMADA'};
      window.RotasPC.validarRota = () => ({pronto: true, faltando: []});
      marcarPedidoEnviado('pc1');
    });
    await p.waitForSelector('#modalVinculoPC.open');
    assert.equal((await p.evaluate(() => window.__writes)).filter((w) => /status/.test(JSON.stringify(w.v || ''))).length, 0, 'não marcou enviado');
    ok('Marcar Enviado barra PC sem cliente/pedido e abre o vínculo');

    assert.equal(await p.inputValue('#vpcPropriedade'), 'KURYOS');
    assert.equal(await p.locator('#vpcPropriedade').isDisabled(), true, 'compra é sempre da Kuryos');
    const ed1 = p.locator('#vpcItens .vinc-box[data-item="i1"] .vinc-editor');
    await ed1.locator('.vinc-cliente').selectOption('MRAR');
    const pedidosTxt = await ed1.locator('.vinc-pedidos').innerText();
    assert.match(pedidosTxt, /#0006/);
    assert.doesNotMatch(pedidosTxt, /#0011/, 'concluído só com o filtro');
    await ed1.locator('.vinc-concluidos').check();
    assert.match(await ed1.locator('.vinc-pedidos').innerText(), /#0011 \(concluído\)/);
    // Salvar com item 2 vazio: recusa.
    await ed1.locator('.vinc-pedido[value="0006"]').check();
    await p.evaluate(() => { window.__writes = []; });
    await p.click('#vpcSalvar');
    assert.match(await p.locator('#alertBox').innerText(), /FR-1.*escolha o cliente e ao menos um pedido/);
    assert.equal((await p.evaluate(() => window.__writes)).length, 0);
    // Aplicar a todos.
    const todos = p.locator('#vpcTodosBox .vinc-editor');
    await todos.locator('.vinc-cliente').selectOption('MRAR');
    await todos.locator('.vinc-concluidos').check();
    await todos.locator('.vinc-pedido[value="0006"]').check();
    await todos.locator('.vinc-pedido[value="0011"]').check();
    await p.click('#vpcAplicarTodos');
    await p.click('#vpcSalvar');
    const w = (await p.evaluate(() => window.__writes)).find((x) => x.op === 'update' && x.v['pedidos_compra/pc1/itens/i2/vinculo']);
    assert.deepEqual(w.v['pedidos_compra/pc1/itens/i1/vinculo'], {clienteKey: 'MRAR', clienteNome: 'MISS ROSE', pedidos: ['0006', '0011']});
    assert.deepEqual(w.v['pedidos_compra/pc1/itens/i2/vinculo'], {clienteKey: 'MRAR', clienteNome: 'MISS ROSE', pedidos: ['0006', '0011']});
    assert.equal('pedidos_compra/pc1/propriedade' in w.v, false, 'dono fixo pela natureza não é regravado');
    ok('vínculo por item: pedidos do cliente, vários, aplicar a todos e salvar');

    // Pedido cujo SKU não tem produto (26, SEUNOURA): aparece pelo nome curto.
    await p.evaluate(() => abrirModalVinculoPC('pc3'));
    await p.waitForSelector('#modalVinculoPC.open');
    assert.equal(await p.locator('#vpcPropriedade').isDisabled(), false, 'terceiro: quem compra escolhe');
    const ed3 = p.locator('#vpcItens .vinc-box[data-item="i1"]');
    assert.match(await ed3.innerText(), /Parte já entrou antes desta regra/);
    await ed3.locator('.vinc-cliente').selectOption('SEUNO');
    assert.match(await ed3.locator('.vinc-pedidos').innerText(), /#26/);
    await ed3.locator('.vinc-pedido[value="26"]').check();
    await p.evaluate(() => { window.__writes = []; });
    await p.click('#vpcSalvar');
    assert.match(await p.locator('#alertBox').innerText(), /Defina de quem é o material/);
    await p.selectOption('#vpcPropriedade', 'CLIENTE');
    await p.click('#vpcSalvar');
    const w3 = (await p.evaluate(() => window.__writes)).find((x) => x.op === 'update');
    assert.equal(w3.v['pedidos_compra/pc3/propriedade'].tipo, 'CLIENTE');
    assert.deepEqual(w3.v['pedidos_compra/pc3/itens/i1/vinculo'].pedidos, ['26']);
    ok('remessa de terceiro: escolhe o dono; pedido sem produto aparece pelo nome');

    // PC direto: dono pela natureza e editor de cliente/pedido.
    await p.evaluate(() => openModalPcDireto());
    await p.waitForSelector('#modalPcDireto.open #pcdVinculo .vinc-cliente');
    assert.equal(await p.inputValue('#pcdPropriedade'), 'KURYOS');
    assert.equal(await p.locator('#pcdPropriedade').isDisabled(), true);
    await p.selectOption('#pcdNatureza', 'REMESSA_CLIENTE');
    assert.equal(await p.inputValue('#pcdPropriedade'), 'CLIENTE');
    await p.selectOption('#pcdNatureza', 'REMESSA_TERCEIRO');
    assert.equal(await p.locator('#pcdPropriedade').isDisabled(), false);
    ok('PC direto: dono pela natureza e cliente/pedido no formulário');
    assert.deepEqual(c.errors, []);
    await c.context.close();

    // ── Logística ──
    const l = await abrir(browser, 'logistica.html', 'log.test');
    p = l.page;
    await p.evaluate(() => openModalReceber('pc1'));
    await p.waitForSelector('#modalReceber');
    assert.match(await p.locator('#rcPropriedadeBox').innerText(), /ainda não pode ser recebido/);
    assert.equal(await p.locator('#modalReceberSave').isDisabled(), true);
    await p.evaluate(() => openModalReceber('pcOk'));
    assert.match(await p.locator('#rcPropriedadeBox').innerText(), /Material de propriedade do cliente/);
    assert.equal(await p.locator('#modalReceberSave').isDisabled(), false);
    assert.match(await p.locator('#rcItensBody').innerText(), /Proprietário: MISS ROSE · pedido 0006/);
    ok('recebimento trava PC incompleto e mostra dono/destino');
    assert.deepEqual(l.errors, []);
    await l.context.close();

    // ── Estoque ──
    const e = await abrir(browser, 'estoque.html', 'est.test');
    p = e.page;
    await p.waitForSelector('#esBody tr');
    assert.match(await p.locator('#esBody tr').first().innerText(), /Kuryos 70 · MISS ROSE 100/);
    await p.selectOption('#propCliente', 'MRAR');
    await p.waitForSelector('#esCardCliente:not([style*="none"])');
    let cli = await p.locator('#esBodyCliente').innerText();
    assert.match(cli, /VAL-1/);
    assert.match(cli, /100 un/);
    assert.match(cli, /0006/);
    assert.match(await p.locator('#esCountCliente').innerText(), /Propriedade de MISS ROSE/i);
    await p.selectOption('#propVista', 'DESTINADO');
    cli = await p.locator('#esBodyCliente').innerText();
    assert.match(cli, /50 un/, 'destinado: o lote da Kuryos comprado para o pedido');
    ok('Saldo Agregado: partes por dono e as duas vistas do cliente');

    await p.click('[data-tab="lotes"]');
    await p.waitForSelector('#slBody tr');
    const lotes = await p.locator('#slBody tr').allInnerTexts();
    assert.equal(lotes.length, 1);
    assert.match(lotes[0], /AK-2026-000702/);
    assert.match(lotes[0], /Kuryos\s*→ MISS ROSE · pedido 0006/);
    await p.selectOption('#propVista', 'PROPRIEDADE');
    const lotesProp = await p.locator('#slBody tr').allInnerTexts();
    assert.equal(lotesProp.length, 1);
    assert.match(lotesProp[0], /AK-2026-000701/);
    assert.match(lotesProp[0], /do cliente MISS ROSE/);
    await p.selectOption('#propCliente', '');
    assert.equal((await p.locator('#slBody tr').allInnerTexts()).length, 3, 'sem cliente, todos os lotes');
    await p.click('[data-tab="historico"]');
    assert.equal(await p.locator('#propBarWrap').isVisible(), false, 'filtro some onde não vale');
    ok('Saldo por Lote: filtro e coluna dono/destino');

    await p.click('[data-tab="agregado"]');
    await p.evaluate(() => abrirModalAjusteEstoque('VAL-1'));
    assert.match(await p.locator('#aeSaldoAtualHint').innerText(), /Kuryos \(geral\): 70 un · total do material: 170/);
    await p.selectOption('#aeDono', 'MRAR');
    assert.match(await p.locator('#aeSaldoAtualHint').innerText(), /do cliente MISS ROSE: 100/);
    await p.fill('#aeNovoSaldo', '90');
    await p.fill('#aeJustificativa', 'contagem física');
    await p.evaluate(() => { window.__writes = []; });
    await p.click('#modalAjusteEstoqueSave');
    await p.waitForFunction(() => window.__writes.some((x) => x.op === 'push'));
    const tx = (await p.evaluate(() => window.__writes)).find((x) => x.op === 'transaction');
    assert.equal(tx.v.saldoAtual, 160, 'total = 170 − 100 + 90');
    assert.equal(tx.v.porCliente.MRAR.saldoAtual, 90);
    const mov = (await p.evaluate(() => window.__writes)).find((x) => x.op === 'push' && x.path === 'movimentos_estoque/VAL-1');
    assert.equal(mov.v.qtd, -10);
    assert.equal(mov.v.propriedade.clienteKey, 'MRAR');
    ok('ajuste de saldo pelo dono recompõe o total');
    assert.deepEqual(e.errors, []);
    await e.context.close();
  } finally {
    await browser.close();
  }
  console.log('\n' + n + ' casos ok');
})().catch((err) => { console.error(err); process.exit(1); });
