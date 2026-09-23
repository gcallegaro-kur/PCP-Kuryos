const assert = require('assert');
const path = require('path');
const M = require(path.join(__dirname, 'public', 'shared', 'manipulacao.js'));

const previstos = {
  'MP-01': {mpCodigo: 'MP-01', mpNome: 'ALCOOL CEREAIS', unidade: 'kg', previsto: 60},
  'MP-02': {mpCodigo: 'MP-02', mpNome: 'AGUA DEIONIZADA', unidade: 'kg', previsto: 35},
  'MP-03': {mpCodigo: 'MP-03', mpNome: 'FRAGRANCIA LEAO', unidade: 'kg', previsto: 5}
};
// Uma foto por MP (pedido do usuário em 17/09).
const umaFoto = (mp) => ({['-F' + mp]: {nomeOriginal: mp + '.jpg', caminho: 'manipulacao/26260-01/1_' + mp + '.jpg', bytes: 1200}});
const foto = {'MP-01': umaFoto('MP-01'), 'MP-02': umaFoto('MP-02'), 'MP-03': umaFoto('MP-03')};
const pesagemOk = {
  inicio: '2026-09-17T12:00:00Z', fim: '2026-09-17T12:30:00Z', por: 'Operador João', fotosItens: foto,
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
  assert.ok(vazia.erros.some((e) => /3 matéria/.test(e)), vazia.erros.join(' | '));

  // Sem foto a pesagem não fecha, e a foto é POR MP.
  const semFoto = M.validarPesagem(previstos, Object.assign({}, pesagemOk, {fotosItens: {}}));
  assert.equal(semFoto.ok, false);
  assert.match(semFoto.erros[0], /Falta a foto da pesagem de MP-02, MP-01, MP-03/);
  const faltaUma = M.validarPesagem(previstos, Object.assign({}, pesagemOk, {fotosItens: {'MP-01': foto['MP-01'], 'MP-02': foto['MP-02']}}));
  assert.equal(faltaUma.ok, false);
  assert.match(faltaUma.erros[0], /Falta a foto da pesagem de MP-03 \(/);
  // Foto geral da pesagem (formato anterior) não substitui a da MP.
  const soGeral = M.validarPesagem(previstos, Object.assign({}, pesagemOk, {fotosItens: {}, fotos: umaFoto('geral')}));
  assert.equal(soGeral.ok, false);
  assert.equal(M.EXIGE_FOTO_PESAGEM, true);
  assert.equal(M.fotosDoItem(pesagemOk, 'MP-02').length, 1);

  const semLote = M.validarPesagem(previstos, {fotosItens: foto, itens: {'MP-01': {pesado: 60}, 'MP-02': {pesado: 35}, 'MP-03': {pesado: 5}}});
  assert.ok(semLote.erros.some((e) => /Informe o lote usado de MP-01/.test(e)), 'lote do material é obrigatório');

  const ok = M.validarPesagem(previstos, pesagemOk);
  assert.equal(ok.ok, true, ok.erros.join(' '));
  const linha = ok.linhas.find((l) => l.mpCodigo === 'MP-03');
  assert.equal(linha.desvioPct, 1, '5,05 em 5 = +1%');
  assert.equal(linha.foraTolerancia, false, 'dentro dos 2%');

  // Fora da tolerância exige justificativa.
  const fora = {fotosItens: foto, itens: Object.assign({}, pesagemOk.itens, {'MP-03': {pesado: 5.6, loteMaterial: 'AK-1'}})};
  const semJust = M.validarPesagem(previstos, fora);
  assert.equal(semJust.ok, false);
  assert.match(semJust.erros[0], /MP-03 está 12% fora do previsto/);
  const comJust = M.validarPesagem(previstos, {fotosItens: foto, itens: Object.assign({}, fora.itens, {'MP-03': {pesado: 5.6, loteMaterial: 'AK-1', justificativa: 'Ajuste de fragrância autorizado'}})});
  assert.equal(comJust.ok, true);
  assert.match(comJust.avisos[0], /12% fora do previsto/);
}

// ── Pesagem em parcelas: várias idas à balança somam o total ─────────────
{
  const f = (id) => ({caminho: 'manipulacao/26260-01/' + id + '.jpg', url: 'https://x/' + id});
  const parcelas = {
    'MP-01': {
      '-a': {peso: 25, loteMaterial: 'AK-576', foto: f('a'), em: '2026-09-18T10:00:00Z', por: 'João'},
      '-b': {peso: 25, loteMaterial: 'AK-576', foto: f('b'), em: '2026-09-18T10:05:00Z', por: 'João'},
      '-c': {peso: 10.2, loteMaterial: 'AK-590', foto: f('c'), em: '2026-09-18T10:09:00Z', por: 'João'},
      // Parcela errada: cancelada com motivo, não soma e não some do registro.
      '-x': {peso: 250, loteMaterial: 'AK-576', foto: f('x'), em: '2026-09-18T10:01:00Z', por: 'João',
             canceladaEm: '2026-09-18T10:02:00Z', canceladaPor: 'João', motivoCancelamento: 'Digitei 250 em vez de 25'}
    },
    'MP-02': {'-d': {peso: 35, loteMaterial: 'AK-577', foto: f('d'), em: '2026-09-18T10:12:00Z'}}
  };
  const pes = {parcelas, itens: {}};
  const linhas = M.linhasPesagem(previstos, pes);
  const mp1 = linhas.find((l) => l.mpCodigo === 'MP-01');
  assert.equal(mp1.pesado, 60.2, '25 + 25 + 10,2, sem a cancelada');
  assert.equal(mp1.parcelas, 3);
  assert.equal(mp1.loteMaterial, 'AK-576, AK-590', 'os dois lotes usados, sem repetir');
  assert.equal(mp1.fotos, 3);
  assert.equal(mp1.falta, 0);
  assert.equal(mp1.excesso, 0.2);
  const mp3 = linhas.find((l) => l.mpCodigo === 'MP-03');
  assert.equal(mp3.pendente, true);
  assert.equal(mp3.falta, 5, 'nada pesado: falta o previsto inteiro');

  // Meio caminho: mostra quanto falta.
  const meio = M.linhasPesagem(previstos, {parcelas: {'MP-01': {'-a': parcelas['MP-01']['-a']}}});
  assert.equal(meio.find((l) => l.mpCodigo === 'MP-01').falta, 35);

  // Ordem cronológica e a cancelada só aparece quando pedida.
  assert.deepEqual(M.parcelasDoItem(pes, 'MP-01').map((p) => p.id), ['-a', '-b', '-c']);
  assert.deepEqual(M.parcelasDoItem(pes, 'MP-01', true).map((p) => p.id), ['-a', '-x', '-b', '-c']);
  // Fotos da linha vêm das parcelas, numeradas.
  const fotos = M.fotosDaLinha(pes, 'MP-01');
  assert.deepEqual(fotos.map((x) => x.parcela), [1, 2, 3]);
  assert.equal(fotos[2].peso, 10.2);

  // Falta a MP-03 -> não fecha; completando, fecha.
  assert.equal(M.validarPesagem(previstos, pes).ok, false);
  pes.parcelas['MP-03'] = {'-e': {peso: 5, loteMaterial: 'AK-578', foto: f('e'), em: '2026-09-18T10:20:00Z'}};
  const ok = M.validarPesagem(previstos, pes);
  assert.equal(ok.ok, true, ok.erros.join(' '));

  // Parcela gravada sem foto (não deveria acontecer, mas o fechamento barra).
  const semFoto = JSON.parse(JSON.stringify(pes));
  delete semFoto.parcelas['MP-02']['-d'].foto;
  assert.match(M.validarPesagem(previstos, semFoto).erros.join(' '), /Falta a foto da pesagem de MP-02/);

  // O fechamento grava o total somado e os lotes.
  pes.itens = {'MP-01': {perda: 0.1, justificativa: ''}};
  const fech = M.itensParaFechamento(previstos, pes);
  assert.deepEqual(fech['MP-01'], {pesado: 60.2, loteMaterial: 'AK-576, AK-590', parcelas: 3, perda: 0.1, justificativa: null});
  assert.equal(fech['MP-03'].pesado, 5);

  // Baixa por lote: 25 + 25 do AK-576 numa baixa, 10,2 do AK-590 em outra.
  assert.deepEqual(M.baixasPorLote(previstos, pes).filter((b) => b.itemKey === 'MP-01').map((b) => [b.loteMaterial, b.qtd]),
    [['AK-576', 50], ['AK-590', 10.2]]);
  assert.deepEqual(M.baixasPorLote(previstos, pesagemOk).find((b) => b.itemKey === 'MP-03'),
    {itemKey: 'MP-03', mpCodigo: 'MP-03', loteMaterial: 'AK-2026-000578', qtd: 5.05}, 'formato antigo: um grupo por MP');

  // Ordem da fórmula manda na lista; próxima pendente dá a volta.
  const ordenados = {'MP-01': Object.assign({ordem: 2}, previstos['MP-01']), 'MP-02': Object.assign({ordem: 0}, previstos['MP-02']),
    'MP-03': Object.assign({ordem: 1}, previstos['MP-03'])};
  assert.deepEqual(M.linhasPesagem(ordenados, {}).map((l) => l.mpCodigo), ['MP-02', 'MP-03', 'MP-01']);
  const meioCaminho = {parcelas: {'MP-02': {'-z': {peso: 35, loteMaterial: 'L', foto: f('z')}}}};
  assert.equal(M.proximaPendente(ordenados, meioCaminho, 'MP-02'), 'MP-03');
  assert.equal(M.proximaPendente(ordenados, meioCaminho, 'MP-01'), 'MP-03', 'dá a volta e pula a completa');
  assert.equal(M.proximaPendente(ordenados, pes, 'MP-01'), null, 'tudo pesado');

  // FEFO indicado: quanto de cada lote, e qual é o próximo.
  const plano = [{loteInterno: 'AK-576', qtd: 50, enderecos: ['FAB-1.1.1'], dataValidade: '2027-01-01'},
                 {loteInterno: 'AK-590', qtd: 10, enderecos: ['FAB-2.1.1']}];
  const sit0 = M.situacaoLotes(plano, []);
  assert.equal(sit0.sugerido.loteInterno, 'AK-576');
  const sit = M.situacaoLotes(plano, M.parcelasDoItem(pes, 'MP-01'));
  assert.deepEqual(sit.linhas.map((l) => [l.loteInterno, l.pesado, l.falta]), [['AK-576', 50, 0], ['AK-590', 10.2, 0]]);
  assert.equal(sit.sugerido, null, 'plano cumprido');
  const sitMeio = M.situacaoLotes(plano, [{peso: 25, loteMaterial: 'AK-576'}, {peso: 3, loteMaterial: 'AK-999'}]);
  assert.equal(sitMeio.sugerido.loteInterno, 'AK-576');
  assert.equal(sitMeio.sugerido.falta, 25);
  assert.deepEqual(sitMeio.fora, [{loteInterno: 'AK-999', pesado: 3}], 'lote fora do FEFO aparece separado');
  // Fora do FEFO só com motivo; sem plano (material fora do WMS), qualquer lote.
  assert.match(M.validarParcela({peso: 5, loteMaterial: 'AK-999', temFoto: true}, plano).erros[0], /O FEFO indica AK-576, AK-590\. Para usar outro lote, informe o motivo/);
  assert.equal(M.validarParcela({peso: 5, loteMaterial: 'AK-999', temFoto: true, motivoForaFefo: 'Tambor do AK-576 contaminado'}, plano).ok, true);
  assert.equal(M.validarParcela({peso: 5, loteMaterial: 'AK-576', temFoto: true}, plano).ok, true);
  assert.equal(M.validarParcela({peso: 5, loteMaterial: 'QUALQUER', temFoto: true}, []).ok, true);

  // Guardar de volta: quem pesou é quem devolve a embalagem ao endereço.
  assert.deepEqual(M.pendentesDevolucao(previstos, pes).map((x) => x.mpCodigo), ['MP-02', 'MP-01', 'MP-03'],
    'toda MP pesada precisa ser confirmada como guardada');
  const comDevolucao = Object.assign({}, pes, {devolucoes: {'MP-01': {em: '2026-09-18T11:00:00Z', por: 'João', enderecoCodigo: 'FAB-1.1.1'}}});
  assert.deepEqual(M.pendentesDevolucao(previstos, comDevolucao).map((x) => x.mpCodigo), ['MP-02', 'MP-03']);
  assert.equal(M.devolucaoDoItem(comDevolucao, 'MP-01').enderecoCodigo, 'FAB-1.1.1');
  assert.deepEqual(M.pendentesDevolucao(previstos, {}), [], 'sem pesagem, nada a guardar');

  // Validação de uma ida à balança.
  assert.deepEqual(M.validarParcela({}).erros, ['Informe o peso que a balança mostrou.', 'Informe o lote da embalagem usada.', 'Tire a foto da balança.']);
  assert.equal(M.validarParcela({peso: '12,5'}).ok, false, 'vírgula chega convertida pela tela');
  assert.equal(M.validarParcela({peso: 12.5, loteMaterial: 'AK-1', temFoto: true}).ok, true);
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
  assert.deepEqual(M.acoesDisponiveis({manipulacao: {status: 'PESADO'}}), ['CONFERIR', 'LIBERAR_SEM_CONFERENCIA']);
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
