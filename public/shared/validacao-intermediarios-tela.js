'use strict';
/* Validação da Qualidade dos frascos rotulados (05/10/2026) -- tela, em material_processo.html.
   O PCP só conta o estoque intermediário de frascos rotulados como utilizável depois do LIBERADO
   (ver ConsultaEstoque.estoqueIntermediario). Grava qualidade_intermediarios/{opKey}:
   {status: LIBERADO|REPROVADO|PENDENTE, por, em, qtd, obs}. Quem pode: Qualidade e admin; os outros só veem. */
(function() {
  var db = firebase.database();
  var CE = ConsultaEstoque;
  var D = {ops: null, produtos: null, mp: null, perdas: {}, val: {}};
  function el(id) { return document.getElementById(id); }
  function e(v) { return escapeHtml(String(v == null ? '' : v)); }
  function fmt(n) { return Number(n).toLocaleString('pt-BR', {maximumFractionDigits: 0}); }
  function pode() {
    var u = window.currentUser || {};
    return u.role === 'qualidade' || u.role === 'admin' || (u.modulos && u.modulos.qualidade === true);
  }
  function autor() { return (window.currentUser && (window.currentUser.nome || window.currentUser.email)) || 'Desconhecido'; }

  function render() {
    var box = el('cardValidacao'); if (!box) return;
    if (!D.ops || !D.produtos || D.mp == null) return;
    var ei = CE.estoqueIntermediario({ops: D.ops, produtos: D.produtos, materialProcesso: D.mp, perdas: D.perdas, validacoes: D.val});
    var itens = [];
    ei.linhas.forEach(function(l) { l.ops.forEach(function(o) { if (o.frascos > 0) itens.push({sku: l.sku, produto: l.produto, cliente: l.cliente, o: o}); }); });
    if (!itens.length) { box.hidden = true; return; }
    box.hidden = false;
    var ehQ = pode();
    box.querySelector('tbody').innerHTML = itens.map(function(i) {
      var st = i.o.frascosStatus, tg = st === 'LIBERADO' ? '<span class="tag cheia">Liberado</span>' : st === 'REPROVADO' ? '<span class="tag alerta" style="background:#fee4e2;color:#b42318">Reprovado</span>' : '<span class="tag alerta">Aguardando Qualidade</span>';
      var v = D.val[i.o.opKey], quem = v && v.por ? '<div class="dica">por ' + e(v.por) + (v.em ? ' em ' + new Date(v.em).toLocaleString('pt-BR') : '') + '</div>' : '';
      var acoes = !ehQ ? '<span class="dica">só a Qualidade valida</span>' :
        (st === 'LIBERADO' || st === 'REPROVADO' ? '<button type="button" class="btn sm ghost" data-v="PENDENTE" data-k="' + e(i.o.opKey) + '" data-q="' + i.o.frascos + '">Desfazer</button>' :
          '<button type="button" class="btn sm" data-v="LIBERADO" data-k="' + e(i.o.opKey) + '" data-q="' + i.o.frascos + '">Liberar</button> <button type="button" class="btn sm perigo" data-v="REPROVADO" data-k="' + e(i.o.opKey) + '" data-q="' + i.o.frascos + '">Reprovar</button>');
      return '<tr><td><b>' + e(i.o.lote) + '</b><div class="dica">' + e(i.produto || i.sku) + ' · ' + e(i.cliente) + '</div></td><td class="num"><b>' + fmt(i.o.frascos) + ' un</b><div class="dica">' + e(i.o.origemFrascos) + '</div></td><td>' + tg + quem + '</td><td>' + acoes + '</td></tr>';
    }).join('');
    box.querySelectorAll('[data-v]').forEach(function(b) { b.onclick = function() { gravar(b.getAttribute('data-k'), b.getAttribute('data-v'), Number(b.getAttribute('data-q'))); }; });
  }
  function gravar(opKey, status, qtd) {
    var obs = '';
    if (status === 'REPROVADO') { obs = window.prompt('Motivo da reprovação dos frascos rotulados (obrigatório):') || ''; if (!obs.trim()) return; }
    var ref = db.ref('qualidade_intermediarios/' + opKey);
    var p = status === 'PENDENTE' ? ref.remove() : ref.set({status: status, por: autor(), em: new Date().toISOString(), qtd: qtd, obs: obs.trim()});
    Promise.resolve(p).catch(function(err) { alert('Não foi possível gravar a validação: ' + (err && err.message || err)); });
  }

  dbOnValue(db.ref('ops'), function(s) { D.ops = s.val() || {}; render(); });
  dbOnValue(db.ref('produtos'), function(s) { D.produtos = s.val() || {}; render(); });
  dbOnValue(db.ref('material_processo'), function(s) { D.mp = s.val() || {}; render(); });
  dbOnValue(db.ref('perdas'), function(s) { D.perdas = s.val() || {}; render(); });
  dbOnValue(db.ref('qualidade_intermediarios'), function(s) { D.val = s.val() || {}; render(); });
  window.addEventListener('kuryos-auth-pronto', render);
})();
