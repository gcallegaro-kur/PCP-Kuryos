'use strict';
/* Faturamento da carga de PA (2026-09-17).

   Pedido do usuário: "ao solicitar faturamento de materiais para expedição,
   após faturado, não carregamos toda a carga" -- não coube no frete
   contratado (cubagem/peso) e o excedente "vai em uma próxima viagem, com a
   mesma NF". Hoje a solicitação é uma coluna na planilha ("faturar coleta e
   data"); passa a ser da própria agenda, com e-mail ao Financeiro e cópia à
   diretoria.

   Estados em agendamentos_expedicao/{k}/faturamento:
     SOLICITADO  solicitação registrada (snapshot dos paletes, preço, lote/validade)
     FATURADO    NF(s) registradas; valem para todas as viagens da carga
   Uma carga aceita mais de uma NF (por pedido, por exemplo): o usuário ainda
   decide o processo e o modelo não deve travar essa decisão.

   Puro: o handler em index.js aplica numa transação na raiz, como a agenda. */

const {analisar} = require('./expedicao_regras');
const {ativa, pendente} = require('./agenda_expedicao');

function falhar(message, code = 'failed-precondition') { throw Object.assign(new Error(message), {code}); }
function texto(v, limite = 200) { return String(v == null ? '' : v).trim().slice(0, limite); }
function chave(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v); }
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function produtoDoSku(produtos, sku) {
  produtos = produtos || {};
  if (produtos[sku]) return produtos[sku];
  const k = Object.keys(produtos).find(x => (produtos[x] || {}).sku === sku);
  return k ? produtos[k] : null;
}

// Um item por palete: tudo que o Financeiro precisa para emitir sem abrir o sistema.
function itensDaCarga(base, agenda, hoje) {
  return (agenda.paletes || []).map(ap => {
    const l = analisar(base, ap.itemKey, ap.loteKey, hoje);
    const lote = l.lote || {};
    const itemPedido = l.comercial ? Object.values(l.comercial.itens || {}).find(i => i && i.sku === lote.itemCodigo) || {} : {};
    const produto = produtoDoSku(base.produtos, lote.itemCodigo) || {};
    const unidades = n(ap.quantidade);
    const preco = n(itemPedido.valorUnitario) > 0 ? n(itemPedido.valorUnitario) : n(l.demanda && l.demanda.valorUnitario);
    const caixas = n(lote.caixasFechadas), parcial = n(lote.unidadesCaixaParcial);
    const kgCx = n(lote.pesoPorCaixaKg) || n(produto.kgCaixa);
    const volumes = caixas + (parcial > 0 ? 1 : 0);
    return {
      itemKey: ap.itemKey, loteKey: ap.loteKey, identificadorPalete: lote.identificadorPalete || ap.identificadorPalete || '',
      disponivel: l.disponivel, motivo: l.motivo || '',
      sku: lote.itemCodigo || ap.sku || '', descricao: lote.itemNome || ap.descricao || produto.descricao || '',
      lote: lote.opLote || lote.loteOrigem || '', validade: lote.validade ? String(lote.validade).slice(0, 10) : '',
      caixas, unidadesPorCaixa: n(lote.unidadesPorCaixa), caixaParcial: parcial, unidades,
      pesoKg: n(lote.pesoTotalKg) || (kgCx && volumes ? Math.round(volumes * kgCx * 1000) / 1000 : 0),
      pedidoId: l.pedidoId || ap.pedidoId || '', pedidoNumero: l.pedidoNumero || ap.pedidoNumero || '',
      numeroPedidoCliente: (l.comercial && l.comercial.numeroPedidoCliente) || '',
      precoUnitario: preco, valor: Math.round(unidades * preco * 100) / 100
    };
  });
}

