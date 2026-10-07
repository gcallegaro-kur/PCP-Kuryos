'use strict';
/* Testes do log de eventos de programação (public/shared/eventos-auditoria.js).
   Foco no que faz um log de auditoria mentir: evento sem autor, instante que
   cai no dia errado, ação inventada, e o log derrubando a operação que ele
   deveria só refletir. */
const assert = require('node:assert/strict');
const E = require('./public/shared/eventos-auditoria');

let n = 0;
const eq = (a, b, m) => { n++; assert.equal(a, b, m); };
const ok = (c, m) => { n++; assert.ok(c, m); };

// ── montar: o que não pode faltar ──────────────────────────────────────────
const base = { acao: 'PROGRAMAR', porUid: 'uid1', porNome: 'Gustavo', papel: 'admin', lote: '26273/03' };
const m = E.montar(base);
ok(!m.erro, 'evento válido não dá erro');
eq(m.registro.acao, 'PROGRAMAR', 'ação preservada');
eq(m.registro.lote, '26273/03', 'lote preservado');
ok(m.registro.em, 'instante preenchido sozinho quando não vem');
eq(E.montar({ acao: 'programar', porUid: 'u' }).registro.acao, 'PROGRAMAR', 'ação aceita minúscula e normaliza');

ok(E.montar({ acao: 'FAZER_ALGO', porUid: 'u' }).erro, 'ação fora da lista é recusada');
ok(/desconhecida/.test(E.montar({ acao: 'XPTO', porUid: 'u' }).erro), 'com motivo legível');
ok(E.montar({ acao: 'PROGRAMAR' }).erro, 'evento SEM AUTOR é recusado -- log sem autor não audita nada');
ok(/porUid/.test(E.montar({ acao: 'PROGRAMAR' }).erro), 'e o erro diz qual campo falta');
ok(E.montar({ acao: 'PROGRAMAR', porUid: 'u', em: 'ontem' }).erro, 'instante inválido é recusado em vez de virar hoje');
ok(E.montar(null).erro, 'entrada nula não quebra');

// Campos ausentes viram null, não undefined (RTDB apaga undefined e o
// registro sairia sem a chave, o que confunde a tela e o filtro).
const vazio = E.montar({ acao: 'TIRAR', porUid: 'u' }).registro;
eq(vazio.linhaDe, null, 'campo ausente é null');
eq(vazio.horas, null, 'horas ausente é null');
ok(Object.keys(vazio).includes('motivo'), 'a chave existe mesmo vazia');

// ── diaLocal: o balde do dia é LOCAL, não UTC ──────────────────────────────
// 21h em Brasília (UTC-3) é 00h do dia seguinte em UTC. Se o balde saísse de
// toISOString(), o evento cairia no dia errado e a auditoria do dia não o
// acharia -- exatamente quando o turno da noite mexe na grade.
const noite = new Date(2026, 9, 7, 21, 30, 0);          // 07/10/2026 21:30 local
eq(E.diaLocal(noite), '2026-10-07', 'evento das 21:30 fica no dia 07, não no 08');
const madrugada = new Date(2026, 9, 7, 0, 10, 0);
eq(E.diaLocal(madrugada), '2026-10-07', 'evento das 00:10 fica no próprio dia');
eq(E.diaLocal('data-podre'), E.diaLocal(new Date()), 'data impossível cai em hoje em vez de quebrar');
eq(E.montar({ acao: 'MOVER', porUid: 'u', em: noite }).dia, '2026-10-07', 'montar usa o dia local');

// ── descrever: a frase que o admin lê ──────────────────────────────────────
eq(E.descrever({ acao: 'TROCAR_LINHA', porNome: 'Gustavo', lote: '26273/03', linhaDe: 'Linha 1', linhaPara: 'Linha 2' }),
  'Gustavo trocou de linha a OP 26273/03: Linha 1 → Linha 2.',
  'troca de linha diz de onde para onde');
eq(E.descrever({ acao: 'TIRAR', porNome: 'Ana', lote: '26273/03', linhaDe: 'Linha 1', data: '2026-10-07', hora: '08:00' }),
  'Ana tirou da grade a OP 26273/03 da Linha 1 em 2026-10-07 08:00.',
  'tirar da grade diz a linha e o slot');
