'use strict';
/* Auditoria 5S: cálculo, status, críticos, validação, ações, escada disciplinar e cobertura.
   As regras vêm do roteiro e da planilha Checklists_Auditoria_5S.xlsx. */
const assert = require('node:assert/strict');
const A = require('./public/shared/auditoria-5s.js');

// ── Os textos e a contagem de itens são os da planilha ──
assert.equal(A.ITENS_LIDER.length, 8);
assert.equal(A.ITENS_QUALIDADE.length, 20);
assert.equal(A.CRITICOS.length, 4);
assert.deepEqual(A.SENSOS, ['Seiri', 'Seiton', 'Seiso', 'Seiketsu', 'Shitsuke']);
assert.deepEqual(A.SENSOS.map((s) => A.ITENS_QUALIDADE.filter((i) => i.senso === s).length), [4, 4, 4, 4, 4]);
assert.match(A.ITENS_LIDER[4].texto, /corredores e saídas de emergência/);
assert.equal(A.ITENS_LIDER[4].critico, true);

const nc = (extra) => Object.assign({r: 'NC', local: 'Posto 3', fotos: [{url: 'u'}], acao: 'Limpar agora', responsavel: 'Operador do posto'}, extra);
function lider(respostas, perguntas) {
  const itens = {};
  A.ITENS_LIDER.forEach((i) => { itens[i.n] = respostas && respostas[i.n] ? respostas[i.n] : {r: 'C'}; });
  return {tipo: 'LIDER', setor: 'Produção', turno: '1º', data: '2026-10-06', horario: '17:40', responsavelNome: 'Líder A', itens,
    perguntas: Object.assign({mutirao: 'SIM', mutiraoHorario: '17:30', mutiraoMinutos: 10, todosParticiparam: 'SIM', pendenciasOntem: 'SIM', ocorrencias: 0}, perguntas || {})};
}
function qualidade(respostas, extra) {
  const itens = {};
  A.ITENS_QUALIDADE.concat(A.CRITICOS).forEach((i) => { itens[i.n] = respostas && respostas[i.n] ? respostas[i.n] : {r: 'C'}; });
  return Object.assign({tipo: 'QUALIDADE', setor: 'Expedição', data: '2026-10-06', horario: '10:15', responsavelNome: 'Analista Q', surpresa: true, liderPresente: 'SIM', itens,
    conferencia: {v1: 'SIM', v2: 'SIM'}}, extra || {});
}

// ── Líder: % e status ──
let r = A.calcular(lider());
assert.deepEqual([r.c, r.nc, r.na, r.pct, r.status], [8, 0, 0, 1, 'VERDE']);
r = A.calcular(lider({'3': nc(), '8': nc()}));                       // 6/8 = 75% → amarelo
assert.equal(r.pct, 0.75); assert.equal(r.status, 'AMARELO');
r = A.calcular(lider({'3': nc(), '8': nc(), '6': nc()}));            // 5/8 = 62,5% → vermelho
assert.equal(r.status, 'VERMELHO');
r = A.calcular(lider({'1': {r: 'NA'}, '2': {r: 'NA'}}));             // NA não entra: 6/6
assert.deepEqual([r.c, r.na, r.pct], [6, 2, 1]);
r = A.calcular(lider({'3': nc()}));                                   // 7/8 = 87,5% → verde (≥ 85%)
assert.equal(r.status, 'VERDE');
assert.equal(A.calcular(lider({'3': nc(), '8': nc()}), {verde: 0.7, amarelo: 0.5}).status, 'VERDE', 'os limites são parâmetro (aba Instruções)');
// Item crítico (5) NC: vermelho, mesmo com 87,5%
r = A.calcular(lider({'5': nc()}));
assert.equal(r.pct, 0.875); assert.equal(r.status, 'VERMELHO'); assert.equal(r.statusTexto, 'VERMELHO: ITEM CRÍTICO');
assert.match(r.alertas[0], /Item crítico NC: 5/);
// Tudo NA: aguardando
assert.equal(A.calcular(lider(Object.fromEntries(A.ITENS_LIDER.map((i) => [i.n, {r: 'NA'}])))).status, 'AGUARDANDO');
// Alertas de colaboração
r = A.calcular(lider({}, {mutirao: 'NAO', todosParticiparam: 'NAO', faltaram: 2, pendenciasOntem: 'NAO'}));
assert.equal(r.alertas.length, 3);
assert.match(r.alertas.join(' '), /mutirão de 10 min não foi realizado/);
assert.match(r.alertas.join(' '), /2 faltaram/);

