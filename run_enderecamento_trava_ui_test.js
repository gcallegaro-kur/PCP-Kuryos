'use strict';
/* Tela Movimentar (WMS, 29/09) de ponta a ponta: tela real com utils.js
   (transferirLoteEndereco / separarParcialLoteEndereco de verdade),
   seletor-endereco.js e auth_check.js; Firebase simulado em memória
   (mesmo harness de run_manipulacao_ui_test.js). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    usuarios: {u1: {nome: 'Diego Costa', email: 'diego@kuryos.com', role: 'admin'}},
    config: {linhas: ['Linha 1']},
    materiais: {
      'ET-00071': {tipo: 'ET', mpCodigo: 'ET-00071', mpNome: 'CAIXA DE EMBARQUE 48', unidade: 'un'},
      'ET-00099': {tipo: 'ET', mpCodigo: 'ET-00099', mpNome: 'CAIXA ANTIGA SEM ENDERECO', unidade: 'un'}
    },
    estoque: {
      'ET-00071': {materialCodigo: 'ET-00071', materialNome: 'CAIXA DE EMBARQUE 48', saldoAtual: 2096, unidade: 'un'},
      'ET-00099': {materialCodigo: 'ET-00099', materialNome: 'CAIXA ANTIGA SEM ENDERECO', saldoAtual: 500, unidade: 'un'}
    },
    enderecos_estoque: {
      'GAL-2-1-1': {codigo: 'GAL-2.1.1', area: 'GALPÃO', rua: 2, predio: 1, nivel: 1, ativo: true},
      'GAL-4-3-15': {codigo: 'GAL-4.3.15', area: 'GALPÃO', rua: 4, predio: 3, nivel: 15, ativo: true}
    },
    estoque_lotes: {
      'ET-00071': {'AK-2026-000650': {itemCodigo: 'ET-00071', itemTipo: 'material', saldoLote: 2096, unidade: 'un', loteInterno: 'AK-2026-000650', enderecoKey: 'GAL-2-1-1', status: 'QUARENTENA'}}
    },
    movimentos_estoque: {}
  };
}

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


(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser, 'u1', dados(), 'estoque.html');
    const db = () => page.evaluate(() => window.__db);
    await page.click('[data-tab="enderecamento"]');
    await page.waitForFunction(() => typeof edSelecionarItem === 'function' && typeof allEstoque !== 'undefined' && Object.keys(allEstoque).length === 2 && typeof allEnderecosEstoque !== 'undefined' && Object.keys(allEnderecosEstoque).length >= 2 && typeof allEstoqueLotes !== 'undefined' && Object.keys(allEstoqueLotes).length >= 1, null, {timeout: 10000});
    const tentar = async (codigo, nome, qtd) => {
      await page.evaluate(([c, n]) => { edSelecionarItem({key: c, tipo: 'material', codigo: c, nome: n, unidade: 'un'}); document.getElementById('edEndereco').value = 'GAL-4-3-15'; }, [codigo, nome]);
      await page.fill('#edQtd', String(qtd));
      await page.click('#btnEdAddPosicao');
    };

    // Já tem lote com posição (o do recebimento): 600 de "novo" endereço é duplicar.
    await tentar('ET-00071', 'CAIXA DE EMBARQUE 48', 600);
    await page.waitForFunction(() => /Não dá para endereçar 600/.test(document.body.innerText), null, {timeout: 5000});
    assert.match(await page.locator('body').innerText(), /Movimentar material/);
    let d = await db();
    assert.equal(Object.keys(d.estoque_lotes['ET-00071']).length, 1, 'nenhum lote novo foi criado');

    // Material com saldo sem endereço: continua funcionando, dentro do que falta.
    await tentar('ET-00099', 'CAIXA ANTIGA SEM ENDERECO', 900);
    await page.waitForFunction(() => /só tem 500 sem endereço/.test(document.body.innerText), null, {timeout: 5000});
    d = await db();
    assert.equal(Object.keys(d.estoque_lotes['ET-00099'] || {}).length, 0, 'acima do que falta: barra');
    await tentar('ET-00099', 'CAIXA ANTIGA SEM ENDERECO', 300);
    await page.waitForFunction(() => window.__db.estoque_lotes['ET-00099'] && Object.keys(window.__db.estoque_lotes['ET-00099']).length === 1, null, {timeout: 5000});
    d = await db();
    const novo = Object.values(d.estoque_lotes['ET-00099'])[0];
    assert.deepEqual([novo.saldoLote, novo.enderecoKey, novo.origemTipo], [300, 'GAL-4-3-15', 'endereco_inicial']);
    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    console.log('OK Endereçamento: trava quando passa do que está sem endereço; dentro do saldo continua gravando.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
