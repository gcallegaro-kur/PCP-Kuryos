'use strict';
/* Devolver OP à fila (01/10): a OP sai da linha SEM encerrar, mantém o que produziu,
   o líder declara o que ficou retido (frascos rotulados, bulk em bombona), a linha é
   liberada e a pausa é fechada. Tela real (form.html); Firebase simulado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados(role) {
  const h = (horas) => new Date(Date.now() - horas * 3600000).toISOString();
  return {
    usuarios: {u1: {nome: 'Lider Linha', email: 'l@kuryos.com', role: role}},
    config: {linhas: ['Linha 1', 'Linha 2'], rotulagem: ['Rotulagem 01'], postosTrabalho: []},
    estado_linhas: {Linha_2: {status: 'parada', setor: 'linha', inicioParada: h(2), motivoParada: 'Falta de Material', lote: '26258/05', produto: 'BODY SPLASH', opAtual: {lote: '26258/05'}}},
    ops: {
      '26258-05': {lote: '26258/05', produto: 'BODY SPLASH', cliente: 'DAPOP', sku: 'DPBS01', status: 'Produção Parcial', qtdPlanejada: 2820, produzidoLinha: 900, produzido: 900,
        abertaDesde: h(5), abertaLinha: 'Linha 2', linha: 'Linha 2', setupInicio: h(6), setupFim: h(5.5), validade: '2029-09-24T10:00:00Z',
        manipulacao: {status: 'LIBERADO', manipulacao: {fim: h(30), rendimento: 500}},
        materiaisConsumo: {b_1: {mpCodigo: 'EP-00002', mpNome: 'VALVULA SPRAY', origem: 'bom', unidade: 'un', quantidade: 2820}, b_2: {mpCodigo: 'ES-00151', mpNome: 'ROTULO BODY SPLASH', origem: 'bom', unidade: 'un', quantidade: 2820}}},
      '26264-11': {lote: '26264/11', produto: 'OUTRO', cliente: 'GLOW', status: 'Em Produção', qtdPlanejada: 100, produzidoLinha: 10, abertaDesde: h(1), abertaLinha: 'Linha 1', validade: '2029-01-01T00:00:00Z',
        manipulacao: {status: 'LIBERADO', manipulacao: {fim: h(30), rendimento: 100}}}
    },
    bombonas_bulk: {'BB-0001': {codigo: 'BB-0001', tipo: 'BOMBONA', capacidadeKg: 400, ativo: true, conteudo: null}, 'BB-0002': {codigo: 'BB-0002', tipo: 'BOMBONA', ativo: true,
      conteudo: {lote: 'OUTRO-LOTE', kg: 50, donoTipo: 'CLIENTE', donoNome: 'X'}}},
    material_processo: {}, pedidos: {}, produtos: {}, registros: {}, programacao: {}, turnosIniciados: {}, turnosEncerrados: {}, atividadesPosto: {}, paradas_historico: {}
  };
}

async function abrirPagina(browser, role, atraso) {
  const page = await browser.newPage({viewport: {width: 1600, height: 1100}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(({data, atraso}) => {
    window.__atrasoLogin = atraso;
    const db = data;
    window.__db = db;
    window.__iniciado = false;
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    window.__ouvintes = [];
    const notificar = () => window.__ouvintes.forEach((o) => o.cb(o.snap()));
    const gravar = (p, v) => {
      const ks = partes(p); let o = db;
      ks.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
      if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = structuredClone(v);
    };
    let seq = 0;
    const exige = q => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() {
        exige('auth');
        return {currentUser: {uid: 'u1', email: 'g@kuryos.com'},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), window.__atrasoLogin || 0); },
          signOut() { return Promise.resolve(); }};
      },
      database() {
        exige('database');
        const ref = (path, filtro) => {
          const valor = () => {
            let v = ler(path);
            if (filtro && v && typeof v === 'object') v = Object.fromEntries(Object.entries(v).filter(([k]) => k >= filtro));
            return v === undefined ? null : structuredClone(v);
          };
          const snap = () => { const v = valor(); return {val: () => v, exists: () => v !== null, key: partes(path).pop(), forEach(cb) { Object.entries(v || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
          return {path, key: partes(path).pop(),
            once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); },
            on(ev, cb) { window.__ouvintes.push({cb, snap}); setTimeout(() => cb(snap()), 0); return cb; },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
            startAt(k) { return ref(path, k); },
            push(v) { seq++; const filho = ref(path + '/-T' + seq); if (v !== undefined) { gravar(filho.path, v); notificar(); } const pr = Promise.resolve(filho); pr.key = filho.key; pr.path = filho.path; return pr; },
            set(v) { gravar(path, v); notificar(); return Promise.resolve(); },
            update(obj) { Object.entries(obj).forEach(([k, v]) => gravar(path + '/' + k, v)); notificar(); return Promise.resolve(); },
            remove() { gravar(path, null); return Promise.resolve(); },
            transaction(fn) { const r = fn(valor()); if (r !== undefined) { gravar(path, r); notificar(); } return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        };
        return {ref: (p) => ref(p || '')};
      }
    };
  }, {data: dados(role), atraso: atraso});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'tr.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://tr.test/form.html');
  await page.waitForSelector('.kt-sidebar', {timeout: 8000});
  return {page, errors};
}



const dentro = (page, seletor) => page.locator('.mpf-fundo ' + seletor);
const db = (page) => page.evaluate(() => window.__db);
(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrirPagina(browser, 'production', 0);
    await page.waitForFunction(() => window.currentUser && window.currentUser.role === 'production', null, {timeout: 10000});
    await page.waitForSelector('[data-devolver-lote="26258/05"]', {timeout: 10000});
    // O botão existe em todo card com OP alocada (Linha 1 e Linha 2), não só para admin/PCP.
    assert.equal(await page.locator('[data-devolver-lote]').count(), 2);
    assert.equal(await page.locator('[data-rearranjar-lote]').count(), 0, 'rearranjo continua só admin/PCP');

    // ── 1. Validações: motivo "Outro" sem detalhe, sem confirmar, bulk sem bombona ──
    await page.locator('[data-devolver-lote="26258/05"]').click();
    await page.waitForSelector('.mpf-fundo');
    assert.match(await dentro(page, '#mpfContagem').innerText(), /VALVULA SPRAY/);
    assert.match(await dentro(page, '#mpfContagem').innerText(), /Bulk que sobrou/);
    await page.getByRole('button', {name: 'Devolver à fila'}).click();
    assert.match(await dentro(page, '#mpfErro').innerText(), /Confirme a declaração/);
    await dentro(page, '#mpfMotivo').selectOption('Outro');
    await dentro(page, '#mpfConfirma').check();
    await page.getByRole('button', {name: 'Devolver à fila'}).click();
    assert.match(await dentro(page, '#mpfErro').innerText(), /Descreva o motivo/);
    await dentro(page, '#mpfMotivo').selectOption('Falta de componente');
    await dentro(page, '#mpfDetalhe').fill('faltam válvulas, cliente ainda não mandou');
    await page.evaluate(() => { document.querySelector('.mpf-fundo .mpf-row[data-chave="bulk"] .qtd').value = '330'; });
    // A bombona com bulk de OUTRO lote não é oferecida; só a vazia.
    const opcoes = await page.locator('.mpf-fundo .recipiente option').allInnerTexts();
    assert.ok(opcoes.some((o) => /BB-0001/.test(o)) && !opcoes.some((o) => /BB-0002/.test(o)), opcoes.join(' | '));
    const d0 = await db(page);
    assert.ok(d0.ops['26258-05'].abertaDesde, 'nada saiu da linha enquanto havia erro');

    // ── 2. Declara 1.200 frascos rotulados + 330 kg de bulk na BB-0001 e devolve ──
    await page.evaluate(() => { document.querySelector('.mpf-fundo .mpf-row[data-chave="frascos_rotulados"] .qtd').value = '1200'; });
    await dentro(page, '.recipiente').selectOption('BB-0001');
    await page.getByRole('button', {name: 'Devolver à fila'}).click();
    await page.waitForFunction(() => !window.__db.ops['26258-05'].abertaDesde, null, {timeout: 8000});
    const d = await db(page);
    const op = d.ops['26258-05'];
    // A OP mantém tudo o que produziu e o status; só sai da linha.
    assert.equal(op.produzidoLinha, 900);
    assert.equal(op.status, 'Produção Parcial');
    assert.ok(!op.abertaLinha, 'sem linha alocada');
    assert.equal(op.emFila.setor, 'linha');
    assert.equal(op.emFila.linhaAnterior, 'Linha 2');
    assert.match(op.emFila.motivo, /Falta de componente — faltam válvulas/);
    assert.equal(Object.values(op.devolucoesFila).length, 1);
    // A linha é liberada e a pausa vira histórico.
    assert.equal(d.estado_linhas.Linha_2.status, 'ativa');
    assert.ok(!d.estado_linhas.Linha_2.inicioParada && !d.estado_linhas.Linha_2.opAtual && !d.estado_linhas.Linha_2.lote);
    const pausa = Object.values(d.paradas_historico).find((p) => p.lote === '26258/05');
    assert.equal(pausa.motivo, 'Falta de Material');
    assert.equal(pausa.devolvidaAFila, true);
    assert.ok(pausa.duracao >= 119, 'duração da pausa fechada: ' + pausa.duracao);
    // O que ficou retido: frascos rotulados e bulk, com dono, OP e quem declarou.
    const retidos = Object.values(d.material_processo);
    assert.equal(retidos.length, 2);
    const fr = retidos.find((r) => r.tipo === 'FRASCO_ROTULADO'), bk = retidos.find((r) => r.tipo === 'BULK');
    assert.deepEqual([fr.qtd, fr.unidade, fr.origem, fr.status, fr.donoNome, fr.lote], [1200, 'un', 'PAUSA', 'EM_PROCESSO', 'DAPOP', '26258/05']);
    assert.deepEqual([bk.qtd, bk.unidade, bk.recipienteCodigo], [330, 'kg', 'BB-0001']);
    // O bulk entrou na bombona identificada, com lote, validade e dono.
    const bb = d.bombonas_bulk['BB-0001'];
    assert.equal(bb.conteudo.kg, 330);
    assert.equal(bb.conteudo.lote, '26258/05');
    assert.equal(bb.conteudo.validade, '2029-09-24T10:00:00Z');
    assert.equal(bb.conteudo.donoNome, 'DAPOP');
    assert.equal(Object.values(bb.historico)[0].tipo, 'ENCHER');
    // O card da Linha 2 volta a "Nenhuma OP alocada"; a Linha 1 segue com a sua.
    await page.waitForFunction(() => /Nenhuma OP alocada/.test(document.getElementById('turnoGridLinhas').innerText));
    assert.equal(await page.locator('[data-devolver-lote]').count(), 1);

    // ── 3. Retomar: alocar de novo em qualquer linha limpa o marcador de fila ──
    await page.evaluate(() => abrirAlocarOpModal('Linha 2', 'linha'));
    await page.evaluate(() => { document.getElementById('alocarOpLote').value = '26258/05'; });
    await page.click('#btnConfirmarAlocarOp');
    await page.waitForFunction(() => window.__db.ops['26258-05'].abertaLinha === 'Linha 2', null, {timeout: 8000});
    const d2 = await db(page);
    assert.ok(!d2.ops['26258-05'].emFila, 'saiu da fila');
    assert.equal(d2.ops['26258-05'].produzidoLinha, 900, 'continua de onde parou');
    assert.equal(Object.values(d2.material_processo).length, 2, 'o que ficou retido continua registrado até alguém dar baixa');

    // ── 4. Bombona é OPCIONAL: a OP da Linha 1 devolve com 40 kg de bulk e NENHUM recipiente ──
    await page.locator('[data-devolver-lote="26264/11"]').click();
    await page.waitForSelector('.mpf-fundo');
    assert.equal(await page.locator('.mpf-fundo .mpf-row[data-chave="bulk"]').count(), 1);
    assert.match(await dentro(page, '.recipiente').innerText(), /não identificar agora \(opcional\)/);
    await page.evaluate(() => { document.querySelector('.mpf-fundo .mpf-row[data-chave="bulk"] .qtd').value = '40'; });
    await dentro(page, '#mpfConfirma').check();
    await page.getByRole('button', {name: 'Devolver à fila'}).click();
    await page.waitForFunction(() => !window.__db.ops['26264-11'].abertaDesde, null, {timeout: 8000});
    const d3 = await db(page);
    const bulkSem = Object.values(d3.material_processo).find((r) => r.lote === '26264/11' && r.tipo === 'BULK');
    assert.equal(bulkSem.qtd, 40);
    assert.equal(bulkSem.recipienteCodigo, null, 'sem bombona identificada');
    assert.equal(bulkSem.donoNome, 'GLOW');
    assert.deepEqual([d3.bombonas_bulk['BB-0001'].conteudo.kg, d3.bombonas_bulk['BB-0001'].conteudo.lote], [330, '26258/05'], 'as bombonas não foram tocadas');
    assert.ok(!d3.bombonas_bulk['BB-0002'].conteudo.kg || d3.bombonas_bulk['BB-0002'].conteudo.kg === 50);

    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    console.log('OK Devolver OP à fila: validações, OP sai da linha mantendo a produção, pausa fechada, retidos e bulk em bombona, retomada limpa o marcador.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
