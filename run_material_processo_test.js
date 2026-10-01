/* Material em processo: bombonas, contagem de sobras no fim da OP, devolução à fila
   (pedido do usuário, 01/10). */
const assert = require('assert');
const M = require('./public/shared/material-processo.js');

const AGORA = '2026-10-01T15:00:00.000Z';

// ── Códigos e cadastro de recipientes ──────────────────────────────────
assert.strictEqual(M.codigoRecipiente('BOMBONA', 1), 'BB-0001');
assert.strictEqual(M.codigoRecipiente('TANQUE', 12), 'TQ-0012');
assert.throws(() => M.codigoRecipiente('BALDE', 1), /inválido/);
let v = M.validarNovos({tipo: 'BOMBONA', quantidade: 5, capacidadeKg: 200});
assert.deepStrictEqual([v.ok, v.quantidade, v.capacidadeKg], [true, 5, 200]);
assert.strictEqual(M.validarNovos({tipo: 'BOMBONA', quantidade: 5, capacidadeKg: ''}).capacidadeKg, null, 'capacidade é opcional');
assert.strictEqual(M.validarNovos({tipo: 'BOMBONA', quantidade: 0}).ok, false);
assert.strictEqual(M.validarNovos({tipo: 'BOMBONA', quantidade: 101}).ok, false);
assert.strictEqual(M.validarNovos({tipo: 'X', quantidade: 2}).ok, false);
assert.strictEqual(M.validarNovos({tipo: 'TANQUE', quantidade: 1, capacidadeKg: -5}).ok, false);

const vazia = M.novoRecipiente('BB-0001', 'BOMBONA', 200, 'Ana', AGORA);
assert.strictEqual(M.situacao(vazia), 'VAZIA');
assert.strictEqual(M.kgAtual(vazia), 0);

// ── Encher: bulk de uma OP, com lote, validade e dono ───────────────────
const op = {lote: '26267/04', produto: 'BODY SPLASH IDOLA 120ML', sku: 'WKBS0006', cliente: 'WIKE MAKE', validade: '2029-09-24T19:54:38Z'};
const cont = (extra) => Object.assign({opKey: '26267-04', lote: op.lote, sku: op.sku, produto: op.produto, cliente: op.cliente, kg: 150,
  validade: op.validade, fabricadoEm: '2026-10-01T12:06:00Z', ...M.dono('CLIENTE', op)}, extra || {});
assert.deepStrictEqual(M.dono('KURYOS', op), {donoTipo: 'KURYOS', donoNome: 'KURYOS'});
assert.deepStrictEqual(M.dono('CLIENTE', op), {donoTipo: 'CLIENTE', donoNome: 'WIKE MAKE'});
let r = M.encher(vazia, cont(), 'Ana', AGORA);
assert.strictEqual(M.situacao(r.rec), 'CHEIA');
assert.strictEqual(r.rec.conteudo.kg, 150);
assert.strictEqual(r.rec.conteudo.lote, '26267/04');
assert.strictEqual(r.rec.conteudo.validade, op.validade);
assert.strictEqual(r.rec.conteudo.donoNome, 'WIKE MAKE');
assert.strictEqual(r.evento.tipo, 'ENCHER');
assert.deepStrictEqual([r.evento.kgAntes, r.evento.kgDepois], [0, 150]);
assert.strictEqual(vazia.conteudo, null, 'a função não muta o original');

