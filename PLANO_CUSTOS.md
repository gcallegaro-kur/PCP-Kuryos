# PLANO_CUSTOS.md — arquitetura do módulo de Custos

Documento vivo. Decisões tomadas na sessão de arquitetura de 2026-09-14, ancoradas em
leitura do código (não em teoria de ERP). Nada implementado ainda.

Leia junto: `CLAUDE.md` (estado dos módulos e armadilhas), `AGENT_STATUS.md` (quem está
mexendo em quê), `PLANO_PLANEJAMENTO_PCP.md` (o apontamento de manipulação, que é
pré-requisito da Fase 5 daqui).

---

## 1. Para que serve

Prioridade definida pelo usuário, nesta ordem:

1. **Quanto cobrar num orçamento novo.** Custo de reposição de um SKU antes de aceitar o
   pedido. É o que uma private label de cosméticos faz toda semana com ~30 marcas.
2. **Qual foi a margem real do que já produzi.** Custo realizado por OP/pedido.
3. **Onde o dinheiro está** (valorização de estoque, compras por período, perdas).

As três compartilham o mesmo motor. O que muda entre elas é a **fonte do preço do
material** e o **grau de dependência do inventário**, e é por isso que a sequência de
implementação existe (seção 7).

---

## 2. O que já existe (inventário, com evidência no código)

| Peça | Onde | Estado |
|---|---|---|
| Custo de aquisição *landed* | `calcularCustoItemCotacao`, `public/shared/utils.js:~3990` | Pronto: preço líquido + IPI + ST + ISS + frete rateado − crédito ICMS, com conversão de unidade e recusa explícita de comparar sem fator de conversão |
| Custo congelado na decisão da cotação | `custoUnitarioNaDecisao`, gravado em `public/compras.html:3907` e `:4061` | Grava. **Ninguém lê depois** |
| Explosão de fórmula + BOM | `explodirMateriaisNecessarios`, `utils.js:1096` | Granel por volume nominal × overfill × perda × densidade; embalagem por `qtdPorPeca` |
| Custo mensal de colaborador | `custoMensalColaborador`, `public/rh_dashboard.html:140` | Fórmula CLT completa (FGTS, 13º, FGTS s/13º, férias+1/3, FGTS s/férias, multa, desconto VT). Estágio e PJ parciais; Temporário/Aprendiz/Terceirizado **sem regra** |
| Tempo, equipe e paradas por lote | apontamento em `public/form.html` (`duracao`, `colaboradores`, `linha`, `paradas`) | Existe para envase/rotulagem/posto. **Zero para manipulação/granel** |
| Setor do apontamento | `utils.js:553` classifica em `linha` / `rotulagem` / `posto` | Pronto — é a granularidade natural da taxa por setor (Fase 4) |
| Setor do cargo | `rh_cargos/{key}.setor` | Pronto — é o elo colaborador → setor |
| Preço de venda | itens do pedido comercial (`valor`, `desconto`, `%NF`) | Existe |
| Perdas | nó `perdas` | Existe, ainda não entra em custo |

### O buraco estrutural

**O lote não carrega preço.** O recebimento grava em `estoque_lotes`
(`functions/index.js:1520`) lote, validade, endereço, saldo, fornecedor e número da NF —
e **nenhum valor**. O movimento de estoque (`:1532`) idem. O consumo de produção
(`baixarEstoqueConsumo`, `public/form.html:2905`) baixa quantidade e mais nada.

O sistema sabe exatamente *quanto* de cada material entrou e saiu, e não sabe *quanto
custou* nada disso. Não há valoração de estoque, não há custo médio, não há custo real
de OP — e **não dá para reconstruir depois**, porque o dado não foi gravado na hora.

### Custos fixos não existem

Nenhum nó, nenhuma tela, nenhum campo. Aluguel, energia, depreciação, despesa
administrativa: tudo ausente. É dado mestre novo (seção 5).

---

## 3. Restrição que decide a arquitetura: salário é restrito por papel

`database.rules.json:220` libera `rh_colaboradores` para `rh` e `admin` apenas. O papel
`pcp` não lê. Logo o motor **não pode** calcular taxa-hora no cliente somando a folha:
ou a tela de Custos só funcionaria para o RH, ou vazaria salário individual para o PCP.

**Decisão:** a taxa de conversão é um **artefato de competência**, não um cálculo ao
vivo. Um agregador (Function ou rotina admin) lê a folha com privilégio e grava em
`custos_taxas/{competencia}` **somente o consolidado** — R$/dia, R$/hora, headcount por
setor. Nada individual. A tela de Custos lê só esse nó.

