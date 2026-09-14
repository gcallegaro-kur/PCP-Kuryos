# Prompt — Módulo de Custos e Margem no Kuryos ERP

> Documento para ser entregue a quem vai construir o módulo de Custos **no Kuryos ERP**
> (não neste app de PCP). Escrito como instrução de construção: pode ser lido por uma
> pessoa ou colado como prompt.
>
> Base: sessão de arquitetura de 2026-09-14. Os números citados foram **medidos contra a
> base de produção do app de PCP**, que compartilha o mesmo dado mestre (produtos,
> fórmulas, BOM, materiais). Um protótipo do motor existe em
> `public/shared/custos.js` deste repo, com 113 asserções em `run_custos_test.js` e um
> ensaio contra dados reais em `run_custos_ensaio.js` — use como referência de lógica,
> não como código a portar.

---

## 1. Contexto

A Kuryos é fabricante **private label** de cosméticos: cerca de 30 clientes-marca,
operação de envase e rotulagem, licenciada pela Anvisa. Ela não vende produto próprio —
vende **capacidade de fabricar o produto de outra marca**. Isso define tudo o que segue:

- A pergunta comercial que mais se repete é **"quanto cobrar para fabricar isto?"**, feita
  no momento em que o cliente traz um briefing — antes de existir fórmula final,
  fornecedor definido ou pedido.
- A segunda pergunta é **"esse pedido deu margem?"**, feita depois de produzir.
- O que a Kuryos vende é **conversão** (envase, rotulagem, montagem). O material é
  repasse. Um custo que só some material não serve para precificar.

O ERP já tem **CRM integrado com P&D**. As amostras desenvolvidas no P&D já registram
**custo por item da formulação**. Isso é a peça mais importante desta arquitetura e está
detalhada na seção 3.

---

## 2. O que construir — e o que NÃO construir

Três coisas andam juntas sob a palavra "financeiro". Separá-las é a primeira decisão:

| Camada | O que é | Decisão |
|---|---|---|
| **Fiscal/contábil** | SPED, NF-e, apuração, obrigações acessórias | **Não construir.** Terceirizado na contabilidade |
| **Financeiro transacional** | Contas a pagar/receber, caixa, conciliação bancária, boleto | **Não construir.** É a categoria de software mais commoditizada que existe. Integrar com o que a empresa já usa |
| **Controladoria / custos** | Atribuir o fato econômico ao **objeto de custo**: produto, OP, pedido, cliente, período | **Este módulo.** Ninguém vende pronto, porque depende de fórmula % m/m, BOM por peça, taxa de envase e ociosidade de linha |

**Construa a controladoria.** É o padrão de todo ERP sério: SAP separa **FI** (o razão, o
fato econômico) de **CO** (Controlling: centro de custo, ordem, custeio de produto, CO-PA
de margem). TOTVS separa Financeiro de Custos/Controladoria. Oracle separa GL de Cost
Management. A regra é sempre a mesma: **o financeiro registra o fato; a controladoria
atribui o fato a um objeto de custo.**

Dois padrões a copiar literalmente:

1. **Razão de custos append-only.** Todo evento economicamente relevante emite um
   lançamento imutável: quantidade + valor + objeto de custo + **procedência**. Correção
   se faz por estorno, nunca por edição. É isso que permite auditar um custo três anos
   depois em vez de recalcular e obter outro número.
2. **A variação é o produto, não o custo.** Padrão × real, decomposto em variação de
   **preço** (paguei mais caro), **consumo** (usei mais material), **eficiência**
   (demorei mais) e **absorção** (produzi menos que a capacidade que pago). Um custo
   isolado não gera ação; um desvio com causa gera.

**Fronteira com o financeiro comprado: uma só, em dois sentidos.** O ERP exporta títulos
a pagar (do PC confirmado) e a receber (do pedido liberado); importa de volta **apenas o
valor efetivamente pago quando divergir do PC**, que é o que fecha a variação de preço.
Não integrar plano de contas, não espelhar lançamento contábil, não replicar DRE.

