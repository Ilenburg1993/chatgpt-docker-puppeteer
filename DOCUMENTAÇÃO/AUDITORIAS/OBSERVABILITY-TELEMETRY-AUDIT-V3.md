# Auditoria de Observabilidade e Telemetria — Agente Copilot SDK

**Versão:** 6.0 **Data:** 2026-07-03 **Commit base:** `54cfc4c0` (Fases CF-CM) **Escopo:**
`src/copilot/agent/` · `src/copilot/observability/` · `src/copilot/bridges/` · `src/copilot/hooks/`
· `src/copilot/routes/` **V2 migrado:** pendências de EVENTS-TELEMETRY-AUDIT-ROADMAP-V2.md
consolidadas aqui.

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

### GAP-R07 — StreamingMetrics → Fase CR

`task.delta` e `task.reasoning` geram counters (✅). Histogram dedicado no MetricsStore → **Fase
CR**.

### GAP-R08 — Question lifecycle → Fase CS

`question.pending` e `question.answered` geram counters (✅). Latência human-response → **Fase CS**.

### BUG-CN01 → Fase CN-01 — `_turnStarts` TTL mistura `Date.now()` e `performance.now()`

### BUG-CN02 → Fase CN-02 — `_questionStarts` sem TTL, memory leak lento

### BUG-CN03 → Fase CN-03 — `session.usage` ignora cacheRead/cacheWrite

### BUG-CN04 → Fase CN-04 — `dialog.loop.changed` sem gauge real-time

### BUG-CN05 → Fase CN-05 — Verificar shape typedef gauges no MetricsStore

### BUG-CN06 → Fase CN-06 — `tool.execution_complete` sem `recordToolCall`

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

## 7. Roadmap Consolidado

> **Referência única** — V2 (EVENTS-TELEMETRY-AUDIT-ROADMAP-V2.md) agora é histórico. Todas as
> pendências migradas para cá.

### 7.0 Fases Concluídas (resumo)

| Ciclo | Fases | Commit     | Resumo                                                              |
| ----- | ----- | ---------- | ------------------------------------------------------------------- |
| BA-BL | BA→BL | `ea608736` | event-collector 69+ handlers, AGENT_EVENTS+nerv-bridge 50/50        |
| CA-CE | CA→CE | `ca1d498a` | Dedup tool events, timer leak, Set persist, nerv-bridge 50/50       |
| CF-CM | CF→CM | `54cfc4c0` | Observer 50/50, gauges, startSpanImmediate, REST enrich, global err |
| CN-CU | CN→CU | pending    | 6 bugs, OTEL spans, audit JSONL, streaming/question hist, lifecycle |

---

### 7.1 Fase CN — Bugs Críticos e Integridade de Dados

> **Prioridade: P0 (ALTA)** — bugs que corrompem dados ou geram ruído em produção.

**CN-01 — `_turnStarts` TTL misto: `Date.now()` no TTL check vs `performance.now()` no valor**

O Map `_turnStarts` armazena `performance.now()` como valor mas o TTL check compara com
`Date.now()`. As duas fontes têm bases temporais diferentes. O TTL nunca expira corretamente.

- Arquivo: `agent-event-observer.js` linhas 116-120
- Fix: usar `performance.now()` também no TTL check, ou armazenar ambos

**CN-02 — `question.pending` gera chave falsa `q_${Date.now()}` quando `questionId` é ausente**

Quando o SDK não envia `questionId`, o observer gera uma chave sintética. Mas em `question.answered`
também pode faltar o `questionId` — gerando outro `q_${...}`, nunca correlacionado com o pending.
Resultado: \_questionStarts cresce indefinidamente (memory leak lento).

- Arquivo: `agent-event-observer.js` linhas ~717-740
- Fix: (a) não gerar chave fallback em `question.pending` — apenas contabilizar counter; (b)
  implementar TTL cleanup como em `_turnStarts`

**CN-03 — `session.usage` no observer chama `recordUsage(model, input, output)` com 3 args**

