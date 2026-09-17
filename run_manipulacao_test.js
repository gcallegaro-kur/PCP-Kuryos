const assert = require('assert');
const path = require('path');
const M = require(path.join(__dirname, 'public', 'shared', 'manipulacao.js'));

const previstos = {
  'MP-01': {mpCodigo: 'MP-01', mpNome: 'ALCOOL CEREAIS', unidade: 'kg', previsto: 60},
  'MP-02': {mpCodigo: 'MP-02', mpNome: 'AGUA DEIONIZADA', unidade: 'kg', previsto: 35},
  'MP-03': {mpCodigo: 'MP-03', mpNome: 'FRAGRANCIA LEAO', unidade: 'kg', previsto: 5}
};
const pesagemOk = {
  inicio: '2026-09-17T12:00:00Z', fim: '2026-09-17T12:30:00Z', por: 'Operador João',
  itens: {
    'MP-01': {pesado: 60, loteMaterial: 'AK-2026-000576'},
    'MP-02': {pesado: 35, loteMaterial: 'AK-2026-000577'},
    'MP-03': {pesado: 5.05, loteMaterial: 'AK-2026-000578'}
  }
};

// ── Portão do envase ────────────────────────────────────────────────────
{
  // OP antiga, sem fase de granel: continua podendo envasar (a fábrica não para).
  assert.equal(M.podeEnvasar({lote: '26257/17'}).ok, true);
  // Com a exigência ligada, nem a antiga passa.
  assert.equal(M.podeEnvasar({lote: '26257/17'}, {exigirSempre: true}).ok, false);
  // Com fase, só libera no LIBERADO.
  ['AGUARDANDO_PESAGEM', 'PESADO', 'CONFERIDO', 'EM_MANIPULACAO', 'AGUARDANDO_CQ'].forEach((st) => {
    const r = M.podeEnvasar({manipulacao: {status: st}});
    assert.equal(r.ok, false, st + ' não pode envasar');
    assert.match(r.motivo, /não liberado/);
  });
  assert.equal(M.podeEnvasar({manipulacao: {status: 'LIBERADO'}}).ok, true);
  const rep = M.podeEnvasar({manipulacao: {status: 'REPROVADO'}});
  assert.equal(rep.ok, false);
  assert.match(rep.motivo, /reprovado/i);
}

// ── Pesagem ─────────────────────────────────────────────────────────────
{
  const vazia = M.validarPesagem(previstos, {itens: {}});
  assert.equal(vazia.ok, false);
  assert.match(vazia.erros[0], /3 matéria/);

  const semLote = M.validarPesagem(previstos, {itens: {'MP-01': {pesado: 60}, 'MP-02': {pesado: 35}, 'MP-03': {pesado: 5}}});
  assert.ok(semLote.erros.some((e) => /Informe o lote usado de MP-01/.test(e)), 'lote do material é obrigatório');

  const ok = M.validarPesagem(previstos, pesagemOk);
  assert.equal(ok.ok, true, ok.erros.join(' '));
  const linha = ok.linhas.find((l) => l.mpCodigo === 'MP-03');
  assert.equal(linha.desvioPct, 1, '5,05 em 5 = +1%');
  assert.equal(linha.foraTolerancia, false, 'dentro dos 2%');

  // Fora da tolerância exige justificativa.
  const fora = {itens: Object.assign({}, pesagemOk.itens, {'MP-03': {pesado: 5.6, loteMaterial: 'AK-1'}})};
  const semJust = M.validarPesagem(previstos, fora);
  assert.equal(semJust.ok, false);
  assert.match(semJust.erros[0], /MP-03 está 12% fora do previsto/);
  const comJust = M.validarPesagem(previstos, {itens: Object.assign({}, fora.itens, {'MP-03': {pesado: 5.6, loteMaterial: 'AK-1', justificativa: 'Ajuste de fragrância autorizado'}})});
  assert.equal(comJust.ok, true);
  assert.match(comJust.avisos[0], /12% fora do previsto/);
}