---

## 3. A cadeia de origem do custo — o coração do módulo

O custo de um material não nasce pronto. Ele **amadurece** ao longo do ciclo, e cada
estágio é mais confiável que o anterior. O ERP já tem os três estágios; o módulo de
custos só precisa ligá-los:

```
  P&D (amostra)         →      COMPRAS (cotação)      →      COMPRAS (PC / NF)
  custo estimado por           custo cotado com              custo efetivamente
  item da formulação           fornecedor real               pago, com impostos
        ESTIMADO                    COTADO                        PAGO
     confiança baixa            confiança média              confiança alta
```

**Regras desta cadeia:**

1. **O estágio mais maduro vence.** `PAGO` > `COTADO` > `ESTIMADO`. Nunca o contrário.
2. **Substituir não apaga.** Guarde o histórico: quem informou, quando, qual valor, qual
   estágio. Quando Compras atualiza o custo que o P&D estimou, o sistema precisa saber
   **de quanto foi o erro da estimativa** — é assim que a estimativa do P&D melhora ao
   longo do tempo, e é um indicador de qualidade do próprio P&D.
3. **O P&D é obrigado a estimar.** Amostra não fecha sem um custo por item, mesmo que
   grosseiro. É isso que faz existir custo de fórmula **no momento em que o comercial
   precisa orçar** — que é meses antes de haver qualquer cotação.
4. **Sem preço nenhum, o valor é `SEM_CUSTO` — nunca zero.** Ver seção 6, regra 1.

**Por que isso é a peça mais importante:** no app de PCP, medimos a base e encontramos
**0 de 911 materiais com qualquer preço** e apenas 2 pedidos de compra. Um módulo de
custos sem origem nativa de preço vira uma tela de digitação manual que ninguém mantém.
A cadeia P&D → Compras resolve isso na raiz, porque o preço entra como **subproduto de um
trabalho que já acontece**, não como tarefa nova.

**Grau de confiança da ficha.** Como uma ficha mistura estágios, calcule e exiba a
composição por procedência, ponderada pela participação no custo:

> "Custo unitário R$ 4,82 — **72% baseado em estimativa de P&D**, 21% cotado, 7% pago."

Uma margem calculada sobre 72% de estimativa não é a mesma coisa que sobre 100% pago, e o
comercial precisa ver isso **antes** de fechar o preço com o cliente.

---

## 4. Modelo de dados

Independente de tecnologia de armazenamento. Nomes sugestivos, adapte à convenção do ERP.

### Preço de material (com histórico de maturação)

```
material_custo/{materialId}
  atual: { valor, unidade, procedencia, fonteId, definidoPor, definidoEm }
  historico: [
    { valor, unidade, procedencia, fonteId, definidoPor, definidoEm, substituidoEm }
  ]
```

- `procedencia` ∈ `ESTIMADO_PD` | `COTADO` | `PAGO` | `MANUAL`
- `fonteId` aponta para a amostra de P&D, a cotação ou o item do PC que originou
- `unidade` **viaja junto com o valor** — ver seção 6, regra 2

### Razão de custos (append-only)

```
razao_custos/{id}
  tipo: ENTRADA_MATERIAL | CONSUMO_MATERIAL | HORA_PRODUCAO | PERDA | ABSORCAO | SAIDA_VENDA | ESTORNO
  objeto: { tipo: OP | PEDIDO | CLIENTE | PERIODO, id }
  natureza: MATERIA_PRIMA | EMBALAGEM | USO_E_CONSUMO | MAO_DE_OBRA | CUSTO_FIXO | OUTROS
  quantidade, unidade, valorUnitario, valorTotal
  procedencia
  origemId, estornaId
  criadoEm, criadoPor, versaoMotor
```

`natureza` é o **plano de contas gerencial mínimo**. Existe para que a integração com
qualquer financeiro futuro seja um mapeamento, não uma arqueologia.

### Parâmetros de período

