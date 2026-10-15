'use strict';
/* Lista de decisão do PCP: pedidos abertos ("Pedem ação") SEM nada rodando.
 *
 *  - PARADOS: têm OP(s), todas concluídas/canceladas, e o pedido não chegou na
 *    quantidade -- precisa de nova OP para o saldo ou de encerramento com motivo.
 *  - SEM OP: pedido liberado e nenhuma OP emitida -- precisa emitir OP.
 *
 * SOMENTE LEITURA. Uso: node scripts/listar-pedidos-parados.js > lista.md */
const path = require('path');
const root = path.resolve(__dirname, '..');
const admin = require(path.join(root, 'functions/node_modules/firebase-admin'));
admin.initializeApp({
  credential: admin.credential.cert(require(path.join(root, 'firebase-service-account.json'))),
  databaseURL: 'https://prod-kuryos-default-rtdb.firebaseio.com',
});
const E = require(path.join(root, 'public/shared/expedicao.js'));
const C = require(path.join(root, 'public/shared/conciliacao-pedidos.js'));
const EP = require(path.join(root, 'public/shared/encerramento-pedido.js'));
const f = (v) => (parseFloat(v) || 0).toLocaleString('pt-BR');

(async () => {
  const base = {};
  for (const n of ['pedidos', 'ops', 'estoque_lotes', 'expedicoes_comerciais', 'devolucoes_cliente', 'solicitacoes_descarte', 'conferencias_pa']) {
    base[n] = (await admin.database().ref(n).once('value')).val() || {};
  }
  const P = base.pedidos, O = base.ops, conc = C.calcular(base).porPedido;
  const opsDe = {};
  Object.entries(O).forEach(([k, o]) => {
    if (!o || o.status === 'Cancelado') return;
    const r = E.resolverChavePedido(P, o.skuPedidoKey || '');
    if (P[r]) (opsDe[r] = opsDe[r] || []).push(o);
  });
  const parados = [], semOp = [];
  Object.keys(P).forEach((k) => {
    const p = P[k], st = EP.situacao(Object.assign({_key: k}, p));
    if (st !== 'andamento' && st !== 'pronto') return;
    const ops = opsDe[k] || [], c = conc[k];
    const linha = {k, cliente: p.cliente || '', produto: p.produto || '', qtd: +p.qtdTotal || 0, prod: +p.produzido || 0,
      exp: c ? c.expedido.total : 0, est: c ? c.estoque.total : 0, nOps: ops.length, status: p.status};
    linha.saldo = Math.max(linha.qtd - linha.prod, 0);
    linha.pct = linha.qtd ? Math.round(linha.prod / linha.qtd * 100) : 0;
    if (!ops.length) semOp.push(linha);
    else if (ops.every((o) => o.status === 'Concluído')) parados.push(linha);
  });
  parados.sort((a, b) => b.saldo - a.saldo);
  semOp.sort((a, b) => a.cliente.localeCompare(b.cliente) || a.k.localeCompare(b.k));
  const sugestao = (l) => l.pct >= 95 ? 'encerrar (já ' + l.pct + '%)' : l.pct >= 85 ? 'encerrar ou OP curta' : 'nova OP para o saldo';
  console.log('# Pedidos abertos sem nada rodando — decisão do PCP\n');
  console.log('Gerado em ' + new Date().toISOString().slice(0, 10) + ' a partir da base de produção.\n');
  console.log('## A. Parados com saldo (' + parados.length + ')\nTodas as OPs estão concluídas e o pedido não chegou na quantidade.\n');
  console.log('| Pedido | Cliente | Produto | Pedido | Produzido | % | Saldo | Expedido | Em estoque | Sugestão |\n|---|---|---|--:|--:|--:|--:|--:|--:|---|');
  parados.forEach((l) => console.log('| ' + [l.k, l.cliente, l.produto, f(l.qtd), f(l.prod), l.pct + '%', f(l.saldo), f(l.exp), f(l.est), sugestao(l)].join(' | ') + ' |'));
  console.log('\n## B. Sem nenhuma OP emitida (' + semOp.length + ')\nPrecisa de OP e de data de entrega do PCP.\n');
  console.log('| Pedido | Cliente | Produto | Pedido | Produzido | Situação |\n|---|---|---|--:|--:|---|');
  semOp.forEach((l) => console.log('| ' + [l.k, l.cliente, l.produto, f(l.qtd), f(l.prod), l.prod > 0 ? 'tem produzido sem OP (legado/manual)' : l.status].join(' | ') + ' |'));
  process.exit(0);
})();
