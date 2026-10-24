// Movimentação no WMS (tela Movimentar, 29/09). node run_movimentacao_wms_test.js
const assert = require('assert');
const M = require('./public/shared/movimentacao-wms.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const enderecos = {
  'DOC-1-1-1': {codigo: 'DOC-1.1.1', area: 'DOCA', rua: 1, predio: 1, nivel: 1},
  'FAB-1-1-1': {codigo: 'FAB-1.1.1', area: 'FÁBRICA', rua: 1, predio: 1, nivel: 1},
  'FAB-1-1-2': {codigo: 'FAB-1.1.2', area: 'FÁBRICA', rua: 1, predio: 1, nivel: 2},
  'FAB-1-2-1': {codigo: 'FAB-1.2.1', area: 'FÁBRICA', rua: 1, predio: 2, nivel: 1},
  'FAB-2-1-1': {codigo: 'FAB-2.1.1', area: 'FÁBRICA', rua: 2, predio: 1, nivel: 1},
  'GAL-1-1-1': {codigo: 'GAL-1.1.1', area: 'GALPÃO', rua: 1, predio: 1, nivel: 1},
  'FAB-9-9-9': {codigo: 'FAB-9.9.9', area: 'FÁBRICA', rua: 9, predio: 9, nivel: 9, ativo: false}
};
const lotes = {
  PA1: {
    p1: {itemCodigo: 'PA1', itemNome: 'Creme', itemTipo: 'produto', saldoLote: 295, identificadorPalete: 'PA-26246-07-P1', opLote: '26246/07', enderecoKey: 'FAB-1-1-1', status: 'LIBERADO_EXPEDICAO'},
    p2: {itemCodigo: 'PA1', itemNome: 'Creme', itemTipo: 'produto', saldoLote: 0, identificadorPalete: 'PA-OLD', enderecoKey: 'FAB-1-1-1'}
  },
  'MP-1': {
    a: {itemCodigo: 'MP-1', itemNome: 'Álcool', itemTipo: 'material', saldoLote: 180, unidade: 'kg', loteInterno: 'AK-2026-000576', loteOrigem: 'F123', enderecoKey: 'FAB-1-1-1', status: 'LIBERADO'},
    b: {itemCodigo: 'MP-1', itemNome: 'Álcool', itemTipo: 'material', saldoLote: 50, unidade: 'kg', loteInterno: 'AK-2026-000577', loteOrigem: 'F123', enderecoKey: 'GAL-1-1-1'}
  }
};

// 1. Reconhecer o código lido, do jeito que vier.
eq(M.reconhecer('FAB-1.1.1', enderecos, lotes), {tipo: 'ENDERECO', enderecoKey: 'FAB-1-1-1'});
eq(M.reconhecer(' fab 1.1.1 ', enderecos, lotes).enderecoKey, 'FAB-1-1-1', 'minúscula e espaços');
eq(M.reconhecer('*FAB-1.1.1*', enderecos, lotes).enderecoKey, 'FAB-1-1-1', 'Code39 com start/stop');
eq(M.reconhecer('FAB-1-1-1', enderecos, lotes).enderecoKey, 'FAB-1-1-1', 'pela chave');
eq(M.reconhecer('PA-26246-07-P1', enderecos, lotes), {tipo: 'LOTE', itemKey: 'PA1', loteKey: 'p1', enderecoKey: 'FAB-1-1-1'}, 'palete');
eq(M.reconhecer('ak-2026-000576', enderecos, lotes).loteKey, 'a', 'lote interno');
eq(M.reconhecer('F123', enderecos, lotes).tipo, 'VARIOS', 'lote do fornecedor repetido: pergunta qual');
eq(M.reconhecer('PA-OLD', enderecos, lotes).tipo, 'NAO_ENCONTRADO', 'lote sem saldo não é origem');
eq(M.reconhecer('', enderecos, lotes).tipo, 'VAZIO');

// 2. Conteúdo da posição (só com saldo).
const c = M.conteudo('FAB-1-1-1', lotes);
eq(c.map(x => x.loteKey), ['a', 'p1']);
eq(c.find(x => x.loteKey === 'p1').rotulo, 'PA-26246-07-P1');