```
custo_operacao/{competencia}          # "AAAA-MM"
  folhaProducao                       # do RH quando existir; senão, digitado
  fixos: [{ descricao, categoria, valor, rateio }]
  rateio ∈ PRODUCAO | ADMINISTRATIVO  # ADMINISTRATIVO NÃO absorve em produto

custo_taxas/{competencia}             # calculado; sem dado individual de salário
  diasUteis, horasUteis, linhasAtivas, horaLinhaDisponivel
  horasPadraoRealizadas, ocupacaoPct
  custoHoraPadrao
  calculadoEm, versaoMotor

ficha_custo/{skuId}/{competencia}     # snapshot congelado
  custoPorKgFormula, custoGranelPorUnidade, custoEmbalagem, custoConversao, custoUnitario
  linhas: [{ itemId, quantidade, unidade, valorUnitario, procedencia }]
  composicaoProcedencia: { ESTIMADO_PD: %, COTADO: %, PAGO: % }
  completo, semCusto: [ids], avisos: []
```

**Por que snapshot por competência:** a taxa de conversão e os preços mudam. Uma ficha
calculada em março precisa continuar reproduzível em junho, ou nenhuma análise de
variação faz sentido.

---

## 5. O motor de cálculo

Funções **puras**: recebem dado, devolvem número com procedência. Sem acesso a banco, sem
DOM. É o que torna o custo testável isoladamente — e custo errado sai plausível, então
testabilidade aqui não é preferência de estilo.

### 5.1 Custo do quilo de fórmula

```
custoPorKgFormula = Σ ( percentualMM(item) / 100 × precoPorKg(item) )
```

**Não depende de densidade.** A fórmula é % m/m, então o custo do quilo sai direto.
Densidade só entra no passo seguinte. Isso importa muito: na base medida, **densidade
existe em 6 de 377 produtos**, e acoplar as duas coisas travaria o módulo inteiro por um
dado que falta em 98% dos casos.

Qualidade do dado de fórmula na base atual, para calibrar expectativa: 169 fórmulas com
itens, 1.151 itens, **167 de 169 fecham entre 99% e 101%** de soma, 841 itens com código
de material e **todos os 841 existem no cadastro** — zero código órfão.

### 5.2 Do quilo para a unidade envasada

```
volumeFinalL   = volumeNominalL × (1 + overfillPct/100)
volumeGranelL  = volumeFinalL × (1 + perdaProcessoPct/100)
massaKgPorPeca = volumeGranelL × densidadeGranel
custoGranelPorUnidade = custoPorKgFormula × massaKgPorPeca
```

Sem densidade válida, devolva `null` com motivo — **nunca um número**. Atenção: cadastros
importados usam `-1` como marcador de "densidade não informada". Tratar `-1` como número
válido já gerou consumo **negativo** de fórmula em produção neste app.

### 5.3 Custo de embalagem

```
custoEmbalagemPorUnidade = Σ ( qtdPorPeca(item) × precoUnitario(item) )
```

Preço e quantidade na **mesma unidade**. Se divergirem, recuse a linha — ver regra 2.

### 5.4 Custo de conversão

```
custoOperacaoMensal = folhaProducao + Σ fixos com rateio = PRODUCAO
custoHoraPadrao     = custoOperacaoMensal / horasPadraoRealizadas
custoConversaoUnit  = custoHoraPadrao / taxaProducaoPorHora(sku)
```

**A base de absorção é HORAS-PADRÃO, nunca a duração da OP.** Isto foi medido e é o erro
mais fácil de cometer:

```
horasPadrao(OP) = quantidadeProduzida / taxaProducaoPorHora(sku)
```

Usar `dataFimReal − dataInicioReal` produz ocupação de **123% a 243%**, porque é tempo de
calendário — a OP "dorme" à noite e no fim de semana. Com horas-padrão, a ocupação medida
ficou entre 8% e 65%, **média de 40%**.

