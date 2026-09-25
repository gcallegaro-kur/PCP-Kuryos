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
    REPROVADO: {rotulo: 'Bulk reprovado', ordem: 7},
    // Correção do bulk reprovado (usuário, 25/09): o bulk turvou, a Qualidade
    // mandou adicionar insumos e o lote foi de ~500 para ~800 kg. Antes disso
    // REPROVADO era fim de linha: o lote ficava travado e a fábrica seguia
    // por fora do sistema. Agora a Qualidade abre um NOVO CICLO no mesmo lote.
    CORRECAO_ABERTA: {rotulo: 'Correção aberta — aguardando pesagem', ordem: 0}
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
  function validarParcela(parcela, plano, opcoes) {
    var p = parcela || {}, erros = [];
    var semFotoOk = !!(opcoes && opcoes.dispensaFoto);
    if (!(n(p.peso) > 0)) erros.push('Informe o peso que a balança mostrou.');
    if (!texto(p.loteMaterial)) erros.push('Informe o lote da embalagem usada.');
    var lotesPlano = (plano || []).map(function(x) { return texto(x.loteInterno); }).filter(Boolean);
    if (texto(p.loteMaterial) && lotesPlano.length && lotesPlano.indexOf(texto(p.loteMaterial)) < 0 && !texto(p.motivoForaFefo)) {
      erros.push('O FEFO indica ' + lotesPlano.join(', ') + '. Para usar outro lote, informe o motivo.');
    }
    if (EXIGE_FOTO_PESAGEM && !semFotoOk && !p.temFoto && !(p.foto && p.foto.caminho)) erros.push('Tire a foto da balança.');
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

  function validarPesagem(previstos, pesagem, opcoes) {
    var linhas = linhasPesagem(previstos, pesagem), erros = [], avisos = [];
    var semFotoOk = !!(opcoes && opcoes.dispensaFoto);
    var fotos = linhas.reduce(function(s, l) { return s + l.fotos; }, 0);
    // Sem foto: MP sem nenhuma foto, ou com alguma parcela sem a sua.
    var semFoto = linhas.filter(function(l) { return !l.pendente && (!l.fotos || l.parcelasSemFoto); });
    if (EXIGE_FOTO_PESAGEM && !semFotoOk && semFoto.length) {
      erros.push('Falta a foto da pesagem de ' + semFoto.map(function(l) { return l.mpCodigo; }).join(', ') + ' (prova de auditoria).');
    }
    if (!linhas.length) erros.push(opcoes && opcoes.correcao
      ? 'A correção não tem matérias-primas a pesar.'
      : 'A fórmula deste produto não foi encontrada — sem ela não há o que pesar.');
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
    // Perda por matéria-prima (25/09): pesada e não foi para o tacho. Entra
    // nas perdas declaradas; a perda de processo (entrada − rendimento) já a
    // contém, porque o pesado conta como entrada.
    var perdasMp = arred(Object.keys(man.perdasMp || {}).reduce(function(s, k) { return s + num(man.perdasMp[k]); }, 0));
    var perdasManipulacao = arred(Object.keys(man.perdas || {}).reduce(function(s, k) { return s + num(man.perdas[k]); }, 0) + perdasMp);
    var rendimento = n(man.rendimento);
    // Num ciclo de correção o tanque não começa vazio: entra o bulk do ciclo
    // anterior. Sem somar essa massa, 800 kg obtidos com 300 kg de aditivo
    // pareceriam rendimento de 267%.
    var entradaBulk = arred(num((f.entradaBulk || {}).kg));
    var massaEntrada = arred(pesadoTotal + entradaBulk);
    var perdaProcesso = rendimento != null && massaEntrada > 0 ? arred(massaEntrada - rendimento) : null;
    return {
      previstoTotal: previstoTotal, pesadoTotal: pesadoTotal, rendimento: rendimento,
      entradaBulk: entradaBulk, massaEntrada: massaEntrada,
      perdasPesagem: perdasPesagem, perdasManipulacao: perdasManipulacao, perdasMp: perdasMp,
      perdaProcesso: perdaProcesso,
      perdaProcessoPct: perdaProcesso != null && massaEntrada > 0 ? arred(perdaProcesso / massaEntrada * 100, 2) : null,
      rendimentoPct: rendimento != null && massaEntrada > 0 ? arred(rendimento / massaEntrada * 100, 2) : null,
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
    if (r.rendimento != null && r.massaEntrada > 0 && r.rendimento > r.massaEntrada) {
      erros.push(r.entradaBulk > 0
        ? 'O rendimento (' + r.rendimento + ') é maior que o bulk que entrou (' + r.entradaBulk + ') mais o que foi pesado na correção (' + r.pesadoTotal + ').'
        : 'O rendimento (' + r.rendimento + ') é maior que o total pesado (' + r.pesadoTotal + ').');
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
    if (st === 'CORRECAO_ABERTA') return ['INICIAR_PESAGEM'];
    if (st === 'REPROVADO') return ['ABRIR_CORRECAO'];
    return [];
  }

  /* ══════════════ CORREÇÃO DO BULK REPROVADO ══════════════
     Decisões do usuário (25/09/2026):
     - "Só Qualidade autoriza, RNC obrigatória";
     - o lote continua o MESMO (a correção é um novo ciclo da fase de bulk,
       não OP nova nem lote novo);
     - a massa a mais "vira excedente de produção": o envase acompanha e
       envasa o excedente sob o mesmo lote, o que pede mais frascos, rótulos
       e caixas.

     Mecânica: ao abrir a correção, o ciclo reprovado inteiro (pesagem,
     conferência, manipulação, análise) vai para historico/c{n} e a fase
     recomeça com os insumos da correção como `previstos`. Assim a pesagem,
     a conferência e a manipulação que já existem servem à correção sem
     reescrita, e nada do ciclo anterior se perde. Chave 'c1', não '1': o
     RTDB transforma chaves numéricas em array. */
  function ciclo(f) { return Math.max(1, parseInt((f && f.ciclo) || 1, 10) || 1); }
  function ehCorrecao(f) { return ciclo(f) > 1 && !!(f && f.correcao); }
  // Registro retroativo (bulk corrigido antes de o sistema permitir): a
  // Qualidade dispensa a foto da balança com justificativa, e isso fica
  // gravado na correção. Nunca é o padrão.
  function dispensaFoto(f) { return !!(f && f.correcao && f.correcao.retroativo); }

  // Mesma regra de chave do resto do sistema (sanitizeKey de utils.js).
  function itemCorrecaoKey(codigo) { return texto(codigo).replace(/[.#$\[\]\/]/g, '_'); }

  /* A correção adiciona MATÉRIA-PRIMA ao bulk (usuário, 25/09: "eu vou
     adicionar MPs"). Cadastro de Materiais: MPGR (MP geral) e MPES
     (fragrância) são MP; EP/ES/ET (embalagens) e MU (uso e consumo) não
     entram num tanque. Sem tipo no cadastro, não dá para afirmar: aceita. */
  var TIPOS_NAO_MP = {EP: 'embalagem primária', ES: 'embalagem secundária', ET: 'embalagem terciária', MU: 'uso e consumo'};
  function ehMateriaPrima(material) {
    var t = texto(material && material.tipo).toUpperCase();
    return !TIPOS_NAO_MP[t];
  }
  function motivoNaoMp(material) { return TIPOS_NAO_MP[texto(material && material.tipo).toUpperCase()] || null; }

  function validarAberturaCorrecao(fase_, dados, podeAutorizar) {
    var f = fase_ || {}, d = dados || {}, erros = [];
    if (!podeAutorizar) erros.push('Só a Qualidade autoriza a correção do bulk.');
    if (f.status !== 'REPROVADO') erros.push('Só um bulk reprovado pode ser corrigido.');
    if (!texto(d.rncNumero)) erros.push('Vincule a RNC da reprovação (obrigatória).');
    if (!texto(d.motivo)) erros.push('Descreva o motivo da correção.');
    var itens = (d.itens || []).filter(function(it) { return it && (texto(it.mpCodigo) || n(it.quantidade) != null); });
    if (!itens.length) erros.push('Informe ao menos uma matéria-prima da correção.');
    var vistos = {};
    itens.forEach(function(it, i) {
      var cod = texto(it.mpCodigo);
      if (!cod) erros.push('Matéria-prima ' + (i + 1) + ': informe o código.');
      else if (vistos[cod]) erros.push(cod + ' aparece duas vezes.');
      vistos[cod] = true;
      if (!(n(it.quantidade) > 0)) erros.push((cod || 'Matéria-prima ' + (i + 1)) + ': informe a quantidade.');
      if (it.tipo && !ehMateriaPrima(it)) erros.push(cod + ' é ' + motivoNaoMp(it) + ' — a correção adiciona matéria-prima.');
    });
    if (!(n(d.entradaKg) > 0)) erros.push('Informe a massa do bulk reprovado que entra na correção (kg).');
    if (d.retroativo && !texto(d.justificativaRetroativo)) erros.push('Justifique o registro retroativo.');
    return {ok: !erros.length, erros: erros};
  }

  // A nova fase inteira (grava-se em ops/{lote}/manipulacao de uma vez).
  function montarCorrecao(fase_, dados) {
    var f = fase_ || {}, d = dados || {}, agora = d.agora || new Date().toISOString();
    var n0 = ciclo(f);
    var anterior = {};
    Object.keys(f).forEach(function(k) { if (k !== 'historico') anterior[k] = f[k]; });
    anterior.ciclo = n0;
    var historico = Object.assign({}, f.historico || {});
    historico['c' + n0] = anterior;
    var previstosCorr = {};
    (d.itens || []).filter(function(it) { return it && texto(it.mpCodigo); }).forEach(function(it, i) {
      previstosCorr[itemCorrecaoKey(it.mpCodigo)] = {
        mpCodigo: texto(it.mpCodigo), mpNome: texto(it.mpNome), unidade: texto(it.unidade) || 'kg',
        previsto: arred(num(it.quantidade)), ordem: i, correcao: true
      };
    });
    return {
      status: 'CORRECAO_ABERTA', ciclo: n0 + 1,
      previstos: previstosCorr,
      entradaBulk: {kg: arred(num(d.entradaKg)), doCiclo: n0},
      correcao: {
        rncNumero: texto(d.rncNumero), rncKey: texto(d.rncKey) || null,
        motivo: texto(d.motivo), instrucao: texto(d.instrucao) || null,
        retroativo: !!d.retroativo, justificativaRetroativo: d.retroativo ? texto(d.justificativaRetroativo) : null,
        por: texto(d.quem) || null, uid: d.uid || null, em: agora
      },
      historico: historico
    };
  }

  // Todos os ciclos do lote, do primeiro ao atual (dossiê e Qualidade).
  function ciclos(fase_) {
    var f = fase_ || {};
    var lista = Object.keys(f.historico || {}).map(function(k) { return f.historico[k]; })
      .filter(Boolean).sort(function(a, b) { return ciclo(a) - ciclo(b); });
    if (f.status) {
      var atual = {};
      Object.keys(f).forEach(function(k) { if (k !== 'historico') atual[k] = f[k]; });
      atual.ciclo = ciclo(f);
      lista.push(atual);
    }
    return lista;
  }

  /* EXCEDENTE: quantas unidades a mais o bulk corrigido rende. A conta usa
     só dados do próprio lote: a massa teórica que a fórmula pediu para a
     quantidade planejada (previstos do 1º ciclo) dá os kg por unidade.
     Arredonda para BAIXO (regra do usuário: na dúvida, o menor número). */
  function massaTeorica(previstos) {
    return arred(Object.keys(previstos || {}).reduce(function(s, k) { return s + num((previstos[k] || {}).previsto); }, 0));
  }
  function calcularExcedente(d) {
    var dados = d || {};
    var rendimento = num(dados.rendimentoKg), base = Math.round(num(dados.qtdBase)), teorico = num(dados.massaTeoricaKg);
    if (!(rendimento > 0) || !(base > 0) || !(teorico > 0)) {
      return {ok: false, motivo: 'Sem a massa teórica da fórmula ou a quantidade planejada, não dá para converter kg em unidades.'};
    }
    var kgPorUn = teorico / base;
    var capacidade = Math.floor(rendimento / kgPorUn + 1e-9);
    return {ok: true, kgPorUnidade: arred(kgPorUn, 6), capacidade: capacidade,
      qtdBase: base, excedente: Math.max(0, capacidade - base), qtdNova: Math.max(base, capacidade)};
  }

  /* Embalagens do excedente: o BOM (origem 'bom') escala com as unidades;
     a fórmula não (a MP do bulk já saiu na pesagem). Guarda a quantidade
     original para que um novo ciclo recalcule a partir dela, e devolve a
     diferença a empenhar (positiva) ou a liberar (negativa). */
  function materiaisDoExcedente(materiaisConsumo, qtdBase, qtdNova) {
    var out = {}, deltas = [];
    var base = num(qtdBase), nova = num(qtdNova);
    Object.keys(materiaisConsumo || {}).forEach(function(k) {
      var it = materiaisConsumo[k];
      if (!it || it.origem !== 'bom' || !(base > 0)) { out[k] = it; return; }
      var original = it.quantidadeOriginal != null ? num(it.quantidadeOriginal) : num(it.quantidade);
      var qtd = arred(original * nova / base);
      var delta = arred(qtd - num(it.quantidade));
      out[k] = Object.assign({}, it, {quantidade: qtd, quantidadeOriginal: original});
      if (delta) deltas.push({mpCodigo: it.mpCodigo, mpNome: it.mpNome || '', quantidade: delta});
    });
    return {materiais: out, deltas: deltas};
  }
  /* Separação já concluída com a quantidade antiga: o excedente pede mais
     embalagem na linha. A OP volta a "separação parcial" com tudo o que já
     foi levado, e as telas de Separação passam a pedir só a diferença.
     Pela separação por OP, o concluído guarda só o que ELA levou (o parcial
     da consolidada fica à parte); pela consolidada, o concluído já é o total. */
  function separacaoAposExcedente(op, agora, quem) {
    var o = op || {}, conc = o.separacaoConcluida;
    if (!conc) return null;
    var parcial = (o.separacaoParcial && o.separacaoParcial.itens) || {};
    var itensConc = conc.itens || {};
    var total = {};
    Object.keys(parcial).forEach(function(mp) { total[mp] = num(parcial[mp]); });
    if (conc.via !== 'consolidada') {
      Object.keys(itensConc).forEach(function(mp) { total[mp] = arred(num(total[mp]) + num(itensConc[mp])); });
    } else {
      Object.keys(itensConc).forEach(function(mp) { total[mp] = Math.max(num(total[mp]), num(itensConc[mp])); });
    }
    return {
      separacaoParcial: {itens: total, em: agora, por: quem || null},
      separacaoConcluida: null,
      separacaoReaberta: {motivo: 'Excedente do bulk corrigido', em: agora, por: quem || null, concluidaAntes: conc}
    };
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
    transicao: transicao, acoesDisponiveis: acoesDisponiveis, minutos: minutos,
    ehMateriaPrima: ehMateriaPrima,
    ciclo: ciclo, ehCorrecao: ehCorrecao, dispensaFoto: dispensaFoto, ciclos: ciclos,
    validarAberturaCorrecao: validarAberturaCorrecao, montarCorrecao: montarCorrecao,
    massaTeorica: massaTeorica, calcularExcedente: calcularExcedente, materiaisDoExcedente: materiaisDoExcedente,
    separacaoAposExcedente: separacaoAposExcedente
  };
});
