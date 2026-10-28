'use strict';
/* Desmembrar palete de PA (Montar Carga): regras puras + gravação contra um banco simulado. */
const assert = require('node:assert/strict');
const D = require('./public/shared/desmembrar-palete.js');

const lote = (op, n, cx, mult, parcial, extra) => Object.assign({
  itemTipo: 'produto', itemCodigo: 'MRARBS07', itemNome: 'BODY SPLASH', unidade: 'un', skuPedidoKey: '30__MRARBS07', cliente: 'MISS ROSE',
  loteOrigem: op, opKey: 'op_' + op.replace('/', '_'), opLote: op, paleteNumero: n, identificadorPalete: 'PA-' + op.replace('/', '-') + '-P' + n,
  caixasFechadas: cx, unidadesPorCaixa: mult, unidadesCaixaParcial: parcial, saldoLote: cx * mult + parcial, qtdOriginal: cx * mult + parcial,
  enderecoKey: 'GAL-1-1-1', enderecoCodigo: 'GAL-1.1.1', origemTipo: 'conferencia_pa', status: 'LIBERADO_EXPEDICAO',
  qualidade: {laudo: 'OK'}, dataValidade: '2028-10-01', criadoEm: '2026-10-20T12:00:00Z', criadoPor: 'Ana'
}, extra || {});

// ── Os cinco lotes do pedido do usuário ──
const casos = [
  ['26292/01', lote('26292/01', 1, 97, 48, 0), [{caixas: 50}, {caixas: 47}]],
  ['26286/05', lote('26286/05', 1, 62, 100, 80), [{caixas: 24}, {caixas: 24}, {caixas: 14, parcial: 80}]],
  ['26293/01', lote('26293/01', 1, 100, 24, 17), [{caixas: 44, parcial: 17}, {caixas: 56}]],
  ['26293/03', lote('26293/03', 1, 97, 24, 0), [{caixas: 56}, {caixas: 41}]],
  ['26293/02', lote('26293/02', 1, 95, 24, 0), [{caixas: 39}, {caixas: 56}]]
];
casos.forEach(([nome, l, partes]) => {
  assert.equal(D.podeDesmembrar(l), true, nome);
  const r = D.conferir(l, partes);
  assert.equal(r.ok, true, nome + ': ' + r.mensagem);
  const p = D.planejar(l, partes, {x: l}, {autor: 'Carlos', agora: '2026-10-28T10:00:00Z', loteKey: 'x'});
  const soma = p.original.saldoLote + p.filhos.reduce((t, f) => t + f.dados.saldoLote, 0);
  assert.equal(soma, l.saldoLote, nome + ': o total de unidades não muda');
  assert.equal(p.original.caixasFechadas + p.filhos.reduce((t, f) => t + f.dados.caixasFechadas, 0), l.caixasFechadas, nome + ': o total de caixas não muda');
  assert.equal(p.original.unidadesCaixaParcial + p.filhos.reduce((t, f) => t + f.dados.unidadesCaixaParcial, 0), l.unidadesCaixaParcial, nome + ': a parcial é a mesma');
  assert.equal(p.filhos.length, partes.length - 1);
});

// ── Identificação e herança dos novos paletes ──
{
  const l = casos[0][1];
  const p = D.planejar(l, casos[0][2], {x: l}, {autor: 'Carlos', agora: '2026-10-28T10:00:00Z', loteKey: 'x'});
  const f = p.filhos[0];
  assert.equal(f.identificador, 'PA-26292-01-P2');
  assert.equal(f.loteKey, 'pa_op_26292_01_p2');
  assert.equal(f.dados.status, 'LIBERADO_EXPEDICAO', 'a liberação da Qualidade acompanha');
  assert.deepEqual(f.dados.qualidade, {laudo: 'OK'});
  assert.equal(f.dados.skuPedidoKey, '30__MRARBS07'); assert.equal(f.dados.opKey, l.opKey); assert.equal(f.dados.enderecoKey, 'GAL-1-1-1');
  assert.equal(f.dados.dataValidade, '2028-10-01'); assert.equal(f.dados.criadoEm, '2026-10-20T12:00:00Z', 'dias em estoque seguem a entrada real');
  assert.equal(f.dados.origemTipo, 'conferencia_pa');
  assert.equal(f.dados.desmembramento.deIdentificador, 'PA-26292-01-P1');
  assert.equal(p.original.desmembramento.saldoAntes, 4656); assert.deepEqual(p.original.desmembramento.filhos, ['pa_op_26292_01_p2']);
  assert.equal(f.dados.saldoLote, 47 * 48);
  // O objeto original não é alterado por planejar.
  assert.equal(l.caixasFechadas, 97);
}
// Numeração continua depois do maior palete existente da OP e não colide com chave existente.
{
  const a = lote('26293/01', 1, 100, 24, 17), b = lote('26293/01', 2, 10, 24, 0), c = lote('26293/01', 3, 10, 24, 0);
  const p = D.planejar(a, [{caixas: 44, parcial: 17}, {caixas: 56}], {p1: a, p2: b, p3: c, pa_op_26293_01_p4: {}}, {autor: 'X'});
  assert.equal(p.filhos[0].identificador, 'PA-26293-01-P5');
  assert.equal(p.filhos[0].loteKey, 'pa_op_26293_01_p5');
}

