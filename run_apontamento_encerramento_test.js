const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/form.html', 'utf8');

function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Função não encontrada: ' + name);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('Função incompleta: ' + name);
}

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function parts(path) { return String(path || '').split('/').filter(Boolean); }

const data = {
  ops: {
    '26247-06': {
      lote: '26247/06', produzido: 864, produzidoLinha: 864,
      qtdPlanejada: 1660, status: 'Em Produção',
      abertaDesde: '2026-09-10T16:00:00.000Z', abertaLinha: 'Linha 2'
    }
  },
  pedidos: { '0019__GLMKAM01': { produzido: 864, qtdTotal: 1660 } }
};

function get(path) { return parts(path).reduce((o, k) => o && o[k], data); }
function set(path, value) {
  const keys = parts(path); const last = keys.pop(); let node = data;
  keys.forEach(k => { node = node[k] || (node[k] = {}); });
  node[last] = clone(value);
}

const db = { ref(path) { return {
  transaction(fn) {
    const current = clone(get(path));
    const next = fn(current);
    if (next === undefined || next === null) {
      return Promise.resolve({ committed: false, snapshot: { exists: () => !!get(path), val: () => clone(get(path)) } });
    }
    set(path, next);
    return Promise.resolve({ committed: true, snapshot: { exists: () => true, val: () => clone(get(path)) } });
  }
}; } };

let baixas = 0;
// shared/utils.js real, para as regras de consumo inteiro.
const utilsReal = { console: { log() {}, warn() {}, error() {} }, window: {}, document: undefined, setTimeout, Promise };
utilsReal.globalThis = utilsReal;
vm.createContext(utilsReal);
vm.runInContext(fs.readFileSync('public/shared/utils.js', 'utf8'), utilsReal, { filename: 'utils.js' });

