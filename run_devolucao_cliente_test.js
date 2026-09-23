// GAP-02: devolução de cliente. node run_devolucao_cliente_test.js
const assert = require('assert');
const fs = require('fs');
const D = require('./public/shared/devolucao-cliente.js');
const ExpedicaoPA = require('./public/shared/expedicao.js');
const Conciliacao = require('./public/shared/conciliacao-pedidos.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const lanca = (fn, re, m) => { assert.throws(fn, re, m); n++; };

// 0. O servidor usa a MESMA regra.
eq(fs.readFileSync('functions/devolucao_cliente.js', 'utf8'), fs.readFileSync('public/shared/devolucao-cliente.js', 'utf8'), 'cópia do servidor idêntica');
eq(fs.readFileSync('functions/expedicao_regras.js', 'utf8'), fs.readFileSync('public/shared/expedicao.js', 'utf8'), 'regras da Expedição idênticas');

const base = () => ({
  pedidos_comerciais: {'PED-0002': {numeroFormatado: 'PED-0002', cliente: 'MISS RÔSE', clienteKey: 'MISS', numeroPedidoCliente: '28', status: 'LIBERADO_PCP',
    itens: [{sku: 'MRARBS04', qtd: 1000, expedido: 1000}, {sku: 'MRARBS03', qtd: 500, expedido: 500}]}},
  pedidos: {
    'PED-0002__MRARBS04': {id: 'PED-0002', parentPedidoId: 'PED-0002', sku: 'MRARBS04', cliente: 'MISS RÔSE', qtdTotal: 1000, produzido: 1000, expedido: 1000},
    'PED-0002__MRARBS03': {id: 'PED-0002', parentPedidoId: 'PED-0002', sku: 'MRARBS03', cliente: 'MISS RÔSE', qtdTotal: 500, produzido: 500, expedido: 500}
  },
  ops: {'26257-17': {lote: '26257/17', sku: 'MRARBS04', status: 'Concluído', skuPedidoKey: 'PED-0002__MRARBS04', produzido: 1000, produzidoLinha: 1000},
        '26258-01': {lote: '26258/01', sku: 'MRARBS03', status: 'Concluído', skuPedidoKey: 'PED-0002__MRARBS03', produzido: 500, produzidoLinha: 500}},
  expedicoes_comerciais: {exp_A: {numero: 'EXP-A', pedidoId: 'PED-0002', pedidos: {'PED-0002': {}}, data: '2026-09-20', nf: '4512', serie: '1', status: 'EXPEDIDO',
    itens: [
      {pedidoId: 'PED-0002', sku: 'MRARBS04', descricao: 'NÉCTAR', opKey: '26257-17', opLote: '26257/17', skuPedidoKey: 'PED-0002__MRARBS04', itemKey: 'MRARBS04', identificadorPalete: 'PA-26257-17-P1', validade: '2029-09-01', qtd: 1000},
      {pedidoId: 'PED-0002', sku: 'MRARBS03', descricao: 'ECLIPSE', opKey: '26258-01', opLote: '26258/01', skuPedidoKey: 'PED-0002__MRARBS03', itemKey: 'MRARBS03', qtd: 500}]},
    legado: {legado: true, pedidoId: 'PED-0002', itens: [{qtd: 10, sku: 'MRARBS04'}]}},
  enderecos_estoque: {DOC_1: {codigo: 'DOC-1.1.1', area: 'DOCA', ativo: true}, VELHO: {codigo: 'GAL-9', ativo: false}},
  estoque_lotes: {}, devolucoes_cliente: {}, conferencias_pa: {}, solicitacoes_descarte: {}
});

// 1. Saídas do pedido: só fluxo novo, com o que ainda pode voltar.
let b = base();
let s = D.saidasDoPedido(b, 'PED-0002');
eq(s.map(x => x.cargaKey), ['exp_A'], 'legado fica de fora');
eq(s[0].itens.map(i => [i.sku, i.devolvivel]), [['MRARBS04', 1000], ['MRARBS03', 500]], 'tudo devolvível no início');

// 2. Validação da autorização.
const form = {pedidoId: 'PED-0002', cargaKey: 'exp_A', itens: [{idx: '0', qtd: '120'}, {idx: '1', qtd: ''}],
  motivoTipo: 'AVARIA_TRANSPORTE', motivo: 'Caixas amassadas na entrega, cliente recusou 120 un.'};
ok(D.validarAutorizacao(form, b).ok, 'autorização válida');
ok(!D.validarAutorizacao(Object.assign({}, form, {itens: [{idx: '0', qtd: '1001'}]}), b).ok, 'mais do que saiu não autoriza');
ok(!D.validarAutorizacao(Object.assign({}, form, {itens: [{idx: '0', qtd: '2.5'}]}), b).ok, 'fracionado não autoriza');
ok(!D.validarAutorizacao(Object.assign({}, form, {itens: []}), b).ok, 'sem item não autoriza');
ok(!D.validarAutorizacao(Object.assign({}, form, {motivo: 'curto'}), b).ok, 'motivo curto não autoriza');
ok(!D.validarAutorizacao(Object.assign({}, form, {motivoTipo: 'X'}), b).ok, 'tipo de motivo inválido');

const dev = D.montarAutorizacao(form, b, {numero: 'DEV-2026-001', autor: 'Ana', agora: '2026-09-23T12:00:00Z'});
eq([dev.status, dev.totalAutorizado, dev.nfOriginal, dev.numeroPedidoCliente], ['AUTORIZADA', 120, '4512/1', '28'], 'autorização montada');
eq(dev.itens.length, 1, 'só o item com quantidade');
b.devolucoes_cliente['DEV-2026-001'] = dev;
eq(D.saidasDoPedido(b, 'PED-0002')[0].itens[0].devolvivel, 880, 'autorizada já reserva a quantidade');

// 3. Recebimento: palete em quarentena + estorno do expedido, num mapa só.
const ctx = extra => Object.assign({devKey: 'DEV-2026-001', dev: b.devolucoes_cliente['DEV-2026-001'], pedidos: b.pedidos,
  pedidoComercial: b.pedidos_comerciais['PED-0002'], enderecos: b.enderecos_estoque, autor: 'João', agora: '2026-09-24T09:00:00Z',
  dados: {itens: [{i: 0, qtdRecebida: 110, enderecoKey: 'DOC_1'}], observacao: '10 un. não vieram'}}, extra || {});
let r = D.prepararRecebimento(ctx());
const u = r.updates;
eq(r.total, 110, 'total recebido');
const pal = u['estoque_lotes/MRARBS04/dev_DEV-2026-001_i0'];
eq([pal.status, pal.origemTipo, pal.saldoLote, pal.itemTipo, pal.opKey, pal.skuPedidoKey, pal.enderecoCodigo, pal.validade],
  ['QUARENTENA', 'devolucao_cliente', 110, 'produto', '26257-17', 'PED-0002__MRARBS04', 'DOC-1.1.1', '2029-09-01'], 'palete devolvido');
eq(pal.identificadorPalete, 'DEV-2026-001-I1', 'identificador próprio');
eq(pal.devolucao.recebidaEm, '2026-09-24T09:00:00Z', 'marca de recebimento (a Expedição exige)');
eq(u['pedidos/PED-0002__MRARBS04/expedido'], 890, 'estorno do expedido no backlog');
eq(u['pedidos/PED-0002__MRARBS04/devolvido'], 110, 'devolvido informado');
eq(u['pedidos_comerciais/PED-0002/itens/0/expedido'], 890, 'estorno no pedido comercial');
eq(u['movimentos_estoque/MRARBS04/dev_DEV-2026-001_i0'].qtd, 110, 'movimento de entrada');
eq([u['devolucoes_cliente/DEV-2026-001/status'], u['devolucoes_cliente/DEV-2026-001/recebimento'].divergente], ['RECEBIDA', true], 'recebida, com divergência');
ok(u['expedicoes_comerciais/exp_A/devolucoes/DEV-2026-001'], 'a carga sabe da devolução');
ok(!Object.keys(u).some(k => k.startsWith('pedidos/PED-0002__MRARBS03')), 'item que não voltou não é tocado');

// 4. Recusas.
lanca(() => D.prepararRecebimento(ctx({dados: {itens: [{i: 0, qtdRecebida: 121, enderecoKey: 'DOC_1'}]}})), /mais .* do que o autorizado/, 'acima do autorizado');
lanca(() => D.prepararRecebimento(ctx({dados: {itens: [{i: 0, qtdRecebida: 10, enderecoKey: 'VELHO'}]}})), /endereço ativo/, 'endereço inativo');
lanca(() => D.prepararRecebimento(ctx({dados: {itens: [{i: 0, qtdRecebida: 0}]}})), /Informe o que chegou/, 'nada chegou');
lanca(() => D.prepararRecebimento(ctx({dev: Object.assign({}, dev, {status: 'RECEBIDA'})})), /não está aguardando/, 'recebida de novo');
lanca(() => D.prepararRecebimento(ctx({dev: Object.assign({}, dev, {status: 'CANCELADA'})})), /não está aguardando/, 'cancelada');

// 5. Aplica e acompanha o andamento pelo palete.
function aplicar(db, ups) {
  Object.entries(ups).forEach(([p, v]) => {
    const ks = p.split('/'); let o = db;
    ks.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
    if (v === null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
  });
}
aplicar(b, u);
const d1 = b.devolucoes_cliente['DEV-2026-001'];
let sit = D.situacao(d1, b.estoque_lotes);
eq(sit.itens[0].etapa, 'AGUARDANDO_QUALIDADE', 'em quarentena');
ok(!sit.concluida, 'não concluída');
eq(D.saidasDoPedido(b, 'PED-0002')[0].itens[0].devolvivel, 890, 'recebida conta pelo que chegou (110)');

// 6. Conciliação: produzido = (expedido − devolvido) + estoque.
let c = Conciliacao.calcular(b).porPedido['PED-0002__MRARBS04'];
eq([c.expedido.total, c.estoque.total, c.contabilizado, c.situacao], [890, 110, 1000, 'OK'], 'conta fecha com a devolução');
eq(c.expedido.motivos.DEVOLVIDO, -110, 'devolvido entra como estorno');
eq(c.devolvido.total, 110, 'devolvido informado à parte');

// 7. Expedição: quarentena bloqueia; laudo liberado torna expedível (reenvio).
const lote = b.estoque_lotes.MRARBS04['dev_DEV-2026-001_i0'];
let a = ExpedicaoPA.analisar(b, 'MRARBS04', 'dev_DEV-2026-001_i0', '2026-09-24');
eq(a.motivo, 'Aguardando liberação da Qualidade', 'quarentena não sai');
lote.status = 'LIBERADO_EXPEDICAO'; lote.qualidade = {decisao: 'LIBERADO_EXPEDICAO'};
a = ExpedicaoPA.analisar(b, 'MRARBS04', 'dev_DEV-2026-001_i0', '2026-09-24');
ok(a.disponivel && a.devolvido, 'liberado pela Qualidade: expedível, sem Conferência de PA — ' + a.motivo);
eq(D.situacao(d1, b.estoque_lotes).itens[0].etapa, 'REINTEGRADO', 'reintegrado');
ok(D.situacao(d1, b.estoque_lotes).concluida, 'concluída ao reintegrar');
const semMarca = JSON.parse(JSON.stringify(b)); delete semMarca.estoque_lotes.MRARBS04['dev_DEV-2026-001_i0'].devolucao.recebidaEm;
eq(ExpedicaoPA.analisar(semMarca, 'MRARBS04', 'dev_DEV-2026-001_i0', '2026-09-24').motivo, 'Sem palete de PA conferido', 'sem recebimento, não é palete válido');

// 8. Outros destinos.
lote.status = 'RETIDO'; eq(D.situacao(d1, b.estoque_lotes).itens[0].etapa, 'RETRABALHO', 'retido = retrabalho');
lote.status = 'REPROVADO'; eq(D.situacao(d1, b.estoque_lotes).itens[0].etapa, 'DESCARTE', 'reprovado = descartar');
lote.status = 'AGUARDANDO_DESCARTE'; eq(D.situacao(d1, b.estoque_lotes).itens[0].etapa, 'DESCARTE', 'segregado continua no descarte');
lote.status = 'DESCARTADO'; lote.saldoLote = 0; eq(D.situacao(d1, b.estoque_lotes).itens[0].etapa, 'DESCARTADO', 'descartado');
lote.status = 'EXPEDIDO'; lote.expedicaoId = 'exp_B'; eq(D.situacao(d1, b.estoque_lotes).itens[0].etapa, 'REENVIADO', 'reenviado');
eq(D.situacao({status: 'AUTORIZADA', itens: [{qtdAutorizada: 5}]}, {}).itens[0].etapa, 'AGUARDANDO_RECEBIMENTO', 'autorizada');
eq(D.situacao({status: 'CANCELADA', itens: [{qtdAutorizada: 5}]}, {}).concluida, true, 'cancelada é final');

// 9. Retrabalho aparece como informação na conciliação, sem somar.
b = base();
b.ops['26257-17-RT1'] = {lote: '26257/17-RT1', tipoOrdem: 'RETRABALHO', retrabalhoDeOpKey: '26257-17', qtdPlanejada: 200, status: 'Programado'};
c = Conciliacao.calcular(b).porPedido['PED-0002__MRARBS04'];
eq([c.retrabalho.total, c.contabilizado], [200, 1000], 'retrabalho informado, fora da conta');
ok(/Em retrabalho \(informativo, não soma\): 200/.test(Conciliacao.descrever(c).detalhe || JSON.stringify(Conciliacao.descrever(c))), 'descrição cita o retrabalho');

console.log('devolução de cliente: ' + n + ' asserções OK');
