// GAP-05: mudança no pedido tem que chegar às OPs. node run_impacto_pedido_ops_test.js
const assert = require('assert');
const I = require('./public/shared/impacto-pedido-ops.js');
const PedidoEdicao = require('./public/shared/pedido-edicao.js');

let n = 0;
function ok(cond, msg) { assert.ok(cond, msg); n++; }
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); n++; }

const ops = {
  '26300-01': {lote: '26300/01', skuPedidoKey: '0014__ABC', qtdPlanejada: 5000, produzidoLinha: 1200, status: 'Em Produção'},
  '26300-02': {lote: '26300/02', skuPedidoKey: '14__ABC', qtdPlanejada: 3000, status: 'Programado'},        // chave sem zero: mesma linha
  '26300-03': {lote: '26300/03', skuPedidoKey: '0014__ABC', qtdPlanejada: 2000, produzidoLinha: 2000, status: 'Concluído'},
  '26300-04': {lote: '26300/04', skuPedidoKey: '0014__ABC', qtdPlanejada: 900, status: 'Cancelado'},
  '26300-05': {lote: '26300/05', skuPedidoKey: '0014__ABC', qtdPlanejada: 700, produzidoLinha: 700, status: 'Aguardando Confirmação'},
  '26301-01': {lote: '26301/01', skuPedidoKey: '0014__XYZ', qtdPlanejada: 1000, status: 'Programado'},
  '26399-01': {lote: '26399/01', skuPedidoKey: '0099__ABC', qtdPlanejada: 1000, status: 'Programado'}      // outro pedido
};

// 1. Só OPs ativas da linha (Concluído, Cancelado e Aguardando Confirmação ficam de fora).
const at = I.opsAtivasDaLinha('0014__ABC', ops);
eq(at.map(o => o.lote), ['26300/01', '26300/02'], 'ativas da linha, com normalização do zero à esquerda');
eq(at[0].produzido, 1200, 'produzido da linha');

// 2. Redução: produzido 3900 (1200 + 2000 + 700) + a fazer 3800 + 3000 = 10700 comprometido.
let r = I.avaliar([{sku: 'ABC', linhaKey: '0014__ABC', qtdAntes: 11000, qtdNova: 8000, produzido: 3900}], ops);
eq(r.length, 1, 'redução abaixo do comprometido é afetada');
eq(r[0].comprometido, 3900 + 3800 + 3000, 'comprometido = produzido + a fazer nas OPs ativas');
eq(r[0].excesso, 10700 - 8000, 'excesso');
eq(r[0].ops.length, 2, 'lista as duas OPs ativas');

// 3. Redução que ainda cabe no comprometido não gera nada.
r = I.avaliar([{sku: 'ABC', linhaKey: '0014__ABC', qtdAntes: 12000, qtdNova: 10700, produzido: 3900}], ops);
eq(r, [], 'reduzir até o comprometido não sobra OP');

// 4. Item sem OP ativa não gera nada, mesmo cancelado.
r = I.avaliar([{sku: 'QQQ', linhaKey: '0014__QQQ', qtdAntes: 100, qtdNova: null, produzido: 0}], ops);
eq(r, [], 'sem OP ativa, nada para o PCP');

// 5. Cancelamento: todas as linhas do pedido, qtdNova null.
const pedidos = {
  '0014__ABC': {id: '0014', parentPedidoId: '0014', sku: 'ABC', produzido: 3900, qtdTotal: 11000},
  '0014__XYZ': {id: '0014', parentPedidoId: '0014', sku: 'XYZ', produzido: 0, qtdTotal: 1000},
  '0099__ABC': {id: '0099', parentPedidoId: '0099', sku: 'ABC', produzido: 0, qtdTotal: 1000}
};
const itensCanc = I.itensDoCancelamento('0014', [{sku: 'ABC', qtd: 11000}, {sku: 'XYZ', qtd: 1000}], pedidos);
eq(itensCanc.map(i => i.linhaKey), ['0014__ABC', '0014__XYZ'], 'linhas do próprio pedido, nunca de outro');
r = I.avaliar(itensCanc, ops);
eq(r.map(i => i.sku), ['ABC', 'XYZ'], 'cancelamento pega todo item com OP ativa');
eq(r.reduce((s, i) => s + i.ops.length, 0), 3, 'três OPs ativas no pedido 0014');

// 6. Pendência: caminho plano, uma entrada por OP, chave determinística.
let u = I.pendencia('PEDIDO_CANCELADO', {id: '0014', cliente: 'MISS ROSE', numeroPedidoCliente: '34'}, r,
  {motivo: 'Cliente desistiu', autor: 'Ana', agora: '2026-09-23T12:00:00Z'});
