'use strict';
/* Faturamento da carga de PA (2026-09-17).

   Pedido do usuário: "ao solicitar faturamento de materiais para expedição,
   após faturado, não carregamos toda a carga" -- não coube no frete
   contratado (cubagem/peso) e o excedente "vai em uma próxima viagem, com a
   mesma NF". Hoje a solicitação é uma coluna na planilha ("faturar coleta e
   data"); passa a ser da própria agenda, com e-mail ao Financeiro e cópia à
   diretoria.

   Estados em agendamentos_expedicao/{k}/faturamento:
     SOLICITADO  solicitação registrada (snapshot dos paletes, preço, lote,
                 fabricação, validade, caixas, volumes e peso)
     FATURADO    NF(s) registradas; valem para todas as viagens da carga
   Uma carga aceita mais de uma NF (por pedido, por exemplo): o usuário ainda
   decide o processo e o modelo não deve travar essa decisão.

   Puro: o handler em index.js aplica numa transação na raiz, como a agenda. */

const {analisar} = require('./expedicao_regras');
const DadosNF = require('./dados_nf');
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
    /* Fabricacao, validade, caixas, volumes e peso vem do motor
       `dados_nf.js` (copia byte a byte de public/shared/dados-nf.js), o mesmo
       que a tela usa para travar antes de chamar. Duas contas em dois lugares
       divergiriam em uma semana -- e aqui a conta vai para dentro de uma nota
       fiscal. A validade ANTES era lida de `lote.validade`, campo que nao
       existe (0 de 176 lotes), e saia sempre vazia. */
    const nf = DadosNF.derivar({lote, op: l.op || null, produto, quantidade: unidades, sku: lote.itemCodigo || ap.sku || ''});
    return {
      itemKey: ap.itemKey, loteKey: ap.loteKey, identificadorPalete: lote.identificadorPalete || ap.identificadorPalete || '',
      disponivel: l.disponivel, motivo: l.motivo || '',
      sku: nf.sku, descricao: lote.itemNome || ap.descricao || produto.descricao || '',
      lote: nf.lote,
      // As duas que faltavam na NF:
      dataFabricacao: nf.dataFabricacao, validade: nf.validade,
      // De onde cada data veio -- dado fiscal sem procedencia nao se defende.
      origensNF: nf.origens,
      caixas: nf.caixasFechadas, unidadesPorCaixa: nf.unidadesPorCaixa,
      caixaParcial: nf.unidadesCaixaParcial, caixasParciais: nf.caixasParciais,
      volumes: nf.volumes, unidades,
      pesoKg: nf.pesoKg,
      faltasNF: nf.faltas,
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
    /* Campos obrigatorios da NF (23/10/2026, pedido do usuario): data de
       fabricacao, validade, SKU, caixas e peso. Trava aqui TAMBEM, e nao so na
       tela: a callable e quem grava, e uma solicitacao incompleta chegando ao
       Financeiro e nota emitida errada. Agrupa por SKU porque 12 paletes do
       mesmo produto sao UM cadastro a corrigir, nao 12 problemas. */
    const semDados = itens.filter(i => (i.faltasNF || []).length);
    if (semDados.length) {
      const porSku = {};
      semDados.forEach(i => (i.faltasNF || []).forEach(f => {
        const ch = (f.sku || i.sku || '?') + ' — ' + f.rotulo;
        (porSku[ch] = porSku[ch] || []).push(i.identificadorPalete || i.loteKey);
      }));
      falhar('Falta dado obrigatório para a nota fiscal: ' +
        Object.keys(porSku).map(k => k + ' (palete ' + porSku[k].join(', ') + ')').join('; ') +
        '. Complete o cadastro do produto e tente de novo.');
    }
    const semPreco = itens.filter(i => !(i.precoUnitario > 0)).length;
    const solicitacao = {
      id: dados.solicitacaoId, em: agora, por: autor, porUid: uid, observacoes: texto(dados.observacoes, 2000),
      cliente: agenda.cliente || '', clienteKey: agenda.clienteKey || '', tipo: agenda.tipo, dataAgendada: agenda.dataAgendada,
      janela: agenda.janela || '', enderecoEntrega: agenda.enderecoEntrega || '', transportadora: agenda.transportadora || '',
      itens, totalUnidades: itens.reduce((t, i) => t + i.unidades, 0), totalValor: Math.round(itens.reduce((t, i) => t + i.valor, 0) * 100) / 100,
      totalPesoKg: Math.round(itens.reduce((t, i) => t + i.pesoKg, 0) * 1000) / 1000,
      // Volumes totais: o que o transportador conta na doca e o que vai no
      // campo de volumes da nota.
      totalVolumes: itens.reduce((t, i) => t + n(i.volumes), 0),
      totalCaixasFechadas: itens.reduce((t, i) => t + n(i.caixas), 0),
      totalCaixasParciais: itens.reduce((t, i) => t + n(i.caixasParciais), 0),
      itensSemPreco: semPreco
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
