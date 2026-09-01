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
8. ✅ **Changeover configurável** com setup padrão inicial por linha,
   apurado a cada OP/dia. **Concluída e deployada** (ver seção 17) — o
   "apurado a cada OP/dia" fica coberto pelo próprio tempo MEDIDO
   (`setupInicio`/`setupFim`, já existia, agora mostrado); o "padrão
   inicial" é o novo fallback configurável em `admin.html`.
9. ✅ **Fechamento do Dia** — painel de conferência agregado (seção 5).
   **Concluída e deployada** (ver seção 18) — card novo em `dashboard.html`,
   uma linha por linha de produção, cruzando produção×meta, paradas do
   dia e OPs em "Aguardando Confirmação" (essa última sem filtro de
   data — é pendência até alguém agir).
10. ✅ **Dashboard de KPI agregado** (lista da seção 4, priorizada conforme
    dado disponível). **Concluída e deployada** (ver seção 19) — nova
    aba "Indicadores PCP" em `dashboard_analise.html` com os 3 KPIs que já
    tinham dado pronto sem captura nova (pontualidade de início,
    rendimento produzido÷planejado, pareto de motivo de parada); os 4
    restantes da lista da seção 4 ficam pra quando o dado que dependem
    existir/amadurecer.
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

**Próxima fase, à época**: Fase 8. Retomado o trabalho na Fase 6 logo
em seguida (ver seção 17) depois de fechar o desenho com o usuário.

## 17. Fase 6 — desenho final aprovado + fundação de backend concluída (2026-08-29/30)

4 rodadas de mockup (seção 15/16) até o desenho fechar com o usuário.
**Desenho final**:

