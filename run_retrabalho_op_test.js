/* Retrabalho é uma OP (shared/retrabalho-op.js).

   O usuário refez o escopo em 22/09: "apenas poder abrir uma OP, mas de
   retrabalho, ao invés de criar uma nova op". O que este teste protege é a
   parte que não pode dar errado nunca: **não contar a mesma produção duas
   vezes**. E isso não depende de nenhuma regra nova — depende de duas
   ausências no registro da OP. Se alguém, um dia, "completar" o objeto com
   skuPedidoKey ou materiaisConsumo achando que faltava, o lote passa a ser
   creditado ao pedido de novo e o BOM baixa outra vez. É por isso que as
   duas ausências têm asserção própria aqui. */
const assert = require('node:assert/strict');
const R = require('./public/shared/retrabalho-op.js');

const ORIGINAL = {
  lote: '26216/04', sku: 'PRF-TAWUS-30', produto: 'PERFUME TAWUS 30ML', cliente: 'DAPOP',
  status: 'Concluído', qtdPlanejada: 900, produzidoLinha: 867, produzido: 867,
  skuPedidoKey: '0017__PRF', validade: '2028-08-01', pecasPorCaixa: 24, ean13: '7899999000012',
  materiaisConsumo: {a: {mpCodigo: 'EP-01', quantidade: 900, origem: 'bom'}},
};
const dados = (extra) => Object.assign({
  opOriginal: ORIGINAL, opOriginalKey: '26216-04',
  motivo: 'Sedimentação inesperada do corante, formando precipitado.',
  escopo: 'Lote inteiro', qtdPlanejada: 867,
  destino: {tipo: 'linha', nome: 'Linha 2'},
  autor: 'Gustavo', agora: '2026-09-22T18:00:00.000Z',
}, extra || {});

// ── 1. Numeração: lote original + RT, não lote novo ──────────────────
// Decisão do usuário: é o MESMO lote voltando para a linha.
assert.equal(R.proximoNumero('26216/04', {}), '26216/04-RT1');
assert.equal(R.proximoNumero('26216/04', {a: {lote: '26216/04-RT1', tipoOrdem: 'RETRABALHO'}}),
  '26216/04-RT2', 'segundo retrabalho do mesmo lote');
assert.equal(R.proximoNumero('26216/04', {
  a: {lote: '26216/04-RT1'}, b: {lote: '26216/04-RT2'}, c: {lote: '26216/04-RT3'}}), '26216/04-RT4');
// OP de OUTRO lote não interfere na contagem.
assert.equal(R.proximoNumero('26216/04', {a: {lote: '26100/01-RT1'}, b: {lote: '26216/05-RT9'}}),
  '26216/04-RT1');
assert.equal(R.proximoNumero('', {}), '');

// ── 2. As duas ausências que impedem contar duas vezes ───────────────
const op = R.montar(dados());
assert.equal(op.skuPedidoKey, '',
  'SEM vínculo de pedido: as unidades já foram creditadas quando a OP original rodou');
assert.deepEqual(op.materiaisConsumo, {},
  'SEM BOM: retrabalho não refabrica o produto, então não baixa fórmula/embalagem de novo');
// E o que veio do original não arrastou esses dois campos junto.
assert.notEqual(op.skuPedidoKey, ORIGINAL.skuPedidoKey);
assert.notDeepEqual(op.materiaisConsumo, ORIGINAL.materiaisConsumo);

// ── 3. Herda o que identifica o produto ──────────────────────────────
assert.equal(op.lote, '26216/04-RT1');
assert.equal(op.tipoOrdem, 'RETRABALHO');
assert.equal(op.retrabalhoDe, '26216/04');
assert.equal(op.retrabalhoDeOpKey, '26216-04');
assert.equal(op.sku, 'PRF-TAWUS-30');
assert.equal(op.produto, 'PERFUME TAWUS 30ML');
assert.equal(op.cliente, 'DAPOP');
assert.equal(op.validade, '2028-08-01');
assert.equal(op.pecasPorCaixa, 24);
assert.equal(op.qtdPlanejada, 867);
assert.equal(op.emitidoPor, 'Gustavo');
assert.equal(op.dataEmissao, '2026-09-22T18:00:00.000Z');

// ── 4. Nasce zerada e não iniciada ───────────────────────────────────
assert.equal(op.status, 'Não Iniciado');
['produzidoLinha', 'produzidoRotulagem', 'produzidoPosto', 'produzido'].forEach(function(c) {
  assert.equal(op[c], 0, c + ' começa em zero');
});
assert.equal(op.abertaDesde, null);
assert.equal(op.setupInicio, null);

