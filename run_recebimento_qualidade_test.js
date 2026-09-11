const fs = require('fs');
const vm = require('vm');

const logistica = fs.readFileSync('public/logistica.html', 'utf8');
const qualidade = fs.readFileSync('public/qualidade.html', 'utf8');

function validarSintaxeHtml(source, arquivo) {
  const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1]).filter(s => s.trim());
  scripts.forEach((script, i) => {
    try { new Function(script); }
    catch (e) { throw new Error('Sintaxe inválida em ' + arquivo + ', script ' + i + ': ' + e.message); }
  });
}
validarSintaxeHtml(logistica, 'public/logistica.html');
validarSintaxeHtml(qualidade, 'public/qualidade.html');
[
  'Tipo de material *', 'Identificação do material *', 'SKU do fornecedor *', 'SKU interno',
  'Lote do fornecedor *', 'Lote interno *', 'Nº da nota fiscal *', 'Recebendo agora *',
  'Quantidade de amostragem *', 'Data do recebimento *', 'Certificado do fornecedor *',
  'Condições do veículo *', 'Condições da embalagem *'
].forEach(campo => { if (!logistica.includes(campo)) throw new Error('Campo do formulário ausente: ' + campo); });

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Função não encontrada: ' + name);
  const open = source.indexOf('{', start);
  let depth = 0, quote = null, escaped = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('Função incompleta: ' + name);
}

const lotesCriados = [];
const ctx = {
  Object, String, Number, Array, Promise, Date, Math, isFinite,
  allMateriais: {}, allEnderecosEstoque: { A1:{ codigo:'GAL-1.1.1', ativo:true } },
  currentUserNome: () => 'Operador Logística', db: {},
  sanitizeKey: s => String(s).replace(/[.#$[\]\/]/g, '-'),
  putawayEstoqueLote: (_db, tipo, codigo, dados) => {
    lotesCriados.push({ tipo, codigo, dados });
    return Promise.resolve({ key:'lote-1' });
  }
};
vm.createContext(ctx);
['tipoMaterialRecebimento', 'codigoFornecedorRecebimento', 'validarEntradaRecebimento', 'registrarPutawayRecebimento']
  .forEach(name => vm.runInContext(extractFunction(logistica, name), ctx));

if (ctx.tipoMaterialRecebimento('MPGR-001', null) !== 'MATERIA_PRIMA') throw new Error('MP não foi classificada automaticamente');
if (ctx.tipoMaterialRecebimento('EP-001', null) !== 'EMBALAGEM') throw new Error('Embalagem não foi classificada automaticamente');
if (ctx.codigoFornecedorRecebimento({ fornecedores:{ forn1:{ codigoFornecedor:'ABC-9' } } }, 'forn1') !== 'ABC-9') throw new Error('SKU do fornecedor não veio da homologação');
if (logistica.includes('origemRef: recebendoKey')) throw new Error('Fechar o modal ainda consegue apagar o vínculo do lote com o PC');
if (!logistica.includes("showAlert('Recebimento registrado e enviado para a fila da Qualidade!'")) throw new Error('A tela confirma sucesso antes de integrar com a Qualidade');

const itemValido = {
  itemKey:'i1', tipoMaterial:'EMBALAGEM', identificacaoMaterial:'Frasco 200 ml', skuInterno:'EP-001',
  skuFornecedor:'F200', loteOrigem:'LT-10', loteInterno:'INT-10', qtdRecebida:1000,
  qtdAmostragem:20, certificadoFornecedor:'SIM', condicoesEmbalagem:5,
  dataValidade:null, enderecoKey:'A1'
};
const entradaValida = { data:'2026-09-11', notaFiscal:'12345', condicoesVeiculo:5, itens:[itemValido] };
if (ctx.validarEntradaRecebimento(entradaValida)) throw new Error('Entrada completa foi rejeitada');

const obrigatorios = [
  ['notaFiscal', Object.assign({}, entradaValida, { notaFiscal:'' })],
  ['veículo', Object.assign({}, entradaValida, { condicoesVeiculo:0 })],
  ['tipo', Object.assign({}, entradaValida, { itens:[Object.assign({}, itemValido, { tipoMaterial:'' })] })],
  ['identificação', Object.assign({}, entradaValida, { itens:[Object.assign({}, itemValido, { identificacaoMaterial:'' })] })],
  ['SKU fornecedor', Object.assign({}, entradaValida, { itens:[Object.assign({}, itemValido, { skuFornecedor:'' })] })],
  ['lote fornecedor', Object.assign({}, entradaValida, { itens:[Object.assign({}, itemValido, { loteOrigem:'' })] })],
  ['lote interno', Object.assign({}, entradaValida, { itens:[Object.assign({}, itemValido, { loteInterno:'' })] })],
  ['certificado', Object.assign({}, entradaValida, { itens:[Object.assign({}, itemValido, { certificadoFornecedor:'' })] })],
  ['embalagem', Object.assign({}, entradaValida, { itens:[Object.assign({}, itemValido, { condicoesEmbalagem:0 })] })],
  ['endereço', Object.assign({}, entradaValida, { itens:[Object.assign({}, itemValido, { enderecoKey:'' })] })]
];
obrigatorios.forEach(([campo, dados]) => {
  if (!ctx.validarEntradaRecebimento(dados)) throw new Error('Campo obrigatório aceitou vazio: ' + campo);
});
if (!ctx.validarEntradaRecebimento(Object.assign({}, entradaValida, { itens:[Object.assign({}, itemValido, { qtdRecebida:-1 })] }))) throw new Error('Quantidade negativa foi aceita');

const ficha = {
  tipoMaterial:'EMBALAGEM', identificacaoMaterial:'Frasco 200 ml', skuInterno:'EP-001', skuFornecedor:'F200',
  loteOrigem:'LT-10', loteInterno:'INT-10', qtdAmostragem:20, certificadoFornecedor:true,
  condicoesVeiculo:5, condicoesEmbalagem:4, dataValidade:null, enderecoKey:'A1', notaFiscal:'12345',
  dataRecebimento:'2026-09-11', fornecedorKey:'forn1', fornecedorNome:'Fornecedor Teste'
};

(async () => {
  await ctx.registrarPutawayRecebimento({ i1:{ materialCodigo:'EP-001', materialNome:'Frasco', unidade:'un', qtdRecebidaAgora:1000 } }, { i1:ficha }, 'rec-1', 'pc-1');
  if (lotesCriados.length !== 1) throw new Error('Recebimento não criou exatamente um lote em quarentena');
  const lote = lotesCriados[0].dados;
  if (lote.status !== 'QUARENTENA' || lote.origemRef !== 'pc-1' || lote.recebimento.notaFiscal !== '12345') throw new Error('Lote perdeu quarentena, vínculo com PC ou ficha de entrada');
  if (lote.recebimento.qtdAmostragem !== 20 || lote.recebimento.condicoesVeiculo !== 5 || lote.recebimento.condicoesEmbalagem !== 4) throw new Error('Ficha da Logística não chegou ao lote da Qualidade');

  ['Entrada da Logística', 'lote.recebimento', 'Amostra separada:', 'Condições e certificado vieram da conferência da Logística', "disabled = !!entrada"]
    .forEach(texto => { if (!qualidade.includes(texto)) throw new Error('Qualidade não consome a ficha logística: ' + texto); });
  console.log('OK Recebimento/CQ: formulário completo, validações, quarentena, vínculo PC/fornecedor e ficha da Logística na Qualidade.');
})().catch(err => { console.error(err); process.exit(1); });
