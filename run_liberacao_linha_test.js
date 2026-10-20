'use strict';
/* Liberação de linha (19/10/2026) -- shared/liberacao-linha.js (CK-4 + CK-5). */
const assert = require('node:assert/strict');
const L = require('./public/shared/liberacao-linha.js');
const C = require('./public/shared/checklists.js');
const P = require('./public/shared/checklists-modelos-padrao.js');
let n = 0; const ok = (nome, fn) => { fn(); n++; console.log('ok -', nome); };

const pub = (m) => { const r = C.publicar('x', null, m.itens, {agora: 't0'}); return {codigo: m.codigo, nome: m.nome, versaoAtual: 1, versoes: {1: r.updates['checklist_modelos/x/versoes/1']}}; };
const CK4 = pub(P.MODELOS[1]), CK5 = pub(P.MODELOS[2]);
const itens4 = CK4.versoes[1].itens, itens5 = CK5.versoes[1].itens;
const op = {lote: '26290/01', sku: 'HDR-MISS-0003', produto: 'HIDRATANTE', linha: 'Linha 1'};
const agora = '2026-10-20T13:00:00Z'; // 10h em Brasília

ok('POP 035: quando a assepsia completa é exigida', () => {
  assert.match(L.precisaAssepsia(op, null, agora).motivo, /Primeira assepsia/);
  const reg = {ultima: {em: '2026-10-20T11:00:00Z', sku: 'HDR-MISS-0003'}, lotesDesde: 3};
  let r = L.precisaAssepsia(op, reg, agora);
  assert.equal(r.precisa, false); assert.match(r.motivo, /3 de 15 lotes/);
  assert.match(L.precisaAssepsia(op, Object.assign({}, reg, {ultima: {em: '2026-10-19T20:00:00Z', sku: 'HDR-MISS-0003'}}), agora).motivo, /Início do dia/);
  // 02:30 em Brasília do dia 20 é o mesmo dia civil que 10h -- 23h do dia 19 (UTC 02:00 do dia 20) não é.
  assert.equal(L.precisaAssepsia(op, {ultima: {em: '2026-10-20T02:00:00Z', sku: op.sku}, lotesDesde: 0}, agora).precisa, true, 'fuso de Brasília');
  assert.match(L.precisaAssepsia(Object.assign({}, op, {sku: 'HDR-MISS-0004'}), reg, agora).motivo, /Troca de produto/);
  assert.match(L.precisaAssepsia(op, Object.assign({}, reg, {lotesDesde: 15}), agora).motivo, /15 lotes desde/);
  assert.equal(L.precisaAssepsia(op, Object.assign({}, reg, {lotesDesde: 4}), agora, {limite: 5}).precisa, false);
  assert.match(L.precisaAssepsia(op, reg, agora, {ativosLinha: [{codigo: 'EV-01', situacao: 'OPERACIONAL', situacaoDesde: '2026-10-20T12:00:00Z'}]}).motivo, /voltou de manutenção: EV-01/);
  assert.match(L.precisaAssepsia(op, reg, agora, {ativosLinha: [{codigo: 'FC-01', situacao: 'EM_MANUTENCAO', situacaoDesde: '2026-10-20T12:00:00Z'}]}).motivo, /FC-01 em manutenção/);
});

ok('fluxo do CK-4: execução → Qualidade → aprovado, com assepsia da linha atualizada', () => {
  const nova = L.novaInspecao('m4', CK4, Object.assign({opKey: '26290-01', agora: 't1', por: 'Op'}, op));
  const ins = nova.registro;
  assert.equal(ins.versao, 1); assert.equal(ins.status, 'EXECUCAO');
  assert.match(L.concluirExecucao('i1', ins, itens4, {agora: 't2'}).erro, /Faltam \d+ pergunta\(s\) da limpeza/);
  const exec = {c4x1: {r: 'S'}, c4x2: {r: 'S'}, c4x3: {r: 'S'}, c4x4: {escolha: 'Álcool 70%'}, c4x5: {valor: 10}, c4x6: {r: 'S'}};
  ins.respostas = Object.assign({}, exec, {c4x3: {r: 'N'}});
  assert.match(L.concluirExecucao('i1', ins, itens4, {agora: 't2'}).erro, /não feita/);
  ins.respostas = exec;
  const r1 = L.concluirExecucao('i1', ins, itens4, {agora: 't2', por: 'Op', uid: 'op1'});
  assert.equal(r1.updates['inspecoes_cq/i1/status'], 'AGUARDANDO_QUALIDADE');
  assert.equal(r1.updates['liberacao_linha/26290-01/ck4/status'], 'AGUARDANDO_QUALIDADE');
  ins.status = 'AGUARDANDO_QUALIDADE';
  assert.match(L.decidirQualidade('i1', ins, itens4, 'LIBERAR', {agora: 't3'}).erro, /Faltam/);
  ins.respostas = Object.assign({}, exec, {c4q1: {r: 'S'}, c4q2: {r: 'S'}, c4q3: {r: 'N'}, c4q4: {r: 'S'}});
  assert.match(L.decidirQualidade('i1', ins, itens4, 'LIBERAR', {agora: 't3'}).erro, /Falta foto/, 'NC pede foto');
  ins.respostas.c4q3.fotos = [{url: 'f'}];
  assert.match(L.decidirQualidade('i1', ins, itens4, 'LIBERAR', {agora: 't3'}).erro, /não conforme/);
  assert.match(L.decidirQualidade('i1', ins, itens4, 'REPROVAR', {agora: 't3'}).erro, /motivo/);
  const rep = L.decidirQualidade('i1', ins, itens4, 'REPROVAR', {agora: 't3', motivo: 'Esteira suja: relavar'});
  assert.equal(rep.updates['inspecoes_cq/i1/status'], 'REPROVADO');
  ins.respostas.c4q3 = {r: 'S'};
  const ap = L.decidirQualidade('i1', ins, itens4, 'LIBERAR', {agora: 't3', por: 'Daiene', uid: 'cq1'});
  assert.equal(ap.updates['inspecoes_cq/i1/status'], 'APROVADO');
  assert.deepEqual(ap.updates['assepsia_linhas/LINHA_1/ultima'], {inspecaoId: 'i1', em: 't3', sku: 'HDR-MISS-0003', lote: '26290/01'});
  assert.equal(ap.updates['assepsia_linhas/LINHA_1/lotesDesde'], 0);
});

