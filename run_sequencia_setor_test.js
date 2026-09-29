const assert = require('assert');
const path = require('path');
const S = require(path.join(__dirname, 'public', 'shared', 'sequencia-setor.js'));

const ctx = {
  temRotulagem: (op) => !!op.temRotulo,
  recursos: {envase: ['Linha 1', 'Linha 2'], rotulagem: ['Rotuladora 1']},
  prodHoraRef: (it) => ({SKU1: 500, SKU2: 300})[it.sku] || null
};
// Turno 07–17 com pausa 12–13 (9 h úteis), sexta até 16, seg–sex.
const cal = {
  turnos: ['A'], horarios: {A: '07:00'}, fim: {A: '17:00'}, fimSexta: {A: '16:00'},
  pausas: {A: {inicio: '12:00', fim: '13:00'}}, diasSemana: [1, 2, 3, 4, 5], feriados: {'2026-10-12': true}
};
const hm = (d) => d && (d.toISOString ? `${String(d.getDate()).padStart(2, '0')}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : d);

// ── Etapas lidas da OP (nenhuma ficha nova) ─────────────────────────────
{
  const op = {status: 'Programado', qtdPlanejada: 1000, formulaVersao: 'F1__v2', temRotulo: true};
  assert.deepStrictEqual(S.etapa('separacao', op, ctx), {emAndamento: false, restante: 1, unidade: 'OP', status: 'A separar'});
  assert.strictEqual(S.etapa('separacao', {...op, separacaoParcial: true}, ctx).status, 'Separação parcial');
  assert.strictEqual(S.etapa('separacao', {...op, separacaoConcluida: true}, ctx), null, 'separada sai da fila');

  assert.strictEqual(S.etapa('manipulacao', op, ctx).status, 'Não iniciada');
  assert.strictEqual(S.etapa('manipulacao', {...op, manipulacao: {status: 'EM_MANIPULACAO'}}, ctx).emAndamento, true);
  assert.strictEqual(S.etapa('manipulacao', {...op, manipulacao: {status: 'AGUARDANDO_CQ'}}, ctx), null, 'bulk na Qualidade já saiu do setor');
  assert.strictEqual(S.etapa('manipulacao', {...op, manipulacao: {status: 'CORRECAO_ABERTA'}}, ctx).emAndamento, true, 'correção volta para a manipulação');
  assert.strictEqual(S.etapa('manipulacao', {...op, formulaVersao: ''}, ctx), null, 'sem fórmula não manipula');
  assert.strictEqual(S.etapa('manipulacao', {...op, tipoOrdem: 'RETRABALHO'}, ctx), null);
  assert.strictEqual(S.etapa('manipulacao', {...op, produzidoLinha: 10}, ctx), null, 'OP antiga já envasada: bulk feito por fora');

  assert.deepStrictEqual(S.etapa('envase', {...op, produzidoLinha: 400}, ctx), {emAndamento: false, restante: 600, unidade: 'un', status: 'Envase parcial'});
  assert.strictEqual(S.etapa('envase', {...op, produzido: 1000}, ctx), null, 'legado sem produzidoLinha usa produzido');
  assert.strictEqual(S.etapa('envase', {...op, abertaDesde: 'x'}, ctx).status, 'Envasando');

  assert.strictEqual(S.etapa('rotulagem', {...op, produzidoRotulagem: 250}, ctx).restante, 750);
  assert.strictEqual(S.etapa('rotulagem', {...op, temRotulo: false}, ctx), null, 'sem rótulo na OP, sem rotulagem');

  ['Concluído', 'Cancelado', 'Aguardando Confirmação'].forEach((st) => {
    assert.strictEqual(S.etapa('envase', {...op, status: st}, ctx), null, st + ' não entra na fila');
  });
}

// ── Fila: o que roda vence o plano; grade manda no envase; PCP ordena o resto
const ops = {
  a: {lote: '26300/01', sku: 'SKU1', status: 'Programado', qtdPlanejada: 1000, dataEmissao: '2026-09-20', linha: 'Linha 1'},
  b: {lote: '26300/02', sku: 'SKU2', status: 'Programado', qtdPlanejada: 600, dataEmissao: '2026-09-21', linha: 'Linha 1'},
  c: {lote: '26300/03', sku: 'SKU1', status: 'Em Produção', qtdPlanejada: 2000, produzidoLinha: 1500, abertaDesde: 't', abertaLinha: 'Linha 1', linha: 'Linha 2'},
  d: {lote: '26300/04', sku: 'SKU1', status: 'Programado', qtdPlanejada: 500, dataEmissao: '2026-09-10', linha: 'Linha 1', dataInicioPlanejada: '2026-09-30T09:00:00'},
  e: {lote: '26300/05', sku: 'SKU9', status: 'Programado', qtdPlanejada: 100, dataEmissao: '2026-09-22'},
  f: {lote: '26300/06', sku: 'SKU1', status: 'Concluído', qtdPlanejada: 100}
};
{
  const ordem = {a: {posicao: 2, recurso: 'Linha 1'}, b: {posicao: 1, recurso: 'Linha 1'}, c: {recurso: 'Linha 2'}};
  const f = S.fila('envase', ops, ordem, ctx);
  assert.deepStrictEqual(f.map((g) => g.recurso), ['Linha 1', 'Linha 2', 'Sem linha']);
  const l1 = f[0].itens.map((i) => i.opKey);
  assert.deepStrictEqual(l1, ['c', 'd', 'b', 'a'], 'rodando → na grade → posição do PCP');
  assert.strictEqual(f[0].itens[0].recurso, 'Linha 1', 'OP aberta na Linha 1 aparece lá, mesmo planejada na 2');
  assert.deepStrictEqual(f[0].itens.map((i) => i.movel), [false, false, true, true]);
  assert.deepStrictEqual(f[1].itens, [], 'recurso cadastrado aparece mesmo vazio');
  assert.deepStrictEqual(f[2].itens.map((i) => i.opKey), ['e']);
  // Sem posição: ordem de emissão.
  const semOrdem = S.fila('envase', ops, {}, ctx)[0].itens.map((i) => i.opKey);
  assert.deepStrictEqual(semOrdem, ['c', 'd', 'a', 'b']);

  // Setor de recurso único.
  const sep = S.fila('separacao', ops, {e: {posicao: 1}}, ctx);
  assert.deepStrictEqual(sep.map((g) => g.recurso), ['Separação']);
  assert.strictEqual(sep[0].itens[0].opKey, 'e');
  assert.strictEqual(sep[0].itens.length, 5, 'concluída fora');
}

// ── Mover: caminhos PLANOS, só as móveis ────────────────────────────────
{
  const g = S.fila('envase', ops, {a: {posicao: 1}, b: {posicao: 2}}, ctx)[0];
  const u = S.mover(g, 'b', -1, 'envase');
  assert.deepStrictEqual(u, {
    'sequenciamento/ordem/envase/b/posicao': 1, 'sequenciamento/ordem/envase/b/recurso': 'Linha 1',
    'sequenciamento/ordem/envase/a/posicao': 2, 'sequenciamento/ordem/envase/a/recurso': 'Linha 1'
  });
  assert.ok(Object.keys(u).every((k) => typeof u[k] !== 'object'), 'nada de objeto aninhado no update');
  assert.strictEqual(S.mover(g, 'a', -1, 'envase'), null, 'a primeira móvel não passa a da grade');
  assert.strictEqual(S.mover(g, 'c', 1, 'envase'), null, 'em andamento não se move');
  const destino = S.fila('envase', ops, {}, ctx)[1];
  assert.deepStrictEqual(S.trocarRecurso(destino, 'a', 'envase'), {
    'sequenciamento/ordem/envase/a/recurso': 'Linha 2', 'sequenciamento/ordem/envase/a/posicao': 1
  });
}

// ── Duração: envase pelo valor conservador ──────────────────────────────
{
  const it = {sku: 'SKU1', recurso: 'Linha 1', restante: 1000};
  assert.strictEqual(S.duracao('envase', it, {}, ctx).horas, 2, '1000 ÷ 500');
  const ritmos = {envase: {Linha_1: {unPorHora: 400}}};
  assert.strictEqual(S.duracao('envase', {...it, recurso: 'Linha_1'}, ritmos, ctx).horas, 2.5, 'linha mais lenta que o cadastro: vale a linha');
  assert.strictEqual(S.duracao('envase', {...it, sku: 'SKU9'}, {}, ctx), null);
  assert.strictEqual(S.duracao('rotulagem', {recurso: 'Rotuladora 1', restante: 900}, {rotulagem: {'Rotuladora 1': {unPorHora: 300}}}, ctx).horas, 3);
  assert.strictEqual(S.duracao('manipulacao', {recurso: 'Manipulação', restante: 1}, {manipulacao: {'Manipulação': {horasPorLote: 4}}}, ctx).horas, 4);
  assert.strictEqual(S.duracao('separacao', {recurso: 'Separação', restante: 1}, {}, ctx), null);
  assert.strictEqual(S.chave('Linha 1.2/A'), 'Linha 1_2_A');
}

// ── Calendário do turno ─────────────────────────────────────────────────
{
  const seg = new Date(2026, 8, 28); // segunda
  assert.deepStrictEqual(S.horasUteisDoDia(seg, cal), [7, 8, 9, 10, 11, 13, 14, 15, 16], 'pausa fora');
  assert.deepStrictEqual(S.horasUteisDoDia(new Date(2026, 9, 2), cal), [7, 8, 9, 10, 11, 13, 14, 15], 'sexta até 16h');
  assert.deepStrictEqual(S.horasUteisDoDia(new Date(2026, 9, 3), cal), [], 'sábado');
  assert.deepStrictEqual(S.horasUteisDoDia(new Date(2026, 9, 12), cal), [], 'feriado');
  assert.deepStrictEqual(S.horasUteisDoDia(seg, {...cal, turnos: []}), []);
  // Turno extra somado (sábado).
  const extra = {...cal, extrasDoDia: (d) => d.getDay() === 6 ? {horasAtivas: ['08:00', '09:00'], pausas: []} : {}};
  assert.deepStrictEqual(S.horasUteisDoDia(new Date(2026, 9, 3), extra), [8, 9]);

  assert.strictEqual(hm(S.avancar(new Date(2026, 8, 29, 5, 30), 0, cal)), '29/9 07:00', 'antes do turno começa às 7h');
  assert.strictEqual(hm(S.avancar(new Date(2026, 8, 29, 11, 0), 2, cal)), '29/9 14:00', 'pula a pausa');
  assert.strictEqual(hm(S.avancar(new Date(2026, 8, 29, 16, 30), 1, cal)), '30/9 07:30', 'vira o dia');
  assert.strictEqual(hm(S.avancar(new Date(2026, 9, 2, 15, 0), 2, cal)), '05/10 08:00', 'sexta até 16h, pula o fim de semana');
  assert.strictEqual(hm(S.avancar(new Date(2026, 9, 9, 15, 0), 2, cal)), '13/10 08:00', 'sexta 15h: 1 h na sexta, pula fim de semana e feriado de segunda');
  assert.strictEqual(S.avancar(new Date(2026, 8, 29), 1, {turnos: []}), null, 'sem turno não inventa prazo');
  // Segundos de sobra não jogam o término para depois do almoço.
  assert.strictEqual(hm(S.avancar(new Date(2026, 8, 29, 10, 0, 5), 2, cal)), '29/9 12:00');
}

// ── Estimativa encadeada por recurso ────────────────────────────────────
{
  const g = S.fila('envase', ops, {a: {posicao: 1}, b: {posicao: 2}}, ctx)[0];
  S.estimar(g, new Date(2026, 8, 29, 8, 0), {}, cal, ctx, 'envase');
  const r = g.itens.map((i) => [i.opKey, hm(i.inicioEstimado), hm(i.fimEstimado)]);
  // c: faltam 500 ÷ 500 = 1 h a partir de agora; d: na grade 30/09 09:00, 1 h;
  // a: 2 h depois de d; b: 600 ÷ 300 = 2 h.
  assert.deepStrictEqual(r, [
    ['c', '29/9 08:00', '29/9 09:00'],
    ['d', '30/9 09:00', '30/9 10:00'],
    ['a', '30/9 10:00', '30/9 12:00'], // termina no início da pausa; a próxima começa às 13h
    ['b', '30/9 13:00', '30/9 15:00']
  ]);
  assert.strictEqual(g.itens[2].fonteRitmo, 'prodHoraRef do produto');

  // Um sem ritmo quebra a corrente: os de trás ficam sem horário inventado.
  const sl = S.fila('envase', {...ops, e: {...ops.e, linha: 'Linha 2'}}, {e: {posicao: 1}}, ctx)[1];
  sl.itens.unshift({opKey: 'z', lote: 'Z', sku: 'SKU1', recurso: 'Linha 2', restante: 100, emAndamento: false});
  const sl2 = {recurso: 'Linha 2', itens: [sl.itens.find((i) => i.opKey === 'e'), {opKey: 'y', lote: 'Y', sku: 'SKU1', recurso: 'Linha 2', restante: 500}]};
  S.estimar(sl2, new Date(2026, 8, 29, 8, 0), {}, cal, ctx, 'envase');
  assert.match(sl2.itens[0].semEstimativa, /sem prodHoraRef/);
  assert.strictEqual(sl2.itens[1].inicioEstimado, null);
  assert.match(sl2.itens[1].semEstimativa, /depende de OP 26300\/05 sem ritmo/);

  // Rotuladora: ritmo do PCP.
  const opsRot = {r1: {lote: 'R1', status: 'Programado', qtdPlanejada: 900, temRotulo: true, dataEmissao: '1'}};
  const gr = S.fila('rotulagem', opsRot, {r1: {recurso: 'Rotuladora 1', posicao: 1}}, ctx)[0];
  S.estimar(gr, new Date(2026, 8, 29, 10, 0), {rotulagem: {'Rotuladora 1': {unPorHora: 300}}}, cal, ctx, 'rotulagem');
  assert.strictEqual(hm(gr.itens[0].fimEstimado), '29/9 14:00', '3 h a partir das 10h, com a pausa');
  const semRitmo = S.fila('rotulagem', opsRot, {r1: {recurso: 'Rotuladora 1'}}, ctx)[0];
  S.estimar(semRitmo, new Date(2026, 8, 29, 10, 0), {}, cal, ctx, 'rotulagem');
  assert.match(semRitmo.itens[0].semEstimativa, /informe o ritmo \(un\/h\)/);
}

// ── Etapas encadeadas: separação → manipulação → envase; rotulagem em paralelo
{
  const opsE = {
    m: {lote: 'M', sku: 'SKU1', status: 'Programado', qtdPlanejada: 1000, formulaVersao: 'F__v1', linha: 'Linha 1', temRotulo: true, dataEmissao: '1'},
    s: {lote: 'S', sku: 'SKU1', status: 'Programado', qtdPlanejada: 500, linha: 'Linha 2', dataEmissao: '2'}
  };
  const ritmos = {separacao: {'Separação': {horasPorOp: 1}}, manipulacao: {'Manipulação': {horasPorLote: 4}}, rotulagem: {'Rotuladora 1': {unPorHora: 500}}};
  const ordem = {rotulagem: {m: {recurso: 'Rotuladora 1', posicao: 1}}};
  const t = S.estimarTudo(opsE, ordem, ritmos, cal, ctx, new Date(2026, 8, 29, 8, 0));
  const item = (setor, k) => t[setor].flatMap((g) => g.itens).find((i) => i.opKey === k);
  // Separação: M 08–09, S 09–10.
  assert.strictEqual(hm(item('separacao', 'm').fimEstimado), '29/9 09:00');
  assert.strictEqual(hm(item('separacao', 's').fimEstimado), '29/9 10:00');
  // Manipulação de M espera a separação dela: 09:00 + 4 h (pausa) = 14:00.
  assert.strictEqual(hm(item('manipulacao', 'm').inicioEstimado), '29/9 09:00');
  assert.strictEqual(item('manipulacao', 'm').aguarda, 'separação');
  assert.strictEqual(hm(item('manipulacao', 'm').fimEstimado), '29/9 14:00');
  // Envase de M espera a manipulação (a mais próxima), não só a separação.
  assert.strictEqual(hm(item('envase', 'm').inicioEstimado), '29/9 14:00');
  assert.strictEqual(item('envase', 'm').aguarda, 'manipulação');
  // S não manipula: o envase espera só a separação dela.
  assert.strictEqual(hm(item('envase', 's').inicioEstimado), '29/9 10:00');
  assert.strictEqual(item('envase', 's').aguarda, 'separação');
  // Rotulagem não espera o envase (corre em paralelo).
  assert.strictEqual(hm(item('rotulagem', 'm').inicioEstimado), '29/9 08:00');
  // Etapa anterior sem estimativa: estima assim mesmo, com a ressalva.
  const semSep = S.estimarTudo(opsE, ordem, {manipulacao: ritmos.manipulacao}, cal, ctx, new Date(2026, 8, 29, 8, 0));
  const mm = semSep.manipulacao[0].itens[0];
  assert.strictEqual(hm(mm.inicioEstimado), '29/9 08:00');
  assert.match(mm.ressalva, /sem contar a separação, que está sem estimativa/);
  // Em andamento não espera ninguém: já começou.
  const rodando = S.estimarTudo({m: {...opsE.m, abertaDesde: 'x'}}, {}, ritmos, cal, ctx, new Date(2026, 8, 29, 8, 0));
  assert.strictEqual(hm(rodando.envase[0].itens[0].inicioEstimado), '29/9 08:00');
}

// ── Grade de Quantidades sugere linha e ordem (29/09) ──────────────────
{
  const prog = {
    '2026-09-30': {
      '08_00': {env2: {pedidoKey: 'PED1__SKU1', mediaPorHora: 500}, linha2: 'Linha 2'},
      '09_00': {env2: {pedidoKey: 'PED1__SKU1', mediaPorHora: 500}},
      '10_00': {env1: {pedidoKey: 'PED2__SKU2', mediaPorHora: 300, lote: '26400/07'}}
    },
    '2026-09-29': {'14_00': {env1: {pedidoKey: 'PED3__SKU1'}}},
    'lixo': {'08_00': {env1: {pedidoKey: 'X'}}}
  };
  const sug = S.sugestoesDaGrade(prog, ['Linha 1', 'Linha 2']);
  assert.deepStrictEqual(sug.porPedido['PED1__SKU1'], {linha: 'Linha 2',
    inicio: new Date(2026, 8, 30, 8).getTime(), fim: new Date(2026, 8, 30, 10).getTime()});
  assert.strictEqual(sug.porLote['26400/07'].linha, 'Linha 1');
  assert.strictEqual(sug.porPedido.X, undefined, 'chave de data inválida ignorada');

  const opsG = {
    a: {lote: '26400/01', skuPedidoKey: 'PED1__SKU1', sku: 'SKU1', status: 'Programado', qtdPlanejada: 1000, dataEmissao: '2026-09-01'},
    b: {lote: '26400/02', skuPedidoKey: 'PED3__SKU1', sku: 'SKU1', status: 'Programado', qtdPlanejada: 500, dataEmissao: '2026-09-25'},
    c: {lote: '26400/07', skuPedidoKey: 'PED2__SKU2', sku: 'SKU2', status: 'Programado', qtdPlanejada: 300, dataEmissao: '2026-09-02'},
    d: {lote: '26400/08', skuPedidoKey: 'PED9__SKU1', sku: 'SKU1', status: 'Programado', qtdPlanejada: 100, dataEmissao: '2026-08-01'}
  };
  const c2 = {...ctx, sugestoes: sug};
  const f = S.fila('envase', opsG, {}, c2);
  const por = (r) => f.find((g) => g.recurso === r).itens.map((i) => i.opKey);
  assert.deepStrictEqual(por('Linha 2'), ['a'], 'OP sem linha entra onde o pedido foi planejado');
  // Linha 1: b (pedido planejado 29/09 14h) antes de c (30/09 10h), mesmo emitida depois.
  assert.deepStrictEqual(por('Linha 1'), ['b', 'c'], 'ordem do primeiro horário do pedido na grade');
  assert.deepStrictEqual(por('Sem linha'), ['d'], 'pedido fora da grade continua sem linha');
  assert.strictEqual(f.find((g) => g.recurso === 'Linha 2').itens[0].linhaSugerida, true);

  // Só sugere: a decisão do PCP e a linha da OP vencem.
  const f2 = S.fila('envase', {...opsG, a: {...opsG.a, linha: 'Linha 1'}}, {c: {recurso: 'Linha 2', posicao: 1}}, c2);
  assert.deepStrictEqual(f2.find((g) => g.recurso === 'Linha 1').itens.map((i) => i.opKey), ['b', 'a']);
  assert.deepStrictEqual(f2.find((g) => g.recurso === 'Linha 2').itens.map((i) => i.opKey), ['c']);
  assert.strictEqual(f2.find((g) => g.recurso === 'Linha 1').itens[1].linhaSugerida, false);

  // ── Desvio: execução mais lenta ou mais rápida que o planejado ──────
  // Pedido PED1 planejado 30/09 08–10 (1000 un). Hoje 30/09 08:00, ritmo 500:
  // termina 10:00, no plano.
  const noPlano = S.estimarTudo({a: opsG.a}, {}, {}, cal, c2, new Date(2026, 8, 30, 8, 0)).envase.find((g) => g.recurso === 'Linha 2').itens[0];
  assert.strictEqual(hm(noPlano.fimEstimado), '30/9 10:00');
  assert.strictEqual(noPlano.desvioHoras, null);
  // Mais lento: às 10:00 só 400 feitos → faltam 600 = 1,2 h → 11:12, 1,2 h depois.
  const lento = S.estimarTudo({a: {...opsG.a, produzidoLinha: 400, abertaDesde: 'x', abertaLinha: 'Linha 2'}}, {}, {}, cal, c2,
    new Date(2026, 8, 30, 10, 0)).envase.find((g) => g.recurso === 'Linha 2').itens[0];
  assert.strictEqual(hm(lento.fimEstimado), '30/9 11:12');
  assert.strictEqual(lento.desvioHoras, 1.2, 'atraso aparece antes de estourar o prazo');
  // Mais rápido: 08:30 já com 900 → faltam 100 → 08:42, 1,3 h antes.
  const rapido = S.estimarTudo({a: {...opsG.a, produzidoLinha: 900, abertaDesde: 'x', abertaLinha: 'Linha 2'}}, {}, {}, cal, c2,
    new Date(2026, 8, 30, 8, 30)).envase.find((g) => g.recurso === 'Linha 2').itens[0];
  assert.strictEqual(rapido.desvioHoras, -1.3);
  // Fim programado da OP (Planejamento de OPs) vale mais que o do pedido.
  const comFimOp = S.fila('envase', {a: {...opsG.a, dataFimPlanejada: '2026-09-30T12:00:00'}}, {}, c2)
    .find((g) => g.recurso === 'Linha 2').itens[0];
  assert.strictEqual(comFimOp.origemPlano, 'OP');
  assert.strictEqual(comFimOp.fimPlanejado, new Date(2026, 8, 30, 12).getTime());
}

console.log('run_sequencia_setor_test.js: OK');
