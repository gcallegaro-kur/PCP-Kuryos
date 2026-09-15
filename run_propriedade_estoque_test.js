'use strict';
/* Propriedade do estoque por cliente (2026-09-15).
   1. Regras puras (public/shared/propriedade-estoque.js) e a cópia do servidor.
   2. As funções REAIS de shared/utils.js que mexem no saldo: consumo por dono,
      FEFO, fracionamento do lote, disponível para o cliente e o MRP.
   3. O servidor REAL (functions/index.js): recebimento recusa PC sem dono ou
      sem cliente/pedido, grava dono/destino no lote e parte o saldo;
      cancelamento e devolução desfazem na parte certa.
   A lição do repo: a unidade passar não prova a ligação. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const P = require('./public/shared/propriedade-estoque.js');
let n = 0;
const J = (x) => JSON.parse(JSON.stringify(x)); // valores criados no vm têm outro realm
function t(nome, fn) { fn(); n++; console.log('ok -', nome); }
async function ta(nome, fn) { await fn(); n++; console.log('ok -', nome); }

// ── Fixtures ─────────────────────────────────────────────────────────
const clientes = {MRAR: {nome: 'MISS ROSE'}, SEUNO: {nome: 'SEUNOURA'}, PROP: {nome: 'KURYOS PRÓPRIA'}};
const produtos = {
  MRARBS05: {clienteKey: 'MRAR', cliente: 'MISS RÔSE'}, MRARBS08: {clienteKey: 'MRAR'},
  KUBPBA01: {clienteKey: 'PROP'}, 'AGU-SEUN-0001': {cliente: 'Seunoura'}
};
const pedidos = {
  '0006__MRARBS05': {id: '0006', parentPedidoId: '0006', sku: 'MRARBS05', cliente: 'MISS RÔSE', status: 'Produção Parcial'},
  '6__MRARBS08': {id: '6', sku: 'MRARBS08', cliente: 'MISS RÔSE', status: 'Não Iniciado'},
  '0011__MRARBS08': {id: '0011', parentPedidoId: '0011', sku: 'MRARBS08', cliente: 'MISS RÔSE', status: 'Concluído'},
  '0012__MRARBS05': {id: '0012', sku: 'MRARBS05', status: 'Produção Parcial', statusManual: 'encerrado'},
  '26__AGU': {id: '26', sku: 'AGU-SEUN-0001', cliente: 'SEUNOURA', status: 'Não Iniciado'},
  'RET__MRARBS05': {id: 'RETRABALHO', sku: 'MRARBS05', status: 'Não Iniciado'},
  'RET__KUBPBA01 - 2': {id: 'RETRABALHO', sku: 'KUBPBA01 - 2', status: 'Não Iniciado'}
};

// ── 1. Regras ────────────────────────────────────────────────────────
t('dono pela natureza: compra é sempre Kuryos; remessa (cliente ou terceiro) é do cliente', () => {
  assert.equal(P.proprietarioDaNatureza('COMPRA_KURYOS'), 'KURYOS');
  assert.equal(P.proprietarioDaNatureza(undefined), 'KURYOS', 'PC de cotação não grava natureza');
  assert.equal(P.proprietarioDaNatureza('REMESSA_CLIENTE'), 'CLIENTE');
  assert.equal(P.proprietarioDaNatureza('REMESSA_TERCEIRO'), null);
  assert.equal(P.proprietarioPadraoDaNatureza('REMESSA_TERCEIRO'), 'CLIENTE');
  assert.equal(P.propriedadeDoPC({naturezaMovimentacao: 'REMESSA_TERCEIRO'}), 'CLIENTE', '"se é remessa, o estoque é do cliente"');
  assert.equal(P.propriedadeDoPC({naturezaMovimentacao: 'REMESSA_TERCEIRO', propriedade: {tipo: 'KURYOS'}}), 'KURYOS', 'exceção marcada por Compras');
  assert.equal(P.propriedadeDoPC({naturezaMovimentacao: 'REMESSA_CLIENTE', propriedade: {tipo: 'KURYOS'}}), 'CLIENTE', 'remessa do próprio cliente não tem exceção');
  assert.equal(P.propriedadeDoPC({naturezaMovimentacao: 'COMPRA_KURYOS', propriedade: {tipo: 'CLIENTE'}}), 'KURYOS', 'compra nunca vira do cliente');
});

t('PC só é recebível com dono e cliente + pedido em todo item', () => {
  const v = {clienteKey: 'MRAR', clienteNome: 'MISS ROSE', pedidos: ['0006']};
  assert.equal(P.validarVinculoPC({itens: {a: {materialCodigo: 'VAL-1', vinculo: v}}}).ok, true);
  const semPedido = P.validarVinculoPC({itens: {a: {materialCodigo: 'VAL-1', vinculo: {clienteKey: 'MRAR', pedidos: []}}}});
  assert.equal(semPedido.ok, false);
  assert.match(semPedido.pendencias[0], /VAL-1: informe o cliente e ao menos um pedido/);
  assert.equal(P.validarVinculoPC({naturezaMovimentacao: 'REMESSA_TERCEIRO', itens: {a: {vinculo: v}}}).ok, true,
    'terceiro não pede mais escolha de dono: nasce do cliente');
  assert.equal(P.validarVinculoPC({itens: {}}).ok, false);
  // Uso e consumo sem cliente nem pedido (caso real PC-0003, etiqueta): só na compra.
  const geral = {geral: true, clienteKey: null, pedidos: []};
  assert.equal(P.validarVinculoPC({itens: {a: {materialCodigo: 'ET-00064', vinculo: geral}}}).ok, true);
  const remessaGeral = P.validarVinculoPC({naturezaMovimentacao: 'REMESSA_TERCEIRO', itens: {a: {materialCodigo: 'VAL-1', vinculo: geral}}});
  assert.equal(remessaGeral.ok, false);
  assert.match(remessaGeral.pendencias[0], /material do cliente não pode ir para uso e consumo/);
  assert.equal(P.validarVinculoPC({naturezaMovimentacao: 'REMESSA_TERCEIRO', propriedade: {tipo: 'KURYOS'}, itens: {a: {vinculo: geral}}}).ok, true,
    'terceiro marcado como Kuryos pode ir para uso e consumo');
  assert.equal(P.vinculoGeral({geral: true, clienteKey: 'MRAR'}), false, 'geral com cliente é contradição, não conta');
  assert.match(P.validarVinculoPC({itens: {a: {materialCodigo: 'X'}}}).pendencias[0], /ou marque uso e consumo/);
  assert.equal(P.vinculoValido({clienteKey: 'X', pedidos: ['  ']}), false, 'pedido em branco não conta');
});

t('lote recebe snapshot de dono e destino', () => {
  const v = {clienteKey: 'MRAR', clienteNome: 'MISS ROSE', pedidos: ['0006', '0011']};
  assert.deepEqual(P.camposDoLote({naturezaMovimentacao: 'REMESSA_CLIENTE'}, {vinculo: v}), {
    propriedade: {tipo: 'CLIENTE', clienteKey: 'MRAR', clienteNome: 'MISS ROSE'},
    destino: {clienteKey: 'MRAR', clienteNome: 'MISS ROSE', pedidos: ['0006', '0011']}
  });
  assert.deepEqual(P.camposDoLote({}, {vinculo: v}).propriedade, {tipo: 'KURYOS', clienteKey: null, clienteNome: null},
    'compra para pedido do cliente continua sendo da Kuryos');
  assert.deepEqual(P.camposDoLote({naturezaMovimentacao: 'REMESSA_TERCEIRO'}, {vinculo: v}).propriedade,
    {tipo: 'CLIENTE', clienteKey: 'MRAR', clienteNome: 'MISS ROSE'}, 'remessa de terceiro sem escolha gravada: lote do cliente');
  assert.deepEqual(P.camposDoLote({}, {vinculo: {geral: true, pedidos: []}}), {
    propriedade: {tipo: 'KURYOS', clienteKey: null, clienteNome: null},
    destino: {geral: true, clienteKey: null, clienteNome: null, pedidos: []}
  });
});

t('uso do lote: Kuryos serve a todos, cliente só a ele; lote antigo é da Kuryos', () => {
  const doCliente = {propriedade: {tipo: 'CLIENTE', clienteKey: 'MRAR'}};
  assert.equal(P.loteUtilizavelPor(doCliente, 'MRAR'), true);
  assert.equal(P.loteUtilizavelPor(doCliente, 'SEUNO'), false);
  assert.equal(P.loteUtilizavelPor(doCliente, null), false, 'OP sem cliente conhecido não usa material de cliente');
  assert.equal(P.loteUtilizavelPor({}, 'SEUNO'), true);
  assert.equal(P.loteUtilizavelPor({propriedade: {tipo: 'KURYOS'}}, null), true);
  // Álcool comprado pela Kuryos vinculado ao pedido 0006 da Miss Rose atende a OP de qualquer cliente.
  assert.equal(P.loteUtilizavelPor({propriedade: {tipo: 'KURYOS'}, destino: {clienteKey: 'MRAR', pedidos: ['0006']}}, 'SEUNO'), true);
  assert.equal(P.prioridadeLote(doCliente, 'MRAR'), 0);
  assert.equal(P.prioridadeLote({}, 'MRAR'), 1);
});

t('duas vistas: propriedade do cliente × destinado ao cliente (posse Kuryos)', () => {
  const remessa = {propriedade: {tipo: 'CLIENTE', clienteKey: 'MRAR'}, destino: {clienteKey: 'MRAR', pedidos: ['0006']}};
  const compraPara = {propriedade: {tipo: 'KURYOS'}, destino: {clienteKey: 'MRAR', pedidos: ['0006']}};
  const geral = {};
  assert.equal(P.loteNaVista(remessa, 'MRAR', P.VISTA_PROPRIEDADE), true);
  assert.equal(P.loteNaVista(remessa, 'MRAR', P.VISTA_DESTINADO), false);
  assert.equal(P.loteNaVista(compraPara, 'MRAR', P.VISTA_DESTINADO), true);
  assert.equal(P.loteNaVista(compraPara, 'MRAR', P.VISTA_PROPRIEDADE), false);
  assert.equal(P.loteNaVista(compraPara, 'SEUNO', P.VISTA_DESTINADO), false);
  assert.equal(P.loteNaVista(geral, 'MRAR', P.VISTA_DESTINADO), false);
  assert.equal(P.loteNaVista(geral, '', P.VISTA_DESTINADO), true, 'sem cliente escolhido não filtra');
});

t('cliente pelo produto; variante "- 2"; nome sem acento como último recurso', () => {
  assert.equal(P.clienteKeyDoSku('MRARBS05', produtos), 'MRAR');
  assert.equal(P.clienteKeyDoSku('KUBPBA01 - 2', produtos), 'PROP');
  assert.equal(P.clienteKeyDoSku('AGU-SEUN-0001', produtos, clientes), 'SEUNO', 'produto sem clienteKey: nome do produto');
  assert.equal(P.clienteKeyDoSku('NAO-EXISTE', produtos, clientes, 'Miss Rose'), 'MRAR');
  assert.equal(P.clienteKeyDoSku('NAO-EXISTE', produtos, clientes, 'Outro'), null);
  // Caso real (pedido 26): SKU sem produto e nome curto que só os produtos usam.
  const prodSeun = Object.assign({}, produtos, {'BSP-SEUN-0001': {cliente: 'SEUNOURA', clienteKey: 'SEUNO'}});
  const cliSeun = {SEUNO: {nome: 'SEUNOURA BEAUTY LTDA'}};
  assert.equal(P.clienteKeyDoSku('HID-SEUN-0001', prodSeun, cliSeun, 'SEUNOURA'), 'SEUNO');
  const ambiguo = Object.assign({}, prodSeun, {X1: {cliente: 'SEUNOURA', clienteKey: 'OUTRO'}});
  assert.equal(P.clienteKeyDoSku('HID-SEUN-0001', ambiguo, cliSeun, 'SEUNOURA'), null, 'nome curto de dois clientes: não escolhe');
});

t('pedidos do cliente: agrupa por número, junta "6"/"0006", esconde concluído', () => {
  const abertos = P.pedidosDoCliente('MRAR', pedidos, produtos, clientes);
  assert.deepEqual(abertos.map((g) => g.id), ['RETRABALHO', '0006']);
  const p6 = abertos.find((g) => g.id === '0006');
  assert.deepEqual(p6.linhas.map((l) => l.sku).sort(), ['MRARBS05', 'MRARBS08'], '"6" e "0006" são o mesmo pedido');
  const todos = P.pedidosDoCliente('MRAR', pedidos, produtos, clientes, {incluirConcluidos: true});
  assert.deepEqual(todos.map((g) => g.id), ['RETRABALHO', '0006', '0012', '0011'], 'abertos primeiro');
  assert.equal(todos.find((g) => g.id === '0012').aberto, false, 'encerrado manual conta como concluído');
  assert.deepEqual(P.pedidosDoCliente('PROP', pedidos, produtos, clientes).map((g) => g.linhas.length), [1],
    'pedido de dois clientes aparece para cada um só com as próprias linhas');
  assert.deepEqual(P.pedidosDoCliente('', pedidos, produtos, clientes), []);
});

t('vínculo sugerido da solicitação: só com um cliente', () => {
  assert.deepEqual(P.vinculoSugeridoDasChavesPedido(['0006__MRARBS05', '6__MRARBS08', '0011__MRARBS08'], pedidos, produtos, clientes),
    {clienteKey: 'MRAR', clienteNome: 'MISS ROSE', pedidos: ['0006', '0011']});
  assert.equal(P.vinculoSugeridoDasChavesPedido(['0006__MRARBS05', '26__AGU'], pedidos, produtos, clientes), null, 'dois clientes: quem compra escolhe');
  assert.equal(P.vinculoSugeridoDasChavesPedido([], pedidos, produtos, clientes), null);
});

t('saldo agregado: total físico, geral e partes dos clientes', () => {
  assert.deepEqual(P.saldoPorDono({saldoAtual: 1000, porCliente: {MRAR: {saldoAtual: 300}, SEUNO: {saldoAtual: 0}}}),
    {total: 1000, geral: 700, porCliente: {MRAR: 300}});
  assert.deepEqual(P.saldoPorDono(null), {total: 0, geral: 0, porCliente: {}});
});

t('movimento no agregado: consumo sai primeiro do cliente, entrada vai para a parte dele', () => {
  const e = {saldoAtual: 1000, porCliente: {MRAR: {saldoAtual: 300}}};
  assert.deepEqual(P.aplicarMovimentoAgregado(e, -200, {clienteKeyConsumidor: 'MRAR'}), {clienteKey: 'MRAR', doCliente: 200, geral: 0});
  assert.deepEqual([e.saldoAtual, e.porCliente.MRAR.saldoAtual], [800, 100]);
  assert.deepEqual(P.aplicarMovimentoAgregado(e, -250, {clienteKeyConsumidor: 'MRAR'}), {clienteKey: 'MRAR', doCliente: 100, geral: 150});
  assert.deepEqual([e.saldoAtual, e.porCliente.MRAR.saldoAtual], [550, 0]);
  P.aplicarMovimentoAgregado(e, -50, {clienteKeyConsumidor: 'SEUNO'});
  assert.deepEqual([e.saldoAtual, e.porCliente.MRAR.saldoAtual], [500, 0], 'OP de outro cliente não toca a parte do MRAR');
  P.aplicarMovimentoAgregado(e, 400, {proprietarioClienteKey: 'SEUNO', clienteNome: 'SEUNOURA'});
  assert.deepEqual(e.porCliente.SEUNO, {saldoAtual: 400, clienteNome: 'SEUNOURA'});
  P.aplicarMovimentoAgregado(e, -150, {proprietarioClienteKey: 'SEUNO'});
  assert.equal(e.porCliente.SEUNO.saldoAtual, 250, 'estorno de entrada do cliente');
  assert.equal(e.saldoAtual, 750);
  const semParte = {saldoAtual: 10};
  P.aplicarMovimentoAgregado(semParte, -30, {clienteKeyConsumidor: 'MRAR'});
  assert.deepEqual(semParte, {saldoAtual: -20}, 'sem parte do cliente, tudo do geral (e o negativo aparece)');
});

t('MRP por dono: material do cliente cobre só a demanda dele; sobra não vai a outros', () => {
  const est = {saldoAtual: 1000, saldoEmpenhado: 100, porCliente: {MRAR: {saldoAtual: 400}}};
  const dem = [
    {data: '2026-09-20', qtd: 300, clienteKey: 'MRAR', refNome: 'A'},
    {data: null, qtd: 250, clienteKey: 'MRAR', refNome: 'B'},
    {data: '2026-09-18', qtd: 500, clienteKey: 'SEUNO', refNome: 'C'},
    {data: '2026-09-19', qtd: 50, clienteKey: null, refNome: 'D'}
  ];
  const rec = [{data: '2026-09-25', qtd: 100, proprietarioClienteKey: 'MRAR'}, {data: '2026-09-22', qtd: 700}];
  const r = P.repartirMrpPorDono(est, 100, dem, rec);
  assert.equal(r.disponivelGeral, 500, '1000 − 400 do cliente − 100 empenhado');
  assert.deepEqual(r.recebimentosGerais.map((x) => x.qtd), [700]);
  assert.deepEqual(r.cobertura, [{clienteKey: 'MRAR', estoque: 400, transito: 100, demanda: 550, coberto: 500, sobra: 0}]);
  assert.deepEqual(r.demandasGerais.map((d) => [d.refNome, d.qtd]), [['C', 500], ['D', 50], ['B', 50]], 'o que falta ao MRAR vai ao geral');
  const sobra = P.repartirMrpPorDono({saldoAtual: 900, porCliente: {MRAR: {saldoAtual: 800}}}, 0, [{qtd: 100, clienteKey: 'MRAR'}, {qtd: 600, clienteKey: 'SEUNO'}], []);
  assert.equal(sobra.cobertura[0].sobra, 700);
  assert.equal(sobra.disponivelGeral, 100, 'sobra do MRAR não vira disponível para o SEUNO');
  assert.deepEqual(sobra.demandasGerais.map((d) => d.qtd), [600]);
});

t('functions/propriedade_estoque.js é cópia byte a byte', () => {
  assert.equal(fs.readFileSync('functions/propriedade_estoque.js', 'utf8'), fs.readFileSync('public/shared/propriedade-estoque.js', 'utf8'),
    'mudou um, copie no outro e publique as Functions');
});

// ── 2. shared/utils.js real ─────────────────────────────────────────
function fakeDb(dados) {
  const partes = (p) => String(p || '').split('/').filter(Boolean);
  const get = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), dados);
  const set = (p, v) => {
    const ks = partes(p), last = ks.pop(); let o = dados;
    ks.forEach((k) => { o = o[k] || (o[k] = {}); });
    if (v === null || v === undefined) delete o[last]; else o[last] = v;
  };
  const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
  let seq = 0;
  const ref = (p) => ({
    key: partes(p).slice(-1)[0],
    once: async () => ({val: () => clone(get(p)), exists: () => get(p) != null}),
    set: async (v) => set(p, clone(v)),
    update: async (v) => { Object.entries(v).forEach(([k, val]) => set((p ? p + '/' : '') + k, clone(val))); },
    push(v) {
      const k = 'push' + (++seq); const r = ref(p + '/' + k);
      if (v === undefined) return r;
      return Promise.resolve(set(p + '/' + k, clone(v))).then(() => r);
    },
    // Fiel ao SDK: 1ª passada com o cache (null), depois o valor real.
    transaction: async (fn) => {
      let out = fn(null);
      if (out === undefined) return {committed: false, snapshot: {val: () => clone(get(p)), exists: () => get(p) != null}};
      if (get(p) != null) { out = fn(clone(get(p))); if (out === undefined) return {committed: false, snapshot: {val: () => clone(get(p))}}; }
      set(p, clone(out));
      return {committed: true, snapshot: {val: () => clone(get(p)), exists: () => get(p) != null}};
    }
  });
  return {ref, dados};
}

const ctx = {console: {log() {}, warn() {}, error() {}}, window: {}, document: undefined, setTimeout, Promise};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/shared/utils.js', 'utf8'), ctx, {filename: 'utils.js'});
vm.runInContext(fs.readFileSync('public/shared/propriedade-estoque.js', 'utf8'), ctx, {filename: 'propriedade-estoque.js'});
assert.ok(ctx.PropriedadeEstoque, 'módulo carregado como global no navegador');

(async () => {
  await ta('ajustarEstoque: consumo da OP do cliente sai da parte dele e registra no movimento', async () => {
    const db = fakeDb({estoque: {'VAL-1': {saldoAtual: 1000, porCliente: {MRAR: {saldoAtual: 300}}}}});
    await ctx.ajustarEstoque(db, 'VAL-1', -350, 'consumo_producao', '26254/01', {clienteKeyConsumidor: 'MRAR'});
    assert.equal(db.dados.estoque['VAL-1'].saldoAtual, 650);
    assert.equal(db.dados.estoque['VAL-1'].porCliente.MRAR.saldoAtual, 0);
    await new Promise((r) => setTimeout(r, 0));
    const mov = Object.values(db.dados.movimentos_estoque['VAL-1'])[0];
    assert.deepEqual(mov.propriedade, {clienteKey: 'MRAR', doCliente: 300, geral: 50});
    await ctx.ajustarEstoque(db, 'VAL-1', -100, 'consumo_producao', 'X', {});
    assert.equal(db.dados.estoque['VAL-1'].saldoAtual, 550, 'sem cliente: só o total, como sempre');
  });

  t('FEFO: material de cliente só para ele, e antes do geral; sem cliente, fica de fora', () => {
    const lotes = {
      k1: {itemCodigo: 'VAL-1', status: 'LIBERADO', saldoLote: 100, dataValidade: '2026-10-01', enderecoKey: 'A'},
      c1: {itemCodigo: 'VAL-1', status: 'LIBERADO', saldoLote: 80, dataValidade: '2027-01-01', enderecoKey: 'B', propriedade: {tipo: 'CLIENTE', clienteKey: 'MRAR'}},
      c2: {itemCodigo: 'VAL-1', status: 'LIBERADO', saldoLote: 500, dataValidade: '2026-09-20', enderecoKey: 'C', propriedade: {tipo: 'CLIENTE', clienteKey: 'SEUNO'}}
    };
    const mrar = ctx.sugerirAlocacaoFefo('VAL-1', 150, lotes, {}, {clienteKey: 'MRAR'});
    assert.deepEqual(J(mrar.alocacoes.map((a) => [a.loteKey, a.qtdSugerida, a.doCliente])), [['c1', 80, 'MRAR'], ['k1', 70, null]]);
    const outro = ctx.sugerirAlocacaoFefo('VAL-1', 1000, lotes, {}, {clienteKey: 'PROP'});
    assert.deepEqual(J(outro.alocacoes.map((a) => a.loteKey)), ['k1']);
    assert.equal(outro.faltante, 900, 'o SEUNO tem 500 parados, mas não servem');
    const semCliente = ctx.sugerirAlocacaoFefo('VAL-1', 1000, lotes, {});
    assert.deepEqual(J(semCliente.alocacoes.map((a) => a.loteKey)), ['k1'], 'chamada antiga, sem cliente: padrão seguro');
  });

  await ta('baixarLotesFefo repassa o cliente da OP', async () => {
    const db = fakeDb({enderecos_estoque: {}, estoque_lotes: {'VAL-1': {
      k1: {itemCodigo: 'VAL-1', status: 'LIBERADO', saldoLote: 100, dataValidade: '2026-10-01'},
      c1: {itemCodigo: 'VAL-1', status: 'LIBERADO', saldoLote: 80, dataValidade: '2027-01-01', propriedade: {tipo: 'CLIENTE', clienteKey: 'MRAR'}}
    }}});
    const r = await ctx.baixarLotesFefo(db, 'material', 'VAL-1', 90, 'CONSUMO', 'Ana', '26254/01', {clienteKey: 'MRAR'});
    assert.equal(r.baixado, 90);
    assert.equal(db.dados.estoque_lotes['VAL-1'].c1.saldoLote, 0);
    assert.equal(db.dados.estoque_lotes['VAL-1'].k1.saldoLote, 90);
  });

  await ta('separar parte do lote leva dono, destino e lote interno junto', async () => {
    const db = fakeDb({enderecos_estoque: {D: {codigo: 'DOC-1.1.1'}}, estoque_lotes: {'VAL-1': {
      c1: {itemCodigo: 'VAL-1', itemTipo: 'material', status: 'LIBERADO', saldoLote: 80, loteInterno: 'AK-2026-000600',
        propriedade: {tipo: 'CLIENTE', clienteKey: 'MRAR', clienteNome: 'MISS ROSE'}, destino: {clienteKey: 'MRAR', pedidos: ['0006']}}
    }}});
    const r = await ctx.separarParcialLoteEndereco(db, 'material', 'VAL-1', 'c1', 30, 'D', 'SEPARAÇÃO', 'Ana', '26254/01');
    const novo = db.dados.estoque_lotes['VAL-1'][r.novoLoteKey];
    assert.deepEqual(novo.propriedade, {tipo: 'CLIENTE', clienteKey: 'MRAR', clienteNome: 'MISS ROSE'});
    assert.deepEqual(novo.destino, {clienteKey: 'MRAR', pedidos: ['0006']});
    assert.equal(novo.loteInterno, 'AK-2026-000600');
  });

  t('disponível para o cliente: geral − empenho + parte dele; mesma conta do módulo', () => {
    const est = {saldoAtual: 1000, saldoEmpenhado: 100, porCliente: {MRAR: {saldoAtual: 300}, SEUNO: {saldoAtual: 200}}};
    assert.equal(ctx.disponivelParaCliente(est, 'MRAR'), 700);
    assert.equal(ctx.disponivelParaCliente(est, 'PROP'), 400);
    assert.equal(ctx.disponivelParaCliente(est, null), 400);
    assert.equal(ctx.disponivelParaCliente({saldoAtual: 50, saldoEmpenhado: 10}, 'MRAR'), 40, 'sem partes: total − empenho de sempre');
    assert.equal(ctx.disponivelParaCliente(est, 'MRAR'), P.saldoPorDono(est).geral - 100 + P.saldoPorDono(est).porCliente.MRAR);
    assert.equal(ctx.faltasParaSolicitacao({i: {mpCodigo: 'VAL-1', qtdNecessaria: 600}}, {'VAL-1': est}, 'SEUNO').itens.length, 0,
      'SEUNO: geral 500 − empenho 100 + parte 200 = 600 cobre 600');
    assert.equal(ctx.faltasParaSolicitacao({i: {mpCodigo: 'VAL-1', qtdNecessaria: 600}}, {'VAL-1': est}, 'MRAR').itens.length, 0, '700 cobre 600');
    assert.equal(ctx.faltasParaSolicitacao({i: {mpCodigo: 'VAL-1', qtdNecessaria: 600}}, {'VAL-1': est}, 'PROP').itens[0].falta, 200);
  });

  t('MRP sem material de cliente: plano idêntico ao de antes', () => {
    const mat = {mpCodigo: 'VAL-1', leadTimeDias: 7, loteMinimo: 500, multiplo: 100};
    const est = {saldoAtual: 1200, saldoEmpenhado: 150};
    const dem = [{data: '2026-09-21', qtd: 800, clienteKey: 'MRAR'}, {data: null, qtd: 900, clienteKey: 'SEUNO'}, {data: '2026-10-05', qtd: 400, clienteKey: null}];
    const rec = [{data: '2026-09-28', qtd: 300}];
    const antes = ctx.calcularMrpMaterial(mat, 1200 - 150, dem, rec, '2026-09-15');
    const rep = P.repartirMrpPorDono(est, est.saldoEmpenhado, dem, rec);
    const depois = ctx.calcularMrpMaterial(mat, rep.disponivelGeral, rep.demandasGerais, rep.recebimentosGerais, '2026-09-15');
    assert.deepEqual(JSON.parse(JSON.stringify(depois)), JSON.parse(JSON.stringify(antes)));
    assert.deepEqual(rep.cobertura, []);
  });

  // ── 3. Servidor real ────────────────────────────────────────────────
  const dados = {};
  const sdb = fakeDb(dados);
  // Update multipath fiel: aplica ServerValue.increment sobre o valor atual.
  const refOriginal = sdb.ref;
  sdb.ref = (p) => {
    const r = refOriginal(p);
    const updateOriginal = r.update;
    r.update = async (v) => {
      const plano = {};
      Object.entries(v).forEach(([k, val]) => {
        if (val && typeof val === 'object' && val['.sv'] && val['.sv'].increment != null) {
          const atual = String(p || '').split('/').concat(k.split('/')).filter(Boolean).reduce((o, c) => (o == null ? undefined : o[c]), dados);
          plano[k] = (Number(atual) || 0) + val['.sv'].increment;
        } else plano[k] = val;
      });
      return updateOriginal(plano);
    };
    return r;
  };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const fakeFunctions = new Proxy({}, {get: (_, nome) => {
    if (nome === 'HttpsError') return HttpsError;
    if (nome === 'defineSecret') return (s) => ({value: () => 'segredo-' + s});
    return (opts, handler) => ({opts, handler: handler || opts, tipo: nome});
  }});
  const fakeAdmin = {initializeApp() {}, database: Object.assign(() => sdb, {ServerValue: {increment: (x) => ({'.sv': {increment: x}})}})};
  const loadOriginal = Module._load;
  Module._load = function(req) {
    if (req === 'firebase-admin') return fakeAdmin;
    if (req.startsWith('firebase-functions')) return fakeFunctions;
    return loadOriginal.apply(this, arguments);
  };
  const index = require(path.join(__dirname, 'functions', 'index.js'));
  Module._load = loadOriginal;
  const auth = {uid: 'u1', token: {email: 'log@kuryos.com'}};
  const chamar = (fn, data) => index[fn].handler({auth, data});

  dados.usuarios = {u1: {nome: 'Logística', role: 'logistica'}};
  dados.enderecos_estoque = {DOC: {codigo: 'DOC-1.1.1', ativo: true}};
  dados.contadores_lote_interno = {2026: 700};
  const linha = (itemKey, qtd, lote) => ({itemKey, qtdRecebida: qtd, qtdVolumes: 1, qtdAmostragem: 1, tipoMaterial: 'EMBALAGEM',
    identificacaoMaterial: 'Válvula', skuFornecedor: 'F-1', loteOrigem: lote, certificadoFornecedor: 'SIM', condicoesEmbalagem: 5, enderecoKey: 'DOC'});
  const payload = (pedidoKey, idem, linhas) => ({pedidoKey, idempotencyKey: idem, data: '2026-09-15', notaFiscal: 'NF 1', condicoesVeiculo: 5, linhas});
  const vinc = {clienteKey: 'MRAR', clienteNome: 'MISS ROSE', pedidos: ['0006']};

  await ta('servidor recusa receber PC sem cliente/pedido, sem gravar nada', async () => {
    dados.pedidos_compra = {PCX: {status: 'ENVIADO', fornecedorNome: 'Flash', itens: {i1: {materialCodigo: 'VAL-1', qtd: 100, qtdRecebida: 0}}}};
    await assert.rejects(chamar('registrarRecebimento', payload('PCX', 'idem-sem-vinculo-001', [linha('i1', 10, 'L1')])),
      (e) => e.code === 'failed-precondition' && /Compras precisa completar/.test(e.message) && /VAL-1/.test(e.message));
    assert.equal(dados.estoque_lotes, undefined);
    assert.equal(dados.estoque, undefined);
  });

  await ta('remessa do cliente: lote do cliente e parte dele no agregado', async () => {
    dados.pedidos_compra.PCC = {status: 'ENVIADO', naturezaMovimentacao: 'REMESSA_CLIENTE', origemNome: 'Miss Rose',
      itens: {i1: {materialCodigo: 'VAL-1', materialNome: 'VÁLVULA', qtd: 100, qtdRecebida: 0, vinculo: vinc}}};
    const r = await chamar('registrarRecebimento', payload('PCC', 'idem-remessa-cliente-01', [linha('i1', 60, 'L1'), linha('i1', 40, 'L2')]));
    assert.equal(r.lotes.length, 2);
    const lote = dados.estoque_lotes['VAL-1'][r.lotes[0].loteKey];
    assert.deepEqual(lote.propriedade, {tipo: 'CLIENTE', clienteKey: 'MRAR', clienteNome: 'MISS ROSE'});
    assert.deepEqual(lote.destino, {clienteKey: 'MRAR', clienteNome: 'MISS ROSE', pedidos: ['0006']});
    assert.deepEqual(lote.recebimento.propriedade, lote.propriedade, 'a Qualidade vê de quem é');
    assert.equal(dados.estoque['VAL-1'].saldoAtual, 100);
    assert.equal(dados.estoque['VAL-1'].porCliente.MRAR.saldoAtual, 100);
    assert.equal(dados.estoque['VAL-1'].porCliente.MRAR.clienteNome, 'MISS ROSE');
  });

  await ta('compra da Kuryos para o pedido do cliente: lote da Kuryos com destino; total sem parte de cliente', async () => {
    dados.pedidos_compra.PCK = {status: 'ENVIADO', fornecedorNome: 'Flash', itens: {i1: {materialCodigo: 'VAL-1', qtd: 50, qtdRecebida: 0, vinculo: vinc}}};
    const r = await chamar('registrarRecebimento', payload('PCK', 'idem-compra-kuryos-001', [linha('i1', 50, 'L9')]));
    const lote = dados.estoque_lotes['VAL-1'][r.lotes[0].loteKey];
    assert.equal(lote.propriedade.tipo, 'KURYOS');
    assert.deepEqual(lote.destino.pedidos, ['0006']);
    assert.equal(dados.estoque['VAL-1'].saldoAtual, 150);
    assert.equal(dados.estoque['VAL-1'].porCliente.MRAR.saldoAtual, 100, 'compra não entra na parte do cliente');
  });

  await ta('compra de uso e consumo sem cliente nem pedido: recebe, lote da Kuryos com destino geral', async () => {
    dados.pedidos_compra.PCG = {status: 'ENVIADO', fornecedorNome: 'Flash', itens: {i1: {materialCodigo: 'ET-00064', qtd: 48, qtdRecebida: 0, vinculo: {geral: true, clienteKey: null, clienteNome: null, pedidos: []}}}};
    const r = await chamar('registrarRecebimento', payload('PCG', 'idem-uso-consumo-0001', [linha('i1', 48, 'ROLO-1')]));
    const lote = dados.estoque_lotes['ET-00064'][r.lotes[0].loteKey];
    assert.equal(lote.propriedade.tipo, 'KURYOS');
    assert.deepEqual(lote.destino, {geral: true, clienteKey: null, clienteNome: null, pedidos: []});
    assert.equal(dados.estoque['ET-00064'].saldoAtual, 48);
    assert.equal(dados.estoque['ET-00064'].porCliente, undefined);
  });

  await ta('cancelar recebimento do cliente devolve a parte dele; devolução também', async () => {
    const recC = Object.keys(dados.pedidos_compra.PCC.recebimentos)[0];
    await chamar('cancelarRecebimento', {pedidoKey: 'PCC', recebimentoKey: recC, motivo: 'lançado errado'});
    assert.equal(dados.estoque['VAL-1'].saldoAtual, 50);
    assert.equal(dados.estoque['VAL-1'].porCliente.MRAR.saldoAtual, 0);
    // nova remessa e devolução parcial
    const r = await chamar('registrarRecebimento', payload('PCC', 'idem-remessa-cliente-02', [linha('i1', 80, 'L3')]));
    const recKey = r.recebimentoKey;
    await chamar('registrarDevolucaoRecebimento', {pedidoKey: 'PCC', recebimentoKey: recKey, linhaKey: 'L001', quantidade: 30, motivo: 'avariado', idempotencyKey: 'idem-devolucao-0001'});
    assert.equal(dados.estoque['VAL-1'].saldoAtual, 100);
    assert.equal(dados.estoque['VAL-1'].porCliente.MRAR.saldoAtual, 50);
    const recK = Object.keys(dados.pedidos_compra.PCK.recebimentos)[0];
    await chamar('cancelarRecebimento', {pedidoKey: 'PCK', recebimentoKey: recK, motivo: 'errado'});
    assert.equal(dados.estoque['VAL-1'].saldoAtual, 50);
    assert.equal(dados.estoque['VAL-1'].porCliente.MRAR.saldoAtual, 50, 'cancelar compra da Kuryos não mexe no cliente');
  });

  console.log('\n' + n + ' casos ok');
})().catch((e) => { console.error(e); process.exit(1); });
