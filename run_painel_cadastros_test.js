'use strict';
/* Painel de Controle › Cadastros: o que falta no cadastro dos SKUs que estão em uso. */
const assert = require('node:assert/strict');
const P = require('./public/shared/painel-gargalos.js');

const agora = Date.parse('2026-10-28T15:00:00Z');
const completo = {descricao: 'Completo', prazoValidadeMeses: 36, kgCaixa: 5, unCx: 12, prodHoraRef: 500, clienteKey: 'cli1', cliente: 'CLI'};
const dados = {
  clientes: {cli1: {nome: 'CLI'}},
  produtos: {
    AAA: Object.assign({sku: 'AAA'}, completo),
    BBB: Object.assign({}, completo, {sku: 'BBB', descricao: 'Sem validade', prazoValidadeMeses: 0}),
    CCC: Object.assign({}, completo, {sku: 'CCC', descricao: 'Sem peso', kgCaixa: null}),
    DDD: Object.assign({}, completo, {sku: 'DDD', descricao: 'Vários', unCx: null, prodHoraRef: 0, clienteKey: 'orfao'}),
    EEE: Object.assign({}, completo, {sku: 'EEE', descricao: 'Sem fórmula'}),
    FFF: Object.assign({}, completo, {sku: 'FFF', descricao: 'Fórmula sem aprovação'}),
    GGG: Object.assign({}, completo, {sku: 'GGG', descricao: 'Sem BOM'}),
    HHH: {sku: 'HHH', descricao: 'Incompleto mas parado'}
  },
  formulas: {
    a1: {codProduto: 'AAA', versao: 'v1', status: 'APROVADA'},
    f1: {codProduto: 'FFF', versao: 'v1', status: 'RASCUNHO'},
    g1: {codProduto: 'GGG', versao: 'v1', status: 'APROVADA'}, g2: {codProduto: 'GGG', versao: 'v2', status: 'APROVADA'},
    b1: {codProduto: 'BBB', versao: 'v1', status: 'APROVADA'}, c1: {codProduto: 'CCC', versao: 'v1', status: 'APROVADA'}, d1: {codProduto: 'DDD', versao: 'v1', status: 'APROVADA'}
  },
  bom: {'AAA__v1': {itens: {x: {}}}, 'FFF__V1': {itens: {x: {}}}, 'GGG__v1': {itens: {x: {}}}, 'BBB__v1': {itens: {x: {}}}, 'CCC__v1': {itens: {x: {}}}, 'DDD__v1': {itens: {x: {}}}},
  ops: {
    o1: {status: 'Programado', sku: 'AAA', lote: '1/01'}, o2: {status: 'Programado', sku: 'DDD', lote: '2/01'}, o3: {status: 'Em Produção', sku: 'FFF', lote: '3/01'},
    o4: {status: 'Concluído', sku: 'HHH', lote: '4/01'}, o5: {status: 'Programado', sku: 'SEMCADASTRO', lote: '5/01'}
  },
  pedidos: {
    'P1__CCC': {id: 'P1', sku: 'CCC', qtdTotal: 100, produzido: 10},
    'P2__EEE': {id: 'P2', sku: 'EEE', qtdTotal: 100, produzido: 0},
    'P3__GGG': {id: 'P3', sku: 'GGG', qtdTotal: 100, produzido: 0},
    'P4__HHH': {id: 'P4', sku: 'HHH', qtdTotal: 100, produzido: 100, status: 'Concluído'},
    'P5__BBB': {id: 'P5', sku: 'BBB', qtdTotal: 100, produzido: 0, statusManual: 'encerrado'}
  },
  estoque_lotes: {
    BBB: {l1: {itemTipo: 'produto', itemCodigo: 'BBB', saldoLote: 10}},
    CCC: {l2: {itemTipo: 'produto', itemCodigo: 'CCC', saldoLote: 5, dataValidade: '2027-01-01', pesoPorCaixaKg: 4}},
    MP1: {l3: {itemTipo: 'material', itemCodigo: 'MP1', saldoLote: 5}}
  }
};
const r = P.analisar(dados, {agora, lib: {}});
const e = Object.fromEntries(r.etapas.map((x) => [x.id, x]));
const skus = (id) => e[id].itens.map((i) => i.rotulo.split(' ')[0]).sort();
const tarde = (id) => e[id].itens.filter((i) => i.atrasado).map((i) => i.rotulo.split(' ')[0]).sort();