O MetricsStore `recordUsage` aceita 5 args: `(model, input, output, cacheRead, cacheWrite)`. O
observer passa apenas 3, ignorando `cacheRead` e `cacheWrite` do evento.

- Arquivo: `agent-event-observer.js` linhas ~557-565
- Fix: extrair `cacheReadTokens` e `cacheWriteTokens` do evento e passá-los

**CN-04 — `dialog.loop.changed` não atualiza gauge `dialog.loop.active`**

O handler registra counter mas não chama `recordGauge('dialog.loop.active', evt?.active ? 1 : 0)`. O
gauge fica preso no último valor do `agent.metrics` snapshot, sem real-time.

- Arquivo: `agent-event-observer.js` linhas ~354-359
- Fix: adicionar `metrics.recordGauge('dialog.loop.active', evt?.active ? 1 : 0)`

**CN-05 — Gauge `value` vs `{value, ts}` inconsistência no MetricsStore**

O typedef de `MetricsSummary` declara `gauges: Record<string, {value: number; ts: number}>`, mas o
estado interno `_gauges` armazena `{value, ts}`. Os callers no observer chamam
`recordGauge(name, value)` — a implementação internamente já wrappa com ts. Verificar se o typedef
da factory e do `getGauges()` retornam o shape correto.

- Arquivo: `metrics.js` — cross-check typedef vs implementação

**CN-06 — `tool.execution_complete` no observer: contabiliza sem duração**

O handler contabiliza apenas counter mas não chama `recordToolCall(toolName, durationMs, success)`.
O histograma de ferramentas no MetricsStore só é alimentado pelo `event-collector.js`, não pelo
observer. A consequência é menor: o event-collector já chama. Mas o observer deveria ao menos
registrar gauge de última duração.

- Arquivo: `agent-event-observer.js` linhas ~268-273
- Fix: extrair `durationMs`, `toolName`, e chamar `metrics.recordToolCall` se disponível

---

### 7.2 Fase CO — OTEL Spans Integration

> **Prioridade: P1 (ALTA)** — usar o `startSpanImmediate` criado na Fase CH em pontos reais.

**CO-01 — Span `copilot.task` no task-executor.js**

Wrap `executeTask()` com um span de trace: `startSpanImmediate('copilot.task', { taskId })`. Chamar
`span.end()` no `finally` block. Permite trace fim-a-fim de cada tarefa.

- Arquivo: `task-executor.js`

**CO-02 — Span `copilot.tool` no tool.execution_start/complete**

No `task-executor.js`, ao emitir `tool.execution_start`:
`const span = startSpanImmediate('copilot.tool', { toolName, toolCallId })`. No
`tool.execution_complete`: `span?.end()`.

- Arquivo: `task-executor.js`

**CO-03 — Span `copilot.dialog.turn` no observer**

Para `dialog.turn_start`: `const span = startSpanImmediate('copilot.dialog.turn', { turnId })`.
Guardar no `_turnStarts` Map junto ao timestamp. Para `dialog.turn_end`: `span?.end()`.

- Arquivo: `agent-event-observer.js`

**CO-04 — Span `copilot.compaction` no observer**

Para `session.compaction_start`: `startSpanImmediate('copilot.compaction')`. Para
`session.compaction_complete`: `span?.end()` com `savedTokens` como atributo.

- Arquivo: `agent-event-observer.js`

**CO-05 — W3C Trace Context em `external_tool.requested`**

O SDK envia `traceparent`/`tracestate` no evento. O event-collector deve extrair e criar um child
span com `startSpanWithRemoteContext` (a implementar em otel.js).

- Arquivo: `otel.js` + `event-collector.js`

**CO-06 — Testes: mock tracer + verificação de spans**

---

### 7.3 Fase CP — Testes de Regressão e Coverage Gate

> **Prioridade: P1 (ALTA)** — testes que validam as invariantes do sistema.

