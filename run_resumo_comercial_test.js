/* Resumo do pedido/orçamento e, principalmente, ONDE a edição pode
   acontecer sem quebrar a cadeia (pedido do usuário em 2026-09-22). */
const assert = require('assert');
const path = require('path');
const R = require(path.join(__dirname, 'public', 'shared', 'resumo-comercial.js'));

const pedido = {
  numero: 19, numeroFormatado: 'PED-0019', tipo: 'PEDIDO_COMERCIAL', status: 'LIBERADO_PCP', versao: 2,
  cliente: 'GLOW MAKE UP', clienteCadastro: {cnpj: '55.555.555/0001-55'}, dataPedido: '2026-08-01',
  numeroPedidoCliente: 'PO-8821', previsaoComercialEntrega: '2026-09-30', percentualNF: 100,
  contatoSelecionado: {nome: 'Bruno', telefone: '11 8888-0000', email: 'bruno@glow.com'},
  frete: {tipo: 'CIF', prazo: 'entrega em 5 dias', enderecoEntrega: 'Rua A, 100'},
  enderecoFaturamento: 'Rua B, 200', prazoPagamento: '28 dias', observacoes: 'Entregar pela manhã',
  itens: [
    {produtoKey: 'GLMKAM04', sku: 'GLMKAM04', descricao: 'ÁGUA MICELAR', qtd: 1000, valorUnitario: 7.5, desconto: 100},
    {produtoKey: 'GLMKAM03', sku: 'GLMKAM03', descricao: 'ÁGUA MICELAR CARVÃO', qtd: 500, valorUnitario: 8}
  ],
  totalValor: 11400, criadoEm: '2026-08-01T10:00:00Z', criadoPor: 'Comercial',
  historico: [{tipo: 'LIBERADO_PCP', em: '2026-08-01T10:00:00Z', descricao: 'Pedido confirmado e liberado ao PCP', por: 'Comercial'}]
};
const orcamento = {
  numeroFormatado: 'ORC-0007', tipo: 'ORCAMENTO', status: 'EM_ELABORACAO', cliente: 'PROSPECTO NOVO',
  cnpj: '11222333000181', contato: 'Marcos', email: 'marcos@prospecto.com', validade: '2026-10-31',
  prazoPagamento: '30 dias', frete: {tipo: 'FOB'}, evidencia: 'Briefing recebido por e-mail',
  itens: [
    {descricao: 'SÉRUM FACIAL 30ML', especificacao: 'frasco âmbar', qtd: 2000, valorUnitario: 12, desconto: 0},
    {descricao: 'TÔNICO 200ML', qtd: 1000, valorUnitario: 9, desconto: 500}
  ],
  totalValor: 32500, criadoEm: '2026-09-01T09:00:00Z'
};

// ── Resumo do pedido ────────────────────────────────────────────────────
{
  const r = R.resumo(pedido, 'PED-0019', {pedidosPorSku: {GLMKAM04: {produzido: 400}, GLMKAM03: {produzido: 500}}});
  assert.equal(r.tipo, 'PEDIDO');
  assert.equal(r.rotuloStatus, 'Liberado ao PCP');
  assert.equal(r.cnpj, '55.555.555/0001-55', 'CNPJ vem do cadastro congelado no pedido');
  assert.equal(r.contato, 'Bruno', 'contato do snapshot quando não há campo solto');
  assert.equal(r.qtdTotal, 1500);
  assert.equal(r.total, 11400);
  assert.equal(r.totalSomado, 11400, '1000×7,5−100 + 500×8');
  assert.equal(r.totalDivergente, false);
  assert.deepEqual(r.itens.map((i) => [i.sku, i.total, i.produzido, i.saldo]),
    [['GLMKAM04', 7400, 400, 600], ['GLMKAM03', 4000, 500, 0]], 'andamento por item vem do PCP');
  assert.equal(r.produzidoTotal, 900);
  assert.equal(r.versao, 2);
  assert.equal(r.historico[0].descricao, 'Pedido confirmado e liberado ao PCP');

  // Total gravado que não bate com a soma é denunciado, não escolhido em silêncio.
  const torto = R.resumo(Object.assign({}, pedido, {totalValor: 9999}), 'PED-0019');
  assert.equal(torto.total, 9999);
  assert.equal(torto.totalDivergente, true);
  // Sem contexto do PCP, não inventa andamento.
  assert.equal(R.resumo(pedido, 'PED-0019').produzidoTotal, null);
  assert.equal(R.resumo(pedido, 'PED-0019').itens[0].saldo, null);
  // Itens gravados como objeto (RTDB) valem igual.
  assert.equal(R.resumo(Object.assign({}, pedido, {itens: {a: pedido.itens[0], b: pedido.itens[1]}})).qtdTotal, 1500);
}

// ── Resumo do orçamento ─────────────────────────────────────────────────
{
  const r = R.resumo(orcamento, 'ORC-0007');
  assert.equal(r.tipo, 'ORCAMENTO');
  assert.equal(r.rotuloTipo, 'Orçamento');
  assert.equal(r.validade, '2026-10-31');
  assert.equal(r.totalSomado, 32500);
  assert.equal(r.itens[0].especificacao, 'frasco âmbar');
  assert.equal(r.itens[0].semCadastro, true, 'item de orçamento sem SKU é sinalizado');
  assert.equal(r.produzidoTotal, null, 'orçamento não tem produção');
}

