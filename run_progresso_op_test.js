/* Progresso da OP: a barra principal é produto acabado (estoque + expedido);
   as etapas ficam no hover. Pedido do usuário, 2026-09-29. */
const assert = require('assert');
const path = require('path');
const PO = require(path.join(__dirname, 'public', 'shared', 'progresso-op.js'));
const CP = require(path.join(__dirname, 'public', 'shared', 'conciliacao-pedidos.js'));

const bucket = (estoque, expedido) => ({estoque: {total: estoque}, expedido: {total: expedido}});
const etapa = (p, k) => p.etapas.find(e => e.chave === k);

// 1. Rotulagem completa NÃO enche a barra: PA vem só do que a Logística conferiu.
let op = {qtdPlanejada: 1500, produzidoLinha: 1450, produzidoRotulagem: 1500};
let p = PO.calcular(op, null, false);
assert.strictEqual(p.pa, 0);
assert.strictEqual(p.pct, 0);
assert.strictEqual(etapa(p, 'rotulagem').valor, 1500);
assert.strictEqual(etapa(p, 'rotulagem').pct, 100);
assert.strictEqual(etapa(p, 'envase').valor, 1450);
assert.strictEqual(etapa(p, 'envase').pct, 97);

// 2. PA = estoque + expedido; expedido também aparece sozinho.
p = PO.calcular(op, bucket(900, 300), false);
assert.strictEqual(p.pa, 1200);
assert.strictEqual(p.pct, 80);
assert.strictEqual(etapa(p, 'pa').valor, 1200);
assert.strictEqual(etapa(p, 'expedido').valor, 300);

// 3. Conciliação ainda carregando: PA indefinido, nunca um zero falso.
p = PO.calcular(op, null, true);
assert.strictEqual(p.pa, null);
assert.strictEqual(p.pct, null);
assert.ok(!etapa(p, 'pa') && !etapa(p, 'expedido'));
assert.ok(/carregando/.test(PO.tooltip(p)));

// 3b. Campo ausente vira 0, nunca NaN (OP que não passa por rotulagem).
p = PO.calcular({qtdPlanejada: 100, produzidoLinha: 10}, null, false);
assert.strictEqual(etapa(p, 'rotulagem').valor, 0);
assert.strictEqual(etapa(p, 'rotulagem').pct, 0);
assert.ok(!/NaN/.test(PO.tooltip(p)));

// 4. OP antiga (só `produzido`) conta como envase; sem posto não há etapa de posto.
p = PO.calcular({qtdPlanejada: 100, produzido: 40}, null, false);
assert.strictEqual(etapa(p, 'envase').valor, 40);
assert.ok(!etapa(p, 'posto'));
assert.ok(!etapa(p, 'manipulacao'), 'sem fase de manipulação não há etapa de bulk');
p = PO.calcular({qtdPlanejada: 100, produzidoPosto: 10}, null, false);
assert.strictEqual(etapa(p, 'posto').valor, 10);

// 5. Manipulação em kg: fechada mostra o rendimento; aberta, o pesado.
const fase = (extra) => Object.assign({status: 'EM_MANIPULACAO', previstos: {A: {previsto: 300}, B: {previsto: 200}}}, extra);
p = PO.calcular({qtdPlanejada: 1500, manipulacao: fase({manipulacao: {rendimento: 500}})}, null, false);
let m = etapa(p, 'manipulacao');
assert.strictEqual(m.unidade, 'kg');
assert.strictEqual(m.meta, 500);
assert.strictEqual(m.valor, 500);
assert.strictEqual(m.pct, 100);
assert.strictEqual(m.detalhe, null);
p = PO.calcular({qtdPlanejada: 1500, manipulacao: fase({})}, null, false);
m = etapa(p, 'manipulacao');
assert.strictEqual(m.meta, 500);
assert.ok(/pesado/.test(m.detalhe));

// 6. Tooltip legível, uma linha por etapa, na ordem do processo.
p = PO.calcular({qtdPlanejada: 1500, produzidoLinha: 1450, produzidoRotulagem: 1500,
  manipulacao: fase({manipulacao: {rendimento: 500}})}, bucket(1000, 0), false);
const linhas = PO.tooltip(p).split('\n');
assert.ok(/^Manipulação: 500 \/ 500 kg \(100%\)/.test(linhas[0]), linhas[0]);
assert.ok(/^Envase: 1\.450 \/ 1\.500 un \(97%\)/.test(linhas[1]), linhas[1]);
assert.ok(/^Rotulagem: 1\.500 \/ 1\.500 un \(100%\)/.test(linhas[2]), linhas[2]);
assert.ok(/^Produto acabado \(conferido\): 1\.000 \/ 1\.500 un \(67%\)/.test(linhas[3]), linhas[3]);
assert.ok(/^Expedido: 0 \/ 1\.500 un/.test(linhas[4]), linhas[4]);

// 7. Meta zero não divide por zero.
p = PO.calcular({qtdPlanejada: 0, produzidoLinha: 5}, bucket(0, 0), false);
assert.strictEqual(p.pct, 0);
assert.ok(!/NaN|Infinity/.test(PO.tooltip(p)));

// 8. Ligação com a conciliação real: o bucket porOp da OP alimenta a barra.
const base = {
  pedidos: {'0001__SKU': {produzido: 1500}},
  ops: {'26300-01': {lote: '26300/01', skuPedidoKey: '0001__SKU', produzido: 1500}},
  expedicoes_comerciais: {C1: {itens: {i: {qtd: 300, opKey: '26300-01', skuPedidoKey: '0001__SKU'}}}},
  estoque_lotes: {SKU: {p1: {itemTipo: 'produto', saldoLote: 900, opKey: '26300-01', skuPedidoKey: '0001__SKU'}}},
  conferencias_pa: {}, solicitacoes_descarte: {}, devolucoes_cliente: {}
};
const r = CP.calcular(base);
const bk = r.porPedido['0001__SKU'].porOp['26300-01'];
p = PO.calcular({qtdPlanejada: 1500, produzidoLinha: 1500, produzidoRotulagem: 1500}, bk, false);
assert.strictEqual(p.pa, 1200);
assert.strictEqual(p.expedido, 300);
assert.strictEqual(p.pct, 80);

console.log('progresso-op: todos os testes passaram');
