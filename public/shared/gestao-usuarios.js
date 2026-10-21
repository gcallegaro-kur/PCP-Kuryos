/* Desativar e excluir usuário. Motor puro (sem Firebase): a tela passa o que leu.

   Pedido do usuário (2026-10-21): "quero poder excluir usuarios, é possível?".
   Até aqui a tela só trocava papel e marcava módulos.

   DUAS operações, e elas não são a mesma coisa:

   1. `desativar` / `excluir` tiram o acesso ao APP. Funciona hoje, 100% no
      cliente: `auth_check.js` barra `ativo === false` e trata perfil ausente
      como "sem perfil", mandando pro login em qualquer página.
   2. Apagar a CREDENCIAL (conta do Firebase Auth) exige Admin SDK, que vive
      nas Cloud Functions -- mortas pelo incidente de billing de 19/10. A tela
      não consegue, e fingir que consegue seria pior.

   Daí a lápide: `excluir` remove `usuarios/{uid}` E grava
   `usuarios_removidos/{uid}` com `authPendente: true`. Sem isso a conta de
   login viraria fantasma -- autentica, leva "acesso pendente" e não aparece
   em lista nenhuma. Medido em 21/10: JÁ existiam 2 fantasmas assim
   (`tom@kuryos.com.br` e `gustavosilvabraulio20@gmail.com`), criados por
   exclusão parcial anterior. A lápide é o que faz a pendência ficar visível.

   Por que `desativar` é o padrão e `excluir` a exceção: o nome de quem assinou
   apontamento, auditoria 5S e laudo é gravado como TEXTO no próprio registro,
   então o histórico sobrevive à exclusão -- mas o perfil não volta, e só o
   Console recria. Desativar é reversível; excluir é para linha que nunca
   virou pessoa (duplicata de duplo clique, pendente que nunca entrou).

   Travas que não são opcionais: ninguém se desativa/exclui a si mesmo, e o
   ÚLTIMO admin ativo não pode sair. Sem isso o app fica sem ninguém capaz de
   consertar, e a recuperação só existe pelo Console.

   Banco:
     usuarios/{uid}/ativo            — false desativa (ausente = ativo)
     usuarios/{uid}/desativadoEm     — ISO
     usuarios/{uid}/desativadoPor    — nome de quem desativou
     usuarios_removidos/{uid}        — lápide {nome, email, role, removidoEm,
                                       removidoPor, authPendente} */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GestaoUsuarios = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  // Chave que o RTDB aceita como caminho. Sem esta trava um uid estranho
  // viraria caminho aninhado no update (armadilha do CLAUDE.md).
  var UID_VALIDO = /^[^.#$/[\]]+$/;

  function texto(v) { return typeof v === 'string' ? v.trim() : ''; }

  function normalizarEmail(v) { return texto(v).toLowerCase(); }

  /* Ativo é o padrão: registro antigo não tem o campo, e tratar ausência como
     inativo trancaria os 24 usuários de uma vez no primeiro deploy. */
  function ativo(u) { return !u || u.ativo !== false; }

  function estado(u) {
    if (!u) return 'AUSENTE';
    if (u.ativo === false) return 'INATIVO';
    if (texto(u.role) === 'pending') return 'PENDENTE';
    return 'ATIVO';
  }

  function lista(usuarios) {
    var us = usuarios || {};
    return Object.keys(us).filter(function(uid) {
      return us[uid] && typeof us[uid] === 'object';
    }).map(function(uid) {
      var u = us[uid];
      return {
        uid: uid,
        nome: texto(u.nome),
        email: texto(u.email),
        role: texto(u.role) || 'pending',
        ativo: ativo(u),
        estado: estado(u),
        criadoEm: u.created_at || null,
        desativadoEm: u.desativadoEm || null,
        desativadoPor: u.desativadoPor || null
      };
    }).sort(function(a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
  }

  /* Admins que ainda conseguem entrar. É a conta que as travas protegem. */
  function adminsAtivos(usuarios) {
    return lista(usuarios).filter(function(u) { return u.role === 'admin' && u.ativo; });
  }

  /* Pode sair de cena? Vale para desativar E para excluir -- os dois tiram o
     acesso, então a trava é a mesma. Devolve {ok, motivo}. */
  function podeRemover(usuarios, uid, uidAtual) {
    var alvo = (usuarios || {})[uid];
    if (!alvo || typeof alvo !== 'object') return {ok: false, motivo: 'Usuário não encontrado.'};
    if (!UID_VALIDO.test(String(uid || ''))) return {ok: false, motivo: 'Identificador de usuário inválido.'};
    if (uid === uidAtual) return {ok: false, motivo: 'Você não pode desativar nem excluir o seu próprio acesso.'};
    var admins = adminsAtivos(usuarios);
    if (texto(alvo.role) === 'admin' && ativo(alvo) && admins.length <= 1) {
      return {ok: false, motivo: 'Este é o último administrador ativo. Promova outro antes de tirar o acesso dele — senão ninguém consegue mais gerenciar usuários.'};
    }
    return {ok: true, motivo: ''};
  }

  /* Excluir é mais forte que desativar: o perfil não volta pelo app. Só é
     RECOMENDADO para linha sem história -- pendente ou que nunca acessou. A
     tela avisa, mas não proíbe: duplicata de duplo clique precisa sair. */
  function recomendaExcluir(u) {
    if (!u) return false;
    return texto(u.role) === 'pending';
  }

  /* Caminhos PLANOS. Objeto aninhado em update APAGA campos irmãos (CLAUDE.md). */
  function desativar(uid, meta) {
    if (!UID_VALIDO.test(String(uid || ''))) throw Error('Identificador de usuário inválido.');
    var m = meta || {}, base = 'usuarios/' + uid + '/', u = {};
    u[base + 'ativo'] = false;
    u[base + 'desativadoEm'] = m.em || new Date().toISOString();
    u[base + 'desativadoPor'] = texto(m.por) || null;
    return u;
  }

  function reativar(uid, meta) {
    if (!UID_VALIDO.test(String(uid || ''))) throw Error('Identificador de usuário inválido.');
    var m = meta || {}, base = 'usuarios/' + uid + '/', u = {};
    u[base + 'ativo'] = true;
    u[base + 'desativadoEm'] = null;
    u[base + 'desativadoPor'] = null;
    u[base + 'reativadoEm'] = m.em || new Date().toISOString();
    u[base + 'reativadoPor'] = texto(m.por) || null;
    return u;
  }

  /* Remove a linha e deixa a lápide no mesmo update -- as duas coisas juntas,
     senão uma falha no meio deixa a conta sem registro E sem lápide, que é
     exatamente o fantasma que isto existe para evitar. */
  function excluir(uid, u, meta) {
    if (!UID_VALIDO.test(String(uid || ''))) throw Error('Identificador de usuário inválido.');
    var alvo = u || {}, m = meta || {}, out = {};
    out['usuarios/' + uid] = null;
    out['usuarios_removidos/' + uid + '/nome'] = texto(alvo.nome) || null;
    out['usuarios_removidos/' + uid + '/email'] = texto(alvo.email) || null;
    out['usuarios_removidos/' + uid + '/role'] = texto(alvo.role) || null;
    out['usuarios_removidos/' + uid + '/criadoEm'] = alvo.created_at || null;
    out['usuarios_removidos/' + uid + '/removidoEm'] = m.em || new Date().toISOString();
    out['usuarios_removidos/' + uid + '/removidoPor'] = texto(m.por) || null;
    // A credencial no Firebase Auth continua existindo: a tela não consegue
    // apagá-la (precisa de Admin SDK). Fica como pendência VISÍVEL.
    out['usuarios_removidos/' + uid + '/authPendente'] = true;
    return out;
  }

  /* O ADM confirmou que apagou a conta no Console: tira a pendência sem
     perder a lápide. */
  function marcarAuthApagado(uid, meta) {
    if (!UID_VALIDO.test(String(uid || ''))) throw Error('Identificador de usuário inválido.');
    var m = meta || {}, base = 'usuarios_removidos/' + uid + '/', u = {};
    u[base + 'authPendente'] = false;
    u[base + 'authApagadoEm'] = m.em || new Date().toISOString();
    u[base + 'authApagadoPor'] = texto(m.por) || null;
    return u;
  }

  function diasDesde(iso, hoje) {
    if (!iso) return null;
    var a = new Date(iso), b = hoje ? new Date(hoje) : new Date();
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
    return Math.max(0, Math.floor((b - a) / 86400000));
  }

  /* Mesma pessoa com mais de um login. O e-mail é a chave, porque foi por aí
     que a duplicata nasceu: o projeto aceita várias contas com o mesmo
     e-mail, e o duplo clique no cadastro criou 3 de uma vez. Também agrupa
     por nome, para pegar o caso do e-mail digitado errado. */
  function duplicados(usuarios) {
    var ls = lista(usuarios), porEmail = {}, porNome = {};
    function norm(s) {
      return texto(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').toUpperCase();
    }
    ls.forEach(function(u) {
      if (u.email) (porEmail[normalizarEmail(u.email)] = porEmail[normalizarEmail(u.email)] || []).push(u);
      if (u.nome) (porNome[norm(u.nome)] = porNome[norm(u.nome)] || []).push(u);
    });
    var grupo = function(mapa, tipo) {
      return Object.keys(mapa).filter(function(k) { return mapa[k].length > 1; })
        .map(function(k) { return {tipo: tipo, chave: k, usuarios: mapa[k]}; })
        .sort(function(a, b) { return b.usuarios.length - a.usuarios.length || a.chave.localeCompare(b.chave); });
    };
    return {porEmail: grupo(porEmail, 'EMAIL'), porNome: grupo(porNome, 'NOME')};
  }

  /* Painel do ADM: o que precisa de decisão. `pendentes` ordenado pelo que
     espera há mais tempo -- medido em 21/10, uma pessoa estava pendente desde
     julho, e ninguém via isso porque a lista não dizia há quanto tempo. */
  function resumo(usuarios, removidos, hoje) {
    var ls = lista(usuarios), rem = removidos || {};
    var pendentes = ls.filter(function(u) { return u.estado === 'PENDENTE'; })
      .map(function(u) { return Object.assign({}, u, {diasEsperando: diasDesde(u.criadoEm, hoje)}); })
      .sort(function(a, b) { return (b.diasEsperando || 0) - (a.diasEsperando || 0); });
    var dup = duplicados(usuarios);
    return {
      total: ls.length,
      ativos: ls.filter(function(u) { return u.estado === 'ATIVO'; }).length,
      inativos: ls.filter(function(u) { return u.estado === 'INATIVO'; }).length,
      pendentes: pendentes,
      adminsAtivos: adminsAtivos(usuarios).length,
      duplicados: dup,
      // Lápides cuja conta de login ainda existe: a pendência do Console.
      authPendente: Object.keys(rem).filter(function(k) {
        return rem[k] && typeof rem[k] === 'object' && rem[k].authPendente === true;
      }).map(function(k) { return Object.assign({uid: k}, rem[k]); })
        .sort(function(a, b) { return String(b.removidoEm || '').localeCompare(String(a.removidoEm || '')); })
    };
  }

  return {
    ativo: ativo,
    estado: estado,
    lista: lista,
    adminsAtivos: adminsAtivos,
    podeRemover: podeRemover,
    recomendaExcluir: recomendaExcluir,
    desativar: desativar,
    reativar: reativar,
    excluir: excluir,
    marcarAuthApagado: marcarAuthApagado,
    diasDesde: diasDesde,
    duplicados: duplicados,
    resumo: resumo
  };
});
