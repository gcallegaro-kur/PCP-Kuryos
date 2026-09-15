/* Conciliação de pedidos: Produzido = Expedido + Em estoque.
   Cada bloco trava uma regra decidida pelo usuário em 2026-09-14. */
const assert = require('assert');
const path = require('path');
const CP = require(path.join(__dirname, 'public', 'shared', 'conciliacao-pedidos.js'));

function base(extra) {
  return Object.assign({
    pedidos: {
      '0017__PRF-AFEE-0014': {produzido: 2916},
      '26__BSP-SEUN-0001': {produzido: 24},
      '0019__GLMKAM04': {produzido: 1000},
      '0020__NADA': {produzido: 500},
      '0021__ZERO': {produzido: 0}
    },
    ops: {
      '26251-15': {skuPedidoKey: '17__PRF-AFEE-0014'},
      '26244-16': {skuPedidoKey: '19__GLMKAM04'},
      'OP-SEUN': {skuPedidoKey: '0026__BSP-SEUN-0001'}
    },
    expedicoes_comerciais: {}, estoque_lotes: {}, conferencias_pa: {}, solicitacoes_descarte: {}
  }, extra || {});
}
const carga = (itens, extra) => Object.assign({itens}, extra || {});
const r = (b, k) => CP.calcular(b).porPedido[k];

// ── 1. Só dois destinos; expedido tem motivo (de fato, furto, descarte) ──
let b = base({
  expedicoes_comerciais: {
    L1: carga({a: {qtd: 600, pedidoKey: '0019__GLMKAM04'}}, {legado: true, tipoLegado: 'EXPEDIDO'}),
    L2: carga({a: {qtd: 50, skuPedidoKey: '19__GLMKAM04'}}, {legado: true, tipoLegado: 'FURTO'}),
    V2: carga({a: {qtd: 100, skuPedidoKey: '0019__GLMKAM04'}}, {versao: 2})
  },
  estoque_lotes: {
    GLMKAM04: {
      p1: {itemTipo: 'produto', saldoLote: 200, opKey: '26244-16'},
      p2: {itemTipo: 'produto', saldoLote: 0, opKey: '26244-16', status: 'DESCARTADO'},
      m1: {itemTipo: 'material', saldoLote: 999, opKey: '26244-16'}
    }
  },
  solicitacoes_descarte: {
    s1: {status: 'CONCLUIDO', quantidadeDestinada: 50, itemKey: 'GLMKAM04', loteKey: 'p2', itemTipo: 'produto'},
    s2: {status: 'SOLICITADO', quantidadeDestinada: 999, itemKey: 'GLMKAM04', loteKey: 'p2', itemTipo: 'produto'}
  }
});
let x = r(b, '0019__GLMKAM04');
assert.deepEqual(x.expedido.motivos, {EXPEDIDO: 700, FURTO: 50, DESCARTE: 50}, 'furto e descarte contam como expedido');
assert.equal(x.estoque.total, 200, 'material não é produto acabado; lote com saldo 0 não é estoque');
assert.equal(x.contabilizado, 1000);
assert.equal(x.situacao, 'OK');

// ── 2. Retrabalho e devolução voltam ao estoque ─────────────────────────
b = base({expedicoes_comerciais: {
  R: carga({a: {qtd: 10, pedidoKey: '26__BSP-SEUN-0001'}}, {legado: true, tipoLegado: 'RETRABALHO'}),
  D: carga({a: {qtd: 14, opKey: 'OP-SEUN'}}, {legado: true, tipoLegado: 'DEVOLUCAO'})
}});
x = r(b, '26__BSP-SEUN-0001');
assert.equal(x.expedido.total, 0, 'retrabalho/devolução não são saída');
assert.deepEqual(x.estoque.origens, {RETRABALHO: 10, DEVOLUCAO: 14});
assert.equal(x.situacao, 'OK', 'chave com zero na OP resolve para o pedido sem zero');

// ── 3. Só exato é OK; qualquer unidade de diferença é divergência ────────
b = base({expedicoes_comerciais: {E: carga({a: {qtd: 999, pedidoKey: '0019__GLMKAM04'}}, {legado: true, tipoLegado: 'EXPEDIDO'})}});
x = r(b, '0019__GLMKAM04');
assert.equal(x.situacao, 'DIVERGENTE');
assert.equal(x.diferenca, -1);
assert.ok(CP.descrever(x).rotulo === 'Diferença -1');
assert.ok(CP.descrever(x).detalhe.includes('Faltam 1 un. sem destino registrado'));

// ── 4. Divergência apontada pela Logística entra na conta ────────────────
const conf = {'26251-15': {finalizadoEm: '2026-09-15T01:20:02Z', opLote: '26251/15', rncNumero: 'RNC-PA-26251-15',
  conciliacao: {diferenca: -1, motivo: 'PERDA_OU_AVARIA', observacao: 'Sem explicação racional'}}};
b = base({conferencias_pa: JSON.parse(JSON.stringify(conf)), estoque_lotes: {'PRF-AFEE-0014': {pa: {itemTipo: 'produto', saldoLote: 1895, opKey: '26251-15', skuPedidoKey: '17__PRF-AFEE-0014'}}},
  expedicoes_comerciais: {E: carga({a: {qtd: 1020, pedidoKey: '0017__PRF-AFEE-0014'}}, {legado: true, tipoLegado: 'EXPEDIDO'})}});
