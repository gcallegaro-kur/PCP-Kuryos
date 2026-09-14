'use strict';
/* Testes do motor de custo de produto (public/shared/custos.js).
   Foco: as três coisas que fazem custo sair plausível e errado --
   (1) preço faltando virar zero, (2) conversão de unidade suposta,
   (3) total exibido sobre ficha incompleta. */
const assert = require('node:assert/strict');
const C = require('./public/shared/custos');

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { n++; assert.equal(a, b, msg); };
const perto = (a, b, msg, tol = 1e-9) => { n++; assert.ok(Math.abs(a - b) <= tol, msg + ` (esperado ${b}, veio ${a})`); };

// ── Fixture ────────────────────────────────────────────────────────────────
const materiais = {
  mpgr_00001: { mpCodigo: 'MPGR-00001', mpNome: 'ÁGUA', tipo: 'MPGR', unidade: 'KG' },
  mpgr_00002: { mpCodigo: 'MPGR-00002', mpNome: 'ÁLCOOL', tipo: 'MPGR', unidade: 'KG' },
  mpgr_00003: { mpCodigo: 'MPGR-00003', mpNome: 'ESPESSANTE', tipo: 'MPGR', unidade: 'G' },
  mpgr_00004: { mpCodigo: 'MPGR-00004', mpNome: 'GLICERINA LÍQUIDA', tipo: 'MPGR', unidade: 'L', densidade: 1.25 },
  mpgr_00005: { mpCodigo: 'MPGR-00005', mpNome: 'ÓLEO SEM DENSIDADE', tipo: 'MPGR', unidade: 'L' },
  ep_00001: { mpCodigo: 'EP-00001', mpNome: 'FRASCO 200ML', tipo: 'EP', unidade: 'UN' },
  ep_00002: { mpCodigo: 'EP-00002', mpNome: 'TAMPA', tipo: 'EP', unidade: 'UN' },
  et_00001: { mpCodigo: 'ET-00001', mpNome: 'RÓTULO', tipo: 'ET', unidade: 'UN' },
  es_00001: { mpCodigo: 'ES-00001', mpNome: 'CAIXA', tipo: 'ES', unidade: 'UN' }
};
const idx = C.indexarMateriais(materiais);

const precos = {
  mpgr_00001: { valor: 2, unidade: 'KG', fonte: 'PAGO' },
  mpgr_00002: { valor: 10, unidade: 'KG', fonte: 'COTADO' },
  mpgr_00003: { valor: 0.05, unidade: 'G', fonte: 'MANUAL' },      // 50 R$/kg
  mpgr_00004: { valor: 5, unidade: 'L', fonte: 'MANUAL' },          // 5/1,25 = 4 R$/kg
  mpgr_00005: { valor: 7, unidade: 'L', fonte: 'MANUAL' },          // sem densidade -> incompatível
  ep_00001: { valor: 1.5, unidade: 'UN', fonte: 'PAGO' },
  ep_00002: { valor: 0.4, unidade: 'UN', fonte: 'PAGO' },
  et_00001: { valor: 0.1, unidade: 'UN', fonte: 'COTADO' }
  // es_00001 (CAIXA) de propósito SEM preço
};

// ── 1. Índice e natureza ───────────────────────────────────────────────────
eq(idx['MPGR-00001'].key, 'mpgr_00001', 'índice acha material pelo mpCodigo');
eq(idx['mpgr-00001'], undefined, 'índice é normalizado em maiúsculas, busca crua não acha');
eq(C.naturezaDoMaterial(materiais.mpgr_00001), 'MATERIA_PRIMA', 'MPGR é matéria-prima');
eq(C.naturezaDoMaterial(materiais.ep_00001), 'EMBALAGEM', 'EP é embalagem');
eq(C.naturezaDoMaterial({ mpCodigo: 'ZZ-00001' }), 'OUTROS', 'prefixo desconhecido cai em OUTROS, não quebra');
eq(C.naturezaDoMaterial({ mpCodigo: 'ET-00009' }), 'EMBALAGEM', 'natureza sai do prefixo quando não há campo tipo');

