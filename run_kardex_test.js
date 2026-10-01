'use strict';
/* Kardex de estoque (shared/kardex.js). Ensaio opcional contra a base:
   KARDEX_BASE=<pasta com movimentos_estoque.json, estoque.json, estoque_lotes.json, materiais.json, produtos.json> */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('./public/shared/kardex.js');

// ── 1. Material (razão do item): consumo grava 'consumo_producao' (saldo) E
// 'consumo' (lote) -- só o primeiro conta. Transferência dividida (qtd +) não conta.
const movMat = {
  a: {tipo: 'recebimento_pc', qtd: 100, saldoApos: null, em: '2026-09-05T10:00:00Z', ref: 'PC-1', loteKey: 'L1'},
  b: {tipo: 'consumo_producao', qtd: -30, saldoApos: 70, em: '2026-09-06T10:00:00Z', ref: '26250/01'},
  c: {tipo: 'consumo', qtd: -30, saldoApos: 70, em: '2026-09-06T10:00:01Z', loteKey: 'L1'},
  d: {tipo: 'transferencia', qtd: 40, saldoApos: null, em: '2026-09-07T10:00:00Z', ref: 'A -> B'},
  e: {tipo: 'qualidade', qtd: 0, em: '2026-09-07T11:00:00Z'},
  f: {tipo: 'perda', qtd: -5, saldoApos: 65, em: '2026-09-08T10:00:00Z'},
  g: {tipo: 'ajuste_manual', qtd: 10, saldoApos: 75, em: '2026-09-09T10:00:00Z', autor: 'Ana'},
};
let r = K.montar({movimentos: movMat, estoqueItem: {saldoAtual: 75}});
assert.equal(r.razao, 'item');
assert.equal(r.saldoLog, 75);
assert.equal(r.semOrigem, 0);
assert.equal(r.conciliado, true, JSON.stringify(r.alertas));
assert.deepEqual(r.linhas.map((l) => l.saldo), [100, 70, 70, 70, 70, 65, 75]);
assert.equal(r.linhas[2].conta, false, 'baixa FEFO do lote não conta no saldo do item');
assert.equal(r.linhas[3].efeito, 0, 'transferência é informativa');

// ── 2. Saldo anterior ao log vira linha "sem origem" e o saldo corrido termina no sistema.
r = K.montar({movimentos: {x: {tipo: 'consumo_producao', qtd: -10, saldoApos: -110, em: '2026-09-10T00:00:00Z'}}, estoqueItem: {saldoAtual: -110}});
assert.equal(r.semOrigem, -100);
assert.equal(r.linhas[0].saldo, -110);
assert.equal(r.conciliado, false);
assert.equal(r.alertas[0].tipo, 'SEM_ORIGEM');

// ── 3. Elo quebrado: saldo mudou entre dois movimentos sem registro.
r = K.montar({movimentos: {
  p: {tipo: 'ajuste_manual', qtd: 50, saldoApos: 50, em: '2026-09-01T00:00:00Z'},
  q: {tipo: 'consumo_producao', qtd: -10, saldoApos: 20, em: '2026-09-02T00:00:00Z'}, // esperado 40
}, estoqueItem: {saldoAtual: 20}});
const elo = r.alertas.find((a) => a.tipo === 'ELO');
assert.ok(elo, 'deveria acusar elo quebrado');
assert.equal(elo.diferenca, -20);
// ...mas estorno com saldoApos null no meio NÃO é elo quebrado.
r = K.montar({movimentos: {
  p: {tipo: 'recebimento_pc', qtd: 50, saldoApos: 50, em: '2026-09-01T00:00:00Z'},
  q: {tipo: 'cancelamento_recebimento', qtd: -20, saldoApos: null, em: '2026-09-02T00:00:00Z'},
  s: {tipo: 'consumo_producao', qtd: -10, saldoApos: 20, em: '2026-09-03T00:00:00Z'},
}, estoqueItem: {saldoAtual: 20}});
assert.equal(r.alertas.length, 0, JSON.stringify(r.alertas));

// ── 4. Produto acabado (só lotes): entrada pela conferência, saída pela expedição.
r = K.montar({movimentos: {
  a: {tipo: 'conferencia_pa', qtd: 960, em: '2026-09-20T00:00:00Z', loteKey: 'P1'},
  b: {tipo: 'qualidade', qtd: 0, em: '2026-09-21T00:00:00Z'},
  c: {tipo: 'expedicao_pa', qtd: -400, em: '2026-09-25T00:00:00Z'},
}, lotes: {P1: {saldoLote: 560}}});
assert.equal(r.razao, 'lote');
assert.equal(r.saldoSistema, 560);
assert.equal(r.conciliado, true);

