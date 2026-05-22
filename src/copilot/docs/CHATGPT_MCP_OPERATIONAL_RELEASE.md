# ChatGPT MCP Operational Release

Documento operacional para liberar e manter o servidor MCP do `src/copilot` como conector do ChatGPT e como servidor
opcional para o LLM-B/Copilot SDK.

## 1. Escopo

Este release cobre apenas:

1. `src/copilot/mcp`.
2. Configuracao MCP opcional em `src/copilot/config/mcp-servers.js`.
3. Documentos em `src/copilot/docs`.
4. Testes focados em `tests/unit/copilot/mcp`.

O restante do repositorio permanece fora do escopo normal deste ciclo.

## 2. Entrypoints

HTTP local:

```bash
npm run copilot:mcp:http
```

Endpoint MCP:

```text
http://127.0.0.1:3333/mcp
```

Health:

```text
http://127.0.0.1:3333/health
```

Perfil do formulario ChatGPT:

```text
http://127.0.0.1:3333/chatgpt-connector.json
```

Exposicao HTTPS operacional via Cloudflare Tunnel:

```bash
npm run copilot:mcp:cloudflare:doctor
export CLOUDFLARE_TUNNEL_TOKEN="<token-do-tunnel>"
export COPILOT_MCP_CLOUDFLARE_PUBLIC_URL="https://<hostname-cloudflare>/mcp"
npm run copilot:mcp:cloudflare:run
```

Quick smoke temporario:

```bash
npm run copilot:mcp:cloudflare:quick
```

Stdio local:

```bash
npm run copilot:mcp:stdio
```

Opt-in LLM-B:

```bash
COPILOT_MCP_SERVERS=copilot-local npm run terminal:llm-b
```

## 3. ChatGPT Connector

Campos recomendados:

1. Nome: `Repo DevContainer MCP`
2. Descricao: conector para o repo aberto no Dev Container, com leitura, Git, diagnosticos e operacoes controladas.
3. URL: `https://<hostname-cloudflare-ou-endpoint-do-tunel>/mcp`
4. Autenticacao: conforme tunnel/OAuth disponivel.

Nunca usar `localhost`, `127.0.0.1` ou URL HTTP no formulario do ChatGPT. O ChatGPT precisa de endpoint HTTPS publico
por Cloudflare Tunnel ou mediado pelo Secure MCP Tunnel.

## 4. Smoke Tests

Depois de conectar no ChatGPT:

1. Liste as tools disponiveis.
2. Chame `repo_status`.
3. Chame `repo_tree` em `src/copilot`.
4. Chame `repo_read_file` em `src/copilot/mcp/README.md`.
5. Chame `git_status`.
6. Chame `mcp_runtime_health`.
7. Faca um `repo_apply_patch` com `dryRun=true` antes de qualquer escrita real.

## 5. Superficie De Tools

Leitura e Git:

1. `repo_status`
2. `repo_tree`
3. `repo_read_file`
4. `repo_search_text`
5. `git_status`
6. `git_diff`
7. `git_log`
8. `git_branch_info`
9. `project_doctor`

Conexao ChatGPT:

1. `chatgpt_connector_profile`
2. `chatgpt_connector_url_check`

Jobs e validadores:

1. `run_copilot_validator`
2. `run_typecheck_copilot`
3. `run_lint_copilot`
4. `run_unit_copilot`
5. `run_project_doctor`
6. `job_get_output`
7. `job_cancel`

Escrita controlada:

1. `repo_write_file`
2. `repo_create_file`
3. `repo_apply_patch`
4. `repo_move_file`
5. `repo_remove_file`

LLM-B/Copilot SDK:

1. `copilot_sessions_list`
2. `copilot_session_get`

Runtime MCP:

1. `mcp_runtime_health`

## 6. Guardrails

1. Toda operacao de path passa por policy de workspace.
2. Arquivos sensiveis cobertos pela policy de path nao devem ser lidos/escritos.
3. `repo_create_file` falha se destino ja existir.
4. `repo_write_file` exige arquivo existente.
5. `repo_apply_patch` usa substituicao exata.
6. `repo_apply_patch` suporta `expectedHash`.
7. `repo_move_file` nao sobrescreve por padrao.
8. `repo_move_file` exige `confirmOverwrite=true` quando `overwrite=true`.
9. `repo_remove_file` exige `confirm=true`.
10. `repo_remove_file` nao retorna snapshot base64 do conteudo removido.
11. Jobs aceitam `timeoutMs`.
12. Jobs podem ser cancelados com `job_cancel`.
13. Auditoria MCP registra inicio, conclusao e falha de tool call.
14. Eventos especificos de escrita registram hashes/metadados, nao conteudo editado.

