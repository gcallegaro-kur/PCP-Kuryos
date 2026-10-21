'use strict';
/* Desativar / excluir usuário na tela real (21/10/2026).

   O teste de unidade já cobre as regras. Aqui o que se prova é a LIGAÇÃO,
   que é onde este repo costuma quebrar: que o botão existe, que a trava do
   último admin aparece como texto em vez de botão morto, que a gravação sai
   em caminho plano, que a lápide entra no MESMO update, e que o painel cobra
   a conta de login que o app não consegue apagar.

   Tela real com utils.js e auth_check.js reais; Firebase simulado em memória. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

/* Espelha a bagunça medida em produção em 21/10: 2 admins, duplicata de
   duplo clique com o mesmo e-mail, pendente antigo e um já desativado. */
function dados() {
  return {
    usuarios: {
      u1: {nome: 'Gustavo Callegaro', email: 'gustavo@kuryos.com.br', role: 'admin', created_at: '2026-07-08T10:00:00.000Z'},
      u2: {nome: 'Lucca De Camillis', email: 'lucca@kuryos.com.br', role: 'admin', created_at: '2026-07-07T10:00:00.000Z'},
      u3: {nome: 'Diego Costa', email: 'diego.costa@kuryos.com.br', role: 'pcp', created_at: '2026-07-08T10:00:00.000Z'},
      u4: {nome: 'Bruna Araujo', email: 'bruna.araujo@kuryos.com.br', role: 'pending', created_at: '2026-07-08T10:00:00.000Z'},
      u5: {nome: 'Luana', email: 'lauarlata@gmail.com', role: 'pending', created_at: '2026-10-21T14:04:19.000Z'},
      u6: {nome: 'Luana', email: 'lauarlata@gmail.com', role: 'production', created_at: '2026-10-21T14:04:19.000Z'},
      u7: {nome: 'Ex Funcionario', email: 'ex@kuryos.com.br', role: 'production', ativo: false,
        desativadoEm: '2026-10-01T10:00:00.000Z', desativadoPor: 'Gustavo Callegaro', created_at: '2026-01-01T10:00:00.000Z'}
    },
    usuarios_removidos: {
      velho: {nome: 'Fantasma Antigo', email: 'fantasma@kuryos.com.br', role: 'pending',
        removidoEm: '2026-10-20T10:00:00.000Z', removidoPor: 'Gustavo Callegaro', authPendente: true}
    },
    config: {}
  };
}

async function abrir(browser) {
  const page = await browser.newPage({viewport: {width: 1600, height: 1100}});
  const errors = [];
  const dialogos = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { dialogos.push(d.message()); d.accept(); });
  await page.addInitScript(({data}) => {
    const db = data; window.__db = db; window.__iniciado = false;
    window.__gravacoes = [];
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
      auth() { exige('auth'); return {currentUser: {uid: 'u1', email: 'gustavo@kuryos.com.br'}, onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'gustavo@kuryos.com.br'}), 0); }, signOut() { return Promise.resolve(); }}; },
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
    if (url.hostname !== 'us.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://us.test/usuarios.html');
  await page.waitForFunction(() => window.currentUser && window.currentUser.role === 'admin', null, {timeout: 10000});
  await page.waitForFunction(() => document.querySelectorAll('#users-tbody tr').length > 1, null, {timeout: 10000});
  return {page, errors, dialogos};
}

