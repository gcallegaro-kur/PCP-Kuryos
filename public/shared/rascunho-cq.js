/* Rascunho do laudo da Qualidade (27/10/2026).
   Pedido do usuário: o que a analista digita no laudo (ou na análise do
   granel) se perdia ao clicar fora do popup, apertar Esc ou trocar de tela.
   Agora o formulário é gravado enquanto ela digita em
   qualidade_rascunhos/{chave}, a fila mostra o item como "Em preenchimento"
   e, ao reabrir, tudo volta. O rascunho some quando a decisão é registrada.

   O conteúdo vai como TEXTO JSON (campo `dados`), não como árvore: o RTDB
   descarta null dentro de lista (pesos [null, null, 12] voltariam como
   {2: 12}) e recusa chave com ponto -- os ensaios da especificação usam
   chaves livres. Fotos NÃO entram: só sobem para o Storage na decisão. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RascunhoCQ = factory();
})(typeof self !== 'undefined' ? self : this, function() {
  var NO = 'qualidade_rascunhos';
  var TAMANHO_MAX = 200000;

  function limpa(s) { return String(s == null ? '' : s).replace(/[.#$\[\]\/]/g, '_'); }

  // PA sai por lote (OP): um rascunho por OP, como o laudo.
  function chaveLaudo(itemCodigo, loteKey, opKey) {
    return opKey ? 'pa_' + limpa(opKey) : 'lote_' + limpa(itemCodigo) + '__' + limpa(loteKey);
  }
  function chaveGranel(opKey) { return 'granel_' + limpa(opKey); }

  /* Campos fixos do formulário, por id. Fica de fora: campo desabilitado
     (veio da Logística e não se altera no laudo), arquivo, e o que a tela
     deriva do modelo (`ignorar`). Os campos montados a partir do modelo
     (ensaios, pesos, amostras) não têm id e voltam pelo `estado`. */
  function coletarCampos(raiz, ignorar) {
    var fora = {};
    (ignorar || []).forEach(function(id) { fora[id] = true; });
    var campos = {};
    raiz.querySelectorAll('input[id], select[id], textarea[id]').forEach(function(el) {
      if (fora[el.id] || el.disabled || el.type === 'file') return;
      campos[el.id] = el.type === 'checkbox' ? !!el.checked : el.value;
    });
    return campos;
  }
  function aplicarCampos(raiz, campos) {
    Object.keys(campos || {}).forEach(function(id) {
      var el = raiz.querySelector('#' + id);
      if (!el || el.disabled) return;
      if (el.type === 'checkbox') el.checked = !!campos[id];
      else el.value = campos[id] == null ? '' : campos[id];
    });
  }

  function montarRegistro(tipo, ids, conteudo, usuario, agoraIso, anterior) {
    var dados = JSON.stringify(conteudo || {});
    if (dados.length > TAMANHO_MAX) return null;
    var reg = {
      tipo: tipo, dados: dados, atualizadoEm: agoraIso,
      por: (usuario && usuario.nome) || null, porUid: (usuario && usuario.uid) || null,
      iniciadoEm: (anterior && anterior.iniciadoEm) || agoraIso,
      iniciadoPor: (anterior && anterior.iniciadoPor) || (usuario && usuario.nome) || null
    };
    Object.keys(ids || {}).forEach(function(k) { if (ids[k] != null) reg[k] = String(ids[k]); });
    return reg;
  }

  // Registro corrompido ou de outra versão não pode travar a abertura do laudo.
  function ler(reg) {
    if (!reg || typeof reg.dados !== 'string') return null;
    try {
      var c = JSON.parse(reg.dados);
      return c && typeof c === 'object' ? c : null;
    } catch (e) { return null; }
  }

  function horaCurta(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function(n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  // "Em preenchimento — Ana, salvo 27/10 14:32"
  function rotulo(reg) {
    if (!reg) return '';
    return 'Em preenchimento' + (reg.por ? ' — ' + reg.por : '') +
      (reg.atualizadoEm ? ', salvo ' + horaCurta(reg.atualizadoEm) : '');
  }

  /* Gravação adiada: cada tecla reagenda; `agora()` grava o que estiver
     pendente (fechar o popup, sair da tela). `salvar` é chamado na HORA,
     não num microtask: quem fecha o popup zera o laudo logo depois de
     chamar `agora()`, e o retrato precisa sair antes disso. */
  function criarAutosave(salvar, atrasoMs, relogio) {
    // Embrulhado: setTimeout chamado como método de outro objeto dá
    // "Illegal invocation" no navegador.
    var t = relogio || {set: function(f, ms) { return setTimeout(f, ms); }, clear: function(id) { clearTimeout(id); }};
    var timer = null, pendente = false;
    function disparar() {
      timer = null;
      if (!pendente) return Promise.resolve(false);
      pendente = false;
      var r;
      try { r = salvar(); } catch (e) { return Promise.reject(e); }
      return Promise.resolve(r).then(function() { return true; });
    }
    return {
      agendar: function() {
        pendente = true;
        if (timer) t.clear(timer);
        timer = t.set(disparar, atrasoMs == null ? 1200 : atrasoMs);
      },
      agora: function() {
        if (timer) { t.clear(timer); timer = null; }
        return disparar();
      },
      cancelar: function() {
        if (timer) t.clear(timer);
        timer = null; pendente = false;
      },
      pendente: function() { return pendente; }
    };
  }

  return {NO: NO, TAMANHO_MAX: TAMANHO_MAX, chaveLaudo: chaveLaudo, chaveGranel: chaveGranel,
    coletarCampos: coletarCampos, aplicarCampos: aplicarCampos, montarRegistro: montarRegistro,
    ler: ler, rotulo: rotulo, horaCurta: horaCurta, criarAutosave: criarAutosave};
});
