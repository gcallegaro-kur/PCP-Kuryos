'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page=await browser.newPage();const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://contatos.test/**',route=>{
      const name=new URL(route.request().url()).pathname.slice(1);
      return route.fulfill(name?{body:fs.readFileSync('public/shared/'+name),contentType:name.endsWith('.css')?'text/css':'text/javascript'}:{contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="contatos-cliente.css"><div id="editor"></div><div id="seletor"></div><script src="contatos-cliente.js"></script><script src="contatos-cliente-ui.js"></script>'});
    });
    await page.goto('https://contatos.test/');
    await page.evaluate(()=>{
      window.editor=ContatosClienteUI.editor(document.getElementById('editor'));
      editor.carregar({contatoComNome:'Ana',contatoComEmail:'ana@example.com'});
      window.seletor=ContatosClienteUI.seletor(document.getElementById('seletor'),['LOGISTICA']);
    });
    await page.locator('[data-adicionar]').click();
    const card=page.locator('[data-contato]').last();
    await card.locator('[data-campo=nome]').fill('Bruno');
    await card.locator('[data-area=LOGISTICA]').check();
    await card.locator('[data-area=COMERCIAL]').check();
    await card.locator('[data-principal=COMERCIAL]').check();
    await card.locator('[data-principal=LOGISTICA]').check();
    const saved=await page.evaluate(()=>window.saved=editor.dados());
    assert.equal(saved.contatoComNome,'Bruno');
    assert.deepEqual(saved.contatos.legado_comercial.principais,[]);
    assert.equal(Object.keys(saved.contatos).length,2);
    await page.evaluate(()=>{seletor.carregar({},'c1');seletor.carregar(saved,'c1');});
    const nome=page.locator('#seletor [data-valor=nome]');
    assert.equal(await nome.inputValue(),'Bruno','Cadastro que chega depois deve sugerir o contato');
    await nome.fill('Nome desta carga');
    await page.evaluate(()=>seletor.carregar(saved,'c1'));
    assert.equal(await nome.inputValue(),'Nome desta carga');
    await page.locator('#seletor [data-pessoa]').selectOption('');
    await page.evaluate(()=>seletor.carregar(saved,'c1'));
    assert.equal(await nome.inputValue(),'','Preenchimento manual vazio deve ser preservado');
    await page.evaluate(()=>{seletor.carregar(saved,'c1',null);seletor.carregar(saved,'c1');});
    assert.equal(await nome.inputValue(),'','Agenda sem contato não deve ganhar outra pessoa silenciosamente');
    await page.evaluate(()=>{
      seletor.carregar(saved,'c1',{id:'removido',nome:'Contato da agenda',telefone:'123',areas:['LOGISTICA'],observacoes:'Até 16h'});
      seletor.carregar(saved,'c1');
    });
    assert.equal(await nome.inputValue(),'Contato da agenda');
    await page.locator('#seletor [data-area]').selectOption('COMERCIAL');
    assert.equal(await nome.inputValue(),'Contato da agenda','Filtrar não altera o contato escolhido');
    assert.equal((await page.evaluate(()=>seletor.valor())).observacoes,'Até 16h');
    await card.locator('[data-remover]').click();
    assert.equal(Object.keys((await page.evaluate(()=>editor.dados())).contatos).length,1);
    assert.deepEqual(errors,[]);
    console.log('OK UI contatos: legado, múltiplas áreas, principal único, remoção, chegada tardia, ajustes manuais e contato salvo preservado.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
