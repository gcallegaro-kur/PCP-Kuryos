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
  // Checklist do líder: foto em todo item (08/10).
  A.ITENS_LIDER.forEach((i) => { itens[i.n] = respostas && respostas[i.n] ? respostas[i.n] : {r: 'C', fotos: [{url: 'https://f/' + i.n}]}; });
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
assert.deepEqual(A.validar(qualidade({}, {setor: 'Laboratório'}), {uid: 'u2', lideresDoSetor: ['u1']}), [], 'a outra analista audita o Laboratório');

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
assert.equal(cob.length, A.SETORES.length);
assert.equal(A.SETORES.length, 15);

// ── Setores e áreas (lista inicial do usuário, 06/10) e edição pelo administrador ──
assert.deepEqual(A.SETORES, ['Produção', 'Manipulação', 'Rotulagem', 'Refeitório', 'Vestiários', 'Escritório', 'Estoque MUC (Material de Uso e Consumo)', 'Recepção', 'Expedição', 'Laboratório', 'Manutenção', 'Área de Lavagem', 'DML', 'Retenção', 'Reciclagem']);
let cfgS = A.setoresConfigurados(null);
assert.equal(cfgS.length, 15);
assert.deepEqual(cfgS[0].areas.map((x) => x.nome), ['Linha 1', 'Linha 2', 'Linha 3']);
assert.deepEqual(cfgS[2].areas.map((x) => x.nome), ['Rotulagem 1', 'Rotulagem 2', 'Rotulagem 3', 'Estoque']);
assert.deepEqual(cfgS.find((x) => x.nome === 'Expedição').areas.map((x) => x.nome), ['Estoque', 'Doca']);
assert.ok(cfgS.every((x) => x.ativo));
// A configuração do banco (objetos com chave) substitui a lista; ordem pelo campo `ordem`; área com responsável
cfgS = A.setoresConfigurados({s2: {nome: 'Doca Externa', ordem: 2, ativo: false, areas: {a1: {nome: 'Portão', responsavel: 'João'}}}, s1: {nome: 'Produção', ordem: 1, areas: {a2: {nome: 'Linha 2'}, a1: {nome: 'Linha 1', responsavel: 'Maria'}}}});
assert.deepEqual(cfgS.map((x) => x.nome), ['Produção', 'Doca Externa']);
assert.deepEqual(cfgS[0].areas, [{nome: 'Linha 1', responsavel: 'Maria'}, {nome: 'Linha 2', responsavel: ''}]);
assert.equal(cfgS[1].ativo, false);
assert.deepEqual(A.setoresConfigurados({}).length, 15, 'configuração vazia = lista inicial');
// O setor escolhido precisa existir na lista em uso
assert.ok(A.validar(qualidade({}, {setor: 'Doca Externa'}), {}).some((e) => /setor/.test(e)), 'fora da lista padrão');
assert.deepEqual(A.validar(qualidade({}, {setor: 'Doca Externa'}), {setores: ['Doca Externa']}), [], 'na lista configurada vale');

// ── Foto: líder em todo item (C ou NC); auditoria/inspeção só no NC (08/10) ──
{
  const semFoto = lider({1: {r: 'C'}});
  assert.ok(A.validar(semFoto, {}).some((e) => /Item 1 \(C\).*foto mesmo conforme/.test(e)));
  assert.deepEqual(A.validarItem({r: 'C'}, '1', 'LIDER', 1), [], 'foto escolhida (ainda não enviada) vale');
  assert.deepEqual(A.validarItem({r: 'NA'}, '2', 'LIDER', 0), [], 'NA não pede foto');
  assert.deepEqual(A.validarItem({r: 'C'}, '1', 'QUALIDADE', 0), [], 'auditoria: C sem foto');
  assert.deepEqual(A.validarItem({r: 'C'}, '1', 'DIRETORIA', 0), [], 'inspeção: C sem foto');
  assert.equal(A.exigeFoto('LIDER', 'C'), true); assert.equal(A.exigeFoto('QUALIDADE', 'C'), false); assert.equal(A.exigeFoto('DIRETORIA', 'NC'), true);
}

