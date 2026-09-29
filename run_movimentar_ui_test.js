'use strict';
/* Tela Movimentar (WMS, 29/09) de ponta a ponta: tela real com utils.js
   (transferirLoteEndereco / separarParcialLoteEndereco de verdade),
   seletor-endereco.js e auth_check.js; Firebase simulado em memória
   (mesmo harness de run_manipulacao_ui_test.js). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    usuarios: {log: {nome: 'Carlos Logística', email: 'log@kuryos.com', role: 'logistica'}},
    config: {motivosMovimentoEstoque: [{ativo: true, nome: 'RECEBIMENTO'}, {ativo: true, nome: 'TRANSFERÊNCIA ENTRE ENDEREÇOS'}, {ativo: true, nome: 'REORGANIZAÇÃO'}]},
    enderecos_estoque: {
      'DOC-1-1-1': {codigo: 'DOC-1.1.1', area: 'DOCA', rua: 1, predio: 1, nivel: 1, ativo: true},
      'FAB-1-1-1': {codigo: 'FAB-1.1.1', area: 'FÁBRICA', rua: 1, predio: 1, nivel: 1, ativo: true},
      'FAB-1-1-2': {codigo: 'FAB-1.1.2', area: 'FÁBRICA', rua: 1, predio: 1, nivel: 2, ativo: true},
      'FAB-1-2-1': {codigo: 'FAB-1.2.1', area: 'FÁBRICA', rua: 1, predio: 2, nivel: 1, ativo: true},
      'GAL-1-1-1': {codigo: 'GAL-1.1.1', area: 'GALPÃO', rua: 1, predio: 1, nivel: 1, ativo: true},
      'FAB-2-1-1': {codigo: 'FAB-2.1.1', area: 'FÁBRICA', rua: 2, predio: 1, nivel: 1, ativo: false}
    },
    estoque_lotes: {
      PA1: {p1: {itemCodigo: 'PA1', itemNome: 'BODY SPLASH', itemTipo: 'produto', saldoLote: 295, identificadorPalete: 'PA-26246-07-P1', opLote: '26246/07', enderecoKey: 'FAB-1-1-1', enderecoCodigo: 'FAB-1.1.1', status: 'LIBERADO_EXPEDICAO', unidade: 'un'}},
      'MP-1': {
        a: {itemCodigo: 'MP-1', itemNome: 'ÁLCOOL', itemTipo: 'material', saldoLote: 180, unidade: 'kg', loteInterno: 'AK-2026-000576', loteOrigem: 'F123', enderecoKey: 'FAB-1-1-1', enderecoCodigo: 'FAB-1.1.1', status: 'LIBERADO', dataValidade: '2027-06-30'},
        b: {itemCodigo: 'MP-1', itemNome: 'ÁLCOOL', itemTipo: 'material', saldoLote: 50, unidade: 'kg', loteInterno: 'AK-2026-000577', enderecoKey: 'GAL-1-1-1', enderecoCodigo: 'GAL-1.1.1', status: 'LIBERADO'}
      }
    },
    movimentos_estoque: {}
  };
}

async function abrir(browser, uid, estadoInicial, pagina) {
  const page = await browser.newPage({viewport: {width: 1500, height: 1200}});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // confirm() aceita; prompt() responde o que o teste deixou em page.__respostaPrompt.
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? (page.__respostaPrompt || '') : undefined));
  await page.addInitScript(({data, quem}) => {
    const db = data;
    window.__db = db;
    window.__iniciado = false;
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    // Listeners vivos: a tela reage a on('value'), como no Firebase de verdade.
    const ouvintes = [];
    const notificar = (bruto) => {
      // update() na raiz manda caminhos com barra inicial: normaliza os dois
      // lados, senão o ouvinte de 'ops' nunca casa com '/ops/...'.
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
    const exige = (q) => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
    const perfil = db.usuarios[quem];
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() {
        exige('auth');
        return {currentUser: {uid: quem, email: perfil.email},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: quem, email: perfil.email, displayName: perfil.nome}), 0); },
          signOut() { return Promise.resolve(); }};
      },
      storage() {
        exige('storage');
        window.__arquivos = window.__arquivos || {};
        return {ref(caminho) {
          return {
            put(arq, meta) { window.__arquivos[caminho] = {bytes: arq.size, tipo: (meta && meta.contentType) || arq.type}; return Promise.resolve(); },
            getDownloadURL() { return Promise.resolve('https://storage.test/' + caminho); },
            delete() { delete window.__arquivos[caminho]; return Promise.resolve(); }
          };
        }};
      },
      database() {
        exige('database');
        const ref = (path) => {
          const valor = () => { const v = ler(path); return v === undefined ? null : structuredClone(v); };
          const snap = () => { const v = valor(); return {val: () => v, exists: () => v !== null, key: partes(path).pop(),
            forEach(cb) { Object.entries(v || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
          return {path, key: partes(path).pop(),
            once(ev, cb) { const sn = snap(); if (cb) cb(sn); return Promise.resolve(sn); },
            on(ev, cb) {
              const avisar = () => cb(snap());
              ouvintes.push({path: path, avisar: avisar});
              setTimeout(avisar, 0);
              return cb;
            },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, limitToLast() { return this; }, startAt() { return this; },
            push(v) {
              seq++;
              const filho = ref(path + '/-M' + seq);
              if (v === undefined) return filho;
              gravar(filho.path, v);
              const pr = Promise.resolve(filho); pr.key = filho.key; return pr;
            },
            set(v) { gravar(path, v); return Promise.resolve(); },
            update(obj) { Object.entries(obj).forEach(([k, v]) => gravar(path + '/' + k, v)); return Promise.resolve(); },
            remove() { gravar(path, null); return Promise.resolve(); },
            transaction(fn) { const r = fn(valor()); if (r !== undefined) gravar(path, r);
              return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        };
        return {ref: (p) => ref(p || '')};
      }
    };
  }, {data: estadoInicial || dados(), quem: uid});
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'mn.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://mn.test/' + (pagina || 'manipulacao.html'));
  await page.waitForSelector('.kt-sidebar', {timeout: 8000});
  await page.waitForFunction(() => window.currentUser && window.currentUser.nome);
  return {page, errors};
}


(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser, 'log', dados(), 'movimentar.html');
    const db = () => page.evaluate(() => window.__db);
    await page.waitForFunction(() => document.getElementById('btnDoca') && !document.getElementById('btnDoca').disabled);
    assert.equal(await page.locator('#passoOque').isVisible(), false, 'começa só pelo passo 1');
    assert.equal(await page.locator('.kt-sidebar a[href="movimentar.html"]').count(), 1, 'Movimentar no menu da Logística');

    // ── 1. Posição inteira (palete com 2 lotes) para uma livre sugerida ──
    await page.fill('#deCodigo', 'fab-1.1.1');
    await page.press('#deCodigo', 'Enter');
    await page.waitForSelector('#passoOque:not([hidden])');
    assert.match(await page.locator('#deEscolhido').innerText(), /FAB-1\.1\.1/);
    assert.match(await page.locator('#oqueResumo').innerText(), /2 de 2 lote\(s\) marcados/, 'posição lida: tudo marcado');
    assert.equal(await page.locator('#marcarTodos').isChecked(), true);
    assert.match(await page.locator('#oqueLista').innerText(), /Palete de produto acabado se move inteiro/);
    assert.match(await page.locator('#paraSugestoes').innerText(), /FAB-1\.1\.2[\s\S]*FAB-1\.2\.1/, 'livres perto primeiro');
    assert.doesNotMatch(await page.locator('#paraSugestoes').innerText(), /GAL-1\.1\.1|FAB-2\.1\.1|DOC/, 'sem ocupada, bloqueada ou Doca');
    await page.click('[data-sug="FAB-1-1-2"]');
    assert.match(await page.locator('#paraSituacao').innerText(), /Posição livre/);
    assert.equal(await page.inputValue('#motivo'), 'TRANSFERÊNCIA ENTRE ENDEREÇOS', 'motivo padrão');
    assert.match(await page.locator('#confResumo').innerText(), /Mover o PALETE INTEIRO \(2 lotes\) de FAB-1\.1\.1 para FAB-1\.1\.2/);
    assert.equal(await page.locator('#btnMover').innerText(), 'Mover o palete inteiro para FAB-1.1.2');
    if (process.env.MOV_SHOT) await page.screenshot({path: process.env.MOV_SHOT + '_desktop.png', fullPage: true});
    await page.click('#btnMover');
    await page.waitForFunction(() => /✓ Mover o PALETE INTEIRO/.test(document.getElementById('resultado').innerText));
    let d = await db();
    assert.equal(d.estoque_lotes.PA1.p1.enderecoKey, 'FAB-1-1-2');
    assert.equal(d.estoque_lotes.PA1.p1.enderecoCodigo, 'FAB-1.1.2');
    assert.equal(d.estoque_lotes['MP-1'].a.enderecoKey, 'FAB-1-1-2');
    assert.equal(d.estoque_lotes.PA1.p1.saldoLote, 295, 'mover não muda saldo');
    const movs = Object.values(d.movimentos_estoque.PA1 || {});
    assert.equal(movs[0].ref, 'FAB-1-1-1 -> FAB-1-1-2');
    assert.equal(movs[0].autor, 'Carlos Logística');
    await page.waitForFunction(() => /FAB-1\.1\.1 → FAB-1\.1\.2/.test(document.getElementById('ultimas').innerText));
    assert.equal(await page.locator('#passoOque').isVisible(), false, 'depois de mover, volta ao passo 1');

    // Mover de volta.
    await page.click('#desfazer');
    await page.waitForFunction(() => /Voltou para FAB-1\.1\.1/.test(document.getElementById('resultado').innerText));
    d = await db();
    assert.equal(d.estoque_lotes.PA1.p1.enderecoKey, 'FAB-1-1-1');
    assert.equal(d.estoque_lotes['MP-1'].a.enderecoKey, 'FAB-1-1-1');

    // ── 2. Lote lido pela etiqueta: só ele; parte dele para uma ocupada ──
    await page.fill('#deCodigo', 'AK-2026-000576');
    await page.press('#deCodigo', 'Enter');
    await page.waitForSelector('#passoOque:not([hidden])');
    assert.match(await page.locator('#oqueResumo').innerText(), /1 de 2 lote\(s\) marcados/, 'lote lido: só ele marcado');
    await page.click('[data-abrir-parcial="MP-1/a"]');
    await page.fill('[data-qtd="MP-1/a"]', '30');
    await page.fill('#paraCodigo', 'GAL-1.1.1');
    await page.press('#paraCodigo', 'Enter');
    assert.match(await page.locator('#paraSituacao').innerText(), /MESMO palete de 1 lote/);
    assert.match(await page.locator('#confResumo').innerText(), /Mover 30 de 180 kg de MP-1 \(AK-2026-000576\) de FAB-1\.1\.1 para GAL-1\.1\.1/);
    let confirmTxt = '';
    page.removeAllListeners('dialog');
    page.on('dialog', (dl) => { confirmTxt = dl.message(); dl.accept(); });
    await page.selectOption('#motivo', 'REORGANIZAÇÃO');
    await page.click('#btnMover');
    await page.waitForFunction(() => /✓ Mover 30 de 180/.test(document.getElementById('resultado').innerText));
    assert.match(confirmTxt, /já tem material. Vai para o MESMO palete/, 'ocupada pede confirmação explícita');
    d = await db();
    assert.equal(d.estoque_lotes['MP-1'].a.saldoLote, 150, 'fica 150 na origem');
    const novo = Object.entries(d.estoque_lotes['MP-1']).find(([k, l]) => k !== 'a' && k !== 'b');
    assert.ok(novo, 'nasceu o pedaço no destino');
    assert.deepEqual([novo[1].saldoLote, novo[1].enderecoKey, novo[1].loteInterno, novo[1].origemTipo, novo[1].dataValidade], [30, 'GAL-1-1-1', 'AK-2026-000576', 'movimentacao', '2027-06-30']);
    assert.ok(Object.values(d.movimentos_estoque['MP-1']).some((m) => m.motivo === 'REORGANIZAÇÃO' && m.qtd === 30));
    assert.equal(await page.locator('#desfazer').count(), 0, 'divisão não oferece "mover de volta" automático');

    // ── 3. Destino bloqueado e mesma posição: explícito, sem botão ──
    await page.fill('#deCodigo', 'PA-26246-07-P1');
    await page.press('#deCodigo', 'Enter');
    await page.waitForSelector('#passoOque:not([hidden])');
    assert.equal(await page.locator('[data-abrir-parcial="PA1/p1"]').count(), 0, 'PA não oferece mover parte');
    await page.fill('#paraCodigo', 'FAB-2.1.1');
    await page.press('#paraCodigo', 'Enter');
    assert.match(await page.locator('#paraSituacao').innerText(), /bloqueada/);
    assert.equal(await page.locator('#btnMover').isDisabled(), true);
    await page.click('#trocarDestino');
    await page.fill('#paraCodigo', 'XYZ');
    await page.press('#paraCodigo', 'Enter');
    assert.match(await page.locator('#resultado').innerText(), /não é um endereço/);
    await page.click('#btnParaDoca');
    assert.match(await page.locator('#paraSituacao').innerText(), /Doca: área de passagem/);
    await page.click('#btnMover');
    await page.waitForFunction(() => /✓ Mover PA1/.test(document.getElementById('resultado').innerText));
    assert.equal((await db()).estoque_lotes.PA1.p1.enderecoKey, 'DOC-1-1-1');
    await page.waitForFunction(() => /Doca \(1\)/.test(document.getElementById('btnDoca').innerText), null, {timeout: 5000});

    // Código que não existe: mensagem clara.
    await page.fill('#deCodigo', 'NADA-999');
    await page.press('#deCodigo', 'Enter');
    assert.match(await page.locator('#resultado').innerText(), /Nada encontrado para NADA-999/);

    // ── 4. Etiquetas de endereço ──
    await page.click('text=🏷️ Etiquetas de endereço');
    await page.selectOption('#etArea', 'FÁBRICA');
    assert.equal(await page.locator('#btnEtiquetas').innerText(), '🏷️ Imprimir 3 etiqueta(s)', 'só ativas (a bloqueada fica de fora)');
    const [pop] = await Promise.all([page.waitForEvent('popup'), page.click('#btnEtiquetas')]);
    await pop.waitForLoadState();
    const html = await pop.content();
    assert.match(html, /FAB-1\.1\.1/);
    assert.equal((html.match(/<section class="etq/g) || []).length, 3);
    assert.match(html, /size:100mm 50mm/, 'formato térmico por padrão');
    assert.ok((html.match(/<svg/g) || []).length >= 6, 'código de barras + QR em cada etiqueta');
    await pop.close();
    await page.selectOption('#etFormato', 'endereco-a4');
    const [popA4] = await Promise.all([page.waitForEvent('popup'), page.click('#btnEtiquetas')]);
    await popA4.waitForLoadState();
    assert.match(await popA4.content(), /size:A4/);
    await popA4.close();

    // Etiqueta de palete a partir da posição (o palete está na Doca desde o passo 3).
    await page.fill('#deCodigo', 'DOC-1.1.1'); await page.press('#deCodigo', 'Enter');
    await page.waitForSelector('#passoOque:not([hidden])');
    const [popP] = await Promise.all([page.waitForEvent('popup'), page.click('[data-etq="PA1/p1"]')]);
    await popP.waitForLoadState();
    const hp = await popP.content();
    assert.match(hp, /PA-26246-07-P1/);
    assert.match(hp, /PALETE · PRODUTO ACABADO/);
    assert.match(hp, /DOC-1\.1\.1/, 'endereço atual na etiqueta');
    await popP.close();

    // Celular: sem rolagem lateral, alvos grandes.
    await page.setViewportSize({width: 390, height: 844});
    await page.fill('#deCodigo', 'FAB-1.1.1'); await page.press('#deCodigo', 'Enter');
    await page.waitForSelector('#passoOque:not([hidden])');
    const cel = await page.evaluate(() => ({largura: document.documentElement.scrollWidth, fonte: parseFloat(getComputedStyle(document.getElementById('deCodigo')).fontSize), botao: document.getElementById('btnMover').getBoundingClientRect().height}));
    assert.ok(cel.largura <= 394, 'sem rolagem horizontal: ' + cel.largura);
    assert.ok(cel.fonte >= 16, 'campo sem zoom automático');
    assert.ok(cel.botao >= 44, 'botão Mover com alvo grande: ' + cel.botao);
    if (process.env.MOV_SHOT) await page.screenshot({path: process.env.MOV_SHOT + '_celular.png', fullPage: true});
    assert.deepEqual(errors, [], 'erros: ' + errors.join(' | '));
    console.log('OK Movimentar: posição/palete/lote pelo código, palete inteiro, parte de lote, destino livre/ocupado/bloqueado/Doca explícitos, mover de volta, últimas movimentações, etiquetas de endereço e celular.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
