/* A decisão da Qualidade sobre um retrabalho (functions/retrabalhos.js).

   Antes desta ação o caso parava em `aguardando_qualidade` e ficava ali para
   sempre: a execução acabava e nada registrava se o retrabalho tinha
   resolvido. Era metade do que o usuário chamou de "não deu pra acompanhar
   bem" (22/09).

   Três coisas que este teste protege, e que são decisão de projeto, não
   detalhe:
   - quem APONTA não é quem DECIDE;
   - decidir NÃO libera estoque nem mexe no lote — é registro;
   - "precisa de nova etapa" devolve o caso à linha de verdade, senão seria
     só um rótulo e o caso morreria num status sem saída. */
const assert = require('node:assert/strict');
const R = require('./functions/retrabalhos.js');

const AGORA = '2026-09-22T18:00:00.000Z';
let seq = 0;
const opId = () => 'op_teste_' + (++seq) + '_aaaaaaaaaaaa';

function base(extra) {
  return Object.assign({
    usuarios: {
      adm: {nome: 'Gustavo', role: 'admin'},
      cq: {nome: 'Daiene', role: 'qualidade'},
      op: {nome: 'João', role: 'production'},
      pcp: {nome: 'Ana', role: 'pcp'},
    },
    ops: {'26216-04': {lote: '26216/04', status: 'Concluído', produzidoLinha: 867}},
    estado_linhas: {Linha_2: {status: 'ativa'}},
    retrabalhos_linhas: {},
    retrabalhos: {
      RT1: {
        id: 'RT1', loteOriginal: '26216/04', produto: 'PERFUME TAWUS 30ML', linha: 'Linha 2',
        escopo: 'Lote inteiro', quantidadeOriginalRegistrada: 867,
        status: 'aguardando_qualidade', revisao: 3, encerradoEm: '2026-09-22T14:00:00.000Z',
        apontamentos: {a1: {inicio: '2026-09-21T19:00:00.000Z', fim: '2026-09-21T20:09:00.000Z',
          linha: 'Linha 2', etapa: 'envase', quantidade: 400}},
        quantidadeConfirmada: 400, apontamentosPendentes: 0,
      },
    },
  }, extra || {});
}
const decidir = (b, uid, d) => R.executar(b, Object.assign({retrabalhoId: 'RT1', revisao: b.retrabalhos.RT1.revisao,
  acao: 'decidir', operacaoId: opId()}, d), uid, AGORA);

// ── 1. Quem executa não decide ───────────────────────────────────────
assert.throws(() => decidir(base(), 'op', {decisao: 'liberado', analise: 'ok'}),
  /Somente a Qualidade/, 'produção aponta, não decide');
assert.throws(() => decidir(base(), 'pcp', {decisao: 'liberado', analise: 'ok'}),
  /Somente a Qualidade/, 'PCP programa, não atesta qualidade');
// Qualidade e admin decidem.
assert.doesNotThrow(() => decidir(base(), 'cq', {decisao: 'liberado', analise: 'Aspecto conforme'}));
assert.doesNotThrow(() => decidir(base(), 'adm', {decisao: 'liberado', analise: 'Aspecto conforme'}));

// ── 2. A Qualidade continua sem poder apontar execução ───────────────
assert.throws(() => R.executar(base(), {retrabalhoId: 'RT1', revisao: 3, acao: 'retomar', operacaoId: opId()}, 'cq'),
  /não pode apontar retrabalho/, 'o papel novo não ganhou poder de execução');

// ── 3. Só decide execução encerrada ──────────────────────────────────
['pausado', 'em_andamento', 'liberado', 'reprovado'].forEach(function(st) {
  const b = base();
  b.retrabalhos.RT1.status = st;
  assert.throws(() => decidir(b, 'cq', {decisao: 'liberado', analise: 'ok'}),
    /aguardando a Qualidade/, 'não decide em ' + st);
});

// ── 4. Análise é obrigatória; decisão inventada não passa ────────────
assert.throws(() => decidir(base(), 'cq', {decisao: 'liberado', analise: '   '}),
  /Registre a análise/);
assert.throws(() => decidir(base(), 'cq', {decisao: 'talvez', analise: 'ok'}),
  /Decisão inválida/);