- **As duas telas usam a MESMA interface** — a Grade Semanal que já
  existe hoje (`planejamento.html`: `.gantt-grid`/`.gantt-block` com
  `grid-column: X / span Y` proporcional à duração em horas, dia-tabs,
  navegação por semana E por dia — `btnPrevDay`/`btnNextDay`, que já
  existiam e ficaram de fora do 1o mockup por engano — e o "🗓️ Resumo
  Semanal por Linha", mantido). A "📋 Programação Semanal Consolidada"
  (tabela plana separada) fica de fora — confirmado que não é usada.
- **Planejamento de Quantidades** = a Grade de hoje, sem mudança
  estrutural — é onde o PCP aloca (clica numa célula vazia, escolhe
  pedido, define linha/horário/quantidade), blocos representam
  quantidade planejada por pedido.
- **Planejamento de OPs** = a MESMA grade, mas é só um resultado visual
  (somente leitura) — blocos são OPs de verdade (uma vez emitidas, não
  pedidos), com o tempo de setup/limpeza entre uma OP e a próxima na
  mesma linha aparecendo como um bloco hachurado entre elas (mesmo
  padrão visual já usado hoje pra pausa de turno, `.gantt-cell-pausa`).
  Alimenta a Fase 8 (changeover) com um lugar pra mostrar esse tempo.
- **Achado crítico do usuário, corrigido antes de ir mais longe**: um
  pedido planejado por quantidade (ex: 10.000 un.) na prática vira N OPs
  emitidas (ex: 10 de 1.000) — o vínculo `alocacoes_planejamento`↔OP
  (`linkAlocacaoToOP`) era BINÁRIO (1 alocação aceita só 1 OP), a 2a OP
  emitida contra o mesmo bloco não achava mais nada disponível. **Já
  corrigido e deployado**, ver detalhe técnico completo no commit
  `909d89e` — resumo: `alocacoes_planejamento/{id}` ganha `qtdConsumida`
  + `opsVinculadas` (mapa, substitui o campo único `opLote`), `status`
  só vira `'vinculado'` quando o total é 100% consumido por todas as OPs
  do bloco; `writeLoteIntoWeekSlots` preenche só os slots de hora
  suficientes pra cobrir CADA OP (não mais todos de uma vez), pra não
  "roubar" visualmente os slots das próximas OPs do mesmo bloco. Testado
  com harness Node (24 asserções) simulando exatamente o cenário de
  10.000un→10 OPs de 1.000, incluindo a distribuição correta dos slots
  de hora entre elas. Consumidores ajustados: `cancelOp` (ops.html,
  desvincula só a OP cancelada, não a alocação inteira),
  `_syncOpsLoteStatusELinha`/`autoAjustarPlanejamento` (auth_check.js),
  "Necessidades de Emissão" (horizonte.html).

### Implementado e deployado (2026-08-30)

- ✅ **"Planejamento de Quantidades"**: aba "Grade Semanal" de
  `planejamento.html` renomeada — mesma tela, mesmo comportamento,
  zero mudança estrutural (era basicamente isso mesmo, só faltava o
  nome bater com o resto do plano).
- ✅ **"Planejamento de OPs"**: nova aba em `planejamento.html`, mesma
  interface (mesmo `.gantt-grid`/`.gantt-block`, mesma navegação por
  semana/dia — compartilha `currentWeekStart`/`currentDayIdx` com a
  aba de Quantidades, sem estado duplicado), mas é só resultado visual
  (somente leitura): blocos são OPs de verdade (`ops/`), cor por
  status real (Em Produção/Concluído/Aguardando Confirmação/Atrasada,
  usando o status da Fase 7). Bloco de setup: usa `setupInicio`/
  `setupFim` já gravado por OP (dado capturado desde sempre, nunca
  mostrado em lugar nenhum até agora — mesmo padrão de "gap de dado
  existente" da Fase 5), aparece como bloco hachurado antes da
  produção. Testado com harness Node (22 asserções) contra o bloco
  real extraído do arquivo — pegou e corrigiu um bug de fronteira real
  (fim exato numa hora cheia contava uma hora a mais) durante o
  próprio teste.

### Fase 8 concluída (2026-08-30)

- ✅ **Setup padrão configurável por linha**: novo card em `admin.html`
  ("Setup Padrão por Linha", 1 campo de minutos por linha, grava em
  `config/setupPadraoPorLinha`). Usado como fallback em "Planejamento de
  OPs" só quando a OP não tem `setupInicio`/`setupFim` medido — bloco
  marcado como "estimado" (prefixo `~`, tooltip explícito), nunca
  confundido com o dado medido de verdade. Testado com harness Node (30
  asserções no total, incluindo os casos de fallback aplicado/omitido).
  **Deployado.**

### Falta implementar

- **Painel de Turno espelhando a grade de OPs** — item já confirmado no
  desenho original (seção 3), ainda não iniciado. É uma mudança de UX no
  fluxo mais usado do sistema (Painel de Turno, `form.html`) — merece o
  mesmo cuidado das fases anteriores antes de tocar.

## 18. Fase 9 concluída — Fechamento do Dia (2026-08-30)

Implementado o painel descrito na seção 5: card "🔒 Fechamento do Dia" em
`dashboard.html`, posicionado logo antes de "Meta do Dia". É deliberadamente
um painel de **conferência**, não de digitação — não introduz nenhum campo
novo pro operador preencher, só agrega o que 3 fontes já gravam ao longo do
dia:

- **Produção × meta** por linha (reusa a mesma base de `regs` e a lógica de
  dia útil de `isWorking`, já usada em `renderMetaDiaria`).
- **Paradas do dia** por linha, contagem + minutos somados (reusa
  `paradasDoDia()`, já timezone-safe via `localDateFromIso` — não reimplementa
  filtro de data).
- **OPs em `'Aguardando Confirmação'`** por linha (Fase 7), com lote e produto
  listados. Deliberadamente **sem filtro de data** — uma OP presa nesse
  estado é pendência até alguém agir, não importa há quantos dias; filtrar
  por "hoje" esconderia justamente as mais esquecidas.

Badge por linha: verde "✓ Tudo certo" só quando não há OP pendente **e** a
meta (em dia útil) está em pelo menos 80%; qualquer um dos dois vira badge
laranja com o motivo. O caso que motivou o painel inteiro: uma linha pode
bater 100% da meta e ainda assim aparecer com pendência, se tiver OP
aguardando confirmação — nenhuma outra tela do sistema cruza essas duas
informações.

Sem `cfg.linhas` configurado, o card fica oculto (sem erro). Recalculado em
4 pontos de mudança: `renderAll`, listener de `config`, listener de
`paradas_historico` e listener de `ops`.

**Testado**: syntax check completo de `dashboard.html`; harness Node com o
bloco real de `renderFechamentoDoDia` extraído do arquivo (10 asserções:
linha 100%-sem-pendência → verde; OP aguardando confirmação → pendência
mesmo com meta 100%; meta abaixo de 80% → pendência com percentual certo;
meta 80–99% → NÃO é pendência; paradas contam certo por linha mesmo sem
produção registrada nela; card oculto sem linhas configuradas).

**Deployado** (`firebase deploy --only hosting`) e enviado pro `main`.

## 19. Fase 10 concluída — Indicadores PCP (2026-08-30)

Nova aba "Indicadores PCP" em `dashboard_analise.html`, ao lado das abas já
existentes (Visão Geral, Produção, Pedidos, Insumos, Logística, OPs).
Diferença importante em relação à aba OPs: essa aba nova é **100% dado ao
vivo do Firebase** (`ops`, `paradas_historico`) — não depende do retrato
estático que Logística/OPs usam (banner na própria aba deixa isso
explícito).

Da lista de 8 KPIs propostos na seção 4, implementados os 3 que já tinham
dado pronto sem exigir nenhuma captura nova:

- **% de OPs pontuais no início + atraso médio quando atrasa** — só entram
  no cálculo OPs que têm `dataInicioPlanejada` **e** já começaram (mesmo
  critério do alerta de OP atrasada em `functions/index.js`: sem plano, sem
  base pra cobrar — a maioria das OPs ainda não tem plano, então a base de
  cálculo tende a ser pequena por enquanto). Tolerância de 15min pra não
  contar o tempo normal de setup como atraso.
- **Rendimento médio (produzido ÷ planejado)**, geral e por linha — o
  indicador que motivou a conversa original desde o início. Só entram OPs
  com produção já registrada — uma OP ainda não iniciada não é "rendimento
  ruim", fica de fora em vez de puxar a média artificialmente pra baixo.
- **Pareto de motivo de parada**, agregado por período — já existia por
  turno individual no e-mail de fechamento, nunca tinha virado indicador
  agregado.

Os 4 KPIs restantes da lista (disponibilidade de linha agregada, aderência
ao apontamento, setup real vs. padrão, % de dias com Fechamento do Dia
limpo) ficam pra quando o dado que dependem existir ou amadurecer — não é
lista pra construir tudo de uma vez (a própria seção 4 já dizia isso).

Reusa a infraestrutura já existente do arquivo: os mesmos filtros de
período/linha da barra de filtro (`filterOpsLive`/`filterParadasLive`
espelham `filterProducao`/`filterPedidos`, já existentes), `getProduzido`/
`computeOpStatus` de `shared/utils.js` (mesma leitura usada em
`ops.html`/`dashboard.html`, não reimplementada), e o snapshot de `ops` que
o arquivo já carregava pra outro propósito (`opsCountByPedKey`) — sem
round-trip extra ao Firebase.

**Testado**: syntax check completo do arquivo; harness Node com o bloco
real (`filterOpsLive`/`filterParadasLive`/`renderKpis` + o trecho de
`renderAll` que computa os KPIs/gráficos da aba nova) — 20 asserções em 9
cenários: pontualidade dentro/fora da tolerância, OP sem plano fica fora da
base de cálculo (não conta nem a favor nem contra), rendimento ignora OP
sem produção, agrupamento por linha, pareto ordena e soma minutos certo,
filtro de linha e de período aplicados corretamente, estado vazio sem
quebrar.

**Deployado** (`firebase deploy --only hosting`) e enviado pro `main`. Não
verificado visualmente ao vivo logado no sistema — a página exige login e
a sessão desta conversa não entra credenciais em nenhuma hipótese; a
verificação ficou no syntax check + harness Node contra o bloco real, mesmo
padrão de rigor das fases anteriores.

## 20. Plano do PCP — todas as 10 fases de implementação concluídas

Com a Fase 10 encerrada, todo o sequenciamento da seção 6 está implementado
e deployado (Fases 1 a 10). Só resta:

- **Fase 11 (Machine Learning)** — deliberadamente fora de escopo por ora,
  precisa de 2-3 meses de dado limpo e com desvio justificado antes de fazer
  sentido tentar.
- **Painel de Turno espelhando a grade de OPs** (`form.html`) — item
  confirmado no desenho da Fase 6 mas ainda não iniciado; é o fluxo mais
  usado do sistema no dia a dia, merece uma passada de escopo dedicada
  antes de tocar, não encaixar apressado no fim de uma sessão longa.
- Itens de polimento de baixo risco já catalogados em `MELHORIAS_FUTURAS.md`
  ao longo da sessão (gaps de fila offline, recuperação de falha parcial em
  lote, acessibilidade, limpeza de código legado) — nenhum bloqueia nada do
  que foi entregue.

## 21. Pós-plano — melhorias pedidas depois das 10 fases (2026-08-30)

Com o plano original encerrado, o usuário pediu 3 melhorias direto na Grade
de OPs, testando o app já em produção:

1. **Setup ajustável direto na tela** (`planejamento.html`) — clique num
   bloco de setup estimado (manual ou padrão de linha) abre um modal
   pequeno pra ajustar os minutos só daquela OP (`ops/{key}.
   setupMinutosManual`), sem precisar ir em Admin mudar o padrão da linha
   inteira. **Deployado.**
2. **"Programação Semanal Consolidada" movida pra baixo** na aba
   Quantidades (fica depois do "Resumo Semanal por Linha", já que é pouco
   usada) + corrigido o bug relatado ("digitei 8.000, virou 8.002") — na
   verdade dois bugs parecidos: a edição da coluna "Programado na Semana"
   já tinha sido corrigida em 26/08, mas o botão "⚡ Agendar" (auto-
   agendamento) ainda distribuía um ritmo/hora arredondado igual em toda
   hora, o que quase nunca soma exato. **Deployado.**
3. **Arrastar/redimensionar OPs com o mouse**, com empurrar/puxar em
   cadeia nos blocos seguintes, mudança de linha, e uma etiqueta ao vivo
   mostrando a taxa (un/h) estimada enquanto arrasta. Revisado antes de
   implementar via um protótipo interativo (Artifact) com dado de
   exemplo, pra confirmar o comportamento exato (empurra E puxa, muda de
   linha, informa a taxa) antes de mexer em dado real de produção.
   **Deployado** -- ver commit "arrastar/redimensionar OPs direto na
   Grade de OPs" pros detalhes de regra (que OPs são arrastáveis por
   status, cadeia de reflow, limite ao mês do dia atual).

Junto: **KPI de setup planejado × realizado** (`dashboard_analise.html`,
aba Indicadores PCP) — pedido do usuário pra alimentar a calibração de um
futuro ajuste automático (ML). Só compara OPs com plano explícito por-OP
(`setupMinutosManual`, o mesmo campo do item 1 acima) E medição real do
Painel de Turno -- o padrão de linha do Admin fica de fora por ser um
valor global mutável, não reconstruível retroativamente. **Deployado.**

Nenhum desses 4 itens tinha sido testado num navegador real com clique-e-
arrasta de verdade (limite do ambiente desta sessão) -- a lógica foi
validada com harnesses Node contra o bloco de código real (não
reimplementação), mesmo padrão de rigor de toda a sessão, mas vale
conferir na prática antes de confiar de olhos fechados. Ponto de
`standby` (git tag `standby-pre-fase4-planejamento-pcp` + canal de preview
do Firebase Hosting) segue disponível caso algo precise ser revertido.

## 22. Emissão de OP nativa — Fase 1 concluída: vínculo com Programação (2026-08-31)

Usuário perguntou como automatizar a alocação de OP e tirar a emissão do
Excel/VBA (`Gerador de OPs.xlsm`) de vez. Investigação encontrou um quadro
bem diferente do esperado — ver plano completo em
`C:\Users\gcall\.claude\plans\valiant-singing-teacup.md`:

- **`emitir_op.html` já existia, já linkada no menu, e já era madura**
  (busca de produto, dimensionamento massa/peças com densidade/overfill/
  perda de processo, consumo de fórmula+BOM com substituição, numeração de
  lote segura contra corrida, empenho de estoque reversível) — mesmo assim,
  **zero das ~1270 OPs reais passaram por ela**. O gap real: ela nunca
  vinculava a OP a nenhuma alocação de planejamento nem programava
  (`skuPedidoKey`/`linha`/`dataInicioPlanejada` sempre vazios) — caía
  direto na fila "OPs aguardando programação" (seção 21).
- **Escopo maior confirmado com o usuário**: ele quer isso integrado com a
  especificação de qualidade/rastreabilidade completa já levantada em
  `GERADOR_OP_SPEC.md` (formulação em %m/m, versionamento de fórmula com
  dupla aprovação, MP rastreada por lote com bloqueio de vencido, pesagem
  com duplo check, ajustes de reator registrados, liberação pela
  Qualidade) — e documento impresso com paridade das 5 fichas atuais do
  Excel + novas por demanda. Isso é maior que este plano de Planejamento
  sozinho — vira um roadmap próprio (Fase 2+ no plano acima), sequenciado
  mas não detalhado até chegar a vez de cada etapa (mesmo processo já
  usado aqui, fase por fase).

**Fase 1 implementada e deployada**: `emitir_op.html` ganhou um passo
"Vincular a um pedido programado" (lista `alocacoes_planejamento`
congeladas com capacidade restante, filtradas pelo SKU — substitui o
código `NEC-XXXXXX` que antes só existia pra copiar/colar manual vindo de
`horizonte.html`). Ao emitir vinculado: consome a alocação
(`opsVinculadas`/`qtdConsumida`/`status`, via `.transaction()`, mesma
semântica de `linkAlocacaoToOP` no server) **e** auto-programa (acha o
primeiro dia útil livre na linha/semana da alocação, grava
`dataInicioPlanejada`/`dataFimPlanejada`/`linha` na própria emissão) — a
OP já nasce visível e arrastável na Grade de OPs, sem precisar do passo
manual "📅 Programar" que a fila da seção 21 exige. Emissão sem vincular
continua permitida (OP avulsa, comportamento anterior inalterado).

Simplificação deliberada: a auto-programação usa um horário de início
fixo (07h) e checa só conflito com outras OPs na mesma linha/dia — não
replica o grid completo de turnos/pausas de `planejamento.html`. Ajuste
fino sempre disponível arrastando na Grade de OPs.

Achado real ao testar: `.transaction()` do Firebase retornando `null`
**não aborta** — commita `null` silenciosamente. Corrigido: o vínculo com
a alocação agora rejeita explicitamente se ela sumiu (corrida com outra
sessão), em vez de resolver sem avisar ninguém.

Testado: syntax check + cross-reference de todo `getElementById`; harness
Node com o bloco real — 28 asserções (filtro de alocação, estimativa de
duração, auto-programação com conflito/fim de semana/OP cancelada, vínculo
parcial vs. total N:1, alocação sumida rejeita certo, fluxo ponta a ponta).
**Deployado e no `main`.** Ainda não emitida nenhuma OP real de teste por
essa via em produção — vale um teste manual ponta a ponta antes de
divulgar pro time como caminho oficial.

**Complemento (mesmo dia)**: usuário perguntou se a emissão nativa já
seguia o fluxo completo — incluindo aviso por e-mail. Não seguia: o
e-mail de "OP emitida" é mandado por uma Cloud Function
(`checkOpsEmitidas`, Microsoft Graph, cron de 2min — o daemon Outlook
local antigo está `.DEPRECATED`) que só consome `alertas_pendentes/`,
onde só o VBA (via `criarOP`) gravava. `emitir_op.html` agora enfileira
o mesmo formato, best-effort, tanto pra OP vinculada quanto avulsa — sem
precisar mudar `database.rules.json` (a página já é `admin`/`pcp`, que
já tinham escrita ali). Testado (+4 asserções, 32 no total),
**deployado**. Com isso, os 4 pontos perguntados pelo usuário —
registro no Firebase, disponibilidade pra programação, disponibilidade
pra apontamento (confirmado: `form.html`'s lista de Alocar OP não exige
`linha` preenchida, só status ativo) e aviso por e-mail — todos batem
com o fluxo do VBA.

**Segundo complemento (mesmo dia): as 5 fichas impressas.** Usuário
apontou o bloqueio real pra conseguir usar a emissão de verdade: "ainda
que comecemos continuando imprimindo, ainda não apontando via sistema,
mas precisamos das folhas pra impressão". `montarDocumentoImpressao()`
só gerava 1 página simples -- reconferi um PDF real já emitido em
produção (OP 26243/06, lido diretamente do `.pdf` na pasta de rede) pra
replicar fielmente as 5 fichas do Gerador de OPs: **OP 1** (separação +
produto acabado), **OF** (fabricação/pesagem, % da fórmula com 3 casas
decimais fixas igual ao Excel), **Ordem de Envase**, **Rotulagem**,
**Relatório de Produto Acabado** (bulk + envasado). Campos que hoje só
existem pra preenchimento à mão no chão de fábrica (horários de
setup/envase, responsáveis, paradas por turno, resultado de qualidade)
ficam em branco de propósito -- o apontamento continua em papel até a
Fase 2+ digitalizar isso.

Simplificação documentada no código: o Excel separa a "Equipe de
Trabalho" por componente (Válvulas/Frascos/Tampas/...) porque cada item
de BOM tem uma categoria lá -- esse cadastro não existe ainda no
Firebase, então as fichas listam todos os insumos em vez de arriscar
categorizar errado e esconder um componente real.

Testado: harness Node do bloco real (22 asserções) + o HTML gerado com
o CSS de impressão real, servido localmente e lido via `get_page_text`
(conteúdo das 5 fichas na ordem certa, nada cortado/vazio -- sem
conseguir screenshot nesta sessão porque o painel de preview não estava
visível, mas o texto extraído bate 1:1 com o esperado). **Deployado e
no `main`.**

**Terceiro complemento (mesmo dia): bug real -- emissão sempre caía em
avulsa.** Usuário reportou: "mesmo selecionando um item com pedido
ativo, ele aparece a chave de 'Emitir sem vincular'... isto nunca deve
ocorrer, só em extremas exceções". Investigado direto na produção
(Firebase CLI): `alocacoes_planejamento` está **vazio** -- ninguém nunca
usou o botão "congelar" de `horizonte.html`. A Fase 1 só oferecia
vínculo através desse nó, então toda emissão caía em avulsa, sempre,
mesmo com pedido ativo esperando.

Corrigido pra vincular direto em `pedidos/{key}` -- a própria key do nó
já é o `skuPedidoKey` que o resto do sistema usa, não depende de
ninguém ter congelado nada antes. `alocacoes_planejamento` virou bônus
opcional (linha/semana pra auto-programação, se existir). O card 2
agora auto-seleciona o pedido de maior prioridade assim que carrega --
"avulsa" nunca é mais o padrão silencioso -- e `emitirOP()` exige
`confirm()` explícito se o usuário insistir em avulsa com pedido
disponível.

Achado ESCREVENDO o teste, não presente na primeira versão desta
correção: o auto-select criava um loop -- clicar em "Emitir sem
vincular" de propósito virava `null`, e a própria re-renderização que o
clique dispara auto-selecionava de novo, sem deixar escolher avulsa
nunca. Corrigido com uma flag que trava o auto-select após a primeira
escolha (automática ou manual) pro produto atual.

Testado: harness Node do bloco real -- 26 asserções, incluindo
regressão direta do bug reportado, o loop de auto-seleção, e a
confirmação obrigatória (com cancelamento real abortando a emissão).
**Deployado e no `main`.**

**Quarto complemento (mesmo dia): `horizonte.html` desativado.** Usuário
confirmou o achado acima como o motivo de já ter pedido isso antes: "não
é utilizado para nada hoje... nem vale pensar em mecânicas envolvendo o
horizonte de produção, ele é só mais uma tela de dash". Tirado do menu
(`auth_check.js`) -- página em si continua existindo (dados históricos
preservados), com um banner avisando que foi desativada pra quem chegar
por link direto. Confirmado por grep que nenhuma outra tela depende de
`horizonte.html` rodar. Sobre a sugestão de múltiplos pedidos do mesmo
SKU acumulados: **já funciona** -- o card 2 de `emitir_op.html` lista
todos os pedidos elegíveis, auto-seleciona o de maior prioridade, e
qualquer outro é um clique (nenhuma mudança de código precisou).

**Quinto complemento (mesmo dia): dimensionamento não sabia produto de
massa (g/kg).** Usuário reportou erro ao emitir uma OP real: "Este
produto está cadastrado com unidade de volume g...". Confirmado na
produção que não é cadastro errado -- **34 de 373 produtos (~9% do
catálogo)** são legitimamente dosados por massa (esfoliantes, cremes,
hidratante em bisnaga), não por volume. Só 7 dos 34 têm densidade
cadastrada -- confirma que densidade nem é necessária pra esse tipo.

`dimensaoNominalDoProduto()` (ex-`volumeNominalEmLitros`) agora
reconhece dois tipos físicos: **volume** (ml/L, precisa de densidade,
fórmula original intocada) e **massa** (g/kg, novo -- a massa por
unidade já é o próprio cadastro, sem precisar de densidade nenhuma;
densidade vira só um bônus opcional pro volume granel informativo).
"un" continua bloqueado (nenhum produto real usa, sem fórmula própria
ainda). Testado: 17 asserções (regressão completa do cálculo de volume
+ os cenários novos de massa, com/sem densidade, pelos dois modos de
entrada, conversão kg→g). **Deployado e no `main`.**

**Sexto complemento (mesmo dia): correção do modelo (densidade sempre
obrigatória) + painel de emissões.** Usuário corrigiu a Fase 5 acima:
"massa é a unidade canônica" (`GERADOR_OP_SPEC.md` §2), mas densidade
continua **sempre** obrigatória -- peso/volume teórico da unidade e
volume total do batch são resultado padrão de toda emissão, e densidade
é o que conecta os dois, não importa como o produto é rotulado. Revertida
a opcionalidade da Fase 5, adicionados 2 outputs novos e explícitos
(peso teórico da unidade em g, volume teórico da unidade em mL) --
antes só existiam como variáveis internas. Achado ao comparar com o PDF
real: a Ficha 1 mostrava o volume TOTAL do batch onde a ficha real do
Excel mostra o volume POR UNIDADE ("0,215 l") -- corrigido.

Junto, o usuário pediu um "painel de logs" mostrando cada emissão --
`ops.html` já listava por data de emissão mas não mostrava quem emitiu
nem reimprimia as 5 fichas de uma OP passada. As 5 fichas foram
**movidas de `emitir_op.html` pra `shared/utils.js`** (generalizadas,
sem ler mais variáveis globais da tela de emissão) pra `ops.html` poder
chamar o mesmo código -- zero duplicação, um bug de formatação futuro se
corrige uma vez só. `ops.html` ganhou "Emitida por Fulano" na legenda de
cada linha e um botão 🖨️ que reimprime as 5 fichas de qualquer OP com
`materiaisConsumo` gravado (só as emitidas pelo sistema; OP do Excel
mostra aviso claro).

Sobre salvar as fichas direto na pasta de rede / automação de e-mail:
**adiado como melhoria futura**, documentado em `MELHORIAS_FUTURAS.md`
com o achado real (não existe automação de e-mail hoje pra esse fluxo --
conferido no VBA, que grava direto em disco via `ExportAsFixedFormat`) e
as duas peças que faltariam construir (geração de PDF real no servidor +
algo observando uma caixa de e-mail).

Testado: 25 asserções nas 5 fichas (confirmando que mover de arquivo não
mudou o resultado) + 10 na reimpressão via `ops.html` (OP do Excel avisa
e não tenta nada, OP completa reimprime com fórmula/especificação
corretas, produto sumido do cadastro não trava). **Deployado e no
`main`.**

**Sétimo complemento (mesmo dia): validação de "massa do lote" contra a
planilha real + UX do Consumo de Materiais.** Usuário testou o mesmo SKU
(MRARBS01) nos dois sistemas e achou uma diferença real: meu sistema
calculava 962,09kg, a planilha mostrava "Massa total de Fabricação" de
929,28kg. Reverse-engineering completo dos números da planilha confirmou
a fórmula exata que ela usa hoje (peso teórico da unidade = nominal sem
overfill; volume teórico = nominal com overfill; volume total do batch
= peças × volume teórico × (1+perda) -- essa parte bate 100% com o meu
sistema) -- só que a "massa pesada" da planilha nunca infla por
overfill/perda, ao contrário do meu sistema. Comparado contra o próprio
`GERADOR_OP_SPEC.md` (`massa_lote_kg = volume_granel × densidade`,
onde `volume_granel` já é o volume COM overfill+perda) -- **o meu
sistema já bate com o modelo documentado como alvo**; a planilha atual
é que faz a conta simplificada (sem cobrir perda/overfill na pesagem).
Nenhuma mudança de código -- só confirmação. Aviso relevante passado ao
usuário: isso significa consumir ~3,5% mais matéria-prima por OP do que
a planilha calcula hoje -- vale avisar quem cuida de custo/compra antes
de finalizar operação real com o novo sistema.

Junto, dois ajustes de UX no card "4. Consumo de Materiais" da tela de
emissão: coluna de % pra cada item de fórmula (+ linha TOTAL somando,
mesmo padrão da Ficha 2 impressa) e, pra item de BOM consumido em fração
de peça (ex: 1 caixa a cada 48 peças = 0,02083333), um hint "(48
un./cx)" ao lado da quantidade em vez do decimal cru. Testado (14
asserções). **Deployado e no `main`.**

