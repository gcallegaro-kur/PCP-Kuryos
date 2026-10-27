'use strict';
/* Emitir OP › escolha do pedido quando há MAIS DE UM aberto do mesmo SKU.
   Caso real (27/10/2026): a tela pré-selecionava keys[0] em silêncio, e como
   pedidosDoProduto() ordena por priority -- caindo no Object.keys quando
   nenhuma linha tem priority --, a escolha era arbitrária. Seis OPs do
   MRARBS07 foram creditadas ao pedido 0011 enquanto as irmãs da mesma onda
   iam pro 30, e o palete PA-26292-01-P1 travou na Expedição com "Produto não
   consta no pedido comercial".
   Agora: um candidato auto-seleciona (sem atrito); dois ou mais não
   pré-selecionam nada, avisam, e mostram pra onde a onda do dia já foi.
   A emissão feliz completa é coberta por run_fluxo_ponta_a_ponta_test.js;
   aqui o que importa é a escolha do vínculo. Tela real, Firebase simulado
   (mesmo harness de run_emitir_op_bloqueio_ui_test.js). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

// O prefixo do lote é o dia do ano -- igual a prefixoLoteHoje() da tela.
function prefixoHoje() {
  const hoje = new Date();
  const ano2 = String(hoje.getFullYear() % 100).padStart(2, '0');
  const dia = Math.floor((hoje - new Date(hoje.getFullYear(), 0, 1)) / 86400000) + 1;
  return ano2 + String(dia).padStart(3, '0');
}

function dados() {
  const ap = (u) => ({em: new Date().toISOString(), nome: u, uid: 'x'});
  const prod = (sku, desc) => ({sku: sku, descricao: desc, cliente: 'MISS ROSE', clienteKey: 'MISS',
    volume: 200, unidadeVolume: 'ml', densidadeGranel: 0.9, prazoValidadeMeses: 24, ativo: 'Ativo'});
  const aprovados = (sku) => ({
    formula: {codProduto: sku, versao: 'v1', status: 'APROVADA', somaPercentual: 100,
      aprovadoPD: ap('a'), aprovadoQualidade: ap('b'), itens: {a: {mpCodigo: 'MPGR-1', mpNome: 'ALCOOL', percentualMM: 100}}},
    bom: {codProduto: sku, versao: 'v1', status: 'APROVADA', aprovadoPCP: ap('c'), aprovadoComercial: ap('d'),
      itens: {a: {materialCodigo: 'EP-1', materialNome: 'FRASCO', qtdPorPeca: 1}}},
    espec: {codProduto: sku, versao: 'v1', status: 'APROVADA', aprovadoPD: ap('a'), aprovadoQualidade: ap('b'), itens: {}}
  });
  const dois = aprovados('SKU-DOIS'), um = aprovados('SKU-UM');
  const linha = (id, sku, qtdTotal, produzido, extra) => Object.assign({id: id, parentPedidoId: id, sku: sku,
    cliente: 'MISS ROSE', status: 'Não Iniciado', qtdTotal: qtdTotal, produzido: produzido}, extra || {});
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    config: {linhas: ['Linha 1']},
    clientes: {MISS: {nome: 'MISS ROSE'}},
    materiais: {'MPGR-1': {tipo: 'MPGR', mpCodigo: 'MPGR-1', mpNome: 'ALCOOL', unidade: 'kg', ativo: true},
      'EP-1': {tipo: 'EP', mpCodigo: 'EP-1', mpNome: 'FRASCO', unidade: 'un', ativo: true}},
    produtos: {'SKU-DOIS': prod('SKU-DOIS', 'BODY SPLASH DOIS PEDIDOS'), 'SKU-UM': prod('SKU-UM', 'BODY SPLASH UM PEDIDO')},
    formulas: {'SKU-DOIS__v1': dois.formula, 'SKU-UM__v1': um.formula},
    bom: {'SKU-DOIS__v1': dois.bom, 'SKU-UM__v1': um.bom},
    especificacoes: {'SKU-DOIS__v1': dois.espec, 'SKU-UM__v1': um.espec},
    pedidos: {
      // Os dois abertos, NENHUM com priority: é o cenário que tornava a
      // escolha arbitrária. Números espelham o caso real (0011 x 30).
      '0011__SKU-DOIS': linha('0011', 'SKU-DOIS', 60000, 55021),
      '30__SKU-DOIS': linha('30', 'SKU-DOIS', 60000, 14033),
      // Encerrada: não pode entrar como candidata (isConcluido)
      'PED-0008__SKU-DOIS': linha('PED-0008', 'SKU-DOIS', 4800, 4800, {statusManual: 'encerrado'}),
      '0007__SKU-UM': linha('0007', 'SKU-UM', 10000, 0)
    },
    // Uma OP do dia de hoje já saiu pro pedido 30: é a "onda" que a tela mostra
    ops: {[prefixoHoje() + '-01']: {lote: prefixoHoje() + '/01', sku: 'SKU-DOIS', status: 'Concluído',
      skuPedidoKey: '30__SKU-DOIS', produzido: 4817}},
    estoque: {}
  };
}

async function abrir(browser, uid, estadoInicial, pagina) {
  const page = await browser.newPage({viewport: {width: 1500, height: 1200}});
  const errors = [];
  const dialogos = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { dialogos.push(d.message()); d.accept(); });
  await page.addInitScript(({data, quem}) => {
    const db = data;
    window.__db = db;
    window.__iniciado = false;
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const ouvintes = [];
    const notificar = (bruto) => {
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
      functions() { return {httpsCallable: () => async () => ({data: {}})}; },
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
          return {put(arq, meta) { window.__arquivos[caminho] = {bytes: arq.size}; return Promise.resolve(); },
            getDownloadURL() { return Promise.resolve('https://storage.test/' + caminho); },
            delete() { delete window.__arquivos[caminho]; return Promise.resolve(); }};
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
            on(ev, cb) { const avisar = () => cb(snap()); ouvintes.push({path: path, avisar: avisar}); setTimeout(avisar, 0); return cb; },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; },
            limitToLast() { return this; }, startAt() { return this; },
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
  await page.goto('https://mn.test/' + (pagina || 'emitir_op.html'));
  await page.waitForSelector('.kt-sidebar', {timeout: 8000});
  await page.waitForFunction(() => window.currentUser && window.currentUser.nome);
  return {page, errors, dialogos};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser, 'u1', dados(), 'emitir_op.html');
    await page.waitForFunction(() => typeof selecionarProduto === 'function' && typeof allPedidos !== 'undefined' &&
      Object.keys(allPedidos).length === 4 && Object.keys(allOps).length === 1, null, {timeout: 10000});
    const prefixo = prefixoHoje();
    const estado = () => page.evaluate(() => ({
      vinculo: pedidoVinculado ? pedidoVinculado.pedidoKey : null,
      jaEscolheu: vinculoJaEscolhido,
      candidatos: pedidosDoProduto(produtoSelecionado.sku),
      html: document.getElementById('alocacaoLista').innerText,
      // o próprio predicado que barra a emissão
      barraEmissao: !pedidoVinculado && !vinculoJaEscolhido && pedidosDoProduto(produtoSelecionado.sku).length > 1,
      selecionados: Array.from(document.querySelectorAll('#alocacaoLista .aloc-opt.sel')).map((d) => d.getAttribute('data-key'))
    }));

    // ── UM candidato: auto-seleciona, sem atrito nenhum ──────────────────
    await page.evaluate(() => selecionarProduto('SKU-UM'));
    let e = await estado();
    assert.deepEqual(e.candidatos, ['0007__SKU-UM']);
    assert.equal(e.vinculo, '0007__SKU-UM', 'um candidato tem que auto-selecionar');
    assert.equal(e.jaEscolheu, true);
    assert.equal(e.barraEmissao, false, 'não barra com um candidato só');
    assert.doesNotMatch(e.html, /pedidos abertos deste produto/, 'sem aviso de ambiguidade');

    // ── DOIS candidatos: nada pré-selecionado, avisa, e barra a emissão ──
    await page.evaluate(() => selecionarProduto('SKU-DOIS'));
    e = await estado();
    assert.equal(e.candidatos.length, 2, 'a encerrada (PED-0008) não entra como candidata');
    assert.ok(!e.candidatos.includes('PED-0008__SKU-DOIS'), 'statusManual encerrado fica fora');
    assert.equal(e.vinculo, null, 'com dois candidatos NADA vem pré-selecionado');
    assert.equal(e.jaEscolheu, false);
    assert.deepEqual(e.selecionados, [], 'nenhum cartão marcado');
    assert.match(e.html, /2 pedidos abertos deste produto/);
    assert.equal(e.barraEmissao, true, 'a emissão tem que ser barrada enquanto ninguém escolheu');

    // "Emitir sem vincular" NÃO pode aparecer como escolhido só porque nada foi
    // escolhido -- era o risco de um Enter distraído virar OP avulsa.
    const avulsaMarcada = await page.evaluate(() =>
      !!document.querySelector('#alocacaoLista .aloc-opt[data-key=""].sel'));
    assert.equal(avulsaMarcada, false, '"Emitir sem vincular" não vem marcado por omissão');

    // ── (b) a onda do dia aparece, e no candidato certo ──────────────────
    assert.match(e.html, new RegExp('onda ' + prefixo), 'diz qual é a onda de hoje');
    assert.match(e.html, /1 OP de hoje já foi pra este pedido/);
    const ondaNoCartao = await page.evaluate(() => {
      const cartoes = Array.from(document.querySelectorAll('#alocacaoLista .aloc-opt'));
      return cartoes.filter((d) => /OP de hoje já foi/.test(d.innerText)).map((d) => d.getAttribute('data-key'));
    });
    assert.deepEqual(ondaNoCartao, ['30__SKU-DOIS'], 'o aviso da onda fica no pedido 30, não no 0011');

    // emitirOP() com ninguém escolhido não grava OP nenhuma
    await page.evaluate(() => emitirOP());
    assert.deepEqual(await page.evaluate(() => Object.keys(window.__db.ops || {})), [prefixo + '-01'],
      'nenhuma OP nova foi gravada');

    // ── Escolha explícita: cola, e o aviso sai ───────────────────────────
    await page.evaluate(() => selecionarVinculo('0011__SKU-DOIS'));
    e = await estado();
    assert.equal(e.vinculo, '0011__SKU-DOIS');
    assert.equal(e.jaEscolheu, true);
    assert.equal(e.barraEmissao, false);
    assert.deepEqual(e.selecionados, ['0011__SKU-DOIS']);
    assert.doesNotMatch(e.html, /2 pedidos abertos deste produto/, 'aviso sai depois de escolher');
    assert.match(e.html, new RegExp('onda ' + prefixo), 'a onda continua visível (é informação, não alarme)');

    // ── Avulsa DE PROPÓSITO continua possível ────────────────────────────
    await page.evaluate(() => selecionarVinculo(''));
    e = await estado();
    assert.equal(e.vinculo, null);
    assert.equal(e.jaEscolheu, true, 'escolher avulsa conta como escolha');
    assert.equal(e.barraEmissao, false, 'avulsa deliberada não é barrada -- cai no confirm de exceção');
    assert.equal(await page.evaluate(() =>
      !!document.querySelector('#alocacaoLista .aloc-opt[data-key=""].sel')), true, 'avulsa marcada quando escolhida');

    // ── Trocar de produto reseta a escolha ───────────────────────────────
    await page.evaluate(() => selecionarProduto('SKU-DOIS'));
    e = await estado();
    assert.equal(e.jaEscolheu, false, 'trocar de produto limpa a escolha anterior');
    assert.equal(e.vinculo, null);

    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    console.log('OK Emitir OP: um pedido aberto auto-seleciona; dois ou mais não pré-selecionam, avisam, mostram a onda do dia e barram a emissão até escolher.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
