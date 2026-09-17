'use strict';

const {analisar} = require('./expedicao_regras');
const {agendaDaSaida, snapshotContato, pendente} = require('./agenda_expedicao');
// Quanto do palete sobe no veículo. Sem "carregar" = palete inteiro (fluxo
// original). Parcial é por caixas: N caixas completas e, opcionalmente, a
// caixa parcial -- nunca unidades soltas, que não existem no chão de fábrica.
// Só a carga agendada aceita parcial/zero: o saldo que fica precisa de uma
// agenda (e da NF dela) que o segure para a próxima viagem.
function planoDeCarregamento(p, lote, comAgenda) {
  const saldo = Number(lote.saldoLote);
  const c = p.carregar;
  if (!c || c.modo == null || c.modo === 'INTEIRO') return {unidades: saldo, caixas: Number(lote.caixasFechadas) || 0, parcial: Number(lote.unidadesCaixaParcial) > 0};
  if (!comAgenda) erro('failed-precondition', 'Carga parcial só em carga agendada: o saldo que fica precisa seguir reservado para a próxima viagem.');
  if (c.modo === 'NAO_CARREGADO') return {unidades: 0, caixas: 0, parcial: false};
  if (c.modo !== 'PARCIAL') erro('invalid-argument', 'Modo de carregamento inválido.');
  const nome = lote.identificadorPalete || 'Palete';
  const cx = Number(lote.caixasFechadas), mult = Number(lote.unidadesPorCaixa), resto = Number(lote.unidadesCaixaParcial || 0);
  const composicaoOk = Number.isInteger(cx) && cx >= 0 && Number.isInteger(resto) && resto >= 0 &&
    (cx === 0 || Number.isInteger(mult) && mult > 0) && cx * (mult || 0) + resto === saldo;
  if (!composicaoOk) erro('failed-precondition', nome + ': composição das caixas a conferir; carregue o palete inteiro ou marque como não carregado.');
  const caixas = Number(c.caixas || 0), comParcial = c.caixaParcial === true;
  if (!Number.isInteger(caixas) || caixas < 0 || caixas > cx) erro('invalid-argument', nome + ': informe entre 0 e ' + cx + ' caixas completas.');
  if (comParcial && !(resto > 0)) erro('invalid-argument', nome + ': este palete não tem caixa parcial.');
  return {unidades: caixas * (mult || 0) + (comParcial ? resto : 0), caixas, parcial: comParcial};
}
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
  const linhasTodas = data.paletes.map(p => {
    if (!chave(p.itemKey) || !chave(p.loteKey)) erro('invalid-argument', 'Palete inválido.');
    const ref = p.itemKey + '/' + p.loteKey;
    if (seen.has(ref)) erro('invalid-argument', 'Palete duplicado na seleção.');
    seen.add(ref);
    const l = analisar(base, p.itemKey, p.loteKey, hoje);
    if (!l.disponivel) erro('failed-precondition', (l.lote.identificadorPalete || p.loteKey) + ': ' + l.motivo);
    if (Number(p.quantidade) !== Number(l.lote.saldoLote) || p.enderecoKey !== l.lote.enderecoKey || p.skuPedidoKey !== l.skuPedidoKey) erro('failed-precondition', 'Saldo, endereço ou pedido do palete mudou. Atualize e selecione novamente.');
    if (agenda) {
      const ap = (agenda.paletes || []).find(x => x.itemKey === p.itemKey && x.loteKey === p.loteKey);
      if (!ap || pendente(ap) !== Number(l.lote.saldoLote)) erro('failed-precondition', (l.lote.identificadorPalete || p.loteKey) + ': saldo do palete difere do pendente da agenda. Atualize a carga.');
    }
    l.carga = planoDeCarregamento(p, l.lote, !!agenda);
    return l;
  });
  const linhas = linhasTodas.filter(l => l.carga.unidades > 0);
  if (!linhas.length) erro('invalid-argument', 'Nenhuma unidade marcada como carregada.');
  const primeira = linhas[0];
  if (linhas.some(l => (l.clienteKey || l.cliente) !== (primeira.clienteKey || primeira.cliente))) erro('failed-precondition', 'Cada carga deve conter paletes do mesmo cliente.');
  if (linhas.some(l => JSON.stringify(l.frete.enderecoEntrega || '') !== JSON.stringify(primeira.frete.enderecoEntrega || ''))) erro('failed-precondition', 'Os pedidos possuem destinos diferentes. Separe as cargas.');
  if (linhas.some(l => l.frete.tipo && (l.frete.tipo === 'FOB' ? 'COLETA' : 'ENTREGA') !== data.tipo)) erro('failed-precondition', 'O transporte deve respeitar o CIF/FOB dos pedidos de origem.');
  const updates = {}, pedidos = {}, porDemanda = {}, porComercial = {};
  const itens = linhas.map(l => {
    const p = l.lote, qtd = l.carga.unidades, restante = Number(p.saldoLote) - qtd;
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
    if (restante === 0) {
      updates[path + 'saldoLote'] = 0;
      updates[path + 'status'] = 'EXPEDIDO';
      updates[path + 'expedicaoId'] = cargaKey;
      updates[path + 'expedidoEm'] = agora;
      updates[path + 'expedidoPor'] = autor;
    } else {
      // Parcial: o palete continua no endereço com as caixas que ficaram.
      updates[path + 'saldoLote'] = restante;
      updates[path + 'caixasFechadas'] = Number(p.caixasFechadas) - l.carga.caixas;
      if (l.carga.parcial) updates[path + 'unidadesCaixaParcial'] = 0;
      updates[path + 'ultimaExpedicaoId'] = cargaKey;
    }
    updates[path + 'atualizadoEm'] = agora;
    updates['movimentos_estoque/' + l.itemKey + '/' + cargaKey + '_' + l.loteKey] = {
      tipo: 'expedicao_pa', motivo: restante === 0 ? 'SAÍDA DE PA POR PALETE' : 'SAÍDA PARCIAL DE PA (CAIXAS)', qtd: -qtd, saldoApos: restante,
      ref: cargaKey, loteKey: l.loteKey, itemTipo: 'produto', itemCodigo: p.itemCodigo, itemNome: p.itemNome || '',
      enderecoKey: p.enderecoKey, enderecoCodigo: l.endereco.codigo || p.enderecoCodigo || p.enderecoKey,
      opKey: p.opKey, pedidoId: l.pedidoId, skuPedidoKey: l.skuPedidoKey, autor, em: agora, unidade: p.unidade || 'un'};
    return {itemKey: l.itemKey, loteKey: l.loteKey, identificadorPalete: p.identificadorPalete,
      sku: p.itemCodigo, descricao: p.itemNome || l.op.produto || '', qtd, unidade: p.unidade || 'un',
      parcial: restante > 0, caixasCarregadas: l.carga.caixas, caixaParcialCarregada: l.carga.parcial, saldoRestante: restante,
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
  // NF registrada na agenda vale para todas as viagens da carga.
  const nfsAgenda = agenda && agenda.faturamento && agenda.faturamento.nfs ? Object.values(agenda.faturamento.nfs) : [];
  const viagem = agenda ? Object.keys(agenda.viagens || {}).length + 1 : 1;
  const naoCarregados = linhasTodas.filter(l => l.carga.unidades < Number(l.lote.saldoLote)).map(l => ({
    itemKey: l.itemKey, loteKey: l.loteKey, identificadorPalete: l.lote.identificadorPalete || null, sku: l.lote.itemCodigo,
    ficou: Number(l.lote.saldoLote) - l.carga.unidades}));
  const carga = {versao: 2, numero: 'EXP-' + data.idempotencyKey.toUpperCase(), pedidoId: ids.length === 1 ? ids[0] : null,
    pedidos, cliente: primeira.cliente, clienteKey: primeira.clienteKey, data: data.data, status: 'EXPEDIDO', tipo: data.tipo,
    enderecoEntrega: primeira.frete.enderecoEntrega || '',
    nf: nfsAgenda.length ? nfsAgenda.map(n => n.numero).join(', ') : texto(data.nf, 30),
    serie: nfsAgenda.length ? nfsAgenda.map(n => n.serie || '').filter(Boolean).join(', ') : texto(data.serie, 10),
    chaveNfe: nfsAgenda.length ? (nfsAgenda[0].chaveNfe || '') : chaveNfe,
    statusFiscal: nfsAgenda.length ? 'NF_DA_AGENDA' : data.nf ? 'NF_EXTERNA_INFORMADA' : 'PENDENTE',
    // O valor é da NF, não da viagem: só a 1ª viagem o carrega (senão soma duas vezes).
    valorFaturado: nfsAgenda.length ? (viagem === 1 ? nfsAgenda.reduce((t, n) => t + Number(n.valor || 0), 0) : 0) : valor,
    viagem, complementar: viagem > 1, naoCarregados,
    transportadora: texto(data.transportadora), motorista: texto(data.motorista), contatoMotorista: texto(data.contatoMotorista, 60), placa: texto(data.placa, 20).toUpperCase(),
    veiculo: texto(data.veiculo || [data.motorista, data.placa].filter(Boolean).join(' / '), 100), observacoes: texto(data.observacoes, 2000),
    contatoCliente: snapshotContato(data.contatoCliente === undefined ? agenda && agenda.contatoCliente : data.contatoCliente),
    agendaKey: agenda ? data.agendaKey : null, agendamento: agenda ? JSON.parse(JSON.stringify(agenda)) : null,
    itens, totalPaletes: itens.length, totalUnidades: itens.reduce((s, l) => s + l.qtd, 0), criadoEm: agora, criadoPor: autor, criadoPorUid: uid};
  updates['expedicoes_comerciais/' + cargaKey] = carga;
  if (agenda) {
    const agPath = 'agendamentos_expedicao/' + data.agendaKey + '/';
    let faltando = 0;
    (agenda.paletes || []).forEach((ap, idx) => {
      const sub = linhas.find(l => l.itemKey === ap.itemKey && l.loteKey === ap.loteKey);
      const embarcado = Number(ap.embarcado || 0) + (sub ? sub.carga.unidades : 0);
      if (sub) updates[agPath + 'paletes/' + idx + '/embarcado'] = embarcado;
      faltando += Math.max(Number(ap.quantidade || 0) - embarcado, 0);
    });
    updates[agPath + 'status'] = faltando > 0 ? 'EXPEDIDO_PARCIAL' : 'EXPEDIDO';
    updates[agPath + 'expedicaoId'] = cargaKey;
    updates[agPath + 'expedicoes/' + cargaKey] = true;
    updates[agPath + 'viagens/v' + viagem] = {viagem, cargaKey, data: data.data, em: agora, por: autor, unidades: carga.totalUnidades,
      paletes: itens.map(i => ({itemKey: i.itemKey, loteKey: i.loteKey, unidades: i.qtd})), aguardandoEmbarque: faltando,
      transportadora: carga.transportadora, placa: carga.placa};
    if (faltando > 0) updates[agPath + 'aguardandoEmbarqueDesde'] = agenda.aguardandoEmbarqueDesde || agora;
    updates[agPath + 'revisao'] = agenda.revisao + 1;
    updates[agPath + 'atualizadoEm'] = agora;
    updates[agPath + 'atualizadoPor'] = autor;
    updates[agPath + 'contatoCliente'] = carga.contatoCliente;
    ['transportadora', 'motorista', 'contatoMotorista', 'placa'].forEach(k => { updates[agPath + k] = carga[k]; });
    updates[agPath + 'historico/r' + (agenda.revisao + 1)] = {tipo: 'SAIDA_CONFIRMADA', em: agora, por: autor,
      transportadora: carga.transportadora, motorista: carga.motorista, contatoMotorista: carga.contatoMotorista, placa: carga.placa, contatoCliente: carga.contatoCliente};
  }
  return {cargaKey, carga, updates, repetida: false};
}
module.exports = {prepararSaida};