// ── Auditor que também é líder: rodízio (08/10; Yasmim e Roberta, Laboratório e Retenção) ──
{
  const cfgU = {yas: {papel: 'AUDITOR', setores: ['Laboratório', 'Retenção']}, rob: {papel: 'AUDITOR', setores: ['Laboratório', 'Retenção']},
    ana: {papel: 'AUDITOR'}, jo: {papel: 'LIDER', setores: ['Produção']}};
  const S = ['Laboratório', 'Retenção', 'Produção', 'Expedição'];
  assert.deepEqual(A.lideresDoSetor(cfgU, 'Laboratório'), ['yas', 'rob'], 'auditor com setor marcado é líder dele');
  assert.deepEqual(A.lideresDoSetor(cfgU, 'Produção'), ['jo']);
  const chkYas = {tipo: 'LIDER', setor: 'Laboratório', data: '2026-10-08', responsavelUid: 'yas'};
  const regs = {r1: chkYas};
  const audLab = (extra) => qualidade({}, Object.assign({setor: 'Laboratório', data: '2026-10-08'}, extra));
  const ctx = (uid, a) => ({uid, auditorLider: cfgU[uid].papel === 'AUDITOR', lideresDoSetor: A.lideresDoSetor(cfgU, 'Laboratório'), auditorias: a || regs, setores: S});
  // Yasmim preencheu o checklist: Roberta audita; Yasmim não.
  assert.deepEqual(A.validar(audLab(), ctx('rob')), [], 'a outra líder audita');
  assert.ok(A.validar(audLab(), ctx('yas')).some((e) => /preencheu o checklist do líder de Laboratório.*rodízio/.test(e)));
  // Outro dia ou outro setor: Yasmim audita.
  assert.deepEqual(A.validar(audLab({data: '2026-10-09'}), ctx('yas')), []);
  assert.deepEqual(A.validar(qualidade({}, {setor: 'Retenção', data: '2026-10-08'}), Object.assign(ctx('yas'), {lideresDoSetor: A.lideresDoSetor(cfgU, 'Retenção')})), []);
  // Registro anulado não conta.
  assert.deepEqual(A.validar(audLab(), ctx('yas', {r1: Object.assign({}, chkYas, {anulada: true})})), []);
  // Vice-versa: quem auditou não preenche o checklist do dia.
  const audRob = {r2: {tipo: 'QUALIDADE', setor: 'Laboratório', data: '2026-10-08', assinatura: {uid: 'rob'}}};
  const chkLab = (uid) => A.validar(Object.assign(lider(), {setor: 'Laboratório', data: '2026-10-08'}), ctx(uid, audRob));
  assert.ok(chkLab('rob').some((e) => /auditou Laboratório neste dia/.test(e)));
  assert.deepEqual(chkLab('yas'), []);
  // Líder que não é auditor continua sem auditar o próprio setor.
  assert.ok(A.validar(qualidade({}, {setor: 'Produção'}), {uid: 'jo', lideresDoSetor: ['jo'], auditorias: {}, setores: S}).some((e) => /de fora do setor/.test(e)));
  // Painel: quem audita hoje.
  assert.deepEqual(A.rodizio(cfgU, 'Laboratório', regs, '2026-10-08'), {auditoresLideres: ['yas', 'rob'], checklistPor: ['yas'], auditaPor: ['rob']});
  assert.deepEqual(A.rodizio(cfgU, 'Laboratório', {}, '2026-10-08').auditaPor, ['yas', 'rob'], 'sem checklist ainda: qualquer uma');
  assert.equal(A.rodizio(cfgU, 'Produção', regs, '2026-10-08'), null, 'setor sem auditor-líder');
}

console.log('OK Auditoria 5S: % e status do líder e da Qualidade, críticos, validação do NC, ações, escada disciplinar (só sugestão), cobertura e rodízio do auditor-líder.');
