'use strict';
// Execute da raiz do projeto. Sem --apply, apenas faz backup e ensaia a correção.
const fs=require('fs');const path=require('path');const assert=require('node:assert/strict');
const {isDeepStrictEqual}=require('node:util');
const root=path.resolve(__dirname,'..');const admin=require(path.join(root,'functions/node_modules/firebase-admin'));
const {corrigirCaso26216}=require(path.join(root,'functions/retrabalhos'));
admin.initializeApp({credential:admin.credential.cert(require(path.join(root,'firebase-service-account.json'))),databaseURL:'https://prod-kuryos-default-rtdb.firebaseio.com'});
const selecionados=b=>({opFalsa:b.ops['26160-04'],opOriginal:b.ops['26216-04'],linha:b.estado_linhas.Linha_2,pedido:b.pedidos['0007__DPHNPC01']});
(async()=>{
  const db=admin.database(),antes=(await db.ref().get()).val(),agora=new Date().toISOString();
  const backup=path.join(root,'backups','correcao-rt26216-'+Date.now()+'.json');fs.writeFileSync(backup,JSON.stringify(antes));
  const ensaio=structuredClone(antes),plano=corrigirCaso26216(ensaio,agora);
  console.log(JSON.stringify({backup,retrabalhoId:plano.id,repetida:plano.repetida,setup:'21/09 15:42',envase:'21/09 16:00',pausa:'21/09 17:09',quantidade:'pendente',modo:process.argv.includes('--apply')?'aplicar':'ensaio'}));
  if(!process.argv.includes('--apply') || plano.repetida){await admin.app().delete();return;}
  let falha=null,resultado=null;
  const res=await db.ref().transaction(base=>{
    falha=null;resultado=null;if(!base)return base;
    try{if(!isDeepStrictEqual(selecionados(base),selecionados(antes)))throw new Error('Registros-alvo mudaram desde o backup; correção abortada.');resultado=corrigirCaso26216(base,agora);return base;}catch(e){falha=e;return;}
  },undefined,false);
  if(falha)throw falha;if(!res.committed||!resultado)throw new Error('Correção não confirmada.');
  const depois=(await db.ref().get()).val(),rt=depois.retrabalhos[plano.id];
  assert.deepEqual(depois.ops['26216-04'],antes.ops['26216-04']);
  assert.equal(depois.ops['26160-04'].status,'Programado');assert.equal(depois.ops['26160-04'].abertaDesde,undefined);
  assert.equal(depois.estado_linhas.Linha_2.retrabalhoId,plano.id);assert.equal(depois.estado_linhas.Linha_2.inicioParada,'2026-09-21T20:09:00.000Z');
  assert.equal(rt.apontamentos['envase-20260921'].quantidadePendente,true);assert.equal(rt.apontamentos['envase-20260921'].quantidade,undefined);
  assert.equal(depois.pedidos['0007__DPHNPC01'].produzido,0);
  console.log('APLICADO E REVALIDADO: linha 2 em retrabalho pausado; OP original preservada; OP fictícia devolvida a Programado; quantidade pendente.');
  await admin.app().delete();
})().catch(e=>{console.error(e.message);process.exit(1)});
