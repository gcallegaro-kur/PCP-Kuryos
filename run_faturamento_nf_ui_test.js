'use strict';
/* Dados obrigatórios da NF na tela real de Faturamento (23/10/2026).

   O que se prova aqui é a LIGAÇÃO: que as colunas de fabricação e validade
   aparecem, que o botão "Enviar solicitação" TRAVA quando falta cadastro
   (decisão do usuário: travar e mandar corrigir no cadastro), que a mensagem
   diz o SKU, o campo e o palete, que o painel avisa antes de alguém bater no
   bloqueio, e que a carga completa continua passando.

   Tela real com utils.js e auth_check.js reais; Firebase simulado em memória. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

/* Espelha a carga faturada em 23/10 (Miss Rose, MRARBS12) e junta um SKU sem
   prazo de validade nem kg/caixa -- o caso real do DPGLBS03. */
function dados() {
  const lote = (extra) => Object.assign({
    itemTipo: 'produto', origemTipo: 'conferencia_pa', status: 'LIBERADO_EXPEDICAO',
    qualidade: {decisao: 'LIBERADO_EXPEDICAO'}, enderecoKey: 'E1', conferencia: {finalizacaoId: 'f1'}
  }, extra);
  return {
    usuarios: {u1: {nome: 'Marcos Souza', email: 'marcos@kuryos.com.br', role: 'logistica'}},
    config: {},
    agendamentos_expedicao: {
      CARGA_OK: {
        revisao: 1, status: 'AGENDADO', cliente: 'MISS ROSE', tipo: 'CIF', dataAgendada: '2026-10-24',
        transportadora: 'Translog', pedidos: {a: 'PED-0002'},
        paletes: [{itemKey: 'MRARBS12', loteKey: 'L1', quantidade: 1792, sku: 'MRARBS12', identificadorPalete: 'PAL-OK', pedidoNumero: 'PED-0002'}]
      },
      CARGA_TRAVA: {
        revisao: 1, status: 'AGENDADO', cliente: 'GLAM', tipo: 'CIF', dataAgendada: '2026-10-25',
        transportadora: 'Translog', pedidos: {a: 'PED-0003'},
        paletes: [
          {itemKey: 'DPGLBS03', loteKey: 'L2', quantidade: 2058, sku: 'DPGLBS03', identificadorPalete: 'PAL-A', pedidoNumero: 'PED-0003'},
          {itemKey: 'DPGLBS03', loteKey: 'L3', quantidade: 2633, sku: 'DPGLBS03', identificadorPalete: 'PAL-B', pedidoNumero: 'PED-0003'}
        ]
      }
    },
    estoque_lotes: {
      MRARBS12: {L1: lote({itemCodigo: 'MRARBS12', itemNome: 'BODY SPLASH FLOR DAURA 200ML', opLote: '26282/03', opKey: 'OP1',
        identificadorPalete: 'PAL-OK', saldoLote: 1792, qtdOriginal: 1792, caixasFechadas: 37, unidadesCaixaParcial: 16,
        unidadesPorCaixa: 48, skuPedidoKey: 'PED-0002__MRARBS12'})},
      DPGLBS03: {
        L2: lote({itemCodigo: 'DPGLBS03', itemNome: 'DEO COLONIA GLAM', opLote: '26258/02', opKey: 'OP2',
          identificadorPalete: 'PAL-A', saldoLote: 2058, qtdOriginal: 2058, caixasFechadas: 34, unidadesCaixaParcial: 18,
          unidadesPorCaixa: 60, skuPedidoKey: 'PED-0003__DPGLBS03'}),
        L3: lote({itemCodigo: 'DPGLBS03', itemNome: 'DEO COLONIA GLAM', opLote: '26258/03', opKey: 'OP2',
          identificadorPalete: 'PAL-B', saldoLote: 2633, qtdOriginal: 2633, caixasFechadas: 43, unidadesCaixaParcial: 53,
          unidadesPorCaixa: 60, skuPedidoKey: 'PED-0003__DPGLBS03'})
      }
    },
    ops: {
      OP1: {status: 'Concluído', sku: 'MRARBS12', lote: '26282/03', skuPedidoKey: 'PED-0002__MRARBS12', dataFimReal: '2026-10-14T19:59:00.000Z'},
      OP2: {status: 'Concluído', sku: 'DPGLBS03', lote: '26258/02', skuPedidoKey: 'PED-0003__DPGLBS03', dataFimReal: '2026-09-22T10:00:00.000Z'}
    },
    pedidos: {
      'PED-0002__MRARBS12': {id: 'PED-0002', parentPedidoId: 'PED-0002', sku: 'MRARBS12', cliente: 'MISS ROSE', valorUnitario: 2.7},
      'PED-0003__DPGLBS03': {id: 'PED-0003', parentPedidoId: 'PED-0003', sku: 'DPGLBS03', cliente: 'GLAM', valorUnitario: 3.1}
    },
    pedidos_comerciais: {
      'PED-0002': {numeroPedidoCliente: '28', itens: {a: {sku: 'MRARBS12', valorUnitario: 2.7}}},
      'PED-0003': {numeroPedidoCliente: '31', itens: {a: {sku: 'DPGLBS03', valorUnitario: 3.1}}}
    },
    conferencias_pa: {OP1: {finalizadoEm: '2026-10-15', finalizacaoId: 'f1'}, OP2: {finalizadoEm: '2026-09-23', finalizacaoId: 'f1'}},
    enderecos_estoque: {E1: {ativo: true}},
    produtos: {
      p1: {sku: 'MRARBS12', descricao: 'BODY SPLASH FLOR DAURA 200ML', prazoValidadeMeses: 36, kgCaixa: 11.7, unCx: 48},
      // O caso real: sem prazo de validade E sem kg por caixa.
      p2: {sku: 'DPGLBS03', descricao: 'DEO COLONIA GLAM', unCx: 60}
    }
  };
}

