const assert = require('assert');
const path = require('path');
const I = require(path.join(__dirname, 'public', 'shared', 'inspecao-pa.js'));

// ── Amostragem √N+1 (regra confirmada pela Qualidade em 17/09) ──────────
assert.deepStrictEqual(I.amostragem(100).amostra, 11);
assert.deepStrictEqual(I.amostragem(36).amostra, 7);
assert.strictEqual(I.amostragem(9).amostra, 4);
assert.strictEqual(I.amostragem(1).amostra, 1, 'palete de 1 caixa não pede 2');
assert.strictEqual(I.amostragem(2).amostra, 2);
assert.strictEqual(I.amostragem(0).amostra, 0);
assert.deepStrictEqual(I.amostragem(100).posicoes, ['Topo', 'Meio', 'Fundo']);
assert.deepStrictEqual(I.amostragem(1).posicoes, ['Meio']);
assert.match(I.amostragem(48).texto, /8 de 48 caixa\(s\) — √N\+1/);

// ── Parâmetros do produto ───────────────────────────────────────────────
{
  const p = I.parametros({conteudoNominal: 200, unidadesPorCaixa: 24});
  assert.strictEqual(p.toleranciaPct, undefined, 'tolerância vem da tabela do INMETRO, não de um % fixo');
  assert.strictEqual(p.torqueAtivo, false, 'torquímetro desligado por padrão (Qualidade: não usamos)');
  assert.deepStrictEqual(I.faltamParametros(I.parametros({})), ['conteúdo nominal', 'unidades por caixa']);
  assert.deepStrictEqual(I.faltamParametros(p), []);
}

// ── Pesagem: média e unidade isolada ────────────────────────────────────
const par200 = {conteudoNominal: 200, unidadesPorCaixa: 24};
{
  const ok = I.avaliarPesos([201, 200.5, 199, 202, 198], I.parametros(par200));
  assert.strictEqual(ok.n, 5);
  assert.strictEqual(ok.media, 200.1);
  assert.strictEqual(ok.limiteIndividual, 191, '200 − T (9, Portaria 249)');
  assert.strictEqual(ok.conforme, true, 'média acima do nominal e nenhuma abaixo de 191');

  const mediaBaixa = I.avaliarPesos([199, 198, 197], I.parametros(par200));
  assert.strictEqual(mediaBaixa.mediaAbaixo, true);
  assert.strictEqual(mediaBaixa.conforme, false, 'conteúdo líquido médio abaixo do nominal reprova');

  // O caso do envase manual: média boa, uma unidade fora. A média sozinha esconderia.
  const unidadeFora = I.avaliarPesos([205, 206, 207, 190], I.parametros(par200));
  assert.strictEqual(unidadeFora.mediaAbaixo, false);
  assert.deepStrictEqual(unidadeFora.foraLimite, [190]);
  assert.strictEqual(unidadeFora.conforme, false);

  assert.strictEqual(I.avaliarPesos([], I.parametros(par200)).pendente, true);
  assert.strictEqual(I.avaliarPesos([200], I.parametros({})).conforme, null, 'sem nominal não julga');
}

