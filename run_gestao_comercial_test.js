const assert = require('assert');
const path = require('path');
const G = require(path.join(__dirname, 'public', 'shared', 'gestao-comercial.js'));

const HOJE = '2026-09-16';

function base() {
  return {
    clientes: {
      MISS: {nome: 'MISS RÔSE', codigo: 'MISS', condicaoPagamento: '30/45/60'},
      ISA: {nome: 'ISA BEAUTY MAKEUP', codigo: 'ISA'},
      GLOW: {nome: 'GLOW MAKE UP', codigo: 'GLOW'}
    },
    produtos: {
      MRARBS04: {sku: 'MRARBS04', descricao: 'NÉCTAR', cliente: 'MISS RÔSE', clienteKey: 'MISS'},
      MRARBS03: {sku: 'MRARBS03', descricao: 'ECLIPSE', cliente: 'MISS RÔSE', clienteKey: 'MISS'},
      ISA01: {sku: 'ISA01', descricao: 'ISA PRODUTO', cliente: 'ISA BEAUTY'},
      GLOW01: {sku: 'GLOW01', descricao: 'GLOW', cliente: 'GLOW MAKE UP', ativo: 'Inativo'}
    },
    precos_venda: {
      MRARBS04: {vigencias: {a: {preco: 3, inicio: '2026-01-01'}, b: {preco: 3.3, inicio: '2026-09-01'}, c: {preco: 3.6, inicio: '2026-12-01'}}},
      MRARBS03: {vigencias: {a: {preco: 2.5, inicio: '2026-01-01'}}}
    },
    pedidos_comerciais: {
      // Novo, com preço negociado abaixo da tabela e previsão vencida.
      'PED-0002': {cliente: 'MISS ROSE', clienteKey: 'MISS', dataPedido: '2026-08-20', previsaoComercialEntrega: '2026-09-10',
        numeroPedidoCliente: '28', prazoPagamento: '30/45', status: 'LIBERADO_PCP',
        itens: [{sku: 'MRARBS04', qtd: 10000, valorUnitario: 3.0, desconto: 100}, {sku: 'MRARBS03', qtd: 2000}]},
      // Antigo, atendido por duas cargas.
      '0010': {cliente: 'MISS RÔSE', dataPedido: '2026-03-01', itens: [{sku: 'MRARBS04', qtd: 1000}]},
      // Produzido, antigo e sem saída: a conferir (fora da carteira).
      '0011': {cliente: 'MISS RÔSE', dataPedido: '2026-04-01', itens: [{sku: 'MRARBS03', qtd: 500}]},
      // Encerrado.
      '0012': {cliente: 'MISS RÔSE', dataPedido: '2026-05-01', itens: [{sku: 'MRARBS03', qtd: 700}]},
      // Aberto, antigo e parado.
      '0013': {cliente: 'ISA BEAUTY', dataPedido: '2026-02-01', itens: [{sku: 'ISA01', qtd: 3000}]},
      '0014': {cliente: 'MISS RÔSE', dataPedido: '2026-06-01', itens: [{sku: 'MRARBS04', qtd: 100}]},
      '0015': {cliente: 'MISS RÔSE', dataPedido: '2026-07-01', itens: [{sku: 'MRARBS04', qtd: 100}]},
      '0016': {cliente: 'MISS RÔSE', dataPedido: '2026-08-01', itens: [{sku: 'MRARBS04', qtd: 100}], status: 'CANCELADO'}
    },
    pedidos: {
      'PED-0002__MRARBS04': {id: 'PED-0002', parentPedidoId: 'PED-0002', sku: 'MRARBS04', cliente: 'MISS ROSE', qtdTotal: 10000, produzido: 4000, ultimoApontamento: '2026-09-15T10:00:00Z'},
      'PED-0002__MRARBS03': {id: 'PED-0002', parentPedidoId: 'PED-0002', sku: 'MRARBS03', cliente: 'MISS ROSE', qtdTotal: 2000, produzido: 0},
      '0010__MRARBS04': {id: '0010', parentPedidoId: '0010', sku: 'MRARBS04', qtdTotal: 1000, produzido: 1000},
      '0011__MRARBS03': {id: '0011', parentPedidoId: '0011', sku: 'MRARBS03', qtdTotal: 500, produzido: 500},
      '0012__MRARBS03': {id: '0012', parentPedidoId: '0012', sku: 'MRARBS03', qtdTotal: 700, produzido: 100, statusManual: 'encerrado'},
      '0013__ISA01': {id: '0013', parentPedidoId: '0013', sku: 'ISA01', qtdTotal: 3000, produzido: 1000},
      '0014__MRARBS04': {id: '0014', parentPedidoId: '0014', sku: 'MRARBS04', qtdTotal: 100, produzido: 100},
      '0015__MRARBS04': {id: '0015', parentPedidoId: '0015', sku: 'MRARBS04', qtdTotal: 100, produzido: 100},
      '0016__MRARBS04': {id: '0016', parentPedidoId: '0016', sku: 'MRARBS04', qtdTotal: 100, produzido: 0}
    },
    ops: {
      // OP antes da data do pedido: data inconsistente, fora do prazo.
      '26100-01': {lote: '26100/01', skuPedidoKey: '10__MRARBS04', dataInicioReal: '2026-02-20T08:00:00', status: 'Concluído'},
      '26250-01': {lote: '26250/01', skuPedidoKey: 'PED-0002__MRARBS04', dataInicioReal: '2026-09-01T08:00:00', status: 'Em Produção'},
      '26050-01': {lote: '26050/01', skuPedidoKey: '0013__ISA01', dataInicioReal: '2026-03-01T08:00:00', dataFimReal: '2026-03-02T08:00:00', status: 'Concluído'}
    },
    expedicoes_comerciais: {
      E1: {legado: true, tipoLegado: 'EXPEDIDO', data: '2026-03-10', cliente: 'MISS RÔSE', itens: {a: {qtd: 600, pedidoKey: '0010__MRARBS04', sku: 'MRARBS04'}}},
      E2: {legado: true, tipoLegado: 'EXPEDIDO', data: '2026-03-20', cliente: 'MISS RÔSE', itens: {a: {qtd: 380, skuPedidoKey: '10__MRARBS04', sku: 'MRARBS04'}}},
      E3: {legado: true, tipoLegado: 'EXPEDIDO', data: '2026-09-05', cliente: 'MISS RÔSE', itens: {a: {qtd: 1500, pedidoKey: 'PED-0002__MRARBS04'}}},
      E4: {legado: true, tipoLegado: 'FURTO', data: '2026-06-01', cliente: 'ISA BEAUTY', itens: {a: {qtd: 40, sku: 'ISA01'}}},
      E5: {status: 'CANCELADA', data: '2026-09-06', cliente: 'MISS RÔSE', itens: {a: {qtd: 999, skuPedidoKey: 'PED-0002__MRARBS04'}}},
      E6: {legado: true, tipoLegado: 'EXPEDIDO', data: '2026-06-10', cliente: 'MISS RÔSE', itens: {a: {qtd: 100, pedidoKey: '0014__MRARBS04'}}},
      E7: {legado: true, tipoLegado: 'EXPEDIDO', data: '2026-07-10', cliente: 'MISS RÔSE', itens: {a: {qtd: 100, pedidoKey: '0015__MRARBS04'}}}
    },
    estoque_lotes: {MRARBS04: {p1: {itemTipo: 'produto', saldoLote: 2500, opKey: '26250-01'}}},
    conferencias_pa: {}, solicitacoes_descarte: {}
  };
}

