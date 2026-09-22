'use strict';
/* FLUXO PONTA A PONTA — as telas reais, uma passando o bastão para a outra.

   Não é auditoria de dado: é teste de FUNCIONALIDADE e INTEGRAÇÃO. O banco
   vive aqui no Node e é injetado em cada página na ordem do processo. O que
   a tela anterior gravou é o que a próxima recebe -- se o elo não existe,
   o teste para exatamente nele, que é o que interessa descobrir.

       Emitir OP → Apontamento (alocar, setup, apontar, encerrar)
                 → Conferência de PA → Qualidade (CK-7) → Expedição

   Cada passo afirma o que o PROCESSO exige, não o que o código faz hoje.
   Passo que falha é gap de verdade -- ou do sistema, ou do meu harness, e
   a mensagem diz qual. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const conferenciaPa = require('./functions/conferencia_pa.js');

// ── Banco compartilhado, em Node ──────────────────────────────────────
let BANCO = {
  usuarios: {u1: {nome: 'Gustavo', email: 'adm@kuryos.com', role: 'admin'}},
  config: {
    linhas: ['Linha 1', 'Linha 2'], rotulagem: ['Rotulagem 1'], postosTrabalho: ['Bancada 1'],
    planejamento: {diasSemana: [1, 2, 3, 4, 5], feriados: {}},
    tiposEnsaio: ['ASPECTO', 'PH'],
  },
  produtos: {
    MRARBS04: {sku: 'MRARBS04', descricao: 'BODY SPLASH NÉCTAR DAS TAMARAS', cliente: 'MISS RÔSE',
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
  estoque_lotes: {}, enderecos_estoque: {}, nao_conformidades: {}, parametros_pa: {},
  paradas_historico: {}, atividadesPosto: {}, pedidos_comerciais: {}, programacao: {},
  retrabalhos: {}, retrabalhos_linhas: {}, pedidos_compra: {}, fornecedores: {},
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
        const r = conferenciaPa.finalizar(base, payload, 'u1', new Date().toISOString());
        return {base, data: r};
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

async function fechar(page, errors, etapa) {
  BANCO = await page.evaluate(() => window.__db);   // o bastão volta para o Node
  const graves = (errors || []).filter((e) => !/ResizeObserver|Failed to fetch/.test(e));
  if (graves.length) registrar(etapa, 'erro de JavaScript na tela: ' + graves[0]);
  await page.close();
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // ══ 1. EMITIR OP ═══════════════════════════════════════════════════
    console.log('\n1. Emitir OP');
    let {page, errors} = await abrirTela(browser, 'emitir_op.html');
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

    let db = await page.evaluate(() => window.__db);
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
    let dialogos;
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

    // ══ 5. CONFERÊNCIA LIBERADA ════════════════════════════════════════
    console.log('\n5. Conferência de PA liberada');
    ({page, errors} = await abrirTela(browser, 'estoque.html', {callables: ['finalizarConferenciaPA']}));
    await page.locator('[data-tab="conferenciapa"]').click();
    await page.waitForSelector('#tab-conferenciapa', {state: 'visible', timeout: 6000});
    const acoes = await page.locator('[data-cpa-op]').count();
    if (!acoes) {
      registrar('Confirmação do PCP → Conferência',
        'mesmo depois de o PCP confirmar, a conferência continua sem botão de ação');
    } else {
      console.log('   liberada: botão "' + (await page.locator('[data-cpa-op]').first().innerText()) + '"');
    }
    await fechar(page, errors, 'Conferência liberada');

    console.log('\n──────── RESUMO ────────');
    if (!gaps.length) console.log('Nenhum gap encontrado nos elos percorridos.');
    gaps.forEach((g) => console.log('· [' + g.elo + '] ' + g.oQue));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('\nPAROU AQUI: ' + e.message); process.exit(1); });
