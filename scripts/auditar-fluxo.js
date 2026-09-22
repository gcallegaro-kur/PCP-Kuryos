'use strict';
/* AUDITORIA DE FLUXO — ponta a ponta, contra a base real.

   SOMENTE LEITURA. Não escreve nada, em lugar nenhum.

   Percorre a cadeia pedido → programação → OP → separação → manipulação →
   análise de granel → envase → conferência de PA → qualidade → expedição,
   e em cada elo conta o que NÃO atravessou. A lição que o repo já registra
   (CLAUDE.md, seção do MRP) é que o ensaio com dado real acha defeito que
   asserção sintética não acha -- por isso a auditoria olha a base, não um
   cenário montado.

   Cada achado traz: quantos, e até 3 exemplos concretos para conferir na
   tela. Número sem exemplo não vira ação.

   Uso:  node "<caminho>/scripts/auditar-fluxo.js"
         (não depende do diretório atual; PowerShell não precisa de cd) */
const path = require('path');
const root = path.resolve(__dirname, '..');
const admin = require(path.join(root, 'functions/node_modules/firebase-admin'));

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(root, 'firebase-service-account.json'))),
  databaseURL: 'https://prod-kuryos-default-rtdb.firebaseio.com',
});

const DIAS = (iso) => {
  const t = Date.parse(iso);
  return isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null;
};
const vivo = (op) => op && !['Concluído', 'Cancelado', 'Aguardando Confirmação'].includes(op.status);

/* CORTES PROSPECTIVOS. Sem isto a auditoria grita 1.311 "gaps" que são só
   história: OP de antes do módulo existir nunca teve como preencher o
   campo. O repo já aprendeu isso na Conferência de PA, que adotou corte em
   2026-09-10 justamente para não transformar 1.251 OPs antigas em
   pendências falsas (ver CLAUDE.md / AGENT_STATUS).

   Regra: só conta como gap o que foi emitido DEPOIS de o módulo existir. */
const CORTE = {
  conferenciaPa: '2026-09-10',   // WMS/Conferência de PA em produção
  manipulacao: '2026-09-18',     // apontamento de manipulação/granel publicado
};
const depoisDe = (op, corte) => String(op.dataEmissao || '') >= corte;
const ex = (lista, n) => lista.slice(0, n || 3);

const achados = [];
function gap(elo, titulo, itens, detalhe) {
  if (!itens.length) return;
  achados.push({elo, titulo, quantos: itens.length, exemplos: ex(itens), detalhe: detalhe || ''});
}