**Oitavo complemento (mesmo dia): embalagem arredonda pra cima + bug real
no "Substituir".** Usuário pediu arredondamento pra cima na embalagem
("nunca faltar caixa") -- `montarMateriaisConsumo()` trocou `Math.round`
por `Math.ceil` pra itens de BOM: unidade discreta (un/cx/pct/par/rolo)
arredonda pro inteiro, unidade contínua (kg/L) só na 3ª casa decimal.
Fórmula (MP) não mudou -- o pedido era específico de embalagem.

Investigando a segunda pergunta (etiqueta de caixa como "material de uso
e consumo"), achado real: a categoria `MU` já existe no cadastro (junto
com EP/ES/ET pra embalagem, MPGR/MPES pra matéria-prima -- confirmado
nos 904 materiais reais), mas `abrirSubstituicao()` (botão "Substituir"
na tabela de materiais) filtrava por `tipo==='MP'`/`tipo==='EMBALAGEM'`
-- literais que **nunca existem** em nenhum material real. A lista de
opções pra substituir qualquer item, fórmula ou embalagem, sempre veio
vazia, silenciosamente, desde que essa tela foi construída. Corrigido
pra comparar contra os tipos reais. Testado (+8 asserções, 22 no total).
**Deployado e no `main`.**

Também esclarecido com o usuário (sem mudança de código -- já estava
certo): emissão de OP **não** dá baixa em saldo de pedido (`produzido`
só muda via apontamento real de produção, `form.html`) -- isso é
consistente com o modelo alvo, onde só "faturado e expedido" (etapa
ainda não implementada) deveria dar baixa de verdade; por ora,
apontamento real de produção já serve como proxy.

