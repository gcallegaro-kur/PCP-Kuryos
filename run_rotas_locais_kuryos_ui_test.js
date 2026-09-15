'use strict';
/* Rota do Pedido de Compra: CEP automático e endereços da Kuryos.
   Pedido do usuário (2026-09-15): no PC direto era preciso digitar o endereço
   inteiro da Kuryos, que já é conhecido; o PC tradicional tinha o mesmo
   problema. Tela real (compras.html + utils.js + auth_check.js + rotas-pc.js)
   com Firebase simulado fiel ao SDK e ViaCEP simulado -- o teste não sai na
   rede. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function dados() {
  return {
    'usuarios/u1': {nome: 'Gustavo', email: 'g@kuryos.com', role: 'admin'},
    config: {},
    fornecedores: {f1: {nomeFantasia: 'LOMAR PACK', cnpj: '33.321.531/0001-35', cep: '07041-030', logradouro: 'Avenida Carlos Ferreira Endres',
      numero: '952', bairro: 'Vila Endres', cidade: 'Guarulhos', uf: 'SP', contatoNome: 'Ana', contatoTelefone: '11 99999-0000'}},
    pedidos_compra: {pc1: {status: 'ABERTO', numeroFormatado: 'PC-0009', fornecedorKey: 'f1', fornecedorNome: 'LOMAR PACK',
      dataCriacao: '2026-09-14T10:00:00Z', frete: {tipo: 'CIF'}, localEntrega: null,
      itens: {i1: {materialCodigo: 'EP-00036', materialNome: 'Frasco', qtd: 100, unidade: 'un', precoUnit: 1}}}}
  };
}
const VIACEP = {
  '01310100': {cep: '01310-100', logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP'},
  '08295010': {cep: '08295-010', logradouro: 'Rua Benedito Coelho Netto', bairro: 'Itaquera', localidade: 'São Paulo', uf: 'SP'}
};

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1500, height: 1200}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.addInitScript(({data, viacep}) => {
      window.__writes = [];
      window.__iniciado = false;
      const exige = q => { if (!window.__iniciado) throw new Error("No Firebase App '[DEFAULT]' has been created (" + q + ')'); };
      window.fetch = url => {
        const m = /viacep\.com\.br\/ws\/(\d{8})\/json/.exec(String(url));
        const body = m && viacep[m[1]] ? viacep[m[1]] : {erro: true};
        return new Promise(r => setTimeout(() => r({ok: true, status: 200, json: () => Promise.resolve(body)}), 30));
      };
      window.firebase = {
        initializeApp(cfg) { if (!cfg || !cfg.databaseURL) throw new Error('sem databaseURL'); window.__iniciado = true; },
        auth() {
          exige('auth');
          return {onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'g@kuryos.com', displayName: 'Gustavo'}), 0); },
            signOut() { return Promise.resolve(); }, currentUser: {email: 'g@kuryos.com'}};
        },
        functions() { return {httpsCallable: () => () => Promise.resolve({data: {}})}; },
        app() { return {functions: () => ({httpsCallable: () => () => Promise.resolve({data: {}})})}; },
        database() {
          exige('database');
          const ref = path => {
            const snap = {val: () => (path in data ? structuredClone(data[path]) : null), exists: () => path in data, key: String(path).split('/').pop()};
            return {path, key: 'k' + Math.random().toString(36).slice(2, 8),
              once(ev, cb) { if (cb) cb(snap); return Promise.resolve(snap); },
              on(ev, cb) { setTimeout(() => cb(snap), 0); return cb; }, off() {},
              child(p) { return ref(path + '/' + p); }, push() { return ref(path + '/k' + Math.random().toString(36).slice(2, 8)); },
              orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; },
              set(v) { window.__writes.push({op: 'set', path, v}); return Promise.resolve(); },
              update(v) { window.__writes.push({op: 'update', path, v}); return Promise.resolve(); },
              remove() { return Promise.resolve(); },
              transaction(fn) { const v = fn(null); return Promise.resolve({committed: true, snapshot: {val: () => v}}); }};
          };
          return {ref, ServerValue: {TIMESTAMP: 0}};
        }
      };
    }, {data: dados(), viacep: VIACEP});
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'cmp.test') return route.fulfill({body: '', contentType: 'text/javascript'});
      const file = 'public/' + url.pathname.slice(1);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({body: fs.readFileSync(file),
        contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
    });
    await page.goto('https://cmp.test/compras.html');
    await page.waitForSelector('.kt-sidebar', {timeout: 8000});
    await page.waitForFunction(() => window.currentUser && window.currentUser.role === 'admin', null, {timeout: 8000});
    const val = id => page.inputValue('#' + id);

    // ── 1. PC direto: atalhos nos dois lados, e o de editar para admin ───
    await page.click('.tab[data-tab="pedidos"]');
    await page.click('#btnPcDireto');
    await page.waitForSelector('#pcdDestinoNome');
    assert.equal(await page.locator('.rota-atalho[data-local="pcdOrigem"]').count(), 2);
    assert.equal(await page.locator('.rota-atalho[data-local="pcdDestino"]').count(), 2);
    assert.equal(await page.locator('#pcdRotaEditor .rota-locais-editar').count(), 2, 'admin vê o botão de editar os endereços');

    // ── 2. Destino = Fábrica Kuryos com um clique ───────────────────────
    await page.check('#pcdRotaConfirmada');
    await page.click('.rota-atalho[data-local="pcdDestino"][data-chave="FABRICA"]');
    assert.equal(await val('pcdDestinoNome'), 'Fábrica Kuryos');
    assert.equal(await val('pcdDestinoLogradouro'), 'Rua Lagoa Tai Grande');
    assert.equal(await val('pcdDestinoNumero'), '1130');
    assert.equal(await val('pcdDestinoBairro'), 'Vila Carmosina');
    assert.equal(await val('pcdDestinoCnpj'), '00.767.554/0001-19');
    assert.equal(await page.getAttribute('.rota-atalho[data-local="pcdDestino"][data-chave="FABRICA"]', 'aria-pressed'), 'true');
    assert.equal(await page.isChecked('#pcdRotaConfirmada'), false, 'trocar o local derruba a confirmação');
    let rota = await page.evaluate(() => lerRotaEditor('pcd', pcdRotaBase, 'COMPRA_KURYOS', 'REMETENTE', 'CIF'));
    assert.equal(rota.destino.entidadeTipo, 'KURYOS');
    assert.equal(rota.destino.localKey, 'FABRICA');
    assert.equal(rota.destino.fonte, 'KURYOS_CADASTRO');
    // ajustou à mão: continua Fábrica, mas registrado como ajustado
    await page.fill('#pcdDestinoComplemento', 'Doca 2');
    rota = await page.evaluate(() => lerRotaEditor('pcd', pcdRotaBase, 'COMPRA_KURYOS', 'REMETENTE', 'CIF'));
    assert.equal(rota.destino.localKey, 'FABRICA');
    assert.equal(rota.destino.fonte, 'KURYOS_AJUSTADO');
    assert.equal(rota.destino.endereco.complemento, 'Doca 2');

    // ── 3. CEP preenche logradouro/bairro/cidade/UF e nunca o número ─────
    await page.fill('#pcdOrigemNumero', '55');
    await page.fill('#pcdOrigemComplemento', 'Sala 3');
    await page.fill('#pcdOrigemCep', '01310100');
    await page.waitForFunction(() => document.getElementById('pcdOrigemLogradouro').value === 'Avenida Paulista');
    assert.equal(await val('pcdOrigemBairro'), 'Bela Vista');
    assert.equal(await val('pcdOrigemCidade'), 'São Paulo');
    assert.equal(await val('pcdOrigemUf'), 'SP');
    assert.equal(await val('pcdOrigemCep'), '01310-100', 'CEP formatado');
    assert.equal(await val('pcdOrigemNumero'), '55', 'número digitado não pode ser sobrescrito');
    assert.equal(await val('pcdOrigemComplemento'), 'Sala 3');
    // CEP inexistente: avisa e não mexe em nada
    await page.fill('#pcdOrigemCep', '99999999');
    await page.waitForFunction(() => /não encontrado/i.test(document.getElementById('pcdOrigemCepHint').textContent));
    assert.equal(await val('pcdOrigemLogradouro'), 'Avenida Paulista');

    // ── 4. Origem = Galpão (remessa da Kuryos) não carrega fornecedor ────
    await page.click('.rota-atalho[data-local="pcdOrigem"][data-chave="GALPAO"]');
    assert.equal(await val('pcdOrigemLogradouro'), 'Rua Benedito Coelho Netto');
    assert.equal(await val('pcdOrigemNumero'), '211');
    rota = await page.evaluate(() => lerRotaEditor('pcd', Object.assign(pcdRotaBase, {origem: Object.assign(pcdRotaBase.origem, {entidadeKey: 'f1'})}), 'COMPRA_KURYOS', 'REMETENTE', 'CIF'));
    assert.equal(rota.origem.entidadeTipo, 'KURYOS');
    assert.equal(rota.origem.localKey, 'GALPAO');
    assert.equal(rota.origem.entidadeKey, undefined, 'local da Kuryos não pode herdar o vínculo com o fornecedor');

    // ── 5. Cadastro dos endereços: valida, salva e passa a valer ────────
    await page.locator('#pcdRotaEditor .rota-locais-editar').first().click();
    await page.waitForSelector('#lkFABRICANome');
    assert.equal(await val('lkFABRICALogradouro'), 'Rua Lagoa Tai Grande', 'formulário abre com o endereço atual');
    assert.equal(await val('lkGALPAONumero'), '211');
    assert.equal(await page.locator('.modal', {has: page.locator('#lkSalvar')}).locator('.rota-atalho').count(), 0, 'o cadastro não tem atalhos de si mesmo');
    // campo obrigatório faltando: não grava
    await page.fill('#lkFABRICALogradouro', '');
    await page.click('#lkSalvar');
    assert.match(await page.textContent('#alertBox'), /Fábrica: logradouro/);
    assert.equal((await page.evaluate(() => window.__writes)).filter(w => w.path === 'config/locaisKuryos').length, 0);
    // mudança de endereço do galpão, com CEP automático
    await page.fill('#lkFABRICALogradouro', 'Rua Lagoa Tai Grande');
    await page.fill('#lkGALPAOCep', '01310100');
    await page.waitForFunction(() => document.getElementById('lkGALPAOLogradouro').value === 'Avenida Paulista');
    await page.fill('#lkGALPAONumero', '1000');
    await page.click('#lkSalvar');
    const escrita = (await page.evaluate(() => window.__writes)).find(w => w.path === 'config/locaisKuryos');
    assert.ok(escrita, 'salvou em config/locaisKuryos');
    assert.equal(escrita.op, 'update');
    assert.equal(escrita.v.GALPAO.endereco.logradouro, 'Avenida Paulista');
    assert.equal(escrita.v.GALPAO.endereco.numero, '1000');
    assert.equal(escrita.v.GALPAO.atualizadoPor, 'Gustavo');
    assert.equal(escrita.v.FABRICA.endereco.numero, '1130');
    assert.equal(await page.locator('#lkSalvar').count(), 0, 'fecha depois de salvar');
    // o listener de /config entregaria o novo valor; o atalho passa a usá-lo
    await page.evaluate(v => { allConfig.locaisKuryos = v; }, escrita.v);
    await page.click('.rota-atalho[data-local="pcdDestino"][data-chave="GALPAO"]');
    assert.equal(await val('pcdDestinoLogradouro'), 'Avenida Paulista', 'atalho usa o cadastro salvo, não o padrão');

    // ── 6. Permissão: mesma regra de escrita do /config ─────────────────
    assert.equal(await page.evaluate(() => { const u = window.currentUser; window.currentUser = {role: 'compras'}; const r = podeEditarLocaisKuryos(); window.currentUser = u; return r; }), false);
    assert.equal(await page.evaluate(() => { const u = window.currentUser; window.currentUser = {role: 'compras', modulos: {config: true}}; const r = podeEditarLocaisKuryos(); window.currentUser = u; return r; }), true);
    assert.equal(await page.evaluate(() => { const u = window.currentUser; window.currentUser = {role: 'pcp'}; const r = podeEditarLocaisKuryos(); window.currentUser = u; return r; }), true);
    await page.click('#modalPcdClose');

    // ── 7. PC tradicional: "Entregar em" preenche o destino inteiro ──────
    await page.evaluate(() => abrirModalEditarPC('pc1'));
    await page.waitForSelector('#pcEditDestinoNome');
    assert.equal(await page.locator('.rota-atalho[data-local="pcEditDestino"]').count(), 2, 'atalhos também no PC tradicional');
    await page.selectOption('#pcEditLocal', 'FABRICA');
    assert.equal(await val('pcEditDestinoLogradouro'), 'Rua Lagoa Tai Grande');
    assert.equal(await val('pcEditDestinoNumero'), '1130');
    assert.equal(await page.isChecked('#pcEditRotaConfirmada'), false);
    await page.selectOption('#pcEditLocal', 'GALPAO');
    assert.equal(await val('pcEditDestinoLogradouro'), 'Avenida Paulista', 'galpão com o endereço do cadastro salvo');
    // e o CEP automático funciona no editor do PC tradicional
    await page.fill('#pcEditOrigemCep', '08295010');
    await page.waitForFunction(() => document.getElementById('pcEditOrigemLogradouro').value === 'Rua Benedito Coelho Netto');

    // ── 8. PC gerado com localEntrega já nasce com o destino preenchido ──
    const nascido = await page.evaluate(() => RotasPC.rotaInicial({localEntrega: 'FABRICA', frete: {tipo: 'CIF'}}, null, locaisKuryosCadastro()));
    assert.equal(nascido.destino.endereco.logradouro, 'Rua Lagoa Tai Grande');
    assert.equal(nascido.statusConfirmacao, 'PENDENTE', 'preencher não é confirmar');

    assert.deepEqual(errors, [], 'erros de página: ' + errors.join(' | '));
    console.log('OK Rota do PC: atalhos Fábrica/Galpão, CEP automático, cadastro editável, permissão, PC direto e PC tradicional.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });

