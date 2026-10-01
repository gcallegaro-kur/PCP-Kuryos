'use strict';
/* As etiquetas LEEM? (29/09, pedido do usuário: "temos que aperfeiçoar a
   funcionalidade das etiquetas, não sei se estão bem ajustadas").
   Renderiza cada etiqueta real do sistema no navegador e decodifica os
   códigos com o ZXing -- o mesmo algoritmo de leitura de leitores e apps de
   celular -- em duas resoluções:
     - 8 px/mm  (impressora térmica de 203 dpi);
     - 6 px/mm  (câmera de celular a uns 20 cm).
   Cada código é recortado com a região ao redor (vizinhos incluídos), como
   o leitor enxerga na etiqueta.
   Requer @zxing/library e pngjs: ZXING_DIR=<pasta com node_modules>. */
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = process.env.ZXING_DIR ? path.join(process.env.ZXING_DIR, 'node_modules') : '';
const ZX = require(dir ? path.join(dir, '@zxing/library') : '@zxing/library');
const {PNG} = require(dir ? path.join(dir, 'pngjs') : 'pngjs');

function ler(png, formato) {
  const img = PNG.sync.read(png);
  const lum = new Uint8ClampedArray(img.width * img.height);
  for (let i = 0; i < lum.length; i++) lum[i] = (img.data[i * 4] * 0.299 + img.data[i * 4 + 1] * 0.587 + img.data[i * 4 + 2] * 0.114) | 0;
  const src = new ZX.RGBLuminanceSource(lum, img.width, img.height);
  const hints = new Map([[ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat[formato]]], [ZX.DecodeHintType.TRY_HARDER, true]]);
  try { return new ZX.MultiFormatReader().decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(src)), hints).getText(); } catch (e) { return null; }
}

