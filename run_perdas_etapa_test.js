'use strict';
/* Perdas item a item por etapa (2026-09-25): shared/perdas-etapa.js e o
   resumo da manipulação com a perda por matéria-prima. */
const assert = require('node:assert/strict');
const P = require('./public/shared/perdas-etapa.js');
const M = require('./public/shared/manipulacao.js');
let n = 0;
function t(nome, fn) { fn(); n++; console.log('ok -', nome); }
const J = (x) => JSON.parse(JSON.stringify(x));

const materiais = {
  'EP-00106': {mpCodigo: 'EP-00106', mpNome: 'FRASCO PET 200ML', unidade: 'un'},
  'ES-00311': {mpCodigo: 'ES-00311', mpNome: 'ROTULO HIDRATANTE', unidade: 'un'},
  'ET-00032': {mpCodigo: 'ET-00032', mpNome: 'CAIXA MASTER 200ML', unidade: 'un'},
  'EP-00174': {mpCodigo: 'EP-00174', mpNome: 'VALVULA PUMP 24/410', unidade: 'un'},
  'ES-00400': {mpCodigo: 'ES-00400', mpNome: 'FILME TERMOENCOLHIVEL', unidade: 'm'}
};
const opNova = {sku: 'HDR-1', pesoTeoricoUnG: 204, materiaisConsumo: {
  a: {mpCodigo: 'EP-00174', mpNome: 'VALVULA PUMP 24/410', origem: 'bom', quantidade: 1237, unidade: 'un'},
  b: {mpCodigo: 'EP-00106', mpNome: 'FRASCO PET 200ML', origem: 'bom', quantidade: 1237, unidade: 'un'},
  c: {mpCodigo: 'ES-00311', mpNome: 'ROTULO HIDRATANTE', origem: 'bom', quantidade: 1237, unidade: 'un'},
  d: {mpCodigo: 'ET-00032', mpNome: 'CAIXA MASTER 200ML', origem: 'bom', quantidade: 26, unidade: 'un'},
  e: {mpCodigo: 'MPGR-00132', mpNome: 'ÁGUA', origem: 'formula', quantidade: 221.9, unidade: 'kg'}
}};

t('categoria pelo nome do material (compatível com as perdas de antes)', () => {
  assert.equal(P.tipoDoMaterial('FRASCO R.24/410 PET'), 'Frascos');
  assert.equal(P.tipoDoMaterial('RÓTULO FRENTE'), 'Rótulos');
  assert.equal(P.tipoDoMaterial('VALV.REC.15 EASY LOCK'), 'Tampas/Válvulas');
  assert.equal(P.tipoDoMaterial('VÁLVULA LUXO C/SOBRETAMPA'), 'Tampas/Válvulas', 'válvula vence frasco quando o nome cita os dois');
  assert.equal(P.tipoDoMaterial('BULBO SILICONE'), 'Tampas/Válvulas');
  assert.equal(P.tipoDoMaterial('CAIXA MASTER'), 'Caixa de Embarque');
  assert.equal(P.tipoDoMaterial('CARTUCHO 30ML'), 'Cartuchos');
  assert.equal(P.tipoDoMaterial('FILME TERMO', 'ES-00400'), 'Rótulos', 'ES sem palavra-chave: embalagem secundária');
  assert.equal(P.tipoDoMaterial('ÁLCOOL 96', 'MPGR-00127'), 'Outro');
});

t('envase: todos os insumos de embalagem da OP, matéria-prima fora, na ordem frasco → rótulo → válvula → caixa', () => {
  const r = P.insumosDaEtapa('envase', opNova, [], materiais);
  assert.deepEqual(r.principais.map((i) => i.materialCodigo), ['EP-00106', 'ES-00311', 'EP-00174', 'ET-00032']);
  assert.deepEqual(r.outros, []);
  assert.equal(r.principais[0].unidade, 'un');
});

t('rotulagem: frascos e rótulos em cima, o resto em "outros"', () => {
  const r = P.insumosDaEtapa('rotulagem', opNova, [], materiais);
  assert.deepEqual(r.principais.map((i) => i.materialCodigo), ['EP-00106', 'ES-00311']);
  assert.deepEqual(r.outros.map((i) => i.materialCodigo), ['EP-00174', 'ET-00032']);
  assert.equal(P.etapaDoSetor('rotulagem'), 'rotulagem');
  assert.equal(P.etapaDoSetor('linha'), 'envase');
  assert.equal(P.etapaDoSetor(undefined), 'envase');
  assert.equal(P.etapaDoSetor('posto'), 'envase');
});

t('OP antiga sem materiaisConsumo usa o BOM do SKU (nome/unidade do cadastro, código vazio fora, sem repetir)', () => {
  const bom = [{materialCodigo: 'ES-00400', posicao: 3}, {materialCodigo: 'EP-00106', materialNome: 'FRASCO PET 200ML', posicao: 1},
    {materialCodigo: ' ', posicao: 2}, {materialCodigo: 'EP-00106', posicao: 4}];
  const r = P.insumosDaEtapa('envase', {sku: 'X'}, bom, materiais);
  assert.deepEqual(J(r.principais), [
    {materialCodigo: 'EP-00106', materialNome: 'FRASCO PET 200ML', unidade: 'un', tipo: 'Frascos'},
    {materialCodigo: 'ES-00400', materialNome: 'FILME TERMOENCOLHIVEL', unidade: 'm', tipo: 'Rótulos'}]);
  assert.deepEqual(P.insumosDaEtapa('envase', {sku: 'X'}, [], materiais).principais, [], 'sem BOM: lista vazia, a tela oferece "+ Outra perda"');
});