// ── 2. Preço: ausência NUNCA vira zero ─────────────────────────────────────
const semPreco = C.precoDoMaterial('ES-00001', idx, precos);
eq(semPreco.valor, null, 'material sem preço devolve null, não 0');
eq(semPreco.fonte, 'SEM_CUSTO', 'e a procedência diz SEM_CUSTO');
const inexistente = C.precoDoMaterial('XX-99999', idx, precos);
eq(inexistente.valor, null, 'material fora do cadastro devolve null');
eq(inexistente.motivo, 'material não existe no cadastro', 'com motivo distinto de "sem preço"');
eq(C.precoDoMaterial('MPGR-00001', idx, { mpgr_00001: { valor: 0 } }).fonte, 'SEM_CUSTO',
  'preço gravado como 0 conta como SEM preço -- zero não é um preço válido');

// ── 3. Conversão para R$/kg: só o que converte sem supor ───────────────────
perto(C.precoPorKg(C.precoDoMaterial('MPGR-00001', idx, precos)).valor, 2, 'kg passa direto');
perto(C.precoPorKg(C.precoDoMaterial('MPGR-00003', idx, precos)).valor, 50, 'g vira kg multiplicando por 1000');
perto(C.precoPorKg(C.precoDoMaterial('MPGR-00004', idx, precos)).valor, 4, 'litro converte por densidade do material');
eq(C.precoPorKg(C.precoDoMaterial('MPGR-00005', idx, precos)).valor, null,
  'litro SEM densidade não converte -- não pode chutar 1,0');
eq(C.precoPorKg({ valor: 3, unidade: 'ROLO', material: {} }).valor, null, 'unidade exótica não converte');

// ── 4. Custo por kg de fórmula ─────────────────────────────────────────────
const formulaOk = { codProduto: 'SKU1', itens: {
  i1: { mpCodigo: 'MPGR-00001', mpNome: 'ÁGUA', percentualMM: 70, fase: 'A' },
  i2: { mpCodigo: 'MPGR-00002', mpNome: 'ÁLCOOL', percentualMM: 29, fase: 'A' },
  i3: { mpCodigo: 'MPGR-00003', mpNome: 'ESPESSANTE', percentualMM: 1, fase: 'B' }
} };
const kg = C.custoPorKgFormula(formulaOk, idx, precos);
// 0,70*2 + 0,29*10 + 0,01*50 = 1,4 + 2,9 + 0,5 = 4,8
perto(kg.custoPorKg, 4.8, 'custo do kg soma percentual x preço por kg');
ok(kg.completo, 'fórmula com todos os preços é completa');
perto(kg.pctCobertoMM, 100, 'cobertura de 100% do m/m');
perto(kg.somaPercentual, 100, 'soma percentual preservada');
eq(kg.linhas[0].fonte, 'PAGO', 'procedência carimbada linha a linha');
eq(kg.linhas[1].fonte, 'COTADO', 'procedências diferentes convivem na mesma ficha');

// O teste que mais importa: falta preço -> NÃO pode somar como zero
const formulaFalta = { itens: {
  i1: { mpCodigo: 'MPGR-00001', percentualMM: 70 },
  i2: { mpCodigo: 'ES-00001', percentualMM: 30 }   // sem preço
} };
const kgFalta = C.custoPorKgFormula(formulaFalta, idx, precos);
perto(kgFalta.custoPorKg, 1.4, 'custo parcial é só a parte conhecida (0,70 x 2)');
eq(kgFalta.completo, false, 'e a ficha se declara INCOMPLETA');
perto(kgFalta.pctCobertoMM, 70, 'cobertura de 70% do m/m aparece explícita');
eq(kgFalta.semCusto.length, 1, 'o material faltante é listado, não engolido');
eq(kgFalta.semCusto[0].codigo, 'ES-00001', 'listado pelo código, pra ir direto pro cadastro');
ok(kgFalta.custoPorKg < kg.custoPorKg, 'ficha incompleta é MENOR -- é exatamente por isso que não se exibe o total dela');

