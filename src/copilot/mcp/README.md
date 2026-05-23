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

O ChatGPT deve receber uma URL HTTPS que aponte para `/mcp`. O modo principal deste projeto agora e
Cloudflare Tunnel permanente no dominio `aurelin.org`:

```text
https://workspace-mcp-dev.aurelin.org/mcp
```

Cloudflare Tunnel permanente:

```bash
npm run copilot:mcp:http
npm run copilot:mcp:smoke:local
npm run copilot:mcp:cloudflare:doctor
CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token npm run copilot:mcp:cloudflare:run
```

Em outro terminal:

```bash
npm run copilot:mcp:cloudflare:status
npm run copilot:mcp:cloudflare:smoke
```

`status` mostra a URL permanente `https://workspace-mcp-dev.aurelin.org/mcp` para colar no ChatGPT.
Quick Tunnel continua disponivel como fallback explicito:

```bash
COPILOT_MCP_CLOUDFLARE_MODE=temporary-quick npm run copilot:mcp:cloudflare:quick
```

## Primeira superfície

Esta primeira faixa expõe somente leitura, Git read-only e diagnóstico:

- `repo_status`
- `repo_tree`
- `repo_root_tree`
- `repo_read_file`
- `repo_read_file_chunks`
- `repo_file_stats`
- `repo_diff_files`
- `repo_search_text`
- `repo_find_symbol_usages`
- `repo_symbol_search`
- `repo_file_outline`
- `repo_index_status`
- `repo_index_build`
- `repo_index_search`
- `repo_index_find_symbol`
- `repo_find_imports`
- `repo_index_invalidate`
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
- `job_list`
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
- `mcp_capabilities_summary`
- `mcp_smoke_workspace`
- `mcp_tunnel_status`
- `mcp_runtime_health`

Validator job tools accept optional `timeoutMs` between 1000 and 3600000. Job records include the
command, args, timeout, exit code, signal and `timedOut` flag.

## Copilot SDK / LLM-B

The LLM-B chat can opt into this MCP server without depending on it:

```bash
COPILOT_MCP_SERVERS=copilot-local npm run terminal:llm-b
```

The `copilot-local` server is registered as a stdio MCP config that launches:

```bash
node src/copilot/mcp/index.js --transport stdio
```

By default `COPILOT_MCP_SERVERS` remains empty, so LLM-B boots normally when the MCP server is
offline. The MCP server can also inspect active SDK sessions through read-only metadata tools; these
tools do not start LLM-B and do not expose live session objects.

As ferramentas usam a política de path existente e permanecem sob a raiz do workspace. As tools de
escrita controlada retornam diff unificado, suportam `dryRun` quando aplicável e gravam metadados de
auditoria MCP sem persistir o texto editado no log. Operações destrutivas exigem confirmação
explícita nos argumentos.

As tools MCP de leitura espelham o plano de IO usado pelas tools locais da LLM-B:

- `repo_tree` aceita `path=""` como default `src/copilot`; use `path="."` ou `repo_root_tree` para a
  raiz real.
- `repo_tree` e `repo_root_tree` redigem caminhos protegidos na listagem e retornam
  `blockedEntriesCount`.
- `repo_search_text` aceita `contextLines` de 0 a 10, `cursor` retornado por `nextCursor` e separa
  `returnedMatchCount`, `returnedLineCount`, `totalMatchCount` e `totalLineCount`.
- `repo_read_file` retorna `sha256` e `returnedSha256` para permitir read -> apply/write com
  `expectedHash`.
- `repo_read_file_chunks` pagina arquivos grandes por linhas e separa `returnedLineCount`,
  `lastScannedLine`, `fileTotalLines` e `fileTotalLinesKnown`.
- `repo_file_stats` usa o stat canonico de IO e pode calcular `sha256` sob limite de bytes.
- `repo_diff_files` usa o diff canonico de IO para comparar dois arquivos do workspace.
- `repo_find_symbol_usages` espelha `find_symbol_usages` para analise de impacto textual com busca
  whole-word por padrao.
- `repo_symbol_search` espelha `workspace_symbol_search` para navegacao por declaracoes.
- `repo_file_outline` espelha `workspace_parse_file` para symbols/imports/exports/outline sem expor
  runtime da LLM-B.
- `repo_index_status`, `repo_index_build`, `repo_index_search`, `repo_index_find_symbol`,
  `repo_find_imports` e `repo_index_invalidate` espelham a familia
  `workspace_index_*`/`workspace_find_imports` usando a mesma engine FTS5/simbolica compartilhada.

Erros recuperaveis usam contratos estaveis em `structuredContent`:

- `code`: identificador estavel, por exemplo `ERR_EMPTY_PATH`, `ERR_PATH_DENIED`,
  `ERR_INVALID_CURSOR`.
- `error`: mensagem humana.
- `hint`: orientacao curta de recovery quando disponivel.
- `details`: metadados especificos da tool, preservando compatibilidade com chamadas existentes.

A LLM-B continua independente do MCP server. Ela pode consumir MCP por opt-in, mas o chat local nao
passa a depender do servidor MCP para boot ou uso normal.

## Perfil do conector ChatGPT

Com o servidor HTTP local em execução:

```bash
curl http://127.0.0.1:3333/chatgpt-connector.json
```

O endpoint retorna nome, descrição, URL pública esperada, checklist de túnel e prompts de smoke test
para preencher o formulário em ChatGPT > Settings > Connectors > Create.
