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

## Integração entre setores (auditoria de 2026-09-08)

Os gargalos de comunicação entre entidades estão levantados em documento
próprio: **`AUDITORIA_INTEGRACAO.md`**, na raiz do repositório. Nove elos, cada
um com a evidência no código e o número lido de produção.

Os três que valem agir primeiro, e por quê:

- **Selo de qualidade do fornecedor na cotação** — `desempenhoQualidadeFornecedor`
  já existe em `shared/utils.js` e tem UMA única chamada em todo o sistema
  (`qualidade.html:1252`). O comprador compara orçamentos sem ver que o
  fornecedor reprovou lote. Falta só exibir.
- **"Gerar solicitação de compra" na Matriz de Insumos** — `insumos.html` calcula
  a falta e `compras.html` nunca lê o nó `insumos`; nem `insumos.html` referencia
  `solicitacoes_compra`. Não há caminho de ida nem de volta: o MRP existe pra
  antecipar a falta e a informação não chega a quem compra.
- **Área de endereço para quarentena** — `config/areasEndereco` tem cinco áreas
  (GAL, FAB, ROT, MP, MUC) e nenhuma de retenção. O status separa no sistema,
  nada separa no chão. É cadastro, não código, e precisa existir antes do Dia D.

Registrado junto, com número: dos **906 materiais cadastrados, só 37 têm
qualquer registro de estoque, e 11 desses estão com saldo NEGATIVO** (pior caso
ET-00012, −538.784 un). O consumo desconta corretamente a cada apontamento; o
que falta é a entrada. Isso torna o saldo inutilizável como base de decisão até
o Dia D — e é o motivo de "mostrar saldo em Compras" NÃO ser a primeira
correção da lista, apesar de ser a mais fácil.

---

## Compras

- **NCM no cadastro de material** — o NCM é o que determina as alíquotas de
  IPI e de ICMS-ST. Hoje o cadastro de material **não tem o campo** (grep em
  `cadastros.html`: nenhuma ocorrência), então na cotação alguém digita a
  alíquota de cabeça a cada orçamento, item a item, fornecedor a fornecedor.
  Isso é erro esperando pra acontecer num número que decide qual fornecedor
  ganha a compra.
  Veio da rodada do orçamento de cotação (2026-09-08, commit `63f527c`), que
  passou a comparar por **custo** (com IPI/ST/frete/crédito) em vez de por
  preço — o cálculo está pronto e testado, o que falta é a origem confiável
  das alíquotas.
  **Escopo sugerido:** campo `ncm` em Materiais; opcionalmente `ipiPadrao` e
  `icmsStPadrao` por material, para o modal fiscal da cotação
  (`abrirModalFiscal`, `compras.html`) já abrir pré-preenchido — a pessoa
  confirma em vez de digitar. Mesmo princípio da condição de pagamento, que
  nessa rodada passou a vir pronta do cadastro do fornecedor.
  **Cuidado:** alíquota varia por estado de origem/destino e por regime; o
  campo do material é um **padrão sugerido**, nunca uma trava — o valor da
  cotação tem que continuar editável.

- **Anexo da proposta do fornecedor (PDF) na cotação** — não é só trabalho
  de tela: **o Firebase Storage não está configurado no projeto**. Conferido
  em 2026-09-07: não existe `storage.rules`, `firebase.json` não tem a chave
  `storage`, e nenhuma tela do sistema faz upload de arquivo (`grep` por
  `firebase.storage` e `input type="file"`: zero ocorrências).
  Ou seja, é um pré-requisito de infraestrutura, não uma melhoria pontual —
  e quando for feito, destrava de uma vez vários itens que hoje estão
  bloqueados pelo mesmo motivo: **certificado de calibração** e **foto em
  RNC** (módulo de Qualidade), **PDF do COA**, e o **arquivo de etiqueta**
  logo abaixo.
  **Escopo sugerido:** habilitar Storage, escrever `storage.rules` no mesmo
  padrão por papel/módulo do `database.rules.json`, e criar um componente de
  upload reutilizável — fazer upload isolado só pra cotação seria pagar o
  custo da infraestrutura e aproveitar um caso só.
  **Decidir antes:** limite de tamanho, tipos aceitos, e por quanto tempo o
  arquivo é guardado (proposta de fornecedor tem valor probatório em disputa
  comercial, diferente de um anexo qualquer).

