'use strict';
/* Feedback e Clima -- tela do RH (06/10/2026): dashboard, pendências, respostas, recados e configuração.
   Cálculo em shared/feedback-clima.js (puro, testado). Só RH Central e administrador (regras do banco idem).
   Regra transversal de leitura: toda média aparece com o N ao lado. */
(function() {
  var db = firebase.database();
  var F = FeedbackClima;
  var S = {aba: 'painel', cfg: {}, dir: {}, respostas: {}, clima: {}, part: {}, lidos: {}, colaboradores: {}, cargos: {}, temps: {}, presenca: {}, porUid: {}, periodoSel: null, carregou: {}, ouvidos: {}, sync: null, filtroAvaliado: '', editor: null};
  var ABAS = [['painel', 'Painel'], ['pendencias', 'Pendências'], ['respostas', 'Respostas'], ['recados', 'Recados ao RH'], ['config', 'Configuração']];

  function el(id) { return document.getElementById(id); }
  function e(v) { return escapeHtml(String(v == null ? '' : v)); }
  function hojeYmd() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function toast(msg, erro) { var t = document.createElement('div'); t.className = 'toast' + (erro ? ' erro' : ''); t.textContent = msg; document.body.appendChild(t); setTimeout(function() { t.remove(); }, 6000); }
  function podeUsar() { var u = window.currentUser; return !!(u && (u.role === 'rh' || u.role === 'admin')); }
  function ciclo() { return F.ciclo(S.cfg.ciclo); }
  function lista(chave, padrao) { var v = S.cfg[chave]; if (!v) return padrao; var a = Array.isArray(v) ? v : Object.keys(v).sort(function(x, y) { return Number(x) - Number(y); }).map(function(k) { return v[k]; }); return a.length ? a : padrao; }
  function modelos() { return {par: lista('modeloPar', F.MODELO_PAR), lider: lista('modeloLider', F.MODELO_LIDER), clima: lista('modeloClima', F.MODELO_CLIMA)}; }
  function periodoAtual() { return F.periodoDe(hojeYmd(), S.cfg.ciclo); }
  function nm(v, c) { return v == null ? '—' : Number(v).toFixed(c == null ? 1 : c).replace('.', ','); }
  function pct(v) { return v == null ? '—' : Math.round(v * 100) + '%'; }
  function seta(v) { return v == null ? '' : v > 0.05 ? ' <span class="up">▲ ' + nm(Math.abs(v), 2) + '</span>' : v < -0.05 ? ' <span class="down">▼ ' + nm(Math.abs(v), 2) + '</span>' : ' <span class="mut">= estável</span>'; }
  function nomeDe(id) { return (S.dir[id] || {}).nome || '(removido)'; }
  function barra(v, max) { return '<span class="bar"><i style="width:' + Math.max(0, Math.min(100, (v || 0) / (max || 5) * 100)) + '%"></i></span>'; }
  function nTxt(n) { return '<span class="mut">N=' + n + '</span>'; }

  /* ── carga de um período (respostas, clima e participação) ── */
  function garantirPeriodo(id) {
    if (S.ouvidos[id]) return; S.ouvidos[id] = true;
    var pronto = function(k) { return function(s) { S[k][id] = s.val() || {}; S.carregou[k + id] = true; renderSePronto(); }; };
    var falha = function(k) { return {onError: function() { S[k][id] = {}; S.carregou[k + id] = true; renderSePronto(); }, attempts: 1}; };
    dbOnValue(db.ref('feedback_respostas/' + id), pronto('respostas'), falha('respostas'));
    dbOnValue(db.ref('clima_respostas/' + id), pronto('clima'), falha('clima'));
    dbOnValue(db.ref('feedback_participacao/' + id), pronto('part'), falha('part'));
    dbOnValue(db.ref('clima_recados_lidos/' + id), pronto('lidos'), falha('lidos'));
  }
  function janela(id) {
    var ids = [id], p = F.periodoDe(F.inicioDoPeriodo(id), S.cfg.ciclo);
    for (var i = 0; i < 8; i++) { p = F.periodoAnterior(p, S.cfg.ciclo); ids.push(p.id); }
    return ids;
  }
  function periodosParaSeletor() {
    var ids = [], p = periodoAtual();
    for (var i = 0; i < 16; i++) { ids.push(p); p = F.periodoAnterior(p, S.cfg.ciclo); }
    return ids;
  }
  function selecionado() { return S.periodoSel || periodoAtual().id; }
  function periodosProntos(id) { return janela(id).every(function(p) { return S.carregou['respostas' + p] && S.carregou['clima' + p] && S.carregou['part' + p] && S.carregou['lidos' + p]; }); }

  function renderSePronto() { if (S.carregou.cfg && S.carregou.dir && S.carregou.col && S.carregou.cargos && S.carregou.temps && S.carregou.pres && window.currentUser) render(); }
  function render(forcar) {
    if (!podeUsar()) { el('abas').innerHTML = ''; el('conteudo').innerHTML = '<div class="card"><h2>Acesso restrito ao RH</h2><p class="dica">Os resultados do Feedback e Clima são vistos só pelo RH Central e pelo administrador.</p></div>'; return; }
    if (S.aba === 'config' && S.configDesenhada && !forcar) return;      // não apaga o que o RH está digitando quando chega dado novo
    autoSincronizar();
    el('abas').innerHTML = ABAS.map(function(a) { return '<button type="button" class="aba' + (S.aba === a[0] ? ' on' : '') + '" data-aba="' + a[0] + '" role="tab">' + a[1] + '</button>'; }).join('');
    el('abas').querySelectorAll('[data-aba]').forEach(function(b) { b.onclick = function() { S.aba = b.getAttribute('data-aba'); S.configDesenhada = false; render(true); }; });
    var sel = selecionado();
    janela(sel).forEach(garantirPeriodo);
    if (S.aba !== 'config' && !periodosProntos(sel)) { el('conteudo').innerHTML = '<div class="card"><b>Carregando…</b></div>'; return; }
    ({painel: rPainel, pendencias: rPendencias, respostas: rRespostas, recados: rRecados, config: rConfig}[S.aba] || rPainel)();
  }
  function seletorPeriodo() {
    var sel = selecionado();
    return '<div class="barra"><label class="t" style="margin:0">Período <select id="selPeriodo" style="width:auto;display:inline-block">' + periodosParaSeletor().map(function(p) {
      return '<option value="' + e(p.id) + '"' + (p.id === sel ? ' selected' : '') + '>' + e(p.id) + ' — ' + e(F.rotuloPeriodo(p)) + '</option>';
    }).join('') + '</select></label></div>';
  }
  function ligarSeletor() { var s = el('selPeriodo'); if (s) s.onchange = function() { S.periodoSel = s.value; render(true); }; }
  function dados() {
    var rh = {}; Object.keys(S.colaboradores).forEach(function(id) { var c = S.colaboradores[id]; rh[id] = {sexo: c.sexo, tipoContrato: c.tipoContrato, dataAdmissao: c.dataAdmissao}; });
    var sel = selecionado();
    return F.dashboard({periodo: sel, hoje: hojeYmd(), ciclo: S.cfg.ciclo, modelos: modelos(), diretorio: diretorioComLogin(), respostas: S.respostas, clima: S.clima, participacao: S.part, rh: rh, recadosLidos: S.lidos});
  }
  /* o diretório que os colaboradores leem não traz o login; para cobrar "sem login" o RH usa o cadastro completo */
  function diretorioComLogin() {
    var d = {}; Object.keys(S.dir).forEach(function(id) { d[id] = Object.assign({}, S.dir[id]); });
    Object.keys(S.colaboradores).forEach(function(id) { if (d[id] && S.colaboradores[id].uidLogin) d[id].uidLogin = S.colaboradores[id].uidLogin; });
    return d;
  }

  /* ── Painel ── */
  function card(titulo, corpo, dica) { return '<div class="card"><h2>' + titulo + '</h2>' + (dica ? '<p class="dica">' + dica + '</p>' : '') + corpo + '</div>'; }
  function tabela(cab, linhas) { return '<div class="tw"><table><thead><tr>' + cab.map(function(c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' + (linhas.length ? linhas.join('') : '<tr><td colspan="' + cab.length + '" class="dica">Sem dados neste período.</td></tr>') + '</tbody></table></div>'; }
  function stat(rot, val, sub) { return '<div><span class="mut">' + rot + '</span><b>' + val + '</b>' + (sub ? '<span class="mut">' + sub + '</span>' : '') + '</div>'; }
  function rPainel() {
    var d = dados(), c = ciclo(), m = modelos(), h = '';
    h += '<div class="card"><h2>Feedback e Clima</h2>' + seletorPeriodo() + '<p class="dica">Os resultados não entram na avaliação trimestral nem em promoção. Toda média traz o N: em setor pequeno, uma resposta move tudo. ' + (c.ativo ? '' : '<b>Ciclo pausado.</b>') + '</p></div>';
    h += card('1. O ciclo está rodando', '<div class="resumo">' + stat('Participação', pct(d.participacao.pct), d.participacao.feito + ' de ' + d.participacao.esperado + ' itens') + stat('Pendentes', d.participacao.pendentes.length, 'pessoas com algo em aberto') +
      stat('Respostas no automático', pct(d.respostasAutomatico.pct), d.respostasAutomatico.automaticas + ' de ' + d.respostasAutomatico.n + ' (mesma nota em tudo)') +
      stat('Cobertura confiável', pct(d.coberturaConfiavel.pct), d.coberturaConfiavel.confiaveis + ' de ' + d.coberturaConfiavel.n + ' com ' + c.nMinimo + '+ avaliações') + '</div>' +
      '<h3>Evolução da participação</h3>' + tabela(['Período', 'Participação', ''], d.evolucaoParticipacao.map(function(x) { return '<tr><td>' + e(x.periodo) + '</td><td>' + pct(x.pct) + ' <span class="mut">(' + x.feito + '/' + x.esperado + ')</span></td><td>' + barra(x.pct, 1) + '</td></tr>'; })),
      'Queda sustentada da participação ou muitas respostas no automático indicam fadiga: formulário longo demais ou falta de retorno ao time.');
    h += card('2. Clima', '<div class="resumo">' + stat('Índice do período', nm(d.clima.indice, 2), 'N=' + d.clima.n) + stat('eNPS', d.enps.valor == null ? '—' : d.enps.valor, 'N=' + d.enps.n + ' · notas 4–5 menos notas 1–2') + stat('Condições de trabalho', nm(d.condicoes.media, 2), 'N=' + d.condicoes.n) + stat('Recados ao RH', d.recados.n, d.recados.naoLidos + ' não lidos') + '</div>' +
      '<p class="dica">Variação do índice: ' + (d.clima.variacao == null ? 'sem período anterior com respostas' : seta(d.clima.variacao) + ' contra ' + nm(d.clima.indiceAnterior, 2)) + '</p>' +
      '<h3>Evolução do clima</h3>' + tabela(['Período', 'Índice', 'N', ''], d.evolucaoClima.map(function(x) { return '<tr><td>' + e(x.periodo) + '</td><td>' + nm(x.indice, 2) + '</td><td>' + x.n + '</td><td>' + barra(x.indice, 5) + '</td></tr>'; })) +
      '<h3>Clima por setor</h3>' + tabela(['Setor', 'Índice', 'N', ''], d.climaPorSetor.map(function(x) { return '<tr><td>' + e(x.setor) + '</td><td>' + (x.oculto ? '<span class="mut">não publicado (menos de ' + F.MIN_SETOR_CLIMA + ' respostas)</span>' : nm(x.indice, 2)) + '</td><td>' + x.n + '</td><td>' + (x.oculto ? '' : barra(x.indice, 5)) + '</td></tr>'; })) +
      '<h3>Queda brusca (contra a média dos 4 períodos anteriores)</h3>' + tabela(['Quem', 'Agora', 'Média anterior', 'Queda', 'N'], d.quedaBrusca.porSetor.map(function(x) { return '<tr><td>Setor ' + e(x.chave) + '</td><td>' + nm(x.atual, 2) + '</td><td>' + nm(x.base, 2) + '</td><td><span class="tg bad">−' + nm(x.queda, 2) + '</span></td><td>' + x.n + '</td></tr>'; }).concat(d.quedaBrusca.porPessoa.map(function(x) { return '<tr><td>' + e(x.nome) + '</td><td>' + nm(x.atual, 2) + '</td><td>' + nm(x.base, 2) + '</td><td><span class="tg bad">−' + nm(x.queda, 2) + '</span></td><td>' + x.n + '</td></tr>'; }))),
      'Índice = média das perguntas de escala marcadas como índice (padrão: humor, condições e recomendação). O valor está na inclinação, não no número absoluto.');
    h += card('3. Pessoas e liderança', '<div class="resumo">' + stat('Nota média dos colegas', nm(d.notaGeral.media, 2), 'N=' + d.notaGeral.n) + stat('Variação', d.notaGeral.variacao == null ? '—' : (d.notaGeral.variacao > 0 ? '+' : '') + nm(d.notaGeral.variacao, 2), d.notaGeral.mediaAnterior == null ? 'sem período anterior' : 'anterior ' + nm(d.notaGeral.mediaAnterior, 2)) + stat('Líderes abaixo do limite', d.lideresAbaixoDoLimite.length, 'limite ' + nm(c.limiteLider, 1)) + stat('Pessoas abaixo do limite', d.pessoasAbaixoDoLimite.length, c.nMinimo + '+ avaliações e média < ' + nm(c.limitePessoa, 1)) + '</div>' +
      '<h3>Média por critério (colegas)</h3>' + tabela(['Critério', 'Média', 'N', ''], d.porCriterio.map(function(x) { return '<tr><td>' + e(x.nome) + '</td><td>' + nm(x.media, 2) + '</td><td>' + x.n + '</td><td>' + barra(x.media, 5) + '</td></tr>'; })) +
      '<h3>Média por setor (de quem foi avaliado)</h3>' + tabela(['Setor', 'Média', 'N'], d.notaPorSetor.map(function(x) { return '<tr><td>' + e(x.setor) + '</td><td>' + nm(x.media, 2) + '</td><td>' + x.n + '</td></tr>'; })) +
      '<h3>Nota dos líderes</h3>' + tabela(['Líder', 'Média', 'N'].concat(m.lider.map(function(x) { return e(x.nome); })), d.lideres.map(function(l) {
        return '<tr' + (l.media != null && l.media < c.limiteLider ? ' class="erro"' : '') + '><td><b>' + e(l.nome) + '</b>' + (l.media != null && l.media < c.limiteLider ? ' <span class="tg bad">abaixo do limite</span>' : '') + (l.confiavel ? '' : ' <span class="tg mute" title="menos de ' + c.nMinimo + ' respostas">poucas respostas</span>') + '</td><td>' + nm(l.media, 2) + '</td><td>' + l.n + '</td>' + l.criterios.map(function(x) { return '<td>' + nm(x.media, 1) + '</td>'; }).join('') + '</tr>'; })) +
      '<h3>Dispersão das notas recebidas</h3><p class="dica">Média 3,5 pode esconder metade do time dando 5 e a outra metade dando 2. Desvio alto = opiniões divididas.</p>' + tabela(['Pessoa', 'Média', 'Desvio', 'N'], d.dispersao.slice(0, 10).map(function(x) { return '<tr><td>' + e(x.nome) + (x.tipo === 'temporario' ? ' <span class="tg warn">temporário</span>' : '') + '</td><td>' + nm(x.media, 2) + '</td><td>' + nm(x.desvio, 2) + '</td><td>' + x.n + '</td></tr>'; })) +
      '<h3>Pessoas abaixo do limite</h3>' + tabela(['Pessoa', 'Média', 'N'], d.pessoasAbaixoDoLimite.map(function(x) { return '<tr><td>' + e(x.nome) + '</td><td><span class="tg bad">' + nm(x.media, 2) + '</span></td><td>' + x.n + '</td></tr>'; })) +
      '<h3>Maiores quedas contra o período anterior</h3>' + tabela(['Pessoa', 'Agora', 'Antes', 'Variação'], d.maioresQuedas.map(function(x) { return '<tr><td>' + e(x.nome) + '</td><td>' + nm(x.atual, 2) + '</td><td>' + nm(x.anterior, 2) + '</td><td><span class="tg bad">' + nm(x.variacao, 2) + '</span></td></tr>'; })));
    var cz = d.cruzamentos;
    h += card('4. Cruzamentos', (cz.semAutoria ? '<div class="aviso warn">' + cz.semAutoria + ' resposta(s) de clima sem autoria (política de anonimato): ficam fora dos cruzamentos abaixo, mas contam no índice.</div>' : '') +
      '<div class="resumo">' + stat('Recém-admitidos (menos de 90 dias)', cz.recemAdmitidos.oculto ? 'N=' + cz.recemAdmitidos.n : nm(cz.recemAdmitidos.indice, 2), cz.recemAdmitidos.oculto ? 'poucos para publicar' : 'N=' + cz.recemAdmitidos.n) + '</div>' +
      '<h3>Por tempo de casa</h3>' + grupos(cz.porTempoDeCasa) + '<h3>Por tipo de contrato</h3>' + grupos(cz.porContrato) + '<h3>Por sexo</h3>' + grupos(cz.porSexo) +
      '<h3>Líder bem avaliado com clima baixo</h3>' + tabela(['Setor', 'Clima', 'Líder(es) com média 4 ou mais'], cz.liderBomClimaBaixo.map(function(x) { return '<tr><td>' + e(x.setor) + '</td><td>' + nm(x.indiceClima, 2) + '</td><td>' + x.lideres.map(function(l) { return e(l.nome) + ' (' + nm(l.media, 1) + ')'; }).join(', ') + '</td></tr>'; })),
      'Normalmente indica problema de processo, estrutura ou carga, não de liderança. Reciprocidade suspeita entre pares fica para a fase 2.');
    el('conteudo').innerHTML = h;
    ligarSeletor();
  }
  function grupos(g) { return tabela(['Grupo', 'Clima', 'N'], g.map(function(x) { return '<tr><td>' + e(x.grupo) + '</td><td>' + (x.oculto ? '<span class="mut">não publicado (menos de ' + F.MIN_SETOR_CLIMA + ')</span>' : nm(x.indice, 2)) + '</td><td>' + x.n + '</td></tr>'; })); }

  /* ── Pendências ── */
  function rPendencias() {
    var d = dados(), pend = d.participacao.pendentes, sel = selecionado(), c = ciclo();
    var h = '<div class="card"><h2>Quem não completou o período</h2>' + seletorPeriodo() + '<p class="dica">Pendente é quem deixou qualquer item em aberto: avaliação de colega, do líder ou a pesquisa de clima. A lista é a base da cobrança. O disparo automático por e-mail ainda depende de o provedor ser definido (' + (c.cobrancaAtiva ? 'ligado' : 'desligado') + '): por enquanto copie a lista abaixo ou baixe o CSV.</p>';
    h += '<div class="barra"><button type="button" class="btn sm" id="btnCopiar">Copiar lista</button><button type="button" class="btn sm" id="btnCsvPend">Baixar CSV</button><span class="mut">' + pend.length + ' pessoa(s)</span></div>';
    h += tabela(['Pessoa', 'Setor', 'Líder', 'Falta', 'Obs.'], pend.map(function(p) { return '<tr><td><b>' + e(p.nome) + '</b></td><td>' + e(p.setor || '—') + '</td><td>' + e(p.lider || '—') + '</td><td>' + e(p.faltam.join(' · ')) + '</td><td>' + (p.semLogin ? '<span class="tg warn">sem login vinculado</span> ' : '') + (p.semSetor ? '<span class="tg warn">sem setor</span>' : '') + '</td></tr>'; })) + '</div>';
    el('conteudo').innerHTML = h; ligarSeletor();
    var texto = 'Pendências do Feedback e Clima — ' + sel + '\n' + pend.map(function(p) { return '• ' + p.nome + (p.setor ? ' (' + p.setor + ')' : '') + ': ' + p.faltam.join('; '); }).join('\n');
    el('btnCopiar').onclick = function() { (navigator.clipboard ? navigator.clipboard.writeText(texto) : Promise.reject()).then(function() { toast('Lista copiada.'); }).catch(function() { toast('Não foi possível copiar; use o CSV.', true); }); };
    el('btnCsvPend').onclick = function() {
      var csv = ['Pessoa;Setor;Lider;Falta;Sem login;Sem setor'].concat(pend.map(function(p) { return [p.nome, p.setor, p.lider, p.faltam.join(' / '), p.semLogin ? 'sim' : '', p.semSetor ? 'sim' : ''].join(';'); })).join('\r\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], {type: 'text/csv;charset=utf-8'})); a.download = 'pendencias-feedback-' + sel + '.csv'; document.body.appendChild(a); a.click(); a.remove();
    };
  }

  /* ── Respostas individuais ── */
  function rRespostas() {
    var sel = selecionado(), c = ciclo(), m = modelos(), todas = S.respostas[sel] || {}, f = S.filtroAvaliado;
    var linhas = Object.keys(todas).map(function(k) { return Object.assign({_k: k}, todas[k]); }).filter(function(r) { return !f || r.avaliadoId === f; })
      .sort(function(a, b) { return String(b.criadoEm).localeCompare(String(a.criadoEm)); });
    var avaliados = Object.keys(todas).map(function(k) { return todas[k].avaliadoId; }).filter(function(x, i, a) { return a.indexOf(x) === i; }).sort(function(a, b) { return F.norm(nomeDe(a)).localeCompare(F.norm(nomeDe(b))); });
    var h = '<div class="card"><h2>Respostas individuais</h2>' + seletorPeriodo() + '<p class="dica">' + (c.rhVeAutoria ? 'A política atual mostra a <b>autoria</b> das avaliações ao RH.' : 'A política atual <b>não grava a autoria</b> das avaliações.') + ' Respostas enviadas não podem ser editadas nem apagadas.</p>' +
      '<div class="barra"><label class="t" style="margin:0">Avaliado <select id="fAv" style="width:auto;display:inline-block"><option value="">Todos</option>' + avaliados.map(function(id) { return '<option value="' + e(id) + '"' + (id === f ? ' selected' : '') + '>' + e(nomeDe(id)) + '</option>'; }).join('') + '</select></label><span class="mut">' + linhas.length + ' resposta(s)</span></div>';
    h += tabela(['Quando', 'Tipo', 'Avaliado', 'Avaliador', 'Notas', 'Média', 'Comentário'], linhas.map(function(r) {
      var modelo = r.tipo === 'lider' ? m.lider : m.par;
      var notas = modelo.map(function(x) { return e(x.nome) + ' ' + (r.notas && r.notas[x.id] != null ? r.notas[x.id] : '—'); }).join(' · ');
      return '<tr><td>' + e(String(r.criadoEm || '').slice(0, 10).split('-').reverse().join('/')) + (r.atraso ? ' <span class="tg mute">fora do prazo</span>' : '') + '</td><td>' + (r.tipo === 'lider' ? 'Líder' : 'Colega') + '</td><td>' + e(nomeDe(r.avaliadoId)) + (r.avaliadoTipo === 'temporario' ? ' <span class="tg warn">temp.</span>' : '') + '</td><td>' + (r.avaliadorId ? e(nomeDe(r.avaliadorId)) : '<span class="mut">anônimo</span>') + '</td><td class="dica">' + notas + '</td><td>' + nm(F.mediaNotas(r), 1) + '</td><td>' + e(r.comentario || '') + '</td></tr>';
    })) + '</div>';
    el('conteudo').innerHTML = h; ligarSeletor();
    el('fAv').onchange = function() { S.filtroAvaliado = el('fAv').value; render(); };
  }

  /* ── Recados ── */
  function rRecados() {
    var sel = selecionado(), c = ciclo(), cl = S.clima[sel] || {}, lidos = S.lidos[sel] || {};
    var lista2 = Object.keys(cl).filter(function(k) { return cl[k] && String(cl[k].recadoRh || '').trim(); }).map(function(k) { return Object.assign({_k: k}, cl[k]); }).sort(function(a, b) { return (lidos[a._k] ? 1 : 0) - (lidos[b._k] ? 1 : 0) || String(b.criadoEm).localeCompare(String(a.criadoEm)); });
    var h = '<div class="card"><h2>Recados ao RH</h2>' + seletorPeriodo() + '<p class="dica">' + (c.rhVeAutoriaClima ? 'A política atual mostra a autoria dos recados.' : 'A política atual grava os recados sem o nome de quem escreveu.') + ' É daqui que sai a informação que nenhum número mostra.</p>';
    if (!lista2.length) h += '<p class="dica">Nenhum recado neste período.</p>';
    lista2.forEach(function(r) {
      h += '<div class="recado' + (lidos[r._k] ? ' lido' : '') + '"><div><b>' + (r.colaboradorId ? e(nomeDe(r.colaboradorId)) : 'Anônimo') + '</b> <span class="mut">' + e(r.setor || '') + ' · ' + e(String(r.criadoEm || '').slice(0, 10).split('-').reverse().join('/')) + '</span> ' + (lidos[r._k] ? '<span class="tg ok">lido</span>' : '<span class="tg warn">novo</span>') + '</div><p>' + e(r.recadoRh) + '</p>' + (lidos[r._k] ? '' : '<button type="button" class="btn sm" data-lido="' + e(r._k) + '">Marcar como lido</button>') + '</div>';
    });
    el('conteudo').innerHTML = h + '</div>'; ligarSeletor();
    el('conteudo').querySelectorAll('[data-lido]').forEach(function(b) { b.onclick = function() { db.ref('clima_recados_lidos/' + sel + '/' + b.getAttribute('data-lido')).set(true).catch(function(er) { toast(er.message, true); }); }; });
  }

  /* ── Configuração ── */
  function editorModelo(tipo, rotulo, itens) {
    var h = '<div class="card"><h2>' + rotulo + '</h2><p class="dica">' + (tipo === 'clima' ? 'Cada pergunta é de escala 1–5 ou texto livre. Marque "índice" para entrar na média do clima, "eNPS" na pergunta de recomendação e "condições" na de materiais/condições. ' : 'Critérios curtos e observáveis. ') + 'Máximo de ' + F.MAX_ITENS + ' itens. <b>Evite trocar com o ciclo rodando</b>: mudar o formulário no meio inviabiliza comparar a evolução.</p><div id="ed-' + tipo + '">';
    itens.forEach(function(x, i) { h += linhaEditor(tipo, x, i); });
    return h + '</div><div class="barra"><button type="button" class="btn sm" data-add="' + tipo + '">+ Adicionar item</button><button type="button" class="btn pri sm" data-salvar-modelo="' + tipo + '">Salvar formulário</button></div><div class="aviso bad" id="er-' + tipo + '" style="display:none"></div></div>';
  }
  function linhaEditor(tipo, x, i) {
    var h = '<div class="ed" data-i="' + i + '" data-id="' + e(x.id || '') + '">';
    if (tipo === 'clima') {
      h += '<input type="text" class="ed-texto" value="' + e(x.texto || '') + '" placeholder="Pergunta"><select class="ed-tipo"><option value="escala"' + (x.tipo !== 'texto' ? ' selected' : '') + '>Escala 1–5</option><option value="texto"' + (x.tipo === 'texto' ? ' selected' : '') + '>Texto livre</option></select>' +
        '<label class="chk"><input type="checkbox" class="ed-indice"' + (x.indice ? ' checked' : '') + '> índice</label><label class="chk"><input type="checkbox" class="ed-enps"' + (x.enps ? ' checked' : '') + '> eNPS</label><label class="chk"><input type="checkbox" class="ed-cond"' + (x.condicoes ? ' checked' : '') + '> condições</label>';
    } else h += '<input type="text" class="ed-nome" value="' + e(x.nome || '') + '" placeholder="Critério"><input type="text" class="ed-def" value="' + e(x.def || '') + '" placeholder="O que observar (texto mostrado ao respondente)">';
    return h + '<button type="button" class="btn sm" data-up="' + tipo + '" title="Subir">↑</button><button type="button" class="btn sm" data-down="' + tipo + '" title="Descer">↓</button><button type="button" class="btn sm perigo" data-rm="' + tipo + '">Remover</button></div>';
  }
  function lerEditor(tipo) {
    var out = [], usados = {};
    el('ed-' + tipo).querySelectorAll('.ed').forEach(function(l) {
      var x;
      if (tipo === 'clima') {
        var t = l.querySelector('.ed-texto').value.trim();
        x = {id: l.getAttribute('data-id') || F.idDe(t), texto: t, tipo: l.querySelector('.ed-tipo').value};
        if (l.querySelector('.ed-indice').checked && x.tipo === 'escala') x.indice = true;
        if (l.querySelector('.ed-enps').checked && x.tipo === 'escala') x.enps = true;
        if (l.querySelector('.ed-cond').checked && x.tipo === 'escala') x.condicoes = true;
      } else { var n = l.querySelector('.ed-nome').value.trim(); x = {id: l.getAttribute('data-id') || F.idDe(n), nome: n, def: l.querySelector('.ed-def').value.trim()}; }
      if (usados[x.id]) x.id = x.id + '-' + (Object.keys(usados).length + 1);
      usados[x.id] = true; out.push(x);
    });
    return out;
  }
  function rConfig() {
    var c = ciclo(), m = modelos(), cl = S.cfg.ciclo || {};
    var colabs = Object.keys(S.colaboradores).filter(function(id) { return S.colaboradores[id].status !== 'Desligado'; });
    var semLogin = colabs.filter(function(id) { return !S.colaboradores[id].uidLogin; }).length;
    var semSetor = colabs.filter(function(id) { return !F.setorDe(S.colaboradores[id], S.cargos); }).length;
    var chk = function(id, rot, v, dica) { return '<div><label class="chk"><input type="checkbox" id="' + id + '"' + (v ? ' checked' : '') + '> <b>' + rot + '</b></label>' + (dica ? '<div class="dica">' + dica + '</div>' : '') + '</div>'; };
    var campo = function(id, rot, v, dica) { return '<div><label class="t">' + rot + '</label><input type="text" inputmode="decimal" id="' + id + '" value="' + e(String(v).replace('.', ',')) + '">' + (dica ? '<div class="dica">' + dica + '</div>' : '') + '</div>'; };
    var h = '<div class="card"><h2>Ciclo e política</h2><div class="grid2">' + chk('cAtivo', 'Ciclo ativo', c.ativo, 'Desligar pausa: ninguém consegue enviar e a tela avisa.') +
      '<div><label class="t">Periodicidade base</label><select id="cPeriod"><option value="semanal"' + (c.periodicidade === 'semanal' ? ' selected' : '') + '>Semanal</option><option value="quinzenal"' + (c.periodicidade === 'quinzenal' ? ' selected' : '') + '>Quinzenal</option></select></div>' +
      '<div><label class="t">Quinzenal a partir de</label><input type="date" id="cViradaData" value="' + e(c.quinzenalAPartirDe || '') + '"><div class="dica">Vire sempre numa <b>segunda-feira</b> (a de 02/11/2026 foi escolhida de propósito: virar no meio da semana parte o período e a pessoa seria avaliada duas vezes). Apague para nunca virar.</div></div>' +
      campo('cNMin', 'Mínimo de respostas (confiabilidade)', c.nMinimo, 'Só sinaliza no painel; não esconde nada do RH.') + campo('cLimLider', 'Líder abaixo de (média)', c.limiteLider) + campo('cLimPessoa', 'Pessoa abaixo de (média)', c.limitePessoa) + campo('cQueda', 'Queda brusca a partir de (pontos)', c.quedaBrusca) +
      chk('cAutoria', 'RH vê a autoria das avaliações', c.rhVeAutoria, 'Desmarcar grava as próximas avaliações sem identificar o autor.') +
      chk('cAutoriaClima', 'RH vê a autoria da pesquisa de clima', c.rhVeAutoriaClima, 'Risco à qualidade do dado: com o nome junto, perguntas sobre carga, segurança e intenção de sair perdem valor. Mudar vale só para as próximas respostas.') + '</div>' +
      '<div style="margin-top:10px"><button type="button" class="btn pri" id="cSalvar">Salvar ciclo</button></div><div class="aviso bad" id="erCiclo" style="display:none"></div></div>';
    h += editorModelo('par', 'Formulário: avaliar colega', m.par) + editorModelo('lider', 'Formulário: avaliar líder direto', m.lider) + editorModelo('clima', 'Formulário: pesquisa de clima', m.clima);
    var st = S.sync;
    h += '<div class="card"><h2>Quem participa (diretório)</h2><p class="dica">Pares = colegas do mesmo <b>setor</b>; o líder vem do campo "Gestor direto". Quem avalia precisa ter o <b>login vinculado</b> ao cadastro (RH › Colaboradores). Temporários são avaliados pelos colegas do mesmo setor, mas não respondem. O diretório é atualizado sozinho ao abrir esta tela e a cada salvamento de colaborador ou temporário.</p><div class="resumo">' +
      stat('Colaboradores ativos', colabs.length) + stat('Sem login vinculado', semLogin, 'não conseguem responder') + stat('Sem setor', semSetor, 'só avaliam o líder') + stat('No diretório', Object.keys(S.dir).length, 'inclui temporários') + '</div>' +
      '<div class="barra"><button type="button" class="btn" id="cSync">Sincronizar diretório agora</button>' + (st ? '<span class="mut">' + e(st) + '</span>' : '') + '</div></div>';
    el('conteudo').innerHTML = h;
    el('cSalvar').onclick = function() {
      var o = {ativo: el('cAtivo').checked, periodicidade: el('cPeriod').value, quinzenalAPartirDe: el('cViradaData').value || '', nMinimo: Number(String(el('cNMin').value).replace(',', '.')), limiteLider: Number(String(el('cLimLider').value).replace(',', '.')),
        limitePessoa: Number(String(el('cLimPessoa').value).replace(',', '.')), quedaBrusca: Number(String(el('cQueda').value).replace(',', '.')), rhVeAutoria: el('cAutoria').checked, rhVeAutoriaClima: el('cAutoriaClima').checked, cobrancaAtiva: !!cl.cobrancaAtiva};
      var er = [];
      if (o.quinzenalAPartirDe && !F.dataValida(o.quinzenalAPartirDe)) er.push('Data de virada inválida.');
      else if (o.quinzenalAPartirDe && new Date(o.quinzenalAPartirDe + 'T00:00:00Z').getUTCDay() !== 1) er.push('A virada para quinzenal precisa cair numa segunda-feira.');
      ['nMinimo', 'limiteLider', 'limitePessoa', 'quedaBrusca'].forEach(function(k) { if (!(o[k] > 0)) er.push('Valor inválido em "' + k + '".'); });
      var box = el('erCiclo'); box.style.display = er.length ? '' : 'none'; box.innerHTML = er.map(e).join('<br>');
      if (er.length) return;
      db.ref('feedback_config/ciclo').set(o).then(function() { toast('Ciclo salvo.'); }).catch(function(err) { toast(err.message, true); });
    };
    ['par', 'lider', 'clima'].forEach(function(tipo) {
      var cont = el('ed-' + tipo);
      var redesenhar = function(itens) { S.editor = itens; var wrap = cont; wrap.innerHTML = itens.map(function(x, i) { return linhaEditor(tipo, x, i); }).join(''); ligarLinhas(tipo); };
      var ligarLinhas = function() {
        cont.querySelectorAll('[data-rm]').forEach(function(b) { b.onclick = function() { var itens = lerEditor(tipo), i = Number(b.parentNode.getAttribute('data-i')); itens.splice(i, 1); redesenhar(itens); }; });
        cont.querySelectorAll('[data-up]').forEach(function(b) { b.onclick = function() { var itens = lerEditor(tipo), i = Number(b.parentNode.getAttribute('data-i')); if (i > 0) { var t = itens[i]; itens[i] = itens[i - 1]; itens[i - 1] = t; redesenhar(itens); } }; });
        cont.querySelectorAll('[data-down]').forEach(function(b) { b.onclick = function() { var itens = lerEditor(tipo), i = Number(b.parentNode.getAttribute('data-i')); if (i < itens.length - 1) { var t = itens[i]; itens[i] = itens[i + 1]; itens[i + 1] = t; redesenhar(itens); } }; });
      };
      ligarLinhas();
      document.querySelector('[data-add="' + tipo + '"]').onclick = function() { var itens = lerEditor(tipo); itens.push(tipo === 'clima' ? {id: '', texto: '', tipo: 'escala'} : {id: '', nome: '', def: ''}); redesenhar(itens); };
      document.querySelector('[data-salvar-modelo="' + tipo + '"]').onclick = function() {
        var itens = lerEditor(tipo), er = F.validarModelo(tipo, itens), box = el('er-' + tipo);
        box.style.display = er.length ? '' : 'none'; box.innerHTML = er.map(e).join('<br>');
        if (er.length) return;
        db.ref('feedback_config/' + (tipo === 'par' ? 'modeloPar' : tipo === 'lider' ? 'modeloLider' : 'modeloClima')).set(itens).then(function() { toast('Formulário salvo.'); }).catch(function(err) { toast(err.message, true); });
      };
    });
    el('cSync').onclick = function() { sincronizar(true); };
    S.configDesenhada = true;
  }

  /* ── diretório ── */
  var sincronizando = false, jaSincronizou = false;
  function autoSincronizar() { if (!jaSincronizou && S.carregou.dir && S.carregou.col && S.carregou.cargos && S.carregou.temps && S.carregou.pres && S.carregou.porUid) { jaSincronizou = true; sincronizar(false); } }
  function sincronizar(avisar) {
    if (sincronizando) return; sincronizando = true;
    var r = F.montarDiretorio({colaboradores: S.colaboradores, cargos: S.cargos, temporarios: S.temps, presenca: S.presenca, dirAtual: S.dir, porUidAtual: S.porUid}), n = Object.keys(r.atualizacoes).length;
    var fim = function(msg, erro) { sincronizando = false; S.sync = msg; if (avisar || erro) toast(msg, erro); if (S.aba === 'config') render(true); };
    if (!n) { fim('Diretório já está em dia (' + r.total + ' pessoas, ' + r.comLogin + ' com login).'); return; }
    db.ref().update(r.atualizacoes).then(function() { fim('Diretório atualizado: ' + n + ' alteração(ões); ' + r.total + ' pessoas, ' + r.comLogin + ' com login vinculado.'); }).catch(function(err) { fim('Não foi possível atualizar o diretório: ' + err.message, true); });
  }

  /* ── Carga ── */
  var iniciou = false;
  function iniciar() {
    if (iniciou) return; iniciou = true;
    var ok = function(k, alvo) { return {onError: function() { S.carregou[k] = true; renderSePronto(); }, attempts: 1}; };
    dbOnValue(db.ref('feedback_config'), function(s) { S.cfg = s.val() || {}; S.carregou.cfg = true; renderSePronto(); }, ok('cfg'));
    dbOnValue(db.ref('feedback_diretorio'), function(s) { S.dir = s.val() || {}; S.carregou.dir = true; renderSePronto(); }, ok('dir'));
    dbOnValue(db.ref('feedback_diretorio_por_uid'), function(s) { S.porUid = s.val() || {}; S.carregou.porUid = true; renderSePronto(); }, ok('porUid'));
    dbOnValue(db.ref('rh_colaboradores'), function(s) { S.colaboradores = s.val() || {}; S.carregou.col = true; renderSePronto(); }, ok('col'));
    dbOnValue(db.ref('rh_cargos'), function(s) { S.cargos = s.val() || {}; S.carregou.cargos = true; renderSePronto(); }, ok('cargos'));
    dbOnValue(db.ref('rh_temporarios'), function(s) { S.temps = s.val() || {}; S.carregou.temps = true; renderSePronto(); }, ok('temps'));
    dbOnValue(db.ref('rh_temporarios_presenca'), function(s) { S.presenca = s.val() || {}; S.carregou.pres = true; renderSePronto(); }, ok('pres'));
  }
  window.addEventListener('kuryos-auth-pronto', function() { renderSePronto(); });
  firebase.auth().onAuthStateChanged(function(u) { if (u) iniciar(); });
  if (firebase.auth().currentUser) iniciar();
})();
