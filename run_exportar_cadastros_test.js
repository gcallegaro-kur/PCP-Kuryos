'use strict';
/* Exportação dos cadastros: regra pura (montar) + o botão de verdade em
   cadastros.html com Firebase simulado e a lib de planilha trocada por um
   gravador (a lib real vem de CDN). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const X = require(path.join(__dirname, 'public', 'shared', 'exportar-cadastros.js'));

const base = {
  produtos: {
    AAA01: {sku: 'AAA01', descricao: 'BODY SPLASH A', cliente: 'CLI', clienteKey: 'C1', ativo: 'Ativo', prodHoraRef: 600, cq: {ph: '5', odor: 'x'}, skusAnteriores: ['OLD-01']},
    BBB02: {sku: 'BBB02', descricao: 'HIDRATANTE B', cliente: 'CLI', clienteKey: 'ZZ', ativo: 'Ativo'},
    CCC03: {sku: 'CCC03', descricao: 'INATIVO', ativo: 'Inativo'}
  },
  materiais: {
    'MPGR-1': {mpCodigo: 'MPGR-1', mpNome: 'ÁGUA', tipo: 'MPGR', ativo: true, fornecedores: {f1: {codigoFornecedor: 'X', nomeComercial: 'Água Y'}}},
    'MPGR-2': {mpCodigo: 'MPGR-2', mpNome: 'GLICERINA', tipo: 'MPGR', ativo: false},
    'EP-1': {mpCodigo: 'EP-1', mpNome: 'FRASCO 200ML', tipo: 'EP', ativo: true}
  },
  clientes: {C1: {codigo: 'C1', nome: 'CLI', ativo: true, contatos: {a: {nome: 'Ana', email: 'a@x'}}}},
  fornecedores: {f1: {razaoSocial: 'FORN', ativo: true}},
  formulas: {
    'OLD-01__v1': {codProduto: 'OLD-01', versao: 'v1', status: 'APROVADA', itens: {
      i1: {mpCodigo: 'MPGR-1', mpNome: 'AGUA', percentualMM: 90, fase: 'A'},
      i2: {mpCodigo: 'MPGR-2', mpNome: 'GLICERINA', percentualMM: 5},
      i3: {mpCodigo: 'MPGR-9', mpNome: 'FANTASMA', percentualMM: 4},
      i4: {mpNome: 'SEM CODIGO', percentualMM: 0}
    }},
    'ZZZ__v1': {codProduto: 'ZZZ', versao: 'v1', itens: {}}
  },
  bom: {
    'aaa01__V1': {codProduto: 'aaa01', versao: 'V1', status: 'APROVADA', itens: {
      b1: {materialCodigo: 'EP-1', materialNome: 'FRASCO 200ML', posicao: 1, qtdPorPeca: 1},
      b2: {materialCodigo: 'EP-1', materialNome: 'FRASCO 200ML', posicao: 2, qtdPorPeca: 0}
    }}
  },
  especificacoes: {'AAA01__v1': {codProduto: 'AAA01', versao: 'v1', itens: {e1: {ensaio: 'PH', minimo: '4', maximo: '6', critico: true}}}}
};

const r = X.montar(base);
const por = (n) => r.abas.find((a) => a.nome === n);
const col = (a, c) => a.colunas.indexOf(c);
assert.deepEqual(r.abas.map((a) => a.nome), ['Leia-me', 'Conferência', 'Produtos', 'Materiais', 'Fórmulas', 'BOM', 'Especificações', 'Clientes', 'Fornecedores']);

// Produtos: chave primeiro, cq achatado, contagem de versões resolve SKU anterior e caixa.
const pr = por('Produtos');
assert.equal(pr.colunas[0], 'chave');
assert.equal(pr.linhas.length, 3);
const lA = pr.linhas.find((l) => l[0] === 'AAA01');
assert.equal(lA[col(pr, 'cq_ph')], '5');
assert.equal(lA[col(pr, 'versoes_formula')], 1, 'fórmula do SKU anterior OLD-01 conta para AAA01');
assert.equal(lA[col(pr, 'versoes_bom')], 1, 'BOM "aaa01__V1" conta para AAA01 apesar da caixa');

// Materiais: mapa de fornecedores vira texto.
const ma = por('Materiais');
assert.match(String(ma.linhas.find((l) => l[0] === 'MPGR-1')[col(ma, 'fornecedores')]), /f1: .*nomeComercial=Água Y/);

// Fórmulas: uma linha por item; colunas cad_ comparam com o cadastro.
const fo = por('Fórmulas');
assert.equal(fo.linhas.length, 4 + 1, '4 itens + a versão sem itens');
const iAgua = fo.linhas.find((l) => l[col(fo, 'item')] === 'i1');
assert.equal(iAgua[col(fo, 'produto')], 'BODY SPLASH A');
assert.equal(iAgua[col(fo, 'cad_nome')], 'ÁGUA');
assert.equal(iAgua[col(fo, 'cad_nome_confere')], 'NÃO');
assert.equal(fo.linhas.find((l) => l[col(fo, 'item')] === 'i3')[col(fo, 'cad_nome')], 'NÃO CADASTRADO');

// BOM
const bo = por('BOM');
assert.equal(bo.linhas.length, 2);
assert.equal(bo.linhas[0][col(bo, 'cad_nome_confere')], 'SIM');

// Especificações
assert.equal(por('Especificações').linhas[0][col(por('Especificações'), 'critico')], 'SIM');

// Conferência
const tipos = por('Conferência').linhas.map((l) => l[0]);
const tem = (t) => assert.ok(tipos.includes(t), 'achou: ' + t + ' | ' + [...new Set(tipos)].join('; '));
['Fórmula: soma diferente de 100%', 'Fórmula: material não cadastrado', 'Fórmula: material inativo',
  'Fórmula: nome diferente do cadastro', 'Fórmula: item sem código', 'Fórmula: percentual zerado', 'Fórmula de produto inexistente',
  'Fórmula sem itens', 'BOM: quantidade por peça zerada', 'BOM: componente repetido', 'Produto ativo sem fórmula',
  'Produto ativo sem BOM', 'Produto ativo sem produtividade (prodHoraRef)', 'Produto com cliente não vinculado'].forEach(tem);
assert.ok(!por('Conferência').linhas.some((l) => l[2] === 'CCC03'), 'produto inativo não gera cobrança');
assert.ok(!tipos.includes('BOM de produto inexistente'), 'aaa01 resolve para AAA01');
assert.equal(r.totais.conferencia, por('Conferência').linhas.length);
assert.equal(X.montar({}).abas.length, 9, 'base vazia não quebra');

// ── O botão de verdade ────────────────────────────────────────────────────
(async () => {
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const html = fs.readFileSync('public/cadastros.html', 'utf8');
  assert.ok(/id="btnExportarCadastros"/.test(html) && /shared\/exportar-cadastros\.js/.test(html));
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1500, height: 1000}});
    const erros = [];
    page.on('pageerror', (e) => erros.push(e.message));
    const dados = {'usuarios/u1': {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'}};
    Object.keys(base).forEach((k) => { dados[k] = base[k]; });
    await page.addInitScript((data) => {
      window.__iniciado = false;
      const exige = (q) => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
      window.firebase = {
        initializeApp() { window.__iniciado = true; },
        auth() { exige('auth'); return {onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), 0); }, signOut() { return Promise.resolve(); }}; },
        database() {
          exige('database');
          return {ref(p) {
            const snap = {val: () => (p in data ? structuredClone(data[p]) : null), exists: () => p in data, forEach() {}};
            return {path: p, once(ev, cb) { if (cb) cb(snap); return Promise.resolve(snap); },
              on(ev, cb) { setTimeout(() => cb(snap), 0); return cb; }, off() {}, child() { return this; },
              orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
              set() { return Promise.resolve(); }, update() { return Promise.resolve(); }, remove() { return Promise.resolve(); },
              transaction() { return Promise.resolve({committed: true, snapshot: snap}); }};
          }};
        },
        storage() { return {ref() { return {}; }}; }
      };
    }, dados);
    const stubXlsx = [
      'window.__wb = {abas: []};',
      'window.XLSX = {utils: {book_new: () => window.__wb, aoa_to_sheet: (aoa) => ({aoa}),',
      '  book_append_sheet: (wb, ws, nome) => wb.abas.push({nome, ws}), encode_range: (r) => "A1:" + r.e.c + ":" + r.e.r},',
      '  writeFile: (wb, nome) => { window.__arquivo = nome; }};'
    ].join('\n');
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx/.test(url.href)) return route.fulfill({body: stubXlsx, contentType: 'text/javascript'});
      if (url.hostname !== 'cad.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + url.pathname.slice(1);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    await page.goto('https://cad.test/cadastros.html');
    await page.waitForSelector('#btnExportarCadastros', {timeout: 8000});
    await page.waitForTimeout(400);
    await page.click('#btnExportarCadastros');
    await page.waitForFunction(() => window.__arquivo, null, {timeout: 8000});
    const saida = await page.evaluate(() => ({arquivo: window.__arquivo, abas: window.__wb.abas.map((a) => [a.nome, a.ws.aoa.length])}));
    assert.match(saida.arquivo, /^cadastros-kuryos-\d{4}-\d{2}-\d{2}\.xlsx$/);
    assert.deepEqual(saida.abas.map((a) => a[0]), r.abas.map((a) => a.nome));
    assert.equal(saida.abas.find((a) => a[0] === 'Fórmulas')[1], fo.linhas.length + 1, 'cabeçalho + linhas');
    assert.equal(await page.locator('#btnExportarCadastros').isDisabled(), false, 'botão volta ao normal');
    assert.deepEqual(erros, [], 'sem erro de página: ' + erros.join(' | '));
  } finally { await browser.close(); }
  console.log('run_exportar_cadastros_test: OK');
})().catch((e) => { console.error(e); process.exit(1); });
