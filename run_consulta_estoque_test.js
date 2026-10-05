'use strict';
/* Consulta de Estoque: linhas, busca, filtros com contagem, e o casamento
   bulk x embalagem (gargalo, dono do estoque, empenho próprio x de outras OPs). */
const assert = require('node:assert/strict');
const CE = require('./public/shared/consulta-estoque.js');

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

const rows = CE.linhas({estoque, materiais, lotes, hoje: HOJE, incluirCatalogo: true});
const por = (c) => rows.find((r) => r.codigo === c);

// ── linhas ──
assert.equal(por('EP-1').grupo, 'EP');
assert.equal(por('EP-1').disponivel, 5000, 'disponível = atual − empenhado');
assert.deepEqual(por('EP-1').tags, ['empenhado']);
assert.equal(por('ES-1').disponivel, -700);
assert.ok(por('ES-1').tags.includes('falta'), 'empenho maior que o saldo');
assert.equal(por('ES-1').nivel, 'critico');
assert.ok(por('ET-1').tags.includes('negativo'));
assert.ok(por('MPGR-1').tags.includes('vencido') && por('MPGR-1').tags.includes('quarentena'), por('MPGR-1').tags.join());
assert.equal(por('MPGR-1').vencido, 30);
assert.equal(por('MPGR-1').quarentena, 20);
assert.equal(por('MPGR-1').proxDias, -2, 'próxima validade é a mais urgente');
assert.deepEqual(por('MPGR-1').lotes.map((l) => l.lote), ['AK-2026-000002', 'AK-2026-000001', 'AK-2026-000003'], 'lotes por validade (FEFO)');
assert.deepEqual(por('MPGR-1').enderecos, ['DOC-1.1.1', 'GAL-1.1.1', 'GAL-1.1.2']);
assert.equal(por('MPGR-9').semRegistro, true, 'catálogo sem saldo entra marcado');
assert.equal(por('SKU-PA').grupo, 'PA');
assert.equal(por('SKU-PA').atual, 4949);
assert.equal(por('SKU-PA').quarentena, 100);
assert.equal(por('SKU-PA').liberado, 4849);
assert.equal(por('SKU-PA').nome, 'BODY SPLASH ZAHRA 120ml');
assert.equal(por('EP-2').geral, 0, 'tudo é da cliente: geral = total − clientes');
assert.equal(por('EP-2').contado, true, 'ajuste manual = contado no Dia D');
assert.equal(por('EP-1').contado, false);
assert.equal(por('EP-2').semEndereco, 3000, 'saldo agregado sem nenhum lote endereçado');

// ── busca, filtros, contagens ──
const f = (o) => CE.filtrar(rows, o).map((r) => r.codigo).sort();
assert.deepEqual(f({busca: 'valvula 24'}), ['EP-2'], 'palavras em qualquer ordem, sem acento');
assert.deepEqual(f({busca: 'rotulo'}), ['ES-1'], 'acento ignorado');
assert.deepEqual(f({busca: 'ak-2026-000003'}), ['MPGR-1'], 'acha pelo lote');
assert.deepEqual(f({busca: 'doc-1.1.1'}), ['MPGR-1', 'SKU-PA'], 'acha pelo endereço');
assert.deepEqual(f({busca: 'miss'}), ['EP-2'], 'acha pelo cliente dono');
assert.ok(!f({}).includes('MPGR-9'), 'sem busca nem filtro, catálogo sem registro não polui');
assert.deepEqual(f({busca: 'glicerina'}), ['MPGR-9'], 'mas a busca acha e diz que não há saldo');
assert.deepEqual(f({grupo: 'EP'}), ['EP-1', 'EP-2']);
assert.deepEqual(f({tag: 'negativo'}), ['ET-1']);
assert.deepEqual(f({tag: 'naoContado'}), ['EP-1', 'ES-1', 'ET-1', 'MPGR-1']);
assert.deepEqual(f({tag: 'contado'}), ['EP-2']);
assert.deepEqual(f({cliente: 'MISS'}), ['EP-2']);
assert.deepEqual(f({cliente: '__KURYOS'}), ['EP-1', 'ES-1'].filter((c) => por(c).geral > 0).sort());
assert.deepEqual(f({cliente: 'BRIA BEAUTY'}), ['SKU-PA']);
const c = CE.contagens(rows, {grupo: 'EP'});
assert.equal(c.tag.empenhado, 1, 'contagem de situação respeita o filtro de tipo');
assert.equal(c.grupo.ES, 1, 'contagem de tipo ignora o próprio filtro de tipo');
assert.equal(c.grupo.EP, 2);
assert.equal(CE.contagens(rows, {busca: 'zzzz'}).total, 0);
const k = CE.kpis(rows);
assert.deepEqual([k.negativos, k.faltando, k.vencidos, k.quarentena], [1, 1, 1, 2]);

