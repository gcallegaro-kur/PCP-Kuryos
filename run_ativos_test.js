'use strict';
/* Manutenção › Cadastro de Ativos (19/10/2026) -- shared/ativos.js. */
const assert = require('node:assert/strict');
const A = require('./public/shared/ativos.js');
let n = 0; const ok = (nome, fn) => { fn(); n++; console.log('ok -', nome); };

const base = {
  a1: {codigo: 'RT-01', nome: 'Reator 500 kg', tipo: 'REATOR', area: 'MANIPULACAO', situacao: 'OPERACIONAL', exigeAssepsia: true},
  a2: {codigo: 'EV-01', nome: 'Envasadora pistão', tipo: 'ENVASADORA', area: 'ENVASE', linha: 'Linha 1', situacao: 'OPERACIONAL', exigeAssepsia: true},
  a3: {codigo: 'BL-01', nome: 'Balança 30 kg', tipo: 'BALANCA', area: 'LABORATORIO', situacao: 'EM_MANUTENCAO', exigeCalibracao: true, calibracaoPeriodicidadeMeses: 12},
  a4: {codigo: 'EV-02', nome: 'Envasadora velha', tipo: 'ENVASADORA', area: 'ENVASE', linha: 'linha  1', situacao: 'INATIVO', exigeAssepsia: true}
};

ok('normalizar: padrões do tipo, código em maiúsculas, números', () => {
  const a = A.normalizar({codigo: ' rt 02 ', nome: ' Reator 1000 ', tipo: 'REATOR', capacidade: '1.000'.replace('.', '')});
  assert.equal(a.codigo, 'RT-02');
  assert.equal(a.nome, 'Reator 1000');
  assert.equal(a.area, 'MANIPULACAO');
  assert.equal(a.exigeAssepsia, true);
  assert.equal(a.exigeCalibracao, false);
  assert.equal(a.capacidade, 1000);
  assert.equal(a.capacidadeUnidade, 'kg');
  assert.equal(a.situacao, 'OPERACIONAL');
  const b = A.normalizar({codigo: 'ph-1', nome: 'pHmetro', tipo: 'PHMETRO', capacidade: ''});
  assert.equal(b.exigeCalibracao, true);
  assert.equal(b.calibracaoPeriodicidadeMeses, 12, 'spec D-08: anual');
  assert.equal(b.capacidade, null);
  const c = A.normalizar({codigo: 'x', nome: 'y', tipo: 'ENVASADORA', exigeAssepsia: false, capacidade: '2,5'});
  assert.equal(c.exigeAssepsia, false, 'o ativo pode fugir do padrão do tipo');
  assert.equal(c.capacidade, 2.5);
  assert.equal(A.normalizar({tipo: 'INVENTADO'}).tipo, 'OUTRO');
});

ok('validar: obrigatórios, código único sem caixa/acento, capacidade e calibração', () => {
  assert.deepEqual(A.validar(A.normalizar({}), base).length, 2);
  const dup = A.validar(A.normalizar({codigo: 'rt-01', nome: 'Outro reator', tipo: 'REATOR'}), base);
  assert.match(dup.join(' '), /Já existe um equipamento com o código RT-01 \(Reator 500 kg\)/);
  assert.deepEqual(A.validar(A.normalizar({codigo: 'RT-01', nome: 'Reator 500 kg', tipo: 'REATOR'}), base, 'a1'), [], 'editar ele mesmo não é duplicado');
  assert.match(A.validar(A.normalizar({codigo: 'Z', nome: 'Z', tipo: 'OUTRO', capacidade: '-3'}), base).join(), /capacidade/);
  assert.match(A.validar(A.normalizar({codigo: 'Z', nome: 'Z', tipo: 'BALANCA', calibracaoPeriodicidadeMeses: '0'}), base).join(), /meses/);
});

ok('sugerirCodigo: próximo da sigla do tipo', () => {
  assert.equal(A.sugerirCodigo('ENVASADORA', base), 'EV-03');
  assert.equal(A.sugerirCodigo('REATOR', base), 'RT-02');
  assert.equal(A.sugerirCodigo('ESTUFA', base), 'EF-01');
  assert.equal(A.sugerirCodigo('REATOR', {}), 'RT-01');
});

ok('resumo e filtros', () => {
  const r = A.resumo(base);
  assert.equal(r.total, 4);
  assert.deepEqual(r.porSituacao, {OPERACIONAL: 2, EM_MANUTENCAO: 1, INATIVO: 1});
  assert.equal(r.assepsia, 2, 'inativo não conta');
  assert.equal(r.calibracao, 1);
  const cod = (f) => A.filtrar(base, f).map((a) => a.codigo);
  assert.deepEqual(cod({}), ['BL-01', 'EV-01', 'EV-02', 'RT-01']);
  assert.deepEqual(cod({busca: 'envasadora pistao'}), ['EV-01']);
  assert.deepEqual(cod({area: 'ENVASE'}), ['EV-01', 'EV-02']);
  assert.deepEqual(cod({linha: 'LINHA 1'}), ['EV-01', 'EV-02'], 'linha sem caixa/espaço');
  assert.deepEqual(cod({marcador: 'assepsia'}), ['EV-01', 'RT-01']);
  assert.deepEqual(cod({situacao: 'EM_MANUTENCAO'}), ['BL-01']);
});

ok('mudarSituacao: motivo obrigatório ao parar/inativar, histórico junto', () => {
  assert.match(A.mudarSituacao('a1', base.a1, 'EM_MANUTENCAO', {}).erro, /motivo/);
  assert.match(A.mudarSituacao('a1', base.a1, 'OPERACIONAL', {}).erro, /já está/);
  const r = A.mudarSituacao('a1', base.a1, 'EM_MANUTENCAO', {motivo: 'Vedação do eixo', por: 'Gustavo', agora: '2026-10-19T12:00:00Z', chaveHistorico: 'h1'});
  assert.equal(r.updates['ativos/a1/situacao'], 'EM_MANUTENCAO');
  assert.equal(r.updates['ativos/a1/situacaoMotivo'], 'Vedação do eixo');
  assert.deepEqual(r.updates['ativos_historico/a1/h1'], {de: 'OPERACIONAL', para: 'EM_MANUTENCAO', motivo: 'Vedação do eixo', por: 'Gustavo', em: '2026-10-19T12:00:00Z'});
  const volta = A.mudarSituacao('a3', base.a3, 'OPERACIONAL', {agora: 'x', chaveHistorico: 'h2'});
  assert.equal(volta.updates['ativos/a3/situacaoMotivo'], null, 'voltar a operar não pede motivo');
});

ok('consumidores: equipamentos da linha e por tipo, sem inativos', () => {
  assert.deepEqual(A.daLinha(base, 'Linha 1').map((a) => a.codigo), ['EV-01']);
  assert.deepEqual(A.daLinha(base, 'Linha 1', {assepsia: true}).map((a) => a.codigo), ['EV-01']);
  assert.deepEqual(A.porTipo(base, ['REATOR', 'TACHO']).map((a) => a.codigo), ['RT-01']);
});

console.log(`\nrun_ativos_test: ${n} OK`);
