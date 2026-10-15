'use strict';
/* Leão do Deserto: devolve ao PED-0008 as 6.614 un. das OPs 26260/01 e
 * 26261/02 e credita ao pedido 0011 a produção das 12 OPs dele.
 *
 * O QUE ACONTECEU (rastreado em 14/10/2026):
 *  1. 17-18/09: as duas OPs nasceram vinculadas ao PED-0008, mas o apontamento
 *     foi creditado em 0011__BODY_SPLASH_LEAO... pelo desempate antigo por nome
 *     (incidente de 08/10). Ficaram 4 entradas em apontamentosAplicados de 0011.
 *  2. 23/09: Gustavo transferiu as duas OPs para o PED-0008 (decisão dele, está
 *     em PED-0008/transferenciasOP). A transferência olhou só o vínculo da OP,
 *     achou 0 un. no pedido de origem e gravou `qtd: 0`. As 6.614 un. ficaram
 *     no pedido errado. (Corrigido no código: transferencia-op.js planejar().)
 *  3. As 12 OPs do próprio 0011 (26174/01 ... 26180/01, 55.021 un., já
 *     expedidas: 54.637) vieram de importação da planilha e nunca foram
 *     creditadas ao pedido: nenhum outro pedido as guarda.
 *
 * Resultado: PED-0008 = 6.614 e 0011 Leão = 55.021 (= soma das OPs).
 *
 * Uso:  node scripts/corrigir-leao-ped0008.js            (ENSAIO)
 *       node scripts/corrigir-leao-ped0008.js --aplicar  (grava + backup)
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
const LEAO = '0011__BODY_SPLASH_LEAO_DO_DESERTO_BOURBON_200ml';
const PED8 = 'PED-0008__MRARBS07';
const LOTES = ['26260/01', '26261/02'];

(async () => {
  console.log(APLICAR ? '*** APLICANDO ***' : '--- ENSAIO (nada é gravado) ---');
  const L = (await db.ref('pedidos/' + LEAO).once('value')).val();
  const P8 = (await db.ref('pedidos/' + PED8).once('value')).val();
  const O = (await db.ref('ops').once('value')).val() || {};
  const ap = L.apontamentosAplicados || {};
  const mover = Object.entries(ap).filter(([id, v]) => LOTES.indexOf(String(v.lote)) >= 0);
  const qtdMover = mover.reduce((t, [id, v]) => t + (parseFloat(v.quantidade) || 0), 0);
  const opsLeao = Object.values(O).filter((o) => o.skuPedidoKey === LEAO && o.status !== 'Cancelado');
  const somaOps = opsLeao.reduce((t, o) => t + (parseFloat(o.produzido) || 0), 0);
  const opsP8 = Object.values(O).filter((o) => o.skuPedidoKey === PED8 && o.status !== 'Cancelado');
  const somaP8 = opsP8.reduce((t, o) => t + (parseFloat(o.produzido) || 0), 0);
  console.log('Leão hoje: produzido ' + f(L.produzido) + ' | razão a mover: ' + mover.length + ' entradas, ' + f(qtdMover) + ' un.');
  console.log('Leão  -> produzido ' + f(somaOps) + ' (soma de ' + opsLeao.length + ' OPs)  qtd do pedido ' + f(L.qtdTotal));
  console.log('PED-0008 hoje: ' + f(P8.produzido) + ' -> ' + f(somaP8) + ' (OPs: ' + opsP8.map((o) => o.lote).join(', ') + ')  qtd do pedido ' + f(P8.qtdTotal));
  if (Math.abs(qtdMover - somaP8) > 1) { console.log('ABORTADO: o razão (' + f(qtdMover) + ') não bate com as OPs do PED-0008 (' + f(somaP8) + ').'); return process.exit(1); }
  if (!APLICAR) return process.exit(0);
  const bkp = path.join(root, 'backups', 'leao-ped0008-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(bkp, JSON.stringify({[LEAO]: L, [PED8]: P8}, null, 1));
  console.log('backup:', bkp);
  const agora = new Date().toISOString(), u = {};
  mover.forEach(([id, v]) => {
    u['pedidos/' + LEAO + '/apontamentosAplicados/' + id] = null;
    u['pedidos/' + PED8 + '/apontamentosAplicados/' + id] = v;
  });
  u['pedidos/' + LEAO + '/produzido'] = Math.round(somaOps * 1000) / 1000;
  u['pedidos/' + LEAO + '/status'] = somaOps >= L.qtdTotal ? 'Concluído' : 'Produção Parcial';
  u['pedidos/' + LEAO + '/correcaoProduzidoOps'] = {em: agora, de: L.produzido, para: somaOps,
    motivo: '6.614 un. devolvidas ao PED-0008 (transferência de 23/09 moveu 0); 12 OPs nunca creditadas ao pedido (auditoria 14/10/2026)'};
  u['pedidos/' + PED8 + '/produzido'] = Math.round(somaP8 * 1000) / 1000;
  u['pedidos/' + PED8 + '/status'] = 'Produção Parcial';
  u['pedidos/' + PED8 + '/ultimoApontamento'] = agora;
  u['pedidos/' + PED8 + '/correcaoProduzidoOps'] = {em: agora, de: P8.produzido, para: somaP8, lotes: LOTES,
    motivo: 'Crédito creditado no pedido 0011 pelo desempate antigo; a transferência de 23/09 moveu 0 (auditoria 14/10/2026)'};
  await db.ref().update(u);
  console.log('gravado.');
  process.exit(0);
})();
