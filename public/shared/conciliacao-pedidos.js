/* Conciliação de pedidos: Produzido = Expedido + Em estoque.

   Regras decididas pelo usuário em 2026-09-14:
   - Toda unidade produzida está em um de DOIS lugares: EM ESTOQUE ou
     EXPEDIDA. "Expedido" tem motivo: expedido de fato, furto ou descarte --
     os três tiraram a mercadoria do galpão.
   - Retrabalho e devolução NÃO são saída: a unidade volta a ficar em estoque
     (e depois pode ser expedida). Na planilha legado elas ainda não viraram
     palete no WMS, então entram como estoque de origem "planilha".
   - Só a conta EXATA é OK. Exceção: quando a Logística já apontou a
     divergência na Conferência de PA (conciliação com motivo), a diferença
     apontada entra na conta -- eles já disseram o que aconteceu.
   - Pedido produzido sem nenhum registro de saída nem de estoque fica
     "sem registro" (neutro), não divergente: provavelmente é anterior à
     planilha ou ficou fora dela.

   Fontes (todas legíveis por qualquer usuário logado):
     pedidos/{k}.produzido                     produzido (apontamento)
     expedicoes_comerciais/{c}/itens           legado da planilha e fluxo novo
     estoque_lotes/{item}/{lote}.saldoLote     paletes de PA no WMS
     solicitacoes_descarte/{s}                 descarte concluído
     conferencias_pa/{op}.conciliacao          divergência apontada
     ops/{op}.skuPedidoKey                     ponte lote/conferência -> pedido

   A chave do pedido é RESOLVIDA (com/sem zero à esquerda) pela mesma regra da
   Expedição -- a base tem os dois formatos de verdade. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./expedicao.js'));
  else root.ConciliacaoPedidos = factory(root.ExpedicaoPA);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(ExpedicaoPA) {
  'use strict';

  var MOTIVOS_EXPEDIDO = {EXPEDIDO: 'Expedido', FURTO: 'Furto', DESCARTE: 'Descarte'};
  var ORIGENS_ESTOQUE = {WMS: 'Paletes no WMS', RETRABALHO: 'Retrabalho (planilha)', DEVOLUCAO: 'Devolução (planilha)'};
  // tipoLegado da planilha -> [lado da conta, motivo/origem]. O que não está
  // aqui (SEM_STATUS) não é classificável e fica de fora da conta.
  var LEGADO = {
    EXPEDIDO: ['expedido', 'EXPEDIDO'], FURTO: ['expedido', 'FURTO'],
    RETRABALHO: ['estoque', 'RETRABALHO'], DEVOLUCAO: ['estoque', 'DEVOLUCAO']
  };

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function arred(v) { return Math.round(n(v) * 1000) / 1000; }

  function novo(produzido) {
    return {
      produzido: arred(produzido),
      expedido: {total: 0, motivos: {}},
      estoque: {total: 0, origens: {}},
      divergenciaApontada: {total: 0, ocorrencias: []},
      esperado: 0, contabilizado: 0, diferenca: 0, situacao: 'SEM_PRODUCAO'
    };
  }
  function somar(lado, chave, qtd) {
    var q = arred(qtd);
    if (!q) return;
    var mapa = lado.motivos || lado.origens;
    mapa[chave] = arred((mapa[chave] || 0) + q);
    lado.total = arred(lado.total + q);
  }

  function calcular(base) {
    base = base || {};
    var pedidos = base.pedidos || {}, ops = base.ops || {}, lotes = base.estoque_lotes || {};
    var resolver = function(k) { return ExpedicaoPA.resolverChavePedido(pedidos, k); };
    var porPedido = {}, semVinculo = {expedido: 0, estoque: 0, naoClassificado: 0};

    Object.keys(pedidos).forEach(function(k) { porPedido[k] = novo((pedidos[k] || {}).produzido); });

    function chaveDe(registro) {
      var r = registro || {};
      var op = r.opKey ? ops[r.opKey] : null;
      var k = resolver(r.pedidoKey || r.skuPedidoKey || (op && op.skuPedidoKey) || '');
      return porPedido[k] ? k : null;
    }

    // ── Cargas: legado da planilha e fluxo novo ────────────────────────
    Object.keys(base.expedicoes_comerciais || {}).forEach(function(ck) {
      var c = base.expedicoes_comerciais[ck] || {};
      if (!c.legado && /cancel/i.test(c.status || '')) return;
      Object.keys(c.itens || {}).forEach(function(ik) {
        var i = c.itens[ik] || {}, qtd = n(i.qtd);
        if (!(qtd > 0)) return;
        var destino = c.legado ? LEGADO[c.tipoLegado] : ['expedido', 'EXPEDIDO'];
        if (!destino) { semVinculo.naoClassificado = arred(semVinculo.naoClassificado + qtd); return; }
        var k = chaveDe(i);
        if (!k) { semVinculo[destino[0]] = arred(semVinculo[destino[0]] + qtd); return; }
        somar(porPedido[k][destino[0]], destino[1], qtd);
      });
    });

    // ── Paletes de PA com saldo no WMS ─────────────────────────────────
    Object.keys(lotes).forEach(function(itemKey) {
      Object.keys(lotes[itemKey] || {}).forEach(function(loteKey) {
        var l = lotes[itemKey][loteKey] || {};
        if (l.itemTipo !== 'produto' || !(n(l.saldoLote) > 0)) return;
        var k = chaveDe(l);
        if (!k) { semVinculo.estoque = arred(semVinculo.estoque + n(l.saldoLote)); return; }
        somar(porPedido[k].estoque, 'WMS', l.saldoLote);
      });
    });

    // ── Descarte concluído de produto acabado ─────────────────────────
    Object.keys(base.solicitacoes_descarte || {}).forEach(function(sk) {
      var s = base.solicitacoes_descarte[sk] || {};
      if (s.status !== 'CONCLUIDO' || !(n(s.quantidadeDestinada) > 0)) return;
      var l = (lotes[s.itemKey] || {})[s.loteKey] || {};
      if ((s.itemTipo || l.itemTipo) !== 'produto') return;
      var k = chaveDe(l);
      if (!k) { semVinculo.expedido = arred(semVinculo.expedido + n(s.quantidadeDestinada)); return; }
      somar(porPedido[k].expedido, 'DESCARTE', s.quantidadeDestinada);
    });

    // ── Divergência apontada pela Logística ───────────────────────────
    Object.keys(base.conferencias_pa || {}).forEach(function(opKey) {
      var conf = base.conferencias_pa[opKey] || {};
      if (!conf.finalizadoEm || !conf.conciliacao) return;
      var dif = arred(conf.conciliacao.diferenca != null ? conf.conciliacao.diferenca : conf.divergencia);
      if (!dif) return;
      var k = chaveDe({opKey: opKey});
      if (!k) return;
      var d = porPedido[k].divergenciaApontada;
      d.total = arred(d.total + dif);
      d.ocorrencias.push({opKey: opKey, opLote: conf.opLote || opKey, diferenca: dif,
        motivo: conf.conciliacao.motivo || null, observacao: conf.conciliacao.observacao || null,
        rnc: conf.rncNumero || null});
    });

    Object.keys(porPedido).forEach(function(k) { fechar(porPedido[k]); });
    return {porPedido: porPedido, semVinculo: semVinculo};
  }

  // Esperado = produzido corrigido pelo que a Logística apontou.
  function fechar(r) {
    r.esperado = arred(r.produzido + r.divergenciaApontada.total);
    r.contabilizado = arred(r.expedido.total + r.estoque.total);
    r.diferenca = arred(r.contabilizado - r.esperado);
    if (!r.produzido && !r.contabilizado) r.situacao = 'SEM_PRODUCAO';
    else if (r.produzido > 0 && !r.contabilizado) r.situacao = 'SEM_REGISTRO';
    else if (r.diferenca !== 0) r.situacao = 'DIVERGENTE';
    else r.situacao = r.divergenciaApontada.ocorrencias.length ? 'OK_APONTADA' : 'OK';
    return r;
  }

  // Soma vários pedidos (itens de um pedido comercial). A situação é a PIOR
  // dos itens: somar diferenças de sinais opostos esconderia divergência.
  var GRAVIDADE = {SEM_PRODUCAO: 0, OK: 1, OK_APONTADA: 2, SEM_REGISTRO: 3, DIVERGENTE: 4};
  function agregar(resultados) {
    var total = novo(0), pior = 'SEM_PRODUCAO', itens = 0;
    (resultados || []).forEach(function(r) {
      if (!r) return;
      itens++;
      total.produzido = arred(total.produzido + r.produzido);
      Object.keys(r.expedido.motivos).forEach(function(m) { somar(total.expedido, m, r.expedido.motivos[m]); });
      Object.keys(r.estoque.origens).forEach(function(o) { somar(total.estoque, o, r.estoque.origens[o]); });
      total.divergenciaApontada.total = arred(total.divergenciaApontada.total + r.divergenciaApontada.total);
      total.divergenciaApontada.ocorrencias = total.divergenciaApontada.ocorrencias.concat(r.divergenciaApontada.ocorrencias);
      if (GRAVIDADE[r.situacao] > GRAVIDADE[pior]) pior = r.situacao;
    });
    fechar(total);
    total.situacao = itens ? pior : 'SEM_PRODUCAO';
    return total;
  }

  function fmt(v) { return arred(v).toLocaleString('pt-BR'); }
  function sinal(v) { return (v > 0 ? '+' : '') + fmt(v); }

  // Texto do selo e do detalhe (hover). Sem HTML: quem desenha escapa.
  function descrever(r) {
    var rotulo = {
      OK: 'OK', OK_APONTADA: 'OK · divergência apontada', SEM_REGISTRO: 'Sem registro de saída',
      SEM_PRODUCAO: '—', DIVERGENTE: 'Diferença ' + sinal(r.diferenca)
    }[r.situacao];
    var linhas = ['Produzido: ' + fmt(r.produzido)];
    r.divergenciaApontada.ocorrencias.forEach(function(o) {
      linhas.push('  Apontado na Conferência (OP ' + o.opLote + '): ' + sinal(o.diferenca) +
        (o.motivo ? ' · ' + o.motivo : '') + (o.rnc ? ' · ' + o.rnc : ''));
    });
    if (r.divergenciaApontada.ocorrencias.length) linhas.push('Esperado: ' + fmt(r.esperado));
    linhas.push('Expedido: ' + fmt(r.expedido.total));
    Object.keys(MOTIVOS_EXPEDIDO).forEach(function(m) {
      if (r.expedido.motivos[m]) linhas.push('  ' + MOTIVOS_EXPEDIDO[m] + ': ' + fmt(r.expedido.motivos[m]));
    });
    linhas.push('Em estoque: ' + fmt(r.estoque.total));
    Object.keys(ORIGENS_ESTOQUE).forEach(function(o) {
      if (r.estoque.origens[o]) linhas.push('  ' + ORIGENS_ESTOQUE[o] + ': ' + fmt(r.estoque.origens[o]));
    });
    linhas.push('Expedido + Em estoque: ' + fmt(r.contabilizado));
    if (r.situacao === 'DIVERGENTE') linhas.push(r.diferenca > 0
      ? 'Saídas + estoque passam do produzido em ' + fmt(r.diferenca)
      : 'Faltam ' + fmt(-r.diferenca) + ' un. sem destino registrado');
    return {rotulo: rotulo, detalhe: linhas.join('\n')};
  }

  return {calcular: calcular, agregar: agregar, descrever: descrever, fechar: fechar,
    MOTIVOS_EXPEDIDO: MOTIVOS_EXPEDIDO, ORIGENS_ESTOQUE: ORIGENS_ESTOQUE};
});