// ── 5. Liberado: fecha o caso e guarda quem, quando e por quê ────────
let b = base();
let rt = decidir(b, 'cq', {decisao: 'liberado', analise: 'Reinspeção conforme após filtração', motivo: 'Lote liberado'});
assert.equal(rt.status, 'liberado');
assert.equal(rt.decisaoAtual.decisao, 'liberado');
assert.equal(rt.decisaoAtual.responsavel, 'Daiene');
assert.equal(rt.decididoEm, AGORA);
const dec = Object.values(rt.decisoes)[0];
assert.equal(dec.analise, 'Reinspeção conforme após filtração');
assert.equal(dec.uid, 'cq');
// Decidir NÃO é liberar lote: nada de estoque, lote ou RNC foi tocado.
assert.deepEqual(Object.keys(b), Object.keys(base()), 'nenhum nó novo na base');
assert.equal(b.ops['26216-04'].status, 'Concluído', 'a OP original não é mexida');
assert.equal(b.ops['26216-04'].produzidoLinha, 867, 'produção original intacta');
assert.deepEqual(b.retrabalhos_linhas, {}, 'a linha continua livre');

// ── 6. Reprovado também encerra ──────────────────────────────────────
b = base();
rt = decidir(b, 'cq', {decisao: 'reprovado', analise: 'Precipitado persiste'});
assert.equal(rt.status, 'reprovado');
assert.equal(rt.decididoEm, AGORA);
assert.deepEqual(b.retrabalhos_linhas, {}, 'reprovar não reocupa linha');

// ── 7. Nova etapa devolve o caso à linha, de verdade ─────────────────
// Sem isto "precisa de nova etapa" seria só um rótulo: o caso ficaria num
// status sem saída, que é o defeito que esta entrega corrige.
b = base();
rt = decidir(b, 'cq', {decisao: 'nova_etapa', analise: 'Falta repassar metade do lote'});
assert.equal(rt.status, 'pausado', 'volta para execução');
assert.equal(b.retrabalhos_linhas['Linha 2'], 'RT1', 'a linha é reservada de novo');
assert.equal(b.estado_linhas.Linha_2.retrabalhoId, 'RT1');
assert.equal(b.estado_linhas.Linha_2.status, 'parada');
assert.equal(b.estado_linhas.Linha_2.inicioParada, AGORA);
assert.ok(!rt.encerradoEm, 'não é mais um caso encerrado');
assert.equal(rt.decididoEm, undefined, 'nova etapa não é decisão final');
assert.equal(Object.values(rt.decisoes)[0].decisao, 'nova_etapa', 'mas fica no histórico');

// ── 8. Nova etapa não atropela a linha ocupada ───────────────────────
b = base();
b.ops['26300-01'] = {lote: '26300/01', status: 'Em Produção', abertaDesde: AGORA, abertaLinha: 'Linha 2'};
assert.throws(() => decidir(b, 'cq', {decisao: 'nova_etapa', analise: 'x'}),
  /está com uma OP aberta/, 'não empurra OP de produção para fora');
b = base();
b.retrabalhos_linhas['Linha 2'] = 'RT-OUTRO';
assert.throws(() => decidir(b, 'cq', {decisao: 'nova_etapa', analise: 'x'}),
  /já está reservada/, 'nem atropela outro retrabalho');

// ── 9. Retry não duplica a decisão ───────────────────────────────────
b = base();
const mesmaOp = opId();
const pedido = {retrabalhoId: 'RT1', revisao: 3, acao: 'decidir', decisao: 'liberado',
  analise: 'Conforme', operacaoId: mesmaOp};
R.executar(b, pedido, 'cq', AGORA);
const depois = R.executar(b, pedido, 'cq', AGORA);
assert.equal(Object.keys(depois.decisoes).length, 1, 'a mesma operação não grava duas decisões');

// ── 10. Caso decidido não aceita mais correção de apontamento ────────
b = base();
decidir(b, 'cq', {decisao: 'liberado', analise: 'ok'});
assert.throws(() => R.executar(b, {retrabalhoId: 'RT1', revisao: b.retrabalhos.RT1.revisao,
  acao: 'corrigir_quantidade', apontamentoId: 'a1', quantidade: 999, motivo: 'x', operacaoId: opId()}, 'adm', AGORA),
  /já decidido/, 'não se reescreve quantidade depois do laudo da Qualidade');

console.log('run_retrabalhos_decisao_test: OK');
