'use strict';
/* Histórico de apontamentos: início/término, edição do período e visão
   condensada por OP (public/shared/historico-apontamentos.js).
   Fuso da fábrica fixado: o registro antigo guarda hora local e o período
   guarda ISO em UTC, e a conta só é certa se os dois forem comparáveis. */
process.env.TZ = 'America/Sao_Paulo';
const assert = require('node:assert/strict');
const H = require('./public/shared/historico-apontamentos.js');

assert.equal(new Date('2026-09-15T12:00:00Z').getHours(), 9, 'TZ de São Paulo precisa estar ativo');

let n = 0;
function t(nome, fn) { fn(); n++; console.log('ok -', nome); }

// ── Período e coluna ────────────────────────────────────────────────
const checkpoint = {data: '2026-09-15', hora: '06:00', tipo: 'apontamento_total', linha: 'Linha 1', lote: 'L1',
  quantidade: 800, qtdTotalOP: 800, periodoInicio: '2026-09-15T01:00:00.000Z', periodoFim: '2026-09-15T09:00:00.000Z', horasTrabalhadas: 7};
const antigo = {data: '2026-08-19', hora: '14_00', linha: 'Linha 1', lote: 'L2', quantidade: 202};

t('período gravado mostra data e hora de início e de término', () => {
  assert.deepEqual(H.periodoTexto(checkpoint), {inicio: '14/09/26 22:00', termino: '15/09/26 06:00', semTermino: false});
});
t('registro antigo mostra "?" no término, nunca hora cheia + 1', () => {
  assert.deepEqual(H.periodoTexto(antigo), {inicio: '19/08/26 14:00', termino: '?', semTermino: true});
});
t('hora ilegível: só o dia do início, com "?" na hora', () => {
  assert.deepEqual(H.periodoTexto({data: '2026-08-19', hora: '—'}), {inicio: '19/08/26 ?', termino: '?', semTermino: true});
  assert.deepEqual(H.periodoTexto({data: 'sem-data'}), {inicio: '?', termino: '?', semTermino: true});
});
t('periodoFim sem periodoInicio não vira término (mesmo critério de fmtRegistroRange)', () => {
  assert.equal(H.periodoTexto({data: '2026-08-19', hora: '10:00', periodoFim: '2026-08-19T15:00:00Z'}).termino, '?');
});
t('ordenação compara hora local do antigo com ISO do período', () => {
  const a = {data: '2026-09-14', hora: '23:00'};           // 14/09 23:00 local
  assert.ok(H.inicioMs(checkpoint) < H.inicioMs(a), '22:00 vem antes de 23:00');
});
t('horas do apontamento: úteis gravadas > duração > desconhecido', () => {
  assert.equal(H.horasDoRegistro(checkpoint), 7);
  assert.equal(H.horasDoRegistro(Object.assign({}, checkpoint, {horasTrabalhadas: 0})), 8);
  assert.equal(H.horasDoRegistro(antigo), null);
});

// ── Edição de início/término ────────────────────────────────────────
t('salvar sem mexer no período não reescreve nada', () => {
  const ini = H.valoresIniciaisEdicao(checkpoint);
  assert.deepEqual(ini, {inicio: '2026-09-14T22:00', termino: '2026-09-15T06:00', temTermino: true});
  assert.deepEqual(H.planoEdicaoPeriodo(checkpoint, '2026-09-15', ini.inicio, ini.termino), {mudou: false, data: '2026-09-15'});
});
t('checkpoint que vira a noite continua no dia em que está', () => {
  const p = H.planoEdicaoPeriodo(checkpoint, '2026-09-15', '2026-09-14T21:30', '2026-09-15T06:00');
  assert.equal(p.data, '2026-09-15');
  assert.equal(p.hora, '21:30');
  assert.equal(p.periodo.periodoInicio, '2026-09-15T00:30:00.000Z');
  assert.equal(p.periodo.periodoFim, '2026-09-15T09:00:00.000Z');
  assert.equal(p.periodo.horasTrabalhadas, 7.5, 'mantém a 1h de pausa já descontada');
});
t('período que sai do dia do registro leva o registro para o dia do início', () => {
  const p = H.planoEdicaoPeriodo(checkpoint, '2026-09-15', '2026-09-12T08:00', '2026-09-12T17:00');
  assert.equal(p.data, '2026-09-12');
  assert.equal(p.periodo.horasTrabalhadas, 8);
});
t('registro antigo: mudar só o início volta a ser data + hora', () => {
  const ini = H.valoresIniciaisEdicao(antigo);
  assert.deepEqual(ini, {inicio: '2026-08-19T14:00', termino: '', temTermino: false});
  assert.deepEqual(H.planoEdicaoPeriodo(antigo, '2026-08-19', '2026-08-18T15:00', ''),
    {mudou: true, data: '2026-08-18', hora: '15:00', periodo: null});
});
t('registro antigo ganha término: vira período com a duração inteira', () => {
  const p = H.planoEdicaoPeriodo(antigo, '2026-08-19', '2026-08-19T14:00', '2026-08-19T15:00');
  assert.equal(p.data, '2026-08-19');
  assert.equal(p.periodo.horasTrabalhadas, 1);
});
t('validações: término antes do início, término apagado, início vazio', () => {
  assert.match(H.planoEdicaoPeriodo(checkpoint, '2026-09-15', '2026-09-15T06:00', '2026-09-15T05:00').erro, /depois do início/);
  assert.match(H.planoEdicaoPeriodo(checkpoint, '2026-09-15', '2026-09-14T22:00', '').erro, /término gravado/);
  assert.match(H.planoEdicaoPeriodo(antigo, '2026-08-19', '', '').erro, /Informe o início/);
  // hora ilegível e ninguém preencheu: não é mudança
  assert.equal(H.planoEdicaoPeriodo({data: '2026-08-19', hora: '—'}, '2026-08-19', '', '').mudou, false);
});

