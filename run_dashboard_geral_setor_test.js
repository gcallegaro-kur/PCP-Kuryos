'use strict';
/* Dashboard Geral: produção é o que o ENVASE fez, uma vez só.
 *
 * Por que existe: em 09/10/2026 o usuário estranhou os números ("achei muito
 * alto"). O `RAW.producao` do dashboard_analise.html era montado a partir de
 * TODO registro de `registros/`, com `tipo: 'Envase'` fixo e sem olhar o
 * setor. Rotulagem e Posto entravam no total como se fossem produção — e não
 * são: rotular ou encartuchar é etapa POSTERIOR do mesmo lote que a linha já
 * contou, não cria unidade nova.
 *
 * Medido na base: de 3.746.234 un. em `registros/`, 94.645 eram rotulagem e
 * 54.351 posto — 148.996 un. somadas em duplicidade.
 *
 * É a mesma regra que o apontamento já aplica (isSetorEnvase, form.html) e que
 * o Dashboard Diário já tinha corrigido; faltava aqui.
 */
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

// ── A regra de montagem: o setor sai da config, não é fixo ─────────────────
{
  ok(/const CFG_ROTULAGEM = _cfg\.rotulagem \|\| \[\];/.test(source),
    'o dashboard carrega config.rotulagem — é ela que diz quais recursos NÃO são envase');
  ok(/const CFG_POSTOS = _cfg\.postos \|\| \[\];/.test(source), 'e config.postos');
  ok(/setor: _setorReg,/.test(source), 'cada registro carrega o setor que lhe corresponde');
  eq((source.match(/tipo: 'Envase',/g) || []).length, 0,
    "nenhum registro pode mais nascer com tipo 'Envase' fixo — era o que apagava a distinção de setor");
  ok(/_setorReg === 'rotulagem' \? 'Rotulagem'/.test(source), 'o rótulo do tipo acompanha o setor');
}

// ── A regra de contagem ────────────────────────────────────────────────────
{
  const ctx = {
    console, Math, String, Number, Object, Array, Boolean,
    normalizeSearch: (s) => String(s || '').toLowerCase(),
    RAW: {producao: [
      {u: 1000, lin: 'Linha 1',      setor: 'envase',    cli: 'MISS', cat: 'A', sub: 'B', visc: 'L', sku: 'S1', desc: 'd', _ymd: '2026-10-01'},
      {u: 900,  lin: 'Linha 2',      setor: 'envase',    cli: 'MISS', cat: 'A', sub: 'B', visc: 'L', sku: 'S1', desc: 'd', _ymd: '2026-10-01'},
      {u: 800,  lin: 'Rotulagem 01', setor: 'rotulagem', cli: 'MISS', cat: 'A', sub: 'B', visc: 'L', sku: 'S1', desc: 'd', _ymd: '2026-10-01'},
      {u: 700,  lin: 'Celofane',     setor: 'posto',     cli: 'MISS', cat: 'A', sub: 'B', visc: 'L', sku: 'S1', desc: 'd', _ymd: '2026-10-01'},
      // registro antigo, de antes da classificação existir: sem `setor`
      {u: 600,  lin: 'Linha 01',     cli: 'MISS', cat: 'A', sub: 'B', visc: 'L', sku: 'S1', desc: 'd', _ymd: '2025-05-01'}
    ]},
    filters: {dateFrom: '', dateTo: '', cliente: [], categoria: [], subcategoria: [], viscosidade: [], linha: [], search: ''}
  };
  vm.createContext(ctx);
  vm.runInContext(extrairFuncao('filterProducao'), ctx);
  const soma = (lista) => lista.reduce((s, p) => s + p.u, 0);

  // Sem filtro: só o que o envase fez
  const padrao = ctx.filterProducao();
  eq(soma(padrao), 2500, 'sem filtro, o total é 1000 + 900 + 600 — rotulagem e posto ficam de fora');
  eq(padrao.length, 3, 'três registros de envase');
  ok(!padrao.some((p) => p.setor === 'rotulagem'), 'nenhuma rotulagem no total');
  ok(!padrao.some((p) => p.setor === 'posto'), 'nenhum posto no total');
  ok(padrao.some((p) => p.lin === 'Linha 01'),
    'registro antigo sem `setor` continua contando: na dúvida é envase, não some do histórico');

  // Escolher a rotulagem no filtro de Linha mostra a rotulagem
  ctx.filters.linha = ['Rotulagem 01'];
  const soRot = ctx.filterProducao();
  eq(soma(soRot), 800, 'filtrando por Rotulagem 01, aparece a rotulagem — ela não sumiu do sistema');
  eq(soRot.length, 1);

  ctx.filters.linha = ['Celofane'];
  eq(soma(ctx.filterProducao()), 700, 'o mesmo vale para posto');

  // Filtrar por uma linha de envase não traz rotulagem junto
  ctx.filters.linha = ['Linha 1'];
  const soLinha1 = ctx.filterProducao();
  eq(soma(soLinha1), 1000, 'filtrar Linha 1 traz só a Linha 1');

  // Envase + rotulagem selecionados juntos: quem pediu, recebe
  ctx.filters.linha = ['Linha 1', 'Rotulagem 01'];
  eq(soma(ctx.filterProducao()), 1800, 'pedindo os dois explicitamente, soma os dois');

  // Os outros filtros seguem valendo junto com o de setor
  ctx.filters.linha = [];
  ctx.filters.dateFrom = '2026-01-01';
  eq(soma(ctx.filterProducao()), 1900, 'o corte por data continua funcionando sobre o envase');
  ctx.filters.dateFrom = '';
  ctx.filters.cliente = ['OUTRO'];
  eq(soma(ctx.filterProducao()), 0, 'e o de cliente também');
}

// ── A exclusão não pode ser silenciosa ─────────────────────────────────────
{
  ok(/un\. de rotulagem\/posto fora do total/.test(source),
    'o cabeçalho diz quantas unidades ficaram fora e por quê');
  ok(/filtre por Linha para vê-las/.test(source),
    'e diz como vê-las — número que some sem explicação vira desconfiança');
}

console.log('OK dashboard geral por setor: ' + n + ' verificacoes — producao conta so o envase, ' +
  'rotulagem e posto saem do total mas continuam visiveis pelo filtro de Linha, e a exclusao e' + "'" + ' declarada na tela.');
