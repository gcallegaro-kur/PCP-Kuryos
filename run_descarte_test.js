const fs = require('fs');
const vm = require('vm');
const ctx = { console, Promise, setTimeout, clearTimeout, Date, Math, Object, String, Number, Array, JSON };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/shared/utils.js', 'utf8'), ctx);

const dados = { estoque_lotes: { 'MP-001': { L1: { itemTipo: 'material', itemCodigo: 'MP-001', itemNome: 'Ativo', loteOrigem: 'LOT-1', saldoLote: 12, status: 'REPROVADO', enderecoKey: 'A1' } } } };
function partes(p) { return String(p || '').split('/').filter(Boolean); }
function get(p) { return partes(p).reduce((o, k) => o && o[k], dados); }
function set(p, v) { const ks = partes(p), last = ks.pop(); let o = dados; ks.forEach(k => o = o[k] || (o[k] = {})); o[last] = v; }
let seq = 0;
const db = { ref(path) { return {
  key: partes(path).slice(-1)[0] || null,
  once() { return Promise.resolve({ val: () => get(path) }); },
  transaction(fn) { const next = fn(get(path)); if (next === undefined) return Promise.resolve({ committed: false, snapshot: { val: () => get(path) } }); set(path, next); return Promise.resolve({ committed: true, snapshot: { val: () => get(path) } }); },
  set(v) { set(path, v); return Promise.resolve(); },
  update(v) { set(path, Object.assign({}, get(path) || {}, v)); return Promise.resolve(); },
  push(v) { const key = 'k' + (++seq), p = String(path || '') + '/' + key; if (arguments.length) { set(p, v); return { key, then: cb => Promise.resolve({ key }).then(cb) }; } return { key }; }
}; } };

(async () => {
  const r = await ctx.solicitarDestinacaoLote(db, 'MP-001', 'L1', { quantidade: 7, motivo: 'Reprovado no CQ', classificacao: 'DESCARTE' }, 'Logística');
  if (!r.ok) throw new Error(r.erro);
  if (dados.estoque_lotes['MP-001'].L1.saldoLote !== 12 || dados.estoque_lotes['MP-001'].L1.status !== 'AGUARDANDO_DESCARTE') throw new Error('Solicitação deveria apenas segregar o lote');
  const c = await ctx.confirmarDestinacaoLote(db, r.solicitacaoKey, 'Logística', 'MTR-123');
  if (!c.ok || c.abatido !== 7) throw new Error('Confirmação não baixou a quantidade correta');
  if (dados.estoque_lotes['MP-001'].L1.saldoLote !== 5 || dados.estoque_lotes['MP-001'].L1.status !== 'REPROVADO') throw new Error('Saldo/status remanescente incorreto');
  if (dados.solicitacoes_descarte[r.solicitacaoKey].status !== 'CONCLUIDO') throw new Error('Solicitação deveria estar concluída');
  console.log('OK descarte: segregação sem baixa, saída confirmada e saldo residual rastreado');
})().catch(e => { console.error(e); process.exit(1); });