// Complemento do MESMO lote soma; mantém validade e fabricação do primeiro.
let c2 = M.encher(r.rec, cont({kg: 30, validade: '2030-01-01', fabricadoEm: '2026-10-02T00:00:00Z'}), 'Ana', AGORA);
assert.strictEqual(c2.rec.conteudo.kg, 180);
assert.strictEqual(c2.rec.conteudo.validade, op.validade);
assert.strictEqual(c2.rec.conteudo.fabricadoEm, '2026-10-01T12:06:00Z');
assert.strictEqual(M.encher(M.encher(vazia, cont({local: 'Sala 1'}), 'Ana', AGORA).rec, cont({kg: 10, local: ''}), 'Ana', AGORA).rec.conteudo.local, 'Sala 1', 'complemento sem local não apaga o local');
assert.strictEqual(M.encher(M.encher(vazia, cont({local: 'Sala 1'}), 'Ana', AGORA).rec, cont({kg: 10, local: 'Galpão'}), 'Ana', AGORA).rec.conteudo.local, 'Galpão', 'local novo substitui');
// Outro lote na mesma bombona: não mistura.
let p = M.podeEncher(r.rec, cont({lote: '26271/01'}));
assert.strictEqual(p.ok, false);
assert.match(p.erros[0], /já tem bulk do lote 26267\/04/);
// Dono diferente no mesmo lote: recusa.
assert.strictEqual(M.podeEncher(r.rec, cont({...M.dono('KURYOS', op)})).ok, false);
// Capacidade: 150 + 60 > 200.
p = M.podeEncher(r.rec, cont({kg: 60}));
assert.strictEqual(p.ok, false);
assert.match(p.erros[0], /capacidade de BB-0001 \(200 kg\)/);
assert.match(p.erros[0], /cabem mais 50 kg/);
assert.strictEqual(M.podeEncher(r.rec, cont({kg: 50})).ok, true, 'exatamente a capacidade cabe');
// Sem kg / sem lote.
assert.strictEqual(M.podeEncher(vazia, cont({kg: 0})).ok, false);
assert.strictEqual(M.podeEncher(vazia, cont({lote: ''})).ok, false);
// Sem capacidade cadastrada: sem limite.
assert.strictEqual(M.podeEncher(M.novoRecipiente('TQ-0001', 'TANQUE', null, 'Ana', AGORA), cont({kg: 3000})).ok, true);
assert.throws(() => M.encher(vazia, cont({kg: -1}), 'Ana', AGORA), /kg/i);

// ── Ajuste e esvaziar ─────────────────────────────────────────────────
let a = M.ajustarKg(r.rec, 90, 'Retirado para o envase', 'Ana', AGORA);
assert.strictEqual(a.rec.conteudo.kg, 90);
assert.deepStrictEqual([a.evento.tipo, a.evento.kgAntes, a.evento.kgDepois], ['AJUSTE', 150, 90]);
a = M.ajustarKg(r.rec, 0, 'Bulk usado por inteiro', 'Ana', AGORA);
assert.strictEqual(a.rec.conteudo, null, 'zero esvazia');
assert.strictEqual(M.situacao(a.rec), 'VAZIA');
assert.strictEqual(a.evento.tipo, 'ESVAZIAR');
assert.throws(() => M.ajustarKg(r.rec, 10, '', 'Ana', AGORA), /motivo/);
assert.throws(() => M.ajustarKg(vazia, 10, 'x', 'Ana', AGORA), /vazio/i);
assert.throws(() => M.ajustarKg(r.rec, 500, 'x', 'Ana', AGORA), /capacidade/);
assert.throws(() => M.ajustarKg(r.rec, -1, 'x', 'Ana', AGORA), /inválido/i);

// ── Etiqueta ──────────────────────────────────────────────────────────
const et = M.dadosEtiqueta(r.rec);
assert.strictEqual(et.codigo, 'BB-0001');
assert.strictEqual(et.lote, '26267/04');
assert.strictEqual(et.kg, 150);
assert.strictEqual(et.donoNome, 'WIKE MAKE');
assert.strictEqual(et.vazia, false);
assert.strictEqual(M.dadosEtiqueta(vazia).vazia, true, 'etiqueta de bombona vazia sai só com o código');

// ── Contagem de sobras: o que o líder precisa contar ───────────────────
const opCompleta = {
  lote: '26267/04', produto: op.produto, sku: op.sku, cliente: op.cliente, manipulacao: {status: 'LIBERADO'},
  materiaisConsumo: {
    b_1: {mpCodigo: 'EP-00002', mpNome: 'VALVULA SPRAY', origem: 'bom', unidade: 'un', quantidade: 5000},
    b_2: {mpCodigo: 'EP-00095', mpNome: 'FRASCO 120ML', origem: 'bom', unidade: 'un', quantidade: 5000},
    b_3: {mpCodigo: 'ES-00151', mpNome: 'ROTULO IDOLA', origem: 'bom', unidade: 'un', quantidade: 5000},
    b_4: {mpCodigo: 'ET-00049', mpNome: 'CAIXA DE EMBARQUE', origem: 'bom', unidade: 'un', quantidade: 105},
    f_1: {mpCodigo: 'MPGR-00132', mpNome: 'AGUA', origem: 'formula', unidade: 'kg', quantidade: 201}
  }
};
let l = M.linhasContagem(opCompleta, 'linha');
assert.deepStrictEqual(l.map((x) => x.chave), ['mat:EP-00002', 'mat:EP-00095', 'mat:ES-00151', 'mat:ET-00049', 'frascos_rotulados', 'bulk'],
  'envase: todo o BOM (não a fórmula) + frascos rotulados + bulk');
