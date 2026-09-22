/* Gestão de retrabalhos: o que a tela mostra e o que ela diz para fazer.

   O caso real por trás destes dados é o RT-26216-04-20260921 (PERFUME TAWUS
   30ML, lote inteiro, sedimentação do corante), que nasceu com a quantidade
   do período PENDENTE -- e foi exatamente essa pendência que fez o botão de
   encerrar sumir da tela sem explicação. Por isso a maior parte das
   asserções aqui é sobre a FRASE que o sistema mostra, não sobre número:
   era a frase que faltava. */
const assert = require('node:assert/strict');
const G = require('./public/shared/retrabalhos-gestao.js');

function caso(extra) {
  return Object.assign({
    id: 'RT-26216-04-20260921',
    loteOriginal: '26216/04', produto: 'PERFUME TAWUS 30ML', cliente: 'DAPOP',
    linha: 'Linha 2', escopo: 'Lote inteiro',
    motivo: 'Sedimentação inesperada do corante, formando precipitado.',
    quantidadeOriginalRegistrada: 867, status: 'pausado', revisao: 1,
    criadoEm: '2026-09-22T01:00:00.000Z',
    setupInicio: '2026-09-21T18:42:00.000Z', setupFim: '2026-09-21T19:00:00.000Z',
    envaseInicio: '2026-09-21T19:00:00.000Z', inicioParada: '2026-09-21T20:09:00.000Z',
    apontamentos: {
      'envase-20260921': {inicio: '2026-09-21T19:00:00.000Z', fim: '2026-09-21T20:09:00.000Z',
        linha: 'Linha 2', etapa: 'envase', quantidadePendente: true},
    },
  }, extra || {});
}
const conferido = (q) => ({apontamentos: {'envase-20260921': {
  inicio: '2026-09-21T19:00:00.000Z', fim: '2026-09-21T20:09:00.000Z', linha: 'Linha 2',
  etapa: 'envase', quantidade: q, operador: 'João'}}});

// ── 1. Quantidade pendente: a tela DIZ o que falta ───────────────────
// Antes, o botão "Encerrar execução" simplesmente não era renderizado.
let p = G.proximoPasso(caso(), 'admin');
assert.match(p.titulo, /Falta conferir a quantidade de 1 apontamento/);
assert.equal(p.bloqueio, 'encerrar', 'a tela sabe QUAL botão está travado');
assert.equal(p.acao, 'corrigir_quantidade', 'e qual é o passo que destrava');
assert.match(p.detalhe, /quantidade pendente é diferente de zero/i);
// Quem não é admin não pode corrigir -- a frase muda, o bloqueio continua.
p = G.proximoPasso(caso(), 'production');
assert.equal(p.acao, null);
assert.equal(p.bloqueio, 'encerrar');
assert.match(p.detalhe, /administrador precisa informar/i);
// Plural quando há mais de um período pendente.
const doisPendentes = caso({apontamentos: {
  a: {inicio: '2026-09-21T19:00:00.000Z', fim: '2026-09-21T20:09:00.000Z', quantidadePendente: true},
  b: {inicio: '2026-09-22T12:00:00.000Z', fim: '2026-09-22T13:00:00.000Z', quantidadePendente: true}}});
assert.match(G.proximoPasso(doisPendentes, 'admin').titulo, /2 apontamentos/);

// ── 2. Sem pendência, o encerramento libera ──────────────────────────
p = G.proximoPasso(caso(conferido(400)), 'admin');
assert.equal(p.acao, 'finalizar');
assert.ok(!p.bloqueio, 'nada mais trava');
assert.match(p.detalhe, /libera a linha/);

// ── 3. Aguardando Qualidade: aqui morria o caso ──────────────────────
// Depois de finalizar, o registro ficava em aguardando_qualidade para
// sempre -- não existia passo de avaliação.
const aguardando = caso(Object.assign({status: 'aguardando_qualidade',
  encerradoEm: '2026-09-22T14:00:00.000Z'}, conferido(400)));
p = G.proximoPasso(aguardando, 'qualidade');
assert.equal(p.acao, 'decidir');
assert.match(p.titulo, /sua avaliação/i);
assert.match(p.detalhe, /não libera estoque/i, 'a tela avisa que decidir não é liberar lote');
p = G.proximoPasso(aguardando, 'admin');
assert.equal(p.acao, 'decidir', 'admin também decide');
p = G.proximoPasso(aguardando, 'production');
assert.equal(p.acao, null, 'quem executa não decide');
assert.equal(p.bloqueio, 'decidir');

