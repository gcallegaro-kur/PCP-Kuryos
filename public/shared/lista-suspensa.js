/* Lista suspensa única do sistema (19/10/2026).
   Pedido do usuário: "sempre que aparecer lista suspensa, podemos deixar no
   mesmo padrão? Algo com visual mais bonito" -- a lista nativa do <datalist>
   sai num cinza escuro do navegador, diferente em cada tela, e no celular
   vira uma barra horizontal colada no teclado.

   - KtListaSuspensa.anexar(input, getItems, opts): a lista de busca. Mesmo
     contrato do antigo attachAutocomplete (shared/utils.js), que agora
     delega para cá: getItems() -> [{value, label}] ou strings.
   - Todo <input list="..."> da página é convertido sozinho (inclusive os que
     a tela desenha depois): as opções continuam vindo do <datalist>, lidas a
     cada abertura, então quem preenche o datalist não muda nada.
   Busca sem acento e por palavras (todas precisam aparecer, em qualquer
   ordem); quem começa com o que foi digitado vem primeiro; o trecho achado
   fica marcado. "COD — descrição" mostra o código em destaque.
   Carregado pelo auth_check.js em todas as telas. Testado em
   run_lista_suspensa_ui_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KtListaSuspensa = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var LIMITE = 200;

  function semAcento(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function palavras(q) { return semAcento(q).split(/\s+/).filter(Boolean); }
  function normalizarItens(lista) {
    return (lista || []).map(function(it) {
      if (it == null) return null;
      if (typeof it !== 'object') return {value: String(it), label: String(it)};
      var v = it.value == null ? '' : String(it.value);
      return Object.assign({}, it, {value: v, label: it.label == null || it.label === '' ? v : String(it.label)});
    }).filter(function(it) { return it && (it.value || it.label); });
  }
  // Itens que batem com o texto (todas as palavras, em qualquer ordem), com
  // quem COMEÇA pelo que foi digitado primeiro e, depois, quem tem uma
  // palavra começando por ele. Empate: a ordem original.
  function filtrar(itens, consulta) {
    var ps = palavras(consulta);
    var todos = normalizarItens(itens);
    if (!ps.length) return todos;
    var achados = [];
    todos.forEach(function(it, i) {
      var alvo = semAcento(it.label + (it.value !== it.label ? ' ' + it.value : ''));
      if (!ps.every(function(p) { return alvo.indexOf(p) >= 0; })) return;
      var peso = alvo.indexOf(ps[0]) === 0 ? 0
        : alvo.split(/[^a-z0-9]+/).some(function(w) { return w.indexOf(ps[0]) === 0; }) ? 1 : 2;
      achados.push({it: it, peso: peso, i: i});
    });
    achados.sort(function(a, b) { return a.peso - b.peso || a.i - b.i; });
    return achados.map(function(a) { return a.it; });
  }
  // "COD — descrição" -> {codigo, texto}; sem o travessão, só texto.
  function partes(label) {
    var s = String(label || ''), k = s.indexOf(' — ');
    return k > 0 && k <= 40 ? {codigo: s.slice(0, k), texto: s.slice(k + 3)} : {codigo: '', texto: s};
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
    });
  }
  // Marca as palavras buscadas, sem acento e sem caixa. Compara caractere a
  // caractere, então "Á" casa com "a" sem deslocar as posições.
  function marcar(texto, consulta) {
    var s = String(texto || ''), ps = palavras(consulta);
    if (!ps.length) return esc(s);
    var chars = Array.from(s);
    var base = chars.map(function(c) { return semAcento(c).charAt(0) || c.toLowerCase(); }).join('');
    var on = chars.map(function() { return false; });
    ps.forEach(function(p) {
      var de = 0, k;
      while ((k = base.indexOf(p, de)) >= 0) { for (var j = k; j < k + p.length; j++) on[j] = true; de = k + p.length; }
    });
    var out = '', aberto = false;
    chars.forEach(function(c, i) {
      if (on[i] && !aberto) { out += '<mark>'; aberto = true; }
      if (!on[i] && aberto) { out += '</mark>'; aberto = false; }
      out += esc(c);
    });
    return out + (aberto ? '</mark>' : '');
  }

  var SETA = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><path d="M3 4.5l3 3 3-3" fill="none" stroke="#8a8f98" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  var ESTILO = [
    '.kt-ac-list{display:none;position:fixed;z-index:2147482000;box-sizing:border-box;min-width:260px;max-height:320px;overflow-y:auto;-webkit-overflow-scrolling:touch;',
    'padding:6px;border-radius:12px;background:var(--card,var(--panel,#fff));color:var(--text,var(--ink,#1d1d1f));',
    'border:1px solid var(--border,var(--line,#d2d2d7));',
    'box-shadow:0 18px 40px -12px rgba(15,23,42,.30),0 4px 12px rgba(15,23,42,.08);font-family:var(--font-ui,inherit)}',
    '.kt-ac-list.open{display:block;animation:ktAcIn .12s ease-out}',
    '@keyframes ktAcIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
    '.kt-ac-item{display:flex;align-items:baseline;gap:10px;min-height:38px;box-sizing:border-box;padding:9px 12px;border-radius:8px;',
    'font-size:13.5px;line-height:1.35;cursor:pointer;border:0;color:inherit}',
    '.kt-ac-item+.kt-ac-item{margin-top:1px}',
    '.kt-ac-item:hover{background:rgba(10,28,105,.06)}',
    '.kt-ac-item.active{background:rgba(10,28,105,.11)}',
    '.kt-ac-cod{flex:none;font-weight:700;font-size:12px;letter-spacing:.02em;font-variant-numeric:tabular-nums;color:#1f3a93;',
    'background:rgba(31,58,147,.08);padding:2px 7px;border-radius:6px}',
    '.kt-ac-txt{flex:1;min-width:0}',
    '.kt-ac-list mark{background:rgba(245,179,1,.35);color:inherit;border-radius:3px;padding:0 1px}',
    '.kt-ac-vazio,.kt-ac-mais{padding:10px 12px;font-size:12.5px;color:var(--muted,var(--ink-soft,#6e6e73))}',
    '.kt-ac-mais{border-top:1px solid var(--border,#e5e5ea);margin-top:4px}',
    '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .kt-ac-cod{color:#9db7ff;background:rgba(157,183,255,.14)}',
    ':root:not([data-theme="light"]) .kt-ac-item:hover{background:rgba(255,255,255,.06)}',
    ':root:not([data-theme="light"]) .kt-ac-item.active{background:rgba(157,183,255,.18)}}',
    ':root[data-theme="dark"] .kt-ac-cod{color:#9db7ff;background:rgba(157,183,255,.14)}',
    ':root[data-theme="dark"] .kt-ac-item:hover{background:rgba(255,255,255,.06)}',
    ':root[data-theme="dark"] .kt-ac-item.active{background:rgba(157,183,255,.18)}',
    // Seta discreta no campo convertido, como o datalist tinha.
    'input.kt-ac-input{background-image:url("' + SETA + '");background-repeat:no-repeat;background-position:right 10px center;padding-right:28px}',
    // <select> comum: a lista que abre ganha o mesmo visual. Só onde o
    // navegador permite redesenhá-la (Chrome 135+, "appearance: base-select");
    // nos outros continua a lista nativa. O campo fechado mantém o CSS da tela.
    '@supports (appearance: base-select){',
    'select:not([multiple]):not([size]){appearance:base-select}',
    'select:not([multiple]):not([size])::picker(select){appearance:base-select;box-sizing:border-box;padding:6px;margin-top:4px;max-height:min(360px,70vh);',
    'border-radius:12px;background:var(--card,var(--panel,#fff));color:var(--text,var(--ink,#1d1d1f));border:1px solid var(--border,var(--line,#d2d2d7));',
    'box-shadow:0 18px 40px -12px rgba(15,23,42,.30),0 4px 12px rgba(15,23,42,.08);font-family:var(--font-ui,inherit)}',
    'select:not([multiple]):not([size]) option{padding:8px 12px;border-radius:8px;font-size:13.5px;line-height:1.35;min-height:34px;gap:8px}',
    'select:not([multiple]):not([size]) option:hover,select:not([multiple]):not([size]) option:focus-visible{background:rgba(10,28,105,.07);outline:none}',
    'select:not([multiple]):not([size]) option:checked{background:rgba(10,28,105,.11);font-weight:600}',
    'select:not([multiple]):not([size]) option::checkmark{color:#1f3a93}',
    'select:not([multiple]):not([size]) option:disabled{opacity:.5}',
    'select:not([multiple]):not([size]) optgroup{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#6e6e73);padding:6px 6px 2px}',
    'select:not([multiple]):not([size])::picker-icon{content:"";width:12px;height:12px;background:url("' + SETA + '") no-repeat center/12px;transition:rotate .15s}',
    'select:not([multiple]):not([size]):open::picker-icon{rotate:180deg}',
    '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) select:not([multiple]):not([size]) option:hover{background:rgba(255,255,255,.06)}',
    ':root:not([data-theme="light"]) select:not([multiple]):not([size]) option:checked{background:rgba(157,183,255,.18)}}',
    ':root[data-theme="dark"] select:not([multiple]):not([size]) option:hover{background:rgba(255,255,255,.06)}',
    ':root[data-theme="dark"] select:not([multiple]):not([size]) option:checked{background:rgba(157,183,255,.18)}',
    '}'
  ].join('');

  function instalarEstilo(doc) {
    if (doc.getElementById('ktListaSuspensaCss')) return;
    var st = doc.createElement('style');
    st.id = 'ktListaSuspensaCss';
    st.textContent = ESTILO;
    // No fim do <head>: vence as cópias antigas de .kt-ac-list nas páginas.
    (doc.head || doc.documentElement).appendChild(st);
  }

  function anexar(input, getItems, opts) {
    if (!input || typeof document === 'undefined') return;
    // Já anexado (a tela chamou de novo, ou o datalist foi convertido antes):
    // troca só a fonte, sem empilhar listeners.
    if (input.__ktLista) { input.__ktLista.getItems = getItems; input.__ktLista.opts = opts || {}; return; }
    instalarEstilo(document);
    var estado = input.__ktLista = {getItems: getItems, opts: opts || {}};
    input.classList.add('kt-ac-input');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');

    var list = document.createElement('div');
    list.className = 'kt-ac-list';
    list.setAttribute('role', 'listbox');
    document.body.appendChild(list);
    var atuais = [], ativo = -1, ignorarProximo = false;

    function aberta() { return list.classList.contains('open'); }
    function posicionar() {
      var r = input.getBoundingClientRect();
      var largura = Math.min(Math.max(r.width, 260), window.innerWidth - 16);
      list.style.left = Math.max(8, Math.min(r.left, window.innerWidth - largura - 8)) + 'px';
      list.style.width = largura + 'px';
      var abaixo = window.innerHeight - r.bottom;
      if (abaixo < 200 && r.top > abaixo) { list.style.top = ''; list.style.bottom = (window.innerHeight - r.top + 4) + 'px'; }
      else { list.style.bottom = ''; list.style.top = (r.bottom + 4) + 'px'; }
    }
    function destacar() {
      var itens = list.querySelectorAll('.kt-ac-item');
      Array.prototype.forEach.call(itens, function(el, i) {
        el.classList.toggle('active', i === ativo);
        el.setAttribute('aria-selected', i === ativo ? 'true' : 'false');
      });
      if (ativo >= 0 && itens[ativo]) itens[ativo].scrollIntoView({block: 'nearest'});
    }
    function fechar() { list.classList.remove('open'); ativo = -1; input.setAttribute('aria-expanded', 'false'); }
    function escolher(i) {
      var it = atuais[i];
      if (!it) return;
      input.value = it.value;
      fechar();
      // O mesmo evento que a escolha num <datalist> dispara, e 'change'
      // também: valor posto por código não dispara change no blur.
      ignorarProximo = true;
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new Event('change', {bubbles: true}));
      if (estado.opts.onSelect) estado.opts.onSelect(it);
    }
    function desenhar() {
      if (ignorarProximo) { ignorarProximo = false; return; }
      if (input.disabled || input.readOnly) { fechar(); return; }
      var todos = normalizarItens(estado.getItems() || []);
      if (!todos.length) { fechar(); return; }
      var q = input.value;
      atuais = filtrar(todos, q);
      ativo = -1;
      var h = atuais.slice(0, LIMITE).map(function(it, i) {
        var p = partes(it.label);
        return '<div class="kt-ac-item" role="option" data-i="' + i + '">' +
          (p.codigo ? '<span class="kt-ac-cod">' + marcar(p.codigo, q) + '</span>' : '') +
          '<span class="kt-ac-txt">' + marcar(p.texto, q) + '</span></div>';
      }).join('');
      if (!atuais.length) h = '<div class="kt-ac-vazio">Nada encontrado para “' + esc(q.trim()) + '”.</div>';
      else if (atuais.length > LIMITE) h += '<div class="kt-ac-mais">Mostrando ' + LIMITE + ' de ' + atuais.length + ' — continue digitando para filtrar.</div>';
      list.innerHTML = h;
      posicionar();
      list.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }
    list.addEventListener('mousedown', function(e) {
      e.preventDefault(); // o blur do campo não pode fechar a lista antes do clique contar
      var el = e.target.closest('.kt-ac-item');
      if (el) escolher(Number(el.getAttribute('data-i')));
    });
    input.addEventListener('input', desenhar);
    input.addEventListener('focus', desenhar);
    input.addEventListener('click', function() { if (!aberta()) desenhar(); });
    input.addEventListener('blur', function() { setTimeout(fechar, 150); });
    input.addEventListener('keydown', function(e) {
      if (!aberta()) { if (e.key === 'ArrowDown') { e.preventDefault(); desenhar(); } return; }
      var n = Math.min(atuais.length, LIMITE);
      if (e.key === 'ArrowDown') { e.preventDefault(); ativo = Math.min(ativo + 1, n - 1); destacar(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); ativo = Math.max(ativo - 1, 0); destacar(); }
      else if (e.key === 'Enter') { if (ativo >= 0) { e.preventDefault(); escolher(ativo); } else fechar(); }
      else if (e.key === 'Escape' || e.key === 'Tab') fechar();
    });
    window.addEventListener('scroll', function(e) { if (aberta() && !list.contains(e.target)) posicionar(); }, true);
    window.addEventListener('resize', function() { if (aberta()) posicionar(); });
    estado.limpar = function() { if (list.parentNode) list.parentNode.removeChild(list); };
  }

  // <input list="x"> vira a lista do sistema; as opções saem do <datalist>
  // a cada abertura (value = o que entra no campo; label/texto = descrição).
  function opcoesDoDatalist(id) {
    var dl = document.getElementById(id);
    if (!dl) return [];
    return Array.prototype.map.call(dl.querySelectorAll('option'), function(o) {
      var v = o.value, l = (o.label || o.textContent || '').trim();
      return {value: v, label: !l || l === v ? v : (l.indexOf(v) >= 0 ? l : v + ' — ' + l)};
    });
  }
  function converter(input) {
    var id = input.getAttribute('list');
    if (!id || input.__ktLista) return;
    input.setAttribute('data-kt-lista', id);
    input.removeAttribute('list');
    anexar(input, function() { return opcoesDoDatalist(input.getAttribute('data-kt-lista')); });
  }
  function converterTodos(raiz) {
    if (!raiz || !raiz.querySelectorAll) return;
    if (raiz.matches && raiz.matches('input[list]')) converter(raiz);
    Array.prototype.forEach.call(raiz.querySelectorAll('input[list]'), converter);
  }
  function limparRemovidos(n) {
    if (n.nodeType !== 1) return;
    var campos = n.__ktLista ? [n] : Array.prototype.slice.call(n.querySelectorAll('.kt-ac-input'));
    campos.forEach(function(c) { if (c.__ktLista && !c.isConnected && c.__ktLista.limpar) c.__ktLista.limpar(); });
  }
  function observar() {
    if (typeof MutationObserver === 'undefined' || !document.body) return;
    instalarEstilo(document);
    converterTodos(document.body);
    new MutationObserver(function(muts) {
      muts.forEach(function(m) {
        if (m.type === 'attributes') { if (m.target.getAttribute('list')) converter(m.target); return; }
        Array.prototype.forEach.call(m.addedNodes, function(n) { if (n.nodeType === 1) converterTodos(n); });
        Array.prototype.forEach.call(m.removedNodes, limparRemovidos);
      });
    }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['list']});
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observar);
    else observar();
  }

  return {anexar: anexar, filtrar: filtrar, partes: partes, marcar: marcar, semAcento: semAcento};
});
