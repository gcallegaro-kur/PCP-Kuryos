# Plano — Custos + Resultado (LP, LPD, metas e bonificação)

Plano de 20/10/2026, **decisões da seção 7 respondidas no mesmo dia**. Execução começa pela Fase 0.
Números medidos na base `prod-kuryos` em 20/10 (últimos 90 dias), não estimados.
Leia junto: `PLANO_CUSTOS.md` (arquitetura de custos de 14/09) e `PROMPT_CUSTOS_ERP.md`
(especificação entregue ao Kuryos ERP).

---

## 1. O que o usuário pediu

1. **Custos orçado × realizado**, OP por OP: material, perdas, operação e demais custos.
2. **Consolidação**: OP → pedido por SKU → pedido global, com **receita × custo**.
3. **LP — lucro por produto**: a margem de contribuição de cada unidade (preço de venda −
   custo orçado; e o mesmo com o custo realizado).
4. **LPD — lucro por produto por dia**: o LP ponderado pela produção diária do item. Orçado
   usa a média de produção do item (ou do item mais parecido); realizado usa a produção de fato.
5. **Resultado**: metas diárias, semanais e mensais sobre o LP, com **bonificação para toda a
   fábrica** quando a meta é batida, e um **placar na TV**.
6. **Indicador mascarado** na fábrica: em vez de "R$ 1,20 de lucro por item", "30 pontos por
   item"; meta do dia em pontos (ex.: 10.000 itens × 30 = 300.000 pontos).

---

## 2. O que a base tem hoje (medido em 20/10/2026, 90 dias)

| Dado | Situação | Peso no plano |
|---|---|---|
| Volume | 69 SKUs produzidos, **591 mil unidades**; mediana **10.137 un./dia útil** (p25 7.450, p75 13.991) | A meta diária do exemplo (10.000) bate com a realidade; a variação diária é grande |
| **Preço de venda** (`precos_venda`, com vigência) | 112 SKUs; **63 dos 69 produzidos = 94% do volume** | Receita: **pronta** |
| **Preço de material** | Os 69 SKUs usam **229 materiais**; só **15 têm preço** (de 42 itens de pedido de compra com valor). `custos_precos` está vazio | **Bloqueio nº 1.** Hoje **0%** dos SKUs tem custo de material completo |
| Material do cliente | 5 materiais já chegaram como remessa do cliente; 67 comprados pela Kuryos | Material do cliente tem custo zero **legítimo** para a Kuryos — precisa estar marcado, não suposto |
| Fórmula / BOM | 20 dos 69 SKUs sem fórmula aprovada; 17 sem BOM | SKU sem estrutura não tem custo orçado |
| Ritmo (`prodHoraRef`) | 57 de 69 SKUs | Base do custo de operação orçado e do LPD orçado |
| Folha | 13 colaboradores, **11 com salário** | Custo de operação: parcial (falta o resto do custo fixo) |
| Custo fixo mensal (aluguel, energia, manutenção, encargos) | Não existe no sistema | Precisa de um número por mês |
| Apontamento | Produção por OP, linha, dia e hora; perdas por material e etapa; paradas | Realizado: **pronto** |
| Pedido comercial | 77 pedidos, 444 itens, **nenhum com valor** no item | A receita vem de `precos_venda` × quantidade, não do pedido |

**Conclusão:** a receita e o realizado de produção estão prontos. O que separa o LP de existir
é o **preço dos materiais** (e, em segundo lugar, o custo fixo do mês). Isso é cadastro, não
código — e decide o cronograma.

---

## 3. Definições propostas (para travar)

### 3.1 Custos por unidade

| Componente | Orçado (padrão, por SKU) | Realizado (por OP) |
|---|---|---|
| **Material — granel** | fórmula (custo por kg) × massa por unidade | o que a pesagem baixou do estoque para o lote, ao preço do lote |
| **Material — embalagem** | BOM × preço | consumo apontado do lote |
| **Perdas** | % de perda padrão do cadastro (processo e linha) | perdas apontadas (por material e etapa), valorizadas |
| **Operação (conversão)** | custo por hora-padrão × (1 ÷ ritmo de referência do SKU) | custo por hora × horas reais da OP na linha (inclui setup e paradas) |
| **Impostos sobre a venda** | % do regime (ICMS, PIS, COFINS…) sobre o preço | idem, sobre a nota |

