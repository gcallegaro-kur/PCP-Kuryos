'use strict';
/* Calendário de agendamentos na Logística (logistica.html, aba Calendário).
   Tela real com utils.js e auth_check.js reais; Firebase simulado em memória.
   Datas relativas a hoje, para o teste não envelhecer. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const hoje = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'});
const somar = (d, k) => new Date(Date.parse(d + 'T12:00:00Z') + k * 86400000).toISOString().slice(0, 10);
const amanha = somar(hoje, 1), ontem = somar(hoje, -3), depois = somar(hoje, 2);

function dados() {
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    config: {}, fornecedores: {}, materiais: {}, enderecos_estoque: {}, estoque_lotes: {}, clientes: {},
    pedidos_compra: {
      pc1: {status: 'ENVIADO', numeroFormatado: 'PC-0010', fornecedorNome: 'LOMAR PACK', dataCriacao: hoje, itens: {a: {materialCodigo: 'EP-1', qtd: 100, unidade: 'un'}},
        agendamento: {dataAgendada: amanha, janela: 'manha', transportadora: 'Transp Norte', responsavelTransporte: 'REMETENTE'}},
      pc2: {status: 'RECEBIDO_PARCIAL', numeroFormatado: 'PC-0011', fornecedorNome: 'VIDROS SA', dataCriacao: hoje, itens: {a: {materialCodigo: 'EP-2', qtd: 100, qtdRecebida: 40, unidade: 'un'}},
        agendamento: {dataAgendada: ontem, janela: 'tarde'}},
      pc3: {status: 'ENVIADO', numeroFormatado: 'PC-0012', fornecedorNome: 'RÓTULOS LTDA', dataCriacao: hoje, dataPrevistaEntrega: depois + 'T00:00:00Z', itens: {a: {materialCodigo: 'ET-1', qtd: 5000, unidade: 'un'}}}
    },
    agendamentos_expedicao: {
      ag1: {status: 'AGENDADO', revisao: 3, cliente: 'MISS ROSE', tipo: 'COLETA', dataAgendada: amanha, janela: '14h–16h', pedidos: {p: 'PED-0002'},
        paletes: [{quantidade: 295}, {quantidade: 240}], transportadora: 'Transp X', faturamento: {status: 'FATURADO', nfs: {n: {numero: '1500', serie: '1'}}}},
      ag2: {status: 'EXPEDIDO_PARCIAL', revisao: 5, cliente: 'WIKE MAKE', tipo: 'ENTREGA', dataAgendada: hoje, janela: '', pedidos: {p: 'PED-0007'},
        paletes: [{quantidade: 100, embarcado: 60}], viagens: {v1: {data: hoje}}, aguardandoEmbarqueDesde: new Date().toISOString()}
    }
  };
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1500, height: 1100}});
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(({data}) => {
      const db = data; window.__db = db; window.__iniciado = false;
      try { if (!sessionStorage.getItem('__cal_limpo')) { localStorage.removeItem('logistica-calendario'); sessionStorage.setItem('__cal_limpo', '1'); } } catch (e) {}
      const partes = (p) => String(p || '').split('/').filter(Boolean);
      const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
      const snapDe = (path) => { const v = ler(path); const c = v === undefined ? null : structuredClone(v); return {val: () => c, exists: () => c !== null, key: partes(path).pop()}; };
      const exige = (q) => { if (!window.__iniciado) throw new Error('sem app (' + q + ')'); };
      window.firebase = {
        initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
        auth() { exige('auth'); return {currentUser: {uid: 'u1', email: 'g@kuryos.com'}, onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com'}), 0); }, signOut() { return Promise.resolve(); }}; },
        functions() { return {httpsCallable: () => () => Promise.resolve({data: {}})}; },
        storage() { return {ref: () => ({})}; },
        database() {
          exige('database');
          const ref = (path) => ({path, key: partes(path).pop(),
            once(ev, cb) { const s = snapDe(path); if (cb) cb(s); return Promise.resolve(s); },
            on(ev, cb) { setTimeout(() => cb(path === '.info/connected' ? {val: () => true} : snapDe(path)), 0); return cb; }, off() {},
            child(c) { return ref(path + '/' + c); }, orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, startAt() { return this; }, limitToLast() { return this; },
            push() { return ref(path + '/-N' + Math.random().toString(36).slice(2, 8)); },
            set() { return Promise.resolve(); }, update() { return Promise.resolve(); }, remove() { return Promise.resolve(); },
            transaction(fn) { return Promise.resolve({committed: true, snapshot: snapDe(path)}); }});
          return {ref: (p) => ref(p || '')};
        }
      };
    }, {data: dados()});
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'cal.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + url.pathname.slice(1);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    await page.goto('https://cal.test/logistica.html?tab=calendario');
    await page.waitForFunction(() => document.getElementById('tab-calendario').classList.contains('active'), null, {timeout: 10000});
    await page.waitForFunction(() => document.querySelectorAll('#calGrade [data-ev]').length >= 4, null, {timeout: 10000});

    // ── Mês ────────────────────────────────────────────────────────────
    const titulo = await page.locator('#calTitulo').innerText();
    assert.match(titulo, /de \d{4}$/);
    assert.equal(await page.locator('#calGrade .cal-dia.hoje').count(), 1);
    const resumo = await page.locator('#calResumo').innerText();
    assert.match(resumo, /saída\(s\) de PA/);
    const chips = await page.locator('#calGrade [data-ev]').evaluateAll((els) => els.map((e) => e.dataset.ev + ' ' + e.className + ' ' + e.innerText));
    const chip = (id) => chips.find((c) => c.startsWith(id + ' ')) || '';
    assert.match(chip('pc:pc1'), /entrada sit-AGENDADO/);
    assert.match(chip('pc:pc1'), /↓ M · LOMAR PACK/);
    assert.match(chip('pa:ag1'), /saida sit-AGENDADO/);
    assert.match(chip('pa:ag1'), /↑ T · MISS ROSE/, 'janela "14h–16h" = tarde');
    assert.match(chip('pa:ag2'), /PARCIAL/);
    if (somar(hoje, -3).slice(0, 7) === hoje.slice(0, 7)) assert.match(chip('pc:pc2'), /sit-ATRASADO[\s\S]*⚠/);
    if (depois.slice(0, 7) === hoje.slice(0, 7)) assert.match(chip('pc:pc3'), /sit-PREVISTO/);
    if (process.env.CAL_SCREENSHOT) await page.locator('#tab-calendario .cal-card').screenshot({path: process.env.CAL_SCREENSHOT + '-mes.png'});

    // ── Filtros ────────────────────────────────────────────────────────
    await page.locator('#calF-entradas').uncheck();
    assert.equal(await page.locator('#calGrade .cal-ev.entrada').count(), 0);
    assert.ok(await page.locator('#calGrade .cal-ev.saida').count() >= 2);
    await page.locator('#calF-entradas').check();
    await page.locator('#calF-previstos').uncheck();
    assert.equal(await page.locator('#calGrade [data-ev="pc:pc3"]').count(), 0, 'sem previsão de Compras');
    await page.locator('#calF-previstos').check();

    // ── Detalhe: saída ─────────────────────────────────────────────────
    await page.locator('#calGrade [data-ev="pa:ag2"]').first().click();
    const det = await page.locator('#calDetalhe').innerText();
    assert.match(det, /Saída de produto acabado/);
    assert.match(det, /WIKE MAKE/);
    assert.match(det, /Aguardando embarque\s*40 un/);
    assert.equal(await page.locator('#calDetalhe a[href="expedicao.html?agenda=ag2"]').count(), 1);
    await page.locator('#calDetalhe [data-fechar]').click();

    // ── Detalhe: entrada → ação abre o modal de agendamento existente ──
    await page.locator('#calGrade [data-ev="pc:pc1"]').first().click();
    assert.match(await page.locator('#calDetalhe').innerText(), /PC-0010[\s\S]*Transp Norte[\s\S]*Recebido\s*0 de 100/);
    await page.locator('#calDetalhe [data-acao="agendar"]').click();
    await page.waitForFunction(() => document.getElementById('modalAgendar') && getComputedStyle(document.getElementById('modalAgendar')).display !== 'none', null, {timeout: 5000}).catch(() => null);
    assert.equal(await page.locator('#calDetalhe[open]').count(), 0, 'detalhe fecha ao abrir a ação');

    // ── Semana ─────────────────────────────────────────────────────────
    if (await page.locator('#modalAgendarClose').isVisible()) await page.locator('#modalAgendarClose').click();
    await page.locator('#calVista [data-vista="semana"]').click();
    assert.equal(await page.locator('#calGrade .cal-col').count(), 7);
    assert.equal(await page.locator('#calGrade .cal-col.hoje').count(), 1);
    const semana = await page.locator('#calGrade').innerText();
    assert.match(semana, /Manhã[\s\S]*LOMAR PACK/i);
    assert.match(semana, /Transp X/);
    if (process.env.CAL_SCREENSHOT) await page.locator('#tab-calendario .cal-card').screenshot({path: process.env.CAL_SCREENSHOT + '-semana.png'});
    await page.locator('#calProximo').click();
    assert.notEqual(await page.locator('#calTitulo').innerText(), '', 'navega');
    await page.locator('#calHoje').click();
    assert.equal(await page.locator('#calGrade .cal-col.hoje').count(), 1);
    // Preferência de vista lembrada.
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#calGrade .cal-col').length === 7, null, {timeout: 10000});

    // ── Celular ────────────────────────────────────────────────────────
    await page.setViewportSize({width: 390, height: 844});
    await page.waitForFunction(() => document.querySelector('#calGrade .cal-lista'), null, {timeout: 5000});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'sem rolagem lateral');
    if (process.env.CAL_SCREENSHOT) await page.screenshot({path: process.env.CAL_SCREENSHOT + '-celular.png'});

    assert.deepEqual(errors, [], 'erros: ' + errors.join(' | '));
    console.log('OK Calendário Logística: mês, semana, filtros, entradas/saídas/previstos/parciais, detalhe com ações, preferência lembrada e celular.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
