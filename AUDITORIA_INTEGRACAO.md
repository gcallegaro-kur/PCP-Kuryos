# Auditoria de integração — falhas e gargalos entre entidades

Levantada em 2026-09-08, a pedido do usuário: *"Revise todo o projeto para
identificar falhas e gargalos de comunicação entre entidades"*.

Método: varredura de **todos** os arquivos de `public/` mapeando, nó a nó do
RTDB, quem **lê** e quem **escreve**. Cada achado abaixo tem a evidência do
código, não é impressão. Onde o número vem do banco, ele foi lido de produção
na data acima.

O critério de "gargalo de comunicação" é estreito de propósito: **um setor
produz uma informação que outro setor precisa e não recebe**. Não entram aqui
funcionalidades ausentes nem melhorias de tela — essas estão em
`MELHORIAS_FUTURAS.md`.

**Limite do método, dito na frente.** O mapa inicial foi montado por expressão
regular sobre `db.ref('no')`, e isso **não enxerga acesso mediado por função** —
`ajustarEstoque(...)`, `putawayEstoqueLote(...)` e afins escrevem sem que o
nome do nó apareça no arquivo que chama. Dois "achados" nasceram invertidos
por causa disso (o consumo de produção, item 3, e o `usuarios.html`, que
escreve normalmente via `database.ref` em vez de `db.ref`) e foram refeitos
lendo a implementação. Todos os nove itens abaixo foram confirmados na
implementação, não no mapa.

---

## Resumo

| # | Elo | Gravidade | Custa hoje |
|---|-----|-----------|------------|
| 1 | MRP → Compras | 🔴 Alta | A necessidade calculada morre na tela |
| 2 | Estoque → Compras | 🔴 Alta | Compra-se sem ver o que já tem |
| 3 | Entrada de estoque | 🔴 Alta | 4% dos materiais têm saldo; 11 estão negativos |
| 4 | Qualidade → Compras | 🟠 Média | Fornecedor ruim não aparece na cotação |
| 5 | Compras → Financeiro | 🟠 Média | Dado gravado para um leitor que não existe |
| 6 | Qualidade → Logística | 🟠 Média | Liberar não move o material |
| 7 | Área de quarentena | 🟠 Média | Status separa; o chão não |
| 8 | Separação → PCP | 🟡 Baixa | A falta não sobe |
| 9 | Duas fontes de saldo | 🟡 Baixa | Divergência silenciosa |

---

## 1. 🔴 Matriz de Insumos (MRP) → Compras: o elo não existe

**Evidência.** `insumos.html` grava e lê `insumos`. Os leitores do nó são
`insumos.html`, `horizonte.html` e `dashboard_analise.html`. `compras.html`
**não referencia `insumos` nenhuma vez**. E `insumos.html` **não referencia
`solicitacoes_compra` nenhuma vez** — não há caminho de ida nem de volta.

**O que acontece na prática.** O PCP roda a Matriz, ela explode fórmula e BOM,
compara com o disponível e mostra a falta. Aí o cálculo para. O comprador não
recebe nada, não é notificado, e a tela de Compras não mostra esse número em
lugar nenhum. Alguém precisa olhar a Matriz, anotar e abrir a solicitação à
mão — e é aqui que uma falta some entre uma conversa e outra.

**Consequência.** É o gargalo mais caro dos nove, porque quebra a corrente no
ponto em que ela existe justamente para antecipar: o MRP existe para descobrir
a falta **antes** dela parar a linha, e a informação não chega a quem compra.

**Correção sugerida.** Um botão *"Gerar solicitação de compra"* na Matriz,
criando a solicitação já com material, quantidade faltante e a demanda que a
originou. É a menor mudança que fecha o elo.

---

## 2. 🔴 Estoque → Compras: o comprador decide sem ver o saldo

