'use strict';
/* Separação consolidada por material (2026-09-25).
   Regras puras de public/shared/separacao-consolidada.js rodando com o FEFO
   REAL de shared/utils.js (sugerirAlocacaoFefo): ordem pelo Planejamento,
   soma do mesmo material entre SKUs diferentes, falta caindo na OP de menor
   prioridade, material de cliente só para o cliente, pedaço já separado fora
   da origem, posição bloqueada fora. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const S = require('./public/shared/separacao-consolidada.js');
const ctx = {console, window: {}, document: {addEventListener() {}}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/shared/utils.js', 'utf8'), ctx, {filename: 'utils.js'});
const fefo = ctx.sugerirAlocacaoFefo, sk = ctx.sanitizeKey;
const J = (x) => JSON.parse(JSON.stringify(x));
let n = 0;
function t(nome, fn) { fn(); n++; console.log('ok -', nome); }

const bom = (cod, qtd, extra) => Object.assign({mpCodigo: cod, mpNome: cod === 'FR-1' ? 'FRASCO 200ML' : cod, unidade: 'un', quantidade: qtd, origem: 'bom'}, extra || {});
const ops = {
  a: {lote: '26300/01', sku: 'MRARBS05', produto: 'BODY SPLASH A', cliente: 'MISS ROSE', status: 'Programado', dataInicioPlanejada: '2026-09-28T08:00:00',
    materiaisConsumo: {m1: bom('FR-1', 500), m2: bom('VAL-1', 500), g: {mpCodigo: 'ESS-1', quantidade: 3, origem: 'formula'}}},
  b: {lote: '26301/01', sku: 'KUBPBA01', produto: 'BODY SPLASH B', cliente: 'KURYOS', status: 'Programado', dataInicioPlanejada: '2026-09-26T13:00:00',
    materiaisConsumo: {m1: bom('FR-1', 500)}},
  c: {lote: '26290/02', sku: 'MRARBS08', produto: 'BODY SPLASH C', status: 'Em Produção', abertaDesde: '2026-09-25T07:10:00', abertaLinha: 'Linha 2',
    materiaisConsumo: {m1: bom('FR-1', 100)}},
  semData: {lote: '26310/01', sku: 'X', status: 'Não Iniciado', dataEmissao: '2026-09-20', materiaisConsumo: {m1: bom('FR-1', 50)}},
  longe: {lote: '26320/01', sku: 'Y', status: 'Programado', dataInicioPlanejada: '2026-10-20T08:00:00', materiaisConsumo: {m1: bom('FR-1', 70)}},
  feita: {lote: '26200/01', sku: 'Z', status: 'Programado', dataInicioPlanejada: '2026-09-26T08:00:00', separacaoConcluida: {em: 'x'}, materiaisConsumo: {m1: bom('FR-1', 10)}},
  conc: {lote: '26100/01', sku: 'Z', status: 'Concluído', dataInicioPlanejada: '2026-09-26T08:00:00', materiaisConsumo: {m1: bom('FR-1', 10)}},
  semBom: {lote: '26400/01', sku: 'Z', status: 'Programado', dataInicioPlanejada: '2026-09-26T08:00:00', materiaisConsumo: {g: {mpCodigo: 'ESS-1', quantidade: 3, origem: 'formula'}}}
};
const lote = (cod, saldo, end, extra) => Object.assign({itemCodigo: cod, itemNome: cod, unidade: 'un', saldoLote: saldo, status: 'LIBERADO', enderecoKey: end, enderecoCodigo: end}, extra || {});
const lotes = {
  'FR-1': {
    l1: lote('FR-1', 600, 'GAL-02', {dataValidade: '2027-06-01', loteInterno: 'AK-2026-000801'}),
    l2: lote('FR-1', 400, 'GAL-01', {dataValidade: '2027-01-01', loteInterno: 'AK-2026-000802'}),
    sep: lote('FR-1', 999, 'FAB-01', {origemTipo: 'separacao_op', origemRef: '26000/01'}),
    blq: lote('FR-1', 999, 'GAL-X')
  },
  'VAL-1': {
    cli: lote('VAL-1', 300, 'GAL-05', {propriedade: {tipo: 'CLIENTE', clienteKey: 'MRAR'}}),
    outro: lote('VAL-1', 900, 'GAL-06', {propriedade: {tipo: 'CLIENTE', clienteKey: 'SEUNO'}}),
    kur: lote('VAL-1', 150, 'GAL-07')
  }
};
const bloqueados = {'GAL-X': true};
const cliente = {a: 'MRAR', b: 'PROP', c: 'MRAR'};
const entradas = (lista) => lista.map((e) => ({opKey: e.opKey, op: e.op, clienteKey: cliente[e.opKey] || null}));

t('ordem do Planejamento: na linha primeiro, depois data programada, sem data por último', () => {
  const lista = S.opsNoHorizonte(ops, '2026-10-02', true).map((e) => e.opKey);
  assert.deepEqual(lista, ['c', 'b', 'a', 'semData']);
  assert.equal(S.prioridadeOp(ops.c).rotulo, 'Em produção · Linha 2');
});

t('horizonte: fora da data, sem programação (se não pedido), separada, concluída e sem embalagem ficam de fora', () => {
  assert.deepEqual(S.opsNoHorizonte(ops, '2026-10-02', false).map((e) => e.opKey), ['c', 'b', 'a']);
  assert.deepEqual(S.opsNoHorizonte(ops, '2026-09-27', false).map((e) => e.opKey), ['c', 'b'], 'OP na linha entra sempre');
  assert.ok(S.opsNoHorizonte(ops, null, true).some((e) => e.opKey === 'longe'), 'sem data-limite entra tudo');
});

t('mesmo frasco em SKUs diferentes vira uma linha só, com o total e as partes por OP', () => {
  const plano = S.planejar(entradas(S.opsNoHorizonte(ops, '2026-10-02', false)), lotes, bloqueados, fefo, sk);
  const fr = plano.find((m) => m.mpCodigo === 'FR-1');
  assert.equal(fr.necessario, 1100);
  assert.equal(fr.ops.length, 3);
  assert.equal(plano.some((m) => m.mpCodigo === 'ESS-1'), false, 'granel/fórmula não entra: escopo é embalagem');
  // Saldo livre 1000 (600 + 400): a OP de menor prioridade (a, 28/09) fica com a falta.
  assert.equal(fr.alocado, 1000);
  assert.equal(fr.faltante, 100);
  assert.deepEqual(J(fr.ops.map((o) => [o.opKey, o.alocado, o.faltante])), [['c', 100, 0], ['b', 500, 0], ['a', 400, 100]]);
  // FEFO: GAL-01 vence antes e é esvaziado primeiro, pelas OPs de maior prioridade.
  const g1 = fr.linhas.find((l) => l.enderecoCodigo === 'GAL-01');
  assert.deepEqual(J(g1.partes.map((p) => [p.opLote, p.qtd])), [['26290/02', 100], ['26301/01', 300]]);
  const g2 = fr.linhas.find((l) => l.enderecoCodigo === 'GAL-02');
  assert.equal(g2.qtd, 600);
  assert.equal(g2.loteInterno, 'AK-2026-000801');
  assert.deepEqual(fr.linhas.map((l) => l.enderecoCodigo), ['GAL-01', 'GAL-02'], 'rota pelo endereço');
});

t('pedaço já separado (na fábrica) e posição bloqueada não são origem', () => {
  const plano = S.planejar(entradas([{opKey: 'longe', op: ops.longe}]), lotes, bloqueados, fefo, sk);
  const keys = plano[0].linhas.map((l) => l.loteKey);
  assert.equal(keys.includes('sep'), false);
  assert.equal(keys.includes('blq'), false);
});

t('material de cliente só vai para OP do próprio cliente, e antes do estoque Kuryos', () => {
  const plano = S.planejar(entradas([{opKey: 'a', op: ops.a}]), lotes, bloqueados, fefo, sk);
  const val = plano.find((m) => m.mpCodigo === 'VAL-1');
  assert.deepEqual(J(val.linhas.map((l) => [l.loteKey, l.qtd, l.doCliente])), [['cli', 300, 'MRAR'], ['kur', 150, null]]);
  assert.equal(val.faltante, 50, 'lote de outro cliente (SEUNO) nunca entra');
  const semCliente = S.planejar([{opKey: 'a', op: ops.a, clienteKey: null}], lotes, bloqueados, fefo, sk).find((m) => m.mpCodigo === 'VAL-1');
  assert.deepEqual(semCliente.linhas.map((l) => l.loteKey), ['kur'], 'sem cliente, lote de cliente fica de fora');
});

t('o que uma separação anterior já levou sai da necessidade', () => {
  const op = Object.assign({}, ops.a, {separacaoParcial: {itens: {'FR-1': 450, 'VAL-1': 500}}});
  assert.deepEqual(J(S.necessidadeRestante(op)), [{mpCodigo: 'FR-1', mpNome: 'FRASCO 200ML', unidade: 'un', quantidade: 50}]);
  assert.deepEqual(S.necessidadeRestante(ops.feita), []);
});

t('separador pegou menos na posição: a falta cai na OP de menor prioridade; a mais não tem dono', () => {
  const partes = [{opKey: 'a', prioridade: 2, qtd: 400}, {opKey: 'c', prioridade: 0, qtd: 100}, {opKey: 'b', prioridade: 1, qtd: 300}];
  assert.deepEqual(S.distribuir(partes, 350).map((p) => [p.opKey, p.qtd]), [['c', 100], ['b', 250], ['a', 0]]);
  assert.deepEqual(S.distribuir(partes, 9999).map((p) => p.qtd), [100, 300, 400]);
  assert.deepEqual(S.distribuir(partes, 0).map((p) => p.qtd), [0, 0, 0]);
  assert.equal(partes[0].qtd, 400, 'não altera o plano original');
});

console.log(`\n${n} testes ok`);