**Esse 40% é informação de gestão, não subproduto.** Significa que cerca de 60% da
capacidade paga não vira produto, e é por isso que o custo unitário é alto. Dividir o
custo pelas horas **disponíveis** em vez das **realizadas** produz um custo ~2,5× menor e
falso, e some com a única coisa acionável. A ociosidade tem que aparecer como **linha
própria** no relatório: *"R$ X do seu custo unitário é capacidade ociosa"*.

Ressalva: a taxa de produção de referência tende ao otimista. Se for, as horas-padrão
estão subestimadas e a ocupação real é **maior** que 40% — trate como piso. Para custo
unitário, use sempre a hipótese conservadora (a mais cara).

### 5.5 Ficha e margem

```
custoMaterialPorUnidade = custoGranelPorUnidade + custoEmbalagemPorUnidade
custoUnitario           = custoMaterialPorUnidade + custoConversaoUnit
margem                  = precoVenda − custoUnitario
```

A conversão entra como **camada plugável**: a ficha tem que funcionar e ser útil sem ela,
devolvendo custo de material com `custoUnitario = null`. Isso permite entregar valor antes
de o rateio de custo fixo estar pronto, sem reescrever nada depois.

---

## 6. Regras invioláveis

Cada uma destas custou caro. Não são preferências.

### Regra 1 — Preço ausente NUNCA vira zero

Material sem preço não deixa a ficha *incompleta*; deixa a ficha **barata**. A margem sai
alta, errada e convincente, e alguém fecha um pedido em cima dela.

- Toda função devolve `completo`, `semCusto[]` e procedência **por linha**.
- **O total só existe quando nada falta.** Somar granel parcial com embalagem parcial
  produz um número menor que o verdadeiro com cara de total.
- As **partes** ficam acessíveis, para a tela mostrar o parcial **com** o aviso ao lado.
- Quando *nada* foi precificado, o resultado é `null`, não `0`.

> Este último ponto é um bug real que aconteceu na implementação de referência: a soma de
> zero itens dava `0`, e `0` não é `null`, então granel 0 + embalagem 0 produziam um
> "total" de R$ 0,00 exibido na tela. Passou por 97 asserções sintéticas porque **toda
> fixture parcial tinha ao menos um item com preço**. Só apareceu rodando a tela contra a
> base real, que é justamente o estado em que o sistema entra no ar.

### Regra 2 — Unidade só converte quando dá, sem supor

- `kg` → direto. `g` → × 1000.
- `L`/`ml` → **exige a densidade do próprio material**. Sem ela, recuse.
- Qualquer outra unidade (un, rolo, milheiro) → recuse e classifique como *incompatível*,
  distinto de *sem preço*.

Um fator de conversão aplicado onde a unidade já era a mesma produziu um custo **11,67×
errado** no motor de cotação deste app — e o número saiu plausível.

### Regra 3 — Não confundir "sem preço" com "sem cadastro"

São dois problemas com soluções diferentes: um se resolve digitando preço, o outro
cadastrando material. A tela tem que separá-los, ou o usuário tenta resolver o errado.

### Regra 4 — Despesa administrativa não absorve em produto

Sai da margem, não entra no custo. Misturar faz todo produto parecer caro e nenhuma
decisão de preço fazer sentido.

### Regra 5 — Salário é dado restrito

A taxa de conversão precisa da folha, mas quem usa a tela de custos (PCP, Comercial) não
pode ver salário individual. A agregação roda com privilégio e grava **apenas o
consolidado** por competência. Efeito colateral desejável: a taxa fica congelada por
período, e a ficha vira reproduzível.

### Regra 6 — Teste o estado VAZIO

O teste que falta é sempre o do estado sem dado — porque é o estado real quando o módulo
entra em produção. Toda suíte precisa de um caso "nenhum preço cadastrado" e um caso
"nenhuma amostra de P&D".

---

## 7. Telas

### 7.1 Ficha de custo do produto

Para um SKU: custo do kg de fórmula, granel por unidade, embalagem por unidade, conversão,
custo unitário, e — quando houver preço de venda — a margem.

