/* Ajuste de Pedido de Compra -- regras puras (sem Firebase, sem DOM).

   Pedido do usuário (19/10/2026), motivado pelo PC-0038: pediram 6.000 de
   álcool, o fornecedor só tinha 5.000, o pedido foi ajustado verbalmente e o
   sistema não tinha como refletir isso. Recebidos os 5.000, o PC ficou
   "Recebido parcial" para sempre, esperando um saldo que nunca virá.

   Dois ajustes, cada um no momento em que faz sentido:

   - ANTES_DE_RECEBER  (ENVIADO, nada recebido): corrige a quantidade de um ou
     mais itens. O fornecedor já tem o documento, então o ajuste vira REVISÃO
     numerada, com motivo, e o documento impresso sai com a faixa de revisão.
     (Antes de enviar, o PC se edita normalmente em "Editar".)
   - ENCERRAR_SALDO    (RECEBIDO_PARCIAL): fecha o pedido com o que chegou. A
     quantidade pedida de cada item cai para a recebida; o saldo que não virá
     fica registrado (qtdOriginal / saldoEncerrado). O PC passa a Recebido
     total e some da fila da Logística e do MRP. Não é cancelamento: o que
     entrou continua válido, e o pedido não vira "Cancelado".

   Só ADMIN, como editar e cancelar PC (mexer em quantidade de um pedido
   decidido é alterar acordo comercial). Motivo obrigatório. O PC nunca é
   apagado: tudo fica em `ajustes/` com antes, depois, quem e quando.

   O servidor (functions/recebimento.js) valida o recebimento contra `qtd` e
   recalcula o status a partir de qtd x qtdRecebida; por isso reduzir `qtd` é
   exatamente o que fecha o saldo -- e um estorno posterior reabre o saldo
   sozinho, sem exceção de código. */
