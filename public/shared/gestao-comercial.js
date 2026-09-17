/* Gestão Comercial: carteira, clientes, prazos, faturamento e preços de venda.

   Pedido do usuário (2026-09-16): "uma tela mais gerencial de pedidos, onde
   pudesse ver tabela de preços, condições de pedidos, análise de clientes".
   Motor puro (sem Firebase): a tela e os testes passam o banco lido.

   O que a base permite -- e o que não, medido em 2026-09-16:
   - Volume é bom: 361 itens de pedido, 69 pedidos comerciais com data,
     338 cargas com data, OPs com início real.
   - Preço quase não existe: 0 de 385 produtos com preço, 2 de 69 pedidos com
     valor. Todo número em R$ vem com a COBERTURA ao lado (quanto do volume
     tinha preço) -- um faturamento de 5% dos pedidos não pode parecer total.
   - A saída não é confiável no histórico: ~495 mil unidades expedidas sem
     vínculo com pedido (planilha legado). Item produzido, antigo e sem
     nenhuma saída registrada provavelmente foi entregue sem baixa: vira
     A_CONFERIR e fica FORA da carteira, com volume próprio. Somá-lo à
     carteira inflaria o saldo com mercadoria que já saiu.

   Estados do item: FECHADO (encerrado/cancelado), ATENDIDO (expedido >= 95%,
   a mesma tolerância de pedidoStatus em pedidos.html), A_CONFERIR, ABERTO.

   Preço de venda: precos_venda/{sanitizeKey(sku)}/vigencias/{id} =
   {preco, inicio: 'AAAA-MM-DD', motivo, criadoEm, criadoPor}. Vale a vigência
   de maior início <= data. O preço do PEDIDO vence a tabela (é o negociado);
   a tabela só preenche item sem preço e serve de régua para o desvio. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./conciliacao-pedidos.js'));
  else root.GestaoComercial = factory(root.ConciliacaoPedidos);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(ConciliacaoPedidos) {
  'use strict';

  var TOLERANCIA_ATENDIDO = 0.95;
  var DIAS_A_CONFERIR = 60;
  // Pedido aberto, antigo e sem nenhum movimento (OP, apontamento, saída)
  // recente: provavelmente saldo morto do legado. Continua na carteira, mas
  // aparece separado para revisão -- somado sem aviso, parece demanda real.
  var DIAS_PARADO = 90;
  var IDADE_MIN_PARADO = 120;

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function arred(v, casas) { var f = Math.pow(10, casas == null ? 2 : casas); return Math.round(n(v) * f) / f; }
  function texto(v) { return String(v == null ? '' : v); }
  function norm(v) {
    return texto(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function sanitizeKey(str) {
    if (!str) return '';
    return String(str).trim().replace(/[./[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60);
  }
  function normChave(k) {
    var partes = texto(k).split('__');
    if (partes.length < 2) return texto(k);
    var id = /^\d+$/.test(partes[0]) ? String(parseInt(partes[0], 10)) : partes[0];
    return id + '__' + partes.slice(1).join('__');
  }
  function normId(id) { var s = texto(id).trim(); return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s; }
  function dataValida(d) { return /^\d{4}-\d{2}-\d{2}$/.test(texto(d).slice(0, 10)) ? texto(d).slice(0, 10) : null; }
  function ms(d) { var p = d.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function dias(de, ate) { return (de && ate) ? Math.round((ms(ate) - ms(de)) / 86400000) : null; }
  function somarDias(d, k) { var x = new Date(ms(d) + k * 86400000); return x.toISOString().slice(0, 10); }
  // Prazo negativo = data do pedido registrada depois do evento (pedido
  // cadastrado no sistema depois de já produzido/entregue). Não é prazo.
  function prazo(de, ate) { var d = dias(de, ate); return d == null || d < 0 ? null : d; }
  function mediana(lista) {
    var v = lista.filter(function(x) { return x != null && isFinite(x); }).sort(function(a, b) { return a - b; });
    if (!v.length) return null;
    var m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  function ultimosMeses(hoje, qtd) {
    var ano = +hoje.slice(0, 4), mes = +hoje.slice(5, 7), out = [];
    for (var i = qtd - 1; i >= 0; i--) {
      var d = new Date(Date.UTC(ano, mes - 1 - i, 1));
      out.push(d.toISOString().slice(0, 7));
    }
    return out;
  }

  // ── Preço de venda ───────────────────────────────────────────────────
  function vigencias(precosVenda, sku) {
    var no = (precosVenda || {})[sanitizeKey(sku)] || {};
    var v = no.vigencias || {};
    return Object.keys(v).map(function(id) { return Object.assign({id: id}, v[id]); })
      .filter(function(x) { return dataValida(x.inicio) && n(x.preco) > 0; })
      .sort(function(a, b) { return a.inicio.localeCompare(b.inicio) || texto(a.criadoEm).localeCompare(texto(b.criadoEm)); });
  }
  function precoVigente(precosVenda, sku, data) {
    var lista = vigencias(precosVenda, sku), achado = null;
    lista.forEach(function(x) { if (x.inicio <= data) achado = x; });
    return achado;
  }
  // Nova vigência: validação pura (a tela grava).
  function validarVigencia(precosVenda, sku, preco, inicio) {
    var erros = [];
    if (!sku) erros.push('SKU não informado.');
    if (!(n(preco) > 0)) erros.push('Informe um preço maior que zero.');
    if (!dataValida(inicio)) erros.push('Informe a data de início da vigência.');
    if (!erros.length && vigencias(precosVenda, sku).some(function(x) { return x.inicio === inicio; })) {
      erros.push('Já existe preço com início em ' + inicio.split('-').reverse().join('/') + '. Use outra data.');
    }
    return erros;
  }

  // ── Clientes ─────────────────────────────────────────────────────────
  function indiceClientes(clientes, produtos) {
    var porNome = {}, porCodigo = {};
    Object.keys(clientes || {}).forEach(function(k) {
      var c = clientes[k] || {};
      if (c.nome) porNome[norm(c.nome)] = k;
      if (c.codigo) porCodigo[norm(c.codigo)] = k;
    });
    return function(nome, clienteKey, sku) {
      if (clienteKey && clientes[clienteKey]) return clienteKey;
      var porN = porNome[norm(nome)];
      if (porN) return porN;
      var prod = sku && (produtos || {})[sanitizeKey(sku)];
      if (prod && prod.clienteKey && clientes[prod.clienteKey]) return prod.clienteKey;
      if (prod && porNome[norm(prod.cliente)]) return porNome[norm(prod.cliente)];
      if (porCodigo[norm(nome)]) return porCodigo[norm(nome)];
      // "ISA BEAUTY" (planilha de expedição) x "ISA BEAUTY MAKEUP" (cadastro):
      // aceita o cadastro que COMEÇA com o nome, desde que seja um só.
      var alvo = norm(nome);
      if (alvo.length >= 4) {
        var prefixo = Object.keys(porNome).filter(function(nm) { return nm.indexOf(alvo + ' ') === 0; });
        if (prefixo.length === 1) return porNome[prefixo[0]];
      }
      return nome ? 'nome:' + alvo : 'sem-cliente';
    };
  }

  function linhaFechada(l, pc) {
    return /encerrad|cancelad/i.test(texto(l.statusManual)) || l.canceladoPorComercial === true ||
      /cancelad/i.test(texto(l.pedidoComercialStatus)) || /cancelad/i.test(texto(pc && pc.status));
  }

  /* raw: {pedidos_comerciais, pedidos, ops, expedicoes_comerciais, estoque_lotes,
     conferencias_pa, solicitacoes_descarte, clientes, produtos, precos_venda}
     hoje: 'AAAA-MM-DD'. */
  function calcular(raw, hoje) {
    raw = raw || {};
    hoje = dataValida(hoje) || new Date().toISOString().slice(0, 10);
    var pcs = raw.pedidos_comerciais || {}, linhas = raw.pedidos || {}, ops = raw.ops || {};
    var clientes = raw.clientes || {}, produtos = raw.produtos || {}, precos = raw.precos_venda || {};
    var resolverCliente = indiceClientes(clientes, produtos);

    var conc = ConciliacaoPedidos.calcular({
      pedidos: linhas, ops: ops, estoque_lotes: raw.estoque_lotes || {},
      expedicoes_comerciais: raw.expedicoes_comerciais || {}, conferencias_pa: raw.conferencias_pa || {},
      solicitacoes_descarte: raw.solicitacoes_descarte || {}
    });

    // Chave normalizada -> chave real (única), igual à Expedição.
    var porNormal = {};
    Object.keys(linhas).forEach(function(k) {
      var nk = normChave(k);
      porNormal[nk] = porNormal[nk] === undefined ? k : null;
    });
    function resolverLinha(k) {
      if (!k) return null;
      if (linhas[k]) return k;
      return porNormal[normChave(k)] || null;
    }
    function pedidoIdDaLinha(k) { var l = linhas[k] || {}; return texto(l.parentPedidoId || l.id || k.split('__')[0]); }

    // Primeiro início real de OP por linha.
    var primeiraOpLinha = {}, ultimaAtividadeLinha = {};
    function atividade(lk, d) { if (lk && d && (!ultimaAtividadeLinha[lk] || d > ultimaAtividadeLinha[lk])) ultimaAtividadeLinha[lk] = d; }
    Object.keys(linhas).forEach(function(k) { atividade(k, dataValida(linhas[k] && linhas[k].ultimoApontamento)); });
    Object.keys(ops).forEach(function(ok) {
      var o = ops[ok];
      if (!o || o.status === 'Cancelado') return;
      var lk = resolverLinha(o.skuPedidoKey);
      var d = dataValida(o.dataInicioReal);
      if (!lk || !d) return;
      if (!primeiraOpLinha[lk] || d < primeiraOpLinha[lk]) primeiraOpLinha[lk] = d;
      atividade(lk, dataValida(o.dataFimReal) || d);
    });

    // Saídas datadas por linha / mês / cliente.
    var saidasLinha = {}, expedidoMes = {}, perdasCliente = {}, nomesCliente = {};
    Object.keys(raw.expedicoes_comerciais || {}).forEach(function(ck) {
      var c = raw.expedicoes_comerciais[ck] || {};
      if (!c.legado && /cancel/i.test(texto(c.status))) return;
      var d = dataValida(c.data);
      var tipo = c.legado ? texto(c.tipoLegado) : 'EXPEDIDO';
      Object.keys(c.itens || {}).forEach(function(ik) {
        var i = c.itens[ik] || {}, qtd = n(i.qtd);
        if (!(qtd > 0)) return;
        var op = i.opKey ? ops[i.opKey] : null;
        var lk = resolverLinha(i.pedidoKey || i.skuPedidoKey || (op && op.skuPedidoKey));
        var ck2 = resolverCliente(c.cliente || i.cliente, c.clienteKey, i.sku || i.itemCodigo);
        if (!nomesCliente[ck2]) nomesCliente[ck2] = c.cliente || i.cliente || '';
        if (tipo === 'FURTO' || tipo === 'DEVOLUCAO') {
          var pc2 = perdasCliente[ck2] = perdasCliente[ck2] || {FURTO: 0, DEVOLUCAO: 0, eventos: []};
          pc2[tipo] += qtd;
          if (d) pc2.eventos.push({data: d, tipo: tipo, qtd: qtd});
          return;
        }
        if (tipo !== 'EXPEDIDO' || !d) return;
        var m = d.slice(0, 7);
        expedidoMes[m] = expedidoMes[m] || {un: 0, porCliente: {}};
        expedidoMes[m].un += qtd;
        expedidoMes[m].porCliente[ck2] = (expedidoMes[m].porCliente[ck2] || 0) + qtd;
        if (lk) { (saidasLinha[lk] = saidasLinha[lk] || []).push({data: d, qtd: qtd, carga: c.numero || ck}); atividade(lk, d); }
      });
    });

    // ── Pedidos ───────────────────────────────────────────────────────
    var linhasPorPedido = {};
    Object.keys(linhas).forEach(function(k) {
      var id = pedidoIdDaLinha(k);
      (linhasPorPedido[id] = linhasPorPedido[id] || []).push(k);
    });
    var pcPorIdNormal = {};
    Object.keys(pcs).forEach(function(id) { pcPorIdNormal[normId(id)] = id; });
    var ids = {};
    Object.keys(pcs).forEach(function(id) { ids[id] = true; });
    Object.keys(linhasPorPedido).forEach(function(id) { ids[pcs[id] ? id : (pcPorIdNormal[normId(id)] || id)] = true; });

    var pedidos = Object.keys(ids).map(function(id) {
      var pc = pcs[id] || {};
      var chavesLinhas = (linhasPorPedido[id] || []).concat(
        Object.keys(linhasPorPedido).filter(function(x) { return x !== id && normId(x) === normId(id) && !pcs[x]; })
          .reduce(function(acc, x) { return acc.concat(linhasPorPedido[x]); }, []));
      var itensPc = Array.isArray(pc.itens) ? pc.itens : Object.values(pc.itens || {});
      var primeiraLinha = linhas[chavesLinhas[0]] || {};
      var dataPedido = dataValida(pc.dataPedido) || dataValida(primeiraLinha.dataPedido);
      var nomeCliente = pc.cliente || primeiraLinha.cliente || '';
      var clienteKey = resolverCliente(nomeCliente, pc.clienteKey, primeiraLinha.sku || (itensPc[0] && itensPc[0].sku));
      var cad = clientes[clienteKey] || {};

      var itens = chavesLinhas.map(function(lk) {
        var l = linhas[lk] || {};
        var itemPc = itensPc.find(function(i) { return i && i.sku === l.sku; }) || {};
        var r = (conc.porPedido || {})[lk] || {};
        var qtd = n(l.qtdTotal), produzido = n(l.produzido);
        var expedido = n(r.expedido && r.expedido.total), estoque = n(r.estoque && r.estoque.total);
        var estado;
        if (linhaFechada(l, pc)) estado = 'FECHADO';
        else if (qtd > 0 && expedido >= qtd * TOLERANCIA_ATENDIDO) estado = 'ATENDIDO';
        else if (qtd > 0 && expedido === 0 && produzido >= qtd * TOLERANCIA_ATENDIDO &&
          (!dataPedido || dias(dataPedido, hoje) > DIAS_A_CONFERIR)) estado = 'A_CONFERIR';
        else estado = 'ABERTO';
        var aberto = estado === 'ABERTO';
        var precoPedido = n(itemPc.valorUnitario || l.valorUnitario) > 0 ? n(itemPc.valorUnitario || l.valorUnitario) : null;
        var vig = precoVigente(precos, l.sku, dataPedido || hoje);
        var precoTabela = vig ? n(vig.preco) : null;
        var preco = precoPedido != null ? precoPedido : precoTabela;
        var desconto = n(itemPc.desconto);
        var saldoEntregar = aberto ? Math.max(qtd - expedido, 0) : 0;
        var saidas = (saidasLinha[lk] || []).slice().sort(function(a, b) { return a.data.localeCompare(b.data); });
        var acum = 0, dataCompleto = null;
        saidas.forEach(function(s) { acum += s.qtd; if (!dataCompleto && qtd > 0 && acum >= qtd * TOLERANCIA_ATENDIDO) dataCompleto = s.data; });
        return {
          linhaKey: lk, sku: texto(l.sku), descricao: texto(itemPc.descricao || l.produto), estado: estado,
          qtd: qtd, produzido: produzido, expedido: expedido, estoqueWms: estoque,
          saldoEntregar: saldoEntregar,
          saldoProduzir: aberto ? Math.max(qtd - Math.max(produzido, expedido), 0) : 0,
          pronto: aberto ? Math.max(Math.min(produzido, qtd) - expedido, 0) : 0,
          aConferir: estado === 'A_CONFERIR' ? Math.max(qtd - expedido, 0) : 0,
          precoPedido: precoPedido, precoTabela: precoTabela, preco: preco,
          fontePreco: precoPedido != null ? 'PEDIDO' : (precoTabela != null ? 'TABELA' : null),
          desvioTabela: (precoPedido != null && precoTabela) ? arred(precoPedido / precoTabela - 1, 4) : null,
          desconto: desconto,
          valor: preco != null ? arred(qtd * preco - desconto) : null,
          valorSaldo: preco != null ? arred(saldoEntregar * preco) : null,
          primeiraOp: primeiraOpLinha[lk] || null, ultimaAtividade: ultimaAtividadeLinha[lk] || null,
          primeiraSaida: saidas.length ? saidas[0].data : null,
          ultimaSaida: saidas.length ? saidas[saidas.length - 1].data : null,
          dataCompleto: estado === 'ATENDIDO' ? dataCompleto : null,
          cargas: saidas.length
        };
      });
      // Item do pedido comercial que nunca virou linha no PCP.
      itensPc.forEach(function(i) {
        if (!i || !i.sku || itens.some(function(x) { return x.sku === i.sku; })) return;
        var vig = precoVigente(precos, i.sku, dataPedido || hoje);
        var preco = n(i.valorUnitario) > 0 ? n(i.valorUnitario) : (vig ? n(vig.preco) : null);
        var fechado = /cancelad/i.test(texto(pc.status));
        itens.push({linhaKey: null, sku: i.sku, descricao: texto(i.descricao), estado: fechado ? 'FECHADO' : 'ABERTO',
          qtd: n(i.qtd), produzido: 0, expedido: 0, estoqueWms: 0,
          saldoEntregar: fechado ? 0 : n(i.qtd), saldoProduzir: fechado ? 0 : n(i.qtd), pronto: 0, aConferir: 0,
          precoPedido: n(i.valorUnitario) > 0 ? n(i.valorUnitario) : null, precoTabela: vig ? n(vig.preco) : null, preco: preco,
          fontePreco: n(i.valorUnitario) > 0 ? 'PEDIDO' : (vig ? 'TABELA' : null), desvioTabela: null, desconto: n(i.desconto),
          valor: preco != null ? arred(n(i.qtd) * preco - n(i.desconto)) : null,
          valorSaldo: preco != null && !fechado ? arred(n(i.qtd) * preco) : null,
          primeiraOp: null, ultimaAtividade: null, primeiraSaida: null, ultimaSaida: null, dataCompleto: null, cargas: 0, semLinhaPcp: true});
      });

      var soma = function(campo) { return itens.reduce(function(s, i) { return s + n(i[campo]); }, 0); };
      var estados = itens.map(function(i) { return i.estado; });
      var estado = !itens.length ? 'SEM_ITENS'
        : estados.indexOf('ABERTO') !== -1 ? 'ABERTO'
        : estados.indexOf('A_CONFERIR') !== -1 ? 'A_CONFERIR'
        : estados.every(function(e) { return e === 'FECHADO'; }) ? 'FECHADO' : 'ATENDIDO';
      var qtdComPreco = itens.reduce(function(s, i) { return s + (i.preco != null ? i.qtd : 0); }, 0);
      var datas = function(campo, fn) { var v = itens.map(function(i) { return i[campo]; }).filter(Boolean).sort(); return v.length ? (fn === 'max' ? v[v.length - 1] : v[0]) : null; };
      var previsao = dataValida(pc.previsaoComercialEntrega);
      var dataCompleto = estado === 'ATENDIDO' && itens.every(function(i) { return i.estado === 'FECHADO' || i.dataCompleto; })
        ? datas('dataCompleto', 'max') : null;
      return {
        id: id, numero: texto(pc.numeroFormatado || id), numeroCliente: texto(pc.numeroPedidoCliente),
        cliente: cad.nome || nomeCliente, clienteKey: clienteKey, dataPedido: dataPedido, previsao: previsao,
        status: texto(pc.status), versao: n(pc.versao) || 1,
        // Cancelado não é venda: fica fora de volume/valor pedido e das
        // médias do cliente (encerrado com saldo continua contando).
        cancelado: /cancelad/i.test(texto(pc.status)), criadoPor: texto(pc.criadoPor),
        condicaoPagamento: texto(pc.prazoPagamento || cad.condicaoPagamento), frete: texto(pc.frete && pc.frete.tipo),
        percentualNF: pc.percentualNF != null ? n(pc.percentualNF) : null, temComercial: !!pcs[id],
        itens: itens, estado: estado,
        qtd: soma('qtd'), produzido: soma('produzido'), expedido: soma('expedido'),
        saldoEntregar: soma('saldoEntregar'), saldoProduzir: soma('saldoProduzir'), pronto: soma('pronto'), aConferir: soma('aConferir'),
        valor: itens.some(function(i) { return i.valor != null; }) ? arred(soma('valor')) : null,
        valorSaldo: itens.some(function(i) { return i.valorSaldo != null; }) ? arred(soma('valorSaldo')) : null,
        coberturaPreco: soma('qtd') > 0 ? arred(qtdComPreco / soma('qtd'), 4) : 0,
        idadeDias: dataPedido ? Math.max(dias(dataPedido, hoje), 0) : null,
        atrasado: estado === 'ABERTO' && !!previsao && previsao < hoje,
        diasAtraso: estado === 'ABERTO' && previsao && previsao < hoje ? dias(previsao, hoje) : 0,
        primeiraOp: datas('primeiraOp'), primeiraSaida: datas('primeiraSaida'), dataCompleto: dataCompleto,
        diasAte1Op: prazo(dataPedido, datas('primeiraOp')),
        diasAte1Saida: prazo(dataPedido, datas('primeiraSaida')),
        diasAteCompleto: prazo(dataPedido, dataCompleto),
        dataInconsistente: !!dataPedido && [datas('primeiraOp'), datas('primeiraSaida')].some(function(d) { return d && d < dataPedido; }),
        ultimaAtividade: datas('ultimaAtividade', 'max'),
        parado: estado === 'ABERTO' && !!dataPedido && dias(dataPedido, hoje) > IDADE_MIN_PARADO &&
          (!datas('ultimaAtividade', 'max') || dias(datas('ultimaAtividade', 'max'), hoje) > DIAS_PARADO),
        noPrazo: previsao && dataCompleto ? dataCompleto <= previsao : (previsao && previsao < hoje && estado === 'ABERTO' ? false : null),
        cargas: soma('cargas'),
        semOpHaDias: estado === 'ABERTO' && !datas('primeiraOp') && soma('produzido') === 0 && dataPedido ? dias(dataPedido, hoje) : null
      };
    }).filter(function(p) { return p.itens.length; })
      .sort(function(a, b) { return texto(b.dataPedido).localeCompare(texto(a.dataPedido)) || b.numero.localeCompare(a.numero); });

    // ── Séries mensais (12 meses) ─────────────────────────────────────
    var meses = ultimosMeses(hoje, 12);
    var serie = meses.map(function(m) {
      var doMes = pedidos.filter(function(p) { return !p.cancelado && p.dataPedido && p.dataPedido.slice(0, 7) === m; });
      var comValor = doMes.filter(function(p) { return p.valor != null; });
      return {mes: m, pedidos: doMes.length, pedidoUn: doMes.reduce(function(s, p) { return s + p.qtd; }, 0),
        pedidoValor: arred(comValor.reduce(function(s, p) { return s + p.valor; }, 0)),
        pedidosComValor: comValor.length, expedidoUn: (expedidoMes[m] || {}).un || 0};
    });

    // ── Clientes ──────────────────────────────────────────────────────
    var inicio12 = somarDias(hoje, -365), inicio180 = somarDias(hoje, -180), inicio360 = somarDias(hoje, -360);
    var mapaCli = {};
    function cli(k, nome) {
      if (!mapaCli[k]) {
        var cad = clientes[k] || {};
        mapaCli[k] = {clienteKey: k, cliente: cad.nome || nome || k.replace(/^nome:/, '').toUpperCase(), codigo: texto(cad.codigo), cadastrado: !!clientes[k],
          condicaoPagamento: texto(cad.condicaoPagamento), cidade: texto(cad.cidade), uf: texto(cad.uf), pedidos: []};
      }
      return mapaCli[k];
    }
    pedidos.forEach(function(p) { cli(p.clienteKey, p.cliente).pedidos.push(p); });
    Object.keys(perdasCliente).forEach(function(k) { cli(k, nomesCliente[k]); });
    meses.forEach(function(m) { Object.keys((expedidoMes[m] || {}).porCliente || {}).forEach(function(k) { cli(k, nomesCliente[k]); }); });

    var listaClientes = Object.keys(mapaCli).map(function(k) {
      var c = mapaCli[k], ps = c.pedidos.filter(function(p) { return !p.cancelado; });
      var em12 = ps.filter(function(p) { return p.dataPedido && p.dataPedido >= inicio12; });
      var vol = function(lista) { return lista.reduce(function(s, p) { return s + p.qtd; }, 0); };
      var datasPedido = ps.map(function(p) { return p.dataPedido; }).filter(Boolean)
        .filter(function(d, i, arr) { return arr.indexOf(d) === i; }).sort();
      var gaps = [];
      for (var i = 1; i < datasPedido.length; i++) gaps.push(dias(datasPedido[i - 1], datasPedido[i]));
      var intervalo = gaps.length >= 2 ? Math.round(mediana(gaps)) : null;
      var ultimo = datasPedido.length ? datasPedido[datasPedido.length - 1] : null;
      var desde = ultimo ? Math.max(dias(ultimo, hoje), 0) : null;
      var recompra = intervalo == null ? 'POUCO_HISTORICO'
        : desde > intervalo * 1.5 ? 'ATRASADA' : desde > intervalo ? 'ATENCAO' : 'EM_DIA';
      var recente = vol(ps.filter(function(p) { return p.dataPedido && p.dataPedido >= inicio180; }));
      var anterior = vol(ps.filter(function(p) { return p.dataPedido && p.dataPedido >= inicio360 && p.dataPedido < inicio180; }));
      var abertos = ps.filter(function(p) { return p.estado === 'ABERTO'; });
      var comValor12 = em12.filter(function(p) { return p.valor != null; });
      var expedido12 = meses.reduce(function(s, m) { return s + n(((expedidoMes[m] || {}).porCliente || {})[k]); }, 0);
      var perdas = perdasCliente[k] || {FURTO: 0, DEVOLUCAO: 0, eventos: []};
      var perdas12 = perdas.eventos.filter(function(e) { return e.data >= inicio12; });
      var skus = {};
      em12.forEach(function(p) { p.itens.forEach(function(i) { skus[i.sku] = (skus[i.sku] || 0) + i.qtd; }); });
      return {
        clienteKey: k, cliente: c.cliente, codigo: c.codigo, cadastrado: c.cadastrado, cidade: c.cidade, uf: c.uf,
        condicaoPagamento: c.condicaoPagamento,
        pedidosTotal: ps.length, pedidos12m: em12.length, volume12m: vol(em12), expedido12m: expedido12,
        valor12m: comValor12.length ? arred(comValor12.reduce(function(s, p) { return s + p.valor; }, 0)) : null,
        pedidosComValor12m: comValor12.length,
        ticketMedio: comValor12.length ? arred(comValor12.reduce(function(s, p) { return s + p.valor; }, 0) / comValor12.length) : null,
        volumeMedioPedido: em12.length ? Math.round(vol(em12) / em12.length) : null,
        tendencia: anterior > 0 ? arred(recente / anterior - 1, 4) : (recente > 0 ? null : null),
        volume180d: recente, volume180dAnterior: anterior,
        primeiroPedido: datasPedido[0] || null, ultimoPedido: ultimo, diasDesdeUltimo: desde,
        intervaloMedio: intervalo, recompra: recompra,
        proximoPedidoPrevisto: intervalo != null && ultimo ? somarDias(ultimo, intervalo) : null,
        carteiraUn: abertos.reduce(function(s, p) { return s + p.saldoEntregar; }, 0),
        carteiraProduzir: abertos.reduce(function(s, p) { return s + p.saldoProduzir; }, 0),
        carteiraPronto: abertos.reduce(function(s, p) { return s + p.pronto; }, 0),
        carteiraValor: abertos.some(function(p) { return p.valorSaldo != null; }) ? arred(abertos.reduce(function(s, p) { return s + n(p.valorSaldo); }, 0)) : null,
        aConferirUn: ps.reduce(function(s, p) { return s + p.aConferir; }, 0),
        pedidosAbertos: abertos.length, atrasados: abertos.filter(function(p) { return p.atrasado; }).length,
        leadTimeMediano: mediana(ps.filter(function(p) { return p.dataPedido >= inicio12; }).map(function(p) { return p.diasAte1Saida; })),
        diasAteCompletoMediano: mediana(ps.map(function(p) { return p.diasAteCompleto; })),
        pctNoPrazo: (function() { var c2 = ps.filter(function(p) { return p.noPrazo != null; }); return c2.length ? arred(c2.filter(function(p) { return p.noPrazo; }).length / c2.length, 4) : null; })(),
        furto12m: perdas12.filter(function(e) { return e.tipo === 'FURTO'; }).reduce(function(s, e) { return s + e.qtd; }, 0),
        devolucao12m: perdas12.filter(function(e) { return e.tipo === 'DEVOLUCAO'; }).reduce(function(s, e) { return s + e.qtd; }, 0),
        skus12m: Object.keys(skus).length,
        topSkus: Object.keys(skus).sort(function(a, b) { return skus[b] - skus[a]; }).slice(0, 5).map(function(s) { return {sku: s, qtd: skus[s]}; }),
        serieMensal: meses.map(function(m) {
          return {mes: m, pedidoUn: vol(ps.filter(function(p) { return p.dataPedido && p.dataPedido.slice(0, 7) === m; })),
            expedidoUn: n(((expedidoMes[m] || {}).porCliente || {})[k])};
        })
      };
    });
    // Participação e curva ABC por volume de pedidos em 12 meses.
    var volTotal12 = listaClientes.reduce(function(s, c) { return s + c.volume12m; }, 0);
    var acum = 0;
    listaClientes.sort(function(a, b) { return b.volume12m - a.volume12m || b.carteiraUn - a.carteiraUn; }).forEach(function(c) {
      c.participacao = volTotal12 > 0 ? arred(c.volume12m / volTotal12, 4) : 0;
      if (c.volume12m > 0) {
        var antes = acum;
        acum += c.participacao;
        c.classe = antes < 0.8 ? 'A' : antes < 0.95 ? 'B' : 'C';
      } else c.classe = '—';
    });

    // ── KPIs ──────────────────────────────────────────────────────────
    var abertos = pedidos.filter(function(p) { return p.estado === 'ABERTO'; });
    var itensAbertos = [];
    abertos.forEach(function(p) { p.itens.forEach(function(i) { if (i.estado === 'ABERTO') itensAbertos.push({p: p, i: i}); }); });
    var carteiraUn = itensAbertos.reduce(function(s, x) { return s + x.i.saldoEntregar; }, 0);
    var carteiraComPreco = itensAbertos.filter(function(x) { return x.i.preco != null; });
    var faixas = [{rotulo: '0–30 dias', ate: 30}, {rotulo: '31–60', ate: 60}, {rotulo: '61–90', ate: 90}, {rotulo: '91–180', ate: 180}, {rotulo: '+180', ate: Infinity}, {rotulo: 'Sem data', ate: null}];
    var aging = faixas.map(function(f) { return {rotulo: f.rotulo, un: 0, pedidos: 0}; });
    abertos.forEach(function(p) {
      var idx = p.idadeDias == null ? 5 : faixas.findIndex(function(f) { return f.ate != null && p.idadeDias <= f.ate; });
      aging[idx].un += p.saldoEntregar; aging[idx].pedidos++;
    });
    var idadePonderada = (function() {
      var peso = 0, soma = 0;
      abertos.forEach(function(p) { if (p.idadeDias != null) { peso += p.saldoEntregar; soma += p.saldoEntregar * p.idadeDias; } });
      return peso ? Math.round(soma / peso) : null;
    })();
    var mesAtual = serie[serie.length - 1], seis = serie.slice(-7, -1);
    var media = function(campo) { return seis.length ? Math.round(seis.reduce(function(s, x) { return s + x[campo]; }, 0) / seis.length) : 0; };
    var inicio90 = somarDias(hoje, -90);
    var pedidos90 = pedidos.filter(function(p) { return !p.cancelado && p.dataPedido && p.dataPedido >= inicio90; }).reduce(function(s, p) { return s + p.qtd; }, 0);
    var expedido90 = Object.keys(expedidoMes).length ? (function() {
      var total = 0;
      Object.keys(raw.expedicoes_comerciais || {}).forEach(function(ck) {
        var c = raw.expedicoes_comerciais[ck] || {}, d = dataValida(c.data);
        if (!d || d < inicio90 || d > hoje) return;
        if ((c.legado ? c.tipoLegado : 'EXPEDIDO') !== 'EXPEDIDO' || (!c.legado && /cancel/i.test(texto(c.status)))) return;
        Object.keys(c.itens || {}).forEach(function(ik) { total += Math.max(n((c.itens[ik] || {}).qtd), 0); });
      });
      return total;
    })() : 0;
    var recentes = pedidos.filter(function(p) { return !p.cancelado && p.dataPedido && p.dataPedido >= inicio12; });
    var comPrazo = pedidos.filter(function(p) { return p.noPrazo != null; });
    var ativos12 = listaClientes.filter(function(c) { return c.volume12m > 0; });
    var top3 = ativos12.slice(0, 3).reduce(function(s, c) { return s + c.participacao; }, 0);
    var skusAtivos = Object.keys(produtos).filter(function(k) { return produtos[k] && produtos[k].ativo !== 'Inativo' && produtos[k].sku; });
    var skusComPreco = skusAtivos.filter(function(k) { return precoVigente(precos, produtos[k].sku, hoje); });

    var kpis = {
      carteiraUn: carteiraUn,
      carteiraValor: carteiraComPreco.length ? arred(carteiraComPreco.reduce(function(s, x) { return s + x.i.valorSaldo; }, 0)) : null,
      carteiraCoberturaPreco: carteiraUn ? arred(carteiraComPreco.reduce(function(s, x) { return s + x.i.saldoEntregar; }, 0) / carteiraUn, 4) : 0,
      aProduzirUn: itensAbertos.reduce(function(s, x) { return s + x.i.saldoProduzir; }, 0),
      prontoUn: itensAbertos.reduce(function(s, x) { return s + x.i.pronto; }, 0),
      aConferirUn: pedidos.reduce(function(s, p) { return s + p.aConferir; }, 0),
      paradoUn: abertos.filter(function(p) { return p.parado; }).reduce(function(s, p) { return s + p.saldoEntregar; }, 0),
      paradoPedidos: abertos.filter(function(p) { return p.parado; }).length,
      datasInconsistentes: pedidos.filter(function(p) { return p.dataInconsistente; }).length,
      aConferirItens: pedidos.reduce(function(s, p) { return s + p.itens.filter(function(i) { return i.estado === 'A_CONFERIR'; }).length; }, 0),
      pedidosAbertos: abertos.length,
      atrasados: abertos.filter(function(p) { return p.atrasado; }).length,
      atrasadosUn: abertos.filter(function(p) { return p.atrasado; }).reduce(function(s, p) { return s + p.saldoEntregar; }, 0),
      semPrevisao: abertos.filter(function(p) { return !p.previsao; }).length,
      idadeMediaCarteira: idadePonderada,
      aging: aging,
      mesAtual: mesAtual, mediaPedidoUn6m: media('pedidoUn'), mediaExpedidoUn6m: media('expedidoUn'), mediaPedidos6m: media('pedidos'),
      bookToBill90d: expedido90 > 0 ? arred(pedidos90 / expedido90, 2) : null, pedidos90dUn: pedidos90, expedido90dUn: expedido90,
      leadTime1OpMediano: mediana(recentes.map(function(p) { return p.diasAte1Op; })),
      leadTime1SaidaMediano: mediana(recentes.map(function(p) { return p.diasAte1Saida; })),
      leadTimeCompletoMediano: mediana(recentes.map(function(p) { return p.diasAteCompleto; })),
      pctNoPrazo: comPrazo.length ? arred(comPrazo.filter(function(p) { return p.noPrazo; }).length / comPrazo.length, 4) : null,
      pedidosComPrevisaoAvaliados: comPrazo.length,
      clientesAtivos12m: ativos12.length, concentracaoTop3: arred(top3, 4),
      clientesRecompraAtrasada: listaClientes.filter(function(c) { return c.recompra === 'ATRASADA' && c.pedidosAbertos === 0; }).length,
      skusAtivos: skusAtivos.length, skusComPreco: skusComPreco.length,
      itensAbertosSemPreco: itensAbertos.filter(function(x) { return x.i.preco == null; }).length
    };

    // ── Alertas acionáveis ────────────────────────────────────────────
    var alertas = [];
    abertos.filter(function(p) { return p.atrasado; }).sort(function(a, b) { return b.diasAtraso - a.diasAtraso; }).forEach(function(p) {
      alertas.push({tipo: 'ATRASO', gravidade: p.diasAtraso > 15 ? 'alta' : 'media', pedidoId: p.id, clienteKey: p.clienteKey,
        texto: p.numero + ' (' + p.cliente + ') passou ' + p.diasAtraso + ' dia(s) da previsão com ' + p.saldoEntregar.toLocaleString('pt-BR') + ' un a entregar.'});
    });
    abertos.filter(function(p) { return p.semOpHaDias != null && p.semOpHaDias > 15; }).forEach(function(p) {
      alertas.push({tipo: 'SEM_OP', gravidade: 'media', pedidoId: p.id, clienteKey: p.clienteKey,
        texto: p.numero + ' (' + p.cliente + ') está há ' + p.semOpHaDias + ' dias sem produção iniciada.'});
    });
    listaClientes.filter(function(c) { return c.recompra === 'ATRASADA' && c.pedidosAbertos === 0; }).forEach(function(c) {
      alertas.push({tipo: 'RECOMPRA', gravidade: 'media', clienteKey: c.clienteKey,
        texto: c.cliente + ' costuma pedir a cada ~' + c.intervaloMedio + ' dias e o último pedido foi há ' + c.diasDesdeUltimo + '. Vale contato comercial.'});
    });
    pedidos.forEach(function(p) {
      p.itens.forEach(function(i) {
        if (p.estado === 'ABERTO' && i.desvioTabela != null && i.desvioTabela < -0.05) {
          alertas.push({tipo: 'PRECO', gravidade: 'media', pedidoId: p.id, clienteKey: p.clienteKey,
            texto: p.numero + ': ' + i.descricao + ' vendido ' + Math.round(-i.desvioTabela * 100) + '% abaixo da tabela.'});
        }
      });
    });
    if (kpis.paradoPedidos) {
      alertas.push({tipo: 'PARADO', gravidade: 'media',
        texto: kpis.paradoPedidos + ' pedido(s) abertos há mais de ' + IDADE_MIN_PARADO + ' dias sem movimento nos últimos ' + DIAS_PARADO +
          ' (' + kpis.paradoUn.toLocaleString('pt-BR') + ' un na carteira). Confirmar com o cliente se ainda valem.'});
    }
    if (kpis.itensAbertosSemPreco) {
      alertas.push({tipo: 'SEM_PRECO', gravidade: 'baixa',
        texto: kpis.itensAbertosSemPreco + ' item(ns) da carteira sem preço no pedido nem na tabela: o valor da carteira fica incompleto.'});
    }
    if (kpis.aConferirItens) {
      alertas.push({tipo: 'A_CONFERIR', gravidade: 'baixa',
        texto: kpis.aConferirItens + ' item(ns) produzidos há mais de ' + DIAS_A_CONFERIR + ' dias sem saída registrada (' + kpis.aConferirUn.toLocaleString('pt-BR') + ' un). Provável entrega sem baixa: conferir e encerrar.'});
    }

    return {hoje: hoje, pedidos: pedidos, clientes: listaClientes, serie: serie, kpis: kpis, alertas: alertas};
  }

  // Tabela de preços: um registro por SKU ativo (e SKU que aparece em pedido).
  function tabelaPrecos(raw, hoje, analise) {
    raw = raw || {};
    var produtos = raw.produtos || {}, precos = raw.precos_venda || {}, porSku = {};
    Object.keys(produtos).forEach(function(k) {
      var p = produtos[k] || {};
      if (!p.sku) return;
      porSku[p.sku] = {sku: p.sku, descricao: texto(p.descricao), cliente: texto(p.cliente), clienteKey: texto(p.clienteKey), ativo: p.ativo !== 'Inativo'};
    });
    var praticados = {};
    ((analise && analise.pedidos) || []).forEach(function(ped) {
      ped.itens.forEach(function(i) {
        if (!porSku[i.sku]) porSku[i.sku] = {sku: i.sku, descricao: i.descricao, cliente: ped.cliente, clienteKey: ped.clienteKey, ativo: true};
        if (i.precoPedido != null) {
          var atual = praticados[i.sku];
          if (!atual || texto(ped.dataPedido) > texto(atual.data)) praticados[i.sku] = {preco: i.precoPedido, data: ped.dataPedido, pedido: ped.numero};
        }
      });
    });
    return Object.keys(porSku).map(function(sku) {
      var base = porSku[sku], lista = vigencias(precos, sku), vig = precoVigente(precos, sku, hoje);
      var futura = lista.filter(function(x) { return x.inicio > hoje; })[0] || null;
      var pr = praticados[sku] || null;
      return Object.assign(base, {
        precoVigente: vig ? n(vig.preco) : null, desde: vig ? vig.inicio : null,
        proxima: futura ? {preco: n(futura.preco), inicio: futura.inicio} : null,
        ultimoPraticado: pr, desvioPraticado: pr && vig ? arred(pr.preco / n(vig.preco) - 1, 4) : null,
        vigencias: lista.slice().reverse()
      });
    }).filter(function(x) { return x.ativo || x.precoVigente != null; })
      .sort(function(a, b) { return a.cliente.localeCompare(b.cliente) || a.descricao.localeCompare(b.descricao); });
  }

  return {
    calcular: calcular, tabelaPrecos: tabelaPrecos, precoVigente: precoVigente, vigencias: vigencias,
    validarVigencia: validarVigencia, sanitizeKey: sanitizeKey, norm: norm, dias: dias, mediana: mediana,
    TOLERANCIA_ATENDIDO: TOLERANCIA_ATENDIDO, DIAS_A_CONFERIR: DIAS_A_CONFERIR, DIAS_PARADO: DIAS_PARADO, IDADE_MIN_PARADO: IDADE_MIN_PARADO
  };
});
