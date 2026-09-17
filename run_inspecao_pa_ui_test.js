'use strict';
/* Qualidade: a fila de PA passa a usar o checklist de produto acabado (CK-7)
   e não mais a especificação de granel; defeito crítico e peso fora travam a
   liberação. Tela real com utils.js, inspecao-pa.js e auth_check.js reais;
   Firebase simulado em memória, para conferir o que ficaria gravado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    usuarios: {u1: {nome: 'Daiene', email: 'cq@kuryos.com', role: 'qualidade'}},
    config: {linhas: ['Linha 1']},
    estoque_lotes: {
      MRARBS04: {
        pa_26257_17_p1: {itemTipo: 'produto', itemCodigo: 'MRARBS04', itemNome: 'BODY SPLASH NÉCTAR DAS TAMARAS',
          unidade: 'un', saldoLote: 1500, qtdOriginal: 1500, caixasFechadas: 36, unidadesCaixaParcial: 0,
          status: 'QUARENTENA', origemTipo: 'conferencia_pa', opKey: '26257-17', opLote: '26257/17',
          loteOrigem: '26257/17', dataValidade: '2028-03-15', enderecoCodigo: 'GAL-01', criadoEm: '2026-09-16T12:00:00Z'}
      },
      'MP-0001': {
        lote_mp: {itemTipo: 'material', itemCodigo: 'MP-0001', itemNome: 'ÁLCOOL CEREAIS', unidade: 'kg',
          saldoLote: 200, status: 'QUARENTENA', origemTipo: 'recebimento_pc', loteOrigem: 'AK-2026-000576',
          criadoEm: '2026-09-16T12:00:00Z'}
      }
    },
    // A especificação de GRANEL existe para os dois: o palete não pode mais puxá-la.
    especificacoes: {
      MRARBS04__v1: {codProduto: 'MRARBS04', itens: {
        imp1: {ensaio: 'ASPECTO', especificacaoTexto: 'LÍQUIDO', metodo: 'PA09', critico: false},
        imp2: {ensaio: 'PH', especificacaoTexto: '5 - 7', minimo: 5, maximo: 7, metodo: 'PA01', critico: false}}},
      'MP-0001__v1': {codProduto: 'MP-0001', itens: {
        imp1: {ensaio: 'TEOR DE ÁLCOOL', especificacaoTexto: '95 - 99', minimo: 95, maximo: 99, metodo: 'PA08', critico: true}}}
    },
    ops: {'26257-17': {lote: '26257/17', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR DAS TAMARAS', status: 'Concluído'}},
    produtos: {MRARBS04: {sku: 'MRARBS04', descricao: 'BODY SPLASH NÉCTAR DAS TAMARAS', cliente: 'MISS RÔSE'}},
    materiais: {}, fornecedores: {}, pedidos_compra: {}, nao_conformidades: {}, parametros_pa: {}
  };
}

async function abrir(browser) {
  const page = await browser.newPage({viewport: {width: 1500, height: 1100}});
  const errors = [];
  const dialogos = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { dialogos.push(d.message()); d.accept(); });
  await page.addInitScript(({data}) => {
    const db = data;
    window.__db = db;
    window.__iniciado = false;
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const gravar = (p, v) => {
      const ks = partes(p); let o = db;
      ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
      if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = structuredClone(v);
    };
    let seq = 0;
    const exige = (q) => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() {
        exige('auth');
        return {currentUser: {uid: 'u1', email: 'cq@kuryos.com'},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'cq@kuryos.com', displayName: 'Daiene'}), 0); },
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
            on(ev, cb) { setTimeout(() => cb(snap()), 0); return cb; },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, limitToLast() { return this; }, startAt() { return this; },
            push(v) {
              seq++;
              const filho = ref(path + '/-Q' + seq);
              if (v === undefined) return filho;
              gravar(filho.path, v);
              const pr = Promise.resolve(filho);
              pr.key = filho.key;
              return pr;
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
  }, {data: dados()});
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'cq.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://cq.test/qualidade.html');
  await page.waitForSelector('.kt-sidebar', {timeout: 8000});
  await page.waitForFunction(() => window.currentUser && window.currentUser.role === 'qualidade');
  return {page, errors, dialogos};
}

// fill() sozinho não dispara 'change', que é o evento que a tela escuta.
async function peso(page, i, valor) {
  const campo = page.locator('[data-ck7-peso="' + i + '"]');
  await campo.fill(valor);
  await campo.dispatchEvent('change');
}

const responder = (page, valor) => page.evaluate((v) => {
  InspecaoPA.itensAplicaveis(InspecaoPA.parametros(laudoAtual.parametros)).forEach((i) => {
    laudoAtual.ck7.respostas[i.id] = {cnc: v};
  });
  renderCk7();
}, valor);

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors, dialogos} = await abrir(browser);

    // ── 1. A fila marca o palete com CK-7 ────────────────────────────────
    const linhaPa = page.locator('#qFilaBody tr', {hasText: 'MRARBS04'});
    await linhaPa.waitFor({timeout: 8000});
    assert.match(await linhaPa.innerText(), /CK-7/);

    // ── 2. Palete abre o checklist de PA, não o plano de granel ──────────
    await linhaPa.locator('button[data-laudo-lote]').click();
    await page.waitForSelector('#qCk7Box');
    assert.equal(await page.locator('#qCk7Box').isVisible(), true);
    assert.equal(await page.locator('#qPlanoBox').isVisible(), false, 'plano de granel não abre para palete');
    const aviso = await page.locator('#qSemPlano').innerText();
    assert.match(aviso, /análise de granel .* pertence à manipulação/i);
    const itens = await page.locator('#qCk7Itens tr').allInnerTexts();
    const texto = itens.join(' | ');
    assert.match(texto, /Rótulo correto para a variante/);
    assert.match(texto, /Impressão de lote e validade/);
    assert.match(texto, /Vedação: sem vazamento/);
    assert.match(texto, /Quantidade por caixa/);
    assert.doesNotMatch(texto, /ASPECTO|PH|DENSIDADE/, 'nenhum ensaio de granel no palete');
    assert.doesNotMatch(texto, /Torque/, 'torque só com parâmetro ligado (Qualidade: não usamos)');
    assert.match(await page.locator('#qCk7Amostra').innerText(), /7 de 36 caixa\(s\) — √N\+1/);
    assert.equal(await page.locator('#qChecklistRecebimento').isVisible(), false, 'checklist de recebimento não vale para palete');

    // ── 3. Parâmetros do produto e pesagem ───────────────────────────────
    await page.fill('#qCk7Nominal', '200');
    await page.fill('#qCk7UnCaixa', '24');
    await page.fill('#qCk7EanProduto', '7899999000012');
    await peso(page, 0, '201');
    await peso(page, 1, '199');
    await peso(page, 2, '200');
    await page.waitForFunction(() => /Média/.test(document.getElementById('qCk7Pesos').innerText));
    assert.match(await page.locator('#qCk7Pesos').innerText(), /limite individual 194g/);
    assert.match(await page.locator('#qCk7Pesos').innerText(), /Média 200/);

    if (process.env.CK7_SCREENSHOT) await page.screenshot({path: process.env.CK7_SCREENSHOT, fullPage: true});
    // ── 4. Defeito crítico trava a liberação ─────────────────────────────
    await responder(page, 'C');
    await page.selectOption('[data-ck7-cnc="rotulo_correto"]', 'NC');
    assert.match(await page.locator('#qCk7Impedimentos').innerText(), /Não é possível liberar/);
    await page.click('#qBtnLiberar');
    await page.waitForSelector('#alertBox.show');
    assert.match(await page.locator('#alertBox').innerText(), /Não é possível liberar/);
    let db = await page.evaluate(() => window.__db);
    assert.equal(db.estoque_lotes.MRARBS04.pa_26257_17_p1.status, 'QUARENTENA', 'nada gravado com defeito crítico');

    // ── 5. Peso fora também trava ────────────────────────────────────────
    await page.selectOption('[data-ck7-cnc="rotulo_correto"]', 'C');
    // Média abaixo do nominal reprova.
    await peso(page, 0, '180');
    await page.waitForFunction(() => /Não é possível liberar/.test(document.getElementById('qCk7Impedimentos').innerText));
    assert.match(await page.locator('#qCk7Impedimentos').innerText(), /média de peso abaixo do nominal/);
    // Caso do envase manual: média boa, uma unidade fora do limite individual.
    await peso(page, 1, '215');
    await peso(page, 2, '215');
    await page.waitForFunction(() => /abaixo do limite/.test(document.getElementById('qCk7Impedimentos').innerText));
    assert.match(await page.locator('#qCk7Pesos').innerText(), /Média 203/);
    await peso(page, 0, '201');
    await peso(page, 1, '199');
    await peso(page, 2, '200');

    // ── 6. Tudo conforme: libera e grava o registro ──────────────────────
    await page.fill('#qCk7RetUn', '3');
    await page.fill('#qCk7RetLocal', 'RET-01');
    await page.fill('#qCk7Lab', 'LAB-2026-88 aprovado');
    await page.click('#qBtnLiberar');
    await page.waitForFunction(() => window.__db.estoque_lotes.MRARBS04.pa_26257_17_p1.status !== 'QUARENTENA', null, {timeout: 8000});
    db = await page.evaluate(() => window.__db);
    const lote = db.estoque_lotes.MRARBS04.pa_26257_17_p1;
    assert.equal(lote.status, 'LIBERADO_EXPEDICAO', 'palete vai liberado para a Expedição');
    const q = lote.qualidade;
    assert.ok(q.ck7, 'o checklist fica gravado no laudo');
    assert.equal(q.ck7.versaoPlano, 'CK7-2026-09');
    assert.equal(q.ck7.amostragem.caixasAmostradas, 7);
    assert.equal(q.ck7.amostragem.regra, '√N+1');
    assert.equal(q.ck7.pesagem.media, 200);
    assert.equal(q.ck7.pesagem.limiteIndividual, 194);
    assert.equal(q.ck7.pesagem.conforme, true);
    assert.equal(q.ck7.retencao.guardarAte, '2029-03-15', 'retenção = validade + 1 ano');
    assert.equal(q.ck7.retencao.unidades, 3);
    assert.equal(q.ck7.laboratorio, 'LAB-2026-88 aprovado');
    assert.equal(q.ck7.itens.vedacao.cnc, 'C');
    await page.waitForFunction(() => window.__db.parametros_pa && window.__db.parametros_pa.MRARBS04, null, {timeout: 6000});
    db = await page.evaluate(() => window.__db);
    assert.equal(db.parametros_pa.MRARBS04.conteudoNominal, 200, 'parâmetros guardados para a próxima inspeção');
    assert.equal(db.parametros_pa.MRARBS04.unidadesPorCaixa, 24);
    assert.equal(db.parametros_pa.MRARBS04.eanProduto, '7899999000012');

    // ── 7. Material continua com o plano de ensaios de sempre ────────────
    const linhaMp = page.locator('#qFilaBody tr', {hasText: 'MP-0001'});
    await linhaMp.locator('button[data-laudo-lote]').click();
    await page.waitForSelector('#qPlanoBox');
    assert.equal(await page.locator('#qCk7Box').isVisible(), false, 'CK-7 é só de produto acabado');
    assert.match(await page.locator('#qPlanoBody').innerText(), /TEOR DE ÁLCOOL/);
    assert.equal(await page.locator('#qChecklistRecebimento').isVisible(), true);

    assert.deepEqual(errors, [], 'erros de página: ' + errors.join(' | '));
    console.log('OK Qualidade: palete usa CK-7 (amostragem √N+1, pesagem, retenção), crítico e peso fora travam a liberação, material mantém o plano de ensaios.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
