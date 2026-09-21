const assert = require('assert');
const path = require('path');
const D = require(path.join(__dirname, 'public', 'shared', 'dossie-lote.js'));

const foto = (id) => ({caminho: 'manipulacao/26250-02/' + id + '.jpg', url: 'https://x/' + id});
const ops = {
  '26250-02': {
    lote: '26250/02', produto: 'BODY SPLASH LEÃO DO DESERTO 200ml', sku: 'MRARBS07', cliente: 'MISS RÔSE',
    qtdPlanejada: 1000, produzido: 980, status: 'Concluído', linha: 'Linha 3', skuPedidoKey: '11__MRARBS07',
    dataEmissao: '2026-09-10T08:00:00', emitidoPor: 'PCP', dataInicioReal: '2026-09-11T13:00:00Z', dataFimReal: '2026-09-11T17:00:00Z',
    confirmadoEm: '2026-09-11T18:00:00Z', confirmadoPor: 'Supervisor',
    manipulacao: {
      status: 'LIBERADO',
      previstos: {
        'MP-01': {mpCodigo: 'MP-01', mpNome: 'ALCOOL', unidade: 'kg', previsto: 60},
        'MP-02': {mpCodigo: 'MP-02', mpNome: 'FRAGRANCIA', unidade: 'kg', previsto: 5}
      },
      pesagem: {
        inicio: '2026-09-11T08:00:00Z', fim: '2026-09-11T08:40:00Z', por: 'João', baixaAplicada: true,
        parcelas: {
          'MP-01': {
            '-a': {peso: 25, loteMaterial: 'AK-1', foto: foto('a'), em: '2026-09-11T08:05:00Z', por: 'João'},
            '-x': {peso: 52, loteMaterial: 'AK-1', foto: foto('x'), em: '2026-09-11T08:06:00Z', por: 'João',
                   canceladaEm: '2026-09-11T08:07:00Z', canceladaPor: 'João', motivoCancelamento: 'peso errado'},
            '-b': {peso: 35, loteMaterial: 'AK-2', foto: foto('b'), em: '2026-09-11T08:10:00Z', por: 'João'}
          },
          'MP-02': {'-c': {peso: 5, loteMaterial: 'AK-3', foto: foto('c'), em: '2026-09-11T08:20:00Z', por: 'João'}}
        },
        itens: {'MP-01': {pesado: 60, loteMaterial: 'AK-1, AK-2', parcelas: 2}},
        // O operador guardou a embalagem, e em outro lugar.
        devolucoes: {'MP-01': {em: '2026-09-11T08:45:00Z', por: 'João', enderecoCodigo: 'FAB-2.1.1', mudou: true, enderecoAnteriorCodigo: 'FAB-1.1.1'}}
      },
      conferencia: {por: 'Ana', em: '2026-09-11T09:00:00Z', itens: {'MP-01': {ok: true}, 'MP-02': {ok: true}}},
      manipulacao: {inicio: '2026-09-11T09:10:00Z', fim: '2026-09-11T11:00:00Z', por: 'Ana', rendimento: 63, perdas: {residuo_tacho: 1}},
      analise: {decisao: 'LIBERADO', por: 'Daiene', em: '2026-09-11T12:00:00Z'}
    }
  },
  '26250-03': {lote: '26250/03', produto: 'HIDRATANTE AMBAR', cliente: 'MISS RÔSE', dataEmissao: '2026-09-10T09:00:00'},
  '26100-01': {lote: '26100/01', produto: 'PERFUME ZAFIYR', cliente: 'AFEER', dataEmissao: '2026-04-01T09:00:00'}
};
const fontes = {
  ops,
  registros: {
    '2026-09-11': {
      '-r1': {lote: '26250/02', timestamp: '2026-09-11T15:00:00Z', operador: 'Jessica', quantidade: 500, linha: 'Linha 3'},
      '-r2': {lote: '26250/02', timestamp: '2026-09-11T17:00:00Z', operador: 'Jessica', quantidade: 480, qtdIncrementoConfirmado: 480, tipo: 'fechamento_op'},
      '-r3': {lote: '26250/03', timestamp: '2026-09-11T17:00:00Z', quantidade: 999}
    }
  },
  paradas: {'-p': {lote: '26250/02', inicio: '2026-09-11T14:00:00Z', motivo: 'Falta de frasco', duracao: 20}, '-q': {lote: '', motivo: 'x'}},
  perdas: {'26250-02': {'-l': {data: '2026-09-11', lote: '26250/02', timestamp: '2026-09-11T17:10:00Z', perdas: [{tipo: 'Rótulos', quantidade: 7}]}}},
  movimentos: {
    'MP-01': {
      '-m1': {ref: '26250/02', qtd: -60, tipo: 'consumo_manipulacao', itemCodigo: 'MP-01', unidade: 'kg', em: '2026-09-11T08:40:00Z'}
    },
    'EP-9': {
      '-m2': {ref: '26250/02', qtd: -980, tipo: 'consumo_producao', itemCodigo: 'EP-9', unidade: 'un', em: '2026-09-11T17:00:00Z'},
      '-m3': {ref: '26250/03', qtd: -5, tipo: 'consumo_producao'}
    },
    // Defeito histórico (10/09): consumo lançado positivo.
    'MPES-5': {'-m4': {ref: '26250/02', qtd: 11, tipo: 'consumo_producao', itemCodigo: 'MPES-5', unidade: 'kg', em: '2026-09-11T17:00:00Z'}}
  },
  estoqueLotes: {
    MRARBS07: {
      'pa_26250-02_p1': {itemTipo: 'produto', opKey: '26250-02', opLote: '26250/02', paleteNumero: 1, qtdOriginal: 980, status: 'LIBERADO',
        qualidade: {decisao: 'LIBERADO', inspecionadoEm: '2026-09-12T10:00:00Z', inspecionadoPor: 'Daiene'}},
      'pa_26250-03_p1': {itemTipo: 'produto', opKey: '26250-03', opLote: '26250/03'}
    },
    'MP-01': {'AK-1': {itemTipo: 'material', loteInterno: 'AK-1'}}
  },
  conferenciasPa: {'26250-02': {contagens: {'-k': {contadoEm: '2026-09-11T19:00:00Z', contadoPor: 'Diego', total: 980, diferenca: 0}}}},
  naoConformidades: {'RNC-1': {numero: 'RNC-1', loteOrigem: '26250/02', abertaEm: '2026-09-12T11:00:00Z', abertaPor: 'Daiene', classificacao: 'MENOR'},
                     'RNC-2': {numero: 'RNC-2', loteOrigem: '26250/03'}}
};

