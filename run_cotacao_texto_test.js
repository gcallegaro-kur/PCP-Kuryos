/* Cotação já iniciada: (1) texto por fornecedor, na língua DELE, e
   (2) inclusão de fornecedor depois da abertura, sem beco sem saída.
   Extrai as funções de public/compras.html e roda contra dados montados
   à mão -- o que importa aqui é o ESCOPO por item e a nomenclatura. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const arquivo = path.join(__dirname, 'public', 'compras.html');
const html = fs.readFileSync(arquivo, 'utf8');

function extrai(deFuncao, ateFuncao) {
  const a = html.indexOf('function ' + deFuncao + '(');
  const b = html.indexOf('function ' + ateFuncao + '(', a);
  assert.ok(a > 0, deFuncao + ' não encontrada em compras.html');
  assert.ok(b > a, 'fim de ' + deFuncao + ' não encontrado');
  return html.slice(a, b);
}

// ── Base de teste ────────────────────────────────────────────────────
// MP-0001: homologado no f1 COM código/nome comercial dele.
// EM-0500: homologado no f2, SEM código comercial -> cai na especificação.
// EM-0900: ninguém homologado.
// EM-0501: similar de EM-0500, homologado no f3 com código comercial.
const allMateriais = {
  'MP-0001': {mpCodigo:'MP-0001', mpNome:'Álcool etílico 96°', especificacoesTecnicas:'INPM 96, incolor, grau farmacêutico',
    fornecedores:{f1:{nomeComercial:'Álcool Extrafino 96 INPM', codigoFornecedor:'ALC96-1000', statusHomologacao:'APROVADO'}}},
  'EM-0500': {mpCodigo:'EM-0500', mpNome:'Frasco PET 200ml', especificacoesTecnicas:'PET cristal, boca 28/410, 200ml',
    fornecedores:{f2:{nomeComercial:'', codigoFornecedor:'', statusHomologacao:'APROVADO'}}},
  'EM-0501': {mpCodigo:'EM-0501', mpNome:'Frasco PET 200ml boca larga', especificacoesTecnicas:'PET cristal, boca 28mm, 200ml',
    fornecedores:{f3:{nomeComercial:'Boston Round 200', codigoFornecedor:'BR200', statusHomologacao:'APROVADO'}}},
  'EM-0900': {mpCodigo:'EM-0900', mpNome:'Tampa flip-top 28mm', especificacoesTecnicas:'PP branca, rosca 28/410', fornecedores:{}}
};

const sandbox = {
  fmtNum(n) { return Number(n || 0).toLocaleString('pt-BR'); },
  allMateriais,
  sanitizeKey(c) { return String(c || ''); },
  findMaterialByCodigo(c) { return allMateriais[c] || null; }
};
vm.createContext(sandbox);
// escopoDoConvidado vem do utils.js DE VERDADE: é a regra que decide o que
// cada convidado cota, inclusive o fallback das cotações antigas. Copiar a
// regra no teste esconderia justamente a divergência que se quer pegar.
const utils = fs.readFileSync(path.join(__dirname, 'public', 'shared', 'utils.js'), 'utf8');
const ini = utils.indexOf('function escopoDoConvidado(');
const fim = utils.indexOf('function convidadoCotaItem(', ini);
assert.ok(ini > 0 && fim > ini, 'escopoDoConvidado não encontrada em utils.js');
new vm.Script(utils.slice(ini, fim), {filename: 'utils.js#escopoDoConvidado'}).runInContext(sandbox);

new vm.Script(extrai('referenciaFornecedorDoMaterial', 'copiarTextoCotacaoFornecedor'),
  {filename: 'compras.html#texto-cotacao'}).runInContext(sandbox);
const gerar = sandbox.gerarTextoCotacaoFornecedor;

const processo = {
  numeroFormatado: 'COT-000123',
  itens: {
    i1: {materialCodigo:'MP-0001', materialNome:'Álcool etílico 96°', qtd:200, unidade:'L'},
    i2: {materialCodigo:'EM-0500', materialNome:'Frasco PET 200ml', qtd:5000, unidade:'un'},
    i3: {materialCodigo:'EM-0900', materialNome:'Tampa flip-top 28mm', qtd:5000, unidade:'un'}
  },
  fornecedoresConvidados: {
    c1: {fornecedorKey:'f1', itens:{i1:true}},
    c2: {fornecedorKey:'f2', itens:{i2:true, i3:true}},
    c3: {fornecedorKey:'f3', itens:{i2:true}, materialSimilarPorItem:{i2:'EM-0501'}},
    c4: {fornecedorKey:'f4', itens:{}},
    c5: {cnpjAvulso:'00000000000191', nomeAvulso:'Novo', itens:{i3:true}},
    // Convidado LEGADO: cotação anterior ao escopo por item, sem o campo
    // `itens`. Por escopoDoConvidado ele cota o processo inteiro.
    c6: {fornecedorKey:'f1'}
  }
};

// ── 1. Escopo por item ───────────────────────────────────────────────
const t1 = gerar(processo, 'c1');
assert.ok(!t1.includes('Frasco') && !t1.includes('Tampa'), 'material fora do escopo vazou no texto');
assert.equal((t1.match(/•/g) || []).length, 1);
assert.ok(t1.includes('COT-000123'), 'número da cotação identifica a resposta');

// ── 2. Nomenclatura: nada de código interno da Kuryos no texto ────────
[gerar(processo, 'c1'), gerar(processo, 'c2'), gerar(processo, 'c3'), gerar(processo, 'c5')].forEach(function (t) {
  ['MP-0001', 'EM-0500', 'EM-0900', 'EM-0501'].forEach(function (interno) {
    assert.ok(!t.includes(interno), 'código interno ' + interno + ' vazou para o fornecedor:\n' + t);
  });
});

// ── 3. Homologado com catálogo próprio: fala o nome e o código DELE ───
assert.ok(t1.includes('Álcool Extrafino 96 INPM'), 'nome comercial do fornecedor deveria liderar a linha');
assert.ok(t1.includes('cód. ALC96-1000'), 'código do fornecedor deveria aparecer');
assert.ok(t1.includes('200 L'), 'quantidade e unidade');

// ── 4. Homologado sem código comercial: descrição + especificação ─────
const t2 = gerar(processo, 'c2');
assert.equal((t2.match(/•/g) || []).length, 2);
assert.ok(t2.indexOf('Frasco PET 200ml') < t2.indexOf('Tampa flip-top'), 'ordem do processo preservada');
assert.ok(t2.includes('Espec.: PET cristal, boca 28/410, 200ml'), 'especificação técnica é o que viaja entre fornecedores');
assert.ok(t2.includes('Espec.: PP branca, rosca 28/410'), 'item sem homologação também leva especificação');
assert.ok(t2.includes('5.000 un'), 'quantidade formatada em pt-BR');

// ── 5. Convite por similar: resolve pelo catálogo do SIMILAR ──────────
const t3 = gerar(processo, 'c3');
assert.ok(t3.includes('Boston Round 200'), 'nome comercial do similar, que é o que ele tem em catálogo');
assert.ok(t3.includes('cód. BR200'));
assert.ok(t3.includes('Para uso equivalente'), 'equivalência precisa ser explícita');

// ── 5b. Cotação ANTIGA: convidado sem `itens` cota o processo inteiro ──
// É o caso das cotações já abertas hoje. Sem o fallback, o botão aparece e
// o texto sai vazio -- pior que não ter botão.
const t6 = gerar(processo, 'c6');
assert.equal((t6.match(/•/g) || []).length, 3, 'convidado legado tem que receber os 3 materiais do processo');
assert.ok(t6.includes('Álcool Extrafino 96 INPM'), 'legado também fala no catálogo do fornecedor');
assert.ok(t6.includes('Espec.: PP branca, rosca 28/410'));
// e o fallback é a MESMA regra da grade, não uma cópia divergente
assert.deepEqual(sandbox.escopoDoConvidado({}, ['i1','i2','i3']), ['i1','i2','i3']);

// ── 5c. Ampliar convite de um legado não pode ENCOLHER o escopo dele ──
assert.ok(/if \(existente && !Object\.keys\(convidado\.itens \|\| \{\}\)\.length\)/.test(html),
  'gravarFornecedorNaCotacao precisa materializar o escopo do convidado legado antes de somar itens');

// ── 6. Bordas ────────────────────────────────────────────────────────
// itens:{} não existe no RTDB (objeto vazio não é gravado), então é o mesmo
// caso do legado: escopo = processo inteiro. Nunca texto vazio por engano.
assert.equal((gerar(processo, 'c4').match(/•/g) || []).length, 3);
assert.equal(gerar(processo, 'nao-existe'), '', 'convidado inexistente não quebra a tela');
assert.equal(gerar({}, 'c1'), '');
assert.equal(gerar({itens: {}, fornecedoresConvidados: {x: {itens: {i1: true}}}}, 'x'), '',
  'processo sem itens devolve vazio -- a tela alerta, não copia');
assert.ok(gerar(processo, 'c5').includes('Tampa flip-top'), 'avulso: escopo é por item, não por origem');

// ── 7. O texto continua pedindo o que a cotação precisa ──────────────
['preço unitário', 'prazo de entrega', 'condição de pagamento'].forEach(function (frase) {
  assert.ok(t2.includes(frase), 'faltou pedir: ' + frase);
});

// ── 8. Sintaxe dos scripts inline ────────────────────────────────────
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
assert.ok(scripts.length, 'nenhum script inline encontrado');
scripts.forEach((code, i) => new vm.Script(code, {filename: 'compras.html#script-' + i}));

// ── 9. Botão de copiar texto existe e está ligado ────────────────────
assert.ok(html.includes('cot-copiar-texto'), 'botão de copiar texto ausente do card da cotação');
assert.ok(html.includes("document.querySelectorAll('.cot-copiar-texto')"), 'botão sem listener');

// ── 10. ＋ Fornecedor: o beco sem saída foi fechado ───────────────────
// (a) existe a segunda lista, para cadastrado que não é sugestão do material
assert.ok(html.includes('caf-add-fora'), 'falta o caminho "Adicionar mesmo assim" para fornecedor da base');
assert.ok(html.includes('Outros fornecedores da base'), 'falta a seção dos não sugeridos');
assert.ok(html.includes("alvo.querySelectorAll('.caf-add-fora')"), 'botão fora-da-homologação sem listener');
// (b) o CNPJ de fornecedor já cadastrado não pode mais terminar em recusa
assert.ok(!html.includes('Este CNPJ já está no cadastro. Use o fornecedor cadastrado acima.'),
  'a recusa de CNPJ cadastrado ainda está no código -- é o beco sem saída');
assert.ok(/if \(cadastrado\) \{ adicionarCadastradoForaDaHomologacao\(cadastrado\[0\], itens\); return; \}/.test(html),
  'CNPJ já cadastrado deve incluir o fornecedor da base, não recusar');
// (c) a inclusão não forja similar -- quem carimba foraHomologacao é o gravar
const incluir = extrai('adicionarCadastradoForaDaHomologacao', 'lista');
assert.ok(!incluir.includes('materialSimilarPorItem'), 'inclusão fora da homologação não pode forjar material similar');
assert.ok(incluir.includes('fornecedorKey: fKey'), 'precisa entrar como fornecedor cadastrado, não avulso');

console.log('run_cotacao_texto_test: OK');
