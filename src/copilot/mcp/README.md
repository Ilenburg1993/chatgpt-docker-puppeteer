# Copilot MCP Server

Servidor MCP canônico para conectar ChatGPT ao workspace real do projeto.

## Transportes

HTTP local:

```bash
node src/copilot/mcp/cli.js --transport http
```

Endpoint local:

```text
http://127.0.0.1:3333/mcp
```

Stdio local:

```bash
node src/copilot/mcp/cli.js --transport stdio
```

## ChatGPT

O ChatGPT deve receber uma URL HTTPS que aponte para `/mcp`. O modo principal deste projeto agora e
Cloudflare Tunnel permanente no dominio `aurelin.org`:

```text
https://mcp.aurelin.org/mcp
```

Cloudflare Tunnel permanente:

```bash
npm run copilot:mcp:cloudflare:doctor
COPILOT_MCP_AUTH_MODE=oauth COPILOT_MCP_AUTH_ENFORCEMENT=all \
  CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token \
  npm run copilot:mcp:cloudflare:up
```

Em outro terminal:

```bash
npm run copilot:mcp:cloudflare:status
npm run copilot:mcp:cloudflare:remote-audit
npm run copilot:mcp:cloudflare:edge-audit
npm run copilot:mcp:cloudflare:edge-backup-create
npm run copilot:mcp:cloudflare:edge-backup-list
npm run copilot:mcp:cloudflare:edge-policy-apply
npm run copilot:mcp:cloudflare:edge-policy-diff
npm run copilot:mcp:cloudflare:edge-policy-plan
npm run copilot:mcp:cloudflare:edge-snapshot
npm run copilot:mcp:cloudflare:smoke
npm run copilot:mcp:oauth:smoke
```

`status` mostra a URL permanente `https://mcp.aurelin.org/mcp` para colar no ChatGPT.
O modo canônico de autenticação é `OAuth`; `none-dev` fica apenas como fallback controlado.
O issuer OAuth dev embutido persiste sua chave RS256 em
`src/copilot/.ai/mcp/oauth-dev-private-key.pem` para evitar relinking desnecessário após restart.
Os refresh tokens rotativos tambem persistem, mas somente como hashes SHA-256, em
`src/copilot/.ai/mcp/oauth-refresh-tokens.json`; isso preserva o linking do ChatGPT durante restarts
sem gravar refresh token em claro.
Clientes DCR publicos ficam em `src/copilot/.ai/mcp/oauth-clients.json`, tambem ignorado por git, para que
um `client_id` emitido antes do restart continue valido quando o ChatGPT repetir o fluxo OAuth.
Replay de DPoP e `private_key_jwt` também sobrevive a restart no `copilot.sqlite`: somente SHA-256 da
chave de replay é persistido, separado por namespace e com expiração/limite por namespace.
Use `COPILOT_MCP_DEV_OAUTH_ROTATE_KEY=true` apenas quando quiser forçar rotação da chave.
Use `npm run copilot:mcp:cloudflare:remote-audit` para comparar a config remota Cloudflare contra o estado
canonico local sem imprimir tokens. O serviço de origem remoto deve permanecer `http://127.0.0.1:3333`.
Use `npm run copilot:mcp:cloudflare:edge-audit` para auditar, quando o token permitir, rulesets da zona
que possam interferir em MCP/OAuth: cache, WAF, rate limit e transform rules. Se o token atual ainda nao
tiver `Zone:Read`/`Zone Rulesets:Read`, o comando retorna estado parcial com permissoes faltantes em vez de
expor segredos.
Use `npm run copilot:mcp:cloudflare:edge-policy-plan` para gerar a proposta canonica plan-only de rulesets
Cloudflare antes de qualquer alteracao manual ou futura automacao de mutacao.
Use `npm run copilot:mcp:cloudflare:edge-policy-diff` para comparar o estado real da edge com essa proposta
canonico sem aplicar nenhuma alteracao.
Use `npm run copilot:mcp:cloudflare:edge-snapshot` para capturar tunnel, DNS, rulesets e diff em um unico JSON
antes de qualquer mudanca Cloudflare.
Use `npm run copilot:mcp:cloudflare:edge-backup-create` para persistir esse snapshot em
`src/copilot/.ai/cloudflare/edge-snapshots/`, ignorado pelo Git, antes de mudar cache, WAF ou rate limits.
Use `npm run copilot:mcp:cloudflare:edge-backup-list` para localizar o backup mais recente antes/depois de
uma alteracao operacional.
Use `npm run copilot:mcp:cloudflare:edge-policy-apply` para dry-run do aplicador com backup obrigatorio.
Aplicacao real exige chamar o CLI com `edge-policy-apply --apply --confirm-apply` ou a tool MCP com
`dryRun=false` e `confirmApply=true`.
Quick Tunnel continua disponivel como fallback explicito:

