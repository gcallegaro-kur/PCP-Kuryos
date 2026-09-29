// Resultados do laudo de PA (28/09). node run_laudo_pa_resultados_test.js
const assert = require('assert');
const R = require('./public/shared/laudo-pa-resultados.js');
const L = require('./public/shared/laudo-cq.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// 1. FQ: bulk analisado vem preenchido e marcado; especificação vem sem resultado; sem nada, os 5 do modelo.
const bulk = {e1: {ensaio: 'pH', especificacaoTexto: '5 a 7', metodo: 'PA01', valor: 6.1},
  e2: {ensaio: 'Aspecto', especificacaoTexto: 'Límpido', cnc: 'C'}, e3: {ensaio: 'Odor', especificacaoTexto: 'Característico'}};
const fqBulk = R.fqInicial(bulk, null);
eq(fqBulk.map(l => [l.parametro, l.resultado, l.origem]), [
  ['Aspecto', 'Conforme', 'bulk'], ['Cor', '', 'laudo'], ['Odor', '', 'laudo'], ['pH (25°C)', '6,1', 'bulk'], ['Densidade', '', 'laudo']],
  'modelo oficial preenchido com o bulk; o que o bulk não mediu fica para o laudo');
eq(fqBulk[3].especificacao, '5 a 7', 'especificação do bulk completa a linha sem especificação');
const soDens = R.fqInicial({d: {ensaio: 'Densidade', valor: '0,9'}, x: {ensaio: 'Viscosidade', valor: '1200'}}, {a: {ensaio: 'PH', especificacaoTexto: '5 - 7'}});
eq(soDens.map(l => [l.parametro, l.resultado]), [['PH', ''], ['Densidade', '0,9'], ['Viscosidade', '1200']],
  'especificação primeiro; ensaio do bulk fora dela entra no fim');
const fqEspec = R.fqInicial(null, {a: {ensaio: 'Densidade', minimo: 0.8, maximo: 0.9, metodo: 'Picnômetro'}}, (e) => e.minimo + ' a ' + e.maximo);
eq(fqEspec, [{parametro: 'Densidade', especificacao: '0.8 a 0.9', metodo: 'Picnômetro', resultado: '', origem: 'laudo'}], 'especificação sem resultado');
eq(R.fqInicial(null, null).map(l => l.parametro), ['Aspecto', 'Cor', 'Odor', 'pH (25°C)', 'Densidade'], 'modelo oficial');
ok(R.fqInicial(null, null).every(l => l.resultado === ''), 'modelo não traz resultado');

// 1b. NA da análise do granel sai "N/A".
eq(R.fqInicial({t: {ensaio: 'Teor alcoólico', cnc: 'NA', na: true}}, null).find(l => l.parametro === 'Teor alcoólico').resultado, 'N/A', 'NA do bulk vira N/A');

// 2. Micro: nasce sem resultado nenhum.
const mi = R.microInicial();
eq(mi.linhas.length, 4);
ok(mi.linhas.every(l => l.resultado === ''), 'micro sem resultado inventado');

// 3. Avaliar: pendências e impedimento.
let a = R.avaliar(fqBulk, mi);
ok(!a.completo && a.pendentes.includes('FQ: Odor') && a.pendentes.some(p => /Micro: Ausência de Pseudomonas/.test(p)), 'pendências listadas');
const cheio = fqBulk.map(l => Object.assign({}, l, {resultado: l.resultado || 'Característico'}));
const microOk = Object.assign({}, mi, {linhas: mi.linhas.map(l => Object.assign({}, l, {resultado: R.MICRO_PADRAO.find(m => m.analise === l.analise).opcoes[0]}))});
a = R.avaliar(cheio, microOk);
ok(a.completo && !a.bloqueia, 'tudo preenchido e conforme');
const microRuim = Object.assign({}, microOk, {linhas: microOk.linhas.map((l, i) => i === 1 ? Object.assign({}, l, {resultado: 'Presente'}) : l)});
a = R.avaliar(cheio, microRuim);
ok(a.bloqueia && /Pseudomonas aeruginosa: Presente/.test(a.impedimentos[0]), 'Presente trava a liberação');
eq(R.microConforme({analise: R.MICRO_PADRAO[0].analise, resultado: '> 1 × 10³ UFC/mL ou g'}), false, 'contagem acima reprova');
eq(R.microConforme({analise: R.MICRO_PADRAO[0].analise, resultado: 'texto livre'}), null, 'texto livre não é julgado');
ok(R.avaliar(cheio, {realizada: false, justificativa: ''}).pendentes.includes('Microbiologia: justificativa da dispensa'), 'dispensa exige justificativa');
ok(R.avaliar(cheio, {realizada: false, justificativa: 'Álcool ≥ 60%'}).completo, 'dispensa justificada completa');

// 4. Registro: só o documento; linha sem parâmetro sai.
const reg = R.registro(cheio.concat([{parametro: '  ', resultado: 'x'}]), Object.assign({}, microOk, {laboratorio: 'Lab X', laudoExterno: '88'}));
eq(reg.fq.length, 5, 'linha vazia descartada');
eq(reg.micro.laboratorio, 'Lab X');
eq(reg.micro.linhas[1].resultado, 'Ausente');
eq(R.registro(cheio, {realizada: false, justificativa: 'Álcool'}).micro, {realizada: false, justificativa: 'Álcool'});

// 5. Impressão: micro do modelo sem resultado; o digitado sai; laudo externo com número.
eq(L.MICRO_PADRAO.map(l => l.resultado), ['', '', '', ''], 'modelo impresso não afirma resultado');
const base = {produto: 'P', lote: '1/1', pesos: [200], unidadePeso: 'g', pa: {}};
let html = L.paginaProdutoAcabado(Object.assign({}, base, {fq: reg.fq, micro: {incluir: true, linhas: reg.micro.linhas, laboratorio: 'Lab X', laudoExterno: '88'}}));
ok(/6,1/.test(html) && /Característico/.test(html), 'FQ digitado impresso');
ok(/Ausente/.test(html), 'micro digitada impressa');
ok(/Laudo externo: Lab X · nº 88/.test(html), 'laboratório e número do laudo externo');
html = L.paginaProdutoAcabado(Object.assign({}, base, {micro: {incluir: true}}));
ok(!/Ausente/.test(html.replace(/Ausente em 1 g ou 1 mL/g, '').replace(/Ausência/g, '')), 'sem resultado registrado, não imprime "Ausente"');

console.log('run_laudo_pa_resultados_test: ' + n + ' verificações OK');
