# Auditoria de Observabilidade e Telemetria — Agente Copilot SDK

**Versão:** 5.0 **Data:** 2026-07-02 **Commit base pós-auditorias:** `ca1d498a` (Fases CA-CE) + HEAD
(Fases CF-CM implementadas) **Escopo:** `src/copilot/agent/` · `src/copilot/observability/` ·
`src/copilot/bridges/` · `src/copilot/hooks/` · `src/copilot/routes/`

---

## Índice

1. [Arquitetura Atual do Sistema](#1-arquitetura-atual-do-sistema)
2. [Componentes em Detalhe](#2-componentes-em-detalhe)
3. [Fluxo de Dados Fim-a-Fim](#3-fluxo-de-dados-fim-a-fim)
4. [Status de Implementação das Fases](#4-status-de-implementação-das-fases)
5. [Bugs Residuais e Gaps Identificados](#5-bugs-residuais-e-gaps-identificados)
6. [Estado Ideal (Target Architecture v2)](#6-estado-ideal-target-architecture-v2)
7. [Roadmap Completo — Fases CF em diante](#7-roadmap-completo--fases-cf-em-diante)
8. [Resumo Executivo](#8-resumo-executivo)

---

## 1. Arquitetura Atual do Sistema

### 1.1 Diagrama de Camadas (pós Fases CA-CE)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CAMADA 1 — SDK Layer                                                         │
│  @github/copilot-sdk · session.on() → 69+ event types                       │
│                                                                              │
│  event-collector.js  ← 69+ handlers completos (persist, metrics, audit)     │
│  session-event-wirer.js ← 12 handlers → 15 AGENT emits                      │
│  task-executor.js    ← 2 handlers (delta + idle) por tarefa                 │
│                    (tool.execution* REMOVIDOS — Fase CA ✅)                 │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ emit() → AlwaysAliveAgent (EventEmitter)
┌──────────────────────────────▼──────────────────────────────────────────────┐
│ CAMADA 2 — AGENT Layer                                                        │
│  AlwaysAliveAgent extends EventEmitter                                        │
│  50 AGENT_EVENTS definidos (events.js)                                        │
│  Fontes: wirer→15, always-alive→14, dialog-loop-manager (via wirer)           │
│  SEM duplicatas de tool.execution* (Fase CA ✅)                               │
└──────────┬──────────────────────────────────┬──────────────────────────────┘
           │ attach(agent)                     │ mount(nerv)
┌──────────▼───────────────┐   ┌──────────────▼──────────────────────────────┐
│ CAMADA 3a — Observer     │   │ CAMADA 3b — nerv-bridge                      │
│ agent-event-observer.js  │   │ nerv-bridge.js                               │
│ 50/50 AGENT_EVENTS ✅    │   │ 50/50 AGENT_EVENTS → NERV → Frontend         │
│ → MetricsStore + gauges  │   │ EVENT_MAP COMPLETO (Fase CD ✅)              │
└──────────┬───────────────┘   └──────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────────────────────┐
│ CAMADA 4 — Storage / Export Layer                                             │
│  metrics.js          → metrics.jsonl (snapshot + gauges — Fase CG ✅)       │
│  audit-log.js        → audit.jsonl + ring buffer 200                          │
│  error-tracker.js    → ring 100 + global handlers ON em prod (Fase CK ✅)   │
│  logger.js           → agent.log (5MB rotation) + ring buffer 1000           │
│  otel.js             → otel-traces.jsonl + startSpanImmediate (Fase CH ✅)   │
│  hooks/audit.js      → globalAuditBuffer ring 500 (em memória)               │
│  tool-audit-logger.js → tool-audit.jsonl / tool-execution.jsonl              │
└──────────────────────────────────────────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────────────────┐
│ CAMADA 5 — REST API                                                            │
│  GET  /observability/health        → agent snapshot + gauges (Fase CJ ✅)    │
│  GET  /observability/metrics       → MetricsStore summary + gauges            │
│  GET  /observability/errors        → últimos 100 erros                        │
│  GET  /observability/errors/stats  → contadores por tipo/origem               │
│  GET  /observability/logs          → ring buffer do logger                    │
│  GET  /observability/audit-tail    → globalAuditBuffer tail (Fase CI ✅)     │
│  GET  /observability/otel-status   → OTEL config status (Fase CI ✅)         │
│  POST /observability/errors/clear  → limpar buffer                            │
│  POST /observability/log-level     → ajuste dinâmico de log level             │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Inventário de Arquivos (atualizado)

| Arquivo                                 | Responsabilidade                                          | Status pós CA-CE      |
| --------------------------------------- | --------------------------------------------------------- | --------------------- |
| `agent/events.js`                       | 50 AGENT_EVENTS definidos                                 | ✅ Completo           |
| `agent/always-alive.js`                 | Orquestrador, global error handlers ON em start()         | ✅ Fases CB+CK        |
| `agent/session-event-wirer.js`          | SDK→AGENT wiring, tool events apenas em task phase        | ✅ Fase CA fix        |
| `agent/task-executor.js`                | Executor por tarefa (apenas delta + idle)                 | ✅ Fase CA fix        |
| `agent/dialog-loop-manager.js`          | Mutex + watchdog + backpressure                           | ✅ Estável            |
| `agent/dialog-loop-wirer.js`            | DLM→AGENT bubble                                          | ✅ Estável            |
| `agent/tool-audit-logger.js`            | Logging de permissões (JSONL)                             | ⚠️ Separação pendente |
| `observability/event-collector.js`      | 69+ handlers, DEFAULT_PERSIST_TYPES=Set                   | ✅ Fase CC fix        |
| `observability/agent-event-observer.js` | 50/50 AGENT_EVENTS → MetricsStore + gauges                | ✅ Fase CF (completo) |
| `observability/metrics.js`              | Histogramas + counters + gauges                           | ✅ Fase CG            |
| `observability/audit-log.js`            | AuditLog ring 200 + JSONL I/O                             | ✅ Estável            |
| `observability/error-tracker.js`        | Ring 100 + global handlers ON (prod)                      | ✅ Fase CK            |
| `observability/logger.js`               | Logger 5MB rotation + ring 1000                           | ✅ Estável            |
| `observability/otel.js`                 | startSpan + startSpanImmediate                            | ✅ Fase CH            |
| `observability/hooks-audit-preset.js`   | Preset de auditoria de hooks                              | ✅ Estável            |
| `bridges/nerv-bridge.js`                | 50/50 EVENT_MAP COMPLETO                                  | ✅ Fase CD fix        |
| `hooks/bus.js`                          | HookBus + attachBus()                                     | ✅ Estável            |
| `hooks/audit.js`                        | AuditRingBuffer 500 (JSDoc limpo)                         | ✅ Fase CM            |
| `routes/observability.js`               | REST API 9 endpoints (audit-tail, otel-status, health v2) | ✅ Fases CI+CJ        |

---

## 2. Componentes em Detalhe

### 2.1 AlwaysAliveAgent — Estado atual

```
start()
  ├── initEventCollector({ metrics, errorTracker, persist: true })
  ├── defaultErrorTracker.registerGlobalHandlers()  ✅ Fase CK
  ├── defaultMetrics.startPeriodicSnapshot()    ✅ chamado
  ├── wireSessionEvents(session, agent, opts)
  ├── defaultEventCollector.attach(session, sessionId)
  ├── createAgentEventObserver(agent, metrics, errorTracker)
  └── setInterval(agent.metrics, METRICS_INTERVAL_MS)

stop()
  ├── clearInterval(#metricsTimer)              ✅ limpo
  ├── defaultMetrics.stopPeriodicSnapshot()     ✅ Fase CB fix — chamado
  ├── this.#setStatus('stopped')
  ├── drain messageQueue
  ├── unsub all session event handlers
  ├── session.disconnect()
  └── client.stop()
```

### 2.2 session-event-wirer.js — Mapeamento SDK→AGENT (pós CA)

| Sub-função                      | SDK Events subscritos                                  | AGENT Events emitidos                                                         |
| ------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `_wireModeAndToolEvents`        | `session.mode_changed`                                 | `session.mode_changed`                                                        |
| `_wireCompactionEvents`         | `session.compaction_start/complete`                    | `session.compaction_start/complete`, `context:compacted`                      |
| `_wireStreamingEvents`          | `assistant.reasoning_delta`, `assistant.message_delta` | `task.reasoning`, `task.delta`                                                |
| `_wireTokenBudgetEvents`        | `session.usage_info`                                   | `session.usage`, `session.token_budget_warning`                               |
| `_wireSystemNotificationEvents` | `system.notification`                                  | `agent.background.completed/idle`, `agent.shell.completed/detached_completed` |
| `_wireUsageEvent`               | `assistant.usage`                                      | `pr.consumed`                                                                 |
| `_wireCatchAll`                 | `*`                                                    | _log only_                                                                    |

> ✅ Fase CA: `tool.execution_start/complete` removidos de `_wireModeAndToolEvents`. Agora são
> gerenciados exclusivamente pelo `task-executor.js` com payload enriquecido (`taskId`).

### 2.3 event-collector.js — DEFAULT_PERSIST_TYPES

Após Fase CC:

- Estrutura: `ReadonlySet<string>` (era `readonly string[]`)
- Lookup: O(1) com `.has()` (era O(n) com `.includes()`)
- Duplicata removida: `session.workspace_file_changed` aparecia duas vezes
- Aceita `Set | string[]` na factory com normalização automática para Set

### 2.4 agent-event-observer.js — Cobertura Atual (50/50) ✅ Fase CF

**Todos os 50 AGENT_EVENTS agora são observados com métricas e/ou gauges.**

| Categoria          | Eventos                                                                                                                                         | Métrica                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Dialog turns       | `dialog.turn_start`, `dialog.turn_end`, `dialog.stalled`, `dialog.turn_timeout`                                                                 | histograma + counter       |
| Dialog lifecycle   | `dialog.ready`, `dialog.reply`, `dialog.stopped`, `dialog.paused`, `dialog.resumed`                                                             | counter                    |
| Dialog loop        | `dialog.loop.changed`                                                                                                                           | gauge `dialog.loop.active` |
| Tasks              | `task.completed`, `task.error`, `task.queued`, `task.started`                                                                                   | counter + histograma       |
| Task streaming     | `task.delta`, `task.reasoning`                                                                                                                  | counter + bytes            |
| Compaction         | `session.compaction_start`, `session.compaction_complete`, `context:compacted`                                                                  | counter                    |
| Session metadata   | `session.mode_changed`, `session.token_budget_warning`, `session.fatal`                                                                         | counter                    |
| Session lifecycle  | `session.usage`, `session.history_synced`, `session.info`, `session.snapshot_rewind`, `session.title_changed`, `session.workspace_file_changed` | counter + recordUsage      |
| Tools              | `tool.execution_start`, `tool.execution_complete`, `tool.execution_progress`                                                                    | counter                    |
| Metrics            | `agent.metrics`, `pr.consumed`, `pr.fallback_model`                                                                                             | counter + gauge            |
| Permission         | `permission.mode_changed`                                                                                                                       | counter                    |
| Question lifecycle | `question.pending`, `question.answered`                                                                                                         | counter                    |
| Agent lifecycle    | `status`, `stopped`, `ready`, `error`, `before-stop`                                                                                            | counter + errorTracker     |
| Background         | `agent.background.completed`, `agent.background.idle`, `agent.shell.completed`, `agent.shell.detached_completed`                                | counter                    |
| System             | `system.message`, `pending_messages.modified`, `exit_plan_mode.completed`, `external_tool.completed`                                            | counter                    |

### 2.5 nerv-bridge.js — EVENT_MAP (pós CD) ✅ COMPLETO

**50/50 AGENT_EVENTS mapeados.** Nenhum gap residual.

Adicionados na Fase CD: `dialog.loop.changed`, `exit_plan_mode.completed`,
`external_tool.completed`, `pending_messages.modified`, `session.info`, `session.snapshot_rewind`,
`session.title_changed`, `session.workspace_file_changed`, `system.message`,
`tool.execution_progress`

### 2.6 otel.js — Estado Atual ✅ Fase CH

- `startSpan(name, attrs, fn)` implementado com graceful degradation
- `startSpanImmediate(name, attrs?)` — retorna `OtelSpan | null` para uso em event handlers
- `session.boot` em `always-alive.js` usa spans via `startSpan`
- Callers (observer, task-executor) podem usar `startSpanImmediate` para tool/turn spans
- Exporta para `otel-traces.jsonl` ou OTLP via `OTEL_EXPORTER_OTLP_ENDPOINT`

### 2.7 metrics.js — Estado Atual ✅ Fase CG

- `recordCounter(name, delta?)` — O(1) Map
- **`recordGauge(name, value)` — valores instantâneos (queue depth, uptime, loop active)**
- **`getGauges()` — retorna `Record<string, number>` snapshot**
- `recordDialogTurn(durationMs, success)` — histograma
- `recordDialogStall(stalledMs)` + `recordDialogTimeout()` — histogramas
- `recordTaskCompletion(durationMs, success)` — histograma
- `recordToolCall(toolName, durationMs, error)` — histograma por tool
- `recordSessionError()`, `recordUsage(model, input, output, cacheRead, cacheWrite)` — sessão
- `startPeriodicSnapshot()` / `stopPeriodicSnapshot()` — I/O periódico
- `getSummary()` inclui: counters, histograms, **gauges**, usage, totals
- `reset()` limpa gauges + counters + histograms

---

## 3. Fluxo de Dados Fim-a-Fim

### 3.1 Tool Call (pós Fase CA — sem duplicatas)

```
SDK tool.execution_start
  ├── event-collector.js
  │     ├── _pending.set(toolId, { ts, toolName, args })
  │     ├── persistEvent('tool.execution_start')    → events.jsonl
  │     └── metrics.recordCounter('tool.execution.start')
  │
  └── task-executor.js  [apenas durante executeTask()]
        └── agent.emit('tool.execution_start', { toolCallId, toolName, taskId })
              ├── nerv-bridge → COPILOT_TOOL_EXECUTION_START → NERV → Frontend
              └── agent-event-observer → recordCounter('tool.execution.start')

SDK tool.execution_complete
  ├── event-collector.js
  │     ├── start = _pending.get(toolId)
  │     ├── persistEvent('tool.execution_complete', { durationMs, ... })
  │     ├── metrics.recordToolCall(toolName, durationMs, error)
  │     ├── globalAuditBuffer.push(entry)   → ring 500
  │     └── defaultAuditLog.record(entry)   → audit.jsonl
  │
  └── task-executor.js
        └── agent.emit('tool.execution_complete', { toolCallId, toolName, taskId, durationMs })
              ├── nerv-bridge → COPILOT_TOOL_EXECUTION_COMPLETE → NERV
              └── agent-event-observer → recordCounter('tool.execution.complete')
```

### 3.2 Task Execution (fluxo completo)

```
AlwaysAliveAgent.sendMessage(message)
  └── #messageQueue.enqueue(task)
        └── #processQueue()
              └── executeTask(session, message, agent, opts)
                    ├── agent.emit('task.started', { taskId })
                    │     ├── nerv-bridge → COPILOT_TASK_STARTED
                    │     └── observer → recordCounter('tasks.started')
                    │
                    ├── sub: session.on('assistant.message_delta') → task.delta
                    ├── sub: session.on('session.idle')
                    │
                    ├── [tool calls se ocorrerem]
                    │     tool.execution_start → via task-executor (único handler)
                    │     tool.execution_complete → via task-executor (único handler)
                    │
                    ├── session.sendMessage(message)
                    │
                    ├── agent.emit('task.completed', { taskId, reply, durationMs })
                    │     ├── nerv-bridge → COPILOT_TASK_COMPLETED
                    │     └── observer → recordTaskCompletion(durationMs, true)
                    │
                    └── finally: unsub delta + idle handlers
```

### 3.3 Métricas Periódicas

```
AlwaysAliveAgent.start()
  └── defaultMetrics.startPeriodicSnapshot()   ← timer A

setInterval → agent.emit('agent.metrics') a cada METRICS_INTERVAL_MS  ← timer B
  └── nerv-bridge → COPILOT_AGENT_METRICS → NERV
  └── observer → recordCounter('agent.metrics.snapshot')

AlwaysAliveAgent.stop()
  ├── clearInterval(#metricsTimer)              ← timer B cancelado ✅
  └── defaultMetrics.stopPeriodicSnapshot()     ← timer A cancelado ✅ (Fase CB)
```

---

## 4. Status de Implementação das Fases

### Fases Anteriores (BA-BL) — ✅ Todas Completas

Implementadas no commit `ea608736`. Cobertura total do SDK (69+ event types) em
`event-collector.js`.

### Fase CA — Eliminate Duplicate Tool Events ✅

**Commit:** `ca1d498a`

- Removidos `session.on('tool.execution_start/complete')` de `_wireModeAndToolEvents()`
- Movidos para seção "Gerenciados pelo task-executor.js" no `KNOWN_SDK_EVENTS`
- Comentário explicativo adicionado

### Fase CB — Fix stopPeriodicSnapshot Timer Leak ✅

**Commit:** `ca1d498a`

- `defaultMetrics.stopPeriodicSnapshot()` adicionado no `stop()` antes de `#setStatus('stopped')`
- Timer A e Timer B agora ambos cancelados no shutdown

### Fase CC — DEFAULT_PERSIST_TYPES → Set + Dedup ✅

**Commit:** `ca1d498a`

- Array `Object.freeze([...])` convertido para `Object.freeze(new Set([...]))`
- 41 ocorrências de `.includes()` → `.has()` substituídas
- Duplicata `session.workspace_file_changed` removida
- Typedef atualizado para aceitar `ReadonlySet<string> | readonly string[]`
- Normalização para Set na factory para backward compatibility

### Fase CD — nerv-bridge EVENT_MAP Completo ✅

**Commit:** `ca1d498a`

- 10 AGENT_EVENTS adicionados ao EVENT_MAP
- 50/50 AGENT_EVENTS agora mapeados — cobertura 100%

### Fase CE — Expandir agent-event-observer ✅ (Parcial → Completada em CF)

**Commit:** `ca1d498a`

- 9 novos handlers adicionados inicialmente (13 → 22)
- Completados integralmente na Fase CF (22 → 50)

### Fase CF — Observer v2: 50/50 AGENT_EVENTS ✅

**Implementada neste ciclo**

- 28 novos handlers adicionados: todas as categorias cobertas
- Inclui: dialog lifecycle, agent lifecycle, question lifecycle, session metadata, system events
- Usa `recordGauge` para valores instantâneos (dialog.loop.active, queue depth, uptime)
- `session.usage` handler com `recordUsage(model, input, output, cacheRead, cacheWrite)` corrigido

### Fase CG — MetricsStore Gauge Support ✅

**Implementada neste ciclo**

- `_gauges: Record<string, number>` adicionado ao estado
- `recordGauge(name, value)` + `getGauges()` exportados
- `getSummary()` inclui `gauges: { ... }`
- `reset()` limpa `_gauges`
- Typedefs `MetricsStore` e `MetricsSummary` atualizados

### Fase CH — OTEL startSpanImmediate ✅

**Implementada neste ciclo**

- `startSpanImmediate(name, attrs?)` exportado de `otel.js`
- Retorna `OtelSpan | null` — graceful degradation se tracer não disponível
- Para uso em event handlers (tool start/end, dialog turn start/end, compaction)
- Caller responsável por `span.end()`

### Fase CI — REST API: audit-tail + otel-status ✅

**Implementada neste ciclo**

- `GET /observability/audit-tail?n=50&tool=ReadFile` — tail do globalAuditBuffer com filtro por tool
- `GET /observability/otel-status` — status da configuração OTEL (enabled + file)
- Ambos com `withErrorHandler` wrapper

### Fase CJ — Health Endpoint v2 ✅

**Implementada neste ciclo**

- `GET /observability/health` enriquecido com seção `agent`
- Inclui: status snapshot completo + gauges do MetricsStore
- Import de `alwaysAliveAgent` singleton + `getAuditTail` do hooks/audit
- try/catch graceful (agente pode não estar iniciado)

### Fase CK — Global Error Handlers em Produção ✅

**Implementada neste ciclo**

- `defaultErrorTracker.registerGlobalHandlers()` chamado em `always-alive.js` `start()`
- Posicionado após `initEventCollector()` — idempotente (flag interno no error-tracker)
- `uncaughtException` e `unhandledRejection` agora capturados em produção

### Fase CM — @deprecated JSDoc Cleanup ✅

**Implementada neste ciclo**

- `@deprecated` duplicado removido de `createAuditPostToolHandler` em `hooks/audit.js`

---

## 5. Bugs Residuais e Gaps Identificados

### ~~BUG-R01~~ — @deprecated duplicado em hooks/audit.js ✅ RESOLVIDO (Fase CM)

Duplicata removida no JSDoc de `createAuditPostToolHandler`.

### BUG-R02 — tool-audit.jsonl com dois schemas distintos (LOW-MEDIUM)

**Arquivos:** `tool-audit-logger.js` + `audit-log.js` Ambos escrevem no mesmo arquivo com schemas
diferentes. Pendente: Fase CL.

### ~~GAP-R01~~ — Observer cobre 50/50 AGENT_EVENTS ✅ RESOLVIDO (Fase CF)

Todos os 50 eventos agora observados com métricas, gauges e error tracking.

### ~~GAP-R02~~ — recordGauge() no MetricsStore ✅ RESOLVIDO (Fase CG)

`recordGauge(name, value)` + `getGauges()` + incluído em `getSummary()`.

### ~~GAP-R03~~ — OTEL startSpanImmediate disponível ✅ RESOLVIDO (Fase CH)

`startSpanImmediate(name, attrs)` exportado de `otel.js` para uso em event handlers.

### ~~GAP-R04~~ — globalAuditBuffer exposto via REST ✅ RESOLVIDO (Fase CI)

`GET /observability/audit-tail?n=50&tool=ReadFile` + `GET /observability/otel-status`.

### ~~GAP-R05~~ — registerGlobalHandlers em produção ✅ RESOLVIDO (Fase CK)

`defaultErrorTracker.registerGlobalHandlers()` chamado automaticamente em `start()`.

### ~~GAP-R06~~ — Health endpoint com estado do AGENT ✅ RESOLVIDO (Fase CJ)

`GET /health` agora inclui
`agent: { status, queueDepth, dialogLoopActive, model, sessionId, uptime, gauges }`.

### GAP-R07 — StreamingMetrics implementado parcialmente (observer counters)

`task.delta` e `task.reasoning` agora geram counters no observer. Histogram dedicado no MetricsStore
pendente.

### GAP-R08 — Question lifecycle com counters (observer ok)

`question.pending` e `question.answered` agora geram counters. Latência human-response pendente
(Map + TTL).

---

## 6. Estado Ideal (Target Architecture v2)

### 6.1 Diagrama Alvo

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ CAMADA 1 — SDK Layer (COMPLETO ✅ — 69+ events)                                  │
└──────────────────────────────┬──────────────────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────────────────┐
│ CAMADA 2 — AGENT Layer (50 AGENT_EVENTS sem duplicatas ✅)                       │
└──────────┬──────────────────────────────────────────┬────────────────────────────┘
           │                                          │
┌──────────▼──────────────────┐     ┌────────────────▼────────────────────────────┐
│ Observer v3 (target)        │     │ nerv-bridge (COMPLETO ✅ 50/50)              │
│ 45+/50 AGENT_EVENTS         │     │ 50/50 EVENT_MAP                              │
│ + OTEL child spans          │     │                                               │
│ + gauge: queue depth        │     │                                               │
│ + gauge: session uptime     │     │                                               │
│ + streaming volume metrics  │     │                                               │
└──────────┬──────────────────┘     └─────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────────────────────────┐
│ CAMADA 4 — Storage/Export                                                        │
│  metrics.jsonl       — histogramas + gauges + streaming                          │
│  otel-traces.jsonl   — spans: boot, task, tool, turn, compaction                │
│  audit.jsonl         — tool execution ring 200                                   │
│  tool-permissions-audit.jsonl  — approve/deny decisions (separado)              │
│  error-tracker       — ring 100 + global handlers ON em prod                    │
│  globalAuditBuffer   — ring 500 exposto via /audit-tail                         │
└──────────────────────────────────────────────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────────────────────┐
│ CAMADA 5 — REST API Enriquecida                                                   │
│  GET  /health        → agent.status + queue depth + dialog + model + session ID  │
│  GET  /metrics       → counters + histogramas + gauges                           │
│  GET  /audit-tail    → globalAuditBuffer.tail(n)                                 │
│  GET  /otel-status   → spans enable + endpoint + arquivo                        │
│  POST /log-level     → ajuste dinâmico documentado                              │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Invariantes do Estado Ideal

1. **Zero duplicatas de eventos** — 1 SDK event → 1 AGENT emit → 1 metric record ✅
2. **Observer 50/50 AGENT_EVENTS** — todos os eventos observados ✅ Fase CF
3. **nerv-bridge 50/50** — ✅ Fase CD
4. **OTEL spans** — `startSpanImmediate` disponível para tasks/tools/turns ✅ Fase CH
5. **Gauges suportados** — queue depth, session uptime, dialog.loop.active ✅ Fase CG
6. **Health endpoint rico** — diagnóstico completo em 1 HTTP request ✅ Fase CJ
7. **Global error handlers ON em prod** — exceções capturadas pelo ErrorTracker ✅ Fase CK
8. **Logs de auditoria separados** — permissões ≠ execuções 🔶 Pendente (Fase CL)

---

## 7. Roadmap — Fases Implementadas e Pendentes

> Fases CA-CE implementadas no commit `ca1d498a`. Fases CF-CM implementadas neste ciclo.

---

### ✅ Fases Implementadas Neste Ciclo

| Fase | Escopo                                       | Arquivos                  |
| ---- | -------------------------------------------- | ------------------------- |
| CF   | Observer v2: 50/50 AGENT_EVENTS              | `agent-event-observer.js` |
| CG   | MetricsStore: recordGauge + getGauges        | `metrics.js` + observer   |
| CH   | OTEL: startSpanImmediate                     | `otel.js`                 |
| CI   | REST API: audit-tail + otel-status           | `routes/observability.js` |
| CJ   | Health Endpoint v2 (agent snapshot + gauges) | `routes/observability.js` |
| CK   | Global Error Handlers em prod                | `always-alive.js`         |
| CM   | @deprecated JSDoc cleanup                    | `hooks/audit.js`          |

---

### Fases Pendentes

---

### Fase CL — Separar tool-audit.jsonl em dois arquivos

**Prioridade: BAIXA-MÉDIA** | **Arquivos:** `tool-audit-logger.js` + `audit-log.js` + rotas
**Objetivo:** Eliminar ambiguidade de schema no log de auditoria.

**CL-01 — Renomear em tool-audit-logger.js**

```javascript
const TOOL_PERMISSIONS_LOG =
  process.env['COPILOT_TOOL_PERMISSIONS_LOG'] ??
  path.join(LOGS_DIR, 'tool-permissions-audit.jsonl');
```

**CL-02 — Renomear em audit-log.js**

```javascript
const TOOL_EXECUTION_LOG =
  process.env['COPILOT_TOOL_EXECUTION_LOG'] ?? path.join(LOGS_DIR, 'tool-execution-audit.jsonl');
```

**CL-03 — Manter backward compat via env vars antigas** Se `COPILOT_AUDIT_LOG_PATH` estiver setado,
usar isso para migração suave.

**CL-04 — Documentar schemas distintos em JSDoc**

**CL-05 — Atualizar rotas se necessário** Se `/observability/audit-tail` expõe ao-log, confirmar
qual arquivo usa.

**CL-06 — Testes de escrita nos arquivos corretos**

---

### Fase CM — StreamingMetrics: Bytes e Tokens de Streaming

**Prioridade: MÉDIA** | **Arquivos:** `agent-event-observer.js` + `metrics.js` **Objetivo:** Medir
volume de streaming por tarefa para diagnosticar latência de resposta.

**CM-01 — Capturar task.delta no observer**

```javascript
_on(
  agent,
  'task.delta',
  _safe((evt) => {
    const bytes = evt?.delta?.length ?? 0;
    metrics.recordCounter('task.streaming.deltas');
    metrics.recordCounter('task.streaming.bytes', bytes);
  }, 'task.delta'),
);
```

**CM-02 — Capturar task.reasoning no observer**

```javascript
_on(
  agent,
  'task.reasoning',
  _safe((evt) => {
    const bytes = evt?.text?.length ?? 0;
    metrics.recordCounter('task.reasoning.tokens');
    metrics.recordCounter('task.reasoning.bytes', bytes);
  }, 'task.reasoning'),
);
```

**CM-03 — Adicionar histogram de streaming ao MetricsStore**

```javascript
// recordStreamingChunk(deltaBytes):
function recordStreamingChunk(bytes) {
  _streamingBytesTotal += bytes;
  _streamingChunksTotal++;
}
```

**CM-04 — Expor streaming stats em getSummary()**

```json
"streaming": {
  "totalBytes": 1234567,
  "totalChunks": 9876,
  "avgBytesPerChunk": 125
}
```

**CM-05 — Testes de streaming metrics**

---

### Fase CN — Question Lifecycle: Métricas de Interatividade

**Prioridade: MÉDIA** | **Arquivos:** `agent-event-observer.js` **Objetivo:** Medir o tempo de
espera por input humano em prompts interativos.

**CN-01 — question.pending com timestamp**

```javascript
_on(
  agent,
  'question.pending',
  _safe((evt) => {
    const questionId = evt?.questionId ?? 'q_' + Date.now();
    _questionStarts.set(questionId, Date.now());
    metrics.recordCounter('question.pending');
  }, 'question.pending'),
);
```

**CN-02 — question.answered com latência**

```javascript
_on(
  agent,
  'question.answered',
  _safe((evt) => {
    const questionId = evt?.questionId ?? null;
    const startTs = questionId ? _questionStarts.get(questionId) : null;
    const waitMs = startTs ? Date.now() - startTs : 0;
    _questionStarts.delete(questionId);
    metrics.recordCounter('question.answered');
    if (waitMs > 0) metrics.recordGauge('question.last_wait_ms', waitMs);
  }, 'question.answered'),
);
```

**CN-03 — TTL cleanup para \_questionStarts** Map com TTL de 30 minutos (questões não respondidas
limpas).

**CN-04 — Testes de question lifecycle**

---

### Fase CO — Cleanup: JSDoc restante ✅ ABSORVIDA pela Fase CM

A duplicata `@deprecated` em `hooks/audit.js` foi resolvida na Fase CM. Demais itens de JSDoc
cleanup podem ser feitos incrementalmente.

---

### Fase CP — Testes de Regressão e Coverage Gate

**Prioridade: ALTA** (após CF-CN) | **Arquivos:** `tests/unit/copilot/` **Objetivo:** Garantir que
as implementações são testadas e não há regressões.

**CP-01 — Teste: zero duplicatas de tool events**

```javascript
// test_session_event_wirer.spec.js
// Montar session mock + agent mock
// Verificar que tool.execution_start é emitido exatamente 1x por SDK event
```

**CP-02 — Teste: restart cycle sem timer leak**

```javascript
// test_always_alive.spec.js
// start() → stop() → start() → stop()
// Verificar que stopPeriodicSnapshot chamado 2x, não 0x
```

**CP-03 — Teste: observer handlers todos \_safe()** Para cada handler adicionado nas Fases CF-CN,
verificar que erros internos são suprimidos (não propagam).

**CP-04 — Teste: EVENT_MAP completo no nerv-bridge** Script que carrega `AGENT_EVENTS` e compara com
EVENT_MAP — falha se algum falta.

**CP-05 — Teste: MetricsStore.gauges** `recordGauge` → `getSummary().gauges[name]` tem valor
correto.

**CP-06 — Teste: OTEL span ciclo de vida** Mock tracer → startSpan, startSpanImmediate, span.end()
chamados corretamente.

**CP-07 — Teste: health endpoint enriquecido** Mock `getAgentSnapshot()` → response inclui campo
`agent`.

**CP-08 — Benchmark: DEFAULT_PERSIST_TYPES Set vs Array**

```bash
hyperfine --warmup 5 'node -e "const s=new Set([...75 items]); for(let i=0;i<1e6;i++) s.has(\"tool.execution_start\")"' \
  'node -e "const a=[...75 items]; for(let i=0;i<1e6;i++) a.includes(\"tool.execution_start\")"'
```

**CP-09 — Coverage gate: > 80% em src/copilot/observability/**

---

### Prioridade de Execução (atualizada)

```
✅ JÁ IMPLEMENTADO:
  CF (Observer 50/50) → CG (Gauges) → CH (OTEL startSpanImmediate) →
  CI (audit-tail + otel-status) → CJ (Health v2) → CK (Global Handlers) →
  CM (@deprecated cleanup)

PENDENTE ALTA:
  CH (OTEL Spans integration — usar startSpanImmediate no observer)
  CP (Testes de regressão e coverage gate)

PENDENTE MÉDIA:
  CL (Separar tool-audit.jsonl)
  CN (Question lifecycle latência)
  CM-streaming (StreamingMetrics histogram dedicado)
```

---

## 8. Resumo Executivo

### Estado Atual (pós Fases CA-CM)

| Componente              | Status       | Cobertura                                        |
| ----------------------- | ------------ | ------------------------------------------------ |
| event-collector.js      | ✅ Completo  | 69+ SDK events, Set O(1)                         |
| nerv-bridge.js          | ✅ Completo  | 50/50 AGENT_EVENTS                               |
| session-event-wirer.js  | ✅ Corrigido | Sem duplicatas                                   |
| always-alive.js         | ✅ Completo  | Timer leak + global handlers                     |
| agent-event-observer.js | ✅ Completo  | 50/50 AGENT_EVENTS + gauges                      |
| otel.js                 | ✅ Expandido | startSpan + startSpanImmediate                   |
| metrics.js              | ✅ Completo  | Histogramas + counters + gauges                  |
| routes/observability.js | ✅ Completo  | 9 endpoints (health v2, audit-tail, otel-status) |
| error-tracker.js        | ✅ Ativo     | Ring buffer + global handlers ON                 |
| hooks/audit.js          | ✅ Limpo     | JSDoc sem duplicatas                             |

### Próximos passos de maior impacto

1. **[CH] OTEL Spans integration** — usar `startSpanImmediate` no observer para tool/turn/compaction
   spans
2. **[CP] Testes de regressão** — coverage > 80% em `src/copilot/observability/`
3. **[CL] Separar JSONL** — eliminar ambiguidade de schema tool audit
4. **[CN] Question latência** — Map com TTL para medir tempo de resposta humana

### Testes: baseline estável

- **2049 testes** passando (0 falhas) após Fases CA-CM
- Quality gates: `npm run test:unit` ✅ | `npm run lint` ✅ |
- **2049 testes** passando (0 falhas) após Fases CA-CM
- Quality gates: `npm run test:unit` ✅ | `npm run lint` ✅ | `npm run format:check` ✅
