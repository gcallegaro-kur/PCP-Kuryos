/* Tela "Liberação de linha" (liberacao_linha.html): CK-4 assepsia + CK-5 first article por OP.
   Regras em shared/liberacao-linha.js; perguntas vêm do modelo publicado (shared/checklists.js). */
(function() {
  'use strict';
  var L = window.LiberacaoLinha, C = window.Checklists;
  var db = firebase.database();
  var S = {ops: {}, lib: {}, insp: {}, modelos: {}, assepsia: {}, ativos: {}, produtos: {}, config: {}, cfgLib: {},
    linha: '', aberta: null, rascunho: null, fotosPend: {}, carregados: 0};
  try { S.linha = localStorage.getItem('liberacaoLinha.linha') || ''; } catch (e) { /* sem storage */ }

  function el(id) { return document.getElementById(id); }
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function u() { return window.currentUser || {}; }
  function nomeUsuario() { return u().nome || u().email || (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'Usuário'; }
  function uid() { return (firebase.auth().currentUser && firebase.auth().currentUser.uid) || null; }
  function ehQualidade() { var x = u(); return x.role === 'admin' || x.role === 'qualidade' || !!(x.modulos && x.modulos.qualidade); }
  function agora() { return new Date().toISOString(); }
  function hora(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}); }
  function fmt(n) { return n == null ? '—' : Number(n).toLocaleString('pt-BR', {maximumFractionDigits: 2}); }
  function toast(msg, erro) { var t = document.createElement('div'); t.className = 'toast' + (erro ? ' erro' : ''); t.textContent = msg; document.body.appendChild(t); setTimeout(function() { t.remove(); }, 6000); }
  function cor(st) { return {APROVADO: 'ok', DISPENSADA: 'ok', REPROVADO: 'bad', AGUARDANDO_QUALIDADE: 'warn', AGUARDANDO_LIDER: 'warn', EXECUCAO: 'info'}[st] || 'mute'; }
  function chip(st) { return '<span class="tg ' + cor(st) + '">' + e(L.ROTULO[st] || st) + '</span>'; }

  function linhas() { var c = S.config || {}; return [].concat(c.linhas || []).filter(Boolean); }
  function modeloPorCodigo(cod) {
    var id = Object.keys(S.modelos).find(function(k) { return (S.modelos[k] || {}).codigo === cod && S.modelos[k].ativo !== false; });
    return id ? {id: id, m: S.modelos[id]} : null;
  }
  function produtoDaOp(op) {
    var p = S.produtos[op.sku] || S.produtos[String(op.sku || '').replace(/[.#$\[\]\/]/g, '_')];
    if (p) return p;
    var k = Object.keys(S.produtos).find(function(x) { return (S.produtos[x] || {}).sku === op.sku; });
    return k ? S.produtos[k] : null;
  }
  function ativosDaLinha(linha) { return window.Ativos ? Ativos.daLinha(S.ativos, linha) : []; }
  function itensDaInspecao(ins) {
    var m = S.modelos[ins.modeloId];
    return (m && m.versoes && m.versoes[ins.versao] && m.versoes[ins.versao].itens) || [];
  }

  /* ── Lista de OPs da linha ── */
  function opsDaLinha() {
    return Object.keys(S.ops).map(function(k) { return Object.assign({key: k}, S.ops[k]); })
      .filter(function(o) { return o && o.lote && o.status !== 'Concluído' && o.status !== 'Cancelado' && o.tipoOrdem !== 'RETRABALHO'; })
      // Da linha: programada nela, aberta nela, ou preparada aqui (assepsia iniciada para ela).
      .filter(function(o) { var l = S.lib[o.key]; return !S.linha || o.linha === S.linha || o.abertaLinha === S.linha || (l && l.linha === S.linha && !o.abertaLinha); })
      .sort(function(a, b) {
        var aa = a.abertaLinha === S.linha ? 0 : 1, bb = b.abertaLinha === S.linha ? 0 : 1;
        return aa - bb || String(a.dataEmissao || '').localeCompare(String(b.dataEmissao || ''));
      }).slice(0, 40);
  }

  function render() {
    if (S.carregados < 7) return;
    // A chave da trava e o limite de lotes moram em config/liberacaoLinha.
    S.cfgLib = (S.config && S.config.liberacaoLinha) || {};
    var ls = linhas();
    var hSel = '<option value="">Escolha a linha</option>' + ls.map(function(x) { return '<option' + (x === S.linha ? ' selected' : '') + '>' + e(x) + '</option>'; }).join('');
    if (el('fLinha').getAttribute('data-h') !== hSel) { el('fLinha').innerHTML = hSel; el('fLinha').setAttribute('data-h', hSel); }
    var trava = !!S.cfgLib.trava;
    el('trava').className = 'tg ' + (trava ? 'bad' : 'mute');
    el('trava').textContent = trava ? 'Trava LIGADA: sem liberação a linha não produz' : 'Trava desligada: só avisa';
    var faltaModelo = ['CK-4', 'CK-5'].filter(function(c) { var x = modeloPorCodigo(c); return !x || !C.versaoAtual(x.m); });
    el('avisoModelo').innerHTML = faltaModelo.length ? '<div class="aviso warn">Os checklists ' + faltaModelo.join(' e ') + ' ainda não foram publicados. A Qualidade cria em <a href="checklists_cq.html">Qualidade › Modelos de checklist</a> (botão "Criar modelos iniciais").</div>' : '';
    if (!S.linha) { el('lista').innerHTML = '<div class="card vazio">Escolha a linha para ver as OPs dela.</div>'; return; }

    var reg = S.assepsia[L.chaveLinha(S.linha)];
    var ativos = ativosDaLinha(S.linha);
    var cab = '<div class="card linha-cab"><div><b>' + e(S.linha) + '</b> · ' +
      (reg && reg.ultima ? 'última assepsia ' + hora(reg.ultima.em) + ' (' + e(reg.ultima.sku || '') + ') · ' + (reg.lotesDesde || 0) + ' lote(s) desde então' : 'nenhuma assepsia registrada') + '</div>' +
      '<div class="dica">' + (ativos.length ? 'Equipamentos: ' + ativos.map(function(a) { return e(a.codigo) + (a.situacao === 'EM_MANUTENCAO' ? ' <span class="tg warn">em manutenção</span>' : ''); }).join(', ') : 'Nenhum equipamento cadastrado nesta linha em Manutenção › Ativos.') + '</div></div>';
    var ops = opsDaLinha();
    if (!ops.length) { el('lista').innerHTML = cab + proxima() + '<div class="card vazio">Nenhuma OP aberta, programada ou preparada nesta linha.</div>'; if (el('bPreparar')) el('bPreparar').onclick = preparar; return; }
    el('lista').innerHTML = cab + proxima() + ops.map(cardOp).join('');
    if (el('bPreparar')) el('bPreparar').onclick = preparar;
    el('lista').querySelectorAll('[data-acao]').forEach(function(b) { b.onclick = function() { acao(b.getAttribute('data-acao'), b.getAttribute('data-op'), b.getAttribute('data-id')); }; });
  }

  function cardOp(op) {
    var lib = S.lib[op.key] || {};
    var sit = L.situacaoOp(lib, S.insp);
    var aberta = op.abertaLinha === S.linha;
    var b4 = '', b5 = '';
    if (sit.ck4 === 'PENDENTE') {
      var pa = L.precisaAssepsia(op, S.assepsia[L.chaveLinha(S.linha)], agora(), {limite: S.cfgLib.limiteLotes, ativosLinha: ativosDaLinha(S.linha)});
      b4 = '<div class="dica">' + e(pa.motivo) + '</div>' + (pa.precisa
        ? '<button class="btn pri" type="button" data-acao="iniciar4" data-op="' + e(op.key) + '">Iniciar assepsia</button>'
        : '<button class="btn pri" type="button" data-acao="dispensar" data-op="' + e(op.key) + '">Registrar: assepsia não necessária</button> <button class="btn" type="button" data-acao="iniciar4" data-op="' + e(op.key) + '">Fazer assepsia mesmo assim</button>');
    } else if (sit.insp4) {
      b4 = '<button class="btn" type="button" data-acao="abrir" data-id="' + e(lib.ck4.id) + '">' + (sit.ck4 === 'APROVADO' || sit.ck4 === 'REPROVADO' ? 'Ver' : 'Abrir') + '</button>' +
        (sit.ck4 === 'REPROVADO' ? ' <button class="btn pri" type="button" data-acao="iniciar4" data-op="' + e(op.key) + '">Refazer a assepsia</button>' : '');
    } else if (sit.ck4 === 'DISPENSADA') {
      b4 = '<div class="dica">' + e((lib.ck4 || {}).motivo || '') + '</div>';
    }
    if (!sit.ck4Liberado) b5 = '<div class="dica">Abre depois da assepsia liberada.</div>';
    else if (sit.ck5 === 'PENDENTE') b5 = ehQualidade() ? '<button class="btn pri" type="button" data-acao="iniciar5" data-op="' + e(op.key) + '">Iniciar first article</button>' : '<div class="dica">Aguardando a Qualidade iniciar o first article.</div>';
    else if (sit.insp5) {
      b5 = '<button class="btn" type="button" data-acao="abrir" data-id="' + e(lib.ck5.id) + '">' + (sit.ck5 === 'EXECUCAO' ? 'Abrir' : 'Ver') + '</button>' +
        (sit.ck5 === 'AGUARDANDO_LIDER' ? ' <button class="btn pri" type="button" data-acao="assinar" data-id="' + e(lib.ck5.id) + '">Assinar como líder da linha</button>' : '') +
        (sit.ck5 === 'REPROVADO' && ehQualidade() ? ' <button class="btn pri" type="button" data-acao="iniciar5" data-op="' + e(op.key) + '">Nova inspeção</button>' : '');
    }
    return '<div class="card op' + (sit.liberada ? ' lib' : '') + '"><div class="op-cab"><div><b>' + e(op.lote) + '</b> · ' + e(op.produto || '') + ' <span class="dica">' + e(op.sku || '') + '</span>' +
      (aberta ? ' <span class="tg info">aberta na linha</span>' : '') + '</div><div>' + (sit.liberada ? '<span class="tg ok">LINHA LIBERADA</span>' : '<span class="tg warn">' + e(sit.falta) + '</span>') + '</div></div>' +
      '<div class="etapas"><div class="etapa"><div class="et-t">1. Assepsia da linha (CK-4) ' + chip(sit.ck4) + '</div><div class="dica">Antes de alocar a OP na linha.</div>' + b4 + '</div>' +
      '<div class="etapa"><div class="et-t">2. Setup / first article (CK-5) ' + chip(sit.ck5) + '</div><div class="dica">Depois de alocar, com o setup feito; antes de produzir.</div>' + b5 + '</div></div></div>';
  }

  /* Próxima OP: a assepsia vem ANTES de alocar (20/10). Quem vai trocar o
     produto escolhe aqui a OP que vem a seguir, mesmo que o PCP ainda não
     tenha posto a linha nela; a OP passa a aparecer nesta linha. */
  function proxima() {
    var livres = Object.keys(S.ops).map(function(k) { return Object.assign({key: k}, S.ops[k]); })
      .filter(function(o) { return o && o.lote && o.status !== 'Concluído' && o.status !== 'Cancelado' && !o.abertaLinha && o.tipoOrdem !== 'RETRABALHO'; })
      .sort(function(a, b) { return String(a.lote).localeCompare(String(b.lote), 'pt-BR', {numeric: true}); });
    return '<div class="card proxima"><div class="et-t">Preparar a próxima OP desta linha</div>' +
      '<div class="dica">A assepsia é feita antes de alocar a OP na linha. Escolha a OP que vem a seguir; o sistema diz se a limpeza é necessária (POP 035).</div>' +
      '<div class="lin"><input type="text" id="fProxima" list="dlProximas" placeholder="Lote ou produto" style="max-width:none"><datalist id="dlProximas">' +
      livres.map(function(o) { return '<option value="' + e(o.lote) + ' — ' + e(o.produto || '') + '"></option>'; }).join('') +
      '</datalist><button class="btn" type="button" id="bPreparar">Preparar</button></div></div>';
  }
  function preparar() {
    var v = String(el('fProxima').value || '').split(' — ')[0].trim();
    var key = Object.keys(S.ops).find(function(k) { return (S.ops[k] || {}).lote === v; });
    if (!key) { toast('Escolha uma OP da lista.', true); return; }
    if ((S.lib[key] || {}).linha && S.lib[key].linha !== S.linha) { toast('Esta OP já está sendo preparada na ' + S.lib[key].linha + '.', true); return; }
    db.ref('liberacao_linha/' + key + '/linha').set(S.linha).then(function() { toast('Lote ' + v + ' preparado na ' + S.linha + '.'); })
      .catch(function(err) { toast('Não foi possível gravar: ' + err.message, true); });
  }

  /* ── Ações da lista ── */
  function acao(tipo, opKey, id) {
    if (tipo === 'abrir') return abrir(id);
    if (tipo === 'assinar') return assinar(id);
    var op = S.ops[opKey];
    if (tipo === 'dispensar') {
      var pa = L.precisaAssepsia(op, S.assepsia[L.chaveLinha(S.linha)], agora(), {limite: S.cfgLib.limiteLotes, ativosLinha: ativosDaLinha(S.linha)});
      if (pa.precisa) { toast('A regra mudou: a assepsia agora é necessária. ' + pa.motivo, true); return render(); }
      return db.ref().update(L.dispensarAssepsia(opKey, S.linha, pa.motivo, {agora: agora(), por: nomeUsuario()}).updates)
        .then(function() { toast('Assepsia dispensada pela regra do POP 035 (registrado).'); }).catch(function(err) { toast('Não foi possível gravar: ' + err.message, true); });
    }
    var cod = tipo === 'iniciar4' ? 'CK-4' : 'CK-5';
    var mod = modeloPorCodigo(cod);
    if (!mod) { toast('O checklist ' + cod + ' não existe. A Qualidade precisa criar em Modelos de checklist.', true); return; }
    var lib = S.lib[opKey] || {}, ck = cod === 'CK-4' ? 'ck4' : 'ck5';
    var ant = lib[ck] && lib[ck].id ? S.insp[lib[ck].id] : null;
    var nova = L.novaInspecao(mod.id, mod.m, {opKey: opKey, lote: op.lote, sku: op.sku, produto: op.produto, linha: S.linha, agora: agora(), por: nomeUsuario(),
      nominal: cod === 'CK-5' ? L.nominalGramas(produtoDaOp(op)) : null, tentativa: ant ? (ant.tentativa || 1) + 1 : 1});
    if (nova.erro) { toast(nova.erro, true); return; }
    var id = db.ref('inspecoes_cq').push().key, up = {};
    up['inspecoes_cq/' + id] = nova.registro;
    up['liberacao_linha/' + opKey + '/linha'] = S.linha;
    up['liberacao_linha/' + opKey + '/' + ck] = {id: id, status: 'EXECUCAO'};
    if (ck === 'ck4' && lib.ck5) up['liberacao_linha/' + opKey + '/ck5'] = null; // nova limpeza invalida o setup anterior
    db.ref().update(up).then(function() { abrir(id); }).catch(function(err) { toast('Não foi possível iniciar: ' + err.message, true); });
  }

  function assinar(id) {
    var ins = S.insp[id];
    if (!ins) return;
    if (!confirm('Assinar a liberação do lote ' + ins.lote + ' na ' + ins.linha + ' como líder da linha (' + nomeUsuario() + ')?')) return;
    var reg = S.assepsia[L.chaveLinha(ins.linha)] || {};
    var r = L.assinarLider(id, ins, {uid: uid(), por: nomeUsuario(), agora: agora(), lotesDesdeAtual: reg.lotesDesde});
    if (r.erro) { toast(r.erro, true); return; }
    db.ref().update(r.updates).then(function() { toast('Linha liberada para o lote ' + ins.lote + '.'); fechar(); }).catch(function(err) { toast('Não foi possível assinar: ' + err.message, true); });
  }

  /* ── Formulário da inspeção ── */
  function podeEditar(ins, it) {
    if (ins.modeloCodigo === 'CK-4') {
      if (it.papel === 'EXECUTOR') return ins.status === 'EXECUCAO';
      return ins.status === 'AGUARDANDO_QUALIDADE' && ehQualidade();
    }
    return ins.status === 'EXECUCAO' && ehQualidade();
  }

  function abrir(id) {
    S.aberta = id;
    var ins = S.insp[id];
    S.rascunho = JSON.parse(JSON.stringify((ins && ins.respostas) || {}));
    S.fotosPend = {};
    desenharForm();
  }
  function fechar() { S.aberta = null; S.rascunho = null; el('modais').innerHTML = ''; }

  function campoResposta(ins, it, r, ed) {
    var dis = ed ? '' : ' disabled';
    if (it.tipo === 'SNA') {
      return '<div class="resp">' + ['S', 'N', 'NA'].map(function(v) {
        var rot = v === 'S' ? 'Conforme' : v === 'N' ? 'Não conforme' : 'NA';
        if (v === 'NA' && it.critico) return '';
        return '<button type="button" class="' + v + (r.r === v ? ' on' : '') + '" data-r="' + v + '"' + dis + '>' + rot + '</button>';
      }).join('') + '</div>';
    }
    if (it.tipo === 'MEDIDA') {
      var m = it.medida || {};
      return '<div class="lin"><input type="text" inputmode="decimal" data-valor value="' + e(r.valor == null ? '' : r.valor) + '"' + dis + '> <span class="dica">' + e(m.unidade || '') +
        (m.min != null || m.max != null ? ' · faixa ' + (m.min != null ? m.min : '…') + ' a ' + (m.max != null ? m.max : '…') : '') + '</span></div>';
    }
    if (it.tipo === 'ESCOLHA') {
      return '<select data-escolha' + dis + '><option value="">Escolha…</option>' + (it.opcoes || []).map(function(o) { return '<option' + (r.escolha === o ? ' selected' : '') + '>' + e(o) + '</option>'; }).join('') + '</select>';
    }
    if (it.tipo === 'TEXTO') return '<textarea data-texto rows="2"' + dis + '>' + e(r.texto || '') + '</textarea>';
    if (it.tipo === 'AMOSTRAS') {
      var a = it.amostras || {}, vs = r.valores || [];
      var est = C.avaliarAmostras(it, vs, ins.nominal);
      var nomEd = ed && a.nominal === 'PRODUTO';
      return '<div class="dica">Nominal: ' + (a.nominal === 'PRODUTO'
          ? '<input type="text" inputmode="decimal" data-nominal class="nom" value="' + e(ins.nominal == null ? '' : ins.nominal) + '"' + (nomEd ? '' : ' disabled') + '> ' + e(a.unidade || '') + ' (do produto)'
          : fmt(a.nominal) + ' ' + e(a.unidade || '')) +
        (est.limiteInf != null ? ' · mínimo por unidade ' + fmt(est.limiteInf) : '') + (est.limiteSup != null ? ' · máximo ' + fmt(est.limiteSup) : '') + '</div>' +
        '<div class="amostras">' + Array.from({length: a.n || 1}, function(_, i) {
          var v = vs[i], fora = v != null && v !== '' && ((est.limiteInf != null && Number(v) < est.limiteInf) || (est.limiteSup != null && Number(v) > est.limiteSup));
          return '<input type="text" inputmode="decimal" data-amostra="' + i + '" value="' + e(v == null ? '' : v) + '" aria-label="Amostra ' + (i + 1) + '"' + (fora ? ' class="fora"' : '') + dis + '>';
        }).join('') + '</div>' +
        '<div class="estat">' + est.n + '/' + (a.n || 1) + ' · média <b>' + fmt(est.media) + '</b> · mín ' + fmt(est.min) + ' · máx ' + fmt(est.max) +
        (est.abaixo ? ' · <span class="ruim">' + est.abaixo + ' abaixo do mínimo</span>' : '') + (est.acima ? ' · <span class="ruim">' + est.acima + ' acima</span>' : '') + '</div>';
    }
    return '';
  }

  function desenharForm() {
    var ins = S.insp[S.aberta];
    if (!ins) { el('modais').innerHTML = ''; return; }
    var itens = itensDaInspecao(ins);
    var resp = S.rascunho || {};
    var aval = C.avaliar(itens, resp, {nominalProduto: ins.nominal});
    var sitItem = {}; aval.itens.forEach(function(x) { sitItem[x.id] = x.situacao; });
    var secoes = [], porSecao = {};
    itens.forEach(function(it) { var s = it.secao || 'Geral'; if (!porSecao[s]) { porSecao[s] = []; secoes.push(s); } porSecao[s].push(it); });
    var corpo = secoes.map(function(s) {
      return '<div class="secao">' + e(s) + '</div>' + porSecao[s].map(function(it) {
        var r = resp[it.id] || {}, ed = podeEditar(ins, it), st = sitItem[it.id];
        var fotos = (r.fotos || []).map(function(f) { return '<a href="' + e(f.url) + '" target="_blank" rel="noopener"><img src="' + e(f.url) + '" alt="foto"></a>'; }).join('');
        var pend = (S.fotosPend[it.id] || []).length;
        var pedeFoto = it.foto === 'SEMPRE' || (it.foto === 'NC' && st === 'NC');
        return '<div class="item' + (st === 'NC' ? ' nc' : '') + (it.critico ? ' crit' : '') + '" data-item="' + e(it.id) + '">' +
          '<div class="tx">' + e(it.texto) + (it.critico ? ' <span class="tg bad">crítica</span>' : '') + (it.papel === 'EXECUTOR' ? ' <span class="tg mute">quem executa</span>' : '') + '</div>' +
          (it.como ? '<div class="dica">' + e(it.como) + '</div>' : '') + campoResposta(ins, it, r, ed) +
          ((ed && it.foto !== 'NUNCA') || fotos ? '<div class="fotos">' + fotos + (ed && it.foto !== 'NUNCA' ? '<label class="btn sm">📷 Foto' + (pedeFoto ? ' *' : '') + '<input type="file" accept="image/*" capture="environment" multiple data-foto hidden></label>' + (pend ? ' <span class="dica">' + pend + ' foto(s) a enviar</span>' : '') : '') + '</div>' : '') +
          (ed ? '<input type="text" class="obs" data-obs placeholder="Observação (opcional)" value="' + e(r.obs || '') + '">' : (r.obs ? '<div class="dica">Obs.: ' + e(r.obs) + '</div>' : '')) +
          '</div>';
      }).join('');
    }).join('');

    var botoes = '', ehCk4 = ins.modeloCodigo === 'CK-4';
    var editavel = itens.some(function(it) { return podeEditar(ins, it); });
    if (editavel) botoes += '<button type="button" class="btn" id="bSalvar">Salvar</button>';
    if (ehCk4 && ins.status === 'EXECUCAO') botoes += '<button type="button" class="btn pri" id="bConcluir">Concluir limpeza e chamar a Qualidade</button>';
    if (ehQualidade() && ((ehCk4 && ins.status === 'AGUARDANDO_QUALIDADE') || (!ehCk4 && ins.status === 'EXECUCAO'))) {
      botoes += '<button type="button" class="btn perigo" id="bReprovar">Reprovar</button><button type="button" class="btn pri" id="bLiberar">' + (ehCk4 ? 'Liberar a assepsia' : 'Aprovar o first article') + '</button>';
    }
    if (ins.status === 'AGUARDANDO_LIDER') botoes += '<button type="button" class="btn pri" id="bAssinar">Assinar como líder da linha</button>';
    var resumo = aval.resultado === 'APROVADO' ? '<span class="tg ok">Tudo conforme</span>' : aval.resultado === 'REPROVADO' ? '<span class="tg bad">' + aval.ncs.length + ' não conforme(s)' + (aval.criticosNC.length ? ', ' + aval.criticosNC.length + ' crítica(s)' : '') + '</span>' : '<span class="tg warn">' + aval.pendentes.length + ' pendente(s)' + (aval.faltaFoto.length ? ' · ' + aval.faltaFoto.length + ' sem foto' : '') + '</span>';
    var etapas = [
      ins.execucao ? 'Limpeza: ' + e(ins.execucao.por) + ' · ' + hora(ins.execucao.em) : '',
      ins.verificacao ? 'Qualidade: ' + e(ins.verificacao.por) + ' · ' + hora(ins.verificacao.em) : '',
      ins.lider ? 'Líder: ' + e(ins.lider.por) + ' · ' + hora(ins.lider.em) : '',
      ins.motivoReprovacao ? '<span class="ruim">Reprovado: ' + e(ins.motivoReprovacao) + '</span>' : ''
    ].filter(Boolean).join('<br>');
    el('modais').innerHTML = '<div class="mf" id="mf"><div class="md" role="dialog" aria-modal="true">' +
      '<div class="md-cab"><div><h2>' + e(ins.modeloCodigo) + ' · ' + e(ins.modeloNome) + '</h2><div class="dica">Lote <b>' + e(ins.lote) + '</b> · ' + e(ins.produto || '') + ' · ' + e(ins.linha || '') + ' · versão ' + ins.versao + ' do checklist' + (ins.tentativa > 1 ? ' · tentativa ' + ins.tentativa : '') + '</div></div>' +
      '<div style="text-align:right">' + chip(ins.status) + '<div style="margin-top:6px">' + resumo + '</div></div></div>' +
      (etapas ? '<div class="dica etapas-ok">' + etapas + '</div>' : '') + corpo +
      '<div class="aviso bad" id="fErro" hidden></div>' +
      '<div class="rodape"><button type="button" class="btn" id="bFechar">Fechar</button>' + botoes + '</div></div></div>';
    ligarForm(ins, itens);
  }

  /* Redesenhar o formulário DENTRO do evento de um campo (change dispara no
     blur) derruba o nó que ainda está tratando o evento. Agenda para depois e
     junta vários pedidos num só; devolve o foco ao campo equivalente. */
  var redesenhoAgendado = false;
  function redesenhar(focoSel) {
    if (redesenhoAgendado) return;
    redesenhoAgendado = true;
    setTimeout(function() {
      redesenhoAgendado = false;
      var foco = focoSel || (document.activeElement && document.activeElement.closest && document.activeElement.closest('#mf') ? seletorDe(document.activeElement) : null);
      desenharForm();
      var x = foco && el('mf') && el('mf').querySelector(foco);
      if (x) x.focus();
    }, 0);
  }
  function seletorDe(n) {
    var it = n.closest('[data-item]');
    if (!it) return null;
    var attr = ['data-amostra', 'data-valor', 'data-escolha', 'data-texto', 'data-obs', 'data-nominal'].find(function(a) { return n.hasAttribute(a); });
    return attr ? '[data-item="' + it.getAttribute('data-item') + '"] [' + attr + (n.getAttribute(attr) ? '="' + n.getAttribute(attr) + '"' : '') + ']' : null;
  }

  function ligarForm(ins, itens) {
    var box = el('mf');
    var resp = S.rascunho;
    var item = function(alvo) { return alvo.closest('[data-item]').getAttribute('data-item'); };
    var r = function(id) { return resp[id] = resp[id] || {}; };
    box.querySelectorAll('[data-r]').forEach(function(b) {
      b.onclick = function() { r(item(b)).r = b.getAttribute('data-r'); redesenhar(); };
    });
    // Números vão para o rascunho já ao digitar: um redesenho no meio da
    // digitação (outro clique, dado chegando) não pode apagar o que foi digitado.
    var numero = function(v) { return String(v).trim() === '' ? null : Number(String(v).replace(',', '.')); };
    box.querySelectorAll('[data-valor]').forEach(function(i) {
      i.oninput = function() { r(item(i)).valor = numero(i.value); };
      i.onchange = function() { r(item(i)).valor = numero(i.value); redesenhar(); };
    });
    box.querySelectorAll('[data-amostra]').forEach(function(i) {
      i.addEventListener('input', function() { var x = r(item(i)); x.valores = x.valores || []; x.valores[Number(i.getAttribute('data-amostra'))] = numero(i.value); });
    });
    box.querySelectorAll('[data-escolha]').forEach(function(i) { i.onchange = function() { r(item(i)).escolha = i.value; redesenhar(); }; });
    box.querySelectorAll('[data-texto]').forEach(function(i) { i.oninput = function() { r(item(i)).texto = i.value; }; });
    box.querySelectorAll('[data-obs]').forEach(function(i) { i.oninput = function() { r(item(i)).obs = i.value; }; });
    // Amostras: 32 campos digitados em sequência -- atualiza só a estatística
    // e a marcação do campo, sem redesenhar (o foco segue o Tab normalmente).
    box.querySelectorAll('[data-amostra]').forEach(function(i) {
      i.onchange = function() {
        var id = item(i), x = r(id); x.valores = x.valores || [];
        x.valores[Number(i.getAttribute('data-amostra'))] = i.value.trim() === '' ? null : Number(i.value.replace(',', '.'));
        var it = itens.find(function(y) { return y.id === id; });
        var est = C.avaliarAmostras(it, x.valores, ins.nominal), a = it.amostras || {};
        var v = Number(i.value.replace(',', '.'));
        i.classList.toggle('fora', i.value.trim() !== '' && ((est.limiteInf != null && v < est.limiteInf) || (est.limiteSup != null && v > est.limiteSup)));
        var caixa = i.closest('[data-item]').querySelector('.estat');
        if (caixa) caixa.innerHTML = est.n + '/' + (a.n || 1) + ' · média <b>' + fmt(est.media) + '</b> · mín ' + fmt(est.min) + ' · máx ' + fmt(est.max) +
          (est.abaixo ? ' · <span class="ruim">' + est.abaixo + ' abaixo do mínimo</span>' : '') + (est.acima ? ' · <span class="ruim">' + est.acima + ' acima</span>' : '');
      };
    });
    box.querySelectorAll('[data-nominal]').forEach(function(i) {
      i.onchange = function() { ins.nominal = i.value.trim() === '' ? null : Number(i.value.replace(',', '.')); S.nominalAlterado = true; redesenhar(); };
    });
    box.querySelectorAll('[data-foto]').forEach(function(i) {
      i.onchange = function() {
        var id = item(i);
        S.fotosPend[id] = (S.fotosPend[id] || []).concat(Array.prototype.slice.call(i.files).map(function(f) { return {arquivo: f}; }));
        // Foto escolhida conta para a regra "pede foto" assim que for enviada; marca já.
        r(id).fotos = (r(id).fotos || []);
        desenharForm();
      };
    });
    el('bFechar').onclick = fechar;
    var erro = function(msg) { el('fErro').hidden = false; el('fErro').textContent = msg; };
    if (el('bSalvar')) el('bSalvar').onclick = function() { salvar(ins).then(function() { toast('Salvo.'); }).catch(function(err) { erro(err.message); }); };
    if (el('bConcluir')) el('bConcluir').onclick = function() { salvar(ins).then(function() {
      var x = S.insp[S.aberta]; var t = L.concluirExecucao(S.aberta, x, itens, {agora: agora(), por: nomeUsuario(), uid: uid()});
      if (t.erro) return erro(t.erro);
      return db.ref().update(t.updates).then(function() { toast('Limpeza registrada. A Qualidade já pode verificar.'); fechar(); });
    }).catch(function(err) { erro(err.message); }); };
    var decidir = function(dec) {
      var motivo = null;
      if (dec === 'REPROVAR') { motivo = prompt('Motivo da reprovação e ação a tomar:'); if (motivo == null) return; }
      salvar(ins).then(function() {
        var x = S.insp[S.aberta]; var t = L.decidirQualidade(S.aberta, x, itens, dec, {agora: agora(), por: nomeUsuario(), uid: uid(), motivo: motivo});
        if (t.erro) return erro(t.erro);
        return db.ref().update(t.updates).then(function() {
          toast(dec === 'REPROVAR' ? 'Reprovado. A linha continua bloqueada até nova inspeção.' : x.modeloCodigo === 'CK-4' ? 'Assepsia liberada. O first article já pode começar.' : 'First article aprovado. Falta a assinatura do líder da linha.');
          fechar();
        });
      }).catch(function(err) { erro(err.message); });
    };
    if (el('bLiberar')) el('bLiberar').onclick = function() { decidir('LIBERAR'); };
    if (el('bReprovar')) el('bReprovar').onclick = function() { decidir('REPROVAR'); };
    if (el('bAssinar')) el('bAssinar').onclick = function() { assinar(S.aberta); };
  }

  // Grava as respostas (e sobe as fotos novas) antes de qualquer transição.
  function salvar(ins) {
    var id = S.aberta, pend = S.fotosPend;
    var ids = Object.keys(pend).filter(function(k) { return pend[k] && pend[k].length; });
    var subir = ids.length && window.FotosQualidade ? Promise.all(ids.map(function(k) {
      return FotosQualidade.enviar(firebase.storage(), pend[k], {contexto: 'liberacao', chave: id + '_' + k, autor: nomeUsuario()})
        .then(function(regs) { S.rascunho[k] = S.rascunho[k] || {}; S.rascunho[k].fotos = (S.rascunho[k].fotos || []).concat(regs); });
    })) : Promise.resolve();
    return subir.then(function() {
      S.fotosPend = {};
      var up = {};
      Object.keys(S.rascunho).forEach(function(k) { up['inspecoes_cq/' + id + '/respostas/' + k] = S.rascunho[k]; });
      if (S.nominalAlterado) { up['inspecoes_cq/' + id + '/nominal'] = ins.nominal; S.nominalAlterado = false; }
      up['inspecoes_cq/' + id + '/atualizadaEm'] = agora();
      return db.ref().update(up);
    });
  }

  /* ── Dados ── */
  el('fLinha').addEventListener('change', function() {
    S.linha = el('fLinha').value;
    try { localStorage.setItem('liberacaoLinha.linha', S.linha); } catch (err) { /* sem storage */ }
    render();
  });
  var ouvir = function(no, campo) {
    var primeiro = true;
    dbOnValue(db.ref(no), function(s) {
      S[campo] = s.val() || {};
      if (primeiro) { primeiro = false; S.carregados++; if (S.carregados === 7) { el('conn').textContent = 'Ao vivo'; el('conn').className = 'tg ok'; } }
      render();
      if (S.aberta && (campo === 'insp' || campo === 'modelos') && !document.querySelector('#mf input:focus, #mf textarea:focus')) desenharForm();
    }, {onError: function(err) { if (primeiro) { primeiro = false; S.carregados++; } toast('Sem acesso a ' + no + ': ' + (err && err.message), true); render(); }});
  };
  ouvir('ops', 'ops'); ouvir('liberacao_linha', 'lib'); ouvir('inspecoes_cq', 'insp'); ouvir('checklist_modelos', 'modelos');
  ouvir('assepsia_linhas', 'assepsia'); ouvir('ativos', 'ativos'); ouvir('config', 'config');
  dbOnValue(db.ref('produtos'), function(s) { S.produtos = s.val() || {}; });
})();
