# Status compartilhado dos agentes

Este é o ponto de passagem de contexto entre Codex e Claude. Atualize somente
o bloco do agente que você está operando e mantenha o histórico curto.

## Em andamento

### Codex

- **Escopo:** WMS e Logística.
- **Arquivos ativos:** `public/estoque.html`, `public/logistica.html`.
- **Estado:** filtro de área aplicado à Lista, Mapa por Rua e Planta Baixa;
  indicadores passam a refletir o recorte. Logística diferencia coleta da
  Kuryos de entrega pelo remetente para agendamento.
- **Validação:** sintaxe JavaScript de `public/estoque.html` validada com Node.
- **Commit/deploy:** pendente. Não incluir alterações de outro agente.

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
