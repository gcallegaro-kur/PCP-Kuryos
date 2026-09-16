const assert = require('assert');
const path = require('path');
const T = require(path.join(__dirname, 'public', 'shared', 'transferencia-op.js'));

const clone = (o) => JSON.parse(JSON.stringify(o));

// Formato real: Néctar 26257/17 apontada no 0014 em 16/09 (3.696 un), OP
// guardando a chave sem zero à esquerda ("14__MRARBS04").
function baseNectar() {
  return {
    ops: {
      '26257-17': {lote: '26257/17', sku: 'MRARBS04', skuPedidoKey: '14__MRARBS04', status: 'Em Produção',
        produzidoLinha: 3696, produzido: 3696, qtdPlanejada: 4320},
      '26257-18': {lote: '26257/18', sku: 'MRARBS04', skuPedidoKey: '14__MRARBS04', status: 'Programado', produzidoLinha: 0},
      '26204-01': {lote: '26204/01', sku: 'MRARBS04', skuPedidoKey: 'PROG__MRARBS04', status: 'Concluído', produzidoLinha: 4000},
      'cancelada': {lote: '1/1', sku: 'MRARBS04', skuPedidoKey: '14__MRARBS04', status: 'Cancelado'}
    },
    pedidos: {
      '0014__MRARBS04': {id: '0014', sku: 'MRARBS04', qtdTotal: 10000, produzido: 3696, status: 'Em Produção', parentPedidoId: '0014',
        apontamentosAplicados: {'-a1': {quantidade: 2000, lote: '26257/17'}, '-a2': {quantidade: 1696, lote: '26257/17'}}},
      '0040__MRARBS04': {id: '0040', sku: 'MRARBS04', qtdTotal: 39158, produzido: 0, status: 'Não Iniciado', parentPedidoId: '0040'},
      '0041__MRARBS01': {id: '0041', sku: 'MRARBS01', qtdTotal: 40000, produzido: 0},
      '0042__MRARBS04': {id: '0042', sku: 'MRARBS04', qtdTotal: 1000, produzido: 0, statusManual: 'encerrado'},
      // Pedido antigo: 9.000 produzidos, só 1.000 com registro por lote.
      'PROG__MRARBS04': {id: 'PROG', sku: 'MRARBS04', qtdTotal: 30000, produzido: 9000, status: 'Produção Parcial',
        apontamentosAplicados: {'-x': {quantidade: 1000, lote: '99999/01'}}}
    },
    estoque_lotes: {
      MRARBS04: {
        pa_26257_17_p1: {itemTipo: 'produto', opKey: '26257-17', saldoLote: 1500, origemTipo: 'conferencia_pa', skuPedidoKey: '14__MRARBS04'},
        pa_26257_17_p2: {itemTipo: 'produto', opKey: '26257-17', saldoLote: 0, origemTipo: 'conferencia_pa', skuPedidoKey: '14__MRARBS04'},
        LEG_1: {itemTipo: 'produto', opKey: '26257-17', saldoLote: 200, origemTipo: 'legado_planilha', legado: true, skuPedidoKeyOrigem: '14__MRARBS04'},
        outro: {itemTipo: 'produto', opKey: '26257-18', saldoLote: 999}
      }
    }
  };
}

// 1. Candidatos: mesmo SKU, abertos, sem a própria origem (com/sem zero).
{
  const b = baseNectar();
  assert.deepStrictEqual(T.candidatosDestino(b, '26257-17'), ['0040__MRARBS04', 'PROG__MRARBS04']);
}

// 2. Validações.
{
  const b = baseNectar();
  assert.ok(T.planejar(b, 'nao-existe', '0040__MRARBS04').erros.length);
  assert.ok(T.planejar(b, 'cancelada', '0040__MRARBS04').erros.some((e) => /cancelada/.test(e)));
  assert.ok(T.planejar(b, '26257-17', '0014__MRARBS04').erros.some((e) => /já está/.test(e)), 'mesma chave com zero à esquerda');
  assert.ok(T.planejar(b, '26257-17', '0041__MRARBS01').erros.some((e) => /outro produto/.test(e)));
  assert.ok(T.planejar(b, '26257-17', '0042__MRARBS04').erros.some((e) => /encerrado/.test(e)));
  assert.ok(T.planejar(b, '26257-17', '').erros.length);
}

