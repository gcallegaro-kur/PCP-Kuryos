'use strict';
/* GAP-04 na tela real de apontamento (form.html): OP com fórmula só entra no
   envase com o bulk liberado -- pela lista do Alocar OP, pelo lote digitado,
   pelo Abrir OP do modo avançado e pelo Fim de Setup. Rotulagem não depende
   do bulk. Firebase simulado com listeners (harness de
   run_impacto_pedido_ops_ui_test.js). node run_portao_bulk_ui_test.js */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const DEPOIS = '2026-09-25T10:00:00.000Z', ANTES = '2026-09-21T10:00:00.000Z';
const op = (lote, extra) => Object.assign({lote, sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR', cliente: 'MISS RÔSE',
  status: 'Programado', qtdPlanejada: 1000, produzidoLinha: 0, dataEmissao: DEPOIS, formulaVersao: 'v1'}, extra || {});
const BANCO = {
  usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
  config: {linhas: ['Linha 1'], rotulagem: ['Rotulagem 1'], postosTrabalho: []},
  produtos: {MRARBS04: {sku: 'MRARBS04', descricao: 'BODY SPLASH NÉCTAR', cliente: 'MISS RÔSE'}},
  ops: {
    '26270-01': op('26270/01'),                                             // fórmula, nova, sem fase -> trava
    '26270-02': op('26270/02', {manipulacao: {status: 'LIBERADO'}}),       // liberada -> passa
    '26270-03': op('26270/03', {formulaVersao: null}),                     // sem fórmula -> passa
    '26264-12': op('26264/12', {dataEmissao: ANTES}),                      // legado de 21/09 -> passa
    '26270-04': op('26270/04', {manipulacao: {status: 'AGUARDANDO_CQ'}})   // fase pendente -> trava
  },
  pedidos: {}, registros: {}, estado_linhas: {}, programacao: {}, paradas_historico: {}, atividadesPosto: {},
  retrabalhos: {}, retrabalhos_linhas: {}, pedidos_comerciais: {}, estoque: {}, estoque_lotes: {}
};

