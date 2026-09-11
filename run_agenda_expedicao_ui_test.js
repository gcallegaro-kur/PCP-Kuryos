'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'), assert=require('node:assert/strict');
const {fixture}=require('./run_expedicao_test');
const {prepararAgenda}=require('./functions/agenda_expedicao');
const {prepararSaida}=require('./functions/expedicao');
const agora='2026-09-11T18:00:00Z';
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    let state=fixture();const pages=[],errors=[];
    state.estoque_lotes.PA001.parcial={...structuredClone(state.estoque_lotes.PA001.pa_op1_p1),identificadorPalete:'PA-SO-PARCIAL',caixasFechadas:0,unidadesCaixaParcial:7,saldoLote:7,qtdOriginal:7};
    function aplicar(updates){for(const [path,value]of Object.entries(updates)){const ps=path.split('/');let n=state;for(const p of ps.slice(0,-1))n=n[p]||(n[p]={});n[ps.at(-1)]=structuredClone(value);}}
    await context.exposeFunction('serverPA',async(name,dados)=>{
      let result;
      if(name==='salvarAgendamentoExpedicaoPA'){
        const a=prepararAgenda(state,dados,'Logística','u1',agora);state.agendamentos_expedicao=state.agendamentos_expedicao||{};state.agendamentos_expedicao[dados.agendaKey]=a;result={agendaKey:dados.agendaKey,revisao:a.revisao};
      }else if(name==='confirmarExpedicaoPA'){
        const p=prepararSaida(state,dados,'Logística','u1',agora);aplicar(p.updates);result={numero:p.carga.numero,cargaKey:p.cargaKey};
      }else throw new Error('Callable inesperada: '+name);
      for(const p of pages)await p.evaluate(state=>{for(const [no,cb]of Object.entries(window.listenersPA||{}))cb({val:()=>structuredClone(state[no]||{})});},state);
      return {data:result};
    });
    await context.addInitScript(state=>{
      window.listenersPA={};window.firebase={initializeApp(){},database(){return{ref(path){return{path};}};},functions(){return{httpsCallable(name){return data=>window.serverPA(name,data);}};}};
      window.kuryosDatabaseURL=x=>x;window.kuryosConnectEmulatorsIfLocal=()=>{};
      window.escapeHtml=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      window.dbOnValue=(ref,cb)=>{window.listenersPA[ref.path]=cb;cb({val:()=>structuredClone(state[ref.path]||{})});};
    },state);
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url()),name=url.pathname.slice(1);
      if(url.hostname!=='expedicao.test'||name==='auth_check.js'||name==='shared/utils.js')return route.fulfill({body:'',contentType:'text/javascript'});
      if(name==='agenda-logistica-test.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="shared/agenda-pa.css"><div id="agenda"></div><script src="shared/agenda-pa-tela.js"></script><script>AgendaPAUI.iniciar({container:document.getElementById("agenda"),db:firebase.database(),fn:firebase.functions(),onErro:msg=>{throw Error(msg)}});</script>'});
      if(!fs.existsSync('public/'+name))return route.fulfill({status:404,body:''});
      return route.fulfill({body:fs.readFileSync('public/'+name),contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript'});
    });
    const page=await context.newPage(), logistics=await context.newPage();pages.push(page,logistics);
    pages.forEach(p=>p.on('pageerror',err=>errors.push(err.message)));
    await page.goto('https://expedicao.test/expedicao.html');await logistics.goto('https://expedicao.test/agenda-logistica-test.html');
    assert.equal(await page.locator('#paletes tr').count(),2);
    assert.match(await page.locator('#paletes').innerText(),/12 cx × 24/);
    assert.equal(await page.locator('#paletes .partial').count(),2,'Caixa parcial fica na linha do próprio palete');
    await page.locator('[data-palete="PA001/pa_op1_p1"]').check();await page.locator('[data-palete="PA001/parcial"]').check();
    assert.match(await page.locator('#selecaoResumo').innerText(),/302 un.*12 cx completas \+ 2 parciais/);
    await page.locator('#dataAgendada').fill('2026-09-20');await page.locator('#transportadora').fill('Transporte A');await page.locator('#motorista').fill('João');await page.locator('#placa').fill('ABC1D23');
    if(process.env.EXPEDICAO_SCREENSHOT)await page.screenshot({path:process.env.EXPEDICAO_SCREENSHOT,fullPage:true});
    await page.locator('#agendar').click();await page.waitForFunction(()=>document.getElementById('resultado').textContent.includes('Carga agendada'));
    assert.equal(state.estoque_lotes.PA001.pa_op1_p1.saldoLote,295);assert.equal(state.expedicoes_comerciais,undefined);
    const agendaKey=Object.keys(state.agendamentos_expedicao)[0];
    assert.match(await logistics.locator('.agenda-pa-lista').innerText(),/Transporte A.*João.*ABC1D23/);
    await logistics.locator('[data-editar]').click();await logistics.locator('[name="motorista"]').fill('Maria');await logistics.locator('[name="placa"]').fill('DEF4G56');await logistics.locator('[type="submit"]').click();
    await page.waitForFunction(()=>document.getElementById('agendaAtiva').textContent.includes('mudaram'));
    assert.equal(await page.locator('#salvar').isDisabled(),true,'Uma revisão antiga não pode sobrescrever o transporte novo');
    await page.locator('#agendaPA [data-abrir]').click();assert.equal(await page.locator('#motorista').inputValue(),'Maria');assert.equal(await page.locator('#placa').inputValue(),'DEF4G56');
    await page.locator('#motorista').fill('Maria Silva');await page.locator('#data').fill('2026-09-11');
    page.on('dialog',d=>d.accept());await page.locator('#salvar').click();await page.waitForFunction(()=>document.getElementById('resultado').textContent.includes('Saída confirmada'));
    assert.equal(state.estoque_lotes.PA001.pa_op1_p1.saldoLote,0);assert.equal(state.estoque_lotes.PA001.parcial.saldoLote,0);
    assert.equal(state.agendamentos_expedicao[agendaKey].status,'EXPEDIDO');assert.equal(state.agendamentos_expedicao[agendaKey].motorista,'Maria Silva');
    const carga=Object.values(state.expedicoes_comerciais)[0];assert.equal(carga.totalUnidades,302);assert.equal(carga.motorista,'Maria Silva');assert.equal(carga.agendamento.motorista,'Maria');assert.equal(carga.itens[1].paleteOrigem.unidadesCaixaParcial,7);
    assert.match(await page.locator('#lista').innerText(),/Maria Silva/);assert.equal(await page.locator('#lista .partial').count(),2);
    assert.equal(await logistics.locator('[data-editar]').count(),0);
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    console.log('OK UI grade/agenda: caixas parciais, dados compartilhados em duas telas, conflito de revisão, reabertura, saída atômica, histórico e celular.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
