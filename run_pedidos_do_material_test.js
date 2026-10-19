'use strict';
/* Compras › Cliente/pedido sugere só os pedidos que demandam o material
   (23/10/2026). Regra pura + o índice real de OndeUsado. */
const assert = require('node:assert/strict');
const path = require('node:path');
const OU = require(path.join(__dirname, 'public', 'shared', 'onde-usado.js'));
const PM = require(path.join(__dirname, 'public', 'shared', 'pedidos-do-material.js'));
const PE = require(path.join(__dirname, 'public', 'shared', 'propriedade-estoque.js'));

const produtos = {
  AAA01: {sku: 'AAA01', descricao: 'BODY SPLASH A', clienteKey: 'C1', cliente: 'CLI UM'},
  BBB02: {sku: 'BBB02', descricao: 'HIDRATANTE B', clienteKey: 'C1', cliente: 'CLI UM'},
  CCC03: {sku: 'CCC03', descricao: 'PERFUME C', clienteKey: 'C2', cliente: 'CLI DOIS'},
  OLD04: {sku: 'OLD04', descricao: 'INATIVO', clienteKey: 'C2', cliente: 'CLI DOIS', ativo: false}
};
const clientes = {C1: {nome: 'CLI UM', ativo: true}, C2: {nome: 'CLI DOIS', ativo: true}};
const bom = {
  AAA01__v1: {codProduto: 'AAA01', versao: 'v1', status: 'APROVADA', itens: {a: {materialCodigo: 'EP-FRASCO', qtdPorPeca: 1}, b: {materialCodigo: 'ET-CAIXA', qtdPorPeca: 0.04}}},
  CCC03__v1: {codProduto: 'CCC03', versao: 'v1', status: 'APROVADA', itens: {a: {materialCodigo: 'EP-FRASCO', qtdPorPeca: 1}}},
  OLD04__v1: {codProduto: 'OLD04', versao: 'v1', status: 'APROVADA', itens: {a: {materialCodigo: 'EP-FRASCO', qtdPorPeca: 1}}}
};
const formulas = {
  BBB02__v1: {codProduto: 'BBB02', versao: 'v1', status: 'APROVADA', itens: {a: {mpCodigo: 'MPGR-ALCOOL', percentualMM: 60}}},
  AAA01__v1: {codProduto: 'AAA01', versao: 'v1', status: 'APROVADA', itens: {a: {mpCodigo: 'MPGR-ALCOOL', percentualMM: 70}}}
};
const pedidos = {
  '0010__AAA01': {id: '0010', parentPedidoId: '0010', sku: 'AAA01', cliente: 'CLI UM', status: 'Não Iniciado', qtdTotal: 100, produzido: 0},
  '0010__BBB02': {id: '0010', parentPedidoId: '0010', sku: 'BBB02', cliente: 'CLI UM', status: 'Não Iniciado', qtdTotal: 100, produzido: 0},
  '0011__BBB02': {id: '0011', parentPedidoId: '0011', sku: 'BBB02', cliente: 'CLI UM', status: 'Não Iniciado', qtdTotal: 100, produzido: 0},
  '0020__CCC03': {id: '0020', parentPedidoId: '0020', sku: 'CCC03', cliente: 'CLI DOIS', status: 'Não Iniciado', qtdTotal: 50, produzido: 0}
};
const indice = OU.indice({formulas, bom, produtos});
const abertos = (k) => PE.pedidosDoCliente(k, pedidos, produtos, clientes, {});

