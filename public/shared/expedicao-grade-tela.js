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
  var filtroCliente=el('filtroCliente').value, clientes=opcoesClientesExp(linhas.map(function(l){return l.cliente;}).concat(pendentesOp.map(function(p){return p.cliente;})));
  // Uma opção por cliente, qualquer grafia (chaveClienteExp, abaixo).
  el('filtroCliente').innerHTML='<option value="">Todos os clientes</option>'+clientes.map(function(c){return '<option value="'+e(c.chave)+'">'+e(c.nome)+'</option>';}).join('');el('filtroCliente').value=filtroCliente;
  var busca=el('busca').value.toLocaleLowerCase('pt-BR'), filtro=el('filtroStatus').value;
  var disponiveis=linhas.filter(function(l){return l.disponivel;}).length;
  el('contagem').textContent=num(linhas.length)+' paletes em estoque · '+num(disponiveis)+' liberados';
  linhas=linhas.filter(function(l){var ag=agendaDoPalete(idLinha(l));return (!filtroCliente||chaveClienteExp(l.cliente)===filtroCliente)&&(!filtro||filtro==='liberados'&&l.disponivel||filtro==='pendentes'&&!l.disponivel||filtro==='agendados'&&ag)&&[l.lote.identificadorPalete,l.lote.itemCodigo,l.lote.itemNome,l.lote.opLote,l.pedidoNumero,l.cliente,l.endereco.codigo].join(' ').toLocaleLowerCase('pt-BR').includes(busca);});
  renderPesoResumo(linhas,pendentesOp.filter(function(p){return (!filtroCliente||chaveClienteExp(p.cliente)===filtroCliente)&&[p.sku,p.produto,p.opLote,p.pedidoNumero,p.cliente].join(' ').toLocaleLowerCase('pt-BR').includes(busca);}));
  var ordem=el('ordem').value;
  linhas.sort(function(a,b){var av=ordem==='cliente'?a.cliente:ordem==='pedido'?a.pedidoNumero:ordem==='entrada'?a.lote.criadoEm:a.lote.identificadorPalete,bv=ordem==='cliente'?b.cliente:ordem==='pedido'?b.pedidoNumero:ordem==='entrada'?b.lote.criadoEm:b.lote.identificadorPalete;return String(av||'').localeCompare(String(bv||''),'pt-BR',{numeric:true});});
  el('paletes').innerHTML=linhas.map(function(l){
    var k=idLinha(l), ag=agendaDoPalete(k), selecionado=!!selecionados[k], bloqueado=!l.disponivel||enviando||!!ag;
    var dias=ExpedicaoGrade.diasEstoque(l.lote.criadoEm,hoje());
    var etapaAg=ag?CargasPA.etapa(ag[1]):null;
    return '<tr class="'+(selecionado?'selected':!l.disponivel?'blocked':'')+'"><td><input type="checkbox" aria-label="Selecionar '+e(l.lote.identificadorPalete||l.loteKey)+'" data-palete="'+e(k)+'" '+(selecionado?'checked ':'')+(bloqueado?'disabled':'')+'></td>'+
      '<td><span class="state '+(!l.disponivel?'pending':ag?'scheduled':'')+'">'+(!l.disponivel?'Pendente':ag?'Agendado':'Disponível')+'</span>'+(!l.disponivel?'<div class="sub product">'+e(l.motivo)+'</div>':'')+(l.avulso&&!ag&&/LIBERADO_EXPEDICAO|APROVADO_CONCESSAO/.test(l.lote.status||'')?'<div><button type="button" class="btn ghost" data-vincular="'+e(k)+'">'+(l.skuPedidoKey?'Trocar pedido':'Vincular a pedido')+'</button></div>':'')+(ag?'<div class="sub">'+e(etapaAg.curto)+'</div><div><a class="btn ghost" data-agenda="'+e(ag[0])+'" href="cargas.html?carga='+encodeURIComponent(ag[0])+'">Acompanhar</a></div>':'')+'</td>'+
      '<td>'+e(l.cliente)+'</td><td>'+e(l.pedidoNumero||'Sem vínculo')+'</td><td class="product"><b>'+e(l.lote.itemCodigo)+'</b><div class="sub">'+e(l.lote.itemNome)+'</div></td>'+
      '<td>'+e(l.lote.opLote||l.lote.opKey)+'<div class="sub">'+e(l.lote.identificadorPalete||l.loteKey)+'</div>'+(!ag&&!enviando&&DesmembrarPalete.podeDesmembrar(l.lote)?'<div><button type="button" class="btn ghost" data-desmembrar="'+e(k)+'" title="O apontamento juntou paletes que fisicamente são separados: divide este palete em vários, sem mexer no total">✂️ Desmembrar</button></div>':'')+'</td><td>'+composicaoHTML(l.lote)+'</td><td class="numeric"><b>'+num(l.lote.saldoLote)+'</b></td>'+celulasPeso(l)+
      '<td>'+e(l.endereco.codigo||l.lote.enderecoCodigo||'—')+'</td><td class="numeric">'+(dias==null?'—':dias)+'</td>'+
      '<td class="extra-col">'+dataBR(l.op.dataFimReal)+'</td><td class="extra-col">'+dataBR(l.lote.criadoEm)+'</td><td class="extra-col">'+dataBR(l.lote.dataValidade || l.lote.validade)+'</td></tr>';
  }).join('')||'<tr><td colspan="15">Nenhum palete neste filtro. O PA aparece após a conferência no estoque.</td></tr>';
  selecionaveisVisiveis=enviando?[]:linhas.filter(function(l){return l.disponivel&&!agendaDoPalete(idLinha(l));});
  el('paletes').querySelectorAll('[data-vincular]').forEach(function(b){b.onclick=function(){abrirVinculoEstoque(b.dataset.vincular);};});
  el('paletes').querySelectorAll('[data-desmembrar]').forEach(function(b){b.onclick=function(){abrirDesmembrar(b.dataset.desmembrar);};});
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

