/* Registrar Recebimento x Formulário de entrada de materiais.
   Cobre a amostragem √n+1 (calculada e travada) e a paridade com as 14
   perguntas do formulário, que é o que o pedido do usuário exige. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const arquivo = path.join(__dirname, 'public', 'logistica.html');
const html = fs.readFileSync(arquivo, 'utf8');

const ini = html.indexOf('var UNIDADES_CONTINUAS_AMOSTRA');
const fim = html.indexOf('function atualizarAmostragemLote(', ini);
assert.ok(ini > 0 && fim > ini, 'amostragemDoLote não encontrada em logistica.html');
const sandbox = {};
vm.createContext(sandbox);
new vm.Script(html.slice(ini, fim), {filename: 'logistica.html#amostragemDoLote'}).runInContext(sandbox);
const amostra = sandbox.amostragemDoLote;
const amostragem = (q) => amostra(q, 1, 'un');

// ── 1. Unidade discreta: √n + 1 sobre a quantidade, arredondado para cima ──
assert.equal(amostragem(5000), 72);   // √5000 = 70,71 → 71,71 → 72
assert.equal(amostragem(100), 11);    // √100 = 10 exato → 11
assert.equal(amostragem(10000), 101); // quadrado perfeito não pode virar 102
assert.equal(amostragem(9), 4);
// Nunca passa do total: lote pequeno é amostrado inteiro (o servidor recusava).
assert.equal(amostragem(1), 1);
assert.equal(amostragem(2), 2);
assert.equal(amostragem(3), 3);       // √3 + 1 = 2,73 → 3
assert.equal(amostragem(4), 3);
[16, 25, 36, 49, 64, 81, 144, 400, 900, 2500].forEach(function (q) {
  assert.equal(amostragem(q), Math.sqrt(q) + 1, 'quadrado perfeito ' + q);
});
let ant = 0;
for (let q = 1; q <= 3000; q++) {
  const a = amostragem(q);
  assert.ok(a >= ant, 'amostragem caiu de ' + ant + ' para ' + a + ' em ' + q);
  assert.ok(a <= q, 'amostra maior que o lote em ' + q);
  ant = a;
}

// ── 1b. Unidade contínua (kg, g, L, ml): √VOLUMES + 1, em volumes ──
// PC-0051 (19/10): 1 kg de corante em 1 volume pedia "2" e travava a entrada.
assert.equal(amostra(1, 1, 'kg'), 1, '1 kg em 1 volume: amostra do único volume');
assert.equal(amostra(1000, 1, 'kg'), 1, 'massa não entra na conta');
assert.equal(amostra(1000, 4, 'kg'), 3);   // √4 + 1
assert.equal(amostra(500, 20, 'L'), 6);    // √20 = 4,47 → 5,47 → 6
assert.equal(amostra(2, 2, 'g'), 2, 'nunca mais volumes do que existem');
assert.equal(amostra(0.25, 1, ' KG '), 1, 'unidade sem caixa e com espaço');
assert.equal(amostra(50, 3, 'ml'), 3);

// ── 2. Item não recebido nesta entrega não gera amostra ──────────────
[0, -5, '', null, undefined, 'abc'].forEach((q) => { assert.equal(amostragem(q), 0); assert.equal(amostra(q, 3, 'kg'), 0); });

// ── 2b. O servidor calcula com a MESMA regra e ignora o número do navegador ──
const R = require('./functions/recebimento.js');
for (const u of ['un', 'kg', 'L', 'rolo', 'g']) for (const q of [0, 0.5, 1, 2, 3, 7, 48, 1000, 5000]) for (const v of [1, 2, 5, 40]) {
  assert.equal(R.amostragemDoLote(q, v, u), amostra(q, v, u), 'servidor x tela ' + [q, v, u]);
}

// ── 3. O valor gravado é RECALCULADO, não lido do input ──────────────
// O campo é readonly, mas confiar no DOM deixaria um número errado chegar
// à fila da Qualidade se a tela não tivesse sido atualizada.
assert.ok(/qtdAmostragem: amostragemDoLote\(qtd, /.test(html),
  'lerItensRecebimentoDaTela deve recalcular a amostragem, não ler o input');
assert.ok(/class="rc-readonly rc-amostragem" type="number" readonly/.test(html),
  'o campo de amostragem precisa ser travado');
assert.ok(!/class="rc-amostragem" type="number" min="0" step="any"/.test(html),
  'sobrou o campo de amostragem editável antigo');

// ── 4. Paridade com as 14 perguntas do formulário ────────────────────
// Fonte: https://forms.cloud.microsoft/r/HDwua0LnV1 (lido em 2026-09-14).
const perguntas = [
  ['1. Tipo de material',                 /class="rc-tipo"/],
  ['2. Identificação do Material',        /class="rc-identificacao"/],
  ['3. SKU Fornecedor',                   /class="rc-sku-fornecedor"/],
  ['4. SKU interno',                      /rc-readonly rc-sku-interno/],
  ['5. Lote',                             /class="rc-lote"/],
  ['6. Lote Interno',                     /rc-auto-lote/],
  ['7. Fornecedor',                       /id="rcFornecedor"/],
  ['8. Nº da NF',                         /id="rcNotaFiscal"/],
  ['9. Quantidade recebida',              /class="rc-qtd"/],
  ['10. Quantidade de Amostragem',        /rc-readonly rc-amostragem/],
  ['11. Data de Recebimento',             /id="rcData"/],
  ['12. Certificado do Fornecedor',       /class="rc-certificado"/],
  ['13. Condições do Veículo',            /id="rcCondVeiculo"/],
  ['14. Condições da Embalagem',          /class="rc-cond-embalagem"/]
];
perguntas.forEach(function (p) {
  assert.ok(p[1].test(html), 'pergunta ausente na tela: ' + p[0]);
});
assert.equal(perguntas.length, 14);

// Escalas 13 e 14 são de 1 a 5, como as estrelas do formulário.
const escala = html.match(/<option value="5">5 — Ótimo<\/option>/g) || [];
assert.ok(escala.length >= 1, 'escala de 1 a 5 ausente');

// ── 5. Campo Fornecedor é espelho do Pedido de Compra, não digitável ──
assert.ok(/id="rcFornecedor" class="rc-readonly" readonly/.test(html), 'Fornecedor deve ser travado');
assert.ok(/getElementById\('rcFornecedor'\)\.value = p\.fornecedorNome/.test(html),
  'Fornecedor precisa ser preenchido a partir do Pedido de Compra');

// ── 6. Recálculo religado nos dois gatilhos e no lote adicionado ─────
assert.ok(/lista\.oninput = function/.test(html), 'recálculo sem gatilho de digitação');
assert.ok(/rc-qtd'\) \|\| e\.target\.classList\.contains\('rc-volumes'/.test(html),
  'quantidade e volumes precisam disparar o recálculo');
assert.ok(/lista\.querySelectorAll\('\.rc-lote-row'\)\.forEach\(atualizarAmostragemLote\)/.test(html),
  'os lotes já na tela precisam nascer calculados');
assert.ok(/atualizarAmostragemLote\(card\.querySelector\('\.rc-lotes'\)\.lastElementChild\)/.test(html),
  'lote adicionado por "+ Outro lote" precisa nascer calculado');

// ── 7. Sintaxe dos scripts inline ────────────────────────────────────
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
assert.ok(scripts.length, 'nenhum script inline encontrado');
scripts.forEach((code, i) => new vm.Script(code, {filename: 'logistica.html#script-' + i}));

console.log('run_recebimento_amostragem_test: OK');
