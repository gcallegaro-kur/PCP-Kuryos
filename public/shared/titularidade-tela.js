'use strict';
/* Titularidade do estoque (24/10/2026): tela. A regra mora em shared/titularidade.js
   (a mesma que a Cloud Function `alterarTitularidadeEstoque` roda no servidor);
   aqui só se escolhe o item, o lote e o novo dono, e se mostra o resultado ANTES
   de gravar (a pré-visualização usa a mesma função pura). */
(function() {
  var db = firebase.database();
  var PE = PropriedadeEstoque, T = Titularidade;
  var estoque = {}, lotes = {}, clientes = {}, itemKey = '';
  var carregado = {estoque: false, lotes: false, clientes: false};
  function el(id) { return document.getElementById(id); }
  function e(v) { return escapeHtml(String(v == null ? '' : v)); }
  function num(v) { return Number(v || 0).toLocaleString('pt-BR'); }
  function arred(v) { return Math.round(Number(v) * 1000) / 1000; }
  function autor() { return (window.currentUser && window.currentUser.nome) || (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'Desconhecido'; }
  function dataHora(v) { var d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}); }
  function aviso(html, tipo) { var r = el('resultado'); r.className = 'tt-aviso ' + (tipo || 'info'); r.innerHTML = html; r.hidden = !html; if (html) r.scrollIntoView({block: 'nearest'}); }
  function nomeCliente(k) { var c = clientes[k] || {}; return c.nome || c.nomeFantasia || k; }
  function nomeDono(d) { return d.tipo === 'CLIENTE' ? (d.clienteNome || nomeCliente(d.clienteKey)) : 'Kuryos (geral)'; }
  function tagDono(d) { return '<span class="tt-tag ' + (d.tipo === 'CLIENTE' ? 'tt-c' : 'tt-k') + '">' + e(nomeDono(d)) + '</span>'; }
  function tagStatus(s) {
    var cls = s === 'QUARENTENA' ? 'tt-q' : 'tt-ok';
    return '<span class="tt-tag ' + cls + '">' + e(typeof rotuloStatusLote === 'function' ? rotuloStatusLote(s || 'LIBERADO') : (s || 'LIBERADO')) + '</span>';
  }
  function pronto() { return carregado.estoque && carregado.lotes && carregado.clientes; }

  /* ── 1. Busca do item ── */
  function renderBusca() {
    var q = normalizeSearch(el('busca').value), box = el('resultados');
    if (!q) { box.innerHTML = ''; return; }
    var palavras = q.split(' ').filter(Boolean);
    var achados = Object.keys(estoque).filter(function(k) {
      var s = estoque[k] || {};
      var palheiro = normalizeSearch((s.materialCodigo || k) + ' ' + (s.materialNome || ''));
      return palavras.every(function(p) { return palheiro.indexOf(p) !== -1; });
    }).sort().slice(0, 20);
    box.innerHTML = achados.length ? achados.map(function(k) {
      var s = estoque[k];
      return '<button type="button" class="tt-opcao" data-item="' + e(k) + '"><b>' + e(s.materialCodigo || k) + '</b> ' + e(s.materialNome || '') + '<small>saldo ' + num(s.saldoAtual) + ' ' + e(s.unidade || '') + '</small></button>';
    }).join('') : '<p class="sub">Nenhum item com registro de estoque para <b>' + e(el('busca').value) + '</b>.</p>';
    box.querySelectorAll('[data-item]').forEach(function(b) { b.onclick = function() { itemKey = b.dataset.item; el('busca').value = ''; box.innerHTML = ''; aviso(''); renderItem(); }; });
  }

  /* ── 2. O item: donos e lotes ── */
  function lotesDoItem() {
    return Object.keys(lotes[itemKey] || {}).map(function(k) { return Object.assign({key: k}, lotes[itemKey][k]); })
      .filter(function(l) { return Number(l.saldoLote) > 0 && (!l.itemTipo || l.itemTipo === 'material'); });
  }
  function donosDoItem() {
    var partes = PE.saldoPorDono(estoque[itemKey] || {});
    var emLotes = {K: 0}, lista = [];
    lotesDoItem().forEach(function(l) { var d = PE.donoDoLote(l), k = d.tipo === 'CLIENTE' ? d.clienteKey : 'K'; emLotes[k] = (emLotes[k] || 0) + Number(l.saldoLote); });
    lista.push({dono: {tipo: 'KURYOS'}, saldo: partes.geral, emLotes: arred(emLotes.K || 0)});
    var chaves = Object.keys(partes.porCliente);
    Object.keys(emLotes).forEach(function(k) { if (k !== 'K' && chaves.indexOf(k) < 0) chaves.push(k); });
    chaves.forEach(function(ck) { lista.push({dono: {tipo: 'CLIENTE', clienteKey: ck, clienteNome: nomeCliente(ck)}, saldo: partes.porCliente[ck] || 0, emLotes: arred(emLotes[ck] || 0)}); });
    lista.forEach(function(x) { x.semLote = arred(x.saldo - x.emLotes); });
    return lista;
  }
  function renderItem() {
    var painel = el('painelItem');
    if (!itemKey || !estoque[itemKey]) { painel.hidden = true; return; }
    var s = estoque[itemKey];
    painel.hidden = false;
    el('itemTitulo').textContent = (s.materialCodigo || itemKey) + ' — ' + (s.materialNome || '');
    el('itemResumo').textContent = 'Saldo total ' + num(s.saldoAtual) + ' ' + (s.unidade || '') + '. Trocar o dono não muda este total.';
    el('donos').innerHTML = donosDoItem().map(function(x, i) {
      var inconsistente = x.semLote < 0;
      return '<tr><td>' + tagDono(x.dono) + '</td><td class="num">' + num(x.saldo) + '</td><td class="num">' + num(x.emLotes) + '</td><td class="num"' + (inconsistente ? ' style="color:#b42318" title="Os lotes somam mais que o saldo deste dono"' : '') + '>' + num(x.semLote) + '</td><td>' +
        (x.semLote > 0 ? '<button type="button" class="tt-link" data-sem-lote="' + i + '">trocar o saldo sem lote</button>' : '') + '</td></tr>';
    }).join('');
    var ls = lotesDoItem().sort(function(a, b) { return String(a.loteInterno || a.key).localeCompare(String(b.loteInterno || b.key)); });
    el('lotes').innerHTML = ls.length ? ls.map(function(l) {
      var d = l.destino || {};
      return '<tr><td><b>' + e(l.loteInterno || l.key) + '</b></td><td>' + e(l.enderecoCodigo || '—') + '</td><td class="num">' + num(l.saldoLote) + ' ' + e(l.unidade || '') + '</td><td>' + tagStatus(l.status) + '</td><td>' + tagDono(PE.donoDoLote(l)) + '</td><td>' +
        (d.clienteNome ? e(d.clienteNome) + ((d.pedidos || []).length ? ' · ' + e(d.pedidos.join(', ')) : '') : '—') + '</td><td><button type="button" class="tt-link" data-lote="' + e(l.key) + '">alterar titularidade</button></td></tr>';
    }).join('') : '<tr><td colspan="7">Este item não tem lote com saldo (todo o saldo está sem endereço).</td></tr>';
    el('donos').querySelectorAll('[data-sem-lote]').forEach(function(b) { b.onclick = function() { var x = donosDoItem()[Number(b.dataset.semLote)]; abrirModal({loteKey: null, donoAtual: x.dono, max: x.semLote}); }; });
    el('lotes').querySelectorAll('[data-lote]').forEach(function(b) { b.onclick = function() { var l = lotes[itemKey][b.dataset.lote]; abrirModal({loteKey: b.dataset.lote, donoAtual: PE.donoDoLote(l), max: Number(l.saldoLote)}); }; });
  }

  /* ── 3. A troca ── */
  function novaChave() {
    var c = window.crypto && crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
    return 'tt-' + c;
  }
  function abrirModal(alvo) {
    var op = novaChave(), ocupado = false;
    var opcoes = '<option value="KURYOS"' + (alvo.donoAtual.tipo === 'KURYOS' ? ' disabled' : '') + '>Kuryos (estoque geral)</option>' + Object.keys(clientes).sort(function(a, b) { return nomeCliente(a).localeCompare(nomeCliente(b), 'pt-BR'); }).map(function(k) {
      var igual = alvo.donoAtual.tipo === 'CLIENTE' && alvo.donoAtual.clienteKey === k;
      return '<option value="' + e(k) + '"' + (igual ? ' disabled' : '') + '>' + e(nomeCliente(k)) + '</option>';
    }).join('');
    var fundo = document.createElement('div');
    fundo.className = 'tt-fundo';
    fundo.innerHTML = '<div class="tt-modal" role="dialog" aria-label="Alterar titularidade"><h2>Alterar titularidade</h2>' +
      '<p class="sub">' + e(estoque[itemKey].materialCodigo || itemKey) + ' · ' + (alvo.loteKey ? 'lote ' + e((lotes[itemKey][alvo.loteKey] || {}).loteInterno || alvo.loteKey) : 'saldo sem lote') + ' · hoje de ' + tagDono(alvo.donoAtual) + '</p>' +
      '<label for="ttQtd">Quantidade (máx. ' + num(alvo.max) + ')</label><input id="ttQtd" type="text" inputmode="decimal" value="' + e(alvo.max) + '">' +
      '<label for="ttDono">Novo dono</label><select id="ttDono"><option value="">Escolha…</option>' + opcoes + '</select>' +
      '<label for="ttMotivo">Motivo (obrigatório)</label><textarea id="ttMotivo" rows="2" maxlength="300" placeholder="Ex.: cliente assumiu a compra da caixa; NF de remessa 1234"></textarea>' +
      '<div id="ttResumo" class="tt-resumo">Escolha o novo dono.</div>' +
      '<div class="tt-acoes"><button type="button" class="tt-btn ghost" id="ttCancelar">Cancelar</button><button type="button" class="tt-btn" id="ttConfirmar" disabled>Alterar titularidade</button></div></div>';
    document.body.appendChild(fundo);
    function fechar() { if (fundo.parentNode) fundo.parentNode.removeChild(fundo); }
    function dados() {
      var v = el('ttDono').value;
      return {itemKey: itemKey, loteKey: alvo.loteKey, donoAtual: alvo.donoAtual, qtd: el('ttQtd').value, motivo: el('ttMotivo').value,
        novoDono: v === 'KURYOS' ? {tipo: 'KURYOS'} : (v ? {tipo: 'CLIENTE', clienteKey: v} : {}), operacaoKey: op};
    }
    function previa() {
      var box = el('ttResumo'), btn = el('ttConfirmar');
      if (!el('ttDono').value) { box.className = 'tt-resumo'; box.textContent = 'Escolha o novo dono.'; btn.disabled = true; return; }
      try {
        var p = T.preparar({estoque: estoque, estoque_lotes: lotes, clientes: clientes}, Object.assign(dados(), {movKey: 'previa-0001', novoLoteKey: 'previa-0002'}), {autor: autor(), agora: new Date().toISOString()});
        box.className = 'tt-resumo'; box.innerHTML = '<b>Vai acontecer:</b> ' + e(p.resumo) + (p.parcial ? ' O lote será dividido no mesmo endereço.' : '') + ' O saldo total e o destino do pedido de compra não mudam.';
        btn.disabled = ocupado;
      } catch (err) { box.className = 'tt-resumo erro'; box.textContent = err.message; btn.disabled = true; }
    }
    ['ttQtd', 'ttDono', 'ttMotivo'].forEach(function(id) { el(id).addEventListener('input', previa); el(id).addEventListener('change', previa); });
    el('ttCancelar').onclick = fechar;
    el('ttConfirmar').onclick = function() {
      if (ocupado) return;
      ocupado = true; el('ttConfirmar').disabled = true; el('ttConfirmar').textContent = 'Alterando…';
      Promise.resolve().then(function() { return firebase.functions().httpsCallable('alterarTitularidadeEstoque')(dados()); })
        .then(function(r) { fechar(); aviso('✓ ' + e((r.data && r.data.resumo) || 'Titularidade alterada.') + (r.data && r.data.ja ? ' (já estava feita)' : ''), 'ok'); })
        .catch(function(err) { ocupado = false; el('ttConfirmar').textContent = 'Alterar titularidade'; var box = el('ttResumo'); box.className = 'tt-resumo erro'; box.textContent = 'Não foi possível: ' + (err.message || 'erro'); el('ttConfirmar').disabled = false; });
    };
    previa();
    el('ttDono').focus();
  }

  /* ── Últimas trocas ── */
  function renderHistorico() {
    var lista = [];
    Object.keys(estoque).forEach(function(k) {
      var t = (estoque[k] || {}).trocasTitularidade || {};
      Object.keys(t).forEach(function(ok) { lista.push(Object.assign({item: (estoque[k] || {}).materialCodigo || k}, t[ok])); });
    });
    lista.sort(function(a, b) { return String(b.em).localeCompare(String(a.em)); });
    el('historico').innerHTML = lista.length ? lista.slice(0, 15).map(function(t) {
      return '<tr><td>' + dataHora(t.em) + '</td><td><b>' + e(t.item) + '</b>' + (t.semLote ? ' <span class="sub">(sem lote)</span>' : '') + '</td><td class="num">' + num(t.qtd) + '</td><td>' + e(nomeDono(t.de || {})) + ' → <b>' + e(nomeDono(t.para || {})) + '</b></td><td>' + e(t.motivo) + '</td><td>' + e(t.por) + '</td></tr>';
    }).join('') : '<tr><td colspan="6">Nenhuma troca registrada ainda.</td></tr>';
  }

  function render() { if (!pronto()) return; renderBusca(); renderItem(); renderHistorico(); }
  el('busca').addEventListener('input', renderBusca);
  dbOnValue(db.ref('estoque'), function(s) { estoque = s.val() || {}; carregado.estoque = true; render(); });
  dbOnValue(db.ref('estoque_lotes'), function(s) { lotes = s.val() || {}; carregado.lotes = true; render(); });
  dbOnValue(db.ref('clientes'), function(s) { clientes = s.val() || {}; carregado.clientes = true; render(); });
  var pre = new URLSearchParams(location.search).get('item');
  if (pre) { itemKey = pre; }
})();
