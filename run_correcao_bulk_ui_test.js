'use strict';
/* Correção de bulk reprovado (25/09), ponta a ponta nas telas reais:
   Qualidade abre a correção (RNC obrigatória, insumos) -> Manipulação pesa,
   outra pessoa confere, manipula e fecha com rendimento acima do lote
   original -> OP ganha o excedente (qtdPlanejada, embalagens, empenho,
   separação reaberta) -> Qualidade libera -> envase liberado -> dossiê com
   os dois ciclos. Firebase simulado em memória (mesmo harness de
   run_manipulacao_ui_test.js). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  // Ciclo 1 já reprovado: fórmula de 180 kg para 1000 un (200 ml x 0,9), rendeu 175 kg.
  const previstos = {
    'MPGR-001': {mpCodigo: 'MPGR-001', mpNome: 'ALCOOL CEREAIS', unidade: 'kg', previsto: 108, ordem: 0},
    'MPGR-002': {mpCodigo: 'MPGR-002', mpNome: 'AGUA DEIONIZADA', unidade: 'kg', previsto: 63, ordem: 1},
    'MPES-003': {mpCodigo: 'MPES-003', mpNome: 'FRAGRANCIA LEAO', unidade: 'kg', previsto: 9, ordem: 2}
  };
  return {
    usuarios: {
      pes: {nome: 'Operador João', email: 'joao@kuryos.com', role: 'production'},
      man: {nome: 'Manipuladora Ana', email: 'ana@kuryos.com', role: 'production'},
      cq: {nome: 'Daiene', email: 'cq@kuryos.com', role: 'qualidade'},
      pcp: {nome: 'Planejador', email: 'pcp@kuryos.com', role: 'pcp'}
    },
    config: {linhas: ['Linha 1']},
    ops: {
      '26300-01': {lote: '26300/01', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR DAS TAMARAS', cliente: 'MISS RÔSE',
        status: 'Programado', qtdPlanejada: 1000, dataEmissao: '2026-09-24T08:00:00', formulaVersao: 'v1',
        materiaisConsumo: {
          f1: {mpCodigo: 'EP-00106', mpNome: 'FRASCO 200ML', quantidade: 1000, unidade: 'un', origem: 'bom'},
          m1: {mpCodigo: 'MPGR-001', mpNome: 'ALCOOL CEREAIS', quantidade: 108, unidade: 'kg', origem: 'formula'}
        },
        separacaoConcluida: {em: '2026-09-24T09:00:00.000Z', por: 'Log', itens: {'EP-00106': 1000}},
        manipulacao: {
          status: 'REPROVADO', previstos: previstos,
          pesagem: {inicio: '2026-09-25T08:00:00.000Z', fim: '2026-09-25T08:40:00.000Z', por: 'Operador João', baixaAplicada: true,
            itens: {'MPGR-001': {pesado: 108, loteMaterial: 'AK-2026-000576'}, 'MPGR-002': {pesado: 63, loteMaterial: 'AK-2026-000577'},
              'MPES-003': {pesado: 9, loteMaterial: 'AK-2026-000578'}}},
          conferencia: {por: 'Manipuladora Ana', em: '2026-09-25T08:50:00.000Z'},
          manipulacao: {inicio: '2026-09-25T09:00:00.000Z', fim: '2026-09-25T10:00:00.000Z', por: 'Manipuladora Ana', rendimento: 175},
          analise: {decisao: 'REPROVADO', por: 'Daiene', em: '2026-09-25T11:00:00.000Z', observacao: 'Bulk turvo'}
        }
      }
    },
    produtos: {MRARBS04: {sku: 'MRARBS04', descricao: 'BODY SPLASH NÉCTAR DAS TAMARAS', cliente: 'MISS RÔSE',
      volume: 200, unidadeVolume: 'ml', densidadeGranel: 0.9}},
    formulas: {MRARBS04__v1: {codProduto: 'MRARBS04', versao: 'v1', status: 'APROVADA', itens: {
      i1: {mpCodigo: 'MPGR-001', mpNome: 'ALCOOL CEREAIS', percentualMM: 60},
      i2: {mpCodigo: 'MPGR-002', mpNome: 'AGUA DEIONIZADA', percentualMM: 35},
      i3: {mpCodigo: 'MPES-003', mpNome: 'FRAGRANCIA LEAO', percentualMM: 5}}}},
    bom: {MRARBS04__v1: {codProduto: 'MRARBS04', versao: 'v1', status: 'APROVADA', itens: {
      b1: {materialCodigo: 'EP-00106', materialNome: 'FRASCO 200ML', qtdPorPeca: 1}}}},
    materiais: {
      'MPGR-001': {mpCodigo: 'MPGR-001', mpNome: 'ALCOOL CEREAIS', unidade: 'kg'},
      'MPGR-002': {mpCodigo: 'MPGR-002', mpNome: 'AGUA DEIONIZADA', unidade: 'kg'},
      'MPES-003': {mpCodigo: 'MPES-003', mpNome: 'FRAGRANCIA LEAO', unidade: 'kg'},
      'MPGR-050': {mpCodigo: 'MPGR-050', mpNome: 'SOLUBILIZANTE PEG-40', unidade: 'kg', tipo: 'MPGR'},
      'EP-00106': {mpCodigo: 'EP-00106', mpNome: 'FRASCO 200ML', unidade: 'un', tipo: 'EP'}
    },
    estoque: {
      'MPGR-050': {saldoAtual: 200, materialNome: 'SOLUBILIZANTE PEG-40'},
      'MPGR-002': {saldoAtual: 500},
      'EP-00106': {saldoAtual: 5000, saldoEmpenhado: 1000, empenhos: {'26300-01': {qtdEmpenhada: 1000}}}
    },
    enderecos_estoque: {'FAB-1-1-1': {codigo: 'FAB-1.1.1', area: 'FABRICA', ativo: true}},
    estoque_lotes: {'MPGR-050': {
      L700: {itemCodigo: 'MPGR-050', itemTipo: 'material', status: 'LIBERADO', saldoLote: 200, loteInterno: 'AK-2026-000700',
        dataValidade: '2027-06-30', enderecoKey: 'FAB-1-1-1', enderecoCodigo: 'FAB-1.1.1'}}},
    movimentos_estoque: {},
    nao_conformidades: {'RNC-2026-0031': {numero: 'RNC-2026-0031', status: 'ABERTA', opLote: '26300/01',
      descricao: 'Granel do lote 26300/01 reprovado: Bulk turvo', abertaEm: '2026-09-25T11:00:05.000Z', classificacao: 'MAIOR'}},
    pedidos_compra: {}, fornecedores: {}, especificacoes: {}, parametros_pa: {}
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

async function campo(page, seletor, valor) {
  const el = page.locator(seletor);
  await el.fill(valor);
  await el.dispatchEvent('change');
}

const OP = '26300-01';
const foto = (nome) => ({name: nome, mimeType: 'image/jpeg', buffer: Buffer.alloc(2048, 7)});
const shot = (page, nome) => process.env.CORR_SCREENSHOT ? page.screenshot({path: process.env.CORR_SCREENSHOT + '_' + nome + '.png', fullPage: false}) : null;
const fase = (page) => page.evaluate((k) => window.__db.ops[k].manipulacao, OP);

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const todosErros = [];
  try {
    // ── Manipulação vê o reprovado travado e o motivo ───────────────────
    const m0 = await abrir(browser, 'pes');
    todosErros.push(m0.errors);
    const l0 = m0.page.locator('#mListaBody tr', {hasText: '26300/01'});
    await l0.waitFor({timeout: 8000});
    assert.match(await l0.innerText(), /Bulk reprovado/);
    await l0.locator('[data-abrir]').click();
    await m0.page.waitForSelector('#mBlocoReprovado', {state: 'visible'});
    assert.match(await m0.page.locator('#mBlocoReprovado').innerText(), /Qualidade abre a correção/);
    await m0.page.close();

    // ── Qualidade: sem permissão (PCP) não abre ─────────────────────────
    const q0 = await abrir(browser, 'pcp', null, 'qualidade.html');
    todosErros.push(q0.errors);
    await q0.page.waitForSelector('#qCardCorrecao', {state: 'visible', timeout: 8000});
    assert.equal(await q0.page.locator('[data-corrigir]').count(), 0, 'PCP não autoriza correção');
    assert.match(await q0.page.locator('#qCorrecaoBody').innerText(), /Só a Qualidade abre/);
    await q0.page.close();

    // ── Qualidade abre a correção ───────────────────────────────────────
    const q = await abrir(browser, 'cq', null, 'qualidade.html');
    todosErros.push(q.errors);
    await q.page.waitForSelector('[data-corrigir="' + OP + '"]', {timeout: 8000});
    assert.match(await q.page.locator('#qCorrecaoBody').innerText(), /26300\/01[\s\S]*Bulk turvo/);
    await q.page.click('[data-corrigir="' + OP + '"]');
    await q.page.waitForSelector('#modalCorrecaoBg.open');
    assert.equal(await q.page.inputValue('#qCorrRnc'), 'RNC-2026-0031', 'única RNC do lote já vem escolhida');
    assert.equal(await q.page.inputValue('#qCorrEntrada'), '175', 'massa de entrada = rendimento reprovado');
    // Sem insumo: barra.
    await q.page.fill('#qCorrMotivo', 'Turbidez — adição de solubilizante');
    await q.page.click('#qCorrConfirmar');
    await q.page.waitForFunction(() => /ao menos uma matéria-prima/.test(document.getElementById('qCorrErros').innerText));
    // A lista oferece só MP; embalagem digitada à mão é recusada.
    const opcoes = await q.page.$$eval('#qCorrMateriais option', (os) => os.map((o) => o.value));
    assert.ok(opcoes.some((v) => /^MPGR-050/.test(v)), 'MP na lista');
    assert.ok(!opcoes.some((v) => /^EP-00106/.test(v)), 'embalagem fora da lista');
    assert.match(await q.page.locator('#modalCorrecaoBg').innerText(), /Matérias-primas a adicionar/);
    await q.page.fill('#qCorrItens .corr-cod', 'EP-00106');
    await q.page.fill('#qCorrItens .corr-qtd', '5');
    await q.page.click('#qCorrConfirmar');
    await q.page.waitForFunction(() => /embalagem primária — a correção adiciona matéria-prima/.test(document.getElementById('qCorrErros').innerText));
    // Insumo fora do cadastro: barra.
    await q.page.fill('#qCorrItens .corr-cod', 'XYZ-999');
    await q.page.fill('#qCorrItens .corr-qtd', '60');
    await q.page.click('#qCorrConfirmar');
    await q.page.waitForFunction(() => /não está no cadastro/.test(document.getElementById('qCorrErros').innerText));
    // Sem RNC: barra.
    await q.page.fill('#qCorrItens .corr-cod', 'MPGR-050 — SOLUBILIZANTE PEG-40');
    await q.page.locator('#qCorrItens .corr-cod').dispatchEvent('change');
    assert.equal(await q.page.inputValue('#qCorrItens .corr-cod'), 'MPGR-050', 'escolha da lista vira o código');
    await q.page.selectOption('#qCorrRnc', '');
    await q.page.click('#qCorrConfirmar');
    await q.page.waitForFunction(() => /RNC/.test(document.getElementById('qCorrErros').innerText));
    assert.equal((await fase(q.page)).status, 'REPROVADO', 'nada gravado com erro');
    await q.page.selectOption('#qCorrRnc', 'RNC-2026-0031');
    await q.page.click('#qCorrAddItem');
    await q.page.locator('#qCorrItens .corr-cod').nth(1).fill('MPGR-002');
    await q.page.locator('#qCorrItens .corr-qtd').nth(1).fill('10');
    await q.page.fill('#qCorrInstrucao', 'Adicionar sob agitação a 40 °C, 20 min');
    await shot(q.page, 'qualidade_modal');
    await q.page.click('#qCorrConfirmar');
    await q.page.waitForFunction((k) => window.__db.ops[k].manipulacao.status === 'CORRECAO_ABERTA', OP);
    const f2 = await fase(q.page);
    assert.equal(f2.ciclo, 2);
    assert.equal(f2.correcao.rncNumero, 'RNC-2026-0031');
    assert.equal(f2.correcao.por, 'Daiene');
    assert.deepEqual(Object.keys(f2.previstos), ['MPGR-050', 'MPGR-002']);
    assert.equal(f2.previstos['MPGR-050'].previsto, 60);
    assert.equal(f2.entradaBulk.kg, 175);
    assert.equal(f2.historico.c1.analise.observacao, 'Bulk turvo', 'ciclo reprovado preservado');
    await q.page.waitForFunction(() => document.getElementById('qCardCorrecao').style.display === 'none');
    const estadoQ = await q.page.evaluate(() => window.__db);
    await q.page.close();

    // ── Pesagem da correção ─────────────────────────────────────────────
    const p = await abrir(browser, 'pes', estadoQ);
    todosErros.push(p.errors);
    const lp = p.page.locator('#mListaBody tr', {hasText: '26300/01'});
    await lp.waitFor({timeout: 8000});
    assert.match(await lp.innerText(), /Correção aberta/);
    await lp.locator('[data-abrir]').click();
    await p.page.waitForSelector('#mCorrecaoInfo', {state: 'visible'});
    const info = await p.page.locator('#mCorrecaoInfo').innerText();
    assert.match(info, /ciclo 2[\s\S]*RNC-2026-0031[\s\S]*175 kg[\s\S]*MPGR-050/);
    assert.match(await p.page.locator('#mPainelTitulo').innerText(), /correção \(ciclo 2\)/i);
    await shot(p.page, 'manipulacao_correcao');
    const mps = await p.page.$$eval('#mPesagemCards .pz-row', (bs) => bs.map((b) => b.getAttribute('data-abrir-mp')));
    assert.deepEqual(mps, ['MPGR-050', 'MPGR-002'], 'pesa só os insumos da correção, não a fórmula');
    await p.page.click('#mBtnIniciarPesagem');
    await p.page.waitForFunction((k) => window.__db.ops[k].manipulacao.status === 'AGUARDANDO_PESAGEM', OP);
    assert.equal((await fase(p.page)).ciclo, 2, 'iniciar a pesagem não perde o ciclo');
    assert.equal(Object.keys((await fase(p.page)).previstos).length, 2, 'previstos continuam os da correção');
    // Solubilizante: FEFO indica o AK-700; foto obrigatória (não é retroativo).
    await p.page.click('.pz-row[data-abrir-mp="MPGR-050"]');
    await p.page.waitForSelector('#pzFoto', {state: 'attached'});
    assert.equal(await p.page.locator('#pzSemFoto').count(), 0, 'sem retroativo, não há "sem foto"');
    await p.page.setInputFiles('#pzFoto', foto('solub.jpg'));
    await p.page.waitForSelector('#formParcela');
    assert.match(await p.page.locator('#formParcela').innerText(), /AK-2026-000700/);
    await p.page.fill('#fpPeso', '60');
    await p.page.waitForFunction(() => !document.getElementById('fpSalvar').disabled);
    await p.page.click('#fpSalvar');
    await p.page.waitForFunction((k) => Object.keys(((window.__db.ops[k].manipulacao.pesagem.parcelas || {})['MPGR-050']) || {}).length === 1, OP);
    await p.page.waitForFunction(() => !document.getElementById('formParcela'));
    await p.page.click('[data-guardar="MPGR-050"]');
    await p.page.click('[data-voltar-lista]');
    await p.page.click('.pz-row[data-abrir-mp="MPGR-002"]');
    await p.page.setInputFiles('#pzFoto', foto('agua.jpg'));
    await p.page.waitForSelector('#formParcela');
    await p.page.fill('#fpPeso', '10');
    await p.page.fill('#fpLote', 'AK-2026-000577');
    await p.page.waitForFunction(() => !document.getElementById('fpSalvar').disabled);
    await p.page.click('#fpSalvar');
    await p.page.waitForFunction((k) => Object.keys(((window.__db.ops[k].manipulacao.pesagem.parcelas || {})['MPGR-002']) || {}).length === 1, OP);
    await p.page.waitForFunction(() => !document.getElementById('formParcela'));
    await p.page.click('[data-guardar="MPGR-002"]');
    await p.page.click('[data-voltar-lista]');
    await p.page.waitForFunction(() => !document.getElementById('mBtnFecharPesagem').disabled, null, {timeout: 8000});
    assert.match(await p.page.locator('#mResumoTempos').innerText(), /Bulk reprovado que entra 175 kg · correção prevista 70 kg · pesado 70 kg/);
    await p.page.click('#mBtnFecharPesagem');
    await p.page.waitForFunction((k) => window.__db.ops[k].manipulacao.status === 'PESADO', OP, {timeout: 8000});
    let db = await p.page.evaluate(() => window.__db);
    assert.equal(db.estoque['MPGR-050'].saldoAtual, 140, 'insumo da correção baixado: 200 − 60');
    assert.equal(db.estoque['MPGR-002'].saldoAtual, 490, '500 − 10');
    assert.equal(db.estoque_lotes['MPGR-050'].L700.saldoLote, 140, 'baixa no lote real');
    assert.equal(db.ops[OP].manipulacao.ciclo, 2, 'fechar a pesagem não perde o ciclo');
    await p.page.close();

    // ── Conferência + manipulação por outra pessoa ──────────────────────
    const m = await abrir(browser, 'man', db);
    todosErros.push(m.errors);
    const lm = m.page.locator('#mListaBody tr', {hasText: '26300/01'});
    await lm.waitFor({timeout: 8000});
    await lm.locator('[data-abrir]').click();
    await m.page.waitForSelector('#mConferenciaBody [data-conf]');
    await m.page.click('[data-conf="MPGR-050"][data-valor="sim"]');
    await m.page.click('[data-conf="MPGR-002"][data-valor="sim"]');
    await m.page.waitForFunction(() => !document.getElementById('mBtnConferir').disabled);
    await m.page.click('#mBtnConferir');
    await m.page.waitForFunction((k) => window.__db.ops[k].manipulacao.status === 'CONFERIDO', OP);
    await m.page.click('#mBtnIniciarManipulacao');
    await m.page.waitForFunction((k) => window.__db.ops[k].manipulacao.status === 'EM_MANIPULACAO', OP);
    // 250 kg > 175 + 70 = 245: barra, com mensagem que explica a soma.
    await m.page.fill('#mRendimento', '250');
    await m.page.locator('#mRendimento').dispatchEvent('input');
    await m.page.locator('#mRendimento').dispatchEvent('change');
    await m.page.waitForFunction(() => /bulk que entrou \(175\)/.test(document.getElementById('mManipulacaoErros').innerText));
    assert.equal(await m.page.locator('#mBtnFecharManipulacao').isDisabled(), true);
    // 240 kg: 175 + 70 − 5 de perda. 180 kg teóricos para 1000 un -> 0,18 kg/un -> 1333 un.
    await m.page.fill('#mRendimento', '240');
    await m.page.locator('#mRendimento').dispatchEvent('input');
    await m.page.locator('#mRendimento').dispatchEvent('change');
    await m.page.waitForFunction(() => !document.getElementById('mBtnFecharManipulacao').disabled);
    assert.match(await m.page.locator('#mManipulacaoResumo').innerText(), /Perda de processo: 5 kg/);
    let confirmTxt = '';
    m.page.removeAllListeners('dialog');
    m.page.on('dialog', (d) => { confirmTxt = d.message(); d.accept(); });
    await m.page.click('#mBtnFecharManipulacao');
    await m.page.waitForFunction((k) => window.__db.ops[k].manipulacao.status === 'AGUARDANDO_CQ', OP);
    await m.page.waitForFunction((k) => window.__db.ops[k].qtdPlanejada === 1333, OP, {timeout: 8000});
    assert.match(confirmTxt, /1\.333 unidades: 333 a mais que as 1\.000/);
    db = await m.page.evaluate(() => window.__db);
    const op = db.ops[OP];
    assert.equal(op.qtdPlanejadaOriginal, 1000, 'original guardado');
    assert.equal(op.excedenteBulk.unidades, 333);
    assert.equal(op.materiaisConsumo.f1.quantidade, 1333, 'frascos do excedente na OP');
    assert.equal(op.materiaisConsumo.f1.quantidadeOriginal, 1000);
    assert.equal(op.materiaisConsumo.m1.quantidade, 108, 'fórmula não muda');
    assert.equal(op.separacaoConcluida, undefined, 'separação reaberta para o excedente');
    assert.equal(op.separacaoParcial.itens['EP-00106'], 1000, 'o que já foi separado conta');
    assert.equal(op.separacaoReaberta.concluidaAntes.por, 'Log', 'registro da separação anterior');
    await m.page.waitForFunction(() => (window.__db.estoque['EP-00106'] || {}).saldoEmpenhado === 1333, null, {timeout: 8000});
    db = await m.page.evaluate(() => window.__db);
    assert.equal(db.estoque['EP-00106'].empenhos['26300-01'].qtdEmpenhada, 1333, 'empenho do lote + excedente');
    assert.equal(op.manipulacao.manipulacao.excedente.unidades, 333, 'excedente gravado no ciclo');
    await m.page.waitForSelector('#mExcedente', {state: 'visible'});
    assert.match(await m.page.locator('#mExcedente').innerText(), /1\.333 unidades — 333 a mais/);
    await m.page.locator('#mExcedente').scrollIntoViewIfNeeded();
    await shot(m.page, 'excedente');
    await m.page.close();

    // ── Qualidade analisa a correção e libera ───────────────────────────
    const q2 = await abrir(browser, 'cq', db, 'qualidade.html');
    todosErros.push(q2.errors);
    await q2.page.waitForSelector('[data-granel="' + OP + '"]', {timeout: 8000});
    await q2.page.click('[data-granel="' + OP + '"]');
    await q2.page.waitForSelector('#modalGranelBg.open');
    assert.match(await q2.page.locator('#modalGranelTitle').innerText(), /correção \(ciclo 2\)/);
    assert.match(await q2.page.locator('#qGranelInfo').innerText(), /Correção da RNC RNC-2026-0031[\s\S]*entrou 175 kg[\s\S]*Pesado na correção 70 kg · rendimento 240 kg/);
    // Sem especificação cadastrada: os seis ensaios físico-químicos do plano
    // padrão, em vez de nenhum (25/09).
    const plano = await q2.page.locator('#qGranelPlanoBody').innerText();
    ['Aspecto físico', 'Cor', 'Odor', 'pH', 'Densidade', 'Teor alcoólico'].forEach((e) => assert.match(plano, new RegExp(e)));
    assert.equal(await q2.page.locator('#qGranelSemPlano').isVisible(), true);
    const avisosQ2 = [];
    q2.page.on('dialog', (d) => avisosQ2.push(d.message()));
    await q2.page.click('#qGranelLiberar');
    await q2.page.waitForFunction((k) => window.__db.ops[k].manipulacao.status === 'LIBERADO', OP);
    db = await q2.page.evaluate(() => window.__db);
    assert.equal(Object.keys(db.nao_conformidades).length, 1, 'liberar não abre RNC');
    assert.ok(avisosQ2.some((m) => /densidade do bulk não foi apontada/.test(m)), 'liberar sem densidade avisa');
    assert.deepEqual(Object.keys(db.ops[OP].manipulacao.analise.ensaios).sort(), ['aspecto', 'cor', 'densidade', 'odor', 'ph', 'teor_alcoolico']);
    await q2.page.close();

    // ── Envase liberado; dossiê com os dois ciclos ──────────────────────
    const env = await abrir(browser, 'pes', db, 'form.html');
    todosErros.push(env.errors);
    await env.page.waitForFunction((k) => typeof Manipulacao !== 'undefined' && window.opsCache && window.opsCache[k], OP, {timeout: 8000});
    assert.equal(await env.page.evaluate((k) => Manipulacao.podeEnvasar(opsCache[k]).ok, OP), true, 'bulk corrigido e liberado envasa');
    await env.page.close();

    const d = await abrir(browser, 'cq', db, 'dossie_lote.html?op=' + OP);
    todosErros.push(d.errors);
    await d.page.waitForFunction(() => /ciclo 2 \(correção\)/i.test(document.body.innerText), null, {timeout: 8000});
    const txt = await d.page.evaluate(() => document.body.innerText);
    assert.match(txt, /ciclo 1[\s\S]*Bulk reprovado[\s\S]*ciclo 2 \(correção\)/i);
    assert.match(txt, /Correção autorizada pela Qualidade[\s\S]*RNC-2026-0031/);
    assert.match(txt, /1\.000 da OP \+ 333 de excedente/);
    assert.match(txt, /Excedente: \+333 un/);
    await d.page.close();

    // ── Retroativo: foto dispensada com justificativa ───────────────────
    const est = dados();
    const qr = await abrir(browser, 'cq', est, 'qualidade.html');
    todosErros.push(qr.errors);
    await qr.page.waitForSelector('[data-corrigir="' + OP + '"]', {timeout: 8000});
    await qr.page.click('[data-corrigir="' + OP + '"]');
    await qr.page.fill('#qCorrMotivo', 'Turbidez');
    await qr.page.fill('#qCorrItens .corr-cod', 'MPGR-050');
    await qr.page.fill('#qCorrItens .corr-qtd', '60');
    await qr.page.check('#qCorrRetro');
    await qr.page.click('#qCorrConfirmar');
    await qr.page.waitForFunction(() => /Justifique/.test(document.getElementById('qCorrErros').innerText));
    await qr.page.fill('#qCorrRetroJust', 'Correção feita em 25/09 antes de o sistema permitir');
    await qr.page.click('#qCorrConfirmar');
    await qr.page.waitForFunction((k) => window.__db.ops[k].manipulacao.status === 'CORRECAO_ABERTA', OP);
    const estR = await qr.page.evaluate(() => window.__db);
    await qr.page.close();
    const pr = await abrir(browser, 'pes', estR);
    todosErros.push(pr.errors);
    const lr = pr.page.locator('#mListaBody tr', {hasText: '26300/01'});
    await lr.waitFor({timeout: 8000});
    await lr.locator('[data-abrir]').click();
    await pr.page.waitForSelector('#mBtnIniciarPesagem', {state: 'visible'});
    assert.match(await pr.page.locator('#mCorrecaoInfo').innerText(), /Registro retroativo/);
    await pr.page.click('#mBtnIniciarPesagem');
    await pr.page.waitForFunction((k) => window.__db.ops[k].manipulacao.status === 'AGUARDANDO_PESAGEM', OP);
    await pr.page.click('.pz-row[data-abrir-mp="MPGR-050"]');
    await pr.page.click('#pzSemFoto');
    await pr.page.waitForSelector('#formParcela');
    assert.match(await pr.page.locator('#formParcela').innerText(), /Registro retroativo sem foto/);
    await pr.page.fill('#fpPeso', '60');
    await pr.page.waitForFunction(() => !document.getElementById('fpSalvar').disabled);
    await pr.page.click('#fpSalvar');
    await pr.page.waitForFunction((k) => Object.keys(((window.__db.ops[k].manipulacao.pesagem.parcelas || {})['MPGR-050']) || {}).length === 1, OP);
    const parc = await pr.page.evaluate((k) => Object.values(window.__db.ops[k].manipulacao.pesagem.parcelas['MPGR-050'])[0], OP);
    assert.equal(parc.semFotoRetroativo, true);
    assert.equal(parc.foto, null);
    await pr.page.waitForFunction(() => !document.getElementById('formParcela'));
    await pr.page.click('[data-guardar="MPGR-050"]');
    await pr.page.click('[data-voltar-lista]');
    await pr.page.waitForFunction(() => !document.getElementById('mBtnFecharPesagem').disabled, null, {timeout: 8000});
    await pr.page.close();

    todosErros.forEach((e) => assert.deepEqual(e, [], 'erros de página: ' + e.join(' | ')));
    console.log('OK Correção de bulk: Qualidade abre com RNC e insumos; Manipulação pesa só a correção (foto, FEFO, baixa no lote), outra pessoa confere; rendimento soma o bulk que entrou; excedente vira unidades, embalagens, empenho e separação reaberta; Qualidade libera; envase e dossiê com os dois ciclos; retroativo sem foto só com justificativa.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