// ── 4b. Lote importado da planilha vira linha de implantação e o item fecha.
r = K.montar({movimentos: {
  c: {tipo: 'expedicao_pa', qtd: -100, em: '2026-09-25T00:00:00Z', loteKey: 'LEG'},
  d: {tipo: 'conferencia_pa', qtd: 50, em: '2026-09-26T00:00:00Z', loteKey: 'NOVO'},
}, lotes: {LEG: {saldoLote: 300, origemTipo: 'legado_planilha', loteInterno: 'L-OLD'}, NOVO: {saldoLote: 50}}});
assert.equal(r.conciliado, true, JSON.stringify(r.alertas));
assert.equal(r.linhas[0].tipo, 'implantacao_lote');
assert.equal(r.linhas[0].efeito, 400);
assert.equal(r.linhas[0].sintetico, true);
assert.match(r.linhas[0].motivo, /L-OLD importado da planilha antiga/);

// ── 5. Período: saldo inicial, totais por natureza, saldo final.
r = K.montar({movimentos: movMat, estoqueItem: {saldoAtual: 75}, desde: '2026-09-06T00:00:00Z', ate: '2026-09-08T23:59:59Z'});
assert.equal(r.periodo.saldoInicial, 100);
assert.equal(r.periodo.saldoFinal, 65);
assert.equal(r.periodo.totais.CONSUMO, -30);
assert.equal(r.periodo.totais.PERDA, -5);
assert.equal(r.periodo.totais.AJUSTE, 0);

// ── 6. Tipo novo (ex.: intermediário com tipo próprio) entra pelo sinal, como "Outro".
r = K.montar({movimentos: {i: {tipo: 'producao_intermediario', qtd: 300, em: '2026-10-01T00:00:00Z', itemTipo: 'intermediario'}}, lotes: {L: {saldoLote: 300}}});
assert.equal(r.linhas[0].natureza, 'OUTRO');
assert.equal(r.conciliado, true);

// ── 7. Catálogo: item sem cadastro mas com movimento aparece (intermediário).
const cat = K.catalogo({
  materiais: {m: {mpCodigo: 'MPGR-1', mpNome: 'ÁGUA', unidade: 'kg', tipo: 'MPGR'}},
  produtos: {p: {sku: 'SKU-1', descricao: 'PRODUTO'}},
  movimentos: {'BULK-26270-01': {x: {itemTipo: 'intermediario', itemCodigo: 'BULK-26270/01', itemNome: 'BULK X', unidade: 'kg', em: 'z'}}, _enderecos: {}},
});
assert.equal(cat['BULK-26270-01'].itemTipo, 'intermediario');
assert.equal(cat['BULK-26270-01'].nome, 'BULK X');
assert.ok(!cat._enderecos);
assert.equal(cat['MPGR-1'].nome, 'ÁGUA');

// ── 8. CSV com separador ; e vírgula decimal.
const linhasCsv = K.csv({codigo: 'X', nome: 'Y'}, K.montar({movimentos: {a: {tipo: 'perda', qtd: -1.5, em: '2026-09-01T00:00:00Z', motivo: 'a;b'}}, estoqueItem: {saldoAtual: -1.5}})).split('\n');
assert.equal(linhasCsv.length, 3);
assert.match(linhasCsv[2], /"a;b"/);
assert.match(linhasCsv[2], /-1,5;-1,5$/);