## 7. Validacao Canonica

Typecheck:

```bash
npm run typecheck:strict:src.copilot
```

Lint:

```bash
npm run lint:copilot
```

Testes focados MCP:

```bash
npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js
```

Suite unit completa:

```bash
npm run test:copilot:unit
```

Estado conhecido neste release:

1. Typecheck strict passa.
2. Lint completo passa.
3. Testes MCP focados passam.
4. Suite unit completa ainda possui 6 falhas preexistentes fora do MCP.

## 8. Observabilidade

Audit log:

```text
src/copilot/.ai/audit/mcp-tool-calls.jsonl
```

Job logs:

```text
src/copilot/.ai/jobs/*.log
```

Health:

```bash
curl http://127.0.0.1:3333/health
```

Runtime health via MCP:

```text
mcp_runtime_health
```

Metricas em memoria:

1. chamadas totais;
2. erros totais;
3. calls por tool;
4. errors por tool;
5. duracao total por tool;
6. duracao media por tool;
7. ultima chamada;
8. ultimo resultado de erro.

## 9. Troubleshooting

ChatGPT nao conecta:

1. Verifique se a URL e HTTPS.
2. Verifique se a URL termina em `/mcp`.
3. Verifique `npm run copilot:mcp:cloudflare:doctor` quando usar Cloudflare.
4. Verifique se `cloudflared` ou `tunnel-client` esta rodando.
5. Verifique se `GET /health` local responde.
6. Verifique se o endpoint publico encaminha para `http://127.0.0.1:3333/mcp`.

Tools nao aparecem:

1. Reinicie o MCP server local.
2. Reinicie `cloudflared` ou o tunnel-client.
3. Recarregue ou recrie o conector no ChatGPT.
4. Valide `tools/list` local.
5. Chame `chatgpt_connector_profile`.

Escrita falha:

1. Leia o arquivo antes.
2. Prefira `repo_apply_patch`.
3. Use `dryRun=true`.
4. Use `expectedHash` quando houver risco de corrida.
5. Confirme que o path esta dentro do workspace.
6. Para remove, envie `confirm=true`.
7. Para move com overwrite, envie `confirmOverwrite=true`.

Jobs nao terminam:

1. Use `job_get_output`.
2. Aumente `tailBytes`.
3. Use `job_cancel`.
4. Reexecute com `timeoutMs` maior.

## 10. Release Gate

Antes de considerar este release operacional:

1. `main` esta sincronizada com `origin/main`.
2. `npm run typecheck:strict:src.copilot` passou.
3. `npm run lint:copilot` passou.
4. Testes MCP focados passaram.
5. `GET /health` respondeu localmente.
6. `GET /chatgpt-connector.json` respondeu localmente.
7. `tools/list` incluiu `mcp_runtime_health`.
8. ChatGPT recebeu endpoint HTTPS real.
9. Smoke tests read-only passaram no ChatGPT.
10. Primeira escrita real foi precedida por `dryRun=true`.

## 11. Smoke Local Executado

Executado em 2026-05-22:

1. `npm run copilot:mcp:http` subiu em `http://127.0.0.1:3333/mcp`.
2. `GET /health` respondeu:
   - `ok=true`;
   - `name=copilot-mcp`;
   - `mcpPath=/mcp`.
3. `GET /chatgpt-connector.json?publicMcpUrl=https://example.openai-tunnel.test` respondeu:
   - `name=Repo DevContainer MCP`;
   - `connectorUrl=https://example.openai-tunnel.test/mcp`;
   - `authMode=none-dev` no default local sem OAuth.
4. `tools/list` respondeu com 26 tools.
5. `tools/list` incluiu:
   - `repo_status`;
   - `repo_apply_patch`;
   - `mcp_runtime_health`;
   - `copilot_sessions_list`.
6. `tools/call mcp_runtime_health` respondeu `success=true`.
7. `tools/call repo_status` respondeu `success=true` e `branch=main`.
8. `GET /health` apos chamadas reportou metricas com chamadas registradas.

Observacao para chamadas HTTP manuais: enviar header `Accept: application/json, text/event-stream`, pois o transporte
Streamable HTTP do MCP exige aceitar JSON e SSE.