// ── ordenação ──
assert.deepEqual(CE.ordenar(rows.filter((r) => !r.semRegistro), 'gravidade').slice(0, 3).map((r) => r.nivel), ['critico', 'critico', 'critico']);
assert.equal(CE.ordenar(rows, 'atual', true)[0].codigo, 'EP-1');
assert.equal(CE.ordenar(rows.filter((r) => r.proxDias != null), 'validade')[0].codigo, 'MPGR-1');

// ── casamento bulk x embalagem ──
const embs = [{codigo: 'EP-1', nome: 'FRASCO PET 120ML', porPeca: 1}, {codigo: 'EP-2', nome: 'VALVULA SPRAY 24/410', porPeca: 1}, {codigo: 'ES-1', nome: 'RÓTULO', porPeca: 1}, {codigo: 'ET-1', nome: 'CAIXA', porPeca: 0.0625}];
// 100 kg a 100 g/peça = 1000 peças
let m = CE.casar({bulkKg: 100, pesoG: 100, restante: 1000, embalagens: embs, estoque, materiais, clienteKey: 'MISS', opKey: 'OP-NOVA'});
assert.equal(m.pecasPeloBulk, 1000);
assert.equal(m.pode, 0, 'rótulo tem 100 e 800 empenhados a outras OPs: nada utilizável');
assert.equal(m.estado, 'bloqueado');
assert.equal(m.gargalo.codigo, 'ES-1');
assert.equal(m.gargalo.falta, 1000);
assert.equal(m.itens.find((i) => i.codigo === 'ET-1').bloqueia, false, 'caixa de embarque não trava o envase');
// Para OUTRO cliente a válvula (toda da MISS) não existe.
m = CE.casar({bulkKg: 100, pesoG: 100, restante: 1000, embalagens: [embs[1]], estoque, materiais, clienteKey: 'OUTRO', opKey: 'OP-NOVA'});
assert.equal(m.pode, 0);
assert.equal(m.itens[0].deOutroCliente, 3000);
assert.equal(m.gargalo.codigo, 'EP-2');
// Para a MISS a mesma válvula basta.
m = CE.casar({bulkKg: 100, pesoG: 100, restante: 1000, embalagens: [embs[1]], estoque, materiais, clienteKey: 'MISS', opKey: 'OP-NOVA'});
assert.equal(m.pode, 1000);
assert.equal(m.estado, 'pronto');
assert.equal(m.gargalo, null);
// O empenho da PRÓPRIA OP conta a favor dela: frasco 6000, 1000 reservados para OP-A.
m = CE.casar({bulkKg: 600, pesoG: 100, restante: 6000, embalagens: [embs[0]], estoque, materiais, clienteKey: 'X', opKey: 'OP-A'});
assert.equal(m.pode, 6000, 'a própria OP pode usar o que ela mesma empenhou');
m = CE.casar({bulkKg: 600, pesoG: 100, restante: 6000, embalagens: [embs[0]], estoque, materiais, clienteKey: 'X', opKey: 'OP-B'});
assert.equal(m.pode, 5000, 'outra OP não conta o reservado para a OP-A');
assert.equal(m.estado, 'parcial');
assert.equal(m.gargalo.falta, 1000);
// Bulk menor que a meta: o bulk limita.
m = CE.casar({bulkKg: 30, pesoG: 100, restante: 6000, embalagens: [embs[0]], estoque, materiais, clienteKey: 'X', opKey: 'OP-A'});
assert.equal(m.pode, 300);
// Sem peso: não inventa.
m = CE.casar({bulkKg: 30, pesoG: 0, restante: 100, embalagens: [embs[0]], estoque, materiais, clienteKey: 'X', opKey: 'OP-A'});
assert.equal(m.estado, 'sem_peso');
// Saldo negativo nunca vira embalagem.
m = CE.casar({bulkKg: 10, pesoG: 100, restante: 100, embalagens: [{codigo: 'ET-1', nome: 'x', porPeca: 1}].map((e) => Object.assign({}, e, {codigo: 'ET-1'})), estoque, materiais, clienteKey: 'X', opKey: 'OP-A'});
assert.equal(m.itens[0].usavel, 0);

