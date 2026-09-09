# Coordenação entre agentes

Este repositório é mantido por mais de um agente. Leia `CLAUDE.md` e
`AGENT_STATUS.md` antes de investigar ou editar qualquer assunto.

## Protocolo obrigatório

1. Antes de começar, confira `git status --short`, o último commit e a seção
   **Em andamento** de `AGENT_STATUS.md`.
2. Registre sua tarefa, escopo e arquivos que pretende alterar no seu próprio
   bloco em `AGENT_STATUS.md`. Não edite o bloco de outro agente.
3. Não trabalhe no mesmo arquivo que outro agente marcou como ativo. Se isso
   for inevitável, pare e alinhe primeiro pelo `AGENT_STATUS.md`.
4. Faça commits pequenos e temáticos. Nunca use `git add -A` ou inclua
   alterações de outro agente no seu commit.
5. Antes de publicar, confirme que não há alteração não relacionada no
   diretório e registre no status qual commit foi publicado.
6. Ao terminar, atualize o seu bloco com o que mudou, validação feita, commit
   (se houver) e qualquer pendência.

Para trabalho realmente simultâneo, cada agente deve usar sua própria branch
e worktree; a integração ocorre por commits, nunca copiando arquivos entre
pastas manualmente.
