'use strict';
/* Sequência por setor + Próximas Ordens (29/09), nas telas reais:
   - o PCP, no Planejamento › Sequência por setor, vê um bloco por setor,
     reordena a fila de uma linha, troca a OP de linha e informa o ritmo da
     rotuladora -- e o banco recebe só caminhos planos;
   - a Rotulagem, em Próximas Ordens, vê só a fila dela, na ordem do PCP,
     com o término estimado e sem nenhum botão de ordenar;
   - a Logística vê só a Separação.
   Firebase simulado em memória com listeners VIVOS (a escrita do PCP
   redesenha a tela, como no banco real). Relógio fixo: 29/09 08:00. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    usuarios: {
      pcp: {nome: 'Carla PCP', email: 'pcp@kuryos.com', role: 'pcp'},
      rot: {nome: 'Rafa Rótulos', email: 'rot@kuryos.com', role: 'gestor', modulos: {rotulagem: true}},
      log: {nome: 'Lia Logística', email: 'log@kuryos.com', role: 'logistica'}
    },
    config: {
      linhas: ['Linha 1', 'Linha 2'], rotulagem: ['Rotuladora 1'],
      turnos: ['A'], turnoHorarios: {A: '07:00'}, turnoHorariosFim: {A: '17:00'},
      turnoPausas: {A: {inicio: '12:00', fim: '13:00'}},
      planejamento: {diasSemana: [1, 2, 3, 4, 5], feriados: {}}
    },
    produtos: {
      p1: {sku: 'BS01', descricao: 'BODY SPLASH 200ML', prodHoraRef: 500},
      p2: {sku: 'CR02', descricao: 'CREME 100G', prodHoraRef: 250}
    },
    ops: {
      '26300-01': {lote: '26300/01', sku: 'BS01', produto: 'BODY SPLASH 200ML', cliente: 'MISS RÔSE', status: 'Programado',
        qtdPlanejada: 1000, dataEmissao: '2026-09-20', linha: 'Linha 1', formulaVersao: 'F1__v1',
        materiaisConsumo: {a: {origem: 'bom', mpCodigo: 'ES-1', mpNome: 'ROTULO BS 200ML'}, b: {origem: 'bom', mpCodigo: 'EP-1', mpNome: 'FRASCO 200ML'}}},
      '26300-02': {lote: '26300/02', sku: 'CR02', produto: 'CREME 100G', cliente: 'TAWUS', status: 'Programado',
        qtdPlanejada: 500, dataEmissao: '2026-09-21', linha: 'Linha 1', separacaoConcluida: true,
        materiaisConsumo: {a: {origem: 'bom', mpCodigo: 'EP-2', mpNome: 'POTE 100G'}}},
      '26300-03': {lote: '26300/03', sku: 'BS01', produto: 'BODY SPLASH 200ML', cliente: 'MISS RÔSE', status: 'Em Produção',
        qtdPlanejada: 2000, produzidoLinha: 1500, abertaDesde: '2026-09-29T07:00:00', abertaLinha: 'Linha 1', separacaoConcluida: true, skuPedidoKey: 'PED5__BS01',
        produzidoRotulagem: 1400, abertaDesdeRot: '2026-09-29T07:10:00', abertaRotulagem: 'Rotuladora 1',
        materiaisConsumo: {a: {origem: 'bom', mpCodigo: 'ES-1', mpNome: 'ROTULO BS 200ML'}}},
      '26300-04': {lote: '26300/04', sku: 'CR02', produto: 'CREME 100G', cliente: 'TAWUS', status: 'Programado',
        qtdPlanejada: 500, dataEmissao: '2026-09-28', skuPedidoKey: 'PED7__CR02', separacaoConcluida: true},
      '26300-09': {lote: '26300/09', sku: 'BS01', status: 'Concluído', qtdPlanejada: 10}
    },
    // Grade de Quantidades: PED7 planejado na Linha 2 às 13h-15h; o pedido da
    // 26300/03 (rodando) estava planejado para acabar às 08:00.
    programacao: {
      '2026-09-29': {
        '07_00': {env1: {pedidoKey: 'PED5__BS01', mediaPorHora: 500}},
        '13_00': {env2: {pedidoKey: 'PED7__CR02', mediaPorHora: 250}},
        '14_00': {env2: {pedidoKey: 'PED7__CR02', mediaPorHora: 250}}
      }
    }
  };
}

async function abrir(browser, uid, pagina, viewport) {
  const page = await browser.newPage({viewport: viewport || {width: 1400, height: 1000}});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.clock.install({time: new Date('2026-09-29T08:00:00')});
  await page.addInitScript(({data, uid}) => {
    const db = data;
    window.__db = db;
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const ouvintes = [];
    const avisar = () => setTimeout(() => ouvintes.forEach((o) => o()), 0);
    const gravar = (p, v) => {
      const ks = partes(p); let o = db;
      ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
      if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = structuredClone(v);
    };
    window.__updates = [];
    const exige = () => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]'"); };
    const email = db.usuarios[uid].email;
    window.firebase = {
      initializeApp() { window.__iniciado = true; },
      auth() {
        exige();
        return {currentUser: {uid, email}, onAuthStateChanged(cb) { setTimeout(() => cb({uid, email}), 0); }, signOut() { return Promise.resolve(); }};
      },
      database() {
        exige();
        const ref = (path) => {
          const valor = () => { const v = ler(path); return v === undefined ? null : structuredClone(v); };
          const snap = () => { const v = valor(); return {val: () => v, exists: () => v !== null, key: partes(path).pop(),
            forEach(cb) { Object.entries(v || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
          return {path, key: partes(path).pop(),
            once(ev, cb) { const sn = snap(); if (cb) cb(sn); return Promise.resolve(sn); },
            on(ev, cb) { const f = () => cb(snap()); ouvintes.push(f); setTimeout(f, 0); return cb; },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, limitToLast() { return this; }, startAt() { return this; }, endAt() { return this; },
            push(v) { const k = '-Q' + Math.random().toString(36).slice(2); if (v !== undefined) { gravar(path + '/' + k, v); avisar(); } const r = ref(path + '/' + k); const pr = Promise.resolve(r); pr.key = k; return v === undefined ? r : pr; },
            set(v) { gravar(path, v); avisar(); return Promise.resolve(); },
            update(obj) { window.__updates.push(obj); Object.entries(obj).forEach(([k, v]) => gravar(path + '/' + k, v)); avisar(); return Promise.resolve(); },
            remove() { gravar(path, null); avisar(); return Promise.resolve(); },
            transaction(fn) { const r = fn(valor()); if (r !== undefined) { gravar(path, r); avisar(); } return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        };
        return {ref: (p) => ref(p || '')};
      }
    };
  }, {data: dados(), uid});
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'app.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript'});
  });
  await page.goto('https://app.test/' + pagina);
  await page.waitForFunction(() => window.currentUser && window.currentUser.role, null, {timeout: 8000});
  return {page, errors};
}

const esperarOrdem = (page, setor, recurso, esperada) => page.waitForFunction(({setor, recurso, esperada}) =>
  Array.from(document.querySelectorAll('[data-sq-setor="' + setor + '"] [data-sq-recurso="' + recurso + '"] [data-sq-item]'))
    .map((e) => e.getAttribute('data-sq-item')).join() === esperada.join(), {setor, recurso, esperada}, {timeout: 5000});
const ordemNaTela = (page, setor, recurso) => page.evaluate(({setor, recurso}) =>
  Array.from(document.querySelectorAll('[data-sq-setor="' + setor + '"] [data-sq-recurso="' + recurso + '"] [data-sq-item]'))
    .map((e) => e.getAttribute('data-sq-item')), {setor, recurso});

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // ── 1. PCP: um bloco por setor, tudo na mesma aba ────────────────────
    const pcp = await abrir(browser, 'pcp', 'planejamento.html?tab=sequencia');
    const p = pcp.page;
    await p.waitForSelector('#tabSequencia.active [data-sq-setor="rotulagem"]', {timeout: 8000});
    const blocos = await p.$$eval('#tabSequencia [data-sq-setor]', (els) => els.map((e) => e.getAttribute('data-sq-setor')));
    assert.deepEqual(blocos, ['separacao', 'manipulacao', 'envase', 'rotulagem']);
    const recursosEnv = await p.$$eval('[data-sq-setor="envase"] [data-sq-recurso]', (els) => els.map((e) => e.getAttribute('data-sq-recurso')));
    assert.deepEqual(recursosEnv, ['Linha 1', 'Linha 2']);
    // OP emitida sem linha herda a do pedido na grade de Quantidades (só sugestão).
    assert.deepEqual(await ordemNaTela(p, 'envase', 'Linha 2'), ['26300-04']);
    const sugerida = await p.locator('[data-sq-item="26300-04"]').innerText();
    assert.match(sugerida, /sugerida pela grade/);
    // Mais rápido que o plano: 500 a 250 un/h a partir de 08:00 → 10:00, contra 15:00 na grade.
    assert.match(sugerida, /Começa hoje 08:00 · termina hoje 10:00[\s\S]*5 h antes do planejado na grade/);
    // Mais lento: o pedido da 26300/03 devia ter acabado às 08:00; a estimativa diz 09:00.
    assert.match(await p.locator('[data-sq-setor="envase"] [data-sq-item="26300-03"]').innerText(), /⚠ 1 h depois do planejado na grade/);
    // Rodando primeiro; depois emissão.
    assert.deepEqual(await ordemNaTela(p, 'envase', 'Linha 1'), ['26300-03', '26300-01', '26300-02']);
    const envTxt = await p.locator('[data-sq-setor="envase"]').innerText();
    // 26300/03: faltam 500 a 500 un/h → termina 09:00; 26300/01: 1000 → 09:00–11:00; 26300/02: 500 a 250 → 11:00–14:00 (pausa).
    assert.match(envTxt, /26300\/03[\s\S]*Termina hoje 09:00/);
    assert.match(envTxt, /26300\/01[\s\S]*Começa hoje 09:00 · termina hoje 11:00/);
    assert.match(envTxt, /26300\/02[\s\S]*Começa hoje 11:00 · termina hoje 14:00/, 'pula a pausa do almoço');
    // Etapas lidas da OP: separada não aparece; manipulação só com fórmula.
    assert.deepEqual(await ordemNaTela(p, 'separacao', 'Separação'), ['26300-01']);
    assert.deepEqual(await ordemNaTela(p, 'manipulacao', 'Manipulação'), ['26300-01']);
    assert.deepEqual(await ordemNaTela(p, 'rotulagem', 'Rotuladora 1'), ['26300-03']);
    assert.deepEqual(await ordemNaTela(p, 'rotulagem', 'Sem rotuladora'), ['26300-01'], 'OP com rótulo e sem rotuladora definida');

    // ── 2. Reordenar: ↓ na primeira móvel ────────────────────────────────
    assert.equal(await p.locator('[data-sq-item="26300-03"] [data-sq-mover]').count(), 0, 'rodando não se move');
    await p.click('[data-sq-setor="envase"] [data-sq-item="26300-01"] [data-sq-mover="1"]');
    await p.waitForFunction(() => { const s = window.__db.sequenciamento; return s && s.ordem && s.ordem.envase && s.ordem.envase['26300-02']; });
    await esperarOrdem(p, 'envase', 'Linha 1', ['26300-03', '26300-02', '26300-01']);
    let u = await p.evaluate(() => window.__updates[window.__updates.length - 1]);
    assert.equal(u['sequenciamento/ordem/envase/26300-02/posicao'], 1);
    assert.equal(u['sequenciamento/ordem/envase/26300-01/posicao'], 2);
    assert.equal(u['sequenciamento/atualizadoPor'], 'Carla PCP');
    assert.ok(Object.values(u).every((v) => v === null || typeof v !== 'object'), 'só caminhos planos');

    // ── 3. Trocar de linha ────────────────────────────────────────────────
    await p.selectOption('[data-sq-setor="envase"] [data-sq-recurso-op="26300-01"]', 'Linha 2');
    await p.waitForFunction(() => window.__db.sequenciamento.ordem.envase['26300-01'].recurso === 'Linha 2');
    // A decisão do PCP vence a sugestão: a 26300/01 posicionada vem antes da sugerida.
    await esperarOrdem(p, 'envase', 'Linha 2', ['26300-01', '26300-04']);
    // Envase não finge que a manipulação já aconteceu: sem ritmo nela, avisa.
    assert.match(await p.locator('[data-sq-setor="envase"] [data-sq-item="26300-01"]').innerText(),
      /Estimativa sem contar a manipulação, que está sem estimativa/);

    // ── 4. Ritmo da rotuladora destrava a estimativa ──────────────────────
    assert.match(await p.locator('[data-sq-setor="rotulagem"]').innerText(), /Sem estimativa: informe o ritmo \(un\/h\)/);
    const ritmo = p.locator('[data-sq-ritmo="rotulagem|Rotuladora 1"]');
    await ritmo.fill('300');
    await ritmo.dispatchEvent('change');
    await p.waitForFunction(() => ((((window.__db.sequenciamento || {}).ritmos || {}).rotulagem || {})['Rotuladora 1'] || {}).unPorHora === 300);
    // 26300/03 faltam 600 a 300 un/h = 2 h → 10:00.
    await p.waitForFunction(() => /Termina hoje 10:00/.test(document.querySelector('[data-sq-setor="rotulagem"]').innerText));
    if (process.env.SQ_SCREENSHOT) await p.screenshot({path: process.env.SQ_SCREENSHOT + '-pcp.png', fullPage: true});
    assert.deepEqual(pcp.errors, [], 'erros no Planejamento: ' + pcp.errors.join(' | '));
    await p.close();

    // ── 5. Rotulagem: só a fila dela, sem botão de ordenar ────────────────
    const rot = await abrir(browser, 'rot', 'proximas_ordens.html?setor=envase');
    const r = rot.page;
    await r.waitForSelector('[data-sq-setor]', {timeout: 8000});
    assert.deepEqual(await r.$$eval('[data-sq-setor]', (els) => els.map((e) => e.getAttribute('data-sq-setor'))), ['rotulagem'],
      'pediu envase pela URL, mas só enxerga o próprio setor');
    assert.equal(await r.locator('#setores').isVisible(), false, 'um setor só: sem abas');
    assert.equal(await r.locator('[data-sq-mover], [data-sq-recurso-op], [data-sq-ritmo]').count(), 0, 'setor só consulta');
    assert.match(await r.locator('h1').innerText(), /Próximas Ordens — Rotulagem/);
    assert.deepEqual(await ordemNaTela(r, 'rotulagem', 'Rotuladora 1'), ['26300-03']);
    assert.match(await r.locator('#fila').innerText(), /26300\/03[\s\S]*Rotulando[\s\S]*600 un a fazer de 2\.000/);
    assert.match(await r.locator('#fila').innerText(), /Sem rotuladora[\s\S]*a definir pelo PCP/, 'instrução do PCP não aparece para o setor');
    assert.doesNotMatch(await r.locator('#fila').innerText(), /planejado na grade|sugerida pela grade/, 'desvio é informação do PCP');
    assert.doesNotMatch(await r.locator('#fila').innerText(), /Mover para|informe o ritmo/);
    // O menu leva à fila do setor.
    assert.equal(await r.locator('.kt-sidebar a[href="proximas_ordens.html?setor=rotulagem"]').count(), 1);
    assert.equal(await r.locator('.kt-sidebar a[href="proximas_ordens.html?setor=envase"]').count(), 0);
    if (process.env.SQ_SCREENSHOT) {
      const cel = await abrir(browser, 'rot', 'proximas_ordens.html', {width: 390, height: 800});
      await cel.page.waitForSelector('[data-sq-item]');
      await cel.page.screenshot({path: process.env.SQ_SCREENSHOT + '-rot.png', fullPage: true});
      await cel.page.close();
    }
    assert.deepEqual(rot.errors, [], 'erros em Próximas Ordens: ' + rot.errors.join(' | '));
    await r.close();

    // ── 6. Logística: a Separação ─────────────────────────────────────────
    const log = await abrir(browser, 'log', 'proximas_ordens.html');
    await log.page.waitForSelector('[data-sq-setor]', {timeout: 8000});
    assert.deepEqual(await log.page.$$eval('[data-sq-setor]', (els) => els.map((e) => e.getAttribute('data-sq-setor'))), ['separacao']);
    assert.match(await log.page.locator('#fila').innerText(), /26300\/01[\s\S]*A separar[\s\S]*Sem estimativa: o PCP ainda não informou o ritmo/);
    assert.equal(await log.page.locator('.kt-sidebar a[href="proximas_ordens.html?setor=separacao"]').count(), 1);
    assert.deepEqual(log.errors, []);

    console.log('OK Próximas Ordens: PCP ordena por setor/recurso no Planejamento (caminhos planos, troca de linha, ritmo); setor consulta só a sua fila, com estimativa, sem editar.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