// Critério da média do INMETRO (23/09): x̄ >= Qn − k·s, k = t(99,5%; n−1)/√n.
{
  // k bate com a tabela da Portaria 249/2021.
  [[5, 2.059], [13, 0.847], [20, 0.64], [32, 0.485], [50, 0.379], [80, 0.295]].forEach(([n, k]) => {
    assert.strictEqual(I.kInmetro(n), k, 'k para n=' + n);
  });
  // O caso relatado: média dentro dos −3%, abaixo do nominal, com dispersão
  // normal de envase -- passa pelo INMETRO (antes bloqueava).
  const relatado = I.avaliarPesos([199, 196, 201, 195, 198, 197, 200, 196], I.parametros(par200));
  assert.strictEqual(relatado.media, 197.75);
  assert.strictEqual(relatado.k, 1.237);
  assert.strictEqual(relatado.limiteMedia, 197.376);
  assert.strictEqual(relatado.conforme, true, 'média 197,75 >= 197,376 (200 − 1,237 × 2,121)');
  // Lote sistematicamente baixo (pouca dispersão, todos ~197): reprova --
  // não é variação, é enchimento abaixo do nominal.
  const sistematico = I.avaliarPesos([197, 197.2, 196.8, 197.1, 196.9], I.parametros(par200));
  assert.strictEqual(sistematico.mediaAbaixo, true);
  assert.strictEqual(sistematico.conforme, false);
  // Menos de 5 unidades: sem critério estatístico, média >= nominal.
  const poucas = I.avaliarPesos([199, 198, 197], I.parametros(par200));
  assert.strictEqual(poucas.k, null);
  assert.strictEqual(poucas.limiteMedia, 200);
  const aval = I.avaliar({}, [197, 197.2, 196.8, 197.1, 196.9], par200, {caixas: 9});
  assert.match(aval.impedimentos.join(' '), /média de peso 197g abaixo do mínimo para a média \(199\.674g = nominal − k·s, INMETRO\)/);
  const reg = I.registro(aval, {pesos: [197, 197.2, 196.8, 197.1, 196.9]});
  assert.strictEqual(reg.pesagem.limiteMedia, 199.674);
  assert.strictEqual(reg.pesagem.k, 2.059);
}

// ── Plano: torque só com parâmetro ligado ───────────────────────────────
{
  const semTorque = I.itensAplicaveis(I.parametros(par200)).map((i) => i.id);
  assert.ok(!semTorque.includes('torque'));
  assert.ok(semTorque.includes('vedacao'), 'vedação manual continua obrigatória');
  const comTorque = I.itensAplicaveis(I.parametros({torqueAtivo: true})).map((i) => i.id);
  assert.ok(comTorque.includes('torque'));
  const secoes = [...new Set(I.PLANO_PADRAO.map((i) => i.secao))];
  assert.deepStrictEqual(secoes, ['Identificação', 'Palete', 'Unidade (amostra)', 'Caixa', 'Retenção']);
}

// ── Avaliação completa ──────────────────────────────────────────────────
function todos(valor) {
  const r = {};
  I.itensAplicaveis(I.parametros(par200)).forEach((i) => { r[i.id] = {cnc: valor}; });
  return r;
}
{
  const tudoOk = I.avaliar(todos('C'), [200, 201, 199], par200, {caixas: 36});
  assert.strictEqual(tudoOk.bloqueia, false);
  assert.strictEqual(tudoOk.pendentes, 0);
  assert.strictEqual(tudoOk.completo, true);
  assert.strictEqual(tudoOk.amostragem.amostra, 7);
  assert.deepStrictEqual(tudoOk.impedimentos, []);

  // Defeito crítico (rótulo errado) bloqueia — decisão do usuário em 17/09.
  const critico = todos('C');
  critico.rotulo_correto = {cnc: 'NC', observacao: 'Rótulo da variante errada'};
  const comCritico = I.avaliar(critico, [200, 201], par200, {caixas: 36});
  assert.strictEqual(comCritico.criticosNC, 1);
  assert.strictEqual(comCritico.bloqueia, true);
  assert.match(comCritico.impedimentos[0], /crítico/);
  assert.strictEqual(comCritico.classificacaoRnc, 'CRITICA');

  // NC menor não bloqueia, mas conta e classifica a RNC.
  const menor = todos('C');
  menor.fechamento_caixa = {cnc: 'NC'};
  const comMenor = I.avaliar(menor, [200], par200, {caixas: 9});
  assert.strictEqual(comMenor.bloqueia, false);
  assert.strictEqual(comMenor.naoConformes, 1);
  assert.strictEqual(comMenor.classificacaoRnc, 'MENOR');

  // Peso fora bloqueia mesmo com todos os itens conformes.
  const pesoRuim = I.avaliar(todos('C'), [199, 198], par200, {caixas: 36});
  assert.strictEqual(pesoRuim.bloqueia, true);
  assert.match(pesoRuim.impedimentos[0], /média de peso [\d.]+g abaixo do mínimo para a média/);

  // Pendente: nada respondido.
  const vazio = I.avaliar({}, [], par200, {caixas: 36});
  assert.strictEqual(vazio.completo, false);
  assert.strictEqual(vazio.pendentes, I.itensAplicaveis(I.parametros(par200)).length);
  assert.strictEqual(vazio.bloqueia, false, 'pendente não é reprovação');

  // NA sai da conta de pendentes e não vira NC.
  const comNa = todos('C');
  comNa.ean_caixa = {cnc: 'NA', observacao: 'Caixa sem código de barras'};
  const avalNa = I.avaliar(comNa, [200], par200, {caixas: 9});
  assert.strictEqual(avalNa.naoAplicaveis, 1);
  assert.strictEqual(avalNa.naoConformes, 0);
  assert.strictEqual(avalNa.completo, true);

  // Faltando parâmetro do produto, a tela precisa avisar.
  assert.deepStrictEqual(I.avaliar(todos('C'), [200], {}, {caixas: 9}).faltamParametros, ['conteúdo nominal', 'unidades por caixa']);
}