// ── Conferência: outra pessoa, obrigatória ──────────────────────────────
{
  const conferidoTudo = {'MP-01': {ok: true}, 'MP-02': {ok: true}, 'MP-03': {ok: true}};
  const mesmaPessoa = M.validarConferencia(previstos, {pesagem: pesagemOk, conferencia: {itens: conferidoTudo}}, 'Operador João');
  assert.equal(mesmaPessoa.ok, false);
  assert.match(mesmaPessoa.erros[0], /não pode ser quem pesou/);

  const semNome = M.validarConferencia(previstos, {pesagem: pesagemOk, conferencia: {itens: conferidoTudo}}, '');
  assert.match(semNome.erros[0], /Identifique quem está conferindo/);

  const incompleta = M.validarConferencia(previstos, {pesagem: pesagemOk, conferencia: {itens: {'MP-01': {ok: true}}}}, 'Manipuladora Ana');
  assert.equal(incompleta.ok, false);
  assert.match(incompleta.erros[0], /2 item\(ns\) sem conferência/);

  const divergente = M.validarConferencia(previstos, {pesagem: pesagemOk,
    conferencia: {itens: {'MP-01': {ok: true}, 'MP-02': {ok: true}, 'MP-03': {ok: false, obs: 'Lote diferente do pesado'}}}}, 'Manipuladora Ana');
  assert.equal(divergente.ok, false);
  assert.equal(divergente.bloqueiaManipulacao, true);
  assert.equal(divergente.divergencias[0].mpCodigo, 'MP-03');

  const divSemObs = M.validarConferencia(previstos, {pesagem: pesagemOk,
    conferencia: {itens: {'MP-01': {ok: true}, 'MP-02': {ok: true}, 'MP-03': {ok: false}}}}, 'Manipuladora Ana');
  assert.ok(divSemObs.erros.some((e) => /precisa de descrição/.test(e)));

  const boa = M.validarConferencia(previstos, {pesagem: pesagemOk, conferencia: {itens: conferidoTudo}}, 'Manipuladora Ana');
  assert.equal(boa.ok, true, boa.erros.join(' '));
}

// ── Manipulação: tempos, perdas e rendimento ────────────────────────────
{
  const faseCompleta = {
    pesagem: pesagemOk,
    manipulacao: {inicio: '2026-09-17T13:00:00Z', fim: '2026-09-17T15:30:00Z', por: 'Manipuladora Ana',
      rendimento: 97, perdas: {residuo_tacho: 1.5, amostra: 0.5}}
  };
  const r = M.resumoManipulacao(previstos, faseCompleta);
  assert.equal(r.pesadoTotal, 100.05);
  assert.equal(r.previstoTotal, 100);
  assert.equal(r.rendimento, 97);
  assert.equal(r.perdaProcesso, 3.05);
  assert.equal(r.perdaProcessoPct, 3.05);
  assert.equal(r.perdasManipulacao, 2);
  assert.equal(r.minutosPesagem, 30);
  assert.equal(r.minutosManipulacao, 150);
  assert.equal(r.minutosTotal, 210, 'do início da pesagem ao fim da manipulação');

  const semRendimento = M.validarFechamentoManipulacao(previstos, {pesagem: pesagemOk, manipulacao: {inicio: '2026-09-17T13:00:00Z'}});
  assert.equal(semRendimento.ok, false);
  assert.match(semRendimento.erros[0], /rendimento/);

  const impossivel = M.validarFechamentoManipulacao(previstos, {pesagem: pesagemOk,
    manipulacao: {inicio: '2026-09-17T13:00:00Z', rendimento: 120}});
  assert.equal(impossivel.ok, false);
  assert.match(impossivel.erros[0], /maior que o total pesado/);

  const perdaAlta = M.validarFechamentoManipulacao(previstos, {pesagem: pesagemOk,
    manipulacao: {inicio: '2026-09-17T13:00:00Z', rendimento: 90}});
  assert.equal(perdaAlta.ok, true, 'perda alta avisa, não impede');
  assert.match(perdaAlta.avisos[0], /acima de 5%/);

  assert.equal(M.validarFechamentoManipulacao(previstos, faseCompleta).ok, true);
}

// ── Estados e transições ────────────────────────────────────────────────
{
  assert.deepEqual(M.acoesDisponiveis({}), ['INICIAR_PESAGEM']);
  assert.deepEqual(M.acoesDisponiveis({manipulacao: {status: 'PESADO'}}), ['CONFERIR']);
  assert.deepEqual(M.acoesDisponiveis({manipulacao: {status: 'AGUARDANDO_CQ'}}), ['LIBERAR', 'REPROVAR']);
  assert.deepEqual(M.acoesDisponiveis({manipulacao: {status: 'LIBERADO'}}), []);

  const t = M.transicao('FECHAR_PESAGEM', {quem: 'Operador João', agora: '2026-09-17T12:30:00Z'});
  assert.equal(t.status, 'PESADO');
  assert.equal(t['pesagem/baixaAplicada'], true, 'marca que a baixa de estoque já saiu na pesagem');
  assert.equal(M.transicao('LIBERAR', {quem: 'Daiene'})['analise/decisao'], 'LIBERADO');
  assert.equal(M.transicao('NAO_EXISTE', {}), null);
  assert.equal(M.rotulo('EM_MANIPULACAO'), 'Em manipulação');
}

console.log('run_manipulacao_test.js: OK');
