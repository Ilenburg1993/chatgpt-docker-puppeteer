# CODEX_AUDIT_TRACKER

- Ultima atualizacao: 2026-02-21T10:21:35Z
- Status: ativo (governanca continua)
- Politica: bug-first (`P0/P1` no canal primario)
- Canonico: `DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_TRACKER.md`
- Alias solicitado: `DOCUMENTAÇÃO/bugs/CODEX_AUDIT_TRACKER.md`

## Objetivo
Tracker vivo para auditoria gradual, correcoes, aprimoramentos e upgrades no codigo inteiro.

## Rodada Atual
- Onda: Wave 19 — Upgrade Vasto Frontend (Hard Cutover) + Backend Evolutivo
- Bug IDs da onda: `CODX-W19-001` a `CODX-W19-020`
- Snapshot da rodada: `DOCUMENTAÇÃO/BUGS/rodadas/CODEX_AUDIT_2026-02-21_10-20.md`

## Estado PM2/MCP/RAG/LSP
### Baseline de inicio (Wave 19)
- PM2: saudavel (`agente-gpt`, `dashboard-web`, `chrome-proxy` online)
- MCP: saudavel (`ok=true`, `tools_count=14`)
- RAG: saudavel (`ok=true`, `available=true`)
- LSP: funcional (`ok=true`, `lsp_tools_present=true`, `lsp_functional_ok=true`)

### Baseline de fim (Wave 19)
- PM2: saudavel (`agente-gpt`, `dashboard-web`, `chrome-proxy` online)
- MCP: saudavel (`mcp:diagnose -- --json` OK)
- RAG: saudavel (`rag:health -- --json` com `ok=true`, `available=true`)
- LSP: funcional (`lsp:health -- --json` com `ok=true`)

## Top 5 Achados Ativos (Wave 19)
1. `CODX-W19-001` | `P0` | Criação de missão fora do control plane nas rotas ativas.
   - Status: corrigido (`MISSION_CREATE` no `control_command_service` + `missions_vnext.createMission` via command flow).
2. `CODX-W19-002` | `P1` | Falta de confirmação forte para comandos críticos na UI.
   - Status: corrigido (`confirmTwoStepAction` + `requireReason` em `TasksView`, `TaskDetail`, `MissionDetail`, `Missions`).
3. `CODX-W19-003` | `P1` | Realtime sem dedupe/buffer robusto sob burst.
   - Status: corrigido (`useSsotRealtime` com buffer por lote, dedupe por `event_id`, reconciliação de cursor).
4. `CODX-W19-004` | `P1` | Índice cruzado task↔mission incompleto no estado de UI.
   - Status: corrigido (`taskIdsByMissionId`, getters cruzados e rebuild consistente no `tasks_vnext`).
5. `CODX-W19-005` | `P1` | Contratos não cobrindo mutação direta `/api/missions` e dedupe realtime.
   - Status: corrigido (novos contratos em `architecture.json` e `runtime.json` + coletores).

## Correcoes Aplicadas Nesta Rodada
1. Control Plane
- `src/server/domain/mission_control_service.js`: novo `createMissionCommand` com validação, evento de auditoria e sync de steps.
- `src/server/domain/control_command_service.js`: novo comando `MISSION_CREATE`, permissão `MISSION_CREATE` e contrato de entity id para comandos create.

2. Hard cutover frontend vNext
- `src/dashboard-ui/src/stores/missions_vnext.js`: `createMission` migrou para `POST /api/control/commands`; operações legadas explícitas desativadas.
- `src/dashboard-ui/src/views/Missions.vue`: criação de missão com motivo obrigatório e confirmação em 2 etapas.

3. UX densa com guardrails
- novo helper `src/dashboard-ui/src/lib/command_guard.js` (`requireReason`, `confirmTwoStepAction`).
- comandos críticos com 2-step confirm em:
  - `src/dashboard-ui/src/views/TasksView.vue`
  - `src/dashboard-ui/src/views/TaskDetail.vue`
  - `src/dashboard-ui/src/views/MissionDetail.vue`
  - `src/dashboard-ui/src/views/Missions.vue`

4. Estado cruzado e realtime robusto
- `src/dashboard-ui/src/stores/tasks_vnext.js`: índice `taskIdsByMissionId` + getters `getTaskIdsByMissionId`/`getTasksByMissionId`.
- `src/dashboard-ui/src/composables/useSsotRealtime.js`: buffer curto, dedupe por entidade/evento, reconciliação por cursor.
- `src/dashboard-ui/src/stores/events_vnext.js`: dedupe por `seenIds` e truncamento seguro.