// ── Qualidade: 20 itens, por senso, críticos e líder que não confere ──
r = A.calcular(qualidade());
assert.deepEqual([r.c, r.nc, r.pct, r.status], [20, 0, 1, 'VERDE']);
assert.equal(r.porSenso.Seiton.pct, 1);
r = A.calcular(qualidade({'5': nc(), '6': nc(), '7': nc(), '9': nc()}));  // 16/20 = 80% → amarelo
assert.equal(r.pct, 0.8); assert.equal(r.status, 'AMARELO');
assert.deepEqual([r.porSenso.Seiton.c, r.porSenso.Seiton.nc, r.porSenso.Seiton.pct], [1, 3, 0.25]);
assert.deepEqual([r.porSenso.Seiso.c, r.porSenso.Seiso.nc], [3, 1]);
r = A.calcular(qualidade({'C3': nc()}));
assert.equal(r.status, 'VERMELHO'); assert.equal(r.statusTexto, 'VERMELHO: ITEM CRÍTICO'); assert.equal(r.pct, 1, 'a % não conta os críticos, o status sim');
assert.deepEqual(r.criticosNC, ['C3']);
r = A.calcular(qualidade({}, {conferencia: {v1: 'NAO', v2: 'NAO'}, divergencias: ['5']}));
assert.equal(r.liderNaoConfere, true);
assert.match(r.alertas.join(' | '), /LÍDER NÃO CONFERE/);
assert.match(r.alertas.join(' | '), /não registrou as ocorrências/);

// ── Validação: NC exige local, foto, ação e responsável; nada de "mais ou menos" ──
assert.deepEqual(A.validar(lider(), {}), []);
let erros = A.validar(lider({'3': {r: 'NC'}}), {});
assert.equal(erros.length, 4, erros.join(' | '));
assert.ok(erros.some((e) => /local/.test(e)) && erros.some((e) => /foto/.test(e)) && erros.some((e) => /ação imediata/.test(e)) && erros.some((e) => /responsável/.test(e)));
assert.deepEqual(A.validar(lider({'3': {r: 'NC', local: 'x', acao: 'y', responsavel: 'z'}}), {fotosPendentes: {'3': 1}}), [], 'foto escolhida e ainda não enviada conta');
assert.match(A.validar(lider({'3': {r: 'MAIS OU MENOS'}}), {})[0], /responda C, NC ou NA/);
assert.match(A.validar(lider({'5': {r: 'NA'}}), {})[0], /crítico só aceita C ou NC/);
assert.ok(A.validar(Object.assign(lider(), {setor: ''}), {}).some((e) => /setor/.test(e)));
assert.ok(A.validar(lider({}, {mutirao: 'SIM', mutiraoHorario: ''}), {}).some((e) => /horário e a duração/.test(e)));
assert.ok(A.validar(lider({}, {todosParticiparam: 'NAO', faltaram: 0}), {}).some((e) => /quantos faltaram/.test(e)));
assert.ok(A.validar(lider({}, {ocorrencias: ''}), {}).some((e) => /ocorrências/.test(e)));
assert.deepEqual(A.validar(qualidade(), {}), []);
assert.ok(A.validar(qualidade({}, {conferencia: {v1: 'NAO', v2: 'SIM'}}), {}).some((e) => /itens que o líder marcou C/.test(e)));
assert.ok(A.validar(qualidade({}, {liderPresente: ''}), {}).some((e) => /líder estava presente/.test(e)));
// Auditor de fora do setor
assert.ok(A.validar(qualidade(), {uid: 'u9', lideresDoSetor: ['u1', 'u9']}).some((e) => /de fora do setor/.test(e)), 'quem lidera o setor não o audita');
assert.deepEqual(A.validar(qualidade({}, {setor: 'Qualidade'}), {uid: 'u2', lideresDoSetor: ['u1']}), [], 'a outra analista audita a Qualidade');