// O caso que originou tudo: "apareceu sozinha". A frase tem que dizer que foi
// o sistema, sem nome de pessoa nenhum.
const auto = E.descrever({ acao: 'VINCULO_AUTOMATICO', porUid: 'sistema', lote: '26273/03', linhaPara: 'Linha 1' });
eq(auto, 'A OP 26273/03 foi posta na linha pelo sistema (Linha 1).', 'vínculo automático se anuncia como sistema');
ok(!/Alguém|undefined/.test(auto), 'e não inventa autor');
eq(E.descrever({ acao: 'PROGRAMAR', lote: '1' }).startsWith('Alguém'), true, 'sem nome, diz "Alguém" em vez de undefined');
ok(!/undefined|null/.test(E.descrever({ acao: 'MOVER' })), 'evento quase vazio não vaza undefined na frase');

// ── Apontamento: o LOGIN ao lado do nome DIGITADO ──────────────────────────
// É a razão de ser desta parte. Até 07/10/2026 o apontamento gravava só o
// nome digitado no campo "operador" (autocomplete com 2 nomes em
// config.operadores) e nenhum vínculo com a conta que gravou -- então não
// havia como saber quem registrou a produção, só quem a pessoa disse que era.
const ap = E.descrever({ acao: 'APONTAR', porNome: 'Robert', porUid: 'u1', lote: '26273/03',
  quantidade: 800, linhaPara: 'Linha 1', operadorDigitado: 'Luana', turno: 'Padrao' });
eq(ap, 'Robert apontou 800 un da OP 26273/03 na Linha 1, informando Luana como operador (turno Padrao).',
  'quando login e operador DIFEREM, a frase mostra os dois');
const apIgual = E.descrever({ acao: 'APONTAR', porNome: 'Luana', porUid: 'u2', lote: '26273/03',
  quantidade: 500, linhaPara: 'Linha 2', operadorDigitado: 'Luana' });
ok(!/informando/.test(apIgual), 'quando são a mesma pessoa, não repete o nome');
ok(!/de a |de da |o a /.test(ap + apIgual), 'sem contração quebrada ("de a OP")');

eq(E.descrever({ acao: 'APONTAR_EXCLUIDO', porNome: 'Gustavo', lote: '26273/03', antes: '800 un em 07/10 08:00' }),
  'Gustavo EXCLUIU o apontamento da OP 26273/03 (era: 800 un em 07/10 08:00).',
  'exclusão diz o que havia antes — é o único registro que sobra do apagado');
eq(E.descrever({ acao: 'APONTAR_EDITADO', porNome: 'Gustavo', lote: '26273/03', antes: '800 un', depois: '760 un' }),
  'Gustavo editou o apontamento da OP 26273/03: 800 un → 760 un.',
  'edição mostra antes e depois');
eq(E.descrever({ acao: 'OP_NA_LINHA', porNome: 'Robert', lote: '26273/03', linhaPara: 'Linha 1' }),
  'Robert colocou a OP 26273/03 na Linha 1.', 'quem pôs a OP na linha no chão de fábrica');
eq(E.descrever({ acao: 'PARAR_LINHA', porNome: 'Robert', lote: '26273/03', linhaDe: 'Linha 1', motivo: 'Falta de Material' }),
  'Robert parou a Linha 1 (OP 26273/03) — Falta de Material.', 'parada traz o motivo');
eq(E.descrever({ acao: 'RETOMAR_LINHA', porNome: 'Robert', linhaDe: 'Linha 1' }),
  'Robert retomou a Linha 1.', 'retomada sem OP não inventa alvo');
eq(E.descrever({ acao: 'ENCERRAR_TURNO', porNome: 'Robert', turno: 'Padrao', linhaDe: 'Linha 1' }),
  'Robert encerrou o turno Padrao na Linha 1.', 'encerramento de turno');
// Pedido é masculino, OP é feminino -- o artigo acompanha
ok(/o pedido 0019/.test(E.descrever({ acao: 'TIRAR', porNome: 'Ana', pedidoKey: '0019__GLMKAM01' })),
  'pedido usa artigo masculino');