// ── Torque com faixa ────────────────────────────────────────────────────
{
  const par = {conteudoNominal: 200, unidadesPorCaixa: 24, torqueAtivo: true, torqueMin: 8, torqueMax: 14};
  const r = I.avaliar({torque: {valor: 16}}, [], par, {caixas: 4});
  const linha = r.linhas.find((l) => l.id === 'torque');
  assert.strictEqual(linha.conforme, false);
  assert.match(linha.motivo, /Fora da faixa/);
  assert.strictEqual(r.avaliarDentro, undefined);
  const dentro = I.avaliar({torque: {valor: 10}}, [], par, {caixas: 4});
  assert.strictEqual(dentro.linhas.find((l) => l.id === 'torque').conforme, true);
}

// ── Retenção: validade + 1 ano (Qualidade, 17/09) ───────────────────────
assert.strictEqual(I.prazoRetencao('2028-03-15'), '2029-03-15');
assert.strictEqual(I.prazoRetencao(''), null);
assert.strictEqual(I.RETENCAO_MESES_APOS_VALIDADE, 12);

// ── Registro gravado no laudo ───────────────────────────────────────────
{
  const aval = I.avaliar(todos('C'), [200, 201, 199], par200, {caixas: 36});
  const reg = I.registro(aval, {pesos: [200, 201, 199], retencaoUnidades: 3, retencaoLocal: 'RET-01', dataValidade: '2028-03-15'});
  assert.strictEqual(reg.versaoPlano, 'CK7-2026-09b');
  assert.strictEqual(reg.amostragem.caixasAmostradas, 7);
  assert.strictEqual(reg.amostragem.regra, '√N+1');
  assert.strictEqual(reg.pesagem.media, 200);
  assert.strictEqual(reg.pesagem.limiteIndividual, 191);
  assert.strictEqual(reg.retencao.guardarAte, '2029-03-15');
  assert.strictEqual(reg.itens.vedacao.cnc, 'C');
  assert.strictEqual(Object.keys(reg.itens).length, I.itensAplicaveis(I.parametros(par200)).length);
  assert.match(reg.resumo, /^\d+C \/ 0NC \/ 0 pend\./);
}

// ── Portaria INMETRO 249/2021: tolerância T por faixa de Qn (25/09) ─────
{
  [[10, 0.9], [50, 4.5], [75, 4.5], [100, 4.5], [150, 6.8], [200, 9], [250, 9], [300, 9],
    [400, 12], [500, 15], [750, 15], [1000, 15], [5000, 75], [12000, 150], [20000, 200]].forEach(([qn, t]) => {
    assert.strictEqual(I.toleranciaInmetro(qn), t, 'T para Qn=' + qn);
  });
  assert.strictEqual(I.toleranciaInmetro(null), null);
  assert.strictEqual(I.toleranciaInmetro(0), null);
}