(function(root) {
  'use strict';

  var MOTIVO_MINIMO = 10;
  var LIMIAR = 0.0001;

  function numero(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function texto(v) { return v == null ? '' : String(v).trim(); }
  function arred(v, casas) { var f = Math.pow(10, casas == null ? 4 : casas); return Math.round(numero(v) * f) / f; }

  function itensDe(pc) { return (pc && pc.itens) || {}; }
  function recebeuAlgo(pc) {
    if (pc && pc.recebimentos && Object.keys(pc.recebimentos).length) return true;
    return Object.keys(itensDe(pc)).some(function(k) { return numero(itensDe(pc)[k].qtdRecebida) > LIMIAR; });
  }
  function temSaldo(pc) {
    return Object.keys(itensDe(pc)).some(function(k) {
      var it = itensDe(pc)[k];
      return numero(it.qtd) - numero(it.qtdRecebida) > LIMIAR;
    });
  }

  // {pode, modo, motivo}: `motivo` é a frase para a tela quando não pode.
  function avaliar(pc, papel) {
    if (!pc) return {pode: false, modo: null, motivo: 'Pedido não encontrado.'};
    if (papel !== 'admin') return {pode: false, modo: null, motivo: 'Apenas administradores podem ajustar um pedido de compra.'};
    if (pc.status === 'CANCELADO') return {pode: false, modo: null, motivo: 'Pedido cancelado não se ajusta.'};
    if (pc.status === 'RECEBIDO_TOTAL') return {pode: false, modo: null, motivo: 'Este pedido já foi recebido por inteiro — não há o que ajustar.'};
    if (pc.status === 'ABERTO') return {pode: false, modo: null, motivo: 'O pedido ainda não foi enviado: corrija pelo botão Editar.'};
    if (pc.status === 'ENVIADO') {
      if (recebeuAlgo(pc)) return {pode: false, modo: null, motivo: 'Este pedido já tem recebimento registrado.'};
      return {pode: true, modo: 'ANTES_DE_RECEBER', motivo: null};
    }
    if (pc.status === 'RECEBIDO_PARCIAL') {
      if (!temSaldo(pc)) return {pode: false, modo: null, motivo: 'Não há saldo pendente neste pedido.'};
      return {pode: true, modo: 'ENCERRAR_SALDO', motivo: null};
    }
    return {pode: false, modo: null, motivo: 'Pedido com status ' + (pc.status || '—') + ' não pode ser ajustado.'};
  }

  // Cópia do item com todas as quantidades derivadas na mesma proporção.
  // Preserva a relação que o pedido já tinha entre qtd, qtdCotada (unidade do
  // fornecedor) e qtdEmUnidadeEstoque, qualquer que seja a conversão.
  function escalarItem(item, novaQtd) {
    var it = JSON.parse(JSON.stringify(item || {}));
    var antes = numero(item && item.qtd), nova = arred(novaQtd);
    var razao = antes > LIMIAR ? nova / antes : 0;
    it.qtd = nova;
    if (it.qtdCotada != null) it.qtdCotada = arred(numero(item.qtdCotada) * razao);
    if (it.qtdEmUnidadeEstoque != null) it.qtdEmUnidadeEstoque = arred(numero(item.qtdEmUnidadeEstoque) * razao);
    if (it.custoTotalNaDecisao != null) it.custoTotalNaDecisao = arred(numero(item.custoTotalNaDecisao) * razao, 2);
    if (nova <= LIMIAR) it.cancelado = true; else delete it.cancelado;
    return it;
  }

  function saldoPorItem(pc) {
    var out = {};
    Object.keys(itensDe(pc)).forEach(function(k) {
      var it = itensDe(pc)[k] || {};
      out[k] = {
        materialCodigo: it.materialCodigo || null, materialNome: it.materialNome || null, unidade: it.unidade || null,
        qtdPedida: numero(it.qtd), qtdRecebida: numero(it.qtdRecebida),
        saldo: arred(Math.max(0, numero(it.qtd) - numero(it.qtdRecebida)), 3)
      };
    });
    return out;
  }

  function valorTotal(itens) {
    var tem = false, soma = 0;
    Object.keys(itens).forEach(function(k) {
      if (itens[k].custoTotalNaDecisao != null) { tem = true; soma += numero(itens[k].custoTotalNaDecisao); }
    });
    return tem ? arred(soma, 2) : null;
  }

  /* Aplica o ajuste sobre o PC ATUAL (dentro da transaction). Devolve {pc}
     ou {erro} para abortar com a frase da tela.
     dados: {papel, motivo, autor, agora, qtdNova: {itemKey: quantidade}} --
     qtdNova só vale em ANTES_DE_RECEBER. */
  function aplicar(pcAtual, dados) {
    dados = dados || {};
    var av = avaliar(pcAtual, dados.papel);
    if (!av.pode) return {erro: av.motivo};
    var motivo = texto(dados.motivo);
    if (motivo.length < MOTIVO_MINIMO) return {erro: 'Descreva o motivo do ajuste (mínimo ' + MOTIVO_MINIMO + ' caracteres).'};

    var pc = JSON.parse(JSON.stringify(pcAtual)), itens = pc.itens, alterados = {};
    var valorAntes = valorTotal(itensDe(pcAtual));

    if (av.modo === 'ANTES_DE_RECEBER') {
      var pedidos = dados.qtdNova || {};
      var chaves = Object.keys(pedidos).filter(function(k) { return itens[k]; });
      for (var i = 0; i < chaves.length; i++) {
        var k = chaves[i], q = pedidos[k];
        if (q === '' || q == null || !isFinite(parseFloat(q))) return {erro: 'Informe uma quantidade válida para ' + (itens[k].materialCodigo || k) + '.'};
        q = parseFloat(q);
        if (q < 0) return {erro: 'A quantidade de ' + (itens[k].materialCodigo || k) + ' não pode ser negativa.'};
        if (Math.abs(q - numero(itens[k].qtd)) <= LIMIAR) continue;
        alterados[k] = {antes: numero(itens[k].qtd), depois: arred(q)};
      }
      if (!Object.keys(alterados).length) return {erro: 'Nenhuma quantidade foi alterada.'};
      Object.keys(alterados).forEach(function(k) { itens[k] = escalarItem(itens[k], alterados[k].depois); });
      var restam = Object.keys(itens).some(function(k) { return numero(itens[k].qtd) > LIMIAR; });
      if (!restam) return {erro: 'O pedido ficaria sem nenhum item com quantidade. Para desfazer o pedido, use Cancelar.'};
    } else {
      // ENCERRAR_SALDO: cada item cai para o que foi recebido.
      Object.keys(itens).forEach(function(k) {
        var qtd = numero(itens[k].qtd), rec = numero(itens[k].qtdRecebida);
        if (qtd - rec <= LIMIAR) return;
        alterados[k] = {antes: qtd, depois: arred(rec)};
        itens[k] = escalarItem(itens[k], rec);
        itens[k].qtdOriginal = itens[k].qtdOriginal != null ? itens[k].qtdOriginal : qtd;
        itens[k].saldoEncerrado = arred((numero(itens[k].saldoEncerrado)) + (qtd - rec), 3);
      });
    }

    var rev = numero(pcAtual.revisao) + 1, id = 'AJ' + ('000' + rev).slice(-3);
    var detalhe = {};
    Object.keys(alterados).forEach(function(k) {
      detalhe[k] = {materialCodigo: itens[k].materialCodigo || null, materialNome: itens[k].materialNome || null, unidade: itens[k].unidade || null,
        qtdAntes: alterados[k].antes, qtdDepois: alterados[k].depois, qtdRecebida: numero(itens[k].qtdRecebida)};
    });
    var valorDepois = valorTotal(itens);
    pc.ajustes = Object.assign({}, pcAtual.ajustes || {});
    pc.ajustes[id] = {
      revisao: rev, tipo: av.modo, em: dados.agora || new Date().toISOString(), por: dados.autor || null, motivo: motivo.slice(0, 500),
      statusAntes: pcAtual.status, itens: detalhe, valorAntes: valorAntes, valorDepois: valorDepois
    };
    pc.revisao = rev;
    if (valorDepois != null) pc.valorTotalEstimado = valorDepois;
    if (av.modo === 'ENCERRAR_SALDO') {
      // Mesma regra de functions/recebimento.js (statusPedidoApos): completo
      // quando todo item tem recebido >= qtd. Aqui é sempre o caso.
      pc.status = 'RECEBIDO_TOTAL';
      pc.encerramentoSaldo = {motivo: motivo.slice(0, 500), por: dados.autor || null, em: dados.agora || new Date().toISOString(), revisao: rev};
    }
    return {pc: pc, modo: av.modo, revisao: rev, alterados: detalhe};
  }

  // Itens para a tela: o que foi pedido, o que chegou e o saldo.
  function resumoParaTela(pc) {
    var s = saldoPorItem(pc);
    return Object.keys(s).map(function(k) { return Object.assign({itemKey: k}, s[k]); });
  }

  var api = {
    MOTIVO_MINIMO: MOTIVO_MINIMO, avaliar: avaliar, aplicar: aplicar, escalarItem: escalarItem,
    saldoPorItem: saldoPorItem, resumoParaTela: resumoParaTela, recebeuAlgo: recebeuAlgo, temSaldo: temSaldo
  };
  root.AjustePC = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
