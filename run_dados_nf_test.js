'use strict';
/* Dados obrigatórios para emitir NF (23/10/2026).

   O caso que origina tudo é o item 3 da carga Miss Rose faturada hoje:
   validade saiu vazia e fabricação não existia, embora as duas fossem
   deriváveis do que já estava no banco. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require(path.join(__dirname, 'public', 'shared', 'dados-nf.js'));

// Os gêmeos têm de continuar byte a byte iguais (regra do repo).
assert.equal(
  fs.readFileSync(path.join(__dirname, 'public', 'shared', 'dados-nf.js'), 'utf8'),
  fs.readFileSync(path.join(__dirname, 'functions', 'dados_nf.js'), 'utf8'),
  'public/shared/dados-nf.js e functions/dados_nf.js precisam ser idênticos');

// ── somarMeses ──────────────────────────────────────────────────────────────
assert.equal(D.somarMeses('2026-10-14', 36), '2029-10-14');
assert.equal(D.somarMeses('2026-10-14T19:59:00.000Z', 36), '2029-10-14', 'ignora a hora da OP');
assert.equal(D.somarMeses('2026-01-31', 1), '2026-03-03', 'jan/31 + 1 mês escorrega, e isso é aceito');
assert.equal(D.somarMeses('2026-10-14', 0), '', 'prazo zero não é validade');
assert.equal(D.somarMeses('', 36), '');
assert.equal(D.somarMeses('2026-10-14', null), '');
assert.equal(D.somarMeses('nao e data', 36), '');

// ── O CASO REAL de 23/10 (item 3 da carga Miss Rose) ────────────────────────
const real = {
  lote: {itemCodigo: 'MRARBS12', itemNome: 'BODY SPLASH FLOR DAURA 200ML', opLote: '26282/03',
    caixasFechadas: 37, unidadesCaixaParcial: 16, unidadesPorCaixa: 48, saldoLote: 1792, qtdOriginal: 1792},
  op: {dataFimReal: '2026-10-14T19:59:00.000Z', dataInicioReal: '2026-10-14T13:27:00.000Z'},
  produto: {sku: 'MRARBS12', prazoValidadeMeses: 36, kgCaixa: 11.7, unCx: 48},
  quantidade: 1792
};
const r = D.derivar(real);
assert.equal(r.sku, 'MRARBS12');
assert.equal(r.lote, '26282/03');
// As duas que estavam faltando na NF:
assert.equal(r.dataFabricacao, '2026-10-14', 'fabricação = fim real da OP, a mesma regra do laudo');
assert.equal(r.origens.dataFabricacao, 'OP (fim real)');
assert.equal(r.validade, '2029-10-14', 'validade = fabricação + 36 meses do cadastro');
assert.match(r.origens.validade, /36 meses/);
// As que já saíam certas, e precisam continuar:
assert.equal(r.caixasFechadas, 37);
assert.equal(r.unidadesCaixaParcial, 16);
assert.equal(r.caixasParciais, 1, 'caixa parcial é UMA caixa, não 16');
assert.equal(r.volumes, 38);
assert.equal(r.unidadesPorCaixa, 48);
assert.equal(r.unidades, 1792);
assert.equal(r.pesoKg, 444.6, 'mantém a conta que já estava em produção');
assert.equal(r.completo, true);
assert.deepEqual(r.faltas, []);

// ── Fabricação: a cascata, e NUNCA "hoje" ───────────────────────────────────
const fab = (lote, op) => D.derivar({lote: lote, op: op, produto: {prazoValidadeMeses: 12}, quantidade: 10});
assert.equal(fab({dataFabricacao: '2026-01-05'}, {dataFimReal: '2026-02-02'}).dataFabricacao, '2026-01-05', 'o lote vence a OP');
assert.equal(fab({dataFabricacao: '2026-01-05'}, {}).origens.dataFabricacao, 'lote');
assert.equal(fab({}, {dataFimReal: '2026-02-02T10:00:00Z'}).dataFabricacao, '2026-02-02');
assert.equal(fab({}, {dataEmissao: '2026-02-01'}).dataFabricacao, '2026-02-01');
assert.equal(fab({}, {dataEmissao: '2026-02-01', dataFimReal: '2026-02-02'}).dataFabricacao, '2026-02-02', 'fim real vence emissão');
assert.equal(fab({}, {dataInicioReal: '2026-01-30'}).dataFabricacao, '2026-01-30', 'último recurso');
// Sem nenhuma fonte: VAZIO, não a data de hoje.
const semFab = fab({}, {});
assert.equal(semFab.dataFabricacao, '', 'sem fonte não inventa data');
assert.ok(semFab.faltas.some((f) => f.campo === 'dataFabricacao'));
assert.match(semFab.faltas.find((f) => f.campo === 'dataFabricacao').onde, /Encerre a OP/);

// ── Validade: lote primeiro, cálculo depois, e o furo do cadastro ───────────
assert.equal(D.derivar({lote: {dataValidade: '2027-05-05'}, op: {dataFimReal: '2026-01-01'},
  produto: {prazoValidadeMeses: 36}, quantidade: 1}).validade, '2027-05-05', 'o lote declara e vence o cálculo');
assert.equal(D.derivar({lote: {dataValidade: '2027-05-05'}, op: {}, produto: {}, quantidade: 1}).origens.validade, 'lote');
// Este é o furo medido: 19 de 35 SKUs sem prazo no cadastro.
const semVal = D.derivar({lote: {itemCodigo: 'DPGLBS03', caixasFechadas: 4, unidadesPorCaixa: 60, saldoLote: 240, qtdOriginal: 240},
  op: {dataFimReal: '2026-09-22T10:00:00Z'}, produto: {kgCaixa: 10}, quantidade: 240});
assert.equal(semVal.dataFabricacao, '2026-09-22', 'a fabricação sai mesmo assim');
assert.equal(semVal.validade, '', 'sem prazo no cadastro não há validade');
const faltaVal = semVal.faltas.find((f) => f.campo === 'validade');
assert.ok(faltaVal, 'validade entra como falta');
assert.match(faltaVal.onde, /Cadastros › Produtos/, 'a mensagem diz ONDE corrigir');
assert.match(faltaVal.onde, /vale para todo lote futuro/, 'e por que vale a pena');
assert.equal(faltaVal.sku, 'DPGLBS03', 'carrega o SKU, para agrupar por cadastro');
// Validade impossível porque a fabricação falta: a mensagem não manda para o
// cadastro, que não resolveria.
const nem = D.derivar({lote: {itemCodigo: 'X'}, op: {}, produto: {prazoValidadeMeses: 24}, quantidade: 1});
assert.match(nem.faltas.find((f) => f.campo === 'validade').onde, /depende da fabricação/);

// ── Caixas: lote inteiro usa a contagem; parcial recalcula ──────────────────
const inteiro = D.derivar({lote: {caixasFechadas: 10, unidadesCaixaParcial: 5, unidadesPorCaixa: 20, qtdOriginal: 205, saldoLote: 205},
  op: {dataFimReal: '2026-01-01'}, produto: {prazoValidadeMeses: 12, kgCaixa: 1}, quantidade: 205});
assert.equal(inteiro.caixasFechadas, 10);
assert.equal(inteiro.unidadesCaixaParcial, 5);
assert.equal(inteiro.origens.caixas, 'contagem do lote');
/* Carga parcial: declarar as caixas do LOTE e embarcar menos faria a NF
   descrever outra carga. A quebra sai da quantidade embarcada. */
