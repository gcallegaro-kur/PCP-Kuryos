'use strict';
var db=firebase.database(), fn=firebase.functions();
var base={estoque_lotes:{},ops:{},pedidos:{},pedidos_comerciais:{},conferencias_pa:{},enderecos_estoque:{},produtos:{}};
var selecionados={}, cargas={}, agendas={}, carregados=new Set(), agendaPronta=false;
var enviando=false, tentativa=null, agendaKey=null, agendaRevisao=null, novaAgendaKey=null;
var agendaURL=new URLSearchParams(location.search).get('agenda'), selecionaveisVisiveis=[];
// Mesmo corte da fila de Conferência de PA (estoque.html): OP encerrada antes
// disso nunca passa pela conferência e não pode virar pendência falsa.
var INICIO_FLUXO_CONFERENCIA_PA='2026-09-10T00:00:00.000Z';
function el(id){return document.getElementById(id);}
function e(v){return escapeHtml(String(v==null?'':v));}
function hoje(){return new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});}
function num(v){return Number(v||0).toLocaleString('pt-BR');}
function dataBR(v){var s=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s.split('-').reverse().join('/'):'—';}
function aviso(msg,erro){el('resultado').className='notice'+(erro?' error':'');el('resultado').textContent=msg;}
function idLinha(l){return l.itemKey+'/'+l.loteKey;}
function pronto(){return carregados.size===Object.keys(base).length&&agendaPronta;}
function agendaDoPalete(k){return Object.entries(agendas).find(function(x){return x[1].status==='AGENDADO'&&(x[1].paletes||[]).some(function(p){return idLinha(p)===k;});});}
function agendaCompleta(){var a=agendas[agendaKey];return !agendaKey||a&&a.status==='AGENDADO'&&a.revisao===agendaRevisao&&(a.paletes||[]).length===Object.keys(selecionados).length&&a.paletes.every(function(p){return !!selecionados[idLinha(p)];});}
function refsSelecionadas(){return Object.values(selecionados).map(function(l){return {itemKey:l.itemKey,loteKey:l.loteKey,quantidade:Number(l.lote.saldoLote),enderecoKey:l.lote.enderecoKey,skuPedidoKey:l.skuPedidoKey};});}
function transporte(){return {transportadora:el('transportadora').value.trim(),motorista:el('motorista').value.trim(),contatoMotorista:el('contatoMotorista').value.trim(),placa:el('placa').value.trim(),observacoes:el('obs').value.trim()};}
function composicaoHTML(p){var c=ExpedicaoGrade.composicao(p);if(!c.valida)return '<span class="warning">'+e(c.texto)+'</span>';return (c.caixas?num(c.caixas)+' cx × '+num(c.multiplo):'')+(c.caixas&&c.parcial?' + ':'')+(c.parcial?'<span class="partial">1 parcial · '+num(c.parcial)+' un</span>':'');}
function kg(v){return Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:1});}
function produtoDaLinha(l){return ExpedicaoGrade.produtoDoSku(base.produtos,l.lote.itemCodigo);}
function pesoDaLinha(l){return ExpedicaoGrade.pesoPalete(l.lote,produtoDaLinha(l));}
function textoPeso(t,aproximado){return t.itens?(aproximado&&t.kg?'~':'')+kg(t.kg)+' kg'+(t.semPeso?' · '+num(t.semPeso)+' sem peso':''):'—';}
// OPs produzidas que ainda não viraram palete: aguardam a Conferência de PA
// (ou a confirmação do PCP). Mesmos critérios da fila em estoque.html.
function opsAguardandoConferencia(){
  var comPalete={};
  Object.values(base.estoque_lotes||{}).forEach(function(ls){Object.values(ls||{}).forEach(function(l){if(l&&l.opKey)comPalete[l.opKey]=true;});});
  return Object.entries(base.ops||{}).map(function(e){return {opKey:e[0],op:e[1]||{},conf:(base.conferencias_pa||{})[e[0]]||null};}).filter(function(x){
    var op=x.op,qtd=Number(op.produzidoLinha!=null?op.produzidoLinha:op.produzido)||0;
    if(!(op.status==='Concluído'||op.status==='Aguardando Confirmação')||!op.sku||qtd<=0||comPalete[x.opKey])return false;
    if(!x.conf&&String(op.dataFimReal||'')<INICIO_FLUXO_CONFERENCIA_PA)return false;
    return !x.conf||(x.conf.status!=='CONFERIDO'&&x.conf.status!=='CONFERIDO_COM_DIVERGENCIA');
  }).map(function(x){
    var op=x.op,qtd=Number(op.produzidoLinha!=null?op.produzidoLinha:op.produzido)||0,produto=ExpedicaoGrade.produtoDoSku(base.produtos,op.sku);
    var pk=ExpedicaoPA.resolverChavePedido?ExpedicaoPA.resolverChavePedido(base.pedidos,op.skuPedidoKey||''):op.skuPedidoKey,demanda=(base.pedidos||{})[pk]||{};
    return {opKey:x.opKey,opLote:op.lote||x.opKey,sku:op.sku,produto:op.produto||op.produtoNome||(produto||{}).descricao||'',cliente:demanda.cliente||op.cliente||'',
      pedidoNumero:demanda.id||demanda.parentPedidoId||'',qtd:qtd,
      situacao:op.status==='Aguardando Confirmação'?'Aguardando confirmação do PCP':x.conf?'Conferência em andamento':'Aguardando Conferência de PA',
      peso:ExpedicaoGrade.pesoTeoricoOp(qtd,produto)};
  });
}
function renderPesoResumo(linhas,pendentesOp){
  var liberados=linhas.filter(function(l){return l.disponivel;});
  var qualidade=linhas.filter(function(l){return !l.disponivel&&/Qualidade/i.test(l.motivo||'');});
  var tLib=ExpedicaoGrade.somaPeso(liberados.map(pesoDaLinha)), tQua=ExpedicaoGrade.somaPeso(qualidade.map(pesoDaLinha));
  var tOp=ExpedicaoGrade.somaPeso(pendentesOp.map(function(p){return p.peso;}));
  function soma(ls,f){return ls.reduce(function(t,x){return t+(Number(f(x))||0);},0);}
  var html='<div class="peso-bloco liberado">Liberado para expedir<br><b>'+textoPeso(tLib)+'</b><div class="sub">'+num(liberados.length)+' palete(s) · '+num(soma(liberados,function(l){return l.lote.saldoLote;}))+' un</div></div>'+
    '<div class="peso-bloco qualidade" title="Paletes já conferidos, em quarentena ou aguardando laudo da Qualidade">Aguardando Qualidade<br><b>'+textoPeso(tQua,true)+'</b><div class="sub">'+num(qualidade.length)+' palete(s) · '+num(soma(qualidade,function(l){return l.lote.saldoLote;}))+' un</div></div>'+
    '<div class="peso-bloco conferencia" title="Produzido que ainda não virou palete. Peso teórico: produzido ÷ un/cx do cadastro, arredondado para cima, × kg/cx do cadastro">Aguardando Conferência de PA · teórico<br><b>'+textoPeso(tOp,true)+'</b><div class="sub">'+num(pendentesOp.length)+' OP(s) · '+num(soma(pendentesOp,function(p){return p.qtd;}))+' un</div></div>';
  if(pendentesOp.length)html+='<details><summary>Ver OPs aguardando Conferência de PA ('+num(pendentesOp.length)+')</summary><div class="table-wrap"><table><thead><tr><th>OP</th><th>Situação</th><th>Cliente</th><th>Pedido</th><th>SKU / Produto</th><th>Produzido</th><th>Volumes</th><th>Kg/cx</th><th>Peso teórico (kg)</th></tr></thead><tbody>'+
    pendentesOp.map(function(p){return '<tr><td>'+e(p.opLote)+'</td><td>'+e(p.situacao)+'</td><td>'+e(p.cliente||'—')+'</td><td>'+e(p.pedidoNumero||'—')+'</td><td class="product"><b>'+e(p.sku)+'</b><div class="sub">'+e(p.produto)+'</div></td><td class="numeric">'+num(p.qtd)+'</td><td class="numeric">'+(p.peso.volumes==null?'—':num(p.peso.volumes))+'</td><td class="numeric">'+(p.peso.kgPorCaixa?kg(p.peso.kgPorCaixa):'—')+'</td><td class="numeric">'+(p.peso.kg==null?'<span class="peso-falta">sem '+e(p.peso.falta)+'</span>':kg(p.peso.kg))+'</td></tr>';}).join('')+
    '</tbody></table></div></details>';
  el('pesoResumo').innerHTML=html;
}
function resumo(){
  var ls=Object.values(selecionados), t=ExpedicaoGrade.totais(ls.map(function(l){return l.lote;}));
  el('selecaoResumo').textContent=t.paletes?num(t.paletes)+' palete(s) · '+num(t.unidades)+' un · '+num(t.caixasFechadas)+' cx completas + '+num(t.caixasParciais)+' parciais'+(t.composicoesPendentes?' · composição pendente':'')+' · '+textoPeso(ExpedicaoGrade.somaPeso(ls.map(pesoDaLinha))):'Nenhum palete selecionado';
  el('resumo').innerHTML=ls.length?'<b>'+e(ls[0].cliente)+'</b><br>Pedido(s): '+e(Array.from(new Set(ls.map(function(l){return l.pedidoNumero;}))).join(', '))+'<br>Destino: '+e(ls[0].frete.enderecoEntrega||'Não informado no pedido')+'<br>Peso da carga: <b>'+e(textoPeso(ExpedicaoGrade.somaPeso(ls.map(pesoDaLinha))))+'</b>':'Selecione os paletes na grade.';
  var invalida=!agendaCompleta();
  el('agendaAtiva').textContent=agendaKey?'Carga agendada · '+(invalida?'A agenda ou os paletes mudaram. Reabra a carga na agenda abaixo.':'Transporte compartilhado com a Logística.'):'';
  el('agendaAtiva').className=invalida?'notice error':'notice';
  el('salvar').disabled=enviando||!pronto()||(!tentativa&&(!ls.length||invalida));
  el('salvar').textContent=enviando?'Processando…':tentativa?'Verificar / repetir confirmação':'Confirmar saída física';
  el('agendar').disabled=enviando||!!tentativa||!pronto()||!ls.length||invalida;
  el('agendar').textContent=agendaKey?'Salvar agendamento':'Agendar carga';
  el('limpar').disabled=enviando||!!tentativa;
  el('montar').disabled=!ls.length;
  var faltam=selecionaveisVisiveis.filter(function(l){return !selecionados[idLinha(l)];}).length;
  el('selecionarTodos').disabled=enviando||!!tentativa||!!agendaKey||!faltam;
  el('selecionarTodos').textContent=faltam?'Selecionar todos ('+num(faltam)+')':'Selecionar todos';
  el('formCarga').querySelectorAll('input,select,textarea').forEach(function(x){x.disabled=enviando||!!tentativa;});
}
function celulasPeso(l){
  var p=pesoDaLinha(l);
  return '<td class="numeric">'+(p.kgPorCaixa?kg(p.kgPorCaixa):'—')+'</td><td class="numeric">'+
    (p.kg==null?'<span class="peso-falta" title="Cadastre o kg por caixa do produto em Cadastros">sem '+e(p.falta)+'</span>'
      :kg(p.kg)+'<div class="sub">'+(p.fonte==='PLANILHA'?'planilha':p.fonte==='CADASTRO'?'cadastro':'palete')+'</div>')+'</td>';
}
function renderPaletes(){
  if(!pronto())return;
  var linhas=ExpedicaoPA.listar(base,hoje()), alterados=false;
  if(!tentativa)Object.keys(selecionados).forEach(function(k){var atual=linhas.find(function(l){return idLinha(l)===k;}), antes=selecionados[k];
    if(!atual||!atual.disponivel||Number(atual.lote.saldoLote)!==Number(antes.lote.saldoLote)||atual.lote.enderecoKey!==antes.lote.enderecoKey||atual.skuPedidoKey!==antes.skuPedidoKey){delete selecionados[k];alterados=true;}else selecionados[k]=atual;
  });
  if(alterados)aviso('Um palete mudou no estoque e foi retirado da seleção. Confira a composição da carga antes de continuar.',true);
  var pendentesOp=opsAguardandoConferencia();
  var filtroCliente=el('filtroCliente').value, clientes=Array.from(new Set(linhas.map(function(l){return l.cliente;}).concat(pendentesOp.map(function(p){return p.cliente;})).filter(Boolean))).sort();
  el('filtroCliente').innerHTML='<option value="">Todos os clientes</option>'+clientes.map(function(c){return '<option value="'+e(c)+'">'+e(c)+'</option>';}).join('');el('filtroCliente').value=filtroCliente;
  var busca=el('busca').value.toLocaleLowerCase('pt-BR'), filtro=el('filtroStatus').value;
  var disponiveis=linhas.filter(function(l){return l.disponivel;}).length;
  el('contagem').textContent=num(linhas.length)+' paletes em estoque · '+num(disponiveis)+' liberados';
  linhas=linhas.filter(function(l){var ag=agendaDoPalete(idLinha(l));return (!filtroCliente||l.cliente===filtroCliente)&&(!filtro||filtro==='liberados'&&l.disponivel||filtro==='pendentes'&&!l.disponivel||filtro==='agendados'&&ag)&&[l.lote.identificadorPalete,l.lote.itemCodigo,l.lote.itemNome,l.lote.opLote,l.pedidoNumero,l.cliente,l.endereco.codigo].join(' ').toLocaleLowerCase('pt-BR').includes(busca);});
  renderPesoResumo(linhas,pendentesOp.filter(function(p){return (!filtroCliente||p.cliente===filtroCliente)&&[p.sku,p.produto,p.opLote,p.pedidoNumero,p.cliente].join(' ').toLocaleLowerCase('pt-BR').includes(busca);}));
  var ordem=el('ordem').value;
  linhas.sort(function(a,b){var av=ordem==='cliente'?a.cliente:ordem==='pedido'?a.pedidoNumero:ordem==='entrada'?a.lote.criadoEm:a.lote.identificadorPalete,bv=ordem==='cliente'?b.cliente:ordem==='pedido'?b.pedidoNumero:ordem==='entrada'?b.lote.criadoEm:b.lote.identificadorPalete;return String(av||'').localeCompare(String(bv||''),'pt-BR',{numeric:true});});
  el('paletes').innerHTML=linhas.map(function(l){
    var k=idLinha(l), ag=agendaDoPalete(k), selecionado=!!selecionados[k], bloqueado=!l.disponivel||enviando||!!tentativa||!!agendaKey||!!ag;
    var dias=ExpedicaoGrade.diasEstoque(l.lote.criadoEm,hoje());
    return '<tr class="'+(selecionado?'selected':!l.disponivel?'blocked':'')+'"><td><input type="checkbox" aria-label="Selecionar '+e(l.lote.identificadorPalete||l.loteKey)+'" data-palete="'+e(k)+'" '+(selecionado?'checked ':'')+(bloqueado?'disabled':'')+'></td>'+
      '<td><span class="state '+(!l.disponivel?'pending':ag?'scheduled':'')+'">'+(!l.disponivel?'Pendente':ag?'Agendado':'Disponível')+'</span>'+(!l.disponivel?'<div class="sub product">'+e(l.motivo)+'</div>':'')+(ag?'<div><button class="btn ghost" data-agenda="'+e(ag[0])+'">Abrir carga</button></div>':'')+'</td>'+
      '<td>'+e(l.cliente)+'</td><td>'+e(l.pedidoNumero||'Sem vínculo')+'</td><td class="product"><b>'+e(l.lote.itemCodigo)+'</b><div class="sub">'+e(l.lote.itemNome)+'</div></td>'+
      '<td>'+e(l.lote.opLote||l.lote.opKey)+'<div class="sub">'+e(l.lote.identificadorPalete||l.loteKey)+'</div></td><td>'+composicaoHTML(l.lote)+'</td><td class="numeric"><b>'+num(l.lote.saldoLote)+'</b></td>'+celulasPeso(l)+
      '<td>'+e(l.endereco.codigo||l.lote.enderecoCodigo||'—')+'</td><td class="numeric">'+(dias==null?'—':dias)+'</td>'+
      '<td class="extra-col">'+dataBR(l.op.dataFimReal)+'</td><td class="extra-col">'+dataBR(l.lote.criadoEm)+'</td><td class="extra-col">'+dataBR(l.lote.validade)+'</td></tr>';
  }).join('')||'<tr><td colspan="15">Nenhum palete neste filtro. O PA aparece após a conferência no estoque.</td></tr>';
  selecionaveisVisiveis=enviando||tentativa||agendaKey?[]:linhas.filter(function(l){return l.disponivel&&!agendaDoPalete(idLinha(l));});
  el('paletes').querySelectorAll('[data-palete]').forEach(function(x){x.onchange=function(){var l=linhas.find(function(a){return idLinha(a)===x.dataset.palete;});if(x.checked){if(!Object.keys(selecionados).length&&l.frete.tipo)el('tipo').value=l.frete.tipo==='FOB'?'COLETA':'ENTREGA';selecionados[idLinha(l)]=l;}else delete selecionados[idLinha(l)];renderPaletes();};});
  el('paletes').querySelectorAll('[data-agenda]').forEach(function(x){x.onclick=function(){abrirAgenda(x.dataset.agenda,agendas[x.dataset.agenda]);};});
  resumo();
  if(agendaURL&&agendas[agendaURL]&&!tentativa){var k=agendaURL;agendaURL=null;abrirAgenda(k,agendas[k]);}
}
function renderCargas(){
  var q=el('buscaHistorico').value.toLocaleLowerCase('pt-BR'), rows=[];
  Object.entries(cargas).sort(function(a,b){return String(b[1].criadoEm||'').localeCompare(String(a[1].criadoEm||''));}).forEach(function(entry){var c=entry[1];
    Object.values(c.itens||{}).forEach(function(l){if(![c.nf,c.cliente,c.numero,l.sku,l.pedidoNumero,l.opLote,l.identificadorPalete,c.transportadora,c.motorista,c.placa].join(' ').toLocaleLowerCase('pt-BR').includes(q))return;
      rows.push('<tr><td>'+e(c.nf||'Pendente')+'<div class="sub">'+e(c.numero||entry[0])+'</div></td><td>'+e(c.versao===2?'Expedido':c.status||'Legado')+'</td><td>'+e(c.cliente)+'</td><td>'+e(l.pedidoNumero||l.pedidoId||c.pedidoId)+'</td><td class="product">'+e(l.sku)+'<div class="sub">'+e(l.descricao)+'</div></td><td>'+e(l.opLote||'—')+'<div class="sub">'+e(l.identificadorPalete||'Registro anterior aos paletes')+'</div></td><td>'+composicaoHTML(l.paleteOrigem||{saldoLote:l.qtd})+'</td><td class="numeric">'+num(l.qtd)+'</td><td>'+dataBR(c.data)+'</td><td>'+e(c.transportadora||'—')+'</td><td>'+e(c.motorista||c.veiculo||'—')+'<div class="sub">'+e(c.contatoMotorista||'')+'</div></td><td>'+e(c.placa||'—')+'</td><td class="product">'+e(c.observacoes||'')+'</td></tr>');
    });
  });
  el('lista').innerHTML=rows.join('')||'<tr><td colspan="13">Nenhuma saída neste filtro.</td></tr>';
}
function abrirAgenda(k,a){
  if(enviando||tentativa)return aviso('Conclua a confirmação pendente antes de abrir outra carga.',true);
  if(!pronto()||!a||a.status!=='AGENDADO')return aviso('Agenda indisponível. Aguarde o carregamento ou atualize a página.',true);
  selecionados={};agendaKey=k;agendaRevisao=a.revisao;
  var faltas=[];(a.paletes||[]).forEach(function(p){var l=ExpedicaoPA.analisar(base,p.itemKey,p.loteKey,hoje());if(l.disponivel&&Number(l.lote.saldoLote)===Number(p.quantidade))selecionados[idLinha(l)]=l;else faltas.push(p.identificadorPalete||p.loteKey);});
  ['transportadora','motorista','contatoMotorista','placa','tipo','dataAgendada','janela'].forEach(function(f){el(f).value=a[f]||'';});el('obs').value=a.observacoes||'';
  aviso(faltas.length?'Paletes indisponíveis ou com saldo alterado: '+faltas.join(', ')+'. Regularize antes de confirmar.':'Agendamento carregado. Revise o transporte e confirme quando a carga sair.',!!faltas.length);
  renderPaletes();el('formCarga').scrollIntoView({behavior:'smooth',block:'start'});
}
el('agendar').onclick=async function(){
  if(enviando||tentativa||!agendaCompleta())return;
  var dados=Object.assign(transporte(),{agendaKey:agendaKey||(novaAgendaKey||(novaAgendaKey=crypto.randomUUID())),revisao:agendaKey?agendaRevisao:0,paletes:refsSelecionadas(),dataAgendada:el('dataAgendada').value,janela:el('janela').value,tipo:el('tipo').value});
  if(!dados.dataAgendada)return aviso('Informe a data agendada.',true);
  enviando=true;resumo();
  try{var r=await fn.httpsCallable('salvarAgendamentoExpedicaoPA')(dados);agendaKey=r.data.agendaKey;agendaRevisao=r.data.revisao;novaAgendaKey=null;aviso('Carga agendada. O transporte pode ser atualizado aqui ou na Logística. O estoque permanece intacto.');}
  catch(err){aviso(err.message||'Não foi possível agendar. Confira a agenda abaixo antes de tentar novamente.',true);}
  finally{enviando=false;renderPaletes();resumo();}
};
el('salvar').onclick=async function(){
  if(enviando)return;
  if(!tentativa){
    if(!pronto()||!Object.keys(selecionados).length||!agendaCompleta())return aviso('Confira a seleção e o agendamento antes de confirmar.',true);
    if(!confirm('Confirmar a saída física de '+Object.keys(selecionados).length+' palete(s)? Esta confirmação baixa os paletes do estoque.'))return;
    tentativa=Object.assign(transporte(),{idempotencyKey:crypto.randomUUID(),data:el('data').value,tipo:el('tipo').value,nf:el('nf').value.trim(),serie:el('serie').value.trim(),chaveNfe:el('chave').value.trim(),valorFaturado:el('valor').value,paletes:refsSelecionadas(),agendaKey:agendaKey,agendaRevisao:agendaRevisao});
    sessionStorage.setItem('expedicaoPA-tentativa',JSON.stringify(tentativa));
  }
  enviando=true;renderPaletes();resumo();
  try{var r=await fn.httpsCallable('confirmarExpedicaoPA')(tentativa);aviso('Saída confirmada: '+r.data.numero+'. Paletes baixados e pedidos vinculados.');tentativa=null;sessionStorage.removeItem('expedicaoPA-tentativa');selecionados={};agendaKey=null;agendaRevisao=null;['nf','serie','chave','valor','transportadora','motorista','contatoMotorista','placa','obs','janela'].forEach(function(k){el(k).value='';});}
  catch(err){var definitivo=['functions/invalid-argument','functions/failed-precondition','functions/permission-denied','functions/unauthenticated','functions/aborted'].includes(err.code);aviso((err.message||'Falha na confirmação.')+(definitivo?'':' Use Verificar / repetir confirmação para recuperar a mesma saída.'),true);if(definitivo){tentativa=null;sessionStorage.removeItem('expedicaoPA-tentativa');}}
  finally{enviando=false;renderPaletes();resumo();}
};
el('limpar').onclick=function(){if(enviando||tentativa)return;selecionados={};agendaKey=null;agendaRevisao=null;novaAgendaKey=null;renderPaletes();};
// Selecionar todos os paletes disponíveis do filtro atual que cabem na mesma
// carga. As regras de compatibilidade são as do servidor (ExpedicaoGrade.selecionarTodos).
el('selecionarTodos').onclick=function(){
  if(enviando||tentativa||agendaKey)return;
  var faltam=selecionaveisVisiveis.filter(function(l){return !selecionados[idLinha(l)];});
  var r=ExpedicaoGrade.selecionarTodos(faltam,Object.values(selecionados));
  if(!r.selecionar.length)return aviso(r.motivo||'Nenhum palete disponível neste filtro.',true);
  if(!Object.keys(selecionados).length&&r.selecionar[0].frete.tipo)el('tipo').value=r.selecionar[0].frete.tipo==='FOB'?'COLETA':'ENTREGA';
  r.selecionar.forEach(function(l){selecionados[idLinha(l)]=l;});
  aviso(num(r.selecionar.length)+' palete(s) selecionado(s).'+(r.motivo?' Atenção: '+r.motivo+'.':''),!!r.motivo);
  renderPaletes();
};
el('montar').onclick=function(){el('formCarga').scrollIntoView({behavior:'smooth',block:'start'});};
['busca','filtroCliente','filtroStatus','ordem'].forEach(function(k){el(k).addEventListener(k==='busca'?'input':'change',renderPaletes);});
el('extras').onchange=function(){el('gradeEstoque').classList.toggle('show-extra',el('extras').checked);};
el('buscaHistorico').oninput=renderCargas;el('data').value=hoje();el('data').max=hoje();el('dataAgendada').value=hoje();
try{tentativa=JSON.parse(sessionStorage.getItem('expedicaoPA-tentativa')||'null');}catch(ignore){}
Object.keys(base).forEach(function(no){dbOnValue(db.ref(no),function(s){base[no]=s.val()||{};carregados.add(no);renderPaletes();if(tentativa&&!enviando)aviso('Há uma confirmação pendente. Use Verificar / repetir confirmação para recuperar o resultado.',true);});});
dbOnValue(db.ref('expedicoes_comerciais'),function(s){cargas=s.val()||{};renderCargas();});
AgendaPAUI.iniciar({container:el('agendaPA'),db:db,fn:fn,onAbrir:abrirAgenda,onErro:function(msg){aviso(msg,true);},onAtualizar:function(a){agendas=a;agendaPronta=true;renderPaletes();}});
