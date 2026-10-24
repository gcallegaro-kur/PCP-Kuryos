'use strict';
/* Tela Movimentar (WMS, 29/09) de ponta a ponta: tela real com utils.js
   (transferirLoteEndereco / separarParcialLoteEndereco de verdade),
   seletor-endereco.js e auth_check.js; Firebase simulado em memória
   (mesmo harness de run_manipulacao_ui_test.js). */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  const ends = {};
  [['DOC-1-1-1','DOC-1.1.1','DOCA',1,1,1],['GAL-2-1-1','GAL-2.1.1','GALPÃO',2,1,1],['GAL-4-3-15','GAL-4.3.15','GALPÃO',4,3,15],['GAL-3-3-9','GAL-3.3.9','GALPÃO',3,3,9],
   ['GAL-3-3-11','GAL-3.3.11','GALPÃO',3,3,11],['GAL-3-2-8','GAL-3.2.8','GALPÃO',3,2,8],['GAL-1-1-1','GAL-1.1.1','GALPÃO',1,1,1]].forEach(([k, c, a, r, p, n]) => { ends[k] = {codigo: c, area: a, rua: r, predio: p, nivel: n, ativo: true}; });
  ends['GAL-9-9-9'] = {codigo: 'GAL-9.9.9', area: 'GALPÃO', rua: 9, predio: 9, nivel: 9, ativo: false};
  return {
    usuarios: {log: {nome: 'Carlos Logística', email: 'log@kuryos.com', role: 'logistica'}},
    config: {motivosMovimentoEstoque: [{ativo: true, nome: 'TRANSFERÊNCIA ENTRE ENDEREÇOS'}]},
    enderecos_estoque: ends,
    estoque_lotes: {
      'ET-00071': {'AK-2026-000650': {itemCodigo: 'ET-00071', itemNome: 'CAIXA DE EMBARQUE 48 UNID. BODY SPLASH FEBELLA 200ML', itemTipo: 'material', saldoLote: 2096, qtdOriginal: 2096, unidade: 'un',
        loteInterno: 'AK-2026-000650', loteOrigem: 'NÃO INFORMADO', enderecoKey: 'GAL-2-1-1', enderecoCodigo: 'GAL-2.1.1', status: 'QUARENTENA', dataRecebimento: '2026-10-23',
        propriedade: {tipo: 'KURYOS'}, destino: {clienteKey: 'FEBELLABEAUTY', clienteNome: 'FEBELLA BEAUTY', pedidos: ['PED-0010']}}},
      'MP-1': {a: {itemCodigo: 'MP-1', itemNome: 'ÁLCOOL CEREAL', itemTipo: 'material', saldoLote: 90, unidade: 'kg', loteInterno: 'AK-2026-000001', enderecoKey: 'GAL-1-1-1', enderecoCodigo: 'GAL-1.1.1', status: 'LIBERADO', dataValidade: '2027-01-01'}}
    },
    estoque: {
      'ET-00071': {materialCodigo: 'ET-00071', materialNome: 'CAIXA DE EMBARQUE 48 UNID. BODY SPLASH FEBELLA 200ML', saldoAtual: 2096, unidade: 'un'},
      'ET-00069': {materialCodigo: 'ET-00069', materialNome: 'CAIXA DE EMBARQUE BODY SPLASH ARABE 371X280X197 200ML', saldoAtual: 1605, unidade: 'un', porCliente: {MISS: {clienteNome: 'MISS ROSE', saldoAtual: 1605}}}
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
    const {page, errors} = await abrir(browser, 'log', dados(), 'movimentar.html');
    const db = () => page.evaluate(() => window.__db);
    await page.waitForSelector('#buscaItem');
    await page.waitForFunction(() => document.getElementById('btnDoca') && !document.getElementById('btnDoca').disabled);

    // ET-00069: tem saldo e nenhum lote -> não dá para mover, mas a busca avisa onde resolver
    await page.fill('#buscaItem', 'et-00069');
    const sl = await page.locator('#buscaResultados').innerText();
    assert.match(sl, /sem posição no WMS/); assert.match(sl, /ET-00069/); assert.match(sl, /1\.605 un/);
    assert.equal(await page.locator('#buscaResultados a[href="estoque.html?tab=enderecamento"]').count(), 1);
    assert.equal(await page.locator('#buscaResultados [data-lote]').count(), 0);
    // Busca pelo item: nome, sem acento/caixa; leva ao passo 2
    await page.fill('#buscaItem', 'alcool');
    assert.match(await page.locator('#buscaResultados').innerText(), /MP-1[\s\S]*AK-2026-000001[\s\S]*GAL-1\.1\.1/);
    await page.fill('#buscaItem', 'caixa 48 FEBELLA');
    assert.equal(await page.locator('#buscaResultados [data-lote]').count(), 1);
    const txt = await page.locator('#buscaResultados').innerText();
    assert.match(txt, /ET-00071/); assert.match(txt, /2\.096 un/); assert.match(txt, /GAL-2\.1\.1/);
    await page.fill('#buscaItem', 'nao existe xyz');
    assert.match(await page.locator('#buscaResultados').innerText(), /Nenhum lote com saldo e posição/);
    await page.fill('#buscaItem', 'et-00071');
    await page.click('#buscaResultados [data-lote]');
    await page.waitForSelector('#passoOque:not([hidden])');
    assert.match(await page.locator('#deEscolhido').innerText(), /GAL-2\.1\.1/);
    assert.match(await page.locator('#oqueResumo').innerText(), /1 de 1 lote/);
    assert.equal(await page.inputValue('#buscaItem'), '', 'busca limpa depois de escolher');

    // Dividir em paletes
    await page.click('#btnDividir');
    await page.waitForSelector('#passoDividir:not([hidden])');
    assert.equal(await page.locator('#passoPara').isVisible(), false, 'o passo "Para onde" dá lugar à divisão');
    assert.equal(await page.locator('#divLista .mv-div-linha').count(), 2);
    await page.click('#divAdd'); await page.click('#divAdd');
    assert.equal(await page.locator('#divLista .mv-div-linha').count(), 4);
    await page.fill('[data-dq="0"]', '3000');
    await page.fill('[data-dc="0"]', 'GAL-4.3.15'); await page.press('[data-dc="0"]', 'Enter');
    assert.match(await page.locator('#confErros').innerText(), /passa do saldo/);
    assert.equal(await page.locator('#btnMover').isDisabled(), true);
    assert.match(await page.locator('#divFalta').innerText(), /Passou do saldo/);
    await page.fill('[data-dq="0"]', '600');
    await page.fill('[data-dc="1"]', 'XYZ-1'); await page.press('[data-dc="1"]', 'Enter');
    assert.match(await page.locator('#divLista').innerText(), /Código não reconhecido/);
    await page.fill('[data-dc="1"]', 'GAL-9.9.9'); await page.press('[data-dc="1"]', 'Enter');
    assert.match(await page.locator('#divLista').innerText(), /bloqueada/);
    assert.equal(await page.locator('#btnMover').isDisabled(), true);
    await page.fill('[data-dq="1"]', '600');
    await page.fill('[data-dc="1"]', 'GAL-4.3.15'); await page.press('[data-dc="1"]', 'Enter');
    assert.match(await page.locator('#confErros').innerText(), /já foi usada/);
    await page.fill('[data-dc="1"]', 'GAL-3.3.9'); await page.press('[data-dc="1"]', 'Enter');
    await page.fill('[data-dq="2"]', '606');
    await page.fill('[data-dc="2"]', 'GAL-3.3.11'); await page.press('[data-dc="2"]', 'Enter');
    await page.click('[data-dresto="3"]');
    assert.equal(await page.inputValue('[data-dq="3"]'), '290', 'usar o que falta');
    await page.fill('[data-dc="3"]', 'GAL-3.2.8'); await page.press('[data-dc="3"]', 'Enter');
    assert.match(await page.locator('#divFalta').innerText(), /fechou/);
    assert.match(await page.locator('#confResumo').innerText(), /Dividir ET-00071 \(AK-2026-000650\) em 4 palete\(s\): 600 → GAL-4\.3\.15; 600 → GAL-3\.3\.9; 606 → GAL-3\.3\.11; 290 → GAL-3\.2\.8/);
    assert.equal(await page.locator('#btnMover').innerText(), 'Dividir em 4 palete(s)');
    if (process.env.MOV_SHOT) await page.screenshot({path: process.env.MOV_SHOT + '_divisao.png', fullPage: true});
    await page.click('#btnMover');
    await page.waitForFunction(() => /✓ Dividido em 4 palete/.test(document.getElementById('resultado').innerText));
    const d = await db();
    const lotes = d.estoque_lotes['ET-00071'];
    assert.equal(lotes['AK-2026-000650'].saldoLote, 0, 'o lote de origem zera (e continua registrado)');
    const novos = Object.entries(lotes).filter(([k]) => k !== 'AK-2026-000650').map(([, l]) => l);
    assert.deepEqual(novos.map((l) => [l.enderecoCodigo, l.saldoLote]).sort(), [['GAL-3.2.8', 290], ['GAL-3.3.11', 606], ['GAL-3.3.9', 600], ['GAL-4.3.15', 600]]);
    assert.equal(novos.reduce((s, l) => s + l.saldoLote, 0), 2096, 'a soma fecha com o recebido');
    novos.forEach((l) => {
      assert.equal(l.loteInterno, 'AK-2026-000650', 'mesmo lote interno');
      assert.equal(l.status, 'QUARENTENA', 'herda a quarentena');
      assert.equal(l.destino.clienteKey, 'FEBELLABEAUTY', 'destino do cliente segue o palete');
      assert.equal(l.origemTipo, 'movimentacao');
    });
    const movs = Object.values(d.movimentos_estoque['ET-00071']);
    assert.equal(movs.length, 4); assert.ok(movs.every((m) => m.tipo === 'transferencia' && m.autor === 'Carlos Logística'));
    assert.equal(await page.locator('#passoDividir').isVisible(), false, 'volta ao passo 1');
    assert.deepEqual(errors, [], 'erros na tela: ' + errors.join(' | '));
    console.log('OK Movimentar: busca pelo item e divisão de um lote em vários paletes (2.096 = 600 + 600 + 606 + 290).');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