**Nono complemento (mesmo dia): etiqueta de caixa de embarque gerada
automaticamente, com código de barras.** Usuário refinou o pedido
anterior -- em vez de cadastrar a etiqueta no BOM, um "espaço fixo" na
própria OP, com layout padrão já pronto pra imprimir: "minimizaria
muitos dos erros que temos hoje, de impressão errada de etiqueta".

`montarEtiquetasCaixa()` (novo, `shared/utils.js`) gera 1 etiqueta por
caixa -- quantidade calculada automaticamente (peças ÷ `pecasPorCaixa`,
arredondado pra cima, mesmo princípio já usado no BOM), com Cliente/
Produto/SKU/Lote/Validade/"Caixa X de Y" (última caixa mostra a
quantidade real que sobrou) e um **código de barras Code 39** do lote
pra leitor na expedição. `pecasPorCaixa` vem do cadastro do produto
(`unCx`, já existia) e passou a ser gravado na própria OP na emissão,
pra reimpressão não depender do cadastro. Layout impresso em página
nomeada (CSS Paged Media, tamanho ajustado no complemento seguinte pro
padrão real da Kuryos), botão tanto na emissão fresca quanto na
reimpressão via `ops.html`.

**Aviso honesto, repassado ao usuário**: a tabela de padrões Code 39 foi
escrita de memória, não copiada de uma lib testada em campo. O harness
confirma que ela é *estruturalmente* válida (todo caractere usado seguindo
a regra "3 de 9" do formato), mas isso não garante leitura correta num
scanner físico real -- recomendado escanear uma etiqueta impressa de
verdade antes de confiar em produção; se algum caractere não ler certo,
é rápido de corrigir (só a linha dele na tabela).

