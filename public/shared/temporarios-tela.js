'use strict';
/* Temporários -- tela (06/10/2026). Regras de pagamento em shared/temporarios.js (puro, testado em
   run_temporarios_test.js e conferido contra a planilha do RH). Aqui: grade semanal de convocação,
   fechamento, pagamentos, atrasos, cadastro, histórico e parâmetros. Só RH Central e administrador
   (as regras do banco também barram: rh_temporarios* são leitura/escrita rh|admin). */
(function() {
  var db = firebase.database();
  var T = Temporarios;
  var S = {aba: 'semana', semana: T.segundaDe(hojeYmd()), temps: {}, presenca: {}, atrasos: {}, pagamentos: {}, semanasCfg: {}, cfg: {}, busca: '',
           pagSoSemana: true, ordHist: 'nome', carregou: {}, prefill: null, editando: null, erro: ''};
  var ABAS = [['semana', 'Convocação da semana'], ['fechamento', 'Fechamento'], ['pagamentos', 'Pagamentos'], ['atrasos', 'Atrasos'], ['cadastro', 'Cadastro'], ['historico', 'Histórico'], ['parametros', 'Parâmetros']];
  var CICLO = ['', 'OK', 'NC', 'F', 'FA'];
  var DIAS_ROTULO = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];

  function el(id) { return document.getElementById(id); }
  function e(v) { return escapeHtml(String(v == null ? '' : v)); }
  function hojeYmd() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function toast(msg, erro) { var t = document.createElement('div'); t.className = 'toast' + (erro ? ' erro' : ''); t.textContent = msg; document.body.appendChild(t); setTimeout(function() { t.remove(); }, 6000); }
  function quem() { var u = window.currentUser || {}; return u.nome || u.email || 'RH'; }
  function podeUsar() { var u = window.currentUser; return !!(u && (u.role === 'rh' || u.role === 'admin')); }
  function ctx() { return {presenca: S.presenca, atrasos: S.atrasos, pagamentos: S.pagamentos, config: S.cfg, semanas: S.semanasCfg}; }
  function fer() { return T.feriados(S.cfg); }
  function nomeDe(id) { return (S.temps[id] || {}).nome || '(removido)'; }
  function ordenadosPorNome(filtro) {
    return Object.keys(S.temps).filter(function(id) { return !filtro || filtro(id, S.temps[id]); })
      .sort(function(a, b) { return T.norm(nomeDe(a)).localeCompare(T.norm(nomeDe(b))); });
  }
  function opcoesTemps(sel, soAtivos) {
    return '<option value="">Escolha…</option>' + ordenadosPorNome(function(id, t) { return !soAtivos || t.status === 'Ativo' || id === sel; }).map(function(id) {
      return '<option value="' + e(id) + '"' + (id === sel ? ' selected' : '') + '>' + e(nomeDe(id)) + (S.temps[id].status === 'Ativo' ? '' : ' (inativo)') + '</option>';
    }).join('');
  }
  function semanaTxt(seg) { return T.dataBR(seg) + ' a ' + T.dataBR(T.somaDias(seg, 4)); }
  function num(v) { var n = Number(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; }
  function nBR(v) { return String(v).replace('.', ','); }

  function render() {
    if (!podeUsar()) {
      el('conteudo').innerHTML = '<div class="card"><h2>Acesso restrito ao RH</h2><p class="dica">Esta área tem dados pessoais e de pagamento dos temporários. Só o RH Central e o administrador abrem.</p></div>';
      el('abas').innerHTML = ''; return;
    }
    el('abas').innerHTML = ABAS.map(function(a) { return '<button type="button" class="aba' + (S.aba === a[0] ? ' on' : '') + '" data-aba="' + a[0] + '" role="tab">' + a[1] + '</button>'; }).join('');
    el('abas').querySelectorAll('[data-aba]').forEach(function(b) { b.onclick = function() { S.aba = b.getAttribute('data-aba'); render(); }; });
    ({semana: rSemana, fechamento: rFechamento, pagamentos: rPagamentos, atrasos: rAtrasos, cadastro: rCadastro, historico: rHistorico, parametros: rParametros}[S.aba] || rSemana)();
  }
  function renderSePronto() { if (S.carregou.temps && S.carregou.pres && S.carregou.atr && S.carregou.pag && S.carregou.cfg && S.carregou.sem && window.currentUser) render(); }

  /* seletor de semana, comum às abas que olham uma semana */
  function seletorSemana() {
    return '<div class="barra"><button type="button" class="btn sm" data-sem="-7">◀ Semana anterior</button>' +
      '<label class="t" style="margin:0">Semana de <input type="date" id="semData" value="' + e(S.semana) + '" style="width:auto;display:inline-block"></label>' +
      '<button type="button" class="btn sm" data-sem="7">Próxima semana ▶</button><button type="button" class="btn sm" data-sem="hoje">Esta semana</button>' +
      '<span class="tg info">' + e(semanaTxt(S.semana)) + '</span></div>';
  }
  function ligarSeletorSemana() {
    el('conteudo').querySelectorAll('[data-sem]').forEach(function(b) {
      b.onclick = function() { var v = b.getAttribute('data-sem'); S.semana = v === 'hoje' ? T.segundaDe(hojeYmd()) : T.somaDias(S.semana, Number(v)); render(); };
    });
    var di = el('semData'); if (di) di.onchange = function() { if (T.dataValida(di.value)) { S.semana = T.segundaDe(di.value); render(); } };
  }

  /* ── Convocação da semana ── */
  function rSemana() {
    var dias = T.diasDaSemana(S.semana), f = fer(), c = ctx(), q = T.norm(S.busca);
    var ids = ordenadosPorNome(function(id, t) {
      if (q && T.norm(t.nome).indexOf(q) < 0) return false;
      if (t.status === 'Ativo') return true;
      return T.fechamentoSemana(id, S.semana, c).participou;
    });
    var horasSexta = T.parametros(S.cfg).horasSexta, hs = (S.semanasCfg[S.semana] || {}).horasSexta || horasSexta;
    var h = '<div class="card"><h2>Convocação e presença</h2><p class="dica">Clique na célula para marcar o dia: <b>OK</b> trabalhou → <b>NC</b> não convocado → <b>F</b> falta → <b>FA</b> falta abonada → em branco. Um único <b>F</b> na semana faz todos os dias trabalhados valerem a diária reduzida. Feriados já vêm marcados (<b>FER</b>) e não contam.</p>' + seletorSemana();
    h += '<div class="barra"><input type="text" id="busca" placeholder="Buscar temporário…" value="' + e(S.busca) + '" style="max-width:260px">' +
      '<label class="t" style="margin:0">Horas na sexta <select id="horasSexta" style="width:auto;display:inline-block"><option value="8"' + (Number(hs) === 8 ? ' selected' : '') + '>8 h (diária de sexta)</option><option value="9"' + (Number(hs) === 9 ? ' selected' : '') + '>9 h (diária cheia)</option></select></label></div>';
    h += '<div class="tw"><table class="grade"><thead><tr><th>Temporário</th>' + dias.map(function(d, i) {
      return '<th class="dia">' + DIAS_ROTULO[i] + '<br><span class="mut">' + e(T.dataBR(d).slice(0, 5)) + '</span>' + (f[d] ? '<br><span class="tg mute" title="' + e(f[d]) + '">FER</span>' : '') + '</th>';
    }).join('') + '<th>Dias</th><th>Regra</th><th>Fechamento</th></tr></thead><tbody>';
    if (!ids.length) h += '<tr><td colspan="9" class="dica">Nenhum temporário ativo' + (q ? ' com esse nome' : '') + '. Cadastre na aba Cadastro.</td></tr>';
    ids.forEach(function(id) {
      var x = T.fechamentoSemana(id, S.semana, c);
      h += '<tr><td><b>' + e(nomeDe(id)) + '</b>' + (S.temps[id].status === 'Ativo' ? '' : ' <span class="tg mute">inativo</span>') + '</td>' + dias.map(function(d) {
        var s = x.dias[d];
        if (s === 'FER') return '<td class="cel"><span class="cl FER" title="' + e(f[d]) + '">FER</span></td>';
        return '<td class="cel"><button type="button" class="cl ' + (s || 'vazio') + '" data-cel="' + e(id) + '|' + d + '" aria-label="' + e(nomeDe(id) + ' ' + T.dataBR(d)) + '">' + (s || '·') + '</button></td>';
      }).join('') + '<td>' + x.trabalhados + '</td><td>' + (x.regra === 'Reduzida' ? '<span class="tg warn">Reduzida</span>' : '<span class="tg ok">Cheia</span>') + '</td><td>' + (x.erro ? '<span class="tg bad" title="' + e(x.erro) + '">ERRO VT</span>' : T.moeda(x.fechamento)) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td><b>Trabalharam (OK)</b></td>' + dias.map(function(d) {
      var n = 0; Object.keys(S.temps).forEach(function(id) { if (T.statusDoDia(S.presenca, id, d, f) === 'OK') n++; });
      return '<td class="cel">' + (f[d] ? '—' : '<b>' + n + '</b><br><button type="button" class="btn sm" data-todos="' + d + '" title="Marca OK para todos os ativos ainda em branco neste dia">todos OK</button>') + '</td>';
    }).join('') + '<td colspan="3"></td></tr></tfoot></table></div></div>';
    el('conteudo').innerHTML = h;
    ligarSeletorSemana();
    el('busca').oninput = function() { S.busca = el('busca').value; var pos = el('busca').selectionStart; render(); var b = el('busca'); b.focus(); try { b.setSelectionRange(pos, pos); } catch (er) {} };
    el('horasSexta').onchange = function() { db.ref('rh_temporarios_semanas/' + S.semana + '/horasSexta').set(Number(el('horasSexta').value)).catch(function(er) { toast(er.message, true); }); };
    el('conteudo').querySelectorAll('[data-cel]').forEach(function(b) {
      b.onclick = function() {
        var p = b.getAttribute('data-cel').split('|'), atual = (S.presenca[p[1]] || {})[p[0]] || '', prox = CICLO[(CICLO.indexOf(atual) + 1) % CICLO.length];
        db.ref('rh_temporarios_presenca/' + p[1] + '/' + p[0]).set(prox || null).catch(function(er) { toast(er.message, true); });
      };
    });
    el('conteudo').querySelectorAll('[data-todos]').forEach(function(b) {
      b.onclick = function() {
        var d = b.getAttribute('data-todos'), up = {}, n = 0;
        Object.keys(S.temps).forEach(function(id) { if (S.temps[id].status === 'Ativo' && !((S.presenca[d] || {})[id])) { up['rh_temporarios_presenca/' + d + '/' + id] = 'OK'; n++; } });
        if (!n) { toast('Todos os ativos já têm marcação neste dia.'); return; }
        db.ref().update(up).then(function() { toast(n + ' marcados como OK em ' + T.dataBR(d) + '.'); }).catch(function(er) { toast(er.message, true); });
      };
    });
  }

  /* ── Fechamento ── */
  function rFechamento() {
    var folha = T.folhaDaSemana(S.temps, S.semana, ctx()), t = folha.totais;
    var h = '<div class="card"><h2>Fechamento da semana</h2><p class="dica">Fechamento = diárias − atraso − desconto de VT + VT a pagar. Em aberto = fechamento − salário já pago da semana.</p>' + seletorSemana();
    h += '<div class="resumo"><div><span class="mut">Fechamento</span><b>' + T.moeda(t.fechamento) + '</b></div><div><span class="mut">Já pago (salário)</span><b>' + T.moeda(t.pago) + '</b></div><div><span class="mut">Em aberto</span><b>' + T.moeda(t.emAberto) + '</b></div><div><span class="mut">VT pago na semana</span><b>' + T.moeda(t.vtPago) + '</b></div></div>';
    if (t.erros) h += '<div class="aviso bad">' + t.erros + ' temporário(s) com o VT pago fora do múltiplo do valor do VT: a semana deles não fecha até corrigir o pagamento (aba Pagamentos).</div>';
    h += '<div class="barra"><button type="button" class="btn sm" id="btnCsv">Exportar CSV</button><button type="button" class="btn sm" onclick="window.print()">Imprimir</button></div>';
    h += '<div class="tw" id="folhaPrint"><table><thead><tr><th>Temporário</th><th>Dias</th><th>Faltas</th><th>Regra</th><th>Diárias</th><th>Atraso</th><th>Desc. VT</th><th>VT a pagar</th><th>Fechamento</th><th>Pago</th><th>Em aberto</th><th class="noprint"></th></tr></thead><tbody>';
    if (!folha.linhas.length) h += '<tr><td colspan="12" class="dica">Sem movimento nesta semana.</td></tr>';
    folha.linhas.forEach(function(l) {
      h += '<tr' + (l.erro ? ' class="erro"' : '') + '><td><b>' + e(l.nome) + '</b>' + (l.erro ? '<br><span class="tg bad">' + e(l.erro) + '</span>' : '') + '</td><td>' + l.trabalhados + (l.abonadas ? ' <span class="mut">(+' + l.abonadas + ' FA)</span>' : '') + '</td><td>' + l.faltas + '</td><td>' + (l.regra === 'Reduzida' ? '<span class="tg warn">Reduzida</span>' : '<span class="tg ok">Cheia</span>') + '</td>' +
        '<td>' + T.moeda(l.totalDiarias) + '</td><td>' + (l.descAtraso ? '− ' + T.moeda(l.descAtraso) : '—') + '</td><td>' + (l.descVT ? '− ' + T.moeda(l.descVT) : '—') + '</td><td>' + (l.vtAPagar ? '+ ' + T.moeda(l.vtAPagar) : '—') + '</td>' +
        '<td><b>' + T.moeda(l.fechamento) + '</b></td><td>' + T.moeda(l.pago) + '</td><td><b>' + T.moeda(l.emAberto) + '</b></td>' +
        '<td class="noprint"><button type="button" class="btn sm" data-calc="' + e(l.id) + '">Cálculo</button> ' + (l.emAberto > 0 ? '<button type="button" class="btn sm pri" data-pagar="' + e(l.id) + '">Pagar</button>' : '') + '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    el('conteudo').innerHTML = h;
    ligarSeletorSemana();
    el('btnCsv').onclick = function() {
      var blob = new Blob(['﻿' + T.csvFolha(folha, S.semana)], {type: 'text/csv;charset=utf-8'});
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fechamento-temporarios-' + S.semana + '.csv'; document.body.appendChild(a); a.click(); a.remove();
    };
    el('conteudo').querySelectorAll('[data-calc]').forEach(function(b) { b.onclick = function() { abrirCalculo(b.getAttribute('data-calc')); }; });
    el('conteudo').querySelectorAll('[data-pagar]').forEach(function(b) {
      b.onclick = function() { var x = T.fechamentoSemana(b.getAttribute('data-pagar'), S.semana, ctx()); S.prefill = {tempId: x.id, valor: x.emAberto, categoria: 'SALARIO', semana: S.semana}; S.aba = 'pagamentos'; render(); };
    });
  }
  function abrirCalculo(id) {
    var x = T.fechamentoSemana(id, S.semana, ctx()), p = T.parametros(S.cfg), f = fer();
    var linhas = [
      ['Dias trabalhados seg–qui', x.diasSegQui + ' × ' + T.moeda(x.valorDia), T.moeda(x.diasSegQui * x.valorDia)],
      ['Dias trabalhados na sexta (' + x.horasSexta + ' h)', x.diasSexta + ' × ' + T.moeda(x.valorSexta), T.moeda(x.diasSexta * x.valorSexta)],
      ['Regra aplicada', x.regra === 'Reduzida' ? 'houve falta (F) na semana: todos os dias valem ' + T.moeda(p.diariaReduzida) : 'sem falta (F) na semana', ''],
      ['Atraso a partir do limite (' + p.atrasoLimiteHoras + ' h)', x.diasAtrasoLimite + ' dia(s) viram diária reduzida', x.diasAtrasoLimite ? '− ' + T.moeda(x.diasSegQui * x.valorDia + x.diasSexta * x.valorSexta - x.totalDiarias) : '—'],
      ['Total das diárias', '', T.moeda(x.totalDiarias)],
      ['Desconto de atraso', nBR(x.horasAtraso) + ' h lançadas', x.descAtraso ? '− ' + T.moeda(x.descAtraso) : '—'],
      ['VT pago', x.diasVT == null ? 'não é múltiplo' : x.diasVT + ' dia(s)', T.moeda(x.vtPago)],
      ['Desconto de VT (pago e não usado)', x.diasDescVT == null ? '' : x.diasDescVT + ' dia(s)', x.descVT ? '− ' + T.moeda(x.descVT) : '—'],
      ['VT a pagar (dia trabalhado sem VT pago)', '', x.vtAPagar ? '+ ' + T.moeda(x.vtAPagar) : '—'],
      ['Fechamento', '', x.erro ? 'ERRO' : T.moeda(x.fechamento)],
      ['Salário já pago', '', T.moeda(x.pago)],
      ['Em aberto', '', x.erro ? 'ERRO' : T.moeda(x.emAberto)]
    ];
    var dias = T.diasDaSemana(S.semana).map(function(d, i) { return DIAS_ROTULO[i] + ' ' + T.dataBR(d).slice(0, 5) + ': <b>' + (x.dias[d] || '—') + '</b>'; }).join(' · ');
    var m = document.createElement('div'); m.className = 'mf'; m.id = 'mfCalc';
    m.innerHTML = '<div class="md" role="dialog" aria-modal="true"><h2>' + e(nomeDe(id)) + '</h2><div class="dica">Semana ' + e(semanaTxt(S.semana)) + '</div><p class="dica" style="margin-top:8px">' + dias + '</p>' +
      (x.erro ? '<div class="aviso bad">' + e(x.erro) + '</div>' : '') +
      '<table style="margin-top:8px"><tbody>' + linhas.map(function(l) { return '<tr><td>' + e(l[0]) + '</td><td class="mut">' + e(l[1]) + '</td><td style="text-align:right"><b>' + e(l[2]) + '</b></td></tr>'; }).join('') + '</tbody></table>' +
      '<div style="margin-top:12px;text-align:right"><button type="button" class="btn pri" id="fechaCalc">Fechar</button></div></div>';
    document.body.appendChild(m);
    el('fechaCalc').onclick = function() { m.remove(); };
    m.onclick = function(ev) { if (ev.target === m) m.remove(); };
  }

  /* ── Pagamentos ── */
  function rPagamentos() {
    var pf = S.prefill || {}; S.prefill = null;
    var h = '<div class="card"><h2>Registrar pagamento</h2><p class="dica">Categoria <b>SALARIO</b> abate o "em aberto" da semana; <b>VT</b> alimenta os dias de VT (precisa ser múltiplo de ' + T.moeda(T.parametros(S.cfg).valorVT) + '). A <b>semana de referência</b> é a da data do pagamento, a não ser que você escolha outra (ex.: salário pago na segunda seguinte).</p>' +
      '<div class="grid2"><div><label class="t">Temporário</label><select id="pgTemp">' + opcoesTemps(pf.tempId || '', true) + '</select></div>' +
      '<div><label class="t">Data do pagamento</label><input type="date" id="pgData" value="' + e(pf.data || hojeYmd()) + '"></div>' +
      '<div><label class="t">Valor pago (R$)</label><input type="text" inputmode="decimal" id="pgValor" value="' + e(pf.valor != null ? nBR(Number(pf.valor).toFixed(2)) : '') + '" placeholder="0,00"></div>' +
      '<div><label class="t">Categoria</label><select id="pgCat"><option value="SALARIO"' + (pf.categoria !== 'VT' ? ' selected' : '') + '>SALARIO</option><option value="VT"' + (pf.categoria === 'VT' ? ' selected' : '') + '>VT</option></select></div>' +
      '<div><label class="t">Semana de referência (segunda)</label><input type="date" id="pgSemana" value="' + e(pf.semana || '') + '"><div class="dica">Em branco = semana da data do pagamento.</div></div>' +
      '<div><label class="t">Observação</label><input type="text" id="pgObs"></div></div>' +
      '<div style="margin-top:10px"><button type="button" class="btn pri" id="pgSalvar">Registrar pagamento</button></div><div id="pgErros" class="aviso bad" style="display:none"></div></div>';
    var lista = Object.keys(S.pagamentos).map(function(k) { return Object.assign({id: k}, S.pagamentos[k]); }).filter(function(g) { return !S.pagSoSemana || T.semanaDoPagamento(g) === S.semana; })
      .sort(function(a, b) { return String(b.data).localeCompare(String(a.data)) || String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')); });
    h += '<div class="card"><h2>Pagamentos registrados</h2>' + seletorSemana() + '<label class="t"><input type="checkbox" id="pgSo"' + (S.pagSoSemana ? ' checked' : '') + '> mostrar só a semana selecionada</label>';
    h += '<div class="tw"><table><thead><tr><th>Data</th><th>Temporário</th><th>Categoria</th><th>Valor</th><th>Semana</th><th>Obs</th><th></th></tr></thead><tbody>';
    if (!lista.length) h += '<tr><td colspan="7" class="dica">Nenhum pagamento' + (S.pagSoSemana ? ' nesta semana' : '') + '.</td></tr>';
    lista.forEach(function(g) {
      h += '<tr><td>' + e(T.dataBR(g.data)) + '</td><td>' + e(nomeDe(g.tempId)) + '</td><td><span class="tg ' + (g.categoria === 'VT' ? 'info' : 'ok') + '">' + e(g.categoria) + '</span></td><td>' + T.moeda(g.valor) + '</td><td>' + e(T.dataBR(T.semanaDoPagamento(g))) + '</td><td class="mut">' + e(g.obs || '') + '</td><td><button type="button" class="btn sm perigo" data-del="' + e(g.id) + '">Excluir</button></td></tr>';
    });
    h += '</tbody></table></div></div>';
    el('conteudo').innerHTML = h;
    ligarSeletorSemana();
    el('pgSo').onchange = function() { S.pagSoSemana = el('pgSo').checked; render(); };
    el('pgSalvar').onclick = function() {
      var g = {tempId: el('pgTemp').value, data: el('pgData').value, valor: num(el('pgValor').value), categoria: el('pgCat').value};
      if (el('pgSemana').value) g.semana = T.segundaDe(el('pgSemana').value);
      var er = T.validarPagamento(g, S.cfg), box = el('pgErros');
      if (er.length) { box.style.display = ''; box.innerHTML = er.map(e).join('<br>'); return; }
      box.style.display = 'none';
      var reg = {tempId: g.tempId, tempNome: nomeDe(g.tempId), data: g.data, valor: Math.round(g.valor * 100) / 100, categoria: g.categoria, semana: g.semana || T.segundaDe(g.data), registradoPor: quem(), criadoEm: new Date().toISOString()};
      if (el('pgObs').value.trim()) reg.obs = el('pgObs').value.trim();
      db.ref('rh_temporarios_pagamentos').push(reg).then(function() { toast('Pagamento registrado.'); S.semana = T.segundaDe(reg.semana); }).catch(function(err) { toast(err.message, true); });
    };
    el('conteudo').querySelectorAll('[data-del]').forEach(function(b) {
      b.onclick = function() { if (confirm('Excluir este pagamento? O fechamento da semana volta a considerá-lo em aberto.')) db.ref('rh_temporarios_pagamentos/' + b.getAttribute('data-del')).remove().catch(function(er) { toast(er.message, true); }); };
    });
  }

  /* ── Atrasos ── */
  function rAtrasos() {
    var lim = T.parametros(S.cfg).atrasoLimiteHoras;
    var h = '<div class="card"><h2>Lançar atraso</h2><p class="dica">Lance as <b>horas</b> de atraso. Abaixo de ' + nBR(lim) + ' h: desconta horas × valor da hora. A partir de ' + nBR(lim) + ' h: o dia vira diária reduzida e as horas descontam proporcionalmente.</p>' +
      '<div class="grid2"><div><label class="t">Temporário</label><select id="atTemp">' + opcoesTemps('', true) + '</select></div><div><label class="t">Data</label><input type="date" id="atData" value="' + e(hojeYmd()) + '"></div>' +
      '<div><label class="t">Horas de atraso</label><input type="text" inputmode="decimal" id="atHoras" placeholder="ex.: 1,5"></div><div><label class="t">Motivo</label><input type="text" id="atMotivo" placeholder="ex.: chegou 9:30"></div></div>' +
      '<div style="margin-top:10px"><button type="button" class="btn pri" id="atSalvar">Lançar atraso</button></div><div id="atErros" class="aviso bad" style="display:none"></div></div>';
    var lista = Object.keys(S.atrasos).map(function(k) { return Object.assign({id: k}, S.atrasos[k]); }).sort(function(a, b) { return String(b.data).localeCompare(String(a.data)); });
    h += '<div class="card"><h2>Atrasos lançados</h2><div class="tw"><table><thead><tr><th>Data</th><th>Temporário</th><th>Horas</th><th>Efeito</th><th>Motivo</th><th></th></tr></thead><tbody>';
    if (!lista.length) h += '<tr><td colspan="6" class="dica">Nenhum atraso lançado.</td></tr>';
    lista.forEach(function(a) {
      h += '<tr><td>' + e(T.dataBR(a.data)) + '</td><td>' + e(nomeDe(a.tempId)) + '</td><td>' + nBR(a.horas) + ' h</td><td>' + (Number(a.horas) >= lim ? '<span class="tg warn">dia vira reduzida</span>' : '<span class="tg mute">só as horas</span>') + '</td><td class="mut">' + e(a.motivo || '') + '</td><td><button type="button" class="btn sm perigo" data-del="' + e(a.id) + '">Excluir</button></td></tr>';
    });
    h += '</tbody></table></div></div>';
    el('conteudo').innerHTML = h;
    el('atSalvar').onclick = function() {
      var a = {tempId: el('atTemp').value, data: el('atData').value, horas: num(el('atHoras').value)}, er = T.validarAtraso(a), box = el('atErros');
      if (er.length) { box.style.display = ''; box.innerHTML = er.map(e).join('<br>'); return; }
      box.style.display = 'none';
      db.ref('rh_temporarios_atrasos').push({tempId: a.tempId, tempNome: nomeDe(a.tempId), data: a.data, horas: a.horas, motivo: el('atMotivo').value.trim(), registradoPor: quem(), criadoEm: new Date().toISOString()})
        .then(function() { toast('Atraso lançado.'); }).catch(function(err) { toast(err.message, true); });
    };
    el('conteudo').querySelectorAll('[data-del]').forEach(function(b) {
      b.onclick = function() { if (confirm('Excluir este atraso?')) db.ref('rh_temporarios_atrasos/' + b.getAttribute('data-del')).remove().catch(function(er) { toast(er.message, true); }); };
    });
  }

  /* ── Cadastro ── */
  function rCadastro() {
    var q = T.norm(S.busca), fs = S.filtroStatus || '';
    var ids = ordenadosPorNome(function(id, t) { return (!q || T.norm(t.nome + ' ' + (t.documento || '') + ' ' + (t.setor || '')).indexOf(q) >= 0) && (!fs || t.status === fs); });
    var h = '<div class="card"><h2>Cadastro de temporários</h2><div class="aviso warn">Documento, Pix, telefone e endereço são dados pessoais: ficam só nesta área, restrita ao RH.</div>' +
      '<div class="barra"><input type="text" id="busca" placeholder="Buscar nome, documento ou setor…" value="' + e(S.busca) + '" style="max-width:280px"><select id="fStatus" style="width:auto"><option value="">Todos</option><option value="Ativo"' + (fs === 'Ativo' ? ' selected' : '') + '>Ativos</option><option value="Inativo"' + (fs === 'Inativo' ? ' selected' : '') + '>Inativos</option></select><button type="button" class="btn pri" id="btnNovo">+ Novo temporário</button><span class="mut">' + ids.length + ' de ' + Object.keys(S.temps).length + '</span></div>';
    h += '<div class="tw"><table><thead><tr><th>Nome</th><th>Setor</th><th>Telefone</th><th>Documento</th><th>Pix</th><th>Idade</th><th>Status</th><th></th></tr></thead><tbody>';
    if (!ids.length) h += '<tr><td colspan="8" class="dica">Nenhum temporário.</td></tr>';
    ids.forEach(function(id) {
      var t = S.temps[id];
      h += '<tr><td><b>' + e(t.nome) + '</b></td><td>' + e(t.setor || '—') + '</td><td>' + e(t.telefone || '—') + '</td><td>' + e(t.documento || '—') + '</td><td>' + e(t.pix || '—') + '</td><td>' + e(t.idade || '—') + '</td><td><span class="tg ' + (t.status === 'Ativo' ? 'ok' : 'mute') + '">' + e(t.status || 'Inativo') + '</span></td><td><button type="button" class="btn sm" data-edit="' + e(id) + '">Editar</button></td></tr>';
    });
    h += '</tbody></table></div></div><div id="modalTemp"></div>';
    el('conteudo').innerHTML = h;
    el('busca').oninput = function() { S.busca = el('busca').value; var pos = el('busca').selectionStart; render(); var b = el('busca'); b.focus(); try { b.setSelectionRange(pos, pos); } catch (er) {} };
    el('fStatus').onchange = function() { S.filtroStatus = el('fStatus').value; render(); };
    el('btnNovo').onclick = function() { modalTemp(null); };
    el('conteudo').querySelectorAll('[data-edit]').forEach(function(b) { b.onclick = function() { modalTemp(b.getAttribute('data-edit')); }; });
  }
  function modalTemp(id) {
    var t = id ? S.temps[id] : {status: 'Ativo'};
    var campo = function(k, rot, tipo, extra) { return '<div' + (extra || '') + '><label class="t">' + rot + '</label><input type="' + (tipo || 'text') + '" id="c_' + k + '" value="' + e(t[k] == null ? '' : t[k]) + '"></div>'; };
    var m = document.createElement('div'); m.className = 'mf'; m.id = 'mfTemp';
    m.innerHTML = '<div class="md" role="dialog" aria-modal="true"><h2>' + (id ? 'Editar temporário' : 'Novo temporário') + '</h2><div class="grid2">' +
      campo('nome', 'Nome completo *') + campo('idade', 'Idade', 'number') + campo('telefone', 'Telefone') + campo('documento', 'RG / CPF') + campo('pix', 'Chave Pix') +
      campo('distanciaKm', 'Distância (km)', 'number') + campo('setor', 'Setor (define quem o avalia no Feedback)') +
      '<div><label class="t">Status</label><select id="c_status"><option value="Ativo"' + (t.status === 'Ativo' ? ' selected' : '') + '>Ativo</option><option value="Inativo"' + (t.status !== 'Ativo' ? ' selected' : '') + '>Inativo</option></select></div>' +
      '</div><div style="margin-top:8px">' + campo('endereco', 'Endereço completo') + '</div><div style="margin-top:8px">' + campo('obs', 'Observações') + '</div>' +
      '<div id="ctErros" class="aviso bad" style="display:none"></div><div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" id="ctCancela">Cancelar</button><button type="button" class="btn pri" id="ctSalva">Salvar</button></div></div>';
    document.body.appendChild(m);
    var fechar = function() { m.remove(); };
    el('ctCancela').onclick = fechar; m.onclick = function(ev) { if (ev.target === m) fechar(); };
    el('ctSalva').onclick = function() {
      var o = {nome: el('c_nome').value.trim(), status: el('c_status').value};
      ['idade', 'distanciaKm'].forEach(function(k) { var v = el('c_' + k).value; if (v !== '') o[k] = Number(v); });
      ['telefone', 'documento', 'pix', 'setor', 'endereco', 'obs'].forEach(function(k) { var v = el('c_' + k).value.trim(); if (v) o[k] = v; });
      var er = T.validarTemp(o);
      var dup = Object.keys(S.temps).some(function(k) { return k !== id && T.norm(S.temps[k].nome) === T.norm(o.nome); });
      if (dup) er.push('Já existe um temporário com esse nome.');
      if (er.length) { var b = el('ctErros'); b.style.display = ''; b.innerHTML = er.map(e).join('<br>'); return; }
      var ref = db.ref('rh_temporarios/' + (id || db.ref('rh_temporarios').push().key));
      var up = {}; Object.keys(o).forEach(function(k) { up[k] = o[k]; });
      if (id) ['idade', 'distanciaKm', 'telefone', 'documento', 'pix', 'setor', 'endereco', 'obs'].forEach(function(k) { if (!(k in o)) up[k] = null; });
      else up.criadoEm = new Date().toISOString();
      (id ? ref.update(up) : ref.set(up)).then(function() { toast('Temporário salvo.'); fechar(); }).catch(function(err) { toast(err.message, true); });
    };
  }

  /* ── Histórico de performance ── */
  function linhasHistorico() {
    var c = ctx();
    return Object.keys(S.temps).map(function(id) { return Object.assign({id: id, nome: S.temps[id].nome, status: S.temps[id].status}, T.historico(id, c)); });
  }
  function rHistorico() {
    var ord = S.ordHist, linhas = linhasHistorico();
    var chaves = {nome: function(a, b) { return T.norm(a.nome).localeCompare(T.norm(b.nome)); }, dias: function(a, b) { return b.diasTrabalhados - a.diasTrabalhados; },
      faltas: function(a, b) { return b.faltas - a.faltas; }, presenca: function(a, b) { return (b.presencaPct == null ? -1 : b.presencaPct) - (a.presencaPct == null ? -1 : a.presencaPct); },
      saldo: function(a, b) { return b.saldo - a.saldo; }, ultimo: function(a, b) { return String(b.ultimoDia || '').localeCompare(String(a.ultimoDia || '')); }};
    linhas.sort(chaves[ord] || chaves.nome);
    var h = '<div class="card"><h2>Histórico de performance</h2><p class="dica">Calculado dos lançamentos de presença, atrasos e pagamentos. Presença = dias trabalhados ÷ (trabalhados + faltas + abonadas); não convocado e feriado não entram. Saldo = total líquido − salário pago.</p>' +
      '<div class="barra"><label class="t" style="margin:0">Ordenar por <select id="ordHist" style="width:auto;display:inline-block"><option value="nome">Nome</option><option value="dias">Mais dias trabalhados</option><option value="faltas">Mais faltas</option><option value="presenca">Maior presença</option><option value="ultimo">Último dia trabalhado</option><option value="saldo">Maior saldo a pagar</option></select></label><button type="button" class="btn sm" id="histCsv">Exportar CSV</button></div>';
    h += '<div class="tw"><table><thead><tr><th>Temporário</th><th>Trabalhou</th><th>Faltas</th><th>Abonadas</th><th>Não conv.</th><th>% presença</th><th>1º dia</th><th>Último dia</th><th>Total líquido</th><th>Salário pago</th><th>Saldo</th></tr></thead><tbody>';
    linhas.forEach(function(l) {
      h += '<tr><td><b>' + e(l.nome) + '</b>' + (l.status === 'Ativo' ? '' : ' <span class="tg mute">inativo</span>') + (l.semanasComErro ? ' <span class="tg bad" title="semana com VT fora do múltiplo">' + l.semanasComErro + ' sem. com erro</span>' : '') + '</td><td>' + l.diasTrabalhados + '</td><td>' + (l.faltas ? '<span class="tg warn">' + l.faltas + '</span>' : '0') + '</td><td>' + l.abonadas + '</td><td>' + l.naoConvocados + '</td><td>' + (l.presencaPct == null ? '—' : Math.round(l.presencaPct * 100) + '%') + '</td><td>' + e(l.primeiroDia ? T.dataBR(l.primeiroDia) : '—') + '</td><td>' + e(l.ultimoDia ? T.dataBR(l.ultimoDia) : '—') + '</td><td>' + T.moeda(l.totalLiquido) + '</td><td>' + T.moeda(l.totalPago) + '</td><td><b>' + T.moeda(l.saldo) + '</b></td></tr>';
    });
    h += '</tbody></table></div></div>';
    el('conteudo').innerHTML = h;
    el('ordHist').value = ord; el('ordHist').onchange = function() { S.ordHist = el('ordHist').value; render(); };
    el('histCsv').onclick = function() {
      var n = function(v) { return v == null ? '' : Number(v).toFixed(2).replace('.', ','); };
      var csv = ['Nome;Dias trabalhados;Faltas;Abonadas;Nao convocados;% presenca;1o dia;Ultimo dia;Total liquido;Salario pago;Saldo'].concat(linhas.map(function(l) {
        return [l.nome, l.diasTrabalhados, l.faltas, l.abonadas, l.naoConvocados, l.presencaPct == null ? '' : Math.round(l.presencaPct * 100), l.primeiroDia || '', l.ultimoDia || '', n(l.totalLiquido), n(l.totalPago), n(l.saldo)].join(';');
      })).join('\r\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], {type: 'text/csv;charset=utf-8'})); a.download = 'historico-temporarios.csv'; document.body.appendChild(a); a.click(); a.remove();
    };
  }

  /* ── Parâmetros ── */
  function rParametros() {
    var p = T.parametros(S.cfg), f = fer();
    var campo = function(k, rot, dica) { return '<div><label class="t">' + rot + '</label><input type="text" inputmode="decimal" id="p_' + k + '" value="' + e(nBR(p[k])) + '">' + (dica ? '<div class="dica">' + dica + '</div>' : '') + '</div>'; };
    var h = '<div class="card"><h2>Parâmetros de pagamento</h2><p class="dica">Valem para todos os fechamentos. Mudar um valor recalcula as semanas já registradas: confira o fechamento antes de pagar.</p><div class="grid2">' +
      campo('valorHora', 'Valor da hora (R$)') + campo('diariaSemana', 'Diária de 9 h, seg–qui (R$)') + campo('diariaSexta', 'Diária de sexta, 8 h (R$)') + campo('diariaReduzida', 'Diária reduzida (R$)', 'Semana com falta F, ou dia com atraso a partir do limite.') +
      campo('valorVT', 'Valor do VT por dia (R$)') + campo('horasDia', 'Horas por dia, seg–qui') + campo('horasSexta', 'Horas na sexta (padrão)') + campo('atrasoLimiteHoras', 'Atraso a partir de (horas)', 'A diária do dia vira a reduzida e as horas descontam proporcionalmente.') +
      '</div><div style="margin-top:10px"><button type="button" class="btn pri" id="pSalvar">Salvar parâmetros</button></div><div id="pErros" class="aviso bad" style="display:none"></div></div>';
    var datas = Object.keys(f).sort();
    h += '<div class="card"><h2>Feriados</h2><p class="dica">Dia sem trabalho: não é pago, não conta como falta e já aparece como FER na grade.' + (S.cfg.feriados && Object.keys(S.cfg.feriados).length ? '' : ' <b>Esta é a lista inicial da planilha; salve para registrar.</b>') + '</p><div class="tw"><table><thead><tr><th>Data</th><th>Descrição</th><th></th></tr></thead><tbody>' +
      datas.map(function(d) { return '<tr><td>' + e(T.dataBR(d)) + '</td><td>' + e(f[d]) + '</td><td><button type="button" class="btn sm perigo" data-fdel="' + e(d) + '">Remover</button></td></tr>'; }).join('') +
      '</tbody></table></div><div class="barra" style="margin-top:10px"><input type="date" id="fData" style="width:auto"><input type="text" id="fNome" placeholder="Descrição" style="max-width:260px"><button type="button" class="btn" id="fAdd">Adicionar feriado</button>' + (S.cfg.feriados && Object.keys(S.cfg.feriados).length ? '' : '<button type="button" class="btn pri" id="fGravar">Salvar lista inicial</button>') + '</div></div>';
    el('conteudo').innerHTML = h;
    el('pSalvar').onclick = function() {
      var o = {}; ['valorHora', 'diariaSemana', 'diariaSexta', 'diariaReduzida', 'valorVT', 'horasDia', 'horasSexta', 'atrasoLimiteHoras'].forEach(function(k) { o[k] = num(el('p_' + k).value); });
      var er = T.validarParametros(o), box = el('pErros');
      if (er.length) { box.style.display = ''; box.innerHTML = er.map(e).join('<br>'); return; }
      box.style.display = 'none';
      db.ref('rh_temporarios_config').update(o).then(function() { toast('Parâmetros salvos.'); }).catch(function(err) { toast(err.message, true); });
    };
    var gravaFeriados = function(obj) { return db.ref('rh_temporarios_config/feriados').set(obj); };
    el('conteudo').querySelectorAll('[data-fdel]').forEach(function(b) {
      b.onclick = function() { var obj = Object.assign({}, f); delete obj[b.getAttribute('data-fdel')]; gravaFeriados(Object.keys(obj).length ? obj : {}).catch(function(er) { toast(er.message, true); }); };
    });
    el('fAdd').onclick = function() {
      var d = el('fData').value, n = el('fNome').value.trim();
      if (!T.dataValida(d) || !n) { toast('Informe a data e a descrição.', true); return; }
      var obj = Object.assign({}, f); obj[d] = n; gravaFeriados(obj).then(function() { toast('Feriado adicionado.'); }).catch(function(er) { toast(er.message, true); });
    };
    if (el('fGravar')) el('fGravar').onclick = function() { gravaFeriados(Object.assign({}, f)).then(function() { toast('Lista de feriados salva.'); }).catch(function(er) { toast(er.message, true); }); };
  }

  /* ── Carga ── */
  function iniciar() {
    dbOnValue(db.ref('rh_temporarios'), function(s) { S.temps = s.val() || {}; S.carregou.temps = true; renderSePronto(); }, {onError: function() { S.carregou.temps = true; S.temps = {}; renderSePronto(); }, attempts: 1});
    dbOnValue(db.ref('rh_temporarios_presenca'), function(s) { S.presenca = s.val() || {}; S.carregou.pres = true; renderSePronto(); }, {onError: function() { S.carregou.pres = true; renderSePronto(); }, attempts: 1});
    dbOnValue(db.ref('rh_temporarios_atrasos'), function(s) { S.atrasos = s.val() || {}; S.carregou.atr = true; renderSePronto(); }, {onError: function() { S.carregou.atr = true; renderSePronto(); }, attempts: 1});
    dbOnValue(db.ref('rh_temporarios_pagamentos'), function(s) { S.pagamentos = s.val() || {}; S.carregou.pag = true; renderSePronto(); }, {onError: function() { S.carregou.pag = true; renderSePronto(); }, attempts: 1});
    dbOnValue(db.ref('rh_temporarios_config'), function(s) { S.cfg = s.val() || {}; S.carregou.cfg = true; renderSePronto(); }, {onError: function() { S.carregou.cfg = true; renderSePronto(); }, attempts: 1});
    dbOnValue(db.ref('rh_temporarios_semanas'), function(s) { S.semanasCfg = s.val() || {}; S.carregou.sem = true; renderSePronto(); }, {onError: function() { S.carregou.sem = true; renderSePronto(); }, attempts: 1});
  }
  window.addEventListener('kuryos-auth-pronto', function() { renderSePronto(); });
  var iniciou = false;
  function tentar() { if (iniciou) return; iniciou = true; iniciar(); }
  firebase.auth().onAuthStateChanged(function(u) { if (u) tentar(); });
  if (firebase.auth().currentUser) tentar();
})();