Dois ganhos, não um: além de resolver a privacidade, congela a taxa por mês. Uma ficha
de custo calculada em março continua reproduzível em junho, que é exatamente o que
contabilidade de custos exige.

---

## 4. O modelo de custo

### Conversão: custo do dia de operação

```
folhaProducaoMensal  = Σ custoMensalColaborador(c) para c ativo em setor produtivo
fixosProducaoMensal  = Σ custos_fixos vigentes com rateio = PRODUCAO
custoDiaOperacao     = (folhaProducaoMensal + fixosProducaoMensal) / diasUteis
custoHoraPlanta      = custoDiaOperacao / horasPorDia
custoConversaoUnit   = custoHoraPlanta × tempoPadraoPorUnidade(SKU)
```

Despesa marcada `ADMINISTRATIVO` **não** absorve em custo de produto — sai da margem,
não entra no custo. Misturar as duas é o erro clássico que faz todo produto parecer caro
e nenhuma decisão de preço fazer sentido.

**Evolução (Fase 4), taxa por setor:** agrupa colaboradores por `rh_cargos/{key}.setor`,
calcula a folha de cada setor produtivo, rateia o fixo geral por hora-setor, e aplica a
taxa do setor ao tempo apontado naquele setor. A classificação linha/rotulagem/posto já
existe em `utils.js:553` — não se inventa estrutura nova.

**Capacidade sempre conservadora.** Regra já registrada no `CLAUDE.md`: apontamento lança
lote inteiro como se fosse uma hora e infla a média. `horasPorDia` e o tempo padrão saem
pelo **menor** valor entre média histórica e teto relatado. Taxa-hora superestimada
esconde custo; capacidade superestimada gera prazo que não se cumpre. Os dois erram para
o mesmo lado.

### Material: hierarquia de fonte, com procedência carimbada linha a linha

```
1. custoUnitarioNaDecisao do PC mais recente do material   → fonte: PAGO
2. custoReferencia do fornecedor homologado                → fonte: COTADO
3. custoTargetUsd × câmbio (só MPES)                       → fonte: ALVO
4. nada                                                    → fonte: SEM_CUSTO
```

**`SEM_CUSTO` nunca vira zero.** Esta é a regra mais importante do documento. No MRP, o
balde BACKLOG existe porque inventar data produz um plano preciso e falso. Em custo é
pior: um material sem preço tratado como zero não deixa a ficha *incompleta*, deixa a
ficha **barata** — e a margem sai alta, errada e convincente. A ficha carrega
`completo: false` e a lista de códigos sem custo, e a tela recusa apresentar margem de
ficha incompleta.

---

## 5. Modelo de dados (nós novos e campos aditivos)

### Nós novos

```
custos_fixos/{key}
  descricao, categoria: ALUGUEL|ENERGIA|DEPRECIACAO|MANUTENCAO|ADM|OUTROS
  valorMensal
  rateio: PRODUCAO | ADMINISTRATIVO
  vigenciaInicio: "AAAA-MM", vigenciaFim: "AAAA-MM" | null (vigente)
  criadoPor, criadoEm, atualizadoEm

custos_parametros/{competencia}          # competencia = "AAAA-MM"
  diasUteis, horasPorDia, turnos
  definidoPor, definidoEm

custos_taxas/{competencia}               # gravado pelo agregador; SEM dado individual
  folhaProducaoMensal, fixosProducaoMensal, fixosAdministrativoMensal
  custoDiaOperacao, custoHoraPlanta
  porSetor: { linha: {headcount, custoHora}, rotulagem: {...}, posto: {...} }
  base: { diasUteis, horasPorDia }
  colaboradoresForaDaRegra                # tipos sem fórmula confirmada (D-10)
  calculadoEm, calculadoPor, versaoMotor

custos_fichas/{skuKey}/{competencia}     # snapshot congelado da ficha
  custoMp, custoEmbalagem, custoConversao, custoUnitario
  linhas: [{ materialCodigo, qtd, unidade, custoUnit, fonte, ref }]
  completo: bool, semCusto: [codigos]
  massaLoteKg, volumeGranelL             # herdados da explosão
  calculadoEm, versaoMotor
```

### Campos aditivos (Fase 0 — o que não pode esperar)

```
estoque_lotes/{itemKey}/{loteKey}
  + custoUnitario        # custoUnitarioNaDecisao do item do PC, na unidade do cadastro
  + custoFonte: "PC"
  + custoRef: { pedidoKey, itemKey }
  + custoFreteRateado

movimentos_estoque/{itemKey}/{movKey}
  + custoUnitario, custoTotal
```