/* Estoque PRÓPRIO (entrada avulsa de PA, sem OP): antes de sair, o palete é
   vinculado ao pedido que vai receber. A saída credita o pedido como atendido
   por estoque. Regras em shared/entrada-avulsa-pa.js. */
function abrirVinculoEstoque(k){
  var partes=k.split('/'), lote=((base.estoque_lotes[partes[0]]||{})[partes[1]])||null;
  if(!lote)return aviso('Palete não encontrado.',true);
  var cand=EntradaAvulsaPA.candidatosPedido(base,lote);
  var bg=document.createElement('div');
  bg.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:18px';
  bg.innerHTML='<div style="background:var(--card,#fff);color:var(--text,#1d1d1f);border-radius:14px;max-width:620px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.35)">'+
    '<h2 style="margin:0 0 6px;font-size:18px">Vincular estoque próprio a um pedido</h2>'+
    '<div class="sub" style="margin-bottom:12px">'+e(lote.itemCodigo)+' — '+e(lote.itemNome)+' · palete '+e(lote.identificadorPalete)+' · <b>'+num(lote.saldoLote)+' un.</b> · lote '+e(lote.loteOrigem||'—')+'</div>'+
    (cand.length?'<label for="vincPedido" style="font-size:12px;font-weight:700">Pedido que recebe este palete</label>'+
      '<select id="vincPedido" style="width:100%;padding:9px;margin:6px 0 4px">'+cand.map(function(c){return '<option value="'+e(c.key)+'"'+(c.key===lote.skuPedidoKey?' selected':'')+'>'+e('Pedido '+c.id+' · '+c.cliente+' · saldo a produzir '+num(c.saldo)+' de '+num(c.qtdTotal))+'</option>';}).join('')+'</select>'+
      '<div class="sub">Ao confirmar a saída, o pedido é creditado como <b>atendido por estoque</b> (conta como produzido, sem OP).</div>'
      :'<p>Não há pedido aberto deste produto com saldo para receber o palete. Peça ao Comercial para lançar o pedido e volte aqui.</p>')+
    '<div id="vincErro" class="sub" style="color:#d03b3b;margin-top:8px"></div>'+
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">'+
      (lote.skuPedidoKey?'<button type="button" class="btn ghost" id="vincDesfazer">Desfazer vínculo</button>':'')+
      '<button type="button" class="btn ghost" id="vincFechar">Fechar</button>'+
      (cand.length?'<button type="button" class="btn" id="vincOk">Vincular</button>':'')+'</div></div>';
  document.body.appendChild(bg);
  var fechar=function(){bg.remove();};
  bg.querySelector('#vincFechar').onclick=fechar;
  var autor=(window.currentUser&&window.currentUser.nome)||'Logística';
  if(bg.querySelector('#vincOk'))bg.querySelector('#vincOk').onclick=function(){
    this.disabled=true;
    EntradaAvulsaPA.vincular(db,base,partes[0],partes[1],bg.querySelector('#vincPedido').value,autor).then(function(r){
      if(!r.ok){bg.querySelector('#vincErro').textContent=r.erro;bg.querySelector('#vincOk').disabled=false;return;}
      fechar();aviso('Palete vinculado ao pedido. Já pode entrar numa carga.');
    }).catch(function(err){bg.querySelector('#vincErro').textContent=err.message;bg.querySelector('#vincOk').disabled=false;});
  };
  if(bg.querySelector('#vincDesfazer'))bg.querySelector('#vincDesfazer').onclick=function(){
    EntradaAvulsaPA.desvincular(db,partes[0],partes[1],autor).then(function(r){if(!r.ok){bg.querySelector('#vincErro').textContent=r.erro;return;}fechar();aviso('Vínculo desfeito.');});
  };
}

