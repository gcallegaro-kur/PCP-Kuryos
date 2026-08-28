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

## Estoque / Produção

- **Sem estoque de produto acabado** (finished-goods) — o estoque que
  existe hoje (Fase 4) só cobre matéria-prima/embalagem consumida em
  produção. Logística ainda controla produto acabado numa planilha
  separada.
- **Devolução ao fornecedor como movimento de estoque** — identificado
  durante o design do estoque físico (Fase 4), nunca implementado. Hoje só
  existe entrada (recebimento), consumo (apontamento), perda e ajuste
  manual.
- **Perda por etapa (Rotulagem vs Envase) E por SKU** ⚠ verificar se ainda
  procede — adiado explicitamente: "temos skus com insumos de menor
  qualidade, o que ocasionam mais perdas, queria tentar capturar e
  mensurar essas variações". É analytics pra depois do cutover das
  planilhas legadas, não construir preventivamente.
- **Agendamento em `planejamento.html` parcialmente desconectado do fluxo
  de congelamento de `horizonte.html`/`alocacoes_planejamento`** ⚠
  verificar se ainda procede — achado de 30+ dias atrás; pode já ter sido
  resolvido por trabalho posterior nesta sessão (Resumo Semanal por Linha,
  etc.) — conferir antes de priorizar.

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
