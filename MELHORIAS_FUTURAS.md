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
- **`insumos.html` — recebimento de insumos sem `.transaction()` (race
  condition, mesma classe do achado crítico de produção)**:
  `executeBatchAllocation` (Alocação em lote) e `recvModalSave`
  (recebimento manual pontual) calculam `qtdRecebida` a partir de uma
  leitura (`.once('value')`) fora de transaction, depois escrevem o
  valor absoluto via `db.ref().update()`. Se Compras registra um
  recebimento manual pontual enquanto o PCP revisa/confirma uma alocação
  em lote do mesmo insumo, um sobrescreve o outro silenciosamente — acha
  crítico da 3ª rodada de auditoria (2026-08-29), documentado com mais
  contexto em `PLANO_PLANEJAMENTO_PCP.md` seção 11. Não corrigido ainda
  porque merece um ciclo próprio com teste dedicado (tela usada por
  Compras, não só PCP).

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
- **Trava dura na lista de "Alocar OP" (`form.html`)** — hoje a lista só
  guia (ordenada por prioridade + selo "Próxima recomendada"), mas
  produção ainda pode escolher qualquer OP livre, não só a programada
  pra aquela linha. Adiado conscientemente pelo usuário ("bate, fica
  legal por hora"): travar de verdade exigiria confiar em `ops.linha`
  pra saber "essa OP é dessa linha", mas esse campo é sobrescrito toda
  vez que alguém aloca (reflete última alocação física, não programação)
  — travar contra ele esconderia OPs válidas ainda sem linha definida,
  pior que o problema atual. Retomar quando o modelo de blocos por OP da
  Fase 6 (`PLANO_PLANEJAMENTO_PCP.md`) existir, com vínculo OP↔linha
  confiável desde a programação — nesse ponto também vale pensar num
  "escape hatch" pro PCP resolver exceção na hora, sem travar produção
  de verdade se o dado estiver incompleto.
- **Modal "Encerrar OP" (Painel de Turno, `form.html`) — mensagem de erro
  ambígua em falha parcial**: `fecharAlocacaoOP` já grava
  `status:'Concluído'` no Firebase antes de `salvarPerdasEncerrarOP`
  rodar; se só a escrita de perdas falhar (rede instável), o operador vê
  "Erro ao encerrar OP" mesmo com a OP já encerrada de verdade — e uma
  nova tentativa erra de novo com "Essa OP não está mais aberta",
  contradizendo a primeira mensagem. Achado da 4a rodada de auditoria
  (2026-08-29). Vale separar a mensagem desse cenário específico
  ("OP encerrada, mas falha ao salvar perdas — registre manualmente").
- **Campo "Operador" obrigatório só em alguns dos 3 fluxos de Encerrar
  OP**: Painel de Turno exige; "Fechar Lote" (Modo Avançado) nunca grava
  responsável nenhum. Achado da 4a rodada — não é bug, é decisão de
  design ainda não tomada (Painel de Turno = multi-operador vs. Modo
  Avançado = uso administrativo?). Decidir ao unificar os 3 fluxos
  (Fase 3, já mapeado em `PLANO_PLANEJAMENTO_PCP.md`).

## Admin / Configuração

- **`admin.html` — `saveConfig()` regrava o nó `config` inteiro a cada
  pequena edição** (`db.ref('config').set(dataToSave)`, chamado por
  praticamente todo botão da página): se dois admins editarem `config`
  quase ao mesmo tempo — um em `admin.html`, outro em `planejamento.html`
  (`config/planejamento`) ou `cadastros.html` (`config/categoriasProduto`)
  — o último `.set()` vence e apaga silenciosamente a mudança do outro,
  porque cada `.set()` parte de um snapshot em memória que pode já estar
  velho. Achado da 4a rodada de auditoria (2026-08-29), confirmado por 2
  agentes independentes. Não corrigido nesta rodada porque a correção
  correta é trocar `.set()` por `.update()` com paths escopados
  (`config/linhas`, `config/turnosExtras/{key}` etc.) em cada um dos ~10
  pontos de chamada — mudança maior, merece ciclo próprio com teste
  dedicado (é a tela mais usada pra configuração global do sistema).
- **Duplicação da regra "dia útil"** (`admin.html`): calculada de forma
  independente em `renderMetasPorLinha()` e `calcDiasUteis()`. Se a regra
  mudar (ex: feriados por linha), fácil corrigir um e esquecer o outro.
- **Listas de config mortas**: "Produtos / Itens" (`config.produtos`) e
  "Operadores" (`config.operadores`) em `admin.html` não são lidas por
  nenhuma outra página do app (confirmado por busca em todo `public/`).
  "Produtos / Itens" tem nome quase idêntico ao catálogo real de
  produtos (`produtos/`, gerenciado em `cadastros.html`) — confuso, um
  admin pode achar que está populando o catálogo. Candidato a remoção,
  ou esclarecer se há uso planejado.
- **Cores de UI hardcoded ignoram o tema escuro** (`admin.html`,
  `dashboard_analise.html`): `.tag.linha`/`.tag.posto`/`.alert-success`/
  `.alert-danger`/`.matrix-table tr:hover`/`.meta-totals` (admin.html) e
  `.bar-row .lbl`/`.bar-row .bar` (dashboard_analise.html) usam hex fixo
  de fundo/texto claro em vez dos tokens de tema já definidos nesses
  mesmos arquivos — em modo escuro viram "ilhas" claras ou texto de
  baixo contraste sobre fundo preto.

## Acessibilidade (varredura pendente)

Achados da 4a rodada de auditoria (2026-08-29), nenhum corrigido ainda —
é trabalho mecânico mas espalhado (dezenas de campos), merece um passe
dedicado por tela em vez de fixes pontuais:

- **`admin.html`**: zero `<label>` com `for=` no arquivo inteiro (~35
  labels) — nenhum campo de texto/data/número tem nome acessível pra
  leitor de tela (só os checkboxes de dias da semana, que aninham
  `<input>` dentro do `<label>`, estão corretos). Os 9 campos de
  "tag-add" (Linhas, Rotulagem, Postos, Motivos de Parada, etc.) não têm
  label nenhum, nem visual.
- **`dashboard_analise.html`**: mesmo padrão (Período, Cliente,
  Categoria, Sub-categoria, Viscosidade, Linha, Status, Tipo de serviço,
  Busca, Agrupar por — nenhum ligado por `for=`). Dropdowns
  multi-seleção customizados (`setupMultiSelect`) não fecham com Esc, só
  clicando fora com o mouse — ruim pra quem usa teclado (equipe de
  PCP/escritório, uso plausível nesta tela específica).

## Limpeza de código (stubs legados)

- **`produtos.html`/`clientes.html`/`formulas.html`/`materiais.html`
  são stubs de redirect** (`location.replace(...)` pra `cadastros.html`)
  que ainda carregam ~1000 linhas cada da implementação antiga completa
  por trás — nunca executa pro usuário (o redirect já navegou a página
  antes do `DOMContentLoaded` disparar essa lógica), mas gera leituras
  desnecessárias no Firebase por uma fração de segundo a cada acesso, e
  é peso morto pra manutenção (alguém pode abrir o arquivo errado achando
  que é a versão viva). Achado da 4a rodada — padrão repetido
  deliberadamente (não é acidente isolado), mas vale reduzir a um stub
  mínimo sem SDK/lógica de negócio, ou marcar visivelmente como legado.
- **`admin.html:405-409`**: `calcDias(ini, fim)` definida mas nunca
  chamada (`calcDiasUteis()` é usada no lugar) — código morto, remover.

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
