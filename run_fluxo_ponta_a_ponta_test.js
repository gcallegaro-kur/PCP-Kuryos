'use strict';
/* FLUXO PONTA A PONTA — as telas reais, uma passando o bastão para a outra.

   Não é auditoria de dado: é teste de FUNCIONALIDADE e INTEGRAÇÃO. O banco
   vive aqui no Node e é injetado em cada página na ordem do processo. O que
   a tela anterior gravou é o que a próxima recebe -- se o elo não existe,
   o teste para exatamente nele, que é o que interessa descobrir.

       Orçamento → aceite → solicitação de cadastro → Pedido comercial
                 → Emitir OP → Apontamento (alocar, setup, apontar, encerrar)
                 → Conferência de PA → Qualidade (CK-7) → Expedição

   Cada passo afirma o que o PROCESSO exige, não o que o código faz hoje.
   Passo que falha é gap de verdade -- ou do sistema, ou do meu harness, e
   a mensagem diz qual. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const conferenciaPa = require('./functions/conferencia_pa.js');
const Expedicao = require('./public/shared/expedicao.js');

// ── Banco compartilhado, em Node ──────────────────────────────────────
let BANCO = {
  usuarios: {u1: {nome: 'Gustavo', email: 'adm@kuryos.com', role: 'admin'}},
  config: {
    linhas: ['Linha 1', 'Linha 2'], rotulagem: ['Rotulagem 1'], postosTrabalho: ['Bancada 1'],
    planejamento: {diasSemana: [1, 2, 3, 4, 5], feriados: {}},
    tiposEnsaio: ['ASPECTO', 'PH'],
  },
  clientes: {
    MISSROSE: {nome: 'MISS RÔSE', cnpj: '12345678000199', codigo: 'MR', ativo: 'Ativo'},
  },
  produtos: {
    MRARBS04: {sku: 'MRARBS04', descricao: 'BODY SPLASH NÉCTAR DAS TAMARAS', cliente: 'MISS RÔSE',
      clienteKey: 'MISSROSE',
      densidadeGranel: 0.95, prazoValidadeMeses: 36, unCx: 24, kgCaixa: 5.2, volume: 200,
      unidadeVolume: 'ml', overfillPct: 0, perdaProcessoPct: 0, ean13: '7899999000012',
      msAnvisa: 'MS 2.0000.0000'},
  },
  materiais: {
    m1: {mpCodigo: 'MPGR-001', mpNome: 'ÁGUA', tipo: 'MPGR', unidade: 'kg'},
    m2: {mpCodigo: 'EP-00106', mpNome: 'FRASCO 200ML', tipo: 'EP', unidade: 'un'},
  },
  formulas: {
    MRARBS04__v1: {codProduto: 'MRARBS04', versao: 'v1', status: 'APROVADA', somaPercentual: 100,
      itens: {i1: {mpCodigo: 'MPGR-001', mpNome: 'ÁGUA', fase: 'A', ordemAdicao: 1, percentualMM: 100}}},
  },
  bom: {
    MRARBS04__v1: {codProduto: 'MRARBS04', versao: 'v1', status: 'APROVADA',
      itens: {b1: {materialCodigo: 'EP-00106', materialNome: 'FRASCO 200ML', qtdPorPeca: 1, posicao: 1}}},
  },
  especificacoes: {
    MRARBS04__v1: {codProduto: 'MRARBS04', versao: 'v1', status: 'APROVADA',
      itens: {e1: {ensaio: 'ASPECTO', especificacaoTexto: 'LÍQUIDO', metodo: 'PA09', critico: false},
        e2: {ensaio: 'PH', especificacaoTexto: 'N/A', minimo: '5,0', maximo: '7,0', metodo: 'PA01', critico: false}}},
  },
  estoque: {'MPGR-001': {saldoAtual: 5000}, 'EP-00106': {saldoAtual: 50000}},
  pedidos: {}, alocacoes_planejamento: {}, ops: {}, registros: {}, estado_linhas: {},
  estoque_lotes: {},
  enderecos_estoque: {PA_A_01: {codigo: 'PA-A-01', area: 'PA', rua: 1, predio: 1, nivel: 1, ativo: true}},
  nao_conformidades: {}, parametros_pa: {},
  paradas_historico: {}, atividadesPosto: {}, pedidos_comerciais: {}, programacao: {},
  retrabalhos: {}, retrabalhos_linhas: {}, pedidos_compra: {}, fornecedores: {},
  orcamentos: {}, solicitacoes_cadastro_produto: {}, notificacoes_comercial: {},
};

const gaps = [];
function registrar(elo, oQue) { gaps.push({elo, oQue}); console.log('   GAP [' + elo + '] ' + oQue); }

/* Abre uma tela real com o banco atual injetado. Ao fechar, o que a tela
   gravou volta para o Node -- é isso que faz o bastão passar de verdade. */