assert.strictEqual(l[5].aceitaRecipiente, true);
assert.ok(!l[5].exigeRecipiente, 'bombona é opcional');
l = M.linhasContagem(opCompleta, 'rotulagem');
assert.deepStrictEqual(l.map((x) => x.chave), ['mat:ES-00151', 'frascos_rotulados'], 'rotulagem: rótulos + frascos rotulados, sem bulk');
l = M.linhasContagem({lote: 'X', materiaisConsumo: opCompleta.materiaisConsumo}, 'linha');
assert.ok(!l.some((x) => x.chave === 'bulk'), 'OP sem fase de bulk não pergunta bulk');
assert.deepStrictEqual(M.linhasContagem({lote: 'sem bom'}, 'linha').map((x) => x.chave), ['frascos_rotulados'], 'OP sem BOM ainda conta frascos rotulados');
assert.strictEqual(M.classeDoMaterial('EP-00002'), 'EP');
assert.strictEqual(M.classeDoMaterial('MPGR-1'), null);

const linhas = M.linhasContagem(opCompleta, 'linha');
// Contagem exigida: em branco não vale como zero.
let val = M.validarContagem(linhas, {}, opCompleta);
assert.strictEqual(val.ok, false);
assert.strictEqual(val.erros.length, 6, 'cada linha pede a sua quantidade');
assert.match(val.erros[0], /VALVULA SPRAY.*0 se não sobrou/);
// Tudo zero: vale e não gera item retido.
const zeros = Object.fromEntries(linhas.map((x) => [x.chave, {qtd: '0'}]));
val = M.validarContagem(linhas, zeros, opCompleta);
assert.strictEqual(val.ok, true);
assert.deepStrictEqual(val.itens, []);
// Sobras reais: só o que é maior que zero vira item; dono padrão = cliente da OP.
const sobras = Object.assign({}, zeros, {'mat:EP-00002': {qtd: '800'}, frascos_rotulados: {qtd: '1200'}, bulk: {qtd: '330,5'.replace(',', '.'), recipiente: 'BB-0003'}});
val = M.validarContagem(linhas, sobras, opCompleta);
assert.strictEqual(val.ok, true, val.erros.join('|'));
assert.deepStrictEqual(val.itens.map((i) => [i.tipo, i.qtd, i.unidade]), [['COMPONENTE', 800, 'un'], ['FRASCO_ROTULADO', 1200, 'un'], ['BULK', 330.5, 'kg']]);
assert.strictEqual(val.itens[2].recipienteCodigo, 'BB-0003');
assert.ok(val.itens.every((i) => i.donoNome === 'WIKE MAKE'));
// Dono Kuryos por linha.
val = M.validarContagem(linhas, Object.assign({}, zeros, {'mat:EP-00095': {qtd: '40', donoTipo: 'KURYOS'}}), opCompleta);
assert.strictEqual(val.itens[0].donoNome, 'KURYOS');
// Bulk com sobra NÃO exige bombona (usuário, 01/10): vale sem recipiente; com ele, o código segue.
val = M.validarContagem(linhas, Object.assign({}, zeros, {bulk: {qtd: '10'}}), opCompleta);
assert.strictEqual(val.ok, true, val.erros.join('|'));
assert.deepStrictEqual([val.itens[0].tipo, val.itens[0].qtd, val.itens[0].recipienteCodigo], ['BULK', 10, null]);
val = M.validarContagem(linhas, Object.assign({}, zeros, {bulk: {qtd: '10', recipiente: 'BB-0002'}}), opCompleta);
assert.strictEqual(val.itens[0].recipienteCodigo, 'BB-0002');
// Recipiente informado numa linha que não é de bulk é ignorado.
val = M.validarContagem(linhas, Object.assign({}, zeros, {frascos_rotulados: {qtd: '5', recipiente: 'BB-0009'}}), opCompleta);
assert.strictEqual(val.itens[0].recipienteCodigo, null);
// Negativo e fração de unidade seguem recusados.
assert.strictEqual(M.validarContagem(linhas, Object.assign({}, zeros, {frascos_rotulados: {qtd: '-3'}}), opCompleta).ok, false);
assert.strictEqual(M.validarContagem(linhas, Object.assign({}, zeros, {frascos_rotulados: {qtd: '2.5'}}), opCompleta).ok, false);
assert.strictEqual(M.validarContagem(linhas, Object.assign({}, zeros, {frascos_rotulados: {qtd: 'abc'}}), opCompleta).ok, false);

