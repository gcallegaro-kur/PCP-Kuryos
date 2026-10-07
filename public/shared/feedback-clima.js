/* Feedback e Clima (06/10/2026) -- regras puras.

   Origem: especificação do RH (Kuryos_Modulo_Feedback_Clima_Especificacao_v2.docx), adaptada ao Firebase (as regras R1–R15
   que lá são "HTTP 403/409" aqui são as regras do banco + as funções abaixo, todas testadas em run_feedback_clima_test.js).

   Um formulário curto e recorrente, três blocos: avaliar os PARES do mesmo setor, avaliar o LÍDER direto e a PESQUISA DE CLIMA
   (uma vez por período). Escala 1 a 5. Só o RH vê resultado; o colaborador responde e não vê nota nem média.
   Periodicidade: semanal até a virada (quinzenalAPartirDe = 2026-11-02, sempre uma segunda) e quinzenal depois.
   Temporários são AVALIADOS pelos registrados do mesmo setor, mas NÃO respondem a pesquisa (não têm login).

   Decisões deste módulo (além da spec):
   - quem é meu liderado direto (gestorKey = eu) não aparece como "par" para mim: o fluxo é lateral e de baixo para cima;
   - temporário só é avaliável se trabalhou (OK) nos últimos 14 dias e está Ativo;
   - clima por setor com menos de 3 respostas não é publicado (A-04), só informa o N. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FeedbackClima = factory();
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  var MAX_ITENS = 8, ESCALA = [1, 2, 3, 4, 5], JANELA_TEMPORARIO_DIAS = 14, MIN_SETOR_CLIMA = 3;
  var CICLO_PADRAO = {ativo: true, periodicidade: 'semanal', quinzenalAPartirDe: '2026-11-02', nMinimo: 3, rhVeAutoria: true, rhVeAutoriaClima: true,
                      limiteLider: 3.0, limitePessoa: 3.0, quedaBrusca: 0.5, cobrancaAtiva: false};
  var MODELO_PAR = [
    {id: 'espirito-de-equipe', nome: 'Espírito de Equipe', def: 'Ajuda quando alguém precisa e compartilha o que sabe.'},
    {id: 'habilidade', nome: 'Habilidade', def: 'Domina o que faz e entrega com qualidade.'},
    {id: 'respeito', nome: 'Respeito', def: 'Trata os colegas com educação, mesmo sob pressão.'},
    {id: 'comunicacao', nome: 'Comunicação', def: 'Avisa a tempo sobre problemas, atrasos e mudanças.'}
  ];
  var MODELO_LIDER = [
    {id: 'clareza', nome: 'Clareza', def: 'Deixa claro o que se espera do meu trabalho.'},
    {id: 'apoio', nome: 'Apoio', def: 'Remove obstáculos e me dá condições de trabalhar bem.'},
    {id: 'feedback', nome: 'Feedback', def: 'Me diz o que estou indo bem e o que preciso melhorar.'},
    {id: 'respeito', nome: 'Respeito', def: 'Me trata com respeito, inclusive quando corrige.'}
  ];
  var MODELO_CLIMA = [
    {id: 'humor', texto: 'Como você se sentiu no trabalho nesta semana?', tipo: 'escala', indice: true},
    {id: 'condicoes', texto: 'Tive as condições e os materiais necessários para fazer meu trabalho.', tipo: 'escala', indice: true, condicoes: true},
    {id: 'recomendaria', texto: 'Recomendaria a Kuryos como um bom lugar para trabalhar.', tipo: 'escala', indice: true, enps: true}
  ];

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function txt(v) { return v == null ? '' : String(v).trim(); }
  function norm(s) { return txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').toLowerCase(); }
  function pad2(n) { return ('0' + n).slice(-2); }
  function media(a) { if (!a.length) return null; var s = 0; a.forEach(function(x) { s += x; }); return s / a.length; }
  function desvio(a) { if (a.length < 2) return a.length ? 0 : null; var m = media(a), s = 0; a.forEach(function(x) { s += (x - m) * (x - m); }); return Math.sqrt(s / a.length); }
  function idDe(nome) { return norm(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item'; }

  /* ── datas (texto AAAA-MM-DD, aritmética em UTC) ── */
  function dt(ymd) { var p = String(ymd).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function fmt(d) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function dataValida(ymd) { return /^\d{4}-\d{2}-\d{2}$/.test(String(ymd)) && fmt(dt(ymd)) === ymd; }
  function somaDias(ymd, n) { var d = dt(ymd); d.setUTCDate(d.getUTCDate() + n); return fmt(d); }
  function diasEntre(a, b) { return Math.round((dt(b) - dt(a)) / 86400000); }
  function segundaDe(ymd) { var w = dt(ymd).getUTCDay(); return somaDias(ymd, 1 - (w === 0 ? 7 : w)); }
  function dataBR(ymd) { var p = String(ymd || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : ''; }

  /* semana ISO: a que contém a quinta-feira define o ano */
  function semanaIso(ymd) {
    var d = dt(ymd), dow = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dow + 3);
    var ano = d.getUTCFullYear(), jan4 = new Date(Date.UTC(ano, 0, 4)), j4 = (jan4.getUTCDay() + 6) % 7;
    return {ano: ano, semana: 1 + Math.round(((d - jan4) / 86400000 - 3 + j4) / 7)};
  }
  function segundaDaSemanaIso(ano, semana) {
    var jan4 = fmt(new Date(Date.UTC(ano, 0, 4)));
    return somaDias(segundaDe(jan4), (semana - 1) * 7);
  }

  /* ── ciclo e período ── */
  function ciclo(cfg) {
    var c = cfg && typeof cfg === 'object' ? cfg : {}, o = Object.assign({}, CICLO_PADRAO);
    Object.keys(CICLO_PADRAO).forEach(function(k) {
      if (k === 'quinzenalAPartirDe' && c[k] === '') { o[k] = ''; return; }          // apagar a data desliga a virada automática
      if (c[k] == null || c[k] === '') return;
      o[k] = typeof CICLO_PADRAO[k] === 'boolean' ? c[k] === true : typeof CICLO_PADRAO[k] === 'number' ? (isFinite(Number(c[k])) ? Number(c[k]) : o[k]) : c[k];
    });
    return o;
  }
  function periodicidadeVigente(hoje, cfg) {
    var c = ciclo(cfg);
    if (c.quinzenalAPartirDe && dataValida(c.quinzenalAPartirDe) && hoje >= c.quinzenalAPartirDe) return 'quinzenal';
    return c.periodicidade === 'quinzenal' ? 'quinzenal' : 'semanal';
  }
  function periodoDe(hoje, cfg) {
    var tipo = periodicidadeVigente(hoje, cfg), seg = segundaDe(hoje), iso = semanaIso(hoje);
    if (tipo === 'semanal') {
      return {id: iso.ano + '-S' + pad2(iso.semana), tipo: tipo, inicio: seg, prazo: somaDias(seg, 4), fim: somaDias(seg, 6)};
    }
    var q = Math.ceil(iso.semana / 2), inicio = iso.semana % 2 === 1 ? seg : somaDias(seg, -7);
    return {id: iso.ano + '-Q' + pad2(q), tipo: tipo, inicio: inicio, prazo: somaDias(inicio, 11), fim: somaDias(inicio, 13)};
  }
  function inicioDoPeriodo(id) {
    var m = /^(\d{4})-([SQ])(\d{2})$/.exec(String(id));
    if (!m) return null;
    var n = +m[3];
    return segundaDaSemanaIso(+m[1], m[2] === 'S' ? n : 2 * n - 1);
  }
  function periodoAnterior(p, cfg) { return periodoDe(somaDias(p.inicio, -1), cfg); }
  function ordenarPeriodos(ids) {
    return ids.filter(function(i) { return inicioDoPeriodo(i); }).sort(function(a, b) { return inicioDoPeriodo(a).localeCompare(inicioDoPeriodo(b)); });
  }
  function rotuloPeriodo(p) {
    return (p.tipo === 'quinzenal' ? 'Quinzena' : 'Semana') + ' de ' + dataBR(p.inicio).slice(0, 5) + ' a ' + dataBR(p.tipo === 'quinzenal' ? somaDias(p.inicio, 11) : somaDias(p.inicio, 4)).slice(0, 5);
  }

  /* ── quem avalia quem (R1–R4) ── */
  function ativoNoDiretorio(x) {
    if (!x || !txt(x.nome)) return false;
    return x.tipo === 'temporario' ? x.status === 'Ativo' : x.status !== 'Desligado' && x.status !== 'Inativo';
  }
  function alvosDe(meuId, diretorio, hoje) {
    var eu = diretorio && diretorio[meuId], vazio = {pares: [], lider: null, semSetor: false, ok: false};
    if (!eu || eu.tipo === 'temporario' || !ativoNoDiretorio(eu)) return vazio;
    var meuSetor = norm(eu.setor), pares = [], lider = null;
    if (eu.gestorKey && eu.gestorKey !== meuId && ativoNoDiretorio(diretorio[eu.gestorKey])) lider = {id: eu.gestorKey, nome: diretorio[eu.gestorKey].nome};
    if (meuSetor) {
      Object.keys(diretorio).forEach(function(id) {
        var x = diretorio[id];
        if (id === meuId || id === eu.gestorKey || !ativoNoDiretorio(x) || norm(x.setor) !== meuSetor) return;
        if (x.gestorKey === meuId) return;                                           // meu liderado direto
        if (x.tipo === 'temporario' && !(x.ultimoOk && dataValida(x.ultimoOk) && diasEntre(x.ultimoOk, hoje) <= JANELA_TEMPORARIO_DIAS && diasEntre(x.ultimoOk, hoje) >= -7)) return;
        pares.push({id: id, nome: x.nome, tipo: x.tipo === 'temporario' ? 'temporario' : 'colaborador'});
      });
      pares.sort(function(a, b) { return norm(a.nome).localeCompare(norm(b.nome)); });
    }
    return {pares: pares, lider: lider, semSetor: !meuSetor, ok: true};
  }

  /* ── validação das respostas (R11, R12, R13) ── */
  function criterios(modelo) { return Array.isArray(modelo) ? modelo : []; }
  function validarNotas(modelo, notas) {
    var e = [];
    criterios(modelo).forEach(function(c) {
      var n = notas && notas[c.id];
      if (!(ESCALA.indexOf(n) >= 0)) e.push('Dê uma nota de 1 a 5 em "' + c.nome + '".');
    });
    return e;
  }
  function validarResposta(modelo, resposta) {
    var e = validarNotas(modelo, resposta && resposta.notas);
    if (resposta && txt(resposta.comentario).length > 1000) e.push('O comentário passa de 1000 caracteres.');
    return e;
  }
  function validarClima(modelo, respostas, recado) {
    var e = [];
    criterios(modelo).forEach(function(q) {
      var v = respostas && respostas[q.id];
      if (q.tipo === 'texto') { if (txt(v).length > 1000) e.push('A resposta de "' + q.texto + '" passa de 1000 caracteres.'); }
      else if (!(ESCALA.indexOf(v) >= 0)) e.push('Responda de 1 a 5: "' + q.texto + '"');
    });
    if (txt(recado).length > 2000) e.push('O recado ao RH passa de 2000 caracteres.');
    return e;
  }
  function validarModelo(tipo, lista) {
    var e = [];
    if (!Array.isArray(lista) || !lista.length) return ['O formulário precisa de ao menos um item.'];
    if (lista.length > MAX_ITENS) e.push('O formulário aceita no máximo ' + MAX_ITENS + ' itens (ele é recorrente e precisa continuar rápido).');
    var vistos = {};
    lista.forEach(function(x, i) {
      var rotulo = tipo === 'clima' ? txt(x.texto) : txt(x.nome);
      if (!rotulo) e.push('O item ' + (i + 1) + ' está sem ' + (tipo === 'clima' ? 'texto' : 'nome') + '.');
      if (!txt(x.id)) e.push('O item ' + (i + 1) + ' está sem identificador.');
      else if (vistos[x.id]) e.push('Itens repetidos (' + x.id + ').');
      vistos[x.id] = true;
      if (tipo === 'clima' && x.tipo !== 'escala' && x.tipo !== 'texto') e.push('O item ' + (i + 1) + ' precisa ser escala ou texto.');
    });
    return e;
  }

  /* ── pendências (R15): quem não completou TODOS os itens do período ── */
  function pendencias(periodoId, diretorio, participacao, hoje, opcoes) {
    opcoes = opcoes || {};
    var part = (participacao && participacao[periodoId]) || {}, out = [];
    Object.keys(diretorio || {}).forEach(function(id) {
      var x = diretorio[id];
      if (!x || x.tipo === 'temporario' || !ativoNoDiretorio(x)) return;
      var a = alvosDe(id, diretorio, hoje), p = part[id] || {}, faltam = [];
      var paresFeitos = Math.min(num(p.pares), a.pares.length), paresFalta = a.pares.length - paresFeitos;
      if (paresFalta > 0) faltam.push(paresFalta + (paresFalta === 1 ? ' colega' : ' colegas') + ' a avaliar');
      if (a.lider && !p.lider) faltam.push('líder (' + a.lider.nome + ')');
      if (opcoes.comClima !== false && !p.clima) faltam.push('pesquisa de clima');
      var lider = x.gestorKey && diretorio[x.gestorKey] ? diretorio[x.gestorKey].nome : '';
      out.push({id: id, nome: x.nome, setor: x.setor || '', lider: lider, semLogin: !x.uidLogin && !opcoes.semLoginIgnorar, semSetor: a.semSetor, faltam: faltam,
                esperado: a.pares.length + (a.lider ? 1 : 0) + (opcoes.comClima !== false ? 1 : 0), feito: paresFeitos + (a.lider && p.lider ? 1 : 0) + (opcoes.comClima !== false && p.clima ? 1 : 0)});
    });
    out.sort(function(a, b) { return norm(a.nome).localeCompare(norm(b.nome)); });
    return out;
  }

  /* ── diretório (o que todo colaborador pode ler: nome, setor, líder; nunca CPF, salário ou login) ── */
  function setorDe(c, cargos) { return txt(c && c.setor) || txt(cargos && c && c.cargoKey && cargos[c.cargoKey] && cargos[c.cargoKey].setor); }
  function entradaColaborador(c, cargos) {
    var setor = setorDe(c, cargos);
    return {nome: txt(c.nome), setor: setor || null, setorChave: norm(setor) || null, gestorKey: c.gestorKey || null, status: c.status || 'Ativo', tipo: 'colaborador'};
  }
  function ultimoOkDe(id, presenca) {
    var u = null;
    Object.keys(presenca || {}).forEach(function(d) { if (presenca[d] && presenca[d][id] === 'OK' && (!u || d > u)) u = d; });
    return u;
  }
  function entradaTemporario(t, ultimoOk) {
    var setor = txt(t.setor);
    return {nome: txt(t.nome), setor: setor || null, setorChave: norm(setor) || null, gestorKey: null, status: t.status === 'Ativo' ? 'Ativo' : 'Inativo', tipo: 'temporario', ultimoOk: ultimoOk || null};
  }
  /* Reconstrói o diretório a partir do cadastro do RH e devolve só o que mudou, em caminhos planos
     (feedback_diretorio/{id}, feedback_diretorio_por_uid/{uid}); o que sumiu da origem vira null. */
  function montarDiretorio(o) {
    var dir = {}, porUid = {}, up = {};
    Object.keys(o.colaboradores || {}).forEach(function(id) {
      var c = o.colaboradores[id]; if (!c || !txt(c.nome)) return;
      dir[id] = entradaColaborador(c, o.cargos);
      if (c.uidLogin && c.status !== 'Desligado') porUid[c.uidLogin] = id;
    });
    Object.keys(o.temporarios || {}).forEach(function(id) {
      var t = o.temporarios[id]; if (!t || !txt(t.nome)) return;
      dir[id] = entradaTemporario(t, ultimoOkDe(id, o.presenca));
    });
    function igual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
    function limpo(x) { var r = {}; Object.keys(x || {}).forEach(function(k) { if (x[k] != null) r[k] = x[k]; }); return r; }
    Object.keys(dir).forEach(function(id) { var novo = limpo(dir[id]); if (!igual(novo, limpo((o.dirAtual || {})[id]))) up['feedback_diretorio/' + id] = novo; });
    Object.keys(o.dirAtual || {}).forEach(function(id) { if (!dir[id]) up['feedback_diretorio/' + id] = null; });
    Object.keys(porUid).forEach(function(u) { if ((o.porUidAtual || {})[u] !== porUid[u]) up['feedback_diretorio_por_uid/' + u] = porUid[u]; });
    Object.keys(o.porUidAtual || {}).forEach(function(u) { if (!porUid[u]) up['feedback_diretorio_por_uid/' + u] = null; });
    return {atualizacoes: up, total: Object.keys(dir).length, comLogin: Object.keys(porUid).length};
  }

  /* ── indicadores do dashboard (seção 8 da spec) ── */
  function mediaNotas(r) { var v = Object.keys(r.notas || {}).map(function(k) { return num(r.notas[k]); }).filter(function(n) { return n >= 1 && n <= 5; }); return media(v); }
  function respostasDoPeriodo(respostas, pid, tipo) {
    var o = (respostas && respostas[pid]) || {};
    return Object.keys(o).map(function(k) { return o[k]; }).filter(function(r) { return r && (!tipo || r.tipo === tipo); });
  }
  function climaDoPeriodo(clima, pid) { var o = (clima && clima[pid]) || {}; return Object.keys(o).map(function(k) { return Object.assign({_k: k}, o[k]); }).filter(Boolean); }
  function indiceDaResposta(r, modeloClima) {
    var vs = criterios(modeloClima).filter(function(q) { return q.tipo === 'escala' && q.indice; }).map(function(q) { return num(r.respostas && r.respostas[q.id]); }).filter(function(n) { return n >= 1 && n <= 5; });
    return media(vs);
  }
  function indiceClima(lista, modeloClima) { return media(lista.map(function(r) { return indiceDaResposta(r, modeloClima); }).filter(function(x) { return x != null; })); }
  function variacao(atual, anterior) { return atual == null || anterior == null ? null : atual - anterior; }
  /* setor "Produção" e "produção" são o mesmo setor: agrupa por texto normalizado e mostra a primeira grafia vista */
  var rotulosSetor = {};
  function chaveSetor(v) { var t = txt(v); if (!t) return 'sem setor'; var k = norm(t); if (!rotulosSetor[k]) rotulosSetor[k] = t; return k; }
  function rotuloDoSetor(k) { return k === 'sem setor' ? 'Sem setor' : rotulosSetor[k] || k; }
  function agrupar(lista, chave) { var g = {}; lista.forEach(function(x) { var k = chave(x); if (k == null || k === '') return; (g[k] = g[k] || []).push(x); }); return g; }

  function dashboard(d) {
    var cfg = ciclo(d.ciclo), mod = d.modelos || {}, pid = d.periodo, hoje = d.hoje;
    var dir = d.diretorio || {}, rh = d.rh || {};
    var periodos = ordenarPeriodos(Array.prototype.concat(Object.keys(d.respostas || {}), Object.keys(d.clima || {}), Object.keys(d.participacao || {}), [pid]).filter(function(x, i, a) { return a.indexOf(x) === i; }));
    var idx = periodos.indexOf(pid), anteriores = periodos.slice(0, idx), ant = anteriores.length ? anteriores[anteriores.length - 1] : null;
    var out = {periodo: pid, periodoAnterior: ant};

    /* 8.1 o ciclo está rodando */
    var pend = pendencias(pid, dir, d.participacao, hoje);
    var esp = 0, fei = 0; pend.forEach(function(p) { esp += p.esperado; fei += p.feito; });
    out.participacao = {esperado: esp, feito: fei, pct: esp ? fei / esp : null, pendentes: pend.filter(function(p) { return p.faltam.length; })};
    out.evolucaoParticipacao = periodos.filter(function(p) { return p === pid || Object.keys((d.participacao && d.participacao[p]) || {}).length; }).slice(-8).map(function(p) {
      var pe = pendencias(p, dir, d.participacao, p === pid ? hoje : somaDias(inicioDoPeriodo(p), 3)), e = 0, f = 0;
      pe.forEach(function(x) { e += x.esperado; f += x.feito; });
      return {periodo: p, esperado: e, feito: f, pct: e ? f / e : null};
    });
    var rAll = respostasDoPeriodo(d.respostas, pid);
    var auto = rAll.filter(function(r) { var v = Object.keys(r.notas || {}).map(function(k) { return r.notas[k]; }); return v.length >= 2 && v.every(function(n) { return n === v[0]; }); }).length;
    out.respostasAutomatico = {n: rAll.length, automaticas: auto, pct: rAll.length ? auto / rAll.length : null};
    var recebidas = {}; rAll.forEach(function(r) { recebidas[r.avaliadoId] = (recebidas[r.avaliadoId] || 0) + 1; });
    var colabs = Object.keys(dir).filter(function(id) { return dir[id].tipo !== 'temporario' && ativoNoDiretorio(dir[id]); });
    var conf = colabs.filter(function(id) { return (recebidas[id] || 0) >= cfg.nMinimo; }).length;
    out.coberturaConfiavel = {n: colabs.length, confiaveis: conf, pct: colabs.length ? conf / colabs.length : null};

    /* 8.2 clima */
    var cl = climaDoPeriodo(d.clima, pid), clAnt = ant ? climaDoPeriodo(d.clima, ant) : [];
    var idxAtual = indiceClima(cl, mod.clima), idxAnt = indiceClima(clAnt, mod.clima);
    out.clima = {n: cl.length, indice: idxAtual, indiceAnterior: idxAnt, variacao: variacao(idxAtual, idxAnt)};
    out.evolucaoClima = periodos.slice(-8).map(function(p) { var l = climaDoPeriodo(d.clima, p); return {periodo: p, n: l.length, indice: indiceClima(l, mod.clima)}; });
    var qEnps = criterios(mod.clima).filter(function(q) { return q.enps; })[0];
    if (qEnps) {
      var ns = cl.map(function(r) { return num(r.respostas && r.respostas[qEnps.id]); }).filter(function(n) { return n >= 1; });
      out.enps = {n: ns.length, valor: ns.length ? Math.round((ns.filter(function(n) { return n >= 4; }).length - ns.filter(function(n) { return n <= 2; }).length) / ns.length * 100) : null};
    } else out.enps = {n: 0, valor: null};
    var qCond = criterios(mod.clima).filter(function(q) { return q.condicoes; })[0];
    out.condicoes = qCond ? (function() { var ns = cl.map(function(r) { return num(r.respostas && r.respostas[qCond.id]); }).filter(function(n) { return n >= 1; }); return {n: ns.length, media: media(ns)}; })() : {n: 0, media: null};
    var gSet = agrupar(cl, function(r) { return chaveSetor(r.setor); });
    out.climaPorSetor = Object.keys(gSet).sort().map(function(s) {
      var n = gSet[s].length;
      return {setor: rotuloDoSetor(s), n: n, oculto: n < MIN_SETOR_CLIMA, indice: n < MIN_SETOR_CLIMA ? null : indiceClima(gSet[s], mod.clima)};
    });
    /* queda brusca: período atual contra a média dos 4 anteriores, por setor (e por pessoa, quando há autoria) */
    var base4 = anteriores.slice(-4);
    function quedas(chave, minN) {
      var res = [], atualPor = agrupar(cl, chave);
      Object.keys(atualPor).forEach(function(k) {
        if (atualPor[k].length < minN) return;
        var hist = base4.map(function(p) { var l = agrupar(climaDoPeriodo(d.clima, p), chave)[k]; return l ? indiceClima(l, mod.clima) : null; }).filter(function(x) { return x != null; });
        if (!hist.length) return;
        var a = indiceClima(atualPor[k], mod.clima), b = media(hist);
        if (a != null && b != null && b - a >= cfg.quedaBrusca) res.push({chave: k, atual: a, base: b, queda: b - a, n: atualPor[k].length});
      });
      return res.sort(function(x, y) { return y.queda - x.queda; });
    }
    out.quedaBrusca = {porSetor: quedas(function(r) { return chaveSetor(r.setor); }, MIN_SETOR_CLIMA).map(function(x) { return Object.assign(x, {chave: rotuloDoSetor(x.chave)}); }), porPessoa: quedas(function(r) { return r.colaboradorId; }, 1).map(function(x) { return Object.assign(x, {nome: (dir[x.chave] || {}).nome || x.chave}); })};
    var recados = cl.filter(function(r) { return txt(r.recadoRh); });
    var lidos = (d.recadosLidos && d.recadosLidos[pid]) || {};
    out.recados = {n: recados.length, naoLidos: recados.filter(function(r) { return !lidos[r._k]; }).length};

    /* 8.3 pessoas e liderança */
    var rPar = respostasDoPeriodo(d.respostas, pid, 'par'), rLid = respostasDoPeriodo(d.respostas, pid, 'lider');
    var rParAnt = ant ? respostasDoPeriodo(d.respostas, ant, 'par') : [];
    var notaAtual = media(rPar.map(mediaNotas).filter(function(x) { return x != null; })), notaAnt = media(rParAnt.map(mediaNotas).filter(function(x) { return x != null; }));
    out.notaGeral = {n: rPar.length, media: notaAtual, mediaAnterior: notaAnt, variacao: variacao(notaAtual, notaAnt)};
    out.porCriterio = criterios(mod.par).map(function(c) {
      var v = rPar.map(function(r) { return num(r.notas && r.notas[c.id]); }).filter(function(n) { return n >= 1; });
      return {id: c.id, nome: c.nome, n: v.length, media: media(v)};
    });
    var gSetAv = agrupar(rPar, function(r) { return chaveSetor((dir[r.avaliadoId] || {}).setor); });
    out.notaPorSetor = Object.keys(gSetAv).sort().map(function(s) { return {setor: rotuloDoSetor(s), n: gSetAv[s].length, media: media(gSetAv[s].map(mediaNotas).filter(function(x) { return x != null; }))}; });
    var gLid = agrupar(rLid, function(r) { return r.avaliadoId; });
    out.lideres = Object.keys(gLid).map(function(id) {
      var l = gLid[id];
      return {id: id, nome: (dir[id] || {}).nome || id, n: l.length, confiavel: l.length >= cfg.nMinimo, media: media(l.map(mediaNotas).filter(function(x) { return x != null; })),
              criterios: criterios(mod.lider).map(function(c) { var v = l.map(function(r) { return num(r.notas && r.notas[c.id]); }).filter(function(n) { return n >= 1; }); return {id: c.id, nome: c.nome, media: media(v)}; })};
    }).sort(function(a, b) { return (a.media == null ? 9 : a.media) - (b.media == null ? 9 : b.media); });
    out.lideresAbaixoDoLimite = out.lideres.filter(function(l) { return l.media != null && l.media < cfg.limiteLider; });
    var gPes = agrupar(rPar, function(r) { return r.avaliadoId; }), pessoas = Object.keys(gPes).map(function(id) {
      var ms = gPes[id].map(mediaNotas).filter(function(x) { return x != null; });
      return {id: id, nome: (dir[id] || {}).nome || id, tipo: (dir[id] || {}).tipo || 'colaborador', n: ms.length, media: media(ms), desvio: desvio(ms)};
    });
    out.dispersao = pessoas.filter(function(p) { return p.n >= 2; }).sort(function(a, b) { return b.desvio - a.desvio; });
    out.pessoasAbaixoDoLimite = pessoas.filter(function(p) { return p.n >= cfg.nMinimo && p.media < cfg.limitePessoa; }).sort(function(a, b) { return a.media - b.media; });
    var gPesAnt = agrupar(rParAnt, function(r) { return r.avaliadoId; });
    out.maioresQuedas = pessoas.map(function(p) {
      var a = gPesAnt[p.id]; if (!a || !a.length) return null;
      var mAnt = media(a.map(mediaNotas).filter(function(x) { return x != null; }));
      return {id: p.id, nome: p.nome, atual: p.media, anterior: mAnt, variacao: p.media - mAnt};
    }).filter(function(x) { return x && x.variacao < 0; }).sort(function(a, b) { return a.variacao - b.variacao; }).slice(0, 10);

    /* 8.4 cruzamentos: só onde a autoria foi gravada (rhVeAutoriaClima = true) */
    var comAutoria = cl.filter(function(r) { return r.colaboradorId && rh[r.colaboradorId]; });
    out.cruzamentos = {semAutoria: cl.length - comAutoria.length};
    function porGrupo(chave) {
      var g = agrupar(comAutoria, chave);
      return Object.keys(g).sort().map(function(k) { return {grupo: k, n: g[k].length, indice: g[k].length < MIN_SETOR_CLIMA ? null : indiceClima(g[k], mod.clima), oculto: g[k].length < MIN_SETOR_CLIMA}; });
    }
    function tempoDeCasa(r) {
      var adm = (rh[r.colaboradorId] || {}).dataAdmissao; if (!adm || !dataValida(adm)) return null;
      var dias = diasEntre(adm, hoje);
      return dias < 90 ? 'Menos de 90 dias' : dias < 365 ? '90 dias a 1 ano' : dias < 3 * 365 ? '1 a 3 anos' : 'Mais de 3 anos';
    }
    out.cruzamentos.recemAdmitidos = (function() {
      var l = comAutoria.filter(function(r) { var a = (rh[r.colaboradorId] || {}).dataAdmissao; return a && dataValida(a) && diasEntre(a, hoje) < 90; });
      return {n: l.length, indice: l.length < MIN_SETOR_CLIMA ? null : indiceClima(l, mod.clima), oculto: l.length < MIN_SETOR_CLIMA};
    })();
    out.cruzamentos.porTempoDeCasa = porGrupo(tempoDeCasa);
    out.cruzamentos.porContrato = porGrupo(function(r) { return txt((rh[r.colaboradorId] || {}).tipoContrato); });
    out.cruzamentos.porSexo = porGrupo(function(r) { return txt((rh[r.colaboradorId] || {}).sexo); });
    out.cruzamentos.liderBomClimaBaixo = out.climaPorSetor.filter(function(s) { return !s.oculto && s.indice != null && s.indice < 3; }).map(function(s) {
      var lids = Object.keys(dir).filter(function(id) { return norm(dir[id].setor) === norm(s.setor); }).map(function(id) { return dir[id].gestorKey; }).filter(function(x, i, a) { return x && a.indexOf(x) === i; });
      var melhores = out.lideres.filter(function(l) { return lids.indexOf(l.id) >= 0 && l.media != null && l.media >= 4; });
      return melhores.length ? {setor: s.setor, indiceClima: s.indice, lideres: melhores.map(function(l) { return {nome: l.nome, media: l.media}; })} : null;
    }).filter(Boolean);
    return out;
  }

  return {
    MAX_ITENS: MAX_ITENS, ESCALA: ESCALA, CICLO_PADRAO: CICLO_PADRAO, MODELO_PAR: MODELO_PAR, MODELO_LIDER: MODELO_LIDER, MODELO_CLIMA: MODELO_CLIMA, MIN_SETOR_CLIMA: MIN_SETOR_CLIMA,
    norm: norm, idDe: idDe, dataValida: dataValida, somaDias: somaDias, segundaDe: segundaDe, dataBR: dataBR, diasEntre: diasEntre,
    semanaIso: semanaIso, ciclo: ciclo, periodicidadeVigente: periodicidadeVigente, periodoDe: periodoDe, periodoAnterior: periodoAnterior,
    inicioDoPeriodo: inicioDoPeriodo, ordenarPeriodos: ordenarPeriodos, rotuloPeriodo: rotuloPeriodo,
    ativoNoDiretorio: ativoNoDiretorio, alvosDe: alvosDe, validarNotas: validarNotas, validarResposta: validarResposta, validarClima: validarClima, validarModelo: validarModelo,
    setorDe: setorDe, entradaColaborador: entradaColaborador, entradaTemporario: entradaTemporario, ultimoOkDe: ultimoOkDe, montarDiretorio: montarDiretorio,
    pendencias: pendencias, mediaNotas: mediaNotas, dashboard: dashboard
  };
});