// ── Condensação por OP ──────────────────────────────────────────────
const setorDe = r => (/Rotulagem/.test(r.linha) ? 'rotulagem' : 'linha');
function reg(o) { return Object.assign({data: '2026-09-10', linha: 'Linha 1', lote: 'OP1', produto: 'BODY SPLASH'}, o); }
function iso(s) { return new Date(s).toISOString(); }

t('agrupa por lote + setor; sem lote fica sozinho', () => {
  const g = H.condensarPorOp([
    reg({quantidade: 100, _key: 'a'}), reg({quantidade: 50, _key: 'b'}),
    reg({quantidade: 90, linha: 'Rotulagem 01', _key: 'c'}), reg({lote: '', quantidade: 5, _key: 'd'})
  ], {setorDe});
  assert.equal(g.length, 3);
  assert.equal(g[0].quantidade, 150);
  assert.equal(g[1].setorRotulo, 'Rotulagem');
  assert.equal(g[2].avulso, true);
});

t('início/término do grupo, horas trabalhadas e un/h sem contar registro sem término', () => {
  const [g] = H.condensarPorOp([
    reg({quantidade: 1000, periodoInicio: iso('2026-09-10T07:00'), periodoFim: iso('2026-09-10T12:00'), horasTrabalhadas: 5}),
    reg({quantidade: 600, periodoInicio: iso('2026-09-10T13:00'), periodoFim: iso('2026-09-10T16:00')}),
    reg({quantidade: 202, hora: '17:00'})
  ], {setorDe});
  assert.equal(H.fmtDataHora(g.inicio), '10/09/26 07:00');
  assert.equal(H.fmtDataHora(g.termino), '10/09/26 16:00');
  assert.equal(g.horasTrabalhadas, 8);
  assert.equal(g.ritmo, 200, '1.600 un em 8h; as 202 un sem término ficam fora');
  assert.equal(g.registrosSemHoras, 1);
  assert.equal(g.qtdSemHoras, 202);
  assert.equal(g.semTermino, 1);
  assert.deepEqual(g.alertas.map(a => a.tipo), ['SEM_TERMINO']);
  assert.equal(g.temErro, false);
});

t('grupo só com registros antigos: término "?" e horas desconhecidas', () => {
  const [g] = H.condensarPorOp([reg({quantidade: 202, hora: '15:00'}), reg({quantidade: 202, hora: '16:00'})], {setorDe});
  assert.equal(g.termino, null);
  assert.equal(g.horasTrabalhadas, null);
  assert.equal(g.ritmo, null);
});

t('caso real 26217/03 × 26219/03: quantidades trocadas entre as OPs viram erro', () => {
  const regs = [
    reg({lote: '26217/03', tipo: 'apontamento_total', quantidade: 4272, qtdTotalOP: 4416,
      periodoInicio: iso('2026-08-10T16:34'), periodoFim: iso('2026-08-11T16:09')}),
    reg({lote: '26219/03', tipo: 'apontamento_total', quantidade: 4416, qtdTotalOP: 4272,
      periodoInicio: iso('2026-08-10T16:35'), periodoFim: iso('2026-08-11T16:05')})
  ];
  const totais = {'26217/03': 4416, '26219/03': 4272};
  const g = H.condensarPorOp(regs, {setorDe, totalOp: lote => totais[lote]});
  const a = g.find(x => x.lote === '26219/03');
  assert.equal(a.temErro, true, 'soma 4.416 maior que o informado 4.272');
  assert.deepEqual(a.alertas.filter(x => x.tipo !== 'PERIODO_LONGO').map(x => [x.tipo, x.nivel]), [['ACUMULADO', 'erro']],
    'o total da OP é o mesmo número do acumulado: não repete');
  const b = g.find(x => x.lote === '26217/03');
  assert.equal(b.alertas.find(x => x.tipo === 'ACUMULADO').nivel, 'aviso', 'soma menor pode ser registro fora do período');
  assert.match(b.alertas.find(x => x.tipo === 'ACUMULADO').texto, /fora do período carregado/);
  assert.ok(a.alertas.some(x => x.tipo === 'PERIODO_LONGO'), '~23h num apontamento só');
});

