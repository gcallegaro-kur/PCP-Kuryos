const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, 'public', 'shared', 'calendario-logistica.js'));

const HOJE = '2026-09-17';
const pcs = {
  pc1: {status: 'ENVIADO', numeroFormatado: 'PC-0010', fornecedorNome: 'LOMAR PACK', itens: {a: {qtd: 100}, b: {qtd: 50}},
    agendamento: {dataAgendada: '2026-09-18', janela: 'manha', transportadora: 'Transp', responsavelTransporte: 'KURYOS', acaoLogistica: 'PROGRAMAR_COLETA'}},
  pc2: {status: 'ENVIADO', numeroFormatado: 'PC-0011', origemNome: 'Cliente X (remessa)', dataPrevistaEntrega: '2026-09-22T00:00:00Z', itens: {a: {qtd: 10}}},
  pc3: {status: 'RECEBIDO_PARCIAL', numeroFormatado: 'PC-0012', fornecedorNome: 'Vidros', itens: {a: {qtd: 100, qtdRecebida: 40}},
    agendamento: {dataAgendada: '2026-09-15', janela: 'tarde'}},
  pc4: {status: 'RECEBIDO_TOTAL', numeroFormatado: 'PC-0013', fornecedorNome: 'Rótulos', itens: {a: {qtd: 5, qtdRecebida: 5}}, agendamento: {dataAgendada: '2026-09-10'}},
  pc5: {status: 'CANCELADO', agendamento: {dataAgendada: '2026-09-18'}},
  pc6: {status: 'ABERTO', agendamento: {dataAgendada: '2026-09-18'}},
  pc7: {status: 'ENVIADO', numeroFormatado: 'PC-0014', fornecedorNome: 'Sem data'}
};
const agendas = {
  ag1: {status: 'AGENDADO', cliente: 'MISS ROSE', tipo: 'COLETA', dataAgendada: '2026-09-18', janela: '14h–16h', pedidos: {'PED-0002': 'PED-0002'},
    paletes: [{quantidade: 295}, {quantidade: 240}], faturamento: {status: 'FATURADO', nfs: {nf_1: {numero: '1500', serie: '1'}}}},
  ag2: {status: 'EXPEDIDO_PARCIAL', cliente: 'WIKE MAKE', tipo: 'ENTREGA', dataAgendada: '2026-09-16', janela: '', pedidos: {x: 'PED-0007'},
    paletes: [{quantidade: 100, embarcado: 60}], viagens: {v1: {data: '2026-09-16'}}},
  ag3: {status: 'EXPEDIDO', cliente: 'HABIBI', dataAgendada: '2026-09-11', paletes: [{quantidade: 10, embarcado: 10}], viagens: {v1: {data: '2026-09-12'}, v2: {data: '2026-09-14'}}},
  ag4: {status: 'CANCELADO', cliente: 'X', dataAgendada: '2026-09-18'},
  ag5: {status: 'AGENDADO', cliente: 'Atrasada', dataAgendada: '2026-09-10', paletes: []}
};