// ── Onde a edição é segura: o cerne ─────────────────────────────────────
{
  const pedidoAcao = R.acaoEdicao(R.resumo(pedido, 'PED-0019'));
  assert.equal(pedidoAcao.modo, 'GESTAO', 'pedido nunca edita pelo Comercial');
  assert.equal(pedidoAcao.destino, 'gestao_comercial.html?tab=pedidos&pedido=PED-0019');
  assert.match(pedidoAcao.motivo, /backlog do PCP, OP, programação e conciliação/);
  assert.match(pedidoAcao.motivo, /não deixa a quantidade cair abaixo do que já foi produzido/);

  assert.equal(R.acaoEdicao(R.resumo(orcamento, 'ORC-0007')).modo, 'INLINE', 'orçamento em elaboração edita aqui');
  assert.equal(R.acaoEdicao(R.resumo(Object.assign({}, orcamento, {status: 'ENVIADO'}))).modo, 'INLINE', 'enviado ainda dá para corrigir');
  const aceito = R.acaoEdicao(R.resumo(Object.assign({}, orcamento, {status: 'ACEITO'})));
  assert.equal(aceito.modo, 'BLOQUEADO');
  assert.match(aceito.motivo, /solicitações de cadastro de produto/);
  assert.equal(R.acaoEdicao(R.resumo(Object.assign({}, pedido, {status: 'CANCELADO'}))).modo, 'BLOQUEADO');
  assert.equal(R.acaoEdicao(null).modo, 'BLOQUEADO');
}

// ── Edição do orçamento: valida e recalcula ─────────────────────────────
{
  const edicao = {cliente: 'PROSPECTO NOVO LTDA', cnpj: '11222333000181', contato: 'Marcos', email: 'marcos@prospecto.com',
    validade: '2026-11-30', prazoPagamento: '30 dias', observacoes: 'Revisado com o cliente', evidencia: 'Briefing recebido por e-mail',
    itens: [{descricao: 'SÉRUM FACIAL 30ML', especificacao: 'frasco âmbar', qtd: 2500, valorUnitario: 12, desconto: 0}]};
  const v = R.validarOrcamento(orcamento, edicao);
  assert.equal(v.ok, true, v.erros.join(' '));
  assert.equal(v.total, 30000, 'o total é recalculado aqui, nunca vem da tela');
  assert.deepEqual(v.mudancas.map((m) => m.campo), ['cliente', 'validade', 'observacoes', 'itens']);

  const ruim = R.validarOrcamento(orcamento, {cliente: '', validade: '', itens: [{descricao: '', qtd: 0}]});
  assert.equal(ruim.ok, false);
  assert.deepEqual(ruim.erros, ['Informe o cliente ou prospecto.', 'Informe a validade da proposta.',
    'Item 1: informe a descrição.', 'Item 1: quantidade tem que ser maior que zero.']);
  assert.equal(R.validarOrcamento(orcamento, {cliente: 'X', validade: '2026-10-10', itens: []}).erros[0],
    'O orçamento precisa de pelo menos um item.');
  assert.match(R.validarOrcamento(orcamento, {cliente: 'X', validade: '2026-10-10',
    itens: [{descricao: 'A', qtd: 10, valorUnitario: 1, desconto: 50}]}).erros[0], /desconto passa do valor/);

  const u = R.atualizacoesOrcamento('ORC-0007', edicao, v, 'Gustavo', '2026-09-22T12:00:00Z');
  assert.equal(u['orcamentos/ORC-0007/totalValor'], 30000);
  assert.equal(u['orcamentos/ORC-0007/cliente'], 'PROSPECTO NOVO LTDA');
  assert.equal(u['orcamentos/ORC-0007/itens'].length, 1);
  assert.equal(u['orcamentos/ORC-0007/atualizadoPor'], 'Gustavo');
  const hist = Object.keys(u).find((k) => /historico/.test(k));
  assert.match(u[hist].descricao, /Orçamento editado: cliente, validade, observacoes, itens/);
  // Caminhos planos: nenhuma chave de update pode ter objeto aninhado por caminho.
  Object.keys(u).forEach((k) => assert.ok(k.indexOf('orcamentos/ORC-0007/') === 0, k));
}

// ── Impressão ───────────────────────────────────────────────────────────
{
  const r = R.resumo(pedido, 'PED-0019', {pedidosPorSku: {GLMKAM04: {produzido: 400}}});
  const html = R.htmlImpressao(r, {emitidoEm: '22/09/2026 12:00', emitidoPor: 'Gustavo'});
  assert.match(html, /<title>Pedido comercial PED-0019<\/title>/);
  assert.match(html, /GLOW MAKE UP/);
  assert.match(html, /PO-8821/);
  assert.match(html, /R\$\s*11\.400,00/);
  assert.match(html, /Produzido/, 'coluna de produzido só quando há andamento');
  assert.match(html, /Documento emitido em 22\/09\/2026 12:00 por Gustavo/);
  assert.ok(!/undefined|NaN|\[object/.test(html), 'nada de sentinela vazando no papel');
  // Orçamento imprime sem coluna de produção e com a validade.
  const ho = R.htmlImpressao(R.resumo(orcamento, 'ORC-0007'), {emitidoEm: 'x'});
  assert.doesNotMatch(ho, /<th class="n">Produzido<\/th>/);
  assert.match(ho, /Validade/);
  assert.match(ho, /31\/10\/2026/, 'data em formato brasileiro');
  // Texto do cliente é escapado (nome com < não vira tag).
  assert.match(R.htmlImpressao(R.resumo(Object.assign({}, orcamento, {cliente: '<script>x</script>'})), {}), /&lt;script&gt;/);
}

console.log('run_resumo_comercial_test.js: OK');