const parte = D.derivar({lote: {caixasFechadas: 10, unidadesCaixaParcial: 5, unidadesPorCaixa: 20, qtdOriginal: 205, saldoLote: 205},
  op: {dataFimReal: '2026-01-01'}, produto: {prazoValidadeMeses: 12, kgCaixa: 1}, quantidade: 70});
assert.equal(parte.caixasFechadas, 3, '70 / 20 = 3 caixas cheias');
assert.equal(parte.unidadesCaixaParcial, 10, 'e 10 soltas');
assert.equal(parte.caixasParciais, 1);
assert.equal(parte.volumes, 4);
assert.equal(parte.origens.caixas, 'calculado da quantidade embarcada');
// Sem resto não existe caixa parcial.
const redondo = D.derivar({lote: {unidadesPorCaixa: 20, qtdOriginal: 200, saldoLote: 200}, op: {dataFimReal: '2026-01-01'},
  produto: {prazoValidadeMeses: 12, kgCaixa: 1}, quantidade: 60});
assert.equal(redondo.caixasFechadas, 3);
assert.equal(redondo.unidadesCaixaParcial, 0);
assert.equal(redondo.caixasParciais, 0);
assert.equal(redondo.volumes, 3);
// Sem unidades por caixa a conta não dá, e isso é falta.
const semUnCx = D.derivar({lote: {itemCodigo: 'Y', caixasFechadas: 2}, op: {dataFimReal: '2026-01-01'},
  produto: {prazoValidadeMeses: 12}, quantidade: 50});
