/* Horas TRABALHADAS de um período, pela janela do turno.

   POR QUE EXISTE (usuário, 23–24/10/2026): a soma do produzido dia a dia no
   Dashboard Diário não batia com o Dashboard Geral. A causa de fundo não era
   a data — era isto:

     var horasCalc = (new Date(agora) - new Date(periodoInicio)) / 3600000;

   `fechamento_op` e `apontamento_total` gravavam RELÓGIO CRU como horas
   trabalhadas. Se ninguém apontou por três dias, o sistema registrava 73
   horas de trabalho. O tempo parado entrava como produzido.

   Medido na base em 24/10: 207 registros sujos (jul–out/2026), pior caso 94h,
   4.529h gravadas contra ~1.200h fisicamente possíveis. Dividir o período por
   dia civil NÃO conserta (4.529h → 4.414h): a grandeza medida está errada, não
   a distribuição dela.

   A REGRA, e por que não é um recorte cego:
   O turno é a referência (07:00–17:00, 16:00 sexta, pausa 12:00–13:00 → 9h
   úteis, 8h na sexta). Mas recortar cegamente na janela apagaria produção
   real: a base tem 16 registros de sábado, 12 de domingo e apontamentos de
   00:00 às 23:00. Então, por dia civil coberto pelo período:

     1. interseção com a JANELA DO TURNO daquele dia, menos a parte da pausa
        que cai dentro — é o caso normal;
     2. se essa interseção for ZERO mas o período cobre tempo naquele dia
        (trabalho fora do turno: fim de semana, madrugada), vale o tempo REAL
        daquele dia, limitado ao tamanho do turno — não se apaga o que
        aconteceu, e também não se aceita um dia de 23h.

   `horasUteis` nunca é maior que o teto do dia. É isso que mantém un/h e
   rendimento com significado.

   Funções PURAS, sem DOM e sem Firebase. Testado em run_horas_turno_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HorasTurno = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var PADRAO = {inicio: '07:00', fim: '17:00', fimSexta: '16:00', pausa: {inicio: '12:00', fim: '13:00'}};

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function arred(v) { return Math.round(n(v) * 100) / 100; }
  function toMin(t) {
    if (!t) return null;
    var p = String(t).split(':');
    var h = parseInt(p[0], 10), m = parseInt(p[1] || '0', 10);
    if (!isFinite(h) || !isFinite(m)) return null;
    return h * 60 + m;
  }
  function ymdLocal(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function meioDia(ymd) { return new Date(ymd + 'T12:00:00'); }

  /* A janela do turno naquele dia. `cfg` aceita a forma da config do sistema
     (turnoHorarios / turnoHorariosFim / turnoHorariosFimSexta / turnoPausas,
     indexados pelo nome do turno) ou a forma simples {inicio, fim, fimSexta,
     pausa}. Sem config, cai no PADRÃO -- nunca devolve janela vazia, porque
     janela vazia zeraria a hora de todo apontamento. */
  function janelaDoDia(ymd, cfg, turno) {
    var c = cfg || {};
    var nome = turno || c.turnoFixoNome || (c.turnos && c.turnos[0]) || 'Padrao';
    var ini = (c.turnoHorarios && c.turnoHorarios[nome]) || c.inicio || PADRAO.inicio;
    var fim = (c.turnoHorariosFim && c.turnoHorariosFim[nome]) || c.fim || PADRAO.fim;
    var fimSex = (c.turnoHorariosFimSexta && c.turnoHorariosFimSexta[nome]) || c.fimSexta || PADRAO.fimSexta;
    var pausa = (c.turnoPausas && c.turnoPausas[nome]) || c.pausa || PADRAO.pausa;
    var dow = meioDia(ymd).getDay();
    var iniMin = toMin(ini), fimMin = toMin(dow === 5 ? fimSex : fim);
    if (iniMin == null || fimMin == null || fimMin <= iniMin) { iniMin = toMin(PADRAO.inicio); fimMin = toMin(PADRAO.fim); }
    var pIni = pausa ? toMin(pausa.inicio) : null, pFim = pausa ? toMin(pausa.fim) : null;
    if (pIni == null || pFim == null || pFim <= pIni) { pIni = null; pFim = null; }
    return {iniMin: iniMin, fimMin: fimMin, pausaIniMin: pIni, pausaFimMin: pFim, dow: dow};
  }

  // Horas úteis que o turno daquele dia oferece -- o TETO de um dia.
  function tetoDoDia(ymd, cfg, turno) {
    var j = janelaDoDia(ymd, cfg, turno);
    var min = j.fimMin - j.iniMin;
    if (j.pausaIniMin != null) {
      var oi = Math.max(j.iniMin, j.pausaIniMin), of = Math.min(j.fimMin, j.pausaFimMin);
      if (of > oi) min -= (of - oi);
    }
    return arred(Math.max(0, min) / 60);
  }

  /* Um item por dia civil coberto por [inicio, fim]:
       {dia, inicioIso, fimIso, horas, teto, foraDoTurno}
     `horas` segue a regra do cabeçalho e nunca passa de `teto`.
     `foraDoTurno` marca o dia em que a produção não encostou na janela — é o
     fim de semana / madrugada, que fica visível em vez de virar zero. */
  // Período longo demais não é turno, é dado errado -- e truncar em silêncio
  // devolveria um total parcial com cara de certo.
  var MAX_DIAS = 60;

  function diasDoPeriodo(inicioIso, fimIso, cfg, turno) {
    // `new Date(null)` é 1970 e passa por data válida: recusa explícita antes.
    if (inicioIso == null || fimIso == null || inicioIso === '' || fimIso === '') return [];
    var ini = new Date(inicioIso), fim = new Date(fimIso);
    if (isNaN(ini.getTime()) || isNaN(fim.getTime()) || fim <= ini) return [];
    var iniTs = ini.getTime(), fimTs = fim.getTime();
    if ((fimTs - iniTs) / 86400000 > MAX_DIAS) return [];
    var out = [];
    var cur = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate());
    var guarda = 0;
    while (cur.getTime() < fimTs && guarda <= MAX_DIAS + 1) {
      var base = cur.getTime();
      var dia = ymdLocal(cur);
      var segIni = Math.max(base, iniTs);
      var segFim = Math.min(base + 86400000, fimTs);
      if (segFim > segIni) {
        var j = janelaDoDia(dia, cfg, turno);
        var teto = tetoDoDia(dia, cfg, turno);
        // 1. interseção com a janela do turno, menos a pausa
        var janIni = base + j.iniMin * 60000, janFim = base + j.fimMin * 60000;
        var ti = Math.max(segIni, janIni), tf = Math.min(segFim, janFim);
        var min = tf > ti ? (tf - ti) / 60000 : 0;
        if (min > 0 && j.pausaIniMin != null) {
          var pi = base + j.pausaIniMin * 60000, pf = base + j.pausaFimMin * 60000;
          var oi2 = Math.max(ti, pi), of2 = Math.min(tf, pf);
          if (of2 > oi2) min -= (of2 - oi2) / 60000;
        }
        var fora = false;
        // 2. trabalhou fora do turno: vale o tempo real do dia, limitado ao turno
        if (min <= 0) {
          fora = true;
          min = Math.min((segFim - segIni) / 60000, teto * 60);
        }
        var horas = arred(Math.min(Math.max(0, min) / 60, teto));
        if (horas > 0) {
          out.push({dia: dia, inicioIso: new Date(segIni).toISOString(), fimIso: new Date(segFim).toISOString(),
            horas: horas, teto: teto, foraDoTurno: fora});
        }
      }
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
      guarda++;
    }
    return out;
  }

  // Soma das horas úteis do período. É o valor que vai para `horasTrabalhadas`.
  function horasUteis(inicioIso, fimIso, cfg, turno) {
    return arred(diasDoPeriodo(inicioIso, fimIso, cfg, turno).reduce(function(s, d) { return s + d.horas; }, 0));
  }

  /* O período atravessa mais de um dia civil? Quem fecha turno/OP num período
     assim tem que gravar UM REGISTRO POR DIA -- é a regra que o usuário
     definiu em 24/10: "cada produção pertence ao dia que está sendo
     produzida". */
  function atravessaDias(inicioIso, fimIso, cfg, turno) {
    return diasDoPeriodo(inicioIso, fimIso, cfg, turno).length > 1;
  }

  /* Aviso para a tela: o que há de implausível neste período.
     Devolve {ok, dias, horas, avisos:[...]}. Não decide nada -- a tela escolhe
     se barra ou só mostra. */
  function conferir(inicioIso, fimIso, cfg, turno, tolMin) {
    var dias = diasDoPeriodo(inicioIso, fimIso, cfg, turno);
    var tol = (n(tolMin) || 0) / 60;
    var avisos = [];
    if (!dias.length) {
      avisos.push('O período informado não tem duração válida.');
      return {ok: false, dias: dias, horas: 0, avisos: avisos};
    }
    if (dias.length > 1) {
      avisos.push('Este período atravessa ' + dias.length + ' dias (' + dias[0].dia + ' a ' + dias[dias.length - 1].dia +
        '). A produção de cada dia pertence ao próprio dia — grave um registro por dia.');
    }
    dias.forEach(function(d) {
      if (d.horas > d.teto + tol + 0.001) {
        avisos.push(d.dia + ': ' + d.horas + 'h, acima das ' + d.teto + 'h que o turno oferece.');
      }
      if (d.foraDoTurno) {
        avisos.push(d.dia + ': o período não encosta no horário do turno (' + d.horas + 'h contadas fora do turno). Confirme se houve trabalho nesse dia.');
      }
    });
    return {ok: !avisos.length, dias: dias, horas: horasUteis(inicioIso, fimIso, cfg, turno), avisos: avisos};
  }

  return {
    PADRAO: PADRAO,
    janelaDoDia: janelaDoDia, tetoDoDia: tetoDoDia, diasDoPeriodo: diasDoPeriodo,
    horasUteis: horasUteis, atravessaDias: atravessaDias, conferir: conferir
  };
});
