/* Palete legado na Expedição.
   O ponto do teste: o legado dispensa APENAS conferência e laudo, e nada
   mais. Um palete legado sem endereço, vencido, de OP não concluída ou de
   pedido cancelado tem que continuar bloqueado -- senão a dispensa vira
   porta dos fundos para sair mercadoria do galpão sem checagem. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ExpedicaoPA = require(path.join(__dirname, 'public', 'shared', 'expedicao.js'));

const HOJE = '2026-09-14';

function base(extra) {
  const b = {
    estoque_lotes: {GLMKAM04: {}},
    ops: {'26244-16': {status: 'Concluído', sku: 'GLMKAM04', lote: '26244/16',
                       skuPedidoKey: '19__GLMKAM04', cliente: 'GLOW MAKE UP'}},
    pedidos: {'19__GLMKAM04': {id: '19', sku: 'GLMKAM04', cliente: 'GLOW MAKE UP', parentPedidoId: '19'}},
    pedidos_comerciais: {},
    conferencias_pa: {},
    enderecos_estoque: {HISTORICO: {codigo: 'HISTORICO', area: 'GALPAO', ativo: true}}
  };
  return Object.assign(b, extra || {});
}

function palete(over) {
  return Object.assign({
    itemTipo: 'produto', legado: true, origemTipo: 'legado_planilha',
    identificadorPalete: 'LEG-26244/16-ab12cd', status: 'LEGADO_ESTOQUE',
    itemCodigo: 'GLMKAM04', opKey: '26244-16', opLote: '26244/16',
    skuPedidoKey: '19__GLMKAM04', saldoLote: 2112, qtdOriginal: 2112,
    enderecoKey: 'HISTORICO', conferencia: null, qualidade: null, validade: null
  }, over || {});
}

function analisa(over, extraBase) {
  const b = base(extraBase);
  b.estoque_lotes.GLMKAM04 = {LEG_ab12cd: palete(over)};
  return ExpedicaoPA.analisar(b, 'GLMKAM04', 'LEG_ab12cd', HOJE);
}

// ── 1. O caso que motiva tudo: legado sem conferência e sem laudo passa ──
const ok = analisa();
assert.equal(ok.motivo, '', 'legado deveria estar disponível, veio: ' + ok.motivo);
assert.ok(ok.disponivel);
assert.equal(ok.legado, true, 'a análise precisa sinalizar que é legado');
assert.equal(ok.cliente, 'GLOW MAKE UP');
assert.equal(ok.pedidoId, '19', 'o pedido reconstruído tem que chegar na tela');

// ── 2. E o palete NORMAL continua exigindo conferência e laudo ───────────
const semLaudo = analisa({legado: false, origemTipo: 'conferencia_pa', status: 'LIBERADO_EXPEDICAO'});
assert.equal(semLaudo.motivo, 'Laudo da Qualidade ausente ou divergente');
const semQualidade = analisa({legado: false, origemTipo: 'conferencia_pa'});
assert.equal(semQualidade.motivo, 'Aguardando liberação da Qualidade');

// ── 3. A dispensa NÃO pode vazar para quem só finge ser legado ───────────
assert.equal(analisa({legado: false}).motivo, 'Sem palete de PA conferido',
  'origemTipo legado_planilha sem a flag legado:true não vale');
assert.equal(analisa({origemTipo: 'conferencia_pa', legado: true, status: 'LEGADO_ESTOQUE'}).motivo,
  'Aguardando liberação da Qualidade', 'flag legado sem a origem certa não dispensa nada');
assert.equal(analisa({origemTipo: 'invencao', legado: true}).motivo, 'Sem palete de PA conferido');
assert.equal(analisa({identificadorPalete: ''}).motivo, 'Sem palete de PA conferido');
assert.equal(analisa({itemTipo: 'material'}).motivo, 'Sem palete de PA conferido');

// ── 4. Todos os OUTROS portões continuam valendo para o legado ───────────
assert.equal(analisa({enderecoKey: 'NAO-EXISTE'}).motivo, 'Aguardando endereço definitivo ativo');
assert.equal(analisa({aguardandoEnderecoDefinitivo: true}).motivo, 'Aguardando endereço definitivo ativo');
assert.equal(analisa({}, {enderecos_estoque: {HISTORICO: {codigo: 'HISTORICO', ativo: false}}}).motivo,
  'Aguardando endereço definitivo ativo', 'endereço inativo bloqueia');
assert.equal(analisa({validade: '2026-09-13'}).motivo, 'Palete vencido');
assert.equal(analisa({saldoLote: 0}).motivo, 'Sem saldo disponível');
assert.equal(analisa({saldoLote: 10.5}).motivo, 'Sem saldo disponível');
assert.equal(analisa({expedicaoId: 'EXP-1'}).motivo, 'Sem saldo disponível',
  'palete já expedido não pode sair de novo');
assert.equal(analisa({}, {ops: {'26244-16': {status: 'Aguardando Confirmação', sku: 'GLMKAM04',
  skuPedidoKey: '19__GLMKAM04'}}}).motivo, 'OP ou produto inconsistente',
  'OP não concluída bloqueia — é o caso real da 26253/03');
assert.equal(analisa({}, {pedidos: {}}).motivo,
  'Pedido de origem ausente; regularize o vínculo da OP no PCP');
assert.equal(analisa({}, {pedidos: {'19__GLMKAM04': {id: '19', sku: 'GLMKAM04',
  cliente: 'GLOW MAKE UP', parentPedidoId: '19', status: 'Cancelado'}}}).motivo, 'Pedido cancelado');

// ── 5. listar() enxerga o palete legado ─────────────────────────────────
const b = base();
b.estoque_lotes.GLMKAM04 = {LEG_ab12cd: palete()};
const linhas = ExpedicaoPA.listar(b, HOJE);
assert.equal(linhas.length, 1);
assert.ok(linhas[0].disponivel && linhas[0].legado);

// ── 6. O status LEGADO_ESTOQUE existe no vocabulário e é disponível ──────
const utils = fs.readFileSync(path.join(__dirname, 'public', 'shared', 'utils.js'), 'utf8');
assert.ok(/LEGADO_ESTOQUE:\s*\{[^}]*disponivel:\s*true[^}]*aplicaA:\s*'produto'/.test(utils),
  'LEGADO_ESTOQUE precisa estar em STATUS_LOTE como disponível, aplicável a produto');
assert.ok(!/LEGADO_ESTOQUE[^}]*badge-green/.test(utils),
  'legado não pode usar o verde de "liberado pela Qualidade"');

// ── 7. O script de importação não forja Qualidade nem conferência ────────
const script = fs.readFileSync(path.join(__dirname, 'scripts', 'importar_expedicao_legado.py'), 'utf8');
assert.ok(/"conferencia":\s*None,\s*"qualidade":\s*None/.test(script),
  'a importação não pode preencher conferência nem laudo');
assert.ok(!/LIBERADO_EXPEDICAO/.test(script),
  'a importação não pode gravar decisão de Qualidade');
assert.ok(/op_key in em_conferencia/.test(script),
  'OP com conferência em andamento precisa ficar fora do palete legado');
assert.ok(/hashlib\.sha1/.test(script) && /nao da posicao dela na planilha/.test(script),
  'as chaves precisam ser determinísticas para a carga poder ser repetida');

console.log('run_expedicao_legado_test: OK');