assert.ok(semUnCx.faltas.some((f) => f.campo === 'unidadesPorCaixa'));
// unidadesPorCaixa também pode vir do cadastro.
assert.equal(D.derivar({lote: {qtdOriginal: 100, saldoLote: 100}, op: {dataFimReal: '2026-01-01'},
  produto: {unCx: 25, prazoValidadeMeses: 12, kgCaixa: 1}, quantidade: 100}).unidadesPorCaixa, 25);

// ── Peso: lote manda; senão volumes x kg/caixa; sem fonte é falta ──────────
assert.equal(D.derivar({lote: {pesoTotalKg: 123.45, unidadesPorCaixa: 10, qtdOriginal: 100, saldoLote: 100},
  op: {dataFimReal: '2026-01-01'}, produto: {prazoValidadeMeses: 12, kgCaixa: 99}, quantidade: 100}).pesoKg, 123.45,
  'peso gravado no lote vence o cálculo');
const semPeso = D.derivar({lote: {itemCodigo: 'Z', unidadesPorCaixa: 10, qtdOriginal: 100, saldoLote: 100},
  op: {dataFimReal: '2026-01-01'}, produto: {prazoValidadeMeses: 12}, quantidade: 100});
assert.equal(semPeso.pesoKg, 0);
assert.match(semPeso.faltas.find((f) => f.campo === 'pesoKg').onde, /Kg por caixa/);

// ── Vencido: o campo CERTO (era a trava que nunca disparava) ────────────────
assert.equal(D.validadeDoLote({dataValidade: '2026-05-05'}), '2026-05-05');
assert.equal(D.validadeDoLote({validade: '2026-05-05'}), '2026-05-05', 'aceita o nome antigo também');
assert.equal(D.validadeDoLote({dataValidade: '2026-05-05T10:00:00Z'}), '2026-05-05');
assert.equal(D.validadeDoLote({}), '');
assert.equal(D.validadeDoLote(null), '');
assert.equal(D.vencido({dataValidade: '2026-10-22'}, '2026-10-23'), true);
assert.equal(D.vencido({dataValidade: '2026-10-23'}, '2026-10-23'), false, 'vence NO dia ainda vale');
assert.equal(D.vencido({dataValidade: '2026-10-24'}, '2026-10-23'), false);
assert.equal(D.vencido({}, '2026-10-23'), false, 'sem validade não é vencido');
assert.equal(D.vencido({dataValidade: '2026-01-01'}, ''), false, 'sem hoje não julga');