// Frasco: AAA01 e CCC03 (o OLD04 é inativo e não conta); o BBB02 não usa.
{
  const d = PM.skusQueUsam(indice, ['EP-FRASCO']);
  assert.equal(d.achou, true);
  assert.deepEqual(Object.keys(d.skus).sort(), ['AAA01', 'CCC03']);
  assert.deepEqual(d.via.AAA01, ['BOM']);
  const c1 = PM.filtrarGrupos(abertos('C1'), d);
  assert.equal(c1.filtrado, true);
  assert.deepEqual(c1.grupos.map((g) => g.id), ['0010'], 'o pedido 0011 (só BBB02) some; o 0010 fica');
  assert.deepEqual(c1.grupos[0].linhas.map((l) => l.sku), ['AAA01'], 'dentro do 0010 só a linha que usa o frasco');
  assert.deepEqual(c1.grupos[0].linhas[0].via, ['BOM']);
  assert.deepEqual(PM.filtrarGrupos(abertos('C2'), d).grupos.map((g) => g.id), ['0020']);
}

// Matéria-prima vem da fórmula; a contagem por cliente alimenta a lista.
{
  const d = PM.skusQueUsam(indice, ['MPGR-ALCOOL']);
  assert.deepEqual(Object.keys(d.skus).sort(), ['AAA01', 'BBB02']);
  assert.deepEqual(PM.filtrarGrupos(abertos('C1'), d).grupos.map((g) => g.id), ['0011', '0010'], 'mais recente primeiro, como na tela');
  assert.deepEqual(PM.contagemPorCliente(['C1', 'C2'], abertos, d), {C1: 2, C2: 0});
  assert.equal(PM.filtrarGrupos(abertos('C2'), d).grupos.length, 0, 'cliente sem pedido que use: lista vazia (a tela oferece "mostrar todos")');
}

// Sem como saber -> não filtra (material fora de toda fórmula/BOM).
{
  const d = PM.skusQueUsam(indice, ['EP-ETIQUETA-X']);
  assert.equal(d.achou, false); assert.deepEqual(d.semUso, ['EP-ETIQUETA-X']);
  const r = PM.filtrarGrupos(abertos('C1'), d);
  assert.equal(r.filtrado, false); assert.equal(r.grupos.length, 2, 'todos os pedidos do cliente');
  assert.deepEqual(PM.contagemPorCliente(['C1'], abertos, d), {C1: 0});
}

// Editor "todos os itens": se UM material é desconhecido, não filtra (esconderia pedido do outro).
{
  const misto = PM.skusQueUsam(indice, ['EP-FRASCO', 'EP-ETIQUETA-X']);
  assert.equal(misto.achou, false); assert.deepEqual(misto.semUso, ['EP-ETIQUETA-X']);
  assert.equal(PM.filtrarGrupos(abertos('C1'), misto).filtrado, false);
  // Todos conhecidos: união.
  const uniao = PM.skusQueUsam(indice, ['EP-FRASCO', 'MPGR-ALCOOL']);
  assert.equal(uniao.achou, true);
  assert.deepEqual(Object.keys(uniao.skus).sort(), ['AAA01', 'BBB02', 'CCC03']);
}

// Bordas.
assert.equal(PM.skusQueUsam({}, []).achou, false);
assert.equal(PM.skusQueUsam(null, ['X']).achou, false);
assert.equal(PM.filtrarGrupos([], PM.skusQueUsam(indice, ['EP-FRASCO'])).grupos.length, 0);
assert.equal(PM.skusQueUsam(indice, ['ep-frasco']).achou, false, 'código é exato (como no cadastro)');
assert.deepEqual(Object.keys(PM.skusQueUsam({X: [{sku: 'aaa01', via: 'BOM'}]}, ['X']).skus), ['AAA01'], 'SKU compara em maiúsculas');

// Tela.
const html = require('node:fs').readFileSync('public/compras.html', 'utf8');
assert.ok(/shared\/pedidos-do-material\.js/.test(html) && /shared\/onde-usado\.js/.test(html));
assert.ok(/PedidosDoMaterial\.filtrarGrupos\(lista, demanda\)/.test(html) && /vinc-todos-ped/.test(html) && /Clientes com pedido que usa este material/.test(html));
console.log('run_pedidos_do_material_test: OK');
