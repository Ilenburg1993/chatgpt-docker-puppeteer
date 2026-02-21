# CODEX_AUDIT_TRACKER

- Ultima atualizacao: 2026-02-21T03:33:04Z
- Status: ativo (governanca continua)
- Politica: bug-first (`P0/P1` no canal primario)
- Canonico: `DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_TRACKER.md`
- Alias solicitado: `DOCUMENTAÇÃO/bugs/CODEX_AUDIT_TRACKER.md`

## Objetivo
Tracker vivo para auditoria gradual, correcoes, aprimoramentos e upgrades no codigo inteiro.

## Rodada Atual
- Onda: Wave 14 — Fluxo Kernel -> Fila -> DriverPool/BrowserPool -> Missoes
- Bug IDs da onda: `CODX-FLOW-001` a `CODX-FLOW-006`
- Snapshot da rodada: `DOCUMENTAÇÃO/BUGS/rodadas/CODEX_AUDIT_2026-02-21_03-33.md`

## Estado PM2/MCP/RAG/LSP
### Baseline de inicio (rodada Wave 14)
- PM2: saudavel (`agente-gpt`, `dashboard-web`, `chrome-proxy` online)
- MCP: saudavel (`mcp:diagnose` OK; `tools/list`=14)
- RAG: saudavel (`rag:health ok=true`) com risco residual de frescor de indice
- LSP: funcional (`lsp:health ok=true`)

### Baseline de fim (2026-02-21T03:33Z)
- PM2: saudavel (`agente-gpt`, `dashboard-web`, `chrome-proxy` online)
- MCP: saudavel (`mcp:diagnose` OK; `lsp_tools_present=true`, `lsp_functional_ok=true`)
- RAG: saudavel (`rag:health ok=true`, `available=true`; risco residual de frescor mantido)
- LSP: funcional (`lsp:health ok=true`)

## Top 5 Achados Ativos (Wave 14)
1. `CODX-FLOW-001` | `P0` | Hot Pool / Lifecycle
   - `PageLifecycleMonitor` ficava com `taskId` stale no hot-reuse.
   - Status: corrigido e validado (`rebindTaskId` + fallback por referencia de `page`).
2. `CODX-FLOW-002` | `P1` | Task Control Abort
   - `sendCommand` era disparado sem `await` em caminho de abort.
   - Status: corrigido e validado (timeout/retry/telemetria de falha e lock handling explicito).
3. `CODX-FLOW-003` | `P1` | Import side effects
   - Import puro emitia ruído de bootstrap (`dotenv`/config warnings).
   - Status: corrigido e validado (import limpo em `main`, `server/main`, `driver/factory`).
4. `CODX-FLOW-004` | `P1` | Domain validation
   - `TargetDriver` usava `includes` para domínio esperado.
   - Status: corrigido e validado (helper compartilhado de hostname exato/subdominio).
5. `CODX-FLOW-005` | `P1` | Timeout cleanup
   - `Promise.race` com timeout sem cancelamento explícito no adapter.
   - Status: corrigido e validado (`_withTimeout` cancelavel + cleanup de timers).

## Correcoes Aplicadas Nesta Rodada
1. `src/infra/browser_pool/PageLifecycleMonitor.js`
   - Novo `rebindTaskId(newTaskId)` com telemetria (`BROWSER_PAGE_TASK_REBIND`).
   - Handlers de close/disconnect passam `page` como fallback para remocao robusta.
2. `src/infra/browser_pool/pool_manager.js`
   - `updatePageTaskId` agora rebinda monitor explicitamente.
   - `removePageFromPool(taskId, pageRef)` com fallback por referencia de pagina.
3. `src/agent/task_control_watcher.js`
   - Fluxo de abort agora aguardado com timeout/retry.
   - Novos knobs: `TASK_CONTROL_ABORT_TIMEOUT_MS`, `TASK_CONTROL_ABORT_MAX_RETRIES`.
   - Eventos de trilha: `CONTROL_ABORT_INTENT`, `CONTROL_ABORT_SENT`, `CONTROL_ABORT_FAILED`.
4. `src/core/env_bootstrap.js`, `src/core/config.js`, `src/main.js`
   - `dotenv` em modo silencioso (`quiet`) e bootstrap idempotente.
   - Validacao/deprecacao de env movida para caminho explicito de `CONFIG.reload()`.
   - Removido import top-level de `env_bootstrap` no entrypoint principal.
5. `src/core/domain_matcher.js`, `src/driver/core/TargetDriver.js`, `src/infra/browser_pool/PageValidator.js`
   - Contrato unificado de dominio (hostname exato/subdominio valido).
6. `src/driver/nerv_adapter/driver_nerv_adapter.js`
   - Substituido helper legado por `_withTimeout` cancelavel.
   - Cleanup/finalization harden com timeout cancelavel inclusive no fallback.
7. `src/driver/factory.js`
   - `_applyStartOptions` aceita detach explicito via `browserPool: null`.
   - Novo `clearBrowserPool()` para cenarios de teste/reconfiguracao.