async function abrir(browser) {
  const page = await browser.newPage({viewport: {width: 1700, height: 1100}});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(({data}) => {
    const db = data; window.__db = db; window.__chamadas = [];
    const partes = (p) => String(p || '').split('/').filter(Boolean);
    const ler = (p) => partes(p).reduce((o, k) => (o == null ? undefined : o[k]), db);
    const gravar = (p, v) => { const ks = partes(p); let o = db; ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }); if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = structuredClone(v); };
    const ouvintes = [];
    const snapDe = (path) => { const v = ler(path); const c = v === undefined ? null : structuredClone(v); return {val: () => c, exists: () => c !== null}; };
    const avisar = (cs) => ouvintes.forEach((o) => { if (cs.some((c) => c === o.path || c.startsWith(o.path + '/') || o.path.startsWith(c + '/'))) setTimeout(() => o.cb(snapDe(o.path)), 0); });
    window.firebase = {
      initializeApp() {},
      auth() { return {currentUser: {uid: 'u1', email: 'marcos@kuryos.com.br'}, onAuthStateChanged(cb) { setTimeout(() => cb({uid: 'u1', email: 'marcos@kuryos.com.br'}), 0); }, signOut() { return Promise.resolve(); }}; },
      database() {
        const ref = (path) => ({path,
          once(ev, cb) { const s = snapDe(path); if (cb) cb(s); return Promise.resolve(s); },
          on(ev, cb) { ouvintes.push({path, cb}); setTimeout(() => cb(snapDe(path)), 0); return cb; }, off() {},
          child(c) { return ref(path + '/' + c); },
          set(v) { gravar(path, v); avisar([path]); return Promise.resolve(); },
          update(obj) { const cs = Object.keys(obj).map((k) => (path ? path + '/' : '') + k); Object.entries(obj).forEach(([k, v]) => gravar((path ? path + '/' : '') + k, v)); avisar(cs); return Promise.resolve(); }});
        return {ref: (p) => ref(p || '')};
      },
      // A callable é só registrada: o teste checa o que a TELA manda (ou não).
      functions() { return {httpsCallable: (nome) => (d) => { window.__chamadas.push({nome, dados: structuredClone(d)}); return Promise.resolve({data: {}}); }}; }
    };
  }, {data: dados()});
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'fat.test') return route.fulfill({body: '', contentType: 'text/javascript'});
    const file = 'public/' + url.pathname.slice(1);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    return route.fulfill({body: fs.readFileSync(file), contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript'});
  });
  await page.goto('https://fat.test/faturamento.html');
  await page.waitForFunction(() => window.currentUser && window.currentUser.role === 'logistica', null, {timeout: 10000});
  await page.waitForFunction(() => /MISS ROSE/.test(document.getElementById('listaFat').innerText), null, {timeout: 10000});
  return {page, errors};
}

