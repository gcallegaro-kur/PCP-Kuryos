'use strict';
/* Faturamento da carga e saída parcial (2026-09-17).
   Cenário do usuário: carga faturada não coube no frete contratado
   (cubagem/peso); o excedente segue em outra viagem com a MESMA NF. */
const assert = require('node:assert/strict');
const {prepararFinalizacao} = require('./functions/conferencia_pa');
const {prepararSaida} = require('./functions/expedicao');
const {prepararAgenda} = require('./functions/agenda_expedicao');
const {prepararFaturamento, itensDaCarga} = require('./functions/faturamento_carga');
const FaturamentoEmail = require('./functions/faturamento_email');
const {analisar} = require('./public/shared/expedicao');

const clone = (x) => JSON.parse(JSON.stringify(x));
const agora = '2026-09-17T13:00:00.000Z';
function aplicar(base, updates) {
  for (const [path, value] of Object.entries(updates)) {
    const partes = path.split('/'); let n = base;
    for (const p of partes.slice(0, -1)) n = n[p] || (n[p] = {});
    n[partes.at(-1)] = clone(value);
  }
  return base;
}

// Dois paletes conferidos e liberados de um pedido com preço: P1 = 12 cx × 24 + parcial 7 (295 un), P2 = 10 cx × 24 (240 un).
function fixture() {
  const op = {status: 'Concluído', sku: 'PA001', lote: '26254/01', produto: 'Creme', cliente: 'Cliente A', produzidoLinha: 535, skuPedidoKey: 'PED-001__PA001', dataFimReal: agora};
  const conf = {qtdApontada: 535, contagens: {c1: {total: 535, contadoEm: agora, paletes: {
    p1: {numero: 1, caixasFechadas: 12, unidadesPorCaixa: 24, unidadesCaixaParcial: 7, qtdUnidades: 295, enderecoKey: 'A1'},
    p2: {numero: 2, caixasFechadas: 10, unidadesPorCaixa: 24, unidadesCaixaParcial: 0, qtdUnidades: 240, enderecoKey: 'A1'}}}}};
  const base = {usuarios: {u1: {role: 'logistica', nome: 'Logística'}}, ops: {op1: op}, conferencias_pa: {op1: conf},
    enderecos_estoque: {A1: {codigo: 'PA-A1', ativo: true}}, estoque_lotes: {}, produtos: {PA001: {sku: 'PA001', descricao: 'Creme', kgCaixa: 8}},
    pedidos: {'PED-001__PA001': {id: 'PED-001', parentPedidoId: 'PED-001', sku: 'PA001', cliente: 'Cliente A', produzido: 535}},
    pedidos_comerciais: {'PED-001': {numeroFormatado: 'PED-001', clienteKey: 'c1', cliente: 'Cliente A', status: 'LIBERADO_PCP', numeroPedidoCliente: '34',
      frete: {tipo: 'FOB', enderecoEntrega: 'Rua A, 100'}, itens: [{sku: 'PA001', qtd: 600, valorUnitario: 2.7, expedido: 0}]}},
    clientes: {c1: {nome: 'Cliente A'}}};
  aplicar(base, prepararFinalizacao({opKey: 'op1', op, conf, enderecos: base.enderecos_estoque, lotesItem: {}, autor: 'Conferente', agora}).updates);
  for (const k of ['pa_op1_p1', 'pa_op1_p2']) {
    const p = base.estoque_lotes.PA001[k];
    p.status = 'LIBERADO_EXPEDICAO'; p.qualidade = {decisao: 'LIBERADO_EXPEDICAO', inspecionadoPor: 'CQ', em: agora};
  }
  return base;
}
const ref = (b, k) => ({itemKey: 'PA001', loteKey: k, quantidade: b.estoque_lotes.PA001[k].saldoLote, enderecoKey: 'A1', skuPedidoKey: 'PED-001__PA001'});

const b = fixture();
// ── 1. Agenda ─────────────────────────────────────────────────────────
const agenda = prepararAgenda(b, {agendaKey: 'ag1', revisao: 0, dataAgendada: '2026-09-18', tipo: 'COLETA', transportadora: 'Transp X',
  paletes: [ref(b, 'pa_op1_p1'), ref(b, 'pa_op1_p2')]}, 'Logística', 'u1', agora);
b.agendamentos_expedicao = {ag1: agenda};

