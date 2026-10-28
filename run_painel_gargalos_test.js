'use strict';
/* Painel de Controle: etapas do fluxo, fila, idade e atraso por setor (shared/painel-gargalos.js). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const P = require('./public/shared/painel-gargalos.js');
const SequenciaSetor = require('./public/shared/sequencia-setor.js');
const PerdasEtapa = require('./public/shared/perdas-etapa.js');
const CargasPA = require('./public/shared/cargas-pa.js');
const InspecaoTotalPA = require('./public/shared/inspecao-total-pa.js');

const agora = Date.parse('2026-10-27T15:00:00Z');
const antes = (h) => new Date(agora - h * 3600000).toISOString();
const lib = {SequenciaSetor, PerdasEtapa, CargasPA, InspecaoTotalPA};

const ops = {
  // A: envase amanhã cedo, nada feito: separação e pesagem atrasadas; entra na fila do envase sem atraso.
  'A-1': {status: 'Programado', lote: 'A/01', produto: 'Alfa', cliente: 'CLI', qtdPlanejada: 100, formulaVersao: 'F1__v1',
    dataInicioPlanejada: '2026-10-28T10:00:00Z', dataFimPlanejada: '2026-10-29T10:00:00Z', dataEmissao: antes(200)},
  'B-1': {status: 'Programado', lote: 'B/01', produto: 'Beta', qtdPlanejada: 100, formulaVersao: 'F1__v1', separacaoConcluida: true,
    manipulacao: {status: 'PESADO', pesagem: {fim: antes(6)}}},
  'C-1': {status: 'Programado', lote: 'C/01', produto: 'Gama', qtdPlanejada: 100, formulaVersao: 'F1__v1', separacaoConcluida: true,
    manipulacao: {status: 'CONFERIDO', conferencia: {em: antes(2)}}},
  'D-1': {status: 'Programado', lote: 'D/01', produto: 'Delta', qtdPlanejada: 100, formulaVersao: 'F1__v1', separacaoConcluida: true,
    manipulacao: {status: 'EM_MANIPULACAO', manipulacao: {inicio: antes(30)}}},
  'E-1': {status: 'Programado', lote: 'E/01', produto: 'Eta', qtdPlanejada: 100, formulaVersao: 'F1__v1', separacaoConcluida: true,
    manipulacao: {status: 'AGUARDANDO_CQ', manipulacao: {fim: antes(50)}}},
  'F-1': {status: 'Programado', lote: 'F/01', produto: 'Fi', qtdPlanejada: 100, formulaVersao: 'F1__v1', separacaoConcluida: true,
    manipulacao: {status: 'LIBERADO', analise: {em: antes(100)}}},
  // G: envasando, fim planejado já passou.
  'G-1': {status: 'Em Produção', lote: 'G/01', produto: 'Gi', qtdPlanejada: 100, produzidoLinha: 40, abertaDesde: antes(10), separacaoConcluida: true,
    dataFimPlanejada: '2026-10-26T10:00:00Z'},
  // Fim da OP: PCP precisa confirmar / Logística precisa conferir.
  'H-1': {status: 'Concluído', lote: 'H/01', produto: 'Ha', sku: 'SKUH', produzidoLinha: 500, dataFimReal: '2026-10-25T10:00:00Z'},
  'I-1': {status: 'Aguardando Confirmação', lote: 'I/01', produto: 'Io', sku: 'SKUI', produzidoLinha: 300, dataFimReal: '2026-10-27T05:00:00Z'},
  'J-1': {status: 'Concluído', lote: 'J/01', produto: 'Jota', sku: 'SKUJ', produzidoLinha: 300, dataFimReal: '2026-10-24T10:00:00Z'},
  'K-1': {status: 'Concluído', lote: 'K/01', produto: 'Kapa', sku: 'SKUK', produzidoLinha: 300, dataFimReal: '2026-08-01T10:00:00Z'},
  // Inspeção total de PA.
  'L-1': {status: 'Concluído', lote: 'L/01', produto: 'Lu', inspecaoTotal: {estado: 'AGUARDANDO_DESIGNACAO', sinalizacao: {em: antes(10)}}},
  'M-1': {status: 'Concluído', lote: 'M/01', produto: 'Mu', inspecaoTotal: {estado: 'EM_INSPECAO', sinalizacao: {em: antes(60)},
    designacao: {em: antes(50), prazoEm: antes(5), responsavel: 'Luana'}}},
  'N-1': {status: 'Concluído', lote: 'N/01', produto: 'Nu', inspecaoTotal: {estado: 'AGUARDANDO_DECISAO', sinalizacao: {em: antes(8)}}}
};
const dados = {
  ops,
  conferencias_pa: {'J-1': {status: 'CONFERIDO'}},
  agendamentos_expedicao: {
    a1: {cliente: 'Cli 1', dataAgendada: '2026-10-26', criadoEm: antes(60)},
    a2: {cliente: 'Cli 2', dataAgendada: '2026-10-30', criadoEm: antes(2)},
    a3: {cliente: 'Cli 3', dataAgendada: '2026-10-26', status: 'EXPEDIDO_PARCIAL', criadoEm: antes(80)}
  },
  nao_conformidades: {n1: {status: 'ABERTA', numero: 'RNC-1', criadoEm: antes(100)}, n2: {status: 'FECHADA'}, n3: {status: 'ABERTA', numero: 'RNC-3'}},
  solicitacoes_compra: {s1: {status: 'PENDENTE', numero: 'SC-1', criadoEm: antes(30)}, s2: {status: 'APROVADA', numero: 'SC-2', aprovacao: {aprovadoEm: antes(10)}}},
  pedidos_compra: {p1: {status: 'ABERTO', numero: 'PC-1', criadoEm: antes(5)}, p2: {status: 'ENVIADO', numero: 'PC-2', dataPrevistaEntrega: '2026-10-20'},
    p3: {status: 'RECEBIDO_TOTAL', dataPrevistaEntrega: '2026-10-01'}},
  devolucoes_cliente: {d1: {status: 'AUTORIZADA', numero: 'DEV-1', criadoEm: antes(10)}},
  solicitacoes_descarte: {x1: {status: 'SOLICITADO', numero: 'DESC-1'}}
};

const r = P.analisar(dados, {agora, lib});
const e = Object.fromEntries(r.etapas.map((x) => [x.id, x]));
const resumo = (id) => [e[id].n, e[id].atrasados];

// Fluxo e estrutura
assert.equal(r.etapas.length, P.ETAPAS.length);
assert.deepEqual(r.fases, ['Planejar', 'Manipular', 'Produzir', 'Qualidade', 'Expedir', 'Compras', 'Retornos']);
P.ETAPAS.forEach((x) => assert.ok(P.SLA_PADRAO_H[x.id] !== undefined, 'SLA padrão para ' + x.id));

// Etapa a etapa
assert.deepEqual(resumo('confirmar_pcp'), [1, 0], 'PCP: concluída há 10h, prazo de 24h');
assert.deepEqual(resumo('conferencia_pa'), [1, 1], 'Logística: J já conferida e K é anterior ao fluxo; só H, parada há dias');
assert.deepEqual(resumo('separacao'), [1, 1], 'só A está sem separação e com envase em menos de 24h');
assert.deepEqual(resumo('pesagem'), [1, 1], 'A: envase em menos de 3 dias sem pesagem');
assert.deepEqual(resumo('conferencia_pesagem'), [1, 1], 'pesada há 6h, prazo 4h');
assert.deepEqual(resumo('aguardando_manipular'), [1, 0]);
assert.deepEqual(resumo('manipulacao'), [1, 1], 'em manipulação há 30h, prazo 24h');
assert.deepEqual(resumo('cq_granel'), [1, 1]);
assert.equal(e.cq_granel.severidade, 'critico', 'atrasado e há mais de 2x o prazo');
assert.deepEqual(resumo('bulk_envase'), [1, 1], 'F: bulk liberado há 100h e a linha não começou');
assert.deepEqual(resumo('envase'), [1, 1], 'só G está rodando, e passou do fim planejado');
assert.match(e.envase.itens[0].motivo, /fim planejado em 26\/10\/2026 e faltam 60 un/);
assert.deepEqual(resumo('rotulagem'), [0, 0], 'sem OP com rótulo, sem fila');
assert.deepEqual(resumo('insp_designar'), [1, 1], 'sinalizada há 10h, prazo de 4h para designar');
assert.deepEqual(resumo('insp_executar'), [1, 1], 'prazo da inspeção já venceu');
assert.equal(e.insp_executar.itens[0].detalhe, 'com Luana');
assert.deepEqual(resumo('insp_decidir'), [1, 0], 'decisão há 8h, prazo de 24h');
assert.deepEqual(resumo('rnc'), [2, 1], 'uma RNC sem data conta na fila mas não fica atrasada');
assert.equal(e.rnc.itens.find((i) => i.rotulo === 'RNC-3').idadeH, null);
assert.deepEqual(resumo('faturamento'), [2, 1], 'a1 com data vencida; a2 no prazo');
assert.deepEqual(resumo('carregar'), [1, 1]);
assert.deepEqual(resumo('sc_aprovar'), [1, 1]);
assert.deepEqual(resumo('sc_cotar'), [1, 0]);
assert.deepEqual(resumo('pc_enviar'), [1, 0]);
assert.deepEqual(resumo('pc_atrasados'), [1, 1], 'só ENVIADO/PARCIAL com data vencida');
assert.deepEqual(resumo('devolucoes'), [1, 0]);
assert.deepEqual(resumo('descartes'), [1, 0]);
assert.equal(e.descartes.severidade, 'ok');
assert.equal(e.rotulagem.severidade, 'vazio');

// Itens: atrasados primeiro, depois os mais antigos
assert.equal(e.faturamento.itens[0].atrasado, true);
assert.equal(e.rnc.itens[0].rotulo, 'RNC-1');

// Setores: ranking por atraso
const setor = Object.fromEntries(r.setores.map((s) => [s.setor, s]));
assert.equal(setor['Qualidade'].atrasados, 3, 'conferência de pesagem + bulk CQ + RNC');
assert.equal(setor['Produção'].atrasados, 4, 'bulk sem envase, envase atrasado, inspeção sem responsável e em andamento vencida');
assert.equal(setor['Logística'].atrasados, 3, 'separação, conferência de PA e carga para sair');
assert.equal(setor['Manipulação'].atrasados, 2); assert.equal(setor['Faturamento'].atrasados, 1); assert.equal(setor['Compras'].atrasados, 2); assert.equal(setor['PCP'].atrasados, 0);
assert.equal(r.setores[0].atrasados >= r.setores[r.setores.length - 1].atrasados, true);
assert.equal(r.totais.n, r.etapas.reduce((t, x) => t + x.n, 0));
assert.equal(r.totais.atrasados, r.etapas.reduce((t, x) => t + x.atrasados, 0));
assert.ok(r.totais.criticas >= 1);

// SLA ajustável
const folgado = P.analisar(dados, {agora, lib, slaH: {conferencia_pesagem: 10, cq_granel: 100}});
assert.equal(folgado.etapas.find((x) => x.id === 'conferencia_pesagem').atrasados, 0);
assert.equal(folgado.etapas.find((x) => x.id === 'cq_granel').atrasados, 0);
assert.equal(P.analisar(dados, {agora, lib, slaH: {cq_granel: 'lixo'}}).etapas.find((x) => x.id === 'cq_granel').atrasados, 1, 'SLA inválido volta ao padrão');

// Robustez: nada, nós vazios, bibliotecas ausentes
const vazio = P.analisar({}, {agora, lib});
assert.equal(vazio.totais.n, 0); assert.equal(vazio.setores.every((s) => s.n === 0), true);
assert.doesNotThrow(() => P.analisar(dados, {agora}), 'sem bibliotecas, só as etapas que dependem delas ficam de fora');
assert.equal(P.analisar(dados, {agora}).etapas.find((x) => x.id === 'rnc').n, 2);

// Cobrança pronta para colar
const msg = P.textoCobranca('Qualidade', r);
assert.match(msg, /^Pendências fora do prazo — Qualidade \(3\):/);
assert.match(msg, /Pesagem aguardando conferência \(1\):\n   - B\/01 — Beta — há 6 h — passou do prazo de 4h/);
assert.match(msg, /Não conformidades abertas \(1\):\n   - RNC-1 — há 4 dias/);
assert.doesNotMatch(msg, /RNC-3/, 'item sem data não entra na cobrança');
assert.equal(P.textoCobranca('Compras', P.analisar({}, {agora, lib})), '');
assert.equal(P.textoCobranca('Inexistente', r), '');
assert.match(P.textoCobranca('Logística', r, 1), /… e mais|Pendências/);
assert.equal(P.formatarIdade(0.5), '30 min'); assert.equal(P.formatarIdade(30), '30 h'); assert.equal(P.formatarIdade(96), '4 dias'); assert.equal(P.formatarIdade(null), '—');

// A regra de conferência de PA espelha a de estoque.html (mesma data de corte).
const estoque = fs.readFileSync('public/estoque.html', 'utf8');
assert.match(estoque, /INICIO_FLUXO_CONFERENCIA_PA = '2026-09-10T00:00:00\.000Z'/, 'o corte da conferência de PA mudou em estoque.html: atualize painel-gargalos.js');

console.log('run_painel_gargalos_test: OK');