- **Lista dos 11 campos da etiqueta está DUPLICADA** — `PADRAO_ETIQUETA_FORNECEDOR`
  vive em `shared/utils.js` e a mesma lista está escrita de novo dentro de
  `functions/index.js` (`criarRascunhoCotacao`), com um comentário admitindo
  a cópia: *"Mesma lista de PADRAO_ETIQUETA_FORNECEDOR em
  public/shared/utils.js"*. Quem mudar num lugar não muda no outro, e o
  e-mail ao fornecedor passa a pedir uma etiqueta diferente da que o
  recebimento confere.
  A Cloud Function não consegue importar de `public/`, então a correção é
  mover a lista pra um módulo compartilhado (ou gerar o texto do e-mail no
  cliente e passar pronto pra function). Achado ao construir o documento
  impresso do PC (2026-09-08).

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
- **Sincronizar OP arrastada (Planejamento de OPs) com as horas
  programadas do pedido (Planejamento de Quantidades)** — hoje são duas
  fontes independentes pra essencialmente a mesma informação: o arrasto
  de uma OP (`planejamento.html`, seção "pós-plano") só grava
  `dataInicioPlanejada`/`dataFimPlanejada`/`linha` na própria OP, sem
  tocar nos slots de `programacao/` que a Grade de Quantidades usa pra
  mostrar "Horas Programadas"/"Programado na Semana" daquele pedido. Se a
  OP esticar/encolher/mudar de horário, os dois números podem passar a
  discordar sem ninguém perceber. Usuário apontou o risco e confirmou a
  direção pra quando isso for implementado: **sincronização automática
  nos dois sentidos** — arrastar a OP livre, mas a mudança se propaga
  sozinha de volta pra reescrever os slots de `programacao/` daquele
  pedido/dia/linha (não trava o arrasto, não exige reconciliação manual).
  Adiado deliberadamente pelo usuário ("tirar a trava da programação por
  ora... deixar isto como melhoria pra depois, quando tivermos a operação
  mais madura") — por enquanto o arrastar de OP fica sem nenhuma
  validação cruzada com a Grade de Quantidades. Ao retomar: como um
  pedido pode virar N OPs (Fase 6), o design final precisa decidir como
  atribuir/dividir os slots de `programacao/` entre múltiplas OPs do
  mesmo pedido sem um já ter uma noção de "quais horas são minhas" hoje —
  provavelmente reaproveitando a técnica de distribuição exata já usada
  em `applyExactQtdToWeekSlots`/`writeLoteIntoWeekSlots`, com detecção de
  conflito (não sobrescrever silenciosamente slot de outro pedido) antes
  de gravar.
  **Atualização (2026-08-31, Fase 1 de "Emissão de OP nativa" — ver
  `PLANO_PLANEJAMENTO_PCP.md` seção 22):** o momento da EMISSÃO agora
  vincula certo (`emitir_op.html` grava `skuPedidoKey` e consome
  `qtdConsumida` da alocação) e auto-programa a posição inicial na Grade
  de OPs. **O gap descrito acima continua exatamente igual** — é sobre o
  que acontece DEPOIS, quando a OP já emitida é arrastada/redimensionada;
  isso ainda não toca em `programacao/` nenhum. As duas telas seguem
  podendo divergir a partir do primeiro arrasto.
- **Zona fixa rolante (`config/congelamento.diasFixos`) desligada por
  ora** — desativada em produção (`diasFixos: 0`, valor gravado direto no
  Firebase em 2026-08-31, sem mudança de código) a pedido do usuário, no
  mesmo espírito do item acima: mecanismo de proteção fazia sentido numa
  operação mais madura, mas por ora é atrito sem benefício claro.
  Mecanismo original: `autoAjustarPlanejamento` (`auth_check.js`)
  protegia da reshuffle automática qualquer slot de `programacao/` já
  preenchido dentro dos próximos N dias (padrão 7, nunca tinha sido
  configurado diferente — não eram "duas semanas" como o usuário lembrava,
  mas o mesmo mecanismo). Com `diasFixos:0`, esse desconto de segurança
  extra deixa de existir — o motor pode reshufflar slots preenchidos até
  pra hoje/amanhã. Continua intacta a ÚNICA proteção que não depende
  dessa config: slots com OP DE VERDADE já emitida (`vinculadoSet`,
  baseado em `alocacoes_planejamento`) nunca são tocados pelo reajuste
  automático, isso é estrutural, não uma janela de tempo. Retomar
  reativando a zona fixa (valor razoável pra começar: os mesmos 7 dias
  do padrão anterior, configurável em Admin → "Congelamento") quando a
  disciplina de apontamento/planejamento estiver mais consolidada.

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
- **Salvar as 5 fichas de `emitir_op.html` direto na pasta de rede do
  Gerador de OPs** — pedido do usuário, adiado deliberadamente como
  melhoria futura. Confirmado que não é possível vindo do navegador
  (sem acesso a caminho de rede, restrição do próprio browser) e que
  **não existe hoje** nenhuma automação de "e-mail chega → salva na
  pasta" pra esse fluxo (conferido direto no VBA: `GerarOP_PDF` usa
  `ExportAsFixedFormat`, um write direto em disco a partir do Excel
  rodando como desktop app com a rede mapeada — não passa por e-mail
  nenhum). Pra fazer isso funcionar de verdade faltam duas peças, nenhuma
  construída ainda: (1) geração de PDF real no servidor (hoje só existe
  a visualização HTML de impressão, `montarDocumentoImpressao()`) --
  precisaria de uma Cloud Function com alguma lib de PDF (ex: Puppeteer);
  (2) algo observando uma caixa de e-mail e salvando anexos na pasta —
  não existe nada assim hoje pra este fluxo, precisaria descobrir se a
  Kuryos já tem Power Automate/licenciamento M365 pra isso ou se também
  entra do zero. Enquanto isso, o caminho manual (Salvar como PDF do
  próprio navegador na hora de imprimir) já funciona sem infra nova.
