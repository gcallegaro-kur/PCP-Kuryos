/* Especificação de MP criada na análise do CQ (decisões do usuário em
   2026-09-23): plano fixo de 6 ensaios com NA, spec do MATERIAL (não do
   fornecedor) e casamento dos laudos antigos por NOME, porque os códigos do
   laboratório não batem com os do sistema. */
const assert = require('assert');
const path = require('path');
const S = require(path.join(__dirname, 'public', 'shared', 'spec-material.js'));

const materiais = {
  m1: {mpCodigo: 'MPGR-00127', mpNome: 'ALCOOL 96 GL', tipo: 'MPGR'},
  m2: {mpCodigo: 'MPGR-00003', mpNome: 'ÁLCOOL EXTRA NEUTRO 96°G/L', tipo: 'MPGR'},
  m3: {mpCodigo: 'MPGR-00050', mpNome: 'ALCOOL CETOESTEARILICO', tipo: 'MPGR'},
  m4: {mpCodigo: 'MPES-00005', mpNome: 'ESSENCIA ZAIM PLUS', tipo: 'MPES'},
  m5: {mpCodigo: 'EP-00009', mpNome: 'VALVULA SPRAY', tipo: 'EP'},
  m6: {mpCodigo: 'MPGR-00128', mpNome: 'ALCALIN 85 TRIETANOLAMINA', tipo: 'MPGR'}
};

// ── Plano fixo, com NA ──────────────────────────────────────────────────
{
  assert.deepEqual(S.PLANO_MP.map((p) => p.ensaio),
    ['Aspecto físico', 'Cor', 'Odor', 'pH', 'Densidade', 'Teor alcoólico'],
    'os seis ensaios que o usuário definiu, nesta ordem');

  const vazio = S.planoDoMaterial(null);
  assert.equal(vazio.length, 6);
  assert.ok(vazio.every((l) => l.especificacaoTexto === 'NA'), 'material sem spec nasce todo NA');
  assert.ok(vazio.every((l) => !l.aplicavel));
  assert.equal(vazio[0].metodo, 'Visual', 'o método padrão de cada ensaio já vem preenchido');

  const comDados = S.planoDoMaterial({
    aspecto: {especificacaoTexto: 'Líquido límpido', metodo: 'Visual'},
    ph: {especificacaoTexto: '6,0 a 8,0', minimo: 6, maximo: 8, critico: true},
    cor: {especificacaoTexto: 'NA'}
  });
  const porChave = Object.fromEntries(comDados.map((l) => [l.chave, l]));
  assert.equal(porChave.aspecto.aplicavel, true);
  assert.equal(porChave.ph.minimo, 6);
  assert.equal(porChave.ph.critico, true);
  assert.equal(porChave.cor.aplicavel, false, 'NA não é ensaio: não reprova lote');
  assert.equal(porChave.densidade.especificacaoTexto, 'NA', 'o que não foi preenchido fica NA');
  assert.equal(porChave.ph.numerico, true);
  assert.equal(porChave.aspecto.numerico, false);
}

// ── Validação ───────────────────────────────────────────────────────────
{
  const ok = S.validarPlano(S.planoDoMaterial({aspecto: {especificacaoTexto: 'Líquido límpido'}}));
  assert.equal(ok.ok, true, ok.erros.join(' '));
  assert.equal(ok.aplicaveis, 1);

  const tudoNa = S.validarPlano(S.planoDoMaterial(null));
  assert.equal(tudoNa.ok, false);
  assert.match(tudoNa.erros[0], /todos em NA não é especificação/);

  const faixaInvertida = S.validarPlano([{ensaio: 'pH', especificacaoTexto: '6 a 8', minimo: 8, maximo: 6}]);
  assert.match(faixaInvertida.erros[0], /mínimo é maior que o máximo/);

  const semTexto = S.validarPlano([{ensaio: 'Cor', especificacaoTexto: ''}]);
  assert.match(semTexto.erros[0], /preencha a especificação ou marque NA/);
}

