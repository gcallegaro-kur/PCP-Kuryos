/* Data de entrega do PCP.

   Pedido do usuário (2026-09-30): uma coluna com a data de entrega do pedido
   DENTRO do PCP (separada da previsão do Comercial), ao lado da prioridade; e,
   com estoque e MRP em ordem, um prazo de até 30 dias a partir do recebimento
   dos insumos. Decisões dele: 30 dias CORRIDOS por padrão (com a opção de
   úteis); a data é por ITEM (pedidos/{chave}.dataEntregaPcp) porque os insumos
   de itens do mesmo pedido chegam em datas diferentes, e o pedido inteiro vale
   a MAIOR data dos itens.

   O campo é do PCP e é digitado. A sugestão (último insumo crítico + 30 dias)
   está aqui como função pura, mas NÃO é ligada a nenhuma tela ainda: o saldo de
   estoque cobre 4% dos materiais e nenhum tem lead time -- uma data calculada
   hoje seria precisa e falsa. Ligar quando o estoque/MRP estiverem confiáveis.

   Funções puras, testadas em run_entrega_pcp_test.js. Datas são 'AAAA-MM-DD'. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EntregaPcp = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var PRAZO_DIAS = 30;
  var DIA_MS = 86400000;

  function ehData(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z')); }
  function utc(iso) { return Date.parse(iso + 'T00:00:00Z'); }
  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }

  /* Data digitada pelo PCP. Vazio limpa o campo. */
  function validar(valor) {
    var v = String(valor == null ? '' : valor).trim();
    if (!v) return {ok: true, data: null};
    if (!ehData(v)) return {ok: false, erro: 'Data inválida.'};
    return {ok: true, data: v};
  }

  /* Soma `dias` a partir de uma data. `uteis` pula sábado e domingo (feriado
     não entra: não há calendário de feriados no sistema). */
  function somarDias(dataIso, dias, uteis) {
    if (!ehData(dataIso)) return null;
    var ms = utc(dataIso), n = Math.max(0, Math.round(Number(dias) || 0));
    if (!uteis) return iso(ms + n * DIA_MS);
    while (n > 0) {
      ms += DIA_MS;
      var d = new Date(ms).getUTCDay();
      if (d !== 0 && d !== 6) n--;
    }
    return iso(ms);
  }

  /* Sugestão: último insumo crítico do item + prazo. Sem data de chegada, sem
     sugestão (nunca inventa). */
  function sugerirEntrega(dataUltimoInsumo, opcoes) {
    var o = opcoes || {};
    return somarDias(dataUltimoInsumo, o.dias != null ? o.dias : PRAZO_DIAS, !!o.uteis);
  }

  /* Pedido inteiro = a maior data entre os itens; itens sem data ficam contados
     (o pedido só está "completo" quando todos têm data). */
  function doPedido(datasDosItens) {
    var lista = (datasDosItens || []);
    var comData = lista.filter(ehData).sort();
    return {
      data: comData.length ? comData[comData.length - 1] : null,
      itens: lista.length, comData: comData.length, semData: lista.length - comData.length
    };
  }

  /* Situação frente ao prazo. `encerrado`: pedido já finalizado, não cobra prazo. */
  function estadoPrazo(dataIso, hojeIso, encerrado) {
    if (!ehData(dataIso)) return {estado: 'SEM_DATA', dias: null};
    if (encerrado) return {estado: 'ENCERRADO', dias: null};
    var dias = Math.round((utc(dataIso) - utc(hojeIso)) / DIA_MS);
    if (dias < 0) return {estado: 'ATRASADO', dias: -dias};
    if (dias === 0) return {estado: 'HOJE', dias: 0};
    return {estado: dias <= 7 ? 'PROXIMO' : 'NO_PRAZO', dias: dias};
  }

  return {PRAZO_DIAS: PRAZO_DIAS, ehData: ehData, validar: validar, somarDias: somarDias,
    sugerirEntrega: sugerirEntrega, doPedido: doPedido, estadoPrazo: estadoPrazo};
});
