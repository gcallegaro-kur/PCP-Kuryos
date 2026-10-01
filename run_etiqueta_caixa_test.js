'use strict';
/* Etiqueta de caixa de embarque (01/10/2026) -- shared/etiqueta-caixa.js.
   Parte 1 (sempre): regras de dados, ordem dos campos, DUN-14.
   Parte 2 (com ZXING_DIR): o ITF-14 desenhado LÊ no ZXing a 8 px/mm (térmica
   203 dpi) e 6 px/mm (celular), nos dois formatos. */
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const E = require('./public/shared/etiqueta-caixa.js');

let ok = 0;
function t(nome, fn) { fn(); ok++; console.log('ok -', nome); }

const OP = {lote: '26273/03', sku: 'HBHD0001', produto: 'HIDRATANTE BISNAGA CELESTIA 200G', cliente: 'HABIBI PERFUMES', pecasPorCaixa: 48, qtdPlanejada: 1750, validade: '2028-09-30T00:00:00.000Z', ean13: '7908420116819'};
const PROD = {sku: 'HBHD0001', descricao: 'HIDRATANTE BISNAGA CELESTIA 200G', cliente: 'HABIBI PERFUMES', clienteKey: 'HBIB', codCliente: 'HP007/A', unCx: 48, kgCaixa: 10.6, dum14: '17908420116816', ean13: '7908420116819'};

t('DUN-14: verificador GS1 confere com cadastro real', () => {
  assert.equal(E.dun14Normalizar('17908420116816'), '17908420116816');
  assert.equal(E.dun14Normalizar('1790842011681'), '17908420116816');
  assert.equal(E.dun14Normalizar('17908420116817'), null);
  assert.equal(E.dun14Normalizar('abc'), null);
  assert.equal(E.dun14Texto('17908420116816'), '1 79 08420 11681 6');
});

t('ITF-14: 7 pares, largura em módulos, barras de proteção', () => {
  const svg = E.itf14Svg('17908420116816', 12, 0.5);
  assert.ok(svg.startsWith('<svg'));
  // início 2 barras + 14 dígitos × 2 barras ÷ 2 (barras só nos dígitos ímpares: 5 por par × 7) + fim 2 + 2 proteções
  assert.equal((svg.match(/<rect/g) || []).length, 2 + 35 + 2 + 2);
  assert.equal(E.itf14Modulos(), 140.5);
  assert.match(svg, /width="70\.25mm"/);
  assert.equal(E.itf14Svg('123', 12, 0.5), '');
});

t('dados: junta OP + cadastro; cadastro corrigido depois vale na reimpressão', () => {
  const d = E.dados(OP, PROD, {nome: 'HABIBI', logoEtiquetaUrl: 'https://x/logo.png'});
  assert.equal(d.clienteNome, 'HABIBI PERFUMES');
  assert.equal(d.codCliente, 'HP007/A');
  assert.equal(d.qtdCaixa, 48);
  assert.equal(d.lote, '26273/03');
  assert.equal(d.loteInterno, '26273/03');
  assert.equal(d.validade, '09/2028');
  assert.equal(d.pesoCaixaKg, 10.6);
  assert.equal(d.dun14, '17908420116816');
  assert.equal(d.logoUrl, 'https://x/logo.png');
  assert.deepEqual(E.faltando(d), []);
});

t('lote do cliente: muda o LOTE, nunca o lote interno', () => {
  const d = E.dados(Object.assign({}, OP, {loteCliente: 'L2609A'}), PROD, {});
  assert.equal(d.lote, 'L2609A');
  assert.equal(d.loteInterno, '26273/03');
});

t('faltando: aponta onde corrigir; DUN com verificador errado é avisado', () => {
  const d = E.dados({lote: '1/01', produto: 'X', cliente: 'C'}, {dum14: '17908420116817'}, {});
  const f = E.faltando(d).join(' | ');
  for (const k of ['Código do cliente', 'Quantidade por caixa', 'Validade', 'Peso da caixa', 'dígito verificador errado']) assert.ok(f.includes(k), k);
});

t('quantidade sugerida: cheias + 1 parcial quando sobra', () => {
  assert.deepEqual(E.sugestaoQuantidade(1750, 48), {cheias: 36, parcial: 1});
  assert.deepEqual(E.sugestaoQuantidade(96, 48), {cheias: 2, parcial: 0});
  assert.deepEqual(E.sugestaoQuantidade(100, 0), {cheias: 1, parcial: 0});
});