// ── Busca ──
{
  assert.deepEqual(D.buscar(ops, '26250/02').itens.map((o) => o.key)[0], '26250-02');
  assert.equal(D.buscar(ops, '26250 02').itens[0].key, '26250-02', 'sem barra');
  assert.equal(D.buscar(ops, '2625002').itens[0].key, '26250-02', 'tudo junto');
  assert.equal(D.buscar(ops, '26250.02').total, 1);
  const rose = D.buscar(ops, 'miss rose');
  assert.equal(rose.total, 2, 'Rôse sem acento acha os dois lotes da Miss Rôse');
  assert.deepEqual(rose.itens.map((o) => o.key), ['26250-03', '26250-02'], 'mais recente primeiro');
  assert.equal(D.buscar(ops, 'rose leao').total, 1, 'todas as palavras, em campos diferentes');
  assert.equal(D.buscar(ops, 'MRARBS07').total, 1, 'por SKU');
  assert.equal(D.buscar(ops, '').total, 3);
  assert.equal(D.buscar(ops, 'nada disso').total, 0);
  assert.equal(D.acharOp(ops, '26250/02'), '26250-02');
  assert.equal(D.acharOp(ops, '26250-02'), '26250-02');
  assert.equal(D.acharOp(ops, '99999/99'), null);
}

// ── Dossiê ──
{
  const d = D.montar('26250-02', fontes);
  assert.equal(d.lote, '26250/02');
  // Granel: o que foi pesado, parcela a parcela, com foto.
  assert.equal(d.granel.existe, true);
  assert.equal(d.granel.status, 'LIBERADO');
  const mp1 = d.granel.linhas.find((l) => l.mpCodigo === 'MP-01');
  assert.equal(mp1.pesado, 60, '25 + 35; a cancelada não soma');
  assert.equal(mp1.loteMaterial, 'AK-1, AK-2');
  assert.deepEqual(mp1.todasParcelas.map((p) => [p.id, p.ordem]), [['-a', 1], ['-x', null], ['-b', 2]], 'cancelada aparece, sem número');
  assert.equal(mp1.todasParcelas[1].motivoCancelamento, 'peso errado');
  assert.equal(mp1.conferencia.ok, true);
  assert.equal(mp1.devolucao.enderecoCodigo, 'FAB-2.1.1', 'onde a embalagem foi guardada');
  assert.equal(mp1.devolucao.mudou, true);
  assert.equal(d.granel.linhas.find((l) => l.mpCodigo === 'MP-02').devolucao, null, 'MP sem confirmação de devolução');
  assert.equal(d.granel.resumo.rendimento, 63);
  assert.equal(d.granel.analise.por, 'Daiene');

  // Envase e o resto do lote -- só deste lote.
  assert.equal(d.apontamentos.length, 2);
  assert.equal(d.totalApontado, 980);
  assert.equal(d.paradas.length, 1);
  assert.deepEqual(d.perdas.map((p) => [p.tipo, p.quantidade]), [['Rótulos', 7]]);
  assert.deepEqual(d.consumos.map((c) => [c.itemCodigo, c.consumido, c.sinalInvertido]),
    [['EP-9', 980, 0], ['MP-01', 60, 0], ['MPES-5', 11, 1]]);
  assert.equal(d.consumos.find((c) => c.itemCodigo === 'MP-01').tipos[0], 'consumo_manipulacao');
  assert.equal(d.paletes.length, 1);
  assert.equal(d.paletes[0].qualidade.decisao, 'LIBERADO');
  assert.equal(d.contagensPa.length, 1);
  assert.deepEqual(d.rncs.map((r) => r.numero), ['RNC-1']);

  // Linha do tempo em ordem, com as pesagens e o cancelamento.
  const t = d.linhaDoTempo;
  const idx = (re) => t.findIndex((e) => re.test(e.oque));
  assert.ok(idx(/OP emitida/) === 0);
  assert.ok(idx(/1ª pesagem de MP-01: 25 kg \(lote AK-1\) com foto/) > 0);
  assert.ok(idx(/cancelada: peso errado/) > idx(/1ª pesagem de MP-01/));
  assert.ok(idx(/Pesagem fechada/) > idx(/2ª pesagem de MP-01/));
  assert.ok(idx(/Granel liberado/) < idx(/Apontamento: 500/));
  assert.ok(idx(/RNC RNC-1 aberta/) === t.length - 1);
  for (let i = 1; i < t.length; i++) assert.ok(String(t[i - 1].em) <= String(t[i].em), 'ordenada');

  // Lote antigo, sem fase de granel: o dossiê abre mesmo assim.
  const velho = D.montar('26100-01', fontes);
  assert.equal(velho.granel.existe, false);
  assert.equal(velho.apontamentos.length, 0);
  assert.equal(D.montar('nao-existe', fontes), null);
}

console.log('run_dossie_lote_test.js: OK');
