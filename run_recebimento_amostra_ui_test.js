'use strict';
/* Recebimento (19/10/2026, PC-0051): amostragem por VOLUME para kg/L e o
   aviso de erro por cima do modal. Firebase simulado (o de
   run_propriedade_estoque_ui_test.js); o callable registrarRecebimento
   responde com o erro que o teste mandar. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const geral = {geral: true, clienteKey: null, clienteNome: null, pedidos: []};
function dados() {
  return {
    'usuarios/u1': {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'},
    config: {}, clientes: {}, produtos: {}, formulas: {}, bom: {}, pedidos: {},
    fornecedores: {f1: {nomeFantasia: 'CORANTES SA'}},
    materiais: {'MPGR-00051': {mpCodigo: 'MPGR-00051', mpNome: 'SOLUCAO 1% CORANTE AMARELO', unidade: 'kg', ativo: true},
      'FR-1': {mpCodigo: 'FR-1', mpNome: 'FRASCO', unidade: 'un', ativo: true}},
    pedidos_compra: {
      pcKg: {status: 'ENVIADO', numeroFormatado: 'PC-0051', fornecedorKey: 'f1', fornecedorNome: 'CORANTES SA', dataCriacao: '2026-10-19T10:00:00Z',
        itens: {i1: {materialCodigo: 'MPGR-00051', materialNome: 'SOLUCAO 1% CORANTE AMARELO', qtd: 1, qtdRecebida: 0, unidade: 'kg', vinculo: geral}}},
      pcUn: {status: 'ENVIADO', numeroFormatado: 'PC-0052', fornecedorKey: 'f1', fornecedorNome: 'CORANTES SA', dataCriacao: '2026-10-19T10:00:00Z',
        itens: {i1: {materialCodigo: 'FR-1', materialNome: 'FRASCO', qtd: 400, qtdRecebida: 0, unidade: 'un', vinculo: geral}}}
    },
    enderecos_estoque: {A1: {codigo: 'GAL-1.1.1', area: 'GALPAO', ativo: true, rua: 1, nivel: 1, predio: 1}},
    estoque: {}, estoque_lotes: {}
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
    const callable = () => (payload) => { window.__payload = payload; return window.__erroCallable ? Promise.reject(new Error(window.__erroCallable)) : Promise.resolve({data: {lotes: []}}); };
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
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const l = await abrir(browser, 'logistica.html', 'log.test');
    const p = l.page;
    await p.evaluate(() => openModalReceber('pcKg'));
    await p.waitForSelector('#modalReceber .rc-lote-row');
    const amostra = () => p.inputValue('.rc-lote-row .rc-amostragem');
    assert.equal(await amostra(), '1', '1 kg em 1 volume: amostra de 1 volume (antes pedia 2)');
    assert.match(await p.locator('.rc-amostragem-hint').innerText(), /por volume[\s\S]*1 volume\(s\) \(todos\)/);
    await p.fill('.rc-lote-row .rc-volumes', '4');
    await p.locator('.rc-lote-row .rc-volumes').dispatchEvent('input');
    assert.equal(await amostra(), '3', '√4 volumes + 1');
    await p.fill('.rc-lote-row .rc-volumes', '1');
    await p.locator('.rc-lote-row .rc-volumes').dispatchEvent('input');

    // Preenche o resto e confirma: o servidor (simulado) recusa.
    await p.selectOption('.rc-tipo', 'MATERIA_PRIMA');
    await p.fill('.rc-identificacao', 'Corante amarelo');
    await p.fill('.rc-sku-fornecedor', 'CA-1');
    await p.fill('.rc-lote', 'L-77');
    await p.selectOption('.rc-certificado', 'SIM');
    await p.selectOption('.rc-cond-embalagem', '5');
    await p.evaluate(() => { document.querySelector('.rc-endereco').value = 'A1'; });
    await p.fill('#rcNotaFiscal', '123');
    await p.selectOption('#rcCondVeiculo', '5');
    await p.evaluate(() => { window.__erroCallable = 'internal: O recebimento de MPGR-00051 excede o saldo do pedido.'; });
    await p.click('#modalReceberSave');
    await p.waitForFunction(() => document.getElementById('alertBox').classList.contains('show'));
    assert.equal((await p.evaluate(() => window.__payload.linhas[0].qtdAmostragem)), 1, 'payload com a amostra nova');
    assert.ok(await p.locator('#modalReceber').isVisible(), 'o modal continua aberto');
    // O aviso está POR CIMA do modal: o ponto central dele é o próprio aviso.
    const porCima = await p.evaluate(() => {
      const b = document.getElementById('alertBox'), r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {fixo: getComputedStyle(b).position, topo: b.contains(el)};
    });
    assert.deepEqual(porCima, {fixo: 'fixed', topo: true});
    assert.match(await p.locator('#alertBox').innerText(), /excede o saldo do pedido/);
    if (process.env.RC_SHOT) await p.screenshot({path: process.env.RC_SHOT});
    // O timer da página tenta esconder: o erro fica.
    await p.evaluate(() => document.getElementById('alertBox').classList.remove('show'));
    await p.waitForTimeout(50);
    assert.equal(await p.evaluate(() => document.getElementById('alertBox').classList.contains('show')), true, 'erro não some sozinho');
    await p.click('#alertBox .alert-fechar');
    assert.equal(await p.evaluate(() => document.getElementById('alertBox').classList.contains('show')), false, 'fecha no ×');
    // Sucesso não ganha × e segue sumindo no tempo da página.
    await p.evaluate(() => showAlert('Tudo certo', 'success'));
    await p.waitForTimeout(50);
    assert.equal(await p.locator('#alertBox .alert-fechar').count(), 0);
    await p.evaluate(() => document.getElementById('alertBox').classList.remove('show'));
    await p.waitForTimeout(50);
    assert.equal(await p.evaluate(() => document.getElementById('alertBox').classList.contains('show')), false);

    // Unidade discreta continua √n + 1 sobre a quantidade.
    await p.evaluate(() => { closeModalReceber(); openModalReceber('pcUn'); });
    await p.waitForSelector('#modalReceber .rc-lote-row');
    assert.equal(await amostra(), '21', '400 un → √400 + 1');
    assert.deepEqual(l.errors, []);
    console.log('OK Recebimento: amostra por volume em kg/L, por quantidade em un; erro aparece por cima do modal, fica até fechar.');
    await l.context.close();
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
