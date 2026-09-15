/* Propriedade do estoque: de quem é o material e para quem ele foi comprado.

   Pedido do usuário (2026-09-15). O cadastro do material é amplo (a mesma
   válvula serve a vários clientes), então o dono NÃO pode vir dele. Quem define
   é o Pedido de Compra -- a Logística, na doca, não sabe a qual cliente nem a
   qual pedido o material se refere.

   Duas coisas diferentes, que não se misturam:
   - PROPRIEDADE (de quem é): definida no PC.
       Compra da Kuryos        -> KURYOS, sempre.
       Remessa do cliente      -> CLIENTE, sempre.
       Remessa de terceiro     -> quem compra escolhe.
   - DESTINO (para quem/qual pedido): por item do PC, cliente obrigatório e ao
     menos um pedido, podendo ser vários.

   Regras de uso decididas pelo usuário:
   - Material da Kuryos pode ser usado por qualquer OP (estoque geral), mesmo
     tendo sido comprado para o pedido de outro cliente.
   - Material do cliente só serve a produtos/pedidos/demandas DELE.

   No saldo agregado (`estoque/{material}`), `saldoAtual` continua sendo o
   TOTAL físico -- todas as telas e o inventário seguem lendo o mesmo número.
   A parte de cada cliente fica em `porCliente/{clienteKey}/saldoAtual`; o
   geral da Kuryos é total − soma dos clientes. Se uma OP de outro cliente
   consumir mais do que o geral tem, o geral fica negativo: é o sinal visível
   de que material de cliente foi usado para quem não devia.

   Módulo puro. `functions/propriedade_estoque.js` é cópia byte a byte (o
   recebimento roda no servidor) e o teste falha se divergirem. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PropriedadeEstoque = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var KURYOS = 'KURYOS';
  var CLIENTE = 'CLIENTE';
  var VISTA_PROPRIEDADE = 'PROPRIEDADE';   // estoque de propriedade do cliente
  var VISTA_DESTINADO = 'DESTINADO';       // destinado ao cliente, de posse da Kuryos

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function arred(v) { return Math.round(v * 1000) / 1000; }
  function chaveSegura(s) { return String(s == null ? '' : s).replace(/[.#$[\]\/]/g, '-'); }
  function normNome(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim();
  }
  // "0020" e "20" são o mesmo pedido (a base tem os dois formatos).
  function normPedidoId(id) {
    var s = String(id == null ? '' : id).trim();
    return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s.toUpperCase();
  }

  // ── Proprietário ────────────────────────────────────────────────────
  // Natureza -> proprietário fixo, ou null quando precisa ser escolhido.
  // PC sem natureza é compra (todo PC de cotação nasce assim).
  function proprietarioDaNatureza(natureza) {
    var n = natureza || 'COMPRA_KURYOS';
    if (n === 'COMPRA_KURYOS') return KURYOS;
    if (n === 'REMESSA_CLIENTE') return CLIENTE;
    return null;
  }

  function propriedadeDoPC(pc) {
    var fixo = proprietarioDaNatureza(pc && pc.naturezaMovimentacao);
    if (fixo) return fixo;
    var t = pc && pc.propriedade && pc.propriedade.tipo;
    return t === KURYOS || t === CLIENTE ? t : null;
  }

  function vinculoValido(v) {
    return !!(v && v.clienteKey && Array.isArray(v.pedidos) && v.pedidos.some(function(p) { return p && String(p).trim(); }));
  }

  /* O PC está pronto para ser recebido? Proprietário definido e cada item com
     cliente + pedido. Devolve pendências legíveis (a Logística mostra; o
     servidor recusa o recebimento com a mesma lista). */
  function validarVinculoPC(pc) {
    var pendencias = [];
    if (!pc) return {ok: false, pendencias: ['Pedido de Compra não encontrado.']};
    if (!propriedadeDoPC(pc)) pendencias.push('Defina de quem é o material (Kuryos ou cliente).');
    var itens = pc.itens || {};
    var chaves = Object.keys(itens);
    if (!chaves.length) pendencias.push('O pedido não tem itens.');
    chaves.forEach(function(k) {
      var it = itens[k] || {};
      if (!vinculoValido(it.vinculo)) {
        pendencias.push('Item ' + (it.materialCodigo || k) + ': informe o cliente e ao menos um pedido.');
      }
    });
    return {ok: pendencias.length === 0, pendencias: pendencias};
  }

  /* Campos gravados no lote do recebimento. Snapshot: mudar o PC depois não
     muda de quem é um lote que já entrou. */
  function camposDoLote(pc, item) {
    var tipo = propriedadeDoPC(pc);
    var v = (item && item.vinculo) || {};
    var pedidos = (v.pedidos || []).map(function(p) { return String(p).trim(); }).filter(Boolean);
    return {
      propriedade: {
        tipo: tipo,
        clienteKey: tipo === CLIENTE ? (v.clienteKey || null) : null,
        clienteNome: tipo === CLIENTE ? (v.clienteNome || null) : null
      },
      destino: {clienteKey: v.clienteKey || null, clienteNome: v.clienteNome || null, pedidos: pedidos}
    };
  }

  // Dono de um lote. Lote sem o campo (anterior a esta regra) é da Kuryos.
  function donoDoLote(lote) {
    var p = lote && lote.propriedade;
    if (p && p.tipo === CLIENTE && p.clienteKey) return {tipo: CLIENTE, clienteKey: p.clienteKey, clienteNome: p.clienteNome || null};
    return {tipo: KURYOS, clienteKey: null, clienteNome: null};
  }

  // Um consumidor (cliente da OP; null = sem cliente conhecido) pode usar o lote?
  function loteUtilizavelPor(lote, clienteKeyConsumidor) {
    var dono = donoDoLote(lote);
    if (dono.tipo === KURYOS) return true;
    return !!clienteKeyConsumidor && dono.clienteKey === clienteKeyConsumidor;
  }

  // Ordem de consumo: primeiro o material do próprio cliente, depois o geral.
  function prioridadeLote(lote, clienteKeyConsumidor) {
    var dono = donoDoLote(lote);
    return dono.tipo === CLIENTE && dono.clienteKey === clienteKeyConsumidor ? 0 : 1;
  }

  // As duas vistas do Estoque.
  function loteNaVista(lote, clienteKey, vista) {
    if (!clienteKey) return true;
    var dono = donoDoLote(lote);
    if (vista === VISTA_DESTINADO) {
      var d = lote && lote.destino;
      return dono.tipo === KURYOS && !!d && d.clienteKey === clienteKey;
    }
    return dono.tipo === CLIENTE && dono.clienteKey === clienteKey;
  }

  // ── Cliente de um SKU / pedido / OP ─────────────────────────────────
  // Pedido e OP guardam só o NOME do cliente, que não bate com o cadastro
  // ("MISS RÔSE"); o produto tem `clienteKey` válido (381 de 384 na base).
  function produtoDoSku(sku, produtos) {
    produtos = produtos || {};
    if (!sku) return null;
    var s = String(sku);
    return produtos[s] || produtos[chaveSegura(s)] ||
      produtos[s.replace(/\s*-\s*\d+$/, '')] || null;   // variante "KUBPBA01 - 2"
  }

  /* Nome -> cliente. 1º o cadastro de clientes; 2º o nome curto que os
     PRODUTOS usam ("SEUNOURA", enquanto o cadastro diz "SEUNOURA BEAUTY
     LTDA") -- só quando todos os produtos com esse nome apontam para o mesmo
     cliente. Medido na base: 11 nomes de pedido não batem com o cadastro e
     o pedido 26 tem SKUs sem produto; é essa ponte que os resolve. */
  function clienteKeyPorNome(nome, clientes, produtos) {
    var alvo = normNome(nome);
    if (!alvo) return null;
    var achado = null;
    Object.keys(clientes || {}).some(function(k) {
      var c = clientes[k] || {};
      if (normNome(c.nome) === alvo || normNome(c.nomeFantasia) === alvo) { achado = k; return true; }
      return false;
    });
    if (achado) return achado;
    var chaves = {};
    Object.keys(produtos || {}).forEach(function(k) {
      var p = produtos[k] || {};
      if (p.clienteKey && normNome(p.cliente) === alvo) chaves[p.clienteKey] = 1;
    });
    var lista = Object.keys(chaves);
    return lista.length === 1 ? lista[0] : null;
  }

  function clienteKeyDoSku(sku, produtos, clientes, nomeCliente) {
    var prod = produtoDoSku(sku, produtos);
    if (prod && prod.clienteKey) return prod.clienteKey;
    return clienteKeyPorNome(nomeCliente || (prod && prod.cliente), clientes, produtos);
  }

  function pedidoConcluido(p) {
    var st = String((p && p.status) || '').toLowerCase().trim();
    var man = String((p && p.statusManual) || '').toLowerCase().trim();
    return st.indexOf('conclu') === 0 || man === 'encerrado';
  }

  /* Pedidos (agrupados por número) que têm linha de SKU do cliente. `pedidos`
     é o nó /pedidos (uma linha por SKU). Pedido com linhas de dois clientes
     aparece para os dois, cada um só com as próprias linhas. */
  function pedidosDoCliente(clienteKey, pedidos, produtos, clientes, opts) {
    opts = opts || {};
    if (!clienteKey) return [];
    var grupos = {}, ordem = [];
    Object.keys(pedidos || {}).forEach(function(chave) {
      var p = pedidos[chave];
      if (!p) return;
      if (clienteKeyDoSku(p.sku, produtos, clientes, p.cliente) !== clienteKey) return;
      var id = String(p.parentPedidoId || p.id || chave);
      var g = normPedidoId(id);
      if (!grupos[g]) { grupos[g] = {id: id, cliente: p.cliente || '', linhas: [], aberto: false}; ordem.push(g); }
      // Exibe o número no formato com zeros quando existir.
      if (id.length > grupos[g].id.length) grupos[g].id = id;
      grupos[g].linhas.push({chave: chave, sku: p.sku || '', produto: p.produto || '', concluido: pedidoConcluido(p)});
      if (!pedidoConcluido(p)) grupos[g].aberto = true;
    });
    return ordem.map(function(g) { return grupos[g]; })
      .filter(function(g) { return opts.incluirConcluidos || g.aberto; })
      .sort(function(a, b) {
        if (a.aberto !== b.aberto) return a.aberto ? -1 : 1;
        return b.id.localeCompare(a.id, 'pt-BR', {numeric: true});
      });
  }

  /* Vínculo sugerido para um item de PC que nasceu de Solicitação de Compra
     gerada a partir de pedido(s). Só sugere quando todos os pedidos de origem
     são de UM cliente; senão devolve null e quem compra escolhe. */
  function vinculoSugeridoDasChavesPedido(chavesPedido, pedidos, produtos, clientes) {
    var clienteKey = null, ids = [], ambiguo = false;
    (chavesPedido || []).forEach(function(chave) {
      var p = (pedidos || {})[chave];
      if (!p) return;
      var c = clienteKeyDoSku(p.sku, produtos, clientes, p.cliente);
      if (!c) return;
      if (clienteKey && c !== clienteKey) ambiguo = true;
      clienteKey = clienteKey || c;
      var id = String(p.parentPedidoId || p.id || chave);
      if (ids.map(normPedidoId).indexOf(normPedidoId(id)) < 0) ids.push(id);
    });
    if (!clienteKey || ambiguo || !ids.length) return null;
    var cli = (clientes || {})[clienteKey] || {};
    return {clienteKey: clienteKey, clienteNome: cli.nome || null, pedidos: ids};
  }

  // ── Saldo agregado por dono ─────────────────────────────────────────
  function saldoPorDono(estoqueItem) {
    var e = estoqueItem || {};
    var total = num(e.saldoAtual);
    var porCliente = {}, somaClientes = 0;
    Object.keys(e.porCliente || {}).forEach(function(k) {
      var s = num(e.porCliente[k] && e.porCliente[k].saldoAtual);
      if (!s) return;
      porCliente[k] = arred(s);
      somaClientes += s;
    });
    return {total: arred(total), geral: arred(total - somaClientes), porCliente: porCliente};
  }

  /* Aplica um movimento no nó estoque/{material} DENTRO de uma transaction.
     delta < 0 (consumo/perda) com consumidor conhecido: sai primeiro da parte
     do cliente, até zerá-la; o resto sai do geral. delta > 0 com dono cliente:
     entra na parte dele. Devolve quanto foi de cada lado (para o movimento). */
  function aplicarMovimentoAgregado(atual, delta, opts) {
    opts = opts || {};
    atual.saldoAtual = arred(num(atual.saldoAtual) + delta);
    var doCliente = 0, clienteKey = null;
    if (delta < 0 && opts.clienteKeyConsumidor) {
      clienteKey = opts.clienteKeyConsumidor;
      var parte = atual.porCliente && atual.porCliente[clienteKey];
      var disponivel = Math.max(0, num(parte && parte.saldoAtual));
      doCliente = Math.min(-delta, disponivel);
      if (doCliente > 0) parte.saldoAtual = arred(num(parte.saldoAtual) - doCliente);
    } else if (delta > 0 && opts.proprietarioClienteKey) {
      clienteKey = opts.proprietarioClienteKey;
      atual.porCliente = atual.porCliente || {};
      var p = atual.porCliente[clienteKey] = atual.porCliente[clienteKey] || {saldoAtual: 0};
      p.saldoAtual = arred(num(p.saldoAtual) + delta);
      if (opts.clienteNome) p.clienteNome = opts.clienteNome;
      doCliente = delta;
    } else if (delta < 0 && opts.proprietarioClienteKey) {
      // Estorno de entrada de cliente (cancelamento/devolução/ajuste).
      clienteKey = opts.proprietarioClienteKey;
      atual.porCliente = atual.porCliente || {};
      var q = atual.porCliente[clienteKey] = atual.porCliente[clienteKey] || {saldoAtual: 0};
      q.saldoAtual = arred(num(q.saldoAtual) + delta);
      doCliente = -delta;
    }
    return {clienteKey: clienteKey, doCliente: arred(doCliente), geral: arred(Math.abs(delta) - doCliente)};
  }

  /* ── MRP por dono ──
     Material do cliente cobre só a demanda do cliente (estoque dele + remessas
     dele a caminho). O que sobra de demanda vai para o plano geral, contra o
     estoque da Kuryos e os PCs de compra -- material da Kuryos atende todos.
     Sobra de material do cliente NÃO abate a demanda de outros.

     demandas:     [{data, qtd, clienteKey, ...}]
     recebimentos: [{data, qtd, proprietarioClienteKey|null, ...}]
     disponivelGeral: total − partes dos clientes − empenho (conservador: o
       empenho, que não sabe o dono, sai todo do geral).
     Cobertura do cliente em ordem de data (com data primeiro, backlog depois);
     não confere se a remessa chega antes da data -- aproximação declarada. */
  function repartirMrpPorDono(estoqueItem, empenhado, demandas, recebimentos) {
    var s = saldoPorDono(estoqueItem);
    var suprimento = {};
    Object.keys(s.porCliente).forEach(function(c) { suprimento[c] = {estoque: Math.max(0, s.porCliente[c]), transito: 0}; });
    var recebimentosGerais = [];
    (recebimentos || []).forEach(function(r) {
      if (r && r.proprietarioClienteKey) {
        var c = r.proprietarioClienteKey;
        suprimento[c] = suprimento[c] || {estoque: 0, transito: 0};
        suprimento[c].transito += num(r.qtd);
      } else recebimentosGerais.push(r);
    });

    var porCliente = {}, demandasGerais = [];
    (demandas || []).forEach(function(d) {
      if (d && d.clienteKey && suprimento[d.clienteKey]) (porCliente[d.clienteKey] = porCliente[d.clienteKey] || []).push(d);
      else demandasGerais.push(d);
    });

    var cobertura = [];
    Object.keys(suprimento).forEach(function(c) {
      var sup = suprimento[c];
      var restante = sup.estoque + sup.transito;
      var lista = (porCliente[c] || []).slice().sort(function(a, b) {
        if (a.data && b.data) return a.data < b.data ? -1 : (a.data > b.data ? 1 : 0);
        return a.data ? -1 : (b.data ? 1 : 0);
      });
      var demanda = 0, coberto = 0;
      lista.forEach(function(d) {
        var q = num(d.qtd);
        demanda += q;
        var usa = Math.min(q, Math.max(0, restante));
        restante -= usa;
        coberto += usa;
        if (q - usa > 0.0005) demandasGerais.push(Object.assign({}, d, {qtd: arred(q - usa), parcialCliente: true}));
      });
      cobertura.push({clienteKey: c, estoque: arred(sup.estoque), transito: arred(sup.transito),
        demanda: arred(demanda), coberto: arred(coberto), sobra: arred(Math.max(0, restante))});
    });

    return {
      disponivelGeral: arred(s.geral - num(empenhado)),
      demandasGerais: demandasGerais,
      recebimentosGerais: recebimentosGerais,
      cobertura: cobertura
    };
  }

  return {
    KURYOS: KURYOS, CLIENTE: CLIENTE, VISTA_PROPRIEDADE: VISTA_PROPRIEDADE, VISTA_DESTINADO: VISTA_DESTINADO,
    proprietarioDaNatureza: proprietarioDaNatureza, propriedadeDoPC: propriedadeDoPC, vinculoValido: vinculoValido,
    validarVinculoPC: validarVinculoPC, camposDoLote: camposDoLote, donoDoLote: donoDoLote,
    loteUtilizavelPor: loteUtilizavelPor, prioridadeLote: prioridadeLote, loteNaVista: loteNaVista,
    produtoDoSku: produtoDoSku, clienteKeyDoSku: clienteKeyDoSku, clienteKeyPorNome: clienteKeyPorNome,
    normPedidoId: normPedidoId, pedidoConcluido: pedidoConcluido, pedidosDoCliente: pedidosDoCliente,
    vinculoSugeridoDasChavesPedido: vinculoSugeridoDasChavesPedido,
    saldoPorDono: saldoPorDono, aplicarMovimentoAgregado: aplicarMovimentoAgregado,
    repartirMrpPorDono: repartirMrpPorDono
  };
});
