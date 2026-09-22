(function(){
  var modal, atual;
  function el(tag,text){var n=document.createElement(tag);if(text)n.textContent=text;return n;}
  window.abrirRearranjoLinhas=function(origem,lote){
    if(!window.currentUser || window.currentUser.role!=='admin') return;
    if(modal)modal.remove();
    atual={origem:origem,lote:lote,operacaoId:'rl_'+Date.now()+'_'+Math.random().toString(36).slice(2)};
    modal=el('div');modal.className='modal-overlay open';modal.id='rearranjoLinhasModal';
    var box=el('div');box.className='modal';box.style.cssText='max-width:540px;width:calc(100% - 24px);padding:24px;max-height:90vh;overflow:auto;background:var(--card);border-radius:12px';
    box.appendChild(el('h2','Rearranjar linhas'));
    box.appendChild(el('p','OP '+lote+' · '+origem));
    box.appendChild(el('p','Pause a produção e registre toda a quantidade produzida antes de transferir. Os apontamentos anteriores continuam na linha original; a OP permanece pausada no destino até a retomada manual.'));
    var label=el('label','Linha de destino');label.htmlFor='rearranjoDestino';box.appendChild(label);
    var select=el('select');select.id='rearranjoDestino';select.style.cssText='width:100%;margin:8px 0;padding:10px';
    select.appendChild(new Option('Selecione...',''));
    configLinhas.filter(function(l){return l!==origem;}).forEach(function(l){var op=opAlocadoEm(l,'linha');select.appendChild(new Option(l+(op?' · trocar com OP '+op.lote:' · livre'),l));});box.appendChild(select);
    var resumo=el('p');resumo.id='rearranjoResumo';box.appendChild(resumo);
    select.onchange=function(){var op=opAlocadoEm(select.value,'linha');atual.loteDestino=op?op.lote:'';resumo.textContent=op?'Troca: OP '+lote+' vai para '+select.value+' e OP '+op.lote+' vem para '+origem+'. As duas linhas precisam estar pausadas.':'A '+origem+' ficará livre para outra produção.';};
    var motivo=el('textarea');motivo.id='rearranjoMotivo';motivo.placeholder='Motivo do rearranjo';motivo.maxLength=1000;motivo.style.cssText='width:100%;margin:12px 0;padding:10px';box.appendChild(motivo);
    var check=el('input');check.type='checkbox';check.id='rearranjoConferido';var checkLabel=el('label');checkLabel.appendChild(check);checkLabel.appendChild(document.createTextNode(' Conferi os apontamentos: não há quantidade produzida pendente nas OPs envolvidas.'));box.appendChild(checkLabel);
    var erro=el('p');erro.id='rearranjoErro';erro.style.color='var(--danger)';box.appendChild(erro);
    var salvar=el('button','Confirmar rearranjo');salvar.className='btn-submit';salvar.style.marginTop='16px';box.appendChild(salvar);
    var cancelar=el('button','Cancelar');cancelar.className='btn-cancel';cancelar.style.marginTop='8px';cancelar.onclick=function(){modal.remove();modal=null;};box.appendChild(cancelar);
    salvar.onclick=async function(){
      erro.textContent='';
      if(!select.value || !motivo.value.trim() || !check.checked){erro.textContent='Selecione o destino, informe o motivo e confira os apontamentos.';return;}
      salvar.disabled=true;cancelar.disabled=true;
      try{
        await firebase.functions().httpsCallable('rearranjarLinhas')(Object.assign({},atual,{destino:select.value,motivo:motivo.value.trim(),trocar:!!atual.loteDestino,apontamentosConferidos:true}));
        modal.remove();modal=null;showSuccess('Rearranjo concluído','OPs e pausas transferidas. Histórico preservado.');
      }catch(e){erro.textContent=e.message || 'Não foi possível transferir. Tente novamente.';salvar.disabled=false;cancelar.disabled=false;}
    };
    modal.appendChild(box);document.body.appendChild(modal);
  };
})();
