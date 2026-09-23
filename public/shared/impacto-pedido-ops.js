/* Impacto de uma mudança de pedido nas OPs (GAP-05 de FLUXOS_DO_SISTEMA.md).

   O defeito (conferido em 2026-09-23): o Comercial cancela o pedido
   ("Cancelar saldo", comercial.html) ou reduz a quantidade (Gestão Comercial,
   shared/pedido-edicao.js) e as OPs já emitidas continuam Programadas, com
   empenho e lugar na grade -- ninguém avisa o PCP, e a fábrica produz o que o
   cliente não quer mais.

   Decisão de desenho: o Comercial NÃO cancela OP. Cancelar é do PCP (papel
   admin/pcp) e OP com produção exige senha (ops.html, cancelOp). Então a
   mudança gera uma PENDÊNCIA para o PCP em pendencias_pcp/{id}, gravada no
   mesmo update da mudança, listando as OPs afetadas. No Controle de OPs o PCP
   cancela (fluxo que já existe, com a cascata de empenho/alocação/grade) ou
   mantém com motivo. Aumento de quantidade não gera pendência: o saldo já
   aparece sozinho no backlog.

   Quanto sobra num item: comprometido = produzido do item + o que falta
   produzir nas OPs ativas dele. Se comprometido > nova quantidade, a
   diferença é o excesso e as OPs ativas do item entram na pendência.

   Funções PURAS: sem DOM e sem Firebase. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImpactoPedidoOps = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function texto(v) { return v == null ? '' : String(v).trim(); }
  function sanitizeKey(str) {
    if (!str) return '';
    return String(str).trim().replace(/[./[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60);
  }
  // Mesma regra de pedido-edicao.js: "0014__X" e "14__X" são a mesma linha.
  function normChave(k) {
    var p = texto(k).split('__');
    if (p.length < 2) return texto(k);
    return (/^\d+$/.test(p[0]) ? String(parseInt(p[0], 10)) : p[0]) + '__' + p.slice(1).join('__');
  }
  // Espelha opEstaAtiva (shared/utils.js): fechada pelo operador também não é ativa.
  function ativa(op) {
    var s = String((op && op.status) || '');
    return !!op && s !== 'Concluído' && s !== 'Cancelado' && s !== 'Aguardando Confirmação';
  }
  // Espelha getProduzido(op, 'linha').
  function produzidoOp(op) {
    if (!op) return 0;
    if (op.produzidoLinha != null) return n(op.produzidoLinha);
    return n(op.produzido);
  }

  /* OPs ativas ligadas a uma linha do backlog (pedidos/{linhaKey}). */
  function opsAtivasDaLinha(linhaKey, ops) {
    if (!linhaKey) return [];
    var alvo = normChave(linhaKey);
    return Object.keys(ops || {}).filter(function(k) {
      var o = ops[k];
      return ativa(o) && o.skuPedidoKey && normChave(o.skuPedidoKey) === alvo;
    }).map(function(k) {
      var o = ops[k];
      return {opKey: k, lote: o.lote || k, qtdPlanejada: n(o.qtdPlanejada), produzido: produzidoOp(o), status: o.status || ''};
    }).sort(function(a, b) { return a.lote < b.lote ? -1 : a.lote > b.lote ? 1 : 0; });
  }

  /* itens: [{sku, linhaKey, qtdAntes, qtdNova (null = item removido/cancelado), produzido}]
     Devolve só os itens em que sobra OP, cada um com as OPs ativas. */
  function avaliar(itens, ops) {
    return (itens || []).map(function(i) {
      var lista = opsAtivasDaLinha(i.linhaKey, ops);
      if (!lista.length) return null;
      var aFazer = lista.reduce(function(s, o) { return s + Math.max(o.qtdPlanejada - o.produzido, 0); }, 0);
      var comprometido = n(i.produzido) + aFazer;
      var nova = i.qtdNova == null ? 0 : n(i.qtdNova);
      var excesso = comprometido - nova;
      if (excesso <= 0) return null;
      return {sku: i.sku, linhaKey: i.linhaKey, qtdAntes: i.qtdAntes == null ? null : n(i.qtdAntes),
        qtdNova: i.qtdNova == null ? null : n(i.qtdNova), produzido: n(i.produzido), comprometido: comprometido,
        excesso: excesso, ops: lista};
    }).filter(Boolean);
  }

  /* Itens afetados por uma edição (plano de PedidoEdicao.planejar). */
  function itensDaEdicao(plano) {
    var out = [];
    (plano.mudancas || []).forEach(function(m) {
      var c = plano.ctx && plano.ctx[m.sku];
      if (!c || !c.linhaKey) return;
      if (m.tipo === 'QUANTIDADE' && n(m.depois) < n(m.antes)) {
        out.push({sku: m.sku, linhaKey: c.linhaKey, qtdAntes: m.antes, qtdNova: m.depois, produzido: c.produzido});
      } else if (m.tipo === 'ITEM_REMOVIDO') {
        out.push({sku: m.sku, linhaKey: c.linhaKey, qtdAntes: m.antes, qtdNova: null, produzido: c.produzido});
      }
    });
    return out;
  }

  /* Itens de um cancelamento: toda linha do backlog do pedido. */
  function itensDoCancelamento(pedidoId, itensPedido, pedidos) {
    var porSku = {};
    Object.keys(pedidos || {}).forEach(function(k) {
      var l = pedidos[k] || {};
      if (normChave(texto(l.parentPedidoId || l.id) + '__x') !== normChave(texto(pedidoId) + '__x') || !l.sku) return;
      if (!porSku[l.sku]) porSku[l.sku] = {linhaKey: k, produzido: n(l.produzido), qtd: n(l.qtdTotal)};
    });
    return (itensPedido || []).filter(function(i) { return i && i.sku; }).map(function(i) {
      var l = porSku[i.sku] || {linhaKey: pedidoId + '__' + sanitizeKey(i.sku), produzido: 0, qtd: n(i.qtd)};
      return {sku: i.sku, linhaKey: l.linhaKey, qtdAntes: n(i.qtd) || l.qtd, qtdNova: null, produzido: l.produzido};
    });
  }

  /* Caminhos planos da pendência, para entrar no MESMO update da mudança.
     Sem item afetado devolve {} (nada para o PCP revisar). */
  function pendencia(tipo, pedido, afetados, meta) {
    if (!afetados || !afetados.length) return {};
    meta = meta || {};
    var sufixo = tipo === 'PEDIDO_CANCELADO' ? 'cancelamento' : 'v' + (meta.versao || 0);
    var key = sanitizeKey(pedido.id) + '__' + sufixo;
    var ops = {};
    afetados.forEach(function(i) {
      i.ops.forEach(function(o) {
        ops[sanitizeKey(o.opKey)] = {opKey: o.opKey, lote: o.lote, sku: i.sku, linhaKey: i.linhaKey,
          qtdPlanejada: o.qtdPlanejada, produzido: o.produzido, statusNaAbertura: o.status};
      });
    });
    var u = {};
    u['pendencias_pcp/' + key] = {
      tipo: tipo, status: 'ABERTA', pedidoComercialId: pedido.id, cliente: pedido.cliente || '',
      numeroPedidoCliente: pedido.numeroPedidoCliente || '', versao: meta.versao || null,
      motivo: texto(meta.motivo), criadoEm: meta.agora || new Date().toISOString(), criadoPor: meta.autor || '',
      itens: afetados.map(function(i) {
        return {sku: i.sku, linhaKey: i.linhaKey, qtdAntes: i.qtdAntes, qtdNova: i.qtdNova,
          produzido: i.produzido, comprometido: i.comprometido, excesso: i.excesso};
      }),
      ops: ops
    };
    return u;
  }

  /* Situação de cada OP de uma pendência, lida contra ops/ atual.
     RESOLVIDA quando toda OP foi cancelada, fechada ou mantida com motivo. */
  function situacao(pend, ops) {
    var linhas = Object.keys((pend && pend.ops) || {}).map(function(k) {
      var p = pend.ops[k], o = (ops || {})[p.opKey];
      var estado;
      if (!o) estado = 'SUMIU';
      else if (o.status === 'Cancelado') estado = 'CANCELADA';
      else if (!ativa(o)) estado = 'FECHADA';
      else if (p.decisao === 'MANTIDA') estado = 'MANTIDA';
      else estado = 'PENDENTE';
      return {key: k, opKey: p.opKey, lote: p.lote, sku: p.sku, qtdPlanejada: p.qtdPlanejada,
        produzidoAgora: o ? produzidoOp(o) : p.produzido, statusAgora: o ? o.status : '', estado: estado,
        motivoMantida: p.motivoMantida || '', mantidaPor: p.mantidaPor || ''};
    });
    var pendentes = linhas.filter(function(l) { return l.estado === 'PENDENTE'; }).length;
    return {linhas: linhas, pendentes: pendentes, resolvida: pendentes === 0};
  }

  function descreverTipo(t) {
    return t === 'PEDIDO_CANCELADO' ? 'Pedido cancelado' : 'Pedido reduzido';
  }

  return {avaliar: avaliar, itensDaEdicao: itensDaEdicao, itensDoCancelamento: itensDoCancelamento,
    pendencia: pendencia, situacao: situacao, opsAtivasDaLinha: opsAtivasDaLinha, descreverTipo: descreverTipo,
    sanitizeKey: sanitizeKey};
});
