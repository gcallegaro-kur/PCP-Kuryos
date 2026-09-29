const assert = require('assert');
const path = require('path');
const Q = require(path.join(__dirname, 'public', 'shared', 'qualidade-historico.js'));

const H = (s) => new Date(s + '-03:00').toISOString();
const materiais = {m1: {mpCodigo: 'MP-1', tipo: 'MPGR'}, m2: {mpCodigo: 'EP-9', tipo: 'EP'}};
const pedidosCompra = {pc1: {fornecedorKey: 'f1', fornecedorNome: 'QUÍMICA SUL'}, pc2: {fornecedorKey: 'f2', fornecedorNome: 'FRASCOS BR'}};
const rncs = {'RNC-2026-0007': {loteKey: 'l_mp2'}, 'RNC-2026-0009': {opLote: '26300/01'}};
const estoque = {
  'MP-1': {
    l_mp1: {itemCodigo: 'MP-1', itemNome: 'ÁLCOOL CEREAIS', itemTipo: 'material', status: 'LIBERADO', origemTipo: 'recebimento_pc', origemRef: 'pc1',
      recebimento: {recebidoEm: H('2026-09-21T08:00'), loteInterno: 'AK-1'},
      qualidade: {decisao: 'LIBERADO', inspecionadoEm: H('2026-09-21T14:00'), inspecionadoPor: 'Daiene',
        ensaios: {e1: {conforme: true}, e2: {conforme: true}}}},
    l_mp2: {itemCodigo: 'MP-1', itemNome: 'ÁLCOOL CEREAIS', status: 'REPROVADO', origemTipo: 'recebimento_pc', origemRef: 'pc1',
      recebimento: {recebidoEm: H('2026-09-22T08:00'), loteInterno: 'AK-2'},
      qualidade: {decisao: 'REPROVADO', inspecionadoEm: H('2026-09-24T08:00'), inspecionadoPor: 'Daiene', observacao: 'Odor fora',
        ensaios: {e1: {conforme: false}, e2: {conforme: true}}}},
    l_q: {itemCodigo: 'MP-1', status: 'QUARENTENA', dataRecebimento: '2026-09-25', criadoEm: H('2026-09-25T09:00')}
  },
  'EP-9': {
    l_ep: {itemCodigo: 'EP-9', itemNome: 'FRASCO 200ML', status: 'APROVADO_CONCESSAO', origemTipo: 'recebimento_pc', origemRef: 'pc2',
      recebimento: {recebidoEm: H('2026-09-22T10:00')},
      qualidade: {decisao: 'APROVADO_CONCESSAO', inspecionadoEm: H('2026-09-22T16:00'), inspecionadoPor: 'Lia', autorizadoPor: 'Gustavo'}}
  },
  'SKU1': {
    pa1: {itemCodigo: 'SKU1', itemNome: 'BODY SPLASH', itemTipo: 'produto', cliente: 'MISS RÔSE', status: 'LIBERADO_EXPEDICAO', loteOrigem: '26300/01', opKey: '26300-01',
      conferencia: {conferidoEm: H('2026-09-23T10:00')},
      qualidade: {decisao: 'LIBERADO_EXPEDICAO', inspecionadoEm: H('2026-09-23T12:00'), inspecionadoPor: 'Daiene',
        ck7: {criticosNC: 0, pesagem: {conforme: true}}}},
    pa2: {itemCodigo: 'SKU1', itemTipo: 'produto', status: 'RETIDO', loteOrigem: '26300/02',
      conferencia: {conferidoEm: H('2026-09-24T10:00')},
      qualidade: {decisao: 'RETIDO', inspecionadoEm: H('2026-09-24T11:00'), inspecionadoPor: 'Lia',
        ck7: {criticosNC: 1, pesagem: {conforme: false}}}},
    pa3: {itemCodigo: 'SKU1', itemTipo: 'produto', status: 'QUARENTENA', conferencia: {conferidoEm: H('2026-09-26T10:00')}}
  }
};
const ops = {
  '26300-01': {lote: '26300/01', sku: 'SKU1', produto: 'BODY SPLASH', cliente: 'MISS RÔSE', manipulacao: {
    ciclo: 2, status: 'LIBERADO', correcao: {rncNumero: 'RNC-2026-0009'},
    manipulacao: {fim: H('2026-09-23T09:00')}, analise: {decisao: 'LIBERADO', por: 'Daiene', em: H('2026-09-23T10:00')},
    historico: {c1: {manipulacao: {fim: H('2026-09-22T09:00')}, analise: {decisao: 'REPROVADO', por: 'Daiene', em: H('2026-09-22T11:00'),
      ensaios: {a: {conforme: false}}}}}}},
  '26300-02': {lote: '26300/02', sku: 'SKU2', manipulacao: {status: 'LIBERADO',
    manipulacao: {fim: H('2026-09-24T08:00')}, analise: {decisao: 'LIBERADO', por: 'Lia', em: H('2026-09-24T09:30')}}},
  '26300-03': {lote: '26300/03', manipulacao: {status: 'AGUARDANDO_CQ', manipulacao: {fim: H('2026-09-27T08:00')}}},
  '26300-04': {lote: '26300/04'}
};
const ctx = {materiais, pedidosCompra, rncs};

