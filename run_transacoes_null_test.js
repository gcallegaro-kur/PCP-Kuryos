'use strict';
/* Guarda de repositório: transação do RTDB não pode abortar no null.

   BUG REAL (2026-09-14). finalizarConferenciaPA fazia:

       confRef.transaction((atual) => { if (!atual) return; ... })

   O SDK chama o callback com o valor do CACHE LOCAL primeiro. Depois de um
   `.once()` o cache já esfriou, então a PRIMEIRA passada vem `null` --  e
   devolver `undefined` ABORTA a transação ali mesmo, sem nunca falar com o
   servidor. Resultado: `committed: false`, e o código reportava "Outra sessão
   já está finalizando esta OP" para uma OP que não tinha lock nenhum. Nenhuma
   conferência de PA conseguiu finalizar em produção por causa disso.

   Medido no emulador do Database, com firebase-admin 12.7.0:
       if (!atual) return;        -> passadas [null]        committed=false
       if (!atual) return atual;  -> passadas [null, dado]   committed=true

   A forma certa é devolver o próprio valor (null): o SDK então busca no
   servidor e reexecuta o callback com o dado real. Se o nó não existe mesmo,
   commita null sobre null (não apaga nada) e quem chama olha
   `snapshot.exists()` / o valor final.

   2026-09-15: o mesmo padrão estava no cliente -- Descarte/Logística Reversa
   (solicitar, desfazer e confirmar destinação), ajustarProduzidoOp,
   aprovação/rejeição/consolidação de solicitação de compra, convite de
   fornecedor na cotação e ajuste de produzido no Histórico. Lá o bug estava
   mascarado porque cada tela mantém listener no nó (cache quente), mas
   bastava um chamador novo sem listener para ele voltar. Por isso a varredura
   cobre functions/, public/shared/ e os <script> de public/*.html. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ── 1. A semântica, para quem ler este teste entender o porquê ───────────
// Fake FIEL ao SDK: primeira passada com o cache (null), undefined aborta.
function transacaoComoOSdk(valorNoServidor, atualizar) {
  const passadas = [];
  let cache = null; // depois de um .once(), é isto que o SDK tem em mãos
  let proposto = atualizar(cache);
  passadas.push('null');
  if (proposto === undefined) return {committed: false, passadas, valor: valorNoServidor};
  cache = valorNoServidor;
  proposto = atualizar(structuredClone(cache));
  passadas.push('dado');
  if (proposto === undefined) return {committed: false, passadas, valor: valorNoServidor};
  return {committed: true, passadas, valor: proposto};
}

const servidor = {status: 'AGUARDANDO_CONCILIACAO'};
const errado = transacaoComoOSdk(servidor, (a) => { if (!a) return; a.marcado = true; return a; });
assert.deepEqual(errado.passadas, ['null']);
assert.equal(errado.committed, false, 'devolver undefined no null aborta a transação');

const certo = transacaoComoOSdk(servidor, (a) => { if (!a) return a; a.marcado = true; return a; });
assert.deepEqual(certo.passadas, ['null', 'dado']);
assert.equal(certo.committed, true, 'devolver o próprio null faz o SDK reexecutar com o dado do servidor');
assert.equal(certo.valor.marcado, true);

// ── 2. Varredura: todo callback de .transaction( do repo ──────────────────
// Parser pequeno em vez de regex por janela de linhas: a regex antiga só
// pegava `if (!x) return;` com UM identificador, e deixava passar
// `if (!atual || !atual.destinacao) return;`, `if (atual !== 'PENDENTE') return;`
// e `return atual === 'APROVADA' ? 'CONSOLIDADA' : undefined;` -- todos com o
// mesmo efeito: abortar quando a 1ª passada vem null.

// Troca comentários e o conteúdo de strings/regex por espaço, preservando
// offsets e quebras de linha, para contar chaves e parênteses sem se perder.
function neutralizar(src) {
  const out = src.split('');
  const branco = (i) => { if (out[i] !== '\n') out[i] = ' '; };
  let i = 0, ultimoSignificativo = '';
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') branco(i++);
      continue;
    }
    if (c === '/' && d === '*') {
      branco(i++); branco(i++);
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) branco(i++);
      branco(i++); branco(i++);
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') branco(i++);
        branco(i++);
      }
      i++; ultimoSignificativo = c;
      continue;
    }
    if (c === '/' && (ultimoSignificativo === '' || '(,=:[!&|?{};+-*%<>~^'.includes(ultimoSignificativo))) {
      i++;
      let classe = false;
      while (i < src.length && src[i] !== '\n' && (classe || src[i] !== '/')) {
        if (src[i] === '\\') branco(i++);
        else if (src[i] === '[') classe = true;
        else if (src[i] === ']') classe = false;
        branco(i++);
      }
      i++; ultimoSignificativo = '/';
      continue;
    }
    if (!/\s/.test(c)) ultimoSignificativo = c;
    i++;
  }
  return out.join('');
}

function fechamento(src, abre) {
  const par = {'(': ')', '{': '}', '[': ']'}[src[abre]];
  let nivel = 0;
  for (let i = abre; i < src.length; i++) {
    if (src[i] === src[abre]) nivel++;
    else if (src[i] === par && --nivel === 0) return i;
  }
  return -1;
}

// Divide no `||` de nível zero.
function disjuncoes(cond) {
  const partes = []; let nivel = 0, ini = 0;
  for (let i = 0; i < cond.length; i++) {
    if ('([{'.includes(cond[i])) nivel++;
    else if (')]}'.includes(cond[i])) nivel--;
    else if (nivel === 0 && cond[i] === '|' && cond[i + 1] === '|') { partes.push(cond.slice(ini, i)); ini = i + 2; i++; }
  }
  partes.push(cond.slice(ini));
  return partes.map(p => p.trim().replace(/^\((.*)\)$/s, '$1').trim());
}

const esc = (s) => s.replace(/\$/g, '\\$');
// A condição é verdadeira quando o parâmetro vale null?
function verdadeiraNoNull(cond, p) {
  const P = esc(p);
  return disjuncoes(cond).some(d =>
    new RegExp('^!\\s*' + P + '$').test(d) ||
    new RegExp('^' + P + '\\s*===?\\s*(null|undefined)$').test(d) ||
    new RegExp('^(null|undefined)\\s*===?\\s*' + P + '$').test(d) ||
    new RegExp('^typeof\\s+' + P + '\\s*===?\\s*.undefined.$').test(d) ||
    // `atual !== 'PENDENTE'`: null também é diferente do literal
    new RegExp('^' + P + '\\s*!==?\\s*(\'\\s*\'|"\\s*"|\\d[\\d.]*|true|false)$').test(d));
}

// Guarda de null que devolve o próprio valor (ou dá valor padrão): depois
// dela, comparações com o parâmetro não enxergam mais null.
function posicaoDaGuarda(corpo, p) {
  const P = esc(p);
  const res = [
    new RegExp('if\\s*\\(\\s*(!\\s*' + P + '|' + P + '\\s*===?\\s*null|null\\s*===?\\s*' + P + ')\\s*\\)\\s*\\{?\\s*return\\s+' + P + '\\s*;'),
    new RegExp('\\b' + P + '\\s*=\\s*' + P + '\\s*\\|\\|'),
  ];
  const achados = res.map(r => { const m = r.exec(corpo); return m ? m.index : Infinity; });
  return Math.min(...achados);
}

function suspeitasDoCorpo(corpo, p) {
  const guarda = posicaoDaGuarda(corpo, p);
  const achados = [];
  const reIf = /\bif\s*\(/g;
  let m;
  while ((m = reIf.exec(corpo))) {
    if (m.index >= guarda) break;
    const abre = m.index + m[0].length - 1, fecha = fechamento(corpo, abre);
    if (fecha < 0) break;
    const cond = corpo.slice(abre + 1, fecha);
    const depois = corpo.slice(fecha + 1);
    const abortaNaHora = /^\s*(\{\s*)?return\s*(undefined\s*)?(;|\}|$)/.test(depois) ||
      /^\s*\{[^{}]*?\breturn\s*(undefined\s*)?;\s*\}/.test(depois);
    if (abortaNaHora && verdadeiraNoNull(cond, p)) achados.push({pos: m.index, txt: 'if (' + cond.trim() + ') return;'});
  }
  // Ternário: `return atual === 'X' ? valor : undefined;`
  const P = esc(p);
  const reTern = new RegExp('return\\s+' + P + '\\s*===?\\s*(?!null\\b|undefined\\b)[^?;]+\\?[^:;]+:\\s*undefined\\b', 'g');
  while ((m = reTern.exec(corpo))) {
    if (m.index < guarda) achados.push({pos: m.index, txt: m[0].replace(/\s+/g, ' ')});
  }
  // Arrow de expressão: `(a) => a === 'X' ? v : undefined`
  const reTernExpr = new RegExp('^\\s*' + P + '\\s*===?\\s*(?!null\\b|undefined\\b)[^?;]+\\?[^:;]+:\\s*undefined\\b');
  if (reTernExpr.test(corpo)) achados.push({pos: 0, txt: corpo.trim().replace(/\s+/g, ' ')});
  return achados;
}

// Devolve {callbacks, suspeitas, naoAnalisadas} de um trecho de JS.
function varrerJs(js, rotulo, linhaBase) {
  const limpo = neutralizar(js);
  const linhaDe = (pos) => linhaBase + limpo.slice(0, pos).split('\n').length - 1;
  const reTx = /\.transaction\(\s*/g;
  const r = {callbacks: 0, suspeitas: [], naoAnalisadas: []};
  let m;
  while ((m = reTx.exec(limpo))) {
    const ini = m.index + m[0].length;
    const resto = limpo.slice(ini);
    let p = null, corpo = null;
    let mm;
    if ((mm = /^function\s*[\w$]*\s*\(\s*([\w$]*)\s*\)\s*\{/.exec(resto))) {
      p = mm[1];
      const abre = ini + mm[0].length - 1;
      corpo = limpo.slice(abre + 1, fechamento(limpo, abre));
    } else if ((mm = /^(?:\(\s*([\w$]*)\s*\)|([\w$]+))\s*=>\s*/.exec(resto))) {
      p = mm[1] !== undefined ? mm[1] : mm[2];
      const pos = ini + mm[0].length;
      if (limpo[pos] === '{') corpo = limpo.slice(pos + 1, fechamento(limpo, pos));
      else {
        // corpo de expressão: até a vírgula ou o `)` de nível zero
        let nivel = 0, fim = pos;
        for (; fim < limpo.length; fim++) {
          if ('([{'.includes(limpo[fim])) nivel++;
          else if (')]}'.includes(limpo[fim])) { if (nivel === 0) break; nivel--; }
          else if (limpo[fim] === ',' && nivel === 0) break;
        }
        corpo = limpo.slice(pos, fim);
      }
    }
    if (corpo === null) { r.naoAnalisadas.push(rotulo + ':' + linhaDe(m.index)); continue; }
    r.callbacks++;
    if (!p) continue; // callback sem parâmetro não lê o valor atual
    suspeitasDoCorpo(corpo, p).forEach(s => {
      const abs = limpo.indexOf(corpo, ini) + s.pos;
      // Mostra a linha ORIGINAL (no texto neutralizado as strings viram branco).
      const original = js.split('\n')[linhaDe(abs) - linhaBase] || s.txt;
      r.suspeitas.push(rotulo + ':' + linhaDe(abs) + '  ' + original.trim().slice(0, 160));
    });
  }
  return r;
}

