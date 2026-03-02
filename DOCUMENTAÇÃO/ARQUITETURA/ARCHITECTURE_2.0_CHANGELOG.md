# Architecture 2.0 — Changelog Completo

> **Início**: 2 de março de 2026
> **Status**: Em andamento
> **Sessões**: 2 (sessão anterior + sessão atual)

---

## Índice

1. [Bugs Encontrados e Corrigidos](#bugs-encontrados-e-corrigidos)
2. [Aprimoramentos Sugeridos e Implementados](#aprimoramentos-sugeridos-e-implementados)
3. [Upgrades Sugeridos e Implementados](#upgrades-sugeridos-e-implementados)
4. [Análise NERV](#análise-nerv)
5. [Métricas de Progresso](#métricas-de-progresso)

---

## Bugs Encontrados e Corrigidos

### Sessão 1 — 21 Bugs Corrigidos

| # | Severidade | Módulo | Arquivo | Bug | Status |
|---|-----------|--------|---------|-----|--------|
| 1 | P0 | NERV | nerv.js | shutdown() limpava apenas 3/7 subsistemas | ✅ Corrigido |
| 2 | P0 | Infra | task_repo.js | JSON.parse em catch block silencioso | ✅ Corrigido |
| 3 | P0 | Server | dashboard_events.js | JSON.parse em catch block silencioso | ✅ Corrigido |
| 4 | P0 | Server | dashboard_missions.js | JSON.parse em catch block silencioso | ✅ Corrigido |
| 5 | P0 | Server | dashboard_tasks.js | JSON.parse em catch block silencioso | ✅ Corrigido |
| 6 | P1 | NERV | health.js | Sem limite de listeners — memory leak potencial | ✅ Corrigido |
| 7 | P1 | Kernel | policy_engine.js | Date.now() em vez do parâmetro `at` determinístico | ✅ Corrigido |
| 8 | P1 | Infra | mission_repo.js | TOCTOU race no updateMission (optimistic lock) | ✅ Corrigido |
| 9 | P1 | Logic | adaptive.js | Dados perdidos no shutdown (debounce sem flush) | ✅ Corrigido |
| 10 | P1 | Validation | llm_judge.js | Score string "75" rejeitado como NaN | ✅ Corrigido |
| 11 | P1 | Infra | events_repo.js | Tabela de eventos cresce sem limite (sem TTL) | ✅ Corrigido |
| 12 | P1 | Orchestrator | orchestrator_engine.js | Lock failure retornava silenciosamente | ✅ Corrigido |
| 13 | P1 | Orchestrator | context_manager.js | Token estimation chars/4 imprecisa + summary ilimitado | ✅ Corrigido |
| 14 | P1 | Orchestrator | checkpoint_manager.js | Write não-atômico + sem validação no load | ✅ Corrigido |
| 15 | P1 | Orchestrator | validation_service.js | null score inflava resultado para 100 | ✅ Corrigido |
| 16 | P1 | Agent | mission_planner_processor.js | Budget check sem transação (race condition) | ✅ Corrigido |
| 17 | P1 | Agent | attempt_watchdog.js | False positive — heartbeat NULL = stale imediato | ✅ Corrigido |
| 18 | P2 | Agent | queue_worker.js | 3 catch blocks silenciosos sem logging | ✅ Corrigido |
| 19 | P2 | Missions | workflow_generator.js | structuredClone sem error handling + placeholders | ✅ Corrigido |
| 20 | P2 | Integration | error-classifier.mjs | Case sensitivity no model fallback lookup | ✅ Corrigido |
| 21 | P2 | Missions | mission_manager.js | Sem error handling transacional na criação | ✅ Corrigido |

### Sessão 1 — NERV Audit Fix

| # | Severidade | Módulo | Arquivo | Bug | Status |
|---|-----------|--------|---------|-----|--------|
| 22 | P1 | Server | control.js | Mutations RBAC/preferences sem event emission | ✅ Corrigido |

### Sessão 2 — Bugs Encontrados e Corrigidos

| # | Severidade | Módulo | Arquivo | Bug | Status |
|---|-----------|--------|---------|-----|--------|
| 23 | P0 | Kernel | kernel.js | NERV instance não validada em createSsotGatewayKernel | ✅ Corrigido |
| 24 | P0 | Driver | factory.js | Temporary drivers nunca destruídos (resource leak) | ✅ Corrigido |
| 25 | P1 | Agent | agent_loop.js | step() sem timeout guard — _running fica preso se step() hang | ✅ Corrigido |
| 26 | P1 | Agent | agent_loop.js | _running flag nunca resetado se step() hang (timeout guard) | ✅ Corrigido |
| 27 | P1 | Kernel | execution_engine.js | Error swallowing em evaluate() sem try-catch | ✅ Corrigido |
| 28 | P1 | Kernel | execution_engine.js | Métodos assess/interpret/synthesize sem error handling | ✅ Corrigido |
| 29 | P1 | Server | lifecycle.js | Signal listeners não limpos após shutdown em delegated mode | ✅ Corrigido |
| 30 | P2 | Kernel | kernel.js | Hardcoded drain limits (100) sem configuração | ✅ Corrigido |
| 31 | P2 | Kernel | kernel.js | Hardcoded retention (1000) no telemetry | ✅ Corrigido |
| 32 | P2 | Driver | factory.js | temporaryDriversCreated sem counterpart destroyed | ✅ Corrigido |
| 33 | P2 | Agent | task_state_projector.js | 5 catch blocks silenciosos em state transitions | ✅ Corrigido |
| 34 | P1 | Agent | task_state_projector.js | Attempt RUNNING transition sem NERV event | ✅ Corrigido |
| 35 | P1 | Agent | task_state_projector.js | Attempt COMPLETED sem NERV event (success path) | ✅ Corrigido |
| 36 | P1 | Agent | task_orchestration_worker.js | Artifact insertion sem NERV event | ✅ Corrigido |
| 37 | P2 | Infra | pool_manager.js | Health check interval sem .unref() (process hang) | ✅ Corrigido |
| 38 | P1 | Core | forensics.js | Visual capture sem page guard + error handling | ✅ Corrigido |
| 39 | P0 | Core | infra_failure_policy.js | Null type não validado em _executeManeuver + _getPID silencioso | ✅ Corrigido |
| 40 | P1 | Infra | sqlite.js | Sem WAL checkpoint strategy + sem process exit handler | ✅ Corrigido |
| 41 | P1 | Core | config.js | Config.all retorna objeto mutável (bypass schema) | ✅ Corrigido |

---

## Aprimoramentos Sugeridos e Implementados

| # | Categoria | Descrição | Status |
|---|----------|-----------|--------|
| A1 | NERV | Shutdown lifecycle completo (7/7 subsistemas) | ✅ Implementado |
| A2 | NERV | Health listener limit (max 50 + warning) | ✅ Implementado |
| A3 | NERV | Event emission para mutations silenciosas (control.js) | ✅ Implementado |
| A4 | Cleanup | Remoção do módulo morto src/state/ | ✅ Implementado |
| A5 | Infra | Função pruneEvents com TTL configurável | ✅ Implementado |
| A6 | Observability | Logging em catch blocks silenciosos (task_repo, dashboard) | ✅ Implementado |
| A7 | NERV | Event emission para attempt transitions (STARTED, COMPLETED) | ✅ Implementado |
| A8 | NERV | Event emission para orchestration artifacts | ✅ Implementado |
| A9 | Observability | 5 silent catch blocks convertidos em logging no projector | ✅ Implementado |
| A10 | Resilience | Timeout guard no agent loop step() (30s default) | ✅ Implementado |
| A11 | Resilience | Auto-destruction timer para temporary drivers (5min) | ✅ Implementado |
| A12 | Observability | Error handling em execution engine (per-task, policy, interpret) | ✅ Implementado |

---

## Upgrades Sugeridos e Implementados

| # | Categoria | Descrição | Status |
|---|----------|-----------|--------|
| U1 | NERV-Only | Event emission em mutations silenciosas (control.js, projector, orchestrator) | ✅ Implementado |
| U2 | Kernel | Configuração externalizável de drain batch size e retention | ✅ Implementado |
| U3 | Agent | Timeout guard em agent_loop para step() (30s default, configurável) | ✅ Implementado |
| U4 | Driver | Auto-destruction timer para temporary drivers (5min) | ✅ Implementado |
| U5 | Kernel | NERV instance validation obrigatória | ✅ Implementado |
| U6 | Lifecycle | Signal listeners cleanup no shutdown (delegated mode fix) | ✅ Implementado |

---

## Análise NERV

### Estado Atual

- **56 ActionCodes** definidos no sistema
- **13 arquivos** importam de #nerv/ (uso correto)
- **34 arquivos** importam de #infra/db/ (bypass direto)
- **29 operações** de escrita direta no DB em agent/

### Avaliação: NERV-Only vs Realidade

O princípio arquitetural é "zero-coupling via NERV", mas na prática:
- **73% dos acessos ao DB** ignoram NERV completamente
- Agent workers escrevem diretamente no DB + emitem recordEvent() (parcial)
- Server controllers faziam mutations silenciosas (corrigido sessão 1)
- Kernel bridge importa diretamente de agent/ (cross-domain violation)

### Caminho Recomendado

Migração gradual, não big-bang:
1. ✅ Fase 1: Event emission em mutations silenciosas (feito)
2. 🔲 Fase 2: Extrair cross-domain import kernel→agent
3. 🔲 Fase 3: Adicionar NERV event emission nos agent workers que escrevem no DB
4. 🔲 Fase 4: Criar mediators para operações DB críticas

---

## Métricas de Progresso

| Métrica | Sessão 1 | Sessão 2 | Meta |
|---------|----------|----------|------|
| Bugs corrigidos | 22 | 41 | 45+ |
| Lint errors | 0 | 0 | 0 |
| Test pass rate | 798/800 | 798/800 | 798/800 |
| Silent catch blocks corrigidos | 6 | 13+ | 0 restantes |
| NERV subsystems cleaned | 7/7 | 7/7 | 7/7 |
| Silent DB mutations | 2 → 0 | 3+ → 0 | 0 |
| NERV events adicionados | 2 | 5 | — |
| Aprimoramentos implementados | 6 | 12 | — |
| Upgrades implementados | 0 | 6 | — |

---

*Atualizado em: 2 de março de 2026 — Sessão 2*
