# CODEX_AUDIT_TRACKER

- Ultima atualizacao: 2026-02-21T08:54:20Z
- Status: ativo (governanca continua)
- Politica: bug-first (`P0/P1` no canal primario)
- Canonico: `DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_TRACKER.md`
- Alias solicitado: `DOCUMENTAÇÃO/bugs/CODEX_AUDIT_TRACKER.md`

## Objetivo
Tracker vivo para auditoria gradual, correcoes, aprimoramentos e upgrades no codigo inteiro.

## Rodada Atual
- Onda: Wave 17 — Auditoria e Consolidação Server/Dashboard para Gestão SSOT de Missões e Tarefas
- Bug IDs da onda: `CODX-DS17-001` a `CODX-DS17-010`
- Snapshot da rodada: `DOCUMENTAÇÃO/BUGS/rodadas/CODEX_AUDIT_2026-02-21_05-50.md`

## Estado PM2/MCP/RAG/LSP
### Baseline de inicio (Wave 17)
- PM2: saudavel (`agente-gpt`, `dashboard-web`, `chrome-proxy` online)
- MCP: saudavel (`mcp:diagnose` OK; `tools/list count=14`)
- RAG: saudavel (`ok=true`, `available=true`)
- LSP: funcional (`ok=true`, `lsp_tools_present=true`, `lsp_functional_ok=true`)

### Baseline de fim (Wave 17)
- PM2: saudavel (`agente-gpt`, `dashboard-web`, `chrome-proxy` online)
- MCP: saudavel (`mcp:diagnose` OK; `tools/list count=14`)
- RAG: saudavel (`ok=true`, `available=true`)
- LSP: funcional (`ok=true`, `lsp_tools_present=true`, `lsp_functional_ok=true`)

## Top 5 Achados Ativos (Wave 17)
1. `CODX-DS17-001` | `P0` | Ownership duplicado de execução missão/task (SSOT + legado).
   - Status: mitigado; default SSOT reforçado e legado em contingência explícita.
2. `CODX-DS17-002` | `P0` | Regras de transição de missão dispersas entre controller/runner.
   - Status: corrigido com `mission_execution_service` como entrypoint único de transição.
3. `CODX-DS17-003` | `P0/P1` | Idempotência insuficiente de criação de task por step em restart/reprocessamento.
   - Status: corrigido (`taskId` determinístico + `insertTask(ifNotExists)` no `MissionRunner`).
4. `CODX-DS17-004` | `P1` | Realtime com trilha compat legado ativa por padrão.
   - Status: corrigido (compat emit opt-in; bridge legado só com contingência explícita).
5. `CODX-DS17-005` | `P1` | Falta de detecção automática para bypass de transição de missão.
   - Status: corrigido (contratos + coletores runtime/performance atualizados).

## Correcoes Aplicadas Nesta Rodada
1. `src/agent/mission_execution_service.js` (novo)
   - serviço de domínio único para transições (`execute/pause/resume/cancel/fail/complete`) e atualização de progresso com precondições.
2. `src/server/api/controllers/missions.js`
   - rotas de controle (`execute/pause/resume/delete`) migradas para `mission_execution_service`.
   - normalização de `correlation_id` em tasks de planner/proposals.
3. `src/agent/mission_runner.js`
   - migração para `mission_execution_service` (sem `updateMission(status)` ad-hoc).
   - `taskId` determinístico por `mission_id + step_id + attempt_seq`.
   - enqueue idempotente com `ifNotExists` + eventos de auditoria.
4. `src/missions/mission_manager.js`
   - SSOT-first reforçado; `legacy_direct` só com `MISSION_MANAGER_LEGACY_DISPATCH_ENABLED=true`.
5. `src/server/main.js`
   - `legacy_bridge` só com `DASHBOARD_LEGACY_BRIDGE_CONTINGENCY=true`.
6. `src/server/realtime/ssot_event_feed.js`
   - `task:updated`/`mission:updated` legados apenas com `DASHBOARD_EMIT_TASK_UPDATED_COMPAT=true`.
7. `src/dashboard-ui/src/composables/useRealtime.js`
   - consumo prioriza lote SSOT (`task:updates_batch`), removendo dependência de evento unitário legado.
8. `src/core/config.js`, `.env.schema.json`, `.env.example`, `.env.development`, `.env.test`, `.env.production`
   - novas envs de contingência:
     - `DASHBOARD_LEGACY_BRIDGE_CONTINGENCY`
     - `MISSION_MANAGER_LEGACY_DISPATCH_ENABLED`
9. `contracts/domains/architecture.json`, `contracts/domains/runtime.json`, `scripts/audit/collectors/runtime.mjs`, `scripts/audit/collectors/performance.mjs`
   - contrato de transição de missão via serviço único e detecção automática de bypass.
10. Novos testes Wave 17:
   - `tests/regression/test_wave17_mission_owner_ssot_only.spec.js`
   - `tests/regression/test_wave17_mission_transition_service_single_entrypoint.spec.js`
   - `tests/regression/test_wave17_mission_step_idempotency.spec.js`
   - `tests/regression/test_wave17_dashboard_ssot_feed_only.spec.js`
   - `tests/regression/test_wave17_stale_attempt_does_not_mutate_mission.spec.js`

