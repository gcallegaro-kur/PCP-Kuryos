'use strict';
/* Coerência entre as telas e os módulos de shared/.
 *
 * Por que existe: em 07/10/2026 uma renomeação de módulo
 * (EventosProgramacao -> EventosAuditoria) deixou `planejamento.html` e
 * `horizonte.html` chamando o nome ANTIGO. O padrão de guarda usado no repo,
 *
 *     if (typeof EventosProgramacao === 'undefined') return;
 *
 * transforma isso em falha SILENCIOSA: nenhum erro no console, nenhum dado
 * gravado, a tela funcionando normalmente. Os testes de unidade passavam
 * porque conferiam a tag <script src>, que estava certa -- o errado era o
 * nome do global usado dentro dela.
 *
 * Este teste fecha os dois lados:
 *   1. toda tag <script src="shared/X.js"> aponta para arquivo que existe;
 *   2. todo `typeof Nome` guardado numa tela corresponde a um global que
 *      algum módulo de shared/ realmente exporta.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const DIR_PUB = path.join(RAIZ, 'public');
const DIR_SHARED = path.join(DIR_PUB, 'shared');

let n = 0;
const falhas = [];
function checa(cond, msg) { n++; if (!cond) falhas.push(msg); }

// Cópias de conflito do OneDrive (sufixo -<maquina>) não são telas do app.
const ehConflito = (f) => /-[a-z0-9]+\.html$/i.test(f) && /-gcallegaro|-desktop|conflito|conflict/i.test(f);

// ── 1. Globais exportados pelos módulos UMD de shared/ ─────────────────────
const globais = new Set();
const arquivosShared = fs.readdirSync(DIR_SHARED).filter((f) => f.endsWith('.js'));
arquivosShared.forEach((f) => {
  const src = fs.readFileSync(path.join(DIR_SHARED, f), 'utf8');
  // Padrão UMD do repo:  else root.NomeDoGlobal = factory();
  const m = src.match(/root\.([A-Za-z_$][\w$]*)\s*=\s*factory\(/);
  if (m) globais.add(m[1]);
  // Módulos antigos expõem direto em window/globalThis
  const re = /(?:window|globalThis)\.([A-Z][\w$]*)\s*=/g;
  let x;
  while ((x = re.exec(src))) globais.add(x[1]);
});
checa(globais.size > 0, 'nenhum global de shared/ foi detectado — o detector quebrou');
checa(globais.has('EventosAuditoria'), 'EventosAuditoria deveria ser exportado por shared/eventos-auditoria.js');
checa(globais.has('AuditoriaTela'), 'AuditoriaTela deveria ser exportado por shared/auditoria-tela.js');

// Globais que NÃO vêm de shared/ e são legitimamente guardados por typeof.
const EXTERNOS = new Set([
  'firebase', 'module', 'require', 'exports', 'window', 'globalThis', 'document',
  'localStorage', 'sessionStorage', 'navigator', 'console', 'Promise', 'Intl',
  'ResizeObserver', 'IntersectionObserver', 'crypto', 'structuredClone',
  'BarcodeDetector', 'jspdf', 'JsBarcode', 'QRCode', 'qrcode', 'XLSX', 'Chart',
  'html2canvas', 'JSZip', 'ZXing', 'process'
]);

const htmls = fs.readdirSync(DIR_PUB).filter((f) => f.endsWith('.html') && !ehConflito(f));
checa(htmls.length > 20, 'esperava achar as telas do app em public/');

htmls.forEach((f) => {
  const src = fs.readFileSync(path.join(DIR_PUB, f), 'utf8');

  // ── 2. toda tag <script src="shared/...js"> existe em disco ──
  const reSrc = /<script[^>]+src=["'](shared\/[^"']+\.js)["']/g;
  let s;
  while ((s = reSrc.exec(src))) {
    const rel = s[1];
    checa(fs.existsSync(path.join(DIR_PUB, rel)),
      f + ' carrega ' + rel + ', que NÃO existe — a tela quebra ou o módulo nunca roda');
  }

  // ── 3. todo `typeof Nome` guardado aponta para um global que existe ──
  const reTypeof = /typeof\s+([A-Z][\w$]*)\s*(?:!==|===|!=|==)\s*['"]undefined['"]/g;
  let t;
  while ((t = reTypeof.exec(src))) {
    const nome = t[1];
    if (EXTERNOS.has(nome)) continue;
    checa(globais.has(nome),
      f + ' guarda `typeof ' + nome + "` mas nenhum módulo de shared/ exporta esse nome — " +
      'a guarda vira falha SILENCIOSA: nada grava e nada avisa');
  }

  // ── 4. chamada direta a um global de módulo sem carregar o módulo ──
  // Pega o caso inverso: usa EventosAuditoria.x mas esqueceu a tag <script>.
  globais.forEach((g) => {
    const usa = new RegExp('\\b' + g + '\\s*\\.[a-zA-Z_$]');
    if (!usa.test(src)) return;
    // Acha o arquivo que exporta esse global
    const dono = arquivosShared.find((a) => {
      const m = fs.readFileSync(path.join(DIR_SHARED, a), 'utf8')
        .match(/root\.([A-Za-z_$][\w$]*)\s*=\s*factory\(/);
      return m && m[1] === g;
    });
    if (!dono) return;
    const carrega = new RegExp('src=["\']shared/' + dono.replace('.', '\\.') + '["\']');
    checa(carrega.test(src),
      f + ' usa ' + g + '.* mas não carrega shared/' + dono + ' — o global não existe em tempo de execução');
  });
});

// ── 5. nenhum vestígio dos nomes renomeados em 07/10 ──────────────────────
const ANTIGOS = ['EventosProgramacao', 'AuditoriaProgramacaoTela', 'eventos-programacao', 'eventos_programacao'];
const alvos = [];
['public', 'public/shared', 'functions', '.'].forEach((d) => {
  const abs = path.join(RAIZ, d);
  fs.readdirSync(abs).forEach((f) => {
    if (!/\.(html|js|json)$/.test(f)) return;
    if (ehConflito(f)) return;
    const p = path.join(abs, f);
    if (fs.statSync(p).isFile()) alvos.push(p);
  });
});
ANTIGOS.forEach((velho) => {
  const achou = alvos.filter((p) => {
    if (path.basename(p) === path.basename(__filename)) return false; // este teste cita os nomes
    return fs.readFileSync(p, 'utf8').includes(velho);
  }).map((p) => path.relative(RAIZ, p));
  checa(achou.length === 0, 'nome antigo "' + velho + '" ainda aparece em: ' + achou.join(', '));
});

if (falhas.length) {
  console.error('COERÊNCIA DE MÓDULOS REPROVADA:');
  falhas.forEach((f) => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log('OK coerência de módulos: ' + n + ' verificações — toda tag shared/ existe, todo `typeof` guardado ' +
  'aponta para um global real, todo global usado é carregado, e nenhum nome renomeado sobrou.');
