'use strict';
/* Relatório de Estoque em PDF: totais por unidade (nunca misturados), agrupamento por tipo,
   filtros declarados no cabeçalho, escape de HTML e logotipo. Função pura, sem navegador. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const CE = require('./public/shared/consulta-estoque.js');
const PDF = require('./public/shared/consulta-estoque-pdf.js');

const HOJE = new Date(2026, 9, 1, 10, 0, 0);
const ymd = (dias) => { const d = new Date(2026, 9, 1 + dias, 12); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

const materiais = {
  'EP-1': {tipo: 'EP', mpNome: 'FRASCO PET 120ML', unidade: 'un'},
  'EP-2': {tipo: 'EP', mpNome: 'VALVULA SPRAY 24/410', unidade: 'un'},
  'ES-1': {tipo: 'ES', mpNome: 'RÓTULO BODY SPLASH', unidade: 'un'},
  'ET-1': {tipo: 'ET', mpNome: 'CAIXA DE EMBARQUE', unidade: 'un'},
  'MPGR-1': {tipo: 'MPGR', mpNome: 'ÁLCOOL CEREAL', unidade: 'kg'},
  'MPGR-9': {tipo: 'MPGR', mpNome: 'GLICERINA SEM MOVIMENTO', unidade: 'kg'}
};
const estoque = {
  'EP-1': {materialCodigo: 'EP-1', materialNome: 'FRASCO PET 120ML', saldoAtual: 6000, saldoEmpenhado: 1000, unidade: 'un',
    empenhos: {'OP-A': {lote: 'A/01', qtdEmpenhada: 1000, sku: 'SKU-A'}}, ultimaAtualizacao: '2026-10-01T09:00:00Z'},
  'EP-2': {materialCodigo: 'EP-2', saldoAtual: 3000, saldoEmpenhado: 0, unidade: 'un', porCliente: {MISS: {clienteNome: 'MISS ROSE', saldoAtual: 3000}},
    ajustes: {a1: {ajustadoEm: '2026-10-01T08:00:00Z'}}},
  'ES-1': {materialCodigo: 'ES-1', saldoAtual: 100, saldoEmpenhado: 800, unidade: 'un'},
  'ET-1': {materialCodigo: 'ET-1', saldoAtual: -50, saldoEmpenhado: 0, unidade: 'un'},
  'MPGR-1': {materialCodigo: 'MPGR-1', saldoAtual: 0, saldoEmpenhado: 0, unidade: 'kg'}
};
const lotes = {
  'MPGR-1': {l1: {itemTipo: 'material', saldoLote: 40, status: 'LIBERADO', dataValidade: ymd(10), loteInterno: 'AK-2026-000001', enderecoCodigo: 'GAL-1.1.1'},
    l2: {itemTipo: 'material', saldoLote: 30, status: 'LIBERADO', dataValidade: ymd(-2), loteInterno: 'AK-2026-000002', enderecoCodigo: 'GAL-1.1.2'},
    l3: {itemTipo: 'material', saldoLote: 20, status: 'QUARENTENA', dataValidade: ymd(400), loteInterno: 'AK-2026-000003', enderecoCodigo: 'DOC-1.1.1'}},
  'SKU-PA': {p1: {itemTipo: 'produto', itemCodigo: 'SKU-PA', itemNome: 'BODY SPLASH ZAHRA 120ml', cliente: 'BRIA BEAUTY', saldoLote: 4849, status: 'LIBERADO_EXPEDICAO', enderecoCodigo: 'DOC-1.1.1', identificadorPalete: 'PA-1'},
    p2: {itemTipo: 'produto', itemCodigo: 'SKU-PA', itemNome: 'BODY SPLASH ZAHRA 120ml', cliente: 'BRIA BEAUTY', saldoLote: 100, status: 'QUARENTENA', enderecoCodigo: 'DOC-1.1.2', identificadorPalete: 'PA-2'}}
};


const rows = CE.linhas({estoque, materiais, lotes, hoje: HOJE, incluirCatalogo: true}).filter((r) => !r.semRegistro);

// totais por unidade: kg e un nunca se misturam
const tot = PDF.totaisPorUnidade(rows);
const un = tot.find((t) => t.unidade === 'un'), kg = tot.find((t) => t.unidade === 'kg');
assert.ok(un && kg, 'uma linha por unidade: ' + tot.map((t) => t.unidade).join());
assert.equal(kg.saldo, rows.filter((r) => r.unidade === 'kg').reduce((s, r) => s + r.atual, 0));
assert.equal(un.itens + kg.itens, rows.length);
assert.equal(un.saldo, rows.filter((r) => r.unidade === 'un').reduce((s, r) => s + r.atual, 0));

// agrupamento na ordem canônica dos tipos
const gr = PDF.agrupar(rows).map((g) => g.grupo);
assert.deepEqual(gr, CE.ORDEM_GRUPOS.filter((g) => gr.includes(g)));

const logo = fs.readFileSync('./public/kuryos-logo.svg', 'utf8').replace(/<\?xml[^>]*\?>/, '').trim();
const html = PDF.documento({rows, kpis: CE.kpis(rows), filtros: [['Busca', '“valvula”'], ['Tipo', ''], ['Cliente', 'MISS ROSE']], ordem: 'Nome (A–Z)',
  emitidoEm: new Date(2026, 9, 21, 14, 5), emitidoPor: 'Gustavo <script>', logoSvg: logo});
assert.match(html, /^<!DOCTYPE html>/);
assert.match(html, /Relatório de Estoque/);
assert.match(html, /21\/10\/2026 às 14:05/);
assert.ok(html.includes('<svg') && html.includes('#0a1c69'), 'logotipo embutido');
assert.ok(html.includes('<b>Busca:</b> “valvula”') && html.includes('<b>Cliente:</b> MISS ROSE'), 'filtros declarados');
assert.ok(!html.includes('<b>Tipo:</b>'), 'filtro vazio não aparece');
assert.ok(html.includes('Gustavo &lt;script&gt;') && !html.includes('Gustavo <script>'), 'autor escapado');
assert.ok(html.includes('FRASCO PET 120ML') && html.includes('ÁLCOOL CEREAL'));
assert.match(html, /Totais gerais por unidade/);
assert.match(html, /@page\{size:A4 landscape/);
// negativo sai em vermelho, e o disponível negativo do ES-1 também
assert.ok(/class="n neg">-50</.test(html), 'saldo negativo destacado');
assert.ok(/class="n neg">-700</.test(html), 'disponível negativo destacado');

// sem logotipo: cai para o texto, sem quebrar
assert.ok(PDF.documento({rows, kpis: CE.kpis(rows)}).includes('>KURYOS<'));
// lista vazia
const vazio = PDF.documento({rows: [], kpis: {}, filtros: [['Busca', 'xyz']]});
assert.match(vazio, /Nenhum item nos filtros selecionados/);
assert.ok(!vazio.includes('Totais gerais'));
console.log('OK Relatorio de Estoque PDF: totais por unidade, grupos, filtros declarados, escape, logotipo e lista vazia.');