const linha = (page, nome) => page.locator('#users-tbody tr', {hasText: nome});

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors, dialogos} = await abrir(browser);

    // ── A coluna existe e o desativado está escondido por padrão ───────
    assert.match(await page.locator('table thead').innerText(), /ACESSO/i, 'coluna Acesso no cabeçalho');
    assert.equal(await linha(page, 'Ex Funcionario').count(), 0, 'desativado fica fora da lista por padrão');
    assert.match(await page.locator('#contagemUsuarios').innerText(), /1 desativado/);
    await page.check('#verInativos');
    await page.waitForFunction(() => /Ex Funcionario/.test(document.getElementById('users-tbody').innerText));
    const exLinha = linha(page, 'Ex Funcionario');
    assert.match(await exLinha.innerText(), /Desativado/, 'o selo diz Desativado, não o papel antigo');
    // O SELO diz Desativado em vez do papel: mostrar 'PCP' sugeriria que entra.
    // O seletor de papel continua na linha de propósito -- serve para ajustar
    // o perfil antes de reativar.
    assert.equal(await exLinha.locator('.badge.inativo').innerText(), 'Desativado');
    assert.equal(await exLinha.locator('.badge.production').count(), 0, 'o selo do papel dá lugar ao de desativado');
    assert.match(await exLinha.innerText(), /por Gustavo Callegaro/, 'diz quem desativou');
    assert.equal(await exLinha.locator('.btn-reativar').count(), 1, 'desativado oferece Reativar');
    assert.equal(await exLinha.locator('.btn-desativar').count(), 0);

    // ── AS TRAVAS ──────────────────────────────────────────────────────
    // Si mesmo: nenhum botão, e o motivo escrito.
    // Pelo E-MAIL, nao pelo nome: 'Gustavo Callegaro' tambem aparece na linha
    // do Ex Funcionario, como quem o desativou -- o nome casa 2 linhas.
    const eu = linha(page, 'gustavo@kuryos.com.br');
    assert.equal(await eu.locator('.btn-desativar').count(), 0, 'não dá para desativar a si mesmo');
    assert.equal(await eu.locator('.btn-excluir').count(), 0);
    assert.match(await eu.innerText(), /Seu próprio acesso/);
    // Com 2 admins, o outro admin PODE sair.
    assert.equal(await linha(page, 'Lucca De Camillis').locator('.btn-desativar').count(), 1, 'com 2 admins dá para tirar o outro');
    // Quem tem histórico é orientado a desativar, não excluir.
    assert.match(await linha(page, 'Diego Costa').innerText(), /Prefira desativar/);
    // Pendente que nunca foi aprovado pode ser excluído sem cerimônia.
    assert.match(await linha(page, 'Bruna Araujo').innerText(), /Nunca foi aprovado/);

    // ── Painel: o que precisa de decisão ───────────────────────────────
    const painel = () => page.locator('#painelAvisos').innerText();
    assert.match(await painel(), /esperando aprovação há mais de 7 dias/i);
    assert.match(await painel(), /Bruna Araujo/, 'pendente antigo é cobrado');
    assert.ok(!/Luana.*dias/.test((await painel()).split('mais de um login')[0]), 'pendente de hoje não entra no aviso de 7 dias');
    assert.match(await painel(), /Mesma pessoa com mais de um login/i);
    assert.match(await painel(), /lauarlata@gmail\.com — 2 logins/, 'a duplicata de e-mail é apontada');
    assert.match(await painel(), /Conta de login a apagar no Console/i);
    assert.match(await painel(), /Fantasma Antigo/, 'lápide antiga aparece como pendência do Console');

    // ── Desativar: caminho plano, e o resto do registro intacto ────────
    await linha(page, 'Diego Costa').locator('.btn-desativar').click();
    await page.waitForFunction(() => window.__db.usuarios.u3.ativo === false, null, {timeout: 5000});
    assert.ok(dialogos.some(m => /Desativar o acesso de Diego Costa/.test(m)), 'confirma antes: ' + dialogos.join(' | '));
    const gDes = await page.evaluate(() => window.__gravacoes.filter(g => g.chaves.some(k => /ativo|desativado/.test(k))).pop());
    assert.equal(gDes.ref, '', 'update na raiz com caminhos completos');
    assert.deepEqual(gDes.chaves.slice().sort(), ['usuarios/u3/ativo', 'usuarios/u3/desativadoEm', 'usuarios/u3/desativadoPor']);
    Object.values(gDes.valores).forEach(v => assert.equal(typeof v !== 'object' || v === null, true, 'nada aninhado'));
    const u3 = await page.evaluate(() => window.__db.usuarios.u3);
    assert.equal(u3.nome, 'Diego Costa', 'o cadastro sobreviveu ao update');
    assert.equal(u3.role, 'pcp', 'o papel é preservado — reativar devolve o mesmo acesso');
    assert.equal(u3.desativadoPor, 'Gustavo Callegaro');

    // ── Reativar limpa a marca ─────────────────────────────────────────
    await page.waitForFunction(() => /Desativado/.test(document.getElementById('users-tbody').innerText));
    await linha(page, 'Diego Costa').locator('.btn-reativar').click();
    await page.waitForFunction(() => window.__db.usuarios.u3.ativo === true, null, {timeout: 5000});
    const u3b = await page.evaluate(() => window.__db.usuarios.u3);
    assert.equal(u3b.desativadoEm, undefined, 'reativar apaga a marca anterior');
    assert.equal(u3b.desativadoPor, undefined);
    assert.equal(u3b.role, 'pcp');

    // ── Excluir: a linha sai E a lápide entra no MESMO update ──────────
    await linha(page, 'Bruna Araujo').locator('.btn-excluir').click();
    await page.waitForFunction(() => window.__db.usuarios.u4 === undefined, null, {timeout: 5000});
    assert.ok(dialogos.some(m => /NÃO dá para desfazer/.test(m)), 'avisa que não desfaz');
    assert.ok(dialogos.some(m => /conta de login \(bruna\.araujo@kuryos\.com\.br\) continua existindo/.test(m)),
      'avisa que a credencial sobrevive — é o que impede o fantasma silencioso');
    const gExc = await page.evaluate(() => window.__gravacoes.filter(g => g.chaves.some(k => /usuarios_removidos/.test(k))).pop());
    assert.ok(gExc.chaves.includes('usuarios/u4'), 'a remoção e a lápide no mesmo update');
    assert.equal(gExc.valores['usuarios/u4'], null);
    const lapide = await page.evaluate(() => window.__db.usuarios_removidos.u4);
    assert.equal(lapide.nome, 'Bruna Araujo');
    assert.equal(lapide.email, 'bruna.araujo@kuryos.com.br');
    assert.equal(lapide.role, 'pending');
    assert.equal(lapide.authPendente, true, 'nasce como pendência do Console');
    assert.equal(lapide.removidoPor, 'Gustavo Callegaro');
    assert.equal(lapide.criadoEm, '2026-07-08T10:00:00.000Z', 'guarda quando a conta nasceu');
    // E o painel passa a cobrar essa conta também.
    await page.waitForFunction(() => /Bruna Araujo/.test(document.getElementById('painelAvisos').innerText), null, {timeout: 5000});
    assert.match(await painel(), /Conta de login a apagar no Console/i);

    // ── "Já apaguei" encerra a pendência sem perder a lápide ───────────
    await page.locator('#painelAvisos [data-auth-ok="u4"]').click();
    await page.waitForFunction(() => window.__db.usuarios_removidos.u4.authPendente === false, null, {timeout: 5000});
    const lapide2 = await page.evaluate(() => window.__db.usuarios_removidos.u4);
    assert.equal(lapide2.nome, 'Bruna Araujo', 'a lápide continua lá, só a pendência fechou');
    assert.ok(lapide2.authApagadoEm);

    // ── Último admin ativo fica intocável ──────────────────────────────
    await linha(page, 'Lucca De Camillis').locator('.btn-desativar').click();
    await page.waitForFunction(() => window.__db.usuarios.u2.ativo === false, null, {timeout: 5000});
    await page.waitForFunction(() => /Seu próprio acesso/.test(document.getElementById('users-tbody').innerText));
    // Agora u1 é o único admin ativo -- e é o próprio logado, então a linha
    // dele continua sem botão. O que importa é que o motor recusaria.
    const recusa = await page.evaluate(() => GestaoUsuarios.podeRemover(window.__db.usuarios, 'u1', 'u9'));
    assert.equal(recusa.ok, false);
    assert.match(recusa.motivo, /último administrador ativo/);

    assert.deepEqual(errors, [], 'nenhum erro de página');

    // ══ login.html: a causa raiz ══════════════════════════════════════
    const p2 = await browser.newPage({viewport: {width: 900, height: 900}});
    const err2 = [];
    p2.on('pageerror', e => err2.push(e.message));
    await p2.addInitScript(() => {
      window.__criadas = 0;
      window.firebase = {
        initializeApp() {},
        auth() {
          return {
            currentUser: null,
            onAuthStateChanged(cb) { setTimeout(() => cb(null), 0); },
            signOut() { return Promise.resolve(); },
            // Nunca resolve: simula a rede lenta em que o duplo clique
            // acontecia de verdade (os 3 logins do mesmo segundo).
            createUserWithEmailAndPassword() { window.__criadas++; return new Promise(() => {}); },
            signInWithEmailAndPassword() { return new Promise(() => {}); }
          };
        },
        database() { return {ref: () => ({once: () => Promise.resolve({val: () => null}), on() {}, off() {}, set: () => Promise.resolve(), update: () => Promise.resolve()})}; }
      };
    });
    await p2.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'us.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + url.pathname.slice(1);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    await p2.goto('https://us.test/login.html');
    await p2.click('#tab-register');
    await p2.fill('#reg-name', 'Luana');
    await p2.fill('#reg-email', 'lauarlata@gmail.com');
    await p2.fill('#reg-password', 'senhaDeTeste123');
    // Três cliques, como aconteceu em produção: UMA conta.
    await p2.click('#btn-register');
    await p2.locator('#btn-register').click({force: true}).catch(() => {});
    await p2.locator('#btn-register').click({force: true}).catch(() => {});
    assert.equal(await p2.evaluate(() => window.__criadas), 1,
      'três cliques criam UMA conta — é a causa raiz dos 3 logins do mesmo segundo');
    assert.equal(await p2.locator('#btn-register').isDisabled(), true, 'o botão trava durante o envio');
    assert.match(await p2.locator('#btn-register').innerText(), /Criando conta/);

    // Mensagem de conta desativada na volta do auth_check.
    const p3 = await browser.newPage();
    p3.on('pageerror', e => err2.push(e.message));
    await p3.addInitScript(() => {
      window.firebase = {
        initializeApp() {},
        auth() { return {currentUser: null, onAuthStateChanged(cb) { setTimeout(() => cb(null), 0); }, signOut() { return Promise.resolve(); }}; },
        database() { return {ref: () => ({once: () => Promise.resolve({val: () => null}), on() {}, off() {}})}; }
      };
    });
    await p3.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'us.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + url.pathname.slice(1);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : 'text/javascript'});
    });
    await p3.goto('https://us.test/login.html?status=inativo');
    await p3.waitForFunction(() => /desativado/i.test(document.body.innerText), null, {timeout: 5000});
    const txt = await p3.locator('body').innerText();
    assert.match(txt, /Acesso desativado/i, 'quem foi desativado lê o motivo certo');
    assert.ok(!/aguarda ativação|não foi aprovada/i.test(txt), 'não diz "pendente de aprovação" — não há aprovação por vir');

    assert.deepEqual(err2, [], 'nenhum erro em login.html');
    console.log('OK Usuários: desativar/reativar/excluir com lápide, travas de si-mesmo e último admin, painel de pendências, e o duplo clique travado no cadastro.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
