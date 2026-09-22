/* ══════════════════════════════════════════════════════════════════════
   GESTÃO DE RETRABALHOS — o que dá para ver e o que fazer em seguida

   O controle de execução (shared/retrabalhos-tela.js, dentro do
   Apontamento) resolve o "apontar". Faltava o resto: acompanhar os casos,
   entender em que pé cada um está e REGISTRAR A AVALIAÇÃO no fim.

   Achado do usuário em 22/09, sobre a primeira versão: *"não ficou legal,
   não deu pra acompanhar bem"*. Dois defeitos concretos por trás disso:

   1. O botão de encerrar a execução SUMIA quando havia apontamento com
      quantidade pendente. Sumir sem explicar é o pior dos mundos -- quem
      está na tela conclui que o sistema quebrou. Por isso existe aqui o
      `proximoPasso`: ele diz, em uma frase, o que falta para destravar.
   2. Depois de `finalizar`, o caso parava em `aguardando_qualidade` e
      ficava ali para sempre. Não havia passo de avaliação -- que é o item
      6 do PLANO_GESTAO_RETRABALHOS.md e o que fecha o ciclo.

   Funções PURAS: entram os dados de `retrabalhos/{id}`, sai o que a tela
   precisa. Sem DOM e sem Firebase, para dar para testar sem navegador.
   ══════════════════════════════════════════════════════════════════════ */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RetrabalhosGestao = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  /* Os estados que o caso percorre. `aguardando_qualidade` é o único que
     depende de outra pessoa -- por isso ele é o que a tela destaca. */
  var ESTADOS = {
    em_andamento:          {rotulo: 'Em execução',            cor: 'azul',    aberto: true},
    pausado:               {rotulo: 'Pausado',                cor: 'laranja', aberto: true},
    aguardando_qualidade:  {rotulo: 'Aguardando Qualidade',   cor: 'roxo',    aberto: true},
    liberado:              {rotulo: 'Liberado',               cor: 'verde',   aberto: false},
    reprovado:             {rotulo: 'Reprovado',              cor: 'vermelho', aberto: false}
  };

  var DECISOES = {
    liberado:   {rotulo: 'Retrabalho aprovado', ajuda: 'A execução resolveu o problema. A liberação do lote continua sendo feita lote a lote na tela de Qualidade — este registro não libera estoque.'},
    nova_etapa: {rotulo: 'Precisa de nova etapa', ajuda: 'Devolve o caso para a linha, pausado, e um novo ciclo de execução recomeça. O histórico anterior fica preservado.'},
    reprovado:  {rotulo: 'Retrabalho reprovado', ajuda: 'O retrabalho não resolveu. O caso é encerrado aqui; o destino do lote (descarte, devolução, concessão) é decidido na Qualidade.'}
  };

  function n(v) { var x = Number(v); return isFinite(x) ? x : null; }
  function estado(rt) { return ESTADOS[(rt || {}).status] || {rotulo: (rt || {}).status || '—', cor: 'cinza', aberto: true}; }
  function aberto(rt) { return estado(rt).aberto; }

  function apontamentos(rt) {
    var m = (rt || {}).apontamentos || {};
    return Object.keys(m).map(function(k) { return Object.assign({id: k}, m[k]); })
      .sort(function(a, b) { return String(a.inicio || '').localeCompare(String(b.inicio || '')); });
  }
  function pendentes(rt) {
    return apontamentos(rt).filter(function(a) { return a.quantidadePendente; });
  }
  function confirmado(rt) {
    return apontamentos(rt).reduce(function(s, a) { return s + (a.quantidadePendente ? 0 : (n(a.quantidade) || 0)); }, 0);
  }
  function minutosExecutados(rt) {
    return apontamentos(rt).reduce(function(s, a) {
      var ini = Date.parse(a.inicio), fim = Date.parse(a.fim);
      return s + (isFinite(ini) && isFinite(fim) && fim > ini ? Math.round((fim - ini) / 60000) : 0);
    }, 0);
  }

  /* ── A frase que faltava ──
     Devolve {titulo, detalhe, acao, bloqueio}. `bloqueio` preenchido =
     existe um passo pendente ANTES do próximo botão -- e o texto diz qual.
     É isso que substitui o botão que sumia sem explicação. */
  function proximoPasso(rt, papel) {
    var r = rt || {};
    var ehAdmin = papel === 'admin';
    var podeDecidir = ehAdmin || papel === 'qualidade';
    var nPend = pendentes(r).length;

    if (r.status === 'em_andamento') {
      return {titulo: 'Execução em andamento', acao: 'pausar',
        detalhe: 'Quando parar, registre o período e a quantidade feita nele — a quantidade é do período, não acumulada.'};
    }
    if (r.status === 'pausado') {
      if (nPend) {
        return {
          titulo: 'Falta conferir a quantidade de ' + nPend + ' apontamento' + (nPend > 1 ? 's' : ''),
          detalhe: ehAdmin
            ? 'Informe quanto foi retrabalhado em cada período pendente. Enquanto houver pendência, a execução não pode ser encerrada — quantidade pendente é diferente de zero.'
            : 'Um administrador precisa informar quanto foi retrabalhado nesses períodos. Enquanto houver pendência, a execução não pode ser encerrada.',
          acao: ehAdmin ? 'corrigir_quantidade' : null,
          bloqueio: 'encerrar'
        };
      }
      return {titulo: 'Pronto para encerrar a execução', acao: 'finalizar',
        detalhe: 'Encerrar libera a linha e envia o caso para a avaliação da Qualidade.'};
    }
    if (r.status === 'aguardando_qualidade') {
      return {
        titulo: podeDecidir ? 'Aguardando a sua avaliação' : 'Aguardando avaliação da Qualidade',
        detalhe: podeDecidir
          ? 'Registre a análise e decida: aprovado, nova etapa ou reprovado. O registro não libera estoque — a liberação do lote continua na tela de Qualidade.'
          : 'A execução terminou. A Qualidade precisa analisar o resultado e decidir.',
        acao: podeDecidir ? 'decidir' : null,
        bloqueio: podeDecidir ? null : 'decidir'
      };
    }
    if (r.status === 'liberado') {
      return {titulo: 'Caso encerrado — retrabalho aprovado',
        detalhe: 'Confira se o lote já foi liberado na tela de Qualidade; este caso não libera estoque sozinho.'};
    }
    if (r.status === 'reprovado') {
      return {titulo: 'Caso encerrado — retrabalho reprovado',
        detalhe: 'O destino do lote (descarte, devolução ou concessão) é decidido na Qualidade.'};
    }
    return {titulo: 'Situação não reconhecida: ' + (r.status || '—'),
      detalhe: 'Registro fora dos estados previstos — confira antes de agir.'};
  }

  /* ── Linha do tempo ──
     Um caso de retrabalho é uma história: quando abriu, o que foi feito em
     cada período, quem pausou e por quê, quando encerrou e o que a
     Qualidade decidiu. Ler isso numa lista de botões era impossível. */
  function linhaDoTempo(rt) {
    var r = rt || {};
    var itens = [];
    function add(quando, titulo, detalhe, tipo) {
      if (!quando) return;
      itens.push({quando: quando, titulo: titulo, detalhe: detalhe || '', tipo: tipo || 'evento'});
    }
    add(r.criadoEm, 'Caso aberto', r.motivo || '', 'abertura');
    add(r.setupInicio, 'Início do setup', '', 'setup');
    add(r.setupFim, 'Fim do setup', '', 'setup');
    add(r.envaseInicio, 'Início da execução', r.linha || '', 'execucao');
    apontamentos(r).forEach(function(a) {
      var qtd = a.quantidadePendente ? 'quantidade pendente'
        : (n(a.quantidade) || 0) + ' un.';
      add(a.fim || a.inicio, 'Período apontado — ' + qtd,
        [a.linha, a.operador ? 'operador ' + a.operador : '',
         a.corrigidoEm ? 'corrigido por ' + a.corrigidoPor : ''].filter(Boolean).join(' · '),
        a.quantidadePendente ? 'pendente' : 'apontamento');
    });
    add(r.encerradoEm, 'Execução encerrada', 'Caso enviado para a Qualidade', 'encerramento');
    Object.values(r.decisoes || {}).forEach(function(d) {
      add(d.em, 'Avaliação: ' + ((DECISOES[d.decisao] || {}).rotulo || d.decisao),
        [d.responsavel, d.analise].filter(Boolean).join(' — '), 'decisao');
    });
    return itens.sort(function(a, b) { return String(a.quando).localeCompare(String(b.quando)); });
  }

  // Resumo de um caso, do jeito que o cartão da lista mostra.
  function resumo(rt, papel) {
    var r = rt || {};
    var est = estado(r);
    return {
      id: r.id || '',
      lote: r.loteOriginal || '',
      produto: r.produto || '',
      cliente: r.cliente || '',
      linha: r.linha || '',
      escopo: r.escopo || '',
      motivo: r.motivo || '',
      status: r.status || '',
      statusRotulo: est.rotulo,
      statusCor: est.cor,
      aberto: est.aberto,
      confirmado: confirmado(r),
      referencia: n(r.quantidadeOriginalRegistrada),
      pendentes: pendentes(r).length,
      apontamentos: apontamentos(r).length,
      minutos: minutosExecutados(r),
      desde: r.atualizadoEm || r.encerradoEm || r.criadoEm || '',
      passo: proximoPasso(r, papel)
    };
  }

  function lista(retrabalhos, papel) {
    var m = retrabalhos || {};
    return Object.keys(m).map(function(k) {
      return resumo(Object.assign({id: k}, m[k]), papel);
    }).sort(function(a, b) {
      // Abertos primeiro; dentro de cada grupo, o mexido mais recentemente.
      if (a.aberto !== b.aberto) return a.aberto ? -1 : 1;
      return String(b.desde).localeCompare(String(a.desde));
    });
  }

  function filtrar(itens, filtros) {
    var f = filtros || {};
    var busca = String(f.busca || '').trim().toLowerCase();
    return (itens || []).filter(function(r) {
      if (f.status === 'abertos' && !r.aberto) return false;
      if (f.status === 'encerrados' && r.aberto) return false;
      if (f.status && f.status !== 'abertos' && f.status !== 'encerrados' && r.status !== f.status) return false;
      if (!busca) return true;
      return [r.id, r.lote, r.produto, r.cliente, r.linha, r.motivo]
        .join(' ').toLowerCase().indexOf(busca) >= 0;
    });
  }

  // Números do topo da tela. `pendencia` é o que cobra ação de alguém.
  function contadores(itens) {
    var l = itens || [];
    return {
      total: l.length,
      abertos: l.filter(function(r) { return r.aberto; }).length,
      emExecucao: l.filter(function(r) { return r.status === 'em_andamento'; }).length,
      aguardandoQualidade: l.filter(function(r) { return r.status === 'aguardando_qualidade'; }).length,
      comQuantidadePendente: l.filter(function(r) { return r.pendentes > 0; }).length
    };
  }

  return {
    ESTADOS: ESTADOS, DECISOES: DECISOES,
    estado: estado, aberto: aberto, apontamentos: apontamentos, pendentes: pendentes,
    confirmado: confirmado, minutosExecutados: minutosExecutados,
    proximoPasso: proximoPasso, linhaDoTempo: linhaDoTempo,
    resumo: resumo, lista: lista, filtrar: filtrar, contadores: contadores
  };
});
