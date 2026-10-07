'use strict';
/* Correção do encerramento errado de 07/10/2026 (autorizada pelo usuário:
   "vamos avante. pode corrigir tudo por favor").
   Às 08:47 BRT a Linha 1 encerrou a OP 26160/04 (PERFUME CAPILAR HONEY) com
   1.872 un. O produto era HIDRATANTE FLOR DAURA, lote 26278/03, que fechou ali
   com TOTAL de 1.872 (o operador informa o total acumulado: 1.776 já estavam
   lançados em 06/10 -> incremento real de 96). O perfume capilar roda na
   Linha 2 e a rotulagem dele já foi feita no passado.

   Cada nó é alterado por transaction, de forma idempotente (pode rodar de novo):
   - registros/2026-10-07/<id>: passa para 26278/03, incremento 96;
   - ops/26160-04: tira 1.872, a etapa de envase, setup/rotulagem abertos hoje,
     datas reais e sobras de hoje; linha = Linha 2; status Programado;
   - ops/26278-03: envase 1.776 -> 1.872, fechamento às 08:47, fecha a alocação;
   - pedidos/0007__DPHNPC01: -1.872; pedidos/0023__HDR-MISS-0007: +96;
   - estoque: estorna as 16 baixas do perfume (13 de saldo + 3 de lote WMS) e
     baixa o BOM do hidratante para +96 (frasco, válvula, rótulo, 2 caixas).
   Sem --apply: backup + ensaio. Execute da raiz do projeto. */
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const admin = require(path.join(root, 'functions/node_modules/firebase-admin'));
const PE = require(path.join(root, 'public/shared/propriedade-estoque.js'));
admin.initializeApp({credential: admin.credential.cert(require(path.join(root, 'firebase-service-account.json'))), databaseURL: 'https://prod-kuryos-default-rtdb.firebaseio.com'});

const ID = '-P3LB5QKmJuhs8eoOC3N', DIA = '2026-10-07', FECHOU = '2026-10-07T11:47:12.443Z';
const APLICAR = process.argv.includes('--apply');
const AGORA = new Date().toISOString();
const NOTA = {em: AGORA, por: 'Claude (autorizado por Gustavo Callegaro)',
  motivo: 'Encerramento lançado na OP 26160/04 por engano: era o envase do hidratante 26278/03 na Linha 1 (total 1.872). Perfume capilar roda na Linha 2.'};
// Hidratante: +96 un (1.776 -> 1.872). Mesmo BOM que baixou as 1.776 em 06/10.
// Caixa de 48: ceil(1872/48) - ceil(1776/48) = 39 - 37 = 2.
const BOM_HIDRATANTE = [['EP-00106', 96, 'un'], ['EP-00174', 96, 'un'], ['ES-00310', 96, 'un'], ['ET-00032', 2, 'un']];

