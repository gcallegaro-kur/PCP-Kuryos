'use strict';
/* Relatório de entradas na Logística › Histórico (27/10/2026).
   Tela real com utils.js e auth_check.js reais; Firebase simulado em memória.
   Datas relativas a hoje, para o teste não envelhecer. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const agoraMs = Date.now();
const diasAtras = (k) => new Date(agoraMs - k * 86400000).toISOString();
const q = (extra) => Object.assign({fornecedorNome: 'SOROPACK', loteOrigem: 'F-9', tipoMaterial: 'EMBALAGEM', qtdVolumes: 3, qtdAmostragem: 2,
  condicoesVeiculo: 4, condicoesEmbalagem: 5, certificadoFornecedor: false, enderecoCodigo: 'DOC-1.1.1'}, extra);

function dados() {
  return {
    usuarios: {u1: {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}},
    config: {}, fornecedores: {}, materiais: {}, enderecos_estoque: {}, clientes: {}, agendamentos_expedicao: {},
    pedidos_compra: {
      pc1: {status: 'RECEBIDO_PARCIAL', numeroFormatado: 'PC-0070', fornecedorNome: 'SOROPACK EMBALAGENS', dataCriacao: diasAtras(20),
        itens: {i1: {materialCodigo: 'EP-00195', qtd: 1000, qtdRecebida: 400, unidade: 'un'}, i2: {materialCodigo: 'MPGR-00066', qtd: 35, qtdRecebida: 35, unidade: 'kg'}},
        recebimentos: {r1: {data: diasAtras(5), criadoEm: diasAtras(5), notaFiscal: '829', recebidoPor: 'Marcos Souza', status: 'ATIVO', idempotencyKey: 'k1', observacoes: 'Caixa amassada',
          itensRecebidos: {
            l1: {itemKey: 'i1', loteKey: 'AK-1', materialCodigo: 'EP-00195', materialNome: 'FRASCO BODY SPLASH 200ML', qtdRecebidaAgora: 400, unidade: 'un', entradaQualidade: q({loteInterno: 'AK-1'})},
            l2: {itemKey: 'i2', loteKey: 'AK-2', materialCodigo: 'MPGR-00066', materialNome: 'ÁLCOOL DE CEREAIS', qtdRecebidaAgora: 35, unidade: 'kg', entradaQualidade: q({loteInterno: 'AK-2', tipoMaterial: 'MATERIA_PRIMA'})}
          }}}},
      pc2: {status: 'RECEBIDO_TOTAL', numeroFormatado: 'PC-0050', fornecedorNome: 'GRÁFICA ÁGIL', dataCriacao: diasAtras(120),
        itens: {i1: {materialCodigo: 'ES-00174', qtd: 1475, qtdRecebida: 1475, unidade: 'un'}},
        recebimentos: {r1: {data: diasAtras(100), notaFiscal: '11127', recebidoPor: 'Rodolfo', status: 'ATIVO', idempotencyKey: 'k2',
          itensRecebidos: {l1: {itemKey: 'i1', loteKey: 'AK-9', materialCodigo: 'ES-00174', materialNome: 'RÓTULO SUNRISE', qtdRecebidaAgora: 1475, unidade: 'un', entradaQualidade: q({loteInterno: 'AK-9'})}}}}}
    },
    estoque_lotes: {
      'EP-00195': {'AK-1': {status: 'LIBERADO', saldoLote: 380, enderecoCodigo: 'GAL-4.1.4', qualidade: {decisao: 'LIBERADO', dataInspecao: diasAtras(4).slice(0, 10)}}},
      'MPGR-00066': {'AK-2': {status: 'QUARENTENA', saldoLote: 35, enderecoCodigo: 'DOC-1.1.1'}},
      'ES-00174': {'AK-9': {status: 'LIBERADO', saldoLote: 0, qualidade: {decisao: 'LIBERADO'}}}
    }
  };
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1500, height: 1100}, acceptDownloads: true});
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(({data}) => {
      const db = data; window.__iniciado = false;
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
            transaction() { return Promise.resolve({committed: true, snapshot: snapDe(path)}); }});
          return {ref: (p) => ref(p || '')};
        }
      };
    }, {data: dados()});
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'ent.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + url.pathname.slice(1);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    await page.goto('https://ent.test/logistica.html');
    await page.locator('.tab[data-tab="historico"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#historicoList tr.he-row').length >= 2, null, {timeout: 10000});

    // ── Padrão: últimos 30 dias, tabela por item ───────────────────────
    assert.equal(await page.locator('#historicoList tr.he-row').count(), 2, 'o recebimento de 100 dias atrás fica fora dos 30 dias');
    const tabela = await page.locator('#historicoList table').innerText();
    assert.match(tabela, /PC-0070[\s\S]*SOROPACK EMBALAGENS/);
    assert.match(tabela, /NF 829/);
    assert.match(tabela, /PC: 400 de 1\.000\s*parcial/, 'pedido × recebido');
    assert.match(tabela, /GAL-4\.1\.4[\s\S]*saldo 380 un/, 'endereço e saldo de hoje');
    assert.match(tabela, /Aguardando CQ[\s\S]*há 5 dia/);
    const kpis = await page.locator('#hKpis').innerText();
    assert.match(kpis, /RECEBIMENTOS\s*1\s*2 itens · 1 origem\b/i);
    assert.match(tabela, /35 kg\s*PC: 35 de 35/, 'PC completo mostra recebido de pedido');
    assert.match(kpis, /35 kg · 400 un/, 'total por unidade');
    assert.match(kpis, /AGUARDANDO CQ\s*1\s*mais antigo há 5 dia/i);
    assert.match(kpis, /MP SEM VALIDADE\s*1/i);
    assert.match(await page.locator('#hResumoFiltro').innerText(), /2 de 3 itens recebidos/);
    if (process.env.ENT_SHOT) await page.locator('#tab-historico').screenshot({path: process.env.ENT_SHOT + '-tabela.png'});

    // ── Filtros ────────────────────────────────────────────────────────
    await page.locator('#hPeriodo').selectOption('');
    assert.equal(await page.locator('#historicoList tr.he-row').count(), 3);
    await page.locator('#hBusca').fill('alcool cereais');
    assert.equal(await page.locator('#historicoList tr.he-row').count(), 1, 'busca sem acento, todas as palavras');
    await page.locator('#hBusca').fill('');
    await page.locator('#hKpis [data-kpi-cq="AGUARDANDO"]').click();
    assert.equal(await page.locator('#hCq').inputValue(), 'AGUARDANDO', 'o indicador filtra');
    assert.equal(await page.locator('#historicoList tr.he-row').count(), 1);
    await page.locator('#hKpis [data-kpi-cq="AGUARDANDO"]').click();
    assert.equal(await page.locator('#hCq').inputValue(), '', 'clicar de novo solta o filtro');
    await page.locator('#hOrigem').selectOption('GRÁFICA ÁGIL');
    assert.equal(await page.locator('#historicoList tr.he-row').count(), 1);
    await page.locator('#hLimpar').click();
    assert.equal(await page.locator('#hPeriodo').inputValue(), '30');
    assert.equal(await page.locator('#historicoList tr.he-row').count(), 2);

    // ── Linha abre o recebimento, com as ações de sempre ───────────────
    await page.locator('#historicoList tr.he-row').first().click();
    const det = await page.locator('#historicoList tr.he-det').innerText();
    assert.match(det, /Recebido por Marcos Souza/);
    assert.match(det, /Veículo 4\/5 · embalagem 5\/5/);
    assert.match(det, /Caixa amassada/);
    assert.equal(await page.locator('#historicoList tr.he-det .btn-etiquetas-rec').count(), 1);
    assert.equal(await page.locator('#historicoList tr.he-det .btn-cancelar-rec').count(), 1);
    assert.equal(await page.locator('#historicoList tr.he-det .btn-devolver-rec').count(), 2);
    await page.locator('#historicoList tr.he-row').first().click();
    assert.equal(await page.locator('#historicoList tr.he-det').count(), 0, 'clicar de novo fecha');

    // ── Visão por recebimento (cartões antigos) ────────────────────────
    await page.locator('.he-visao [data-visao="cartoes"]').click();
    assert.equal(await page.locator('#historicoList .pc-card').count(), 1);
    assert.match(await page.locator('#historicoList .pc-card').innerText(), /PC-0070 — SOROPACK EMBALAGENS[\s\S]*NF 829/);
    await page.locator('.he-visao [data-visao="tabela"]').click();

    // ── Exportar ───────────────────────────────────────────────────────
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#hExportar').click()]);
    assert.match(download.suggestedFilename(), /^entradas-materiais-\d{4}-\d{2}-\d{2}\.csv$/);
    const conteudo = fs.readFileSync(await download.path(), 'utf8');
    assert.equal(conteudo.charCodeAt(0), 0xfeff, 'BOM para o Excel abrir acentos');
    assert.equal(conteudo.trim().split('\r\n').length, 3, 'cabeçalho + 2 itens do filtro');
    assert.match(conteudo, /PC-0070;SOROPACK EMBALAGENS;829;MPGR-00066;ÁLCOOL DE CEREAIS;Matéria-prima;35;kg/);

    // ── Celular ────────────────────────────────────────────────────────
    await page.setViewportSize({width: 390, height: 844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'sem rolagem lateral na página (a tabela rola dentro do cartão)');
    if (process.env.ENT_SHOT) await page.screenshot({path: process.env.ENT_SHOT + '-celular.png', fullPage: true});

    assert.deepEqual(errors, [], 'erros: ' + errors.join(' | '));
    console.log('OK Relatório de entradas: tabela por item, indicadores, filtros, detalhe com ações, cartões, exportação e celular.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
