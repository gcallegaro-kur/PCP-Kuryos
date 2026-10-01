/* PCP confirma cada encerramento de setor (usuário, 01/10: "neste momento,
   quero que o PCP confirme cada apontamento, de rotulagem e de envase").

   Antes só existia a confirmação da OP inteira, e a rotulagem fechando antes
   do envase aparecia como se fosse a OP pronta (26273/03 e /04). Agora cada
   fechamento de setor grava ops/{op}/confirmacaoEtapas/{envase|rotulagem} =
   {status: 'AGUARDANDO', quantidade, fechadoEm, local, operador} (form.html,
   updateOpRecordOnApontamento) e o Controle de OPs lista uma linha por etapa.

   A conclusão da OP (status Concluído, que abre a Conferência de PA) continua
   sendo do PCP: acontece ao confirmar a última etapa pendente de uma OP que já
   está em 'Aguardando Confirmação'. Testado em run_confirmacao_etapas_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ConfirmacaoEtapas = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var ROTULOS = {envase: 'Envase', rotulagem: 'Rotulagem'};
  var ORDEM = ['envase', 'rotulagem'];

  function etapasPendentes(op) {
    var e = (op && op.confirmacaoEtapas) || {};
    return ORDEM.filter(function(k) { return e[k] && e[k].status === 'AGUARDANDO'; });
  }

  // Uma linha por etapa aguardando, de todas as OPs não canceladas.
  function pendentes(ops) {
    var out = [];
    Object.keys(ops || {}).forEach(function(key) {
      var op = ops[key];
      if (!op || op.status === 'Cancelado') return;
      etapasPendentes(op).forEach(function(etapa) {
        var e = op.confirmacaoEtapas[etapa];
        out.push({opKey: key, op: op, etapa: etapa, rotulo: ROTULOS[etapa],
          quantidade: Number(e.quantidade) || 0, fechadoEm: e.fechadoEm || null,
          local: e.local || null, operador: e.operador || null,
          concluiOp: concluiAoConfirmar(op, etapa)});
      });
    });
    return out.sort(function(a, b) {
      return String(a.fechadoEm || '').localeCompare(String(b.fechadoEm || '')) ||
        String(a.op.lote || a.opKey).localeCompare(String(b.op.lote || b.opKey));
    });
  }

  // Confirmar esta etapa encerra a OP? Só se ela já está pronta para o PCP
  // (Aguardando Confirmação) e esta é a última etapa pendente.
  function concluiAoConfirmar(op, etapa) {
    if (!op || op.status !== 'Aguardando Confirmação') return false;
    return etapasPendentes(op).filter(function(k) { return k !== etapa; }).length === 0;
  }

  // OP pronta para o PCP sem nenhuma etapa pendente (fechada antes desta
  // mudança, ou etapas já confirmadas): segue com o botão de conclusão antigo.
  function precisaConclusaoAvulsa(op) {
    return !!op && op.status === 'Aguardando Confirmação' && etapasPendentes(op).length === 0;
  }

  // Caminhos planos (nunca objeto aninhado em update de RTDB).
  function updatesConfirmacao(opKey, etapa, quem, agoraIso) {
    var base = 'ops/' + opKey + '/confirmacaoEtapas/' + etapa + '/';
    var u = {};
    u[base + 'status'] = 'CONFIRMADO';
    u[base + 'confirmadoPor'] = quem || 'desconhecido';
    u[base + 'confirmadoEm'] = agoraIso || new Date().toISOString();
    return u;
  }

  return {ROTULOS: ROTULOS, etapasPendentes: etapasPendentes, pendentes: pendentes,
    concluiAoConfirmar: concluiAoConfirmar, precisaConclusaoAvulsa: precisaConclusaoAvulsa,
    updatesConfirmacao: updatesConfirmacao};
});