// ── Preço com vigência ─────────────────────────────────────────────────
{
  const b = base();
  assert.strictEqual(G.precoVigente(b.precos_venda, 'MRARBS04', '2025-12-31'), null);
  assert.strictEqual(G.precoVigente(b.precos_venda, 'MRARBS04', '2026-08-31').preco, 3);
  assert.strictEqual(G.precoVigente(b.precos_venda, 'MRARBS04', '2026-09-01').preco, 3.3, 'vale no próprio dia de início');
  assert.strictEqual(G.precoVigente(b.precos_venda, 'MRARBS04', HOJE).preco, 3.3, 'vigência futura não vale ainda');
  assert.ok(G.validarVigencia(b.precos_venda, 'MRARBS04', 0, '2026-10-01').length);
  assert.ok(G.validarVigencia(b.precos_venda, 'MRARBS04', 4, '').length);
  assert.ok(G.validarVigencia(b.precos_venda, 'MRARBS04', 4, '2026-09-01').some((e) => /Já existe/.test(e)));
  assert.deepStrictEqual(G.validarVigencia(b.precos_venda, 'MRARBS04', 4, '2026-10-01'), []);
}

const r = G.calcular(base(), HOJE);
const ped = (id) => r.pedidos.find((p) => p.id === id);

// ── Estados e carteira ─────────────────────────────────────────────────
{
  const p2 = ped('PED-0002');
  assert.strictEqual(p2.estado, 'ABERTO');
  assert.strictEqual(p2.numeroCliente, '28');
  assert.strictEqual(p2.clienteKey, 'MISS');
  assert.strictEqual(p2.saldoEntregar, 8500 + 2000);
  const nectar = p2.itens.find((i) => i.sku === 'MRARBS04');
  assert.strictEqual(nectar.expedido, 1500, 'carga cancelada não conta');
  assert.strictEqual(nectar.saldoProduzir, 6000);
  assert.strictEqual(nectar.pronto, 2500);
  assert.strictEqual(nectar.estoqueWms, 2500);
  assert.strictEqual(nectar.fontePreco, 'PEDIDO');
  assert.strictEqual(nectar.precoTabela, 3, 'tabela na data do pedido (20/08), não a de hoje (3,30 desde 01/09)');
  assert.strictEqual(nectar.desvioTabela, 0);
  assert.strictEqual(nectar.valor, 10000 * 3 - 100);
  const eclipse = p2.itens.find((i) => i.sku === 'MRARBS03');
  assert.strictEqual(eclipse.fontePreco, 'TABELA');
  assert.strictEqual(eclipse.preco, 2.5);
  assert.strictEqual(p2.atrasado, true);
  assert.strictEqual(p2.diasAtraso, 6);
  assert.strictEqual(p2.coberturaPreco, 1);

  assert.strictEqual(ped('0010').estado, 'ATENDIDO', '980 de 1000 expedidos >= 95%');
  assert.strictEqual(ped('0011').estado, 'A_CONFERIR');
  assert.strictEqual(ped('0011').aConferir, 500);
  assert.strictEqual(ped('0011').saldoEntregar, 0, 'a conferir fica fora da carteira');
  assert.strictEqual(ped('0012').estado, 'FECHADO');
  assert.strictEqual(ped('0016').estado, 'FECHADO', 'pedido comercial cancelado');
  assert.strictEqual(ped('0013').estado, 'ABERTO');
  assert.strictEqual(ped('0013').parado, true, 'aberto há 227 dias, último movimento em março');
  assert.strictEqual(ped('0013').clienteKey, 'ISA', '"ISA BEAUTY" casa com o cadastro "ISA BEAUTY MAKEUP"');
}
// Desconto de preço contra a tabela vira alerta.
{
  const b = base();
  b.pedidos_comerciais['PED-0002'].itens[0].valorUnitario = 2.7;
  const r3 = G.calcular(b, HOJE);
  const nectar = r3.pedidos.find((p) => p.id === 'PED-0002').itens.find((i) => i.sku === 'MRARBS04');
  assert.strictEqual(nectar.desvioTabela, -0.1);
  assert.ok(r3.alertas.some((a) => a.tipo === 'PRECO' && /10% abaixo/.test(a.texto)));
}

