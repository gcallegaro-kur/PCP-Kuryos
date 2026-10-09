'use strict';
/* Toda OP encerrada tem que conseguir soltar o material que reservou.
 *
 * Por que existe: em 09/10/2026 o usuário perguntou por que havia empenho em
 * OP já encerrada. A resposta: os quatro pontos que chamam liberarEmpenhoLote
 * montavam a lista de materiais a partir de `ops/{lote}.materiaisConsumo` e,
 * quando o campo não existia, nem chamavam a função. E o campo quase nunca
 * existe -- só 74 das 1.460 OPs da base o têm, porque passou a ser gravado
 * nas emissões a partir de 10/09/2026. Toda OP anterior era ESTRUTURALMENTE
 * incapaz de liberar o que reservou.
 *
 * Medido na base: 18 reservas presas em 2 OPs concluídas (26244/02 e
 * 26244/15), 37.621 un./kg descontadas do disponível sem ninguém esperando.
 *
 * A correção: sem a lista, o próprio índice `estoque/{m}/empenhos/{lote}`
 * responde quem segura. Este teste trava os dois caminhos e o fato de que
 * nenhum chamador volta a exigir materiaisConsumo.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

let n = 0;
const eq = (a, b, m) => { n++; assert.equal(a, b, m); };
const ok = (c, m) => { n++; assert.ok(c, m); };

// ── Carrega as funções reais de shared/utils.js ────────────────────────────
const ctx = {
  console, Math, String, Number, Object, Array, JSON, Date, RegExp,
  parseInt, parseFloat, isNaN, Promise, document: undefined
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/shared/utils.js', 'utf8'), ctx);

/* Banco de mentira com o bastante de RTDB: transaction em estoque/{mat} e
   once('value') em estoque/ com snapshot navegável por child(). */
function fakeDb(estoque, opts) {
  const o = opts || {};
  let leiturasEstoque = 0;
  const snapDe = (val) => ({
    exists: () => val !== undefined && val !== null,
    val: () => (val === undefined ? null : val),
    child: (cam) => {
      let v = val;
      String(cam).split('/').forEach((seg) => { v = (v && typeof v === 'object') ? v[seg] : undefined; });
      return snapDe(v);
    }
  });
  return {
    get leiturasEstoque() { return leiturasEstoque; },
    ref: (caminho) => ({
      once: () => {
        if (caminho !== 'estoque') throw new Error('once inesperado em ' + caminho);
        leiturasEstoque++;
        if (o.falharLeitura) return Promise.reject(new Error('permission denied'));
        return Promise.resolve({
          forEach: (cb) => { Object.keys(estoque).forEach((k) => cb(Object.assign(snapDe(estoque[k]), {key: k}))); }
        });
      },
      transaction: (fn) => {
        const partes = caminho.split('/');
        const k = partes[1];
        const res = fn(estoque[k] === undefined ? null : estoque[k]);
        if (res !== undefined) estoque[k] = res;
        return Promise.resolve({committed: true});
      }
    })
  };
}

/* A base reduzida: o lote 26244/02 segura 6 materiais, e um sétimo material
   é reservado por OUTRA OP -- que não pode ser tocada. */
const baseInicial = () => ({
  'EP-00009': {saldoAtual: 20000, saldoEmpenhado: 8798, empenhos: {
    '26244-02': {lote: '26244/02', qtdEmpenhada: 4400, sku: 'MRARBS12'},
    '26244-15': {lote: '26244/15', qtdEmpenhada: 4398, sku: 'MRARBS12'}}},
  'ES-00014': {saldoAtual: 5000, saldoEmpenhado: 4400, empenhos: {
    '26244-02': {lote: '26244/02', qtdEmpenhada: 4400}}},
  'MPES-00008': {saldoAtual: 100, saldoEmpenhado: 24.132, empenhos: {
    '26244-02': {lote: '26244/02', qtdEmpenhada: 24.132}}},
  'MPGR-00127': {saldoAtual: 2000, saldoEmpenhado: 606.66, empenhos: {
    '26244-02': {lote: '26244/02', qtdEmpenhada: 606.66}}},
  // Reserva de outra OP, viva: intocável.
  'EP-00106': {saldoAtual: 9000, saldoEmpenhado: 1000, empenhos: {
    '26290-01': {lote: '26290/01', qtdEmpenhada: 1000}}},
  // Material sem empenho nenhum.
  'ET-00018': {saldoAtual: 400, saldoEmpenhado: 0}
});

