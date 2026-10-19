/* Manutenção › Cadastro de Ativos (19/10/2026).

   Pedido do usuário: "talvez isto valha um módulo à parte, de manutenção, onde
   fazemos a gestão de ativos (máquinas e equipamentos) e podemos expandir pra
   de fato a área de manutenção. Os demais módulos do sistema consomem estes
   cadastros."

   Primeiro degrau: só o cadastro e a situação de cada equipamento. É o que a
   spec do CQ (ERP_Kuryos_Modulo_CQ_v1.1) precisa para a assepsia de reator e
   de linha (CK-3/CK-4) e para a calibração de instrumentos (CK-8): saber QUAL
   equipamento, de que linha, se pede assepsia e se pede calibração. Ordem de
   serviço, preventiva e MTBF/MTTR vêm depois, em cima deste mesmo cadastro.

   Gravação:
     ativos/{id}                 o equipamento (id = chave push)
     ativos_historico/{id}/{k}   cada mudança de situação (só acrescenta)
   Funções PURAS, testadas em run_ativos_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ativos = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  /* Tipos de equipamento. `assepsia` e `calibracao` são o PADRÃO do tipo --
     cada ativo pode mudar. Os da manipulação e da linha de envase saem da
     spec (CK-3: tachos, espátulas, béqueres, homogeneizadores; CK-4:
     envasadora, fechadora, rotuladora, esteira, bicos, mangueiras); os de
     calibração, do CK-8 e da revisão da Qualidade em 17/09 (balanças,
     estufas, pHmetro, termo-higrômetro, régua de 30/60 cm). */
  var TIPOS = {
    REATOR:          {rotulo: 'Reator',                          sigla: 'RT', area: 'MANIPULACAO', assepsia: true,  calibracao: false, unidade: 'kg'},
    TACHO:           {rotulo: 'Tacho / tanque',                  sigla: 'TC', area: 'MANIPULACAO', assepsia: true,  calibracao: false, unidade: 'kg'},
    HOMOGENEIZADOR:  {rotulo: 'Homogeneizador / misturador',     sigla: 'HM', area: 'MANIPULACAO', assepsia: true,  calibracao: false, unidade: ''},
    UTENSILIO:       {rotulo: 'Utensílio (espátula, béquer...)', sigla: 'UT', area: 'MANIPULACAO', assepsia: true,  calibracao: false, unidade: ''},
    ENVASADORA:      {rotulo: 'Envasadora',                      sigla: 'EV', area: 'ENVASE',      assepsia: true,  calibracao: false, unidade: 'un/h'},
    FECHADORA:       {rotulo: 'Fechadora / tampadora',           sigla: 'FC', area: 'ENVASE',      assepsia: true,  calibracao: false, unidade: 'un/h'},
    ESTEIRA:         {rotulo: 'Esteira',                         sigla: 'ES', area: 'ENVASE',      assepsia: true,  calibracao: false, unidade: ''},
    ROTULADORA:      {rotulo: 'Rotuladora',                      sigla: 'RO', area: 'ROTULAGEM',   assepsia: false, calibracao: false, unidade: 'un/h'},
    CODIFICADORA:    {rotulo: 'Codificadora / datador',          sigla: 'CD', area: 'ENVASE',      assepsia: false, calibracao: false, unidade: ''},
    BALANCA:         {rotulo: 'Balança',                         sigla: 'BL', area: 'LABORATORIO', assepsia: false, calibracao: true,  unidade: 'kg'},
    PHMETRO:         {rotulo: 'pHmetro',                         sigla: 'PH', area: 'LABORATORIO', assepsia: false, calibracao: true,  unidade: ''},
    TERMOHIGROMETRO: {rotulo: 'Termo-higrômetro',                sigla: 'TH', area: 'LABORATORIO', assepsia: false, calibracao: true,  unidade: ''},
    ESTUFA:          {rotulo: 'Estufa',                          sigla: 'EF', area: 'LABORATORIO', assepsia: false, calibracao: true,  unidade: ''},
    VISCOSIMETRO:    {rotulo: 'Viscosímetro',                    sigla: 'VS', area: 'LABORATORIO', assepsia: false, calibracao: true,  unidade: ''},
    DENSIMETRO:      {rotulo: 'Densímetro / picnômetro',         sigla: 'DS', area: 'LABORATORIO', assepsia: false, calibracao: true,  unidade: ''},
    REGUA:           {rotulo: 'Régua / paquímetro',              sigla: 'RG', area: 'LABORATORIO', assepsia: false, calibracao: true,  unidade: ''},
    TORQUIMETRO:     {rotulo: 'Torquímetro',                     sigla: 'TQ', area: 'LABORATORIO', assepsia: false, calibracao: true,  unidade: ''},
    UTILIDADE:       {rotulo: 'Utilidade (compressor, deionizador...)', sigla: 'UD', area: 'UTILIDADES', assepsia: false, calibracao: false, unidade: ''},
    OUTRO:           {rotulo: 'Outro',                           sigla: 'OT', area: 'OUTRA',       assepsia: false, calibracao: false, unidade: ''}
  };
  var AREAS = {
    MANIPULACAO: 'Manipulação', ENVASE: 'Envase', ROTULAGEM: 'Rotulagem', LABORATORIO: 'Laboratório',
    ARMAZEM: 'Armazém', UTILIDADES: 'Utilidades', OUTRA: 'Outra'
  };
  var SITUACOES = {
    OPERACIONAL: {rotulo: 'Operacional', cor: 'ok'},
    EM_MANUTENCAO: {rotulo: 'Em manutenção', cor: 'warn'},
    INATIVO: {rotulo: 'Inativo', cor: 'mute'}
  };
  var PERIODICIDADE_PADRAO_MESES = 12; // spec D-08: calibração anual

  function txt(v) { return String(v == null ? '' : v).trim(); }
  function chave(s) { return txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' '); }
  function num(v) { if (v === '' || v == null) return null; var n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : NaN; }
  function bool(v, padrao) { return v === true || v === false ? v : !!padrao; }

  function padroesDoTipo(tipo) { return TIPOS[tipo] || TIPOS.OUTRO; }

  // Ativo pronto para gravar: textos limpos, código em maiúsculas, números.
  function normalizar(f) {
    f = f || {};
    var tipo = TIPOS[f.tipo] ? f.tipo : 'OUTRO';
    var p = padroesDoTipo(tipo);
    var exigeCalibracao = bool(f.exigeCalibracao, p.calibracao);
    var per = num(f.calibracaoPeriodicidadeMeses);
    return {
      codigo: txt(f.codigo).toUpperCase().replace(/\s+/g, '-'),
      nome: txt(f.nome),
      tipo: tipo,
      area: AREAS[f.area] ? f.area : p.area,
      linha: txt(f.linha) || null,
      capacidade: num(f.capacidade),
      capacidadeUnidade: txt(f.capacidadeUnidade) || p.unidade || null,
      fabricante: txt(f.fabricante) || null,
      modelo: txt(f.modelo) || null,
      numeroSerie: txt(f.numeroSerie) || null,
      patrimonio: txt(f.patrimonio) || null,
      dataAquisicao: txt(f.dataAquisicao) || null,
      situacao: SITUACOES[f.situacao] ? f.situacao : 'OPERACIONAL',
      exigeAssepsia: bool(f.exigeAssepsia, p.assepsia),
      exigeCalibracao: exigeCalibracao,
      calibracaoPeriodicidadeMeses: exigeCalibracao ? (per == null ? PERIODICIDADE_PADRAO_MESES : per) : null,
      obs: txt(f.obs) || null
    };
  }

  // Lista de erros (vazia = pode gravar). `existentes` = {id: ativo}.
  function validar(a, existentes, idAtual) {
    var erros = [];
    if (!a.codigo) erros.push('Informe o código (TAG) do equipamento.');
    if (!a.nome) erros.push('Informe o nome do equipamento.');
    if (!TIPOS[a.tipo]) erros.push('Escolha o tipo do equipamento.');
    if (!AREAS[a.area]) erros.push('Escolha a área.');
    if (a.capacidade != null && (isNaN(a.capacidade) || a.capacidade < 0)) erros.push('A capacidade precisa ser um número maior ou igual a zero.');
    if (a.exigeCalibracao && !(a.calibracaoPeriodicidadeMeses > 0)) erros.push('Informe de quantos em quantos meses o equipamento é calibrado.');
    if (a.codigo) {
      var dup = Object.keys(existentes || {}).find(function(k) {
        return k !== idAtual && existentes[k] && chave(existentes[k].codigo) === chave(a.codigo);
      });
      if (dup) erros.push('Já existe um equipamento com o código ' + a.codigo + ' (' + (existentes[dup].nome || '') + ').');
    }
    return erros;
  }

  // Próximo código livre da sigla do tipo: RT-01, RT-02... (só sugere).
  function sugerirCodigo(tipo, existentes) {
    var sigla = padroesDoTipo(tipo).sigla, maior = 0;
    Object.keys(existentes || {}).forEach(function(k) {
      var m = /^([A-Z]+)-(\d+)$/.exec(chave((existentes[k] || {}).codigo).replace(/ /g, ''));
      if (m && m[1] === sigla) maior = Math.max(maior, Number(m[2]));
    });
    return sigla + '-' + String(maior + 1).padStart(2, '0');
  }

  function lista(ativos) {
    return Object.keys(ativos || {}).map(function(k) { return Object.assign({id: k}, ativos[k]); })
      .filter(function(a) { return a && a.codigo; });
  }

  function resumo(ativos) {
    var r = {total: 0, porSituacao: {OPERACIONAL: 0, EM_MANUTENCAO: 0, INATIVO: 0}, porArea: {}, assepsia: 0, calibracao: 0};
    lista(ativos).forEach(function(a) {
      r.total++;
      var s = SITUACOES[a.situacao] ? a.situacao : 'OPERACIONAL';
      r.porSituacao[s]++;
      r.porArea[a.area] = (r.porArea[a.area] || 0) + 1;
      if (s !== 'INATIVO' && a.exigeAssepsia) r.assepsia++;
      if (s !== 'INATIVO' && a.exigeCalibracao) r.calibracao++;
    });
    return r;
  }

  /* f = {busca, tipo, area, situacao, linha, marcador} -- marcador:
     'assepsia' | 'calibracao' | 'EM_MANUTENCAO' | 'INATIVO'... */
  function filtrar(ativos, f) {
    f = f || {};
    var ps = chave(f.busca).split(' ').filter(Boolean);
    return lista(ativos).filter(function(a) {
      if (f.tipo && a.tipo !== f.tipo) return false;
      if (f.area && a.area !== f.area) return false;
      if (f.situacao && (a.situacao || 'OPERACIONAL') !== f.situacao) return false;
      if (f.linha && chave(a.linha) !== chave(f.linha)) return false;
      if (f.marcador === 'assepsia' && !(a.exigeAssepsia && a.situacao !== 'INATIVO')) return false;
      if (f.marcador === 'calibracao' && !(a.exigeCalibracao && a.situacao !== 'INATIVO')) return false;
      if (!ps.length) return true;
      var alvo = chave([a.codigo, a.nome, (TIPOS[a.tipo] || {}).rotulo, AREAS[a.area], a.linha, a.fabricante, a.modelo, a.numeroSerie, a.patrimonio].join(' '));
      return ps.every(function(p) { return alvo.indexOf(p) >= 0; });
    }).sort(function(x, y) { return String(x.codigo).localeCompare(String(y.codigo), 'pt-BR', {numeric: true}); });
  }

  /* Mudança de situação: devolve {erro} ou {updates} (caminhos planos, para
     um update só) já com a linha do histórico. Parar ou inativar exige
     motivo -- é o que a manutenção vai querer saber depois. */
  function mudarSituacao(id, ativo, nova, o) {
    o = o || {};
    if (!SITUACOES[nova]) return {erro: 'Situação inválida.'};
    var atual = (ativo && ativo.situacao) || 'OPERACIONAL';
    if (atual === nova) return {erro: 'O equipamento já está ' + SITUACOES[nova].rotulo.toLowerCase() + '.'};
    var motivo = txt(o.motivo);
    if (nova !== 'OPERACIONAL' && !motivo) return {erro: 'Informe o motivo.'};
    var u = {};
    u['ativos/' + id + '/situacao'] = nova;
    u['ativos/' + id + '/situacaoDesde'] = o.agora;
    u['ativos/' + id + '/situacaoMotivo'] = motivo || null;
    u['ativos/' + id + '/atualizadoEm'] = o.agora;
    u['ativos/' + id + '/atualizadoPor'] = o.por || null;
    u['ativos_historico/' + id + '/' + o.chaveHistorico] = {de: atual, para: nova, motivo: motivo || null, por: o.por || null, em: o.agora};
    return {updates: u};
  }

  // Para os outros módulos: equipamentos ativos de uma linha / de um tipo.
  function daLinha(ativos, linha, opcoes) {
    opcoes = opcoes || {};
    return lista(ativos).filter(function(a) {
      return chave(a.linha) === chave(linha) && a.situacao !== 'INATIVO' &&
        (!opcoes.assepsia || a.exigeAssepsia);
    });
  }
  function porTipo(ativos, tipos) {
    var t = [].concat(tipos || []);
    return lista(ativos).filter(function(a) { return t.indexOf(a.tipo) >= 0 && a.situacao !== 'INATIVO'; });
  }

  return {
    TIPOS: TIPOS, AREAS: AREAS, SITUACOES: SITUACOES, PERIODICIDADE_PADRAO_MESES: PERIODICIDADE_PADRAO_MESES,
    padroesDoTipo: padroesDoTipo, normalizar: normalizar, validar: validar, sugerirCodigo: sugerirCodigo,
    lista: lista, resumo: resumo, filtrar: filtrar, mudarSituacao: mudarSituacao, daLinha: daLinha, porTipo: porTipo
  };
});
