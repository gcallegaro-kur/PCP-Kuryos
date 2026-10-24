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
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    clientes: {MISS: {nome: 'MISS ROSE'}, FEB: {nome: 'FEBELLA BEAUTY'}},
    estoque: {
      'ET-00069': {materialCodigo: 'ET-00069', materialNome: 'CAIXA DE EMBARQUE BODY SPLASH ARABE', saldoAtual: 1605, unidade: 'un', porCliente: {MISS: {clienteNome: 'MISS ROSE', saldoAtual: 1605}}},
      'ET-00071': {materialCodigo: 'ET-00071', materialNome: 'CAIXA DE EMBARQUE 48 UNID FEBELLA', saldoAtual: 2096, unidade: 'un'}
    },
    estoque_lotes: {
      'ET-00071': {'AK-2026-000650': {itemTipo: 'material', itemCodigo: 'ET-00071', saldoLote: 2096, unidade: 'un', loteInterno: 'AK-2026-000650', enderecoKey: 'GAL-2-1-1', enderecoCodigo: 'GAL-2.1.1', status: 'QUARENTENA',
        propriedade: {tipo: 'KURYOS'}, destino: {clienteKey: 'FEB', clienteNome: 'FEBELLA BEAUTY', pedidos: ['PED-0010']}}}
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
      functions() {
        return {httpsCallable: (nome) => async (dadosChamada) => {
          const u = db.usuarios.u1 || {};
          if (!(u.role === 'admin' || (u.modulos && u.modulos.titularidade === true))) throw new Error('Só o administrador (ou quem recebeu o módulo Titularidade do Estoque) pode alterar a titularidade.');
          window.__chamadas = (window.__chamadas || []).concat([nome]);
          seq++;
          const plano = Titularidade.preparar(structuredClone(db), Object.assign({}, dadosChamada, {movKey: 'mv-' + String(seq).padStart(6, '0'), novoLoteKey: 'nl-' + String(seq).padStart(6, '0')}), {autor: u.nome, uid: 'u1', agora: new Date().toISOString()});
          Object.entries(plano.updates).forEach(([p, v]) => gravar(p, v));
          return {data: {ok: true, ja: !!plano.ja, resumo: plano.resumo, qtd: plano.qtd}};
        }};
      },
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
    const {page, errors} = await abrir(browser, 'u1', dados(), 'titularidade.html');
    const db = () => page.evaluate(() => window.__db);
    await page.waitForSelector('#busca');
    assert.equal(await page.locator('.kt-sidebar a[href="titularidade.html"]').count(), 1, 'link no menu para o administrador');

    // ET-00069: saldo da MISS ROSE sem nenhum lote
    await page.fill('#busca', 'et-00069');
    await page.click('#resultados [data-item="ET-00069"]');
    await page.waitForSelector('#painelItem:not([hidden])');
    const donos = await page.locator('#donos').innerText();
    assert.match(donos, /MISS ROSE[\s\S]*1\.605/); assert.match(donos, /Kuryos \(geral\)/);
    assert.match(await page.locator('#lotes').innerText(), /não tem lote com saldo/);
    await page.click('[data-sem-lote]');
    await page.waitForSelector('.tt-modal');
    assert.equal(await page.inputValue('#ttQtd'), '1605');
    assert.equal(await page.locator('#ttConfirmar').isDisabled(), true, 'sem novo dono não confirma');
    // a Miss Rose não pode ser escolhida como novo dono (já é dela)
    assert.equal(await page.locator('#ttDono option[value="MISS"]').isDisabled(), true);
    await page.selectOption('#ttDono', 'KURYOS');
    assert.equal(await page.locator('#ttConfirmar').isDisabled(), true, 'sem motivo não confirma');
    assert.match(await page.locator('#ttResumo').innerText(), /motivo/);
    await page.fill('#ttMotivo', 'Remessa da Miss Rose foi comprada pela Kuryos');
    await page.fill('#ttQtd', '605');
    assert.match(await page.locator('#ttResumo').innerText(), /605 un de ET-00069 \(saldo sem lote\): MISS ROSE → Kuryos \(estoque geral\)/);
    await page.fill('#ttQtd', '9999');
    assert.match(await page.locator('#ttResumo').innerText(), /Corrija o saldo|passa|menos que/);
    assert.equal(await page.locator('#ttConfirmar').isDisabled(), true);
    await page.fill('#ttQtd', '605');
    await page.click('#ttConfirmar');
    await page.waitForFunction(() => /✓ 605 un de ET-00069/.test(document.getElementById('resultado').innerText));
    let d = await db();
    assert.equal(d.estoque['ET-00069'].porCliente.MISS.saldoAtual, 1000);
    assert.equal(d.estoque['ET-00069'].saldoAtual, 1605, 'o total físico não muda');
    assert.equal(Object.values(d.estoque['ET-00069'].trocasTitularidade)[0].por, 'Gustavo');
    assert.equal(Object.values(d.movimentos_estoque['ET-00069'])[0].tipo, 'troca_titularidade');
    assert.match(await page.locator('#donos').innerText(), /605/, 'a tela mostra o geral da Kuryos com 605');
    assert.match(await page.locator('#historico').innerText(), /ET-00069[\s\S]*605[\s\S]*MISS ROSE → Kuryos/);

    // ET-00071: lote em quarentena da Kuryos; 400 passam para a FEBELLA (divide o lote no mesmo endereço)
    await page.fill('#busca', 'febella');
    await page.click('#resultados [data-item="ET-00071"]');
    await page.waitForSelector('#lotes [data-lote]');
    assert.match(await page.locator('#lotes').innerText(), /AK-2026-000650[\s\S]*GAL-2\.1\.1[\s\S]*2\.096[\s\S]*Kuryos \(geral\)[\s\S]*FEBELLA BEAUTY · PED-0010/);
    await page.click('#lotes [data-lote="AK-2026-000650"]');
    await page.waitForSelector('.tt-modal');
    await page.fill('#ttQtd', '400');
    await page.selectOption('#ttDono', 'FEB');
    await page.fill('#ttMotivo', 'Cliente assumiu 400 caixas');
    assert.match(await page.locator('#ttResumo').innerText(), /dividindo o lote/);
    if (process.env.TT_SHOT) await page.screenshot({path: process.env.TT_SHOT + '_modal.png', fullPage: true});
    await page.click('#ttConfirmar');
    await page.waitForFunction(() => /✓ 400 un de ET-00071/.test(document.getElementById('resultado').innerText));
    d = await db();
    const ls = d.estoque_lotes['ET-00071'];
    assert.equal(ls['AK-2026-000650'].saldoLote, 1696);
    const filho = Object.values(ls).find((l) => l.origemTipo === 'titularidade');
    assert.deepEqual([filho.saldoLote, filho.propriedade.clienteKey, filho.enderecoKey, filho.loteInterno, filho.status], [400, 'FEB', 'GAL-2-1-1', 'AK-2026-000650', 'QUARENTENA']);
    assert.equal(d.estoque['ET-00071'].porCliente.FEB.saldoAtual, 400);
    assert.equal((await page.locator('#lotes tr').count()), 2, 'dois lotes na tela: o que ficou e o novo');
    if (process.env.TT_SHOT) await page.screenshot({path: process.env.TT_SHOT + '_item.png', fullPage: true});
    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));

    // Quem não tem o módulo não entra na página
    const d2 = dados(); d2.usuarios.u1 = {nome: 'Carlos', email: 'c@kuryos.com', role: 'logistica'};
    const outro = await abrir(browser, 'u1', d2, 'titularidade.html').catch((e) => ({erro: e}));
    if (!outro.erro) {
      await outro.page.waitForTimeout(1500);
      assert.ok(!/titularidade\.html$/.test(new URL(outro.page.url()).pathname) || (await outro.page.locator('#busca').count()) === 0, 'logística não vê a tela');
    }
    console.log('OK Titularidade (tela): busca, saldo sem lote, lote inteiro/parcial, pré-visualização, motivo obrigatório, histórico e acesso por módulo.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
