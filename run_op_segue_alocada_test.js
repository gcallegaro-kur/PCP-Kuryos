'use strict';
/* A OP só sai do card da linha quando é encerrada (Concluído/Cancelado).
   'Aguardando Confirmação' (automático ao bater 95%) NÃO a tira -- 26258/06, 09/10. */
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ctx = vm.createContext({console, window: {}, document: {}, localStorage: {}});
vm.runInContext(fs.readFileSync(__dirname + '/public/shared/utils.js', 'utf8'), ctx);
const seg = (s) => vm.runInContext('opSegueAlocada', ctx)({status: s});
for (const s of ['Programado', 'Não Iniciado', 'Em Produção', 'Produção Parcial', 'Aguardando Confirmação', undefined]) assert.equal(seg(s), true, String(s));
for (const s of ['Concluído', 'Cancelado']) assert.equal(seg(s), false, s);
assert.equal(vm.runInContext('opSegueAlocada', ctx)(null), false);
// computeOpStatus muda sozinho a 95%: a OP continua alocada mesmo assim
const st = vm.runInContext('computeOpStatus', ctx)({status: 'Em Produção', qtdPlanejada: 1200, produzidoLinha: 1643});
assert.equal(st, 'Aguardando Confirmação'); assert.equal(seg(st), true);
// os três chamadores usam a regra (e não mais opEstaAtiva)
for (const f of ['form.html', 'dashboard.html', 'planejamento.html']) {
  const t = fs.readFileSync(__dirname + '/public/' + f, 'utf8');
  assert.match(t, /opSegueAlocada\(op\)/, f);
}
console.log('OK OP segue alocada ate encerrar (Aguardando Confirmacao nao tira do card).');
