'use strict';
/* Ajuste de Pedido de Compra (19/10/2026), caso real PC-0038: 6.000 pedidos,
   5.000 recebidos, saldo que nunca virá. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require(path.join(__dirname, 'public', 'shared', 'ajuste-pc.js'));
const R = require(path.join(__dirname, 'functions', 'recebimento.js'));

const pc38 = () => ({
  numeroFormatado: 'PC-0038', status: 'RECEBIDO_PARCIAL', fornecedorNome: 'D. A. BRASIL', valorTotalEstimado: 30000,
  recebimentos: {REC1: {data: '2026-10-09'}},
  itens: {
    i1: {materialCodigo: 'MPGR-00127', materialNome: 'ÁLCOOL 96°GL', unidade: 'kg', qtd: 6000, qtdCotada: 6000, qtdEmUnidadeEstoque: 6000,
      qtdRecebida: 5000, precoUnit: 5, custoUnitarioNaDecisao: 5, custoTotalNaDecisao: 30000}
  }
});
const enviado = () => ({
  numeroFormatado: 'PC-0040', status: 'ENVIADO', valorTotalEstimado: 1500,
  itens: {
    a: {materialCodigo: 'EP-1', materialNome: 'FRASCO', unidade: 'un', qtd: 1000, qtdCotada: 10, unidadeCotada: 'cx', fatorConversao: 100,
      qtdEmUnidadeEstoque: 1000, qtdRecebida: 0, custoTotalNaDecisao: 1000},
    b: {materialCodigo: 'EP-2', materialNome: 'TAMPA', unidade: 'un', qtd: 500, qtdRecebida: 0, custoTotalNaDecisao: 500}
  }
});
const agora = '2026-10-19T12:00:00.000Z';
const base = {autorizado: true, autor: 'Gustavo', agora, motivo: 'Fornecedor só tinha 5.000; combinado por telefone.'};

// ── Quem pode e quando ────────────────────────────────────────────────────
assert.deepEqual(A.avaliar(pc38(), 'admin'), {pode: true, modo: 'ENCERRAR_SALDO', motivo: null});
assert.deepEqual(A.avaliar(enviado(), 'admin'), {pode: true, modo: 'ANTES_DE_RECEBER', motivo: null});
assert.equal(A.avaliar(pc38(), true).pode, true, 'a tela autoriza quem tem o módulo Compras');
assert.equal(A.avaliar(pc38(), false).pode, false, 'sem módulo Compras não ajusta');
assert.equal(A.avaliar(pc38(), undefined).pode, false);
assert.equal(A.avaliar(pc38(), 'pcp').pode, false, 'um papel qualquer não autoriza: quem decide é o módulo');
assert.match(A.avaliar(pc38(), false).motivo, /Compras/);
assert.match(A.avaliar(Object.assign(pc38(), {status: 'ABERTO'}), 'admin').motivo, /Editar/);
assert.equal(A.avaliar(Object.assign(pc38(), {status: 'RECEBIDO_TOTAL'}), 'admin').pode, false);
assert.equal(A.avaliar(Object.assign(pc38(), {status: 'CANCELADO'}), 'admin').pode, false);
assert.equal(A.avaliar(null, 'admin').pode, false);
const enviadoComRec = enviado(); enviadoComRec.itens.a.qtdRecebida = 10;
assert.match(A.avaliar(enviadoComRec, 'admin').motivo, /recebimento/, 'ENVIADO que já recebeu algo não é "antes de receber"');
const semSaldo = pc38(); semSaldo.itens.i1.qtd = 5000;
assert.match(A.avaliar(semSaldo, 'admin').motivo, /saldo/);

// ── PC-0038: encerrar saldo ───────────────────────────────────────────────
{
  const r = A.aplicar(pc38(), base);
  assert.ok(r.pc, r.erro);
  const it = r.pc.itens.i1;
  assert.equal(it.qtd, 5000); assert.equal(it.qtdCotada, 5000); assert.equal(it.qtdEmUnidadeEstoque, 5000);
  assert.equal(it.custoTotalNaDecisao, 25000, 'valor acompanha: 5.000 x 5');
  assert.equal(it.qtdOriginal, 6000); assert.equal(it.saldoEncerrado, 1000);
  assert.equal(it.qtdRecebida, 5000, 'o que entrou não muda');
  assert.equal(r.pc.status, 'RECEBIDO_TOTAL');
  assert.equal(r.pc.valorTotalEstimado, 25000);
  assert.equal(r.pc.revisao, 1);
  const aj = r.pc.ajustes.AJ001;
  assert.equal(aj.tipo, 'ENCERRAR_SALDO'); assert.equal(aj.por, 'Gustavo'); assert.equal(aj.statusAntes, 'RECEBIDO_PARCIAL');
  assert.equal(aj.itens.i1.qtdAntes, 6000); assert.equal(aj.itens.i1.qtdDepois, 5000);
  assert.equal(aj.valorAntes, 30000); assert.equal(aj.valorDepois, 25000);
  assert.equal(r.pc.encerramentoSaldo.por, 'Gustavo');
  assert.equal(r.pc.recebimentos.REC1.data, '2026-10-09', 'recebimentos preservados');
  assert.equal(pc38().itens.i1.qtd, 6000, 'não muda a entrada');

  // O servidor concorda: com qtd = recebida o pedido está completo.
  assert.equal(R.statusPedidoApos(r.pc.itens, {}, r.pc.status).status, 'RECEBIDO_TOTAL');
  // E um estorno depois reabre o saldo sozinho (sem exceção de código).
  assert.equal(R.statusPedidoApos(r.pc.itens, {i1: -1000}, r.pc.status).status, 'RECEBIDO_PARCIAL');

  // Sem motivo / motivo curto: recusa. Não-admin: recusa.
  assert.match(A.aplicar(pc38(), Object.assign({}, base, {motivo: 'curto'})).erro, /motivo/);
  assert.match(A.aplicar(pc38(), Object.assign({}, base, {autorizado: false})).erro, /Compras/);
  // Segunda vez: já está recebido total.
  assert.match(A.aplicar(r.pc, base).erro, /por inteiro/);
}

// ── Encerrar saldo com dois itens: um parcial, um nunca recebido ──────────
{
  const pc = pc38();
  pc.itens.i2 = {materialCodigo: 'EP-9', materialNome: 'GALAO', unidade: 'un', qtd: 100, qtdRecebida: 0, custoTotalNaDecisao: 200};
  pc.valorTotalEstimado = 30200;
  const r = A.aplicar(pc, base);
  assert.equal(r.pc.itens.i2.qtd, 0); assert.equal(r.pc.itens.i2.cancelado, true); assert.equal(r.pc.itens.i2.qtdOriginal, 100);
  assert.equal(r.pc.status, 'RECEBIDO_TOTAL');
  assert.equal(R.statusPedidoApos(r.pc.itens, {}, r.pc.status).status, 'RECEBIDO_TOTAL');
  assert.equal(r.pc.valorTotalEstimado, 25000);
}

// ── Antes de receber: ajustar quantidade ───────────────────────────────────
{
  const r = A.aplicar(enviado(), Object.assign({}, base, {qtdNova: {a: '800', b: '500'}}));
  assert.ok(r.pc, r.erro);
  const a = r.pc.itens.a;
  assert.equal(a.qtd, 800); assert.equal(a.qtdCotada, 8, 'unidade do fornecedor acompanha a proporção'); assert.equal(a.qtdEmUnidadeEstoque, 800);
  assert.equal(a.custoTotalNaDecisao, 800);
  assert.equal(r.pc.itens.b.qtd, 500, 'item sem mudança fica igual');
  assert.equal(r.pc.status, 'ENVIADO', 'continua enviado: ainda vai receber');
  assert.equal(r.pc.valorTotalEstimado, 1300);
  assert.deepEqual(Object.keys(r.pc.ajustes.AJ001.itens), ['a'], 'só o item alterado entra na revisão');
  assert.equal(r.pc.ajustes.AJ001.tipo, 'ANTES_DE_RECEBER');
  // Segunda revisão numera AJ002 e preserva a primeira.
  const r2 = A.aplicar(r.pc, Object.assign({}, base, {qtdNova: {b: 450}}));
  assert.equal(r2.pc.revisao, 2); assert.ok(r2.pc.ajustes.AJ001 && r2.pc.ajustes.AJ002);
  // Aumentar também vale (ajuste não é só redução).
  assert.equal(A.aplicar(enviado(), Object.assign({}, base, {qtdNova: {a: 1200}})).pc.itens.a.qtd, 1200);
  // Nada mudou / valor inválido / negativo / ficaria vazio.
  assert.match(A.aplicar(enviado(), Object.assign({}, base, {qtdNova: {a: 1000, b: 500}})).erro, /Nenhuma quantidade/);
  assert.match(A.aplicar(enviado(), Object.assign({}, base, {qtdNova: {a: ''}})).erro, /válida/);
  assert.match(A.aplicar(enviado(), Object.assign({}, base, {qtdNova: {a: -1}})).erro, /negativa/);
  assert.match(A.aplicar(enviado(), Object.assign({}, base, {qtdNova: {a: 0, b: 0}})).erro, /nenhum item/);
  // Zerar um item mantendo outro: o item vira cancelado.
  const z = A.aplicar(enviado(), Object.assign({}, base, {qtdNova: {a: 0}}));
  assert.equal(z.pc.itens.a.cancelado, true); assert.equal(z.pc.itens.a.qtd, 0);
  // Item que não existe no pedido é ignorado.
  assert.match(A.aplicar(enviado(), Object.assign({}, base, {qtdNova: {zzz: 5}})).erro, /Nenhuma quantidade/);
  // O servidor valida o recebimento contra a nova qtd (sempre `item.qtd`).
  assert.equal(r.pc.itens.a.qtd - (r.pc.itens.a.qtdRecebida || 0), 800);
}

// ── Telas ──────────────────────────────────────────────────────────────────
{
  const h = fs.readFileSync('public/compras.html', 'utf8');
  assert.ok(/shared\/ajuste-pc\.js/.test(h) && /id="modalAjustarPC"/.test(h));
  assert.ok(/function confirmarAjustePC/.test(h) && /AjustePC\.aplicar\(atual, dados\)/.test(h), 'grava por transaction com a regra pura');
  assert.ok(/if \(!atual\) return atual;\s*\n\s*var r = AjustePC\.aplicar/.test(h), 'transaction não aborta no null do cache');
  assert.ok(/pc-ajustar/.test(h) && /faixaRevisaoDocumentoPC/.test(h), 'botão na lista e faixa de revisão no documento');
  assert.ok(/function podeAjustarPC/.test(h) && /modulosDoUsuario\(u\)\.indexOf\('compras'\)/.test(h), 'permissão = módulo Compras ou admin');
}
console.log('run_ajuste_pc_test: OK');
