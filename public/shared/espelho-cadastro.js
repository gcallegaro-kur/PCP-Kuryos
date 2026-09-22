/* Espelho de cadastro: cliente que também é fornecedor, e vice-versa.

   Pedido do usuário (2026-09-21): "via um botão dentro do cadastro individual
   do item, ter a opção de duplicar o cadastro para cliente também fornecedor
   ou fornecedor também cliente".

   A tela JÁ tinha o vínculo manual (`fornecedorVinculadoKey` no cliente,
   `clienteVinculadoKey` no fornecedor) -- o que faltava era criar o outro
   lado sem digitar tudo de novo. Este módulo só TRADUZ um cadastro no outro;
   quem grava é a tela, depois que a pessoa confere. São dois cadastros
   ligados, não um só: o cliente tem código, detentor ANVISA e contatos por
   área; o fornecedor tem tipos, prazo de entrega e endereço estruturado.

   Funções puras, testadas em run_espelho_cadastro_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(typeof require === 'function' ? require('./contatos-cliente.js') : null);
  else root.EspelhoCadastro = factory(root.ContatosCliente);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(ContatosCliente) {
  'use strict';

  function texto(v) { return String(v == null ? '' : v).trim(); }
  function digitos(v) { return texto(v).replace(/\D/g, ''); }
  function semAcento(v) {
    return texto(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  }

  // Mesmo CNPJ = mesma empresa. CNPJ vazio nunca casa com vazio.
  function mesmoCnpj(a, b) {
    var x = digitos(a), y = digitos(b);
    return !!x && x === y;
  }
  /* Acha o cadastro da mesma empresa do outro lado: primeiro pelo CNPJ
     (inclusive os adicionais do fornecedor), depois pelo nome exato. Serve
     para oferecer VINCULAR em vez de criar um cadastro duplicado. */
  function acharEquivalente(registros, alvo, campos) {
    var nomes = (campos || ['nome']);
    var cnpjAlvo = digitos(alvo && alvo.cnpj);
    // O alvo pode vir do outro lado (cliente tem `nome`, fornecedor tem
    // `nomeFantasia`/`razaoSocial`): aceita qualquer um dos dois vocabulários.
    var nomeAlvo = semAcento(['nome', 'nomeFantasia', 'razaoSocial'].concat(nomes)
      .map(function(c) { return alvo && alvo[c]; }).filter(Boolean)[0]);
    var achadoNome = null;
    var chaves = Object.keys(registros || {});
    for (var i = 0; i < chaves.length; i++) {
      var k = chaves[i], r = registros[k] || {};
      var cnpjs = [r.cnpj].concat((r.cnpjsAdicionais || []).map(function(x) { return x && (x.cnpj || x); }));
      if (cnpjAlvo && cnpjs.some(function(c) { return digitos(c) === cnpjAlvo; })) return {key: k, registro: r, por: 'cnpj'};
      if (!achadoNome && nomeAlvo) {
        var nomeR = nomes.map(function(c) { return r[c]; }).filter(Boolean)[0];
        if (semAcento(nomeR) === nomeAlvo) achadoNome = {key: k, registro: r, por: 'nome'};
      }
    }
    return achadoNome;
  }

  /* Código do cliente a partir do nome: o cliente é chaveado por código
     (`sanitizeKey(codigo)`), o fornecedor não tem código nenhum. Primeira
     palavra útil, sem acento, até 12 caracteres, e com sufixo quando o
     código já existir. */
  var IGNORAR = ['COMERCIO', 'COMERCIAL', 'INDUSTRIA', 'INDUSTRIAL', 'LTDA', 'ME', 'EIRELI', 'SA', 'S/A', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E'];
  function codigoSugerido(nome, existentes) {
    var palavras = semAcento(nome).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
      .filter(function(p) { return IGNORAR.indexOf(p) < 0; });
    var base = (palavras.join('').slice(0, 12)) || 'CLIENTE';
    var usados = {};
    Object.keys(existentes || {}).forEach(function(k) {
      var c = texto((existentes[k] || {}).codigo).toUpperCase();
      if (c) usados[c] = true;
    });
    if (!usados[base]) return base;
    for (var i = 2; i < 100; i++) {
      var tentativa = (base.slice(0, 11) + i);
      if (!usados[tentativa]) return tentativa;
    }
    return base + Date.now().toString().slice(-3);
  }

  function contatoPrincipal(cliente) {
    if (!ContatosCliente) return null;
    return ContatosCliente.sugerir(cliente, ['COMERCIAL', 'COMPRAS', 'FINANCEIRO', 'LOGISTICA', 'TECNICO', 'OUTRA']);
  }

  /* Cliente -> Fornecedor. O endereço do cliente é texto livre ("Rua X, 100,
     centro..."), e o do fornecedor é estruturado (CEP, logradouro, número).
     Partir a string daria endereço errado com cara de certo: copia como
     aviso, para a pessoa preencher pelo CEP. */
  function paraFornecedor(cliente, opcoes) {
    var c = cliente || {}, o = opcoes || {};
    var p = contatoPrincipal(c) || {};
    var avisos = [];
    var endereco = texto(c.enderecoFaturamento) || texto(c.enderecoEntrega);
    if (endereco) avisos.push('O endereço do cliente é um texto só e o do fornecedor é separado por CEP, logradouro e número — preencha pelo CEP. Endereço do cliente: ' + endereco);
    if (!texto(c.cnpj)) avisos.push('Cliente sem CNPJ: confira antes de salvar, é o que evita cadastro duplicado.');
    return {
      dados: {
        razaoSocial: texto(c.nome),
        nomeFantasia: texto(c.nome),
        cnpj: texto(c.cnpj),
        condicaoPagamento: texto(c.condicaoPagamento),
        site: texto(c.site),
        cidade: texto(c.cidade),
        uf: texto(c.uf).toUpperCase(),
        contatoNome: texto(p.nome),
        contatoTelefone: texto(p.telefone),
        contatoEmail: texto(p.email),
        ativo: c.ativo !== false,
        clienteVinculadoKey: texto(o.origemKey) || null
      },
      avisos: avisos
    };
  }

  /* Fornecedor -> Cliente. O contato único do fornecedor vira contato de
     área COMERCIAL do cliente (formato novo de contatos). */
  function paraCliente(fornecedor, opcoes) {
    var f = fornecedor || {}, o = opcoes || {};
    var nome = texto(f.nomeFantasia) || texto(f.razaoSocial);
    var avisos = [];
    var endereco = [texto(f.logradouro), texto(f.numero), texto(f.complemento), texto(f.bairro), texto(f.cidade), texto(f.uf), f.cep ? 'CEP ' + texto(f.cep) : '']
      .filter(Boolean).join(', ');
    if (!texto(f.cnpj)) avisos.push('Fornecedor sem CNPJ: confira antes de salvar, é o que evita cadastro duplicado.');
    var dados = {
      nome: nome,
      codigo: texto(o.codigo) || codigoSugerido(nome, o.clientes),
      cnpj: texto(f.cnpj),
      cidade: texto(f.cidade),
      uf: texto(f.uf).toUpperCase(),
      condicaoPagamento: texto(f.condicaoPagamento),
      site: texto(f.site),
      // Endereço do fornecedor é estruturado: dá para montar o texto do
      // cliente sem inventar nada.
      enderecoFaturamento: endereco,
      enderecoEntrega: endereco,
      detentorAnvisa: 'cliente',
      ativo: f.ativo !== false,
      fornecedorVinculadoKey: texto(o.origemKey) || null
    };
    var contato = {nome: texto(f.contatoNome), email: texto(f.contatoEmail), telefone: texto(f.contatoTelefone)};
    if (ContatosCliente && (contato.nome || contato.email || contato.telefone)) {
      Object.assign(dados, ContatosCliente.salvar([
        {id: 'do_fornecedor', nome: contato.nome, email: contato.email, telefone: contato.telefone,
         areas: ['COMERCIAL'], principais: ['COMERCIAL'], observacoes: 'Contato copiado do cadastro de fornecedor.'}
      ]));
    }
    return {dados: dados, avisos: avisos, contato: contato};
  }

  return {
    mesmoCnpj: mesmoCnpj, acharEquivalente: acharEquivalente, codigoSugerido: codigoSugerido,
    paraFornecedor: paraFornecedor, paraCliente: paraCliente
  };
});
