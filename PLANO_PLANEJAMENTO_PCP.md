# Plano — Planejamento, PCP e Eficiência de OPs

Documento vivo. Consolida a discussão de arquitetura sobre planejamento de
pedidos, planejamento de OPs, eficiência de produção e apontamento,
debatida em profundidade com o usuário a partir de 2026-08-28, com uma
rodada de revisão em 2026-08-28 que corrigiu premissas importantes (ver
histórico de decisões abaixo). Escopo deliberadamente **não inclui** Ordens
de Serviço / Roteiro de Produção / Estoque de Produto Acabado — esse
conceito foi adiado pra depois, ver seção própria em `MELHORIAS_FUTURAS.md`.
Aqui é só a parte de planejamento/PCP/apontamento que o usuário pediu pra
"azeitar" primeiro.

---

## 1. Origem — a pergunta que disparou tudo isso

"Programei e emiti 1.000 itens na OP, foi finalizada com 800" — como
melhorar planejamento de pedidos, planejamento de OPs, eficiência das OPs e
apontamento de produção.

## 2. Diagnóstico técnico (confirmado lendo o código, não inferido)

- **A OP se auto-conclui aos 95%** (`shared/utils.js:463`, `auth_check.js:677`,
  hardcoded em 3 lugares) — até 5% de perda é estruturalmente invisível em
  qualquer OP, mesmo nas que "bateram a meta". Nenhuma confirmação humana é
  exigida.
- **O único comparativo planejado × real de peso analítico**
  (`opGapNaoExplicado`, `historico.html:1099-1106`, e o benchmark histórico
  por SKU, `historico.html:928-962`) fica enterrado dentro do card
  individual de cada OP — é dado de auditoria, não indicador de gestão, e
  não é agregado por linha/período/cliente.
- **`perdaLinhaPct`** existe no cadastro de produto, sincronizado
  automaticamente da planilha legada, mas **nenhum cálculo do sistema o
  lê** — campo morto.
- A margem de perda que existe hoje (`perdaProcessoPct`) só infla o volume
  de **granel/matéria-prima líquida** na emissão da OP — não cobre
  embalagem (BOM), que é o tipo de perda mais registrado no apontamento.
- **A manipulação (fabrico do batch) não tem nenhum apontamento hoje** —
  confirmado por busca no repositório inteiro, zero ocorrência de
  "manipulação"/"batch"/"fabrico" como etapa de produção rastreada. Só
  existem 3 tipos de produção rastreados: `produzidoLinha` (Envase),
  `produzidoRotulagem`, `produzidoPosto` (`shared/utils.js:432-436`). Isso
  segue sendo verdade tecnicamente, **mas construir apontamento pra essa
  etapa foi adiado** — ver decisão na seção 3, o problema real hoje é
  anterior a isso (disciplina de pesagem).
- **`horizonte.html` está tecnicamente acoplada, mas morta pro uso real da
  equipe** — ponto corrigido nesta revisão, ver seção 3. Tecnicamente, o
  código está sim acoplado via `alocacoes_planejamento`, consumido por
  `planejamento.html`, `ops.html`, 2 rotinas de fundo em `auth_check.js` e
  `linkAlocacaoToOP` em `functions/index.js`. Mas o usuário confirmou: a
  TELA em si (simulador de capacidade, fila de backlog, necessidades de
  emissão) não é usada no dia a dia, é "pouco funcional" — daí a proposta
  de substituí-la pelas duas novas telas de planejamento.
- **`dataInicioPlanejada`/`dataFimPlanejada`** já existem no schema de toda
  OP desde a emissão (`emitir_op.html:532`) mas **nunca são preenchidos em
  lugar nenhum** — campo morto vestigial. É o que falta popular pra
  qualquer alerta de atraso funcionar.
- **Infra de e-mail/alerta já é robusta**: cron `checkNotificacoes` roda a
  cada 2 minutos (`functions/index.js:1099`), com fila de eventos
  (`alertas_pendentes`) e cooldown/dedupe (`cooldownOk`/`markSent`, janela
  padrão de 60 minutos, `NOTIF_COOLDOWN_MIN`). **Atenção**: os novos
  alertas de atraso (ver seção 3) precisam de repique a cada 10 minutos —
  o cooldown padrão de 60 minutos não serve pra esse caso, vai precisar de
  uma janela própria por tipo de alerta.
- **O motor de replanejamento automático existe no código
  (`auth_check.js:784-1003`, `autoAjustarPlanejamento`), mas o usuário
  reporta que na prática NADA é percebido acontecendo — fica tudo
  estático, nenhum bloco visualmente se move.** Ponto corrigido nesta
  revisão: eu tinha assumido que "existe no código" implicava "está
  funcionando"; não necessariamente. **Ação necessária antes de reaproveitar
  esse motor em qualquer fase nova: investigar por que não está
  produzindo efeito visível** (pode ser bug, pode estar escrevendo num
  lugar que a tela não relê, pode estar atrás de uma condição que nunca é
  satisfeita) — ver Fase 1 do sequenciamento.
- **Paradas de linha são bem rastreadas, mas 100% desconectadas de
  qualquer cálculo.** Dois mecanismos maduros — Andon ao vivo
  (`estado_linhas`, `form.html:1278-1284`) e histórico com duração exata
  (`paradas_historico`, `form.html:1123-1135`) — mas nenhum cálculo de
  ETA/capacidade no sistema hoje lê esse dado.
- **Changeover/setup é greenfield puro.** Existe um cronômetro manual
  (`setupInicio`/`setupFim` por OP, `form.html:4069-4096`), mas zero
  cadastro de tempo-padrão por linha/SKU e zero uso em cálculo de
  capacidade.

## 3. Decisões já tomadas com o usuário

### Apontamento de manipulação — adiado, não é o próximo passo

Corrigido nesta revisão: **não é viável construir isso agora.** O problema
real hoje é anterior — falha de processo na pesagem, alguns itens nem
estão sendo pesados. Apontar "volume real do batch" contra um dado de
pesagem que nem sempre existe geraria número não confiável, pior que não
ter o dado. **Pré-requisito antes de retomar esse tópico: resolver a
disciplina de pesagem no chão de fábrica** (processo, não sistema). Movido
pra `MELHORIAS_FUTURAS.md`, marcado como bloqueado por esse pré-requisito.

### Horizonte — substituição da TELA, não do pipeline de dados

O usuário confirmou: `horizonte.html` como tela não é usada, é "pouco
funcional" — origem da proposta das duas novas telas (Quantidades / OPs).
Mas o pipeline de dado por trás (`alocacoes_planejamento`,
`necessidadeCodigo`, `linkAlocacaoToOP`) é real e usado por outras 3
telas — não pode ser descartado, só precisa ser recablado pras novas
telas assumirem o papel de UI que `horizonte.html` tinha.

- **Planejamento de Quantidades** — pedidos são programados aqui, resumos
  de produção do dia/semana, metas.
- **Planejamento de OPs** — cada OP emitida referencia o bloco de
  quantidade correspondente e "consome" uma fração (ou o todo) dele. Ao
  fim, a soma das OPs emitidas tem que suprir a quantidade total
  planejada. Em vez de blocos de "pedido", mostra blocos de "OP" (um
  pedido de 10.000 vira 10 OPs de 1.000, já é o que acontece na prática
  hoje — a diferença é a tela refletir isso explicitamente).
- **A tela de apontamento da produção passa a espelhar o Planejamento de
  OPs** — o operador vê ali, direto, o que precisa estar fazendo agora,
  até que horas deveria terminar, e quais são os próximos itens da fila
  daquela linha. Uma fonte única, não uma lista separada pro Andon.

### Granularidade — do sistema, não do operador; e é exata, não slot fixo

