/* Material em processo (WIP): bulk em bombona, frascos rotulados, sobras.

   Pedido do usuário (2026-10-01): "minha preocupação é com materiais semi
   acabados, frascos rotulados, válvulas cortadas/sem a tampinha, e até bulk de
   produto". Respostas dele:
     - prioridade: bulk e frascos rotulados;
     - quem declara: o líder da linha. Ao FINAL da OP a contagem de sobras é
       exigida (frascos, rótulos, frascos rotulados, kg de bulk, "todo o BOM ou
       intermediários possíveis");
     - o bulk fica em BOMBONA (às vezes tanque), que hoje não tem controle nem
       identificação: emitir etiqueta com lote, validade etc.;
     - tudo em unidades (bulk em kg); o dono às vezes é o cliente, às vezes a Kuryos.

   Três nós no banco:
     bombonas_bulk/{BB-0001}   o recipiente: tipo, capacidade e CONTEÚDO atual
                               (OP/lote, produto, kg, fabricação, validade, dono)
                               + histórico de cada enchimento/ajuste/esvaziamento
     material_processo/{id}    cada item retido (sobra ou retido na pausa), com
                               OP, quantidade, dono, local e situação
     ops/{op}/contagemSobras/{setor}  a contagem de encerramento, para auditoria

   Funções PURAS, testadas em run_material_processo_test.js. O que grava no
   banco (transaction da bombona, update em vários caminhos) fica na tela. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MaterialProcesso = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var TIPOS_RECIPIENTE = {BOMBONA: {rotulo: 'Bombona', prefixo: 'BB'}, TANQUE: {rotulo: 'Tanque', prefixo: 'TQ'}};
  var TIPOS_ITEM = {
    BULK: {rotulo: 'Bulk', unidade: 'kg'},
    FRASCO_ROTULADO: {rotulo: 'Frascos rotulados', unidade: 'un'},
    COMPONENTE: {rotulo: 'Componente', unidade: 'un'}
  };
  var CAPACIDADE_MAX_KG = 5000;   // trava de digitação (tanque grande), não regra de negócio

  function texto(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function arred(v) { return Math.round(num(v) * 1000) / 1000; }
  function ehData(v) { return /^\d{4}-\d{2}-\d{2}/.test(texto(v)); }

  /* ── Bombonas e tanques ─────────────────────────────────────────── */
  function codigoRecipiente(tipo, n) {
    var t = TIPOS_RECIPIENTE[tipo];
    if (!t) throw new Error('Tipo de recipiente inválido: ' + tipo);
    return t.prefixo + '-' + String(Math.max(1, Math.floor(num(n)))).padStart(4, '0');
  }

  function validarNovos(d) {
    var erros = [];
    if (!TIPOS_RECIPIENTE[d && d.tipo]) erros.push('Escolha bombona ou tanque.');
    var q = Math.floor(num(d && d.quantidade));
    if (!(q >= 1 && q <= 100)) erros.push('Informe de 1 a 100 recipientes por vez.');
    var cap = d && d.capacidadeKg !== '' && d.capacidadeKg != null ? num(d.capacidadeKg) : null;
    if (cap != null && !(cap > 0 && cap <= CAPACIDADE_MAX_KG)) erros.push('Capacidade em kg inválida (use um valor entre 1 e ' + CAPACIDADE_MAX_KG + ' ou deixe em branco).');
    return {ok: !erros.length, erros: erros, quantidade: q, capacidadeKg: cap};
  }

  function novoRecipiente(codigo, tipo, capacidadeKg, autor, agora) {
    return {codigo: codigo, tipo: tipo, capacidadeKg: capacidadeKg == null ? null : arred(capacidadeKg), ativo: true,
      criadoEm: agora, criadoPor: texto(autor) || null, conteudo: null};
  }

  function kgAtual(rec) { return rec && rec.conteudo ? arred(rec.conteudo.kg) : 0; }
  function situacao(rec) {
    if (!rec || rec.ativo === false) return 'INATIVA';
    return kgAtual(rec) > 0 ? 'CHEIA' : 'VAZIA';
  }

  /* Dono: o material às vezes é do cliente, às vezes da Kuryos (decisão do usuário). */
  function dono(donoTipo, op) {
    if (donoTipo === 'KURYOS') return {donoTipo: 'KURYOS', donoNome: 'KURYOS'};
    return {donoTipo: 'CLIENTE', donoNome: texto(op && op.cliente) || '—'};
  }

  /* Pode colocar este bulk neste recipiente? Recipiente com outro lote não
     recebe (bulk de lotes diferentes não se mistura); complemento do MESMO lote
     soma. Capacidade, se cadastrada, não pode estourar. */
  function podeEncher(rec, conteudo) {
    var erros = [];
    if (!rec || rec.ativo === false) return {ok: false, erros: ['Recipiente inexistente ou inativo.']};
    var kg = num(conteudo && conteudo.kg);
    if (!(kg > 0)) erros.push('Informe os kg (maior que zero).');
    if (!texto(conteudo && conteudo.lote)) erros.push('O bulk precisa de lote (o lote da OP).');
    var atual = rec.conteudo;
    if (atual && kgAtual(rec) > 0) {
      if (texto(atual.lote) !== texto(conteudo && conteudo.lote)) erros.push(rec.codigo + ' já tem bulk do lote ' + atual.lote + ' (' + kgAtual(rec) + ' kg). Esvazie-o antes ou escolha outro recipiente.');
      else if ((atual.donoTipo || '') !== (conteudo.donoTipo || '') || (atual.donoNome || '') !== (conteudo.donoNome || '')) erros.push('O dono do bulk não bate com o que já está em ' + rec.codigo + '.');
    }
    if (rec.capacidadeKg && kg + kgAtual(rec) > rec.capacidadeKg + 0.0005) {
      erros.push('Passa da capacidade de ' + rec.codigo + ' (' + rec.capacidadeKg + ' kg): já tem ' + kgAtual(rec) + ' kg e cabem mais ' + arred(rec.capacidadeKg - kgAtual(rec)) + ' kg.');
    }
    return {ok: !erros.length, erros: erros, modo: atual && kgAtual(rec) > 0 ? 'complemento' : 'novo'};
  }

  function historico(tipo, antes, depois, extra, autor, agora) {
    return Object.assign({tipo: tipo, kgAntes: arred(antes), kgDepois: arred(depois), por: texto(autor) || null, em: agora}, extra || {});
  }

  /* Devolve {rec, evento}: o recipiente novo e a linha de histórico. Não muta o original. */
  function encher(rec, conteudo, autor, agora) {
    var chk = podeEncher(rec, conteudo);
    if (!chk.ok) throw new Error(chk.erros.join(' '));
    var antes = kgAtual(rec);
    var kg = arred(num(conteudo.kg));
    var base = chk.modo === 'complemento' ? rec.conteudo : {};
    var novo = JSON.parse(JSON.stringify(rec));
    novo.conteudo = Object.assign({}, base, {
      opKey: conteudo.opKey || base.opKey || null, lote: texto(conteudo.lote), sku: conteudo.sku || base.sku || null,
      produto: conteudo.produto || base.produto || null, cliente: conteudo.cliente || base.cliente || null,
      donoTipo: conteudo.donoTipo || 'CLIENTE', donoNome: conteudo.donoNome || conteudo.cliente || '—',
      kg: arred(antes + kg),
      fabricadoEm: base.fabricadoEm || conteudo.fabricadoEm || agora,
      validade: base.validade || conteudo.validade || null,
      origem: conteudo.origem || base.origem || 'MANIPULACAO',
      // Complemento sem local não apaga o local já informado.
      local: texto(conteudo.local) || base.local || '',
      atualizadoEm: agora, atualizadoPor: texto(autor) || null
    });
    return {rec: novo, evento: historico('ENCHER', antes, novo.conteudo.kg, {adicionado: kg, lote: texto(conteudo.lote), opKey: conteudo.opKey || null, origem: novo.conteudo.origem}, autor, agora)};
  }

  /* Ajuste de kg (contagem, retirada para envase, perda). kg novo 0 esvazia. */
  function ajustarKg(rec, kgNovo, motivo, autor, agora) {
    if (!rec || !rec.conteudo || kgAtual(rec) <= 0) throw new Error('Recipiente vazio: não há o que ajustar.');
    var kg = num(kgNovo);
    if (!(kg >= 0)) throw new Error('Kg inválido.');
    if (!texto(motivo)) throw new Error('Informe o motivo do ajuste.');
    if (rec.capacidadeKg && kg > rec.capacidadeKg + 0.0005) throw new Error('Passa da capacidade de ' + rec.codigo + ' (' + rec.capacidadeKg + ' kg).');
    var antes = kgAtual(rec);
    var novo = JSON.parse(JSON.stringify(rec));
    if (kg === 0) { novo.conteudo = null; return {rec: novo, evento: historico('ESVAZIAR', antes, 0, {motivo: texto(motivo), lote: rec.conteudo.lote, opKey: rec.conteudo.opKey || null}, autor, agora)}; }
    novo.conteudo.kg = arred(kg);
    novo.conteudo.atualizadoEm = agora; novo.conteudo.atualizadoPor = texto(autor) || null;
    return {rec: novo, evento: historico('AJUSTE', antes, kg, {motivo: texto(motivo), lote: rec.conteudo.lote, opKey: rec.conteudo.opKey || null}, autor, agora)};
  }

  /* Dados para a etiqueta (shared/etiquetas-wms.js, formato 'bombona'). */
  function dadosEtiqueta(rec) {
    var c = rec && rec.conteudo;
    return {
      codigo: rec.codigo, tipo: rec.tipo, tipoRotulo: (TIPOS_RECIPIENTE[rec.tipo] || {}).rotulo || rec.tipo,
      capacidadeKg: rec.capacidadeKg || null, vazia: !c || kgAtual(rec) <= 0,
      produto: c ? c.produto : null, sku: c ? c.sku : null, lote: c ? c.lote : null, kg: c ? kgAtual(rec) : 0,
      fabricadoEm: c ? c.fabricadoEm : null, validade: c ? c.validade : null,
      donoTipo: c ? c.donoTipo : null, donoNome: c ? c.donoNome : null, local: c ? c.local : null
    };
  }

  /* ── Contagem de sobras no fim da OP ────────────────────────────── */
  // EP = embalagem primária (frasco, válvula, tampa), ES = secundária (rótulo,
  // cartucho), ET = terciária (caixa de embarque).
  function classeDoMaterial(codigo) {
    var m = /^(EP|ES|ET)-/.exec(texto(codigo));
    return m ? m[1] : null;
  }

  /* As linhas que o líder precisa contar ao encerrar `setor` ('linha' = envase,
     'rotulagem'). BOM da OP + frascos rotulados + bulk (só no envase, e só em OP
     que tem fase de bulk). Cada linha tem uma chave estável. */
  function linhasContagem(op, setor) {
    var linhas = [];
    var consumo = (op && op.materiaisConsumo) || {};
    Object.keys(consumo).forEach(function(k) {
      var i = consumo[k] || {};
      if (i.origem !== 'bom' || !i.mpCodigo) return;
      var classe = classeDoMaterial(i.mpCodigo);
      // Na rotulagem só interessa o que ela consome (rótulos, ES). No envase, todo o BOM.
      if (setor === 'rotulagem' && classe !== 'ES') return;
      linhas.push({chave: 'mat:' + i.mpCodigo, tipo: 'COMPONENTE', materialCodigo: i.mpCodigo, descricao: i.mpNome || i.mpCodigo,
        unidade: i.unidade || 'un', previsto: num(i.quantidade) || null, classe: classe});
    });
    linhas.push({chave: 'frascos_rotulados', tipo: 'FRASCO_ROTULADO', materialCodigo: null, descricao: 'Frascos já rotulados que sobraram', unidade: 'un', previsto: null, classe: null});
    if (setor !== 'rotulagem' && op && (op.manipulacao || num(op.massaLoteKg) > 0)) {
      linhas.push({chave: 'bulk', tipo: 'BULK', materialCodigo: null, descricao: 'Bulk que sobrou (kg)', unidade: 'kg', previsto: null, classe: null, exigeRecipiente: true});
    }
    return linhas;
  }

  /* valores: {chave: {qtd: '12', recipiente: 'BB-0001', donoTipo: 'CLIENTE'|'KURYOS'}}.
     TODA linha precisa de número (0 = não sobrou): a contagem é exigida, e "em
     branco" não pode passar por "zero". Bulk com sobra exige recipiente. */
  function validarContagem(linhas, valores, op) {
    var erros = [], itens = [];
    (linhas || []).forEach(function(l) {
      var v = (valores && valores[l.chave]) || {};
      var bruto = v.qtd;
      if (bruto === '' || bruto == null || !isFinite(Number(bruto))) { erros.push('Informe a quantidade de "' + l.descricao + '" (0 se não sobrou nada).'); return; }
      var q = Number(bruto);
      if (q < 0) { erros.push('"' + l.descricao + '": a quantidade não pode ser negativa.'); return; }
      if (l.unidade === 'un' && Math.floor(q) !== q) { erros.push('"' + l.descricao + '": use número inteiro de unidades.'); return; }
      if (l.exigeRecipiente && q > 0 && !texto(v.recipiente)) { erros.push('Escolha em qual bombona ou tanque está o bulk que sobrou.'); return; }
      if (q > 0) {
        var d = dono(v.donoTipo, op);
        itens.push({chave: l.chave, tipo: l.tipo, materialCodigo: l.materialCodigo, descricao: l.descricao, qtd: arred(q), unidade: l.unidade,
          recipienteCodigo: l.exigeRecipiente ? texto(v.recipiente) : null, donoTipo: d.donoTipo, donoNome: d.donoNome});
      }
    });
    return {ok: !erros.length, erros: erros, itens: itens};
  }

  /* O que cada item com sobra vira em material_processo/ (sem id: o push gera). */
  function registrosDeItens(op, opKey, itens, origem, autor, agora, extra) {
    return (itens || []).map(function(i) {
      return Object.assign({
        opKey: opKey, lote: op.lote || opKey, produto: op.produto || null, sku: op.sku || null, cliente: op.cliente || null,
        tipo: i.tipo, materialCodigo: i.materialCodigo || null, descricao: i.descricao, qtd: i.qtd, unidade: i.unidade,
        recipienteCodigo: i.recipienteCodigo || null, donoTipo: i.donoTipo, donoNome: i.donoNome,
        origem: origem, declaradoPor: texto(autor) || null, em: agora, status: 'EM_PROCESSO'
      }, extra || {});
    });
  }

  /* ── Devolver a OP à fila ────────────────────────────────────────── */
  var MOTIVOS_FILA = ['Falta de material do cliente', 'Falta de componente', 'Troca de prioridade do PCP', 'Defeito de máquina ou ferramenta', 'Outro'];

  function validarDevolucao(d) {
    var erros = [];
    if (!texto(d && d.motivo)) erros.push('Informe o motivo de a OP sair da linha.');
    if (texto(d && d.motivo) === 'Outro' && !texto(d && d.detalhe)) erros.push('Descreva o motivo (escolheu "Outro").');
    if (!d || !d.confirmouRetidos) erros.push('Confirme a declaração do que ficou retido (ou marque que nada ficou).');
    return {ok: !erros.length, erros: erros};
  }

  /* A OP sai da linha MANTENDO tudo que produziu. Retorna os campos a mudar na
     OP (flat, para update por caminho) e o marcador de fila. Pura. */
  function camposDevolucao(op, setor, motivo, autor, agora) {
    var rot = setor === 'rotulagem';
    var campos = {};
    campos[rot ? 'abertaDesdeRot' : 'abertaDesde'] = null;
    campos[rot ? 'abertaRotulagem' : 'abertaLinha'] = null;
    campos.emFila = {desde: agora, setor: rot ? 'rotulagem' : 'linha', motivo: texto(motivo),
      linhaAnterior: rot ? (op.abertaRotulagem || null) : (op.abertaLinha || null), por: texto(autor) || null};
    return campos;
  }

  /* Resumo curto do que está retido numa OP (Controle de OPs, Andon). */
  function resumoRetidos(registros) {
    var por = {};
    (registros || []).forEach(function(r) {
      if (!r || r.status !== 'EM_PROCESSO') return;
      var k = r.tipo + '|' + (r.unidade || '');
      por[k] = por[k] || {tipo: r.tipo, unidade: r.unidade, qtd: 0, itens: 0};
      por[k].qtd = arred(por[k].qtd + num(r.qtd)); por[k].itens++;
    });
    return Object.keys(por).map(function(k) { return por[k]; });
  }
  function rotuloResumo(r) {
    var q = Number(r.qtd).toLocaleString('pt-BR', {maximumFractionDigits: 3});
    if (r.tipo === 'BULK') return q + ' kg de bulk';
    if (r.tipo === 'FRASCO_ROTULADO') return q + ' frascos rotulados';
    return q + ' ' + (r.unidade || 'un') + ' de componentes';
  }

  return {TIPOS_RECIPIENTE: TIPOS_RECIPIENTE, TIPOS_ITEM: TIPOS_ITEM, MOTIVOS_FILA: MOTIVOS_FILA,
    codigoRecipiente: codigoRecipiente, validarNovos: validarNovos, novoRecipiente: novoRecipiente, kgAtual: kgAtual, situacao: situacao,
    dono: dono, podeEncher: podeEncher, encher: encher, ajustarKg: ajustarKg, dadosEtiqueta: dadosEtiqueta,
    classeDoMaterial: classeDoMaterial, linhasContagem: linhasContagem, validarContagem: validarContagem, registrosDeItens: registrosDeItens,
    validarDevolucao: validarDevolucao, camposDevolucao: camposDevolucao, resumoRetidos: resumoRetidos, rotuloResumo: rotuloResumo};
});
