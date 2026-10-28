/* Busca e filtros da Qualidade (27/10/2026): Fila de Inspeção e RNCs.
   Pedido do usuário: "um campo de busca, filtros a serem aplicados, pra
   facilitar encontrar o que está sendo procurado". Regras puras aqui; a tela
   (qualidade.html) monta o texto de cada item e desenha.

   Busca: sem acento, sem diferença de maiúscula, e TODAS as palavras
   digitadas precisam aparecer (em qualquer ordem e campo) -- "miss creme"
   acha "CREME ... MISS RÔSE". Antes a busca das RNCs exigia a frase exata. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FiltroQualidade = factory();
})(typeof self !== 'undefined' ? self : this, function() {
  var PRODUCAO_INTERNA = 'Produção interna';

  function normalizar(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function casaBusca(alvo, busca) {
    var termos = normalizar(busca).split(' ').filter(Boolean);
    if (!termos.length) return true;
    var t = normalizar(Array.isArray(alvo) ? alvo.join(' ') : alvo);
    return termos.every(function(x) { return t.indexOf(x) >= 0; });
  }
  // Mesmo nome com grafias diferentes (MISS RÔSE / Miss Rose) é uma opção só.
  function mesmoNome(a, b) { return normalizar(a) === normalizar(b); }
  function opcoes(valores) {
    var vistos = {}, out = [];
    (valores || []).forEach(function(v) {
      var k = normalizar(v);
      if (!k || vistos[k]) return;
      vistos[k] = true; out.push(String(v).trim());
    });
    return out.sort(function(a, b) { return normalizar(a).localeCompare(normalizar(b)); });
  }

  /* Fila. Cada item chega descrito pela tela:
     {texto: [...], fornecedor, dias, rascunho}
     Filtros: {busca, fornecedor, espera: '' | '3' | '7', situacao: '' | 'preenchimento' | 'nao_iniciado'} */
  function passaFila(item, f) {
    f = f || {};
    if (!casaBusca(item.texto || [], f.busca)) return false;
    if (f.fornecedor && !mesmoNome(item.fornecedor, f.fornecedor)) return false;
    if (f.espera) {
      if (item.dias == null || item.dias <= Number(f.espera)) return false;
    }
    if (f.situacao === 'preenchimento' && !item.rascunho) return false;
    if (f.situacao === 'nao_iniciado' && item.rascunho) return false;
    return true;
  }
  function filtrosAtivosFila(f) {
    f = f || {};
    return ['busca', 'fornecedor', 'espera', 'situacao'].filter(function(k) { return !!normalizar(f[k]); }).length;
  }

  /* RNCs. Filtros: {busca, status: 'ABERTAS' | '' | STATUS, classe, origem,
     fornecedor, de, ate (abertura, AAAA-MM-DD, inclusivos)}.
     `aberta(status)` vem da tela (RNC_STATUS). */
  function textoRnc(r) {
    return [r.numero, r.itemCodigo, r.itemNome, r.fornecedorNome, r.descricao, r.opLote, r.loteOrigem,
      r.pedidoNumero, r.acaoImediata, r.causaRaiz, r.acaoCorretiva, r.abertaPor, r.emAnalisePor,
      r.responsavelAcao, r.encerradaPor, r.motivoCancelamento, r.duplicataDe];
  }
  function passaRnc(r, f, aberta) {
    f = f || {};
    if (f.status === 'ABERTAS') { if (!aberta(r.status)) return false; }
    else if (f.status && r.status !== f.status) return false;
    if (f.classe && r.classificacao !== f.classe) return false;
    if (f.origem && r.origem !== f.origem) return false;
    if (f.fornecedor && !mesmoNome(r.fornecedorNome, f.fornecedor)) return false;
    var dia = String(r.abertaEm || '').slice(0, 10);
    if (f.de && (!dia || dia < f.de)) return false;
    if (f.ate && (!dia || dia > f.ate)) return false;
    return casaBusca(textoRnc(r), f.busca);
  }
  // O padrão das RNCs é "Abertas e em análise": não conta como filtro ligado.
  function filtrosAtivosRnc(f) {
    f = f || {};
    return ['busca', 'classe', 'origem', 'fornecedor', 'de', 'ate'].filter(function(k) { return !!normalizar(f[k]); }).length +
      (f.status !== 'ABERTAS' ? 1 : 0);
  }

  return {PRODUCAO_INTERNA: PRODUCAO_INTERNA, normalizar: normalizar, casaBusca: casaBusca, opcoes: opcoes,
    passaFila: passaFila, filtrosAtivosFila: filtrosAtivosFila,
    textoRnc: textoRnc, passaRnc: passaRnc, filtrosAtivosRnc: filtrosAtivosRnc};
});
