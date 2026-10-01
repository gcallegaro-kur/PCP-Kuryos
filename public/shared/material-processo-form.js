'use strict';
/* Material em processo no Painel de Turno (form.html) -- parte 2 (01/10).
   Duas ações do líder da linha, as duas ligadas ao mesmo modelo
   (shared/material-processo.js):
     1. CONTAGEM DE SOBRAS exigida ao encerrar a OP: frascos, rótulos, frascos
        rotulados, kg de bulk, todo o BOM -- todo campo precisa de número (0 =
        não sobrou), e o bulk que sobrou vai para uma bombona identificada.
     2. DEVOLVER A OP À FILA: a OP sai da linha MANTENDO o que produziu; o líder
        declara o que ficou retido; a linha é liberada e a pausa é fechada.
   Aqui só tela e gravação; as regras são do módulo puro (testado). */
(function(root) {
  var db = null, amb = {}, MP = null;
  var bombonas = {};

  function e(v) { return typeof escapeHtml === 'function' ? escapeHtml(String(v == null ? '' : v)) : String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function key(v) { return amb.sanitizeKey ? amb.sanitizeKey(v) : String(v).replace(/[.#$\[\]\/]/g, '_'); }
  function agoraIso() { return new Date().toISOString(); }
  function autorPadrao() { return (root.currentUser && (root.currentUser.nome || root.currentUser.email)) || 'Desconhecido'; }
  function campoInicio(setor) { return setor === 'rotulagem' ? 'abertaDesdeRot' : 'abertaDesde'; }
  function campoNome(setor) { return setor === 'rotulagem' ? 'abertaRotulagem' : 'abertaLinha'; }
  function fmt(v) { return Number(v).toLocaleString('pt-BR', {maximumFractionDigits: 3}); }

  function estilo() {
    if (document.getElementById('mpf-estilo')) return;
    var s = document.createElement('style');
    s.id = 'mpf-estilo';
    s.textContent =
      '.mpf-box{border:1.5px solid var(--border,#d1d5db);border-radius:12px;padding:10px 12px;background:color-mix(in srgb,var(--text,#111) 2%,var(--card,#fff))}' +
      '.mpf-ajuda{font-size:12px;color:var(--muted,#6b7280);margin:0 0 8px}' +
      '.mpf-row{display:grid;grid-template-columns:1fr 92px 120px;gap:8px;align-items:center;padding:6px 0;border-top:1px solid color-mix(in srgb,var(--text,#111) 8%,transparent)}' +
      '.mpf-row:first-of-type{border-top:0}' +
      '.mpf-row .d b{font-size:13px;display:block}.mpf-row .d small{font-size:11px;color:var(--muted,#6b7280)}' +
      '.mpf-row input,.mpf-row select{width:100%;box-sizing:border-box;padding:7px 8px;border:1.5px solid var(--border,#d1d5db);border-radius:8px;font-size:14px;background:var(--card,#fff);color:var(--text,#111)}' +
      '.mpf-row .rec{grid-column:1 / -1}' +
      '.mpf-aviso{font-size:12px;color:var(--warning,#b45309);margin-top:6px}' +
      '.mpf-fundo{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10060;display:flex;align-items:center;justify-content:center;padding:14px}' +
      '.mpf-modal{background:var(--card,#fff);color:var(--text,#111);border-radius:16px;max-width:560px;width:100%;max-height:92vh;overflow:auto;padding:18px 20px}' +
      '.mpf-modal h3{margin:0 0 4px;font-size:18px}.mpf-modal label.t{display:block;font-size:12px;font-weight:700;margin:12px 0 4px}' +
      '.mpf-modal select,.mpf-modal input[type=text]{width:100%;box-sizing:border-box;padding:9px 11px;border:1.5px solid var(--border,#d1d5db);border-radius:8px;font-size:14px;background:var(--card,#fff);color:var(--text,#111)}' +
      '.mpf-erro{color:var(--danger,#b91c1c);font-size:13px;margin-top:10px;white-space:pre-line}' +
      '.mpf-acoes{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}';
    document.head.appendChild(s);
  }

  /* Recipientes que podem receber o bulk que sobrou desta OP: vazios, ou com o
     MESMO lote (a contagem acerta o kg dele). */
  function recipientesPara(op) {
    return Object.keys(bombonas).map(function(k) { return bombonas[k]; })
      .filter(function(r) { return r && r.codigo && r.ativo !== false && (MP.situacao(r) === 'VAZIA' || (r.conteudo && r.conteudo.lote === op.lote)); })
      .sort(function(a, b) { return String(a.codigo).localeCompare(String(b.codigo)); });
  }

  /* Desenha as linhas de contagem em `container`. Devolve o controle:
     validar({opcional}) -> {ok, erros, itens}. */
  function renderContagem(container, op, setor, opcoes) {
    estilo();
    var o = opcoes || {};
    var linhas = MP.linhasContagem(op, setor);
    var donoCliente = 'Cliente — ' + (op.cliente || '—');
    var recs = recipientesPara(op);
    container.innerHTML = '<div class="mpf-box"><p class="mpf-ajuda">' + (o.ajuda || '') + '</p>' + linhas.map(function(l) {
      var passo = l.unidade === 'un' ? '1' : 'any';
      return '<div class="mpf-row" data-chave="' + e(l.chave) + '"><div class="d"><b>' + e(l.descricao) + '</b><small>' +
        (l.previsto ? 'previsto na OP: ' + fmt(l.previsto) + ' ' + e(l.unidade) : (l.tipo === 'BULK' ? 'kg em bombona' : e(l.unidade))) + '</small></div>' +
        '<input type="number" class="qtd" min="0" step="' + passo + '" inputmode="' + (l.unidade === 'un' ? 'numeric' : 'decimal') + '" placeholder="' + (o.opcional ? '—' : '0 se não sobrou') + '" aria-label="' + e(l.descricao) + '">' +
        '<select class="dono" title="De quem é o material"><option value="CLIENTE">' + e(donoCliente) + '</option><option value="KURYOS">KURYOS</option></select>' +
        (l.exigeRecipiente ? '<div class="rec"><select class="recipiente" aria-label="Bombona ou tanque do bulk">' +
          '<option value="">— em qual bombona/tanque está o bulk? —</option>' +
          recs.map(function(r) { return '<option value="' + e(r.codigo) + '">' + e(r.codigo) + (r.conteudo ? ' (já tem ' + fmt(MP.kgAtual(r)) + ' kg deste lote)' : ' (vazia)') + '</option>'; }).join('') + '</select>' +
          (recs.length ? '' : '<div class="mpf-aviso">Nenhuma bombona livre. Cadastre em <b>Material em Processo</b> antes de declarar bulk que sobrou.</div>') + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
    return {
      linhas: linhas,
      validar: function(opc) {
        var valores = {};
        linhas.forEach(function(l) {
          var linha = container.querySelector('.mpf-row[data-chave="' + l.chave + '"]');
          var q = linha.querySelector('.qtd').value;
          if ((opc && opc.opcional) && q === '') q = '0';
          var rec = linha.querySelector('.recipiente');
          valores[l.chave] = {qtd: q, donoTipo: linha.querySelector('.dono').value, recipiente: rec ? rec.value : ''};
        });
        return MP.validarContagem(linhas, valores, op);
      }
    };
  }

  /* Bulk contado numa bombona: vazia recebe; do mesmo lote tem o kg acertado. */
  function bulkNaBombona(item, op, opKey, autor, agora, origemTexto) {
    var codigo = item.recipienteCodigo, falha = null, resultado = null;
    var man = (op.manipulacao && op.manipulacao.manipulacao) || {};
    var conteudo = {opKey: opKey, lote: op.lote, sku: op.sku, produto: op.produto, cliente: op.cliente, donoTipo: item.donoTipo, donoNome: item.donoNome,
      kg: item.qtd, fabricadoEm: man.fim || null, validade: op.validade || null, origem: 'SOBRA'};
    return db.ref('bombonas_bulk/' + codigo).transaction(function(atual) {
      falha = null;
      if (!atual) return atual;
      try {
        if (atual.conteudo && MP.kgAtual(atual) > 0) {
          if (atual.conteudo.lote !== op.lote) { falha = codigo + ' já tem bulk de outro lote (' + atual.conteudo.lote + ').'; return; }
          resultado = MP.ajustarKg(atual, item.qtd, 'Contagem de sobras (' + origemTexto + ')', autor, agora);
        } else {
          resultado = MP.encher(atual, conteudo, autor, agora);
        }
        return resultado.rec;
      } catch (er) { falha = er.message; return; }
    }).then(function(res) {
      if (!res.committed) throw new Error(falha || ('Não foi possível gravar o bulk em ' + codigo + '.'));
      return db.ref('bombonas_bulk/' + codigo + '/historico').push(resultado.evento);
    });
  }

  /* Grava a contagem: bulk nas bombonas, itens retidos e o registro de auditoria da OP. */
  function gravarContagem(opKey, op, setor, itens, origem, autor, extra) {
    var agora = agoraIso();
    var origemTexto = origem === 'PAUSA' ? 'OP devolvida à fila' : 'encerramento da OP';
    var passos = itens.filter(function(i) { return i.tipo === 'BULK'; }).reduce(function(p, i) {
      return p.then(function() { return bulkNaBombona(i, op, opKey, autor, agora, origemTexto); });
    }, Promise.resolve());
    return passos.then(function() {
      var up = {};
      MP.registrosDeItens(op, opKey, itens, origem, autor, agora, extra).forEach(function(r) {
        up['material_processo/' + db.ref('material_processo').push().key] = r;
      });
      up['ops/' + opKey + '/contagemSobras/' + db.ref('ops/' + opKey + '/contagemSobras').push().key] = {
        em: agora, por: autor, setor: setor, origem: origem, semSobras: !itens.length,
        itens: itens.map(function(i) { return {tipo: i.tipo, descricao: i.descricao, qtd: i.qtd, unidade: i.unidade, recipiente: i.recipienteCodigo || null, dono: i.donoNome}; })
      };
      return db.ref().update(up);
    });
  }

  /* ── Devolver a OP à fila ── */
  function abrirDevolucao(nome, setor, lote) {
    estilo();
    var opKey = key(lote), op = amb.findOpByLote(lote);
    if (!op) return alert('OP não encontrada.');
    if (!op[campoInicio(setor)] || op[campoNome(setor)] !== nome) return alert('Esta OP não está mais alocada aqui. Atualize o painel.');
    var fundo = document.createElement('div');
    fundo.className = 'mpf-fundo';
    fundo.innerHTML = '<div class="mpf-modal" role="dialog" aria-label="Devolver OP à fila"><h3>⏸ Devolver OP à fila</h3>' +
      '<p class="mpf-ajuda">A OP <b>' + e(op.lote) + '</b> sai de <b>' + e(nome) + '</b> sem ser encerrada: tudo que ela já produziu fica registrado e a ' + (setor === 'rotulagem' ? 'rotuladora' : 'linha') + ' fica livre para outro produto. Para retomar, é só alocar a OP de novo em qualquer ' + (setor === 'rotulagem' ? 'rotuladora' : 'linha') + '.</p>' +
      '<label class="t" for="mpfMotivo">Por que a OP sai?</label><select id="mpfMotivo">' + MP.MOTIVOS_FILA.map(function(m) { return '<option>' + e(m) + '</option>'; }).join('') + '</select>' +
      '<label class="t" for="mpfDetalhe">Detalhe (obrigatório se "Outro"; ajuda a lembrar depois)</label><input type="text" id="mpfDetalhe" maxlength="140" placeholder="Ex.: faltam válvulas, cliente ainda não enviou">' +
      '<label class="t" for="mpfQuem">Quem está declarando</label><input type="text" id="mpfQuem" maxlength="60" value="' + e(autorPadrao()) + '">' +
      '<label class="t">O que ficou retido (deixe em branco o que não ficou)</label><div id="mpfContagem"></div>' +
      '<label style="display:flex;gap:8px;align-items:flex-start;margin-top:12px;font-size:13px"><input type="checkbox" id="mpfConfirma"> <span>Declarei tudo que ficou retido (ou nada ficou retido).</span></label>' +
      '<div class="mpf-erro" id="mpfErro" hidden></div>' +
      '<div class="mpf-acoes"><button type="button" class="btn-cancel" id="mpfCancelar">Cancelar</button><button type="button" class="btn-confirm-danger" id="mpfConfirmar" style="background:var(--primary)">Devolver à fila</button></div></div>';
    document.body.appendChild(fundo);
    var ctl = renderContagem(fundo.querySelector('#mpfContagem'), op, setor, {opcional: true, ajuda: 'Frascos já rotulados, componentes, bulk em bombona: o que está parado esperando esta OP voltar.'});
    function fechar() { if (fundo.parentNode) fundo.parentNode.removeChild(fundo); }
    function erro(t) { var x = fundo.querySelector('#mpfErro'); x.hidden = !t; x.textContent = t || ''; }
    fundo.querySelector('#mpfCancelar').onclick = fechar;
    fundo.querySelector('#mpfConfirmar').onclick = function() {
      var bt = this;
      var motivo = fundo.querySelector('#mpfMotivo').value, detalhe = fundo.querySelector('#mpfDetalhe').value.trim();
      var quem = fundo.querySelector('#mpfQuem').value.trim();
      if (!quem) return erro('Informe quem está declarando.');
      var vd = MP.validarDevolucao({motivo: motivo, detalhe: detalhe, confirmouRetidos: fundo.querySelector('#mpfConfirma').checked});
      if (!vd.ok) return erro(vd.erros.join('\n'));
      var vc = ctl.validar({opcional: true});
      if (!vc.ok) return erro(vc.erros.join('\n'));
      bt.disabled = true; erro('');
      var motivoTexto = motivo === 'Outro' ? detalhe : (motivo + (detalhe ? ' — ' + detalhe : ''));
      executarDevolucao({nome: nome, setor: setor, op: op, opKey: opKey, motivo: motivoTexto, quem: quem, itens: vc.itens}).then(function() {
        fechar();
        if (amb.showSuccess) amb.showSuccess('OP devolvida à fila', nome + ' está livre. A OP ' + op.lote + ' mantém o que produziu' + (vc.itens.length ? ' e ' + vc.itens.length + (vc.itens.length === 1 ? ' item retido' : ' itens retidos') + ' foram registrados.' : '.'));
      }).catch(function(err) { bt.disabled = false; erro('Não foi possível devolver a OP: ' + err.message); });
    };
    fundo.addEventListener('mousedown', function(ev) { if (ev.target === fundo) fechar(); });
  }

  function executarDevolucao(d) {
    var agora = agoraIso(), falha = null, campos = null;
    return db.ref('ops/' + d.opKey).transaction(function(op) {
      falha = null;
      if (!op) return op;
      if (!op[campoInicio(d.setor)] || op[campoNome(d.setor)] !== d.nome) { falha = 'A OP não está mais alocada em ' + d.nome + '. Atualize o painel.'; return; }
      campos = MP.camposDevolucao(op, d.setor, d.motivo, d.quem, agora);
      Object.keys(campos).forEach(function(k) { if (campos[k] === null) delete op[k]; else op[k] = campos[k]; });
      return op;
    }).then(function(res) {
      if (!res.committed) throw new Error(falha || 'A OP mudou enquanto você confirmava. Atualize o painel e tente de novo.');
      var lineKey = key(d.nome), estado = (amb.getEstadoLinhas() || {})[lineKey] || {};
      var up = {};
      if (estado.status === 'parada') {
        var inicio = estado.inicioParada || agora;
        var dur = Math.max(0, Math.round((Date.parse(agora) - Date.parse(inicio)) / 60000)) || 0;
        up['paradas_historico/' + db.ref('paradas_historico').push().key] = {
          linha: d.nome, setor: estado.setor || (d.setor === 'rotulagem' ? 'rotulagem' : 'linha'), pedidoId: estado.pedidoId || '', produto: estado.produto || d.op.produto || '',
          lote: estado.lote || d.op.lote || '', motivo: estado.motivoParada || 'Outros', inicio: inicio, fim: agora, duracao: dur, timestamp: agora, devolvidaAFila: true
        };
      }
      up['estado_linhas/' + lineKey + '/status'] = 'ativa';
      ['inicioParada', 'motivoParada', 'opAtual', 'lote', 'pedidoId', 'produto'].forEach(function(c) { up['estado_linhas/' + lineKey + '/' + c] = null; });
      up['ops/' + d.opKey + '/devolucoesFila/' + db.ref('ops/' + d.opKey + '/devolucoesFila').push().key] = {
        em: agora, por: d.quem, setor: d.setor, linha: d.nome, motivo: d.motivo, retidos: d.itens.length
      };
      return db.ref().update(up);
    }).then(function() {
      return gravarContagem(d.opKey, d.op, d.setor, d.itens, 'PAUSA', d.quem, {});
    });
  }

  function iniciar(banco, ambiente) {
    db = banco; amb = ambiente || {}; MP = root.MaterialProcesso;
    var ref = db.ref('bombonas_bulk');
    var ouvir = typeof dbOnValue === 'function' ? dbOnValue : function(r, cb) { r.on('value', cb); };
    ouvir(ref, function(snap) { bombonas = snap.val() || {}; });
  }

  root.MaterialProcessoForm = {iniciar: iniciar, renderContagem: renderContagem, gravarContagem: gravarContagem, abrirDevolucao: abrirDevolucao, recipientesPara: recipientesPara};
})(window);
