// Etapas da carga de PA (expedição em três telas, 29/09). node run_cargas_pa_test.js
const assert = require('assert');
const C = require('./public/shared/cargas-pa.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const pal = [{itemKey: 'PA1', loteKey: 'p1', quantidade: 295, sku: 'PA1', identificadorPalete: 'P-1', pedidoNumero: 'PED-1'},
  {itemKey: 'PA1', loteKey: 'p2', quantidade: 100, embarcado: 40, sku: 'PA1'}];
const base = {status: 'AGENDADO', cliente: 'Miss Rôse', dataAgendada: '2026-09-30', revisao: 1, criadoEm: '2026-09-29T10:00:00Z', criadoPor: 'Log', paletes: pal, pedidos: {x: 'PED-1'}};
const com = (extra) => Object.assign({}, base, extra);

// 1. Etapas na ordem do fluxo.
eq(C.etapa(base).codigo, 'AGENDADA');
eq(C.etapa(com({faturamento: {status: 'SOLICITADO', solicitadoEm: '2026-09-29T11:00:00Z'}})).codigo, 'FATURAMENTO_SOLICITADO');
const nfs = {nf_1500_1: {numero: '1500', serie: '1', valor: 3540, emitidaEm: '2026-09-29', registradoEm: '2026-09-29T12:00:00Z', registradoPor: 'Fin'}};
const faturada = com({faturamento: {status: 'FATURADO', nfs}});
eq(C.etapa(faturada).codigo, 'FATURADA');
eq(C.etapa(com({status: 'EXPEDIDO_PARCIAL', faturamento: {status: 'FATURADO', nfs}})).codigo, 'AGUARDANDO_EMBARQUE');
eq(C.etapa(com({status: 'EXPEDIDO'})).codigo, 'EXPEDIDA');
eq(C.etapa(com({status: 'CANCELADO'})).codigo, 'CANCELADA');
eq(C.etapa(com({faturamento: {status: 'FATURADO'}})).codigo, 'AGENDADA', 'FATURADO sem NF não conta como faturada');

// 2. Ações: saída só com NF; cancelar só antes de faturar.
eq(C.acoes(base), {solicitarFaturamento: true, registrarNf: true, carregar: false, editarTransporte: true, cancelar: true});
eq(C.acoes(faturada).carregar, true);
eq(C.acoes(faturada).cancelar, false, 'faturada não cancela');
eq(C.acoes(faturada).solicitarFaturamento, false);
eq(C.acoes(com({status: 'EXPEDIDO_PARCIAL', faturamento: {status: 'FATURADO', nfs}})).carregar, true, 'saldo sai na próxima viagem');
eq(C.acoes(com({status: 'EXPEDIDO'})).editarTransporte, false);

// 3. NFs e totais.
eq(C.nfs(faturada)[0].texto, '1500/1');
eq(C.totais(base), {paletes: 2, unidades: 395, embarcado: 40, pendente: 355, viagens: 0});

// 4. Linha do tempo.
const completa = com({status: 'EXPEDIDO_PARCIAL', faturamento: {status: 'FATURADO', nfs,
  solicitacoes: {s1: {em: '2026-09-29T11:00:00Z', por: 'Log', totalValor: 3540}}},
  viagens: {v1: {viagem: 1, em: '2026-09-29T15:00:00Z', por: 'Log', unidades: 192, aguardandoEmbarque: 103, placa: 'ABC1D23'}}});
eq(C.linhaDoTempo(completa).map((x) => x.tipo), ['AGENDADA', 'FATURAMENTO_SOLICITADO', 'NF', 'VIAGEM']);
ok(/Viagem 1: 192 un saíram \(placa ABC1D23\) · 103 un aguardando embarque/.test(C.linhaDoTempo(completa)[3].texto));

// 5. Listagem e filtros.
const ags = {a: base, b: faturada, c: com({status: 'EXPEDIDO', atualizadoEm: '2026-09-28'}), d: com({faturamento: {status: 'SOLICITADO'}, cliente: 'Bria'})};
eq(C.listar(ags, 'faturamento').map((a) => a._key).sort(), ['a', 'd'], 'faturamento: sem NF');
eq(C.listar(ags, 'ativas').length, 3);
eq(C.listar(ags, 'FATURADA').map((a) => a._key), ['b']);
eq(C.listar(ags, 'todas', 'bria').map((a) => a._key), ['d'], 'busca');
eq(C.listar(ags, 'todas', '1500').map((a) => a._key), ['b'], 'busca pela NF');
const cont = C.contagem(ags);
eq([cont.AGENDADA, cont.FATURAMENTO_SOLICITADO, cont.FATURADA, cont.EXPEDIDA], [1, 1, 1, 1]);

console.log('run_cargas_pa_test: ' + n + ' verificações OK');
