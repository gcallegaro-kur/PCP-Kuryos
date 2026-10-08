/* ══════════════════════════════════════════════════════════════════════
   PENDÊNCIAS DE CADASTRO DO PRODUTO — Fórmula, BOM e Especificação (08/10/2026)

   Pedido do usuário: "dentro de cadastros, na tela produtos, quero ter dash
   acima ... que mostram quantos produtos tem formula pendente, quantos tem
   bom pendente, quantos tem especificação pendente, e que seja clicável,
   filtrando os produtos depois de clicado".

   Cada componente é guardado por versão (formulas|bom|especificacoes/
   {codProduto}__vN, com status RASCUNHO/APROVADA). Para o produto:
     OK         -- alguma versão APROVADA;
     A_APROVAR  -- tem versão com itens, nenhuma aprovada (inclui a importação
                   da planilha que ainda não foi revisada);
     SEM        -- nenhuma versão, ou só versão vazia.
   Pendente = A_APROVAR ou SEM. Função pura.
   ══════════════════════════════════════════════════════════════════════ */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PendenciasProduto = api;
})(typeof window !== 'undefined' ? window : this, function() {
  'use strict';

  var COMPONENTES = {
    formula: {rotulo: 'Fórmula', titulo: 'Fórmula pendente'},
    bom: {rotulo: 'BOM', titulo: 'BOM pendente'},
    espec: {rotulo: 'Especificação', titulo: 'Especificação pendente'}
  };

  function porProduto(colecao) {
    var m = {};
    Object.keys(colecao || {}).forEach(function(k) {
      var r = colecao[k];
      if (!r || typeof r !== 'object') return;
      var cod = r.codProduto || String(k).split('__')[0];
      (m[cod] = m[cod] || []).push(r);
    });
    return m;
  }

  // {formula: {cod: [versões]}, bom: {...}, espec: {...}}
  function indexar(formulas, bom, especificacoes) {
    return {formula: porProduto(formulas), bom: porProduto(bom), espec: porProduto(especificacoes)};
  }

  function situacaoVersoes(versoes) {
    if (!versoes || !versoes.length) return 'SEM';
    if (versoes.some(function(r) { return r.status === 'APROVADA'; })) return 'OK';
    if (versoes.some(function(r) { return r.itens && Object.keys(r.itens).length; })) return 'A_APROVAR';
    return 'SEM';
  }

  // {formula: 'OK'|'A_APROVAR'|'SEM', bom: ..., espec: ...}
  function doProduto(codProduto, indice) {
    var i = indice || {};
    return {
      formula: situacaoVersoes((i.formula || {})[codProduto]),
      bom: situacaoVersoes((i.bom || {})[codProduto]),
      espec: situacaoVersoes((i.espec || {})[codProduto])
    };
  }

  function pendente(situacao) { return situacao === 'SEM' || situacao === 'A_APROVAR'; }

  function ativo(p) { return !!p && p.ativo === 'Ativo'; }

  /* Contagem entre os produtos ATIVOS (inativo não precisa de cadastro técnico).
     {ativos, formula:{pendente, sem, aAprovar}, bom:{...}, espec:{...}, algum} */
  function resumo(produtos, indice) {
    var out = {ativos: 0, algum: 0};
    Object.keys(COMPONENTES).forEach(function(c) { out[c] = {pendente: 0, sem: 0, aAprovar: 0}; });
    Object.keys(produtos || {}).forEach(function(k) {
      var p = produtos[k];
      if (!ativo(p)) return;
      out.ativos++;
      var s = doProduto(k, indice), qualquer = false;
      Object.keys(COMPONENTES).forEach(function(c) {
        if (s[c] === 'SEM') { out[c].sem++; out[c].pendente++; qualquer = true; }
        else if (s[c] === 'A_APROVAR') { out[c].aAprovar++; out[c].pendente++; qualquer = true; }
      });
      if (qualquer) out.algum++;
    });
    return out;
  }

  // O produto entra no filtro "pendência do componente c"? (só ativos)
  function filtra(codProduto, produto, componente, indice) {
    if (!componente) return true;
    if (!ativo(produto)) return false;
    return pendente(doProduto(codProduto, indice)[componente]);
  }

  return {COMPONENTES: COMPONENTES, indexar: indexar, situacaoVersoes: situacaoVersoes, doProduto: doProduto,
    pendente: pendente, resumo: resumo, filtra: filtra};
});