// ── O bug que os sintéticos não pegaram ────────────────────────────────────
// Toda fixture parcial acima tem PELO MENOS UM item com preço. Com a base de
// produção sem preço nenhum, a soma dava 0 e 0 não é null: a ficha exibia
// R$ 0,00 como total de material. Achado pelo harness da tela, não por aqui.
const kgZero = C.custoPorKgFormula(formulaOk, idx, {});
eq(kgZero.custoPorKg, null, 'NENHUM item com preço -> custoPorKg é null, JAMAIS 0');
eq(kgZero.completo, false, 'e a fórmula não é completa');
perto(kgZero.pctCobertoMM, 0, 'cobertura zero');
eq(kgZero.semCusto.length, 3, 'os três itens entram como sem custo');

// Unidade não conversível entra em incompativeis, não em semCusto
const formulaIncompat = { itens: { i1: { mpCodigo: 'MPGR-00005', percentualMM: 100 } } };
const kgIncompat = C.custoPorKgFormula(formulaIncompat, idx, precos);
eq(kgIncompat.completo, false, 'preço existe mas não converte -> incompleta');
eq(kgIncompat.incompativeis.length, 1, 'classificado como incompatível (tem preço), não como sem preço');
eq(kgIncompat.semCusto.length, 0, 'e não é contado duas vezes');

// Fórmula que não fecha 100% é reportada, não corrigida sozinha
const formula98 = { itens: { i1: { mpCodigo: 'MPGR-00001', percentualMM: 98 } } };
perto(C.custoPorKgFormula(formula98, idx, precos).somaPercentual, 98, 'soma fora de 100% é preservada crua');

// Fórmula vazia
eq(C.custoPorKgFormula(null, idx, precos).custoPorKg, null, 'sem fórmula, custo é null e não 0');
eq(C.custoPorKgFormula(null, idx, precos).completo, false, 'sem fórmula nunca é "completo"');

// ── 5. Massa de granel por peça ────────────────────────────────────────────
const prod = { sku: 'SKU1', volume: 200, unidadeVolume: 'ml', densidadeGranel: 1, prodHoraRef: 500 };
const m1 = C.massaGranelPorPeca(prod);
ok(m1.ok, 'produto com volume e densidade calcula massa');
perto(m1.kg, 0.2, '200 ml a densidade 1,0 = 0,2 kg');
const m2 = C.massaGranelPorPeca({ ...prod, overfillPct: 5, perdaProcessoPct: 10 });
perto(m2.kg, 0.2 * 1.05 * 1.1, 'overfill e perda de processo entram na massa');
eq(C.massaGranelPorPeca({ ...prod, densidadeGranel: -1 }).ok, false,
  'densidade -1 (marcador de importação) NÃO calcula -- já gerou consumo negativo antes');
eq(C.massaGranelPorPeca({ ...prod, densidadeGranel: null }).ok, false, 'densidade ausente não calcula');
eq(C.massaGranelPorPeca({ ...prod, unidadeVolume: 'g' }).ok, false, 'unidade de volume desconhecida não calcula');
eq(C.massaGranelPorPeca({ ...prod, volume: 0 }).ok, false, 'volume zero não calcula');
perto(C.massaGranelPorPeca({ volume: 1, unidadeVolume: 'l', densidadeGranel: 0.9 }).kg, 0.9, 'litro é aceito como unidade');

// ── 6. Embalagem por peça ──────────────────────────────────────────────────
const bomOk = { itens: {
  b1: { materialCodigo: 'EP-00001', materialNome: 'FRASCO', qtdPorPeca: 1 },
  b2: { materialCodigo: 'EP-00002', materialNome: 'TAMPA', qtdPorPeca: 1 },
  b3: { materialCodigo: 'ET-00001', materialNome: 'RÓTULO', qtdPorPeca: 2 }
} };
const emb = C.custoEmbalagemPorPeca(bomOk, idx, precos);
perto(emb.custoPorPeca, 1.5 + 0.4 + 0.2, 'embalagem multiplica qtd por peça pelo preço unitário');
ok(emb.completo, 'BOM com todos os preços é completo');

