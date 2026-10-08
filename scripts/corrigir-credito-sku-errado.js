'use strict';
/* Devolve ao SKU certo a produção que o apontamento creditou no SKU vizinho.
 *
 * O DEFEITO (corrigido no código em 08/10/2026, ver findPedidoKeyPorLote em
 * public/shared/utils.js): um pedido comercial vira vários registros em
 * `pedidos/`, um por SKU, todos com o MESMO `id`. Quando o nome do produto
 * divergia entre ops/ e pedidos/ ("200 ML" x "200g", "COPORAL" x "CORPORAL"),
 * a resolução caía num "casa só pelo id" que devolvia o PRIMEIRO SKU daquele
 * pedido. Resultado visível: HIDRATANTE CÉU INFINITO com 20.079 de 10.000 un.
 * (201%) enquanto as OPs dele somavam 7.588 -- as outras 12.491 eram de
 * HIDRATANTE FLOR D'AURA, outro SKU do mesmo pedido 0023.
 *
 * O CRITÉRIO DE CORREÇÃO é mecânico, não é opinião. Só move o apontamento
 * quando as DUAS coisas valem:
 *   (a) a OP do lote aponta, pelo SKU, para um pedido DIFERENTE do creditado;
 *   (b) a regra NOVA (estrita) não resolveria pedido nenhum a partir do que
 *       o registro guardou (id + produto).
 * (b) é o que separa "o sistema chutou" de "alguém escolheu". Se o registro
 * nomeia um pedido comercial diferente e o nome do produto bate nele, foi
 * escolha -- esse caso é apenas RELATADO, nunca movido.
 *
 * Move o lançamento inteiro: subtrai de `produzido` no pedido errado, soma no
 * certo, e leva junto a entrada de `apontamentosAplicados` (o razão que torna
 * o apontamento idempotente -- deixá-la para trás faria um retry somar de novo).
 *
 * `status` só é mexido quando ele foi consequência do número errado: pedido
 * marcado 'Concluído' SEM encerramento manual que, com o número certo, não
 * está concluído. Encerramento manual é decisão de gente e fica como está.
 *
 * Uso:  node scripts/corrigir-credito-sku-errado.js          (ENSAIO, não grava)
 *       node scripts/corrigir-credito-sku-errado.js --aplicar
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
const f = (v) => (parseFloat(v) || 0).toLocaleString('pt-BR');
const digitsOnly = (s) => String(s || '').replace(/\D/g, '');
const sanitizeKey = (s) => !s ? '' : String(s).trim().replace(/[./[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60);
const norm = (s) => !s ? '' : String(s).toLowerCase().replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ');

/* Mesma regra que foi para produção -- reimplementada aqui de propósito: o
   script tem que poder rodar sozinho, e qualquer divergência entre as duas
   aparece como diferença no ensaio antes de qualquer escrita. */
function findPedidoKeyEstrito(pedidoId, produto, peds) {
  if (!peds || !pedidoId) return null;
  const keys = Object.keys(peds);
  const exact = sanitizeKey(pedidoId) + '__' + sanitizeKey(produto);
  if (peds[exact]) return exact;
  const pid = String(pedidoId).trim();
  const prodNorm = produto ? norm(produto) : '';
  const bateId = (p) => {
    const id = String(p.id || '').trim();
    return id === pid || id.indexOf(pid + '-') === 0;
  };
  for (const k of keys) {
    const p = peds[k];
    if (p && bateId(p) && prodNorm && norm(p.produto) === prodNorm) return k;
  }
  const cands = keys.filter((k) => peds[k] && bateId(peds[k]));
  return cands.length === 1 ? cands[0] : null;
}
function resolvePorSku(skuKey, peds) {
  if (!skuKey) return null;
  if (peds[skuKey]) return skuKey;
  const sep = String(skuKey).indexOf('__');
  if (sep < 0) return null;
  const idNum = parseInt(digitsOnly(skuKey.slice(0, sep)), 10);
  const skuPart = skuKey.slice(sep + 2);
  if (!isFinite(idNum)) return null;
  return Object.keys(peds).find((k) => {
    const p = peds[k];
    if (!p) return false;
    const d = digitsOnly(p.id);
    return d && parseInt(d, 10) === idNum && String(p.sku || '') === skuPart;
  }) || null;
}

