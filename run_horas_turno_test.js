'use strict';
/* Horas trabalhadas pela janela do turno (shared/horas-turno.js).
 *
 * Por que existe: `fechamento_op` e `apontamento_total` gravavam
 * `horasTrabalhadas = (agora − periodoInicio)/3600000` -- relógio cru. Turno
 * aberto numa segunda e fechado na quinta registrava 73h de trabalho.
 * Medido na base em 24/10/2026: 207 registros sujos, pior caso 94h, 4.529h
 * gravadas contra ~1.200h possíveis.
 *
 * O que este teste protege, em ordem de importância:
 *   1. hora NUNCA passa do teto do dia (9h; 8h na sexta);
 *   2. produção fora do turno (sábado, madrugada) NÃO vira zero -- recorte
 *      cego apagaria 28 registros reais de fim de semana;
 *   3. período multi-dia é reconhecido como multi-dia, para virar um registro
 *      por dia.
 *
 * TZ fixo: em UTC os limites do dia caem em outra hora e o teste passaria à
 * toa numa máquina fora do Brasil.
 */
process.env.TZ = 'America/Sao_Paulo';

const assert = require('node:assert/strict');
const H = require('./public/shared/horas-turno.js');

let n = 0;
const eq = (a, b, m) => { n++; assert.equal(a, b, m); };
const ok = (c, m) => { n++; assert.ok(c, m); };

// Config real da fábrica (config/ em 24/10/2026): turno único fixo.
const CFG = {
  modoOperacaoTurno: 'fixo', turnoFixoNome: 'Padrao', turnos: ['Padrao'],
  turnoHorarios: {Padrao: '07:00'}, turnoHorariosFim: {Padrao: '17:00'},
  turnoHorariosFimSexta: {Padrao: '16:00'}, turnoPausas: {Padrao: {inicio: '12:00', fim: '13:00'}}
};

// ── O teto de um dia ───────────────────────────────────────────────────────
// 2026-10-19 é segunda, 2026-10-23 é sexta.
eq(H.tetoDoDia('2026-10-19', CFG), 9, 'segunda: 07–17 menos 1h de pausa');
eq(H.tetoDoDia('2026-10-23', CFG), 8, 'sexta fecha 16:00');
eq(H.tetoDoDia('2026-10-24', CFG), 9, 'sábado usa a janela padrão (a fábrica às vezes trabalha)');
eq(H.tetoDoDia('2026-10-19', null), 9, 'sem config, cai no padrão -- nunca zera a hora de todo mundo');

// ── Caso normal: um turno dentro do dia ───────────────────────────────────
eq(H.horasUteis('2026-10-19T07:00:00', '2026-10-19T17:00:00', CFG), 9, 'turno cheio = 9h, a pausa sai');
eq(H.horasUteis('2026-10-19T07:00:00', '2026-10-19T12:00:00', CFG), 5, 'manhã inteira');
eq(H.horasUteis('2026-10-19T13:00:00', '2026-10-19T17:00:00', CFG), 4, 'tarde inteira');
eq(H.horasUteis('2026-10-19T11:30:00', '2026-10-19T13:30:00', CFG), 1, 'atravessando a pausa, conta só 1h');
eq(H.horasUteis('2026-10-19T06:00:00', '2026-10-19T20:00:00', CFG), 9,
  'chegou antes e saiu depois: o turno limita, não vira 14h');

// ── O caso que gerou tudo: turno aberto 16/10 e fechado 19/10 ─────────────
// 16/10 é sexta. O registro real gravava 73,03h.
{
  const dias = H.diasDoPeriodo('2026-10-16T18:58:00', '2026-10-19T17:00:00', CFG);
  eq(dias.map((d) => d.dia).join(','), '2026-10-16,2026-10-17,2026-10-18,2026-10-19',
    'quatro dias civis cobertos');
  const horas = H.horasUteis('2026-10-16T18:58:00', '2026-10-19T17:00:00', CFG);
  ok(horas <= 9 + 8 + 9 + 9, 'nunca mais que a soma dos tetos');
  ok(horas < 73, 'o relógio cru dizia 73h; isto tem que ser muito menos. Veio: ' + horas);
  dias.forEach((d) => ok(d.horas <= d.teto + 0.001, d.dia + ': ' + d.horas + 'h não pode passar de ' + d.teto + 'h'));
  // 16/10 sexta, começou 18:58 -- depois do fim do turno (16:00): fora do turno.
  eq(dias[0].foraDoTurno, true, 'sexta às 18:58 está fora do turno e fica sinalizado');
  // 17/10 sábado e 18/10 domingo: o período cobre o dia inteiro, mas o teto manda.
  eq(dias[1].horas, 9, 'sábado inteiro limitado ao turno');
  eq(dias[3].horas, 9, 'segunda 19/10 até as 17h = turno cheio');
  ok(H.atravessaDias('2026-10-16T18:58:00', '2026-10-19T17:00:00', CFG), 'é multi-dia');
}