// Mesmo bug do granel, do lado da embalagem
const embZero = C.custoEmbalagemPorPeca(bomOk, idx, {});
eq(embZero.custoPorPeca, null, 'BOM sem preço nenhum -> custoPorPeca é null, não 0');
eq(embZero.linhasCusteadas, 0, 'e nenhuma linha foi custeada');
eq(embZero.completo, false, 'e não se declara completo');

const bomFalta = { itens: {
  b1: { materialCodigo: 'EP-00001', qtdPorPeca: 1 },
  b2: { materialCodigo: 'ES-00001', qtdPorPeca: 1 / 12 }   // caixa sem preço
} };
const embFalta = C.custoEmbalagemPorPeca(bomFalta, idx, precos);
perto(embFalta.custoPorPeca, 1.5, 'embalagem parcial soma só o conhecido');
eq(embFalta.completo, false, 'e se declara incompleta');
eq(embFalta.semCusto[0].codigo, 'ES-00001', 'com o faltante nomeado');

// Preço numa unidade diferente da do cadastro não multiplica às cegas
const embUnidade = C.custoEmbalagemPorPeca(
  { itens: { b1: { materialCodigo: 'EP-00001', qtdPorPeca: 1 } } },
  idx, { ep_00001: { valor: 1500, unidade: 'MIL', fonte: 'MANUAL' } });
eq(embUnidade.completo, false, 'preço por milheiro com cadastro em UN não é multiplicado direto');
eq(embUnidade.incompativeis.length, 1, 'vai para incompatíveis com motivo');

// ── 7. Ficha completa ──────────────────────────────────────────────────────
const fichaSemTaxa = C.fichaCustoProduto({ produto: prod, formula: formulaOk, bom: bomOk, idxMateriais: idx, precos: precos });
perto(fichaSemTaxa.granel.custoPorKg, 4.8, 'ficha traz o custo do kg');
perto(fichaSemTaxa.granel.custoPorPeca, 4.8 * 0.2, 'e converte para a peça pela massa');
perto(fichaSemTaxa.custoMaterialPorPeca, 0.96 + 2.1, 'material da peça = granel + embalagem');
eq(fichaSemTaxa.custoUnitario, null, 'SEM taxa de conversão não existe custo unitário do produto');
eq(fichaSemTaxa.materialCompleto, true, 'mas o material está completo');
eq(fichaSemTaxa.completo, false, 'e a ficha inteira NÃO se declara completa sem conversão');

const ficha = C.fichaCustoProduto({
  produto: prod, formula: formulaOk, bom: bomOk, idxMateriais: idx, precos: precos,
  taxaConversao: { custoHoraPadrao: 500, procedencia: 'ESTIMADO' }
});
perto(ficha.conversao.horasPorPeca, 1 / 500, 'horas por peça vêm de prodHoraRef');
perto(ficha.conversao.custoPorPeca, 1, '500 R$/h a 500 peças/h = R$ 1,00 por peça');
perto(ficha.custoUnitario, 0.96 + 2.1 + 1, 'custo unitário = material + conversão');
ok(ficha.completo, 'com material e conversão a ficha é completa');

// Produto sem densidade: custo por kg sobrevive, custo por peça não
const fichaSemDens = C.fichaCustoProduto({
  produto: { ...prod, densidadeGranel: null }, formula: formulaOk, bom: bomOk,
  idxMateriais: idx, precos: precos, taxaConversao: { custoHoraPadrao: 500 }
});
perto(fichaSemDens.granel.custoPorKg, 4.8, 'sem densidade o custo do KG continua válido -- é o ponto todo');
eq(fichaSemDens.granel.custoPorPeca, null, 'mas o custo por peça não é inventado');
eq(fichaSemDens.custoUnitario, null, 'e o unitário fica null em vez de sair errado');
ok(fichaSemDens.avisos.some(a => /densidade/i.test(a)), 'com aviso explicando o motivo');

// Produto sem prodHoraRef não ganha conversão silenciosa
const fichaSemTaxaRef = C.fichaCustoProduto({
  produto: { ...prod, prodHoraRef: 0 }, formula: formulaOk, bom: bomOk,
  idxMateriais: idx, precos: precos, taxaConversao: { custoHoraPadrao: 500 }
});
eq(fichaSemTaxaRef.conversao, null, 'sem prodHoraRef não há conversão');
ok(fichaSemTaxaRef.avisos.some(a => /prodHoraRef/.test(a)), 'e o motivo aparece nos avisos');

