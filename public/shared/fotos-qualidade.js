/* Fotos nas análises da Qualidade.

   Pedido do usuário (2026-09-30), vindo da Qualidade: "em análise de insumos
   poderia ter opção de acrescentar fotos? às vezes tem alguma observação para
   fazer". Decisões dele: vale para QUALQUER análise (laudo de matéria-prima,
   embalagem e produto acabado, análise do bulk, RNC); até 6 fotos por registro;
   na REPROVAÇÃO, pelo menos uma foto.

   A "foto obrigatória" tem uma saída explícita: "Não há o que fotografar"
   (reprovar por certificado ausente, por exemplo, não tem o que mostrar). A
   dispensa fica gravada junto, e a justificativa escrita continua obrigatória
   na reprovação -- então a prova nunca fica só na memória de alguém.

   O arquivo vai para o Storage (qualidade/{contexto}_{chave}/...); o que fica no
   banco é só o registro (shared/anexos.js): url, caminho, quem, quando, legenda.
   As fotos sobem NA HORA DE SALVAR a análise, não ao escolher -- assim uma
   análise cancelada não deixa arquivo órfão no Storage.

   Parte pura (regras, caminho, registro) testada em run_fotos_qualidade_test.js;
   a parte de tela (montar/galeria) é exercitada em run_fotos_qualidade_ui_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./anexos.js'));
  else root.FotosQualidade = factory(root.Anexos);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Anexos) {
  'use strict';

  var MAX_FOTOS = 6;
  var LEGENDA_MAX = 80;
  var DECISOES_COM_FOTO = {REPROVADO: 1, REPROVAR: 1};

  function texto(v) { return String(v == null ? '' : v).trim(); }

  /* Aceita o formato do banco (objeto de push ou array) e devolve lista. */
  function lista(fotos) {
    if (!fotos) return [];
    var itens = Array.isArray(fotos) ? fotos : Object.keys(fotos).map(function(k) { return fotos[k]; });
    return itens.filter(function(f) { return f && (f.url || f.caminho); });
  }

  /* Quantas ainda cabem. `novas` é quantas o usuário está tentando somar. */
  function podeAdicionar(atuais, novas) {
    var livres = MAX_FOTOS - (Number(atuais) || 0);
    if (livres <= 0) return {ok: false, aceitas: 0, erro: 'Limite de ' + MAX_FOTOS + ' fotos por registro.'};
    if ((Number(novas) || 0) > livres) {
      return {ok: true, aceitas: livres, erro: 'Só cabem mais ' + livres + (livres === 1 ? ' foto' : ' fotos') + ' (limite de ' + MAX_FOTOS + '); as demais foram ignoradas.'};
    }
    return {ok: true, aceitas: Number(novas) || 0, erro: null};
  }

  /* Na reprovação: pelo menos uma foto, ou a dispensa explícita. */
  function exigencia(decisao, totalFotos, dispensada) {
    if (!DECISOES_COM_FOTO[decisao]) return {ok: true};
    if ((Number(totalFotos) || 0) >= 1 || dispensada) return {ok: true};
    return {ok: false, erro: 'Reprovação exige pelo menos uma foto. Se não há o que fotografar (ex.: reprovado por documento), marque "Não há o que fotografar" e descreva o motivo.'};
  }

  function legendaLimpa(v) { return texto(v).slice(0, LEGENDA_MAX) || null; }

  /* contexto: 'laudo' | 'bulk' | 'rnc' | 'rnc-encerramento'. Um nível só de pasta
     (o Anexos.caminho tira a barra), casando com a regra do Storage. */
  function caminho(contexto, chave, nomeOriginal, agoraMs) {
    return Anexos.caminho('qualidade', texto(contexto) + '_' + texto(chave), nomeOriginal, agoraMs);
  }

  function registro(arquivo, caminhoArquivo, url, autor, legenda, agoraIso) {
    var r = Anexos.registro(arquivo, caminhoArquivo, url, autor, agoraIso);
    r.legenda = legendaLimpa(legenda);
    return r;
  }

  /* Sobe as fotos escolhidas e devolve os registros para gravar junto da
     análise. pendentes: [{arquivo, legenda}]. Sem fotos, devolve []. */
  function enviar(storage, pendentes, opcoes) {
    var o = opcoes || {};
    var fila = (pendentes || []).slice(0, MAX_FOTOS);
    if (!fila.length) return Promise.resolve([]);
    var t0 = Date.now();
    return Promise.all(fila.map(function(p, i) {
      var v = Anexos.validar(p.arquivo, {perfil: 'imagem'});
      if (!v.ok) return Promise.reject(new Error(v.erros.join(' ')));
      var caminhoArq = caminho(o.contexto, o.chave, p.arquivo.name, t0 + i);
      var ref = storage.ref(caminhoArq);
      return Promise.resolve(ref.put(p.arquivo, {contentType: p.arquivo.type}))
        .then(function() { return ref.getDownloadURL(); })
        .then(function(url) { return registro(p.arquivo, caminhoArq, url, o.autor, p.legenda); });
    }));
  }

  /* ── Parte de tela ──────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; });
  }

  var estiloInjetado = false;
  function injetarEstilo() {
    if (estiloInjetado || typeof document === 'undefined') return;
    estiloInjetado = true;
    var st = document.createElement('style');
    st.textContent =
      '.fq{border:1.5px dashed var(--border,#d1d5db);border-radius:12px;padding:10px 12px;background:color-mix(in srgb,var(--text,#111) 2%,var(--card,#fff))}' +
      '.fq-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap}' +
      '.fq-btn{display:inline-flex;align-items:center;gap:6px;background:var(--primary,#1e3a8a);color:#fff;border-radius:999px;padding:7px 14px;font-size:13px;font-weight:700;cursor:pointer}' +
      '.fq-btn.off{opacity:.45;cursor:not-allowed}' +
      '.fq-btn input{display:none}' +
      '.fq-cont{font-size:12px;color:var(--muted,#6b7280)}' +
      '.fq-sem{font-size:12px;color:var(--muted,#6b7280);display:inline-flex;gap:5px;align-items:center;margin-left:auto}' +
      '.fq-lista{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:10px}' +
      '.fq-it{border:1px solid var(--border,#e5e7eb);border-radius:10px;overflow:hidden;background:var(--card,#fff);position:relative}' +
      '.fq-it img{display:block;width:100%;height:100px;object-fit:cover;background:#f3f4f6}' +
      '.fq-it input[type=text]{width:100%;box-sizing:border-box;border:0;border-top:1px solid var(--border,#e5e7eb);padding:6px 8px;font-size:12px;background:transparent;color:var(--text,#111)}' +
      '.fq-x{position:absolute;top:4px;right:4px;border:0;background:rgba(0,0,0,.6);color:#fff;border-radius:999px;width:24px;height:24px;cursor:pointer;line-height:1}' +
      '.fq-erro{color:var(--danger,#b91c1c);font-size:12px;margin-top:6px}' +
      '.fq-link{border:0;background:color-mix(in srgb,var(--primary,#1e3a8a) 10%,transparent);color:var(--primary,#1e3a8a);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:700;cursor:pointer}' +
      '.fq-gal-bg{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px}' +
      '.fq-gal{background:var(--card,#fff);color:var(--text,#111);border-radius:16px;max-width:880px;width:100%;max-height:90vh;overflow:auto;padding:16px 18px}' +
      '.fq-gal h3{margin:0 0 10px;font-size:16px}' +
      '.fq-gal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}' +
      '.fq-gal-grid figure{margin:0}' +
      '.fq-gal-grid img{width:100%;height:150px;object-fit:cover;border-radius:10px;background:#f3f4f6;cursor:zoom-in}' +
      '.fq-gal-grid figcaption{font-size:11.5px;color:var(--muted,#6b7280);margin-top:4px}';
    document.head.appendChild(st);
  }

  /* Monta o seletor dentro de `el`. opcoes: {permiteDispensa, aoMudar}.
     Devolve o controle: pendentes(), total(), dispensada(), limpar(). */
  function montar(el, opcoes) {
    injetarEstilo();
    var o = opcoes || {};
    var itens = [];          // [{arquivo, legenda, url}]
    var dispensada = false;
    var aviso = '';
    el.innerHTML =
      '<div class="fq"><div class="fq-top">' +
      '<label class="fq-btn"><input type="file" accept="image/*" multiple>📷 Anexar foto</label>' +
      '<span class="fq-cont"></span>' +
      (o.permiteDispensa ? '<label class="fq-sem"><input type="checkbox" class="fq-sem-cb"> Não há o que fotografar</label>' : '') +
      '</div><div class="fq-lista"></div><div class="fq-erro"></div></div>';
    var input = el.querySelector('input[type=file]');
    var cont = el.querySelector('.fq-cont');
    var listaEl = el.querySelector('.fq-lista');
    var erroEl = el.querySelector('.fq-erro');
    var btn = el.querySelector('.fq-btn');
    var cb = el.querySelector('.fq-sem-cb');

    function liberarUrls() {
      itens.forEach(function(i) { try { if (i.url && URL.revokeObjectURL) URL.revokeObjectURL(i.url); } catch (e) { /* nada */ } });
    }
    function desenhar() {
      cont.textContent = itens.length + ' de ' + MAX_FOTOS + (itens.length ? '' : (o.obrigatoria ? ' · obrigatória' : ' · opcional'));
      btn.classList.toggle('off', itens.length >= MAX_FOTOS);
      input.disabled = itens.length >= MAX_FOTOS;
      erroEl.textContent = aviso;
      listaEl.innerHTML = itens.map(function(it, i) {
        return '<div class="fq-it"><img src="' + esc(it.url) + '" alt="Foto ' + (i + 1) + '">' +
          '<button type="button" class="fq-x" data-i="' + i + '" title="Remover esta foto">×</button>' +
          '<input type="text" maxlength="' + LEGENDA_MAX + '" placeholder="Legenda (opcional)" data-i="' + i + '" value="' + esc(it.legenda) + '"></div>';
      }).join('');
      listaEl.querySelectorAll('.fq-x').forEach(function(b) {
        b.onclick = function() {
          var i = Number(b.getAttribute('data-i'));
          try { if (itens[i].url && URL.revokeObjectURL) URL.revokeObjectURL(itens[i].url); } catch (e) { /* nada */ }
          itens.splice(i, 1); aviso = ''; desenhar(); if (o.aoMudar) o.aoMudar();
        };
      });
      listaEl.querySelectorAll('input[type=text]').forEach(function(t) {
        t.oninput = function() { itens[Number(t.getAttribute('data-i'))].legenda = t.value; };
      });
    }
    input.onchange = function() {
      var novos = Array.prototype.slice.call(input.files || []);
      input.value = '';
      var lim = podeAdicionar(itens.length, novos.length);
      aviso = lim.erro || '';
      novos.slice(0, lim.aceitas).forEach(function(arq) {
        var v = Anexos.validar(arq, {perfil: 'imagem'});
        if (!v.ok) { aviso = (arq.name || 'Arquivo') + ': ' + v.erros.join(' '); return; }
        itens.push({arquivo: arq, legenda: '', url: (window.URL && URL.createObjectURL) ? URL.createObjectURL(arq) : ''});
      });
      if (itens.length) { dispensada = false; if (cb) cb.checked = false; }
      desenhar();
      if (o.aoMudar) o.aoMudar();
    };
    if (cb) cb.onchange = function() { dispensada = cb.checked; if (o.aoMudar) o.aoMudar(); };
    desenhar();
    return {
      pendentes: function() { return itens.map(function(i) { return {arquivo: i.arquivo, legenda: i.legenda}; }); },
      total: function() { return itens.length; },
      dispensada: function() { return !!dispensada && !itens.length; },
      limpar: function() { liberarUrls(); itens = []; dispensada = false; aviso = ''; if (cb) cb.checked = false; desenhar(); }
    };
  }

  /* ── Galeria (só leitura) ───────────────────────────────────────── */
  var galerias = {}, seq = 0;
  function botao(fotos, titulo) {
    var l = lista(fotos);
    if (!l.length) return '';
    var id = 'g' + (++seq);
    galerias[id] = {titulo: titulo, fotos: l};
    return '<button type="button" class="fq-link" onclick="FotosQualidade.abrir(\'' + id + '\')" title="Ver as fotos">📷 ' + l.length + '</button>';
  }
  function abrir(id) {
    var g = galerias[id];
    if (!g || typeof document === 'undefined') return;
    injetarEstilo();
    var bg = document.createElement('div');
    bg.className = 'fq-gal-bg';
    bg.innerHTML = '<div class="fq-gal" role="dialog" aria-label="Fotos"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px">' +
      '<h3>📷 ' + esc(g.titulo || 'Fotos') + ' (' + g.fotos.length + ')</h3><button type="button" class="fq-link fq-fechar">Fechar</button></div>' +
      '<div class="fq-gal-grid">' + g.fotos.map(function(f) {
        return '<figure><a href="' + esc(f.url) + '" target="_blank" rel="noopener"><img src="' + esc(f.url) + '" alt="' + esc(f.legenda || 'Foto') + '" loading="lazy"></a>' +
          '<figcaption>' + (f.legenda ? '<b>' + esc(f.legenda) + '</b><br>' : '') + esc(f.enviadoPor || '') + (f.enviadoEm ? ' · ' + esc(new Date(f.enviadoEm).toLocaleString('pt-BR')) : '') + '</figcaption></figure>';
      }).join('') + '</div></div>';
    function fechar() { if (bg.parentNode) bg.parentNode.removeChild(bg); }
    bg.addEventListener('click', function(e) { if (e.target === bg || (e.target.classList && e.target.classList.contains('fq-fechar'))) fechar(); });
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { fechar(); document.removeEventListener('keydown', onKey); } });
    document.body.appendChild(bg);
  }

  return {MAX_FOTOS: MAX_FOTOS, LEGENDA_MAX: LEGENDA_MAX, lista: lista, podeAdicionar: podeAdicionar, exigencia: exigencia,
    caminho: caminho, registro: registro, enviar: enviar, montar: montar, botao: botao, abrir: abrir};
});
