/* Situação de encerramento da OP (opção A, decidida pelo usuário em 2026-09-29):
   só sai da lista principal quando concluída pelo PCP E todo PA liberado. */
const assert = require('assert');
const path = require('path');
const SO = require(path.join(__dirname, 'public', 'shared', 'situacao-op.js'));

const AGORA = Date.parse('2026-09-29T12:00:00Z');
const dias = (d) => new Date(AGORA - d * 86400000).toISOString();
const sit = (op, q, conf) => SO.situacao(op, q, conf, AGORA).estado;

// 1. Não concluída pelo PCP: nunca encerrada, mesmo com tudo liberado.
assert.strictEqual(sit({status: 'Em Produção'}, {liberado: 100}, null), 'ATIVA');
assert.strictEqual(sit({status: 'Aguardando Confirmação'}, {liberado: 100}, null), 'ATIVA');

// 2. Concluída com tudo liberado e conferência finalizada: encerrada.
assert.strictEqual(sit({status: 'Concluído'}, {liberado: 100, pendente: 0, reprovado: 0}, {finalizadoEm: dias(1)}), 'ENCERRADA');

// 3. PA em quarentena ou reprovado mantém a OP na lista principal.
assert.strictEqual(sit({status: 'Concluído'}, {liberado: 80, pendente: 20}, {finalizadoEm: dias(1)}), 'NA_QUALIDADE');
assert.strictEqual(sit({status: 'Concluído'}, {reprovado: 5}, {finalizadoEm: dias(1)}), 'NA_QUALIDADE');
assert.ok(/20 un aguardando a Qualidade/.test(SO.situacao({status: 'Concluído'}, {pendente: 20}, null, AGORA).motivo));

// 4. Volta sozinha: encerrada hoje, devolução em quarentena amanhã.
const op = {status: 'Concluído', produzidoLinha: 100};
assert.strictEqual(sit(op, {liberado: 100}, {finalizadoEm: dias(2)}), 'ENCERRADA');
assert.strictEqual(sit(op, {liberado: 100, pendente: 30}, {finalizadoEm: dias(2)}), 'NA_QUALIDADE');

// 5. Conferência de PA aberta espera a Logística.
assert.strictEqual(sit(op, {}, {contagens: {}}), 'AGUARDA_LOGISTICA');

// 6. Confirmada há pouco e sem conferência: espera a Logística. Antiga: encerrada.
assert.strictEqual(sit({status: 'Concluído', produzidoLinha: 100, confirmadoEm: dias(2)}, {}, null), 'AGUARDA_LOGISTICA');
assert.strictEqual(sit({status: 'Concluído', produzidoLinha: 100, confirmadoEm: dias(30)}, {}, null), 'ENCERRADA');
assert.strictEqual(sit({status: 'Concluído', produzidoLinha: 100}, {}, null), 'ENCERRADA', 'histórico anterior ao WMS não fica pendurado');
assert.strictEqual(sit({status: 'Concluído', produzidoLinha: 0, confirmadoEm: dias(1)}, {}, null), 'ENCERRADA', 'sem produção não há PA a conferir');

// 7. Pedido que ainda precisa de OP: atendido (≥95%) e sem OP ativa não precisa.
assert.strictEqual(SO.pedidoPrecisaOp({qtdTotal: 1000, produzido: 1000}, false), false);
assert.strictEqual(SO.pedidoPrecisaOp({qtdTotal: 1000, produzido: 950}, false), false);
assert.strictEqual(SO.pedidoPrecisaOp({qtdTotal: 1000, produzido: 940}, false), true);
assert.strictEqual(SO.pedidoPrecisaOp({qtdTotal: 1000}, false), true);
assert.strictEqual(SO.pedidoPrecisaOp({qtdTotal: 1000, produzido: 0}, true), false, 'já tem OP ativa');
assert.strictEqual(SO.pedidoPrecisaOp({produzido: 5}, false), true, 'sem quantidade total não dá para dizer que foi atendido');

// 8. Selos: um por pendência, nenhum em OP cancelada.
const ctxOk = {temPedido: true};
assert.deepStrictEqual(SO.selos({status: 'Em Produção', linha: 'Linha 1'}, ctxOk), []);
assert.deepStrictEqual(SO.selos({status: 'Programado'}, ctxOk).map(x => x.chave), ['sem-linha']);
assert.deepStrictEqual(SO.selos({status: 'Em Produção', linha: 'L'}, {temPedido: false, divergencia: true, transferenciaPendente: true, pendenteQualidade: 10, reprovado: 2}).map(x => x.chave),
  ['divergencia', 'transferencia', 'sem-pedido', 'qualidade', 'reprovado']);
assert.deepStrictEqual(SO.selos({status: 'Cancelado'}, {temPedido: false, divergencia: true}), []);

console.log('situacao-op: todos os testes passaram');
