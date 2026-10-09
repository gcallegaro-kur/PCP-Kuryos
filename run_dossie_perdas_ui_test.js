'use strict';
/* Dossiê do lote: seção Perdas do lote (09/10/2026), Firebase simulado (o de run_correcao_bulk_ui_test.js). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

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

function dados() {
  return {
    usuarios: {cq: {nome: 'Daiene', email: 'cq@kuryos.com', role: 'qualidade'}},
    config: {linhas: ['Linha 1']},
    ops: {'26400-01': {lote: '26400/01', sku: 'HDR-1', produto: 'HIDRATANTE TESTE 200ml', cliente: 'MISS RÔSE', status: 'Concluído',
      qtdPlanejada: 1000, produzido: 1000, dataEmissao: '2026-10-01T08:00:00',
      manipulacao: {status: 'LIBERADO',
        previstos: {'MP-A': {mpCodigo: 'MP-A', mpNome: 'AGUA', unidade: 'kg', previsto: 180}},
        pesagem: {inicio: '2026-10-01T09:00:00Z', fim: '2026-10-01T09:30:00Z', itens: {'MP-A': {pesado: 180, loteMaterial: 'L1', perda: 0.4, justificativa: 'derramou na balança'}}},
        manipulacao: {inicio: '2026-10-01T10:00:00Z', fim: '2026-10-01T11:00:00Z', rendimento: 176, perdasMp: {'MP-A': 0.6}, perdas: {residuo_tacho: 2}}}}},
    registros: {'2026-10-02': {'-r': {lote: '26400/01', timestamp: '2026-10-02T15:00:00Z', quantidade: 1000, linha: 'Linha 1'}}},
    perdas: {'26400-01': {'-p': {data: '2026-10-02', lote: '26400/01', linha: 'Linha 1', timestamp: '2026-10-02T16:00:00Z', perdas: [
      {tipo: 'Rótulos', quantidade: 12, etapa: 'rotulagem', materialCodigo: 'ET-1', materialNome: 'ROTULO TESTE', especificacao: 'ROTULO TESTE', unidade: 'un'},
      {tipo: 'Produto envasado (un)', quantidade: 20, etapa: 'envase', produto: true, unidade: 'un', kgEquivalente: 3.9, especificacao: 'unidades envasadas descartadas'}]}}},
    movimentos_estoque: {'ET-1': {'-m': {ref: '26400/01', qtd: -1200, tipo: 'consumo_producao', itemCodigo: 'ET-1', unidade: 'un', em: '2026-10-02T16:00:00Z'}}}
  };
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const d = await abrir(browser, 'cq', dados(), 'dossie_lote.html?op=26400-01');
    await d.page.waitForFunction(() => /Perdas do lote/i.test(document.body.innerText), null, {timeout: 8000});
    const sec = await d.page.evaluate(() => {
      const c = [...document.querySelectorAll('.card')].find((x) => /Perdas do lote/i.test(x.innerText));
      return c.innerText;
    });
    // Títulos e rótulos saem em MAIÚSCULAS por CSS: regex com /i.
    assert.match(sec, /5 apontamento\(s\)/);
    assert.match(sec, /Pesagem\s*0,4 kg/i);
    assert.match(sec, /Manipulação\s*2,6 kg/i);
    assert.match(sec, /Rotulagem\s*12 un/i);
    assert.match(sec, /Envase\s*20 un/i);
    assert.match(sec, /Perda de processo\s*4 kg \(2,22%\)/i, '180 pesados, 176 rendidos');
    assert.match(sec, /ET-1\s*ROTULO TESTE\s*12 un\s*1%/);
    assert.match(sec, /Resíduo no tacho/);
    assert.match(sec, /≈ 3,9 kg/);
    assert.match(sec, /derramou na balança/);
    const envase = await d.page.evaluate(() => [...document.querySelectorAll('.card')].find((x) => /^\s*Envase/i.test(x.innerText)).innerText);
    assert.doesNotMatch(envase, /Perdas no envase/i, 'saiu do envase, foi para a seção própria');
    if (process.env.DOSSIE_SHOT) await d.page.locator('.card', {hasText: 'Perdas do lote'}).screenshot({path: process.env.DOSSIE_SHOT});
    assert.deepEqual(d.errors, [], 'erros na tela: ' + d.errors.join(' | '));
    console.log('OK Dossiê: Perdas do lote junta pesagem, manipulação, rotulagem e envase, com % e perda de processo.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
