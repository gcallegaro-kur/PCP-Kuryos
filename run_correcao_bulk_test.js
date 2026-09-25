// Correção de bulk reprovado (25/09). node run_correcao_bulk_test.js
const assert = require('assert');
const M = require('./public/shared/manipulacao.js');
const D = require('./public/shared/dossie-lote.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// Ciclo 1 reprovado: fórmula de 500 kg para 1.000 unidades, rendeu 495 kg.
const ciclo1 = {
  status: 'REPROVADO',
  previstos: {AGUA: {mpCodigo: 'AGUA', previsto: 450}, TENSO: {mpCodigo: 'TENSO', previsto: 50}},
  pesagem: {itens: {AGUA: {pesado: 450}, TENSO: {pesado: 50}}, por: 'Ana', baixaAplicada: true},
  conferencia: {por: 'Bia'},
  manipulacao: {rendimento: 495, inicio: 'x', fim: 'y'},
  analise: {decisao: 'REPROVADO', por: 'CQ', observacao: 'turvo', em: '2026-09-25T12:00:00.000Z'}
};

// 1. REPROVADO deixa de ser fim de linha.
eq(M.acoesDisponiveis({manipulacao: ciclo1}), ['ABRIR_CORRECAO'], 'reprovado oferece abrir correção');
ok(!M.podeEnvasar({manipulacao: ciclo1}).ok, 'reprovado continua sem envasar');

// 2. Validação: só Qualidade, RNC obrigatória, insumos, massa de entrada.
const dados = {rncNumero: 'RNC-2026-0007', motivo: 'turbidez', entradaKg: 495,
  itens: [{mpCodigo: 'SOLUB', mpNome: 'Solubilizante', quantidade: 300}], quem: 'CQ'};
ok(M.validarAberturaCorrecao(ciclo1, dados, true).ok, 'dados completos passam');
ok(M.validarAberturaCorrecao(ciclo1, dados, false).erros.some(e => /Qualidade/.test(e)), 'sem permissão barra');
ok(M.validarAberturaCorrecao(ciclo1, Object.assign({}, dados, {rncNumero: ''}), true).erros.some(e => /RNC/.test(e)), 'RNC obrigatória');
ok(M.validarAberturaCorrecao(ciclo1, Object.assign({}, dados, {itens: []}), true).erros.some(e => /matéria-prima/.test(e)), 'precisa de insumo');
ok(M.validarAberturaCorrecao(ciclo1, Object.assign({}, dados, {itens: [{mpCodigo: 'SOLUB', quantidade: 0}]}), true).erros.some(e => /quantidade/.test(e)), 'insumo sem quantidade barra');
ok(M.validarAberturaCorrecao(ciclo1, Object.assign({}, dados, {itens: [{mpCodigo: 'X', quantidade: 1}, {mpCodigo: 'X', quantidade: 2}]}), true).erros.some(e => /duas vezes/.test(e)), 'insumo repetido barra');
ok(M.validarAberturaCorrecao(ciclo1, Object.assign({}, dados, {entradaKg: null}), true).erros.some(e => /massa/.test(e)), 'massa de entrada obrigatória');
ok(M.validarAberturaCorrecao(ciclo1, Object.assign({}, dados, {retroativo: true}), true).erros.some(e => /retroativo/.test(e)), 'retroativo exige justificativa');
ok(M.validarAberturaCorrecao(Object.assign({}, ciclo1, {status: 'LIBERADO'}), dados, true).erros.some(e => /reprovado/.test(e)), 'só reprovado');

// 2b. Só matéria-prima entra no tanque.
ok(M.ehMateriaPrima({tipo: 'MPGR'}) && M.ehMateriaPrima({tipo: 'MPES'}), 'MPGR e MPES são MP');
ok(!M.ehMateriaPrima({tipo: 'EP'}) && !M.ehMateriaPrima({tipo: 'ET'}) && !M.ehMateriaPrima({tipo: 'MU'}), 'embalagem e uso e consumo não');
ok(M.ehMateriaPrima({}), 'sem tipo no cadastro: não barra');
ok(M.validarAberturaCorrecao(ciclo1, Object.assign({}, dados, {itens: [{mpCodigo: 'EP-1', tipo: 'EP', quantidade: 5}]}), true).erros.some(e => /embalagem primária — a correção adiciona matéria-prima/.test(e)), 'embalagem é recusada');

// 3. Montar: ciclo 1 inteiro vai para o histórico; a fase recomeça com os insumos.
const c2 = M.montarCorrecao(ciclo1, Object.assign({agora: '2026-09-25T15:00:00.000Z'}, dados));
eq(c2.status, 'CORRECAO_ABERTA', 'nova fase aberta');
eq(c2.ciclo, 2, 'ciclo 2');
eq(c2.historico.c1.analise.decisao, 'REPROVADO', 'ciclo 1 preservado');
eq(c2.historico.c1.manipulacao.rendimento, 495, 'rendimento do ciclo 1 preservado');
ok(!c2.pesagem && !c2.analise, 'ciclo novo começa limpo');
eq(Object.keys(c2.previstos), ['SOLUB'], 'previstos = insumos da correção');
eq(c2.entradaBulk, {kg: 495, doCiclo: 1}, 'massa de entrada registrada');
eq(c2.correcao.rncNumero, 'RNC-2026-0007', 'RNC vinculada');
ok(M.ehCorrecao(c2) && !M.ehCorrecao(ciclo1), 'ehCorrecao');
eq(M.acoesDisponiveis({manipulacao: c2}), ['INICIAR_PESAGEM'], 'correção começa pela pesagem');
ok(!M.podeEnvasar({manipulacao: c2}).ok, 'correção aberta não envasa');
eq(M.rotulo(M.estado({manipulacao: c2})), 'Correção aberta — aguardando pesagem', 'rótulo');

// 4. Pesagem da correção: foto obrigatória, salvo retroativo autorizado.
const pesC2 = {itens: {SOLUB: {pesado: 300, loteMaterial: 'AK-1'}}};
ok(M.validarPesagem(c2.previstos, pesC2, {dispensaFoto: M.dispensaFoto(c2)}).erros.some(e => /foto/.test(e)), 'sem foto barra');
const retro = M.montarCorrecao(ciclo1, Object.assign({}, dados, {retroativo: true, justificativaRetroativo: 'feito antes do sistema'}));
ok(M.dispensaFoto(retro), 'retroativo dispensa foto');
ok(M.validarPesagem(retro.previstos, pesC2, {dispensaFoto: true}).ok, 'retroativo fecha sem foto');
ok(M.validarParcela({peso: 10, loteMaterial: 'AK-1'}, [], {dispensaFoto: true}).ok, 'parcela retroativa sem foto');
ok(!M.validarParcela({peso: 10, loteMaterial: 'AK-1'}, []).ok, 'parcela normal sem foto barra');
ok(M.validarPesagem({}, {}, {correcao: true}).erros.some(e => /correção não tem matérias-primas/.test(e)), 'mensagem própria da correção');

// 5. Rendimento da correção soma o bulk que entrou: 495 + 300 = 795.
const fechada = Object.assign({}, c2, {pesagem: pesC2, manipulacao: {inicio: 'a', rendimento: 790}});
const r = M.resumoManipulacao(c2.previstos, fechada);
eq(r.massaEntrada, 795, 'massa de entrada = bulk + insumos');
eq(r.perdaProcesso, 5, 'perda sobre a massa total');
ok(M.validarFechamentoManipulacao(c2.previstos, fechada).ok, '790 kg de 795 fecha');
ok(!M.validarFechamentoManipulacao(c2.previstos, Object.assign({}, fechada, {manipulacao: {inicio: 'a', rendimento: 800}})).ok, '800 kg de 795 barra');
// Ciclo 1 inalterado: sem entrada, mesma conta de antes.
eq(M.resumoManipulacao(ciclo1.previstos, ciclo1).perdaProcesso, 5, 'ciclo normal: 500 - 495');

// 6. Excedente: 500 kg teóricos para 1.000 un -> 0,5 kg/un. 790 kg -> 1.580 un.
eq(M.massaTeorica(ciclo1.previstos), 500, 'massa teórica do ciclo 1');
const exc = M.calcularExcedente({rendimentoKg: 790, qtdBase: 1000, massaTeoricaKg: 500});
eq([exc.capacidade, exc.excedente, exc.qtdNova], [1580, 580, 1580], 'excedente de 580 un');
eq(M.calcularExcedente({rendimentoKg: 790.4, qtdBase: 1000, massaTeoricaKg: 500}).capacidade, 1580, 'arredonda para baixo');
eq(M.calcularExcedente({rendimentoKg: 400, qtdBase: 1000, massaTeoricaKg: 500}).excedente, 0, 'rendeu menos: sem excedente, não reduz a OP');
eq(M.calcularExcedente({rendimentoKg: 400, qtdBase: 1000, massaTeoricaKg: 500}).qtdNova, 1000, 'qtdNova nunca abaixo do planejado');
ok(!M.calcularExcedente({rendimentoKg: 790, qtdBase: 1000, massaTeoricaKg: 0}).ok, 'sem massa teórica não inventa');

// 7. Embalagens: só o BOM escala; recalcular parte do original (não acumula).
const mat = {
  F: {mpCodigo: 'FRASCO', quantidade: 1000, origem: 'bom'},
  R: {mpCodigo: 'ROTULO', quantidade: 1010, origem: 'bom'},
  A: {mpCodigo: 'AGUA', quantidade: 450, origem: 'formula'}
};
const m1 = M.materiaisDoExcedente(mat, 1000, 1580);
eq(m1.materiais.F.quantidade, 1580, 'frascos escalam');
eq(m1.materiais.R.quantidade, 1595.8, 'rótulos com a mesma margem do BOM');
eq(m1.materiais.A, mat.A, 'fórmula não muda (já saiu na pesagem)');
eq(m1.deltas.map(d => [d.mpCodigo, d.quantidade]), [['FRASCO', 580], ['ROTULO', 585.8]], 'deltas a empenhar');
const m2 = M.materiaisDoExcedente(m1.materiais, 1000, 1200);
eq(m2.materiais.F.quantidade, 1200, 'novo ciclo recalcula do original');
eq(m2.deltas[0].quantidade, -380, 'delta negativo libera empenho');
eq(M.materiaisDoExcedente(m1.materiais, 1000, 1580).deltas, [], 'repetir não duplica');

// 8. Separação concluída reabre só pela diferença.
const porOp = M.separacaoAposExcedente({separacaoConcluida: {itens: {FRASCO: 600}}, separacaoParcial: {itens: {FRASCO: 400, ROTULO: 1010}}}, 'T', 'Op');
eq(porOp.separacaoParcial.itens, {FRASCO: 1000, ROTULO: 1010}, 'por OP: parcial + concluído');
eq(porOp.separacaoConcluida, null, 'volta a pendente');
const cons = M.separacaoAposExcedente({separacaoConcluida: {via: 'consolidada', itens: {FRASCO: 1000}}, separacaoParcial: {itens: {FRASCO: 1000}}}, 'T', 'Op');
eq(cons.separacaoParcial.itens, {FRASCO: 1000}, 'consolidada: concluído já é o total');
eq(M.separacaoAposExcedente({}, 'T'), null, 'sem separação concluída, nada a fazer');

// 9. Segundo ciclo reprovado -> terceiro ciclo guarda os dois.
const c2rep = Object.assign({}, fechada, {status: 'REPROVADO', analise: {decisao: 'REPROVADO'}});
const c3 = M.montarCorrecao(c2rep, Object.assign({}, dados, {entradaKg: 790}));
eq(c3.ciclo, 3, 'ciclo 3');
eq(Object.keys(c3.historico).sort(), ['c1', 'c2'], 'histórico com os dois ciclos');
eq(M.ciclos(c3).map(c => c.ciclo), [1, 2, 3], 'ciclos em ordem');

// 10. Dossiê mostra todos os ciclos, e o topo é o atual.
const opDossie = {lote: '26300/01', manipulacao: Object.assign({}, c2, {status: 'LIBERADO', pesagem: pesC2,
  manipulacao: {rendimento: 790, excedente: {unidades: 580, por: 'Op', em: '2026-09-25T17:00:00.000Z'}}, analise: {decisao: 'LIBERADO', em: '2026-09-25T18:00:00.000Z'}})};
const d = D.montar('k', {ops: {k: opDossie}});
eq(d.granel.ciclos.length, 2, 'dossiê com 2 ciclos');
eq(d.granel.ciclos[0].statusCiclo, 'REPROVADO', 'ciclo 1 reprovado');
ok(d.granel.ciclos[1].correcao && d.granel.correcao, 'topo = correção');
ok(d.linhaDoTempo.some(e => /Correção do bulk aberta — RNC RNC-2026-0007/.test(e.oque)), 'linha do tempo registra a correção');
ok(d.linhaDoTempo.some(e => /Excedente: \+580/.test(e.oque)), 'linha do tempo registra o excedente');
ok(d.linhaDoTempo.some(e => /Granel reprovado$/.test(e.oque)) && d.linhaDoTempo.some(e => /liberado \(correção, ciclo 2\)/.test(e.oque)), 'reprovação e liberação na linha do tempo');

console.log('run_correcao_bulk_test: ' + n + ' verificações OK');