const ctx = {
  console, Promise, Date, Math, Number, String, Object,
  db,
  sanitizeKey: s => String(s).replace(/[.#$[\]\/]/g, '-'),
  campoProduzido: tipo => tipo === 'rotulagem' ? 'produzidoRotulagem' : tipo === 'posto' ? 'produzidoPosto' : 'produzidoLinha',
  computeOpStatus: op => op.status === 'Aguardando Confirmação' ? op.status : 'Em Produção',
  isSetorEnvase: tipo => !tipo || tipo === 'linha',
  baixarEstoqueConsumo: () => { baixas++; return Promise.resolve(); },
  opEstaAtiva: op => !['Concluído', 'Cancelado', 'Aguardando Confirmação'].includes(op.status),
  liberarEmpenhoLote: () => Promise.resolve(),
  window: {}
};
vm.createContext(ctx);
vm.runInContext(extractFunction('updateOpRecordOnApontamento'), ctx);
vm.runInContext(extractFunction('aplicarProducaoPedidoIdempotente'), ctx);

(async () => {
  const efeitos = {
    tipoEvento: 'fechamento_op', encerrarAlocacao: true,
    campoInicio: 'abertaDesde', campoNome: 'abertaLinha', aguardarConfirmacao: true
  };
  const first = await ctx.updateOpRecordOnApontamento(
    '26247/06', 797, 0, '2026-09-10T16:00:00.000Z', 'linha',
    '2026-09-10T18:00:00.000Z', 1661, 'fechamento-1', efeitos
  );
  if (!first.committed || first.deltaAplicado !== 797 || !first.aplicacaoNova) throw new Error('Primeiro fechamento não aplicou delta 797');
  const op = data.ops['26247-06'];
  if (op.produzido !== 1661 || op.produzidoLinha !== 1661) throw new Error('Total da OP não chegou a 1.661');
  if (op.status !== 'Aguardando Confirmação' || op.abertaDesde !== null || op.abertaLinha !== null) throw new Error('OP não foi liberada/encaminhada corretamente');
  if (baixas !== 1) throw new Error('Consumo deveria ocorrer uma vez');

  const retry = await ctx.updateOpRecordOnApontamento(
    '26247/06', 797, 0, '2026-09-10T16:00:00.000Z', 'linha',
    '2026-09-10T18:00:00.000Z', 1661, 'fechamento-1', efeitos
  );
  if (retry.deltaAplicado !== 797 || retry.aplicacaoNova) throw new Error('Retry não recuperou o delta original');
  if (op.produzido !== 1661 || baixas !== 1) throw new Error('Retry duplicou produção ou consumo');

  const item = { id: 'fechamento-1', lote: '26247/06', registro: { lote: '26247/06' } };
  await ctx.aplicarProducaoPedidoIdempotente('0019__GLMKAM01', item, 797, 398);
  await ctx.aplicarProducaoPedidoIdempotente('0019__GLMKAM01', item, 797, 398);
  if (data.pedidos['0019__GLMKAM01'].produzido !== 1661) throw new Error('Pedido duplicou o mesmo fechamento');
  if (data.pedidos['0019__GLMKAM01'].status !== 'Concluído') throw new Error('Pedido que atingiu o total não foi concluído');

  const ajustes = [];
  const baixasWms = [];
  const consumptionCtx = {
    console, Promise, Math, parseFloat, Object,
    allFormulasForm: { f1: { codProduto: 'GLMKAM01', versao: 'v1', status: 'RASCUNHO', itens: { agua: { mpCodigo: 'MPGR-00132', percentualMM: 97.38 } } } },
    allBomForm: { 'GLMKAM01__v1': { itens: {
      frasco: { materialCodigo: 'EP-00092', materialNome: 'Frasco', qtdPorPeca: 1 },
      tampa: { materialCodigo: 'EP-00069', materialNome: 'Tampa', qtdPorPeca: 1 },
      caixa: { materialCodigo: 'ET-00012', materialNome: 'Caixa', qtdPorPeca: 0.041666 }
    } } },
    allProdutosForm: { GLMKAM01: { sku: 'GLMKAM01', densidadeGranel: -1, volume: 325, unidadeVolume: 'ml', clienteKey: 'GLMK' } },
    // Propriedade do estoque: o consumo leva o cliente da OP (material de
    // cliente só serve a ele). Módulo real, não imitação.
    PropriedadeEstoque: require('./public/shared/propriedade-estoque.js'),
    allMateriaisForm: {},
    melhorFormulaDoProduto: () => ({ registro: consumptionCtx.allFormulasForm.f1 }),
    chaveVersao: (sku, versao) => sku + '__' + versao,
    sanitizeKey: s => String(s).replace(/[.#$[\]\/]/g, '-'),
    explodirMateriaisNecessarios: () => { throw new Error('Não deveria explodir fórmula com densidade -1'); },
    // Regras reais de consumo inteiro / sem controle de estoque (shared/utils.js, 01/10).
    consumoBomIncremental: utilsReal.consumoBomIncremental,
    materialSemControleEstoque: utilsReal.materialSemControleEstoque,
    ajustarEstoque: (db, codigo, delta, tipo, ref, extras) => { ajustes.push({ codigo, delta, cliente: extras && extras.clienteKeyConsumidor }); return Promise.resolve(); },
    baixarEmpenho: () => Promise.resolve(),
    baixaWmsSegura: (tipo, codigo, qtd, motivo, autor, ref, clienteKey) => { baixasWms.push(clienteKey); return Promise.resolve(); },
    db: {}, window: { currentUser: { nome: 'Teste' } }
  };
  vm.createContext(consumptionCtx);
  vm.runInContext(extractFunction('clienteKeyDaOp'), consumptionCtx);
  vm.runInContext(extractFunction('baixarEstoqueConsumo'), consumptionCtx);
  await consumptionCtx.baixarEstoqueConsumo({ sku: 'GLMKAM01', lote: '26247/06' }, 797, 'consumo_producao', '26247/06');
  if (ajustes.length !== 3) throw new Error('Densidade inválida deveria baixar somente os 3 itens do BOM');
  if (!ajustes.every(a => a.cliente === 'GLMK') || !baixasWms.every(c => c === 'GLMK') || baixasWms.length !== 3) {
    throw new Error('Consumo precisa levar o cliente da OP ao saldo agregado e ao FEFO (propriedade do estoque)');
  }
  const deltas = Object.fromEntries(ajustes.map(a => [a.codigo, a.delta]));
  // Caixa de 24 (0,041666 por peça): 797 peças = 34 caixas, inteiro (01/10).
  if (deltas['EP-00092'] !== -797 || deltas['EP-00069'] !== -797 || deltas['ET-00012'] !== -34) throw new Error('Consumo do BOM ficou incorreto: ' + JSON.stringify(deltas));
  // Apontamento seguinte (797 -> 1661): só as caixas novas, inteiras; soma fecha em ceil(1661/24) = 70.
  ajustes.length = 0;
  await consumptionCtx.baixarEstoqueConsumo({ sku: 'GLMKAM01', lote: '26247/06', produzidoLinha: 1661 }, 864, 'consumo_producao', '26247/06');
  const d2 = Object.fromEntries(ajustes.map(a => [a.codigo, a.delta]));
  if (d2['ET-00012'] !== -36) throw new Error('Segundo apontamento deveria baixar 36 caixas (70 − 34): ' + d2['ET-00012']);
  // Material sem controle de estoque não baixa.
  ajustes.length = 0;
  consumptionCtx.allMateriaisForm = { 'EP-00069': { mpCodigo: 'EP-00069', controlaEstoque: false } };
  await consumptionCtx.baixarEstoqueConsumo({ sku: 'GLMKAM01', lote: '26247/06', produzidoLinha: 1700 }, 39, 'consumo_producao', '26247/06');
  if (ajustes.some(a => a.codigo === 'EP-00069')) throw new Error('Material sem controle de estoque não pode baixar');
  if (!ajustes.some(a => a.codigo === 'EP-00092')) throw new Error('Os demais continuam baixando');
  consumptionCtx.allMateriaisForm = {};
  if ('MPGR-00132' in deltas) throw new Error('Fórmula com densidade -1 não pode movimentar estoque');

  const totalForm = source.slice(source.indexOf("document.getElementById('totalForm')"), source.indexOf('// ════════════════════════════════════════════════', source.indexOf("document.getElementById('totalForm')")));
  if (!totalForm.includes("type: 'fechamento_op'") || !totalForm.includes("tipo: 'fechamento_op'")) throw new Error('Encerrar OP legado ainda grava checkpoint');
  if (totalForm.includes("db.ref('ops/' + sanitizeKey(lote)).update")) throw new Error('Fluxo legado ainda libera OP antes da confirmação');
  if (!source.includes("var tipoEvento = ehFechamento ? 'fechamento_op' : 'apontamento_total'")) throw new Error('Painel de Turno não diferencia checkpoint de fechamento');
  if (!source.includes("dedupeKey: 'fechamento:'")) throw new Error('Fechamento sem deduplicação lógica');

  const queued = [];
  const flowCtx = {
    console, Promise, Date, Math, parseInt,
    isOnline: true,
    findOpByLote: () => ({
      lote: '26247/06', produto: 'ÁGUA MICELAR 3 EM 1', linha: 'Linha 2',
      abertaDesde: '2026-09-10T16:00:00.000Z', produzidoLinha: 864,
      qtdPlanejada: 1660, status: 'Em Produção'
    }),
    campoAberturaInicio: () => 'abertaDesde', campoAberturaNome: () => 'abertaLinha',
    horasDesde: () => 2, getProduzido: op => op.produzidoLinha || 0,
    resolvePedidoKeyBySkuKey: () => null, pedidosCache: {}, today: () => '2026-09-10',
    pad: n => String(n).padStart(2, '0'), guessShift: () => 'Padrao',
    sanitizeKey: s => String(s).replace(/[.#$[\]\/]/g, '-'),
    db: { ref: () => ({ push: () => ({ key: 'id-' + (queued.length + 1) }) }) },
    queueOfflineWrite: item => { queued.push(item); item.deltaConfirmado = item.type === 'fechamento_op' ? 797 : 100; return Promise.resolve({ item }); }
  };
  vm.createContext(flowCtx);
  vm.runInContext(extractFunction('fecharAlocacaoOP'), flowCtx);
  await flowCtx.fecharAlocacaoOP('26247/06', 964, 'Luciane', { manterAberta: true, tipo: 'linha' });
  await flowCtx.fecharAlocacaoOP('26247/06', 1661, 'Luciane', { manterAberta: false, forcarConcluido: true, tipo: 'linha', justificativa: 'Produção real' });
  if (queued[0].type !== 'apontamento_total' || !queued[0].efeitosOp.manterAberta) throw new Error('Pausa deixou de ser checkpoint');
  if (queued[1].type !== 'fechamento_op' || queued[1].registro.tipo !== 'fechamento_op' || !queued[1].efeitosOp.aguardarConfirmacao) throw new Error('Encerramento do Painel não é fechamento real');

  // ── Encerrar num setor não encerra a OP com outro setor aberto (30/09) ──
  data.ops['26264-07'] = {
    lote: '26264/07', produzido: 500, produzidoLinha: 500, produzidoRotulagem: 300,
    qtdPlanejada: 2000, status: 'Em Produção',
    abertaDesde: '2026-09-24T10:00:00.000Z', abertaLinha: 'Linha 1',
    abertaDesdeRot: '2026-09-24T11:00:00.000Z', abertaRotulagem: 'Rotuladora 1'
  };
  const efRot = { tipoEvento: 'fechamento_op', encerrarAlocacao: true, campoInicio: 'abertaDesdeRot', campoNome: 'abertaRotulagem', aguardarConfirmacao: true };
  const efLin = { tipoEvento: 'fechamento_op', encerrarAlocacao: true, campoInicio: 'abertaDesde', campoNome: 'abertaLinha', aguardarConfirmacao: true };
  await ctx.updateOpRecordOnApontamento('26264/07', 200, 0, '2026-09-24T11:00:00.000Z', 'rotulagem', '2026-09-24T13:00:00.000Z', 500, 'rot-1', efRot);
  let o2 = data.ops['26264-07'];
  if (o2.status !== 'Em Produção') throw new Error('Fechar a rotulagem encerrou a OP que segue no envase: ' + o2.status);
  if (o2.abertaDesdeRot !== null || o2.abertaRotulagem !== null) throw new Error('A rotulagem deveria ter sido liberada');
  if (!o2.abertaDesde || o2.abertaLinha !== 'Linha 1') throw new Error('A alocação do envase foi mexida pelo fechamento da rotulagem');
  if (o2.produzidoRotulagem !== 500) throw new Error('Total da rotulagem não foi somado');
  // Agora o envase fecha: sem mais nenhum setor aberto, a OP vai para o PCP.
  await ctx.updateOpRecordOnApontamento('26264/07', 1500, 0, '2026-09-24T10:00:00.000Z', 'linha', '2026-09-24T15:00:00.000Z', 2000, 'lin-1', efLin);
  o2 = data.ops['26264-07'];
  if (o2.status !== 'Aguardando Confirmação' || o2.abertaDesde !== null) throw new Error('Último setor fechado deveria encaminhar a OP ao PCP');
  // Inverso: fechar o envase com a rotulagem ainda aberta também não encerra a OP.
  data.ops['26264-08'] = { lote: '26264/08', produzido: 100, produzidoLinha: 100, qtdPlanejada: 1000, status: 'Em Produção',
    abertaDesde: '2026-09-24T10:00:00.000Z', abertaLinha: 'Linha 1', abertaDesdeRot: '2026-09-24T11:00:00.000Z', abertaRotulagem: 'Rotuladora 1' };
  await ctx.updateOpRecordOnApontamento('26264/08', 900, 0, '2026-09-24T10:00:00.000Z', 'linha', '2026-09-24T15:00:00.000Z', 1000, 'lin-2', efLin);
  if (data.ops['26264-08'].status !== 'Em Produção') throw new Error('Fechar o envase com a rotulagem aberta encerrou a OP');
  // Apontamento de rotulagem nunca conclui a OP pelo cálculo automático de envase.
  data.ops['26264-09'] = { lote: '26264/09', produzido: 1000, produzidoLinha: 1000, qtdPlanejada: 1000, status: 'Em Produção',
    abertaDesde: '2026-09-24T10:00:00.000Z', abertaLinha: 'Linha 1', abertaDesdeRot: '2026-09-24T11:00:00.000Z', abertaRotulagem: 'Rotuladora 1' };
  ctx.computeOpStatus = op => (op.produzidoLinha || 0) / op.qtdPlanejada >= 0.95 ? 'Aguardando Confirmação' : 'Em Produção';
  await ctx.updateOpRecordOnApontamento('26264/09', 100, 0, '2026-09-24T11:00:00.000Z', 'rotulagem', '2026-09-24T12:00:00.000Z', null, 'rot-2', { tipoEvento: 'registro', manterAberta: true, campoInicio: 'abertaDesdeRot', campoNome: 'abertaRotulagem' });
  if (data.ops['26264-09'].status !== 'Em Produção') throw new Error('Apontamento de rotulagem encerrou a OP pelo cálculo de envase');
  await ctx.updateOpRecordOnApontamento('26264/09', 1, 0, '2026-09-24T12:00:00.000Z', 'linha', '2026-09-24T12:30:00.000Z', null, 'lin-3', { tipoEvento: 'registro', manterAberta: true, campoInicio: 'abertaDesde', campoNome: 'abertaLinha' });
  if (data.ops['26264-09'].status !== 'Em Produção') throw new Error('Com a rotulagem aberta, nem o cálculo de envase encerra a OP');
  ctx.computeOpStatus = op => op.status === 'Aguardando Confirmação' ? op.status : 'Em Produção';

  // ── Rotulagem antes do envase (01/10, OPs 26273/03 e /04) ──
  // Rotulou tudo, envase nem começou: fechar a rotulagem não manda a OP ao PCP.
  data.ops['26273-03'] = { lote: '26273/03', produzidoLinha: 0, produzidoRotulagem: 0, qtdPlanejada: 1750, status: 'Não Iniciado',
    abertaDesdeRot: '2026-09-30T11:00:00.000Z', abertaRotulagem: 'Rotuladora 1' };
  await ctx.updateOpRecordOnApontamento('26273/03', 1750, 0, '2026-09-30T11:00:00.000Z', 'rotulagem', '2026-09-30T14:54:00.000Z', 1750, 'rot-3', efRot);
  let o3 = data.ops['26273-03'];
  if (o3.status === 'Aguardando Confirmação') throw new Error('Rotulagem fechada sem envase mandou a OP ao PCP');
  if (o3.produzidoRotulagem !== 1750 || o3.abertaDesdeRot !== null) throw new Error('Rotulagem deveria somar e liberar a rotuladora');
  // Depois o envase roda e fecha: aí sim vai ao PCP.
  data.ops['26273-03'].abertaDesde = '2026-10-01T10:00:00.000Z'; data.ops['26273-03'].abertaLinha = 'Linha 2';
  await ctx.updateOpRecordOnApontamento('26273/03', 1750, 0, '2026-10-01T10:00:00.000Z', 'linha', '2026-10-01T14:00:00.000Z', 1750, 'lin-4', efLin);
  if (data.ops['26273-03'].status !== 'Aguardando Confirmação') throw new Error('Envase fechado depois da rotulagem deveria ir ao PCP');
  // Envase já feito e fechado, rotulagem fecha por último: vai ao PCP.
  data.ops['26273-05'] = { lote: '26273/05', produzidoLinha: 900, produzido: 900, produzidoRotulagem: 0, qtdPlanejada: 900, status: 'Em Produção',
    abertaDesdeRot: '2026-09-30T11:00:00.000Z', abertaRotulagem: 'Rotuladora 1' };
  await ctx.updateOpRecordOnApontamento('26273/05', 900, 0, '2026-09-30T11:00:00.000Z', 'rotulagem', '2026-09-30T15:00:00.000Z', 900, 'rot-4', efRot);
  if (data.ops['26273-05'].status !== 'Aguardando Confirmação') throw new Error('Rotulagem fechando por último, com envase feito, deveria ir ao PCP');

  // Cada fechamento de setor fica à espera do PCP, com o total do setor (01/10).
  const et3 = data.ops['26273-03'].confirmacaoEtapas;
  if (!et3 || et3.rotulagem.status !== 'AGUARDANDO' || et3.rotulagem.quantidade !== 1750 || et3.rotulagem.local !== 'Rotuladora 1') throw new Error('Fechamento da rotulagem não ficou para o PCP confirmar: ' + JSON.stringify(et3));
  if (et3.envase.status !== 'AGUARDANDO' || et3.envase.quantidade !== 1750 || et3.envase.local !== 'Linha 2') throw new Error('Fechamento do envase não ficou para o PCP confirmar');
  // Turno retroativo (registro sem efeitos) que leva o envase à meta: a OP vai
  // ao PCP e o envase fica como etapa a confirmar (01/10).
  ctx.computeOpStatus = op => op.status === 'Aguardando Confirmação' ? op.status : ((op.produzidoLinha || 0) / op.qtdPlanejada >= 0.95 ? 'Aguardando Confirmação' : 'Em Produção');
  data.ops['26273-04'] = { lote: '26273/04', produzidoLinha: 0, produzidoRotulagem: 559, qtdPlanejada: 959, status: 'Não Iniciado',
    confirmacaoEtapas: { rotulagem: { status: 'AGUARDANDO', quantidade: 559 } } };
  await ctx.updateOpRecordOnApontamento('26273/04', 950, 0, '2026-09-29T08:00:00.000Z', 'linha', '2026-09-29T16:00:00.000Z', null, 'retro-1', null);
  const o4 = data.ops['26273-04'];
  if (o4.status !== 'Aguardando Confirmação') throw new Error('Retroativo que bate a meta deveria ir ao PCP: ' + o4.status);
  if (!o4.confirmacaoEtapas.envase || o4.confirmacaoEtapas.envase.status !== 'AGUARDANDO' || o4.confirmacaoEtapas.envase.quantidade !== 950) throw new Error('Envase do retroativo não ficou para o PCP confirmar');
  if (o4.confirmacaoEtapas.rotulagem.status !== 'AGUARDANDO') throw new Error('Rotulagem pendente foi mexida');
  ctx.computeOpStatus = op => op.status === 'Aguardando Confirmação' ? op.status : 'Em Produção';

  // Checkpoint (pausa, manterAberta) não pede confirmação.
  if (data.ops['26264-09'].confirmacaoEtapas) throw new Error('Apontamento parcial não deveria pedir confirmação');

  console.log('OK apontamento: 864 + 797 = 1.661; retry idempotente; pausa=checkpoint; encerramento=fechamento; densidade inválida não inverte estoque; fechar um setor não encerra a OP com outro aberto');
})().catch(err => { console.error(err); process.exit(1); });
