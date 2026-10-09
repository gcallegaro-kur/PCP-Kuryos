'use strict';
/* Solta a reserva de material que ficou presa em OP já encerrada.
 *
 * POR QUE EXISTE: até 09/10/2026 os quatro pontos que chamam
 * `liberarEmpenhoLote` montavam a lista de materiais a partir de
 * `ops/{lote}.materiaisConsumo` e, sem o campo, nem chamavam a função. O
 * campo só passou a ser gravado nas emissões a partir de 10/09/2026 -- 74 de
 * 1.460 OPs o têm. Toda OP anterior era incapaz de soltar o que reservou.
 * O código já foi corrigido (a liberação agora descobre quem segura pelo
 * próprio índice de empenhos); este script limpa o que ficou para trás.
 *
 * CRITÉRIO, e ele é estreito de propósito: só libera reserva cuja OP está
 * `Concluído` ou `Cancelado`, ou cujo lote não existe mais em `ops/`. OP em
 * qualquer outro estado -- inclusive "Não Iniciado" e "Aguardando
 * Confirmação" -- está segurando material com razão e não se toca.
 *
 * A conta é a mesma de liberarEmpenhoLote: tira do `saldoEmpenhado` exatamente
 * o que aquela reserva ainda segura e apaga a entrada do índice. Não mexe em
 * `saldoAtual` -- estoque físico não muda, só o compromisso.
 *
 * Uso:  node scripts/liberar-empenho-op-encerrada.js            (ENSAIO)
 *       node scripts/liberar-empenho-op-encerrada.js --aplicar
 */
const path = require('path');
const root = path.resolve(__dirname, '..');
const admin = require(path.join(root, 'functions/node_modules/firebase-admin'));

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(root, 'firebase-service-account.json'))),
  databaseURL: 'https://prod-kuryos-default-rtdb.firebaseio.com',
});
const db = admin.database();

const APLICAR = process.argv.includes('--aplicar');
const ENCERRADAS = ['Concluído', 'Cancelado'];
const num = (v) => parseFloat(v) || 0;
const f = (v) => num(v).toLocaleString('pt-BR', {maximumFractionDigits: 3});
const arred = (v) => Math.round(num(v) * 1000) / 1000;

(async () => {
  console.log(APLICAR ? '*** APLICANDO EM PRODUÇÃO ***' : '--- ENSAIO (nada é gravado) ---');
  const estoque = (await db.ref('estoque').once('value')).val() || {};
  const ops = (await db.ref('ops').once('value')).val() || {};

  const presas = [];
  const mantidas = {};
  Object.entries(estoque).forEach(([matKey, reg]) => {
    Object.entries((reg || {}).empenhos || {}).forEach(([loteKey, e]) => {
      const qtd = num(e && e.qtdEmpenhada);
      if (qtd <= 0) return;
      const op = ops[loteKey];
      const status = op ? String(op.status || '') : null;
      if (op && !ENCERRADAS.includes(status)) {
        mantidas[status || '(sem status)'] = (mantidas[status || '(sem status)'] || 0) + 1;
        return;
      }
      presas.push({
        matKey, loteKey, qtd,
        lote: (e && e.lote) || loteKey,
        material: (reg && reg.materialNome) || matKey,
        unidade: (reg && reg.unidade) || '',
        motivo: op ? ('OP ' + status) : 'OP não existe em ops/',
        produto: op ? (op.produto || '') : '',
        skuNaReserva: (e && e.sku) || ''
      });
    });
  });

  if (!presas.length) {
    console.log('\nNada preso. Toda reserva viva pertence a OP em aberto.');
    process.exit(0);
  }

  const porLote = {};
  presas.forEach((p) => { (porLote[p.lote] = porLote[p.lote] || []).push(p); });
  console.log('\n=== A LIBERAR: ' + presas.length + ' reservas em ' + Object.keys(porLote).length + ' lotes ===');
  Object.keys(porLote).sort().forEach((lote) => {
    const l = porLote[lote];
    console.log('\n  OP ' + lote + '  (' + l[0].motivo + (l[0].produto ? ' — ' + l[0].produto : '') + ')');
    if (l[0].skuNaReserva) console.log('     sku gravado na reserva: ' + l[0].skuNaReserva);
    l.sort((a, b) => a.matKey.localeCompare(b.matKey)).forEach((p) => {
      const reg = estoque[p.matKey] || {};
      const antes = num(reg.saldoEmpenhado);
      console.log('     ' + p.matKey.padEnd(14) + String(p.material).slice(0, 30).padEnd(32) +
        'solta ' + f(p.qtd).padStart(10) + ' ' + (p.unidade || '').padEnd(3) +
        ' | empenhado do material: ' + f(antes) + ' → ' + f(arred(Math.max(0, antes - p.qtd))));
    });
  });

  console.log('\n=== reservas MANTIDAS (OP em aberto) ===');
  const mk = Object.keys(mantidas);
  if (!mk.length) console.log('  nenhuma');
  else mk.sort().forEach((st) => console.log('  ' + st + ': ' + mantidas[st] + ' reservas'));

  if (!APLICAR) {
    console.log('\n--- ENSAIO: nada foi gravado. Para aplicar: --aplicar ---');
    process.exit(0);
  }

  // Uma transação por material, aplicando TODAS as reservas presas dele de
  // uma vez. Relê do servidor: reserva que tenha sido baixada no meio disto
  // (apontamento concorrente) é respeitada pelo valor atual, não pelo lido.
  const porMaterial = {};
  presas.forEach((p) => { (porMaterial[p.matKey] = porMaterial[p.matKey] || []).push(p); });
  let liberado = 0;
  for (const [matKey, lista] of Object.entries(porMaterial)) {
    const res = await db.ref('estoque/' + matKey).transaction((atual) => {
      if (!atual || !atual.empenhos) return atual;
      let delta = 0;
      lista.forEach((p) => {
        const e = atual.empenhos[p.loteKey];
        if (!e) return;
        delta += num(e.qtdEmpenhada);
        delete atual.empenhos[p.loteKey];
      });
      if (!delta) return atual;
      atual.saldoEmpenhado = Math.max(0, arred(num(atual.saldoEmpenhado) - delta));
      atual.liberacaoEmpenhoPreso = {
        em: new Date().toISOString(), delta: arred(delta),
        lotes: lista.map((p) => p.lote),
        por: 'scripts/liberar-empenho-op-encerrada.js',
        motivo: 'OP encerrada sem materiaisConsumo: liberarEmpenhoLote nunca era chamado'
      };
      return atual;
    });
    const val = res.snapshot.exists() ? res.snapshot.val() : {};
    const soltou = lista.reduce((s, p) => s + p.qtd, 0);
    liberado += soltou;
    console.log((res.committed ? 'OK   ' : 'FALHOU ') + matKey.padEnd(14) +
      'soltou ' + f(soltou).padStart(10) + '  |  saldoEmpenhado agora: ' + f(val.saldoEmpenhado));
  }
  console.log('\nFeito. ' + presas.length + ' reservas liberadas (' + f(liberado) + ' em unidades misturadas).');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
