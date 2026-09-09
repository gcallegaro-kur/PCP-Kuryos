# Status compartilhado dos agentes

Este é o ponto de passagem de contexto entre Codex e Claude. Atualize somente
o bloco do agente que você está operando e mantenha o histórico curto.

## Em andamento

### Codex

- **Escopo:** Comercial — permitir orçamento para cliente cadastrado com produto ainda não cadastrado.
- **Arquivos ativos:** `public/comercial.html`.
- **Última entrega Acessos:** Comercial é módulo próprio em Usuários; permite Pedidos e Orçamentos sem liberar Pedidos/MRP. PCP mantém Comercial no padrão do perfil.
- **Commit/deploy Acessos:** `245dd95`, publicado em 2026-09-09 em `https://prod-kuryos.web.app` (Hosting e regras RTDB).
- **Última entrega Comercial:** tela Pedidos e Orçamentos. Pedido usa cliente/produtos cadastrados e cria automaticamente os itens do backlog do PCP; Orçamento aceita prospectos/itens livres e só entra no PCP ao ser convertido e confirmado.
- **Commit/deploy Comercial:** `62db872`, publicado em 2026-09-09 em `https://prod-kuryos.web.app` (Hosting e regras RTDB).
- **Última entrega Logística:** previsão do Pedido de Compra visível no card e usada como data inicial editável do agendamento; CIF indica recebimento e FOB indica disponibilidade para coleta. A previsão de origem fica registrada no agendamento.
- **Commit/deploy Logística:** `c3ba30f`, publicado em 2026-09-09 em `https://prod-kuryos.web.app`.
- **Estado Apontamento:** checkpoint recebe total acumulado do operador, mas
  registro salva o incremento confirmado na transação; fechamento começa no
  fim do último checkpoint, preservando os períodos úteis.
- **Commit/deploy Apontamento:** `82aba17`, publicado em 2026-09-09 em
  `https://prod-kuryos.web.app`.
- **Commit/deploy Histórico:** `35afccb`, publicado em 2026-09-09 em
  `https://prod-kuryos.web.app`.
- **Estado:** Cotação agora mantém homologados apenas do material original.
  Materiais de embalagem de volume próximo são sugestões explícitas e exigem
  ficha técnica quando incluídos, sem trocar BOM ou homologação.
- **Commit/deploy Cotação:** `94c1ff9`, publicado em 2026-09-09 em
  `https://prod-kuryos.web.app`.
- **Estado:** filtro de área aplicado à Lista, Mapa por Rua e Planta Baixa;
  indicadores passam a refletir o recorte. Logística diferencia coleta da
  Kuryos de entrega pelo remetente para agendamento.
- **Validação:** sintaxe JavaScript de `public/estoque.html` validada com Node.
- **Commit/deploy:** `855de2f` (saldo na OP), `250f5ef` (Logística) e
  `88ad322` (WMS) commitados e publicados em 2026-09-09.
- **Última entrega:** saldo de estoque por material na criação de OP,
  exclusivamente como referência visual; destaca saldo menor que o consumo.
- **Validação adicional:** sintaxe JavaScript de `public/emitir_op.html`
  validada com Node.
- **Última entrega Logística:** dados de coleta/viagem (modalidade, prestador
  cadastrado, valor negociado, referência e status), em `250f5ef`.
- **Última entrega Cotação:** fluxo guiado para preencher uma proposta por
  fornecedor e comparar por material, em `365c759`; publicado em 2026-09-09.
- **Última entrega Cotação:** decisão por material e geração automática de
  um PC por fornecedor, em `913effc`; publicado em 2026-09-09.

### Claude

- **Última entrega:** Cotação — somente fornecedores homologados, inclusão de
  fornecedor cadastrado ou por CNPJ, por item.
- **Commit:** `586bbc5`.
- **Arquivos ativos:** nenhum. Compras/Cotação (`public/compras.html`,
  `public/shared/utils.js`) liberados.
- **Estado atual:** sem tarefa em andamento.

- **⚠ Aviso ao Codex — duas interferências minhas, antes deste protocolo
  existir. As duas são minhas, não suas:**
  1. **Seu WMS/Logística JÁ ESTÁ EM PRODUÇÃO.** Rodei
     `firebase deploy --only hosting` com `public/estoque.html` e
     `public/logistica.html` modificados na árvore de trabalho — o deploy
     publica o diretório inteiro, não o commit. Conferido no ar: o filtro de
     área responde em `estoque.html` e o `agFreteInfo` em `logistica.html`.
     Seu bloco diz "commit/deploy pendente", e isso vale pro **commit**, mas
     não pra produção. Os dois arquivos seguem sem commit e **não os toquei**.
  2. **`pcdNatureza` (Pedido de Compra Direto) entrou no meu commit
     `586bbc5`.** Estava sem commit em `public/compras.html`, que é o arquivo
     do meu escopo, e usei `git add -A` — não consegui separar. Confirmado com
     `git log -S`: a primeira aparição no repo é o meu commit. O código está
     íntegro (select + handlers + gravação, sintaxe validada), mas o crédito e
     a mensagem de commit ficaram errados.
  - Efeito colateral verificado: `run_pc_direto_test.js` falha porque o
    fixture não preenche `pcdNatureza` — o `salvarPcDireto` sai pelo
    `return` da validação e nada é gravado. É teste desatualizado, **não**
    defeito. Deixei pra você por ser sua mudança; não quis adivinhar a
    intenção do campo.

- **Correções no meu processo, a partir de agora:** `git status --short` antes
  de qualquer deploy; nunca `git add -A`; declarar arquivos aqui antes de
  editar.

## Regras de passagem

- Antes de iniciar: leia este arquivo, `CLAUDE.md` e rode `git status --short`.
- Para tarefas paralelas, declare os arquivos antes de editar. Se houver
  sobreposição, trabalhem em branches/worktrees separados.
- Todo commit deve conter apenas um escopo. Use `git diff --check` e uma
  validação proporcional antes de criá-lo.
- Quem fizer deploy confere o `git status` final e registra aqui o hash e o
  horário da publicação.

## Histórico recente

- 2026-09-09 — `586bbc5`: Cotação com fornecedores homologados e inclusão por
  seleção/CNPJ. **Publicado.** Carregou junto, sem intenção, o `pcdNatureza`
  do Codex (ver aviso no bloco do Claude).
- 2026-09-09 — Codex: filtro de área do WMS + agendamento com distinção de
  frete. **Sem commit, mas JÁ PUBLICADO** por um deploy do Claude (o deploy
  publica o diretório de trabalho, não o commit).

## Cuidado que custou caro

`firebase deploy --only hosting` publica **o diretório `public/` como ele está
no disco** — não o último commit, não o índice do git. Com dois agentes no
mesmo repositório, isso significa que **um deploy publica o trabalho não
commitado do outro**. Conferir `git status --short` antes de publicar não é
zelo: é a única coisa que separa "publiquei o meu" de "publiquei o nosso".
