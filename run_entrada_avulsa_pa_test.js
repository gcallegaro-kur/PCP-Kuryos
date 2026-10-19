'use strict';
/* Entrada avulsa de PA (22/10/2026): item devolvido antigo, sem OP nem carga
   de origem, que passa pelo laudo e vira estoque próprio vendável. */
const assert = require('node:assert/strict');
const path = require('node:path');
const EA = require(path.join(__dirname, 'public', 'shared', 'entrada-avulsa-pa.js'));
const {analisar} = require(path.join(__dirname, 'public', 'shared', 'expedicao.js'));
const {prepararSaida} = require(path.join(__dirname, 'functions', 'expedicao.js'));
const CP = require(path.join(__dirname, 'public', 'shared', 'conciliacao-pedidos.js'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const agora = '2026-10-22T14:00:00.000Z';
const hoje = '2026-10-22';

const produtos = {PA001: {sku: 'PA001', descricao: 'BODY SPLASH ANTIGO', unCx: 24}};
const enderecos = {A1: {codigo: 'PA-A1', ativo: true}, A2: {codigo: 'PA-A2', ativo: false}};
const ctx = {produtos, enderecos, hoje};
const dados = {sku: 'pa001', qtd: '295', unidadesPorCaixa: '24', loteOrigem: 'L-2024/17', validade: '2027-03-31', enderecoKey: 'A1',
  motivoTipo: 'DEVOLUCAO_SEM_ORIGEM', motivo: 'Cliente devolveu lote antigo, sem OP no sistema.', clienteOrigem: 'CLIENTE VELHO', nfDevolucao: 'NF 9981',
  idempotencyKey: 'abcdef123456abcdef'};

// ── Validação ──────────────────────────────────────────────────────────────
{
  const v = EA.validar(dados, ctx);
  assert.deepEqual(v.erros, []);
  assert.equal(v.produto.key, 'PA001', 'SKU sem diferenciar caixa');
  assert.deepEqual(v.caixas, {fechadas: 12, parcial: 7}, '295 = 12 caixas de 24 + 7');
  const falha = (mut, re) => assert.match(EA.validar(Object.assign({}, dados, mut), ctx).erros.join(' | '), re);
  falha({sku: 'XXX'}, /produto cadastrado/);
  falha({qtd: '0'}, /quantidade/); falha({qtd: '10.5'}, /quantidade/); falha({qtd: ''}, /quantidade/);
  falha({unidadesPorCaixa: '0'}, /por caixa/);
  falha({loteOrigem: ' '}, /lote/);
  falha({validade: ''}, /validade/); falha({validade: '2027-02-30'}, /validade/); falha({validade: '2026-10-21'}, /vencida/);
  falha({enderecoKey: 'A2'}, /endereço ativo/); falha({enderecoKey: 'ZZ'}, /endereço ativo/);
  falha({motivoTipo: 'X'}, /tipo de motivo/); falha({motivo: 'curto'}, /motivo/);
  falha({clienteOrigem: ''}, /cliente que devolveu/);
  assert.deepEqual(EA.validar(Object.assign({}, dados, {motivoTipo: 'SOBRA_ESTOQUE', clienteOrigem: ''}), ctx).erros, [], 'cliente só é exigido na devolução');
  assert.deepEqual(EA.validar(Object.assign({}, dados, {unidadesPorCaixa: ''}), ctx).caixas, {fechadas: 0, parcial: 0}, 'sem caixas: entra sem composição');
}

// ── Palete ─────────────────────────────────────────────────────────────────
const m = EA.montarPalete(dados, EA.validar(dados, ctx), 'Logística', agora);
{
  const p = m.palete;
  assert.equal(m.itemKey, 'PA001'); assert.equal(m.loteKey, 'avu_abcdef123456abcdef');
  assert.equal(p.itemTipo, 'produto'); assert.equal(p.status, 'QUARENTENA'); assert.equal(p.origemTipo, 'entrada_avulsa_pa');
  assert.equal(p.saldoLote, 295); assert.equal(p.caixasFechadas, 12); assert.equal(p.unidadesCaixaParcial, 7); assert.equal(p.unidadesPorCaixa, 24);
  assert.equal(p.loteOrigem, 'L-2024/17'); assert.equal(p.validade, '2027-03-31'); assert.equal(p.dataValidade, '2027-03-31');
  assert.equal(p.opKey, undefined, 'sem OP'); assert.equal(p.skuPedidoKey, undefined, 'sem pedido até vincular');
  assert.deepEqual(p.propriedade, {tipo: 'KURYOS'});
  assert.equal(p.entradaAvulsa.clienteOrigem, 'CLIENTE VELHO'); assert.equal(p.entradaAvulsa.lancadaPor, 'Logística');
  assert.match(p.identificadorPalete, /^AV-L-2024-17-ABCDEF$/);
  assert.equal(m.movimento.tipo, 'entrada_avulsa_pa'); assert.equal(m.movimento.qtd, 295);
}

// ── Gravação idempotente ───────────────────────────────────────────────────
function bancoFalso(dadosIni) {
  const db = clone(dadosIni);
  const get = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), db);
  const set = (p, v) => { const ks = p.split('/').filter(Boolean); let o = db; ks.slice(0, -1).forEach((k) => { o[k] = o[k] || {}; o = o[k]; }); if (v == null) delete o[ks.at(-1)]; else o[ks.at(-1)] = clone(v); };
  return {db, ref: (p) => ({
    once: () => Promise.resolve({val: () => (get(p) === undefined ? null : clone(get(p)))}),
    update: (u) => { Object.keys(u).forEach((k) => set(k, u[k])); return Promise.resolve(); },
    transaction(fn) { const r = fn(get(p) === undefined ? null : clone(get(p))); if (r === undefined) return Promise.resolve({committed: false}); set(p, r); return Promise.resolve({committed: true}); }
  })};
}