// Etiquetas a verificar: [nome, função que devolve {html, css}, códigos esperados]
const CASOS = [
  ['Recebimento (lote AK)', 'recebimento', [['CODE_39', 'AK-2026-000576'], ['QR_CODE', 'AK-2026-000576']]],
  // Caixa de embarque (01/10): DUN-14 em ITF-14 (shared/etiqueta-caixa.js).
  ['Caixa da OP', 'caixa', [['ITF', '17908420116816']]],
  ['EAN-13 (utils.js)', 'ean', [['EAN_13', '7899999000015']]],
  ['Endereço (térmica)', 'endereco', [['CODE_39', 'FAB-1.1.1'], ['QR_CODE', 'FAB-1.1.1']]],
  ['Palete de PA', 'palete', [['CODE_39', 'PA-26246-07-P1'], ['QR_CODE', 'PA-26246-07-P1']]],
  ['Endereço (folha A4)', 'endereco-a4', [['CODE_39', 'GAL-12.3.4'], ['QR_CODE', 'GAL-12.3.4']]],
  // A tabela Code39 INTEIRA: '.' e '/' estavam errados até 29/09.
  ['Tabela Code39 (1/2)', 'tabela1', [['CODE_39', '0123456789ABCDEFGHIJKLMN']]],
  ['Tabela Code39 (2/2)', 'tabela2', [['CODE_39', 'OPQRSTUVWXYZ-. $/+%']]]
];

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const resultado = [];
  try {
    for (const escala of [8, 6]) {
      const page = await browser.newPage({deviceScaleFactor: escala / (96 / 25.4), viewport: {width: 700, height: 700}});
      await page.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.hostname !== 'etq.test') return route.fulfill({body: ''});
        const f = 'public/' + u.pathname.slice(1);
        if (u.pathname === '/') return route.fulfill({contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff"><div id="alvo"></div></body>'});
        return route.fulfill({body: fs.readFileSync(f), contentType: f.endsWith('.css') ? 'text/css' : 'text/javascript'});
      });
      await page.emulateMedia({media: 'print'});
      await page.goto('https://etq.test/');
      for (const s of ['shared/utils.js', 'shared/qrcode-lib.js', 'shared/etiquetas-wms.js', 'shared/etiqueta-caixa.js']) if (fs.existsSync('public/' + s)) await page.addScriptTag({url: 'https://etq.test/' + s});
      for (const [nome, tipo, codigos] of CASOS) {
        const html = await page.evaluate(([tipo, cssFichas]) => {
          // O CSS de impressão das fichas de OP só vale para a etiqueta de caixa (sai junto delas).
          if (tipo === 'caixa') return EtiquetaCaixa.pagina(EtiquetaCaixa.dados({cliente: 'MISS RÔSE', produto: 'BODY SPLASH', sku: 'MRARBS04', lote: '26246/07', ean13: '7899999000015', pecasPorCaixa: 24, qtdPlanejada: 24, validade: '2028-09-01', codCliente: 'MR-04', kgCaixa: 6.2, dum14: '17908420116816'}, {}, {}), {cheias: 1});
          if (tipo === 'ean') return '<div style="padding:5mm">' + ean13Svg('7899999000015', 13, 0.4) + '</div>';
          if (!window.EtiquetasWMS) return '';
          if (tipo === 'recebimento') return EtiquetasWMS.pagina('recebimento', [{loteInterno: 'AK-2026-000576', materialCodigo: 'MPGR-001', materialNome: 'ÁLCOOL', loteOrigem: 'F123', fornecedorNome: 'Fornecedor', quantidade: 180, unidade: 'kg', qtdVolumes: 1, dataRecebimento: '2026-09-29', notaFiscal: '123', dataValidade: '2027-06-30', enderecoCodigo: 'DOC-1.1.1'}]);
          if (tipo === 'endereco') return EtiquetasWMS.pagina('endereco', [{codigo: 'FAB-1.1.1', area: 'FÁBRICA', rua: 1, predio: 1, nivel: 1}]);
          if (tipo === 'endereco-a4') return EtiquetasWMS.pagina('endereco-a4', [{codigo: 'GAL-12.3.4', area: 'GALPÃO', rua: 12, predio: 3, nivel: 4}]);
          if (tipo === 'tabela1') return '<div style="padding:5mm">' + code39Svg('0123456789ABCDEFGHIJKLMN', 12, 0.35) + '</div>';
          if (tipo === 'tabela2') return '<div style="padding:5mm">' + code39Svg('OPQRSTUVWXYZ-. $/+%', 12, 0.35) + '</div>';
          if (tipo === 'palete') return EtiquetasWMS.pagina('palete', [{identificadorPalete: 'PA-26246-07-P1', itemCodigo: 'MRARBS04', itemNome: 'BODY SPLASH NÉCTAR', itemTipo: 'produto', opLote: '26246/07', saldoLote: 295, caixasFechadas: 12, unidadesPorCaixa: 24, unidadesCaixaParcial: 7, validade: '2028-09-01', enderecoCodigo: 'FAB-1.1.1', status: 'LIBERADO_EXPEDICAO'}]);
          return '';
        }, [tipo, fs.readFileSync('public/shared/fichas-op.css', 'utf8')]);
        if (!html) { resultado.push({nome, escala, codigo: '-', lido: 'SEM ETIQUETA'}); continue; }
        await page.evaluate((h) => { document.body.innerHTML = h; document.querySelectorAll('style[data-etq]').forEach((x) => x.remove()); }, html);
        const svgs = await page.$$('body svg');
        for (const [formato, esperado] of codigos) {
          let lido = null;
          for (const svg of svgs) {
            // Recorte generoso: o código e o que está em volta (como o leitor vê).
            const b = await svg.boundingBox();
            if (!b || b.width < 5) continue;
            const png = await page.screenshot({clip: {x: Math.max(0, b.x - 12), y: Math.max(0, b.y - 12), width: b.width + 24, height: b.height + 24}});
            const t = ler(png, formato);
            if (t) { lido = t; break; }
          }
          resultado.push({nome, escala, codigo: formato, esperado, lido});
        }
      }
      await page.close();
    }
  } finally { await browser.close(); }
  let falhas = 0;
  resultado.forEach((r) => {
    const ok = r.lido === r.esperado;
    if (!ok) falhas++;
    console.log((ok ? 'LÊ     ' : 'NÃO LÊ ') + r.escala + ' px/mm · ' + r.nome + ' · ' + r.codigo + (ok ? '' : ' (leu: ' + r.lido + ')'));
  });
  if (process.env.SO_MEDIR) return;
  assert.equal(falhas, 0, falhas + ' código(s) não leram');
  console.log('run_etiquetas_leitura_test: todas as etiquetas leem nas duas resoluções');
})().catch((e) => { console.error(e); process.exitCode = 1; });