// ── Plano de amostragem: n, c e k por tamanho do lote ───────────────────
{
  assert.deepStrictEqual(I.planoPorLote(40), {lote: 40, n: 5, c: 0, k: 2.059});
  assert.deepStrictEqual(I.planoPorLote(120), {lote: 120, n: 13, c: 1, k: 0.847});
  assert.deepStrictEqual(I.planoPorLote(3000), {lote: 3000, n: 20, c: 1, k: 0.64});
  assert.deepStrictEqual(I.planoPorLote(8000), {lote: 8000, n: 32, c: 2, k: 0.485});
  assert.deepStrictEqual(I.planoPorLote(20000), {lote: 20000, n: 80, c: 5, k: 0.295});
  assert.strictEqual(I.planoPorLote(3).n, 3, 'lote menor que a amostra: pesa todas');
  assert.strictEqual(I.planoPorLote(0), null);
  // c nunca é mais tolerante do que o plano que a amostra cumpriu.
  [[4, 0], [5, 0], [12, 0], [13, 1], [25, 1], [32, 2], [79, 2], [80, 5]].forEach(([nPes, c]) => {
    assert.strictEqual(I.aceitacaoPorAmostra(nPes), c, 'c para ' + nPes + ' pesagens');
  });
}

// ── Critério individual: c abaixo de Qn − T, nenhuma abaixo de Qn − 2T ──
{
  const base = Array(19).fill(201);
  // n=20 → c=1: uma unidade entre Qn−2T e Qn−T é admitida...
  const umaFora = I.avaliarPesos(base.concat([188]), I.parametros(par200));
  assert.strictEqual(umaFora.c, 1);
  assert.deepStrictEqual(umaFora.foraLimite, [188]);
  assert.strictEqual(umaFora.conforme, true, 'uma abaixo de Qn−T com c=1 aprova');
  // ...duas não.
  const duasFora = I.avaliarPesos(Array(18).fill(202).concat([189, 188]), I.parametros(par200));
  assert.strictEqual(duasFora.conforme, false);
  const aval = I.avaliar({}, Array(18).fill(202).concat([189, 188]), par200, {caixas: 9});
  assert.match(aval.impedimentos.join(' '), /2 unidade\(s\) abaixo de 191 g \(nominal − T\); com 20 pesagens o INMETRO admite 1/);
  // Abaixo de Qn − 2T (182 g) reprova mesmo sendo a única.
  const t2 = I.avaliarPesos(base.concat([181]), I.parametros(par200));
  assert.strictEqual(t2.limiteT2, 182);
  assert.deepStrictEqual(t2.abaixoT2, [181]);
  assert.strictEqual(t2.conforme, false);
  assert.match(I.avaliar({}, base.concat([181]), par200, {}).impedimentos.join(' '), /abaixo de 182 g \(nominal − 2T\): o INMETRO não admite nenhuma/);
}

// ── Produto em ml: peso convertido pela densidade (25/09) ───────────────
{
  const perfume = {conteudoNominal: 200, unidadeMedida: 'ml', unidadesPorCaixa: 24};
  const pesos = [170.4, 170.9, 169.8, 170.2, 171.1, 170.5];
  // O defeito relatado: sem densidade, 170 g era comparado com "200".
  const semDens = I.avaliar(todos('C'), pesos, perfume, {caixas: 9});
  assert.strictEqual(semDens.pesagem.semDensidade, true);
  assert.strictEqual(semDens.pesagem.conforme, null, 'sem densidade não julga');
  assert.strictEqual(semDens.bloqueia, true, 'mas também não libera');
  assert.match(semDens.impedimentos.join(' '), /sem densidade do lote/);
  // Com a densidade do bulk: nominal 170 g, T = 9 ml × 0,85 = 7,65 g.
  const comBulk = I.avaliar(todos('C'), pesos, perfume, {caixas: 9, densidade: {valor: 0.85, origem: 'BULK'}});
  assert.strictEqual(comBulk.pesagem.nominal, 170);
  assert.strictEqual(comBulk.pesagem.toleranciaMassa, 7.65);
  assert.strictEqual(comBulk.pesagem.limiteIndividual, 162.35);
  assert.strictEqual(comBulk.pesagem.limiteT2, 154.7);
  assert.strictEqual(comBulk.pesagem.conforme, true);
  assert.strictEqual(comBulk.bloqueia, false);
  assert.deepStrictEqual(comBulk.avisos, []);
  // O outro lado do defeito: creme de 1,05 com FALTA de produto passava
  // (205 g > 200); convertido, o nominal é 210 g e reprova.
  const creme = I.avaliarPesos([205, 204.5, 205.2, 204.8, 205.1], I.parametros(perfume), {valor: 1.05, origem: 'LAUDO'});
  assert.strictEqual(creme.nominal, 210);
  assert.strictEqual(creme.mediaAbaixo, true);
  assert.strictEqual(creme.conforme, false);
  // Produto em g ignora a densidade.
  assert.strictEqual(I.avaliarPesos([200], I.parametros(par200), {valor: 0.85}).nominal, 200);
  // Densidade do cadastro vale, com aviso para medir no laudo.
  const cad = I.avaliar(todos('C'), pesos, perfume, {caixas: 9, densidade: {valor: 0.85, origem: 'CADASTRO'}});
  assert.match(cad.avisos.join(' '), /densidade do cadastro/);
  // Registro: gramas + o declarado no rótulo + de onde veio a densidade.
  const reg = I.registro(comBulk, {pesos});
  assert.strictEqual(reg.pesagem.unidade, 'g');
  assert.strictEqual(reg.pesagem.nominal, 170);
  assert.strictEqual(reg.pesagem.nominalDeclarado, 200);
  assert.strictEqual(reg.pesagem.unidadeDeclarada, 'ml');
  assert.strictEqual(reg.pesagem.densidade, 0.85);
  assert.strictEqual(reg.pesagem.origemDensidade, 'BULK');
  assert.strictEqual(reg.pesagem.tolerancia, 9);
  assert.strictEqual(reg.pesagem.c, 0, '6 pesagens cobrem só o plano de 5: c=0');
  assert.match(reg.pesagem.criterio, /Portaria INMETRO 249\/2021/);
}

