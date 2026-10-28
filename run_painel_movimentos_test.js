'use strict';
/* Painel de movimentações do WMS (27/10/2026): shared/painel-movimentos.js puro. */
const assert = require('node:assert/strict');
const P = require('./public/shared/painel-movimentos.js');

const movs = {
  'EP-00005': {
    a: {tipo: 'recebimento_pc', em: '2026-10-20T13:00:00Z', qtd: 5400, unidade: 'un', itemCodigo: 'EP-00005', itemNome: 'VÁLVULA SPRAY', itemTipo: 'material',
      loteKey: 'AK-1', enderecoKey: 'DOC-1-1-1', autor: 'Marcos', motivo: 'RECEBIMENTO'},
    b: {tipo: 'transferencia', em: '2026-10-24T15:28:00Z', qtd: 5400, unidade: 'un', itemCodigo: 'EP-00005', itemNome: 'VÁLVULA SPRAY', itemTipo: 'material',
      loteKey: 'AK-1', enderecoKey: 'GAL-4-1-2', ref: 'GAL-4-3-5 -> GAL-4-1-2', autor: 'Diego Costa', motivo: 'TRANSFERÊNCIA ENTRE ENDEREÇOS'},
    c: {tipo: 'consumo_producao', em: '2026-10-26T12:00:00Z', qtd: -1500, unidade: 'un', itemCodigo: 'EP-00005', itemTipo: 'material', ref: '26282/03', motivo: 'CONSUMO DE PRODUÇÃO'},
    d: {tipo: 'consumo', em: '2026-10-26T12:00:01Z', qtd: -1500, unidade: 'un', itemCodigo: 'EP-00005', itemTipo: 'material', loteKey: 'AK-1', enderecoCodigo: 'GAL-4.1.2', autor: 'Ana'}
  },
  'MRARBS12': {
    e: {tipo: 'conferencia_pa', em: '2026-10-26T18:00:00Z', qtd: 1792, unidade: 'un', itemCodigo: 'MRARBS12', itemNome: 'BODY SPLASH FLOR DAURA', itemTipo: 'produto',
      enderecoCodigo: 'DOC-1.1.1', autor: 'Adlai', opKey: '26282-03'},
    f: {tipo: 'qualidade', em: '2026-10-27T01:30:00Z', qtd: 0, itemCodigo: 'MRARBS12', itemTipo: 'produto', enderecoCodigo: 'DOC-1.1.1', autor: 'Roberta'},
    g: {tipo: 'tipo_novo_qualquer', em: '2026-10-27T10:00:00Z', qtd: 3, itemCodigo: 'MRARBS12', itemTipo: 'produto'}
  },
  'MPGR-00066': {
    h: {tipo: 'perda', em: '2026-10-25T10:00:00Z', qtd: -2.5, unidade: 'kg', itemCodigo: 'MPGR-00066', itemTipo: 'material'}
  }
};

// Endereço legível a partir da chave do RTDB.
assert.equal(P.endereco('GAL-4-1-2'), 'GAL-4.1.2');
assert.equal(P.endereco('DOC-1.1.1'), 'DOC-1.1.1');
assert.equal(P.endereco('HISTORICO'), 'HISTORICO');
assert.equal(P.endereco(''), '');

const ev = P.eventos(movs, {fusoMin: 180}); // Brasília
assert.equal(ev.length, 8);
assert.equal(ev[0].id, 'g', 'mais recente primeiro');
const porId = Object.fromEntries(ev.map((e) => [e.id, e]));
assert.equal(porId.b.natureza, 'TRANSFERENCIA');
assert.equal(porId.b.de, 'GAL-4.3.5');
assert.equal(porId.b.para, 'GAL-4.1.2');
assert.equal(porId.a.endereco, 'DOC-1.1.1', 'chave vira código');
assert.equal(porId.c.autor, P.AUTOMATICO, 'sem autor = automático, não some');
assert.equal(porId.c.nome, 'VÁLVULA SPRAY', 'nome completado de outro movimento do item');
assert.equal(porId.d.espelho, true, 'baixa FEFO é espelho do consumo');
assert.equal(porId.c.espelho, false);
assert.equal(porId.f.natureza, 'QUALIDADE');
assert.equal(porId.g.natureza, 'AJUSTE', 'tipo desconhecido não cria natureza nova');
assert.equal(porId.f.dia, '2026-10-26', '01:30 UTC ainda é dia 26 em Brasília');
assert.equal(porId.e.itemTipo, 'produto');

