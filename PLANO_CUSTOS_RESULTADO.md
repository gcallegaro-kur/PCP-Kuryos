# Custos e Resultado: LP, LPD, metas e bonificação

**Rascunho de 26/10/2026, revisto em 27/10/2026.** Revisão do plano de 20/10, adaptada ao sistema
para onde a fábrica vai migrar (banco `erpkuryos`, CRM integrado). Números medidos nessa base em
26/10, salvo indicação.

**Base de construção (decidido em 27/10):** a fábrica migra para o `erpkuryos`, e o plano é
construído lá. O `prod-kuryos` (este app) continua operando só até a virada e é a fonte do
histórico a importar. Isso revê o "construir neste app" de 20/10.

Medir quanto cada produto realmente deixa para a Kuryos, do orçamento ao realizado, e
transformar isso numa meta diária em pontos para a fábrica inteira, com bônus quando ela é batida.

---

## 1. O que muda em relação à versão de 20/10

1. **Base de dados.** Os números de 20/10 (69 SKUs, 591 mil unidades em 90 dias) foram medidos no
   sistema atual da fábrica (`prod-kuryos`). A fábrica vai migrar para o `erpkuryos`, onde a última
   OP é de 21/09: tudo que depende do **realizado** (custo real, LPD realizado, simulação de 3
   meses, placar) começa na virada ou quando o histórico do `prod-kuryos` for importado.
2. **Três colunas, não duas.** Para SKU nascida no CRM existe um terceiro número: o **orçamento
   aprovado pelo cliente** (cotação COT-…-rN e composição do preço). Comparar orçamento ×
   padrão × realizado mostra se o erro foi do Comercial, da engenharia ou da fábrica.
3. **O bloqueio do preço de material cai pela metade.** Além do Pedido de Compra, o sistema já
   tem preço estimado pelo P&D em 175 ingredientes de fórmula e preço cotado nas cotações do CRM.
   Cada custo passa a carregar a origem: **PAGO** (PC) › **COTADO** (cotação) › **ESTIMADO P&D**.
4. **Material do cliente marcado sozinho** para SKU do CRM (Kickoff "fornecido por" e titularidade
   do PC). Só o legado precisa de marcação manual.
5. **Operação por horas-padrão** (ritmo de referência), nunca pela duração da OP. Medido em
   14/09, a duração dá 123–243% e é tempo de calendário. A ociosidade (ocupação média medida de
   40%) entra no custo fixo da meta, nunca diluída no LP.
6. **Pontos não mudam no meio do mês.** A tabela de pontos por SKU é congelada no início de cada
   mês.
7. **Segurança da margem.** O placar é calculado no servidor e grava só totais; nenhum navegador
   de quem não é diretoria recebe LP ou custo por produto.
8. **Pontos pelo LP padrão.** Em 20/10 a base dos pontos era o "LP orçado". Com a leitura de
   orçamento do CRM, "orçado" passou a significar outra coisa. Os pontos usam o **LP padrão**: o
   orçamento só existe para SKU nascida no CRM, e o realizado só se conhece depois da OP.

---

## 2. O que vamos construir

- **Custo** orçado × realizado, OP por OP: material, perdas, operação e demais custos.
- **Consolidação** de OP → pedido por SKU → pedido global → cliente → mês, sempre receita × custo.
- **LP**, lucro por produto: a margem de contribuição de cada unidade (orçamento, padrão, realizado).
- **LPD**, lucro por produto por dia: o LP ponderado pela produção diária do item.
- **Resultado**: metas diária, semanal e mensal em pontos, bônus para a fábrica inteira e placar na TV.

## 3. Como o indicador aparece para a fábrica

O LP padrão vira pontos por um fator único e fixo no período. A fábrica vê pontos e a meta do dia;
reais ficam só com a diretoria.

| LP padrão | × fator | = pontos por item bom |
|---|---|---|
| R$ 1,20 | 25 | 30 |

