(function(root) {
  'use strict';
  function iniciar(opcoes) {
    var container = opcoes.container, agendas = {}, editando = null, ocupado = false;
    var e = function(v) { return escapeHtml(String(v == null ? '' : v)); };
    container.innerHTML = '<div class="agenda-pa-lista">Carregando agenda de PA…</div>' +
      '<dialog class="agenda-pa-modal"><form method="dialog"><h2>Transporte da carga</h2><div class="agenda-pa-contexto"></div>' +
      '<div class="agenda-pa-campos">' +
      [['dataAgendada','Data agendada','date'],['janela','Horário / janela','text'],['transportadora','Transportadora / prestador','text'],['motorista','Motorista','text'],['contatoMotorista','Contato do motorista','tel'],['placa','Placa','text']].map(function(f) {
        return '<label>'+e(f[1])+'<input name="'+f[0]+'" type="'+f[2]+'" '+(f[0]==='dataAgendada'?'required':'')+' maxlength="200"></label>';
      }).join('')+'</div><label>Observações<textarea name="observacoes" rows="2" maxlength="2000"></textarea></label>'+
      '<p class="agenda-pa-erro" role="status"></p><div class="agenda-pa-acoes"><button type="button" class="btn ghost" data-fechar>Fechar</button><button type="submit" class="btn">Salvar transporte</button></div></form></dialog>';
    var lista = container.querySelector('.agenda-pa-lista'), dialog = container.querySelector('dialog'), form = dialog.querySelector('form');
    function render() {
      var pendentes = Object.entries(agendas).filter(function(x){return x[1].status === 'AGENDADO';}).sort(function(a,b){return String(a[1].dataAgendada).localeCompare(String(b[1].dataAgendada));});
      lista.innerHTML = pendentes.map(function(x) {
        var a=x[1], total=(a.paletes||[]).reduce(function(s,p){return s+Number(p.quantidade||0);},0);
        return '<article class="agenda-pa-item"><div><b>'+e(a.cliente)+'</b><div>'+e(a.dataAgendada)+' '+e(a.janela)+' · '+(a.paletes||[]).length+' palete(s) · '+total.toLocaleString('pt-BR')+' un</div><div class="sub">Pedido(s) '+e(Object.values(a.pedidos||{}).join(', '))+'</div><div class="sub">'+e([a.transportadora||'Transportadora a definir',a.motorista||'Motorista a definir',a.placa||'Placa a definir'].join(' · '))+'</div></div>'+
          '<div class="agenda-pa-acoes"><button class="btn ghost" data-editar="'+e(x[0])+'">Transporte</button>'+
          (opcoes.onAbrir?'<button class="btn" data-abrir="'+e(x[0])+'">Abrir carga</button>':'<a class="btn" href="expedicao.html?agenda='+encodeURIComponent(x[0])+'">Abrir na Expedição</a>')+
          '<button class="btn ghost" data-cancelar="'+e(x[0])+'">Cancelar agenda</button></div></article>';
      }).join('') || '<p class="sub">Nenhuma saída de PA agendada. Selecione os paletes na <a href="expedicao.html">Expedição</a> e escolha Agendar carga.</p>';
      lista.querySelectorAll('[data-editar]').forEach(function(b){b.onclick=function(){
        editando=JSON.parse(JSON.stringify(agendas[b.dataset.editar]));
        editando.agendaKey=b.dataset.editar;
        ['dataAgendada','janela','transportadora','motorista','contatoMotorista','placa','observacoes'].forEach(function(k){form.elements[k].value=editando[k]||'';});
        dialog.querySelector('.agenda-pa-contexto').textContent=editando.cliente+' · '+Object.values(editando.pedidos||{}).join(', ');
        dialog.querySelector('.agenda-pa-erro').textContent='';dialog.showModal();
      };});
      lista.querySelectorAll('[data-abrir]').forEach(function(b){b.onclick=function(){opcoes.onAbrir(b.dataset.abrir,agendas[b.dataset.abrir]);};});
      lista.querySelectorAll('[data-cancelar]').forEach(function(b){b.onclick=async function(){
        if(ocupado) return;
        var a=agendas[b.dataset.cancelar], motivo=prompt('Motivo do cancelamento da agenda (o estoque permanece intacto):');
        if(!motivo) return;
        ocupado=true;b.disabled=true;
        try {await opcoes.fn.httpsCallable('salvarAgendamentoExpedicaoPA')({agendaKey:b.dataset.cancelar,revisao:a.revisao,cancelar:true,motivo:motivo});}
        catch(err){opcoes.onErro(err.message||'Não foi possível cancelar a agenda.');}
        finally{ocupado=false;b.disabled=false;}
      };});
    }
    form.querySelector('[data-fechar]').onclick=function(){if(!ocupado)dialog.close();};
    dialog.addEventListener('cancel',function(ev){if(ocupado)ev.preventDefault();});
    form.onsubmit=async function(ev){
      ev.preventDefault();if(ocupado||!editando)return;
      var dados={agendaKey:editando.agendaKey,revisao:editando.revisao,tipo:editando.tipo};
      ['dataAgendada','janela','transportadora','motorista','contatoMotorista','placa','observacoes'].forEach(function(k){dados[k]=form.elements[k].value.trim();});
      ocupado=true;form.querySelector('[type=submit]').disabled=true;
      try{await opcoes.fn.httpsCallable('salvarAgendamentoExpedicaoPA')(dados);dialog.close();}
      catch(err){dialog.querySelector('.agenda-pa-erro').textContent=err.message||'Não foi possível salvar. Reabra a agenda para conferir os dados atuais.';}
      finally{ocupado=false;form.querySelector('[type=submit]').disabled=false;}
    };
    dbOnValue(opcoes.db.ref('agendamentos_expedicao'),function(s){agendas=s.val()||{};render();if(opcoes.onAtualizar)opcoes.onAtualizar(agendas);});
    return {obter:function(k){return agendas[k];}};
  }
  root.AgendaPAUI={iniciar:iniciar};
})(window);