## Testes Executados e Resultado
- Parse/check de arquivos alvo da wave: **OK**
- Import safety:
  - `import './src/main.js'` -> **OK**
  - `import './src/server/main.js'` -> **OK**
  - `import './src/driver/factory.js'` -> **OK**
- Regressão + integração:
  - `node --test tests/regression/test_wave15_*.spec.js tests/regression/test_wave16r_*.spec.js tests/regression/test_wave17_*.spec.js tests/unit/agent/test_ssot_orchestration_worker.spec.js tests/integration/test_mission_system_integration.spec.js tests/integration/server/test_dashboard_realtime_contract.spec.js` -> **39/39 pass**
- Operação/auditoria:
  - `npm run audit:preflight` -> `ok=true`
  - `npm run audit:quick` -> `WAVE_AUDIT_QUICK_2026-02-21T08-53-06-841Z`, `findings=0`, `shadow_would_block=false`
  - `npm run daemon:status` -> 3 processos online
  - `npm run mcp:diagnose -- --json` -> **OK**
  - `npm run rag:health -- --json` -> `ok=true`, `available=true`
  - `npm run lsp:health -- --json` -> `ok=true`

## Rollback
1. Ordem por fase: `F7 -> F6 -> F5 -> F4 -> F3 -> F2 -> F1`.
2. Preservar governanca/tracker (F0) independentemente de rollback de código.
3. Contingências rápidas:
   - `DASHBOARD_LEGACY_BRIDGE_CONTINGENCY=true` + `DASHBOARD_TASK_SYNC_MODE=legacy_bridge`
   - `MISSION_STEP_DISPATCH_MODE=legacy_direct` + `MISSION_MANAGER_LEGACY_DISPATCH_ENABLED=true`

## Proxima Onda (Escopo Fechado)
1. Promover contratos Wave 17 de `warn` para `block` após 1 ciclo estável.
2. Remover definitivamente caminhos legados de missão/realtime quando contingência não for mais necessária.
3. Expandir testes de causalidade missão/task em cenários de corrida sob carga alta.

## Rodada Anterior
- Onda: Wave 14.1 — Consolidacao Kernel SSOT (Task/Attempt/Mission) + Hardening de Fluxo
- Bug IDs da onda: `CODX-W141-001` a `CODX-W141-007`
- Snapshot da rodada: `DOCUMENTAÇÃO/BUGS/rodadas/CODEX_AUDIT_2026-02-21_04-11.md`

## Estado PM2/MCP/RAG/LSP
### Baseline de inicio (Wave 14.1)
- PM2: saudavel (`agente-gpt`, `dashboard-web`, `chrome-proxy` online)
- MCP: saudavel (`mcp:diagnose` OK; `tools/list count=14`; `lsp_tools_present=true`)
- RAG: saudavel (`ok=true`, `available=true`) com risco residual de frescor de indice
- LSP: funcional (`ok=true`, `lsp_functional_ok=true`)

### Baseline de fim (2026-02-21T04:11Z)
- PM2: saudavel (`agente-gpt`, `dashboard-web`, `chrome-proxy` online)
- MCP: saudavel (`mcp:diagnose` OK; `tools/list count=14`; `lsp_tools_present=true`; `lsp_functional_ok=true`)
- RAG: saudavel (`ok=true`, `available=true`, `index_updated_at=2026-02-15T13:28:32Z`)
- LSP: funcional (`ok=true`, `lsp_tools_present=true`, `lsp_functional_ok=true`)

## Top 5 Achados Ativos (Wave 14.1)
1. `CODX-W141-001` | `P0` | Kernel NEXT_STEP fora de SSOT em parte do fluxo
   - Status: corrigido e validado (`kernel_nerv_bridge` passa a criar child task via `insertTask(ifNotExists)` com ID deterministico).
2. `CODX-W141-002` | `P0/P1` | Missao com caminho paralelo de dispatch direto
   - Status: corrigido e validado (`MissionManager` default `ssot_queue`, fallback temporario `legacy_direct` por env).
3. `CODX-W141-003` | `P1` | Eventos stale de attempt podiam mutar status/lock
   - Status: corrigido e validado (invariantes centralizados + evento `TASK_EVENT_STALE_ATTEMPT_IGNORED`).
4. `CODX-W141-004` | `P1` | `DriverReadinessGuard` com validacao de dominio por `includes`
   - Status: corrigido e validado (uso de helper estrito `isDomainMatch`).
5. `CODX-W141-005` | `P1` | Auditoria sem deteccao automatica de ownership/causalidade lock-attempt
   - Status: corrigido e validado (novos contratos/runtime collectors em modo `warn`).

## Registro Complementar (Wave 14.1)
- `CODX-W141-006` | `P1` | Missao e fila com necessidade de coerencia de estado em DB durante execucao SSOT.
  - Status: corrigido e validado (sincronizacao de status no DB antes de enqueue e transicoes chave).