(async () => {
  const b = bancoFalso({estoque_lotes: {}, movimentos_estoque: {}});
  const r1 = await EA.registrar(b, dados, ctx, 'Logística');
  assert.equal(r1.ok, true); assert.equal(r1.repetida, false);
  assert.equal(b.db.estoque_lotes.PA001.avu_abcdef123456abcdef.status, 'QUARENTENA');
  assert.equal(b.db.movimentos_estoque.PA001.avu_abcdef123456abcdef.qtd, 295);
  const r2 = await EA.registrar(b, dados, ctx, 'Logística');
  assert.equal(r2.ok, true); assert.equal(r2.repetida, true, 'duplo clique não cria segundo palete');
  assert.equal(Object.keys(b.db.estoque_lotes.PA001).length, 1);
  const inv = await EA.registrar(b, Object.assign({}, dados, {qtd: ''}), ctx, 'Logística');
  assert.equal(inv.ok, false); assert.ok(inv.erros.length);
  assert.equal((await EA.registrar(b, Object.assign({}, dados, {idempotencyKey: 'x'}), ctx, 'L')).ok, false, 'chave de idempotência inválida');

  // ── Qualidade libera o palete (laudo por palete, como qualquer avulso) ──────
  const lote = b.db.estoque_lotes.PA001.avu_abcdef123456abcdef;
  lote.status = 'LIBERADO_EXPEDICAO'; lote.qualidade = {decisao: 'LIBERADO_EXPEDICAO', inspecionadoPor: 'CQ', inspecionadoEm: agora};

  // ── Expedição ─────────────────────────────────────────────────────────────
  const base = {
    usuarios: {u1: {role: 'logistica', nome: 'Logística'}}, ops: {}, conferencias_pa: {}, enderecos_estoque: enderecos, estoque_lotes: b.db.estoque_lotes,
    pedidos: {
      'PED-002__PA001': {id: 'PED-002', parentPedidoId: 'PED-002', sku: 'PA001', produto: 'BODY SPLASH ANTIGO', cliente: 'Cliente B', qtdTotal: 500, produzido: 0},
      'PED-003__PA001': {id: 'PED-003', parentPedidoId: 'PED-003', sku: 'PA001', cliente: 'Cliente C', qtdTotal: 295, produzido: 0}
    },
    pedidos_comerciais: {
      'PED-002': {numeroFormatado: 'PED-002', clienteKey: 'cb', cliente: 'Cliente B', status: 'LIBERADO_PCP', frete: {tipo: 'CIF', enderecoEntrega: 'Rua B, 2'}, itens: [{sku: 'PA001', qtd: 500, expedido: 0}]},
      'PED-003': {numeroFormatado: 'PED-003', clienteKey: 'cc', cliente: 'Cliente C', status: 'LIBERADO_PCP', frete: {tipo: 'CIF', enderecoEntrega: 'Rua C, 3'}, itens: [{sku: 'PA001', qtd: 295, expedido: 0}]}
    }
  };
  const L = () => analisar(base, 'PA001', 'avu_abcdef123456abcdef', hoje);
  assert.equal(L().disponivel, false);
  assert.match(L().motivo, /sem pedido: vincule/i, 'sem pedido de destino não sai');
  assert.equal(L().avulso, true);
  // Candidatos: mesmo SKU, abertos, com saldo.
  assert.deepEqual(EA.candidatosPedido(base, lote).map((c) => c.key), ['PED-002__PA001', 'PED-003__PA001']);
  assert.match(EA.validarVinculo(base, 'PA001', 'avu_abcdef123456abcdef', 'PED-XXX'), /Escolha um pedido/);
  base.pedidos['PED-004__OUTRO'] = {id: 'PED-004', sku: 'OUTRO', cliente: 'Cliente D', qtdTotal: 10, produzido: 0};
  assert.match(EA.validarVinculo(base, 'PA001', 'avu_abcdef123456abcdef', 'PED-004__OUTRO'), /outro produto/);
  lote.status = 'QUARENTENA';
  assert.match(EA.validarVinculo(base, 'PA001', 'avu_abcdef123456abcdef', 'PED-002__PA001'), /não foi liberado/);
  lote.status = 'LIBERADO_EXPEDICAO';

  const bv = bancoFalso({estoque_lotes: base.estoque_lotes});
  const v = await EA.vincular(bv, base, 'PA001', 'avu_abcdef123456abcdef', 'PED-002__PA001', 'Logística');
  assert.equal(v.ok, true);
  Object.assign(lote, bv.db.estoque_lotes.PA001.avu_abcdef123456abcdef);
  assert.equal(lote.skuPedidoKey, 'PED-002__PA001'); assert.equal(lote.vinculoPedido.por, 'Logística');
  assert.equal(L().disponivel, true, L().motivo);
  // Portões que continuam valendo.
  const casos = [
    [(l) => { l.status = 'QUARENTENA'; }, /Qualidade/], [(l) => { delete l.qualidade; }, /Laudo/],
    [(l) => { l.validade = '2026-10-21'; }, /vencido/], [(l) => { l.enderecoKey = 'A2'; }, /endereço/]
  ];
  casos.forEach(([mut, re]) => { const c = clone(lote); mut(c); const bb = clone(base); bb.estoque_lotes.PA001.avu_abcdef123456abcdef = c; assert.match(analisar(bb, 'PA001', 'avu_abcdef123456abcdef', hoje).motivo, re); });
  { const bb = clone(base); bb.pedidos['PED-002__PA001'].statusManual = 'cancelado'; bb.pedidos_comerciais['PED-002'].status = 'CANCELADO';
    assert.match(analisar(bb, 'PA001', 'avu_abcdef123456abcdef', hoje).motivo, /cancelado/i); }

  // ── Saída (servidor) ───────────────────────────────────────────────────────
  const dadosSaida = {idempotencyKey: 'saida-avulsa-teste-0001', data: '2026-10-22', tipo: 'ENTREGA',
    paletes: [{itemKey: 'PA001', loteKey: 'avu_abcdef123456abcdef', quantidade: 295, enderecoKey: 'A1', skuPedidoKey: 'PED-002__PA001'}]};
  const plano = prepararSaida(base, dadosSaida, 'Logística', 'u1', agora);
  const semUndefined = (o, p = '') => { if (o === undefined) assert.fail('undefined em ' + p); if (o && typeof o === 'object') Object.keys(o).forEach((k) => semUndefined(o[k], p + '/' + k)); };
  semUndefined(plano.updates, 'updates');
  assert.equal(plano.updates['estoque_lotes/PA001/avu_abcdef123456abcdef/status'], 'EXPEDIDO');
  assert.equal(plano.updates['estoque_lotes/PA001/avu_abcdef123456abcdef/saldoLote'], 0);
  assert.equal(plano.updates['pedidos/PED-002__PA001/expedido'], 295);
  assert.equal(plano.updates['pedidos/PED-002__PA001/produzido'], 295, 'pedido creditado como atendido por estoque');
  assert.equal(plano.updates['pedidos/PED-002__PA001/atendidoPorEstoque'], 295);
  assert.equal(plano.updates['pedidos/PED-002__PA001/status'], undefined, '295 de 500: continua aberto');
  assert.equal(plano.carga.itens[0].origemTipo, 'entrada_avulsa_pa'); assert.equal(plano.carga.itens[0].opKey, null);
  assert.equal(plano.carga.cliente, 'Cliente B');
  assert.equal(base.pedidos['PED-002__PA001'].produzido, 0, 'planejar não muta');
  // Pedido que fecha com a saída vira Concluído.
  const b3 = clone(base); b3.estoque_lotes.PA001.avu_abcdef123456abcdef.skuPedidoKey = 'PED-003__PA001';
  const p3 = prepararSaida(b3, Object.assign({}, dadosSaida, {idempotencyKey: 'saida-avulsa-teste-0002', paletes: [Object.assign({}, dadosSaida.paletes[0], {skuPedidoKey: 'PED-003__PA001'})]}), 'Logística', 'u1', agora);
  assert.equal(p3.updates['pedidos/PED-003__PA001/status'], 'Concluído');

  // ── Conciliação: a conta continua fechando ──────────────────────────────────
  const aplicado = clone(base);
  Object.entries(plano.updates).forEach(([pth, val]) => { const ks = pth.split('/'); let o = aplicado; ks.slice(0, -1).forEach((k) => { o[k] = o[k] || {}; o = o[k]; }); o[ks.at(-1)] = clone(val); });
  const ped = CP.calcular({pedidos: aplicado.pedidos, ops: {}, estoque_lotes: aplicado.estoque_lotes, expedicoes_comerciais: {[plano.cargaKey]: aplicado.expedicoes_comerciais[plano.cargaKey]},
    conferencias_pa: {}, solicitacoes_descarte: {}, devolucoes_cliente: {}}).porPedido['PED-002__PA001'];
  assert.equal(ped.produzido, 295); assert.equal(ped.expedido.total, 295);
  assert.equal(ped.situacao, 'OK', 'produzido = expedido: ' + ped.situacao + ' dif ' + ped.diferenca);
  assert.equal(CP.linhasPorOp(ped).restanteProduzido, 0, 'sem "diferença vs OPs": o estoque próprio explica o produzido');
  // Antes de vender, o palete avulso parado não vira "estoque" de pedido nenhum.
  const parado = clone(base); parado.estoque_lotes.PA001.avu_abcdef123456abcdef.skuPedidoKey = 'PED-002__PA001';
  const c0 = CP.calcular({pedidos: parado.pedidos, ops: {}, estoque_lotes: parado.estoque_lotes, expedicoes_comerciais: {}, conferencias_pa: {}, solicitacoes_descarte: {}, devolucoes_cliente: {}}).porPedido['PED-002__PA001'];
  assert.equal(c0.estoque.total, 0, 'estoque próprio não é produção do pedido');

  // ── Telas e regras ─────────────────────────────────────────────────────────
  const fs = require('node:fs');
  const dev = fs.readFileSync('public/devolucoes.html', 'utf8');
  assert.ok(/id="view-avulsa"/.test(dev) && /EntradaAvulsaPA/.test(dev) && /id="tabAvulsa"/.test(dev));
  assert.ok(/abrirVinculoEstoque/.test(fs.readFileSync('public/shared/expedicao-grade-tela.js', 'utf8')));
  assert.equal(fs.readFileSync('functions/expedicao_regras.js', 'utf8'), fs.readFileSync('public/shared/expedicao.js', 'utf8'), 'regra da tela = regra do servidor');
  console.log('run_entrada_avulsa_pa_test: OK');
})().catch((e) => { console.error(e); process.exit(1); });
