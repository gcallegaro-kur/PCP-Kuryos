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
// Com localEntrega FABRICA o destino já nasce com o endereço conhecido da
// Kuryos, então os campos ficam completos -- mas a rota continua PENDENTE:
// todo portão (enviar PC, agendar) exige statusConfirmacao CONFIRMADA, e só a
// confirmação explícita no editor grava isso.
assert.ok(RotasPC.validarRota(sugerida).pronto, 'destino Kuryos vem preenchido do cadastro');
assert.equal(sugerida.destino.localKey, 'FABRICA');
assert.equal(sugerida.destino.fonte, 'KURYOS_CADASTRO_SUGERIDO');
assert.notEqual(sugerida.statusConfirmacao, 'CONFIRMADA', 'preencher não é confirmar');
const semLocal = RotasPC.rotaInicial({naturezaMovimentacao:'COMPRA_KURYOS',fornecedorKey:'f1',frete:{tipo:'FOB'}}, fornecedor);
assert.ok(!RotasPC.validarRota(semLocal).pronto, 'sem local de entrega o destino ainda precisa ser informado');

// ── Locais da Kuryos: padrão, cadastro editável por cima e escopo ──────
const fabricaPadrao = RotasPC.localKuryos('FABRICA');
assert.equal(fabricaPadrao.endereco.logradouro, 'Rua Lagoa Tai Grande');
assert.equal(fabricaPadrao.endereco.numero, '1130');
assert.equal(fabricaPadrao.cnpj, '00.767.554/0001-19');
assert.equal(fabricaPadrao.entidadeTipo, 'KURYOS');
assert.equal(RotasPC.localKuryos('GALPAO').endereco.logradouro, 'Rua Benedito Coelho Netto');
assert.equal(RotasPC.localKuryos('GALPAO').endereco.numero, '211');
assert.equal(RotasPC.localKuryos('OUTRO'), null);
// Mudança de endereço: o cadastro salvo vence o padrão, campo a campo.
const mudou = RotasPC.localKuryos('FABRICA', {nome: 'Fábrica Kuryos (nova)', endereco: {cep: '01310-100', logradouro: 'Av. Paulista', numero: '1000', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP'}, contatoNome: 'Portaria'});
assert.equal(mudou.endereco.logradouro, 'Av. Paulista');
assert.equal(mudou.nome, 'Fábrica Kuryos (nova)');
assert.equal(mudou.contatoNome, 'Portaria');
assert.equal(mudou.cnpj, '00.767.554/0001-19', 'campo não salvo no cadastro mantém o padrão');
const rotaComCadastro = RotasPC.rotaInicial({localEntrega: 'FABRICA', frete: {tipo: 'CIF'}}, fornecedor, {FABRICA: {endereco: {logradouro: 'Av. Paulista', numero: '1000', cep: '01310-100', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP'}}});
assert.equal(rotaComCadastro.destino.endereco.logradouro, 'Av. Paulista', 'rotaInicial usa o cadastro vivo');
// O padrão não é contaminado por quem altera o local devolvido.
fabricaPadrao.endereco.numero = 'X';
assert.equal(RotasPC.localKuryos('FABRICA').endereco.numero, '1130');

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