// ── material sem controle de estoque (água): sem saldo/falta, e nunca trava o envase ──
const mat2 = Object.assign({}, materiais, {'MPGR-AGUA': {tipo: 'EP', mpNome: 'ÁGUA', controlaEstoque: false, unidade: 'un'}});
const est2 = Object.assign({}, estoque, {'MPGR-AGUA': {materialCodigo: 'MPGR-AGUA', saldoAtual: -900, saldoEmpenhado: 500, unidade: 'un'}});
const r2 = CE.linhas({estoque: est2, materiais: mat2, lotes, hoje: HOJE}).find((r) => r.codigo === 'MPGR-AGUA');
assert.deepEqual(r2.tags, ['semControle']);
assert.equal(r2.nivel, 'ok');
m = CE.casar({bulkKg: 100, pesoG: 100, restante: 1000, embalagens: [{codigo: 'MPGR-AGUA', nome: 'ÁGUA', porPeca: 1}, embs[1]], estoque: est2, materiais: mat2, clienteKey: 'MISS', opKey: 'OP-NOVA'});
assert.equal(m.pode, 1000, 'item sem controle de estoque não limita');
assert.equal(m.estado, 'pronto');

// ── peso da peça ──
assert.deepEqual(CE.pesoDaPeca({pesoTeoricoUnG: 107.2}, {}, 0), {g: 107.2, fonte: 'OP'});
assert.deepEqual(CE.pesoDaPeca({}, {volume: 200, unidadeVolume: 'g'}, 0), {g: 200, fonte: 'cadastro'});
assert.deepEqual(CE.pesoDaPeca({}, {volume: 120, unidadeVolume: 'ml', densidadeGranel: 0.9}, 0), {g: 108, fonte: 'cadastro'});
assert.equal(CE.pesoDaPeca({}, {volume: 120, unidadeVolume: 'ml', densidadeGranel: -1}, 0).fonte, 'sem peso', 'densidade -1 é "não cadastrada"');
assert.equal(CE.pesoDaPeca({qtdPlanejada: 1000}, {}, 100).fonte, 'estimado');

