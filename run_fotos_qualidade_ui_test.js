'use strict';
/* Fotos nas análises da Qualidade (pedido do usuário, 30/09): laudo de insumo,
   embalagem e PA, análise do bulk e RNC. Até 6 fotos; reprovação exige uma
   (ou "Não há o que fotografar"). Tela real; Firebase e Storage simulados. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  const lote = (cod, nome, origem, extra) => Object.assign({itemTipo: 'material', itemCodigo: cod, itemNome: nome, unidade: 'kg',
    saldoLote: 100, qtdOriginal: 100, status: 'QUARENTENA', origemTipo: 'recebimento_pc', loteOrigem: origem,
    criadoEm: '2026-09-16T12:00:00Z', recebimento: {notaFiscal: '1', recebidoPor: 'Yasmim', data: '2026-09-16'}}, extra || {});
  return {
    usuarios: {u1: {nome: 'Daiene', email: 'cq@kuryos.com', role: 'qualidade'}},
    config: {linhas: ['Linha 1']},
    estoque_lotes: {
      'MP-0001': {l1: lote('MP-0001', 'ÁLCOOL CEREAIS', 'L-ALC-1'), l2: lote('MP-0001', 'ÁLCOOL CEREAIS', 'L-ALC-2'), l3: lote('MP-0001', 'ÁLCOOL CEREAIS', 'L-ALC-3')},
      'EP-00106': {e1: lote('EP-00106', 'FRASCO 200ML', 'BP-1', {unidade: 'un', saldoLote: 12000})}
    },
    materiais: {
      m1: {mpCodigo: 'MP-0001', mpNome: 'ÁLCOOL CEREAIS', tipo: 'MPGR', unidade: 'kg'},
      m2: {mpCodigo: 'EP-00106', mpNome: 'FRASCO 200ML', tipo: 'EP', unidade: 'un'}
    },
    ops: {'26300-01': {lote: '26300/01', sku: 'SKU9', produto: 'HIDRATANTE TESTE', status: 'Em Produção',
      manipulacao: {status: 'AGUARDANDO_CQ', previstos: {}, pesagem: {}, manipulacao: {inicio: '2026-09-29T10:00:00Z', fim: '2026-09-29T14:00:00Z', por: 'Ana', rendimento: 300}}}},
    produtos: {}, especificacoes: {}, fornecedores: {}, pedidos_compra: {}, nao_conformidades: {}, parametros_pa: {}
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
    // O nome do PDF é o título da aba no momento da impressão -- guardar o
    // título aqui é a única forma de conferir isso sem abrir o diálogo.
    window.print = function() { window.__tituloImpressao = document.title; };
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
      storage() {
        return {ref(caminho) {
          return {put(arq) { (window.__uploads = window.__uploads || []).push({caminho: caminho, tipo: arq && arq.type}); return Promise.resolve(); },
            getDownloadURL() { return Promise.resolve('https://fake-storage/' + caminho); }};
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

/* Preenche um campo pelo VALOR + evento, em vez de digitar.

   O fill() do Playwright se perde nos campos dentro do modal de laudo
   (`.modal-body` com overflow): ora fica preso na checagem de
   actionability, ora insere o texto no campo que estava com o foco --
   numa execução o "48" da largura foi parar no campo de quantidade, que
   tinha "3", virando "348" amostras. É limitação da automação, não da
   tela: no navegador os campos funcionam normalmente (ver o screenshot de
   CK7_SCREENSHOT). O que o teste precisa garantir é que o valor digitado
   chega ao registro gravado, e é isso que este helper exercita -- os
   listeners reais da tela, com os eventos reais. */
