'use strict';
var db = firebase.database(), fn = firebase.functions();
var base = {estoque_lotes:{}, ops:{}, pedidos:{}, pedidos_comerciais:{}, conferencias_pa:{}, enderecos_estoque:{}};
var selecionados = {}, cargas = {}, carregados = new Set(), enviando = false, tentativa = null;
function e(v) { return escapeHtml(String(v == null ? '' : v)); }
function el(id) { return document.getElementById(id); }
function hoje() { return new Date().toLocaleDateString('en-CA', {timeZone:'America/Sao_Paulo'}); }
function aviso(msg, erro) { el('resultado').className = 'notice' + (erro ? ' error' : ''); el('resultado').textContent = msg; }
function idLinha(l) { return l.itemKey + '/' + l.loteKey; }
function resumo() {
  var ls = Object.values(selecionados);
  el('salvar').disabled = enviando || carregados.size !== 6 || (!tentativa && !ls.length);
  el('salvar').textContent = enviando ? 'Confirmando…' : tentativa ? 'Verificar / repetir confirmação' : 'Confirmar saída dos paletes';
  ['tipo','data','nf','serie','chave','valor','transportadora','veiculo','obs'].forEach(function(k){el(k).disabled=enviando||!!tentativa;});
  el('resumo').innerHTML = !ls.length ? 'Selecione os paletes à esquerda.' : '<b>' + ls.length + ' palete(s) · ' + ls.reduce(function(s,l){return s+Number(l.lote.saldoLote);},0).toLocaleString('pt-BR') + ' unidades</b>' +
    ls.map(function(l){return '<div class="sub">'+e(l.lote.identificadorPalete)+' · Pedido '+e(l.pedidoNumero)+' · '+e(l.cliente)+'</div>';}).join('') +
    '<div class="sub">Destino: '+e(ls[0].frete.enderecoEntrega || 'Não informado no pedido')+'</div>';
}
function renderPaletes() {
  if (carregados.size !== 6) return;
  var linhas = ExpedicaoPA.listar(base, hoje()), busca = el('busca').value.toLocaleLowerCase('pt-BR'), alterados = false;
  if (!tentativa) Object.keys(selecionados).forEach(function(k) {
    var atual = linhas.find(function(l){return idLinha(l) === k;}), antes = selecionados[k];
    if (!atual || !atual.disponivel || Number(atual.lote.saldoLote) !== Number(antes.lote.saldoLote) || atual.lote.enderecoKey !== antes.lote.enderecoKey || atual.skuPedidoKey !== antes.skuPedidoKey) {delete selecionados[k]; alterados=true;}
    else selecionados[k] = atual;
  });
  if (alterados) aviso('Um palete selecionado mudou no estoque e foi retirado da seleção. Confira a carga.', true);
  var disponiveis = linhas.filter(function(l){return l.disponivel;}).length;
  el('contagem').textContent = disponiveis + ' disponível(is) · ' + (linhas.length-disponiveis) + ' com pendências';
  linhas = linhas.filter(function(l){return (l.disponivel || el('bloqueados').checked) && [l.lote.identificadorPalete,l.lote.itemCodigo,l.lote.itemNome,l.lote.opLote,l.pedidoNumero,l.cliente,l.endereco.codigo].join(' ').toLocaleLowerCase('pt-BR').includes(busca);});
  el('paletes').innerHTML = linhas.map(function(l) {
    var k=idLinha(l), checked=!!selecionados[k];
    return '<div class="item '+(checked?'selected':l.disponivel?'':'blocked')+'"><label><input type="checkbox" data-palete="'+e(k)+'" '+(checked?'checked ':'')+(!l.disponivel||enviando||tentativa?'disabled ':'')+'><b>'+e(l.lote.identificadorPalete||l.loteKey)+'</b> · '+Number(l.lote.saldoLote).toLocaleString('pt-BR')+' un</label>'+
      '<div>'+e(l.lote.itemCodigo)+' — '+e(l.lote.itemNome)+'</div><div class="sub">Pedido '+e(l.pedidoNumero||'sem vínculo')+' · '+e(l.cliente)+'</div>'+
      '<div class="sub">OP/lote '+e(l.lote.opLote||l.lote.opKey)+' · Endereço '+e(l.endereco.codigo||l.lote.enderecoCodigo||'pendente')+'</div>'+
      '<div class="sub">'+(l.disponivel?'<span class="badge">'+e(l.lote.status === 'APROVADO_CONCESSAO'?'Liberado com concessão':'Liberado para expedição')+'</span>':'<span class="warning">'+e(l.motivo)+'</span>')+'</div></div>';
  }).join('') || '<p class="sub">Nenhum palete neste filtro. Os paletes aparecem após a conferência de PA; a liberação da Qualidade e o endereço definitivo permitem a saída.</p>';
  el('paletes').querySelectorAll('[data-palete]').forEach(function(input){input.onchange=function(){
    var l=linhas.find(function(x){return idLinha(x)===input.dataset.palete;});
    if(input.checked) {if(!Object.keys(selecionados).length && l.frete.tipo) el('tipo').value=l.frete.tipo==='FOB'?'COLETA':'ENTREGA'; selecionados[idLinha(l)]=l;}
    else delete selecionados[idLinha(l)];
    renderPaletes();
  };});
  resumo();
}
function renderCargas() {
  var arr=Object.entries(cargas).sort(function(a,b){return String(b[1].criadoEm||'').localeCompare(String(a[1].criadoEm||''));}).slice(0,50);
  el('lista').innerHTML=arr.map(function(entry){var c=entry[1];
    return '<details class="item"><summary><b>'+e(c.numero||entry[0])+'</b> · '+e(c.cliente)+' · '+e(c.data)+' · '+e(c.status)+'<div class="sub">'+(c.versao===2?(c.totalPaletes+' palete(s) · '+c.totalUnidades+' un'):'Registro anterior à saída por paletes')+' · NF '+e(c.nf||'pendente')+'</div></summary>'+
      '<div class="sub">'+e(c.transportadora)+' · '+e(c.veiculo)+' · '+e(c.enderecoEntrega||'')+'</div><table><tr><th>Palete / SKU</th><th>Pedido / OP</th><th>Endereço de saída</th><th>Qtd.</th></tr>'+
      Object.values(c.itens||{}).map(function(l){return '<tr><td>'+e(l.identificadorPalete||'Legado')+'<br>'+e(l.sku)+'</td><td>'+e(l.pedidoNumero||l.pedidoId||c.pedidoId)+'<br>'+e(l.opLote||'')+'</td><td>'+e(l.enderecoCodigo||'—')+'</td><td>'+e(l.qtd)+'</td></tr>';}).join('')+'</table></details>';
  }).join('')||'<p class="sub">Nenhuma carga registrada.</p>';
}
el('salvar').onclick=async function(){
  if(enviando) return;
  if(!tentativa) {
    if(!Object.keys(selecionados).length || !el('data').value) return aviso('Selecione paletes e informe a data da saída.',true);
    if(!confirm('Confirmar a saída física de '+Object.keys(selecionados).length+' palete(s)? Esta confirmação baixa os paletes do estoque.')) return;
    tentativa={idempotencyKey:crypto.randomUUID(),data:el('data').value,tipo:el('tipo').value,nf:el('nf').value.trim(),serie:el('serie').value.trim(),chaveNfe:el('chave').value.trim(),valorFaturado:el('valor').value,transportadora:el('transportadora').value,veiculo:el('veiculo').value,observacoes:el('obs').value,
      paletes:Object.values(selecionados).map(function(l){return{itemKey:l.itemKey,loteKey:l.loteKey,quantidade:Number(l.lote.saldoLote),enderecoKey:l.lote.enderecoKey,skuPedidoKey:l.skuPedidoKey};})};
    sessionStorage.setItem('expedicaoPA-tentativa',JSON.stringify(tentativa));
  }
  enviando=true;renderPaletes();resumo();
  try {
    var r=await fn.httpsCallable('confirmarExpedicaoPA')(tentativa);
    aviso('Saída confirmada: '+r.data.numero+'. Paletes baixados e pedidos vinculados.');
    tentativa=null;sessionStorage.removeItem('expedicaoPA-tentativa');selecionados={};
    ['nf','serie','chave','valor','transportadora','veiculo','obs'].forEach(function(k){el(k).value='';});
  } catch(err) {
    var definitivo=['functions/invalid-argument','functions/failed-precondition','functions/permission-denied','functions/unauthenticated'].includes(err.code);
    aviso((err.message||'Falha na confirmação.')+(definitivo?'':' Use “Verificar / repetir confirmação” para consultar a mesma operação sem duplicar a saída.'),true);
    if(definitivo){tentativa=null;sessionStorage.removeItem('expedicaoPA-tentativa');}
  } finally {enviando=false;renderPaletes();resumo();}
};
el('busca').oninput=renderPaletes;el('bloqueados').onchange=renderPaletes;el('data').value=hoje();el('data').max=hoje();
try {tentativa=JSON.parse(sessionStorage.getItem('expedicaoPA-tentativa')||'null');} catch(ignore){}
Object.keys(base).forEach(function(no){dbOnValue(db.ref(no),function(s){base[no]=s.val()||{};carregados.add(no);renderPaletes();if(tentativa&&!enviando)aviso('Há uma confirmação pendente de resposta. Use “Verificar / repetir confirmação” para recuperar o resultado.',true);});});
dbOnValue(db.ref('expedicoes_comerciais'),function(s){cargas=s.val()||{};renderCargas();});