function varrerArquivo(arquivo) {
  const src = fs.readFileSync(arquivo, 'utf8');
  const rotulo = path.relative(__dirname, arquivo).replace(/\\/g, '/');
  if (!arquivo.endsWith('.html')) return varrerJs(src, rotulo, 1);
  const total = {callbacks: 0, suspeitas: [], naoAnalisadas: []};
  const reScript = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = reScript.exec(src))) {
    const inicio = m.index + m[0].indexOf('>') + 1;
    const r = varrerJs(m[1], rotulo, src.slice(0, inicio).split('\n').length);
    total.callbacks += r.callbacks;
    total.suspeitas.push(...r.suspeitas);
    total.naoAnalisadas.push(...r.naoAnalisadas);
  }
  return total;
}

// 2a. O próprio scanner precisa pegar as formas que já existiram de verdade.
[
  ['ref.transaction(function(atual) { if (!atual) return; return atual; })', 1],
  ['ref.transaction((atual) => {\n  // comentário\n  if (!atual) return;\n  return atual; })', 1],
  ['ref.transaction(function(atual) { if (!atual || !(atual.saldoLote > 0) || atual.destinacao) return; return atual; })', 1],
  ['ref.transaction(function(p) { if (p === null) return; // abort\n p.x = 1; return p; })', 1],
  ['ref.transaction(function(atual) {\n if (atual !== \'PENDENTE\') return; // aborta\n return \'APROVADA\'; })', 1],
  ['ref.transaction(function(atual) { return atual === \'APROVADA\' ? \'CONSOLIDADA\' : undefined; })', 1],
  ['ref.transaction(a => a === "X" ? "Y" : undefined)', 1],
  ['ref.transaction(function(proc) { if (!proc || proc.status !== \'ABERTO\') { return; } return proc; })', 1],
  // formas corretas
  ['ref.transaction(function(atual) { if (!atual) return atual; if (atual.destinacao) return; return atual; })', 0],
  ['ref.transaction(function(atual) { if (atual === null) return atual; if (atual !== \'PENDENTE\') return; return \'A\'; })', 0],
  ['ref.transaction(function(atual) { if (atual === null) return atual; return atual === \'APROVADA\' ? \'C\' : undefined; })', 0],
  ['ref.transaction(function(atual) { if (atual !== null) return; return data; })', 0], // criar se ausente
  ['ref.transaction(function(atual) { if (atual) return; return registro; })', 0],
  ['ref.transaction(function(cur) { if (cur && cur.pedidoKey) return; return {}; })', 0],
  ['ref.transaction(function(atual) { atual = atual || {}; if (atual.finalizadoEm) return; return atual; })', 0],
  ['ref.transaction(function(cur) { return (cur || 0) + 1; })', 0],
  ['var s = "x.transaction(function(a){ if (!a) return; })"; // .transaction() citado em texto', 0],
].forEach(([codigo, esperado], i) => {
  const r = varrerJs(codigo, 'caso' + i, 1);
  assert.equal(r.suspeitas.length, esperado, 'scanner, caso ' + i + ': ' + codigo + '\n  -> ' + r.suspeitas.join(' | '));
});

