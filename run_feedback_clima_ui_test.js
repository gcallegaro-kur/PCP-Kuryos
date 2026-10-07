'use strict';
/* Feedback e Clima, telas reais com Firebase simulado:
   - feedback.html (colaborador): cartões de colegas/temporário/líder, validação, envio, clima, aviso honesto, políticas de anonimato;
   - rh_feedback.html (RH): dashboard com N, pendências, respostas, recados, configuração e diretório. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const F = require('./public/shared/feedback-clima.js');

const hoje = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const PER = F.periodoDe(hoje, {}), ANT = F.periodoAnterior(PER, {});
const DIR = {
  L: {nome: 'Lúcia Líder', setor: 'Produção', setorChave: 'producao', tipo: 'colaborador', status: 'Ativo'},
  A: {nome: 'Ana', setor: 'Produção', setorChave: 'producao', gestorKey: 'L', tipo: 'colaborador', status: 'Ativo'},
  B: {nome: 'Bia', setor: 'Produção', setorChave: 'producao', gestorKey: 'L', tipo: 'colaborador', status: 'Ativo'},
  C: {nome: 'Caio', setor: 'Produção', setorChave: 'producao', gestorKey: 'L', tipo: 'colaborador', status: 'Ativo'},
  T1: {nome: 'Davi Temporário', setor: 'Produção', setorChave: 'producao', tipo: 'temporario', status: 'Ativo', ultimoOk: hoje},
  T2: {nome: 'Eva Parada', setor: 'Produção', setorChave: 'producao', tipo: 'temporario', status: 'Ativo', ultimoOk: '2020-01-01'}
};
let VARIANTE = 'colab';
function dadosComSetores(perfil) {
  const base = {usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: perfil}}, feedback_config: {}, feedback_diretorio: DIR, feedback_diretorio_por_uid: {u1: 'A'},
    feedback_feitos: {}, feedback_respostas: {}, clima_respostas: {}, feedback_participacao: {}, clima_recados_lidos: {}};
  if (VARIANTE === 'anon') base.feedback_config = {ciclo: {rhVeAutoria: false, rhVeAutoriaClima: false}};
  if (VARIANTE === 'semvinculo') base.feedback_diretorio_por_uid = {};
  if (VARIANTE === 'semsetor') { base.feedback_diretorio = Object.assign({}, DIR, {A: Object.assign({}, DIR.A, {setor: null, setorChave: null})}); }
  if (VARIANTE === 'rh') {
    const nota = (v) => ({'espirito-de-equipe': v, habilidade: v, respeito: v, comunicacao: v});
    const mk = (tipo, av, notas, extra) => Object.assign({tipo: tipo, avaliadoId: av, avaliadorId: 'A', notas: notas, criadoEm: hoje + 'T12:00:00Z'}, extra || {});
    base.feedback_respostas[PER.id] = {
      r1: mk('par', 'B', nota(4)), r2: mk('par', 'B', {'espirito-de-equipe': 5, habilidade: 3, respeito: 4, comunicacao: 4}, {avaliadorId: 'C'}), r3: mk('par', 'C', {'espirito-de-equipe': 2, habilidade: 3, respeito: 2, comunicacao: 3}),
      l1: mk('lider', 'L', {clareza: 4, apoio: 4, feedback: 5, respeito: 5}), l2: mk('lider', 'L', {clareza: 2, apoio: 3, feedback: 3, respeito: 2}, {avaliadorId: 'B'}), l3: mk('lider', 'L', {clareza: 3, apoio: 3, feedback: 3, respeito: 3}, {avaliadorId: 'C', comentario: 'Poderia dar mais retorno'})
    };
    base.feedback_respostas[ANT.id] = {k1: mk('par', 'B', nota(5))};
    const cl = (id, r, extra) => Object.assign({colaboradorId: id, setor: 'Produção', respostas: r, criadoEm: hoje + 'T12:00:00Z'}, extra || {});
    base.clima_respostas[PER.id] = {c1: cl('A', {humor: 5, condicoes: 4, recomendaria: 5}), c2: cl('B', {humor: 3, condicoes: 3, recomendaria: 4}), c3: cl('C', {humor: 2, condicoes: 2, recomendaria: 2}, {recadoRh: 'Faltam luvas no posto 2'})};
    base.clima_respostas[ANT.id] = {c1: cl('A', {humor: 4, condicoes: 4, recomendaria: 4}), c2: cl('B', {humor: 4, condicoes: 4, recomendaria: 4})};
    base.feedback_participacao[PER.id] = {A: {pares: 3, lider: true, clima: true, atualizadoEm: 'x'}, B: {pares: 3, lider: true, clima: true, atualizadoEm: 'x'}, C: {clima: true, atualizadoEm: 'x'}};
    base.rh_colaboradores = {
      L: {nome: 'Lúcia Líder', setor: 'Produção', status: 'Ativo', sexo: 'feminino', tipoContrato: 'CLT', dataAdmissao: '2018-01-01', uidLogin: 'uL'},
      A: {nome: 'Ana', setor: 'Produção', gestorKey: 'L', status: 'Ativo', sexo: 'feminino', tipoContrato: 'CLT', dataAdmissao: '2026-08-01', uidLogin: 'u1', cpf: '111'},
      B: {nome: 'Bia', setor: 'Produção', gestorKey: 'L', status: 'Ativo', sexo: 'masculino', tipoContrato: 'CLT', dataAdmissao: '2025-01-10'},
      C: {nome: 'Caio', setor: 'Produção', gestorKey: 'L', status: 'Ativo', sexo: 'masculino', tipoContrato: 'PJ', dataAdmissao: '2020-03-02'},
      N: {nome: 'Nova Pessoa', cargoKey: 'cg1', status: 'Ativo', uidLogin: 'uN'}
    };
    base.rh_cargos = {cg1: {nome: 'Operador', setor: 'Rotulagem'}};
    base.rh_temporarios = {T1: {nome: 'Davi Temporário', setor: 'Produção', status: 'Ativo'}};
    base.rh_temporarios_presenca = {[hoje]: {T1: 'OK'}};
    base.feedback_diretorio_por_uid = {u1: 'A', uOld: 'X'};
  }
  return base;
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






const db = (page) => page.evaluate(() => window.__db);
const nota = (page, escopo, crit, n) => page.locator(escopo + ' .nt[data-c="' + crit + '"][data-n="' + n + '"]').click();
const esperar = (page, fn, arg) => page.waitForFunction(fn, arg, {timeout: 8000});

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    // ═══ colaborador ═══
    VARIANTE = 'colab';
    let r = await abrir(browser, 'feedback.html', 'production');
    let page = r.page;
    await page.waitForSelector('.alvo', {timeout: 8000});
    assert.match(await page.locator('#periodoTxt').innerText(), /prazo/);
    let txt = await page.locator('#conteudo').innerText();
    assert.match(txt, /Bia/); assert.match(txt, /Caio/); assert.match(txt, /Davi Temporário/); assert.match(txt, /Lúcia Líder/);
    assert.ok(!/Eva Parada/.test(txt), 'temporário parado não aparece');
    assert.match(await page.locator('.alvo', {hasText: 'Davi Temporário'}).innerText(), /Temporário/);
    assert.match(await page.locator('.alvo', {hasText: 'Lúcia Líder'}).innerText(), /Seu líder/);
    assert.match(txt, /0 de 4/);
    assert.match(txt, /não entra/); assert.match(txt, /consegue ver quem avaliou/); assert.match(txt, /também consegue ver quem respondeu/);
    assert.ok(!/média/i.test(txt) && !/Resultado:/.test(txt), 'colaborador não vê resultado');
    // sem nota: bloqueia
    const cartaoBia = page.locator('.alvo[data-alvo="B"]');
    await cartaoBia.locator('.enviar').click();
    assert.match(await cartaoBia.locator('.erros').innerText(), /Dê uma nota de 1 a 5/);
    assert.equal(Object.keys((await db(page)).feedback_respostas || {}).length, 0);
    for (const c of ['espirito-de-equipe', 'habilidade', 'respeito', 'comunicacao']) await nota(page, '.alvo[data-alvo="B"]', c, 4);
    await cartaoBia.locator('.com').fill('Ajuda sempre');
    await cartaoBia.locator('.enviar').click();
    await esperar(page, (p) => window.__db.feedback_respostas && window.__db.feedback_respostas[p] && Object.keys(window.__db.feedback_respostas[p]).length === 1, PER.id);
    let d = await db(page);
    const resp = Object.values(d.feedback_respostas[PER.id])[0];
    assert.equal(resp.tipo, 'par'); assert.equal(resp.avaliadoId, 'B'); assert.equal(resp.avaliadorId, 'A'); assert.equal(resp.notas.habilidade, 4); assert.equal(resp.comentario, 'Ajuda sempre'); assert.equal(resp.setor, 'Produção');
    assert.equal(d.feedback_feitos[PER.id].u1.B, true);
    assert.equal(d.feedback_participacao[PER.id].A.pares, 1); assert.equal(d.feedback_participacao[PER.id].A.esperadoPares, 3);
    await page.waitForFunction(() => /1 de 4/.test(document.querySelector('#conteudo').innerText));
    assert.equal(await page.locator('.alvo[data-alvo="B"]').count(), 0, 'já respondido sai da fila e não dá para editar');
    // líder
    for (const c of ['clareza', 'apoio', 'feedback', 'respeito']) await nota(page, '.alvo[data-alvo="L"]', c, 5);
    await page.locator('.alvo[data-alvo="L"] .enviar').click();
    await esperar(page, (p) => Object.values(window.__db.feedback_respostas[p]).some(x => x.tipo === 'lider'), PER.id);
    d = await db(page); assert.equal(d.feedback_participacao[PER.id].A.lider, true);
    // clima
    await page.locator('#enviarClima').click();
    assert.match(await page.locator('#errosClima').innerText(), /Responda de 1 a 5/);
    for (const q of ['humor', 'condicoes', 'recomendaria']) await page.locator('#cardClima .nt[data-q="' + q + '"][data-n="3"]').click();
    await page.fill('#recado', 'Faltam luvas');
    await page.locator('#enviarClima').click();
    await esperar(page, (p) => window.__db.clima_respostas && window.__db.clima_respostas[p] && Object.keys(window.__db.clima_respostas[p]).length === 1, PER.id);
    d = await db(page);
    const cl = Object.values(d.clima_respostas[PER.id])[0];
    assert.equal(cl.colaboradorId, 'A'); assert.equal(cl.recadoRh, 'Faltam luvas'); assert.equal(cl.respostas.humor, 3); assert.equal(d.feedback_feitos[PER.id].u1._clima, true); assert.equal(d.feedback_participacao[PER.id].A.clima, true);
    await page.waitForFunction(() => /respondida/.test(document.querySelector('#conteudo').innerText));
    assert.deepEqual(r.errors, []);
    await page.close();

    // ═══ política de anonimato ligada ═══
    VARIANTE = 'anon';
    r = await abrir(browser, 'feedback.html', 'production'); page = r.page;
    await page.waitForSelector('.alvo');
    txt = await page.locator('#conteudo').innerText();
    assert.match(txt, /não vê quem avaliou/); assert.match(txt, /sem o seu nome/);
    for (const c of ['espirito-de-equipe', 'habilidade', 'respeito', 'comunicacao']) await nota(page, '.alvo[data-alvo="C"]', c, 5);
    await page.locator('.alvo[data-alvo="C"] .enviar').click();
    await esperar(page, (p) => window.__db.feedback_respostas && window.__db.feedback_respostas[p], PER.id);
    d = await db(page);
    assert.ok(!('avaliadorId' in Object.values(d.feedback_respostas[PER.id])[0]), 'sem autoria gravada');
    assert.equal(d.feedback_participacao[PER.id].A.pares, 1, 'a participação continua registrada (sem conteúdo)');
    for (const q of ['humor', 'condicoes', 'recomendaria']) await page.locator('#cardClima .nt[data-q="' + q + '"][data-n="4"]').click();
    await page.locator('#enviarClima').click();
    await esperar(page, (p) => window.__db.clima_respostas && window.__db.clima_respostas[p], PER.id);
    d = await db(page); assert.ok(!('colaboradorId' in Object.values(d.clima_respostas[PER.id])[0]));
    await page.close();

    // ═══ sem vínculo e sem setor ═══
    VARIANTE = 'semvinculo';
    r = await abrir(browser, 'feedback.html', 'production'); page = r.page;
    await page.waitForFunction(() => /ainda não está ligado/.test(document.querySelector('#conteudo').innerText), null, {timeout: 8000});
    assert.equal(await page.locator('.alvo').count(), 0); await page.close();
    VARIANTE = 'semsetor';
    r = await abrir(browser, 'feedback.html', 'production'); page = r.page;
    await page.waitForSelector('.alvo');
    assert.match(await page.locator('#conteudo').innerText(), /sem setor/);
    assert.equal(await page.locator('.alvo').count(), 1, 'sem setor só avalia o líder'); await page.close();

    // ═══ RH ═══
    VARIANTE = 'rh';
    r = await abrir(browser, 'rh_feedback.html', 'rh'); page = r.page;
    await page.waitForSelector('[data-aba="painel"]', {timeout: 8000});
    await page.waitForFunction(() => /1\. O ciclo está rodando/.test(document.querySelector('#conteudo').innerText), null, {timeout: 10000});
    txt = await page.locator('#conteudo').innerText();
    assert.match(txt, /Participação/); assert.match(txt, /52%|53%|\d+%/);
    assert.match(txt, /Índice do período/); assert.match(txt, /3,33/, 'índice do clima'); assert.match(txt, /N=3/);
    assert.match(txt, /eNPS/); assert.match(txt, /\b33\b/);
    assert.match(txt, /Lúcia Líder/); assert.match(txt, /3,33/);
    assert.match(txt, /Faltam|Recados ao RH/);
    assert.match(txt, /queda brusca/i); assert.match(txt, /Setor Produção/);
    const dpt = await db(page);
    assert.equal(dpt.feedback_diretorio.N.setor, 'Rotulagem', 'o diretório se atualiza sozinho (setor do cargo)');
    assert.equal(dpt.feedback_diretorio_por_uid.uN, 'N'); assert.ok(!('uOld' in (dpt.feedback_diretorio_por_uid || {})) , 'vínculo antigo removido');
    assert.ok(!JSON.stringify(dpt.feedback_diretorio).includes('"cpf"'), 'nada sensível no diretório');
    assert.equal(dpt.feedback_diretorio.T1.ultimoOk, hoje);
    // pendências
    await page.click('[data-aba="pendencias"]');
    await page.waitForSelector('#btnCopiar');
    txt = await page.locator('#conteudo').innerText();
    assert.match(txt, /Caio/); assert.match(txt, /colegas a avaliar/); assert.match(txt, /sem login vinculado/);
    // respostas com autoria
    await page.click('[data-aba="respostas"]');
    await page.waitForSelector('#fAv');
    txt = await page.locator('#conteudo').innerText();
    assert.match(txt, /Poderia dar mais retorno/); assert.match(txt, /Ana/);
    await page.selectOption('#fAv', 'C');
    assert.equal(await page.locator('table tbody tr').count(), 1);
    // recados
    await page.click('[data-aba="recados"]');
    await page.waitForSelector('[data-lido]');
    assert.match(await page.locator('#conteudo').innerText(), /Faltam luvas no posto 2/);
    await page.click('[data-lido]');
    await esperar(page, (p) => window.__db.clima_recados_lidos[p] && Object.keys(window.__db.clima_recados_lidos[p]).length === 1, PER.id);
    // configuração: virada só em segunda; formulário até 8 itens
    await page.click('[data-aba="config"]');
    await page.waitForSelector('#cSalvar');
    await page.fill('#cViradaData', '2026-11-03'); await page.click('#cSalvar');
    assert.match(await page.locator('#erCiclo').innerText(), /segunda-feira/);
    await page.fill('#cViradaData', '2026-11-09'); await page.uncheck('#cAutoriaClima'); await page.fill('#cLimLider', '3,5'); await page.click('#cSalvar');
    await esperar(page, () => window.__db.feedback_config && window.__db.feedback_config.ciclo && window.__db.feedback_config.ciclo.rhVeAutoriaClima === false);
    d = await db(page);
    assert.equal(d.feedback_config.ciclo.quinzenalAPartirDe, '2026-11-09'); assert.equal(d.feedback_config.ciclo.limiteLider, 3.5);
    for (let i = 0; i < 4; i++) await page.click('[data-add="par"]');       // 4 + 4 = 8 (itens vazios), falta nome
    await page.click('[data-salvar-modelo="par"]');
    assert.match(await page.locator('#er-par').innerText(), /sem nome/);
    await page.click('[data-add="par"]');
    await page.click('[data-salvar-modelo="par"]');
    assert.match(await page.locator('#er-par').innerText(), /no máximo 8/);
    // remove os 5 itens novos (os últimos) e acrescenta um bom
    for (let i = 0; i < 5; i++) await page.locator('#ed-par .ed').last().locator('[data-rm]').click();
    await page.click('[data-add="par"]');
    await page.locator('#ed-par .ed').last().locator('.ed-nome').fill('Pontualidade');
    await page.locator('#ed-par .ed').last().locator('.ed-def').fill('Chega no horário.');
    await page.click('[data-salvar-modelo="par"]');
    await esperar(page, () => window.__db.feedback_config && window.__db.feedback_config.modeloPar && window.__db.feedback_config.modeloPar.length === 5);
    d = await db(page);
    assert.equal(d.feedback_config.modeloPar[4].id, 'pontualidade'); assert.equal(d.feedback_config.modeloPar[0].id, 'espirito-de-equipe');
    // diretório: contagem na tela
    assert.match(await page.locator('#conteudo').innerText(), /Sem login vinculado/);
    await page.click('#cSync');
    assert.deepEqual(r.errors, []);
    await page.close();
    // quem não é RH não abre
    r = await abrir(browser, 'feedback.html', 'rh');
    const acesso = await r.page.evaluate(() => ['rh', 'admin', 'pcp', 'production', 'rotulagem', 'logistica', 'qualidade', 'gestor', 'pending'].map(role => [role, podeAbrirPagina({role: role}, 'rh_feedback.html'), podeAbrirPagina({role: role}, 'feedback.html')]));
    assert.deepEqual(acesso, [['rh', true, true], ['admin', true, true], ['pcp', false, true], ['production', false, true], ['rotulagem', false, true], ['logistica', false, true], ['qualidade', false, true], ['gestor', false, true], ['pending', false, false]]);
    console.log('OK UI Feedback e Clima: colaborador (cartões, validação, envio, clima, anonimato, sem vínculo/sem setor) e RH (dashboard com N, pendências, respostas, recados, configuração e diretório).');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