// ── Recusas ──
const l = casos[0][1];
const recusa = (partes, re, lt) => assert.throws(() => D.planejar(lt || l, partes, {}, {}), re);
recusa([{caixas: 50}, {caixas: 46}], /Faltam 1 caixa/);
recusa([{caixas: 50}, {caixas: 48}], /Sobram 1 caixa/);
recusa([{caixas: 97}], /ao menos dois/);
recusa([{caixas: 97}, {caixas: 0}], /vazio/);
recusa([{caixas: 50.5}, {caixas: 46.5}], /inteiros/);
recusa([{caixas: -1}, {caixas: 98}], /inteiros/);
recusa([{caixas: 50, parcial: 5}, {caixas: 47}], /Este palete não tem caixa parcial/);
const comParcial = lote('26286/05', 1, 62, 100, 80);
recusa([{caixas: 30, parcial: 40}, {caixas: 32, parcial: 40}], /uma caixa só/, comParcial);
recusa([{caixas: 30}, {caixas: 32}], /parcial de 80 un precisa ficar/, comParcial);
recusa([{caixas: 30, parcial: 100}, {caixas: 32}], /menos de 100/, comParcial);
assert.equal(D.podeDesmembrar(lote('X/01', 1, 1, 48, 0)), false, 'uma caixa só não se divide');
assert.equal(D.podeDesmembrar(lote('X/01', 1, 0, 48, 20)), false, 'só a parcial não se divide');
assert.equal(D.podeDesmembrar(lote('X/01', 1, 1, 48, 20)), true, 'uma caixa + a parcial: dois volumes');
assert.equal(D.podeDesmembrar(Object.assign(lote('X/01', 1, 5, 48, 0), {saldoLote: 200})), false, 'composição que não fecha com o saldo');
assert.equal(D.podeDesmembrar(Object.assign(lote('X/01', 1, 5, 48, 0), {itemTipo: 'material'})), false);
assert.equal(D.podeDesmembrar(Object.assign(lote('X/01', 1, 5, 48, 0), {saldoLote: 0})), false);
assert.match(D.conferir(Object.assign(lote('X/01', 1, 5, 48, 0), {saldoLote: 200}), [{caixas: 2}, {caixas: 3}]).mensagem, /não fecha/);

