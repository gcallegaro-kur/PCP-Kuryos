'use strict';
/* Compras › Cliente/pedido: só pedidos que usam o material, e o que já estava
   marcado mas NÃO usa o material aparece com aviso (caso real PC-0049, óleo
   mineral, pedidos 29 e 0020). Tela real, Firebase simulado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const dados = () => ({
  usuarios: {u1: {nome: 'Ana', email: 'a@k.com', role: 'admin'}},
  clientes: {C1: {nome: 'CLI UM', ativo: true}},
  produtos: {
    AAA01: {sku: 'AAA01', descricao: 'BODY A', clienteKey: 'C1', cliente: 'CLI UM'},
    BBB02: {sku: 'BBB02', descricao: 'HIDRATANTE B', clienteKey: 'C1', cliente: 'CLI UM'},
    CCC03: {sku: 'CCC03', descricao: 'PERFUME C', clienteKey: 'C1', cliente: 'CLI UM'}
  },
  bom: {AAA01__v1: {codProduto: 'AAA01', versao: 'v1', status: 'APROVADA', itens: {a: {materialCodigo: 'EP-FRASCO', qtdPorPeca: 1}}}},
  formulas: {BBB02__v1: {codProduto: 'BBB02', versao: 'v1', status: 'APROVADA', itens: {a: {mpCodigo: 'MPGR-ALCOOL', percentualMM: 60}}}},
  materiais: {'EP-FRASCO': {mpCodigo: 'EP-FRASCO', mpNome: 'FRASCO', unidade: 'un', ativo: true}, 'MPGR-ALCOOL': {mpCodigo: 'MPGR-ALCOOL', mpNome: 'ÁLCOOL', unidade: 'kg', ativo: true},
    'EP-SOLTO': {mpCodigo: 'EP-SOLTO', mpNome: 'CAIXA SOLTA', unidade: 'un', ativo: true}},
  pedidos: {
    '0010__AAA01': {id: '0010', parentPedidoId: '0010', sku: 'AAA01', cliente: 'CLI UM', status: 'Não Iniciado', qtdTotal: 10, produzido: 0},
    '0011__BBB02': {id: '0011', parentPedidoId: '0011', sku: 'BBB02', cliente: 'CLI UM', status: 'Não Iniciado', qtdTotal: 10, produzido: 0},
    '0012__CCC03': {id: '0012', parentPedidoId: '0012', sku: 'CCC03', cliente: 'CLI UM', status: 'Não Iniciado', qtdTotal: 10, produzido: 0}
  },
  solicitacoes_compra: {sc1: {status: 'CONSOLIDADA', pedidoKeys: ['0011__BBB02', '0010__AAA01']}},
  fornecedores: {f1: {nomeFantasia: 'FORN'}},
  pedidos_compra: {
    // vínculo salvo com um pedido que NÃO usa o frasco (o 0011 só usa álcool)
    pc1: {status: 'ENVIADO', numeroFormatado: 'PC-0100', fornecedorNome: 'FORN', dataCriacao: '2026-10-20T10:00:00Z', naturezaMovimentacao: 'COMPRA_KURYOS',
      itens: {i1: {materialCodigo: 'EP-FRASCO', materialNome: 'FRASCO', qtd: 10, unidade: 'un', qtdRecebida: 0, vinculo: {clienteKey: 'C1', clienteNome: 'CLI UM', pedidos: ['0011']}},
              i2: {materialCodigo: 'EP-SOLTO', materialNome: 'CAIXA SOLTA', qtd: 5, unidade: 'un', qtdRecebida: 0}}}
  }
});

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1600, height: 1100}});
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.addInitScript((ini) => {
      const db = JSON.parse(JSON.stringify(ini)); window.__db = db; window.__iniciado = false;
      const get = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), db);
      const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
      window.firebase = {
        initializeApp() { window.__iniciado = true; },
        auth() { return {currentUser: {uid: 'u1', email: 'a@k.com'}, onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'a@k.com', displayName: 'Ana'}), 0); }, signOut() { return Promise.resolve(); }}; },
        storage() { return {ref() { return {}; }}; }, functions() { return {httpsCallable() { return () => Promise.resolve({data: {}}); }}; },
        database() { return {ref(p) { p = p || ''; const snap = () => ({val: () => clone(p ? get(p) : db), exists: () => get(p) !== undefined, forEach() {}});
          return {path: p, once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); }, on(ev, cb) { setTimeout(() => cb(snap()), 0); return cb; }, off() {}, child() { return this; },
            orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; }, set() { return Promise.resolve(); }, update() { return Promise.resolve(); }, remove() { return Promise.resolve(); },
            push() { return Object.assign(Promise.resolve(), {key: 'k'}); }, transaction() { return Promise.resolve({committed: false, snapshot: snap()}); }}; }}; }
      };
    }, dados());
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'v.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + url.pathname.slice(1);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    await page.goto('https://v.test/compras.html?tab=pedidos');
    await page.waitForSelector('.tab[data-tab="pedidos"]', {timeout: 15000});
    await page.waitForFunction(() => typeof allPedidosCompra !== 'undefined' && allPedidosCompra.pc1 && Object.keys(allFormulasCompras).length && Object.keys(allBomCompras).length, null, {timeout: 10000});
    await page.waitForTimeout(500);
    await page.evaluate(() => abrirModalVinculoPC('pc1'));
    await page.waitForSelector('#modalVinculoPC.open');

    // Frasco: usado só pelo AAA01 (pedido 0010). O 0011 estava salvo e NÃO usa o frasco.
    const ed1 = page.locator('#vpcItens .vinc-box[data-item="i1"] .vinc-editor');
    const txt1 = await ed1.locator('.vinc-pedidos').innerText();
    assert.match(txt1, /Pedidos que usam este material/);
    assert.match(txt1, /#0010[\s\S]*AAA01/);
    assert.doesNotMatch(txt1, /#0012/, 'o pedido do CCC03 não usa o frasco: não é sugerido');
    assert.match(txt1, /Já marcados \(1 sem uso deste material\)/);
    assert.match(txt1, /#0011\s*⚠ não usa este material/, 'o salvo que não usa vem com aviso, não como sugestão');
    assert.doesNotMatch(txt1, /#0011 \(concluído\)/, 'não é "concluído"');
    assert.match(await ed1.locator('.vinc-aviso-material').innerText(), /1 pedido já marcado não usa este material/);
    assert.equal(await ed1.locator('.vinc-pedido[value="0011"]').isChecked(), true, 'continua marcado até a pessoa decidir');

    // Desmarcar os que não usam: tira o 0011 e deixa o 0010 disponível.
    await ed1.locator('.vinc-limpar-fora').click();
    assert.doesNotMatch(await ed1.locator('.vinc-pedidos').innerText(), /#0011/);
    assert.equal(await ed1.locator('.vinc-pedido[value="0010"]').count(), 1);
    assert.equal(await ed1.locator('.vinc-pedido:checked').count(), 0);
    // "Mostrar todos": volta o 0012 e o 0011, os que não usam com aviso.
    await ed1.locator('.vinc-todos-ped').check();
    const todos = await ed1.locator('.vinc-pedidos').innerText();
    assert.match(todos, /#0011\s*⚠ não usa este material/); assert.match(todos, /#0012\s*⚠ não usa este material/);
    assert.doesNotMatch(todos, /#0010\s*⚠/, 'o que usa não leva aviso');

    // Material fora de toda fórmula/BOM: não filtra, e diz isso.
    const ed2 = page.locator('#vpcItens .vinc-box[data-item="i2"] .vinc-editor');
    await ed2.locator('.vinc-cliente').selectOption('C1');
    assert.match(await ed2.locator('.vinc-aviso-material').innerText(), /não consta em nenhuma Fórmula\/BOM vigente: mostrando todos/);
    for (const id of ['0010', '0011', '0012']) assert.equal(await ed2.locator('.vinc-pedido[value="' + id + '"]').count(), 1);

    // Sugestão inicial ao criar o PC a partir da solicitação: só os pedidos de origem que usam o material.
    const sug = await page.evaluate(() => ({
      frasco: vinculoSugeridoDaSolicitacao('sc1', 'EP-FRASCO'),
      alcool: vinculoSugeridoDaSolicitacao('sc1', 'MPGR-ALCOOL'),
      solto: vinculoSugeridoDaSolicitacao('sc1', 'EP-SOLTO'),
      semMaterial: vinculoSugeridoDaSolicitacao('sc1')
    }));
    assert.deepEqual(sug.frasco.pedidos, ['0010'], 'frasco: só o pedido do AAA01');
    assert.deepEqual(sug.alcool.pedidos, ['0011'], 'álcool: só o pedido do BBB02');
    assert.deepEqual(sug.solto.pedidos.sort(), ['0010', '0011'], 'material desconhecido: sugestão como era');
    assert.deepEqual(sug.semMaterial.pedidos.sort(), ['0010', '0011']);
    // Origem que NENHUM usa: não sugere nada.
    await page.evaluate(() => { allSolicitacoes.sc2 = {status: 'CONSOLIDADA', pedidoKeys: ['0012__CCC03']}; });
    assert.equal(await page.evaluate(() => vinculoSugeridoDaSolicitacao('sc2', 'EP-FRASCO')), null);
    assert.deepEqual(erros, [], 'sem erro de página: ' + erros.join(' | '));
  } finally { await browser.close(); }
  console.log('OK Compras › Cliente/pedido: sugere só pedidos que usam o material; o salvo que não usa vem com aviso e dá para desmarcar.');
})().catch((e) => { console.error(e); process.exit(1); });
