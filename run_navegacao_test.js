'use strict';
/* Navegação: o registro único de telas (shared/navegacao.js) que alimenta o menu
   e a tela inicial. Garante, para cada perfil, que o menu nunca oferece link
   sem acesso, que nenhuma tela aparece duas vezes e que cada tela mora no bloco
   certo. A definição de módulos vem do próprio auth_check.js, não de uma cópia. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Nav = require('./public/shared/navegacao.js');
const InspecaoTotalPA = require('./public/shared/inspecao-total-pa.js');
const PesagensDia = require('./public/shared/pesagens-dia.js');
const CargasPA = require('./public/shared/cargas-pa.js');
const SequenciaSetor = require('./public/shared/sequencia-setor.js');
const PerdasEtapa = require('./public/shared/perdas-etapa.js');

// Extrai de auth_check.js o trecho puro (módulos, papéis, podeAbrirPagina).
const fonte = fs.readFileSync('public/auth_check.js', 'utf8');
const ini = fonte.indexOf('const KURYOS_MODULOS = {');
const fim = fonte.indexOf('window.KURYOS_MODULOS = KURYOS_MODULOS;');
assert.ok(ini > 0 && fim > ini, 'trecho de módulos não encontrado em auth_check.js');
const acesso = new Function(fonte.slice(ini, fim) +
  '; return {KURYOS_MODULOS, MODULOS_POR_PAPEL, modulosDoUsuario, usuarioTemModulo, podeAbrirPagina, setoresOperacao, homeDoUsuario};')();

function ctxDe(user) {
  return {
    podeAbrir: (pg) => acesso.podeAbrirPagina(user, pg),
    temMod: (m) => acesso.usuarioTemModulo(user, m),
    setores: acesso.setoresOperacao(user)
  };
}
const menuDe = (user) => Nav.blocos(ctxDe(user));
const hrefs = (menu) => [].concat(...menu.map((b) => b.itens.map((i) => i.h)));
const bloco = (menu, nome) => menu.find((b) => b.nome === nome);
const temItem = (menu, nome, rotulo) => !!(bloco(menu, nome) && bloco(menu, nome).itens.some((i) => i.r === rotulo));

const perfis = {
  admin: {role: 'admin'}, pcp: {role: 'pcp'}, production: {role: 'production'}, rotulagem: {role: 'rotulagem'},
  logistica: {role: 'logistica'}, qualidade: {role: 'qualidade'}, rh: {role: 'rh'}, gestor: {role: 'gestor'},
  pending: {role: 'pending'},
  // marcação individual manda sobre o papel
  soManipulacao: {role: 'gestor', modulos: {manipulacao: true}},
  soCompras: {role: 'gestor', modulos: {compras: true}},
  comercialPedidos: {role: 'gestor', modulos: {comercial: true, pedidos: true}}
};

// 1) Para qualquer perfil: todo link abre; nenhuma tela repetida; todo bloco conhecido; sem bloco vazio.
Object.keys(perfis).forEach((nome) => {
  const user = perfis[nome];
  const menu = menuDe(user);
  const lista = hrefs(menu);
  assert.equal(new Set(lista).size, lista.length, nome + ': link repetido no menu');
  menu.forEach((b) => {
    assert.ok(Nav.BLOCOS.includes(b.nome), nome + ': bloco desconhecido ' + b.nome);
    assert.ok(b.itens.length > 0, nome + ': bloco vazio ' + b.nome);
    b.itens.forEach((i) => assert.ok(acesso.podeAbrirPagina(user, i.p), nome + ': link sem acesso ' + i.h));
  });
  const nomes = menu.map((b) => b.nome);
  assert.deepEqual(nomes, Nav.BLOCOS.filter((n) => nomes.includes(n)), nome + ': blocos fora de ordem');
});

// 2) Conta pendente só vê os manuais; admin vê todos os blocos.
assert.deepEqual(menuDe(perfis.pending).map((b) => b.nome), ['Ajuda'], 'conta pendente só enxerga os manuais, abertos a todos');
assert.equal(acesso.homeDoUsuario(perfis.pending).startsWith('login.html'), true, 'pendente vai para o aviso, não para o Início');
assert.equal(acesso.homeDoUsuario(perfis.logistica), 'inicio.html');
assert.equal(menuDe(perfis.admin).length, Nav.BLOCOS.length, 'admin enxerga todos os blocos');

// 3) A tela de cada perfil mora no bloco certo.
const log = menuDe(perfis.logistica);
assert.ok(temItem(log, 'Expedição', 'Expedição de Vendas'), 'logística tem a Expedição');
['Faturamento', 'Expedição — Faturamento', 'Expedição — Acompanhamento', 'Expedição — Montar carga'].forEach((r) => assert.ok(!temItem(log, 'Expedição', r), 'etapas não são mais links de menu: ' + r));
assert.ok(!bloco(log, 'PCP') && !bloco(log, 'Compras') && !bloco(log, 'ADM'), 'logística não vê PCP, Compras nem ADM');
assert.deepEqual(bloco(log, 'RH').itens.map((i) => i.r), ['Feedback da Semana'], 'do RH, só o Feedback da Semana (todos os papéis têm)');
assert.ok(temItem(log, 'Armazém', 'WMS') && temItem(log, 'Armazém', 'Conferência de PA') && temItem(log, 'Armazém', 'Próximas Separações'));
assert.ok(temItem(log, 'Armazém', 'Devoluções de Cliente'), 'devolução vive no Armazém para quem não é Comercial');

const prod = menuDe(perfis.production);
assert.ok(temItem(prod, 'PCP', 'Inspeção Total de PA'), 'planejamento acompanha a inspeção total pelo PCP');
assert.ok(!bloco(prod, 'Qualidade'), 'produção não tem o bloco Qualidade');
assert.ok(!bloco(prod, 'Armazém') || !temItem(prod, 'Armazém', 'WMS'), 'produção não vê o WMS');
assert.ok(temItem(prod, 'Operação', 'Apontamento'));
const subs = bloco(prod, 'Operação').itens.map((i) => i.s);
assert.deepEqual([...new Set(subs.filter(Boolean))], ['Produção', 'Manipulação', 'Rotulagem'].filter((s) => subs.includes(s)), 'subtítulos da Operação em ordem');

const qua = menuDe(perfis.qualidade);
assert.ok(temItem(qua, 'Qualidade', 'Inspeção Total de PA') && temItem(qua, 'Qualidade', 'Fila de Inspeção') && temItem(qua, 'Qualidade', 'Dossiê do Lote'));
assert.ok(temItem(qua, 'Qualidade', 'Liberação de linha'));
assert.ok(temItem(qua, 'Operação', 'Conferência de Pesagem'), 'Qualidade confere a pesagem pela Operação › Manipulação');
assert.ok(!bloco(qua, 'Armazém') || !temItem(qua, 'Armazém', 'Estoque'), 'qualidade não vê o saldo de estoque');

assert.deepEqual(bloco(qua, 'Qualidade').itens.map((i) => i.r).slice(0, 5),
  ['Fila de Inspeção', 'Não Conformidades', 'Inspeção Total de PA', 'Liberação de linha', 'Histórico e Indicadores'], 'a Qualidade começa pelas suas telas de trabalho');
assert.deepEqual(bloco(qua, 'Qualidade').itens.slice(-2).map((i) => i.r), ['Devoluções de Cliente', 'Dossiê do Lote'], 'telas de apoio ficam no fim do bloco');
assert.equal(bloco(log, 'Armazém').itens.slice(-1)[0].r, 'Devoluções de Cliente');
assert.deepEqual(bloco(menuDe(perfis.pcp), 'PCP').itens.map((i) => i.r), ['Planejamento', 'Controle de OPs', 'Emitir OP', 'Pesagens', 'Matriz de Insumos (MRP)', 'O que comprar'], 'PCP na ordem do trabalho (a Inspeção Total fica na Qualidade, que o PCP também tem)');
assert.deepEqual(bloco(prod, 'PCP').itens.map((i) => i.r), ['Planejamento', 'Controle de OPs', 'Inspeção Total de PA', 'Pesagens', 'O que comprar']);

const rot = menuDe(perfis.rotulagem);
assert.deepEqual(rot.map((b) => b.nome), ['Operação', 'RH', 'Ajuda']);
assert.ok(temItem(rot, 'Operação', 'Apontamento') && !temItem(rot, 'Operação', 'Estoque da Fábrica'));

// Quem só tem Manipulação: nada de PCP, Compras ou Qualidade; a pesagem fica na Operação.
const man = menuDe(perfis.soManipulacao);
assert.ok(temItem(man, 'Operação', 'Pesagem e Manipulação') && temItem(man, 'Operação', 'Pesagens do dia'));
assert.ok(!bloco(man, 'PCP') && !bloco(man, 'Qualidade') && !bloco(man, 'Compras'));

// Quem só tem Compras: Compras + "O que comprar" ali mesmo (não vai para o PCP).
const comp = menuDe(perfis.soCompras);
assert.ok(temItem(comp, 'Compras', 'Compras') && temItem(comp, 'Compras', 'O que comprar') && !bloco(comp, 'PCP'));

// Comercial com Pedidos e MRP: o Relatório de Pedido fica no bloco de rastreio, sem duplicar.
const cp = menuDe(perfis.comercialPedidos);
assert.ok(temItem(cp, 'Pedidos e Rastreio', 'Relatório de Pedido') && !temItem(cp, 'Comercial', 'Relatório de Pedido'));
assert.ok(temItem(menuDe({role: 'gestor', modulos: {comercial: true}}), 'Comercial', 'Relatório de Pedido'));

// Expedição: as três etapas marcam o mesmo link como ativo.
const exp = Nav.TELAS.find((t) => t.p === 'expedicao.html');
assert.deepEqual(exp.fam, ['expedicao.html', 'faturamento.html', 'cargas.html']);

// Toda página citada no registro existe em public/ (menos as de módulo opcional que não existam: nenhuma).
Nav.TELAS.forEach((t) => assert.ok(fs.existsSync('public/' + t.p), 'tela inexistente no registro: ' + t.p));

// Nenhuma página que tinha link no menu antigo ficou sem casa: confere contra a lista de páginas com módulo.
const comModulo = new Set();
Object.values(acesso.KURYOS_MODULOS).forEach((m) => m.paginas.forEach((p) => comModulo.add(p)));
const doRegistro = new Set(Nav.TELAS.map((t) => t.p));
// horizonte.html está fora do menu de propósito (CLAUDE.md); faturamento/cargas são etapas da Expedição.
const foraDoMenu = new Set(['horizonte.html', 'faturamento.html', 'cargas.html']);
comModulo.forEach((p) => assert.ok(doRegistro.has(p) || foraDoMenu.has(p), 'página com módulo e sem lugar no menu: ' + p));

// 4) Cartões da tela inicial: quem vê o quê, e só lê o que precisa.
const cartoesDe = (user) => Nav.cartoesVisiveis(ctxDe(user)).map((c) => c.id);
assert.deepEqual(cartoesDe(perfis.logistica).sort(), ['cargas_carregar', 'cargas_faturar', 'descartes', 'devolucoes_receber', 'fila_separacao']);
assert.deepEqual(cartoesDe(perfis.rotulagem), ['fila_rotulagem']);
assert.deepEqual(cartoesDe(perfis.soCompras).sort(), ['pc_atrasados', 'pc_enviar', 'sc_aprovar', 'sc_cotar']);
assert.deepEqual(cartoesDe(perfis.soManipulacao).sort(), ['fila_manipulacao']);
assert.ok(cartoesDe(perfis.qualidade).includes('rnc_abertas') && cartoesDe(perfis.qualidade).includes('inspecao_total'));
assert.ok(!cartoesDe(perfis.qualidade).includes('cargas_faturar'));
assert.ok(cartoesDe(perfis.production).includes('inspecao_total') && cartoesDe(perfis.production).includes('pesagens'));
assert.ok(!cartoesDe(perfis.production).includes('rnc_abertas'));
assert.deepEqual(Nav.fontesNecessarias(Nav.cartoesVisiveis(ctxDe(perfis.logistica))), ['agendamentos_expedicao', 'ops', 'devolucoes_cliente', 'solicitacoes_descarte'], 'logística só lê o que os seus cartões usam');

// 5) Contagem dos cartões com dados de verdade.
const lib = {InspecaoTotalPA, PesagensDia, CargasPA, SequenciaSetor, PerdasEtapa, hoje: '2026-10-27', agora: new Date('2026-10-27T12:00:00Z').getTime()};
const ops = {
  '1-1': {status: 'Concluído', lote: '1/01', produto: 'A', inspecaoTotal: {estado: 'AGUARDANDO_DESIGNACAO', sinalizacao: {em: '2026-10-26T10:00:00Z'}}},
  '2-1': {status: 'Concluído', lote: '2/01', produto: 'B', inspecaoTotal: {estado: 'EM_INSPECAO', designacao: {prazoEm: '2026-10-27T08:00:00Z'}, sinalizacao: {em: '2026-10-25T10:00:00Z'}}},
  '3-1': {status: 'Concluído', lote: '3/01', produto: 'C', inspecaoTotal: {estado: 'AGUARDANDO_DECISAO', sinalizacao: {em: '2026-10-24T10:00:00Z'}}},
  '4-1': {status: 'Concluído', lote: '4/01', produto: 'D', inspecaoTotal: {estado: 'DECIDIDA'}},
  '5-1': {status: 'Concluído', lote: '5/01', produto: 'E'}
};
const dados = {
  ops, programacao: {},
  agendamentos_expedicao: {a1: {status: 'AGENDADA'}, a2: {status: 'AGENDADA'}},
  nao_conformidades: {n1: {status: 'ABERTA'}, n2: {status: 'FECHADA'}, n3: {status: 'ABERTA'}},
  solicitacoes_compra: {s1: {status: 'PENDENTE'}, s2: {status: 'APROVADA'}, s3: {status: 'APROVADA'}, s4: {status: 'REJEITADA'}},
  pedidos_compra: {
    p1: {status: 'ABERTO'},
    p2: {status: 'ENVIADO', dataPrevistaEntrega: '2026-10-20'},
    p3: {status: 'RECEBIDO_PARCIAL', dataPrevistaEntrega: '2026-10-26T00:00:00Z'},
    p4: {status: 'ENVIADO', dataPrevistaEntrega: '2026-10-30'},
    p5: {status: 'RECEBIDO_TOTAL', dataPrevistaEntrega: '2026-10-01'}
  },
  devolucoes_cliente: {d1: {status: 'AUTORIZADA'}, d2: {status: 'RECEBIDA'}},
  solicitacoes_descarte: {x1: {status: 'SOLICITADO'}, x2: {status: 'CONCLUIDO'}}
};
dados.ops['10-1'] = {status: 'Programado', lote: '10/01', produto: 'F', qtdPlanejada: 100, formulaVersao: 'F1__v1'};
dados.ops['11-1'] = {status: 'Em Produção', lote: '11/01', produto: 'G', qtdPlanejada: 100, produzidoLinha: 40, abertaDesde: '2026-10-27T07:00:00', separacaoConcluida: true};
const todos = Nav.pendencias(Nav.CARTOES, dados, lib);
const porId = Object.fromEntries(todos.map((p) => [p.id, p]));
assert.equal(porId.inspecao_total.n, 3, 'decidida e OP comum não entram na fila');
assert.equal(porId.inspecao_total.tom, 'alerta', 'prazo vencido deixa o cartão em alerta');
assert.match(porId.inspecao_total.texto, /1 sem responsável · 1 com prazo vencido · 1 aguardando decisão/);
assert.equal(todos[0].tom, 'alerta', 'alertas vêm primeiro');
assert.equal(porId.rnc_abertas.n, 2);
assert.equal(porId.cargas_faturar.n, 2);
assert.equal(porId.sc_aprovar.n, 1); assert.equal(porId.sc_cotar.n, 2);
assert.equal(porId.pc_enviar.n, 1);
assert.equal(porId.pc_atrasados.n, 2, 'só ENVIADO/RECEBIDO_PARCIAL com data vencida; recebido total e data futura não contam');
assert.equal(porId.pc_atrasados.tom, 'alerta');
assert.equal(porId.devolucoes_receber.n, 1); assert.equal(porId.descartes.n, 1);
assert.equal(porId.fila_separacao.n, 1, 'só a OP ativa sem separação concluída');
assert.equal(porId.fila_envase.n, 2); assert.match(porId.fila_envase.texto, /1 em andamento · 1 aguardando/);
assert.equal(porId.fila_manipulacao.n, 1, 'manipulação: OP com fórmula e sem fase iniciada');
assert.ok(!porId.fila_rotulagem, 'sem OP com rótulo, sem cartão');
assert.ok(!porId.cargas_carregar, 'cartão sem pendência não aparece');
assert.deepEqual(Nav.pendencias(Nav.CARTOES, {}, lib), [], 'sem dados nenhum cartão aparece nem quebra');
assert.deepEqual(Nav.pendencias([{id: 'x', titulo: 'x', pagina: 'x', fontes: [], calcular() { throw new Error('boom'); }}], {}, lib), [], 'cartão que falha some sem derrubar a tela');

// 6) Ligações: auth_check carrega o módulo e usa o registro; login e home entram pelo Início.
assert.match(fonte, /document\.write\('<script src="shared\/navegacao\.js">/);
assert.match(fonte, /KuryosNav\.blocos\(navCtx\)/);
assert.match(fs.readFileSync('public/login.html', 'utf8'), /window\.location\.href = 'inicio\.html'/);
const inicio = fs.readFileSync('public/inicio.html', 'utf8');
['shared/inspecao-total-pa.js', 'shared/pesagens-dia.js', 'shared/cargas-pa.js', 'auth_check.js'].forEach((s) => assert.ok(inicio.includes('src="' + s + '"'), 'inicio.html sem ' + s));

console.log('run_navegacao_test: OK');
