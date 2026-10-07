'use strict';
/* Feedback e Clima (06/10) -- período semanal/quinzenal, quem avalia quem, validações, pendências e indicadores do dashboard.
   node run_feedback_clima_test.js */
const assert = require('node:assert/strict');
const F = require('./public/shared/feedback-clima.js');
const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, (msg || '') + ' ' + a + ' ≠ ' + b);

// ── semana ISO e períodos ──
assert.deepEqual(F.semanaIso('2026-01-01'), {ano: 2026, semana: 1});
assert.deepEqual(F.semanaIso('2025-12-29'), {ano: 2026, semana: 1}, 'segunda de 29/12 já é semana 1 de 2026');
assert.deepEqual(F.semanaIso('2026-10-06'), {ano: 2026, semana: 41});
assert.deepEqual(F.semanaIso('2026-12-31'), {ano: 2026, semana: 53});
assert.deepEqual(F.semanaIso('2027-01-03'), {ano: 2026, semana: 53}, 'domingo de 03/01/2027 ainda é 2026-S53');
let p = F.periodoDe('2026-10-06', {});
assert.equal(p.id, '2026-S41'); assert.equal(p.tipo, 'semanal'); assert.equal(p.inicio, '2026-10-05'); assert.equal(p.prazo, '2026-10-09'); assert.equal(p.fim, '2026-10-11');
assert.equal(F.periodoDe('2026-10-11', {}).id, '2026-S41', 'segunda e domingo da mesma semana caem no mesmo período');
assert.equal(F.periodoDe('2026-10-12', {}).id, '2026-S42', 'a semana seguinte gera período novo');
assert.equal(F.periodoDe('2026-10-31', {}).id, '2026-S44', 'antes da virada continua semanal (sábado 31/10)');
p = F.periodoDe('2026-11-02', {});
assert.equal(p.id, '2026-Q23', 'virada para quinzenal sozinha, numa segunda'); assert.equal(p.tipo, 'quinzenal');
assert.equal(p.inicio, '2026-11-02'); assert.equal(p.prazo, '2026-11-13', 'a sexta que fecha a quinzena'); assert.equal(p.fim, '2026-11-15');
assert.equal(F.periodoDe('2026-11-09', {}).id, '2026-Q23', 'segunda semana da quinzena');
assert.equal(F.periodoDe('2026-11-09', {}).inicio, '2026-11-02');
assert.equal(F.periodoDe('2026-11-16', {}).id, '2026-Q24');
assert.equal(F.periodoDe('2026-10-06', {periodicidade: 'quinzenal'}).tipo, 'quinzenal', 'periodicidade base quinzenal vale antes da virada');
assert.equal(F.periodoDe('2026-11-16', {quinzenalAPartirDe: ''}).tipo, 'semanal', 'sem data de virada vale a base');
assert.equal(F.inicioDoPeriodo('2026-S41'), '2026-10-05'); assert.equal(F.inicioDoPeriodo('2026-Q23'), '2026-11-02'); assert.equal(F.inicioDoPeriodo('x'), null);
assert.deepEqual(F.ordenarPeriodos(['2026-S44', '2026-Q23', '2026-S41', 'lixo']), ['2026-S41', '2026-S44', '2026-Q23'], 'ordem cronológica, não alfabética');
assert.equal(F.periodoAnterior(F.periodoDe('2026-11-02', {}), {}).id, '2026-S44');
assert.match(F.rotuloPeriodo(F.periodoDe('2026-10-06', {})), /05\/10 a 09\/10/);

