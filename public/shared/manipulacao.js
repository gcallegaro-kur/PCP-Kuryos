/* Fase de granel do lote (Ordem de Manipulação).

   Decisões do usuário (2026-09-17):
   - "o número de lote da OP é o número de lote da ordem de fabricação, são o
     mesmo lote" -> a OM NÃO é entidade separada com numeração própria: é a
     FASE DE GRANEL do mesmo lote, em ops/{lote}/manipulacao. Sem numeração
     nova, sem vínculo a manter, a rastreabilidade continua sendo o lote.
   - "a pesagem é um operador, a conferência e manipulação é outro
     operador/manipulador" -> dupla checagem obrigatória: quem confere não
     pode ser quem pesou, e sem conferência não se manipula.
   - "sempre marcando os tempos e perdas de cada processo" -> cada etapa
     guarda início, fim e perdas próprias.
   - "envase travado até liberação do material" -> `podeEnvasar` é o portão
     que o apontamento usa para não alocar OP com granel não liberado.
   - Assépsia entra ANTES da OP entrar em produção, não durante: ela não é
     etapa daqui (fica no setup de linha, CK-5/CK-3).

   A baixa de estoque das matérias-primas acontece na PESAGEM, que é quando o
   material sai fisicamente — e por isso o apontamento de envase não pode
   baixar a fórmula de novo (só o BOM de embalagem). */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Manipulacao = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var ESTADOS = {
    AGUARDANDO_PESAGEM: {rotulo: 'Aguardando pesagem', ordem: 1},
    PESADO: {rotulo: 'Pesado — aguardando conferência', ordem: 2},
    CONFERIDO: {rotulo: 'Conferido — liberado para manipular', ordem: 3},
    EM_MANIPULACAO: {rotulo: 'Em manipulação', ordem: 4},
    AGUARDANDO_CQ: {rotulo: 'Granel aguardando análise', ordem: 5},
    LIBERADO: {rotulo: 'Granel liberado', ordem: 6},
    REPROVADO: {rotulo: 'Granel reprovado', ordem: 7}
  };
  // Diferença aceita entre previsto e pesado antes de exigir justificativa.
  var TOLERANCIA_PESAGEM_PCT = 2;

  function n(v) { var x = Number(v); return isFinite(x) ? x : null; }
  function num(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function arred(v, casas) { var f = Math.pow(10, casas == null ? 3 : casas); return Math.round(Number(v) * f) / f; }
  function texto(v) { return String(v == null ? '' : v).trim(); }
  function minutos(inicio, fim) {
    if (!inicio || !fim) return null;
    var a = new Date(inicio).getTime(), b = new Date(fim).getTime();
    return (isNaN(a) || isNaN(b) || b < a) ? null : Math.round((b - a) / 60000);
  }

  function fase(op) { return (op && op.manipulacao) || null; }
  function estado(op) {
    var f = fase(op);
    return f && ESTADOS[f.status] ? f.status : (f ? 'AGUARDANDO_PESAGEM' : null);
  }
  function rotulo(st) { return (ESTADOS[st] || {}).rotulo || '—'; }

  /* PORTÃO DO ENVASE. OP sem fase de granel continua como sempre (a fábrica
     não pode parar por causa do histórico); OP com fase só libera envase
     depois da Qualidade liberar o granel. `exigirSempre` liga a trava para
     todas as OPs quando a operação estiver madura. */
  function podeEnvasar(op, opcoes) {
    var st = estado(op);
    var exigir = !!(opcoes && opcoes.exigirSempre);
    if (!st) {
      return exigir
        ? {ok: false, motivo: 'Esta OP não tem a fase de granel registrada e a exigência está ligada.', estado: null}
        : {ok: true, motivo: null, estado: null};
    }
    if (st === 'LIBERADO') return {ok: true, motivo: null, estado: st};
    if (st === 'REPROVADO') return {ok: false, motivo: 'Granel reprovado pela Qualidade.', estado: st};
    return {ok: false, motivo: 'Granel ainda não liberado pela Qualidade (' + rotulo(st).toLowerCase() + ').', estado: st};
  }

  // Linhas da pesagem: previsto (fórmula) x pesado, com desvio e sobra/perda.
  function linhasPesagem(previstos, pesagem) {
    var itens = (pesagem && pesagem.itens) || {};
    return Object.keys(previstos || {}).map(function(k) {
      var p = previstos[k] || {}, r = itens[k] || {};
      var previsto = num(p.previsto), pesado = n(r.pesado);
      var desvioPct = (previsto > 0 && pesado != null) ? arred((pesado - previsto) / previsto * 100, 2) : null;
      return {
        itemKey: k, mpCodigo: p.mpCodigo || k, mpNome: p.mpNome || '', unidade: p.unidade || 'kg',
        previsto: previsto, pesado: pesado, loteMaterial: texto(r.loteMaterial) || null,
        perda: num(r.perda), justificativa: texto(r.justificativa) || null,
        desvioPct: desvioPct,
        foraTolerancia: desvioPct != null && Math.abs(desvioPct) > TOLERANCIA_PESAGEM_PCT,
        pendente: pesado == null || pesado <= 0
      };
    }).sort(function(a, b) { return a.mpNome.localeCompare(b.mpNome); });
  }

  function validarPesagem(previstos, pesagem) {
    var linhas = linhasPesagem(previstos, pesagem), erros = [], avisos = [];
    if (!linhas.length) erros.push('A fórmula deste produto não foi encontrada — sem ela não há o que pesar.');
    var pendentes = linhas.filter(function(l) { return l.pendente; });
    if (pendentes.length) erros.push(pendentes.length + ' matéria(s)-prima(s) sem peso registrado.');
    linhas.filter(function(l) { return !l.pendente && !l.loteMaterial; }).forEach(function(l) {
      erros.push('Informe o lote usado de ' + l.mpCodigo + '.');
    });
    linhas.filter(function(l) { return l.foraTolerancia && !l.justificativa; }).forEach(function(l) {
      erros.push(l.mpCodigo + ' está ' + l.desvioPct + '% fora do previsto — justifique.');
    });
    linhas.filter(function(l) { return l.foraTolerancia && l.justificativa; }).forEach(function(l) {
      avisos.push(l.mpCodigo + ': ' + l.desvioPct + '% fora do previsto (' + l.justificativa + ').');
    });
    return {ok: !erros.length, erros: erros, avisos: avisos, linhas: linhas};
  }

  /* Conferência: OUTRA pessoa. É a regra que o usuário pediu, e é o que
     transforma a pesagem em dupla checagem de verdade. */
  function validarConferencia(previstos, fase_, conferente) {
    var f = fase_ || {}, erros = [];
    var pesador = texto((f.pesagem || {}).por);
    var quem = texto(conferente);
    if (!quem) erros.push('Identifique quem está conferindo.');
    if (quem && pesador && quem.toLowerCase() === pesador.toLowerCase()) {
      erros.push('Quem confere não pode ser quem pesou (' + pesador + ').');
    }
    var linhas = linhasPesagem(previstos, f.pesagem);
    var conf = (f.conferencia || {}).itens || {};
    var naoConferidos = linhas.filter(function(l) { return !conf[l.itemKey] || conf[l.itemKey].ok == null; });
    if (naoConferidos.length) erros.push(naoConferidos.length + ' item(ns) sem conferência.');
    var divergentes = linhas.filter(function(l) { return conf[l.itemKey] && conf[l.itemKey].ok === false; });
    divergentes.forEach(function(l) {
      if (!texto((conf[l.itemKey] || {}).obs)) erros.push('Divergência em ' + l.mpCodigo + ' precisa de descrição.');
    });
    return {
      ok: !erros.length && !divergentes.length, erros: erros,
      divergencias: divergentes.map(function(l) { return {itemKey: l.itemKey, mpCodigo: l.mpCodigo, obs: (conf[l.itemKey] || {}).obs || ''}; }),
      bloqueiaManipulacao: divergentes.length > 0
    };
  }

  /* Fecho da manipulação: rendimento obtido x massa teórica (soma do que foi
     pesado). A perda de processo é a diferença, e é o número que hoje não
     existe em lugar nenhum. */
  function resumoManipulacao(previstos, fase_) {
    var f = fase_ || {}, man = f.manipulacao || {}, pes = f.pesagem || {};
    var linhas = linhasPesagem(previstos, pes);
    var pesadoTotal = arred(linhas.reduce(function(s, l) { return s + num(l.pesado); }, 0));
    var previstoTotal = arred(linhas.reduce(function(s, l) { return s + num(l.previsto); }, 0));
    var perdasPesagem = arred(linhas.reduce(function(s, l) { return s + num(l.perda); }, 0));
    var perdasManipulacao = arred(Object.keys(man.perdas || {}).reduce(function(s, k) { return s + num(man.perdas[k]); }, 0));
    var rendimento = n(man.rendimento);
    var perdaProcesso = rendimento != null && pesadoTotal > 0 ? arred(pesadoTotal - rendimento) : null;
    return {
      previstoTotal: previstoTotal, pesadoTotal: pesadoTotal, rendimento: rendimento,
      perdasPesagem: perdasPesagem, perdasManipulacao: perdasManipulacao,
      perdaProcesso: perdaProcesso,
      perdaProcessoPct: perdaProcesso != null && pesadoTotal > 0 ? arred(perdaProcesso / pesadoTotal * 100, 2) : null,
      rendimentoPct: rendimento != null && pesadoTotal > 0 ? arred(rendimento / pesadoTotal * 100, 2) : null,
      minutosPesagem: minutos(pes.inicio, pes.fim),
      minutosManipulacao: minutos(man.inicio, man.fim),
      minutosTotal: minutos(pes.inicio, man.fim || pes.fim)
    };
  }

  function validarFechamentoManipulacao(previstos, fase_) {
    var f = fase_ || {}, man = f.manipulacao || {}, erros = [];
    if (!man.inicio) erros.push('A manipulação não foi iniciada.');
    if (n(man.rendimento) == null || n(man.rendimento) <= 0) erros.push('Informe o rendimento obtido do granel.');
    var r = resumoManipulacao(previstos, f);
    var avisos = [];
    if (r.rendimento != null && r.pesadoTotal > 0 && r.rendimento > r.pesadoTotal) {
      erros.push('O rendimento (' + r.rendimento + ') é maior que o total pesado (' + r.pesadoTotal + ').');
    }
    if (r.perdaProcessoPct != null && r.perdaProcessoPct > 5) {
      avisos.push('Perda de processo de ' + r.perdaProcessoPct + '% — acima de 5%.');
    }
    return {ok: !erros.length, erros: erros, avisos: avisos, resumo: r};
  }

  /* Transições permitidas. Cada uma devolve o que gravar em
     ops/{lote}/manipulacao (caminhos relativos à fase). */
  function transicao(acao, contexto) {
    var c = contexto || {}, agora = c.agora || new Date().toISOString(), quem = texto(c.quem) || null;
    if (acao === 'INICIAR_PESAGEM') {
      return {status: 'AGUARDANDO_PESAGEM', 'pesagem/inicio': agora, 'pesagem/por': quem};
    }
    if (acao === 'FECHAR_PESAGEM') {
      return {status: 'PESADO', 'pesagem/fim': agora, 'pesagem/por': quem, 'pesagem/baixaAplicada': true};
    }
    if (acao === 'CONFERIR') {
      return {status: 'CONFERIDO', 'conferencia/por': quem, 'conferencia/em': agora};
    }
    if (acao === 'INICIAR_MANIPULACAO') {
      return {status: 'EM_MANIPULACAO', 'manipulacao/inicio': agora, 'manipulacao/por': quem};
    }
    if (acao === 'FECHAR_MANIPULACAO') {
      return {status: 'AGUARDANDO_CQ', 'manipulacao/fim': agora, 'manipulacao/fechadoPor': quem};
    }
    if (acao === 'LIBERAR') {
      return {status: 'LIBERADO', 'analise/decisao': 'LIBERADO', 'analise/por': quem, 'analise/em': agora};
    }
    if (acao === 'REPROVAR') {
      return {status: 'REPROVADO', 'analise/decisao': 'REPROVADO', 'analise/por': quem, 'analise/em': agora};
    }
    return null;
  }

  // O que cada estado permite fazer agora (a tela usa para habilitar botões).
  function acoesDisponiveis(op) {
    var st = estado(op);
    if (!st) return ['INICIAR_PESAGEM'];
    if (st === 'AGUARDANDO_PESAGEM') return ['FECHAR_PESAGEM'];
    if (st === 'PESADO') return ['CONFERIR'];
    if (st === 'CONFERIDO') return ['INICIAR_MANIPULACAO'];
    if (st === 'EM_MANIPULACAO') return ['FECHAR_MANIPULACAO'];
    if (st === 'AGUARDANDO_CQ') return ['LIBERAR', 'REPROVAR'];
    return [];
  }

  return {
    ESTADOS: ESTADOS, TOLERANCIA_PESAGEM_PCT: TOLERANCIA_PESAGEM_PCT,
    fase: fase, estado: estado, rotulo: rotulo, podeEnvasar: podeEnvasar,
    linhasPesagem: linhasPesagem, validarPesagem: validarPesagem,
    validarConferencia: validarConferencia, resumoManipulacao: resumoManipulacao,
    validarFechamentoManipulacao: validarFechamentoManipulacao,
    transicao: transicao, acoesDisponiveis: acoesDisponiveis, minutos: minutos
  };
});