// ── Densidade: laudo > bulk > cadastro ──────────────────────────────────
{
  assert.deepStrictEqual(I.densidadeParaPesagem({laudo: '0,86', bulk: 0.85, cadastro: 0.9}),
    {valor: 0.86, origem: 'LAUDO', texto: 'medida no laudo'});
  assert.strictEqual(I.densidadeParaPesagem({laudo: '', bulk: 0.85, cadastro: 0.9}).origem, 'BULK');
  assert.strictEqual(I.densidadeParaPesagem({bulk: null, cadastro: 0.9}).origem, 'CADASTRO');
  assert.strictEqual(I.densidadeParaPesagem({laudo: 85}).valor, null, '85 não é densidade em g/ml (digitou kg/m³?)');
  assert.strictEqual(I.densidadeParaPesagem({}).origem, null);
  assert.strictEqual(I.densidadeDoBulk({
    ph: {ensaio: 'pH', valor: '5,8'}, dens: {ensaio: 'Densidade (20 °C)', valor: '0,872'}
  }), 0.872);
  assert.strictEqual(I.densidadeDoBulk({dens: {ensaio: 'DENSIDADE', valor: null, cnc: 'C'}}), null);
  assert.strictEqual(I.densidadeDoBulk(null), null);
}

// ── Aviso do plano: pesou menos do que o lote pede ──────────────────────
{
  const aval = I.avaliar(todos('C'), [200, 201, 202, 200, 201], par200, {caixas: 9, tamanhoLote: 3000});
  assert.deepStrictEqual(aval.planoPesagem, {lote: 3000, n: 20, c: 1, k: 0.64});
  assert.match(aval.avisos.join(' '), /plano do INMETRO para lote de 3000 unidades pede 20 pesagens \(há 5\)/);
  assert.strictEqual(aval.bloqueia, false, 'aviso não bloqueia: a inspetora decide');
}

console.log('run_inspecao_pa_test.js: OK');

// Campo decimal com vírgula (shared/campo-decimal.js, 23/09).
{
  const {normalizar} = require('./public/shared/campo-decimal.js');
  [['197,5', '197.5'], ['197.5', '197.5'], ['1.250,5', '1250.5'], ['200,', '200.'], [',5', '.5'],
    ['12,3,4', '12.34'], ['abc9x', '9'], ['-3,2', '-3.2'], ['2-0', '20'], [' 19 8 ', '198'], ['', '']
  ].forEach(([de, para]) => assert.strictEqual(normalizar(de), para, de));
  console.log('run_inspecao_pa_test.js: OK (vírgula decimal)');
}
