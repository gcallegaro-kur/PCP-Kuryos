(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClienteComercial = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  function endereco(v) {
    if (typeof v === 'string') return v.trim();
    if (!v || typeof v !== 'object') return '';
    return [v.logradouro || v.rua, v.numero, v.complemento, v.bairro,
      [v.cidade || v.municipio, v.uf].filter(Boolean).join(' / '), v.cep].filter(Boolean).join(', ');
  }
  function dados(c) {
    c = c || {};
    var geral = endereco(c.endereco) || (c.logradouro ? endereco(c) : '');
    return {
      pContato: c.contatoComNome || c.contato || '',
      pTelefone: c.contatoComTelefone || c.telefone || '',
      pEmail: c.contatoComEmail || c.email || '',
      pEntrega: endereco(c.enderecoEntrega) || geral,
      pFaturamento: endereco(c.enderecoFaturamento) || geral,
      pPagamento: c.condicaoPagamento || ''
    };
  }
  return {dados: dados, endereco: endereco};
});