(async () => {
  const db = admin.database();
  const get = async (p) => (await db.ref(p).get()).val();
  const movs = await get('movimentos_estoque');
  const doPerfume = [];
  for (const [item, lista] of Object.entries(movs || {})) for (const [k, m] of Object.entries(lista || {}))
    if (m && m.ref === '26160/04' && m.em >= DIA && m.em < '2026-10-08' && m.qtd < 0 && !m.estornoDe) doPerfume.push({item, k, m});
  const caminhos = ['registros/' + DIA + '/' + ID, 'ops/26160-04', 'ops/26278-03', 'pedidos/0007__DPHNPC01', 'pedidos/0023__HDR-MISS-0007'];
  const itensEst = [...new Set(doPerfume.filter((x) => x.m.tipo === 'consumo_producao').map((x) => x.item).concat(BOM_HIDRATANTE.map((b) => b[0])))];
  const lotes = doPerfume.filter((x) => x.m.tipo === 'consumo').map((x) => 'estoque_lotes/' + x.item + '/' + x.m.loteKey);
  const feitos = (await get('correcoes_estoque/op26160-04-' + DIA)) || {};
  const backup = {em: AGORA, movimentosPerfume: doPerfume, feitos};
  for (const p of caminhos.concat(itensEst.map((i) => 'estoque/' + i), lotes)) backup[p] = await get(p);
  const arq = path.join(root, 'backups', 'correcao-op26160-04-encerramento-' + Date.now() + '.json');
  fs.writeFileSync(arq, JSON.stringify(backup, null, 1));

  const reg = backup['registros/' + DIA + '/' + ID], op1 = backup['ops/26160-04'], op2 = backup['ops/26278-03'];
  const jaRegistro = reg.lote === '26278/03';
  if (!jaRegistro) {
    assert.equal(reg.lote, '26160/04'); assert.equal(reg.quantidade, 1872); assert.equal(reg.linha, 'Linha 1');
    assert.ok(op1.apontamentosAplicados && op1.apontamentosAplicados[ID], '26160/04 sem a aplicação');
    assert.equal(op1.produzidoLinha, 1872);
    assert.equal(op2.produzidoLinha, 1776); assert.ok(!(op2.apontamentosAplicados || {})[ID]);
    assert.ok(backup['pedidos/0007__DPHNPC01'].apontamentosAplicados[ID]);
  }
  assert.equal(doPerfume.length, 16, 'esperava 16 baixas do perfume, achei ' + doPerfume.length);
  console.log(JSON.stringify({backup: arq, modo: APLICAR ? 'aplicar' : 'ensaio', jaFeitos: Object.keys(feitos).length,
    baixasPerfume: doPerfume.map((x) => x.m.tipo + ' ' + x.item + ' ' + x.m.qtd + (x.m.loteKey ? ' ' + x.m.loteKey : ''))}, null, 1));
  if (!APLICAR) { await admin.app().delete(); return; }

  const tx = async (p, fn) => { const r = await db.ref(p).transaction((a) => (a ? fn(a) : a)); assert.ok(r.committed, 'não gravou ' + p); return r.snapshot.val(); };

  // 1. Registro
  await tx('registros/' + DIA + '/' + ID, (r) => {
    if (r.lote !== '26160/04') return r;
    r.correcao = Object.assign({original: {lote: r.lote, produto: r.produto, pedidoId: r.pedidoId, quantidade: r.quantidade, qtdTotalOP: r.qtdTotalOP, qtdEsperadaOP: r.qtdEsperadaOP}}, NOTA);
    Object.assign(r, {lote: '26278/03', produto: 'HIDRATANTE FLOR DAURA 200 ML', pedidoId: '0023', quantidade: 96, qtdIncrementoConfirmado: 96, qtdTotalOP: 1872, qtdEsperadaOP: 1680});
    return r;
  });
  // 2. OP do perfume
  await tx('ops/26160-04', (o) => {
    if (!o.apontamentosAplicados || !o.apontamentosAplicados[ID]) return o;
    delete o.apontamentosAplicados[ID];
    o.produzidoLinha = Math.max(0, (o.produzidoLinha || 0) - 1872);
    o.produzido = Math.max(0, (o.produzido || 0) - 1872);
    if (o.confirmacaoEtapas) delete o.confirmacaoEtapas.envase;
    if (o.contagemSobras) for (const [k, c] of Object.entries(o.contagemSobras)) if (c && c.em >= DIA) delete o.contagemSobras[k];
    for (const c of ['dataInicioReal', 'dataFimReal', 'setupInicio', 'setupFim', 'mediaPorHora', 'abertaDesde', 'abertaLinha', 'abertaRotulagem', 'abertaDesdeRot', 'setupInicioRot', 'setupFimRot']) delete o[c];
    o.linha = 'Linha 2'; o.status = 'Programado';
    o.correcoes = Object.assign(o.correcoes || {}, {['encerramento-' + DIA]: NOTA});
    return o;
  });
  // 3. OP do hidratante
  await tx('ops/26278-03', (o) => {
    o.apontamentosAplicados = o.apontamentosAplicados || {};
    if (o.apontamentosAplicados[ID]) return o;
    o.apontamentosAplicados[ID] = {qtdTotalOP: 1872, quantidade: 96, timestamp: FECHOU, tipo: 'fechamento_op'};
    o.produzidoLinha = (o.produzidoLinha || 0) + 96; o.produzido = (o.produzido || 0) + 96;
    o.dataFimReal = FECHOU; delete o.abertaDesde; delete o.abertaLinha;
    const env = Object.assign({}, (o.confirmacaoEtapas || {}).envase || {});
    delete env.automatico;
    o.confirmacaoEtapas = Object.assign(o.confirmacaoEtapas || {}, {envase: Object.assign(env, {quantidade: 1872, fechadoEm: FECHOU, local: 'Linha 1', operador: 'Jéssica', correcao: NOTA})});
    o.correcoes = Object.assign(o.correcoes || {}, {['encerramento-' + DIA]: NOTA});
    return o;
  });
  // 4. Pedidos
  await tx('pedidos/0007__DPHNPC01', (p) => {
    if (!p.apontamentosAplicados || !p.apontamentosAplicados[ID]) return p;
    delete p.apontamentosAplicados[ID];
    p.produzido = Math.max(0, (p.produzido || 0) - 1872);
    delete p.mediaPorHora; delete p.ultimoApontamento;
    return p;
  });
  await tx('pedidos/0023__HDR-MISS-0007', (p) => {
    p.apontamentosAplicados = p.apontamentosAplicados || {};
    if (p.apontamentosAplicados[ID]) return p;
    p.apontamentosAplicados[ID] = {quantidade: 96, lote: '26278/03'};
    p.produzido = (p.produzido || 0) + 96; p.ultimoApontamento = FECHOU;
    return p;
  });
  // 5. Estoque: estorno das baixas do perfume (saíram do geral -> voltam ao geral)
  for (const {item, k, m} of doPerfume) {
    if (feitos[k]) continue;
    const q = -m.qtd;
    if (m.tipo === 'consumo_producao') {
      const s = await tx('estoque/' + item, (a) => { a.saldoAtual = Math.round(((a.saldoAtual || 0) + q) * 1000) / 1000; a.ultimaAtualizacao = AGORA; return a; });
      await db.ref('movimentos_estoque/' + item).push({tipo: 'consumo_producao', motivo: 'ESTORNO DE CONSUMO (encerramento na OP errada)', qtd: q, saldoApos: s.saldoAtual, ref: '26160/04', itemTipo: 'material', itemCodigo: m.itemCodigo, itemNome: m.itemNome || null, unidade: m.unidade || null, propriedade: m.propriedade ? Object.assign({}, m.propriedade, {geral: q}) : null, autor: NOTA.por, em: AGORA, estornoDe: k});
    } else {
      const l = await tx('estoque_lotes/' + item + '/' + m.loteKey, (a) => { a.saldoLote = Math.round(((a.saldoLote || 0) + q) * 1000) / 1000; a.atualizadoEm = AGORA; return a; });
      await db.ref('movimentos_estoque/' + item).push({tipo: 'consumo', motivo: 'ESTORNO DE CONSUMO (encerramento na OP errada)', qtd: q, saldoApos: l.saldoLote, ref: '26160/04', itemTipo: 'material', itemCodigo: m.itemCodigo, itemNome: m.itemNome || null, unidade: m.unidade || null, loteKey: m.loteKey, enderecoCodigo: m.enderecoCodigo || null, enderecoKey: m.enderecoKey || null, autor: NOTA.por, em: AGORA, estornoDe: k});
    }
    await db.ref('correcoes_estoque/op26160-04-' + DIA + '/' + k).set(AGORA);
  }
  // 6. Estoque: BOM do hidratante para +96 (cliente MISS: sai primeiro da parte dela)
  for (const [cod, q, un] of BOM_HIDRATANTE) {
    const marca = 'hidratante-' + cod;
    if (feitos[marca]) continue;
    let rep = null;
    const s = await tx('estoque/' + cod, (a) => { rep = PE.aplicarMovimentoAgregado(a, -q, {clienteKeyConsumidor: 'MISS'}); a.ultimaAtualizacao = AGORA; return a; });
    await db.ref('movimentos_estoque/' + cod).push({tipo: 'consumo_producao', motivo: 'CONSUMO DE PRODUÇÃO', qtd: -q, saldoApos: s.saldoAtual, ref: '26278/03', itemTipo: 'material', itemCodigo: cod, itemNome: s.materialNome || null, unidade: un, propriedade: rep && rep.clienteKey ? rep : null, autor: NOTA.por, em: AGORA});
    await db.ref('correcoes_estoque/op26160-04-' + DIA + '/' + marca).set(AGORA);
  }

  // Releitura
  const o1 = await get('ops/26160-04'), o2 = await get('ops/26278-03'), r = await get('registros/' + DIA + '/' + ID);
  const p1 = await get('pedidos/0007__DPHNPC01'), p2 = await get('pedidos/0023__HDR-MISS-0007');
  assert.equal(o1.produzidoLinha, 0); assert.equal(o1.status, 'Programado'); assert.equal(o1.linha, 'Linha 2');
  assert.ok(!o1.confirmacaoEtapas || !o1.confirmacaoEtapas.envase); assert.equal(o1.abertaRotulagem, undefined);
  assert.equal(o2.produzidoLinha, 1872); assert.equal(o2.status, 'Concluído'); assert.equal(o2.abertaLinha, undefined);
  assert.equal(r.lote, '26278/03'); assert.equal(r.quantidade, 96);
  if (!jaRegistro) {
    assert.equal(p1.produzido, backup['pedidos/0007__DPHNPC01'].produzido - 1872);
    assert.equal(p2.produzido, backup['pedidos/0023__HDR-MISS-0007'].produzido + 96);
  }
  for (const i of itensEst) console.log('estoque', i, ((backup['estoque/' + i] || {}).saldoAtual), '->', (await get('estoque/' + i)).saldoAtual);
  for (const p of lotes) console.log(p, (backup[p] || {}).saldoLote, '->', (await get(p)).saldoLote);
  console.log('pedido 0007', backup['pedidos/0007__DPHNPC01'].produzido, '->', p1.produzido, '| pedido 0023 Flor Daura', backup['pedidos/0023__HDR-MISS-0007'].produzido, '->', p2.produzido);
  console.log('APLICADO E REVALIDADO.');
  await admin.app().delete();
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