// ── quem avalia quem ──
const hoje = '2026-10-08';
const dir = {
  L: {nome: 'Lúcia Líder', setor: 'Produção', tipo: 'colaborador', status: 'Ativo'},
  A: {nome: 'Ana', setor: 'Produção', gestorKey: 'L', tipo: 'colaborador', status: 'Ativo', uidLogin: 'uA'},
  B: {nome: 'Bia', setor: 'produção', gestorKey: 'L', tipo: 'colaborador', status: 'Ativo', uidLogin: 'uB'},
  C: {nome: 'Caio', setor: 'Produção', gestorKey: 'L', tipo: 'colaborador', status: 'Ativo', uidLogin: 'uC'},
  D: {nome: 'Dora', setor: 'Expedição', gestorKey: 'L', tipo: 'colaborador', status: 'Ativo'},
  E: {nome: 'Edu', setor: 'Produção', gestorKey: 'L', tipo: 'colaborador', status: 'Desligado'},
  S: {nome: 'Sem Setor', gestorKey: 'L', tipo: 'colaborador', status: 'Ativo'},
  T1: {nome: 'Temp Recente', setor: 'Produção', tipo: 'temporario', status: 'Ativo', ultimoOk: '2026-10-05'},
  T2: {nome: 'Temp Antiga', setor: 'Produção', tipo: 'temporario', status: 'Ativo', ultimoOk: '2026-08-01'},
  T3: {nome: 'Temp Inativa', setor: 'Produção', tipo: 'temporario', status: 'Inativo', ultimoOk: '2026-10-05'}
};
let a = F.alvosDe('A', dir, hoje);
assert.deepEqual(a.pares.map(x => x.id), ['B', 'C', 'T1'], 'pares do mesmo setor (sem caixa), sem o próprio, sem o líder, sem desligado, sem temporário parado ou inativo');
assert.equal(a.pares.find(x => x.id === 'T1').tipo, 'temporario'); assert.deepEqual(a.lider, {id: 'L', nome: 'Lúcia Líder'}); assert.ok(a.ok && !a.semSetor);
assert.ok(!a.pares.some(x => x.id === 'D'), 'outro setor não é par');
a = F.alvosDe('L', dir, hoje);
assert.deepEqual(a.pares.map(x => x.id), ['T1'], 'o líder não avalia os liderados diretos como pares');
assert.equal(a.lider, null);
a = F.alvosDe('S', dir, hoje);
assert.deepEqual(a.pares, [], 'sem setor não há pares'); assert.ok(a.semSetor); assert.equal(a.lider.id, 'L', 'mas o líder continua');
assert.equal(F.alvosDe('T1', dir, hoje).ok, false, 'temporário não responde'); assert.equal(F.alvosDe('E', dir, hoje).ok, false, 'desligado não avalia');
assert.equal(F.alvosDe('zz', dir, hoje).ok, false);
assert.ok(!F.alvosDe('A', Object.assign({}, dir, {E: Object.assign({}, dir.E, {status: 'Ativo'})}), hoje).pares.every(x => x.id !== 'E'), 'reativado volta a ser par');

// ── validações ──
const par = F.MODELO_PAR, lid = F.MODELO_LIDER, clima = F.MODELO_CLIMA;
assert.deepEqual(F.validarResposta(par, {notas: {'espirito-de-equipe': 4, habilidade: 5, respeito: 3, comunicacao: 1}}), []);
assert.equal(F.validarResposta(par, {notas: {'espirito-de-equipe': 4, habilidade: 6, respeito: 3}}).length, 2, 'nota fora de 1-5 e critério faltando');
assert.equal(F.validarResposta(par, {notas: {'espirito-de-equipe': 4, habilidade: 5, respeito: 3, comunicacao: 3}, comentario: 'x'.repeat(1001)}).length, 1);
assert.equal(F.validarResposta(lid, {notas: {clareza: 3.5, apoio: 3, feedback: 3, respeito: 3}}).length, 1, 'nota fracionada não vale');
assert.deepEqual(F.validarClima(clima, {humor: 4, condicoes: 3, recomendaria: 5}, ''), []);
assert.equal(F.validarClima(clima, {humor: 4}, '').length, 2);
assert.equal(F.validarClima(clima.concat([{id: 'aberta', texto: 'Algo?', tipo: 'texto'}]), {humor: 4, condicoes: 3, recomendaria: 5}, '').length, 0, 'pergunta de texto aceita vazio');
assert.equal(F.validarClima(clima, {humor: 4, condicoes: 3, recomendaria: 5}, 'x'.repeat(2001)).length, 1);
assert.deepEqual(F.validarModelo('par', par), []);
assert.match(F.validarModelo('par', Array.from({length: 9}, (_, i) => ({id: 'c' + i, nome: 'C' + i})))[0], /no máximo 8/);
assert.match(F.validarModelo('par', [])[0], /ao menos um/);
assert.ok(F.validarModelo('par', [{id: 'a', nome: 'A'}, {id: 'a', nome: 'B'}]).some(m => /repetidos/.test(m)));
assert.ok(F.validarModelo('clima', [{id: 'q', texto: 'Q', tipo: 'outro'}]).some(m => /escala ou texto/.test(m)));
assert.equal(F.idDe('Espírito de Equipe!'), 'espirito-de-equipe');

