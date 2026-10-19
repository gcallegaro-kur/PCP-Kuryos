/* Tela de Manutenção › Ativos (ativos.html). Regras em shared/ativos.js. */
(function() {
  'use strict';
  var A = window.Ativos;
  var db = firebase.database();
  var S = {ativos: {}, config: {}, f: {busca: '', tipo: '', area: '', linha: '', situacao: '', marcador: ''}, carregado: false};

  function el(id) { return document.getElementById(id); }
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function nomeUsuario() { var u = window.currentUser || {}; return u.nome || u.email || (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'Usuário'; }
  function agora() { return new Date().toISOString(); }
  function dataBR(iso) { if (!iso) return '—'; var d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}); }
  function fmt(n) { return n == null || n === '' ? '' : Number(n).toLocaleString('pt-BR'); }
  function toast(msg, erro) {
    var t = document.createElement('div'); t.className = 'toast' + (erro ? ' erro' : ''); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function() { t.remove(); }, 6000);
  }

  // Linhas e postos de onde o equipamento pode estar (os mesmos do apontamento).
  function locais() {
    var c = S.config || {};
    var arr = [].concat(c.linhas || [], c.rotulagem || [], c.postos || []).filter(Boolean);
    Object.keys(S.ativos).forEach(function(k) { var l = (S.ativos[k] || {}).linha; if (l && arr.indexOf(l) < 0) arr.push(l); });
    return arr;
  }
  function opcoes(obj, sel, vazio) {
    return (vazio != null ? '<option value="">' + e(vazio) + '</option>' : '') +
      Object.keys(obj).map(function(k) { var r = typeof obj[k] === 'string' ? obj[k] : obj[k].rotulo; return '<option value="' + e(k) + '"' + (k === sel ? ' selected' : '') + '>' + e(r) + '</option>'; }).join('');
  }
  function opcoesLista(arr, sel, vazio) {
    return '<option value="">' + e(vazio) + '</option>' + arr.map(function(x) { return '<option' + (x === sel ? ' selected' : '') + '>' + e(x) + '</option>'; }).join('');
  }

  /* ── Painel e lista ── */
  function render() {
    if (!S.carregado) return;
    var r = A.resumo(S.ativos), f = S.f;
    var card = function(id, rot, val, filtro) {
      var on = (filtro.situacao && f.situacao === filtro.situacao) || (filtro.marcador && f.marcador === filtro.marcador) || (!filtro.situacao && !filtro.marcador && !f.situacao && !f.marcador);
      return '<button type="button" class="stat' + (on ? ' on' : '') + '" data-card="' + id + '" aria-pressed="' + on + '"><b>' + val + '</b><span>' + rot + '</span></button>';
    };
    el('painel').innerHTML =
      card('todos', 'Equipamentos', r.total, {}) +
      card('op', 'Operacionais', r.porSituacao.OPERACIONAL, {situacao: 'OPERACIONAL'}) +
      card('man', 'Em manutenção', r.porSituacao.EM_MANUTENCAO, {situacao: 'EM_MANUTENCAO'}) +
      card('ina', 'Inativos', r.porSituacao.INATIVO, {situacao: 'INATIVO'}) +
      card('ase', 'Pedem assepsia', r.assepsia, {marcador: 'assepsia'}) +
      card('cal', 'Pedem calibração', r.calibracao, {marcador: 'calibracao'});
    el('painel').querySelectorAll('[data-card]').forEach(function(b) {
      b.onclick = function() {
        var id = b.getAttribute('data-card');
        var m = {todos: {}, op: {situacao: 'OPERACIONAL'}, man: {situacao: 'EM_MANUTENCAO'}, ina: {situacao: 'INATIVO'}, ase: {marcador: 'assepsia'}, cal: {marcador: 'calibracao'}}[id];
        var mesmo = (m.situacao && f.situacao === m.situacao) || (m.marcador && f.marcador === m.marcador);
        f.situacao = mesmo ? '' : (m.situacao || ''); f.marcador = mesmo ? '' : (m.marcador || '');
        render();
      };
    });
    var fT = el('fTipo'), fA = el('fArea'), fL = el('fLinha');
    var hT = opcoes(A.TIPOS, f.tipo, 'Todos os tipos'), hA = opcoes(A.AREAS, f.area, 'Todas as áreas'), hL = opcoesLista(locais(), f.linha, 'Todas as linhas/postos');
    if (fT.getAttribute('data-h') !== hT) { fT.innerHTML = hT; fT.setAttribute('data-h', hT); }
    if (fA.getAttribute('data-h') !== hA) { fA.innerHTML = hA; fA.setAttribute('data-h', hA); }
    if (fL.getAttribute('data-h') !== hL) { fL.innerHTML = hL; fL.setAttribute('data-h', hL); }

    var itens = A.filtrar(S.ativos, f);
    var corpo = el('lista');
    if (!r.total) {
      corpo.innerHTML = '<div class="vazio"><b>Nenhum equipamento cadastrado ainda.</b><br>Comece pelos reatores e tachos da manipulação e pelas máquinas de cada linha de envase — são eles que a assepsia e o first article vão usar.<br><br><button class="btn pri" type="button" data-novo>+ Cadastrar o primeiro</button></div>';
    } else if (!itens.length) {
      corpo.innerHTML = '<div class="vazio">Nenhum equipamento com esses filtros.</div>';
    } else {
      corpo.innerHTML = '<div class="tw"><table><thead><tr><th>Código</th><th>Equipamento</th><th>Área / local</th><th>Capacidade</th><th>Pede</th><th>Situação</th><th></th></tr></thead><tbody>' +
        itens.map(function(a) {
          var t = A.TIPOS[a.tipo] || A.TIPOS.OUTRO, s = A.SITUACOES[a.situacao] || A.SITUACOES.OPERACIONAL;
          var pede = (a.exigeAssepsia ? '<span class="tg info">assepsia</span> ' : '') + (a.exigeCalibracao ? '<span class="tg info">calibração ' + (a.calibracaoPeriodicidadeMeses || 12) + 'm</span>' : '');
          return '<tr data-id="' + e(a.id) + '"><td><b class="cod">' + e(a.codigo) + '</b></td>' +
            '<td>' + e(a.nome) + '<div class="dica">' + e(t.rotulo) + [a.fabricante, a.modelo].filter(Boolean).map(function(x) { return ' · ' + e(x); }).join('') + '</div></td>' +
            '<td>' + e(A.AREAS[a.area] || '—') + (a.linha ? '<div class="dica">' + e(a.linha) + '</div>' : '') + '</td>' +
            '<td>' + (a.capacidade != null ? fmt(a.capacidade) + ' ' + e(a.capacidadeUnidade || '') : '<span class="mut">—</span>') + '</td>' +
            '<td>' + (pede || '<span class="mut">—</span>') + '</td>' +
            '<td><span class="tg ' + s.cor + '">' + e(s.rotulo) + '</span>' + (a.situacaoMotivo && a.situacao !== 'OPERACIONAL' ? '<div class="dica">' + e(a.situacaoMotivo) + '</div>' : '') + '</td>' +
            '<td class="acoes"><button class="btn sm" type="button" data-editar="' + e(a.id) + '">Editar</button> <button class="btn sm" type="button" data-situacao="' + e(a.id) + '">Situação</button> <button class="btn sm" type="button" data-hist="' + e(a.id) + '">Histórico</button></td></tr>';
        }).join('') + '</tbody></table></div><div class="dica" style="margin-top:8px">' + itens.length + ' de ' + r.total + ' equipamento(s).</div>';
    }
    corpo.querySelectorAll('[data-editar]').forEach(function(b) { b.onclick = function() { abrirForm(b.getAttribute('data-editar')); }; });
    corpo.querySelectorAll('[data-situacao]').forEach(function(b) { b.onclick = function() { abrirSituacao(b.getAttribute('data-situacao')); }; });
    corpo.querySelectorAll('[data-hist]').forEach(function(b) { b.onclick = function() { abrirHistorico(b.getAttribute('data-hist')); }; });
    corpo.querySelectorAll('[data-novo]').forEach(function(b) { b.onclick = function() { abrirForm(null); }; });
  }

  /* ── Modais ── */
  function modal(html) {
    el('modais').innerHTML = '<div class="mf" id="mf"><div class="md" role="dialog" aria-modal="true">' + html + '</div></div>';
    el('mf').addEventListener('mousedown', function(ev) { if (ev.target.id === 'mf') fechar(); });
    document.addEventListener('keydown', escFecha);
  }
  function escFecha(ev) { if (ev.key === 'Escape') fechar(); }
  function fechar() { el('modais').innerHTML = ''; document.removeEventListener('keydown', escFecha); }

  function abrirForm(id) {
    var a = id ? S.ativos[id] || {} : {};
    var novo = !id;
    var tipo = a.tipo || 'REATOR';
    modal('<h2>' + (novo ? 'Novo equipamento' : 'Editar ' + e(a.codigo)) + '</h2>' +
      '<div class="grid2">' +
        '<div><label class="t" for="aTipo">Tipo *</label><select id="aTipo">' + opcoes(A.TIPOS, tipo) + '</select></div>' +
        '<div><label class="t" for="aCodigo">Código (TAG) *</label><input type="text" id="aCodigo" value="' + e(a.codigo || A.sugerirCodigo(tipo, S.ativos)) + '"><div class="dica">O que está (ou vai estar) plaqueado no equipamento.</div></div>' +
        '<div style="grid-column:1/-1"><label class="t" for="aNome">Nome *</label><input type="text" id="aNome" value="' + e(a.nome || '') + '" placeholder="Ex.: Reator inox 500 kg com agitador"></div>' +
        '<div><label class="t" for="aArea">Área *</label><select id="aArea">' + opcoes(A.AREAS, a.area || A.padroesDoTipo(tipo).area) + '</select></div>' +
        '<div><label class="t" for="aLinha">Linha / posto</label><select id="aLinha">' + opcoesLista(locais(), a.linha || '', '— nenhum (fixo na área) —') + '</select></div>' +
        '<div><label class="t" for="aCap">Capacidade</label><input type="text" id="aCap" inputmode="decimal" value="' + e(a.capacidade == null ? '' : a.capacidade) + '"></div>' +
        '<div><label class="t" for="aCapUn">Unidade</label><input type="text" id="aCapUn" value="' + e(a.capacidadeUnidade || A.padroesDoTipo(tipo).unidade || '') + '" placeholder="kg, L, un/h"></div>' +
        '<div><label class="t" for="aFab">Fabricante</label><input type="text" id="aFab" value="' + e(a.fabricante || '') + '"></div>' +
        '<div><label class="t" for="aMod">Modelo</label><input type="text" id="aMod" value="' + e(a.modelo || '') + '"></div>' +
        '<div><label class="t" for="aSerie">Nº de série</label><input type="text" id="aSerie" value="' + e(a.numeroSerie || '') + '"></div>' +
        '<div><label class="t" for="aPat">Patrimônio</label><input type="text" id="aPat" value="' + e(a.patrimonio || '') + '"></div>' +
        '<div><label class="t" for="aData">Data de aquisição</label><input type="date" id="aData" value="' + e(a.dataAquisicao || '') + '"></div>' +
      '</div>' +
      '<div class="checks">' +
        '<label><input type="checkbox" id="aAsep"' + ((a.exigeAssepsia != null ? a.exigeAssepsia : A.padroesDoTipo(tipo).assepsia) ? ' checked' : '') + '> Pede <b>assepsia</b> (limpeza e sanitização liberada pela Qualidade antes de usar)</label>' +
        '<label><input type="checkbox" id="aCalib"' + ((a.exigeCalibracao != null ? a.exigeCalibracao : A.padroesDoTipo(tipo).calibracao) ? ' checked' : '') + '> Pede <b>calibração</b> a cada <input type="number" id="aPer" min="1" style="width:70px" value="' + e(a.calibracaoPeriodicidadeMeses || A.PERIODICIDADE_PADRAO_MESES) + '"> mês(es)</label>' +
      '</div>' +
      '<div><label class="t" for="aObs">Observações</label><textarea id="aObs" rows="2">' + e(a.obs || '') + '</textarea></div>' +
      '<div class="aviso bad" id="aErros" hidden></div>' +
      '<div class="rodape"><button class="btn" type="button" id="aCancelar">Cancelar</button><button class="btn pri" type="button" id="aSalvar">' + (novo ? 'Cadastrar' : 'Salvar') + '</button></div>');
    var tocouCodigo = !novo;
    el('aCodigo').addEventListener('input', function() { tocouCodigo = true; });
    el('aTipo').onchange = function() {
      // Trocar o tipo ajusta os padrões (área, unidade, assepsia, calibração) e o código sugerido.
      var p = A.padroesDoTipo(el('aTipo').value);
      el('aArea').value = p.area; el('aCapUn').value = p.unidade || '';
      el('aAsep').checked = p.assepsia; el('aCalib').checked = p.calibracao;
      if (!tocouCodigo) el('aCodigo').value = A.sugerirCodigo(el('aTipo').value, S.ativos);
    };
    el('aCancelar').onclick = fechar;
    el('aSalvar').onclick = function() { salvar(id); };
    el(novo ? 'aNome' : 'aCodigo').focus();
  }

  function salvar(id) {
    var ant = id ? S.ativos[id] || {} : {};
    var a = A.normalizar({
      tipo: el('aTipo').value, codigo: el('aCodigo').value, nome: el('aNome').value, area: el('aArea').value,
      linha: el('aLinha').value, capacidade: el('aCap').value, capacidadeUnidade: el('aCapUn').value,
      fabricante: el('aFab').value, modelo: el('aMod').value, numeroSerie: el('aSerie').value, patrimonio: el('aPat').value,
      dataAquisicao: el('aData').value, exigeAssepsia: el('aAsep').checked, exigeCalibracao: el('aCalib').checked,
      calibracaoPeriodicidadeMeses: el('aPer').value, obs: el('aObs').value, situacao: ant.situacao
    });
    var erros = A.validar(a, S.ativos, id);
    if (erros.length) { el('aErros').hidden = false; el('aErros').innerHTML = erros.map(e).join('<br>'); return; }
    var t = agora(), por = nomeUsuario();
    var ref = id ? db.ref('ativos/' + id) : db.ref('ativos').push();
    var dados = Object.assign({}, a, {atualizadoEm: t, atualizadoPor: por});
    if (!id) Object.assign(dados, {criadoEm: t, criadoPor: por, situacaoDesde: t});
    else ['criadoEm', 'criadoPor', 'situacaoDesde', 'situacaoMotivo', 'limpeza'].forEach(function(k) { if (ant[k] !== undefined) dados[k] = ant[k]; });
    el('aSalvar').disabled = true;
    ref.set(dados).then(function() {
      fechar(); toast((id ? 'Equipamento ' : 'Cadastrado: ') + a.codigo + (id ? ' salvo.' : ''));
    }).catch(function(err) {
      el('aSalvar').disabled = false; el('aErros').hidden = false; el('aErros').textContent = 'Não foi possível gravar: ' + err.message;
    });
  }

  function abrirSituacao(id) {
    var a = S.ativos[id] || {}, atual = a.situacao || 'OPERACIONAL';
    modal('<h2>Situação de ' + e(a.codigo) + '</h2><div class="dica">' + e(a.nome) + ' · hoje: <b>' + e(A.SITUACOES[atual].rotulo) + '</b>' + (a.situacaoDesde ? ' desde ' + dataBR(a.situacaoDesde) : '') + '</div>' +
      '<div class="seg" id="sSeg" style="margin:14px 0">' + Object.keys(A.SITUACOES).filter(function(k) { return k !== atual; }).map(function(k, i) {
        return '<button type="button" data-s="' + k + '"' + (i === 0 ? ' class="on"' : '') + '>' + e(A.SITUACOES[k].rotulo) + '</button>';
      }).join('') + '</div>' +
      '<label class="t" for="sMotivo">Motivo</label><textarea id="sMotivo" rows="2" placeholder="Obrigatório para parar ou inativar. Ex.: troca da vedação do eixo"></textarea>' +
      '<div class="aviso bad" id="sErro" hidden></div>' +
      '<div class="rodape"><button class="btn" type="button" id="sCancelar">Cancelar</button><button class="btn pri" type="button" id="sSalvar">Confirmar</button></div>');
    el('sSeg').querySelectorAll('button').forEach(function(b) { b.onclick = function() { el('sSeg').querySelectorAll('button').forEach(function(x) { x.classList.toggle('on', x === b); }); }; });
    el('sCancelar').onclick = fechar;
    el('sSalvar').onclick = function() {
      var nova = el('sSeg').querySelector('.on').getAttribute('data-s');
      var r = A.mudarSituacao(id, a, nova, {motivo: el('sMotivo').value, por: nomeUsuario(), agora: agora(), chaveHistorico: db.ref('ativos_historico/' + id).push().key});
      if (r.erro) { el('sErro').hidden = false; el('sErro').textContent = r.erro; return; }
      el('sSalvar').disabled = true;
      db.ref().update(r.updates).then(function() { fechar(); toast(a.codigo + ': ' + A.SITUACOES[nova].rotulo.toLowerCase() + '.'); })
        .catch(function(err) { el('sSalvar').disabled = false; el('sErro').hidden = false; el('sErro').textContent = 'Não foi possível gravar: ' + err.message; });
    };
  }

  function abrirHistorico(id) {
    var a = S.ativos[id] || {};
    modal('<h2>Histórico de ' + e(a.codigo) + '</h2><div class="dica">' + e(a.nome) + ' · cadastrado ' + dataBR(a.criadoEm) + (a.criadoPor ? ' por ' + e(a.criadoPor) : '') + '</div><div id="hCorpo" style="margin-top:12px">Carregando…</div><div class="rodape"><button class="btn" type="button" id="hFechar">Fechar</button></div>');
    el('hFechar').onclick = fechar;
    db.ref('ativos_historico/' + id).once('value').then(function(s) {
      var h = s.val() || {};
      var linhas = Object.keys(h).map(function(k) { return h[k]; }).sort(function(x, y) { return String(y.em).localeCompare(String(x.em)); });
      el('hCorpo').innerHTML = linhas.length ? '<table><thead><tr><th>Quando</th><th>De → para</th><th>Motivo</th><th>Por</th></tr></thead><tbody>' + linhas.map(function(x) {
        return '<tr><td>' + dataBR(x.em) + '</td><td>' + e((A.SITUACOES[x.de] || {}).rotulo || x.de) + ' → <b>' + e((A.SITUACOES[x.para] || {}).rotulo || x.para) + '</b></td><td>' + e(x.motivo || '') + '</td><td>' + e(x.por || '') + '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="mut">Nenhuma mudança de situação registrada.</div>';
    }).catch(function(err) { el('hCorpo').textContent = 'Não foi possível ler o histórico: ' + err.message; });
  }

  /* ── Ligações ── */
  el('fBusca').addEventListener('input', function() { S.f.busca = el('fBusca').value; render(); });
  el('fTipo').addEventListener('change', function() { S.f.tipo = el('fTipo').value; render(); });
  el('fArea').addEventListener('change', function() { S.f.area = el('fArea').value; render(); });
  el('fLinha').addEventListener('change', function() { S.f.linha = el('fLinha').value; render(); });
  el('btnNovo').addEventListener('click', function() { abrirForm(null); });

  var pend = 2;
  function pronto() { if (--pend <= 0) { S.carregado = true; el('conn').textContent = 'Ao vivo'; el('conn').className = 'tg ok'; } render(); }
  var aviso = function(err) { el('lista').innerHTML = '<div class="aviso bad">Sem acesso ao cadastro de ativos: ' + e(err && err.message) + '</div>'; };
  dbOnValue(db.ref('ativos'), function(s) { S.ativos = s.val() || {}; if (!S._a) { S._a = 1; pronto(); } else render(); }, {onError: aviso});
  dbOnValue(db.ref('config'), function(s) { S.config = s.val() || {}; if (!S._c) { S._c = 1; pronto(); } else render(); }, {onError: function() { if (!S._c) { S._c = 1; pronto(); } }});
})();
