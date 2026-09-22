'use strict';
/* Qualidade ponta a ponta: UM lote de cada tipo, cada um no SEU roteiro, e
   o laudo saindo impresso no formulário certo.

   - Palete de PA  → CK-7 (√N+1 nas caixas, pesagem em aberto, retenção)
                     → "Relatório de Análise — Produto Acabado"
   - Matéria-prima → plano de ensaios da especificação → F0070 / POP 004
   - Embalagem     → F009 / POP 041 (13 parâmetros + dimensional em aberto)

   O roteiro é escolhido pelo `tipo` do cadastro de Materiais (MPGR/MPES vs
   EP/ES/ET), que foi o pedido do usuário em 21/09. Defeito crítico e peso
   fora travam a liberação nos três.

   Tela real com utils.js, inspecao-pa.js, inspecao-embalagem.js, laudo-cq.js
   e auth_check.js reais; Firebase simulado em memória, para conferir o que
   ficaria gravado. */
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
          saldoLote: 200, qtdOriginal: 200, status: 'QUARENTENA', origemTipo: 'recebimento_pc',
          loteOrigem: 'AK-2026-000576', criadoEm: '2026-09-16T12:00:00Z',
          recebimento: {notaFiscal: '347410', recebidoPor: 'Yasmim', data: '2026-09-16'}}
      },
      // Embalagem: mesmo lugar na fila, roteiro OUTRO (F009).
      'EP-00106': {
        lote_emb: {itemTipo: 'material', itemCodigo: 'EP-00106', itemNome: 'FRASCO 200ML CRISTAL 24GR',
          unidade: 'un', saldoLote: 12000, qtdOriginal: 12000, status: 'QUARENTENA',
          origemTipo: 'recebimento_pc', loteOrigem: 'BP-4471', criadoEm: '2026-09-16T12:00:00Z',
          recebimento: {notaFiscal: '99871', recebidoPor: 'Adlai', data: '2026-09-16'}}
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
    // O `tipo` do cadastro é o que decide o roteiro (pedido do usuário em
    // 21/09: "direcionar a partir da categoria do SKU cadastrado").
    materiais: {
      m1: {mpCodigo: 'MP-0001', mpNome: 'ÁLCOOL CEREAIS', tipo: 'MPGR', unidade: 'kg'},
      m2: {mpCodigo: 'EP-00106', mpNome: 'FRASCO 200ML CRISTAL 24GR', tipo: 'EP', unidade: 'un'}
    },
    fornecedores: {}, pedidos_compra: {}, nao_conformidades: {}, parametros_pa: {}
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

    // ── 2b. Pesagem com a quantidade EM ABERTO ───────────────────────────
    // A amostra de ASPECTO segue √N+1 sobre as caixas (7 de 36, acima). A de
    // PESO é outra: o Relatório de Análise oficial pede 32, e a tela dava 7.
    // Pedido do usuário em 21/09 -- padrão 32, mas a inspetora muda à vontade.
    const nCampos = () => page.locator('[data-ck7-peso]').count();
    assert.equal(await nCampos(), 32, 'pesagem começa no padrão do laudo');
    await peso(page, 0, '195');
    // Encolher preserva o que já foi digitado e renumera do fim pra frente.
    await page.fill('#qCk7PesoQtd', '4');
    await page.locator('#qCk7PesoQtd').dispatchEvent('change');
    assert.equal(await nCampos(), 4);
    assert.equal(await page.locator('[data-ck7-peso="0"]').inputValue(), '195',
      'encolher não pode apagar peso já registrado');
    await page.click('#qCk7PesoMais');
    assert.equal(await nCampos(), 5, '"+ unidade" acrescenta uma pesagem');
    assert.equal(await page.locator('[data-ck7-peso="0"]').inputValue(), '195');
    // O × de uma unidade remove aquela linha.
    await page.click('[data-ck7-peso-rm="4"]');
    assert.equal(await nCampos(), 4);
    await page.fill('#qCk7PesoQtd', '3');
    await page.locator('#qCk7PesoQtd').dispatchEvent('change');
    assert.equal(await nCampos(), 3);

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

    // ── 6b. Emissão do laudo em PDF ──────────────────────────────────────
    // O relatório é o ESPELHO do que ficou gravado: sai do laudo acima, não
    // de uma redigitação. Pedido do usuário em 21/09 -- hoje esse documento
    // é montado fora do sistema, por um script que lê uma planilha do Forms.
    // O Firebase simulado entrega o snapshot UMA vez (o `on` do stub não é
    // listener de verdade), então a tela não redesenha sozinha depois da
    // gravação. Entregar o snapshot novo à mão é exatamente o que o
    // listener real faz em produção.
    await page.evaluate(() => { allEstoqueLotes = window.__db.estoque_lotes; renderFila(); });
    await page.waitForSelector('#qHistBody [data-emitir-item]');
    await page.click('#qHistBody [data-emitir-item="MRARBS04"]');
    await page.waitForSelector('#modalEmitirBg.open');
    // Sem lista cadastrada, "Outro responsável" já vem escolhido e o nome
    // de quem está logado entra preenchido.
    assert.equal(await page.locator('#qEmitResponsavel').inputValue(), 'outro');
    assert.equal(await page.locator('#qEmitNome').inputValue(), 'Daiene');
    await page.fill('#qEmitNome', 'Mario Callegaro');
    await page.fill('#qEmitRegistro', 'CRQ 04413184');
    await page.click('#qEmitImprimir');
    await page.waitForFunction(() => document.getElementById('laudoPrintArea').innerHTML.length > 0);

    const laudo = await page.evaluate(() => document.getElementById('laudoPrintArea').innerText);
    assert.match(laudo, /RELATÓRIO DE ANÁLISE/);
    assert.match(laudo, /BODY SPLASH NÉCTAR DAS TAMARAS/, 'produto do lote');
    assert.match(laudo, /26257\/17/, 'lote analisado');
    assert.match(laudo, /MISS RÔSE/, 'cliente do produto');
    assert.match(laudo, /Análise de Peso: 3 amostras/, 'a pesagem que foi feita, não um número fixo');
    assert.match(laudo, /Mario Callegaro/);
    assert.match(laudo, /CRQ 04413184/);
    assert.match(laudo, /☒ Produto APROVADO/, 'liberado para expedição = aprovado no laudo');
    assert.match(laudo, /Conformidade do Rótulo/, 'aspecto visual da embalagem veio do CK-7');
    assert.match(laudo, /LAB-2026-88/, 'laudo externo informado na inspeção');
    // O nome do arquivo do PDF é o título da aba no momento da impressão.
    assert.equal(await page.evaluate(() => window.__tituloImpressao),
      'Relatório de análise - BODY SPLASH NÉCTAR DAS TAMARAS - 26257.17');
    // Quem assinou entra na lista para a próxima emissão.
    await page.waitForFunction(() => (window.__db.config || {}).responsaveisCq, null, {timeout: 6000});
    db = await page.evaluate(() => window.__db);
    assert.equal(db.config.responsaveisCq[0].nome, 'Mario Callegaro');
    assert.equal(db.config.responsaveisCq[0].registro, 'CRQ 04413184');

    // ── 7. Material continua com o plano de ensaios de sempre ────────────
    const linhaMp = page.locator('#qFilaBody tr', {hasText: 'MP-0001'});
    await linhaMp.locator('button[data-laudo-lote]').click();
    await page.waitForSelector('#qPlanoBox');
    assert.equal(await page.locator('#qCk7Box').isVisible(), false, 'CK-7 é só de produto acabado');
    assert.match(await page.locator('#qPlanoBody').innerText(), /TEOR DE ÁLCOOL/);
    assert.equal(await page.locator('#qChecklistRecebimento').isVisible(), true);
    assert.equal(await page.locator('#qEmbBox').isVisible(), false, 'F009 é só de embalagem');

    // ── 7b. E sai no F0070, com os ensaios que foram medidos ─────────────
    await page.evaluate(() => {
      Object.keys(laudoAtual.espec.registro.itens).forEach((k) => {
        laudoAtual.resultados[k] = {valor: '97'};
      });
      renderPlanoInspecao();
    });
    await preencher(page, '#qQtdPorEmb', '1000 L');
    await preencher(page, '#qDescEmb', 'Container');
    await page.selectOption('#qLacre', 'sim');
    await page.selectOption('#qCondicaoEmb', 'APROPRIADA');
    await page.selectOption('#qAvaria', 'SEM');
    await page.click('#qBtnLiberar');
    await page.waitForFunction(() => window.__db.estoque_lotes['MP-0001'].lote_mp.status !== 'QUARENTENA', null, {timeout: 8000});
    db = await page.evaluate(() => window.__db);
    const qMp = db.estoque_lotes['MP-0001'].lote_mp.qualidade;
    assert.equal(qMp.decisao, 'LIBERADO');
    assert.equal(qMp.recebimentoCq.qtdPorEmbalagem, '1000 L');
    assert.equal(qMp.recebimentoCq.lacre, true);
    assert.ok(!qMp.embalagem, 'MP não tem checklist de embalagem');

    await page.evaluate(() => {
      allEstoqueLotes = window.__db.estoque_lotes;
      responsaveisCq = (window.__db.config || {}).responsaveisCq || [];
      renderFila();
    });
    await page.click('#qHistBody [data-emitir-item="MP-0001"]');
    await page.waitForSelector('#modalEmitirBg.open');
    await page.selectOption('#qEmitResponsavel', '0');
    await page.click('#qEmitImprimir');
    await page.waitForFunction(() => /F0070/.test(document.getElementById('laudoPrintArea').innerText));
    const f0070 = await page.evaluate(() => document.getElementById('laudoPrintArea').innerText);
    assert.match(f0070, /RECEBIMENTO E ANÁLISE DE MATÉRIA PRIMA/);
    assert.match(f0070, /POP 004/);
    assert.match(f0070, /ÁLCOOL CEREAIS/);
    assert.match(f0070, /TEOR DE ÁLCOOL/, 'o ensaio medido entra na tabela de resultados analíticos');
    assert.match(f0070, /95 - 99/, 'com a especificação cadastrada');
    assert.match(f0070, /Container/);
    assert.match(f0070, /347410/, 'NF da entrada');
    assert.doesNotMatch(f0070, /Rosqueamento/, 'parâmetro de embalagem não aparece em MP');
    assert.doesNotMatch(f0070, /Microbiológicas/, 'micro é do relatório de PA');

    // ── 8. Embalagem tem roteiro PRÓPRIO (F009) ──────────────────────────
    // Pedido do usuário em 21/09: direcionar pela categoria do SKU. Frasco
    // é EP no cadastro, então abre o formulário de embalagem, não o de MP.
    // O modal já fechou sozinho ao liberar a MP acima.
    const linhaEmb = page.locator('#qFilaBody tr', {hasText: 'EP-00106'});
    await linhaEmb.locator('button[data-laudo-lote]').click();
    await page.waitForSelector('#qEmbBox');
    assert.equal(await page.locator('#qEmbBox').isVisible(), true, 'embalagem abre o F009');
    assert.equal(await page.locator('#qCk7Box').isVisible(), false, 'CK-7 é só de palete');
    assert.equal(await page.locator('#qPlanoBox').isVisible(), false, 'embalagem não usa ensaio de laboratório');
    assert.equal(await page.locator('#qSemPlano').isVisible(), false,
      'não faz sentido cobrar especificação de uma embalagem');
    if (process.env.F009_SCREENSHOT) await page.screenshot({path: process.env.F009_SCREENSHOT, fullPage: true});
    const itensEmb = await page.locator('#qEmbItens').innerText();
    assert.match(itensEmb, /Rachaduras/);
    assert.match(itensEmb, /Rosqueamento/);
    assert.match(itensEmb, /Vedação/);
    assert.equal(await page.locator('[data-emb-med]').count(), 12 * 4,
      '12 amostras × 4 medidas, o padrão do formulário');

    // Dimensional em aberto, igual à pesagem de PA.
    await preencher(page, '[data-emb-med="0"][data-emb-campo="altura"]', '152');
    await preencher(page, '#qEmbQtd', '3', 'change');
    assert.equal(await page.locator('[data-emb-med]').count(), 3 * 4);
    assert.equal(await page.locator('[data-emb-med="0"][data-emb-campo="altura"]').inputValue(), '152',
      'encolher não apaga medida já registrada');
    await preencher(page, '[data-emb-med="0"][data-emb-campo="largura"]', '48');
    await preencher(page, '[data-emb-med="1"][data-emb-campo="altura"]', '152.2');
    await preencher(page, '#qEmbFicha', 'Altura 152 ± 1 mm · Largura 48 ± 0,5 mm');

    // Rachadura é crítica: trava a liberação, como no CK-7.
    await page.selectOption('[data-emb-cnc="rachaduras"]', 'NC');
    assert.match(await page.locator('#qEmbImpedimentos').innerText(), /Não é possível liberar/);
    await page.click('#qBtnLiberar');
    await page.waitForSelector('#alertBox.show');
    assert.match(await page.locator('#alertBox').innerText(), /rachaduras/);
    db = await page.evaluate(() => window.__db);
    assert.equal(db.estoque_lotes['EP-00106'].lote_emb.status, 'QUARENTENA', 'nada gravado com defeito crítico');

    // Tudo conforme: libera, guarda o checklist e a identificação do papel.
    await page.evaluate(() => {
      InspecaoEmbalagem.PLANO_F009.forEach((i) => { laudoAtual.emb.respostas[i.id] = {cnc: 'C'}; });
      renderEmbalagem();
    });
    await preencher(page, '#qQtdPorEmb', '240 un');
    await preencher(page, '#qDescEmb', 'Caixa de papelão');
    await page.selectOption('#qLacre', 'nao');
    await page.selectOption('#qCondicaoEmb', 'APROPRIADA');
    await page.selectOption('#qAvaria', 'SEM');
    await page.click('#qBtnLiberar');
    await page.waitForFunction(() => window.__db.estoque_lotes['EP-00106'].lote_emb.status !== 'QUARENTENA', null, {timeout: 8000});
    db = await page.evaluate(() => window.__db);
    const qEmb = db.estoque_lotes['EP-00106'].lote_emb.qualidade;
    assert.equal(qEmb.embalagem.versaoPlano, 'F009-REV01');
    assert.equal(qEmb.embalagem.itens.vedacao.cnc, 'C');
    assert.equal(qEmb.embalagem.dimensional.length, 2, 'só as amostras com medida vão para o laudo');
    assert.equal(qEmb.embalagem.dimensional[0].altura, 152);
    assert.equal(qEmb.embalagem.fichaTecnica, 'Altura 152 ± 1 mm · Largura 48 ± 0,5 mm');
    assert.equal(qEmb.recebimentoCq.descricaoEmbalagem, 'Caixa de papelão');
    assert.equal(qEmb.recebimentoCq.lacre, false);
    assert.equal(qEmb.recebimentoCq.avaria, 'SEM');

    // ── 9. O F009 sai impresso ───────────────────────────────────────────
    await page.evaluate(() => {
      allEstoqueLotes = window.__db.estoque_lotes;
      // Mesmo motivo do snapshot acima: o `on` do stub entrega uma vez só.
      responsaveisCq = (window.__db.config || {}).responsaveisCq || [];
      renderFila();
    });
    await page.click('#qHistBody [data-emitir-item="EP-00106"]');
    await page.waitForSelector('#modalEmitirBg.open');
    assert.equal(await page.locator('#qEmitMicroBox').isVisible(), false,
      'microbiológica é do relatório de PA, não do F009');
    await page.selectOption('#qEmitResponsavel', '0');
    await page.click('#qEmitImprimir');
    await page.waitForFunction(() => /F009/.test(document.getElementById('laudoPrintArea').innerText));
    const f009 = await page.evaluate(() => document.getElementById('laudoPrintArea').innerText);
    assert.match(f009, /RECEBIMENTO E ANÁLISE DE EMBALAGENS/);
    assert.match(f009, /POP 041/);
    assert.match(f009, /FRASCO 200ML CRISTAL/);
    assert.match(f009, /Rosqueamento/);
    assert.match(f009, /Altura 152 ± 1 mm/, 'parâmetros da ficha técnica');
    assert.match(f009, /Mario Callegaro/, 'responsável escolhido da lista salva na emissão anterior');
    assert.match(f009, /99871/, 'NF veio da entrada da Logística');
    assert.equal(await page.evaluate(() => window.__tituloImpressao),
      'F009 - Análise de embalagem - FRASCO 200ML CRISTAL 24GR - BP-4471');

    assert.deepEqual(errors, [], 'erros de página: ' + errors.join(' | '));
    console.log('OK Qualidade: palete usa CK-7 (amostragem √N+1, pesagem, retenção), crítico e peso fora travam a liberação, material mantém o plano de ensaios.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
