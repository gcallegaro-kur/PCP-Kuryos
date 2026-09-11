const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/estoque.html', 'utf8');

function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Função não encontrada: ' + name);
  const open = source.indexOf('{', start);
  let depth = 0, quote = null, escaped = false;
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

const updatesAplicados = [];
const ctx = {
  Math, parseFloat, Object, String, Number, Promise, Date,
  sanitizeKey: s => String(s).replace(/[.#$[\]\/]/g, '-'),
  allEnderecosEstoque: { A1:{ codigo:'GAL-A1' }, A2:{ codigo:'GAL-A2' } },
  currentUserNome: () => 'Logística Teste',
  showAlert: () => {}, document: { body:{ removeChild:() => {} } },
  db: {}, functionsInstance: { httpsCallable: nome => payload => { updatesAplicados.push({ nome, payload }); return Promise.resolve({ data:{ diferenca:0 } }); } }
};
vm.createContext(ctx);
['qtdApontadaPA', 'arredondarQtdPA', 'contagensDaConferenciaPA', 'analisarTriplaConferenciaPA', 'validarPaletesContagemPA', 'finalizarConferenciaPA']
  .forEach(name => vm.runInContext(extractFunction(name), ctx));

function count(key, total, time) { return { key, total, contadoEm: time || key }; }
function expectStatus(contagens, status, extra) {
  const r = ctx.analisarTriplaConferenciaPA(1000, contagens);
  if (r.status !== status) throw new Error('Esperava ' + status + ', recebeu ' + r.status);
  if (extra) extra(r);
}

expectStatus([], 'AGUARDANDO_CONTAGEM', r => { if (r.etapa !== 1) throw new Error('Etapa inicial incorreta'); });
expectStatus([count('c1', 1000)], 'PRONTO_CONCILIADO', r => { if (r.diferenca !== 0) throw new Error('Conferência exata gerou diferença'); });
expectStatus([count('c1', 990)], 'DIVERGENCIA_RECONTAGEM', r => { if (r.etapa !== 2 || r.diferenca !== -10) throw new Error('Primeira divergência não abriu 2ª contagem'); });
expectStatus([count('c1', 990), count('c2', 1000)], 'DIVERGENCIA_RECONTAGEM', r => { if (r.etapa !== 3) throw new Error('Divergência não exigiu a 3ª contagem'); });
expectStatus([count('c1', 990), count('c2', 1000), count('c3', 1000)], 'PRONTO_CONCILIADO', r => { if (r.contagemAceita.key !== 'c3') throw new Error('Consenso com a OP escolheu contagem errada'); });
expectStatus([count('c1', 990), count('c2', 990), count('c3', 1000)], 'AGUARDANDO_CONCILIACAO', r => { if (r.total !== 990 || r.diferenca !== -10) throw new Error('Consenso físico divergente foi calculado errado'); });
expectStatus([count('c1', 990), count('c2', 995), count('c3', 1000)], 'SEM_CONVERGENCIA');
expectStatus([count('c1', 990), count('c2', 995), count('c3', 998), count('c4', 998)], 'AGUARDANDO_CONCILIACAO', r => { if (r.total !== 998) throw new Error('Contagem de desempate não usou as três últimas'); });

const original = { contagens: { b: { total: 2, contadoEm: '2026-01-02' }, a: { total: 1, contadoEm: '2026-01-01' } } };
const sorted = ctx.contagensDaConferenciaPA(original);
if (sorted[0].key !== 'a' || sorted[1].key !== 'b') throw new Error('Ordenação das contagens falhou');
if ('key' in original.contagens.a) throw new Error('Leitura das contagens alterou o objeto do Firebase');

const valid = [{ caixasFechadas:10, unidadesPorCaixa:48, unidadesCaixaParcial:20, qtdUnidades:500, enderecoKey:'A1' }];
if (ctx.validarPaletesContagemPA(valid)) throw new Error('Palete válido foi rejeitado');
if (!ctx.validarPaletesContagemPA([{ caixasFechadas:1, unidadesPorCaixa:48, unidadesCaixaParcial:48, qtdUnidades:96, enderecoKey:'A1' }])) throw new Error('Caixa parcial igual à cheia foi aceita');
if (!ctx.validarPaletesContagemPA([{ caixasFechadas:10, unidadesPorCaixa:48, unidadesCaixaParcial:20, qtdUnidades:499, enderecoKey:'A1' }])) throw new Error('Total incompatível com caixas foi aceito');

const salvar = extractFunction('salvarContagemConferenciaPA');
const finalizar = extractFunction('finalizarConferenciaPA');
if (salvar.includes("updates['estoque_lotes/")) throw new Error('Contagem divergente ainda consegue criar estoque antes da conciliação');
if (!finalizar.includes("httpsCallable('finalizarConferenciaPA')")) throw new Error('Finalização não foi delegada ao servidor');
if (source.includes("x.op.status === 'Aguardando Confirmação'")) throw new Error('OP sem confirmação definitiva do PCP apareceu na fila da Logística');
if (!source.includes("INICIO_FLUXO_CONFERENCIA_PA = '2026-09-10T00:00:00.000Z'") || !source.includes('String(x.op.dataFimReal || \'\') >= INICIO_FLUXO_CONFERENCIA_PA')) throw new Error('Fila voltaria a exibir as 1.251 OPs históricas sem WMS');

(async () => {
  const op = { sku:'PA-001', lote:'26247/06', produto:'Produto teste', produzidoLinha:1000 };
  const aceita = { key:'c3', total:1000, paletes:{ p1:valid[0], p2:{ caixasFechadas:10, unidadesPorCaixa:48, unidadesCaixaParcial:20, qtdUnidades:500, enderecoKey:'A2', numero:2 } } };
  const conf = { contagens:{ c1:{total:990}, c2:{total:1000}, c3:aceita }, alarmeAbertoEm:'2026-09-10T10:00:00.000Z' };
  await ctx.finalizarConferenciaPA('26247-06', op, conf, aceita, null, null);
  await ctx.finalizarConferenciaPA('26247-06', op, conf, aceita, null, null);
  if (updatesAplicados.length !== 2 || updatesAplicados.some(c => c.nome !== 'finalizarConferenciaPA' || c.payload.opKey !== '26247-06')) throw new Error('Cliente não delegou a finalização à função protegida');
  if (finalizar.includes('db.ref().update')) throw new Error('Navegador ainda consegue criar estoque diretamente');
  console.log('OK Conferência de PA: divergência bloqueia estoque; tripla contagem exige consenso; finalização delegada ao servidor.');
})().catch(err => { console.error(err); process.exit(1); });
