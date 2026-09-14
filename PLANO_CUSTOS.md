# PLANO_CUSTOS.md — Controladoria: custos, margem e o que NÃO construir

Documento vivo. Sessão de arquitetura de 2026-09-14. Nada implementado ainda.
**Todos os números abaixo foram medidos contra a base de produção `prod-kuryos`**, não
estimados. As sondas somente-leitura estão descritas na seção 10.

Leia junto: `CLAUDE.md`, `AGENT_STATUS.md`, `PLANO_PLANEJAMENTO_PCP.md`.

> **Correção da primeira versão deste documento.** A v1 (commit `35bb392`) assumia que o
> RH tinha folha, que a hierarquia de preço PAGO→COTADO→ALVO teria cobertura e que a
> duração da OP servia de base de absorção. **As três estavam erradas** e a medição
> derrubou todas. O que sobrevive da v1: a regra `SEM_CUSTO` nunca vira zero, a taxa como
> artefato de competência, e a Fase 0 do custo no lote.

---

## 1. A caracterização: o que é "financeiro" e o que não é

Três coisas diferentes andam juntas sob a palavra "financeiro", e confundi-las é o erro
que faz empresa do porte da Kuryos gastar um ano construindo o que custa R$200/mês:

| Camada | O que é | Decisão |
|---|---|---|
| **Fiscal/contábil** | SPED, NF-e, apuração, obrigações acessórias | **Terceirizada.** Nunca se constrói. Erro aqui tem consequência legal |
| **Financeiro transacional** | Contas a pagar/receber, caixa, conciliação bancária, boleto, DRE | **Compra-se.** Conta Azul / Omie / Bling / Granatum, R$100–300/mês, com integração bancária e emissão fiscal que levariam anos para replicar |
| **Controladoria / custos** | Atribuir o fato econômico ao **objeto de custo**: produto, OP, linha, cliente, período | **Constrói-se aqui.** Ninguém vende pronto, porque depende de fórmula, BOM, densidade, `prodHoraRef`, apontamento e OP — dados que só existem neste app |

**A resposta curta: não construa um financeiro. Construa uma controladoria.**

O financeiro transacional é a categoria de software mais commoditizada que existe. A
controladoria de uma fabricante *private label* de cosméticos não é — porque o custo de
um SKU depende de uma fórmula % m/m, de um BOM por peça, de uma taxa de envase por linha
e de uma ociosidade que só o PCP conhece. Nenhum financeiro de prateleira sabe o que é
`percentualMM`.

### Como as ferramentas de ponta fazem isso

O padrão é o mesmo em todos, e vale copiar:

- **SAP** separa **FI** (Financial Accounting — o razão, o fato econômico) de **CO**
  (Controlling — centro de custo, ordem, custeio de produto, e CO-PA para margem por
  cliente/produto). São módulos distintos que se conversam por integração, não um só.
- **TOTVS** separa Financeiro de Custos/Controladoria. **Oracle** separa GL de Cost
  Management. **Odoo** separa Accounting de Analytic Accounting.
- Regra universal: **o financeiro registra o fato; a controladoria atribui o fato a um
  objeto de custo.** O mesmo pagamento de energia é um lançamento no financeiro e um
  rateio por hora-máquina na controladoria.

Dois padrões específicos que valem ser copiados literalmente:

1. **Razão de custos append-only (event-sourced).** Todo evento economicamente relevante
   emite um lançamento imutável: quantidade + valor + objeto de custo + **procedência**.
   É isso que permite auditar um custo três anos depois em vez de recalcular e obter
   outro número. Hoje o app tem 215 movimentos em `movimentos_estoque` e **nenhum com
   valor** — o fato físico é registrado, o econômico é perdido.
2. **Variação é o produto, não o custo.** Todo ERP sério calcula padrão × real e decompõe
   o desvio: **variação de preço** (paguei mais caro), **de consumo** (usei mais
   material), **de eficiência** (demorei mais) e **de absorção/volume** (produzi menos que
   a capacidade que pago). Um custo isolado não gera ação. "Custei R$ 3,20 contra R$ 2,80
   padrão, e R$ 0,30 disso é ociosidade" gera.

### A fronteira com o financeiro comprado

