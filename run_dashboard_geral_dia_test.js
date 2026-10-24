'use strict';
/* Dashboard Geral: cada produção pertence ao DIA EM QUE FOI APONTADA.
 *
 * Por que existe: em 23/10/2026 o usuário somou o produzido dia a dia no
 * Dashboard Diário (19 a 23/10) e deu 60.450; o mesmo filtro no Dashboard
 * Geral deu 54.751. Diferença de 5.699 un, em exatamente 2 apontamentos.
 *
 * Causa: as duas telas datavam o MESMO registro por coisas diferentes. O
 * Diário usa o dia do apontamento (a chave do nó `registros/{data}`); o Geral
 * montava `_ymd` a partir de `dt`, e `dt` é `periodoInicio` quando o registro
 * tem `horasTrabalhadas`. Turno aberto em 16/10 e encerrado em 19/10 fazia o
 * Geral contar a produção toda em 16/10 — fora da janela pedida.
 *
 * Medido na base em 23/10: 115 dos 1.781 registros eram datados diferente
 * pelas duas telas — 105 por `periodoInicio` (237.213 un) e 10 por fuso
 * (26.691 un). E havia 28 "turnos" de mais de 24h, até 94h, somando 93.288 un.
 *
 * Regra do usuário (24/10): "por mais que uma OP atravesse vários dias, cada
 * produção pertence ao dia que está sendo produzida" e "o apontamento diário
 * tem que bater com as outras informações".
 *
 * O fuso é fixado antes de qualquer Date: em UTC o bug do `toISOString()` não
 * aparece, e o teste passaria à toa numa máquina fora do Brasil.
 */
process.env.TZ = 'America/Sao_Paulo';

const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/dashboard_analise.html', 'utf8');
let n = 0;
const eq = (a, b, m) => { n++; assert.equal(a, b, m); };
const ok = (c, m) => { n++; assert.ok(c, m); };

