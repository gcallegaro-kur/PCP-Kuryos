/* Unidades por caixa na Conferência de PA.
   Caso real: a 26247/06 (GLMKAM01, 24 un/cx no cadastro e nas 10 OPs irmãs)
   foi contada com 48 un/cx -> 2.618 contra 1.661 apontados. Decisão do
   usuário: o campo NÃO pré-preenche (formato de caixa muda sem o cadastro
   acompanhar e valor pronto passa batido); quando diverge do cadastro, pede
   confirmação, registra na contagem e indica ajustar o cadastro.
   O teste cobre a regra E a ligação: salvar com divergência sem confirmar
   não pode gravar nada. */
const assert = require('assert');
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
    if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('Função incompleta: ' + name);
}

let respostaConfirm = true, confirmPerguntas = [], transacoes = [];
const ctx = {
  Math, parseFloat, parseInt, Object, String, Number, Promise, Date, Array, JSON,
  sanitizeKey: s => String(s).replace(/[.#$[\]\/]/g, '-'),
  allProdutos: {
    GLMKAM01: {sku: 'GLMKAM01', descricao: 'ÁGUA MICELAR 3 EM 1', unCx: 24},
    'chave-diferente': {sku: 'PRF-AFEE-0014', unCx: '12'},
    SEMCX: {sku: 'SEMCX', unCx: 0}
  },
  allEnderecosEstoque: {},
  escapeAttr: s => String(s), escapeHtml: s => String(s),
  confirm: msg => { confirmPerguntas.push(msg); return respostaConfirm; },
  currentUserNome: () => 'Logística Teste',
  showAlert: () => {}, document: {body: {removeChild: () => {}}},
  abrirConciliacaoPAModal: () => {},
  db: {ref: () => ({
    child: () => ({push: () => ({key: 'k' + transacoes.length})}),
    transaction: fn => { const r = fn(null); transacoes.push(r); return Promise.resolve({committed: true, snapshot: {val: () => r}}); }
  })}
};
vm.createContext(ctx);
['qtdApontadaPA', 'arredondarQtdPA', 'contagensDaConferenciaPA', 'analisarTriplaConferenciaPA', 'validarPaletesContagemPA',
 'unCxCadastroPA', 'paletesFormatoCaixaDivergentePA', 'linhaPaletePA', 'opcoesEnderecoPA', 'recalcularLinhaPaletePA', 'salvarContagemConferenciaPA']
  .forEach(name => vm.runInContext(extractFunction(name), ctx));

(async function () {
  // ── 1. Leitura do cadastro ─────────────────────────────────────────────
  assert.equal(ctx.unCxCadastroPA('GLMKAM01'), 24);
  assert.equal(ctx.unCxCadastroPA('PRF-AFEE-0014'), 12, 'acha pelo campo sku mesmo com chave diferente, e aceita texto');
  assert.equal(ctx.unCxCadastroPA('SEMCX'), null, 'zero no cadastro é "sem informação", não 0 un/cx');
  assert.equal(ctx.unCxCadastroPA('NAO-EXISTE'), null);

  // ── 2. Detecção de divergência ─────────────────────────────────────────
  const p = (n, un) => ({numero: n, unidadesPorCaixa: un});
  assert.deepEqual(ctx.paletesFormatoCaixaDivergentePA([p(1, 48), p(2, 24), p(3, null)], 24).map(x => x.numero), [1]);
  assert.deepEqual(ctx.paletesFormatoCaixaDivergentePA([p(1, 48)], null), [], 'sem cadastro não há contra o que divergir');

  // ── 3. O campo NÃO vem preenchido, e mostra o cadastro como referência ──
  const html = ctx.linhaPaletePA(1, 24);
  assert.ok(/class="cpa-multiplo"[^>]*placeholder="se aplicável"/.test(html));
  assert.ok(!/class="cpa-multiplo"[^>]*value=/.test(html), 'unidades por caixa não pode vir pré-preenchida');
  assert.ok(html.includes('data-uncx-cadastro="24"') && html.includes('Cadastro: 24 un/cx'));
  assert.ok(ctx.linhaPaletePA(1, null).includes('Produto sem un/cx no cadastro'));

  // ── 4. Aviso ao digitar ────────────────────────────────────────────────
  function linhaFake(caixas, multiplo, parcial) {
    const el = {
      '.cpa-caixas': {value: String(caixas)}, '.cpa-parcial': {value: String(parcial)}, '.cpa-total': {value: ''},
      '.cpa-multiplo': {value: String(multiplo), style: {}, getAttribute: () => '24'},
      '.cpa-uncx-hint': {innerHTML: ''}
    };
    return {el, querySelector: s => el[s]};
  }
  const errada = linhaFake(54, 48, 26); ctx.recalcularLinhaPaletePA(errada);
  assert.ok(errada.el['.cpa-uncx-hint'].innerHTML.includes('Diferente do cadastro (24 un/cx)'));
  assert.equal(errada.el['.cpa-total'].value, 2618, 'o total continua calculado com o que foi digitado');
  const certa = linhaFake(69, 24, 5); ctx.recalcularLinhaPaletePA(certa);
  assert.equal(certa.el['.cpa-uncx-hint'].innerHTML, 'Cadastro: 24 un/cx');
  assert.equal(certa.el['.cpa-multiplo'].style.borderColor, '');

  // ── 5. Ligação: salvar com divergência ─────────────────────────────────
  const op = {sku: 'GLMKAM01', lote: '26247/06', qtdProduzida: 1661, quantidadeProduzida: 1661};
  const box = {querySelector: () => ({disabled: false})};
  const paletes48 = () => [{numero: 1, caixasFechadas: 54, unidadesPorCaixa: 48, unidadesCaixaParcial: 26, qtdUnidades: 2618, enderecoKey: 'FAB-1-1-1'}];

  // 5a. Cancelar no confirm: NADA é gravado
  ctx.lerPaletesFormularioPA = paletes48; respostaConfirm = false; confirmPerguntas = []; transacoes = [];
  ctx.salvarContagemConferenciaPA('26247-06', op, {}, box, {});
  await new Promise(r => setImmediate(r));
  assert.equal(confirmPerguntas.length, 1, 'divergência tem que perguntar');
  assert.ok(confirmPerguntas[0].includes('diz 24') && confirmPerguntas[0].includes('Palete 1: 48 un/cx'));
  assert.ok(confirmPerguntas[0].includes('Cadastros › Produtos'), 'tem que indicar onde ajustar o cadastro');
  assert.equal(transacoes.length, 0, 'cancelar a confirmação não pode gravar a contagem');

  // 5b. Confirmar: grava, e a contagem guarda o cadastro e a divergência
  respostaConfirm = true; confirmPerguntas = []; transacoes = [];
  ctx.salvarContagemConferenciaPA('26247-06', op, {}, box, {});
  await new Promise(r => setImmediate(r));
  assert.equal(transacoes.length, 1, 'confirmado, grava');
  const palGravado = Object.values(Object.values(transacoes[0].contagens)[0].paletes)[0];
  assert.equal(palGravado.unidadesPorCaixa, 48, 'o que foi contado é o que fica');
  assert.equal(palGravado.unidadesPorCaixaCadastro, 24);
  assert.equal(palGravado.formatoCaixaDivergente, true);

  // 5c. Sem divergência: não pergunta nada
  ctx.lerPaletesFormularioPA = () => [{numero: 1, caixasFechadas: 69, unidadesPorCaixa: 24, unidadesCaixaParcial: 5, qtdUnidades: 1661, enderecoKey: 'FAB-1-1-1'}];
  confirmPerguntas = []; transacoes = [];
  ctx.salvarContagemConferenciaPA('26247-06', op, {}, box, {});
  await new Promise(r => setImmediate(r));
  assert.equal(confirmPerguntas.length, 0, 'formato igual ao cadastro não pode gerar pergunta');
  const palOk = Object.values(Object.values(transacoes[0].contagens)[0].paletes)[0];
  assert.equal(palOk.formatoCaixaDivergente, undefined);

  // ── 6. O consenso da tripla conferência compara TOTAL, não o palete ──────
  // Garante que os campos novos não quebram a recontagem em andamento.
  const antiga = {total: 1322, contadoEm: '1', paletes: {p1: {unidadesPorCaixa: 24}}};
  const nova = {total: 1322, contadoEm: '2', paletes: {p1: {unidadesPorCaixa: 24, unidadesPorCaixaCadastro: 24}}};
  const terceira = {total: 1322, contadoEm: '3', paletes: {p1: {unidadesPorCaixa: 24, unidadesPorCaixaCadastro: 24}}};
  assert.equal(ctx.analisarTriplaConferenciaPA(1661, [antiga, nova, terceira]).status, 'AGUARDANDO_CONCILIACAO',
    'contagem antiga sem os campos novos precisa convergir com as novas');

  console.log('run_conferencia_pa_uncx_test: OK');
})().catch(e => { console.error(e); process.exit(1); });
