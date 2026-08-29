# Melhorias Futuras — Sistema PCP Kuryos

Documento vivo. Lista de melhorias identificadas ao longo do desenvolvimento
que foram conscientemente adiadas — não são bugs bloqueantes, são trabalho
que faz sentido fazer em algum momento, mas não agora. Cada item tem uma
linha de contexto (de onde veio a ideia / por que foi adiado).

Itens marcados **⚠ verificar se ainda procede** vieram de anotações com mais
de 30 dias — o sistema mudou bastante desde então; confirmar que o item
ainda é real antes de priorizar.

Ao adicionar um item novo: contexto de onde veio, por que foi adiado (ou
"nunca chegou a ser feito"), e qualquer referência de arquivo/função
relevante para retomar o trabalho depois.

---

## Compras

- **Arquivo de etiqueta pronto por item, no Pedido de Compra** — hoje o
  padrão de 11 campos (`PADRAO_ETIQUETA_FORNECEDOR`, `shared/utils.js`) só
  aparece como texto no e-mail de cotação e (depois desta rodada) no
  detalhe do Pedido de Compra. A ideia é gerar um arquivo de verdade
  (PDF/imagem) já preenchido por item, pronto pra anexar no e-mail ao
  fornecedor. Adiado explicitamente pelo usuário ao pedir o Processo de
  Cotação — "pode ser uma melhoria a ser incorporada".
- **Exportação da etiqueta em formato de impressora térmica** — cogitado
  ainda na Fase 2 de Compras (padrão de etiqueta), nunca chegou a ser
  desenhado.
- **Categoria própria de fornecedor para "Uso e Consumo" (MU)** —
  `tipoFornecedorParaMaterial()` (`cadastros.html`) só distingue fornecedor
  tipo "mp" ou "embalagem"; MU cai sem filtro (mostra todos). Não é
  urgente porque MU nunca entra em BOM.
- **MU fora da Busca Avançada Fornecedores × Material** — `BF_FACET_CONFIG`
  (`compras.html`) só cobre MPGR/MPES/EP/ES/ET.

## Materiais / Cadastros

- **Mecanismo de rename de código de material** — hoje o código
  (`mpCodigo`) é imutável depois de criado (diferente de Produto, que tem
  `skusAnteriores`/`sku_historico`). Se uma classificação errada (tipo)
  for descoberta depois de já ter gerado o código, não tem como corrigir
  sem recriar o cadastro e migrar Fórmula/BOM na mão.
- **Log de alterações (histórico) só existe em Materiais** —
  `historico_materiais` + `diffParaHistorico()` (`shared/utils.js`) foi
  desenhado genérico o bastante pra reusar em Produtos/Clientes/
  Fornecedores, se algum dia fizer falta lá também.
- **Campo "categoria de uso" (limpeza/EPI/laboratório/escritório) para MU**
  — adiado por decisão do usuário: "só os campos comuns por enquanto".

## Produtos / SKU

- **`public/produtos.html` é uma cópia órfã** da tela de Produtos antiga
  (sem link de navegação, achado por um agente Explore) — tem o MESMO
  mecanismo de rename de SKU que `cadastros.html` só que SEM gravar
  `skusAnteriores`/`sku_historico`. Uma armadilha real se alguém abrir por
  URL direta e renomear um produto por ali. Devia virar redirect fino pra
  `cadastros.html?tab=produtos`, igual as outras páginas já retiradas na
  unificação de Cadastros (Fase 6).
- **`form.html` lê `allProdutosForm[op.sku]` direto**, sem o resolver
  `getProdutoBySku`/`sku_historico` que o resto do app (horizonte.html,
  planejamento.html, compras.html) já usa consistentemente. Risco baixo
  hoje (produto raramente é renomeado), mas é uma inconsistência real.
- **95 produtos com código antigo sem dado suficiente pra migrar pro
  formato novo** (`CAT-CLI-NNNN`) — 77 por cliente ainda sem cadastro em
  Clientes (principalmente MOUTIER, 40 produtos), 15 sem correspondência
  no `Gerador de OPs.xlsm`, 3 com categoria ambígua na planilha. O
  mapeamento categoria+cliente já resolvido nesta sessão pode ser
  reaproveitado se um dia quiserem retomar — mas a decisão atual é manter
  os códigos antigos como estão (risco de renomear em massa não compensa).