/* dados: {agendaKey, revisao, acao, solicitacaoId?, observacoes?, nf?: {numero, serie, chaveNfe, valor, emitidaEm}} */
function prepararFaturamento(base, dados, autor, uid, agora) {
  dados = dados || {};
  if (!chave(dados.agendaKey)) falhar('Identificador da carga inválido.', 'invalid-argument');
  const agenda = (base.agendamentos_expedicao || {})[dados.agendaKey];
  if (!agenda) falhar('Carga agendada não encontrada.', 'not-found');
  if (!ativa(agenda)) falhar('Esta carga já foi encerrada.');
  if (Number(dados.revisao) !== agenda.revisao) falhar('A carga mudou em outra tela. Reabra antes de continuar.', 'aborted');
  const hoje = new Date(agora).toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'});
  const fat = JSON.parse(JSON.stringify(agenda.faturamento || {}));
  const revisao = agenda.revisao + 1;
  const historico = {...(agenda.historico || {})};

  if (dados.acao === 'SOLICITAR') {
    if (!chave(dados.solicitacaoId)) falhar('Identificador da solicitação inválido.', 'invalid-argument');
    if (fat.solicitacoes && fat.solicitacoes[dados.solicitacaoId]) return {agenda, repetida: true};
    if (fat.status === 'FATURADO') falhar('Carga já faturada. Registre outra NF, se precisar, em vez de solicitar de novo.');
    if (agenda.status !== 'AGENDADO') falhar('Só carga que ainda não saiu pode ter o faturamento solicitado.');
    const itens = itensDaCarga(base, agenda, hoje);
    const bloqueados = itens.filter(i => !i.disponivel);
    if (bloqueados.length) falhar('Não solicite faturamento de palete que não pode sair: ' + bloqueados.map(i => (i.identificadorPalete || i.loteKey) + ' (' + i.motivo + ')').join('; '));
    const semPreco = itens.filter(i => !(i.precoUnitario > 0)).length;
    const solicitacao = {
      id: dados.solicitacaoId, em: agora, por: autor, porUid: uid, observacoes: texto(dados.observacoes, 2000),
      cliente: agenda.cliente || '', clienteKey: agenda.clienteKey || '', tipo: agenda.tipo, dataAgendada: agenda.dataAgendada,
      janela: agenda.janela || '', enderecoEntrega: agenda.enderecoEntrega || '', transportadora: agenda.transportadora || '',
      itens, totalUnidades: itens.reduce((t, i) => t + i.unidades, 0), totalValor: Math.round(itens.reduce((t, i) => t + i.valor, 0) * 100) / 100,
      totalPesoKg: Math.round(itens.reduce((t, i) => t + i.pesoKg, 0) * 1000) / 1000, itensSemPreco: semPreco
    };
    fat.status = 'SOLICITADO';
    fat.solicitadoEm = agora;
    fat.solicitadoPor = autor;
    fat.solicitacoes = {...(fat.solicitacoes || {}), [dados.solicitacaoId]: solicitacao};
    historico['r' + revisao] = {tipo: 'FATURAMENTO_SOLICITADO', em: agora, por: autor};
    return {agenda: {...agenda, faturamento: fat, revisao, historico, atualizadoEm: agora, atualizadoPor: autor}, solicitacao, repetida: false};
  }

  if (dados.acao === 'REGISTRAR_NF') {
    const nf = dados.nf || {};
    const numero = texto(nf.numero, 30);
    if (!numero) falhar('Informe o número da NF.', 'invalid-argument');
    const chaveNfe = texto(nf.chaveNfe, 60).replace(/\s+/g, '');
    if (chaveNfe && !/^\d{44}$/.test(chaveNfe)) falhar('A chave NF-e deve ter 44 dígitos.', 'invalid-argument');
    const valor = Number(nf.valor || 0);
    if (!Number.isFinite(valor) || valor < 0) falhar('Valor da NF inválido.', 'invalid-argument');
    const emitidaEm = texto(nf.emitidaEm, 10) || hoje;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(emitidaEm)) falhar('Data de emissão inválida.', 'invalid-argument');
    const serie = texto(nf.serie, 10);
    const nfs = {...(fat.nfs || {})};
    if (Object.values(nfs).some(x => x.numero === numero && (x.serie || '') === serie)) falhar('NF ' + numero + ' já registrada nesta carga.');
    const id = 'nf_' + numero.replace(/[^A-Za-z0-9]/g, '') + (serie ? '_' + serie.replace(/[^A-Za-z0-9]/g, '') : '');
    nfs[id] = {numero, serie, chaveNfe, valor, emitidaEm, registradoEm: agora, registradoPor: autor,
      paletes: (agenda.paletes || []).filter(p => pendente(p) > 0 || !agenda.viagens).map(p => p.itemKey + '/' + p.loteKey)};
    fat.status = 'FATURADO';
    fat.nfs = nfs;
    fat.faturadoEm = fat.faturadoEm || agora;
    historico['r' + revisao] = {tipo: 'NF_REGISTRADA', em: agora, por: autor, nf: numero};
    return {agenda: {...agenda, faturamento: fat, revisao, historico, atualizadoEm: agora, atualizadoPor: autor}, repetida: false};
  }

  falhar('Ação de faturamento inválida.', 'invalid-argument');
}

module.exports = {prepararFaturamento, itensDaCarga};
