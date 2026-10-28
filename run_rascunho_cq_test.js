'use strict';
/* Rascunho do laudo da Qualidade (27/10/2026): shared/rascunho-cq.js puro. */
const assert = require('node:assert/strict');
const R = require('./public/shared/rascunho-cq.js');

// Chaves: PA por OP; lote avulso por item + lote; granel por OP; nada de . # $ [ ] /.
assert.equal(R.chaveLaudo('SKU1', 'pa_1', '26280-01'), 'pa_26280-01');
assert.equal(R.chaveLaudo('MPGR-001', 'L700'), 'lote_MPGR-001__L700');
assert.equal(R.chaveLaudo('A.B/C', 'x#y'), 'lote_A_B_C__x_y');
assert.equal(R.chaveGranel('26300-01'), 'granel_26300-01');

// Registro: conteúdo vai como TEXTO e volta igual, inclusive null dentro de lista
// (o RTDB descartaria) e chave com ponto.
const conteudo = {estado: {ck7: {pesos: [null, null, 12.5]}, resultados: {'pH 5.5': {valor: '5,6'}}}, campos: {qObservacao: 'mancha', qCertificado: true}};
const reg = R.montarRegistro('LAUDO', {itemCodigo: 'SKU1', loteKey: 'pa_1', opKey: null}, conteudo,
  {nome: 'Ana', uid: 'u1'}, '2026-10-27T14:32:00.000Z', null);
assert.equal(typeof reg.dados, 'string');
assert.deepEqual(R.ler(reg), conteudo);
assert.equal(reg.tipo, 'LAUDO');
assert.equal(reg.por, 'Ana'); assert.equal(reg.porUid, 'u1');
assert.equal(reg.iniciadoEm, '2026-10-27T14:32:00.000Z'); assert.equal(reg.iniciadoPor, 'Ana');
assert.equal(reg.itemCodigo, 'SKU1');
assert.ok(!('opKey' in reg), 'id nulo não vira campo');

// Quem continua mantém o início e o autor original; atualiza quem salvou por último.
const reg2 = R.montarRegistro('LAUDO', {}, conteudo, {nome: 'Bia', uid: 'u2'}, '2026-10-27T15:00:00.000Z', reg);
assert.equal(reg2.iniciadoEm, '2026-10-27T14:32:00.000Z'); assert.equal(reg2.iniciadoPor, 'Ana');
assert.equal(reg2.por, 'Bia'); assert.equal(reg2.atualizadoEm, '2026-10-27T15:00:00.000Z');

// Grande demais: não monta (a regra do banco recusaria).
assert.equal(R.montarRegistro('LAUDO', {}, {x: 'a'.repeat(R.TAMANHO_MAX)}, {}, 'agora', null), null);

// Registro corrompido ou vazio não trava a abertura.
assert.equal(R.ler(null), null);
assert.equal(R.ler({dados: '{quebrado'}), null);
assert.equal(R.ler({dados: '"texto"'}), null);
assert.equal(R.ler({}), null);

// Rótulo da fila.
assert.match(R.rotulo(reg2), /^Em preenchimento — Bia, salvo \d\d\/10 \d\d:\d\d$/);
assert.equal(R.rotulo(null), '');
assert.equal(R.horaCurta('lixo'), '');

// Campos do formulário: pega valor/checkbox por id; pula desabilitado, arquivo e ignorados.
const el = (id, extra) => Object.assign({id: id, value: '', type: 'text', disabled: false, checked: false}, extra);
const els = [el('qObservacao', {value: 'mancha'}), el('qCertificado', {type: 'checkbox', checked: true}),
  el('qCondVeiculo', {value: '4', disabled: true}), el('qFoto', {type: 'file', value: 'C:\\x.jpg'}), el('qCk7PesoQtd', {value: '32'})];
const raiz = {
  querySelectorAll: () => els,
  querySelector: (sel) => els.find((e) => '#' + e.id === sel) || null
};
assert.deepEqual(R.coletarCampos(raiz, ['qCk7PesoQtd']), {qObservacao: 'mancha', qCertificado: true});
els[0].value = ''; els[1].checked = false;
R.aplicarCampos(raiz, {qObservacao: 'de volta', qCertificado: true, qCondVeiculo: '1', qNaoExiste: 'x', qCk7PesoQtd: null});
assert.equal(els[0].value, 'de volta'); assert.equal(els[1].checked, true);
assert.equal(els[2].value, '4', 'campo da Logística (desabilitado) não é sobrescrito');
assert.equal(els[4].value, '', 'null vira vazio');

// Gravação adiada com relógio falso.
(async () => {
  let agora = 0, timers = [], salvos = 0;
  const rel = {set: (fn, ms) => { const t = {fn, em: agora + ms}; timers.push(t); return t; },
    clear: (t) => { timers = timers.filter((x) => x !== t); }};
  const avancar = async (ms) => { agora += ms; const vencidos = timers.filter((t) => t.em <= agora); timers = timers.filter((t) => t.em > agora); for (const t of vencidos) await t.fn(); };
  const a = R.criarAutosave(() => { salvos++; }, 800, rel);
  a.agendar(); await avancar(500); a.agendar(); await avancar(500);
  assert.equal(salvos, 0, 'cada tecla reagenda');
  await avancar(300);
  assert.equal(salvos, 1, 'grava uma vez depois da pausa');
  assert.equal(await a.agora(), false, 'nada pendente, nada gravado');
  a.agendar();
  // agora() chama salvar NA HORA (antes do próximo microtask): o popup zera o laudo logo depois.
  let capturado = null, laudo = {obs: 'x'};
  const b = R.criarAutosave(() => { capturado = laudo && laudo.obs; }, 800, rel);
  b.agendar(); const p = b.agora(); laudo = null; await p;
  assert.equal(capturado, 'x');
  assert.equal(await a.agora(), true); assert.equal(salvos, 2);
  a.agendar(); a.cancelar(); await avancar(5000);
  assert.equal(salvos, 2, 'cancelar (decisão registrada) não grava');
  assert.equal(a.pendente(), false);
  const c = R.criarAutosave(() => { throw new Error('sem rede'); }, 800, rel);
  c.agendar();
  await assert.rejects(c.agora(), /sem rede/);
  console.log('OK rascunho do laudo: chaves, texto JSON fiel, autor/início, limite, campos e gravação adiada.');
})().catch((e) => { console.error(e); process.exit(1); });