// ── validarCarga: o bloqueio agrupado por cadastro ─────────────────────────
const base = {
  estoque_lotes: {
    MRARBS12: {
      p1: {itemCodigo: 'MRARBS12', itemNome: 'BODY SPLASH', opLote: '26282/03', opKey: 'op1', identificadorPalete: 'PAL-1',
        caixasFechadas: 37, unidadesCaixaParcial: 16, unidadesPorCaixa: 48, qtdOriginal: 1792, saldoLote: 1792}
    },
    DPGLBS03: {
      p2: {itemCodigo: 'DPGLBS03', itemNome: 'DEO', opLote: '26258/02', opKey: 'op2', identificadorPalete: 'PAL-2',
        caixasFechadas: 34, unidadesCaixaParcial: 18, unidadesPorCaixa: 60, qtdOriginal: 2058, saldoLote: 2058},
      p3: {itemCodigo: 'DPGLBS03', itemNome: 'DEO', opLote: '26258/03', opKey: 'op2', identificadorPalete: 'PAL-3',
        caixasFechadas: 43, unidadesCaixaParcial: 53, unidadesPorCaixa: 60, qtdOriginal: 2633, saldoLote: 2633}
    },
    VELHO: {
      p4: {itemCodigo: 'VELHO', opLote: '26100/01', opKey: 'op1', identificadorPalete: 'PAL-4', dataValidade: '2026-01-01',
        caixasFechadas: 1, unidadesCaixaParcial: 0, unidadesPorCaixa: 10, qtdOriginal: 10, saldoLote: 10}
    }
  },
  ops: {op1: {lote: '26282/03', dataFimReal: '2026-10-14T19:59:00Z'}, op2: {lote: '26258/02', dataFimReal: '2026-09-22T10:00:00Z'}},
  produtos: {
    a: {sku: 'MRARBS12', prazoValidadeMeses: 36, kgCaixa: 11.7, unCx: 48},
    b: {sku: 'DPGLBS03', unCx: 60},          // sem prazo E sem kg/caixa — o caso real
    c: {sku: 'VELHO', prazoValidadeMeses: 1, kgCaixa: 1}
  }
};
const paletes = [
  {itemKey: 'MRARBS12', loteKey: 'p1', quantidade: 1792},
  {itemKey: 'DPGLBS03', loteKey: 'p2', quantidade: 2058},
  {itemKey: 'DPGLBS03', loteKey: 'p3', quantidade: 2633}
];
const v = D.validarCarga(paletes, base, '2026-10-23');
assert.equal(v.ok, false, 'a carga trava');
assert.equal(v.itens.length, 3);
assert.equal(v.pendencias.length, 2, 'os dois paletes de DPGLBS03');
// O item completo sai inteiro.
const ok1 = v.itens.find((i) => i.lote === '26282/03');
assert.equal(ok1.completo, true);
assert.equal(ok1.dataFabricacao, '2026-10-14');
assert.equal(ok1.validade, '2029-10-14');
assert.equal(ok1.volumes, 38);
// AGRUPADO POR CADASTRO: 2 paletes do mesmo SKU são 2 cadastros a corrigir
// (validade e peso), não 4 problemas soltos.
assert.equal(v.porCadastro.length, 2, 'validade e peso do DPGLBS03: ' + JSON.stringify(v.porCadastro.map((x) => x.sku + '/' + x.campo)));
const cadVal = v.porCadastro.find((x) => x.campo === 'validade');
assert.equal(cadVal.sku, 'DPGLBS03');
assert.deepEqual(cadVal.paletes.sort(), ['PAL-2', 'PAL-3'], 'nomeia os paletes afetados');
assert.ok(v.porCadastro.some((x) => x.campo === 'pesoKg' && x.sku === 'DPGLBS03'));
// Totais da carga
assert.equal(v.totalUnidades, 1792 + 2058 + 2633);
assert.equal(v.totalVolumes, 38 + 35 + 44);
// Carga só com item completo passa.
const so1 = D.validarCarga([paletes[0]], base, '2026-10-23');
assert.equal(so1.ok, true);
assert.equal(so1.pendencias.length, 0);
assert.equal(so1.totalPesoKg, 444.6);
// Vencido é apontado (com o campo certo, agora dispara).
const comVencido = D.validarCarga([{itemKey: 'VELHO', loteKey: 'p4', quantidade: 10}], base, '2026-10-23');
assert.equal(comVencido.vencidos.length, 1, 'palete vencido é detectado');
assert.equal(comVencido.vencidos[0].identificadorPalete, 'PAL-4');
// Carga vazia e base vazia não quebram.
assert.equal(D.validarCarga([], base, '2026-10-23').ok, true);
assert.equal(D.validarCarga(null, null, '2026-10-23').itens.length, 0);
// Palete apontando para lote que não existe: falta, não exceção.
const fantasma = D.validarCarga([{itemKey: 'NAO', loteKey: 'EXISTE', quantidade: 5, sku: ''}], base, '2026-10-23');
assert.equal(fantasma.ok, false);
assert.ok(fantasma.pendencias[0].faltas.some((f) => f.campo === 'sku'));

