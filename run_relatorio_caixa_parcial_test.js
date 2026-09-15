/* Caixa parcial no Relatório de Expedição.
   A planilha registrava a parcial como linha própria ("1 cx × 10"); a carga
   do legado passou a somá-la ao palete (unidadesCaixaParcial). O total de
   caixas do relatório não pode mudar por isso: a parcial continua sendo uma
   caixa física. Medido na base: sem este ajuste o total cairia de 67.125 para
   66.796 caixas com as mesmas 3.063.149 unidades. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('public/relatorio_expedicao.html', 'utf8');
function extrai(nome) {
  const s = html.indexOf('function ' + nome + '(');
  assert.ok(s >= 0, nome + ' não encontrada');
  let d = 0, i = html.indexOf('{', s);
  for (; i < html.length; i++) { if (html[i] === '{') d++; if (html[i] === '}' && --d === 0) break; }
  return html.slice(s, i + 1);
}
function linhas(cargas) {
  const ctx = {Object, Number, String, Math, Date, JSON, cargas};
  vm.createContext(ctx);
  ['num', 'txt', 'dataValida', 'achatar'].forEach(n => vm.runInContext(extrai(n), ctx));
  return ctx.achatar();
}
const soma = (L, f) => L.reduce((s, r) => s + (r[f] || 0), 0);

// ── Mesma saída física nos dois formatos ────────────────────────────────
// ANTES: planilha linha a linha -- palete de 30 cx e a parcial como 1 cx × 10.
const antes = {LEG_NF_1: {legado: true, status: 'Expedido (legado)', data: '2026-09-01', itens: {
  a: {qtd: 720, caixasFechadas: 30, unidadesPorCaixa: 24, pesoTotalKg: 252, paleteOrigem: {caixasFechadas: 30, unidadesPorCaixa: 24}},
  b: {qtd: 10, caixasFechadas: 1, unidadesPorCaixa: 10, pesoTotalKg: 8.4, paleteOrigem: {caixasFechadas: 1, unidadesPorCaixa: 10}}
}}};
// DEPOIS: um palete só, com a parcial dentro.
const depois = {LEG_NF_1: {legado: true, status: 'Expedido (legado)', data: '2026-09-01', itens: {
  a: {qtd: 730, caixasFechadas: 30, unidadesPorCaixa: 24, unidadesCaixaParcial: 10, pesoTotalKg: 260.4,
      paleteOrigem: {caixasFechadas: 30, unidadesPorCaixa: 24, unidadesCaixaParcial: 10}}
}}};
const La = linhas(antes), Ld = linhas(depois);
assert.equal(La.length, 2);
assert.equal(Ld.length, 1, 'a parcial não é mais linha própria');
assert.equal(soma(Ld, 'unidades'), soma(La, 'unidades'), 'unidades iguais');
assert.equal(soma(Ld, 'caixas'), soma(La, 'caixas'), 'caixas iguais: a parcial conta como caixa');
assert.equal(Ld[0].caixas, 31);
assert.equal(Math.round(soma(Ld, 'peso') * 10), Math.round(soma(La, 'peso') * 10), 'peso igual');

// ── Parcial avulsa: zero fechadas + 1 parcial = 1 caixa ──────────────────
const avulsa = linhas({LEG_AVULSA_x: {legado: true, itens: {p: {qtd: 17, caixasFechadas: 0, unidadesPorCaixa: 24,
  unidadesCaixaParcial: 17, caixaParcialAvulsa: true, paleteOrigem: {caixasFechadas: 0, unidadesPorCaixa: 24, unidadesCaixaParcial: 17}}}}});
assert.equal(avulsa[0].caixas, 1);

// ── Carga do fluxo novo (versao 2): parcial só no paleteOrigem ────────────
const v2 = linhas({c1: {versao: 2, criadoEm: '2026-09-12T10:00:00Z', itens: {p: {qtd: 1895,
  paleteOrigem: {caixasFechadas: 157, unidadesPorCaixa: 12, unidadesCaixaParcial: 11}}}}});
assert.equal(v2[0].caixas, 158, 'fluxo novo também conta a parcial');

// ── Sem parcial nada muda; peso estimado usa só caixas fechadas ───────────
const sem = linhas({c: {legado: true, itens: {p: {qtd: 48, caixasFechadas: 2, unidadesPorCaixa: 24, pesoPorCaixaKg: 8.4,
  unidadesCaixaParcial: null, paleteOrigem: {caixasFechadas: 2, unidadesPorCaixa: 24, unidadesCaixaParcial: null}}}}});
assert.equal(sem[0].caixas, 2);
assert.equal(Math.round(sem[0].peso * 10), 168);

console.log('run_relatorio_caixa_parcial_test: OK');
