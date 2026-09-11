'use strict';

const {analisar} = require('./expedicao_regras');
const {agendaDaSaida} = require('./agenda_expedicao');
function erro(code, message) { throw Object.assign(new Error(message), {code}); }
function chave(v) { return typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[.#$[\]/]/.test(v); }
function texto(v, max = 500) { return String(v || '').trim().slice(0, max); }
function prepararSaida(base, data, autor, uid, agora) {
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(data.idempotencyKey || '')) erro('invalid-argument', 'Identificador da operação inválido.');
  const cargaKey = 'exp_' + data.idempotencyKey;
  const anterior = (base.expedicoes_comerciais || {})[cargaKey];
  if (anterior) {
    if (anterior.criadoPorUid !== uid) erro('permission-denied', 'Esta operação pertence a outro usuário.');
    return {cargaKey, carga: anterior, updates: {}, repetida: true};
  }
  const agenda = agendaDaSaida(base, data);
  if (!Array.isArray(data.paletes) || !data.paletes.length || data.paletes.length > 100) erro('invalid-argument', 'Selecione entre 1 e 100 paletes.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.data || '') || !Number.isFinite(Date.parse(data.data)) || new Date(data.data).toISOString().slice(0, 10) !== data.data) erro('invalid-argument', 'Informe uma data válida para a saída.');
  const hoje = new Date(agora).toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'});
  if (data.data > hoje) erro('invalid-argument', 'Confirme a saída somente quando a carga sair; a data não pode ser futura.');
  if (!['ENTREGA', 'COLETA'].includes(data.tipo)) erro('invalid-argument', 'Tipo de transporte inválido.');
  const valor = Number(data.valorFaturado || 0);
  if (!Number.isFinite(valor) || valor < 0) erro('invalid-argument', 'Valor faturado inválido.');
  const chaveNfe = texto(data.chaveNfe, 100);
  if (chaveNfe && !/^\d{44}$/.test(chaveNfe)) erro('invalid-argument', 'A chave NF-e deve ter 44 dígitos.');
  const seen = new Set();
  const linhas = data.paletes.map(p => {
    if (!chave(p.itemKey) || !chave(p.loteKey)) erro('invalid-argument', 'Palete inválido.');
    const ref = p.itemKey + '/' + p.loteKey;
    if (seen.has(ref)) erro('invalid-argument', 'Palete duplicado na seleção.');
    seen.add(ref);
    const l = analisar(base, p.itemKey, p.loteKey, hoje);
    if (!l.disponivel) erro('failed-precondition', (l.lote.identificadorPalete || p.loteKey) + ': ' + l.motivo);
    if (Number(p.quantidade) !== Number(l.lote.saldoLote) || p.enderecoKey !== l.lote.enderecoKey || p.skuPedidoKey !== l.skuPedidoKey) erro('failed-precondition', 'Saldo, endereço ou pedido do palete mudou. Atualize e selecione novamente.');
    return l;
  });
  const primeira = linhas[0];
  if (linhas.some(l => (l.clienteKey || l.cliente) !== (primeira.clienteKey || primeira.cliente))) erro('failed-precondition', 'Cada carga deve conter paletes do mesmo cliente.');
  if (linhas.some(l => JSON.stringify(l.frete.enderecoEntrega || '') !== JSON.stringify(primeira.frete.enderecoEntrega || ''))) erro('failed-precondition', 'Os pedidos possuem destinos diferentes. Separe as cargas.');
  if (linhas.some(l => l.frete.tipo && (l.frete.tipo === 'FOB' ? 'COLETA' : 'ENTREGA') !== data.tipo)) erro('failed-precondition', 'O transporte deve respeitar o CIF/FOB dos pedidos de origem.');
  const updates = {}, pedidos = {}, porDemanda = {}, porComercial = {};
  const itens = linhas.map(l => {
    const p = l.lote, qtd = Number(p.saldoLote);
    porDemanda[l.skuPedidoKey] = (porDemanda[l.skuPedidoKey] || 0) + qtd;
    if (l.comercial) {
      const item = Object.entries(l.comercial.itens).find(([, i]) => i.sku === p.itemCodigo);
      const path = 'pedidos_comerciais/' + l.pedidoId + '/itens/' + item[0] + '/expedido';
      porComercial[path] = (porComercial[path] == null ? Number(item[1].expedido || 0) : porComercial[path]) + qtd;
    }
    pedidos[l.pedidoId] = {pedidoId: l.pedidoId, numero: l.pedidoNumero, cliente: l.cliente, clienteKey: l.clienteKey,
      origem: l.comercial ? 'pedidos_comerciais' : 'pedidos', dados: JSON.parse(JSON.stringify(l.comercial || l.demanda)),
      cadastroCliente: l.clienteKey ? (base.clientes || {})[l.clienteKey] || null : null};
    const path = 'estoque_lotes/' + l.itemKey + '/' + l.loteKey + '/';
    updates[path + 'saldoLote'] = 0;
    updates[path + 'status'] = 'EXPEDIDO';
    updates[path + 'expedicaoId'] = cargaKey;
    updates[path + 'expedidoEm'] = agora;
    updates[path + 'expedidoPor'] = autor;
    updates[path + 'atualizadoEm'] = agora;
    updates['movimentos_estoque/' + l.itemKey + '/' + cargaKey + '_' + l.loteKey] = {
      tipo: 'expedicao_pa', motivo: 'SAÍDA DE PA POR PALETE', qtd: -qtd, saldoApos: 0,
      ref: cargaKey, loteKey: l.loteKey, itemTipo: 'produto', itemCodigo: p.itemCodigo, itemNome: p.itemNome || '',
      enderecoKey: p.enderecoKey, enderecoCodigo: l.endereco.codigo || p.enderecoCodigo || p.enderecoKey,
      opKey: p.opKey, pedidoId: l.pedidoId, skuPedidoKey: l.skuPedidoKey, autor, em: agora, unidade: p.unidade || 'un'};
    return {itemKey: l.itemKey, loteKey: l.loteKey, identificadorPalete: p.identificadorPalete,
      sku: p.itemCodigo, descricao: p.itemNome || l.op.produto || '', qtd, unidade: p.unidade || 'un',
      pedidoId: l.pedidoId, pedidoNumero: l.pedidoNumero, skuPedidoKey: l.skuPedidoKey,
      opKey: p.opKey, opLote: p.opLote || l.op.lote || '', loteOrigem: p.loteOrigem || '',
      enderecoKey: p.enderecoKey, enderecoCodigo: l.endereco.codigo || p.enderecoCodigo || p.enderecoKey,
      validade: p.validade || null, conferencia: p.conferencia, qualidade: p.qualidade,
      paleteOrigem: JSON.parse(JSON.stringify(p)), producao: JSON.parse(JSON.stringify(l.op))};
  });
  for (const [k, qtd] of Object.entries(porDemanda)) updates['pedidos/' + k + '/expedido'] = Number(base.pedidos[k].expedido || 0) + qtd;
  Object.assign(updates, porComercial);
  for (const id of Object.keys(pedidos)) updates['comercial_eventos/' + id + '/' + cargaKey] = {tipo: 'SAIDA_PA_CONFIRMADA', cargaKey, em: agora, por: autor};
  const ids = Object.keys(pedidos);
  const carga = {versao: 2, numero: 'EXP-' + data.idempotencyKey.toUpperCase(), pedidoId: ids.length === 1 ? ids[0] : null,
    pedidos, cliente: primeira.cliente, clienteKey: primeira.clienteKey, data: data.data, status: 'EXPEDIDO', tipo: data.tipo,
    enderecoEntrega: primeira.frete.enderecoEntrega || '', nf: texto(data.nf, 30), serie: texto(data.serie, 10), chaveNfe,
    statusFiscal: data.nf ? 'NF_EXTERNA_INFORMADA' : 'PENDENTE', valorFaturado: valor,
    transportadora: texto(data.transportadora), motorista: texto(data.motorista), contatoMotorista: texto(data.contatoMotorista, 60), placa: texto(data.placa, 20).toUpperCase(),
    veiculo: texto(data.veiculo || [data.motorista, data.placa].filter(Boolean).join(' / '), 100), observacoes: texto(data.observacoes, 2000),
    agendaKey: agenda ? data.agendaKey : null, agendamento: agenda ? JSON.parse(JSON.stringify(agenda)) : null,
    itens, totalPaletes: itens.length, totalUnidades: itens.reduce((s, l) => s + l.qtd, 0), criadoEm: agora, criadoPor: autor, criadoPorUid: uid};
  updates['expedicoes_comerciais/' + cargaKey] = carga;
  if (agenda) {
    const agPath = 'agendamentos_expedicao/' + data.agendaKey + '/';
    updates[agPath + 'status'] = 'EXPEDIDO';
    updates[agPath + 'expedicaoId'] = cargaKey;
    updates[agPath + 'revisao'] = agenda.revisao + 1;
    updates[agPath + 'atualizadoEm'] = agora;
    updates[agPath + 'atualizadoPor'] = autor;
    ['transportadora', 'motorista', 'contatoMotorista', 'placa'].forEach(k => { updates[agPath + k] = carga[k]; });
    updates[agPath + 'historico/r' + (agenda.revisao + 1)] = {tipo: 'SAIDA_CONFIRMADA', em: agora, por: autor,
      transportadora: carga.transportadora, motorista: carga.motorista, contatoMotorista: carga.contatoMotorista, placa: carga.placa};
  }
  return {cargaKey, carga, updates, repetida: false};
}
module.exports = {prepararSaida};