// ── pendências e participação ──
const participacao = {'2026-S41': {A: {pares: 3, lider: true, clima: true}, B: {pares: 3, lider: true, clima: true}, C: {clima: true}}};
let pend = F.pendencias('2026-S41', dir, participacao, hoje);
const porId = Object.fromEntries(pend.map(x => [x.id, x]));
assert.deepEqual(porId.A.faltam, [], 'quem completou tudo não tem pendência');
assert.deepEqual(porId.C.faltam, ['3 colegas a avaliar', 'líder (Lúcia Líder)']);
assert.deepEqual(porId.L.faltam, ['1 colega a avaliar', 'pesquisa de clima'], 'a líder avalia o temporário do setor, não os liderados');
assert.equal(porId.D.faltam.length, 2, 'sem colegas no setor: só líder e clima');
assert.ok(!porId.T1 && !porId.E, 'temporário e desligado não entram na cobrança');
assert.ok(porId.S.semSetor);
assert.equal(porId.A.esperado, 5); assert.equal(porId.A.feito, 5);

// ── dashboard ──
const respostas = {
  '2026-S40': {k1: {tipo: 'par', avaliadoId: 'B', avaliadorId: 'A', notas: {'espirito-de-equipe': 5, habilidade: 5, respeito: 5, comunicacao: 5}}},
  '2026-S41': {
    r1: {tipo: 'par', avaliadoId: 'B', avaliadorId: 'A', notas: {'espirito-de-equipe': 4, habilidade: 4, respeito: 4, comunicacao: 4}},
    r2: {tipo: 'par', avaliadoId: 'B', avaliadorId: 'C', notas: {'espirito-de-equipe': 5, habilidade: 3, respeito: 4, comunicacao: 4}},
    r3: {tipo: 'par', avaliadoId: 'C', avaliadorId: 'A', notas: {'espirito-de-equipe': 2, habilidade: 3, respeito: 2, comunicacao: 3}},
    l1: {tipo: 'lider', avaliadoId: 'L', avaliadorId: 'A', notas: {clareza: 4, apoio: 4, feedback: 5, respeito: 5}},
    l2: {tipo: 'lider', avaliadoId: 'L', avaliadorId: 'B', notas: {clareza: 2, apoio: 3, feedback: 3, respeito: 2}},
    l3: {tipo: 'lider', avaliadoId: 'L', avaliadorId: 'C', notas: {clareza: 3, apoio: 3, feedback: 3, respeito: 3}}
  }
};
const climaR = {
  '2026-S40': {c1: {colaboradorId: 'A', setor: 'Produção', respostas: {humor: 4, condicoes: 4, recomendaria: 4}}, c2: {colaboradorId: 'B', setor: 'Produção', respostas: {humor: 4, condicoes: 4, recomendaria: 4}}},
  '2026-S41': {
    c1: {colaboradorId: 'A', setor: 'Produção', respostas: {humor: 5, condicoes: 4, recomendaria: 5}},
    c2: {colaboradorId: 'B', setor: 'Produção', respostas: {humor: 3, condicoes: 3, recomendaria: 4}},
    c3: {colaboradorId: 'C', setor: 'Produção', respostas: {humor: 2, condicoes: 2, recomendaria: 2}, recadoRh: 'Faltam luvas no posto 2'}
  }
};
const rh = {A: {sexo: 'feminino', tipoContrato: 'CLT', dataAdmissao: '2026-08-01'}, B: {sexo: 'masculino', tipoContrato: 'CLT', dataAdmissao: '2025-01-10'}, C: {sexo: 'masculino', tipoContrato: 'PJ', dataAdmissao: '2020-03-02'}};
const modelos = {par: par, lider: lid, clima: clima};
const part = Object.assign({'2026-S40': {}}, participacao);
let dsh = F.dashboard({periodo: '2026-S41', hoje: hoje, ciclo: {limiteLider: 3.5}, modelos: modelos, diretorio: dir, respostas: respostas, clima: climaR, participacao: part, rh: rh, recadosLidos: {}});
assert.equal(dsh.periodoAnterior, '2026-S40');
// 8.1
assert.equal(dsh.participacao.esperado, 21); assert.equal(dsh.participacao.feito, 11); perto(dsh.participacao.pct, 11 / 21);
const pendIds = dsh.participacao.pendentes.map(x => x.id).sort();
assert.ok(pendIds.includes('C') && pendIds.includes('L') && !pendIds.includes('A'));
assert.equal(dsh.respostasAutomatico.n, 6); assert.equal(dsh.respostasAutomatico.automaticas, 2, 'r1 e l3 têm a mesma nota em tudo'); perto(dsh.respostasAutomatico.pct, 2 / 6);
assert.equal(dsh.coberturaConfiavel.confiaveis, 1, 'só a líder recebeu 3 avaliações'); assert.equal(dsh.coberturaConfiavel.n, 6);
assert.deepEqual(dsh.evolucaoParticipacao.map(x => x.periodo), ['2026-S41'], 'só períodos com participação registrada (S40 está vazio), mais o atual');
// 8.2
assert.equal(dsh.clima.n, 3); perto(dsh.clima.indice, (14 / 3 + 10 / 3 + 2) / 3); perto(dsh.clima.indiceAnterior, 4); perto(dsh.clima.variacao, dsh.clima.indice - 4);
assert.equal(dsh.enps.n, 3); assert.equal(dsh.enps.valor, 33, '(2 notas 4-5 − 1 nota 1-2) ÷ 3');
assert.equal(dsh.condicoes.n, 3); perto(dsh.condicoes.media, 3);
assert.equal(dsh.climaPorSetor.length, 1); assert.equal(dsh.climaPorSetor[0].n, 3); assert.equal(dsh.climaPorSetor[0].oculto, false);
assert.deepEqual(dsh.quedaBrusca.porSetor.map(x => x.chave), ['Produção'], 'queda de 0,67 contra a média anterior');
assert.deepEqual(dsh.quedaBrusca.porPessoa.map(x => x.chave), ['B'], 'B caiu de 4,0 para 3,33; A subiu; C não tem histórico');
assert.equal(dsh.recados.n, 1); assert.equal(dsh.recados.naoLidos, 1);
assert.equal(F.dashboard({periodo: '2026-S41', hoje: hoje, modelos: modelos, diretorio: dir, respostas: respostas, clima: climaR, participacao: part, rh: rh, recadosLidos: {'2026-S41': {c3: true}}}).recados.naoLidos, 0);
// 8.3
assert.equal(dsh.notaGeral.n, 3); perto(dsh.notaGeral.media, (4 + 4 + 2.5) / 3); perto(dsh.notaGeral.mediaAnterior, 5); perto(dsh.notaGeral.variacao, dsh.notaGeral.media - 5);
const crit = Object.fromEntries(dsh.porCriterio.map(c => [c.id, c])); perto(crit.respeito.media, (4 + 4 + 2) / 3); assert.equal(crit.respeito.n, 3);
assert.equal(dsh.notaPorSetor[0].setor, 'Produção'); assert.equal(dsh.notaPorSetor[0].n, 3);
assert.equal(dsh.lideres.length, 1); perto(dsh.lideres[0].media, (4.5 + 2.5 + 3) / 3); assert.equal(dsh.lideres[0].n, 3); assert.ok(dsh.lideres[0].confiavel);
assert.equal(dsh.lideres[0].criterios.find(c => c.id === 'clareza').media, 3);
assert.equal(dsh.lideresAbaixoDoLimite.length, 1, 'limite configurado em 3,5');
assert.equal(F.dashboard({periodo: '2026-S41', hoje: hoje, modelos: modelos, diretorio: dir, respostas: respostas, clima: climaR, participacao: part, rh: rh}).lideresAbaixoDoLimite.length, 0, 'limite padrão 3,0');
assert.deepEqual(dsh.pessoasAbaixoDoLimite, [], 'ninguém tem 3 avaliações recebidas');
assert.equal(dsh.dispersao.length, 1); assert.equal(dsh.dispersao[0].id, 'B'); perto(dsh.dispersao[0].desvio, 0);
assert.equal(dsh.maioresQuedas.length, 1); assert.equal(dsh.maioresQuedas[0].id, 'B'); perto(dsh.maioresQuedas[0].variacao, 4 - 5);
// 8.4
assert.equal(dsh.cruzamentos.semAutoria, 0);
assert.equal(dsh.cruzamentos.recemAdmitidos.n, 1); assert.equal(dsh.cruzamentos.recemAdmitidos.oculto, true, 'N menor que 3 não publica o índice');
assert.deepEqual(dsh.cruzamentos.porTempoDeCasa.map(g => g.grupo).sort(), ['Mais de 3 anos', 'Menos de 90 dias', '1 a 3 anos'].sort());
assert.deepEqual(dsh.cruzamentos.porContrato.map(g => [g.grupo, g.n]), [['CLT', 2], ['PJ', 1]]);
assert.deepEqual(dsh.cruzamentos.porSexo.map(g => [g.grupo, g.n]), [['feminino', 1], ['masculino', 2]]);
assert.equal(dsh.cruzamentos.liderBomClimaBaixo.length, 0, 'líder com média 3,3 não é "bem avaliado"');
// sem autoria (rhVeAutoriaClima = false): clima sem colaboradorId não entra nos cruzamentos
const anon = JSON.parse(JSON.stringify(climaR)); Object.keys(anon['2026-S41']).forEach(k => { anon['2026-S41'][k].colaboradorId = null; });
dsh = F.dashboard({periodo: '2026-S41', hoje: hoje, modelos: modelos, diretorio: dir, respostas: respostas, clima: anon, participacao: part, rh: rh});
assert.equal(dsh.cruzamentos.semAutoria, 3); assert.deepEqual(dsh.cruzamentos.porContrato, []); assert.equal(dsh.clima.n, 3, 'o índice continua calculando');
assert.deepEqual(dsh.quedaBrusca.porPessoa, [], 'sem autoria não há queda por pessoa');
// setor com menos de 3 respostas não é publicado (A-04)
const poucos = {'2026-S41': {c1: climaR['2026-S41'].c1, c2: climaR['2026-S41'].c2}};
dsh = F.dashboard({periodo: '2026-S41', hoje: hoje, modelos: modelos, diretorio: dir, respostas: respostas, clima: poucos, participacao: part, rh: rh});
assert.equal(dsh.climaPorSetor[0].oculto, true); assert.equal(dsh.climaPorSetor[0].indice, null); assert.equal(dsh.climaPorSetor[0].n, 2);
// período vazio não quebra
dsh = F.dashboard({periodo: '2026-S42', hoje: '2026-10-14', modelos: modelos, diretorio: dir, respostas: {}, clima: {}, participacao: {}});
assert.equal(dsh.clima.n, 0); assert.equal(dsh.clima.indice, null); assert.equal(dsh.notaGeral.media, null); assert.equal(dsh.respostasAutomatico.pct, null);
// líder bem avaliado com clima baixo
const climaRuim = {'2026-S41': {x1: {colaboradorId: 'A', setor: 'Produção', respostas: {humor: 2, condicoes: 2, recomendaria: 2}}, x2: {colaboradorId: 'B', setor: 'Produção', respostas: {humor: 2, condicoes: 2, recomendaria: 2}}, x3: {colaboradorId: 'C', setor: 'Produção', respostas: {humor: 3, condicoes: 3, recomendaria: 3}}}};
const bons = {'2026-S41': {l1: {tipo: 'lider', avaliadoId: 'L', notas: {clareza: 5, apoio: 5, feedback: 4, respeito: 5}}}};
dsh = F.dashboard({periodo: '2026-S41', hoje: hoje, modelos: modelos, diretorio: dir, respostas: bons, clima: climaRuim, participacao: part, rh: rh});
assert.equal(dsh.cruzamentos.liderBomClimaBaixo.length, 1); assert.equal(dsh.cruzamentos.liderBomClimaBaixo[0].setor, 'Produção'); assert.equal(dsh.cruzamentos.liderBomClimaBaixo[0].lideres[0].nome, 'Lúcia Líder');