t('peso por unidade só com dado real (OP > volume×densidade da OP > cadastro); sem densidade não converte', () => {
  assert.equal(P.kgPorUnidade({pesoTeoricoUnG: 204}), 0.204);
  assert.equal(P.kgPorUnidade({volumeTeoricoUnMl: 200, densidadeGranelUsada: 1.02}), 0.204);
  assert.equal(Math.round(P.kgPorUnidade({}, {densidadeGranel: 1, volume: 200, unidadeVolume: 'ml', overfillPct: 2}) * 1000) / 1000, 0.204);
  assert.equal(P.kgPorUnidade({}, {densidadeGranel: 0.9, volume: 1, unidadeVolume: 'L'}), 0.9);
  assert.equal(P.kgPorUnidade({}, {densidadeGranel: -1, volume: 200, unidadeVolume: 'ml'}), null, 'densidade -1 (marcador de "não informado")');
  assert.equal(P.kgPorUnidade({}, {densidadeGranel: 1, volume: 200, unidadeVolume: 'g'}), null, 'unidade que não é volume');
  assert.equal(P.kgPorUnidade({}, null), null);
});

t('lista gravada no formato de sempre: categoria, quantidade, material; produto como registro', () => {
  const linhas = [
    {materialCodigo: 'EP-00106', materialNome: 'FRASCO PET 200ML', unidade: 'un', tipo: 'Frascos', qtd: '12'},
    {materialCodigo: 'ES-00311', materialNome: 'ROTULO HIDRATANTE', unidade: 'un', tipo: 'Rótulos', qtd: ''},
    {materialCodigo: 'ES-00400', materialNome: 'FILME', unidade: 'm', tipo: 'Rótulos', qtd: '2,5'}];
  const extra = [{tipo: 'Outro', quantidade: 3, especificacao: 'fita'}];
  const out = P.montarPerdas('envase', linhas, {unidades: '40', bulkKg: '1,5'}, extra, 0.204);
  assert.deepEqual(J(out), [
    {tipo: 'Frascos', quantidade: 12, especificacao: 'FRASCO PET 200ML', materialCodigo: 'EP-00106', materialNome: 'FRASCO PET 200ML', unidade: 'un', etapa: 'envase'},
    {tipo: 'Rótulos', quantidade: 2.5, especificacao: 'FILME', materialCodigo: 'ES-00400', materialNome: 'FILME', unidade: 'm', etapa: 'envase'},
    {tipo: 'Produto envasado (un)', quantidade: 40, unidade: 'un', produto: true, etapa: 'envase',
      especificacao: 'unidades envasadas descartadas (≈ 8,16 kg de bulk)', kgEquivalente: 8.16},
    {tipo: 'Bulk (kg)', quantidade: 1.5, unidade: 'kg', produto: true, etapa: 'envase', especificacao: 'bulk perdido fora do frasco (≈ 7 un)'},
    {tipo: 'Outro', quantidade: 3, especificacao: 'fita'}]);
  assert.ok(out.filter((p) => p.produto).every((p) => !p.materialCodigo), 'produto não tem material: nunca baixa estoque');
  assert.deepEqual(P.montarPerdas('envase', [], {unidades: '', bulkKg: ''}, [], null), []);
  const sem = P.montarPerdas('envase', [], {unidades: '10'}, [], null);
  assert.equal(sem[0].especificacao, 'unidades envasadas descartadas');
  assert.equal('kgEquivalente' in sem[0], false);
});

t('valida: negativo ou texto é erro, vazio é zero', () => {
  assert.equal(P.validarLinhas([{materialNome: 'FRASCO', qtd: ''}, {materialNome: 'ROTULO', qtd: '3'}], {}).ok, true);
  assert.deepEqual(P.validarLinhas([{materialNome: 'FRASCO', qtd: '-2'}, {materialNome: 'ROTULO', qtd: 'abc'}], {bulkKg: 'x'}).erros,
    ['FRASCO: quantidade inválida.', 'ROTULO: quantidade inválida.', 'Bulk perdido: quantidade inválida.']);
});

t('manipulação: perda por MP não passa do pesado; zeros somem', () => {
  const linhas = [{itemKey: 'a', nome: 'ÁGUA', pesado: 200}, {itemKey: 'b', nome: 'ESSENCIA', pesado: 1.5}];
  assert.equal(P.validarPerdasMp(linhas, {a: '2', b: ''}).ok, true);
  assert.deepEqual(P.validarPerdasMp(linhas, {a: '-1', b: '1,6'}).erros, ['ÁGUA: perda inválida.', 'ESSENCIA: perda (1.6) maior que o pesado (1.5).']);
  assert.deepEqual(P.limparPerdasMp({a: '2', b: '0', c: '', d: '0,25'}), {a: 2, d: 0.25});
});

t('resumo da manipulação: perda por MP entra nas perdas declaradas; perda de processo não muda', () => {
  const previstos = {a: {mpCodigo: 'MPGR-1', mpNome: 'ÁGUA', previsto: 100}, b: {mpCodigo: 'MPES-1', mpNome: 'ESSENCIA', previsto: 2}};
  const fase = {pesagem: {itens: {a: {pesado: 100}, b: {pesado: 2}}},
    manipulacao: {rendimento: 97, perdas: {residuo_tacho: 1, amostra: 0.5, outra: 0}, perdasMp: {b: 0.5}}};
  const r = M.resumoManipulacao(previstos, fase);
  assert.equal(r.perdasMp, 0.5);
  assert.equal(r.perdasManipulacao, 2);
  assert.equal(r.perdaProcesso, 5, '102 pesado − 97 obtido');
  assert.equal(M.resumoManipulacao(previstos, {pesagem: fase.pesagem, manipulacao: {rendimento: 97}}).perdasManipulacao, 0);
});

console.log(`\n${n} testes ok`);