// ── Coleta: cada decisão vira uma análise, lida de onde mora ────────────
const A = Q.coletar(estoque, ops, ctx);
const por = (id) => A.find((x) => x.id === id);
{
  // 2 MP + 1 embalagem + 2 PA + bulk: 26300/01 com 2 ciclos (reprovado e corrigido) + 26300/02.
  assert.strictEqual(A.length, 8);
  assert.deepStrictEqual(A.map((x) => x.tipo).sort(), ['bulk', 'bulk', 'bulk', 'embalagem', 'mp', 'mp', 'pa', 'pa']);
  assert.ok(A.every((x, i) => i === 0 || A[i - 1].em >= x.em), 'mais recente primeiro');

  const mp2 = por('MP-1/l_mp2');
  assert.strictEqual(mp2.resultado, 'REPROVADO');
  assert.strictEqual(mp2.origem, 'QUÍMICA SUL', 'fornecedor vem do pedido de compra');
  assert.strictEqual(mp2.lote, 'AK-2');
  assert.strictEqual(mp2.leadHoras, 48, 'recebido 22/09 08h, decidido 24/09 08h');
  assert.strictEqual(mp2.ensaiosNc, 1);
  assert.strictEqual(mp2.rnc, 'RNC-2026-0007');
  assert.strictEqual(por('EP-9/l_ep').tipo, 'embalagem', 'EP no cadastro = embalagem');
  assert.strictEqual(por('EP-9/l_ep').resultado, 'CONCESSAO');
  assert.strictEqual(por('EP-9/l_ep').autorizadoPor, 'Gustavo');
  assert.strictEqual(por('SKU1/pa1').resultado, 'APROVADO', 'LIBERADO_EXPEDICAO é aprovação');
  assert.strictEqual(por('SKU1/pa1').origem, 'MISS RÔSE', 'palete: origem é o cliente');
  assert.strictEqual(por('SKU1/pa1').leadHoras, 2, 'da conferência do palete ao laudo');
  assert.strictEqual(por('SKU1/pa2').pesoForaPa, true);
  assert.strictEqual(por('SKU1/pa2').criticosNc, 1);
  // Bulk: a reprovação que abriu a correção também é análise.
  const c1 = por('26300-01#c1'), c2 = por('26300-01#c2');
  assert.strictEqual(c1.resultado, 'REPROVADO');
  assert.strictEqual(c1.leadHoras, 2);
  assert.strictEqual(c2.resultado, 'APROVADO');
  assert.strictEqual(c2.rnc, 'RNC-2026-0009');
  assert.strictEqual(A.some((x) => x.loteKey === 'l_q' || x.loteKey === 'pa3'), false, 'quarentena não é análise decidida');
}

// ── Pendentes: o que espera a Qualidade agora, por tipo ─────────────────
{
  const p = Q.pendentes(estoque, ops, ctx, new Date(H('2026-09-29T09:00')));
  assert.strictEqual(p.mp.qtd, 1);
  assert.strictEqual(Math.round(p.mp.maisAntigoDias), 4, 'desde a data de recebimento 25/09');
  assert.strictEqual(p.pa.qtd, 1);
  assert.strictEqual(p.bulk.qtd, 1, 'bulk AGUARDANDO_CQ');
  assert.strictEqual(Math.round(p.bulk.maisAntigoDias * 24), 49);
  assert.strictEqual(p.embalagem.qtd, 0);
  assert.strictEqual(p.embalagem.maisAntigoDias, null);
}