Programa do dia: 10.000 itens × 30 = **300.000 pontos de meta**. (Exemplo. O fator e o % alvo saem
da simulação da Fase 4.)

---

## 4. Situação dos dados no `erpkuryos` (medido em 26/10/2026)

| Dado | Situação | |
|---|---|---|
| Operação (OPs e apontamentos) | Última OP em **21/09**; a fábrica opera no `prod-kuryos` até a virada | **bloqueio do realizado** |
| Preço de venda | 110 SKUs com preço e vigência (Gestão Comercial); SKU do CRM traz o preço do orçamento aprovado | pronto |
| Preço de material, PAGO | 13 PCs, só **10 materiais** com preço (último PC em 18/09) | bloqueio |
| Preço de material, ESTIMADO P&D | **175 ingredientes** com preço nas fórmulas do P&D (877 de 889 itens) | usar com selo |
| Preço de material, COTADO | Cotações do CRM (COM-03/04/05) para projetos novos | entra sozinho |
| Material do cliente | SKU do CRM já marcado; legado sem marcação | marcar legado |
| Fórmula / BOM / Especificação aprovadas | **6 de 199 / 4 de 248 / 4 de 215** | completar |
| Ritmo de referência (prodHoraRef) | 321 de 387 produtos | completar o resto |
| Custo no lote | `estoque_lotes` vazio: o custo do recebimento não é gravado | **urgente** |
| Folha e custo fixo mensal | Não estão no `erpkuryos` | estruturar |
| Concentração | 83 materiais cobrem 80% do custo de material (medido em 14/09) | prioriza a Fase 0 |

Os preços PAGO do `prod-kuryos` (229 materiais usados, 15 com preço em 20/10) e os recebimentos
feitos até a virada entram na importação do histórico.

---

## 5. Definições

### LP — lucro por produto

**LP = preço líquido de impostos − custos variáveis da unidade**

- Custos variáveis: granel, embalagem, perdas e operação direta.
- **Custo fixo não entra no LP: entra na meta.** Bater a meta significa ter coberto o custo fixo
  do dia.
- Três leituras:
  - **LP do orçamento**: o que o Comercial vendeu (só SKU do CRM);
  - **LP padrão**: com o custo padrão do SKU, antes de produzir. **É a base dos pontos**;
  - **LP realizado**: com o custo real da OP, quando ela fecha.
- **Custo que falta nunca vira zero.** SKU sem preço em algum componente fica **SEM CUSTO** e fora do
  placar (e fora da meta) até ter custo.
- **Confiança do custo.** Cada componente mostra a origem (PAGO, COTADO, ESTIMADO P&D) e o SKU mostra
  quanto do custo é de cada uma.

### LPD — lucro por produto por dia

**LPD = LP × unidades produzidas no dia**

- Padrão: produção diária esperada pelo ritmo do SKU; sem ele, pela média do grupo parecido
  (ex.: hidratante 200 ml); sem grupo, pela mediana da linha. **Sempre pelo menor valor** quando a
  média histórica divergir do ritmo informado (apontamento de lote inteiro infla a média).
- Realizado: unidades boas apontadas no dia.
- Para a diretoria: mostra o que rende mais por dia de linha. LP alto com ritmo baixo pode render
  menos que LP baixo com ritmo alto.

### Custo por unidade

| Componente | Padrão (antes de produzir) | Realizado (por OP) |
|---|---|---|
| Granel | custo por kg da fórmula × massa da unidade (volume × densidade; sem densidade = SEM CUSTO) | o que a pesagem baixou para o lote, ao preço do lote |
| Embalagem | BOM × preço (1 a cada N peças conta a fração) | consumo apontado |
| Perdas | % de perda padrão do cadastro | perdas apontadas, valorizadas |
| Operação | custo da hora-padrão da linha ÷ ritmo do SKU | custo da hora × horas trabalhadas apontadas (não a duração da OP) |
| Impostos | % do regime sobre o preço | % sobre a nota |

