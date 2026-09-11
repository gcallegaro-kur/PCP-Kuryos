'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {prepararFinalizacao} = require('./functions/conferencia_pa');
const {prepararSaida} = require('./functions/expedicao');
const {analisar, listar} = require('./public/shared/expedicao');
const clone = x => JSON.parse(JSON.stringify(x));
const agora = '2026-09-11T18:00:00.000Z';
function aplicar(base, updates) {
  for (const [path, value] of Object.entries(updates)) {
    const partes = path.split('/'); let n = base;
    for (const p of partes.slice(0, -1)) n = n[p] || (n[p] = {});
    n[partes.at(-1)] = clone(value);
  }
  return base;
}
function fixture() {
  const op = {status:'Concluído', sku:'PA001', lote:'26254/01', produto:'Creme', cliente:'Cliente A', produzidoLinha:295, skuPedidoKey:'PED-001__PA001', dataFimReal:agora};
  const conf = {qtdApontada:295,contagens:{c1:{total:295,contadoEm:agora,paletes:{p1:{numero:1,caixasFechadas:12,unidadesPorCaixa:24,unidadesCaixaParcial:7,qtdUnidades:295,enderecoKey:'A1'}}}}};
  const base = {usuarios:{u1:{role:'logistica',nome:'Logística'}},ops:{op1:op},conferencias_pa:{op1:conf},enderecos_estoque:{A1:{codigo:'PA-A1',ativo:true}},estoque_lotes:{},
    pedidos:{'PED-001__PA001':{id:'PED-001',parentPedidoId:'PED-001',sku:'PA001',cliente:'Cliente A',produzido:295}},
    pedidos_comerciais:{'PED-001':{numeroFormatado:'PED-001',clienteKey:'c1',cliente:'Cliente A',status:'LIBERADO_PCP',frete:{tipo:'CIF',enderecoEntrega:'Rua A, 100'},numeroPedidoCliente:'PO-123',itens:[{sku:'PA001',qtd:600,valorUnitario:12,expedido:10}]}},clientes:{c1:{nome:'Cliente A',cnpj:'fixture'}}};
  aplicar(base,prepararFinalizacao({opKey:'op1',op,conf,enderecos:base.enderecos_estoque,lotesItem:{},autor:'Conferente',agora}).updates);
  const p=base.estoque_lotes.PA001.pa_op1_p1;
  p.status='LIBERADO_EXPEDICAO';p.qualidade={decisao:'LIBERADO_EXPEDICAO',inspecionadoPor:'CQ',em:agora};
  return base;
}
const dados = {idempotencyKey:'teste-expedicao-0001',data:'2026-09-11',tipo:'ENTREGA',paletes:[{itemKey:'PA001',loteKey:'pa_op1_p1',quantidade:295,enderecoKey:'A1',skuPedidoKey:'PED-001__PA001'}]};
const executar = (b,d=dados) => prepararSaida(b,d,'Logística','u1',agora);
const b=fixture(), plano=executar(b);
assert.equal(plano.carga.totalUnidades,295);
assert.equal(plano.carga.itens[0].pedidoNumero,'PED-001');
assert.equal(plano.carga.pedidos['PED-001'].dados.numeroPedidoCliente,'PO-123');
assert.equal(plano.carga.itens[0].paleteOrigem.unidadesCaixaParcial,7);
assert.equal(plano.carga.itens[0].producao.dataFimReal,agora);
assert.equal(plano.carga.statusFiscal,'PENDENTE');
assert.equal(plano.updates['pedidos_comerciais/PED-001/itens/0/expedido'],305);
assert.equal(plano.updates['pedidos/PED-001__PA001/expedido'],295);
assert.equal(plano.updates['estoque_lotes/PA001/pa_op1_p1/saldoLote'],0);
assert.equal(Object.values(plano.updates).filter(x=>x&&x.tipo==='expedicao_pa')[0].qtd,-295);
assert.equal(b.estoque_lotes.PA001.pa_op1_p1.saldoLote,295,'Planejar não pode mutar os dados');
aplicar(b,plano.updates);
assert.equal(executar(b).repetida,true);
assert.deepEqual(executar(b).updates,{});
assert.throws(()=>executar(b,{...dados,idempotencyKey:'teste-expedicao-0002'}),/Sem saldo/);
assert.throws(()=>prepararSaida(b,dados,'Outro','u2',agora),/outro usuário/);
b.ops.op1.produto='Alterado';assert.equal(plano.carga.itens[0].producao.produto,'Creme');
for (const [mutar, msg] of [
  [b=>{b.estoque_lotes.PA001.pa_op1_p1.status='QUARENTENA';},/Qualidade/],
  [b=>{b.estoque_lotes.PA001.pa_op1_p1.status='RETIDO';},/Qualidade/],
  [b=>{b.estoque_lotes.PA001.pa_op1_p1.status='AGUARDANDO_DESCARTE';},/Qualidade/],
  [b=>{delete b.estoque_lotes.PA001.pa_op1_p1.qualidade;},/Laudo/],
  [b=>{b.estoque_lotes.PA001.pa_op1_p1.aguardandoEnderecoDefinitivo=true;},/endereço/],
  [b=>{b.enderecos_estoque.A1.ativo=false;},/endereço/],
  [b=>{b.estoque_lotes.PA001.pa_op1_p1.validade='2026-09-10';},/vencido/],
  [b=>{b.estoque_lotes.PA001.pa_op1_p1.saldoLote=294;},/Saldo/],
  [b=>{delete b.conferencias_pa.op1.finalizadoEm;},/Conferência/],
  [b=>{b.ops.op1.skuPedidoKey='outro';},/Vínculo/],
  [b=>{delete b.pedidos['PED-001__PA001'];},/Pedido de origem/],
  [b=>{b.pedidos_comerciais['PED-001'].status='CANCELADO';},/cancelado/],
  [b=>{b.pedidos_comerciais['PED-001'].itens=[];},/Produto/],
  [b=>{b.ops.op1.status='Aguardando Confirmação';},/OP/]
]) {const x=fixture();mutar(x);assert.throws(()=>executar(x),msg);}
assert.throws(()=>executar(fixture(),{...dados,paletes:[...dados.paletes,...dados.paletes]}),/duplicado/);
assert.throws(()=>executar(fixture(),{...dados,data:'2026-09-12'}),/futura/);
assert.throws(()=>executar(fixture(),{...dados,data:'2026-02-30'}),/data válida/);
assert.throws(()=>executar(fixture(),{...dados,valorFaturado:'abc'}),/Valor/);
assert.throws(()=>executar(fixture(),{...dados,tipo:'COLETA'}),/CIF\/FOB/);
const concessao=fixture();concessao.estoque_lotes.PA001.pa_op1_p1.status='APROVADO_CONCESSAO';concessao.estoque_lotes.PA001.pa_op1_p1.qualidade.decisao='APROVADO_CONCESSAO';assert.equal(executar(concessao).carga.totalPaletes,1);
const legado=fixture();delete legado.pedidos_comerciais['PED-001'];delete legado.estoque_lotes.PA001.pa_op1_p1.skuPedidoKey;
assert.equal(executar(legado).carga.pedidos['PED-001'].origem,'pedidos');
const multi=fixture();multi.estoque_lotes.PA001.pa_op1_p2=clone(multi.estoque_lotes.PA001.pa_op1_p1);multi.estoque_lotes.PA001.pa_op1_p2.identificadorPalete='PA-P2';
const dupla={...dados,paletes:[...dados.paletes,{...dados.paletes[0],loteKey:'pa_op1_p2'}]};
assert.equal(executar(multi,dupla).updates['pedidos_comerciais/PED-001/itens/0/expedido'],600);
multi.ops.op2={...multi.ops.op1,skuPedidoKey:'PED-002__PA001'};
multi.conferencias_pa.op2=clone(multi.conferencias_pa.op1);
multi.estoque_lotes.PA001.pa_op1_p2.opKey='op2';
multi.estoque_lotes.PA001.pa_op1_p2.skuPedidoKey='PED-002__PA001';
multi.pedidos['PED-002__PA001']={...multi.pedidos['PED-001__PA001'],id:'PED-002',parentPedidoId:'PED-002'};
multi.pedidos_comerciais['PED-002']={...clone(multi.pedidos_comerciais['PED-001']),numeroFormatado:'PED-002'};
dupla.paletes[1].skuPedidoKey='PED-002__PA001';
assert.equal(Object.keys(executar(multi,dupla).carga.pedidos).length,2,'Carga pode agrupar pedidos compatíveis');
multi.pedidos_comerciais['PED-002'].clienteKey='c2';assert.throws(()=>executar(multi,dupla),/mesmo cliente/);
multi.pedidos_comerciais['PED-002'].clienteKey='c1';multi.pedidos_comerciais['PED-002'].frete.enderecoEntrega='Rua B';assert.throws(()=>executar(multi,dupla),/destinos diferentes/);
multi.pedidos_comerciais['PED-002'].frete.enderecoEntrega='Rua A, 100';multi.pedidos_comerciais['PED-002'].frete.tipo='FOB';assert.throws(()=>executar(multi,dupla),/CIF\/FOB/);
assert.equal(listar(fixture(),'2026-09-11').length,1);
assert.equal(analisar(fixture(),'PA001','pa_op1_p1','2026-09-11').disponivel,true);
assert.equal(fs.readFileSync('functions/expedicao_regras.js','utf8'),fs.readFileSync('public/shared/expedicao.js','utf8'),'Regras da UI e do servidor devem ser iguais');
assert.equal(JSON.parse(fs.readFileSync('database.rules.json')).rules.expedicoes_comerciais['.write'],false);

