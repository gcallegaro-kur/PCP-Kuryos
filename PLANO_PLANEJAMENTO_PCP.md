# Plano — Planejamento, PCP e Eficiência de OPs

Documento vivo. Consolida a discussão de arquitetura sobre planejamento de
pedidos, planejamento de OPs, eficiência de produção e apontamento,
debatida em profundidade com o usuário em 2026-08-28. Escopo deliberadamente
**não inclui** Ordens de Serviço / Roteiro de Produção / Estoque de Produto
Acabado — esse conceito foi adiado pra depois, ver seção própria em
`MELHORIAS_FUTURAS.md`. Aqui é só a parte de planejamento/PCP/apontamento
que o usuário pediu pra "azeitar" primeiro.

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
- **O verdadeiro gargalo, segundo o usuário**: não é a margem de perda em
  si (ela já existe pro batch manipulado, "o único material que importa").
  É que **a manipulação (fabrico do batch) não tem NENHUM apontamento
  hoje** — confirmado por busca no repositório inteiro, zero ocorrência de
  "manipulação"/"batch"/"fabrico" como etapa de produção rastreada. Só
  existem 3 tipos de produção rastreados: `produzidoLinha` (Envase),
  `produzidoRotulagem`, `produzidoPosto` (`shared/utils.js:432-436`). O
  sistema só conhece o volume TEÓRICO calculado na emissão da OP; nunca
  sabe quanto de batch **realmente** saiu da manipulação — só descobre
  quando falta material no meio do envase.
- **`horizonte.html` NÃO está morta** (achado que corrigiu uma hipótese
  errada do usuário) — fortemente acoplada via `alocacoes_planejamento`,
  consumida por `planejamento.html`, `ops.html` e 2 rotinas de fundo em
  `auth_check.js`, mais `linkAlocacaoToOP` em `functions/index.js`. O
  vínculo "pedido → bloco planejado → OP" que o usuário queria já existe
  ponta a ponta hoje (`horizonte.html` gera um código de necessidade,
  Gerador de OPs devolve, `functions/index.js:95-151` vincula a OP exata).
- **`dataInicioPlanejada`/`dataFimPlanejada`** já existem no schema de toda
  OP desde a emissão (`emitir_op.html:532`) mas **nunca são preenchidos em
  lugar nenhum** — campo morto vestigial. É o que falta popular pra
  qualquer alerta de atraso funcionar.
- **Infra de e-mail/alerta já é robusta**: cron `checkNotificacoes` roda a
  cada 2 minutos (`functions/index.js:1099`), com fila de eventos
  (`alertas_pendentes`) e cooldown/dedupe (`cooldownOk`/`markSent`). Não
  precisa ser construída do zero — só falta um novo check alimentado pelo
  campo de horário planejado (que também não existe ainda).
- **O motor de replanejamento automático (empurrar atraso / adiantar
  conclusão antecipada) já existe e já roda**: `auth_check.js:784-1003`
  (`autoAjustarPlanejamento`), dispara a cada apontamento fechado, compara
  ritmo real com planejado e reprograma os slots futuros da linha,
  logando em `ajustes_planejamento/{data}`. Vale confirmar com o time se
  está sendo percebido/funcionando — pode só precisar ser adaptado pro
  novo modelo de blocos por OP, não reconstruído.
- **Paradas de linha são bem rastreadas, mas 100% desconectadas de
  qualquer cálculo.** Dois mecanismos maduros — Andon ao vivo
  (`estado_linhas`, `form.html:1278-1284`) e histórico com duração exata
  (`paradas_historico`, `form.html:1123-1135`) — mas nenhum cálculo de
  ETA/capacidade no sistema hoje lê esse dado. Confirmado por busca: zero
  ocorrência de termo de ETA que leia `estado_linhas` ou `paradas_historico`.
- **Changeover/setup é greenfield puro.** Existe um cronômetro manual
  (`setupInicio`/`setupFim` por OP, `form.html:4069-4096`), mas zero
  cadastro de tempo-padrão por linha/SKU e zero uso em cálculo de
  capacidade — confirmado, "o setup fica registrado só como duração, sem
  quantidade" (comentário em `form.html:721`).

## 3. Decisões já tomadas com o usuário

- **Granularidade do planejamento: 15 minutos, não 5.** A equipe já tem
  dificuldade de manter a rotina de apontamento hoje (que é por hora) —
  cair pra 5 minutos sem captura automática (sensor/contador) pioraria
  esse problema em vez de resolver. 15 minutos é o meio-termo: detecta
  desvio cedo sem multiplicar o esforço manual. Se no futuro houver
  contagem automática, 5 minutos ou tempo real passam a fazer sentido sem
  custo de operador.
- **Conclusão de OP: 100% manual pelo PCP no início, sem exceção — não
  gated por desvio.** Volume é baixo (poucas OPs/dia, 3 linhas), e o
  objetivo é construir a rotina/fluxo bem amarrado primeiro. Automação por
  desvio (só sinalizar quando fugir da meta, deixar o resto se auto-
  concluir) é evolução natural, decidida depois que o fluxo estiver maduro
  — não travar essa decisão agora.
