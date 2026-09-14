'use strict';
/* Ensaio do motor de custo contra a BASE REAL de produção. SOMENTE LEITURA.
 *
 * Por que existe separado de run_custos_test.js: a lição do MRP. Lá, 46
 * asserções sintéticas passaram e dois defeitos só apareceram com dado de
 * verdade. Aqui aconteceu de novo -- os 97 testes do motor passavam enquanto
 * a fila de cadastro otimizava a métrica errada, e só a base real mostrou.
 *
 * Este script NÃO escreve nada. Roda o motor inteiro sobre os produtos,
 * fórmulas e BOMs reais e FALHA (exit 1) se achar número inválido ou ficha
 * com total sem preço cadastrado.
 *
 * Uso:  node run_custos_ensaio.js
 * Exige firebase-service-account.json na raiz (fora do git, por .gitignore).
 */
const path = require('path');
const Module = require('module');
// firebase-admin mora em functions/node_modules; a raiz do repo não tem
// node_modules próprio e não vale a pena criar um só para este ensaio.
Module.globalPaths.push(path.join(__dirname, 'functions', 'node_modules'));
let admin;
try {
  admin = require(path.join(__dirname, 'functions', 'node_modules', 'firebase-admin'));
} catch (e) {
  console.error('firebase-admin não encontrado. Rode `npm install` dentro de functions/.');
  process.exit(1);
}
let sa;
try {
  sa = require(path.join(__dirname, 'firebase-service-account.json'));
} catch (e) {
  console.error('firebase-service-account.json não encontrado na raiz do repo.');
  process.exit(1);
}
const C = require('./public/shared/custos');

admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: 'https://prod-kuryos-default-rtdb.firebaseio.com',
});

const norm = (c) => String(c == null ? '' : c).trim().toUpperCase();
const n = (o) => (o && typeof o === 'object') ? Object.keys(o).length : 0;
const falhas = [];
function checa(cond, msg) { if (!cond) falhas.push(msg); }

