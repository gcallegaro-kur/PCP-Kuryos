/* Conferência na confirmação da OP pelo PCP (avaliarConfirmacaoOp, utils.js). */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const ctx = { console, Math, String, Number, Object, Array, JSON, Date, RegExp, parseInt, parseFloat, isNaN, document: undefined };
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/shared/utils.js', 'utf8'), ctx);
const av = ctx.avaliarConfirmacaoOp;

// OP certa: total = registros, perto do planejado.
assert.deepStrictEqual(Array.from(av({qtdPlanejada: 3000, produzidoLinha: 2917, produzido: 2917}, 2917)), []);
// Caso real 26237/03: total da OP = 2, registro = 2.917.
const a = av({qtdPlanejada: 3000, produzidoLinha: 2, produzido: 2}, 2917);
assert.ok(a.some((m) => /não bate com a soma dos apontamentos/.test(m)));
assert.ok(a.some((m) => /menos da metade do planejado/.test(m)));
// Acima de 110% do planejado.
assert.ok(av({qtdPlanejada: 1000, produzidoLinha: 1200, produzido: 1200}, 1200).some((m) => /110%/.test(m)));
// 1 un. de diferença de arredondamento não alerta.
assert.deepStrictEqual(Array.from(av({qtdPlanejada: 100, produzidoLinha: 100.4, produzido: 100.4}, 100)), []);
// Sem OP: sem aviso.
assert.deepStrictEqual(Array.from(av(null, 5)), []);
// ops.html chama a conferência antes de gravar Concluído e guarda a divergência.
const ops = fs.readFileSync('public/ops.html', 'utf8');
assert.ok(/avaliarConfirmacaoOp\(op, soma\.linha\)/.test(ops) && /confirmadoComDivergencia/.test(ops) && /confirmadoProduzido/.test(ops));
const ped = fs.readFileSync('public/pedidos.html', 'utf8');
assert.ok(/function seloCoerenciaOps/.test(ped) && /seloCoerenciaOps\(p\)/.test(ped), 'selo de coerência em Pedidos');
assert.ok(/id="fProduzido"[^>]*readonly/.test(ped), 'produzido do pedido é só leitura');
console.log('run_confirmacao_op_test: OK');