// ── KPIs ───────────────────────────────────────────────────────────────
{
  const k = Q.kpis(A, {ate: new Date(H('2026-09-29T09:00')).getTime(), semanas: 2});
  assert.strictEqual(k.geral.total, 8);
  assert.strictEqual(k.geral.APROVADO, 4);
  assert.strictEqual(k.geral.CONCESSAO, 1);
  assert.strictEqual(k.geral.REPROVADO, 2);
  assert.strictEqual(k.geral.RETIDO, 1);
  assert.strictEqual(k.geral.taxaAprovacao, 5 / 8);
  assert.strictEqual(k.porTipo.mp.taxaReprovacao, 0.5);
  assert.strictEqual(k.porTipo.mp.leadMedianaH, 27, 'mediana de 6 h e 48 h');
  // Bulk na 1ª análise: 26300/01 reprovou no ciclo 1, 26300/02 passou → 50%.
  assert.strictEqual(k.opsBulk, 2);
  assert.strictEqual(k.primeiraPassagemBulk, 0.5);
  assert.deepStrictEqual(k.fornecedores.map((f) => [f.nome, f.total, f.reprovados, f.concessoes]),
    [['QUÍMICA SUL', 2, 1, 0], ['FRASCOS BR', 1, 0, 1]]);
  assert.strictEqual(k.fornecedores[0].taxaReprovacao, 0.5);
  assert.deepStrictEqual(k.analistas[0], {nome: 'Daiene', total: 5});
  assert.strictEqual(k.paletesPesados, 2);
  assert.strictEqual(k.pesoForaPa, 1);
  assert.strictEqual(k.criticosPa, 1);
  assert.strictEqual(k.comRnc, 3, 'MP reprovada + os dois ciclos da 26300/01 (mesma RNC)');
  // Série semanal: 21–27/09 tem as 8 análises; a semana corrente (28/09) nenhuma.
  assert.strictEqual(k.semanas.length, 2);
  assert.strictEqual(k.semanas[0].total, 8);
  assert.strictEqual(k.semanas[1].total, 0);
  assert.strictEqual(new Date(k.semanas[1].inicio).getDay(), 1, 'semana começa na segunda');
  // Filtro por tipo e período.
  const soPa = Q.kpis(A, {tipo: 'pa'});
  assert.strictEqual(soPa.geral.total, 2);
  assert.strictEqual(soPa.fornecedores.length, 0);
  const desde24 = Q.kpis(A, {desde: new Date(H('2026-09-24T00:00')).getTime()});
  assert.strictEqual(desde24.geral.total, 3, 'MP reprovada, palete retido, bulk 26300/02');
  const vazio = Q.kpis([], {});
  assert.strictEqual(vazio.geral.taxaAprovacao, null, 'sem análise não inventa 0%');
  assert.strictEqual(vazio.primeiraPassagemBulk, null);
}

// ── Busca do histórico ─────────────────────────────────────────────────
{
  assert.deepStrictEqual(Q.filtrar(A, {busca: 'alcool sul'}).map((x) => x.id).sort(), ['MP-1/l_mp1', 'MP-1/l_mp2'], 'sem acento, todos os termos');
  assert.deepStrictEqual(Q.filtrar(A, {busca: 'rnc-2026-0007'}).map((x) => x.id), ['MP-1/l_mp2']);
  assert.strictEqual(Q.filtrar(A, {busca: 'odor'}).length, 1, 'observação também é buscada');
  assert.strictEqual(Q.filtrar(A, {resultado: 'REPROVADO'}).length, 2);
  assert.strictEqual(Q.filtrar(A, {tipo: 'bulk', busca: '26300/01'}).length, 2);
  assert.strictEqual(Q.filtrar(A, {busca: 'lia'}).length, 3);
}

// ── Utilitários ────────────────────────────────────────────────────────
assert.strictEqual(Q.quantil([10, 1, 5], 0.5), 5);
assert.strictEqual(Q.quantil([], 0.5), null);
assert.strictEqual(Q.resultadoDe('LIBERADO_EXPEDICAO'), 'APROVADO');
assert.strictEqual(Q.resultadoDe('QUARENTENA'), null);

console.log('run_qualidade_historico_test.js: OK');
