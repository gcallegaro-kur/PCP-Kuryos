'use strict';
/* Etiqueta de recebimento: o peso de CADA volume, com a soma fechando no total
   (pedido da Logística, 20/10/2026: 330 kg em 7 volumes saía 330 kg em todas). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ctx = {console, Number, Math, String, Object};
ctx.window = ctx;
ctx.code39Svg = () => '<svg></svg>'; ctx.code39Modulos = () => 100; ctx.qrCodeSvg = () => '<svg></svg>';
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/shared/etiquetas-wms.js', 'utf8'), ctx);
const E = ctx.EtiquetasWMS, q = E.quantidadeDoVolume;

const soma = (t, n, u) => { let s = 0; for (let i = 1; i <= n; i++) s += Math.round(q(t, n, i, u).valor * 100); return s / 100; };

// ── A divisão fecha SEMPRE no total ─────────────────────────────────────────
assert.deepEqual(Array.from({length: 7}, (_, i) => q(330, 7, i + 1, 'kg').valor), [47.15, 47.15, 47.14, 47.14, 47.14, 47.14, 47.14]);
for (const [t, n, u] of [[330, 7, 'kg'], [350, 7, 'kg'], [10.5, 4, 'kg'], [5, 7, 'kg'], [100, 3, 'un'], [1000, 13, 'L'], [0.1, 3, 'kg'], [999.99, 11, 'kg'], [7, 7, 'un'], [3, 7, 'un']]) {
  assert.equal(soma(t, n, u), t, `${t} ${u} em ${n} volumes: soma ${soma(t, n, u)}`);
}
// Unidade discreta: inteiros (o resto vai para os primeiros).
assert.deepEqual(Array.from({length: 3}, (_, i) => q(100, 3, i + 1, 'un').valor), [34, 33, 33]);
// Um volume só: o próprio total. Volume fora do intervalo não quebra.
assert.equal(q(330, 1, 1, 'kg').valor, 330); assert.equal(q(330, 1, 1, 'kg').dividido, false);
assert.equal(q(330, 7, 99, 'kg').valor, 47.14, 'volume além do último vira o último');
assert.equal(q('x', 3, 1, 'kg').dividido, false, 'valor inválido não quebra');
// Nenhum volume negativo ou zerado quando há quantidade suficiente.
for (let i = 1; i <= 7; i++) assert.ok(q(330, 7, i, 'kg').valor > 0);

// ── A etiqueta ──────────────────────────────────────────────────────────────
const lote = {loteInterno: 'AK-2026-000630', loteOrigem: '2026109/249', materialCodigo: 'MPES-00142', materialNome: 'ESSENCIA DESERT BOURBON MOD 3 - GF48427',
  fornecedorNome: 'GINGER FRAGRANCES', quantidade: 330, qtdVolumes: 7, unidade: 'kg', enderecoCodigo: 'FAB-1.1.1', dataRecebimento: '2026-10-16', notaFiscal: '2906', dataValidade: '2026-10-03'};
const html = E.pagina('recebimento', [lote]);
const cartoes = html.split('<section class="etq">').slice(1);
assert.equal(cartoes.length, 7, 'uma etiqueta por volume');
const qtdDe = (c) => /<b>Quantidade<\/b><span>([^<]*)<\/span>/.exec(c)[1];
assert.equal(qtdDe(cartoes[0]), '47,15 kg · volume 1 de 7 (total 330 kg)');
assert.equal(qtdDe(cartoes[1]), '47,15 kg · volume 2 de 7 (total 330 kg)');
assert.equal(qtdDe(cartoes[2]), '47,14 kg · volume 3 de 7 (total 330 kg)');
assert.equal(qtdDe(cartoes[6]), '47,14 kg · volume 7 de 7 (total 330 kg)');
assert.doesNotMatch(html, /330 kg · volume 1 de 7<\/span>/, 'o total repetido (o defeito) não volta');
const pesos = cartoes.map((c) => Number(/^([\d,]+) kg/.exec(qtdDe(c))[1].replace(',', '.')));
assert.equal(Math.round(pesos.reduce((a, b) => a + b, 0) * 100) / 100, 330, 'a soma das etiquetas é o total da entrada');
// Divisão exata: sem casas decimais sobrando.
const exato = E.pagina('recebimento', [Object.assign({}, lote, {quantidade: 350})]).split('<section class="etq">').slice(1);
assert.equal(qtdDe(exato[0]), '50 kg · volume 1 de 7 (total 350 kg)');
// Unidade discreta.
const un = E.pagina('recebimento', [Object.assign({}, lote, {quantidade: 100, qtdVolumes: 3, unidade: 'un'})]).split('<section class="etq">').slice(1);
assert.deepEqual(un.map(qtdDe), ['34 un · volume 1 de 3 (total 100 un)', '33 un · volume 2 de 3 (total 100 un)', '33 un · volume 3 de 3 (total 100 un)']);
// Um volume: etiqueta como sempre.
const um = E.pagina('recebimento', [Object.assign({}, lote, {qtdVolumes: 1})]).split('<section class="etq">').slice(1);
assert.equal(um.length, 1); assert.equal(qtdDe(um[0]), '330 kg · volume 1 de 1');
// Sem qtdVolumes (lote antigo): 1 etiqueta, total.
assert.equal(qtdDe(E.pagina('recebimento', [Object.assign({}, lote, {qtdVolumes: undefined})]).split('<section class="etq">')[1]), '330 kg · volume 1 de 1');
// O resto do cartão não mudou.
assert.match(cartoes[0], /AK-2026-000630/); assert.match(cartoes[0], /GINGER FRAGRANCES/); assert.match(cartoes[0], /16\/10\/2026 · 2906/);
console.log('run_etiquetas_volume_test: OK');
