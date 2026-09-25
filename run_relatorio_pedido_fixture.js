'use strict';
// Base de dados do Relatório de Pedido, compartilhada pelos testes de motor e de tela.
function base() {
  return {
    pedidos: {
      '0008__MRARBS06': {id: '0008', parentPedidoId: '0008', sku: 'MRARBS06', produto: 'BODY SPLASH CEU', cliente: 'MISS RÔSE', qtdTotal: 10000, produzido: 9000, status: 'Produção Parcial'},
      '0008__MRARBS07': {id: '0008', parentPedidoId: '0008', sku: 'MRARBS07', produto: 'BODY SPLASH MAR', cliente: 'MISS RÔSE', qtdTotal: 5000, produzido: 5200, status: 'Concluído'},
      '0008__MRARBS08': {id: '0008', parentPedidoId: '0008', sku: 'MRARBS08', produto: 'BODY SPLASH SOL', cliente: 'MISS RÔSE', qtdTotal: 3000, produzido: 2500, status: 'Concluído', statusManual: 'encerrado'},
      '8__MRARBS06': {id: '8', sku: 'MRARBS06', cliente: 'OUTRO', qtdTotal: 1, produzido: 0, status: 'Não Iniciado'},
      '05__FBBS0003': {id: '05', parentPedidoId: '05', sku: 'FBBS0003', cliente: 'FEBELLA', qtdTotal: 100, produzido: 0, status: 'Não Iniciado'}
    },
    pedidos_comerciais: {'0008': {cliente: 'MISS ROSE', dataPedido: '2026-09-17', numeroPedidoCliente: 'PO-77'}, '05': {cliente: 'FEBELLA', dataPedido: '2026-04-30'}},
    ops: {
      '26146-01': {lote: '26146/01', sku: 'MRARBS06', skuPedidoKey: '0008__MRARBS06', status: 'Concluído', linha: 'Linha 02', qtdPlanejada: 5000, produzido: 5000, dataInicioReal: '2026-09-10T08:00:00'},
      '26147-01': {lote: '26147/01', sku: 'MRARBS06', skuPedidoKey: '0008__MRARBS06', status: 'Produção Parcial', linha: 'Linha 02', qtdPlanejada: 5000, produzido: 3000},
      '26148-01': {lote: '26148/01', sku: 'MRARBS06', skuPedidoKey: '0008__MRARBS06', status: 'Cancelado', qtdPlanejada: 5000, produzido: 0},
      '26204-04-v2': {lote: '26204/04-v2', sku: 'MRARBS07', skuPedidoKey: '0008__MRARBS07', status: 'Concluído', qtdPlanejada: 5000, produzido: 5200},
      '26100-01': {lote: '26100/01', sku: 'MRARBS08', skuPedidoKey: '0008__MRARBS08', status: 'Concluído', qtdPlanejada: 3000, produzido: 2500,
        perdas: {rotulosEnvase: 12, cartuchos: 3}},
      // Mesmo número de lote com e sem -v2: a perda do papel fica com a OP original.
      '26300-01': {lote: '26300/01', sku: 'FBBS0003', skuPedidoKey: '05__FBBS0003', status: 'Programado', qtdPlanejada: 100, produzido: 0},
      '26300-01-v2': {lote: '26300/01-v2', sku: 'FBBS0003', skuPedidoKey: '05__FBBS0003', status: 'Programado', qtdPlanejada: 100, produzido: 0}
    },
    perdas: {
      '26146-01': {a: {lote: '26146/01', perdas: [{tipo: 'Frascos', quantidade: 20}, {tipo: 'Rótulos', quantidade: 5}]},
        b: {lote: '26146/01', perdas: [{tipo: 'Frascos', quantidade: 4}, {tipo: 'Outro', especificacao: 'Válvula', quantidade: 2}]}},
      '26204-04': {c: {lote: '26204/04', perdas: [{tipo: 'Cartuchos', quantidade: 16}]}},
      '26300-01': {d: {lote: '26300/01', perdas: [{tipo: 'Frascos', quantidade: 9}]}}
    },
    expedicoes_comerciais: {
      c1: {status: 'Confirmada', itens: {
        i1: {opKey: '26146-01', skuPedidoKey: '0008__MRARBS06', qtd: 4800},
        i2: {opKey: '26204-04-v2', skuPedidoKey: '0008__MRARBS07', qtd: 5000},
        i3: {skuPedidoKey: '8__MRARBS06', qtd: 0}}},
      c2: {status: 'Cancelada', itens: {i1: {opKey: '26147-01', skuPedidoKey: '0008__MRARBS06', qtd: 999}}},
      leg: {legado: true, tipoLegado: 'EXPEDIDO', itens: {i1: {skuPedidoKey: '0008__MRARBS08', qtd: 2500}}}
    },
    estoque_lotes: {MRARBS06: {p1: {itemTipo: 'produto', opKey: '26147-01', saldoLote: 3000}, p2: {itemTipo: 'produto', opKey: '26146-01', saldoLote: 200}}},
    conferencias_pa: {}, solicitacoes_descarte: {},
    devolucoes_cliente: {d1: {status: 'RECEBIDA', itens: [{opKey: '26204-04-v2', skuPedidoKey: '0008__MRARBS07', qtdRecebida: 100}]}}
  };
}
module.exports = {base};
