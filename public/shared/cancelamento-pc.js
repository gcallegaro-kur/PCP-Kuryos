/* Cancelamento de Pedido de Compra -- regras puras (sem Firebase, sem DOM).

   Pedido do usuário (2026-09-15): "Quero que apenas admin possam fazer
   cancelamento de PC, e que tenhamos como ver os PCs cancelados".

   Decisões:
   - Só ADMIN. Cancelar desfaz um acordo comercial, mesma razão de só admin
     editar PC (podeEditarPC em compras.html). A regra do banco repete a trava
     (database.rules.json, pedidos_compra/$pc/status), para não depender da tela.
   - Cancela ABERTO, ENVIADO e RECEBIDO_PARCIAL. No parcial cancela só o SALDO:
     o que já entrou continua recebido, com lote e movimento de estoque -- é
     material físico. RECEBIDO_TOTAL não tem o que cancelar.
   - Motivo obrigatório, e o PC nunca é apagado: vira CANCELADO com quem,
     quando, status anterior e saldo pendente por item. É isso que permite
     "ver os cancelados" e responder depois por que a compra não veio.
   - Nada volta de CANCELADO pela tela. Precisa de novo? Novo PC.
   - Logística e MRP não precisam mudar: as duas só enxergam ENVIADO e
     RECEBIDO_PARCIAL, e o servidor já recusa recebimento em PC cancelado.
   - Solicitações de origem podem voltar para APROVADA (opção na tela), para
     a necessidade não sumir junto com o pedido. Só quando nada foi recebido:
     com recebimento parcial a SC foi parcialmente atendida, e reabrir a
     inteira compraria de novo o que já chegou. */
(function(root) {
  'use strict';

  var CANCELAVEIS = ['ABERTO', 'ENVIADO', 'RECEBIDO_PARCIAL'];
  var MOTIVO_MINIMO = 10;
  var LIMIAR = 0.0001;

  function numero(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function texto(v) { return v == null ? '' : String(v).trim(); }

  function recebeuAlgo(pc) {
    return Object.values((pc && pc.itens) || {}).some(function(it) { return numero(it.qtdRecebida) > LIMIAR; });
  }

  // {pode, motivo}: `motivo` é a frase para a tela quando não pode.
  function avaliarCancelamento(pc, papel) {
    if (!pc) return { pode: false, motivo: 'Pedido não encontrado.' };
    if (papel !== 'admin') return { pode: false, motivo: 'Apenas administradores podem cancelar um pedido de compra.' };
    if (pc.status === 'CANCELADO') return { pode: false, motivo: 'Este pedido já está cancelado.' };
    if (pc.status === 'RECEBIDO_TOTAL') return { pode: false, motivo: 'Este pedido já foi recebido por inteiro — não há saldo para cancelar.' };
    if (CANCELAVEIS.indexOf(pc.status) < 0) return { pode: false, motivo: 'Pedido com status ' + (pc.status || '—') + ' não pode ser cancelado.' };
    return { pode: true, motivo: null };
  }

  // Saldo que deixa de vir, por item. Recebido acima do pedido não gera
  // saldo negativo.
  function saldoPendentePorItem(pc) {
    var out = {};
    Object.keys((pc && pc.itens) || {}).forEach(function(k) {
      var it = pc.itens[k] || {};
      var saldo = Math.max(0, numero(it.qtd) - numero(it.qtdRecebida));
      out[k] = {
        materialCodigo: it.materialCodigo || null, materialNome: it.materialNome || null,
        unidade: it.unidade || null, qtdPedida: numero(it.qtd), qtdRecebida: numero(it.qtdRecebida),
        saldoCancelado: Math.round(saldo * 1000) / 1000
      };
    });
    return out;
  }

  // Aplica o cancelamento sobre o PC ATUAL (dentro da transaction). Devolve
  // {pc} com o novo valor, ou {erro} para abortar com a frase da tela.
  function aplicarCancelamento(pcAtual, dados) {
    dados = dados || {};
    var av = avaliarCancelamento(pcAtual, dados.papel);
    if (!av.pode) return { erro: av.motivo };
    var motivo = texto(dados.motivo);
    if (motivo.length < MOTIVO_MINIMO) return { erro: 'Descreva o motivo do cancelamento (mínimo ' + MOTIVO_MINIMO + ' caracteres).' };
    var reabrir = !!dados.reabrirSolicitacoes && !recebeuAlgo(pcAtual);
    var pc = JSON.parse(JSON.stringify(pcAtual));
    pc.cancelamento = {
      motivo: motivo.slice(0, 500),
      canceladoPor: dados.autor || null,
      canceladoEm: dados.agora || new Date().toISOString(),
      statusAnterior: pcAtual.status,
      tinhaRecebimento: recebeuAlgo(pcAtual),
      tinhaAgendamento: !!pcAtual.agendamento,
      saldoPorItem: saldoPendentePorItem(pcAtual),
      solicitacoesReabertas: reabrir ? Object.keys(pcAtual.solicitacoesOrigem || {}) : null
    };
    pc.status = 'CANCELADO';
    return { pc: pc };
  }

  // SCs que a tela oferece reabrir: só as de origem, só se nada foi recebido,
  // e só as que ainda estão CONSOLIDADA (outra ação pode ter mexido).
  function solicitacoesParaReabrir(pc, solicitacoes) {
    if (!pc || recebeuAlgo(pc)) return [];
    return Object.keys(pc.solicitacoesOrigem || {}).filter(function(k) {
      var s = (solicitacoes || {})[k];
      return !!s && s.status === 'CONSOLIDADA';
    });
  }

  // Filtro da aba: 'ativos' (padrão, esconde cancelados), 'cancelados', 'todos'.
  function passaFiltroStatus(pc, filtro) {
    var cancelado = !!pc && pc.status === 'CANCELADO';
    if (filtro === 'cancelados') return cancelado;
    if (filtro === 'todos') return true;
    return !cancelado;
  }

  // PC cancelado não entra em histórico de preço nem em análise de fornecedor:
  // pedido desfeito (muitas vezes justamente por preço errado) não é referência.
  function contaComoCompra(pc) { return !!pc && pc.status !== 'CANCELADO'; }

  var api = {
    CANCELAVEIS: CANCELAVEIS, MOTIVO_MINIMO: MOTIVO_MINIMO,
    avaliarCancelamento: avaliarCancelamento, saldoPendentePorItem: saldoPendentePorItem,
    aplicarCancelamento: aplicarCancelamento, solicitacoesParaReabrir: solicitacoesParaReabrir,
    passaFiltroStatus: passaFiltroStatus, contaComoCompra: contaComoCompra, recebeuAlgo: recebeuAlgo
  };
  root.CancelamentoPC = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
