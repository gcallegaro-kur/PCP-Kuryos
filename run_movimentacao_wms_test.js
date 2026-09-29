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

console.log('run_movimentacao_wms_test: ' + n + ' verificações OK');
