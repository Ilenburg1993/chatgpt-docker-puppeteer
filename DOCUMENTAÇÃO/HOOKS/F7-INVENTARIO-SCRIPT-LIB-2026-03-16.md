# F7.1 — Inventário Script↔Lib (2026-03-16)

## Resumo executivo

- `scripts_total`: **42**
- `dedicated_libs_total` (`*-lib.sh`): **29**
- `missing_relation_count`: **0**
- `invalid_lib_placement_count`: **0**

Validação usada: `.github/hooks/scripts/verify-script-lib-coverage.sh`.

## Taxonomia aplicada

### Hooks automáticos

- `session-start.sh`
- `log-prompt.sh`
- `pre-tool-use.sh`
- `post-tool-use.sh`
- `agent-stop.sh`
- `subagent-start.sh`
- `subagent-stop.sh`
- `pre-compact.sh`
- `session-end.sh`

### Scripts manuais executados internamente por hooks automáticos

- `watchdog.sh`
- `rotate-audit.sh`
- `session-close.sh`
- `session-checkpoint.sh`
- `sync-tasks-to-docs.sh`
- `generate-session-summary.sh`

### Scripts manuais de operação/usuário/manutenção

- `add-task.sh`
- `analytics.sh`
- `complete-task.sh`
- `continue-section.sh`
- `error-occurred.sh`
- `export-metrics.sh`
- `export-script-lib-index.sh`
- `generate-daily-report.sh`
- `generate-section-summary.sh`
- `install-git-hooks.sh`
- `manual-session-init.sh`
- `migrate-per-session-audit.sh`
- `on-git-push.sh`
- `read-transcript.sh`
- `reset-auth-violation.sh`
- `resolve-finding.sh`
- `save-finding.sh`
- `section-end.sh`
- `session-reminder.sh`
- `smoke-test-domains.sh`
- `smoke-test.sh`
- `start-section.sh`
- `start-turn.sh`
- `sync-transcript-errors.sh`
- `tool-use-failure.sh`
- `verify-hook-delivery.sh`
- `verify-script-lib-coverage.sh`

## Cobertura dedicada criada (wrappers `*-lib.sh`)

### `hooks-lib/lifecycle/`

- `continue-section-lib.sh`
- `manual-session-init-lib.sh`
- `on-git-push-lib.sh`
- `section-end-lib.sh`
- `session-checkpoint-lib.sh`
- `session-close-lib.sh`
- `session-reminder-lib.sh`

### `hooks-lib/audit/`

- `error-occurred-lib.sh`
- `generate-daily-report-lib.sh`
- `generate-session-summary-lib.sh`
- `read-transcript-lib.sh`
- `sync-transcript-errors-lib.sh`

### `hooks-lib/maintenance/`

- `add-task-lib.sh`
- `analytics-lib.sh`
- `complete-task-lib.sh`
- `export-metrics-lib.sh`
- `install-git-hooks-lib.sh`
- `migrate-per-session-audit-lib.sh`
- `resolve-finding-lib.sh`
- `rotate-audit-lib.sh`
- `save-finding-lib.sh`
- `sync-tasks-to-docs-lib.sh`
- `verify-hook-delivery-lib.sh`
- `watchdog-lib.sh`

### `hooks-lib/policy/`

- `reset-auth-violation-lib.sh`

### `hooks-lib/testing/`

- `export-script-lib-index-lib.sh`
- `smoke-test-domains-lib.sh`
- `verify-script-lib-coverage-lib.sh`

## Artefato F7.8 — índice machine-readable

- Arquivo: `.github/hooks/state/f7-script-lib-index.json`
- Gerador: `.github/hooks/scripts/export-script-lib-index.sh`
- Schema principal: `generated_at`, `scripts_total`, `coverage`, `index[]`.
- Cobertura atual do índice: `dedicated_lib=29`, `inline_relation=13`, `none=0`.

## Observações

- `agent-stop.sh` segue vinculado ao legado canônico `hooks-lib/agent-stop-lib.sh` (root permitido temporariamente).
- Scripts que já tinham integração direta com `hooks-lib` permanecem com relação **inline** e não exigiram wrapper adicional.

## Lacunas remanescentes (consolidação F7)

Detectadas via `verify-script-lib-coverage.sh --strict-legacy-root`:

- `hooks-lib/common.sh`
- `hooks-lib/config.sh`
- `hooks-lib/policy.sh`
- `hooks-lib/session-start-core.sh`
- `hooks-lib/session-start-aux.sh`
- `hooks-lib/session-end-core.sh`
- `hooks-lib/session-end-aux.sh`

Próximo passo recomendado: executar F7.9 (governança de diretórios/naming), depois F7.10.

Atualização desta rodada: contrapartes canônicas para os 7 módulos legados existem em
`hooks-lib/runtime`, `hooks-lib/policy` e `hooks-lib/lifecycle`, com inversão root->shim concluída.
