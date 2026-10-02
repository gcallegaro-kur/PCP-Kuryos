'use strict';
/* Confirmar rota e enviar (02/10): o PC nascido da cotação vem com a rota
   PENDENTE e só o Editar (admin) a confirmava -- quem compra não conseguia
   "Marcar Enviado". Agora o próprio botão abre um modal só de rota + envio.
   Usuário aqui NÃO é admin (logística com módulo Compras). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    'usuarios/u1': {nome: 'Ana Compras', email: 'g@kuryos.com', role: 'logistica', modulos: {compras: true, logistica: true}},
    config: {locaisKuryos: {FABRICA: {nome: 'Fábrica Kuryos', cnpj: '00.767.554/0001-19', cep: '08290-000', logradouro: 'Rua Lagoa Tai Grande', numero: '1130', bairro: 'Vila Carmosina', cidade: 'São Paulo', uf: 'SP'}}},
    fornecedores: {f1: {nomeFantasia: 'LOMAR PACK', cnpj: '33.321.531/0001-35', cep: '07041-030', logradouro: 'Avenida Carlos Ferreira Endres',
      numero: '952', bairro: 'Vila Endres', cidade: 'Guarulhos', uf: 'SP', contatoNome: 'Ana', contatoTelefone: '11 99999-0000'}},
    pedidos_compra: {pc1: {status: 'ABERTO', numeroFormatado: 'PC-0031', fornecedorKey: 'f1', fornecedorNome: 'LOMAR PACK',
      dataCriacao: '2026-10-01T10:00:00Z', frete: {tipo: 'CIF'}, localEntrega: 'FABRICA', propriedade: {tipo: 'KURYOS'},
      itens: {i1: {materialCodigo: 'EP-00036', materialNome: 'Frasco', qtd: 100, unidade: 'un', precoUnit: 1, vinculo: {geral: true}}}}}
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
              update(v) { window.__writes.push({op: 'update', path, v}); if (window.__aoGravar) window.__aoGravar(path, v); return Promise.resolve(); },
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
    await page.waitForFunction(() => window.currentUser && window.currentUser.role === 'logistica', null, {timeout: 8000});

    // ── Botão Marcar Enviado com rota pendente: abre o modal (antes dava erro) ──
    await page.click('.tab[data-tab="pedidos"]');
    await page.waitForSelector('.pc-enviar');
    assert.equal(await page.evaluate(() => podeEditarPC(allPedidosCompra.pc1)), false, 'continua sem poder editar o pedido');
    await page.click('.pc-enviar');
    await page.waitForSelector('#modalRotaEnvio.open');
    assert.match(await page.locator('#pcEnvTitulo').innerText(), /PC-0031/);
    // Rota vem preenchida (fornecedor -> Fábrica), mas não confirmada.
    assert.equal(await page.inputValue('#pcEnvOrigemLogradouro'), 'Avenida Carlos Ferreira Endres');
    assert.equal(await page.inputValue('#pcEnvDestinoLogradouro'), 'Rua Lagoa Tai Grande');
    assert.equal(await page.isChecked('#pcEnvRotaConfirmada'), false);
    // Sem marcar a confirmação, não envia.
    await page.click('#pcEnvSalvar');
    assert.equal(await page.evaluate(() => window.__writes.filter((w) => w.op === 'update').length), 0, 'sem confirmação não grava');
    await page.check('#pcEnvRotaConfirmada');
    await page.click('#pcEnvSalvar');
    await page.waitForFunction(() => window.__writes.some((w) => w.op === 'update' && w.v && w.v['pedidos_compra/pc1/status'] === 'ENVIADO'));
    const u = await page.evaluate(() => window.__writes.find((w) => w.op === 'update' && w.v['pedidos_compra/pc1/status']).v);
    assert.equal(u['pedidos_compra/pc1/rota'].statusConfirmacao, 'CONFIRMADA');
    assert.equal(u['pedidos_compra/pc1/rota'].confirmadaPor, 'Ana Compras');
    assert.equal(u['pedidos_compra/pc1/transporte/responsavel'], 'REMETENTE', 'CIF: o fornecedor entrega');
    assert.equal(u['pedidos_compra/pc1/enviadoPor'], 'Ana Compras');
    assert.ok(u['pedidos_compra/pc1/dataEmissao']);
    // Nada além de rota, transporte e envio: itens, preços e condições intactos.
    assert.deepEqual(Object.keys(u).filter((k) => !/\/(rota|transporte\/responsavel|transporte\/acaoLogistica|status|dataEmissao|enviadoPor)$/.test(k)), []);
    assert.equal(await page.evaluate(() => document.getElementById('modalRotaEnvio').classList.contains('open')), false);

    assert.deepEqual(errors, [], 'erros de página: ' + errors.join(' | '));
    console.log('OK Confirmar rota e enviar: quem compra (não admin) confirma a rota e marca enviado, sem editar o pedido.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