- **Etiqueta de caixa de embarque maior, com mais informações** — hoje
  fixa em 90x55mm (padrão real informado pelo usuário). Usuário: "estamos
  avaliando ajustar pra ter uma etiqueta maior, com mais informações. Por
  hora mantemos, mas deixe no repo de melhorias". Se/quando confirmado,
  precisa de um layout novo (mais espaço = pode caber mais campos, não é
  só esticar o atual) e, se surgir necessidade real de trocar de tamanho
  com frequência (ex: por cliente), um seletor de dimensão em vez de um
  valor fixo no CSS -- discutido e adiado deliberadamente por enquanto
  (dimensão única é mais simples e menos sujeita a erro).
- **Código de barras DUM14 (ITF-14)** — hoje a etiqueta usa só EAN13 do
  produto (`shared/utils.js`, `ean13Svg`). Confirmado via Firebase CLI
  que `dum14` está preenchido exatamente nos mesmos 28 produtos que têm
  `ean13` (nunca um sem o outro, nos 373 produtos reais) -- por isso não
  há ganho prático em implementar DUM14 agora. Se um dia existir produto
  com DUM14 mas sem EAN13, seria necessário implementar o padrão ITF-14
  (Interleaved 2 of 5 numérico, diferente do EAN13/Code 39 já
  implementados) do zero.

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
- **`cadastros.html`/`logistica.html`/`emitir_op.html`** (achado da 5a
  rodada): mesmo padrão confirmado — `cadastros.html` tem 130 labels, 0
  usam `for=`; `logistica.html`/`emitir_op.html` têm 0 ocorrências de
  `label for=`. Nenhum dos três trata Escape pra fechar modal (só botão
  × ou clique fora).

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