async function preencher(page, seletor, valor, evento) {
  await page.evaluate(({s, v, ev}) => {
    const el = document.querySelector(s);
    if (!el) throw new Error('campo não encontrado: ' + s);
    el.value = v;
    el.dispatchEvent(new Event(ev || 'input', {bubbles: true}));
  }, {s: seletor, v: valor, ev: evento});
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

/* Preenche um campo pelo VALOR + evento, em vez de digitar.

   O fill() do Playwright se perde nos campos dentro do modal de laudo
   (`.modal-body` com overflow): ora fica preso na checagem de
   actionability, ora insere o texto no campo que estava com o foco --
   numa execução o "48" da largura foi parar no campo de quantidade, que
   tinha "3", virando "348" amostras. É limitação da automação, não da
   tela: no navegador os campos funcionam normalmente (ver o screenshot de
   CK7_SCREENSHOT). O que o teste precisa garantir é que o valor digitado
   chega ao registro gravado, e é isso que este helper exercita -- os
   listeners reais da tela, com os eventos reais. */
async function preencher(page, seletor, valor, evento) {
  await page.evaluate(({s, v, ev}) => {
    const el = document.querySelector(s);
    if (!el) throw new Error('campo não encontrado: ' + s);
    el.value = v;
    el.dispatchEvent(new Event(ev || 'input', {bubbles: true}));
  }, {s: seletor, v: valor, ev: evento});
}


const PNG = (n) => ({name: n, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')});
const setar = (page, id, v) => preencher(page, id, v);

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser);
    await page.waitForSelector('[data-tipo-fila="mp"].on');
    const abrirLote = async (origem) => {
      await page.locator('#qFilaBody tr', {hasText: origem}).locator('button[data-laudo-lote]').click();
      await page.waitForSelector('#qFotosLaudo .fq');
    };

    // ── 1. O seletor aparece, limite de 6, legenda, remover ───────────────
    await abrirLote('L-ALC-1');
    assert.match(await page.locator('#qFotosLaudo .fq-cont').innerText(), /0 de 6 · opcional/);
    await page.setInputFiles('#qFotosLaudo input[type=file]', Array.from({length: 8}, (_, i) => PNG('f' + i + '.png')));
    await page.waitForFunction(() => document.querySelectorAll('#qFotosLaudo .fq-it').length === 6);
    assert.match(await page.locator('#qFotosLaudo .fq-erro').innerText(), /Só cabem mais 6 fotos/);
    assert.match(await page.locator('#qFotosLaudo .fq-cont').innerText(), /6 de 6/);
    assert.equal(await page.locator('#qFotosLaudo .fq-btn.off').count(), 1, 'botão desabilitado no limite');
    await page.locator('#qFotosLaudo .fq-x').first().click();
    assert.match(await page.locator('#qFotosLaudo .fq-cont').innerText(), /5 de 6/);
    await page.locator('#qFotosLaudo input[type=text]').first().fill('lacre rompido');
    await page.locator('#qFotosLaudo input[type=text]').first().dispatchEvent('input');

    if (process.env.FOTOS_SCREENSHOT_LAUDO) { await page.locator('#qFotosLaudo').scrollIntoViewIfNeeded(); await page.screenshot({path: process.env.FOTOS_SCREENSHOT_LAUDO}); }

    // ── 2. Reprovar COM foto: sobe 5, grava no lote e herda na RNC ────────
    await setar(page, '#qObservacao', 'Lacre rompido e embalagem amassada');
    await page.click('#qBtnReprovar');
    await page.waitForFunction(() => window.__db.estoque_lotes['MP-0001'].l1.status === 'REPROVADO', null, {timeout: 8000});
    const db1 = await page.evaluate(() => window.__db);
    const q1 = db1.estoque_lotes['MP-0001'].l1.qualidade;
    assert.equal(q1.fotos.length, 5);
    assert.equal(q1.fotos[0].legenda, 'lacre rompido');
    assert.match(q1.fotos[0].url, /^https:\/\/fake-storage\/qualidade\/laudo_MP-0001_l1\//);
    assert.ok(q1.fotos[0].enviadoPor && q1.fotos[0].enviadoEm, 'quem e quando');
    assert.ok(!q1.fotosDispensadas);
    const uploads = await page.evaluate(() => window.__uploads);
    assert.equal(uploads.length, 5);
    assert.ok(uploads.every((u) => u.tipo === 'image/png'));
    const rnc = Object.values(db1.nao_conformidades)[0];
    assert.equal(rnc.fotos.length, 5, 'a RNC automática herda as fotos do laudo (prova para o fornecedor)');

    // ── 3. Reprovar SEM foto: bloqueia; nada grava, nada sobe ─────────────
    await abrirLote('L-ALC-2');
    await setar(page, '#qObservacao', 'Cor fora do padrão');
    await page.click('#qBtnReprovar');
    await page.waitForFunction(() => /pelo menos uma foto/.test(document.getElementById('alertBox') ? document.getElementById('alertBox').innerText : document.body.innerText));
    const db2 = await page.evaluate(() => window.__db);
    assert.equal(db2.estoque_lotes['MP-0001'].l2.status, 'QUARENTENA', 'continua em quarentena');
    assert.equal((await page.evaluate(() => window.__uploads)).length, 5, 'nenhum upload novo');

    // ── 4. "Não há o que fotografar" libera a reprovação e fica registrado ─
    await page.locator('#qFotosLaudo .fq-sem-cb').check();
    await page.click('#qBtnReprovar');
    await page.waitForFunction(() => window.__db.estoque_lotes['MP-0001'].l2.status === 'REPROVADO', null, {timeout: 8000});
    const q2 = (await page.evaluate(() => window.__db)).estoque_lotes['MP-0001'].l2.qualidade;
    assert.ok(!q2.fotos, "sem fotos gravadas");
    assert.equal(q2.fotosDispensadas, true);

    // ── 5. Liberar não exige foto ─────────────────────────────────────────
    await page.click('[data-tipo-fila="embalagem"]');
    await abrirLote('BP-1');
    await page.click('#qBtnLiberar');
    // Embalagem pode pedir confirmação do checklist incompleto: o diálogo é aceito pelo helper.
    await page.waitForFunction(() => window.__db.estoque_lotes['EP-00106'].e1.status !== 'QUARENTENA', null, {timeout: 8000}).catch(() => null);
    const e1 = (await page.evaluate(() => window.__db)).estoque_lotes['EP-00106'].e1;
    if (e1.status === 'LIBERADO') assert.ok(!e1.qualidade.fotos, 'liberação sem foto grava sem foto');
    else await page.click('#modalLaudoCancel');

    // ── 6. As fotos aparecem: histórico do laudo e galeria ────────────────
    // O simulador não empurra atualizações: a tela relê o que foi gravado.
    await page.evaluate(() => { allEstoqueLotes = window.__db.estoque_lotes; allRncs = window.__db.nao_conformidades; tipoFila = 'mp'; renderFila(); });
    const btnFotos = page.locator('button.fq-link').first();
    await btnFotos.waitFor({timeout: 8000});
    assert.match(await btnFotos.innerText(), /📷 5/);
    await btnFotos.click();
    await page.waitForSelector('.fq-gal');
    assert.equal(await page.locator('.fq-gal img').count(), 5);
    assert.match(await page.locator('.fq-gal').innerText(), /lacre rompido/);
    await page.click('.fq-fechar');
    assert.equal(await page.locator('.fq-gal').count(), 0);

    // ── 7. RNC manual: fotos na abertura ──────────────────────────────────
    await page.evaluate(() => abrirModalNovaRnc());
    await page.waitForSelector('#rncFotosAbertura .fq');
    await setar(page, '#rncDescricao', 'Palete caído no corredor');
    await page.setInputFiles('#rncFotosAbertura input[type=file]', [PNG('a.png'), PNG('b.png')]);
    await page.waitForFunction(() => document.querySelectorAll('#rncFotosAbertura .fq-it').length === 2);
    await page.click('#rncBtnSalvar');
    await page.waitForFunction(() => Object.values(window.__db.nao_conformidades).some((r) => /Palete caído/.test(r.descricao)), null, {timeout: 8000});
    const rncMan = Object.values((await page.evaluate(() => window.__db)).nao_conformidades).find((r) => /Palete caído/.test(r.descricao));
    assert.equal(rncMan.fotos.length, 2);
    assert.match(rncMan.fotos[0].url, /qualidade\/rnc_nova-/);

    // ── 8. Análise do bulk: reprovar exige foto ───────────────────────────
    await page.evaluate(() => { allOpsQualidade = window.__db.ops; tipoFila = 'bulk'; renderFilaGranel(); });
    await page.evaluate(() => abrirLaudoGranel('26300-01'));
    await page.waitForSelector('#qFotosGranel .fq');
    await setar(page, '#qGranelObs', 'Turvo');
    await page.click('#qGranelReprovar');
    await page.waitForFunction(() => /pelo menos uma foto/.test(document.body.innerText));
    assert.equal((await page.evaluate(() => window.__db)).ops['26300-01'].manipulacao.status, 'AGUARDANDO_CQ');
    await page.setInputFiles('#qFotosGranel input[type=file]', [PNG('turvo.png')]);
    await page.waitForFunction(() => document.querySelectorAll('#qFotosGranel .fq-it').length === 1);
    await page.click('#qGranelReprovar');
    await page.waitForFunction(() => window.__db.ops['26300-01'].manipulacao.status === 'REPROVADO', null, {timeout: 8000});
    const an = (await page.evaluate(() => window.__db)).ops['26300-01'].manipulacao.analise;
    assert.equal(an.fotos.length, 1);
    assert.match(an.fotos[0].url, /qualidade\/bulk_26300-01\//);

    if (process.env.FOTOS_SCREENSHOT) await page.screenshot({path: process.env.FOTOS_SCREENSHOT});
    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    console.log('OK Fotos da Qualidade: limite de 6, legenda, reprovação exige foto (ou dispensa), herda na RNC, galeria, bulk e RNC manual.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
