/* ══════════════════════════════════════════════════════════════════════
   ETIQUETAS DO ARMAZÉM (WMS) — recebimento, endereço e palete (29/09)

   Pedido do usuário: "temos que aperfeiçoar a funcionalidade das
   etiquetas, não sei se estão bem ajustadas". Medido com o ZXing
   (run_etiquetas_leitura_test.js), o que estava errado:
   - Code39/EAN sem margem branca lateral (corrigido em utils.js);
   - recebimento: código de barras e QR disputando a mesma faixa, o código
     espremido pelo max-width;
   - palete de produto acabado SEM etiqueta: o código PA-… existia no
     sistema mas nada o imprimia -- a Movimentar não tinha o que ler;
   - endereço: não existia etiqueta de posição.
   Regras daqui:
   - o código de barras ocupa a LARGURA TODA da etiqueta, com o módulo
     calculado para caber (entre 0,25 e 0,50 mm); o QR fica no alto, ao
     lado do texto grande;
   - o mesmo texto que está no código vem escrito grande (quem não tem
     leitor digita);
   - cada tipo tem o seu tamanho de página (térmica), e o endereço também
     sai em folha A4 para quem não tem impressora de etiqueta.
   Depende de code39Svg/code39Modulos/qrCodeSvg (utils.js) e qrcode-lib.js.
   ══════════════════════════════════════════════════════════════════════ */