assert.ok(P.FASES.includes('Cadastros'));
assert.deepEqual(skus('cad_prazo_validade'), ['BBB'], 'só SKU em uso: HHH (parado) e SEMCADASTRO ficam de fora; BBB tem pedido encerrado mas lote em estoque');
assert.deepEqual(tarde('cad_prazo_validade'), ['BBB'], 'lote em estoque sem validade: a NF não sai');
assert.match(e.cad_prazo_validade.itens[0].motivo, /1 lote\(s\) em estoque sem validade/);
assert.deepEqual(skus('cad_kg_caixa'), ['CCC']); assert.deepEqual(tarde('cad_kg_caixa'), [], 'tem pedido aberto, mas o lote em estoque traz o peso: sem bloqueio agora');
assert.deepEqual(skus('cad_un_caixa'), ['DDD']); assert.deepEqual(tarde('cad_un_caixa'), ['DDD']);
assert.deepEqual(skus('cad_prod_hora'), ['DDD']); assert.deepEqual(tarde('cad_prod_hora'), ['DDD']);
assert.deepEqual(skus('cad_cliente'), ['DDD'], 'clienteKey que não existe em clientes');
assert.deepEqual(skus('cad_formula'), ['EEE']); assert.deepEqual(tarde('cad_formula'), ['EEE']);
assert.match(e.cad_formula.itens[0].detalhe, /1 pedido aberto/);
assert.deepEqual(skus('cad_formula_aprovada'), ['FFF']);
assert.deepEqual(skus('cad_bom'), ['GGG'], 'v2 aprovada sem BOM; FFF acha o BOM por maiúscula/minúscula diferente (V1 x v1)');
assert.match(e.cad_bom.itens[0].motivo, /versão v2 não tem BOM/);
['cad_prazo_validade', 'cad_kg_caixa', 'cad_un_caixa', 'cad_formula', 'cad_formula_aprovada', 'cad_bom', 'cad_cliente', 'cad_prod_hora'].forEach((id) => {
  assert.equal(e[id].setor, 'Cadastros'); assert.equal(e[id].fase, 'Cadastros'); assert.equal(e[id].slaH, 0);
});
const cad = r.setores.find((s) => s.setor === 'Cadastros');
assert.equal(cad.atrasados, 7, 'BBB, DDD(un/cx), DDD(ritmo), DDD(cliente), EEE, FFF, GGG');
assert.equal(e.cad_formula_aprovada.itens[0].atrasado, true); assert.equal(e.cad_bom.itens[0].atrasado, true);

// Sem o cadastro de produtos carregado, nenhuma etapa de cadastro aparece (e nada quebra).
const vazio = P.analisar(Object.assign({}, dados, {produtos: {}}), {agora, lib: {}});
assert.equal(vazio.etapas.filter((x) => x.fase === 'Cadastros').reduce((t, x) => t + x.n, 0), 0);
// Sem fórmulas carregadas, não acusa "sem fórmula" por engano.
const semFormulas = P.analisar(Object.assign({}, dados, {formulas: {}}), {agora, lib: {}});
assert.equal(semFormulas.etapas.find((x) => x.id === 'cad_formula').n, 0, 'nó de fórmulas vazio = ainda não carregou');

// Cobrança sai com os motivos do bloqueio.
const msg = P.textoCobranca('Cadastros', r, 3);
assert.match(msg, /^Pendências fora do prazo — Cadastros \(7\):/);
assert.match(msg, /SKU sem fórmula \(O que comprar e MRP não calculam\) \(1\):\n {3}- EEE — Sem fórmula \(CLI\) — O que comprar e o MRP não calculam este SKU/);

console.log('run_painel_cadastros_test: OK');