// ── Gravação contra um banco simulado ──
function banco(inicial) {
  const raiz = JSON.parse(JSON.stringify(inicial));
  let seq = 0;
  const partes = (p) => String(p).split('/').filter(Boolean);
  const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), raiz);
  const gravar = (p, v) => {
    const ks = partes(p); let o = raiz;
    ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
    if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
  };
  const db = {raiz, falharUpdate: false, ref(p) {
    p = p || '';
    return {
      once: async () => ({val: () => { const v = ler(p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); }}),
      push: () => { const k = 'mov' + (++seq); return {key: k}; },
      transaction: async (fn) => {
        const atual = ler(p) === undefined ? null : JSON.parse(JSON.stringify(ler(p)));
        const novo = fn(atual);
        if (novo === undefined) return {committed: false, snapshot: {val: () => atual}};
        if (novo !== null) gravar(p, novo);
        return {committed: novo !== null, snapshot: {val: () => novo}};
      },
      update: async (u) => {
        if (db.falharUpdate) throw new Error('rede caiu');
        Object.keys(u).forEach((k) => gravar((p ? p + '/' : '') + k, u[k]));
      },
      key: p.split('/').pop()
    };
  }};
  return db;
}
(async () => {
  const original = lote('26292/01', 1, 97, 48, 0);
  const db = banco({estoque_lotes: {MRARBS07: {pa_op_26292_01_p1: original}}, movimentos_estoque: {}});
  const r = await D.executar(db, {itemKey: 'MRARBS07', loteKey: 'pa_op_26292_01_p1', partes: [{caixas: 50}, {caixas: 47}], autor: 'Carlos'});
  assert.deepEqual(r.novos, [{loteKey: 'pa_op_26292_01_p2', identificador: 'PA-26292-01-P2'}]);
  const lotes = db.raiz.estoque_lotes.MRARBS07;
  assert.equal(lotes.pa_op_26292_01_p1.saldoLote, 2400); assert.equal(lotes.pa_op_26292_01_p1.caixasFechadas, 50);
  assert.equal(lotes.pa_op_26292_01_p2.saldoLote, 2256); assert.equal(lotes.pa_op_26292_01_p2.caixasFechadas, 47);
  assert.equal(lotes.pa_op_26292_01_p1.saldoLote + lotes.pa_op_26292_01_p2.saldoLote, 4656, 'nada entra nem sai do estoque');
  assert.equal(lotes.pa_op_26292_01_p1.desmembramento.emAndamento, undefined, 'a reserva é liberada');
  assert.deepEqual(lotes.pa_op_26292_01_p1.desmembramento.filhos, ['pa_op_26292_01_p2']);
  const movs = Object.values(db.raiz.movimentos_estoque.MRARBS07);
  assert.equal(movs.length, 1); assert.equal(movs[0].qtd, 2256); assert.equal(movs[0].autor, 'Carlos'); assert.match(movs[0].ref, /P1 -> PA-26292-01-P2/);

  // Segunda divisão do mesmo palete (agora com 50 cx): continua a numeração.
  const r2 = await D.executar(db, {itemKey: 'MRARBS07', loteKey: 'pa_op_26292_01_p1', partes: [{caixas: 30}, {caixas: 20}], autor: 'Carlos'});
  assert.equal(r2.novos[0].identificador, 'PA-26292-01-P3');

  // Carga agendada: bloqueia sem gravar nada.
  const db2 = banco({estoque_lotes: {MRARBS07: {pa_op_26292_01_p1: original}}, movimentos_estoque: {}});
  await assert.rejects(D.executar(db2, {itemKey: 'MRARBS07', loteKey: 'pa_op_26292_01_p1', partes: [{caixas: 50}, {caixas: 47}], emCarga: () => true}), /carga agendada/);
  assert.equal(db2.raiz.estoque_lotes.MRARBS07.pa_op_26292_01_p1.caixasFechadas, 97);

  // Falha ao gravar os novos: o original volta ao que era.
  const db3 = banco({estoque_lotes: {MRARBS07: {pa_op_26292_01_p1: original}}, movimentos_estoque: {}});
  db3.falharUpdate = true;
  await assert.rejects(D.executar(db3, {itemKey: 'MRARBS07', loteKey: 'pa_op_26292_01_p1', partes: [{caixas: 50}, {caixas: 47}]}), /original foi mantido/);
  const volta = db3.raiz.estoque_lotes.MRARBS07.pa_op_26292_01_p1;
  assert.equal(volta.caixasFechadas, 97); assert.equal(volta.saldoLote, 4656); assert.equal(volta.desmembramento, undefined);
  assert.equal(Object.keys(db3.raiz.estoque_lotes.MRARBS07).length, 1);

  // Palete que sumiu / divisão que não fecha.
  await assert.rejects(D.executar(banco({estoque_lotes: {}}), {itemKey: 'A', loteKey: 'b', partes: [{caixas: 1}, {caixas: 1}]}), /não encontrado/);
  await assert.rejects(D.executar(db2, {itemKey: 'MRARBS07', loteKey: 'pa_op_26292_01_p1', partes: [{caixas: 50}, {caixas: 40}]}), /Faltam 7 caixa/);

  console.log('run_desmembrar_palete_test: OK');
})().catch((e) => { console.error(e); process.exit(1); });