// Executa o handler real com um RTDB simulado; força nova tentativa depois
// de uma mudança concorrente, como faz a transaction do Firebase.
async function testarHandler() {
  let state=fixture(), race=null, txs=0;
  const fakeDb={ref(path=''){return {
    once:async()=>({val:()=>path?path.split('/').reduce((n,k)=>n&&n[k],state):clone(state)}),
    transaction:async cb=>{txs++;let proposed=cb(null);assert.equal(proposed,null);proposed=cb(clone(state));
      if(race){race(state);race=null;proposed=cb(clone(state));}
      if(proposed){state=proposed;return{committed:true};}return{committed:false};}
  };}};
  const src=fs.readFileSync('functions/index.js','utf8');
  const trecho=src.slice(src.indexOf('exports.confirmarExpedicaoPA ='),src.indexOf('const OPS_API_KEY'));
  const ctx={exports:{},onCall:(_options,fn)=>fn,db:fakeDb,HttpsError:class extends Error{constructor(code,msg){super(msg);this.code=code;}},prepararSaida,Date:class extends Date {constructor(...args){super(...(args.length?args:[agora]));}}};
  vm.runInNewContext(trecho,ctx);
  const req={auth:{uid:'u1',token:{}},data:dados}, handler=ctx.exports.confirmarExpedicaoPA;
  await assert.rejects(()=>handler({data:dados}),/Faça login/);
  const ok=await handler(req);assert.equal(ok.ok,true);assert.equal(state.estoque_lotes.PA001.pa_op1_p1.saldoLote,0);
  await handler(req);assert.equal(state.pedidos['PED-001__PA001'].expedido,295);assert.equal(Object.keys(state.expedicoes_comerciais).length,1);
  state=fixture();race=b=>{b.estoque_lotes.PA001.pa_op1_p1.status='RETIDO';};
  await assert.rejects(()=>handler(req),/Qualidade/);assert.equal(state.estoque_lotes.PA001.pa_op1_p1.saldoLote,295);assert.equal(state.expedicoes_comerciais,undefined);
  state=fixture();race=b=>{b.usuarios.u1.role='production';};await assert.rejects(()=>handler(req),/revogada/);
  assert.ok(txs>=3);
}
testarHandler().then(()=>console.log('OK Expedição PA: conferência real → paletes, rastreabilidade, baixas atômicas, concorrência, idempotência, permissões, CQ, WMS e legado.')).catch(e=>{console.error(e);process.exitCode=1;});
module.exports = {fixture, dados};
