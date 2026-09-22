(function(){
  'use strict';
  var cache={},modal,ready=false;
  var nomes={pausado:'Pausado',em_andamento:'Em andamento',aguardando_qualidade:'Aguardando Qualidade'};
  function el(tag,text,cls){var n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;}
  function date(v){return v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';}
  function admin(){return window.currentUser && window.currentUser.role==='admin';}
  function podeExecutar(){var u=window.currentUser || {};return ['admin','production','pcp'].includes(u.role) || !!(u.modulos && u.modulos.apontamento);}
  function button(text,fn){var b=el('button',text,'andon-btn btn-neutral');b.type='button';b.onclick=fn;return b;}
  function card(linha,state){
    var r=cache[state.retrabalhoId];var c=el('div',null,'andon-card '+(state.status==='parada'?'stopped':'active'));
    c.appendChild(el('div',linha,'andon-line-title'));
    c.appendChild(el('div','Retrabalho · OP '+(r?r.loteOriginal:state.lote),'turno-op-lote'));
    c.appendChild(el('p',r?r.produto:state.produto));
    c.appendChild(el('p',state.status==='parada'?(state.motivoParada+' · desde '+date(state.inicioParada)):'Em andamento'));
    if(r){c.appendChild(el('p',r.escopo+' · '+r.quantidadeConfirmada+' un. conferidas'+(r.apontamentosPendentes?' · quantidade pendente':'') ));c.appendChild(button('Ver retrabalho / apontamentos',function(){abrir(r.id);}));}
    else c.appendChild(el('p','Carregando retrabalho…'));
    return c;
  }
  function painel(){
    var linhas=document.getElementById('secaoTurnoLinhas');if(!linhas)return;
    var section=document.getElementById('retrabalhosPainel');
    if(!section){section=el('section',null,'card');section.id='retrabalhosPainel';linhas.after(section);}
    section.replaceChildren();var ids=Object.keys(cache);section.style.display=ids.length?'':'none';
    section.appendChild(el('h3','Retrabalhos'));
    section.appendChild(el('p','Apontamentos próprios, sem somar novamente à produção da OP original.'));
    ids.sort().reverse().forEach(function(id){var r=cache[id];section.appendChild(button('OP '+r.loteOriginal+' · '+r.linha+' · '+(nomes[r.status]||r.status)+(r.apontamentosPendentes?' · quantidade pendente':''),function(){abrir(id);}));});
  }
  function abrir(id){
    var r=cache[id];if(!r)return;
    if(modal)modal.remove();
    modal=el('div',null,'modal-overlay open');modal.id='retrabalhoModal';
    var box=el('div',null,'modal');box.style.cssText='padding:22px;max-width:640px;max-height:90vh;overflow:auto';modal.appendChild(box);
    box.appendChild(el('h2','Retrabalho · OP '+r.loteOriginal));box.appendChild(el('p',r.produto+' · '+r.linha+' · '+(nomes[r.status]||r.status)));
    box.appendChild(el('p','Motivo: '+r.motivo));box.appendChild(el('p','Escopo: '+r.escopo+'. Referência da OP original: '+r.quantidadeOriginalRegistrada+' unidades registradas.'));
    box.appendChild(el('p','Setup: '+date(r.setupInicio)+' → '+date(r.setupFim)+'. Envase desde '+date(r.envaseInicio)+'.'));
    box.appendChild(el('p','Retrabalhado confirmado: '+r.quantidadeConfirmada+' un. · '+r.apontamentosPendentes+' apontamento(s) com quantidade pendente.'));
    var lista=el('div');lista.id='rtApontamentos';box.appendChild(lista);
    var registros=Object.entries(r.apontamentos || {}).sort(function(a,b){return a[1].inicio.localeCompare(b[1].inicio);});
    registros.forEach(function(entry){var a=entry[1];lista.appendChild(el('p',date(a.inicio)+' → '+date(a.fim)+' · '+a.linha+' · '+(a.quantidadePendente?'Quantidade pendente':a.quantidade+' un.')));});
    var controls=el('div');controls.style.cssText='margin-top:18px;display:grid;gap:10px';box.appendChild(controls);
    var erro=el('p');erro.id='rtErro';erro.style.color='var(--danger)';box.appendChild(erro);
    var fechar=button('Fechar',function(){modal.remove();modal=null;});box.appendChild(fechar);
    var lastSignature,lastId;
    async function enviar(acao,extra){
      erro.textContent='';var payload=Object.assign({retrabalhoId:id,revisao:r.revisao,acao:acao},extra || {});
      var signature=JSON.stringify(payload);if(signature!==lastSignature){lastSignature=signature;lastId='rt_'+Date.now()+'_'+Math.random().toString(36).slice(2);}
      payload.operacaoId=lastId;box.querySelectorAll('button').forEach(function(b){b.disabled=true;});
      try{await firebase.functions().httpsCallable('apontarRetrabalho')(payload);modal.remove();modal=null;showSuccess('Retrabalho atualizado','O apontamento foi salvo sem alterar a quantidade fabricada da OP original.');}
      catch(e){erro.textContent=e.message || 'Falha ao gravar. Tente novamente.';box.querySelectorAll('button').forEach(function(b){b.disabled=false;});}
    }
    function field(label,id,type){var l=el('label',label),input=el(type==='textarea'?'textarea':'input');input.id=id;if(type!=='textarea')input.type=type;input.style.cssText='display:block;width:100%;padding:10px;margin-top:4px';l.appendChild(input);controls.appendChild(l);return input;}
    if(admin() && registros.length){
      var label=el('label','Corrigir quantidade de um apontamento'),select=el('select');select.id='rtRegistro';select.style.cssText='display:block;width:100%;padding:10px';label.appendChild(select);controls.appendChild(label);
      registros.forEach(function(entry){select.appendChild(new Option(date(entry[1].inicio)+' → '+date(entry[1].fim)+(entry[1].quantidadePendente?' · pendente':''),entry[0]));});
      var pending=registros.find(function(entry){return entry[1].quantidadePendente;});if(pending)select.value=pending[0];
      var qtd=field('Quantidade feita apenas nesse período (não acumulada)','rtQuantidade','number');qtd.min='0';qtd.step='1';
      function fill(){var a=r.apontamentos[select.value];qtd.value=a.quantidadePendente?'':a.quantidade;}select.onchange=fill;fill();
      var motivo=field('Motivo da correção','rtMotivoCorrecao','text');motivo.value='Conferência da quantidade retrabalhada';
      controls.appendChild(button('Salvar quantidade conferida',function(){if(qtd.value==='' || !motivo.value.trim()){erro.textContent='Informe a quantidade conferida e o motivo.';return;}enviar('corrigir_quantidade',{apontamentoId:select.value,quantidade:qtd.value,motivo:motivo.value});}));
    }
    if(podeExecutar() && r.status==='pausado'){
      controls.appendChild(el('p','A pausa permanece aberta até você confirmar a retomada.'));
      controls.appendChild(button('Retomar retrabalho agora',function(){if(confirm('Retomar o retrabalho na '+r.linha+' agora?'))enviar('retomar');}));
      if(!r.apontamentosPendentes){var obs=field('Observação ao encerrar a execução','rtObsFim','textarea');controls.appendChild(button('Encerrar execução — aguardar Qualidade',function(){if(!obs.value.trim()){erro.textContent='Informe a observação do encerramento.';return;}if(confirm('Encerrar o retrabalho, liberar a linha e deixá-lo aguardando Qualidade?'))enviar('finalizar',{motivo:obs.value});}));}
    } else if(podeExecutar() && r.status==='em_andamento'){
      var nova=field('Quantidade retrabalhada desde a retomada (deixe vazio se pendente)','rtNovaQuantidade','number');nova.min='0';nova.step='1';
      var operador=field('Operador','rtOperador','text');
      var pausa=field('Motivo da pausa','rtMotivoPausa','text');pausa.value='Fim de turno';
      controls.appendChild(button('Salvar período e pausar',function(){if(!pausa.value.trim()){erro.textContent='Informe o motivo da pausa.';return;}enviar('pausar',{quantidade:nova.value,motivo:pausa.value,operador:operador.value});}));
    } else if(r.status==='aguardando_qualidade') controls.appendChild(el('p','Execução encerrada. A liberação da Qualidade e eventuais ajustes de estoque devem ser registrados no fluxo de Qualidade; este painel não libera nem duplica estoque.'));
    box.querySelectorAll('p').forEach(function(p){p.style.cssText='font-size:14px;line-height:1.5;margin-top:6px';});
    document.body.appendChild(modal);
  }
  function iniciar(){if(ready)return;ready=true;dbOnValue(db.ref('retrabalhos'),function(snap){cache=snap.val() || {};painel();if(typeof renderPainelTurno==='function')renderPainelTurno();});}
  function bloqueada(linha){return !!(window.latestAndonStates && latestAndonStates[sanitizeKey(linha)] && latestAndonStates[sanitizeKey(linha)].retrabalhoId);}
  function avisar(linha){if(!bloqueada(linha))return false;alert('Esta linha está em retrabalho. Use “Ver retrabalho / apontamentos” no Painel de Turno.');return true;}
  window.RetrabalhosTela={iniciar:iniciar,card:card,abrir:abrir,avisar:avisar,bloqueada:bloqueada};
  document.addEventListener('DOMContentLoaded',function(){
    iniciar();
    [['prodForm','fLinha'],['retroForm','rLinha'],['opForm','opLinha']].forEach(function(pair){var form=document.getElementById(pair[0]);if(form)form.addEventListener('submit',function(e){var input=document.getElementById(pair[1]);if(input && avisar(input.value)){e.preventDefault();e.stopImmediatePropagation();}},true);});
  });
})();