8. `scripts/audit/collectors/performance.mjs` + `contracts/domains/runtime.json`
   - Regra nova para detectar `Promise.race` com timeout sem cancelamento.
   - Contratos adicionados: `CONTRACT-RUNTIME-ABORT-COMMAND-AWAIT`, `CONTRACT-RUNTIME-IMPORT-SIDE-EFFECT`, `CONTRACT-RUNTIME-HOT-POOL-MONITOR-CONSISTENCY`.

## Testes Executados e Resultado
- Parse/import
  - `node --check src/main.js src/server/main.js src/driver/factory.js src/driver/nerv_adapter/driver_nerv_adapter.js src/infra/browser_pool/pool_manager.js src/infra/browser_pool/PageLifecycleMonitor.js src/agent/task_control_watcher.js src/driver/core/TargetDriver.js` -> OK
  - `env -u NO_COLOR -u FORCE_COLOR node --input-type=module -e "import './src/main.js'; console.log('OK')"` -> OK (saida limpa)
  - `env -u NO_COLOR -u FORCE_COLOR node --input-type=module -e "import './src/server/main.js'; console.log('OK')"` -> OK (saida limpa)
  - `env -u NO_COLOR -u FORCE_COLOR node --input-type=module -e "import './src/driver/factory.js'; console.log('OK')"` -> OK (saida limpa)
- Regressao existente
  - `node --test tests/regression/test_wave3_runtime_hardening.spec.js` -> 1/1 pass
  - `node --test tests/regression/test_wave12_entrypoint_import_resilience.spec.js tests/regression/test_wave12_main_signal_portability.spec.js tests/regression/test_wave13_*.spec.js tests/integration/driver/test_wave13_hot_pool_reuse_integrity.spec.js tests/integration/server/test_split_boot_retry.spec.js` -> 13/13 pass
- Novos testes Wave14
  - `tests/regression/test_wave14_hot_pool_monitor_taskid_rebind.spec.js` -> 3/3 pass
  - `tests/regression/test_wave14_task_control_watcher_abort_await.spec.js` -> 3/3 pass
  - `tests/regression/test_wave14_entrypoint_import_no_side_effect_logs.spec.js` -> 3/3 pass
  - `tests/regression/test_wave14_targetdriver_domain_strict_match.spec.js` -> 3/3 pass
  - `tests/regression/test_wave14_driver_adapter_timeout_cleanup.spec.js` -> 3/3 pass
- Operacao/auditoria
  - `npm run audit:preflight` -> OK (`pm2/mcp/rag/lsp ok=true`)
  - `npm run audit:quick` -> OK (`run_id=WAVE_AUDIT_QUICK_2026-02-21T03-32-36-214Z`, findings=0)
  - `npm run daemon:status` -> OK (3 processos online)
  - `npm run mcp:diagnose` -> OK
  - `npm run rag:health -- --json` -> OK (`ok=true`)
  - `npm run lsp:health -- --json` -> OK (`ok=true`)

## Rollback
1. Ordem de rollback por fase runtime: `Fase 6 -> Fase 5 -> Fase 4 -> Fase 3 -> Fase 2 -> Fase 1`.
2. Preservar governanca/tracker (Fase 0) independentemente do rollback de codigo.
3. Em incidente de hot pool, usar kill-switch `DRIVER_HOT_POOL_ENABLED=false`.
4. Em incidente de abort-control, retornar temporariamente ao envio simples removendo retry/timeout mantendo telemetria de falha.

## Proxima Onda (Escopo Fechado)
- Onda 14.1 (kernel/fila/missoes):
  1. Auditar relacao task-attempt-mission no `kernel` e `agent/*` com invariantes formais de transicao.
  2. Fechar gaps P1 de validação de domínio remanescentes (`DriverReadinessGuard` e correlatos) para contrato unico.
  3. Expandir contratos de runtime para detectar lock release sem causalidade e side effects de import em novos entrypoints auxiliares.
- Risco residual transversal:
  1. Frescor do indice RAG continua nao-bloqueador, mas registrado.

## Playbook e Instrucoes Locais
- Playbook: `DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_PLAYBOOK.md`
- Delta de instrucoes do agente: `DOCUMENTAÇÃO/BUGS/CODEX_DEFAULT_INSTRUCTIONS_DELTA.md`

## Historico de Rodadas CODEX
- `DOCUMENTAÇÃO/BUGS/rodadas/CODEX_AUDIT_2026-02-21_01-41.md`
- `DOCUMENTAÇÃO/BUGS/rodadas/CODEX_AUDIT_2026-02-21_02-00.md`
- `DOCUMENTAÇÃO/BUGS/rodadas/CODEX_AUDIT_2026-02-21_02-06.md`
- `DOCUMENTAÇÃO/BUGS/rodadas/CODEX_AUDIT_2026-02-21_02-09.md`
- `DOCUMENTAÇÃO/BUGS/rodadas/CODEX_AUDIT_2026-02-21_02-17.md`
- `DOCUMENTAÇÃO/BUGS/rodadas/CODEX_AUDIT_2026-02-21_02-44.md`
- `DOCUMENTAÇÃO/BUGS/rodadas/CODEX_AUDIT_2026-02-21_03-33.md`
