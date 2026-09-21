/* Fichas impressas da OP: a especificação que chega no papel e o nome do
   arquivo salvo.

   As duas coisas vieram de reclamações concretas do usuário em 21/09, com
   PDF real em mãos (OPs 26253/07 e 26261/04):
   1. ensaio cadastrado por mínimo/máximo saía com a coluna Especificação
      EM BRANCO na ficha físico-química -- só o texto livre era impresso;
   2. todo PDF de OP era salvo com o nome da TELA ("Controle de OPs ·
      Kuryos PCP"), então dois lotes chegavam ao arquivo com o mesmo nome.

   Roda o shared/utils.js DE VERDADE, sem cópia do trecho. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const utils = fs.readFileSync(path.join(__dirname, 'public', 'shared', 'utils.js'), 'utf8');
const sandbox = {
  window: {addEventListener() {}, removeEventListener() {}, print() { sandbox.__imprimiu = document.title; }},
  document: {title: 'Controle de OPs · Kuryos PCP'},
  navigator: {userAgent: 'node'},
  console,
};
const document = sandbox.document;
sandbox.window.print = function() { sandbox.__tituloNaImpressao = sandbox.document.title; };
vm.createContext(sandbox);
new vm.Script(utils, {filename: 'shared/utils.js'}).runInContext(sandbox);

// ── 1. Vírgula decimal: "0,8" não pode virar zero ────────────────────
// O cadastro de mínimo/máximo é texto livre e a fábrica digita em
// português. parseFloat('0,8') dá 0 (não dá NaN), então a densidade
// virava a faixa "≥ 0" -- que aprova qualquer leitura.
assert.equal(sandbox.numeroEspec('0,8'), 0.8);
assert.equal(sandbox.numeroEspec('0.8'), 0.8);
assert.equal(sandbox.numeroEspec(184), 184);
assert.ok(isNaN(sandbox.numeroEspec('')), 'vazio não é limite');
assert.ok(isNaN(sandbox.numeroEspec(null)), 'ausente não é limite');
assert.ok(isNaN(sandbox.numeroEspec('NA')), '"NA" não é limite');

// ── 2. Como a faixa se escreve ───────────────────────────────────────
assert.equal(sandbox.faixaEspecificacao({minimo: '0,8', maximo: '0,9'}), '0,8 – 0,9');
assert.equal(sandbox.faixaEspecificacao({minimo: 184, maximo: 188}), '184 – 188');
assert.equal(sandbox.faixaEspecificacao({minimo: '5'}), '≥ 5');
assert.equal(sandbox.faixaEspecificacao({maximo: '7'}), '≤ 7');
assert.equal(sandbox.faixaEspecificacao({especificacaoTexto: 'LÍQUIDO'}), null,
  'especificação descritiva não tem faixa');
assert.equal(sandbox.faixaEspecificacao({}), null);
// A unidade que a Qualidade digitou junto do número vai pro papel: "180g"
// não pode virar "180" só porque o sistema converteu pra comparar.
assert.equal(sandbox.faixaEspecificacao({minimo: '180g', maximo: '198g'}), '180g – 198g');

// ── 2b. "N/A" é ausência de texto, não um valor ──────────────────────
// É assim que a Qualidade escreve "a especificação está nas colunas
// Mínimo/Máximo". Como "N/A" é um valor não-vazio, o campo de texto
// vencia a faixa e a ficha continuava saindo sem parâmetro nenhum.
['N/A', 'n/a', 'NA', 'N.A.', '-', '--', '', '   ', null, undefined]
  .forEach(function(s) { assert.equal(sandbox.textoEspecAusente(s), true, JSON.stringify(s)); });
['LÍQUIDO', '0,8 - 0,9', 'NAO APLICAVEL', 'N']
  .forEach(function(s) { assert.equal(sandbox.textoEspecAusente(s), false, s); });

// ── 3. A ficha impressa: texto manda, faixa entra quando falta ───────
// Os 8 ensaios do print do cadastro que o usuário mandou em 21/09 --
// inclusive os três que têm "N/A" no texto e a faixa nas colunas.
const especs = {
  e1: {ensaio: 'APLICAÇÃO EM MECHA', especificacaoTexto: 'N/A', metodo: ''},
  e2: {ensaio: 'ASPECTO', especificacaoTexto: 'LIQUIDO', metodo: 'PA09'},
  e3: {ensaio: 'CONTEÚDO LÍQUIDO MÉDIO', especificacaoTexto: 'N/A', minimo: '180g', maximo: '198g', metodo: 'F060'},
  e4: {ensaio: 'DENSIDADE', especificacaoTexto: 'N/A', minimo: '0,85', maximo: '0,95', metodo: 'PA03'},
  e5: {ensaio: 'PH', especificacaoTexto: 'N/A', minimo: '5,5', maximo: '6,5', metodo: 'PA01'},
  e6: {ensaio: 'RESÍDUO SECO', especificacaoTexto: 'N/A', metodo: 'PA04'},
  e7: {ensaio: 'CONTEÚDO SEM TEXTO', especificacaoTexto: '', minimo: 49, maximo: 52, metodo: 'F060'},
  e8: {ensaio: 'PH COM TEXTO', especificacaoTexto: '5 - 7', minimo: '5', maximo: '7', metodo: 'PA01'},
};
const tabela = sandbox.tabelaEspecificacoes(especs, true);
assert.ok(tabela.includes('<td>LIQUIDO</td>'), 'texto livre continua sendo impresso');
assert.ok(tabela.includes('<td>180g – 198g</td>'), '"N/A" no texto não pode esconder a faixa');
assert.ok(tabela.includes('<td>0,85 – 0,95</td>'), 'DENSIDADE sai pela faixa');
assert.ok(tabela.includes('<td>5,5 – 6,5</td>'), 'PH sai pela faixa');
assert.ok(tabela.includes('<td>49 – 52</td>'), 'texto vazio também cai na faixa');
assert.ok(tabela.includes('<td>5 - 7</td>'), 'quando há texto E faixa, o texto da Qualidade manda');
assert.ok(tabela.includes('<td>N/A</td>'), 'ensaio sem texto E sem faixa continua dizendo N/A');
// Nenhuma linha pode sair com a coluna Especificação vazia -- era esse o
// defeito. (A coluna PA pode: nem todo ensaio tem método cadastrado.)
tabela.split('</tr>').slice(1, -1).forEach(function(linha) {
  const celulas = linha.match(/<td>(.*?)<\/td>/g) || [];
  assert.ok(celulas[1] && celulas[1] !== '<td></td>',
    'especificação em branco em: ' + (celulas[0] || linha));
});
// Coluna Resultado continua em branco de propósito -- é preenchida à mão.
assert.ok(tabela.includes('<th>Resultado</th>') && tabela.includes('<td>&nbsp;</td>'));
assert.ok(sandbox.tabelaEspecificacoes({}, true).includes('Nenhuma especificação'),
  'sem ensaio cadastrado continua avisando, em vez de imprimir tabela vazia');
assert.ok(sandbox.tabelaEspecificacoes(null, true).includes('Nenhuma especificação'));

// ── 4. Avaliação do laudo usa os MESMOS limites da ficha ─────────────
// Se a ficha imprime "0,8 – 0,9", o laudo tem que reprovar 0,7.
assert.equal(sandbox.avaliarEnsaio({minimo: '0,8', maximo: '0,9'}, '0,85').conforme, true);
assert.equal(sandbox.avaliarEnsaio({minimo: '0,8', maximo: '0,9'}, '0,7').conforme, false);
assert.equal(sandbox.avaliarEnsaio({minimo: '0,8', maximo: '0,9'}, '0,95').conforme, false);
assert.equal(sandbox.avaliarEnsaio({minimo: '0,8', maximo: '0,9'}, '').conforme, null);
assert.equal(sandbox.avaliarEnsaio({especificacaoTexto: 'LÍQUIDO'}, 'x').conforme, null);
assert.match(sandbox.avaliarEnsaio({minimo: '0,8'}, '0,7').motivo, /0,8/);
// Unidade junto do limite não atrapalha a comparação nem some do motivo.
assert.equal(sandbox.avaliarEnsaio({minimo: '180g', maximo: '198g'}, '185').conforme, true);
assert.equal(sandbox.avaliarEnsaio({minimo: '180g', maximo: '198g'}, '175').conforme, false);
assert.match(sandbox.avaliarEnsaio({minimo: '180g', maximo: '198g'}, '175').motivo, /180g/);

// ── 5. Nome do arquivo: lote - cliente produto - sku ─────────────────
// Padrão que o usuário pediu, igual ao da OP em Excel que eles já
// arquivavam.
assert.equal(
  sandbox.nomeArquivoFichasOP({lote: '26244/01', cliente: 'MISS RÔSE',
    produto: 'HIDRATANTE CEU INFINITO 200g', sku: 'HDR-MISS-0001'}),
  '26244.01 - MISS RÔSE HIDRATANTE CEU INFINITO 200g - HDR-MISS-0001');
assert.equal(
  sandbox.nomeArquivoFichasOP({lote: '26261/04', cliente: 'SEUNOURA BEAUTY LTDA',
    produto: 'AGUA DE BELEZA 50ML', sku: 'PEL-SEUN-0001'}),
  '26261.04 - SEUNOURA BEAUTY LTDA AGUA DE BELEZA 50ML - PEL-SEUN-0001');
// Cadastro é texto livre: caractere proibido em nome de arquivo não pode
// passar, senão o navegador troca o nome inteiro por conta própria.
assert.equal(
  sandbox.nomeArquivoFichasOP({lote: '26244/01', cliente: 'A: B', produto: 'C*D?', sku: 'X'}),
  '26244.01 - A- B C-D- - X');
assert.equal(sandbox.nomeArquivoFichasOP({lote: '26244/01'}), '26244.01');
assert.equal(sandbox.nomeArquivoFichasOP({}), '');
assert.equal(sandbox.nomeArquivoFichasOP(null), '');

// ── 6. O título da aba volta ao normal depois de imprimir ────────────
let handler = null;
sandbox.window.addEventListener = (ev, fn) => { if (ev === 'afterprint') handler = fn; };
sandbox.window.removeEventListener = () => {};
sandbox.imprimirComNome('26244.01 - MISS RÔSE');
assert.equal(sandbox.__tituloNaImpressao, '26244.01 - MISS RÔSE',
  'o diálogo de impressão vê o nome da OP');
handler();
assert.equal(sandbox.document.title, 'Controle de OPs · Kuryos PCP',
  'a aba volta ao título dela depois da impressão');

console.log('run_fichas_op_test: OK');