**Uma fronteira, por exportação, em dois sentidos:**

- Este app → financeiro: títulos a pagar (do PC confirmado) e a receber (do pedido
  liberado). CSV/OFX ou API, conforme a ferramenta escolhida.
- Financeiro → este app: **apenas o valor efetivamente pago**, quando divergir do PC.
  É o que fecha a variação de preço.

Não integrar plano de contas, não espelhar lançamento contábil, não replicar DRE. Uma
fronteira, não dez.

---

## 2. O que a base realmente tem (medido em 2026-09-14)

### Excelente, e subaproveitado

| Dado | Medição |
|---|---|
| **Fórmulas** | 172 fórmulas, 169 com itens, 1.151 itens. **167 de 169 fecham entre 99% e 101%** de soma. 841 itens têm `mpCodigo` e **os 841 existem no cadastro de materiais — zero código órfão** |
| **BOM** | 221 versões, 1.128 itens, 1.089 com `qtdPorPeca`, 960 ligados ao cadastro (85%). 158 versões 100% ligadas |
| **`prodHoraRef`** | **321 de 377 produtos** têm taxa de referência (peças/hora). Mediana 617, p25 500, p75 795 |
| **OPs** | 1.356 OPs; 1.267 com início e fim reais; 1.279 com `produzido > 0`; 1.106 com linha. Histórico de 2025-01 a 2026-09 |
| **Turno e calendário** | `config` tem turno 07:00–17:00 (sexta 16:00), pausa de 1h, `diasSemana [1–5]` e feriados. **Horas úteis são calculáveis hoje** |

### Vazio ou quase

| Dado | Medição | Consequência |
|---|---|---|
| **Preço de compra** | **2 pedidos de compra, 2 itens** no total | A hierarquia PAGO tem 2 pontos de dado |
| **Fornecedor homologado / custo de referência / custo target** | **0 de 911 materiais** | As fontes COTADO e ALVO estão vazias |
| **Preço de venda** | `pedidos_comerciais`: 67 pedidos, 411 itens, **0 com valor**. Item é `{descricao, qtd, sku}` — importação legada de 2025-05 a 2026-08 | **Margem é impossível hoje.** Não falta código, falta o dado |
| **Folha** | `rh_colaboradores`: **0 registros**. `rh_cargos`: 3 | `custoMensalColaborador` existe no código e não tem sobre o que rodar |
| **Estoque valorizado** | `estoque_lotes`: 0 lotes. `movimentos_estoque`: 215 movimentos, 0 com valor | Sem valoração, sem custo médio, sem custo real |
| **Densidade** | **6 produtos com densidade > 0**, 34 com valor inválido, 337 ausentes (de 377). `volume` preenchido em 370 | Não dá para converter unidade envasada → kg de granel na maioria |