function extrairFuncao(nome) {
  const ini = source.indexOf('function ' + nome + '(');
  if (ini < 0) throw new Error('não achei ' + nome + ' em dashboard_analise.html');
  const abre = source.indexOf('{', ini);
  let prof = 0, aspas = null, escapado = false;
  for (let i = abre; i < source.length; i++) {
    const c = source[i];
    if (aspas) {
      if (escapado) escapado = false;
      else if (c === '\\') escapado = true;
      else if (c === aspas) aspas = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { aspas = c; continue; }
    if (c === '{') prof++;
    if (c === '}' && --prof === 0) return source.slice(ini, i + 1);
  }
  throw new Error('função incompleta: ' + nome);
}
// Helpers de uma linha (`const x = ...;`) saem por regex: o teste tem que
// rodar o código de verdade, não uma cópia reescrita aqui.
function extrairConst(nome) {
  const re = new RegExp('^const ' + nome + ' = .*;$', 'm');
  const m = source.match(re);
  if (!m) throw new Error('não achei o const ' + nome);
  return m[0];
}

// ── A fonte: o dia da produção é gravado, não derivado de `dt` ─────────────
{
  ok(/diaProd: date,/.test(source),
    'cada registro carrega `diaProd` = a chave do nó registros/{data}');
  ok(/p\._ymd = p\.diaProd \|\|/.test(source),
    '`_ymd` sai de `diaProd`; `dt` (início do turno) não pode datar a produção');
  ok(/const _ymdLocal = /.test(source),
    'existe um helper de data local — toISOString() devolve o dia seguinte depois das 21h');
  const bloco = source.slice(source.indexOf('RAW.producao.forEach'), source.indexOf('RAW.pedidos.forEach'));
  eq(/toISOString/.test(bloco), false,
    'nenhum toISOString no bloco de produção: é por ali que o fuso entrava');
}

// ── A regra, rodando o código real ────────────────────────────────────────
{
  const ctx = {console, Math, String, Number, Object, Array, Boolean, Date, isNaN, parseFloat,
    RAW: {producao: [], pedidos: [], entradas: [], expedicoes: [], expedidos: []}};
  vm.createContext(ctx);
  vm.runInContext(extrairConst('_safeDate'), ctx);
  vm.runInContext(extrairConst('_ymdLocal'), ctx);
  vm.runInContext(extrairFuncao('_weekStart'), ctx);
  vm.runInContext(extrairFuncao('preprocessRawData'), ctx);

  ctx.RAW.producao = [
    // 1. O caso real que gerou a diferença: apontado em 19/10, turno aberto
    //    em 16/10 (73h). Pertence a 19/10.
    {diaProd: '2026-10-19', dt: '2026-10-16T18:58:00', dt_fim: '2026-10-19T17:00:00',
      u: 4480, h: 73.03, lin: 'Linha 2', setor: 'envase', tipo: 'Envase', lot: '26286/02'},
    // 2. O bug de fuso: apontado às 22h, sem turno. Pertence ao dia 20, não ao 21.
    {diaProd: '2026-10-20', dt: '2026-10-20T22:00:00', dt_fim: '2026-10-20T22:59:00',
      u: 500, h: 1, lin: 'Linha 1', setor: 'envase', tipo: 'Envase', lot: '26290/01'},
    // 3. Apontamento normal, dentro do próprio dia.
    {diaProd: '2026-10-21', dt: '2026-10-21T14:00:00', dt_fim: '2026-10-21T14:59:00',
      u: 1000, h: 1, lin: 'Linha 1', setor: 'envase', tipo: 'Envase', lot: '26291/01'},
    // 4. Registro sem `diaProd` (defensivo): cai no relógio local, nunca em UTC.
    {dt: '2026-10-22T23:30:00', dt_fim: '2026-10-22T23:59:00',
      u: 300, h: 1, lin: 'Linha 3', setor: 'envase', tipo: 'Envase', lot: '26292/01'}
  ];
  ctx.preprocessRawData();
  const P = ctx.RAW.producao;

  eq(P[0]._ymd, '2026-10-19', 'turno de 73h conta no dia do apontamento, não no dia em que abriu');
  eq(P[1]._ymd, '2026-10-20', 'apontamento das 22h fica no dia 20 — toISOString() jogava para o 21');
  eq(P[2]._ymd, '2026-10-21', 'apontamento normal não muda');
  eq(P[3]._ymd, '2026-10-22', 'sem diaProd, vale o relógio local e não o UTC');

  // O instante real continua disponível: a distribuição por hora do dia
  // (prodHourlyAlloc) e o cálculo de u/h dependem dele.
  eq(P[0]._d.toISOString(), new Date('2026-10-16T18:58:00').toISOString(),
    '`_d` segue sendo o instante real do início do turno');
  eq(P[0].h, 73.03, 'as horas trabalhadas não são tocadas: u/h continua certo');

  // Mês e semana acompanham o dia da produção, senão o total do mês não fecha
  // com a soma dos dias.
  eq(P[0]._ym, '2026-10');
  eq(P[0]._wk, '2026-10-19', 'semana começa na segunda 19/10, derivada do dia da produção');
  eq(P[2]._wk, '2026-10-19', 'o dia 21 cai na mesma semana');

  // O filtro usa `_ymd` e os gráficos usam `alloc[].dia`: têm que ser o mesmo
  // dia, senão o KPI e as barras da MESMA tela discordam.
  P.forEach((p, i) => {
    eq(p.alloc.length, 1, 'registro ' + i + ' tem uma alocação');
    eq(p.alloc[0].dia, p._ymd, 'alloc[].dia e _ymd apontam o mesmo dia (registro ' + i + ')');
    eq(p.alloc[0].u, p.u, 'a alocação leva as unidades inteiras (registro ' + i + ')');
  });
}

// ── Ponta a ponta: o filtro de 19 a 23/10 pega o turno longo ──────────────
{
  const ctx = {console, Math, String, Number, Object, Array, Boolean,
    normalizeSearch: (s) => String(s || '').toLowerCase(),
    RAW: {producao: [
      {u: 4480, lin: 'Linha 2', setor: 'envase', tipo: 'Envase', cli: 'MISS', cat: 'A', sub: 'B', visc: 'L', sku: 'S1', desc: 'd', _ymd: '2026-10-19'},
      {u: 1219, lin: 'Linha 1', setor: 'envase', tipo: 'Envase', cli: 'MISS', cat: 'A', sub: 'B', visc: 'L', sku: 'S1', desc: 'd', _ymd: '2026-10-19'},
      {u: 500,  lin: 'Linha 1', setor: 'envase', tipo: 'Envase', cli: 'MISS', cat: 'A', sub: 'B', visc: 'L', sku: 'S1', desc: 'd', _ymd: '2026-10-20'},
      // fora da janela: não pode entrar
      {u: 9999, lin: 'Linha 1', setor: 'envase', tipo: 'Envase', cli: 'MISS', cat: 'A', sub: 'B', visc: 'L', sku: 'S1', desc: 'd', _ymd: '2026-10-16'},
      // rotulagem na janela: etapa posterior do mesmo lote, não é produção
      {u: 7936, lin: 'Rotulagem 02', setor: 'rotulagem', tipo: 'Rotulagem', cli: 'MISS', cat: 'A', sub: 'B', visc: 'L', sku: 'S1', desc: 'd', _ymd: '2026-10-21'}
    ]},
    filters: {dateFrom: '2026-10-19', dateTo: '2026-10-23', cliente: [], categoria: [],
      subcategoria: [], viscosidade: [], setor: [], linha: [], search: ''}
  };
  vm.createContext(ctx);
  vm.runInContext(extrairFuncao('filterProducao'), ctx);
  const total = ctx.filterProducao().reduce((s, p) => s + p.u, 0);
  eq(total, 6199, 'a janela soma 4.480 + 1.219 + 500; o de 16/10 e a rotulagem ficam fora');
}

console.log('OK Dashboard Geral: produção pertence ao dia do apontamento (' + n + ' verificações).');
