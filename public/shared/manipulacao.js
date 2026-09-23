/* Fase de granel (bulk, na tela desde 23/09) do lote (Ordem de Manipulação).

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
    // "Vamos chamar de bulk ao invés de granel" (usuário, 23/09). Só o texto
    // da tela muda; os nomes dos estados e dos nós no banco ficam.
    AGUARDANDO_CQ: {rotulo: 'Bulk aguardando análise', ordem: 5},
    LIBERADO: {rotulo: 'Bulk liberado', ordem: 6},
    REPROVADO: {rotulo: 'Bulk reprovado', ordem: 7}
  };
  // Diferença aceita entre previsto e pesado antes de exigir justificativa.
  var TOLERANCIA_PESAGEM_PCT = 2;
  // Pedido do usuário (2026-09-17): a pesagem só fecha com foto de prova --
  // "usado como backlog e auditoria" -- e a foto é POR MATÉRIA-PRIMA ("eu
  // vinculo a foto à pesagem da MP em questão"). Cada foto prova que aquele
  // peso daquela MP foi o que a balança mostrou.
  // Fica em pesagem/fotosItens/{itemKey}/{id}, fora de pesagem/itens: o
  // fechamento regrava pesagem/itens inteiro e apagaria as fotos.
  var EXIGE_FOTO_PESAGEM = true;
  function fotosDoItem(pesagem, itemKey) {
    var no = ((pesagem && pesagem.fotosItens) || {})[itemKey] || {};
    return Object.keys(no).map(function(id) { return Object.assign({id: id}, no[id]); }).filter(function(a) { return a && a.caminho; });
  }

  /* PESAGEM EM PARCELAS (pedido do usuário em 18/09: "fazer algumas pesagens
     do mesmo item, ir somando várias pesagens, até atingir o total demandado
     na OP"). Cada ida à balança é uma parcela com peso, lote e foto próprios
     -- a segunda pesagem muitas vezes sai de outra embalagem, de outro lote.
     O total da MP é a SOMA das parcelas; o operador nunca soma de cabeça.
     Fica em pesagem/parcelas/{itemKey}/{id}, gravada na hora (sobrevive a
     recarregar a página e a trocar de aparelho). Parcela errada não é
     apagada: é CANCELADA com motivo e continua no dossiê do lote, riscada. */
  function parcelasDoItem(pesagem, itemKey, incluirCanceladas) {
    var no = ((pesagem && pesagem.parcelas) || {})[itemKey] || {};
    return Object.keys(no).map(function(id) { return Object.assign({id: id}, no[id]); })
      .filter(function(p) { return p && (incluirCanceladas || !p.canceladaEm); })
      .sort(function(a, b) { return String(a.em || '').localeCompare(String(b.em || '')) || a.id.localeCompare(b.id); });
  }
  // Todas as fotos que provam a pesagem da MP: as das parcelas e, em lote
  // pesado antes das parcelas existirem, as avulsas de fotosItens.
  function fotosDaLinha(pesagem, itemKey) {
    var parc = parcelasDoItem(pesagem, itemKey);
    if (parc.length) {
      return parc.filter(function(p) { return p.foto && p.foto.caminho; }).map(function(p, i) {
        return Object.assign({id: p.id, parcela: i + 1, peso: p.peso, loteMaterial: p.loteMaterial || null}, p.foto);
      });
    }
    return fotosDoItem(pesagem, itemKey);
  }
  function lotesUnicos(parc) {
    var vistos = [];
    parc.forEach(function(p) { var l = texto(p.loteMaterial); if (l && vistos.indexOf(l) < 0) vistos.push(l); });
    return vistos;
  }
  /* LOTES INDICADOS PELO FEFO (pedido do usuário em 18/09: "o lote tem que
     ser indicado por FEFO, vindo direto da OP, falando quanto de cada lote
     tem que ser utilizado"). O plano é calculado pela tela com
     sugerirAlocacaoFefo (utils.js) e congelado em pesagem/planoLotes/{mp}
     no início da pesagem: fica registrado o que o sistema mandou usar.
     plano = [{loteInterno, qtd, enderecos: [código], dataValidade}]. */
  function situacaoLotes(plano, parcelas) {
    var linhas = (plano || []).map(function(p) {
      return {loteInterno: texto(p.loteInterno), planejado: arred(num(p.qtd)), enderecos: p.enderecos || [],
        dataValidade: p.dataValidade || null, pesado: 0};
    });
    var fora = {}, foraOrdem = [];
    (parcelas || []).forEach(function(p) {
      var l = texto(p.loteMaterial);
      var ln = linhas.find(function(x) { return x.loteInterno === l; });
      if (ln) ln.pesado = arred(ln.pesado + num(p.peso));
      else if (l) { if (fora[l] == null) { fora[l] = 0; foraOrdem.push(l); } fora[l] = arred(fora[l] + num(p.peso)); }
    });
    linhas.forEach(function(l) { l.falta = Math.max(0, arred(l.planejado - l.pesado)); });
    return {
      linhas: linhas,
      fora: foraOrdem.map(function(k) { return {loteInterno: k, pesado: fora[k]}; }),
      // O próximo lote a usar: o primeiro do FEFO que ainda tem o que pesar.
      sugerido: linhas.find(function(l) { return l.falta > 0; }) || null
    };
  }

  // Validação de UMA ida à balança, antes de gravar. `plano` (opcional): o
  // FEFO da MP -- lote fora dele só passa com motivo.
  function validarParcela(parcela, plano) {
    var p = parcela || {}, erros = [];
    if (!(n(p.peso) > 0)) erros.push('Informe o peso que a balança mostrou.');
    if (!texto(p.loteMaterial)) erros.push('Informe o lote da embalagem usada.');
    var lotesPlano = (plano || []).map(function(x) { return texto(x.loteInterno); }).filter(Boolean);
    if (texto(p.loteMaterial) && lotesPlano.length && lotesPlano.indexOf(texto(p.loteMaterial)) < 0 && !texto(p.motivoForaFefo)) {
      erros.push('O FEFO indica ' + lotesPlano.join(', ') + '. Para usar outro lote, informe o motivo.');
    }
    if (EXIGE_FOTO_PESAGEM && !p.temFoto && !(p.foto && p.foto.caminho)) erros.push('Tire a foto da balança.');
    return {ok: !erros.length, erros: erros};
  }

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

  /* PORTÃO DO ENVASE (GAP-04 de FLUXOS_DO_SISTEMA.md).

     Regra do usuário (23/09): OP cujo produto tem FÓRMULA só envasa com o
     bulk liberado pela Qualidade; OP sem fórmula (kit, bulk do cliente) passa.
     Antes disso, a trava só pegava OP que já tinha começado a manipulação no
     sistema -- uma OP recém-emitida ia direto ao envase sem laudo.

     Corte prospectivo em PORTAO_BULK_DESDE: no dia do corte havia 13 OPs
     abertas com fórmula e sem nenhuma fase de bulk registrada (2 rodando na
     linha, 11 programadas) -- o bulk delas foi feito fora do sistema.
     Travá-las pararia a fábrica; elas seguem a regra antiga (só trava se a
     fase existir). Mesmo desenho do corte da Conferência de PA.

     Nunca trava no meio: OP que já envasou (produção de linha ou setup
     encerrado) segue. OP de retrabalho não refabrica o produto, então não
     pede bulk. `exigirSempre` continua ligando a trava para todas. */
  var PORTAO_BULK_DESDE = '2026-09-24T03:00:00.000Z'; // 24/09/2026 00:00 BRT

  // OP de retrabalho: tipoOrdem 'RETRABALHO' (shared/retrabalho-op.js). O
  // `tipo` antigo fica aceito para não depender de um só campo.
  function ehRetrabalho(op) { return !!op && (op.tipoOrdem === 'RETRABALHO' || op.tipo === 'RETRABALHO'); }
  function jaEnvasou(op) {
    return num(op && op.produzidoLinha) > 0 || !!(op && op.setupFim);
  }
  function exigeBulk(op, desde) {
    if (!op || ehRetrabalho(op) || !texto(op.formulaVersao)) return false;
    var emissao = new Date(op.dataEmissao || 0).getTime();
    return !isNaN(emissao) && emissao >= new Date(desde || PORTAO_BULK_DESDE).getTime();
  }

  function podeEnvasar(op, opcoes) {
    var st = estado(op);
    var exigir = !!(opcoes && opcoes.exigirSempre);
    if (ehRetrabalho(op)) return {ok: true, motivo: null, estado: st};
    if (!st) {
      if (exigir) return {ok: false, motivo: 'Esta OP não tem a fase de bulk registrada e a exigência está ligada.', estado: null};
      if (exigeBulk(op, opcoes && opcoes.desde) && !jaEnvasou(op)) {
        return {ok: false, motivo: 'Esta OP tem fórmula: o bulk precisa ser pesado e manipulado na Manipulação e liberado pela Qualidade antes do envase.', estado: null};
      }
      return {ok: true, motivo: null, estado: null};
    }
    if (st === 'LIBERADO') return {ok: true, motivo: null, estado: st};
    if (st === 'REPROVADO') return {ok: false, motivo: 'Bulk reprovado pela Qualidade.', estado: st};
    return {ok: false, motivo: 'Bulk ainda não liberado pela Qualidade (' + rotulo(st).toLowerCase() + ').', estado: st};
  }

  // Linhas da pesagem: previsto (fórmula) x pesado, com desvio e sobra/perda.
  function linhasPesagem(previstos, pesagem) {
    var itens = (pesagem && pesagem.itens) || {};
    return Object.keys(previstos || {}).map(function(k) {
      var p = previstos[k] || {}, r = itens[k] || {};
      var parc = parcelasDoItem(pesagem, k);
      var previsto = num(p.previsto);
      // Com parcelas, o pesado é a soma delas -- nunca o número digitado.
      var pesado = parc.length ? arred(parc.reduce(function(s, x) { return s + num(x.peso); }, 0)) : n(r.pesado);
      var lotes = parc.length ? lotesUnicos(parc) : (texto(r.loteMaterial) ? [texto(r.loteMaterial)] : []);
      var desvioPct = (previsto > 0 && pesado != null) ? arred((pesado - previsto) / previsto * 100, 2) : null;
      var semFoto = parc.length ? parc.filter(function(x) { return !(x.foto && x.foto.caminho); }).length : 0;
      var semLote = parc.length ? parc.filter(function(x) { return !texto(x.loteMaterial); }).length : 0;
      return {
        itemKey: k, mpCodigo: p.mpCodigo || k, mpNome: p.mpNome || '', unidade: p.unidade || 'kg',
        previsto: previsto, pesado: pesado, loteMaterial: lotes.join(', ') || null, lotes: lotes,
        perda: num(r.perda), justificativa: texto(r.justificativa) || null,
        desvioPct: desvioPct,
        fotos: parc.length ? parc.length - semFoto : fotosDoItem(pesagem, k).length,
        parcelas: parc.length, parcelasSemFoto: semFoto, parcelasSemLote: semLote,
        // Quanto ainda falta pôr na balança (0 quando completou ou passou).
        falta: pesado == null ? previsto : Math.max(0, arred(previsto - pesado)),
        excesso: pesado == null ? 0 : Math.max(0, arred(pesado - previsto)),
        foraTolerancia: desvioPct != null && Math.abs(desvioPct) > TOLERANCIA_PESAGEM_PCT,
        pendente: pesado == null || pesado <= 0,
        ordem: p.ordem == null ? null : Number(p.ordem)
      };
    }).sort(function(a, b) {
      // Ordem da fórmula quando existe (decisão do usuário em 18/09: "a ordem
      // da OP mesmo, seguindo sempre um mesmo padrão"); senão, por nome.
      if (a.ordem != null && b.ordem != null && a.ordem !== b.ordem) return a.ordem - b.ordem;
      return a.mpNome.localeCompare(b.mpNome);
    });
  }

  function validarPesagem(previstos, pesagem) {
    var linhas = linhasPesagem(previstos, pesagem), erros = [], avisos = [];
    var fotos = linhas.reduce(function(s, l) { return s + l.fotos; }, 0);
    // Sem foto: MP sem nenhuma foto, ou com alguma parcela sem a sua.
    var semFoto = linhas.filter(function(l) { return !l.pendente && (!l.fotos || l.parcelasSemFoto); });
    if (EXIGE_FOTO_PESAGEM && semFoto.length) {
      erros.push('Falta a foto da pesagem de ' + semFoto.map(function(l) { return l.mpCodigo; }).join(', ') + ' (prova de auditoria).');
    }
    if (!linhas.length) erros.push('A fórmula deste produto não foi encontrada — sem ela não há o que pesar.');
    var pendentes = linhas.filter(function(l) { return l.pendente; });
    if (pendentes.length) erros.push(pendentes.length + ' matéria(s)-prima(s) sem peso registrado.');
    linhas.filter(function(l) { return !l.pendente && (!l.loteMaterial || l.parcelasSemLote); }).forEach(function(l) {
      erros.push('Informe o lote usado de ' + l.mpCodigo + '.');
    });
    linhas.filter(function(l) { return l.foraTolerancia && !l.justificativa; }).forEach(function(l) {
      erros.push(l.mpCodigo + ' está ' + l.desvioPct + '% fora do previsto — justifique.');
    });
    linhas.filter(function(l) { return l.foraTolerancia && l.justificativa; }).forEach(function(l) {
      avisos.push(l.mpCodigo + ': ' + l.desvioPct + '% fora do previsto (' + l.justificativa + ').');
    });
    return {ok: !erros.length, erros: erros, avisos: avisos, linhas: linhas, fotos: fotos};
  }

  /* O que o fechamento grava em pesagem/itens: o total somado das parcelas
     e os lotes usados, junto com perda e justificativa digitadas. É o resumo
     que a conferência, a Qualidade e o dossiê leem sem refazer a conta. */
  function itensParaFechamento(previstos, pesagem) {
    var out = {};
    linhasPesagem(previstos, pesagem).forEach(function(l) {
      var r = ((pesagem && pesagem.itens) || {})[l.itemKey] || {};
      out[l.itemKey] = {
        pesado: l.pesado, loteMaterial: l.loteMaterial, parcelas: l.parcelas,
        perda: r.perda == null ? null : num(r.perda), justificativa: texto(r.justificativa) || null
      };
    });
    return out;
  }

  /* Baixa de estoque por (MP, lote): cada lote informado na balança sai do
     seu próprio lote no WMS, não do que o FEFO escolheria. Sem parcelas
     (lote antigo), um grupo por MP com o lote digitado. */
  function baixasPorLote(previstos, pesagem) {
    var out = [];
    linhasPesagem(previstos, pesagem).forEach(function(l) {
      var parc = parcelasDoItem(pesagem, l.itemKey);
      if (!parc.length) {
        if (l.pesado > 0) out.push({itemKey: l.itemKey, mpCodigo: l.mpCodigo, loteMaterial: l.lotes[0] || null, qtd: l.pesado});
        return;
      }
      var grupos = {}, ordem = [];
      parc.forEach(function(p) {
        var lote = texto(p.loteMaterial) || null, k = lote || '';
        if (!grupos[k]) { grupos[k] = {itemKey: l.itemKey, mpCodigo: l.mpCodigo, loteMaterial: lote, qtd: 0}; ordem.push(k); }
        grupos[k].qtd = arred(grupos[k].qtd + num(p.peso));
      });
      ordem.forEach(function(k) { if (grupos[k].qtd > 0) out.push(grupos[k]); });
    });
    return out;
  }
  // Próxima MP a pesar, na ordem da fórmula, depois de `atual` (dá a volta).
  function proximaPendente(previstos, pesagem, atual) {
    var linhas = linhasPesagem(previstos, pesagem);
    var i = linhas.findIndex(function(l) { return l.itemKey === atual; });
    for (var j = 1; j <= linhas.length; j++) {
      var l = linhas[(i + j + linhas.length) % linhas.length];
      if (l.itemKey !== atual && (l.pendente || l.falta > 0)) return l.itemKey;
    }
    return null;
  }

  /* DEVOLUÇÃO AO ENDEREÇO (como a fábrica trabalha hoje, confirmado pelo
     usuário em 18/09: "recebem embalagem inteira, vão pegando, item a item.
     Próprio operador quem guarda também"). Não há separação nem sobra a
     reconciliar: a embalagem inteira sai do endereço, vai à balança e volta.
     O que o sistema precisa é da CONFIRMAÇÃO de que voltou -- e para onde,
     quando não voltou para o mesmo lugar. Fica em pesagem/devolucoes/{mp}. */
  function devolucaoDoItem(pesagem, itemKey) {
    return ((pesagem && pesagem.devolucoes) || {})[itemKey] || null;
  }
  // MPs já pesadas que ainda não foram confirmadas como guardadas.
  function pendentesDevolucao(previstos, pesagem) {
    return linhasPesagem(previstos, pesagem)
      .filter(function(l) { return l.parcelas > 0 && !devolucaoDoItem(pesagem, l.itemKey); })
      .map(function(l) { return {itemKey: l.itemKey, mpCodigo: l.mpCodigo}; });
  }

  /* CONFERÊNCIA DE PESAGEM (usuário, 23/09): enquanto a operação não tem
     "plena confiança nos processos e maturidade", a pesagem é conferida pela
     Qualidade ou pelo P&D, com o próprio login, antes de manipular -- não
     pelo manipulador. Chave em Ajustes (config/conferenciaPesagem/ativa);
     desligada, volta a dupla checagem entre operadores. Sem ninguém da
     Qualidade/P&D, o admin libera com motivo, e o motivo fica no lote. */
  function regraConferencia(config) {
    return {exigeAutorizado: !!(config && config.ativa === true)};
  }

  /* Conferência: OUTRA pessoa. É a regra que o usuário pediu, e é o que
     transforma a pesagem em dupla checagem de verdade. `opcoes`:
     {exigeAutorizado, autorizado} -- com a Conferência de Pesagem ligada,
     só confere quem tem a permissão. */
  function validarConferencia(previstos, fase_, conferente, opcoes) {
    var f = fase_ || {}, erros = [], o = opcoes || {};
    var pesador = texto((f.pesagem || {}).por);
    var quem = texto(conferente);
    if (!quem) erros.push('Identifique quem está conferindo.');
    if (o.exigeAutorizado && !o.autorizado) {
      erros.push('A Conferência de Pesagem está ligada: quem confere é a Qualidade ou o P&D, com o próprio login.');
    }
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

  // Liberação sem conferência: só admin, só com motivo, só com a pesagem
  // fechada. Fica registrada como liberação, nunca como conferência.
  function validarLiberacaoSemConferencia(fase_, motivo, ehAdmin) {
    var f = fase_ || {}, erros = [];
    if (!ehAdmin) erros.push('Só um administrador pode liberar a manipulação sem a conferência.');
    if (f.status !== 'PESADO') erros.push('A pesagem precisa estar fechada e aguardando conferência.');
    if (!texto(motivo)) erros.push('Informe o motivo da liberação sem conferência.');
    return {ok: !erros.length, erros: erros};
  }

  function validarFechamentoManipulacao(previstos, fase_) {
    var f = fase_ || {}, man = f.manipulacao || {}, erros = [];
    if (!man.inicio) erros.push('A manipulação não foi iniciada.');
    if (n(man.rendimento) == null || n(man.rendimento) <= 0) erros.push('Informe o rendimento obtido do bulk.');
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
      // `modo` registra sob qual regra a conferência valeu: pela Qualidade/P&D
      // (chave ligada) ou entre operadores.
      return {status: 'CONFERIDO', 'conferencia/por': quem, 'conferencia/em': agora,
        'conferencia/modo': c.modo || 'OPERADOR', 'conferencia/uid': c.uid || null};
    }
    if (acao === 'LIBERAR_SEM_CONFERENCIA') {
      return {status: 'CONFERIDO', 'conferencia/por': quem, 'conferencia/em': agora,
        'conferencia/modo': 'LIBERADO_PELO_ADMIN', 'conferencia/motivoLiberacao': texto(c.motivo) || null,
        'conferencia/uid': c.uid || null};
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
    if (st === 'PESADO') return ['CONFERIR', 'LIBERAR_SEM_CONFERENCIA'];
    if (st === 'CONFERIDO') return ['INICIAR_MANIPULACAO'];
    if (st === 'EM_MANIPULACAO') return ['FECHAR_MANIPULACAO'];
    if (st === 'AGUARDANDO_CQ') return ['LIBERAR', 'REPROVAR'];
    return [];
  }

  return {
    ESTADOS: ESTADOS, TOLERANCIA_PESAGEM_PCT: TOLERANCIA_PESAGEM_PCT, EXIGE_FOTO_PESAGEM: EXIGE_FOTO_PESAGEM,
    fotosDoItem: fotosDoItem, parcelasDoItem: parcelasDoItem, fotosDaLinha: fotosDaLinha,
    validarParcela: validarParcela, itensParaFechamento: itensParaFechamento,
    baixasPorLote: baixasPorLote, proximaPendente: proximaPendente, situacaoLotes: situacaoLotes,
    devolucaoDoItem: devolucaoDoItem, pendentesDevolucao: pendentesDevolucao,
    fase: fase, estado: estado, rotulo: rotulo, podeEnvasar: podeEnvasar, exigeBulk: exigeBulk,
    PORTAO_BULK_DESDE: PORTAO_BULK_DESDE,
    linhasPesagem: linhasPesagem, validarPesagem: validarPesagem,
    validarConferencia: validarConferencia, resumoManipulacao: resumoManipulacao,
    regraConferencia: regraConferencia, validarLiberacaoSemConferencia: validarLiberacaoSemConferencia,
    validarFechamentoManipulacao: validarFechamentoManipulacao,
    transicao: transicao, acoesDisponiveis: acoesDisponiveis, minutos: minutos
  };
});
