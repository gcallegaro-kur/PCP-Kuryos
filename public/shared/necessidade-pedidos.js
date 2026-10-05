/* O que comprar para atender o pedido X (e/ou Y) -- 01/10/2026.

   Pedido do usuário: "deixar mais dinâmico, visual, fácil e didático a parte
   para entender o que precisa ser comprado para atender o pedido x ou y".

   Puro e só leitura. Não refaz a conta de necessidade: usa a MESMA
   `explodirMateriaisNecessarios` da Emissão de OP, do "Solicitar Compra" e do
   MRP (injetada em `fn`), para que um ajuste feito lá chegue aqui.

   A diferença para o MRP é a pergunta: o MRP olha TODOS os pedidos abertos por
   semana; aqui a pessoa escolhe 1 ou mais pedidos e vê, material a material,
   de onde cada peça vem:
     1. estoque livre        (o que já está na casa e não é de outra OP)
     2. a caminho            (PC enviado ao fornecedor, ainda não recebido)
     3. em andamento         (solicitação pendente/aprovada ou PC ainda aberto)
     4. falta comprar        (o que sobra: é isto que vira solicitação)
   Quando vários pedidos disputam o mesmo material, o estoque é entregue na
   ORDEM DE ATENDIMENTO (entrega do PCP, depois prioridade, depois número):
   quem vem antes leva primeiro, e a tela mostra quem fica descoberto.

   Regras de dono (as mesmas do restante do app): estoque ou remessa do
   cliente cobre só o pedido DELE; o estoque geral da Kuryos cobre qualquer um.
   O que as OPs JÁ EMITIDAS destes mesmos pedidos reservaram (empenho) não é
   subtraído: é a própria necessidade deles, já separada. O empenho das OPs de
   OUTROS pedidos é.

   Testado em run_necessidade_pedidos_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NecessidadePedidos = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function txt(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function arred(v) { return Math.round(num(v) * 1000) / 1000; }
  function norm(s) { return txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' '); }
  function chaveMat(c) { return txt(c).replace(/[.#$\[\]\/]/g, '-'); }

  var ESTADOS = {
    coberto: {rotulo: 'Coberto pelo estoque', ordem: 3},
    caminho: {rotulo: 'Coberto, aguardando chegada', ordem: 2},
    andamento: {rotulo: 'Já em compra', ordem: 1},
    falta: {rotulo: 'Falta comprar', ordem: 0}
  };

  /* Pedidos que ainda precisam de material: aberto e com saldo a produzir. */
  function pedidosAbertos(pedidos, concluido) {
    var out = [];
    Object.keys(pedidos || {}).forEach(function(k) {
      var p = pedidos[k];
      if (!p || !p.sku) return;
      if (concluido && concluido(p)) return;
      var saldo = num(p.qtdTotal) - num(p.produzido);
      if (!(saldo > 0)) return;
      out.push({
        key: k, id: txt(p.id) || k.split('__')[0], sku: txt(p.sku), produto: txt(p.produto), cliente: txt(p.cliente),
        saldo: saldo, qtdTotal: num(p.qtdTotal), produzido: num(p.produzido), status: txt(p.status),
        prioridade: p.priority != null && p.priority !== '' ? num(p.priority) : null,
        entrega: txt(p.dataEntregaPcp).slice(0, 10) || ''
      });
    });
    return ordemAtendimento(out);
  }

  /* Entrega do PCP primeiro (sem data vai depois), depois prioridade, depois número. */
  function ordemAtendimento(lista) {
    return lista.slice().sort(function(a, b) {
      if (a.entrega && b.entrega && a.entrega !== b.entrega) return a.entrega < b.entrega ? -1 : 1;
      if (!!a.entrega !== !!b.entrega) return a.entrega ? -1 : 1;
      var pa = a.prioridade == null ? 1e9 : a.prioridade, pb = b.prioridade == null ? 1e9 : b.prioridade;
      if (pa !== pb) return pa - pb;
      return String(a.id).localeCompare(String(b.id), 'pt-BR', {numeric: true}) || String(a.sku).localeCompare(String(b.sku));
    });
  }

  function recebimentosPorMaterial(pedidosCompra, PE) {
    var out = {};
    Object.keys(pedidosCompra || {}).forEach(function(k) {
      var pc = pedidosCompra[k];
      if (!pc || !pc.itens) return;
      var enviado = pc.status === 'ENVIADO' || pc.status === 'RECEBIDO_PARCIAL', aberto = pc.status === 'ABERTO';
      if (!enviado && !aberto) return;
      Object.keys(pc.itens).forEach(function(ik) {
        var it = pc.itens[ik];
        if (!it || !txt(it.materialCodigo)) return;
        var pedida = num(it.qtdEmUnidadeEstoque) > 0 ? num(it.qtdEmUnidadeEstoque) : (num(it.qtdCotada) > 0 ? num(it.qtdCotada) : num(it.qtd));
        var falta = pedida - num(it.qtdRecebida);
        if (!(falta > 0)) return;
        var remessa = PE && PE.propriedadeDoPC && PE.propriedadeDoPC(pc) === PE.CLIENTE && it.vinculo && it.vinculo.clienteKey;
        (out[it.materialCodigo] = out[it.materialCodigo] || []).push({
          pc: pc.numeroFormatado || k, qtd: falta, aberto: aberto, remessaCliente: remessa || null,
          data: txt(pc.dataPrevistaEntrega || (pc.agendamento && pc.agendamento.dataAgendada)).slice(0, 10) || '',
          fornecedor: txt(pc.fornecedorNome)
        });
      });
    });
    Object.keys(out).forEach(function(c) {
      out[c].sort(function(a, b) { return (a.data || '9999') < (b.data || '9999') ? -1 : 1; });
    });
    return out;
  }

  function solicitadoPorMaterial(solicitacoes) {
    var out = {};
    Object.keys(solicitacoes || {}).forEach(function(k) {
      var sc = solicitacoes[k];
      // CONSOLIDADA já virou cotação/PC (entra pelo PC); rejeitada não conta.
      if (!sc || (sc.status !== 'PENDENTE' && sc.status !== 'APROVADA')) return;
      Object.keys(sc.itens || {}).forEach(function(ik) {
        var it = sc.itens[ik]; if (!it || !txt(it.materialCodigo)) return;
        (out[it.materialCodigo] = out[it.materialCodigo] || []).push({sc: sc.numeroFormatado || k, qtd: num(it.qtd), status: sc.status});
      });
    });
    return out;
  }

  /* d = {pedidos, selecionados:[keys], produtos, formulas, bom, materiais, estoque, ops,
          pedidosCompra, solicitacoes, fn:{explodir, melhorFormula, chaveVersao, semControle},
          PE:PropriedadeEstoque, hoje}
     Devolve {pedidos, materiais, resumo, ordem}. */
  function calcular(d) {
    var dados = d || {}, fn = dados.fn || {}, PE = dados.PE;
    var todos = dados.pedidos || {}, estoque = dados.estoque || {}, materiais = dados.materiais || {}, ops = dados.ops || {};
    var hoje = dados.hoje || new Date().toISOString().slice(0, 10);
    var sel = (dados.selecionados || []).filter(function(k) { return todos[k]; });
    var abertos = pedidosAbertos(Object.fromEntries(sel.map(function(k) { return [k, todos[k]]; })), null);
    // A ordem de atendimento pode ser ajustada à mão (dados.ordem = chaves na ordem desejada).
    if (dados.ordem && dados.ordem.length) {
      abertos.sort(function(x, y) {
        var ix = dados.ordem.indexOf(x.key), iy = dados.ordem.indexOf(y.key);
        return (ix < 0 ? 1e9 : ix) - (iy < 0 ? 1e9 : iy);
      });
    }
    var chavesSel = {}; abertos.forEach(function(p) { chavesSel[p.key] = true; });

    var recebs = recebimentosPorMaterial(dados.pedidosCompra, PE), solic = solicitadoPorMaterial(dados.solicitacoes);

    // 1) Necessidade por pedido (a mesma explosão do restante do app).
    var infoPedidos = [], demanda = {};
    abertos.forEach(function(p) {
      var produto = (dados.produtos || {})[p.sku];
      var achado = fn.melhorFormula ? fn.melhorFormula(p.sku, dados.formulas || {}) : null;
      var info = Object.assign({}, p, {ok: false, erro: '', itens: [], versao: '', semAprovada: false, clienteKey: PE ? (PE.clienteKeyDoSku(p.sku, dados.produtos || {}, null, p.cliente) || null) : null});
      if (!produto) info.erro = 'Produto não encontrado no cadastro.';
      else if (!achado) info.erro = 'Sem Fórmula/BOM cadastrada.';
      else {
        var f = achado.registro;
        var b = (fn.bomDaVersao ? fn.bomDaVersao(dados.bom || {}, p.sku, f.versao) : (dados.bom || {})[fn.chaveVersao(p.sku, f.versao)]) || {itens: {}};
        var calc = fn.explodir(produto, p.saldo, f, b, materiais);
        if (!calc.ok) info.erro = calc.erro;
        else {
          info.ok = true; info.versao = f.versao || ''; info.semAprovada = achado.temAprovada === false;
          calc.itens.forEach(function(it) {
            if (fn.semControle && fn.semControle(it.mpCodigo, materiais)) return;
            info.itens.push({codigo: it.mpCodigo, nome: it.mpNome, qtd: it.quantidade, unidade: it.unidade, origem: it.origem});
            (demanda[it.mpCodigo] = demanda[it.mpCodigo] || []).push({pedido: p.key, qtd: it.quantidade, nome: it.mpNome, unidade: it.unidade, origem: it.origem});
          });
        }
      }
      infoPedidos.push(info);
    });

    // O que as OPs destes mesmos pedidos já reservaram: é necessidade deles, não concorrência.
    function empenhoPorPedido(reg) {
      var m = {};
      Object.keys((reg && reg.empenhos) || {}).forEach(function(opKey) {
        var op = ops[opKey]; var pk = op && (op.skuPedidoKey || op.pedidoKey);
        if (pk && chavesSel[pk]) m[pk] = (m[pk] || 0) + num(reg.empenhos[opKey] && reg.empenhos[opKey].qtdEmpenhada);
      });
      return m;
    }

    // 2) Material a material: aloca estoque e chegadas pedido a pedido, na ordem de atendimento.
    var ordemPedidos = abertos.map(function(p) { return p.key; });
    var linhas = Object.keys(demanda).map(function(cod) {
      var matKey = chaveMat(cod);
      var mat = materiais[matKey] || Object.keys(materiais).map(function(k) { return materiais[k]; }).filter(function(m) { return m && m.mpCodigo === cod; })[0] || {};
      var reg = estoque[matKey] || estoque[cod] || null;
      var dono = PE ? PE.saldoPorDono(reg || {}) : {total: num(reg && reg.saldoAtual), geral: num(reg && reg.saldoAtual), porCliente: {}};
      var reservaPed = empenhoPorPedido(reg);
      var proprio = Object.keys(reservaPed).reduce(function(s, k) { return s + reservaPed[k]; }, 0);
      var empenhadoTotal = Math.max(0, num(reg && reg.saldoEmpenhado));
      // O que as OPs de OUTROS pedidos reservaram sai do estoque geral; o que as OPs DESTES pedidos
      // reservaram fica primeiro com o próprio pedido (nenhum outro pedido da seleção pode levar).
      var geralDisp = Math.max(0, dono.geral - Math.max(0, empenhadoTotal - proprio));
      var reservaAloc = {}, restoReserva = geralDisp;
      ordemPedidos.forEach(function(pk) { var r = Math.min(reservaPed[pk] || 0, restoReserva); reservaAloc[pk] = r; restoReserva -= r; });
      var geralLivre = restoReserva;
      var clientes = {}; Object.keys(dono.porCliente).forEach(function(c) { clientes[c] = Math.max(0, dono.porCliente[c]); });

      var chegadas = (recebs[cod] || []).filter(function(r) { return !r.aberto; }).map(function(r) { return Object.assign({}, r); });
      var emCompra = (recebs[cod] || []).filter(function(r) { return r.aberto; }).map(function(r) { return Object.assign({}, r); })
        .concat((solic[cod] || []).map(function(s) { return {pc: s.sc, qtd: s.qtd, aberto: true, solicitacao: true, data: '', remessaCliente: null}; }));
      var chegCli = {};  // remessa do cliente a caminho, por cliente
      var chegGeral = [];
      chegadas.forEach(function(r) { if (r.remessaCliente) chegCli[r.remessaCliente] = (chegCli[r.remessaCliente] || []).concat([r]); else chegGeral.push(r); });
      var andGeral = emCompra.slice();

      function consumir(lista, quanto) {  // tira `quanto` de uma lista de chegadas, devolve [{ref,qtd,data}]
        var usadas = [];
        for (var i = 0; i < lista.length && quanto > 1e-9; i++) {
          var r = lista[i]; if (!(r.qtd > 1e-9)) continue;
          var u = Math.min(r.qtd, quanto); r.qtd -= u; quanto -= u;
          usadas.push({ref: r.pc, qtd: arred(u), data: r.data || '', solicitacao: !!r.solicitacao});
        }
        return {usadas: usadas, resto: quanto};
      }

      var porPedido = [], totais = {estoque: 0, caminho: 0, andamento: 0, falta: 0, necessario: 0};
      ordemPedidos.forEach(function(pk) {
        (demanda[cod] || []).filter(function(x) { return x.pedido === pk; }).forEach(function(x) {
          var ped = abertos.filter(function(p) { return p.key === pk; })[0];
          var cli = infoPedidos.filter(function(p) { return p.key === pk; })[0].clienteKey;
          var quer = x.qtd, doEstoque = 0, caminho = [], andamento = [];
          // dono primeiro: o estoque do cliente é dele e não serve a mais ninguém.
          if (cli && clientes[cli] > 0) { var u = Math.min(quer, clientes[cli]); clientes[cli] -= u; quer -= u; doEstoque += u; }
          if (quer > 1e-9 && cli && chegCli[cli]) { var c1 = consumir(chegCli[cli], quer); quer = c1.resto; caminho = caminho.concat(c1.usadas); }
          if (quer > 1e-9 && reservaAloc[pk] > 0) { var rv = Math.min(quer, reservaAloc[pk]); reservaAloc[pk] -= rv; quer -= rv; doEstoque += rv; }
          if (quer > 1e-9) { var g = Math.min(quer, geralLivre); geralLivre -= g; quer -= g; doEstoque += g; }
          if (quer > 1e-9) { var c2 = consumir(chegGeral, quer); quer = c2.resto; caminho = caminho.concat(c2.usadas); }
          if (quer > 1e-9) { var c3 = consumir(andGeral, quer); quer = c3.resto; andamento = andamento.concat(c3.usadas); }
          var qCam = caminho.reduce(function(s, c) { return s + c.qtd; }, 0), qAnd = andamento.reduce(function(s, c) { return s + c.qtd; }, 0);
          var ultimaChegada = caminho.reduce(function(m, c) { return c.data && c.data > m ? c.data : m; }, '');
          porPedido.push({
            pedido: pk, id: ped.id, necessario: arred(x.qtd), doEstoque: arred(doEstoque), caminho: caminho, qCaminho: arred(qCam),
            andamento: andamento, qAndamento: arred(qAnd), falta: arred(Math.max(0, quer)), chegaEm: ultimaChegada,
            atrasa: !!(ultimaChegada && ped.entrega && ultimaChegada > ped.entrega),
            semData: caminho.some(function(c) { return !c.data; })
          });
          totais.necessario += x.qtd; totais.estoque += doEstoque; totais.caminho += qCam; totais.andamento += qAnd; totais.falta += Math.max(0, quer);
        });
      });
      Object.keys(totais).forEach(function(k) { totais[k] = arred(totais[k]); });
      var estado = totais.falta > 0.0005 ? 'falta' : totais.andamento > 0.0005 ? 'andamento' : totais.caminho > 0.0005 ? 'caminho' : 'coberto';
      var base = demanda[cod][0];
      var concorrentes = Object.keys(demanda[cod].reduce(function(m, x) { m[x.pedido] = 1; return m; }, {}));
      return {
        codigo: cod, nome: txt(base.nome) || txt(mat.mpNome) || cod, unidade: txt(base.unidade) || txt(mat.unidade) || 'un',
        tipo: txt(mat.tipo) || (/^[A-Z]+/.exec(cod) || [''])[0], origem: base.origem,
        estado: estado, necessario: totais.necessario, doEstoque: totais.estoque, caminho: totais.caminho, andamento: totais.andamento, falta: totais.falta,
        porPedido: porPedido, concorrentes: concorrentes.length,
        estoque: {atual: arred(dono.total), empenhado: arred(empenhadoTotal), proprio: arred(proprio), geralLivre: arred(geralDisp), porCliente: dono.porCliente},
        // Base de saldo que não dá para confiar (Dia D em andamento): a tela avisa em vez de fingir certeza.
        semRegistro: !reg, negativo: num(reg && reg.saldoAtual) < 0, contado: !!(reg && reg.ajustes),
        chegadas: (recebs[cod] || []).map(function(r) { return {pc: r.pc, qtd: arred(r.qtd), data: r.data, aberto: !!r.aberto, fornecedor: r.fornecedor, remessaCliente: r.remessaCliente}; })
      };
    });
    linhas.sort(function(a, b) { return ESTADOS[a.estado].ordem - ESTADOS[b.estado].ordem || b.falta - a.falta || String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });

    // 3) Quanto de cada pedido está coberto, e o que o trava.
    infoPedidos.forEach(function(p) {
      var meus = [];
      linhas.forEach(function(l) { l.porPedido.forEach(function(pp) { if (pp.pedido === p.key) meus.push({l: l, pp: pp}); }); });
      p.materiais = meus.length;
      p.cobertos = meus.filter(function(m) { return m.pp.falta <= 0.0005; }).length;
      p.prontoJa = meus.filter(function(m) { return m.pp.doEstoque >= m.pp.necessario - 0.0005; }).length;
      p.faltam = meus.filter(function(m) { return m.pp.falta > 0.0005; }).map(function(m) { return {codigo: m.l.codigo, nome: m.l.nome, unidade: m.l.unidade, falta: m.pp.falta, necessario: m.pp.necessario}; })
        .sort(function(a, b) { return b.falta / (b.necessario || 1) - a.falta / (a.necessario || 1); });
      p.pctCoberto = p.materiais ? Math.round(p.cobertos / p.materiais * 100) : 0;
      p.pctProntoJa = p.materiais ? Math.round(p.prontoJa / p.materiais * 100) : 0;
      p.chegaTarde = meus.filter(function(m) { return m.pp.atrasa; }).length;
    });

    var res = {materiais: linhas.length, coberto: 0, caminho: 0, andamento: 0, falta: 0, naoConfiaveis: 0, semFormula: infoPedidos.filter(function(p) { return !p.ok; }).length};
    linhas.forEach(function(l) { res[l.estado]++; if (l.semRegistro || l.negativo) res.naoConfiaveis++; });
    return {pedidos: infoPedidos, materiais: linhas, resumo: res, ordem: ordemPedidos};
  }

  /* Itens para a solicitação de compra: o que ainda FALTA (nada que já esteja em compra). */
  function itensParaSolicitar(resultado) {
    return (resultado.materiais || []).filter(function(l) { return l.falta > 0.0005; }).map(function(l) {
      return {
        materialCodigo: l.codigo, materialNome: l.nome, unidade: l.unidade, qtd: l.falta, necessario: l.necessario,
        obs: 'O que comprar: precisa ' + l.necessario + ', estoque livre ' + l.doEstoque + ', a caminho ' + l.caminho + ', em compra ' + l.andamento + ' → falta ' + l.falta +
          ' (pedidos ' + l.porPedido.filter(function(p) { return p.falta > 0.0005; }).map(function(p) { return p.id; }).join(', ') + ')'
      };
    });
  }

  return {ESTADOS: ESTADOS, pedidosAbertos: pedidosAbertos, ordemAtendimento: ordemAtendimento, calcular: calcular, itensParaSolicitar: itensParaSolicitar, recebimentosPorMaterial: recebimentosPorMaterial, solicitadoPorMaterial: solicitadoPorMaterial, norm: norm};
});
