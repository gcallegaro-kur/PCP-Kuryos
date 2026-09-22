'use strict';
/* Tela de Retrabalhos: dá para acompanhar e dá para avaliar.

   O usuário disse da primeira versão: *"não ficou legal, não deu pra
   acompanhar bem"* (22/09). O que este teste garante é exatamente o que
   faltava:
   - a tela DIZ o que está travando (antes o botão sumia calado);
   - a quantidade pendente é conferida aqui, onde a pendência aparece;
   - o caso é AVALIADO e fecha, em vez de morrer em "aguardando Qualidade";
   - quem executa não vê o formulário de decisão.

   Tela real com utils.js, retrabalhos-gestao.js e auth_check.js reais;
   Firebase e o callable simulados, para conferir o que seria enviado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const PENDENTE = {
  inicio: '2026-09-21T19:00:00.000Z', fim: '2026-09-21T20:09:00.000Z',
  linha: 'Linha 2', etapa: 'envase', quantidadePendente: true,
};
const CONFERIDO = {
  inicio: '2026-09-21T19:00:00.000Z', fim: '2026-09-21T20:09:00.000Z',
  linha: 'Linha 2', etapa: 'envase', quantidade: 400, operador: 'João',
};

function dados(rt) {
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'adm@kuryos.com', role: 'admin'}},
    config: {linhas: ['Linha 1', 'Linha 2']},
    retrabalhos: {
      RT1: Object.assign({
        id: 'RT1', loteOriginal: '26216/04', produto: 'PERFUME TAWUS 30ML', cliente: 'DAPOP',
        linha: 'Linha 2', escopo: 'Lote inteiro',
        motivo: 'Sedimentação inesperada do corante, formando precipitado.',
        quantidadeOriginalRegistrada: 867, status: 'pausado', revisao: 3,
        criadoEm: '2026-09-22T01:00:00.000Z', atualizadoEm: '2026-09-22T01:00:00.000Z',
        setupInicio: '2026-09-21T18:42:00.000Z', setupFim: '2026-09-21T19:00:00.000Z',
        envaseInicio: '2026-09-21T19:00:00.000Z',
        apontamentos: {a1: PENDENTE},
      }, rt || {}),
      RT2: {
        id: 'RT2', loteOriginal: '26100/01', produto: 'BODY SPLASH ANTIGO', cliente: 'MISS RÔSE',
        linha: 'Linha 1', escopo: 'Parcial', motivo: 'Rótulo torto', status: 'liberado',
        revisao: 5, criadoEm: '2026-09-01T10:00:00.000Z', atualizadoEm: '2026-09-02T10:00:00.000Z',
        apontamentos: {b1: {inicio: '2026-09-01T12:00:00.000Z', fim: '2026-09-01T13:00:00.000Z', quantidade: 120}},
        decisoes: {d1: {decisao: 'liberado', analise: 'Rotulagem refeita e conferida',
          responsavel: 'Daiene', em: '2026-09-02T10:00:00.000Z'}},
      },
    },
  };
}

async function abrir(browser, base, papel) {
  const page = await browser.newPage({viewport: {width: 1400, height: 1100}});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(({data, role}) => {
    const db = data;
    db.usuarios.u1.role = role;
    window.__db = db;
    window.__chamadas = [];
    window.__iniciado = false;
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() {
        return {currentUser: {uid: 'u1', email: 'adm@kuryos.com'},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'adm@kuryos.com', displayName: 'Gustavo'}), 0); },
          signOut() { return Promise.resolve(); }};
      },
      // O callable só registra o que seria enviado: a regra de negócio dele
      // é coberta por run_retrabalhos_decisao_test.js, contra o código real.
      functions() {
        return {httpsCallable(nome) {
          return (payload) => { window.__chamadas.push({nome, payload}); return Promise.resolve({data: {}}); };
        }};
      },
      database() {
        const ref = (path) => {
          const valor = () => { const v = ler(path); return v === undefined ? null : structuredClone(v); };
          const snap = () => { const v = valor(); return {val: () => v, exists: () => v !== null, key: partes(path).pop()}; };
          return {path, key: partes(path).pop(),
            once(ev, cb) { const sn = snap(); if (cb) cb(sn); return Promise.resolve(sn); },
            on(ev, cb) { setTimeout(() => cb(snap()), 0); return cb; },
            off() {}, child(c) { return ref(path + '/' + c); }};
        };
        return {ref: (p) => ref(p || '')};
      },
    };
  }, {data: base, role: papel});
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'rt.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://rt.test/retrabalhos.html');
  await page.waitForSelector('.rt-card', {timeout: 8000});
  return {page, errors};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // ── 1. Quantidade pendente: a tela diz o que falta ─────────────────
    let {page, errors} = await abrir(browser, dados(), 'admin');
    const kpis = await page.locator('#rtKpis').innerText();
    assert.match(kpis, /1\s*\n?\s*COM QUANTIDADE PENDENTE/i, 'a pendência aparece no topo');

    if (process.env.RT_SCREENSHOT) await page.screenshot({path: process.env.RT_SCREENSHOT, fullPage: true});
    const card = page.locator('.rt-card', {hasText: 'PERFUME TAWUS'});
    const textoCard = await card.innerText();
    assert.match(textoCard, /Falta conferir a quantidade de 1 apontamento/,
      'o cartão diz o que está travando — antes o botão sumia calado');
    assert.match(textoCard, /0 un\. conferidas/, 'pendente não é zero conferido por engano');
    assert.match(textoCard, /de 867 do lote/, 'referência do lote original');
    assert.match(textoCard, /1 período\(s\) sem quantidade/);
    assert.equal(await card.locator('.rt-passo.travado').count(), 1, 'o passo aparece destacado como travado');

    // Filtro "Em aberto" é o padrão: o caso encerrado não polui a tela.
    assert.equal(await page.locator('.rt-card').count(), 1);
    await page.click('[data-filtro=""]');
    assert.equal(await page.locator('.rt-card').count(), 2, 'em "Todos" aparecem os dois');
    await page.click('[data-filtro="encerrados"]');
    assert.equal(await page.locator('.rt-card').count(), 1);
    assert.match(await page.locator('.rt-card').innerText(), /BODY SPLASH ANTIGO/);
    await page.fill('#rtBusca', 'tawus');
    assert.equal(await page.locator('.rt-card').count(), 0, 'busca respeita o filtro de status');
    await page.fill('#rtBusca', '');
    await page.click('[data-filtro="abertos"]');

    // ── 2. O caso aberto: linha do tempo e conferência ────────────────
    await page.click('.rt-card [data-abrir="RT1"]');
    await page.waitForSelector('#rtModalBg.open');
    const corpo = await page.locator('#rtModalBody').innerText();
    assert.match(corpo, /Caso aberto/);
    assert.match(corpo, /Início do setup/);
    assert.match(corpo, /Período apontado — quantidade pendente/,
      'o período pendente aparece como pendente, não como 0 un.');
    // Os títulos de seção são text-transform:uppercase, e innerText devolve
    // o texto já transformado -- por isso a comparação ignora caixa.
    assert.match(corpo, /Conferir quantidade pendente/i);
    assert.match(corpo, /Sedimentação inesperada do corante/);
    // Sem decisão ainda: não há formulário de avaliação num caso pausado.
    assert.equal(await page.locator('#rtDecisao').count(), 0);

    await page.fill('#rtQtd', '400');
    await page.click('#rtSalvarQtd');
    await page.waitForFunction(() => window.__chamadas.length > 0);
    let chamada = (await page.evaluate(() => window.__chamadas))[0];
    assert.equal(chamada.nome, 'apontarRetrabalho');
    assert.equal(chamada.payload.acao, 'corrigir_quantidade');
    assert.equal(chamada.payload.apontamentoId, 'a1');
    assert.equal(chamada.payload.quantidade, '400');
    assert.equal(chamada.payload.revisao, 3, 'manda a revisão que leu — evita sobrescrever outra pessoa');
    assert.ok(/^rtg_/.test(chamada.payload.operacaoId), 'operação identificada para retry idempotente');
    await page.close();

    // ── 3. Sem pendência, o passo vira "encerrar" ─────────────────────
    ({page, errors} = await abrir(browser, dados({apontamentos: {a1: CONFERIDO}}), 'admin'));
    let t = await page.locator('.rt-card', {hasText: 'PERFUME TAWUS'}).innerText();
    assert.match(t, /Pronto para encerrar a execução/);
    assert.match(t, /400 un\. conferidas/);
    assert.match(t, /1h09 apontados/, 'tempo vem dos períodos, não do relógio de parede');
    assert.equal(await page.locator('.rt-passo.travado').count(), 0);
    await page.close();

    // ── 4. Aguardando Qualidade: a avaliação que não existia ──────────
    const aguardando = dados({status: 'aguardando_qualidade', apontamentos: {a1: CONFERIDO},
      encerradoEm: '2026-09-22T14:00:00.000Z', atualizadoEm: '2026-09-22T14:00:00.000Z'});
    ({page, errors} = await abrir(browser, aguardando, 'qualidade'));
    t = await page.locator('.rt-card', {hasText: 'PERFUME TAWUS'}).innerText();
    assert.match(t, /Aguardando a sua avaliação/);
    await page.click('.rt-card [data-abrir="RT1"]');
    await page.waitForSelector('#rtDecisao');
    assert.match(await page.locator('#rtModalBody').innerText(), /Execução encerrada/);
    // A tela explica o que cada decisão faz, inclusive que não libera lote.
    assert.match(await page.locator('#rtDecisaoAjuda').innerText(), /não libera estoque/i);
    await page.selectOption('#rtDecisao', 'nova_etapa');
    assert.match(await page.locator('#rtDecisaoAjuda').innerText(), /Devolve o caso para a linha/);

    // Análise é obrigatória: decisão de qualidade sem justificativa não vai.
    await page.selectOption('#rtDecisao', 'liberado');
    await page.click('#rtSalvarDecisao');
    assert.match(await page.locator('#rtErro').innerText(), /Registre a análise/);
    assert.equal((await page.evaluate(() => window.__chamadas)).length, 0, 'nada foi enviado');

    if (process.env.RT_SCREENSHOT2) await page.screenshot({path: process.env.RT_SCREENSHOT2, fullPage: true});
    await page.fill('#rtAnalise', 'Reinspeção conforme; precipitado ausente.');
    await page.click('#rtSalvarDecisao');
    await page.waitForFunction(() => window.__chamadas.length > 0);
    chamada = (await page.evaluate(() => window.__chamadas))[0];
    assert.equal(chamada.payload.acao, 'decidir');
    assert.equal(chamada.payload.decisao, 'liberado');
    assert.equal(chamada.payload.analise, 'Reinspeção conforme; precipitado ausente.');
    await page.close();

    // ── 5. Acompanha, mas não decide ──────────────────────────────────
    // PCP programa e enxerga o caso; quem atesta que o retrabalho resolveu é
    // a Qualidade. (Produção nem chega aqui: a tela pertence ao módulo de
    // Qualidade, e a execução dela continua no Apontamento.)
    ({page, errors} = await abrir(browser, aguardando, 'pcp'));
    t = await page.locator('.rt-card', {hasText: 'PERFUME TAWUS'}).innerText();
    assert.match(t, /Aguardando avaliação da Qualidade/, 'para quem não decide, a frase é outra');
    await page.click('.rt-card [data-abrir="RT1"]');
    await page.waitForSelector('#rtModalBg.open');
    assert.equal(await page.locator('#rtDecisao').count(), 0, 'sem formulário de decisão');
    assert.equal(await page.locator('#rtSalvarQtd').count(), 0, 'sem conferência de quantidade');

    // ── 6. Caso encerrado mostra a avaliação registrada ───────────────
    await page.click('#rtModalFechar');
    await page.click('[data-filtro="encerrados"]');
    await page.click('.rt-card [data-abrir="RT2"]');
    await page.waitForSelector('#rtModalBg.open');
    const encerrado = await page.locator('#rtModalBody').innerText();
    assert.match(encerrado, /Avaliação: Retrabalho aprovado/i);
    assert.match(encerrado, /Rotulagem refeita e conferida/);
    assert.match(encerrado, /Daiene/);
    assert.match(encerrado, /Caso encerrado — retrabalho aprovado/);

    assert.deepEqual(errors, [], 'erros de página: ' + errors.join(' | '));
    await page.close();
    console.log('run_retrabalhos_gestao_ui_test: OK — acompanhar, destravar a pendência e avaliar o caso.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