// ── Produção FORA do turno não vira zero ──────────────────────────────────
// Recorte cego daria 0h e apagaria os 16 registros de sábado e 12 de domingo.
{
  const d = H.diasDoPeriodo('2026-10-25T20:00:00', '2026-10-25T23:00:00', CFG); // domingo à noite
  eq(d.length, 1);
  eq(d[0].horas, 3, 'três horas de domingo à noite continuam valendo 3h');
  eq(d[0].foraDoTurno, true, 'mas ficam marcadas como fora do turno');
  const m = H.diasDoPeriodo('2026-10-20T00:00:00', '2026-10-20T04:00:00', CFG); // madrugada
  eq(m[0].horas, 4, 'madrugada conta');
  eq(m[0].foraDoTurno, true);
  // E nem a madrugada pode passar do teto.
  const longo = H.diasDoPeriodo('2026-10-25T00:00:00', '2026-10-25T23:59:00', CFG);
  eq(longo[0].horas, 9, 'um domingo "de 24h" ainda é limitado a 9h');
}

// ── Período inválido ──────────────────────────────────────────────────────
eq(H.horasUteis('2026-10-19T17:00:00', '2026-10-19T07:00:00', CFG), 0, 'fim antes do início: 0');
// `new Date(null)` é 1970 e passa por data válida -- sem recusa explícita isto
// devolvia 3.537h, um total parcial com cara de certo.
eq(H.horasUteis(null, '2026-10-19T17:00:00', CFG), 0, 'sem início: 0');
eq(H.horasUteis('', '2026-10-19T17:00:00', CFG), 0, 'início vazio: 0');
eq(H.horasUteis('2026-10-19T07:00:00', null, CFG), 0, 'sem fim: 0');
eq(H.diasDoPeriodo('lixo', 'lixo', CFG).length, 0, 'data inválida não explode');
// Período absurdo é dado errado: recusa, não trunca em silêncio.
eq(H.diasDoPeriodo('2026-01-01T07:00:00', '2026-10-19T17:00:00', CFG).length, 0, 'mais de 60 dias: recusa');
eq(H.conferir('2026-01-01T07:00:00', '2026-10-19T17:00:00', CFG, null, 15).ok, false, 'e avisa que não tem duração válida');

// ── conferir(): o que a tela mostra ───────────────────────────────────────
{
  const r = H.conferir('2026-10-19T07:00:00', '2026-10-19T17:00:00', CFG, null, 15);
  eq(r.ok, true, 'turno normal não gera aviso');
  eq(r.horas, 9);
  eq(r.avisos.length, 0);

  const multi = H.conferir('2026-10-16T18:58:00', '2026-10-19T17:00:00', CFG, null, 15);
  eq(multi.ok, false, 'multi-dia tem que avisar');
  ok(/atravessa 4 dias/.test(multi.avisos.join(' ')), 'veio: ' + multi.avisos.join(' | '));
  ok(/um registro por dia/.test(multi.avisos.join(' ')), 'e diz o que fazer');

  const fora = H.conferir('2026-10-25T20:00:00', '2026-10-25T23:00:00', CFG, null, 15);
  eq(fora.ok, false);
  ok(/não encosta no horário do turno/.test(fora.avisos.join(' ')), 'veio: ' + fora.avisos.join(' | '));
  // A tolerância de 15 min não deixa um turno que passou 10 min virar aviso.
  const quase = H.conferir('2026-10-19T07:00:00', '2026-10-19T17:10:00', CFG, null, 15);
  eq(quase.avisos.filter((a) => /acima das/.test(a)).length, 0, 'dentro da tolerância, sem aviso de teto');
}

// ── A soma por dia fecha com o total ──────────────────────────────────────
{
  const ini = '2026-10-19T09:30:00', fim = '2026-10-22T15:00:00';
  const dias = H.diasDoPeriodo(ini, fim, CFG);
  const soma = dias.reduce((s, d) => s + d.horas, 0);
  eq(Math.round(soma * 100) / 100, H.horasUteis(ini, fim, CFG),
    'horasUteis é exatamente a soma dos dias -- senão o total e o detalhe discordariam');
}

