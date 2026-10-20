/* Cabeçalho de tabela congelado (14/10/2026).
 *
 * Toda tabela com <thead> mantém o cabeçalho visível enquanto o corpo rola.
 * Carregado por auth_check.js em todas as páginas, então tabelas montadas
 * depois (innerHTML) também entram: um MutationObserver reaplica.
 *
 * Por que só `position: sticky` não basta — o cabeçalho gruda no ancestral que
 * rola, e há três situações:
 *   1. Sem ancestral com overflow: gruda na janela. Nada a fazer.
 *   2. Ancestral `overflow: hidden` (card com cantos arredondados): vira
 *      `overflow: clip`, que recorta igual mas NÃO é contêiner de rolagem.
 *   3. Ancestral `overflow-x: auto` (rolagem horizontal) sem altura limitada:
 *      o navegador o trata como contêiner de rolagem que nunca rola na
 *      vertical, e o cabeçalho sai junto com a página. Aqui o contêiner ganha
 *      altura máxima (até o pé da janela), e a rolagem vertical passa a ser dele.
 * Contêiner que já rola na vertical (max-height próprio, modal) fica como está.
 */
(function () {
  'use strict';
  if (window.__ktTabelaFixa) return;
  window.__ktTabelaFixa = true;

  var MARGEM_PE = 16;      // respiro entre o fim do contêiner e o pé da janela
  var ALTURA_MIN = 260;    // não deixa o contêiner virar uma fresta em janela baixa

  var css =
    '.kt-fixa > thead > tr > th, .kt-fixa > thead > tr > td {' +
    ' position: sticky; top: 0; z-index: 3; background-clip: padding-box; }' +
    '.kt-fixa.kt-fixa-sem-fundo > thead > tr > th, .kt-fixa.kt-fixa-sem-fundo > thead > tr > td {' +
    ' background-color: var(--kt-fixa-fundo, #fff) !important; }' +
    '[data-kt-fixa-rolagem] { overflow-y: auto; }' +
    '@media print {' +
    ' .kt-fixa > thead > tr > th, .kt-fixa > thead > tr > td { position: static; }' +
    ' [data-kt-fixa-rolagem] { max-height: none !important; overflow: visible !important; } }';
  var style = document.createElement('style');
  style.setAttribute('data-kt-fixa', '');
  style.textContent = css;
  document.head.appendChild(style);

  function rola(v) { return v === 'auto' || v === 'scroll' || v === 'overlay'; }

  function transparente(cor) {
    return !cor || cor === 'transparent' || /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(cor);
  }

  // Primeira cor de fundo opaca subindo a árvore; cai no painel do tema.
  function fundoVisivel(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var c = getComputedStyle(n).backgroundColor;
      if (!transparente(c)) return c;
    }
    return getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#fff';
  }

  function ajustarContenedor(el, tabela) {
    var cs = getComputedStyle(el);
    // Já rola na vertical por conta própria (max-height, modal, altura fixa).
    if (cs.maxHeight !== 'none' || cs.position === 'fixed') return;
    if (rola(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) return;

    var rect = el.getBoundingClientRect();
    var topoNoDoc = rect.top + window.scrollY;
    // Altura máxima = do topo do contêiner até o pé da janela, medida com a
    // página no topo: não muda enquanto o usuário rola a página.
    var h = Math.max(ALTURA_MIN, window.innerHeight - topoNoDoc - MARGEM_PE);
    el.setAttribute('data-kt-fixa-rolagem', '');
    el.style.maxHeight = h + 'px';
  }

  function prepararTabela(tabela) {
    var thead = tabela.tHead;
    if (!thead || !thead.rows.length) return;
    if (!thead.querySelector('th')) return;

    tabela.classList.add('kt-fixa');

    var th = thead.querySelector('th');
    if (transparente(getComputedStyle(th).backgroundColor)) {
      tabela.classList.add('kt-fixa-sem-fundo');
      tabela.style.setProperty('--kt-fixa-fundo', fundoVisivel(tabela));
    }

    // Sobe pelos ancestrais até achar o primeiro que impede o sticky.
    for (var el = tabela.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      var cs = getComputedStyle(el);
      var ox = cs.overflowX, oy = cs.overflowY;
      if (ox === 'visible' && oy === 'visible') continue;
      if (ox === 'clip' && oy === 'clip') continue;
      if (rola(ox) || rola(oy)) {
        ajustarContenedor(el, tabela);
        return;
      }
      if (ox === 'hidden' || oy === 'hidden') {
        // Recorta sem virar contêiner de rolagem. Só vale se não houver rolagem
        // legítima no outro eixo — nesse caso o laço já teria parado acima.
        el.style.overflow = 'clip';
      }
    }
  }

  function varrer(raiz) {
    var tabelas = (raiz || document).querySelectorAll('table');
    for (var i = 0; i < tabelas.length; i++) {
      var t = tabelas[i];
      if (t.__ktFixa) continue;
      if (!t.tHead) continue;
      t.__ktFixa = true;
      try { prepararTabela(t); } catch (e) { /* cosmético: nunca quebra a tela */ }
    }
  }

  // Altura depende da posição do contêiner e da janela: recalcula nos dois casos.
  function recalcular() {
    var els = document.querySelectorAll('[data-kt-fixa-rolagem]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.style.maxHeight = '';
      var rect = el.getBoundingClientRect();
      var h = Math.max(ALTURA_MIN, window.innerHeight - (rect.top + window.scrollY) - MARGEM_PE);
      el.style.maxHeight = h + 'px';
    }
  }

  var agendado = null;
  function agendar() {
    if (agendado) return;
    agendado = setTimeout(function () { agendado = null; varrer(document); }, 120);
  }

  function iniciar() {
    varrer(document);
    if (window.MutationObserver) {
      new MutationObserver(agendar).observe(document.body, {childList: true, subtree: true});
    }
    var r = null;
    window.addEventListener('resize', function () {
      clearTimeout(r);
      r = setTimeout(recalcular, 150);
    });
  }

  if (document.body) iniciar();
  else document.addEventListener('DOMContentLoaded', iniciar);

  window.ktTabelaFixa = {varrer: varrer, recalcular: recalcular};
})();