// ── 2. Solicitar faturamento ──────────────────────────────────────────
const itens = itensDaCarga(b, agenda, '2026-09-17');
assert.equal(itens[0].lote, '26254/01');
assert.equal(itens[0].numeroPedidoCliente, '34');
assert.equal(itens[0].precoUnitario, 2.7);
assert.equal(itens[0].valor, 796.5);
assert.equal(itens[0].pesoKg, 104, '13 volumes × 8 kg (parcial conta como caixa, regra da planilha)');
assert.throws(() => prepararFaturamento(b, {agendaKey: 'ag1', revisao: 0, acao: 'SOLICITAR', solicitacaoId: 's1'}, 'L', 'u1', agora), /mudou/);
const sol = prepararFaturamento(b, {agendaKey: 'ag1', revisao: 1, acao: 'SOLICITAR', solicitacaoId: 's1', observacoes: 'Coleta 8h'}, 'Logística', 'u1', agora);
assert.equal(sol.agenda.faturamento.status, 'SOLICITADO');
assert.equal(sol.solicitacao.totalUnidades, 535);
assert.equal(sol.solicitacao.totalValor, 1444.5);
assert.equal(sol.solicitacao.itensSemPreco, 0);
assert.equal(b.agendamentos_expedicao.ag1.faturamento, undefined, 'planejar não muta');
b.agendamentos_expedicao.ag1 = sol.agenda;
assert.equal(prepararFaturamento(b, {agendaKey: 'ag1', revisao: 2, acao: 'SOLICITAR', solicitacaoId: 's1'}, 'L', 'u1', agora).repetida, true, 'retry idempotente');
// Palete bloqueado pela Qualidade não pode ser faturado.
{
  const x = clone(b); delete x.agendamentos_expedicao.ag1.faturamento; x.estoque_lotes.PA001.pa_op1_p2.status = 'RETIDO';
  assert.throws(() => prepararFaturamento(x, {agendaKey: 'ag1', revisao: 2, acao: 'SOLICITAR', solicitacaoId: 's9'}, 'L', 'u1', agora), /não pode sair.*Qualidade/);
}

// ── 3. E-mail + PDF ───────────────────────────────────────────────────
assert.deepEqual(FaturamentoEmail.destinatarios({emailFinanceiro: 'fin@k.com.br', emailDiretoria: ['dir@k.com.br', 'fin@k.com.br']}), {para: ['fin@k.com.br'], copia: ['dir@k.com.br']});
assert.deepEqual(FaturamentoEmail.destinatarios({emailDiretoria: 'dir@k.com.br'}).para, [], 'sem Financeiro não envia');
{
  const e = FaturamentoEmail.montarEmail(sol.solicitacao, 'ag1');
  assert.match(e.assunto, /Solicitação de faturamento: Cliente A — coleta 18\/09\/2026 — 535 un/);
  assert.match(e.corpo, /26254\/01/);
  assert.match(e.corpo, /cliente 34/);
  assert.match(e.corpo, /12 cx x 24 \+ 1 parcial c\/ 7/);
}

// ── 4. Registrar NF ───────────────────────────────────────────────────
assert.throws(() => prepararFaturamento(b, {agendaKey: 'ag1', revisao: 2, acao: 'REGISTRAR_NF', nf: {}}, 'L', 'u1', agora), /número da NF/);
assert.throws(() => prepararFaturamento(b, {agendaKey: 'ag1', revisao: 2, acao: 'REGISTRAR_NF', nf: {numero: '100', chaveNfe: '123'}}, 'L', 'u1', agora), /44 dígitos/);
const fat = prepararFaturamento(b, {agendaKey: 'ag1', revisao: 2, acao: 'REGISTRAR_NF', nf: {numero: '1500', serie: '1', valor: 1444.5, emitidaEm: '2026-09-17'}}, 'Financeiro', 'u1', agora);
assert.equal(fat.agenda.faturamento.status, 'FATURADO');
b.agendamentos_expedicao.ag1 = fat.agenda;
assert.throws(() => prepararFaturamento(b, {agendaKey: 'ag1', revisao: 3, acao: 'REGISTRAR_NF', nf: {numero: '1500', serie: '1'}}, 'L', 'u1', agora), /já registrada/);
assert.throws(() => prepararFaturamento(b, {agendaKey: 'ag1', revisao: 3, acao: 'SOLICITAR', solicitacaoId: 's2'}, 'L', 'u1', agora), /já faturada/);
// Cancelar agenda faturada é bloqueado.
assert.throws(() => prepararAgenda(b, {agendaKey: 'ag1', revisao: 3, cancelar: true, motivo: 'desistência'}, 'L', 'u1', agora), /faturada/);
// Editar o transporte preserva o faturamento.
{
  const ed = prepararAgenda(b, {agendaKey: 'ag1', revisao: 3, dataAgendada: '2026-09-18', tipo: 'COLETA', placa: 'abc1234'}, 'L', 'u1', agora);
  assert.equal(ed.faturamento.nfs.nf_1500_1.numero, '1500');
  assert.equal(ed.placa, 'ABC1234');
  b.agendamentos_expedicao.ag1 = ed;
}