// ── diretório: reconstruído do cadastro do RH, só o que mudou ──
const cargos = {cg1: {nome: 'Operador', setor: 'Rotulagem'}};
const colabs = {
  c1: {nome: 'Ana', setor: 'Produção', gestorKey: 'c9', status: 'Ativo', uidLogin: 'uA', cpf: '111', salarioBase: 3000},
  c2: {nome: 'Bia', cargoKey: 'cg1', status: 'Ativo'},
  c3: {nome: 'Caio', setor: 'Expedição', status: 'Desligado', uidLogin: 'uC'},
  c9: {nome: 'Lúcia', setor: 'Produção', status: 'Ativo', uidLogin: 'uL'}
};
const temps = {t1: {nome: 'Davi', setor: 'Produção', status: 'Ativo'}, t2: {nome: 'Eva', status: 'Inativo'}};
const pres = {'2026-10-05': {t1: 'OK', t2: 'F'}, '2026-10-02': {t1: 'OK'}, '2026-10-06': {t1: 'NC'}};
let md = F.montarDiretorio({colaboradores: colabs, cargos: cargos, temporarios: temps, presenca: pres, dirAtual: {}, porUidAtual: {}});
assert.equal(md.total, 6); assert.equal(md.comLogin, 2, 'desligado não recebe vínculo de login');
assert.deepEqual(md.atualizacoes['feedback_diretorio/c1'], {nome: 'Ana', setor: 'Produção', setorChave: 'producao', gestorKey: 'c9', status: 'Ativo', tipo: 'colaborador'});
assert.ok(!JSON.stringify(md.atualizacoes).includes('111') && !JSON.stringify(md.atualizacoes).includes('3000'), 'nada sensível vai para o diretório');
assert.equal(md.atualizacoes['feedback_diretorio/c2'].setor, 'Rotulagem', 'sem setor próprio vale o setor do cargo');
assert.equal(md.atualizacoes['feedback_diretorio/t1'].ultimoOk, '2026-10-05'); assert.equal(md.atualizacoes['feedback_diretorio/t1'].tipo, 'temporario'); assert.equal(md.atualizacoes['feedback_diretorio/t2'].status, 'Inativo');
assert.equal(md.atualizacoes['feedback_diretorio_por_uid/uA'], 'c1'); assert.ok(!('feedback_diretorio_por_uid/uC' in md.atualizacoes));
// rodar de novo com o diretório já igual não muda nada; removido na origem vira null
const dirAtual = {}; Object.keys(md.atualizacoes).filter(k => k.startsWith('feedback_diretorio/')).forEach(k => { dirAtual[k.split('/')[1]] = md.atualizacoes[k]; });
const porUidAtual = {uA: 'c1', uL: 'c9', uOld: 'cX'};
dirAtual.cX = {nome: 'Saiu', tipo: 'colaborador'};
md = F.montarDiretorio({colaboradores: colabs, cargos: cargos, temporarios: temps, presenca: pres, dirAtual: dirAtual, porUidAtual: porUidAtual});
assert.deepEqual(md.atualizacoes, {'feedback_diretorio/cX': null, 'feedback_diretorio_por_uid/uOld': null});
assert.equal(F.ultimoOkDe('t1', pres), '2026-10-05'); assert.equal(F.ultimoOkDe('zz', pres), null);
assert.equal(F.setorDe({}, {}), '');

console.log('OK Feedback e Clima: períodos (semanal e quinzenal), quem avalia quem, validações, pendências e todos os indicadores do dashboard.');