- `CODX-W141-007` | `P1` | `releaseTaskLock` sem causalidade explicita em partes do fluxo.
  - Status: corrigido e validado (`expectedAttemptId` no repo + helper causal em queue/projector).

## Correcoes Aplicadas Nesta Rodada
1. `src/agent/workflow_next_step_builder.js` (novo)
   - Builder SSOT unico para child tasks de `NEXT_STEP`.
2. `src/kernel/nerv_bridge/kernel_nerv_bridge.js`
   - `_handleNextStepAction` transacional com `insertTask(ifNotExists)` + evento `TASK_ORCHESTRATION_NEXT_STEP_CREATED`.
3. `src/agent/task_orchestration_worker.js`
   - Reuso do builder compartilhado para eliminar divergencia de montagem de task.
4. `src/missions/mission_manager.js`
   - Dispatch por fila SSOT no modo default (`MISSION_STEP_DISPATCH_MODE=ssot_queue`) e fallback `legacy_direct` temporario.
   - Sincronizacao de estado de missao no DB para consistencia operacional.
5. `src/agent/task_attempt_invariants.js` (novo)
   - Regras de causalidade de attempt e lock, com eventos de stale attempt.
6. `src/agent/task_state_projector.js` e `src/agent/queue_worker.js`
   - Aplicacao de invariantes + release de lock causal via helper.
7. `src/infra/db/task_repo.js`
   - `releaseTaskLock` com guarda opcional `expectedAttemptId`.
8. `src/driver/guards/DriverReadinessGuard.js`
   - Validacao de dominio estrita e falha segura para URL invalida.
9. `src/core/config.js`
   - Nova env `MISSION_STEP_DISPATCH_MODE` (`ssot_queue` default).
10. `contracts/domains/architecture.json`, `contracts/domains/runtime.json`, `scripts/audit/collectors/performance.mjs`, `scripts/audit/collectors/runtime.mjs`
   - Contratos e detecoes novas para ownership SSOT e lock release causalidade (enforcement `warn`).

## Testes Executados e Resultado
- Parse/check
  - `node --check src/kernel/nerv_bridge/kernel_nerv_bridge.js src/missions/mission_manager.js src/agent/task_orchestration_worker.js src/agent/queue_worker.js src/agent/task_state_projector.js src/driver/guards/DriverReadinessGuard.js src/infra/db/task_repo.js src/agent/workflow_next_step_builder.js src/agent/task_attempt_invariants.js scripts/audit/collectors/performance.mjs scripts/audit/collectors/runtime.mjs` -> OK
- Import-safety
  - `env -u NO_COLOR -u FORCE_COLOR node --input-type=module -e "import './src/main.js'; console.log('OK')"` -> OK
  - `env -u NO_COLOR -u FORCE_COLOR node --input-type=module -e "import './src/server/main.js'; console.log('OK')"` -> OK
  - `env -u NO_COLOR -u FORCE_COLOR node --input-type=module -e "import './src/driver/factory.js'; console.log('OK')"` -> OK
- Regressao + integracao
  - `node --test tests/regression/test_wave12_entrypoint_import_resilience.spec.js tests/regression/test_wave14_*.spec.js tests/unit/agent/test_ssot_orchestration_worker.spec.js tests/integration/test_mission_system_integration.spec.js` -> `36/36 pass`
- Novos testes Wave 15
  - `node --test tests/regression/test_wave15_*.spec.js` -> `8/8 pass`
- Operacao/auditoria
  - `npm run audit:preflight` -> `ok: true`
  - `npm run audit:quick` -> `run_id=WAVE_AUDIT_QUICK_2026-02-21T04-10-08-702Z`, `findings(total)=0`, `shadow_would_block=false`
  - `npm run daemon:status` -> 3 processos online
  - `npm run mcp:diagnose` -> OK
  - `npm run rag:health -- --json` -> `ok=true`, `available=true`
  - `npm run lsp:health -- --json` -> `ok=true`

## Rollback
1. Ordem por fase: `Fase 6 -> Fase 5 -> Fase 4 -> Fase 3 -> Fase 2 -> Fase 1`.
2. Preservar governanca/tracker (Fase 0) independentemente de rollback de codigo.
3. Em incidente de missao/dispatch, usar `MISSION_STEP_DISPATCH_MODE=legacy_direct` temporariamente.
4. Em incidente de invariantes attempt/lock, reverter helper de invariantes mantendo eventos de diagnostico.
5. Em incidente de contrato novo, manter contratos em `warn` sem bloqueio de pipeline.

## Proxima Onda (Escopo Fechado)
- Wave 15 (promocao de enforcement + remocao de legado)
  1. Promover contratos de ownership/causalidade de `warn` para `block` apos baseline estavel.
  2. Remover fallback `legacy_direct` do `MissionManager` se nao houver regressao operacional.
  3. Auditar cadeia completa mission/workflow em cenarios de reprocessamento e falha parcial (idempotencia de child tasks e correlacao).

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
- `DOCUMENTAÇÃO/BUGS/rodadas/CODEX_AUDIT_2026-02-21_04-11.md`
