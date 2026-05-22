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
- `job_get_output`
- `job_cancel`

## Validacao conhecida

- Typecheck strict de `src/copilot`: passou.
- Lint completo de `src/copilot` e `tests/unit/copilot`: passou.
- Testes MCP focados: passaram.
- Suite unit completa possui falhas preexistentes fora do modulo MCP, registradas no plano canonico.
- Faixa I repo-side: typecheck strict passou, lint completo passou, testes MCP focados passaram, smoke HTTP passou.

## Proximo passo

Faixa I repo-side foi preparada. Continuar para Faixa G: escrita controlada, começando por `repo_apply_patch`,
mantendo diff, path policy e auditoria.

## Jobs MCP

`run_copilot_validator` executa apenas validadores allowlistados:

- `typecheck`
- `lint`
- `unit-mcp`
- `unit-copilot`

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