ok(/a OP 1/.test(E.descrever({ acao: 'TIRAR', porNome: 'Ana', lote: '1' })), 'OP usa artigo feminino');

// Os campos de apontamento sobrevivem ao montar()
const regAp = E.montar({ acao: 'APONTAR', porUid: 'u1', quantidade: 800, turno: 'Padrao',
  operadorDigitado: 'Luana', registroId: '-Nx1', lote: '26273/03' }).registro;
eq(regAp.quantidade, 800, 'quantidade preservada');
eq(regAp.operadorDigitado, 'Luana', 'nome digitado preservado ao lado do login');
eq(regAp.registroId, '-Nx1', 'id do registro preservado — é o que liga o evento ao apontamento');
eq(regAp.turno, 'Padrao', 'turno preservado');
eq(E.montar({ acao: 'APONTAR', porUid: 'u1' }).registro.quantidade, null, 'quantidade ausente é null, não 0');

// ── registrar: best-effort, nunca derruba a operação ───────────────────────
const dbOk = { ref: () => ({ push: () => Promise.resolve({ key: 'k1' }) }) };
const dbQuebrado = { ref: () => ({ push: () => Promise.reject(new Error('PERMISSION_DENIED')) }) };
const dbExplosivo = { ref: () => { throw new Error('offline'); } };

