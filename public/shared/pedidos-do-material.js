/* Pedidos que DEMANDAM o material comprado (Compras › Cliente/pedido).

   Pedido do usuário (23/10/2026): ao vincular cliente e pedidos num Pedido de
   Compra, o correto é sugerir só os pedidos que precisam do material. Antes a
   lista trazia todos os pedidos abertos do cliente, e quem comprava tinha que
   saber de cabeça quais produtos usam aquela embalagem ou matéria-prima.

   A demanda vem de OndeUsado.indice: fórmula (MP) e BOM (embalagem) VIGENTES
   de cada produto ativo. Um pedido (linha de pedido = um SKU) demanda o
   material quando o SKU dele usa o material.

   Cobertura incompleta é a regra, não a exceção: há produto sem fórmula/BOM
   cadastrada, e material de uso e consumo não consta em nenhum produto. Por
   isso nada é escondido sem saída:
   - material que não aparece em nenhum produto -> sem filtro (a tela avisa);
   - a tela oferece "mostrar todos os pedidos do cliente";
   - pedido já marcado continua visível.

   Funções PURAS. O índice de uso vem pronto (OndeUsado.indice). */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PedidosDoMaterial = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function txt(v) { return String(v == null ? '' : v).trim(); }
  function maiusculo(v) { return txt(v).toUpperCase(); }

  /* SKUs (em maiúsculas) dos produtos que usam os materiais.
     `indice`: {mpCodigo: [uso]} de OndeUsado.indice. Devolve
     {skus, via, achou, semUso}. `achou` só é verdadeiro quando TODO material
     consultado aparece em alguma fórmula/BOM: se um deles não aparece não há
     como saber quais pedidos o demandam, e filtrar pelos outros esconderia
     pedido legítimo (relevante quando o editor vale para vários itens). */
  function skusQueUsam(indice, codigos) {
    var skus = {}, via = {}, semUso = [], consultados = 0;
    (codigos || []).forEach(function(c) {
      var cod = txt(c);
      if (!cod) return;
      consultados++;
      var usos = (indice || {})[cod] || [];
      if (!usos.length) { semUso.push(cod); return; }
      usos.forEach(function(uso) {
        var s = maiusculo(uso.sku || uso.produtoKey);
        if (!s) return;
        skus[s] = true;
        (via[s] = via[s] || []);
        if (via[s].indexOf(uso.via) < 0) via[s].push(uso.via);
      });
    });
    return {skus: skus, via: via, achou: consultados > 0 && !semUso.length && Object.keys(skus).length > 0, semUso: semUso};
  }

  /* Restringe os grupos de PropriedadeEstoque.pedidosDoCliente às linhas cujo
     SKU usa o material. Grupo sem nenhuma linha que use some. Cada linha
     mantida ganha `via` (de onde vem a demanda). Sem `demanda.achou` não filtra:
     devolve os grupos como vieram, com `filtrado: false`. */
  function filtrarGrupos(grupos, demanda) {
    if (!demanda || !demanda.achou) return {grupos: grupos, filtrado: false};
    var out = [];
    (grupos || []).forEach(function(g) {
      var linhas = (g.linhas || []).filter(function(l) { return demanda.skus[maiusculo(l.sku)]; })
        .map(function(l) { return Object.assign({}, l, {via: demanda.via[maiusculo(l.sku)] || []}); });
      if (!linhas.length) return;
      out.push(Object.assign({}, g, {linhas: linhas}));
    });
    return {grupos: out, filtrado: true};
  }

  /* Quantos pedidos abertos de cada cliente demandam o material -- para
     anotar e ordenar a lista de clientes. `gruposPorCliente(clienteKey)`
     devolve os grupos abertos do cliente. */
  function contagemPorCliente(clienteKeys, gruposPorCliente, demanda) {
    var out = {};
    (clienteKeys || []).forEach(function(k) {
      var r = filtrarGrupos(gruposPorCliente(k), demanda);
      out[k] = r.filtrado ? r.grupos.length : 0;
    });
    return out;
  }

  return {skusQueUsam: skusQueUsam, filtrarGrupos: filtrarGrupos, contagemPorCliente: contagemPorCliente};
});