## Segurança / Regras de Acesso

- **Desmarcar um módulo não revoga a ESCRITA no banco** (limite conhecido,
  aceito ao publicar o acesso por módulo em 2026-09-07). Os checkboxes por
  usuário valem nas duas pontas, mas de forma **aditiva**: a regra do banco
  virou `(papel de antes) || (tem o módulo X)`. Ou seja, marcar um módulo
  **concede** escrita de verdade; desmarcar tira a tela do menu e bloqueia
  a página, mas o papel continua valendo no servidor. Um usuário `pcp` com
  "Logística" desmarcada não alcança a tela, porém o token dele ainda
  gravaria em `estoque` por chamada direta ao SDK.
  Fechar isso exige trocar papel por módulo NAS REGRAS, com o fallback
  "sem `modulos` gravado → usa o papel" expresso em cada uma das ~46
  expressões (`root.child('usuarios').child(auth.uid).child('modulos').exists()`).
  É expressável, mas é migração de risco alto num sistema em uso diário —
  um erro tranca a fábrica. Fazer só com o emulador de regras rodando os
  casos, nunca direto em produção.
  **Pré-requisito:** decidir antes se `modulos` passa a ser obrigatório em
  todo usuário (o que elimina o fallback e simplifica muito as regras).

Achado da 5a rodada de auditoria (2026-08-29). Não é um bug — é uma
decisão consciente pendente de confirmar com o usuário:

- **`auth_check.js` bloqueia por página, `database.rules.json` não
  bloqueia por papel nos mesmos dados** — `pageAccessRules` impede
  `production`/`rotulagem`/`rh`/`gestor` de abrir `cadastros.html`/
  `compras.html`/`insumos.html`, mas as regras do banco dão
  `.read: "auth != null"` sem checar papel pra `materiais`, `clientes`,
  `fornecedores`, `cotacoes`, `pedidos_compra`, `estoque`, `insumos`
  etc. — qualquer papel autenticado consegue ler esse dado inteiro via
  chamada direta ao SDK no console do navegador, mesmo sem conseguir
  abrir a página. Diferente do achado de RH (que vazava dado sensível de
  pessoas e permitia escalação de privilégio, já corrigido), isso é dado
  de negócio interno (materiais, clientes, compras) — decidir se a
  equipe pequena/confiável da Kuryos torna isso aceitável ou se vale
  fechar por papel nas regras também.
- **`ops.html`/`historico.html` não incluem `rotulagem` em
  `pageAccessRules`, mas as regras do banco permitem escrita de
  `rotulagem` em `ops`/`registros`** — direção seguraconservadora (client
  bloqueia mais do que o servidor permitiria), mas pode ser um bug
  funcional: papel Rotulagem sem UI pra uma ação que a regra já autoriza.
- **`functions/index.js:27` (`checkApiKey`)** — comparação de API key
  usa `!==` (não constant-time). Risco teórico de timing attack, difícil
  de explorar sobre rede real; ajuste cosmético (`crypto.timingSafeEqual`)
  se quiser fechar de vez.
- **`functions/index.js:296` (`criarPedido`)** — sem cap no tamanho de
  `body.itens`; só explorável por quem já tem a API key (o macro VBA
  confiável), risco real baixo.
- **`cadastros.html` — race conditions de baixo risco em toggles/arrays
  sem `.transaction()`**: toggle "Revisado" de Fornecedores (linha 2609)
  e Fórmulas (linha 3544) fazem `.set(!valorAtual)` a partir do cache
  local; add/toggle/remove de Categorias (linhas 2817-2863) regrava o
  array `config/categoriasProduto` inteiro a partir do snapshot em
  memória. Dois cliques quase simultâneos podem fazer um "pular"/perder o
  do outro. Campos de baixo risco (não são dado financeiro/quantidade).
