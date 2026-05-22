# Copilot MCP Context Pack

**Atualizado em:** 2026-05-22

## Estado atual

O modulo `src/copilot/mcp` contem a primeira fundacao do servidor MCP para conectar o ChatGPT ao workspace via
Streamable HTTP em `/mcp` ou via `stdio` local.

## Comandos

```bash
npm run copilot:mcp:http
npm run copilot:mcp:stdio
npm run typecheck:strict:src.copilot
npm run lint:copilot
npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js
```

## Tools iniciais

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

## Validacao conhecida

- Typecheck strict de `src/copilot`: passou.
- Lint completo de `src/copilot` e `tests/unit/copilot`: passou.
- Testes MCP focados: passaram.
- Suite unit completa possui falhas preexistentes fora do modulo MCP, registradas no plano canonico.
- Faixa I repo-side: typecheck strict passou, lint completo passou, testes MCP focados passaram, smoke HTTP passou.
- Faixa G.1 MCP: typecheck strict passou, lint completo passou, lint MCP passou, testes MCP focados passaram com 6 arquivos e 20 testes.
- Suite unit completa apos G.1: 3019 testes totais, 3013 passaram, 6 falhas preexistentes fora do MCP permanecem.
- Faixa H.1 MCP: typecheck strict passou, lint completo passou, lint MCP passou, testes MCP focados passaram com 6 arquivos e 21 testes.
- Faixa H.2 MCP: typecheck strict passou, lint completo passou, lint MCP passou, testes MCP focados passaram com 6 arquivos e 22 testes.
- Faixa J.1 MCP: typecheck strict passou, lint completo passou, lint MCP/config passou, testes MCP focados passaram com 7 arquivos e 24 testes.
- Faixa J.2 MCP: typecheck strict passou, lint completo passou, lint MCP passou, testes MCP focados passaram com 8 arquivos e 27 testes.

## Proximo passo

Faixa J foi preparada no lado MCP/local. Continuar para Faixa K: hardening e release operacional.

## Jobs MCP

`run_copilot_validator` executa apenas validadores allowlistados:

- `typecheck`
- `lint`
- `unit-mcp`
- `unit-copilot`

Aliases canonicos:

- `run_typecheck_copilot`
- `run_lint_copilot`
- `run_unit_copilot`
- `run_project_doctor`

Jobs aceitam `timeoutMs` por chamada. O job record retorna `command`, `args`, `timeoutMs`, `signal` e `timedOut`.

## LLM-B opt-in MCP

`copilot-local` esta registrado em `buildMcpConfig` como servidor stdio opcional:

```bash
COPILOT_MCP_SERVERS=copilot-local npm run terminal:llm-b
```

Sem essa env, LLM-B continua independente do MCP server.

Tools de leitura segura de sessoes:

- `copilot_sessions_list`
- `copilot_session_get`

Essas tools consultam o registry ativo sem criar, retomar ou acionar sessoes LLM-B.

Os logs de job ficam em `src/copilot/.ai/jobs/*.log` e sao ignorados pelo Git.

## ChatGPT connector

Documento operacional:

```text
src/copilot/docs/CHATGPT_MCP_CONNECT_CHATGPT_RUNBOOK.md
```

Endpoint auxiliar local:

```text
GET http://127.0.0.1:3333/chatgpt-connector.json
```

Tools auxiliares:

- `chatgpt_connector_profile`
- `chatgpt_connector_url_check`

## Escrita MCP

Tools controladas:

- `repo_write_file`
- `repo_create_file`
- `repo_apply_patch`
- `repo_move_file`
- `repo_remove_file`

Guardrails:

- path policy do workspace em toda operacao;
- `dryRun` nas operacoes mutaveis principais;
- diff preview em write/create/patch;
- `confirm=true` para remocao;
- `confirmOverwrite=true` para move com overwrite;
- auditoria MCP sem gravar conteudo editado.
