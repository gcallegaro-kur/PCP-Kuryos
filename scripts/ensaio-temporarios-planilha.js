'use strict';
/* Ensaio: o motor de public/shared/temporarios.js contra os números que a CALCULADORA da planilha calculou.
   node scripts/ensaio-temporarios-planilha.js <pasta com temporarios-importar.json e temporarios-esperado.json>
   (a pasta é gerada por scripts/temporarios-planilha-para-json.py e fica FORA do repositório). */
const fs = require('node:fs');
const path = require('node:path');
const T = require('../public/shared/temporarios.js');
const dir = process.argv[2];
if (!dir) { console.error('Informe a pasta gerada pelo conversor.'); process.exit(2); }
const up = JSON.parse(fs.readFileSync(path.join(dir, 'temporarios-importar.json'), 'utf8'));
const esp = JSON.parse(fs.readFileSync(path.join(dir, 'temporarios-esperado.json'), 'utf8'));

// remonta o estado a partir dos caminhos planos
const estado = {};
Object.entries(up).forEach(([p, v]) => {
  const ks = p.split('/'); let o = estado;
  ks.slice(0, -1).forEach(k => { o = o[k] = o[k] || {}; });
  o[ks[ks.length - 1]] = v;
});
const ctx = {presenca: estado.rh_temporarios_presenca, atrasos: estado.rh_temporarios_atrasos, pagamentos: estado.rh_temporarios_pagamentos, config: estado.rh_temporarios_config,
  semanas: {[esp.semana]: {horasSexta: esp.horasSexta}}};
let dif = 0, n = 0;
const cmp = (nome, campo, a, b) => {
  const ok = (typeof b === 'string' ? a === b : Math.abs((a == null ? 0 : a) - (b == null ? 0 : b)) < 0.006);
  if (!ok) { dif++; console.log('DIFERE', nome, campo, 'motor =', a, 'planilha =', b); }
};
Object.entries(esp.linhas).forEach(([id, e]) => {
  const f = T.fechamentoSemana(id, esp.semana, ctx);
  n++;
  cmp(e.nome, 'diasSegQui', f.diasSegQui, e.diasSegQui); cmp(e.nome, 'diasSexta', f.diasSexta, e.diasSexta); cmp(e.nome, 'regra', f.regra, e.regra);
  cmp(e.nome, 'totalDiarias', f.totalDiarias, e.totalDiarias); cmp(e.nome, 'descVT', f.descVT, e.descVT); cmp(e.nome, 'vtAPagar', f.vtAPagar, e.vtAPagar);
  cmp(e.nome, 'descAtraso', f.descAtraso, e.descAtraso); cmp(e.nome, 'fechamento', f.fechamento, e.fechamento); cmp(e.nome, 'pago', f.pago, e.pago); cmp(e.nome, 'emAberto', f.emAberto, e.emAberto);
});
console.log(n + ' temporários da semana ' + esp.semana + ' conferidos; ' + dif + ' diferença(s).');
const tot = T.folhaDaSemana(estado.rh_temporarios, esp.semana, ctx).totais;
console.log('Total da semana pelo motor: fechamento ' + T.moeda(tot.fechamento) + ' · em aberto ' + T.moeda(tot.emAberto) + ' · VT pago ' + T.moeda(tot.vtPago));
Object.entries(estado.rh_temporarios || {}).slice(0, 3).forEach(([id, t]) => { const h = T.historico(id, ctx); console.log(t.nome, '→', JSON.stringify(h)); });
process.exit(dif ? 1 : 0);
