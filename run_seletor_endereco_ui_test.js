'use strict';
/* Seletor visual de endereço nas telas reais: Estoque (Na Doca, guardar,
   transferir, levar para a Doca, Saldo por lote) e Logística (recebimento
   entra na Doca por padrão). utils.js, auth_check.js e o componente reais;
   Firebase simulado fiel ao SDK, gravações registradas. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    'usuarios/u1': {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'},
    'config/areasEndereco': [{nome: 'GALPÃO', sigla: 'GAL', ativo: true}, {nome: 'FÁBRICA', sigla: 'FAB', ativo: true}, {nome: 'DOCA', sigla: 'DOC', ativo: true}],
    'config/motivosMovimentoEstoque': [{nome: 'TRANSFERÊNCIA ENTRE ENDEREÇOS', ativo: true}],
    enderecos_estoque: {
      'DOC-1-1-1': {area: 'DOCA', codigo: 'DOC-1.1.1', rua: 1, predio: 1, nivel: 1, ativo: true},
      'GAL-1-1-1': {area: 'GALPÃO', codigo: 'GAL-1.1.1', rua: 1, predio: 1, nivel: 1, ativo: true},
      'GAL-1-1-2': {area: 'GALPÃO', codigo: 'GAL-1.1.2', rua: 1, predio: 2, nivel: 1, ativo: true},
      'GAL-1-2-1': {area: 'GALPÃO', codigo: 'GAL-1.2.1', rua: 1, predio: 1, nivel: 2, ativo: true},
      'FAB-1-1-1': {area: 'FÁBRICA', codigo: 'FAB-1.1.1', rua: 1, predio: 1, nivel: 1, ativo: true},
      HISTORICO: {area: 'GALPAO', codigo: 'HISTORICO', rua: 999, predio: 999, nivel: 999, ativo: true, legado: true}
    },
    estoque_lotes: {
      'MP-LIB': {l1: {itemTipo: 'material', itemCodigo: 'MP-LIB', itemNome: 'Frasco liberado', saldoLote: 500, unidade: 'un', status: 'LIBERADO', enderecoKey: 'DOC-1-1-1', enderecoCodigo: 'DOC-1.1.1', loteOrigem: 'F-1', atualizadoEm: '2026-09-15T08:00:00Z'}},
      'MP-QUA': {l2: {itemTipo: 'material', itemCodigo: 'MP-QUA', itemNome: 'Tampa em quarentena', saldoLote: 300, unidade: 'un', status: 'QUARENTENA', enderecoKey: 'DOC-1-1-1', enderecoCodigo: 'DOC-1.1.1', loteOrigem: 'F-2', atualizadoEm: '2026-09-15T07:00:00Z'}},
      PA1: {p1: {itemTipo: 'produto', itemCodigo: 'PA1', itemNome: 'Creme', saldoLote: 120, unidade: 'un', status: 'LIBERADO_EXPEDICAO', enderecoKey: 'DOC-1-1-1', enderecoCodigo: 'DOC-1.1.1', identificadorPalete: 'PA-26254/01-P1'}},
      'MP-POS': {l3: {itemTipo: 'material', itemCodigo: 'MP-POS', itemNome: 'Rótulo', saldoLote: 50, unidade: 'un', status: 'LIBERADO', enderecoKey: 'GAL-1-1-1', enderecoCodigo: 'GAL-1.1.1', loteOrigem: 'F-3'}},
      'MP-HIST': {l4: {itemTipo: 'material', itemCodigo: 'MP-HIST', saldoLote: 10, status: 'LIBERADO', enderecoKey: 'HISTORICO'}}
    },
    fornecedores: {f1: {nomeFantasia: 'LOMAR PACK'}},
    materiais: {'EP-00036': {mpCodigo: 'EP-00036', mpNome: 'Frasco', unidade: 'un'}},
    pedidos_compra: {pc1: {status: 'ENVIADO', numeroFormatado: 'PC-0009', fornecedorKey: 'f1', fornecedorNome: 'LOMAR PACK', dataCriacao: '2026-09-14T10:00:00Z',
      itens: {i1: {materialCodigo: 'EP-00036', materialNome: 'Frasco', qtd: 100, unidade: 'un', precoUnit: 1}}}}
  };
}

async function abrir(browser, pagina) {
  const page = await browser.newPage({viewport: {width: 1500, height: 1100}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(({data}) => {
    window.__writes = [];
    window.__iniciado = false;
    const exige = q => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
    const get = path => { if (path in data) return data[path]; const partes = path.split('/'); let n = data[partes[0]]; for (const p of partes.slice(1)) n = n == null ? undefined : n[p]; return n === undefined ? null : n; };
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() { exige('auth'); return {onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), 0); }, signOut() { return Promise.resolve(); }, currentUser: {email: 'g@kuryos.com'}}; },
      functions() { return {httpsCallable: () => () => Promise.resolve({data: {}})}; },
      app() { return {functions: () => ({httpsCallable: () => () => Promise.resolve({data: {}})})}; },
      database() {
        exige('database');
        const ref = path => {
          const snap = () => ({val: () => structuredClone(get(path)), exists: () => get(path) != null, key: String(path).split('/').pop()});
          return {path, key: 'k' + Math.random().toString(36).slice(2, 8),
            once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); },
            on(ev, cb) { setTimeout(() => cb(snap()), 0); return cb; }, off() {},
            child(p) { return ref(path + '/' + p); }, push(v) { const r = ref(path + '/k' + Math.random().toString(36).slice(2, 8)); if (v !== undefined) window.__writes.push({op: 'push', path, v}); return Object.assign(Promise.resolve(r), r); },
            orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; }, startAt() { return this; }, endAt() { return this; },
            set(v) { window.__writes.push({op: 'set', path, v}); return Promise.resolve(); },
            update(v) { window.__writes.push({op: 'update', path, v}); return Promise.resolve(); },
            remove() { return Promise.resolve(); },
            transaction(fn) { const v = fn(structuredClone(get(path))); return Promise.resolve({committed: true, snapshot: {val: () => v}}); }};
        };
        return {ref, ServerValue: {TIMESTAMP: 0}};
      }
    };
  }, {data: dados()});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'wms.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://wms.test/' + pagina);
  await page.waitForSelector('.kt-sidebar', {timeout: 8000});
  return {page, errors};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // ════════════ ESTOQUE ════════════
    const {page, errors} = await abrir(browser, 'estoque.html');
    await page.click('.tab[data-tab="enderecamento"]');
    await page.waitForFunction(() => /Na Doca \(3\)/.test(document.getElementById('docaTitulo').textContent));

    // ── 1. Na Doca: ordem e situação ─────────────────────────────────────
    assert.match(await page.textContent('#docaTitulo'), /Na Doca \(3\) · 2 para guardar/, 'PA separado para expedir não é pendência de guarda');
    const linhas = await page.locator('#docaBody tr').allInnerTexts();
    assert.equal(linhas.length, 3);
    assert.match(linhas[0], /MP-LIB[\s\S]*Liberado · guardar[\s\S]*Guardar/, 'liberado primeiro');
    assert.match(linhas[1], /MP-QUA[\s\S]*(Quarentena|QUARENTENA)/);
    assert.match(linhas[2], /PA1[\s\S]*PA · separado para expedir[\s\S]*Devolver a uma posição/);

    // ── 2. Guardar: abre no mapa (não na Doca), escolhe posição livre ─────
    await page.locator('#docaBody tr', {hasText: 'MP-LIB'}).locator('.doca-guardar').click();
    await page.waitForSelector('.se-overlay');
    assert.match(await page.textContent('.se-area.on'), /GALPÃO/, 'guardar abre direto nas posições');
    assert.equal(await page.locator('.se-pos[data-key]').count(), 3, 'só as posições reais do Galpão; HISTORICO 999×999 fora');
    assert.equal(await page.locator('.se-pos.oc').count(), 1);
    await page.click('.se-pos[data-key="GAL-1-1-2"]');
    assert.match(await page.textContent('.se-painel'), /GAL-1\.1\.2 · livre/);
    await page.click('.se-painel [data-acao="ok"]');
    assert.equal(await page.locator('.se-overlay').count(), 0, 'fecha ao escolher');
    await page.waitForFunction(() => window.__writes.some(w => w.op === 'update' && w.path === 'estoque_lotes/MP-LIB/l1'));
    let w = await page.evaluate(() => window.__writes);
    const mov = w.find(x => x.op === 'update' && x.path === 'estoque_lotes/MP-LIB/l1');
    assert.equal(mov.v.enderecoKey, 'GAL-1-1-2');
    assert.equal(mov.v.enderecoCodigo, 'GAL-1.1.2');
    assert.equal(mov.v.aguardandoEnderecoDefinitivo, null);
    await page.waitForFunction(() => window.__writes.some(x => x.op === 'push' && x.path === 'movimentos_estoque/MP-LIB'));
    w = await page.evaluate(() => window.__writes);
    assert.equal(w.find(x => x.op === 'push' && x.path === 'movimentos_estoque/MP-LIB').v.motivo, 'GUARDADO DA DOCA');

    // ── 3. Posição ocupada: mostra o palete e oferece "mesmo palete" ──────
    await page.locator('#docaBody tr', {hasText: 'MP-QUA'}).locator('.doca-guardar').click();
    await page.click('.se-pos[data-key="GAL-1-1-1"]');
    const painel = await page.textContent('.se-painel');
    assert.match(painel, /GAL-1\.1\.1 · ocupada/);
    assert.match(painel, /MP-POS[\s\S]*Rótulo[\s\S]*50/);
    assert.equal(await page.textContent('.se-painel [data-acao="ok"]'), 'Colocar no mesmo palete');
    await page.click('.se-painel [data-acao="cancelar"]');
    assert.match(await page.textContent('.se-painel'), /Clique numa posição/);
    await page.click('.se-area[data-area="DOCA"]');
    const doca = await page.textContent('.se-corpo');
    assert.match(doca, /MP-LIB[\s\S]*PA1/, 'a Doca lista o que está parado nela');
    assert.doesNotMatch(doca, /MP-QUA/, 'o lote sendo guardado não conta como ocupante do lugar de onde sai');
    assert.match(doca, /posição atual/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.se-overlay').count(), 0, 'Esc fecha');

    // ── 4. Transferir: levar para a Doca e trocar pelo mapa ──────────────
    await page.evaluate(() => abrirModalTransferir('MP-POS', 'l3'));
    assert.equal(await page.inputValue('#trNovoEndereco'), '');
    await page.click('#trParaDoca');
    assert.equal(await page.inputValue('#trNovoEndereco'), 'DOC-1-1-1');
    assert.match(await page.textContent('#trNovoEnderecoCampo .se-rotulo'), /DOC-1\.1\.1 · Doca/);
    await page.click('#trNovoEnderecoCampo .se-btn');
    await page.click('.se-area[data-area="FABRICA"]');
    await page.click('.se-pos[data-key="FAB-1-1-1"]');
    await page.click('.se-painel [data-acao="ok"]');
    assert.equal(await page.inputValue('#trNovoEndereco'), 'FAB-1-1-1');
    assert.match(await page.textContent('#trNovoEnderecoCampo .se-rotulo'), /FAB-1\.1\.1 · FÁBRICA/);
    // o lote em movimento não conta como ocupante do lugar de onde sai
    await page.click('#trNovoEnderecoCampo .se-btn');
    await page.click('.se-area[data-area="GALPAO"]');
    await page.click('.se-pos[data-key="GAL-1-1-1"]');
    assert.match(await page.textContent('.se-painel'), /GAL-1\.1\.1 · livre/, 'MP-POS sai de GAL-1.1.1, que fica livre para ele');
    // e a posição já escolhida no campo (FAB-1.1.1) não oferece "mover para lá" de novo
    await page.click('.se-area[data-area="FABRICA"]');
    await page.click('.se-pos[data-key="FAB-1-1-1"]');
    assert.match(await page.textContent('.se-painel'), /FAB-1\.1\.1 · já é o endereço atual/);
    assert.equal(await page.locator('.se-painel [data-acao="ok"]').count(), 0, 'escolher de novo o mesmo lugar não oferece ação');
    await page.keyboard.press('Escape');

    // ── 5. Saldo por lote: "guardar" só para material na Doca ─────────────
    await page.evaluate(() => { fecharModalTransferir(); document.querySelector('.tab[data-tab="lotes"]').click(); });
    await page.waitForFunction(() => document.querySelectorAll('#slBody tr').length >= 5);
    const saldo = await page.locator('#slBody tr').allInnerTexts();
    assert.match(saldo.find(t => /MP-QUA/.test(t)), /📦 guardar/);
    assert.match(saldo.find(t => /PA1/.test(t)), /🚚 na Doca/);
    assert.doesNotMatch(saldo.find(t => /PA1/.test(t)), /📦 guardar/);
    assert.doesNotMatch(saldo.find(t => /MP-POS/.test(t)), /guardar|na Doca/);
    assert.match(await page.textContent('#slAvisoAguardando'), /2 lote\(s\) na Doca aguardando guardar/);
    await page.check('#slSoAguardando');
    assert.equal(await page.locator('#slBody tr').count(), 2);

    // ── 6. Conferência de PA: palete usa o seletor ────────────────────────
    const htmlPalete = await page.evaluate(() => linhaPaletePA(1, 24));
    assert.match(htmlPalete, /<input type="hidden" class="cpa-endereco" value="">/);
    assert.match(htmlPalete, /se-btn/);
    assert.deepEqual(errors, [], 'erros no Estoque: ' + errors.join(' | '));
    await page.close();

    // ════════════ LOGÍSTICA: recebimento ════════════
    const log = await abrir(browser, 'logistica.html');
    await log.page.waitForFunction(() => typeof openModalReceber === 'function' && allEnderecosEstoque && allEnderecosEstoque['DOC-1-1-1']);
    await log.page.evaluate(() => openModalReceber('pc1'));
    await log.page.waitForSelector('.rc-endereco', {state: 'attached'});
    assert.equal(await log.page.inputValue('.rc-endereco'), 'DOC-1-1-1', 'recebimento entra na Doca por padrão');
    assert.match(await log.page.textContent('.rc-lote-row .se-rotulo'), /DOC-1\.1\.1 · Doca/);
    await log.page.click('.rc-lote-row .se-btn');
    await log.page.waitForSelector('.se-overlay');
    await log.page.click('.se-area[data-area="GALPAO"]');
    assert.equal(await log.page.locator('.se-pos.oc').count(), 1, 'a Logística enxerga a ocupação');
    await log.page.click('.se-pos[data-key="GAL-1-2-1"]');
    await log.page.click('.se-painel [data-acao="ok"]');
    assert.equal(await log.page.inputValue('.rc-endereco'), 'GAL-1-2-1', 'dá para guardar direto numa posição');
    const itens = await log.page.evaluate(() => lerItensRecebimentoDaTela());
    assert.equal(itens[0].enderecoKey, 'GAL-1-2-1', 'a leitura da tela pega o endereço escolhido');
    assert.deepEqual(log.errors, [], 'erros na Logística: ' + log.errors.join(' | '));

    console.log('OK Seletor de endereço: Na Doca, guardar pelo mapa, mesmo palete, levar para a Doca, saldo por lote, PA e recebimento na Doca.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
