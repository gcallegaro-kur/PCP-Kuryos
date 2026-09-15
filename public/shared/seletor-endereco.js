/* Seletor visual de endereço (WMS).

   Pedido do usuário (2026-09-15): no recebimento a escolha era uma lista
   suspensa com as 233 posições misturadas, sem filtro de local nem noção de
   ocupação. Agora: primeiro o LOCAL (Doca, Galpão, Fábrica -- as áreas do
   cadastro de endereços), depois o MAPA daquele local, com ruas, prédios e
   níveis desenhados e livre/ocupado à vista.

   Regras decididas pelo usuário:
   - Doca é área de PASSAGEM e aceita vários paletes. Recebimento entra nela
     por padrão; o PA pode voltar de uma posição para a Doca para agilizar a
     expedição. "Na Doca" é calculado pela ÁREA do endereço (área DOCA), não por
     marca gravada no lote.
   - Posição comum = UM palete, mas um palete pode ter mais de um produto:
     posição ocupada não é bloqueada, pede "Colocar no mesmo palete".

   Uso nas telas: campoHtml(classe, valor) gera um campo com <input hidden>
   da classe que a tela já lê (rc-endereco, cpa-endereco...) + botão; ligar()
   abre o seletor por delegação, então linhas criadas depois também funcionam. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SeletorEndereco = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function fmt(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function ehDoca(endereco) { return !!endereco && norm(endereco.area) === 'DOCA'; }
  function porCodigo(a, b) { return String(a.codigo || a.key).localeCompare(String(b.codigo || b.key), 'pt-BR', {numeric: true}); }

  function ativos(enderecos) {
    return Object.keys(enderecos || {}).filter(function(k) { return enderecos[k] && enderecos[k].ativo !== false; })
      .map(function(k) { return Object.assign({key: k}, enderecos[k]); });
  }
  // Primeira posição ativa da área DOCA ('' se a Doca não foi cadastrada).
  function docaPadrao(enderecos) {
    var docas = ativos(enderecos).filter(ehDoca).sort(porCodigo);
    return docas.length ? docas[0].key : '';
  }
  // enderecoKey -> lotes com saldo naquela posição.
  function ocupacao(lotes) {
    var mapa = {};
    Object.keys(lotes || {}).forEach(function(itemKey) {
      Object.keys(lotes[itemKey] || {}).forEach(function(loteKey) {
        var l = lotes[itemKey][loteKey] || {};
        if (!l.enderecoKey || !(Number(l.saldoLote) > 0)) return;
        (mapa[l.enderecoKey] = mapa[l.enderecoKey] || []).push({
          itemKey: itemKey, loteKey: loteKey, itemCodigo: l.itemCodigo || itemKey, itemNome: l.itemNome || '',
          saldo: Number(l.saldoLote), unidade: l.unidade || (l.itemTipo === 'produto' ? 'un' : ''),
          status: l.status || '', itemTipo: l.itemTipo || '', identificadorPalete: l.identificadorPalete || '',
          loteOrigem: l.loteOrigem || l.opLote || ''
        });
      });
    });
    return mapa;
  }
  // Áreas com as posições ativas desenhadas em ruas × prédios × níveis. Ordem:
  // Doca, Galpão, Fábrica e as demais em ordem alfabética.
  var ORDEM_AREA = {DOCA: 0, GALPAO: 1, FABRICA: 2};
  // Maior rua/prédio/nível que o mapa desenha. O endereço HISTORICO do legado
  // da planilha tem rua/prédio/nível 999: desenhado, viraria uma grade de
  // ~1 milhão de posições e travaria a tela.
  var LIMITE_GRADE = 60;
  function destinoValido(e) {
    return !e.legado && [e.rua, e.predio, e.nivel].every(function(v) { var n = Number(v); return n >= 1 && n <= LIMITE_GRADE; });
  }
  function areas(enderecos) {
    var grupos = {};
    ativos(enderecos).filter(destinoValido).forEach(function(e) {
      var nome = e.area || 'SEM ÁREA', chave = norm(nome);
      var g = grupos[chave] = grupos[chave] || {nome: nome, chave: chave, doca: chave === 'DOCA', total: 0, ruas: {}, posicoes: []};
      g.total++; g.posicoes.push(e);
      var rua = Number(e.rua) || 0, r = g.ruas[rua] = g.ruas[rua] || {rua: rua, predios: 0, niveis: 0, pos: {}};
      r.predios = Math.max(r.predios, Number(e.predio) || 0);
      r.niveis = Math.max(r.niveis, Number(e.nivel) || 0);
      r.pos[(Number(e.predio) || 0) + '|' + (Number(e.nivel) || 0)] = e;
    });
    return Object.keys(grupos).map(function(k) {
      var g = grupos[k];
      g.ruas = Object.keys(g.ruas).map(function(r) { return g.ruas[r]; }).sort(function(a, b) { return a.rua - b.rua; });
      g.posicoes.sort(porCodigo);
      return g;
    }).sort(function(a, b) {
      var oa = ORDEM_AREA[a.chave] != null ? ORDEM_AREA[a.chave] : 9, ob = ORDEM_AREA[b.chave] != null ? ORDEM_AREA[b.chave] : 9;
      return oa - ob || a.nome.localeCompare(b.nome, 'pt-BR');
    });
  }
  // Situação de uma posição para quem vai colocar `ignorar` nela (o lote que
  // está sendo movido não conta como ocupante do lugar de onde sai).
  function situacao(key, enderecos, ocup, ignorar) {
    var e = (enderecos || {})[key];
    if (!e || e.ativo === false) return {tipo: 'INVALIDA', ocupantes: [], endereco: e || null};
    var oc = ((ocup || {})[key] || []).filter(function(o) { return !(ignorar && o.itemKey === ignorar.itemKey && o.loteKey === ignorar.loteKey); });
    return {tipo: ehDoca(e) ? 'DOCA' : oc.length ? 'OCUPADA' : 'LIVRE', ocupantes: oc, endereco: Object.assign({key: key}, e)};
  }
  function rotulo(key, enderecos) {
    var e = (enderecos || {})[key];
    if (!key) return 'Escolher endereço';
    if (!e) return key + ' (endereço não encontrado)';
    return (e.codigo || key) + ' · ' + (ehDoca(e) ? 'Doca' : (e.area || ''));
  }

  /* ── Interface ─────────────────────────────────────────────────────── */
  var CSS = '.se-campo{display:flex;gap:6px;align-items:center}.se-btn{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:8px 10px;border:1px solid var(--border,#d0d5dd);border-radius:8px;background:var(--card,#fff);color:inherit;font:inherit;font-size:13px;cursor:pointer}.se-btn:hover{border-color:var(--primary,#17479e)}.se-btn .se-rotulo{flex:1}.se-btn .se-trocar{font-size:12px;color:var(--primary,#17479e);font-weight:600}.se-btn.vazio .se-rotulo{color:var(--muted,#667085)}' +
    '.se-overlay{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px}.se-modal{background:var(--card,#fff);color:var(--text,#182230);border-radius:12px;width:100%;max-width:1040px;max-height:92vh;overflow:auto;padding:16px 18px;box-sizing:border-box}' +
    '.se-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px}.se-head h3{margin:0;font-size:17px}.se-sub{font-size:12px;color:var(--muted,#667085);margin-top:3px}.se-x{border:0;background:none;font-size:22px;cursor:pointer;color:inherit;line-height:1}' +
    '.se-areas{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 10px}.se-area{border:1px solid var(--border,#d0d5dd);background:var(--card,#fff);color:inherit;border-radius:20px;padding:6px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}.se-area.on{background:#17479e;border-color:#17479e;color:#fff}.se-area small{font-weight:400;opacity:.8;margin-left:4px}' +
    '.se-leg{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted,#667085);margin-bottom:8px}.se-sw{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-2px;margin-right:4px;border:1px solid #98a2b3}' +
    '.se-mapa{overflow-x:auto;padding-bottom:4px}.se-rua{display:flex;align-items:flex-end;gap:5px;margin:0 0 9px}.se-rua-nm{font-size:12px;color:var(--muted,#667085);width:46px;flex:none}.se-pr{display:flex;flex-direction:column-reverse;gap:3px}' +
    '.se-pos{width:30px;height:20px;border-radius:4px;border:1px solid #98a2b3;background:#fff;padding:0;font-size:10px;color:#475467;cursor:pointer;line-height:1}.se-pos:hover{border-color:#101828}.se-pos.oc{background:#fdd48a;border-color:#b54708;color:#7a2e0e}.se-pos.atual{box-shadow:inset 0 0 0 2px #667085}.se-pos.sel{outline:3px solid #17479e;outline-offset:1px}.se-pos.vaga{visibility:hidden}' +
    '.se-painel{margin-top:10px;background:var(--surface-2,#f2f4f7);border-radius:8px;padding:12px 14px;font-size:13px;min-height:48px}.se-painel ul{margin:6px 0 10px;padding-left:18px}.se-acao{border:0;border-radius:8px;padding:9px 14px;background:#0a1c69;color:#fff;font-weight:700;cursor:pointer;font:inherit;font-size:13px}.se-acao.sec{background:#fff;color:#344054;border:1px solid #cbd2dc}' +
    '.se-doca-lista{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}.se-doca-item{border:1px solid var(--border,#e4e7ec);border-radius:8px;padding:8px 10px;font-size:13px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.se-tag{font-size:11px;font-weight:700;border-radius:10px;padding:2px 8px;background:#eef2f6;color:#344054}.se-tag.q{background:#fff4df;color:#825b16}.se-tag.l{background:#e7f4ec;color:#176b40}.se-vazio{font-size:13px;color:var(--muted,#667085);padding:8px 0}';
  function injetarCss(doc) {
    if (doc.getElementById('seletor-endereco-css')) return;
    var s = doc.createElement('style'); s.id = 'seletor-endereco-css'; s.textContent = CSS; doc.head.appendChild(s);
  }
  function campoHtml(classe, valor, enderecos, opts) {
    opts = opts || {};
    return '<span class="se-campo"><input type="hidden" class="' + esc(classe) + '"' + (opts.id ? ' id="' + esc(opts.id) + '"' : '') + ' value="' + esc(valor || '') + '">' +
      '<button type="button" class="se-btn' + (valor ? '' : ' vazio') + '" data-se-titulo="' + esc(opts.titulo || '') + '"><span aria-hidden="true">📍</span><span class="se-rotulo">' + esc(rotulo(valor, enderecos)) + '</span><span class="se-trocar">' + (valor ? 'Trocar' : 'Escolher') + '</span></button></span>';
  }
  function statusTag(o) {
    var s = norm(o.status);
    if (s === 'QUARENTENA') return '<span class="se-tag q">Quarentena</span>';
    if (/LIBERADO|APROVADO/.test(s)) return '<span class="se-tag l">' + (o.itemTipo === 'produto' ? 'Liberado p/ expedir' : 'Liberado') + '</span>';
    return s ? '<span class="se-tag">' + esc(o.status) + '</span>' : '';
  }
  function descOcupante(o) { return '<b>' + esc(o.itemCodigo) + '</b> ' + esc(o.itemNome) + ' · ' + fmt(o.saldo) + ' ' + esc(o.unidade) + (o.loteOrigem ? ' · lote ' + esc(o.loteOrigem) : ''); }

  // Abre o seletor. opts: fonte() -> {enderecos, lotes}; valor; ignorar
  // {itemKey,loteKey}; titulo; subtitulo; onEscolher(key, situacao).
  function abrir(opts) {
    var doc = opts.document || document;
    injetarCss(doc);
    var dados = opts.fonte() || {}, enderecos = dados.enderecos || {}, ocup = ocupacao(dados.lotes || {});
    var lista = areas(enderecos);
    var atual = opts.valor && enderecos[opts.valor] ? opts.valor : '';
    var areaAtual = atual ? norm(enderecos[atual].area) : '';
    // preferirPosicao: quem abre para GUARDAR um lote que está na Doca quer ver
    // as posições, não a própria Doca.
    var primeiraPosicao = lista.filter(function(a) { return !a.doca; })[0];
    if (opts.preferirPosicao && primeiraPosicao && (!areaAtual || areaAtual === 'DOCA')) areaAtual = primeiraPosicao.chave;
    var estado = {area: areaAtual || (lista[0] ? lista[0].chave : ''), sel: atual && norm(enderecos[atual].area) === areaAtual ? atual : null};
    var overlay = doc.createElement('div'); overlay.className = 'se-overlay';
    overlay.innerHTML = '<div class="se-modal" role="dialog" aria-modal="true" aria-label="Escolher endereço"><div class="se-head"><div><h3>' + esc(opts.titulo || 'Escolher endereço') + '</h3>' +
      (opts.subtitulo ? '<div class="se-sub">' + esc(opts.subtitulo) + '</div>' : '') + '</div><button type="button" class="se-x" aria-label="Fechar">×</button></div>' +
      '<div class="se-areas"></div><div class="se-corpo"></div><div class="se-painel"></div></div>';
    doc.body.appendChild(overlay);
    function fechar() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); doc.removeEventListener('keydown', teclado); }
    function teclado(ev) { if (ev.key === 'Escape') fechar(); }
    doc.addEventListener('keydown', teclado);
    overlay.addEventListener('click', function(ev) { if (ev.target === overlay) fechar(); });
    overlay.querySelector('.se-x').onclick = fechar;
    function escolher(key) {
      var s = situacao(key, enderecos, ocup, opts.ignorar);
      if (s.tipo === 'INVALIDA') return;
      fechar();
      if (opts.onEscolher) opts.onEscolher(key, s);
    }
    function render() {
      overlay.querySelector('.se-areas').innerHTML = lista.length ? lista.map(function(a) {
        return '<button type="button" class="se-area' + (a.chave === estado.area ? ' on' : '') + '" data-area="' + esc(a.chave) + '">' + esc(a.doca ? 'Doca' : a.nome) + '<small>' + (a.doca ? fmt(a.posicoes.reduce(function(t, p) { return t + ((ocup[p.key] || []).length); }, 0)) + ' lote(s)' : fmt(a.total) + ' posições') + '</small></button>';
      }).join('') : '<div class="se-vazio">Nenhum endereço ativo cadastrado. Cadastre em Estoque › Estrutura de Ruas.</div>';
      overlay.querySelectorAll('.se-area').forEach(function(b) { b.onclick = function() { estado.area = b.getAttribute('data-area'); estado.sel = null; render(); }; });
      var area = lista.filter(function(a) { return a.chave === estado.area; })[0], corpo = overlay.querySelector('.se-corpo');
      if (!area) { corpo.innerHTML = ''; painel(); return; }
      if (area.doca) {
        // Doca: lista do que está parado nela, e a própria Doca como destino.
        corpo.innerHTML = area.posicoes.map(function(p) {
          var oc = (ocup[p.key] || []).filter(function(o) { return !(opts.ignorar && o.itemKey === opts.ignorar.itemKey && o.loteKey === opts.ignorar.loteKey); });
          return '<div class="se-sub" style="margin:4px 0 6px"><b>' + esc(p.codigo || p.key) + '</b>' + (p.key === atual ? ' · posição atual' : '') + ' · ' + fmt(oc.length) + ' lote(s) aqui</div>' +
            '<div class="se-doca-lista">' + (oc.length ? oc.map(function(o) { return '<div class="se-doca-item"><span>' + descOcupante(o) + '</span>' + statusTag(o) + '</div>'; }).join('') : '<div class="se-vazio">Doca vazia.</div>') + '</div>';
        }).join('');
        estado.sel = area.posicoes[0] ? (area.posicoes.some(function(p) { return p.key === estado.sel; }) ? estado.sel : area.posicoes[0].key) : null;
        painel(); return;
      }
      corpo.innerHTML = '<div class="se-leg"><span><span class="se-sw"></span>Livre</span><span><span class="se-sw" style="background:#fdd48a;border-color:#b54708"></span>Ocupada (1 palete)</span><span><span class="se-sw" style="box-shadow:inset 0 0 0 2px #667085"></span>Posição atual</span><span>Nível 1 embaixo · número = prédio</span></div>' +
        '<div class="se-mapa">' + area.ruas.map(function(r) {
          var cols = '';
          for (var p = 1; p <= r.predios; p++) {
            var cel = '';
            for (var n = 1; n <= r.niveis; n++) {
              var e = r.pos[p + '|' + n];
              if (!e) { cel += '<button type="button" class="se-pos vaga" tabindex="-1" aria-hidden="true"></button>'; continue; }
              var oc = (ocup[e.key] || []).filter(function(o) { return !(opts.ignorar && o.itemKey === opts.ignorar.itemKey && o.loteKey === opts.ignorar.loteKey); });
              var titulo = (e.codigo || e.key) + (oc.length ? ' · ' + oc.map(function(o) { return o.itemCodigo + ' ' + fmt(o.saldo) + ' ' + o.unidade; }).join(' + ') : ' · livre');
              cel += '<button type="button" class="se-pos' + (oc.length ? ' oc' : '') + (e.key === atual ? ' atual' : '') + (e.key === estado.sel ? ' sel' : '') + '" data-key="' + esc(e.key) + '" title="' + esc(titulo) + '" aria-label="' + esc(titulo) + '">' + p + '</button>';
            }
            cols += '<div class="se-pr">' + cel + '</div>';
          }
          return '<div class="se-rua"><span class="se-rua-nm">Rua ' + esc(r.rua) + '</span>' + cols + '</div>';
        }).join('') + '</div>';
      corpo.querySelectorAll('.se-pos[data-key]').forEach(function(b) { b.onclick = function() { estado.sel = b.getAttribute('data-key'); render(); }; });
      painel();
    }
    function painel() {
      var el = overlay.querySelector('.se-painel');
      if (!estado.sel) { el.innerHTML = 'Clique numa posição do mapa.'; return; }
      var s = situacao(estado.sel, enderecos, ocup, opts.ignorar), cod = esc(s.endereco ? (s.endereco.codigo || estado.sel) : estado.sel);
      var jaAqui = estado.sel === atual;
      if (jaAqui && s.tipo !== 'INVALIDA') {
        // Escolher onde o lote já está não move nada: sem botão de ação.
        el.innerHTML = '<b>' + cod + '</b> · já é o endereço atual, nada a mudar' + (s.ocupantes.length ? '<ul>' + s.ocupantes.map(function(o) { return '<li>' + descOcupante(o) + ' ' + statusTag(o) + '</li>'; }).join('') + '</ul>' : '') +
          '<div style="margin-top:8px"><button type="button" class="se-acao sec" data-acao="cancelar">Escolher outra</button></div>';
      } else if (s.tipo === 'DOCA') {
        el.innerHTML = '<b>' + cod + '</b> · Doca, aceita vários paletes' + (jaAqui ? ' · posição atual' : '') + '<div style="margin-top:8px"><button type="button" class="se-acao" data-acao="ok">Deixar na Doca</button></div>';
      } else if (s.tipo === 'OCUPADA') {
        el.innerHTML = '<b>' + cod + '</b> · ocupada' + (jaAqui ? ' · posição atual' : '') + '<ul>' + s.ocupantes.map(function(o) { return '<li>' + descOcupante(o) + ' ' + statusTag(o) + '</li>'; }).join('') + '</ul>' +
          '<button type="button" class="se-acao" data-acao="ok">Colocar no mesmo palete</button> <button type="button" class="se-acao sec" data-acao="cancelar">Escolher outra</button>';
      } else if (s.tipo === 'LIVRE') {
        el.innerHTML = '<b>' + cod + '</b> · <span style="color:#176b40;font-weight:700">livre</span>' + (jaAqui ? ' · posição atual' : '') + '<div style="margin-top:8px"><button type="button" class="se-acao" data-acao="ok">Guardar aqui</button></div>';
      } else {
        el.innerHTML = 'Posição inativa ou inexistente.';
      }
      var ok = el.querySelector('[data-acao="ok"]'), cancelar = el.querySelector('[data-acao="cancelar"]');
      if (ok) ok.onclick = function() { escolher(estado.sel); };
      if (cancelar) cancelar.onclick = function() { estado.sel = null; render(); };
    }
    render();
    return {fechar: fechar, elemento: overlay};
  }
  // Delegação: qualquer .se-campo dentro de `container` abre o seletor.
  // opts.fonte, opts.titulo(input)?, opts.ignorar(input)?, opts.aoEscolher(input, key, situacao)?
  function ligar(container, opts) {
    if (!container || container.__seLigado) return;
    container.__seLigado = true;
    container.addEventListener('click', function(ev) {
      var btn = ev.target.closest && ev.target.closest('.se-btn');
      if (!btn || !container.contains(btn)) return;
      ev.preventDefault();
      var input = btn.parentNode.querySelector('input[type=hidden]');
      abrir({
        document: container.ownerDocument, fonte: opts.fonte, valor: input.value,
        titulo: btn.getAttribute('data-se-titulo') || opts.titulo || 'Escolher endereço',
        subtitulo: typeof opts.subtitulo === 'function' ? opts.subtitulo(input) : opts.subtitulo,
        ignorar: typeof opts.ignorar === 'function' ? opts.ignorar(input) : null,
        onEscolher: function(key, s) {
          atualizarCampo(input, key, (opts.fonte() || {}).enderecos);
          if (opts.aoEscolher) opts.aoEscolher(input, key, s);
          input.dispatchEvent(new (container.ownerDocument.defaultView.Event)('change', {bubbles: true}));
        }
      });
    });
  }
  function atualizarCampo(input, key, enderecos) {
    input.value = key || '';
    var btn = input.parentNode.querySelector('.se-btn');
    if (!btn) return;
    btn.classList.toggle('vazio', !key);
    btn.querySelector('.se-rotulo').textContent = rotulo(key, enderecos);
    btn.querySelector('.se-trocar').textContent = key ? 'Trocar' : 'Escolher';
  }

  return {norm: norm, ehDoca: ehDoca, docaPadrao: docaPadrao, ocupacao: ocupacao, areas: areas, situacao: situacao, rotulo: rotulo,
    campoHtml: campoHtml, abrir: abrir, ligar: ligar, atualizarCampo: atualizarCampo};
});