// ── 1. Sem a lista de materiais: o índice responde ─────────────────────────
{
  const est = baseInicial();
  const db = fakeDb(est);

  const p = ctx.liberarEmpenhoLote(db, '26244/02');
  ok(p && typeof p.then === 'function', 'devolve promise mesmo sem lista de materiais');
  p.then(() => {
    eq(est['EP-00009'].saldoEmpenhado, 4398, 'sai o 26244/02 e fica o 26244/15 do mesmo material');
    ok(!est['EP-00009'].empenhos['26244-02'], 'a reserva do lote some do índice');
    ok(est['EP-00009'].empenhos['26244-15'], 'a do outro lote continua');
    eq(est['ES-00014'].saldoEmpenhado, 0, 'material que só esse lote segurava zera');
    eq(est['MPES-00008'].saldoEmpenhado, 0, 'inclusive com casas decimais');
    eq(est['MPGR-00127'].saldoEmpenhado, 0);
    eq(est['EP-00106'].saldoEmpenhado, 1000, 'reserva de OUTRA OP não pode ser tocada');
    ok(est['EP-00106'].empenhos['26290-01'], 'nem sumir do índice');
    eq(est['ET-00018'].saldoEmpenhado, 0, 'material sem empenho fica como estava');
    eq(db.leiturasEstoque, 1, 'uma leitura de estoque, não uma por material');

    // ── 2. Idempotente: rodar de novo não faz nada nem quebra ──
    return ctx.liberarEmpenhoLote(db, '26244/02').then(() => {
      eq(est['EP-00009'].saldoEmpenhado, 4398, 'segunda passada não mexe em nada');
      eq(est['ES-00014'].saldoEmpenhado, 0);
    });
  }).then(() => {
    // ── 3. Com a lista (caminho das OPs novas): segue funcionando ──
    const est2 = baseInicial();
    const db2 = fakeDb(est2);
    return ctx.liberarEmpenhoLote(db2, '26244/02', ['EP-00009', 'ES-00014']).then(() => {
      eq(est2['EP-00009'].saldoEmpenhado, 4398, 'libera os informados');
      eq(est2['ES-00014'].saldoEmpenhado, 0);
      eq(est2['MPES-00008'].saldoEmpenhado, 24.132, 'e SÓ os informados — comportamento antigo preservado');
      eq(db2.leiturasEstoque, 0, 'com a lista em mãos não paga a leitura de estoque');
    });
  }).then(() => {
    // ── 4. Lista com buracos não vira leitura do estoque inteiro ──
    const est3 = baseInicial();
    const db3 = fakeDb(est3);
    return ctx.liberarEmpenhoLote(db3, '26244/02', ['ES-00014', null, '', undefined]).then(() => {
      eq(est3['ES-00014'].saldoEmpenhado, 0, 'o código válido da lista é liberado');
      eq(db3.leiturasEstoque, 0, 'a lista não estava vazia — não precisa varrer');
    });
  }).then(() => {
    // ── 5. Best-effort: leitura negada não pode derrubar o encerramento ──
    const est4 = baseInicial();
    const db4 = fakeDb(est4, {falharLeitura: true});
    return ctx.liberarEmpenhoLote(db4, '26244/02').then(() => {
      ok(true, 'falha de leitura resolve em silêncio, não rejeita');
      n++;
      eq(est4['ES-00014'].saldoEmpenhado, 4400, 'e nada é alterado pela metade');
    });
  }).then(() => {
    // ── 6. Sem lote não faz nada ──
    const est5 = baseInicial();
    const db5 = fakeDb(est5);
    return ctx.liberarEmpenhoLote(db5, '').then(() => {
      eq(db5.leiturasEstoque, 0, 'sem lote, nem lê');
    });
  }).then(() => {
    // ── 7. Nenhum chamador volta a exigir materiaisConsumo ──
    const fontes = {'public/ops.html': 3, 'public/form.html': 1};
    Object.keys(fontes).forEach((arq) => {
      const src = fs.readFileSync(arq, 'utf8');
      const chamadas = (src.match(/liberarEmpenhoLote\(/g) || []).length;
      ok(chamadas >= fontes[arq], arq + ' continua chamando liberarEmpenhoLote (' + chamadas + ')');
      eq((src.match(/&&\s*op\.materiaisConsumo\s*&&/g) || []).length, 0,
        arq + ': nenhuma chamada pode voltar a ser barrada por `&& op.materiaisConsumo &&` — era isso que prendia a reserva');
      eq((src.match(/opAtual\.materiaisConsumo\)\s*\{/g) || []).length, 0,
        arq + ': nem pela variante do apontamento');
      eq((src.match(/if \(op\.materiaisConsumo && typeof liberarEmpenhoLote/g) || []).length, 0,
        arq + ': nem no cancelamento');
    });

    console.log('OK liberacao de empenho: ' + n + ' verificacoes — OP sem materiaisConsumo solta o que reservou, ' +
      'o indice responde quem segura, reserva de outra OP fica intacta e nenhum chamador volta a exigir o campo.');
  }).catch((e) => { console.error(e); process.exit(1); });
}
