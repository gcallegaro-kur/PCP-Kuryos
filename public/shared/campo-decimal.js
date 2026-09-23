/* Campos decimais que aceitam VÍRGULA (2026-09-23).

   O usuário pediu "permitir decimais no peso". O defeito era pior que isso:
   num <input type="number"> o Chrome DESCARTA a vírgula -- "197,5" vira
   1975, sem aviso (confirmado em pt-BR e en-US). No celular o teclado
   numérico às vezes nem tem ponto. Resultado: peso dez vezes maior gravado
   no laudo, ou o decimal simplesmente impossível de digitar.

   Este script troca todo <input type="number" step="any"> da página (os
   campos que são decimais; os de step="1" são contagem e ficam como estão)
   por texto com teclado decimal, e normaliza o que se digita: vírgula vira
   ponto, só sobram dígitos, um separador e o sinal. Assim todo o código que
   já lê `Number(campo.value)` continua certo, sem mudar leitura por leitura.
   Campos criados depois (tabelas redesenhadas) são pegos pelo observador. */
(function() {
  'use strict';

  // "1.250,5" (milhar com ponto) e "12,5" viram 1250.5 e 12.5; "12.5" fica.
  function normalizar(texto) {
    var t = String(texto == null ? '' : texto).replace(/\s/g, '');
    if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(/,/g, '.');
    t = t.replace(/[^0-9.\-]/g, '');
    var neg = t.charAt(0) === '-';
    t = t.replace(/-/g, '');
    var i = t.indexOf('.');
    if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '');
    return (neg ? '-' : '') + t;
  }

  function converter(el) {
    if (!el || el.tagName !== 'INPUT' || el.type !== 'number' || el.getAttribute('step') !== 'any') return;
    var valor = el.value;
    el.type = 'text';
    el.setAttribute('inputmode', 'decimal');
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('data-decimal', '1');
    el.value = valor;
  }
  function converterTudo(raiz) {
    if (!raiz || !raiz.querySelectorAll) return;
    if (raiz.matches && raiz.matches('input[type=number][step=any]')) converter(raiz);
    raiz.querySelectorAll('input[type=number][step=any]').forEach(converter);
  }

  // Captura: roda ANTES dos ouvintes da página, que já leem o valor limpo.
  function aoDigitar(ev) {
    var el = ev.target;
    if (!el || !el.hasAttribute || !el.hasAttribute('data-decimal')) return;
    var limpo = normalizar(el.value);
    if (limpo !== el.value) {
      var fim = el.selectionEnd, dif = el.value.length - limpo.length;
      el.value = limpo;
      try { el.setSelectionRange(Math.max(0, fim - dif), Math.max(0, fim - dif)); } catch (e) { /* nada */ }
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('input', aoDigitar, true);
    document.addEventListener('change', aoDigitar, true);
    var iniciar = function() {
      converterTudo(document.body);
      new MutationObserver(function(muts) {
        muts.forEach(function(m) { m.addedNodes.forEach(function(n) { if (n.nodeType === 1) converterTudo(n); }); });
      }).observe(document.body, {childList: true, subtree: true});
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
  }
  if (typeof module === 'object' && module.exports) module.exports = {normalizar: normalizar};
  else if (typeof window !== 'undefined') window.CampoDecimal = {normalizar: normalizar};
})();