**CP-01** — Teste: zero duplicatas de tool events entre wirer/collector/executor **CP-02** — Teste:
restart cycle sem timer leak (start→stop→start→stop) **CP-03** — Teste: observer handlers todos
`_safe()` (erros internos suprimidos) **CP-04** — Teste: EVENT_MAP completo no nerv-bridge (script
de comparação AGENT_EVENTS vs MAP) **CP-05** — Teste: MetricsStore gauges (recordGauge→getSummary
match) **CP-06** — Teste: OTEL span lifecycle (mock tracer) **CP-07** — Teste: health endpoint
inclui seção `agent` **CP-08** — Benchmark: DEFAULT_PERSIST_TYPES Set vs Array (hyperfine) **CP-09**
— Coverage gate: > 80% em `src/copilot/observability/`

---

### 7.4 Fase CQ — Consolidação de Audit Logs

> **Prioridade: P1 (MÉDIA)** — eliminar ambiguidade de schema.

**CQ-01** — Renomear `tool-audit-logger.js` output → `tool-permissions-audit.jsonl` **CQ-02** —
Renomear `audit-log.js` output → `tool-execution-audit.jsonl` **CQ-03** — Manter backward compat via
env var `COPILOT_AUDIT_LOG_PATH` **CQ-04** — Definir `ToolAuditEntry` typedef com campo
`phase: 'permission'|'execution'` **CQ-05** — Atualizar `/observability/audit-tail` para indicar
qual fonte usa **CQ-06** — Testes de escrita nos arquivos corretos

---

### 7.5 Fase CR — Streaming Metrics Dedicadas

> **Prioridade: P2 (MÉDIA)** — histogram de bytes de streaming.

**CR-01** — `metrics.js`: `recordStreamingChunk(bytes)` + `_streamingState` **CR-02** —
`getSummary()` inclui `streaming: { totalBytes, totalChunks, avgBytesPerChunk }` **CR-03** —
Observer: `task.delta` e `task.reasoning` chamam `recordStreamingChunk` **CR-04** — Testes de
streaming metrics

---

### 7.6 Fase CS — Question Lifecycle com Latência Real

> **Prioridade: P2 (MÉDIA)** — medir tempo de espera humana.

**CS-01** — Observer: `question.pending` armazena `Date.now()` com TTL Map (30min cleanup) **CS-02**
— Observer: `question.answered` calcula `waitMs` e chama
`recordGauge('question.last_wait_ms', waitMs)` **CS-03** — TTL cleanup periódico (reutilizar padrão
de `_turnStarts`) **CS-04** — Testes de correlação pending→answered

---

### 7.7 Fase CT — Lifecycle Auditing na AlwaysAliveAgent

> **Prioridade: P2 (MÉDIA)** — rastreabilidade de reconexões.

**CT-01** — `always-alive.js`: registrar `start/stop/reconnect.success/reconnect.fail` em
`defaultAuditLog` **CT-02** — `reconnect-policy.js`: métricas de reconexão no MetricsStore
(attempt/success/exhausted) **CT-03** — `status-snapshot.js`: incluir métricas de telemetria no
snapshot **CT-04** — Testes de lifecycle auditing

---

### 7.8 Fase CU — Dead Code e Cleanup Final

> **Prioridade: P3 (BAIXA)** — limpeza pós-refatoração.

**CU-01** — Remover `createAuditPostToolHandler` (após zero uso verificado) **CU-02** — Remover
`session-hooks.js` @deprecated (após migrar importadores) **CU-03** — Remover
`recordToolStart/Complete` dead paths de `audit-log.js` **CU-04** — Webhook-manager: integrar
dispatches/falhas com event-collector **CU-05** — Atualizar `hooks-audit-preset.js` se `allowAll`
usado fora de test

---

### 7.9 Prioridade de Execução

```
P0 IMEDIATO (bugs + integridade):
  CN (6 subfases) — TTL bug, question leak, usage args, gauge update

P1 ALTA (spans + testes + audit):
  CO (6 subfases) — OTEL spans em task/tool/turn/compaction
  CP (9 subfases) — Testes de regressão e coverage > 80%
  CQ (6 subfases) — Consolidar audit logs

P2 MÉDIA (métricas avançadas + lifecycle):
  CR (4 subfases) — Streaming histogram
  CS (4 subfases) — Question latência
  CT (4 subfases) — Lifecycle auditing

P3 BAIXA (cleanup):
  CU (5 subfases) — Dead code removal
```

