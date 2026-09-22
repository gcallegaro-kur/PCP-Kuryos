/* ══════════════════════════════════════════════════════════════════════
   RETRABALHO É UMA OP — não um universo paralelo

   Correção de rumo do usuário em 22/09: *"A ideia é apenas poder abrir uma
   OP, mas de retrabalho, ao invés de criar uma nova op. Essa ordem de
   retrabalho pode ser alocada em linhas de produção ou postos de trabalho,
   em resumo é isto."*

   A primeira tentativa criou `retrabalhos/{id}` com status, painel e
   callable próprios. Ficou pesado e, pior, ficou de fora de tudo: não
   aparecia no Controle de OPs, não dava para alocar como OP e não ia para
   posto nenhum.

   O modelo de OP já aguenta o serviço. O que faz uma OP de retrabalho não
   contar produção duas vezes são duas AUSÊNCIAS, não dois campos novos:

   - **sem `skuPedidoKey`** → o crédito ao pedido comercial já é pulado
     (`pedidoDaOp` devolve null sem esse vínculo). As unidades já foram
     vendidas e contadas quando a OP original rodou;
   - **sem `materiaisConsumo`** → a baixa de BOM/fórmula já não acontece.
     Retrabalho não refabrica o produto; o que for consumido de verdade
     (um rótulo novo, uma tampa) é lançado à parte, não pelo BOM inteiro.

   O resto — setup, apontamento, pausa, encerramento, rearranjo entre
   linhas, Controle de OPs — funciona porque é uma OP como qualquer outra.

   Funções PURAS: sem DOM, sem Firebase.
   ══════════════════════════════════════════════════════════════════════ */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RetrabalhoOp = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var TIPO = 'RETRABALHO';
  // Onde um retrabalho pode ser executado. 'rotulagem' entra porque a
  // estação de rotulagem já é um destino de OP no sistema -- e recolar
  // rótulo é dos retrabalhos mais comuns.
  var DESTINOS = {
    linha: {rotulo: 'Linha de produção', campoProduzido: 'produzidoLinha'},
    rotulagem: {rotulo: 'Estação de rotulagem', campoProduzido: 'produzidoRotulagem'},
    posto: {rotulo: 'Posto de trabalho', campoProduzido: 'produzidoPosto'}
  };

  function n(v) { var x = Number(v); return isFinite(x) ? x : null; }
  function texto(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 300); }

  function ehRetrabalho(op) { return !!op && op.tipoOrdem === TIPO; }

  /* Numeração pedida pelo usuário: lote original + sufixo RT.
     `26216/04` → `26216/04-RT1`, e o segundo retrabalho do MESMO lote vira
     `-RT2`. A escolha é dele e tem razão de ser: retrabalho não gera lote
     novo de produto -- é o mesmo lote voltando para a linha. Esconder isso
     atrás de um número de sequência quebraria a rastreabilidade que a
     Anvisa cobra. */
  function proximoNumero(loteOriginal, ops) {
    var base = texto(loteOriginal, 60);
    if (!base) return '';
    var usados = Object.values(ops || {}).filter(Boolean).map(function(o) { return String(o.lote || ''); });
    var padrao = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-RT(\\d+)$');
    var maior = 0;
    usados.forEach(function(l) {
      var m = padrao.exec(l);
      if (m) maior = Math.max(maior, parseInt(m[1], 10) || 0);
    });
    return base + '-RT' + (maior + 1);
  }

  function validar(d) {
    var e = [];
    var dados = d || {};
    if (!dados.opOriginal) e.push('Escolha a OP que será retrabalhada.');
    if (!texto(dados.motivo)) e.push('Descreva o motivo do retrabalho.');
    var qtd = n(dados.qtdPlanejada);
    if (qtd == null || qtd <= 0) e.push('Informe quantas unidades serão retrabalhadas.');
    var orig = dados.opOriginal || {};
    var produzidoOriginal = n(orig.produzidoLinha) != null ? n(orig.produzidoLinha) : n(orig.produzido);
    // Retrabalhar mais do que foi produzido é quase sempre erro de digitação
    // -- mas é AVISO, não bloqueio: lote pode ter sido juntado com sobra de
    // outro, e travar aqui empurraria o registro para fora do sistema.
    var avisos = [];
    if (qtd != null && produzidoOriginal != null && produzidoOriginal > 0 && qtd > produzidoOriginal) {
      avisos.push('A quantidade a retrabalhar (' + qtd + ') é maior que a produzida na OP original (' +
        produzidoOriginal + '). Confirme antes de abrir.');
    }
    if (!dados.destino || !DESTINOS[dados.destino.tipo]) e.push('Escolha onde o retrabalho vai ser executado.');
    else if (!texto(dados.destino.nome)) e.push('Escolha a linha, estação ou posto.');
    return {ok: !e.length, erros: e, avisos: avisos};
  }

  /* Monta a OP de retrabalho. Herda do original tudo que identifica o
     produto (SKU, descrição, cliente, validade, unidades por caixa) e
     deixa de fora, de propósito, tudo que geraria produção nova. */
  function montar(d) {
    var dados = d || {};
    var orig = dados.opOriginal || {};
    var destino = dados.destino || {};
    var agora = dados.agora || new Date().toISOString();
    return {
      lote: dados.lote || proximoNumero(orig.lote, dados.ops),
      tipoOrdem: TIPO,
      // Ligação com o que está sendo retrabalhado.
      retrabalhoDe: orig.lote || '',
      retrabalhoDeOpKey: dados.opOriginalKey || '',
      retrabalhoMotivo: texto(dados.motivo, 1000),
      retrabalhoEscopo: texto(dados.escopo, 200) || 'Lote inteiro',
      retrabalhoObs: texto(dados.observacao, 1000) || null,

      sku: orig.sku || '', produto: orig.produto || '', cliente: orig.cliente || '',
      qtdPlanejada: n(dados.qtdPlanejada),
      validade: orig.validade || null,
      pecasPorCaixa: orig.pecasPorCaixa || 0,
      ean13: orig.ean13 || '',

      // ── As duas ausências que impedem contar produção duas vezes ──
      // Ver o comentário do topo: não é omissão, é o mecanismo.
      skuPedidoKey: '',
      materiaisConsumo: {},

      // Destino da execução. `linha` guarda o nome em qualquer um dos três
      // casos -- é o campo que o Painel de Turno e a Grade já leem.
      linha: texto(destino.nome, 60),
      retrabalhoDestino: destino.tipo,

      status: 'Não Iniciado',
      produzidoLinha: 0, produzidoRotulagem: 0, produzidoPosto: 0, produzido: 0,
      dataInicioReal: null, dataFimReal: null,
      dataInicioPlanejada: null, dataFimPlanejada: null,
      mediaPorHora: 0, paradas: [], perdas: {},
      abertaDesde: null, abertaLinha: null, abertaDesdeRot: null, abertaRotulagem: null,
      setupInicio: null, setupFim: null, setupInicioRot: null, setupFimRot: null,
      canceladoEm: null, canceladoPor: null, motivoCancelamento: null,
      dataEmissao: agora, emitidoPor: texto(dados.autor, 120) || 'Desconhecido',
      arquivoPdf: '', arquivoXlsx: ''
    };
  }

  // Como a OP se apresenta nas listas, para ninguém confundir com produção
  // nova. É a diferença entre "fizemos 400 a mais" e "refizemos 400".
  function rotulo(op) {
    if (!ehRetrabalho(op)) return '';
    return 'Retrabalho de ' + (op.retrabalhoDe || '—');
  }
  function destinoRotulo(op) {
    var d = DESTINOS[(op || {}).retrabalhoDestino];
    return d ? d.rotulo : '';
  }

  // OPs de retrabalho de um lote, mais novas primeiro.
  function doLote(ops, loteOriginal) {
    var alvo = String(loteOriginal || '');
    return Object.keys(ops || {})
      .filter(function(k) { return ehRetrabalho(ops[k]) && ops[k].retrabalhoDe === alvo; })
      .map(function(k) { return Object.assign({_key: k}, ops[k]); })
      .sort(function(a, b) { return String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')); });
  }
  function listar(ops) {
    return Object.keys(ops || {})
      .filter(function(k) { return ehRetrabalho(ops[k]); })
      .map(function(k) { return Object.assign({_key: k}, ops[k]); })
      .sort(function(a, b) { return String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')); });
  }

  return {
    TIPO: TIPO, DESTINOS: DESTINOS,
    ehRetrabalho: ehRetrabalho, proximoNumero: proximoNumero,
    validar: validar, montar: montar,
    rotulo: rotulo, destinoRotulo: destinoRotulo,
    doLote: doLote, listar: listar
  };
});
