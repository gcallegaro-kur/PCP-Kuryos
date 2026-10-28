'use strict';
/* Relatório de entradas de materiais (27/10/2026): shared/relatorio-entradas.js puro. */
const assert = require('node:assert/strict');
const R = require('./public/shared/relatorio-entradas.js');

const AGORA = Date.parse('2026-10-27T15:00:00Z');
const q = (extra) => Object.assign({fornecedorNome: 'SOROPACK', loteInterno: 'AK-1', loteOrigem: 'F-9', tipoMaterial: 'EMBALAGEM',
  qtdVolumes: 3, qtdAmostragem: 2, condicoesVeiculo: 4, condicoesEmbalagem: 5, certificadoFornecedor: true, enderecoCodigo: 'DOC-1.1.1'}, extra);
const base = () => ({
  agora: AGORA,
  pedidosCompra: {
    pc1: {numeroFormatado: 'PC-0070', fornecedorNome: 'SOROPACK EMBALAGENS', origemTipo: 'FORNECEDOR',
      itens: {i1: {qtd: 1000, qtdRecebida: 400, unidade: 'un'}, i2: {qtd: 3, qtdEmUnidadeEstoque: 35, qtdRecebida: 35, unidade: 'kg'}},
      recebimentos: {
        r1: {data: '2026-10-15T13:00:00Z', notaFiscal: '829', recebidoPor: 'Marcos', status: 'ATIVO', observacoes: 'caixa amassada',
          itensRecebidos: {
            l1: {itemKey: 'i1', loteKey: 'AK-1', materialCodigo: 'EP-00195', materialNome: 'FRASCO 200ML', qtdRecebidaAgora: 400, qtdDevolvida: 20, unidade: 'un', entradaQualidade: q()},
            l2: {itemKey: 'i2', loteKey: 'AK-2', materialCodigo: 'MPGR.0066', materialNome: 'ÁLCOOL', qtdRecebidaAgora: 35, unidade: 'kg',
              entradaQualidade: q({loteInterno: 'AK-2', tipoMaterial: 'MATERIA_PRIMA', dataValidade: '2027-01-31'})}
          }},
        r2: {data: '2026-10-26T10:00:00Z', notaFiscal: '900', status: 'CANCELADO',
          itensRecebidos: {l1: {itemKey: 'i1', loteKey: 'AK-3', materialCodigo: 'EP-00195', materialNome: 'FRASCO 200ML', qtdRecebidaAgora: 50, unidade: 'un', entradaQualidade: q({loteInterno: 'AK-3'})}}}
      }},
    pc2: {numeroFormatado: 'PC-0071', origemNome: 'MISS RÔSE (cliente)', origemTipo: 'CLIENTE',
      recebimentos: {r1: {data: '2026-10-25T10:00:00Z', notaFiscal: '12', status: 'ATIVO',
        itensRecebidos: {l1: {itemKey: 'x', loteKey: 'AK-4', materialCodigo: 'MPES-8', materialNome: 'ESSÊNCIA', qtdRecebidaAgora: 18.5, unidade: 'kg',
          entradaQualidade: q({loteInterno: 'AK-4', tipoMaterial: 'MATERIA_PRIMA', propriedade: {tipo: 'CLIENTE', clienteNome: 'MISS ROSE'}})}}}}},
    pc3: {numeroFormatado: 'PC-0072', fornecedorNome: 'GRÁFICA', recebimentos: {}}
  },
  estoqueLotes: {
    'EP-00195': {'AK-1': {status: 'LIBERADO', saldoLote: 380, enderecoCodigo: 'GAL-4.1.4', qualidade: {decisao: 'LIBERADO', dataInspecao: '2026-10-16'}},
      'AK-3': {status: 'CANCELADO'}},
    // Código com ponto: o nó do item usa sanitizeKey (ponto vira hífen).
    'MPGR-0066': {'AK-2': {status: 'QUARENTENA', saldoLote: 35, dataValidade: '2027-01-31'}},
    'MPES-8': {'AK-4': {status: 'APROVADO_CONCESSAO', saldoLote: 18.5, qualidade: {decisao: 'APROVADO_CONCESSAO'}}}
  }
});

assert.equal(R.chaveItem('MPGR.0066'), 'MPGR-0066');
const rows = R.linhas(base());
assert.equal(rows.length, 4, 'uma linha por item recebido; PC sem recebimento não entra');
assert.deepEqual(rows.map((r) => r.dia), ['2026-10-26', '2026-10-25', '2026-10-15', '2026-10-15'], 'mais recente primeiro');

const frasco = rows.find((r) => r.loteInterno === 'AK-1');
assert.equal(frasco.pc, 'PC-0070');
assert.equal(frasco.origem, 'SOROPACK EMBALAGENS');
assert.equal(frasco.nf, '829');
assert.equal(frasco.cq, 'LIBERADO');
assert.equal(frasco.inspecionadoEm, '2026-10-16');
assert.equal(frasco.enderecoAtual, 'GAL-4.1.4', 'endereço de HOJE vem do lote, não o da doca');
assert.equal(frasco.saldoLote, 380);
assert.equal(frasco.qtdPedida, 1000);
assert.equal(frasco.qtdRecebidaPc, 400);
assert.equal(frasco.devolvido, 20);
assert.equal(frasco.dono, 'Kuryos');
assert.equal(frasco.diasEsperandoCq, null);

