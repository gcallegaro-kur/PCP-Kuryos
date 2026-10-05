/* Onde o material é usado (usuário, 01/10: "dentro do estoque, quero uma
   coluna que mostre em quais BOMs, em quais produtos o referido item está
   sendo utilizado").

   indice({formulas, bom, produtos}) -> {mpCodigo: [uso]}
     uso = {produtoKey, sku, descricao, cliente, via: 'Fórmula'|'BOM', versao,
            status, quantidade, unidadeQtd}
   Fórmula (formulas/{prod}__{versao}.itens[].mpCodigo, % m/m) e BOM
   (bom/{prod}__{versao}.itens[].materialCodigo, qtd por peça) entram juntos.
   Por produto vale só a versão VIGENTE de cada um: a de número mais alto que
   não esteja OBSOLETA -- a versão antiga substituída não é "uso" de verdade.
   Produto inativo fica de fora. Item sem código (linha da importação) não
   tem para onde apontar e é ignorado. Testado em run_onde_usado_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OndeUsado = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function txt(v) { return String(v == null ? '' : v).trim(); }
  function versaoNum(v) { return parseInt(String(v || 'v0').replace(/[^\d]/g, ''), 10) || 0; }
  function produtoDaChave(chave, reg) { return txt(reg && reg.codProduto) || String(chave).split('__')[0]; }

  // Versão vigente por produto: a que o app usa nas contas. Fórmula = a aprovada de maior número
  // (sem nenhuma aprovada, a de maior número), como melhorFormulaDoProduto; BOM = o de MESMA chave
  // da fórmula escolhida (produto__versão), senão o de maior número. OBSOLETA nunca vale. Empate
  // (ex.: "X__V1" e "X__v1") resolve por chave, de forma estável, e a duplicata fica de fora.
  function vigentes(colecao, preferidas, priorizarAprovada) {
    var porProduto = {};
    Object.keys(colecao || {}).sort().forEach(function(chave) {
      var r = colecao[chave];
      if (!r || r.status === 'OBSOLETA') return;
      var prod = produtoDaChave(chave, r);
      var atual = porProduto[prod];
      var preferida = preferidas && preferidas[prod];
      if (preferida) { if (chave === preferida) porProduto[prod] = {chave: chave, r: r, fixa: true}; return; }
      if (atual && atual.fixa) return;
      var rank = function(x) { return (priorizarAprovada && x.r.status === 'APROVADA' ? 1e6 : 0) + versaoNum(x.r.versao || x.chave.split('__')[1]); };
      var cand = {chave: chave, r: r};
      if (!atual || rank(cand) > rank(atual)) porProduto[prod] = cand;
    });
    return porProduto;
  }

  function indice(d) {
    var dados = d || {};
    var produtos = dados.produtos || {};
    var out = {};
    function produtoInfo(prod) {
      var p = produtos[prod] || null;
      if (!p) {
        // produtos/ pode estar indexado por outra chave: procura pelo SKU.
        var k = Object.keys(produtos).find(function(x) { return produtos[x] && produtos[x].sku === prod; });
        p = k ? produtos[k] : null;
      }
      return p;
    }
    function adicionar(codigo, uso) {
      var c = txt(codigo);
      if (!c) return;
      var lista = out[c] = out[c] || [];
      var ja = lista.find(function(u) { return u.produtoKey === uso.produtoKey && u.via === uso.via; });
      if (ja) { ja.quantidade = (Number(ja.quantidade) || 0) + (Number(uso.quantidade) || 0); return; }
      lista.push(uso);
    }
    var preferidasBom = {};
    [['formulas', 'Fórmula', 'mpCodigo'], ['bom', 'BOM', 'materialCodigo']].forEach(function(cfg) {
      var vig = vigentes(dados[cfg[0]], cfg[0] === 'bom' ? preferidasBom : null, cfg[0] === 'formulas');
      if (cfg[0] === 'formulas') Object.keys(vig).forEach(function(pr) { preferidasBom[pr] = vig[pr].chave; });
      Object.keys(vig).forEach(function(prod) {
        var p = produtoInfo(prod);
        if (p && p.ativo === false) return;
        var reg = vig[prod].r;
        Object.keys(reg.itens || {}).forEach(function(ik) {
          var it = reg.itens[ik];
          if (!it) return;
          adicionar(it[cfg[2]], {
            produtoKey: prod, sku: (p && p.sku) || prod, descricao: (p && p.descricao) || '', cliente: (p && p.cliente) || '',
            via: cfg[1], versao: reg.versao || vig[prod].chave.split('__')[1] || '', status: reg.status || 'RASCUNHO',
            quantidade: cfg[0] === 'formulas' ? Number(it.percentualMM) || 0 : Number(it.qtdPorPeca) || 0,
            unidadeQtd: cfg[0] === 'formulas' ? '%' : 'por peça',
            // "1 a cada N peças" (caixa de embarque): N, quando cadastrado ou 1/N redondo.
            pecasPorUnidade: cfg[0] === 'bom' ? (Number(it.pecasPorUnidade) > 0 ? Number(it.pecasPorUnidade)
              : (Number(it.qtdPorPeca) > 0 && Number(it.qtdPorPeca) < 1 && Math.abs(1 / Number(it.qtdPorPeca) - Math.round(1 / Number(it.qtdPorPeca))) < 0.02 ? Math.round(1 / Number(it.qtdPorPeca)) : null)) : null
          });
        });
      });
    });
    Object.keys(out).forEach(function(c) {
      out[c].sort(function(a, b) { return String(a.sku).localeCompare(String(b.sku)) || a.via.localeCompare(b.via); });
    });
    return out;
  }

  // Produtos distintos que usam o material (fórmula e BOM do mesmo produto contam 1).
  function produtosDistintos(usos) {
    var vistos = {};
    return (usos || []).filter(function(u) { if (vistos[u.produtoKey]) return false; vistos[u.produtoKey] = 1; return true; });
  }

  // Texto para busca: SKUs, descrições e clientes que usam o material.
  function textoBusca(usos) {
    return (usos || []).map(function(u) { return u.sku + ' ' + u.descricao + ' ' + u.cliente; }).join(' ');
  }

  return {indice: indice, vigentes: vigentes, produtosDistintos: produtosDistintos, textoBusca: textoBusca};
});
