---
name: example-skill
description: Exemplo de skill — instruções de uso e quando invocar.
license: MIT
---

Use esta skill quando precisar de um guia passo-a-passo para executar uma ação repetível ou para
fornecer ferramentas/recursos que o agente pode usar.

Exemplo de uso (instruções):

1. Identifique o contexto da tarefa (por exemplo: "debugar workflow do GitHub Actions").
2. Se houver logs disponíveis, use as ferramentas de listagem para localizar as execuções
   relevantes.
3. Resuma os erros mais comuns usando o `summarize_job_log_failures` para não encher o contexto.
4. Se necessário, recupere logs completos com `get_job_logs`.
5. Proponha correções passo-a-passo e valide localmente quando possível.

Exemplos (opcionais):

```
Pergunta: "Por que meu workflow CI está falhando no job build?"

Resposta esperada: 1) run `list_workflow_runs`, 2) pegar logs do run com `get_workflow_run_logs`, 3) resumir falhas, 4) propor alterações.
```

Notas de formatação:

- O arquivo `SKILL.md` deve ter frontmatter YAML no topo entre `---`.
- Campos recomendados no frontmatter:
  - `name` (required): identificador único, minúsculas e com hífens.
  - `description` (required): breve descrição e quando usar a skill.
  - `license` (optional): licença aplicada ao conteúdo da skill.
- O corpo do markdown traz as instruções, exemplos e quaisquer scripts auxiliares.

Se precisar incluir scripts ou arquivos auxiliares, coloque-os na mesma pasta da skill.
