/* Auditoria 5S (06/10/2026) -- regras puras.

   Origem: a analista de Qualidade pediu o checklist 5S no sistema (planilha
   Checklists_Auditoria_5S.xlsx + roteiro do assistente). Dois modos de
   auditoria e um terceiro de inspeção:

     LIDER      líder do setor, todo dia, no fim do turno (8 itens + 4 perguntas)
     QUALIDADE  auditoria cruzada SEM AVISO, de alguém de fora do setor (20 itens + 4 críticos + conferência do líder)
     DIRETORIA  inspeção surpresa da diretoria (mesmo checklist da Qualidade)

   Regras do roteiro, todas aqui e testadas em run_auditoria_5s_test.js:
   - cada item é C, NC ou NA (itens críticos: só C ou NC);
   - todo NC exige local/posto, foto (ao menos 1) e ação imediata COM responsável;
   - % conformidade = C ÷ (C + NC), NA não entra; VERDE ≥ meta, AMARELO ≥ limite, VERMELHO abaixo;
   - NC em item crítico = VERMELHO "ITEM CRÍTICO", qualquer que seja a porcentagem
     (líder: só o item 5; Qualidade/Diretoria: C1 a C4);
   - V1 "Não" (checklist do líder não confere) acrescenta "LÍDER NÃO CONFERE";
   - a escada disciplinar só SUGERE o degrau; quem aplica é o RH/jurídico.
   O registro fechado não muda mais (regra do banco): é prova formal. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Auditoria5S = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  /* Setores e áreas (decisão do usuário, 06/10): a lista abaixo é o ponto de partida; o administrador edita em
     Configuração (auditoria5s_config/setores). A auditoria é por SETOR; as áreas são os locais dentro dele
     (sugestão para o "local/posto" do NC e responsável da área). */
  var SETORES_PADRAO = [
    {nome: 'Produção', areas: ['Linha 1', 'Linha 2', 'Linha 3']},
    {nome: 'Manipulação', areas: ['Manipulação', 'Estoque']},
    {nome: 'Rotulagem', areas: ['Rotulagem 1', 'Rotulagem 2', 'Rotulagem 3', 'Estoque']},
    {nome: 'Refeitório', areas: []},
    {nome: 'Vestiários', areas: []},
    {nome: 'Escritório', areas: []},
    {nome: 'Estoque MUC (Material de Uso e Consumo)', areas: []},
    {nome: 'Recepção', areas: []},
    {nome: 'Expedição', areas: ['Estoque', 'Doca']},
    {nome: 'Laboratório', areas: []},
    {nome: 'Manutenção', areas: []},
    {nome: 'Área de Lavagem', areas: []},
    {nome: 'DML', areas: []},
    {nome: 'Retenção', areas: []},
    {nome: 'Reciclagem', areas: []}
  ];
  var SETORES = SETORES_PADRAO.map(function(s) { return s.nome; });
  var TURNOS = ['1º', '2º', '3º'];
  var TIPOS = {
    LIDER: {rotulo: 'Checklist do líder', surpresa: false},
    QUALIDADE: {rotulo: 'Auditoria da Qualidade', surpresa: true},
    DIRETORIA: {rotulo: 'Inspeção da Diretoria', surpresa: true}
  };
  var PARAMETROS = {verde: 0.85, amarelo: 0.70, auditoriasPorSemana: 2};

  var ITENS_LIDER = [
    {n: '1', texto: 'Posto de trabalho conforme a foto-padrão', como: 'Comparar cada posto com a foto afixada.'},
    {n: '2', texto: 'Ferramentas e materiais no lugar demarcado', como: 'Quadro de sombra, etiquetas e demarcações. Nada fora do lugar.'},
    {n: '3', texto: 'Piso e bancada limpos no fim do turno', como: 'Sem pó, cavaco, óleo, resíduo ou embalagem.'},
    {n: '4', texto: 'Nada no chão fora da demarcação', como: 'Paletes, caixas e materiais só dentro da faixa.'},
    {n: '5', texto: 'CRÍTICO: corredores e saídas de emergência livres', como: 'Corredor, saída, extintor e painel elétrico desobstruídos.', critico: true},
    {n: '6', texto: 'Lixo na lixeira correta', como: 'Coleta seletiva respeitada; lixeira não transborda.'},
    {n: '7', texto: 'Checklist diário preenchido e assinado pelos responsáveis dos postos', como: 'Conferir o preenchimento de todos os postos do setor.'},
    {n: '8', texto: 'Máquina e equipamento limpos, sem vazamento aparente', como: 'Sem vazamento, fio solto, sujeira acumulada ou improviso.'}
  ];
  var PERGUNTAS_LIDER = [
    {n: '9', chave: 'mutirao', texto: 'Mutirão de 10 min realizado no fim do turno?', como: 'Informe horário de início e duração.', tipo: 'simnao'},
    {n: '10', chave: 'todosParticiparam', texto: 'Todos participaram, inclusive o líder?', como: 'Se não: quantos faltaram. Cada um vira ocorrência individual.', tipo: 'simnao'},
    {n: '11', chave: 'pendenciasOntem', texto: 'Pendências de ontem foram resolvidas?', como: 'Conferir as ações do checklist do dia anterior.', tipo: 'simnaona'},
    {n: '12', chave: 'ocorrencias', texto: 'Nº de ocorrências individuais registradas hoje', como: 'Registre na aba Ocorrências.', tipo: 'numero'}
  ];
  var SENSOS = ['Seiri', 'Seiton', 'Seiso', 'Seiketsu', 'Shitsuke'];
  var ITENS_QUALIDADE = [
    ['Seiri', 'Não há itens desnecessários no posto (sucata, peça quebrada, objeto pessoal)', 'Olhar bancadas, gavetas, armários e chão.'],
    ['Seiri', 'Itens sem uso estão com cartão vermelho ou já foram removidos', 'Conferir a área de quarentena e as datas.'],
    ['Seiri', 'Não há material em excesso no posto, só o necessário para o turno', 'Comparar com o consumo do turno.'],
    ['Seiri', 'Documentos e materiais vencidos ou obsoletos retirados', 'Ver quadros, pastas e prateleiras.'],
    ['Seiton', 'Ferramentas e materiais nos lugares demarcados (quadro de sombra, etiquetas)', 'Percorrer todos os postos do setor.'],
    ['Seiton', 'Piso demarcado e visível, nada fora da demarcação', 'Paletes, caixas e carrinhos dentro da faixa.'],
    ['Seiton', 'Prateleiras, gavetas e caixas identificadas, conteúdo confere com a etiqueta', 'Abrir 3 gavetas / caixas ao acaso.'],
    ['Seiton', 'Teste dos 30 segundos: a equipe acha um item pedido pelo auditor', 'Pedir 1 item aleatório e cronometrar.'],
    ['Seiso', 'Piso, bancadas e paredes limpos, sem óleo, pó ou resíduos', 'Passar a mão em 3 pontos; olhar cantos e atrás dos equipamentos.'],
    ['Seiso', 'Máquinas limpas, sem vazamento, fio solto ou desgaste visível', 'Ver base, mangueiras, conexões e painéis.'],
    ['Seiso', 'Lixeiras corretas (coleta seletiva), sem transbordar', 'Conferir cor, identificação e nível.'],
    ['Seiso', 'Material de limpeza no lugar; plano de limpeza com responsáveis visível e em dia', 'Ver quadro do plano e as assinaturas.'],
    ['Seiketsu', 'Foto-padrão afixada e posto igual à foto', 'Comparar com a foto no mesmo ângulo.'],
    ['Seiketsu', 'Identificação visual padronizada (cores, etiquetas, sinalização) e legível', 'Ver etiquetas apagadas, soltas ou fora do padrão.'],
    ['Seiketsu', 'Checklist do líder preenchido e assinado hoje e nos dias anteriores da semana', 'Pedir a pasta e conferir cada dia.'],
    ['Seiketsu', 'Mesmo padrão mantido nos demais turnos', 'Ver registros e fotos do turno anterior.'],
    ['Shitsuke', "Equipe sabe explicar o que é 'conforme' no seu posto", 'Perguntar a 2 colaboradores, em campo.'],
    ['Shitsuke', 'Mutirão de 10 min ocorre, com participação de todos', 'Observar no fim do turno e conferir o registro.'],
    ['Shitsuke', 'Ocorrências do período foram registradas e tratadas pela escada disciplinar', 'Conferir as ocorrências do setor.'],
    ['Shitsuke', 'Pendências da última auditoria foram resolvidas no prazo', 'Comparar com a folha de auditoria anterior.']
  ].map(function(x, i) { return {n: String(i + 1), senso: x[0], texto: x[1], como: x[2]}; });
  var CRITICOS = [
    {n: 'C1', texto: 'Saídas de emergência, corredores e extintores livres e sinalizados', como: 'Verificar todo o setor, sem exceção.'},
    {n: 'C2', texto: 'Produtos químicos identificados, armazenados corretamente e sem derramamento', como: 'Rótulos, bacia de contenção e local.'},
    {n: 'C3', texto: 'EPIs em uso e em bom estado, conforme a função', como: 'Observar os colaboradores em atividade.'},
    {n: 'C4', texto: 'Painéis elétricos, fios e quadros desobstruídos, sem improvisos', como: 'Distância mínima livre e sem gambiarras.'}
  ].map(function(c) { c.critico = true; return c; });
  var CONFERENCIA = [
    {n: 'V1', chave: 'v1', texto: 'O checklist do líder de hoje confere com o que o auditor encontrou?', como: 'Comparar item por item. Se Não: ocorrência ao líder.'},
    {n: 'V2', chave: 'v2', texto: 'O líder registrou as ocorrências individuais que viu?', como: 'Conferir as ocorrências do setor e o campo do checklist do líder.'}
  ];

  function txt(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function norm(s) { return txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  /* Itens que valem para o modo (a ordem é a da tela). */
  /* Lista de setores a usar: a da configuração (objeto do banco) ou a padrão. Cada um vem como
     {nome, ativo, areas:[{nome, responsavel}]}; a ordem é a da configuração (campo `ordem`). */
  function setoresConfigurados(cfgSetores) {
    var chaves = cfgSetores && typeof cfgSetores === 'object' ? Object.keys(cfgSetores).filter(function(k) { return cfgSetores[k] && txt(cfgSetores[k].nome); }) : [];
    if (!chaves.length) return SETORES_PADRAO.map(function(s) { return {id: null, nome: s.nome, ativo: true, areas: s.areas.map(function(a) { return {nome: a, responsavel: ''}; })}; });
    return chaves.sort(function(a, b) { return (num(cfgSetores[a].ordem) - num(cfgSetores[b].ordem)) || String(cfgSetores[a].nome).localeCompare(String(cfgSetores[b].nome), 'pt-BR'); }).map(function(k) {
      var s = cfgSetores[k], as = s.areas;
      var lista = !as ? [] : (Array.isArray(as) ? as : Object.keys(as).sort().map(function(x) { return as[x]; }));
      return {id: k, nome: txt(s.nome), ativo: s.ativo !== false, areas: lista.filter(function(a) { return a && txt(typeof a === 'string' ? a : a.nome); }).map(function(a) { return typeof a === 'string' ? {nome: txt(a), responsavel: ''} : {nome: txt(a.nome), responsavel: txt(a.responsavel)}; })};
    });
  }
  function itensDoTipo(tipo) {
    return tipo === 'LIDER' ? {principais: ITENS_LIDER, criticos: [], perguntas: PERGUNTAS_LIDER, conferencia: []}
      : {principais: ITENS_QUALIDADE, criticos: CRITICOS, perguntas: [], conferencia: CONFERENCIA};
  }
  function ehCritico(tipo, n) {
    if (tipo === 'LIDER') return String(n) === '5';
    return /^C\d$/.test(String(n));
  }
  function fotosDe(item) {
    var f = item && item.fotos;
    if (!f) return [];
    return (Array.isArray(f) ? f : Object.keys(f).map(function(k) { return f[k]; })).filter(function(x) { return x && (x.url || x.caminho); });
  }

  /* Um item respondido. `fotosPendentes` = quantas fotos já escolhidas e ainda não enviadas. */
  function validarItem(item, n, tipo, fotosPendentes) {
    var erros = [], it = item || {}, r = txt(it.r).toUpperCase();
    var critico = ehCritico(tipo, n);
    if (r !== 'C' && r !== 'NC' && r !== 'NA') return ['Item ' + n + ': responda C, NC ou NA (não vale "mais ou menos").'];
    if (critico && r === 'NA') return ['Item ' + n + ': item crítico só aceita C ou NC.'];
    if (r === 'NC') {
      if (!txt(it.local)) erros.push('Item ' + n + ' (NC): informe o local ou posto da falha.');
      if (fotosDe(it).length + (Number(fotosPendentes) || 0) < 1) erros.push('Item ' + n + ' (NC): anexe ao menos uma foto.');
      if (!txt(it.acao)) erros.push('Item ' + n + ' (NC): descreva a ação imediata.');
      if (!txt(it.responsavel)) erros.push('Item ' + n + ' (NC): indique o responsável pela ação.');
    }
    return erros;
  }

  /* a = {tipo, setor, turno, data, horario, responsavel, itens:{n:{r,local,fotos,acao,responsavel,prazo}},
          perguntas:{...}, conferencia:{...}, surpresa, liderPresente, divergencias:[n]}
     ctx = {lideresDoSetor:[uid], uid, fotosPendentes:{n:qtd}} */
  function validar(a, ctx) {
    var c = ctx || {}, erros = [], aud = a || {}, tipo = aud.tipo;
    if (!TIPOS[tipo]) return ['Tipo de auditoria inválido.'];
    if ((c.setores || SETORES).indexOf(aud.setor) < 0) erros.push('Escolha o setor.');
    if (!txt(aud.data)) erros.push('Informe a data.');
    if (tipo === 'LIDER' && TURNOS.indexOf(aud.turno) < 0) erros.push('Escolha o turno.');
    if (!txt(aud.horario)) erros.push('Informe o horário.');
    if (!txt(aud.responsavelNome)) erros.push('Informe quem está verificando.');
    var it = itensDoTipo(tipo);
    it.principais.concat(it.criticos).forEach(function(x) {
      erros = erros.concat(validarItem((aud.itens || {})[x.n], x.n, tipo, (c.fotosPendentes || {})[x.n]));
    });
    if (tipo === 'LIDER') {
      var p = aud.perguntas || {};
      if (p.mutirao !== 'SIM' && p.mutirao !== 'NAO') erros.push('Pergunta 9: responda Sim ou Não.');
      if (p.mutirao === 'SIM' && (!txt(p.mutiraoHorario) || !(num(p.mutiraoMinutos) > 0))) erros.push('Pergunta 9: informe o horário e a duração do mutirão.');
      if (p.todosParticiparam !== 'SIM' && p.todosParticiparam !== 'NAO') erros.push('Pergunta 10: responda Sim ou Não.');
      if (p.todosParticiparam === 'NAO' && !(num(p.faltaram) > 0)) erros.push('Pergunta 10: informe quantos faltaram.');
      if (['SIM', 'NAO', 'NA'].indexOf(p.pendenciasOntem) < 0) erros.push('Pergunta 11: responda Sim, Não ou NA.');
      if (p.ocorrencias == null || p.ocorrencias === '' || !(num(p.ocorrencias) >= 0)) erros.push('Pergunta 12: informe o número de ocorrências (0 se nenhuma).');
    } else {
      if (!aud.surpresa && aud.surpresa !== false) erros.push('Informe se a auditoria é surpresa ou agendada.');
      if (aud.liderPresente !== 'SIM' && aud.liderPresente !== 'NAO') erros.push('Informe se o líder estava presente.');
      var v = aud.conferencia || {};
      if (v.v1 !== 'SIM' && v.v1 !== 'NAO') erros.push('V1: responda Sim ou Não.');
      if (v.v1 === 'NAO' && !(aud.divergencias && aud.divergencias.length)) erros.push('V1: informe os itens que o líder marcou C e foram encontrados NC.');
      if (v.v2 !== 'SIM' && v.v2 !== 'NAO') erros.push('V2: responda Sim ou Não.');
      // Auditor de fora do setor: quem lidera o setor auditado não o audita.
      if (c.uid && (c.lideresDoSetor || []).indexOf(c.uid) >= 0) erros.push('O auditor tem que ser de fora do setor: você é líder de ' + aud.setor + '.');
    }
    return erros;
  }

  function statusPor(pct, p) {
    if (pct == null) return 'AGUARDANDO';
    if (pct >= p.verde) return 'VERDE';
    if (pct >= p.amarelo) return 'AMARELO';
    return 'VERMELHO';
  }

  function calcular(a, params) {
    var p = Object.assign({}, PARAMETROS, params || {}), aud = a || {}, tipo = aud.tipo;
    var it = itensDoTipo(tipo), itens = aud.itens || {};
    var r = function(n) { return txt((itens[n] || {}).r).toUpperCase(); };
    var c = 0, nc = 0, na = 0, porSenso = {};
    SENSOS.forEach(function(s) { porSenso[s] = {c: 0, nc: 0, pct: null}; });
    it.principais.forEach(function(x) {
      var v = r(x.n);
      if (v === 'C') c++; else if (v === 'NC') nc++; else if (v === 'NA') na++;
      if (x.senso && (v === 'C' || v === 'NC')) porSenso[x.senso][v === 'C' ? 'c' : 'nc']++;
    });
    SENSOS.forEach(function(s) { var t = porSenso[s].c + porSenso[s].nc; porSenso[s].pct = t ? porSenso[s].c / t : null; });
    var pct = c + nc ? c / (c + nc) : null;
    var criticosNC = [];
    (tipo === 'LIDER' ? it.principais.filter(function(x) { return x.critico; }) : it.criticos).forEach(function(x) { if (r(x.n) === 'NC') criticosNC.push(x); });
    var status = criticosNC.length ? 'VERMELHO' : statusPor(pct, p);
    var texto = criticosNC.length ? 'VERMELHO: ITEM CRÍTICO' : status;
    var alertas = [];
    criticosNC.forEach(function(x) { alertas.push('Item crítico NC: ' + x.n + ' — ' + x.texto.replace(/^CRÍTICO:\s*/, '')); });
    if (tipo === 'LIDER') {
      var q = aud.perguntas || {};
      if (q.mutirao === 'NAO') alertas.push('Colaboração: o mutirão de 10 min não foi realizado.');
      if (q.todosParticiparam === 'NAO') alertas.push('Colaboração: nem todos participaram do mutirão (' + (num(q.faltaram) || '?') + ' faltaram; cada um gera ocorrência individual).');
      if (q.pendenciasOntem === 'NAO') alertas.push('Pendências de ontem sem solução.');
    } else {
      var v = aud.conferencia || {};
      if (v.v1 === 'NAO') alertas.push('LÍDER NÃO CONFERE: recomendar ocorrência ao líder pela escada disciplinar.');
      if (v.v2 === 'NAO') alertas.push('O líder não registrou as ocorrências individuais que viu.');
    }
    var ncs = it.principais.concat(it.criticos).filter(function(x) { return r(x.n) === 'NC'; });
    return {c: c, nc: nc, na: na, pct: pct, status: status, statusTexto: texto, criticosNC: criticosNC.map(function(x) { return x.n; }),
      porSenso: tipo === 'LIDER' ? null : porSenso, alertas: alertas, liderNaoConfere: tipo !== 'LIDER' && (aud.conferencia || {}).v1 === 'NAO',
      ncItens: ncs.map(function(x) { return x.n; }), totalNC: ncs.length};
  }

  var PRAZOS = {HOJE: 'hoje', H48: '48 h', D7: '7 dias'};
  /* Até 5 ações do dia, por prioridade: críticos (hoje), depois os NC (48 h; os demais 7 dias). */
  function acoesObrigatorias(a, resultado) {
    var it = itensDoTipo(a.tipo), itens = a.itens || {}, lista = [];
    it.principais.concat(it.criticos).forEach(function(x) {
      var d = itens[x.n] || {};
      if (txt(d.r).toUpperCase() !== 'NC') return;
      var crit = ehCritico(a.tipo, x.n);
      lista.push({n: x.n, texto: x.texto.replace(/^CRÍTICO:\s*/, ''), local: txt(d.local), acao: txt(d.acao), responsavel: txt(d.responsavel), critico: crit,
        prazo: txt(d.prazo) || (crit ? PRAZOS.HOJE : PRAZOS.H48), prioridade: crit ? 0 : 1});
    });
    lista.sort(function(x, y) { return x.prioridade - y.prioridade || String(x.n).localeCompare(String(y.n), 'pt-BR', {numeric: true}); });
    // Quando há mais de 5, os NC comuns além do 3º passam para 7 dias.
    lista.forEach(function(x, i) { if (!x.critico && i >= 3 && !txt((itens[x.n] || {}).prazo)) x.prazo = PRAZOS.D7; });
    return lista.slice(0, 5);
  }

  function consequencia(status) {
    if (status === 'VERMELHO') return 'VERMELHO: o líder reporta à diretoria e apresenta plano de ação em 48 h.';
    if (status === 'AMARELO') return 'AMARELO: plano de correção na reunião semanal do comitê.';
    if (status === 'VERDE') return 'VERDE: reconhecer o setor.';
    return 'Sem itens aplicáveis: nada a concluir.';
  }

  /* Linha para a planilha de controle: data;setor;turno;verificador;tipo;C/NC dos itens;mutirão;observação. */
  function linhaControle(a, resultado) {
    var it = itensDoTipo(a.tipo), itens = a.itens || {};
    var sigla = it.principais.map(function(x) { return txt((itens[x.n] || {}).r).toUpperCase() || '-'; }).join(',');
    var q = a.perguntas || {};
    var d = txt(a.data).split('-').reverse().join('/');
    return [d, a.setor, a.turno || '', a.responsavelNome, TIPOS[a.tipo].rotulo, sigla,
      a.tipo === 'LIDER' ? (q.mutirao === 'SIM' ? 'Sim' : 'Não') : '', (resultado.statusTexto + (resultado.pct != null ? ' ' + Math.round(resultado.pct * 100) + '%' : ''))].join(';');
  }

  /* Escada disciplinar: SÓ SUGERE. anteriores = ocorrências da pessoa nos últimos 90 dias (que valem). */
  var ESCADA = [
    '1ª ocorrência: orientação verbal + correção no turno',
    '2ª ocorrência: orientação por escrito, assinada',
    '3ª ocorrência: advertência formal',
    '4ª ocorrência: segunda advertência + RH e gerência',
    '5ª ocorrência: suspensão (validar com o jurídico)',
    '6ª ou mais: análise de desligamento (RH + jurídico)'
  ];
  function escada(anteriores, seguranca) {
    var n = (Math.max(0, parseInt(anteriores, 10) || 0)) + 1 + (seguranca ? 1 : 0);
    n = Math.min(6, n);
    return {degrau: n, texto: ESCADA[n - 1], sobeSeguranca: !!seguranca, aviso: 'Sugestão para validação do RH. Nenhuma punição é aplicada pelo sistema.'};
  }
  function diasEntre(a, b) { return Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400000); }
  /* Quantas ocorrências a pessoa teve nos 90 dias corridos anteriores a `hoje` (fora de treinamento). */
  function ocorrenciasNosUltimos90(ocorrencias, colaboradorId, hoje) {
    return Object.keys(ocorrencias || {}).map(function(k) { return ocorrencias[k]; }).filter(function(o) {
      if (!o || o.treinamento || o.anulada) return false;
      if (txt(o.colaboradorId) !== txt(colaboradorId)) return false;
      var d = diasEntre(txt(o.data).slice(0, 10), hoje);
      return d >= 0 && d < 90;
    }).length;
  }

  /* Segunda a domingo da semana de `data`. */
  function semana(data) {
    var d = new Date(data + 'T12:00:00'); var dow = (d.getDay() + 6) % 7;
    var ini = new Date(d.getTime() - dow * 86400000), fim = new Date(ini.getTime() + 6 * 86400000);
    var f = function(x) { return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    return {inicio: f(ini), fim: f(fim)};
  }

  /* O que falta hoje, por setor: checklist do líder e auditorias externas da semana. */
  function cobertura(auditorias, hoje, params, setores) {
    var p = Object.assign({}, PARAMETROS, params || {}), sem = semana(hoje);
    var lista = Object.keys(auditorias || {}).map(function(k) { return Object.assign({id: k}, auditorias[k]); }).filter(function(a) { return a && !a.anulada; });
    return (setores || SETORES).map(function(setor) {
      var doSetor = lista.filter(function(a) { return a.setor === setor; });
      var lideresHoje = doSetor.filter(function(a) { return a.tipo === 'LIDER' && a.data === hoje; });
      var externasSemana = doSetor.filter(function(a) { return a.tipo !== 'LIDER' && a.data >= sem.inicio && a.data <= sem.fim; });
      var ultima = doSetor.slice().sort(function(a, b) { return String(b.data + (b.horario || '')).localeCompare(String(a.data + (a.horario || ''))); })[0] || null;
      var ultimaExterna = doSetor.filter(function(a) { return a.tipo !== 'LIDER'; }).sort(function(a, b) { return String(b.data).localeCompare(String(a.data)); })[0] || null;
      return {setor: setor, liderHoje: lideresHoje.length, turnosHoje: lideresHoje.map(function(a) { return a.turno; }), liderStatusHoje: lideresHoje.map(function(a) { return a.resultado && a.resultado.statusTexto; }),
        externasSemana: externasSemana.length, metaSemana: p.auditoriasPorSemana, faltamSemana: Math.max(0, p.auditoriasPorSemana - externasSemana.length),
        ultimaExterna: ultimaExterna ? ultimaExterna.data : null, ultimoStatus: ultima && ultima.resultado ? ultima.resultado.statusTexto : null};
    });
  }

  return {
    SETORES: SETORES, SETORES_PADRAO: SETORES_PADRAO, setoresConfigurados: setoresConfigurados, TURNOS: TURNOS, TIPOS: TIPOS, PARAMETROS: PARAMETROS, SENSOS: SENSOS, ESCADA: ESCADA, PRAZOS: PRAZOS,
    ITENS_LIDER: ITENS_LIDER, PERGUNTAS_LIDER: PERGUNTAS_LIDER, ITENS_QUALIDADE: ITENS_QUALIDADE, CRITICOS: CRITICOS, CONFERENCIA: CONFERENCIA,
    itensDoTipo: itensDoTipo, ehCritico: ehCritico, fotosDe: fotosDe, validarItem: validarItem, validar: validar, calcular: calcular,
    acoesObrigatorias: acoesObrigatorias, consequencia: consequencia, linhaControle: linhaControle, escada: escada,
    ocorrenciasNosUltimos90: ocorrenciasNosUltimos90, semana: semana, cobertura: cobertura, statusPor: statusPor
  };
});
