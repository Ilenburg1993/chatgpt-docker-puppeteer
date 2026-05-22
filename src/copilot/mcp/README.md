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
- `copilot_sessions_list`
- `copilot_session_get`
- `repo_write_file`
- `repo_create_file`
- `repo_apply_patch`
- `repo_move_file`
- `repo_remove_file`

Validator job tools accept optional `timeoutMs` between 1000 and 3600000. Job records include the command, args, timeout,
exit code, signal and `timedOut` flag.

## Copilot SDK / LLM-B

The LLM-B chat can opt into this MCP server without depending on it:

```bash
COPILOT_MCP_SERVERS=copilot-local npm run terminal:llm-b
```

The `copilot-local` server is registered as a stdio MCP config that launches:

```bash
node src/copilot/mcp/index.js --transport stdio
```

By default `COPILOT_MCP_SERVERS` remains empty, so LLM-B boots normally when the MCP server is offline.
The MCP server can also inspect active SDK sessions through read-only metadata tools; these tools do not start LLM-B and
do not expose live session objects.

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