// 3. Situação do destino, dita por extenso.
eq(M.situacaoDestino('FAB-1-1-2', 'FAB-1-1-1', enderecos, lotes, []).tipo, 'LIVRE');
const oc = M.situacaoDestino('GAL-1-1-1', 'FAB-1-1-1', enderecos, lotes, []);
eq(oc.tipo, 'OCUPADA'); ok(/MESMO palete de 1 lote/.test(oc.texto));
eq(M.situacaoDestino('DOC-1-1-1', 'FAB-1-1-1', enderecos, lotes, []).tipo, 'DOCA');
eq(M.situacaoDestino('FAB-9-9-9', 'FAB-1-1-1', enderecos, lotes, []).tipo, 'BLOQUEADA');
eq(M.situacaoDestino('FAB-1-1-1', 'FAB-1-1-1', enderecos, lotes, []).tipo, 'MESMA');
eq(M.situacaoDestino('GAL-1-1-1', 'X', enderecos, lotes, [{itemKey: 'MP-1', loteKey: 'b'}]).tipo, 'LIVRE', 'o próprio lote em movimento não ocupa');

// 4. Sugestões livres, perto primeiro, sem Doca, ocupadas nem bloqueadas.
eq(M.sugerirLivres('FAB-1-1-1', enderecos, lotes, 3).map(s => s.codigo), ['FAB-1.1.2', 'FAB-1.2.1', 'FAB-2.1.1']);

// 5. Plano: palete inteiro, parte, erros explícitos.
const base = {origemKey: 'FAB-1-1-1', destinoKey: 'FAB-1-1-2', lotes, enderecos, motivo: 'TRANSFERÊNCIA ENTRE ENDEREÇOS'};
let p = M.planejar(Object.assign({}, base, {selecao: {'MP-1/a': {mover: true}, 'PA1/p1': {mover: true}}}));
ok(p.ok && p.paleteInteiro, 'posição inteira');
eq(p.operacoes.map(o => o.tipo), ['MOVER_LOTE', 'MOVER_LOTE']);
eq(p.resumo, 'Mover o PALETE INTEIRO (2 lotes) de FAB-1.1.1 para FAB-1.1.2.');
p = M.planejar(Object.assign({}, base, {selecao: {'MP-1/a': {mover: true, qtd: '30,5'}}}));
ok(p.ok, 'parte de material');
eq([p.operacoes[0].tipo, p.operacoes[0].qtd], ['SEPARAR', 30.5]);
eq(p.resumo, 'Mover 30,5 de 180 kg de MP-1 (AK-2026-000576) de FAB-1.1.1 para FAB-1.1.2.');
p = M.planejar(Object.assign({}, base, {selecao: {'MP-1/a': {mover: true, qtd: '180'}}}));
eq(p.operacoes[0].tipo, 'MOVER_LOTE', 'parte = saldo inteiro vira mover o lote');
p = M.planejar(Object.assign({}, base, {selecao: {'PA1/p1': {mover: true, qtd: '100'}}}));
ok(!p.ok && /produto acabado se move inteiro/.test(p.erros[0]), 'PA não se divide');
p = M.planejar(Object.assign({}, base, {selecao: {'MP-1/a': {mover: true, qtd: '500'}}}));
ok(/maior que o saldo/.test(p.erros[0]));
p = M.planejar(Object.assign({}, base, {selecao: {'MP-1/a': {mover: true, qtd: '0'}}}));
ok(/maior que zero/.test(p.erros[0]));
p = M.planejar(Object.assign({}, base, {selecao: {}}));
ok(p.erros.includes('Marque o que vai ser movido.'));
p = M.planejar(Object.assign({}, base, {destinoKey: 'FAB-9-9-9', selecao: {'MP-1/a': {mover: true}}}));
ok(p.erros.some(x => /bloqueada/.test(x)));
p = M.planejar(Object.assign({}, base, {destinoKey: 'FAB-1-1-1', selecao: {'MP-1/a': {mover: true}}}));
ok(p.erros.some(x => /própria posição/.test(x)));
p = M.planejar(Object.assign({}, base, {motivo: '', selecao: {'MP-1/a': {mover: true}}}));
ok(p.erros.includes('Escolha o motivo.'));
p = M.planejar(Object.assign({}, base, {origemKey: 'FAB-1-1-2', selecao: {}}));
ok(p.erros.includes('Não há material com saldo nesta posição.'));

// 6. Últimas movimentações legíveis.
const movs = {'MP-1': {m1: {tipo: 'transferencia', ref: 'FAB-1-1-1 -> GAL-1-1-1', em: '2026-09-29T10:00:00Z', autor: 'Ana', qtd: 0, motivo: 'X', itemCodigo: 'MP-1'},
  m2: {tipo: 'consumo', em: '2026-09-29T11:00:00Z'}}};
eq(M.ultimas(movs, enderecos).map(m => [m.de, m.para]), [['FAB-1.1.1', 'GAL-1.1.1']]);

