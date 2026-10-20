/* Responsável comercial por cliente — quem, na Kuryos, responde pela conta.

   Pedido do usuário (2026-10-20): "criar um responsável por cliente, dentro
   da gestão comercial". Motor puro (sem Firebase): a tela passa o que leu.

   Por que lista PRÓPRIA e não `/usuarios` (medido em 2026-10-20):
   - `database.rules.json` só deixa `admin` e `rh` lerem a lista inteira de
     `/usuarios`. Quem usa o comercial é `pcp` (4 logins) e `admin` (3) — para
     o `pcp` um select alimentado de `/usuarios` nasceria VAZIO. O RH já
     resolveu isso com espelho público (`rh_colaboradores_publico`); aqui a
     lista é do próprio comercial.
   - O papel `comercial` NÃO existe: de 20 logins, nenhum é de vendedor. O
     responsável real pode não ter login nenhum, então `uidLogin` é OPCIONAL.
     Quando existe, habilita "minha carteira" sem refazer nada.

   Por que ID e não texto livre: grafia divergente já custou caro no próprio
   cliente (bloco de 19/10 — "Cliente em grafias diferentes virava opções
   separadas"). `responsavelComercialId` é a fonte da verdade;
   `responsavelComercialNome` é espelho para exportação e leitor antigo — o
   mesmo padrão de `contatoComNome` em `contatos-cliente.js`.

   Responsável desligado/removido não faz o cliente perder o dono em silêncio:
   o vínculo vira ÓRFÃO (`orfao: true`), mantém o nome espelhado na tela e
   aparece como pendência. Sumir com o dado seria pior que mostrá-lo vencido.

   Banco:
     comercial_config/responsaveis/{id} = {nome, email, uidLogin, ativo, criadoEm}
     clientes/{key}/responsavelComercialId   — id acima (fonte da verdade)
     clientes/{key}/responsavelComercialNome — espelho do nome
     clientes/{key}/responsavelComercialEm   — ISO da última atribuição
     clientes/{key}/responsavelComercialPor  — quem atribuiu */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ResponsavelComercial = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // Chave de cliente que o RTDB aceita como caminho. `.`, `#`, `$`, `[`, `]` e
  // `/` são proibidos; sem esta trava um nome estranho viraria caminho aninhado
  // no update (a armadilha do `database:update` registrada no CLAUDE.md).
  var CHAVE_VALIDA = /^[^.#$/[\]]+$/;

  function texto(v) { return typeof v === 'string' ? v.trim() : ''; }

  /* Nome comparável: sem acento, sem caixa, sem espaço dobrado. É o que
     impede "G. Callegaro" e "g callegaro" de virarem dois responsáveis. */
  function normalizar(v) {
    return texto(v).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').toUpperCase();
  }

  /* Lista ordenada por nome. Aceita o nó cru (`comercial_config/responsaveis`)
     ou o `comercial_config` inteiro — a tela às vezes tem um, às vezes o outro. */
  function lista(cfg) {
    var raiz = cfg && cfg.responsaveis ? cfg.responsaveis : (cfg || {});
    return Object.keys(raiz).filter(function(id) {
      return raiz[id] && typeof raiz[id] === 'object';
    }).map(function(id) {
      var r = raiz[id];
      return {
        id: id,
        nome: texto(r.nome),
        email: texto(r.email),
        uidLogin: texto(r.uidLogin) || null,
        ativo: r.ativo !== false,
        criadoEm: r.criadoEm || null
      };
    }).sort(function(a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
  }

  function ativos(cfg) { return lista(cfg).filter(function(r) { return r.ativo; }); }

  function porId(cfg, id) {
    if (!id) return null;
    return lista(cfg).find(function(r) { return r.id === id; }) || null;
  }

  /* O responsável do usuário logado, para o filtro "minha carteira". Só acha
     quem tem `uidLogin` preenchido — representante sem login não tem carteira
     própria na tela, e isso é esperado, não falha. */
  function porUid(cfg, uid) {
    if (!texto(uid)) return null;
    return lista(cfg).find(function(r) { return r.uidLogin === texto(uid); }) || null;
  }

  /* Valida a lista inteira e devolve o objeto a gravar em
     `comercial_config/responsaveis`. Lança com mensagem de tela, como
     `ContatosCliente.salvar` faz. */
  function salvar(ls) {
    var out = {}, nomes = {}, uids = {};
    (ls || []).forEach(function(r) {
      var id = texto(r.id);
      if (!ID_VALIDO.test(id)) throw Error('Identificador de responsável inválido.');
      if (out[id]) throw Error('Identificador de responsável duplicado: ' + id + '.');
      var nome = texto(r.nome);
      if (!nome) throw Error('Todo responsável precisa de nome.');
      var chave = normalizar(nome);
      if (nomes[chave]) throw Error('Dois responsáveis com o mesmo nome: ' + nome + '. Use nomes distintos — é o que evita a carteira dividida por grafia.');
      nomes[chave] = id;
      var email = texto(r.email);
      if (email && !EMAIL.test(email)) throw Error('Confira o e-mail de ' + nome + '.');
      var uid = texto(r.uidLogin);
      if (uid && uids[uid]) throw Error('O mesmo login está em dois responsáveis (' + nome + '). "Minha carteira" ficaria ambígua.');
      if (uid) uids[uid] = id;
      out[id] = {
        nome: nome,
        email: email,
        uidLogin: uid || null,
        ativo: r.ativo !== false,
        criadoEm: r.criadoEm || null
      };
    });
    return out;
  }

  /* O responsável de UM cliente, já resolvido. `orfao` marca vínculo que
     aponta para responsável removido da lista; `inativo`, para quem continua
     na lista mas foi desligado. Nos dois casos o nome espelhado é mostrado. */
  function doCliente(cliente, cfg) {
    var c = cliente || {};
    var id = texto(c.responsavelComercialId);
    var espelho = texto(c.responsavelComercialNome);
    if (!id) return {id: null, nome: '', atribuido: false, orfao: false, inativo: false, em: null, por: null};
    var r = porId(cfg, id);
    return {
      id: id,
      nome: r ? r.nome : espelho,
      atribuido: true,
      orfao: !r,
      inativo: !!r && !r.ativo,
      em: c.responsavelComercialEm || null,
      por: c.responsavelComercialPor || null
    };
  }

  /* Caminhos PLANOS para o update. Nunca objeto aninhado: `database:update`
     com objeto aninhado APAGA campos irmãos (armadilha confirmada no
     CLAUDE.md, custou 375 produtos). */
  function atribuir(clienteKey, responsavel, meta) {
    var k = texto(clienteKey);
    if (!k || !CHAVE_VALIDA.test(k)) throw Error('Chave de cliente inválida.');
    var m = meta || {}, base = 'clientes/' + k + '/', u = {};
    if (!responsavel) {
      u[base + 'responsavelComercialId'] = null;
      u[base + 'responsavelComercialNome'] = null;
      u[base + 'responsavelComercialEm'] = null;
      u[base + 'responsavelComercialPor'] = null;
      return u;
    }
    var id = texto(responsavel.id), nome = texto(responsavel.nome);
    if (!ID_VALIDO.test(id)) throw Error('Identificador de responsável inválido.');
    if (!nome) throw Error('Responsável sem nome.');
    u[base + 'responsavelComercialId'] = id;
    u[base + 'responsavelComercialNome'] = nome;
    u[base + 'responsavelComercialEm'] = m.em || new Date().toISOString();
    u[base + 'responsavelComercialPor'] = texto(m.por) || null;
    return u;
  }

  /* Atribuição em massa: um único update para N clientes. Com 60 clientes e
     zero preenchidos, atribuir de um em um pelo modal do cadastro seriam 60
     modais — por isso a tela faz em lote. */
  function atribuirVarios(clienteKeys, responsavel, meta) {
    var u = {};
    (clienteKeys || []).forEach(function(k) { Object.assign(u, atribuir(k, responsavel, meta)); });
    return u;
  }

  /* Clientes que ficariam sem dono se este responsável fosse desligado.
     A tela avisa antes; desligar em silêncio deixaria carteira órfã. */
  function clientesDe(clientes, id) {
    var alvo = texto(id);
    if (!alvo) return [];
    return Object.keys(clientes || {}).filter(function(k) {
      var c = clientes[k];
      return c && typeof c === 'object' && texto(c.responsavelComercialId) === alvo;
    }).sort();
  }

  /* Carteira por responsável + o que falta atribuir. `semResponsavel` e
     `orfaos` são a lista de trabalho: é por onde a cobertura sai do zero. */
  function cobertura(clientes, cfg, opcoes) {
    var o = opcoes || {}, cs = clientes || {};
    var soAtivos = o.somenteClientesAtivos !== false;
    var chaves = Object.keys(cs).filter(function(k) {
      var c = cs[k];
      if (!c || typeof c !== 'object') return false;
      return soAtivos ? c.ativo !== false : true;
    });
    var porResp = {}, semResponsavel = [], orfaos = [];
    lista(cfg).forEach(function(r) {
      porResp[r.id] = {id: r.id, nome: r.nome, ativo: r.ativo, clientes: [], total: 0};
    });
    chaves.forEach(function(k) {
      var d = doCliente(cs[k], cfg);
      if (!d.atribuido) { semResponsavel.push(k); return; }
      if (d.orfao) { orfaos.push({clienteKey: k, id: d.id, nome: d.nome}); return; }
      porResp[d.id].clientes.push(k);
      porResp[d.id].total++;
    });
    var carteiras = Object.keys(porResp).map(function(id) { return porResp[id]; })
      .sort(function(a, b) { return b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'); });
    return {
      totalClientes: chaves.length,
      atribuidos: chaves.length - semResponsavel.length - orfaos.length,
      semResponsavel: semResponsavel.sort(),
      orfaos: orfaos,
      carteiras: carteiras,
      pctCobertura: chaves.length ? (chaves.length - semResponsavel.length - orfaos.length) / chaves.length : 0
    };
  }

  function novoId() {
    var r = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(36).slice(2);
    return 'rc_' + String(r).replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  }

  return {
    normalizar: normalizar,
    lista: lista,
    ativos: ativos,
    porId: porId,
    porUid: porUid,
    salvar: salvar,
    doCliente: doCliente,
    atribuir: atribuir,
    atribuirVarios: atribuirVarios,
    clientesDe: clientesDe,
    cobertura: cobertura,
    novoId: novoId
  };
});