// ── 5. Destino: linha, rotulagem ou posto ────────────────────────────
// É o pedido do usuário: "pode ser alocada em linhas de produção ou postos
// de trabalho". `linha` guarda o nome nos três casos porque é o campo que o
// Painel de Turno e a Grade já leem.
assert.equal(op.linha, 'Linha 2');
assert.equal(op.retrabalhoDestino, 'linha');
const noPosto = R.montar(dados({destino: {tipo: 'posto', nome: 'Bancada 1'}}));
assert.equal(noPosto.linha, 'Bancada 1');
assert.equal(noPosto.retrabalhoDestino, 'posto');
assert.equal(R.destinoRotulo(noPosto), 'Posto de trabalho');
const naRot = R.montar(dados({destino: {tipo: 'rotulagem', nome: 'Rotulagem 1'}}));
assert.equal(naRot.retrabalhoDestino, 'rotulagem');
assert.equal(R.destinoRotulo(naRot), 'Estação de rotulagem');

// ── 6. Validação ─────────────────────────────────────────────────────
assert.equal(R.validar(dados()).ok, true);
assert.match(R.validar(dados({motivo: '  '})).erros.join(' '), /motivo/i);
assert.match(R.validar(dados({qtdPlanejada: 0})).erros.join(' '), /quantas unidades/i);
assert.match(R.validar(dados({qtdPlanejada: -5})).erros.join(' '), /quantas unidades/i);
assert.match(R.validar(dados({opOriginal: null})).erros.join(' '), /OP que será retrabalhada/i);
assert.match(R.validar(dados({destino: {tipo: 'reator', nome: 'R1'}})).erros.join(' '), /onde o retrabalho/i);
assert.match(R.validar(dados({destino: {tipo: 'linha', nome: ''}})).erros.join(' '), /linha, estação ou posto/i);
// Retrabalhar mais do que foi produzido é AVISO, não bloqueio: o lote pode
// ter sido juntado com sobra de outro, e travar empurraria o registro para
// fora do sistema.
const demais = R.validar(dados({qtdPlanejada: 1000}));
assert.equal(demais.ok, true, 'não bloqueia');
assert.match(demais.avisos.join(' '), /maior que a produzida/);
assert.equal(R.validar(dados()).avisos.length, 0);

// ── 7. Reconhecer e rotular ──────────────────────────────────────────
assert.equal(R.ehRetrabalho(op), true);
assert.equal(R.ehRetrabalho(ORIGINAL), false, 'OP comum não é retrabalho');
assert.equal(R.ehRetrabalho(null), false);
assert.equal(R.rotulo(op), 'Retrabalho de 26216/04');
assert.equal(R.rotulo(ORIGINAL), '', 'OP comum não ganha rótulo de retrabalho');

// ── 8. Achar os retrabalhos de um lote e todos eles ──────────────────
const ops = {
  '26216-04': ORIGINAL,
  '26216-04-RT1': Object.assign({}, op, {dataEmissao: '2026-09-22T18:00:00.000Z'}),
  '26216-04-RT2': Object.assign({}, op, {lote: '26216/04-RT2', dataEmissao: '2026-09-23T10:00:00.000Z'}),
  '26100-01-RT1': Object.assign({}, op, {lote: '26100/01-RT1', retrabalhoDe: '26100/01',
    dataEmissao: '2026-09-10T10:00:00.000Z'}),
  '26300-01': {lote: '26300/01', status: 'Em Produção'},
};
assert.deepEqual(R.doLote(ops, '26216/04').map((o) => o.lote), ['26216/04-RT2', '26216/04-RT1'],
  'mais recente primeiro');
assert.equal(R.doLote(ops, '26300/01').length, 0);
assert.deepEqual(R.listar(ops).map((o) => o.lote),
  ['26216/04-RT2', '26216/04-RT1', '26100/01-RT1'], 'só retrabalhos, mais novos primeiro');
assert.equal(R.listar({}).length, 0);
assert.equal(R.listar(null).length, 0);

// ── 9. Texto de cadastro não vaza sem limite ─────────────────────────
const longo = R.montar(dados({motivo: 'x'.repeat(5000), escopo: 'y'.repeat(900)}));
assert.equal(longo.retrabalhoMotivo.length, 1000);
assert.equal(longo.retrabalhoEscopo.length, 200);
assert.equal(R.montar(dados({escopo: ''})).retrabalhoEscopo, 'Lote inteiro', 'escopo tem padrão');

console.log('run_retrabalho_op_test: OK');