Abaixo, as linhas de fórmula e BOM, cada uma com quantidade, preço, custo e **procedência
visível** (`ESTIMADO_PD` / `COTADO` / `PAGO`). No topo, a composição por procedência.

Se a ficha estiver incompleta: **não exiba o total**. Exiba as partes, a lista do que
falta, e um caminho de um clique para resolver (ir ao material, ou pedir estimativa ao
P&D).

### 7.2 Margem por pedido / cliente

A visão que responde "esse cliente dá dinheiro". Receita do pedido menos custo das
unidades, aberto por natureza (matéria-prima, embalagem, conversão). Com o grau de
confiança herdado das fichas.

### 7.3 Ocupação e absorção

Horas-padrão realizadas contra capacidade, por mês e por linha. É onde a ociosidade
aparece como número, e onde a diretoria entende por que o custo unitário é o que é.

### 7.4 Pendências de custo

Fila do que impede fichas de fechar, **ordenada por volume desbloqueado**, não por quanto
o material pesa.

> Diferença medida, e é grande: ordenar por "material mais usado" fecha 9 SKUs com 83
> preços (29,5% do volume). Ordenar por "volume desbloqueado por preço digitado" — guloso
> por SKU, já que preços são compartilhados entre SKUs — fecha **metade do volume com 66
> preços** e 63% com 101. Mesmo esforço, o dobro de resultado. Ficha só fecha quando
> **todos** os materiais daquele SKU têm preço, e é essa a métrica a otimizar.

---

## 8. Critérios de aceite

1. Com a base sem preço nenhum, **nenhuma ficha exibe custo total** e nenhum número sai
   `NaN`, `Infinity` ou negativo.
2. Amostra de P&D sem custo por item **não pode ser concluída**.
3. Compras atualizando um custo estimado **preserva o histórico** e registra o desvio
   contra a estimativa do P&D.
4. Ficha com item sem preço exibe as partes, o total como indisponível, e a lista do que
   falta.
5. Material com preço em unidade não conversível aparece como *incompatível*, com motivo,
   distinto de *sem preço*.
6. Produto sem densidade: custo do **kg** de fórmula calcula; custo por **unidade** não, e
   o motivo aparece.
7. Densidade `-1` ou ausente nunca gera número.
8. Ocupação calculada por horas-padrão; a duração da OP não aparece em nenhuma conta de
   absorção.
9. Ficha de competência passada é reproduzível — recalcular hoje devolve o mesmo número.
10. Nenhuma tela de custo lê salário individual.
11. A suíte cobre o estado vazio e o estado parcial, além do completo.
12. O motor roda contra a base real de produção sem número inválido — e esse ensaio é
    parte da suíte, não um script avulso.

---

## 9. Fora de escopo nesta entrega

- Financeiro transacional (contas a pagar/receber, caixa, conciliação).
- Custeio ABC ou centros de custo múltiplos. Uma taxa de planta, evoluindo para taxa por
  linha quando a lotação por linha estiver cadastrada.
- Custo real por OP com consumo valorizado — depende de estoque com saldo de abertura
  confiável e de apontamento da etapa de manipulação. Modele o razão de custos para
  recebê-lo, mas não o implemente agora.
- Câmbio e custo de importação além do que a cotação já calcula.

---

## 10. Referência de implementação

Neste repo (app de PCP, Firebase), como fonte de lógica e de casos de teste:

- `public/shared/custos.js` — motor, funções puras, padrão UMD
- `run_custos_test.js` — 113 asserções, incluindo os casos de estado vazio
- `run_custos_ensaio.js` — ensaio contra a base real, falha com exit 1 em número inválido
- `PLANO_CUSTOS.md` — a arquitetura completa e todos os números medidos

A interface correspondente foi construída e **removida de produção** em 2026-09-14
(commit `bb245a0`): a decisão foi construir o módulo direto no ERP, onde a cadeia
P&D → Compras dá ao custo uma origem nativa que o app de PCP não tem.