// ── Prazos ─────────────────────────────────────────────────────────────
{
  const p10 = ped('0010');
  assert.strictEqual(p10.dataInconsistente, true, 'OP em 20/02 antes do pedido em 01/03');
  assert.strictEqual(p10.diasAte1Op, null, 'prazo negativo não entra');
  assert.strictEqual(p10.diasAte1Saida, 9);
  assert.strictEqual(p10.dataCompleto, '2026-03-20');
  assert.strictEqual(p10.diasAteCompleto, 19);
  assert.strictEqual(p10.cargas, 2);
  const p2 = ped('PED-0002');
  assert.strictEqual(p2.diasAte1Op, 12);
  assert.strictEqual(p2.noPrazo, false, 'aberto e já passou da previsão');
}

// ── Clientes ───────────────────────────────────────────────────────────
{
  const miss = r.clientes.find((c) => c.clienteKey === 'MISS');
  assert.ok(miss, 'MISS RÔSE e MISS ROSE são o mesmo cliente');
  assert.strictEqual(r.clientes.filter((c) => /miss/i.test(c.cliente)).length, 1);
  assert.strictEqual(miss.condicaoPagamento, '30/45/60');
  assert.strictEqual(miss.pedidosTotal, 6, 'o cancelado (0016) não conta');
  // Datas: 01/03, 01/04, 01/05, 01/06, 01/07, 20/08 -> gaps 31,30,31,30,50 -> mediana 31
  assert.ok(miss.intervaloMedio >= 30 && miss.intervaloMedio <= 31);
  assert.strictEqual(miss.diasDesdeUltimo, 27);
  assert.strictEqual(miss.recompra, 'EM_DIA');
  assert.strictEqual(miss.carteiraUn, 10500);
  assert.strictEqual(miss.aConferirUn, 500);
  // PED-0002 (29.900 + 5.000) + tabela nos antigos: 0010 3.000, 0011 1.250, 0012 1.750, 0014 300, 0015 300. Cancelado fora.
  assert.strictEqual(miss.valor12m, 29900 + 5000 + 3000 + 1250 + 1750 + 300 + 300);
  const isa = r.clientes.find((c) => c.clienteKey === 'ISA');
  assert.strictEqual(isa.furto12m, 40);
  assert.strictEqual(isa.recompra, 'POUCO_HISTORICO');
  assert.strictEqual(isa.cliente, 'ISA BEAUTY MAKEUP');
  assert.ok(r.clientes.every((c) => c.cadastrado), 'nenhum cliente fantasma');
  // ABC: MISS tem o maior volume -> A.
  assert.strictEqual(r.clientes[0].clienteKey, 'MISS');
  assert.strictEqual(r.clientes[0].classe, 'A');
  const soma = r.clientes.reduce((s, c) => s + c.participacao, 0);
  assert.ok(Math.abs(soma - 1) < 0.01);
}
// Recompra atrasada: último pedido muito além do intervalo habitual.
{
  const r2 = G.calcular(base(), '2027-01-30');
  const miss = r2.clientes.find((c) => c.clienteKey === 'MISS');
  assert.strictEqual(miss.recompra, 'ATRASADA');
}

