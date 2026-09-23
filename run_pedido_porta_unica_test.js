// GAP-18: pedido nasce só no Comercial (decisão do usuário, 23/09).
// Pedidos e MRP (pedidos.html) é consulta e priorização; não cria pedido.
// node run_pedido_porta_unica_test.js
const assert = require('assert');
const fs = require('fs');
const h = fs.readFileSync('public/pedidos.html', 'utf8');

assert.ok(!/id="btnNovo"/.test(h), 'o botão "+ Novo Pedido" voltou para pedidos.html');
assert.ok(!/function openNew\(/.test(h), 'openNew voltou: criar pedido aqui escapa de preço, versão e trava');
assert.ok(/href="comercial\.html"[^>]*>Novo pedido: Comercial/.test(h), 'falta o caminho para o Comercial');
assert.ok(/if \(!editingKey\) \{ showModalAlert\('Pedidos novos são lançados no Comercial\.'\); return; \}/.test(h),
  'salvar sem pedido aberto tem que recusar (o modal ainda existe para editar)');
console.log('pedido porta única: 4 asserções OK');
