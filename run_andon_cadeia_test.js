/* Andon: rotulagem, manipulação e qualidade (pedido do usuário, 30/09). */
const assert = require('assert');
const A = require('./public/shared/andon-cadeia.js');

const AGORA = Date.parse('2026-09-30T12:00:00Z');
const h = (horas) => new Date(AGORA - horas * 3600000).toISOString();
const san = (s) => String(s).replace(/[.#$\[\]\/ ]/g, '_');

// ── Rotuladoras: operando, parada e livre ──────────────────────────────
const ops = {
  'OP-A': {lote: 'A/01', produto: 'BODY A', status: 'Em Produção', qtdPlanejada: 1000, produzidoRotulagem: 400, abertaDesdeRot: h(3), abertaRotulagem: 'Rotulagem 01', setupInicioRot: h(3), setupFimRot: h(2.9)},
  'OP-B': {lote: 'B/01', produto: 'BODY B', status: 'Em Produção', qtdPlanejada: 500, produzidoRotulagem: 0, abertaDesdeRot: h(1), abertaRotulagem: 'Rotulagem 02', setupInicioRot: h(1)},
  'OP-X': {lote: 'X/01', status: 'Concluído', abertaDesdeRot: h(90), abertaRotulagem: 'Rotulagem 03', qtdPlanejada: 10}   // alocação velha de OP concluída: não conta
};
const estado = {Rotulagem_02: {status: 'parada', inicioParada: h(0.5), motivoParada: 'Falta de Material', lote: 'B/01'}};
const rots = A.rotuladoras(['Rotulagem 01', 'Rotulagem 02', 'Rotulagem 03'], ops, estado, AGORA, san);
assert.strictEqual(rots[0].estado, 'operando');
assert.strictEqual(rots[0].op.pct, 40);
assert.strictEqual(rots[0].op.emSetup, false);
assert.strictEqual(rots[1].estado, 'parada');
assert.strictEqual(rots[1].parada.motivo, 'Falta de Material');
assert.strictEqual(rots[1].parada.desdeMin, 30);
assert.strictEqual(rots[1].op.emSetup, true);
assert.strictEqual(rots[2].estado, 'livre', 'OP concluída com alocação antiga não ocupa a rotuladora');
assert.strictEqual(rots[2].op, null);

// ── Postos: só os abertos agora ────────────────────────────────────────
const ps = A.postos({p1: {nome: 'Celofane', operador: 'Ana', abertoEm: h(2)}, p2: {nome: 'Filme Shrink', abertoEm: h(0.25)}}, AGORA);
assert.deepStrictEqual(ps.map(p => p.nome), ['Celofane', 'Filme Shrink']);
assert.strictEqual(ps[0].desdeMin, 120);
assert.deepStrictEqual(A.postos({}, AGORA), []);

// ── Funil da manipulação ───────────────────────────────────────────────
const man = (status, extra) => ({status: 'Em Produção', lote: 'M', produto: 'P', cliente: 'C', manipulacao: Object.assign({status: status}, extra)});
const opsM = {
  m1: man('AGUARDANDO_PESAGEM', {}),
  m2: Object.assign(man('PESADO', {pesagem: {inicio: h(30), fim: h(10)}}), {lote: 'M2'}),                        // 10 h > 8 h: atenção
  m3: Object.assign(man('EM_MANIPULACAO', {manipulacao: {inicio: h(2)}}), {lote: 'M3'}),                           // dentro do limite
  m4: Object.assign(man('AGUARDANDO_CQ', {manipulacao: {inicio: h(40), fim: h(30)}}), {lote: 'M4'}),               // 30 h > 24 h: atenção
  m5: Object.assign(man('LIBERADO', {}), {lote: 'M5'}),                                                              // pronto: fora do funil
  m6: Object.assign(man('EM_MANIPULACAO', {manipulacao: {inicio: h(1)}}), {lote: 'M6', status: 'Cancelado'}),        // cancelada: fora
  m7: Object.assign(man('CORRECAO_ABERTA', {pesagem: {inicio: h(5)}, ciclo: 2, correcao: {rncNumero: 'R1'}}), {lote: 'M7'}),
  sem: {status: 'Em Produção', lote: 'SEM'}                                                                          // OP sem fase de bulk
};
const funil = A.funilManipulacao(opsM, AGORA);
const et = (k) => funil.find(e => e.k === k);
assert.strictEqual(et('AGUARDANDO_PESAGEM').itens.length, 2, 'aguardando pesagem + correção aberta');
assert.ok(et('AGUARDANDO_PESAGEM').itens.some(i => i.correcao));
assert.strictEqual(et('PESADO').atencao, true);
assert.strictEqual(et('PESADO').maisAntigoH, 10);
assert.strictEqual(et('EM_MANIPULACAO').itens.length, 1, 'cancelada não entra');
assert.strictEqual(et('EM_MANIPULACAO').atencao, false);
assert.strictEqual(et('AGUARDANDO_CQ').atencao, true);
assert.strictEqual(funil.reduce((s, e) => s + e.itens.length, 0), 5, 'liberado e OP sem fase ficam de fora');

// ── Fila da Qualidade ──────────────────────────────────────────────────
const lotes = {
  'MPGR-1': {a: {itemTipo: 'material', itemCodigo: 'MPGR-00001', status: 'QUARENTENA', saldoLote: 50, dataRecebimento: '2026-09-27'}},
  'EP-1': {b: {itemTipo: 'material', itemCodigo: 'EP-00092', status: 'QUARENTENA', saldoLote: 900, dataRecebimento: '2026-09-29'},
           c: {itemTipo: 'material', itemCodigo: 'EP-00092', status: 'LIBERADO', saldoLote: 10}},
  'SKU': {d: {itemTipo: 'produto', itemCodigo: 'SKU', status: 'QUARENTENA', saldoLote: 500, criadoEm: h(10), opKey: 'OP-PA'}}
};
const rncs = {r1: {status: 'ABERTA'}, r2: {status: 'EM_ANALISE'}, r3: {status: 'CONCLUIDA'}};
const fila = A.filaQualidade(lotes, opsM, rncs, AGORA);
assert.strictEqual(fila.mp.total, 1);
assert.strictEqual(fila.embalagem.total, 1, 'EP é embalagem; o lote liberado não entra');
assert.strictEqual(fila.pa.total, 1);
assert.strictEqual(fila.bulk.total, 1, 'só o bulk aguardando análise (M4); reprovado entra aqui também quando existir');
assert.ok(fila.mp.maisAntigoH > 48 && fila.mp.atencao, 'matéria-prima há mais de 2 dias espera: atenção');
assert.strictEqual(fila.embalagem.atencao, false);
assert.strictEqual(fila.rncAbertas, 2, 'ABERTA + EM_ANALISE; concluída não conta');
assert.strictEqual(A.tipoDoLote('produto', 'X'), 'pa');
assert.strictEqual(A.tipoDoLote('material', 'ES-0001'), 'embalagem');
assert.strictEqual(A.tipoDoLote('material', 'MPES-0001'), 'mp');
assert.strictEqual(A.tipoDoLote('material', 'MU-0001'), 'mp', 'mesma regra da Qualidade: só EP/ES/ET são embalagem');

// ── A faixa da cadeia ──────────────────────────────────────────────────
const opsC = Object.assign({}, opsM, {
  env: {lote: 'ENV', status: 'Em Produção', abertaDesde: h(4), abertaLinha: 'Linha 1'},
  rot: {lote: 'ROT', status: 'Em Produção', abertaDesdeRot: h(1), abertaRotulagem: 'Rotulagem 01'},
  'OP-PA': {lote: 'PA1', status: 'Concluído', produzidoLinha: 500, confirmadoEm: h(60)},
  'OP-LOG': {lote: 'LOG1', status: 'Concluído', produzidoLinha: 300, confirmadoEm: h(3)}
});
const c = A.cadeia({ops: opsC, estoqueLotes: lotes, conferenciasPa: {}, rncs: rncs}, AGORA);
const ce = (k) => c.etapas.find(e => e.k === k);
assert.deepStrictEqual(c.etapas.map(e => e.k), ['manipulacao', 'qualidade_bulk', 'envase', 'rotulagem', 'conferencia_pa', 'qualidade_pa']);
assert.strictEqual(ce('manipulacao').total, 4);
assert.strictEqual(ce('manipulacao').atencao, true);
assert.strictEqual(ce('qualidade_bulk').total, 1);
assert.strictEqual(ce('envase').total, 1);
assert.strictEqual(ce('rotulagem').total, 1);
assert.strictEqual(ce('qualidade_pa').total, 1, 'OP-PA: palete em quarentena há 60 h');
assert.strictEqual(ce('qualidade_pa').atencao, true);
assert.strictEqual(ce('conferencia_pa').total, 1, 'OP-LOG: confirmada há 3 h, sem conferência');
assert.strictEqual(ce('conferencia_pa').atencao, false);
assert.strictEqual(c.semAtencao, false);
// Tudo em dia: nada esperando além do limite e nenhuma RNC aberta.
const limpo = A.cadeia({ops: {env: opsC.env}, estoqueLotes: {}, conferenciasPa: {}, rncs: {}}, AGORA);
assert.strictEqual(limpo.semAtencao, true);
assert.strictEqual(A.rotuloTempo(0.25), '15 min');
assert.strictEqual(A.rotuloTempo(5.5), '5,5 h');
assert.strictEqual(A.rotuloTempo(72), '3 dias');
assert.strictEqual(A.rotuloTempo(null), '—');

console.log('andon-cadeia: todos os testes passaram');
