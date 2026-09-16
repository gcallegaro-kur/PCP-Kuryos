(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ContatosCliente=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var areas={COMERCIAL:'Comercial',COMPRAS:'Compras',TECNICO:'Técnico / Desenvolvimento',LOGISTICA:'Logística',FINANCEIRO:'Financeiro',OUTRA:'Outra'};
  function texto(v){return typeof v==='string'?v.trim():'';}
  function lista(c){
    c=c||{};
    if(c.contatosVersao===1)return Object.entries(c.contatos||{}).map(function(x){return Object.assign({},x[1],{id:x[0],areas:(x[1].areas||[]).slice(),principais:(x[1].principais||[]).slice()});});
    var ls=[];
    [['comercial','COMERCIAL',c.contatoComNome||c.contato,c.contatoComEmail||c.email,c.contatoComTelefone||c.telefone],['tecnico','TECNICO',c.contatoTecNome,c.contatoTecEmail,c.contatoTecTelefone]].forEach(function(x){
      if(!x[2]&&!x[3]&&!x[4])return;
      var igual=ls.find(function(p){return p.nome===(x[2]||'')&&p.email===(x[3]||'')&&p.telefone===(x[4]||'');});
      if(igual){igual.areas.push(x[1]);igual.principais.push(x[1]);}
      else ls.push({id:'legado_'+x[0],nome:x[2]||'',email:x[3]||'',telefone:x[4]||'',areas:[x[1]],principais:[x[1]],observacoes:'',outraArea:''});
    });
    return ls;
  }
  function sugerir(c,preferidas){var ls=lista(c);for(var area of preferidas||['COMERCIAL','COMPRAS']){var candidatos=ls.filter(function(p){return p.areas.includes(area);});if(candidatos.length)return candidatos.find(function(p){return p.principais.includes(area);})||candidatos[0];}return null;}
  function rotulo(p){return (p.nome||p.email||p.telefone||'Contato')+' — '+(p.areas||[]).map(function(a){return a==='OUTRA'?(p.outraArea||'Outra'):areas[a]||a;}).join(', ');}
  function salvar(ls){
    var contatos={},principais={};
    ls.forEach(function(p){
      if(!/^[A-Za-z0-9_-]+$/.test(p.id||'')||contatos[p.id])throw Error('Identificador de contato inválido ou duplicado.');
      var nome=texto(p.nome),email=texto(p.email),telefone=texto(p.telefone),as=Array.from(new Set(p.areas||[]));
      if(!nome&&!email&&!telefone)throw Error('Informe nome, e-mail ou telefone em cada contato.');
      if(!as.length||as.some(function(a){return !areas[a];}))throw Error('Selecione ao menos uma área para cada contato.');
      if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Confira o e-mail de '+(nome||email)+'.');
      if(as.includes('OUTRA')&&!texto(p.outraArea))throw Error('Informe o nome da outra área.');
      var ps=Array.from(new Set(p.principais||[])).filter(function(a){return as.includes(a);});
      ps.forEach(function(a){if(principais[a])throw Error('Escolha somente um contato principal para '+areas[a]+'.');principais[a]=p.id;});
      contatos[p.id]={nome:nome,email:email,telefone:telefone,areas:as,principais:ps,outraArea:as.includes('OUTRA')?texto(p.outraArea):'',observacoes:texto(p.observacoes)};
    });
    var atualizado={contatosVersao:1,contatos:contatos},com=sugerir(atualizado,['COMERCIAL'])||{},tec=sugerir(atualizado,['TECNICO'])||{};
    // Espelhos mantêm leitores antigos funcionando; a lista é a fonte principal.
    return Object.assign(atualizado,{contatoComNome:com.nome||'',contatoComEmail:com.email||'',contatoComTelefone:com.telefone||'',contatoTecNome:tec.nome||'',contatoTecEmail:tec.email||'',contatoTecTelefone:tec.telefone||''});
  }
  function snapshot(p,campos){return Object.assign({id:p&&p.id||null,areas:p&&p.areas?p.areas.slice():[],outraArea:p&&p.outraArea||'',observacoes:p&&p.observacoes||''},{nome:campos?campos.nome:p&&p.nome||'',email:campos?campos.email:p&&p.email||'',telefone:campos?campos.telefone:p&&p.telefone||''});}
  return {areas:areas,lista:lista,sugerir:sugerir,rotulo:rotulo,salvar:salvar,snapshot:snapshot};
});
