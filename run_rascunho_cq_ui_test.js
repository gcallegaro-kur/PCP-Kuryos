'use strict';
/* Rascunho do laudo na Fila de Inspeção (27/10/2026), na tela real:
   o que a analista digita é gravado em qualidade_rascunhos ao clicar fora,
   apertar Esc, fechar, ou a página ficar oculta; a fila mostra
   "Em preenchimento" e "Continuar"; reabrir traz tudo de volta (inclusive
   checklist e pesos, que não têm id); decidir apaga o rascunho; abrir e
   fechar sem mexer não cria nada. Firebase simulado e com estado. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const pal = (n) => ({
  itemTipo: 'produto', itemCodigo: 'SKU1', itemNome: 'BODY SPLASH X', unidade: 'un', opKey: '26280-01', opLote: '26280/01', loteOrigem: '26280/01',
  paleteNumero: n, identificadorPalete: 'PA-26280-01-P' + n, caixasFechadas: 30, unidadesCaixaParcial: 0,
  saldoLote: 720, status: 'QUARENTENA', origemTipo: 'conferencia_pa', enderecoCodigo: 'A-0' + n, criadoEm: '2026-10-10T10:00:00Z'
});

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1600, height: 1100}});
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    page.on('dialog', (d) => d.accept());
    const dados = {
      usuarios: {u1: {nome: 'Ana Qualidade', email: 'q@kuryos.com', role: 'qualidade'}},
      estoque_lotes: {
        SKU1: {pa_1: pal(1), pa_2: pal(2)},
        'MPGR-001': {L700: {itemTipo: 'material', itemCodigo: 'MPGR-001', itemNome: 'ALCOOL CEREAIS', status: 'QUARENTENA', saldoLote: 200,
          unidade: 'kg', loteOrigem: 'F-123', criadoEm: '2026-10-20T10:00:00Z',
          recebimento: {notaFiscal: '555', qtdAmostragem: 2, condicoesVeiculo: 5, condicoesEmbalagem: 5, certificadoFornecedor: true}}}
      },
      ops: {
        '26280-01': {lote: '26280/01', sku: 'SKU1', produto: 'BODY SPLASH X'},
        '26300-01': {lote: '26300/01', sku: 'SKU2', produto: 'BODY SPLASH Y',
          manipulacao: {status: 'AGUARDANDO_CQ', previstos: {}, manipulacao: {fim: '2026-10-27T10:00:00Z', por: 'Bia Manip', rendimento: 175}}}
      }
    };
    await page.addInitScript((inicial) => {
      const db = JSON.parse(JSON.stringify(inicial));
      window.__db = db; window.__iniciado = false; window.__gravacoes = [];
      const exige = (q) => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
      const get = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), db);
      const set = (p, v) => {
        const ks = p.split('/').filter(Boolean); let o = db;
        ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
        if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
      };
      const ouvintes = [];
      const avisa = () => ouvintes.forEach((o) => setTimeout(() => o.cb({val: () => { const v = get(o.p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); }, exists: () => get(o.p) !== undefined}), 0));
      let seq = 0;
      window.firebase = {
        initializeApp() { window.__iniciado = true; },
        auth() { exige('auth'); return {currentUser: {uid: 'u1', email: 'q@kuryos.com', displayName: 'Ana Qualidade'},
          onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'q@kuryos.com', displayName: 'Ana Qualidade'}), 0); }, signOut() { return Promise.resolve(); }}; },
        storage() { return {ref() { return {put: () => Promise.resolve(), getDownloadURL: () => Promise.resolve('')}; }}; },
        database() {
          exige('database');
          return {ref(p) {
            p = p || '';
            const snap = () => ({val: () => { const v = p ? get(p) : db; return v === undefined ? null : JSON.parse(JSON.stringify(v)); }, exists: () => get(p) !== undefined, forEach() {}});
            return {path: p,
              once(ev, cb) { const s = snap(); if (cb) cb(s); return Promise.resolve(s); },
              on(ev, cb) { ouvintes.push({p, cb}); setTimeout(() => cb(snap()), 0); return cb; }, off() {}, child(c) { return this; },
              orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
              set(v) { if (p.indexOf('qualidade_rascunhos') === 0) window.__gravacoes.push(p); set(p, v); avisa(); return Promise.resolve(); },
              update(u) { Object.keys(u).forEach((k) => set((p ? p + '/' : '') + k, u[k])); avisa(); return Promise.resolve(); },
              remove() { set(p, null); avisa(); return Promise.resolve(); },
              push(v) { const k = 'k' + (++seq); const r = Object.assign(Promise.resolve(), {key: k}); if (v !== undefined) set(p + '/' + k, v); return r; },
              transaction(fn) {
                const atual = get(p) === undefined ? null : JSON.parse(JSON.stringify(get(p)));
                const r = fn(atual);
                if (r === undefined) return Promise.resolve({committed: false, snapshot: snap()});
                set(p, r); avisa(); return Promise.resolve({committed: true, snapshot: snap()});
              }};
          }};
        }
      };
    }, dados);
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'q.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + url.pathname.slice(1);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    await page.goto('https://q.test/qualidade.html?tab=fila&tipo=tudo');
    await page.waitForFunction(() => /Laudar lote/.test(document.querySelector('#qFilaBody').innerText), null, {timeout: 8000});
    const rasc = (k) => page.evaluate((c) => (window.__db.qualidade_rascunhos || {})[c] || null, k);
    const dadosRasc = async (k) => { const r = await rasc(k); return r ? JSON.parse(r.dados) : null; };
    const esperaRasc = (k, trecho) => page.waitForFunction(([c, t]) => {
      const r = (window.__db.qualidade_rascunhos || {})[c]; return r && r.dados.indexOf(t) >= 0;
    }, [k, trecho], {timeout: 5000});
    const PA = 'pa_26280-01', MP = 'lote_MPGR-001__L700', GR = 'granel_26300-01';

    // ── PA: preenche, clica FORA do popup → grava ──────────────────────
    await page.click('#qFilaBody [data-laudo-op]');
    await page.waitForSelector('#modalLaudoBg.open');
    assert.match(await page.locator('#qRascunhoLaudo').innerText(), /salvo sozinho/);
    assert.equal(await page.locator('#qRascunhoAvisoLaudo').isVisible(), false);
    await page.fill('#qObservacao', 'Mancha no rótulo');
    await page.locator('#qCk7Itens [data-ck7-cnc]').first().selectOption('C');
    await page.locator('#qCk7PesoCampos [data-ck7-peso="0"]').fill('201');
    // Grava sozinho depois de uma pausa, com o popup ainda aberto.
    await esperaRasc(PA, 'Mancha no rótulo');
    await page.waitForFunction(() => /Rascunho salvo às \d\d:\d\d/.test(document.getElementById('qRascunhoLaudo').innerText), null, {timeout: 3000});
    assert.equal(await page.locator('#modalLaudoBg').evaluate((e) => e.classList.contains('open')), true);
    // Mexe de novo e clica fora sem esperar a pausa: fechar grava o pendente.
    await page.locator('#qCk7PesoCampos [data-ck7-peso="0"]').fill('201.5');
    // Fundo escuro do popup, à direita (à esquerda fica o menu lateral, por cima).
    assert.equal(await page.evaluate(() => document.elementFromPoint(1590, 600).id), 'modalLaudoBg');
    await page.mouse.click(1590, 600);
    await page.waitForSelector('#modalLaudoBg.open', {state: 'detached', timeout: 3000}).catch(() => {});
    assert.equal(await page.locator('#modalLaudoBg').evaluate((e) => e.classList.contains('open')), false, 'clicar fora fecha');
    await esperaRasc(PA, 'Mancha no rótulo');
    let r = await rasc(PA);
    assert.equal(r.tipo, 'LAUDO'); assert.equal(r.por, 'Ana Qualidade'); assert.equal(r.opKey, '26280-01');
    let d = await dadosRasc(PA);
    assert.equal(d.estado.ck7.pesos[0], 201.5);
    assert.equal(Object.values(d.estado.ck7.respostas)[0].cnc, 'C');

    // Fila: selo e botão "Continuar".
    await page.waitForFunction(() => /Em preenchimento — Ana Qualidade/.test(document.querySelector('#qFilaBody').innerText));
    assert.match(await page.locator('#qFilaBody [data-laudo-op]').innerText(), /Continuar laudo/);
    if (process.env.RASC_SHOT) await page.locator('#qFilaBody').screenshot({path: process.env.RASC_SHOT + '_fila.png'});
    assert.match(await page.locator('#qFilaBody [data-laudo-lote]').innerText(), /Laudar/, 'o outro lote segue sem rascunho');

    // ── Reabrir: tudo volta (campo com id, checklist e peso, que não têm) ──
    await page.click('#qFilaBody [data-laudo-op]');
    await page.waitForSelector('#modalLaudoBg.open');
    assert.equal(await page.inputValue('#qObservacao'), 'Mancha no rótulo');
    assert.equal(await page.locator('#qCk7Itens [data-ck7-cnc]').first().inputValue(), 'C');
    assert.equal(await page.locator('#qCk7PesoCampos [data-ck7-peso="0"]').inputValue(), '201.5');
    assert.match(await page.locator('#qRascunhoAvisoLaudo').innerText(), /Continuando o preenchimento.*Ana Qualidade.*fotos não ficam/is);
    assert.match(await page.locator('#qCk7PesoResumo').innerText(), /1 de \d+ pesadas/, 'o julgamento usa o peso recuperado');
    if (process.env.RASC_SHOT) await page.screenshot({path: process.env.RASC_SHOT + '_popup.png'});

    // ── Esc também grava ──
    await page.fill('#qObservacao', 'Mancha no rótulo — 3 caixas');
    await page.keyboard.press('Escape');
    await esperaRasc(PA, '3 caixas');

    // ── Decidir apaga o rascunho ──
    await page.click('#qFilaBody [data-laudo-op]');
    await page.waitForSelector('#modalLaudoBg.open');
    assert.equal(await page.inputValue('#qObservacao'), 'Mancha no rótulo — 3 caixas');
    await page.click('#qBtnReter');
    await page.waitForFunction(() => window.__db.ops['26280-01'].qualidadePA && window.__db.ops['26280-01'].qualidadePA.decisao, null, {timeout: 8000});
    await page.waitForFunction((k) => !(window.__db.qualidade_rascunhos || {})[k], PA, {timeout: 3000});
    assert.equal(await page.evaluate(() => window.__db.ops['26280-01'].qualidadePA.observacao || window.__db.ops['26280-01'].qualidadePA.obs || ''), 'Mancha no rótulo — 3 caixas');

    // ── MP: abrir e fechar sem mexer não cria rascunho ──
    const antes = await page.evaluate(() => window.__gravacoes.length);
    await page.click('#qFilaBody [data-laudo-lote]');
    await page.waitForSelector('#modalLaudoBg.open');
    await page.click('#modalLaudoCancel');
    await page.waitForTimeout(1200);
    assert.equal(await rasc(MP), null);
    assert.equal(await page.evaluate(() => window.__gravacoes.length), antes, 'nada gravado');

    // ── MP: botão Fechar grava; página oculta grava sem esperar a pausa ──
    await page.click('#qFilaBody [data-laudo-lote]');
    await page.waitForSelector('#modalLaudoBg.open');
    assert.equal(await page.locator('#qCondVeiculo').isDisabled(), true);
    await page.fill('#qObservacao', 'Odor ok');
    await page.click('#modalLaudoCancel');
    await esperaRasc(MP, 'Odor ok');
    d = await dadosRasc(MP);
    assert.ok(!('qCondVeiculo' in d.campos), 'dado da Logística (desabilitado) não vai para o rascunho');
    await page.click('#qFilaBody [data-laudo-lote]');
    await page.waitForSelector('#modalLaudoBg.open');
    await page.fill('#qObservacao', 'Odor alterado');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {value: 'hidden', configurable: true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    d = await dadosRasc(MP);
    assert.equal(d.campos.qObservacao, 'Odor alterado', 'gravou na hora, sem esperar a pausa');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true}); });

    // ── Descartar e começar de novo ──
    await page.click('#modalLaudoCancel');
    await page.click('#qFilaBody [data-laudo-lote]');
    await page.waitForSelector('#modalLaudoBg.open');
    await page.click('#qRascunhoAvisoLaudo [data-descartar-rascunho]');
    await page.waitForFunction((k) => !(window.__db.qualidade_rascunhos || {})[k], MP, {timeout: 3000});
    assert.equal(await page.inputValue('#qObservacao'), '');
    assert.equal(await page.locator('#qRascunhoAvisoLaudo').isVisible(), false);
    await page.click('#modalLaudoCancel');
    await page.waitForTimeout(1000);
    assert.equal(await rasc(MP), null, 'descartado e fechado sem mexer: continua sem rascunho');

    // ── Granel: resultado, observação e caixa de restrição voltam ──
    await page.click('#qGranelBody [data-granel]');
    await page.waitForSelector('#modalGranelBg.open');
    await page.locator('#qGranelPlanoBody [data-granel-valor="ph"]').fill('5,6');
    await page.fill('#qGranelObs', 'Turbidez leve');
    await page.click('#qGranelRestringir');
    await page.fill('#qGranelRestricao', 'Liberar só para envase hoje');
    await page.click('#modalGranelClose');
    await esperaRasc(GR, 'Liberar só para envase hoje');
    r = await rasc(GR);
    assert.equal(r.tipo, 'GRANEL'); assert.equal(r.opKey, '26300-01');
    await page.waitForFunction(() => /Em preenchimento/.test(document.querySelector('#qGranelBody').innerText));
    assert.match(await page.locator('#qGranelBody [data-granel]').innerText(), /Continuar análise/);
    await page.click('#qGranelBody [data-granel]');
    await page.waitForSelector('#modalGranelBg.open');
    assert.equal(await page.locator('#qGranelPlanoBody [data-granel-valor="ph"]').inputValue(), '5,6');
    assert.equal(await page.inputValue('#qGranelObs'), 'Turbidez leve');
    assert.equal(await page.locator('#qGranelRestricaoBox').isVisible(), true);
    assert.equal(await page.inputValue('#qGranelRestricao'), 'Liberar só para envase hoje');
    assert.match(await page.locator('#qGranelRestringir').innerText(), /Confirmar/);
    await page.click('#qGranelCancelar');

    assert.deepEqual(erros, [], 'sem erro de página: ' + erros.join(' | '));
  } finally { await browser.close(); }
  console.log('OK rascunho do laudo na tela: clicar fora/Esc/Fechar/página oculta gravam, fila mostra Em preenchimento, reabrir recupera tudo, decidir apaga, descartar recomeça.');
})().catch((e) => { console.error(e); process.exit(1); });