// ── 4. Estados terminais ─────────────────────────────────────────────
assert.equal(G.aberto(caso()), true);
assert.equal(G.aberto(caso({status: 'liberado'})), false);
assert.equal(G.aberto(caso({status: 'reprovado'})), false);
assert.match(G.proximoPasso(caso({status: 'liberado'}), 'admin').titulo, /aprovado/);
assert.match(G.proximoPasso(caso({status: 'reprovado'}), 'admin').titulo, /reprovado/);
// Status fora do previsto não vira "tudo certo" em silêncio.
assert.match(G.proximoPasso(caso({status: 'coisa_estranha'}), 'admin').titulo, /não reconhecida/);

// ── 5. Quantidade: pendente NÃO é zero ───────────────────────────────
assert.equal(G.confirmado(caso()), 0, 'pendente não entra na soma');
assert.equal(G.pendentes(caso()).length, 1, 'mas continua contando como pendência');
assert.equal(G.confirmado(caso(conferido(400))), 400);
assert.equal(G.pendentes(caso(conferido(400))).length, 0);
// Tempo de execução vem dos períodos apontados, não do relógio de parede.
assert.equal(G.minutosExecutados(caso()), 69, '19:00 → 20:09');

// ── 6. Linha do tempo: a história do caso em ordem ───────────────────
const tl = G.linhaDoTempo(caso(Object.assign({status: 'aguardando_qualidade',
  encerradoEm: '2026-09-22T14:00:00.000Z',
  decisoes: {d1: {decisao: 'liberado', analise: 'Aspecto conforme após filtração',
    responsavel: 'Mario Callegaro', em: '2026-09-22T16:00:00.000Z'}}}, conferido(400))));
const titulos = tl.map((i) => i.titulo);
assert.ok(titulos.some((x) => /Caso aberto/.test(x)));
assert.ok(titulos.some((x) => /Início do setup/.test(x)));
assert.ok(titulos.some((x) => /Período apontado — 400 un\./.test(x)));
assert.ok(titulos.some((x) => /Execução encerrada/.test(x)));
assert.ok(titulos.some((x) => /Avaliação: Retrabalho aprovado/.test(x)));
for (let i = 1; i < tl.length; i++) {
  assert.ok(tl[i - 1].quando <= tl[i].quando, 'linha do tempo fora de ordem');
}
// Período pendente aparece como pendente, não como zero unidades.
assert.ok(G.linhaDoTempo(caso()).some((i) => /quantidade pendente/.test(i.titulo)));

// ── 7. Lista: aberto antes de encerrado, recente antes de antigo ─────
const itens = G.lista({
  a: caso({id: 'a', status: 'liberado', atualizadoEm: '2026-09-22T18:00:00.000Z'}),
  b: caso({id: 'b', status: 'pausado', atualizadoEm: '2026-09-22T10:00:00.000Z'}),
  c: caso({id: 'c', status: 'aguardando_qualidade', atualizadoEm: '2026-09-22T12:00:00.000Z'}),
}, 'admin');
assert.deepEqual(itens.map((r) => r.id), ['c', 'b', 'a'],
  'o que ainda cobra ação vem primeiro, mesmo sendo mais antigo');

// ── 8. Filtro e contadores ───────────────────────────────────────────
assert.equal(G.filtrar(itens, {status: 'abertos'}).length, 2);
assert.equal(G.filtrar(itens, {status: 'encerrados'}).length, 1);
assert.equal(G.filtrar(itens, {status: 'aguardando_qualidade'}).length, 1);
assert.equal(G.filtrar(itens, {busca: 'tawus'}).length, 3, 'busca não diferencia maiúscula');
assert.equal(G.filtrar(itens, {busca: '26216/04'}).length, 3, 'acha pelo lote');
assert.equal(G.filtrar(itens, {busca: 'nada disso'}).length, 0);
const c = G.contadores(itens);
assert.equal(c.total, 3);
assert.equal(c.abertos, 2);
assert.equal(c.aguardandoQualidade, 1);
assert.equal(c.comQuantidadePendente, 3, 'os três casos deste teste têm período pendente');

// ── 9. Nada explode com registro incompleto ──────────────────────────
assert.doesNotThrow(() => G.resumo({}, 'admin'));
assert.doesNotThrow(() => G.linhaDoTempo({}));
assert.doesNotThrow(() => G.lista(null, 'admin'));
assert.equal(G.contadores(null).total, 0);

console.log('run_retrabalhos_gestao_test: OK');