t('acumulado confere quando a soma bate, e compara só até o checkpoint', () => {
  const [g] = H.condensarPorOp([
    reg({quantidade: 1000, tipo: 'apontamento_total', qtdTotalOP: 1000, periodoInicio: iso('2026-09-10T07:00'), periodoFim: iso('2026-09-10T12:00')}),
    reg({quantidade: 2000, tipo: 'apontamento_total', qtdTotalOP: 3000, periodoInicio: iso('2026-09-10T12:00'), periodoFim: iso('2026-09-10T16:00')}),
    reg({quantidade: 50, periodoInicio: iso('2026-09-10T16:00'), periodoFim: iso('2026-09-10T16:30')})
  ], {setorDe, totalOp: () => 3050});
  assert.deepEqual(g.alertas, []);
  assert.equal(g.ultimoTotalInformado, 3000);
});

t('total da OP diferente e sem checkpoint vira aviso/erro próprio', () => {
  const [menor] = H.condensarPorOp([reg({quantidade: 100})], {setorDe, totalOp: () => 300});
  assert.deepEqual(menor.alertas.filter(a => a.tipo === 'TOTAL_OP').map(a => a.nivel), ['aviso']);
  const [maior] = H.condensarPorOp([reg({quantidade: 500})], {setorDe, totalOp: () => 300});
  assert.deepEqual(maior.alertas.filter(a => a.tipo === 'TOTAL_OP').map(a => a.nivel), ['erro']);
});

t('sobreposição só dentro da mesma linha; antigos colidem no mesmo instante', () => {
  const p1 = {periodoInicio: iso('2026-09-10T07:00'), periodoFim: iso('2026-09-10T12:00')};
  const p2 = {periodoInicio: iso('2026-09-10T11:00'), periodoFim: iso('2026-09-10T14:00')};
  const [mesma] = H.condensarPorOp([reg(Object.assign({quantidade: 1}, p1)), reg(Object.assign({quantidade: 1}, p2))], {setorDe});
  assert.equal(mesma.alertas.find(a => a.tipo === 'SOBREPOSICAO').quantidade, 1);
  const [paralelas] = H.condensarPorOp([reg(Object.assign({quantidade: 1}, p1)), reg(Object.assign({quantidade: 1, linha: 'Linha 2'}, p2))], {setorDe});
  assert.equal(paralelas.alertas.some(a => a.tipo === 'SOBREPOSICAO'), false, 'duas linhas no mesmo lote podem rodar juntas');
  const encostados = H.condensarPorOp([reg(Object.assign({quantidade: 1}, p1)),
    reg({quantidade: 1, periodoInicio: iso('2026-09-10T12:00'), periodoFim: iso('2026-09-10T13:00')})], {setorDe})[0];
  assert.equal(encostados.alertas.some(a => a.tipo === 'SOBREPOSICAO'), false, 'fim de um = início do outro não sobrepõe');
  const [dup] = H.condensarPorOp([reg({quantidade: 202, hora: '15:00'}), reg({quantidade: 202, hora: '15:00'}), reg({quantidade: 202, hora: '16:00'})], {setorDe});
  assert.equal(dup.alertas.find(a => a.tipo === 'SOBREPOSICAO').quantidade, 1);
});

t('apontamento com mais de 12h seguidas', () => {
  const [g] = H.condensarPorOp([reg({quantidade: 179, periodoInicio: iso('2026-07-04T00:00'), periodoFim: iso('2026-07-05T00:00')})], {setorDe});
  const a = g.alertas.find(x => x.tipo === 'PERIODO_LONGO');
  assert.equal(a.nivel, 'aviso');
  assert.match(a.texto, /maior: 24h/);
  const [ok] = H.condensarPorOp([reg({quantidade: 1, periodoInicio: iso('2026-07-04T06:00'), periodoFim: iso('2026-07-04T18:00')})], {setorDe});
  assert.equal(ok.alertas.length, 0, '12h exatas não alertam');
});

console.log('\n' + n + ' casos ok');