// 9. Busca pelo item (24/10): código, nome, lote; sem acento/caixa; várias palavras.
{
  const L = {
    'ET-00071': {r: {itemCodigo: 'ET-00071', itemNome: 'CAIXA DE EMBARQUE 48 UNID. BODY SPLASH FEBELLA', itemTipo: 'material', saldoLote: 2096, unidade: 'un', loteInterno: 'AK-2026-000650', enderecoKey: 'GAL-1-1-1', status: 'QUARENTENA', dataRecebimento: '2026-10-23'},
      z: {itemCodigo: 'ET-00071', itemNome: 'CAIXA DE EMBARQUE 48 UNID. BODY SPLASH FEBELLA', itemTipo: 'material', saldoLote: 0, enderecoKey: 'GAL-1-1-1'}},
    'MP-1': lotes['MP-1'],
    'SEM-POS': {s: {itemCodigo: 'SEM-POS', itemNome: 'Caixa sem posição', itemTipo: 'material', saldoLote: 5}}
  };
  eq(M.buscarLotes('et-00071', L, enderecos).lotes.map(l => l.loteKey), ['r'], 'por código, ignora lote zerado');
  eq(M.buscarLotes('caixa 48 FEBELLA', L, enderecos).lotes.length, 1, 'várias palavras, qualquer ordem/caixa');
  eq(M.buscarLotes('ALCOOL', L, enderecos).lotes.map(l => l.loteKey), ['a', 'b'], 'sem acento: Álcool');
  eq(M.buscarLotes('ak-2026-000650', L, enderecos).lotes[0].enderecoCodigo, 'GAL-1.1.1', 'por lote interno');
  const sp = M.buscarLotes('caixa', L, enderecos);
  eq([sp.lotes.length, sp.semPosicao], [1, 1], 'lote sem posição não é listado, mas é contado');
  eq(M.buscarLotes('   ', L, enderecos).lotes, [], 'busca vazia não lista nada');
  eq(M.buscarLotes('zzz', L, enderecos).total, 0);
}

