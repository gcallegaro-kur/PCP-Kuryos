'use strict';
/* Expedição de Vendas — MONTAR CARGA (1ª de 3 telas, 29/09).
   Pedido do usuário: a tela única misturava agendamento, faturamento e
   saída. Aqui só se escolhem os paletes e se agenda o transporte; a carga
   segue para o Faturamento (faturamento.html) e sai pelo Acompanhamento de
   cargas (cargas.html), onde a NF, o carregamento e as viagens ficam. */
// Link antigo "expedicao.html?agenda=K" (Logística, calendário, e-mails):
// a carga agendada agora é tratada no Acompanhamento.
(function(){var k=new URLSearchParams(location.search).get('agenda');if(k)location.replace('cargas.html?carga='+encodeURIComponent(k));})();
var db=firebase.database(), fn=firebase.functions();
var base={estoque_lotes:{},ops:{},pedidos:{},pedidos_comerciais:{},conferencias_pa:{},enderecos_estoque:{},produtos:{}};
var clientesContatos={}, contatoCargaUI=ContatosClienteUI.seletor(document.getElementById('contatoClienteCarga'),['LOGISTICA']);
var selecionados={}, agendas={}, carregados=new Set(), agendaPronta=false;
var enviando=false, novaAgendaKey=null, selecionaveisVisiveis=[];
var ATIVAS=CargasPA.ATIVAS;
function pendenteAg(p){return CargasPA.pendente(p);}
function pendentesAgenda(a){return ((a&&a.paletes)||[]).filter(function(p){return pendenteAg(p)>0;});}
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
function transporte(){return {contatoCliente:contatoCargaUI.valor(),transportadora:el('transportadora').value.trim(),motorista:el('motorista').value.trim(),contatoMotorista:el('contatoMotorista').value.trim(),placa:el('placa').value.trim(),observacoes:el('obs').value.trim()};}
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
function celulasPeso(l){
  var p=pesoDaLinha(l);
  return '<td class="numeric">'+(p.kgPorCaixa?kg(p.kgPorCaixa):'—')+'</td><td class="numeric">'+
    (p.kg==null?'<span class="peso-falta" title="Cadastre o kg por caixa do produto em Cadastros">sem '+e(p.falta)+'</span>'
      :kg(p.kg)+'<div class="sub">'+(p.fonte==='PLANILHA'?'planilha':p.fonte==='CADASTRO'?'cadastro':'palete')+'</div>')+'</td>';
}
function avisoHTML(html,erro){el('resultado').className='notice'+(erro?' error':'');el('resultado').innerHTML=html;}
function pronto(){return carregados.size===Object.keys(base).length&&agendaPronta;}
function agendaDoPalete(k){return Object.entries(agendas).find(function(x){return ATIVAS.indexOf(x[1].status)!==-1&&pendentesAgenda(x[1]).some(function(p){return idLinha(p)===k;});});}
function refsSelecionadas(){return Object.values(selecionados).map(function(l){return {itemKey:l.itemKey,loteKey:l.loteKey,quantidade:Number(l.lote.saldoLote),enderecoKey:l.lote.enderecoKey,skuPedidoKey:l.skuPedidoKey};});}
function resumo(){
  var ls=Object.values(selecionados), t=ExpedicaoGrade.totais(ls.map(function(l){return l.lote;}));
  var clienteDaCarga=ls[0];contatoCargaUI.carregar(clienteDaCarga?clientesContatos[clienteDaCarga.clienteKey]||{}:{},clienteDaCarga?(clienteDaCarga.clienteKey||clienteDaCarga.cliente):'');
  el('selecaoResumo').textContent=t.paletes?num(t.paletes)+' palete(s) · '+num(t.unidades)+' un · '+num(t.caixasFechadas)+' cx completas + '+num(t.caixasParciais)+' parciais'+(t.composicoesPendentes?' · composição pendente':'')+' · '+textoPeso(ExpedicaoGrade.somaPeso(ls.map(pesoDaLinha))):'Nenhum palete selecionado';
  el('resumo').innerHTML=ls.length?'<b>'+e(ls[0].cliente)+'</b><br>Pedido(s): '+e(Array.from(new Set(ls.map(function(l){return l.pedidoNumero;}))).join(', '))+'<br>Destino: '+e(ls[0].frete.enderecoEntrega||'Não informado no pedido')+'<br>Peso da carga: <b>'+e(textoPeso(ExpedicaoGrade.somaPeso(ls.map(pesoDaLinha))))+'</b>':'Selecione os paletes na grade.';
  el('agendar').disabled=enviando||!pronto()||!ls.length;
  el('agendar').textContent=enviando?'Agendando…':'Agendar carga';
  el('limpar').disabled=enviando;
  el('montar').disabled=!ls.length;
  var faltam=selecionaveisVisiveis.filter(function(l){return !selecionados[idLinha(l)];}).length;
  el('selecionarTodos').disabled=enviando||!faltam;
  el('selecionarTodos').textContent=faltam?'Selecionar todos ('+num(faltam)+')':'Selecionar todos';
  el('formCarga').querySelectorAll('input,select,textarea').forEach(function(x){x.disabled=enviando;});
}
function renderPaletes(){
  if(!pronto())return;
  var linhas=ExpedicaoPA.listar(base,hoje()), alterados=false;
  Object.keys(selecionados).forEach(function(k){var atual=linhas.find(function(l){return idLinha(l)===k;}), antes=selecionados[k];
    if(!atual||!atual.disponivel||agendaDoPalete(k)||Number(atual.lote.saldoLote)!==Number(antes.lote.saldoLote)||atual.lote.enderecoKey!==antes.lote.enderecoKey||atual.skuPedidoKey!==antes.skuPedidoKey){delete selecionados[k];alterados=true;}else selecionados[k]=atual;
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
    var k=idLinha(l), ag=agendaDoPalete(k), selecionado=!!selecionados[k], bloqueado=!l.disponivel||enviando||!!ag;
    var dias=ExpedicaoGrade.diasEstoque(l.lote.criadoEm,hoje());
    var etapaAg=ag?CargasPA.etapa(ag[1]):null;
    return '<tr class="'+(selecionado?'selected':!l.disponivel?'blocked':'')+'"><td><input type="checkbox" aria-label="Selecionar '+e(l.lote.identificadorPalete||l.loteKey)+'" data-palete="'+e(k)+'" '+(selecionado?'checked ':'')+(bloqueado?'disabled':'')+'></td>'+
      '<td><span class="state '+(!l.disponivel?'pending':ag?'scheduled':'')+'">'+(!l.disponivel?'Pendente':ag?'Agendado':'Disponível')+'</span>'+(!l.disponivel?'<div class="sub product">'+e(l.motivo)+'</div>':'')+(ag?'<div class="sub">'+e(etapaAg.curto)+'</div><div><a class="btn ghost" data-agenda="'+e(ag[0])+'" href="cargas.html?carga='+encodeURIComponent(ag[0])+'">Acompanhar</a></div>':'')+'</td>'+
      '<td>'+e(l.cliente)+'</td><td>'+e(l.pedidoNumero||'Sem vínculo')+'</td><td class="product"><b>'+e(l.lote.itemCodigo)+'</b><div class="sub">'+e(l.lote.itemNome)+'</div></td>'+
      '<td>'+e(l.lote.opLote||l.lote.opKey)+'<div class="sub">'+e(l.lote.identificadorPalete||l.loteKey)+'</div></td><td>'+composicaoHTML(l.lote)+'</td><td class="numeric"><b>'+num(l.lote.saldoLote)+'</b></td>'+celulasPeso(l)+
      '<td>'+e(l.endereco.codigo||l.lote.enderecoCodigo||'—')+'</td><td class="numeric">'+(dias==null?'—':dias)+'</td>'+
      '<td class="extra-col">'+dataBR(l.op.dataFimReal)+'</td><td class="extra-col">'+dataBR(l.lote.criadoEm)+'</td><td class="extra-col">'+dataBR(l.lote.validade)+'</td></tr>';
  }).join('')||'<tr><td colspan="15">Nenhum palete neste filtro. O PA aparece após a conferência no estoque.</td></tr>';
  selecionaveisVisiveis=enviando?[]:linhas.filter(function(l){return l.disponivel&&!agendaDoPalete(idLinha(l));});
  el('paletes').querySelectorAll('[data-palete]').forEach(function(x){x.onchange=function(){var l=linhas.find(function(a){return idLinha(a)===x.dataset.palete;});if(x.checked){if(!Object.keys(selecionados).length&&l.frete.tipo)el('tipo').value=l.frete.tipo==='FOB'?'COLETA':'ENTREGA';selecionados[idLinha(l)]=l;}else delete selecionados[idLinha(l)];renderPaletes();};});
  resumo();
}
el('agendar').onclick=async function(){
  if(enviando||!Object.keys(selecionados).length)return;
  var dados=Object.assign(transporte(),{agendaKey:novaAgendaKey||(novaAgendaKey=crypto.randomUUID()),revisao:0,paletes:refsSelecionadas(),dataAgendada:el('dataAgendada').value,janela:el('janela').value,tipo:el('tipo').value});
  if(!dados.dataAgendada)return aviso('Informe a data agendada.',true);
  enviando=true;resumo();
  try{
    var r=await fn.httpsCallable('salvarAgendamentoExpedicaoPA')(dados), k=r.data.agendaKey;
    novaAgendaKey=null;selecionados={};
    ['transportadora','motorista','contatoMotorista','placa','obs','janela'].forEach(function(f){el(f).value='';});
    avisoHTML('Carga agendada. O estoque permanece intacto. Próximo passo: <a href="faturamento.html?carga='+encodeURIComponent(k)+'"><b>Faturamento →</b></a>');
  }
  catch(err){aviso(err.message||'Não foi possível agendar. Confira no Acompanhamento de cargas antes de tentar novamente.',true);}
  finally{enviando=false;renderPaletes();}
};
el('limpar').onclick=function(){if(enviando)return;selecionados={};novaAgendaKey=null;renderPaletes();};
// Selecionar todos os paletes disponíveis do filtro atual que cabem na mesma
// carga. As regras de compatibilidade são as do servidor (ExpedicaoGrade.selecionarTodos).
el('selecionarTodos').onclick=function(){
  if(enviando)return;
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
el('dataAgendada').value=hoje();
Object.keys(base).forEach(function(no){dbOnValue(db.ref(no),function(s){base[no]=s.val()||{};carregados.add(no);renderPaletes();});});
dbOnValue(db.ref('clientes'),function(s){clientesContatos=s.val()||{};renderPaletes();});
dbOnValue(db.ref('agendamentos_expedicao'),function(s){agendas=s.val()||{};agendaPronta=true;CargasFluxo.render(el('fluxoCargas'),'expedicao.html',agendas);renderPaletes();});
