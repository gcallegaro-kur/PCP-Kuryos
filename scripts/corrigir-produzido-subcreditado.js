'use strict';
/* Sobe `pedidos/{k}.produzido` até a soma das OPs que apontam para ele, nos
 * pedidos em que a produção ficou SEM CRÉDITO nenhum.
 *
 * Achado de 14/10/2026 (tela de Pedidos: Produzido x Expedido x Estoque não
 * fechava): 0007__DPMTBS01/02/03 estavam 'Não Iniciado' com produzido 0, mas
 * as OPs deles (26159/01, 26160/02, 26168/02, P-26160/02, 26173/03, 26173/04)
 * estão Concluídas com 35.239 un. apontadas -- e a Expedição já despachou essas
 * mesmas unidades por OP. O crédito nunca chegou ao pedido.
 *
 * Critério estreito (só mexe quando TODOS valem):
 *   - produzido do pedido == 0 e soma das OPs (não canceladas) > 0;
 *   - sem `encerramento` (não é decisão humana, como a conciliação com o
 *     cliente de 16/09 que fixou números de propósito);
 *   - sem `apontamentosAplicados` (nenhum rastro por lote que contradiga);
 *   - sem statusManual e fora de 'Concluído' (concluído com zero é decisão
 *     antiga que não se desfaz sozinha: 0021__KUBPBA02);
 *   - nenhum lote das OPs já creditado por apontamento em OUTRO pedido --
 *     senão subir aqui contaria a mesma produção duas vezes (é o caso de
 *     PED-0008__MRARBS07, preso à pergunta aberta ao Comercial).
 * Os demais pedidos que divergem das OPs NÃO são tocados: ou foram fixados
 * com o cliente, ou precisam de confirmação do Comercial (ver AGENT_STATUS).
 *
 * Status: recalculado pela regra vigente (95% não conclui sozinho) --
 * 'Produção Parcial' enquanto não houver encerramento manual.
 *
 * Uso:  node scripts/corrigir-produzido-subcreditado.js            (ENSAIO)
 *       node scripts/corrigir-produzido-subcreditado.js --aplicar  (grava + backup)
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const admin = require(path.join(root, 'functions/node_modules/firebase-admin'));
admin.initializeApp({
  credential: admin.credential.cert(require(path.join(root, 'firebase-service-account.json'))),
  databaseURL: 'https://prod-kuryos-default-rtdb.firebaseio.com',
});
const db = admin.database();
const E = require(path.join(root, 'public/shared/expedicao.js'));
const APLICAR = process.argv.includes('--aplicar');
const f = (v) => (parseFloat(v) || 0).toLocaleString('pt-BR');

(async () => {
  console.log(APLICAR ? '*** APLICANDO ***' : '--- ENSAIO (nada é gravado) ---');
  const P = (await db.ref('pedidos').once('value')).val() || {};
  const O = (await db.ref('ops').once('value')).val() || {};
  const soma = {}, lotes = {};
  Object.entries(O).forEach(([k, o]) => {
    if (!o || o.status === 'Cancelado') return;
    const r = E.resolverChavePedido(P, o.skuPedidoKey || '');
    if (!P[r]) return;
    soma[r] = (soma[r] || 0) + (parseFloat(o.produzido) || 0);
    if (parseFloat(o.produzido) > 0) (lotes[r] = lotes[r] || []).push(o.lote || k);
  });
  const creditados = new Set();
  Object.values(P).forEach((p) => Object.values((p && p.apontamentosAplicados) || {}).forEach((v) => creditados.add(String(v.lote || ''))));
  const alvos = [];
  Object.entries(P).forEach(([k, p]) => {
    if (!p || (parseFloat(p.produzido) || 0) !== 0 || !(soma[k] > 0)) return;
    if (p.encerramento || p.statusManual || p.apontamentosAplicados || p.status === 'Concluído') return;
    if ((lotes[k] || []).some((l) => creditados.has(String(l)))) return;
    alvos.push({k, de: 0, para: soma[k], status: p.status, qtd: p.qtdTotal, lotes: lotes[k]});
  });
  alvos.forEach((a) => console.log(a.k + ': produzido 0 -> ' + f(a.para) + ' (' + a.status + ' -> Produção Parcial; qtd ' + f(a.qtd) + ')\n    lotes: ' + a.lotes.join(', ')));
  console.log('\n' + alvos.length + ' pedido(s), ' + f(alvos.reduce((t, a) => t + a.para, 0)) + ' un.');
  if (!APLICAR || !alvos.length) return process.exit(0);
  const bkp = path.join(root, 'backups', 'produzido-subcreditado-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(bkp, JSON.stringify(alvos.reduce((m, a) => (m[a.k] = {produzido: P[a.k].produzido, status: P[a.k].status}, m), {}), null, 1));
  console.log('backup:', bkp);
  const u = {}, agora = new Date().toISOString();
  alvos.forEach((a) => {
    u['pedidos/' + a.k + '/produzido'] = a.para;
    u['pedidos/' + a.k + '/status'] = 'Produção Parcial';
    u['pedidos/' + a.k + '/correcaoProduzidoOps'] = {em: agora, de: 0, para: a.para, lotes: a.lotes,
      motivo: 'Produção das OPs vinculadas nunca foi creditada ao pedido (auditoria de Pedidos 14/10/2026)'};
  });
  await db.ref().update(u);
  console.log('gravado.');
  process.exit(0);
})();
