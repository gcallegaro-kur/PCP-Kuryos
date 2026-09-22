const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, 'public', 'shared', 'espelho-cadastro.js'));
const Contatos = require(path.join(__dirname, 'public', 'shared', 'contatos-cliente.js'));

const cliente = {
  nome: 'MISS RÔSE COSMÉTICOS LTDA', codigo: 'MISS', cnpj: '12.345.678/0001-90',
  cidade: 'São Paulo', uf: 'sp', condicaoPagamento: '30/60', site: 'www.missrose.com.br',
  enderecoFaturamento: 'Rua das Flores, 100, sala 2, Centro, São Paulo/SP, CEP 01000-000',
  enderecoEntrega: 'Rod. dos Bandeirantes, km 30, Jundiaí/SP',
  detentorAnvisa: 'cliente', ativo: true,
  contatosVersao: 1,
  contatos: {
    c1: {nome: 'Ana Compras', email: 'ana@miss.com', telefone: '11 9999-0000', areas: ['COMPRAS'], principais: ['COMPRAS']},
    c2: {nome: 'Bruno Comercial', email: 'bruno@miss.com', telefone: '11 8888-0000', areas: ['COMERCIAL'], principais: ['COMERCIAL']}
  }
};
const fornecedor = {
  razaoSocial: 'EMBALAGENS ARAÇÁ INDUSTRIA E COMERCIO LTDA', nomeFantasia: 'Araçá Pack',
  cnpj: '98765432000155', cnpjsAdicionais: [{cnpj: '98.765.432/0002-36', observacao: 'filial'}],
  cep: '01310100', logradouro: 'Av. Paulista', numero: '900', complemento: 'conj. 12', bairro: 'Bela Vista',
  cidade: 'São Paulo', uf: 'SP', condicaoPagamento: '28 DDL', site: 'aracapack.com.br',
  contatoNome: 'Carla Vendas', contatoEmail: 'carla@aracapack.com.br', contatoTelefone: '11 7777-0000',
  tipos: ['EMBALAGEM'], prazoEntregaDias: 15, ativo: true
};

// ── Cliente -> Fornecedor ───────────────────────────────────────────────
{
  const r = E.paraFornecedor(cliente, {origemKey: 'MISS'});
  assert.equal(r.dados.razaoSocial, 'MISS RÔSE COSMÉTICOS LTDA');
  assert.equal(r.dados.nomeFantasia, 'MISS RÔSE COSMÉTICOS LTDA');
  assert.equal(r.dados.cnpj, '12.345.678/0001-90');
  assert.equal(r.dados.uf, 'SP', 'UF sempre maiúscula');
  assert.equal(r.dados.condicaoPagamento, '30/60');
  assert.equal(r.dados.clienteVinculadoKey, 'MISS', 'já nasce ligado ao cliente de origem');
  assert.equal(r.dados.contatoNome, 'Bruno Comercial', 'contato comercial é o principal do fornecedor');
  assert.equal(r.dados.contatoEmail, 'bruno@miss.com');
  // O endereço não é chutado: vira aviso com o texto original.
  assert.equal(r.dados.logradouro, undefined);
  assert.match(r.avisos[0], /endereço do cliente é um texto só/i);
  assert.match(r.avisos[0], /Rua das Flores, 100/);

  // Cliente sem contato e sem CNPJ: avisa, não inventa.
  const magro = E.paraFornecedor({nome: 'CLIENTE NOVO'}, {});
  assert.equal(magro.dados.contatoNome, '');
  assert.equal(magro.dados.clienteVinculadoKey, null);
  assert.equal(magro.dados.ativo, true);
  assert.match(magro.avisos[0], /sem CNPJ/);
  assert.equal(E.paraFornecedor({nome: 'X', ativo: false}, {}).dados.ativo, false, 'inativo continua inativo');
}