x = r(b, '0017__PRF-AFEE-0014');
assert.equal(x.esperado, 2915);
assert.equal(x.contabilizado, 2915);
assert.equal(x.situacao, 'OK_APONTADA', 'fecha com a divergência que a Logística apontou');
assert.ok(CP.descrever(x).detalhe.includes('Apontado na Conferência (OP 26251/15): -1 · PERDA_OU_AVARIA · RNC-PA-26251-15'));
// conferência NÃO finalizada não conta como apontada
b.conferencias_pa['26251-15'] = Object.assign({}, conf['26251-15'], {finalizadoEm: null});
assert.equal(r(b, '0017__PRF-AFEE-0014').situacao, 'DIVERGENTE');

// ── 5. O caso real: planilha diz expedido E o palete está no galpão ──────
b = base({conferencias_pa: JSON.parse(JSON.stringify(conf)), estoque_lotes: {'PRF-AFEE-0014': {pa: {itemTipo: 'produto', saldoLote: 1895, opKey: '26251-15'}}},
  expedicoes_comerciais: {E: carga({a: {qtd: 2934, pedidoKey: '0017__PRF-AFEE-0014'}}, {legado: true, tipoLegado: 'EXPEDIDO'})}});
x = r(b, '0017__PRF-AFEE-0014');
assert.equal(x.situacao, 'DIVERGENTE');
assert.equal(x.diferenca, 1914);
assert.ok(CP.descrever(x).detalhe.includes('passam do produzido em 1.914'));

// ── 6. Sem registro fica neutro; sem produção e sem nada não aparece ──────
assert.equal(r(base(), '0020__NADA').situacao, 'SEM_REGISTRO');
assert.equal(r(base(), '0021__ZERO').situacao, 'SEM_PRODUCAO');
// produzido zero mas com saída registrada é divergência, não "sem produção"
b = base({expedicoes_comerciais: {E: carga({a: {qtd: 5, pedidoKey: '0021__ZERO'}}, {legado: true, tipoLegado: 'EXPEDIDO'})}});
assert.equal(r(b, '0021__ZERO').situacao, 'DIVERGENTE');

// ── 7. Carga cancelada do fluxo novo e status legado não classificável ────
b = base({expedicoes_comerciais: {
  C: carga({a: {qtd: 1000, pedidoKey: '0019__GLMKAM04'}}, {versao: 2, status: 'Cancelada'}),
  S: carga({a: {qtd: 7, pedidoKey: '0019__GLMKAM04'}}, {legado: true, tipoLegado: 'SEM_STATUS'})
}});
const res = CP.calcular(b);
assert.equal(res.porPedido['0019__GLMKAM04'].contabilizado, 0);
assert.equal(res.semVinculo.naoClassificado, 7, 'fora da conta, mas contabilizado à parte');

// ── 8. Sem vínculo não some: vai para o balde próprio ───────────────────
b = base({expedicoes_comerciais: {E: carga({a: {qtd: 30, pedidoKey: '0099__NAO-EXISTE'}}, {legado: true, tipoLegado: 'EXPEDIDO'})},
  estoque_lotes: {X: {p: {itemTipo: 'produto', saldoLote: 12, opKey: 'OP-INEXISTENTE'}}}});
assert.deepEqual(CP.calcular(b).semVinculo, {expedido: 30, estoque: 12, naoClassificado: 0});

// ── 9. Agregado do pedido comercial: situação é a PIOR dos itens ──────────
const ok = CP.fechar(Object.assign(r(base(), '0021__ZERO'), {}));
const mais = CP.fechar({produzido: 10, expedido: {total: 15, motivos: {EXPEDIDO: 15}}, estoque: {total: 0, origens: {}}, divergenciaApontada: {total: 0, ocorrencias: []}});
const menos = CP.fechar({produzido: 10, expedido: {total: 5, motivos: {EXPEDIDO: 5}}, estoque: {total: 0, origens: {}}, divergenciaApontada: {total: 0, ocorrencias: []}});
const ag = CP.agregar([mais, menos, ok]);
assert.equal(ag.diferenca, 0, '+5 e -5 se anulam na soma...');
assert.equal(ag.situacao, 'DIVERGENTE', '...mas a situação não pode esconder isso');
assert.deepEqual(ag.expedido.motivos, {EXPEDIDO: 20});
const soOk = CP.agregar([CP.fechar({produzido: 3, expedido: {total: 3, motivos: {EXPEDIDO: 3}}, estoque: {total: 0, origens: {}}, divergenciaApontada: {total: 0, ocorrencias: []}})]);
assert.equal(soOk.situacao, 'OK');
assert.equal(CP.agregar([]).situacao, 'SEM_PRODUCAO');

// ── 10. Texto nunca vaza sentinela ──────────────────────────────────────
Object.values(CP.calcular(base({conferencias_pa: {'26251-15': {finalizadoEm: 'x', conciliacao: {diferenca: -2}}}})).porPedido).forEach(function (p) {
  const d = CP.descrever(p);
  assert.ok(!/undefined|NaN|null/.test(d.rotulo + d.detalhe), d.detalhe);
});

console.log('run_conciliacao_pedidos_test: OK');
