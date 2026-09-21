'use strict';
/* Impressão das fichas de OP: uma ficha = uma folha, e nada de folha em
   branco.

   Os dois defeitos vieram de PDFs reais que o usuário mandou em 21/09
   (OPs 26253/07 e 26261/04), os dois com 22 folhas:
   - 16 folhas EM BRANCO no fim. O CSS escondia a tela do app com
     `visibility:hidden`, que esconde mas NÃO tira do fluxo -- o Chrome
     paginava a altura inteira da tela por trás. Em ops.html, onde a tela
     é a tabela comprida de OPs, davam 16 folhas de nada.
   - a Ordem de Envase vazando pra uma 2ª folha.

   Roda o CSS e o JS DE VERDADE (shared/fichas-op.css + shared/utils.js
   lidos do disco), em Chromium com mídia de impressão, e mede. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const PUBLICO = path.join(__dirname, 'public');
const CSS = fs.readFileSync(path.join(PUBLICO, 'shared', 'fichas-op.css'), 'utf8');
const UTILS = fs.readFileSync(path.join(PUBLICO, 'shared', 'utils.js'), 'utf8');

// A4 retrato com a margem de 10mm que o próprio fichas-op.css declara:
// 297 - 2x10 = 277mm úteis. 1mm = 96/25.4 px CSS.
const ALTURA_UTIL_PX = Math.floor((297 - 20) * 96 / 25.4); // 1046

// OP 26253/07 do PDF: é a pior das duas (5 itens de embalagem, 4 de
// fórmula, 7 ensaios) e é a que estava vazando na Ordem de Envase.
function opExemplo() {
  const bom = [
    ['ES-00171', 'ROTULO BODY SPLASH CANDY FLOR D AURA - (MISS ROSE)', 4400],
    ['EP-00009', 'VALVULA SPRAY LISA COM HOT PRATA - (MISS ROSE)', 4400],
    ['EP-00106', 'FRASCO 200ML CRISTAL 24GR BODY SPLASH/HIDRATANTE MISS ROSE - BEAUTYPACK', 4400],
    ['ES-00014', 'SOBRETAMPA BODY SPLASH FRASCO DE 200ML - BEAUTYPACK', 4400],
    ['ET-00018', 'CAIXA DE PAPELAO BODY SPLASH SEGREDOS DO ORIENTE', 92],
  ];
  const materiaisConsumo = {};
  bom.forEach(function(linha, i) {
    materiaisConsumo['b' + i] = {mpCodigo: linha[0], mpNome: linha[1], quantidade: linha[2],
      unidade: 'un', origem: 'bom'};
  });
  const formula = [
    ['MPGR-00127', 'ÁLCOOL 96°GL', 606.66],
    ['MPGR-00132', 'ÁGUA', 230.73],
    ['MPES-00008', 'ESSENCIA YARA ISABELLE FAV-381035', 24.132],
    ['MPGR-00066', 'METILISOTIAZOLINONA (CONSERVANTE)', 0.345],
  ];
  formula.forEach(function(linha, i) {
    materiaisConsumo['f' + i] = {mpCodigo: linha[0], mpNome: linha[1], quantidade: linha[2],
      unidade: 'kg', origem: 'formula'};
  });
  return {
    lote: '26253/07', sku: 'MRARBS12', produto: 'BODY SPLASH FLOR DAURA 200ML',
    cliente: 'MISS RÔSE', validade: '2029-09-01', dataEmissao: '2026-09-10T20:48:48.000Z',
    emitidoPor: 'Gustavo Callegaro', qtdPlanejada: 4400, volumeTeoricoUnMl: 218,
    densidadeGranelUsada: 0.88, massaLoteKg: 861.867, volumeGranelL: 979.394,
    formulaVersao: 'v1', materiaisConsumo: materiaisConsumo,
  };
}

const FORMULA_ITENS = [
  {mpCodigo: 'MPGR-00127', mpNome: 'ÁLCOOL 96°GL', percentualMM: 70.389, quantidade: 606.66},
  {mpCodigo: 'MPGR-00132', mpNome: 'ÁGUA', percentualMM: 26.771, quantidade: 230.73},
  {mpCodigo: 'MPES-00008', mpNome: 'ESSENCIA YARA ISABELLE FAV-381035', percentualMM: 2.8, quantidade: 24.132},
  {mpCodigo: 'MPGR-00066', mpNome: 'METILISOTIAZOLINONA (CONSERVANTE)', percentualMM: 0.04, quantidade: 0.345},
];

const ESPECS = {
  e1: {ensaio: 'ASPECTO', especificacaoTexto: 'LÍQUIDO', metodo: 'PA 09'},
  e2: {ensaio: 'ODOR', especificacaoTexto: 'CARACTERÍSTICO', metodo: 'PA09'},
  e3: {ensaio: 'COR', especificacaoTexto: 'AMARELO CLARO', metodo: 'PA09'},
  // Os dois com "N/A" no texto e a faixa nas colunas Mínimo/Máximo --
  // é como a Qualidade cadastra de verdade (print do usuário, 21/09).
  e4: {ensaio: 'DENSIDADE', especificacaoTexto: 'N/A', minimo: '0,8', maximo: '0,9', metodo: 'PA03'},
  e5: {ensaio: 'CONTEÚDO LÍQUIDO MÉDIO', especificacaoTexto: 'N/A', minimo: 184, maximo: 188, metodo: 'F060'},
  e6: {ensaio: 'PH', especificacaoTexto: 'NA', metodo: 'PA01'},
  e7: {ensaio: 'TEOR DE ÁLCOOL', especificacaoTexto: '65°G/L - 75°G/L', metodo: 'PA 08'},
};

// Uma tela de app COMPRIDA por trás -- é a condição que produzia as 16
// folhas em branco (em ops.html a tabela de OPs passa fácil disso).
const TELA_ALTA = '<div class="header" style="height:400px">cabecalho</div>' +
  '<div class="main" style="height:9000px">tabela de OPs</div>';

// A máquina do PCP não tem os navegadores baixados do Playwright (npx
// playwright install), mas tem o Chrome instalado -- e é justamente o
// Chrome da fábrica que interessa aqui, porque o que está sendo medido é
// paginação de impressão. Tenta o navegador do Playwright e cai pro
// Chrome do sistema.
async function abrirNavegador() {
  try {
    return await chromium.launch();
  } catch (err) {
    if (!/Executable doesn't exist/.test(String(err && err.message))) throw err;
    return await chromium.launch({channel: 'chrome'});
  }
}

(async function() {
  const browser = await abrirNavegador();
  const page = await browser.newPage({viewport: {width: 1400, height: 900}});
  const erros = [];
  page.on('pageerror', function(e) { erros.push(e.message); });

  await page.setContent('<!doctype html><html><head><meta charset="utf-8">' +
    '<title>Controle de OPs · Kuryos PCP</title></head>' +
    '<body class="kuryos-theme has-sidebar">' + TELA_ALTA + '<div id="printArea"></div></body></html>');
  await page.addStyleTag({content: CSS});
  await page.addScriptTag({content: UTILS});

  await page.evaluate(function(dados) {
    document.getElementById('printArea').innerHTML =
      montarFichasOP(dados.op, dados.formulaItens, dados.especs, 'MS 2.XXXX.XXXX');
  }, {op: opExemplo(), formulaItens: FORMULA_ITENS, especs: ESPECS});

  assert.deepEqual(erros, [], 'nenhum erro de JS ao montar as fichas');
  await page.emulateMedia({media: 'print'});

  const medida = await page.evaluate(function() {
    const paginas = Array.from(document.querySelectorAll('#printArea .print-page'));
    return {
      fichas: paginas.map(function(p) {
        return {
          titulo: p.querySelector('.print-h').textContent.trim(),
          altura: Math.ceil(p.getBoundingClientRect().height),
        };
      }),
      alturaDoCorpo: Math.ceil(document.body.getBoundingClientRect().height),
      alturaDoPrintArea: Math.ceil(document.getElementById('printArea').getBoundingClientRect().height),
      appVisivel: Array.from(document.body.children)
        .filter(function(el) { return el.id !== 'printArea' && getComputedStyle(el).display !== 'none'; })
        .map(function(el) { return el.className || el.tagName; }),
    };
  });

  // ── 1. A tela do app não entra na impressão ────────────────────────
  assert.deepEqual(medida.appVisivel, [],
    'nada da tela do app pode continuar no fluxo da impressão');
  // Se sobrasse a tela de 9400px por trás, o corpo seria ~9400px e o
  // Chrome pagina esse vazio -- que é exatamente a folha em branco.
  assert.ok(medida.alturaDoCorpo <= medida.alturaDoPrintArea + 5,
    'o corpo impresso é só as fichas (corpo ' + medida.alturaDoCorpo +
    'px x fichas ' + medida.alturaDoPrintArea + 'px)');

  // ── 2. Cada ficha cabe em UMA folha ────────────────────────────────
  assert.equal(medida.fichas.length, 5, 'as 5 fichas da OP');
  medida.fichas.forEach(function(f) {
    assert.ok(f.altura <= ALTURA_UTIL_PX,
      f.titulo + ': ' + f.altura + 'px passa dos ' + ALTURA_UTIL_PX +
      'px úteis da A4 -- vai vazar pra uma 2ª folha');
  });

  // ── 2b. E cabe também no PIOR produto que existe no cadastro ──────
  // Medido no backup real de 25/08 (backups/pre-wipe-materiais-formulas-
  // bom-*.json, 212 BOMs e 155 fórmulas): BOM vai até 12 itens (6
  // produtos têm 12) e fórmula até 18. Se a ficha só coubesse no produto
  // médio, o problema voltaria calado justamente nos maiores.
  const MAIOR = {bom: 12, formula: 18, ensaios: 12};
  const grande = opExemplo();
  grande.materiaisConsumo = {};
  for (let i = 0; i < MAIOR.bom; i++) {
    grande.materiaisConsumo['b' + i] = {mpCodigo: 'EP-001' + i, unidade: 'un', quantidade: 4400,
      origem: 'bom', mpNome: 'FRASCO 200ML CRISTAL 24GR BODY SPLASH/HIDRATANTE MISS ROSE - BEAUTYPACK ' + i};
  }
  const formulaGrande = [];
  for (let i = 0; i < MAIOR.formula; i++) {
    formulaGrande.push({mpCodigo: 'MPGR-001' + i, percentualMM: 5.5,
      mpNome: 'METILISOTIAZOLINONA (CONSERVANTE) ' + i, quantidade: 47.4});
  }
  const especsGrande = {};
  for (let i = 0; i < MAIOR.ensaios; i++) {
    especsGrande['e' + i] = {ensaio: 'CONTEÚDO LÍQUIDO MÉDIO ' + i, minimo: 184, maximo: 188, metodo: 'F060'};
  }
  const alturasGrande = await page.evaluate(function(dados) {
    document.getElementById('printArea').innerHTML =
      montarFichasOP(dados.op, dados.formulaItens, dados.especs, 'MS 2.XXXX.XXXX');
    return Array.from(document.querySelectorAll('#printArea .print-page')).map(function(p) {
      return {titulo: p.querySelector('.print-h').textContent.trim(),
        altura: Math.ceil(p.getBoundingClientRect().height)};
    });
  }, {op: grande, formulaItens: formulaGrande, especs: especsGrande});
  alturasGrande.forEach(function(f) {
    assert.ok(f.altura <= ALTURA_UTIL_PX,
      'produto maior do cadastro -- ' + f.titulo + ': ' + f.altura + 'px passa dos ' +
      ALTURA_UTIL_PX + 'px úteis da A4');
  });

  // ── 3. A ficha físico-química traz os parâmetros ───────────────────
  await page.evaluate(function(dados) {
    document.getElementById('printArea').innerHTML =
      montarFichasOP(dados.op, dados.formulaItens, dados.especs, 'MS 2.XXXX.XXXX');
  }, {op: opExemplo(), formulaItens: FORMULA_ITENS, especs: ESPECS});
  const relatorio = await page.evaluate(function() {
    return Array.from(document.querySelectorAll('#printArea .print-page'))
      .find(function(p) { return /Relatório de Produto Acabado/.test(p.textContent); }).textContent;
  });
  assert.ok(relatorio.indexOf('0,8 – 0,9') >= 0, 'DENSIDADE impressa pela faixa cadastrada');
  assert.ok(relatorio.indexOf('184 – 188') >= 0, 'CONTEÚDO LÍQUIDO MÉDIO impresso pela faixa');

  console.log('run_fichas_op_ui_test: OK — ' +
    medida.fichas.map(function(f) {
      return f.titulo.split('—')[0].trim() + ' ' + f.altura + 'px';
    }).join(' | ') + ' (limite ' + ALTURA_UTIL_PX + 'px)');
  await browser.close();
})().catch(function(e) { console.error(e); process.exit(1); });