Testado: 17 asserções (tabela estruturalmente válida, sanitização,
contagem de barras, arredondamento de caixas, numeração e quantidade
real na caixa parcial, fallback sem cadastro, XSS). **Deployado e no
`main`.**

**Décimo complemento (2026-08-31): etiqueta redimensionada pro padrão
real + busca de substituição com detalhe técnico.** Duas correções do
usuário sobre features recém-entregues.

1. *Tamanho da etiqueta*: eu tinha assumido 100x150mm (etiqueta térmica
   "4x6" genérica, por causa da menção a impressora Zebra). O padrão
   real da Kuryos é **90x55mm** -- bem mais compacto. Redesenhei o
   layout inteiro (header, nome do produto com corte de 2 linhas, grid
   2x2, código de barras) pra caber em ~51mm de altura útil, com fontes
   e espaçamentos reduzidos e o código de barras de 12mm pra 9mm de
   altura. Aplicado em `emitir_op.html` e `ops.html` (mesmo bloco de
   CSS/print nos dois arquivos).

2. *Busca na substituição de material*: "ao clicar em substituir, dentro
   da OP, preciso ter um campo de pesquisa que de alguma forma traga
   maiores detalhes sobre o item, pra conseguir substituir dentro da
   mesma tela (sem precisar sair pra pesquisar)". A tela de "Substituir"
   ainda usava um `prompt()` com lista numerada em texto puro -- só
   código+nome, sem nenhum dado técnico (cor, gargalo/rosca, resina,
   INCI...) pra decidir com segurança, obrigando a sair pra Cadastros
   conferir e voltar depois. Virou um modal com campo de busca: filtra
   por código, nome OU qualquer detalhe técnico do material (cor,
   formato, gargalo/rosca, resina, textura, fixação, INCI, função,
   marca/modelo, especificações técnicas), ignora acento na busca, cada
   resultado já mostra os detalhes relevantes na própria linha, o item
   atualmente selecionado vem marcado com um badge "atual", e materiais
   inativos (`ativo:false`, 44 dos 904 reais) nunca aparecem como opção.
   Um clique substitui, sem sair da tela.

