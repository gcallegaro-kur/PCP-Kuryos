'use strict';
/* PC direto (2026-09-24): o usuário relatou "clico para gerar, o botão fica
   apagado em Criando... e nunca cria". Causa: o botão travava ANTES da
   conferência da rota, que saía com return sem destravar, e o aviso ficava
   atrás do fundo do modal. Mesmo harness de run_rotas_locais_kuryos_ui_test.js. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    'usuarios/u1': {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'},
    config: {},
    fornecedores: {f1: {nomeFantasia: 'LOMAR PACK', cnpj: '33.321.531/0001-35', cep: '07041-030', logradouro: 'Avenida Carlos Ferreira Endres',
      numero: '952', bairro: 'Vila Endres', cidade: 'Guarulhos', uf: 'SP', contatoNome: 'Ana', contatoTelefone: '11 99999-0000'}},
    pedidos_compra: {pc1: {status: 'ABERTO', numeroFormatado: 'PC-0009', fornecedorKey: 'f1', fornecedorNome: 'LOMAR PACK',
      dataCriacao: '2026-09-14T10:00:00Z', frete: {tipo: 'CIF'}, localEntrega: null,
      itens: {i1: {materialCodigo: 'EP-00036', materialNome: 'Frasco', qtd: 100, unidade: 'un', precoUnit: 1}}}}
  };
}
const VIACEP = {
  '01310100': {cep: '01310-100', logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP'},
  '08295010': {cep: '08295-010', logradouro: 'Rua Benedito Coelho Netto', bairro: 'Itaquera', localidade: 'São Paulo', uf: 'SP'}
};

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1500, height: 1200}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.addInitScript(({data, viacep}) => {
      window.__writes = [];
      window.__iniciado = false;
      const exige = q => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
      window.fetch = url => {
        const m = /viacep\.com\.br\/ws\/(\d{8})\/json/.exec(String(url));
        const body = m && viacep[m[1]] ? viacep[m[1]] : {erro: true};
        return new Promise(r => setTimeout(() => r({ok: true, status: 200, json: () => Promise.resolve(body)}), 30));
      };
      window.firebase = {
        initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
        auth() {
          exige('auth');
          return {onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), 0); },
            signOut() { return Promise.resolve(); }, currentUser: {email: 'g@kuryos.com'}};
        },
        functions() { return {httpsCallable: () => () => Promise.resolve({data: {}})}; },
        app() { return {functions: () => ({httpsCallable: () => () => Promise.resolve({data: {}})})}; },
        database() {
          exige('database');
          const ref = path => {
            const snap = {val: () => (path in data ? structuredClone(data[path]) : null), exists: () => path in data, key: String(path).split('/').pop()};
            return {path, key: 'k' + Math.random().toString(36).slice(2, 8),
              once(ev, cb) { if (cb) cb(snap); return Promise.resolve(snap); },
              on(ev, cb) { setTimeout(() => cb(snap), 0); return cb; }, off() {},
              child(p) { return ref(path + '/' + p); }, push() { return ref(path + '/k' + Math.random().toString(36).slice(2, 8)); },
              orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
              set(v) { window.__writes.push({op: 'set', path, v}); return Promise.resolve(); },
              update(v) { window.__writes.push({op: 'update', path, v}); return Promise.resolve(); },
              remove() { return Promise.resolve(); },
              transaction(fn) { const v = fn(null); return Promise.resolve({committed: true, snapshot: {val: () => v}}); }};
          };
          return {ref, ServerValue: {TIMESTAMP: 0}};
        }
      };
    }, {data: dados(), viacep: VIACEP});
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'cmp.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + url.pathname.slice(1);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file),
        contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    await page.goto('https://cmp.test/compras.html');
    await page.waitForSelector('.kt-sidebar', {timeout: 8000});
    await page.waitForFunction(() => window.currentUser && window.currentUser.role === 'admin', null, {timeout: 8000});

    // ── Rota NÃO confirmada: avisa por cima do modal e o botão não trava ──
    await page.click('.tab[data-tab="pedidos"]');
    await page.click('#btnPcDireto');
    await page.waitForSelector('#pcdDestinoNome');
    await page.evaluate(() => {
      document.getElementById('pcdFornecedorKey').value = 'f1';
      document.getElementById('pcdFornecedor').value = 'LOMAR PACK';
      document.getElementById('pcdMotivo').value = 'COMPRA_DIRETA';
      pcdItensBuilder = [{materialCodigo: 'EP-00036', qtd: 100, precoUnit: 1}];
      // O vínculo (cliente/pedido) tem editor próprio, fora do que se testa aqui.
      window.lerVinculoEditor = () => ({usoConsumo: true});
      PropriedadeEstoque.vinculoAceito = () => true;
      RotasPC.preencherEditor('pcdOrigem', RotasPC.origemFornecedor(allFornecedores.f1, 'f1', 'LOMAR PACK'));
    });
    await page.click('.rota-atalho[data-local="pcdDestino"][data-chave="FABRICA"]');
    assert.equal(await page.isChecked('#pcdRotaConfirmada'), false);
    await page.click('#modalPcdSave');
    await page.waitForSelector('#alertBox.show');
    assert.match(await page.locator('#alertBox').innerText(), /confirmação da rota/);
    // O aviso aparece POR CIMA do modal (antes ficava atrás do fundo escuro).
    const noTopo = await page.evaluate(() => {
      // pointer-events:none (o aviso não bloqueia cliques) tira o elemento do
      // elementsFromPoint; liga só para medir quem está por cima.
      const box = document.getElementById('alertBox');
      box.style.pointerEvents = 'auto';
      const r = box.getBoundingClientRect();
      const el = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      box.style.pointerEvents = '';
      return !!el[0] && (el[0].id === 'alertBox' || !!el[0].closest('#alertBox'));
    });
    assert.equal(noTopo, true, 'aviso visível acima do modal');
    assert.equal(await page.isDisabled('#modalPcdSave'), false, 'botão não fica travado');
    assert.equal(await page.innerText('#modalPcdSave'), 'Criar e liberar pra recebimento');
    assert.equal((await page.evaluate(() => window.__writes)).filter((w) => String(w.path).startsWith('pedidos_compra/')).length, 0, 'nada gravado');

    // ── Rota confirmada: cria o PC e destrava ──────────────────────────
    await page.check('#pcdRotaConfirmada');
    await page.click('#modalPcdSave');
    await page.waitForFunction(() => window.__writes.some((w) => String(w.path).startsWith('pedidos_compra/') && w.op === 'set'));
    const pc = (await page.evaluate(() => window.__writes)).find((w) => String(w.path).startsWith('pedidos_compra/') && w.op === 'set').v;
    assert.equal(pc.status, 'ENVIADO');
    assert.equal(pc.fornecedorKey, 'f1');
    assert.equal(pc.origemDireta, true);
    assert.equal(pc.rota.statusConfirmacao, 'CONFIRMADA');
    assert.equal(Object.values(pc.itens)[0].qtd, 100);
    await page.waitForFunction(() => !document.getElementById('modalPcDireto').classList.contains('open'));
    assert.equal(await page.isDisabled('#modalPcdSave'), false);
    assert.equal(await page.innerText('#modalPcdSave'), 'Criar e liberar pra recebimento');
    assert.deepEqual(errors, []);
    console.log('run_pc_direto_ui_test: OK (rota sem confirmar avisa acima do modal sem travar o botão; confirmada cria o PC)');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
