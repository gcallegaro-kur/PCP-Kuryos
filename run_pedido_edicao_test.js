const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, 'public', 'shared', 'pedido-edicao.js'));

const clone = (o) => JSON.parse(JSON.stringify(o));
function base() {
  return {
    id: 'PED-0002',
    pedidoComercial: {
      cliente: 'MISS ROSE', status: 'LIBERADO_PCP', dataPedido: '2026-09-16', numeroPedidoCliente: '28', prazoPagamento: '30/45/60',
      percentualNF: 50, frete: {tipo: 'FOB', prazo: '3 dias', enderecoEntrega: 'Rua A'}, historico: [{tipo: 'LIBERADO_PCP'}],
      itens: [
        {sku: 'MRARBS04', produtoKey: 'MRARBS04', descricao: 'NÉCTAR', qtd: 39158, valorUnitario: 2.7, desconto: 0, especificacao: 'manter'},
        {sku: 'MRARBS03', produtoKey: 'MRARBS03', descricao: 'ECLIPSE', qtd: 7411, valorUnitario: 2.7, desconto: 0},
        {sku: 'MRARBS01', produtoKey: 'MRARBS01', descricao: 'AURORA', qtd: 500, valorUnitario: 2.7, desconto: 0}
      ]
    },
    pedidos: {
      'PED-0002__MRARBS04': {id: 'PED-0002', parentPedidoId: 'PED-0002', sku: 'MRARBS04', qtdTotal: 39158, produzido: 3696},
      'PED-0002__MRARBS03': {id: 'PED-0002', parentPedidoId: 'PED-0002', sku: 'MRARBS03', qtdTotal: 7411, produzido: 0},
      'PED-0002__MRARBS01': {id: 'PED-0002', parentPedidoId: 'PED-0002', sku: 'MRARBS01', qtdTotal: 500, produzido: 0},
      'OUTRO__MRARBS03': {id: 'OUTRO', parentPedidoId: 'OUTRO', sku: 'MRARBS03', qtdTotal: 1, produzido: 0}
    },
    ops: {
      '26257-17': {lote: '26257/17', skuPedidoKey: 'PED-0002__MRARBS04', status: 'Em Produção'},
      '26257-30': {lote: '26257/30', skuPedidoKey: 'PED-0002__MRARBS03', status: 'Programado'},
      'cancelada': {lote: '1/1', skuPedidoKey: 'PED-0002__MRARBS01', status: 'Cancelado'}
    },
    produtos: {
      MRARBS02: {sku: 'MRARBS02', descricao: 'DEUSA'},
      MRARBS99: {sku: 'MRARBS99', descricao: 'VELHO', ativo: 'Inativo'}
    },
    analiseItens: [
      {sku: 'MRARBS04', linhaKey: 'PED-0002__MRARBS04', produzido: 3696, expedido: 1000},
      {sku: 'MRARBS03', linhaKey: 'PED-0002__MRARBS03', produzido: 0, expedido: 0},
      {sku: 'MRARBS01', linhaKey: 'PED-0002__MRARBS01', produzido: 0, expedido: 0}
    ]
  };
}
const itensDe = (b) => b.pedidoComercial.itens.map((i) => ({sku: i.sku, qtd: i.qtd, valorUnitario: i.valorUnitario, desconto: i.desconto}));
const meta = {motivo: 'Conciliação com o cliente', autor: 'Gustavo', agora: '2026-09-17T12:00:00Z'};

// Contexto: OP cancelada não conta; linha de outro pedido não entra.
{
  const c = E.contextoItens('PED-0002', base().pedidos, base().ops, base().analiseItens);
  assert.deepStrictEqual(c.MRARBS04.ops, ['26257/17']);
  assert.deepStrictEqual(c.MRARBS01.ops, []);
  assert.strictEqual(c.MRARBS03.linhaKey, 'PED-0002__MRARBS03');
}

