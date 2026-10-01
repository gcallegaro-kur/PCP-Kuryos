/* ══════════════════════════════════════════════════════════════════════
   ETIQUETA DE CAIXA DE EMBARQUE — padrão Kuryos (01/10/2026)

   Pedido do usuário: "um padrão de etiqueta a ser impressa junto com a
   emissão da OP, para serem coladas nas caixas. Os campos devem conter,
   obrigatoriamente, nesta ordem":
     1. logo ou nome do cliente      5. lote                  9. código de
     2. nome do SKU (cadastro)       6. validade                 barras DUN-14
     3. código do cliente            7. peso da caixa
     4. quantidade por caixa         8. lote interno
   "Essas etiquetas servem para identificação da caixa produzida, que será
   expedida."

   Decisões:
   - LOTE é o lote que vai impresso no produto. Por padrão é o próprio lote
     da OP; quando o cliente usa codificação própria, informa-se uma vez
     (fica gravado na OP como `loteCliente`). LOTE INTERNO é sempre o lote
     da OP (rastreio Kuryos).
   - DUN-14 é desenhado em ITF-14 (GS1, Interleaved 2 of 5), com barras de
     proteção em cima e embaixo. Módulo de 0,5 mm e razão 2,5 -- dá número
     inteiro de pontos na térmica de 203 dpi (4 e 10 pontos), sem
     arredondamento torto na impressão.
   - Campo obrigatório que falta no cadastro NÃO some da etiqueta: sai a
     linha em branco para escrever à mão, e o diálogo avisa onde corrigir.
     Nada é inventado (DUN-14 não é derivado do EAN: o dígito indicador é
     do dono da marca).
   - Quantidade na OP é planejada; a produção real varia. Por isso as caixas
     cheias levam a quantidade/peso do cadastro e a caixa PARCIAL sai com
     quantidade e peso em branco, para preencher na hora de fechar.

   No navegador, usa um `db` do Firebase para buscar o cliente (logo). Funções de dados e desenho são puras.
   ══════════════════════════════════════════════════════════════════════ */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EtiquetaCaixa = api;
})(typeof window !== 'undefined' ? window : this, function() {
  'use strict';

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function positivo(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return n > 0 ? n : 0; }
  function numBR(n, casas) { return Number(n).toLocaleString('pt-BR', {minimumFractionDigits: casas || 0, maximumFractionDigits: casas == null ? 3 : casas}); }

  /* ── ITF-14 (DUN-14) ── */
  // Interleaved 2 of 5: cada dígito = 5 elementos, 2 largos (W) e 3 estreitos (N).
  var ITF = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];
  var ITF_RAZAO = 2.5, ITF_QUIET = 10;
  // Dígito verificador GS1 (mesmo do EAN-13): pesos 3,1,3,1... a partir da esquerda em 13 dígitos.
  function gs1Verificador(treze) {
    var soma = 0;
    for (var i = 0; i < 13; i++) soma += parseInt(treze[i], 10) * (i % 2 === 0 ? 3 : 1);
    return String((10 - (soma % 10)) % 10);
  }
  // 14 dígitos com verificador certo, ou 13 (calcula). Qualquer outra coisa: null.
  function dun14Normalizar(codigo) {
    var s = String(codigo || '').replace(/\D/g, '');
    if (s.length === 13) s += gs1Verificador(s);
    if (s.length !== 14) return null;
    return gs1Verificador(s.slice(0, 13)) === s[13] ? s : null;
  }
  // Largura total em módulos (quiet zones incluídas).
  function itf14Modulos() {
    return 2 * ITF_QUIET + 4 + 14 * (3 + 2 * ITF_RAZAO) + (ITF_RAZAO + 2);
  }
  function itf14Svg(codigo, alturaMm, moduloMm) {
    var s = dun14Normalizar(codigo);
    if (!s) return '';
    var X = moduloMm || 0.5, W = X * ITF_RAZAO, h = alturaMm || 14;
    var bearer = Math.max(2 * X, 0.8); // barra de proteção (GS1: ≥ 2 módulos)
    var largura = itf14Modulos() * X, x = ITF_QUIET * X, y = bearer, alt = h - 2 * bearer;
    var rects = [];
    function barra(w) { rects.push('<rect x="' + x.toFixed(3) + '" y="' + y.toFixed(3) + '" width="' + w.toFixed(3) + '" height="' + alt.toFixed(3) + '"/>'); x += w; }
    function espaco(w) { x += w; }
    barra(X); espaco(X); barra(X); espaco(X); // início: n n n n
    for (var i = 0; i < 14; i += 2) {
      var b = ITF[+s[i]], e = ITF[+s[i + 1]];
      for (var k = 0; k < 5; k++) {
        barra(b[k] === 'w' ? W : X);
        espaco(e[k] === 'w' ? W : X);
      }
    }
    barra(W); espaco(X); barra(X); // fim: W n n
    rects.push('<rect x="0" y="0" width="' + largura.toFixed(3) + '" height="' + bearer.toFixed(3) + '"/>');
    rects.push('<rect x="0" y="' + (h - bearer).toFixed(3) + '" width="' + largura.toFixed(3) + '" height="' + bearer.toFixed(3) + '"/>');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + largura.toFixed(2) + 'mm" height="' + h + 'mm" viewBox="0 0 ' + largura.toFixed(3) + ' ' + h + '" fill="#000">' + rects.join('') + '</svg>';
  }
  // "1 79 08420 11681 6" -- agrupamento usual do DUN-14 impresso.
  function dun14Texto(s) { return s ? s[0] + ' ' + s.slice(1, 3) + ' ' + s.slice(3, 8) + ' ' + s.slice(8, 13) + ' ' + s[13] : ''; }

  /* ── Dados ── */
  function validadeTexto(v) {
    if (!v) return '';
    var m = String(v).match(/^(\d{4})-(\d{2})/);
    if (m) return m[2] + '/' + m[1];
    var d = new Date(v);
    return isNaN(d) ? String(v) : ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
  }

  /* Junta OP + cadastro do produto + cliente. A OP guarda uma fotografia do
     cadastro na emissão; o que estiver vazio nela vem do cadastro atual
     (cadastro corrigido depois da emissão passa a valer na reimpressão). */
  function dados(op, produto, cliente) {
    op = op || {}; produto = produto || {}; cliente = cliente || {};
    var dun = dun14Normalizar(op.dum14 || produto.dum14 || '');
    var d = {
      clienteNome: op.cliente || produto.cliente || cliente.nome || '',
      logoUrl: cliente.logoEtiquetaUrl || '',
      produtoNome: op.produto || produto.descricao || '',
      codCliente: op.codCliente || produto.codCliente || '',
      qtdCaixa: parseInt(op.pecasPorCaixa || produto.unCx, 10) || 0,
      lote: op.loteCliente || op.lote || '',
      validade: validadeTexto(op.validade),
      pesoCaixaKg: positivo(op.kgCaixa) || positivo(produto.kgCaixa),
      loteInterno: op.lote || '',
      dun14: dun || '',
      dun14Invalido: !dun && !!String(op.dum14 || produto.dum14 || '').trim(),
      sku: op.sku || produto.sku || '',
      ean13: op.ean13 || produto.ean13 || ''
    };
    return d;
  }

  // Campos obrigatórios ausentes, com onde corrigir.
  function faltando(d) {
    var f = [];
    if (!d.clienteNome) f.push('Cliente (Cadastros › Produtos)');
    if (!d.produtoNome) f.push('Nome do SKU');
    if (!d.codCliente) f.push('Código do cliente (Cadastros › Produtos › Cód. Cliente)');
    if (!d.qtdCaixa) f.push('Quantidade por caixa (Cadastros › Produtos › Embalagem)');
    if (!d.lote) f.push('Lote');
    if (!d.validade) f.push('Validade');
    if (!d.pesoCaixaKg) f.push('Peso da caixa (Cadastros › Produtos › Embalagem)');
    if (!d.dun14) f.push(d.dun14Invalido ? 'DUN-14 com dígito verificador errado (Cadastros › Produtos › Códigos de Barras)' : 'DUN-14 (Cadastros › Produtos › Códigos de Barras)');
    return f;
  }

  // Sugestão de quantas etiquetas: caixas cheias + 1 parcial se sobrar.
  function sugestaoQuantidade(qtdPlanejada, qtdCaixa) {
    var q = parseInt(qtdPlanejada, 10) || 0, c = parseInt(qtdCaixa, 10) || 0;
    if (!c || !q) return {cheias: 1, parcial: 0};
    return {cheias: Math.floor(q / c), parcial: q % c ? 1 : 0};
  }

  /* ── Desenho ── */
  var FORMATOS = {
    // Padrão Kuryos de caixa (o mesmo papel da etiqueta anterior).
    '90x55': {pagina: '90mm 55mm', largura: 90, altura: 55, rotulo: '90 × 55 mm (padrão)', barraAlt: 12, logoAlt: 9, escala: 1},
    // Térmica 100 x 70 mm (a mesma do palete e do recebimento).
    '100x70': {pagina: '100mm 70mm', largura: 100, altura: 70, rotulo: '100 × 70 mm (térmica)', barraAlt: 20, logoAlt: 13, escala: 1.25}
  };

  function campo(rotulo, valor, classe) {
    var vazio = valor === '' || valor == null;
    return '<div class="c' + (classe ? ' ' + classe : '') + '"><b>' + rotulo + '</b><span class="' + (vazio ? 'vz' : '') + '">' + (vazio ? '&nbsp;' : esc(valor)) + '</span></div>';
  }

  // Uma etiqueta. parcial = caixa parcial (quantidade/peso em branco).
  function cartao(d, parcial, fmt) {
    fmt = fmt || FORMATOS['90x55'];
    var cab = d.logoUrl
      ? '<img class="logo" src="' + esc(d.logoUrl) + '" alt="' + esc(d.clienteNome) + '">'
      : '<div class="cli">' + esc(d.clienteNome || ' ') + '</div>';
    var qtd = parcial ? '' : (d.qtdCaixa ? numBR(d.qtdCaixa) + ' un' : '');
    var peso = parcial ? '' : (d.pesoCaixaKg ? numBR(d.pesoCaixaKg, 2) + ' kg' : '');
    var barra = itf14Svg(d.dun14, fmt.barraAlt, 0.5);
    return '<section class="etq">' +
      '<div class="topo">' + cab + (parcial ? '<span class="tag">CAIXA PARCIAL</span>' : '') + '</div>' +
      '<div class="prod">' + esc(d.produtoNome) + '</div>' +
      '<div class="grade">' +
        campo('Cód. cliente', d.codCliente) +
        campo('Qtde / caixa', qtd) +
        campo('Lote', d.lote, 'forte') +
        campo('Validade', d.validade, 'forte') +
        campo('Peso da caixa', peso) +
        campo('Lote interno', d.loteInterno) +
      '</div>' +
      '<div class="dun">' + (barra || '<div class="semdun">DUN-14 não cadastrado</div>') +
        '<div class="dtx">' + (d.dun14 ? 'DUN-14 ' + dun14Texto(d.dun14) : '&nbsp;') + '</div></div>' +
      '<div class="rod">SKU ' + esc(d.sku || '—') + (d.ean13 ? ' · EAN ' + esc(d.ean13) : '') + ' · Fabricado por Kuryos</div>' +
    '</section>';
  }

  function css(fmt) {
    var e = fmt.escala;
    function pt(v) { return (v * e).toFixed(2) + 'pt'; }
    return '@page{size:' + fmt.pagina + ';margin:0}' +
      'body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#000;background:#fff}' +
      '.etq{width:' + fmt.largura + 'mm;height:' + fmt.altura + 'mm;box-sizing:border-box;padding:2.5mm 3mm 1.8mm;display:flex;flex-direction:column;overflow:hidden;page-break-after:always;break-after:page}' +
      '.etq:last-child{page-break-after:auto;break-after:auto}' +
      '.topo{display:flex;justify-content:space-between;align-items:center;gap:2mm;height:' + fmt.logoAlt + 'mm;border-bottom:.35mm solid #000;padding-bottom:.8mm;flex:none}' +
      '.logo{height:100%;width:auto;max-width:60%;object-fit:contain;object-position:left center;display:block}' +
      '.cli{font-size:' + pt(13) + ';font-weight:bold;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}' +
      '.tag{font-size:' + pt(7.5) + ';font-weight:bold;background:#000;color:#fff;padding:.4mm 1.5mm;border-radius:1mm;white-space:nowrap}' +
      '.prod{font-size:' + pt(9.5) + ';font-weight:bold;line-height:1.12;margin:1mm 0 .8mm;max-height:2.3em;overflow:hidden;flex:none}' +
      '.grade{display:grid;grid-template-columns:1fr 1fr 1fr;gap:.6mm 2mm;flex:none}' +
      '.c{min-width:0}.c b{display:block;font-size:' + pt(5.6) + ';font-weight:normal;text-transform:uppercase;letter-spacing:.2px;color:#000}' +
      '.c span{display:block;font-size:' + pt(8.6) + ';font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.15}' +
      '.c.forte span{font-size:' + pt(10) + '}' +
      '.c span.vz{border-bottom:.3mm solid #000;height:1.1em}' +
      '.dun{margin-top:auto;text-align:center;flex:none}' +
      '.dun svg{display:block;margin:0 auto}' +
      '.semdun{height:' + fmt.barraAlt + 'mm;border:.3mm dashed #000;display:flex;align-items:center;justify-content:center;font-size:' + pt(7) + '}' +
      '.dtx{font-size:' + pt(7.2) + ';letter-spacing:.6px;line-height:1.2;margin-top:.3mm}' +
      '.rod{font-size:' + pt(5.4) + ';text-align:center;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '@media screen{body{background:#e9e9e9;padding:10px}.etq{background:#fff;margin:0 auto 10px;box-shadow:0 0 0 1px #bbb}}';
  }

  /* HTML de uma folha: `cheias` etiquetas normais + `parcial` em branco. */
  function pagina(d, opcoes) {
    opcoes = opcoes || {};
    var fmt = FORMATOS[opcoes.formato] || FORMATOS['90x55'];
    var cheias = Math.max(0, parseInt(opcoes.cheias, 10) || 0), parcial = Math.max(0, parseInt(opcoes.parcial, 10) || 0);
    var cards = [];
    for (var i = 0; i < cheias; i++) cards.push(cartao(d, false, fmt));
    for (var j = 0; j < parcial; j++) cards.push(cartao(d, true, fmt));
    return '<style>' + css(fmt) + '</style>' + cards.join('');
  }

  // Abre a impressão numa janela própria. Espera o logo carregar antes de
  // chamar o print (senão a primeira etiqueta sai sem logo). false = pop-up bloqueado.
  function imprimir(d, opcoes, titulo) {
    var w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return false;
    w.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>' + esc(titulo || 'Etiquetas de caixa') + '</title></head><body>' + pagina(d, opcoes) +
      '<script>(function(){var imgs=[].slice.call(document.images),n=imgs.length,feito=false;' +
      'function ir(){if(feito)return;feito=true;setTimeout(function(){window.print()},50)}' +
      'if(!n)return window.addEventListener("load",ir);' +
      'imgs.forEach(function(i){if(i.complete)--n;else{i.onload=i.onerror=function(){if(--n<=0)ir()}}});' +
      'if(n<=0)window.addEventListener("load",ir);setTimeout(ir,4000)})()<\/script></body></html>');
    w.document.close();
    return true;
  }

  /* ── Diálogo (navegador) ──
     abrirDialogo({op, opKey, produto, db, aviso}) -- mostra pré-visualização,
     campos que faltam, formato, quantidade e lote do cliente; imprime. */
  function abrirDialogo(cfg) {
    var doc = document, op = cfg.op || {}, db = cfg.db;
    var antigo = doc.getElementById('etqCxDlg'); if (antigo) antigo.remove();
    var bg = doc.createElement('div');
    bg.id = 'etqCxDlg';
    bg.setAttribute('style', 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px');
    bg.innerHTML = '<div role="dialog" aria-modal="true" aria-labelledby="etqCxTit" style="background:var(--surface,#fff);color:var(--text,#111);border-radius:10px;max-width:760px;width:100%;max-height:94vh;overflow:auto;padding:18px;box-shadow:0 10px 40px rgba(0,0,0,.3)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h3 id="etqCxTit" style="margin:0;font-size:17px">🏷️ Etiquetas de caixa — lote ' + esc(op.lote || '') + '</h3>' +
      '<button type="button" id="etqCxFechar" class="btn btn-ghost" aria-label="Fechar">✕</button></div>' +
      '<div id="etqCxAviso" style="margin:10px 0;font-size:13px">Carregando cadastro…</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;font-size:13px">' +
        '<label>Formato<select id="etqCxFmt" style="width:100%;margin-top:3px"></select></label>' +
        '<label>Caixas cheias<input id="etqCxCheias" type="number" min="0" step="1" style="width:100%;margin-top:3px"></label>' +
        '<label>Caixa parcial (em branco)<input id="etqCxParcial" type="number" min="0" step="1" style="width:100%;margin-top:3px"></label>' +
        '<label>Lote (impresso no produto)<input id="etqCxLote" type="text" style="width:100%;margin-top:3px" maxlength="30"></label>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text-muted,#666);margin-top:4px">Lote interno é sempre o lote da OP. Mude o lote só se o cliente usa codificação própria — fica gravado na OP.</div>' +
      '<div style="margin-top:12px;background:#e9e9e9;border-radius:8px;padding:10px;display:flex;justify-content:center"><iframe id="etqCxPrev" title="Pré-visualização da etiqueta" style="border:0;background:transparent;width:100%;height:290px"></iframe></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap"><span id="etqCxTotal" style="margin-right:auto;align-self:center;font-size:13px"></span>' +
      '<button type="button" class="btn btn-ghost" id="etqCxCancelar">Cancelar</button><button type="button" class="btn btn-primary" id="etqCxImprimir" disabled>🖨 Imprimir</button></div></div>';
    doc.body.appendChild(bg);
    function $(id) { return doc.getElementById(id); }
    function fechar() { bg.remove(); }
    $('etqCxFechar').onclick = fechar; $('etqCxCancelar').onclick = fechar;
    bg.addEventListener('click', function(e) { if (e.target === bg) fechar(); });
    Object.keys(FORMATOS).forEach(function(k) { var o = doc.createElement('option'); o.value = k; o.textContent = FORMATOS[k].rotulo; $('etqCxFmt').appendChild(o); });
    try { var salvo = localStorage.getItem('etqCaixaFormato'); if (salvo && FORMATOS[salvo]) $('etqCxFmt').value = salvo; } catch (e) { /* sem storage */ }

    var produto = cfg.produto || null, cliente = null, d = null;
    function render() {
      if (!d) return;
      var dd = Object.assign({}, d, {lote: $('etqCxLote').value.trim() || d.loteInterno});
      var opc = {formato: $('etqCxFmt').value, cheias: 1, parcial: 0};
      var fmt = FORMATOS[opc.formato];
      var prev = $('etqCxPrev');
      prev.srcdoc = '<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent;display:flex;justify-content:center">' + pagina(dd, opc) +
        '<style>@media screen{body{padding:0!important;background:transparent!important}.etq{margin:0!important;transform:scale(' + (270 / (fmt.altura * 3.78)).toFixed(3) + ');transform-origin:top center}}</style></body>';
      var total = (parseInt($('etqCxCheias').value, 10) || 0) + (parseInt($('etqCxParcial').value, 10) || 0);
      $('etqCxTotal').textContent = total + ' etiqueta' + (total === 1 ? '' : 's');
      $('etqCxImprimir').disabled = !total;
    }
    ['etqCxFmt', 'etqCxCheias', 'etqCxParcial', 'etqCxLote'].forEach(function(id) { $(id).addEventListener('input', render); });

    function carregar() {
      var pProd = produto ? Promise.resolve(produto) : Promise.resolve(null);
      return pProd.then(function(p) {
        produto = p || {};
        var cliKey = produto.clienteKey || op.clienteKey;
        if (!db || !cliKey) return null;
        return db.ref('clientes/' + cliKey).once('value').then(function(s) { return s.val(); }).catch(function() { return null; });
      }).then(function(c) {
        cliente = c || {};
        d = dados(op, produto, cliente);
        var sug = sugestaoQuantidade(op.qtdPlanejada, d.qtdCaixa);
        $('etqCxCheias').value = sug.cheias; $('etqCxParcial').value = sug.parcial;
        $('etqCxLote').value = op.loteCliente || '';
        $('etqCxLote').placeholder = op.lote || '';
        var f = faltando(d);
        $('etqCxAviso').innerHTML = (cfg.aviso ? '<div style="margin-bottom:6px">' + esc(cfg.aviso) + '</div>' : '') + (f.length
          ? '<div style="background:#fff4e5;color:#7a4b00;border:1px solid #f0c27a;border-radius:6px;padding:8px 10px"><b>Faltando no cadastro — sai em branco para preencher à mão:</b><ul style="margin:4px 0 0 18px;padding:0">' + f.map(function(x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>'
          : '<div style="background:#e8f6ec;color:#1d6b35;border:1px solid #9fd5b0;border-radius:6px;padding:8px 10px">✓ Todos os campos obrigatórios preenchidos.</div>') +
          (!d.logoUrl ? '<div style="font-size:12px;margin-top:6px;color:var(--text-muted,#666)">Sem logo do cliente: sai o nome. Para usar o logo, envie em Cadastros › Clientes.</div>' : '');
        render();
      });
    }

    $('etqCxImprimir').onclick = function() {
      var formato = $('etqCxFmt').value;
      try { localStorage.setItem('etqCaixaFormato', formato); } catch (e) { /* sem storage */ }
      var loteDigitado = $('etqCxLote').value.trim();
      var loteCliente = loteDigitado && loteDigitado !== op.lote ? loteDigitado : '';
      var dd = Object.assign({}, d, {lote: loteCliente || d.loteInterno});
      var ok = imprimir(dd, {formato: formato, cheias: $('etqCxCheias').value, parcial: $('etqCxParcial').value}, 'Etiquetas ' + (op.lote || '') + ' - ' + (d.produtoNome || ''));
      if (!ok) { alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente de novo.'); return; }
      // Lote do cliente fica gravado na OP para a reimpressão sair igual.
      if (db && cfg.opKey && (loteCliente || '') !== (op.loteCliente || '')) {
        db.ref('ops/' + cfg.opKey + '/loteCliente').set(loteCliente || null).then(function() { op.loteCliente = loteCliente; })
          .catch(function() { alert('Etiquetas enviadas, mas não consegui gravar o lote do cliente na OP (sem permissão?).'); });
      }
      fechar();
    };
    return carregar();
  }

  /* Logo do cliente (Cadastros › Clientes): reduz para no máximo 800 x 300 px
     sobre fundo branco (transparência vira preto em algumas térmicas) e
     devolve {blob PNG, preview dataURL}. */
  function prepararLogo(arquivo) {
    return new Promise(function(resolve, reject) {
      if (!arquivo || !/^image\//.test(arquivo.type || '')) return reject(new Error('Escolha um arquivo de imagem (PNG, JPG, WEBP ou SVG).'));
      if (arquivo.size > 10 * 1024 * 1024) return reject(new Error('Imagem maior que 10 MB.'));
      var url = URL.createObjectURL(arquivo), img = new Image();
      img.onload = function() {
        var w = img.naturalWidth || 800, h = img.naturalHeight || 300;
        var k = Math.min(1, 800 / w, 300 / h);
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        var preview = cv.toDataURL('image/png');
        cv.toBlob(function(blob) { blob ? resolve({blob: blob, preview: preview}) : reject(new Error('Não consegui converter a imagem.')); }, 'image/png');
      };
      img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('Não consegui abrir a imagem.')); };
      img.src = url;
    });
  }

  return {
    prepararLogo: prepararLogo,
    dun14Normalizar: dun14Normalizar, gs1Verificador: gs1Verificador, itf14Svg: itf14Svg, itf14Modulos: itf14Modulos,
    dun14Texto: dun14Texto, validadeTexto: validadeTexto,
    dados: dados, faltando: faltando, sugestaoQuantidade: sugestaoQuantidade,
    FORMATOS: FORMATOS, cartao: cartao, pagina: pagina, imprimir: imprimir, abrirDialogo: abrirDialogo
  };
});
