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

// ── 3. A ficha impressa: texto manda, faixa entra quando falta ───────
// Ensaios reais da OP 26261/04 (o PDF que o usuário mandou): DENSIDADE e
// CONTEÚDO LÍQUIDO MÉDIO estavam cadastrados por faixa e saíam vazios.
const especs = {
  e1: {ensaio: 'ASPECTO', especificacaoTexto: 'LIQUIDO', metodo: 'PA09'},
  e2: {ensaio: 'DENSIDADE', especificacaoTexto: '', minimo: '0,98', maximo: '1,0', metodo: 'PA03'},
  e3: {ensaio: 'CONTEÚDO LÍQUIDO MÉDIO', minimo: 49, maximo: 52, metodo: 'F060'},
  e4: {ensaio: 'PH', especificacaoTexto: '5 - 7', minimo: '5', maximo: '7', metodo: 'PA01'},
};
const tabela = sandbox.tabelaEspecificacoes(especs, true);
assert.ok(tabela.includes('<td>LIQUIDO</td>'), 'texto livre continua sendo impresso');
assert.ok(tabela.includes('<td>0,98 – 1</td>'), 'DENSIDADE sai pela faixa, não em branco');
assert.ok(tabela.includes('<td>49 – 52</td>'), 'CONTEÚDO LÍQUIDO MÉDIO sai pela faixa');
assert.ok(tabela.includes('<td>5 - 7</td>'), 'quando há texto E faixa, o texto da Qualidade manda');
assert.ok(!/<td><\/td>/.test(tabela), 'nenhuma célula de especificação em branco');
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
