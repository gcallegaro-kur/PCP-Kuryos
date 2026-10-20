'use strict';
/* Recebimento: peso de CADA volume (20/10/2026). 330 kg chegaram em 7 volumes,
   6 de 50 kg e 1 de 30. A Logística digita "6x50 + 30"; a tela confere com a
   quantidade, trava o que não fecha e a etiqueta sai com o peso de cada volume.
   Firebase simulado (o de run_recebimento_amostra_ui_test.js). */
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
        itens: {i1: {materialCodigo: 'MPGR-00051', materialNome: 'SOLUCAO 1% CORANTE AMARELO', qtd: 330, qtdRecebida: 0, unidade: 'kg', vinculo: geral}}},
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
    const callable = () => (payload) => { window.__payload = payload; return window.__erroCallable ? Promise.reject(new Error(window.__erroCallable)) : Promise.resolve({data: {lotes: window.__lotesResposta || []}}); };
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
    await p.addInitScript(() => {});
    await p.evaluate(() => {
      window.open = () => ({document: {write(h) { window.__html = h; }, close() {}}});
      window.__lotesResposta = [{loteInterno: 'AK-2026-000630', loteOrigem: 'L-77', materialCodigo: 'MPGR-00051', materialNome: 'SOLUCAO 1% CORANTE AMARELO',
        quantidade: 330, qtdVolumes: 7, unidade: 'kg', enderecoCodigo: 'GAL-1.1.1', dataRecebimento: '2026-10-20', fornecedorNome: 'CORANTES SA', notaFiscal: '123'}];
    });
    await p.evaluate(() => openModalReceber('pcKg'));
    await p.waitForSelector('#modalReceber .rc-lote-row');
    assert.equal(await p.inputValue('.rc-lote-row .rc-qtd'), '330');
    const hint = () => p.locator('.rc-lote-row .rc-pesos-hint').innerText();
    assert.match(await hint(), /Vazio = divide igual/);

    // 6 de 50 + 1 de 30: fecha com a quantidade e já ajusta o nº de volumes.
    await p.fill('.rc-lote-row .rc-pesos', '6x50 + 30');
    assert.equal(await p.inputValue('.rc-lote-row .rc-volumes'), '7', 'volumes acompanham os pesos');
    assert.match(await hint(), /6 × 50 \+ 1 × 30 = 330 kg ✓ fecha com a quantidade/);
    assert.equal(await p.inputValue('.rc-lote-row .rc-amostragem'), '4', 'amostra por volume: √7 + 1');

    // Não fecha: diz quanto falta e trava o salvar (com o resto preenchido).
    await p.selectOption('.rc-tipo', 'MATERIA_PRIMA');
    await p.fill('.rc-identificacao', 'Corante amarelo');
    await p.fill('.rc-sku-fornecedor', 'CA-1');
    await p.fill('.rc-lote', 'L-77');
    await p.selectOption('.rc-certificado', 'SIM');
    await p.selectOption('.rc-cond-embalagem', '5');
    await p.evaluate(() => { document.querySelector('.rc-endereco').value = 'A1'; });
    await p.fill('#rcNotaFiscal', '123');
    await p.selectOption('#rcCondVeiculo', '5');
    await p.fill('.rc-lote-row .rc-pesos', '6x50 + 20');
    assert.match(await hint(), /somam 320 e a quantidade é 330 \(faltam 10\)/);
    await p.evaluate(() => { window.__payload = null; });
    await p.click('#modalReceberSave');
    await p.waitForFunction(() => document.getElementById('alertBox').classList.contains('show'));
    assert.match(await p.locator('#alertBox').innerText(), /Peso dos volumes:.*somam 320 e a quantidade é 330/);
    assert.equal(await p.evaluate(() => window.__payload), null, 'nada foi enviado ao servidor');
    // Texto que não entendo.
    await p.fill('.rc-lote-row .rc-pesos', '6xabc');
    assert.match(await hint(), /Não entendi "6xabc"/);
    // Volumes diferentes do descrito.
    await p.fill('.rc-lote-row .rc-pesos', '6x50 + 30');
    await p.fill('.rc-lote-row .rc-volumes', '5');
    await p.locator('.rc-lote-row .rc-volumes').dispatchEvent('input');
    assert.match(await hint(), /descrevem 7 volume\(s\), mas o campo de volumes tem 5/);

    // Corrige e confirma: o servidor recebe os pesos e a etiqueta sai com eles.
    await p.fill('.rc-lote-row .rc-pesos', '6x50 + 30');
    assert.equal(await p.inputValue('.rc-lote-row .rc-volumes'), '7');
    await p.click('#modalReceberSave');
    await p.waitForFunction(() => window.__html, null, {timeout: 8000});
    const linha = await p.evaluate(() => window.__payload.linhas[0]);
    assert.deepEqual(linha.volumesPesos, [50, 50, 50, 50, 50, 50, 30]);
    assert.equal(linha.qtdVolumes, 7); assert.equal(linha.qtdRecebida, 330);
    const html = await p.evaluate(() => window.__html);
    const etiquetas = html.split('<section class="etq">').slice(1);
    assert.equal(etiquetas.length, 7);
    const qtd = (c) => /<b>Quantidade<\/b><span>([^<]*)<\/span>/.exec(c)[1];
    assert.equal(qtd(etiquetas[0]), '50 kg · volume 1 de 7 (total 330 kg)');
    assert.equal(qtd(etiquetas[5]), '50 kg · volume 6 de 7 (total 330 kg)');
    assert.equal(qtd(etiquetas[6]), '30 kg · volume 7 de 7 (total 330 kg)', 'o último volume é o de 30 kg');

    // Sem pesos digitados: continua dividindo igual (e manda null ao servidor).
    await p.evaluate(() => {
      window.__html = null; window.__payload = null;
      window.__lotesResposta = [{loteInterno: 'AK-2026-000631', loteOrigem: 'L-77', materialCodigo: 'MPGR-00051', materialNome: 'SOLUCAO 1% CORANTE AMARELO',
        quantidade: 330, qtdVolumes: 7, unidade: 'kg', enderecoCodigo: 'GAL-1.1.1', dataRecebimento: '2026-10-20', fornecedorNome: 'CORANTES SA', notaFiscal: '123'}];
      closeModalReceber(); openModalReceber('pcKg');
    });
    await p.waitForSelector('#modalReceber .rc-lote-row');
    await p.fill('.rc-lote-row .rc-volumes', '7');
    await p.locator('.rc-lote-row .rc-volumes').dispatchEvent('input');
    await p.selectOption('.rc-tipo', 'MATERIA_PRIMA');
    await p.fill('.rc-identificacao', 'Corante amarelo'); await p.fill('.rc-sku-fornecedor', 'CA-1'); await p.fill('.rc-lote', 'L-77');
    await p.selectOption('.rc-certificado', 'SIM'); await p.selectOption('.rc-cond-embalagem', '5');
    await p.evaluate(() => { document.querySelector('.rc-endereco').value = 'A1'; });
    await p.fill('#rcNotaFiscal', '123'); await p.selectOption('#rcCondVeiculo', '5');
    await p.click('#modalReceberSave');
    await p.waitForFunction(() => window.__html, null, {timeout: 8000});
    assert.equal(await p.evaluate(() => window.__payload.linhas[0].volumesPesos), null);
    const igual = (await p.evaluate(() => window.__html)).split('<section class="etq">').slice(1);
    assert.match(igual[0], /47,15 kg · volume 1 de 7 \(total 330 kg\)/);
    assert.match(igual[6], /47,14 kg · volume 7 de 7/);
    assert.deepEqual(l.errors, []);
    console.log('OK Recebimento: peso de cada volume (6x50 + 30) conferido na tela, enviado ao servidor e impresso na etiqueta.');
    await l.context.close();
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
