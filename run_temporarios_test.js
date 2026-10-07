'use strict';
/* Regras de pagamento dos temporários (06/10) -- os exemplos da legenda da planilha do RH e os casos de borda.
   node run_temporarios_test.js */
const assert = require('node:assert/strict');
const T = require('./public/shared/temporarios.js');

const SEG = '2026-09-21';                       // segunda
const dia = (i) => T.somaDias(SEG, i);
const marcar = (id, codigos, base) => {
  const p = base || {};
  codigos.forEach((c, i) => { if (c) { (p[dia(i)] = p[dia(i)] || {})[id] = c; } });
  return p;
};
const vt = (id, dias, extra) => Object.assign({tempId: id, data: SEG, valor: dias * 10.6, categoria: 'VT'}, extra || {});
const cx = (o) => Object.assign({config: {}, atrasos: {}, pagamentos: {}, presenca: {}}, o);

// ── datas ──
assert.equal(T.segundaDe('2026-09-25'), SEG, 'sexta -> segunda da semana');
assert.equal(T.segundaDe('2026-09-27'), SEG, 'domingo pertence à semana que termina');
assert.equal(T.segundaDe(SEG), SEG);
assert.deepEqual(T.diasDaSemana(SEG), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
assert.equal(T.diaSemana('2026-09-27'), 7);
assert.ok(T.dataValida('2026-02-28') && !T.dataValida('2026-02-30') && !T.dataValida('21/09/2026'));
assert.equal(T.somaDias('2026-12-31', 1), '2027-01-01');

// ── legenda: semana cheia, 5 OK, VT dos 5 dias pago ──
let ctx = cx({presenca: marcar('a', ['OK', 'OK', 'OK', 'OK', 'OK']), pagamentos: {p1: vt('a', 5)}});
let f = T.fechamentoSemana('a', SEG, ctx);
assert.equal(f.regra, 'Cheia'); assert.equal(f.diasSegQui, 4); assert.equal(f.diasSexta, 1);
assert.equal(f.totalDiarias, 537.77, '4 x 110 + 97,77');
assert.equal(f.descVT, 0); assert.equal(f.vtAPagar, 0); assert.equal(f.fechamento, 537.77); assert.equal(f.emAberto, 537.77);

// ── legenda: 4 OK + 1 F = 4 x 70 = 280, menos 1 VT (10,60) ──
ctx = cx({presenca: marcar('a', ['OK', 'OK', 'OK', 'F', 'OK']), pagamentos: {p1: vt('a', 5)}});
f = T.fechamentoSemana('a', SEG, ctx);
assert.equal(f.regra, 'Reduzida'); assert.equal(f.totalDiarias, 280, 'a sexta também vira 70');
assert.equal(f.descVT, 10.6); assert.equal(f.fechamento, 269.4);

// ── legenda: 4 OK + 1 FA (sexta) = 4 x 110 = 440, menos 1 VT ──
ctx = cx({presenca: marcar('a', ['OK', 'OK', 'OK', 'OK', 'FA']), pagamentos: {p1: vt('a', 5)}});
f = T.fechamentoSemana('a', SEG, ctx);
assert.equal(f.regra, 'Cheia', 'FA não reduz a diária dos outros dias'); assert.equal(f.totalDiarias, 440);
assert.equal(f.descVT, 10.6); assert.equal(f.fechamento, 429.4); assert.equal(f.abonadas, 1);

// ── NC não paga e não reduz; VT pago do dia não convocado é descontado ──
ctx = cx({presenca: marcar('a', ['OK', 'NC', 'OK', 'OK', 'OK']), pagamentos: {p1: vt('a', 5)}});
f = T.fechamentoSemana('a', SEG, ctx);
assert.equal(f.regra, 'Cheia'); assert.equal(f.totalDiarias, 3 * 110 + 97.77); assert.equal(f.naoConvocados, 1); assert.equal(f.descVT, 10.6);

// ── dia OK sem VT pago entra como VT a pagar ──
ctx = cx({presenca: marcar('a', ['OK', 'OK', 'OK', 'OK', 'OK']), pagamentos: {p1: vt('a', 3)}});
f = T.fechamentoSemana('a', SEG, ctx);
assert.equal(f.diasVT, 3); assert.equal(f.vtAPagar, 21.2); assert.equal(f.descVT, 0); assert.equal(f.fechamento, 537.77 + 21.2);

// ── VT que não é múltiplo do valor: ERRO, a semana não fecha ──
ctx = cx({presenca: marcar('a', ['OK', 'OK', 'OK', 'OK', 'OK']), pagamentos: {p1: {tempId: 'a', data: SEG, valor: 50, categoria: 'VT'}}});
f = T.fechamentoSemana('a', SEG, ctx);
assert.match(f.erro, /múltiplo/); assert.equal(f.fechamento, null); assert.equal(f.emAberto, null);

// ── atraso abaixo do limite: horas x valor da hora ──
ctx = cx({presenca: marcar('a', ['OK', 'OK', 'OK', 'OK', 'OK']), pagamentos: {p1: vt('a', 5)}, atrasos: {x: {tempId: 'a', data: dia(1), horas: 1}}});
f = T.fechamentoSemana('a', SEG, ctx);
assert.equal(f.descAtraso, 12.22); assert.equal(f.totalDiarias, 537.77, 'o dia continua cheio abaixo do limite'); assert.equal(f.fechamento, 525.55);

// ── atraso a partir do limite (3 h, seg-qui): diária vira 70 e as horas descontam 70/9 ──
ctx = cx({presenca: marcar('a', ['OK', 'OK', 'OK', 'OK', 'OK']), pagamentos: {p1: vt('a', 5)}, atrasos: {x: {tempId: 'a', data: dia(0), horas: 3}}});
f = T.fechamentoSemana('a', SEG, ctx);
assert.equal(f.totalDiarias, 497.77, '537,77 − (110 − 70)'); assert.equal(f.descAtraso, 23.33); assert.equal(f.fechamento, 474.44); assert.equal(f.diasAtrasoLimite, 1);
// na sexta: proporcional a 8 h
ctx = cx({presenca: marcar('a', ['OK', 'OK', 'OK', 'OK', 'OK']), pagamentos: {p1: vt('a', 5)}, atrasos: {x: {tempId: 'a', data: dia(4), horas: 2}}});
f = T.fechamentoSemana('a', SEG, ctx);
assert.equal(f.totalDiarias, 537.77 - (97.77 - 70)); assert.equal(f.descAtraso, 17.5, '2 x 70/8');
// atraso de outro temporário ou de outra semana não entra
ctx = cx({presenca: marcar('a', ['OK']), atrasos: {x: {tempId: 'b', data: dia(0), horas: 3}, y: {tempId: 'a', data: '2026-09-28', horas: 3}}});
assert.equal(T.fechamentoSemana('a', SEG, ctx).descAtraso, 0);

// ── feriado: não paga, não é falta, não conta como convocação ──
const cfgFer = {feriados: {[dia(2)]: 'Feriado de teste'}};
ctx = cx({config: cfgFer, presenca: marcar('a', ['OK', 'OK', 'F', 'OK', 'OK']), pagamentos: {p1: vt('a', 4)}});
f = T.fechamentoSemana('a', SEG, ctx);
assert.equal(f.regra, 'Cheia', 'F marcado num feriado é ignorado'); assert.equal(f.dias[dia(2)], 'FER'); assert.equal(f.faltas, 0);
assert.equal(f.totalDiarias, 3 * 110 + 97.77, 'feriado não paga'); assert.equal(f.fechamento, 427.77); assert.equal(f.descVT, 0, 'VT de 4 dias para 4 dias trabalhados');

// ── pagamento: semana de referência padrão (data) e explícita ──
ctx = cx({presenca: marcar('a', ['OK', 'OK', 'OK', 'OK', 'OK']), pagamentos: {
  p1: vt('a', 5), s1: {tempId: 'a', data: '2026-09-29', valor: 500, categoria: 'SALARIO', semana: SEG}}});
f = T.fechamentoSemana('a', SEG, ctx);
assert.equal(f.pago, 500, 'salário pago na terça seguinte, atribuído à semana certa'); assert.equal(f.emAberto, 37.77);
assert.equal(T.fechamentoSemana('a', '2026-09-28', ctx).pago, 0);
ctx.pagamentos.s1 = {tempId: 'a', data: '2026-09-23', valor: 200, categoria: 'SALARIO'};
assert.equal(T.fechamentoSemana('a', SEG, ctx).pago, 200, 'sem semana explícita vale a semana da data (como na planilha)');

// ── horas da sexta por semana: 9 h paga a diária de seg-qui ──
ctx = cx({presenca: marcar('a', ['OK', 'OK', 'OK', 'OK', 'OK']), pagamentos: {p1: vt('a', 5)}, semanas: {[SEG]: {horasSexta: 9}}});
assert.equal(T.fechamentoSemana('a', SEG, ctx).totalDiarias, 550);

// ── folha da semana, totais e CSV ──
const temps = {a: {nome: 'Ana', status: 'Ativo'}, b: {nome: 'Beto', status: 'Ativo'}, c: {nome: 'Carla', status: 'Inativo'}};
ctx = cx({presenca: marcar('b', ['OK', 'OK', 'OK', 'OK', 'OK'], marcar('a', ['OK', 'NC', 'NC', 'NC', 'NC'])), pagamentos: {p1: vt('b', 5)}});
const folha = T.folhaDaSemana(temps, SEG, ctx);
assert.deepEqual(folha.linhas.map(l => l.nome), ['Ana', 'Beto'], 'inativo sem movimento fica fora');
assert.equal(folha.totais.trabalhados, 6);
assert.equal(folha.totais.fechamento, T.fechamentoSemana('a', SEG, ctx).fechamento + 537.77);
const csv = T.csvFolha(folha, SEG).split('\r\n');
assert.equal(csv.length, 3); assert.match(csv[0], /^Semana;Nome;/); assert.match(csv[2], /^2026-09-21;Beto;5;0;0;Cheia;537,77;/);

// ── histórico de performance (as colunas quebradas do CADASTRO) ──
const p2 = marcar('a', ['OK', 'OK', 'F', 'FA', 'NC']);
const s2 = T.somaDias(SEG, 7);
[['OK', 0], ['OK', 1], ['NC', 2]].forEach(([c, i]) => { (p2[T.somaDias(s2, i)] = p2[T.somaDias(s2, i)] || {}).a = c; });
ctx = cx({presenca: p2, pagamentos: {s1: {tempId: 'a', data: '2026-09-29', valor: 100, categoria: 'SALARIO'}, v1: vt('a', 2)}});
const h = T.historico('a', ctx);
assert.equal(h.diasTrabalhados, 4); assert.equal(h.faltas, 1); assert.equal(h.abonadas, 1); assert.equal(h.naoConvocados, 2);
assert.equal(h.presencaPct, 4 / 6, 'presença = OK ÷ (OK + F + FA), como na planilha');
assert.equal(h.primeiroDia, SEG); assert.equal(h.ultimoDia, T.somaDias(s2, 1));
assert.equal(h.semanas, 2); assert.equal(h.totalPago, 100);
assert.equal(Math.round((h.totalLiquido - h.totalPago) * 100) / 100, h.saldo);
assert.equal(T.historico('zz', ctx).presencaPct, null, 'sem dias: sem percentual');

// ── validações ──
assert.deepEqual(T.validarAtraso({tempId: 'a', data: dia(1), horas: 1}), []);
assert.equal(T.validarAtraso({tempId: 'a', data: '2026-09-26', horas: 1}).length, 1, 'sábado não');
assert.equal(T.validarAtraso({tempId: '', data: 'x', horas: 0}).length, 3);
assert.deepEqual(T.validarPagamento({tempId: 'a', data: SEG, valor: 53, categoria: 'VT'}, {}), []);
assert.match(T.validarPagamento({tempId: 'a', data: SEG, valor: 50, categoria: 'VT'}, {})[0], /múltiplo/);
assert.equal(T.validarPagamento({tempId: 'a', data: SEG, valor: 50, categoria: 'OUTRO'}, {}).length, 1);
assert.deepEqual(T.validarPagamento({tempId: 'a', data: SEG, valor: 500, categoria: 'SALARIO'}, {}), []);
assert.equal(T.validarTemp({nome: ' '}).length, 1);
assert.deepEqual(T.validarParametros({}), []);
assert.equal(T.validarParametros({valorHora: 0}).length, 1);
assert.equal(T.parametros({valorHora: '13,5'}).valorHora, 12.22, 'texto inválido volta ao padrão');
assert.ok(Object.keys(T.feriados({})).length >= 10, 'sem feriados configurados vale a lista da planilha');
assert.equal(T.moeda(1234.5), 'R$ 1.234,50');

console.log('OK Temporários: legenda da planilha, atraso, VT, feriado, semana do pagamento, folha, CSV, histórico e validações.');