const alcool = rows.find((r) => r.loteInterno === 'AK-2');
assert.equal(alcool.cq, 'AGUARDANDO');
assert.equal(alcool.diasEsperandoCq, 12, 'conta os dias desde a entrada');
assert.equal(alcool.qtdPedida, 35, 'pedido na unidade de estoque (qtdEmUnidadeEstoque), não na da cotação');
assert.equal(alcool.validade, '2027-01-31');

const essencia = rows.find((r) => r.loteInterno === 'AK-4');
assert.equal(essencia.cq, 'CONCESSAO');
assert.equal(essencia.dono, 'MISS ROSE');
assert.equal(essencia.origem, 'MISS RÔSE (cliente)');
assert.equal(essencia.qtdPedida, null, 'item do PC inexistente não inventa pedido');

const cancelada = rows.find((r) => r.loteInterno === 'AK-3');
assert.equal(cancelada.cq, 'CANCELADO');
assert.equal(cancelada.recCancelado, true);

// Situação no CQ.
assert.equal(R.situacaoCq(null, false), 'SEM_LOTE');
assert.equal(R.situacaoCq({status: 'QUARENTENA', qualidade: {decisao: 'INSPECAO_TOTAL'}}, false), 'INSPECAO_TOTAL');
assert.equal(R.situacaoCq({status: 'REPROVADO'}, false), 'REPROVADO');
assert.equal(R.situacaoCq({status: 'BLOQUEADO'}, false), 'BLOQUEADO');
assert.equal(R.situacaoCq({status: 'EXPEDIDO', qualidade: {decisao: 'LIBERADO'}}, false), 'LIBERADO', 'consumido/expedido continua liberado');
assert.equal(R.situacaoCq({status: 'LIBERADO'}, true), 'CANCELADO', 'recebimento cancelado manda');

// Filtros.
assert.equal(R.filtrar(rows, {}).length, 3, 'cancelados ficam fora por padrão');
assert.equal(R.filtrar(rows, {cancelados: true}).length, 4);
assert.equal(R.filtrar(rows, {de: '2026-10-20'}).length, 1);
assert.equal(R.filtrar(rows, {de: '2026-10-15', ate: '2026-10-15'}).length, 2, 'período inclusivo');
assert.equal(R.filtrar(rows, {origem: 'soropack embalagens'}).length, 2);
assert.equal(R.filtrar(rows, {tipo: 'MATERIA_PRIMA'}).length, 2);
assert.equal(R.filtrar(rows, {cq: 'AGUARDANDO'}).length, 1);
assert.equal(R.filtrar(rows, {dono: 'Miss Rose'}).length, 1);
assert.equal(R.filtrar(rows, {busca: 'alcool 829'}).length, 1, 'todas as palavras, sem acento, em qualquer campo');
assert.equal(R.filtrar(rows, {busca: 'gal-4.1.4'}).length, 1, 'acha pelo endereço');
assert.equal(R.filtrar(rows, {busca: 'amassada'}).length, 2, 'acha pelas observações do recebimento');
assert.equal(R.filtrar(rows, {busca: 'inexistente'}).length, 0);
assert.deepEqual(R.opcoes(rows, 'dono'), ['Kuryos', 'MISS ROSE']);

// Resumo: total por unidade, nunca somando kg com un.
const res = R.resumo(R.filtrar(rows, {}));
assert.equal(res.itens, 3);
assert.equal(res.recebimentos, 2);
assert.equal(res.origens, 2);
assert.deepEqual(res.porUnidade, [{unidade: 'kg', qtd: 53.5}, {unidade: 'un', qtd: 400}]);
assert.equal(res.aguardandoCq, 1);
assert.equal(res.maisAntigoCqDias, 12);
assert.equal(res.devolucoes, 1);
assert.equal(res.mpSemValidade, 1, 'a essência (MP) não tem validade');
assert.equal(res.problemas, 0);
assert.equal(R.resumo(R.filtrar(rows, {cancelados: true})).porUnidade.find((u) => u.unidade === 'un').qtd, 400, 'cancelado não soma');

// CSV para o Excel brasileiro.
const csv = R.csv([alcool, essencia]).split('\r\n');
assert.equal(csv.length, 3);
assert.match(csv[0], /^Data;PC;Origem;NF;Código;Material;Tipo;Qtd recebida;Unidade/);
assert.match(csv[1], /^15\/10\/2026;PC-0070;SOROPACK EMBALAGENS;829;MPGR\.0066;ÁLCOOL;Matéria-prima;35;kg;/);
assert.match(csv[1], /;31\/01\/2027;Aguardando CQ;12;/);
assert.match(csv[2], /;18,5;kg;/, 'vírgula decimal');
assert.equal(R.csv([Object.assign({}, alcool, {observacoes: 'x', material: 'A;B "C"'})]).split('\r\n')[1].includes('"A;B ""C"""'), true, 'escapa ; e aspas');

console.log('OK relatório de entradas: linha por item com lote e PC, situação no CQ, filtros, total por unidade e CSV.');
