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

  console.log('OK apontamento: 864 + 797 = 1.661; retry idempotente; pausa=checkpoint; encerramento=fechamento');
})().catch(err => { console.error(err); process.exit(1); });