(async () => {
  const root = (await admin.database().ref('/').once('value')).val() || {};
  const materiais = root.materiais || {};
  const produtos = root.produtos || {};
  const ops = root.ops || {};
  const idx = C.indexarMateriais(materiais);

  // Fórmula: a de MAIOR versão por produto. BOM: chaveado por sku|versao.
  const formulaPorSku = {}, bomPorSku = {};
  Object.values(root.formulas || {}).forEach((f) => {
    const sku = norm(f && f.codProduto);
    if (!sku || !f.itens) return;
    const atual = formulaPorSku[sku];
    if (!atual || Number(f.versao || 0) >= Number(atual.versao || 0)) formulaPorSku[sku] = f;
  });
  Object.entries(root.bom || {}).forEach(([k, b]) => {
    const sku = norm(String(k).split(/[|_]/)[0]);
    if (sku && b && b.itens) bomPorSku[sku] = b;
  });

  // Volume real dos últimos 12 meses, por SKU -- é o peso do plano de cadastro.
  const corte = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const volumePorSku = {};
  Object.values(ops).forEach((o) => {
    if (!o || !o.dataInicioReal || String(o.dataInicioReal) < corte) return;
    const q = Number(o.produzido) || 0;
    const sku = norm(o.sku);
    if (q > 0 && sku) volumePorSku[sku] = (volumePorSku[sku] || 0) + q;
  });

  console.log('Base: ' + n(materiais) + ' materiais, ' + n(produtos) + ' produtos, ' +
    n(formulaPorSku) + ' fórmulas, ' + n(bomPorSku) + ' BOMs, ' + n(volumePorSku) + ' SKUs produzidos desde ' + corte);

  const precosReais = root.custos_precos || {};
  console.log('Preços cadastrados hoje: ' + n(precosReais));

  function numerosDaFicha(f) {
    return [f.granel.custoPorKg, f.granel.custoPorPeca, f.granel.pctCobertoMM,
      f.embalagem.custoPorPeca, f.custoMaterialPorPeca, f.custoUnitario];
  }
  function rodarTodas(precos, taxa) {
    let invalidos = 0, comTotal = 0, comKg = 0, comPeca = 0, completas = 0;
    const motivos = {};
    Object.entries(produtos).forEach(([key, p]) => {
      const sku = norm(p.sku || key);
      const f = C.fichaCustoProduto({
        produto: p, formula: formulaPorSku[sku], bom: bomPorSku[sku],
        idxMateriais: idx, precos: precos, taxaConversao: taxa,
      });
      numerosDaFicha(f).forEach((v) => {
        if (v != null && (!Number.isFinite(v) || v < 0)) invalidos++;
      });
      if (f.custoUnitario != null) comTotal++;
      if (f.granel.custoPorKg != null) comKg++;
      if (f.granel.custoPorPeca != null) comPeca++;
      if (f.materialCompleto) completas++;
      f.granel.incompativeis.concat(f.embalagem.incompativeis).forEach((l) => {
        const m = (l.motivo || '—').slice(0, 60);
        motivos[m] = (motivos[m] || 0) + 1;
      });
    });
    return { invalidos, comTotal, comKg, comPeca, completas, motivos };
  }

  // ── 1. Base como está: sem preço nenhum, nada pode ter total ──
  console.log('\n── Cenário 1: com os preços REAIS de hoje ──');
  const r1 = rodarTodas(precosReais, null);
  console.log('  números inválidos (NaN/Infinity/negativo): ' + r1.invalidos);
  console.log('  fichas com custo unitário: ' + r1.comTotal);
  console.log('  fichas com custo do kg de fórmula: ' + r1.comKg);
  checa(r1.invalidos === 0, 'Cenário 1 produziu ' + r1.invalidos + ' números inválidos');
  if (n(precosReais) === 0) {
    checa(r1.comTotal === 0, 'Sem preço cadastrado nenhuma ficha pode ter custo unitário, e ' +
      r1.comTotal + ' tiveram — é o bug de "sem preço virou zero"');
  }

  // ── 2. Preço sintético em tudo: exercita a conta em todos os produtos ──
  console.log('\n── Cenário 2: R$ 10,00 na unidade de cadastro de TODOS os materiais ──');
  const fake = {};
  Object.entries(materiais).forEach(([k, m]) => { fake[k] = { valor: 10, unidade: m.unidade, fonte: 'MANUAL' }; });
  const r2 = rodarTodas(fake, { custoHoraPadrao: 500, procedencia: 'ESTIMADO' });
  console.log('  números inválidos: ' + r2.invalidos);
  console.log('  com custo do kg: ' + r2.comKg + ' | com granel por peça: ' + r2.comPeca +
    '  (a diferença é a densidade faltando)');
  console.log('  com material 100% completo: ' + r2.completas);
  console.log('  linhas recusadas por unidade/quantidade:');
  Object.entries(r2.motivos).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .forEach(([m, c]) => console.log('    ' + String(c).padStart(4) + 'x  ' + m));
  checa(r2.invalidos === 0, 'Cenário 2 produziu ' + r2.invalidos + ' números inválidos');
  checa(r2.comKg > 0, 'Com preço em tudo, alguma fórmula tinha que custear e nenhuma custeou');

  // ── 3. Plano de cadastro: em que ordem digitar preço ──
  console.log('\n── Cenário 3: plano de cadastro (fecha ficha, não persegue exposição) ──');
  const plano = C.planoCadastroPorSku({
    volumePorSku, formulaPorSku, bomPorSku, idxMateriais: idx, precos: precosReais,
  });
  console.log('  SKUs planejáveis: ' + plano.skusFechados.length +
    ' | bloqueados por material fora do cadastro: ' + plano.bloqueadosPorCadastro.length);
  console.log('  preços para fechar todos: ' + plano.precosNecessarios);
  [25, 50, 75, 90].forEach((alvo) => {
    console.log('  para fechar ' + String(alvo).padStart(2) + '% do volume: ' +
      String(C.precosParaVolume(plano.marcos, alvo)).padStart(4) + ' preços');
  });
  console.log('  próximos 10 preços a digitar, na ordem:');
  plano.sequencia.slice(0, 10).forEach((s, i) => {
    console.log('   ' + String(i + 1).padStart(3) + '. ' + s.codigo.padEnd(12) +
      String(s.unidade || '—').padEnd(5) + String(s.natureza).padEnd(15) + String(s.nome || '').slice(0, 40));
  });
  const codigos = plano.sequencia.map((s) => s.codigo);
  checa(codigos.length === new Set(codigos).size, 'A sequência repetiu material — preço compartilhado contado duas vezes');
  if (plano.marcos.length) {
    checa(plano.marcos[plano.marcos.length - 1].volumeCobertoPct <= 100.0001,
      'Cobertura do plano passou de 100%');
  }

  // ── 4. Fila por exposição: as somas têm que fechar ──
  console.log('\n── Cenário 4: fila por exposição (a outra pergunta) ──');
  const fila = C.filaPrecosPorExposicao({
    volumePorSku, formulaPorSku, bomPorSku, idxMateriais: idx, precos: precosReais,
  });
  const soma = fila.fila.reduce((s, f) => s + f.exposicaoPct, 0);
  console.log('  materiais na fila: ' + fila.totalMateriais + ' | com preço: ' + fila.comPreco +
    ' | cobertura de exposição: ' + fila.coberturaPct.toFixed(1) + '%');
  console.log('  soma das exposições: ' + soma.toFixed(4) + '% (tem que ser 100)');
  if (fila.totalMateriais > 0) {
    checa(Math.abs(soma - 100) < 0.01, 'A soma das exposições deu ' + soma.toFixed(4) + '%, não 100%');
  }

  // ── 5. Densidades faltando: o gargalo do custo POR UNIDADE ──
  console.log('\n── Cenário 5: densidades que faltam ──');
  const comFormula = Object.keys(volumePorSku).filter((s) => formulaPorSku[s]);
  const semDens = [];
  comFormula.forEach((sku) => {
    const p = Object.values(produtos).find((x) => norm(x.sku) === sku);
    if (!p) return;
    const m = C.massaGranelPorPeca(p);
    if (!m.ok) semDens.push({ sku, vol: volumePorSku[sku], motivo: m.motivo });
  });
  semDens.sort((a, b) => b.vol - a.vol);
  console.log('  SKUs com fórmula e produção que NÃO convertem kg→peça: ' + semDens.length + ' de ' + comFormula.length);
  console.log('  volume afetado: ' + Math.round(semDens.reduce((s, x) => s + x.vol, 0)).toLocaleString('pt-BR') + ' un');
  semDens.slice(0, 6).forEach((x) => console.log('    ' + x.sku.padEnd(14) +
    String(Math.round(x.vol)).padStart(8) + ' un — ' + x.motivo));

  console.log('');
  if (falhas.length) {
    console.error('ENSAIO REPROVADO:');
    falhas.forEach((f) => console.error('  ✗ ' + f));
    process.exit(1);
  }
  console.log('OK ensaio de custos: motor rodou sobre a base real sem número inválido, ' +
    'sem total sobre ficha sem preço, e com as somas do plano fechando.');
  process.exit(0);
})().catch((e) => { console.error('ERR', e && e.stack); process.exit(1); });