// ── intermediários: OPs com bulk e o que a produção reteve ──
const ops = {
  'OP-X': {lote: 'X/01', sku: 'SKU-X', produto: 'BODY SPLASH X', cliente: 'MISS ROSE', status: 'Programado', qtdPlanejada: 1000, pesoTeoricoUnG: 100,
    manipulacao: {status: 'LIBERADO', manipulacao: {rendimento: 100}},
    materiaisConsumo: {a: {origem: 'bom', mpCodigo: 'EP-1', mpNome: 'FRASCO PET 120ML', quantidade: 1000}, b: {origem: 'bom', mpCodigo: 'EP-2', mpNome: 'VALVULA', quantidade: 1000}, c: {origem: 'mp', mpCodigo: 'MPGR-1', quantidade: 5}}},
  'OP-Y': {lote: 'Y/01', sku: 'SKU-X', produto: 'BODY SPLASH X', cliente: 'MISS ROSE', status: 'Produção Parcial', qtdPlanejada: 1000, pesoTeoricoUnG: 100, produzidoLinha: 400,
    manipulacao: {status: 'LIBERADO', manipulacao: {rendimento: 100}}},
  'OP-Z': {lote: 'Z/01', sku: 'SKU-X', status: 'Concluído', manipulacao: {status: 'LIBERADO', manipulacao: {rendimento: 100}}},
  'OP-W': {lote: 'W/01', sku: 'SKU-X', status: 'Programado'}
};
const produtos = {'SKU-X': {sku: 'SKU-X', clienteKey: 'MISS', descricao: 'X', volume: 120, unidadeVolume: 'ml'}};
const bom = {'SKU-X__v1': {codProduto: 'SKU-X', versao: 'v1', status: 'APROVADA', itens: {i1: {materialCodigo: 'EP-1', materialNome: 'FRASCO PET 120ML', qtdPorPeca: 1}, i2: {materialCodigo: 'ES-1', materialNome: 'RÓTULO', qtdPorPeca: 1}}}};
const materialProcesso = {
  r1: {opKey: 'OP-Y', tipo: 'BULK', qtd: 20, unidade: 'kg', status: 'EM_PROCESSO', lote: 'Y/01', donoNome: 'MISS ROSE', sku: 'SKU-X', produto: 'BODY SPLASH X', declaradoEm: '2026-10-01T10:00:00Z'},
  r2: {opKey: 'OP-Y', tipo: 'FRASCO_ROTULADO', qtd: 300, unidade: 'un', status: 'EM_PROCESSO', lote: 'Y/01', sku: 'SKU-X', declaradoEm: '2026-10-01T11:00:00Z'},
  r3: {opKey: 'OP-Y', tipo: 'BULK', qtd: 99, unidade: 'kg', status: 'USADO'}
};
const bombonas = {'BB-1': {codigo: 'BB-1', conteudo: {opKey: 'OP-X', kg: 60}}};
const I = CE.intermediarios({ops, estoque, materiais, bom, produtos, materialProcesso, bombonas});
assert.deepEqual(I.aguardando.map((a) => a.opKey).sort(), ['OP-X', 'OP-Y'], 'concluída e sem manipulação ficam de fora');
const x = I.aguardando.find((a) => a.opKey === 'OP-X'), y = I.aguardando.find((a) => a.opKey === 'OP-Y');
assert.equal(x.bulkKg, 100);
assert.equal(x.casamento.itens.length, 2, 'usa a BOM congelada na OP (só origem bom)');
assert.equal(x.casamento.itens[0].falta, 0, 'a OP-X é dona do próprio empenho do frasco');
assert.equal(x.casamento.pode, 1000);
assert.equal(x.casamento.estado, 'pronto');
assert.deepEqual(x.bombonas.map((b) => b.codigo), ['BB-1']);
assert.equal(y.bulkKg, 60, 'tira o que já foi envasado: 100 − 400×100g');
assert.equal(y.restante, 600);
assert.equal(y.casamento.pecasPeloBulk, 600);
assert.equal(y.casamento.itens.length, 2, 'sem BOM na OP, cai na BOM vigente do produto');
assert.equal(y.casamento.estado, 'bloqueado', 'rótulo sem saldo utilizável');
assert.equal(y.casamento.gargalo.codigo, 'ES-1');
assert.equal(I.retidos.length, 2, 'só o que está EM_PROCESSO');
const rb = I.retidos.find((r) => r.tipo === 'BULK'), rf = I.retidos.find((r) => r.tipo === 'FRASCO_ROTULADO');
assert.equal(rb.casamento.pecasPeloBulk, 200, '20 kg ÷ 100 g');
assert.equal(rf.casamento.itens.every((i) => !/FRASCO|ROTULO/i.test(CE.norm(i.nome).toUpperCase())), true, 'frasco rotulado já tem frasco e rótulo: só falta o resto');
assert.equal(I.totais.retidoBulkKg, 20);
assert.equal(I.totais.retidoFrascos, 300);
assert.equal(I.totais.ops, 2);

