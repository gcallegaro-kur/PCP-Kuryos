(function(root) {
  'use strict';

  var CAMPOS_ENDERECO = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];
  var CAMPOS_LOCAL = ['nome', 'cnpj', 'contatoNome', 'contatoTelefone', 'horarioAtendimento', 'referencia', 'instrucoes'];
  function texto(v) { return v == null ? '' : String(v).trim(); }
  function enderecoVazio() { return { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', pais: 'BR' }; }
  function localVazio(tipo, nome) {
    return { entidadeTipo: tipo || 'OUTRO', nome: nome || '', cnpj: '', endereco: enderecoVazio(), contatoNome: '', contatoTelefone: '', horarioAtendimento: '', referencia: '', instrucoes: '', fonte: 'DIGITADO' };
  }
  function normalizarLocal(local) {
    var src = local || {}, end = src.endereco || src;
    var out = localVazio(src.entidadeTipo || src.tipo || 'OUTRO', texto(src.nome));
    CAMPOS_ENDERECO.forEach(function(c) { out.endereco[c] = texto(end[c]); });
    out.endereco.pais = texto(end.pais) || 'BR';
    CAMPOS_LOCAL.slice(1).forEach(function(c) { out[c] = texto(src[c]); });
    ['entidadeKey', 'localKey', 'fonte', 'confirmadoEm', 'confirmadoPor'].forEach(function(c) { if (src[c] != null && src[c] !== '') out[c] = src[c]; });
    return out;
  }
  function origemFornecedor(fornecedor, fornecedorKey, fallbackNome) {
    var f = fornecedor || {}, local = localVazio('FORNECEDOR', texto(f.nomeFantasia || f.razaoSocial || fallbackNome));
    local.entidadeKey = fornecedorKey || null; local.cnpj = texto(f.cnpj);
    CAMPOS_ENDERECO.forEach(function(c) { local.endereco[c] = texto(f[c]); });
    local.contatoNome = texto(f.contatoNome); local.contatoTelefone = texto(f.contatoTelefone);
    local.horarioAtendimento = texto(f.horarioAtendimento); local.referencia = texto(f.referenciaEndereco || f.referencia);
    local.fonte = 'CADASTRO_SUGERIDO';
    return local;
  }
  function normalizarRota(rota) {
    var r = rota || {}, natureza = r.natureza || 'COMPRA_KURYOS';
    return { versao: Number(r.versao) || 1, natureza: natureza, responsavelTransporte: r.responsavelTransporte || '', incoterm: natureza === 'COMPRA_KURYOS' ? (r.incoterm || null) : null, origem: normalizarLocal(r.origem), destino: normalizarLocal(r.destino), statusConfirmacao: r.statusConfirmacao || (r.confirmadaEm ? 'CONFIRMADA' : 'PENDENTE'), confirmadaEm: r.confirmadaEm || null, confirmadaPor: r.confirmadaPor || null };
  }
  function rotaInicial(pc, fornecedor) {
    var p = pc || {};
    if (p.rota) return normalizarRota(p.rota);
    var natureza = p.naturezaMovimentacao || 'COMPRA_KURYOS';
    var origem = origemFornecedor(fornecedor, p.fornecedorKey, p.origemNome || p.fornecedorNome);
    if (natureza !== 'COMPRA_KURYOS') origem.entidadeTipo = natureza === 'REMESSA_CLIENTE' ? 'CLIENTE' : 'TERCEIRO';
    if (p.coleta) {
      origem.contatoNome = texto(p.coleta.contatoNome) || origem.contatoNome;
      origem.contatoTelefone = texto(p.coleta.contatoTelefone) || origem.contatoTelefone;
      if (texto(p.coleta.endereco)) origem.instrucoes = 'Endereço informado na cotação: ' + texto(p.coleta.endereco);
      origem.fonte = 'COTACAO_SUGERIDA';
    }
    var local = p.localEntrega || '', destino = localVazio('KURYOS', local === 'GALPAO' ? 'Galpão Kuryos' : local === 'FABRICA' ? 'Fábrica Kuryos' : 'Kuryos');
    destino.localKey = local || null;
    var tipoFrete = ((p.frete || {}).tipo || '').toUpperCase();
    var responsavel = (p.transporte || {}).responsavel || (tipoFrete === 'FOB' ? 'KURYOS' : (tipoFrete === 'CIF' ? 'REMETENTE' : ''));
    return normalizarRota({ versao: 1, natureza: natureza, responsavelTransporte: responsavel, incoterm: natureza === 'COMPRA_KURYOS' ? (tipoFrete || null) : null, origem: origem, destino: destino, statusConfirmacao: 'PENDENTE' });
  }
  function faltasLocal(local, contatoObrigatorio) {
    var l = normalizarLocal(local), e = l.endereco, faltas = [];
    if (!texto(l.nome)) faltas.push('nome do local');
    if (texto(e.cep).replace(/\D/g, '').length !== 8) faltas.push('CEP');
    if (!texto(e.logradouro)) faltas.push('logradouro');
    if (!texto(e.numero)) faltas.push('número (ou S/N)');
    if (!texto(e.bairro)) faltas.push('bairro');
    if (!texto(e.cidade)) faltas.push('cidade');
    if (texto(e.uf).length !== 2) faltas.push('UF');
    if (contatoObrigatorio && !texto(l.contatoNome)) faltas.push('contato no local');
    if (contatoObrigatorio && !texto(l.contatoTelefone)) faltas.push('telefone do local');
    return faltas;
  }
  function validarRota(rota) {
    var r = normalizarRota(rota), faltas = [], origemObrigatoria = r.natureza !== 'COMPRA_KURYOS' || r.responsavelTransporte === 'KURYOS';
    if (origemObrigatoria) faltasLocal(r.origem, r.responsavelTransporte === 'KURYOS').forEach(function(x) { faltas.push('origem: ' + x); });
    faltasLocal(r.destino, false).forEach(function(x) { faltas.push('destino: ' + x); });
    if (r.natureza === 'COMPRA_KURYOS' && ['FOB', 'CIF'].indexOf(r.incoterm) === -1) faltas.push('modalidade FOB/CIF');
    if (['KURYOS', 'REMETENTE'].indexOf(r.responsavelTransporte) === -1) faltas.push('responsável pelo transporte');
    return { pronto: faltas.length === 0, faltando: faltas };
  }
  function formatarEndereco(local) {
    var l = normalizarLocal(local), e = l.endereco, linha = [];
    if (e.logradouro) linha.push(e.logradouro + (e.numero ? ', ' + e.numero : ''));
    if (e.complemento) linha.push(e.complemento); if (e.bairro) linha.push(e.bairro);
    if (e.cidade || e.uf) linha.push([e.cidade, e.uf].filter(Boolean).join('/')); if (e.cep) linha.push('CEP ' + e.cep);
    return linha.join(' · ');
  }
  function resumoLocal(local) {
    var l = normalizarLocal(local), partes = [], end = formatarEndereco(l);
    if (l.nome) partes.push(l.nome); if (end) partes.push(end);
    if (l.contatoNome || l.contatoTelefone) partes.push('Contato: ' + [l.contatoNome, l.contatoTelefone].filter(Boolean).join(' · '));
    if (l.horarioAtendimento) partes.push('Horário: ' + l.horarioAtendimento); if (l.referencia) partes.push('Referência: ' + l.referencia); if (l.instrucoes) partes.push('Instruções: ' + l.instrucoes);
    return partes.join('\n');
  }
  function assinaturaRota(rota) { var r = normalizarRota(rota); delete r.confirmadaEm; delete r.confirmadaPor; delete r.statusConfirmacao; return JSON.stringify(r); }
  function rotasIguais(a, b) { return assinaturaRota(a) === assinaturaRota(b); }
  function urlMapa(local) { var q = formatarEndereco(local); return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : ''; }
  function ids(prefix) { var o = {}; CAMPOS_LOCAL.concat(CAMPOS_ENDERECO).forEach(function(c) { o[c] = prefix + c.charAt(0).toUpperCase() + c.slice(1); }); return o; }
  function preencherEditor(prefix, local) {
    if (!root.document) return; var l = normalizarLocal(local), map = ids(prefix);
    CAMPOS_LOCAL.forEach(function(c) { var el = document.getElementById(map[c]); if (el) el.value = l[c] || ''; });
    CAMPOS_ENDERECO.forEach(function(c) { var el = document.getElementById(map[c]); if (el) el.value = l.endereco[c] || ''; });
  }
  function lerEditor(prefix, base) {
    var l = normalizarLocal(base), map = ids(prefix);
    CAMPOS_LOCAL.forEach(function(c) { var el = document.getElementById(map[c]); if (el) l[c] = texto(el.value); });
    CAMPOS_ENDERECO.forEach(function(c) { var el = document.getElementById(map[c]); if (el) l.endereco[c] = texto(el.value); });
    l.endereco.uf = l.endereco.uf.toUpperCase().slice(0, 2); return l;
  }
  var api = { enderecoVazio: enderecoVazio, localVazio: localVazio, normalizarLocal: normalizarLocal, origemFornecedor: origemFornecedor, rotaInicial: rotaInicial, normalizarRota: normalizarRota, faltasLocal: faltasLocal, validarRota: validarRota, formatarEndereco: formatarEndereco, resumoLocal: resumoLocal, rotasIguais: rotasIguais, urlMapa: urlMapa, preencherEditor: preencherEditor, lerEditor: lerEditor };
  root.RotasPC = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
