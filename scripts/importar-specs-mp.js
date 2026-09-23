#!/usr/bin/env node
'use strict';
/* Lê os laudos de matéria-prima do laboratório (F0070/POP004) e propõe a
   especificação de cada MP no vocabulário do sistema.

   Contexto (usuário, 2026-09-23): não existia como cadastrar spec de MP, e
   a análise do CQ abria sem ensaio nenhum. A spec passa a nascer DENTRO da
   análise da Qualidade; estes 330 laudos, que o laboratório já preencheu
   material a material, entram como ponto de partida -- a analista confere e
   o "salvar" dela é que torna oficial.

   Decisões que este script respeita:
   - plano fixo de 6 ensaios (aspecto físico, cor, odor, pH, densidade, teor
     alcoólico), com NA quando não se aplica;
   - a spec é do MATERIAL, igual para todos os fornecedores;
   - o código do laboratório NÃO é o do sistema (MPAL002 x MPGR-00127), então
     o casamento é por NOME, com similaridade e nível de confiança.

   SOMENTE LEITURA: nunca grava no banco. A saída é um JSON de proposta.

   Uso:
     LAUDOS_TXT=<pasta com .txt> MATERIAIS_JSON=<dump de /materiais> \
       node scripts/importar-specs-mp.js --json proposta.json
*/
const fs = require('node:fs');
const path = require('node:path');
const SpecMaterial = require(path.join(__dirname, '..', 'public', 'shared', 'spec-material.js'));

const PASTA_TXT = process.env.LAUDOS_TXT;

function texto(v) { return String(v == null ? '' : v).trim(); }

/* O .txt do Word traz a tabela linha a linha, com as células separadas por
   TAB: "Aspecto Físico<TAB>Líquido Límpido<TAB>Visual<TAB>Conforme". A 4ª
   coluna é o RESULTADO daquele lote -- não é especificação e é descartada. */
const ENSAIOS = [
  {re: /^aspecto/i, chave: 'aspecto'},
  {re: /^cor\b/i, chave: 'cor'},
  {re: /^odor\b/i, chave: 'odor'},
  {re: /^(ph|p\.h)\b/i, chave: 'ph'},
  {re: /^densidade/i, chave: 'densidade'},
  {re: /^(teor\s*alco|teor\s*de\s*.lcool|grau\s*alco)/i, chave: 'teor_alcoolico'},
  {re: /^teor\b/i, chave: 'teor_alcoolico'}
];

function lerLaudo(arquivo) {
  let bruto = fs.readFileSync(arquivo);
  /* Codificação: este Word gravou ANSI (cp1252) apesar do formato pedido,
     então, sem BOM, o certo é latin1 — ler como UTF-8 transformava todo
     acento em caractere de substituição ("L?quido L?mpido"). */
  const utf16 = bruto[0] === 0xFF && bruto[1] === 0xFE;
  const utf8 = bruto[0] === 0xEF && bruto[1] === 0xBB && bruto[2] === 0xBF;
  const conteudo = utf16 ? bruto.toString('utf16le')
    : utf8 ? bruto.toString('utf8').replace(/^﻿/, '')
    : bruto.toString('latin1');
  const nomeArquivo = path.basename(arquivo, '.txt');
  const nome = nomeArquivo.replace(/\s*\(\d+\)\s*$/, '').split(/\s+-\s+/)[0].trim();
  const codigoLab = (conteudo.match(/C.DIGO:\s*([A-Z0-9\-\.]+)/i) || [])[1] || null;

  /* Dentro do .txt do Word, a tabela vem numa linha só e as CÉLULAS são
     separadas por retorno de carro (CR): "PARAMETROS  ESPECIFICAÇÕES 
     MÉTODOS  RESULTADOS  Aspecto Físico  Pó  Visual   Cor...".
     A 4ª coluna é o resultado DAQUELE lote -- não é especificação, e é
     descartada de propósito. */
  const celulas = conteudo.split(/[\u000d\u000a\u0009\u000b]+/).map((c) => c.trim()).filter(Boolean);
  const iCab = celulas.findIndex((c) => /^PAR.METROS$/i.test(c));
  const fluxo = iCab >= 0 ? celulas.slice(iCab) : celulas;

  const itens = {};
  let atual = null, coluna = 0;
  fluxo.forEach((c) => {
    if (/^(PAR.METROS|ESPECIFICA..ES|M.TODOS|RESULTADOS)$/i.test(c)) return;
    if (/^(M.todos?\s*:|Observa..es|Data do recebimento|RESPONS|APROVADO|REPROVADO)/i.test(c)) { atual = null; return; }
    const e = ENSAIOS.find((x) => x.re.test(c));
    if (e) { atual = e.chave; coluna = 0; if (!itens[atual]) itens[atual] = {especificacaoTexto: '', metodo: null}; return; }
    if (!atual) return;
    coluna++;
    // Campo em branco do formulário não é especificação.
    if (/^_+$/.test(c) || /^\(\s*\)$/.test(c)) return;
    if (coluna === 1 && !itens[atual].especificacaoTexto) itens[atual].especificacaoTexto = c;
    else if (!itens[atual].metodo && !/^(conforme|aprovado|reprovado)$/i.test(c)) itens[atual].metodo = c;
  });
  // Ensaio sem especificação escrita não vira cadastro: no laudo do CQ
  // apareceria como linha vazia, pior do que não existir.
  Object.keys(itens).forEach((k) => { if (!itens[k].especificacaoTexto) delete itens[k]; });

  return {arquivo: path.basename(arquivo), nome: nome, codigoLab: codigoLab,
    itens: itens, ensaios: Object.keys(itens).length, achouCabecalho: iCab >= 0};
}