- **2 produtos do xlsm sem cadastro em `produtos/`** (`SRM-SEUN-0002`,
  `HDR-MISS-0008`) — ficaram de fora da importação de Fórmula/BOM por não
  terem produto correspondente.

## Fórmulas / BOM / Especificações

- **~78 linhas de Especificações do Gerador de OPs ainda não importadas**
  — 94% já está feito (180 de ~230 produtos), sobrou um resíduo pequeno.
- **531 itens de Fórmula/BOM pendentes de revisão manual** — não é bug, é
  fila de trabalho (material não identificado na importação, com sugestão
  por similaridade already ali pra acelerar). Ninguém está monitorando
  ativamente o "quantos faltam" ainda — talvez um indicador na tela inicial
  de Cadastros fizesse sentido.

## Fórmulas — UX

- Busca de produto (aba Fórmulas/BOM/Especificações) não navega por
  teclado, só mouse.
- Busca de produto não encontra por nome de cliente, só por SKU/descrição.
- Sem indicação visual de que dá pra trocar o produto selecionado sem
  recarregar a página (funciona, só não é óbvio).

## Planejamento / PCP

Trabalho ativo, roteiro completo em `PLANO_PLANEJAMENTO_PCP.md` (não
duplicado aqui) — só os 2 itens que esse plano marcou como fora de
escopo por enquanto:

- **Apontamento de manipulação (rendimento real do batch)** — bloqueado
  por um pré-requisito de PROCESSO, não de sistema: hoje há falha de
  disciplina de pesagem no chão de fábrica, alguns itens nem estão sendo
  pesados. Apontar volume real contra um dado de pesagem que não existe
  de forma confiável geraria número pior que não ter o dado. Retomar só
  depois de resolver a disciplina de pesagem.
- **Alertas sonoros na fábrica / notificação no celular do funcionário**
  quando uma OP atrasa — evolução natural do sistema de alertas por
  e-mail (Fase 4 do plano), cogitada pelo usuário como próximo passo
  "conforme for" amadurecendo, não parte do MVP.
- **E-mail de fim de turno tem % inconsistentes** (`onTurnoEncerrado`,
  `functions/index.js:895`, campos `disponibilidadePct`/performance) —
  reportado pelo usuário como "bem inconsistente". Adiado
  deliberadamente: revisar com calma, caso a caso (provavelmente é mais
  de uma causa raiz, não um bug único óbvio), não durante a implementação
  do plano de Planejamento/PCP.

## Ordens de Serviço / Roteiro de Produção / Estoque de Produto Acabado