// ── 9. Material em processo (bombonas_bulk + material_processo, sessão "Material em Processo").
const mp = K.comMaterialProcesso({
  movimentos: {},
  bombonas: {
    'BB-0001': {codigo: 'BB-0001', conteudo: {lote: '26270/01', produto: 'BODY SPLASH', kg: 150}, historico: {
      h1: {tipo: 'ENCHER', kgAntes: 0, kgDepois: 200, lote: '26270/01', opKey: '26270-01', origem: 'MANIPULACAO', por: 'Léo', em: '2026-10-01T10:00:00Z'},
      h2: {tipo: 'AJUSTE', kgAntes: 200, kgDepois: 150, lote: '26270/01', motivo: 'retirada para envase', por: 'Léo', em: '2026-10-01T14:00:00Z'}}},
    'BB-0002': {codigo: 'BB-0002', conteudo: null, historico: {
      h1: {tipo: 'ENCHER', kgAntes: 0, kgDepois: 80, lote: '26265/02', em: '2026-09-30T10:00:00Z'},
      h2: {tipo: 'ESVAZIAR', kgAntes: 80, kgDepois: 0, lote: '26265/02', motivo: 'envasado', em: '2026-10-01T09:00:00Z'}}}
  },
  materialProcesso: {
    s1: {tipo: 'FRASCO_ROTULADO', sku: 'SKU-9', produto: 'BODY SPLASH', lote: '26267/04', qtd: 1200, unidade: 'un', status: 'EM_PROCESSO', em: '2026-09-30T18:00:00Z', declaradoPor: 'Ana', donoNome: 'MISS RÔSE'},
    s2: {tipo: 'FRASCO_ROTULADO', sku: 'SKU-9', produto: 'BODY SPLASH', lote: '26260/01', qtd: 300, unidade: 'un', status: 'USADO', em: '2026-09-20T18:00:00Z', baixa: {por: 'PCP', em: '2026-09-25T10:00:00Z', motivo: 'usado na 26267/04'}},
    s3: {tipo: 'BULK', lote: '26270/01', qtd: 40, unidade: 'kg', status: 'EM_PROCESSO', recipienteCodigo: 'BB-0001', em: '2026-10-01T15:00:00Z'},
    s4: {tipo: 'BULK', lote: '26271/01', produto: 'ÁGUA MICELAR', qtd: 12, unidade: 'kg', status: 'EM_PROCESSO', em: '2026-10-01T15:00:00Z'}
  }
});
const catMp = K.catalogo(mp);
assert.equal(catMp['proc_bulk_26270-01'].itemTipo, 'intermediario');
assert.equal(catMp['proc_bulk_26270-01'].nome, 'Bulk — BODY SPLASH');
r = K.montar(K.opcoesDoItem(mp, 'proc_bulk_26270-01'));
assert.equal(r.saldoSistema, 150, 'kg na bombona; a sobra com recipiente não conta duas vezes');
assert.equal(r.conciliado, true, JSON.stringify(r.alertas));
assert.deepEqual(r.linhas.map((l) => l.rotulo + ' ' + l.efeito), ['Bulk na bombona/tanque 200', 'Ajuste de kg na bombona -50']);
assert.equal(r.linhas[0].enderecoCodigo, 'BB-0001');
r = K.montar(K.opcoesDoItem(mp, 'proc_bulk_26265-02'));
assert.equal(r.saldoSistema, 0);
assert.equal(r.conciliado, true);
assert.equal(r.linhas[1].natureza, 'SAIDA');
r = K.montar(K.opcoesDoItem(mp, 'proc_rot_SKU-9'));
assert.equal(r.saldoSistema, 1200);
assert.equal(r.conciliado, true);
assert.deepEqual(r.linhas.map((l) => l.tipo), ['mp_sobra', 'mp_usado', 'mp_sobra']);
assert.equal(r.linhas[2].cliente, 'MISS RÔSE');
r = K.montar(K.opcoesDoItem(mp, 'proc_bulk_26271-01'));
assert.equal(r.saldoSistema, 12, 'bulk sem bombona entra pela sobra');
assert.ok(K.conciliacao(mp).every((x) => x.conciliado));

// ── Ensaio contra a base (lição do MRP: dado real acha o que asserção sintética não acha).
const base = process.env.KARDEX_BASE;
if (base) {
  const ler = (n) => JSON.parse(fs.readFileSync(path.join(base, n + '.json'), 'utf8')) || {};
  const d = {movimentos: ler('movimentos_estoque'), estoque: ler('estoque'), estoqueLotes: ler('estoque_lotes'), materiais: ler('materiais'), produtos: ler('produtos')};
  const conc = K.conciliacao(d);
  const ok = conc.filter((x) => x.conciliado).length;
  const elos = conc.reduce((s, x) => s + x.elos, 0);
  console.log('ensaio: ' + conc.length + ' itens; conciliados ' + ok + '; com saldo sem origem ' + conc.filter((x) => Math.abs(x.semOrigem) > 0.001).length + '; elos quebrados ' + elos);
  conc.slice(0, 8).forEach((x) => console.log('  ' + x.codigo + ' [' + x.razao + '] sistema ' + x.saldoSistema + ' log ' + x.saldoLog + ' sem origem ' + x.semOrigem + ' elos ' + x.elos));
  // Toda linha tem saldo numérico e o saldo corrido termina no saldo do sistema.
  conc.forEach((x) => {
    const rr = K.montar({movimentos: d.movimentos[x.key], estoqueItem: d.estoque[x.key], lotes: d.estoqueLotes[x.key]});
    if (rr.linhas.length) assert.equal(rr.linhas[rr.linhas.length - 1].saldo, rr.saldoSistema, x.codigo);
    rr.linhas.forEach((l) => assert.ok(isFinite(l.saldo), x.codigo));
  });
}

console.log('kardex: ok');
