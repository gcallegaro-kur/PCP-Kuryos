'use strict';
/* Fechar a cotação com UM fornecedor sem perder o resto da solicitação.
 *
 * Por que existe: em 20/10/2026 o usuário tinha a COT-0042 com 47 materiais e
 * 26 fornecedores convidados. Preencheu um fornecedor e quis comprar dele sem
 * esperar os outros 25 -- e não conseguiu. `gerarPedidosDeCotacaoPorItem`
 * varre TODOS os itens e exige vencedor com preço/qtd em cada um; um item sem
 * resposta abortava tudo.
 *
 * A trava tinha razão: o consumo da origem era um flip único
 * `APROVADA → CONSOLIDADA` por solicitação. Gerar parcial com esse modelo
 * deixaria o resto da SC marcado como comprado -- itens órfãos, impossíveis
 * de comprar depois.
 *
 * E escondia uma armadilha pior: `solicitadoPorMaterial` conta TODOS os itens
 * de SC `PENDENTE`/`APROVADA`. Se a SC ficasse APROVADA depois de gerar parte,
 * os itens já comprados contariam DUAS vezes -- pela solicitação e pelo PC --
 * e a falta desapareceria de "O que comprar". É exatamente a classe de erro
 * que já corrigimos no dashboard (somar coisas que não se somam).
 *
 * O desenho: consumo por item (`itensConsumidos`, chaveado pelo código do
 * material, único dentro de cada SC -- verificado nas 31 SCs da base), status
 * `PARCIAL` enquanto sobrar item, e `solicitadoPorMaterial` pulando item
 * consumido. Este teste trava as três coisas e o caminho de volta
 * (cancelar o PC devolve à cotação SÓ os itens daquele PC).
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const NP = require('./public/shared/necessidade-pedidos.js');
const CPC = require('./public/shared/cancelamento-pc.js');
const srcCompras = fs.readFileSync('public/compras.html', 'utf8');

let n = 0;
const eq = (a, b, m) => { n++; assert.equal(a, b, m); };
const dq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
const ok = (c, m) => { n++; assert.ok(c, m); };

const soma = (lista) => (lista || []).reduce((s, x) => s + x.qtd, 0);

// ── 1. O que ainda falta comprar não pode contar o que já virou PC ─────────
{
  const sc = {
    numeroFormatado: 'SC-0036', status: 'PARCIAL',
    itens: {
      a: {materialCodigo: 'EP-00195', qtd: 96000, unidade: 'un'},
      b: {materialCodigo: 'EP-00009', qtd: 4400, unidade: 'un'},
      c: {materialCodigo: 'MPGR-00127', qtd: 606.66, unidade: 'kg'}
    },
    // EP-00195 já virou o PC-0101: não conta mais aqui, conta pelo PC.
    itensConsumidos: {'EP-00195': {procKey: 'p1', pcKey: 'pc1', em: '2026-10-20T10:00:00Z'}}
  };
  const out = NP.solicitadoPorMaterial({s1: sc});
  ok(!out['EP-00195'], 'item consumido sai de "em andamento" pela solicitação — senão conta duas vezes, aqui e no PC');
  eq(soma(out['EP-00009']), 4400, 'item ainda em cotação continua contando');
  eq(soma(out['MPGR-00127']), 606.66, 'inclusive com casa decimal');
  eq(out['EP-00009'][0].status, 'PARCIAL', 'e carrega o status da SC, para a tela poder explicar de onde vem');

  // A SC inteira consumida não conta nada, como já era antes.
  const cheia = Object.assign({}, sc, {status: 'CONSOLIDADA'});
  dq(NP.solicitadoPorMaterial({s1: cheia}), {}, 'CONSOLIDADA não entra: tudo dela já é PC');

  // Sem o nó de consumo (SC de antes desta mudança) nada é pulado.
  const antiga = {numeroFormatado: 'SC-0001', status: 'APROVADA', itens: sc.itens};
  eq(Object.keys(NP.solicitadoPorMaterial({s1: antiga})).length, 3,
    'SC antiga, sem itensConsumidos, conta os 3 itens — a mudança não reescreve o passado');

  // Status que não são de SC em aberto seguem fora.
  ['REJEITADA', 'RASCUNHO'].forEach((st) => {
    dq(NP.solicitadoPorMaterial({s1: Object.assign({}, antiga, {status: st})}), {}, st + ' não conta');
  });
}

// ── 2. O status da SC acompanha os itens, não o contrário ─────────────────
{
  const itens = {a: {materialCodigo: 'M1'}, b: {materialCodigo: 'M2'}, c: {materialCodigo: 'M3'}};
  eq(NP.statusSolicitacaoPorConsumo({itens: itens}), 'APROVADA', 'nenhum item consumido: segue aprovada');
  eq(NP.statusSolicitacaoPorConsumo({itens: itens, itensConsumidos: {M1: {pcKey: 'x'}}}), 'PARCIAL',
    'um de três consumido: PARCIAL — continua em cotação pelo resto');
  eq(NP.statusSolicitacaoPorConsumo({itens: itens, itensConsumidos: {M1: {}, M2: {}}}), 'PARCIAL', 'dois de três ainda é PARCIAL');
  eq(NP.statusSolicitacaoPorConsumo({itens: itens, itensConsumidos: {M1: {}, M2: {}, M3: {}}}), 'CONSOLIDADA',
    'o último item fecha a solicitação');
  eq(NP.statusSolicitacaoPorConsumo({itens: itens}, {M1: {}, M2: {}, M3: {}}), 'CONSOLIDADA',
    'dá para simular antes de gravar (é como a transação decide o status novo)');
  eq(NP.statusSolicitacaoPorConsumo({itens: {}}), 'APROVADA', 'solicitação sem item não vira consolidada por vacuidade');
  // Código com caractere proibido em chave de RTDB tem que bater nos dois lados.
  eq(NP.chaveItemConsumo('MP/GR.01'), 'MP-GR-01', 'a chave de consumo sanea o código');
  eq(NP.statusSolicitacaoPorConsumo(
    {itens: {a: {materialCodigo: 'MP/GR.01'}}, itensConsumidos: {'MP-GR-01': {}}}), 'CONSOLIDADA',
    'e o status reconhece o item consumido por essa mesma chave');
}

// ── 3. Cancelar um PC devolve só os itens DELE ────────────────────────────
{
  const pc = {itens: {
    i1: {materialCodigo: 'EP-00195', origemSolicitacaoKey: 's1'},
    i2: {materialCodigo: 'EP-00009', origemSolicitacaoKey: 's1'},
    i3: {materialCodigo: 'X-1', origemSolicitacaoKey: 's2'},
    i4: {materialCodigo: 'EP-00195', origemSolicitacaoKey: 's1'}, // repetido
    i5: {materialCodigo: 'SEM-SC'} // sem origem: ignorado
  }};
  const c = CPC.consumoDoPedido(pc, NP.chaveItemConsumo);
  dq(c.s1.sort(), ['EP-00009', 'EP-00195'], 'agrupa por solicitação e não repete material');
  dq(c.s2, ['X-1']);
  ok(!c.undefined, 'item sem solicitação de origem não inventa grupo');

  ok(CPC.solicitacoesParaReabrir({solicitacoesOrigem: {s1: true}}, {s1: {status: 'PARCIAL'}}).length === 1,
    'SC PARCIAL pode ser reaberta: o PC cancelado pode ter fechado só parte dela');
  ok(CPC.solicitacoesParaReabrir({solicitacoesOrigem: {s1: true}}, {s1: {status: 'CONSOLIDADA'}}).length === 1,
    'CONSOLIDADA segue reabrindo, como antes');
  ok(CPC.solicitacoesParaReabrir({solicitacoesOrigem: {s1: true}}, {s1: {status: 'APROVADA'}}).length === 0,
    'SC que já está aberta não é "reaberta"');

  // O resultado de desconsumir: a SC volta a PARCIAL (não a APROVADA) quando
  // outro PC ainda segura outros itens.
  const sc = {itens: {a: {materialCodigo: 'EP-00195'}, b: {materialCodigo: 'EP-00009'}, c: {materialCodigo: 'M3'}},
    itensConsumidos: {'EP-00195': {pcKey: 'pcA'}, 'EP-00009': {pcKey: 'pcA'}, M3: {pcKey: 'pcB'}}};
  const cons = Object.assign({}, sc.itensConsumidos);
  c.s1.forEach((ch) => { if (cons[ch] && cons[ch].pcKey === 'pcA') delete cons[ch]; });
  eq(NP.statusSolicitacaoPorConsumo({itens: sc.itens, itensConsumidos: cons}), 'PARCIAL',
    'cancelar o pcA devolve os itens dele, mas o M3 do pcB continua fechado');
  ok(cons.M3, 'o consumo do outro pedido não é tocado');
}

// ── 4. Quais itens um fornecedor pode fechar ──────────────────────────────
{
  const ctx = {console, Math, String, Number, Object, Array, Boolean, JSON, Date, RegExp,
    parseInt, parseFloat, isNaN, Promise, document: undefined};
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('public/shared/utils.js', 'utf8'), ctx);
  const ini = srcCompras.indexOf('function itensFechaveisDoConvidado(');
  ok(ini > 0, 'itensFechaveisDoConvidado existe em compras.html');
  const fim = srcCompras.indexOf('\nfunction gerarPedidoDoFornecedor', ini);
  vm.runInContext(srcCompras.slice(ini, fim), ctx);

  const proc = {
    itens: {
      a: {materialCodigo: 'M1'},
      b: {materialCodigo: 'M2'},
      c: {materialCodigo: 'M3'},
      d: {materialCodigo: 'M4', pedidoCompraKey: 'pcAntigo'}
    },
    fornecedoresConvidados: {
      f1: {fornecedorKey: 'F1', itens: {a: true, b: true, d: true}, respostaItens: {
        a: {precoUnit: 10, qtdCotada: 100},
        b: {precoUnit: null, qtdCotada: 100},
        d: {precoUnit: 5, qtdCotada: 50}
      }},
      f2: {fornecedorKey: 'F2', itens: {c: true}, respostaItens: {c: {precoUnit: 7}}}
    }
  };
  dq(ctx.itensFechaveisDoConvidado(proc, 'f1'), ['a'],
    'fecha só o item cotado com preço E quantidade: b está sem preço, e d já virou PC');
  dq(ctx.itensFechaveisDoConvidado(proc, 'f2'), [],
    'preço sem quantidade não fecha — PC sem quantidade não é pedido');

  // Similar exige a especificação técnica, mesma regra do caminho por item.
  const comSimilar = JSON.parse(JSON.stringify(proc));
  comSimilar.fornecedoresConvidados.f1.materialSimilarPorItem = {a: true};
  dq(ctx.itensFechaveisDoConvidado(comSimilar, 'f1'), [],
    'material similar sem especificação técnica não pode ser fechado');
  comSimilar.fornecedoresConvidados.f1.respostaItens.a.especificacaoTecnica = 'equivalente X';
  dq(ctx.itensFechaveisDoConvidado(comSimilar, 'f1'), ['a'], 'com a especificação preenchida, libera');
}

// ── 5. A tela: o caminho existe e as travas valem para PARCIAL ────────────
{
  ok(/class="btn btn-green btn-sm cot-gerar-pc-fornec"/.test(srcCompras),
    'existe o botão de fechar com um fornecedor só');
  ok(/\.cot-gerar-pc-fornec'\)\.forEach/.test(srcCompras), 'e ele está ligado a um handler');
  ok(/function gerarPedidoDoFornecedor\(procKey, cKey\)/.test(srcCompras), 'que chama a função certa');
  ok(/if \(itens\[itemKey\]\.pedidoCompraKey\) \{ jaFechados\+\+; return; \}/.test(srcCompras),
    'o fechamento de todos os itens passa a pular o que já virou PC — senão exigiria vencedor para item já comprado');
  ok(/s\.status !== 'CONSOLIDADA' && s\.status !== 'PARCIAL'/.test(srcCompras),
    'admin não apaga SC parcialmente consumida (parte dela já é PC de verdade)');
  ok(/s\.status === 'CONSOLIDADA' \|\| s\.status === 'PARCIAL'/.test(srcCompras),
    'e a checagem de novo dentro de excluirSolicitacao');
  ok(/<option value="PARCIAL">/.test(srcCompras), 'PARCIAL é filtrável na aba Solicitações');
  ok(/PARCIAL: '<span class="badge badge-blue"/.test(srcCompras), 'e tem selo próprio, não cai no genérico');
  ok(/shared\/necessidade-pedidos\.js/.test(srcCompras),
    'compras.html carrega o módulo de onde vêm chaveItemConsumo e statusSolicitacaoPorConsumo');

  // O flip antigo não pode voltar: era ele que impedia o fechamento parcial.
  eq((srcCompras.match(/atual === 'APROVADA' \? 'CONSOLIDADA' : undefined/g) || []).length, 0,
    'nenhum ponto volta a consolidar a solicitação inteira num flip de status');
  ok(/statusSolicitacaoPorConsumo/.test(srcCompras), 'o status passa a ser calculado a partir dos itens');

  // Comprar sem comparar é decisão do comprador, mas tem que ser avisada.
  ok(/ainda não responderam/.test(srcCompras),
    'avisa quando há convidado do mesmo material sem resposta — fechar ali é comprar sem comparar');
  ok(/seguem em cotação/.test(srcCompras), 'e diz quantos materiais continuam em cotação depois de fechar');
}

// ── 6. O processo só encerra quando não sobra material ────────────────────
{
  ok(/updates\['processos_cotacao\/' \+ procKey \+ '\/status'\] = fechou \? 'DECIDIDO' : 'ABERTO';/.test(srcCompras),
    'processo com material pendente continua ABERTO — fechar um fornecedor não encerra a cotação');
  ok(/'\/itens\/' \+ ik \+ '\/pedidoCompraKey'\] = pc\.pcKey/.test(srcCompras),
    'cada item fechado guarda o PC que o levou, e é isso que impede comprá-lo de novo');
}

// ── 7. A página precisa continuar parseando ──────────────────────────────
// Erro de sintaxe em compras.html não quebra uma função: apaga a tela toda.
// Barato de checar, e caro de descobrir em produção.
{
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, blocos = 0;
  while ((m = re.exec(srcCompras))) {
    blocos++;
    const corpo = m[1];
    try { new vm.Script(corpo); } catch (e) {
      assert.fail('compras.html, bloco inline ' + blocos + ': ' + e.message);
    }
    n++;
  }
  ok(blocos > 0, 'achou script inline em compras.html (se não achou, a regex quebrou e o teste acima não valeu nada)');
  ['public/shared/necessidade-pedidos.js', 'public/shared/cancelamento-pc.js'].forEach((f) => {
    try { new vm.Script(fs.readFileSync(f, 'utf8')); n++; } catch (e) { assert.fail(f + ': ' + e.message); }
  });
}

console.log('OK cotacao parcial: ' + n + ' verificacoes — fecha com um fornecedor, o resto segue em cotacao, ' +
  'item consumido nao conta duas vezes em "O que comprar" e cancelar o PC devolve so os itens dele.');