- **`cadastros.html` — performance da aba Fórmulas/BOM/Materiais**:
  `formulas`/`bom`/`produtos`/`especificacoes` são carregados por
  inteiro e o listener nunca é desmontado ao trocar de aba — editar a
  fórmula de QUALQUER produto, de qualquer sessão, dispara
  `renderTable()` completo em Materiais (mesmo em background) e
  `selecionarVersao()` completo em Fórmulas (reconstrói o `tbody`
  inteiro), podendo derrubar o foco/estado de quem está digitando outra
  fórmula ao mesmo tempo em outra sessão. Não corrigido — precisaria de
  listeners escopados por produto/versão, mudança estrutural maior.
- **`emitir_op.html:487` — substituição de material usa `prompt()`
  nativo** (digitar o código exato de cor, sem autocomplete) em vez do
  padrão de busca com autocomplete usado no resto do app pra qualquer
  seleção de material — único ponto da emissão de OP (fluxo crítico,
  decide o que é consumido no lote) com esse padrão mais sujeito a erro
  de digitação.

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

## WMS — lacunas vs. TOTVS/SAP (auditoria geral de 2026-09-05)

Varredura completa do app cruzando código com o banco de produção. Os 3
achados críticos dessa auditoria **já foram corrigidos** (ciclo de baixa do
WMS, vínculo Produto↔Cliente, Matriz de Insumos derivando do BOM — commits
`7d75182`, `8c2166f`, `d643589`). O que segue é o que foi mapeado e
**deliberadamente não construído** nessa rodada, em ordem aproximada de
valor. A Fase 1+2 entregaram a espinha certa (endereçamento rua×nível×prédio,
lote com validade, FEFO, movimentação auditada); isto abaixo é o que mantém
um WMS *confiável ao longo do tempo*, que é onde os sistemas de mercado
realmente ganham.

- ~~**Inventário rotativo (contagem cíclica)**~~ — **FEITO** (`d33fced`).
  Aba "📋 Inventário Rotativo" em `estoque.html`, com contagem CEGA (o
  esperado só aparece depois de informar o contado), rodízio por "há mais
  tempo sem contar + posição ocupada", e ajuste que rateia falta em ordem de
  validade sem tocar o saldo agregado.
- **Numeração de rua é GLOBAL, não escopada por área** ⚠ **bloqueia povoar as
  outras áreas** — `estrutura_ruas/{codigoRua}` e o código do endereço é
  `rua.nivel.predio`, sem prefixo de área. Hoje as 236 posições estão todas
  em GALPÃO; as outras 4 áreas configuradas (FÁBRICA, RÓTULOS, MATÉRIA PRIMA,
  MATERIAL DE USO E CONSUMO) não têm nenhuma. Quando forem cadastradas, a
  "Rua 1 da fábrica" vai colidir com a "Rua 1 do galpão" (`estoque.html`
  recusa com "Já existe uma rua com esse número") e será preciso numerar a
  fábrica como 7, 8, 9… — confuso pra quem está no chão chamando de "rua 1".
  **Este é o momento mais barato de decidir**: `estoque_lotes` está vazio e
  nenhuma etiqueta de endereço foi impressa ainda. Opções: (a) prefixar o
  código com a área (`GAL-1.2.3`, `FAB-1.2.3`), (b) escopar a chave por área
  (`estrutura_ruas/{area}/{rua}`), ou (c) aceitar numeração contínua e
  documentar. Depois de imprimir etiqueta e endereçar material, mudar isso
  custa recadastrar tudo.
- **Leitura de código de barras / coletor** — endereçamento, separação e
  contagem são 100% digitados, a maior fonte de erro em WMS manual. O app
  **já gera EAN13 e Code39** (`ean13Svg`, `shared/utils.js`) e já traz
  `shared/qrcode-lib.js` — etiqueta de endereço + leitura pela câmera do
  celular é um passo curto a partir do que existe. Adiado explicitamente pelo
  usuário nesta rodada ("só o coletor que eu colocaria no repo de melhorias").