### 3.2 LP — lucro por produto

> **LP = preço líquido de impostos − custos variáveis da unidade (material + embalagem + perdas + operação direta).**

- **LP orçado**: com o custo padrão. Conhecido antes de produzir.
- **LP realizado**: com o custo real da OP. Conhecido quando a OP fecha.
- **Custo fixo** (aluguel, administração, energia de base) **não entra no LP**: ele entra na
  **meta** (seção 5). É o que faz a meta ter significado: o dia só "fecha" quando a soma dos LPs
  cobre o custo fixo do dia.
- Regra herdada do plano de 14/09: **custo ausente nunca vira zero**. SKU com material sem preço
  fica "LP incompleto" e não entra em placar nem em meta — senão sai barato e com margem falsa.

### 3.3 LPD — lucro por produto por dia

> **LPD = LP × unidades produzidas no dia.**

- **Orçado**: LP orçado × produção diária esperada do SKU = ritmo de referência (un./h) × horas
  úteis do dia. Sem ritmo próprio → média do grupo mais parecido (mesma subcategoria e volume, ex.
  "hidratante 200 ml"); sem grupo → mediana da linha. O sistema mostra de qual dos três veio.
- **Realizado**: LP realizado × unidades boas apontadas no dia.
- **Leitura de gestão**: LPD orçado × realizado por SKU mostra o que rende mais por **dia de
  linha** — um SKU de LP alto e ritmo baixo pode render menos por dia que um de LP baixo e ritmo
  alto. É o número para decidir mix e preço.

### 3.4 Consolidação

```
OP (lote) → pedido × SKU → pedido global → cliente → mês
```

Em cada nível: unidades, receita, custo orçado, custo realizado, LP orçado × realizado,
variações (preço, consumo, perda, eficiência) e % de cobertura de custo (quanto do custo é
dado real e quanto é estimado).

---

## 4. Custo realizado: de onde vem cada parte

| Parte | Fonte que já existe | O que falta |
|---|---|---|
| Unidades boas por OP e por dia | apontamentos (`registros`) | — |
| Material consumido | baixa de estoque na pesagem e no apontamento (por lote) | **valor no lote** (custo do recebimento — Fase 0 do `PLANO_CUSTOS.md`) |
| Perdas por material e etapa | `perdas/{lote}` | valorização (preço do material) |
| Horas reais de linha | abertura → encerramento da OP, setup e paradas | custo por hora do mês |
| Retrabalho | OPs de retrabalho | entra como custo da OP de origem |

---

## 5. Resultado: pontos, metas e bonificação

### 5.1 Pontos (o indicador mascarado)

- **Pontos por item = LP orçado × fator.** O fator é **um número só para todos os SKUs**, fixo
  no período (exemplo do usuário: R$ 1,20 → 30 pontos, fator 25).
- Pontos do dia = Σ (unidades boas × pontos do SKU) − Σ (unidades perdidas × pontos do SKU).
  Perda tira ponto: a fábrica controla perda, e isso dá a ela uma alavanca real.
- **Usar o LP ORÇADO, não o realizado, para os pontos.** O realizado depende de preço de compra
  e de rateio que a fábrica não vê e chega dias depois; o orçado é estável e o placar fecha na
  hora. A diferença orçado × realizado fica com a gestão (seção 3).
- **A TV mostra só o total**, nunca pontos por SKU: com "hidratante = 30 pontos, perfume = 8" a
  fábrica deduz a margem relativa em uma semana.

### 5.2 Meta

Duas formas — escolha na seção 7:

