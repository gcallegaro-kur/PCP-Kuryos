'use strict';
/* Módulo Operação (2026-09-23): Produção / Manipulação / Rotulagem.
   Telas reais (auth_check.js, manipulacao.html, historico.html, form.html,
   estoque_setor.html) com Firebase simulado em memória:
   1. acessos: padrão por perfil, marcação antiga herdando os setores novos,
      desmarcar de verdade, quem confere a pesagem, quem edita apontamento;
   2. menu "Operação" por setor;
   3. Conferência de Pesagem ligada: manipulador não confere, Qualidade confere
      com o próprio login, admin libera com motivo;
   4. histórico: Rotulagem vê só a rotulagem e não edita; PCP vê tudo e edita;
   5. apontamento: cada setor vê só a sua seção do painel de turno;
   6. estoque por setor: só as áreas do setor, material das OPs com o que foi
      separado, configuração de áreas pelo admin. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function hojeLocal() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const HOJE = hojeLocal();

function dados() {
  return {
    usuarios: {
      adm: {nome: 'Gustavo', email: 'adm@kuryos.com', role: 'admin'},
      pcp: {nome: 'PCP', email: 'pcp@kuryos.com', role: 'pcp'},
      prod: {nome: 'Operador Linha', email: 'linha@kuryos.com', role: 'production'},
      rot: {nome: 'Operadora Rótulo', email: 'rot@kuryos.com', role: 'rotulagem'},
      man: {nome: 'Manipulador Caio', email: 'caio@kuryos.com', role: 'production', modulos: {manipulacao: true}},
      pes: {nome: 'Pesador Davi', email: 'davi@kuryos.com', role: 'production', modulos: {manipulacao: true}},
      cq: {nome: 'Roberta', email: 'roberta@kuryos.com', role: 'qualidade'},
      pd: {nome: 'Yasmim Fantini', email: 'yasmim@kuryos.com', role: 'production', modulos: {conferencia_pesagem: true}},
      antigo: {nome: 'Marcação antiga', email: 'antigo@kuryos.com', role: 'production', modulos: {apontamento: true}},
      soLinha: {nome: 'Só linha', email: 'sl@kuryos.com', role: 'production', modulos: {apontamento: true, manipulacao: false, rotulagem: false}}
    },
    config: {linhas: ['Linha 1'], rotulagem: ['Rotuladora 1'], postosTrabalho: ['Posto A'], turnos: ['1º Turno'],
      conferenciaPesagem: {ativa: true, alteradoPor: 'Gustavo', alteradoEm: '2026-09-23T10:00:00Z'},
      areasEndereco: [{nome: 'FÁBRICA', sigla: 'FAB'}, {nome: 'RÓTULOS', sigla: 'ROT'}, {nome: 'MATÉRIA PRIMA', sigla: 'MP'}, {nome: 'GALPÃO', sigla: 'GAL'}]},
    ops: {
      '26260-01': {lote: '26260/01', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR', cliente: 'MISS RÔSE', status: 'Em Produção',
        qtdPlanejada: 1000, dataEmissao: '2026-09-20T08:00:00',
        materiaisConsumo: {m1: {mpCodigo: 'EP-00106', mpNome: 'FRASCO 200ML', quantidade: 1000, unidade: 'un'},
          m2: {mpCodigo: 'RT-00050', mpNome: 'ROTULO NECTAR', quantidade: 1000, unidade: 'un'}},
        manipulacao: {status: 'PESADO', pesagem: {por: 'Pesador Davi', inicio: '2026-09-23T11:00:00Z', fim: '2026-09-23T11:40:00Z',
          itens: {'MPGR-001': {pesado: 108, loteMaterial: 'AK-2026-000576'}, 'MPGR-002': {pesado: 63, loteMaterial: 'AK-2026-000601'},
            'MPES-003': {pesado: 9, loteMaterial: 'AK-2026-000610'}}}}},
      '26261-01': {lote: '26261/01', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR', cliente: 'MISS RÔSE', status: 'Programado',
        qtdPlanejada: 1000, dataEmissao: '2026-09-21T08:00:00',
        manipulacao: {status: 'PESADO', pesagem: {por: 'Pesador Davi', fim: '2026-09-23T12:00:00Z',
          itens: {'MPGR-001': {pesado: 108, loteMaterial: 'X'}, 'MPGR-002': {pesado: 63, loteMaterial: 'Y'}, 'MPES-003': {pesado: 9, loteMaterial: 'Z'}}}}},
      '26262-01': {lote: '26262/01', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR', cliente: 'MISS RÔSE', status: 'Programado',
        qtdPlanejada: 1000, dataEmissao: '2026-09-22T08:00:00'}
    },
    produtos: {MRARBS04: {sku: 'MRARBS04', descricao: 'BODY SPLASH NÉCTAR', cliente: 'MISS RÔSE', volume: 200, unidadeVolume: 'ml', densidadeGranel: 0.9}},
    formulas: {MRARBS04__v1: {codProduto: 'MRARBS04', versao: 'v1', status: 'APROVADA', itens: {
      i1: {mpCodigo: 'MPGR-001', mpNome: 'ALCOOL CEREAIS', percentualMM: 60},
      i2: {mpCodigo: 'MPGR-002', mpNome: 'AGUA DEIONIZADA', percentualMM: 35},
      i3: {mpCodigo: 'MPES-003', mpNome: 'FRAGRANCIA', percentualMM: 5}}}},
    bom: {MRARBS04__v1: {codProduto: 'MRARBS04', versao: 'v1', status: 'APROVADA', itens: {}}},
    materiais: {'MPGR-001': {mpCodigo: 'MPGR-001', unidade: 'kg'}, 'MPGR-002': {mpCodigo: 'MPGR-002', unidade: 'kg'}, 'MPES-003': {mpCodigo: 'MPES-003', unidade: 'kg'}},
    estoque: {'EP-00106': {saldoAtual: 3000, saldoEmpenhado: 1000, materialNome: 'FRASCO 200ML', empenhos: {'26260-01': {lote: '26260/01', qtdEmpenhada: 800}}}},
    enderecos_estoque: {
      'FAB-1-1-1': {codigo: 'FAB-1.1.1', area: 'FÁBRICA', ativo: true},
      'GAL-3-1-1': {codigo: 'GAL-3.1.1', area: 'GALPÃO', ativo: true},
      'ROT-1-1-1': {codigo: 'ROT-1.1.1', area: 'Rótulos', ativo: true}
    },
    estoque_lotes: {
      'EP-00106': {
        sep: {itemCodigo: 'EP-00106', itemNome: 'FRASCO 200ML', unidade: 'un', status: 'LIBERADO', saldoLote: 800, loteInterno: 'AK-2026-000700',
          enderecoKey: 'FAB-1-1-1', origemTipo: 'separacao_op', origemRef: '26260/01', dataValidade: '2030-01-01'},
        gal: {itemCodigo: 'EP-00106', itemNome: 'FRASCO 200ML', unidade: 'un', status: 'LIBERADO', saldoLote: 2200, loteInterno: 'AK-2026-000700',
          enderecoKey: 'GAL-3-1-1', dataValidade: '2030-01-01'},
        outraOp: {itemCodigo: 'EP-00106', unidade: 'un', status: 'LIBERADO', saldoLote: 50, loteInterno: 'AK-2026-000701',
          enderecoKey: 'FAB-1-1-1', origemTipo: 'separacao_op', origemRef: '99999/01'}
      },
      'RT-00050': {
        r1: {itemCodigo: 'RT-00050', itemNome: 'ROTULO NECTAR', unidade: 'un', status: 'QUARENTENA', saldoLote: 5000, loteInterno: 'AK-2026-000720',
          enderecoKey: 'ROT-1-1-1', dataValidade: '2020-01-01'},
        zero: {itemCodigo: 'RT-00050', status: 'LIBERADO', saldoLote: 0, enderecoKey: 'ROT-1-1-1'}
      }
    },
    registros: {[HOJE]: {
      a: {hora: '08_00', produto: 'BODY SPLASH NÉCTAR', linha: 'Linha 1', quantidade: 500, lote: '26260/01', tipo: 'registro', operador: 'Linha'},
      b: {hora: '09_00', produto: 'BODY SPLASH NÉCTAR', linha: 'Rotuladora 1', quantidade: 300, lote: '26260/01', tipo: 'registro', operador: 'Rótulo'},
      c: {hora: '10_00', produto: 'OUTRO', linha: 'Posto A', quantidade: 40, lote: '26262/01', tipo: 'registro', operador: 'Posto'}
    }},
    movimentos_estoque: {}, nao_conformidades: {}, pedidos: {}, estado_linhas: {}, perdas: {}, turnosIniciados: {}, atividadesPosto: {}
  };
}

async function abrir(browser, uid, estado, pagina, viewport) {
  const page = await browser.newPage({viewport: viewport || {width: 1500, height: 1100}});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? (page.__respostaPrompt || '') : undefined));
  await page.addInitScript(({data, quem}) => {
    const db = data;
    window.__db = db;
    window.__iniciado = false;
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
    const perfil = db.usuarios[quem];
    window.firebase = {
      apps: [],
      initializeApp(cfg) { window.__iniciado = true; window.firebase.apps.push(cfg); },
      auth() {
        return {currentUser: {uid: quem, email: perfil.email},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: quem, email: perfil.email, displayName: perfil.nome}), 0); },
          signOut() { return Promise.resolve(); }};
      },
      storage() { return {ref() { return {put: () => Promise.resolve(), getDownloadURL: () => Promise.resolve(''), delete: () => Promise.resolve()}; }}; },
      functions() { return {httpsCallable: () => () => Promise.resolve({data: {}})}; },
      database() {
        const ref = (path) => {
          const valor = () => { const v = ler(path); return v === undefined ? null : structuredClone(v); };
          const snap = () => { const v = valor(); return {val: () => v, exists: () => v !== null, key: partes(path).pop(),
            forEach(cb) { Object.entries(v || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
          return {path, key: partes(path).pop(),
            once(ev, cb) { const sn = snap(); if (cb) cb(sn); return Promise.resolve(sn); },
            on(ev, cb) { const avisar = () => cb(snap()); ouvintes.push({path, avisar}); setTimeout(avisar, 0); return cb; },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
            startAt() { return this; }, endAt() { return this; },
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
        return {ref: (p) => ref(p || ''), goOffline() {}, goOnline() {}};
      }
    };
    window.firebase.database.ServerValue = {TIMESTAMP: Date.now(), increment: (n) => n};
  }, {data: estado || dados(), quem: uid});
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'op.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://op.test/' + pagina);
  await page.waitForSelector('.kt-sidebar', {timeout: 10000});
  await page.waitForFunction(() => window.currentUser && window.currentUser.nome);
  return {page, errors};
}

async function linksDoMenu(page) {
  return page.$$eval('.kt-sidebar a.kt-nav-link', (as) => as.map((a) => a.getAttribute('href')));
}
async function textoOperacao(page) {
  return page.$$eval('.kt-nav-group', (gs) => {
    const g = gs.find((x) => (x.querySelector('.kt-nav-cap') || {}).textContent === 'Operação');
    return g ? g.innerText : '';
  });
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // ── 1. Acessos (as funções reais de auth_check.js) ───────────────────
    {
      const {page, errors} = await abrir(browser, 'adm', null, 'estoque_setor.html');
      const r = await page.evaluate(() => {
        const U = window.__db.usuarios;
        const mods = (u) => window.modulosDoUsuario(u).sort();
        return {
          prod: mods(U.prod), rot: mods(U.rot), man: mods(U.man), cq: mods(U.cq), antigo: mods(U.antigo), soLinha: mods(U.soLinha),
          abreManRot: window.podeAbrirPagina(U.rot, 'manipulacao.html'), abreFormRot: window.podeAbrirPagina(U.rot, 'form.html'),
          abreFormMan: window.podeAbrirPagina(U.man, 'form.html'), abreManMan: window.podeAbrirPagina(U.man, 'manipulacao.html'),
          abreManCq: window.podeAbrirPagina(U.cq, 'manipulacao.html'), abreManPd: window.podeAbrirPagina(U.pd, 'manipulacao.html'),
          abreHistRot: window.podeAbrirPagina(U.rot, 'historico.html'), abreEstRot: window.podeAbrirPagina(U.rot, 'estoque_setor.html'),
          confere: ['adm', 'pcp', 'prod', 'man', 'cq', 'pd'].map((k) => window.podeConferirPesagem(U[k])),
          edita: ['adm', 'pcp', 'prod', 'rot', 'man'].map((k) => window.podeEditarApontamentos(U[k])),
          homeMan: window.homeDoUsuario ? null : null
        };
      });
      assert.deepEqual(r.prod, ['analytics', 'apontamento', 'manipulacao', 'planejamento', 'rotulagem'], 'perfil Produção: os três setores');
      assert.deepEqual(r.rot, ['rotulagem'], 'perfil Rotulagem: só a Rotulagem');
      assert.deepEqual(r.man, ['manipulacao'], 'marcado só Manipulação');
      assert.deepEqual(r.cq, ['conferencia_pesagem', 'qualidade'], 'Qualidade confere a pesagem por padrão');
      assert.deepEqual(r.antigo, ['apontamento', 'manipulacao', 'rotulagem'], 'marcação antiga com Apontamento herda os setores novos');
      assert.deepEqual(r.soLinha, ['apontamento'], 'desmarcado (false gravado) não herda');
      assert.equal(r.abreManRot, false, 'Rotulagem não abre a Manipulação');
      assert.equal(r.abreFormRot, true);
      assert.equal(r.abreHistRot, true, 'Rotulagem consulta o próprio histórico');
      assert.equal(r.abreEstRot, true);
      assert.equal(r.abreFormMan, false, 'só Manipulação não abre o Apontamento');
      assert.equal(r.abreManMan, true);
      assert.equal(r.abreManCq, true, 'Qualidade abre a Manipulação para conferir');
      assert.equal(r.abreManPd, true, 'P&D marcado abre a Manipulação');
      assert.deepEqual(r.confere, [false, false, false, false, true, true], 'conferem: Qualidade e P&D marcados; admin não');
      assert.deepEqual(r.edita, [true, true, false, false, false], 'edita apontamento: só admin/PCP');
      assert.deepEqual(errors, []);
      await page.close();
    }

    // ── 2. Menu Operação ──────────────────────────────────────────────────
    {
      const {page, errors} = await abrir(browser, 'prod', null, 'estoque_setor.html');
      const menu = await textoOperacao(page);
      assert.match(menu, /Produção[\s\S]*Apontamento[\s\S]*Histórico de Apontamentos[\s\S]*Estoque da Fábrica/);
      assert.match(menu, /Manipulação[\s\S]*Pesagem e Manipulação[\s\S]*Estoque da Manipulação/);
      assert.match(menu, /Rotulagem[\s\S]*Estoque dos Rótulos/);
      assert.equal((await linksDoMenu(page)).filter((h) => h === 'form.html').length, 1, 'com Produção e Rotulagem, um Apontamento só');
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      const {page} = await abrir(browser, 'rot', null, 'estoque_setor.html?setor=rotulagem');
      const menu = await textoOperacao(page);
      assert.match(menu, /Rotulagem[\s\S]*Apontamento[\s\S]*Histórico de Apontamentos[\s\S]*Estoque dos Rótulos/);
      assert.doesNotMatch(menu, /Manipulação|Estoque da Fábrica/);
      await page.close();
    }
    {
      const {page} = await abrir(browser, 'pd', null, 'manipulacao.html');
      const menu = await textoOperacao(page);
      assert.match(menu, /Conferência de Pesagem/);
      assert.doesNotMatch(menu, /Estoque da Manipulação|Apontamento/);
      await page.close();
    }

    // ── 3. Conferência de Pesagem ligada ─────────────────────────────────
    const estado = dados();
    {
      // Manipulador: não confere, vê o aviso de que a Qualidade/P&D foi chamada.
      const {page, errors} = await abrir(browser, 'man', estado, 'manipulacao.html');
      const linha = page.locator('#mListaBody tr', {hasText: '26260/01'});
      await linha.waitFor();
      assert.match(await page.locator('#mCardLista h3').innerText(), /Lotes em produção/i);
      assert.match(await linha.innerText(), /Pesado/);
      await linha.locator('[data-abrir]').click();
      await page.waitForSelector('#mBlocoConferencia');
      assert.match(await page.locator('#mConfRegra').innerText(), /Conferência de Pesagem ligada/);
      assert.equal(await page.locator('#mConfAviso').isVisible(), true);
      assert.match(await page.locator('#mConfAviso').innerText(), /Qualidade ou o P&D/);
      assert.equal(await page.locator('#mBtnConferir').isVisible(), false, 'manipulador não confere');
      assert.equal(await page.locator('#mBtnLiberarSemConf').isVisible(), false, 'só admin libera');
      assert.equal(await page.locator('#mConferenciaBody button:not([disabled])').count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      // Roberta (Qualidade): lista só o que espera conferência; confere com o login.
      const {page, errors} = await abrir(browser, 'cq', estado, 'manipulacao.html');
      await page.waitForFunction(() => /aguardando conferência/i.test(document.querySelector('#mCardLista h3').textContent));
      const txt = await page.locator('#mListaBody').innerText();
      assert.match(txt, /26260\/01/);
      assert.match(txt, /26261\/01/);
      assert.doesNotMatch(txt, /26262\/01/, 'OP sem pesagem fechada não aparece para quem só confere');
      await page.locator('#mListaBody tr', {hasText: '26260/01'}).locator('[data-abrir]').click();
      await page.waitForSelector('#mConferenciaBody button.sim');
      assert.equal(await page.locator('#mConfAviso').isVisible(), false);
      assert.equal(await page.locator('#mPesagemRodape').isVisible(), false, 'quem só confere não pesa');
      assert.equal(await page.locator('#mBlocoManipulacao').isVisible(), false, 'nem manipula');
      for (const k of ['MPGR-001', 'MPGR-002', 'MPES-003']) {
        await page.click('#mConferenciaBody button.sim[data-conf="' + k + '"]');
      }
      await page.waitForFunction(() => !document.getElementById('mBtnConferir').disabled);
      await page.click('#mBtnConferir');
      await page.waitForFunction(() => window.__db.ops['26260-01'].manipulacao.status === 'CONFERIDO');
      const conf = await page.evaluate(() => window.__db.ops['26260-01'].manipulacao.conferencia);
      assert.equal(conf.por, 'Roberta');
      assert.equal(conf.uid, 'cq');
      assert.equal(conf.modo, 'CONFERENCIA_PESAGEM');
      assert.equal(Object.keys(conf.itens).length, 3);
      await page.waitForFunction(() => !/26260\/01/.test(document.getElementById('mListaBody').innerText), null, {timeout: 5000});
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      // Admin: libera a outra OP sem conferência, com motivo.
      const {page, errors} = await abrir(browser, 'adm', estado, 'manipulacao.html');
      const linha = page.locator('#mListaBody tr', {hasText: '26261/01'});
      await linha.waitFor();
      await linha.locator('[data-abrir]').click();
      await page.waitForSelector('#mBtnLiberarSemConf');
      assert.equal(await page.locator('#mBtnLiberarSemConf').isVisible(), true);
      assert.equal(await page.locator('#mBtnConferir').isVisible(), false, 'admin não é conferente: libera com motivo');
      page.__respostaPrompt = '';
      await page.click('#mBtnLiberarSemConf');
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => window.__db.ops['26261-01'].manipulacao.status), 'PESADO', 'sem motivo não libera');
      page.__respostaPrompt = 'Turno da noite sem Qualidade/P&D';
      await page.click('#mBtnLiberarSemConf');
      await page.waitForFunction(() => window.__db.ops['26261-01'].manipulacao.status === 'CONFERIDO');
      const c = await page.evaluate(() => window.__db.ops['26261-01'].manipulacao.conferencia);
      assert.equal(c.modo, 'LIBERADO_PELO_ADMIN');
      assert.equal(c.motivoLiberacao, 'Turno da noite sem Qualidade/P&D');
      assert.equal(c.por, 'Gustavo');
      await page.waitForFunction(() => /Liberado sem conferência/.test(document.getElementById('mConfLiberacao').innerText));
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      // Chave desligada: volta a conferência entre operadores.
      const e2 = dados();
      e2.config.conferenciaPesagem.ativa = false;
      const {page, errors} = await abrir(browser, 'man', e2, 'manipulacao.html');
      await page.locator('#mListaBody tr', {hasText: '26260/01'}).locator('[data-abrir]').click();
      await page.waitForSelector('#mConferenciaBody button.sim');
      assert.equal(await page.locator('#mConfAviso').isVisible(), false);
      assert.equal(await page.locator('#mConferenciaBody button:not([disabled])').count(), 6);
      assert.equal(await page.locator('#mBtnConferir').isVisible(), true);
      assert.deepEqual(errors, []);
      await page.close();
    }

    // ── 4. Histórico por setor ──────────────────────────────────────────
    {
      const {page, errors} = await abrir(browser, 'rot', null, 'historico.html');
      await page.click('#btnCarregar');
      await page.waitForFunction(() => /Rotuladora 1/.test(document.getElementById('tableBody').innerText));
      const txt = await page.locator('#tableBody').innerText();
      assert.doesNotMatch(txt, /Linha 1/, 'Rotulagem não vê o envase');
      assert.doesNotMatch(txt, /Posto A/);
      assert.equal(await page.locator('#tableBody .btn-edit').first().isVisible(), false, 'Rotulagem não edita');
      assert.equal(await page.locator('#tableBody .btn-delete').first().isVisible(), false);
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      const {page, errors} = await abrir(browser, 'pcp', null, 'historico.html');
      await page.click('#btnCarregar');
      await page.waitForFunction(() => /Posto A/.test(document.getElementById('tableBody').innerText));
      const txt = await page.locator('#tableBody').innerText();
      assert.match(txt, /Linha 1/);
      assert.match(txt, /Rotuladora 1/);
      await page.waitForFunction(() => !document.body.classList.contains('hist-somente-leitura'), null, {timeout: 3000});
      assert.equal(await page.locator('#tableBody .btn-edit').first().isVisible(), true, 'PCP edita');
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      // Produção: vê tudo (tem planejamento), mas não edita mais.
      const {page} = await abrir(browser, 'prod', null, 'historico.html');
      await page.click('#btnCarregar');
      await page.waitForFunction(() => /Rotuladora 1/.test(document.getElementById('tableBody').innerText));
      assert.equal(await page.locator('#tableBody .btn-edit').first().isVisible(), false, 'Produção consulta, PCP edita');
      await page.close();
    }

    // ── 5. Apontamento: cada setor na sua seção ──────────────────────────
    const secoes = (page) => page.evaluate(() => {
      const vis = (id) => { const el = document.getElementById(id); return !!el && el.style.display !== 'none'; };
      return {linhas: vis('secaoTurnoLinhas'), postos: vis('secaoTurnoPostos'), rotulagem: vis('secaoTurnoRotulagem')};
    });
    for (const [uid, esperado] of [['rot', {linhas: false, postos: false, rotulagem: true}],
      ['soLinha', {linhas: true, postos: true, rotulagem: false}], ['prod', {linhas: true, postos: true, rotulagem: true}]]) {
      const {page} = await abrir(browser, uid, null, 'form.html');
      if (typeof (await page.evaluate(() => typeof renderPainelTurno)) === 'string') await page.evaluate(() => renderPainelTurno());
      assert.deepEqual(await secoes(page), esperado, 'seções do painel de turno para ' + uid);
      await page.close();
    }

    // ── 6. Estoque por setor ────────────────────────────────────────────
    {
      const {page, errors} = await abrir(browser, 'rot', null, 'estoque_setor.html');
      await page.waitForFunction(() => /ROT-1\.1\.1/.test(document.getElementById('tbody').innerText));
      assert.equal(await page.locator('#titulo').innerText(), 'Estoque dos Rótulos');
      assert.equal(await page.locator('#setores').isVisible(), false, 'um setor só: sem abas');
      const txt = await page.locator('#tbody').innerText();
      assert.doesNotMatch(txt, /FAB-1\.1\.1|GAL-3\.1\.1/, 'só a área RÓTULOS (sem acento/caixa)');
      assert.match(txt, /5\.000/);
      assert.match(txt, /vencido/);
      assert.match(txt, /Quarentena/);
      assert.equal(await page.locator('#tbody tr').count(), 1, 'lote zerado não aparece');
      assert.match(await page.locator('#kpis').innerText(), /1\s*vencidos/);
      assert.equal(await page.locator('#cardOps').isVisible(), false, 'material das OPs é da Produção');
      assert.equal(await page.locator('#btnAreas').isVisible(), false, 'operador não configura áreas');
      // Tenta abrir outro setor pela URL: continua no seu.
      await page.goto('https://op.test/estoque_setor.html?setor=producao');
      await page.waitForFunction(() => window.currentUser && /Rótulos/.test(document.getElementById('titulo').textContent));
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      const {page, errors} = await abrir(browser, 'prod', null, 'estoque_setor.html?setor=producao');
      await page.waitForFunction(() => /FAB-1\.1\.1/.test(document.getElementById('tbody').innerText));
      assert.equal(await page.locator('#titulo').innerText(), 'Estoque da Fábrica');
      assert.equal(await page.locator('#setores .setor').count(), 3, 'Produção (gestão) troca de setor');
      assert.doesNotMatch(await page.locator('#tbody').innerText(), /GAL-3\.1\.1/);
      assert.equal(await page.locator('#cardOps').isVisible(), true);
      const op = page.locator('details.op[data-op="26260-01"]');
      await op.locator('summary').click();
      await page.waitForFunction(() => /separado para esta OP/.test(document.getElementById('opsLista').innerText));
      const detalhe = await op.innerText();
      assert.match(detalhe, /EP-00106[\s\S]*precisa 1\.000 un · empenhado 800 un · separado 800/);
      assert.match(detalhe, /FAB-1\.1\.1[\s\S]*separado para esta OP[\s\S]*GAL-3\.1\.1/, 'o separado para a OP vem antes do galpão');
      assert.doesNotMatch(detalhe, /AK-2026-000701/, 'separado para outra OP não é opção');
      assert.match(detalhe, /RT-00050[\s\S]*ROT-1\.1\.1[\s\S]*Quarentena/, 'lote em quarentena aparece marcado');
      await page.click('#setores [data-setor="rotulagem"]');
      await page.waitForFunction(() => /Rótulos/.test(document.getElementById('titulo').textContent));
      assert.match(page.url(), /setor=rotulagem/);
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      // Admin configura as áreas da Manipulação.
      const {page, errors} = await abrir(browser, 'adm', null, 'estoque_setor.html?setor=manipulacao');
      await page.waitForFunction(() => /Manipulação/.test(document.getElementById('titulo').textContent));
      assert.match(await page.locator('#avisoAreas').innerText(), /MANIPULAÇÃO ainda não existe/, 'avisa a área padrão que falta criar');
      await page.click('#btnAreas');
      await page.check('#areasCfg input[value="GALPÃO"]');
      await page.uncheck('#areasCfg input[value="MATÉRIA PRIMA"]');
      await page.click('#btnSalvarAreas');
      await page.waitForFunction(() => (((window.__db.config.operacao || {}).areasPorSetor || {}).manipulacao || []).length);
      assert.deepEqual(await page.evaluate(() => window.__db.config.operacao.areasPorSetor.manipulacao), ['GALPÃO']);
      await page.waitForFunction(() => /GAL-3\.1\.1/.test(document.getElementById('tbody').innerText));
      assert.equal(await page.locator('#avisoAreas').isVisible(), false);
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      // Celular: sem rolagem horizontal na página.
      const {page} = await abrir(browser, 'prod', null, 'estoque_setor.html?setor=producao', {width: 390, height: 844});
      await page.waitForFunction(() => /FAB-1\.1\.1/.test(document.getElementById('tbody').innerText));
      const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(sobra <= 1, 'estoque sem rolagem horizontal no celular (' + sobra + 'px)');
      await page.close();
    }

    console.log('run_operacao_ui_test: OK (acessos, menu, Conferência de Pesagem, histórico por setor, apontamento por setor, estoque por setor)');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