// Ficha incompleta não produz total
const fichaFalta = C.fichaCustoProduto({
  produto: prod, formula: formulaFalta, bom: bomFalta, idxMateriais: idx, precos: precos,
  taxaConversao: { custoHoraPadrao: 500 }
});
eq(fichaFalta.completo, false, 'ficha com material faltando não é completa');
ok(fichaFalta.semCusto.includes('ES-00001'), 'e entrega a lista de códigos a cadastrar');
// A regra mais importante do módulo, agora travada em teste:
eq(fichaFalta.custoMaterialPorPeca, null,
  'TOTAL de material é null quando falta preço — somar granel parcial com embalagem parcial ' +
  'produz um número menor que o verdadeiro com cara de total');
eq(fichaFalta.custoUnitario, null, 'e o unitário também');
ok(fichaFalta.granel.custoPorPeca != null,
  'mas a PARTE conhecida continua acessível, para a tela mostrar parcial com o aviso ao lado');

// Ficha de uma base sem preço nenhum: nada pode ter valor
const fichaZero = C.fichaCustoProduto({
  produto: prod, formula: formulaOk, bom: bomOk, idxMateriais: idx, precos: {},
  taxaConversao: { custoHoraPadrao: 500 }
});
eq(fichaZero.granel.custoPorKg, null, 'base sem preço: custo do kg é null');
eq(fichaZero.granel.custoPorPeca, null, 'base sem preço: granel por peça é null');
eq(fichaZero.embalagem.custoPorPeca, null, 'base sem preço: embalagem é null');
eq(fichaZero.custoMaterialPorPeca, null, 'base sem preço: material por peça é null — NUNCA R$ 0,00');
eq(fichaZero.custoUnitario, null, 'base sem preço: unitário é null');
eq(fichaZero.materialCompleto, false, 'e nada se declara completo');

// ── 8. Fila de preços por exposição ────────────────────────────────────────
const volumePorSku = { SKU1: 100000, SKU2: 10000 };
const formulaPorSku = {
  SKU1: formulaOk,
  SKU2: { itens: { i1: { mpCodigo: 'MPGR-00002', percentualMM: 100 } } }
};
const bomPorSku = { SKU1: bomOk, SKU2: { itens: { b1: { materialCodigo: 'ES-00001', qtdPorPeca: 1 } } } };
const r = C.filaPrecosPorExposicao({ volumePorSku, formulaPorSku, bomPorSku, idxMateriais: idx, precos });

eq(r.fila[0].exposicao, 110000, 'MPGR-00002 aparece nos dois SKUs e lidera a exposição');
eq(r.fila[0].codigo, 'MPGR-00002', 'a fila é ordenada por exposição decrescente');
ok(r.fila[0].acumuladoPct > 0 && r.fila[r.fila.length - 1].acumuladoPct > 99.99,
  'o acumulado percorre 100% da exposição');
eq(r.pendentes.length, 1, 'só a caixa está sem preço');
eq(r.pendentes[0].codigo, 'ES-00001', 'e é ela que a fila cobra');
eq(r.comPreco, r.totalMateriais - 1, 'contagem de cobertos bate');
ok(r.coberturaPct > 0 && r.coberturaPct < 100, 'cobertura parcial é reportada como percentual');
eq(r.fila.every(f => f.natureza), true, 'toda linha da fila carrega natureza de custo');
eq(r.fila.find(f => f.codigo === 'ES-00001').tipo, 'ES', 'e o tipo do cadastro');

// Material fora do cadastro não entra na fila (não dá pra cadastrar preço nele)
const rOrfao = C.filaPrecosPorExposicao({
  volumePorSku: { SKUX: 500 },
  formulaPorSku: { SKUX: { itens: { i1: { mpCodigo: 'XX-99999', percentualMM: 100 } } } },
  bomPorSku: {}, idxMateriais: idx, precos: precos
});
eq(rOrfao.totalMateriais, 0, 'código órfão não vira linha de fila fantasma');