ok('fluxo do CK-5: Qualidade aprova o first article, líder (outra pessoa) assina, conta o lote', () => {
  const ins = L.novaInspecao('m5', CK5, Object.assign({opKey: '26290-01', agora: 't1', nominal: 180}, op)).registro;
  const boas = Array.from({length: 32}, () => 181);
  const fotos = [{url: 'f'}];
  ins.respostas = {c5l1: {r: 'S'}, c5l2: {r: 'S'}, c5l3: {r: 'S'}, c5i1: {r: 'S'}, c5i2: {r: 'S'}, c5i3: {r: 'S', fotos}, c5m1: {r: 'S'}, c5m2: {r: 'S', fotos},
    c5f1: {valores: boas}, c5f2: {r: 'S'}, c5f3: {r: 'S'}, c5f5: {r: 'S'}, c5f6: {r: 'S'}};
  const ap = L.decidirQualidade('i5', ins, itens5, 'LIBERAR', {agora: 't4', uid: 'cq1', por: 'Daiene'});
  assert.equal(ap.erro, undefined, ap.erro);
  assert.equal(ap.updates['inspecoes_cq/i5/status'], 'AGUARDANDO_LIDER');
  ins.status = 'AGUARDANDO_LIDER'; ins.verificacao = {uid: 'cq1'};
  assert.match(L.assinarLider('i5', ins, {uid: 'cq1'}).erro, /outra pessoa/);
  const li = L.assinarLider('i5', ins, {uid: 'lid1', por: 'Jessica', agora: 't5', lotesDesdeAtual: 2});
  assert.equal(li.updates['inspecoes_cq/i5/status'], 'APROVADO');
  assert.equal(li.updates['liberacao_linha/26290-01/ck5/status'], 'APROVADO');
  assert.equal(li.updates['assepsia_linhas/LINHA_1/lotesDesde'], 3);
  // First article com unidade abaixo de −3% (174,6 g) reprova.
  const ins2 = Object.assign({}, ins, {status: 'EXECUCAO', respostas: Object.assign({}, ins.respostas, {c5f1: {valores: boas.slice(0, 31).concat([170])}})});
  assert.match(L.decidirQualidade('i6', ins2, itens5, 'LIBERAR', {agora: 't4'}).erro, /não conforme/);
});

ok('situação da OP e portão do envase (com e sem trava)', () => {
  assert.match(L.situacaoOp(null, {}).falta, /Falta a assepsia/);
  const lib = {ck4: {status: 'DISPENSADA'}, ck5: {id: 'i5'}};
  assert.match(L.situacaoOp(lib, {i5: {status: 'AGUARDANDO_LIDER'}}).falta, /assinatura do líder/);
  assert.equal(L.situacaoOp(lib, {i5: {status: 'APROVADO'}}).liberada, true);
  assert.deepEqual(L.podeProduzir(op, null, {}, false), {ok: true, aviso: 'Falta a assepsia da linha (CK-4).'});
  assert.deepEqual(L.podeProduzir(op, null, {}, true), {ok: false, motivo: 'Falta a assepsia da linha (CK-4).'});
  assert.deepEqual(L.podeProduzir(Object.assign({}, op, {tipoOrdem: 'RETRABALHO'}), null, {}, true), {ok: true, aviso: null});
  assert.deepEqual(L.podeProduzir(op, lib, {i5: {status: 'APROVADO'}}, true), {ok: true, aviso: null});
  const d = L.dispensarAssepsia('26290-01', 'Linha 1', 'Mesma fórmula', {agora: 't', por: 'X'});
  assert.equal(d.updates['liberacao_linha/26290-01/ck4'].status, 'DISPENSADA');
});

