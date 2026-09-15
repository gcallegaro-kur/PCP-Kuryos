/* Seletor visual de endereço: regras puras (public/shared/seletor-endereco.js).
   Decisões do usuário (2026-09-15): Doca é área de passagem com vários
   paletes; posição comum é um palete, que pode ter mais de um produto. */
const assert = require('assert');
const path = require('path');
const S = require(path.join(__dirname, 'public', 'shared', 'seletor-endereco.js'));

const enderecos = {
  'DOC-1-1-1': {area: 'DOCA', codigo: 'DOC-1.1.1', rua: 1, predio: 1, nivel: 1, ativo: true},
  'GAL-1-1-1': {area: 'GALPÃO', codigo: 'GAL-1.1.1', rua: 1, predio: 1, nivel: 1, ativo: true},
  'GAL-1-1-2': {area: 'GALPÃO', codigo: 'GAL-1.1.2', rua: 1, predio: 2, nivel: 1, ativo: true},
  'GAL-1-2-2': {area: 'GALPÃO', codigo: 'GAL-1.2.2', rua: 1, predio: 2, nivel: 2, ativo: true},
  'GAL-4-1-22': {area: 'GALPÃO', codigo: 'GAL-4.1.22', rua: 4, predio: 22, nivel: 1, ativo: true},
  'GAL-9-9-9': {area: 'GALPÃO', codigo: 'GAL-9.9.9', rua: 9, predio: 9, nivel: 9, ativo: false},
  'FAB-1-1-1': {area: 'FÁBRICA', codigo: 'FAB-1.1.1', rua: 1, predio: 1, nivel: 1, ativo: true},
  // endereço do legado da planilha: rua/prédio/nível 999 e área sem acento
  HISTORICO: {area: 'GALPAO', codigo: 'HISTORICO', rua: 999, predio: 999, nivel: 999, ativo: true, legado: true},
  ROT: {area: 'RÓTULOS', codigo: 'ROT-1.1.1', rua: 1, predio: 1, nivel: 1}
};
const lotes = {
  'MP-1': {a: {itemCodigo: 'MP-1', itemNome: 'Frasco', saldoLote: 500, enderecoKey: 'GAL-1-1-1', status: 'LIBERADO', itemTipo: 'material'},
           zerado: {itemCodigo: 'MP-1', saldoLote: 0, enderecoKey: 'GAL-1-1-2'}},
  'MP-2': {b: {itemCodigo: 'MP-2', itemNome: 'Tampa', saldoLote: 300, enderecoKey: 'GAL-1-1-1', status: 'LIBERADO', itemTipo: 'material'},
           d: {itemCodigo: 'MP-2', saldoLote: 10, enderecoKey: 'DOC-1-1-1', status: 'QUARENTENA'}},
  PA1: {p: {itemCodigo: 'PA1', saldoLote: 100, enderecoKey: 'DOC-1-1-1', itemTipo: 'produto', status: 'LIBERADO_EXPEDICAO'}}
};

// ── 1. Doca ─────────────────────────────────────────────────────────────
assert.equal(S.ehDoca({area: 'Doca'}), true, 'sem diferenciar maiúscula');
assert.equal(S.ehDoca({area: 'DÓCA'}), true, 'sem diferenciar acento');
assert.equal(S.ehDoca({area: 'GALPÃO'}), false);
assert.equal(S.ehDoca(null), false);
assert.equal(S.docaPadrao(enderecos), 'DOC-1-1-1');
assert.equal(S.docaPadrao({G: enderecos['GAL-1-1-1']}), '', 'sem Doca cadastrada: vazio, a tela pede escolha');
assert.equal(S.docaPadrao({D: {area: 'DOCA', codigo: 'DOC-1.1.1', ativo: false}}), '', 'Doca inativa não é padrão');

// ── 2. Áreas desenhadas ─────────────────────────────────────────────────
const areas = S.areas(enderecos);
assert.deepEqual(areas.map(a => a.nome), ['DOCA', 'GALPÃO', 'FÁBRICA', 'RÓTULOS'], 'Doca, Galpão, Fábrica e as demais');
const gal = areas[1];
assert.equal(gal.total, 4, 'inativa e legado fora do mapa');
assert.deepEqual(gal.ruas.map(r => r.rua), [1, 4]);
assert.equal(gal.ruas[0].predios, 2); assert.equal(gal.ruas[0].niveis, 2);
assert.equal(gal.ruas[1].predios, 22, 'rua 4 com 22 prédios');
assert.ok(gal.ruas[0].pos['2|2'], 'posição indexada por prédio|nível');
assert.ok(!areas.some(a => a.posicoes.some(p => p.key === 'HISTORICO')), 'HISTORICO (999×999) nunca vira grade');
assert.equal(areas[0].doca, true);

// ── 3. Ocupação e situação ──────────────────────────────────────────────
const oc = S.ocupacao(lotes);
assert.equal(oc['GAL-1-1-1'].length, 2, 'dois produtos no mesmo palete');
assert.equal(oc['GAL-1-1-2'], undefined, 'lote zerado não ocupa');
assert.equal(oc['DOC-1-1-1'].length, 2);
let s = S.situacao('GAL-1-1-1', enderecos, oc);
assert.equal(s.tipo, 'OCUPADA'); assert.equal(s.ocupantes.length, 2);
assert.equal(S.situacao('GAL-1-1-2', enderecos, oc).tipo, 'LIVRE');
assert.equal(S.situacao('DOC-1-1-1', enderecos, oc).tipo, 'DOCA', 'Doca nunca é "ocupada": aceita vários paletes');
assert.equal(S.situacao('GAL-9-9-9', enderecos, oc).tipo, 'INVALIDA', 'posição inativa não pode ser escolhida');
assert.equal(S.situacao('NAO-EXISTE', enderecos, oc).tipo, 'INVALIDA');
// o lote que está sendo movido não ocupa o lugar de onde sai
s = S.situacao('GAL-1-1-1', enderecos, oc, {itemKey: 'MP-1', loteKey: 'a'});
assert.equal(s.tipo, 'OCUPADA'); assert.equal(s.ocupantes.length, 1);
const soUm = S.ocupacao({X: {l: {saldoLote: 5, enderecoKey: 'GAL-1-2-2'}}});
assert.equal(S.situacao('GAL-1-2-2', enderecos, soUm, {itemKey: 'X', loteKey: 'l'}).tipo, 'LIVRE');

// ── 4. Rótulo do campo ──────────────────────────────────────────────────
assert.equal(S.rotulo('DOC-1-1-1', enderecos), 'DOC-1.1.1 · Doca');
assert.equal(S.rotulo('GAL-1-1-1', enderecos), 'GAL-1.1.1 · GALPÃO');
assert.equal(S.rotulo('', enderecos), 'Escolher endereço');
assert.match(S.rotulo('SUMIU', enderecos), /não encontrado/);

// ── 5. Campo: mantém a classe que a tela já lê e escapa texto ───────────
const html = S.campoHtml('rc-endereco', 'DOC-1-1-1', enderecos, {titulo: 'Entrada <b>'});
assert.match(html, /<input type="hidden" class="rc-endereco" value="DOC-1-1-1">/);
assert.match(html, /DOC-1\.1\.1 · Doca/);
assert.ok(!html.includes('<b>'), 'título escapado');
assert.match(S.campoHtml('x', '', enderecos, {id: 'trNovoEndereco'}), /id="trNovoEndereco"/);
assert.match(S.campoHtml('x', '', enderecos), /se-btn vazio/);

console.log('run_seletor_endereco_test: OK');
