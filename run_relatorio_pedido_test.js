'use strict';
/* Relatório de Pedido (2026-09-25): shared/relatorio-pedido.js sobre a
   ConciliacaoPedidos REAL. Itens do pedido pelo número exato, lotes por item,
   expedido/estoque iguais aos da conciliação, perdas por tipo (lançadas no
   apontamento vencem o Excel antigo; OP reemitida "-v2" herda a perda lançada
   no número do papel), linha "sem OP", CSV. */
const assert = require('node:assert/strict');
const C = require('./public/shared/conciliacao-pedidos.js');
const R = require('./public/shared/relatorio-pedido.js');
let n = 0;
function t(nome, fn) { fn(); n++; console.log('ok -', nome); }

const {base} = require('./run_relatorio_pedido_fixture.js');
const b = base();
const conc = C.calcular(b);
const rel = R.montar('0008', b, conc);

t('lista: um registro por número exato, cabeçalho comercial, mais recente em cima', () => {
  const l = R.listarPedidos(b.pedidos, b.pedidos_comerciais);
  assert.deepEqual(l.map((p) => p.id), ['0008', '05', '8'], '"8" e "0008" não se misturam');
  const p8 = l[0];
  assert.equal(p8.itens, 3);
  assert.equal(p8.abertos, 1, 'concluído e encerrado não contam como em aberto');
  assert.equal(p8.numeroCliente, 'PO-77');
});

t('itens do pedido e totais de produção', () => {
  assert.equal(rel.cliente, 'MISS ROSE');
  assert.deepEqual(rel.itens.map((i) => i.sku), ['MRARBS06', 'MRARBS07', 'MRARBS08']);
  const [a, bb, c] = rel.itens;
  assert.equal(a.aProduzir, 1000);
  assert.equal(a.atendidoPct, 90);
  assert.equal(bb.aProduzir, 0, 'produziu a mais: nada a produzir');
  assert.equal(c.aProduzir, 0, 'item encerrado não tem saldo a produzir');
  assert.equal(rel.totais.qtdPedido, 18000);
  assert.equal(rel.totais.produzido, 16700);
  assert.equal(rel.totais.aProduzir, 1000);
});

t('lotes por item: OP cancelada fora, produzido/expedido/estoque por lote', () => {
  const a = rel.itens[0];
  assert.deepEqual(a.lotes.map((l) => l.lote), ['26146/01', '26147/01']);
  const [l1, l2] = a.lotes;
  assert.equal(l1.expedido, 4800, 'carga cancelada não conta');
  assert.equal(l1.estoque, 200);
  assert.equal(l2.estoque, 3000);
  assert.equal(l1.linha, 'Linha 02');
  assert.equal(rel.totais.lotes, 4);
});

t('expedido e estoque do item são os da conciliação (mesma conta da tela de Pedidos)', () => {
  rel.itens.forEach((it) => {
    const r = conc.porPedido[it.key];
    assert.equal(it.expedido, r.expedido.total);
    assert.equal(it.estoque, r.estoque.total);
    assert.equal(it.situacao, r.situacao);
  });
  const mar = rel.itens[1];
  assert.equal(mar.expedido, 4900, 'devolução recebida estorna o expedido');
  assert.equal(mar.motivos.DEVOLVIDO, -100);
  assert.equal(rel.totais.expedido, 4800 + 4900 + 2500);
});

t('perdas: lançamentos do apontamento somam por tipo; "Outro" usa a especificação', () => {
  const l1 = rel.itens[0].lotes[0];
  assert.deepEqual(l1.perdas, {Frascos: 24, 'Rótulos': 5, 'Válvula': 2});
  assert.equal(l1.perdasTotal, 31);
  assert.equal(l1.perdaPct, 0.6);
  assert.deepEqual(rel.itens[0].lotes[1].perdas, {});
});

t('perdas: Excel antigo com rótulo legível; OP -v2 herda a perda do número do papel', () => {
  assert.deepEqual(rel.itens[2].perdas, {'Rótulos (envase)': 12, Cartuchos: 3});
  assert.deepEqual(rel.itens[1].perdas, {Cartuchos: 16});
  assert.deepEqual(rel.totais.perdas, {Frascos: 24, 'Rótulos': 5, 'Válvula': 2, Cartuchos: 19, 'Rótulos (envase)': 12});
  const feb = R.montar('05', b, conc);
  const [orig, v2] = feb.itens[0].lotes;
  assert.deepEqual(orig.perdas, {Frascos: 9});
  assert.deepEqual(v2.perdas, {}, 'lote original existe como OP: a perda não é duplicada na -v2');
});

t('produção e saída sem OP aparecem numa linha própria', () => {
  const c = rel.itens[2];
  assert.equal(c.semOp.produzido, 0);
  assert.equal(c.semOp.expedido, 2500, 'saída do legado sem OP');
  assert.equal(rel.itens[0].semOp.produzido, 1000, '9000 no pedido, 8000 nas OPs');
});

t('CSV: uma linha por lote, número com vírgula, colunas de perda por tipo', () => {
  const linhas = R.csv(rel).split('\r\n');
  assert.equal(linhas.length, 1 + 4);
  assert.match(linhas[0], /;Perda Cartuchos;Perda Frascos;Perda Rótulos;Perda Rótulos \(envase\);Perda Válvula;Perdas total lote;% perda s\/ produzido$/);
  assert.match(linhas[1], /^0008;MISS ROSE;MRARBS06;BODY SPLASH CEU;10000;9000;1000;4800;3200;26146\/01;Concluído;Linha 02;5000;5000;4800;200;0;24;5;0;2;31;0,6$/);
  assert.equal(R.montar('nao-existe', b, conc), null);
});

console.log(`\n${n} testes ok`);
