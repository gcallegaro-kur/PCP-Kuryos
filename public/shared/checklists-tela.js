/* Editor de modelos de checklist da Qualidade (checklists_cq.html).
   Regras em shared/checklists.js; modelos iniciais em checklists-modelos-padrao.js. */
(function() {
  'use strict';
  var C = window.Checklists, P = window.ChecklistsModelosPadrao;
  var db = firebase.database();
  var S = {modelos: {}, sel: null, itens: null, sujo: false, aba: 'editar', carregado: false};

  function el(id) { return document.getElementById(id); }
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function nomeUsuario() { var u = window.currentUser || {}; return u.nome || u.email || (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'Usuário'; }
  function agora() { return new Date().toISOString(); }
  function dataBR(iso) { if (!iso) return '—'; var d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}); }
  function toast(msg, erro) { var t = document.createElement('div'); t.className = 'toast' + (erro ? ' erro' : ''); t.textContent = msg; document.body.appendChild(t); setTimeout(function() { t.remove(); }, 6000); }
  function copia(x) { return JSON.parse(JSON.stringify(x == null ? null : x)); }
  function opts(obj, sel) { return Object.keys(obj).map(function(k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + e(obj[k]) + '</option>'; }).join(''); }

  function lista() {
    return Object.keys(S.modelos).map(function(k) { return Object.assign({id: k}, S.modelos[k]); })
      .filter(function(m) { return m.codigo; })
      .sort(function(a, b) { return String(a.codigo).localeCompare(String(b.codigo), 'pt-BR', {numeric: true}); });
  }
  function itensDoModelo(m) {
    if (m && m.rascunho && m.rascunho.itens) return copia(m.rascunho.itens);
    var v = C.versaoAtual(m);
    return v ? copia(v.itens) : [];
  }

  /* ── Lista de modelos ── */
  function renderLista() {
    var ms = lista();
    var h = ms.map(function(m) {
      var v = C.versaoAtual(m);
      return '<button type="button" class="mod' + (m.id === S.sel ? ' on' : '') + '" data-mod="' + e(m.id) + '"><b>' + e(m.codigo) + '</b> ' + e(m.nome) +
        '<span class="dica">' + (v ? 'versão ' + v.numero + ' · ' + v.itens.length + ' pergunta(s)' : 'sem versão publicada') + (m.rascunho ? ' · <span class="tg warn">rascunho</span>' : '') + (m.ativo === false ? ' · inativo' : '') + '</span></button>';
    }).join('');
    var faltam = P.MODELOS.filter(function(p) { return !ms.some(function(m) { return m.codigo === p.codigo; }); });
    el('mods').innerHTML = (h || '<div class="dica" style="padding:8px">Nenhum modelo ainda.</div>') +
      (faltam.length ? '<button type="button" class="btn pri" id="btnPadrao" style="width:100%;margin-top:10px">Criar modelos iniciais (' + faltam.map(function(p) { return p.codigo; }).join(', ') + ')</button>' : '') +
      '<button type="button" class="btn" id="btnNovoMod" style="width:100%;margin-top:8px">+ Novo checklist</button>';
    el('mods').querySelectorAll('[data-mod]').forEach(function(b) {
      b.onclick = function() {
        if (S.sujo && !confirm('Há alterações não salvas neste checklist. Descartar?')) return;
        selecionar(b.getAttribute('data-mod'));
      };
    });
    if (el('btnPadrao')) el('btnPadrao').onclick = function() { criarPadrao(faltam); };
    el('btnNovoMod').onclick = novoModelo;
  }

  function selecionar(id) {
    S.sel = id; S.itens = itensDoModelo(S.modelos[id]); S.sujo = false; S.aba = 'editar';
    render();
  }

  function criarPadrao(faltam) {
    var u = {}, t = agora(), por = nomeUsuario();
    faltam.forEach(function(p) {
      var id = db.ref('checklist_modelos').push().key;
      u['checklist_modelos/' + id + '/codigo'] = p.codigo;
      u['checklist_modelos/' + id + '/nome'] = p.nome;
      u['checklist_modelos/' + id + '/descricao'] = p.descricao;
      u['checklist_modelos/' + id + '/ativo'] = true;
      u['checklist_modelos/' + id + '/criadoEm'] = t;
      var r = C.publicar(id, null, p.itens, {por: por, agora: t, nota: 'Modelo inicial (spec do CQ + POP 035). Revisar.'});
      Object.assign(u, r.updates);
    });
    db.ref().update(u).then(function() { toast(faltam.length + ' modelo(s) criado(s). Revise as perguntas e publique as mudanças.'); })
      .catch(function(err) { toast('Não foi possível criar: ' + err.message, true); });
  }

  function novoModelo() {
    var codigo = (prompt('Código do checklist (ex.: CK-1, CK-6):') || '').trim().toUpperCase();
    if (!codigo) return;
    if (lista().some(function(m) { return m.codigo === codigo; })) { toast('Já existe o ' + codigo + '.', true); return; }
    var nome = (prompt('Nome do checklist:') || '').trim();
    if (!nome) return;
    // Caminhos planos: o nó do modelo não tem permissão de escrita inteira
    // (protege as versões publicadas), só cada campo.
    var id = db.ref('checklist_modelos').push().key, b = 'checklist_modelos/' + id + '/', u = {};
    u[b + 'codigo'] = codigo; u[b + 'nome'] = nome; u[b + 'ativo'] = true; u[b + 'criadoEm'] = agora(); u[b + 'criadoPor'] = nomeUsuario();
    u[b + 'rascunho'] = {itens: [C.normalizarItem({texto: 'Primeira pergunta'})], em: agora(), por: nomeUsuario()};
    db.ref().update(u)
      .then(function() { S.sel = id; toast('Checklist ' + codigo + ' criado. Escreva as perguntas e publique a versão 1.'); })
      .catch(function(err) { toast('Não foi possível criar: ' + err.message, true); });
  }

  /* ── Editor ── */
  function campoItem(it, i, total, secoes) {
    var esp = '';
    if (it.tipo === 'MEDIDA') {
      var m = it.medida || {};
      esp = '<div class="g3"><label>Unidade<input data-f="medida.unidade" value="' + e(m.unidade || '') + '"></label><label>Mínimo<input data-f="medida.min" inputmode="decimal" value="' + e(m.min == null ? '' : m.min) + '"></label><label>Máximo<input data-f="medida.max" inputmode="decimal" value="' + e(m.max == null ? '' : m.max) + '"></label></div>';
    } else if (it.tipo === 'AMOSTRAS') {
      var a = it.amostras || {};
      esp = '<div class="g3"><label>Quantas amostras<input data-f="amostras.n" inputmode="numeric" value="' + e(a.n || '') + '"></label><label>Unidade<input data-f="amostras.unidade" value="' + e(a.unidade || '') + '"></label>' +
        '<label>Nominal<select data-f="amostras.nominalModo"><option value="PRODUTO"' + (a.nominal === 'PRODUTO' ? ' selected' : '') + '>do produto (peso/volume nominal)</option><option value="FIXO"' + (a.nominal !== 'PRODUTO' ? ' selected' : '') + '>valor fixo</option></select></label>' +
        (a.nominal !== 'PRODUTO' ? '<label>Valor nominal<input data-f="amostras.nominal" inputmode="decimal" value="' + e(a.nominal == null ? '' : a.nominal) + '"></label>' : '') +
        '<label>Tolerância abaixo (%)<input data-f="amostras.tolInfPct" inputmode="decimal" value="' + e(a.tolInfPct == null ? '' : a.tolInfPct) + '"></label><label>Tolerância acima (%)<input data-f="amostras.tolSupPct" inputmode="decimal" value="' + e(a.tolSupPct == null ? '' : a.tolSupPct) + '" placeholder="sem limite"></label></div>';
    } else if (it.tipo === 'ESCOLHA') {
      esp = '<label>Opções (uma por linha)<textarea data-f="opcoes" rows="3">' + e((it.opcoes || []).join('\n')) + '</textarea></label>';
    }
    return '<div class="it' + (it.critico ? ' crit' : '') + '" data-i="' + i + '">' +
      '<div class="it-top"><span class="n">' + (i + 1) + '</span><input class="tx" data-f="texto" value="' + e(it.texto) + '" placeholder="Pergunta" aria-label="Texto da pergunta ' + (i + 1) + '">' +
      '<span class="mv"><button type="button" class="btn sm" data-mv="-1" title="Subir"' + (i === 0 ? ' disabled' : '') + '>↑</button><button type="button" class="btn sm" data-mv="1" title="Descer"' + (i === total - 1 ? ' disabled' : '') + '>↓</button><button type="button" class="btn sm perigo" data-rm title="Remover">✕</button></span></div>' +
      '<div class="g4">' +
        '<label>Seção<input data-f="secao" list="dlSecoes" value="' + e(it.secao || '') + '"></label>' +
        '<label>Tipo<select data-f="tipo">' + opts(C.TIPOS, it.tipo) + '</select></label>' +
        '<label>Quem responde<select data-f="papel">' + opts(C.PAPEIS, it.papel) + '</select></label>' +
        '<label>Foto<select data-f="foto">' + opts(C.FOTOS, it.foto) + '</select></label>' +
      '</div>' +
      '<label>Como verificar (orientação, opcional)<input data-f="como" value="' + e(it.como || '') + '"></label>' + esp +
      '<div class="flags"><label><input type="checkbox" data-f="critico"' + (it.critico ? ' checked' : '') + '> Crítica (reprova e não aceita NA)</label>' +
      '<label><input type="checkbox" data-f="obrigatorio"' + (it.obrigatorio !== false ? ' checked' : '') + '> Obrigatória</label></div></div>';
  }

  function renderEditor() {
    var m = S.modelos[S.sel];
    if (!m) { el('editor').innerHTML = '<div class="card vazio">Escolha um checklist à esquerda.</div>'; return; }
    var v = C.versaoAtual(m);
    var itens = S.itens = S.itens || itensDoModelo(m);
    var secoes = {}; itens.forEach(function(it) { if (it.secao) secoes[it.secao] = 1; });
    var dif = v ? C.diferencas(v.itens, C.normalizarItens(itens)) : null;
    var mudou = !v || (dif.incluidos.length + dif.removidos.length + dif.alterados.length > 0);
    var abas = '<div class="abas"><button type="button" class="aba' + (S.aba === 'editar' ? ' on' : '') + '" data-aba="editar">Perguntas</button><button type="button" class="aba' + (S.aba === 'historico' ? ' on' : '') + '" data-aba="historico">Versões (' + (m.versoes ? Object.keys(m.versoes).length : 0) + ')</button></div>';
    var cab = '<div class="cab"><div><h2>' + e(m.codigo) + ' — ' + e(m.nome) + '</h2><div class="dica">' + e(m.descricao || '') + '</div></div>' +
      '<div class="dica" style="text-align:right">' + (v ? 'Em uso: <b>versão ' + v.numero + '</b><br>' + dataBR(v.criadaEm) + (v.criadaPor ? ' · ' + e(v.criadaPor) : '') : '<b>Sem versão publicada</b>') + '</div></div>';
    if (S.aba === 'historico') {
      var nums = Object.keys(m.versoes || {}).map(Number).sort(function(a, b) { return b - a; });
      el('editor').innerHTML = cab + abas + '<div class="card">' + (nums.length ? nums.map(function(nv) {
        var ver = m.versoes[nv], ant = m.versoes[nv - 1];
        var d = ant ? C.diferencas(ant.itens, ver.itens) : null;
        return '<div class="ver"><b>Versão ' + nv + '</b> · ' + dataBR(ver.criadaEm) + (ver.criadaPor ? ' · ' + e(ver.criadaPor) : '') + ' · ' + (ver.itens || []).length + ' pergunta(s)' +
          (ver.nota ? '<div>' + e(ver.nota) + '</div>' : '') +
          (d ? '<div class="dica">' + [d.incluidos.length ? '+ ' + d.incluidos.map(e).join('; ') : '', d.removidos.length ? '− ' + d.removidos.map(e).join('; ') : '', d.alterados.length ? '✎ ' + d.alterados.map(e).join('; ') : ''].filter(Boolean).join('<br>') + '</div>' : '') + '</div>';
      }).join('') : '<div class="dica">Nenhuma versão publicada.</div>') + '</div>';
    } else {
      el('editor').innerHTML = cab + abas +
        '<datalist id="dlSecoes">' + Object.keys(secoes).map(function(s) { return '<option value="' + e(s) + '">'; }).join('') + '</datalist>' +
        '<div id="itens">' + itens.map(function(it, i) { return campoItem(it, i, itens.length, secoes); }).join('') + '</div>' +
        '<button type="button" class="btn" id="btnAddItem">+ Pergunta</button>' +
        '<div class="publicar card">' +
          (mudou ? '<div class="dica">' + (v ? 'Mudanças em relação à versão ' + v.numero + ': ' + [dif.incluidos.length + ' nova(s)', dif.removidos.length + ' removida(s)', dif.alterados.length + ' alterada(s)'].join(', ') + '.' : 'Ainda não publicado.') + ' Inspeções já feitas não mudam: guardam a versão que usaram.</div>' : '<div class="dica">Igual à versão ' + v.numero + ' em uso.</div>') +
          '<label class="t" for="nota">O que mudou e por quê</label><input type="text" id="nota" placeholder="Ex.: incluída a conferência do filtro após RNC 2026-014">' +
          '<div class="aviso bad" id="pubErro" hidden></div>' +
          '<div class="rodape"><button type="button" class="btn" id="btnRascunho"' + (S.sujo ? '' : ' disabled') + '>Salvar rascunho</button><button type="button" class="btn pri" id="btnPublicar"' + (mudou ? '' : ' disabled') + '>Publicar versão ' + (v ? v.numero + 1 : 1) + '</button></div>' +
        '</div>';
      ligarEditor();
    }
    el('editor').querySelectorAll('[data-aba]').forEach(function(b) { b.onclick = function() { S.aba = b.getAttribute('data-aba'); renderEditor(); }; });
  }

  function setCampo(it, f, valor, alvo) {
    if (f === 'critico' || f === 'obrigatorio') { it[f] = alvo.checked; return; }
    if (f === 'opcoes') { it.opcoes = String(valor).split('\n').map(function(x) { return x.trim(); }).filter(Boolean); return; }
    if (f.indexOf('.') > 0) {
      var p = f.split('.'), o = it[p[0]] = it[p[0]] || {};
      if (p[1] === 'nominalModo') { o.nominal = valor === 'PRODUTO' ? 'PRODUTO' : null; return 'redesenhar'; }
      o[p[1]] = valor === '' ? null : (p[1] === 'unidade' ? valor : Number(String(valor).replace(',', '.')));
      return;
    }
    it[f] = valor;
    if (f === 'tipo') return 'redesenhar';
  }

  function ligarEditor() {
    var box = el('itens');
    var mexeu = function(ev) {
      var alvo = ev.target, f = alvo.getAttribute('data-f');
      if (!f) return;
      if (!S.itens) S.itens = itensDoModelo(S.modelos[S.sel]);
      var i = Number(alvo.closest('[data-i]').getAttribute('data-i'));
      var acao = setCampo(S.itens[i], f, alvo.value, alvo);
      S.sujo = true;
      if (acao === 'redesenhar' || ev.type === 'change') renderEditor(); else { el('btnRascunho').disabled = false; el('btnPublicar').disabled = false; }
    };
    box.addEventListener('input', function(ev) { if (ev.target.tagName !== 'SELECT' && ev.target.type !== 'checkbox') mexeu(ev); });
    box.addEventListener('change', function(ev) { if (ev.target.tagName === 'SELECT' || ev.target.type === 'checkbox') mexeu(ev); });
    box.querySelectorAll('[data-mv]').forEach(function(b) {
      b.onclick = function() {
        var i = Number(b.closest('[data-i]').getAttribute('data-i')), j = i + Number(b.getAttribute('data-mv'));
        var t = S.itens[i]; S.itens[i] = S.itens[j]; S.itens[j] = t; S.sujo = true; renderEditor();
      };
    });
    box.querySelectorAll('[data-rm]').forEach(function(b) {
      b.onclick = function() {
        var i = Number(b.closest('[data-i]').getAttribute('data-i'));
        if (!confirm('Remover a pergunta "' + (S.itens[i].texto || '') + '"? Ela continua nas versões antigas.')) return;
        S.itens.splice(i, 1); S.sujo = true; renderEditor();
      };
    });
    el('btnAddItem').onclick = function() {
      var usados = {}; S.itens.forEach(function(it) { usados[it.id] = 1; });
      var ult = S.itens[S.itens.length - 1] || {};
      S.itens.push(C.normalizarItem({texto: '', secao: ult.secao, papel: ult.papel}, usados)); S.sujo = true; renderEditor();
      var txs = el('itens').querySelectorAll('.tx'); if (txs.length) txs[txs.length - 1].focus();
    };
    el('btnRascunho').onclick = function() {
      db.ref('checklist_modelos/' + S.sel + '/rascunho').set({itens: C.normalizarItens(S.itens), em: agora(), por: nomeUsuario()})
        .then(function() { S.sujo = false; toast('Rascunho salvo. Só vale nas inspeções depois de publicado.'); renderEditor(); })
        .catch(function(err) { toast('Não foi possível salvar: ' + err.message, true); });
    };
    el('btnPublicar').onclick = function() {
      var r = C.publicar(S.sel, S.modelos[S.sel], S.itens, {por: nomeUsuario(), agora: agora(), nota: el('nota').value});
      if (r.erro) { el('pubErro').hidden = false; el('pubErro').textContent = r.erro; return; }
      el('btnPublicar').disabled = true;
      db.ref().update(r.updates).then(function() { S.sujo = false; S.itens = null; renderEditor(); toast('Versão ' + r.numero + ' publicada. As próximas inspeções já usam esta versão.'); })
        .catch(function(err) { el('btnPublicar').disabled = false; el('pubErro').hidden = false; el('pubErro').textContent = 'Não foi possível publicar: ' + err.message; });
    };
  }

  function render() {
    if (!S.carregado) return;
    renderLista();
    if (!S.sel || !S.modelos[S.sel]) { var l = lista(); if (l.length) { S.sel = l[0].id; S.itens = null; } }
    renderEditor();
  }

  window.addEventListener('beforeunload', function(ev) { if (S.sujo) { ev.preventDefault(); ev.returnValue = ''; } });
  dbOnValue(db.ref('checklist_modelos'), function(s) {
    S.modelos = s.val() || {};
    // Outra pessoa publicou enquanto eu não mexia: recarrega as perguntas.
    if (!S.sujo) S.itens = null;
    S.carregado = true; el('conn').textContent = 'Ao vivo'; el('conn').className = 'tg ok';
    render();
  }, {onError: function(err) { el('editor').innerHTML = '<div class="aviso bad">Sem acesso aos modelos de checklist: ' + e(err && err.message) + '</div>'; }});
})();
