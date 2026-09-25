/* Relatório de Pedido (2026-09-25).
   Pedido do usuário: "relatório de pedido, onde mostra a produção total,
   lotes, expedidos, perdas de cada um dos itens".

   Funções PURAS. Não refaz conta nenhuma que já exista:
   - produzido / expedido / em estoque, por item e por OP, vêm da
     ConciliacaoPedidos.calcular (a mesma conta da tela de Pedidos -- os dois
     lugares nunca discordam);
   - perdas seguem a regra do Histórico de Apontamentos (perdasDoLote):
     perdas/{lote} lançadas no apontamento têm prioridade; ops/{op}.perdas
     (importado do Excel antigo) só entra quando o lote não tem lançamento.

   Perdas aqui são de COMPONENTES (frasco, rótulo, cartucho...), na unidade de
   cada um -- é o que o apontamento registra. Por isso são mostradas por tipo e
   nunca somadas às unidades de produto acabado. O índice "% sobre produzido"
   compara a quantidade de componentes perdidos com as unidades produzidas.

   Um pedido = todos os pedidos/{id__sku} com o mesmo parentPedidoId (ou id),
   comparado EXATO: na base, "05" (Febella) e "0005" (Safira) são pedidos
   diferentes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./expedicao.js'));
  else root.RelatorioPedido = factory(root.ExpedicaoPA);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ExpedicaoPA) {
  'use strict';

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function arred(v) { return Math.round(n(v) * 1000) / 1000; }
  function chaveLote(lote) { // = sanitizeKey de shared/utils.js (chave de perdas/)
    if (!lote) return '';
    return String(lote).trim().replace(/[./[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60);
  }
  function idDoPedido(p, k) { return String((p && (p.parentPedidoId || p.id)) || String(k || '').split('__')[0]); }
  // Chaves do Excel antigo (ops/{op}.perdas) viram rótulo legível.
  var LEGADO = { cartuchos: 'Cartuchos', frascosEnvase: 'Frascos (envase)', frascosRotulagem: 'Frascos (rotulagem)',
    rotulosEnvase: 'Rótulos (envase)', rotulosRotulagem: 'Rótulos (rotulagem)' };
  function rotuloTipo(t) {
    var s = String(t || 'Outro');
    if (LEGADO[s]) return LEGADO[s];
    s = s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Perdas de um lote por tipo. Mesma regra de historico.html (perdasDoLote).
  // OP reemitida ("26204/04-v2"): o apontador lança no número de lote que está
  // no papel ("26204/04"). Se esse lote não é de outra OP (`lotesComOp`), a
  // perda lançada nele é desta.
  function perdasDoLote(perdas, op, lotesComOp) {
    var chave = chaveLote(op && op.lote);
    var entradas = (perdas || {})[chave];
    var semSufixo = chave.replace(/-v\d+$/, '');
    if (!entradas && semSufixo !== chave && lotesComOp && !lotesComOp[semSufixo]) entradas = (perdas || {})[semSufixo];
    var tot = {};
    if (entradas) {
      Object.keys(entradas).forEach(function (k) {
        var e = entradas[k] || {};
        (Array.isArray(e.perdas) ? e.perdas : Object.values(e.perdas || {})).forEach(function (p) {
          if (!p) return;
          var rot = p.tipo === 'Outro' && p.especificacao ? p.especificacao : rotuloTipo(p.tipo);
          tot[rot] = arred((tot[rot] || 0) + n(p.quantidade));
        });
      });
      return tot;
    }
    var legado = op && op.perdas;
    if (legado && typeof legado === 'object') {
      Object.keys(legado).forEach(function (t) { if (n(legado[t])) tot[rotuloTipo(t)] = arred((tot[rotuloTipo(t)] || 0) + n(legado[t])); });
    }
    return tot;
  }
  function somaTipos(destino, origem) {
    Object.keys(origem || {}).forEach(function (t) { destino[t] = arred((destino[t] || 0) + origem[t]); });
    return destino;
  }
  function total(tipos) { return arred(Object.keys(tipos || {}).reduce(function (s, t) { return s + n(tipos[t]); }, 0)); }
  function pct(parte, todo) { return todo > 0 ? Math.round((parte / todo) * 1000) / 10 : null; }

  // Lista para escolher o pedido: um registro por número, mais recente em cima.
  function listarPedidos(pedidos, comerciais) {
    var grupos = {};
    Object.keys(pedidos || {}).forEach(function (k) {
      var p = pedidos[k] || {};
      var id = idDoPedido(p, k);
      var g = grupos[id] || (grupos[id] = { id: id, cliente: '', data: '', itens: 0, qtdPedido: 0, produzido: 0, abertos: 0 });
      g.itens++;
      g.qtdPedido = arred(g.qtdPedido + n(p.qtdTotal));
      g.produzido = arred(g.produzido + n(p.produzido));
      if (p.status !== 'Concluído' && p.statusManual !== 'encerrado') g.abertos++;
      if (!g.cliente && p.cliente) g.cliente = p.cliente;
    });
    return Object.keys(grupos).map(function (id) {
      var g = grupos[id], c = (comerciais || {})[id] || {};
      g.cliente = c.cliente || g.cliente;
      g.data = c.dataPedido || (c.criadoEm ? String(c.criadoEm).slice(0, 10) : '');
      g.numeroCliente = c.numeroPedidoCliente || '';
      return g;
    }).sort(function (a, b) {
      if (a.data !== b.data) return a.data < b.data ? 1 : -1; // sem data vai pro fim
      return a.id < b.id ? 1 : (a.id > b.id ? -1 : 0);
    });
  }

  // base: {pedidos, ops, perdas, pedidos_comerciais}; conc: saída de
  // ConciliacaoPedidos.calcular sobre a mesma base.
  function montar(pedidoId, base, conc) {
    base = base || {};
    var pedidos = base.pedidos || {}, ops = base.ops || {}, perdas = base.perdas || {};
    var porPedido = (conc && conc.porPedido) || {};
    var resolver = function (k) { return ExpedicaoPA.resolverChavePedido(pedidos, k); };
    var id = String(pedidoId);
    var chaves = Object.keys(pedidos).filter(function (k) { return idDoPedido(pedidos[k], k) === id; })
      .sort(function (a, b) { return String(pedidos[a].sku || a).localeCompare(String(pedidos[b].sku || b)); });
    if (!chaves.length) return null;

    // OPs de cada item: pela chave do item (mesma resolução da conciliação).
    var opsPorItem = {}, lotesComOp = {};
    Object.keys(ops).forEach(function (opKey) {
      var op = ops[opKey] || {};
      lotesComOp[chaveLote(op.lote)] = true;
      if (op.status === 'Cancelado') return;
      var k = resolver(op.skuPedidoKey || '');
      if (chaves.indexOf(k) < 0) return;
      (opsPorItem[k] = opsPorItem[k] || []).push(opKey);
    });

    var tot = { qtdPedido: 0, produzido: 0, aProduzir: 0, expedido: 0, estoque: 0, lotes: 0, perdas: {}, motivos: {} };
    var itens = chaves.map(function (k) {
      var p = pedidos[k] || {};
      var r = porPedido[k] || null;
      var produzido = arred(r ? r.produzido : p.produzido);
      var lista = (opsPorItem[k] || []).slice();
      // OP que só aparece na conciliação (saída ou palete apontando para ela).
      Object.keys((r && r.porOp) || {}).forEach(function (o) { if (o !== 'SEM_OP' && ops[o] && lista.indexOf(o) < 0) lista.push(o); });

      var perdasItem = {};
      var lotes = lista.map(function (opKey) {
        var op = ops[opKey] || {};
        var c = (r && r.porOp && r.porOp[opKey]) || null;
        var pl = perdasDoLote(perdas, op, lotesComOp);
        somaTipos(perdasItem, pl);
        var prod = arred(op.produzido);
        return {
          opKey: opKey, lote: op.lote || opKey, status: op.status || '', linha: op.abertaLinha || op.linha || '',
          retrabalho: op.tipoOrdem === 'RETRABALHO',
          inicio: op.dataInicioReal || op.abertaDesde || '', fim: op.dataFimReal || '',
          planejado: arred(op.qtdPlanejada), produzido: prod,
          expedido: c ? c.expedido.total : 0, motivos: c ? c.expedido.motivos : {},
          estoque: c ? c.estoque.total : 0,
          perdas: pl, perdasTotal: total(pl), perdaPct: pct(total(pl), prod)
        };
      }).sort(function (a, b) { return String(a.lote).localeCompare(String(b.lote)); });

      var semOp = r && r.porOp && r.porOp.SEM_OP;
      var somaOps = lotes.reduce(function (s, l) { return s + l.produzido; }, 0);
      var qtdPedido = arred(p.qtdTotal);
      var item = {
        key: k, sku: p.sku || '', produto: p.produto || p.sku || k, status: p.status || '',
        encerrado: p.statusManual === 'encerrado',
        qtdPedido: qtdPedido, produzido: produzido,
        atendidoPct: pct(produzido, qtdPedido),
        aProduzir: p.statusManual === 'encerrado' ? 0 : arred(Math.max(0, qtdPedido - produzido)),
        expedido: r ? r.expedido.total : 0, motivos: r ? r.expedido.motivos : {},
        estoque: r ? r.estoque.total : 0,
        situacao: r ? r.situacao : 'SEM_PRODUCAO', diferenca: r ? r.diferenca : 0,
        devolvido: r && r.devolvido ? r.devolvido.total : 0,
        perdas: perdasItem, perdasTotal: total(perdasItem), perdaPct: pct(total(perdasItem), produzido),
        lotes: lotes,
        // Produção do item que nenhuma OP explica (apontamento antigo, OP de
        // outro pedido) e saídas/paletes sem OP: aparecem numa linha própria.
        semOp: {
          produzido: arred(produzido - somaOps),
          expedido: semOp ? semOp.expedido.total : 0,
          estoque: semOp ? semOp.estoque.total : 0
        }
      };
      tot.qtdPedido += item.qtdPedido; tot.produzido += item.produzido; tot.aProduzir += item.aProduzir;
      tot.expedido += item.expedido; tot.estoque += item.estoque; tot.lotes += lotes.length;
      somaTipos(tot.perdas, perdasItem);
      Object.keys(item.motivos).forEach(function (m) { tot.motivos[m] = arred((tot.motivos[m] || 0) + item.motivos[m]); });
      return item;
    });
    ['qtdPedido', 'produzido', 'aProduzir', 'expedido', 'estoque'].forEach(function (c) { tot[c] = arred(tot[c]); });
    tot.perdasTotal = total(tot.perdas);
    tot.perdaPct = pct(tot.perdasTotal, tot.produzido);
    tot.atendidoPct = pct(tot.produzido, tot.qtdPedido);

    var c = (base.pedidos_comerciais || {})[id] || {};
    return {
      pedidoId: id, cliente: c.cliente || (pedidos[chaves[0]] || {}).cliente || '',
      dataPedido: c.dataPedido || '', numeroCliente: c.numeroPedidoCliente || '',
      previsaoEntrega: c.previsaoComercialEntrega || '', statusComercial: c.status || '',
      itens: itens, totais: tot
    };
  }

  // CSV (separador ;, padrão do Excel em pt-BR): uma linha por lote, com as
  // colunas do item repetidas -- abre pronto para filtrar/dinâmica.
  function csv(rel) {
    if (!rel) return '';
    var tipos = Object.keys(rel.totais.perdas).sort();
    var num = function (v) { return v == null || v === '' ? '' : String(arred(v)).replace('.', ','); };
    var esc = function (v) { var s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var cab = ['Pedido', 'Cliente', 'SKU', 'Produto', 'Qtd pedido', 'Produzido item', 'A produzir', 'Expedido item', 'Em estoque item',
      'Lote', 'Status OP', 'Linha', 'Planejado', 'Produzido lote', 'Expedido lote', 'Em estoque lote']
      .concat(tipos.map(function (t) { return 'Perda ' + t; }), ['Perdas total lote', '% perda s/ produzido']);
    var linhas = [cab.map(esc).join(';')];
    rel.itens.forEach(function (it) {
      var base = [rel.pedidoId, rel.cliente, it.sku, it.produto, num(it.qtdPedido), num(it.produzido), num(it.aProduzir), num(it.expedido), num(it.estoque)];
      var ls = it.lotes.length ? it.lotes : [null];
      ls.forEach(function (l) {
        var cols = l
          ? [l.lote, l.status, l.linha, num(l.planejado), num(l.produzido), num(l.expedido), num(l.estoque)]
            .concat(tipos.map(function (t) { return num(l.perdas[t] || 0); }), [num(l.perdasTotal), num(l.perdaPct)])
          : ['', '', '', '', '', '', ''].concat(tipos.map(function () { return ''; }), ['', '']);
        linhas.push(base.concat(cols).map(esc).join(';'));
      });
    });
    return linhas.join('\r\n');
  }

  return { listarPedidos: listarPedidos, montar: montar, perdasDoLote: perdasDoLote, csv: csv };
});
