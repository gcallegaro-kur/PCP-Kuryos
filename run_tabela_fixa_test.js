'use strict';
/* Cabeçalho congelado (shared/tabela-fixa.js): cada situação de contêiner,
 * medida no navegador — o cabeçalho tem que ficar parado enquanto o corpo rola. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const js = fs.readFileSync(path.join(__dirname, 'public', 'shared', 'tabela-fixa.js'), 'utf8');

const linhas = (n) => Array.from({length: n}, (_, i) => `<tr><td>L${i}</td><td>valor ${i}</td></tr>`).join('');
const tabela = (id, n = 80, estiloTh = '') =>
  `<table id="${id}" style="border-collapse:collapse;width:100%"><thead><tr><th style="${estiloTh}">COL A</th><th style="${estiloTh}">COL B</th></tr></thead><tbody>${linhas(n)}</tbody></table>`;

const pagina = `<!doctype html><html><head><style>
body{margin:0;background:#f5f5f7;font:13px sans-serif}
.card{background:#fff;border-radius:12px;margin:10px}
</style></head><body>
<div style="height:120px">topo</div>
<div id="semWrap">${tabela('t1')}</div>
<div id="hidden" class="card" style="overflow:hidden">${tabela('t2')}</div>
<div id="wrapX" style="overflow-x:auto">${tabela('t3')}</div>
<div id="jaLimitado" style="overflow:auto;max-height:200px">${tabela('t4')}</div>
<div id="transp" class="card">${tabela('t5', 80, 'background:transparent')}</div>
<div id="vazio"></div>
<script>${js}</script></body></html>`;

(async () => {
  const browser = await chromium.launch(process.env.PW_CHANNEL ? {channel: process.env.PW_CHANNEL} : {});
  const page = await browser.newPage({viewport: {width: 1100, height: 700}});
  await page.setContent(pagina);
  await page.waitForTimeout(250);

  const topo = (sel) => page.$eval(sel, (e) => Math.round(e.getBoundingClientRect().top));
  const total = (n) => n;
  let ok = 0;
  const confere = (cond, msg) => { assert.ok(cond, msg); ok++; };

  // 1. Sem contêiner: gruda na janela (top 0) depois de rolar a página.
  await page.evaluate(() => document.getElementById('t1').scrollIntoView());
  await page.evaluate(() => window.scrollBy(0, 400));
  confere((await topo('#t1 th')) === 0, 'sem contêiner: cabeçalho deve ficar em 0 da janela, ficou ' + await topo('#t1 th'));

  // 2. overflow:hidden vira clip (não-rolagem) e o cabeçalho gruda.
  confere(await page.$eval('#hidden', (e) => getComputedStyle(e).overflowY) === 'clip', 'overflow:hidden deveria virar clip');
  await page.evaluate(() => { document.getElementById('t2').scrollIntoView(); window.scrollBy(0, 300); });
  confere((await topo('#t2 th')) === 0, 'card com overflow:hidden: cabeçalho deve ficar em 0, ficou ' + await topo('#t2 th'));

  // 3. overflow-x:auto sem altura: contêiner ganha max-height e rola por dentro.
  const mh = await page.$eval('#wrapX', (e) => e.style.maxHeight);
  confere(/px$/.test(mh), 'contêiner com overflow-x deveria ganhar max-height, tem "' + mh + '"');
  await page.evaluate(() => { document.getElementById('wrapX').scrollIntoView(); });
  const antes = await topo('#t3 th');
  await page.$eval('#wrapX', (e) => { e.scrollTop = 600; });
  const depois = await topo('#t3 th');
  confere(antes === depois, `rolando o contêiner o cabeçalho andou (${antes} -> ${depois})`);
  const linhaVisivel = await page.$eval('#t3 tbody tr:nth-child(40)', (e) => e.getBoundingClientRect().top);
  confere(linhaVisivel > 0, 'o corpo deveria ter rolado por dentro do contêiner');
  const cabecaDoWrap = await page.$eval('#wrapX', (e) => Math.round(e.getBoundingClientRect().bottom));
  confere(cabecaDoWrap <= 700, 'contêiner passou do pé da janela: ' + cabecaDoWrap);

  // 4. Contêiner que já tem max-height: não é mexido.
  confere(await page.$eval('#jaLimitado', (e) => e.style.maxHeight) === '200px', 'max-height próprio foi sobrescrito');

  // 5. th transparente ganha fundo opaco (senão as linhas aparecem por baixo).
  const fundo = await page.$eval('#t5 th', (e) => getComputedStyle(e).backgroundColor);
  confere(fundo === 'rgb(255, 255, 255)', 'th transparente deveria herdar o fundo do card, ficou ' + fundo);

  // 6. Tabela criada depois (innerHTML) entra sozinha.
  await page.evaluate((h) => { document.getElementById('vazio').innerHTML = h; }, `<div style="overflow-x:auto">${tabela('t6')}</div>`);
  await page.waitForTimeout(300);
  confere(await page.$eval('#t6', (e) => e.classList.contains('kt-fixa')), 'tabela dinâmica não foi tratada');
  confere(/px$/.test(await page.$eval('#t6', (e) => e.parentElement.style.maxHeight)), 'contêiner da tabela dinâmica sem max-height');

  // 7. Impressão: nada de sticky nem altura limitada.
  await page.emulateMedia({media: 'print'});
  confere(await page.$eval('#t3 th', (e) => getComputedStyle(e).position) === 'static', 'impressão deveria desligar o sticky');
  confere(await page.$eval('#wrapX', (e) => getComputedStyle(e).maxHeight) === 'none', 'impressão deveria soltar o max-height');
  await page.emulateMedia({media: 'screen'});

  // 8. Redimensionar a janela recalcula.
  await page.setViewportSize({width: 1100, height: 500});
  await page.waitForTimeout(350);
  const mh2 = parseInt(await page.$eval('#wrapX', (e) => e.style.maxHeight), 10);
  confere(mh2 >= 260, 'max-height após resize abaixo do mínimo: ' + mh2);

  // 9. Idempotente: varrer de novo não duplica nem quebra.
  await page.evaluate(() => window.ktTabelaFixa.varrer(document));
  confere(await page.$$eval('[data-kt-fixa-rolagem]', (a) => a.length) === 2, 'esperava 2 contêineres tratados (t3 e t6)');

  await browser.close();
  console.log(`tabela-fixa: ${ok} verificações OK`);
})().catch((e) => { console.error(e); process.exit(1); });
