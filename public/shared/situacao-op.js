/* Situação de encerramento de uma OP -- o que decide se ela fica na tela de
   trabalho do Controle de OPs ou vai para "Encerradas".

   Decisão do usuário (2026-09-29, opção A): a OP só sai da lista principal
   quando o PCP confirmou a conclusão E todo o produto acabado dela está
   liberado pela Qualidade. Se depois voltar palete em quarentena (devolução,
   retrabalho), a OP volta sozinha para a lista principal -- a situação é
   sempre CALCULADA, nunca gravada.

   Estados:
     ATIVA              ainda não concluída pelo PCP (a tela já trata)
     NA_QUALIDADE       concluída, mas há PA em quarentena ou reprovado
     AGUARDA_LOGISTICA  concluída, conferência de PA aberta e não finalizada
                        (ou recém-confirmada sem nenhuma conferência ainda)
     ENCERRADA          concluída e sem nada pendente
   OP concluída antiga (anterior ao WMS) não tem conferência: vai direto para
   ENCERRADA -- exigir conferência dela deixaria o histórico inteiro pendurado.
   Só uma confirmação RECENTE sem conferência espera pela Logística.

   Função pura, testada em run_situacao_op_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SituacaoOp = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var JANELA_LOGISTICA_MS = 7 * 24 * 3600 * 1000;
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }

  /* qualidade: {liberado, pendente, reprovado} do estoque de PA da OP
     (ProgressoOp.paletesPorOp). conferencia: conferencias_pa/{opKey} ou null. */
  function situacao(op, qualidade, conferencia, agoraMs) {
    op = op || {};
    if (op.status !== 'Concluído') return {estado: 'ATIVA', motivo: null};
    var q = qualidade || {};
    if (n(q.pendente) > 0) return {estado: 'NA_QUALIDADE', motivo: n(q.pendente) + ' un aguardando a Qualidade'};
    if (n(q.reprovado) > 0) return {estado: 'NA_QUALIDADE', motivo: n(q.reprovado) + ' un reprovadas'};
    if (conferencia && !conferencia.finalizadoEm) return {estado: 'AGUARDA_LOGISTICA', motivo: 'conferência de PA em andamento'};
    if (!conferencia && n(op.produzidoLinha != null ? op.produzidoLinha : op.produzido) > 0 && op.confirmadoEm) {
      var t = Date.parse(op.confirmadoEm);
      if (isFinite(t) && (agoraMs || Date.now()) - t < JANELA_LOGISTICA_MS) {
        return {estado: 'AGUARDA_LOGISTICA', motivo: 'a Logística ainda não conferiu o PA'};
      }
    }
    return {estado: 'ENCERRADA', motivo: null};
  }

  /* Pedido (SKU) que ainda precisa de OP. A lista "Aguardando emissão de OP"
     mostrava pedido cujas OPs já estavam concluídas e que só não tinha sido
     marcado como concluído -- ruído puro. Mesma tolerância de 95% do status
     da OP (computeOpStatus): produzido ≥ 95% do pedido, sem OP ativa, é
     pedido atendido. */
  function pedidoPrecisaOp(pedido, temOpAtiva) {
    if (temOpAtiva) return false;
    var total = n(pedido && pedido.qtdTotal);
    var produzido = n(pedido && pedido.produzido);
    if (total > 0 && produzido / total >= 0.95) return false;
    return true;
  }

  /* Selos do que falta, no lugar dos vários avisos espalhados pela linha. */
  function selos(op, ctx) {
    ctx = ctx || {};
    var out = [];
    if (op.status !== 'Cancelado') {
      // Sem "falta linha": na base real 59 de 65 OPs ativas não têm linha (só
      // programadas) -- o selo apareceria em quase todas e deixaria de dizer algo.
      if (ctx.divergencia) out.push({chave: 'divergencia', texto: 'Divergência de apontamento', tom: 'aviso'});
      if (ctx.transferenciaPendente) out.push({chave: 'transferencia', texto: 'Transferência pendente', tom: 'aviso'});
      if (!ctx.temPedido) out.push({chave: 'sem-pedido', texto: 'Sem pedido', tom: 'aviso'});
      if (n(ctx.pendenteQualidade) > 0) out.push({chave: 'qualidade', texto: 'Na Qualidade', tom: 'espera'});
      if (n(ctx.reprovado) > 0) out.push({chave: 'reprovado', texto: 'PA reprovado', tom: 'erro'});
    }
    return out;
  }

  return {situacao: situacao, pedidoPrecisaOp: pedidoPrecisaOp, selos: selos};
});
