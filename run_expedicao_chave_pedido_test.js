/* Chave do pedido com e sem zero à esquerda na Expedição.
   /pedidos tem os dois formatos de verdade ('0017__X' e '26__Y'), e as OPs
   gravam o número sem zero. O teste trava três coisas: (1) o palete da
   Conferência de PA acha o pedido mesmo com a chave sem zero; (2) o palete
   legado não acusa "vínculo mudou" se as OPs um dia forem migradas para a
   chave com zero; (3) mudança REAL de pedido (outro número ou outro SKU)
   continua bloqueando -- tolerar zero não pode virar tolerar qualquer coisa. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ExpedicaoPA = require(path.join(__dirname, 'public', 'shared', 'expedicao.js'));

const HOJE = '2026-09-14';
const {normalizarChavePedido: norm, resolverChavePedido: resolver} = ExpedicaoPA;

// ── 1. Funções puras ────────────────────────────────────────────────────
assert.equal(norm('0017__PRF-AFEE-0014'), '17__PRF-AFEE-0014');
assert.equal(norm('17__PRF-AFEE-0014'), '17__PRF-AFEE-0014');
assert.equal(norm('0000__X'), '0__X');
assert.equal(norm('01_07__MRARBS01'), '01_07__MRARBS01', 'número não numérico fica como está');
assert.equal(norm('SEM_SEPARADOR'), 'SEM_SEPARADOR');
assert.equal(norm('19__SKU__COM__SEPARADOR'), '19__SKU__COM__SEPARADOR', 'só o número é normalizado');
assert.equal(norm(null), '');

const pedidos = {
  '0017__PRF-AFEE-0014': {id: '17'},
  '26__AGU-SEUN-0001': {id: '26'},
  '0030__DUPLO': {id: '30'}, '030__DUPLO': {id: '30'}
};
assert.equal(resolver(pedidos, '0017__PRF-AFEE-0014'), '0017__PRF-AFEE-0014', 'exata vence');
assert.equal(resolver(pedidos, '17__PRF-AFEE-0014'), '0017__PRF-AFEE-0014', 'OP sem zero acha o pedido com zero');
assert.equal(resolver(pedidos, '0026__AGU-SEUN-0001'), '26__AGU-SEUN-0001', 'e o contrário também');
assert.equal(resolver(pedidos, '30__DUPLO'), '30__DUPLO', 'ambíguo não escolhe: devolve a própria chave');
assert.equal(resolver(pedidos, '0030__DUPLO'), '0030__DUPLO', 'ambíguo com exata: a exata vence');
assert.equal(resolver(pedidos, '17__OUTRO-SKU'), '17__OUTRO-SKU', 'mesmo número, SKU diferente, não resolve');
assert.equal(resolver(pedidos, ''), '');
assert.equal(resolver(undefined, '17__X'), '17__X');

// ── Base mínima ─────────────────────────────────────────────────────────
function base(extra) {
  return Object.assign({
    estoque_lotes: {'PRF-AFEE-0014': {}},
    ops: {'26251-15': {status: 'Concluído', sku: 'PRF-AFEE-0014', skuPedidoKey: '17__PRF-AFEE-0014'}},
    pedidos: {'0017__PRF-AFEE-0014': {id: '17', sku: 'PRF-AFEE-0014', cliente: 'AFEER', parentPedidoId: '17'}},
    pedidos_comerciais: {},
    conferencias_pa: {'26251-15': {finalizadoEm: '2026-09-15T01:20:02.555Z', finalizacaoId: 'fin1'}},
    enderecos_estoque: {'FAB-1-1-1': {ativo: true}, HISTORICO: {ativo: true}}
  }, extra || {});
}
function paleteConferido(over) {
  return Object.assign({
    itemTipo: 'produto', origemTipo: 'conferencia_pa', identificadorPalete: 'PA-26251/15-P1',
    status: 'LIBERADO_EXPEDICAO', qualidade: {decisao: 'LIBERADO_EXPEDICAO'},
    conferencia: {finalizacaoId: 'fin1'}, itemCodigo: 'PRF-AFEE-0014', opKey: '26251-15',
    skuPedidoKey: '17__PRF-AFEE-0014', saldoLote: 1895, enderecoKey: 'FAB-1-1-1'
  }, over || {});
}
function analisa(p, extraBase) {
  const b = base(extraBase);
  b.estoque_lotes['PRF-AFEE-0014'] = {pa_1: p};
  return ExpedicaoPA.analisar(b, 'PRF-AFEE-0014', 'pa_1', HOJE);
}

// ── 2. O caso real: palete da 26251/15, chave sem zero, pedido com zero ──
const conf = analisa(paleteConferido());
assert.equal(conf.motivo, '', 'palete conferido deveria estar disponível, veio: ' + conf.motivo);
assert.equal(conf.skuPedidoKey, '0017__PRF-AFEE-0014', 'a chave devolvida é a que EXISTE -- é nela que o servidor baixa o expedido');
assert.equal(conf.cliente, 'AFEER');
// com a Qualidade ainda pendente, o motivo é a Qualidade, não o pedido
assert.equal(analisa(paleteConferido({status: 'QUARENTENA', qualidade: null})).motivo, 'Aguardando liberação da Qualidade');

// ── 3. Palete legado + OP migrada para a chave com zero: não é mudança ────
function paleteLegado(over) {
  return Object.assign({
    itemTipo: 'produto', legado: true, origemTipo: 'legado_planilha', identificadorPalete: 'LEG-26251/15-x',
    status: 'LEGADO_ESTOQUE', itemCodigo: 'PRF-AFEE-0014', opKey: '26251-15',
    skuPedidoKey: '0017__PRF-AFEE-0014', skuPedidoKeyOrigem: '17__PRF-AFEE-0014',
    saldoLote: 100, enderecoKey: 'HISTORICO'
  }, over || {});
}
assert.equal(analisa(paleteLegado()).motivo, '', 'legado como está hoje continua liberado');
const opMigrada = {ops: {'26251-15': {status: 'Concluído', sku: 'PRF-AFEE-0014', skuPedidoKey: '0017__PRF-AFEE-0014'}}};
assert.equal(analisa(paleteLegado(), opMigrada).motivo, '', 'OP migrada para chave com zero NÃO pode bloquear o legado');
assert.equal(analisa(paleteConferido(), opMigrada).motivo, '', 'nem o palete conferido');

// ── 4. Mudança REAL de vínculo continua bloqueando ───────────────────────
const outroNumero = {
  ops: {'26251-15': {status: 'Concluído', sku: 'PRF-AFEE-0014', skuPedidoKey: '0018__PRF-AFEE-0014'}},
  pedidos: {'0017__PRF-AFEE-0014': {id: '17', sku: 'PRF-AFEE-0014', cliente: 'AFEER', parentPedidoId: '17'},
            '0018__PRF-AFEE-0014': {id: '18', sku: 'PRF-AFEE-0014', cliente: 'AFEER', parentPedidoId: '18'}}
};
assert.equal(analisa(paleteLegado(), outroNumero).motivo, 'Vínculo do pedido mudou após a conferência');
assert.equal(analisa(paleteConferido(), outroNumero).motivo, 'Vínculo do pedido mudou após a conferência');
const outroSku = {ops: {'26251-15': {status: 'Concluído', sku: 'PRF-AFEE-0014', skuPedidoKey: '17__PRF-AFEE-9999'}}};
assert.equal(analisa(paleteLegado(), outroSku).motivo, 'Vínculo do pedido mudou após a conferência');

// ── 5. Pedido que não existe em formato nenhum continua ausente ──────────
assert.equal(analisa(paleteConferido({skuPedidoKey: '23__HDR-MISS-0008'})).motivo,
  'Pedido de origem ausente; regularize o vínculo da OP no PCP');

// ── 6. A cópia do servidor é a mesma regra ───────────────────────────────
assert.equal(
  fs.readFileSync(path.join(__dirname, 'functions', 'expedicao_regras.js'), 'utf8'),
  fs.readFileSync(path.join(__dirname, 'public', 'shared', 'expedicao.js'), 'utf8'),
  'functions/expedicao_regras.js divergiu de public/shared/expedicao.js: a tela libera e o callable recusa');

console.log('run_expedicao_chave_pedido_test: OK');
