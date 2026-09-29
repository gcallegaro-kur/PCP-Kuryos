// Análise do granel: NA, faixa editável, só resultado (29/09). node run_analise_granel_test.js
const assert = require('assert');
const G = require('./public/shared/analise-granel.js');
const S = require('./public/shared/spec-material.js');
const P = require('./public/shared/inspecao-pa.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// 1. Linhas: com especificação do produto, faixas vêm dela; numérico reconhecido.
const espec = {
  asp: {ensaio: 'ASPECTO', especificacaoTexto: 'LÍQUIDO LÍMPIDO', metodo: 'PA09'},
  ph: {ensaio: 'PH', especificacaoTexto: 'N/A', minimo: '5,5', maximo: 6.5, metodo: 'PA01', critico: true},
  dens: {ensaio: 'DENSIDADE', minimo: 0.85, maximo: 0.95},
  teor: {ensaio: 'TEOR ALCOÓLICO', especificacaoTexto: 'NA', aplicavel: false}
};
const L = G.linhas(espec, S.PLANO_MP);
const por = (k) => L.find(l => l.key === k);
eq([por('ph').numerico, por('ph').minimo, por('ph').maximo], [true, 5.5, 6.5], 'faixa do pH da especificação, vírgula aceita');
eq(por('asp').numerico, false, 'aspecto é descritivo');
eq(por('teor').numerico, true, 'teor é numérico mesmo sem faixa');
eq(por('teor').naEspec, true, 'especificação "não se aplica" começa em NA');
eq(por('ph').especificacaoTexto, '', 'texto N/A (faixa nas colunas) não vai para o laudo como texto');
ok(!por('ph').naEspec, 'pH com faixa não é NA');

// 1b. Faixa escrita no texto (achado do ensaio com a base: 282 linhas assim).
eq(G.faixaDoTexto('5,5 – 6,5'), {minimo: 5.5, maximo: 6.5});
eq(G.faixaDoTexto('180g-198g'), {minimo: 180, maximo: 198});
eq(G.faixaDoTexto('65 a 75'), {minimo: 65, maximo: 75});
eq(G.faixaDoTexto('≥ 0,8'), {minimo: 0.8, maximo: null});
eq(G.faixaDoTexto('Límpido a levemente turvo'), null, 'descritivo não vira faixa');
eq(G.faixaDoTexto('7 - 5'), null, 'faixa invertida não é aceita');
const doTexto = G.linhas({ph: {ensaio: 'PH', especificacaoTexto: '5,5 – 6,5'}, cl: {ensaio: 'CONTEÚDO LÍQUIDO MÉDIO', especificacaoTexto: '180g-198g'}});
eq([doTexto[0].minimo, doTexto[0].maximo, doTexto[0].especificacaoTexto], [5.5, 6.5, '5,5 – 6,5'], 'faixa do texto preenche o campo; o texto segue para o laudo');
eq(doTexto[1].numerico, true, 'faixa no texto torna o ensaio numérico');
eq(G.avaliar(doTexto, {ph: {valor: '6'}}).linhas[0].faixaAlterada, false, 'faixa do texto não conta como alterada');

// 2. Sem especificação: os seis padrão; pH/densidade/teor numéricos sem faixa.
const P6 = G.linhas(null, S.PLANO_MP);
eq(P6.map(l => l.key), ['aspecto', 'cor', 'odor', 'ph', 'densidade', 'teor_alcoolico']);
eq(P6.filter(l => l.numerico).map(l => l.key), ['ph', 'densidade', 'teor_alcoolico']);

// 3. Só o resultado: dentro, abaixo, acima; faixa editada vale para o lote.
let a = G.avaliar(L, {asp: {cnc: 'C'}, ph: {valor: '6,1'}, dens: {valor: '0.83'}});
const st = (av, k) => av.linhas.find(l => l.key === k);
eq(st(a, 'ph').status, 'C', '6,1 dentro de 5,5–6,5');
eq(st(a, 'dens').status, 'NC', '0,83 abaixo de 0,85');
eq(st(a, 'teor').status, 'NA', 'teor NA pela especificação');
eq([a.conformes, a.naoConformes, a.na, a.pendentes], [2, 1, 1, 0]);
a = G.avaliar(L, {ph: {valor: '7'}});
ok(a.bloqueia, 'pH crítico fora bloqueia');
a = G.avaliar(L, {ph: {valor: '7', maximo: '7,2'}});
eq(st(a, 'ph').status, 'C', 'faixa editada vale');
ok(st(a, 'ph').faixaAlterada && a.faixasAlteradas.includes('PH'), 'e fica marcada como alterada');
eq(st(a, 'ph').faixa, '5,5 – 7,2');
a = G.avaliar(L, {ph: {valor: '6', minimo: '7', maximo: '6'}});
eq(st(a, 'ph').status, 'PENDENTE', 'mínimo > máximo não julga');
a = G.avaliar(P6, {ph: {valor: '6'}});
eq(st(a, 'ph').status, 'PENDENTE', 'sem faixa não julga');
ok(/Informe a faixa/.test(st(a, 'ph').motivo));

// 4. NA em qualquer ensaio; desmarcar NA da especificação volta a valer.
a = G.avaliar(L, {asp: {na: true}, teor: {na: false, valor: '70', minimo: 65, maximo: 75}});
eq(st(a, 'asp').status, 'NA');
eq(st(a, 'teor').status, 'C', 'NA da especificação desmarcado: julga o valor');
a = G.avaliar(L, {ph: {na: true, valor: '9'}});
eq(st(a, 'ph').status, 'NA', 'NA ignora valor fora');
ok(!a.bloqueia, 'NA nunca reprova');

// 5. Registro: campos que os leitores usam + os novos.
const reg = G.registro(G.avaliar(L, {asp: {cnc: 'C'}, ph: {valor: '6,1'}, dens: {valor: '0,9'}}));
eq(reg.ph.valor, 6.1, 'número de verdade');
eq(reg.ph.cnc, 'C', 'numérico grava o veredito em cnc');
eq([reg.ph.minimo, reg.ph.maximo, reg.ph.faixa], [5.5, 6.5, '5,5 – 6,5']);
eq(reg.teor.cnc, 'NA');
eq(reg.teor.na, true);
eq(reg.teor.valor, null);
eq(P.densidadeDoBulk(reg), 0.9, 'densidade do bulk continua lida pelo peso do PA (INMETRO)');

// 6. Especificação v1 do produto a partir da análise (só com faixa).
const semFaixa = G.especificacaoDaAnalise('X', G.avaliar(P6, {aspecto: {cnc: 'C'}}), {});
eq(semFaixa, null, 'sem nenhuma faixa não cria especificação');
const av6 = G.avaliar(P6, {aspecto: {cnc: 'C'}, ph: {valor: '6', minimo: '5', maximo: '7'}, teor_alcoolico: {na: true}});
const sp = G.especificacaoDaAnalise('PRF-1', av6, {agora: 'T', por: 'CQ', lote: '1/1'});
eq(sp.chave, 'PRF-1__v1');
const it = sp.updates['especificacoes/PRF-1__v1'].itens;
eq([it.ph.minimo, it.ph.maximo, it.ph.especificacaoTexto], [5, 7, '5 – 7']);
eq([it.teor_alcoolico.especificacaoTexto, it.teor_alcoolico.aplicavel], ['NA', false], 'NA vira "não se aplica" na especificação');
eq(sp.updates['especificacoes/PRF-1__v1'].origem, 'ANALISE_GRANEL');
// E a v1 volta como linhas do próximo lote, com NA pré-marcado.
const prox = G.linhas(it, S.PLANO_MP);
eq(prox.find(l => l.key === 'ph').minimo, 5);
eq(prox.find(l => l.key === 'teor_alcoolico').naEspec, true);

// 7. Especificação existente com lacuna (29/09: "gravando nas especificações").
const especV = {key: 'PRF-2__v3', versao: 3, registro: {codProduto: 'PRF-2', versao: 'v3', status: 'APROVADA', itens: {
  ph: {ensaio: 'PH', especificacaoTexto: '5,5 – 6,5', metodo: 'PA01'},
  dens: {ensaio: 'DENSIDADE', especificacaoTexto: '-', metodo: 'PA02'},
  teor: {ensaio: 'TEOR DE ÁLCOOL', especificacaoTexto: 'N/A'},
  asp: {ensaio: 'ASPECTO', especificacaoTexto: 'LÍQUIDO'}}}};
const LV = G.linhas(especV.registro.itens, S.PLANO_MP);
let av7 = G.avaliar(LV, {ph: {valor: '6', maximo: '7'}, dens: {valor: '0,9', minimo: '0,85', maximo: '0,95'}, teor: {na: true}, asp: {cnc: 'C'}});
eq(av7.faixasNovas, ['DENSIDADE'], 'densidade sem faixa: faixa nova');
eq(av7.faixasAlteradas, ['PH'], 'pH com faixa: ajuste só do lote');
eq(G.registro(av7).dens.faixaNova, true);
const lac = G.especificacaoComLacunas(especV, av7, {agora: 'T', por: 'CQ', lote: '9/9'});
eq(lac.chave, 'PRF-2__v4', 'nova versão');
const v4 = lac.updates['especificacoes/PRF-2__v4'];
eq([v4.itens.dens.minimo, v4.itens.dens.maximo, v4.itens.dens.especificacaoTexto], [0.85, 0.95, '0,85 – 0,95'], 'lacuna preenchida');
eq(v4.itens.ph, especV.registro.itens.ph, 'pH ajustado no lote NÃO muda na especificação');
eq(v4.itens.teor, especV.registro.itens.teor, 'NA no lote não muda a especificação');
eq([v4.versao, v4.baseadaEm, v4.origem, v4.faixasPreenchidas, v4.status], ['v4', 'PRF-2__v3', 'ANALISE_GRANEL', ['DENSIDADE'], 'APROVADA']);
eq(especV.registro.itens.dens.minimo, undefined, 'versão vigente não é mutada');
eq(G.especificacaoComLacunas(especV, G.avaliar(LV, {ph: {valor: '6'}}), {}), null, 'sem lacuna preenchida, sem versão nova');
// Próximo lote: a faixa já vem.
eq(G.linhas(v4.itens, S.PLANO_MP).find(l => l.key === 'dens').minimo, 0.85);
eq(G.avaliar(G.linhas(v4.itens, S.PLANO_MP), {}).faixasNovas, [], 'nada mais a preencher');

console.log('run_analise_granel_test: ' + n + ' verificações OK');