// ── KPIs e alertas ─────────────────────────────────────────────────────
{
  const k = r.kpis;
  assert.strictEqual(k.carteiraUn, 10500 + 3000, 'MISS 10.500 + ISA 3.000');
  assert.strictEqual(k.aConferirUn, 500);
  assert.strictEqual(k.atrasados, 1);
  assert.strictEqual(k.paradoPedidos, 1);
  assert.strictEqual(k.paradoUn, 3000);
  assert.strictEqual(k.carteiraValor, 8500 * 3 + 2000 * 2.5);
  assert.strictEqual(k.carteiraCoberturaPreco, Math.round(10500 / 13500 * 10000) / 10000);
  assert.strictEqual(k.itensAbertosSemPreco, 1);
  assert.strictEqual(k.skusAtivos, 3, 'produto inativo fora');
  assert.strictEqual(k.skusComPreco, 2);
  assert.strictEqual(k.mesAtual.mes, '2026-09');
  assert.strictEqual(k.mesAtual.expedidoUn, 1500);
  assert.strictEqual(r.serie.length, 12);
  assert.strictEqual(k.aging.reduce((s, a) => s + a.un, 0), k.carteiraUn, 'idade cobre a carteira inteira');
  const tipos = r.alertas.map((a) => a.tipo);
  ['ATRASO', 'PARADO', 'SEM_PRECO', 'A_CONFERIR'].forEach((t) => assert.ok(tipos.includes(t), 'alerta ' + t));
}

// ── Tabela de preços ───────────────────────────────────────────────────
{
  const t = G.tabelaPrecos(base(), HOJE, r);
  const nectar = t.find((x) => x.sku === 'MRARBS04');
  assert.strictEqual(nectar.precoVigente, 3.3);
  assert.strictEqual(nectar.desde, '2026-09-01');
  assert.deepStrictEqual(nectar.proxima, {preco: 3.6, inicio: '2026-12-01'});
  assert.strictEqual(nectar.ultimoPraticado.pedido, 'PED-0002');
  assert.strictEqual(nectar.vigencias[0].inicio, '2026-12-01', 'histórico do mais novo para o mais antigo');
  assert.ok(!t.some((x) => x.sku === 'GLOW01'), 'inativo sem preço fica fora');
}

// ── Base vazia não quebra ──────────────────────────────────────────────
{
  const v = G.calcular({}, HOJE);
  assert.deepStrictEqual(v.pedidos, []);
  assert.strictEqual(v.kpis.carteiraUn, 0);
  assert.strictEqual(v.kpis.carteiraValor, null);
}

console.log('run_gestao_comercial_test.js: OK');
