'use strict';
/* Alinha `ops/{lote}.produzido` (e produzidoLinha) à soma dos apontamentos de
 * ENVASE vivos do lote, nas OPs que o fluxo antigo de "apontamento por total"
 * deixou dessincronizadas.
 *
 * CAUSA (provada na base em 14/10/2026): até 04/09 o apontamento por total
 * gravava no REGISTRO a quantidade do período e na OP o "total acumulado"
 * digitado pelo operador (qtdTotalOP) -- dois números diferentes para o mesmo
 * fato. Quando o total digitado estava errado (OPs 26237/03, 26239/02,
 * 26239/04 e 26237/17 ficaram com produzido = 2) a OP divergiu do registro, e
 * o pedido (que soma o registro) divergiu da OP. O pedido 0019__GLMKAM04 fecha
 * EXATAMENTE com a soma dos registros (15.624), não com a das OPs. Depois de
 * 04/09 (quando o delta passou a ser confirmado dentro da transaction,
 * `qtdIncrementoConfirmado`) não há mais divergência: 1 un. em 1.350 lotes.
 *
 * Os registros são o lançamento primário (somarRegistrosDoLote, utils.js); o
 * total da OP é derivado. Regra: adota-se a soma dos registros quando ela
 * não passa de 110% da quantidade planejada da OP. Acima disso o número é
 * improvável e fica só relatado (ex.: 26211/02, 7.582 para 1.950 planejadas).
 *
 * Uso:  node scripts/corrigir-op-produzido-pelos-registros.js            (ENSAIO)
 *       node scripts/corrigir-op-produzido-pelos-registros.js --aplicar  (grava + backup)
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
const APLICAR = process.argv.includes('--aplicar');
const f = (v) => (parseFloat(v) || 0).toLocaleString('pt-BR');
const chave = (l) => String(l).trim().replace(/[./[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60);

(async () => {
  console.log(APLICAR ? '*** APLICANDO ***' : '--- ENSAIO (nada é gravado) ---');
  const O = (await db.ref('ops').once('value')).val() || {};
  const R = (await db.ref('registros').once('value')).val() || {};
  const C = (await db.ref('config').once('value')).val() || {};
  const naoEnvase = new Set([].concat(C.rotulagem || [], C.postos || []));
  const soma = {};
  Object.keys(R).forEach((d) => Object.values(R[d] || {}).forEach((r) => {
    if (!r || !r.lote || naoEnvase.has(r.linha)) return;
    soma[r.lote] = (soma[r.lote] || 0) + (parseFloat(r.quantidade) || 0);
  }));
  const aplicar = [], deixar = [];
  Object.keys(soma).forEach((lote) => {
    const op = O[chave(lote)];
    if (!op || op.status === 'Cancelado') return;
    const atual = parseFloat(op.produzidoLinha != null ? op.produzidoLinha : op.produzido) || 0;
    const alvo = Math.round(soma[lote] * 1000) / 1000;
    if (Math.abs(atual - alvo) < 1) return;                    // 1 un. de arredondamento fica
    const plan = parseFloat(op.qtdPlanejada) || 0;
    const linha = {lote, key: chave(lote), de: atual, para: alvo, plan, pedido: op.skuPedidoKey};
    (plan > 0 && alvo <= plan * 1.1 ? aplicar : deixar).push(linha);
  });
  const pr = (a) => a.sort((x, y) => Math.abs(y.para - y.de) - Math.abs(x.para - x.de))
    .forEach((x) => console.log('  ' + x.lote.padEnd(12) + ' OP ' + f(x.de).padStart(7) + ' -> ' + f(x.para).padStart(7) + '  (plan ' + f(x.plan) + ')  ' + x.pedido));
  console.log('\nA ALINHAR: ' + aplicar.length + ' OPs'); pr(aplicar);
  console.log('\nSÓ RELATADO (registros passam de 110% do planejado): ' + deixar.length + ' OPs'); pr(deixar);
  if (!APLICAR || !aplicar.length) return process.exit(0);
  const bkp = path.join(root, 'backups', 'op-produzido-registros-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(bkp, JSON.stringify(aplicar.reduce((m, x) => (m[x.key] = {produzido: O[x.key].produzido, produzidoLinha: O[x.key].produzidoLinha}, m), {}), null, 1));
  console.log('backup:', bkp);
  const u = {}, agora = new Date().toISOString();
  aplicar.forEach((x) => {
    u['ops/' + x.key + '/produzido'] = x.para;
    u['ops/' + x.key + '/produzidoLinha'] = x.para;
    u['ops/' + x.key + '/correcaoProduzidoRegistros'] = {em: agora, de: x.de, para: x.para,
      motivo: 'Total digitado no apontamento por total divergia da soma dos registros (fluxo anterior a 05/09/2026)'};
  });
  await db.ref().update(u);
  console.log('gravado.');
  process.exit(0);
})();