// ── Casamento por nome: os códigos não batem ────────────────────────────
{
  const exato = S.casarMaterial('ALCOOL 96 GL', materiais);
  assert.equal(exato.achou, true);
  assert.equal(exato.escolhido.codigo, 'MPGR-00127');
  assert.equal(exato.confianca, 'EXATO');

  // Nome do laudo com palavras a mais/menos ainda acha.
  const parcial = S.casarMaterial('Alcool Cetoestearilico', materiais);
  assert.equal(parcial.escolhido.codigo, 'MPGR-00050');
  assert.ok(['EXATO', 'ALTA'].includes(parcial.confianca), parcial.confianca);

  // Acento e caixa não atrapalham.
  assert.equal(S.casarMaterial('álcool extra neutro 96°g/l', materiais).escolhido.codigo, 'MPGR-00003');

  // Embalagem nunca entra: tem outro formulário (F009).
  assert.equal(S.casarMaterial('VALVULA SPRAY', materiais).achou, false);

  // Sem parecido nenhum, não inventa.
  const nada = S.casarMaterial('MATERIAL QUE NAO EXISTE AQUI', materiais);
  assert.equal(nada.achou, false);

  // Empate técnico vira revisão manual em vez de palpite.
  const doisIguais = {a: {mpCodigo: 'X1', mpNome: 'BASE DERM SKIN 12', tipo: 'MPGR'},
    b: {mpCodigo: 'X2', mpNome: 'BASE DERM SKIN 15', tipo: 'MPGR'}};
  const ambiguo = S.casarMaterial('BASE DERM SKIN', doisIguais);
  assert.equal(ambiguo.confianca, 'AMBIGUO');
  assert.equal(ambiguo.achou, false, 'ambíguo não grava sozinho');
  assert.equal(ambiguo.candidatos.length, 2, 'mostra as opções para a analista escolher');

  // A similaridade é explicável: mais palavras em comum, maior o número.
  assert.ok(S.similaridade('ALCOOL CEREAIS', 'ALCOOL DE CEREAIS 96') > S.similaridade('ALCOOL CEREAIS', 'ALCOOL CETOESTEARILICO'));
  assert.equal(S.similaridade('', 'QUALQUER'), 0);
}

// ── O que grava ─────────────────────────────────────────────────────────
{
  const linhas = S.planoDoMaterial({
    aspecto: {especificacaoTexto: 'Líquido límpido', metodo: 'Visual'},
    odor: {especificacaoTexto: 'Característico', metodo: 'Olfativo'},
    teor_alcoolico: {especificacaoTexto: '96% mínimo', minimo: 96, critico: true}
  });
  const r = S.atualizacoes('MPGR-00127', linhas, {versaoAtual: 0, por: 'Roberta', agora: '2026-09-23T12:00:00Z'});
  assert.equal(r.chave, 'MPGR-00127__v1');
  const gravado = r.updates['especificacoes/MPGR-00127__v1'];
  assert.equal(gravado.codProduto, 'MPGR-00127', 'mesma chave que especificacaoVigente lê');
  assert.equal(gravado.tipoItem, 'MATERIAL');
  assert.equal(gravado.status, 'APROVADA');
  assert.equal(gravado.origem, 'ANALISE_CQ', 'nasce na análise, como o usuário pediu');
  assert.equal(gravado.criadoPor, 'Roberta');
  assert.equal(gravado.itens.aspecto.especificacaoTexto, 'Líquido límpido');
  assert.equal(gravado.itens.teor_alcoolico.minimo, 96);
  assert.equal(gravado.itens.teor_alcoolico.critico, true);
  assert.equal(gravado.itens.cor.aplicavel, false, 'NA fica gravado como não aplicável, não some');
  assert.equal(gravado.itens.ph.especificacaoTexto, 'NA');

  // Editar gera versão nova: o laudo antigo continua apontando para a dele.
  const r2 = S.atualizacoes('MPGR-00127', linhas, {versaoAtual: 1, por: 'Roberta'});
  assert.equal(r2.chave, 'MPGR-00127__v2');
  assert.equal(r2.versao, 2);
  // Caminhos planos, como o RTDB exige.
  Object.keys(r2.updates).forEach((k) => assert.ok(k.indexOf('especificacoes/') === 0, k));
}

console.log('run_spec_material_test.js: OK');