// 2b. O repo inteiro.
const listar = (dir, filtro) => fs.readdirSync(dir).filter(filtro).map(n => path.join(dir, n));
const arquivos = [
  ...listar(path.join(__dirname, 'functions'), n => n.endsWith('.js')),
  ...listar(path.join(__dirname, 'public', 'shared'), n => n.endsWith('.js')),
  ...listar(path.join(__dirname, 'public'), n => n.endsWith('.html') || n.endsWith('.js')),
];
const geral = {callbacks: 0, suspeitas: [], naoAnalisadas: [], perdidos: []};
arquivos.forEach((a) => {
  const r = varrerArquivo(a);
  // Sanidade: se o parser se perder numa string/regex, o resto do arquivo
  // vira branco e callbacks somem EM SILÊNCIO. Confere contra a contagem
  // bruta do texto original (43 no repo em 2026-09-15).
  const bruto = (fs.readFileSync(a, 'utf8').match(/\.transaction\(\s*(?!\))/g) || []).length;
  if (bruto !== r.callbacks + r.naoAnalisadas.length) {
    geral.perdidos.push(path.relative(__dirname, a) + ': ' + bruto + ' no texto, ' + r.callbacks + ' lidos');
  }
  geral.callbacks += r.callbacks;
  geral.suspeitas.push(...r.suspeitas);
  geral.naoAnalisadas.push(...r.naoAnalisadas);
});
assert.deepEqual(geral.naoAnalisadas, [],
  'transaction com callback que o scanner não soube ler (função nomeada?) -- confira à mão e ensine o scanner:\n  ' +
  geral.naoAnalisadas.join('\n  '));
