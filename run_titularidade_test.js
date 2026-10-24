'use strict';
/* Alterar titularidade do estoque: regra pura, a Cloud Function real (permissão,
   transaction, idempotência) e a coerência entre as cópias do módulo. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const T = require('./functions/titularidade');
const PE = require('./functions/propriedade_estoque');

assert.equal(fs.readFileSync('public/shared/titularidade.js', 'utf8'), fs.readFileSync('functions/titularidade.js', 'utf8'), 'cópia de functions/ igual à de public/shared/');
assert.equal(fs.readFileSync('public/shared/propriedade-estoque.js', 'utf8'), fs.readFileSync('functions/propriedade_estoque.js', 'utf8'));

const AGORA = '2026-10-24T15:00:00.000Z';
const ctx = {autor: 'Gustavo', uid: 'u1', agora: AGORA};
function base() {
  return {
    usuarios: {u1: {role: 'admin', nome: 'Gustavo'}, u2: {role: 'logistica', nome: 'Carlos'}, u3: {role: 'pcp', nome: 'Diretor', modulos: {titularidade: true}}},
    clientes: {MISS: {nome: 'MISS ROSE'}, FEB: {nome: 'FEBELLA BEAUTY'}},
    estoque: {
      'ET-1': {materialCodigo: 'ET-1', materialNome: 'CAIXA', unidade: 'un', saldoAtual: 2000, porCliente: {MISS: {clienteNome: 'MISS ROSE', saldoAtual: 500}}},
      'ET-69': {materialCodigo: 'ET-69', materialNome: 'CAIXA ARABE', unidade: 'un', saldoAtual: 1605, porCliente: {MISS: {clienteNome: 'MISS ROSE', saldoAtual: 1605}}}
    },
    estoque_lotes: {
      'ET-1': {
        a: {itemTipo: 'material', itemCodigo: 'ET-1', saldoLote: 1500, unidade: 'un', loteInterno: 'AK-1', enderecoKey: 'GAL-1', enderecoCodigo: 'GAL-1', status: 'QUARENTENA',
          propriedade: {tipo: 'KURYOS'}, destino: {clienteKey: 'FEB', clienteNome: 'FEBELLA BEAUTY', pedidos: ['PED-1']}, dataValidade: '2027-01-01', recebimento: {x: 1}},
        b: {itemTipo: 'material', itemCodigo: 'ET-1', saldoLote: 500, unidade: 'un', loteInterno: 'AK-2', enderecoKey: 'GAL-2', status: 'LIBERADO',
          propriedade: {tipo: 'CLIENTE', clienteKey: 'MISS', clienteNome: 'MISS ROSE'}}
      }
    },
    movimentos_estoque: {}
  };
}
const op = (extra) => Object.assign({itemKey: 'ET-1', loteKey: 'a', qtd: 1500, novoDono: {tipo: 'CLIENTE', clienteKey: 'FEB'}, motivo: 'Cliente comprou o lote',
  operacaoKey: 'op-000001', movKey: 'mov-0001', novoLoteKey: 'novo-0001'}, extra || {});
function aplicar(b, plano) {
  for (const [path, value] of Object.entries(plano.updates)) {
    const partes = path.split('/'); let n = b;
    for (const p of partes.slice(0, -1)) n = n[p] || (n[p] = {});
    n[partes[partes.length - 1]] = value;
  }
  return b;
}
const erro = (fn, rx, code) => assert.throws(fn, (e) => rx.test(e.message) && (!code || e.code === code), 'esperava ' + rx);

// 1. Lote inteiro, Kuryos -> cliente: o lote muda de dono no mesmo lugar; saldo total intacto.
{
  const b = base(), antes = b.estoque['ET-1'].saldoAtual;
  const p = T.preparar(b, op(), ctx); aplicar(b, p);
  assert.deepEqual(b.estoque_lotes['ET-1'].a.propriedade, {tipo: 'CLIENTE', clienteKey: 'FEB', clienteNome: 'FEBELLA BEAUTY'});
  assert.equal(b.estoque_lotes['ET-1'].a.saldoLote, 1500); assert.equal(b.estoque_lotes['ET-1'].a.enderecoKey, 'GAL-1');
  assert.deepEqual(b.estoque_lotes['ET-1'].a.destino.pedidos, ['PED-1'], 'o destino não é tocado');
  assert.equal(b.estoque['ET-1'].saldoAtual, antes, 'o total físico não muda');
  assert.equal(b.estoque['ET-1'].porCliente.FEB.saldoAtual, 1500);
  assert.equal(b.estoque['ET-1'].porCliente.MISS.saldoAtual, 500, 'outros clientes intactos');
  assert.deepEqual([PE.saldoPorDono(b.estoque['ET-1']).geral, p.parcial], [0, false], 'a Kuryos fica com 0 do geral');
  const mv = b.movimentos_estoque['ET-1']['mov-0001'];
  assert.deepEqual([mv.tipo, mv.qtd, mv.loteKey, mv.autor], ['troca_titularidade', 1500, 'a', 'Gustavo']);
  assert.match(mv.ref, /Kuryos \(estoque geral\) -> FEBELLA BEAUTY · Cliente comprou o lote/);
  assert.equal(b.estoque['ET-1'].trocasTitularidade['op-000001'].por, 'Gustavo');
  assert.equal(b.estoque['ET-1'].ultimaMovimentacao, undefined, 'não mexe na última movimentação do saldo');
}
// 2. Parcial: divide o lote no mesmo endereço; o pedaço novo herda lote, validade, quarentena e destino.
{
  const b = base();
  const p = T.preparar(b, op({qtd: 400}), ctx); aplicar(b, p);
  const a = b.estoque_lotes['ET-1'].a, n = b.estoque_lotes['ET-1']['novo-0001'];
  assert.deepEqual([a.saldoLote, n.saldoLote, n.qtdOriginal], [1100, 400, 400]);
  assert.deepEqual([n.enderecoKey, n.loteInterno, n.status, n.dataValidade, n.origemTipo, n.origemRef], ['GAL-1', 'AK-1', 'QUARENTENA', '2027-01-01', 'titularidade', 'a']);
  assert.equal(n.propriedade.clienteKey, 'FEB'); assert.equal(a.propriedade.tipo, 'KURYOS');
  assert.deepEqual(n.destino.pedidos, ['PED-1']); assert.equal(n.recebimento, undefined, 'não copia o bloco do recebimento');
  assert.equal(b.estoque['ET-1'].porCliente.FEB.saldoAtual, 400);
  assert.equal(p.parcial, true); assert.equal(p.novoLoteKey, 'novo-0001');
}
// 3. Cliente -> Kuryos devolve ao geral; cliente -> outro cliente move entre as partes.
{
  const b = base(); aplicar(b, T.preparar(b, op({loteKey: 'b', qtd: 500, novoDono: {tipo: 'KURYOS'}}), ctx));
  assert.deepEqual(b.estoque_lotes['ET-1'].b.propriedade, {tipo: 'KURYOS'});
  assert.equal(b.estoque['ET-1'].porCliente.MISS.saldoAtual, 0);
  assert.equal(PE.saldoPorDono(b.estoque['ET-1']).geral, 2000, 'o geral volta a ter tudo');
  const c = base(); aplicar(c, T.preparar(c, op({loteKey: 'b', qtd: 200, novoDono: {tipo: 'CLIENTE', clienteKey: 'FEB'}}), ctx));
  assert.deepEqual([c.estoque['ET-1'].porCliente.MISS.saldoAtual, c.estoque['ET-1'].porCliente.FEB.saldoAtual], [300, 200]);
}
// 4. Sem lote (ET-69: 1.605 da MISS, nenhum lote): só o agregado muda; limitado ao que não está em lotes.
{
  const b = base();
  const p = T.preparar(b, op({itemKey: 'ET-69', loteKey: null, donoAtual: {tipo: 'CLIENTE', clienteKey: 'MISS'}, qtd: 605, novoDono: {tipo: 'KURYOS'}}), ctx); aplicar(b, p);
  assert.equal(b.estoque['ET-69'].porCliente.MISS.saldoAtual, 1000);
  assert.deepEqual([PE.saldoPorDono(b.estoque['ET-69']).geral, b.estoque['ET-69'].saldoAtual], [605, 1605]);
  assert.match(p.resumo, /saldo sem lote/);
  // parte do cliente que já está em lote não pode ser trocada "sem lote"
  erro(() => T.preparar(base(), op({loteKey: null, donoAtual: {tipo: 'CLIENTE', clienteKey: 'MISS'}, qtd: 100, novoDono: {tipo: 'KURYOS'}}), ctx), /sem lote/);
}
// 5. Recusas.
erro(() => T.preparar(base(), op({qtd: 0}), ctx), /maior que zero/, 'invalid-argument');
erro(() => T.preparar(base(), op({qtd: 1600}), ctx), /passa do saldo do lote/);
erro(() => T.preparar(base(), op({motivo: 'ok'}), ctx), /motivo/, 'invalid-argument');
erro(() => T.preparar(base(), op({novoDono: {tipo: 'KURYOS'}}), ctx), /já é de Kuryos/);
erro(() => T.preparar(base(), op({loteKey: 'b', qtd: 500, novoDono: {tipo: 'CLIENTE', clienteKey: 'MISS'}}), ctx), /já é de MISS ROSE/);
erro(() => T.preparar(base(), op({novoDono: {tipo: 'CLIENTE', clienteKey: 'NAO-EXISTE'}}), ctx), /Cliente não encontrado/, 'invalid-argument');
erro(() => T.preparar(base(), op({novoDono: {tipo: 'OUTRO'}}), ctx), /novo dono/, 'invalid-argument');
erro(() => T.preparar(base(), op({loteKey: 'zzz'}), ctx), /lote não existe/);
erro(() => T.preparar(base(), op({itemKey: 'NADA'}), ctx), /não tem saldo registrado/);
erro(() => T.preparar(base(), op({operacaoKey: 'x'}), ctx), /Identificador/, 'invalid-argument');
erro(() => T.preparar(base(), op({qtd: 100, novoLoteKey: ''}), ctx), /novo lote/, 'invalid-argument');
{
  const b = base(); b.estoque_lotes['ET-1'].a.itemTipo = 'produto';
  erro(() => T.preparar(b, op(), ctx), /produto acabado/);
  const c = base(); c.estoque['ET-1'].porCliente.MISS.saldoAtual = 100;      // agregado menor que o lote do cliente
  erro(() => T.preparar(c, op({loteKey: 'b', qtd: 500, novoDono: {tipo: 'KURYOS'}}), ctx), /Corrija o saldo/);
  const d = base(); d.estoque['ET-1'].saldoAtual = 1200;                     // geral < quantidade
  erro(() => T.preparar(d, op({qtd: 1500}), ctx), /Corrija o saldo/);
}
// 6. Idempotência: repetir a mesma operação não faz nada.
{
  const b = base(); aplicar(b, T.preparar(b, op(), ctx));
  const r = T.preparar(b, op({movKey: 'mov-0002'}), ctx);
  assert.deepEqual([r.ja, Object.keys(r.updates).length], [true, 0]);
}

// 7. A Cloud Function real: só admin ou quem tem o módulo; transaction; idempotência; revogação no meio.
async function handler() {
  let state = base(), race = null, pushes = 0;
  const db = {ref(path = '') {
    return {
      once: async () => ({val: () => path ? path.split('/').reduce((n, k) => n && n[k], state) : structuredClone(state)}),
      push() { pushes++; return {key: 'pk' + String(pushes).padStart(6, '0')}; },
      transaction: async (cb) => {
        assert.equal(cb(null), null);
        let result = cb(structuredClone(state));
        if (race) { race(state); race = null; result = cb(structuredClone(state)); }
        if (result) { state = result; return {committed: true}; }
        return {committed: false};
      }
    };
  }};
  db.ref = ((orig) => (p) => { const r = orig(p); if (!p) r.push = () => { pushes++; return {key: 'pk' + String(pushes).padStart(6, '0')}; }; return r; })(db.ref);
  const src = fs.readFileSync('functions/index.js', 'utf8');
  const code = src.slice(src.indexOf('exports.alterarTitularidadeEstoque ='), src.indexOf('// fim titularidade'));
  const sandbox = {exports: {}, db, Titularidade: T, onCall: (_, fn) => fn, HttpsError: class extends Error { constructor(c, m) { super(m); this.code = c; } },
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [AGORA])); } }};
  vm.runInNewContext(code, sandbox);
  const h = sandbox.exports.alterarTitularidadeEstoque;
  const req = (uid, data) => ({auth: uid ? {uid, token: {}} : null, data});
  await assert.rejects(() => h(req(null, op())), /Faça login/);
  await assert.rejects(() => h(req('u2', op())), (e) => e.code === 'permission-denied' && /administrador/.test(e.message));
  assert.equal(state.estoque_lotes['ET-1'].a.propriedade.tipo, 'KURYOS', 'logística não alterou nada');
  const r = await h(req('u1', op({qtd: 400})));
  assert.deepEqual([r.ok, r.ja, r.qtd], [true, false, 400]);
  assert.equal(state.estoque_lotes['ET-1'].a.saldoLote, 1100);
  const filhos = Object.keys(state.estoque_lotes['ET-1']).filter((k) => k !== 'a' && k !== 'b');
  assert.equal(filhos.length, 1); assert.equal(state.estoque_lotes['ET-1'][filhos[0]].saldoLote, 400);
  assert.equal(state.estoque['ET-1'].porCliente.FEB.saldoAtual, 400);
  assert.equal(Object.values(state.movimentos_estoque['ET-1']).length, 1);
  const r2 = await h(req('u1', op({qtd: 400})));                 // mesma operacaoKey: nada de novo
  assert.equal(r2.ja, true);
  assert.equal(state.estoque_lotes['ET-1'].a.saldoLote, 1100); assert.equal(Object.keys(state.estoque_lotes['ET-1']).length, 3);
  const r3 = await h(req('u3', op({operacaoKey: 'op-000002', loteKey: 'b', qtd: 500, novoDono: {tipo: 'KURYOS'}})));   // módulo concedido
  assert.equal(r3.ok, true); assert.equal(state.estoque_lotes['ET-1'].b.propriedade.tipo, 'KURYOS');
  race = (s) => { s.usuarios.u1.role = 'logistica'; };                                                                    // revogado no meio
  await assert.rejects(() => h(req('u1', op({operacaoKey: 'op-000003', qtd: 100, novoDono: {tipo: 'CLIENTE', clienteKey: 'MISS'}}))), /revogada/);
  await assert.rejects(() => h(req('u3', op({operacaoKey: 'op-000004', qtd: 99999}))), (e) => e.code === 'failed-precondition' && /passa do saldo/.test(e.message));
  assert.equal(PE.saldoPorDono(state.estoque['ET-1']).total, 2000, 'o total físico nunca mudou em nenhuma troca');
}
handler().then(() => console.log('OK titularidade: regra (inteiro, parcial, sem lote, recusas, idempotência), cópias iguais e Cloud Function com permissão, transaction e revogação.'))
  .catch((e) => { console.error(e); process.exit(1); });
