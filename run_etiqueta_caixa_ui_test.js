'use strict';
/* UI da etiqueta de caixa de embarque (01/10/2026):
   1) Cadastros › Clientes: envia o logo (reduzido no navegador, vai ao
      Storage só no Salvar), preserva o resto do cadastro, remove o logo,
      recusa arquivo que não é imagem;
   2) diálogo de impressão (shared/etiqueta-caixa.js): avisos do que falta,
      sugestão de caixas cheias + parcial, lote do cliente gravado na OP,
      janela de impressão com o número certo de etiquetas e o logo.
   Firebase simulado em memória (o mesmo de run_espelho_cadastro_ui_test.js). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
// PNG 1x1 (logo de teste).
const LOGO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

function dados() {
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    clientes: {
      MISS: {nome: 'MISS RÔSE COSMETICOS', codigo: 'MISS', cnpj: '12.345.678/0001-90', cidade: 'São Paulo', uf: 'SP',
        condicaoPagamento: '30/60', site: 'missrose.com.br', enderecoFaturamento: 'Rua das Flores, 100, Centro, São Paulo/SP',
        ativo: true, contatosVersao: 1,
        contatos: {c1: {nome: 'Bruno Comercial', email: 'bruno@miss.com', telefone: '11 8888-0000', areas: ['COMERCIAL'], principais: ['COMERCIAL']}}},
      GLOW: {nome: 'GLOW MAKE UP', codigo: 'GLOW', cnpj: '55.555.555/0001-55', ativo: true}
    },
    fornecedores: {
      f1: {razaoSocial: 'EMBALAGENS ARAÇÁ INDUSTRIA LTDA', nomeFantasia: 'Araçá Pack', cnpj: '98765432000155',
        cep: '01310100', logradouro: 'Av. Paulista', numero: '900', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP',
        condicaoPagamento: '28 DDL', contatoNome: 'Carla Vendas', contatoEmail: 'carla@aracapack.com.br',
        contatoTelefone: '11 7777-0000', tipos: ['EMBALAGEM'], ativo: true, revisado: true},
      f2: {razaoSocial: 'GLOW MAKE UP DISTRIBUIDORA', nomeFantasia: 'Glow Distribuidora', cnpj: '55555555000155', ativo: true}
    },
    materiais: {}, produtos: {}, formulas: {}, bom: {}, especificacoes: {}, categorias: {}, config: {}, estoque: {}
  };
}

async function abrir(browser, estadoInicial, pagina) {
  const page = await browser.newPage({viewport: {width: 1500, height: 1100}});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
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
        return {currentUser: {uid: 'u1', email: 'g@kuryos.com'},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), 0); },
          signOut() { return Promise.resolve(); }};
      },
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
      },
      storage() {
        return {ref(p) {
          return {put(blob, meta) {
            window.__uploads = (window.__uploads || []).concat([{path: p, tipo: meta && meta.contentType, tamanho: blob.size}]);
            return Promise.resolve({ref: {getDownloadURL: () => Promise.resolve('https://cad.test/logo-enviado.png?' + p)}});
          }};
        }};
      }
    };
  }, estadoInicial || dados());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'cad.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    if (url.pathname === '/logo-enviado.png') return route.fulfill({body: LOGO, contentType: 'image/png'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://cad.test/' + (pagina || 'cadastros.html?tab=clientes'));
  try {
    await page.waitForFunction(() => window.currentUser && window.currentUser.nome, null, {timeout: 12000});
  } catch (e) {
    console.log('DBG url', page.url(), 'erros', errors, await page.evaluate(() => [document.title, typeof window.currentUser, document.body.innerText.slice(0, 200)]));
    throw e;
  }
  return {page, errors};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // ── 1. Logo no cadastro do cliente ──
    const {page, errors} = await abrir(browser);
    await page.waitForSelector('#tableBody-cli .btn-edit-cli');
    await page.click('#tableBody-cli .btn-edit-cli[data-key="MISS"]');
    await page.waitForSelector('#modalBg-cli.open');
    assert.equal((await page.locator('#logoPrev-cli').innerText()).trim(), 'sem logo');
    assert.equal(await page.locator('#logoRemover-cli').isVisible(), false);
    await page.setInputFiles('#fLogo-cli', {name: 'logo.png', mimeType: 'image/png', buffer: LOGO});
    await page.waitForSelector('#logoPrev-cli img');
    assert.equal(await page.evaluate(() => (window.__uploads || []).length), 0, 'só sobe no Salvar');
    await page.click('#modalSaveBtn-cli');
    await page.waitForFunction(() => window.__db.clientes.MISS.logoEtiquetaUrl);
    const up = await page.evaluate(() => window.__uploads);
    assert.equal(up.length, 1);
    assert.match(up[0].path, /^clientes_logo\/MISS_\d+\.png$/);
    assert.equal(up[0].tipo, 'image/png');
    const cli = await page.evaluate(() => window.__db.clientes.MISS);
    assert.match(cli.logoEtiquetaUrl, /logo-enviado\.png/);
    assert.equal(cli.contatos.c1.nome, 'Bruno Comercial', 'resto do cadastro intacto');
    assert.equal(cli.cnpj, '12.345.678/0001-90');
    // Reabre: mostra o logo salvo; Remover apaga.
    await page.click('#tableBody-cli .btn-edit-cli[data-key="MISS"]');
    await page.waitForSelector('#modalBg-cli.open #logoPrev-cli img');
    await page.click('#logoRemover-cli');
    assert.equal((await page.locator('#logoPrev-cli').innerText()).trim(), 'sem logo');
    await page.click('#modalSaveBtn-cli');
    await page.waitForFunction(() => !window.__db.clientes.MISS.logoEtiquetaUrl);
    // Arquivo que não é imagem: recusa sem subir.
    await page.click('#tableBody-cli .btn-edit-cli[data-key="MISS"]');
    await page.waitForSelector('#modalBg-cli.open');
    await page.setInputFiles('#fLogo-cli', {name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('x')});
    await page.waitForFunction(() => /arquivo de imagem/.test(document.getElementById('alertBox').innerText));
    await page.click('#modalCancelBtn-cli');
    assert.equal(await page.evaluate(() => window.__uploads.length), 1);
    assert.deepEqual(errors, [], 'erros em Cadastros: ' + errors.join(' | '));
    await page.close();

    // ── 2. Diálogo de impressão ──
    const estado = dados();
    estado.clientes.MISS.logoEtiquetaUrl = 'https://cad.test/logo-enviado.png';
    estado.ops = {'26273-03': {lote: '26273/03', sku: 'MRBS0004', produto: 'BODY SPLASH NÉCTAR 200ML', cliente: 'MISS RÔSE COSMETICOS', clienteKey: 'MISS',
      pecasPorCaixa: 24, qtdPlanejada: 250, validade: '2028-09-30T00:00:00.000Z', codCliente: 'MR-BS04', kgCaixa: 6.2, dum14: '', materiaisConsumo: {}}};
    const produto = {sku: 'MRBS0004', clienteKey: 'MISS', dum14: '17908420116816'};
    const {page: pg, errors: err2} = await abrir(browser, estado);
    await pg.evaluate(() => {
      window.__impresso = null;
      window.open = () => ({document: {html: '', write(h) { this.html += h; }, close() { window.__impresso = this.html; }}});
    });
    const abrirDlg = (op, opKey, prod) => pg.evaluate(([op, opKey, prod]) => EtiquetaCaixa.abrirDialogo({op: op || window.__db.ops[opKey], opKey, produto: prod, db: firebase.database()}), [op, opKey, prod]);
    await abrirDlg(null, '26273-03', produto);
    await pg.waitForFunction(() => /campos obrigatórios|Faltando/.test(document.getElementById('etqCxAviso').innerText));
    const aviso = await pg.locator('#etqCxAviso').innerText();
    assert.match(aviso, /Todos os campos obrigatórios/, 'DUN-14 vem do cadastro atual quando a OP não fotografou: ' + aviso);
    assert.equal(await pg.inputValue('#etqCxCheias'), '10');
    assert.equal(await pg.inputValue('#etqCxParcial'), '1', '250 = 10 × 24 + 10');
    assert.equal(await pg.locator('#etqCxTotal').innerText(), '11 etiquetas');
    const prev = await pg.locator('#etqCxPrev').getAttribute('srcdoc');
    assert.match(prev, /logo-enviado\.png/, 'pré-visualização com o logo');
    assert.match(prev, /MR-BS04/);
    await pg.locator('#etqCxDlg [role=dialog]').screenshot({path: process.env.ETQ_SHOTS ? process.env.ETQ_SHOTS + '/etq-dialogo.png' : undefined}).catch(() => {});
    await pg.fill('#etqCxLote', 'L2609A');
    await pg.fill('#etqCxCheias', '2');
    assert.equal(await pg.locator('#etqCxTotal').innerText(), '3 etiquetas');
    await pg.click('#etqCxImprimir');
    await pg.waitForFunction(() => window.__impresso);
    const html = await pg.evaluate(() => window.__impresso);
    assert.equal((html.match(/<section class="etq">/g) || []).length, 3, '2 cheias + 1 parcial');
    assert.equal((html.match(/CAIXA PARCIAL/g) || []).length, 1);
    assert.match(html, /L2609A/);
    assert.match(html, /26273\/03/, 'lote interno continua o da OP');
    assert.match(html, /logo-enviado\.png/);
    assert.match(html, /window\.print/);
    await pg.waitForFunction(() => window.__db.ops['26273-03'].loteCliente === 'L2609A');
    assert.equal(await pg.locator('#etqCxDlg').count(), 0, 'fecha depois de imprimir');
    // Reabrir: lote do cliente já vem preenchido.
    await abrirDlg(null, '26273-03', produto);
    await pg.waitForFunction(() => document.getElementById('etqCxLote').value === 'L2609A');
    // Produto sem cadastro completo: avisa o que falta (e substitui o diálogo aberto).
    await abrirDlg({lote: '1/01', produto: 'X', cliente: 'Y', qtdPlanejada: 10}, '1-01', {});
    await pg.waitForFunction(() => /Faltando no cadastro/.test(document.getElementById('etqCxAviso').innerText));
    assert.equal(await pg.locator('#etqCxDlg').count(), 1);
    const falta = await pg.locator('#etqCxAviso').innerText();
    for (const k of ['Código do cliente', 'Quantidade por caixa', 'Peso da caixa', 'DUN-14', 'Validade']) assert.ok(falta.includes(k), k);
    await pg.click('#etqCxCancelar');
    assert.equal(await pg.locator('#etqCxDlg').count(), 0);
    assert.deepEqual(err2, [], 'erros no diálogo: ' + err2.join(' | '));
    console.log('OK etiqueta de caixa: logo no cadastro (envia, preserva, remove, recusa não-imagem) e diálogo de impressão (avisos, sugestão de caixas, parcial, lote do cliente gravado na OP).');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
