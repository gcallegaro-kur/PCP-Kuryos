'use strict';
const key = v => String(v || '').trim().replace(/[.\/[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60);
function rearranjar(base, data, uid, agora) {
  const fail = message => { throw new Error(message); };
  if (!base.usuarios || !base.usuarios[uid] || base.usuarios[uid].role !== 'admin') fail('Somente administradores podem rearranjar linhas.');
  const id = String(data.operacaoId || '');
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(id)) fail('Identificador de operação inválido.');
  const anterior = (base.rearranjos_linhas || {})[id];
  if (anterior) {
    if (anterior.uid !== uid || anterior.origem !== data.origem || anterior.destino !== data.destino || anterior.lote !== data.lote) fail('Operação já utilizada para outro rearranjo.');
    return anterior;
  }
  const linhas = Object.values((base.config || {}).linhas || {});
  if (!linhas.includes(data.origem) || !linhas.includes(data.destino) || data.origem === data.destino) fail('Selecione duas linhas diferentes cadastradas.');
  if (!data.apontamentosConferidos || !String(data.motivo || '').trim()) fail('Confira os apontamentos e informe o motivo.');
  const buscar = linha => Object.entries(base.ops || {}).filter(([,o]) => o.abertaDesde && o.abertaLinha === linha && !['Cancelado','Concluído'].includes(o.status));
  const origem = buscar(data.origem), destino = buscar(data.destino);
  if (origem.length !== 1 || destino.length > 1) fail('A alocação mudou ou está inconsistente. Atualize o painel.');
  if (origem[0][1].lote !== data.lote || (destino[0] ? destino[0][1].lote : '') !== (data.loteDestino || '')) fail('A OP da linha mudou. Reabra o rearranjo.');
  if (destino.length && !data.trocar) fail('Destino ocupado. Confirme a troca entre as duas OPs.');
  base.estado_linhas = base.estado_linhas || {};
  const estados = base.estado_linhas;
  const src = estados[key(data.origem)] || {}, dst = estados[key(data.destino)] || {};
  if (src.retrabalhoId || dst.retrabalhoId) fail('Linha ocupada por retrabalho. Encerre ou reorganize o retrabalho antes de alocar uma OP.');
  const conferirPausa = (state, op) => {
    if (state.status !== 'parada' || !state.inicioParada || !Number.isFinite(Date.parse(state.inicioParada)) || Date.parse(state.inicioParada) > Date.parse(agora)) fail('Pause as linhas envolvidas antes de transferir.');
    if ((state.opAtual && state.opAtual.lote !== op.lote) || (state.lote && state.lote !== op.lote)) fail('A pausa não corresponde à OP alocada. Atualize o painel.');
  };
  conferirPausa(src, origem[0][1]);
  if (destino.length) conferirPausa(dst, destino[0][1]);
  else if (dst.status === 'parada') fail('O destino tem uma parada aberta. Resolva essa parada antes de transferir.');
  const evento = {uid, autor: base.usuarios[uid].nome || uid, timestamp: agora, origem:data.origem, destino:data.destino, lote:data.lote,
    loteDestino:data.loteDestino || '', motivo:String(data.motivo).trim().slice(0,1000), antes:{origem:JSON.parse(JSON.stringify(origem[0][1])), estadoOrigem:src, estadoDestino:dst}};
  if(destino.length) evento.antes.destino=JSON.parse(JSON.stringify(destino[0][1]));
  base.paradas_historico = base.paradas_historico || {};
  const fecharPausa = (linha,state,sufixo) => {
    base.paradas_historico[id+'_'+sufixo] = {linha,lote:state.lote || '',produto:state.produto || '',pedidoId:state.pedidoId || '',motivo:state.motivoParada || 'Outros',inicio:state.inicioParada,fim:agora,duracao:Math.round((Date.parse(agora)-Date.parse(state.inicioParada))/60000),timestamp:agora,rearranjoId:id};
  };
  fecharPausa(data.origem,src,'origem');
  if(destino.length) fecharPausa(data.destino,dst,'destino');
  const mover = (entry,linha,state) => {
    entry[1].abertaLinha=linha;
    entry[1].linha=linha;
    entry[1].abertaDesde=agora;
    estados[key(linha)]={...state,opAtual:{lote:entry[1].lote},lote:entry[1].lote,produto:entry[1].produto || '',inicioParada:agora,rearranjoId:id};
  };
  mover(origem[0],data.destino,src);
  if(destino.length) mover(destino[0],data.origem,dst);
  else estados[key(data.origem)]={status:'ativa',rearranjoId:id};
  (base.rearranjos_linhas || (base.rearranjos_linhas={}))[id]=evento;
  return evento;
}
module.exports={rearranjar};
