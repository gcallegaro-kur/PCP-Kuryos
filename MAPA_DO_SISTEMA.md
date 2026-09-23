# Mapa do sistema — onde cada informação mora

Feito a pedido do usuário em 2026-09-23: *"vamos criando features e infelizmente
fica muito bagunçado, sinto que as informações estão de alguma forma dispersas"*.

Este documento responde a três perguntas: **em que tela se faz cada coisa**,
**quem é dono de cada informação** e **quem pode ver o quê**. Quem for mexer no
sistema lê isto antes de criar tela nova — na dúvida entre criar uma porta nova
e uma aba na porta existente, a resposta padrão é **aba**.

## A regra de organização

**Um assunto, uma tela, abas dentro dela.** O menu está dividido em oito blocos
(Analytics, Geral, Compras, PCP, Logística, Produção, RH, ADM) e cada bloco
deveria ter uma porta por assunto. Quando a mesma informação aparece em duas
telas, uma delas é a **dona** (escreve) e a outra é **consulta** (só lê) — e o
texto na tela diz isso, para ninguém cadastrar a mesma coisa em dois lugares.

## Onde se faz cada coisa

| Assunto | Tela dona (escreve) | Também aparece em (só consulta) |
|---|---|---|
| Cliente, produto, material, fórmula/BOM, especificação de **produto** | `cadastros.html` (abas) | `qualidade.html` (aba Especificações) |
| Especificação de **matéria-prima** | `qualidade.html` (aba Especificações e a própria análise) | — |
| Pedido comercial e orçamento | `comercial.html` (criar) · `gestao_comercial.html` (editar, com versão e trava) | `pedidos.html` (acompanhar), resumo em PDF no Comercial |
| Preço de venda e análise comercial | `gestao_comercial.html` | `pedidos.html` |
| Emissão de OP | `emitir_op.html` | `ops.html`, `planejamento.html` |
| Programação e sequência de produção | `planejamento.html` | `form.html` (painel de turno), `horizonte.html` (fora do menu) |
| Apontamento de produção, paradas, perdas, troca de linha | `form.html` | `historico.html`, `dashboard.html` |
| Manipulação do granel (pesagem, conferência, rendimento) | `manipulacao.html` | `qualidade.html` (análise do granel), `dossie_lote.html` |
| Compras: solicitação, cotação, pedido de compra, recebimento | `compras.html` | `logistica.html` (agendamento), `insumos.html` (MRP) |
| Necessidade de materiais (MRP) | `insumos.html` | — |
| Estoque, endereçamento, inventário, descarte | `estoque.html`, `separacao_materiais.html`, `descarte.html` | `insumos.html`, `qualidade.html` |
| Qualidade: fila de inspeção, laudos, RNC, fornecedores | `qualidade.html` | `dossie_lote.html` |
| Expedição de PA, faturamento e carga parcial | `expedicao.html` | `logistica.html`, `relatorio_expedicao.html` |
| Auditoria de um lote ponta a ponta | `dossie_lote.html` (só leitura) | — |
| Usuários, papéis e módulos | `usuarios.html`, `admin.html` | — |
| RH | `rh_cadastros.html`, `rh_avaliacao.html`, `rh_ferias.html`, `rh_dashboard.html` | — |

### Telas aposentadas em 2026-09-23

`produtos.html`, `materiais.html`, `clientes.html` e `formulas.html` eram
**redirecionamentos** para abas de `cadastros.html` desde a Fase 6 — 2.581 linhas
que só serviam para abrir e sair. Foram removidas; quem tiver link antigo salvo
deve usar `cadastros.html?tab=produtos` (ou `materiais`, `clientes`, `formulas`).
`horizonte.html` continua fora do menu **de propósito**: está inativa na
navegação, mas ainda grava `alocacoes_planejamento`, que o motor de reajuste lê.

## Quem é dono de cada informação (nó do banco → tela que escreve)

| Nó | Quem escreve | Observação |
|---|---|---|
| `pedidos_comerciais`, `orcamentos` | Comercial e Gestão Comercial | a edição do pedido é só pela Gestão Comercial (versão, motivo, trava por produzido/expedido) |
| `pedidos` (backlog do PCP) | nasce do pedido comercial; `produzido` vem do apontamento | nunca editar à mão |
| `ops` | `emitir_op.html` cria; `form.html` aponta; `ops.html` conclui | 14 telas leem |
| `ops/{lote}/manipulacao` | `manipulacao.html` | a Qualidade decide o granel em `qualidade.html` |
| `estoque` (saldo agregado) | apontamento, recebimento e ajuste | saldo ainda não confiável: ver "Dia D" no CLAUDE.md |
| `estoque_lotes` (lote com endereço) | recebimento, conferência de PA, separação, manipulação | status `QUARENTENA` → `LIBERADO` é decisão da Qualidade |
| `especificacoes` | Cadastros (produto) e **Qualidade (matéria-prima)** | chave `{codigo}__v{n}`; editar cria versão nova |
| `specs_mp_propostas` | importador dos laudos antigos (`scripts/importar-specs-mp.js`) | é **sugestão**; só vira especificação quando a Qualidade salva |
| `expedicoes_comerciais`, `agendamentos_expedicao` | Expedição e Logística | carga parcial mantém o saldo reservado para a próxima viagem |
| `nao_conformidades` | Qualidade | RNC de PA nasce da conferência com divergência |

## Quem pode ver o quê

O acesso é por **módulo**, não por tela: `auth_check.js` tem `KURYOS_MODULOS`
(módulo → páginas) e `MODULOS_POR_PAPEL` (papel → módulos). Uma página fora
desse mapa é liberada para qualquer usuário autenticado — é o caso dos manuais.

**Importante, e é uma limitação real:** o menu e as telas escondem o que o
usuário não pode usar, mas a maior parte dos nós do banco tem
`".read": "auth != null"` — qualquer pessoa logada consegue ler via API. Ou
seja, hoje a divisão por papel é **organização da navegação, não sigilo**. Onde
o sigilo importa de verdade (RH, custos, preço de venda), a restrição precisa
estar em `database.rules.json`, não só na tela.

Isso decide como fazer a **busca única** (item 4 do plano de organização, ainda
não implementado): a busca deve filtrar os resultados pelos módulos do usuário e
**omitir** o que ele não pode abrir — nunca mostrar "existe algo que você não
pode ver", que já é vazamento. E, para os assuntos sensíveis, filtrar na tela
não basta: tem que fechar a regra do banco antes.

## Quando criar tela nova (e quando não)

Crie tela nova quando o assunto tem **dono diferente** e **fluxo próprio** —
como o Dossiê do Lote, que é auditoria e não operação. Não crie tela nova para:

- uma visão diferente do mesmo dado (isso é aba, filtro ou modal);
- um relatório de algo que já tem tela (isso é botão de impressão);
- um cadastro que só serve a um fluxo (isso mora dentro do fluxo — como a
  especificação de MP, que nasce na análise da Qualidade).

Toda tela nova entra neste mapa no mesmo commit em que nasce. Mapa
desatualizado é pior que mapa nenhum.