- **Tipo de posição (picking × pulmão)** — adiado explicitamente pelo usuário:
  *"não separar por ora, quero primeiro começar a operação, depois
  aperfeiçoar"*. Quando retomar, o dado real já favorece derivar do nível em
  vez de configurar 236 posições: o galpão tem 88 posições no nível 1 (chão,
  picking natural) e 148 nos níveis 2 e 3 (porta-palete, pulmão). É
  pré-requisito de reabastecimento e de otimização de percurso.
- **Capacidade da posição** — adiado explicitamente pelo usuário ("deixar pra
  depois"). Sem capacidade não há como o sistema avisar que a posição não
  comporta — hoje só se descobre no chão. Se/quando entrar, o desenho de
  menor atrito é **por rua** (6 números a preencher, herdados pelas
  posições), não por posição. Cuidado com a lição do campo `ativo`: campo que
  ninguém preenche é campo morto.
- **Reabastecimento (pulmão → picking)** — depende do tipo de endereço
  acima. É o que evita o separador subir no porta-palete pra buscar item de
  giro alto.
- **Contagem por papel de armazém** — a aba de Inventário mora em
  `estoque.html`, que é admin/pcp. Quem conta fisicamente no galpão tende a
  ser `production`. Abrir a contagem pra esse papel exige mexer em três
  coisas juntas, senão vira permissão pela metade: `pageAccessRules` de
  `estoque.html`, e o `.write` de `contagens_inventario` **e** de
  `enderecos_estoque` (a contagem grava `ultimaContagemEm` na posição, no
  mesmo update atômico). Faz par natural com o coletor.
- **Onda de separação (wave picking)** — a Separação hoje é uma OP por vez.
  TOTVS/SAP agrupam N ordens numa onda e ordenam por percurso no armazém.
  Com o galpão a 800m da fábrica, agrupar as OPs do dia numa viagem só é
  ganho direto e mensurável.
- **Conferência / duplo-check na separação** — quem separa confirma o
  próprio trabalho. O padrão de mercado separa separador e conferente, e é
  justamente o modelo que o usuário já descreveu pra manipulação (pesagem →
  conferente). Vale nascer igual aqui.
- **Quarentena com endereço físico** — o lote já tem `status: QUARENTENA` e o
  FEFO corretamente o ignora. Falta o outro lado: um endereço bloqueado de
  verdade onde esse material fica, pra que a separação física também não o
  alcance (o bloqueio de posição de `a8f5fc0` já dá a primitiva).
- **`opcoesEnderecoSelect` triplicado** — a mesma função de montar o
  `<select>` de endereços existe em `estoque.html:798`,
  `separacao_materiais.html:249` e `logistica.html:487`, e **já divergiram**
  (a de Logística tem "Sem endereço", as outras não). Qualquer regra nova de
  endereço vai precisar ser lembrada em 3 lugares. Candidato direto a subir
  pra `shared/utils.js`.

## MRP — o que falta pra ser MRP de verdade

`insumos.html` deixou de ser uma lista digitada à mão (commit `d643589`:
deriva do BOM, grava `mpCodigo`, mostra saldo disponível por item). Falta:

- **Necessidade líquida completa** = bruta − disponível − em trânsito +
  estoque de segurança. Hoje a tela já mostra o disponível
  (`saldoAtual − saldoEmpenhado`) como referência visual, mas o número que
  ela grava como necessidade continua sendo o **bruto** do BOM. O passo
  seguinte é gravar o líquido, ou pelo menos oferecer os dois.
- **"Em trânsito" não existe como conceito** — pedido de compra já colocado
  mas não recebido não entra em conta nenhuma.
- **Estoque de segurança não existe** por material.
- **`saldoEmpenhado` não influencia decisão de compra** — o empenho funciona
  (emissão de OP reserva, apontamento baixa) e é exibido em `estoque.html` e
  agora em `insumos.html`, mas nenhum cálculo de compra usa o disponível
  real. O dado está pronto e não é consumido.

## Organização / navegação (auditoria geral de 2026-09-05)

- **`horizonte.html` está no limbo** — foi tirado do menu por decisão do
  usuário ("não é usado"), mas segue publicado, com regra de acesso válida
  em `pageAccessRules`, e continua gravando em `alocacoes_planejamento` —
  nó que `autoAjustarPlanejamento` lê pra decidir o que **não** pode
  remanejar. Alguém que abra por URL pode congelar capacidade no
  planejamento sem que isso apareça em menu nenhum. Decidir: aposentar de
  vez, ou trazer de volta com propósito claro. Deixar no limbo é o pior dos
  três.
- **Categoria/subcategoria de produto repetem o padrão que Cliente tinha** —
  `config/categoriasProduto` existe como cadastro real (e o gerador de SKU
  usa), mas o campo gravado no produto continua sendo texto livre com
  datalist montado dos valores já usados. Mesma mecânica que gerou 67% de
  clientes órfãos, em escala menor. A correção é a mesma já aplicada em
  Cliente (`8c2166f`): resolver uma chave e avisar quando não casar.

## Qualidade

O módulo **existe e está em produção** desde 2026-09-07 (`fc9760f`):
`qualidade.html`, papel de acesso `qualidade`, fila de inspeção com plano de
inspeção herdado da especificação cadastrada, RNC com vínculo automático ao
fornecedor e painel de desempenho por fornecedor. Cobre o recebimento e a
liberação de palete — as Fases 1 e 2 da spec `ERP_Kuryos_Modulo_CQ_v1.1`.

### Inventário contra a spec (levantado em 2026-09-08)

A própria spec traz uma lista de desenvolvimento (seção 9) com **45 itens**.
Conferido item a item contra o código: **5 prontos, 7 parciais, 33 não
começados.** O que está pronto é a espinha — o fluxo de decisão (lote entra
em quarentena, alguém julga, o status muda e a fábrica respeita). O que
falta são os roteiros de inspeção estruturados.

**Os 3 bloqueadores.** Nenhum é do módulo de Qualidade, e a maior parte do
que falta depende deles. Ler antes de planejar qualquer fase nova:

- **Ordem de Manipulação (OM) não existe como entidade** — CK-3 (assépsia de
  tachos), análise de bulk e 3 dos hard stops da spec são "por OM". Sem a
  entidade não há onde pendurá-los.
- **Tarefas Pendentes não existe** — as 14 tarefas CQ-01..CQ-14 com SLA, o
  temporizador de ronda de 2h e o escalonamento em 30min pressupõem essa
  arquitetura. Hoje só existe `alertas_pendentes`, que é fila de e-mail, não
  tarefa com responsável e prazo.
- **Anexo de arquivo não existe** — bloqueia foto em RNC, certificado de
  calibração e PDF do COA. Mesmo bloqueador do anexo de proposta em
  **Compras** (ver acima): resolver o Storage uma vez destrava os dois.

**Os 8 checklists (spec 2.2):** 1 parcial de fato, 7 inexistentes.

| | Checklist | Situação |
|---|---|---|
| CK-1 | Recebimento de Insumos | ⚠ Campos existem (veículo, embalagem, integridade, vazamento, certificado) mas **não é adaptativo por sub-tipo** — a spec pede seções diferentes para frasco, tampa, válvula, rótulo, cartucho, display, celofane |
| CK-2 | Recebimento de MP/Fragrâncias | ⚠ Laudo com plano de inspeção existe, mas **sem pré-verificação documental** (NF × PO, COA do fornecedor, FISPQ) e **sem comparativo com a retenção anterior** |
| CK-3 | Assépsia — Manipulação | ❌ depende de OM |
| CK-4 | Assépsia — Linha de Envase | ❌ |
| CK-5 | Setup de Linha / First Article | ❌ |
| CK-6 | Ronda de Linha (2h) | ❌ depende de Tarefas Pendentes |
| CK-7 | Liberação de Palete | ⚠ A **decisão** existe e funciona; o **roteiro de verificação** não |
| CK-8 | Higiene, Ambiente e Calibração | ❌ |

**Entidades (spec 2.x):** existem RNC e o plano de inspeção herdado da ficha
técnica. Faltam 4:

- **RA (Registro de Análise)** — hoje o laudo mora *dentro* do lote
  (`estoque_lotes/{item}/{lote}/qualidade`), sem numeração própria
  `RA-{AAAAMMDD}-{seq}`, sem tipo e sem NF de origem. **Todo o resto da spec
  referencia o RA como chave** — é a entidade que mais custa não ter.
- **RET (Amostra de Retenção)** — a planilha "Controle da Retenção" segue
  fora do sistema. Prazo de guarda: MP/fragrância 6 meses do recebimento, PA
  validade + 6 meses (a spec pede validar contra a ANVISA antes de
  configurar, especialmente Grau 2 — protetor solar, repelente).
- **Instrumentos de Calibração** — nada. Precisa de anexo (certificado PDF).
- **Trilha de status de lote** — o status muda e o movimento é logado em
  `movimentos_estoque`, mas não há o registro explícito "de X para Y, por
  quem, quando" que a spec pede.

**Automações (spec 9.3):** 1 de 10. Funciona a comparação automática do
resultado contra a faixa da especificação. Não funcionam as outras nove.

**Bloqueios obrigatórios (spec 7.1):** 1 de 8. Só "insumo em quarentena não
é enxergado pela separação" está implementado (via `loteDisponivel()`). Os
outros 7 dependem de OM, CK-3/4/5/8 ou do RA.

**Documentos (spec 9.4):** 0 de 4. Nenhum COA, nenhum comunicado de RNC ao
fornecedor, nenhuma etiqueta de status de lote ou de palete.

**Integrações (spec 9.5):** 2 de 6 prontas — CQ→WMS (liberação governa
separação, consumo e expedição) e CQ→Compras (histórico alimenta
homologação). Faltam CQ→PCP/Produção, CQ→Retrabalho (módulo não existe),
CQ→Comercial/COA, e a tarefa de análise no recebimento.

### Sequência sugerida

Não construir CK-3 a CK-6 agora: são "por OP/OM" e a produção ainda não
aponta contra Ordem de Manipulação — o checklist ficaria sem âncora, que foi
exatamente o que manteve o módulo inteiro decorativo até setembro/2026.

Ordem que gera valor sem depender de nenhum bloqueador:

1. **Preencher as faixas de pH e densidade** no cadastro (ver item abaixo) —
   puro ganho, zero código.
2. **Revisar quais ensaios são críticos** (ver item abaixo).
3. **CK-1 adaptativo por sub-tipo** — é a inspeção que a Logística mais faz,
   e não depende de OM nem de Tarefas Pendentes.
4. **RET (retenção)** — substitui uma planilha real que existe hoje, e só
   depende do que já temos.

Ronda, assépsia, setup, calibração e COA ficam para depois da Ordem de
Manipulação.

### Itens avulsos

- **Etiqueta interna de liberação de Qualidade** — uma 2ª etiqueta,
  distinta da etiqueta de identificação que o fornecedor cola nas
  caixas/fardos (essa já existe, `PADRAO_ETIQUETA_FORNECEDOR`). Explicitamente
  adiada: "Qualidade vai acabar ficando no próximo módulo".
- **Faixas numéricas nas especificações** — dos 1.323 ensaios cadastrados,
  só **26% têm mínimo/máximo** preenchidos como número; nos outros 74% a
  avaliação fica com o analista. Boa parte é legítima ("aspecto", "cor",
  "odor" não viram número), mas **115 registros de pH e 48 de densidade
  estão sem faixa** — são grandezas medidas, com a faixa escrita só no texto.
  Preencher é trabalho de cadastro, não de código, e é o que mais aumenta o
  que o sistema consegue conferir sozinho no laudo.
- **Revisar quais ensaios são críticos** — só **3 ensaios em 181
  especificações** estão marcados como críticos. É a marcação que decide se
  um desvio para o lote; provavelmente subestima a realidade.
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