// ── skusAConfigurar: a fila que evita o bloqueio no balcão ─────────────────
const fila = D.skusAConfigurar(base);
assert.ok(fila.some((x) => x.sku === 'DPGLBS03'), 'aponta o SKU que vai travar');
const dp = fila.find((x) => x.sku === 'DPGLBS03');
assert.deepEqual(dp.faltam.sort(), ['kg por caixa', 'prazo de validade']);
assert.equal(dp.lotes, 2, 'conta os lotes afetados');
assert.equal(dp.unidades, 2058 + 2633, 'e as unidades paradas, para priorizar');
assert.ok(!fila.some((x) => x.sku === 'MRARBS12'), 'SKU completo não entra na fila');
// Lote sem saldo não entra: não vai sair, não trava nada.
const semSaldo = {estoque_lotes: {X: {p: {itemCodigo: 'X', opLote: '1', saldoLote: 0}}}, produtos: {}};
assert.deepEqual(D.skusAConfigurar(semSaldo), []);
// Material recebido (sem OP) não é PA e fica de fora.
const recebido = {estoque_lotes: {M: {p: {itemCodigo: 'M', saldoLote: 10, recebimento: true}}}, produtos: {}};
assert.deepEqual(D.skusAConfigurar(recebido), []);
assert.deepEqual(D.skusAConfigurar(null), []);

// ── Robustez: nada de exceção com entrada torta ────────────────────────────
assert.equal(D.derivar(null).completo, false);
assert.equal(D.derivar({}).dataFabricacao, '');
assert.equal(D.derivar({lote: 'texto'}).sku, '');

// ── A TRAVA REAL de expedicao.js volta a disparar ───────────────────────────
/* Isto e o que nenhum teste cobria: `analisar` recusava palete vencido lendo
   `lote.validade`, que nunca existiu. run_expedicao_test.js passava antes e
   depois da correcao -- prova de que o caminho nao era exercitado.
   Palete vencido na trava real, agora pelo campo `dataValidade`. */
const EXP = require(path.join(__dirname, 'public', 'shared', 'expedicao.js'));

function basePalete(extra) {
  return {
    estoque_lotes: {SKU1: {L1: Object.assign({
      itemTipo: 'produto', origemTipo: 'conferencia_pa', identificadorPalete: 'PAL-9',
      saldoLote: 100, status: 'LIBERADO_EXPEDICAO', qualidade: {decisao: 'LIBERADO_EXPEDICAO'},
      itemCodigo: 'SKU1', opKey: 'OP1', enderecoKey: 'E1',
      conferencia: {finalizacaoId: 'f1'}, skuPedidoKey: 'PED__SKU1'
    }, extra || {})}},
    ops: {OP1: {status: 'Concluído', sku: 'SKU1', skuPedidoKey: 'PED__SKU1'}},
    pedidos: {'PED__SKU1': {id: 'PED', parentPedidoId: 'PED'}},
    pedidos_comerciais: {PED: {itens: {}}},
    conferencias_pa: {OP1: {finalizadoEm: '2026-01-01', finalizacaoId: 'f1'}},
    enderecos_estoque: {E1: {ativo: true}},
    produtos: {}
  };
}
// Sem validade: passa (nao e vencido).
const semVal2 = EXP.analisar(basePalete({}), 'SKU1', 'L1', '2026-10-23');
assert.notEqual(semVal2.motivo, 'Palete vencido');
// Vencido gravado no campo CERTO: agora barra. Antes da correcao passava.
const vencido2 = EXP.analisar(basePalete({dataValidade: '2026-10-01'}), 'SKU1', 'L1', '2026-10-23');
assert.equal(vencido2.motivo, 'Palete vencido', 'dataValidade no passado tem de barrar');
assert.ok(!vencido2.disponivel, 'e nao fica disponivel para carga');
// Vence hoje ainda vale.
assert.notEqual(EXP.analisar(basePalete({dataValidade: '2026-10-23'}), 'SKU1', 'L1', '2026-10-23').motivo, 'Palete vencido');
// Validade futura vale.
assert.notEqual(EXP.analisar(basePalete({dataValidade: '2027-01-01'}), 'SKU1', 'L1', '2026-10-23').motivo, 'Palete vencido');
// Lote legado com o nome antigo tambem barra (compatibilidade).
assert.equal(EXP.analisar(basePalete({validade: '2026-09-01'}), 'SKU1', 'L1', '2026-10-23').motivo, 'Palete vencido');
// ISO com hora nao quebra a comparacao.
assert.equal(EXP.analisar(basePalete({dataValidade: '2026-10-01T23:59:00.000Z'}), 'SKU1', 'L1', '2026-10-23').motivo, 'Palete vencido');

