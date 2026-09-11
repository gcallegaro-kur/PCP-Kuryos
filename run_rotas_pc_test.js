const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = __dirname;
const RotasPC = require(path.join(root, 'public', 'shared', 'rotas-pc.js'));

function local(nome) {
  return {
    entidadeTipo: 'OUTRO', nome,
    endereco: {cep:'13480-000',logradouro:'Rua Teste',numero:'10',complemento:'',bairro:'Centro',cidade:'Limeira',uf:'SP',pais:'BR'},
    contatoNome:'Maria', contatoTelefone:'(19) 99999-0000', horarioAtendimento:'08h às 16h', referencia:'Portaria 2', instrucoes:''
  };
}

const fornecedor = {nomeFantasia:'Fornecedor A',cnpj:'00.000.000/0001-00',cep:'13480-000',logradouro:'Rua A',numero:'25',bairro:'Centro',cidade:'Limeira',uf:'SP',contatoNome:'João',contatoTelefone:'19999990000'};
const sugerida = RotasPC.rotaInicial({naturezaMovimentacao:'COMPRA_KURYOS',fornecedorKey:'f1',frete:{tipo:'FOB'},localEntrega:'FABRICA'}, fornecedor);
assert.equal(sugerida.origem.fonte, 'CADASTRO_SUGERIDO');
assert.equal(sugerida.statusConfirmacao, 'PENDENTE');
assert.equal(sugerida.responsavelTransporte, 'KURYOS');
assert.ok(!RotasPC.validarRota(sugerida).pronto, 'destino ainda precisa ser confirmado');

const fob = RotasPC.normalizarRota({natureza:'COMPRA_KURYOS',responsavelTransporte:'KURYOS',incoterm:'FOB',origem:local('Fornecedor'),destino:local('Fábrica')});
assert.ok(RotasPC.validarRota(fob).pronto);
const semContato = RotasPC.normalizarRota(fob); semContato.origem.contatoTelefone = '';
assert.ok(RotasPC.validarRota(semContato).faltando.includes('origem: telefone do local'));

const cif = RotasPC.normalizarRota({natureza:'COMPRA_KURYOS',responsavelTransporte:'REMETENTE',incoterm:'CIF',origem:{},destino:local('Fábrica')});
assert.ok(RotasPC.validarRota(cif).pronto, 'CIF não bloqueia pela origem');
const remessa = RotasPC.normalizarRota({natureza:'REMESSA_CLIENTE',responsavelTransporte:'REMETENTE',incoterm:'FOB',origem:local('Cliente'),destino:local('Fábrica')});
assert.equal(remessa.incoterm, null, 'remessa não recebe rótulo fiscal FOB/CIF');
assert.ok(RotasPC.validarRota(remessa).pronto);

const congelada = JSON.parse(JSON.stringify(sugerida));
fornecedor.logradouro = 'Rua alterada depois';
assert.equal(congelada.origem.endereco.logradouro, 'Rua A', 'snapshot não acompanha alteração do cadastro');
const efetiva = RotasPC.normalizarRota(fob); efetiva.destino.endereco.numero = '99';
assert.ok(!RotasPC.rotasIguais(fob, efetiva));
assert.ok(RotasPC.urlMapa(fob.destino).includes('google.com/maps/search'));

function checkInlineScripts(file) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  scripts.forEach((code, i) => new vm.Script(code, {filename:file + '#script-' + i}));
  return html;
}
const compras = checkInlineScripts(path.join(root, 'public', 'compras.html'));
const logistica = checkInlineScripts(path.join(root, 'public', 'logistica.html'));
assert.ok(compras.includes("statusConfirmacao = 'CONFIRMADA'"));
assert.ok(compras.includes("/rota'] = rotaEditada"));
assert.ok(compras.includes('montarDocumentoPedidoCompraComRota'));
assert.ok(logistica.includes('rotaEfetiva'));
assert.ok(logistica.includes('alteracoesRota'));
assert.ok(logistica.includes('motivoRota.length < 10'));
console.log('OK: rotas de PC, travas, snapshot, PDF e exceção auditada na Logística.');
