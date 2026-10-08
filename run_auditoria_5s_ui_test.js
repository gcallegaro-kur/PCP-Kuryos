'use strict';
/* Auditoria 5S (auditoria_5s.html): líder preenche o checklist (NC exige local, foto, ação e responsável),
   a Qualidade audita com item crítico, ciência, ocorrências restritas e configuração. Tela real, Firebase simulado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const PERFIS = {
  lider: {role: 'production', papel: {papel: 'LIDER', setores: ['Produção'], nome: 'Fulana Teste'},
    setores: {s01: {nome: 'Produção', ordem: 1, ativo: true, areas: {a01: {nome: 'Linha 1', responsavel: 'Maria Souza'}, a02: {nome: 'Linha 2', responsavel: ''}}}, s02: {nome: 'Recepção', ordem: 2, ativo: true, areas: {}}}},
  auditor: {role: 'qualidade', papel: {papel: 'AUDITOR'}},
  admin: {role: 'admin', papel: null},
  // Auditora que também é líder (08/10): Fulana e Beltrano lideram o Laboratório em rodízio.
  auditoraLider: {role: 'qualidade', papel: {papel: 'AUDITOR', setores: ['Laboratório'], nome: 'Fulana Teste'},
    outros: {u2: {papel: 'AUDITOR', setores: ['Laboratório'], nome: 'Beltrano'}},
    auditorias: () => { const d = new Date(), h = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      return {x1: {tipo: 'LIDER', setor: 'Laboratório', data: h, turno: '1º', responsavelUid: 'u2', responsavelNome: 'Beltrano', resultado: {statusTexto: 'VERDE'}, fechadaEm: h + 'T10:00:00Z'}}; }}
};
function dados(perfil) {
  const p = PERFIS[perfil];
  return {
    usuarios: {u1: {nome: 'Fulana Teste', email: 'f@kuryos.com', role: p.role, modulos: {auditoria5s: true}},
      u2: {nome: 'Beltrano', email: 'b@kuryos.com', role: 'production', modulos: {auditoria5s: true}}},
    config: {linhas: ['Linha 1']},
    auditoria5s_config: {usuarios: Object.assign(p.papel ? {u1: p.papel} : {}, p.outros || {}), equipe: {p1: {nome: 'Maria Souza', setor: 'Produção'}}},
    auditorias_5s: p.auditorias ? p.auditorias() : {}, acoes_5s: {}, ciencia_5s: {}, ocorrencias_5s: {}
  };
}
function dadosComSetores(perfil) {
  const d = dados(perfil);
  if (PERFIS[perfil].setores) d.auditoria5s_config.setores = PERFIS[perfil].setores;
  return d;
}

async function abrir(browser, pagina, perfil) {
  const atraso = 0;
  const page = await browser.newPage({viewport: {width: 1600, height: 1100}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(({data, atraso}) => {
    window.__atrasoLogin = atraso;
    const db = data;
    window.__db = db;
    window.__iniciado = false;
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    window.__ouvintes = [];
    const notificar = () => window.__ouvintes.forEach((o) => o.cb(o.snap()));
    const gravar = (p, v) => {
      const ks = partes(p); let o = db;
      ks.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
      if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = structuredClone(v);
    };
    let seq = 0;
    const exige = q => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
    window.firebase = {
      storage() { return {ref: (p) => ({put() { return Promise.resolve(); }, getDownloadURL() { return Promise.resolve('https://fotos.test/' + p); }})}; },
      initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
      auth() {
        exige('auth');
        return {currentUser: {uid: 'u1', email: 'g@kuryos.com'},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), window.__atrasoLogin || 0); },
          signOut() { return Promise.resolve(); }};
      },
      database() {
        exige('database');
        const ref = (path, filtro) => {
          const valor = () => {
            let v = ler(path);
            if (filtro && v && typeof v === 'object') v = Object.fromEntries(Object.entries(v).filter(([k]) => k >= filtro));
            return v === undefined ? null : structuredClone(v);
          };
          const snap = () => { const v = valor(); return {val: () => v, exists: () => v !== null, key: partes(path).pop(), forEach(cb) { Object.entries(v || {}).forEach(([k, x]) => cb({key: k, val: () => x})); }}; };
          return {path, key: partes(path).pop(),
            once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); },
            on(ev, cb) { window.__ouvintes.push({cb, snap}); setTimeout(() => cb(snap()), 0); return cb; },
            off() {}, child(c) { return ref(path + '/' + c); },
            orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
            startAt(k) { return ref(path, k); },
            push(v) { seq++; const filho = ref(path + '/-T' + seq); if (v !== undefined) { gravar(filho.path, v); notificar(); } const pr = Promise.resolve(filho); pr.key = filho.key; pr.path = filho.path; return pr; },
            set(v) { gravar(path, v); notificar(); return Promise.resolve(); },
            update(obj) { Object.entries(obj).forEach(([k, v]) => gravar(path + '/' + k, v)); notificar(); return Promise.resolve(); },
            remove() { gravar(path, null); return Promise.resolve(); },
            transaction(fn) { const r = fn(valor()); if (r !== undefined) { gravar(path, r); notificar(); } return Promise.resolve({committed: r !== undefined, snapshot: snap()}); }};
        };
        return {ref: (p) => ref(p || '')};
      }
    };
  }, {data: dadosComSetores(perfil), atraso: atraso});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'tr.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file),
      contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://tr.test/' + pagina);
  await page.waitForSelector('.kt-sidebar', {timeout: 8000});
  return {page, errors};
}





const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const db = (page) => page.evaluate(() => window.__db);
const clicarResp = (page, n, r) => page.locator('.resp[data-n="' + n + '"] button[data-r="' + r + '"]').click();

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // ── Líder ──
    let {page, errors} = await abrir(browser, 'auditoria_5s.html', 'lider');
    await page.waitForSelector('#abas [data-aba]', {timeout: 8000});
    assert.match(await page.locator('#quemSou').innerText(), /Líder: Produção/);
    assert.match(await page.locator('#faixaTreino').innerText(), /treinamento/i, 'fase de testes sinalizada');
    let painel = await page.locator('#conteudo').innerText();
    assert.match(painel, /Produção/);
    assert.match(painel, /não fez/, 'checklist de hoje ainda não feito');
    assert.ok(!/Recepção/.test(painel), 'o líder só vê o setor dele');
    assert.match(painel, /Fulana Teste/, 'líder indicado do setor aparece no painel');
    assert.match(painel, /Linha 1 · Linha 2/, 'áreas do setor aparecem no painel');
    assert.equal(await page.locator('[data-aba="config"]').count(), 0, 'configuração é do admin');
    await page.click('[data-ini="Produção"]');
    await page.waitForSelector('#it1');
    // todos C, menos o 3 (NC) e o 5 crítico não aceita NA
    for (const n of ['1', '2', '4', '5', '6', '7', '8']) await clicarResp(page, n, 'C');
    assert.equal(await page.locator('.resp[data-n="5"] button[data-r="NA"]').count(), 0, 'item crítico não tem NA');
    await clicarResp(page, '3', 'NC');
    await page.waitForSelector('[data-foto="3"] input[type=file]', {state: 'attached'});
    assert.match(await page.locator('#aoVivo').innerText(), /88%|87%/);
    await page.selectOption('#fTurno', '1º');
    // tentativa de finalizar sem completar o NC e sem as perguntas
    await page.click('#btnFinalizar');
    let erros = await page.locator('#errosForm').innerText();
    assert.match(erros, /Item 3 \(NC\): informe o local/);
    assert.match(erros, /Item 3 \(NC\): anexe ao menos uma foto/);
    assert.match(erros, /Item 3 \(NC\): descreva a ação imediata/);
    assert.match(erros, /Item 3 \(NC\): indique o responsável/);
    assert.match(erros, /Pergunta 9/);
    // preenche o NC
    assert.equal(await page.locator('#dlAreas option').count(), 2, 'áreas do setor como sugestão do local da falha');
    await page.fill('[data-c="local"][data-n="3"]', 'Linha 1');
    await page.press('[data-c="local"][data-n="3"]', 'Tab');
    assert.equal(await page.locator('[data-c="responsavel"][data-n="3"]').inputValue(), 'Maria Souza', 'a área tem responsável: já vem sugerido');
    await page.fill('[data-c="acao"][data-n="3"]', 'Limpar a bancada agora');
    await page.setInputFiles('[data-foto="3"] input[type=file]', {name: 'bancada.png', mimeType: 'image/png', buffer: PNG});
    // perguntas da seção B
    await page.click('[data-p="mutirao"] [data-v="SIM"]');
    await page.fill('[data-pf="mutiraoHorario"]', '17:30'); await page.fill('[data-pf="mutiraoMinutos"]', '10');
    await page.click('[data-p="todosParticiparam"] [data-v="SIM"]');
    await page.click('[data-p="pendenciasOntem"] [data-v="SIM"]');
    await page.fill('[data-pf="ocorrencias"]', '0');
    await page.click('#btnFinalizar');
    await page.waitForSelector('#relPrint', {timeout: 8000});
    let d = await db(page);
    const ids = Object.keys(d.auditorias_5s);
    assert.equal(ids.length, 1);
    const a = d.auditorias_5s[ids[0]];
    assert.equal(a.tipo, 'LIDER'); assert.equal(a.setor, 'Produção'); assert.equal(a.turno, '1º');
    assert.equal(a.resultado.status, 'VERDE'); assert.equal(a.resultado.nc, 1); assert.equal(a.resultado.c, 7);
    assert.equal(a.treinamento, true);
    assert.equal(a.assinatura.nome, 'Fulana Teste'); assert.equal(a.assinatura.metodo, 'digital'); assert.ok(a.fechadaEm);
    assert.equal(a.itens['3'].fotos.length, 1, 'a foto subiu e ficou no registro');
    assert.match(a.itens['3'].fotos[0].url, /fotos\.test\/qualidade\/5s_/);
    assert.match(a.linhaControle, /;Produção;1º;Fulana Teste;Checklist do líder;C,C,NC,C,C,C,C,C;Sim;VERDE 88%/);
    const acoes = Object.values(d.acoes_5s);
    assert.equal(acoes.length, 1);
    assert.deepEqual([acoes[0].item, acoes[0].responsavel, acoes[0].status, acoes[0].prazo], ['3', 'Maria Souza', 'ABERTA', '48 h']);
    // relatório
    const rel = await page.locator('#relPrint').innerText();
    assert.match(rel, /Checklist do líder — Produção/);
    assert.match(rel, /VERDE/); assert.match(rel, /Linha 1/);
    assert.match(rel, /Consequência sugerida/i); assert.match(rel, /reconhecer o setor/);
    assert.match(rel, /assinado digitalmente/);
    assert.equal(await page.locator('#relPrint .fotos img').count(), 1);
    // ciência da gerência
    await page.click('[data-ciencia="gerencia"]');
    await page.waitForFunction(() => window.__db.ciencia_5s && Object.keys(window.__db.ciencia_5s).length === 1);
    await page.click('#relFechar');
    // Plano de ações: resolver
    await page.click('[data-aba="acoes"]');
    await page.waitForSelector('[data-resolver]');
    await page.click('[data-resolver]');
    await page.waitForFunction(() => Object.values(window.__db.acoes_5s)[0].status === 'RESOLVIDA');
    // Ocorrência individual: o líder registra, não lista
    await page.click('[data-aba="ocorrencias"]');
    await page.waitForSelector('#oColab');
    assert.match(await page.locator('#conteudo').innerText(), /lista com nomes é restrita/);
    await page.fill('#oColab', 'Maria Souza'); await page.selectOption('#oSetor', 'Produção'); await page.fill('#oDesc', 'Item 4: caixa fora da faixa');
    await page.click('#oSalvar');
    await page.waitForFunction(() => Object.keys(window.__db.ocorrencias_5s).length === 1);
    d = await db(page);
    const oc = Object.values(d.ocorrencias_5s)[0];
    assert.deepEqual([oc.colaboradorId, oc.setor, oc.treinamento, oc.registradoPorNome], ['p1', 'Produção', true, 'Fulana Teste']);
    assert.ok(!oc.degrauSugerido, 'o líder não vê o histórico, então não grava degrau');
    assert.deepEqual(errors, [], 'erros (líder): ' + errors.join(' | '));
    await page.close();

    // ── Auditor da Qualidade ──
    ({page, errors} = await abrir(browser, 'auditoria_5s.html', 'auditor'));
    await page.waitForSelector('#abas [data-aba]');
    assert.match(await page.locator('#quemSou').innerText(), /Auditor/);
    await page.click('[data-aba="nova"]');
    await page.waitForSelector('#it1');
    await page.selectOption('#fSetor', 'Expedição');
    for (let i = 1; i <= 20; i++) await clicarResp(page, String(i), 'C');
    for (const c of ['C1', 'C2', 'C4']) await clicarResp(page, c, 'C');
    await clicarResp(page, 'C3', 'NC');
    await page.fill('[data-c="local"][data-n="C3"]', 'Doca 2');
    await page.fill('[data-c="acao"][data-n="C3"]', 'Reposição de EPI imediata');
    await page.fill('[data-c="responsavel"][data-n="C3"]', 'Maria Souza');
    await page.setInputFiles('[data-foto="C3"] input[type=file]', {name: 'epi.png', mimeType: 'image/png', buffer: PNG});
    assert.match(await page.locator('#aoVivo').innerText(), /VERMELHO: ITEM CRÍTICO/);
    await page.click('#segLider [data-v="NAO"]');
    await page.click('#btnFinalizar');
    erros = await page.locator('#errosForm').innerText();
    assert.match(erros, /V1: responda/); assert.match(erros, /V2: responda/);
    await page.click('[data-v2="v1"] [data-v="NAO"]');
    await page.click('[data-v2="v2"] [data-v="NAO"]');
    await page.click('#btnFinalizar');
    assert.match(await page.locator('#errosForm').innerText(), /itens que o líder marcou C/);
    await clicarResp(page, '9', 'NC');
    await page.fill('[data-c="local"][data-n="9"]', 'Piso da doca');
    await page.fill('[data-c="acao"][data-n="9"]', 'Limpeza');
    await page.fill('[data-c="responsavel"][data-n="9"]', 'Maria Souza');
    await page.setInputFiles('[data-foto="9"] input[type=file]', {name: 'piso.png', mimeType: 'image/png', buffer: PNG});
    await page.click('[data-div="9"]');
    await page.click('#btnFinalizar');
    await page.waitForSelector('#relPrint', {timeout: 8000});
    d = await db(page);
    const aq = Object.values(d.auditorias_5s)[0];
    assert.equal(aq.tipo, 'QUALIDADE'); assert.equal(aq.setor, 'Expedição'); assert.equal(aq.surpresa, true);
    assert.equal(aq.resultado.statusTexto, 'VERMELHO: ITEM CRÍTICO');
    assert.equal(aq.resultado.liderNaoConfere, true);
    assert.deepEqual(aq.divergencias, ['9']);
    assert.ok(aq.resultado.porSenso.Seiso.nc === 1);
    assert.equal(aq.acoesObrigatorias[0].n, 'C3');
    assert.equal(aq.acoesObrigatorias[0].prazo, 'hoje');
    const relq = await page.locator('#relPrint').innerText();
    assert.match(relq, /LÍDER NÃO CONFERE/); assert.match(relq, /Seiso/); assert.match(relq, /diretoria e apresenta plano de ação em 48 h/);
    await page.click('#relFechar');
    // o auditor vê o painel de todos os setores e a lista de ocorrências
    await page.click('[data-aba="painel"]');
    assert.match(await page.locator('#conteudo').innerText(), /Recepção/);
    assert.match(await page.locator('#conteudo').innerText(), /sem líder indicado/, 'setor sem líder aparece destacado');
    await page.click('[data-aba="ocorrencias"]');
    await page.waitForSelector('#oColab');
    await page.fill('#oColab', 'Maria Souza');
    assert.match(await page.locator('#oSugestao').innerText(), /1ª ocorrência: orientação verbal/);
    assert.match(await page.locator('#oSugestao').innerText(), /Nenhuma punição é aplicada pelo sistema/);
    await page.click('#oSeg');
    assert.match(await page.locator('#oSugestao').innerText(), /2ª ocorrência: orientação por escrito/, 'segurança sobe um degrau');
    assert.deepEqual(errors, [], 'erros (auditor): ' + errors.join(' | '));
    await page.close();

    // ── Admin: configuração ──
    // ── Auditora que também é líder: rodízio ──
    ({page, errors} = await abrir(browser, 'auditoria_5s.html', 'auditoraLider'));
    await page.waitForSelector('#abas [data-aba]');
    const linhaLab = page.locator('#conteudo tr', {hasText: 'Laboratório'}).first();
    await linhaLab.waitFor();
    assert.match(await linhaLab.innerText(), /Fulana Teste, Beltrano|Beltrano, Fulana Teste/, 'as duas aparecem como líderes');
    assert.match(await linhaLab.innerText(), /Rodízio: checklist de Beltrano → auditoria de Fulana Teste/);
    await page.click('[data-aba="nova"]');
    await page.waitForSelector('[data-tipo="LIDER"]');
    assert.equal(await page.locator('[data-tipo="QUALIDADE"]').count(), 1, 'auditora-líder escolhe entre auditar e o checklist');
    await page.click('[data-tipo="LIDER"]');
    await page.waitForSelector('#fSetor');
    assert.deepEqual((await page.locator('#fSetor option').allInnerTexts()).filter((x) => x !== 'Escolha…'), ['Laboratório'], 'checklist só nos setores que lidera');
    assert.deepEqual(errors, [], 'erros (auditora-líder): ' + errors.join(' | '));
    await page.close();

    ({page, errors} = await abrir(browser, 'auditoria_5s.html', 'admin'));
    await page.waitForSelector('[data-aba="config"]');
    await page.click('[data-aba="config"]');
    await page.waitForSelector('[data-salvar-u]');
    await page.selectOption('[data-papel="u2"]', 'LIDER');
    await page.check('[data-setor-u="u2"][value="Recepção"]');
    await page.click('[data-salvar-u="u2"]');
    await page.waitForFunction(() => window.__db.auditoria5s_config.usuarios && window.__db.auditoria5s_config.usuarios.u2);
    d = await db(page);
    assert.deepEqual([d.auditoria5s_config.usuarios.u2.papel, d.auditoria5s_config.usuarios.u2.setores], ['LIDER', ['Recepção']]);
    await page.fill('#cVerde', '90'); await page.fill('#cAmarelo', '75'); await page.uncheck('#cTreino');
    await page.click('#cSalvarParam');
    await page.waitForFunction(() => window.__db.auditoria5s_config.modoTreinamento === false);
    d = await db(page);
    assert.deepEqual([d.auditoria5s_config.parametros.verde, d.auditoria5s_config.parametros.amarelo], [0.9, 0.75]);
    await page.fill('#cEquipe', 'Maria Souza;Produção\nJoão Lima;Expedição');
    await page.click('#cSalvarEquipe');
    await page.waitForFunction(() => window.__db.auditoria5s_config.equipe && Object.keys(window.__db.auditoria5s_config.equipe).length === 2);
    // Setores e áreas: o admin edita a lista inicial, indica o responsável da área e cria setor
    assert.equal(await page.locator('[data-sa]').count(), 15, 'começa com a lista inicial');
    await page.fill('[data-ar="0:0"]', 'Maria Souza');
    await page.click('[data-aadd="8"]');                       // Expedição: nova área
    await page.fill('[data-an="8:2"]', 'Portaria');
    await page.click('#sAdd');
    await page.fill('[data-sn="15"]', 'Doca Externa');
    await page.uncheck('[data-sa="14"]');                       // Reciclagem desativada
    await page.click('#sSalvar');
    await page.waitForFunction(() => window.__db.auditoria5s_config.setores && Object.keys(window.__db.auditoria5s_config.setores).length === 16);
    d = await db(page);
    const st = d.auditoria5s_config.setores;
    assert.equal(st.s01.nome, 'Produção');
    assert.deepEqual(st.s01.areas.a01, {nome: 'Linha 1', responsavel: 'Maria Souza'});
    assert.deepEqual(Object.values(st.s09.areas).map((x) => x.nome), ['Estoque', 'Doca', 'Portaria']);
    assert.equal(st.s16.nome, 'Doca Externa');
    assert.equal(st.s15.ativo, false, 'Reciclagem desativada, não apagada');
    assert.deepEqual(errors, [], 'erros (admin): ' + errors.join(' | '));
    await page.close();
  } finally {
    await browser.close();
  }
  console.log('OK Auditoria 5S (tela): líder com NC e foto, relatório e ciência, auditoria da Qualidade com crítico e líder que não confere, ocorrências restritas, configuração e rodízio da auditora-líder.');
})().catch((e) => { console.error(e); process.exit(1); });
