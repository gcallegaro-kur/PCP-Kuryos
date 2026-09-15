/* Histórico de apontamentos: período (início/término) e visão condensada por OP.

   Pedido do usuário (2026-09-15):
   1. A coluna Hora do Histórico mostra data e hora de INÍCIO e de TÉRMINO do
      apontamento. Registro sem término gravado (apontamento hora a hora antigo)
      mostra "?" no término -- é assim que se reconhece um registro antigo.
      Nunca inventar o término a partir da hora cheia.
   2. Editar início e término no modal.
   3. Condensar os vários apontamentos de uma mesma OP numa linha só, para
      conferir se os apontamentos estão certos.

   De onde vem o período:
   - Início: `periodoInicio` (ISO) quando existe; senão `data` + `hora` do
     registro (o apontamento antigo só guardava a hora de início).
   - Término: só `periodoFim`, e só junto de um início válido -- é o mesmo
     critério de `fmtRegistroRange` (shared/utils.js).

   A condensação agrupa por lote + setor (linha/rotulagem/posto): envase e
   rotulagem do mesmo lote são etapas diferentes e somar as duas contaria a
   mesma unidade duas vezes. Registro sem lote não tem o que condensar e fica
   sozinho. Nada aqui grava no banco: é só leitura para conferência. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HistoricoApontamentos = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var HORA_MS = 3600000;
  // Um único apontamento com mais horas que isso cobre mais de um turno
  // inteiro sem checkpoint -- quase sempre lançamento errado (ex.: retroativo
  // com 24h por dia).
  var LIMITE_PERIODO_LONGO_H = 12;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dataValida(d) { return d instanceof Date && !isNaN(d.getTime()); }
  function numero(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function parseIso(s) {
    if (!s) return null;
    var d = new Date(s);
    return dataValida(d) ? d : null;
  }

  // "14:00", "14_00", "9:30" -> "14:00" / "09:30"; qualquer outra coisa -> null
  function horaNormalizada(hora) {
    var m = /^(\d{1,2})[:_](\d{2})$/.exec(String(hora == null ? '' : hora).trim());
    if (!m) return null;
    var h = parseInt(m[1], 10), min = parseInt(m[2], 10);
    if (h > 23 || min > 59) return null;
    return pad(h) + ':' + pad(min);
  }

  function dataIsoValida(data) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(data || ''));
  }

  // Início do apontamento. `soData` = só se sabe o dia (hora ausente/ilegível).
  function inicioDoRegistro(r) {
    if (!r) return null;
    var p = parseIso(r.periodoInicio);
    if (p) return {data: p, soData: false};
    if (!dataIsoValida(r.data)) return null;
    var hora = horaNormalizada(r.hora);
    var d = new Date(r.data + 'T' + (hora || '00:00') + ':00');
    return dataValida(d) ? {data: d, soData: !hora} : null;
  }

  function terminoDoRegistro(r) {
    if (!r || !parseIso(r.periodoInicio)) return null;
    return parseIso(r.periodoFim);
  }

  function fmtData(d) {
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(-2);
  }
  function fmtDataHora(d) {
    if (!dataValida(d)) return '?';
    return fmtData(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // Textos da coluna. Término ausente é "?", nunca hora cheia + 1.
  function periodoTexto(r) {
    var ini = inicioDoRegistro(r);
    var fim = terminoDoRegistro(r);
    return {
      inicio: !ini ? '?' : (ini.soData ? fmtData(ini.data) + ' ?' : fmtDataHora(ini.data)),
      termino: fim ? fmtDataHora(fim) : '?',
      semTermino: !fim
    };
  }

  // Chave numérica para ordenar por quando a produção começou. Legado (hora
  // local) e ISO (UTC) só são comparáveis assim -- como texto não são.
  function inicioMs(r) {
    var ini = inicioDoRegistro(r);
    return ini ? ini.data.getTime() : 0;
  }

  function duracaoHoras(r) {
    var ini = inicioDoRegistro(r), fim = terminoDoRegistro(r);
    if (!ini || !fim) return null;
    return (fim.getTime() - ini.data.getTime()) / HORA_MS;
  }

  function arred2(v) { return Math.round(v * 100) / 100; }

  // Horas trabalhadas de UM apontamento: as úteis gravadas (pausa já
  // descontada) ou, sem elas, a duração do período. Sem término é
  // desconhecido (null) -- não vira 1h presumida.
  function horasDoRegistro(r) {
    var dur = duracaoHoras(r);
    if (dur == null) return null;
    var uteis = numero(r.horasTrabalhadas);
    return uteis > 0 ? uteis : Math.max(0, dur);
  }

  // horasTrabalhadas depois de editar início/término. Quem gravou o período
  // (form.html) já descontou a pausa do turno; a edição preserva esse mesmo
  // desconto em vez de trocá-lo pela duração bruta do calendário.
  function horasTrabalhadasRecalculadas(original, novoInicioIso, novoTerminoIso) {
    var ini = parseIso(novoInicioIso), fim = parseIso(novoTerminoIso);
    if (!ini || !fim || fim <= ini) return null;
    var durNova = (fim.getTime() - ini.getTime()) / HORA_MS;
    var durOrig = duracaoHoras(original);
    var horasOrig = numero(original && original.horasTrabalhadas);
    var desconto = (durOrig != null && horasOrig > 0) ? Math.max(0, durOrig - horasOrig) : 0;
    return arred2(Math.max(0, durNova - desconto));
  }

  // <input type="datetime-local"> trabalha em hora local, sem fuso.
  function paraInputLocal(d) {
    if (!dataValida(d)) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function valoresIniciaisEdicao(r) {
    var ini = inicioDoRegistro(r), fim = terminoDoRegistro(r);
    return {
      inicio: ini && !ini.soData ? paraInputLocal(ini.data) : '',
      termino: fim ? paraInputLocal(fim) : '',
      temTermino: !!fim
    };
  }

  /* O que gravar ao salvar a edição de início/término.

     - Nada mudou nos dois campos: não toca em data/hora/período (editar só a
       quantidade não pode reescrever o horário de ninguém).
     - Sem término (registro antigo): volta a ser data + hora do início, como o
       antigo par Data/Hora do modal.
     - Com término: grava periodoInicio/periodoFim e recalcula horasTrabalhadas
       preservando a pausa descontada. O registro fica no dia em que está
       (`registros/{dia}` decide em que dia a produção conta) enquanto esse dia
       estiver dentro do novo período; se sair, vai para o dia do início.
       Checkpoint gravado no dia do fechamento, 22h→06h, continua onde está.
     - Registro que já tinha término não pode perdê-lo: o período sumiria. */
  function planoEdicaoPeriodo(original, dataRegistro, inicioLocal, terminoLocal) {
    var antes = valoresIniciaisEdicao(original);
    inicioLocal = inicioLocal || '';
    terminoLocal = terminoLocal || '';
    if (inicioLocal === antes.inicio && terminoLocal === antes.termino) return {mudou: false, data: dataRegistro};

    if (!inicioLocal) return {erro: 'Informe o início.'};
    var ini = new Date(inicioLocal);
    if (!dataValida(ini)) return {erro: 'Início inválido.'};
    if (antes.temTermino && !terminoLocal) {
      return {erro: 'Este registro tem término gravado. Informe o término: sem ele o período do apontamento se perde.'};
    }
    var diaIni = inicioLocal.slice(0, 10), hora = inicioLocal.slice(11, 16);
    if (!terminoLocal) return {mudou: true, data: diaIni, hora: hora, periodo: null};

    var fim = new Date(terminoLocal);
    if (!dataValida(fim)) return {erro: 'Término inválido.'};
    if (fim <= ini) return {erro: 'O término precisa ser depois do início.'};
    var diaFim = terminoLocal.slice(0, 10);
    var dia = (dataIsoValida(dataRegistro) && dataRegistro >= diaIni && dataRegistro <= diaFim) ? dataRegistro : diaIni;
    var iniIso = ini.toISOString(), fimIso = fim.toISOString();
    return {mudou: true, data: dia, hora: hora, periodo: {
      periodoInicio: iniIso, periodoFim: fimIso,
      horasTrabalhadas: horasTrabalhadasRecalculadas(original, iniIso, fimIso)
    }};
  }

  var ROTULO_SETOR = {linha: 'Envase', rotulagem: 'Rotulagem', posto: 'Posto'};

  function unicos(lista) {
    var vistos = {}, out = [];
    lista.forEach(function(v) { if (v && !vistos[v]) { vistos[v] = 1; out.push(v); } });
    return out;
  }

  /* Agrupa os registros carregados.
     opts.setorDe(r)          -> 'linha' | 'rotulagem' | 'posto'
     opts.totalOp(lote, setor) -> total da OP no sistema (ops/{lote}) ou null */
  function condensarPorOp(registros, opts) {
    opts = opts || {};
    var setorDe = opts.setorDe || function() { return 'linha'; };
    var totalOp = opts.totalOp || function() { return null; };
    var grupos = {}, ordem = [];

    (registros || []).forEach(function(r, i) {
      var lote = String(r.lote || '').trim();
      var setor = setorDe(r) || 'linha';
      var chave = lote ? lote + '|' + setor : '__avulso__' + (r._key || i);
      if (!grupos[chave]) {
        grupos[chave] = {chave: chave, lote: lote, setor: setor, avulso: !lote, registros: []};
        ordem.push(chave);
      }
      grupos[chave].registros.push(r);
    });

    return ordem.map(function(chave) { return resumirGrupo(grupos[chave], totalOp); });
  }

  function resumirGrupo(g, totalOp) {
    var regs = g.registros.slice().sort(function(a, b) { return inicioMs(a) - inicioMs(b); });
    var inicio = null, termino = null, semTermino = 0, quantidade = 0, horas = 0, regsComHoras = 0, qtdComHoras = 0;
    var ultimoInformado = null, fechamento = null;

    regs.forEach(function(r) {
      var ini = inicioDoRegistro(r), fim = terminoDoRegistro(r);
      if (ini && (!inicio || ini.data < inicio)) inicio = ini.data;
      if (fim && (!termino || fim > termino)) termino = fim;
      if (!fim) semTermino++;
      quantidade += numero(r.quantidade);
      // Ritmo só com a quantidade dos apontamentos cujas horas se conhecem:
      // dividir o total pelas horas conhecidas inflaria o un/h.
      var h = horasDoRegistro(r);
      if (h != null && h > 0) { horas += h; qtdComHoras += numero(r.quantidade); regsComHoras++; }
      if ((r.tipo === 'apontamento_total' || r.tipo === 'fechamento_op') && numero(r.qtdTotalOP) > 0) {
        var t = (fim || (ini && ini.data) || new Date(0)).getTime();
        if (!ultimoInformado || t >= ultimoInformado.quando) ultimoInformado = {quando: t, registro: r};
      }
      if (r.tipo === 'fechamento_op') fechamento = r;
    });

    var alertas = [];

    // Soma MAIOR que a referência é erro certo: algum apontamento sobra.
    // Soma MENOR pode ser só apontamento anterior ao período carregado
    // (medido na base: OP de 1.248 un. com os primeiros registros antes do
    // "De"), então fica como aviso e diz isso.
    function nivelDiferenca(soma, referencia) { return soma > referencia ? 'erro' : 'aviso'; }
    var DICA_PERIODO = ' (ou há apontamento fora do período carregado)';

    // 1. Acumulado informado no checkpoint/fechamento contra a soma dos
    //    incrementos até ele (inclusive).
    var informado = null;
    if (ultimoInformado) {
      var alvo = ultimoInformado.registro, somaAte = 0;
      for (var i = 0; i < regs.length; i++) {
        somaAte += numero(regs[i].quantidade);
        if (regs[i] === alvo) break;
      }
      informado = Math.round(numero(alvo.qtdTotalOP));
      somaAte = Math.round(somaAte);
      if (somaAte !== informado) {
        var nivelAc = nivelDiferenca(somaAte, informado);
        alertas.push({tipo: 'ACUMULADO', nivel: nivelAc, informado: informado, soma: somaAte,
          texto: 'Acumulado informado ' + informado + ', soma dos apontamentos até ali ' + somaAte +
            (nivelAc === 'aviso' ? DICA_PERIODO : '')});
      }
    }

    // 2. Soma carregada contra o total da OP no sistema. Não repete o alerta
    //    anterior quando os dois números são os mesmos.
    var total = g.lote ? totalOp(g.lote, g.setor) : null;
    var somaTotal = Math.round(quantidade);
    if (total != null && isFinite(total) && Math.round(total) !== somaTotal) {
      var repetido = alertas.some(function(x) { return x.tipo === 'ACUMULADO' && x.informado === Math.round(total) && x.soma === somaTotal; });
      if (!repetido) {
        var nivelTot = nivelDiferenca(somaTotal, Math.round(total));
        alertas.push({tipo: 'TOTAL_OP', nivel: nivelTot, totalOp: Math.round(total), soma: somaTotal,
          texto: 'Total da OP no sistema ' + Math.round(total) + ', soma carregada ' + somaTotal +
            (nivelTot === 'aviso' ? DICA_PERIODO : '')});
      }
    }

    // 3. Períodos sobrepostos na mesma linha/posto. Linhas diferentes podem
    //    rodar o mesmo lote em paralelo, então só compara dentro da mesma.
    //    Registro antigo sem término só colide quando começa no mesmo instante.
    var sobrepostos = 0;
    for (var a = 0; a < regs.length; a++) {
      for (var b = a + 1; b < regs.length; b++) {
        var ra = regs[a], rb = regs[b];
        if (String(ra.linha || '') !== String(rb.linha || '')) continue;
        var ia = inicioDoRegistro(ra), ib = inicioDoRegistro(rb);
        if (!ia || !ib) continue;
        var fa = terminoDoRegistro(ra), fb = terminoDoRegistro(rb);
        var colide = (fa && fb)
          ? (ia.data < fb && ib.data < fa)
          : (!ia.soData && !ib.soData && ia.data.getTime() === ib.data.getTime());
        if (colide) sobrepostos++;
      }
    }
    if (sobrepostos) {
      alertas.push({tipo: 'SOBREPOSICAO', nivel: 'erro', quantidade: sobrepostos,
        texto: sobrepostos + (sobrepostos === 1 ? ' par de apontamentos sobreposto' : ' pares de apontamentos sobrepostos')});
    }

    // 4. Apontamento único cobrindo mais de um turno.
    var longos = regs.filter(function(r) { var h = duracaoHoras(r); return h != null && h > LIMITE_PERIODO_LONGO_H; });
    if (longos.length) {
      var maior = Math.max.apply(null, longos.map(duracaoHoras));
      alertas.push({tipo: 'PERIODO_LONGO', nivel: 'aviso', quantidade: longos.length,
        texto: longos.length + (longos.length === 1 ? ' apontamento' : ' apontamentos') + ' com mais de ' +
          LIMITE_PERIODO_LONGO_H + 'h seguidas (maior: ' + String(arred2(maior)).replace('.', ',') + 'h)'});
    }

    // 5. Informativo: registros antigos, sem término.
    if (semTermino) {
      alertas.push({tipo: 'SEM_TERMINO', nivel: 'info', quantidade: semTermino,
        texto: semTermino + (semTermino === 1 ? ' registro sem término' : ' registros sem término')});
    }

    return {
      chave: g.chave, lote: g.lote, setor: g.setor, setorRotulo: ROTULO_SETOR[g.setor] || g.setor,
      avulso: g.avulso, registros: regs,
      produto: unicos(regs.map(function(r) { return r.produto; })).join(' / '),
      linhas: unicos(regs.map(function(r) { return r.linha; })),
      pedidos: unicos(regs.map(function(r) { return r.pedidoId; })),
      inicio: inicio, termino: termino, semTermino: semTermino,
      quantidade: quantidade,
      horasTrabalhadas: regsComHoras ? arred2(horas) : null,
      ritmo: horas > 0 ? qtdComHoras / horas : null,
      registrosSemHoras: regs.length - regsComHoras,
      qtdSemHoras: quantidade - qtdComHoras,
      totalOp: total != null && isFinite(total) ? total : null,
      ultimoTotalInformado: ultimoInformado ? numero(ultimoInformado.registro.qtdTotalOP) : null,
      qtdEsperadaOP: fechamento ? numero(fechamento.qtdEsperadaOP) || null : null,
      fechado: !!fechamento,
      alertas: alertas,
      temErro: alertas.some(function(x) { return x.nivel === 'erro'; })
    };
  }

  return {
    inicioDoRegistro: inicioDoRegistro, terminoDoRegistro: terminoDoRegistro, periodoTexto: periodoTexto,
    inicioMs: inicioMs, duracaoHoras: duracaoHoras, horasDoRegistro: horasDoRegistro, fmtDataHora: fmtDataHora, horaNormalizada: horaNormalizada,
    horasTrabalhadasRecalculadas: horasTrabalhadasRecalculadas, condensarPorOp: condensarPorOp,
    paraInputLocal: paraInputLocal, valoresIniciaisEdicao: valoresIniciaisEdicao, planoEdicaoPeriodo: planoEdicaoPeriodo,
    LIMITE_PERIODO_LONGO_H: LIMITE_PERIODO_LONGO_H
  };
});