const card = (page, cliente) => page.locator('.carga-card', {hasText: cliente});

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    const {page, errors} = await abrir(browser);

    // ── Colunas novas, com os valores derivados ────────────────────────
    const cab = await page.locator('.carga-card .carga-itens thead').first().innerText();
    assert.match(cab, /FABRICAÇÃO/i, 'coluna de fabricação existe');
    assert.match(cab, /VALIDADE/i);
    assert.match(cab, /VOLUMES/i);
    assert.match(cab, /PESO/i);

    const ok = card(page, 'MISS ROSE');
    const txtOk = await ok.innerText();
    // Fabricação = fim real da OP (14/10) e validade = +36 meses.
    assert.match(txtOk, /14\/10\/2026/, 'fabricação derivada da OP aparece: ' + txtOk.slice(0, 300));
    assert.match(txtOk, /14\/10\/2029/, 'validade calculada aparece');
    assert.match(txtOk, /37/, 'caixas fechadas');
    assert.match(txtOk, /1 cx parcial \(16 un\)/, 'a caixa parcial é UMA caixa, com as unidades ao lado');
    assert.match(txtOk, /38/, 'volumes = 37 + 1');
    assert.match(txtOk, /444,6 kg/, 'peso');

    // ── O painel avisa ANTES de alguém bater no bloqueio ───────────────
    const painel = await page.locator('#painelCadastro').innerText();
    assert.match(painel, /v[ãa]o travar o faturamento/i);
    assert.match(painel, /DPGLBS03/, 'nomeia o SKU que falta cadastrar');
    assert.match(painel, /prazo de validade e kg por caixa|kg por caixa e prazo de validade/, 'diz o que falta');
    assert.match(painel, /4\.691|4691/, 'mostra as unidades paradas (2058 + 2633)');
    assert.ok(!/MRARBS12/.test(painel), 'SKU completo não entra no painel');

    // ── Carga completa: o botão funciona e a solicitação sai ───────────
    await ok.locator('[data-abrir-form="SOLICITAR"]').click();
    await page.waitForSelector('[data-form] [data-enviar="SOLICITAR"]');
    assert.equal(await page.locator('[data-form] [data-enviar="SOLICITAR"]').isDisabled(), false, 'carga completa não trava');
    assert.ok(!/Falta dado obrigat/i.test(await page.locator('[data-form]').innerText()), 'e não acusa falta');
    await page.click('[data-form] [data-enviar="SOLICITAR"]');
    await page.waitForFunction(() => window.__chamadas.length > 0, null, {timeout: 5000});
    const ch = await page.evaluate(() => window.__chamadas[0]);
    assert.equal(ch.nome, 'faturamentoCargaPA');
    assert.equal(ch.dados.acao, 'SOLICITAR');
    assert.equal(ch.dados.agendaKey, 'CARGA_OK');

    // ── Carga incompleta: TRAVA, e diz SKU + campo + palete ───────────
    const trava = card(page, 'GLAM');
    await trava.locator('[data-abrir-form="SOLICITAR"]').click();
    await page.waitForSelector('[data-form] [data-enviar="SOLICITAR"]');
    const form = page.locator('[data-form]');
    const txtForm = await form.innerText();
    assert.match(txtForm, /Falta dado obrigatório para a nota fiscal/i);
    assert.match(txtForm, /DPGLBS03/, 'nomeia o SKU');
    assert.match(txtForm, /Validade/, 'nomeia o campo');
    assert.match(txtForm, /Peso/);
    assert.match(txtForm, /Cadastros › Produtos/, 'diz ONDE corrigir — era a decisão do usuário');
    assert.match(txtForm, /PAL-A/, 'nomeia os paletes afetados');
    assert.match(txtForm, /PAL-B/);
    assert.equal(await page.locator('[data-form] [data-enviar="SOLICITAR"]').isDisabled(), true, 'o botão trava');
    // E nada é enviado.
    const antes = await page.evaluate(() => window.__chamadas.length);
    await page.locator('[data-form] [data-enviar="SOLICITAR"]').click({force: true}).catch(() => {});
    assert.equal(await page.evaluate(() => window.__chamadas.length), antes, 'botão travado não chama a callable');

    // ── Corrigir o cadastro LIBERA sozinho, sem recarregar a tela ─────
    await page.evaluate(() => window.firebase.database().ref('produtos/p2').update({prazoValidadeMeses: 24, kgCaixa: 9.5}));
    await page.waitForFunction(() => {
      const b = document.querySelector('[data-form] [data-enviar="SOLICITAR"]');
      return b && !b.disabled;
    }, null, {timeout: 5000});
    assert.ok(!/Falta dado obrigat/i.test(await page.locator('[data-form]').innerText()), 'a falta desaparece');
    // A validade passa a sair: 22/09/2026 + 24 meses.
    await page.waitForFunction(() => /22\/09\/2028/.test(document.getElementById('listaFat').innerText), null, {timeout: 5000});
    // E o painel esvazia.
    await page.waitForFunction(() => !/v[ãa]o travar o faturamento/i.test(document.getElementById('painelCadastro').innerText), null, {timeout: 5000});

    assert.deepEqual(errors, [], 'nenhum erro de página');
    console.log('OK Faturamento: fabricação/validade/volumes nas colunas, bloqueio por cadastro com SKU+campo+palete, painel de aviso, e liberação ao corrigir.');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