- **Duas telas de planejamento**, substituindo a dupla
  Horizonte+Planejamento atual:
  - **Planejamento de Quantidades** — pedidos são programados aqui,
    resumos de produção do dia/semana, metas.
  - **Planejamento de OPs** — cada OP emitida referencia o bloco de
    quantidade correspondente e "consome" uma fração (ou o todo) dele. Ao
    fim, a soma das OPs emitidas tem que suprir a quantidade total
    planejada. Em vez de mostrar blocos de "pedido", mostra blocos de "OP"
    (um pedido de 10.000 vira 10 OPs de 1.000, já é o que acontece na
    prática hoje — a diferença é a tela refletir isso explicitamente).
  - Importante: **não é reconstrução do zero** — o pipeline de vínculo
    (`alocacoes_planejamento`, `necessidadeCodigo`, `linkAlocacaoToOP`) já
    existe. É redesenho de UI/UX em cima de um cano que já funciona, com
    cuidado pra não quebrar os 4 pontos que hoje leem/escrevem nesse cano.
- **Apontamento travado na OP programada** — produção não escolhe
  livremente qual OP apontar; o sistema apresenta a OP programada pra
  aquela linha/momento. Qualquer confusão/exceção tem que ser resolvida
  pelo PCP no sistema antes da produção seguir. Objetivo explícito:
  simplificar o preenchimento (a equipe já relatou dificuldade de manter a
  rotina de apontamento hoje).
- **Paradas de linha somam ao tempo total estimado de conclusão da OP** —
  fecha o gap descrito acima (dado já existe, nunca é usado).
- **Alerta de atraso pro PCP com tolerância de 15 minutos** quando uma OP
  passa do período programado — email/aviso, reaproveitando a infra de
  cron já existente.
- **Changeover configurável, começando simples** — tempo-padrão por
  **linha** (não uma matriz SKU×SKU completa, que teria custo de cadastro
  alto pra um catálogo com centenas de SKUs), com apontamento próprio de
  início/fim, acompanhado pelo PCP.
- **KPIs de acompanhamento**: % de atraso geral e % de atraso por
  SKU/item específico.
- **Machine Learning: adiado.** Antes de qualquer modelo, é preciso
  2-3 meses de dado limpo com desvio-justificado obrigatório (que as fases
  abaixo já vão gerar). Um painel de KPI com meta e desvio-justificado já
  entrega a maior parte do valor, sem o risco/complexidade de um modelo
  treinado em dado incompleto ou viesado. Reavaliar depois que a base
  existir.

## 4. Sequenciamento proposto

Cada fase depende do dado que a fase anterior cria — seguir a ordem evita
retrabalho.

1. **Apontamento de manipulação** — novo tipo de etapa rastreada (hoje só
   existem Envase/Rotulagem/Posto), registrando volume/peso REAL do batch
   pós-manipulação vs. o teórico calculado na emissão da OP. Aditivo puro,
   não muda nenhum cálculo/comportamento existente. Cria, pela primeira
   vez, o dado que falta pra calibrar qualquer margem de perda com
   confiança.
2. **Popular `dataInicioPlanejada`/`dataFimPlanejada` de verdade na
   emissão da OP** — pré-requisito de todo o resto desta lista.
3. **Travar apontamento na OP programada** — baixo risco, resolve a dor
   que a equipe já sente hoje na rotina de apontamento.
4. **Somar paradas reais ao tempo estimado + alerta de atraso (15min)** —
   fecha gap de dado já existente, reaproveita o cron já existente.
5. **Redesenho das duas telas de planejamento** (Quantidades / OPs) sobre
   o pipeline `alocacoes_planejamento` já existente.
6. **Conclusão de OP gated por PCP** (100% manual no início, conforme
   decisão acima).
7. **Changeover configurável** (tempo-padrão por linha).
8. **Dashboard de KPI agregado** (% atraso geral/por SKU, rendimento).
9. **Reavaliar Machine Learning**, só quando houver base de dado limpa
   suficiente.

## 5. Fora de escopo por ora

Ordens de Serviço (principais e de transformação), Roteiro de Produção
condicional por SKU, gate de disponibilidade via "mínimo entre etapas",
Estoque de Produto Acabado incremental e Faturamento parcial por acúmulo —
conceito grande, discutido e documentado em detalhe, mas adiado pra depois
que o planejamento/PCP/apontamento acima estiver azeitado. Ver seção
própria em `MELHORIAS_FUTURAS.md`.

## 6. Cautelas

- `horizonte.html` não deve ser apagada como "código morto" — qualquer
  redesenho das telas de planejamento precisa manter (ou recablar
  deliberadamente) os 4 pontos de consumo de `alocacoes_planejamento`
  hoje: badge de status na grade, resolução exata de lote por slot,
  cascata de cancelamento de OP (`ops.html:1211-1223`), e o preenchimento
  automático de linha/status de OPs em `auth_check.js`.
- Sistema é usado ao vivo por produção todos os dias — nenhuma fase acima
  deve ser implantada sem teste prévio (harness/emulador local) e sem
  plano de rollback, mesmo padrão de cautela já seguido no resto desta
  sessão.
