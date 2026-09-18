/* Anexos de arquivo (Firebase Storage) — regras comuns a todas as telas.

   O Storage já existia para os documentos do Comercial (`/comercial/...`).
   Este módulo tira as regras de dentro da tela para que o próximo caso —
   foto de não conformidade, certificado de calibração, PDF do COA — use o
   mesmo limite, a mesma validação e o mesmo formato de registro, em vez de
   cada tela reinventar o seu.

   Pedido do usuário (2026-09-17): "vamos fazer isto, assim pedimos uma foto
   de prova da pesagem também, usado como backlog e auditoria". A primeira
   aplicação é a foto da pesagem do granel: prova de que aquele peso foi o
   que a balança mostrou.

   O arquivo vai para o Storage; o que fica no banco é só o registro
   (nome, caminho, url, tamanho, quem enviou, quando) -- o mesmo padrão que
   `documentos_comerciais` já usa. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Anexos = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var LIMITE_PADRAO_MB = 10;      // foto de celular cabe folgado
  var LIMITE_DOCUMENTO_MB = 20;   // PDF de proposta/COA
  var TIPOS = {
    imagem: ['image/'],
    documento: ['image/', 'application/pdf']
  };

  function texto(v) { return String(v == null ? '' : v).trim(); }

  // Nome seguro e único: mantém a extensão, tira acento e caractere de path.
  function nomeArmazenado(nomeOriginal, agoraMs) {
    var base = texto(nomeOriginal) || 'arquivo';
    var limpo = base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    return (agoraMs || Date.now()) + '_' + limpo;
  }

  function caminho(pasta, chave, nomeOriginal, agoraMs) {
    var p = texto(pasta).replace(/[^a-zA-Z0-9_-]/g, '');
    var k = texto(chave).replace(/[^a-zA-Z0-9._-]/g, '-');
    return p + '/' + k + '/' + nomeArmazenado(nomeOriginal, agoraMs);
  }

  /* arquivo: {name, size, type} (o File do navegador serve).
     opcoes: {perfil: 'imagem'|'documento', limiteMb} */
  function validar(arquivo, opcoes) {
    var o = opcoes || {};
    var perfil = o.perfil === 'documento' ? 'documento' : 'imagem';
    var limite = (o.limiteMb || (perfil === 'documento' ? LIMITE_DOCUMENTO_MB : LIMITE_PADRAO_MB)) * 1024 * 1024;
    var erros = [];
    if (!arquivo || !arquivo.name) return {ok: false, erros: ['Escolha um arquivo.']};
    if (!(arquivo.size > 0)) erros.push('Arquivo vazio.');
    if (arquivo.size > limite) {
      erros.push('Arquivo de ' + tamanhoLegivel(arquivo.size) + ' — o limite é ' + Math.round(limite / 1024 / 1024) + ' MB.');
    }
    var tipo = texto(arquivo.type);
    var aceito = TIPOS[perfil].some(function(pref) { return tipo.indexOf(pref) === 0 || tipo === pref; });
    if (!aceito) {
      erros.push(perfil === 'imagem'
        ? 'Só imagem (foto) é aceita aqui.'
        : 'Só imagem ou PDF são aceitos aqui.');
    }
    return {ok: !erros.length, erros: erros};
  }

  function tamanhoLegivel(bytes) {
    var b = Number(bytes) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
    return (Math.round(b / 1024 / 1024 * 10) / 10) + ' MB';
  }

  // Registro que vai para o banco (nunca o arquivo em si).
  function registro(arquivo, caminhoArquivo, url, autor, agoraIso) {
    return {
      nomeOriginal: texto(arquivo && arquivo.name),
      caminho: texto(caminhoArquivo),
      url: texto(url) || null,
      bytes: Number(arquivo && arquivo.size) || 0,
      contentType: texto(arquivo && arquivo.type) || null,
      enviadoPor: texto(autor) || null,
      enviadoEm: agoraIso || new Date().toISOString()
    };
  }

  function lista(no) {
    var m = no || {};
    return Object.keys(m).map(function(id) { return Object.assign({id: id}, m[id]); })
      .filter(function(a) { return a && a.caminho; })
      .sort(function(a, b) { return texto(a.enviadoEm).localeCompare(texto(b.enviadoEm)); });
  }

  return {
    LIMITE_PADRAO_MB: LIMITE_PADRAO_MB, LIMITE_DOCUMENTO_MB: LIMITE_DOCUMENTO_MB,
    nomeArmazenado: nomeArmazenado, caminho: caminho, validar: validar,
    tamanhoLegivel: tamanhoLegivel, registro: registro, lista: lista
  };
});
