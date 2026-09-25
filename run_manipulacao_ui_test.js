'use strict';
/* Manipulação (fase de granel do lote): pesagem baixa estoque, conferência é
   de outra pessoa, manipulação registra tempos/perdas e o granel vai para a
   Qualidade. Tela real com utils.js, propriedade-estoque.js, manipulacao.js e
   auth_check.js; Firebase simulado em memória. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    usuarios: {
      pes: {nome: 'Operador João', email: 'joao@kuryos.com', role: 'production'},
      man: {nome: 'Manipuladora Ana', email: 'ana@kuryos.com', role: 'production'},
      cq: {nome: 'Daiene', email: 'cq@kuryos.com', role: 'qualidade'}
    },
    config: {linhas: ['Linha 1']},
    ops: {
      '26260-01': {lote: '26260/01', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR DAS TAMARAS',
        cliente: 'MISS RÔSE', status: 'Programado', qtdPlanejada: 1000, dataEmissao: '2026-09-17T08:00:00'},
      '26260-02': {lote: '26260/02', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR DAS TAMARAS',
        cliente: 'MISS RÔSE', status: 'Concluído', qtdPlanejada: 500}
    },
    produtos: {MRARBS04: {sku: 'MRARBS04', descricao: 'BODY SPLASH NÉCTAR DAS TAMARAS', cliente: 'MISS RÔSE',
      clienteKey: 'MISS', volume: 200, unidadeVolume: 'ml', densidadeGranel: 0.9}},
    formulas: {MRARBS04__v1: {codProduto: 'MRARBS04', versao: 'v1', status: 'APROVADA', itens: {
      i1: {mpCodigo: 'MPGR-001', mpNome: 'ALCOOL CEREAIS', percentualMM: 60},
      i2: {mpCodigo: 'MPGR-002', mpNome: 'AGUA DEIONIZADA', percentualMM: 35},
      i3: {mpCodigo: 'MPES-003', mpNome: 'FRAGRANCIA LEAO', percentualMM: 5}}}},
    bom: {MRARBS04__v1: {codProduto: 'MRARBS04', versao: 'v1', status: 'APROVADA', itens: {
      b1: {materialCodigo: 'EP-00106', materialNome: 'FRASCO 200ML', qtdPorPeca: 1}}}},
    materiais: {
      'MPGR-001': {mpCodigo: 'MPGR-001', unidade: 'kg'}, 'MPGR-002': {mpCodigo: 'MPGR-002', unidade: 'kg'},
      'MPES-003': {mpCodigo: 'MPES-003', unidade: 'kg'}, 'EP-00106': {mpCodigo: 'EP-00106', unidade: 'un'}
    },
    estoque: {
      'MPGR-001': {saldoAtual: 500, materialNome: 'ALCOOL CEREAIS'},
      'MPGR-002': {saldoAtual: 500}, 'MPES-003': {saldoAtual: 100}
    },
    // WMS com dois lotes do álcool: o FEFO manda usar o que vence antes.
    enderecos_estoque: {
      'FAB-1-1-1': {codigo: 'FAB-1.1.1', area: 'FABRICA', ativo: true},
      'FAB-2-1-1': {codigo: 'FAB-2.1.1', area: 'FABRICA', ativo: true}
    },
    estoque_lotes: {'MPGR-001': {
      L590: {itemCodigo: 'MPGR-001', itemTipo: 'material', status: 'LIBERADO', saldoLote: 100, loteInterno: 'AK-2026-000590',
        dataValidade: '2027-06-30', enderecoKey: 'FAB-2-1-1', enderecoCodigo: 'FAB-2.1.1'},
      L576: {itemCodigo: 'MPGR-001', itemTipo: 'material', status: 'LIBERADO', saldoLote: 60, loteInterno: 'AK-2026-000576',
        dataValidade: '2027-01-31', enderecoKey: 'FAB-1-1-1', enderecoCodigo: 'FAB-1.1.1'}}},
    movimentos_estoque: {}, nao_conformidades: {}, pedidos_compra: {}, fornecedores: {},
    especificacoes: {MRARBS04__v1: {codProduto: 'MRARBS04', itens: {
      e1: {ensaio: 'ASPECTO', especificacaoTexto: 'LÍQUIDO', metodo: 'PA09', critico: false},
      e2: {ensaio: 'PH', especificacaoTexto: '5 - 7', minimo: 5, maximo: 7, metodo: 'PA01', critico: true},
      // Sem faixa cadastrada: o campo numérico ficava desabilitado e a
      // densidade do bulk não tinha onde ser apontada (25/09).
      e3: {ensaio: 'DENSIDADE', especificacaoTexto: 'N/A', metodo: 'PA02', critico: false}}}},
    parametros_pa: {}
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

async function campo(page, seletor, valor) {
  const el = page.locator(seletor);
  await el.fill(valor);
  await el.dispatchEvent('change');
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // ── Operador da pesagem ─────────────────────────────────────────────
    const {page, errors} = await abrir(browser, 'pes');
    const linha = page.locator('#mListaBody tr', {hasText: '26260/01'});
    await linha.waitFor({timeout: 8000});
    assert.match(await linha.innerText(), /sem fase/);
    assert.equal(await page.locator('#mListaBody tr', {hasText: '26260/02'}).count(), 0, 'OP concluída não aparece');
    // Dossiê é ferramenta de gestão (Qualidade/PCP): o operador não vê.
    assert.equal(await page.locator('.kt-sidebar a[href="dossie_lote.html"]').count(), 0, 'operador sem Dossiê no menu');
    assert.equal(await page.locator('#mDossie').count(), 0, 'sem botão de dossiê na tela do operador');

    await linha.locator('[data-abrir]').click();
    await page.waitForSelector('#mPainel');
    // A fórmula explode só o granel: 200ml x 1000 un x 0,9 = 180 kg.
    const lista = await page.locator('#mPesagemCards').innerText();
    assert.match(lista, /MPGR-001/);
    assert.match(lista, /MPES-003/);
    assert.doesNotMatch(lista, /EP-00106/, 'embalagem não entra na manipulação — é consumo do envase');
    assert.match(await page.locator('#mResumoTempos').innerText(), /Previsto 180/);
    // Ordem da fórmula, sempre a mesma (decisão do usuário em 18/09).
    assert.deepEqual(await page.$$eval('#mPesagemCards .pz-row', (bs) => bs.map((b) => b.getAttribute('data-abrir-mp'))),
      ['MPGR-001', 'MPGR-002', 'MPES-003']);

    // Antes de iniciar, a MP já mostra os lotes do FEFO, mas não pesa.
    await page.click('.pz-row[data-abrir-mp="MPGR-001"]');
    const antesTxt = await page.locator('#mPesagemCards').innerText();
    assert.match(antesTxt, /Lotes indicados \(FEFO\)/i);
    assert.match(antesTxt, /AK-2026-000576[\s\S]*FAB-1\.1\.1[\s\S]*AK-2026-000590/, 'vence antes, vem antes');
    assert.equal(await page.locator('#pzFoto').count(), 0, 'sem iniciar, não há câmera');
    await page.click('[data-voltar-lista]');

    await page.click('#mBtnIniciarPesagem');
    await page.waitForFunction(() => (window.__db.ops['26260-01'].manipulacao || {}).status === 'AGUARDANDO_PESAGEM');
    const plano = await page.evaluate(() => window.__db.ops['26260-01'].manipulacao.pesagem.planoLotes);
    assert.deepEqual(plano['MPGR-001'].map((x) => [x.loteInterno, x.qtd, x.enderecos[0]]),
      [['AK-2026-000576', 60, 'FAB-1.1.1'], ['AK-2026-000590', 48, 'FAB-2.1.1']], 'FEFO congelado no início: quanto de cada lote');
    assert.equal(plano['MPGR-002'], undefined, 'MP sem saldo por lote não tem plano');

    const foto = (nome) => ({name: nome, mimeType: 'image/jpeg', buffer: Buffer.alloc(2048, 7)});
    const parcelas = (mp) => page.evaluate((m) => Object.values(((((window.__db.ops['26260-01'].manipulacao || {}).pesagem || {}).parcelas || {})[m]) || {}), mp);
    async function abrirMp(mp) {
      if (await page.locator('[data-voltar-lista]').count()) await page.click('[data-voltar-lista]');
      await page.click('.pz-row[data-abrir-mp="' + mp + '"]');
      await page.waitForSelector('#pzFoto', {state: 'attached'});
    }
    // Foto primeiro: o botão da MP abre a câmera e, com a foto, o formulário.
    async function pesar(mp, arquivo, peso, opcoes) {
      const o = opcoes || {};
      const antes = (await parcelas(mp)).length;
      if (!o.jaNaTela) await abrirMp(mp);
      await page.setInputFiles('#pzFoto', foto(arquivo));
      await page.waitForSelector('#formParcela .fp-preview');
      await page.fill('#fpPeso', peso);
      if (o.lote != null) {
        if (await page.locator('#fpOutroLote').count()) await page.click('#fpOutroLote');
        await page.fill('#fpLote', o.lote);
      }
      if (o.motivo) await page.fill('#fpMotivo', o.motivo);
      const botao = o.proxima ? '#fpSalvarProxima' : '#fpSalvar';
      await page.waitForFunction((b) => !document.querySelector(b).disabled, botao);
      await page.click(botao);
      await page.waitForFunction(([m, n]) => Object.keys((window.__db.ops['26260-01'].manipulacao.pesagem.parcelas || {})[m] || {}).length === n,
        [mp, antes + 1], {timeout: 8000});
      await page.waitForFunction(() => !document.getElementById('formParcela'));
    }

    // Álcool: 108 kg = 60 do AK-576 (vence antes) + 48 do AK-590, lote já escolhido pelo FEFO.
    await abrirMp('MPGR-001');
    await page.setInputFiles('#pzFoto', foto('balanca alcool.jpg'));
    await page.waitForSelector('#formParcela');
    assert.match(await page.locator('#formParcela').innerText(), /Lote \(indicado pelo FEFO\)[\s\S]*AK-2026-000576[\s\S]*faltam 60 kg/i);
    assert.equal(await page.locator('#fpSalvar').isDisabled(), true, 'sem peso não salva');
    assert.match(await page.locator('#fpFaltando').innerText(), /peso/);
    await page.fill('#fpPeso', '60');
    await page.waitForFunction(() => !document.getElementById('fpSalvar').disabled);
    await page.click('#fpSalvar');
    await page.waitForFunction(() => Object.keys((window.__db.ops['26260-01'].manipulacao.pesagem.parcelas || {})['MPGR-001'] || {}).length === 1);
    const p1 = (await parcelas('MPGR-001'))[0];
    assert.equal(p1.peso, 60);
    assert.equal(p1.loteMaterial, 'AK-2026-000576', 'lote veio do FEFO, sem digitar');
    assert.ok(!p1.motivoForaFefo, 'lote do FEFO não pede motivo');
    assert.equal(p1.por, 'Operador João');
    assert.equal(p1.foto.enviadoPor, 'Operador João');
    assert.match(p1.foto.caminho, /^manipulacao\/26260-01\/\d+_MPGR-001_balanca_alcool\.jpg$/);
    assert.ok(await page.evaluate((c) => !!window.__arquivos[c], p1.foto.caminho), 'arquivo foi para o Storage');
    await page.waitForFunction(() => /Faltam\s*48 kg/i.test(document.getElementById('mPesagemCards').innerText));
    assert.match(await page.locator('#alertBox').innerText(), /1ª pesagem de MPGR-001: 60 kg\. Faltam 48 kg\./);

    // Outro lote que não o do FEFO: só com motivo.
    await page.setInputFiles('#pzFoto', foto('x.jpg'));
    await page.waitForSelector('#formParcela');
    assert.match(await page.locator('#formParcela').innerText(), /AK-2026-000590/, 'agora o FEFO indica o segundo lote');
    await page.fill('#fpPeso', '5');
    await page.click('#fpOutroLote');
    await page.fill('#fpLote', 'AK-2026-000999');
    await page.waitForFunction(() => /O FEFO indica/.test(document.getElementById('fpFaltando').innerText));
    assert.equal(await page.locator('#fpSalvar').isDisabled(), true, 'fora do FEFO sem motivo não salva');
    await page.click('#fpCancelar');

    // Segunda ida, com "Salvar e próxima": vai para a água.
    await pesar('MPGR-001', 'alcool 2.jpg', '48,0', {jaNaTela: true, proxima: true});
    assert.equal((await parcelas('MPGR-001'))[1].loteMaterial, 'AK-2026-000590');
    await page.waitForFunction(() => /MPGR-002/.test(document.querySelector('.pz-cab').innerText));

    // Guardar de volta: quem pesou é quem devolve a embalagem ao endereço.
    // O álcool voltou para OUTRO lugar -> o lote muda de endereço no WMS.
    await abrirMp('MPGR-001');
    assert.match(await page.locator('#mPesagemCards').innerText(), /Leve a embalagem de volta para FAB-1\.1\.1, FAB-2\.1\.1/);
    await page.click('[data-guardar-outro="MPGR-001"]');
    await page.selectOption('#pzEndereco', 'FAB-2-1-1');
    await page.click('[data-guardar="MPGR-001"][data-outro="1"]');
    await page.waitForFunction(() => ((window.__db.ops['26260-01'].manipulacao.pesagem.devolucoes || {})['MPGR-001'] || {}).em);
    const dev = await page.evaluate(() => window.__db.ops['26260-01'].manipulacao.pesagem.devolucoes['MPGR-001']);
    assert.equal(dev.por, 'Operador João');
    assert.equal(dev.enderecoCodigo, 'FAB-2.1.1');
    assert.equal(dev.mudou, true);
    assert.equal(dev.enderecoAnteriorCodigo, 'FAB-1.1.1', 'saiu do endereço do lote que mudou de lugar');
    const lotesDepois = await page.evaluate(() => window.__db.estoque_lotes['MPGR-001']);
    assert.equal(lotesDepois.L576.enderecoKey, 'FAB-2-1-1', 'o lote seguiu a embalagem no WMS');
    assert.equal(lotesDepois.L590.enderecoKey, 'FAB-2-1-1');
    assert.match(await page.locator('#mPesagemCards').innerText(), /Embalagem guardada em FAB-2\.1\.1/);

    // Água: sem saldo por lote no WMS -> digita o lote. Errou o peso (630):
    // cancela pelo menu "⋯" com motivo e pesa de novo.
    await abrirMp('MPGR-002');
    assert.match(await page.locator('#mPesagemCards').innerText(), /Sem saldo desta MP por lote/);
    await pesar('MPGR-002', 'agua.jpg', '630', {jaNaTela: true, lote: 'AK-2026-000577'});
    await page.waitForFunction(() => /Passou do previsto/i.test(document.getElementById('mPesagemCards').innerText));
    assert.equal(await page.locator('[data-cancelar-parcela]').count(), 0, 'cancelar fica escondido no menu');
    await page.click('[data-menu-parcela]');
    page.__respostaPrompt = 'Digitei 630 em vez de 63';
    await page.click('[data-cancelar-parcela^="MPGR-002|"]');
    await page.waitForFunction(() => Object.values(window.__db.ops['26260-01'].manipulacao.pesagem.parcelas['MPGR-002'])[0].canceladaEm);
    const cancelada = (await parcelas('MPGR-002'))[0];
    assert.equal(cancelada.motivoCancelamento, 'Digitei 630 em vez de 63');
    assert.equal(cancelada.canceladaPor, 'Operador João');
    assert.equal(cancelada.peso, 630, 'o registro não é apagado');
    await page.waitForSelector('.parcela.cancelada');
    await page.setInputFiles('#pzFoto', foto('agua 2.jpg'));
    await page.waitForSelector('#formParcela');
    assert.equal(await page.inputValue('#fpLote'), 'AK-2026-000577', 'sem FEFO, sugere o último lote usado');
    await page.fill('#fpPeso', '63');
    await page.click('#fpSalvar');
    await page.waitForFunction(() => Object.values(window.__db.ops['26260-01'].manipulacao.pesagem.parcelas['MPGR-002']).length === 2);
    await page.waitForFunction(() => /Completo/i.test(document.getElementById('mPesagemCards').innerText));

    // A lista cobra o que ainda falta guardar.
    await page.click('[data-voltar-lista]');
    assert.match(await page.locator('#mPesagemCards').innerText(), /guardar embalagem/, 'a lista cobra o que falta guardar');
    await page.click('.pz-row[data-abrir-mp="MPGR-002"]');
    await page.click('[data-guardar="MPGR-002"]');
    await page.waitForFunction(() => ((window.__db.ops['26260-01'].manipulacao.pesagem.devolucoes || {})['MPGR-002'] || {}).em);
    const devAgua = await page.evaluate(() => window.__db.ops['26260-01'].manipulacao.pesagem.devolucoes['MPGR-002']);
    assert.equal(devAgua.enderecoCodigo, null, 'MP fora do WMS: confirma sem endereço');
    assert.equal(devAgua.mudou, false);

    // Fragrância acima da tolerância: pede justificativa na própria MP.
    await pesar('MPES-003', 'fragrancia.jpg', '12', {lote: 'AK-2026-000578'});
    await page.waitForSelector('[data-just="MPES-003"]');
    // Arquivo que não é imagem é recusado antes de subir.
    await page.setInputFiles('#pzFoto', {name: 'planilha.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(100, 1)});
    await page.waitForFunction(() => /Só imagem/.test(document.getElementById('alertBox').innerText));
    assert.equal(await page.locator('#formParcela').count(), 0);
    await page.click('[data-voltar-lista]');
    await page.waitForFunction(() => /fora do previsto/.test(document.getElementById('mPesagemErros').innerText));
    assert.equal(await page.locator('#mBtnFecharPesagem').isDisabled(), true, 'sem justificativa não fecha');
    await page.click('.pz-row[data-abrir-mp="MPES-003"]');
    await page.fill('[data-just="MPES-003"]', 'Ajuste de fragrância autorizado pelo P&D');
    await page.click('[data-guardar="MPES-003"]');
    await page.waitForFunction(() => Object.keys(window.__db.ops['26260-01'].manipulacao.pesagem.devolucoes || {}).length === 3);
    await page.click('[data-voltar-lista]');
    await page.waitForFunction(() => !document.getElementById('mBtnFecharPesagem').disabled, null, {timeout: 8000});
    assert.doesNotMatch(await page.locator('#mPesagemCards').innerText(), /guardar embalagem/, 'tudo guardado');
    assert.equal(await page.locator('#mBtnFecharPesagem').innerText(), 'Fechar pesagem e baixar estoque');
    assert.match(await page.locator('#mPesagemCards').innerText(), /3 de 3 matérias-primas pesadas/);

    // Celular: o lote vira a tela, alvos grandes, campo de peso sem zoom.
    await page.setViewportSize({width: 390, height: 844});
    const lotesEscondidos = await page.evaluate(() => getComputedStyle(document.getElementById('mCardLista')).display);
    assert.equal(lotesEscondidos, 'none', 'no celular, com o lote aberto, a lista de lotes some');
    if (process.env.MANIP_SCREENSHOT) await page.screenshot({path: process.env.MANIP_SCREENSHOT.replace(/\.png$/, '_lista.png'), fullPage: true});
    await page.click('.pz-row[data-abrir-mp="MPGR-001"]');
    if (process.env.MANIP_SCREENSHOT) await page.screenshot({path: process.env.MANIP_SCREENSHOT.replace(/\.png$/, '_mp.png'), fullPage: false});
    await page.setInputFiles('#pzFoto', foto('y.jpg'));
    await page.waitForSelector('#formParcela');
    const cel = await page.evaluate(() => ({
      linha: document.querySelector('.pz-acoes .btn').getBoundingClientRect().height,
      fonte: parseFloat(getComputedStyle(document.getElementById('fpPeso')).fontSize),
      largura: document.documentElement.scrollWidth
    }));
    assert.ok(cel.linha >= 44, 'botões de ação com alvo de toque grande: ' + cel.linha);
    assert.ok(cel.fonte >= 16, 'campo de peso sem zoom automático do celular');
    assert.ok(cel.largura <= 390 + 4, 'sem rolagem horizontal no celular: ' + cel.largura);
    if (process.env.MANIP_SCREENSHOT) await page.screenshot({path: process.env.MANIP_SCREENSHOT.replace(/\.png$/, '_form.png'), fullPage: false});
    await page.click('#fpCancelar');
    await page.click('[data-voltar-lista]');
    await page.setViewportSize({width: 1500, height: 1200});

    await page.click('#mBtnFecharPesagem');
    await page.waitForFunction(() => (window.__db.ops['26260-01'].manipulacao || {}).status === 'PESADO', null, {timeout: 8000});
    let db = await page.evaluate(() => window.__db);
    const fase = db.ops['26260-01'].manipulacao;
    assert.equal(fase.pesagem.por, 'Operador João');
    assert.equal(fase.pesagem.baixaAplicada, true);
    assert.equal(fase.pesagem.itens['MPGR-001'].pesado, 108, 'soma das duas pesagens');
    assert.equal(fase.pesagem.itens['MPGR-001'].loteMaterial, 'AK-2026-000576, AK-2026-000590');
    assert.equal(fase.pesagem.itens['MPGR-001'].parcelas, 2);
    assert.equal(fase.pesagem.itens['MPGR-002'].pesado, 63, 'a cancelada não soma');
    assert.equal(fase.pesagem.itens['MPES-003'].justificativa, 'Ajuste de fragrância autorizado pelo P&D');
    // A baixa de estoque acontece na pesagem (decisão do usuário em 17/09).
    assert.equal(db.estoque['MPGR-001'].saldoAtual, 392, '500 − 108');
    assert.equal(db.estoque['MPGR-002'].saldoAtual, 437, '500 − 63, sem os 630 cancelados');
    assert.equal(db.estoque['MPES-003'].saldoAtual, 88, '100 − 12');
    // E sai de CADA lote pesado, não de um lote qualquer.
    assert.equal(db.estoque_lotes['MPGR-001'].L576.saldoLote, 0, 'AK-576: 60 − 60');
    assert.equal(db.estoque_lotes['MPGR-001'].L590.saldoLote, 52, 'AK-590: 100 − 48');
    const movs = Object.values(db.movimentos_estoque['MPGR-001'] || {});
    assert.ok(movs.some((m) => /MANIPULAÇÃO/.test(m.motivo || '')), 'movimento registrado');
    assert.ok(movs.some((m) => m.loteKey === 'L590' && m.qtd === -48), 'movimento do AK-590 com os 48 kg');
    assert.equal(await page.locator('#pzFoto').count(), 0, 'pesagem fechada não aceita mais pesagem');
    assert.match(await page.locator('#mConferenciaBody').innerText(), /em 2 pesagens/);

    // Quem pesou não pode conferir.
    assert.match(await page.locator('#mConferenciaBody').innerText(), /MPGR-001/);
    await page.click('[data-conf="MPGR-001"][data-valor="sim"]');
    await page.click('[data-conf="MPGR-002"][data-valor="sim"]');
    await page.click('[data-conf="MPES-003"][data-valor="sim"]');
    assert.match(await page.locator('#mConferenciaErros').innerText(), /não pode ser quem pesou/);
    assert.equal(await page.locator('#mBtnConferir').isDisabled(), true);
    const estadoDb = await page.evaluate(() => window.__db);
    await page.close();

    // ── Manipuladora: confere e manipula ────────────────────────────────
    // Outra pessoa, outra sessão — recebe o banco como o pesador o deixou.
    const r2 = await abrir(browser, 'man', estadoDb);
    await r2.page.waitForFunction(() => window.currentUser && window.currentUser.nome === 'Manipuladora Ana');
    const linha2 = r2.page.locator('#mListaBody tr', {hasText: '26260/01'});
    await linha2.waitFor({timeout: 8000});
    assert.match(await linha2.innerText(), /aguardando conferência/i);
    await linha2.locator('[data-abrir]').click();
    await r2.page.waitForSelector('#mConferenciaBody');

    // Divergência trava a manipulação e exige descrição.
    await r2.page.click('[data-conf="MPGR-001"][data-valor="sim"]');
    await r2.page.click('[data-conf="MPGR-002"][data-valor="sim"]');
    await r2.page.click('[data-conf="MPES-003"][data-valor="nao"]');
    await r2.page.waitForFunction(() => /precisa de descrição/.test(document.getElementById('mConferenciaErros').innerText));
    assert.equal(await r2.page.locator('#mBtnConferir').isDisabled(), true);
    await r2.page.click('[data-conf="MPES-003"][data-valor="sim"]');
    await r2.page.waitForFunction(() => !document.getElementById('mBtnConferir').disabled);
    await r2.page.click('#mBtnConferir');
    await r2.page.waitForFunction(() => window.__db.ops['26260-01'].manipulacao.status === 'CONFERIDO');
    let db2 = await r2.page.evaluate(() => window.__db);
    assert.equal(db2.ops['26260-01'].manipulacao.conferencia.por, 'Manipuladora Ana');

    await r2.page.click('#mBtnIniciarManipulacao');
    await r2.page.waitForFunction(() => window.__db.ops['26260-01'].manipulacao.status === 'EM_MANIPULACAO');

    // Rendimento maior que o pesado é impossível.
    await campo(r2.page, '#mRendimento', '300');
    await r2.page.waitForFunction(() => /maior que o total pesado/.test(document.getElementById('mManipulacaoErros').innerText));
    assert.equal(await r2.page.locator('#mBtnFecharManipulacao').isDisabled(), true);

    await campo(r2.page, '#mRendimento', '178');
    await campo(r2.page, '#mPerdaResiduo', '3');
    await r2.page.waitForFunction(() => /Perda de processo/.test(document.getElementById('mManipulacaoResumo').innerText));
    assert.match(await r2.page.locator('#mManipulacaoResumo').innerText(), /5 kg/);
    await r2.page.click('#mBtnFecharManipulacao');
    await r2.page.waitForFunction(() => window.__db.ops['26260-01'].manipulacao.status === 'AGUARDANDO_CQ', null, {timeout: 8000});

    db2 = await r2.page.evaluate(() => window.__db);
    const f2 = db2.ops['26260-01'].manipulacao;
    assert.equal(f2.manipulacao.rendimento, 178);
    assert.equal(f2.manipulacao.perdas.residuo_tacho, 3);
    assert.ok(f2.manipulacao.inicio && f2.manipulacao.fim, 'tempos da manipulação gravados');
    assert.ok(f2.pesagem.inicio && f2.pesagem.fim, 'tempos da pesagem gravados');
    assert.match(await r2.page.locator('#mBlocoCq').innerText(), /envase deste lote fica travado/);

    const estadoParaCq = await r2.page.evaluate(() => window.__db);
    await r2.page.close();

    // ── Qualidade analisa o granel ──────────────────────────────────────
    const cq = await abrir(browser, 'cq', estadoParaCq, 'qualidade.html');
    const linhaGranel = cq.page.locator('#qGranelBody tr', {hasText: '26260/01'});
    await linhaGranel.waitFor({timeout: 8000});
    assert.match(await linhaGranel.innerText(), /178/, 'mostra o rendimento');
    await linhaGranel.locator('[data-granel]').click();
    await cq.page.waitForSelector('#modalGranelBg.open');
    assert.match(await cq.page.locator('#qGranelInfo').innerText(), /Pesagem por Operador João/);
    assert.match(await cq.page.locator('#qGranelInfo').innerText(), /conferida por Manipuladora Ana/);
    assert.match(await cq.page.locator('#qGranelInfo').innerText(), /Fotos da pesagem: .*MPGR-001.*MPES-003|Fotos da pesagem: .*MPES-003/, 'a auditoria vê a foto de cada MP');
    assert.doesNotMatch(await cq.page.locator('#qGranelInfo').innerText(), /sem foto/);
    const ensaios = await cq.page.locator('#qGranelPlanoBody').innerText();
    assert.match(ensaios, /ASPECTO/, 'a análise de granel usa a especificação do produto');
    assert.match(ensaios, /PH/);
    await cq.page.selectOption('[data-granel-cnc="e1"]', 'C');
    await cq.page.fill('[data-granel-valor="e2"]', '6');
    await cq.page.locator('[data-granel-valor="e2"]').dispatchEvent('change');
    assert.equal(await cq.page.locator('[data-granel-valor="e3"]').isEnabled(), true, 'densidade apontável mesmo sem faixa');
    await cq.page.fill('[data-granel-valor="e3"]', '0.872');
    await cq.page.locator('[data-granel-valor="e3"]').dispatchEvent('change');
    await cq.page.selectOption('[data-granel-cnc="e3"]', 'C');
    const avisosCq = [];
    cq.page.on('dialog', (d) => avisosCq.push(d.message()));
    await cq.page.click('#qGranelLiberar');
    await cq.page.waitForFunction(() => window.__db.ops['26260-01'].manipulacao.status === 'LIBERADO', null, {timeout: 8000});
    const dbCq = await cq.page.evaluate(() => window.__db);
    assert.equal(dbCq.ops['26260-01'].manipulacao.analise.por, 'Daiene');
    assert.equal(String(dbCq.ops['26260-01'].manipulacao.analise.ensaios.e2.valor), '6');
    assert.equal(String(dbCq.ops['26260-01'].manipulacao.analise.ensaios.e3.valor), '0.872', 'densidade do bulk gravada para a pesagem do PA');
    assert.ok(!avisosCq.some((m) => /densidade do bulk não foi apontada/.test(m)), 'com densidade, não pergunta');
    assert.deepEqual(cq.errors, [], 'erros na tela da Qualidade: ' + cq.errors.join(' | '));
    await cq.page.close();

    // ── Dossiê do lote: a auditoria acha tudo pelo lote, cliente ou nome ─
    const dossie = await abrir(browser, 'cq', dbCq, 'dossie_lote.html?op=26260-01');
    await dossie.page.waitForFunction(() => /Ordem de manipulação/i.test((document.getElementById('dossie') || {}).innerText || ''), null, {timeout: 8000});
    const txt = await dossie.page.locator('#dossie').innerText();
    assert.match(txt, /Ordem de fabricação — lote 26260\/01/i);
    assert.match(txt, /MISS RÔSE/);
    assert.match(txt, /em 2 pesagens/);
    assert.match(txt, /AK-2026-000576, AK-2026-000590/);
    assert.match(txt, /Cancelada por Operador João: Digitei 630 em vez de 63/);
    assert.match(txt, /2ª pesagem de MPGR-001: 48 kg \(lote AK-2026-000590\) com foto/, 'linha do tempo');
    assert.match(txt, /Granel liberado/);
    assert.match(txt, /pesagem do granel/, 'consumo de MP vem da pesagem');
    assert.equal(await dossie.page.locator('#dossie .foto img').count(), 5, '2 do álcool + 2 da água (1 cancelada) + 1 da fragrância');
    assert.equal(await dossie.page.locator('#dossie .foto.cancelada').count(), 1);
    assert.equal(await dossie.page.locator('.kt-sidebar a[href="dossie_lote.html"]').count(), 1, 'Qualidade tem o Dossiê no menu');
    // Busca sem acento, por cliente e produto.
    await dossie.page.fill('#dBusca', 'rose nectar');
    await dossie.page.waitForFunction(() => /2 lote/.test(document.getElementById('dResumoBusca').innerText));
    await dossie.page.fill('#dBusca', '26260 02');
    await dossie.page.waitForFunction(() => document.querySelectorAll('#dResultados tr[data-op]').length === 1);
    await dossie.page.click('#dResultados tr[data-op="26260-02"]');
    await dossie.page.waitForFunction(() => /não tem a fase de granel registrada/.test(document.getElementById('dossie').innerText));
    assert.deepEqual(dossie.errors, [], 'erros no dossiê: ' + dossie.errors.join(' | '));
    await dossie.page.close();

    // ── Apontamento: o envase só enxerga a OP depois da liberação ───────
    const envase = await abrir(browser, 'pes', estadoParaCq, 'form.html');
    await envase.page.waitForFunction(() => typeof Manipulacao !== 'undefined' && window.opsCache && window.opsCache['26260-01'], null, {timeout: 8000});
    const antes = await envase.page.evaluate(() => Manipulacao.podeEnvasar(opsCache['26260-01']));
    assert.equal(antes.ok, false, 'granel aguardando CQ trava o envase');
    await envase.page.evaluate((d) => { window.__db.ops['26260-01'].manipulacao.status = 'LIBERADO'; }, null);
    const depois = await envase.page.evaluate(() => Manipulacao.podeEnvasar({manipulacao: {status: 'LIBERADO'}}));
    assert.equal(depois.ok, true);
    await envase.page.close();

    assert.deepEqual(errors, [], 'erros na tela do pesador: ' + errors.join(' | '));
    assert.deepEqual(r2.errors, [], 'erros na tela do manipulador: ' + r2.errors.join(' | '));
    console.log('OK Manipulação: pesagem em parcelas com foto soma até o total, cancelada fica no registro, baixa estoque; dossiê do lote acha e mostra tudo; pesagem baixa estoque e exige lote/justificativa, conferência é de outra pessoa, manipulação grava tempos, perdas e rendimento, granel vai para a Qualidade.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