(async () => {
  console.log(APLICAR ? '*** APLICANDO EM PRODUÇÃO ***' : '--- ENSAIO (nada é gravado) ---');
  const peds = (await db.ref('pedidos').once('value')).val() || {};
  const ops = (await db.ref('ops').once('value')).val() || {};
  const regsRoot = (await db.ref('registros').once('value')).val() || {};

  // id do apontamento -> registro, para recuperar o que ele guardou
  const regPorId = {};
  Object.keys(regsRoot).forEach((d) => Object.entries(regsRoot[d] || {}).forEach(([k, r]) => {
    if (r) regPorId[k] = r;
  }));

  const mover = [];     // o sistema chutou: corrigir
  const relatar = [];   // alguém escolheu outro pedido: só relatar

  Object.entries(peds).forEach(([pk, p]) => {
    const ap = (p && p.apontamentosAplicados) || {};
    Object.entries(ap).forEach(([id, v]) => {
      const lote = String(v.lote || '');
      const op = ops[sanitizeKey(lote)];
      if (!op) return;
      const destino = resolvePorSku(op.skuPedidoKey, peds);
      if (!destino || destino === pk) return;              // (a) falhou
      const reg = regPorId[id] || {};
      const estrito = findPedidoKeyEstrito(reg.pedidoId || p.id, reg.produto || op.produto, peds);
      const caso = {
        id, lote, qtd: parseFloat(v.quantidade) || 0, de: pk, para: destino,
        produtoOp: op.produto, produtoPedidoErrado: p.produto,
        produtoPedidoCerto: (peds[destino] || {}).produto,
        pedidoIdNoRegistro: reg.pedidoId || '(ausente)', estrito
      };
      if (estrito === null) mover.push(caso);               // (b) ok: foi chute
      else relatar.push(caso);                              // escolha deliberada
    });
  });

  const soma = (arr) => arr.reduce((s, c) => s + c.qtd, 0);
  console.log('\n=== A CORRIGIR: ' + mover.length + ' apontamentos, ' + f(soma(mover)) + ' un. ===');
  const porPar = {};
  mover.forEach((c) => {
    const k = c.de + ' -> ' + c.para;
    (porPar[k] = porPar[k] || []).push(c);
  });
  Object.entries(porPar).forEach(([k, cs]) => {
    const [de, para] = k.split(' -> ');
    console.log('  ' + f(soma(cs)) + ' un. (' + cs.length + ' apont.) saem de ' + de + ' ["' + cs[0].produtoPedidoErrado + '"]');
    console.log('      e voltam para ' + para + ' ["' + cs[0].produtoPedidoCerto + '"]');
    console.log('      OP diz "' + cs[0].produtoOp + '" — é a divergência de nome que derrubou o desempate');
    console.log('      lotes: ' + [...new Set(cs.map((c) => c.lote))].join(', '));
  });

  if (relatar.length) {
    console.log('\n=== NÃO MEXIDO — vínculo escolhido, não chutado: ' + relatar.length +
      ' apontamentos, ' + f(soma(relatar)) + ' un. ===');
    console.log('  (o registro nomeia outro pedido comercial E o nome do produto bate nele;');
    console.log('   a regra nova mantém essa escolha. Confira no comercial se for o caso.)');
    relatar.forEach((c) => console.log('   ' + f(c.qtd) + ' un. OP ' + c.lote + ' creditadas em ' + c.de +
      ' (pedidoId no registro: ' + c.pedidoIdNoRegistro + '); a OP está vinculada a ' + c.para));
  }

  // ── Efeito final por pedido ──────────────────────────────────────────────
  const delta = {};
  mover.forEach((c) => {
    delta[c.de] = (delta[c.de] || 0) - c.qtd;
    delta[c.para] = (delta[c.para] || 0) + c.qtd;
  });
  console.log('\n=== EFEITO POR PEDIDO ===');
  const statusNovo = {};
  Object.entries(delta).forEach(([k, d]) => {
    const p = peds[k] || {};
    const antes = parseFloat(p.produzido) || 0;
    const depois = antes + d;
    const qt = parseFloat(p.qtdTotal) || 0;
    const pctA = qt ? Math.round(antes / qt * 100) : 0;
    const pctD = qt ? Math.round(depois / qt * 100) : 0;
    let nota = '';
    const manual = String(p.statusManual || '').toLowerCase();
    if (String(p.status || '').toLowerCase().indexOf('conclu') === 0 && manual !== 'encerrado' && qt > 0 && depois < qt) {
      statusNovo[k] = depois > 0 ? 'Produção Parcial' : 'Não Iniciado';
      nota = '  → status "' + p.status + '" era consequência do número errado; passa a "' + statusNovo[k] + '"';
    } else if (manual === 'encerrado') {
      nota = '  → encerrado à mão: status preservado';
    }
    console.log('  ' + k + ' ["' + p.produto + '"]');
    console.log('      ' + f(antes) + ' (' + pctA + '%)  →  ' + f(depois) + ' (' + pctD + '%) de ' + f(qt) + nota);
  });

  if (!APLICAR) {
    console.log('\n--- ENSAIO: nada foi gravado. Para aplicar: --aplicar ---');
    process.exit(0);
  }

  // ── Escrita ──────────────────────────────────────────────────────────────
  // Transação por pedido: lê o valor do servidor e aplica o delta inteiro de
  // uma vez, junto com as entradas do razão. Nada de set() sobre valor lido
  // antes -- um apontamento que chegue da fábrica no meio disto não pode
  // sumir.
  const chaves = [...new Set(mover.flatMap((c) => [c.de, c.para]))];
  for (const k of chaves) {
    const entram = mover.filter((c) => c.para === k);
    const saem = mover.filter((c) => c.de === k);
    const res = await db.ref('pedidos/' + k).transaction((p) => {
      if (p === null) return p;
      const ap = p.apontamentosAplicados || {};
      let d = 0;
      saem.forEach((c) => { if (ap[c.id]) { d -= c.qtd; delete ap[c.id]; } });
      entram.forEach((c) => {
        if (ap[c.id]) return;                       // já estava lá: não soma de novo
        d += c.qtd;
        ap[c.id] = { quantidade: c.qtd, lote: c.lote };
      });
      if (!d && !saem.length && !entram.length) return p;
      p.produzido = (p.produzido || 0) + d;
      p.apontamentosAplicados = ap;
      if (statusNovo[k]) p.status = statusNovo[k];
      p.correcaoCreditoSku = {
        em: new Date().toISOString(),
        delta: d,
        por: 'scripts/corrigir-credito-sku-errado.js',
        motivo: 'producao creditada no SKU vizinho do mesmo pedido comercial (findPedidoKey por id ambiguo)'
      };
      return p;
    });
    console.log((res.committed ? 'OK   ' : 'FALHOU ') + k + '  produzido=' +
      f(res.snapshot.exists() ? res.snapshot.val().produzido : null));
  }
  console.log('\nFeito. Reconfira a tela de Pedidos.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
