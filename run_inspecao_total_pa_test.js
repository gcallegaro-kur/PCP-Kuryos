'use strict';
/* Inspeção total de PA (23/10/2026): sinalizar -> designar -> inspecionar por
   motivo -> decidir (parcial, vários motivos) -> OPs de retrabalho + liberação. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const I = require('./public/shared/inspecao-total-pa.js');
const L = require('./public/shared/laudo-pa-lote.js');
const RT = require('./public/shared/retrabalho-op.js');

const ctxU = {console, Math, String, Number, Object, Array, JSON, Date, RegExp, parseInt, parseFloat, isNaN, document: undefined};
ctxU.window = ctxU; vm.createContext(ctxU);
vm.runInContext(fs.readFileSync('public/shared/utils.js', 'utf8'), ctxU);
const deps = (rncs) => ({qualidadeDoLaudo: ctxU.qualidadeDoLaudo, sanitizeKey: ctxU.sanitizeKey,
  abrirRnc: (dbRef, dados) => { rncs.push(dados); return Promise.resolve({ok: true, numero: 'RNC-9'}); }});

const pal = (n, extra) => Object.assign({
  itemTipo: 'produto', itemCodigo: 'SKU1', itemNome: 'BODY SPLASH X', unidade: 'un', opKey: '26280-01', opLote: '26280/01', loteOrigem: '26280/01',
  paleteNumero: n, identificadorPalete: 'PA-26280-01-P' + n, caixasFechadas: n === 1 ? 60 : 30, unidadesCaixaParcial: 0, unidadesPorCaixa: 24,
  saldoLote: n === 1 ? 1440 : 720, status: 'QUARENTENA', origemTipo: 'conferencia_pa', enderecoCodigo: 'A-0' + n, criadoEm: '2026-10-10T10:00:00Z'
}, extra || {});
const OPORIG = {lote: '26280/01', sku: 'SKU1', produto: 'BODY SPLASH X', cliente: 'CLI', produzidoLinha: 2160, pecasPorCaixa: 24, status: 'Concluído'};
const base = () => ({estoque_lotes: {SKU1: {pa_1: pal(1), pa_2: pal(2)}}, ops: {'26280-01': Object.assign({}, OPORIG)}});

function bancoFalso(dados) {
  const db = JSON.parse(JSON.stringify(dados));
  const get = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), db);
  const set = (p, v) => {
    const ks = p.split('/').filter(Boolean); let o = db;
    ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
    if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
  };
  let seq = 0; const log = {updates: 0};
  const mk = (p, filtro) => ({
    once: () => {
      let v = get(p); v = v === undefined ? null : JSON.parse(JSON.stringify(v));
      if (filtro && v) v = Object.fromEntries(Object.entries(v).filter(([k]) => k >= filtro.de && k <= filtro.ate));
      return Promise.resolve({val: () => v});
    },
    transaction(fn) {
      const atual = get(p) === undefined ? null : JSON.parse(JSON.stringify(get(p)));
      const r = fn(atual);
      if (r === undefined) return Promise.resolve({committed: false});
      set(p, r); return Promise.resolve({committed: true, snapshot: {val: () => (get(p) === undefined ? null : get(p))}});
    },
    set(v) { set(p, v); return Promise.resolve(); },
    remove() { set(p, null); return Promise.resolve(); },
    push() { return Object.assign(Promise.resolve(), {key: 'push' + (++seq)}); },
    update(u) { log.updates++; Object.keys(u || {}).forEach((k) => set(p ? p + '/' + k : k, u[k])); return Promise.resolve(); },
    orderByKey() { const o = this; return {startAt: (de) => ({endAt: (ate) => mk(p, {de, ate: ate.replace('', '￿')})})}; }
  });
  return {db, log, ref: (p) => mk(p || '')};
}

(async () => {
  // ── Puras: motivo, prazo, fila ──
  assert.equal(I.chaveMotivo('  Tampa  SOLTA '), 'tampa_solta'); assert.equal(I.chaveMotivo('Rótulo torto!'), 'rotulo_torto');
  assert.equal(I.prazoHoras(8), 8); assert.equal(I.prazoHoras(null), 24); assert.equal(I.prazoHoras(0), 24); assert.equal(I.prazoHoras(9999), 24);
  const sit = I.situacaoPrazo({estado: 'EM_INSPECAO', designacao: {prazoEm: '2026-10-23T12:00:00Z'}}, '2026-10-23T11:30:00Z');
  assert.deepEqual(sit, {restanteMin: 30, vencido: false}); assert.equal(I.textoPrazo(sit), 'faltam 30min');
  const atras = I.situacaoPrazo({estado: 'EM_INSPECAO', designacao: {prazoEm: '2026-10-23T12:00:00Z'}}, '2026-10-23T14:05:00Z');
  assert.equal(atras.vencido, true); assert.equal(I.textoPrazo(atras), 'vencido há 2h 5min');
  assert.equal(I.situacaoPrazo({estado: 'AGUARDANDO_DECISAO', designacao: {prazoEm: 'x'}}), null);

  // ── Validação do resultado ──
  const paletes = L.paletesDoLote({SKU1: {pa_1: pal(1, {status: 'INSPECAO_TOTAL'}), pa_2: pal(2, {status: 'INSPECAO_TOTAL'})}}, '26280-01').map((p) => p);
  assert.equal(paletes.length, 2);
  const v0 = I.validarResultado(paletes, {linhas: [{loteKey: 'pa_1', inspecionadas: 1440, defeitos: [{motivo: 'Tampa solta', qtd: 30}, {motivo: 'tampa solta', qtd: 10}, {motivo: 'Rótulo torto', qtd: 20}]},
    {loteKey: 'pa_2', inspecionadas: 720, defeitos: [{motivo: 'TAMPA SOLTA', qtd: 5}]}]});
  assert.equal(v0.ok, true, v0.erros && v0.erros.join('|'));
  assert.equal(v0.resultado.inspecionadas, 2160); assert.equal(v0.resultado.naoConformes, 65); assert.equal(v0.resultado.conformes, 2095);
  assert.equal(v0.resultado.motivos.tampa_solta.achada, 45, 'mesmo motivo some entre paletes e grafias');
  assert.deepEqual(v0.resultado.motivos.tampa_solta.porPalete, {pa_1: 40, pa_2: 5});
  const ruim = (r, re) => { const v = I.validarResultado(paletes, r); assert.equal(v.ok, false); assert.match(v.erros.join(' | '), re); };
  ruim({linhas: []}, /pelo menos um palete/);
  ruim({linhas: [{loteKey: 'pa_1', inspecionadas: 1440}]}, /Falta a inspeção do palete PA-26280-01-P2/);
  ruim({linhas: [{loteKey: 'pa_1', inspecionadas: 1440}, {loteKey: 'pa_2', inspecionadas: 700}]}, /inspeção é TOTAL/);
  ruim({linhas: [{loteKey: 'pa_1', inspecionadas: 2000}, {loteKey: 'pa_2', inspecionadas: 720}]}, /mais que as 1440/);
  ruim({linhas: [{loteKey: 'pa_1', inspecionadas: 1440, defeitos: [{motivo: '', qtd: 3}]}, {loteKey: 'pa_2', inspecionadas: 720}]}, /precisa de um motivo/);
  ruim({linhas: [{loteKey: 'pa_1', inspecionadas: 1440, defeitos: [{motivo: 'x', qtd: 1.5}]}, {loteKey: 'pa_2', inspecionadas: 720}]}, /inteiro maior que zero/);
  ruim({linhas: [{loteKey: 'pa_1', inspecionadas: 10, defeitos: [{motivo: 'x', qtd: 11}]}, {loteKey: 'pa_2', inspecionadas: 720}], justificativaParcial: 'ok'}, /somam 11, mais que as 10/);
  ruim({linhas: [{loteKey: 'zz', inspecionadas: 1}]}, /não pertence/);
  assert.equal(I.validarResultado(paletes, {linhas: [{loteKey: 'pa_1', inspecionadas: 1400}, {loteKey: 'pa_2', inspecionadas: 720}], justificativaParcial: '40 un quebraram na queda'}).resultado.parcial, true);

  // ── Alocação das reprovadas nos paletes ──
  const res = v0.resultado;
  const al = I.alocarReprovadas(res, {tampa_solta: {reprovada: 42}, rotulo_torto: {reprovada: 20}});
  assert.equal(al.ok, true);
  assert.deepEqual(al.porPalete.pa_1.porMotivo, {tampa_solta: 40, rotulo_torto: 20}); assert.equal(al.porPalete.pa_1.total, 60);
  assert.deepEqual(al.porPalete.pa_2.porMotivo, {tampa_solta: 2}); assert.equal(al.porPalete.pa_2.total, 2);
  assert.match(I.alocarReprovadas(res, {tampa_solta: {reprovada: 46}}).erros[0], /reprovou 46, mas a inspeção achou 45/);
  assert.match(I.alocarReprovadas(res, {tampa_solta: {reprovada: -1}}).erros[0], /inteiro/);
  assert.deepEqual(I.caixasApos(pal(1), 1380), {caixasFechadas: 57, unidadesCaixaParcial: 12});
  assert.equal(I.caixasApos({saldoLote: 100, caixasFechadas: 0, unidadesCaixaParcial: 100}, 90), null, 'sem tamanho de caixa: não inventa');

  // ── Fluxo completo contra o banco de mentira ──
  const b = bancoFalso(base()), rncs = [];
  const g = L.filaLotes(b.db.estoque_lotes)[0];
  const ctx = {itemCodigo: 'SKU1', itemNome: 'BODY SPLASH X', unidade: 'un', loteOrigem: '26280/01', opLote: '26280/01', op: b.db.ops['26280-01']};

  // 1) sinalizar exige motivo
  assert.match((await I.sinalizar(b, g.opKey, g.paletes, {motivo: ' '}, 'Qua', ctx)).erro, /Descreva o problema/);
  const s1 = await I.sinalizar(b, g.opKey, g.paletes, {motivo: 'Frascos com vazamento na caixa 12', fotosDispensadas: false}, 'Qua', ctx);
  assert.equal(s1.ok, true); assert.equal(s1.paletes, 2);
  assert.equal(b.db.ops['26280-01'].inspecaoTotal.estado, 'AGUARDANDO_DESIGNACAO');
  assert.equal(b.db.ops['26280-01'].inspecaoTotal.sinalizacao.saldoLote, 2160);
  assert.equal(b.db.estoque_lotes.SKU1.pa_1.status, 'INSPECAO_TOTAL'); assert.equal(b.db.estoque_lotes.SKU1.pa_2.status, 'INSPECAO_TOTAL');
  assert.equal(L.filaLotes(b.db.estoque_lotes).length, 0, 'sai da fila de laudo');
  assert.equal(b.log.updates, 1, 'um único update multi-path');
  assert.equal(Object.values(b.db.ops['26280-01'].inspecaoTotal.historico)[0].acao, 'SINALIZADO');
  // sinalizar de novo / lote sem quarentena
  assert.match((await I.sinalizar(b, g.opKey, g.paletes, {motivo: 'x'}, 'Qua', ctx)).erro, /já foi sinalizado/);
  assert.equal(I.fila(b.db.ops)[0].estado, 'AGUARDANDO_DESIGNACAO');

  // 2) designar (pela produção) com prazo
  assert.match((await I.designar(b, g.opKey, {responsavel: ''}, 'Prod')).erro, /Escolha quem/);
  const d1 = await I.designar(b, g.opKey, {responsavel: 'Luana', prazoHoras: 8}, 'Prod', '2026-10-23T10:00:00.000Z');
  assert.equal(d1.ok, true); assert.equal(d1.prazoEm, '2026-10-23T18:00:00.000Z');
  assert.equal(b.db.ops['26280-01'].inspecaoTotal.estado, 'EM_INSPECAO');
  assert.equal(b.db.ops['26280-01'].inspecaoTotal.designacao.responsavel, 'Luana');
  // redesignar durante a inspeção é permitido
  assert.equal((await I.designar(b, g.opKey, {responsavel: 'Marta', prazoHoras: 4}, 'Prod', '2026-10-23T11:00:00.000Z')).ok, true);
  assert.equal(b.db.ops['26280-01'].inspecaoTotal.designacao.responsavel, 'Marta');

  // 3) resultado: validação e atraso
  const pInsp = I.paletesDaInspecao(b.db.estoque_lotes, '26280-01');
  assert.equal(pInsp.length, 2);
  assert.equal((await I.registrarResultado(b, g.opKey, pInsp, {linhas: [{loteKey: 'pa_1', inspecionadas: 10}]}, 'Marta')).ok, false);
  assert.equal(b.db.ops['26280-01'].inspecaoTotal.estado, 'EM_INSPECAO', 'resultado inválido não muda o estado');
  const r1 = await I.registrarResultado(b, g.opKey, pInsp, {observacao: 'feito em 2 turnos', linhas: [
    {loteKey: 'pa_1', inspecionadas: 1440, defeitos: [{motivo: 'Tampa solta', qtd: 40}, {motivo: 'Rótulo torto', qtd: 20}]},
    {loteKey: 'pa_2', inspecionadas: 720, defeitos: [{motivo: 'Tampa solta', qtd: 5}]}]}, 'Marta', '2026-10-23T16:30:00.000Z');
  assert.equal(r1.ok, true);
  assert.equal(b.db.ops['26280-01'].inspecaoTotal.estado, 'AGUARDANDO_DECISAO');
  assert.equal(b.db.ops['26280-01'].inspecaoTotal.resultado.atrasadoMin, 90, 'prazo era 15:00, terminou 16:30');
  assert.match((await I.registrarResultado(b, g.opKey, pInsp, {linhas: []}, 'Marta')).erro, /não está em andamento|pelo menos/);

  // 4) decidir: parcial, dois motivos, uma OP por motivo
  assert.match((await I.decidir(b, g.opKey, pInsp, {tampa_solta: {reprovada: 99}}, '', 'Qua', ctx, deps(rncs))).erro, /reprovou 99/);
  assert.equal(b.db.ops['26280-01'].inspecaoTotal.estado, 'AGUARDANDO_DECISAO', 'decisão inválida devolve o estado');
  const dec = await I.decidir(b, g.opKey, pInsp, {tampa_solta: {reprovada: 42, destino: {tipo: 'posto', nome: 'Posto 1'}}, rotulo_torto: {reprovada: 20}},
    'Tampa: 3 aceitas por concessão', 'Qua', ctx, deps(rncs));
  assert.equal(dec.ok, true, dec.erro); assert.equal(dec.reprovadas, 62); assert.equal(dec.aprovadas, 2098);
  assert.equal(dec.opsRT.length, 2, 'dois motivos = duas OPs');
  assert.deepEqual(dec.opsRT.map((x) => x.lote), ['26280/01-RT1', '26280/01-RT2']);
  const rt1 = b.db.ops['26280-01-RT1'], rt2 = b.db.ops['26280-01-RT2'];
  assert.equal(rt1.tipoOrdem, 'RETRABALHO'); assert.equal(rt1.qtdPlanejada, 42); assert.equal(rt1.linha, 'Posto 1'); assert.equal(rt1.retrabalhoDestino, 'posto');
  assert.match(rt1.retrabalhoMotivo, /Inspeção total: Tampa solta/); assert.equal(rt1.skuPedidoKey, '', 'não credita pedido');
  assert.equal(rt1.origemInspecaoTotal.motivoKey, 'tampa_solta'); assert.equal(rt1.retrabalhoDeOpKey, '26280-01');
  assert.equal(rt2.qtdPlanejada, 20); assert.equal(rt2.linha, '', 'destino a definir pelo PCP'); assert.equal(rt2.retrabalhoDestino, 'linha');
  // paletes: saldo cai pelo retirado, status liberado, caixas recalculadas
  const p1 = b.db.estoque_lotes.SKU1.pa_1, p2 = b.db.estoque_lotes.SKU1.pa_2;
  assert.equal(p1.saldoLote, 1380); assert.equal(p1.status, 'LIBERADO_EXPEDICAO'); assert.equal(p1.caixasFechadas, 57); assert.equal(p1.unidadesCaixaParcial, 12);
  assert.equal(p2.saldoLote, 718); assert.equal(p2.status, 'LIBERADO_EXPEDICAO');
  assert.equal(p1.qualidade.decisao, 'LIBERADO_EXPEDICAO'); assert.equal(p1.qualidade.inspecaoTotal, true); assert.equal(p1.retiradoRetrabalho, 60);
  assert.ok(['LIBERADO_EXPEDICAO', 'APROVADO_CONCESSAO'].includes(p1.status), 'a Expedição aceita');
  // laudo do lote e estado
  const q = b.db.ops['26280-01'].qualidadePA;
  assert.equal(q.decisao, 'LIBERADO_EXPEDICAO'); assert.equal(q.aprovadas, 2098); assert.equal(q.reprovadas, 62); assert.match(q.observacao, /2098 un aprovadas, 62 un em retrabalho \(Tampa solta; Rótulo torto\)/);
  const insp = b.db.ops['26280-01'].inspecaoTotal;
  assert.equal(insp.estado, 'DECIDIDA'); assert.equal(insp.decisao.parcial, true);
  assert.deepEqual(insp.decisao.motivos.map((m) => [m.motivo, m.achada, m.reprovada, m.opRetrabalho]), [['Tampa solta', 45, 42, '26280/01-RT1'], ['Rótulo torto', 20, 20, '26280/01-RT2']]);
  assert.equal(rncs.length, 1); assert.equal(rncs[0].qtdEnvolvida, 62); assert.match(rncs[0].descricao, /Tampa solta \(42\); Rótulo torto \(20\)/);
  assert.equal(dec.rnc, 'RNC-9');
  assert.deepEqual(Object.values(insp.historico).map((h) => h.acao).sort(), ['DECIDIDO', 'DESIGNADO', 'DESIGNADO', 'INSPECAO_CONCLUIDA', 'SINALIZADO']);
  // decidir de novo: bloqueado
  assert.match((await I.decidir(b, g.opKey, pInsp, {}, '', 'Qua', ctx, deps([]))).erro, /não está aguardando decisão/);

  // ── Reprovação total: palete esvaziado vira EM_RETRABALHO; sem aprovados ──
  {
    const b2 = bancoFalso(base()), r2 = [];
    const g2 = L.filaLotes(b2.db.estoque_lotes)[0], c2 = Object.assign({}, ctx, {op: b2.db.ops['26280-01']});
    await I.sinalizar(b2, g2.opKey, g2.paletes, {motivo: 'lote errado'}, 'Qua', c2);
    await I.designar(b2, g2.opKey, {responsavel: 'Ana'}, 'Prod');
    const pi = I.paletesDaInspecao(b2.db.estoque_lotes, '26280-01');
    await I.registrarResultado(b2, g2.opKey, pi, {linhas: [{loteKey: 'pa_1', inspecionadas: 1440, defeitos: [{motivo: 'Rótulo de outro produto', qtd: 1440}]},
      {loteKey: 'pa_2', inspecionadas: 720, defeitos: [{motivo: 'Rótulo de outro produto', qtd: 720}]}]}, 'Ana');
    const d = await I.decidir(b2, g2.opKey, pi, {rotulo_de_outro_produto: {reprovada: 2160}}, '', 'Qua', c2, deps(r2));
    assert.equal(d.ok, true); assert.equal(d.aprovadas, 0); assert.equal(d.opsRT.length, 1);
    assert.equal(b2.db.estoque_lotes.SKU1.pa_1.status, 'EM_RETRABALHO'); assert.equal(b2.db.estoque_lotes.SKU1.pa_1.saldoLote, 0);
    assert.equal(b2.db.ops['26280-01'].qualidadePA.decisao, 'REPROVADO');
    assert.equal(b2.db.ops['26280-01'].inspecaoTotal.decisao.parcial, false);
  }
  // ── Nada reprovado: tudo liberado, nenhuma OP, nenhuma RNC ──
  {
    const b3 = bancoFalso(base()), r3 = [];
    const g3 = L.filaLotes(b3.db.estoque_lotes)[0], c3 = Object.assign({}, ctx, {op: b3.db.ops['26280-01']});
    await I.sinalizar(b3, g3.opKey, g3.paletes, {motivo: 'suspeita de vazamento'}, 'Qua', c3);
    await I.designar(b3, g3.opKey, {responsavel: 'Ana'}, 'Prod');
    const pi = I.paletesDaInspecao(b3.db.estoque_lotes, '26280-01');
    await I.registrarResultado(b3, g3.opKey, pi, {linhas: [{loteKey: 'pa_1', inspecionadas: 1440}, {loteKey: 'pa_2', inspecionadas: 720}]}, 'Ana');
    const d = await I.decidir(b3, g3.opKey, pi, {}, 'falso alarme', 'Qua', c3, deps(r3));
    assert.equal(d.ok, true); assert.equal(d.reprovadas, 0); assert.equal(d.aprovadas, 2160); assert.equal(d.opsRT.length, 0); assert.equal(r3.length, 0);
    assert.equal(b3.db.estoque_lotes.SKU1.pa_1.status, 'LIBERADO_EXPEDICAO'); assert.equal(b3.db.estoque_lotes.SKU1.pa_1.saldoLote, 1440);
  }
  // ── Segundo ciclo de retrabalho do mesmo lote continua a numeração ──
  {
    const b4 = bancoFalso(Object.assign(base(), {})); b4.db.ops['26280-01-RT1'] = {lote: '26280/01-RT1'};
    const g4 = L.filaLotes(b4.db.estoque_lotes)[0], c4 = Object.assign({}, ctx, {op: b4.db.ops['26280-01']});
    await I.sinalizar(b4, g4.opKey, g4.paletes, {motivo: 'x'}, 'Qua', c4); await I.designar(b4, g4.opKey, {responsavel: 'Ana'}, 'Prod');
    const pi = I.paletesDaInspecao(b4.db.estoque_lotes, '26280-01');
    await I.registrarResultado(b4, g4.opKey, pi, {linhas: [{loteKey: 'pa_1', inspecionadas: 1440, defeitos: [{motivo: 'A', qtd: 5}]}, {loteKey: 'pa_2', inspecionadas: 720}]}, 'Ana');
    const d = await I.decidir(b4, g4.opKey, pi, {a: {reprovada: 5}}, '', 'Qua', c4, deps([]));
    assert.deepEqual(d.opsRT.map((x) => x.lote), ['26280/01-RT2']);
  }
  // ── Lote que já tem laudo não pode ser sinalizado ──
  {
    const b5 = bancoFalso(base()); b5.db.ops['26280-01'].qualidadePA = {decisao: 'LIBERADO_EXPEDICAO'};
    const g5 = L.filaLotes(b5.db.estoque_lotes)[0];
    assert.match((await I.sinalizar(b5, g5.opKey, g5.paletes, {motivo: 'x'}, 'Qua', ctx)).erro, /já tem laudo/);
    assert.equal(b5.db.ops['26280-01'].inspecaoTotal, undefined, 'a reserva é solta');
  }
  // ── Fotos por palete, pedido da expedição, laudo avulso bloqueado, Conferência de PA ──
  {
    const f = [{id: 'a', url: 'u'}];
    const v = I.validarResultado(paletes, {linhas: [{loteKey: 'pa_1', inspecionadas: 1440, fotos: f, defeitos: [{motivo: 'x', qtd: 1}]}, {loteKey: 'pa_2', inspecionadas: 720}]});
    assert.deepEqual(v.resultado.linhas[0].fotos, f); assert.equal(v.resultado.linhas[1].fotos, null);
    const b6 = bancoFalso(base()), r6 = [];
    const g6 = L.filaLotes(b6.db.estoque_lotes)[0], c6 = Object.assign({}, ctx, {op: Object.assign({}, b6.db.ops['26280-01'], {skuPedidoKey: 'PED-1__SKU1'})});
    await I.sinalizar(b6, g6.opKey, g6.paletes, {motivo: 'x'}, 'Qua', c6); await I.designar(b6, g6.opKey, {responsavel: 'Ana'}, 'Prod');
    const pi = I.paletesDaInspecao(b6.db.estoque_lotes, '26280-01');
    await I.registrarResultado(b6, g6.opKey, pi, {linhas: [{loteKey: 'pa_1', inspecionadas: 1440, fotos: f, defeitos: [{motivo: 'A', qtd: 5}]}, {loteKey: 'pa_2', inspecionadas: 720}]}, 'Ana');
    assert.deepEqual(b6.db.ops['26280-01'].inspecaoTotal.resultado.linhas[0].fotos, f, 'as fotos ficam no resultado');
    const d = await I.decidir(b6, g6.opKey, pi, {a: {reprovada: 5}}, '', 'Qua', c6, deps(r6));
    assert.equal(b6.db.ops['26280-01-RT1'].skuPedidoKeyExpedicao, 'PED-1__SKU1', 'a OP RT guarda o pedido da original só para a expedição');
    assert.equal(b6.db.ops['26280-01-RT1'].skuPedidoKey, '', 'e continua sem skuPedidoKey: não credita o pedido duas vezes');
    // Laudo avulso de palete que chegou depois da sinalização: bloqueado.
    const b7 = bancoFalso(base()); const g7 = L.filaLotes(b7.db.estoque_lotes)[0];
    await I.sinalizar(b7, g7.opKey, g7.paletes, {motivo: 'x'}, 'Qua', ctx);
    b7.db.estoque_lotes.SKU1.pa_9 = pal(9);   // chegou depois: QUARENTENA
    const g7b = L.filaLotes(b7.db.estoque_lotes)[0];
    const lr = await L.registrarLaudoPaLote(b7, g7b.opKey, g7b.paletes, {decisao: 'LIBERADO_EXPEDICAO'}, 'Qua', {itemCodigo: 'SKU1', amostragem: null}, deps([]));
    assert.equal(lr.ok, false); assert.match(lr.erro, /em inspeção total/);
    assert.equal(b7.db.ops['26280-01'].qualidadePA, undefined, 'a reserva do laudo é solta');
    // Conferência de PA: a OP RT é lida pelo campo do SEU destino.
    const est = fs.readFileSync('public/estoque.html', 'utf8');
    assert.match(est, /op\.tipoOrdem === 'RETRABALHO'[\s\S]*produzidoPosto/);
  }
  // ── Ligações: status, regras do banco, acesso e telas ──
  assert.equal(ctxU.rotuloStatusLote('INSPECAO_TOTAL'), 'Em inspeção total'); assert.equal(ctxU.loteDisponivel('INSPECAO_TOTAL'), false);
  assert.equal(ctxU.rotuloStatusLote('EM_RETRABALHO'), 'Em retrabalho'); assert.equal(ctxU.loteDisponivel('EM_RETRABALHO'), false);
  const regras = fs.readFileSync('database.rules.json', 'utf8');
  assert.match(regras, /"inspecaoTotal": \{\s*"\.write": "auth != null && \(root\.child\('usuarios'\)\.child\(auth\.uid\)\.child\('role'\)\.val\(\) == 'qualidade'/);
  assert.match(regras, /!data\.exists\(\) && newData\.child\('tipoOrdem'\)\.val\(\) == 'RETRABALHO'/, 'Qualidade só CRIA OP, e só de retrabalho');
  const auth = fs.readFileSync('public/auth_check.js', 'utf8');
  assert.equal((auth.match(/'inspecao_total\.html'/g) || []).length >= 6, true, 'páginas dos módulos e menu');
  const qual = fs.readFileSync('public/qualidade.html', 'utf8');
  assert.match(qual, /InspecaoTotalPA\.sinalizar\(db, g\.opKey/); assert.match(qual, /Sinalizar problema/); assert.match(qual, /shared\/inspecao-total-pa\.js/);
  assert.match(fs.readFileSync('public/inspecao_total.html', 'utf8'), /InspecaoTotalPA\.decidir\(db/);
  console.log('run_inspecao_total_pa_test: OK');
})().catch((e) => { console.error(e); process.exit(1); });
