/* Laudos do CQ — o documento que sai impresso (shared/laudo-cq.js).

   O alvo não é "um relatório bonito": é o "RELATÓRIO DE ANÁLISE – PRODUTO
   ACABADO" que a Kuryos já emite, cujo modelo Word está em
   `06. Laboratório/01. CQ/23. Relatório de análise`. As asserções abaixo
   foram escritas contra um laudo REAL emitido em setembro (lote 26244/09,
   HIDRATANTE ROSA RAINHA), não contra dados inventados — por isso valem
   como conferência de paridade com o papel. */
const assert = require('node:assert/strict');
const L = require('./public/shared/laudo-cq.js');

// Pesos reais das 32 unidades do lote 26244/09.
const PESOS = [194, 191, 192, 191, 191, 190, 191, 190, 190, 191, 191, 191, 191, 190, 190, 190,
  191, 190, 189, 186, 189, 185, 187, 192, 187, 187, 192, 192, 187, 187, 186, 187];

function dados(extra) {
  return Object.assign({
    produto: 'HIDRATANTE ROSA RAINHA', codInterno: 'HDR-MISS-0006', codCliente: 'HDR-MISS-0006',
    lote: '26244/09', dataFabricacao: '2026-09-02', validade: '2029-09-02', empresa: 'MISS RÔSE',
    fq: [{parametro: 'pH (25°C)', especificacao: '5,0 – 6,0', resultado: '5,0', metodo: 'pHmetro calibrado'}],
    embalagem: [{parametro: 'Conformidade do Rótulo', resultado: 'Conforme'}],
    pa: {defeitoMenor: 0, defeitoMaior: 0, defeitoCritico: 0, pesoMedio: 189.62},
    pesos: PESOS, unidadePeso: 'g', pesoNominal: 200, pesoMinimo: 174,
    micro: {incluir: true}, conclusao: 'APROVADO', observacoes: '',
    dataAnalise: '2026-09-04', responsavel: {nome: 'Mario Callegaro', registro: 'CRQ 04413184'},
  }, extra || {});
}
const texto = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

// ── 1. As nove seções do modelo, na ordem ────────────────────────────
const html = L.paginaProdutoAcabado(dados());
const t = texto(html);
const secoes = ['1. Identificação do Produto', '2. Informações do Cliente',
  '3. Resultados de Análise FQ', '4. Resultado de Aspecto Visual – Embalagem',
  '5. Resultados de Análise PA', '6. Análises Microbiológicas', '7. Conclusão',
  '8. Observações', '9. Responsáveis'];
let posicao = -1;
secoes.forEach(function(s) {
  const i = t.indexOf(s);
  assert.ok(i > posicao, 'seção fora de ordem ou ausente: ' + s);
  posicao = i;
});
assert.ok(t.includes('RELATÓRIO DE ANÁLISE'), 'cabeçalho do documento oficial');
assert.ok(t.includes('LABORATÓRIO DE CONTROLE DE QUALIDADE'));

// ── 2. Identificação vem dos dados, não de placeholder ───────────────
assert.ok(t.includes('HIDRATANTE ROSA RAINHA'));
assert.ok(t.includes('26244/09'));
assert.ok(t.includes('02/09/2026'), 'data de fabricação em dd/mm/aaaa');
assert.ok(t.includes('02/09/2029'), 'validade em dd/mm/aaaa');
assert.ok(t.includes('MISS RÔSE'));
// Campo sem dado sai como lacuna para preencher à mão, nunca em branco mudo.
assert.ok(texto(L.paginaProdutoAcabado(dados({empresa: ''}))).includes('____________________'));

// ── 3. A amostragem que aparece é a que foi feita ────────────────────
// O modelo Word dizia "32 amostras" fixo porque 32 era o número cravado no
// Forms. Agora a frase acompanha quantas unidades foram pesadas de verdade.
assert.ok(t.includes('Análise de Peso: 32 amostras'));
assert.ok(t.includes('Tabela de peso (amostra de 32 peças)'));
const dez = texto(L.paginaProdutoAcabado(dados({pesos: PESOS.slice(0, 10)})));
assert.ok(dez.includes('Análise de Peso: 10 amostras'), 'a frase segue a pesagem real');
assert.ok(dez.includes('amostra de 10 peças'));
const uma = texto(L.paginaProdutoAcabado(dados({pesos: [190]})));
assert.ok(uma.includes('Análise de Peso: 1 amostra '), 'singular quando é uma só');