// 3. Plano do caso real: 3.696 registradas, nada sem registro, paletes.
const b = baseNectar();
const plano = T.planejar(b, '26257-17', '0040__MRARBS04');
assert.deepStrictEqual(plano.erros, []);
assert.strictEqual(plano.origemKey, '0014__MRARBS04');
assert.strictEqual(plano.destinoKey, '0040__MRARBS04');
assert.strictEqual(plano.parentDestino, '0040');
assert.strictEqual(plano.qtdRegistrada, 3696);
assert.strictEqual(plano.qtdSemRegistro, 0);
assert.strictEqual(plano.qtd, 3696);
assert.strictEqual(plano.paletes.length, 2, 'só paletes com saldo');
assert.strictEqual(plano.saldoPaletes, 1700);
assert.strictEqual(plano.paletesExpedidos, 1);
assert.ok(plano.avisos.some((a) => /já saíram/.test(a)));

// 4. Transactions: saída e entrada movem exatamente o mesmo, e repetir não duplica.
const ctx = {id: 'T1', lote: plano.lote, qtdSemRegistro: plano.qtdSemRegistro, origemKey: plano.origemKey, destinoKey: plano.destinoKey, em: '2026-09-16T21:00:00Z', por: 'teste'};
const origem = T.aplicarSaida(clone(b.pedidos['0014__MRARBS04']), ctx);
assert.strictEqual(origem.produzido, 0);
assert.deepStrictEqual(origem.apontamentosAplicados, {});
assert.strictEqual(ctx.movido.qtd, 3696);
assert.strictEqual(origem.transferenciasOP.T1.tipo, 'SAIDA');
const destino = T.aplicarEntrada(clone(b.pedidos['0040__MRARBS04']), ctx);
assert.strictEqual(destino.produzido, 3696);
assert.strictEqual(destino.status, 'Produção Parcial');
assert.deepStrictEqual(Object.keys(destino.apontamentosAplicados).sort(), ['-a1', '-a2'], 'dedupe do apontamento segue no destino');

// Retry (transaction reexecutada / retomada): nada muda.
const ctx2 = Object.assign({}, ctx, {movido: null});
const origem2 = T.aplicarSaida(clone(origem), ctx2);
assert.deepStrictEqual(origem2, origem);
assert.strictEqual(ctx2.movido.qtd, 3696, 'retomada recupera o que saiu');
assert.deepStrictEqual(T.aplicarEntrada(clone(destino), ctx2), destino);

// Apontamento retentado depois da transferência já estava no destino: não soma de novo.
{
  const d = clone(b.pedidos['0040__MRARBS04']);
  d.apontamentosAplicados = {'-a1': {quantidade: 2000, lote: '26257/17'}};
  d.produzido = 2000;
  const r = T.aplicarEntrada(d, Object.assign({}, ctx, {id: 'T9'}));
  assert.strictEqual(r.produzido, 3696, 'só os 1.696 que faltavam');
}

// 5. OP antiga sem registro por lote: vale o envase, limitado ao que não tem rastro.
{
  const bb = baseNectar();
  const p = T.planejar(bb, '26204-01', '0040__MRARBS04');
  assert.strictEqual(p.qtdRegistrada, 0);
  assert.strictEqual(p.qtdSemRegistro, 4000);
  assert.ok(p.avisos.some((a) => /anteriores ao registro/.test(a)));
  const c = {id: 'T2', lote: p.lote, qtdSemRegistro: p.qtdSemRegistro, origemKey: p.origemKey, destinoKey: p.destinoKey};
  const o = T.aplicarSaida(clone(bb.pedidos.PROG__MRARBS04), c);
  assert.strictEqual(o.produzido, 5000);
  assert.strictEqual(o.apontamentosAplicados['-x'].quantidade, 1000, 'registro de outro lote fica');
  // Limite: pedido com pouco produzido sem rastro não fica negativo nem cede o que é de outro lote.
  const pouco = clone(bb.pedidos.PROG__MRARBS04);
  pouco.produzido = 1500;
  const c3 = Object.assign({}, c, {id: 'T3'});
  const o3 = T.aplicarSaida(pouco, c3);
  assert.strictEqual(c3.movido.qtd, 500);
  assert.strictEqual(o3.produzido, 1000);
}