**Achado incidental, não corrigido agora (fora de escopo, risco zero em
produção)**: `materiais.html` é uma tela de cadastro **órfã** -- sem
link em nenhum menu (só `cadastros.html` é a tela real usada hoje) --
que ainda compara `tipo` com os literais antigos `'MP'`/`'EMBALAGEM'`,
o mesmo bug já corrigido em `emitir_op.html` no complemento anterior,
mas nesta tela morta. Como ninguém navega até ela, fica só registrado
pra uma limpeza futura (provavelmente exclusão do arquivo).

Testado: harness Node do bloco real -- 19 asserções em etiquetas
(incluindo checagem específica da altura compacta do código de barras)
e 38 em materiais/substituição (12 novas: abertura do modal, filtro por
tipo/inativo, busca por cada campo técnico, busca ignorando acento,
badge "atual", comitar substituição, ignorar código fora da lista,
desfazer substituição escolhendo o original de volta, limpeza de
estado ao fechar). **Deployado e no `main`.**

**Décimo primeiro complemento (2026-08-31): silêncio noturno nos
alertas de PCP.** Usuário: "os alarmes do PCP entre o fim de turno e
início de turno não deve ficar enviando emails. Estou recebendo a cada
10min, porém não faz sentido. Após as 17h e antes das 7h não deve
enviar emails de notificação (apenas se instruir que estaremos
operando, coisa do tipo)".