5. Performance de carregamento
- `src/dashboard-ui/src/views/TaskDetail.vue` e `src/dashboard-ui/src/views/MissionDetail.vue`: `VisGraph` em `defineAsyncComponent` (lazy).

6. Presets operacionais por usuário
- novo `src/dashboard-ui/src/composables/useUiPreferences.js` com persistência local + sync em `/api/control/preferences/me`.
- `src/dashboard-ui/src/components/layout/Header.vue` e `src/dashboard-ui/src/components/layout/AppLayout.vue`: seletor `dense|balanced|focus` e aplicação dinâmica.

7. Contratos e coletores
- `contracts/domains/architecture.json`:
  - `CONTRACT-ARCH-DASHBOARD-VNEXT-NO-DIRECT-MISSIONS-MUTATION`
- `contracts/domains/runtime.json`:
  - `CONTRACT-RUNTIME-DASHBOARD-VNEXT-NO-DIRECT-MISSIONS-MUTATION`
  - `CONTRACT-RUNTIME-REALTIME-CURSOR-DEDUP-RECONCILIATION`
- coletores atualizados:
  - `scripts/audit/collectors/runtime.mjs`
  - `scripts/audit/collectors/performance.mjs`

8. Testes novos Wave 19
- `tests/regression/test_wave19_frontend_hard_cutover_no_legacy_mutations.spec.js`
- `tests/regression/test_wave19_tasks_missions_cross_store_consistency.spec.js`
- `tests/regression/test_wave19_dashboard_tasks_enriched_contract.spec.js`
- `tests/regression/test_wave19_realtime_cursor_dedup_reconciliation.spec.js`
- `tests/regression/test_wave19_ui_command_two_step_confirmation.spec.js`
- `tests/regression/test_wave19_bundle_budget_guard.spec.js`

## Testes Executados e Resultado
- Parse/check:
  - `node --check ...` (arquivos alterados do escopo) -> **OK**
- Regressao Wave 19:
  - `node --test tests/regression/test_wave19_*.spec.js` -> **7/7 pass**
- Regressao Wave 18/18T (amostra crítica):
  - `node --test tests/regression/test_wave18t_dashboard_views_no_direct_tasks_mutation_calls.spec.js tests/regression/test_wave18_control_commands_single_entrypoint.spec.js tests/integration/server/test_wave18t_dashboard_tasks_enriched_mission_context.spec.js tests/integration/server/test_wave18_dashboard_realtime_control_command_status.spec.js` -> **4/4 pass**
  - `node --test tests/integration/server/test_wave18t_task_detail_command_flow_only.spec.js tests/regression/test_wave18t_bulk_reassign_preview_and_validation.spec.js tests/regression/test_wave18t_task_patch_cannot_change_mission_id.spec.js tests/regression/test_wave18t_task_reassign_requires_paused_or_ready.spec.js` -> **4/4 pass**
- Build frontend:
  - `npm --prefix src/dashboard-ui run build` -> **OK**
- Auditoria:
  - `npm run audit:preflight` -> `ok=true`
  - `npm run audit:quick` -> `run_id=WAVE_AUDIT_QUICK_2026-02-21T10-20-30-099Z`, `findings=0`, `shadow_would_block=false`

## Rollback
1. Ordem por fase: `F6 -> F5 -> F4 -> F3 -> F2 -> F1` mantendo `F0` (governanca).
2. Em incidente de reassign: desabilitar acao na UI e manter comando backend para operacao controlada.
3. Preservar tracker/snapshot/evidencias em qualquer rollback.

## Proxima Onda (Escopo Fechado)
1. Finalizar remoção operacional do legado (`useRealtime`, stores legacy e views não roteadas) com limpeza física/arquivamento.
2. Expandir dry-run de comandos críticos no frontend (`/api/control/validate`) antes da confirmação final.
3. Promover contratos Wave 19 de `warn` para `block` após 1 ciclo limpo de auditoria.
4. Adicionar guard de budget real por chunk pós-build no pipeline (`bundle budget` hard gate).

## Rodada Anterior
- Onda: Wave 18T — Consolidacao Total de Tasks no Dashboard Integradas as Missions (SSOT Hard Cutover)
- Snapshot: `DOCUMENTAÇÃO/BUGS/rodadas/CODEX_AUDIT_2026-02-21_06-57.md`

## Playbook e Instrucoes Locais
- Playbook: `DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_PLAYBOOK.md`
- Delta de instrucoes do agente: `DOCUMENTAÇÃO/BUGS/CODEX_DEFAULT_INSTRUCTIONS_DELTA.md`
