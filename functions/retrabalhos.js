'use strict';
const key = v => String(v || '').trim().replace(/[.\/[\]#$]/g, '-').replace(/\s+/g, '_').slice(0,60);
const clone = v => JSON.parse(JSON.stringify(v));
const fail = msg => { throw new Error(msg); };
function quantidade(v) { if(v === '' || v == null) return null; const n=Number(v); if(!Number.isSafeInteger(n)||n<0) fail('Informe uma quantidade inteira maior ou igual a zero.'); return n; }
function totalizar(rt) {
  const registros=Object.values(rt.apontamentos || {});
  rt.quantidadeConfirmada=registros.reduce((n,r)=>n+(r.quantidadePendente?0:Number(r.quantidade || 0)),0);
  rt.apontamentosPendentes=registros.filter(r=>r.quantidadePendente).length;
}
function executar(base,d,uid,agora) {
  const user=(base.usuarios || {})[uid] || {};
  if(!['admin','production','pcp'].includes(user.role) && !(user.modulos && user.modulos.apontamento)) fail('Seu perfil não pode apontar retrabalho.');
  const rt=(base.retrabalhos || {})[d.retrabalhoId];
  if(!rt) fail('Retrabalho não encontrado.');
  if(!/^[a-zA-Z0-9_-]{12,100}$/.test(d.operacaoId || '')) fail('Operação inválida.');
  const repetida=(rt.eventos || {})[d.operacaoId];
  const assinatura=JSON.stringify([d.acao,d.apontamentoId || '',d.quantidade == null ? null : d.quantidade,d.motivo || '',d.operador || '']);
  if(repetida){if(repetida.uid!==uid || repetida.assinatura!==assinatura) fail('Identificador usado em outra operação.'); return rt;}
  if(d.revisao!==rt.revisao) fail('O retrabalho foi alterado por outra pessoa. Reabra o registro.');
  const antes=clone(rt);
  if(d.acao==='corrigir_quantidade') {
    if(user.role!=='admin') fail('Somente admin pode corrigir apontamentos anteriores.');
    if(!['pausado','em_andamento','aguardando_qualidade'].includes(rt.status)) fail('Retrabalho encerrado.');
    const ap=(rt.apontamentos || {})[d.apontamentoId];
    if(!ap) fail('Apontamento não encontrado.');
    if(!String(d.motivo || '').trim()) fail('Informe o motivo da correção.');
    const qtd=quantidade(d.quantidade);
    if(qtd===null) fail('Informe a quantidade conferida.');
    ap.quantidade=qtd; ap.quantidadePendente=false; ap.corrigidoEm=agora; ap.corrigidoPor=user.nome || uid;
    if(String(d.operador || '').trim()) ap.operador=String(d.operador).trim().slice(0,120);
  } else {
    const state=(base.estado_linhas || {})[key(rt.linha)] || {};
    if(state.retrabalhoId!==d.retrabalhoId || (base.retrabalhos_linhas || {})[rt.linha]!==d.retrabalhoId) fail('A ocupação da linha mudou. Atualize o painel.');
    if(d.acao==='retomar') {
      if(rt.status!=='pausado'||state.status!=='parada') fail('O retrabalho não está pausado.');
      if(!Number.isFinite(Date.parse(state.inicioParada)) || Date.parse(state.inicioParada)>Date.parse(agora)) fail('Horário de pausa inválido.');
      (base.paradas_historico || (base.paradas_historico={}))[d.operacaoId]={linha:rt.linha,lote:rt.loteOriginal,produto:rt.produto,motivo:state.motivoParada || 'Outros',inicio:state.inicioParada,fim:agora,duracao:Math.round((Date.parse(agora)-Date.parse(state.inicioParada))/60000),timestamp:agora,tipoOperacao:'retrabalho',retrabalhoId:d.retrabalhoId};
      rt.status='em_andamento';rt.periodoInicio=agora;delete rt.inicioParada;
      state.status='ativa';delete state.inicioParada;delete state.motivoParada;
    } else if(d.acao==='pausar') {
      if(rt.status!=='em_andamento' || state.status!=='ativa') fail('O retrabalho não está em execução.');
      if(!String(d.motivo || '').trim()) fail('Informe o motivo da pausa.');
      if(!Number.isFinite(Date.parse(rt.periodoInicio)) || Date.parse(rt.periodoInicio)>Date.parse(agora)) fail('Período inválido.');
      const qtd=quantidade(d.quantidade);
      (rt.apontamentos || (rt.apontamentos={}))[d.operacaoId]={inicio:rt.periodoInicio,fim:agora,linha:rt.linha,etapa:'envase',quantidadePendente:qtd===null,...(qtd===null?{}:{quantidade:qtd}),operador:String(d.operador || '').trim().slice(0,120),registradoPor:user.nome || uid,registradoEm:agora};
      rt.status='pausado';rt.inicioParada=agora;delete rt.periodoInicio;
      state.status='parada';state.inicioParada=agora;state.motivoParada=String(d.motivo).trim().slice(0,300);
    } else if(d.acao==='finalizar') {
      if(rt.status!=='pausado') fail('Pause e confira as quantidades antes de finalizar.');
      totalizar(rt);
      if(rt.apontamentosPendentes) fail('Preencha os apontamentos com quantidade pendente antes de finalizar.');
      if(!String(d.motivo || '').trim()) fail('Informe a observação do encerramento.');
      (base.paradas_historico || (base.paradas_historico={}))[d.operacaoId]={linha:rt.linha,lote:rt.loteOriginal,produto:rt.produto,motivo:state.motivoParada || 'Outros',inicio:state.inicioParada,fim:agora,duracao:Math.max(0,Math.round((Date.parse(agora)-Date.parse(state.inicioParada))/60000)),timestamp:agora,tipoOperacao:'retrabalho',retrabalhoId:d.retrabalhoId};
      rt.status='aguardando_qualidade';rt.encerradoEm=agora;delete rt.inicioParada;
      base.estado_linhas[key(rt.linha)]={status:'ativa'};
      delete base.retrabalhos_linhas[rt.linha];
    } else fail('Ação de retrabalho inválida.');
  }
  totalizar(rt);rt.revisao++;rt.atualizadoEm=agora;
  // Auditoria somente dos dados alterados; não encadear cópias de todo o histórico.
  delete antes.eventos;delete antes.correcaoOrigem;
  (rt.eventos || (rt.eventos={}))[d.operacaoId]={acao:d.acao,uid,autor:user.nome || uid,timestamp:agora,motivo:String(d.motivo || '').trim().slice(0,1000),assinatura,antes};
  return rt;
}

// Correção pontual autorizada: resíduos de um lançamento já anulado; não estorna totais novamente.
function corrigirCaso26216(base,agora) {
  const id='RT-26216-04-20260921';
  if((base.retrabalhos || {})[id]) return {id,repetida:true};
  const falsa=(base.ops || {})['26160-04'], original=(base.ops || {})['26216-04'];
  const state=(base.estado_linhas || {}).Linha_2;
  if(!falsa || !original || !state || falsa.abertaLinha!=='Linha 2' || state.lote!=='26160/04') fail('A alocação original mudou; não corrigir automaticamente.');
  if(original.produzidoLinha!==867 || original.status!=='Concluído') fail('A OP original mudou; revisar antes da correção.');
  if(['produzido','produzidoLinha','produzidoRotulagem','produzidoPosto'].some(k=>Number(falsa[k] || 0)!==0)) fail('Existe produção na OP 26160/04.');
  const marcador='-P24_ZUj63ZaaVgJOW6k';
  if(Object.keys(falsa.apontamentosAplicados || {}).some(k=>k!==marcador)) fail('Há outro apontamento na OP não iniciada.');
  for(const dia of Object.values(base.registros || {})) for(const r of Object.values(dia || {})) if(r.lote==='26160/04') fail('Há registros da OP fictícia para conferir.');
  if(Object.values(base.ops || {}).some(o=>o!==falsa && !['Concluído','Cancelado','Aguardando Confirmação'].includes(o.status) && o.abertaDesde && o.abertaLinha==='Linha 2')) fail('Outra OP ocupa a linha 2.');
  if((base.retrabalhos_linhas || {})['Linha 2']) fail('Linha 2 já reservada para retrabalho.');
  const pedido=(base.pedidos || {})['0007__DPHNPC01'];
  if(!pedido || Number(pedido.produzido || 0)!==0) fail('Pedido original mudou.');
  const audit={timestamp:agora,origem:'Solicitação explícita do administrador nesta tarefa',motivo:'OP 26160/04 não iniciada; unidade fictícia usada para fechar turno. Operação real é retrabalho da OP 26216/04.',antes:{op:clone(falsa),estadoLinha:clone(state),pedido:clone(pedido)}};
  ['abertaDesde','abertaLinha','setupInicio','setupFim','dataInicioReal','dataFimReal','mediaPorHora'].forEach(k=>delete falsa[k]);
  delete falsa.apontamentosAplicados;falsa.status='Programado';
  if(pedido.apontamentosAplicados) {delete pedido.apontamentosAplicados[marcador];if(!Object.keys(pedido.apontamentosAplicados).length)delete pedido.apontamentosAplicados;}
  if(!pedido.apontamentosAplicados){delete pedido.mediaPorHora;delete pedido.ultimoApontamento;}
  const rt={id,loteOriginal:original.lote,opKey:'26216-04',sku:original.sku,skuPedidoKey:original.skuPedidoKey,produto:original.produto,cliente:original.cliente,
    motivo:'Sedimentação inesperada do corante, formando precipitado.',escopo:'Lote inteiro',quantidadeOriginalRegistrada:867,linha:'Linha 2',status:'pausado',revisao:1,
    setupInicio:'2026-09-21T18:42:00.000Z',setupFim:'2026-09-21T19:00:00.000Z',envaseInicio:'2026-09-21T19:00:00.000Z',inicioParada:'2026-09-21T20:09:00.000Z',criadoEm:agora,criadoPor:'Correção solicitada pelo administrador',
    apontamentos:{'envase-20260921':{inicio:'2026-09-21T19:00:00.000Z',fim:'2026-09-21T20:09:00.000Z',linha:'Linha 2',etapa:'envase',quantidadePendente:true,observacao:'Quantidade efetivamente retrabalhada não informada; administrador conferirá no dia seguinte.',registradoEm:agora}},
    correcaoOrigem:audit};
  totalizar(rt);
  (base.retrabalhos || (base.retrabalhos={}))[id]=rt;
  (base.retrabalhos_linhas || (base.retrabalhos_linhas={}))['Linha 2']=id;
  base.estado_linhas.Linha_2={status:'parada',inicioParada:rt.inicioParada,motivoParada:'Fim de turno',lote:original.lote,produto:original.produto,pedidoId:'0017',retrabalhoId:id,tipoOperacao:'retrabalho'};
  return {id,repetida:false};
}
module.exports={executar,corrigirCaso26216,totalizar};
