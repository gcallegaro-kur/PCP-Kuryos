/* Histórico: editar, trocar de pedido, criar e excluir um apontamento mantém o
   razão por lote (pedidos/{k}/apontamentosAplicados) junto com o produzido.
   Sem isso a Transferência de OP seguinte movia a quantidade errada
   (decisão do usuário, 15/10/2026: "deveria atualizar"). */
const assert = require('assert');
const fs = require('fs');
const html = fs.readFileSync('public/historico.html', 'utf8');
const ini = html.indexOf('function adjustPedidoProduzido(');
const fim = html.indexOf('// ── Save edit', ini);
assert(ini > 0 && fim > ini, 'função encontrada');
const src = html.slice(ini, fim);

let pedido;
const db = {ref: () => ({transaction: (fn) => {
  const r = fn(JSON.parse(JSON.stringify(pedido)));
  pedido = r;
  return Promise.resolve({committed: true, snapshot: {exists: () => true, val: () => r}});
}})};
const ctx = {db, cleanFutureSlots: () => Promise.resolve(), opsCache: {}, pedidosCache: {'0001__X': {id: '0001'}}, findPedidoKeyPorLote: () => '0001__X'};
const adj = new Function('db', 'cleanFutureSlots', 'opsCache', 'pedidosCache', 'findPedidoKeyPorLote',
  src + '; return adjustPedidoProduzido;')(db, ctx.cleanFutureSlots, ctx.opsCache, ctx.pedidosCache, ctx.findPedidoKeyPorLote);

(async () => {
  pedido = {produzido: 1000, qtdTotal: 5000, apontamentosAplicados: {a: {quantidade: 600, lote: '1/1'}, b: {quantidade: 400, lote: '1/1'}}};
  // editar 600 -> 700
  await adj('0001', 'P', 100, '1/1', {id: 'a', qtdNova: 700, lote: '1/1'});
  assert.strictEqual(pedido.produzido, 1100);
  assert.strictEqual(pedido.apontamentosAplicados.a.quantidade, 700, 'razão acompanha a edição');
  // excluir b
  await adj('0001', 'P', -400, '1/1', {id: 'b', qtdNova: 0});
  assert.strictEqual(pedido.produzido, 700);
  assert.strictEqual(pedido.apontamentosAplicados.b, undefined, 'razão perde a entrada excluída');
  // apontamento anterior ao razão: editar não inventa entrada
  await adj('0001', 'P', 50, '1/1', {id: 'antigo', qtdNova: 50, lote: '1/1'});
  assert.strictEqual(pedido.apontamentosAplicados.antigo, undefined);
  assert.strictEqual(pedido.produzido, 750);
  // registro novo cria a entrada
  await adj('0001', 'P', 300, '1/1', {id: 'novo', qtdNova: 300, lote: '1/1', criar: true});
  assert.strictEqual(pedido.apontamentosAplicados.novo.quantidade, 300);
  // só mudou a data (id novo): diff 0 troca a entrada de id sem mexer no total
  await adj('0001', 'P', 0, '', {id: 'novo', qtdNova: 0});
  await adj('0001', 'P', 0, '1/1', {id: 'novo2', qtdNova: 300, lote: '1/1', criar: true});
  assert.strictEqual(pedido.produzido, 1050);
  assert.ok(pedido.apontamentosAplicados.novo2 && !pedido.apontamentosAplicados.novo);
  // esvaziar o razão remove o nó
  pedido = {produzido: 10, qtdTotal: 50, apontamentosAplicados: {z: {quantidade: 10, lote: 'L'}}};
  await adj('0001', 'P', -10, 'L', {id: 'z', qtdNova: 0});
  assert.strictEqual(pedido.apontamentosAplicados, undefined);

  // Os pontos de chamada passam o razão.
  assert.ok(/adjustPedidoProduzido\(pedId, prod, -_qtyEf, [^;]*\{id: editingKey, qtdNova: 0\}/.test(html), 'exclusão pelo modal');
  assert.ok(/adjustPedidoProduzido\(pedId, prod, -_qtyEf2, [^;]*\{id: key, qtdNova: 0\}/.test(html), 'exclusão pela lista');
  assert.ok(/_refNovo\.key/.test(html) && /isLinhaEnvase\(data\.linha\) \? qtyNew : 0/.test(html), 'criação: razão e gate de envase');
  assert.ok(/_idRegistroFinal/.test(html), 'edição com troca de data troca o id do razão');
  console.log('run_razao_historico_test: OK');
})().catch((e) => { console.error(e); process.exit(1); });