// Registros para material_processo.
const regs = M.registrosDeItens(opCompleta, '26267-04', M.validarContagem(linhas, sobras, opCompleta).itens, 'ENCERRAMENTO', 'Ana', AGORA);
assert.strictEqual(regs.length, 3);
assert.deepStrictEqual([regs[0].opKey, regs[0].lote, regs[0].status, regs[0].origem, regs[0].declaradoPor], ['26267-04', '26267/04', 'EM_PROCESSO', 'ENCERRAMENTO', 'Ana']);
assert.strictEqual(regs[2].recipienteCodigo, 'BB-0003');
assert.strictEqual(M.registrosDeItens(opCompleta, 'k', [], 'PAUSA', 'Ana', AGORA).length, 0);

// ── Devolver a OP à fila ──────────────────────────────────────────────
assert.strictEqual(M.validarDevolucao({}).ok, false);
assert.strictEqual(M.validarDevolucao({motivo: 'Falta de componente'}).ok, false, 'sem declarar o que ficou retido não vale');
assert.strictEqual(M.validarDevolucao({motivo: 'Falta de componente', confirmouRetidos: true}).ok, true);
assert.strictEqual(M.validarDevolucao({motivo: 'Outro', confirmouRetidos: true}).ok, false, '"Outro" exige descrição');
assert.strictEqual(M.validarDevolucao({motivo: 'Outro', detalhe: 'Cliente pediu', confirmouRetidos: true}).ok, true);
const emLinha = Object.assign({}, opCompleta, {abertaDesde: AGORA, abertaLinha: 'Linha 2', produzidoLinha: 900, abertaDesdeRot: AGORA, abertaRotulagem: 'Rotulagem 01'});
let f = M.camposDevolucao(emLinha, 'linha', 'Falta de material do cliente', 'Ana', AGORA);
assert.strictEqual(f.abertaDesde, null);
assert.strictEqual(f.abertaLinha, null);
assert.ok(!('abertaDesdeRot' in f), 'devolver a linha não solta a rotulagem');
assert.ok(!('produzidoLinha' in f) && !('status' in f), 'a produção e o status não são tocados');
assert.deepStrictEqual([f.emFila.setor, f.emFila.linhaAnterior, f.emFila.motivo], ['linha', 'Linha 2', 'Falta de material do cliente']);
f = M.camposDevolucao(emLinha, 'rotulagem', 'Falta de componente', 'Ana', AGORA);
assert.strictEqual(f.abertaDesdeRot, null);
assert.strictEqual(f.abertaRotulagem, null);
assert.strictEqual(f.emFila.linhaAnterior, 'Rotulagem 01');

// ── Resumo do que está retido ─────────────────────────────────────────
const ret = M.resumoRetidos([
  {tipo: 'BULK', qtd: 330.5, unidade: 'kg', status: 'EM_PROCESSO'}, {tipo: 'BULK', qtd: 100, unidade: 'kg', status: 'EM_PROCESSO'},
  {tipo: 'FRASCO_ROTULADO', qtd: 1200, unidade: 'un', status: 'EM_PROCESSO'}, {tipo: 'BULK', qtd: 999, unidade: 'kg', status: 'USADO'}]);
assert.deepStrictEqual(ret.map((x) => M.rotuloResumo(x)), ['430,5 kg de bulk', '1.200 frascos rotulados'], 'só o que ainda está em processo');
console.log('material-processo: todos os testes passaram');