// Sem motivo e sem mudança.
{
  const b = base();
  const p = E.planejar(b, {itens: itensDe(b)}, {motivo: ''});
  assert.ok(p.erros.some((e) => /motivo/.test(e)));
  assert.ok(E.planejar(b, {itens: itensDe(b)}, meta).erros.some((e) => /Nada foi alterado/.test(e)));
}

// Trava: abaixo do já produzido/expedido.
{
  const b = base();
  const itens = itensDe(b); itens[0].qtd = 3000;
  const p = E.planejar(b, {itens}, meta);
  assert.ok(p.erros.some((e) => /MRARBS04: quantidade não pode ficar abaixo do já produzido \(3\.696\)/.test(e)), p.erros.join('|'));
  itens[0].qtd = 3696;
  assert.deepStrictEqual(E.planejar(b, {itens}, meta).erros, [], 'igual ao produzido pode');
}

// Remoção: com OP ativa bloqueia; com produção bloqueia; limpa pode.
{
  const b = base();
  let p = E.planejar(b, {itens: itensDe(b).filter((i) => i.sku !== 'MRARBS03')}, meta);
  assert.ok(p.erros.some((e) => /MRARBS03 tem OP ativa \(26257\/30\)/.test(e)));
  const b2 = base(); delete b2.ops['26257-30']; b2.analiseItens[1].produzido = 10;
  p = E.planejar(b2, {itens: itensDe(b2).filter((i) => i.sku !== 'MRARBS03')}, meta);
  assert.ok(p.erros.some((e) => /já tem produção ou saída/.test(e)));
  p = E.planejar(base(), {itens: itensDe(base()).filter((i) => i.sku !== 'MRARBS01')}, meta);
  assert.deepStrictEqual(p.erros, [], 'OP cancelada não trava');
  assert.strictEqual(p.mudancas[0].tipo, 'ITEM_REMOVIDO');
}

// Validações de item.
{
  const b = base();
  let p = E.planejar(b, {itens: itensDe(b).concat([{sku: 'MRARBS04', qtd: 1}])}, meta);
  assert.ok(p.erros.some((e) => /duas vezes/.test(e)));
  p = E.planejar(b, {itens: itensDe(b).concat([{sku: 'NAOEXISTE', qtd: 1}])}, meta);
  assert.ok(p.erros.some((e) => /não está cadastrado/.test(e)));
  p = E.planejar(b, {itens: itensDe(b).concat([{sku: 'MRARBS99', qtd: 1}])}, meta);
  assert.ok(p.avisos.some((a) => /inativo/.test(a)));
  p = E.planejar(b, {itens: itensDe(b).map((i, k) => k === 1 ? Object.assign(i, {qtd: 0}) : i)}, meta);
  assert.ok(p.erros.some((e) => /maior que zero/.test(e)));
  p = E.planejar(b, {itens: []}, meta);
  assert.ok(p.erros.some((e) => /pelo menos um item/.test(e)));
  p = E.planejar(b, {campos: {percentualNF: 120}, itens: itensDe(b)}, meta);
  assert.ok(p.erros.some((e) => /entre 0 e 100/.test(e)));
  const canc = base(); canc.pedidoComercial.status = 'CANCELADO';
  assert.ok(E.planejar(canc, {itens: itensDe(canc)}, meta).erros.some((e) => /cancelado/.test(e)));
}

