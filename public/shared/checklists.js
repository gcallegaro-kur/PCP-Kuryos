/* Motor de checklists editáveis da Qualidade (19/10/2026) -- PLANO_QUALIDADE.md, A2 / D6.

   Pedido do usuário: "queria ter a opção de sempre ir aperfeiçoando as
   perguntas também, vide problemas que vamos identificando no dia a dia".
   Por isso as perguntas NÃO moram no código: a Qualidade edita o modelo e
   publica uma versão nova. Versão publicada é imutável, e cada inspeção
   guarda a versão que usou -- a inspeção de ontem continua mostrando as
   perguntas de ontem, mesmo depois que o modelo mudou.

   Gravação:
     checklist_modelos/{id}                  {codigo, nome, descricao, ativo, versaoAtual, rascunho?}
     checklist_modelos/{id}/versoes/{n}      {itens:[...], nota, criadaEm, criadaPor}  (só acrescenta)

   Item:
     {id, secao, texto, como, tipo, papel, critico, foto, obrigatorio,
      medida:{unidade,min,max}, amostras:{n,unidade,nominal,tolInfPct,tolSupPct}, opcoes:[...]}
     tipo   SNA (Sim/Não/NA) | MEDIDA (um número) | AMOSTRAS (n números: peso do
            first article) | ESCOLHA (uma da lista) | TEXTO
     papel  EXECUTOR (quem faz: operador/manipulador) | QUALIDADE (quem verifica)
     foto   NUNCA | NC (só se não conforme) | SEMPRE
   Resposta por item: {r:'S'|'N'|'NA', valor, valores:[], escolha, texto, obs, fotos:[]}

   Funções PURAS, testadas em run_checklists_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Checklists = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var TIPOS = {SNA: 'Sim / Não / NA', MEDIDA: 'Medida (um número)', AMOSTRAS: 'Amostras (vários números)', ESCOLHA: 'Escolha numa lista', TEXTO: 'Texto livre'};
  var PAPEIS = {EXECUTOR: 'Quem executa', QUALIDADE: 'Qualidade (verificação)'};
  var FOTOS = {NUNCA: 'Sem foto', NC: 'Foto se não conforme', SEMPRE: 'Foto sempre'};

  function txt(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { if (v === '' || v == null) return null; var n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : null; }
  function arred(v, c) { var f = Math.pow(10, c == null ? 3 : c); return Math.round(v * f) / f; }
  function idNovo(usados) {
    var u = usados || {}, id;
    do { id = 'i' + Math.random().toString(36).slice(2, 7); } while (u[id]);
    return id;
  }

  function normalizarItem(it, usados) {
    it = it || {};
    var tipo = TIPOS[it.tipo] ? it.tipo : 'SNA';
    var out = {
      id: txt(it.id) || idNovo(usados),
      secao: txt(it.secao) || null,
      texto: txt(it.texto),
      como: txt(it.como) || null,
      tipo: tipo,
      papel: PAPEIS[it.papel] ? it.papel : 'QUALIDADE',
      critico: !!it.critico,
      foto: FOTOS[it.foto] ? it.foto : 'NC',
      obrigatorio: it.obrigatorio !== false
    };
    if (tipo === 'MEDIDA') out.medida = {unidade: txt((it.medida || {}).unidade) || null, min: num((it.medida || {}).min), max: num((it.medida || {}).max)};
    if (tipo === 'AMOSTRAS') {
      var a = it.amostras || {};
      out.amostras = {n: Math.max(1, Math.round(num(a.n) || 1)), unidade: txt(a.unidade) || null,
        nominal: a.nominal === 'PRODUTO' ? 'PRODUTO' : num(a.nominal),
        tolInfPct: num(a.tolInfPct), tolSupPct: num(a.tolSupPct)};
    }
    if (tipo === 'ESCOLHA') out.opcoes = (it.opcoes || []).map(txt).filter(Boolean);
    return out;
  }

  function normalizarItens(itens) {
    var usados = {};
    return (itens || []).map(function(it) { var n = normalizarItem(it, usados); usados[n.id] = 1; return n; });
  }

  // Erros que impedem publicar a versão.
  function validarItens(itens) {
    var erros = [], ids = {};
    if (!itens || !itens.length) erros.push('O checklist precisa de pelo menos uma pergunta.');
    (itens || []).forEach(function(it, i) {
      var p = 'Pergunta ' + (i + 1) + ': ';
      if (!txt(it.texto)) erros.push(p + 'escreva o texto.');
      if (ids[it.id]) erros.push(p + 'identificador repetido.');
      ids[it.id] = 1;
      if (it.tipo === 'MEDIDA' && it.medida && it.medida.min != null && it.medida.max != null && it.medida.min > it.medida.max) erros.push(p + 'o mínimo é maior que o máximo.');
      if (it.tipo === 'AMOSTRAS') {
        var a = it.amostras || {};
        if (!(a.n >= 1)) erros.push(p + 'informe quantas amostras.');
        if (a.nominal == null) erros.push(p + 'informe o valor nominal (ou "do produto").');
      }
      if (it.tipo === 'ESCOLHA' && (it.opcoes || []).length < 2) erros.push(p + 'a lista precisa de ao menos 2 opções.');
      if (it.critico && it.tipo !== 'SNA' && it.tipo !== 'MEDIDA' && it.tipo !== 'AMOSTRAS') erros.push(p + 'só pergunta Sim/Não, medida ou amostras pode ser crítica.');
    });
    return erros;
  }

  // O que mudou entre duas versões (para o histórico mostrar).
  function diferencas(antes, depois) {
    var a = {}, d = {};
    (antes || []).forEach(function(it) { a[it.id] = it; });
    (depois || []).forEach(function(it) { d[it.id] = it; });
    var incluidos = (depois || []).filter(function(it) { return !a[it.id]; }).map(function(it) { return it.texto; });
    var removidos = (antes || []).filter(function(it) { return !d[it.id]; }).map(function(it) { return it.texto; });
    var alterados = (depois || []).filter(function(it) {
      return a[it.id] && JSON.stringify(normalizarItem(a[it.id])) !== JSON.stringify(normalizarItem(it));
    }).map(function(it) { return it.texto; });
    return {incluidos: incluidos, removidos: removidos, alterados: alterados};
  }

  function versaoAtual(modelo) {
    if (!modelo || !modelo.versoes) return null;
    var n = modelo.versaoAtual || Math.max.apply(null, Object.keys(modelo.versoes).map(Number));
    var v = modelo.versoes[n];
    return v ? {numero: Number(n), itens: v.itens || [], nota: v.nota || null, criadaEm: v.criadaEm || null, criadaPor: v.criadaPor || null} : null;
  }

  /* Publica a versão seguinte. Devolve {erro} ou {updates, numero}.
     Nada muda se as perguntas forem iguais às da versão atual. */
  function publicar(modeloId, modelo, itens, o) {
    o = o || {};
    var limpos = normalizarItens(itens);
    var erros = validarItens(limpos);
    if (erros.length) return {erro: erros.join(' ')};
    var atual = versaoAtual(modelo);
    if (atual && JSON.stringify(normalizarItens(atual.itens)) === JSON.stringify(limpos)) return {erro: 'Nada mudou desde a versão ' + atual.numero + '.'};
    var numero = atual ? atual.numero + 1 : 1;
    var base = 'checklist_modelos/' + modeloId;
    var u = {};
    u[base + '/versoes/' + numero] = {itens: limpos, nota: txt(o.nota) || null, criadaEm: o.agora, criadaPor: o.por || null};
    u[base + '/versaoAtual'] = numero;
    u[base + '/rascunho'] = null;
    u[base + '/atualizadoEm'] = o.agora;
    u[base + '/atualizadoPor'] = o.por || null;
    return {updates: u, numero: numero};
  }

  /* ── Avaliação de um checklist preenchido ── */

  // Estatística das amostras (first article): média e unidades fora da tolerância.
  function avaliarAmostras(item, valores, nominalProduto) {
    var a = item.amostras || {};
    var vs = (valores || []).map(num).filter(function(v) { return v != null; });
    var nominal = a.nominal === 'PRODUTO' ? num(nominalProduto) : num(a.nominal);
    var r = {n: vs.length, esperado: a.n, nominal: nominal, media: null, min: null, max: null, abaixo: 0, acima: 0, limiteInf: null, limiteSup: null};
    if (!vs.length) return r;
    r.media = arred(vs.reduce(function(s, v) { return s + v; }, 0) / vs.length, 2);
    r.min = Math.min.apply(null, vs); r.max = Math.max.apply(null, vs);
    if (nominal != null) {
      if (a.tolInfPct != null) r.limiteInf = arred(nominal * (1 - a.tolInfPct / 100), 2);
      if (a.tolSupPct != null) r.limiteSup = arred(nominal * (1 + a.tolSupPct / 100), 2);
      r.abaixo = r.limiteInf == null ? 0 : vs.filter(function(v) { return v < r.limiteInf; }).length;
      r.acima = r.limiteSup == null ? 0 : vs.filter(function(v) { return v > r.limiteSup; }).length;
    }
    return r;
  }

  /* itens: da versão usada; respostas: {id: resposta}; ctx: {papel, nominalProduto}.
     Com ctx.papel, só os itens daquele papel contam (o operador fecha a parte
     dele; a Qualidade fecha a dela). */
  function avaliar(itens, respostas, ctx) {
    ctx = ctx || {};
    var res = respostas || {};
    var out = {itens: [], pendentes: [], ncs: [], criticosNC: [], faltaFoto: [], resultado: 'INCOMPLETO'};
    (itens || []).forEach(function(it) {
      if (ctx.papel && it.papel !== ctx.papel) return;
      var r = res[it.id] || {}, sit = 'OK', det = null;
      if (it.tipo === 'SNA') {
        if (!r.r) sit = it.obrigatorio === false ? 'NA' : 'PENDENTE';
        else if (r.r === 'N') sit = 'NC';
        else if (r.r === 'NA') sit = it.critico ? 'PENDENTE' : 'NA';
        if (r.r === 'NA' && it.critico) det = 'Pergunta crítica não aceita NA.';
      } else if (it.tipo === 'MEDIDA') {
        var v = num(r.valor), m = it.medida || {};
        if (v == null) sit = it.obrigatorio === false ? 'NA' : 'PENDENTE';
        else if ((m.min != null && v < m.min) || (m.max != null && v > m.max)) { sit = 'NC'; det = v + ' fora de ' + (m.min != null ? m.min : '…') + '–' + (m.max != null ? m.max : '…') + (m.unidade ? ' ' + m.unidade : ''); }
      } else if (it.tipo === 'AMOSTRAS') {
        var e = avaliarAmostras(it, r.valores, ctx.nominalProduto);
        det = e;
        if (e.n < e.esperado) sit = it.obrigatorio === false && !e.n ? 'NA' : 'PENDENTE';
        else if (e.nominal == null) sit = 'PENDENTE';
        else if (e.abaixo || e.acima) sit = 'NC';
      } else if (it.tipo === 'ESCOLHA') {
        if (!txt(r.escolha)) sit = it.obrigatorio === false ? 'NA' : 'PENDENTE';
      } else if (it.tipo === 'TEXTO') {
        if (!txt(r.texto)) sit = it.obrigatorio === false ? 'NA' : 'PENDENTE';
      }
      var temFoto = (r.fotos || []).length > 0;
      if (sit !== 'PENDENTE' && sit !== 'NA' && !temFoto && (it.foto === 'SEMPRE' || (it.foto === 'NC' && sit === 'NC'))) out.faltaFoto.push(it.id);
      out.itens.push({id: it.id, situacao: sit, detalhe: det});
      if (sit === 'PENDENTE') out.pendentes.push(it.id);
      if (sit === 'NC') { out.ncs.push(it.id); if (it.critico) out.criticosNC.push(it.id); }
    });
    out.resultado = out.pendentes.length || out.faltaFoto.length ? 'INCOMPLETO' : (out.ncs.length ? 'REPROVADO' : 'APROVADO');
    return out;
  }

  return {
    TIPOS: TIPOS, PAPEIS: PAPEIS, FOTOS: FOTOS,
    normalizarItem: normalizarItem, normalizarItens: normalizarItens, validarItens: validarItens,
    diferencas: diferencas, versaoAtual: versaoAtual, publicar: publicar,
    avaliar: avaliar, avaliarAmostras: avaliarAmostras, idNovo: idNovo
  };
});
