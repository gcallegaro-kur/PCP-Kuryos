'use strict';
const {analisar} = require('./expedicao_regras');
function falhar(message, code = 'failed-precondition') { throw Object.assign(new Error(message), {code}); }
function chave(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v); }
function texto(v, limite = 200) { return String(v || '').trim().slice(0, limite); }
function dataValida(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || '') && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v; }
function referencias(paletes) { return (paletes || []).map(p => p.itemKey + '/' + p.loteKey).sort().join('|'); }
function prepararAgenda(base, dados, autor, uid, agora) {
  if (!chave(dados.agendaKey)) falhar('Identificador do agendamento inválido.', 'invalid-argument');
  const anterior = (base.agendamentos_expedicao || {})[dados.agendaKey];
  if (anterior && anterior.status !== 'AGENDADO') falhar('Esta agenda já foi encerrada.');
  if (anterior && Number(dados.revisao) !== anterior.revisao) falhar('O agendamento mudou em outra tela. Reabra antes de salvar.', 'aborted');
  if (!anterior && Number(dados.revisao || 0) !== 0) falhar('Agendamento não encontrado.', 'not-found');
  if (dados.cancelar) {
    if (!anterior) falhar('Agendamento não encontrado.', 'not-found');
    if (texto(dados.motivo).length < 5) falhar('Informe o motivo do cancelamento.');
    return {...anterior, status: 'CANCELADO', revisao: anterior.revisao + 1, atualizadoEm: agora, atualizadoPor: autor,
      cancelamento: {motivo: texto(dados.motivo), em: agora, por: autor}};
  }
  if (!dataValida(dados.dataAgendada)) falhar('Informe uma data válida para o agendamento.', 'invalid-argument');
  if (!['ENTREGA', 'COLETA'].includes(dados.tipo)) falhar('Informe entrega CIF ou coleta FOB.', 'invalid-argument');
  if (anterior && dados.tipo !== anterior.tipo) falhar('O tipo de transporte deve respeitar o agendamento original. Cancele e reagende para mudar a modalidade.');
  const paletes = anterior ? anterior.paletes : dados.paletes;
  if (!Array.isArray(paletes) || paletes.length < 1 || paletes.length > 100) falhar('Selecione de 1 a 100 paletes para agendar.', 'invalid-argument');
  const hoje = new Date(agora).toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'});
  const vistos = new Set();
  // Alterar o transporte de uma agenda existente não exige nova liberação de CQ.
  // A saída física sempre revalida a disponibilidade e a seleção completa.
  let cliente = anterior && anterior.cliente, clienteKey = anterior && anterior.clienteKey;
  let destino = anterior && anterior.enderecoEntrega;
  const pedidos = anterior ? anterior.pedidos : {};
  const lista = paletes.map(p => {
    if (!chave(p.loteKey) || typeof p.itemKey !== 'string' || /[.#$[\]/]/.test(p.itemKey)) falhar('Referência do palete inválida.', 'invalid-argument');
    const ref = p.itemKey + '/' + p.loteKey;
    if (vistos.has(ref)) falhar('Palete duplicado na agenda.', 'invalid-argument');
    vistos.add(ref);
    if (anterior) return p;
    const l = analisar(base, p.itemKey, p.loteKey, hoje);
    if (!l.disponivel) falhar((l.lote.identificadorPalete || p.loteKey) + ': ' + l.motivo);
    if (Number(p.quantidade) !== Number(l.lote.saldoLote) || p.enderecoKey !== l.lote.enderecoKey || p.skuPedidoKey !== l.skuPedidoKey) falhar('O palete mudou. Atualize a seleção antes de agendar.');
    if (cliente && (clienteKey || cliente) !== (l.clienteKey || l.cliente)) falhar('Agende paletes do mesmo cliente.');
    const endereco = l.frete.enderecoEntrega || '';
    if (destino != null && JSON.stringify(destino) !== JSON.stringify(endereco)) falhar('Separe cargas com destinos diferentes.');
    if (l.frete.tipo && (l.frete.tipo === 'FOB' ? 'COLETA' : 'ENTREGA') !== dados.tipo) falhar('Respeite o CIF/FOB do pedido.');
    cliente = l.cliente; clienteKey = l.clienteKey; destino = endereco;
    pedidos[l.pedidoId] = l.pedidoNumero;
    return {itemKey: p.itemKey, loteKey: p.loteKey, quantidade: Number(p.quantidade), enderecoKey: p.enderecoKey,
      skuPedidoKey: p.skuPedidoKey, identificadorPalete: l.lote.identificadorPalete, sku: l.lote.itemCodigo,
      descricao: l.lote.itemNome || '', pedidoId: l.pedidoId, pedidoNumero: l.pedidoNumero};
  });
  for (const [k, agenda] of Object.entries(base.agendamentos_expedicao || {})) {
    if (k !== dados.agendaKey && agenda.status === 'AGENDADO' && (agenda.paletes || []).some(p => vistos.has(p.itemKey + '/' + p.loteKey))) falhar('Um palete já está em outra carga agendada. Abra essa agenda ou cancele-a antes de reagendar.');
  }
  const transporte = {transportadora: texto(dados.transportadora), motorista: texto(dados.motorista), contatoMotorista: texto(dados.contatoMotorista, 60), placa: texto(dados.placa, 20).toUpperCase()};
  const revisao = anterior ? anterior.revisao + 1 : 1;
  const historico = {...(anterior && anterior.historico || {})};
  historico['r' + revisao] = {em: agora, por: autor, dataAgendada: dados.dataAgendada, janela: texto(dados.janela, 80), ...transporte};
  return {agendaKey: dados.agendaKey, status: 'AGENDADO', revisao, cliente, clienteKey: clienteKey || '',
    enderecoEntrega: destino || '', pedidos, paletes: lista, tipo: dados.tipo, dataAgendada: dados.dataAgendada,
    janela: texto(dados.janela, 80), ...transporte, observacoes: texto(dados.observacoes, 2000), historico,
    criadoEm: anterior ? anterior.criadoEm : agora, criadoPor: anterior ? anterior.criadoPor : autor,
    criadoPorUid: anterior ? anterior.criadoPorUid : uid, atualizadoEm: agora, atualizadoPor: autor};
}
function agendaDaSaida(base, dados) {
  if (!Array.isArray(dados.paletes)) falhar('Selecione os paletes da saída.', 'invalid-argument');
  const agendas = base.agendamentos_expedicao || {};
  const selecionados = new Set((dados.paletes || []).map(p => p.itemKey + '/' + p.loteKey));
  for (const [k, ag] of Object.entries(agendas)) {
    if (ag.status === 'AGENDADO' && k !== dados.agendaKey && (ag.paletes || []).some(p => selecionados.has(p.itemKey + '/' + p.loteKey))) falhar('Palete vinculado a uma carga agendada. Abra o agendamento para confirmar a saída.');
  }
  if (!dados.agendaKey) return null;
  const agenda = agendas[dados.agendaKey];
  if (!agenda || agenda.status !== 'AGENDADO') falhar('Agendamento indisponível ou já encerrado.');
  if (agenda.revisao !== Number(dados.agendaRevisao)) falhar('Os dados de transporte mudaram em outra tela. Reabra o agendamento.', 'aborted');
  if (referencias(agenda.paletes) !== referencias(dados.paletes)) falhar('Confirme todos os paletes agendados. Para mudar a composição, cancele a agenda e monte outra.');
  return agenda;
}
module.exports = {prepararAgenda, agendaDaSaida};