Regras de banco: leitura de `custos_*` para `pcp`, `compras` e `admin`; escrita de
`custos_fixos` e `custos_parametros` para `admin` (e `pcp`, se o usuário quiser);
`custos_taxas` **só servidor**. Atenção à armadilha já registrada no `CLAUDE.md`:
conferir a regra do nó novo contra os papéis que de fato usam a TELA, senão a escrita
volta `PERMISSION_DENIED`, o `.catch()` engole e o módulo nasce decorativo.

---

## 6. Onde o código mora

- **Motor:** `public/shared/custos.js` **novo**. Funções puras, no padrão dos módulos
  recentes (`rotas-pc.js`, `expedicao-grade.js`, `contatos-cliente.js`) — e não dentro
  de `utils.js`, que já está em 254 KB e é superfície de colisão com o Codex.
  - `calcularTaxaConversao({folha, fixos, diasUteis, horasPorDia})`
  - `custoUnitarioMaterial(materialKey, base)` → `{valor, fonte, ref, data}`
  - `calcularFichaCusto(produto, formula, bom, materiais, precos, taxas, params)`
  - `margemPedido(pedido, fichas)` → receita, custo, margem R$ e %
- **Tela:** aba em `public/insumos.html`, pelo mesmo motivo do MRP — página nova exige as
  **cinco pontas** (`pageAccessRules`, navbar, `login.html`, `usuarios.html`,
  `database.rules.json`), e três desses arquivos são do Codex. Promove para `custos.html`
  própria quando der para fazer o registro em um commit coordenado.
- **`produtos.html` está fora:** é código morto por construção — `location.replace` para
  `cadastros.html?tab=produtos` na linha 7. Mesmo caso de `materiais.html`.
- **Agregador da taxa:** Function agendada ou callable em `functions/`, porque precisa do
  privilégio para ler `rh_colaboradores`.

---

## 7. Fases

| Fase | O quê | Esforço | Depende de |
|---|---|---|---|
| **0** | **Custo no lote no recebimento** (campos aditivos da seção 5) | ~20 linhas em `functions/index.js` | Coordenação com o Codex — arquivo dele |
| 1 | Cadastro de custos fixos + parâmetros de competência + agregador da taxa | Tela + Function | — |
| 2 | Motor da ficha de custo + aba no `insumos.html` + margem por pedido | Motor + tela | Fase 1 |
| 3 | Reconciliação PC × NF (valor por item no recebimento + relatório de divergência) | Campo + relatório | Fase 0 |
| 4 | Taxa por setor (linha/rotulagem/posto) via cargo → setor | Refino do agregador | Fase 1 |
| 5 | Custo real por OP e valorização de estoque | — | Dia D + Fase 1 do `PLANO_PLANEJAMENTO_PCP.md` |

**A Fase 0 é a única urgente.** As prioridades 2 e 3 do usuário (margem realizada e
valorização) dependem de o lote carregar preço, e esse dado só existe se for gravado no
momento da entrada. Hoje `estoque_lotes` está **vazio em produção** — o custo de fazer é
zero e a base nasce valorizada desde o primeiro lote. Cada lote recebido sem preço depois
disso é um buraco permanente.

---

## 8. Restrições que NÃO são bugs

- **Manipulação/granel não tem apontamento.** Metade do custo de conversão é cega até a
  Fase 1 do `PLANO_PLANEJAMENTO_PCP.md`. Até lá, tempo padrão por fórmula, declarado e
  marcado como estimativa — não medido.
- **Densidade `-1` em produtos importados.** `explodirMateriaisNecessarios` já recusa
  calcular granel sem densidade positiva, e `baixarEstoqueConsumo` já trata o caso
  (`form.html:2919`). A ficha de custo herda a mesma proteção: sem densidade, custo de
  granel é `SEM_CUSTO`, e o BOM por peça continua exato.
- **Tipos de contrato sem fórmula** (Temporário, Aprendiz, Terceirizado, Outro) ficam
  fora da folha agregada e aparecem contados em `colaboradoresForaDaRegra`. Não chutar
  encargo.
- **Alíquotas de IPI/ICMS-ST digitadas de cabeça.** Já registrado em
  `MELHORIAS_FUTURAS.md` (falta `ncm` no cadastro de material). O custo *landed* é tão
  bom quanto a alíquota que alguém digitou na cotação — a ficha herda essa incerteza.

## 9. Antes de fechar qualquer fase

Lição que o MRP cobrou caro e vale para todo cálculo novo deste app: **rodar o motor
contra a base real antes de fechar**. Os dois defeitos do MRP (atraso espalhado em
semanas vencidas, sentinela de balde vazando no texto) passaram por 46 asserções
sintéticas e só apareceram com dado de produção. Um motor de custo erra do mesmo jeito e
com consequência pior, porque o número sai plausível.