async function abrir(browser, pagina) {
  const page = await browser.newPage({viewport: {width: 1500, height: 1000}});
  const errors = [];
  const alertas = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { alertas.push(d.message()); return d.accept(); });
  await page.addInitScript(({data}) => {
    const db = data; window.__db = db;
    const partes = p => String(p || '').split('/').filter(Boolean);
    const ler = p => {
      if (String(p).replace(/^\//, '') === '.info/connected') return true;
      return partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    };
    const gravar = (p, v) => { const ks = partes(p); let o = db; ks.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = structuredClone(v); };
    const ouvintes = []; let seq = 0;
    const snapDe = path => { const v = ler(path); const c = v === undefined ? null : structuredClone(v);
      return {val: () => c, exists: () => c !== null, key: partes(path).pop(),
        forEach(cb) { Object.entries(c || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
    const avisar = caminhos => ouvintes.forEach(o => {
      if (caminhos.some(c => c === o.path || c.startsWith(o.path + '/') || o.path.startsWith(c + '/') || o.path === '')) setTimeout(() => o.cb(snapDe(o.path)), 0);
    });
    window.firebase = {
      initializeApp() {},
      auth() { return {currentUser: {uid: 'u1', email: 'g@kuryos.com'}, onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com'}), 0); }, signOut() { return Promise.resolve(); }}; },
      functions() { return {httpsCallable() { return () => Promise.resolve({data: {ok: true}}); }}; },
      storage() { return {ref() { return {put() { return Promise.resolve(); }, getDownloadURL() { return Promise.resolve(''); }}; }}; },
      database() {
        const ref = path => ({path, key: partes(path).pop(),
          once(ev, cb) { const s = snapDe(path); if (cb) cb(s); return Promise.resolve(s); },
          on(ev, cb) { ouvintes.push({path, cb}); setTimeout(() => cb(snapDe(path)), 0); return cb; }, off() {},
          child(c) { return ref(path + '/' + c); }, orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; },
          startAt() { return this; }, limitToLast() { return this; },
          push(v) { seq++; const f = ref(path + '/-N' + seq); if (v === undefined) return f; gravar(f.path, v); avisar([f.path]); const pr = Promise.resolve(f); pr.key = f.key; return pr; },
          set(v) { gravar(path, v); avisar([path]); return Promise.resolve(); },
          update(obj) { const cs = Object.keys(obj).map(k => (path ? path + '/' : '') + k); Object.entries(obj).forEach(([k, v]) => gravar((path ? path + '/' : '') + k, v)); avisar(cs); return Promise.resolve(); },
          remove() { gravar(path, null); avisar([path]); return Promise.resolve(); },
          transaction(fn) { const atual = ler(path); const r = fn(atual === undefined ? null : structuredClone(atual)); if (r !== undefined) { gravar(path, r); avisar([path]); } return Promise.resolve({committed: r !== undefined, snapshot: snapDe(path)}); }});
        return {ref: p => ref(p || '')};
      }
    };
  }, {data: BANCO});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'bulk.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://bulk.test/' + pagina);
  await page.waitForFunction(() => window.currentUser && window.currentUser.role === 'admin');
  await page.waitForFunction(() => typeof opsCache !== 'undefined' && opsCache['26270-01'] && typeof abrirAlocarOpModal === 'function', null, {timeout: 10000});
  return {page, errors, alertas};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  let passos = 0;
  try {
    const {page, errors, alertas} = await abrir(browser, 'form.html');
    const lista = () => page.locator('#alocarOpModal').innerText();
    const ultimoAlerta = async () => { await page.waitForFunction(() => true); await page.waitForTimeout(50); return alertas.pop() || ''; };

    // 1. Lista da linha: as travadas somem e aparecem no aviso com o motivo.
    await page.evaluate(() => abrirAlocarOpModal('Linha 1', 'linha'));
    await page.waitForSelector('#alocarOpModal.open');
    let txt = await lista();
    for (const l of ['26270/02', '26270/03', '26264/12']) assert.ok(txt.includes(l), l + ' disponível');
    assert.match(txt, /OP\(s\) com granel não liberado pela Qualidade/, 'aviso das travadas');
    assert.ok(txt.includes('26270/04 (bulk aguardando análise)'), 'fase pendente no aviso');
    assert.ok(txt.includes('26270/01 (bulk ainda não passou pela Manipulação)'), 'a nova sem fase aparece no aviso com o que falta');
    passos++;

    // 2. Lote fora da lista (campo oculto preenchido antes do bulk mudar): recusa com o motivo.
    await page.evaluate(v => { document.getElementById('alocarOpLote').value = v; }, '26270/01');
    await page.click('#btnConfirmarAlocarOp');
    assert.match(await ultimoAlerta(), /26270\/01 não pode ser alocada na linha: Esta OP tem fórmula/);
    assert.equal(await page.evaluate(() => window.__db.ops['26270-01'].abertaDesde), undefined, 'nada gravado');
    passos++;

    // 3. Rotulagem enxerga a OP travada: rótulo vai no frasco antes do envase.
    await page.evaluate(() => { document.getElementById('alocarOpModal').classList.remove('open'); abrirAlocarOpModal('Rotulagem 1', 'rotulagem'); });
    txt = await lista();
    assert.ok(txt.includes('26270/01'), 'rotulagem vê a OP sem bulk');
    assert.doesNotMatch(txt, /granel não liberado/, 'sem aviso de bulk na rotulagem');
    await page.evaluate(v => { document.getElementById('alocarOpLote').value = v; }, '26270/01');
    await page.click('#btnConfirmarAlocarOp');
    await page.waitForFunction(() => window.__db.ops['26270-01'].abertaRotulagem === 'Rotulagem 1');
    passos++;

    // 4. Liberada entra na linha; bulk reprovado depois -> Fim de Setup recusa.
    await page.evaluate(() => abrirAlocarOpModal('Linha 1', 'linha'));
    await page.evaluate(v => { document.getElementById('alocarOpLote').value = v; }, '26270/02');
    await page.click('#btnConfirmarAlocarOp');
    await page.waitForFunction(() => window.__db.ops['26270-02'].abertaLinha === 'Linha 1');
    await page.evaluate(() => window.firebase.database().ref('ops/26270-02/manipulacao/status').set('REPROVADO'));
    await page.waitForFunction(() => opsCache['26270-02'].manipulacao.status === 'REPROVADO');
    await page.evaluate(() => encerrarSetup('26270/02', 'linha'));
    assert.match(await ultimoAlerta(), /26270\/02 não pode começar o envase: Bulk reprovado/);
    assert.equal(await page.evaluate(() => window.__db.ops['26270-02'].setupFim || null), null, 'setup não encerrado');
    passos++;

    // 5. Abrir OP do modo avançado também passa pelo portão.
    await page.evaluate(() => {
      document.getElementById('alocarOpModal').classList.remove('open');
      document.getElementById('tLote').value = '26270/04';
      const sel = document.getElementById('tLinha');
      if (![...sel.options].some(o => o.value === 'Linha 1')) sel.add(new Option('Linha 1', 'Linha 1'));
      sel.value = 'Linha 1';
      document.getElementById('btnAbrirOP').click();
    });
    assert.match(await ultimoAlerta(), /26270\/04 não pode ser aberta na linha: Bulk ainda não liberado/);
    assert.equal(await page.evaluate(() => window.__db.ops['26270-04'].abertaDesde), undefined);
    passos++;

    // 6. Legado (emitida antes do corte) abre normalmente pelo modo avançado.
    await page.evaluate(() => { document.getElementById('tLote').value = '26264/12'; document.getElementById('btnAbrirOP').click(); });
    await page.waitForFunction(() => window.__db.ops['26264-12'].abertaLinha === 'Linha 1');
    passos++;

    const graves = errors.filter(e => !/ResizeObserver|Failed to fetch/.test(e));
    assert.deepEqual(graves, [], 'erros de JS: ' + graves.join(' | '));
    await page.close();
    console.log('portão do bulk UI: ' + passos + ' etapas OK');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
