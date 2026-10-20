'use strict';
/* Liberação de linha (19/10/2026): CK-4 + CK-5 de ponta a ponta na tela. Firebase simulado ao vivo (o de run_pendencias_produto_ui_test.js), com troca de usuário e Storage falso. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

async function abrir(browser, estadoInicial, pagina) {
  const page = await browser.newPage({viewport: {width: 1500, height: 1100}});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript((data) => {
    const db = data;
    window.__db = db;
    let iniciado = false;
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
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); iniciado = true; },
      auth() {
        if (!iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (auth)");
        return {get currentUser() { return {uid: window.__uid || 'u1', email: 'g@kuryos.com'}; },
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), 0); },
          signOut() { return Promise.resolve(); }};
      },
      storage() { return {ref(p) { return {put() { return Promise.resolve(); }, getDownloadURL() { return Promise.resolve('https://foto.test/' + p); }}; }}; },
      database() {
        if (!iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (database)");
        const ref = (path) => {
          const valor = () => { const v = ler(path); return v === undefined ? null : structuredClone(v); };
          const snap = () => { const v = valor(); return {val: () => v, exists: () => v !== null, key: partes(path).pop(),
            forEach(cb) { Object.entries(v || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
          return {path, key: partes(path).pop(),
            once(ev, cb) { const sn = snap(); if (cb) cb(sn); return Promise.resolve(sn); },
            on(ev, cb) { const avisar = () => cb(snap()); ouvintes.push({path, avisar}); setTimeout(avisar, 0); return cb; },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, limitToLast() { return this; }, startAt() { return this; },
            push(v) {
              seq++;
              const filho = ref(path + '/-N' + seq);
              if (v === undefined) return filho;
              gravar(filho.path, v);
              const pr = Promise.resolve(filho); pr.key = filho.key; return pr;
            },
            set(v) { gravar(path, v); return Promise.resolve(); },
            update(obj) { Object.entries(obj).forEach(([k, v]) => gravar(path + '/' + k, v)); return Promise.resolve(); },
            remove() { gravar(path, null); return Promise.resolve(); },
            transaction(fn) { const r = fn(valor()); if (r !== undefined) gravar(path, r); return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        };
        return {ref: (p) => ref(p || '')};
      }
    };
  }, estadoInicial);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'lib.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://lib.test/' + pagina);
  try {
    await page.waitForFunction(() => window.currentUser && window.currentUser.nome, null, {timeout: 12000});
  } catch (e) {
    console.log('DBG url', page.url(), 'erros', errors, await page.evaluate(() => [document.title, typeof window.currentUser, document.body.innerText.slice(0, 200)]));
    throw e;
  }
  return {page, errors};
}


const C = require('./public/shared/checklists.js');
const P = require('./public/shared/checklists-modelos-padrao.js');
function estado() {
  const modelos = {};
  P.MODELOS.forEach((m, i) => {
    const r = C.publicar('m' + i, null, m.itens, {agora: '2026-10-19T10:00:00Z', por: 'Daiene'});
    modelos['m' + i] = {codigo: m.codigo, nome: m.nome, ativo: true, versaoAtual: 1, versoes: {1: r.updates['checklist_modelos/m' + i + '/versoes/1']}};
  });
  return {
    usuarios: {u1: {nome: 'Daiene', email: 'cq@kuryos.com', role: 'admin'}},
    config: {linhas: ['Linha 1', 'Linha 2']},
    ops: {'26290-01': {lote: '26290/01', sku: 'HDR-1', produto: 'HIDRATANTE TESTE 200ml', status: 'Programado', linha: 'Linha 1', abertaLinha: 'Linha 1', dataEmissao: '2026-10-19T08:00:00'}},
    produtos: {'HDR-1': {sku: 'HDR-1', volume: 200, unidadeVolume: 'ml', densidadeGranel: 0.9}},
    checklist_modelos: modelos, ativos: {a1: {codigo: 'EV-01', nome: 'Envasadora', tipo: 'ENVASADORA', area: 'ENVASE', linha: 'Linha 1', situacao: 'OPERACIONAL', exigeAssepsia: true}}
  };
}
const foto = {name: 'f.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(2048, 7)};

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page: p, errors} = await abrir(browser, estado(), 'liberacao_linha.html');
    await p.waitForFunction(() => document.querySelectorAll('#fLinha option').length > 1);
    await p.selectOption('#fLinha', 'Linha 1');
    await p.waitForSelector('[data-acao="iniciar4"]');
    assert.match(await p.locator('#lista').innerText(), /Equipamentos: EV-01[\s\S]*Primeira assepsia registrada/);

    // CK-4: quem executa preenche a limpeza.
    await p.click('[data-acao="iniciar4"]');
    await p.waitForSelector('#mf');
    const sna = async (id, v) => p.click('[data-item="' + id + '"] [data-r="' + v + '"]');
    for (const id of ['c4x1', 'c4x2', 'c4x3', 'c4x6']) await sna(id, 'S');
    await p.selectOption('[data-item="c4x4"] [data-escolha]', 'Álcool 70%');
    await p.fill('[data-item="c4x5"] [data-valor]', '10');
    await p.locator('[data-item="c4x5"] [data-valor]').dispatchEvent('change');
    assert.equal(await p.locator('[data-item="c4q1"] [data-r="S"]').isDisabled(), true, 'parte da Qualidade fechada até concluir a limpeza');
    await p.click('#bConcluir');
    const db = (q) => p.evaluate((q) => q.split('/').reduce((o, k) => o && o[k], window.__db), q);
    await p.waitForFunction(() => Object.values(window.__db.inspecoes_cq || {}).some((i) => i.status === 'AGUARDANDO_QUALIDADE'));

    // Qualidade verifica e libera a assepsia.
    await p.click('[data-acao="abrir"]');
    await p.waitForSelector('#mf');
    for (const id of ['c4q1', 'c4q2', 'c4q3', 'c4q4']) await sna(id, 'S');
    await p.click('#bLiberar');
    await p.waitForFunction(() => window.__db.liberacao_linha['26290-01'].ck4.status === 'APROVADO');
    assert.equal(await db('assepsia_linhas/LINHA_1/ultima/sku'), 'HDR-1');

    // CK-5: first article com 32 pesos (nominal 200 ml × 0,9 = 180 g) e fotos obrigatórias.
    await p.waitForSelector('[data-acao="iniciar5"]');
    await p.click('[data-acao="iniciar5"]');
    await p.waitForSelector('#mf [data-amostra="31"]');
    assert.equal(await p.inputValue('[data-item="c5f1"] [data-nominal]'), '180');
    for (const id of ['c5l1', 'c5l2', 'c5l3', 'c5i1', 'c5i2', 'c5i3', 'c5m1', 'c5m2', 'c5f2', 'c5f3', 'c5f5', 'c5f6']) await sna(id, 'S');
    for (let i = 0; i < 32; i++) {
      await p.fill('[data-amostra="' + i + '"]', i === 5 ? '170' : '181');
      await p.locator('[data-amostra="' + i + '"]').dispatchEvent('change');
    }
    assert.match(await p.locator('[data-item="c5f1"] .estat').innerText(), /32\/32[\s\S]*1 abaixo do mínimo/);
    await p.setInputFiles('[data-item="c5i3"] [data-foto]', foto);
    await p.setInputFiles('[data-item="c5m2"] [data-foto]', foto);
    await p.click('#bLiberar');
    await p.waitForFunction(() => /não conforme/.test(document.getElementById('fErro').innerText));
    await p.fill('[data-amostra="5"]', '180');
    await p.locator('[data-amostra="5"]').dispatchEvent('change');
    await p.click('#bLiberar');
    await p.waitForFunction(() => window.__db.liberacao_linha['26290-01'].ck5.status === 'AGUARDANDO_LIDER');
    const i5 = await db('liberacao_linha/26290-01/ck5/id');
    const ins5 = await db('inspecoes_cq/' + i5);
    assert.equal(ins5.respostas.c5i3.fotos.length, 1, 'foto enviada e gravada no item');
    assert.equal(ins5.respostas.c5f1.valores.length, 32);
    assert.equal(ins5.versao, 1);

    // Líder: a mesma pessoa que aprovou não assina; outra assina e a linha fica liberada.
    await p.waitForSelector('[data-acao="assinar"]');
    await p.click('[data-acao="assinar"]');
    await p.waitForFunction(() => /outra pessoa/.test(document.body.innerText));
    await p.evaluate(() => { window.__uid = 'lid1'; });
    await p.click('[data-acao="assinar"]');
    await p.waitForFunction(() => window.__db.liberacao_linha['26290-01'].ck5.status === 'APROVADO');
    assert.equal(await db('assepsia_linhas/LINHA_1/lotesDesde'), 1);
    await p.waitForFunction(() => /LINHA LIBERADA/.test(document.getElementById('lista').innerText));
    if (process.env.LIB_SHOT) await p.screenshot({path: process.env.LIB_SHOT, fullPage: false});
    assert.deepEqual(errors, [], 'erros: ' + errors.join(' | '));
    console.log('OK Liberação de linha: assepsia (operador → Qualidade), first article com 32 pesos e fotos, reprova abaixo de −3%, líder diferente assina, lote contado para o POP 035.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