| | Meta fixa | Meta ajustada ao programa (recomendada) |
|---|---|---|
| Como | Igual todo dia (ex.: 300.000 pontos) | Pontos que o programa do dia renderia se rodasse no ritmo de referência e sem perda, × % alvo (ex.: 90%) |
| Vantagem | Simples de explicar | Justa: dia de mix de margem baixa (escolha do PCP/comercial) não pune a fábrica; o que conta é executar o programa bem |
| Risco | Variação diária de 7.450 a 14.000 un. faz a meta ser sorte do mix | Explicar "meta do dia muda" na TV |

**Âncora econômica (as duas formas):** a meta mensal não pode ficar abaixo do **ponto de
equilíbrio** — Σ LP do mês ≥ custo fixo do mês. Bônus abaixo disso é pago com prejuízo.

### 5.3 Dia → semana → mês

- Placar diário: pontos × meta do dia.
- Semana: soma dos dias × soma das metas (um dia ruim compensa com um bom).
- Mês: soma das semanas. **Bônus se o mês fecha na meta**; semanas batidas podem destravar
  parcelas (ex.: 25% por semana batida), a decidir.
- **Portões de qualidade e segurança** (recomendado): RNC crítica de cliente, acidente com
  afastamento ou lote reprovado no mês suspendem ou reduzem o bônus. Sem isso, o incentivo
  é velocidade acima de qualidade.

### 5.4 De onde sai o dinheiro do bônus

Recomendado: **o bônus é uma fatia do LP acima da meta** (ex.: 10% do excedente, com teto). Ele
se paga sozinho e nunca existe em mês de prejuízo. Valor fixo por meta batida é mais simples,
mas descolado do resultado.

### 5.5 Aspecto trabalhista (validar com RH/contador)

Bônus coletivo por meta normalmente é pago como **PLR** (Lei 10.101/2000), que exige regras
escritas e acordadas com comissão de empregados ou sindicato, e tem tratamento tributário
próprio. Pago como prêmio habitual, pode virar salário. **Decidir a forma antes de anunciar.**

### 5.6 Placar na TV

- Tela cheia, sem login de operador, só leitura: pontos do dia × meta, barra da semana e do mês,
  dias batidos, contagem regressiva do turno.
- Atualiza ao vivo pelo apontamento (o dado já está no banco).
- Sem R$, sem SKU, sem nomes.

---

## 6. Fases

| Fase | Entrega | Depende de | Quem |
|---|---|---|---|
| **0. Decisões e dados** | Seção 7 respondida. Preço dos ~40 materiais que cobrem ~80% do custo (fila por exposição, como no plano de 14/09); marcação de material do cliente; % de impostos sobre a venda; custo fixo mensal; fórmula/BOM dos 20/17 SKUs faltantes | — | **Kuryos** (Compras, Comercial, Financeiro, P&D) + Claude prepara a fila |
| **1. Custo orçado e LP orçado** | Ficha padrão por SKU (material, embalagem, perda, operação), LP orçado, cobertura (% do volume com LP completo) | Fase 0 | Claude |
| **2. Custo realizado por OP** | Custo real de cada OP (material do lote, perdas valorizadas, horas reais), variações, consolidação OP → pedido × SKU → pedido → cliente → mês | Fase 1 + custo no lote | Claude |
| **3. LPD e painel de gestão** | LPD orçado × realizado por SKU e por linha; ranking de mix; resultado diário/semanal/mensal em R$ (só gestão) | Fase 2 | Claude |
| **4. Pontos e metas — simulação** | Motor de pontos e meta; **rodar os últimos 3 meses** para ver quantos dias/semanas teriam batido e quanto o bônus teria custado. Calibrar fator, % alvo e teto com isso | Fase 1 | Claude + diretoria |
| **5. Placar na TV — piloto** | Placar ao vivo **sem bônus valendo** por 4 semanas, para a fábrica entender a regra e a gestão confirmar a calibração | Fase 4 | Claude + Produção |
| **6. Bônus oficial** | Regras escritas (PLR ou outra forma), fechamento mensal com relatório, pagamento | Fase 5 + RH/contador | Kuryos |