/* ── A fiação no form.html ──
   O módulo certo não serve de nada se a tela continuar usando o relógio cru.
   Estas asserções são sobre a FONTE: travam que os três pontos que gravam
   `horasTrabalhadas` passem pela regra, e que o decorrido não volte. */
{
  const fs = require('fs');
  const src = fs.readFileSync('public/form.html', 'utf8');

  ok(/<script src="shared\/horas-turno\.js"><\/script>/.test(src), 'form.html carrega o módulo');
  ok(/function horasTrabalhadasPeriodo\(/.test(src), 'existe o helper de horas TRABALHADAS');
  ok(/function horasDesde\(/.test(src), 'e o de horas DECORRIDAS continua — "a OP está aberta há 73h" é verdade');

  // Os três pontos de gravação.
  eq((src.match(/horasTrabalhadasPeriodo\(/g) || []).length, 5,
    'o helper é definido 1x e usado nos 4 pontos que medem trabalho (3 gravam, 1 mostra o ritmo)');

  // O decorrido não pode mais alimentar horasTrabalhadas. Pega o padrão antigo:
  // `horasDesde(...)` atribuído a uma variável chamada `horas`.
  eq(/var horas\s*=\s*horasDesde\(/.test(src), false,
    'nenhum `var horas = horasDesde(...)` — era por aí que o decorrido virava trabalhado');
  eq(/horasCalc\s*=\s*\(new Date\([^)]*\)\.getTime\(\)\s*-\s*new Date/.test(src), false,
    'e nenhum cálculo de relógio cru para horasTrabalhadas');

  // O divisor por dia delega, em vez de repetir a regra.
  ok(/function buildDiaPeriodsMultiDia\([\s\S]{0,900}HorasTurno\.diasDoPeriodo\(/.test(src),
    'buildDiaPeriodsMultiDia usa HorasTurno.diasDoPeriodo');
  eq(/function duracaoUtilMinutos\(/.test(src), false,
    'duracaoUtilMinutos saiu: não recortava pela janela do turno e ficou sem uso');

  // O un/h da tela tem que sair da MESMA soma que vai para o registro.
  ok(/envaseMin = envaseDias\.reduce\(/.test(src),
    'envaseMin é a soma dos dias — senão a tela mostra um un/h e o registro guarda outro');

  // Período suspeito é confirmado com o operador, não gravado em silêncio.
  ok(/function confirmarPeriodoTrabalhado\(/.test(src), 'existe a confirmação do período');
  ok(/confirmarPeriodoTrabalhado\(periodoInicioCalc, agora\)/.test(src), 'e o fechamento de OP a chama');
  // Os TRES pontos de gravacao marcam a estimativa, nao so um: na primeira
  // versao eu liguei a marca e a confirmacao em um lugar so, e os quatro
  // fechamentos de 26/10 (21h a 26h, 4 dias) sairam sem marca nenhuma.
  // Conta ATRIBUICAO, nao mencao: o cabecalho tambem fala de horasEstimadas.
  eq((src.match(/horasEstimadas(?:: typeof HorasTurno|\s*=\s*true)/g) || []).length, 3,
    'os tres registros de fechamento marcam horasEstimadas');
  eq((src.match(/confirmarPeriodoTrabalhado\(/g) || []).length, 4,
    'a confirmacao e definida 1x e chamada nos 3 fechamentos');
}

/* ── Incremento zero no encerramento ──
   27/10/2026, lote 26295/02 (PERFUME ABELHINHA 30ML): a Linha 3 tinha 816
   registradas, o modal de encerramento abre com o campo preenchido com o JA
   REGISTRADO, e o fechamento gravou 0. A producao do dia (total 1.221,
   faltavam 405) nao entrou. Havia trava para total MENOR que o registrado,
   nenhuma para IGUAL -- e o valor padrao do campo era exatamente o que grava
   zero. */
{
  const fs = require('fs');
  const src = fs.readFileSync('public/form.html', 'utf8');
  ok(/function confirmarIncrementoZero\(/.test(src), 'existe a confirmacao de incremento zero');
  eq((src.match(/confirmarIncrementoZero\(/g) || []).length, 4,
    'definida 1x e chamada nos 3 pontos que fecham OP');
  ok(/delta === 0/.test(src), 'o hint trata o zero como caso proprio');
  ok(/vai registrar ZERO/.test(src), 'e avisa em texto de alerta, nao em cinza');
  // A trava do menor continua: zero confirma, menor recusa.
  eq((src.match(/O total final não pode ser menor que o já registrado/g) || []).length, 3,
    'as tres travas de total menor seguem no lugar');
}

console.log('OK Horas de turno: teto por dia, fora do turno não zera, multi-dia reconhecido, fiação e trava de incremento zero (' + n + ' verificações).');
