'use strict';
/* Manipulação (fase de granel do lote): pesagem baixa estoque, conferência é
   de outra pessoa, manipulação registra tempos/perdas e o granel vai para a
   Qualidade. Tela real com utils.js, propriedade-estoque.js, manipulacao.js e
   auth_check.js; Firebase simulado em memória. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    usuarios: {
      pes: {nome: 'Operador João', email: 'joao@kuryos.com', role: 'production'},
      man: {nome: 'Manipuladora Ana', email: 'ana@kuryos.com', role: 'production'},
      cq: {nome: 'Daiene', email: 'cq@kuryos.com', role: 'qualidade'}
    },
    config: {linhas: ['Linha 1']},
    ops: {
      '26260-01': {lote: '26260/01', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR DAS TAMARAS',
        cliente: 'MISS RÔSE', status: 'Programado', qtdPlanejada: 1000, dataEmissao: '2026-09-17T08:00:00'},
      '26260-02': {lote: '26260/02', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR DAS TAMARAS',
        cliente: 'MISS RÔSE', status: 'Concluído', qtdPlanejada: 500}
    },
    produtos: {MRARBS04: {sku: 'MRARBS04', descricao: 'BODY SPLASH NÉCTAR DAS TAMARAS', cliente: 'MISS RÔSE',
      clienteKey: 'MISS', volume: 200, unidadeVolume: 'ml', densidadeGranel: 0.9}},
    formulas: {MRARBS04__v1: {codProduto: 'MRARBS04', versao: 'v1', status: 'APROVADA', itens: {
      i1: {mpCodigo: 'MPGR-001', mpNome: 'ALCOOL CEREAIS', percentualMM: 60},
      i2: {mpCodigo: 'MPGR-002', mpNome: 'AGUA DEIONIZADA', percentualMM: 35},
      i3: {mpCodigo: 'MPES-003', mpNome: 'FRAGRANCIA LEAO', percentualMM: 5}}}},
    bom: {MRARBS04__v1: {codProduto: 'MRARBS04', versao: 'v1', status: 'APROVADA', itens: {
      b1: {materialCodigo: 'EP-00106', materialNome: 'FRASCO 200ML', qtdPorPeca: 1}}}},
    materiais: {
      'MPGR-001': {mpCodigo: 'MPGR-001', unidade: 'kg'}, 'MPGR-002': {mpCodigo: 'MPGR-002', unidade: 'kg'},
      'MPES-003': {mpCodigo: 'MPES-003', unidade: 'kg'}, 'EP-00106': {mpCodigo: 'EP-00106', unidade: 'un'}
    },
    estoque: {
      'MPGR-001': {saldoAtual: 500, materialNome: 'ALCOOL CEREAIS'},
      'MPGR-002': {saldoAtual: 500}, 'MPES-003': {saldoAtual: 100}
    },
    estoque_lotes: {}, movimentos_estoque: {}, nao_conformidades: {}, pedidos_compra: {}, fornecedores: {},
    especificacoes: {MRARBS04__v1: {codProduto: 'MRARBS04', itens: {
      e1: {ensaio: 'ASPECTO', especificacaoTexto: 'LÍQUIDO', metodo: 'PA09', critico: false},
      e2: {ensaio: 'PH', especificacaoTexto: '5 - 7', minimo: 5, maximo: 7, metodo: 'PA01', critico: true}}}},
    parametros_pa: {}
  };
}

async function abrir(browser, uid, estadoInicial, pagina) {
  const page = await browser.newPage({viewport: {width: 1500, height: 1200}});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
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

async function campo(page, seletor, valor) {
  const el = page.locator(seletor);
  await el.fill(valor);
  await el.dispatchEvent('change');
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // ── Operador da pesagem ─────────────────────────────────────────────
    const {page, errors} = await abrir(browser, 'pes');
    const linha = page.locator('#mListaBody tr', {hasText: '26260/01'});
    await linha.waitFor({timeout: 8000});
    assert.match(await linha.innerText(), /sem fase/);
    assert.equal(await page.locator('#mListaBody tr', {hasText: '26260/02'}).count(), 0, 'OP concluída não aparece');

    await linha.locator('[data-abrir]').click();
    await page.waitForSelector('#mPainel');
    // A fórmula explode só o granel: 200ml x 1000 un x 0,9 = 180 kg.
    const previstos = await page.evaluate(() => Object.values(previstos_ || {}), null).catch(() => null);
    const tabela = await page.locator('#mPesagemBody').innerText();
    assert.match(tabela, /MPGR-001/);
    assert.match(tabela, /MPES-003/);
    assert.doesNotMatch(tabela, /EP-00106/, 'embalagem não entra na manipulação — é consumo do envase');
    assert.match(await page.locator('#mResumoTempos').innerText(), /Previsto 180/);

    await page.click('#mBtnIniciarPesagem');
    await page.waitForFunction(() => (window.__db.ops['26260-01'].manipulacao || {}).status === 'AGUARDANDO_PESAGEM');

    // Peso fora da tolerância exige justificativa.
    await campo(page, '[data-peso="MPGR-001"]', '108');
    await campo(page, '[data-lotemat="MPGR-001"]', 'AK-2026-000576');
    await campo(page, '[data-peso="MPGR-002"]', '63');
    await campo(page, '[data-lotemat="MPGR-002"]', 'AK-2026-000577');
    await campo(page, '[data-peso="MPES-003"]', '12');
    await campo(page, '[data-lotemat="MPES-003"]', 'AK-2026-000578');
    await page.waitForFunction(() => /fora do previsto/.test(document.getElementById('mPesagemErros').innerText));
    assert.equal(await page.locator('#mBtnFecharPesagem').isDisabled(), true, 'sem justificativa não fecha');
    await campo(page, '[data-just="MPES-003"]', 'Ajuste de fragrância autorizado pelo P&D');
    await page.waitForFunction(() => !document.getElementById('mBtnFecharPesagem').disabled);

    await page.click('#mBtnFecharPesagem');
    await page.waitForFunction(() => (window.__db.ops['26260-01'].manipulacao || {}).status === 'PESADO', null, {timeout: 8000});
    let db = await page.evaluate(() => window.__db);
    const fase = db.ops['26260-01'].manipulacao;
    assert.equal(fase.pesagem.por, 'Operador João');
    assert.equal(fase.pesagem.baixaAplicada, true);
    assert.equal(fase.pesagem.itens['MPGR-001'].pesado, 108);
    assert.equal(fase.pesagem.itens['MPGR-001'].loteMaterial, 'AK-2026-000576');
    // A baixa de estoque acontece na pesagem (decisão do usuário em 17/09).
    assert.equal(db.estoque['MPGR-001'].saldoAtual, 392, '500 − 108');
    assert.equal(db.estoque['MPES-003'].saldoAtual, 88, '100 − 12');
    assert.ok(Object.keys(db.movimentos_estoque['MPGR-001'] || {}).length, 'movimento registrado');
    const mov = Object.values(db.movimentos_estoque['MPGR-001'])[0];
    assert.match(mov.motivo, /MANIPULAÇÃO/);

    // Quem pesou não pode conferir.
    assert.match(await page.locator('#mConferenciaBody').innerText(), /MPGR-001/);
    await page.selectOption('[data-conf="MPGR-001"]', 'sim');
    await page.selectOption('[data-conf="MPGR-002"]', 'sim');
    await page.selectOption('[data-conf="MPES-003"]', 'sim');
    assert.match(await page.locator('#mConferenciaErros').innerText(), /não pode ser quem pesou/);
    assert.equal(await page.locator('#mBtnConferir').isDisabled(), true);
    const estadoDb = await page.evaluate(() => window.__db);
    await page.close();

    // ── Manipuladora: confere e manipula ────────────────────────────────
    // Outra pessoa, outra sessão — recebe o banco como o pesador o deixou.
    const r2 = await abrir(browser, 'man', estadoDb);
    await r2.page.waitForFunction(() => window.currentUser && window.currentUser.nome === 'Manipuladora Ana');
    const linha2 = r2.page.locator('#mListaBody tr', {hasText: '26260/01'});
    await linha2.waitFor({timeout: 8000});
    assert.match(await linha2.innerText(), /aguardando conferência/i);
    await linha2.locator('[data-abrir]').click();
    await r2.page.waitForSelector('#mConferenciaBody');

    // Divergência trava a manipulação e exige descrição.
    await r2.page.selectOption('[data-conf="MPGR-001"]', 'sim');
    await r2.page.selectOption('[data-conf="MPGR-002"]', 'sim');
    await r2.page.selectOption('[data-conf="MPES-003"]', 'nao');
    await r2.page.waitForFunction(() => /precisa de descrição/.test(document.getElementById('mConferenciaErros').innerText));
    assert.equal(await r2.page.locator('#mBtnConferir').isDisabled(), true);
    await r2.page.selectOption('[data-conf="MPES-003"]', 'sim');
    await r2.page.waitForFunction(() => !document.getElementById('mBtnConferir').disabled);
    await r2.page.click('#mBtnConferir');
    await r2.page.waitForFunction(() => window.__db.ops['26260-01'].manipulacao.status === 'CONFERIDO');
    let db2 = await r2.page.evaluate(() => window.__db);
    assert.equal(db2.ops['26260-01'].manipulacao.conferencia.por, 'Manipuladora Ana');

    await r2.page.click('#mBtnIniciarManipulacao');
    await r2.page.waitForFunction(() => window.__db.ops['26260-01'].manipulacao.status === 'EM_MANIPULACAO');

    // Rendimento maior que o pesado é impossível.
    await campo(r2.page, '#mRendimento', '300');
    await r2.page.waitForFunction(() => /maior que o total pesado/.test(document.getElementById('mManipulacaoErros').innerText));
    assert.equal(await r2.page.locator('#mBtnFecharManipulacao').isDisabled(), true);

    await campo(r2.page, '#mRendimento', '178');
    await campo(r2.page, '#mPerdaResiduo', '3');
    await r2.page.waitForFunction(() => /Perda de processo/.test(document.getElementById('mManipulacaoResumo').innerText));
    assert.match(await r2.page.locator('#mManipulacaoResumo').innerText(), /5 kg/);
    await r2.page.click('#mBtnFecharManipulacao');
    await r2.page.waitForFunction(() => window.__db.ops['26260-01'].manipulacao.status === 'AGUARDANDO_CQ', null, {timeout: 8000});

    db2 = await r2.page.evaluate(() => window.__db);
    const f2 = db2.ops['26260-01'].manipulacao;
    assert.equal(f2.manipulacao.rendimento, 178);
    assert.equal(f2.manipulacao.perdas.residuo_tacho, 3);
    assert.ok(f2.manipulacao.inicio && f2.manipulacao.fim, 'tempos da manipulação gravados');
    assert.ok(f2.pesagem.inicio && f2.pesagem.fim, 'tempos da pesagem gravados');
    assert.match(await r2.page.locator('#mBlocoCq').innerText(), /envase deste lote fica travado/);

    const estadoParaCq = await r2.page.evaluate(() => window.__db);
    await r2.page.close();

    // ── Qualidade analisa o granel ──────────────────────────────────────
    const cq = await abrir(browser, 'cq', estadoParaCq, 'qualidade.html');
    const linhaGranel = cq.page.locator('#qGranelBody tr', {hasText: '26260/01'});
    await linhaGranel.waitFor({timeout: 8000});
    assert.match(await linhaGranel.innerText(), /178/, 'mostra o rendimento');
    await linhaGranel.locator('[data-granel]').click();
    await cq.page.waitForSelector('#modalGranelBg.open');
    assert.match(await cq.page.locator('#qGranelInfo').innerText(), /Pesagem por Operador João/);
    assert.match(await cq.page.locator('#qGranelInfo').innerText(), /conferida por Manipuladora Ana/);
    const ensaios = await cq.page.locator('#qGranelPlanoBody').innerText();
    assert.match(ensaios, /ASPECTO/, 'a análise de granel usa a especificação do produto');
    assert.match(ensaios, /PH/);
    await cq.page.selectOption('[data-granel-cnc="e1"]', 'C');
    await cq.page.fill('[data-granel-valor="e2"]', '6');
    await cq.page.locator('[data-granel-valor="e2"]').dispatchEvent('change');
    await cq.page.click('#qGranelLiberar');
    await cq.page.waitForFunction(() => window.__db.ops['26260-01'].manipulacao.status === 'LIBERADO', null, {timeout: 8000});
    const dbCq = await cq.page.evaluate(() => window.__db);
    assert.equal(dbCq.ops['26260-01'].manipulacao.analise.por, 'Daiene');
    assert.equal(String(dbCq.ops['26260-01'].manipulacao.analise.ensaios.e2.valor), '6');
    assert.deepEqual(cq.errors, [], 'erros na tela da Qualidade: ' + cq.errors.join(' | '));
    await cq.page.close();

    // ── Apontamento: o envase só enxerga a OP depois da liberação ───────
    const envase = await abrir(browser, 'pes', estadoParaCq, 'form.html');
    await envase.page.waitForFunction(() => typeof Manipulacao !== 'undefined' && window.opsCache && window.opsCache['26260-01'], null, {timeout: 8000});
    const antes = await envase.page.evaluate(() => Manipulacao.podeEnvasar(opsCache['26260-01']));
    assert.equal(antes.ok, false, 'granel aguardando CQ trava o envase');
    await envase.page.evaluate((d) => { window.__db.ops['26260-01'].manipulacao.status = 'LIBERADO'; }, null);
    const depois = await envase.page.evaluate(() => Manipulacao.podeEnvasar({manipulacao: {status: 'LIBERADO'}}));
    assert.equal(depois.ok, true);
    await envase.page.close();

    assert.deepEqual(errors, [], 'erros na tela do pesador: ' + errors.join(' | '));
    assert.deepEqual(r2.errors, [], 'erros na tela do manipulador: ' + r2.errors.join(' | '));
    console.log('OK Manipulação: pesagem baixa estoque e exige lote/justificativa, conferência é de outra pessoa, manipulação grava tempos, perdas e rendimento, granel vai para a Qualidade.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