// 10. Dividir um lote em vários paletes (24/10): 2.096 = 600 + 600 + 606 + 290.
{
  const ends = Object.assign({}, enderecos, {'GAL-1-1-2': {codigo: 'GAL-1.1.2', area: 'GALPÃO', rua: 1, predio: 1, nivel: 2}, 'GAL-1-1-3': {codigo: 'GAL-1.1.3', area: 'GALPÃO', rua: 1, predio: 1, nivel: 3},
    'GAL-1-1-4': {codigo: 'GAL-1.1.4', area: 'GALPÃO', rua: 1, predio: 1, nivel: 4}, 'GAL-1-1-5': {codigo: 'GAL-1.1.5', area: 'GALPÃO', rua: 1, predio: 1, nivel: 5}});
  const L = {'ET-1': {r: {itemCodigo: 'ET-1', itemNome: 'Caixa', itemTipo: 'material', saldoLote: 2096, unidade: 'un', loteInterno: 'AK-1', enderecoKey: 'GAL-1-1-1', status: 'QUARENTENA'}}};
  const base = {origemKey: 'GAL-1-1-1', itemKey: 'ET-1', loteKey: 'r', lotes: L, enderecos: ends, motivo: 'X'};
  const quatro = [{qtd: '600', destinoKey: 'GAL-1-1-2'}, {qtd: '600', destinoKey: 'GAL-1-1-3'}, {qtd: '606', destinoKey: 'GAL-1-1-4'}, {qtd: '290', destinoKey: 'GAL-1-1-5'}];
  let p = M.planejarDivisao(Object.assign({linhas: quatro}, base));
  ok(p.ok, 'fecha: ' + p.erros.join('|')); eq(p.operacoes.length, 4); eq([p.soma, p.falta], [2096, 0]);
  ok(/4 palete\(s\)/.test(p.resumo) && /606 → GAL-1\.1\.4/.test(p.resumo), p.resumo);
  eq(p.operacoes.every(o => o.tipo === 'SEPARAR'), true);
  p = M.planejarDivisao(Object.assign({linhas: [quatro[0], quatro[1], {qtd: '', destinoKey: ''}]}, base));
  ok(p.ok && p.falta === 896 && /896 un continuam em GAL-1\.1\.1/.test(p.resumo), 'sobra fica na origem; linha vazia é ignorada');
  p = M.planejarDivisao(Object.assign({linhas: quatro.concat([{qtd: '1', destinoKey: 'GAL-1-1-1'}])}, base));
  ok(!p.ok && p.erros.some(e => /passa do saldo|origem/.test(e)), 'não deixa passar do saldo / destino = origem');
  p = M.planejarDivisao(Object.assign({linhas: [{qtd: '700', destinoKey: 'GAL-1-1-2'}, {qtd: '700', destinoKey: 'GAL-1-1-3'}, {qtd: '700', destinoKey: 'GAL-1-1-4'}]}, base));
  ok(!p.ok && p.erros.some(e => /passa do saldo/.test(e)), '2.100 > 2.096');
  p = M.planejarDivisao(Object.assign({linhas: [{qtd: '10', destinoKey: 'GAL-1-1-2'}, {qtd: '10', destinoKey: 'GAL-1-1-2'}]}, base));
  ok(!p.ok && p.erros.some(e => /já foi usada/.test(e)), 'mesma posição duas vezes');
  p = M.planejarDivisao(Object.assign({linhas: [{qtd: '10.5', destinoKey: 'GAL-1-1-2'}]}, base));
  ok(!p.ok && p.erros.some(e => /inteiro/.test(e)), 'unidade inteira');
  p = M.planejarDivisao(Object.assign({linhas: [{qtd: '10', destinoKey: ''}]}, base));
  ok(!p.ok && p.erros.some(e => /posição de destino/.test(e)), 'falta destino');
  p = M.planejarDivisao(Object.assign({linhas: [{qtd: '10', destinoKey: 'FAB-9-9-9'}]}, base));
  ok(!p.ok, 'posição bloqueada');
  p = M.planejarDivisao(Object.assign({linhas: [{qtd: '10', destinoKey: 'DOC-1-1-1'}, {qtd: '10', destinoKey: 'DOC-1-1-1'}]}, base));
  ok(p.ok, 'Doca aceita vários paletes');
  p = M.planejarDivisao(Object.assign({linhas: []}, base));
  ok(!p.ok, 'sem paletes');
  p = M.planejarDivisao(Object.assign({}, base, {linhas: quatro, motivo: ''}));
  ok(!p.ok && p.erros.some(e => /motivo/.test(e)));
  p = M.planejarDivisao(Object.assign({}, base, {linhas: quatro, itemKey: 'PA1', loteKey: 'p1', lotes}));
  ok(!p.ok, 'lote que não está na origem');
  p = M.planejarDivisao({origemKey: 'FAB-1-1-1', itemKey: 'PA1', loteKey: 'p1', lotes, enderecos, motivo: 'X', linhas: [{qtd: '5', destinoKey: 'FAB-1-1-2'}]});
  ok(!p.ok && p.erros.some(e => /produto acabado/.test(e)), 'produto acabado não divide');
}

// 11. Material com saldo e sem nenhum lote (ET-00069): aparece como "sem posição".
{
  const L = {'ET-1': {r: {itemCodigo: 'ET-1', itemNome: 'Caixa A', itemTipo: 'material', saldoLote: 100, enderecoKey: 'GAL-1-1-1'}}};
  const E = {'ET-1': {materialCodigo: 'ET-1', materialNome: 'Caixa A', saldoAtual: 100, unidade: 'un'},
    'ET-69': {materialCodigo: 'ET-69', materialNome: 'CAIXA BODY SPLASH ARABE', saldoAtual: 1605, unidade: 'un'},
    'ET-70': {materialCodigo: 'ET-70', materialNome: 'CAIXA ZERADA', saldoAtual: 0, unidade: 'un'},
    'ET-71': {materialCodigo: 'ET-71', materialNome: 'CAIXA PARCIAL', saldoAtual: 500, unidade: 'un'}};
  L['ET-71'] = {x: {itemCodigo: 'ET-71', itemTipo: 'material', saldoLote: 200, enderecoKey: 'GAL-1-1-1'}};
  const r = M.buscarLotes('caixa', L, enderecos, 30, E);
  eq(r.semLote.map(x => [x.itemCodigo, x.semEndereco]), [['ET-69', 1605], ['ET-71', 300]], 'sem lote e parcial; zerado e totalmente endereçado ficam de fora');
  eq(M.buscarLotes('arabe', L, enderecos, 30, E).semLote.length, 1, 'busca pelo nome');
  eq(M.buscarLotes('caixa', L, enderecos, 30).semLote, [], 'sem o agregado, não lista');
  eq(M.buscarLotes('', L, enderecos, 30, E).semLote, []);
}
console.log('run_movimentacao_wms_test: ' + n + ' verificações OK');
