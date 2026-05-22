# Copilot MCP Server

Servidor MCP canônico para conectar ChatGPT ao workspace real do projeto.

## Transportes

HTTP local:

```bash
node src/copilot/mcp/index.js --transport http
```

Endpoint local:

```text
http://127.0.0.1:3333/mcp
```

Stdio local:

```bash
node src/copilot/mcp/index.js --transport stdio
```

## ChatGPT

O ChatGPT deve receber uma URL HTTPS que aponte para `/mcp`, por exemplo via Secure MCP Tunnel:

```text
https://<endpoint>/mcp
```

## Primeira superfície

Esta primeira faixa expõe somente leitura, Git read-only e diagnóstico:

- `repo_status`
- `repo_tree`
- `repo_read_file`
- `repo_search_text`
- `git_status`
- `git_diff`
- `git_log`
- `git_branch_info`
- `project_doctor`
- `run_copilot_validator`
- `run_typecheck_copilot`
- `run_lint_copilot`
- `run_unit_copilot`
- `run_project_doctor`
- `job_get_output`
- `job_cancel`
- `chatgpt_connector_profile`
- `chatgpt_connector_url_check`
- `repo_write_file`
- `repo_create_file`
- `repo_apply_patch`
- `repo_move_file`
- `repo_remove_file`

As ferramentas usam a política de path existente e permanecem sob a raiz do workspace. As tools de escrita controlada
retornam diff unificado, suportam `dryRun` quando aplicável e gravam metadados de auditoria MCP sem persistir o texto
editado no log. Operações destrutivas exigem confirmação explícita nos argumentos.

## Perfil do conector ChatGPT

Com o servidor HTTP local em execução:

```bash
curl http://127.0.0.1:3333/chatgpt-connector.json
```

O endpoint retorna nome, descrição, URL pública esperada, checklist de túnel e prompts de smoke test para preencher o
formulário em ChatGPT > Settings > Connectors > Create.
