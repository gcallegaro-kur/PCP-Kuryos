/* Modelos iniciais dos checklists da Qualidade (19/10/2026).
   Ponto de partida para a Qualidade revisar no editor (PLANO_QUALIDADE.md,
   tarefa K2) -- depois de criados, quem manda é o modelo gravado no banco,
   não este arquivo. Fontes:
   - spec ERP_Kuryos_Modulo_CQ_v1.1 (3.3 Assépsia, 3.4 Setup/First Article);
   - POP 035 Rev.04 (lavagem, sanitização com álcool 70% e 10 min de contato);
   - F 0065 / F 0066 (agentes: água, Divosan Divosep 350 1%, álcool 70%);
   - revisão da Qualidade em 17/09: first article com 32 unidades, −3%, torque opcional.
   Os ids são fixos: a Qualidade pode reescrever o texto sem perder o vínculo. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChecklistsModelosPadrao = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  var AGENTES = ['Água', 'Divosan Divosep 350 (1%)', 'Álcool 70%'];

  var CK3 = {codigo: 'CK-3', nome: 'Assepsia — Reator / tacho', descricao: 'Limpeza e sanitização do reator, tacho e utensílios antes da manipulação (POP 035, F 0066). O manipulador registra; a Qualidade verifica e libera.', itens: [
    {id: 'c3x1', secao: 'Limpeza', papel: 'EXECUTOR', texto: 'Resíduos sólidos retirados com espátula e jato de água', foto: 'NUNCA'},
    {id: 'c3x2', secao: 'Limpeza', papel: 'EXECUTOR', texto: 'Lavado por dentro e por fora com água corrente e sabão neutro (sem corante e sem essência)', foto: 'NUNCA'},
    {id: 'c3x3', secao: 'Limpeza', papel: 'EXECUTOR', texto: 'Enxaguado, inclusive tampa, válvula, agitador e demais componentes', foto: 'NUNCA'},
    {id: 'c3x4', secao: 'Sanitização', papel: 'EXECUTOR', tipo: 'ESCOLHA', texto: 'Agente sanitizante usado', opcoes: AGENTES, foto: 'NUNCA'},
    {id: 'c3x5', secao: 'Sanitização', papel: 'EXECUTOR', tipo: 'MEDIDA', texto: 'Tempo de contato do sanitizante', como: 'POP 035: aguardar 10 minutos com a solução de álcool 70%.', medida: {unidade: 'min', min: 10}, foto: 'NUNCA'},
    {id: 'c3x6', secao: 'Sanitização', papel: 'EXECUTOR', texto: 'Enxágue final para retirar o excesso de sanitizante', foto: 'NUNCA'},
    {id: 'c3x7', secao: 'Sanitização', papel: 'EXECUTOR', texto: 'Equipamento esgotado por completo e identificado com a etiqueta de higienização', foto: 'SEMPRE'},
    {id: 'c3q1', secao: 'Verificação da Qualidade', papel: 'QUALIDADE', critico: true, texto: 'Sem resíduo visível do produto anterior (paredes, fundo, agitador, válvula)', foto: 'NC'},
    {id: 'c3q2', secao: 'Verificação da Qualidade', papel: 'QUALIDADE', critico: true, texto: 'Sem odor do produto anterior', foto: 'NC'},
    {id: 'c3q3', secao: 'Verificação da Qualidade', papel: 'QUALIDADE', texto: 'Sem água acumulada; superfícies escorridas', foto: 'NC'},
    {id: 'c3q4', secao: 'Verificação da Qualidade', papel: 'QUALIDADE', texto: 'Vedações e gaxetas íntegras', foto: 'NC'}
  ]};

  var CK4 = {codigo: 'CK-4', nome: 'Assepsia — Linha de envase', descricao: 'Limpeza e sanitização da linha antes do setup (POP 035, F 0065): na troca de produto, no início de cada dia de operação, após manutenção e a cada 15 lotes da mesma fórmula. O operador/líder registra; a Qualidade verifica e libera.', itens: [
    {id: 'c4x1', secao: 'Limpeza', papel: 'EXECUTOR', texto: 'Bicos, mangueiras e pistões desmontados', foto: 'NUNCA'},
    {id: 'c4x2', secao: 'Limpeza', papel: 'EXECUTOR', texto: 'Resíduo do produto anterior retirado e peças lavadas com água e sabão neutro', foto: 'NUNCA'},
    {id: 'c4x3', secao: 'Limpeza', papel: 'EXECUTOR', texto: 'Filtros limpos (obrigatório na troca de produto)', foto: 'NUNCA'},
    {id: 'c4x4', secao: 'Sanitização', papel: 'EXECUTOR', tipo: 'ESCOLHA', texto: 'Agente sanitizante usado', opcoes: AGENTES, foto: 'NUNCA'},
    {id: 'c4x5', secao: 'Sanitização', papel: 'EXECUTOR', tipo: 'MEDIDA', texto: 'Tempo de contato do sanitizante', como: 'POP 035: 10 minutos com álcool 70%. Nas linhas que usam só água, registre 0 e marque o agente "Água".', medida: {unidade: 'min'}, foto: 'NUNCA'},
    {id: 'c4x6', secao: 'Sanitização', papel: 'EXECUTOR', texto: 'Enxaguado e montado de novo', foto: 'NUNCA'},
    {id: 'c4q1', secao: 'Verificação da Qualidade', papel: 'QUALIDADE', critico: true, texto: 'Bicos e mangueiras sem resíduo do produto anterior', foto: 'NC'},
    {id: 'c4q2', secao: 'Verificação da Qualidade', papel: 'QUALIDADE', critico: true, texto: 'Sem odor do produto anterior na linha', foto: 'NC'},
    {id: 'c4q3', secao: 'Verificação da Qualidade', papel: 'QUALIDADE', texto: 'Esteira, fechadora e mesa de acúmulo limpas', foto: 'NC'},
    {id: 'c4q4', secao: 'Verificação da Qualidade', papel: 'QUALIDADE', texto: 'Rotuladora e codificadora limpas', foto: 'NC'}
  ]};

  var CK5 = {codigo: 'CK-5', nome: 'Setup de linha / First article', descricao: 'Liberação da linha pela Qualidade antes de produzir o lote (spec 3.4). Pré-requisito: assepsia da linha liberada. Inspetora e líder da linha assinam.', itens: [
    {id: 'c5l1', secao: 'Limpeza da linha (line clearance)', critico: true, texto: 'Nenhum frasco, tampa, rótulo ou caixa do lote anterior na linha e na área', foto: 'NC'},
    {id: 'c5l2', secao: 'Limpeza da linha (line clearance)', critico: true, texto: 'Nenhum produto acabado do lote anterior na área', foto: 'NC'},
    {id: 'c5l3', secao: 'Limpeza da linha (line clearance)', texto: 'Documentos do lote anterior recolhidos', foto: 'NUNCA'},
    {id: 'c5i1', secao: 'Insumos', critico: true, texto: 'Todos os insumos na linha estão com etiqueta "Aprovado" do CQ', foto: 'NC'},
    {id: 'c5i2', secao: 'Insumos', critico: true, texto: 'Lotes dos insumos conferem com a OP', foto: 'NC'},
    {id: 'c5i3', secao: 'Insumos', critico: true, texto: 'Rótulo/arte correto para o SKU (versão, texto, cor)', foto: 'SEMPRE'},
    {id: 'c5m1', secao: 'Máquina', texto: 'Bicos, receita/volume e cabeçotes da rotuladora ajustados', foto: 'NUNCA'},
    {id: 'c5m2', secao: 'Máquina', critico: true, texto: 'Lote e validade impressos conferem com a OP', foto: 'SEMPRE'},
    {id: 'c5f1', secao: 'First article', tipo: 'AMOSTRAS', critico: true, texto: 'Peso das primeiras unidades', como: '32 unidades seguidas da linha. Limite inferior: nominal − 3% (INMETRO).', amostras: {n: 32, unidade: 'g', nominal: 'PRODUTO', tolInfPct: 3}, foto: 'NUNCA'},
    {id: 'c5f2', secao: 'First article', texto: 'Posição do rótulo correta (sem bolha, torto ou descolado)', foto: 'NC'},
    {id: 'c5f3', secao: 'First article', critico: true, texto: 'Vedação conferida à mão, sem vazamento', foto: 'NC'},
    {id: 'c5f4', secao: 'First article', tipo: 'MEDIDA', obrigatorio: false, texto: 'Torque de fechamento (opcional)', medida: {unidade: 'kgf·cm'}, foto: 'NUNCA'},
    {id: 'c5f5', secao: 'First article', texto: 'Aspecto, cor e odor conforme o padrão', foto: 'NC'},
    {id: 'c5f6', secao: 'First article', texto: 'Uma unidade retida como contraprova do setup (identificada com lote, hora e responsável)', foto: 'NUNCA'}
  ]};

  return {AGENTES: AGENTES, MODELOS: [CK3, CK4, CK5]};
});
