'use strict';
/* Auditoria 5S -- tela (06/10/2026). Regras em shared/auditoria-5s.js (puro, testado em
   run_auditoria_5s_test.js). Aqui: papéis, formulário guiado, relatório, painel, plano de ações,
   ocorrências e configuração. Gravações: auditorias_5s (fechada = imutável), acoes_5s, ciencia_5s,
   ocorrencias_5s e auditoria5s_config (só admin). */
(function() {
  var db = firebase.database();
  var A = Auditoria5S;
  var S = {aba: 'painel', cfg: {}, usuarios: null, auditorias: {}, acoes: {}, ciencia: {}, ocorrencias: null, uid: null, F: null, filtroHist: {setor: '', tipo: ''}, carregou: {}};
  var ABAS = [['painel', 'Painel'], ['nova', 'Nova auditoria'], ['historico', 'Histórico'], ['acoes', 'Plano de ações'], ['ocorrencias', 'Ocorrências'], ['config', 'Configuração']];

  function el(id) { return document.getElementById(id); }
  function e(v) { return escapeHtml(String(v == null ? '' : v)); }
  function hoje() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function agoraHora() { var d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function dataBR(v) { var s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : '—'; }
  function pctTxt(p) { return p == null ? '—' : Math.round(p * 100) + '%'; }
  function nomeUsuario() { var u = window.currentUser || {}; return u.nome || u.email || (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'Usuário'; }
  function toast(msg, erro) { var t = document.createElement('div'); t.className = 'toast' + (erro ? ' erro' : ''); t.textContent = msg; document.body.appendChild(t); setTimeout(function() { t.remove(); }, 6000); }
  function params() { var p = S.cfg.parametros || {}; return {verde: p.verde != null ? Number(p.verde) : A.PARAMETROS.verde, amarelo: p.amarelo != null ? Number(p.amarelo) : A.PARAMETROS.amarelo, auditoriasPorSemana: p.auditoriasPorSemana != null ? Number(p.auditoriasPorSemana) : A.PARAMETROS.auditoriasPorSemana}; }
  /* Setores e áreas (editáveis em Configuração; sem configuração vale a lista inicial). */
  function listaSetores() { return A.setoresConfigurados(S.cfg.setores); }
  function nomesAtivos() { return listaSetores().filter(function(x) { return x.ativo; }).map(function(x) { return x.nome; }); }
  function nomesTodos() { return listaSetores().map(function(x) { return x.nome; }); }
  function areasDoSetor(nome) { var x = listaSetores().filter(function(y) { return y.nome === nome; })[0]; return x ? x.areas : []; }
  function lideresNomes(setor) {
    var u = S.cfg.usuarios || {};
    return A.lideresDoSetor(u, setor).map(function(k) { return u[k].nome || k; });
  }
  function nomeCfg(uid) { var u = (S.cfg.usuarios || {})[uid]; return (u && u.nome) || uid; }
  // Setores que o usuário lidera (líder, ou auditor que também é líder).
  function setoresLiderados() { var c = cfgUsuario() || {}, ativos = nomesAtivos(); return (c.setores || []).filter(function(x) { return ativos.indexOf(x) >= 0; }); }
  // Setores oferecidos no formulário: checklist do líder só nos que a pessoa lidera.
  function setoresDoForm(tipo) { return tipo === 'LIDER' && papel() === 'AUDITOR' ? setoresLiderados() : setoresDoUsuario(); }
  function treinamento() { return S.cfg.modoTreinamento !== false; }   // padrão: fase de testes e treinamento

  /* ── Papéis ── */
  function ehAdmin() { return !!(window.currentUser && window.currentUser.role === 'admin'); }
  function cfgUsuario() { return ((S.cfg.usuarios || {})[S.uid]) || null; }
  function papel() { return ehAdmin() ? 'ADMIN' : (cfgUsuario() && cfgUsuario().papel) || null; }
  function setoresDoUsuario() { var p = papel(), ativos = nomesAtivos(); if (p === 'ADMIN' || p === 'AUDITOR' || p === 'DIRETORIA' || p === 'GESTAO') return ativos; return ((cfgUsuario() || {}).setores || []).filter(function(x) { return ativos.indexOf(x) >= 0; }); }
  function veTudo() { return ['ADMIN', 'AUDITOR', 'DIRETORIA', 'GESTAO'].indexOf(papel()) >= 0; }
  function podeVerOcorrencias() { return ['ADMIN', 'AUDITOR', 'DIRETORIA', 'GESTAO'].indexOf(papel()) >= 0 || (window.currentUser && window.currentUser.role === 'rh'); }
  function tiposPermitidos() {
    var p = papel();
    if (p === 'ADMIN') return ['LIDER', 'QUALIDADE', 'DIRETORIA'];
    if (p === 'LIDER') return ['LIDER'];
    if (p === 'AUDITOR') return setoresLiderados().length ? ['QUALIDADE', 'LIDER'] : ['QUALIDADE'];
    if (p === 'DIRETORIA') return ['DIRETORIA'];
    return [];
  }
  function lideresDoSetor(setor) { return A.lideresDoSetor(S.cfg.usuarios || {}, setor); }
  function abasVisiveis() {
    return ABAS.filter(function(a) {
      if (a[0] === 'nova') return tiposPermitidos().length > 0;
      if (a[0] === 'ocorrencias') return podeVerOcorrencias() || tiposPermitidos().length > 0;
      if (a[0] === 'config') return ehAdmin();
      return true;
    });
  }
  function auditoriasVisiveis() {
    var meus = setoresDoUsuario(), todas = S.auditorias || {}, out = {};
    Object.keys(todas).forEach(function(k) { if (veTudo() || meus.indexOf(todas[k].setor) >= 0) out[k] = todas[k]; });
    return out;
  }

  /* ── Render geral ── */
  function render() {
    var p = papel();
    el('quemSou').textContent = p ? ({ADMIN: 'Administrador', LIDER: 'Líder: ' + setoresDoUsuario().join(', '), AUDITOR: 'Auditor (Qualidade/P&D)', DIRETORIA: 'Diretoria', GESTAO: 'Gestão'}[p]) : 'Papel não definido';
    el('faixaTreino').innerHTML = treinamento() ? '<div class="aviso warn"><b>Fase de testes e treinamento.</b> Os registros e as ocorrências feitos agora ficam marcados como treinamento e <b>não contam</b> para a escada disciplinar.</div>' : '';
    var abas = abasVisiveis();
    if (!abas.some(function(a) { return a[0] === S.aba; })) S.aba = 'painel';
    el('abas').innerHTML = abas.map(function(a) { return '<button type="button" class="aba' + (S.aba === a[0] ? ' on' : '') + '" data-aba="' + a[0] + '" role="tab">' + a[1] + '</button>'; }).join('');
    el('abas').querySelectorAll('[data-aba]').forEach(function(b) { b.onclick = function() { S.aba = b.getAttribute('data-aba'); render(); }; });
    if (!p) {
      el('conteudo').innerHTML = '<div class="card"><h2>Seu papel ainda não foi definido</h2><p class="dica">Peça ao administrador para definir, em Configuração, se você é líder de algum setor, auditor (Qualidade/P&D), Diretoria ou Gestão.</p></div>';
      return;
    }
    var fn = {painel: renderPainel, nova: renderNova, historico: renderHistorico, acoes: renderAcoes, ocorrencias: renderOcorrencias, config: renderConfig}[S.aba];
    var voltando = S.ultimaAba !== S.aba; S.ultimaAba = S.aba;
    if (S.aba === 'nova' && S.F && S.F.emEdicao && !voltando) return;   // dados novos não apagam o formulário que está sendo preenchido
    fn();
  }
  function prontos() { return S.carregou.cfg && S.carregou.aud && S.carregou.acoes; }
  function renderSoSePronto() { if (prontos()) render(); }

  /* ── Painel ── */
  function acoesAbertasPorSetor() {
    var out = {}, h = hoje();
    Object.keys(S.acoes || {}).forEach(function(k) {
      var a = S.acoes[k]; if (!a || a.status === 'RESOLVIDA' || a.anulada) return;
      var o = out[a.setor] = out[a.setor] || {abertas: 0, atrasadas: 0};
      o.abertas++; if (a.prazoEm && a.prazoEm < h) o.atrasadas++;
    });
    return out;
  }
  function renderPainel() {
    var aud = auditoriasVisiveis(), cob = A.cobertura(aud, hoje(), params(), nomesAtivos()), acoes = acoesAbertasPorSetor();
    var meus = setoresDoUsuario();
    var linhas = cob.filter(function(c) { return meus.indexOf(c.setor) >= 0; });
    var semLider = linhas.filter(function(c) { return !c.liderHoje; });
    var h = '';
    if (semLider.length) h += '<div class="aviso warn"><b>Checklist do líder de hoje ainda não feito:</b> ' + semLider.map(function(c) { return e(c.setor); }).join(', ') + '.</div>';
    h += '<div class="card"><h2>Situação por setor <span class="dica" style="font-weight:400">· ' + dataBR(hoje()) + '</span></h2><div class="tw"><table><thead><tr><th>Setor</th><th>Líder indicado</th><th>Checklist hoje</th><th>Auditorias na semana</th><th>Última externa</th><th>Último resultado</th><th>Ações abertas</th><th></th></tr></thead><tbody>' +
      linhas.map(function(c) {
        var a = acoes[c.setor] || {abertas: 0, atrasadas: 0};
        var ls = c.liderHoje ? '<span class="tg ok">✓ ' + e(c.turnosHoje.join(', ')) + ' turno</span>' : '<span class="tg bad">não fez</span>';
        var ex = c.externasSemana + '/' + c.metaSemana + (c.faltamSemana ? ' <span class="tg warn">faltam ' + c.faltamSemana + '</span>' : ' <span class="tg ok">ok</span>');
        var us = c.ultimoStatus ? '<span class="tg ' + (/VERDE/.test(c.ultimoStatus) ? 'ok' : /AMARELO/.test(c.ultimoStatus) ? 'warn' : 'bad') + '">' + e(c.ultimoStatus) + '</span>' : '<span class="mut">—</span>';
        var lids = lideresNomes(c.setor);
        var rod = A.rodizio(S.cfg.usuarios || {}, c.setor, S.auditorias || {}, hoje());
        var rodTxt = rod && rod.auditoresLideres.length > 1
          ? '<div class="dica">Rodízio: ' + (rod.checklistPor.length ? 'checklist de ' + e(rod.checklistPor.map(nomeCfg).join(', ')) + ' → auditoria de ' + e(rod.auditaPor.map(nomeCfg).join(', ') || '—') : 'quem preencher o checklist não audita hoje') + '</div>' : '';
        var areasTxt = areasDoSetor(c.setor).map(function(x) { return x.nome; }).join(' · ');
        return '<tr><td><b>' + e(c.setor) + '</b>' + (areasTxt ? '<div class="dica">' + e(areasTxt) + '</div>' : '') + '</td><td>' + (lids.length ? e(lids.join(', ')) : '<span class="tg bad">sem líder indicado</span>') + rodTxt + '</td><td>' + ls + '</td><td>' + ex + '</td><td>' + (c.ultimaExterna ? dataBR(c.ultimaExterna) : '<span class="mut">nunca</span>') + '</td><td>' + us + '</td><td>' + (a.abertas ? a.abertas + (a.atrasadas ? ' <span class="tg bad">' + a.atrasadas + ' atrasada(s)</span>' : '') : '<span class="mut">0</span>') + '</td><td>' +
          (tiposPermitidos().length ? '<button type="button" class="btn sm pri" data-ini="' + e(c.setor) + '">Iniciar</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    var recentes = Object.keys(aud).map(function(k) { return Object.assign({id: k}, aud[k]); }).sort(function(x, y) { return String(y.fechadaEm).localeCompare(String(x.fechadaEm)); }).slice(0, 6);
    h += '<div class="card"><h2>Últimos registros</h2>' + (recentes.length ? '<div class="tw"><table><tbody>' + recentes.map(linhaHistorico).join('') + '</tbody></table></div>' : '<p class="dica">Nenhuma auditoria registrada ainda.</p>') + '</div>';
    el('conteudo').innerHTML = h;
    el('conteudo').querySelectorAll('[data-ini]').forEach(function(b) { b.onclick = function() { S.aba = 'nova'; S.F = null; S.setorPre = b.getAttribute('data-ini'); render(); }; });
    ligarLinhasHistorico();
  }
  function linhaHistorico(a) {
    var r = a.resultado || {};
    var cor = /VERDE/.test(r.statusTexto || '') ? 'ok' : /AMARELO/.test(r.statusTexto || '') ? 'warn' : 'bad';
    return '<tr style="cursor:pointer" data-rel="' + e(a.id) + '"><td><b>' + e(a.setor) + '</b><div class="dica">' + e(A.TIPOS[a.tipo].rotulo) + (a.turno ? ' · ' + e(a.turno) + ' turno' : '') + (a.surpresa === true && a.tipo !== 'LIDER' ? ' · surpresa' : '') + '</div></td><td>' + dataBR(a.data) + ' ' + e(a.horario) + '<div class="dica">' + e(a.responsavelNome) + '</div></td><td><span class="tg ' + cor + '">' + e(r.statusTexto) + '</span> <b>' + pctTxt(r.pct) + '</b></td><td>' + (r.totalNC || 0) + ' NC' + (a.treinamento ? ' <span class="tg mute">treino</span>' : '') + (a.anulada ? ' <span class="tg bad">anulada</span>' : '') + '</td></tr>';
  }
  function ligarLinhasHistorico() { el('conteudo').querySelectorAll('[data-rel]').forEach(function(tr) { tr.onclick = function() { abrirRelatorio(tr.getAttribute('data-rel')); }; }); }

  /* ── Nova auditoria ── */
  function renderNova() {
    var tipos = tiposPermitidos();
    if (!tipos.length) { el('conteudo').innerHTML = '<div class="card"><p>Seu papel não cria auditorias.</p></div>'; return; }
    if (!S.F) {
      if (tipos.length === 1) { iniciarForm(tipos[0]); return; }
      el('conteudo').innerHTML = '<div class="card"><h2>Que auditoria vai fazer?</h2><div class="escolha">' +
        tipos.map(function(t) { var d = {LIDER: 'Checklist do líder', QUALIDADE: 'Auditoria da Qualidade', DIRETORIA: 'Inspeção da Diretoria'}[t]; var x = {LIDER: '8 itens inegociáveis + colaboração, no fim do turno.', QUALIDADE: '20 itens por senso + 4 críticos de segurança + conferência do líder. Sem aviso.', DIRETORIA: 'Mesmo checklist da Qualidade, inspeção surpresa da diretoria.'}[t]; return '<button type="button" data-tipo="' + t + '"><b>' + d + '</b><span class="dica">' + x + '</span></button>'; }).join('') + '</div></div>';
      el('conteudo').querySelectorAll('[data-tipo]').forEach(function(b) { b.onclick = function() { iniciarForm(b.getAttribute('data-tipo')); }; });
      return;
    }
    desenharForm();
  }
  function iniciarForm(tipo) {
    var setores = setoresDoForm(tipo);
    S.F = {tipo: tipo, emEdicao: true, setor: (S.setorPre && setores.indexOf(S.setorPre) >= 0) ? S.setorPre : (setores.length === 1 ? setores[0] : ''), turno: '', data: hoje(), horario: agoraHora(),
      surpresa: tipo !== 'LIDER' ? true : null, liderPresente: '', itens: {}, perguntas: {}, conferencia: {}, divergencias: [], fq: {}};
    S.setorPre = null;
    desenharForm();
  }
  function fotosPendentes() { var o = {}; Object.keys(S.F.fq).forEach(function(n) { o[n] = S.F.fq[n].total(); }); return o; }
  function audDoForm() {
    var F = S.F, itens = {};
    Object.keys(F.itens).forEach(function(n) { itens[n] = F.itens[n]; });
    return {tipo: F.tipo, setor: F.setor, turno: F.turno, data: F.data, horario: F.horario, responsavelNome: nomeUsuario(), surpresa: F.surpresa, liderPresente: F.liderPresente,
      itens: itens, perguntas: F.perguntas, conferencia: F.conferencia, divergencias: F.divergencias};
  }
  function desenharForm() {
    var F = S.F, it = A.itensDoTipo(F.tipo), setores = setoresDoForm(F.tipo);
    var h = '<div class="card"><h2>' + e(A.TIPOS[F.tipo].rotulo) + '</h2><div class="grid2">' +
      '<div><label class="t" for="fSetor">Setor</label><select id="fSetor"><option value="">Escolha…</option>' + setores.map(function(s) { return '<option' + (F.setor === s ? ' selected' : '') + '>' + e(s) + '</option>'; }).join('') + '</select></div>' +
      (F.tipo === 'LIDER' ? '<div><label class="t" for="fTurno">Turno</label><select id="fTurno"><option value="">Escolha…</option>' + A.TURNOS.map(function(t) { return '<option' + (F.turno === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></div>' : '') +
      '<div><label class="t" for="fData">Data</label><input type="date" id="fData" value="' + e(F.data) + '"></div>' +
      '<div><label class="t" for="fHora">Horário</label><input type="time" id="fHora" value="' + e(F.horario) + '"></div>' +
      '<div><label class="t">' + (F.tipo === 'LIDER' ? 'Líder responsável' : 'Auditor') + '</label><input type="text" value="' + e(nomeUsuario()) + '" disabled></div></div>';
    if (F.tipo !== 'LIDER') {
      h += '<div class="grid2" style="margin-top:10px"><div><label class="t">Tipo</label><div class="seg" id="segSurpresa"><button type="button" data-v="1" class="' + (F.surpresa === true ? 'on' : '') + '">Surpresa</button><button type="button" data-v="0" class="' + (F.surpresa === false ? 'on' : '') + '">Agendada</button></div></div>' +
        '<div><label class="t">Líder presente?</label><div class="seg" id="segLider"><button type="button" data-v="SIM" class="' + (F.liderPresente === 'SIM' ? 'on' : '') + '">Sim</button><button type="button" data-v="NAO" class="' + (F.liderPresente === 'NAO' ? 'on' : '') + '">Não</button></div></div></div>';
    }
    h += '</div><div class="ao-vivo" id="aoVivo"></div>';
    var senso = null;
    it.principais.forEach(function(x) {
      if (x.senso && x.senso !== senso) { senso = x.senso; h += '<div class="senso">' + e(senso) + '</div>'; }
      if (F.tipo === 'LIDER' && x.n === '1') h += '<div class="senso">A. Os 8 itens inegociáveis</div>';
      h += itemHtml(x);
    });
    if (it.criticos.length) { h += '<div class="senso" style="color:var(--bad)">Itens críticos de segurança (qualquer NC = vermelho)</div>'; it.criticos.forEach(function(x) { h += itemHtml(x); }); }
    if (F.tipo === 'LIDER') { h += '<div class="senso">B. Colaboração e execução</div>' + perguntasHtml(); }
    else { h += '<div class="senso">Conferência do líder (não entra na porcentagem)</div>' + conferenciaHtml(); }
    h += '<div class="card" style="margin-top:14px"><div class="aviso info" style="margin-top:0">Ao finalizar, o registro <b>não poderá mais ser alterado</b> e fica assinado digitalmente por <b>' + e(nomeUsuario()) + '</b> com data e hora.</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn pri" id="btnFinalizar">Finalizar e assinar</button><button type="button" class="btn" id="btnCancelarForm">Cancelar</button></div><div id="errosForm"></div></div>';
    el('conteudo').innerHTML = h;
    ligarForm();
    atualizarAoVivo();
  }
  function itemHtml(x) {
    var d = S.F.itens[x.n] || {}, r = d.r || '';
    var crit = x.critico || A.ehCritico(S.F.tipo, x.n);
    var h = '<div class="item ' + (r === 'NC' ? 'nc' : r === 'C' ? 'c' : '') + (crit ? ' crit' : '') + '" id="it' + x.n + '"><div><span class="n">' + e(x.n) + '</span><span class="tx">' + e(x.texto) + '</span></div><div class="como">' + e(x.como) + '</div>' +
      '<div class="resp" data-n="' + e(x.n) + '"><button type="button" class="C' + (r === 'C' ? ' on' : '') + '" data-r="C">C</button><button type="button" class="NC' + (r === 'NC' ? ' on' : '') + '" data-r="NC">NC</button>' + (crit ? '' : '<button type="button" class="NA' + (r === 'NA' ? ' on' : '') + '" data-r="NA">NA</button>') + '</div>';
    if (r === 'NC') {
      var ext = S.F.tipo !== 'LIDER';
      h += '<div class="ncbox"><div><label class="t">Local / posto da falha *</label><input type="text" list="dlAreas" placeholder="Área ou posto" data-c="local" data-n="' + e(x.n) + '" value="' + e(d.local) + '"></div>' +
        '<div><label class="t">Foto * (ao menos uma)</label><div data-foto="' + e(x.n) + '"></div></div>' +
        '<div><label class="t">Ação imediata *</label><input type="text" data-c="acao" data-n="' + e(x.n) + '" value="' + e(d.acao) + '"></div>' +
        '<div class="grid2"><div><label class="t">Responsável pela ação *</label><input type="text" list="dlEquipe" data-c="responsavel" data-n="' + e(x.n) + '" value="' + e(d.responsavel) + '"></div>' +
        (ext ? '<div><label class="t">Prazo</label><select data-c="prazo" data-n="' + e(x.n) + '"><option value="">Automático (' + (crit ? 'hoje' : '48 h') + ')</option>' + ['hoje', '48 h', '7 dias'].map(function(p) { return '<option' + (d.prazo === p ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select></div>' : '') + '</div></div>';
    }
    return h + '</div>';
  }
  function perguntasHtml() {
    var p = S.F.perguntas;
    var sn = function(ch, na) { return '<div class="seg" data-p="' + ch + '"><button type="button" data-v="SIM" class="' + (p[ch] === 'SIM' ? 'on' : '') + '">Sim</button><button type="button" data-v="NAO" class="' + (p[ch] === 'NAO' ? 'on' : '') + '">Não</button>' + (na ? '<button type="button" data-v="NA" class="' + (p[ch] === 'NA' ? 'on' : '') + '">NA</button>' : '') + '</div>'; };
    return '<div class="item"><span class="n">9</span><span class="tx">' + e(A.PERGUNTAS_LIDER[0].texto) + '</span><div class="como">' + e(A.PERGUNTAS_LIDER[0].como) + '</div>' + sn('mutirao') +
      (p.mutirao === 'SIM' ? '<div class="grid2" style="margin-top:8px"><div><label class="t">Horário de início</label><input type="time" data-pf="mutiraoHorario" value="' + e(p.mutiraoHorario) + '"></div><div><label class="t">Duração (min)</label><input type="number" min="1" data-pf="mutiraoMinutos" value="' + e(p.mutiraoMinutos) + '"></div></div>' : '') + '</div>' +
      '<div class="item"><span class="n">10</span><span class="tx">' + e(A.PERGUNTAS_LIDER[1].texto) + '</span><div class="como">' + e(A.PERGUNTAS_LIDER[1].como) + '</div>' + sn('todosParticiparam') +
      (p.todosParticiparam === 'NAO' ? '<div style="margin-top:8px"><label class="t">Quantos faltaram?</label><input type="number" min="1" data-pf="faltaram" value="' + e(p.faltaram) + '"></div>' : '') + '</div>' +
      '<div class="item"><span class="n">11</span><span class="tx">' + e(A.PERGUNTAS_LIDER[2].texto) + '</span><div class="como">' + e(A.PERGUNTAS_LIDER[2].como) + '</div>' + sn('pendenciasOntem', true) + '</div>' +
      '<div class="item"><span class="n">12</span><span class="tx">' + e(A.PERGUNTAS_LIDER[3].texto) + '</span><div class="como">' + e(A.PERGUNTAS_LIDER[3].como) + '</div><input type="number" min="0" data-pf="ocorrencias" value="' + e(p.ocorrencias) + '" style="max-width:140px"></div>';
  }
  function conferenciaHtml() {
    var v = S.F.conferencia, ncs = Object.keys(S.F.itens).filter(function(n) { return S.F.itens[n].r === 'NC'; });
    var sn = function(ch) { return '<div class="seg" data-v2="' + ch + '"><button type="button" data-v="SIM" class="' + (v[ch] === 'SIM' ? 'on' : '') + '">Sim</button><button type="button" data-v="NAO" class="' + (v[ch] === 'NAO' ? 'on' : '') + '">Não</button></div>'; };
    var h = '<div class="item"><span class="n">V1</span><span class="tx">' + e(A.CONFERENCIA[0].texto) + '</span><div class="como">' + e(A.CONFERENCIA[0].como) + '</div>' + sn('v1');
    if (v.v1 === 'NAO') {
      h += '<div style="margin-top:8px"><label class="t">Itens que o líder marcou C e foram encontrados NC *</label>' + (ncs.length ? ncs.map(function(n) { return '<label style="display:inline-flex;gap:5px;margin-right:12px;font-size:13px"><input type="checkbox" data-div="' + e(n) + '"' + (S.F.divergencias.indexOf(n) >= 0 ? ' checked' : '') + '> ' + e(n) + '</label>'; }).join('') : '<span class="dica">Marque NC nos itens acima para poder indicá-los aqui.</span>') + '</div>';
    }
    return h + '</div><div class="item"><span class="n">V2</span><span class="tx">' + e(A.CONFERENCIA[1].texto) + '</span><div class="como">' + e(A.CONFERENCIA[1].como) + '</div>' + sn('v2') + '</div>';
  }
  function datalistEquipe() {
    var eq = S.cfg.equipe || {}, nomes = Object.keys(eq).map(function(k) { return eq[k].nome; });
    var us = S.cfg.usuarios || {}; Object.keys(us).forEach(function(k) { if (us[k].nome && nomes.indexOf(us[k].nome) < 0) nomes.push(us[k].nome); });
    return '<datalist id="dlEquipe">' + nomes.map(function(n) { return '<option value="' + e(n) + '">'; }).join('') + '</datalist>';
  }
  function ligarForm() {
    var F = S.F, c = el('conteudo');
    c.insertAdjacentHTML('beforeend', datalistEquipe() + '<datalist id="dlAreas"></datalist>');
    atualizarAreas();
    el('fSetor').onchange = function() { F.setor = this.value; atualizarAreas(); atualizarAoVivo(); };
    if (el('fTurno')) el('fTurno').onchange = function() { F.turno = this.value; };
    el('fData').onchange = function() { F.data = this.value; }; el('fHora').onchange = function() { F.horario = this.value; };
    var sup = el('segSurpresa'); if (sup) sup.querySelectorAll('button').forEach(function(b) { b.onclick = function() { F.surpresa = b.getAttribute('data-v') === '1'; sup.querySelectorAll('button').forEach(function(x) { x.classList.toggle('on', x === b); }); }; });
    var ld = el('segLider'); if (ld) ld.querySelectorAll('button').forEach(function(b) { b.onclick = function() { F.liderPresente = b.getAttribute('data-v'); ld.querySelectorAll('button').forEach(function(x) { x.classList.toggle('on', x === b); }); }; });
    c.querySelectorAll('.resp').forEach(function(box) {
      box.querySelectorAll('button').forEach(function(b) {
        b.onclick = function() {
          var n = box.getAttribute('data-n'), r = b.getAttribute('data-r');
          F.itens[n] = Object.assign(F.itens[n] || {}, {r: r});
          if (r !== 'NC' && F.fq[n]) { delete F.fq[n]; }
          redesenharItem(n);
          atualizarAoVivo();
          if (F.tipo !== 'LIDER' && F.conferencia.v1 === 'NAO') desenharForm();   // atualiza a lista de itens da conferência V1
        };
      });
    });
    ligarCamposItens(c);
    c.querySelectorAll('[data-p]').forEach(function(box) { box.querySelectorAll('button').forEach(function(b) { b.onclick = function() { F.perguntas[box.getAttribute('data-p')] = b.getAttribute('data-v'); desenharForm(); }; }); });
    c.querySelectorAll('[data-pf]').forEach(function(i) { i.oninput = function() { F.perguntas[i.getAttribute('data-pf')] = i.value; }; });
    c.querySelectorAll('[data-v2]').forEach(function(box) { box.querySelectorAll('button').forEach(function(b) { b.onclick = function() { F.conferencia[box.getAttribute('data-v2')] = b.getAttribute('data-v'); desenharForm(); }; }); });
    c.querySelectorAll('[data-div]').forEach(function(i) { i.onchange = function() { var n = i.getAttribute('data-div'); var k = F.divergencias.indexOf(n); if (i.checked && k < 0) F.divergencias.push(n); if (!i.checked && k >= 0) F.divergencias.splice(k, 1); }; });
    el('btnCancelarForm').onclick = function() { if (confirm('Descartar esta auditoria?')) { S.F = null; render(); } };
    el('btnFinalizar').onclick = finalizar;
    // fotos dos itens já NC (ao redesenhar o formulário inteiro)
    Object.keys(F.itens).forEach(function(n) { if (F.itens[n].r === 'NC') montarFoto(n); });
  }
  function atualizarAreas() {
    var dl = el('dlAreas'); if (!dl || !S.F) return;
    dl.innerHTML = areasDoSetor(S.F.setor).map(function(x) { return '<option value="' + e(x.nome) + '">'; }).join('');
  }
  function ligarCamposItens(raiz) {
    raiz.querySelectorAll('[data-c]').forEach(function(i) {
      var h = function() { S.F.itens[i.getAttribute('data-n')][i.getAttribute('data-c')] = i.value; };
      i.oninput = h;
      i.onchange = function() {
        h();
        // Escolheu uma área que tem responsável indicado: já sugere esse responsável pela ação.
        if (i.getAttribute('data-c') !== 'local') return;
        var n = i.getAttribute('data-n'), area = areasDoSetor(S.F.setor).filter(function(x) { return x.nome === i.value.trim(); })[0];
        var campo = raiz.querySelector('[data-c="responsavel"][data-n="' + n + '"]');
        if (area && area.responsavel && campo && !campo.value.trim()) { campo.value = area.responsavel; S.F.itens[n].responsavel = area.responsavel; }
      };
    });
  }
  function montarFoto(n) {
    var alvo = document.querySelector('[data-foto="' + n + '"]'); if (!alvo) return;
    if (S.F.fq[n]) { alvo.innerHTML = ''; alvo.appendChild(S.F.fq[n].el); return; }
    var holder = document.createElement('div');
    var ctl = FotosQualidade.montar(holder, {permiteDispensa: false, obrigatoria: true});
    ctl.el = holder; S.F.fq[n] = ctl;
    alvo.appendChild(holder);
  }
  function redesenharItem(n) {
    var it = A.itensDoTipo(S.F.tipo), x = it.principais.concat(it.criticos).filter(function(y) { return y.n === n; })[0];
    var antigo = el('it' + n), tmp = document.createElement('div');
    tmp.innerHTML = itemHtml(x);
    var novo = tmp.firstChild;
    antigo.parentNode.replaceChild(novo, antigo);
    novo.querySelectorAll('.resp button').forEach(function(b) {
      b.onclick = function() {
        var r = b.getAttribute('data-r'); S.F.itens[n] = Object.assign(S.F.itens[n] || {}, {r: r});
        if (r !== 'NC' && S.F.fq[n]) delete S.F.fq[n];
        redesenharItem(n); atualizarAoVivo();
        if (S.F.tipo !== 'LIDER' && S.F.conferencia.v1 === 'NAO') desenharForm();
      };
    });
    ligarCamposItens(novo);
    if ((S.F.itens[n] || {}).r === 'NC') montarFoto(n);
  }
  function atualizarAoVivo() {
    var box = el('aoVivo'); if (!box || !S.F) return;
    var a = audDoForm(), r = A.calcular(a, params());
    box.innerHTML = '<span>Conformidade</span><b>' + pctTxt(r.pct) + '</b><span class="st ' + r.status + '">' + e(r.statusTexto) + '</span><span class="dica">' + r.c + ' C · ' + r.nc + ' NC · ' + r.na + ' NA' + (r.criticosNC.length ? ' · <b style="color:var(--bad)">crítico NC</b>' : '') + '</span>';
  }

  function finalizar() {
    var F = S.F, a = audDoForm();
    var erros = A.validar(a, {uid: S.uid, lideresDoSetor: lideresDoSetor(F.setor), fotosPendentes: fotosPendentes(), setores: setoresDoForm(F.tipo),
      auditorLider: papel() === 'AUDITOR', auditorias: S.auditorias || {}});
    var box = el('errosForm');
    if (erros.length) { box.innerHTML = '<div class="aviso bad"><b>Falta completar:</b><ul style="margin:6px 0 0;padding-left:18px">' + erros.map(function(x) { return '<li>' + e(x) + '</li>'; }).join('') + '</ul></div>'; box.scrollIntoView({block: 'center'}); return; }
    var r = A.calcular(a, params());
    if (!confirm('Finalizar a auditoria de ' + F.setor + '?\n\nResultado: ' + r.statusTexto + ' (' + pctTxt(r.pct) + ').\nO registro ficará assinado por ' + nomeUsuario() + ' e não poderá mais ser alterado.')) return;
    var btn = el('btnFinalizar'); btn.disabled = true; btn.textContent = 'Enviando fotos e gravando…';
    var chaveBase = F.data + '_' + F.setor.replace(/[^A-Za-z0-9]/g, '') + '_' + Date.now();
    var ncs = Object.keys(F.itens).filter(function(n) { return F.itens[n].r === 'NC'; });
    var storage = null;
    Promise.all(ncs.map(function(n) {
      var pend = F.fq[n] ? F.fq[n].pendentes() : [];
      if (pend.length && !storage) storage = firebase.storage();
      return FotosQualidade.enviar(storage, pend, {contexto: '5s', chave: chaveBase + '_' + n, autor: nomeUsuario()}).then(function(regs) { F.itens[n].fotos = regs; });
    })).then(function() {
      var agora = new Date().toISOString();
      var itens = {};
      Object.keys(F.itens).forEach(function(n) {
        var d = F.itens[n], o = {r: d.r};
        if (d.r === 'NC') { o.local = d.local.trim(); o.acao = d.acao.trim(); o.responsavel = d.responsavel.trim(); if (d.prazo) o.prazo = d.prazo; o.fotos = d.fotos || []; }
        itens[n] = o;
      });
      var audFinal = Object.assign(audDoForm(), {itens: itens});
      var resultado = A.calcular(audFinal, params());
      var acoesObr = A.acoesObrigatorias(audFinal, resultado);
      var reg = {tipo: F.tipo, setor: F.setor, turno: F.turno || null, data: F.data, horario: F.horario, responsavelNome: nomeUsuario(), responsavelUid: S.uid,
        surpresa: F.tipo === 'LIDER' ? false : F.surpresa, liderPresente: F.liderPresente || null, itens: itens, perguntas: F.tipo === 'LIDER' ? F.perguntas : null,
        conferencia: F.tipo === 'LIDER' ? null : F.conferencia, divergencias: F.divergencias || [], resultado: resultado, acoesObrigatorias: acoesObr,
        linhaControle: A.linhaControle(audFinal, resultado), treinamento: treinamento(), params: params(),
        assinatura: {uid: S.uid, nome: nomeUsuario(), em: agora, metodo: 'digital'}, fechadaEm: agora};
      Object.keys(reg).forEach(function(k) { if (reg[k] === null) delete reg[k]; });
      var id = db.ref('auditorias_5s').push().key, up = {};
      up['auditorias_5s/' + id] = reg;
      ncs.forEach(function(n) {
        var d = itens[n], crit = A.ehCritico(F.tipo, n);
        var prazo = d.prazo || (crit ? 'hoje' : '48 h');
        up['acoes_5s/' + db.ref('acoes_5s').push().key] = {auditoriaId: id, setor: F.setor, item: n, texto: (A.itensDoTipo(F.tipo).principais.concat(A.itensDoTipo(F.tipo).criticos).filter(function(x) { return x.n === n; })[0] || {}).texto,
          local: d.local, acao: d.acao, responsavel: d.responsavel, prazo: prazo, prazoEm: prazoEm(F.data, prazo), status: 'ABERTA', critico: crit, criadoEm: agora, treinamento: treinamento()};
      });
      return db.ref().update(up).then(function() { return id; });
    }).then(function(id) {
      S.F = null; toast('Auditoria finalizada e assinada.');
      S.aud = S.aud || {};
      S.aba = 'historico'; render(); abrirRelatorio(id);
    }).catch(function(err) { btn.disabled = false; btn.textContent = 'Finalizar e assinar'; toast('Não foi possível gravar: ' + (err && err.message || err), true); });
  }
  function prazoEm(data, prazo) {
    var d = new Date(data + 'T12:00:00'), dias = prazo === 'hoje' ? 0 : prazo === '48 h' ? 2 : 7;
    d.setDate(d.getDate() + dias);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ── Histórico e relatório ── */
  function renderHistorico() {
    var f = S.filtroHist, aud = auditoriasVisiveis();
    var lista = Object.keys(aud).map(function(k) { return Object.assign({id: k}, aud[k]); }).filter(function(a) { return (!f.setor || a.setor === f.setor) && (!f.tipo || a.tipo === f.tipo); })
      .sort(function(x, y) { return String(y.fechadaEm).localeCompare(String(x.fechadaEm)); });
    el('conteudo').innerHTML = '<div class="card"><div class="grid2" style="margin-bottom:10px"><div><label class="t">Setor</label><select id="hSetor"><option value="">Todos</option>' + (veTudo() ? nomesTodos() : setoresDoUsuario()).map(function(s) { return '<option' + (f.setor === s ? ' selected' : '') + '>' + e(s) + '</option>'; }).join('') + '</select></div><div><label class="t">Tipo</label><select id="hTipo"><option value="">Todos</option>' + Object.keys(A.TIPOS).map(function(t) { return '<option value="' + t + '"' + (f.tipo === t ? ' selected' : '') + '>' + e(A.TIPOS[t].rotulo) + '</option>'; }).join('') + '</select></div></div>' +
      (lista.length ? '<div class="tw"><table><thead><tr><th>Setor</th><th>Quando</th><th>Resultado</th><th></th></tr></thead><tbody>' + lista.map(linhaHistorico).join('') + '</tbody></table></div>' : '<p class="dica">Nenhuma auditoria encontrada.</p>') + '</div>';
    el('hSetor').onchange = function() { S.filtroHist.setor = this.value; renderHistorico(); };
    el('hTipo').onchange = function() { S.filtroHist.tipo = this.value; renderHistorico(); };
    ligarLinhasHistorico();
  }
  function abrirRelatorio(id) {
    var a = (S.auditorias || {})[id]; if (!a) return;
    var r = a.resultado || {}, it = A.itensDoTipo(a.tipo), todos = it.principais.concat(it.criticos);
    var cien = (S.ciencia || {})[id] || {};
    var ncs = todos.filter(function(x) { return (a.itens[x.n] || {}).r === 'NC'; });
    var h = '<div class="mf" id="mfRel"><div class="md rel" id="relPrint"><div class="noprint" style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:8px"><button type="button" class="btn" id="relImprimir">🖨 Imprimir</button><button type="button" class="btn" id="relFechar">Fechar</button></div>' +
      '<h2>' + e(A.TIPOS[a.tipo].rotulo) + ' — ' + e(a.setor) + '</h2><div class="dica">' + dataBR(a.data) + ' · ' + e(a.horario) + (a.turno ? ' · ' + e(a.turno) + ' turno' : '') + ' · ' + e(a.responsavelNome) + (a.tipo !== 'LIDER' ? ' · ' + (a.surpresa ? 'surpresa' : 'agendada') + ' · líder ' + (a.liderPresente === 'SIM' ? 'presente' : 'ausente') : '') + (a.treinamento ? ' · <b>TREINAMENTO</b>' : '') + '</div>' +
      '<h3>Resultado</h3><div><span class="st ' + e(r.status) + '">' + e(r.statusTexto) + '</span> &nbsp; <b style="font-size:20px">' + pctTxt(r.pct) + '</b> &nbsp; <span class="dica">' + r.c + ' conformes · ' + r.nc + ' não conformes · ' + r.na + ' NA</span></div>';
    if (r.porSenso) h += '<div class="dica" style="margin-top:6px">' + A.SENSOS.map(function(s) { return s + ' ' + pctTxt(r.porSenso[s].pct); }).join(' · ') + '</div>';
    h += '<h3>Itens não conformes</h3>' + (ncs.length ? '<div class="tw"><table><thead><tr><th>Item</th><th>Local/posto</th><th>Foto</th><th>Ação imediata e responsável</th></tr></thead><tbody>' + ncs.map(function(x) {
      var d = a.itens[x.n] || {}, fotos = A.fotosDe(d);
      return '<tr><td><b>' + e(x.n) + '</b> ' + e(x.texto) + '</td><td>' + e(d.local) + '</td><td class="fotos">' + fotos.map(function(f) { return '<a href="' + e(f.url) + '" target="_blank" rel="noopener"><img src="' + e(f.url) + '" alt="foto"></a>'; }).join('') + '</td><td>' + e(d.acao) + '<div class="dica">' + e(d.responsavel) + (d.prazo ? ' · ' + e(d.prazo) : '') + '</div></td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="dica">Nenhum.</p>');
    h += '<h3>Alertas</h3>' + ((r.alertas || []).length ? '<ul style="margin:0;padding-left:18px">' + r.alertas.map(function(x) { return '<li>' + e(x) + '</li>'; }).join('') + '</ul>' : '<p class="dica">Sem alertas.</p>');
    h += '<h3>Ações obrigatórias</h3>' + ((a.acoesObrigatorias || []).length ? '<ol style="margin:0;padding-left:18px">' + a.acoesObrigatorias.map(function(x) { return '<li><b>' + e(x.n) + '</b> ' + e(x.texto) + ' — ' + e(x.acao) + ' · ' + e(x.responsavel) + ' · <b>' + e(x.prazo) + '</b></li>'; }).join('') + '</ol>' : '<p class="dica">Nenhuma.</p>');
    h += '<h3>Consequência sugerida</h3><div>' + e(A.consequencia(r.status)) + '</div>';
    if (a.perguntas) { var q = a.perguntas; h += '<h3>Colaboração</h3><div class="dica">Mutirão: ' + (q.mutirao === 'SIM' ? 'sim, ' + e(q.mutiraoHorario) + ' por ' + e(q.mutiraoMinutos) + ' min' : 'não') + ' · Todos participaram: ' + (q.todosParticiparam === 'SIM' ? 'sim' : 'não (' + e(q.faltaram) + ' faltaram)') + ' · Pendências de ontem: ' + e(q.pendenciasOntem) + ' · Ocorrências hoje: ' + e(q.ocorrencias) + '</div>'; }
    h += '<h3>Linha para a planilha de controle</h3><pre>' + e(a.linhaControle) + '</pre>';
    var assin = '<div><b>' + e(a.assinatura.nome) + '</b><br>' + (a.tipo === 'LIDER' ? 'Líder do setor' : 'Auditor') + ' · assinado digitalmente em ' + new Date(a.assinatura.em).toLocaleString('pt-BR') + '</div>';
    var papeis = a.tipo === 'LIDER' ? [['gerencia', 'Gerência / Qualidade (ciência)']] : [['lider', 'Líder do setor (ciente)'], ['gerencia', 'Gerência (ciência)']];
    var podeCiencia = !!papel();
    papeis.forEach(function(p) {
      var c = cien[p[0]];
      assin += '<div>' + (c ? '<b>' + e(c.nome) + '</b><br>' + e(p[1]) + ' · em ' + new Date(c.em).toLocaleString('pt-BR') : e(p[1]) + '<br><span class="dica">pendente</span>' + (podeCiencia ? '<br><button type="button" class="btn sm noprint" data-ciencia="' + p[0] + '">Dar ciência</button>' : '')) + '</div>';
    });
    h += '<h3>Assinaturas</h3><div class="assin">' + assin + '</div><p class="dica" style="margin-top:14px">Imprimir, assinar (líder e gerência/qualidade) e arquivar por 12 meses.</p></div></div>';
    el('modais').innerHTML = h;
    el('relFechar').onclick = function() { el('modais').innerHTML = ''; };
    el('relImprimir').onclick = function() { window.print(); };
    el('modais').querySelectorAll('[data-ciencia]').forEach(function(b) {
      b.onclick = function() {
        db.ref('ciencia_5s/' + id + '/' + b.getAttribute('data-ciencia')).set({uid: S.uid, nome: nomeUsuario(), em: new Date().toISOString()})
          .then(function() { toast('Ciência registrada.'); }).catch(function(err) { toast('Não foi possível registrar: ' + (err && err.message || err), true); });
      };
    });
  }

  /* ── Plano de ações ── */
  function renderAcoes() {
    var meus = setoresDoUsuario(), h = hoje();
    var lista = Object.keys(S.acoes || {}).map(function(k) { return Object.assign({id: k}, S.acoes[k]); }).filter(function(a) { return meus.indexOf(a.setor) >= 0 && !a.anulada; })
      .sort(function(x, y) { return (x.status === 'RESOLVIDA') - (y.status === 'RESOLVIDA') || String(x.prazoEm).localeCompare(String(y.prazoEm)); });
    el('conteudo').innerHTML = '<div class="card"><h2>Plano de ações</h2><p class="dica">Uma linha por NC encontrado. A ação fica aberta até alguém registrar que foi resolvida.</p>' +
      (lista.length ? '<div class="tw"><table><thead><tr><th>Setor / item</th><th>Ação e responsável</th><th>Prazo</th><th>Situação</th><th></th></tr></thead><tbody>' + lista.map(function(a) {
        var atrasada = a.status !== 'RESOLVIDA' && a.prazoEm && a.prazoEm < h;
        return '<tr><td><b>' + e(a.setor) + '</b><div class="dica">Item ' + e(a.item) + ' · ' + e(a.local) + (a.critico ? ' · <b style="color:var(--bad)">crítico</b>' : '') + (a.treinamento ? ' · treino' : '') + '</div></td><td>' + e(a.acao) + '<div class="dica">' + e(a.responsavel) + '</div></td><td>' + dataBR(a.prazoEm) + '<div class="dica">' + e(a.prazo) + '</div></td><td>' +
          (a.status === 'RESOLVIDA' ? '<span class="tg ok">Resolvida ' + dataBR(a.resolvidaEm) + '</span><div class="dica">' + e(a.resolvidaPor) + (a.nota ? ' · ' + e(a.nota) : '') + '</div>' : (atrasada ? '<span class="tg bad">Atrasada</span>' : '<span class="tg warn">Aberta</span>')) + '</td><td>' +
          (a.status === 'RESOLVIDA' ? '' : '<button type="button" class="btn sm" data-resolver="' + e(a.id) + '">Marcar resolvida</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="dica">Nenhuma ação registrada.</p>') + '</div>';
    el('conteudo').querySelectorAll('[data-resolver]').forEach(function(b) {
      b.onclick = function() {
        var nota = window.prompt('Como foi resolvido? (opcional)') ; if (nota === null) return;
        db.ref('acoes_5s/' + b.getAttribute('data-resolver')).update({status: 'RESOLVIDA', resolvidaEm: new Date().toISOString(), resolvidaPor: nomeUsuario(), nota: String(nota || '').trim()})
          .catch(function(err) { toast('Não foi possível gravar: ' + (err && err.message || err), true); });
      };
    });
  }

  /* ── Ocorrências individuais ── */
  function renderOcorrencias() {
    var ver = podeVerOcorrencias(), setores = setoresDoUsuario(), eq = S.cfg.equipe || {};
    var h = '<div class="card"><h2>Registrar ocorrência individual</h2><p class="dica">Registre a pessoa responsável pela falha. O sistema <b>só sugere</b> o degrau da escada disciplinar; quem valida e aplica é o RH. ' + (treinamento() ? '<b>Em treinamento, não conta para a escada.</b>' : '') + '</p>' +
      '<div class="grid2"><div><label class="t" for="oColab">Colaborador *</label><input type="text" id="oColab" list="dlEquipe" placeholder="Nome (lista da equipe ou digite)"></div>' +
      '<div><label class="t" for="oSetor">Setor *</label><select id="oSetor"><option value="">Escolha…</option>' + setores.map(function(s) { return '<option>' + e(s) + '</option>'; }).join('') + '</select></div>' +
      '<div><label class="t" for="oData">Data</label><input type="date" id="oData" value="' + hoje() + '"></div></div>' +
      '<div style="margin-top:8px"><label class="t" for="oDesc">O que aconteceu (item / local) *</label><input type="text" id="oDesc" placeholder="Ex.: item 4 — material fora da faixa no posto 2"></div>' +
      '<label style="display:flex;gap:6px;align-items:center;margin:10px 0;font-size:13px"><input type="checkbox" id="oSeg"> Item de segurança (sobe um degrau)</label>' +
      '<div id="oSugestao" class="aviso info"></div><button type="button" class="btn pri" id="oSalvar">Registrar ocorrência</button></div>' + datalistEquipe();
    if (ver) {
      var ocs = Object.keys(S.ocorrencias || {}).map(function(k) { return Object.assign({id: k}, S.ocorrencias[k]); }).sort(function(x, y) { return String(y.data).localeCompare(String(x.data)); });
      h += '<div class="card"><h2>Ocorrências registradas</h2>' + (ocs.length ? '<div class="tw"><table><thead><tr><th>Data</th><th>Colaborador</th><th>Setor</th><th>Descrição</th><th>Degrau sugerido</th><th></th></tr></thead><tbody>' + ocs.map(function(o) {
        return '<tr><td>' + dataBR(o.data) + '</td><td><b>' + e(o.colaboradorNome) + '</b></td><td>' + e(o.setor) + '</td><td>' + e(o.descricao) + (o.seguranca ? ' <span class="tg bad">segurança</span>' : '') + (o.treinamento ? ' <span class="tg mute">treino</span>' : '') + (o.anulada ? ' <span class="tg bad">anulada</span>' : '') + '<div class="dica">registrada por ' + e(o.registradoPorNome) + '</div></td><td class="dica">' + e(o.degrauSugerido ? o.degrauSugerido.texto : '—') + '</td><td>' + ((ehAdmin() || papel() === 'GESTAO') && !o.anulada ? '<button type="button" class="btn sm perigo" data-anular="' + e(o.id) + '">Anular</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="dica">Nenhuma ocorrência registrada.</p>') + '</div>';
    } else h += '<div class="aviso info">Você registra ocorrências; a lista com nomes é restrita ao RH, gestão e auditores.</div>';
    el('conteudo').innerHTML = h;
    function sugestao() {
      var nome = el('oColab').value.trim(), seg = el('oSeg').checked, box = el('oSugestao');
      if (!nome) { box.textContent = 'Informe o colaborador para ver a sugestão da escada.'; return; }
      if (!ver) { var s0 = A.escada(0, seg); box.innerHTML = 'Você não vê o histórico da pessoa; o RH calcula o degrau. <span class="dica">(' + e(s0.aviso) + ')</span>'; return; }
      var id = colabId(nome), ant = A.ocorrenciasNosUltimos90(S.ocorrencias || {}, id, hoje()), s = A.escada(ant, seg);
      box.innerHTML = '<b>Sugestão: ' + e(s.texto) + '</b><br><span class="dica">' + ant + ' ocorrência(s) nos últimos 90 dias' + (seg ? ' · segurança sobe um degrau' : '') + '. ' + e(s.aviso) + '</span>';
    }
    ['oColab', 'oSeg'].forEach(function(id) { el(id).oninput = sugestao; el(id).onchange = sugestao; });
    sugestao();
    el('oSalvar').onclick = function() {
      var nome = el('oColab').value.trim(), setor = el('oSetor').value, desc = el('oDesc').value.trim(), seg = el('oSeg').checked;
      if (!nome || !setor || !desc) { toast('Informe colaborador, setor e o que aconteceu.', true); return; }
      var id = colabId(nome), ant = ver ? A.ocorrenciasNosUltimos90(S.ocorrencias || {}, id, el('oData').value || hoje()) : 0;
      var reg = {data: el('oData').value || hoje(), setor: setor, colaboradorId: id, colaboradorNome: nome, descricao: desc, seguranca: seg, registradoPorUid: S.uid, registradoPorNome: nomeUsuario(),
        registradoEm: new Date().toISOString(), treinamento: treinamento(), degrauSugerido: ver ? A.escada(ant, seg) : null};
      if (!reg.degrauSugerido) delete reg.degrauSugerido;
      db.ref('ocorrencias_5s').push(reg).then(function() { toast('Ocorrência registrada.'); el('oColab').value = ''; el('oDesc').value = ''; el('oSeg').checked = false; sugestao(); })
        .catch(function(err) { toast('Não foi possível registrar: ' + (err && err.message || err), true); });
    };
    el('conteudo').querySelectorAll('[data-anular]').forEach(function(b) { b.onclick = function() { if (confirm('Anular esta ocorrência? Ela deixa de contar na escada (o registro continua).')) db.ref('ocorrencias_5s/' + b.getAttribute('data-anular') + '/anulada').set(true); }; });
  }
  function colabId(nome) {
    var eq = S.cfg.equipe || {}, n = A.itensDoTipo ? String(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim() : nome;
    var achado = Object.keys(eq).filter(function(k) { return String(eq[k].nome).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim() === n; })[0];
    return achado || ('n_' + n.replace(/[^a-z0-9]/g, '_'));
  }

  /* ── Setores e áreas (admin) ── */
  function copiaSetores() { return listaSetores().map(function(x) { return {id: x.id, nome: x.nome, ativo: x.ativo, novo: false, areas: x.areas.map(function(a) { return {nome: a.nome, responsavel: a.responsavel}; })}; }); }
  function editorSetoresHtml() {
    if (!S.edSetores) S.edSetores = copiaSetores();
    var h = '<div class="card"><h2>Setores e áreas</h2><p class="dica">Cada setor tem um <b>líder indicado</b> (definido em "Quem é quem") e as <b>áreas</b> dentro dele, cada uma com seu responsável. A área aparece como sugestão no local da falha e o responsável dela já vem preenchido na ação. Setor com auditoria registrada não se apaga: <b>desative</b>.</p>';
    S.edSetores.forEach(function(x, i) {
      var lids = lideresNomes(x.nome);
      h += '<div class="item" style="margin-bottom:10px"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:220px">' + (x.novo ? '<input type="text" data-sn="' + i + '" value="' + e(x.nome) + '" placeholder="Nome do setor">' : '<b>' + e(x.nome) + '</b>') + '</div>' +
        '<label style="display:inline-flex;gap:5px;font-size:13px"><input type="checkbox" data-sa="' + i + '"' + (x.ativo ? ' checked' : '') + '> ativo</label>' +
        (x.novo ? '<button type="button" class="btn sm perigo" data-srem="' + i + '">Remover</button>' : '') + '</div>' +
        '<div class="dica" style="margin:6px 0">Líder indicado: ' + (lids.length ? '<b>' + e(lids.join(', ')) + '</b>' : '<span class="tg bad">nenhum — defina em "Quem é quem"</span>') + '</div>';
      x.areas.forEach(function(a, j) {
        h += '<div class="grid2" style="margin-bottom:6px;grid-template-columns:1fr 1fr auto;align-items:end"><div><label class="t">Área</label><input type="text" data-an="' + i + ':' + j + '" value="' + e(a.nome) + '"></div><div><label class="t">Responsável da área</label><input type="text" list="dlEquipe" data-ar="' + i + ':' + j + '" value="' + e(a.responsavel) + '" placeholder="Quem responde por esta área"></div><button type="button" class="btn sm perigo" data-arem="' + i + ':' + j + '">Remover</button></div>';
      });
      h += '<button type="button" class="btn sm" data-aadd="' + i + '">+ Área</button></div>';
    });
    return h + '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn" id="sAdd">+ Novo setor</button><button type="button" class="btn pri" id="sSalvar">Salvar setores e áreas</button></div>' + datalistEquipe() + '</div>';
  }
  function lerEditorSetores() {
    var c = el('conteudo');
    c.querySelectorAll('[data-sn]').forEach(function(i) { S.edSetores[Number(i.getAttribute('data-sn'))].nome = i.value.trim(); });
    c.querySelectorAll('[data-sa]').forEach(function(i) { S.edSetores[Number(i.getAttribute('data-sa'))].ativo = i.checked; });
    c.querySelectorAll('[data-an]').forEach(function(i) { var p = i.getAttribute('data-an').split(':'); S.edSetores[Number(p[0])].areas[Number(p[1])].nome = i.value.trim(); });
    c.querySelectorAll('[data-ar]').forEach(function(i) { var p = i.getAttribute('data-ar').split(':'); S.edSetores[Number(p[0])].areas[Number(p[1])].responsavel = i.value.trim(); });
  }
  function ligarEditorSetores() {
    var c = el('conteudo');
    c.querySelectorAll('[data-aadd]').forEach(function(b) { b.onclick = function() { lerEditorSetores(); S.edSetores[Number(b.getAttribute('data-aadd'))].areas.push({nome: '', responsavel: ''}); renderConfig(); }; });
    c.querySelectorAll('[data-arem]').forEach(function(b) { b.onclick = function() { lerEditorSetores(); var p = b.getAttribute('data-arem').split(':'); S.edSetores[Number(p[0])].areas.splice(Number(p[1]), 1); renderConfig(); }; });
    c.querySelectorAll('[data-srem]').forEach(function(b) { b.onclick = function() { lerEditorSetores(); S.edSetores.splice(Number(b.getAttribute('data-srem')), 1); renderConfig(); }; });
    el('sAdd').onclick = function() { lerEditorSetores(); S.edSetores.push({id: null, nome: '', ativo: true, novo: true, areas: []}); renderConfig(); };
    el('sSalvar').onclick = function() {
      lerEditorSetores();
      var nomes = S.edSetores.map(function(x) { return x.nome; });
      if (nomes.some(function(n) { return !n; })) { toast('Todo setor precisa de nome.', true); return; }
      if (nomes.some(function(n, i) { return nomes.indexOf(n) !== i; })) { toast('Há dois setores com o mesmo nome.', true); return; }
      var obj = {};
      S.edSetores.forEach(function(x, i) {
        var areas = {}, k = 0;
        x.areas.forEach(function(a) { if (!a.nome) return; k++; areas['a' + String(k).padStart(2, '0')] = {nome: a.nome, responsavel: a.responsavel || ''}; });
        obj['s' + String(i + 1).padStart(2, '0')] = {nome: x.nome, ativo: x.ativo, ordem: i + 1, areas: areas};
      });
      db.ref('auditoria5s_config/setores').set(obj).then(function() { S.edSetores = null; toast('Setores e áreas salvos.'); }).catch(function(err) { toast(err.message, true); });
    };
  }

  /* ── Configuração (admin) ── */
  function renderConfig() {
    var us = S.usuarios || {}, cu = S.cfg.usuarios || {}, p = params();
    var h = '<div class="card"><h2>Parâmetros</h2><div class="grid2"><div><label class="t">Meta VERDE (conformidade ≥ %)</label><input type="number" id="cVerde" min="1" max="100" value="' + Math.round(p.verde * 100) + '"></div>' +
      '<div><label class="t">Limite AMARELO (≥ %)</label><input type="number" id="cAmarelo" min="1" max="100" value="' + Math.round(p.amarelo * 100) + '"></div>' +
      '<div><label class="t">Auditorias externas por setor por semana</label><input type="number" id="cSemana" min="1" value="' + p.auditoriasPorSemana + '"></div></div>' +
      '<label style="display:flex;gap:6px;align-items:center;margin:12px 0;font-size:13px"><input type="checkbox" id="cTreino"' + (treinamento() ? ' checked' : '') + '> <b>Fase de testes e treinamento</b> (registros e ocorrências ficam marcados e não contam para a escada)</label>' +
      '<button type="button" class="btn pri" id="cSalvarParam">Salvar parâmetros</button></div>';
    h += '<div class="card"><h2>Quem é quem</h2><p class="dica">Só aparecem aqui os usuários que têm o módulo <b>Auditoria 5S</b> marcado em Usuários. Líder: preenche o checklist dos setores marcados. Auditor: Qualidade/P&D (audita qualquer setor). <b>Auditor que também é líder</b>: marque os setores dele — preenche o checklist desses setores e, no mesmo dia, quem preencheu não audita (rodízio com a outra líder). Diretoria: inspeções surpresa. Gestão: acompanha tudo e anula ocorrências.</p>';
    var com = Object.keys(us).filter(function(k) { return us[k] && (us[k].role === 'admin' || (us[k].modulos && us[k].modulos.auditoria5s === true)); });
    h += com.length ? '<div class="tw"><table><thead><tr><th>Usuário</th><th>Papel</th><th>Setores (líder)</th><th></th></tr></thead><tbody>' + com.map(function(k) {
      var c = cu[k] || {};
      return '<tr><td><b>' + e(us[k].nome || us[k].email || k) + '</b><div class="dica">' + e(us[k].email || '') + '</div></td><td><select data-papel="' + k + '"><option value="">—</option>' + [['LIDER', 'Líder de setor'], ['AUDITOR', 'Auditor (Qualidade/P&D)'], ['DIRETORIA', 'Diretoria'], ['GESTAO', 'Gestão']].map(function(o) { return '<option value="' + o[0] + '"' + (c.papel === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></td><td>' +
        nomesAtivos().map(function(s) { return '<label style="display:inline-flex;gap:4px;margin:0 10px 4px 0;font-size:12.5px"><input type="checkbox" data-setor-u="' + k + '" value="' + e(s) + '"' + ((c.setores || []).indexOf(s) >= 0 ? ' checked' : '') + '> ' + e(s) + '</label>'; }).join('') + '</td><td><button type="button" class="btn sm" data-salvar-u="' + k + '">Salvar</button></td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="dica">Nenhum usuário com o módulo marcado ainda.</p>';
    h += '</div>' + editorSetoresHtml() + '<div class="card"><h2>Equipe (para indicar responsáveis)</h2><p class="dica">Uma pessoa por linha: <b>Nome;Setor</b>. Aparece nas listas de responsável e de ocorrências.</p><textarea id="cEquipe" rows="6" placeholder="Maria Souza;Produção">' +
      e(Object.keys(S.cfg.equipe || {}).map(function(k) { return S.cfg.equipe[k].nome + ';' + (S.cfg.equipe[k].setor || ''); }).join('\n')) + '</textarea><div style="margin-top:8px"><button type="button" class="btn pri" id="cSalvarEquipe">Salvar equipe</button></div></div>';
    el('conteudo').innerHTML = h;
    el('cSalvarParam').onclick = function() {
      var v = Number(el('cVerde').value) / 100, a = Number(el('cAmarelo').value) / 100;
      if (!(v > a && a > 0 && v <= 1)) { toast('A meta verde precisa ser maior que o limite amarelo.', true); return; }
      db.ref('auditoria5s_config').update({parametros: {verde: v, amarelo: a, auditoriasPorSemana: Number(el('cSemana').value) || 2}, modoTreinamento: el('cTreino').checked}).then(function() { toast('Parâmetros salvos.'); }).catch(function(err) { toast(err.message, true); });
    };
    el('conteudo').querySelectorAll('[data-salvar-u]').forEach(function(b) {
      b.onclick = function() {
        var k = b.getAttribute('data-salvar-u'), pp = el('conteudo').querySelector('[data-papel="' + k + '"]').value;
        var ss = [].slice.call(el('conteudo').querySelectorAll('[data-setor-u="' + k + '"]')).filter(function(c) { return c.checked; }).map(function(c) { return c.value; });
        if (pp === 'LIDER' && !ss.length) { toast('Marque ao menos um setor para o líder.', true); return; }
        var obj = pp ? {papel: pp, setores: (pp === 'LIDER' || pp === 'AUDITOR') ? ss : [], nome: (us[k] && (us[k].nome || us[k].email)) || k} : null;
        db.ref('auditoria5s_config/usuarios/' + k).set(obj).then(function() { toast('Salvo.'); }).catch(function(err) { toast(err.message, true); });
      };
    });
    ligarEditorSetores();
    el('cSalvarEquipe').onclick = function() {
      var linhas = el('cEquipe').value.split('\n').map(function(l) { return l.trim(); }).filter(Boolean), obj = {};
      linhas.forEach(function(l, i) { var p = l.split(';'); var nome = (p[0] || '').trim(); if (!nome) return; obj['p' + (i + 1)] = {nome: nome, setor: (p[1] || '').trim()}; });
      db.ref('auditoria5s_config/equipe').set(Object.keys(obj).length ? obj : null).then(function() { toast('Equipe salva (' + Object.keys(obj).length + ' pessoas).'); }).catch(function(err) { toast(err.message, true); });
    };
  }

  /* ── Carga ── */
  function iniciar() {
    S.uid = firebase.auth().currentUser && firebase.auth().currentUser.uid;
    dbOnValue(db.ref('auditoria5s_config'), function(s) { S.cfg = s.val() || {}; S.carregou.cfg = true; renderSoSePronto(); });
    dbOnValue(db.ref('auditorias_5s'), function(s) { S.auditorias = s.val() || {}; S.carregou.aud = true; renderSoSePronto(); }, {onError: function() { S.auditorias = {}; S.carregou.aud = true; renderSoSePronto(); }});
    dbOnValue(db.ref('acoes_5s'), function(s) { S.acoes = s.val() || {}; S.carregou.acoes = true; renderSoSePronto(); }, {onError: function() { S.acoes = {}; S.carregou.acoes = true; renderSoSePronto(); }});
    dbOnValue(db.ref('ciencia_5s'), function(s) { S.ciencia = s.val() || {}; if (el('mfRel')) { var f = document.querySelector('#relPrint'); } renderSoSePronto(); });
    dbOnValue(db.ref('ocorrencias_5s'), function(s) { S.ocorrencias = s.val() || {}; if (S.aba === 'ocorrencias') renderSoSePronto(); }, {onError: function() { S.ocorrencias = {}; }, attempts: 0});
    dbOnValue(db.ref('usuarios'), function(s) { S.usuarios = s.val() || {}; if (S.aba === 'config') renderSoSePronto(); }, {onError: function() { S.usuarios = {}; }, attempts: 0});
  }
  window.addEventListener('kuryos-auth-pronto', function() { if (prontos()) render(); });
  firebase.auth().onAuthStateChanged(function(u) { if (u && !S.uid) { iniciar(); } });
  if (firebase.auth().currentUser) iniciar();
})();
