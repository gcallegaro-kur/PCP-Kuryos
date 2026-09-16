(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./contatos-cliente'));
  else root.ClienteComercial = factory(root.ContatosCliente);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(ContatosCliente) {
  'use strict';
  function endereco(v) {
    if (typeof v === 'string') return v.trim();
    if (!v || typeof v !== 'object') return '';
    return [v.logradouro || v.rua, v.numero, v.complemento, v.bairro,
      [v.cidade || v.municipio, v.uf].filter(Boolean).join(' / '), v.cep].filter(Boolean).join(', ');
  }
  function dados(c, contatoId) {
    c = c || {};
    var contato = contatoId === undefined ? ContatosCliente.sugerir(c) : ContatosCliente.lista(c).find(function(p){return p.id===contatoId;});
    contato=contato||{};
    var geral = endereco(c.endereco) || (c.logradouro ? endereco(c) : '');
    return {
      pContato: contato.nome || '',
      pTelefone: contato.telefone || '',
      pEmail: contato.email || '',
      pEntrega: endereco(c.enderecoEntrega) || geral,
      pFaturamento: endereco(c.enderecoFaturamento) || geral,
      pPagamento: c.condicaoPagamento || ''
    };
  }
  return {dados: dados, endereco: endereco};
});