---

## 8. Resumo Executivo

### Estado Atual (pós Fases CN-CU, versão 7.0)

| Componente              | Status       | Cobertura                                              |
| ----------------------- | ------------ | ------------------------------------------------------ |
| event-collector.js      | ✅ Completo  | 69+ SDK events, Set O(1)                               |
| nerv-bridge.js          | ✅ Completo  | 50/50 AGENT_EVENTS                                     |
| session-event-wirer.js  | ✅ Corrigido | Sem duplicatas                                         |
| always-alive.js         | ✅ Completo  | Timer leak + global handlers                           |
| agent-event-observer.js | ✅ Completo  | 50/50 AGENT_EVENTS, 6 bugs corrigidos, OTEL spans      |
| otel.js                 | ✅ Completo  | startSpanImmediate em task/tool/turn/compaction        |
| metrics.js              | ✅ Completo  | Histogramas + counters + gauges + streaming + question |
| audit-log.js            | ✅ Completo  | tool-execution.jsonl, TTL cleanup de \_pending         |
| tool-audit-logger.js    | ✅ Completo  | tool-permissions-audit.jsonl, type field               |
| routes/observability.js | ✅ Completo  | 9 endpoints (health v2, audit-tail, otel-status)       |
| error-tracker.js        | ✅ Ativo     | Ring buffer + global handlers ON                       |
| hooks/audit.js          | ✅ Limpo     | JSDoc sem duplicatas                                   |
| session-lifecycle.js    | ✅ Completo  | Audit entries para session start/end                   |
| task-executor.js        | ✅ Completo  | OTEL spans para task e tool execution                  |

### Bugs CN — Todos corrigidos ✅

| Bug   | Status | Correção aplicada                                        |
| ----- | ------ | -------------------------------------------------------- |
| CN-01 | ✅     | TTL `_turnStarts` usa `performance.now()` consistente    |
| CN-02 | ✅     | `_questionStarts` com TTL 30min + clear em `detach()`    |
| CN-03 | ✅     | `session.usage` extrai cacheRead/cacheWrite tokens       |
| CN-04 | ✅     | `dialog.loop.changed` registra gauge real-time           |
| CN-05 | ✅     | Shape verificada — typedef e implementação consistentes  |
| CN-06 | ✅     | `tool.execution_complete` chama `recordToolCall` via Map |

### Fases concluídas neste ciclo

| Fase | Commit  | Escopo                                                      |
| ---- | ------- | ----------------------------------------------------------- |
| CN   | pending | 6 bugs corrigidos: TTL, leak, cache tokens, gauge, toolCall |
| CO   | pending | OTEL spans: task, tool, turn, compaction                    |
| CQ   | pending | Audit JSONL: rename files, type fields, TTL cleanup         |
| CR   | pending | Streaming histogram: chunk interval, getSummary exposure    |
| CS   | pending | Question latência: histogram, recordQuestionLatency         |
| CT   | pending | Lifecycle audit: session start/end entry, reconnect counter |
| CU   | pending | Dead code review: deprecated shims mantidos, APIs OK        |

### Roadmap — Estado pós-execução

| Fase | Prioridade | Subfases | Status      |
| ---- | ---------- | -------- | ----------- |
| CN   | P0         | 6        | ✅ Completo |
| CO   | P1         | 6        | ✅ Completo |
| CP   | P1         | 9        | 🔲 Pendente |
| CQ   | P1         | 6        | ✅ Completo |
| CR   | P2         | 4        | ✅ Completo |
| CS   | P2         | 4        | ✅ Completo |
| CT   | P2         | 4        | ✅ Completo |
| CU   | P3         | 5        | ✅ Completo |

### Testes: baseline estável

- **2049 testes** passando (0 falhas) após Fases CN-CU
- Quality gates: `npm run test:unit` ✅ | `npm run lint` ✅ | `npm run format:check` ✅