// ── Ações obrigatórias: máx. 5, críticos primeiro com prazo "hoje" ──
const muitos = {};
['1', '2', '3', '4', '6', '7'].forEach((n) => { muitos[n] = nc({local: 'Posto ' + n}); });
muitos['5'] = nc({local: 'Corredor B'});
const aud = lider(muitos);
const acoes = A.acoesObrigatorias(aud, A.calcular(aud));
assert.equal(acoes.length, 5);
assert.equal(acoes[0].n, '5'); assert.equal(acoes[0].prazo, 'hoje'); assert.equal(acoes[0].critico, true);
assert.equal(acoes[1].prazo, '48 h');
assert.equal(acoes[4].prazo, '7 dias');
assert.equal(A.acoesObrigatorias(lider({'3': nc({prazo: '7 dias'})}), {})[0].prazo, '7 dias', 'prazo informado pelo auditor vale');

// ── Consequência, linha de controle ──
assert.match(A.consequencia('VERMELHO'), /diretoria.*48 h/);
assert.match(A.consequencia('AMARELO'), /reunião semanal do comitê/);
assert.match(A.consequencia('VERDE'), /reconhecer o setor/);
const a1 = lider({'3': nc()});
assert.equal(A.linhaControle(a1, A.calcular(a1)), '06/10/2026;Produção;1º;Líder A;Checklist do líder;C,C,NC,C,C,C,C,C;Sim;VERDE 88%');

// ── Escada disciplinar: só sugere ──
assert.equal(A.escada(0, false).degrau, 1);
assert.match(A.escada(0, false).texto, /orientação verbal/);
assert.equal(A.escada(1, false).degrau, 2);
assert.equal(A.escada(2, false).degrau, 3);
assert.equal(A.escada(0, true).degrau, 2, 'segurança sobe um degrau');
assert.equal(A.escada(9, true).degrau, 6, 'o teto é o 6º degrau');
assert.match(A.escada(4, false).texto, /suspensão \(validar com o jurídico\)/);
assert.match(A.escada(0, false).aviso, /Nenhuma punição é aplicada pelo sistema/);
const ocs = {a: {colaboradorId: 'c1', data: '2026-08-01'}, b: {colaboradorId: 'c1', data: '2026-10-01'}, c: {colaboradorId: 'c1', data: '2026-05-01'},
  d: {colaboradorId: 'c2', data: '2026-10-01'}, e: {colaboradorId: 'c1', data: '2026-09-20', treinamento: true}, f: {colaboradorId: 'c1', data: '2026-09-21', anulada: true}};
assert.equal(A.ocorrenciasNosUltimos90(ocs, 'c1', '2026-10-06'), 2, '90 dias corridos; treinamento e anulada não contam; maio já saiu');

// ── Cobertura: o que falta hoje e na semana ──
assert.deepEqual(A.semana('2026-10-06'), {inicio: '2026-10-05', fim: '2026-10-11'});
const base = {
  x1: {tipo: 'LIDER', setor: 'Produção', turno: '1º', data: '2026-10-06', resultado: {statusTexto: 'VERDE'}},
  x2: {tipo: 'QUALIDADE', setor: 'Produção', data: '2026-10-05', resultado: {statusTexto: 'AMARELO'}},
  x3: {tipo: 'DIRETORIA', setor: 'Produção', data: '2026-10-07', resultado: {statusTexto: 'VERDE'}},
  x4: {tipo: 'QUALIDADE', setor: 'Produção', data: '2026-09-28', resultado: {statusTexto: 'VERMELHO'}},
  x5: {tipo: 'QUALIDADE', setor: 'Expedição', data: '2026-10-06', resultado: {statusTexto: 'VERDE'}, anulada: true}
};
const cob = A.cobertura(base, '2026-10-06');
const prod = cob.find((c) => c.setor === 'Produção'), exp = cob.find((c) => c.setor === 'Expedição');
assert.deepEqual([prod.liderHoje, prod.turnosHoje, prod.externasSemana, prod.faltamSemana], [1, ['1º'], 2, 0]);
assert.equal(prod.ultimaExterna, '2026-10-07');
assert.deepEqual([exp.liderHoje, exp.externasSemana, exp.faltamSemana, exp.ultimaExterna], [0, 0, 2, null], 'auditoria anulada não conta');
assert.equal(cob.length, 6);

console.log('OK Auditoria 5S: % e status do líder e da Qualidade, críticos, validação do NC, ações, escada disciplinar (só sugestão) e cobertura.');