As Fases 1, 4 e 5 podem andar com o **LP orçado só dos SKUs com ficha completa**, deixando os
demais fora do placar até terem custo. A Fase 2 (realizado) é a mais pesada e não bloqueia o
placar, porque o placar usa o orçado.

---

## 7. Decisões (respondidas pelo usuário em 20/10/2026)

| # | Decisão | Resposta |
|---|---|---|
| 1 | Onde construir | **Tudo aqui** (custos, LP/LPD, pontos, metas e placar). Revoga a decisão de 14/09 de o módulo nascer no Kuryos ERP; `PROMPT_CUSTOS_ERP.md` vira referência, não entrega. O motor segue em funções puras, reaproveitável pelo ERP |
| 2 | LP | **Margem de contribuição sobre o preço líquido de impostos**; custo fixo entra na meta. O custo fixo vai ser estruturado depois — o usuário quer **trazer a gestão financeira para cá** em algum momento (revê o "não construir financeiro transacional" de 14/09: fica como fase futura própria, não neste plano) |
| 3 | Pontos | **Pontos por item = LP orçado × fator; contados sobre o REALIZADO** (unidades boas apontadas, menos descontos). O valor do ponto é fixo e conhecido; a quantidade é a real |
| 4 | Meta | **Ajustada ao programa do dia** |
| 5 | Bônus | **Valor fixo ao bater a meta**, **podendo superar conforme a superação da meta** (faixas). Forma legal (PLR ou outra) ainda a validar com RH/contador |
| 6 | Descontos e portões | **Descontar pontos em retrabalhos e perdas.** Demais itens propostos na seção 7.1 |
| 7 | Quem participa | **A fábrica inteira**, uma meta só |
| 8 | Quem vê | **R$ e LP: só diretoria.** Todos os demais: **só pontos** |

### 7.1 Descontos e portões propostos (a confirmar)

Dois tipos: **desconto** tira pontos do dia (proporcional ao estrago); **portão** suspende ou
reduz o bônus do período (evento grave, raro).

| Item | Tipo | Proposta | Por quê |
|---|---|---|---|
| Perdas apontadas (unidades e material) | desconto | pontos do item × unidades perdidas (material perdido convertido em unidades equivalentes) | decidido |
| Retrabalho | desconto | pontos do item × unidades retrabalhadas | decidido |
| **Lote reprovado pela Qualidade** (granel ou PA) | desconto | pontos do lote reprovado saem do dia em que foram contados | produzir rápido e errado não pode pontuar |
| **Divergência na Conferência de PA** (apontado > contado pela Logística) | desconto | a diferença sai dos pontos | **protege o placar de apontamento inflado** — é o principal risco de um bônus por quantidade |
| **Reclamação / devolução de cliente com causa na fábrica** | portão | reduz o bônus do mês (ex.: −50% por RNC de cliente procedente) | é o custo de qualidade mais caro e aparece semanas depois |
| **Acidente com afastamento** | portão | zera o bônus da semana | segurança acima de produção, sem exceção |
| First article ou assepsia reprovados | **não descontar** | só registrar | descontar ensina a esconder; a reprovação é o sistema funcionando |
| Paradas | **não descontar** | já reduzem a produção sozinhas | evitar punir duas vezes |

**Cuidado que vale para tudo isto: não punir quem aponta.** Se perda apontada tira ponto, a
tentação é não apontar. A defesa é a **conciliação de consumo** (estoque consumido × BOM ×
produzido, que já existe para a rotulagem): perda que não foi apontada aparece como diferença
de material na conciliação e **desconta em dobro**. Assim, apontar é sempre melhor que esconder.

### 7.2 O que fica pendente

- Forma legal do bônus (PLR ou outra) — RH/contador.
- Faixas da superação (ex.: 100% da meta = valor base; 110% = base × 1,2; teto em 130%).
- Valor do fator dos pontos e do % alvo da meta — sai da simulação da Fase 4.
- Custo fixo mensal — estruturar depois (decisão 2); até lá a meta usa o programa do dia
  e o ponto de equilíbrio entra como checagem da diretoria, não como regra do placar.
