(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExpedicaoGrade = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  function numero(v) { return Number(v).toLocaleString('pt-BR'); }
  function composicao(p) {
    p = p || {};
    var caixas = Number(p.caixasFechadas), multiplo = Number(p.unidadesPorCaixa), parcial = Number(p.unidadesCaixaParcial || 0);
    var total = Number(p.saldoLote != null ? p.saldoLote : p.qtdUnidades);
    var valida = Number.isInteger(caixas) && caixas >= 0 && Number.isInteger(parcial) && parcial >= 0 &&
      Number.isInteger(total) && total > 0 && (caixas === 0 || Number.isInteger(multiplo) && multiplo > 0) &&
      (multiplo <= 0 || parcial < multiplo) && caixas * multiplo + parcial === total;
    if (!valida) return {valida: false, total: Number.isFinite(total) ? total : null, volumes: null,
      texto: 'Composição a conferir', resumo: (Number.isFinite(total) ? numero(total) + ' un · ' : '') + 'composição a conferir'};
    var partes = [];
    if (caixas > 0) partes.push(numero(caixas) + ' cx × ' + numero(multiplo));
    if (parcial > 0) partes.push('1 parcial com ' + numero(parcial));
    var texto = partes.join(' + ');
    return {valida: true, caixas: caixas, multiplo: multiplo || null, parcial: parcial,
      total: total, volumes: caixas + (parcial > 0 ? 1 : 0), texto: texto, resumo: texto + ' = ' + numero(total) + ' un'};
  }
  function dia(v) {
    var s = String(v || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var n = Date.parse(s + 'T12:00:00Z');
    return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === s ? n : null;
  }
  function diasEstoque(entrada, saidaOuHoje) {
    var a = dia(entrada), b = dia(saidaOuHoje);
    return a == null || b == null || b < a ? null : Math.round((b - a) / 86400000);
  }
  function totais(paletes) {
    return (paletes || []).reduce(function(t, p) {
      var c = composicao(p);
      t.paletes++; t.unidades += c.total || 0;
      if (c.valida) { t.caixasFechadas += c.caixas; t.caixasParciais += c.parcial > 0 ? 1 : 0; t.volumes += c.volumes; }
      else t.composicoesPendentes++;
      return t;
    }, {paletes: 0, unidades: 0, caixasFechadas: 0, caixasParciais: 0, volumes: 0, composicoesPendentes: 0});
  }
  /* ── Peso da carga ───────────────────────────────────────────────────
     Pedido do usuário (2026-09-15): peso da carga como na planilha, e o
     teórico do que ainda aguarda Qualidade ou Conferência de PA.
     Convenção da PLANILHA: cada volume pesa uma caixa cheia -- a parcial
     conta como caixa ("1 cx × 10, carga 8,4 kg" com 8,4 kg/cx). Superestima
     um pouco a parcial, o que é o lado seguro para lotação de veículo, e mantém
     o peso dos paletes novos coerente com o dos importados da planilha.
     Ordem das fontes: peso real do palete (planilha) > kg/cx gravado no palete >
     kg/cx do cadastro do produto. Sem nenhuma, o peso é DESCONHECIDO (null),
     nunca zero -- zero somaria como se a carga fosse mais leve. */
  function positivo(v) { var n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
  function arred(v) { return Math.round(v * 1000) / 1000; }
  function produtoDoSku(produtos, sku) {
    produtos = produtos || {};
    if (!sku) return null;
    if (produtos[sku]) return produtos[sku];
    var chave = Object.keys(produtos).find(function(k) { return (produtos[k] || {}).sku === sku; });
    return chave ? produtos[chave] : null;
  }
  function pesoPalete(lote, produto) {
    lote = lote || {};
    var real = positivo(lote.pesoTotalKg);
    if (real != null) return {kg: arred(real), kgPorCaixa: positivo(lote.pesoPorCaixaKg), fonte: 'PLANILHA'};
    var kgCx = positivo(lote.pesoPorCaixaKg), fonte = 'PALETE';
    if (kgCx == null) { kgCx = positivo((produto || {}).kgCaixa); fonte = 'CADASTRO'; }
    if (kgCx == null) return {kg: null, kgPorCaixa: null, fonte: null, falta: 'kg por caixa no cadastro do produto'};
    var c = composicao(lote), volumes = c.valida ? c.volumes : null;
    // Composição a conferir: estima volumes pelo un/cx do cadastro, se houver.
    if (volumes == null) {
      var unCx = positivo((produto || {}).unCx), total = positivo(lote.saldoLote != null ? lote.saldoLote : lote.qtdUnidades);
      if (unCx != null && total != null) volumes = Math.ceil(total / unCx);
    }
    if (volumes == null) return {kg: null, kgPorCaixa: kgCx, fonte: null, falta: 'composição das caixas'};
    return {kg: arred(volumes * kgCx), kgPorCaixa: kgCx, fonte: fonte, volumes: volumes};
  }
  // OP produzida que ainda não virou palete (aguarda Conferência de PA ou a
  // confirmação do PCP): o palete não existe, então o peso é TEÓRICO pelo
  // cadastro -- produzido ÷ un/cx, arredondado para cima, × kg/cx.
  function pesoTeoricoOp(qtd, produto) {
    var q = positivo(qtd), unCx = positivo((produto || {}).unCx), kgCx = positivo((produto || {}).kgCaixa);
    if (q == null) return {kg: null, volumes: null, falta: 'quantidade produzida'};
    if (unCx == null) return {kg: null, volumes: null, falta: 'unidades por caixa no cadastro do produto'};
    var volumes = Math.ceil(q / unCx);
    if (kgCx == null) return {kg: null, volumes: volumes, falta: 'kg por caixa no cadastro do produto'};
    return {kg: arred(volumes * kgCx), volumes: volumes, kgPorCaixa: kgCx};
  }
  function somaPeso(pesos) {
    return (pesos || []).reduce(function(t, p) {
      t.itens++;
      if (p && p.kg != null) t.kg = arred(t.kg + p.kg); else t.semPeso++;
      return t;
    }, {kg: 0, itens: 0, semPeso: 0});
  }

  /* ── Selecionar todos ────────────────────────────────────────────────
     Uma carga só é aceita pelo servidor (confirmarExpedicaoPA /
     salvarAgendamentoExpedicaoPA) com o MESMO cliente, o MESMO destino, CIF/FOB
     compatível e até 100 paletes. Selecionar tudo sem essas regras montaria
     uma carga que o servidor recusa na hora de confirmar. */
  var LIMITE_PALETES_CARGA = 100;
  function compativel(a, b) {
    if ((a.clienteKey || a.cliente) !== (b.clienteKey || b.cliente)) return false;
    if (JSON.stringify((a.frete || {}).enderecoEntrega || '') !== JSON.stringify((b.frete || {}).enderecoEntrega || '')) return false;
    var ta = (a.frete || {}).tipo || '', tb = (b.frete || {}).tipo || '';
    return !ta || !tb || ta === tb;
  }
  // `candidatas`: linhas visíveis e selecionáveis; `jaSelecionadas`: linhas da
  // seleção atual. Âncora = seleção atual; sem seleção, as candidatas precisam
  // formar UMA carga, senão nada é marcado e o motivo diz o que filtrar.
  function selecionarTodos(candidatas, jaSelecionadas) {
    candidatas = candidatas || []; jaSelecionadas = jaSelecionadas || [];
    var ancora = jaSelecionadas[0] || candidatas[0];
    if (!ancora) return {selecionar: [], ignoradas: 0, motivo: 'Nenhum palete disponível neste filtro.'};
    var compat = candidatas.filter(function(l) { return compativel(ancora, l); });
    var incompat = candidatas.length - compat.length;
    if (!jaSelecionadas.length && incompat) {
      var clientes = {};
      candidatas.forEach(function(l) { clientes[l.clienteKey || l.cliente] = true; });
      var n = Object.keys(clientes).length;
      return {selecionar: [], ignoradas: candidatas.length,
        motivo: n > 1 ? 'Os paletes visíveis são de ' + n + ' clientes. Filtre um cliente para selecionar todos.'
                      : 'Os paletes visíveis têm destinos ou CIF/FOB diferentes e não cabem na mesma carga. Refine a busca.'};
    }
    var espaco = Math.max(0, LIMITE_PALETES_CARGA - jaSelecionadas.length);
    var selecionar = compat.slice(0, espaco);
    var motivos = [];
    if (incompat) motivos.push(incompat + ' palete(s) de outro cliente, destino ou CIF/FOB ficaram de fora');
    if (compat.length > espaco) motivos.push('limite de ' + LIMITE_PALETES_CARGA + ' paletes por carga');
    return {selecionar: selecionar, ignoradas: candidatas.length - selecionar.length, motivo: motivos.join('; ')};
  }

  return {composicao: composicao, diasEstoque: diasEstoque, totais: totais,
    produtoDoSku: produtoDoSku, pesoPalete: pesoPalete, pesoTeoricoOp: pesoTeoricoOp, somaPeso: somaPeso,
    compativel: compativel, selecionarTodos: selecionarTodos, LIMITE_PALETES_CARGA: LIMITE_PALETES_CARGA};
});
