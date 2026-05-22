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

## Validacao conhecida

- Typecheck strict de `src/copilot`: passou.
- Lint completo de `src/copilot` e `tests/unit/copilot`: passou.
- Testes MCP focados: passaram.
- Suite unit completa possui falhas preexistentes fora do modulo MCP, registradas no plano canonico.

## Proximo passo

Continuar a Faixa F: melhorar auditoria persistente, criar modelo de jobs e preparar futuras tools de execucao
controlada.

