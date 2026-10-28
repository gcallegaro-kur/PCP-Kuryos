'use strict';
/* Gera public/backlog.json a partir do painel "Em aberto para execução" de MELHORIAS_FUTURAS.md.

   A tela Roadmap do sistema (public/backlog.html) lê esse JSON. Ninguém preenche nada à
   mão: quem termina um trabalho atualiza a tabela do painel (regra do próprio arquivo) e
   este script traduz as três tabelas — A. código nosso, B. depende da Kuryos, C. decisões
   do usuário — em itens com marca de "feito".

   Uso:  node scripts/gerar-backlog.js          (grava public/backlog.json)
   O teste run_backlog_test.js falha se o JSON publicado estiver desatualizado. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const ORIGEM = path.join(RAIZ, 'MELHORIAS_FUTURAS.md');
const DESTINO = path.join(RAIZ, 'public', 'backlog.json');

const PIPE = '\u0000';

function celulas(linha) {
  const corpo = linha.trim().replace(/^\|/, '').replace(/\|$/, '').replace(/\\\|/g, PIPE);
  return corpo.split('|').map((c) => c.replace(new RegExp(PIPE, 'g'), '|').trim());
}

/* Texto da célula: primeira parte é o texto; trechos "- xxx" depois de <br> viram subitens. */
function partirCelula(cel) {
  const partes = String(cel || '').split(/<br\s*\/?>/i).map((p) => p.trim()).filter(Boolean);
  let texto = '';
  const subitens = [];
  partes.forEach((p, i) => {
    if (/^-\s+/.test(p) && i > 0) subitens.push(p.replace(/^-\s+/, ''));
    else texto = texto ? texto + ' ' + p : p;
  });
  return {texto, subitens};
}

function limpar(t) {
  return String(t || '').replace(/~~/g, '').replace(/\s*feito em\s+`?[0-9a-f]{7,40}`?\.?/i, '').replace(/\s+/g, ' ').trim();
}

function parse(md) {
  const linhas = String(md).split(/\r?\n/);
  const ini = linhas.findIndex((l) => /^## .*Em aberto para execução/.test(l));
  if (ini < 0) throw new Error('painel "Em aberto para execução" não encontrado em MELHORIAS_FUTURAS.md');
  let fim = linhas.findIndex((l, i) => i > ini && /^## /.test(l));
  if (fim < 0) fim = linhas.length;
  const atualizado = (linhas[ini].match(/atualizado em (\d{2}\/\d{2}\/\d{4})/) || [])[1] || null;

  const secoes = [];
  let atual = null, cab = null;
  for (let i = ini + 1; i < fim; i++) {
    const l = linhas[i];
    const h = l.match(/^###\s+([A-Z])\.\s+(.*)$/);
    if (h) { atual = {letra: h[1], titulo: h[2].trim(), itens: []}; secoes.push(atual); cab = null; continue; }
    if (!atual || !/^\s*\|/.test(l)) continue;
    if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue;
    const c = celulas(l);
    if (!cab) { cab = c; continue; }
    if (c.length < 2) continue;
    const grupo = c[0].replace(/\*\*/g, '').trim();
    const {texto, subitens} = partirCelula(c[1]);
    const extras = {};
    for (let k = 2; k < cab.length && k < c.length; k++) {
      const v = c[k].replace(/<br\s*\/?>/gi, ' ').trim();
      if (v && v !== '—' && v !== '-') extras[cab[k]] = v;
    }
    const feito = /^(\*\*)?~~/.test(c[1].trim()) || /^~~/.test(c[1].trim());
    const hash = ((c[1].match(/feito em\s+`?([0-9a-f]{7,40})`?/i) || [])[1]) || null;
    const base = limpar(texto);
    atual.itens.push({
      id: crypto.createHash('sha1').update(atual.letra + '|' + grupo + '|' + base).digest('hex').slice(0, 10),
      grupo: grupo, texto: base, subitens: subitens.map(limpar), extras: extras, feito: feito, hash: hash
    });
  }
  const resumo = {};
  secoes.forEach((s) => {
    resumo[s.letra] = {titulo: s.titulo, total: s.itens.length, feitos: s.itens.filter((x) => x.feito).length};
  });
  return {atualizadoEm: atualizado, secoes: secoes, resumo: resumo};
}

function gerar() {
  const dados = parse(fs.readFileSync(ORIGEM, 'utf8'));
  let commit = null;
  try { commit = cp.execSync('git rev-parse --short HEAD', {cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore']}).toString().trim(); } catch (e) { /* fora do git */ }
  return Object.assign({fonte: 'MELHORIAS_FUTURAS.md › Em aberto para execução', geradoEm: new Date().toISOString(), commit: commit}, dados);
}

if (require.main === module) {
  const saida = gerar();
  fs.writeFileSync(DESTINO, JSON.stringify(saida, null, 1) + '\n');
  const r = saida.resumo;
  console.log('public/backlog.json: ' + Object.keys(r).map((k) => k + '=' + (r[k].total - r[k].feitos) + ' abertos/' + r[k].total).join('  '));
}

module.exports = {parse, gerar, celulas, partirCelula, DESTINO, ORIGEM};