**Evidência.** `compras.html` não lê saldo nenhum: nenhuma ocorrência de
`saldoAtual`, `saldoEmpenhado` ou `saldoDisponivel`. O que existe é um **link**
no topo — *"📦 Ver Estoque / WMS →"* — para `estoque.html`. A exibição foi
migrada para lá por decisão registrada no código (*"Estoque merece página
dedicada"*), e a integração de volta nunca foi feita.

**O que acontece na prática.** Na solicitação, na cotação e no pedido, a
quantidade é digitada sem que a tela mostre saldo, empenhado ou disponível.
O comprador não está cego — é um clique — mas o número não está onde a decisão
é tomada, e um clique a mais é a diferença entre conferir sempre e conferir às
vezes.

**Consequência.** Compra duplicada e compra maior que a necessária. Agravado
pelo item 3: hoje, mesmo abrindo a outra tela, o saldo que ele encontraria não
é confiável.

**Correção sugerida.** Mostrar saldo atual, empenhado e disponível ao lado de
cada item, na solicitação e na cotação — o comentário em `shared/utils.js` já
previa que `saldoDisponivel` seria "calculado na leitura (compras.html)", o que
nunca chegou a acontecer. É leitura de um nó que já existe.

---

## 3. 🔴 Estoque: a saída funciona, a entrada não — e o saldo fica negativo

**O consumo É baixado**, ao contrário do que uma leitura rápida sugere.
`baixarEstoqueConsumo` (`form.html:2837`) roda a cada apontamento de Linha:
explode fórmula e BOM pela quantidade **realmente produzida** e faz
`ajustarEstoque(-quantidade)`, `baixarEmpenho` e a baixa do lote endereçado.
A escrita não aparece numa busca por `db.ref('estoque`, porque passa por
função de `shared/utils.js` — foi assim que este achado nasceu invertido na
primeira passada e precisou ser refeito.

**O problema é o outro lado.** Números lidos de produção em 2026-09-08:

| Medida | Valor |
|---|---|
| Materiais cadastrados | **906** |
| Materiais com qualquer registro de estoque | **37** (4%) |
| Desses, com **saldo negativo** | **11** |
| Pior caso | ET-00012 · **−538.784 un** · CX PAP ÁGUA MICELAR GLOW |

Outros negativos relevantes: EP-00053 e EP-00082 a −9.475 un; EP-00051 e
EP-00080 a −5.496; quatro itens a −4.380.

**Por que acontece.** O apontamento desconta de um estoque em que **nunca se
deu entrada**. A entrada só existe quando alguém recebe contra um Pedido de
Compra na Logística — e a esmagadora maioria do material nunca passou por
esse caminho. O próprio código já registra o diagnóstico
(`compras.html`, bloco do Pedido de Compra Direto): *"enquanto a entrada não
acontece, o saldo de estoque fica sem base"*.

**Consequência.** O saldo de material é inútil como base de decisão hoje: 96%
dos materiais não têm posição nenhuma, e onde tem, boa parte está negativa. Um
número negativo é fácil de identificar; o perigoso são os itens que já foram
compensados por uma entrada parcial e agora exibem um saldo positivo **errado**,
que parece confiável.

**Correção sugerida.** Não é código — é carga inicial. O mesmo **Dia D** que
popula o endereçamento precisa estabelecer o saldo de abertura de todos os
materiais. Enquanto isso não acontece, o saldo não deve ser usado para decidir
compra (ver item 2), e vale conferir se os 11 negativos são só falta de entrada
ou se algum tem consumo lançado em duplicidade.

---

## 4. 🟠 Qualidade → Compras: RNC e desempenho não chegam à decisão

**Evidência.** `nao_conformidades` é lido apenas por `qualidade.html`. A função
`desempenhoQualidadeFornecedor` (em `shared/utils.js`) tem **uma única chamada
em todo o sistema**, em `qualidade.html:1252`. Nem `compras.html` nem
`cadastros.html` leem qualquer um dos dois.

**O que acontece na prática.** O comprador compara orçamentos por custo e não
vê que aquele fornecedor teve três lotes reprovados no trimestre. O indicador
existe, está correto e fica numa tela que ele não abre.

**Consequência.** O sistema calcula a reputação do fornecedor e não a usa na
única decisão em que ela importa.

**Correção sugerida.** Um selo na coluna do fornecedor, na comparação da
cotação: taxa de aprovação e número de RNCs abertas. Não precisa bloquear —
basta aparecer.

---

## 5. 🟠 Compras → Financeiro: o destinatário não existe

**Evidência.** `compras.html` grava `prazoPagamentoParcelas` com o comentário
*"o financeiro lê daqui pra gerar os títulos na confirmação de recebimento"*.
Varredura do repositório inteiro: **não existe nó `financeiro`, `contas_pagar`
ou equivalente, nem página, nem leitor**. As três ocorrências da palavra
"financeiro" no código são comentários.

**O que acontece na prática.** O prazo é coletado, interpretado e gravado com
cuidado — e ninguém consome. O título é lançado fora do sistema.

**Consequência.** Baixa, hoje. Mas o dado está gravado com aparência de
integrado, e alguém pode assumir que o financeiro "já recebeu".

**Correção sugerida.** Ou construir a ponte (uma tela de contas a pagar
alimentada pela confirmação de recebimento), ou **dizer no manual** que o
lançamento é externo. A segunda já foi feita nesta rodada.

---

## 6. 🟠 Qualidade → Logística: liberar não move o material

**Evidência.** `salvarLaudo('LIBERADO')` altera `status` e os campos de
`qualidade` do lote. Não há alteração de `enderecoKey` no fluxo de liberação, e
nenhuma chamada a `transferirLoteEndereco` em `qualidade.html`.

**O que acontece na prática.** O lote é liberado e continua exatamente no
endereço em que foi descarregado. Se aquilo era uma posição de passagem ou uma
área de retenção improvisada, o material fica lá — liberado no sistema, no
lugar errado no chão. Não existe passo de "endereçar definitivamente".

**Levantado pelo usuário** nesta rodada, ao notar que o recebimento já pede
endereço de destino. O bloqueio que ele temia existe (quarentena barra a
separação); o que falta é o passo seguinte.

**Correção sugerida.** Ao liberar, gerar uma tarefa de endereçamento para a
Logística — uma fila de "liberado, aguardando posição definitiva". Sem isso,
depende de alguém lembrar.

---

## 7. 🟠 Não existe área de quarentena cadastrada

**Evidência.** `config/areasEndereco` em produção tem exatamente cinco áreas:
GALPÃO (GAL), FÁBRICA (FAB), RÓTULOS (ROT), MATÉRIA PRIMA (MP) e MATERIAL DE
USO E CONSUMO (MUC). Nenhuma de retenção.

**O que acontece na prática.** O material em quarentena recebe um endereço de
estoque normal e fica fisicamente ao lado do material liberado. O status separa
no sistema; **nada separa no chão**.

**Consequência.** Alguém pega o palete errado sem nenhum sinal físico de que
não devia. E, combinado com o item 6, o material liberado também não é movido —
os dois estados convivem na mesma rua.

**Correção sugerida.** Cadastrar uma área de retenção (ex.: QUA) e usá-la como
destino padrão de recebimento. É cadastro, não código.

---

## 8. 🟡 Separação → PCP: a falta não sobe

**Evidência.** Quando `sugerirAlocacaoFefo` devolve `faltante > 0`, a tela de
separação mostra o aviso e permite confirmar o que há — comportamento correto.
Mas esse `faltante` não é gravado em lugar nenhum nem sinalizado na OP.

**O que acontece na prática.** A Logística vê que faltou, separa o que tem e o
PCP descobre quando a linha parar.

**Correção sugerida.** Gravar a falta em `ops/{lote}.separacaoConcluida` e
destacá-la no Controle de OPs. O dado já é calculado.

---

## 9. 🟡 Duas fontes de saldo, calculadas em separado

**Evidência.** `estoque/{key}.saldoAtual` (agregado) e a soma de
`estoque_lotes/{key}/*.saldoLote` (granular) são mantidos por caminhos
independentes — `putawayEstoqueLote` grava o lote sem tocar o agregado, e
"Ajustar Saldo" grava o agregado sem tocar os lotes.

**Nota.** Isso é **decisão consciente** do usuário: *"WMS é complementar ao
estoque; estoque é posição de inventário, não acho produtivo nascer vinculado
um ao outro"*. Fica registrado como limitação conhecida, não como defeito — mas
quando os dois divergirem, o inventário físico é o desempate, e isso precisa
estar claro para quem opera. Já está dito no manual de Estoque e WMS.

Vale a mesma observação para `pedidos` e `pedidos_comerciais`: dois nós
carregando dado de pedido. Confirmar a fronteira entre eles antes de mexer.

---

## O que NÃO é gargalo (elos que funcionam)

Registrado para não se gastar esforço onde não precisa:

- **Compras → Logística.** O PC chega completo: data prevista em dias úteis,
  local de entrega, itens com unidade cotada e dados de coleta FOB.
  `logistica.html` lê e escreve `pedidos_compra` no mesmo nó. Sólido.
- **Logística → Qualidade.** O recebimento cria o lote em `QUARENTENA` e ele
  aparece sozinho na fila de inspeção. Ninguém precisa avisar ninguém.
- **Qualidade → Separação.** `sugerirAlocacaoFefo` filtra `status ===
  'LIBERADO'`. Lote em quarentena, reprovado ou vencido nunca é sugerido. O
  bloqueio é real e automático.
- **PCP → Separação.** A OP emitida entra sozinha na fila de pendentes.
- **Emissão → Estoque (empenho).** `empenharMateriais` reserva na emissão e
  `liberarEmpenhoLote` devolve na conclusão e no cancelamento — inclusive no
  fluxo normal, que era um defeito já corrigido.
- **Alertas de OP.** `alertas_pendentes` tem consumidor real: a função agendada
  `checkNotificacoes` em `functions/index.js`.

---

## Contexto que muda a prioridade

Três dos nove achados (3, 6, 7) só se manifestam quando o WMS estiver em uso —
e **`estoque_lotes` tem zero registros em produção**. O módulo está publicado e
vazio, esperando o "Dia D" de inventário e endereçamento.

Os achados 1, 2 e 4 valem **hoje**, independentemente do Dia D: são telas em
uso diário deixando de trocar informação que já existe no banco.

Sugestão de ordem, por relação valor/esforço:

1. **Selo de qualidade do fornecedor na cotação** (item 4) — a função de
   cálculo já existe e é pura; falta só exibir. Vale hoje, sem depender de
   nada.
2. **Botão "gerar solicitação" na Matriz de Insumos** (item 1) — escreve num nó
   que já existe, no formato que Compras já entende. Fecha o elo mais caro.
3. **Área de quarentena** (item 7) — cadastro, não código. Feito antes do
   Dia D, ele já nasce endereçando certo.
4. **Saldo visível em Compras** (item 2) — leitura de nó existente, mas só faz
   sentido **depois** do Dia D: mostrar um saldo errado ao lado do item é pior
   que não mostrar nada, porque dá aparência de confiável.
5. Os demais (3, 6, 8), depois que o WMS estiver rodando com dado real.

## Manuais

Nesta mesma rodada foram escritos **nove manuais operacionais**, um por
operação (`manuais.html` é o índice). Cada um termina com o bloco
**"De quem vem, pra quem vai"**, que nomeia o setor anterior e o seguinte e
marca com <span>manual</span> exatamente as passagens listadas acima — para que
ninguém suponha que o sistema fez o que ninguém fez. Quando um elo destes for
fechado no código, o manual correspondente precisa perder a marca.