Achado real: `checkOpsAtrasadas` (`functions/index.js`) tem cooldown de
10min -- exatamente o sintoma relatado. OPs programadas pro dia que não
terminaram ficam "atrasadas" a noite inteira sem ninguém pra agir,
reenviando o e-mail sem parar até de manhã.

`dentroDoHorarioDeOperacao(config)` (novo) decide se `checkLinhasParadas`
e `checkOpsAtrasadas` rodam em cada tick do cron (a cada 2min) -- construído
em cima do horário de turno **configurado** (`turnoHorariosAtivos`/
`turnoHorariosFim`, mesma fonte que `checkTurnoNaoEncerrado` já usava),
não um 7h/17h fixo no código: acompanha automaticamente se o horário
mudar em Admin, já funciona certo com múltiplos turnos (silencia só
entre o fim do último e o início do primeiro) e com sexta-feira reduzida.
Também respeita dia não-útil/feriado.

Deliberadamente **não** aplicado a `checkTurnoNaoEncerrado` (é sobre o
próprio instante de fim de turno -- silenciar isso faria a cobrança de
"esqueceu de encerrar" nunca disparar) nem a `checkOpsEmitidas`/
`checkIntervalosPendentes` (refletem uma ação humana que acabou de
acontecer, não um estado que fica "preso" reenviando sozinho).

Override manual: `config.operacaoEstendidaData` -- toggle novo em
Admin > Notificações por E-mail, guarda a data de um dia em que a
fábrica avisa que vai operar fora do horário normal, válido só naquele
dia (não precisa lembrar de desligar depois).

Testado: harness Node do bloco real -- 18 asserções (config real de
produção, bordas exatas de horário, fim de semana, feriado, override e
sua expiração automática, sexta reduzida, sem turno configurado,
múltiplos turnos). **Deployado (functions + hosting) e no `main`.**

