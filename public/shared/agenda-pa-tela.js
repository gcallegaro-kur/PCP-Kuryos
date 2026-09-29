(function(root) {
  'use strict';
  function iniciar(opcoes) {
    var container = opcoes.container, agendas = {}, clientesContatos = {}, editando = null, ocupado = false;
    var e = function(v) { return escapeHtml(String(v == null ? '' : v)); };
    // Carga faturada que não coube no veículo fica EXPEDIDO_PARCIAL: continua
    // na agenda, com o saldo reservado para a mesma NF.
    var ATIVAS = ['AGENDADO', 'EXPEDIDO_PARCIAL'];
    var pendente = function(p) { return Math.max(Number(p.quantidade || 0) - Number(p.embarcado || 0), 0); };
    var dataBR = function(v) { var s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : '—'; };
    var hojeISO = function() { return new Date().toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'}); };
    var EMAIL = {ENVIADO: 'e-mail enviado', ENVIANDO: 'enviando e-mail…', SEM_DESTINATARIOS: 'e-mail NÃO enviado: configure o e-mail do Financeiro', ERRO: 'falha no e-mail'};
    function faturamentoHTML(a) {
      var f = a.faturamento || {}, html = '';
      if (!f.status) html = '<span class="agenda-fat agenda-fat-nao">Faturamento não solicitado</span>';
      else if (f.status === 'SOLICITADO') {
        var sols = Object.values(f.solicitacoes || {}), ult = sols[sols.length - 1] || {};
        html = '<span class="agenda-fat agenda-fat-sol">Faturamento solicitado ' + dataBR(f.solicitadoEm) + ' por ' + e(f.solicitadoPor) + '</span>' +
          (ult.email ? ' <span class="sub' + (ult.email.status === 'ENVIADO' ? '' : ' agenda-pa-erro') + '">' + e(EMAIL[ult.email.status] || ult.email.status) + '</span>' : '');
      } else if (f.status === 'FATURADO') {
        html = '<span class="agenda-fat agenda-fat-ok">Faturado · NF ' + e(Object.values(f.nfs || {}).map(function(n) { return n.numero + (n.serie ? '/' + n.serie : ''); }).join(', ')) + '</span>';
      }
      if (a.status === 'EXPEDIDO_PARCIAL') {
        var falta = (a.paletes || []).reduce(function(t, p) { return t + pendente(p); }, 0);
        var desde = a.aguardandoEmbarqueDesde ? Math.floor((Date.now() - Date.parse(a.aguardandoEmbarqueDesde)) / 86400000) : null;
        html += '<div class="agenda-fat agenda-fat-parcial">Aguardando embarque: ' + falta.toLocaleString('pt-BR') + ' un · ' +
          Object.keys(a.viagens || {}).length + ' viagem(ns) já saíram' + (desde != null ? ' · há ' + desde + ' dia(s)' : '') + '</div>';
      }
      return '<div>' + html + '</div>';
    }
    container.innerHTML = '<div class="agenda-pa-lista">Carregando agenda de PA…</div>' +
      '<dialog class="agenda-pa-modal"><form method="dialog"><h2>Transporte da carga</h2><div class="agenda-pa-contexto"></div>' +
      '<div class="agenda-pa-campos">' +
      [['dataAgendada','Data agendada','date'],['janela','Horário / janela','text'],['transportadora','Transportadora / prestador','text'],['motorista','Motorista','text'],['contatoMotorista','Contato do motorista','tel'],['placa','Placa','text']].map(function(f) {
        return '<label>'+e(f[1])+'<input name="'+f[0]+'" type="'+f[2]+'" '+(f[0]==='dataAgendada'?'required':'')+' maxlength="200"></label>';
      }).join('')+'</div><h3>Contato do cliente para recebimento</h3><div class="agenda-contato-cliente"></div><label>Observações<textarea name="observacoes" rows="2" maxlength="2000"></textarea></label>'+
      '<p class="agenda-pa-erro" role="status"></p><div class="agenda-pa-acoes"><button type="button" class="btn ghost" data-fechar>Fechar</button><button type="submit" class="btn">Salvar transporte</button></div></form></dialog>';

    var lista = container.querySelector('.agenda-pa-lista'), dialog = container.querySelector('dialog'), form = dialog.querySelector('form');
    var contatoUI=ContatosClienteUI.seletor(dialog.querySelector('.agenda-contato-cliente'),['LOGISTICA']);
    dbOnValue(opcoes.db.ref('clientes'),function(s){clientesContatos=s.val()||{};if(editando&&dialog.open&&!ocupado)contatoUI.carregar(clientesContatos[editando.clienteKey]||{},editando.clienteKey||editando.cliente);});
    function render() {
      var pendentes = Object.entries(agendas).filter(function(x){return ATIVAS.indexOf(x[1].status) !== -1;}).sort(function(a,b){return String(a[1].dataAgendada).localeCompare(String(b[1].dataAgendada));});
      lista.innerHTML = pendentes.map(function(x) {
        var a=x[1], total=(a.paletes||[]).reduce(function(s,p){return s+Number(p.quantidade||0);},0);
        var fat=a.faturamento||{}, parcial=a.status==='EXPEDIDO_PARCIAL';
        return '<article class="agenda-pa-item"><div><b>'+e(a.cliente)+'</b><div>'+e(a.dataAgendada)+' '+e(a.janela)+' · '+(a.paletes||[]).length+' palete(s) · '+total.toLocaleString('pt-BR')+' un</div>'+faturamentoHTML(a)+'<div class="sub">Pedido(s) '+e(Object.values(a.pedidos||{}).join(', '))+'</div><div class="sub">'+e([a.transportadora||'Transportadora a definir',a.motorista||'Motorista a definir',a.placa||'Placa a definir'].join(' · '))+(a.contatoCliente?'<div class="sub">Recebimento: '+e([a.contatoCliente.nome,a.contatoCliente.telefone,a.contatoCliente.email].filter(Boolean).join(' · '))+'</div>':'')+'</div></div>'+
          // Faturamento e saída têm telas próprias desde 29/09 (faturamento.html
          // e cargas.html): aqui ficam só o transporte e os atalhos.
          '<div class="agenda-pa-acoes"><button class="btn ghost" data-editar="'+e(x[0])+'">Transporte</button>'+
          (fat.status!=='FATURADO'&&!parcial?'<a class="btn ghost" href="faturamento.html?carga='+encodeURIComponent(x[0])+'">Faturamento</a>':'')+
          '<a class="btn" href="cargas.html?carga='+encodeURIComponent(x[0])+'">Acompanhar</a>'+
          (parcial||fat.status==='FATURADO'?'':'<button class="btn ghost" data-cancelar="'+e(x[0])+'">Cancelar agenda</button>')+'</div></article>';
      }).join('') || '<p class="sub">Nenhuma saída de PA agendada. Monte a carga em <a href="expedicao.html">Expedição — Montar carga</a>.</p>';
      lista.querySelectorAll('[data-editar]').forEach(function(b){b.onclick=function(){
        editando=JSON.parse(JSON.stringify(agendas[b.dataset.editar]));
        editando.agendaKey=b.dataset.editar;
        contatoUI.carregar(clientesContatos[editando.clienteKey]||{},editando.clienteKey||editando.cliente,editando.contatoCliente);
        ['dataAgendada','janela','transportadora','motorista','contatoMotorista','placa','observacoes'].forEach(function(k){form.elements[k].value=editando[k]||'';});
        dialog.querySelector('.agenda-pa-contexto').textContent=editando.cliente+' · '+Object.values(editando.pedidos||{}).join(', ');
        dialog.querySelector('.agenda-pa-erro').textContent='';dialog.showModal();
      };});
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
      var dados={agendaKey:editando.agendaKey,revisao:editando.revisao,tipo:editando.tipo,contatoCliente:contatoUI.valor()};
      ['dataAgendada','janela','transportadora','motorista','contatoMotorista','placa','observacoes'].forEach(function(k){dados[k]=form.elements[k].value.trim();});
      ocupado=true;contatoUI.desabilitar(true);form.querySelector('[type=submit]').disabled=true;
      try{await opcoes.fn.httpsCallable('salvarAgendamentoExpedicaoPA')(dados);dialog.close();}
      catch(err){dialog.querySelector('.agenda-pa-erro').textContent=err.message||'Não foi possível salvar. Reabra a agenda para conferir os dados atuais.';}
      finally{ocupado=false;contatoUI.desabilitar(false);form.querySelector('[type=submit]').disabled=false;}
    };
    dbOnValue(opcoes.db.ref('agendamentos_expedicao'),function(s){agendas=s.val()||{};render();if(opcoes.onAtualizar)opcoes.onAtualizar(agendas);});
    return {obter:function(k){return agendas[k];}};
  }
  root.AgendaPAUI={iniciar:iniciar};
})(window);