(function(root) {
  'use strict';
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function num(v) { return Number(v || 0).toLocaleString('pt-BR'); }
  function data(v) { var s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : (v || '—'); }

  // Código de barras que cabe em `larguraMm`, com o módulo mais largo
  // possível até `maxModulo` (barra mais grossa = leitura mais fácil).
  function barras(texto, larguraMm, alturaMm, maxModulo) {
    var modulo = Math.min(maxModulo || 0.5, larguraMm / code39Modulos(texto));
    modulo = Math.max(0.25, Math.floor(modulo * 100) / 100);
    return code39Svg(texto, alturaMm, modulo);
  }

  var FORMATOS = {
    // Térmica 100 x 70 mm (a mesma do recebimento de sempre).
    recebimento: {pagina: '100mm 70mm', largura: 94, altura: 64},
    palete: {pagina: '100mm 70mm', largura: 94, altura: 64},
    // Térmica 100 x 50 mm, uma por posição.
    endereco: {pagina: '100mm 50mm', largura: 94, altura: 44},
    // Folha A4, 2 x 5 por folha, para quem não tem impressora de etiqueta.
    'endereco-a4': {pagina: 'A4', largura: 93, altura: 53, grade: true}
  };

  // Área útil da etiqueta: largura menos 3 mm de margem interna de cada lado
  // e 1 mm de folga -- o código nunca pode ser cortado (perderia a margem branca).
  function util(fmt) { return fmt.largura - 7; }
  function cartaoRecebimento(l, volume, total, fmt) {
    return '<section class="etq"><div class="topo"><div class="tx"><span class="tag q">QUARENTENA</span><div class="big">' + esc(l.loteInterno) + '</div>' +
      '<div class="nome">' + esc(l.materialCodigo) + ' — ' + esc(l.materialNome) + '</div></div>' + qrCodeSvg(l.loteInterno, 20) + '</div>' +
      '<div class="grid"><b>Lote fornecedor</b><span>' + esc(l.loteOrigem || '—') + '</span><b>Fornecedor</b><span>' + esc(l.fornecedorNome || '—') + '</span>' +
      '<b>Quantidade</b><span>' + esc(l.quantidade) + ' ' + esc(l.unidade) + ' · volume ' + volume + ' de ' + total + '</span>' +
      '<b>Receb. / NF</b><span>' + esc(data(l.dataRecebimento)) + ' · ' + esc(l.notaFiscal || '—') + '</span>' +
      '<b>Validade</b><span>' + esc(l.dataValidade ? data(l.dataValidade) : 'Não se aplica') + '</span><b>Endereço</b><span>' + esc(l.enderecoCodigo || '—') + '</span></div>' +
      '<div class="bar">' + barras(l.loteInterno, util(fmt), 10, 0.4) + '</div></section>';
  }
  function composicao(l) {
    var cx = Number(l.caixasFechadas) || 0, m = Number(l.unidadesPorCaixa) || 0, p = Number(l.unidadesCaixaParcial) || 0;
    if (!cx && !p) return '';
    return (cx ? cx + ' cx × ' + m : '') + (cx && p ? ' + ' : '') + (p ? '1 parcial de ' + p : '');
  }
  function cartaoPalete(l, fmt) {
    var id = l.identificadorPalete || l.loteInterno || l.loteOrigem || '';
    var pa = l.itemTipo === 'produto';
    var rotStatus = typeof root.rotuloStatusLote === 'function' ? root.rotuloStatusLote(l.status || '') : (l.status || '');
    return '<section class="etq"><div class="topo"><div class="tx"><span class="tag">' + (pa ? 'PALETE · PRODUTO ACABADO' : 'LOTE · MATERIAL') + '</span><div class="big">' + esc(id) + '</div>' +
      '<div class="nome">' + esc(l.itemCodigo) + ' — ' + esc(l.itemNome || '') + '</div></div>' + qrCodeSvg(id, 20) + '</div>' +
      '<div class="grid"><b>' + (pa ? 'Lote (OP)' : 'Lote') + '</b><span>' + esc(l.opLote || l.loteOrigem || '—') + '</span>' +
      '<b>Quantidade</b><span>' + num(l.saldoLote) + ' ' + esc(l.unidade || (pa ? 'un' : '')) + (composicao(l) ? ' · ' + esc(composicao(l)) : '') + '</span>' +
      '<b>Validade</b><span>' + esc(data(l.validade || l.dataValidade)) + '</span><b>Endereço</b><span>' + esc(l.enderecoCodigo || '—') + '</span>' +
      (rotStatus ? '<b>Situação</b><span>' + esc(rotStatus) + '</span>' : '') + '</div>' +
      '<div class="bar">' + barras(id, util(fmt), 10, 0.4) + '</div></section>';
  }
  function cartaoEndereco(e, fmt) {
    var c = e.codigo || e.key || '';
    return '<section class="etq end"><div class="topo"><div class="tx"><div class="huge">' + esc(c) + '</div>' +
      '<div class="nome">' + esc(e.area || '') + ' · rua ' + esc(e.rua) + ' · prédio ' + esc(e.predio) + ' · nível ' + esc(e.nivel) + '</div></div>' + qrCodeSvg(c, 18) + '</div>' +
      '<div class="bar">' + barras(c, util(fmt), 12, 0.5) + '</div></section>';
  }

  function css(fmt) {
    return '@page{size:' + fmt.pagina + ';margin:' + (fmt.grade ? '10mm 8mm' : '3mm') + '}' +
      'body{font-family:Arial,sans-serif;margin:0;color:#000;background:#fff}' +
      (fmt.grade ? '.folha{display:grid;grid-template-columns:repeat(2,' + fmt.largura + 'mm);grid-auto-rows:' + fmt.altura + 'mm;gap:1mm 2mm}' : '') +
      '.etq{width:' + fmt.largura + 'mm;height:' + fmt.altura + 'mm;box-sizing:border-box;padding:2.5mm 3mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;' +
        (fmt.grade ? 'border:1px dashed #999;' : 'page-break-after:always;break-after:page;') + '}' +
      '.etq:last-child{page-break-after:auto;break-after:auto}' +
      '.topo{display:flex;justify-content:space-between;align-items:flex-start;gap:3mm}.tx{min-width:0;flex:1}' +
      '.big{font-size:19pt;font-weight:bold;letter-spacing:.3px;line-height:1.1;word-break:break-all}.huge{font-size:30pt;font-weight:bold;line-height:1}' +
      '.nome{font-size:8.5pt;margin-top:1mm;line-height:1.2;max-height:2.4em;overflow:hidden}' +
      '.tag{display:inline-block;font-size:7pt;font-weight:bold;border:1px solid #000;border-radius:2mm;padding:.3mm 1.5mm;margin-bottom:1mm}.tag.q{background:#000;color:#fff}' +
      '.grid{display:grid;grid-template-columns:23mm 1fr;gap:.4mm 2mm;font-size:8pt;line-height:1.15}.grid span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}' +
      '.bar{display:flex;justify-content:center}.bar svg{display:block;max-width:none}' +
      '@media screen{body{background:#eee;padding:10px}.etq{background:#fff;margin:0 auto 10px;border:1px solid #bbb}}';
  }

  /* HTML completo de uma folha de etiquetas. tipo: recebimento | palete |
     endereco | endereco-a4. `lista`: lotes (recebimento/palete) ou endereços. */
  function pagina(tipo, lista) {
    var fmt = FORMATOS[tipo] || FORMATOS.palete, cards = [];
    (lista || []).forEach(function(x) {
      if (tipo === 'recebimento') { var tot = Number(x.qtdVolumes) || 1; for (var v = 1; v <= tot; v++) cards.push(cartaoRecebimento(x, v, tot, fmt)); }
      else if (tipo === 'palete') cards.push(cartaoPalete(x, fmt));
      else cards.push(cartaoEndereco(x, fmt));
    });
    return '<style>' + css(fmt) + '</style>' + (fmt.grade ? '<div class="folha">' + cards.join('') + '</div>' : cards.join(''));
  }

  // Abre a janela de impressão. Devolve false se o navegador bloquear pop-up.
  function imprimir(tipo, lista, titulo) {
    var w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return false;
    w.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>' + esc(titulo || 'Etiquetas') + '</title></head><body>' + pagina(tipo, lista) +
      '<script>window.onload=function(){window.print()}<\/script></body></html>');
    w.document.close();
    return true;
  }

  root.EtiquetasWMS = {pagina: pagina, imprimir: imprimir, FORMATOS: FORMATOS};
})(typeof window !== 'undefined' ? window : this);