---

## 6. Consolidação

OP → Pedido × SKU → Pedido global → Cliente → Mês.

Em cada nível: unidades, receita, custo (orçamento, padrão e realizado), LP nas três leituras,
variações (preço, consumo, perda, eficiência) e quanto do custo é PAGO, COTADO ou ESTIMADO.

---

## 7. Pontos, meta e bônus

- **Pontos por item = LP padrão × fator**, com fator único e fixo no período.
- **Tabela de pontos congelada por mês:** atualizar preço de material no meio do mês muda o LP da
  diretoria, não os pontos da fábrica.
- **Contados sobre o realizado:** unidades boas apontadas, menos os descontos abaixo.
- **Meta ajustada ao programa do dia:** os pontos que o programa renderia no ritmo de referência e
  sem perda, × um % alvo. Dia de mix de margem baixa (escolha do PCP e do Comercial) não pune a
  fábrica. Produto SEM CUSTO sai do programa da meta e da contagem; a cobertura (% do volume do
  dia com custo) aparece ao lado.
- **Dia → semana → mês:** a semana soma os dias (um dia ruim compensa com um bom); o mês soma as
  semanas.
- **Bônus:** valor fixo ao bater a meta do mês, crescendo em faixas (ex.: 100% = base; 110% = 1,2×;
  teto em 130%).
- **Toda a fábrica, uma meta só.**

### Descontos e portões

| Item | Tipo | Como | Situação |
|---|---|---|---|
| Perdas apontadas | desconto | pontos do item × unidades perdidas | decidido |
| Retrabalho | desconto | pontos do item × unidades retrabalhadas | decidido |
| Lote reprovado pela Qualidade | desconto | os pontos do lote saem do dia em que foram contados | proposto |
| Divergência na conferência do PA | desconto | apontado acima do contado pela Logística sai dos pontos | proposto |
| Reclamação/devolução com causa na fábrica | portão | reduz o bônus do mês (ex.: −50%); registro pela diretoria | proposto |
| Acidente com afastamento | portão | zera o bônus da semana; registro pelo RH | proposto |
| First article ou assepsia reprovados | não desconta | só registra (descontar ensinaria a esconder) | proposto |
| Paradas | não desconta | já reduzem a produção sozinhas | decidido |

**Não punir quem aponta.** Se perda apontada tira ponto, a tentação é não apontar. A defesa é a
**conferência de consumo**: o material baixado é comparado com o que a ficha técnica manda gastar
pelo que foi produzido. Perda escondida aparece como diferença de material e desconta em dobro.
Só vale para SKU com Fórmula e BOM aprovadas, hoje 6 e 4.

---

## 8. Visibilidade e segurança

- **R$ e LP só a diretoria** (hoje = ADM; não existe papel Diretoria no sistema).
- Custos e LP num nó com leitura só de ADM. O **placar é calculado no servidor** (Render, que já
  roda a tarefa agendada do câmbio do `erpkuryos`) e grava só os totais do dia em
  `resultado/placar/{dia}`.
- **TV:** tela cheia, só leitura, com login próprio que lê só o placar. Ao vivo pelo apontamento:
  pontos do dia × meta, barra da semana e do mês, dias batidos, contagem do turno. Sem R$, sem
  produto, sem nomes.

---

## 9. Fases

Tudo no `erpkuryos`. O que depende do realizado espera a virada ou a importação do histórico.