// Edição completa: gravação nas duas cópias, versão e histórico.
{
  const b = base();
  const itens = itensDe(b);
  itens[0].qtd = 40000;              // aumenta Néctar
  itens[1].valorUnitario = 2.9;      // reajusta Eclipse
  itens.push({sku: 'MRARBS02', qtd: 20000, valorUnitario: 2.7, desconto: 50}); // item novo
  const campos = {numeroPedidoCliente: '28', previsaoComercialEntrega: '2026-11-30', 'frete/tipo': 'CIF', dataPedido: '2026-09-16', observacoes: ''};
  const plano = E.planejar(b, {campos, itens: itens.filter((i) => i.sku !== 'MRARBS01')}, meta);
  assert.deepStrictEqual(plano.erros, []);
  assert.strictEqual(plano.versaoNova, 2);
  const tipos = plano.mudancas.map((m) => m.tipo).sort();
  assert.deepStrictEqual(tipos, ['CAMPO', 'CAMPO', 'ITEM_ADICIONADO', 'ITEM_REMOVIDO', 'PRECO', 'QUANTIDADE']);
  assert.ok(plano.mudancas.some((m) => m.campo === 'previsaoComercialEntrega' && m.antes === '' && m.depois === '2026-11-30'));

  const u = E.atualizacoes(b, plano, meta);
  const r = 'pedidos_comerciais/PED-0002/';
  assert.strictEqual(u[r + 'previsaoComercialEntrega'], '2026-11-30');
  assert.strictEqual(u[r + 'frete/tipo'], 'CIF');
  assert.strictEqual(u[r + 'numeroPedidoCliente'], undefined, 'campo igual não é regravado');
  assert.strictEqual(u[r + 'itens'].length, 3);
  assert.strictEqual(u[r + 'itens'][0].especificacao, 'manter', 'campo desconhecido do item preservado');
  assert.strictEqual(u[r + 'total_qtd'], 40000 + 7411 + 20000);
  assert.strictEqual(u[r + 'totalValor'], Math.round((40000 * 2.7 + 7411 * 2.9 + 20000 * 2.7 - 50) * 100) / 100);
  assert.strictEqual(u[r + 'versao'], 2);
  const v = u[r + 'versoes/v2'];
  assert.strictEqual(v.motivo, 'Conciliação com o cliente');
  assert.strictEqual(v.anterior.itens.length, 3);
  assert.ok(v.mudancas.every((m) => m.texto));
  assert.strictEqual(u[r + 'historico/1'].tipo, 'EDITADO');
  // Linhas do PCP.
  assert.strictEqual(u['pedidos/PED-0002__MRARBS04/qtdTotal'], 40000);
  assert.strictEqual(u['pedidos/PED-0002__MRARBS03/valorUnitario'], 2.9);
  assert.strictEqual(u['pedidos/PED-0002__MRARBS04/frete'].tipo, 'CIF');
  assert.strictEqual(u['pedidos/PED-0002__MRARBS04/frete'].prazo, '3 dias', 'resto do frete preservado');
  assert.strictEqual(u['pedidos/PED-0002__MRARBS01'], null, 'item removido sai do PCP');
  const nova = u['pedidos/PED-0002__MRARBS02'];
  assert.strictEqual(nova.qtdTotal, 20000);
  assert.strictEqual(nova.produzido, 0);
  assert.strictEqual(nova.parentPedidoId, 'PED-0002');
  assert.strictEqual(nova.produto, 'DEUSA');
  // Nenhum caminho é ancestral de outro (o RTDB rejeitaria o update).
  const chaves = Object.keys(u);
  chaves.forEach((a) => chaves.forEach((c) => { if (a !== c) assert.ok(c.indexOf(a + '/') !== 0, a + ' é ancestral de ' + c); }));
}

// Pedido já editado: versão segue a sequência; linha legado com chave diferente do SKU.
{
  const b = base();
  b.pedidoComercial.versao = 3;
  b.analiseItens[0].linhaKey = '0011__BODY_SPLASH_NECTAR';
  const itens = itensDe(b); itens[0].qtd = 39200;
  const plano = E.planejar(b, {itens}, meta);
  assert.strictEqual(plano.versaoNova, 4);
  const u = E.atualizacoes(b, plano, meta);
  assert.strictEqual(u['pedidos/0011__BODY_SPLASH_NECTAR/qtdTotal'], 39200);
  assert.ok(u['pedidos_comerciais/PED-0002/versoes/v4']);
}

console.log('run_pedido_edicao_test.js: OK');
