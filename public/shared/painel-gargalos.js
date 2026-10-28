/* Painel de Controle: onde o fluxo está parado e com quem (27/10/2026).

   Cada ETAPA do fluxo (do pedido à saída da carga, mais Compras e retornos) tem
   um SETOR responsável, uma fila (itens esperando agora), uma idade (há quanto
   tempo cada item espera naquele ponto) e uma regra de ATRASO. O painel soma por
   etapa e por setor, para cobrar quem está com a bola.

   Regras de atraso, em ordem de preferência:
     1. data que o sistema já conhece (fim planejado do envase, data da carga,
        prazo da inspeção total, entrega prevista do pedido de compra);
     2. SLA em horas por etapa (SLA_PADRAO_H, ajustável em config/painelSlaHoras)
        contra a idade do item na etapa.
   Sem data de entrada no estado, o item conta na fila mas não fica "atrasado":
   inventar atraso produziria cobrança injusta.

   Módulo puro (sem DOM, sem Firebase): recebe os nós do banco já lidos. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PainelGargalos = factory();
})(typeof window !== 'undefined' ? window : this, function() {
  'use strict';

  var H = 3600000, DIA = 86400000;

  /* Tempo máximo (horas) que um item deveria ficar em cada etapa. Valores de partida,
     deliberadamente folgados: o admin ajusta em config/painelSlaHoras/{idEtapa}. */
  var SLA_PADRAO_H = {
    confirmar_pcp: 24, separacao: 72, pesagem: 72, conferencia_pesagem: 4, aguardando_manipular: 24, manipulacao: 24,
    cq_granel: 24, bulk_envase: 72, envase: 0, rotulagem: 0, insp_designar: 4, insp_executar: 0, insp_decidir: 24,
    conferencia_pa: 24, faturamento: 24, carregar: 24, rnc: 72, sc_aprovar: 24, sc_cotar: 48, pc_enviar: 24, pc_atrasados: 0,
    devolucoes: 72, descartes: 72
  };

  /* Ordem do fluxo, setor dono, nome e tela de destino de cada etapa. */
  var ETAPAS = [
    {id: 'confirmar_pcp', fase: 'Planejar', setor: 'PCP', titulo: 'OP concluída aguardando confirmação do PCP', href: 'estoque.html?tab=conferenciapa'},
    {id: 'separacao', fase: 'Planejar', setor: 'Logística', titulo: 'OP aguardando separação de materiais', href: 'proximas_ordens.html?setor=separacao'},
    {id: 'pesagem', fase: 'Manipular', setor: 'Manipulação', titulo: 'Aguardando pesagem', href: 'manipulacao.html'},
    {id: 'conferencia_pesagem', fase: 'Manipular', setor: 'Qualidade', titulo: 'Pesagem aguardando conferência', href: 'manipulacao.html'},
    {id: 'aguardando_manipular', fase: 'Manipular', setor: 'Manipulação', titulo: 'Conferido, aguardando manipular', href: 'manipulacao.html'},
    {id: 'manipulacao', fase: 'Manipular', setor: 'Manipulação', titulo: 'Em manipulação', href: 'manipulacao.html'},
    {id: 'cq_granel', fase: 'Manipular', setor: 'Qualidade', titulo: 'Bulk aguardando análise', href: 'qualidade.html?tab=fila'},
    {id: 'bulk_envase', fase: 'Produzir', setor: 'Produção', titulo: 'Pronta para envasar, ainda não iniciada', href: 'proximas_ordens.html?setor=envase'},
    {id: 'envase', fase: 'Produzir', setor: 'Produção', titulo: 'Envase em andamento', href: 'proximas_ordens.html?setor=envase'},
    {id: 'rotulagem', fase: 'Produzir', setor: 'Rotulagem', titulo: 'Fila da rotulagem', href: 'proximas_ordens.html?setor=rotulagem'},
    {id: 'insp_designar', fase: 'Qualidade', setor: 'Produção', titulo: 'Inspeção total sem responsável', href: 'inspecao_total.html'},
    {id: 'insp_executar', fase: 'Qualidade', setor: 'Produção', titulo: 'Inspeção total em andamento', href: 'inspecao_total.html'},
    {id: 'insp_decidir', fase: 'Qualidade', setor: 'Qualidade', titulo: 'Inspeção total aguardando decisão', href: 'inspecao_total.html'},
    {id: 'rnc', fase: 'Qualidade', setor: 'Qualidade', titulo: 'Não conformidades abertas', href: 'qualidade.html?tab=rnc'},
    {id: 'conferencia_pa', fase: 'Expedir', setor: 'Logística', titulo: 'PA aguardando conferência', href: 'estoque.html?tab=conferenciapa'},
    {id: 'faturamento', fase: 'Expedir', setor: 'Faturamento', titulo: 'Carga aguardando faturamento', href: 'faturamento.html'},
    {id: 'carregar', fase: 'Expedir', setor: 'Logística', titulo: 'Carga faturada aguardando saída', href: 'cargas.html'},
    {id: 'sc_aprovar', fase: 'Compras', setor: 'Compras', titulo: 'Solicitação de compra a aprovar', href: 'compras.html'},
    {id: 'sc_cotar', fase: 'Compras', setor: 'Compras', titulo: 'Solicitação aprovada a cotar', href: 'compras.html'},
    {id: 'pc_enviar', fase: 'Compras', setor: 'Compras', titulo: 'Pedido de compra a enviar', href: 'compras.html'},
    {id: 'pc_atrasados', fase: 'Compras', setor: 'Compras', titulo: 'Entrega do fornecedor atrasada', href: 'compras.html'},
    {id: 'devolucoes', fase: 'Retornos', setor: 'Logística', titulo: 'Devolução autorizada a receber', href: 'devolucoes.html'},
    {id: 'descartes', fase: 'Retornos', setor: 'Logística', titulo: 'Descarte aguardando decisão', href: 'descarte.html'}
  ];
  var FASES = ['Planejar', 'Manipular', 'Produzir', 'Qualidade', 'Expedir', 'Compras', 'Retornos'];

  function ts(v) { var t = Date.parse(v); return isNaN(t) ? null : t; }
  function txt(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function primeiroTs(o) {
    for (var i = 1; i < arguments.length; i++) { var t = ts(o && o[arguments[i]]); if (t != null) return t; }
    return null;
  }
  function chaves(no) { return Object.keys(no || {}); }
  function dia(v) { return txt(v).slice(0, 10); }
  function hojeDe(agora) {
    var d = new Date(agora - 3 * H); // fuso de São Paulo, sem depender do relógio do aparelho
    return d.toISOString().slice(0, 10);
  }
  function opAtiva(op) {
    var st = txt(op && op.status);
    return !!op && st !== 'Concluído' && st !== 'Cancelado' && st !== 'Aguardando Confirmação';
  }
  function rotuloOp(op, k) {
    return (txt(op.lote) || k) + (op.produto ? ' — ' + txt(op.produto) : '') + (op.cliente ? ' (' + txt(op.cliente) + ')' : '');
  }

  /* desde: instante em que o item entrou no estado (ms) ou null. */
  function item(rotulo, desde, agora, atrasadoPor, extra) {
    var idade = desde == null ? null : Math.max(0, (agora - desde) / H);
    var o = {rotulo: rotulo, idadeH: idade, atrasado: !!atrasadoPor, motivo: atrasadoPor || ''};
    if (extra) o.detalhe = extra;
    return o;
  }
  function porSla(idade, sla) { return idade != null && sla > 0 && idade > sla ? 'passou do prazo de ' + sla + 'h' : ''; }

  /* Fila de um estágio por SLA de horas. */
  function porIdade(rotulo, desde, agora, sla, extra) {
    var idade = desde == null ? null : (agora - desde) / H;
    return item(rotulo, desde, agora, porSla(idade, sla), extra);
  }

  function analisar(d, opc) {
    var o = opc || {}, lib = o.lib || {}, agora = o.agora || Date.now();
    var sla = {};
    Object.keys(SLA_PADRAO_H).forEach(function(k) {
      var v = o.slaH && o.slaH[k] != null ? Number(o.slaH[k]) : SLA_PADRAO_H[k];
      sla[k] = isFinite(v) && v >= 0 ? v : SLA_PADRAO_H[k];
    });
    var hoje = hojeDe(agora), amanha = hojeDe(agora + DIA);
    var filas = {};
    ETAPAS.forEach(function(e) { filas[e.id] = []; });
    var ops = d.ops || {};
    var SS = lib.SequenciaSetor;
    var ctxRot = {temRotulagem: lib.PerdasEtapa ? function(op) {
      return lib.PerdasEtapa.embalagensDaOp(op, null, null).some(function(i) { return i.tipo === 'Rótulos'; });
    } : null};
    // A conferência de PA ignora OPs anteriores ao fluxo novo (mesma regra de estoque.html).
    var INICIO_CONF_PA = o.inicioConferenciaPA || '2026-09-10T00:00:00.000Z';

    chaves(ops).forEach(function(k) {
      var op = ops[k] || {};
      var rot = rotuloOp(op, k), plano = ts(op.dataInicioPlanejada), fimPlano = ts(op.dataFimPlanejada);
      var emissao = primeiroTs(op, 'dataEmissao', 'criadoEm');

      // PCP e Logística: o fim da OP.
      if ((op.status === 'Concluído' || op.status === 'Aguardando Confirmação') && txt(op.sku) && qtdApontada(op) > 0) {
        var conf = (d.conferencias_pa || {})[k] || null;
        var aberta = !conf || (conf.status !== 'CONFERIDO' && conf.status !== 'CONFERIDO_COM_DIVERGENCIA');
        var noFluxo = !!conf || txt(op.dataFimReal) >= INICIO_CONF_PA;
        if (aberta && noFluxo) {
          var fim = primeiroTs(op, 'dataFimReal');
          if (op.status === 'Aguardando Confirmação') filas.confirmar_pcp.push(porIdade(rot, fim, agora, sla.confirmar_pcp, qtdApontada(op) + ' un apontadas'));
          else filas.conferencia_pa.push(porIdade(rot, fim, agora, sla.conferencia_pa, qtdApontada(op) + ' un apontadas'));
        }
      }
      if (!opAtiva(op)) return;

      // Separação de materiais.
      if (SS && SS.etapa('separacao', op, {})) {
        var urgente = plano != null && plano - agora < DIA;
        filas.separacao.push(item(rot, emissao, agora, urgente ? 'envase planejado para ' + (plano < agora ? 'antes de agora' : 'menos de 24h') + ' e os materiais não foram separados' : ''));
      }

      // Manipulação, etapa a etapa (cada estado tem o seu dono).
      var fase = op.manipulacao || null, st = fase ? (txt(fase.status) || 'AGUARDANDO_PESAGEM') : null;
      var elegivel = SS ? !!SS.etapa('manipulacao', op, {}) : false;
      if (elegivel && (!st || st === 'AGUARDANDO_PESAGEM' || st === 'CORRECAO_ABERTA')) {
        // Meta da área: pesar até 3 dias antes do envase.
        var tarde = plano != null && plano - agora < 3 * DIA;
        filas.pesagem.push(item(rot, primeiroTs(fase && fase.pesagem, 'inicio') || emissao, agora, tarde ? 'envase em menos de 3 dias e a pesagem não foi feita' : ''));
      } else if (elegivel && st === 'PESADO') {
        filas.conferencia_pesagem.push(porIdade(rot, primeiroTs(fase && fase.pesagem, 'fim'), agora, sla.conferencia_pesagem));
      } else if (elegivel && st === 'CONFERIDO') {
        filas.aguardando_manipular.push(porIdade(rot, primeiroTs(fase && fase.conferencia, 'em'), agora, sla.aguardando_manipular));
      } else if (elegivel && st === 'EM_MANIPULACAO') {
        filas.manipulacao.push(porIdade(rot, primeiroTs(fase && fase.manipulacao, 'inicio'), agora, sla.manipulacao));
      } else if (st === 'AGUARDANDO_CQ') {
        filas.cq_granel.push(porIdade(rot, primeiroTs(fase && fase.manipulacao, 'fim'), agora, sla.cq_granel));
      }

      // Envase e rotulagem: atrasadas quando o fim planejado já passou e ainda falta produzir.
      var eEnv = SS ? SS.etapa('envase', op, {}) : null;
      if (eEnv) {
        var rodando = !!op.abertaDesde || num(op.produzidoLinha) > 0;
        if (rodando) {
          filas.envase.push(item(rot, op.abertaDesde ? ts(op.abertaDesde) : emissao, agora,
            fimPlano != null && fimPlano < agora ? 'fim planejado em ' + dia(op.dataFimPlanejada).split('-').reverse().join('/') + ' e faltam ' + Math.round(eEnv.restante) + ' un' : '',
            'faltam ' + Math.round(eEnv.restante) + ' un'));
        } else {
          // Pronta para envasar (materiais separados e bulk liberado, ou sem bulk) e ainda não começou.
          var separada = SS ? !SS.etapa('separacao', op, {}) : false;
          var bulkOk = st === 'LIBERADO' || (!elegivel && st !== 'AGUARDANDO_CQ' && st !== 'REPROVADO');
          if (separada && bulkOk) {
            var desdeBulk = st === 'LIBERADO' ? primeiroTs(fase && fase.analise, 'em') : null;
            var motivo = plano != null ? (plano < agora ? 'o início planejado já passou' : '')
              : porSla(desdeBulk == null ? null : (agora - desdeBulk) / H, sla.bulk_envase);
            filas.bulk_envase.push(item(rot, desdeBulk, agora, motivo, 'pronta para envasar'));
          }
        }
      }
      var eRot = SS ? SS.etapa('rotulagem', op, ctxRot) : null;
      if (eRot) {
        filas.rotulagem.push(item(rot, op.abertaDesdeRot ? ts(op.abertaDesdeRot) : emissao, agora,
          fimPlano != null && fimPlano < agora ? 'fim planejado já passou e faltam ' + Math.round(eRot.restante) + ' un' : '',
          'faltam ' + Math.round(eRot.restante) + ' un'));
      }
    });

    // Inspeção total de PA (a Qualidade sinaliza; Produção executa; Qualidade decide).
    if (lib.InspecaoTotalPA) {
      lib.InspecaoTotalPA.fila(ops).forEach(function(f) {
        var insp = f.insp, rot = (f.lote || f.opKey) + (f.produto ? ' — ' + f.produto : '');
        var sinal = primeiroTs(insp.sinalizacao, 'em');
        if (f.estado === 'AGUARDANDO_DESIGNACAO') filas.insp_designar.push(porIdade(rot, sinal, agora, sla.insp_designar));
        else if (f.estado === 'EM_INSPECAO') {
          var prazo = primeiroTs(insp.designacao, 'prazoEm');
          filas.insp_executar.push(item(rot, primeiroTs(insp.designacao, 'em') || sinal, agora, prazo != null && prazo < agora ? 'prazo da inspeção vencido' : '',
            insp.designacao && insp.designacao.responsavel ? 'com ' + insp.designacao.responsavel : ''));
        } else if (f.estado === 'AGUARDANDO_DECISAO') filas.insp_decidir.push(porIdade(rot, sinal, agora, sla.insp_decidir));
      });
    }

    // Qualidade: RNC abertas.
    chaves(d.nao_conformidades).forEach(function(k) {
      var n = d.nao_conformidades[k] || {};
      if (n.status !== 'ABERTA') return;
      filas.rnc.push(porIdade(txt(n.numero) || txt(n.titulo) || k, primeiroTs(n, 'criadoEm', 'abertaEm', 'dataAbertura', 'em'), agora, sla.rnc));
    });

    // Expedição.
    chaves(d.agendamentos_expedicao).forEach(function(k) {
      var a = d.agendamentos_expedicao[k] || {};
      if (!lib.CargasPA) return;
      var cod = lib.CargasPA.etapa(a).codigo;
      var rot = (txt(a.cliente) || txt(a.clienteNome) || 'Carga') + ' — ' + (dia(a.dataAgendada).split('-').reverse().join('/') || 'sem data');
      var vencida = dia(a.dataAgendada) && dia(a.dataAgendada) < hoje;
      var desde = primeiroTs(a, 'criadoEm');
      if (cod === 'AGENDADA' || cod === 'FATURAMENTO_SOLICITADO') {
        filas.faturamento.push(item(rot, desde, agora, vencida ? 'a data da carga já passou' : porSla((agora - (desde || agora)) / H, sla.faturamento)));
      } else if (cod === 'FATURADA' || cod === 'AGUARDANDO_EMBARQUE') {
        filas.carregar.push(item(rot, desde, agora, vencida ? 'a data da carga já passou' : ''));
      }
    });

    // Compras.
    chaves(d.solicitacoes_compra).forEach(function(k) {
      var s = d.solicitacoes_compra[k] || {}, rot = txt(s.numeroFormatado) || txt(s.numero) || txt(s.materialNome) || k;
      if (s.status === 'PENDENTE') filas.sc_aprovar.push(porIdade(rot, primeiroTs(s, 'criadoEm'), agora, sla.sc_aprovar));
      else if (s.status === 'APROVADA') filas.sc_cotar.push(porIdade(rot, primeiroTs(s.aprovacao, 'aprovadoEm') || primeiroTs(s, 'criadoEm'), agora, sla.sc_cotar));
    });
    chaves(d.pedidos_compra).forEach(function(k) {
      var p = d.pedidos_compra[k] || {}, rot = txt(p.numeroFormatado) || txt(p.numero) || k;
      if (txt(p.fornecedorNome || p.fornecedor)) rot += ' — ' + txt(p.fornecedorNome || p.fornecedor);
      if (p.status === 'ABERTO') filas.pc_enviar.push(porIdade(rot, primeiroTs(p, 'criadoEm'), agora, sla.pc_enviar));
      var prev = dia(p.dataPrevistaEntrega);
      if ((p.status === 'ENVIADO' || p.status === 'RECEBIDO_PARCIAL') && prev && prev < hoje) {
        filas.pc_atrasados.push(item(rot, ts(prev + 'T12:00:00Z'), agora, 'entrega prevista para ' + prev.split('-').reverse().join('/')));
      }
    });

    // Retornos.
    chaves(d.devolucoes_cliente).forEach(function(k) {
      var v = d.devolucoes_cliente[k] || {};
      if (v.status === 'AUTORIZADA') filas.devolucoes.push(porIdade(txt(v.numero) || k, primeiroTs(v, 'autorizadoEm', 'criadoEm'), agora, sla.devolucoes));
    });
    chaves(d.solicitacoes_descarte).forEach(function(k) {
      var x = d.solicitacoes_descarte[k] || {};
      if (x.status === 'SOLICITADO') filas.descartes.push(porIdade(txt(x.numero) || txt(x.itemNome) || k, primeiroTs(x, 'criadoEm', 'solicitadoEm', 'em'), agora, sla.descartes));
    });

    var etapas = ETAPAS.map(function(e) {
      var itens = filas[e.id].sort(function(a, b) {
        return (b.atrasado ? 1 : 0) - (a.atrasado ? 1 : 0) || (b.idadeH == null ? -1 : b.idadeH) - (a.idadeH == null ? -1 : a.idadeH);
      });
      var atrasados = itens.filter(function(i) { return i.atrasado; }).length;
      var maior = itens.reduce(function(m, i) { return i.idadeH != null && i.idadeH > m ? i.idadeH : m; }, 0);
      var s = sla[e.id];
      var sev = !itens.length ? 'vazio' : (atrasados >= 3 || (s > 0 && maior > 2 * s && atrasados > 0)) ? 'critico' : atrasados ? 'atencao' : 'ok';
      return {id: e.id, fase: e.fase, setor: e.setor, titulo: e.titulo, href: e.href, slaH: s, n: itens.length,
        atrasados: atrasados, maisAntigaH: itens.length ? maior : null, severidade: sev, itens: itens};
    });

    var porSetor = {};
    etapas.forEach(function(e) {
      var s = porSetor[e.setor] = porSetor[e.setor] || {setor: e.setor, n: 0, atrasados: 0, etapas: []};
      s.n += e.n; s.atrasados += e.atrasados;
      if (e.n) s.etapas.push(e);
    });
    var setores = Object.keys(porSetor).map(function(k) { return porSetor[k]; }).sort(function(a, b) {
      return b.atrasados - a.atrasados || b.n - a.n || (a.setor < b.setor ? -1 : 1);
    });
    var totais = etapas.reduce(function(t, e) { t.n += e.n; t.atrasados += e.atrasados; if (e.severidade === 'critico') t.criticas++; return t; }, {n: 0, atrasados: 0, criticas: 0});
    return {etapas: etapas, setores: setores, totais: totais, fases: FASES, agora: agora};
  }

  // Unidades apontadas na linha (mesma regra da Conferência de PA, estoque.html).
  function qtdApontada(op) {
    if (op && op.tipoOrdem === 'RETRABALHO') {
      var campo = {linha: 'produzidoLinha', rotulagem: 'produzidoRotulagem', posto: 'produzidoPosto'}[op.retrabalhoDestino] || 'produzidoLinha';
      return num(op[campo]);
    }
    return num((op || {}).produzidoLinha) || num((op || {}).produzido);
  }

  function formatarIdade(h) {
    if (h == null) return '—';
    if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min';
    if (h < 48) return Math.round(h) + ' h';
    return Math.round(h / 24) + ' dias';
  }

  /* Texto pronto para colar numa mensagem: o que está parado com o setor. */
  function textoCobranca(setor, analise, limite) {
    var s = analise.setores.filter(function(x) { return x.setor === setor; })[0];
    var max = limite || 5, linhas = [];
    if (!s) return '';
    s.etapas.forEach(function(e) {
      var tarde = e.itens.filter(function(i) { return i.atrasado; });
      if (!tarde.length) return;
      linhas.push('• ' + e.titulo + ' (' + tarde.length + '):');
      tarde.slice(0, max).forEach(function(i) {
        linhas.push('   - ' + i.rotulo + (i.idadeH != null ? ' — há ' + formatarIdade(i.idadeH) : '') + (i.motivo ? ' — ' + i.motivo : ''));
      });
      if (tarde.length > max) linhas.push('   … e mais ' + (tarde.length - max));
    });
    if (!linhas.length) return '';
    return 'Pendências fora do prazo — ' + setor + ' (' + s.atrasados + '):\n' + linhas.join('\n');
  }

  return {ETAPAS: ETAPAS, FASES: FASES, SLA_PADRAO_H: SLA_PADRAO_H, analisar: analisar, textoCobranca: textoCobranca, formatarIdade: formatarIdade};
});