assert.deepEqual(geral.suspeitas, [],
  'transação que devolve undefined quando o valor é null aborta sem consultar o servidor:\n  ' +
  geral.suspeitas.join('\n  ') + '\n  Use `if (!atual) return atual;` antes da regra de negócio, para o SDK reexecutar com o dado real.');
assert.deepEqual(geral.perdidos, [],
  'o scanner leu menos callbacks do que o texto tem (parser se perdeu numa string/regex, ou há ".transaction(" citado em comentário):\n  ' +
  geral.perdidos.join('\n  '));

// ── 3. O site do bug especificamente, com a lição registrada ─────────────
const index = fs.readFileSync(path.join(__dirname, 'functions', 'index.js'), 'utf8');
const trecho = index.slice(index.indexOf('const lock = await confRef.transaction('));
assert.ok(trecho, 'transação do lock da Conferência de PA não encontrada');
assert.ok(/if \(!atual\) return atual;/.test(trecho.slice(0, 1200)),
  'o lock da Conferência de PA precisa devolver o próprio valor no null');
assert.ok(/Não há Conferência de PA registrada para esta OP/.test(index),
  'nó inexistente não pode ser reportado como disputa de sessão');

// ── 4. Ensaio das funções reais do cliente, com fake fiel ao SDK ──────────
// O fake de run_descarte_test.js entrega o dado real já na 1ª passada (cache
// quente) -- por isso nunca pegou o bug. Este aqui faz o que o SDK faz: 1ª
// passada com o cache (null por padrão), depois o valor do servidor; undefined
// aborta onde estiver; o valor devolvido na última passada é gravado (null
// sobre nó inexistente é commit que não grava nada).
function criarDbComoOSdk(dados) {
  const partes = (p) => String(p || '').split('/').filter(Boolean);
  const get = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), dados);
  const set = (p, v) => {
    const ks = partes(p), last = ks.pop(); let o = dados;
    if (v === null) { // apagar não cria caminho intermediário
      o = ks.reduce((a, k) => (a == null ? a : a[k]), o);
      if (o != null) delete o[last];
      return;
    }
    ks.forEach(k => { o = o[k] || (o[k] = {}); });
    o[last] = v;
  };
  const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
  const snap = (p) => ({ val: () => clone(get(p)), exists: () => get(p) != null });
  const ctl = {passadas: [], cacheQuente: false, antesDoServidor: null};
  let seq = 0;
  const db = {
    ctl,
    ref(p) {
      return {
        key: partes(p).slice(-1)[0] || null,
        once() { return Promise.resolve(snap(p)); },
        transaction(fn) {
          const passadas = [];
          const rodar = (v) => { passadas.push(v == null ? 'null' : 'dado'); return fn(clone(v)); };
          let out;
          if (!ctl.cacheQuente) {
            out = rodar(null);
            if (out === undefined) { ctl.passadas.push(passadas); return Promise.resolve({committed: false, snapshot: snap(p)}); }
          }
          if (ctl.antesDoServidor) { const f = ctl.antesDoServidor; ctl.antesDoServidor = null; f(); }
          if (ctl.cacheQuente || get(p) != null) {
            out = rodar(get(p));
            if (out === undefined) { ctl.passadas.push(passadas); return Promise.resolve({committed: false, snapshot: snap(p)}); }
          }
          ctl.passadas.push(passadas);
          set(p, out === undefined ? null : out);
          return Promise.resolve({committed: true, snapshot: snap(p)});
        },
        set(v) { set(p, v); return Promise.resolve(); },
        update(v) { set(p, Object.assign({}, get(p) || {}, v)); return Promise.resolve(); },
        push(v) {
          const key = 'k' + (++seq), filho = p + '/' + key;
          if (arguments.length) { set(filho, v); const pr = Promise.resolve({key}); pr.key = key; return pr; }
          return {key};
        },
      };
    },
  };
  return db;
}

