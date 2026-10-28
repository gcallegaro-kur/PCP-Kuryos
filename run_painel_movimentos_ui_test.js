'use strict';
/* Painel de movimentações do WMS (estoque.html, aba Histórico de Movimentações).
   Tela real com utils.js, kardex.js e auth_check.js reais; Firebase simulado em
   memória, com escuta ao vivo. Datas relativas a hoje. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const agora = Date.now();
const atras = (dias, horas) => new Date(agora - dias * 86400000 - (horas || 0) * 3600000).toISOString();

function dados() {
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    config: {}, estoque: {}, materiais: {}, produtos: {}, formulas: {}, bom: {}, ops: {}, estoque_lotes: {}, enderecos_estoque: {}, clientes: {}, fornecedores: {},
    movimentos_estoque: {
      'EP-00005': {
        a: {tipo: 'recebimento_pc', em: atras(3, 2), qtd: 5400, unidade: 'un', itemCodigo: 'EP-00005', itemNome: 'VÁLVULA SPRAY', itemTipo: 'material', loteKey: 'AK-1', enderecoKey: 'DOC-1-1-1', autor: 'Marcos Souza'},
        b: {tipo: 'transferencia', em: atras(2, 1), qtd: 5400, unidade: 'un', itemCodigo: 'EP-00005', itemNome: 'VÁLVULA SPRAY', itemTipo: 'material', loteKey: 'AK-1', enderecoKey: 'GAL-4-1-2', ref: 'DOC-1-1-1 -> GAL-4-1-2', autor: 'Diego Costa'},
        c: {tipo: 'consumo_producao', em: atras(0, 1), qtd: -1500, unidade: 'un', itemCodigo: 'EP-00005', itemTipo: 'material', ref: '26282/03'},
        d: {tipo: 'consumo', em: atras(0, 1), qtd: -1500, unidade: 'un', itemCodigo: 'EP-00005', itemTipo: 'material', loteKey: 'AK-1', enderecoCodigo: 'GAL-4.1.2', autor: 'Ana'}
      },
      'MRARBS12': {
        e: {tipo: 'conferencia_pa', em: atras(1, 0), qtd: 1792, unidade: 'un', itemCodigo: 'MRARBS12', itemNome: 'BODY SPLASH FLOR DAURA', itemTipo: 'produto', enderecoCodigo: 'DOC-1.1.1', autor: 'Adlai', opKey: '26282-03'},
        f: {tipo: 'qualidade', em: atras(1, 0), qtd: 0, itemCodigo: 'MRARBS12', itemTipo: 'produto', enderecoCodigo: 'DOC-1.1.1', autor: 'Roberta Ramos', motivo: 'QUALIDADE: LIBERADO'}
      },
      'MPGR-00066': {
        h: {tipo: 'perda', em: atras(0, 2), qtd: -2.5, unidade: 'kg', itemCodigo: 'MPGR-00066', itemNome: 'ÁLCOOL DE CEREAIS', itemTipo: 'material', ref: '26282/02'},
        i: {tipo: 'ajuste_manual', em: atras(40, 0), qtd: 10, unidade: 'kg', itemCodigo: 'MPGR-00066', itemTipo: 'material', autor: 'Diego Costa'}
      }
    }
  };
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1100}, acceptDownloads: true});
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(({data}) => {
      const db = data; window.__iniciado = false; window.__ouvintes = [];
      const partes = (p) => String(p || '').split('/').filter(Boolean);
      const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
      const snapDe = (path) => { const v = ler(path); const c = v === undefined ? null : structuredClone(v); return {val: () => c, exists: () => c !== null, key: partes(path).pop(), forEach() {}}; };
      const exige = (q) => { if (!window.__iniciado) throw new Error('sem app (' + q + ')'); };
      // Simula um movimento novo chegando ao vivo.
      window.__novoMovimento = (item, id, mov) => {
        db.movimentos_estoque[item] = db.movimentos_estoque[item] || {};
        db.movimentos_estoque[item][id] = mov;
        window.__ouvintes.filter((o) => o.path === 'movimentos_estoque').forEach((o) => o.cb(snapDe(o.path)));
      };
      window.firebase = {
        initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
        auth() { exige('auth'); return {currentUser: {uid: 'u1', email: 'g@kuryos.com'}, onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com'}), 0); }, signOut() { return Promise.resolve(); }}; },
        functions() { return {httpsCallable: () => () => Promise.resolve({data: {}})}; },
        storage() { return {ref: () => ({})}; },
        database() {
          exige('database');
          const ref = (path) => ({path, key: partes(path).pop(),
            once(ev, cb) { const s = snapDe(path); if (cb) cb(s); return Promise.resolve(s); },
            on(ev, cb) { window.__ouvintes.push({path, cb}); setTimeout(() => cb(path === '.info/connected' ? {val: () => true} : snapDe(path)), 0); return cb; }, off() {},
            child(c) { return ref(path + '/' + c); }, orderByChild() { return this; }, orderByKey() { return this; }, equalTo() { return this; }, startAt() { return this; }, endAt() { return this; }, limitToLast() { return this; }, limitToFirst() { return this; },
            push() { return ref(path + '/-N' + Math.random().toString(36).slice(2, 8)); },
            set() { return Promise.resolve(); }, update() { return Promise.resolve(); }, remove() { return Promise.resolve(); },
            transaction() { return Promise.resolve({committed: true, snapshot: snapDe(path)}); }});
          return {ref: (p) => ref(p || '')};
        }
      };
    }, {data: dados()});
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'mov.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + url.pathname.slice(1);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });

    // Antes de abrir a aba, o painel não lê nada (1 MB só quando precisa).
    await page.goto('https://mov.test/estoque.html');
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.__ouvintes.some((o) => o.path === 'movimentos_estoque')), false, 'não carrega antes de abrir a aba');
    await page.locator('#mainTabsEstoque .tab[data-tab="historico"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#pmLinha .pm-ev').length > 0, null, {timeout: 10000});

    // ── Padrão: 7 dias, sem a baixa FEFO ───────────────────────────────
    const kpi = async (k) => (await page.locator('#pmKpis [data-nat="' + k + '"] .pm-kpi-val').innerText()).trim();
    assert.match(await page.locator('#pmKpis .pm-kpi-total').innerText(), /MOVIMENTOS\s*6\s*3 itens/i, 'ajuste de 40 dias fica fora; espelho não conta');
    assert.equal(await kpi('CONSUMO'), '1');
    assert.equal(await kpi('ENTRADA'), '2');
    assert.equal(await kpi('SAIDA'), '0');
    assert.equal(await page.locator('#pmGrafico svg .pm-alvo').count(), 7, 'uma coluna por dia, dias vazios inclusive');
    assert.match(await page.locator('#pmGrafSub').innerText(), /6 movimentos em 7 dias/);
    assert.match(await page.locator('#pmLegenda').innerText(), /Entradas[\s\S]*Perdas/);
    const linha = await page.locator('#pmLinha').innerText();
    assert.match(linha, /^Hoje,/m);
    assert.match(linha, /DOC-1\.1\.1 → GAL-4\.1\.2/, 'transferência mostra origem → destino');
    assert.match(linha, /Automático/);
    assert.match(linha, /-1\.500 un/);
    assert.match(linha, /VÁLVULA SPRAY/, 'nome completado no consumo automático');
    assert.equal(await page.locator('#pmLinha a.pm-ev[href="kardex.html?item=EP-00005"]').count(), 3, 'movimento abre o Kardex do item');
    assert.match(await page.locator('#pmRankEnd').innerText(), /DOC-1\.1\.1/);
    assert.match(await page.locator('#pmVivo').innerText(), /Ao vivo/);
    if (process.env.MOV_SHOT) await page.locator('#tab-historico').screenshot({path: process.env.MOV_SHOT + '-painel.png'});

    // ── Tooltip ao passar sobre a barra de hoje ────────────────────────
    const alvo = page.locator('#pmGrafico .pm-alvo').last();
    await alvo.hover();
    const tip = await page.locator('#pmTooltip').innerText();
    assert.match(tip, /Hoje,[\s\S]*Consumos\s*1[\s\S]*Perdas\s*1[\s\S]*Total\s*2/);

    // ── Indicador filtra por natureza; clicar de novo solta ────────────
    await page.locator('#pmKpis [data-nat="TRANSFERENCIA"]').click();
    assert.equal(await page.locator('#pmLinha .pm-ev').count(), 1);
    assert.equal(await page.locator('#pmKpis [data-nat="ENTRADA"].off').count(), 1, 'as outras ficam apagadas, não somem');
    await page.locator('#pmKpis [data-nat="TRANSFERENCIA"]').click();
    assert.equal(await page.locator('#pmLinha .pm-ev').count(), 6);

    // ── Barra do dia fixa o dia; etiqueta solta ────────────────────────
    await page.locator('#pmGrafico .pm-alvo').last().click();
    assert.match(await page.locator('#pmFixados').innerText(), /Dia \d\d\/\d\d/);
    assert.equal(await page.locator('#pmLinha .pm-ev').count(), 2);
    await page.locator('#pmFixados [data-soltar="dia"]').click();
    assert.equal(await page.locator('#pmLinha .pm-ev').count(), 6);

    // ── Ranking fixa endereço / pessoa ─────────────────────────────────
    await page.locator('#pmRankAutor [data-valor="Automático"]').click();
    assert.equal(await page.locator('#pmLinha .pm-ev').count(), 2);
    assert.equal(await page.locator('#pmRankEnd .pm-vazio').count(), 1, 'consumo e perda automáticos não têm endereço (filtro cruzado)');
    // O próprio ranking não se filtra: dá para trocar de pessoa direto.
    await page.locator('#pmRankAutor [data-valor="Diego Costa"]').click();
    assert.equal(await page.locator('#pmLinha .pm-ev').count(), 1);
    await page.locator('#pmRankEnd [data-valor="DOC-1.1.1"]').click();
    assert.match(await page.locator('#pmFixados').innerText(), /Endereço DOC-1\.1\.1[\s\S]*Por Diego Costa/);
    assert.equal(await page.locator('#pmLinha .pm-ev').count(), 1, 'a transferência que saiu da doca');
    await page.locator('#pmFixados [data-soltar="tudo"]').click();
    assert.equal(await page.locator('#pmFixados button').count(), 0);

    // ── Busca, período, baixa por lote ─────────────────────────────────
    await page.locator('#pmBusca').fill('alcool');
    await page.waitForFunction(() => document.querySelectorAll('#pmLinha .pm-ev').length === 1, null, {timeout: 3000});
    await page.locator('#pmBusca').fill('');
    await page.locator('[data-dias="0"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#pmLinha .pm-ev').length === 7, null, {timeout: 3000});
    await page.locator('#pmEspelho').check();
    assert.equal(await page.locator('#pmLinha .pm-ev').count(), 8);
    assert.equal(await page.locator('#pmLinha .pm-ev-espelho').count(), 1);
    await page.locator('#pmEspelho').uncheck();
    await page.locator('[data-dias="7"]').click();

    // ── Ao vivo: movimento novo aparece sem recarregar ─────────────────
    await page.evaluate((em) => window.__novoMovimento('EP-00005', 'z', {tipo: 'expedicao_pa', em, qtd: -300, unidade: 'un', itemCodigo: 'EP-00005', itemTipo: 'material', autor: 'Robert Briz', enderecoCodigo: 'DOC-1.1.1'}), new Date().toISOString());
    await page.waitForFunction(() => document.querySelector('#pmKpis [data-nat="SAIDA"] .pm-kpi-val').textContent.trim() === '1', null, {timeout: 3000});
    assert.match(await page.locator('#pmLinha .pm-dia').first().innerText(), /Robert Briz/);

    // ── Exportar ───────────────────────────────────────────────────────
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#pmExportar').click()]);
    assert.match(download.suggestedFilename(), /^movimentacoes-wms-\d{4}-\d{2}-\d{2}\.csv$/);
    const conteudo = fs.readFileSync(await download.path(), 'utf8');
    assert.equal(conteudo.charCodeAt(0), 0xfeff);
    assert.equal(conteudo.trim().split('\r\n').length, 8, 'cabeçalho + 7 movimentos do filtro');

    // ── Kardex de um item continua a um clique ─────────────────────────
    assert.equal(await page.locator('#btnBuscarHistorico').count(), 1);

    // ── Celular ────────────────────────────────────────────────────────
    await page.setViewportSize({width: 390, height: 844});
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.querySelector('#tab-historico').scrollWidth <= document.querySelector('#tab-historico').clientWidth + 1), true, 'sem rolagem lateral no painel');
    if (process.env.MOV_SHOT) await page.locator('#tab-historico').screenshot({path: process.env.MOV_SHOT + '-celular.png'});

    assert.deepEqual(errors, [], 'erros: ' + errors.join(' | '));
    console.log('OK Painel de movimentações: carrega só na aba, indicadores, gráfico com tooltip, filtros por natureza/dia/endereço/pessoa, busca, período, baixa por lote, ao vivo, exportação e celular.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