```bash
COPILOT_MCP_CLOUDFLARE_MODE=temporary-quick npm run copilot:mcp:cloudflare:quick
```

## Claude

O mesmo endpoint remoto tambem pode ser usado em Claude custom connectors:

```text
Name: Repo DevContainer MCP
Remote MCP server URL: https://mcp.aurelin.org/mcp
OAuth Client ID: deixar vazio
OAuth Client Secret: deixar vazio
```

O servidor publica metadata OAuth raiz e path-specific em `/.well-known/oauth-protected-resource/mcp`.
Veja também:

- `src/copilot/docs/CLAUDE_MCP_CONNECTOR_RUNBOOK.md`
- `src/copilot/docs/INVESTIGACAO-CLAUDE-MCP-OAUTH-CLOUDFLARE-STDIO-2026-06-11.md`

## Primeira superfície

Esta primeira faixa expõe leitura, escrita controlada, Git read-only, manutenção e diagnóstico:

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
- `repo_find_orphan_imports`
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
- `mcp_cleanup_ai_artifacts`
- `mcp_smoke_workspace`
- `mcp_tunnel_status`
- `mcp_runtime_health`

Validator job tools accept optional `timeoutMs` between 1000 and 3600000. Job records include the
command, args, timeout, exit code, signal and `timedOut` flag.

## Operação automática e limites

- `mcp_smoke_workspace` é agendado uma vez após o HTTP subir, sem bloquear startup. Configure com
  `COPILOT_MCP_STARTUP_SMOKE_ENABLED` e `COPILOT_MCP_STARTUP_SMOKE_DELAY_MS`; o estado aparece em
  `/health`.
- O JWKS remoto de autorização é pré-aquecido sem fabricar token, dois segundos após o listener
  subir por default. Configure com `COPILOT_MCP_JWKS_WARMUP_ENABLED` e
  `COPILOT_MCP_JWKS_WARMUP_DELAY_MS`; o estado aparece em `/health.authJwksWarmup` e o cache
  `oauth-remote-jwks` aparece nas métricas TTL de `mcp_runtime_health`.
- State de quick tunnel só é removido automaticamente quando o JSON é válido, o PID está morto e a
  idade excede `COPILOT_MCP_CLOUDFLARE_STALE_AFTER_MS`.
- `mcp_cleanup_ai_artifacts` aceita apenas artefatos `.json/.log` com nome UUID estrito em
  `src/copilot/.ai/jobs`, usa dry-run por default e limita cada aplicação a 500 arquivos.
- Headers de proxy são confiados apenas de peer loopback por default. Use
  `COPILOT_MCP_HTTP_TRUST_PROXY_HEADERS=true|false|loopback`; `X-Forwarded-For` requer ainda
  `COPILOT_MCP_HTTP_TRUST_X_FORWARDED_FOR=true`.
- O registry avisa antes do teto de tools por
  `COPILOT_MCP_REGISTRY_TOOL_COUNT_WARN_PERCENT` (default 80%).
- Handoffs pendentes expiram por default em cinco minutos; ajuste com
  `COPILOT_HANDOFF_PENDING_TTL_MS`.

## Copilot SDK / LLM-B

The LLM-B chat can opt into this MCP server without depending on it:

```bash
COPILOT_MCP_SERVERS=copilot-local npm run terminal:llm-b
```

The `copilot-local` server is registered as a stdio MCP config that launches:

```bash
node src/copilot/mcp/cli.js --transport stdio
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
  `repo_find_imports`, `repo_find_orphan_imports` e `repo_index_invalidate` espelham a familia
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
