# Auditoria de Observabilidade e Telemetria — Agente Copilot SDK

**Versão:** 3.0
**Data:** 2026-06-27
**Escopo:** `src/copilot/agent/` + `src/copilot/observability/` + `src/copilot/bridges/` + `src/copilot/hooks/`
**Status:** Auditoria completa pós-Fases BA–BM

---

## Índice

1. [Arquitetura Atual do Sistema](#1-arquitetura-atual-do-sistema)
2. [Componentes em Detalhe](#2-componentes-em-detalhe)
3. [Fluxo de Dados Fim-a-Fim](#3-fluxo-de-dados-fim-a-fim)
4. [Bugs Identificados](#4-bugs-identificados)
5. [Gaps de Cobertura](#5-gaps-de-cobertura)
6. [Oportunidades de Upgrade](#6-oportunidades-de-upgrade)
7. [Estado Ideal (Target Architecture)](#7-estado-ideal-target-architecture)
8. [Roadmap Completo](#8-roadmap-completo)

---

## 1. Arquitetura Atual do Sistema

O sistema de observabilidade e telemetria do agente Copilot SDK opera em **quatro camadas interdependentes**:

```
┌────────────────────────────────────────────────────────────────────────┐
│ CAMADA 1 — SDK Layer                                                   │
│  @github/copilot-sdk · session.on('event', cb) → 69 event types       │
│  session-event-wirer.js (10 types)                                     │
│  event-collector.js  (69 types, complete coverage)                     │
│  task-executor.js    (4 types, per-task overlay)                       │
└────────────────────────┬───────────────────────────────────────────────┘
                         │ emit() to AGENT EventEmitter
┌────────────────────────▼───────────────────────────────────────────────┐
│ CAMADA 2 — AGENT Layer (AlwaysAliveAgent extends EventEmitter)         │
│  51 AGENT_EVENTS defined (events.js)                                   │
│  always-alive.js · dialog-loop-manager.js · dialog-loop-wirer.js      │
│  Sources: wirer→15, always-alive→14, dlm→10, dlw→0 (bubble only)     │
└──────────────┬──────────────────────────────────┬──────────────────────┘
               │ attach(agent)                     │ mount(nerv)
┌──────────────▼───────────────┐  ┌───────────────▼──────────────────────┐
│ CAMADA 3 — Observer Layer    │  │ CAMADA 3 — Bridge Layer              │
│  agent-event-observer.js     │  │  nerv-bridge.js                      │
│  13 events → MetricsStore    │  │  41 events → NERV → Frontend         │
└──────────────┬───────────────┘  └───────────────┬──────────────────────┘
               │                                   │
┌──────────────▼───────────────────────────────────▼──────────────────────┐
│ CAMADA 4 — Storage/Export Layer                                          │
│  metrics.js        → metrics.jsonl (periodic snapshot)                   │
│  audit-log.js      → audit.jsonl + tool-audit.jsonl (JSONL ring, 10MB)  │
│  error-tracker.js  → ring buffer 100 + byType/bySource counters          │
│  logger.js         → agent.log (5MB rotation) + ring buffer 1000        │
│  otel.js           → otel-traces.jsonl or OTLP endpoint                  │
│  hooks/audit.js    → globalAuditBuffer (ring 500 in-memory)              │
│  tool-audit-logger.js → tool-audit.jsonl (append, 10MB rotation)         │
└──────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Inventário de Arquivos

| Arquivo                                 | Responsabilidade                                | Linhas |
| --------------------------------------- | ----------------------------------------------- | ------ |
| `agent/events.js`                       | Definição de AGENT_EVENTS (51 eventos)          | ~120   |
| `agent/always-alive.js`                 | Orquestrador principal, AlwaysAliveAgent        | ~780   |
| `agent/session-event-wirer.js`          | Wiring SDK→AGENT (10 SDK events, 6 sub-funções) | ~500   |
| `agent/task-executor.js`                | Executor de tarefas (4 SDK.on per-task)         | ~250   |
| `agent/dialog-loop-manager.js`          | Mutex + watchdog + backpressure + protocolo     | ~400   |
| `agent/dialog-loop-wirer.js`            | Wiring DLM→AGENT (bubble events)                | ~100   |
| `agent/tool-audit-logger.js`            | Logging de permissão de tools (JSONL)           | ~180   |
| `observability/event-collector.js`      | 69 SDK event handlers + persist + metrics       | ~1300  |
| `observability/agent-event-observer.js` | 13 AGENT events → MetricsStore                  | ~450   |
| `observability/metrics.js`              | MetricsStore: histograms + counters + snapshots | ~430   |
| `observability/audit-log.js`            | AuditLog ring buffer 200 + JSONL I/O            | ~270   |
| `observability/error-tracker.js`        | ErrorTracker ring 100 + global handlers         | ~250   |
| `observability/logger.js`               | Logger 5MB rotation + ring 1000                 | ~200   |
| `observability/otel.js`                 | OTEL config + startSpan wrapper                 | ~120   |
| `observability/hooks-audit-preset.js`   | Preset de auditoria de hooks                    | ~145   |
| `bridges/nerv-bridge.js`                | 41 AGENT events → NERV (EVENT_MAP)              | ~200   |
| `hooks/bus.js`                          | HookBus EventEmitter + attachBus()              | ~170   |
| `hooks/audit.js`                        | AuditRingBuffer 500 + globalAuditBuffer         | ~200   |
| `routes/observability.js`               | REST API: health, metrics, errors, logs         | ~130   |

---

## 2. Componentes em Detalhe

### 2.1 AlwaysAliveAgent (always-alive.js)

Classe central que orquestra todo o ciclo de vida. Fluxo do `start()`:

```
start()
  ├── initEventCollector({ metrics, errorTracker, persist: true })
  ├── defaultMetrics.startPeriodicSnapshot()          ← ⚠️ NÃO parado no stop()
  ├── wireSessionEvents(session, agent, opts)
  ├── defaultEventCollector.attach(session, sessionId)
  ├── createAgentEventObserver(agent, metrics, errorTracker)
  ├── setInterval(agent.metrics, METRICS_INTERVAL_MS)  ← parado no stop() ✓
  └── this.emit('ready')
```

Fluxo do `stop()`:
```
stop()
  ├── clearInterval(#metricsTimer)                      ← ✓ limpo
  ├── this.#setStatus('stopped')
  ├── drain messageQueue
  ├── for unsub of #sessionEventUnsubscribers → unsub()
  ├── session.disconnect()
  ├── client.stop()
  └── this.emit('stopped')
  ← defaultMetrics.stopPeriodicSnapshot() AUSENTE ⚠️
```

### 2.2 session-event-wirer.js — Mapeamento SDK→AGENT

| SDK Event                     | AGENT Event emitido                        | Sub-função                      |
| ----------------------------- | ------------------------------------------ | ------------------------------- |
| `tool.execution_start`        | `tool.execution_start`                     | `_wireModeAndToolEvents`        |
| `tool.execution_complete`     | `tool.execution_complete`                  | `_wireModeAndToolEvents`        |
| `session.mode_changed`        | `session.mode_changed`                     | `_wireModeAndToolEvents`        |
| `session.compaction_start`    | `session.compaction_start`                 | `_wireCompactionEvents`         |
| `session.compaction_complete` | `session.compaction_complete`              | `_wireCompactionEvents`         |
| `session.compaction_complete` | `context:compacted`                        | `_wireCompactionEvents`         |
| `assistant.reasoning_delta`   | `task.reasoning`                           | `_wireStreamingEvents`          |
| `assistant.message_delta`     | `task.delta`                               | `_wireStreamingEvents`          |
| `session.usage_info`          | `session.usage`                            | `_wireTokenBudgetEvents`        |
| `session.usage_info`          | `session.token_budget_warning`             | `_wireTokenBudgetEvents`        |
| `assistant.usage`             | `pr.consumed`                              | `_wireUsageEvent`               |
| `system.notification`         | `agent.background.completed/idle`          | `_wireSystemNotificationEvents` |
| `system.notification`         | `agent.shell.completed/detached_completed` | `_wireSystemNotificationEvents` |

**⚠️ Sobreposição com task-executor.js:**
`task-executor.js` também assina `tool.execution_start` e `tool.execution_complete` via `session.on()` durante a execução de uma tarefa. Como ambos subscrevem o mesmo SDK event, e ambos resultam em `agent.emit('tool.execution_start/complete')`, durante uma tarefa o AGENT emite **dois** eventos por tool call.

### 2.3 event-collector.js — Cobertura Total SDK

O `EventCollector` assina **todos os 69 tipos SDK conhecidos** via `attach(session, sessionId)`. É o componente mais abrangente do sistema.

Responsabilidades por evento:
- **Persistência**: escreve no `events.jsonl` via `persistEvent()` para eventos em `DEFAULT_PERSIST_TYPES`
- **Métricas**: chama `metrics.recordXxx()` para tool calls, usage, erros, turn latência
- **Auditoria**: importa `globalAuditBuffer` de `hooks/audit.js` para `tool.execution_complete`
- **ErrorTracker**: alimenta `errorTracker.trackError()` em `session.error`
- **hookBus**: emite eventos no `defaultBus` para observadores externos

**Bug: `DEFAULT_PERSIST_TYPES` tem `session.workspace_file_changed` duplicado** — aparece nas linhas 140 e 180 do arquivo. O efeito é apenas cosmético (`.includes()` retorna `true` na primeira ocorrência), mas indica descuido na manutenção.

**Performance: `persistTypes.includes()` é O(n) linear** para cada evento. Com DEFAULT_PERSIST_TYPES tendo ~75 entradas, isso é ~37 comparações em média por evento a cada `attach()`. Deve ser convertido a `Set` para O(1).

### 2.4 agent-event-observer.js — Cobertura Parcial AGENT

O observer captura apenas **13 dos 51 AGENT_EVENTS**:

| Evento observado          | Ação                                             |
| ------------------------- | ------------------------------------------------ |
| `dialog.turn_start`       | inicia timer de turno (`_turnStarts` Map)        |
| `dialog.turn_end`         | calcula latência de turno → `recordDialogTurn()` |
| `dialog.stalled`          | → `recordDialogStall()`                          |
| `dialog.turn_timeout`     | → `recordDialogTimeout()`                        |
| `task.completed`          | → `recordTaskCompletion()`                       |
| `task.error`              | → `recordSessionError()`                         |
| `permission.mode_changed` | → `recordCounter('permission.mode_changed')`     |
| `session.fatal`           | → `recordSessionError()`                         |
| `pr.fallback_model`       | → `recordCounter('pr.fallback_model')`           |
| `tool.execution_start`    | inicia timer de tool                             |
| `tool.execution_complete` | calcula latência → `recordToolCall()`            |
| `agent.metrics`           | snapshot de métricas periódico                   |
| `pr.consumed`             | → `recordUsage()`                                |

**Eventos emitidos mas NÃO observados pelo observer** (38 de 51):
- `task.queued`, `task.started` — sem métricas de fila
- `dialog.ready`, `dialog.reply`, `dialog.stopped`, `dialog.paused`, `dialog.resumed`, `dialog.loop.changed` — sem observação do estado do dialog
- `session.compaction_start/complete` — sem contagem de compactações
- `session.mode_changed` — sem tracking de mudanças de modo
- `session.usage` — sem tracking via observer (só via event-collector)
- `session.token_budget_warning` — sem tracking de warnings de orçamento
- `session.history_synced` — sem rastreamento
- `session.fatal` — ✓ já observado
- `context:compacted` — sem contagem
- `agent.background.completed/idle`, `agent.shell.completed/detached_completed` — sem métricas de background
- `before-stop`, `error`, `stopped`, `ready`, `status` — lifecycle sem observação
- `question.pending/answered` — sem tracking de perguntas interativas
- `system.message`, `pending_messages.modified`, `exit_plan_mode.completed`, `external_tool.completed` — eventos de domínio sem observação

### 2.5 nerv-bridge.js — Cobertura do Roteamento

O `nerv-bridge.js` mapeia **41 AGENT_EVENTS** para o NERV bus (frontend).

**10 AGENT_EVENTS ausentes do EVENT_MAP**:

| Evento ausente                   | Impacto                                             |
| -------------------------------- | --------------------------------------------------- |
| `dialog.loop.changed`            | Frontend não sabe se dialog loop está ativo/inativo |
| `exit_plan_mode.completed`       | Frontend não sabe quando plan mode encerrou         |
| `external_tool.completed`        | Frontend não sabe sobre tools externas              |
| `pending_messages.modified`      | Frontend sem sync de mensagens pendentes            |
| `session.info`                   | Infos de sessão não chegam ao frontend              |
| `session.snapshot_rewind`        | Rewind de snapshot invisível ao frontend            |
| `session.title_changed`          | Título da sessão nunca atualiza no frontend         |
| `session.workspace_file_changed` | Mudanças de arquivo invisíveis ao frontend          |
| `system.message`                 | Mensagens de sistema sem roteamento                 |
| `tool.execution_progress`        | Progresso de tool calls não transmitido             |

### 2.6 hooks/audit.js — globalAuditBuffer

O `globalAuditBuffer` (capacidade 500) é alimentado por `event-collector.js` no handler de `tool.execution_complete`:

```javascript
// event-collector.js linha ~420
globalAuditBuffer.push({
    toolName, toolArgs, toolResult, sessionId, ts, durationMs
});
```

O `createAuditPostToolHandler()` em `hooks/audit.js` está marcado como `@deprecated` — a alimentação agora ocorre automaticamente via event-collector. Correto.

**Porém**: O endpoint `GET /observability/hooks-audit-tail` consultaria esse buffer via `getAuditTail(n)`. Verificando as rotas, esse endpoint **não existe** ainda em `routes/observability.js`.

### 2.7 tool-audit-logger.js — Auditoria de Permissão

Escreve decisões de permissão (approve/deny) no `logs/tool-audit.jsonl`. Separado e complementar ao `audit-log.js` (que registra tool starts/completes). Dois sistemas escrevem no mesmo arquivo com propósitos distintos — risco de confusão.

### 2.8 observability/routes

Endpoints existentes em `/api/sdk/observability/*`:
- `GET /health` — estado dos componentes
- `GET /metrics` — métricas agregadas
- `GET /errors` — erros recentes
- `GET /errors/stats` — contadores por tipo/origem
- `GET /logs` — últimas N entradas do ring buffer
- `POST /errors/clear` — limpar buffer
- `POST /log-level` — ajustar nível dinamicamente

**Ausente**: endpoint para `globalAuditBuffer` (hooks audit tail).

---

## 3. Fluxo de Dados Fim-a-Fim

### 3.1 Tool Call Execution (fluxo completo)

```
SDK tool.execution_start
  ├── event-collector.js
  │     ├── _pending.set(toolId, { ts, toolName })
  │     ├── persistEvent('tool.execution_start', ...)   [to events.jsonl]
  │     └── metrics.recordCounter('tool.execution.start')
  │
  ├── session-event-wirer.js
  │     └── agent.emit('tool.execution_start', payload)
  │           ├── nerv-bridge → safeEmit(NERV, 'COPILOT_TOOL_EXECUTION_START')
  │           └── agent-event-observer
  │                 └── _toolStarts.set(toolId, ts)  [timer start]
  │
  └── task-executor.js  ← ⚠️ DUPLICATE LISTENER
        └── agent.emit('tool.execution_start', payload)  ← SECOND emit
              ├── nerv-bridge → COPILOT_TOOL_EXECUTION_START (duplicate)
              └── agent-event-observer → _toolStarts.set(...) (overwrite)

SDK tool.execution_complete
  ├── event-collector.js
  │     ├── start = _pending.get(toolId)
  │     ├── durationMs = Date.now() - start.ts
  │     ├── persistEvent('tool.execution_complete', { durationMs, ... })
  │     ├── metrics.recordToolCall(toolName, durationMs, error)
  │     ├── globalAuditBuffer.push(entry)      [hooks/audit.js buffer]
  │     ├── defaultAuditLog.record(entry)      [observability/audit-log.js ring]
  │     └── metrics.recordCounter('tool.execution.complete')
  │
  ├── session-event-wirer.js
  │     └── agent.emit('tool.execution_complete', payload)
  │           ├── nerv-bridge → COPILOT_TOOL_EXECUTION_COMPLETE
  │           └── agent-event-observer
  │                 └── recordToolCall(toolName, durationMs)  [metrics]
  │
  └── task-executor.js  ← ⚠️ DUPLICATE LISTENER
        └── agent.emit('tool.execution_complete', payload)  ← SECOND emit
              ├── nerv-bridge → COPILOT_TOOL_EXECUTION_COMPLETE (duplicate)
              └── agent-event-observer → recordToolCall (duplicate metric)
```

### 3.2 Session Error (fluxo)

```
SDK session.error
  └── event-collector.js
        ├── persistEvent('session.error', ...)
        ├── metrics.recordSessionError(message, code)
        └── errorTracker.trackError(err, { source: 'sdk.session.error', sessionId })
            └── ring buffer 100 entries (in-memory)
```

### 3.3 Task Execution (fluxo)

```
AlwaysAliveAgent.sendMessage()
  └── messageQueue.enqueue(task)
        └── processQueue()
              └── executeTask(session, message, agent, opts)
                    ├── agent.emit('task.started', { taskId })
                    ├── sub: session.on('tool.execution_start') ← DUPLICATE
                    ├── sub: session.on('tool.execution_complete') ← DUPLICATE
                    ├── sub: session.on('assistant.message_delta') → task.delta
                    ├── sub: session.on('session.idle')
                    ├── session.sendMessage(message)
                    ├── agent.emit('task.completed', { taskId, reply })
                    └── finally: unsub all 4
```

---

## 4. Bugs Identificados

### BUG-01 — CRÍTICO: Duplicate Tool Events (Severidade: HIGH)

**Arquivo:** `src/copilot/agent/task-executor.js` + `src/copilot/agent/session-event-wirer.js`

**Problema:** Durante a execução de uma tarefa (`executeTask()`), o `task-executor.js` registra `session.on('tool.execution_start')` e `session.on('tool.execution_complete')`. O `session-event-wirer.js` já registrou os mesmos eventos no `wireSessionEvents()` durante o `start()`. Com dois listeners SDK ativos simultaneamente:

1. O AGENT emite `tool.execution_start` **duas vezes** por tool call
2. O `nerv-bridge` repassa ao NERV **duas vezes** → frontend recebe eventos duplicados
3. O `agent-event-observer` chama `recordToolCall()` **duas vezes** → métricas dobradas
4. Histogramas de latência de tool call ficam distorcidos (dois timers criados para o mesmo toolId)

**Reprodução:** Qualquer execução de tarefa que chame uma tool.

**Impacto:** Métricas de tool calls são imprecisas (dobradas). Dashboards frontend mostram o dobro de eventos. Latências no histograma podem ser corrompidas se o segundo timer sobrescreve o primeiro no `_toolStarts` Map.

**Fix:** Remover os `session.on('tool.execution_start/complete')` de `task-executor.js`. O `session-event-wirer.js` já cobre esses eventos de forma permanente. O `task-executor` não precisa re-assinar.

---

### BUG-02 — MÉDIO: Timer Leak no stopPeriodicSnapshot (Severidade: MEDIUM)

**Arquivo:** `src/copilot/agent/always-alive.js` linhas 409 / 525–577

**Problema:** `defaultMetrics.startPeriodicSnapshot()` é chamado no `start()` mas `defaultMetrics.stopPeriodicSnapshot()` nunca é chamado no `stop()`. Se o agente for reiniciado (`stop()` seguido de `start()`), dois snapshots periódicos rodam em paralelo — escrita concorrente no mesmo arquivo `metrics.jsonl`.

**Fix:** Chamar `defaultMetrics.stopPeriodicSnapshot()` no `stop()` antes de desconectar a sessão.

---

### BUG-03 — BAIXO: DEFAULT_PERSIST_TYPES com Duplicata (Severidade: LOW)

**Arquivo:** `src/copilot/observability/event-collector.js` linhas 140 e 180

**Problema:** `'session.workspace_file_changed'` aparece duas vezes no array `DEFAULT_PERSIST_TYPES`. O efeito funcional é nulo (`Array.includes()` para na primeira ocorrência), mas o array consome memória desnecessária e indica gap no processo de code review.

**Fix:** Remover a segunda ocorrência (linha 180, adicionada na Fase BF).

---

### BUG-04 — MÉDIO: dialog.loop.changed ausente do nerv-bridge (Severidade: MEDIUM)

**Arquivo:** `src/copilot/bridges/nerv-bridge.js`

**Problema:** `dialog.loop.changed` está definido em `AGENT_EVENTS` e é emitido por `always-alive.js` quando o dialog loop ativa/desativa. O evento **não está no EVENT_MAP** do `nerv-bridge`. O frontend nunca recebe notificação sobre mudanças no estado do dialog loop.

**Impacto:** UI pode mostrar estado stale do dialog loop (ativo/inativo incorreto).

**Fix:** Adicionar entrada no EVENT_MAP:
```javascript
{ event: 'dialog.loop.changed', actionCode: 'COPILOT_DIALOG_LOOP_CHANGED' }
```

---

### BUG-05 — BAIXO: @deprecated tag duplicada em hooks/audit.js (Severidade: LOW)

**Arquivo:** `src/copilot/hooks/audit.js` (JSDoc do `createAuditPostToolHandler`)

**Problema:** O JSDoc tem `@deprecated` escrito duas vezes no mesmo bloco de documentação. Cosmético, mas gera aviso em geradores de documentação.

**Fix:** Remover a tag duplicada.

---

### BUG-06 — BAIXO: tool-audit.jsonl escrito por dois sistemas distintos (Severidade: LOW)

**Arquivos:** `src/copilot/agent/tool-audit-logger.js` + `src/copilot/observability/audit-log.js`

**Problema:** Ambos escrevem no `logs/tool-audit.jsonl` com propósitos distintos:
- `tool-audit-logger.js`: registra decisões de permissão (`approved`/`denied`)
- `audit-log.js`: registra tool starts/completes com latência

Os registros têm schemas diferentes. Quem consome o arquivo pode confundir os dois tipos de entradas.

**Fix (curto prazo):** Documentar claramente os dois schemas no arquivo (via cabeçalho ou separação por sub-arquivo). A solução ideal (médio prazo) é separar em dois arquivos: `tool-permissions-audit.jsonl` e `tool-execution-audit.jsonl`.

---

## 5. Gaps de Cobertura

### GAP-01 — 38/51 AGENT_EVENTS sem observer metrics

O `agent-event-observer.js` captura apenas 13 dos 51 AGENT_EVENTS. Os 38 não observados incluem eventos de alto valor operacional:

| Grupo                | Eventos não observados                                                                                     | Valor                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **Task lifecycle**   | `task.queued`, `task.started`                                                                              | Alta — fila depth e throughput          |
| **Dialog state**     | `dialog.ready`, `dialog.reply`, `dialog.stopped`, `dialog.paused`, `dialog.resumed`, `dialog.loop.changed` | Alta — estado do dialog loop            |
| **Compaction**       | `session.compaction_start/complete`, `context:compacted`                                                   | Média — frequência de compactações      |
| **Mode/config**      | `session.mode_changed`, `session.token_budget_warning`                                                     | Alta — mudanças de configuração         |
| **Background tasks** | `agent.background.completed/idle`, `agent.shell.completed/detached_completed`                              | Média — background task metrics         |
| **Lifecycle**        | `before-stop`, `error`, `stopped`, `ready`, `status`                                                       | Alta — lifecycle tracking               |
| **Interactive**      | `question.pending/answered`                                                                                | Média — tracking de prompts interativos |
| **Domain**           | `system.message`, `pending_messages.modified`, `exit_plan_mode.completed`, `external_tool.completed`       | Média — eventos de domínio              |

### GAP-02 — 10 AGENT_EVENTS sem roteamento NERV

Ver Seção 2.5. Os mais críticos:
- `session.title_changed` — título nunca atualiza no frontend
- `tool.execution_progress` — progresso parcial de tools não exibido
- `dialog.loop.changed` — estado do dialog loop não sincronizado

### GAP-03 — Sem OTEL spans para tasks e tool calls

`otel.js` define `startSpan(name, attrs, fn)` mas only `session.boot` em `always-alive.js` usa. Não há spans para:
- Execução de task (início → fim, com taskId como atributo)
- Tool calls individuais (durações reais com correlação)
- Dialog turns
- Compactions

Sem spans, é impossível fazer tracing distribuído ou correlacionar latências por tarefa.

### GAP-04 — Sem endpoint para globalAuditBuffer

O `globalAuditBuffer` em `hooks/audit.js` (ring 500) armazena os últimos tool calls com payload completo. Ideal para debugging, mas não há endpoint REST expondo `getAuditTail(n)`. Os clientes precisam ler `events.jsonl` para obter o mesmo dado, com overhead de I/O.

### GAP-05 — ErrorTracker sem global handlers por default

`registerGlobalHandlers()` (que instala handlers para `uncaughtException` e `unhandledRejection`) tem `registerGlobalHandlers: false` por padrão. Erros não capturados pelo SDK podem passar silenciosamente sem registro no ErrorTracker.

### GAP-06 — MetricsStore sem gauge de queue depth

Há `recordCounter`, `recordToolCall`, etc., mas sem suporte a **gauges** (valores instantâneos). A profundidade da fila de mensagens (`#messageQueue.size`) é um gauge clássico que deveria ser exposto em métricas mas não tem tipo adequado.

### GAP-07 — Sem health endpoint unificado com dados do AGENT

O endpoint `GET /observability/health` agrega métricas, errors e otel. Mas não inclui:
- Status do agente (`status`, `ready`, `stopped`)
- Profundidade da fila
- Estado do dialog loop
- Modelo ativo e fallback pendente

### GAP-08 — Log level reconfiguration não exposta de forma completa

`POST /observability/log-level` existe (deduzido da listagem de rotas), mas não está documentado no swagger/JSDoc das rotas.

### GAP-09 — globalAuditBuffer feed duplicado potencial

O `event-collector.js` alimenta o `globalAuditBuffer` em `tool.execution_complete`. Mas se `createAuditPostToolHandler()` ainda for usado em algum path legado via `hooks.onPostToolUse`, o buffer receberá um push duplo para o mesmo tool call.

### GAP-10 — Sem métricas de streaming (reasoning_delta / message_delta)

O event-collector registra `session.streaming_delta` com counters de tamanho, mas os `assistant.reasoning_delta` e `assistant.message_delta` (emitidos pelo session-event-wirer diretamente na emissão de `task.reasoning`/`task.delta`) não geram métricas separadas de volume de streaming.

---

## 6. Oportunidades de Upgrade

### UP-01 — DEFAULT_PERSIST_TYPES como Set (Performance)

Converter o array `DEFAULT_PERSIST_TYPES` para um `Set` elimina a varredura O(n) em `persistTypes.includes()` para cada evento recebido. Com 75+ entradas no array e dezenas de eventos por segundo em carga, o ganho é significativo.

```javascript
// Antes (O(n)):
if (persist && persistTypes.includes(eventType)) { ... }

// Depois (O(1)):
const persistTypesSet = new Set(DEFAULT_PERSIST_TYPES);
if (persist && persistTypesSet.has(eventType)) { ... }
```

### UP-02 — OTEL Spans para Tasks e Tool Calls

Adicionar `startSpan()` em:
1. `executeTask()` → span `copilot.task` com atributos `taskId`, `messageLength`
2. `tool.execution_start/complete` no observer → span `copilot.tool` com `toolName`, `durationMs`, `error`
3. Conectar via `context propagation` para correlação de traces

### UP-03 — Métricas Histogramáticas de Filas

Adicionar `recordGauge()` ao `MetricsStore` para:
- `agent.queue.depth` — profundidade atual da fila de mensagens
- `dialog.queue.depth` — profundidade da fila do dialog loop
- `agent.session.uptime` — segundos desde o `ready`

### UP-04 — Endpoint /observability/audit-tail

Expor `globalAuditBuffer.tail(n)` via `GET /observability/audit-tail?n=50` para debugging de tool calls sem precisar ler o arquivo JSONL.

### UP-05 — Agent Status em /observability/health

Enriquecer o health endpoint com estado do agente:
```json
{
  "agent": {
    "status": "running",
    "queueDepth": 0,
    "dialogActive": true,
    "model": "gpt-4o",
    "dialogLoopActive": true,
    "sessionId": "abc-123"
  }
}
```

### UP-06 — Observer para task.queued/task.started (Queue Metrics)

Adicionar ao `agent-event-observer`:
```javascript
_on(agent, 'task.queued', () => metrics.recordCounter('task.queued'));
_on(agent, 'task.started', () => metrics.recordCounter('task.started'));
```

Isso permite calcular `task throughput = started / queued` e detectar backlog crescente.

### UP-07 — Separação de tool-audit.jsonl em dois arquivos

Separar os dois schemas de `tool-audit.jsonl`:
- `tool-permissions-audit.jsonl` → decisões approve/deny (tool-audit-logger.js)
- `tool-execution-audit.jsonl` → starts/completes com latência (audit-log.js)

### UP-08 — registerGlobalHandlers: true por default em produção

Habilitar automaticamente `errorTracker.registerGlobalHandlers()` quando `NODE_ENV !== 'test'`:
```javascript
// always-alive.js start()
if (process.env['NODE_ENV'] !== 'test') {
    defaultErrorTracker.registerGlobalHandlers();
}
```

### UP-09 — Completar EVENT_MAP do nerv-bridge

Adicionar os 10 AGENT_EVENTS ausentes ao EVENT_MAP com actionCodes padronizados.

### UP-10 — Métricas de compaction e token budget

No `agent-event-observer`, adicionar handlers para:
- `session.compaction_start/complete` → `recordCounter('session.compaction')`
- `session.token_budget_warning` → `recordCounter('session.token_budget_warning.{severity}')`
- `context:compacted` → `recordCounter('context.compacted')`

---

## 7. Estado Ideal (Target Architecture)

### 7.1 Camadas Refinadas

```
┌─────────────────────────────────────────────────────────────────────────┐
│ SDK Layer (COMPLETO — 69 events → event-collector.js, 100% coverage)   │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────────┐
│ AGENT Layer (AlwaysAliveAgent EventEmitter)                              │
│  51 AGENT_EVENTS bem definidos, emitidos por fontes corretas             │
│  SEM duplicatas de tool.execution*                                       │
└──────────┬────────────────────────────────────────────┬─────────────────┘
           │ attach(agent)                               │ mount(nerv)
┌──────────▼──────────────┐               ┌─────────────▼─────────────────┐
│ Observer v2             │               │ nerv-bridge v2                │
│ 45/51 events → metrics  │               │ 51/51 events → NERV           │
│ + OTEL spans            │               │ (todos os AGENT_EVENTS)       │
│ + gauge queue depth     │               └───────────────────────────────┘
│ + compaction counters   │
│ + token budget counters │
└──────────┬──────────────┘
           │
┌──────────▼──────────────────────────────────────────────────────────────┐
│ Storage/Export Layer                                                      │
│  metrics.jsonl (periodic) + histogram de gauges                          │
│  audit.jsonl (ring 200) + tool-permissions-audit.jsonl (separado)       │
│  error-tracker (ring 100, global handlers ON em prod)                   │
│  otel-traces.jsonl (spans por task + tool + turn)                       │
│  globalAuditBuffer (ring 500, exposto via /audit-tail)                  │
└──────────────────────────────────────────────────────────────────────────┘
         │
┌────────▼────────────────────────────────────────────────────────────────┐
│ REST API Enriched                                                         │
│  GET /health → status agent + queue + dialog + model                    │
│  GET /metrics → histogramas + gauges + counters                         │
│  GET /audit-tail → globalAuditBuffer.tail(n)                            │
│  GET /otel-status → spans habilitados, endpoint, arquivo                │
│  POST /log-level → ajuste dinâmico documentado                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Invariantes do Estado Ideal

1. **Zero duplicatas**: Cada SDK event → exatamente 1 AGENT emit → exatamente 1 metric record
2. **Cobertura AGENT completa**: Todo AGENT_EVENT é observado por pelo menos 1 handler (observer OU nerv-bridge)
3. **OTEL abrangente**: Tasks, tool calls e dialog turns têm spans correlacionados
4. **Health endpoint rico**: Qualquer agente pode ser diagnosticado com 1 request HTTP
5. **tool-audit separado**: Permissões e execuções em arquivos distintos, sem ambiguidade de schema
6. **Global error handlers ativos**: Exceções não capturadas chegam ao `errorTracker` em produção
7. **Persistent types como Set**: O(1) lookup em todos os event handlers

---

## 8. Roadmap Completo

### Fase CA — Bug Crítico: Eliminar Duplicate Tool Events
**Prioridade: CRÍTICA** | **Estimativa de risco: BAIXO** | **Arquivos:** task-executor.js

**CA-01:** Remover `session.on('tool.execution_start')` de `task-executor.js`
**CA-02:** Remover `session.on('tool.execution_complete')` de `task-executor.js`
**CA-03:** Verificar que `session-event-wirer.js` já cobre ambos permanentemente
**CA-04:** Atualizar testes de `task-executor.js` que dependem desses listeners
**CA-05:** Rodar `npm run test:unit` + `npm run test:integration` e validar

---

### Fase CB — Bug: Timer Leak stopPeriodicSnapshot
**Prioridade: ALTA** | **Estimativa de risco: MÍNIMO** | **Arquivos:** always-alive.js

**CB-01:** No `stop()` do AlwaysAliveAgent, adicionar `defaultMetrics.stopPeriodicSnapshot()` antes de `this.#setStatus('stopped')`
**CB-02:** Verificar restart cycle (stop → start) não acumula timers
**CB-03:** Adicionar teste unitário de restart cycle

---

### Fase CC — Bug: DEFAULT_PERSIST_TYPES Duplicata + Set Conversion (Performance)
**Prioridade: MÉDIA** | **Arquivos:** event-collector.js

**CC-01:** Remover `'session.workspace_file_changed'` duplicado da seção "Fase BF" (linha 180)
**CC-02:** Converter `DEFAULT_PERSIST_TYPES` de `Array.freeze()` para `new Set()`
**CC-03:** Atualizar todas as referências de `.includes()` para `.has()`
**CC-04:** Manter o `persistTypes` param da factory como `Set | string[]` (com conversão automática)
**CC-05:** Atualizar testes de event-collector

---

### Fase CD — Bug: dialog.loop.changed no nerv-bridge
**Prioridade: MÉDIA** | **Arquivos:** nerv-bridge.js

**CD-01:** Adicionar `{ event: 'dialog.loop.changed', actionCode: 'COPILOT_DIALOG_LOOP_CHANGED' }` ao EVENT_MAP
**CD-02:** Verificar que `dialog.loop.changed` não é HIGH_FREQUENCY_EVENT
**CD-03:** Adicionar teste de mapeamento

---

### Fase CE — Completar EVENT_MAP nerv-bridge (9 eventos restantes)
**Prioridade: MÉDIA** | **Arquivos:** nerv-bridge.js

| Evento                           | actionCode proposto                      |
| -------------------------------- | ---------------------------------------- |
| `exit_plan_mode.completed`       | `COPILOT_PLAN_MODE_EXITED`               |
| `external_tool.completed`        | `COPILOT_EXTERNAL_TOOL_COMPLETED`        |
| `pending_messages.modified`      | `COPILOT_PENDING_MESSAGES_MODIFIED`      |
| `session.info`                   | `COPILOT_SESSION_INFO`                   |
| `session.snapshot_rewind`        | `COPILOT_SESSION_SNAPSHOT_REWIND`        |
| `session.title_changed`          | `COPILOT_SESSION_TITLE_CHANGED`          |
| `session.workspace_file_changed` | `COPILOT_SESSION_WORKSPACE_FILE_CHANGED` |
| `system.message`                 | `COPILOT_SYSTEM_MESSAGE`                 |
| `tool.execution_progress`        | `COPILOT_TOOL_EXECUTION_PROGRESS`        |

**CE-01 a CE-09:** Adicionar cada entrada acima ao EVENT_MAP
**CE-10:** Remover de HIGH_FREQUENCY_EVENTS se indevidamente marcados
**CE-11:** Teste de cobertura completa do EVENT_MAP

---

### Fase CF — Observer v2: Métricas de Task Queue e Background
**Prioridade: ALTA** | **Arquivos:** agent-event-observer.js

**CF-01:** Adicionar handler `task.queued` → `recordCounter('task.queued')`
**CF-02:** Adicionar handler `task.started` → `recordCounter('task.started')`
**CF-03:** Adicionar handler `session.compaction_start` → `recordCounter('session.compaction.start')`
**CF-04:** Adicionar handler `session.compaction_complete` → `recordCounter('session.compaction.complete')`
**CF-05:** Adicionar handler `context:compacted` → `recordCounter('context.compacted')`
**CF-06:** Adicionar handler `session.token_budget_warning` → `recordCounter('session.token_budget_warning')`
**CF-07:** Adicionar handler `session.mode_changed` → `recordCounter('session.mode_changed')`
**CF-08:** Adicionar handler `agent.background.completed` → `recordCounter('agent.background.completed')`
**CF-09:** Adicionar handler `agent.shell.completed` → `recordCounter('agent.shell.completed')`
**CF-10:** Adicionar handler `before-stop` para registrar shutdowns
**CF-11:** Testes unitários para todos os novos handlers

---

### Fase CG — MetricsStore: Gauge Support
**Prioridade: ALTA** | **Arquivos:** metrics.js + agent-event-observer.js + always-alive.js

**CG-01:** Adicionar `recordGauge(name, value)` ao `MetricsStore` (typedef + implementação)
**CG-02:** Adicionar `getGauges()` ao `getSummary()` output
**CG-03:** No `agent.metrics` handler do observer, emitir:
  - `agent.queue.depth` do `getQueueDepth()` do agent
  - `dialog.queue.depth` do dialog loop manager
**CG-04:** Expor `getQueueDepth()` em `AlwaysAliveAgent`
**CG-05:** Atualizar rota `/metrics` para incluir gauges
**CG-06:** Atualizar testes de MetricsStore

---

### Fase CH — OTEL Spans para Tasks e Tool Calls
**Prioridade: MÉDIA-ALTA** | **Arquivos:** otel.js + task-executor.js + agent-event-observer.js

**CH-01:** Adicionar `SpanContext` typedef e propagação de context ao `otel.js`
**CH-02:** Envolver `executeTask()` em `startSpan('copilot.task', { taskId })` → span aberto enquanto task roda
**CH-03:** No observer, ao detectar `tool.execution_start/complete`, criar span filho `copilot.tool` com `toolName`, `durationMs`, `error`
**CH-04:** Adicionar span `copilot.dialog.turn` para `dialog.turn_start/end`
**CH-05:** Garantir que spans são finalizados mesmo em caso de erro/timeout
**CH-06:** Documentar como correlacionar spans com `taskId` no `events.jsonl`

---

### Fase CI — REST API: audit-tail endpoint
**Prioridade: MÉDIA** | **Arquivos:** routes/observability.js

**CI-01:** Adicionar `GET /observability/audit-tail?n=50` usando `getAuditTail(n)` de `hooks/audit.js`
**CI-02:** Adicionar query param `?sessionId=...` para filtrar por sessão
**CI-03:** Documentar no JSDoc da rota
**CI-04:** Teste de rota

---

### Fase CJ — Health Endpoint Enriquecido com Estado do Agent
**Prioridade: ALTA** | **Arquivos:** routes/observability.js + always-alive.js

**CJ-01:** Expor `getStatusSnapshot()` em `AlwaysAliveAgent` (já pode existir como `#statusSnapshotCache`)
**CJ-02:** Importar referência ao agente singleton nas rotas de observabilidade
**CJ-03:** Enriquecer `GET /observability/health` com:
  - `agent.status` (running/stopped/starting)
  - `agent.queueDepth`
  - `agent.dialogActive`
  - `agent.model`
  - `agent.sessionId`
**CJ-04:** Teste de health endpoint

---

### Fase CK — Separar tool-audit.jsonl em dois arquivos
**Prioridade: BAIXA** | **Arquivos:** tool-audit-logger.js + audit-log.js

**CK-01:** Renomear log de permissões para `tool-permissions-audit.jsonl` (tool-audit-logger.js)
**CK-02:** Renomear log de execuções para `tool-execution-audit.jsonl` (audit-log.js)
**CK-03:** Atualizar variáveis de ambiente (`COPILOT_AUDIT_LOG_PATH` agora é `COPILOT_TOOL_PERMISSIONS_LOG_PATH`)
**CK-04:** Migrar referências em testes
**CK-05:** Atualizar `routes/observability.js` se necessário

---

### Fase CL — Global Error Handlers em Produção
**Prioridade: ALTA** | **Arquivos:** always-alive.js

**CL-01:** No `start()` de `AlwaysAliveAgent`, chamar `defaultErrorTracker.registerGlobalHandlers()` quando `NODE_ENV !== 'test'`
**CL-02:** Garantir idempotência (chamar duas vezes não registra handlers duplos)
**CL-03:** Adicionar teste que verifica handlers instalados em modo produção

---

### Fase CM — Cleanup: @deprecated duplicado e JSDoc
**Prioridade: BAIXA** | **Arquivos:** hooks/audit.js

**CM-01:** Remover `@deprecated` duplicado do JSDoc de `createAuditPostToolHandler`
**CM-02:** Revisar e atualizar JSDoc do `globalAuditBuffer` mencionando o feed via event-collector

---

### Fase CN — Observer: Dialog State e Lifecycle
**Prioridade: MÉDIA** | **Arquivos:** agent-event-observer.js

**CN-01:** Adicionar handler `dialog.ready` → `recordCounter('dialog.ready')`
**CN-02:** Adicionar handler `dialog.stopped` → `recordCounter('dialog.stopped.{reason}')`
**CN-03:** Adicionar handler `dialog.paused/resumed` → `recordCounter('dialog.paused')` / `recordCounter('dialog.resumed')`
**CN-04:** Adicionar handler `error` → `errorTracker.trackError(err, { source: 'agent.error' })`
**CN-05:** Adicionar handler `before-stop` → log do shutdown em curso
**CN-06:** Adicionar handler `question.pending/answered` → `recordCounter('agent.question.*')`

---

### Fase CO — Testes de Regressão e Coverage Gate
**Prioridade: ALTA** (após CA-CN)

**CO-01:** Escrever testes de snapshot para `agent-event-observer` (todos os novos handlers)
**CO-02:** Teste de integração: restart cycle (stop → start → stop) sem timer leak
**CO-03:** Teste de duplicação: task execution emite exatamente 1 `tool.execution_start`
**CO-04:** Teste de EVENT_MAP: todos os AGENT_EVENTS estão mapeados no nerv-bridge
**CO-05:** Coverage gate: manter > 80% em `src/copilot/observability/`
**CO-06:** Performance test: `DEFAULT_PERSIST_TYPES` como Set × Array (benchmark `hyperfine`)

---

### Prioridade de Execução

```
IMEDIATO (bugs críticos):
  CA → CB → CD

ALTA (gaps operacionais):
  CC → CF → CL → CJ

MÉDIA (completude de cobertura):
  CE → CG → CN → CI

MÉDIA (upgrades estruturais):
  CH (OTEL) → CK (separar logs)

BAIXA (cleanup):
  CM → CO (testes finais)
```

---

## Resumo Executivo

O sistema de observabilidade está **bem estruturado** e cobre os casos de uso mais críticos. As Fases BA–BM resolveram a maioria dos gaps de cobertura SDK. O estado atual é sólido e production-ready para operação normal.

**Principais ações necessárias:**
1. **[CA] Eliminar duplicate tool events** — bug silencioso que distorce todas as métricas de tool calls
2. **[CB] Corrigir timer leak** — risco de degradação em ciclos de restart
3. **[CC] Performance: Set para persist types** — ganho imediato sem risco
4. **[CF] Observer: task queue metrics** — visibilidade de throughput e backlog
5. **[CJ] Health endpoint rico** — diagnóstico em um request

O sistema está pronto para as fases avançadas (OTEL spans, gauges, separação de logs) após os bugs críticos serem corrigidos.
