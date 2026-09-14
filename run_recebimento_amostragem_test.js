/* Registrar Recebimento x Formulário de entrada de materiais.
   Cobre a amostragem √n+1 (calculada e travada) e a paridade com as 14
   perguntas do formulário, que é o que o pedido do usuário exige. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const arquivo = path.join(__dirname, 'public', 'logistica.html');
const html = fs.readFileSync(arquivo, 'utf8');

const ini = html.indexOf('function amostragemDoLote(');
const fim = html.indexOf('function atualizarAmostragemLote(', ini);
assert.ok(ini > 0 && fim > ini, 'amostragemDoLote não encontrada em logistica.html');
const sandbox = {};
vm.createContext(sandbox);
new vm.Script(html.slice(ini, fim), {filename: 'logistica.html#amostragemDoLote'}).runInContext(sandbox);
const amostragem = sandbox.amostragemDoLote;

// ── 1. √n + 1, arredondado para cima ─────────────────────────────────
assert.equal(amostragem(5000), 72);   // √5000 = 70,71 → 71,71 → 72
assert.equal(amostragem(100), 11);    // √100 = 10 exato → 11
assert.equal(amostragem(10000), 101); // quadrado perfeito não pode virar 102
assert.equal(amostragem(1), 2);
assert.equal(amostragem(2), 3);       // √2 = 1,41 → 2,41 → 3
assert.equal(amostragem(9), 4);
// quadrado perfeito nunca arredonda para cima por erro de ponto flutuante
[4, 16, 25, 36, 49, 64, 81, 144, 400, 900, 2500].forEach(function (q) {
  assert.equal(amostragem(q), Math.sqrt(q) + 1, 'quadrado perfeito ' + q);
});
// monotônica: receber mais nunca pode pedir menos amostra
let ant = 0;
for (let q = 1; q <= 3000; q++) {
  const a = amostragem(q);
  assert.ok(a >= ant, 'amostragem caiu de ' + ant + ' para ' + a + ' em ' + q);
  ant = a;
}

// ── 2. Item não recebido nesta entrega não gera amostra ──────────────
assert.equal(amostragem(0), 0);
assert.equal(amostragem(-5), 0);
assert.equal(amostragem(''), 0);
assert.equal(amostragem(null), 0);
assert.equal(amostragem(undefined), 0);
assert.equal(amostragem('abc'), 0);
// quantidade fracionada (granel em kg) continua válida
assert.equal(amostragem(0.25), 2);    // √0,25 = 0,5 → 1,5 → 2

// ── 3. O valor gravado é RECALCULADO, não lido do input ──────────────
// O campo é readonly, mas confiar no DOM deixaria um número errado chegar
// à fila da Qualidade se a tela não tivesse sido atualizada.
assert.ok(/qtdAmostragem: amostragemDoLote\(qtd\)/.test(html),
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