// ── 4. Média do laudo bate com a média da tabela ─────────────────────
// Duas médias diferentes no mesmo documento derrubam a confiança no laudo
// inteiro -- as duas saem do MESMO cálculo sobre os pesos impressos.
const media = PESOS.reduce((s, v) => s + v, 0) / PESOS.length;
const mediaTexto = media.toFixed(2).replace('.', ',');
assert.equal((t.match(new RegExp(mediaTexto.replace(',', ','), 'g')) || []).length, 2,
  'a média aparece em 5.1 e em 5.2, e é a mesma');
assert.ok(t.includes('185,00'), 'mínimo da amostra');
assert.ok(t.includes('194,00'), 'máximo da amostra');

// ── 5. Tabela de peso: 4 colunas, todas as unidades, na ordem ────────
const tab = L.tabelaPesos(PESOS, 'g');
assert.equal((tab.match(/<tr>/g) || []).length, 9, '1 cabeçalho + 8 linhas para 32 pesos');
PESOS.forEach(function(p, i) {
  assert.ok(tab.includes('<td>' + (i + 1) + '</td>'), 'unidade ' + (i + 1) + ' numerada');
});
assert.ok(L.tabelaPesos([], 'g').includes('Nenhuma unidade pesada'),
  'sem pesagem o laudo diz que não houve, em vez de imprimir tabela vazia');

// ── 6. Microbiológicas: entra ou não entra ───────────────────────────
// Pedido do usuário (21/09), mesma decisão que o gerar_relatorio.py tomava
// perguntando "teor alcoólico acima de 60%?".
assert.ok(t.includes('Pseudomonas aeruginosa'), 'tabela micro por padrão');
assert.ok(t.includes('RDC 907/2024'));
const semMicro = texto(L.paginaProdutoAcabado(dados({micro: {incluir: false}})));
assert.ok(!semMicro.includes('Pseudomonas'), 'sem micro, a tabela não sai');
assert.ok(semMicro.includes('≥ 60%'), 'sai a justificativa técnica da dispensa');
assert.ok(semMicro.includes('6. Análises Microbiológicas'), 'a seção continua existindo');
const comLab = texto(L.paginaProdutoAcabado(dados({micro: {incluir: true, laboratorio: 'LAB-2026-88'}})));
assert.ok(comLab.includes('LAB-2026-88'), 'laudo externo citado quando informado');

// ── 7. Conclusão marca só uma caixa ──────────────────────────────────
assert.ok(t.includes('☒ Produto APROVADO'));
assert.ok(t.includes('☐ Produto REPROVADO'));
const repr = texto(L.paginaProdutoAcabado(dados({conclusao: 'REPROVADO'})));
assert.ok(repr.includes('☐ Produto APROVADO') && repr.includes('☒ Produto REPROVADO'));
// Sem decisão registrada, nenhuma caixa é marcada -- laudo não decide nada.
const semDec = texto(L.paginaProdutoAcabado(dados({conclusao: ''})));
assert.ok(semDec.includes('☐ Produto APROVADO') && semDec.includes('☐ Produto REPROVADO'));

// ── 8. C/NC do sistema → a palavra do papel ──────────────────────────
assert.equal(L.cnc('C'), 'Conforme');
assert.equal(L.cnc('NC'), 'Não conforme');
assert.equal(L.cnc('NA'), 'Não aplicável');
// Item não respondido NÃO pode virar "Conforme": num documento de BPF isso
// seria registro falso. Em branco é pendência visível.
assert.equal(L.cnc(''), '');
assert.equal(L.cnc(undefined), '');

// ── 9. Nada de HTML injetado por dado de cadastro ────────────────────
const perigoso = L.paginaProdutoAcabado(dados({produto: '<script>alert(1)</script>'}));
assert.ok(!perigoso.includes('<script>alert'), 'texto de cadastro é escapado');
assert.ok(perigoso.includes('&lt;script&gt;'));

// ── 10. Nome do arquivo igual ao que a Qualidade já arquivava ────────
// "Relatório de análise - HIDRATANTE ROSA RAINHA - 26244.09.pdf"
assert.equal(L.nomeArquivo('Relatório de análise', dados()),
  'Relatório de análise - HIDRATANTE ROSA RAINHA - 26244.09');
assert.equal(L.nomeArquivo('Relatório de análise', {produto: 'A/B', lote: '26244/09'}),
  'Relatório de análise - A-B - 26244.09', 'caractere proibido em nome de arquivo não passa');

console.log('run_laudo_cq_test: OK');