function carregarUtils(arquivoOuFonte) {
  const ctx = {console, Promise, setTimeout, clearTimeout, Date, Math, Object, String, Number, Array, JSON};
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(arquivoOuFonte, ctx);
  return ctx;
}

const loteBase = () => ({itemTipo: 'material', itemCodigo: 'MP-001', itemNome: 'Ativo', loteOrigem: 'LOT-1', saldoLote: 12, status: 'REPROVADO', enderecoKey: 'A1'});

(async () => {
  const u = carregarUtils(fs.readFileSync(path.join(__dirname, 'public', 'shared', 'utils.js'), 'utf8'));

  // 4a. Cache frio, lote válido: segrega e depois confirma.
  let dados = {estoque_lotes: {'MP-001': {L1: loteBase()}}};
  let db = criarDbComoOSdk(dados);
  const sol = await u.solicitarDestinacaoLote(db, 'MP-001', 'L1', {quantidade: 7, motivo: 'Reprovado'}, 'Log');
  assert.equal(sol.ok, true, 'solicitar com cache frio: ' + sol.erro);
  assert.deepEqual(db.ctl.passadas[0], ['null', 'dado'], 'solicitar precisa reexecutar com o dado do servidor');
  assert.equal(dados.estoque_lotes['MP-001'].L1.status, 'AGUARDANDO_DESCARTE');
  assert.equal(dados.solicitacoes_descarte[sol.solicitacaoKey].statusAnterior, 'REPROVADO');
  const conf = await u.confirmarDestinacaoLote(db, sol.solicitacaoKey, 'Log', 'MTR-1');
  assert.equal(conf.ok, true, 'confirmar com cache frio: ' + conf.erro);
  assert.equal(conf.abatido, 7);
  assert.equal(dados.estoque_lotes['MP-001'].L1.saldoLote, 5);
  assert.equal(dados.solicitacoes_descarte[sol.solicitacaoKey].status, 'CONCLUIDO');

  // 4b. Mesmo fluxo com o código ANTERIOR à correção: é o sintoma relatado.
  const { execSync } = require('node:child_process');
  let antigo = null;
  try { antigo = execSync('git show 019cb52:public/shared/utils.js', {cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024}); } catch (e) { /* sem git: pula */ }
  if (antigo) {
    const v = carregarUtils(antigo);
    const d2 = {estoque_lotes: {'MP-001': {L1: loteBase()}}};
    const r = await v.solicitarDestinacaoLote(criarDbComoOSdk(d2), 'MP-001', 'L1', {quantidade: 7, motivo: 'x'}, 'Log');
    assert.equal(r.ok, false, 'o código antigo deveria reproduzir o bug no cache frio');
    d2.estoque_lotes['MP-001'].L1.destinacao = {solicitacaoKey: 'S1', statusAnterior: 'REPROVADO'};
    d2.solicitacoes_descarte = {S1: {status: 'SOLICITADO', itemKey: 'MP-001', loteKey: 'L1', quantidade: 7, itemCodigo: 'MP-001'}};
    const c = await v.confirmarDestinacaoLote(criarDbComoOSdk(d2), 'S1', 'Log', null);
    assert.equal(c.erro, 'Não foi possível confirmar a saída deste lote.', 'sintoma relatado reproduzido no código antigo');
  }

  // 4c. Lote inexistente: não cria solicitação órfã nem nó fantasma.
  dados = {estoque_lotes: {}};
  db = criarDbComoOSdk(dados);
  const inex = await u.solicitarDestinacaoLote(db, 'MP-001', 'NAO', {quantidade: 1, motivo: 'x'}, 'Log');
  assert.equal(inex.ok, false);
  assert.match(inex.erro, /não encontrado/);
  assert.equal(dados.solicitacoes_descarte, undefined, 'lote inexistente não pode gerar solicitação');
  assert.deepEqual(dados.estoque_lotes, {}, 'commit de null sobre null não grava nada');

  // 4d. Recusas de negócio com motivo claro (e ainda com cache frio).
  dados = {estoque_lotes: {'MP-001': {L1: Object.assign(loteBase(), {destinacao: {solicitacaoKey: 'X'}})}}};
  let rr = await u.solicitarDestinacaoLote(criarDbComoOSdk(dados), 'MP-001', 'L1', {quantidade: 1, motivo: 'x'}, 'Log');
  assert.match(rr.erro, /já está segregado/);
  dados = {estoque_lotes: {'MP-001': {L1: loteBase()}}};
  rr = await u.solicitarDestinacaoLote(criarDbComoOSdk(dados), 'MP-001', 'L1', {quantidade: 13, motivo: 'x'}, 'Log');
  assert.match(rr.erro, /maior que o saldo/);
  dados = {estoque_lotes: {'MP-001': {L1: Object.assign(loteBase(), {saldoLote: 0})}}};
  rr = await u.solicitarDestinacaoLote(criarDbComoOSdk(dados), 'MP-001', 'L1', {quantidade: 1, motivo: 'x'}, 'Log');
  assert.match(rr.erro, /não tem saldo/);

  // 4e. Confirmar: segregação cancelada/substituída, e lote apagado.
  const comSolic = (lote) => ({
    estoque_lotes: {'MP-001': lote ? {L1: lote} : {}},
    solicitacoes_descarte: {S1: {status: 'SOLICITADO', itemKey: 'MP-001', loteKey: 'L1', quantidade: 7, itemCodigo: 'MP-001'}},
  });
  dados = comSolic(Object.assign(loteBase(), {destinacao: {solicitacaoKey: 'OUTRA'}}));
  rr = await u.confirmarDestinacaoLote(criarDbComoOSdk(dados), 'S1', 'Log', null);
  assert.match(rr.erro, /não está mais segregado/);
  assert.equal(dados.solicitacoes_descarte.S1.status, 'SOLICITADO');
  dados = comSolic(null);
  rr = await u.confirmarDestinacaoLote(criarDbComoOSdk(dados), 'S1', 'Log', null);
  assert.match(rr.erro, /não encontrado/);
  assert.equal(dados.solicitacoes_descarte.S1.status, 'SOLICITADO', 'lote apagado não conclui a solicitação');
  assert.equal(dados.movimentos_estoque, undefined, 'lote apagado não gera movimento');

  // 4f. Estado de passada anterior não vaza: 1ª passada (cache quente, velho)
  // calcula abatido; antes de gravar, outra sessão apaga o lote; a reexecução
  // vê null e commita null. Sem zerar `abatido`, isso virava "saída confirmada".
  dados = comSolic(Object.assign(loteBase(), {destinacao: {solicitacaoKey: 'S1', statusAnterior: 'REPROVADO'}}));
  db = criarDbComoOSdk(dados);
  const loteVelho = dados.estoque_lotes['MP-001'].L1;
  const dbCorrida = {ref(p) {
    const r = db.ref(p);
    if (p !== 'estoque_lotes/MP-001/L1') return r;
    r.transaction = function(fn) {
      assert.notEqual(fn(JSON.parse(JSON.stringify(loteVelho))), undefined, 'passada com o cache velho aceita');
      delete dados.estoque_lotes['MP-001'].L1; // servidor divergiu: reexecuta
      const out = fn(null);
      if (out === undefined) return Promise.resolve({committed: false, snapshot: {val: () => null, exists: () => false}});
      return Promise.resolve({committed: true, snapshot: {val: () => null, exists: () => false}});
    };
    return r;
  }};
  rr = await u.confirmarDestinacaoLote(dbCorrida, 'S1', 'Log', null);
  assert.equal(rr.ok, false, 'abatido da passada anterior não pode confirmar saída de lote apagado');
  assert.equal(dados.solicitacoes_descarte.S1.status, 'SOLICITADO');

  // 4g. ajustarProduzidoOp: cache frio e OP inexistente.
  dados = {ops: {'26247_02': {lote: '26247/02', produzidoLinha: 100, produzido: 100, status: 'Em Produção'}}};
  db = criarDbComoOSdk(dados);
  let aj = await u.ajustarProduzidoOp(db, '26247_02', 'linha', -10);
  assert.equal(aj.ok, true, 'ajustarProduzidoOp com cache frio: ' + aj.erro);
  assert.equal(aj.novoTotal, 90);
  aj = await u.ajustarProduzidoOp(criarDbComoOSdk(dados), 'NAO_EXISTE', 'linha', 5);
  assert.equal(aj.ok, false);
  assert.match(aj.erro, /não encontrada/);
  assert.equal(dados.ops.NAO_EXISTE, undefined, 'OP inexistente não pode nascer do ajuste');

  console.log('run_transacoes_null_test: OK (' + arquivos.length + ' arquivos varridos, ' +
    geral.callbacks + ' callbacks de transaction analisados; Descarte e ajustarProduzidoOp ensaiados com cache frio)');
})().catch((e) => { console.error(e); process.exit(1); });
