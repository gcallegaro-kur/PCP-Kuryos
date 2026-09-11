'use strict';
const assert = require('node:assert/strict');
const {prepararAgenda, agendaDaSaida} = require('./functions/agenda_expedicao');
const agora='2026-09-11T18:00:00Z';
function fixture(){return {estoque_lotes:{SKU:{p1:{itemTipo:'produto',origemTipo:'conferencia_pa',identificadorPalete:'PA-1',saldoLote:7,
  status:'LIBERADO_EXPEDICAO',qualidade:{decisao:'LIBERADO_EXPEDICAO'},opKey:'op',itemCodigo:'SKU',enderecoKey:'a',conferencia:{finalizacaoId:'f'}}}},
  ops:{op:{status:'Concluído',sku:'SKU',skuPedidoKey:'PED__SKU'}},conferencias_pa:{op:{finalizadoEm:agora,finalizacaoId:'f'}},
  enderecos_estoque:{a:{ativo:true,codigo:'PA-A1'}},pedidos:{PED__SKU:{parentPedidoId:'PED',id:'PED',sku:'SKU',cliente:'Cliente'}}};}
const paletes=[{itemKey:'SKU',loteKey:'p1',quantidade:7,enderecoKey:'a',skuPedidoKey:'PED__SKU'}];
const dados={agendaKey:'agenda_001',revisao:0,dataAgendada:'2026-09-20',tipo:'ENTREGA',paletes,transportadora:'Transporte A',motorista:'João',placa:'abc1d23'};
const salvar=(b,d=dados)=>prepararAgenda(b,d,'Logística','u1',agora);
const b=fixture(), agenda=salvar(b);
assert.equal(agenda.revisao,1);assert.equal(agenda.placa,'ABC1D23');assert.equal(agenda.paletes[0].quantidade,7);
assert.equal(b.estoque_lotes.SKU.p1.saldoLote,7,'Agendar não baixa nem reserva estoque físico');
b.agendamentos_expedicao={agenda_001:agenda};
assert.throws(()=>salvar(b),/mudou/);
assert.throws(()=>salvar(b,{...dados,agendaKey:'agenda_002'}),/outra carga/);
assert.throws(()=>agendaDaSaida(b,{paletes}),/Abra o agendamento/);
assert.throws(()=>agendaDaSaida(b,{agendaKey:'agenda_001',agendaRevisao:0,paletes}),/mudaram/);
assert.equal(agendaDaSaida(b,{agendaKey:'agenda_001',agendaRevisao:1,paletes}).motorista,'João');
assert.throws(()=>agendaDaSaida(b,{agendaKey:'agenda_001',agendaRevisao:1,paletes:[]}),/todos os paletes/);
const editada=salvar(b,{...dados,revisao:1,motorista:'Maria',placa:'DEF4G56'});
assert.equal(editada.revisao,2);assert.equal(editada.historico.r1.motorista,'João');assert.equal(editada.historico.r2.motorista,'Maria');
b.estoque_lotes.SKU.p1.status='RETIDO';
assert.equal(salvar(b,{...dados,revisao:1}).status,'AGENDADO','Transporte pode ser ajustado enquanto CQ resolve uma pendência');
const cancelada=salvar(b,{agendaKey:'agenda_001',revisao:1,cancelar:true,motivo:'Cliente adiou a coleta'});
assert.equal(cancelada.status,'CANCELADO');assert.equal(b.estoque_lotes.SKU.p1.saldoLote,7);
b.agendamentos_expedicao.agenda_001=cancelada;
assert.throws(()=>salvar(b,{...dados,revisao:2}),/encerrada/);
assert.throws(()=>salvar(fixture(),{...dados,dataAgendada:'2026-02-30'}),/data válida/);
assert.throws(()=>salvar(fixture(),{...dados,paletes:[...paletes,...paletes]}),/duplicado/);
console.log('OK agenda PA: criação, transporte compartilhado, revisão concorrente, duplicidade, cancelamento e seleção integral.');

// Handler real: o retry da transação relê a revisão e as permissões atuais.
async function testarHandler(){
  const fs=require('node:fs'), vm=require('node:vm');
  let state=fixture(), race=null;
  state.usuarios={u1:{role:'logistica',nome:'Logística'}};
  const db={ref(path=''){return {once:async()=>({val:()=>path?path.split('/').reduce((n,k)=>n&&n[k],state):structuredClone(state)}),
    transaction:async cb=>{assert.equal(cb(null),null);let result=cb(structuredClone(state));if(race){race(state);race=null;result=cb(structuredClone(state));}if(result){state=result;return {committed:true};}return {committed:false};}};}};
  const src=fs.readFileSync('functions/index.js','utf8'), code=src.slice(src.indexOf('exports.salvarAgendamentoExpedicaoPA ='),src.indexOf('// A transação engloba'));
  const ctx={exports:{},db,prepararAgenda,onCall:(_,fn)=>fn,HttpsError:class extends Error{constructor(code,msg){super(msg);this.code=code;}},Date:class extends Date{constructor(...args){super(...(args.length?args:[agora]));}}};
  vm.runInNewContext(code,ctx);const handler=ctx.exports.salvarAgendamentoExpedicaoPA;
  await assert.rejects(()=>handler({data:dados}),/Faça login/);
  const req={auth:{uid:'u1',token:{}},data:dados};
  const r=await handler(req);assert.equal(r.revisao,1);assert.equal(state.estoque_lotes.SKU.p1.saldoLote,7);
  race=s=>{s.agendamentos_expedicao.agenda_001.revisao=2;};
  await assert.rejects(()=>handler({...req,data:{...dados,revisao:1}}),/mudou/);
  assert.equal(state.agendamentos_expedicao.agenda_001.revisao,2);
  race=s=>{s.usuarios.u1.role='production';};
  await assert.rejects(()=>handler({...req,data:{...dados,revisao:2}}),/revogada/);
  assert.equal(state.agendamentos_expedicao.agenda_001.revisao,2);
  assert.equal(JSON.parse(fs.readFileSync('database.rules.json','utf8')).rules.agendamentos_expedicao['.write'],false);
  console.log('OK handler agenda: autenticação, permissão atual, revisão concorrente e estoque preservado.');
}
testarHandler().catch(err=>{console.error(err);process.exitCode=1;});