// FEFO: ordena pelo que vence antes, nao pelo fallback '9999'.
const baseFefo = basePalete({});
baseFefo.estoque_lotes.SKU1.L2 = Object.assign({}, baseFefo.estoque_lotes.SKU1.L1,
  {identificadorPalete: 'PAL-TARDE', dataValidade: '2027-12-01'});
baseFefo.estoque_lotes.SKU1.L3 = Object.assign({}, baseFefo.estoque_lotes.SKU1.L1,
  {identificadorPalete: 'PAL-CEDO', dataValidade: '2027-01-01'});
delete baseFefo.estoque_lotes.SKU1.L1;
const ordem = EXP.listar(baseFefo, 'PED__SKU1', '2026-10-23').map(function(x) { return x.lote.identificadorPalete; });
assert.deepEqual(ordem, ['PAL-CEDO', 'PAL-TARDE'], 'FEFO: o que vence antes sai antes — ordem veio ' + ordem.join(','));

// ── A FUNCTION que grava: trava e campos novos ──────────────────────────────
/* Testar o motor isolado nao basta -- o defeito mora na ligacao (a licao do
   `clienteKey` duplicado, no CLAUDE.md). Aqui exercita a callable de verdade. */
const {prepararFaturamento} = require(path.join(__dirname, 'functions', 'faturamento_carga.js'));

function baseFat(loteExtra, produtoExtra) {
  const lote = Object.assign({
    itemTipo: 'produto', origemTipo: 'conferencia_pa', identificadorPalete: 'PAL-1',
    saldoLote: 1792, qtdOriginal: 1792, status: 'LIBERADO_EXPEDICAO',
    qualidade: {decisao: 'LIBERADO_EXPEDICAO'}, itemCodigo: 'MRARBS12', itemNome: 'BODY SPLASH',
    opKey: 'OP1', opLote: '26282/03', enderecoKey: 'E1', conferencia: {finalizacaoId: 'f1'},
    skuPedidoKey: 'PED__MRARBS12', caixasFechadas: 37, unidadesCaixaParcial: 16, unidadesPorCaixa: 48
  }, loteExtra || {});
  return {
    usuarios: {u1: {nome: 'Marcos Souza', role: 'logistica'}},
    agendamentos_expedicao: {C1: {
      revisao: 3, status: 'AGENDADO', cliente: 'Miss Rose', tipo: 'VENDA', dataAgendada: '2026-10-24',
      paletes: [{itemKey: 'MRARBS12', loteKey: 'L1', quantidade: 1792}]
    }},
    estoque_lotes: {MRARBS12: {L1: lote}},
    ops: {OP1: {status: 'Concluído', sku: 'MRARBS12', skuPedidoKey: 'PED__MRARBS12',
      lote: '26282/03', dataFimReal: '2026-10-14T19:59:00.000Z', dataInicioReal: '2026-10-14T13:27:00.000Z'}},
    // O portao 'Pedido de origem ausente' exige sku e cliente na demanda.
    pedidos: {'PED__MRARBS12': {id: 'PED', parentPedidoId: 'PED', sku: 'MRARBS12',
      cliente: 'Miss Rose', valorUnitario: 2.7}},
    pedidos_comerciais: {PED: {numeroPedidoCliente: '28', itens: {a: {sku: 'MRARBS12', valorUnitario: 2.7}}}},
    conferencias_pa: {OP1: {finalizadoEm: '2026-10-15', finalizacaoId: 'f1'}},
    enderecos_estoque: {E1: {ativo: true}},
    produtos: {p1: Object.assign({sku: 'MRARBS12', descricao: 'BODY SPLASH', prazoValidadeMeses: 36, kgCaixa: 11.7, unCx: 48}, produtoExtra || {})}
  };
}
const pedir = (base) => prepararFaturamento(base, {agendaKey: 'C1', revisao: 3, acao: 'SOLICITAR', solicitacaoId: 's1'},
  'Marcos Souza', 'u1', '2026-10-23T14:28:17.284Z');