// Período: últimos N dias incluindo hoje.
assert.deepEqual(P.periodo(1, '2026-10-27'), {de: '2026-10-27', ate: '2026-10-27'});
assert.deepEqual(P.periodo(7, '2026-10-27'), {de: '2026-10-21', ate: '2026-10-27'});
assert.deepEqual(P.periodo(0, '2026-10-27'), {de: '', ate: ''});

// Filtros.
assert.equal(P.filtrar(ev, {}).length, 7, 'espelho fora por padrão');
assert.equal(P.filtrar(ev, {espelho: true}).length, 8);
assert.equal(P.filtrar(ev, P.periodo(7, '2026-10-27')).length, 6, 'recebimento do dia 20 fica fora');
assert.equal(P.filtrar(ev, {naturezas: {CONSUMO: true}}).length, 1);
assert.equal(P.filtrar(ev, {naturezas: {CONSUMO: true, PERDA: true}}).length, 2);
assert.equal(P.filtrar(ev, {naturezas: {CONSUMO: false}}).length, 7, 'desligado = sem filtro');
assert.equal(P.filtrar(ev, {itemTipo: 'produto'}).length, 3);
assert.equal(P.filtrar(ev, {endereco: 'GAL-4.3.5'}).length, 1, 'origem da transferência conta');
assert.equal(P.filtrar(ev, {endereco: 'DOC-1.1.1'}).length, 3);
assert.equal(P.filtrar(ev, {item: 'MPGR-00066'}).length, 1);
assert.equal(P.filtrar(ev, {autor: P.AUTOMATICO}).length, 3);
assert.equal(P.filtrar(ev, {busca: 'valvula 26282'}).length, 1, 'todas as palavras, sem acento');
assert.equal(P.filtrar(ev, {busca: 'gal-4.3.5'}).length, 1);

// Resumo: conta movimentos, nunca soma quantidade de unidades diferentes.
const r = P.resumo(P.filtrar(ev, P.periodo(7, '2026-10-27')), P.periodo(7, '2026-10-27'));
assert.equal(r.total, 6);
assert.equal(r.itens, 3);
const nat = Object.fromEntries(r.naturezas.map((n) => [n.k, n]));
assert.equal(nat.CONSUMO.n, 1, 'consumo contado uma vez (sem o espelho)');
assert.equal(nat.ENTRADA.n, 1);
assert.equal(nat.ENTRADA.itens, 1);
assert.equal(nat.SAIDA.n, 0, 'natureza sem movimento aparece com zero');
assert.deepEqual(r.naturezas.map((n) => n.slot), [1, 2, 3, 4, 5, 6, 7], 'ordem fixa das cores');
assert.equal(r.serie.length, 7, 'eixo contínuo: dia sem movimento é zero, não some');
assert.equal(r.serie[0].dia, '2026-10-21');
assert.equal(r.serie[0].total, 0);
assert.equal(r.serie.find((d) => d.dia === '2026-10-26').total, 3);
assert.equal(r.picoDia.dia, '2026-10-26');
assert.equal(r.enderecos[0].chave, 'DOC-1.1.1');
assert.ok(r.enderecos.some((x) => x.chave === 'GAL-4.3.5'), 'transferência conta na origem');
assert.equal(r.itensTop[0].chave, 'MRARBS12');
assert.equal(r.itensTop.find((x) => x.chave === 'EP-00005').rotulo, 'EP-00005 — VÁLVULA SPRAY');
assert.equal(r.autores.find((x) => x.chave === P.AUTOMATICO).n, 3);
assert.equal(P.resumo([], null).serie.length, 0);

// Linha do tempo por dia.
const grupos = P.porDia(P.filtrar(ev, {}));
assert.deepEqual(grupos.map((g) => g.dia), ['2026-10-27', '2026-10-26', '2026-10-25', '2026-10-24', '2026-10-20']);

// CSV.
const csv = P.csv([porId.h, porId.b]).split('\r\n');
assert.match(csv[0], /^Data\/hora;Natureza;Movimento;Código;Item/);
assert.match(csv[1], /;Perdas;Perda de produção;MPGR-00066;;Material;-2,5;kg;/);
assert.match(csv[2], /;GAL-4\.3\.5;GAL-4\.1\.2;Diego Costa;/);

console.log('OK painel de movimentações: eventos, endereço legível, espelho FEFO, automático, filtros, eixo contínuo, rankings e CSV.');
