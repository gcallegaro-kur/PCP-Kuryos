'use strict';
/* Regulariza o palete de PA que entrou pelo Endereçamento.
 *
 * O QUE ACONTECEU: em 24/10/2026 14:54 o HIG-NEXT-0001 (SPIRULINA VERDE 120
 * CAPSULAS NEXT 21, cliente NEXT) foi lançado pela aba Endereçamento do
 * Estoque -- 3.968 un, lote da caixa 25086/02, validade 2028-03-30, posição
 * GAL-4.1.10. A trava de excesso daquela aba só cobria `material`, e PA não
 * tem saldo agregado em `estoque/{cod}` para contradizer, porque o saldo de PA
 * É a soma dos lotes. A porta foi fechada no mesmo dia (estoque.html recusa
 * produto acabado); isto aqui conserta o que já entrou.
 *
 * TRÊS COISAS ERRADAS NO REGISTRO:
 *   1. `status: 'LIBERADO'` -- `putawayEstoqueLote` grava isso fixo. PA de
 *      verdade entra em QUARENTENA e espera laudo.
 *   2. movimento `producao_op` / "ENTRADA DE PRODUÇÃO" -- afirma que a linha
 *      produziu. Não houve OP, apontamento nem consumo de material.
 *   3. sem `identificadorPalete`, sem `propriedade`, sem motivo de origem.
 *
 * E UM MAL-ENTENDIDO IMPORTANTE: como está, o palete NUNCA foi vendável.
 * `shared/expedicao.js` exige origem conhecida (`conferencia_pa`,
 * `legado_planilha`, `devolucao_cliente` ou `entrada_avulsa_pa`),
 * `identificadorPalete`, status LIBERADO_EXPEDICAO/APROVADO_CONCESSAO e
 * `qualidade.decisao` igual ao status. `endereco_inicial` + `LIBERADO` falha
 * em três desses portões. Aparecia no estoque e a Expedição recusaria.
 *
 * O QUE ESTE SCRIPT FAZ: põe o palete exatamente na forma que
 * `shared/entrada-avulsa-pa.js#montarPalete` produz -- a origem certa para PA
 * sem OP -- mantendo quantidade, lote da caixa, validade e endereço. Depois
 * disso faltam DOIS passos humanos, que o script não faz e não deve fazer:
 *   a) Qualidade dá o laudo (Qualidade → fila, o palete aparece como avulso);
 *   b) Logística vincula o palete ao pedido na Expedição.
 * O laudo é decisão de pessoa. Forjar `qualidade.decisao` por script seria
 * inventar uma liberação que ninguém deu -- é o que o próprio comentário do
 * expedicao.js diz que não se pode fazer com o palete legado.
 *
 * Uso:  node scripts/regularizar-pa-hig-next-0001.js            (ENSAIO)
 *       node scripts/regularizar-pa-hig-next-0001.js --aplicar
 */
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
const admin = require(path.join(root, 'functions/node_modules/firebase-admin'));

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(root, 'firebase-service-account.json'))),
  databaseURL: 'https://prod-kuryos-default-rtdb.firebaseio.com',
});
const db = admin.database();
const APLICAR = process.argv.includes('--aplicar');

const ITEM = 'HIG-NEXT-0001';
const LOTE_KEY = '-P4iOwHjZFHmoaZPnN93';
const MOV_KEY = '-P4iOwKOOC9kgiNdQ6wB';
const AUTOR = 'Correção (scripts/regularizar-pa-hig-next-0001.js)';
// Motivo: o palete é estoque próprio sem OP. O texto diz o que se sabe hoje;
// se for devolução de cliente, trocar para DEVOLUCAO_SEM_ORIGEM e informar o
// cliente antes de aplicar.
const MOTIVO_TIPO = 'SOBRA_ESTOQUE';
const MOTIVO = 'Produto acabado sem OP no sistema, lançado por engano pela aba Enderecamento em 24/10/2026 e regularizado como entrada avulsa, mantendo quantidade, lote da caixa e validade originais.';

