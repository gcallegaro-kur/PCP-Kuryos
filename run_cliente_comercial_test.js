'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const ClienteComercial=require('./public/shared/cliente-comercial');
const html=fs.readFileSync('public/comercial.html','utf8');
const cadastro=fs.readFileSync('public/cadastros.html','utf8');
for(const file of ['public/comercial.html','public/cadastros.html']) {
  for(const m of fs.readFileSync(file,'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if(m[1].trim())new vm.Script(m[1],{filename:file});
}
const cliente={nome:'Cliente A',cnpj:'123',contatoComNome:'Ana',contatoComTelefone:'1199999',contatoComEmail:'ana@teste.com',
  enderecoEntrega:'Rua Entrega, 10',enderecoFaturamento:'Rua Fiscal, 20',condicaoPagamento:'28 dias'};
assert.equal(ClienteComercial.dados(cliente).pContato,'Ana');
assert.equal(ClienteComercial.dados({contato:'Legado',email:'antigo@teste.com'}).pEmail,'antigo@teste.com');
assert.equal(ClienteComercial.dados({cidade:'São Paulo',uf:'SP'}).pEntrega,'','Cidade/UF não são endereço completo');
assert.equal(ClienteComercial.dados({endereco:{logradouro:'Rua A',numero:10,cidade:'Santos',uf:'SP'}}).pFaturamento,'Rua A, 10, Santos / SP');
const campos={};
for(const id of ['pCliente','pContato','pTelefone','pEmail','pEntrega','pFaturamento','pPagamento','pNF','pFrete','pPrazo','pData','pPO','pPrevisao','pObs','saveP'])campos[id]={value:'',disabled:false};
let gravado;
const ctx={ClienteComercial,clientes:{a:cliente,b:{nome:'Cliente B'}},produtos:{p1:{sku:'SKU-1',descricao:'Produto'}},pItens:[{key:'p1',qtd:3,valor:10}],
 document:{getElementById:id=>campos[id],querySelectorAll:()=>Object.entries(campos).filter(([id])=>!['pCliente','pNF','pFrete','pData','saveP'].includes(id)).map(([,v])=>v)},
 nextSequential:async()=>({numero:1,formatado:'PED-0001'}),db:{ref:()=>({update:async u=>{gravado=JSON.parse(JSON.stringify(u));}})},
 iso:()=> '2026-09-11T18:00:00Z',me:()=> 'Teste',evento:()=>({tipo:'LIBERADO_PCP'}),sanitizeKey:s=>s,renderPItens:()=>{},alertar:(m,erro)=>{if(erro)throw Error(m);}};
vm.createContext(ctx);
vm.runInContext(html.slice(html.indexOf('var dadosClienteAplicados'),html.indexOf('function produtosCliente()')),ctx);
vm.runInContext(html.slice(html.indexOf('function salvarPedido()'),html.indexOf('function salvarOrcamento()')),ctx);
campos.pCliente.value='a';ctx.preencherClientePedido(true);
assert.equal(campos.pTelefone.value,'1199999');assert.equal(campos.pEntrega.value,'Rua Entrega, 10');
campos.pContato.value='Ajuste no pedido';cliente.contatoComNome='Cadastro atualizado';cliente.contatoComEmail='novo@teste.com';
ctx.preencherClientePedido(false);assert.equal(campos.pContato.value,'Ajuste no pedido');assert.equal(campos.pEmail.value,'novo@teste.com');
campos.pCliente.value='b';ctx.preencherClientePedido(true);
for(const id of Object.keys(ClienteComercial.dados({})))assert.equal(campos[id].value,'','Trocar cliente deve limpar dados anteriores');
campos.pCliente.value='a';ctx.preencherClientePedido(true);campos.pContato.value='Contato desta venda';campos.pEntrega.value='Entrega excepcional';campos.pNF.value='100';campos.pFrete.value='CIF';
ctx.salvarPedido();
setImmediate(()=>{
 try {
  const p=gravado['pedidos_comerciais/PED-0001'];
  assert.equal(p.contato,'Contato desta venda');assert.equal(p.telefone,'1199999');assert.equal(p.email,'novo@teste.com');
  assert.equal(p.frete.enderecoEntrega,'Entrega excepcional');assert.equal(p.enderecoFaturamento,'Rua Fiscal, 20');assert.equal(p.prazoPagamento,'28 dias');
  assert.equal(gravado['pedidos/PED-0001__SKU-1'].frete.enderecoEntrega,'Entrega excepcional');
  assert.equal(cliente.enderecoEntrega,'Rua Entrega, 10','Pedido não deve alterar cadastro');
  assert.equal(campos.pEntrega.value,'Rua Entrega, 10','Novo pedido deve recuperar padrão cadastrado');
  cliente.enderecoFaturamento='Alteração posterior';assert.equal(p.enderecoFaturamento,'Rua Fiscal, 20');
  for(const id of ['fEnderecoEntrega-cli','fEnderecoFaturamento-cli'])assert.equal((cadastro.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
  assert.ok(cadastro.includes("enderecoEntrega: document.getElementById('fEnderecoEntrega-cli').value.trim()"));
  assert.ok(cadastro.includes("document.getElementById('fEnderecoFaturamento-cli').value = ClienteComercial.dados(c).pFaturamento"));
  assert.ok(html.includes("onchange=function(){preencherClientePedido(true);pItens=[{}];renderPItens()}"));
  console.log('OK Cliente comercial: cadastro atual/legado, endereços, troca de cliente, preservação de ajustes, gravação real do pedido/PCP e independência do cadastro.');
 }catch(e){console.error(e);process.exitCode=1;}
});
