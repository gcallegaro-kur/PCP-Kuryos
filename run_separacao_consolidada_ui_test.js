'use strict';
/* Separação consolidada, tela de verdade (2026-09-25): separacao_materiais.html
   com Firebase simulado que registra cada escrita.
   - aba "Consolidado por material" lista as OPs na ordem do Planejamento;
   - o mesmo frasco de duas OPs de SKUs diferentes vira uma linha com o total;
   - desmarcar OP e mudar o horizonte recalculam a lista;
   - confirmar separa cada parte amarrada à sua OP (origemRef), acumula
     separacaoParcial e marca "Separada" só a OP que ficou completa;
   - quantidade menor na posição tira da OP de menor prioridade;
   - a visão por OP desconta o que a consolidada já levou. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const bom = (cod, nome, qtd) => ({mpCodigo: cod, mpNome: nome, unidade: 'un', quantidade: qtd, origem: 'bom'});
const lote = (cod, saldo, end, extra) => Object.assign({itemTipo: 'material', itemCodigo: cod, itemNome: cod, unidade: 'un', saldoLote: saldo, status: 'LIBERADO', enderecoKey: end, enderecoCodigo: end}, extra || {});
function dados() {
  return {
    'usuarios/u1': {nome: 'Separador', email: 's@kuryos.com', role: 'logistica'},
    config: {},
    produtos: {MRARBS05: {clienteKey: 'MRAR'}, KUBPBA01: {clienteKey: 'PROP'}},
    ops: {
      a: {lote: '26300/01', sku: 'MRARBS05', produto: 'BODY SPLASH ROSA', cliente: 'MISS ROSE', status: 'Programado', dataInicioPlanejada: '2026-09-28T08:00:00',
        materiaisConsumo: {m1: bom('FR-1', 'FRASCO 200ML', 500), m2: bom('TP-1', 'TAMPA', 500)}},
      b: {lote: '26301/01', sku: 'KUBPBA01', produto: 'BODY SPLASH AZUL', cliente: 'KURYOS', status: 'Programado', dataInicioPlanejada: '2026-09-26T13:00:00',
        materiaisConsumo: {m1: bom('FR-1', 'FRASCO 200ML', 300)}},
      semData: {lote: '26310/01', sku: 'KUBPBA01', produto: 'SEM DATA', status: 'Não Iniciado', dataEmissao: '2026-09-20',
        materiaisConsumo: {m1: bom('FR-1', 'FRASCO 200ML', 50)}}
    },
    enderecos_estoque: {
      G1: {codigo: 'GAL-1.1.1', area: 'GALPAO', ativo: true, rua: 1, nivel: 1, predio: 1},
      G2: {codigo: 'GAL-1.1.2', area: 'GALPAO', ativo: true, rua: 1, nivel: 1, predio: 2},
      F1: {codigo: 'FAB-1.1.1', area: 'FABRICA', ativo: true, rua: 9, nivel: 1, predio: 1}
    },
    estoque_lotes: {
      'FR-1': {l1: lote('FR-1', 700, 'G1', {enderecoCodigo: 'GAL-1.1.1', dataValidade: '2027-01-01', loteInterno: 'AK-2026-000900'})},
      'TP-1': {t1: lote('TP-1', 1000, 'G2', {enderecoCodigo: 'GAL-1.1.2'})}
    }
  };
}

async function abrir(browser, viewport) {
  const context = await browser.newContext({viewport: viewport || {width: 1400, height: 1000}, timezoneId: 'America/Sao_Paulo'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(({data}) => {
    window.__writes = [];
    window.__iniciado = false;
    const exige = (q) => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
    const callable = () => () => Promise.resolve({data: {}});
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() {
        exige('auth');
        return {onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 's@kuryos.com', displayName: 'Separador'}), 0); },
          signOut() { return Promise.resolve(); }, currentUser: {email: 's@kuryos.com'}};
      },
      functions() { return {httpsCallable: callable}; },
      app() { return {functions: () => ({httpsCallable: callable})}; },
      database() {
        exige('database');
        const valor = (path) => {
          if (path in data) return data[path];
          const partes = String(path || '').split('/');
          for (let i = partes.length - 1; i > 0; i--) {
            const base = partes.slice(0, i).join('/');
            if (base in data) return partes.slice(i).reduce((o, k) => (o == null ? undefined : o[k]), data[base]);
          }
          return undefined;
        };
        const ref = (path) => {
          const snap = {val: () => (valor(path) === undefined ? null : structuredClone(valor(path))), exists: () => valor(path) !== undefined, key: String(path).split('/').pop()};
          return {path, key: 'k' + Math.random().toString(36).slice(2, 8),
            once(ev, cb) { if (cb) cb(snap); return Promise.resolve(snap); },
            on(ev, cb) { setTimeout(() => cb(snap), 0); return cb; }, off() {},
            child(p) { return ref(path + '/' + p); },
            push(v) { const caminho = path + '/k' + Math.random().toString(36).slice(2, 8); if (v !== undefined) window.__writes.push({op: 'push', path, v}); return Object.assign(ref(caminho), {then: (a, b) => Promise.resolve(ref(caminho)).then(a, b)}); },
            orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
            set(v) { window.__writes.push({op: 'set', path, v}); return Promise.resolve(); },
            update(v) { window.__writes.push({op: 'update', path: path || '/', v}); return Promise.resolve(); },
            remove() { return Promise.resolve(); },
            transaction(fn) {
              const antes = valor(path) === undefined ? null : structuredClone(valor(path));
              const v = fn(antes);
              window.__writes.push({op: 'transaction', path, v: v === undefined ? null : structuredClone(v)});
              return Promise.resolve({committed: v !== undefined, snapshot: {val: () => v, exists: () => v != null}});
            }};
        };
        return {ref, ServerValue: {TIMESTAMP: 0}};
      }
    };
  }, {data: dados()});
  await page.addInitScript(() => {
    // Relógio fixo: horizonte padrão = hoje + 7 = 02/10/2026.
    const fixo = new Date('2026-09-25T10:00:00-03:00').getTime();
    const D = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends D { constructor(...a) { super(...(a.length ? a : [fixo])); } static now() { return fixo; } };
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'sep.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://sep.test/separacao_materiais.html');
  await page.waitForFunction(() => window.SeparacaoConsolidada && document.querySelector('#opBody tr[data-op-key]'), null, {timeout: 8000});
  return {page, errors, context};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'}).catch(() => chromium.launch({headless: true, channel: 'msedge'}));
  let n = 0;
  const ok = (nome) => { n++; console.log('ok -', nome); };
  {
    const {page: p, errors, context} = await abrir(browser);
    await p.click('.modo-tab[data-modo="consolidado"]');
    assert.equal(await p.inputValue('#consAte'), '2026-10-02');
    const opsTxt = await p.locator('#consOpsBody tr').allInnerTexts();
    assert.equal(opsTxt.length, 3, 'sem programação entra por padrão, por último');
    assert.match(opsTxt[2], /3\s+26310\/01[\s\S]*Sem programação/);
    assert.match(await p.locator('#consAvisoOrdem').innerText(), /1 de 3 OPs não têm data no Planejamento/);
    await p.uncheck('#consSemData');
    assert.equal(await p.locator('#consOpsBody tr').count(), 2);
    assert.equal(await p.locator('#consAvisoOrdem').isVisible(), false);
    assert.match(opsTxt[0], /1\s+26301\/01/);
    assert.match(opsTxt[1], /2\s+26300\/01/);
    ok('OPs na ordem do Planejamento (26/09 antes de 28/09)');

    const fr = p.locator('#consMateriaisBody tr.sep-material-header', {hasText: 'FR-1'});
    assert.match(await fr.innerText(), /total: 800 un para 2 OPs/);
    const linhaFr = p.locator('#consMateriaisBody tr[data-cons-m]', {hasText: 'GAL-1.1.1'});
    assert.match(await linhaFr.innerText(), /26301\/01: 300 · 26300\/01: 400/);
    assert.equal(await linhaFr.locator('.sep-qtd').inputValue(), '700');
    await context.close();
    ok('frasco de dois SKUs vira uma linha com o total (800 pedidos, 700 na posição)');
    assert.deepEqual(errors, []);
  }

  // Cenário principal de confirmação, página limpa.
  {
    const {page: p, errors} = await abrir(browser);
    await p.click('.modo-tab[data-modo="consolidado"]');
    await p.uncheck('#consSemData');
    const fr = p.locator('#consMateriaisBody tr.sep-material-header', {hasText: 'FR-1'});
    assert.match(await fr.innerText(), /Faltam 100 un/);
    assert.match(await fr.innerText(), /26300\/01 \(MRARBS05\): 500 falta 100/);
    ok('falta de saldo aparece e cai na OP de menor prioridade');

    await p.check('#consSemData');
    assert.equal(await p.locator('#consOpsBody tr').count(), 3);
    await p.locator('#consOpsBody .cons-op-chk[data-op-key="semData"]').uncheck();
    assert.match(await fr.innerText(), /para 2 OPs/);
    ok('horizonte e desmarcar OP recalculam a lista');

    // Separador pegou só 600 dos 700 do frasco; tampa inteira.
    await p.locator('#consMateriaisBody tr[data-cons-m]', {hasText: 'GAL-1.1.1'}).locator('.sep-qtd').fill('600');
    await p.evaluate(() => { window.__writes = []; });
    await p.click('#btnConfirmarConsolidada');
    assert.match(await p.locator('#alertBox').innerText(), /Selecione o endereço de destino/);
    assert.equal((await p.evaluate(() => window.__writes)).length, 0);
    await p.selectOption('#consDestino', 'F1');
    await p.click('#btnConfirmarConsolidada');
    await p.waitForFunction(() => /confirmada|avisos/.test(document.getElementById('alertBox').textContent));
    const w = await p.evaluate(() => window.__writes);
    const pedacos = w.filter((x) => x.op === 'push' && /^estoque_lotes\//.test(x.path)).map((x) => [x.v.itemCodigo, x.v.origemRef, x.v.saldoLote, x.v.enderecoKey, x.v.origemTipo, x.v.loteInterno || null]);
    assert.deepEqual(pedacos, [
      ['FR-1', '26301/01', 300, 'F1', 'separacao_op', 'AK-2026-000900'],
      ['FR-1', '26300/01', 300, 'F1', 'separacao_op', 'AK-2026-000900'],
      ['TP-1', '26300/01', 500, 'F1', 'separacao_op', null]
    ]);
    const movs = w.filter((x) => x.op === 'push' && /^movimentos_estoque\//.test(x.path));
    assert.equal(movs.length, 3);
    assert.equal(movs[0].v.motivo, 'SEPARAÇÃO CONSOLIDADA');
    ok('cada parte vira um pedaço próprio amarrado à OP; a falta (100) ficou com a OP de menor prioridade');

    const parcA = w.find((x) => x.op === 'transaction' && x.path === 'ops/a/separacaoParcial');
    const parcB = w.find((x) => x.op === 'transaction' && x.path === 'ops/b/separacaoParcial');
    assert.deepEqual(parcA.v.itens, {'FR-1': 300, 'TP-1': 500});
    assert.deepEqual(parcB.v.itens, {'FR-1': 300});
    const concl = w.filter((x) => x.op === 'set' && /separacaoConcluida$/.test(x.path));
    assert.deepEqual(concl.map((x) => x.path), ['ops/b/separacaoConcluida'], 'só a OP completa vira Separada');
    assert.equal(concl[0].v.via, 'consolidada');
    assert.equal(concl[0].v.por, 'Separador');
    ok('separacaoParcial acumula por OP e só a OP completa é marcada Separada');
    assert.deepEqual(errors, []);
  }

  // Visão por OP desconta o que a consolidada já levou.
  {
    const {page: p, errors} = await abrir(browser);
    await p.evaluate(() => {
      opsGlobal.a.separacaoParcial = {itens: {'FR-1': 300, 'TP-1': 500}};
      abrirPainelSeparacao('a');
    });
    const txt = await p.locator('#sepMateriaisBody').innerText();
    assert.match(txt, /FR-1 — FRASCO 200ML · necessário: 500 un · já separado na consolidada: 300/);
    assert.equal(await p.locator('#sepMateriaisBody tr[data-mp-codigo="FR-1"] .sep-qtd').inputValue(), '200');
    assert.match(txt, /TP-1[\s\S]*Já separado\./);
    ok('visão por OP pede só o que falta depois da consolidada');

    // Celular: sem rolagem horizontal da página.
    await p.setViewportSize({width: 375, height: 812});
    await p.click('.modo-tab[data-modo="consolidado"]');
    const largura = await p.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(largura <= 375 + 1, 'scrollWidth ' + largura);
    ok('celular sem rolagem horizontal');
    assert.deepEqual(errors, []);
  }

  await browser.close();
  console.log(`\n${n} testes ok`);
})().catch((e) => { console.error(e); process.exit(1); });
