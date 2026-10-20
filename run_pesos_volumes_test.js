'use strict';
/* Peso de cada volume no recebimento (20/10/2026): 330 kg em 7 volumes =
   6 de 50 kg + 1 de 30 kg. Interpretação do texto, conferência, validação do
   servidor e etiqueta. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PV = require(path.join(__dirname, 'public', 'shared', 'pesos-volumes.js'));
const R = require(path.join(__dirname, 'functions', 'recebimento.js'));

// ── Interpretar ─────────────────────────────────────────────────────────────
const pesos = (t) => PV.interpretar(t).pesos;
assert.deepEqual(pesos('6x50 + 30'), [50, 50, 50, 50, 50, 50, 30]);
assert.deepEqual(pesos('6 x 50 + 1 x 30'), [50, 50, 50, 50, 50, 50, 30]);
assert.deepEqual(pesos('6×50;30'), [50, 50, 50, 50, 50, 50, 30]);
assert.deepEqual(pesos('6*50 30'), [50, 50, 50, 50, 50, 50, 30]);
assert.deepEqual(pesos('50 50 50 30'), [50, 50, 50, 30]);
assert.deepEqual(pesos('50, 50, 30'), [50, 50, 30], 'vírgula + espaço separa');
assert.deepEqual(pesos('2x47,5 + 45'), [47.5, 47.5, 45], 'vírgula colada é decimal');
assert.deepEqual(pesos('47.5'), [47.5], 'ponto também é decimal');
assert.deepEqual(pesos('1x330'), [330]);
assert.equal(pesos(''), null); assert.equal(pesos('   '), null); assert.equal(PV.interpretar(null).ok, true);
for (const ruim of ['abc', '6x', 'x50', '6xabc', '0', '-5', '6x0', '50 + + 30x', '1,2,3']) {
  const r = PV.interpretar(ruim);
  assert.equal(r.ok, false, 'rejeita "' + ruim + '"'); assert.match(r.erro, /Não entendi|inválida/);
}
assert.equal(PV.interpretar('10000x1').ok, false, 'limite de volumes');

// ── Conferir ────────────────────────────────────────────────────────────────
assert.equal(PV.conferir(pesos('6x50 + 30'), 330, 7).ok, true);
assert.equal(PV.conferir(pesos('6x50 + 30'), 330, 7).soma, 330);
assert.match(PV.conferir(pesos('6x50 + 20'), 330, 7).erro, /somam 320 e a quantidade é 330 \(faltam 10\)/);
assert.match(PV.conferir(pesos('6x50 + 40'), 330, 7).erro, /sobram 10/);
assert.match(PV.conferir(pesos('6x50 + 30'), 330, 5).erro, /descrevem 7 volume\(s\), mas o campo de volumes tem 5/);
assert.equal(PV.conferir(pesos('0,1 + 0,2'), 0.3, 2).ok, true, 'ponto flutuante não reprova 0,1 + 0,2');
assert.equal(PV.conferir(null, 330, 7).informado, false);
assert.equal(PV.conferir([], 330, 7).ok, true);

// ── Resumo ──────────────────────────────────────────────────────────────────
assert.equal(PV.resumo(pesos('6x50 + 30'), 'kg'), '6 × 50 + 1 × 30 = 330 kg');
assert.equal(PV.resumo(pesos('2x47,5 + 45'), 'kg'), '2 × 47,5 + 1 × 45 = 140 kg');
assert.equal(PV.resumo(null, 'kg'), '');

// ── Servidor (functions/recebimento.js): a mesma conferência, e guarda os pesos ─
const pedido = {itens: {i1: {materialCodigo: 'MPES-00142', materialNome: 'ESSENCIA', unidade: 'kg', qtd: 330, qtdRecebida: 0}}};
const enderecos = {A1: {codigo: 'FAB-1.1.1', ativo: true}};
const payload = (extra) => ({data: '2026-10-20', notaFiscal: '2906', condicoesVeiculo: 5, linhas: [Object.assign({
  itemKey: 'i1', tipoMaterial: 'MATERIA_PRIMA', identificacaoMaterial: 'Essência', skuFornecedor: 'GF48427', loteOrigem: '2026109/249',
  qtdRecebida: 330, qtdVolumes: 7, certificadoFornecedor: 'SIM', condicoesEmbalagem: 5, enderecoKey: 'A1'}, extra)]});
{
  const ok = R.validarEPrepararLinhas(payload({volumesPesos: [50, 50, 50, 50, 50, 50, 30]}), pedido, enderecos);
  assert.deepEqual(ok.linhas[0].volumesPesos, [50, 50, 50, 50, 50, 50, 30]);
  assert.equal(R.validarEPrepararLinhas(payload({}), pedido, enderecos).linhas[0].volumesPesos, null, 'sem pesos: null (a etiqueta divide igual)');
  assert.equal(R.validarEPrepararLinhas(payload({volumesPesos: null}), pedido, enderecos).linhas[0].volumesPesos, null);
  const recusa = (extra, re) => assert.throws(() => R.validarEPrepararLinhas(payload(extra), pedido, enderecos), re);
  recusa({volumesPesos: [50, 50, 50, 50, 50, 50, 20]}, /MPES-00142: Os pesos somam 320 e a quantidade é 330/);
  recusa({volumesPesos: [50, 50, 50]}, /descrevem 3 volume\(s\), mas o campo de volumes tem 7/);
  recusa({volumesPesos: [330, 0, 0, 0, 0, 0, 0]}, /maior que zero/);
  recusa({volumesPesos: 'x'}, /inválidos/);
  recusa({volumesPesos: []}, /inválidos/);
  recusa({volumesPesos: [-1, 100, 100, 100, 100, 100, 100]}, /maior que zero/);
}
assert.equal(fs.readFileSync('functions/pesos_volumes.js', 'utf8'), fs.readFileSync('public/shared/pesos-volumes.js', 'utf8'), 'a regra do servidor é a da tela');

// ── Etiqueta ────────────────────────────────────────────────────────────────
const ctx = {console, Number, Math, String, Object, Array};
ctx.window = ctx; ctx.code39Svg = () => ''; ctx.code39Modulos = () => 100; ctx.qrCodeSvg = () => '';
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/shared/etiquetas-wms.js', 'utf8'), ctx);
const lote = {loteInterno: 'AK-2026-000630', materialCodigo: 'MPES-00142', materialNome: 'ESSENCIA', quantidade: 330, qtdVolumes: 7, unidade: 'kg', volumesPesos: [50, 50, 50, 50, 50, 50, 30]};
const qtdDe = (html) => html.split('<section class="etq">').slice(1).map((c) => /<b>Quantidade<\/b><span>([^<]*)<\/span>/.exec(c)[1]);
assert.deepEqual(qtdDe(ctx.EtiquetasWMS.pagina('recebimento', [lote])), [
  ...Array.from({length: 6}, (_, i) => `50 kg · volume ${i + 1} de 7 (total 330 kg)`), '30 kg · volume 7 de 7 (total 330 kg)']);
// Com fração: duas casas em todos.
assert.deepEqual(qtdDe(ctx.EtiquetasWMS.pagina('recebimento', [Object.assign({}, lote, {quantidade: 140, qtdVolumes: 3, volumesPesos: [47.5, 47.5, 45]})])),
  ['47,50 kg · volume 1 de 3 (total 140 kg)', '47,50 kg · volume 2 de 3 (total 140 kg)', '45,00 kg · volume 3 de 3 (total 140 kg)']);
// Lista com tamanho diferente dos volumes é ignorada: volta à divisão igual.
assert.equal(qtdDe(ctx.EtiquetasWMS.pagina('recebimento', [Object.assign({}, lote, {volumesPesos: [100, 230]})]))[0], '47,15 kg · volume 1 de 7 (total 330 kg)');
// Sem pesos: divisão igual (comportamento anterior).
assert.equal(qtdDe(ctx.EtiquetasWMS.pagina('recebimento', [Object.assign({}, lote, {volumesPesos: null})]))[6], '47,14 kg · volume 7 de 7 (total 330 kg)');

// ── Telas ───────────────────────────────────────────────────────────────────
const log = fs.readFileSync('public/logistica.html', 'utf8');
assert.ok(/shared\/pesos-volumes\.js/.test(log) && /class="rc-pesos"/.test(log) && /function atualizarPesosLote/.test(log));
assert.ok(/volumesPesos:q\.volumes \|\| null/.test(log), 'reimprimir usa os pesos guardados');
const idx = fs.readFileSync('functions/index.js', 'utf8');
assert.ok(/volumes: linha\.volumesPesos \|\| null/.test(idx) && /volumesPesos: linha\.volumesPesos \|\| null/.test(idx), 'servidor guarda e devolve os pesos');
console.log('run_pesos_volumes_test: OK');
