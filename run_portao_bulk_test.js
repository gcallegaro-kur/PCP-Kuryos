// GAP-04: OP com fórmula só envasa com bulk liberado. node run_portao_bulk_test.js
const assert = require('assert');
const M = require('./public/shared/manipulacao.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const DEPOIS = '2026-09-25T10:00:00.000Z', ANTES = '2026-09-21T10:00:00.000Z';
const nova = extra => Object.assign({lote: '26270/01', formulaVersao: 'v2', dataEmissao: DEPOIS, status: 'Programado'}, extra || {});

eq(M.PORTAO_BULK_DESDE, '2026-09-24T03:00:00.000Z', 'corte em 24/09 00:00 BRT');

// 1. OP nova com fórmula e sem fase: trava, com motivo que diz o que fazer.
let r = M.podeEnvasar(nova());
ok(!r.ok, 'OP com fórmula emitida depois do corte não envasa sem bulk');
ok(/Manipulação/.test(r.motivo) && /Qualidade/.test(r.motivo), 'motivo aponta Manipulação e Qualidade');

// 2. Cada estado da fase: só LIBERADO passa.
['AGUARDANDO_PESAGEM', 'PESADO', 'CONFERIDO', 'EM_MANIPULACAO', 'AGUARDANDO_CQ', 'REPROVADO'].forEach(st => {
  ok(!M.podeEnvasar(nova({manipulacao: {status: st}})).ok, st + ' não envasa');
});
ok(M.podeEnvasar(nova({manipulacao: {status: 'LIBERADO'}})).ok, 'LIBERADO envasa');

// 3. Sem fórmula (kit, bulk do cliente) passa.
ok(M.podeEnvasar(nova({formulaVersao: null})).ok, 'sem fórmula passa');
ok(M.podeEnvasar(nova({formulaVersao: '  '})).ok, 'fórmula em branco conta como sem fórmula');

// 4. Corte prospectivo: OP emitida antes segue a regra antiga.
ok(M.podeEnvasar(nova({dataEmissao: ANTES})).ok, 'antes do corte, sem fase, passa');
ok(!M.podeEnvasar(nova({dataEmissao: ANTES, manipulacao: {status: 'AGUARDANDO_CQ'}})).ok, 'antes do corte, com fase pendente, continua travando');
ok(M.podeEnvasar(nova({dataEmissao: undefined})).ok, 'sem data de emissão (legado/VBA) passa');
ok(M.podeEnvasar(nova({dataEmissao: 'lixo'})).ok, 'data inválida não trava');

// 5. Nunca trava no meio do envase.
ok(M.podeEnvasar(nova({produzidoLinha: 120})).ok, 'OP que já envasou segue');
ok(M.podeEnvasar(nova({setupFim: DEPOIS})).ok, 'OP com setup encerrado segue');

// 6. Retrabalho não refabrica: passa mesmo com fórmula ou fase pendente.
ok(M.podeEnvasar(nova({tipo: 'RETRABALHO'})).ok, 'retrabalho sem fase passa');
ok(M.podeEnvasar(nova({tipo: 'RETRABALHO', manipulacao: {status: 'REPROVADO'}})).ok, 'retrabalho não depende do bulk');

// 7. Opções: corte configurável e exigirSempre continua valendo.
ok(M.podeEnvasar(nova(), {desde: '2026-10-01T00:00:00Z'}).ok, 'corte posterior libera');
ok(!M.podeEnvasar({lote: 'x'}, {exigirSempre: true}).ok, 'exigirSempre trava até sem fórmula');
ok(M.podeEnvasar({lote: 'x'}).ok, 'OP sem nada (histórico) continua livre');
eq(M.exigeBulk(nova()), true, 'exigeBulk exportado');
eq(M.exigeBulk(null), false, 'exigeBulk sem OP');

// 8. As 13 OPs reais de 23/09 (com fórmula, sem fase, emitidas 10–22/09) não travam.
['2026-09-10T12:00:00.000Z', '2026-09-21T14:00:00.000Z', '2026-09-22T09:00:00.000Z'].forEach(d => {
  ok(M.podeEnvasar({lote: 'legado', formulaVersao: 'v1', dataEmissao: d, status: 'Programado'}).ok, 'legado de ' + d.slice(0, 10) + ' segue');
});

console.log('portão do bulk: ' + n + ' asserções OK');