(async () => {
  eq((await E.registrar(dbOk, base)).ok, true, 'grava quando o banco aceita');
  const neg = await E.registrar(dbQuebrado, base);
  eq(neg.ok, false, 'banco recusando NÃO rejeita a promise');
  ok(/PERMISSION_DENIED/.test(neg.erro), 'e devolve o motivo');
  eq((await E.registrar(dbExplosivo, base)).ok, false, 'throw síncrono do SDK também é contido');
  eq((await E.registrar(null, base)).ok, false, 'sem dbRef não quebra');
  eq((await E.registrar(dbOk, { acao: 'XPTO', porUid: 'u' })).ok, false, 'evento inválido não vai ao banco');

  // registrarComoUsuario: completa autor a partir do logado
  const u = { uid: 'uid9', nome: 'Robert', role: 'pcp' };
  let capturado = null;
  const dbEspia = { ref: () => ({ push: (r) => { capturado = r; return Promise.resolve({}); } }) };
  await E.registrarComoUsuario(dbEspia, u, { acao: 'TIRAR', lote: 'X' });
  eq(capturado.porUid, 'uid9', 'uid do usuário logado entra no registro');
  eq(capturado.porNome, 'Robert', 'nome também');
  eq(capturado.papel, 'pcp', 'e o papel');
  await E.registrarComoUsuario(dbEspia, null, { acao: 'TIRAR', lote: 'X' });
  eq(capturado.porUid, 'desconhecido', 'sem usuário grava "desconhecido" -- o evento ainda diz o que e quando');

  // ── linhaDoTempo: junta as fontes e ordena ───────────────────────────────
  const fontes = {
    eventos: {
      '2026-10-07': {
        e1: { acao: 'TIRAR', lote: 'A', porNome: 'Ana', em: '2026-10-07T10:00:00.000Z' },
        e2: { acao: 'PROGRAMAR', lote: 'B', porNome: 'Ana', em: '2026-10-07T12:00:00.000Z' }
      },
      '2026-10-06': {
        e3: { acao: 'MOVER', lote: 'C', porNome: 'Bia', em: '2026-10-06T09:00:00.000Z' }
      }
    },
    rearranjos: {
      r1: { lote: 'D', origem: 'Linha 1', destino: 'Linha 2', uid: 'uid1', em: '2026-10-07T11:00:00.000Z' }
    },
    ops: {
      '26273/03': {
        lote: '26273/03', produto: 'BODY SPLASH', linha: 'Linha 1',
        confirmacaoEtapas: { envase: { confirmadoEm: '2026-10-07T13:00:00.000Z', confirmadoPor: 'Gustavo', quantidade: 800 } },
        canceladoEm: '2026-10-07T14:00:00.000Z', canceladoPor: 'Gustavo', justificativaCancelamento: 'erro de lote'
      },
      'sem-nada': { lote: 'sem-nada' }
    }
  };
  const lt = E.linhaDoTempo(fontes);
  eq(lt.length, 6, 'junta eventos próprios, rearranjo, confirmação de etapa e cancelamento');
  eq(lt[0].em, '2026-10-07T14:00:00.000Z', 'ordena do mais recente para o mais antigo');
  eq(lt[lt.length - 1].lote, 'C', 'e o mais antigo fica no fim');
  eq(lt.find(e => e.fonte === 'rearranjos_linhas').acao, 'TROCAR_LINHA', 'rearranjo entra como troca de linha');
  eq(lt.find(e => e.fonte === 'rearranjos_linhas').linhaPara, 'Linha 2', 'com destino');
  eq(lt.find(e => e.fonte === 'ops.confirmacaoEtapas').acao, 'ENCERRAR', 'confirmação de etapa entra como encerramento');
  ok(/800 un/.test(lt.find(e => e.fonte === 'ops.confirmacaoEtapas').motivo), 'com a quantidade no motivo');
  eq(lt.find(e => e.fonte === 'ops.cancelamento').porNome, 'Gustavo', 'cancelamento preserva quem cancelou');
  ok(/erro de lote/.test(lt.find(e => e.fonte === 'ops.cancelamento').motivo), 'e a justificativa');
  eq(E.linhaDoTempo({}).length, 0, 'sem fontes devolve lista vazia');
  eq(E.linhaDoTempo(null).length, 0, 'entrada nula não quebra');

  // Evento sem instante vai para o fim marcado, em vez de bagunçar a ordem
  const ltSemData = E.linhaDoTempo({ eventos: { '2026-10-07': {
    bom: { acao: 'TIRAR', lote: 'A', em: '2026-10-07T10:00:00.000Z' },
    ruim: { acao: 'TIRAR', lote: 'B' }
  } } });
  eq(ltSemData[0].lote, 'A', 'o que tem instante vem primeiro');
  eq(ltSemData[1].semInstante, true, 'o sem instante é marcado');

  // ── filtrar ──────────────────────────────────────────────────────────────
  eq(E.filtrar(lt, {}).length, lt.length, 'filtro vazio não restringe');
  eq(E.filtrar(lt, { acao: 'TIRAR' }).every(e => e.acao === 'TIRAR'), true, 'filtra por ação');
  eq(E.filtrar(lt, { linha: 'Linha 2' }).length, 1, 'filtra por linha (origem ou destino)');
  eq(E.filtrar(lt, { porUid: 'uid1' }).length, 1, 'filtra por autor');
  eq(E.filtrar(lt, { de: '2026-10-07' }).every(e => e.em >= '2026-10-07'), true, 'filtra por data inicial');
  eq(E.filtrar(lt, { ate: '2026-10-06' }).length, 1, 'filtra por data final');
  // Busca tolerante: o lote escrito de três jeitos acha o mesmo evento
  eq(E.filtrar(lt, { busca: '26273/03' }).length, 2, 'busca pelo lote com barra');
  eq(E.filtrar(lt, { busca: '26273-03' }).length, 2, 'busca pelo lote com hífen');
  eq(E.filtrar(lt, { busca: '2627303' }).length, 2, 'busca pelo lote compacto');
  eq(E.filtrar(lt, { busca: 'ANA' }).length, 2, 'busca por nome, sem caixa');
  eq(E.filtrar(lt, { busca: 'body splash' }).length, 2, 'busca pelo produto');
  eq(E.filtrar(lt, { busca: 'inexistente' }).length, 0, 'busca sem resultado devolve vazio');
  eq(E.filtrar(null, { busca: 'x' }).length, 0, 'lista nula não quebra');

  console.log('OK eventos de programação: ' + n + ' asserções — evento sem autor recusado, balde do dia em hora local, ' +
    'log nunca derruba a operação, vínculo automático se anuncia como sistema, linha de tempo junta as fontes antigas.');
})().catch((e) => { console.error(e); process.exit(1); });
