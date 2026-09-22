'use strict';
/* Posto de trabalho executando uma OP de retrabalho (form.html).

   É a única peça de verdade nova do pedido de 22/09 ("pode ser alocada em
   linhas de produção ou postos de trabalho"): o campo `produzidoPosto` e o
   tratamento de `tipo==='posto'` já existiam no sistema, mas **nada
   escrevia neles** -- produção de posto nunca chegava a uma OP.

   O vínculo não é campo novo: a OP de retrabalho guarda o nome do recurso
   em `linha`, o mesmo campo que o Painel de Turno já lê.

   Mesmo padrão do run_rearranjo_linhas_ui_test.js do Codex: recorta as
   funções reais de form.html e roda contra DOM e globais simulados. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const FONTE = fs.readFileSync('public/form.html', 'utf8');
function recorte(de, ate) {
  const i = FONTE.indexOf(de), f = FONTE.indexOf(ate, i);
  assert.ok(i > 0 && f > i, 'não achei o trecho ' + de);
  return FONTE.slice(i, f);
}

const OP_RT = {
  lote: '26216/04-RT1', tipoOrdem: 'RETRABALHO', retrabalhoDe: '26216/04',
  retrabalhoDestino: 'posto', linha: 'Bancada 2', produto: 'PERFUME TAWUS 30ML',
  qtdPlanejada: 800, produzidoPosto: 200, produzidoLinha: 0, status: 'Em Produção',
};

(async () => {
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({viewport: {width, height: 900}});
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => d.accept());

      await page.setContent(
        '<style>*{box-sizing:border-box}</style>' +
        '<div id="turnoGridPostos"></div>' +
        '<div id="atividadePostoModal"><span id="atividadePostoSubtitle"></span>' +
        '<input id="atividadePostoProduto"><input id="atividadePostoQtd">' +
        '<input id="atividadePostoOperador">' +
        '<button id="btnConfirmarAtividadePosto">Confirmar</button>' +
        '<button id="btnCancelarAtividadePosto">Cancelar</button>' +
        '<button id="btnFecharAtividadePosto">Fechar</button></div>');

      await page.addScriptTag({content: fs.readFileSync('public/shared/retrabalho-op.js', 'utf8')});
      await page.evaluate(({op}) => {
        window.opsCache = {'26216-04-RT1': op};
        window.atividadesPostoCache = {p1: {nome: 'Bancada 2', produto: null, quantidadeTurno: 0, operador: ''}};
        window.escapeHtml = (s) => String(s == null ? '' : s);
        window.fmtNum = (n) => String(n);
        window.opEstaAtiva = (o) => o && o.status !== 'Concluído' && o.status !== 'Cancelado';
        window.getProduzido = (o, tipo) => (tipo === 'posto' ? (o.produzidoPosto || 0) : (o.produzidoLinha || 0));
        window.showSuccess = (a, b) => { window.__success = [a, b]; };
        window.abrirAtividadePostoModal = null;
        window.__ajustes = [];
        // ajustarProduzidoOp é a função real de utils.js em produção; aqui
        // registra a chamada para provar QUE a OP é creditada e COM QUE tipo.
        window.ajustarProduzidoOp = (dbRef, lote, tipo, delta) => {
          window.__ajustes.push({lote, tipo, delta});
          return Promise.resolve({ok: true, campo: 'produzidoPosto', novoTotal: 200 + delta});
        };
        window.__updates = [];
        window.db = {ref: (p) => ({update: (o) => { window.__updates.push({p, o}); return Promise.resolve(); }})};
        window.fecharAtividadePostoDefinitivo = () => Promise.resolve();
        window.atividadePostoAlvoAtual = null;
      }, {op: OP_RT});

      await page.addScriptTag({content: recorte('function opRetrabalhoDoPosto(', 'var alocarOpLivresAtual')});
      await page.addScriptTag({content: recorte('function abrirAtividadePostoModal(', 'document.getElementById(\'btnCancelarAtividadePosto\')')});

      // ── 1. O card do posto mostra a OP, o lote de origem e o avanço ──
      await page.evaluate(() => renderTurnoGridPostos());
      const card = await page.locator('#turnoGridPostos').innerText();
      assert.match(card, /Retrabalho · OP 26216\/04-RT1/, 'o posto diz que está executando um retrabalho');
      assert.match(card, /PERFUME TAWUS 30ML/);
      assert.match(card, /Lote de origem 26216\/04/, 'de onde veio o lote');
      assert.match(card, /200 \/ 800 un\./, 'avanço vem de produzidoPosto, não de produzidoLinha');
      assert.match(card, /25%/);

      // ── 2. Posto sem OP continua como atividade livre ────────────────
      await page.evaluate(() => {
        atividadesPostoCache.p2 = {nome: 'Bancada 1', produto: 'Montagem de kit', quantidadeTurno: 30, operador: 'Ana'};
        renderTurnoGridPostos();
      });
      const cards = await page.locator('#turnoGridPostos').innerText();
      assert.match(cards, /Montagem de kit/, 'atividade livre segue existindo');
      assert.equal((cards.match(/Retrabalho · OP/g) || []).length, 1, 'só o posto com OP mostra retrabalho');

      // ── 3. Somar produção credita produzidoPosto NA OP ───────────────
      await page.evaluate(() => abrirAtividadePostoModal('p1'));
      assert.match(await page.locator('#atividadePostoSubtitle').innerText(), /retrabalho da OP 26216\/04-RT1/);
      assert.equal(await page.locator('#atividadePostoProduto').inputValue(), 'PERFUME TAWUS 30ML',
        'o produto vem da OP, não é digitado');

      await page.fill('#atividadePostoQtd', '150');
      await page.fill('#atividadePostoOperador', 'João');
      await page.click('#btnConfirmarAtividadePosto');
      await page.waitForFunction(() => window.__ajustes.length > 0);

      const ajuste = (await page.evaluate(() => window.__ajustes))[0];
      assert.equal(ajuste.lote, '26216/04-RT1');
      assert.equal(ajuste.tipo, 'posto', 'credita produzidoPosto, nunca produzidoLinha');
      assert.equal(ajuste.delta, 150);
      // A atividade do posto continua com o próprio total do turno, e agora
      // guarda de qual OP foi a produção.
      const up = (await page.evaluate(() => window.__updates))[0];
      assert.equal(up.p, 'atividadesPosto/p1');
      assert.equal(up.o.quantidadeTurno, 150);
      assert.equal(up.o.operador, 'João');
      assert.equal(up.o.opLote, '26216/04-RT1');

      // ── 4. Posto sem OP não tenta creditar OP nenhuma ────────────────
      await page.evaluate(() => { window.__ajustes = []; window.__updates = []; });
      await page.evaluate(() => abrirAtividadePostoModal('p2'));
      await page.fill('#atividadePostoQtd', '10');
      await page.fill('#atividadePostoOperador', 'Ana');
      await page.click('#btnConfirmarAtividadePosto');
      await page.waitForFunction(() => window.__updates.length > 0);
      assert.deepEqual(await page.evaluate(() => window.__ajustes), [],
        'atividade livre não mexe em OP');

      assert.deepEqual(errors, [], 'erros de página: ' + errors.join(' | '));
      await page.close();
    }
    console.log('run_retrabalho_posto_ui_test: OK — desktop/celular, posto executa OP de retrabalho e credita produzidoPosto.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
