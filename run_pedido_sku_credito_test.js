'use strict';
/* A produção tem que cair no SKU certo do pedido comercial.
 *
 * Por que existe: em 08/10/2026 a tela de Pedidos mostrou
 * "HIDRATANTE CÉU INFINITO 200g — 20.079 / 10.000 (201%)" enquanto as OPs
 * daquele produto somavam 7.588 un. As 12.491 un. de diferença eram de
 * HIDRATANTE FLOR D'AURA, outro SKU do MESMO pedido comercial 0023.
 *
 * O mecanismo: um pedido comercial vira vários registros em `pedidos/`, um
 * por SKU, TODOS com o mesmo `id`. O `findPedidoKey` tentava casar id +
 * nome do produto e, quando o nome não batia, caía num "casa só pelo id" que
 * devolvia o PRIMEIRO SKU daquele pedido. E o nome não batia porque ops/ e
 * pedidos/ nascem de geradores diferentes: a OP dizia
 * "HIDRATANTE FLOR DAURA 200 ML", o pedido dizia "... 200g".
 *
 * Ao todo: 30.929 un. em 18 apontamentos, espalhadas por 4 pedidos.
 *
 * O que trava aqui:
 *   1. id ambíguo (vários SKUs) NUNCA é desempatado no escuro;
 *   2. o lote (== OP) resolve o SKU certo mesmo com o nome divergente;
 *   3. o número do pedido digitado à mão continua mandando quando aponta
 *      pra OUTRO pedido comercial;
 *   4. os pontos de crédito do form.html passam pelo lote, não pelo par
 *      id+produto;
 *   5. historico.html ajusta o produzido pelo mesmo caminho.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

let n = 0;
const eq = (a, b, m) => { n++; assert.equal(a, b, m); };
const ok = (c, m) => { n++; assert.ok(c, m); };

// ── Carrega as funções reais de shared/utils.js ────────────────────────────
const utilsSrc = fs.readFileSync('public/shared/utils.js', 'utf8');
const ctx = { console, Math, String, Number, Object, Array, JSON, Date, RegExp,
  parseInt, parseFloat, isNaN, document: undefined };
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(utilsSrc, ctx);

ok(typeof ctx.findPedidoKeyPorLote === 'function',
  'shared/utils.js tem que exportar findPedidoKeyPorLote — é ele que desempata pelo SKU da OP');

// ── A base que produziu o defeito, reduzida ao essencial ───────────────────
// Sete SKUs, um pedido comercial, o mesmo id em todos.
const PEDIDOS = {
  '0023__HDR-MISS-0001': { id: '0023', sku: 'HDR-MISS-0001', produto: 'HIDRATANTE CEU INFINITO 200g', qtdTotal: 10000 },
  '0023__HDR-MISS-0004': { id: '0023', sku: 'HDR-MISS-0004', produto: 'HIDRATANTE DESPERTAR DAS FLORES 200g', qtdTotal: 10000 },
  '0023__HDR-MISS-0007': { id: '0023', sku: 'HDR-MISS-0007', produto: 'HIDRATANTE FLOR DAURA 200g', qtdTotal: 15000 },
  '0030__MRARBS12':      { id: '0030', sku: 'MRARBS12', produto: 'BODY SPLASH FLOR D AURA 200ML', qtdTotal: 8000 }
};
const OPS = {
  // nome do produto DIVERGE do pedido ("200 ML" x "200g") -- o caso real
  '26278-01': { produto: 'HIDRATANTE FLOR DAURA 200 ML', sku: 'HDR-MISS-0007', skuPedidoKey: '0023__HDR-MISS-0007' },
  '26280-08': { produto: 'HIDRATANTE FLOR DAURA 200 ML', sku: 'HDR-MISS-0007', skuPedidoKey: '0023__HDR-MISS-0007' },
  // nome bate
  '26246-03': { produto: 'HIDRATANTE CEU INFINITO 200g', sku: 'HDR-MISS-0001', skuPedidoKey: '23__HDR-MISS-0001' },
  // OP antiga, sem vínculo nenhum
  '26100-01': { produto: 'HIDRATANTE CEU INFINITO 200g' }
};

// ── 1. findPedidoKey: id ambíguo não escolhe sozinho ───────────────────────
{
  const k = ctx.findPedidoKey('0023', 'HIDRATANTE FLOR DAURA 200 ML', PEDIDOS);
  eq(k, null,
    'id 0023 tem 3 SKUs e o nome não bate em nenhum: devolver "o primeiro" foi o bug de 08/10 — tem que ser null');

  eq(ctx.findPedidoKey('0023', 'HIDRATANTE CEU INFINITO 200g', PEDIDOS), '0023__HDR-MISS-0001',
    'com o nome batendo, o passo 1 resolve normalmente');
  eq(ctx.findPedidoKey('0030', 'nome que nao existe', PEDIDOS), '0030__MRARBS12',
    'id com UM SKU só continua resolvendo pelo id — não há o que confundir');
  eq(ctx.findPedidoKey('9999', 'qualquer', PEDIDOS), null, 'id inexistente continua null');
  eq(ctx.findPedidoKey('', 'qualquer', PEDIDOS), null, 'sem id, null');
}

// ── 2. o lote resolve o SKU certo apesar do nome divergente ────────────────
{
  const k = ctx.findPedidoKeyPorLote('26278/01', '0023', 'HIDRATANTE FLOR DAURA 200 ML', OPS, PEDIDOS);
  eq(k, '0023__HDR-MISS-0007',
    'o lote 26278/01 aponta pro SKU HDR-MISS-0007 — é ESTE o pedido que a produção credita');

  eq(ctx.findPedidoKeyPorLote('26280/08', '0023', 'HIDRATANTE FLOR DAURA 200 ML', OPS, PEDIDOS),
    '0023__HDR-MISS-0007', 'mesmo vínculo pelo lote de outro dia');

  // O caso que FUNCIONAVA e não pode quebrar
  eq(ctx.findPedidoKeyPorLote('26246/03', '0023', 'HIDRATANTE CEU INFINITO 200g', OPS, PEDIDOS),
    '0023__HDR-MISS-0001', 'Céu Infinito continua caindo no Céu Infinito');

  // "23__" x "0023__": o zero à esquerda não pode atrapalhar (já era tratado)
  ok(ctx.findPedidoKeyPorLote('26246/03', '23', 'HIDRATANTE CEU INFINITO 200g', OPS, PEDIDOS) === '0023__HDR-MISS-0001',
    'id com e sem zero à esquerda é o mesmo pedido');

  // Lote cuja OP não tem vínculo: cai no par id+produto, e o id ambíguo barra
  eq(ctx.findPedidoKeyPorLote('26100-01', '0023', 'HIDRATANTE FLOR DAURA 200 ML', OPS, PEDIDOS), null,
    'OP sem vínculo + nome que não bate + id ambíguo = não credita ninguém (melhor que creditar errado)');
  eq(ctx.findPedidoKeyPorLote('26100-01', '0023', 'HIDRATANTE CEU INFINITO 200g', OPS, PEDIDOS),
    '0023__HDR-MISS-0001', 'OP sem vínculo mas com nome batendo continua resolvendo');
  eq(ctx.findPedidoKeyPorLote('', '0030', 'qualquer', OPS, PEDIDOS), '0030__MRARBS12',
    'sem lote nenhum, o comportamento antigo continua valendo');
}

// ── 3. o pedido digitado à mão manda quando é OUTRO pedido comercial ───────
{
  // A OP 26278/01 é do pedido 0023, mas alguém informou o 0030 no campo
  // "Número do Pedido" -- corrigir o vínculo na mão é pra isso que ele serve.
  const k = ctx.findPedidoKeyPorLote('26278/01', '0030', 'BODY SPLASH FLOR D AURA 200ML', OPS, PEDIDOS);
  eq(k, '0030__MRARBS12',
    'informar OUTRO pedido comercial tem que prevalecer sobre o vínculo da OP');
}

// ── 4. form.html credita pelo lote, não pelo par id+produto ────────────────
{
  const form = fs.readFileSync('public/form.html', 'utf8');

  const creditos = (form.match(/var pedKey = pedKeyDoItem\(item\);/g) || []).length;
  eq(creditos, 3,
    'os 3 pontos que somam em pedidos/{key}.produzido dentro de syncNextItem passam por pedKeyDoItem');
  eq((form.match(/findPedidoKey\(item\.pedidoId, item\.produto, pedidosCache\)/g) || []).length, 0,
    'nenhum crédito pode mais resolver o pedido pelo par id+produto — era por ali que entrava o SKU errado');

  ok(/function pedKeyDoItem\(item\)/.test(form), 'pedKeyDoItem existe');
  ok(/if \(item\.pedKey && pedidosCache\[item\.pedKey\]\) return item\.pedKey;/.test(form),
    'item da fila carimbado com o SKU resolvido no envio é usado direto');
  ok(/findPedidoKeyPorLote\(lote, item\.pedidoId, item\.produto, opsCache, pedidosCache\)/.test(form),
    'item antigo (sem pedKey) ainda resolve, pelo lote');

  // Todo item enfileirado que credita pedido tem que carregar o SKU resolvido
  eq((form.match(/pedKey: /g) || []).length, 5,
    'os 5 pontos que enfileiram apontamento carimbam o SKU resolvido (pedKey)');

  ok(/function resolvePedKeyParaSubmit\(prefix, produto, matchedOpForSave, lote\)/.test(form),
    'resolvePedKeyParaSubmit recebe o lote — sem ele não há como desempatar SKU');
  ok(/findPedidoKeyPorLote\(lote, id, produto, opsCache, pedidosCache\)/.test(form),
    'e usa o lote ao honrar o campo "Número do Pedido"');
  ok(/findPedidoKeyPorLote\(lote, pedidoId, produto, opsCache, pedidosCache\)/.test(form),
    'o fechamento de OP também resolve pelo lote do formulário');
}

// ── 5. historico.html ajusta o produzido pelo mesmo caminho ────────────────
{
  const hist = fs.readFileSync('public/historico.html', 'utf8');
  ok(/function adjustPedidoProduzido\(pedidoId, produto, qtyDiff, lote\)/.test(hist),
    'adjustPedidoProduzido recebe o lote');
  ok(/var pedKey = findPedidoKeyPorLote\(lote, pedidoId, produto, opsCache, pedidosCache\);/.test(hist),
    'e resolve por ele — editar/excluir apontamento não pode devolver quantidade pro SKU vizinho');
  eq((hist.match(/adjustPedidoProduzido\([^)]*\)/g) || [])
      .filter((c) => c.split(',').length < 4).length, 0,
    'nenhuma chamada de adjustPedidoProduzido ficou sem o lote');
}

// ── 6. a tela de Pedidos detalha pelo lote creditado ───────────────────────
{
  const ped = fs.readFileSync('public/pedidos.html', 'utf8');
  ok(/var lotesCreditados = \{\};/.test(ped),
    'o tooltip de Produzido monta a lista de lotes que o pedido creditou');
  ok(/if \(!produtoMatch && !loteCreditado\) return;/.test(ped),
    'e um lote creditado entra no detalhamento mesmo com o nome do produto divergindo — era o que escondia a OP da conta');
}

console.log('OK credito por SKU: ' + n + ' verificacoes — id ambiguo nao desempata sozinho, o lote resolve o SKU ' +
  'certo apesar do nome divergente, e os tres pontos de credito do apontamento passam por ele.');