// ── Eventos ─────────────────────────────────────────────────────────────
{
  const ev = C.eventos(pcs, agendas, {hoje: HOJE});
  const id = (x) => ev.find((e) => e.id === x);
  assert.deepStrictEqual(ev.map((e) => e.id).sort(), ['pa:ag1', 'pa:ag2', 'pa:ag5', 'pc:pc1', 'pc:pc2', 'pc:pc3'].sort(), 'cancelado, aberto, sem data e concluídos fora');
  assert.strictEqual(id('pc:pc1').situacao, 'AGENDADO');
  assert.strictEqual(id('pc:pc1').faixa, 'manha');
  assert.match(id('pc:pc1').subtitulo, /Coleta Kuryos · 2 item/);
  assert.strictEqual(id('pc:pc2').situacao, 'PREVISTO');
  assert.strictEqual(id('pc:pc2').data, '2026-09-22');
  assert.strictEqual(id('pc:pc2').titulo, 'Cliente X (remessa)');
  assert.strictEqual(id('pc:pc3').situacao, 'ATRASADO', 'data passou sem receber tudo');
  assert.strictEqual(id('pc:pc3').detalhes.progresso.pct, 40);
  assert.strictEqual(id('pa:ag1').faixa, 'tarde', '"14h–16h" vira tarde');
  assert.deepStrictEqual(id('pa:ag1').detalhes.nfs, ['1500/1']);
  assert.match(id('pa:ag1').subtitulo, /Coleta FOB · 2 palete\(s\) · 535 un/);
  assert.strictEqual(id('pa:ag2').situacao, 'PARCIAL');
  assert.strictEqual(id('pa:ag2').detalhes.aguardandoEmbarque, 40);
  assert.strictEqual(id('pa:ag5').situacao, 'ATRASADO');
  // Ordem: data, depois manhã/tarde/dia todo.
  const dia18 = ev.filter((e) => e.data === '2026-09-18').map((e) => e.id);
  assert.deepStrictEqual(dia18, ['pc:pc1', 'pa:ag1']);
}
// Concluídos e previstos como opção.
{
  const ev = C.eventos(pcs, agendas, {hoje: HOJE, incluirConcluidos: true, incluirPrevistos: false});
  assert.ok(ev.some((e) => e.id === 'pc:pc4' && e.situacao === 'CONCLUIDO'));
  const ag3 = ev.find((e) => e.id === 'pa:ag3');
  assert.strictEqual(ag3.data, '2026-09-14', 'saída concluída aparece no dia da última viagem');
  assert.ok(!ev.some((e) => e.id === 'pc:pc2'), 'sem previstos');
}
// Filtros, agrupamento e resumo.
{
  const ev = C.eventos(pcs, agendas, {hoje: HOJE});
  assert.ok(C.filtrar(ev, {entradas: false}).every((e) => e.tipo === 'SAIDA'));
  assert.ok(C.filtrar(ev, {saidas: false}).every((e) => e.tipo === 'ENTRADA'));
  assert.strictEqual(C.porDia(ev)['2026-09-18'].length, 2);
  assert.deepStrictEqual(C.resumo(ev), {entradas: 3, saidas: 3, atrasados: 2, parciais: 1});
}
// Janelas.
assert.strictEqual(C.faixaJanela('manha'), 'manha');
assert.strictEqual(C.faixaJanela('08h–12h'), 'manha');
assert.strictEqual(C.faixaJanela('13:30'), 'tarde');
assert.strictEqual(C.faixaJanela('à tarde'), 'tarde');
assert.strictEqual(C.faixaJanela(''), 'dia_todo');

// ── Grades ──────────────────────────────────────────────────────────────
{
  const g = C.gradeMes(2026, 8); // setembro/2026 começa numa terça
  assert.strictEqual(g.titulo, 'setembro de 2026');
  assert.strictEqual(g.inicio, '2026-08-31', 'semana começa na segunda');
  assert.strictEqual(g.fim, '2026-10-04');
  assert.strictEqual(g.semanas.length, 5);
  assert.ok(g.semanas.every((s) => s.length === 7));
  assert.strictEqual(g.semanas[0][0].doMes, false);
  assert.strictEqual(g.semanas[0][1].data, '2026-09-01');
  const fev = C.gradeMes(2027, 1);
  assert.strictEqual(fev.semanas[0][0].data, '2027-02-01', 'fevereiro/2027 começa numa segunda');
  assert.strictEqual(C.gradeMes(2026, 11).semanas.slice(-1)[0][6].data, '2027-01-03', 'virada de ano');
  const s = C.gradeSemana('2026-09-17');
  assert.strictEqual(s.inicio, '2026-09-14');
  assert.strictEqual(s.fim, '2026-09-20');
  assert.strictEqual(s.dias[3].rotulo, 'qui 17/09');
  assert.strictEqual(C.gradeSemana('2026-09-20').inicio, '2026-09-14', 'domingo pertence à semana que começou na segunda');
}

// Base vazia.
assert.deepStrictEqual(C.eventos(null, undefined, {hoje: HOJE}), []);

console.log('run_calendario_logistica_test.js: OK');
