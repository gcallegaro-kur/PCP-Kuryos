'use strict';
// PLAYWRIGHT_MODULE pode apontar para a instalação compartilhada do host.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {fixture} = require('./run_expedicao_test');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page=await browser.newPage({viewport:{width:1360,height:1000}}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const data=fixture();
    data.estoque_lotes.PA001.bloqueado={...data.estoque_lotes.PA001.pa_op1_p1,identificadorPalete:'PA-BLOQUEADO',status:'QUARENTENA'};
    await page.addInitScript(data=>{
      window.fixtureExp=data;window.callsExp=[];window.listenersExp={};
      window.firebase={initializeApp(){},database(){return{ref(path){return{path};}};},functions(){return{httpsCallable(name){return async payload=>{window.callsExp.push({name,payload});if(window.callsExp.length===1)throw Object.assign(new Error('Conexão interrompida'),{code:'functions/unavailable'});return{data:{numero:'EXP-TESTE'}};};}};}};
      window.kuryosDatabaseURL=x=>x;window.kuryosConnectEmulatorsIfLocal=()=>{};
      window.escapeHtml=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      window.dbOnValue=(ref,cb)=>{window.listenersExp[ref.path]=cb;cb({val:()=>structuredClone(data[ref.path]||{})});};
    },data);
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname!=='expedicao.test')return route.fulfill({body:'',contentType:'text/javascript'});
      const name=url.pathname.slice(1);
      if(name==='auth_check.js'||name==='shared/utils.js')return route.fulfill({body:'',contentType:'text/javascript'});
      const file='public/'+name;
      if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
      return route.fulfill({body:fs.readFileSync(file),contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript'});
    });
    await page.goto('https://expedicao.test/expedicao.html');
    assert.match(await page.locator('#contagem').innerText(),/1 disponível.*1 com pendências/);
    assert.equal(await page.locator('[data-palete]').count(),1);
    await page.locator('#bloqueados').check();
    assert.equal(await page.locator('[data-palete]:disabled').count(),1);
    await page.locator('[data-palete="PA001/pa_op1_p1"]').check();
    assert.match(await page.locator('#resumo').innerText(),/295 unidades/);
    assert.match(await page.locator('#resumo').innerText(),/PED-001/);
    await page.evaluate(()=>{fixtureExp.estoque_lotes.PA001.pa_op1_p1.saldoLote=290;listenersExp.estoque_lotes({val:()=>fixtureExp.estoque_lotes});});
    assert.equal(await page.locator('[data-palete]:checked').count(),0);
    assert.match(await page.locator('#resultado').innerText(),/retirado/);
    await page.locator('[data-palete="PA001/pa_op1_p1"]').check();
    page.on('dialog',d=>d.accept());
    await page.locator('#salvar').click();
    await page.waitForFunction(()=>document.getElementById('salvar').textContent.includes('repetir'));
    await page.reload();
    await page.locator('#salvar').click();
    await page.waitForFunction(()=>document.getElementById('salvar').textContent.includes('repetir'));
    await page.locator('#salvar').click();
    await page.waitForFunction(()=>document.getElementById('resultado').textContent.includes('Saída confirmada'));
    const calls=await page.evaluate(()=>callsExp);
    assert.equal(calls[0].payload.idempotencyKey,calls[1].payload.idempotencyKey);
    assert.equal(calls[1].payload.paletes[0].quantidade,290);
    assert.equal(calls[1].name,'confirmarExpedicaoPA');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('expedicaoPA-tentativa')),null);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Tela deve caber no celular');
    assert.deepEqual(errors,[]);
    console.log('OK UI Expedição: seleção real, bloqueio CQ, atualização concorrente, recuperação após reload, callable, confirmação e celular.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