| Fase | Entrega | Depende de | Pode começar já? |
|---|---|---|---|
| 0. Dados | Custo gravado no lote no recebimento; preço dos materiais em ordem de impacto (os 83 que cobrem 80%); de-para do ingrediente do P&D para o material do cadastro; marcação do material do cliente no legado; % de impostos; aprovar Fórmula/BOM/Especificação dos SKUs de maior volume; custo-hora por linha; custo fixo mensal | Compras, Comercial, Financeiro, P&D, PCP | **sim** |
| 1. Custo e LP padrão | Motor puro (reaproveita o motor e os testes da aba de custos removida em `bb245a0`, no repositório do `prod-kuryos`), ficha padrão por SKU, LP com origem do custo e cobertura em % do volume; LP do orçamento para SKU do CRM | Fase 0 (em andamento) | **sim** |
| 2. Custo realizado | Custo real da OP, variações, consolidação até pedido, cliente e mês | Virada da fábrica para o `erpkuryos` + custo no lote | após a virada |
| 3. LPD e painel da diretoria | LPD padrão × realizado por SKU e linha; ranking de mix; resultado em R$; orçamento × padrão × realizado | Fase 2 | após a virada |
| 4. Simulação | Rodar os últimos 3 meses: dias e semanas batidos, custo do bônus; calibrar fator, % alvo e faixas | Fase 1 + histórico de apontamento importado do `prod-kuryos` | após a importação |
| 5. Placar na TV, piloto | 4 semanas ao vivo, sem bônus valendo | Fase 4 + virada | após a virada |
| 6. Bônus oficial | Regras escritas, fechamento mensal e pagamento | Fase 5, RH e contador (PLR) | — |

O placar usa o LP padrão e pode começar com os SKUs que já tiverem custo completo.

---

## 10. Decisões

### Tomadas em 20/10 (mantidas)

| Tema | Decisão |
|---|---|
| Gestão financeira | Vem depois, no mesmo sistema da fábrica |
| LP | Margem de contribuição sobre o preço líquido de impostos; custo fixo entra na meta |
| Pontos | LP × fator, contados sobre o realizado (a base do LP foi revista em 27/10, abaixo) |
| Meta | Ajustada ao programa do dia |
| Bônus | Valor fixo ao bater, crescendo com a superação |
| Descontos | Perdas e retrabalho (demais em validação) |
| Participação | A fábrica inteira, uma meta |
| Visibilidade | R$ e LP só a diretoria; os demais, só pontos |

### Revistas em 27/10

| Tema | Antes (20/10) | Agora |
|---|---|---|
| Onde construir | Neste app (`prod-kuryos`) | No sistema da fábrica, que passa a ser o `erpkuryos`. Fases 0 e 1 começam lá agora; 2 a 5 depois da virada. O `prod-kuryos` opera até a virada e fornece o histórico |
| Base dos pontos | LP orçado × fator | **LP padrão × fator**. O LP do orçamento (CRM) e o realizado ficam com a diretoria |

### Novas, para aprovar

1. Custo com origem (PAGO › COTADO › ESTIMADO P&D) e **SEM CUSTO nunca vira zero**.
2. Três leituras do LP (orçamento, padrão, realizado).
3. Operação por horas-padrão; ociosidade no custo fixo, fora do LP.
4. Tabela de pontos congelada por mês.
5. SKU sem custo fora do placar **e** da meta, com a cobertura exibida.
6. Placar calculado no servidor; TV com login que só lê totais.

## 11. Em aberto

- **Data da virada** da fábrica para o `erpkuryos` e importação do histórico do `prod-kuryos`
  desde 21/09 (OPs, apontamentos e preços PAGO). Sem isso não há realizado nem simulação.
- **Cobertura mínima para pontuar:** basta ter custo em todos os componentes, ou exigir um mínimo
  PAGO/COTADO (ex.: 80% do custo)?
- **Forma legal do bônus:** bônus coletivo por meta costuma ser pago como PLR (Lei 10.101/2000), com
  regras escritas e acordadas com comissão de empregados ou sindicato. Validar com RH e contador
  antes de anunciar.
- Faixas de superação e valor base; fator dos pontos e % alvo (saem da simulação).
- **Custo fixo mensal:** estruturar; até lá, o ponto de equilíbrio é checado pela diretoria fora
  do placar.
- **Papel Diretoria:** criar ou manter ADM.
- Quem informa o % de impostos por regime/UF (Financeiro ou contador).
