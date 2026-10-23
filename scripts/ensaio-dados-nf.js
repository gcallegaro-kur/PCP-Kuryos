'use strict';
/* Ensaio dos dados obrigatórios da NF contra a base REAL. SOMENTE LEITURA.
 *
 * Lição do MRP (CLAUDE.md): o ensaio com dados reais achou dois defeitos que
 * 46 asserções sintéticas não pegaram. Aqui roda `validarCarga` em TODAS as
 * cargas ativas e `skusAConfigurar` no estoque inteiro, e refaz a solicitação
 * de faturamento já enviada, para comparar o que saiu com o que sairia agora.
 *
 * Uso: node scripts/ensaio-dados-nf.js */
const path = require('path');
const root = path.resolve(__dirname, '..');
const admin = require(path.join(root, 'functions/node_modules/firebase-admin'));
admin.initializeApp({
  credential: admin.credential.cert(require(path.join(root, 'firebase-service-account.json'))),
  databaseURL: 'https://prod-kuryos-default-rtdb.firebaseio.com',
});
const D = require(path.join(root, 'public/shared/dados-nf.js'));
const hoje = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'});
const d = (v) => (v ? String(v).split('-').reverse().join('/') : '—');

(async () => {
  const get = async (n) => (await admin.database().ref(n).once('value')).val() || {};
  const base = {
    estoque_lotes: await get('estoque_lotes'),
    ops: await get('ops'),
    produtos: await get('produtos'),
  };
  const agendas = await get('agendamentos_expedicao');

  console.log('— Fila de cadastro (SKUs com estoque que travariam o faturamento) —');
  const fila = D.skusAConfigurar(base);
  if (!fila.length) console.log('   nenhum');
  fila.forEach((x) => console.log('   ' + x.sku.padEnd(18) + x.faltam.join(' e ').padEnd(34) +
    x.lotes + ' lote(s), ' + x.unidades.toLocaleString('pt-BR') + ' un paradas'));
  const totalParado = fila.reduce((t, x) => t + x.unidades, 0);
  console.log('   >> ' + fila.length + ' SKU(s), ' + totalParado.toLocaleString('pt-BR') + ' unidades afetadas');

  console.log('\n— Cargas ativas: passariam ou travariam? —');
  const ativas = Object.keys(agendas).filter((k) => ['AGENDADO', 'EXPEDIDO_PARCIAL'].includes((agendas[k] || {}).status));
  if (!ativas.length) console.log('   nenhuma carga ativa');
  let passam = 0, travam = 0;
  ativas.forEach((k) => {
    const a = agendas[k] || {};
    const v = D.validarCarga(a.paletes || [], base, hoje);
    if (v.ok) passam++; else travam++;
    console.log('   ' + (v.ok ? 'PASSA ' : 'TRAVA ') + String(a.cliente || '?').padEnd(22) +
      (a.paletes || []).length + ' palete(s) · ' + v.totalVolumes + ' volumes · ' + v.totalPesoKg + ' kg' +
      (v.vencidos.length ? ' · ' + v.vencidos.length + ' VENCIDO(S)' : ''));
    v.porCadastro.forEach((c) => console.log('        falta: ' + c.sku + ' — ' + c.rotulo + ' (palete ' + c.paletes.join(', ') + ')'));
    v.pendencias.forEach((i) => i.faltas.filter((f) => !f.sku).forEach((f) =>
      console.log('        falta: palete ' + i.identificadorPalete + ' — ' + f.rotulo)));
  });
  console.log('   >> ' + passam + ' passariam, ' + travam + ' travariam');

  console.log('\n— Solicitações JÁ enviadas: o que saiu x o que sairia agora —');
  let comparadas = 0;
  Object.keys(agendas).forEach((k) => {
    const a = agendas[k] || {};
    const sols = Object.values(((a.faturamento || {}).solicitacoes) || {});
    if (!sols.length) return;
    const sol = sols[sols.length - 1];
    const v = D.validarCarga(a.paletes || [], base, hoje);
    comparadas++;
    console.log('\n   carga ' + String(a.cliente || k).padEnd(20) + ' solicitada em ' + String(sol.em || '').slice(0, 10));
    (sol.itens || []).forEach((i) => {
      const agora = v.itens.find((x) => x.itemKey === i.itemKey && x.loteKey === i.loteKey) || {};
      console.log('      ' + String(i.sku || '?').padEnd(16) + 'lote ' + String(i.lote || '-').padEnd(12));
      console.log('         fabricacao: enviado ' + d(i.dataFabricacao).padEnd(12) + ' -> agora ' + d(agora.dataFabricacao) +
        (agora.origens && agora.origens.dataFabricacao ? '  (' + agora.origens.dataFabricacao + ')' : ''));
      console.log('         validade  : enviado ' + d(i.validade).padEnd(12) + ' -> agora ' + d(agora.validade) +
        (agora.origens && agora.origens.validade ? '  (' + agora.origens.validade + ')' : ''));
      console.log('         volumes   : enviado ' + String(i.volumes == null ? '—' : i.volumes).padEnd(12) + ' -> agora ' + agora.volumes +
        '   (' + agora.caixasFechadas + ' fechadas + ' + agora.caixasParciais + ' parcial)');
    });
  });
  if (!comparadas) console.log('   nenhuma solicitação para comparar');

  // Paletes vencidos que a trava quebrada deixava passar.
  console.log('\n— Paletes com saldo e VENCIDOS (a trava quebrada deixava sair) —');
  let venc = 0;
  Object.keys(base.estoque_lotes).forEach((item) => {
    const filhos = base.estoque_lotes[item] || {};
    Object.keys(filhos).forEach((lk) => {
      const l = filhos[lk];
      if (!l || typeof l !== 'object' || !(Number(l.saldoLote) > 0)) return;
      if (!D.vencido(l, hoje)) return;
      venc++;
      console.log('   ' + String(l.itemCodigo || '?').padEnd(16) + 'lote ' + String(l.opLote || lk).padEnd(14) +
        'venceu ' + d(D.validadeDoLote(l)) + ' · saldo ' + Number(l.saldoLote).toLocaleString('pt-BR'));
    });
  });
  if (!venc) console.log('   nenhum (nenhum lote com saldo tem validade no passado)');
  process.exit(0);
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