(async () => {
  const base = (await admin.database().ref().get()).val() || {};
  const ops = base.ops || {};
  const pedidos = base.pedidos || {};
  const especs = base.especificacoes || {};
  const lotes = base.estoque_lotes || {};
  const estoque = base.estoque || {};
  const materiais = base.materiais || {};
  const produtos = base.produtos || {};
  const estadoLinhas = base.estado_linhas || {};
  const rncs = base.nao_conformidades || {};

  const opsVivas = Object.entries(ops).filter(([, o]) => vivo(o));
  const opsTodas = Object.entries(ops);

  // ── 1. Pedido → OP ──────────────────────────────────────────────────
  gap('1. Pedido → OP',
    'OP aberta sem vínculo com pedido comercial',
    opsVivas.filter(([, o]) => !o.skuPedidoKey && o.tipoOrdem !== 'RETRABALHO')
      .map(([k, o]) => k + ' (' + (o.produto || o.sku || '?') + ')'),
    'Sem skuPedidoKey a produção não credita pedido nenhum. Retrabalho é exceção legítima; o resto é OP avulsa ou vínculo perdido.');

  /* O campo é `qtdTotal` -- a primeira versão desta auditoria usava
     `quantidade`, não existia, e o check devolvia zero em silêncio.
     Verificação que não acha nada por nome de campo errado é pior que
     verificação nenhuma: passa a impressão de que o elo está saudável. */
  const pedidosComSaldo = Object.entries(pedidos).filter(([, p]) => {
    const total = Number(p.qtdTotal || 0);
    return total > 0 && Number(p.produzido || 0) < total &&
      p.status !== 'Cancelado' && p.status !== 'Concluído';
  });
  const pedidosComOp = new Set(opsTodas.map(([, o]) => o.skuPedidoKey).filter(Boolean));
  gap('1. Pedido → OP',
    'Pedido com saldo e NENHUMA OP emitida',
    pedidosComSaldo.filter(([k]) => !pedidosComOp.has(k)).map(([k, p]) => k + ' (' + (p.produto || p.sku || '?') + ')'),
    'Demanda aceita que ainda não virou ordem. É a fila que o MRP e a programação deveriam estar puxando.');

  // ── 2. Cadastro técnico → OP ────────────────────────────────────────
  const skuDoProduto = {};
  Object.entries(produtos).forEach(([k, p]) => { if (p && p.sku) skuDoProduto[p.sku] = k; });
  gap('2. Cadastro → OP',
    'OP viva de produto SEM especificação de qualidade cadastrada',
    opsVivas.filter(([, o]) => {
      const pk = skuDoProduto[o.sku];
      if (!pk || !o.formulaVersao) return false;
      const reg = especs[pk + '__' + o.formulaVersao];
      return !reg || !Object.keys(reg.itens || {}).length;
    }).map(([k, o]) => k + ' (' + (o.sku || '?') + ' ' + (o.formulaVersao || '') + ')'),
    'A ficha físico-química sai sem parâmetro e a Qualidade não tem contra o que julgar o lote.');

  // ── 3. OP → separação/estoque ───────────────────────────────────────
  const materiaisComSaldo = Object.keys(estoque).length;
  const negativos = Object.entries(estoque).filter(([, e]) => Number(e.saldoAtual || 0) < 0)
    .map(([k, e]) => k + ' (' + e.saldoAtual + ')');
  gap('3. Estoque',
    'Material com saldo NEGATIVO',
    negativos,
    'Saída sem entrada correspondente. Saldo negativo não existe no físico -- é sintoma de recebimento que nunca foi lançado.');
  achados.push({elo: '3. Estoque', titulo: 'Cobertura do saldo',
    quantos: materiaisComSaldo, exemplos: [],
    detalhe: materiaisComSaldo + ' de ' + Object.keys(materiais).length + ' materiais têm registro de saldo. ' +
      'Enquanto a maioria estiver sem, saldo não serve para decidir compra nem emissão.'});

  // ── 4. OP → manipulação → análise de granel ─────────────────────────
  const comProducao = opsTodas.filter(([, o]) => (o.produzidoLinha || o.produzido || 0) > 0 && o.tipoOrdem !== 'RETRABALHO');
  gap('4. Granel → envase',
    'OP emitida DEPOIS de ' + CORTE.manipulacao + ' com envase apontado e SEM análise de granel',
    comProducao.filter(([, o]) => depoisDe(o, CORTE.manipulacao) && !(((o.manipulacao || {}).analise || {}).ensaios))
      .map(([k, o]) => k + ' (' + (o.produto || '?') + ')'),
    'O granel foi envasado sem o laudo da fase de manipulação ficar gravado. É o elo que o Dossiê do Lote mostra vazio numa auditoria.');

  gap('4. Granel → envase',
    'OP com manipulação iniciada e nunca fechada',
    opsVivas.filter(([, o]) => {
      const m = o.manipulacao || {};
      return m.pesagem && !m.analise;
    }).map(([k, o]) => k + ' (' + (o.produto || '?') + ')'),
    'Pesagem começou e o ciclo não chegou na Qualidade.');

  // ── 5. Envase → conferência de PA ───────────────────────────────────
  const paletesPorOp = {};
  Object.values(lotes).forEach((porLote) => Object.values(porLote || {}).forEach((l) => {
    if (l && l.itemTipo === 'produto' && l.opLote) {
      (paletesPorOp[l.opLote] = paletesPorOp[l.opLote] || []).push(l);
    }
  }));
  gap('5. Envase → conferência de PA',
    'OP emitida DEPOIS de ' + CORTE.conferenciaPa + ', concluída e sem NENHUM palete conferido',
    opsTodas.filter(([, o]) => o.status === 'Concluído' && (o.produzidoLinha || o.produzido || 0) > 0 &&
      o.tipoOrdem !== 'RETRABALHO' && depoisDe(o, CORTE.conferenciaPa) && !paletesPorOp[o.lote])
      .map(([k, o]) => k + ' (' + (o.produto || '?') + ', ' + (o.produzidoLinha || o.produzido) + ' un.)'),
    'Produziu e fechou, mas nada entrou no estoque de PA. O produto existe no chão e não no sistema.');

  gap('5. Envase → conferência de PA',
    'OP aguardando confirmação do PCP',
    opsTodas.filter(([, o]) => o.status === 'Aguardando Confirmação')
      .map(([k, o]) => k + ' (' + (DIAS(o.dataFimReal || o.dataEmissao) ?? '?') + ' dia(s))'),
    'O operador fechou; falta o PCP confirmar. Parado aqui, a OP não vira nada para frente.');

  // ── 6. Qualidade ────────────────────────────────────────────────────
  const emQuarentena = [];
  Object.entries(lotes).forEach(([item, porLote]) => Object.entries(porLote || {}).forEach(([lk, l]) => {
    if (l && l.status === 'QUARENTENA') {
      emQuarentena.push({item, lk, l, dias: DIAS(l.criadoEm)});
    }
  }));
  gap('6. Qualidade',
    'Lote em QUARENTENA há mais de 7 dias',
    emQuarentena.filter((q) => (q.dias ?? 0) > 7)
      .sort((a, b) => (b.dias || 0) - (a.dias || 0))
      .map((q) => q.item + ' · ' + (q.l.loteOrigem || q.lk) + ' (' + q.dias + ' dias)'),
    'Material ou palete travado esperando laudo. Em quarentena não é usado nem expedido -- é capital parado e risco de validade.');

  gap('6. Qualidade',
    'RNC aberta há mais de 15 dias',
    Object.entries(rncs).filter(([, r]) => r && r.status === 'ABERTA' && (DIAS(r.abertaEm || r.criadoEm) ?? 0) > 15)
      .map(([k, r]) => k + ' (' + (DIAS(r.abertaEm || r.criadoEm) ?? '?') + ' dias)'),
    'Não conformidade sem tratamento fechado.');

  // ── 7. Chão de fábrica: estados presos ──────────────────────────────
  gap('7. Chão de fábrica',
    'Linha parada há mais de 1 dia, com parada aberta',
    Object.entries(estadoLinhas).filter(([, e]) => e && e.status === 'parada' && (DIAS(e.inicioParada) ?? 0) >= 1)
      .map(([k, e]) => k.replace(/_/g, ' ') + ' · ' + (e.motivoParada || '?') + ' (' + (DIAS(e.inicioParada) ?? '?') + ' dias)'),
    'Parada aberta conta contra a disponibilidade todo dia que passa. Normalmente é pausa de turno que ninguém fechou.');

  gap('7. Chão de fábrica',
    'OP aberta numa linha há mais de 3 dias',
    opsVivas.filter(([, o]) => o.abertaDesde && (DIAS(o.abertaDesde) ?? 0) > 3)
      .map(([k, o]) => k + ' · ' + (o.abertaLinha || '?') + ' (' + (DIAS(o.abertaDesde) ?? '?') + ' dias)'),
    'A base do cálculo de ritmo é abertaDesde -- OP aberta há dias distorce qualquer indicador de performance.');

  // ── 8. Retrabalho ───────────────────────────────────────────────────
  const retrabalhos = opsTodas.filter(([, o]) => o.tipoOrdem === 'RETRABALHO');
  achados.push({elo: '8. Retrabalho', titulo: 'OPs de retrabalho no sistema',
    quantos: retrabalhos.length,
    exemplos: retrabalhos.map(([k, o]) => k + ' (' + o.status + ', ' + (o.produzidoLinha || 0) + '/' + (o.qtdPlanejada || 0) + ')'),
    detalhe: 'Modelo novo: OP sem pedido e sem BOM.'});
  gap('8. Retrabalho',
    'Caso no formato antigo ainda não migrado',
    Object.entries(base.retrabalhos || {}).filter(([, r]) => r && !r.migradoParaOp)
      .map(([k, r]) => k + ' (' + r.status + ')'),
    'scripts/migrar-retrabalho-para-op.js converte.');

  // ── 9. Planejamento ─────────────────────────────────────────────────
  gap('9. Planejamento',
    'OP viva SEM data planejada',
    opsVivas.filter(([, o]) => !o.dataInicioPlanejada).map(([k, o]) => k + ' (' + (o.status || '?') + ')'),
    'Sem data, a OP não entra em horizonte nem em promessa de prazo -- e o MRP joga a demanda no balde BACKLOG.');

  // ── Saída ───────────────────────────────────────────────────────────
  console.log('AUDITORIA DE FLUXO — ' + new Date().toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'}));
  console.log('Base: ' + opsTodas.length + ' OPs (' + opsVivas.length + ' vivas), ' +
    Object.keys(pedidos).length + ' pedidos, ' + Object.keys(materiais).length + ' materiais, ' +
    Object.keys(produtos).length + ' produtos.\n');
  achados.forEach((a) => {
    console.log('[' + a.elo + '] ' + a.titulo + ': ' + a.quantos);
    if (a.detalhe) console.log('   ' + a.detalhe);
    a.exemplos.forEach((e) => console.log('   · ' + e));
    console.log('');
  });
  await admin.app().delete();
})().catch((e) => { console.error(e); process.exit(1); });
