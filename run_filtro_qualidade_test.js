'use strict';
/* Busca e filtros da Qualidade (27/10/2026): shared/filtro-qualidade.js puro. */
const assert = require('node:assert/strict');
const F = require('./public/shared/filtro-qualidade.js');

// Busca: sem acento, sem caixa, todas as palavras em qualquer ordem/campo.
assert.equal(F.normalizar('  Miss  RÔSE '), 'miss rose');
assert.equal(F.casaBusca(['CREME LEÃO DO DESERTO', 'MISS RÔSE'], 'miss creme'), true);
assert.equal(F.casaBusca(['CREME LEÃO DO DESERTO', 'MISS RÔSE'], 'leao'), true);
assert.equal(F.casaBusca(['CREME LEÃO DO DESERTO'], 'leao glow'), false, 'todas as palavras precisam aparecer');
assert.equal(F.casaBusca(['X'], '   '), true, 'busca vazia não filtra');
assert.equal(F.casaBusca([null, undefined, 'NF 555'], 'nf 555'), true);

// Opções: grafias do mesmo nome viram uma; ordem alfabética sem acento.
assert.deepEqual(F.opcoes(['MISS RÔSE', 'Miss Rose', '', null, 'Ácidos SA', 'Beta']), ['Ácidos SA', 'Beta', 'MISS RÔSE']);

// Fila.
const it = (extra) => Object.assign({texto: ['MPGR-001', 'ALCOOL CEREAIS', 'NF 555', 'Química Sul'], fornecedor: 'Química Sul', dias: 5, rascunho: false}, extra);
assert.equal(F.passaFila(it(), {}), true);
assert.equal(F.passaFila(it(), {busca: 'alcool 555'}), true);
assert.equal(F.passaFila(it(), {busca: 'glicerina'}), false);
assert.equal(F.passaFila(it(), {fornecedor: 'QUIMICA SUL'}), true, 'fornecedor compara sem acento e caixa');
assert.equal(F.passaFila(it(), {fornecedor: 'Outro'}), false);
assert.equal(F.passaFila(it(), {espera: '3'}), true);
assert.equal(F.passaFila(it(), {espera: '7'}), false);
assert.equal(F.passaFila(it({dias: 7}), {espera: '7'}), false, 'mais de 7 dias: 7 não entra');
assert.equal(F.passaFila(it({dias: null}), {espera: '3'}), false, 'sem data não passa no filtro de espera');
assert.equal(F.passaFila(it({rascunho: true}), {situacao: 'preenchimento'}), true);
assert.equal(F.passaFila(it(), {situacao: 'preenchimento'}), false);
assert.equal(F.passaFila(it({rascunho: true}), {situacao: 'nao_iniciado'}), false);
assert.equal(F.filtrosAtivosFila({busca: ' ', fornecedor: '', espera: '3', situacao: 'preenchimento'}), 2);

// RNCs.
const aberta = (st) => st === 'ABERTA' || st === 'EM_ANALISE';
const rnc = (extra) => Object.assign({numero: 'RNC-2026-0031', status: 'ABERTA', classificacao: 'MAIOR', origem: 'RECEBIMENTO',
  fornecedorNome: 'Química Sul', itemCodigo: 'MPGR-001', descricao: 'Odor alterado', loteOrigem: 'F-123', causaRaiz: 'Tambor mal vedado',
  abertaEm: '2026-10-20T11:00:00.000Z', abertaPor: 'Daiene'}, extra);
const padrao = {status: 'ABERTAS'};
assert.equal(F.passaRnc(rnc(), padrao, aberta), true);
assert.equal(F.passaRnc(rnc({status: 'CONCLUIDA'}), padrao, aberta), false);
assert.equal(F.passaRnc(rnc({status: 'CONCLUIDA'}), {status: ''}, aberta), true);
assert.equal(F.passaRnc(rnc(), {status: 'EM_ANALISE'}, aberta), false);
assert.equal(F.passaRnc(rnc(), {status: '', classe: 'CRITICA'}, aberta), false);
assert.equal(F.passaRnc(rnc(), {status: '', origem: 'RECEBIMENTO'}, aberta), true);
assert.equal(F.passaRnc(rnc(), {status: '', origem: 'CLIENTE'}, aberta), false);
assert.equal(F.passaRnc(rnc(), {status: '', fornecedor: 'quimica sul'}, aberta), true);
assert.equal(F.passaRnc(rnc(), {status: '', de: '2026-10-20', ate: '2026-10-20'}, aberta), true, 'período inclusivo');
assert.equal(F.passaRnc(rnc(), {status: '', de: '2026-10-21'}, aberta), false);
assert.equal(F.passaRnc(rnc(), {status: '', ate: '2026-10-19'}, aberta), false);
assert.equal(F.passaRnc(rnc({abertaEm: null}), {status: '', de: '2026-01-01'}, aberta), false);
// Busca agora acha lote, causa raiz e quem abriu; e palavras soltas.
assert.equal(F.passaRnc(rnc(), {status: '', busca: 'F-123'}, aberta), true);
assert.equal(F.passaRnc(rnc(), {status: '', busca: 'tambor vedado'}, aberta), true);
assert.equal(F.passaRnc(rnc(), {status: '', busca: 'daiene odor'}, aberta), true);
assert.equal(F.passaRnc(rnc(), {status: '', busca: '0031'}, aberta), true);
assert.equal(F.filtrosAtivosRnc({status: 'ABERTAS'}), 0, 'o padrão não conta como filtro');
assert.equal(F.filtrosAtivosRnc({status: '', origem: 'CLIENTE', de: '2026-10-01'}), 3);
console.log('OK filtros da Qualidade: busca por palavras sem acento, fornecedor por nome, espera, situação; RNC por origem, fornecedor e período.');