**Décimo segundo complemento (2026-08-31): removida a aba "Controle de
Qualidade" do cadastro de produto.** Usuário perguntou se não era
redundante com "Especificações" (de `formulas.html`) -- investigação
confirmou que sim, e pior: os 8 campos da aba CQ (`produtos/{sku}.cq`)
nunca eram lidos em nenhuma ficha de OP, só entravam no cálculo de % de
cadastro preenchido, apesar da própria tela dizer "usadas no Relatório
de Produto Acabado da OP". `paginaRelatorioPA` sempre leu exclusivamente
de `especificacoes/` (versionado por fórmula, com mínimo/máximo/método/
crítico -- estritamente mais completo). Usuário: "vamos apagar a aba
cq, acho que ninguém usou nada lá, a aba especificações ficou melhor".
Removida dos dois cadastros que a duplicavam (`produtos.html` e
`cadastros.html`) -- botão, painel, carregamento, gravação e o campo
`cq.*` saiu da lista de % de preenchimento. Dado histórico em
`produtos/*/cq` no Firebase não foi apagado (não destrutivo), só a UI.
**Deployado e no `main`.**

**Décimo terceiro complemento (2026-08-31): excluir versão de fórmula
criada por engano.** Usuário: "como excluo uma versão que criei sem
querer?" -- em Cadastros > Fórmulas só existia "+ Nova Versão", nenhum
jeito de desfazer um clique acidental.

Novo botão "🗑 Excluir versão", restrito ao mesmo bloco RASCUNHO sem
`aprovadoPD` do botão "Aprovar (P&D)" -- uma vez que P&D já aprovou algo,
não é mais "cliquei sem querer", é histórico de verdade. Antes de apagar,
confere se alguma OP real já foi emitida usando exatamente esse
sku+`formulaVersao` -- o dimensionamento em `emitir_op.html` tem fallback
pra fórmula ainda em rascunho quando não existe nenhuma aprovada, então
uma OP real *pode* ter consumido uma versão nunca aprovada; se achou,
recusa a exclusão e avisa qual OP (lote) usou, em vez de quebrar
silenciosamente a reimpressão de qualidade daquela OP. Confirmação via
`confirm()` antes de apagar de verdade -- apaga `formulas`/`bom`/
`especificacoes` da versão juntos (os 3 nascem juntos em
`btnNovaVersaoClick`, saem juntos aqui).

Testado: harness Node do bloco real -- 16 asserções (apaga os 3 nós
juntos, cancelar o `confirm()` não apaga nada, dupla guarda de status/
aprovação, recusa quando já usada por uma OP real e avisa qual lote, OP
de outro sku/versão não bloqueia à toa, reset de estado da tela depois
de excluir). **Deployado e no `main`.**

**Décimo quarto complemento (2026-08-31/09-01): 3 aprovações
independentes -- Fórmula, BOM e Especificação.** Usuário: "O certo é
ter 3 aprovações, da formula, do bom e da spec. É possivel colocarmos
como 3 diferentes?". Antes era 1 aprovação (P&D + Qualidade) cobrindo
os 3 juntos num nó só -- inclusive bloqueando a Fórmula por causa de um
ensaio de Especificação sem faixa, ou de um item de BOM pendente.

Confirmado com o usuário antes de construir (2 perguntas): cada
componente mantém 2 etapas, com rótulos diferentes por natureza --
Fórmula e Especificação usam P&D → Qualidade; BOM usa PCP → Comercial
("hoje não temos users definidos, então só dupla aprovação qualquer
acho que bastaria" -- sem diferença de permissão real). E "Emitir OP"
passa a preferir uma versão só quando os 3 estiverem TODAS aprovadas
("As 3 aprovadas").

`formulas`/`bom`/`especificacoes/{chaveVersao}` ganham `status` e
aprovação PRÓPRIOS -- `bom.aprovadoPCP`/`aprovadoComercial` e
`especificacoes.aprovadoPD`/`aprovadoQualidade` são novos, independentes
da Fórmula. `renderAcoesComponente(tipo, key)` -- função única
parametrizada, reutilizada nas 3 abas internas, cada uma travando a
edição sozinha quando A PRÓPRIA aprovação conclui (antes, BOM e
Especificação travavam quando a FÓRMULA era aprovada -- bug de
acoplamento corrigido de brinde). Bloqueios (soma 100%, item pendente,
ensaio crítico sem faixa) movidos pra perto de quem realmente checam,
em vez de todos bloquearem só a Fórmula. Cabeçalho da versão
simplificado: "🗑 Excluir versão" só quando nenhum dos 3 começou a ser
aprovado, "+ Nova versão a partir desta" só quando os 3 estiverem
completos, pill da lista mostra "X/3 aprovados".

`melhorFormulaDoProduto` (`shared/utils.js`) ganha `allBom`/
`allEspecificacoes` **opcionais** -- sem eles (`compras.html`,
`form.html`, que já existiam antes e nunca devem travar por um campo de
aprovação que não existia quando foram escritos), continua olhando só a
Fórmula; só com os 3 argumentos (`emitir_op.html`) uma versão conta
como aprovada com os 3 componentes em `APROVADA`. Removida a cópia local
duplicada dessa função dentro de `emitir_op.html`. Mensagem de aviso
agora lista qual componente ainda falta. **Deliberadamente mantido como
aviso** (emitir mesmo assim continua permitido), não bloqueio duro --
travar a emissão pararia toda OP até reaprovar em 3 etapas cada fórmula
já cadastrada, já que nenhuma tem BOM/Especificação aprovados ainda
(são campos novos no dia do deploy).

Testado: harness Node do bloco real -- 9 asserções em
`melhorFormulaDoProduto` (compatibilidade com 2 argumentos, exigência
dos 3 com 4 argumentos) e 27 em `cadastros.html` (rótulos por
componente, independência entre os 3, bloqueios não vazam mais entre
componentes, botão desabilitado com motivo, gates de Excluir/+Nova
versão nos 4 estados possíveis, exclusão ainda funciona sem nenhum
aprovado). **Deployado e no `main`.**