**O apontamento do operador NÃO é por hora nem por OP inteira — são
pontos de controle naturais**, ajustado nesta 2ª revisão: **início de
turno, abertura de OP, paradas (Andon), encerramento de OP, fim de
turno.** "Intervalo" saiu da lista — decisão do usuário. "Início de
turno" precisa virar um botão explícito próprio (hoje o Painel de Turno
não tem uma ação dedicada pra isso, só "Fim de turno" já existe como
motivo de parada automática, `form.html:4554-4557`). A diferença é
formalizar esses pontos como o modelo oficial de apontamento, sem exigir
check-in por hora.

A granularidade do PLANEJAMENTO (grade/timeline do sistema) é uma decisão
separada, já fechada antes: cada bloco planejado guarda início/fim exatos
em minutos (não slot fixo de 5 ou 15) — 1.300 peças a 1.000/h ocupam
exatamente 78 minutos na conta de capacidade, zero arredondamento. 5
minutos vira só o "snap" de arraste na interface. Implica redesenhar a
grade diária como timeline proporcional, não esticar o modelo atual de
coluna-por-hora.

### Início de OP: programado × real, com cobrança de esquecimento

`dataInicioPlanejada` vem da programação; `dataInicioReal` é marcado pela
produção ao abrir a OP. **Novo tipo de alerta, distinto de "OP atrasada em
andamento": OP que deveria ter começado e ainda não foi aberta** — cobra
o início (pode ser simplesmente esquecimento). Evolução futura (não
MVP): alertas sonoros na fábrica ou notificação no celular do funcionário,
conforme o fluxo for maturando — anotado em `MELHORIAS_FUTURAS.md`.

### Tolerância de atraso: 5 minutos + repique a cada 10 minutos

Reduzido nesta revisão (era 15 minutos). Primeira notificação ao PCP 5
minutos após o desvio (início não ocorrido, ou andamento atrasado);
repete a cada 10 minutos enquanto o desvio persistir. Motivação explícita
do usuário: a hipótese é que o gargalo real vai ser apontamento (ninguém
marcar fim de OP ou parada de linha), não a produção em si — quanto mais
rápido o PCP perceber e for checar pessoalmente, menor a distorção.
Implicação técnica (ver seção 2): precisa de uma janela de cooldown
própria (10 min), o padrão de 60 min do sistema de notificação atual não
serve pra esse alerta.

### Conclusão de OP — 100% manual pelo PCP no início

Sem exceção, não gated por desvio. Volume é baixo (poucas OPs/dia, 3
linhas), objetivo é construir a rotina/fluxo bem amarrado primeiro.
Automação por desvio é evolução natural, decidida depois que o fluxo
estiver maduro.

### Changeover — setup padrão inicial, apurado com o tempo

Sugerir um tempo-padrão por linha pra começar, e ir apurando a cada
nova OP/dia com dado real — alimenta diretamente a base que o ML (mais à
frente) vai precisar.

### Machine Learning — adiado

Antes de qualquer modelo, é preciso 2-3 meses de dado limpo com
desvio-justificado obrigatório. Reavaliar depois que a base existir.

## 4. KPIs propostos

Além dos dois já combinados (% de atraso geral e % de atraso por SKU),
KPIs adicionais que fazem sentido, dado tudo que já é ou vai passar a ser
capturado:

- **% de OPs iniciadas no horário programado** — pontualidade de início,
  separado do atraso em andamento (são duas causas diferentes de
  problema).
- **Tempo médio de atraso no início**, quando atrasa.
- **Rendimento médio por linha/SKU/período** (produzido ÷ planejado) — o
  indicador que motivou toda essa conversa desde o início; hoje só existe
  o dado bruto (`opGapNaoExplicado`) sem agregação nenhuma.
- **Disponibilidade de linha** (% do tempo programado efetivamente
  rodando vs. parado) — já existe um cálculo parecido só no digest de
  e-mail de fim de turno (`disponibilidadePct`, `functions/index.js:767-802`),
  nunca virou indicador agregado por período.
- **Aderência ao apontamento** — quantas vezes o PCP precisou cobrar/
  intervir por falta de apontamento de fim de OP ou de parada de linha.
  Mede diretamente a hipótese do próprio usuário de que esse vai ser o
  gargalo real — com dado, não achismo.
- **Pareto de motivo de parada, agregado por período** — já existe por
  turno individual no e-mail de fechamento, nunca agregado por
  semana/mês/linha.
- **Setup real vs. padrão cadastrado, por linha** — acurácia da
  estimativa ao longo do tempo, alimenta a calibração do ML.
- **% de dias com "Fechamento do Dia" limpo** até o fim do expediente
  (sem pendência aberta) — ver seção 5.

Não é lista pra construir tudo de uma vez — prioriza junto com as fases do
sequenciamento, conforme o dado de cada uma for existindo.

## 5. Fechamento do Dia — resposta à pergunta em aberto

O usuário perguntou: hoje a produção do dia é apurada ao fim de todos os
dias — precisaríamos de um apontamento de produção diária no fim de cada
dia? Como o sistema ajuda a tornar isso rápido?

