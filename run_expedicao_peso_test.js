/* Expedição: peso da carga, peso teórico e "selecionar todos".
   Pedido do usuário (2026-09-15): peso como na planilha, teórico do que
   aguarda Qualidade/Conferência de PA, e selecionar tudo antes ou depois dos
   filtros. Funções puras de public/shared/expedicao-grade.js. */
const assert = require('assert');
const path = require('path');
const G = require(path.join(__dirname, 'public', 'shared', 'expedicao-grade.js'));

// ── 1. Peso do palete: fontes em ordem ──────────────────────────────────
// planilha (peso real do palete) vence tudo
assert.deepEqual(G.pesoPalete({pesoTotalKg: 260.4, pesoPorCaixaKg: 8.4, caixasFechadas: 30, unidadesPorCaixa: 24, unidadesCaixaParcial: 10, saldoLote: 730}, {kgCaixa: 99}),
  {kg: 260.4, kgPorCaixa: 8.4, fonte: 'PLANILHA'});
// kg/cx gravado no palete vence o cadastro
let p = G.pesoPalete({pesoPorCaixaKg: 8.4, caixasFechadas: 10, unidadesPorCaixa: 24, saldoLote: 240}, {kgCaixa: 99});
assert.equal(p.kg, 84); assert.equal(p.fonte, 'PALETE');
// cadastro do produto
p = G.pesoPalete({caixasFechadas: 157, unidadesPorCaixa: 12, unidadesCaixaParcial: 11, saldoLote: 1895}, {kgCaixa: 1.7});
assert.equal(p.fonte, 'CADASTRO');
assert.equal(p.volumes, 158, 'a caixa parcial conta como volume');
assert.equal(p.kg, 268.6, 'convenção da planilha: a parcial pesa uma caixa cheia');
// sem kg/cx em lugar nenhum: DESCONHECIDO, nunca zero
p = G.pesoPalete({caixasFechadas: 10, unidadesPorCaixa: 24, saldoLote: 240}, {kgCaixa: 0});
assert.equal(p.kg, null);
assert.match(p.falta, /kg por caixa/);
assert.equal(G.pesoPalete({caixasFechadas: 10, unidadesPorCaixa: 24, saldoLote: 240}, null).kg, null);
// composição a conferir: estima volumes pelo un/cx do cadastro
p = G.pesoPalete({caixasFechadas: 10, unidadesPorCaixa: 24, saldoLote: 999}, {kgCaixa: 2, unCx: 24});
assert.equal(p.volumes, 42); assert.equal(p.kg, 84);
// composição a conferir e sem un/cx: não inventa
p = G.pesoPalete({saldoLote: 999}, {kgCaixa: 2});
assert.equal(p.kg, null); assert.match(p.falta, /composição/);

// ── 2. Peso teórico de OP sem palete ────────────────────────────────────
let t = G.pesoTeoricoOp(1661, {unCx: 24, kgCaixa: 8.4});
assert.equal(t.volumes, 70, '1661 ÷ 24 = 69,2 -> 70 volumes');
assert.equal(t.kg, 588);
assert.equal(G.pesoTeoricoOp(1661, {unCx: 24}).kg, null, 'sem kg/cx no cadastro não estima peso');
assert.equal(G.pesoTeoricoOp(1661, {unCx: 24}).volumes, 70, '...mas os volumes seguem úteis');
assert.match(G.pesoTeoricoOp(1661, {kgCaixa: 8.4}).falta, /unidades por caixa/);
assert.equal(G.pesoTeoricoOp(0, {unCx: 24, kgCaixa: 1}).kg, null);

// ── 3. Soma: desconhecido não vira zero ─────────────────────────────────
assert.deepEqual(G.somaPeso([{kg: 100.25}, {kg: null}, {kg: 50}, null]), {kg: 150.25, itens: 4, semPeso: 2});
assert.deepEqual(G.somaPeso([]), {kg: 0, itens: 0, semPeso: 0});

// ── 4. Produto pelo SKU: chave direta ou campo sku ──────────────────────
const produtos = {GLMKAM01: {sku: 'GLMKAM01', kgCaixa: 8.4}, 'outra-chave': {sku: 'PRF-AFEE-0014', kgCaixa: 1.7}};
assert.equal(G.produtoDoSku(produtos, 'GLMKAM01').kgCaixa, 8.4);
assert.equal(G.produtoDoSku(produtos, 'PRF-AFEE-0014').kgCaixa, 1.7);
assert.equal(G.produtoDoSku(produtos, 'NADA'), null);

// ── 5. Selecionar todos: regras do servidor ─────────────────────────────
const linha = (id, over) => Object.assign({id, cliente: 'AFEER', clienteKey: 'c1', frete: {tipo: 'CIF', enderecoEntrega: 'Rua A, 1'}}, over || {});
// 5a. tudo compatível: seleciona tudo
let r = G.selecionarTodos([linha(1), linha(2), linha(3)], []);
assert.deepEqual(r.selecionar.map(l => l.id), [1, 2, 3]); assert.equal(r.motivo, '');
// 5b. sem seleção e dois clientes: não marca nada e pede filtro
r = G.selecionarTodos([linha(1), linha(2, {cliente: 'MISS ROSE', clienteKey: 'c2'})], []);
assert.equal(r.selecionar.length, 0);
assert.match(r.motivo, /2 clientes\. Filtre um cliente/);
// 5c. mesmo cliente, destinos diferentes: não cabem na mesma carga
r = G.selecionarTodos([linha(1), linha(2, {frete: {tipo: 'CIF', enderecoEntrega: 'Rua B, 2'}})], []);
assert.equal(r.selecionar.length, 0); assert.match(r.motivo, /destinos ou CIF\/FOB/);
// 5d. com seleção existente: completa só com o compatível e avisa o resto
r = G.selecionarTodos([linha(2), linha(3, {cliente: 'MISS ROSE', clienteKey: 'c2'}), linha(4, {frete: {tipo: 'FOB', enderecoEntrega: 'Rua A, 1'}})], [linha(1)]);
assert.deepEqual(r.selecionar.map(l => l.id), [2]);
assert.equal(r.ignoradas, 2); assert.match(r.motivo, /2 palete\(s\) de outro cliente, destino ou CIF\/FOB ficaram de fora/);
// 5e. frete sem tipo é compatível com qualquer tipo (como no servidor)
assert.equal(G.compativel(linha(1), linha(2, {frete: {tipo: '', enderecoEntrega: 'Rua A, 1'}})), true);
// 5f. limite de 100 paletes por carga
const muitas = Array.from({length: 130}, (_, i) => linha(i));
r = G.selecionarTodos(muitas, [linha('ja1'), linha('ja2')]);
assert.equal(r.selecionar.length, 98, '100 menos os 2 já selecionados');
assert.match(r.motivo, /limite de 100 paletes/);
// 5g. nada visível
assert.match(G.selecionarTodos([], []).motivo, /Nenhum palete/);

console.log('run_expedicao_peso_test: OK');
