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
  assert.strictEqual(p.toleranciaPct, 3, 'tolerância INMETRO padrão');
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
  assert.strictEqual(ok.limiteIndividual, 194, '200 − 3%');
  assert.strictEqual(ok.conforme, true, 'média acima do nominal e nenhuma abaixo de 194');

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
  assert.match(pesoRuim.impedimentos[0], /média de peso abaixo/);

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
  assert.strictEqual(reg.versaoPlano, 'CK7-2026-09');
  assert.strictEqual(reg.amostragem.caixasAmostradas, 7);
  assert.strictEqual(reg.amostragem.regra, '√N+1');
  assert.strictEqual(reg.pesagem.media, 200);
  assert.strictEqual(reg.pesagem.limiteIndividual, 194);
  assert.strictEqual(reg.retencao.guardarAte, '2029-03-15');
  assert.strictEqual(reg.itens.vedacao.cnc, 'C');
  assert.strictEqual(Object.keys(reg.itens).length, I.itensAplicaveis(I.parametros(par200)).length);
  assert.match(reg.resumo, /^\d+C \/ 0NC \/ 0 pend\./);
}

console.log('run_inspecao_pa_test.js: OK');
