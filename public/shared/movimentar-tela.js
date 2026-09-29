'use strict';
/* MOVIMENTAR (WMS) — tela do operador (29/09). Regras em
   shared/movimentacao-wms.js; gravação pelas funções de sempre do utils.js
   (transferirLoteEndereco: o lote inteiro muda de posição;
   separarParcialLoteEndereco: parte do lote vai, parte fica). Mover nunca
   muda saldo -- só onde o material está. */
(function() {
  var db = firebase.database();
  var M = MovimentacaoWMS;
  var lotes = {}, enderecos = {}, movimentos = {}, motivos = [], carregado = {lotes: false, enderecos: false};
  var st = {origemKey: '', selecao: {}, destinoKey: '', motivo: '', parcial: {}, ocupado: false, ultimo: null, candidatos: null};
  var MOTIVO_PADRAO = 'TRANSFERÊNCIA ENTRE ENDEREÇOS';
  function el(id) { return document.getElementById(id); }
  function e(v) { return escapeHtml(String(v == null ? '' : v)); }
  function num(v) { return Number(v || 0).toLocaleString('pt-BR'); }
  function dataHora(v) { var d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}); }
  function autor() { return (window.currentUser && window.currentUser.nome) || (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'Desconhecido'; }
  function aviso(html, tipo) { var r = el('resultado'); r.className = 'mv-aviso ' + (tipo || 'info'); r.innerHTML = html; r.hidden = !html; if (html) r.scrollIntoView({block: 'nearest'}); }
  function codigoEnd(k) { return ((enderecos[k] || {}).codigo) || k || '—'; }
  function areaEnd(k) { var x = enderecos[k] || {}; return M.ehDoca(x) ? 'Doca' : (x.area || ''); }
  function fonte() { return {enderecos: enderecos, lotes: lotes}; }
  var temCamera = typeof window.BarcodeDetector === 'function' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;

  /* ── 1. De onde ── */
  function definirOrigem(key, somenteLote) {
    st.origemKey = key; st.selecao = {}; st.parcial = {}; st.candidatos = null;
    var itens = M.conteudo(key, lotes);
    // Palete lido: marca só ele. Posição lida: marca tudo (o palete inteiro).
    itens.forEach(function(l) { var id = l.itemKey + '/' + l.loteKey; st.selecao[id] = {mover: !somenteLote || somenteLote === id, qtd: ''}; });
    if (st.destinoKey === key) st.destinoKey = '';
    render();
    if (itens.length) el('paraCodigo').focus();
  }
  function lerOrigem(codigo) {
    var r = M.reconhecer(codigo, enderecos, lotes);
    if (r.tipo === 'VAZIO') return;
    if (r.tipo === 'ENDERECO') { aviso(''); definirOrigem(r.enderecoKey); }
    else if (r.tipo === 'LOTE') {
      if (!r.enderecoKey) return aviso('Este lote não tem posição no WMS. Guarde-o primeiro pela Doca.', 'erro');
      aviso(''); definirOrigem(r.enderecoKey, r.itemKey + '/' + r.loteKey);
    } else if (r.tipo === 'VARIOS') { st.candidatos = r.candidatos; render(); }
    else aviso('Nada encontrado para <b>' + e(r.codigo) + '</b>. Confira o código da posição (ex.: FAB-1.1.1), do palete (PA-…) ou do lote (AK-…).', 'erro');
  }

  /* ── 3. Para onde ── */
  function lerDestino(codigo) {
    var r = M.reconhecer(codigo, enderecos, {});
    if (r.tipo === 'VAZIO') return;
    if (r.tipo !== 'ENDERECO') return aviso('<b>' + e(codigo) + '</b> não é um endereço. O destino é sempre uma posição (ex.: GAL-2.3.1) ou a Doca.', 'erro');
    aviso(''); st.destinoKey = r.enderecoKey; render();
    el('btnMover').focus();
  }
  function abrirMapa(qual) {
    var movendo = plano().operacoes;
    SeletorEndereco.abrir({
      fonte: fonte, valor: qual === 'de' ? st.origemKey : st.destinoKey, preferirPosicao: qual === 'para',
      ignorar: movendo.length === 1 ? {itemKey: movendo[0].itemKey, loteKey: movendo[0].loteKey} : null,
      titulo: qual === 'de' ? 'De onde sai o material' : 'Para onde vai o material',
      subtitulo: qual === 'de' ? 'Toque na posição (laranja = ocupada).' : (movendo.length ? 'Movendo: ' + plano().resumo : ''),
      onEscolher: function(key) { if (qual === 'de') definirOrigem(key); else { st.destinoKey = key; render(); } }
    });
  }

  function plano() {
    return M.planejar({origemKey: st.origemKey, destinoKey: st.destinoKey, lotes: lotes, enderecos: enderecos, motivo: st.motivo, selecao: st.selecao});
  }

  /* ── Desenho ── */
  function tagStatus(s) {
    var cls = s === 'LIBERADO' || s === 'LIBERADO_EXPEDICAO' ? 'ok' : s === 'QUARENTENA' ? 'q' : 'x';
    var rot = typeof rotuloStatusLote === 'function' ? rotuloStatusLote(s) : s;
    return '<span class="mv-tag ' + cls + '">' + e(rot) + '</span>';
  }
  function renderOrigem() {
    var box = el('deConteudo');
    var docaKey = SeletorEndereco.docaPadrao(enderecos), naDoca = docaKey ? M.conteudo(docaKey, lotes).length : 0;
    el('btnDoca').textContent = '🚚 Doca' + (naDoca ? ' (' + naDoca + ')' : '');
    el('btnDoca').disabled = !docaKey;
    if (st.candidatos) {
      box.innerHTML = '<p class="mv-sub">Mais de um lote com esse código. Qual deles?</p>' + st.candidatos.map(function(c) {
        var l = (lotes[c.itemKey] || {})[c.loteKey] || {};
        return '<button class="mv-opcao" data-cand="' + e(c.itemKey + '/' + c.loteKey) + '"><b>' + e(l.itemCodigo || c.itemKey) + '</b> ' + e(l.itemNome || '') + ' · ' + num(l.saldoLote) + ' ' + e(l.unidade || '') + ' · em ' + e(codigoEnd(c.enderecoKey)) + '</button>';
      }).join('');
      box.querySelectorAll('[data-cand]').forEach(function(b) { b.onclick = function() { var p = b.dataset.cand.split('/'), l = lotes[p[0]][p[1]]; definirOrigem(l.enderecoKey, b.dataset.cand); }; });
      return;
    }
    if (!st.origemKey) { box.innerHTML = ''; el('passoOque').hidden = true; return; }
    el('deEscolhido').innerHTML = '<span class="mv-local">' + e(codigoEnd(st.origemKey)) + '</span> <span class="mv-sub">' + e(areaEnd(st.origemKey)) + '</span> <button class="mv-link" id="trocarOrigem">trocar</button>';
    el('trocarOrigem').onclick = function() { st.origemKey = ''; st.selecao = {}; el('deCodigo').value = ''; render(); el('deCodigo').focus(); };
    box.innerHTML = '';
    // 2. O quê
    var itens = M.conteudo(st.origemKey, lotes);
    el('passoOque').hidden = false;
    var marcados = itens.filter(function(l) { return (st.selecao[l.itemKey + '/' + l.loteKey] || {}).mover; }).length;
    el('oqueResumo').textContent = itens.length ? marcados + ' de ' + itens.length + ' lote(s) marcados' : '';
    el('oqueLista').innerHTML = !itens.length ? '<p class="mv-vazio">Esta posição está vazia. Escolha outra origem.</p>' :
      (itens.length > 1 ? '<label class="mv-todos"><input type="checkbox" id="marcarTodos"' + (marcados === itens.length ? ' checked' : '') + '> Mover tudo — o palete inteiro</label>' : '') +
      itens.map(function(l) {
        var id = l.itemKey + '/' + l.loteKey, s = st.selecao[id] || {}, abrirParcial = st.parcial[id];
        var podeParcial = l.itemTipo !== 'produto';
        return '<div class="mv-lote' + (s.mover ? ' on' : '') + '"><label class="mv-check"><input type="checkbox" data-mover="' + e(id) + '"' + (s.mover ? ' checked' : '') + '>' +
          '<span><b>' + e(l.itemCodigo) + '</b> ' + e(l.itemNome) + '<small>' + e(l.rotulo || '—') + ' · ' + tagStatus(l.status) + (l.validade ? ' · val. ' + e(String(l.validade).slice(0, 10).split('-').reverse().join('/')) : '') + '</small></span>' +
          '<span class="mv-saldo">' + num(l.saldo) + ' ' + e(l.unidade) + '</span></label>' +
          (s.mover && podeParcial ? (abrirParcial
            ? '<div class="mv-parcial">Mover só <input type="text" inputmode="decimal" data-qtd="' + e(id) + '" value="' + e(s.qtd || '') + '" placeholder="' + num(l.saldo) + '"> de ' + num(l.saldo) + ' ' + e(l.unidade) + ' <button class="mv-link" data-tudo="' + e(id) + '">mover tudo</button></div>'
            : '<button class="mv-link" data-abrir-parcial="' + e(id) + '">mover só uma parte</button>') : '') +
          (s.mover && !podeParcial ? '<div class="mv-sub">Palete de produto acabado se move inteiro.</div>' : '') +
          '<button class="mv-link" data-etq="' + e(id) + '">🏷️ etiqueta</button></div>';
      }).join('');
    var todos = el('marcarTodos');
    if (todos) todos.onchange = function() { itens.forEach(function(l) { var id = l.itemKey + '/' + l.loteKey; st.selecao[id] = {mover: todos.checked, qtd: ''}; }); render(); };
    el('oqueLista').querySelectorAll('[data-mover]').forEach(function(c) { c.onchange = function() { st.selecao[c.dataset.mover] = {mover: c.checked, qtd: ''}; render(); }; });
    el('oqueLista').querySelectorAll('[data-abrir-parcial]').forEach(function(b) { b.onclick = function() { st.parcial[b.dataset.abrirParcial] = true; render(); var i = el('oqueLista').querySelector('[data-qtd="' + CSS.escape(b.dataset.abrirParcial) + '"]'); if (i) i.focus(); }; });
    el('oqueLista').querySelectorAll('[data-tudo]').forEach(function(b) { b.onclick = function() { delete st.parcial[b.dataset.tudo]; st.selecao[b.dataset.tudo].qtd = ''; render(); }; });
    el('oqueLista').querySelectorAll('[data-etq]').forEach(function(b) { b.onclick = function() { imprimirLotes([b.dataset.etq]); }; });
    if (itens.length > 1) el('oqueLista').insertAdjacentHTML('beforeend', '<button class="mv-link" id="etqTodos">🏷️ etiquetas de todos os lotes desta posição</button>');
    var bt = el('etqTodos'); if (bt) bt.onclick = function() { imprimirLotes(itens.map(function(l) { return l.itemKey + '/' + l.loteKey; })); };
    el('oqueLista').querySelectorAll('[data-qtd]').forEach(function(i) { i.oninput = function() { st.selecao[i.dataset.qtd].qtd = i.value; renderConfirmar(); }; });
  }
  function renderDestino() {
    el('passoPara').hidden = !st.origemKey;
    if (!st.origemKey) return;
    var p = plano(), d = p.destino;
    el('paraEscolhido').innerHTML = st.destinoKey ? '<span class="mv-local">' + e(codigoEnd(st.destinoKey)) + '</span> <span class="mv-sub">' + e(areaEnd(st.destinoKey)) + '</span> <button class="mv-link" id="trocarDestino">trocar</button>' : '';
    if (st.destinoKey) el('trocarDestino').onclick = function() { st.destinoKey = ''; el('paraCodigo').value = ''; render(); el('paraCodigo').focus(); };
    var cls = {LIVRE: 'ok', DOCA: 'info', OCUPADA: 'alerta', BLOQUEADA: 'erro', MESMA: 'erro', INEXISTENTE: 'erro'}[d.tipo];
    el('paraSituacao').className = 'mv-situacao ' + (cls || '');
    el('paraSituacao').hidden = !st.destinoKey;
    el('paraSituacao').innerHTML = st.destinoKey ? '<b>' + e(d.texto || '') + '</b>' + ((d.ocupantes || []).length ? '<ul>' + d.ocupantes.map(function(o) { return '<li>' + e(o.itemCodigo) + ' ' + e(o.itemNome) + ' · ' + num(o.saldo) + ' ' + e(o.unidade) + '</li>'; }).join('') + '</ul>' : '') : '';
    var sug = M.sugerirLivres(st.origemKey, enderecos, lotes, 6);
    el('paraSugestoes').innerHTML = sug.length ? '<span class="mv-sub">Livres perto:</span> ' + sug.map(function(s) { return '<button class="mv-chip' + (s.enderecoKey === st.destinoKey ? ' on' : '') + '" data-sug="' + e(s.enderecoKey) + '">' + e(s.codigo) + '</button>'; }).join('') : '';
    el('paraSugestoes').querySelectorAll('[data-sug]').forEach(function(b) { b.onclick = function() { st.destinoKey = b.dataset.sug; render(); }; });
  }
  function renderConfirmar() {
    el('passoConfirmar').hidden = !st.origemKey;
    if (!st.origemKey) return;
    var p = plano();
    el('confResumo').textContent = p.resumo || 'Marque o que vai e escolha o destino.';
    el('confErros').innerHTML = p.erros.length && (st.destinoKey || p.operacoes.length) ? p.erros.map(function(x) { return '<li>' + e(x) + '</li>'; }).join('') : '';
    el('btnMover').disabled = st.ocupado || !p.ok;
    el('btnMover').textContent = st.ocupado ? 'Movendo…' : p.operacoes.length ? (p.paleteInteiro && p.operacoes.length > 1 ? 'Mover o palete inteiro' : 'Mover ' + p.operacoes.length + ' lote(s)') + (st.destinoKey ? ' para ' + codigoEnd(st.destinoKey) : '') : 'Mover';
  }
  function renderUltimas() {
    var ls = M.ultimas(movimentos, enderecos, 15);
    el('ultimas').innerHTML = ls.length ? ls.map(function(m) {
      return '<tr><td>' + dataHora(m.em) + '</td><td><b>' + e(m.itemCodigo) + '</b> ' + e(m.itemNome) + '</td><td>' + e(m.de) + ' → <b>' + e(m.para) + '</b></td><td class="num">' + (m.qtd ? num(m.qtd) + ' ' + e(m.unidade) : 'lote inteiro') + '</td><td>' + e(m.motivo) + '</td><td>' + e(m.autor) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="mv-vazio">Nenhuma movimentação ainda.</td></tr>';
  }
  function render() {
    if (!carregado.lotes || !carregado.enderecos) return;
    el('deEscolhido').innerHTML = '';
    renderOrigem(); renderDestino(); renderConfirmar();
    el('motivo').innerHTML = motivos.map(function(m) { return '<option' + (m === st.motivo ? ' selected' : '') + '>' + e(m) + '</option>'; }).join('');
  }

  /* ── Mover ── */
  async function mover() {
    var p = plano();
    if (st.ocupado || !p.ok) return;
    if (p.destino.tipo === 'OCUPADA' && !confirm('A posição ' + p.destino.codigo + ' já tem material. Vai para o MESMO palete. Confirmar?')) return;
    st.ocupado = true; renderConfirmar();
    var origem = st.origemKey, destino = st.destinoKey, feitos = [], falhas = [];
    for (var i = 0; i < p.operacoes.length; i++) {
      var o = p.operacoes[i], lote = (lotes[o.itemKey] || {})[o.loteKey] || {};
      // O motor grava em sanitizeKey(itemCodigo): se o código não bater com a
      // chave do lote, usa a própria chave.
      var cod = sanitizeKey(lote.itemCodigo || '') === o.itemKey ? lote.itemCodigo : o.itemKey;
      try {
        if (o.tipo === 'MOVER_LOTE') await transferirLoteEndereco(db, lote.itemTipo || o.itemTipo, cod, o.loteKey, destino, st.motivo, autor());
        else await separarParcialLoteEndereco(db, lote.itemTipo || o.itemTipo, cod, o.loteKey, o.qtd, destino, st.motivo, autor(), null, {origemTipo: 'movimentacao'});
        feitos.push(o);
      } catch (err) { falhas.push(o.itemCodigo + ' (' + (err.message || 'erro') + ')'); }
    }
    st.ocupado = false;
    st.ultimo = {origem: origem, destino: destino, lotes: feitos.filter(function(o) { return o.tipo === 'MOVER_LOTE'; })};
    var msg = feitos.length ? '✓ ' + e(p.resumo) : '';
    if (falhas.length) msg += (msg ? '<br>' : '') + '⚠ Não foi possível mover: ' + e(falhas.join('; ')) + '. Confira e tente de novo.';
    if (feitos.length && st.ultimo.lotes.length === feitos.length) msg += ' <button class="mv-link" id="desfazer">Mover de volta</button>';
    aviso(msg, falhas.length ? 'erro' : 'ok');
    var d = el('desfazer'); if (d) d.onclick = desfazer;
    st.origemKey = ''; st.selecao = {}; st.parcial = {}; st.destinoKey = '';
    el('deCodigo').value = ''; el('paraCodigo').value = '';
    render(); el('deCodigo').focus();
  }
  async function desfazer() {
    var u = st.ultimo;
    if (!u || !u.lotes.length || st.ocupado) return;
    st.ocupado = true;
    try {
      for (var i = 0; i < u.lotes.length; i++) {
        var o = u.lotes[i], lote = (lotes[o.itemKey] || {})[o.loteKey] || {};
        var cod = sanitizeKey(lote.itemCodigo || '') === o.itemKey ? lote.itemCodigo : o.itemKey;
        await transferirLoteEndereco(db, lote.itemTipo || o.itemTipo, cod, o.loteKey, u.origem, 'MOVIMENTAÇÃO DESFEITA', autor());
      }
      aviso('↩ Voltou para ' + e(codigoEnd(u.origem)) + '.', 'ok');
      st.ultimo = null;
    } catch (err) { aviso('Não foi possível mover de volta: ' + e(err.message), 'erro'); }
    finally { st.ocupado = false; render(); }
  }

  /* ── Leitura pela câmera (Chrome/Android: BarcodeDetector) ── */
  var camera = null;
  async function lerCamera(destinoCampo) {
    if (!temCamera) return;
    var over = el('camera'), video = el('cameraVideo');
    try {
      var det = new BarcodeDetector({formats: ['qr_code', 'code_39', 'code_128']});
      var stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment'}});
      camera = {stream: stream, ativo: true};
      video.srcObject = stream; over.hidden = false; await video.play();
      (async function loop() {
        while (camera && camera.ativo) {
          var cods = await det.detect(video).catch(function() { return []; });
          if (cods.length) { var v = cods[0].rawValue; fecharCamera(); el(destinoCampo).value = v; (destinoCampo === 'deCodigo' ? lerOrigem : lerDestino)(v); return; }
          await new Promise(function(r) { setTimeout(r, 200); });
        }
      })();
    } catch (err) { fecharCamera(); aviso('Não foi possível abrir a câmera: ' + e(err.message) + '. Digite o código.', 'erro'); }
  }
  function fecharCamera() {
    if (camera) { camera.ativo = false; (camera.stream.getTracks() || []).forEach(function(t) { t.stop(); }); }
    camera = null; el('camera').hidden = true;
  }

  /* ── Etiquetas de endereço ── */
  function renderEtiquetasFiltro() {
    var areas = {};
    Object.keys(enderecos).forEach(function(k) { var x = enderecos[k]; if (x && x.ativo !== false && !x.legado) areas[x.area || 'SEM ÁREA'] = true; });
    var sel = el('etArea'), atual = sel.value;
    sel.innerHTML = Object.keys(areas).sort().map(function(a) { return '<option>' + e(a) + '</option>'; }).join('');
    if (atual) sel.value = atual;
    contarEtiquetas();
  }
  function enderecosEtiqueta() {
    var area = el('etArea').value, rua = Number(el('etRua').value) || 0;
    return Object.keys(enderecos).map(function(k) { return Object.assign({key: k}, enderecos[k]); })
      .filter(function(x) { return x.ativo !== false && !x.legado && (x.area || 'SEM ÁREA') === area && (!rua || Number(x.rua) === rua); })
      .sort(function(a, b) { return String(a.codigo || a.key).localeCompare(String(b.codigo || b.key), 'pt-BR', {numeric: true}); });
  }
  function contarEtiquetas() { el('btnEtiquetas').textContent = '🏷️ Imprimir ' + enderecosEtiqueta().length + ' etiqueta(s)'; }
  function imprimirEtiquetas() {
    var lista = enderecosEtiqueta();
    if (!lista.length) return aviso('Nenhum endereço neste filtro.', 'erro');
    if (!EtiquetasWMS.imprimir(el('etFormato').value, lista, 'Etiquetas de endereço')) aviso('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.', 'erro');
  }
  // Etiqueta do palete/lote (PA-… ou AK-…): para o que chegou sem etiqueta
  // ou teve a etiqueta danificada.
  function imprimirLotes(ids) {
    var ls = ids.map(function(id) { var p = id.split('/'), l = (lotes[p[0]] || {})[p[1]]; return l ? Object.assign({}, l, {enderecoCodigo: codigoEnd(l.enderecoKey)}) : null; }).filter(Boolean);
    if (!ls.length) return;
    if (!EtiquetasWMS.imprimir('palete', ls, 'Etiquetas de palete')) aviso('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.', 'erro');
  }


  /* ── Ligações ── */
  el('deCodigo').addEventListener('keydown', function(ev) { if (ev.key === 'Enter') { ev.preventDefault(); lerOrigem(this.value); } });
  el('deCodigo').addEventListener('change', function() { lerOrigem(this.value); });
  el('paraCodigo').addEventListener('keydown', function(ev) { if (ev.key === 'Enter') { ev.preventDefault(); lerDestino(this.value); } });
  el('paraCodigo').addEventListener('change', function() { lerDestino(this.value); });
  el('btnMapaDe').onclick = function() { abrirMapa('de'); };
  el('btnMapaPara').onclick = function() { abrirMapa('para'); };
  el('btnDoca').onclick = function() { var k = SeletorEndereco.docaPadrao(enderecos); if (k) definirOrigem(k); };
  el('btnParaDoca').onclick = function() { var k = SeletorEndereco.docaPadrao(enderecos); if (k) { st.destinoKey = k; render(); } };
  el('motivo').onchange = function() { st.motivo = this.value; renderConfirmar(); };
  el('btnMover').onclick = mover;
  ['btnCamDe', 'btnCamPara'].forEach(function(id) { el(id).hidden = !temCamera; });
  el('btnCamDe').onclick = function() { lerCamera('deCodigo'); };
  el('btnCamPara').onclick = function() { lerCamera('paraCodigo'); };
  el('cameraFechar').onclick = fecharCamera;
  el('etArea').onchange = contarEtiquetas; el('etRua').oninput = contarEtiquetas;
  el('btnEtiquetas').onclick = imprimirEtiquetas;
  // Link direto: movimentar.html?de=FAB-1.1.1 (ou ?de=PA-…).
  var deURL = new URLSearchParams(location.search).get('de');

  dbOnValue(db.ref('estoque_lotes'), function(s) { lotes = s.val() || {}; carregado.lotes = true; if (!st.ocupado) render(); if (deURL && carregado.enderecos) { el('deCodigo').value = deURL; lerOrigem(deURL); deURL = null; } });
  dbOnValue(db.ref('enderecos_estoque'), function(s) { enderecos = s.val() || {}; carregado.enderecos = true; renderEtiquetasFiltro(); if (!st.ocupado) render(); renderUltimas(); if (deURL && carregado.lotes) { el('deCodigo').value = deURL; lerOrigem(deURL); deURL = null; } });
  dbOnValue(db.ref('movimentos_estoque'), function(s) { movimentos = s.val() || {}; renderUltimas(); });
  dbOnValue(db.ref('config/motivosMovimentoEstoque'), function(s) {
    var v = s.val() || [];
    var lista = (Array.isArray(v) ? v : Object.values(v)).filter(function(m) { return m && m.ativo !== false && m.nome; }).map(function(m) { return m.nome; });
    if (lista.indexOf(MOTIVO_PADRAO) === -1) lista.unshift(MOTIVO_PADRAO);
    motivos = lista;
    if (!st.motivo || motivos.indexOf(st.motivo) === -1) st.motivo = MOTIVO_PADRAO;
    render();
  });
})();