/* Desmembrar palete (28/10/2026): o apontamento do PA juntou num palete o que
   fisicamente são dois ou três. A divisão fica aqui, na Montar Carga, porque é
   onde o erro aparece (o peso e o nº de volumes não batem com a carga).
   Regras e gravação em shared/desmembrar-palete.js. */
function abrirDesmembrar(k){
  var ids=k.split('/'), lote=((base.estoque_lotes[ids[0]]||{})[ids[1]])||null;
  if(!lote)return aviso('Palete não encontrado.',true);
  if(agendaDoPalete(k))return aviso('Este palete já está numa carga agendada. Retire-o da carga antes de desmembrar.',true);
  var c=DesmembrarPalete.composicaoAtual(lote);
  if(!c)return aviso('A composição deste palete não fecha com o saldo. Corrija antes de desmembrar.',true);
  var partes=[{caixas:c.caixas,parcial:c.parcial},{caixas:'',parcial:''}], gravando=false;
  var bg=document.createElement('div');
  bg.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:18px';
  bg.innerHTML='<div style="background:var(--card,#fff);color:var(--text,#1d1d1f);border-radius:14px;max-width:560px;width:100%;max-height:92vh;overflow:auto;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.35)">'+
    '<h2 style="margin:0 0 6px;font-size:18px">Desmembrar palete</h2>'+
    '<div class="sub" style="margin-bottom:12px">'+e(lote.itemCodigo)+' — '+e(lote.itemNome)+' · lote '+e(lote.opLote||lote.loteOrigem||'—')+' · palete <b>'+e(lote.identificadorPalete||ids[1])+'</b><br>'+
    'Hoje: <b>'+num(c.caixas)+' cx × '+num(c.multiplo||0)+(c.parcial?' + 1 parcial de '+num(c.parcial)+' un':'')+' = '+num(c.saldo)+' un</b> · endereço '+e(lote.enderecoCodigo||'—')+'</div>'+
    '<div class="sub" style="margin-bottom:8px">Digite quantas caixas ficam em cada palete. O primeiro mantém o código atual; os demais ganham código novo, no mesmo endereço.</div>'+
    '<div id="dmLinhas"></div>'+
    '<div><button type="button" class="btn ghost" id="dmMais">+ Adicionar palete</button></div>'+
    '<div id="dmMsg" class="sub" style="margin-top:10px;font-weight:700"></div>'+
    '<div id="dmErro" class="sub" style="color:#d03b3b;margin-top:6px"></div>'+
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button type="button" class="btn ghost" id="dmFechar">Cancelar</button><button type="button" class="btn" id="dmOk" disabled>Desmembrar</button></div></div>';
  document.body.appendChild(bg);
  function desenhar(){
    el('dmLinhas').innerHTML=partes.map(function(p,i){
      var cx=Number(p.caixas||0), pc=Number(p.parcial||0), un=cx*(c.multiplo||0)+pc;
      return '<div style="display:flex;gap:8px;align-items:end;margin-bottom:8px">'+
        '<div style="min-width:78px;font-weight:700;padding-bottom:9px">Palete '+(i+1)+'</div>'+
        '<label style="flex:1;font-size:11px;font-weight:700">Caixas<input type="number" min="0" step="1" data-dm="'+i+'" data-campo="caixas" value="'+e(p.caixas)+'" style="width:100%;padding:8px"></label>'+
        (c.parcial?'<label style="flex:1;font-size:11px;font-weight:700">Un. na parcial<input type="number" min="0" step="1" data-dm="'+i+'" data-campo="parcial" value="'+e(p.parcial)+'" style="width:100%;padding:8px"></label>':'')+
        '<div class="sub" style="min-width:74px;text-align:right;padding-bottom:9px">'+(un>0?num(un)+' un':'—')+'</div>'+
        (i>=2?'<button type="button" class="btn ghost" data-dmrm="'+i+'" aria-label="Remover palete '+(i+1)+'">✕</button>':'<div style="width:38px"></div>')+'</div>';
    }).join('');
    el('dmLinhas').querySelectorAll('input').forEach(function(x){x.oninput=function(){partes[Number(x.dataset.dm)][x.dataset.campo]=x.value;validar();var s=x.parentNode.parentNode.querySelector('.sub');var p=partes[Number(x.dataset.dm)],u=Number(p.caixas||0)*(c.multiplo||0)+Number(p.parcial||0);if(s)s.textContent=u>0?num(u)+' un':'—';};});
    el('dmLinhas').querySelectorAll('[data-dmrm]').forEach(function(b){b.onclick=function(){partes.splice(Number(b.dataset.dmrm),1);desenhar();validar();};});
    el('dmMais').disabled=partes.length>=DesmembrarPalete.MAX_PARTES;
  }
  function validar(){
    var r=DesmembrarPalete.conferir(lote,partes);
    el('dmMsg').textContent=r.ok?'Confere: '+num(c.caixas)+' caixas'+(c.parcial?' + parcial de '+num(c.parcial)+' un':'')+' em '+partes.length+' paletes.':r.mensagem;
    el('dmMsg').style.color=r.ok?'#176b40':'#9a6700';
    el('dmOk').disabled=!r.ok||gravando;
  }
  function fechar(){bg.remove();}
  el('dmMais').onclick=function(){partes.push({caixas:'',parcial:''});desenhar();validar();};
  el('dmFechar').onclick=fechar;
  el('dmOk').onclick=function(){
    if(gravando)return;gravando=true;el('dmOk').disabled=true;el('dmErro').textContent='';
    var autor=(window.currentUser&&window.currentUser.nome)||'Logística';
    DesmembrarPalete.executar(db,{itemKey:ids[0],loteKey:ids[1],partes:partes,autor:autor,emCarga:function(i,l){return !!agendaDoPalete(i+'/'+l);}}).then(function(r){
      fechar();delete selecionados[k];
      aviso('Palete desmembrado em '+(r.novos.length+1)+': '+(lote.identificadorPalete||ids[1])+(r.novos.length?' e '+r.novos.map(function(n){return n.identificador;}).join(', '):'')+'. Cada um mantém o endereço '+(lote.enderecoCodigo||'atual')+'.');
    }).catch(function(err){gravando=false;el('dmErro').textContent=err.message||String(err);validar();});
  };
  desenhar();validar();
}

/* Cliente sem acento, caixa e espaço repetido (19/10/2026): "MISS RÔSE",
   "MISS ROSE" e "Miss Rose" são uma opção só no filtro. Mesma regra de
   chaveNome/opcoesPorNome (shared/utils.js), local para a tela não depender
   da ordem de carga do utils. */
function chaveClienteExp(s){return String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/\s+/g,' ').trim();}
function opcoesClientesExp(nomes){var g={},ordem=[];(nomes||[]).forEach(function(n){var k=chaveClienteExp(n);if(!k)return;if(!g[k]){g[k]={};ordem.push(k);}var t=String(n).trim();g[k][t]=(g[k][t]||0)+1;});return ordem.map(function(k){var v=g[k];return {chave:k,nome:Object.keys(v).reduce(function(a,b){return v[b]>v[a]?b:a;})};}).sort(function(a,b){return a.nome.localeCompare(b.nome,'pt-BR');});}
