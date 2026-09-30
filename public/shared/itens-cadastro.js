/* Item de fórmula/BOM/OP precisa existir no cadastro de materiais (usuário,
   30/09: "se o item não existir no cadastro, não deveria aparecer na fórmula").

   Medido na base no dia: as fórmulas APROVADAS estavam limpas, mas 80 dos 183
   produtos com fórmula usavam uma versão em rascunho com item sem material
   vinculado (linhas da importação do Gerador de OPs, "pendente") ou com
   material inativo -- e o Emitir OP aceita versão não aprovada. Nenhuma OP
   tinha saído com item sem código, só por sorte.

   problemas(itens, materiais, campoCodigo) -> [{chave, codigo, motivo, texto}]
     motivo: SEM_CODIGO | NAO_CADASTRADO | INATIVO
     campoCodigo: 'mpCodigo' (fórmula, OP) ou 'materialCodigo' (BOM).
   Testado em run_itens_cadastro_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ItensCadastro = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function txt(v) { return String(v == null ? '' : v).trim(); }

  function indicePorCodigo(materiais) {
    var idx = {};
    Object.keys(materiais || {}).forEach(function(k) {
      var m = materiais[k];
      if (m && txt(m.mpCodigo)) idx[txt(m.mpCodigo)] = m;
    });
    return idx;
  }

  function problemas(itens, materiais, campoCodigo) {
    var campo = campoCodigo || 'mpCodigo';
    var idx = indicePorCodigo(materiais);
    var out = [];
    Object.keys(itens || {}).forEach(function(chave) {
      var it = itens[chave];
      if (!it) return;
      var codigo = txt(it[campo]);
      if (!codigo) {
        var orig = txt(it.textoOriginalGeradorOPs);
        out.push({chave: chave, codigo: '', motivo: 'SEM_CODIGO',
          texto: 'item sem material do cadastro' + (orig ? ' ("' + orig + '", da importação)' : ' (linha vazia)')});
        return;
      }
      var m = idx[codigo];
      if (!m) { out.push({chave: chave, codigo: codigo, motivo: 'NAO_CADASTRADO', texto: codigo + ' não existe no cadastro de materiais'}); return; }
      if (m.ativo === false) out.push({chave: chave, codigo: codigo, motivo: 'INATIVO', texto: codigo + ' — ' + txt(m.mpNome) + ' está inativo no cadastro'});
    });
    return out;
  }

  // Frase curta para alerta/bloqueio: até 4 itens citados.
  function mensagem(lista, onde) {
    if (!lista || !lista.length) return '';
    var itens = lista.slice(0, 4).map(function(p) { return p.texto; }).join('; ');
    return (onde || 'Há') + ' ' + lista.length + ' item(ns) fora do cadastro de materiais: ' + itens +
      (lista.length > 4 ? '; e mais ' + (lista.length - 4) : '') + '.';
  }

  return {problemas: problemas, mensagem: mensagem};
});
