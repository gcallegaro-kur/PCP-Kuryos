(function(root){
  'use strict';
  function e(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function editor(container){
    var contatos=[];
    function render(){
      container.innerHTML=contatos.map(function(p,i){return '<section class="contato-card" data-contato="'+e(p.id)+'"><div class="form-grid">'+[['nome','Nome'],['email','E-mail'],['telefone','Telefone / WhatsApp'],['observacoes','Observações / horários']].map(function(f){return '<label>'+f[1]+'<input data-campo="'+f[0]+'" value="'+e(p[f[0]])+'"></label>';}).join('')+'</div><div class="contato-areas">'+Object.entries(ContatosCliente.areas).map(function(a){return '<label><input type="checkbox" data-area="'+a[0]+'" '+(p.areas.includes(a[0])?'checked':'')+'> '+a[1]+'</label>';}).join('')+'</div>'+(p.areas.includes('OUTRA')?'<label>Nome da outra área<input data-campo="outraArea" value="'+e(p.outraArea)+'"></label>':'')+'<div class="contato-areas">'+p.areas.map(function(a){return '<label><input type="checkbox" data-principal="'+a+'" '+(p.principais.includes(a)?'checked':'')+'> Principal · '+e(ContatosCliente.areas[a])+'</label>';}).join('')+'</div><button type="button" class="btn btn-ghost btn-sm" data-remover="'+i+'">Remover contato</button></section>';}).join('')+'<button type="button" class="btn btn-ghost" data-adicionar>+ Adicionar contato</button>';
      container.querySelector('[data-adicionar]').onclick=function(){contatos.push({id:'ct_'+crypto.randomUUID(),nome:'',email:'',telefone:'',areas:[],principais:[],observacoes:'',outraArea:''});render();};
      container.querySelectorAll('[data-contato]').forEach(function(card){var p=contatos.find(function(c){return c.id===card.dataset.contato;});
        card.querySelectorAll('[data-campo]').forEach(function(input){input.oninput=function(){p[input.dataset.campo]=input.value;};});
        card.querySelectorAll('[data-area]').forEach(function(input){input.onchange=function(){var a=input.dataset.area;p.areas=input.checked?p.areas.concat(a):p.areas.filter(function(x){return x!==a;});p.principais=p.principais.filter(function(x){return p.areas.includes(x);});render();};});
        card.querySelectorAll('[data-principal]').forEach(function(input){input.onchange=function(){var a=input.dataset.principal;contatos.forEach(function(c){c.principais=c.principais.filter(function(x){return x!==a;});});if(input.checked)p.principais.push(a);render();};});
        card.querySelector('[data-remover]').onclick=function(){contatos=contatos.filter(function(c){return c.id!==p.id;});render();};
      });
    }
    return {carregar:function(c){contatos=ContatosCliente.lista(c);render();},dados:function(){return ContatosCliente.salvar(contatos);}};
  }
  function seletor(container,preferidas){
    var cliente={}, selecionado=null, clienteKey=null, editado=false, congelado=false;
    container.innerHTML='<label>Área do contato do cliente<select data-area><option value="">Todas as áreas</option>'+Object.entries(ContatosCliente.areas).map(function(x){return '<option value="'+x[0]+'">'+x[1]+'</option>';}).join('')+'</select></label><label>Contato do cliente<select data-pessoa></select></label><div class="contato-campos">'+[['nome','Nome'],['email','E-mail'],['telefone','Telefone / WhatsApp']].map(function(x){return '<label>'+x[1]+'<input data-valor="'+x[0]+'"></label>';}).join('')+'</div><div data-observacoes class="sub"></div>';
    var area=container.querySelector('[data-area]'),pessoa=container.querySelector('[data-pessoa]');
    function opcoes(){var ls=ContatosCliente.lista(cliente).filter(function(p){return !area.value||p.areas.includes(area.value);});pessoa.innerHTML='<option value="">Preenchimento manual</option>'+ls.map(function(p){return '<option value="'+e(p.id)+'">'+e(ContatosCliente.rotulo(p))+'</option>';}).join('');if(selecionado&&selecionado.id&&!ls.some(function(p){return p.id===selecionado.id;}))pessoa.innerHTML+='<option value="'+e(selecionado.id)+'">'+e(selecionado.nome||'Contato registrado')+' (selecionado)</option>';pessoa.value=selecionado&&selecionado.id||'';}
    function preencher(p){selecionado=p?JSON.parse(JSON.stringify(p)):null;['nome','email','telefone'].forEach(function(k){container.querySelector('[data-valor='+k+']').value=p&&p[k]||'';});container.querySelector('[data-observacoes]').textContent=p&&p.observacoes||'';opcoes();}
    area.onchange=opcoes;pessoa.onchange=function(){editado=true;preencher(ContatosCliente.lista(cliente).find(function(p){return p.id===pessoa.value;})||null);};
    container.querySelectorAll('[data-valor]').forEach(function(input){input.oninput=function(){editado=true;};});
    return {carregar:function(c,key,salvo){cliente=c||{};if(key!==clienteKey||arguments.length>2){clienteKey=key;editado=false;congelado=arguments.length>2&&salvo!==undefined;area.value='';preencher(salvo===undefined?ContatosCliente.sugerir(cliente,preferidas):salvo);}else if(!selecionado&&!editado&&!congelado){preencher(ContatosCliente.sugerir(cliente,preferidas));}else opcoes();},valor:function(){var v={};['nome','email','telefone'].forEach(function(k){v[k]=container.querySelector('[data-valor='+k+']').value.trim();});return ContatosCliente.snapshot(selecionado,v);},desabilitar:function(v){container.querySelectorAll('input,select').forEach(function(el){el.disabled=v;});}};
  }
  root.ContatosClienteUI={editor:editor,seletor:seletor};
})(window);