**Proposta: não deveria ser um formulário novo de digitação — deveria ser
um painel de conferência que já vem pré-preenchido** pelos pontos de
controle da seção 3 (início de turno, abertura/encerramento de cada OP,
fim de turno) mais paradas registradas via Andon. Se cada um desses eventos já
captura o dado corretamente ao longo do dia, "fechar o dia" vira uma
**leitura agregada**, não uma tarefa de digitar tudo de novo no fim: o
painel mostra, por linha, o que rodou, quanto produziu, quais paradas
foram registradas, quais OPs ficaram sem encerramento e por quê. O
trabalho humano do PCP no fim do dia passa a ser **confirmar e tratar
exceções** (ex: "por que a linha 2 ficou 40 minutos sem produção e sem
parada registrada?"), não preencher números do zero. Isso também é o que
alimentaria diretamente o KPI de "% de dias com Fechamento do Dia limpo"
acima.

## 6. Sequenciamento proposto

Cada fase depende do dado/decisão da fase anterior — seguir a ordem evita
retrabalho.

1. ✅ **Investigar por que o motor de replanejamento automático
   (`autoAjustarPlanejamento`) não produz efeito visível hoje** —
   **concluída**: achados os 4 bloqueios reais, todos corrigidos e
   deployados (ver seção 9). Falta só confirmar com o time, ao vivo, que
   o motor está de fato empurrando/adiantando slots agora que os
   bloqueios sumiram.
2. ✅ **Popular `dataInicioPlanejada`/`dataFimPlanejada` de verdade na
   emissão da OP** — **decidido**: manual (`ops.html`, seção 9) basta até
   a Fase 6. Auto-derivar de slots vinculados na emissão não compensaria
   o esforço agora — a mesma investigação da Fase 1 já mostrou que a
   maioria das OPs não tem slot vinculado (Horizonte pouco usado), então
   a auto-derivação ficaria ociosa na prática na maior parte das vezes.
   Retomar isso automaticamente já dentro do modelo de blocos por OP da
   Fase 6, onde o vínculo nasce confiável por construção.
3. **Apontamento nos pontos de controle** — **essencialmente concluída**:
   início de turno ✅, lista de Alocar OP por prioridade ✅ (trava dura
   movida pro backlog), clareza Intervalo×Parar linha ✅, paridade de
   recursos entre os 3 fluxos de Encerrar OP ✅ (perdas estruturadas +
   hint de ritmo + justificativa em Painel de Turno e Fechar Lote — ver
   seção 12; Apontamento por Total deliberadamente sem perdas, é
   atualização parcial por design). Reavaliado nesta revisão: 2 dos 3
   fluxos (Painel de Turno e Fechar Lote) já forçam `status:'Concluído'`
   diretamente hoje — a nota antiga desta seção ("só o Painel de Turno
   grava direto") estava desatualizada. Os 3 continuam estruturalmente
   separados por decisão (seção 10), não fundidos num só. Resta só
   polimento de baixo risco, documentado em `MELHORIAS_FUTURAS.md`
   (gap de fila offline na gravação de perdas, base de comparação da
   justificativa divergente entre Fechar Lote e Painel de Turno,
   recuperação de falha parcial em "Encerrar Turno" em lote) — não
   bloqueia a Fase 4, que já foi concluída.
4. ✅ **Alertas ao PCP**: OP não iniciada no horário programado + OP
   atrasada em andamento, 5min de tolerância inicial + repique a cada
   10min (cooldown próprio, não o padrão de 60min do sistema atual) —
   reaproveita o cron de 2 minutos já existente. **Concluída e
   deployada** (ver seção 14) — `checkOpsAtrasadas` reescrita pra
   reavaliar estado ao vivo em vez de consumir fila de eventos único.
5. ✅ **Somar paradas reais ao tempo estimado de conclusão da OP** — fecha
   gap de dado já existente, nunca usado. **Concluída e deployada** (ver
   seção 14) — não existia nenhum cálculo de ETA em lugar nenhum do
   sistema; construído do zero em `ops.html` (coluna informativa,
   read-only, ritmo produtivo descontando paradas reais do lote).
6. **Redesenho das duas telas de planejamento** (Quantidades / OPs),
   substituindo a TELA de Horizonte (não o pipeline `alocacoes_planejamento`,
   que é recablado, não descartado), com timeline de início/fim exatos.
   A tela de apontamento da produção passa a espelhar essa tela.
7. ✅ **Conclusão de OP gated por PCP** (100% manual no início).
   **Concluída e deployada** (ver seção 16) — a auto-conclusão silenciosa
   aos 95% (a causa raiz do problema original da sessão) foi eliminada
   de vez; só uma confirmação explícita do PCP em `ops.html` grava
   `status:'Concluído'` agora.
8. **Changeover configurável** com setup padrão inicial por linha, apurado
   a cada OP/dia.
9. **Fechamento do Dia** — painel de conferência agregado (seção 5).
10. **Dashboard de KPI agregado** (lista da seção 4, priorizada conforme
    dado disponível).
11. **Reavaliar Machine Learning**, só quando houver base de dado limpa
    suficiente.

## 7. Fora de escopo por ora

- **Apontamento de manipulação** — bloqueado por pré-requisito de
  processo (disciplina de pesagem no chão de fábrica). Ver
  `MELHORIAS_FUTURAS.md`.
- **Alertas sonoros na fábrica / notificação no celular do funcionário** —
  evolução futura do sistema de alertas, não MVP. Ver
  `MELHORIAS_FUTURAS.md`.
- **Ordens de Serviço (principais e de transformação), Roteiro de
  Produção condicional por SKU, gate de disponibilidade via "mínimo entre
  etapas", Estoque de Produto Acabado incremental, Faturamento parcial
  por acúmulo** — conceito grande, discutido e documentado em detalhe,
  adiado pra depois que o planejamento/PCP/apontamento acima estiver
  azeitado. Ver seção própria em `MELHORIAS_FUTURAS.md`.

## 8. Cautelas

- `horizonte.html` (a tela) pode ser substituída — não é usada. O
  pipeline `alocacoes_planejamento` por trás dela não pode: qualquer
  redesenho precisa manter (ou recablar deliberadamente) os pontos que
  hoje leem/escrevem nesse nó — badge de status na grade, resolução exata
  de lote por slot, cascata de cancelamento de OP (`ops.html:1211-1223`),
  preenchimento automático de linha/status de OPs em `auth_check.js`.
- Não presumir que código existente está funcionando só porque está no
  repositório — o caso do motor de replanejamento (Fase 1) é o exemplo
  concreto: existe, mas o usuário reporta que não produz efeito percebido.
  Confirmar comportamento real antes de reaproveitar.
- Sistema é usado ao vivo por produção todos os dias — nenhuma fase acima
  deve ser implantada sem teste prévio (harness/emulador local) e sem
  plano de rollback, mesmo padrão de cautela já seguido no resto desta
  sessão.

## 9. Progresso registrado (2026-08-28)

Nesta rodada, três agentes de auditoria rodaram em paralelo (read-only,
sem escrever código) sobre o núcleo de planejamento/OP/apontamento —
correção de bugs, UI/UX, e boas práticas/limpeza. Abaixo, o que já foi
corrigido e implantado, e o que fica mapeado pra retomar em cada fase.

### Já corrigido e em produção

- **Fase 2 concluída (parcial)**: `ops.html` ganhou edição manual de
  `dataInicioPlanejada`/`dataFimPlanejada` (coluna "Programação", só
  admin) — ponto de entrada pro PCP programar horário até as duas telas
  novas (Fase 6) existirem.
- **Causa raiz real do motor de replanejamento (Fase 1), achado crítico**:
  `exports.criarPedido` (`functions/index.js`) sobrescrevia
  `pedidos/{pedKey}` inteiro a cada resync do Gerador de Pedidos,
  apagando silenciosamente `linha`, `priority`, `dataProd`,
  `statusManual` (inclusive `'encerrado'` — um pedido fechado manualmente
  podia reabrir sozinho) e `ultimoApontamento`. Isso explica por que
  `pedidos/{key}.linha` nunca ficava populado de forma durável, mesmo
  quando corrigido manualmente. Corrigido com o mesmo padrão defensivo já
  usado em `criarOP` (preserva `existing.*`). **Deployado.**
- **Segundo achado, mesma investigação**: `autoAjustarPlanejamento`
  (`auth_check.js`) comparava `pedidoKey` sem normalizar zero à esquerda
  — helper pra isso já existia (`_kuryosNormalizePedidoKey`), só não
  estava aplicado nesse ponto. Corrigido. **Deployado.**
- **UI/UX — 2 achados corrigidos**: `.andon-btn` (Painel de Turno) sem
  altura mínima (~30px, abaixo do alvo de toque confiável) — agora
  `min-height:44px`. 3 blocos com cor hex fixa (`.parada-section`,
  `#scheduleBanner`, `#fPedidoIdLocked`/`#btnTrocarOP`) que ficavam quase
  brancos no dark mode — trocados por `color-mix()` sobre os tokens já
  usados no resto da página. **Deployado.**
- **`pedidos.html` — campo de linha fixo corrigido**: `<select id="fLinha">`
  só oferecia "Linha 1"/"Linha 2"/"Linha 3" no HTML; agora é preenchido
  dinamicamente via `config.linhas` (mesmo padrão de `fillProdutoSelect`
  no mesmo arquivo) — se uma linha for renomeada, o pedido continua
  batendo com o nome real na grade. **Deployado.**
- **Override manual de status de OP fica visível e reversível**:
  `updateOpField` (`ops.html`) grava `statusManualOverride:true` +
  quem/quando ao mudar status manualmente; `_syncOpsLoteStatusELinha`
  (`auth_check.js`) passa a respeitar essa flag em vez de sobrescrever
  silenciosamente. Badge "🔒 manual" + botão "🔓 liberar" devolve pro
  automático quando quiser. **Deployado.**
- **Fase 3, início de turno**: novo botão "▶️ Iniciar turno" no Painel de
  Turno (`form.html`) — confirma turno detectado + operador responsável,
  grava `turnosIniciados/{data}/{turno}`, badge visível quando já
  confirmado no dia. **Deployado.**
- **Fase 3, lista de "Alocar OP" ordenada por prioridade**: era só
  alfabética por lote; agora ordena pela `priority` do pedido comercial
  vinculado (mesmo campo que Horizonte/Planejamento/o motor de
  replanejamento já usam), com selo "💡 Próxima recomendada" na primeira
  da lista completa (não da lista filtrada pela busca). **Não é trava
  dura** — ver nota de escopo abaixo. **Deployado.**

### Mapeado pra retomar, por fase

**Fase 1 (motor de replanejamento) — os 4 bloqueios conhecidos já foram
corrigidos** (campo `pedidos.linha` nunca populado de forma durável,
comparação de `pedidoKey` sem normalizar, campo de linha fixo em
`pedidos.html`, override de status revertido silenciosamente). Resta só
um comportamento intencional a ter em mente, não um bug:
- Zona fixa de 7 dias (`config/congelamento.diasFixos`) protege da
  automação qualquer slot dentro da próxima semana — combinado com os
  achados acima, reforça a percepção de "nada muda" porque a semana
  corrente (o que a pessoa está olhando) fica fora do alcance do motor.
  Não é bug, é comportamento intencional, mas vale ter em mente ao
  avaliar se o motor "está funcionando" depois dos consertos.

**Fase 3 (apontamento nos pontos de controle):**
- ✅ Botão de "início de turno" — **feito** (ver seção "Já corrigido"
  acima).
- ✅ Lista de "Alocar OP" ordenada por prioridade + selo de recomendada —
  **feito**, mas só como guia visual, não trava dura. **Pendente real**:
  travar de verdade exigiria confiar em "qual linha essa OP deveria
  rodar", e o único campo que existe hoje pra isso (`ops.linha`) é
  sobrescrito toda vez que alguém aloca (reflete última alocação física,
  não programação) — travar contra ele esconderia OPs válidas ainda sem
  linha definida. Fica pra quando o modelo de blocos por OP da Fase 6
  existir, com vínculo OP↔linha confiável desde a programação.
- Existem **3 fluxos diferentes de "Encerrar OP"** hoje (Painel de Turno,
  Apontamento por Total, Fechar Lote/Modo Avançado) com rigor diferente —
  só um deles exige justificativa em caso de desvio e permite múltiplas
  perdas; o mais usado no dia a dia (Painel de Turno) é o que não tem
  trava nenhuma. Ao construir o apontamento simplificado desta fase, vale
  unificar num fluxo só, com a trava de justificativa portada pra ele.
- "☕ Intervalo" e "🛑 Parar linha" são visualmente parecidos mas fazem
  coisas bem diferentes (checkpoint parcial vs. parada de linha de
  verdade) — vale um rótulo mais claro ao reformular os pontos de
  controle.

**Fase 6 (redesenho das telas de planejamento) — oportunidade de já
resolver de vez:**
- Cluster inteiro de lógica de capacidade/turno (`dowToConfig`,
  `expandHourRange`, `horasEPausasDoDia`, etc.) duplicado byte-a-byte
  entre `horizonte.html` e `planejamento.html` — como as duas telas vão
  ser substituídas mesmo, a extração pra `shared/utils.js` deve acontecer
  naturalmente ali, não como um refactor separado agora.
  - **Achado colateral real**: dentro dessa duplicação, o fallback de
    ritmo zero diverge (`auth_check.js` usa `horasNecessarias = 1` quando
    ritmo é 0; as cópias em `planejamento.html`/`horizonte.html` usam
    `0`) — um risco de comportamento sutilmente diferente entre o motor
    de auto-ajuste e a UI que só existe por causa da duplicação.
  - "Programação Semanal Consolidada" e a grade diária não são usáveis em
    tela pequena hoje — se produção realmente consulta isso (confirmar),
    a Fase 6 já nasce pensando em cards por linha/dia, não tabela.
  - O simulador de capacidade de `horizonte.html` usa o mesmo componente
    visual dos dados reais, sem contraste forte indicando "isto é
    hipotético" — se algo equivalente sobreviver na tela nova, dar uma
    moldura visualmente distinta.
- `ops.html` reimplementa `normalizePedidoKey` como cópia local de
  `_kuryosNormalizePedidoKey` (já global via `auth_check.js`, carregado
  antes) — trocar pela função já existente, zero custo.
- Labels de formulário (`planejamento.html`, `form.html`) quase nunca têm
  `for=` ligando ao campo — mudança mecânica, baixo risco, ajuda toque e
  leitor de tela. Vale fazer ao reconstruir os formulários da Fase 6, ou
  antes se sobrar tempo.
- `alert()`/`confirm()` nativos do navegador quebram a consistência visual
  do resto do app (que já tem um padrão de modal customizado) — trocar
  por toast/modal no mesmo padrão ao tocar em cada fluxo.

Relatórios completos dos 3 agentes (achados descartados por não terem
ganho real, contexto adicional, arquivo:linha exato de cada ponto) ficam
só no histórico da conversa — o que está aqui já é o filtrado/priorizado
pra ação futura.

## 10. Segunda rodada de auditoria (2026-08-29) — achado crítico

Nova rodada de 3 agentes, focada nos 3 fluxos de "Encerrar OP" (que a
Fase 3 ainda vai unificar), na infra de notificação (base da Fase 4) e
nas telas base pras Fases 9/10 (`dashboard.html`, `historico.html`,
`dashboard_analise.html`).

### Já corrigido e em produção

- **🔴 CRÍTICO — double-count de produção nos 3 fluxos de Encerrar OP**:
  o delta de produção (quanto somar) era calculado FORA da transaction do
  Firebase, contra `opsCache` (cache local que pode estar desatualizado —
  por definição sempre que o apontamento vem da fila offline). Dois
  fechamentos concorrentes (ou um fechamento offline sincronizando depois
  de outro apontamento já ter avançado o servidor) cada um somava seu
  delta contra a MESMA base velha — resultado passava do total real,
  contaminando `ops/{lote}.produzidoLinha`, `pedidos/{pedKey}.produzido`
  (produção do pedido do cliente) e a baixa de estoque por consumo.
  Corrigido: os 3 fluxos já gravam o total realmente digitado em
  `registro.qtdTotalOP` — o delta agora é recalculado DENTRO da própria
  transaction, contra o valor ao vivo, correto mesmo com retry por
  conflito. **Deployado.** Ver `form.html` (`updateOpRecordOnApontamento`,
  `syncNextItem`).
- **`dashboard.html` — "Total do Dia" somava todos os setores juntos**:
  mesma classe de bug do achado acima, já documentada e corrigida em
  `pedidos.produzido` (caso real pedido 0022/Briá Beauty) mas nunca
  aplicada nesse KPI de topo. Corrigido com a mesma função de filtro que
  "Progresso do Envase" já usava corretamente (extraída pra escopo
  global, sem duplicar). **Deployado.**
- **`historico.html` — "% completo" da aba Por Pedido somava todos os
  setores juntos**, podendo passar de 100%. `isLinhaEnvase()` já existia
  nessa mesma página (usada certo em "Motivos Recorrentes"), só não
  estava aplicada aqui. **Deployado.**
- **`dashboard.html` — "Turnos do Dia" agora lê `turnosIniciados`**: o
  botão "Iniciar turno" (Fase 3) já gravava o dado, mas o painel de
  status ainda não lia — badges eram só inferidos pelo relógio. Novo
  estado "▶️ Iniciado" (hora + quem confirmou); "Em andamento" ganha
  "(sem confirmação)" quando ninguém confirmou o início. **Deployado.**

### Mapeado pra retomar, por fase

**Fase 3 (unificação dos 3 fluxos de Encerrar OP) — mapa do que preservar
e do que resolver:**
- Só o Painel de Turno grava `status:'Concluído'` direto; os outros dois
  dependem de `computeOpStatus()` (derivado, calculado só em leitura) —
  pré-requisito direto da Fase 7 (conclusão 100% manual pelo PCP), que
  hoje só funciona de verdade em 1 dos 3 fluxos.
- ~~Perdas: 3 formatos incompatíveis (texto livre no Painel de Turno vs.
  dropdown estruturado no Fechar Lote vs. nenhum campo no Apontamento por
  Total) — e o fluxo mais usado é o mais pobre, prejudicando qualquer
  Pareto futuro (tudo cai em "Outro").~~ **Resolvido (ver seção 11):**
  Painel de Turno agora usa o mesmo formato estruturado do Fechar Lote
  (tipo + material específico, com baixa de estoque). Apontamento por
  Total continua sem perda, por design (é um update parcial que
  deliberadamente não força conclusão).
- `salvarPerdaOP` (Painel de Turno) — renomeada `salvarPerdasEncerrarOP`
  na seção 11 — continua sendo a única gravação de perda que não passa
  pela fila offline (`queueOfflineWrite`) — falha silenciosa se confirmar
  sem conexão. Segue não resolvido.
- O write que limpa `abertaDesde`/`abertaLinha` ao encerrar também
  bypassa a fila offline — se fechar offline e o app fechar antes de
  reconectar, a OP fica "aberta" pra sempre, bloqueando a linha.
  "Encerrar Turno" (fechamento em lote) não tem recuperação de falha
  parcial — um item falhando rejeita o lote inteiro sem rollback dos que
  já commitaram.
- Justificativa de desvio (Fechar Lote) compara contra uma base diferente
  do % mostrado no Painel de Turno (`qtdEsperada` do bloco de alocação vs.
  `qtdPlanejada` da OP) — escolher 1 base ao unificar.
- ~~Diferencial real a preservar (não é sobre rigor, é sobre qualidade de
  informação): hint de ritmo real (un./h) antes de confirmar, hoje só no
  Apontamento por Total.~~ **Resolvido (ver seção 11):** Painel de Turno
  agora também mostra o hint em tempo real.
- `escTurno` duplicava `escapeHtml` — já corrigido (ver seção 9).

**Fase 4 (alertas) — achado que muda o desenho:**
- `checkOpsAtrasadas` consome uma fila de eventos ÚNICOS
  (`alertas_pendentes`, gerada só quando um apontamento fecha) e
  DESCARTA cada entrada depois de processar, mandando e-mail ou não. Não
  há reavaliação contínua. **O alerta de "repique a cada 10min enquanto
  o desvio persistir" não funciona construído em cima disso** — se
  ninguém fechar um novo apontamento, nada dispara de novo, exatamente o
  cenário que a Fase 4 mais precisa cobrir (apontamento não acontecendo).
  Precisa do padrão de `checkLinhasParadas` (reavalia o estado AO VIVO a
  cada tick do cron de 2min), não o padrão de fila de eventos.
- `cooldownOk`/`markSent` já aceita janela customizada (ver seção 9), mas
  o check-then-write não é atômico — duas execuções do cron sobrepostas
  (`onSchedule` sem `maxInstances`) podem ambas ler cooldown-OK antes de
  qualquer uma escrever `markSent`, mandando e-mail em dobro. Mais
  provável de acontecer porque `getGraphToken()` busca token OAuth novo a
  cada e-mail individual (sem cache), alongando runs com vários alertas.

**Fase 9/10 (Fechamento do Dia / KPI) — mapeamento útil:**
- `dashboard.html` já tem quase toda a base estrutural do Fechamento do
  Dia (navegação por data, "Turnos do Dia", "Lançamentos por OP/Posto",
  Andon ao vivo, card de Paradas) — não é greenfield. Sugestão: nasce como
  novo card "Pendências do dia" NESTA tela (linha parada X min sem
  parada registrada, OP que devia ter fechado e não fechou), não uma tela
  nova desconectada.
- Duas fontes de paradas divergentes, nunca reconciliadas: `op.paradas`
  (embutido, só existe após a OP concluir) vs. `paradas_historico`
  (coleção separada, mais madura, já é o que o dashboard usa). Padronizar
  em `paradas_historico` ao construir qualquer Pareto agregado.
- `dashboard_analise.html` é o lugar certo pro dashboard de KPI (Fase
  10) — mas as abas "Logística" e "OPs" mostram dado **congelado desde
  18/05/2026** (blob JSON estático embutido, +3 meses desatualizado hoje).
  **Nunca plugar KPI novo nessas duas abas** — só nas que já reconstroem
  ao vivo (Visão Geral/Produção/Pedidos), sob risco real de alguém achar
  que está vendo dado atual.
- "Eficiência por linha" (aba Produção) é *throughput* (un./h), não
  *rendimento* (produzido ÷ planejado) que a Fase 10 pede — métricas
  diferentes, não reaproveitar um pelo outro.
- Status de pedido em `dashboard_analise.html` usa `p.status || 'Não
  Iniciado'` bruto, divergente de `isConcluido()` (global,
  `shared/utils.js`) que `dashboard.html`/`historico.html` já usam — o
  mesmo pedido pode aparecer com status diferente em telas diferentes ao
  mesmo tempo. Trocar pela função global ao tocar essa tela.
- "Motivos Recorrentes" (`historico.html`) é o protótipo mais próximo do
  Pareto de paradas da Fase 10 — grão errado (período arbitrário, não
  turno/dia/semana) e fonte errada de paradas (ver acima), mas a lógica
  de agregação por motivo já funciona e é reaproveitável.

Relatórios completos desta rodada (achados descartados, contexto
adicional, arquivo:linha exato) ficam no histórico da conversa.

## 11. Terceira rodada de auditoria (2026-08-29)

Agente validou os fixes da 2ª rodada (todos confirmados corretos, sem
regressão) e varreu o que ainda não tinha sido auditado nesta sessão
(`planejamento.html`, `horizonte.html`, `compras.html`, `insumos.html`,
`shared/utils.js`) mais um novo achado nos próprios arquivos já tocados.
Em paralelo, o enriquecimento do Painel de Turno (Fase 3, mapeado na
seção 10) foi concluído.

### Já corrigido e em produção

- **🔴 CRÍTICO — apontamento horário normal (`syncNextItem`, branch
  `item.type === 'registro'`, o fluxo mais usado do app) rodava
  fire-and-forget**: `updateOpRecordOnApontamento(...)` era chamada sem
  `return` e fora do array `saves` — `Promise.all(saves)` resolvia (e o
  item saía da fila offline local) sem esperar a transaction de
  `ops/{lote}` committar. Se a aba fechasse/recarregasse nesse
  meio-tempo (comum em tablet de chão de fábrica), o incremento de
  `produzidoLinha` se perdia silenciosamente e o item já tinha sumido da
  fila — sem erro, sem retry possível. Mesma classe do achado crítico já
  fechado na 2ª rodada em `apontamento_total`/`fechamento_op`, agora
  fechada também aqui. **Deployado.**
- **`dashboard.html`/`historico.html` — mais 4 double-counts da mesma
  classe** (soma Linha+Rotulagem+Posto onde só envase deveria contar,
  usando `isLinhaDeProducao`/`isLinhaEnvase` já existentes):
  `updateStackedMetas()` (barras Hoje/Semana/Período PCP), `renderProdutos`/
  `renderColaboradores` (numerador vinha de `regs` cru contra um
  denominador `total` já filtrado, desde o fix parcial da 2ª rodada —
  podia passar de 100%), `renderLotes` ("Por Lote" inflado), e
  `historico.html`'s `updateStats()` (stat "Produzido" do topo). Todos
  **deployados**.
- **Fase 3 — Encerrar OP do Painel de Turno enriquecido** (o fluxo mais
  usado do dia a dia, que era o mais pobre): perdas estruturadas (tipo +
  material específico, com baixa de estoque automática — o campo texto
  livre antigo nunca descontava estoque), hint de ritmo em tempo real
  (mesmo cálculo do Apontamento por Total, generalizado por setor), e
  justificativa obrigatória quando a quantidade diverge de
  `op.qtdPlanejada` (mesmo padrão de `opForm`, agora também suportado por
  `fecharAlocacaoOP` via `opts.justificativa` →
  `registro.justificativaDivergencia`). **Deployado.** Os 3 fluxos
  continuam estruturalmente separados (decisão já tomada, seção 10) — só
  os recursos foram nivelados.

### Mapeado pra retomar

- **`insumos.html` — `executeBatchAllocation` (Alocação em lote de
  recebimento) e `recvModalSave` (recebimento manual pontual)**: delta
  de `qtdRecebida` calculado fora de `.transaction()`, contra uma leitura
  (`.once('value')`) que pode já estar velha quando o `db.ref().update()`
  final escreve o valor absoluto. Mesma classe do achado crítico já
  corrigido em produção física, aplicada ao controle de
  insumos/embalagens — não contamina estoque físico nem produção (por
  isso não foi corrigido nesta rodada, junto dos outros), mas pode
  sobrescrever silenciosamente um recebimento manual feito por Compras
  enquanto o PCP revisa uma alocação em lote do mesmo insumo. Precisa de
  um ciclo próprio: migrar os dois pontos pra `.transaction()`
  recalculando o delta contra o valor ao vivo (mesmo padrão já usado em
  `updateOpRecordOnApontamento`), com teste dedicado antes de ir pra
  produção — tela usada por Compras, não só PCP, então qualquer regressão
  aqui afeta outro time.
- Checados e sem achado nesta rodada: `planejamento.html`/`horizonte.html`
  (`.transaction()` em `programacao/...` — compare-and-swap correto),
  `compras.html` (todos os `.transaction()` corretos), `shared/utils.js`
  (`ajustarEstoque`/`baixarEmpenho`/`liberarEmpenhoLote`/
  `empenharMateriais` — deltas sempre calculados dentro da transaction),
  `ops.html` (sem `.transaction()` no arquivo; `.update()`s escrevem
  campos absolutos/flags, não somas).

## 12. Quarta rodada de auditoria (2026-08-29)

3 agentes em paralelo, território novo: `produtos.html`, `usuarios.html`,
`login.html`, `admin.html`, `dashboard_analise.html`, `database.rules.json`,
mais uma revisão de UX com olhos frescos no modal "Encerrar OP" recém
enriquecido (seção 11).

### Já corrigido e em produção

- **🔴 SEGURANÇA CRÍTICA — `database.rules.json` vazava dados de RH pra
  qualquer usuário autenticado e permitia escalação de privilégio**: o
  nó raiz tinha um fallback `.read`/`.write` que, por como o Firebase
  RTDB cascateia permissões (um ancestral concede acesso que nenhum
  filho consegue revogar), anulava silenciosamente as restrições
  cuidadosas dos nós `rh_*` — qualquer login (inclusive
  production/rotulagem) conseguia ler avaliações de desempenho e dados
  de férias de toda a empresa direto pelo console do navegador.
  Separadamente, `usuarios/{uid}/role` permitia que `pcp` escrevesse o
  papel de qualquer usuário, inclusive o próprio — self-promotion pra
  `admin`, que por sua vez também vazava RH via o mesmo fallback.
  Removido o fallback (conferido antes: todo nó realmente usado pelo app
  já tinha regra própria explícita, nada dependia dele) e removido `pcp`
  da escrita de `role`. **Deployado** (`firebase deploy --only
  database`, syntax check do Firebase passou).
- **`login.html`**: aviso de "conta pendente de ativação"
  (`showFeedback('warning', ...)`) aparecia com a cor/classe de
  "sucesso" (verde) — usuário podia achar que deu tudo certo quando na
  verdade está bloqueado. Nova classe `.feedback-message.warning`.
  Escrita do perfil após criar a conta não tinha `.catch()` próprio —
  falha nessa escrita virava unhandled rejection, sem mensagem nenhuma
  pro usuário. **Deployado.**
- **`usuarios.html`**: usuário com papel `pcp` (link "Usuários" visível
  pra ele no menu) ficava vendo "Carregando..." pra sempre — só `admin`
  de fato carregava a tabela, sem nenhum aviso de que era uma restrição
  de acesso, não um bug de carregamento. **Deployado.**
- **Modal "Encerrar OP" (Painel de Turno) — 4 melhorias de UX** vindas da
  revisão com olhos frescos no que foi construído na seção 11: não abre
  mais "cego" (quantidade pré-preenche com o já produzido, hint de
  ritmo já calculado ao abrir, mesmo padrão do modal irmão); referência
  "Planejado: X un." fica visível em qualquer estado do hint (antes
  sumia assim que o operador digitava algo, bem na hora em que o campo
  de justificativa aparece por essa mesma divergência); hint ganha o
  mesmo sufixo explicativo do modal irmão; botão de confirmar troca de
  texto durante o salvamento (antes só desabilitava, sem sinal visível).
  **Deployado.**

### Mapeado pra retomar (detalhado em `MELHORIAS_FUTURAS.md`)

- `admin.html` — `saveConfig()` regrava o nó `config` inteiro a cada
  edição (`.set()` em vez de `.update()` escopado): duas edições
  concorrentes em `config` (de `admin.html`, `planejamento.html` ou
  `cadastros.html`) podem se sobrescrever silenciosamente. Confirmado
  por 2 agentes independentes — merece ciclo próprio (~10 pontos de
  chamada pra corrigir, tela mais usada de configuração global).
  Encerrar OP (Painel de Turno) — mensagem de erro ambígua quando só a
  gravação de perdas falha depois da OP já ter encerrado de verdade.
- Acessibilidade: zero `<label for=>` em `admin.html`/
  `dashboard_analise.html`, cores hardcoded ignorando tema escuro em
  ambos, dropdowns multi-seleção sem fechar com Esc — varredura pendente,
  mecânica mas espalhada.
- Limpeza: `produtos.html`/`clientes.html`/`formulas.html`/
  `materiais.html` são stubs de redirect carregando ~1000 linhas mortas
  cada por trás; `admin.html` tem 2 listas de config sem nenhum
  consumidor (`config.produtos`/`config.operadores`) e uma função morta
  (`calcDias`).
- `dashboard_analise.html`: blob JSON de 316 KB sempre parseado mesmo
  sem abrir as abas que o usam, 5 leituras Firebase seriais que
  poderiam rodar em paralelo, `renderAll()` com ~610 linhas fazendo 5
  domínios de negócio numa função só. Aviso de "dados congelados" já
  está visível na UI (confirmado, sem ação necessária).

## 13. Quinta rodada de auditoria (2026-08-29)

2 agentes em paralelo, com atenção redobrada a segurança por causa do
achado crítico da 4a rodada: `auth_check.js`, `functions/index.js`,
`cadastros.html` (o arquivo grande que hospeda a lógica real de
Materiais/Clientes/Fornecedores/Produtos/Categorias — os separados
`produtos.html`/`clientes.html`/`materiais.html`/`formulas.html` são só
stubs de redirect pra cá), `logistica.html`, `emitir_op.html`.

### Já corrigido e em produção

- **🔴 SEGURANÇA CRÍTICA — o fix da 4a rodada em `usuarios/{uid}/role`
  não fechou a autopromoção de verdade**: o commit anterior removeu
  `pcp` da regra ANINHADA de `role`, mas a regra do NÓ PAI
  (`usuarios/{uid}`) já concedia `.write` completo a `auth.uid == $uid`
  (o próprio usuário, sem checar papel nenhum) — e regras do Firebase
  RTDB cascateiam de forma só-permissiva (uma regra mais profunda nunca
  consegue restringir o que uma ancestral já concedeu, mesmíssimo
  mecanismo do achado raiz da 4a rodada, só que desta vez dentro do
  próprio nó `usuarios`). Na prática, **qualquer usuário autenticado**
  (inclusive um cadastro recém-criado com papel `pending`) conseguia
  rodar uma chamada direta no console do navegador e virar `admin`
  instantaneamente — a correção anterior fechou só metade do buraco
  (`pcp` promovendo terceiros), não a autopromoção via `auth.uid==$uid`,
  que sempre esteve aberta. Corrigido de vez movendo a lógica pro nó que
  realmente concede a permissão: agora só permite (a) o próprio usuário
  criar seu nó pela primeira vez (`!data.exists()`, cobre o cadastro em
  `login.html`) ou (b) `admin` escrever em qualquer nó, a qualquer
  momento (cobre `updateUserRole` em `usuarios.html`, já admin-gated no
  cliente). `pcp` removido de vez do write de `usuarios/` — confirmado
  via grep que nada mais dependia disso. Verificado com truth-table de 9
  cenários em Node antes do deploy. **Deployado** (`firebase deploy
  --only database`, syntax check do Firebase passou).
- **`cadastros.html` (Clientes) — código editável desalinhava a chave
  interna silenciosamente**: `editingKey` (chave Firebase) nunca muda,
  mas o campo `codigo` era livremente editável e vira `clienteKey` do
  produto + path do contador de SKU. Mudar o código depois de já ter
  produto cadastrado desalinhava os dois sem nenhum erro visível.
  Trava o campo após salvo, mesmo padrão já usado em Materiais
  (`fTipo.disabled = !!key`). **Deployado.**
- **`cadastros.html` (Fórmulas/BOM/Especificações) — única área do
  arquivo sem nenhum tratamento de erro**, justamente a mais sensível
  (entra direto na emissão de OP). Remover/salvar item de fórmula,
  remover/salvar item de BOM, remover/salvar ensaio e o toggle
  "Revisado" agora mostram erro visível quando a escrita falha, em vez
  de sumir silenciosamente. **Deployado.**

### Mapeado pra retomar (detalhado em `MELHORIAS_FUTURAS.md`)

- Decisão pendente com o usuário: `auth_check.js` bloqueia por página,
  mas `database.rules.json` não bloqueia por papel os mesmos dados de
  negócio (materiais/clientes/fornecedores/compras/estoque) — qualquer
  papel autenticado lê esse dado inteiro via SDK direto. Diferente do
  achado de RH (dado pessoal + escalação, já corrigido), aqui é dado de
  negócio interno — confirmar se a equipe pequena/confiável torna isso
  aceitável ou se vale fechar por papel também.
- `functions/index.js`: comparação de API key não constant-time, sem
  cap em `itens[]` de `criarPedido` — ambos baixo risco.
- `cadastros.html`: races de baixo risco em toggles/arrays sem
  `.transaction()` (Revisado de Fornecedores/Fórmulas, Categorias);
  performance da aba Fórmulas/BOM (listeners não escopados por
  produto/versão, editar qualquer fórmula re-renderiza tudo em toda
  sessão aberta, mesmo em background).
- `emitir_op.html`: substituição de material usa `prompt()` nativo em
  vez do padrão de autocomplete do resto do app — único ponto da
  emissão de OP com esse padrão mais sujeito a erro de digitação.
- Acessibilidade: `cadastros.html`/`logistica.html`/`emitir_op.html`
  confirmam o mesmo padrão de rodadas anteriores (zero `label for=`,
  sem Escape pra fechar modal) — mesma varredura pendente já mapeada.
- Checado e sem achado: `functions/index.js` no geral (API key via
  secret, revalidação de papel no servidor mesmo em `onCall`
  autenticado, sem segredo hardcoded, sem vazamento de stack trace);
  `logistica.html`/`emitir_op.html` estruturalmente (já têm várias
  correções documentadas em comentários de rodadas anteriores);
  `cadastros.html` CRUD principal de Materiais/Produtos/Fornecedores
  (tratamento de erro consistente, sem XSS, sem hard-delete órfão).

## 14. Fase 4 concluída — alertas de OP atrasada (2026-08-29)

Instrução do usuário: seguir sem parar até finalizar o plano inteiro.
Antes de avançar, revisão da Fase 3 confirmou que ela está
essencialmente concluída (ver nota atualizada na seção 6) — os itens
restantes são polimento de baixo risco, já no backlog, não bloqueiam.
Fase 4 implementada, testada e deployada:

- **`functions/index.js` — `checkOpsAtrasadas` reescrita por completo**,
  saindo do padrão de fila de eventos único (`alertas_pendentes/`) pro
  padrão de reavaliação de estado ao vivo a cada tick do cron de 2min
  (mesmo desenho de `checkLinhasParadas`), com tolerância de 5min pra
  primeira notificação e repique a cada 10min enquanto o desvio
  persistir (`cooldownOk(key, 10)`, cooldown próprio — não o padrão de
  60min do resto do sistema).
- **Dois sinais independentes**, cada um cobrindo um cenário que o
  outro sozinho não cobre:
  1. `ops/{lote}.dataInicioPlanejada`/`dataFimPlanejada` (programação
     manual do PCP em `ops.html`, Fase 2) — "OP não iniciada no
     horário" (ninguém abriu na linha/rotulagem, nem há produção) e
     "OP ainda aberta depois do término previsto". Só avalia OPs que
     TÊM plano — a maioria ainda não tem (Horizonte pouco usado), então
     essas nunca disparam esse alerta especificamente: sem plano, sem
     base pra cobrar.
  2. `pedidos/{key}.desvioAtraso` — **novo estado ao vivo**, gravado por
     `autoAjustarPlanejamento` (`auth_check.js`) toda vez que o ritmo
     real de um pedido fica pior que o planejado a ponto de faltar mais
     horas do que faltariam no ritmo planejado, além do limiar
     configurável em `admin.html` (`config.opAtrasoHoras` — campo que
     já existia na UI mas estava órfão desde que essa lógica só
     empurrava um evento único pra `alertas_pendentes/`, nunca mais
     consumido depois desta mudança). Preserva o timestamp da PRIMEIRA
     detecção entre replanejamentos sucessivos (o motor roda a cada
     apontamento fechado — sem preservar, a tolerância de 5min do
     servidor nunca completaria) e limpa o campo quando o desvio se
     resolve, evitando alerta perpétuo. Cobre OPs sem
     `dataFimPlanejada` também, já que se baseia no ritmo do pedido —
     hoje tem cobertura maior que o sinal 1.
- Testado antes do deploy: `node --check` nos 2 arquivos; harness Node
  rodando o bloco REAL de `checkOpsAtrasadas` extraído do arquivo (24
  asserções, cobrindo os 2 sinais isolados e combinados, tolerância de
  5min, repique real após 10min simulando o avanço do relógio, OPs
  concluídas/canceladas ignoradas, OPs sem plano nunca gerando falso
  positivo); lógica de gravar/preservar/limpar `desvioAtraso` testada
  isoladamente (6 asserções). **Deployado** (`firebase deploy --only
  hosting` + `firebase deploy --only functions:checkNotificacoes`,
  ambos confirmados com sucesso).

**Fase 5 também concluída na sequência** (mesmo dia, instrução do
usuário: "só encerre quando finalizar tudo"):

- Não existia nenhum cálculo de ETA/previsão de término em lugar nenhum
  do sistema pra somar as paradas a ele — construído do zero em
  `ops.html`, na tabela de OPs Emitidas em Aberto (coluna informativa,
  100% read-only, não escreve nada, não afeta apontamento/estoque).
- `minutosParadasDoLote(lote, desdeISO)`: soma a duração das paradas
  registradas pra esse lote com início dentro da janela
  `[desdeISO, agora]` — via novo listener em `paradas_historico`.
- `previsaoTerminoHtml(op)`: ritmo PRODUTIVO real = produzido ÷ (horas
  decorridas desde a abertura MENOS as paradas descontadas). Sem isso,
  uma OP com paradas longas mostraria ritmo pior do que o real (tempo
  parado contando como produção lenta) e uma previsão mais
  pessimista/errada do que deveria. Amostra mínima de 0.1h produtivas
  antes de projetar, evita previsão maluca com pouquíssimo dado.
- Testado: harness Node rodando o bloco real extraído do arquivo (12
  asserções, todas OK). **Deployado.**

**Próxima fase**: Fase 6 (redesenho das duas telas de planejamento,
substituindo Horizonte) — a maior do roteiro, vai exigir planejamento
cuidadoso antes de codar (schema de dados, o que exatamente cada tela
mostra, como o pipeline `alocacoes_planejamento` existente é recablado
em vez de descartado). Trabalho em andamento, ver próxima seção quando
existir.

## 15. Fase 6 — mockup pra revisão antes de construir (2026-08-29)

Diferente das fases anteriores (bugs/features contidas, risco baixo,
reversível), a Fase 6 é a maior do roteiro e a mais arriscada de
construir às cegas: 2 telas novas que a equipe vai usar todo dia,
substituindo um fluxo hoje quebrado (Horizonte). Errar o conceito aqui
custa muito mais do que errar um fix pontual. Por isso, antes de investir
o tempo de construção de verdade, um mockup visual concreto no estilo
real do app (não um wireframe genérico) foi publicado pra revisão:
[link do mockup — pedir ao usuário se precisar recuperar].

**O que o mockup mostra**, já respeitando as decisões da seção 3:

- **Planejamento de Quantidades** (substitui a lógica de "Congelar
  Semana" do Horizonte): fila de pedidos por prioridade com % já
  alocado, alocação em formulário simples com data/hora de início EXATA
  (não slot de hora cheia) e prévia do término calculado
  (`qtd ÷ ritmo`, minutos exatos, sem arredondar) — grava em
  `alocacoes_planejamento` (mesmo pipeline, `status:'congelado'`, campos
  novos `inicioPlanejado`/`fimPlanejado`). Lista de blocos já alocados
  embaixo, pra contexto.
- **Planejamento de OPs**: timeline por linha PROPORCIONAL à duração
  real (não coluna-por-hora igual a Grade Semanal atual), um bloco por
  OP emitida (não por pedido), cor por status (em produção/concluída/
  programada/atrasada), linha do "agora" — o Painel de Turno passaria a
  espelhar esses mesmos blocos em vez de manter uma lista separada.

**Decisão técnica de dado, já validada pela leitura do código
existente**: o pipeline `alocacoes_planejamento`/`necessidadeCodigo`/
`linkAlocacaoToOP` (`functions/index.js`) e `programacao/{date}/{hora}/
{slot}` (consumido por `planejamento.html`) continuam existindo — a
Fase 6 ESTENDE `alocacoes_planejamento` com `inicioPlanejado`/
`fimPlanejado` exatos (novos campos) e continua preenchendo
`programacao` em paralelo, best-effort, só pra não quebrar os 3
consumidores existentes (Grade Semanal, `linkAlocacaoToOP`,
`writeLoteIntoWeekSlots`). Nada é descartado, só ganha uma UI nova e um
grau de precisão maior.

**Por que parar pra mockup em vez de construir direto**: construir a
capacidade/priorização de pedidos do zero seria redundante e arriscado
— a lógica de `horizonte.html` (`computeAndRender`, matriz de
capacidade por linha/semana, ordenação por prioridade) já é testada e
funciona; o problema reportado pelo usuário foi a TELA, não a conta. A
estratégia de implementação (quando aprovada) é reaproveitar essa lógica
de cálculo e só trocar a camada de apresentação/interação — não
reescrever a capacidade do zero.

**Enquanto aguarda validação do mockup**, trabalho seguiu nas fases
seguintes do roteiro (7 em diante), que não dependem de nenhuma decisão
de UI ainda em aberto.

## 16. Fase 7 concluída — conclusão de OP 100% manual pelo PCP (2026-08-29)

Decisão já registrada na seção 3, mas o MECANISMO exato tinha duas
leituras possíveis do texto ("100% manual pelo PCP, sem exceção") —
confirmado de novo com o usuário antes de tocar o código, dado o
tamanho do impacto (muda a rotina diária de fechamento de OP nas 3
linhas). Duas opções apresentadas: (a) só remover a auto-conclusão
silenciosa aos 95%, operador continua fechando normalmente; (b) só o
PCP pode marcar 'Concluído' de verdade, operador fecha mas fica
"aguardando confirmação". **Escolhida a opção (b)**, mais fiel ao texto
literal do plano.

- **`shared/utils.js` (`computeOpStatus`)**: nunca mais deriva
  'Concluído' sozinho. Bater 95% agora deriva `'Aguardando Confirmação'`
  (novo status), que é "pegajoso" igual 'Concluído' já era (a função
  nunca reverte de volta).
- **`shared/utils.js` (`opEstaAtiva`)**: `'Aguardando Confirmação'`
  conta como "não ativa" — a linha já foi liberada, não deve mais
  aparecer em Alocar OP/Andon/etc.
- **`auth_check.js` (`_syncOpsLoteStatusELinha`)**: mesma correção
  replicada na varredura que roda a cada carga de página (tinha sua
  própria cópia paralela da lógica de 95%).
- **`form.html`**: os 2 fluxos que forçavam `status:'Concluído'`
  diretamente (Painel de Turno "Encerrar OP" e "Fechar Lote") agora
  gravam `'Aguardando Confirmação'` — quem fecha na linha registra o
  resultado final e libera a linha, mas não conclui mais sozinho.
  Mensagens de sucesso avisam isso ao operador. "Apontamento por Total"
  já não forçava conclusão antes (por design), sem mudança.
- **`ops.html`**: nova seção "⏳ Aguardando Confirmação do PCP" na
  tabela — sem ela, essas OPs ficariam invisíveis (opEstaAtiva as tira
  de "OPs Emitidas em Aberto"). Botão "✅ Confirmar conclusão" — a única
  ação em todo o sistema que grava `status:'Concluído'` de verdade
  agora — disponível pra `admin` e `pcp` (`canConfirmOp`, papel novo,
  distinto do `isAdmin` já usado no resto do arquivo). Registra
  `confirmadoPor`/`confirmadoEm`.
- **`functions/index.js` (`checkOpsAtrasadas`, Fase 4)**: corrigido pra
  também ignorar OPs `'Aguardando Confirmação'` — sem isso, uma OP
  recém-fechada podia gerar alerta falso de atraso mesmo já tendo
  liberado a linha.
- **`dashboard.html`**: tag "OP concluída" no feed de atividade não
  presume mais que todo fechamento é uma conclusão de verdade — reflete
  o status real.

Testado: harness Node com os blocos reais extraídos de cada arquivo
(computeOpStatus/opEstaAtiva, fecharAlocacaoOP, o branch fechamento_op,
canConfirmOp/confirmarConclusaoOp/renderOpAguardandoConfirmacaoRow,
checkOpsAtrasadas) — cobrindo o caso crítico (99% produzido nunca mais
vira Concluído sozinho), o "pegajoso" (não regride depois de
confirmado), e o controle de acesso (production não confirma nem
chamando a função direto). **Deployado** (hosting + functions).

**Gap conhecido, não corrigido** (fora de escopo, mesmo padrão de todo
o resto do app): o controle de quem pode confirmar é só client-side —
`database.rules.json` não distingue por-campo dentro de `ops/`
(`production` também tem escrita geral nesse nó). Mesmo nível de
proteção que toda outra trava admin-only já existente (cancelar OP,
editar linha/pedido).

**Próxima fase**: Fase 8 (changeover configurável).
