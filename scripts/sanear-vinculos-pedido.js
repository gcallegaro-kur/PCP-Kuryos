'use strict';
/* Saneia o vínculo pedido comercial -> linha /pedidos -> OP.
 *
 * POR QUE EXISTE (27/10/2026): o palete PA-26292-01-P1 (MRARBS07, 4.656 un)
 * travou em Montar Carga com "Produto não consta no pedido comercial". A
 * causa não era o palete: `pedidos_comerciais/0011` tem 6 SKUs / 150.000 un,
 * enquanto a planilha de origem do pedido 11 tem 7 SKUs / 210.000 un. A carga
 * do pedido perdeu uma linha. Puxando o fio, a base tem 67 chaves de
 * `skuPedidoKey` gravadas em OPs que não existem em `/pedidos`.
 *
 * O QUE IMPORTA E O QUE NÃO IMPORTA -- esta distinção é o ponto do script:
 * `resolvePedidoKeyBySkuKey` (shared/utils.js) já tolera as duas variações
 * mais comuns -- zero à esquerda ("17__" vs "0017__") e linha chaveada pela
 * descrição em vez do SKU -- porque casa por `digitsOnly(id)` + `sku`. Toda
 * chave que esse resolvedor acha JÁ É CONTADA certo pelo app; endireitá-la é
 * higiene, não conserto. O que de fato se perde é a chave que o resolvedor
 * NÃO acha: `reconciliarProduzido` faz `if (!pedKey) return;` e aquela
 * produção não entra em pedido nenhum. O relatório separa os dois casos.
 *
 * O QUE ESTE SCRIPT GRAVA (só com --aplicar):
 *   1. `ops/{lote}/skuPedidoKey` -> a chave real da linha, quando o
 *      resolvedor do próprio app aponta uma sem ambiguidade.
 *   2. A fusão da linha duplicada do MRARBS07: as OPs de
 *      `11__BODY_SPLASH_...` passam para `0011__BODY_SPLASH_...` (a de
 *      qtdTotal 60.000, que é a do pedido) e a duplicata de 4.608 é apagada.
 *      Só com --fundir-duplicadas, porque apaga um nó.
 *   3. `pedidos/{k}/produzido` recalculado, só com --reconciliar.
 *
 * O QUE ELE NUNCA GRAVA, de propósito:
 *   - Não renomeia linha chaveada pela descrição. `estoque_lotes` guarda
 *     `skuPedidoKey` apontando para ela (pa_26292-01_p1 aponta para
 *     `0011__BODY_SPLASH_LEAO_DO_DESERTO_BOURBON_200ml`); renomear o nó
 *     quebraria o palete. O resolvedor já tolera a grafia.
 *   - Não inventa linha de pedido para produção órfã: isso é decisão
 *     comercial, não de script. Só lista.
 *   - Não mexe nos `itens` de `pedidos_comerciais`. Item faltando entra pelo
 *     editor do Gestão Comercial, que versiona e exige motivo.
 *
 * SOBRE O RECÁLCULO DE `produzido`: a soma é das OPs MAIS
 * `atendidoPorEstoque` da própria linha. Unidade que saiu de estoque próprio
 * (entrada avulsa de PA) credita o pedido sem passar por OP nenhuma --
 * functions/expedicao.js grava os dois campos juntos. Somar só as OPs
 * apagaria esse crédito. O botão "Reconciliar agora" do Histórico tem esse
 * buraco; aqui não.
 *
 * Uso:  node scripts/sanear-vinculos-pedido.js                       (ENSAIO)
 *       node scripts/sanear-vinculos-pedido.js --aplicar
 *       node scripts/sanear-vinculos-pedido.js --aplicar --fundir-duplicadas
 *       node scripts/sanear-vinculos-pedido.js --aplicar --reconciliar
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
const FUNDIR = process.argv.includes('--fundir-duplicadas');
const RECONCILIAR = process.argv.includes('--reconciliar');
const CANC = ['Cancelado', 'Cancelada'];

const n = (v) => { const x = Number(v); return isFinite(x) ? x : 0; };
const f = (v) => Math.round(n(v)).toLocaleString('pt-BR');
const pad = (s, w) => String(s == null ? '' : s).padEnd(w);

// --- as regras do app, copiadas de shared/utils.js para não divergir ---
const digitsOnly = (v) => String(v == null ? '' : v).replace(/\D/g, '');
function resolvePedidoKeyBySkuKey(skuKey, pedidos) {
  if (!skuKey || !pedidos) return null;
  if (pedidos[skuKey]) return skuKey;
  const sep = String(skuKey).indexOf('__');
  if (sep === -1) return null;
  const idDigits = digitsOnly(skuKey.slice(0, sep));
  const skuPart = skuKey.slice(sep + 2);
  if (!idDigits) return null;
  const idNum = parseInt(idDigits, 10);
  const keys = Object.keys(pedidos);
  for (let i = 0; i < keys.length; i++) {
    const p = pedidos[keys[i]];
    if (!p) continue;
    const pid = digitsOnly(p.id);
    if (!pid) continue;
    if (parseInt(pid, 10) === idNum && String(p.sku || '') === skuPart) return keys[i];
  }
  return null;
}
// Quantos alvos o resolvedor teria -- >1 significa que a escolha dele é
// posicional (primeira chave do dicionário) e não se deve automatizar.
function candidatos(skuKey, pedidos) {
  const sep = String(skuKey).indexOf('__');
  if (sep === -1) return [];
  const idDigits = digitsOnly(skuKey.slice(0, sep));
  const skuPart = skuKey.slice(sep + 2);
  if (!idDigits) return [];
  const idNum = parseInt(idDigits, 10);
  return Object.keys(pedidos).filter((k) => {
    const p = pedidos[k];
    if (!p) return false;
    const pid = digitsOnly(p.id);
    return pid && parseInt(pid, 10) === idNum && String(p.sku || '') === skuPart;
  });
}
const campoProduzido = (t) => t === 'rotulagem' ? 'produzidoRotulagem' : t === 'posto' ? 'produzidoPosto' : 'produzidoLinha';
function getProduzido(op, tipo) {
  if (!op) return 0;
  const c = campoProduzido(tipo);
  if (op[c] != null) return n(op[c]);
  return (tipo === 'linha' || !tipo) ? n(op.produzido) : 0;
}

const DUPLICADA_DE = '11__BODY_SPLASH_LEAO_DO_DESERTO_BOURBON_200ml';
const DUPLICADA_PARA = '0011__BODY_SPLASH_LEAO_DO_DESERTO_BOURBON_200ml';

(async () => {
  console.log(APLICAR ? '*** APLICANDO EM PRODUÇÃO ***' : '--- ENSAIO (nada é gravado) ---');
  console.log('');
  const [pS, oS, cS, lS] = await Promise.all([
    db.ref('pedidos').once('value'), db.ref('ops').once('value'),
    db.ref('pedidos_comerciais').once('value'), db.ref('estoque_lotes').once('value'),
  ]);
  const pedidos = pS.val() || {}, ops = oS.val() || {}, comerciais = cS.val() || {}, lotes = lS.val() || {};

  // ─── 1. OPs com skuPedidoKey que não existe em /pedidos ────────────────
  const orfas = {};
  Object.entries(ops).forEach(([ok, o]) => {
    if (!o || !o.skuPedidoKey || pedidos[o.skuPedidoKey]) return;
    (orfas[o.skuPedidoKey] = orfas[o.skuPedidoKey] || []).push({ok, op: o});
  });

  const religar = [];   // o app já resolve: endireitar é higiene
  const perdidas = [];  // o app NÃO resolve: produção fora de qualquer pedido
  const ambiguas = [];  // mais de um alvo: escolha humana
  Object.keys(orfas).sort().forEach((k) => {
    const lista = orfas[k];
    const vivas = lista.filter((x) => !CANC.includes(x.op.status));
    const prod = lista.reduce((a, x) => a + (CANC.includes(x.op.status) ? 0 : getProduzido(x.op, 'linha')), 0);
    const cands = candidatos(k, pedidos);
    const info = {chave: k, itens: lista, ops: lista.length, vivas: vivas.length, prod,
      lotes: lista.map((x) => x.op.lote + (CANC.includes(x.op.status) ? '(canc)' : '')).join(', ')};
    if (cands.length === 1) { info.alvo = cands[0]; religar.push(info); }
    else if (cands.length > 1) { info.alvo = cands.join('  /  '); ambiguas.push(info); }
    else perdidas.push(info);
  });

  const soma = (l) => l.reduce((a, i) => a + i.prod, 0);
  const somaOps = (l) => l.reduce((a, i) => a + i.ops, 0);

  console.log('=== 1. OPs apontando para linha /pedidos inexistente ===');
  console.log('');
  console.log('  [A] O APP JÁ RESOLVE (zero à esquerda ou chave por descrição) — higiene');
  console.log('      ' + religar.length + ' chaves | ' + somaOps(religar) + ' OPs | ' + f(soma(religar)) + ' un');
  religar.forEach((i) => console.log('        ' + pad(i.chave, 42) + ' -> ' + pad(i.alvo, 34) +
    ' | ' + String(i.ops).padStart(2) + ' OP | ' + f(i.prod) + ' un'));
  console.log('');
  console.log('  [B] O APP NÃO RESOLVE — esta produção não entra em pedido nenhum');
  console.log('      ' + perdidas.length + ' chaves | ' + somaOps(perdidas) + ' OPs | ' + f(soma(perdidas)) + ' un');
  perdidas.forEach((i) => console.log('        ' + pad(i.chave, 42) + ' | ' + String(i.ops).padStart(2) +
    ' OP (' + i.vivas + ' viva(s)) | ' + pad(f(i.prod) + ' un', 11) + ' | ' + i.lotes.slice(0, 64)));
  if (ambiguas.length) {
    console.log('');
    console.log('  [C] AMBÍGUO — mais de uma linha candidata, não automatizar');
    ambiguas.forEach((i) => console.log('        ' + pad(i.chave, 42) + ' -> ' + i.alvo));
  }

  // ─── 2. linhas duplicadas (mesmo pedido + mesmo SKU) ───────────────────
  console.log('');
  console.log('=== 2. Linhas que o resolvedor do app não distingue ===');
  console.log('    (ele casa por dígitos do id + SKU. Duas linhas no mesmo par viram');
  console.log('     uma escolha posicional: a primeira chave do dicionário vence.)');
  const porPar = {};
  Object.entries(pedidos).forEach(([k, l]) => {
    if (!l || !l.sku) return;
    const idBruto = String(l.parentPedidoId || l.id || k.split('__')[0]);
    const id = digitsOnly(idBruto);
    if (!id) return;
    const par = parseInt(id, 10) + '||' + l.sku;
    (porPar[par] = porPar[par] || []).push({k, idBruto});
  });
  // Mesmo pedido escrito de dois jeitos (ids só-dígitos: "11" e "0011") é
  // duplicata de verdade. Ids de formatos diferentes ("0008" e "PED-0008",
  // "BRIA_01" e "REPOSICAO_BRIA_01") são PEDIDOS DIFERENTES que colidem no
  // resolvedor -- não se funde, se renumera.
  const grupos = Object.entries(porPar).filter(([, l]) => l.length > 1);
  const dups = grupos.filter(([, l]) => l.every((x) => /^\d+$/.test(x.idBruto)));
  const colisoes = grupos.filter(([, l]) => !l.every((x) => /^\d+$/.test(x.idBruto)));
  const mostrarGrupo = ([par, lista]) => {
    console.log('  pedido nº ' + par.split('||')[0] + ' · SKU ' + par.split('||')[1]);
    lista.slice().sort((a, b) => a.k.localeCompare(b.k)).forEach(({k}) => {
      const nOps = Object.values(ops).filter((o) => o && o.skuPedidoKey === k).length;
      console.log('     ' + pad(k, 50) + ' | qtdTotal ' + pad(f(n(pedidos[k].qtdTotal)), 9) +
        ' | produzido ' + pad(f(n(pedidos[k].produzido)), 9) + ' | ' + nOps + ' OP(s)');
    });
  };
  console.log('');
  console.log('  [A] DUPLICATA REAL — mesmo pedido, grafia diferente do número: ' + dups.length);
  dups.forEach(mostrarGrupo);
  if (!dups.length) console.log('      nenhuma.');
  console.log('');
  console.log('  [B] PEDIDOS DIFERENTES que colidem no resolvedor: ' + colisoes.length);
  console.log('      Não fundir. Enquanto existirem, uma OP cuja chave não bate exato');
  console.log('      pode ser creditada ao pedido errado.');
  colisoes.forEach(mostrarGrupo);
  if (!colisoes.length) console.log('      nenhuma.');

  // ─── 3. SKU com linha no PCP e ausente do pedido comercial ─────────────
  console.log('');
  console.log('=== 3. SKU com linha no PCP mas AUSENTE do pedido comercial ===');
  console.log('    (trava a expedição; corrigir pelo editor do Gestão Comercial, não aqui)');
  let nFalta = 0;
  Object.entries(comerciais).forEach(([pid, pc]) => {
    if (!pc) return;
    const skusCom = new Set(Object.values(pc.itens || {}).map((i) => i && i.sku).filter(Boolean));
    const minhas = Object.keys(pedidos).filter((k) => String(pedidos[k].parentPedidoId || pedidos[k].id || '') === pid);
    const faltam = minhas.filter((k) => pedidos[k].sku && !skusCom.has(pedidos[k].sku));
    if (!faltam.length) return;
    nFalta++;
    console.log('  pedido ' + pad(pid, 10) + ' | ' + pad(pc.cliente, 20) + ' | comercial tem ' + skusCom.size + ' SKU(s)');
    faltam.forEach((k) => {
      // paletes com saldo que ficam presos por causa desta ausência
      const presos = [];
      Object.values(lotes[pedidos[k].sku] || {}).forEach((l) => {
        if (l && l.itemTipo === 'produto' && n(l.saldoLote) > 0 && !l.expedicaoId) presos.push(l.identificadorPalete + ' (' + f(l.saldoLote) + ')');
      });
      console.log('      falta ' + pad(pedidos[k].sku, 14) + ' | qtdTotal ' + pad(f(n(pedidos[k].qtdTotal)), 9) +
        ' | linha ' + k);
      if (presos.length) console.log('           paletes com saldo deste SKU: ' + presos.join(', '));
    });
  });
  if (!nFalta) console.log('  nenhum.');

  // ─── 4. colisão de numeração entre pedidos comerciais ──────────────────
  console.log('');
  console.log('=== 4. Pedidos comerciais que colidem ignorando o zero à esquerda ===');
  console.log('    (o resolvedor casa por dígitos: dois pedidos com o mesmo número são');
  console.log('     uma armadilha. Renumerar é decisão do Comercial, não deste script.)');
  const porNum = {};
  Object.keys(comerciais).forEach((k) => {
    const d = digitsOnly(k);
    if (!d || !/^\d+$/.test(k)) return;
    (porNum[parseInt(d, 10)] = porNum[parseInt(d, 10)] || []).push(k);
  });
  let nCol = 0;
  Object.entries(porNum).forEach(([num, ks]) => {
    if (ks.length < 2) return;
    nCol++;
    console.log('  número ' + pad(num, 6) + ' -> ' + ks.map((k) => k + ' (' + ((comerciais[k] || {}).cliente || '?') + ')').join('  |  '));
  });
  if (!nCol) console.log('  nenhuma.');

  // ─── 5. o plano de gravação ────────────────────────────────────────────
  const updates = {};
  religar.forEach((i) => i.itens.forEach((x) => { updates['ops/' + x.ok + '/skuPedidoKey'] = i.alvo; }));
  if (FUNDIR && pedidos[DUPLICADA_DE] && pedidos[DUPLICADA_PARA]) {
    Object.entries(ops).forEach(([ok, o]) => {
      if (o && o.skuPedidoKey === DUPLICADA_DE) updates['ops/' + ok + '/skuPedidoKey'] = DUPLICADA_PARA;
    });
    updates['pedidos/' + DUPLICADA_DE] = null;
  }

  console.log('');
  console.log('=== PLANO ===');
  console.log('  repontar skuPedidoKey em ' + Object.keys(updates).filter((k) => k.startsWith('ops/')).length + ' OP(s)');
  if (FUNDIR) console.log('  apagar a linha duplicada ' + DUPLICADA_DE + ' (qtdTotal ' + f(n((pedidos[DUPLICADA_DE] || {}).qtdTotal)) + ')');
  else if (dups.length) console.log('  (linha duplicada NÃO será tocada — passe --fundir-duplicadas)');

  // recálculo de produzido, só sob pedido explícito
  let recalc = {};
  if (RECONCILIAR) {
    const depois = Object.assign({}, pedidos);
    if (FUNDIR) delete depois[DUPLICADA_DE];
    const somaPorLinha = {};
    Object.entries(ops).forEach(([ok, o]) => {
      if (!o || !o.skuPedidoKey) return;
      const chave = updates['ops/' + ok + '/skuPedidoKey'] || o.skuPedidoKey;
      const pk = resolvePedidoKeyBySkuKey(chave, depois);
      if (!pk) return;
      somaPorLinha[pk] = (somaPorLinha[pk] || 0) + getProduzido(o, 'linha');
    });
    const hoje = new Date().toISOString().slice(0, 10);
    // GUARDA: linha com produção gravada e NENHUMA OP que a sustente não é
    // zerada. Medido em 27/10: 9 linhas, 72.586 un nessa situação (0015__
    // MRFX0001 tem 39.888 un e as 22 OPs do SKU apontam para outros dois
    // pedidos; RETRABALHO__RETRAB06 e 0016__PRF-MENE-0001 não têm nenhuma OP
    // daquele SKU na base). Sobrescrever com zero apagaria histórico que o
    // script não sabe explicar -- isso é investigação, não reconciliação.
    // O botão "Reconciliar agora" do Histórico não precisa dessa guarda
    // porque percorre só as linhas que alguma OP resolve; este script
    // percorre todas, para poder BAIXAR valor inflado -- daí a guarda.
    const semLastro = [];
    Object.keys(depois).forEach((k) => {
      // estoque próprio credita o pedido sem OP: preservar esse crédito
      const alvo = (somaPorLinha[k] || 0) + n(depois[k].atendidoPorEstoque);
      const atual = n(depois[k].produzido);
      if (Math.abs(alvo - atual) < 0.001) return;
      if (!somaPorLinha[k] && atual > 0) { semLastro.push({k, atual}); return; }
      recalc[k] = {de: atual, para: alvo};
      updates['pedidos/' + k + '/produzido'] = alvo;
      updates['pedidos/' + k + '/ultimoApontamento'] = hoje;
    });
    console.log('  recalcular `produzido` em ' + Object.keys(recalc).length + ' linha(s):');
    Object.entries(recalc).sort((a, b) => Math.abs(b[1].para - b[1].de) - Math.abs(a[1].para - a[1].de))
      .slice(0, 25).forEach(([k, v]) => console.log('     ' + pad(k, 46) + ' ' + pad(f(v.de), 10) + ' -> ' + f(v.para)));
    if (Object.keys(recalc).length > 25) console.log('     ... e mais ' + (Object.keys(recalc).length - 25));
    if (semLastro.length) {
      console.log('');
      console.log('  PRESERVADAS pela guarda (' + semLastro.length + ' linhas, ' +
        f(semLastro.reduce((a, x) => a + x.atual, 0)) + ' un): têm produção gravada e');
      console.log('  nenhuma OP que a explique. NÃO serão zeradas. Precisam de investigação:');
      semLastro.sort((a, b) => b.atual - a.atual).forEach((x) =>
        console.log('     ' + pad(x.k, 46) + ' produzido ' + f(x.atual)));
    }
  } else {
    console.log('  (`produzido` NÃO será recalculado — passe --reconciliar)');
  }

  console.log('');
  console.log('NÃO automatizado, precisa de decisão sua:');
  console.log('  - ' + perdidas.length + ' chaves sem pedido (' + f(soma(perdidas)) + ' un): criar a linha ou aceitar que é produção sem pedido');
  console.log('  - ' + nFalta + ' pedido(s) com SKU faltando no comercial: entra pelo editor do Gestão Comercial');
  console.log('  - ' + nCol + ' colisão(ões) de numeração: renumerar um dos pedidos');

  if (!APLICAR) {
    console.log('');
    console.log('--- ENSAIO. Nada foi gravado. Rode de novo com --aplicar. ---');
    process.exit(0);
  }
  if (!Object.keys(updates).length) {
    console.log('');
    console.log('Nada a gravar.');
    process.exit(0);
  }

  // backup antes de escrever
  const dir = path.join(root, 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const arq = path.join(dir, 'sanear-vinculos-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  const opsAfetadas = {};
  Object.keys(updates).filter((k) => k.startsWith('ops/')).forEach((k) => {
    const ok = k.split('/')[1];
    opsAfetadas[ok] = {lote: ops[ok].lote, skuPedidoKey: ops[ok].skuPedidoKey};
  });
  fs.writeFileSync(arq, JSON.stringify({
    em: new Date().toISOString(), script: 'scripts/sanear-vinculos-pedido.js',
    flags: {aplicar: APLICAR, fundirDuplicadas: FUNDIR, reconciliar: RECONCILIAR},
    antes: {ops: opsAfetadas, pedidos: pedidos}, updates: updates,
  }, null, 2));
  console.log('');
  console.log('backup: ' + arq);

  await db.ref().update(updates);
  console.log('Gravado. ' + Object.keys(updates).length + ' caminhos atualizados.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