async function abrirTela(browser, pagina, opcoes) {
  const o = opcoes || {};
  const page = await browser.newPage({viewport: {width: 1500, height: 1000}});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const dialogos = [];
  page.on('dialog', (d) => { dialogos.push(d.message()); d.accept(); });
  page.__dialogos = dialogos;
  await page.addInitScript(({data, role, callables}) => {
    const db = data;
    db.usuarios.u1.role = role;
    window.__db = db;
    window.__chamadas = [];
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    /* `.info/connected` é nó do próprio SDK, não do banco. As telas usam
       ele para RECUSAR gravação offline -- uma trava boa, que sem resposta
       aqui derrubava o teste com "Sem conexão com o servidor". */
    const ler = (p) => {
      if (String(p).replace(/^\//, '') === '.info/connected') return true;
      return partes(p).reduce((x, k) => (x == null ? undefined : x[k]), db);
    };
    const gravar = (p, v) => {
      const ks = partes(p); let x = db;
      ks.slice(0, -1).forEach((k) => { if (x[k] == null || typeof x[k] !== 'object') x[k] = {}; x = x[k]; });
      if (v === null || v === undefined) delete x[ks[ks.length - 1]]; else x[ks[ks.length - 1]] = structuredClone(v);
    };
    let seq = 0;
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); },
      auth() {
        return {currentUser: {uid: 'u1', email: 'adm@kuryos.com'},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'adm@kuryos.com', displayName: 'Gustavo'}), 0); },
          signOut() { return Promise.resolve(); }};
      },
      functions() {
        return {httpsCallable(nome) {
          return (payload) => {
            window.__chamadas.push({nome, payload});
            if (callables.indexOf(nome) < 0) return Promise.resolve({data: {ok: true}});
            // Callable coberto pelo servidor real: o Node resolve e devolve.
            return window.__servidor(nome, structuredClone(payload), structuredClone(db))
              .then((r) => {
                if (r.erro) return Promise.reject(new Error(r.erro));
                Object.keys(r.base).forEach((k) => { db[k] = r.base[k]; });
                return {data: r.data || {ok: true}};
              });
          };
        }};
      },
      /* Telas com anexo chamam firebase.storage() na carga. Sem este stub
         o harness acusaria erro de JS numa tela que funciona na fabrica. */
      storage() {
        return {ref(p) { return {put() { return Promise.resolve({ref: {getDownloadURL: () => Promise.resolve('https://arquivo.test/' + p)}}); },
          getDownloadURL() { return Promise.resolve('https://arquivo.test/' + p); }, delete() { return Promise.resolve(); },
          child(c) { return this.ref(p + '/' + c); }}; }};
      },
      database() {
        const ref = (p) => {
          const valor = () => { const v = ler(p); return v === undefined ? null : structuredClone(v); };
          const snap = () => { const v = valor(); return {val: () => v, exists: () => v !== null, key: partes(p).pop(),
            forEach(cb) { Object.entries(v || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
          return {path: p, key: partes(p).pop(),
            once(ev, cb) { const sn = snap(); if (cb) cb(sn); return Promise.resolve(sn); },
            on(ev, cb) { setTimeout(() => cb(snap()), 0); return cb; },
            off() {}, child(c) { return ref(p + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; },
            equalTo() { return this; }, limitToLast() { return this; }, startAt() { return this; },
            push(v) {
              seq++;
              const filho = ref(p + '/-F' + seq);
              if (v === undefined) return filho;
              gravar(filho.path, v);
              const pr = Promise.resolve(filho); pr.key = filho.key; return pr;
            },
            set(v) { gravar(p, v); return Promise.resolve(); },
            update(obj) { Object.entries(obj).forEach(([k, v]) => gravar(p + '/' + k, v)); return Promise.resolve(); },
            remove() { gravar(p, null); return Promise.resolve(); },
            transaction(fn) { const r = fn(valor()); if (r !== undefined) gravar(p, r);
              return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        };
        return {ref: (x) => ref(x || '')};
      },
    };
  }, {data: BANCO, role: o.papel || 'admin', callables: o.callables || []});

  // Servidor real para os callables que o fluxo usa.
  await page.exposeFunction('__servidor', async (nome, payload, base) => {
    try {
      if (nome === 'finalizarConferenciaPA') {
        /* O modulo exporta `prepararFinalizacao`, que e PURA: recebe o
           contexto e devolve o mapa plano de updates, sem tocar no banco --
           quem grava e a Cloud Function. Aqui o Node faz o papel dela,
           montando o mesmo contexto que functions/index.js monta e aplicando
           os updates com caminhos planos (nunca objeto aninhado: no RTDB
           isso apagaria campos irmaos). */
        const opKey = String(payload.opKey || '');
        const op = (base.ops || {})[opKey];
        const itemKey = conferenciaPa.sanitizeKey(op && op.sku);
        const {updates} = conferenciaPa.prepararFinalizacao({
          opKey, op, conf: (base.conferencias_pa || {})[opKey],
          enderecos: base.enderecos_estoque || {},
          lotesItem: (base.estoque_lotes || {})[itemKey] || {},
          autor: 'Gustavo', conciliacao: payload.conciliacao || null,
          agora: new Date().toISOString(),
        });
        Object.entries(updates).forEach(([caminho, valor]) => {
          const ks = caminho.split('/').filter(Boolean);
          let x = base;
          ks.slice(0, -1).forEach((k) => { if (x[k] == null || typeof x[k] !== 'object') x[k] = {}; x = x[k]; });
          if (valor === null) delete x[ks[ks.length - 1]]; else x[ks[ks.length - 1]] = valor;
        });
        return {base, data: {ok: true}};
      }
    } catch (e) { return {erro: e.message}; }
    return {base};
  });

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'fluxo.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://fluxo.test/' + pagina);
  await page.waitForFunction(() => window.currentUser && window.currentUser.role);
  return {page, errors, dialogos};
}

/* O `on` do Firebase simulado entrega o snapshot UMA vez -- não é listener
   de verdade. Em produção a tela redesenha sozinha a cada gravação; aqui a
   gente entrega o snapshot novo à mão, que é exatamente o que o listener
   real faria. Sem isto o teste acusaria "botão não apareceu" para algo que
   na fábrica aparece. */
async function atualizarPainel(page) {
  await page.evaluate(() => {
    if (typeof opsCache !== 'undefined') opsCache = window.__db.ops || {};
    if (typeof latestAndonStates !== 'undefined') latestAndonStates = window.__db.estado_linhas || {};
    if (typeof atividadesPostoCache !== 'undefined') atividadesPostoCache = window.__db.atividadesPosto || {};
    if (typeof renderPainelTurno === 'function') renderPainelTurno();
  });
}

/* Mesmo caso do painel de turno: o `on` entrega o snapshot uma vez so. Em
   producao a lista do comercial se redesenha a cada gravacao. */
async function atualizarComercial(page) {
  await page.evaluate(() => {
    if (typeof orcamentos !== 'undefined') orcamentos = window.__db.orcamentos || {};
    if (typeof pedidos !== 'undefined') pedidos = window.__db.pedidos_comerciais || {};
    if (typeof renderLists === 'function') renderLists();
  });
}

async function fechar(page, errors, etapa) {
  BANCO = await page.evaluate(() => window.__db);   // o bastão volta para o Node
  const graves = (errors || []).filter((e) => !/ResizeObserver|Failed to fetch/.test(e));
  if (graves.length) registrar(etapa, 'erro de JavaScript na tela: ' + graves[0]);
  await page.close();
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // == 0. COMERCIAL =================================================
    /* O inicio real da cadeia. O orcamento leva DOIS itens de proposito: um
       produto que ja existe e um que nao existe. So o segundo pode virar
       solicitacao de cadastro -- se os dois virarem, o comercial abre tarefa
       para cadastrar o que ja esta cadastrado. */
    console.log('\n0a. Orcamento -> envio -> aceite');
    let page, errors, dialogos;
    ({page, errors} = await abrirTela(browser, 'comercial.html'));
    await page.locator('[data-tab="orc"]').click();
    await page.waitForSelector('#view-orc', {state: 'visible', timeout: 6000});
    await page.selectOption('#oClienteKey', 'MISSROSE').catch(() => {});
    await page.fill('#oCliente', 'MISS ROSE');
    await page.fill('#oValidade', '2026-10-31');
    await page.fill('.od[data-i="0"]', 'BODY SPLASH NECTAR DAS TAMARAS');
    await page.fill('.oq[data-i="0"]', '1000');
    await page.fill('.ov[data-i="0"]', '10');
    await page.click('#addO');
    await page.waitForSelector('.od[data-i="1"]', {timeout: 6000});
    await page.fill('.od[data-i="1"]', 'BODY SPLASH MANGA ROSA');
    await page.fill('.oq[data-i="1"]', '500');
    await page.fill('.ov[data-i="1"]', '12');
    await page.click('#saveO');
    await page.waitForFunction(() => Object.keys(window.__db.orcamentos || {}).length > 0, null, {timeout: 8000});

    let db = await page.evaluate(() => window.__db);
    const orcKey = Object.keys(db.orcamentos)[0];
    console.log('   orcamento ' + orcKey + ' com ' + db.orcamentos[orcKey].itens.length + ' itens');
    assert.equal(db.orcamentos[orcKey].status, 'EM_ELABORACAO');

    await atualizarComercial(page);
    await page.locator('[data-k="' + orcKey + '"][data-a="send"]').click();
    await page.waitForFunction((k) => (window.__db.orcamentos[k] || {}).status === 'ENVIADO', orcKey, {timeout: 8000});
    await atualizarComercial(page);
    await page.locator('[data-k="' + orcKey + '"][data-a="accept"]').click();
    await page.waitForFunction((k) => (window.__db.orcamentos[k] || {}).status === 'ACEITO', orcKey, {timeout: 8000});
    console.log('   aceite registrado');

    db = await page.evaluate(() => window.__db);
    const solicitacoes = Object.entries(db.solicitacoes_cadastro_produto || {});
    if (solicitacoes.length !== 1) {
      registrar('Orcamento -> Cadastro',
        'o aceite abriu ' + solicitacoes.length + ' solicitacoes de cadastro para 1 item novo ' +
        '(o outro item ja estava cadastrado e nao deveria gerar tarefa)');
    } else {
      assert.equal(solicitacoes[0][1].item.descricao, 'BODY SPLASH MANGA ROSA');
      assert.equal(solicitacoes[0][1].status, 'PENDENTE_CADASTRO');
      console.log('   solicitacao de cadastro aberta para o item novo');
    }
    await fechar(page, errors, 'Orcamento');

    // == 0b. A SOLICITACAO CHEGA A QUEM CADASTRA? =======================
    /* O aceite avisa "foram enviados para cadastro". Este passo pergunta o
       obvio: quem cadastra produto ve essa tarefa na tela dele? */
    console.log('\n0b. A tarefa de cadastro chega ao cadastro');
    ({page, errors} = await abrirTela(browser, 'cadastros.html'));
    await page.locator('[data-maintab="produtos"], [data-tab="produtos"]').first().click().catch(() => {});
    const temTarefa = await page.locator('.btn-cadastrar-solic').count();
    if (!temTarefa) {
      registrar('Orcamento -> Cadastro',
        'a solicitacao de cadastro nao aparece em cadastros.html -- quem cadastra o produto ' +
        'nunca fica sabendo da tarefa aberta pelo aceite do orcamento');
    } else {
      /* O elo so esta fechado se a tarefa (a) abrir o cadastro ja preenchido
         e (b) SUMIR quando o produto existir. Tarefa que fica PENDENTE com o
         produto ja cadastrado e o estado que faz o vendedor cobrar de novo. */
      await page.locator('.btn-cadastrar-solic').first().click();
      await page.waitForSelector('#fDescricao-prod', {state: 'visible', timeout: 6000});
      assert.equal(await page.inputValue('#fDescricao-prod'), 'BODY SPLASH MANGA ROSA',
        'o cadastro precisa abrir ja com a descricao que o Comercial informou');
      assert.equal(await page.inputValue('#fCliente-prod'), 'MISS ROSE');
      await page.fill('#fSku-prod', 'MRARBS09');
      await page.click('#modalSaveBtn-prod');
      await page.waitForFunction(() => (window.__db.produtos || {}).MRARBS09, null, {timeout: 8000});
      console.log('   produto cadastrado a partir da tarefa');
      await page.waitForFunction(() => Object.values(window.__db.solicitacoes_cadastro_produto || {})
        .every((s) => s.status !== 'PENDENTE_CADASTRO'), null, {timeout: 8000})
        .catch(() => registrar('Cadastro -> Comercial',
          'o produto foi cadastrado mas a solicitacao continua PENDENTE_CADASTRO: a aba ' +
          '"Cadastros pendentes" do Comercial seguiria cobrando um cadastro que ja existe'));
      const dbc = await page.evaluate(() => window.__db);
      const fechada = Object.values(dbc.solicitacoes_cadastro_produto || {})[0] || {};
      if (fechada.status === 'CADASTRADO') {
        assert.equal(fechada.produtoKey, 'MRARBS09', 'a tarefa precisa apontar para o produto criado');
        console.log('   tarefa fechada e vinculada a ' + fechada.produtoKey);
      }
    }
    await fechar(page, errors, 'Cadastro');

    // == 0c. PEDIDO COMERCIAL -> DEMANDA NO PCP =========================
    console.log('\n0c. Pedido comercial -> backlog do PCP');
    ({page, errors} = await abrirTela(browser, 'comercial.html'));
    await page.waitForSelector('#view-ped', {state: 'visible', timeout: 6000});
    await page.selectOption('#pCliente', 'MISSROSE');
    await page.fill('#pData', '2026-09-22');
    await page.fill('#pPrevisao', '2026-11-15');
    await page.waitForSelector('.pp[data-i="0"]', {timeout: 6000});
    await page.selectOption('.pp[data-i="0"]', 'MRARBS04');
    await page.fill('.pq[data-i="0"]', '1000');
    await page.fill('.pv[data-i="0"]', '10');
    await page.click('#saveP');
    await page.waitForFunction(() => Object.keys(window.__db.pedidos || {}).length > 0, null, {timeout: 8000});

    db = await page.evaluate(() => window.__db);
    const pedComKey = Object.keys(db.pedidos_comerciais)[0];
    const linhaPcpKey = Object.keys(db.pedidos)[0];
    const linhaPcp = db.pedidos[linhaPcpKey];
    console.log('   ' + pedComKey + ' gerou a demanda ' + linhaPcpKey + ' de ' + linhaPcp.qtdTotal + ' un.');
    assert.equal(db.pedidos_comerciais[pedComKey].status, 'LIBERADO_PCP');
    assert.equal(linhaPcp.sku, 'MRARBS04', 'a linha de demanda precisa carregar o SKU');
    assert.equal(linhaPcp.qtdTotal, 1000);
    assert.equal(linhaPcp.produzido, 0);
    /* A promessa de entrega que o vendedor digitou precisa DESCER para
       pedidos/{}: e o no que planejamento e MRP leem. Antes ela ficava so
       no pedido-pai e a demanda nascia sem data nenhuma. */
    if (linhaPcp.dataEntrega !== '2026-11-15') {
      registrar('Pedido -> PCP',
        'a previsao de entrega informada no pedido nao chegou a linha de demanda do PCP ' +
        '(dataEntrega = ' + JSON.stringify(linhaPcp.dataEntrega) + ')');
    } else {
      console.log('   previsao de entrega 2026-11-15 chegou a demanda do PCP');
    }
    await fechar(page, errors, 'Pedido comercial');

    // == 1. EMITIR OP ═══════════════════════════════════════════════════
    console.log('\n1. Emitir OP');
    ({page, errors} = await abrirTela(browser, 'emitir_op.html'));
    await page.fill('#fProdutoBusca', 'MRARBS04');
    await page.waitForSelector('#produtoResultados [data-produto], #produtoResultados div', {timeout: 6000});
    await page.locator('#produtoResultados').getByText('MRARBS04', {exact: false}).first().click();
    await page.waitForSelector('#cardDimensionamento', {state: 'visible', timeout: 6000});

    await page.check('input[name=modoQtd][value=pecas]');
    await page.fill('#fPecasDesejadas', '1000');
    await page.locator('#fPecasDesejadas').dispatchEvent('change');
    await page.waitForSelector('#cardEmissao', {state: 'visible', timeout: 6000});
    await page.click('#btnEmitir');
    await page.waitForFunction(() => Object.keys(window.__db.ops || {}).length > 0, null, {timeout: 8000});

    db = await page.evaluate(() => window.__db);
    const opKey = Object.keys(db.ops)[0];
    const op = db.ops[opKey];
    console.log('   OP emitida: ' + op.lote + ' · ' + op.qtdPlanejada + ' un.');
    assert.ok(op.materiaisConsumo, 'a OP precisa nascer com os materiais do BOM/fórmula');
    assert.equal(op.sku, 'MRARBS04');
    if (!op.dataInicioPlanejada) {
      registrar('Emissão → Planejamento',
        'OP nasce SEM data planejada quando não há bloco programado. Sem data ela não entra no horizonte nem em promessa de prazo.');
    }
    await fechar(page, errors, 'Emitir OP');

    // ══ 2. APONTAMENTO ═════════════════════════════════════════════════
    console.log('\n2. Apontamento (alocar → setup → apontar → encerrar)');
    ({page, errors, dialogos} = await abrirTela(browser, 'form.html'));
    await page.waitForSelector('#turnoGridLinhas', {timeout: 8000});
    assert.ok(await page.locator('[data-alocar-nome]').count(), 'nenhuma linha oferece "+ Alocar OP"');

    // 2a. O portão do granel deixa passar OP que nunca começou manipulação.
    await page.locator('[data-alocar-nome="Linha 1"]').click();
    await page.waitForSelector('#alocarOpModal.open', {timeout: 6000});
    const listaAloc = await page.locator('#alocarOpLista').innerText();
    if (listaAloc.indexOf(op.lote) >= 0) {
      registrar('Manipulação → Envase',
        'OP recém-emitida, que nunca iniciou manipulação, pode ser alocada direto para envase: o portão do ' +
        'granel só barra OP que JÁ começou a fase. É a causa raiz das OPs envasadas sem análise de granel.');
    }
    await page.locator('.alocar-op-card').first().click();
    await page.click('#btnConfirmarAlocarOp');
    await page.waitForFunction((lote) => {
      const o = Object.values(window.__db.ops || {}).find((x) => x.lote === lote);
      return o && o.abertaLinha;
    }, op.lote, {timeout: 8000});
    console.log('   alocada na Linha 1');
    await atualizarPainel(page);

    // 2b. Fim de setup → envase
    await page.waitForSelector('[data-fim-setup]', {timeout: 6000});
    await page.locator('[data-fim-setup]').first().click();
    await page.waitForFunction((lote) => {
      const o = Object.values(window.__db.ops || {}).find((x) => x.lote === lote);
      return o && o.setupFim;
    }, op.lote, {timeout: 8000});
    console.log('   setup encerrado');
    await atualizarPainel(page);

    // 2c. Encerrar a OP com quantidade produzida
    await page.waitForSelector('[data-encerrar-op]', {timeout: 6000});
    await page.locator('[data-encerrar-op]').first().click();
    await page.waitForSelector('#encerrarOpTurnoModal.open', {timeout: 6000});
    await page.fill('#encerrarOpTurnoQtd', '960');
    await page.locator('#encerrarOpTurnoQtd').dispatchEvent('input');
    await page.fill('#encerrarOpTurnoOperador', 'João');
    /* 960 de 1000 planejadas é desvio, e a tela EXIGE justificativa -- é a
       trava da Fase 7 do plano contra perda silenciosa (OP fechando com
       menos do que o planejado sem ninguém explicar). Controle funcionando:
       o teste obedece em vez de contornar. */
    await page.evaluate(() => {
      const el = document.getElementById('encerrarOpTurnoJustificativa');
      el.value = 'Perda de processo no envase, 40 un.';
      el.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await page.click('#btnConfirmarEncerrarOpTurno');
    await page.waitForTimeout(800);
    if (dialogos.length) console.log('   AVISOS da tela: ' + dialogos.join(' | '));
    await page.waitForFunction((lote) => {
      const o = Object.values(window.__db.ops || {}).find((x) => x.lote === lote);
      return o && (o.produzidoLinha || 0) > 0;
    }, op.lote, {timeout: 10000});

    db = await page.evaluate(() => window.__db);
    const opDepois = db.ops[opKey];
    console.log('   encerrada: ' + opDepois.produzidoLinha + ' un., status ' + opDepois.status);
    assert.equal(opDepois.produzidoLinha, 960, 'a produção precisa ficar gravada na OP');
    // O pedido deveria ser creditado -- esta OP saiu sem vínculo porque não
    // havia pedido na base do teste; só registra se o vínculo existia.
    await fechar(page, errors, 'Apontamento');

    // ══ 3. CONFERÊNCIA DE PA — o portão do PCP ═════════════════════════
    console.log('\n3. Conferência de PA');
    ({page, errors} = await abrirTela(browser, 'estoque.html', {callables: ['finalizarConferenciaPA']}));
    await page.locator('[data-tab="conferenciapa"]').click();
    await page.waitForSelector('#tab-conferenciapa', {state: 'visible', timeout: 6000});
    let filaTexto = await page.locator('#tab-conferenciapa').innerText();
    if (filaTexto.indexOf(op.lote) < 0) {
      registrar('Envase → Conferência de PA',
        'a OP encerrada NÃO aparece na fila de conferência — o produto envasado não é cobrado de ninguém');
    } else {
      console.log('   OP na fila de conferência');
      const bloqueado = await page.locator('#tab-conferenciapa button[disabled]').count();
      if (!bloqueado) {
        registrar('Conferência de PA',
          'a conferência abre ANTES de o PCP confirmar a conclusão — entrada de estoque sobre número não confirmado');
      } else {
        console.log('   entrada bloqueada aguardando confirmação do PCP (correto)');
      }
    }
    await fechar(page, errors, 'Conferência de PA');

    // ══ 4. PCP CONFIRMA A CONCLUSÃO ════════════════════════════════════
    console.log('\n4. PCP confirma a conclusão (Controle de OPs)');
    ({page, errors} = await abrirTela(browser, 'ops.html'));
    // Na visão padrão ("Ativas") existe o grupo "Aguardando Confirmação do PCP".
    await page.waitForSelector('[onclick^="confirmarConclusaoOp"]', {timeout: 8000});
    console.log('   botão de confirmar visível na visão padrão');

    /* Mas o PCP que FILTRA por "Aguardando Confirmação" -- o caminho natural
       para achar exatamente essas OPs -- some com o botão? */
    for (const filtro of ['Aguardando Confirmação', 'todos']) {
      await page.selectOption('#opsFiltroStatus', filtro);
      await page.waitForTimeout(400);
      const visivel = await page.locator('[onclick^="confirmarConclusaoOp"]').count();
      if (!visivel) {
        registrar('Confirmação do PCP',
          'ao filtrar o Controle de OPs por "' + filtro + '", o botão "Confirmar conclusão" DESAPARECE. ' +
          'Quem procura essas OPs pelo filtro não acha como confirmá-las — e a conferência de PA fica travada atrás disso.');
      }
    }
    await page.selectOption('#opsFiltroStatus', 'ativas');
    await page.waitForSelector('[onclick^="confirmarConclusaoOp"]', {timeout: 6000});
    await page.locator('[onclick^="confirmarConclusaoOp"]').first().click();
    await page.waitForFunction((lote) => {
      const o = Object.values(window.__db.ops || {}).find((x) => x.lote === lote);
      return o && o.status === 'Concluído';
    }, op.lote, {timeout: 8000});
    console.log('   OP confirmada: Concluído');
    await fechar(page, errors, 'Confirmação do PCP');

    // == 5-6. CONFERENCIA LIBERADA -> PALETES -> ENTRADA NO WMS =========
    /* O fim util da cadeia produtiva: a quantidade contada fisicamente vira
       palete endereçado em quarentena, que e o que a Qualidade libera e a
       Expedicao enxerga. Se parar aqui, a OP esta 'concluida' e o produto
       nao existe em lugar nenhum do estoque. */
    console.log('\n5. Conferencia de PA liberada -> registro dos paletes');
    ({page, errors} = await abrirTela(browser, 'estoque.html', {callables: ['finalizarConferenciaPA']}));
    await page.locator('[data-tab="conferenciapa"]').click();
    await page.waitForSelector('#tab-conferenciapa', {state: 'visible', timeout: 6000});
    const acoes = await page.locator('[data-cpa-op]').count();
    if (!acoes) {
      registrar('Confirmacao do PCP -> Conferencia',
        'mesmo depois de o PCP confirmar, a conferencia continua sem botao de acao');
      await fechar(page, errors, 'Conferencia liberada');
    } else {
      console.log('   liberada: botao "' + (await page.locator('[data-cpa-op]').first().innerText()) + '"');
      await page.locator('[data-cpa-op]').first().click();
      await page.waitForSelector('#cpaAdicionar', {timeout: 6000});
      /* A tela ja abre com um palete. Clicar em '+ Adicionar palete' aqui
         criava uma segunda linha vazia e a validacao -- corretamente --
         recusava a contagem inteira. */
      await page.waitForSelector('.cpa-palete', {timeout: 6000});
      assert.equal(await page.locator('.cpa-palete').count(), 1, 'o modal abre com exatamente um palete');
      /* 960 un. em caixas de 24 = 40 caixas exatas. Contagem que bate com o
         apontamento fecha em UMA etapa (analisarTriplaConferenciaPA); divergir
         aqui exigiria recontagem, que e outro teste. */
      await page.fill('.cpa-palete .cpa-caixas', '40');
      await page.fill('.cpa-palete .cpa-multiplo', '24');
      await page.fill('.cpa-palete .cpa-parcial', '0');
      /* O endereço vem do seletor do WMS, que é um modal com grade de ruas e
         níveis -- e tem testes próprios. Aqui uso a API pública do módulo, a
         MESMA que o seletor chama ao escolher, em vez de forjar o input: o que
         este teste precisa provar é o elo conferência→estoque, não a grade. */
      await page.evaluate(() => {
        const input = document.querySelector('.cpa-palete .cpa-endereco');
        SeletorEndereco.atualizarCampo(input, 'PA_A_01', window.__db.enderecos_estoque);
      });
      await page.click('#cpaSalvar');
      await page.waitForFunction(() => {
        const l = (window.__db.estoque_lotes || {}).MRARBS04 || {};
        return Object.keys(l).length > 0;
      }, null, {timeout: 10000}).catch(() => {});

      const dbf = await page.evaluate(() => window.__db);
      const lotes = Object.values((dbf.estoque_lotes || {}).MRARBS04 || {});
      if (!lotes.length) {
        const conf = Object.values(dbf.conferencias_pa || {})[0] || {};
        registrar('Conferencia -> Estoque',
          'a contagem foi registrada mas nenhum palete entrou em estoque_lotes ' +
          '(status da conferencia: ' + (conf.status || 'ausente') + ')');
      } else {
        console.log('   ' + lotes.length + ' palete(s) no WMS, ' + lotes[0].saldoLote + ' un., endereco ' + lotes[0].enderecoCodigo);
        assert.equal(lotes[0].status, 'QUARENTENA', 'PA recem-conferido tem que nascer bloqueado para a Qualidade');
        assert.equal(lotes[0].opKey && true, true);
        /* O credito ao pedido comercial e o que fecha o ciclo com o cliente. */
        if (!lotes[0].skuPedidoKey) {
          registrar('Conferencia -> Pedido',
            'o palete entrou no estoque sem skuPedidoKey: o produto existe fisicamente mas nao ' +
            'esta amarrado ao pedido que o gerou, e a Expedicao nao consegue abater a entrega');
        }
      }
      await fechar(page, errors, 'Registro de paletes');
    }

    // == 7. QUALIDADE: o palete em quarentena chega na fila do CQ =======
    /* O palete nasceu QUARENTENA. Se ele nao aparecer na fila do CQ, fica
       parado no galpao sem ninguem saber que ha o que liberar -- e o pedido
       nunca e entregue mesmo com o produto pronto e endereçado. */
    console.log('\n7. Qualidade: o palete em quarentena entra na fila');
    ({page, errors} = await abrirTela(browser, 'qualidade.html', {papel: 'qualidade'}));
    await page.waitForSelector('#qFilaBody', {timeout: 8000});
    const naFila = await page.evaluate(() => {
      const txt = document.getElementById('qFilaBody').innerText || '';
      return txt.indexOf('MRARBS04') >= 0;
    });
    if (!naFila) {
      registrar('Conferencia -> Qualidade',
        'o palete de PA entrou no estoque em QUARENTENA mas nao aparece na fila da Qualidade: ' +
        'ninguem fica sabendo que ha lote esperando liberacao, e o pedido nao e entregue ' +
        'mesmo com o produto pronto e enderecado');
    } else {
      console.log('   palete na fila do CQ aguardando laudo');
    }
    await fechar(page, errors, 'Qualidade');

    // == 8. EXPEDICAO: a trava tem que SEGURAR =========================
    /* Teste negativo de proposito. O perigo aqui nao e a Expedicao nao ver o
       palete: e ver cedo demais e despachar produto sem laudo. A regra real
       (shared/expedicao.js, a mesma que a tela usa) roda contra o estado que
       a cadeia inteira produziu, e tem que recusar -- pelo motivo certo. */
    console.log('\n8. Expedicao: produto sem laudo nao pode sair');
    const linhas = Expedicao.listar(BANCO, new Date().toISOString().slice(0, 10));
    const linha = linhas.find((l) => l.lote.itemCodigo === 'MRARBS04');
    if (!linha) {
      registrar('Estoque -> Expedicao',
        'o palete conferido nao aparece nem como indisponivel na Expedicao: nao da para saber ' +
        'que ele existe nem por que nao pode sair');
    } else if (linha.disponivel) {
      registrar('Qualidade -> Expedicao',
        'a Expedicao liberou um palete que a Qualidade ainda nao avaliou (status ' +
        linha.lote.status + '): produto sem laudo poderia ser despachado');
    } else {
      assert.equal(linha.motivo, 'Aguardando liberacao da Qualidade'.replace('liberacao', 'libera\u00e7\u00e3o'),
        'a trava precisa ser a da Qualidade, nao outra falha que esconda o motivo real');
      console.log('   bloqueado corretamente: "' + linha.motivo + '"');
      /* Tudo o que vem ANTES da Qualidade ja tem que estar em ordem -- senao
         o laudo vai liberar e a Expedicao vai recusar pelo motivo seguinte. */
      assert.equal(linha.lote.skuPedidoKey && true, true, 'o palete precisa estar amarrado ao pedido');
      assert.equal(linha.op.status, 'Conclu\u00eddo');
      assert.ok(linha.comercial, 'o pedido comercial precisa ser alcancavel a partir do palete');
    }
    console.log('\n──────── RESUMO ────────');
    if (!gaps.length) console.log('Nenhum gap encontrado nos elos percorridos.');
    gaps.forEach((g) => console.log('· [' + g.elo + '] ' + g.oQue));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('\nPAROU AQUI: ' + e.message); process.exit(1); });
