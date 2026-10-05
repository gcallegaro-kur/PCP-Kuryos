/* Consulta de Estoque (01/10/2026).

   Pedido do usuário: "ver os produtos intermediários que temos em estoque,
   buscando casar envases também" e uma consulta de estoque "mais didática,
   com melhor UI/UX, mais informação útil, de forma ágil e dinâmica".

   Este módulo é só leitura e puro: recebe os nós do banco e devolve linhas,
   contadores e o casamento bulk x embalagem. A tela (consulta_estoque.html)
   só lê o banco e desenha. Nada aqui grava.

   Três ideias:
   - linhas(): uma linha por item (material do saldo agregado + produto
     acabado dos lotes), já com lotes, validade, quarentena, empenho e as
     "etiquetas" de situação que a tela usa como filtro rápido;
   - filtrar()/contagens(): busca por palavras (qualquer ordem, sem acento) e
     filtros que mostram quantos itens cada um deixaria na tela;
   - intermediarios(): o bulk que já foi manipulado e ainda não virou produto,
     casado com as embalagens que existem no estoque para envasá-lo. O gargalo
     é o item da BOM que acaba primeiro. Material do cliente só conta para o
     produto dele, e o que está empenhado para OUTRAS OPs não conta (o
     empenho da própria OP, sim).

   Testado em run_consulta_estoque_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ConsultaEstoque = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var GRUPOS = {
    MPGR: {rotulo: 'Matéria-prima', curto: 'MP', cor: '#2e4fc0'},
    MPES: {rotulo: 'Fragrância/essência', curto: 'Essência', cor: '#9a4dd6'},
    EP: {rotulo: 'Embalagem primária', curto: 'Emb. 1ª', cor: '#12967d'},
    ES: {rotulo: 'Embalagem secundária', curto: 'Emb. 2ª', cor: '#c9910a'},
    ET: {rotulo: 'Embalagem terciária', curto: 'Emb. 3ª', cor: '#b5651d'},
    MU: {rotulo: 'Uso e consumo', curto: 'Consumo', cor: '#6e6e73'},
    PA: {rotulo: 'Produto acabado', curto: 'PA', cor: '#0a1c69'},
    OUTRO: {rotulo: 'Outros', curto: 'Outros', cor: '#6e6e73'}
  };
  var ORDEM_GRUPOS = ['MPGR', 'MPES', 'EP', 'ES', 'ET', 'MU', 'PA', 'OUTRO'];
  var STATUS_OK = {LIBERADO: 1, APROVADO_CONCESSAO: 1, LIBERADO_EXPEDICAO: 1, LEGADO_ESTOQUE: 1};
  var DIAS_VENCENDO = 30;

  function txt(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function arred(v, c) { var f = Math.pow(10, c == null ? 3 : c); return Math.round(num(v) * f) / f; }
  function norm(s) {
    return txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
  }
  function chaveSegura(s) { return txt(s).replace(/[.#$\[\]\/]/g, '-'); }

  // 'YYYY-MM-DD' vira meio-dia local: new Date('2026-10-01') é UTC e mostraria o dia anterior.
  function dataLocal(v) {
    var s = txt(v); if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    var d = m ? new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0) : new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function diasAte(validade, hoje) {
    var v = dataLocal(validade); if (!v) return null;
    var h = hoje instanceof Date ? hoje : new Date(hoje || Date.now());
    var a = new Date(h.getFullYear(), h.getMonth(), h.getDate(), 12, 0, 0);
    return Math.round((v.getTime() - a.getTime()) / 86400000);
  }

  function grupoDoTipo(tipo) {
    var t = txt(tipo).toUpperCase();
    return GRUPOS[t] ? t : 'OUTRO';
  }

  function porClienteDe(reg) {
    var out = {}, pc = (reg && reg.porCliente) || {};
    Object.keys(pc).forEach(function(k) {
      var v = pc[k] || {};
      out[k] = {nome: txt(v.clienteNome) || k, saldo: num(v.saldoAtual)};
    });
    return out;
  }
  function somaClientes(pc) {
    return Object.keys(pc).reduce(function(s, k) { return s + pc[k].saldo; }, 0);
  }

  /* Lotes de um item (material ou produto) a partir de estoque_lotes/{item}. */
  function lotesDoItem(mapa, hoje, diasVenc) {
    var lista = [];
    Object.keys(mapa || {}).forEach(function(k) {
      var l = mapa[k]; if (!l) return;
      var saldo = num(l.saldoLote);
      if (!(saldo > 0)) return;
      var dias = diasAte(l.dataValidade, hoje);
      lista.push({
        chave: k,
        lote: txt(l.loteInterno) || txt(l.loteOrigem) || txt(l.identificadorPalete) || k,
        loteFornecedor: txt(l.loteOrigem) && txt(l.loteOrigem) !== 'NA' ? txt(l.loteOrigem) : '',
        saldo: saldo,
        status: txt(l.status) || '—',
        liberado: !!STATUS_OK[txt(l.status)],
        validade: txt(l.dataValidade),
        dias: dias,
        vencido: dias != null && dias < 0,
        vencendo: dias != null && dias >= 0 && dias <= diasVenc,
        endereco: txt(l.enderecoCodigo),
        dono: l.propriedade && l.propriedade.clienteNome ? txt(l.propriedade.clienteNome) : (txt(l.cliente) || ''),
        origem: txt(l.origemTipo),
        recebidoEm: txt(l.dataRecebimento) || txt(l.criadoEm).slice(0, 10)
      });
    });
    lista.sort(function(a, b) {
      // Vence primeiro quem vence primeiro (FEFO); sem validade vai para o fim.
      var da = a.dias == null ? 1e9 : a.dias, db = b.dias == null ? 1e9 : b.dias;
      return da - db || String(a.lote).localeCompare(String(b.lote));
    });
    return lista;
  }

  function resumirLotes(lotes) {
    var r = {quarentena: 0, reprovado: 0, vencido: 0, vencendo: 0, liberado: 0, proxValidade: '', proxDias: null, enderecos: []};
    var enders = {};
    lotes.forEach(function(l) {
      if (l.status === 'QUARENTENA') r.quarentena += l.saldo;
      else if (l.status === 'REPROVADO') r.reprovado += l.saldo;
      else if (l.liberado) r.liberado += l.saldo;
      if (l.vencido) r.vencido += l.saldo;
      else if (l.vencendo) r.vencendo += l.saldo;
      if (l.dias != null && (r.proxDias == null || l.dias < r.proxDias)) { r.proxDias = l.dias; r.proxValidade = l.validade; }
      if (l.endereco) enders[l.endereco] = 1;
    });
    r.enderecos = Object.keys(enders).sort();
    return r;
  }

  /* Etiquetas de situação: o que a pessoa precisa notar sem abrir a linha. */
  function etiquetas(r) {
    var t = [];
    // Material sem "Controla estoque" (ex.: água): não dá baixa nem é reservado, então saldo/falta não se aplicam.
    if (r.semControle) return ['semControle'];
    if (r.atual < 0) t.push('negativo');
    else if (r.disponivel < 0) t.push('falta');
    if (!r.semRegistro && r.atual === 0) t.push('zerado');
    if (r.vencido > 0) t.push('vencido');
    if (r.vencendo > 0) t.push('vencendo');
    if (r.quarentena > 0) t.push('quarentena');
    if (r.empenhado > 0 && r.disponivel >= 0) t.push('empenhado');
    if (r.atual > 0 && r.disponivel > 0 && !t.length) t.push('ok');
    return t;
  }
  function nivelDe(tags) {
    if (tags.indexOf('negativo') >= 0 || tags.indexOf('falta') >= 0 || tags.indexOf('vencido') >= 0) return 'critico';
    if (tags.indexOf('vencendo') >= 0 || tags.indexOf('quarentena') >= 0 || tags.indexOf('zerado') >= 0) return 'atencao';
    return 'ok';
  }

  /* d = {estoque, materiais, lotes, hoje, diasVencendo, incluirCatalogo}.
     Uma linha por material com registro de saldo ou lote, uma por produto
     acabado com lote, e (opcional) os materiais do catálogo sem registro, para
     a busca responder "não tem" em vez de "não achei". */
  function linhas(d) {
    var dados = d || {};
    var estoque = dados.estoque || {}, materiais = dados.materiais || {}, lotes = dados.lotes || {};
    var hoje = dados.hoje || new Date();
    var dv = dados.diasVencendo == null ? DIAS_VENCENDO : dados.diasVencendo;
    var out = [], vistos = {};

    function montar(codigo, reg, mat, lotesItem, ehProduto) {
      var rs = resumirLotes(lotesItem);
      var pc = porClienteDe(reg);
      var atual, empenhado, saldoLotes = lotesItem.reduce(function(s, l) { return s + l.saldo; }, 0);
      if (ehProduto) { atual = saldoLotes; empenhado = 0; }
      else { atual = num(reg && reg.saldoAtual); empenhado = Math.max(0, num(reg && reg.saldoEmpenhado)); }
      var geral = atual - somaClientes(pc);
      var emp = [];
      if (reg && reg.empenhos) {
        Object.keys(reg.empenhos).forEach(function(k) {
          var e = reg.empenhos[k] || {};
          if (num(e.qtdEmpenhada) > 0) emp.push({opKey: k, lote: txt(e.lote) || k, sku: txt(e.sku), qtd: num(e.qtdEmpenhada), em: txt(e.atualizadoEm)});
        });
        emp.sort(function(a, b) { return b.qtd - a.qtd; });
      }
      var ult = (reg && reg.ultimaMovimentacao) || null;
      var tipo = ehProduto ? 'PA' : grupoDoTipo((mat && mat.tipo) || (/^[A-Z]{2,4}/.exec(codigo) || [''])[0]);
      var row = {
        codigo: codigo,
        nome: txt((reg && reg.materialNome) || (mat && mat.mpNome) || (lotesItem[0] && lotesItem[0].nome) || codigo),
        grupo: tipo,
        unidade: txt((reg && reg.unidade) || (mat && mat.unidade)) || 'un',
        produto: !!ehProduto,
        semRegistro: !reg && !lotesItem.length,
        semControle: !ehProduto && !!mat && mat.controlaEstoque === false,
        atual: arred(atual), empenhado: arred(empenhado), disponivel: arred(atual - empenhado),
        liberado: arred(ehProduto ? rs.liberado : (atual - rs.quarentena - rs.reprovado)),
        quarentena: arred(rs.quarentena), reprovado: arred(rs.reprovado),
        vencido: arred(rs.vencido), vencendo: arred(rs.vencendo),
        proxValidade: rs.proxValidade, proxDias: rs.proxDias,
        enderecos: rs.enderecos, lotes: lotesItem, empenhos: emp,
        porCliente: pc, geral: arred(geral), clientes: Object.keys(pc),
        ultimaMov: ult ? {em: txt(ult.em), tipo: txt(ult.tipo), qtd: num(ult.qtd), ref: txt(ult.ref)} : null,
        atualizadoEm: txt(reg && reg.ultimaAtualizacao) || (ult && txt(ult.em)) || '',
        descricao: txt(mat && (mat.especificacoesTecnicas || mat.descricao))
      };
      // Lote físico a mais que o saldo agregado (ou o contrário) é sinal de que o endereçamento está atrasado.
      row.semEndereco = !ehProduto && atual > 0 ? arred(Math.max(0, atual - saldoLotes)) : 0;
      if (ehProduto) { row.cliente = txt(lotesItem[0] && lotesItem[0].clienteProduto); row.clientes = row.cliente ? [row.cliente] : []; }
      // Dia D: item que já teve contagem física lançada como ajuste de saldo.
      var ultAj = '';
      Object.keys((reg && reg.ajustes) || {}).forEach(function(k) { var em = txt(reg.ajustes[k] && reg.ajustes[k].ajustadoEm); if (em > ultAj) ultAj = em; });
      row.contadoEm = ultAj; row.contado = !!ultAj;
      row.tags = etiquetas(row);
      row.nivel = nivelDe(row.tags);
      row.busca = norm([row.codigo, row.nome, row.grupo, GRUPOS[row.grupo].rotulo, row.clientes.join(' '),
        Object.keys(pc).map(function(k) { return pc[k].nome; }).join(' '),
        lotesItem.map(function(l) { return l.lote + ' ' + l.loteFornecedor + ' ' + l.endereco; }).join(' ')].join(' '));
      out.push(row);
      vistos[codigo] = 1;
    }

    var porItem = {};
    Object.keys(lotes).forEach(function(item) {
      var mapa = lotes[item] || {};
      var primeiro = mapa[Object.keys(mapa)[0]] || {};
      var ehProduto = primeiro.itemTipo === 'produto';
      var lista = lotesDoItem(mapa, hoje, dv);
      if (lista[0]) {
        lista[0].nome = txt(primeiro.itemNome);
        lista[0].clienteProduto = txt(primeiro.cliente);
      }
      porItem[item] = {lista: lista, produto: ehProduto, nome: txt(primeiro.itemNome), cliente: txt(primeiro.cliente)};
    });

    Object.keys(estoque).forEach(function(cod) {
      var info = porItem[cod];
      montar(cod, estoque[cod] || {}, materiais[cod], info && !info.produto ? info.lista : [], false);
    });
    Object.keys(porItem).forEach(function(cod) {
      if (vistos[cod]) return;
      var info = porItem[cod];
      if (info.produto) {
        if (!info.lista.length) return;
        info.lista[0].nome = info.nome; info.lista[0].clienteProduto = info.cliente;
        montar(cod, null, null, info.lista, true);
      } else if (info.lista.length) {
        montar(cod, null, materiais[cod], info.lista, false);
      }
    });
    if (dados.incluirCatalogo) {
      Object.keys(materiais).forEach(function(cod) {
        if (vistos[cod] || !materiais[cod] || materiais[cod].ativo === false) return;
        montar(cod, null, materiais[cod], [], false);
      });
    }
    // O nome do produto vem do lote (itemNome); o cliente também.
    out.forEach(function(r) { if (r.produto && r.lotes[0]) { r.nome = txt(r.lotes[0].nome) || r.nome; } });
    return out;
  }

  /* ── Busca e filtros ──────────────────────────────────────────────── */
  function tokens(q) { return norm(q).split(' ').filter(Boolean); }
  function casaBusca(row, toks) {
    for (var i = 0; i < toks.length; i++) if (row.busca.indexOf(toks[i]) < 0) return false;
    return true;
  }
  // f = {busca, grupo, tag, cliente, soComSaldo}
  function passa(row, f, ignorar) {
    var fl = f || {};
    if (ignorar !== 'busca') { var tk = tokens(fl.busca); if (tk.length && !casaBusca(row, tk)) return false; }
    if (ignorar !== 'grupo' && fl.grupo && row.grupo !== fl.grupo) return false;
    if (ignorar !== 'tag' && fl.tag) {
      if (fl.tag === 'comSaldo') { if (!(row.atual > 0)) return false; }
      else if (fl.tag === 'contado') { if (!row.contado) return false; }
      else if (fl.tag === 'naoContado') { if (row.contado || row.produto || row.semRegistro) return false; }
      else if (row.tags.indexOf(fl.tag) < 0) return false;
    }
    if (ignorar !== 'cliente' && fl.cliente) {
      var c = fl.cliente;
      if (c === '__KURYOS') { if (row.produto || !(row.geral > 0)) return false; }   // produto acabado é sempre de um cliente
      else if (row.clientes.indexOf(c) < 0 && norm(row.cliente || '') !== norm(c)) return false;
    }
    // Sem busca nem filtro, o catálogo sem registro não polui a lista.
    if (row.semRegistro && !tokens(fl.busca).length && !fl.grupo && !fl.tag) return false;
    return true;
  }
  function filtrar(rows, f) { return rows.filter(function(r) { return passa(r, f); }); }

  /* Quantos itens cada opção deixaria na tela com os OUTROS filtros mantidos. */
  function contagens(rows, f) {
    var c = {grupo: {}, tag: {}, total: 0};
    ORDEM_GRUPOS.forEach(function(g) { c.grupo[g] = 0; });
    ['comSaldo', 'contado', 'naoContado', 'semControle', 'ok', 'empenhado', 'falta', 'negativo', 'zerado', 'quarentena', 'vencendo', 'vencido'].forEach(function(t) { c.tag[t] = 0; });
    rows.forEach(function(r) {
      if (passa(r, f, 'grupo')) c.grupo[r.grupo] = (c.grupo[r.grupo] || 0) + 1;
      if (passa(r, f, 'tag')) {
        if (r.atual > 0) c.tag.comSaldo++;
        if (r.contado) c.tag.contado++;
        if (!r.contado && !r.produto && !r.semRegistro) c.tag.naoContado++;
        r.tags.forEach(function(t) { c.tag[t] = (c.tag[t] || 0) + 1; });
      }
      if (passa(r, f)) c.total++;
    });
    return c;
  }

  var ORDENS = {
    nome: function(a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR'); },
    codigo: function(a, b) { return String(a.codigo).localeCompare(String(b.codigo), 'pt-BR'); },
    atual: function(a, b) { return a.atual - b.atual; },
    disponivel: function(a, b) { return a.disponivel - b.disponivel; },
    empenhado: function(a, b) { return a.empenhado - b.empenhado; },
    validade: function(a, b) { return (a.proxDias == null ? 1e9 : a.proxDias) - (b.proxDias == null ? 1e9 : b.proxDias); },
    atualizado: function(a, b) { return String(a.atualizadoEm).localeCompare(String(b.atualizadoEm)); },
    gravidade: function(a, b) {
      var p = {critico: 0, atencao: 1, ok: 2};
      return p[a.nivel] - p[b.nivel] || String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    }
  };
  function ordenar(rows, chave, desc) {
    var fn = ORDENS[chave] || ORDENS.nome;
    var lista = rows.slice().sort(fn);
    return desc ? lista.reverse() : lista;
  }

  function kpis(rows) {
    var k = {itens: 0, comSaldo: 0, negativos: 0, faltando: 0, vencendo: 0, vencidos: 0, quarentena: 0, zerados: 0};
    rows.forEach(function(r) {
      if (r.semRegistro) return;
      k.itens++;
      if (r.atual > 0) k.comSaldo++;
      if (r.tags.indexOf('negativo') >= 0) k.negativos++;
      if (r.tags.indexOf('falta') >= 0) k.faltando++;
      if (r.tags.indexOf('vencendo') >= 0) k.vencendo++;
      if (r.tags.indexOf('vencido') >= 0) k.vencidos++;
      if (r.tags.indexOf('quarentena') >= 0) k.quarentena++;
      if (r.tags.indexOf('zerado') >= 0) k.zerados++;
    });
    return k;
  }

  /* Clientes que aparecem como dono do estoque ou do produto. */
  function clientesDoEstoque(rows) {
    var m = {};
    rows.forEach(function(r) {
      Object.keys(r.porCliente).forEach(function(k) { m[k] = r.porCliente[k].nome; });
      if (r.produto && r.cliente) m[r.cliente] = r.cliente;
    });
    return Object.keys(m).map(function(k) { return {chave: k, nome: m[k]}; })
      .sort(function(a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
  }

  /* ── Intermediários x embalagens ─────────────────────────────────── */

  var MP_ATIVO = {EM_PROCESSO: 1};
  function bomVigente(bom, produtoKey) {
    var melhor = null, melhorN = -1;
    Object.keys(bom || {}).forEach(function(k) {
      var r = bom[k]; if (!r || r.status === 'OBSOLETA') return;
      var prod = txt(r.codProduto) || k.split('__')[0];
      if (prod !== produtoKey) return;
      var n = parseInt(String(r.versao || k.split('__')[1] || 'v0').replace(/[^\d]/g, ''), 10) || 0;
      if (n > melhorN) { melhor = r; melhorN = n; }
    });
    return melhor;
  }

  // O que cada peça precisa de embalagem: congelado na OP quando existe, senão a BOM vigente.
  function embalagensDaOp(op, bom, produtoKey) {
    var lista = [], qtd = num(op && op.qtdPlanejada);
    var mc = (op && op.materiaisConsumo) || {};
    Object.keys(mc).forEach(function(k) {
      var m = mc[k] || {};
      if (m.origem !== 'bom' || !txt(m.mpCodigo) || !(qtd > 0)) return;
      lista.push({codigo: txt(m.mpCodigo), nome: txt(m.mpNome), porPeca: num(m.quantidade) / qtd, fonte: 'OP'});
    });
    if (lista.length) return lista;
    var b = bomVigente(bom, produtoKey);
    if (!b) return [];
    Object.keys(b.itens || {}).forEach(function(k) {
      var it = b.itens[k] || {};
      if (!txt(it.materialCodigo) || !(num(it.qtdPorPeca) > 0)) return;
      lista.push({codigo: txt(it.materialCodigo), nome: txt(it.materialNome), porPeca: num(it.qtdPorPeca), fonte: 'BOM'});
    });
    return lista;
  }

  // Peso de cada peça (g): o da OP; senão volume x densidade (ml) ou o volume (g); senão estimativa pelo rendimento.
  function pesoDaPeca(op, produto, rendimentoKg) {
    var p = num(op && op.pesoTeoricoUnG);
    if (p > 0) return {g: p, fonte: 'OP'};
    var vol = num(produto && produto.volume), un = norm(produto && produto.unidadeVolume);
    var dens = num(produto && produto.densidadeGranel);
    if (vol > 0 && (un === 'g' || un === 'gr' || un === 'kg')) return {g: un === 'kg' ? vol * 1000 : vol, fonte: 'cadastro'};
    if (vol > 0 && dens > 0 && (un === 'ml' || un === 'l')) return {g: (un === 'l' ? vol * 1000 : vol) * dens, fonte: 'cadastro'};
    var plan = num(op && op.qtdPlanejada);
    if (plan > 0 && rendimentoKg > 0) return {g: rendimentoKg * 1000 / plan, fonte: 'estimado'};
    return {g: 0, fonte: 'sem peso'};
  }

  /* Quanto de cada embalagem esta peça pode usar: dono (cliente), menos o que outras OPs já empenharam. */
  function usavelParaOp(codigo, estoque, clienteKey, opKey) {
    var reg = estoque[codigo];
    if (!reg) return {usavel: 0, atual: 0, outrosEmpenhos: 0, doCliente: 0, deOutroCliente: 0};
    var atual = num(reg.saldoAtual), pc = porClienteDe(reg);
    var doCliente = clienteKey && pc[clienteKey] ? pc[clienteKey].saldo : 0;
    var deOutros = somaClientes(pc) - doCliente;
    var meu = reg.empenhos && reg.empenhos[opKey] ? num(reg.empenhos[opKey].qtdEmpenhada) : 0;
    var outrosEmp = Math.max(0, num(reg.saldoEmpenhado) - meu);
    var u = Math.max(0, atual - deOutros - outrosEmp);
    return {usavel: u, atual: atual, outrosEmpenhos: outrosEmp, doCliente: doCliente, deOutroCliente: deOutros};
  }

  /* Casa um volume de bulk (kg) com as embalagens: quantas peças dá para fechar e o que trava. */
  function casar(o) {
    var embs = o.embalagens || [], estoque = o.estoque || {}, materiais = o.materiais || {};
    var restante = o.restante == null ? Infinity : Math.max(0, o.restante);
    var porBulk = o.pesoG > 0 ? Math.floor((o.bulkKg * 1000) / o.pesoG) : null;
    var alvo = porBulk == null ? restante : Math.min(porBulk, restante);
    var itens = embs.map(function(e) {
      var tipo = grupoDoTipo((materiais[e.codigo] && materiais[e.codigo].tipo) || (/^[A-Z]+/.exec(e.codigo) || [''])[0]);
      var semControle = !!materiais[e.codigo] && materiais[e.codigo].controlaEstoque === false;
      var u = usavelParaOp(e.codigo, estoque, o.clienteKey, o.opKey);
      var cabe = e.porPeca > 0 && !semControle ? Math.floor(u.usavel / e.porPeca + 1e-9) : Infinity;
      var precisa = isFinite(alvo) ? Math.ceil(alvo * e.porPeca - 1e-9) : 0;
      return {
        codigo: e.codigo, nome: e.nome || (materiais[e.codigo] && materiais[e.codigo].mpNome) || e.codigo, grupo: tipo,
        porPeca: e.porPeca, usavel: arred(u.usavel), atual: arred(u.atual), outrosEmpenhos: arred(u.outrosEmpenhos),
        deOutroCliente: arred(u.deOutroCliente), cabe: cabe, precisa: precisa, falta: semControle ? 0 : Math.max(0, precisa - Math.floor(u.usavel)),
        semControle: semControle,
        bloqueia: !semControle && (tipo === 'EP' || tipo === 'ES')   // a caixa de embarque entra depois do envase; sem controle nunca trava
      };
    });
    var bloqueantes = itens.filter(function(i) { return i.bloqueia; });
    var limite = bloqueantes.reduce(function(m, i) { return Math.min(m, i.cabe); }, Infinity);
    var gargalo = null;
    bloqueantes.forEach(function(i) { if (i.cabe === limite && (!gargalo || i.falta > gargalo.falta)) gargalo = i; });
    var pode = Math.max(0, Math.min(alvo, limite));
    if (!isFinite(pode)) pode = 0;
    var estado;
    if (!itens.length) estado = 'sem_bom';
    else if (porBulk == null) estado = 'sem_peso';
    else if (alvo <= 0) estado = 'sem_bulk';
    else if (pode >= alvo) estado = 'pronto';
    else if (pode > 0) estado = 'parcial';
    else estado = 'bloqueado';
    return {pecasPeloBulk: porBulk, alvo: isFinite(alvo) ? alvo : null, pode: pode, estado: estado, gargalo: gargalo && gargalo.cabe < alvo ? gargalo : null, itens: itens};
  }

  /* d = {ops, estoque, materiais, bom, produtos, materialProcesso, bombonas, clientes}.
     Devolve {aguardando:[...], retidos:[...], totais}. */
  function intermediarios(d) {
    var dados = d || {};
    var ops = dados.ops || {}, estoque = dados.estoque || {}, materiais = dados.materiais || {}, produtos = dados.produtos || {};
    var bom = dados.bom || {}, mp = dados.materialProcesso || {}, bombonas = dados.bombonas || {};

    function produtoDe(op) {
      var sku = txt(op.sku);
      return produtos[sku] || Object.keys(produtos).map(function(k) { return produtos[k]; }).filter(function(p) { return p && p.sku === sku; })[0] || null;
    }
    function clienteKeyDe(op, produto) {
      return txt(produto && produto.clienteKey) || chaveSegura(op.clienteKey || '');
    }

    // Bulk que já está identificado numa bombona/tanque, por OP.
    var naBombona = {};
    Object.keys(bombonas).forEach(function(c) {
      var b = bombonas[c], cont = b && b.conteudo; if (!cont) return;
      var kg = num(cont.kg); if (!(kg > 0)) return;
      var chave = txt(cont.opKey) || txt(cont.lote);
      (naBombona[chave] = naBombona[chave] || []).push({codigo: txt(b.codigo) || c, kg: kg, local: txt(b.local)});
    });

    var aguardando = [];
    Object.keys(ops).forEach(function(k) {
      var op = ops[k]; if (!op || op.status === 'Cancelado' || op.status === 'Concluído') return;
      var man = op.manipulacao || {};
      var rend = num(man.manipulacao && man.manipulacao.rendimento);
      if (!(rend > 0)) return;
      var produto = produtoDe(op);
      var feitas = num(op.produzidoLinha != null ? op.produzidoLinha : op.produzido);
      var peso = pesoDaPeca(op, produto, rend);
      var usado = peso.g > 0 ? feitas * peso.g / 1000 : 0;
      var bulkKg = Math.max(0, rend - usado);
      var plan = num(op.qtdPlanejada);
      var restante = plan > 0 ? Math.max(0, plan - feitas) : null;
      var cm = casar({
        bulkKg: bulkKg, pesoG: peso.g, restante: restante, embalagens: embalagensDaOp(op, bom, txt(op.sku)),
        estoque: estoque, materiais: materiais, clienteKey: clienteKeyDe(op, produto), opKey: k
      });
      aguardando.push({
        opKey: k, lote: txt(op.lote) || k, sku: txt(op.sku), produto: txt(op.produto), cliente: txt(op.cliente), status: txt(op.status),
        manipulacao: txt(man.status), liberado: man.status === 'LIBERADO',
        rendimentoKg: arred(rend), envasadoKg: arred(usado), bulkKg: arred(bulkKg), pesoG: arred(peso.g), pesoFonte: peso.fonte,
        planejado: plan, feitas: feitas, restante: restante, linha: txt(op.abertaLinha || op.linha),
        bombonas: naBombona[k] || naBombona[txt(op.lote)] || [],
        casamento: cm
      });
    });
    var ordemEstado = {pronto: 0, parcial: 1, bloqueado: 2, sem_bom: 3, sem_peso: 4, sem_bulk: 5};
    aguardando.sort(function(a, b) {
      return (b.liberado - a.liberado) || (ordemEstado[a.casamento.estado] - ordemEstado[b.casamento.estado]) || b.bulkKg - a.bulkKg;
    });

    // Retidos: o que a produção declarou ao encerrar/devolver OP (frasco rotulado, bulk, rótulo...).
    var retidos = [];
    Object.keys(mp).forEach(function(k) {
      var r = mp[k]; if (!r || !MP_ATIVO[r.status]) return;
      var opKey = txt(r.opKey), op = ops[opKey] || {};
      var produto = produtoDe(Object.assign({sku: r.sku}, op)) || produtoDe(op);
      var item = {
        chave: k, tipo: txt(r.tipo), qtd: num(r.qtd), unidade: txt(r.unidade) || 'un', opKey: opKey,
        lote: txt(r.lote) || txt(op.lote) || opKey, produto: txt(r.produto) || txt(op.produto), sku: txt(r.sku) || txt(op.sku),
        dono: txt(r.donoNome) || (r.donoTipo === 'KURYOS' ? 'Kuryos' : ''), donoTipo: txt(r.donoTipo),
        local: txt(r.local), recipiente: txt(r.recipienteCodigo), declaradoEm: txt(r.declaradoEm || r.criadoEm), origem: txt(r.origem),
        casamento: null, faltam: []
      };
      var embs = embalagensDaOp(Object.assign({}, op, {qtdPlanejada: op.qtdPlanejada}), bom, item.sku);
      var ck = clienteKeyDe(op, produto);
      if (item.tipo === 'BULK' && item.unidade === 'kg') {
        var peso = pesoDaPeca(op, produto, 0);
        item.casamento = casar({bulkKg: item.qtd, pesoG: peso.g, restante: null, embalagens: embs, estoque: estoque, materiais: materiais, clienteKey: ck, opKey: opKey});
      } else if (item.tipo === 'FRASCO_ROTULADO') {
        // O frasco e o rótulo já estão nele; o que falta fechar é o resto da BOM de envase.
        var ja = /FRASCO|ROTULO|R[OÓ]TULO|POTE|BISNAGA|TUBO/i;
        var resto = embs.filter(function(e) { return !ja.test(norm(e.nome).toUpperCase()); });
        item.casamento = casar({bulkKg: 0, pesoG: 0, restante: item.qtd, embalagens: resto, estoque: estoque, materiais: materiais, clienteKey: ck, opKey: opKey});
        item.casamento.alvo = item.qtd;
        // sem bulk a limitar: o limite vem só das embalagens que faltam
        var lim = item.casamento.itens.filter(function(i) { return i.bloqueia; }).reduce(function(m, i) { return Math.min(m, i.cabe); }, Infinity);
        item.casamento.pode = Math.max(0, Math.min(item.qtd, lim));
        item.casamento.estado = !item.casamento.itens.length ? 'sem_bom' : item.casamento.pode >= item.qtd ? 'pronto' : item.casamento.pode > 0 ? 'parcial' : 'bloqueado';
        var gar = null;
        item.casamento.itens.forEach(function(i) { if (i.bloqueia && i.cabe < item.qtd && (!gar || i.cabe < gar.cabe)) gar = i; });
        item.casamento.gargalo = gar;
      }
      retidos.push(item);
    });
    retidos.sort(function(a, b) { return String(b.declaradoEm).localeCompare(String(a.declaradoEm)); });

    var t = {bulkKg: 0, ops: 0, prontas: 0, parciais: 0, bloqueadas: 0, retidoBulkKg: 0, retidoFrascos: 0};
    aguardando.forEach(function(a) {
      if (!(a.bulkKg > 0)) return;
      t.bulkKg += a.bulkKg; t.ops++;
      if (a.casamento.estado === 'pronto') t.prontas++;
      else if (a.casamento.estado === 'parcial') t.parciais++;
      else if (a.casamento.estado === 'bloqueado') t.bloqueadas++;
    });
    retidos.forEach(function(r) {
      if (r.tipo === 'BULK') t.retidoBulkKg += r.qtd;
      if (r.tipo === 'FRASCO_ROTULADO') t.retidoFrascos += r.qtd;
    });
    t.bulkKg = arred(t.bulkKg, 1); t.retidoBulkKg = arred(t.retidoBulkKg, 1);
    return {aguardando: aguardando, retidos: retidos, totais: t};
  }

  /* ── Estoque de intermediários por produto (05/10) ──────────────────
     Pedido do usuário: o PCP consulta com frequência o que há de intermediário
     para decidir o que programar (e, no futuro, descontar na criação da OP):
       - BULK: manipulado e ainda não envasado + bulk retido declarado pela produção;
       - FRASCO ROTULADO: o que a rotulagem fez e o envase ainda não consumiu
         (ConciliacaoRotulagem.saldoEmLinha) + a sobra declarada.
     Cada quantidade vem separada em LIBERADA e AGUARDANDO a validação da Qualidade:
       bulk = manipulacao.status === 'LIBERADO';
       frasco rotulado = validacoes[opKey].status === 'LIBERADO' (REPROVADO sai da conta).
     Para não contar duas vezes: OP com bulk retido declarado usa o retido, não o saldo da manipulação;
     OP com sobra de frasco declarada usa a sobra, não o saldo calculado. */
  function conciliador() {
    if (typeof module === 'object' && module.exports) return require('./conciliacao-rotulagem.js');
    return typeof globalThis !== 'undefined' ? globalThis.ConciliacaoRotulagem : (typeof window !== 'undefined' ? window.ConciliacaoRotulagem : null);
  }
  function estoqueIntermediario(d) {
    var dados = d || {}, CR = conciliador();
    var ops = dados.ops || {}, produtos = dados.produtos || {}, mp = dados.materialProcesso || {}, perdas = dados.perdas || {}, val = dados.validacoes || {};
    var porSku = {};
    function linha(op) {
      var sku = txt(op.sku) || '—';
      var p = produtos[sku] || {};
      return porSku[sku] = porSku[sku] || {sku: sku, produto: txt(op.produto) || txt(p.descricao), cliente: txt(op.cliente) || txt(p.cliente),
        bulkLiberadoKg: 0, bulkAguardandoKg: 0, frascosLiberados: 0, frascosAguardando: 0, frascosReprovados: 0, ops: []};
    }
    var retBulk = {}, retFrasco = {};
    Object.keys(mp).forEach(function(k) {
      var r = mp[k]; if (!r || r.status !== 'EM_PROCESSO') return;
      if (r.tipo === 'BULK') (retBulk[r.opKey] = retBulk[r.opKey] || []).push(r);
      if (r.tipo === 'FRASCO_ROTULADO') (retFrasco[r.opKey] = retFrasco[r.opKey] || []).push(r);
    });
    Object.keys(ops).forEach(function(k) {
      var op = ops[k]; if (!op || op.status === 'Cancelado') return;
      var ativa = op.status !== 'Concluído';
      var man = op.manipulacao || {}, manLiberada = man.status === 'LIBERADO';
      var det = {opKey: k, lote: txt(op.lote) || k, bulkKg: 0, bulkLiberado: manLiberada, frascos: 0, frascosStatus: (val[k] && val[k].status) || 'PENDENTE', origemFrascos: ''};
      // BULK
      if (retBulk[k]) retBulk[k].forEach(function(r) { det.bulkKg += num(r.unidade === 'kg' ? r.qtd : 0); });
      else if (ativa) {
        var rend = num(man.manipulacao && man.manipulacao.rendimento);
        if (rend > 0) {
          var peso = num(op.pesoTeoricoUnG);
          var usado = peso > 0 ? num(op.produzidoLinha != null ? op.produzidoLinha : op.produzido) * peso / 1000 : 0;
          det.bulkKg = Math.max(0, rend - usado);
        }
      }
      // FRASCOS ROTULADOS
      if (retFrasco[k]) { retFrasco[k].forEach(function(r) { det.frascos += num(r.qtd); }); det.origemFrascos = 'sobra declarada'; }
      else if (ativa && CR) {
        var c = CR.conciliar(op, Object.keys(perdas[k] || {}).map(function(x) { return perdas[k][x]; }), []);
        if (c.estado === 'em_estoque' || c.estado === 'divergente') { det.frascos = c.saldoEmLinha; det.origemFrascos = 'saldo da rotulagem'; }
      }
      if (!(det.bulkKg > 0.0005) && !(det.frascos > 0)) return;
      var l = linha(op);
      if (det.bulkKg > 0.0005) { if (manLiberada) l.bulkLiberadoKg += det.bulkKg; else l.bulkAguardandoKg += det.bulkKg; }
      if (det.frascos > 0) {
        if (det.frascosStatus === 'LIBERADO') l.frascosLiberados += det.frascos;
        else if (det.frascosStatus === 'REPROVADO') l.frascosReprovados += det.frascos;
        else l.frascosAguardando += det.frascos;
      }
      l.ops.push(det);
    });
    var linhas = Object.keys(porSku).map(function(k) {
      var l = porSku[k];
      l.bulkLiberadoKg = arred(l.bulkLiberadoKg, 1); l.bulkAguardandoKg = arred(l.bulkAguardandoKg, 1);
      return l;
    }).sort(function(a, b) { return (b.bulkLiberadoKg + b.bulkAguardandoKg + b.frascosLiberados + b.frascosAguardando) - (a.bulkLiberadoKg + a.bulkAguardandoKg + a.frascosLiberados + a.frascosAguardando) || a.sku.localeCompare(b.sku); });
    var t = {bulkLiberadoKg: 0, bulkAguardandoKg: 0, frascosLiberados: 0, frascosAguardando: 0};
    linhas.forEach(function(l) { t.bulkLiberadoKg += l.bulkLiberadoKg; t.bulkAguardandoKg += l.bulkAguardandoKg; t.frascosLiberados += l.frascosLiberados; t.frascosAguardando += l.frascosAguardando; });
    t.bulkLiberadoKg = arred(t.bulkLiberadoKg, 1); t.bulkAguardandoKg = arred(t.bulkAguardandoKg, 1);
    return {linhas: linhas, totais: t};
  }

  function fmt(n, casas) {
    var v = num(n), c = casas == null ? (Math.abs(v) < 100 && v % 1 ? 2 : 0) : casas;
    return v.toLocaleString('pt-BR', {minimumFractionDigits: 0, maximumFractionDigits: c});
  }

  return {
    GRUPOS: GRUPOS, ORDEM_GRUPOS: ORDEM_GRUPOS, STATUS_OK: STATUS_OK, DIAS_VENCENDO: DIAS_VENCENDO,
    grupoDoTipo: grupoDoTipo, diasAte: diasAte, dataLocal: dataLocal, norm: norm, fmt: fmt,
    linhas: linhas, filtrar: filtrar, contagens: contagens, ordenar: ordenar, kpis: kpis, clientesDoEstoque: clientesDoEstoque,
    pesoDaPeca: pesoDaPeca, casar: casar, embalagensDaOp: embalagensDaOp, intermediarios: intermediarios, estoqueIntermediario: estoqueIntermediario
  };
});