// ── Fornecedor -> Cliente ───────────────────────────────────────────────
{
  const r = E.paraCliente(fornecedor, {origemKey: '-Fk1', clientes: {a: {codigo: 'ARACA'}}});
  assert.equal(r.dados.nome, 'Araçá Pack', 'nome fantasia na frente da razão social');
  assert.equal(r.dados.codigo, 'ARACAPACK', 'código sem acento, sem espaço');
  assert.equal(r.dados.cnpj, '98765432000155');
  assert.equal(r.dados.fornecedorVinculadoKey, '-Fk1');
  assert.equal(r.dados.detentorAnvisa, 'cliente');
  assert.equal(r.dados.enderecoFaturamento, 'Av. Paulista, 900, conj. 12, Bela Vista, São Paulo, SP, CEP 01310100');
  assert.equal(r.dados.enderecoEntrega, r.dados.enderecoFaturamento);
  // O contato único do fornecedor vira contato COMERCIAL do cliente.
  const contatos = Contatos.lista(r.dados);
  assert.equal(contatos.length, 1);
  assert.deepEqual([contatos[0].nome, contatos[0].areas, contatos[0].principais], ['Carla Vendas', ['COMERCIAL'], ['COMERCIAL']]);
  assert.equal(r.dados.contatoComNome, 'Carla Vendas', 'campo legado continua preenchido');

  // Fornecedor sem contato: cliente sem contato, sem quebrar.
  const semContato = E.paraCliente({razaoSocial: 'FORNECEDOR X LTDA', cnpj: '1'}, {clientes: {}});
  assert.equal(Contatos.lista(semContato.dados).length, 0);
  assert.equal(semContato.dados.codigo, 'FORNECEDORX');
}

// ── Código do cliente ───────────────────────────────────────────────────
{
  assert.equal(E.codigoSugerido('EMBALAGENS ARAÇÁ INDUSTRIA E COMERCIO LTDA', {}), 'EMBALAGENSAR', '12 caracteres, sem as palavras genéricas');
  assert.equal(E.codigoSugerido('Glow Make Up', {}), 'GLOWMAKEUP');
  assert.equal(E.codigoSugerido('Glow Make Up', {a: {codigo: 'GLOWMAKEUP'}}), 'GLOWMAKEUP2', 'não repete código existente');
  assert.equal(E.codigoSugerido('Glow Make Up', {a: {codigo: 'glowmakeup'}}), 'GLOWMAKEUP2', 'compara sem caixa');
  assert.equal(E.codigoSugerido('Ltda ME', {}), 'CLIENTE', 'só palavra genérica: cai no padrão');
}

// ── Achar a mesma empresa do outro lado ─────────────────────────────────
{
  const fornecedores = {f1: fornecedor, f2: {razaoSocial: 'OUTRO', cnpj: '11111111111111'}};
  // Pelo CNPJ principal.
  const porCnpj = E.acharEquivalente(fornecedores, {cnpj: '98.765.432/0001-55'}, ['nomeFantasia', 'razaoSocial']);
  assert.equal(porCnpj.key, 'f1');
  assert.equal(porCnpj.por, 'cnpj', 'CNPJ com e sem máscara é o mesmo');
  // Pelo CNPJ adicional (matriz com mais de um CNPJ).
  assert.equal(E.acharEquivalente(fornecedores, {cnpj: '98765432000236'}, ['razaoSocial']).key, 'f1');
  // Pelo nome, quando não há CNPJ.
  const porNome = E.acharEquivalente(fornecedores, {nome: 'araçá pack'}, ['nomeFantasia', 'razaoSocial']);
  assert.equal(porNome.key, 'f1');
  assert.equal(porNome.por, 'nome');
  // CNPJ vence nome, mesmo quando o nome bate em outro registro.
  assert.equal(E.acharEquivalente(fornecedores, {cnpj: '11111111111111', nome: 'Araçá Pack'}, ['nomeFantasia', 'razaoSocial']).key, 'f2');
  assert.equal(E.acharEquivalente(fornecedores, {nome: 'NAO EXISTE'}, ['razaoSocial']), null);
  assert.equal(E.acharEquivalente({}, {cnpj: '1'}, ['nome']), null);
  // Vazio nunca casa com vazio.
  assert.equal(E.mesmoCnpj('', ''), false);
  assert.equal(E.mesmoCnpj('12.345.678/0001-90', '12345678000190'), true);
}

console.log('run_espelho_cadastro_test.js: OK');