// ── 5. 1ª viagem: P1 parcial (8 cx, sem a parcial), P2 não carregado ───
const rev = () => b.agendamentos_expedicao.ag1.revisao;
const viagem1 = {idempotencyKey: 'viagem-parcial-0001', data: '2026-09-17', tipo: 'COLETA', agendaKey: 'ag1', agendaRevisao: rev(),
  paletes: [{...ref(b, 'pa_op1_p1'), carregar: {modo: 'PARCIAL', caixas: 8, caixaParcial: false}}, {...ref(b, 'pa_op1_p2'), carregar: {modo: 'NAO_CARREGADO'}}]};
// Guardas.
assert.throws(() => prepararSaida(b, {...viagem1, paletes: viagem1.paletes.map((p) => ({...p, carregar: {modo: 'NAO_CARREGADO'}}))}, 'L', 'u1', agora), /Nenhuma unidade/);
assert.throws(() => prepararSaida(b, {...viagem1, paletes: [viagem1.paletes[0]]}, 'L', 'u1', agora), /todos os paletes pendentes/);
assert.throws(() => prepararSaida(b, {...viagem1, paletes: [{...viagem1.paletes[0], carregar: {modo: 'PARCIAL', caixas: 13}}, viagem1.paletes[1]]}, 'L', 'u1', agora), /entre 0 e 12/);
assert.throws(() => prepararSaida(b, {...viagem1, paletes: [viagem1.paletes[0], {...viagem1.paletes[1], carregar: {modo: 'PARCIAL', caixas: 1, caixaParcial: true}}]}, 'L', 'u1', agora), /não tem caixa parcial/);
{
  const semAgenda = clone(b); delete semAgenda.agendamentos_expedicao;
  assert.throws(() => prepararSaida(semAgenda, {...viagem1, agendaKey: undefined, agendaRevisao: undefined}, 'L', 'u1', agora), /só em carga agendada/);
}
const s1 = prepararSaida(b, viagem1, 'Logística', 'u1', agora);
assert.equal(s1.carga.totalUnidades, 192);
assert.equal(s1.carga.nf, '1500', 'NF vem da agenda');
assert.equal(s1.carga.statusFiscal, 'NF_DA_AGENDA');
assert.equal(s1.carga.valorFaturado, 1444.5, '1ª viagem carrega o valor da NF');
assert.equal(s1.carga.viagem, 1);
assert.equal(s1.carga.itens.length, 1);
assert.equal(s1.carga.itens[0].parcial, true);
assert.equal(s1.carga.itens[0].saldoRestante, 103);
assert.deepEqual(s1.carga.naoCarregados.map((x) => [x.loteKey, x.ficou]), [['pa_op1_p1', 103], ['pa_op1_p2', 240]]);
assert.equal(s1.updates['estoque_lotes/PA001/pa_op1_p1/saldoLote'], 103);
assert.equal(s1.updates['estoque_lotes/PA001/pa_op1_p1/caixasFechadas'], 4);
assert.equal(s1.updates['estoque_lotes/PA001/pa_op1_p1/status'], undefined, 'palete parcial continua liberado');
assert.equal(s1.updates['estoque_lotes/PA001/pa_op1_p1/expedicaoId'], undefined);
assert.equal(s1.updates['estoque_lotes/PA001/pa_op1_p2/saldoLote'], undefined, 'não carregado não mexe no estoque');
assert.equal(s1.updates['pedidos/PED-001__PA001/expedido'], 192, 'pedido conta só o que saiu');
assert.equal(s1.updates['pedidos_comerciais/PED-001/itens/0/expedido'], 192);
assert.equal(Object.values(s1.updates).find((x) => x && x.tipo === 'expedicao_pa').motivo, 'SAÍDA PARCIAL DE PA (CAIXAS)');
assert.equal(s1.updates['agendamentos_expedicao/ag1/status'], 'EXPEDIDO_PARCIAL');
assert.equal(s1.updates['agendamentos_expedicao/ag1/paletes/0/embarcado'], 192);
assert.equal(s1.updates['agendamentos_expedicao/ag1/viagens/v1'].aguardandoEmbarque, 343);
aplicar(b, s1.updates);
assert.equal(analisar(b, 'PA001', 'pa_op1_p1', '2026-09-17').disponivel, true, 'saldo que ficou segue expedível');
assert.equal(prepararSaida(b, viagem1, 'Logística', 'u1', agora).repetida, true, 'retry da mesma viagem não baixa de novo');