**Consequência de arquitetura:** a ordem intuitiva (material primeiro, porque "custo é
material") é a ordem errada. O custo de material depende de dado que não existe; o custo
de conversão depende de dado que existe e é bom. **Começa pela conversão.**

---

## 3. Custo de conversão — calculável hoje

### Horas úteis (confirmado: já está no sistema)

Derivadas de `config.turnoHorarios`, `turnoHorariosFim`, `turnoHorariosFimSexta`,
`turnoPausas` e `planejamento.{diasSemana,feriados}`:

```
9h por dia útil, 8h na sexta
setembro/2026 : 21 dias úteis → 185 horas úteis
2026 inteiro  : 260 dias úteis → 2.288 horas úteis (média 191 h/mês)
3 linhas de envase → 555 hora-linha disponíveis por mês
```

### A base de absorção: horas-PADRÃO, não duração de OP

**Medição que derrubou a ideia óbvia.** Usar `dataInicioReal → dataFimReal` da OP como
horas ocupadas dá ocupação de **123% a 243%** — impossível. A causa: é tempo de
calendário, a OP "dorme" à noite e no fim de semana.

A base certa é a horas-padrão, que é o que ERP usa para absorção:

```
horasPadrao(OP) = produzido / prodHoraRef(sku)
```

Cobertura: **1.251 das 1.277 OPs** têm taxa própria do SKU; 26 caem na mediana. Resultado
medido, por mês, contra 3 linhas × horas úteis:

```
2025-06  267 hp / 555  = 48%      2026-03  271 hp / 582  = 47%
2025-08  336 hp / 552  = 61%      2026-04  281 hp / 582  = 48%
2025-10  298 hp / 606  = 49%      2026-06  371 hp / 582  = 64%
2025-12  274 hp / 609  = 45%      2026-08  362 hp / 555  = 65%
---
média do período: 40%   (4.610 horas-padrão / 11.484 hora-linha disponíveis)
```

### O número que mostra por que o custo unitário é alto

**A ocupação média é de 40%. Cerca de 60% da capacidade paga não vira produto.**

Isso não é um detalhe do cálculo, é o cálculo:

```
custoHoraPadrao = custoMensalOperacao / horasPadraoRealizadas     ← certo
                ≠ custoMensalOperacao / horasUteisDisponiveis     ← errado, e "bonito"
```

Dividir pelo disponível produz um custo unitário ~2,5× menor e falso, e esconde
exatamente a informação acionável. É a **variação de absorção/volume** que SAP e TOTVS
calculam, e ela deve aparecer como linha própria no relatório: *"R$ X do seu custo
unitário é capacidade ociosa"*.

**Ressalva conservadora.** `prodHoraRef` é taxa de *referência* e tende ao otimista. Se
for, as horas-padrão estão subestimadas e a ocupação real é **maior** que 40%. Então 40%
é **piso, não estimativa pontual**. Pela regra já travada no `CLAUDE.md` (capacidade
sempre pelo valor conservador), o custo unitário usa a ocupação medida — que é a hipótese
mais cara — e a tela declara a incerteza.

### O único input que falta

**O custo mensal da operação** (folha de produção + custos fixos: aluguel, energia,
depreciação, manutenção). Como `rh_colaboradores` está vazio, este número entra
**top-down**, digitado por competência — que é como uma fábrica desse porte de fato
opera. Quando o RH for populado, o agregador passa a calcular a parcela de folha sozinho,
sem mudar a arquitetura (ver seção 5).

---

## 4. Fórmula como base de custo — sim, com uma correção de enquadramento

A pergunta era se a fórmula serve de *proxy*. Para material ela não é proxy: **é a conta
exata**. Para tempo, ela não serve de jeito nenhum. São duas coisas.

### (a) Custo de material do granel — exato, e não precisa de densidade

```
custoPorKgFormula = Σ ( percentualMM / 100 × precoPorKg(mp) )
```

A fórmula é % m/m, então **o custo do quilo sai sem densidade nenhuma**. Densidade só é
necessária para o passo seguinte, de kg → unidade envasada — e é justamente o que falta
(6 de 377).

**Decisão:** entregar `custoPorKgFormula` para todas as fórmulas ligadas, e o custo por
unidade só onde houver densidade. Travar tudo esperando 371 densidades seria adiar um
número pronto por causa de outro.

Cobertura medida: **83 das 172 fórmulas têm 100% dos itens ligados ao cadastro** e são
custeáveis assim que houver preço. As outras têm itens sem `mpCodigo` — é cadastro
faltando, não defeito de motor.

**E as densidades têm caminho barato:** `config.tiposEnsaio` já inclui **DENSIDADE** como
ensaio de CQ. A Qualidade já mede. Ligar o resultado do ensaio ao cadastro do produto
aproveita medição que já acontece, em vez de abrir campanha de cadastro.

### (b) Tempo de manipulação — a fórmula não diz, e não vale fingir

A fórmula diz o que entra, não quanto demora. Proxy honesto: **tempo de batelada por
faixa de massa e por equipamento/tanque** — uma tabela pequena, preenchida uma vez,
marcada como *estimativa declarada* na ficha. Vira medição real só com a Fase 1 do
`PLANO_PLANEJAMENTO_PCP.md` (apontamento de manipulação).

### Quantos preços precisam ser digitados: 83, não 911

Pareto medido sobre o que foi **efetivamente produzido nos últimos 12 meses** (198 SKUs,
2,37 milhões de unidades, 474 materiais alcançados):

```
 21 materiais cobrem 50% da exposição
 83 materiais cobrem 80%
138 materiais cobrem 90%
201 materiais cobrem 95%
```

Top 15 por exposição: `MPGR-00132`, `MPGR-00066`, `MPGR-00127`, `MPGR-00008`, `EP-00012`,
`ET-00018`, `MPGR-00012`, `ES-00014`, `ET-00032`, `ET-00003`, `EP-00106`, `EP-00009`,
`EP-00015`, `ET-00051`, `MPGR-00086`.

Isso transforma "projeto de cadastro impossível" em uma tarde de trabalho. E a tela deve
apresentar exatamente essa fila, ordenada por exposição, com o quanto de cobertura cada
preço digitado adiciona.

**Cobertura resultante:** 92 SKUs têm estrutura 100% ligada, o que corresponde a
**1.601.918 de 2.372.927 unidades — 68% do volume produzido.**

---

## 5. Arquitetura

### O razão de custos (append-only)

```
razao_custos/{aaaa-mm}/{lancamentoKey}
  tipo: ENTRADA_MATERIAL | CONSUMO_MATERIAL | HORA_PRODUCAO | PERDA | ABSORCAO | SAIDA_VENDA
  objeto: { tipo: OP|PEDIDO|LINHA|PERIODO, ref }
  quantidade, unidade
  valorUnitario, valorTotal
  procedencia: PAGO | COTADO | ALVO | PADRAO | ESTIMADO | SEM_CUSTO
  origemRef        # PC, OP, apontamento, competência — o que gerou
  em, por, versaoMotor
```

Imutável. Correção se faz por lançamento de estorno, nunca por edição — é o que torna o
custo auditável e o que separa isto de uma planilha.

**Produtores:** recebimento (entrada valorizada), apontamento (consumo + horas), perdas,
expedição (custo do vendido), fechamento de competência (absorção).
**Consumidores:** ficha de custo, margem por pedido/cliente, ocupação/ociosidade,
variações.

### Nós de apoio

```
custos_operacao/{competencia}          # o input top-down
  folhaProducao, fixos: [{descricao, categoria, valor, rateio}]
  custoMensalOperacao
  rateio: PRODUCAO | ADMINISTRATIVO     # ADM não absorve em produto
  definidoPor, definidoEm

custos_taxas/{competencia}             # calculado; sem dado individual
  horasUteis, diasUteis, linhasAtivas, horaLinhaDisponivel
  horasPadraoRealizadas, ocupacaoPct
  custoHoraPadrao, custoHoraDisponivel  # os dois, lado a lado, de propósito
  calculadoEm, versaoMotor

custos_precos/{materialKey}            # preço por material, com procedência
  valor, unidade, fonte, ref, vigenciaInicio, por, em

custos_fichas/{skuKey}/{competencia}   # snapshot congelado
  custoPorKgFormula, custoEmbalagem, custoConversao, custoUnitario
  linhas: [{codigo, qtd, unidade, custoUnit, procedencia}]
  completo, semCusto: [codigos], estimados: [codigos]
```

### Campos aditivos (Fase 0 — o que não pode esperar)

```
estoque_lotes/{item}/{lote}   + custoUnitario, custoFonte, custoRef, custoFreteRateado
movimentos_estoque/{item}/{mov} + custoUnitario, custoTotal
```

`estoque_lotes` está **vazio em produção**: hoje custa zero e a base nasce valorizada.
Cada lote recebido sem preço depois do Dia D é buraco permanente.

### Privacidade

`database.rules.json:220` libera `rh_colaboradores` só para `rh`/`admin`. Quando a folha
existir, quem a soma é o agregador com privilégio; `custos_taxas` guarda **só o
consolidado**. A tela de Custos nunca lê salário individual. Efeito colateral bom: a taxa
fica congelada por competência e uma ficha de março continua reproduzível em junho.

### Onde o código mora

- Motor: **`public/shared/custos.js` novo**, funções puras. Não em `utils.js` (254 KB,
  superfície de colisão com o Codex).
- Tela: aba em `public/insumos.html` — página nova custa as cinco pontas
  (`pageAccessRules`, navbar, `login.html`, `usuarios.html`, `database.rules.json`), e
  três desses arquivos são do Codex.
- Agregador de competência: `functions/`.
- `produtos.html` está fora: código morto por `location.replace` na linha 7.

### Regra inegociável

**`SEM_CUSTO` nunca vira zero.** Material sem preço tratado como zero não deixa a ficha
incompleta — deixa a ficha **barata**, e a margem sai alta, errada e convincente. Mesma
disciplina do balde BACKLOG do MRP. A ficha carrega `completo: false` e a lista de
códigos descobertos, e a tela recusa exibir margem de ficha incompleta.

---

## 6. Fases

| Fase | O quê | Precisa de | Entrega |
|---|---|---|---|
| **A** | **Custo de conversão e ocupação** | **1 número seu:** custo mensal da operação | Custo/hora-padrão, custo de conversão por SKU, e o relatório de ociosidade (40%) que ninguém viu ainda |
| **B** | Ficha de custo de material | 83 preços (Pareto 80%) | Custo/kg de 83 fórmulas + embalagem → ficha de 92 SKUs = 68% do volume |
| **C** | Margem | Preço de venda no Comercial | Margem por pedido, SKU e cliente |
| **D** | Razão de custos + Fase 0 (custo no lote) | Coordenação com o Codex | Custo auditável, valoração de estoque |
| **E** | Variações padrão × real | Fases B e D | Preço, consumo, eficiência, absorção |
| **—** | **Financeiro transacional** | — | **Comprar. Não construir.** |

A Fase A é a única que não depende de ninguém digitar nada além de um número, e é a que
produz a informação mais nova da lista.

---

## 7. Restrições que NÃO são bugs

- **Duração de OP é calendário, não ocupação.** Nunca usar como base de absorção. Medido:
  dá 123–243%.
- **`prodHoraRef` é otimista por natureza** → ocupação de 40% é piso. Custo unitário usa a
  hipótese conservadora (mais cara).
- **Manipulação/granel sem apontamento.** Tempo de conversão do granel é estimativa
  declarada até a Fase 1 do `PLANO_PLANEJAMENTO_PCP.md`.
- **Densidade em 6 de 377 produtos.** Custo por kg não depende dela; custo por unidade
  depende. Não travar um pelo outro.
- **310 itens de fórmula sem `mpCodigo`** e 168 itens de BOM sem material ligado. É
  cadastro faltando — a ficha os marca `SEM_CUSTO`, não os ignora.
- **Alíquotas de IPI/ICMS-ST digitadas de cabeça** (falta `ncm` no material, já em
  `MELHORIAS_FUTURAS.md`). O custo *landed* herda essa incerteza.
- **Tipos de contrato sem fórmula** (Temporário/Aprendiz/Terceirizado) ficam fora da folha
  agregada e aparecem contados, quando o RH for populado. Não chutar encargo.

## 8. Antes de fechar qualquer fase

Rodar o motor **contra a base real**. Os dois defeitos do MRP passaram por 46 asserções
sintéticas e só apareceram com dado de produção. Esta sessão é a prova: três premissas da
v1 deste documento sobreviveram à revisão de código e morreram na primeira medição.

## 9. O que este documento decidiu

1. Não construir financeiro transacional — comprar, e integrar por **uma** fronteira.
2. Construir controladoria: razão de custos append-only, objeto de custo, variações.
3. Começar pela **conversão**, não pelo material — é o inverso da intuição e o que o dado
   manda.
4. Absorção por **horas-padrão**, nunca por duração de OP.
5. Custo de fórmula **por kg**, desacoplado da densidade.
6. Fila de cadastro de preço ordenada por exposição: **83 materiais, não 911**.
7. `SEM_CUSTO` nunca vira zero.

## 10. Como os números foram medidos

Quatro sondas somente-leitura contra `prod-kuryos` em 2026-09-14, via `firebase-admin`
com a service account do repo. Nenhuma escrita. Mediram: contagem e preenchimento por
campo de todos os nós raiz; cobertura de fórmula/BOM contra o cadastro de materiais;
horas úteis derivadas do `config`; ocupação por duração de OP **e** por horas-padrão;
Pareto de materiais ponderado pelo volume produzido em 12 meses.

Os scripts ficaram fora do repo (scratchpad da sessão). Se virar rotina, o lugar deles é
um `run_custos_ensaio.js` ao lado dos outros testes.
