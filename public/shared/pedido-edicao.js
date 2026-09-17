/* Edição de pedido comercial com versão e travas.

   Decisão do usuário (2026-09-16): "edita com versão e trava" --
   - toda edição vira uma versão nova, com motivo e o antes/depois de cada
     campo, em pedidos_comerciais/{id}/versoes/{n};
   - quantidade não pode ficar abaixo do já produzido nem do já expedido;
   - item com OP ativa, produção ou saída não é removido: transfere/cancela a
     OP ou encerra o item antes.

   Espelha as duas cópias que o Comercial grava ao criar o pedido
   (comercial.html/salvarPedido): pedidos_comerciais/{id} (snapshot comercial)
   e pedidos/{id}__{sku} (a linha que o PCP produz). Editar só uma deixava as
   duas telas discordando -- o defeito que já existia em pedidos.html.

   Tudo aqui é puro: recebe o banco lido e devolve erros, avisos, a lista de
   mudanças e o mapa de caminhos planos para um único db.ref().update(). */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PedidoEdicao = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function arred(v, c) { var f = Math.pow(10, c == null ? 4 : c); return Math.round(n(v) * f) / f; }
  function texto(v) { return v == null ? '' : String(v).trim(); }
  function sanitizeKey(str) {
    if (!str) return '';
    return String(str).trim().replace(/[./[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60);
  }
  function normChave(k) {
    var p = texto(k).split('__');
    if (p.length < 2) return texto(k);
    return (/^\d+$/.test(p[0]) ? String(parseInt(p[0], 10)) : p[0]) + '__' + p.slice(1).join('__');
  }
  function dataOk(d) { return !d || /^\d{4}-\d{2}-\d{2}$/.test(d); }
  function listaItens(itens) { return Array.isArray(itens) ? itens.filter(Boolean) : Object.values(itens || {}).filter(Boolean); }

  // Campos de cabeçalho editáveis: [caminho no pedido, rótulo, tipo].
  var CAMPOS = [
    ['numeroPedidoCliente', 'Nº do pedido do cliente', 'texto'],
    ['dataPedido', 'Data do pedido', 'data'],
    ['previsaoComercialEntrega', 'Previsão de entrega', 'data'],
    ['prazoPagamento', 'Condição de pagamento', 'texto'],
    ['percentualNF', '% NF', 'numero'],
    ['frete/tipo', 'Frete', 'texto'],
    ['frete/prazo', 'Prazo do frete', 'texto'],
    ['frete/enderecoEntrega', 'Endereço de entrega', 'texto'],
    ['enderecoFaturamento', 'Endereço de faturamento', 'texto'],
    ['observacoes', 'Observações', 'texto']
  ];
  function ler(obj, caminho) { return caminho.split('/').reduce(function(o, k) { return o == null ? undefined : o[k]; }, obj); }
  function valorCampo(v, tipo) {
    if (tipo === 'numero') return v === '' || v == null ? null : n(v);
    return texto(v);
  }

  /* Contexto de cada item atual: linha do PCP, produzido, expedido, OPs ativas.
     analiseItens: itens do pedido vindos de GestaoComercial.calcular (têm
     linhaKey, produzido e expedido já conciliados). */
  function contextoItens(id, pedidos, ops, analiseItens) {
    var ctx = {};
    (analiseItens || []).forEach(function(i) {
      ctx[i.sku] = {linhaKey: i.linhaKey || null, produzido: n(i.produzido), expedido: n(i.expedido), ops: []};
    });
    Object.keys(pedidos || {}).forEach(function(k) {
      var l = pedidos[k] || {};
      if (normChave(texto(l.parentPedidoId || l.id) + '__x') !== normChave(texto(id) + '__x') || !l.sku) return;
      if (!ctx[l.sku]) ctx[l.sku] = {linhaKey: k, produzido: n(l.produzido), expedido: n(l.expedido), ops: []};
      else if (!ctx[l.sku].linhaKey) ctx[l.sku].linhaKey = k;
    });
    Object.keys(ops || {}).forEach(function(ok) {
      var o = ops[ok];
      if (!o || o.status === 'Cancelado' || !o.skuPedidoKey) return;
      Object.keys(ctx).forEach(function(sku) {
        if (ctx[sku].linhaKey && normChave(o.skuPedidoKey) === normChave(ctx[sku].linhaKey)) ctx[sku].ops.push(o.lote || ok);
      });
    });
    return ctx;
  }

  /* base: {pedidoComercial, id, pedidos, ops, produtos, analiseItens}
     proposta: {campos: {caminho: valor}, itens: [{sku, qtd, valorUnitario, desconto}]}
     meta: {motivo, autor, agora} */
  function planejar(base, proposta, meta) {
    base = base || {}; proposta = proposta || {}; meta = meta || {};
    var pc = base.pedidoComercial, id = base.id, erros = [], avisos = [], mudancas = [];
    if (!pc) return {erros: ['Pedido comercial não encontrado.'], avisos: [], mudancas: []};
    if (/cancelad/i.test(texto(pc.status))) erros.push('Pedido cancelado não é editado.');
    if (!texto(meta.motivo)) erros.push('Informe o motivo da alteração.');

    // ── Cabeçalho ─────────────────────────────────────────────────────
    var camposMudados = {};
    CAMPOS.forEach(function(c) {
      if (!proposta.campos || !Object.prototype.hasOwnProperty.call(proposta.campos, c[0])) return;
      var antes = valorCampo(ler(pc, c[0]), c[2]), depois = valorCampo(proposta.campos[c[0]], c[2]);
      if (c[2] === 'data' && !dataOk(depois)) { erros.push(c[1] + ' inválida.'); return; }
      if (c[0] === 'percentualNF' && depois != null && (depois < 0 || depois > 100)) { erros.push('% NF deve ficar entre 0 e 100.'); return; }
      if (antes === depois || (antes == null && depois === '') || (antes === '' && depois == null)) return;
      camposMudados[c[0]] = depois;
      mudancas.push({tipo: 'CAMPO', campo: c[0], rotulo: c[1], antes: antes, depois: depois});
    });

    // ── Itens ─────────────────────────────────────────────────────────
    var atuais = listaItens(pc.itens), porSkuAtual = {};
    atuais.forEach(function(i) { if (i.sku && !porSkuAtual[i.sku]) porSkuAtual[i.sku] = i; });
    var ctx = contextoItens(id, base.pedidos, base.ops, base.analiseItens);
    var novos = (proposta.itens || []).map(function(i) {
      return {sku: texto(i.sku), qtd: n(i.qtd), valorUnitario: i.valorUnitario === '' || i.valorUnitario == null ? null : arred(i.valorUnitario),
        desconto: n(i.desconto)};
    });
    if (!novos.length) erros.push('O pedido precisa de pelo menos um item.');
    var vistos = {};
    novos.forEach(function(i, idx) {
      var linha = 'Item ' + (idx + 1) + (i.sku ? ' (' + i.sku + ')' : '');
      if (!i.sku) { erros.push(linha + ': escolha o produto.'); return; }
      if (vistos[i.sku]) { erros.push(i.sku + ' aparece duas vezes. Some as quantidades numa linha só.'); return; }
      vistos[i.sku] = true;
      if (!(i.qtd > 0)) erros.push(linha + ': quantidade precisa ser maior que zero.');
      if (i.valorUnitario != null && i.valorUnitario < 0) erros.push(linha + ': preço negativo.');
      if (i.desconto < 0) erros.push(linha + ': desconto negativo.');
      var atual = porSkuAtual[i.sku], c = ctx[i.sku];
      if (!atual) {
        var prod = (base.produtos || {})[sanitizeKey(i.sku)] || Object.values(base.produtos || {}).find(function(p) { return p && p.sku === i.sku; });
        if (!prod) erros.push(i.sku + ' não está cadastrado em Produtos.');
        else if (prod.ativo === 'Inativo') avisos.push(i.sku + ' está inativo no cadastro.');
        i.descricao = prod ? texto(prod.descricao) : '';
        i.produtoKey = prod ? sanitizeKey(prod.sku || i.sku) : '';
        mudancas.push({tipo: 'ITEM_ADICIONADO', sku: i.sku, descricao: i.descricao, depois: i.qtd});
        return;
      }
      i.descricao = texto(atual.descricao);
      i.produtoKey = atual.produtoKey || '';
      if (c) {
        var piso = Math.max(c.produzido, c.expedido);
        if (i.qtd < piso) {
          erros.push(i.sku + ': quantidade não pode ficar abaixo do já ' + (c.expedido >= c.produzido ? 'expedido' : 'produzido') +
            ' (' + piso.toLocaleString('pt-BR') + ').');
        }
      }
      if (n(atual.qtd) !== i.qtd) mudancas.push({tipo: 'QUANTIDADE', sku: i.sku, descricao: i.descricao, antes: n(atual.qtd), depois: i.qtd});
      var precoAntes = n(atual.valorUnitario) > 0 ? arred(atual.valorUnitario) : null;
      if (precoAntes !== i.valorUnitario) mudancas.push({tipo: 'PRECO', sku: i.sku, descricao: i.descricao, antes: precoAntes, depois: i.valorUnitario});
      if (n(atual.desconto) !== i.desconto) mudancas.push({tipo: 'DESCONTO', sku: i.sku, descricao: i.descricao, antes: n(atual.desconto), depois: i.desconto});
    });
    Object.keys(porSkuAtual).forEach(function(sku) {
      if (vistos[sku]) return;
      var c = ctx[sku] || {produzido: 0, expedido: 0, ops: []};
      if (c.ops.length) erros.push(sku + ' tem OP ativa (' + c.ops.join(', ') + '). Transfira ou cancele a OP em Controle de OPs antes de remover o item.');
      else if (c.produzido > 0 || c.expedido > 0) erros.push(sku + ' já tem produção ou saída registrada. Encerre o item na tela de Pedidos em vez de removê-lo.');
      mudancas.push({tipo: 'ITEM_REMOVIDO', sku: sku, descricao: texto(porSkuAtual[sku].descricao), antes: n(porSkuAtual[sku].qtd)});
    });

    if (!erros.length && !mudancas.length) erros.push('Nada foi alterado.');
    var versaoAtual = n(pc.versao) || 1;
    return {erros: erros, avisos: avisos, mudancas: mudancas, camposMudados: camposMudados, itens: novos, ctx: ctx,
      versaoAtual: versaoAtual, versaoNova: versaoAtual + 1};
  }

  function descrever(m) {
    var f = function(v) { return v == null || v === '' ? '—' : (typeof v === 'number' ? v.toLocaleString('pt-BR') : String(v)); };
    switch (m.tipo) {
      case 'CAMPO': return m.rotulo + ': ' + f(m.antes) + ' → ' + f(m.depois);
      case 'QUANTIDADE': return m.sku + ' quantidade: ' + f(m.antes) + ' → ' + f(m.depois);
      case 'PRECO': return m.sku + ' preço: ' + f(m.antes) + ' → ' + f(m.depois);
      case 'DESCONTO': return m.sku + ' desconto: ' + f(m.antes) + ' → ' + f(m.depois);
      case 'ITEM_ADICIONADO': return 'Item novo ' + m.sku + ' (' + m.descricao + '): ' + f(m.depois);
      case 'ITEM_REMOVIDO': return 'Item removido ' + m.sku + ' (' + m.descricao + ', era ' + f(m.antes) + ')';
      default: return m.tipo;
    }
  }

  /* Caminhos planos para db.ref().update(). Só chame com plano sem erros. */
  function atualizacoes(base, plano, meta) {
    var pc = base.pedidoComercial, id = base.id, u = {}, raiz = 'pedidos_comerciais/' + id + '/';
    var agora = meta.agora || new Date().toISOString();
    var atuaisPorSku = {};
    listaItens(pc.itens).forEach(function(i) { if (i.sku && !atuaisPorSku[i.sku]) atuaisPorSku[i.sku] = i; });

    Object.keys(plano.camposMudados).forEach(function(c) { u[raiz + c] = plano.camposMudados[c] === '' ? null : plano.camposMudados[c]; });

    var itens = plano.itens.map(function(i) {
      // Preserva campos que a edição não conhece (ex.: especificação).
      return Object.assign({}, atuaisPorSku[i.sku] || {}, {
        sku: i.sku, produtoKey: i.produtoKey || (atuaisPorSku[i.sku] || {}).produtoKey || sanitizeKey(i.sku),
        descricao: i.descricao, qtd: i.qtd, valorUnitario: i.valorUnitario == null ? 0 : i.valorUnitario, desconto: i.desconto
      });
    });
    u[raiz + 'itens'] = itens;
    u[raiz + 'total_qtd'] = itens.reduce(function(s, i) { return s + n(i.qtd); }, 0);
    u[raiz + 'totalValor'] = arred(itens.reduce(function(s, i) { return s + n(i.qtd) * n(i.valorUnitario) - n(i.desconto); }, 0), 2);
    u[raiz + 'versao'] = plano.versaoNova;
    u[raiz + 'atualizadoEm'] = agora;
    u[raiz + 'atualizadoPor'] = meta.autor || '';
    u[raiz + 'versoes/v' + plano.versaoNova] = {
      versao: plano.versaoNova, em: agora, por: meta.autor || '', motivo: texto(meta.motivo),
      mudancas: plano.mudancas.map(function(m) { return Object.assign({}, m, {texto: descrever(m)}); }),
      anterior: {itens: listaItens(pc.itens), campos: CAMPOS.reduce(function(o, c) { var v = ler(pc, c[0]); if (v != null) o[c[0].replace('/', '_')] = v; return o; }, {})}
    };
    var hist = Array.isArray(pc.historico) ? pc.historico.length : Object.keys(pc.historico || {}).length;
    u[raiz + 'historico/' + hist] = {tipo: 'EDITADO', texto: 'Versão ' + plano.versaoNova + ': ' + texto(meta.motivo), em: agora, por: meta.autor || ''};

    // Linhas do PCP.
    var frete = Object.assign({}, pc.frete || {});
    Object.keys(plano.camposMudados).forEach(function(c) { if (c.indexOf('frete/') === 0) frete[c.slice(6)] = plano.camposMudados[c]; });
    var dataPedido = plano.camposMudados.dataPedido !== undefined ? plano.camposMudados.dataPedido : pc.dataPedido;
    plano.itens.forEach(function(i) {
      var c = plano.ctx[i.sku];
      var lk = c && c.linhaKey;
      if (lk) {
        u['pedidos/' + lk + '/qtdTotal'] = i.qtd;
        u['pedidos/' + lk + '/valorUnitario'] = i.valorUnitario == null ? null : i.valorUnitario;
        if (plano.camposMudados.dataPedido !== undefined) u['pedidos/' + lk + '/dataPedido'] = dataPedido || null;
        if (Object.keys(plano.camposMudados).some(function(k) { return k.indexOf('frete/') === 0; })) u['pedidos/' + lk + '/frete'] = frete;
      } else {
        u['pedidos/' + id + '__' + sanitizeKey(i.sku)] = {
          id: id, produto: i.descricao, sku: i.sku, cliente: pc.cliente || '', qtdTotal: i.qtd, produzido: 0, priority: 999,
          parentPedidoId: id, dataPedido: dataPedido || null, valorUnitario: i.valorUnitario == null ? 0 : i.valorUnitario,
          pedidoComercialStatus: pc.status || 'LIBERADO_PCP', frete: frete
        };
      }
    });
    plano.mudancas.filter(function(m) { return m.tipo === 'ITEM_REMOVIDO'; }).forEach(function(m) {
      var c = plano.ctx[m.sku];
      if (c && c.linhaKey) u['pedidos/' + c.linhaKey] = null;
    });
    return u;
  }

  return {CAMPOS: CAMPOS, planejar: planejar, atualizacoes: atualizacoes, descrever: descrever, contextoItens: contextoItens, sanitizeKey: sanitizeKey};
});
