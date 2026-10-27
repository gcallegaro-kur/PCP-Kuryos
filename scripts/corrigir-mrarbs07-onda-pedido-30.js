/*
 * CORREÇÃO MRARBS07: a onda 26292/26293/26299 é do PEDIDO 30 (27/10/2026)
 *
 * ACHADO (confirmado pelo usuário, medido na base):
 *   As ondas de OP do MRARBS07 são limpas por pedido -- 26174..26180 é o
 *   pedido 0011, 26292/26293/26299 é o pedido 30. Seis OPs da onda do 30
 *   ficaram chaveadas no 0011/11 por erro de vínculo:
 *
 *     26292/01  Concluído    4.656 un  -> estava 0011__   (palete travado)
 *     26293/02  Concluído    4.608 un  -> estava 11__     (palete em quarentena)
 *     26299/02  Em Produção  4.512 prog-> estava 0011__
 *     26299/03  Programado   4.512 prog-> estava 0011__
 *     26299/04  Programado   4.512 prog-> estava 0011__
 *     26299/06  Programado   4.512 prog-> estava 0011__
 *
 *   O sintoma visível era o palete PA-26292-01-P1 travado em Montar Carga com
 *   "Produto não consta no pedido comercial": o palete apontava para o pedido
 *   0011, cujo registro comercial não lista MRARBS07. O comercial do pedido 30
 *   lista (60.000 un), então mover o vínculo destrava sem tocar no comercial.
 *
 * DEPOIS DA CORREÇÃO:
 *   pedido 0011 : 59.533 de 60.000  (saldo 467, atendido pelo PED-0008)
 *   pedido 30   : 23.297 de 60.000  (+ onda 26299 em produção)
 *
 * POR QUE NÃO REIMPLEMENTA NADA: este script dirige
 * `public/shared/transferencia-op.js`, o mesmo módulo do lápis ✏️ da tela Ops.
 * Mesmas transactions idempotentes, mesma trilha em
 * `ops/{op}/transferenciasPedido/{id}`, mesmo movimento de palete, programação
 * e alocação. Rodar isto e clicar na tela dão o mesmo resultado.
 *
 * O QUE ELE NÃO FAZ, de propósito:
 *   - Não mexe em `pedidos_comerciais`. O item faltando no 0011 é lacuna de
 *     escrituração e entra pelo editor do Gestão Comercial, que versiona.
 *   - Não funde a linha `11__BODY_SPLASH...`. Depois que 26293/02 sai dela,
 *     ela guarda só 26177/02 (que é do 0011 mesmo) e aí
 *     `sanear-vinculos-pedido.js --aplicar --fundir-duplicadas` passa a guarda
 *     da onda e faz a fusão. Ordem importa.
 *   - `--encerrar` NÃO limpa slots futuros de programação; o botão da tela
 *     Pedidos limpa (cleanFutureSlots). Se a linha tiver slot futuro, prefira
 *     a tela. Depois de transferir a onda 26299 não deve sobrar nenhum.
 *
 * Uso:  node scripts/corrigir-mrarbs07-onda-pedido-30.js                 (ENSAIO)
 *       node scripts/corrigir-mrarbs07-onda-pedido-30.js --aplicar --transferir
 *       node scripts/corrigir-mrarbs07-onda-pedido-30.js --aplicar --encerrar
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const admin = require(path.join(root, 'functions/node_modules/firebase-admin'));
const TransferenciaOP = require(path.join(root, 'public/shared/transferencia-op.js'));
const EncerramentoPedido = require(path.join(root, 'public/shared/encerramento-pedido.js'));

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(root, 'firebase-service-account.json'))),
  databaseURL: 'https://prod-kuryos-default-rtdb.firebaseio.com',
});
const db = admin.database();

const APLICAR = process.argv.includes('--aplicar');
const TRANSFERIR = process.argv.includes('--transferir');
const ENCERRAR = process.argv.includes('--encerrar');
const argPor = process.argv.indexOf('--por');
const POR = argPor > -1 && process.argv[argPor + 1] ? process.argv[argPor + 1] : 'PCP (script de correção)';

const DESTINO = '30__MRARBS07';
const LOTES = ['26292/01', '26293/02', '26299/02', '26299/03', '26299/04', '26299/06'];
const ENCERRAR_LINHAS = ['0011__BODY_SPLASH_LEAO_DO_DESERTO_BOURBON_200ml', 'PED-0008__MRARBS07'];
const MOTIVO_TEXTO = 'Saldo atendido pela reposicao PED-0008 (6.614 un produzidas de 4.800, paletes PA-26260-01-P1 e PA-26261-02-P1 expedidos). Producao restante do MRARBS07 pertence ao pedido 30.';

const n = (v) => { const x = Number(v); return isFinite(x) ? x : 0; };
const f = (v) => Math.round(n(v)).toLocaleString('pt-BR');
const pad = (s, w) => String(s == null ? '' : s).padEnd(w);
// sanitizeKey de shared/utils.js, copiado para nao arrastar o arquivo inteiro
// (utils.js nao e UMD; e script de pagina).
function sanitizeKey(str) {
  if (!str) return '';
  return String(str).trim().replace(/[./[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60);
}
const hojeLocal = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

async function lerBase() {
  const [oS, pS, lS] = await Promise.all([
    db.ref('ops').once('value'), db.ref('pedidos').once('value'), db.ref('estoque_lotes').once('value'),
  ]);
  return {ops: oS.val() || {}, pedidos: pS.val() || {}, estoque_lotes: lS.val() || {}};
}

function acharOpKey(ops, lote) {
  const achados = Object.keys(ops).filter((k) => ops[k] && ops[k].lote === lote && ops[k].sku === 'MRARBS07');
  if (achados.length !== 1) return null;
  return achados[0];
}

// Replica executarTransferenciaOp de public/ops.html, fase por fase.
async function transferirUma(opKey, destinoKey) {
  const base = await lerBase();
  const op = base.ops[opKey];
  const pendente = TransferenciaOP.transferenciaPendente(op);
  const plano = TransferenciaOP.planejar({ops: {[opKey]: op}, pedidos: base.pedidos, estoque_lotes: base.estoque_lotes},
    opKey, destinoKey, pendente);
  if (plano.erros.length) throw new Error(op.lote + ': ' + plano.erros.join(' '));

  const em = new Date().toISOString();
  const id = pendente ? pendente.id : db.ref('ops/' + opKey + '/transferenciasPedido').push().key;
  if (!pendente) {
    await db.ref('ops/' + opKey).update({
      skuPedidoKey: plano.destinoKey,
      parentPedidoId: plano.parentDestino || null,
      ['transferenciasPedido/' + id]: {
        status: 'EM_ANDAMENTO', origem: plano.origemKey || null, origemAnterior: op.skuPedidoKey || null,
        destino: plano.destinoKey, qtdPrevista: plano.qtd, paletes: plano.paletes.length,
        motivo: 'Onda ' + String(op.lote).split('/')[0] + ' e producao do pedido 30; vinculo estava no 0011 por erro.',
        em: em, por: POR,
      },
    });
  }
  const ctx = {id: id, lote: plano.lote, qtdSemRegistro: plano.qtdSemRegistro,
    origemKey: plano.origemKey, destinoKey: plano.destinoKey, em: em, por: POR};
  if (plano.origemKey) await db.ref('pedidos/' + plano.origemKey).transaction((p) => TransferenciaOP.aplicarSaida(p, ctx));
  else ctx.movido = {aplicacoes: {}, qtd: 0};
  await db.ref('pedidos/' + plano.destinoKey).transaction((p) => TransferenciaOP.aplicarEntrada(p, ctx));

  const [progSnap, alocSnap] = await Promise.all([
    db.ref('programacao').orderByKey().startAt(hojeLocal()).once('value'),
    db.ref('alocacoes_planejamento').once('value'),
  ]);
  plano.em = em;
  const updates = Object.assign({},
    TransferenciaOP.atualizacoesPaletes(plano),
    TransferenciaOP.atualizacoesProgramacao(progSnap.val() || {}, plano, hojeLocal(), new Date().getHours()),
    TransferenciaOP.atualizacoesAlocacoes(alocSnap.val() || {}, plano.lote, sanitizeKey));
  const reg = 'ops/' + opKey + '/transferenciasPedido/' + id + '/';
  updates[reg + 'status'] = 'CONCLUIDA';
  updates[reg + 'qtd'] = ctx.movido ? ctx.movido.qtd : 0;
  updates[reg + 'concluidaEm'] = new Date().toISOString();
  await db.ref().update(updates);
  return {plano: plano, movido: ctx.movido ? ctx.movido.qtd : 0, paletes: plano.paletes.length};
}

(async () => {
  console.log(APLICAR ? '*** APLICANDO EM PRODUÇÃO ***' : '--- ENSAIO (nada é gravado) ---');
  console.log('');
  const base = await lerBase();

  // ── backup antes de qualquer gravação ────────────────────────────────
  if (APLICAR) {
    const dir = path.join(root, 'backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
    const arq = path.join(dir, 'antes-mrarbs07-pedido30-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    const opsAfetadas = {};
    LOTES.forEach((lote) => { const k = acharOpKey(base.ops, lote); if (k) opsAfetadas[k] = base.ops[k]; });
    fs.writeFileSync(arq, JSON.stringify({
      em: new Date().toISOString(), flags: {transferir: TRANSFERIR, encerrar: ENCERRAR}, por: POR,
      ops: opsAfetadas, pedidos: base.pedidos, estoque_lotes: {MRARBS07: base.estoque_lotes.MRARBS07 || {}},
    }, null, 2));
    console.log('backup: ' + arq);
    console.log('');
  }

  // ── 1. transferências ────────────────────────────────────────────────
  console.log('=== 1. TRANSFERIR para ' + DESTINO + ' ===');
  const l30 = base.pedidos[DESTINO];
  if (!l30) { console.error('  linha ' + DESTINO + ' não existe. Abortado.'); process.exit(1); }
  console.log('  destino hoje: produzido ' + f(l30.produzido) + ' de ' + f(l30.qtdTotal));
  console.log('');

  let somaMovida = 0;
  for (const lote of LOTES) {
    const opKey = acharOpKey(base.ops, lote);
    if (!opKey) { console.log('  ' + pad(lote, 11) + ' | NÃO ENCONTRADA (ou chave ambígua) — pulada'); continue; }
    const op = base.ops[opKey];
    if (op.skuPedidoKey === DESTINO) { console.log('  ' + pad(lote, 11) + ' | já está em ' + DESTINO + ' — nada a fazer'); continue; }

    const plano = TransferenciaOP.planejar({ops: {[opKey]: op}, pedidos: base.pedidos, estoque_lotes: base.estoque_lotes},
      opKey, DESTINO, TransferenciaOP.transferenciaPendente(op));
    if (plano.erros.length) { console.log('  ' + pad(lote, 11) + ' | ERRO: ' + plano.erros.join(' ')); continue; }
    console.log('  ' + pad(lote, 11) + ' | ' + pad(op.status, 13) + ' | de ' + pad(plano.origemKey || '(sem)', 48));
    console.log('       move ' + pad(f(plano.qtd) + ' un', 12) + ' | ' + plano.paletes.length + ' palete(s)' +
      (plano.paletes.length ? ': ' + plano.paletes.map((p) => p.loteKey).join(', ') : '') +
      (plano.avisos && plano.avisos.length ? ' | AVISO: ' + plano.avisos.join(' ') : ''));
    somaMovida += n(plano.qtd);

    if (APLICAR && TRANSFERIR) {
      const r = await transferirUma(opKey, DESTINO);
      console.log('       OK: ' + f(r.movido) + ' un movidas, ' + r.paletes + ' palete(s) religado(s)');
    }
  }
  console.log('');
  console.log('  total a mover: ' + f(somaMovida) + ' un (produção já apontada)');
  if (!TRANSFERIR) console.log('  (transferências NÃO serão feitas — passe --transferir)');

  // ── 2. encerramento ──────────────────────────────────────────────────
  console.log('');
  console.log('=== 2. ENCERRAR as linhas atendidas ===');
  const depois = APLICAR && TRANSFERIR ? (await lerBase()).pedidos : base.pedidos;
  ENCERRAR_LINHAS.forEach((k) => {
    const p = depois[k];
    if (!p) { console.log('  ' + pad(k, 48) + ' | NÃO EXISTE'); return; }
    console.log('  ' + pad(k, 48) + ' | produzido ' + pad(f(p.produzido), 8) + ' de ' + pad(f(p.qtdTotal), 8) +
      ' (' + EncerramentoPedido.percentual(p) + '%) | situação: ' + EncerramentoPedido.situacao(p));
  });
  const plano = EncerramentoPedido.montarEncerramento(depois, ENCERRAR_LINHAS, {
    motivoTipo: 'ATENDIDO_TOLERANCIA', texto: MOTIVO_TEXTO, por: POR, origem: 'PCP', incluirConcluidas: true,
  });
  if (!plano.ok) {
    console.log('  ' + plano.erro);
  } else {
    console.log('');
    plano.linhas.forEach((l) => console.log('  -> encerrar ' + pad(l.key, 48) + ' | saldo não produzido ' + f(l.saldo) + ' un'));
    if (APLICAR && ENCERRAR) {
      await db.ref().update(plano.updates);
      console.log('  OK: ' + plano.linhas.length + ' linha(s) encerrada(s).');
    } else if (!ENCERRAR) {
      console.log('  (encerramento NÃO será feito — passe --encerrar)');
    }
  }

  console.log('');
  if (!APLICAR) console.log('--- ENSAIO. Nada foi gravado. ---');
  console.log('ORDEM CORRETA (o encerramento é o ÚLTIMO passo):');
  console.log('  1) este script --aplicar --transferir');
  console.log('  2) node scripts/sanear-vinculos-pedido.js --aplicar --fundir-duplicadas');
  console.log('     (agora passa a guarda da onda: 11__ guarda só 26177/02, que é do 0011)');
  console.log('  3) node scripts/sanear-vinculos-pedido.js --aplicar --reconciliar');
  console.log('  4) este script --aplicar --encerrar');
  console.log('  5) Gestão Comercial: adicionar MRARBS07 ao pedido 0011 (escrituração)');
  console.log('');
  console.log('POR QUE O ENCERRAMENTO É O ÚLTIMO: `encerramento` grava um retrato');
  console.log('de qtdTotal/produzido/saldoNaoProduzido. Encerrar antes do passo 3');
  console.log('congela o número errado (hoje mostraria saldo 323; o certo é 467).');
  process.exit(0);
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