function sanitizeKey(s) { return !s ? '' : String(s).trim().replace(/[./[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60); }

(async () => {
  const [loteSnap, movSnap] = await Promise.all([
    db.ref('estoque_lotes/' + ITEM + '/' + LOTE_KEY).once('value'),
    db.ref('movimentos_estoque/' + ITEM + '/' + MOV_KEY).once('value'),
  ]);
  const lote = loteSnap.val();
  const mov = movSnap.val();

  if (!lote) { console.error('Palete não encontrado — nada a fazer (já corrigido?).'); process.exit(1); }
  if (lote.origemTipo !== 'endereco_inicial') {
    console.error('A origem já não é `endereco_inicial` (está "' + lote.origemTipo + '"). Nada a fazer.');
    process.exit(1);
  }

  console.log('=== ANTES ===');
  console.log('  origemTipo          :', lote.origemTipo);
  console.log('  status              :', lote.status);
  console.log('  saldoLote           :', lote.saldoLote, lote.unidade);
  console.log('  loteOrigem (caixa)  :', lote.loteOrigem);
  console.log('  dataValidade        :', lote.dataValidade);
  console.log('  endereco            :', lote.enderecoCodigo, '(' + lote.enderecoKey + ')');
  console.log('  identificadorPalete :', lote.identificadorPalete || '(ausente)');
  console.log('  movimento           :', mov ? mov.tipo + ' / ' + mov.motivo : '(ausente)');

  const agora = new Date().toISOString();
  const ident = 'AV-' + sanitizeKey(lote.loteOrigem).replace(/_/g, '-').slice(0, 24) + '-REG001';

  // Mesma forma de entrada-avulsa-pa.js#montarPalete, preservando o que foi
  // informado na mão (quantidade, lote da caixa, validade, endereço).
  const novoLote = Object.assign({}, lote, {
    origemTipo: 'entrada_avulsa_pa',
    origemRef: null,
    status: 'QUARENTENA',
    identificadorPalete: ident,
    paleteNumero: 1,
    validade: lote.dataValidade || null,
    propriedade: {tipo: 'KURYOS'},
    entradaAvulsa: {
      motivoTipo: MOTIVO_TIPO,
      motivo: MOTIVO,
      clienteOrigem: null,
      nfDevolucao: null,
      lancadaPor: lote.criadoPor || null,
      lancadaEm: lote.criadoEm || agora,
    },
    correcao: {
      de: 'endereco_inicial', para: 'entrada_avulsa_pa',
      statusDe: lote.status, statusPara: 'QUARENTENA',
      em: agora, por: AUTOR,
      motivo: 'Entrou pela aba Enderecamento, que gravava status LIBERADO e movimento producao_op para produto acabado.',
    },
    atualizadoEm: agora,
  });

  // O movimento passa a dizer a verdade: entrada avulsa, não produção.
  const novoMov = Object.assign({}, mov || {}, {
    tipo: 'entrada_avulsa_pa',
    motivo: 'ENTRADA AVULSA DE PA — REGULARIZACAO DE LANCAMENTO PELO ENDERECAMENTO (QUARENTENA)',
    loteKey: LOTE_KEY,
    saldoApos: lote.saldoLote,
    corrigidoEm: agora,
    corrigidoPor: AUTOR,
    tipoAnterior: (mov && mov.tipo) || null,
    motivoAnterior: (mov && mov.motivo) || null,
  });

  console.log('');
  console.log('=== DEPOIS ===');
  console.log('  origemTipo          : entrada_avulsa_pa   (é a origem que a Expedição aceita para PA sem OP)');
  console.log('  status              : QUARENTENA          (entra na fila da Qualidade)');
  console.log('  saldoLote           :', novoLote.saldoLote, novoLote.unidade, '  (mantido)');
  console.log('  loteOrigem (caixa)  :', novoLote.loteOrigem, '  (mantido)');
  console.log('  dataValidade        :', novoLote.dataValidade, '  (mantido)');
  console.log('  endereco            :', novoLote.enderecoCodigo, '  (mantido)');
  console.log('  identificadorPalete :', ident, '  (novo — a Expedição exige)');
  console.log('  movimento           : entrada_avulsa_pa / ENTRADA AVULSA DE PA — REGULARIZACAO...');
  console.log('');
  console.log('DEPOIS DE APLICAR, FALTAM DOIS PASSOS HUMANOS:');
  console.log('  1) Qualidade → fila de laudos: o palete aparece como avulso. Dar o laudo.');
  console.log('     Só o laudo leva o status a LIBERADO_EXPEDICAO, que é o que a Expedição exige.');
  console.log('  2) Expedição: vincular o palete ao pedido que vai receber (estoque próprio precisa de pedido).');
  console.log('');
  console.log('O script NÃO dá o laudo: isso é decisão da Qualidade, não de script.');

  if (!APLICAR) {
    console.log('');
    console.log('--- ENSAIO: nada foi gravado. Para aplicar: --aplicar ---');
    process.exit(0);
  }

  const dir = path.join(root, 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const arq = path.join(dir, 'antes-regularizar-pa-HIG-NEXT-0001-' + agora.slice(0, 10).replace(/-/g, '') + '.json');
  fs.writeFileSync(arq, JSON.stringify({
    gravadoEm: agora,
    'estoque_lotes/HIG-NEXT-0001/-P4iOwHjZFHmoaZPnN93': lote,
    'movimentos_estoque/HIG-NEXT-0001/-P4iOwKOOC9kgiNdQ6wB': mov,
  }, null, 2));
  console.log('');
  console.log('backup: ' + arq);

  const updates = {};
  updates['estoque_lotes/' + ITEM + '/' + LOTE_KEY] = novoLote;
  updates['movimentos_estoque/' + ITEM + '/' + MOV_KEY] = novoMov;
  await db.ref().update(updates);
  console.log('Feito. Palete regularizado como entrada avulsa, em quarentena, aguardando laudo.');
  process.exit(0);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