t('etiqueta: campos na ordem pedida', () => {
  const html = E.cartao(E.dados(OP, PROD, {}), false);
  const ordem = ['HABIBI PERFUMES', 'HIDRATANTE BISNAGA CELESTIA 200G', 'HP007/A', '48 un', '26273/03', '09/2028', '10,60 kg', 'Lote interno', '1 79 08420 11681 6'];
  let pos = -1;
  for (const k of ordem) { const p = html.indexOf(k, pos + 1); assert.ok(p > pos, 'fora de ordem: ' + k); pos = p; }
});

t('caixa parcial: quantidade e peso em branco, marcada', () => {
  const html = E.cartao(E.dados(OP, PROD, {}), true);
  assert.ok(html.includes('CAIXA PARCIAL'));
  assert.ok(!html.includes('48 un'));
  assert.ok(!html.includes('10,60 kg'));
  assert.equal((html.match(/class="vz"/g) || []).length, 2);
});

t('logo: imagem quando há; nome quando não há; sem DUN mostra o espaço', () => {
  assert.ok(E.cartao(E.dados(OP, PROD, {logoEtiquetaUrl: 'https://x/l.png'})).includes('<img class="logo"'));
  const sem = E.cartao(E.dados(OP, Object.assign({}, PROD, {dum14: ''}), {}));
  assert.ok(sem.includes('<div class="cli">HABIBI PERFUMES</div>'));
  assert.ok(sem.includes('DUN-14 não cadastrado'));
});

t('pagina: n cheias + parcial, formato próprio', () => {
  const html = E.pagina(E.dados(OP, PROD, {}), {formato: '100x70', cheias: 3, parcial: 1});
  assert.equal((html.match(/<section class="etq">/g) || []).length, 4);
  assert.ok(html.includes('size:100mm 70mm'));
  assert.ok(E.pagina(E.dados(OP, PROD, {}), {cheias: 1}).includes('size:90mm 55mm'));
});

(async () => {
  if (!process.env.ZXING_DIR) { console.log(`\n${ok} testes OK (leitura do ITF-14 pulada: defina ZXING_DIR)`); return; }
  const dir = path.join(process.env.ZXING_DIR, 'node_modules');
  const ZX = require(path.join(dir, '@zxing/library'));
  const {PNG} = require(path.join(dir, 'pngjs'));
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  function ler(png, formato) {
    const img = PNG.sync.read(png);
    const lum = new Uint8ClampedArray(img.width * img.height);
    for (let i = 0; i < lum.length; i++) lum[i] = (img.data[i * 4] * 0.299 + img.data[i * 4 + 1] * 0.587 + img.data[i * 4 + 2] * 0.114) | 0;
    const hints = new Map([[ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat[formato]]], [ZX.DecodeHintType.TRY_HARDER, true]]);
    try { return new ZX.MultiFormatReader().decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.RGBLuminanceSource(lum, img.width, img.height))), hints).getText(); } catch (e) { return null; }
  }
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  const shots = process.env.ETQ_SHOTS || '';
  try {
    for (const escala of [8, 6]) {
      const page = await browser.newPage({deviceScaleFactor: escala / (96 / 25.4), viewport: {width: 600, height: 400}});
      await page.emulateMedia({media: 'print'});
      for (const formato of ['90x55', '100x70']) {
        const html = E.pagina(E.dados(OP, PROD, {}), {formato, cheias: 1});
        await page.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0">' + html + '</body>');
        // A etiqueta inteira cabe (nada cortado pelo overflow).
        const cabe = await page.evaluate(() => { const e = document.querySelector('.etq'); return e.scrollHeight <= e.clientHeight + 1 && e.scrollWidth <= e.clientWidth + 1; });
        assert.ok(cabe, `conteúdo transborda a etiqueta ${formato}`);
        const svg = await page.$('.dun svg');
        const b = await svg.boundingBox();
        const png = await page.screenshot({clip: {x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: b.width + 16, height: b.height + 16}});
        assert.equal(ler(png, 'ITF'), '17908420116816', `ITF-14 não leu (${formato}, ${escala} px/mm)`);
        if (shots && escala === 8) fs.writeFileSync(path.join(shots, `etq-caixa-${formato}.png`), await (await page.$('.etq')).screenshot());
        ok++; console.log(`ok - ITF-14 lido (${formato}, ${escala} px/mm) e etiqueta sem corte`);
      }
      await page.close();
    }
  } finally { await browser.close(); }
  console.log(`\n${ok} testes OK`);
})().catch((e) => { console.error(e); process.exit(1); });