Conceito grande, discutido em profundidade com o usuário em 2026-08-28,
adiado explicitamente pra focar primeiro em azeitar Planejamento/PCP/
Apontamento (ver `PLANO_PLANEJAMENTO_PCP.md`). Retomar com calma quando
chegar a vez -- não é só trabalho técnico, é digitalizar um processo que
hoje roda inteiramente em papel, sem sistema nenhum por trás (confirmado
pelo usuário: "hoje não existe esse processo, nosso sistema é bem
defasado, não está sendo utilizado"). Contexto completo, pra não perder
nenhuma decisão já tomada na conversa:

- **Ordens de Serviço "principais"** -- as 5 que já existem hoje via o
  Gerador de OPs em Excel (Separação, Manipulação, Envase, Rotulagem,
  Análise de Qualidade de Bulk/Produto Acabado), hoje "dissolvidas" dentro
  dos postos de trabalho sem formalização própria. Objetivo declarado do
  usuário: internalizar o Gerador de OPs no sistema assim que os cadastros
  estiverem bem povoados (trabalho em andamento nesta sessão).
- **Ordens de Serviço "acessórias"/de transformação** -- NÃO são etapas
  fixas do processo padrão, são trabalho que a empresa quer **minimizar**:
  ocorrem quando um fornecedor não é avisado corretamente da especificação
  e a produção precisa "absorver o custo" transformando um material errado
  no material certo (exemplo real dado pelo usuário: cortar uma válvula de
  120mm pra virar uma válvula de 100mm, porque X assim vira Y, e Y é o que
  o BOM do produto pede). Vínculo com a OP é **indireto**, via material, não
  direto via pedido/OP -- modelo sugerido: tratar como uma "Fórmula/BOM em
  miniatura" (Y = X + trabalho), reaproveitando a estrutura de cadastro que
  Materiais/BOM já têm. Hoje a produção tem autonomia total pra fazer esse
  tipo de trabalho sem registro nenhum -- é dinheiro/tempo perdido invisível,
  provavelmente contaminando qualquer métrica de eficiência sem ninguém
  saber a causa real.
- **Roteiro de produção condicional por SKU + gate de disponibilidade via
  "mínimo entre etapas obrigatórias"** -- alguns SKUs têm etapas que
  legitimamente rodam fora de ordem por restrição de capacidade (exemplo
  real: "fixador de maquiagem" não cabe celofanar em linha, gargalo de
  produção -- envasa tudo primeiro, celofana depois, por fora). Modelo
  proposto: quantidade "pronta pra estoque/faturamento" = a MENOR
  quantidade entre todas as etapas obrigatórias do roteiro daquele produto,
  não importa a ordem em que rodaram. Resolve o problema real relatado: a
  ficha de Envase hoje fica "não finalizada" enquanto não celofana tudo
  (causa confusão e demora no fechamento do lote) porque celofanagem não é
  uma etapa própria, está pendurada dentro do fechamento do Envase.
- **Ficha de Separação hoje mistura dois momentos distintos** -- separação
  de materiais (início da cadeia, ligado à emissão da OP) e conferência de
  produto acabado pra estoque/faturamento (fim da cadeia) -- numa única
  ficha ambígua, preenchida só parcialmente. No modelo novo viram duas
  etapas independentes; a segunda (conferência de produto acabado) deixa de
  ser manual e passa a ser calculada pelo "mínimo entre etapas" acima.
- **Estoque de produto acabado incremental**, alimentado pelo gate acima --
  fecha a lacuna já identificada de "sem estoque de produto acabado" (Fase
  4 só cobre matéria-prima/embalagem consumida; Logística ainda controla
  produto acabado numa planilha separada).
- **Faturamento parcial por acúmulo até gatilho de coleta** -- confirmado
  pelo usuário que faturamento já é parcial na prática (ex: a cada 3.000kg
  acumulados dispara uma coleta e o faturamento correspondente) -- o saldo
  de estoque de produto acabado acima seria o que acumula até bater esse
  gatilho, integrando com o agendamento de coleta que Logística já
  acompanha.

## Estoque / Produção

- **Sem estoque de produto acabado** (finished-goods) — ver seção "Ordens
  de Serviço / Roteiro de Produção / Estoque de Produto Acabado" acima,
  que cobre esse ponto em detalhe (o gate de disponibilidade proposto ali
  é o que alimentaria esse estoque).
- **Devolução ao fornecedor como movimento de estoque** — identificado
  durante o design do estoque físico (Fase 4), nunca implementado. Hoje só
  existe entrada (recebimento), consumo (apontamento), perda e ajuste
  manual.
- **Perda por etapa (Rotulagem vs Envase) E por SKU** ⚠ verificar se ainda
  procede — adiado explicitamente: "temos skus com insumos de menor
  qualidade, o que ocasionam mais perdas, queria tentar capturar e
  mensurar essas variações". É analytics pra depois do cutover das
  planilhas legadas, não construir preventivamente.
- ~~Agendamento em `planejamento.html` parcialmente desconectado do fluxo
  de congelamento de `horizonte.html`/`alocacoes_planejamento`~~ — deixou
  de ser um item de backlog: confirmado e aprofundado (o motor de
  replanejamento automático não produz efeito visível hoje), virou Fase 1
  de trabalho ativo em `PLANO_PLANEJAMENTO_PCP.md`.

## Qualidade (módulo futuro, fora de escopo até agora)

- **Etiqueta interna de liberação de Qualidade** — uma 2ª etiqueta,
  distinta da etiqueta de identificação que o fornecedor cola nas
  caixas/fardos (essa já existe, `PADRAO_ETIQUETA_FORNECEDOR`). Explicitamente
  adiada: "Qualidade vai acabar ficando no próximo módulo".
- **MRP de insumo real + integração do formulário MS Forms "Liberação -
  Embalagens" com o pedido** ⚠ verificar se ainda procede.

## Outros achados antigos — reconfirmar antes de agir

- **OP 26215/01 com `status`/`motivoCancelamento` dessincronizado** ⚠ —
  causa raiz nunca encontrada, identificado bem no início desta sessão e
  nunca revisitado.
- **Gatilho automático de Financeiro na conclusão de um pedido** ⚠ —
  adiado, nunca retomado.
- **`dashboard.html`** ⚠ — usuário queria ver rodando com dado real antes
  de decidir o que mudar; nunca revisitado desde então.
