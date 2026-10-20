'use strict';
/* Responsável comercial por cliente (20/10/2026) na tela real.

   O que este teste existe para pegar — e que o teste de unidade NÃO pega
   (a armadilha do `clienteKey` declarado duas vezes, no CLAUDE.md): a LIGAÇÃO.
   Que o modal alcance cliente SEM pedido (a tabela da aba Clientes só lista
   quem tem movimento: 28 dos 60 em produção), que a gravação saia em caminho
   plano, que a coluna e o filtro leiam o que foi gravado, e que desligar um
   responsável não apague a carteira dele.

   Tela real com utils.js e auth_check.js reais; Firebase simulado em memória,
   com listeners que disparam de novo a cada gravação. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    usuarios: {
      u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'},
      u2: {nome: 'Ana Souza', email: 'ana@kuryos.com', role: 'pcp'}
    },
    config: {},
    clientes: {
      // Tem pedido: aparece na tabela da aba Clientes.
      MISS: {nome: 'MISS RÔSE', codigo: 'MISS', ativo: true, condicaoPagamento: '30/45/60'},
      // NUNCA teve pedido: fora da tabela, mas tem de aparecer no modal. É o
      // caso de 32 dos 60 clientes reais.
      NOVO: {nome: 'CLIENTE NOVO SEM PEDIDO', codigo: 'NOVO', ativo: true},
      // Já atribuído a um responsável que não existe mais na lista: órfão.
      ORFA: {nome: 'EMPRESA ORFA', codigo: 'ORFA', ativo: true,
        responsavelComercialId: 'rc_sumiu', responsavelComercialNome: 'Quem Saiu'},
      // Inativo: fora da contagem de cobertura.
      MORTA: {nome: 'EMPRESA INATIVA', codigo: 'MORT', ativo: false}
    },
    comercial_config: {responsaveis: {
      rc_ana: {nome: 'Ana Souza', email: 'ana@kuryos.com', uidLogin: 'u1', ativo: true},
      rc_bru: {nome: 'Bruno Lima', email: '', uidLogin: null, ativo: true}
    }},
    produtos: {MRARBS04: {sku: 'MRARBS04', descricao: 'BODY SPLASH NÉCTAR', cliente: 'MISS RÔSE', clienteKey: 'MISS'}},
    precos_venda: {},
    pedidos_comerciais: {
      'PED-0002': {numeroFormatado: 'PED-0002', cliente: 'MISS RÔSE', clienteKey: 'MISS', dataPedido: '2026-09-01',
        status: 'LIBERADO_PCP', historico: [{tipo: 'LIBERADO_PCP'}],
        itens: [{sku: 'MRARBS04', produtoKey: 'MRARBS04', descricao: 'BODY SPLASH NÉCTAR', qtd: 1000, valorUnitario: 2.7, desconto: 0}]}
    },
    pedidos: {
      'PED-0002__MRARBS04': {id: 'PED-0002', parentPedidoId: 'PED-0002', sku: 'MRARBS04', produto: 'BODY SPLASH NÉCTAR',
        cliente: 'MISS RÔSE', qtdTotal: 1000, produzido: 0}
    },
    ops: {}, expedicoes_comerciais: {}, estoque_lotes: {}, conferencias_pa: {},
    solicitacoes_descarte: {}, devolucoes_cliente: {}, programacao: {}
  };
}

async function abrir(browser) {
  const page = await browser.newPage({viewport: {width: 1500, height: 1000}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(({data}) => {
    const db = data; window.__db = db; window.__iniciado = false;
    window.__gravacoes = [];  // toda chamada de update, para conferir caminho plano
    const partes = p => String(p || '').split('/').filter(Boolean);
    const ler = p => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const gravar = (p, v) => { const ks = partes(p); let o = db; ks.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = structuredClone(v); };
    const ouvintes = []; let seq = 0;
    const avisar = caminhos => ouvintes.forEach(o => {
      if (caminhos.some(c => c === o.path || c.startsWith(o.path + '/') || o.path.startsWith(c + '/'))) setTimeout(() => o.cb(snapDe(o.path)), 0);
    });
    const snapDe = path => { const v = ler(path); const c = v === undefined ? null : structuredClone(v); return {val: () => c, exists: () => c !== null}; };
    const exige = q => { if (!window.__iniciado) throw new Error('sem app (' + q + ')'); };
    window.firebase = {
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() { exige('auth'); return {currentUser: {uid: 'u1', email: 'g@kuryos.com'}, onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com'}), 0); }, signOut() { return Promise.resolve(); }}; },
      database() {
        exige('database');
        const ref = path => ({path, key: partes(path).pop(),
          once(ev, cb) { const s = snapDe(path); if (cb) cb(s); return Promise.resolve(s); },
          on(ev, cb) { ouvintes.push({path, cb}); setTimeout(() => cb(snapDe(path)), 0); return cb; }, off() {},
          child(c) { return ref(path + '/' + c); }, orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, startAt() { return this; },
          push() { seq++; return ref(path + '/-N' + seq); },
          set(v) { gravar(path, v); avisar([path]); return Promise.resolve(); },
          update(obj) { window.__gravacoes.push({ref: path, chaves: Object.keys(obj), valores: structuredClone(obj)}); const cs = Object.keys(obj).map(k => (path ? path + '/' : '') + k); Object.entries(obj).forEach(([k, v]) => gravar((path ? path + '/' : '') + k, v)); avisar(cs); return Promise.resolve(); },
          remove() { gravar(path, null); avisar([path]); return Promise.resolve(); },
          transaction(fn) { const atual = ler(path); const r = fn(atual === undefined ? null : structuredClone(atual)); if (r !== undefined) { gravar(path, r); avisar([path]); } return Promise.resolve({committed: r !== undefined, snapshot: snapDe(path)}); }});
        return {ref: p => ref(p || '')};
      }
    };
  }, {data: dados()});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'gc.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://gc.test/gestao_comercial.html');
  await page.waitForFunction(() => /Atualizado/.test(document.getElementById('sTxt').textContent), null, {timeout: 10000});
  await page.waitForFunction(() => window.currentUser && window.currentUser.role === 'admin');
  return {page, errors};
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser);
    await page.click('#abas .tab[data-tab="clientes"]');

    // ── Coluna Responsável na tabela ───────────────────────────────────
    const linha = (nome) => page.locator('#tabClientes tr.clicavel', {hasText: nome});
    assert.match(await page.locator('#tabClientes').innerText(), /RESPONS[ÁA]VEL/i, 'coluna existe');
    assert.match(await linha('MISS RÔSE').innerText(), /—/, 'MISS começa sem responsável');
    // O cliente sem pedido NÃO está nesta tabela -- é o motivo de o modal existir.
    assert.equal(await linha('CLIENTE NOVO SEM PEDIDO').count(), 0, 'cliente sem pedido fica fora da análise');

    // ── Filtro: "minha carteira" aparece porque rc_ana tem uidLogin = u1 ──
    const opcoes = await page.locator('#cliResp option').allInnerTexts();
    assert.ok(opcoes.some(o => /Minha carteira \(Ana Souza\)/.test(o)), 'login u1 casa com rc_ana: ' + opcoes.join(' | '));
    assert.ok(opcoes.some(o => /Sem responsável/.test(o)));
    assert.ok(opcoes.some(o => /Bruno Lima/.test(o)));

    // ── Modal: alcança TODOS os clientes ativos, inclusive sem pedido ──
    await page.click('#btnCarteira');
    await page.waitForSelector('#modalCarteira.open');
    const texto = () => page.locator('#caTabela').innerText();
    assert.match(await texto(), /CLIENTE NOVO SEM PEDIDO/, 'modal alcança quem nunca teve pedido');
    assert.match(await texto(), /MISS RÔSE/);
    assert.ok(!/EMPRESA INATIVA/.test(await texto()), 'cliente inativo fica fora');
    // Órfão aparece com o nome espelhado e marcado para reatribuir.
    assert.match(await texto(), /Quem Saiu — reatribuir/, 'vínculo órfão não desaparece');
    // Cobertura: 3 clientes ativos (MISS, NOVO, ORFA) e NENHUM com vínculo
    // válido -- o de ORFA aponta para responsável que não existe mais.
    assert.match(await page.locator('#caKpis').innerText(), /0 de 3/, 'cobertura: órfão não conta como atribuído');

    // ── Atribuir em lote ───────────────────────────────────────────────
    assert.equal(await page.locator('#caAplicar').isDisabled(), true, 'sem seleção o botão fica travado');
    await page.locator('#caTabela input[data-ca-k="NOVO"]').check();
    await page.locator('#caTabela input[data-ca-k="MISS"]').check();
    assert.match(await page.locator('#caAplicar').innerText(), /2 selecionados/);
    await page.selectOption('#caDestino', 'rc_bru');
    await page.click('#caAplicar');
    await page.waitForFunction(() => (window.__db.clientes.MISS || {}).responsavelComercialId === 'rc_bru', null, {timeout: 5000});

    // Gravação em CAMINHO PLANO: objeto aninhado apagaria campos irmãos.
    const grav = await page.evaluate(() => window.__gravacoes.filter(g => g.chaves.some(k => /responsavelComercial/.test(k))).pop());
    assert.equal(grav.ref, '', 'update na raiz com caminhos completos');
    assert.deepEqual(grav.chaves.slice().sort(), [
      'clientes/MISS/responsavelComercialEm', 'clientes/MISS/responsavelComercialId',
      'clientes/MISS/responsavelComercialNome', 'clientes/MISS/responsavelComercialPor',
      'clientes/NOVO/responsavelComercialEm', 'clientes/NOVO/responsavelComercialId',
      'clientes/NOVO/responsavelComercialNome', 'clientes/NOVO/responsavelComercialPor'
    ], 'um caminho por campo, nada aninhado');
    Object.values(grav.valores).forEach(v => assert.equal(typeof v !== 'object' || v === null, true, 'nenhum valor aninhado'));

    const miss = await page.evaluate(() => window.__db.clientes.MISS);
    assert.equal(miss.responsavelComercialId, 'rc_bru');
    assert.equal(miss.responsavelComercialNome, 'Bruno Lima', 'espelho do nome gravado');
    assert.equal(miss.responsavelComercialPor, 'Gustavo', 'quem atribuiu fica registrado');
    assert.ok(miss.responsavelComercialEm, 'data da atribuição gravada');
    assert.equal(miss.nome, 'MISS RÔSE', 'o resto do cadastro sobreviveu ao update');
    assert.equal(miss.condicaoPagamento, '30/45/60', 'campo irmão intacto');

    // ── A coluna e o filtro leem o que foi gravado ─────────────────────
    await page.click('#caFechar');
    await page.waitForFunction(() => /Bruno Lima/.test(document.getElementById('tabClientes').innerText), null, {timeout: 5000});
    await page.selectOption('#cliResp', 'rc_bru');
    assert.match(await page.locator('#tabClientes').innerText(), /MISS RÔSE/);
    await page.selectOption('#cliResp', 'rc_ana');
    assert.match(await page.locator('#tabClientes').innerText(), /Nenhum cliente neste filtro/, 'Ana não tem carteira ainda');
    await page.selectOption('#cliResp', 'PENDENTE');
    assert.match(await page.locator('#tabClientes').innerText(), /Nenhum cliente neste filtro/, 'ORFA não tem pedido, logo não está nesta tabela');
    await page.selectOption('#cliResp', '');

    // ── Cadastrar responsável: as travas ───────────────────────────────
    await page.click('#btnCarteira');
    await page.click('#caAbas .tab[data-ca="pessoas"]');
    assert.match(await page.locator('#caPessoas').innerText(), /2 clientes na carteira/, 'carteira do Bruno contada');
    await page.click('#caAddPessoa');
    await page.click('#caSalvarPessoas');
    assert.match(await page.locator('#caPessoasErro').innerText(), /precisa de nome/, 'nome é obrigatório');
    // Nome que só difere em acento/caixa é a mesma pessoa -- a trava central.
    await page.locator('#caPessoas input[data-rp="nome"]').last().fill('ana souza');
    await page.click('#caSalvarPessoas');
    assert.match(await page.locator('#caPessoasErro').innerText(), /mesmo nome/, 'grafia divergente é barrada');
    await page.locator('#caPessoas input[data-rp="nome"]').last().fill('Carla Dias');
    await page.locator('#caPessoas input[data-rp="email"]').last().fill('carla@');
    await page.click('#caSalvarPessoas');
    assert.match(await page.locator('#caPessoasErro').innerText(), /Confira o e-mail de Carla Dias/);
    await page.locator('#caPessoas input[data-rp="email"]').last().fill('carla@kuryos.com.br');
    await page.click('#caSalvarPessoas');
    await page.waitForFunction(() => Object.keys(window.__db.comercial_config.responsaveis).length === 3, null, {timeout: 5000});
    const carla = await page.evaluate(() => Object.values(window.__db.comercial_config.responsaveis).find(r => r.nome === 'Carla Dias'));
    assert.equal(carla.email, 'carla@kuryos.com.br');
    assert.equal(carla.uidLogin, null, 'representante sem login grava null, não undefined');
    assert.equal(carla.ativo, true);

    // ── Desligar não apaga a carteira ──────────────────────────────────
    // hasText nao enxerga valor de <input> -- o nome vive no atributo value.
    const cardBruno = page.locator('#caPessoas .card')
      .filter({has: page.locator('input[data-rp="nome"][value="Bruno Lima"]')});
    await cardBruno.locator('input[data-rp="ativo"]').uncheck();
    await page.click('#caSalvarPessoas');
    await page.waitForFunction(() => window.__db.comercial_config.responsaveis.rc_bru.ativo === false, null, {timeout: 5000});
    assert.equal(await page.evaluate(() => window.__db.clientes.MISS.responsavelComercialId), 'rc_bru',
      'desligar o responsável NÃO tira o vínculo do cliente');
    await page.click('#caFechar');
    await page.waitForFunction(() => /desligado/.test(document.getElementById('tabClientes').innerText), null, {timeout: 5000});
    await page.selectOption('#cliResp', 'PENDENTE');
    assert.match(await page.locator('#tabClientes').innerText(), /MISS RÔSE/, 'filtro "desligado ou removido" acha a conta a reatribuir');

    // ── Remover o responsável de um cliente ────────────────────────────
    await page.selectOption('#cliResp', '');
    await page.click('#btnCarteira');
    await page.locator('#caTabela input[data-ca-k="MISS"]').check();
    await page.selectOption('#caDestino', '__LIMPAR');
    await page.click('#caAplicar');
    await page.waitForFunction(() => window.__db.clientes.MISS.responsavelComercialId === undefined, null, {timeout: 5000});
    const limpo = await page.evaluate(() => window.__db.clientes.MISS);
    assert.equal(limpo.responsavelComercialNome, undefined, 'o espelho sai junto com o id');
    assert.equal(limpo.responsavelComercialEm, undefined);
    assert.equal(limpo.nome, 'MISS RÔSE', 'cadastro preservado');
    assert.equal(limpo.condicaoPagamento, '30/45/60');

    assert.deepEqual(errors, [], 'nenhum erro de página');
    console.log('OK Responsável comercial: coluna, filtro, modal com os 60, lote em caminho plano, travas de nome e desligamento.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