ok('nominal em gramas do produto e modelo sem versão', () => {
  assert.equal(L.nominalGramas({volume: 200, unidadeVolume: 'g'}), 200);
  assert.equal(L.nominalGramas({volume: 200, unidadeVolume: 'ml', densidadeGranel: 0.9}), 180);
  assert.equal(L.nominalGramas({volume: 0.5, unidadeVolume: 'L', densidadeGranel: 1}), 500);
  assert.equal(L.nominalGramas({volume: 200, unidadeVolume: 'ml'}), null, 'sem densidade a inspetora informa');
  assert.match(L.novaInspecao('m', {codigo: 'CK-5'}, {}).erro, /não tem versão publicada/);
  assert.equal(L.chaveLinha('Rotulagem 01'), 'ROTULAGEM_01');
});

ok('portão no apontamento: fim de setup e apontamento de envase, nunca ao alocar/abrir', () => {
  const html = require('fs').readFileSync('public/form.html', 'utf8');
  assert.match(html, /function bloquearSeLinhaNaoLiberada\(op, acao, avisar\)/);
  assert.match(html, /bloquearSeLinhaNaoLiberada\(op, 'começar o envase', true\)/, 'fim de setup avisa/barra');
  assert.match(html, /bloquearSeLinhaNaoLiberada\(matchedOpForSave, 'receber apontamento de envase', false\)/, 'apontamento barra só com trava, sem aviso repetido');
  assert.equal((html.match(/bloquearSeLinhaNaoLiberada\(/g) || []).length, 3, 'definição + 2 chamadas: alocar/abrir não passam por aqui (o first article é com a OP na linha)');
  assert.match(html, /configLiberacaoLinha = cfg\.liberacaoLinha \|\| \{\}/);
  assert.match(html, /src="shared\/liberacao-linha\.js"/);
});

ok('portão da alocação: assepsia antes de alocar (20/10)', () => {
  const reg = {ultima: {em: '2026-10-20T11:00:00Z', sku: 'HDR-MISS-0003'}, lotesDesde: 3};
  // Mesma fórmula, mesmo dia: aloca e devolve o motivo da dispensa para gravar.
  const r1 = L.podeAlocar(op, null, reg, agora, {}, true);
  assert.equal(r1.ok, true); assert.match(r1.dispensa, /3 de 15 lotes/);
  // Troca de produto: com trava barra, sem trava avisa.
  const outro = Object.assign({}, op, {sku: 'HDR-MISS-0009'});
  assert.deepEqual(L.podeAlocar(outro, null, reg, agora, {}, true).ok, false);
  assert.match(L.podeAlocar(outro, null, reg, agora, {}, true).motivo, /precisa de assepsia antes de receber esta OP \(Troca de produto/);
  assert.match(L.podeAlocar(outro, null, reg, agora, {}, false).aviso, /precisa de assepsia/);
  assert.equal(L.podeAlocar(outro, null, reg, agora, {}, false).ok, true);
  // Assepsia em andamento aparece no motivo; aprovada ou dispensada libera.
  assert.match(L.podeAlocar(outro, {ck4: {status: 'AGUARDANDO_QUALIDADE'}}, reg, agora, {}, true).motivo, /assepsia aguardando a qualidade/);
  assert.deepEqual(L.podeAlocar(outro, {ck4: {status: 'APROVADO'}}, reg, agora, {}, true), {ok: true});
  assert.deepEqual(L.podeAlocar(op, {ck4: {status: 'DISPENSADA'}}, reg, agora, {}, true), {ok: true});
  assert.deepEqual(L.podeAlocar(Object.assign({}, outro, {tipoOrdem: 'RETRABALHO'}), null, reg, agora, {}, true), {ok: true});
});

ok('apontamento: assepsia cobrada ao ALOCAR e ao ABRIR a OP na linha de envase', () => {
  const html = require('fs').readFileSync('public/form.html', 'utf8');
  assert.match(html, /function bloquearSeAssepsiaPendente\(op, linha, acao\)/);
  assert.match(html, /bloquearSeAssepsiaPendente\(op, linha, 'ser aberta'\)/);
  assert.match(html, /alocarOpAlvoAtual\.tipo === 'linha' && bloquearSeAssepsiaPendente\(findOpByLote\(lote\), alocarOpAlvoAtual\.nome, 'ser alocada'\)/);
  assert.equal((html.match(/bloquearSeAssepsiaPendente\(/g) || []).length, 3);
  assert.match(html, /configRotulagem \|\| \[\]\)\.includes\(linha\) \|\| \(configPostos/, 'rotulagem e postos não pedem assepsia de linha de envase');
  assert.match(html, /src="shared\/ativos\.js"/);
  assert.doesNotMatch(html, /typeof showAlert === 'function'\) showAlert\('Atenção/, 'form.html não tem showAlert: aviso vai por avisoLiberacao');
});

console.log(`\nrun_liberacao_linha_test: ${n} OK`);
