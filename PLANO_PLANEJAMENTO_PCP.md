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
3. **Apontamento nos pontos de controle** — **parcial**: início de turno
   ✅, lista de Alocar OP por prioridade ✅ (trava dura movida pro
   backlog), clareza Intervalo×Parar linha ✅. Falta: unificar os 3
   fluxos de "Encerrar OP" (Painel de Turno/Apontamento por Total/Fechar
   Lote) num só, com a trava de justificativa portada pro fluxo do dia a
   dia.
4. **Alertas ao PCP**: OP não iniciada no horário programado + OP atrasada
   em andamento, 5min de tolerância inicial + repique a cada 10min
   (cooldown próprio, não o padrão de 60min do sistema atual) —
   reaproveita o cron de 2 minutos já existente.
5. **Somar paradas reais ao tempo estimado de conclusão da OP** — fecha
   gap de dado já existente, nunca usado.
6. **Redesenho das duas telas de planejamento** (Quantidades / OPs),
   substituindo a TELA de Horizonte (não o pipeline `alocacoes_planejamento`,
   que é recablado, não descartado), com timeline de início/fim exatos.
   A tela de apontamento da produção passa a espelhar essa tela.
7. **Conclusão de OP gated por PCP** (100% manual no início).
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
- Perdas: 3 formatos incompatíveis (texto livre no Painel de Turno vs.
  dropdown estruturado no Fechar Lote vs. nenhum campo no Apontamento por
  Total) — e o fluxo mais usado é o mais pobre, prejudicando qualquer
  Pareto futuro (tudo cai em "Outro").
- `salvarPerdaOP` (Painel de Turno) é a única gravação de perda que não
  passa pela fila offline (`queueOfflineWrite`) — falha silenciosa se
  confirmar sem conexão.
- O write que limpa `abertaDesde`/`abertaLinha` ao encerrar também
  bypassa a fila offline — se fechar offline e o app fechar antes de
  reconectar, a OP fica "aberta" pra sempre, bloqueando a linha.
  "Encerrar Turno" (fechamento em lote) não tem recuperação de falha
  parcial — um item falhando rejeita o lote inteiro sem rollback dos que
  já commitaram.
- Justificativa de desvio (Fechar Lote) compara contra uma base diferente
  do % mostrado no Painel de Turno (`qtdEsperada` do bloco de alocação vs.
  `qtdPlanejada` da OP) — escolher 1 base ao unificar.
- Diferencial real a preservar (não é sobre rigor, é sobre qualidade de
  informação): hint de ritmo real (un./h) antes de confirmar, hoje só no
  Apontamento por Total.
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
