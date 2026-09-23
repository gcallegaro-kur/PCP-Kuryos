'use strict';
/* Cancelamento de Pedido de Compra (2026-09-15).
   Pedido do usuário: só admin cancela PC, e dá para ver os cancelados.
   Cobre as regras puras (shared/cancelamento-pc.js), o servidor não reabrir PC
   cancelado em estorno/devolução (functions/recebimento.js), a regra do banco
   e a LIGAÇÃO na tela -- lição do repo: a unidade passar não prova que o botão
   chama a função. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const C = require(path.join(__dirname, 'public', 'shared', 'cancelamento-pc.js'));
const {statusPedidoApos} = require(path.join(__dirname, 'functions', 'recebimento.js'));

const pc = (status, itens, extra) => Object.assign({
  numeroFormatado: 'PC-0003', status, fornecedorNome: 'FLASH',
  itens: itens || {i1: {materialCodigo: 'ET-00064', materialNome: 'ETIQUETA', unidade: 'rolo', qtd: 48, qtdRecebida: 0}},
  solicitacoesOrigem: {sc6: {numeroFormatado: 'SC-0006'}},
}, extra || {});

// ── Quem pode cancelar o quê ─────────────────────────────────────────────
['ABERTO', 'ENVIADO', 'RECEBIDO_PARCIAL'].forEach((s) => {
  assert.equal(C.avaliarCancelamento(pc(s), 'admin').pode, true, 'admin cancela ' + s);
});
['pcp', 'logistica', 'compras', undefined, null, ''].forEach((papel) => {
  const r = C.avaliarCancelamento(pc('ENVIADO'), papel);
  assert.equal(r.pode, false, 'papel ' + papel + ' não cancela');
  assert.match(r.motivo, /Apenas administradores/);
});
assert.match(C.avaliarCancelamento(pc('RECEBIDO_TOTAL'), 'admin').motivo, /recebido por inteiro/);
assert.match(C.avaliarCancelamento(pc('CANCELADO'), 'admin').motivo, /já está cancelado/);
assert.match(C.avaliarCancelamento(null, 'admin').motivo, /não encontrado/);
assert.equal(C.avaliarCancelamento(pc('ESQUISITO'), 'admin').pode, false, 'status desconhecido não cancela');

// ── Aplicar: motivo, trilha e saldo ───────────────────────────────────────
const agora = '2026-09-15T14:00:00.000Z';
assert.match(C.aplicarCancelamento(pc('ENVIADO'), {papel: 'admin', motivo: 'curto'}).erro, /mínimo 10/);
assert.match(C.aplicarCancelamento(pc('ENVIADO'), {papel: 'admin', motivo: '          '}).erro, /mínimo 10/, 'espaço não é motivo');
assert.match(C.aplicarCancelamento(pc('ENVIADO'), {papel: 'pcp', motivo: 'motivo suficiente'}).erro, /Apenas administradores/);

const original = pc('ENVIADO', null, {agendamento: {data: '2026-09-20'}});
const antes = JSON.stringify(original);
const ok = C.aplicarCancelamento(original, {papel: 'admin', motivo: '  Fornecedor sem prazo  ', autor: 'Gustavo', agora, reabrirSolicitacoes: true});
assert.equal(JSON.stringify(original), antes, 'não muta o PC recebido da transaction');
assert.equal(ok.pc.status, 'CANCELADO');
assert.equal(ok.pc.cancelamento.motivo, 'Fornecedor sem prazo');
assert.equal(ok.pc.cancelamento.canceladoPor, 'Gustavo');
assert.equal(ok.pc.cancelamento.canceladoEm, agora);
assert.equal(ok.pc.cancelamento.statusAnterior, 'ENVIADO');
assert.equal(ok.pc.cancelamento.tinhaAgendamento, true);
assert.equal(ok.pc.cancelamento.tinhaRecebimento, false);
assert.equal(ok.pc.cancelamento.saldoPorItem.i1.saldoCancelado, 48);
assert.deepEqual(ok.pc.cancelamento.solicitacoesReabertas, ['sc6']);
assert.deepEqual(ok.pc.itens, original.itens, 'itens e quantidades ficam intactos (histórico)');
assert.deepEqual(ok.pc.agendamento, original.agendamento, 'agendamento fica como histórico');
assert.equal(C.aplicarCancelamento(pc('ENVIADO'), {papel: 'admin', motivo: 'x'.repeat(900)}).pc.cancelamento.motivo.length, 500);

// Parcial: cancela só o saldo; nunca reabre SC.
const parcial = pc('RECEBIDO_PARCIAL', {
  a: {materialCodigo: 'EP-1', qtd: 1000, qtdRecebida: 400},
  b: {materialCodigo: 'EP-2', qtd: 50, qtdRecebida: 60}, // recebeu a mais
});
const rp = C.aplicarCancelamento(parcial, {papel: 'admin', motivo: 'Saldo não será entregue', agora, reabrirSolicitacoes: true});
assert.equal(rp.pc.cancelamento.saldoPorItem.a.saldoCancelado, 600);
assert.equal(rp.pc.cancelamento.saldoPorItem.b.saldoCancelado, 0, 'recebido acima do pedido não vira saldo negativo');
assert.equal(rp.pc.cancelamento.tinhaRecebimento, true);
assert.equal(rp.pc.cancelamento.solicitacoesReabertas, null, 'com recebimento a SC não reabre');
assert.equal(rp.pc.itens.a.qtdRecebida, 400, 'recebido continua recebido');

// ── Solicitações para reabrir ────────────────────────────────────────────
assert.deepEqual(C.solicitacoesParaReabrir(pc('ENVIADO'), {sc6: {status: 'CONSOLIDADA'}}), ['sc6']);
assert.deepEqual(C.solicitacoesParaReabrir(pc('ENVIADO'), {sc6: {status: 'APROVADA'}}), [], 'só CONSOLIDADA');
assert.deepEqual(C.solicitacoesParaReabrir(pc('ENVIADO'), {}), [], 'SC apagada não reabre');
assert.deepEqual(C.solicitacoesParaReabrir(parcial, {sc6: {status: 'CONSOLIDADA'}}), []);

// ── Filtro e relatórios ──────────────────────────────────────────────────
const lista = [pc('ENVIADO'), pc('CANCELADO'), pc('RECEBIDO_TOTAL')];
assert.equal(lista.filter(p => C.passaFiltroStatus(p, 'ativos')).length, 2, 'padrão esconde cancelados');
assert.equal(lista.filter(p => C.passaFiltroStatus(p, undefined)).length, 2, 'sem filtro = padrão');
assert.equal(lista.filter(p => C.passaFiltroStatus(p, 'cancelados')).length, 1);
assert.equal(lista.filter(p => C.passaFiltroStatus(p, 'todos')).length, 3);
assert.equal(C.contaComoCompra(pc('CANCELADO')), false);
assert.equal(C.contaComoCompra(pc('RECEBIDO_PARCIAL')), true);

// ── Servidor: estorno/devolução não reabre PC cancelado ───────────────────
const itensSrv = {a: {qtd: 100, qtdRecebida: 40}};
assert.equal(statusPedidoApos(itensSrv, {a: -40}).status, 'ENVIADO', 'sem cancelamento, estorno volta a ENVIADO');
assert.equal(statusPedidoApos(itensSrv, {a: -40}, 'CANCELADO').status, 'CANCELADO');
assert.equal(statusPedidoApos(itensSrv, {a: -40}, 'CANCELADO').novosTotais.a, 0, 'quantidades continuam sendo recalculadas');
assert.equal(statusPedidoApos(itensSrv, {a: 60}, 'ENVIADO').status, 'RECEBIDO_TOTAL');
const index = fs.readFileSync(path.join(__dirname, 'functions', 'index.js'), 'utf8');
const chamadas = index.match(/statusPedidoApos\([^)]*\)/g) || [];
assert.equal(chamadas.length, 3);
chamadas.forEach(ch => assert.match(ch, /pedido\.status\)$/, 'toda chamada passa o status atual: ' + ch));
assert.match(index, /\["CANCELADO"\]\.includes\(pedido\.status\)/, 'recebimento continua recusando PC cancelado');

// ── Regra do banco ───────────────────────────────────────────────────────
const rules = require('./ler_regras').lerRegras().rules;
const validar = rules.pedidos_compra.$pedidoKey.status['.validate'];
assert.match(validar, /'CANCELADO'/);
assert.match(validar, /role'\)\.val\(\) == 'admin'/);
// Avalia a expressão como o RTDB faria, para os casos que importam.
function avalia(antes, depois, papel) {
  const data = {val: () => antes}, newData = {val: () => depois};
  const root = {child: () => root, val: () => papel};
  const auth = {uid: 'u'};
  return Function('data', 'newData', 'root', 'auth', 'return ' + validar.replace(/==/g, '===').replace(/!=/g, '!=='))(data, newData, root, auth);
}
assert.equal(avalia('ENVIADO', 'CANCELADO', 'pcp'), false, 'pcp não cancela nem pelo console');
assert.equal(avalia('ENVIADO', 'CANCELADO', 'logistica'), false);
assert.equal(avalia('ENVIADO', 'CANCELADO', 'admin'), true);
assert.equal(avalia('CANCELADO', 'ENVIADO', 'pcp'), false, 'não-admin não reabre');
assert.equal(avalia('CANCELADO', 'CANCELADO', 'logistica'), true, 'regravar o nó inteiro sem mudar o status passa');
assert.equal(avalia('ENVIADO', 'RECEBIDO_PARCIAL', 'logistica'), true, 'fluxo normal da Logística intacto');
assert.equal(avalia(null, 'ABERTO', 'pcp'), true, 'criar PC continua igual');
assert.equal(avalia(null, 'CANCELADO', 'pcp'), false, 'nem criar já cancelado');

// ── Ligação na tela ──────────────────────────────────────────────────────
const html = fs.readFileSync(path.join(__dirname, 'public', 'compras.html'), 'utf8');
assert.ok(html.indexOf('src="shared/cancelamento-pc.js"') > 0 &&
  html.indexOf('src="shared/cancelamento-pc.js"') < html.indexOf('<script>'), 'módulo carregado antes do script da página');
assert.match(html, /id="pcFilterStatus"[\s\S]*?value="ativos"[\s\S]*?value="cancelados"[\s\S]*?value="todos"/);
assert.match(html, /getElementById\('pcFilterStatus'\)\.addEventListener\('change', renderPedidos\)/);
assert.match(html, /CancelamentoPC\.passaFiltroStatus\(entry\[1\], filtStatus\)/);
assert.match(html, /querySelectorAll\('\.pc-cancelar'\)[\s\S]{0,160}abrirModalCancelarPC/);
assert.match(html, /getElementById\('pcCancConfirmar'\)\.addEventListener\('click', confirmarCancelamentoPC\)/);
assert.match(html, /CancelamentoPC\.aplicarCancelamento\(atual, dados\)/);
assert.equal((html.match(/CancelamentoPC\.contaComoCompra\(pc\)/g) || []).length, 3, 'preço, histórico e análise de fornecedor ignoram cancelado');
assert.match(html, /PEDIDO CANCELADO — NÃO ATENDER/);
// O botão só nasce com o papel: renderPedidos consulta avaliarCancelamento com o role.
assert.match(html, /CancelamentoPC\.avaliarCancelamento\(p, window\.currentUser && window\.currentUser\.role\)\.pode/);
// Logística e MRP seguem enxergando só ENVIADO/RECEBIDO_PARCIAL (cancelado some sozinho).
const logistica = fs.readFileSync(path.join(__dirname, 'public', 'logistica.html'), 'utf8');
assert.match(logistica, /status === 'ENVIADO' \|\| e\[1\]\.status === 'RECEBIDO_PARCIAL'/);

console.log('run_cancelamento_pc_test: OK');