// Completo: passa e carrega o que faltava.
const plano = pedir(baseFat());
const it = plano.solicitacao.itens[0];
assert.equal(it.sku, 'MRARBS12');
assert.equal(it.lote, '26282/03');
assert.equal(it.dataFabricacao, '2026-10-14', 'fabricacao agora VAI na solicitacao');
assert.equal(it.validade, '2029-10-14', 'e a validade deixa de sair vazia');
assert.equal(it.caixas, 37);
assert.equal(it.caixaParcial, 16);
assert.equal(it.caixasParciais, 1);
assert.equal(it.volumes, 38);
assert.equal(it.unidadesPorCaixa, 48);
assert.equal(it.pesoKg, 444.6);
assert.equal(it.origensNF.dataFabricacao, 'OP (fim real)', 'a procedencia da data fica gravada');
assert.deepEqual(it.faltasNF, []);
// Totais da carga, inclusive volumes (o que o transportador conta na doca).
assert.equal(plano.solicitacao.totalVolumes, 38);
assert.equal(plano.solicitacao.totalCaixasFechadas, 37);
assert.equal(plano.solicitacao.totalCaixasParciais, 1);
assert.equal(plano.solicitacao.totalPesoKg, 444.6);
assert.equal(plano.solicitacao.totalUnidades, 1792);

// SEM prazo de validade no cadastro: TRAVA, e a mensagem diz o SKU e o palete.
assert.throws(() => pedir(baseFat({}, {prazoValidadeMeses: null})), (err) => {
  assert.match(err.message, /Falta dado obrigat/);
  assert.match(err.message, /MRARBS12/, 'nomeia o SKU');
  assert.match(err.message, /Validade/);
  assert.match(err.message, /PAL-1/, 'nomeia o palete');
  assert.match(err.message, /Complete o cadastro do produto/, 'diz o que fazer');
  return true;
}, 'sem prazo de validade a solicitacao tem de travar');

// SEM kg/caixa: trava pelo peso.
assert.throws(() => pedir(baseFat({}, {kgCaixa: null})), /Peso/);
// SEM fim real da OP nem emissao: trava pela fabricacao.
const semOp = baseFat();
delete semOp.ops.OP1.dataFimReal;
delete semOp.ops.OP1.dataInicioReal;
assert.throws(() => pedir(semOp), /Data de fabrica/);
// Validade gravada no lote dispensa o cadastro.
const comVal = pedir(baseFat({dataValidade: '2028-01-31'}, {prazoValidadeMeses: null}));
assert.equal(comVal.solicitacao.itens[0].validade, '2028-01-31');
assert.equal(comVal.solicitacao.itens[0].origensNF.validade, 'lote');
// Peso gravado no lote dispensa o kg/caixa.
assert.equal(pedir(baseFat({pesoTotalKg: 430.5}, {kgCaixa: null})).solicitacao.itens[0].pesoKg, 430.5);
// Solicitacao repetida continua idempotente (nao e regressao minha).
const b2 = baseFat();
b2.agendamentos_expedicao.C1.faturamento = {solicitacoes: {s1: {id: 's1'}}};
assert.equal(pedir(b2).repetida, true);

console.log('run_dados_nf_test: OK');
