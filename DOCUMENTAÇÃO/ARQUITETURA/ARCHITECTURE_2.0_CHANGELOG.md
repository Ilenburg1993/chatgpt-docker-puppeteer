# Architecture 2.0 — Changelog Completo

> **Início**: 2 de março de 2026 **Status**: Em andamento **Sessões**: 3 + revisão de código (sessão 1 + sessão 2 +
> sessão 3 + correções de review)

---

## Índice

1. [Bugs Encontrados e Corrigidos](#bugs-encontrados-e-corrigidos)
2. [Aprimoramentos Sugeridos e Implementados](#aprimoramentos-sugeridos-e-implementados)
3. [Upgrades Sugeridos e Implementados](#upgrades-sugeridos-e-implementados)
4. [Correções de Review de Código](#correções-de-review-de-código)
5. [Análise NERV](#análise-nerv)
6. [Métricas de Progresso](#métricas-de-progresso)

---

## Bugs Encontrados e Corrigidos

### Sessão 1 — 21 Bugs Corrigidos

| #   | Severidade | Módulo       | Arquivo                      | Bug                                                    | Status       |
| --- | ---------- | ------------ | ---------------------------- | ------------------------------------------------------ | ------------ |
| 1   | P0         | NERV         | nerv.js                      | shutdown() limpava apenas 3/7 subsistemas              | ✅ Corrigido |
| 2   | P0         | Infra        | task_repo.js                 | JSON.parse em catch block silencioso                   | ✅ Corrigido |
| 3   | P0         | Server       | dashboard_events.js          | JSON.parse em catch block silencioso                   | ✅ Corrigido |
| 4   | P0         | Server       | dashboard_missions.js        | JSON.parse em catch block silencioso                   | ✅ Corrigido |
| 5   | P0         | Server       | dashboard_tasks.js           | JSON.parse em catch block silencioso                   | ✅ Corrigido |
| 6   | P1         | NERV         | health.js                    | Sem limite de listeners — memory leak potencial        | ✅ Corrigido |
| 7   | P1         | Kernel       | policy_engine.js             | Date.now() em vez do parâmetro `at` determinístico     | ✅ Corrigido |
| 8   | P1         | Infra        | mission_repo.js              | TOCTOU race no updateMission (optimistic lock)         | ✅ Corrigido |
| 9   | P1         | Logic        | adaptive.js                  | Dados perdidos no shutdown (debounce sem flush)        | ✅ Corrigido |
| 10  | P1         | Validation   | llm_judge.js                 | Score string "75" rejeitado como NaN                   | ✅ Corrigido |
| 11  | P1         | Infra        | events_repo.js               | Tabela de eventos cresce sem limite (sem TTL)          | ✅ Corrigido |
| 12  | P1         | Orchestrator | orchestrator_engine.js       | Lock failure retornava silenciosamente                 | ✅ Corrigido |
| 13  | P1         | Orchestrator | context_manager.js           | Token estimation chars/4 imprecisa + summary ilimitado | ✅ Corrigido |
| 14  | P1         | Orchestrator | checkpoint_manager.js        | Write não-atômico + sem validação no load              | ✅ Corrigido |
| 15  | P1         | Orchestrator | validation_service.js        | null score inflava resultado para 100                  | ✅ Corrigido |
| 16  | P1         | Agent        | mission_planner_processor.js | Budget check sem transação (race condition)            | ✅ Corrigido |
| 17  | P1         | Agent        | attempt_watchdog.js          | False positive — heartbeat NULL = stale imediato       | ✅ Corrigido |
| 18  | P2         | Agent        | queue_worker.js              | 3 catch blocks silenciosos sem logging                 | ✅ Corrigido |
| 19  | P2         | Missions     | workflow_generator.js        | structuredClone sem error handling + placeholders      | ✅ Corrigido |
| 20  | P2         | Integration  | error-classifier.mjs         | Case sensitivity no model fallback lookup              | ✅ Corrigido |
| 21  | P2         | Missions     | mission_manager.js           | Sem error handling transacional na criação             | ✅ Corrigido |

### Sessão 1 — NERV Audit Fix

| #   | Severidade | Módulo | Arquivo    | Bug                                           | Status       |
| --- | ---------- | ------ | ---------- | --------------------------------------------- | ------------ |
| 22  | P1         | Server | control.js | Mutations RBAC/preferences sem event emission | ✅ Corrigido |

### Sessão 2 — Bugs Encontrados e Corrigidos

| #   | Severidade | Módulo | Arquivo                      | Bug                                                               | Status       |
| --- | ---------- | ------ | ---------------------------- | ----------------------------------------------------------------- | ------------ |
| 23  | P0         | Kernel | kernel.js                    | NERV instance não validada em createSsotGatewayKernel             | ✅ Corrigido |
| 24  | P0         | Driver | factory.js                   | Temporary drivers nunca destruídos (resource leak)                | ✅ Corrigido |
| 25  | P1         | Agent  | agent_loop.js                | step() sem timeout guard — \_running fica preso se step() hang    | ✅ Corrigido |
| 26  | P1         | Agent  | agent_loop.js                | \_running flag nunca resetado se step() hang (timeout guard)      | ✅ Corrigido |
| 27  | P1         | Kernel | execution_engine.js          | Error swallowing em evaluate() sem try-catch                      | ✅ Corrigido |
| 28  | P1         | Kernel | execution_engine.js          | Métodos assess/interpret/synthesize sem error handling            | ✅ Corrigido |
| 29  | P1         | Server | lifecycle.js                 | Signal listeners não limpos após shutdown em delegated mode       | ✅ Corrigido |
| 30  | P2         | Kernel | kernel.js                    | Hardcoded drain limits (100) sem configuração                     | ✅ Corrigido |
| 31  | P2         | Kernel | kernel.js                    | Hardcoded retention (1000) no telemetry                           | ✅ Corrigido |
| 32  | P2         | Driver | factory.js                   | temporaryDriversCreated sem counterpart destroyed                 | ✅ Corrigido |
| 33  | P2         | Agent  | task_state_projector.js      | 5 catch blocks silenciosos em state transitions                   | ✅ Corrigido |
| 34  | P1         | Agent  | task_state_projector.js      | Attempt RUNNING transition sem NERV event                         | ✅ Corrigido |
| 35  | P1         | Agent  | task_state_projector.js      | Attempt COMPLETED sem NERV event (success path)                   | ✅ Corrigido |
| 36  | P1         | Agent  | task_orchestration_worker.js | Artifact insertion sem NERV event                                 | ✅ Corrigido |
| 37  | P2         | Infra  | pool_manager.js              | Health check interval sem .unref() (process hang)                 | ✅ Corrigido |
| 38  | P1         | Core   | forensics.js                 | Visual capture sem page guard + error handling                    | ✅ Corrigido |
| 39  | P0         | Core   | infra_failure_policy.js      | Null type não validado em \_executeManeuver + \_getPID silencioso | ✅ Corrigido |
| 40  | P1         | Infra  | sqlite.js                    | Sem WAL checkpoint strategy + sem process exit handler            | ✅ Corrigido |
| 41  | P1         | Core   | config.js                    | Config.all retorna objeto mutável (bypass schema)                 | ✅ Corrigido |

### Sessão 2 — Bugs de Segurança

| #   | Severidade | Módulo | Arquivo               | Bug                                                 | Status                       |
| --- | ---------- | ------ | --------------------- | --------------------------------------------------- | ---------------------------- |
| 42  | P0 🔴      | Server | tasks.js, missions.js | Unauthenticated requests → role:'admin' fallback    | ✅ Corrigido (→ 'anonymous') |
| 43  | P1         | Server | authorize.js          | Permission names expostos na resposta de erro       | ✅ Corrigido                 |
| 44  | P1         | Server | app.js                | Error handler expõe stack traces/mensagens internas | ✅ Corrigido                 |

### Sessão 2 — Bugs no NERV

| #   | Severidade | Módulo | Arquivo                | Bug                                               | Status       |
| --- | ---------- | ------ | ---------------------- | ------------------------------------------------- | ------------ |
| 45  | P1         | NERV   | correlation_store.js   | Correlations crescem sem limite (memory leak)     | ✅ Corrigido |
| 46  | P1         | NERV   | correlation_store.js   | MAX_ENTRIES apenas emite evento, não evicta       | ✅ Corrigido |
| 47  | P1         | NERV   | envelope.js            | ACK null payload causa TypeError em Object.keys() | ✅ Corrigido |
| 48  | P2         | NERV   | envelope_reader.js     | getTaskIdFromPayload sem type guard               | ✅ Corrigido |
| 49  | P1         | Driver | driver_nerv_adapter.js | progressListener sem error handling               | ✅ Corrigido |
| 50  | P1         | Kernel | kernel_nerv_bridge.js  | Cross-domain import de #agent/ — agora injectable | ✅ Corrigido |

### Sessão 3 — Dashboard/Server Bugs

| #   | Severidade | Módulo    | Arquivo            | Bug                                                    | Status                       |
| --- | ---------- | --------- | ------------------ | ------------------------------------------------------ | ---------------------------- |
| 51  | P1         | Server    | ssot_event_feed.js | Timer sem .unref() — bloqueia process exit             | ✅ Corrigido                 |
| 52  | P1         | Dashboard | TasksView.vue      | window.prompt — deprecated API, blocks UI, no fallback | ✅ Corrigido (→ Modal)       |
| 53  | P1         | Dashboard | Missions.vue       | window.prompt — deprecated API, blocks UI              | ✅ Corrigido (→ inline form) |
| 54  | P1         | Dashboard | TasksView.vue      | Bulk/quick actions sem try-catch — erros silenciosos   | ✅ Corrigido                 |
| 55  | P2         | Dashboard | TasksView.vue      | Sem loading state durante operações bulk               | ✅ Corrigido                 |
| 56  | P2         | Dashboard | Missions.vue       | Sem validação de campos obrigatórios no create form    | ✅ Corrigido                 |
| 57  | P2         | Dashboard | DashboardView.vue  | Sem realtime updates (useSsotRealtime não integrado)   | ✅ Corrigido                 |

---

## Aprimoramentos Sugeridos e Implementados

| #   | Categoria     | Descrição                                                        | Status          |
| --- | ------------- | ---------------------------------------------------------------- | --------------- |
| A1  | NERV          | Shutdown lifecycle completo (7/7 subsistemas)                    | ✅ Implementado |
| A2  | NERV          | Health listener limit (max 50 + warning)                         | ✅ Implementado |
| A3  | NERV          | Event emission para mutations silenciosas (control.js)           | ✅ Implementado |
| A4  | Cleanup       | Remoção do módulo morto src/state/                               | ✅ Implementado |
| A5  | Infra         | Função pruneEvents com TTL configurável                          | ✅ Implementado |
| A6  | Observability | Logging em catch blocks silenciosos (task_repo, dashboard)       | ✅ Implementado |
| A7  | NERV          | Event emission para attempt transitions (STARTED, COMPLETED)     | ✅ Implementado |
| A8  | NERV          | Event emission para orchestration artifacts                      | ✅ Implementado |
| A9  | Observability | 5 silent catch blocks convertidos em logging no projector        | ✅ Implementado |
| A10 | Resilience    | Timeout guard no agent loop step() (30s default)                 | ✅ Implementado |
| A11 | Resilience    | Auto-destruction timer para temporary drivers (5min)             | ✅ Implementado |
| A12 | Observability | Error handling em execution engine (per-task, policy, interpret) | ✅ Implementado |

### Sessão 3 — Aprimoramentos (Dashboard/Server)

| #   | Categoria | Descrição                                                | Status          |
| --- | --------- | -------------------------------------------------------- | --------------- |
| A13 | Server    | SSOTEventFeed timer .unref() (process hang prevention)   | ✅ Implementado |
| A14 | Dashboard | Replaced window.prompt with proper Modal dialogs         | ✅ Implementado |
| A15 | Dashboard | Added try-catch error handling to all API calls          | ✅ Implementado |
| A16 | Dashboard | Added loading states + disabled buttons during async ops | ✅ Implementado |
| A17 | Dashboard | Added toast feedback system for action results           | ✅ Implementado |
| A18 | Dashboard | SSOT realtime integration (useSsotRealtime) in all views | ✅ Implementado |
| A19 | Dashboard | Mission create form validation (required fields)         | ✅ Implementado |

---

## Upgrades Sugeridos e Implementados

| #   | Categoria | Descrição                                                                     | Status          |
| --- | --------- | ----------------------------------------------------------------------------- | --------------- |
| U1  | NERV-Only | Event emission em mutations silenciosas (control.js, projector, orchestrator) | ✅ Implementado |
| U2  | Kernel    | Configuração externalizável de drain batch size e retention                   | ✅ Implementado |
| U3  | Agent     | Timeout guard em agent_loop para step() (30s default, configurável)           | ✅ Implementado |
| U4  | Driver    | Auto-destruction timer para temporary drivers (5min)                          | ✅ Implementado |
| U5  | Kernel    | NERV instance validation obrigatória                                          | ✅ Implementado |
| U6  | Lifecycle | Signal listeners cleanup no shutdown (delegated mode fix)                     | ✅ Implementado |

### Sessão 3 — Upgrades (Dashboard/Server)

| #   | Categoria       | Descrição                                                        | Status          |
| --- | --------------- | ---------------------------------------------------------------- | --------------- |
| U7  | Dashboard Theme | Deep Space v3.0 dark theme (cyberpunk-sober)                     | ✅ Implementado |
| U8  | Dashboard Theme | surface-card CSS class, glow effects, stat-card borders          | ✅ Implementado |
| U9  | Dashboard Theme | Enhanced Tailwind config (nerv colors, glow shadows, animations) | ✅ Implementado |
| U10 | Dashboard       | DashboardView telemetry strip (8 metric cards + rates)           | ✅ Implementado |
| U11 | Dashboard       | DashboardView NERV status + uptime + system summary              | ✅ Implementado |
| U12 | Dashboard       | TasksView proper reason modal (replaces window.prompt)           | ✅ Implementado |
| U13 | Dashboard       | Mission create with autonomy descriptions + inline validation    | ✅ Implementado |

---

## Correções de Review de Código

Após Sessão 3, o PR passou por revisões automáticas (copilot, claude, codex) que identificaram e corrigiram issues adicionais.

### Correções Aplicadas em Review (commits b12b75c, 229bc24, revisão final)

| #   | Severidade | Módulo        | Arquivo                               | Problema                                                                                     | Status       |
| --- | ---------- | ------------- | ------------------------------------- | -------------------------------------------------------------------------------------------- | ------------ |
| R1  | P1         | Dashboard     | TasksView.vue                         | `confirmReasonAndExecute()` chamava callback async sem await/try-catch → unhandled rejection | ✅ Corrigido |
| R2  | P1         | Infra/DB      | mission_repo.js                       | Optimistic lock com `result.changes===0` não sinalizava conflito ao chamador                 | ✅ Corrigido |
| R3  | P2         | Repo          | arquivo `60` (raiz)                   | Log de devcontainer versionado acidentalmente                                                | ✅ Removido  |
| R4  | P1         | Dashboard     | TasksView.vue                         | Ações destrutivas executavam com 1 confirmação (regressão de segurança)                      | ✅ Corrigido |
| R5  | P2         | Dashboard     | Missions.vue                          | Label do option não correspondia ao enum `LLM_AUTO_APPROVE_WITH_BUDGET`                      | ✅ Corrigido |
| R6  | P2         | NERV          | correlation_store.js                  | Telemetria reportava `evicted: evictCount` mesmo quando menos itens existiam                 | ✅ Corrigido |
| R7  | P1         | NERV          | health.js                             | `onChange()` emitia `listener_overflow` repetidamente sem latch                              | ✅ Corrigido |
| R8  | P2         | Core          | config.js                             | Getter `.all` criava novo objeto + `Object.freeze()` a cada acesso (hot-path overhead)       | ✅ Corrigido |
| R9  | P1         | Orchestrator  | orchestrator_engine.js                | `task._lockFailed = true` mutava objeto frozen → possível TypeError                          | ✅ Corrigido |
| R10 | P1         | Agent         | mission_execution_service.js          | `transitionMission()` não propagava erro CONFLICT de `updateMission` ao chamador             | ✅ Corrigido |
| R11 | P1         | Agent         | mission_execution_service.js          | `updateMissionProgressState()` chamava `updateMission` sem try-catch → CONFLICT vazava       | ✅ Corrigido |
| R12 | P2         | Server/API    | controllers/missions.js               | Endpoint `POST /feedback` retornava 500 para erros CONFLICT em vez de 409                   | ✅ Corrigido |

### Detalhes das Correções

**R1 — async confirmReasonAndExecute (TasksView.vue)**
- Tornou a função `async` e adicionou `try-catch` para capturar rejeições do callback
- Estado é limpo em sequência correta para evitar dupla-execução em caso de erro

**R2 — Optimistic Lock CONFLICT em mission_repo.js**
- `updateMission()` agora lança `Error` com `code: 'CONFLICT'`, `status: 409` quando `result.changes === 0`
- Permite que camadas superiores detectem e tratem concorrência explicitamente

**R3 — Remoção do arquivo `60`**
- Arquivo era log de execução do devcontainer, não deve ser versionado
- Adicionado ao `.gitignore` para prevenir futuras inclusões acidentais

**R4 — 2-step confirmation em TasksView.vue**
- Fluxo de 2 confirmações restaurado: step 1 coleta motivo (modal), step 2 confirma ação com resumo
- Mantém consistência de segurança com TaskDetail/MissionDetail

**R5 — Label LLM_AUTO_APPROVE_WITH_BUDGET em Missions.vue**
- Label corrigido para exibir nome completo do enum: `LLM_AUTO_APPROVE_WITH_BUDGET — Automático com orçamento`

**R6 — actualEvictCount em correlation_store.js**
- Usa `Math.min(evictCount, sortedIds.length)` para emitir métrica precisa de evictions
- Evita confusão em diagnósticos quando há menos itens que o alvo de eviction

**R7 — Latch overflowWarningEmitted em health.js**
- Flag `overflowWarningEmitted` garante que o evento `nerv:health:listener_overflow` é emitido apenas uma vez
- Novos listeners acima do limite são recusados (retorna no-op unsubscribe)
- Latch é resetado quando listeners voltam abaixo do limite

**R8 — Frozen config cache em config.js**
- Campo `_frozenConfigCache` criado uma vez por reload e retornado em cada acesso ao getter `.all`
- Elimina overhead de `Object.freeze()` + spread no hot-path

**R9 — Sem mutação de frozen task em orchestrator_engine.js**
- Substituído `task._lockFailed = true` por `return { ...task, _lockFailed: true }`
- Evita TypeError em objetos frozen/imutáveis

**R10 — Propagação de CONFLICT em transitionMission**
- `transitionMission()` agora envolve `updateMission()` em try-catch
- Retorna `{ ok: false, statusCode: 409, code: 'MISSION_UPDATE_CONFLICT' }` para conflitos

**R11 — Propagação de CONFLICT em updateMissionProgressState**
- `updateMissionProgressState()` agora envolve `updateMission()` em try-catch
- Retorna `{ ok: false, statusCode: 409, code: 'MISSION_PROGRESS_CONFLICT' }` para conflitos

**R12 — Feedback endpoint retorna 409 para CONFLICT**
- Catch block do `POST /api/missions/:id/feedback` diferencia erro CONFLICT de erro interno
- Retorna 409 com mensagem clara quando detecta concorrência

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

| Métrica                        | Sessão 1 | Sessão 2 | Sessão 3 | Review Final | Meta        |
| ------------------------------ | -------- | -------- | -------- | ------------ | ----------- |
| Bugs corrigidos                | 22       | 50       | 57       | 69           | —           |
| Bugs de segurança corrigidos   | 0        | 3        | 3        | 3            | —           |
| Lint errors                    | 0        | 0        | 0        | 0            | 0           |
| Test pass rate                 | 798/800  | 798/800  | 798/800  | 798/800      | 798/800     |
| Silent catch blocks corrigidos | 6        | 13+      | 13+      | 14+          | 0 restantes |
| NERV subsystems cleaned        | 7/7      | 7/7      | 7/7      | 7/7          | 7/7         |
| Silent DB mutations            | 2 → 0    | 5+ → 0   | 5+ → 0   | 5+ → 0       | 0           |
| NERV events adicionados        | 2        | 5        | 5        | 5            | —           |
| Aprimoramentos implementados   | 6        | 12       | 19       | 19           | —           |
| Upgrades implementados         | 0        | 6        | 13       | 13           | —           |
| Dashboard bugs corrigidos      | 0        | 0        | 7        | 7            | —           |
| Dashboard upgrades             | 0        | 0        | 7        | 7            | —           |
| Correções de review            | 0        | 0        | 0        | 12           | —           |

---

_Atualizado em: 2 de março de 2026 — Revisão Final (PR pronto para squash and merge)_