// ── estoque de intermediários por produto (05/10) ──
const ops2 = {
  'OP-B1': {lote: 'B/01', sku: 'SKU-X', produto: 'BODY X', cliente: 'MISS ROSE', status: 'Programado', pesoTeoricoUnG: 100, qtdPlanejada: 1000, manipulacao: {status: 'LIBERADO', manipulacao: {rendimento: 100}}},
  'OP-B2': {lote: 'B/02', sku: 'SKU-X', produto: 'BODY X', cliente: 'MISS ROSE', status: 'Programado', pesoTeoricoUnG: 100, qtdPlanejada: 500, manipulacao: {status: 'AGUARDANDO_QUALIDADE', manipulacao: {rendimento: 40}}},
  // rotulagem 1000, envasou 300, 20 de frasco perdido no envase -> 680 rotulados em estoque; OP ainda aberta
  'OP-R1': {lote: 'R/01', sku: 'SKU-Y', produto: 'BODY Y', cliente: 'WIKE', status: 'Em Produção', produzidoRotulagem: 1000, produzidoLinha: 300, abertaDesde: 'x', abertaDesdeRot: 'y'},
  // OP concluída com sobra de frasco rotulado declarada (70) e bulk retido 15 kg: vale o declarado, não o saldo calculado
  'OP-C1': {lote: 'C/01', sku: 'SKU-Z', produto: 'BODY Z', cliente: 'WIKE', status: 'Concluído', produzidoRotulagem: 500, produzidoLinha: 430, contagemSobras: {a: {em: 'x'}}, manipulacao: {status: 'LIBERADO', manipulacao: {rendimento: 90}}, pesoTeoricoUnG: 100},
  'OP-X9': {lote: 'X/09', sku: 'SKU-X', status: 'Cancelado', manipulacao: {status: 'LIBERADO', manipulacao: {rendimento: 999}}}
};
const mp2 = {
  r1: {opKey: 'OP-C1', tipo: 'FRASCO_ROTULADO', qtd: 70, unidade: 'un', status: 'EM_PROCESSO'},
  r2: {opKey: 'OP-C1', tipo: 'BULK', qtd: 15, unidade: 'kg', status: 'EM_PROCESSO'},
  r3: {opKey: 'OP-C1', tipo: 'BULK', qtd: 99, unidade: 'kg', status: 'USADO'}
};
const perdas2 = {'OP-R1': {p1: {perdas: [{tipo: 'Frascos', quantidade: 20, etapa: 'envase'}]}}};
let EI = CE.estoqueIntermediario({ops: ops2, produtos: {}, materialProcesso: mp2, perdas: perdas2, validacoes: {}});
const sk = (s) => EI.linhas.find((l) => l.sku === s);
assert.equal(sk('SKU-X').bulkLiberadoKg, 100, 'bulk liberado da OP B/01');
assert.equal(sk('SKU-X').bulkAguardandoKg, 40, 'bulk ainda sem liberação da Qualidade');
assert.equal(sk('SKU-X').ops.length, 2, 'OP cancelada fora');
assert.equal(sk('SKU-Y').frascosAguardando, 680, '1000 − 300 envasados − 20 perdidos; sem validação = aguardando a Qualidade');
assert.equal(sk('SKU-Z').frascosAguardando, 70, 'OP concluída: vale a sobra declarada');
assert.equal(sk('SKU-Z').bulkLiberadoKg, 15, 'bulk retido declarado (o USADO não conta)');
assert.equal(EI.totais.frascosLiberados, 0);
// Qualidade libera os frascos da R/01 e reprova os da C/01
EI = CE.estoqueIntermediario({ops: ops2, produtos: {}, materialProcesso: mp2, perdas: perdas2, validacoes: {'OP-R1': {status: 'LIBERADO'}, 'OP-C1': {status: 'REPROVADO'}}});
assert.equal(sk('SKU-Y').frascosLiberados, 680);
assert.equal(sk('SKU-Y').frascosAguardando, 0);
assert.equal(sk('SKU-Z').frascosReprovados, 70);
assert.equal(sk('SKU-Z').frascosAguardando, 0, 'reprovado não vira disponível');
assert.equal(EI.totais.frascosLiberados, 680);

// ── datas puras: 'YYYY-MM-DD' não pode andar um dia por causa do fuso ──
assert.equal(CE.diasAte('2026-10-02', HOJE), 1);
assert.equal(CE.diasAte('2026-09-30', HOJE), -1);
assert.equal(CE.diasAte('', HOJE), null);

console.log('OK Consulta de Estoque: linhas, busca, filtros, casamento bulk x embalagem e retidos.');