function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  if (!PASTA_TXT || !fs.existsSync(PASTA_TXT)) {
    console.error('Defina LAUDOS_TXT com a pasta dos laudos convertidos em .txt.');
    process.exit(2);
  }
  const materiaisPath = process.env.MATERIAIS_JSON;
  if (!materiaisPath || !fs.existsSync(materiaisPath)) {
    console.error('Defina MATERIAIS_JSON com o dump de /materiais.');
    process.exit(2);
  }
  const materiais = JSON.parse(fs.readFileSync(materiaisPath, 'utf8')) || {};

  // `~$...` sao arquivos temporarios que o Word deixa enquanto converte.
  const arquivos = fs.readdirSync(PASTA_TXT)
    .filter((f) => /\.txt$/i.test(f) && !f.startsWith('~$'))
    .map((f) => path.join(PASTA_TXT, f))
    .filter((f) => fs.existsSync(f));
  const lidos = arquivos.map(lerLaudo);

  const propostas = {}, revisar = [], semEnsaio = [];
  lidos.forEach((l) => {
    if (!l.ensaios) { semEnsaio.push(l.nome); return; }
    const casou = SpecMaterial.casarMaterial(l.nome, materiais);
    if (!casou.achou) {
      revisar.push({nome: l.nome, arquivo: l.arquivo, motivo: casou.confianca === 'AMBIGUO' ? 'dois materiais parecidos' : 'sem material parecido',
        candidatos: (casou.candidatos || []).map((c) => c.codigo + ' ' + c.nome + ' (' + c.score + ')'), itens: l.itens});
      return;
    }
    const codigo = casou.escolhido.codigo;
    const atual = propostas[codigo];
    // Mesmo material com mais de um laudo (um por cliente): fica o mais completo.
    if (!atual || l.ensaios > atual.ensaios) {
      propostas[codigo] = {codigo: codigo, materialNome: casou.escolhido.nome, confianca: casou.confianca,
        score: casou.escolhido.score, arquivo: l.arquivo, codigoLab: l.codigoLab, ensaios: l.ensaios,
        plano: SpecMaterial.planoDoMaterial(l.itens)};
    }
  });

  const lista = Object.values(propostas);
  const porConfianca = lista.reduce((a, p) => { a[p.confianca] = (a[p.confianca] || 0) + 1; return a; }, {});
  const totalMp = Object.values(materiais).filter((m) => /^(MPGR|MPES|MU)$/.test(String((m || {}).tipo || ''))).length;
  const porEnsaio = {};
  lista.forEach((p) => p.plano.filter((l) => l.aplicavel).forEach((l) => { porEnsaio[l.ensaio] = (porEnsaio[l.ensaio] || 0) + 1; }));

  console.log('Laudos convertidos lidos: ' + lidos.length);
  console.log('  com pelo menos um ensaio: ' + (lidos.length - semEnsaio.length));
  console.log('  viraram proposta: ' + lista.length + ' matérias-primas de ' + totalMp + ' cadastradas (' + Math.round(lista.length / totalMp * 100) + '%)');
  console.log('  confiança do casamento: ' + JSON.stringify(porConfianca));
  console.log('  para revisão manual: ' + revisar.length + ' | sem ensaio legível: ' + semEnsaio.length);
  console.log('  ensaios preenchidos: ' + JSON.stringify(porEnsaio));

  console.log('\nAmostra:');
  lista.slice(0, 6).forEach((p) => {
    console.log('  ' + p.codigo + ' — ' + p.materialNome + '  [' + p.confianca + ' ' + p.score + '] (' + p.arquivo + ')');
    p.plano.filter((l) => l.aplicavel).forEach((l) => console.log('      • ' + l.ensaio + ': ' + l.especificacaoTexto + (l.metodo ? ' · ' + l.metodo : '')));
  });
  if (revisar.length) {
    console.log('\nPara revisão (primeiros 6):');
    revisar.slice(0, 6).forEach((r) => console.log('  ' + r.nome + ' — ' + r.motivo + (r.candidatos.length ? ' · candidatos: ' + r.candidatos.join(' | ') : '')));
  }

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({geradoEm: new Date().toISOString(), propostas: lista, revisar: revisar, semEnsaio: semEnsaio}, null, 1), 'utf8');
    console.log('\nProposta completa em ' + jsonOut);
  }
}

main();