// Saldo reservado: não entra em outra agenda nem sai sem a agenda.
assert.throws(() => prepararAgenda(b, {agendaKey: 'ag2', revisao: 0, dataAgendada: '2026-09-19', tipo: 'COLETA', paletes: [ref(b, 'pa_op1_p2')]}, 'L', 'u1', agora), /outra carga/);
assert.throws(() => prepararSaida(b, {idempotencyKey: 'avulsa-0000000001', data: '2026-09-17', tipo: 'COLETA', paletes: [ref(b, 'pa_op1_p2')]}, 'L', 'u1', agora), /Abra o agendamento/);
// Cancelar com parte já expedida é bloqueado.
assert.throws(() => prepararAgenda(b, {agendaKey: 'ag1', revisao: rev(), cancelar: true, motivo: 'cancelar resto'}, 'L', 'u1', agora), /Parte desta carga já saiu/);

// ── 6. 2ª viagem: resto inteiro, mesma NF ─────────────────────────────
const viagem2 = {idempotencyKey: 'viagem-parcial-0002', data: '2026-09-17', tipo: 'COLETA', agendaKey: 'ag1', agendaRevisao: rev(),
  paletes: [ref(b, 'pa_op1_p1'), ref(b, 'pa_op1_p2')]};
assert.equal(viagem2.paletes[0].quantidade, 103);
const s2 = prepararSaida(b, viagem2, 'Logística', 'u1', agora);
assert.equal(s2.carga.totalUnidades, 343);
assert.equal(s2.carga.nf, '1500');
assert.equal(s2.carga.viagem, 2);
assert.equal(s2.carga.complementar, true);
assert.equal(s2.carga.valorFaturado, 0, 'valor da NF não soma de novo');
assert.equal(s2.updates['estoque_lotes/PA001/pa_op1_p1/saldoLote'], 0);
assert.equal(s2.updates['estoque_lotes/PA001/pa_op1_p1/status'], 'EXPEDIDO');
assert.equal(s2.updates['pedidos/PED-001__PA001/expedido'], 535);
assert.equal(s2.updates['agendamentos_expedicao/ag1/status'], 'EXPEDIDO');
assert.equal(s2.updates['agendamentos_expedicao/ag1/paletes/0/embarcado'], 295);
assert.equal(s2.updates['agendamentos_expedicao/ag1/paletes/1/embarcado'], 240);
aplicar(b, s2.updates);
assert.throws(() => prepararFaturamento(b, {agendaKey: 'ag1', revisao: rev(), acao: 'REGISTRAR_NF', nf: {numero: '9'}}, 'L', 'u1', agora), /encerrada/);

// ── 7. Parcial com a caixa parcial ────────────────────────────────────
{
  const x = fixture();
  const ag = prepararAgenda(x, {agendaKey: 'ag3', revisao: 0, dataAgendada: '2026-09-18', tipo: 'COLETA', paletes: [ref(x, 'pa_op1_p1')]}, 'L', 'u1', agora);
  x.agendamentos_expedicao = {ag3: ag};
  const s = prepararSaida(x, {idempotencyKey: 'viagem-parcial-0003', data: '2026-09-17', tipo: 'COLETA', agendaKey: 'ag3', agendaRevisao: 1,
    paletes: [{...ref(x, 'pa_op1_p1'), carregar: {modo: 'PARCIAL', caixas: 2, caixaParcial: true}}]}, 'L', 'u1', agora);
  assert.equal(s.carga.totalUnidades, 55);
  assert.equal(s.carga.statusFiscal, 'PENDENTE', 'sem NF registrada a carga sai como pendente fiscal');
  assert.equal(s.updates['estoque_lotes/PA001/pa_op1_p1/unidadesCaixaParcial'], 0);
  assert.equal(s.updates['estoque_lotes/PA001/pa_op1_p1/caixasFechadas'], 10);
  assert.equal(s.updates['estoque_lotes/PA001/pa_op1_p1/saldoLote'], 240);
  aplicar(x, s.updates);
  const c = require('./public/shared/expedicao-grade.js').composicao(x.estoque_lotes.PA001.pa_op1_p1);
  assert.equal(c.valida, true, 'composição restante continua coerente');
  assert.equal(c.texto, '10 cx × 24');
}

// ── 8. PDF ────────────────────────────────────────────────────────────
FaturamentoEmail.gerarPdf(sol.solicitacao, 'ag1').then((pdf) => {
  assert.equal(pdf.slice(0, 5).toString(), '%PDF-');
  console.log('OK carga parcial: faturamento solicitado/registrado, e-mail e PDF, parcial por caixas, não carregado, saldo reservado à NF, 2ª viagem com a mesma NF, travas e idempotência.');
}).catch((e) => { console.error(e); process.exit(1); });
