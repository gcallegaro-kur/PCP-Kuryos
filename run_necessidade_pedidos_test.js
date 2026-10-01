'use strict';
/* O que comprar por pedido: necessidade (mesma explosão do app) x estoque livre
   x a caminho x já em compra, com os pedidos disputando o mesmo material na
   ordem de atendimento. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ctx = {console: {log() {}, warn() {}, error() {}}, window: {}, document: undefined, setTimeout, Promise};
ctx.globalThis = ctx;
vm.createContext(ctx);
['utils.js', 'propriedade-estoque.js'].forEach((f) => vm.runInContext(fs.readFileSync('public/shared/' + f, 'utf8'), ctx, {filename: f}));
const NP = require('./public/shared/necessidade-pedidos.js');
const fn = {explodir: (...a) => JSON.parse(JSON.stringify(ctx.explodirMateriaisNecessarios(...a))), melhorFormula: ctx.melhorFormulaDoProduto, chaveVersao: ctx.chaveVersao, semControle: ctx.materialSemControleEstoque};
const PE = ctx.PropriedadeEstoque;

const produto = (sku, cliente, key) => ({sku, cliente, clienteKey: key, volume: 100, unidadeVolume: 'ml', densidadeGranel: 1, overfillPct: 0, perdaProcessoPct: 0, ativo: 'Ativo'});
const produtos = {'SKU-A': produto('SKU-A', 'MISS ROSE', 'MISS'), 'SKU-B': produto('SKU-B', 'BIOFLORA', 'BIO'), 'SKU-C': produto('SKU-C', 'WIKE', 'WIKE'), 'SKU-SEM': produto('SKU-SEM', 'X', 'X')};
const formula = (sku) => ({codProduto: sku, versao: 'v1', status: 'APROVADA', itens: {f1: {mpCodigo: 'MPGR-AGUA', mpNome: 'ÁGUA', percentualMM: 90}, f2: {mpCodigo: 'MPGR-ALC', mpNome: 'ÁLCOOL', percentualMM: 10}}});
const bom = (sku) => ({codProduto: sku, versao: 'v1', itens: {b1: {materialCodigo: 'EP-FRASCO', materialNome: 'FRASCO 100ML', qtdPorPeca: 1}, b2: {materialCodigo: 'EP-VALV', materialNome: 'VALVULA', qtdPorPeca: 1}}});
const formulas = {'SKU-A__v1': formula('SKU-A'), 'SKU-B__v1': formula('SKU-B'), 'SKU-C__v1': formula('SKU-C')};
const boms = {'SKU-A__v1': bom('SKU-A'), 'SKU-B__v1': bom('SKU-B'), 'SKU-C__v1': bom('SKU-C')};
const materiais = {
  'EP-FRASCO': {mpCodigo: 'EP-FRASCO', tipo: 'EP', mpNome: 'FRASCO 100ML', unidade: 'un'},
  'EP-VALV': {mpCodigo: 'EP-VALV', tipo: 'EP', mpNome: 'VALVULA', unidade: 'un'},
  'MPGR-AGUA': {mpCodigo: 'MPGR-AGUA', tipo: 'MPGR', mpNome: 'ÁGUA', unidade: 'kg', controlaEstoque: false},
  'MPGR-ALC': {mpCodigo: 'MPGR-ALC', tipo: 'MPGR', mpNome: 'ÁLCOOL', unidade: 'kg'}
};
const pedidos = {
  '0001__SKU-A': {id: '0001', sku: 'SKU-A', produto: 'A', cliente: 'MISS ROSE', qtdTotal: 1000, produzido: 0, dataEntregaPcp: '2026-10-20', priority: 2},
  '0002__SKU-B': {id: '0002', sku: 'SKU-B', produto: 'B', cliente: 'BIOFLORA', qtdTotal: 1000, produzido: 200, dataEntregaPcp: '2026-10-10', priority: 1},
  '0003__SKU-C': {id: '0003', sku: 'SKU-C', produto: 'C', cliente: 'WIKE', qtdTotal: 500, produzido: 0, priority: 3},
  '0004__SKU-SEM': {id: '0004', sku: 'SKU-SEM', produto: 'S', cliente: 'X', qtdTotal: 100, produzido: 0},
  '0005__SKU-A': {id: '0005', sku: 'SKU-A', produto: 'A', cliente: 'MISS ROSE', qtdTotal: 100, produzido: 100},
  '0006__SKU-A': {id: '0006', sku: 'SKU-A', produto: 'A', cliente: 'MISS ROSE', qtdTotal: 100, produzido: 0, status: 'Concluído'}
};

// ── pedidos abertos e ordem de atendimento ──
const ab = NP.pedidosAbertos(pedidos, ctx.isConcluido);
assert.deepEqual(ab.map((p) => p.id), ['0002', '0001', '0003', '0004'], 'entrega mais cedo primeiro; sem data depois; produzido e concluído saem');
assert.equal(ab.find((p) => p.id === '0002').saldo, 800, 'saldo = total − produzido');

const estoque = {
  'EP-FRASCO': {materialCodigo: 'EP-FRASCO', saldoAtual: 1500, saldoEmpenhado: 300, empenhos: {'OP-OUTRO': {qtdEmpenhada: 300}}},
  'EP-VALV': {materialCodigo: 'EP-VALV', saldoAtual: 1000, saldoEmpenhado: 1000, porCliente: {MISS: {clienteNome: 'MISS ROSE', saldoAtual: 600}},
    empenhos: {'OP-A1': {qtdEmpenhada: 1000}}},
  'MPGR-ALC': {materialCodigo: 'MPGR-ALC', saldoAtual: -40, saldoEmpenhado: 0}
};
const ops = {'OP-A1': {skuPedidoKey: '0001__SKU-A'}, 'OP-OUTRO': {skuPedidoKey: '9999__SKU-Z'}};
const pedidosCompra = {
  pc1: {numeroFormatado: 'PC-0001', status: 'ENVIADO', dataPrevistaEntrega: '2026-10-15', fornecedorNome: 'FORN', itens: {i1: {materialCodigo: 'EP-FRASCO', qtd: 700, qtdRecebida: 100}}},
  pc2: {numeroFormatado: 'PC-0002', status: 'ABERTO', itens: {i1: {materialCodigo: 'EP-FRASCO', qtd: 400}}},
  pc3: {numeroFormatado: 'PC-0003', status: 'RECEBIDO', itens: {i1: {materialCodigo: 'EP-FRASCO', qtd: 9999}}}
};
const solicitacoes = {
  s1: {numeroFormatado: 'SC-0001', status: 'PENDENTE', itens: {a: {materialCodigo: 'EP-VALV', qtd: 200}}},
  s2: {numeroFormatado: 'SC-0002', status: 'CONSOLIDADA', itens: {a: {materialCodigo: 'EP-VALV', qtd: 5000}}},
  s3: {numeroFormatado: 'SC-0003', status: 'REJEITADA', itens: {a: {materialCodigo: 'EP-VALV', qtd: 5000}}}
};
const base = {pedidos, produtos, formulas, bom: boms, materiais, estoque, ops, pedidosCompra, solicitacoes, fn, PE, hoje: '2026-10-01'};
const calc = (sel, extra) => NP.calcular(Object.assign({}, base, {selecionados: sel}, extra));
const mat = (r, c) => r.materiais.find((m) => m.codigo === c);

// ── um pedido só: 0002 (BIOFLORA, 800 pçs, entrega 10/10) ──
let r = calc(['0002__SKU-B']);
let fr = mat(r, 'EP-FRASCO');
assert.equal(fr.necessario, 800);
// livre = 1500 − 300 (de outra OP) = 1200 ≥ 800 → coberto só pelo estoque
assert.equal(fr.doEstoque, 800);
assert.equal(fr.estado, 'coberto');
assert.equal(mat(r, 'MPGR-AGUA'), undefined, 'água sem controle de estoque não gera necessidade');
// Válvula: 1000 totais, 600 da MISS, 1000 empenhados pela OP do pedido 0001 (não selecionado) → geral livre 0
let vv = mat(r, 'EP-VALV');
assert.equal(vv.doEstoque, 0, 'estoque da MISS e o empenhado não servem à BIOFLORA');
assert.equal(vv.andamento, 200, 'solicitação pendente (200) conta como em andamento');
assert.equal(vv.falta, 600, 'a CONSOLIDADA e a REJEITADA não contam');
assert.equal(vv.estado, 'falta');
// Álcool com saldo negativo: nada disponível, e marcado como base não confiável
const alc = mat(r, 'MPGR-ALC');
assert.equal(alc.doEstoque, 0);
assert.equal(alc.negativo, true);
assert.equal(alc.necessario, 8, '800 pçs × 100 ml = 80 L × 1 kg/L = 80 kg de massa × 10% de álcool');

// ── dois pedidos disputando o frasco: quem entrega antes leva primeiro ──
r = calc(['0001__SKU-A', '0002__SKU-B']);
fr = mat(r, 'EP-FRASCO');
assert.deepEqual(r.ordem, ['0002__SKU-B', '0001__SKU-A']);
assert.equal(fr.necessario, 1800);
const f2 = fr.porPedido.find((p) => p.id === '0002'), f1 = fr.porPedido.find((p) => p.id === '0001');
assert.equal(f2.doEstoque, 800, 'o pedido que entrega antes leva o estoque');
assert.equal(f1.doEstoque, 400, 'o outro fica com o que sobrou (1200 − 800)');
// depois do estoque vem o PC enviado (700 − 100 já recebidos = 600), com a data
assert.equal(f1.qCaminho, 600);
assert.equal(f1.chegaEm, '2026-10-15');
assert.equal(f1.atrasa, false, 'entrega 20/10, chega 15/10');
// e o PC ABERTO (400) é "em andamento"; 1000 − 400 − 600 = 0 → nada falta
assert.equal(f1.qAndamento, 0);
assert.equal(f1.falta, 0);
assert.equal(fr.estado, 'caminho');

// A chegada que passa da entrega do pedido é sinalizada.
r = calc(['0002__SKU-B', '0001__SKU-A'], {pedidosCompra: Object.assign({}, pedidosCompra, {pc1: Object.assign({}, pedidosCompra.pc1, {dataPrevistaEntrega: '2026-10-25'})})});
assert.equal(mat(r, 'EP-FRASCO').porPedido.find((p) => p.id === '0001').atrasa, true, 'chega 25/10 e a entrega é 20/10');

// Ordem manual: o usuário decide que o pedido 0001 vem primeiro.
r = calc(['0001__SKU-A', '0002__SKU-B'], {ordem: ['0001__SKU-A', '0002__SKU-B']});
assert.deepEqual(r.ordem, ['0001__SKU-A', '0002__SKU-B']);
assert.equal(mat(r, 'EP-FRASCO').porPedido.find((p) => p.id === '0001').doEstoque, 1000, 'passa a levar o estoque primeiro');
assert.equal(mat(r, 'EP-FRASCO').porPedido.find((p) => p.id === '0002').doEstoque, 200);

// ── dono: a MISS tem 600 válvulas dela; só o pedido 0001 (MISS) usa ──
r = calc(['0001__SKU-A', '0002__SKU-B']);
vv = mat(r, 'EP-VALV');
const v1 = vv.porPedido.find((p) => p.id === '0001'), v2 = vv.porPedido.find((p) => p.id === '0002');
// 0001 tem OP emitida (empenho 1000 é dele): geral livre = 1000−600 (da MISS) − (1000−1000) = 400; cliente 600
assert.equal(v1.doEstoque, 1000, 'estoque da MISS (600) + geral livre (400): o empenho da própria OP não é concorrência');
assert.equal(v2.doEstoque, 0, 'o pedido da BIOFLORA chega depois e não sobra nada');
assert.equal(vv.concorrentes, 2);

// ── pedido que não calcula não derruba o resto, e diz por quê ──
r = calc(['0004__SKU-SEM', '0003__SKU-C']);
const semForm = r.pedidos.find((p) => p.id === '0004');
assert.equal(semForm.ok, false);
assert.match(semForm.erro, /Fórmula/);
assert.equal(r.resumo.semFormula, 1);
assert.ok(mat(r, 'EP-FRASCO'), 'o pedido 0003 foi calculado normalmente');
assert.equal(r.pedidos.find((p) => p.id === '0003').materiais, 3);

// ── cobertura do pedido e o que trava ──
r = calc(['0002__SKU-B']);
const p2 = r.pedidos[0];
assert.equal(p2.materiais, 3, 'frasco, válvula e álcool');
assert.equal(p2.cobertos, 1, 'só o frasco está coberto');
assert.equal(p2.pctCoberto, 33);
assert.deepEqual(p2.faltam.map((f) => f.codigo).sort(), ['EP-VALV', 'MPGR-ALC']);

// ── resumo e itens da solicitação ──
assert.deepEqual([r.resumo.materiais, r.resumo.coberto, r.resumo.falta, r.resumo.naoConfiaveis], [3, 1, 2, 1]);
const sol = NP.itensParaSolicitar(r);
assert.deepEqual(sol.map((s) => s.materialCodigo).sort(), ['EP-VALV', 'MPGR-ALC']);
assert.equal(sol.find((s) => s.materialCodigo === 'EP-VALV').qtd, 600, 'não pede de novo o que já está em solicitação');
assert.match(sol[0].obs, /precisa/);
// estoque do cliente cobre só o cliente: o pedido da MISS sozinho
r = calc(['0001__SKU-A']);
assert.equal(mat(r, 'EP-VALV').estado, 'coberto', '600 da MISS + 400 geral livre cobrem as 1000');

// A seleção vazia não quebra.
r = calc([]);
assert.deepEqual([r.materiais.length, r.pedidos.length], [0, 0]);

console.log('OK Necessidade por pedido: ordem de atendimento, estoque por dono, a caminho, em compra, falta e itens da solicitação.');