// 6. Concluído que perde produção reabre; destino que completa conclui.
{
  const o = T.aplicarSaida({qtdTotal: 3000, produzido: 3696, status: 'Concluído', apontamentosAplicados: {'-a': {quantidade: 3696, lote: 'L'}}}, {id: 'T4', lote: 'L'});
  assert.strictEqual(o.status, 'Não Iniciado');
  const d = T.aplicarEntrada({qtdTotal: 3000, produzido: 0, status: 'Não Iniciado'}, {id: 'T4', lote: 'L', movido: {aplicacoes: {}, qtd: 3696}});
  assert.strictEqual(d.status, 'Concluído');
  assert.ok(T.planejar(baseNectar(), '26257-17', '0040__MRARBS04').avisos.every((a) => !/passa a ter mais/.test(a)));
}

// 7. Transaction com valor ainda não carregado (null) não escreve nada.
assert.strictEqual(T.aplicarSaida(null, {id: 'T5'}), null);
assert.strictEqual(T.aplicarEntrada(null, {id: 'T5'}), null);

// 8. Paletes: legado também troca skuPedidoKeyOrigem (senão a Expedição bloqueia).
{
  const u = T.atualizacoesPaletes(Object.assign({}, plano, {em: 'agora'}));
  assert.strictEqual(u['estoque_lotes/MRARBS04/pa_26257_17_p1/skuPedidoKey'], '0040__MRARBS04');
  assert.strictEqual(u['estoque_lotes/MRARBS04/LEG_1/skuPedidoKeyOrigem'], '0040__MRARBS04');
  assert.strictEqual(u['estoque_lotes/MRARBS04/pa_26257_17_p1/skuPedidoKeyOrigem'], undefined);
  assert.ok(!Object.keys(u).some((k) => /p2|outro/.test(k)), 'expedido e palete de outra OP ficam');
}

// 9. Programação: só slots deste lote, de agora em diante, do pedido de origem.
{
  const prog = {
    '2026-09-15': {'10_00': {env1: {pedidoKey: '14__MRARBS04', lote: '26257/17'}}},
    '2026-09-16': {
      '07_00': {env1: {pedidoKey: '14__MRARBS04', lote: '26257/17'}},
      '18_00': {env1: {pedidoKey: '0014__MRARBS04', lote: '26257/17'}, env2: {pedidoKey: '14__MRARBS04', lote: '26257/18'}, obs: 'x'}
    },
    '2026-09-17': {'08_00': {env1: {pedidoKey: '14__MRARBS04', lote: '26257/17'}, env3: {pedidoKey: 'OUTRO__MRARBS04', lote: '26257/17'}}}
  };
  const u = T.atualizacoesProgramacao(prog, plano, '2026-09-16', 17);
  assert.deepStrictEqual(Object.keys(u).sort(), ['programacao/2026-09-16/18_00/env1/pedidoKey', 'programacao/2026-09-17/08_00/env1/pedidoKey']);
}

// 10. Alocações: devolve só a parte desta OP.
{
  const aloc = {a1: {qtdConsumida: 8000, status: 'vinculado', opsVinculadas: {'26257-17': {qtd: 4320}, '26257-18': {qtd: 3680}}}, a2: {qtdConsumida: 10}};
  const u = T.atualizacoesAlocacoes(aloc, '26257/17', (s) => s.replace(/\//g, '-'));
  assert.deepStrictEqual(u, {
    'alocacoes_planejamento/a1/opsVinculadas/26257-17': null,
    'alocacoes_planejamento/a1/qtdConsumida': 3680,
    'alocacoes_planejamento/a1/status': 'congelado'
  });
}

// 11. Retomada usa os pedidos gravados, mesmo com a OP já apontando para o destino.
{
  const bb = baseNectar();
  bb.ops['26257-17'].skuPedidoKey = '0040__MRARBS04';
  bb.ops['26257-17'].transferenciasPedido = {T1: {status: 'EM_ANDAMENTO', origem: '0014__MRARBS04', destino: '0040__MRARBS04'}};
  const pend = T.transferenciaPendente(bb.ops['26257-17']);
  assert.strictEqual(pend.id, 'T1');
  const p = T.planejar(bb, '26257-17', null, pend);
  assert.deepStrictEqual(p.erros, []);
  assert.strictEqual(p.origemKey, '0014__MRARBS04');
  assert.strictEqual(p.qtd, 3696);
}

console.log('run_transferencia_op_test.js: OK');
