'use strict';
/* Auditoria geral: toda gravação das telas vira evento (23/10/2026). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const A = require('./public/shared/auditoria-escritas.js');
const E = require('./public/shared/eventos-auditoria.js');

const eu = {uid: 'u1', nome: 'Diego Costa', role: 'logistica'};

// ── Classificação e filtros ──
assert.deepEqual(A.classificar('conferencias_pa/26295-01/status'), {modulo: 'Logística', rotulo: 'conferência de PA'});
assert.equal(A.classificar('ops/26295-01/qualidadePA').modulo, 'Qualidade');
assert.equal(A.classificar('ops/26295-01/manipulacao/pesagem/parcelas/m1/x').rotulo, 'pesagem');
assert.equal(A.classificar('ops/26295-01/dataFimReal').rotulo, 'ordem de produção');
assert.deepEqual(A.classificar('no_desconhecido/x'), {modulo: 'Outros', rotulo: 'no_desconhecido'});
assert.equal(A.loteDoCaminho('conferencias_pa/26295-01/status'), '26295/01');
assert.equal(A.loteDoCaminho('estoque/MP1'), null);
['auditoria_geral/2026-10-23/x', 'eventos_auditoria/d/x', 'contadores_lote_interno/a', 'recebimentos_locks/a', 'usuarios/u1/ultimoAcesso'].forEach((c) => assert.equal(A.ignorado(c), true, c));
['conferencias_pa/x', 'usuarios/u1/role', 'estoque/MP1'].forEach((c) => assert.equal(A.ignorado(c), false, c));

// ── Resumo seguro ──
assert.equal(A.resumir(null), 'apagado'); assert.equal(A.resumir(undefined), null); assert.equal(A.resumir(5), '5');
assert.equal(A.resumir({status: 'CONFERIDO', fotos: {a: 1}, nada: null}), 'status=CONFERIDO, fotos={…}, nada=apagado');
assert.ok(A.resumir({x: 'a'.repeat(5000)}).length <= 400);
assert.ok(A.resumir({a: 'b'.repeat(200)}).length < 80, 'texto longo é cortado');

// ── Evento de uma gravação ──
let ev = A.montarEvento({metodo: 'update', caminho: 'conferencias_pa/26295-01', valor: {status: 'CONFERIDO', conferidoPor: 'Diego Costa'}, usuario: eu, pagina: 'logistica.html', em: '2026-10-22T17:39:12.000Z'});
assert.equal(ev.registro.rotulo, 'conferência de PA'); assert.equal(ev.registro.modulo, 'Logística'); assert.equal(ev.registro.lote, '26295/01');
assert.equal(ev.registro.caminho, 'conferencias_pa/26295-01/status'); assert.equal(ev.registro.campos, 'status, conferidoPor');
assert.equal(ev.registro.porUid, 'u1'); assert.equal(ev.registro.porNome, 'Diego Costa'); assert.equal(ev.registro.pagina, 'logistica.html');
assert.equal(ev.dia, A.diaLocal(new Date('2026-10-22T17:39:12.000Z')));
// update multi-path na raiz: campos são caminhos, o log ignora nós internos
ev = A.montarEvento({metodo: 'update', caminho: '', valor: {'estoque/MP1/saldoAtual': 10, 'auditoria_geral/x': 1, 'ops/26295-01/status': 'Concluído'}, usuario: eu});
assert.equal(ev.registro.alvos, 2); assert.equal(ev.registro.caminho, 'estoque/MP1/saldoAtual'); assert.equal(ev.registro.resumo, null);
assert.equal(ev.registro.lote, '26295/01', 'acha o lote em qualquer alvo');
assert.equal(A.montarEvento({metodo: 'update', caminho: '', valor: {'auditoria_geral/x': 1}, usuario: eu}), null, 'só nós ignorados: nada a registrar');
assert.equal(A.montarEvento({metodo: 'set', caminho: 'contadores_lote_interno/a', valor: 1, usuario: eu}), null);
assert.equal(A.montarEvento({metodo: 'onDisconnect', caminho: 'a', usuario: eu}), null);
// remove não leva valor; nó sensível não leva valor
ev = A.montarEvento({metodo: 'remove', caminho: 'solicitacoes_descarte/s1', usuario: eu}); assert.equal(ev.registro.resumo, null); assert.equal(ev.registro.metodo, 'remove');
ev = A.montarEvento({metodo: 'set', caminho: 'usuarios/u2/role', valor: 'admin', usuario: eu}); assert.equal(ev.registro.resumo, null, 'usuários: sem valor no log'); assert.equal(ev.registro.modulo, 'Administração');
ev = A.montarEvento({metodo: 'set', caminho: 'rh_colaboradores/c1', valor: {salario: 1}, usuario: eu}); assert.equal(ev.registro.resumo, null);
// sem usuário: autor 'desconhecido'
assert.equal(A.montarEvento({metodo: 'set', caminho: 'estoque/a', valor: 1}).registro.porUid, 'desconhecido');

// ── Frase ──
assert.equal(E.descrever({acao: 'ALTERACAO', metodo: 'update', porNome: 'Diego Costa', rotulo: 'conferência de PA', lote: '26295/01', pagina: 'logistica.html'}),
  'Diego Costa alterou conferência de PA da OP 26295/01 (tela logistica).');
assert.match(E.descrever({acao: 'ALTERACAO', metodo: 'remove', porNome: 'Ana', rotulo: 'descarte'}), /Ana EXCLUIU descarte\./);

// ── Gancho: envolve set/update/push/remove/transaction, grava depois do sucesso ──
function fakeFirebase(resultados) {
  const gravados = [];
  class Ref {
    constructor(path) { this.path = path; }
    get root() { return new Ref(''); }
    toString() { return 'https://x.firebaseio.com/' + this.path; }
    child(p) { return new Ref((this.path ? this.path + '/' : '') + p); }
    set() { return resultados.set; }
    update() { return resultados.update; }
    remove() { return resultados.remove; }
    push(v) { if (this.path.startsWith('auditoria_geral/')) { gravados.push({dia: this.path.split('/')[1], v}); return Promise.resolve(); } const p = Promise.resolve(); p.key = 'k'; return p; }
    transaction() { return resultados.transaction; }
  }
  return {firebase: {database: {Reference: Ref}}, Ref, gravados};
}
(async () => {
  const falha = Promise.reject(new Error('PERMISSION_DENIED')); falha.catch(() => {});
  const f = fakeFirebase({
    set: Promise.resolve(), update: Promise.resolve(), remove: Promise.resolve(),
    transaction: Promise.resolve({committed: true, snapshot: {val: () => ({saldoAtual: 7})}})
  });
  let logado = true;
  assert.equal(A.instalar(f.firebase, () => ({usuario: logado ? eu : null, pagina: 'estoque.html'})), true);
  assert.equal(A.instalar(f.firebase, () => ({})), false, 'idempotente');
  const r = (p) => new f.Ref(p);
  await r('conferencias_pa/26295-01').update({status: 'CONFERIDO'});
  await r('estoque/MP1').set({saldoAtual: 5});
  await r('solicitacoes_descarte/s1').remove();
  await r('estoque/MP2').transaction(() => 1);
  await r('estoque_lotes/sku/p1').push({status: 'X'});
  r('estoque_lotes/sku').push();   // sem valor: só gera chave, não é gravação
  await new Promise((ok) => setTimeout(ok, 10));
  assert.deepEqual(f.gravados.map((g) => g.v.metodo).sort(), ['push', 'remove', 'set', 'transaction', 'update']);
  assert.equal(f.gravados.find((g) => g.v.metodo === 'transaction').v.resumo, 'saldoAtual=7');
  assert.ok(f.gravados.every((g) => g.v.porUid === 'u1' && g.v.pagina === 'estoque.html'));
  // gravação que falha NÃO vira evento
  const f2 = fakeFirebase({set: falha, update: falha, remove: falha, transaction: falha});
  A.instalar(f2.firebase, () => ({usuario: eu}));
  await new f2.Ref('estoque/a').set(1).catch(() => {});
  await new Promise((ok) => setTimeout(ok, 10));
  assert.equal(f2.gravados.length, 0, 'PERMISSION_DENIED não é movimentação');
  // sem login: não grava (as regras também recusariam)
  logado = false; const antes = f.gravados.length;
  await r('estoque/MP3').set(1); await new Promise((ok) => setTimeout(ok, 10));
  assert.equal(f.gravados.length, antes);
  // gravar no próprio log não gera evento do evento
  logado = true; await r('auditoria_geral/2026-10-23/x').set({a: 1}); await new Promise((ok) => setTimeout(ok, 10));
  assert.equal(f.gravados.length, antes);

  // ── Linha do tempo: junta o log geral e reconstrói a conferência de PA ──
  const t = E.linhaDoTempo({
    geral: {'2026-10-23': {a: {metodo: 'update', rotulo: 'pesagem', modulo: 'Manipulação', porNome: 'Ana', em: '2026-10-23T12:00:00.000Z', campos: 'peso'}}},
    conferencias: {'26295-01': {opLote: '26295/01', conferidoPor: 'Diego Costa', conferidoEm: '2026-10-22T17:39:12.171Z', qtdApontada: 196, ultimaContagem: 196, divergencia: 0, produto: 'ASAD', conciliacao: {motivo: 'RECONTAGEM_CONFERE_OP'}}}
  });
  assert.equal(t.length, 2); assert.equal(t[0].fonte, 'auditoria_geral'); assert.equal(t[0].acao, 'ALTERACAO');
  assert.equal(E.descrever(t[1]), 'Diego Costa conferiu o PA da OP 26295/01: apontado 196 un, contado 196 un (sem divergência).');
  assert.equal(E.filtrar(t, {modulo: 'Logística'}).length, 1); assert.equal(E.filtrar(t, {modulo: 'Manipulação'}).length, 1);
  assert.equal(E.filtrar(t, {busca: '2629501'}).length, 1, 'busca por lote sem barra');
  assert.equal(E.filtrar(t, {busca: 'diego'}).length, 1);

  // ── Ligações: regras do banco, carga na auth_check e tela ──
  const regras = fs.readFileSync('database.rules.json', 'utf8');
  const bloco = regras.slice(regras.indexOf('"auditoria_geral"'), regras.indexOf('"alertas_pendentes"'));
  assert.match(bloco, /\.read.*role'\)\.val\(\) == 'admin'/); assert.match(bloco, /!data\.exists\(\) && newData\.exists\(\)/); assert.match(bloco, /porUid.*auth\.uid/);
  const auth = fs.readFileSync('public/auth_check.js', 'utf8');
  assert.match(auth, /document\.write\('<script src="shared\/auditoria-escritas\.js">/); assert.match(auth, /AuditoriaEscritas\.instalar\(window\.firebase/);
  assert.ok(auth.indexOf('window.currentUser = {') < auth.indexOf('AuditoriaEscritas.instalar'), 'instala só depois de identificar o usuário');
  const tela = fs.readFileSync('public/shared/auditoria-tela.js', 'utf8');
  assert.match(tela, /lerGeral\(dias\)/); assert.match(tela, /conferencias_pa/); assert.match(tela, /modulo: el\('fModulo'\)/);
  assert.match(fs.readFileSync('public/auditoria.html', 'utf8'), /id="fModulo"/);
  console.log('run_auditoria_escritas_test: OK');
})().catch((e) => { console.error(e); process.exit(1); });