eq(Object.keys(u), ['pendencias_pcp/0014__cancelamento'], 'um caminho só, determinístico');
const p = u['pendencias_pcp/0014__cancelamento'];
eq(p.status, 'ABERTA', 'nasce aberta');
eq(Object.keys(p.ops).sort(), ['26300-01', '26300-02', '26301-01'], 'uma entrada por OP afetada');
eq(p.ops['26300-01'].sku, 'ABC', 'OP sabe o item');
eq(p.numeroPedidoCliente, '34', 'leva o número do cliente');
eq(I.pendencia('PEDIDO_REDUZIDO', {id: '0014'}, [], {}), {}, 'sem afetado, sem pendência');
eq(Object.keys(I.pendencia('PEDIDO_REDUZIDO', {id: '0014'}, r, {versao: 3})), ['pendencias_pcp/0014__v3'], 'edição usa a versão na chave');

// 7. Situação contra as OPs de agora.
let sit = I.situacao(p, ops);
eq(sit.pendentes, 3, 'tudo pendente na abertura');
ok(!sit.resolvida, 'não resolvida');
const depois = JSON.parse(JSON.stringify(ops));
depois['26300-02'].status = 'Cancelado';
depois['26301-01'].status = 'Aguardando Confirmação';
const pMantida = JSON.parse(JSON.stringify(p));
pMantida.ops['26300-01'].decisao = 'MANTIDA';
pMantida.ops['26300-01'].motivoMantida = 'vira estoque para o próximo pedido';
sit = I.situacao(pMantida, depois);
eq(sit.linhas.map(l => l.estado).sort(), ['CANCELADA', 'FECHADA', 'MANTIDA'], 'cancelada, fechada e mantida');
ok(sit.resolvida, 'resolvida quando nada ficou pendente');

// 8. Ligação com a edição real: plano do PedidoEdicao reduzindo abaixo da OP.
const base = {
  id: '0014',
  pedidoComercial: {id: '0014', cliente: 'MISS ROSE', status: 'LIBERADO_PCP', versao: 2,
    itens: [{sku: 'ABC', descricao: 'Body splash', qtd: 11000, valorUnitario: 5}]},
  pedidos: {'0014__ABC': pedidos['0014__ABC']},
  ops: ops,
  produtos: {ABC: {sku: 'ABC', descricao: 'Body splash', ativo: 'Ativo'}},
  analiseItens: [{sku: 'ABC', linhaKey: '0014__ABC', produzido: 3900, expedido: 0}]
};
const plano = PedidoEdicao.planejar(base, {campos: {}, itens: [{sku: 'ABC', qtd: 8000, valorUnitario: 5, desconto: 0}]},
  {motivo: 'Cliente reduziu', autor: 'Ana'});
eq(plano.erros, [], 'edição válida (8000 ≥ produzido)');
const itensEd = I.itensDaEdicao(plano);
eq(itensEd.map(i => [i.linhaKey, i.qtdAntes, i.qtdNova]), [['0014__ABC', 11000, 8000]], 'itensDaEdicao lê a redução do plano');
const afet = I.avaliar(itensEd, ops);
eq(afet[0].excesso, 2700, 'mesma conta pelo caminho da edição');
// A pendência entra no MESMO mapa de update da edição.
const mapa = Object.assign(PedidoEdicao.atualizacoes(base, plano, {motivo: 'Cliente reduziu', autor: 'Ana', agora: 'x'}),
  I.pendencia('PEDIDO_REDUZIDO', base.pedidoComercial, afet, {versao: plano.versaoNova, motivo: 'Cliente reduziu'}));
ok(mapa['pendencias_pcp/0014__v3'] && mapa['pedidos/0014__ABC/qtdTotal'] === 8000, 'pendência e quantidade no mesmo update');
ok(!Object.keys(mapa).some(k => k.startsWith('ops/')), 'o Comercial não escreve em ops/ — cancelar é do PCP');

// 9. Aumento não gera pendência.
const planoMais = PedidoEdicao.planejar(base, {campos: {}, itens: [{sku: 'ABC', qtd: 15000, valorUnitario: 5, desconto: 0}]}, {motivo: 'mais', autor: 'Ana'});
eq(I.itensDaEdicao(planoMais), [], 'aumento: o saldo aparece sozinho no backlog');

console.log('impacto-pedido-ops: ' + n + ' asserções OK');
