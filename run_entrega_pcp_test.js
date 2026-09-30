/* Data de entrega do PCP: por item, pedido inteiro = maior data, prazo de 30 dias. */
const assert = require('assert');
const E = require('./public/shared/entrega-pcp.js');

// Validação: vazio limpa, formato ISO obrigatório, data impossível recusada.
assert.deepStrictEqual(E.validar(''), {ok: true, data: null});
assert.deepStrictEqual(E.validar('  '), {ok: true, data: null});
assert.strictEqual(E.validar('2026-11-06').data, '2026-11-06');
assert.strictEqual(E.validar('06/11/2026').ok, false);
assert.strictEqual(E.validar('2026-13-40').ok, false);

// 30 dias corridos (padrão) e úteis (opção).
assert.strictEqual(E.PRAZO_DIAS, 30);
assert.strictEqual(E.sugerirEntrega('2026-10-01'), '2026-10-31');
assert.strictEqual(E.sugerirEntrega('2026-10-01', {dias: 30, uteis: false}), '2026-10-31');
assert.strictEqual(E.somarDias('2026-10-02', 1, true), '2026-10-05', 'sexta + 1 útil = segunda');
assert.strictEqual(E.somarDias('2026-10-01', 30, true), '2026-11-12', '30 úteis a partir de qui 01/10');
assert.strictEqual(E.somarDias('2026-12-20', 30), '2027-01-19', 'vira o ano');
// Sem data do insumo, sem sugestão: nunca inventa.
assert.strictEqual(E.sugerirEntrega(null), null);
assert.strictEqual(E.sugerirEntrega('amanhã'), null);

// Pedido inteiro = a maior data dos itens; itens sem data ficam contados.
let p = E.doPedido(['2026-10-20', '2026-11-05', null]);
assert.deepStrictEqual(p, {data: '2026-11-05', itens: 3, comData: 2, semData: 1});
assert.deepStrictEqual(E.doPedido([]), {data: null, itens: 0, comData: 0, semData: 0});
assert.strictEqual(E.doPedido([undefined, '']).data, null);

// Prazo: atrasado, hoje, próximo (≤7 dias), no prazo, sem data, encerrado não cobra.
assert.deepStrictEqual(E.estadoPrazo('2026-09-28', '2026-09-30', false), {estado: 'ATRASADO', dias: 2});
assert.deepStrictEqual(E.estadoPrazo('2026-09-30', '2026-09-30', false), {estado: 'HOJE', dias: 0});
assert.deepStrictEqual(E.estadoPrazo('2026-10-05', '2026-09-30', false), {estado: 'PROXIMO', dias: 5});
assert.deepStrictEqual(E.estadoPrazo('2026-11-01', '2026-09-30', false), {estado: 'NO_PRAZO', dias: 32});
assert.deepStrictEqual(E.estadoPrazo(null, '2026-09-30', false), {estado: 'SEM_DATA', dias: null});
assert.strictEqual(E.estadoPrazo('2026-09-01', '2026-09-30', true).estado, 'ENCERRADO');
console.log('entrega-pcp: todos os testes passaram');
