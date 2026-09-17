const assert = require('assert');
const path = require('path');
const D = require(path.join(__dirname, 'functions', 'pedido_diretoria.js'));

// Destinatários: lista ou texto; inválidos e repetidos fora; sem padrão.
assert.deepStrictEqual(D.destinatarios({emailDiretoria: 'A@Kuryos.com.br; b@kuryos.com.br, x, a@kuryos.com.br'}), ['a@kuryos.com.br', 'b@kuryos.com.br']);
assert.deepStrictEqual(D.destinatarios({emailDiretoria: ['c@kuryos.com.br', '']}), ['c@kuryos.com.br']);
assert.deepStrictEqual(D.destinatarios({}), [], 'sem configuração não inventa endereço');

// Criação: só pedido com item de SKU e não cancelado.
assert.strictEqual(D.deveEnviarCriacao(null), false);
assert.strictEqual(D.deveEnviarCriacao({itens: []}), false);
assert.strictEqual(D.deveEnviarCriacao({itens: [{sku: 'X', qtd: 1}], status: 'CANCELADO'}), false);
assert.strictEqual(D.deveEnviarCriacao({itens: [{sku: 'X', qtd: 1}], status: 'LIBERADO_PCP'}), true);
assert.strictEqual(D.deveEnviarCriacao({itens: {0: {sku: 'X', qtd: 1}}}), true, 'itens como objeto (RTDB)');

const pc = {
  numeroFormatado: 'PED-0002', cliente: 'MISS <ROSE>', numeroPedidoCliente: '28', dataPedido: '2026-09-16', previsaoComercialEntrega: '2026-11-16',
  prazoPagamento: '30/45/60', percentualNF: 50, frete: {tipo: 'FOB'}, criadoPor: 'Gustavo',
  itens: [{sku: 'MRARBS04', descricao: 'NÉCTAR DAS TÂMARAS', qtd: 39158, valorUnitario: 2.7, desconto: 0},
    {sku: 'MRARBS03', descricao: 'ECLIPSE', qtd: 7411, valorUnitario: 0}]
};

// Totais: item sem preço não entra no valor e é contado.
assert.deepStrictEqual(D.totais(pc), {qtd: 46569, valor: 39158 * 2.7, semPreco: 1, itens: 2});

// E-mail de pedido novo.
{
  const e = D.montarEmail(pc, 'PED-0002', null);
  assert.strictEqual(e.assunto, 'Novo pedido: PED-0002 — MISS <ROSE> (pedido do cliente 28)');
  assert.ok(e.corpo.includes('MISS &lt;ROSE&gt;'), 'HTML escapado');
  assert.ok(e.corpo.includes('1 item(ns) sem preço'));
  assert.ok(e.corpo.includes('16/11/2026'));
  assert.strictEqual(e.arquivo, 'Pedido PED-0002.pdf');
}
// E-mail de alteração: mudanças e motivo.
const versao = {versao: 3, em: '2026-09-17T15:00:00Z', por: 'Gustavo', motivo: 'Cliente aumentou',
  mudancas: [{tipo: 'QUANTIDADE', texto: 'MRARBS04 quantidade: 39.158 → 40.000'}]};
{
  const e = D.montarEmail(pc, 'PED-0002', versao);
  assert.ok(e.assunto.startsWith('Pedido alterado (v3): PED-0002'));
  assert.ok(e.corpo.includes('O que mudou na versão 3'));
  assert.ok(e.corpo.includes('Cliente aumentou'));
  assert.ok(e.corpo.includes('39.158 → 40.000'), 'no HTML a seta fica');
  assert.strictEqual(e.arquivo, 'Pedido PED-0002 v3.pdf');
}
// Versão 1 passada por engano não vira "alterado".
assert.ok(D.montarEmail(pc, 'PED-0002', {versao: 1}).assunto.startsWith('Novo pedido'));

// PDF: caractere fora do WinAnsi trocado; documento válido; pedido grande pagina.
assert.strictEqual(D.paraPdf('a → b “c”'), 'a -> b "c"');
(async () => {
  const pdf = await D.gerarPdf(pc, 'PED-0002', versao, {cnpj: '55.426.843/0001-46'});
  assert.strictEqual(pdf.slice(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 1500);
  const paginas = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
  assert.strictEqual(paginas(pdf), 1);
  const grande = JSON.parse(JSON.stringify(pc));
  for (let k = 0; k < 60; k++) grande.itens.push({sku: 'SKU' + k, descricao: 'PRODUTO ' + k, qtd: 100, valorUnitario: 1});
  const pdfGrande = await D.gerarPdf(grande, 'PED-0002', null, null);
  assert.ok(paginas(pdfGrande) >= 2, 'itens continuam na página seguinte');
  const vazio = await D.gerarPdf({itens: []}, 'X', null, null);
  assert.strictEqual(vazio.slice(0, 5).toString(), '%PDF-', 'pedido sem dados não quebra');
  console.log('run_pedido_diretoria_test.js: OK');
})().catch((e) => { console.error(e); process.exit(1); });