eq(C.materiaisParaCobrir(r.fila, 50) >= 1, true, 'materiaisParaCobrir devolve quantos preços cobrem a meta');
eq(C.materiaisParaCobrir(r.fila, 100), r.fila.length, 'para 100% é a fila inteira');
eq(C.materiaisParaCobrir([], 80), 0, 'fila vazia não trava');

// ── 9. Plano de cadastro orientado a ficha fechada ─────────────────────────
// O caso que motivou a função: um SKU de altíssimo volume que compartilha
// materiais com outro, e um SKU pequeno que exige um material exclusivo.
// Ordenar por exposição cadastraria o material do SKU grande primeiro sem
// FECHAR ficha nenhuma; o plano por SKU tem que fechar uma ficha por rodada.
const volPlano = { SKU1: 100000, SKU2: 10000 };
const plano = C.planoCadastroPorSku({
  volumePorSku: volPlano, formulaPorSku, bomPorSku, idxMateriais: idx, precos: {}
});
ok(plano.sequencia.length > 0, 'plano devolve uma sequência de cadastro');
eq(plano.skusFechados[0].sku, 'SKU1', 'fecha primeiro o SKU de maior volume por preço digitado');
eq(plano.volumeTotal, 110000, 'volume total confere');
ok(plano.marcos[0].volumeCobertoPct > 90, 'o primeiro marco já cobre a maior parte do volume');
eq(plano.marcos[plano.marcos.length - 1].volumeCobertoPct, 100, 'o último marco cobre 100% do volume plannejável');
// Material compartilhado não é cobrado duas vezes
const codigosNaSequencia = plano.sequencia.map(s => s.codigo);
eq(codigosNaSequencia.length, new Set(codigosNaSequencia).size, 'nenhum material aparece duas vezes na sequência');
ok(codigosNaSequencia.includes('MPGR-00002'), 'material compartilhado entra uma vez só');
eq(plano.marcos[1].precos - plano.marcos[0].precos, 1,
  'o segundo SKU custa só 1 preço novo — o compartilhado já foi pago pelo primeiro');

// Preço já cadastrado não reaparece no plano
const planoComPreco = C.planoCadastroPorSku({
  volumePorSku: volPlano, formulaPorSku, bomPorSku, idxMateriais: idx, precos: precos
});
eq(planoComPreco.sequencia.filter(s => s.codigo === 'MPGR-00001').length, 0,
  'material que já tem preço não entra na sequência');
eq(planoComPreco.precosNecessarios, 1, 'só falta a caixa sem preço');

// SKU com código órfão não promete fechamento impossível
const planoOrfao = C.planoCadastroPorSku({
  volumePorSku: { SKUX: 9999 },
  formulaPorSku: { SKUX: { itens: { i1: { mpCodigo: 'XX-99999', percentualMM: 100 } } } },
  bomPorSku: {}, idxMateriais: idx, precos: {}
});
eq(planoOrfao.sequencia.length, 0, 'SKU com material fora do cadastro não gera sequência de preço');
eq(planoOrfao.bloqueadosPorCadastro.length, 1, 'ele é reportado como bloqueado por CADASTRO, não por preço');
eq(planoOrfao.bloqueadosPorCadastro[0].orfaos[0], 'XX-99999', 'com o código que falta cadastrar');

eq(C.precosParaVolume(plano.marcos, 50), plano.marcos[0].precos, 'precosParaVolume acha o primeiro marco que atinge a meta');
eq(C.precosParaVolume([], 80), 0, 'sem marcos não trava');

// Entrada vazia
const planoVazio = C.planoCadastroPorSku({ volumePorSku: {}, idxMateriais: idx, precos: {} });
eq(planoVazio.sequencia.length, 0, 'sem volume não há plano');
eq(planoVazio.volumeTotal, 0, 'e o total é 0, não NaN');

console.log('OK custos: ' + n + ' asserções — preço ausente nunca vira zero, unidade só converte quando dá, ' +
  'custo do kg sobrevive sem densidade, ficha sem conversão não vira custo do produto, ' +
  'fila por exposição e plano de cadastro por ficha fechada.');
