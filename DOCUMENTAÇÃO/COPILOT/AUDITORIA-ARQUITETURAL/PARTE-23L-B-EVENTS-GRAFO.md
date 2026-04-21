# PARTE-23L-B — Events System: Grafos de Topologia v2.0

**Data**: 2026-04-12 | **Status**: Auditoria | **Versão**: 2.0 (pós-FAIXA-L1 a L8) **Precedente**:
Commit `b3284b0a` | **Companion**: PARTE-23L-A v2.0

---

## 1. Grafo Completo: Fluxo SDK → Agent → EventBus → NERV

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     SDK SESSION (74+ event types)                           │
│  session.start, assistant.turn_start, tool.execution_start, abort, ...      │
└────────┬──────────────────────────────────┬─────────────────────────────────┘
         │                                  │
    ┌────┴──── CAMINHO A ────┐    ┌────────┴──── CAMINHO B ────────────┐
    │ event-handlers/ (25 ev.)│    │ SdkSessionBridge (18 ev.)          │
    │ sdk-responses.js        │    │ sdk-session-bridge.js               │
    │ compaction.js           │    │ ⚠️ attach() NUNCA chamado!          │
    │ streaming.js            │    │                                     │
    │ token-budget.js         │    │ SDK_SESSION_TO_EVENTBUS map         │
    │ mode-and-tools.js       │    │ 'session.start'→'sdk:session:start' │
    │ system-notifications.js │    │ ...                                 │
    │ usage.js                │    │                                     │
    │ catch-all.js            │    └────────┬─────────────────────────────┘
    └────────┬────────────────┘             │
             │ callbacks.emit(name, payload)│
             │ = host.emit(name, payload)  │
             ▼                              │
┌──────────────────────────────┐            │
│  AlwaysAliveAgent            │            │
│  (BaseEmitter)               │            │
│  ~52 event names emitidos    │            │
│                              │            │
│  ┌──── Forwarders ─────┐    │            │
│  │ event-wiring.js:    │    │            │
│  │  DLM events →       │    │            │
│  │  agent 'dialog.*'   │    │            │
│  │                     │    │            │
│  │ task-executor.js:   │    │            │
│  │  tool.*,task.*      │    │            │
│  │  → agent host.emit()│    │            │
│  └─────────────────────┘    │            │
│                              │            │
│  38 BRIDGEADOS ──────────────┼────┐       │
│  28 PERDIDOS (→ ∅) ─────────┼──✗ │       │
│                              │    │       │
└──────────┬───────────────────┘    │       │
           │ (direto, ~50 events)   │       │
           ▼                        ▼       ▼
┌──────────────────────┐  ┌─────────────────────────────────────────┐
│ AgentEventObserver   │  │            EventBus (SSOT)               │
│ (direct subscription)│  │  on()/emit()/use()/diagnostics()         │
│ session-agent-hdlers │  │                                          │
│ dialog-task-handlers │  │  ┌── Middlewares (L6) ──────────────┐    │
│                      │  │  │ timestamp-enricher                │    │
│ 50 events via        │  │  │ schema-validator                  │    │
│ agent.on(name, fn)   │  │  │ rate-limiter (100/s/type)         │    │
│                      │  │  └──────────────────────────────────┘    │
│ ⚠️ DUPLICA com       │  │                                          │
│  EventBus subscr.    │  │  38 agent:* events (via bridgeEmitter)   │
└──────────────────────┘  │  8  dialog:* events (via DLM bridge)     │
                          │  3  handoff:* events (via HM bridge)     │
                          │  6  hub:* events (via orchestrator)      │
                          │  1  config:* event (pinned files)        │
                          │  6  hook:* events (via HookBus L1)       │
                          │  5  service:* events (via services L2)   │
                          │  5  system:* events (direct)             │
                          │  18 sdk:* events (via SdkSessionBridge)  │
                          │  ─────────────────────────────────────   │
                          │  = ~90 event types no EventBus           │
                          │                                          │
                          │  Subscribers:                             │
                          │   15 event-bus-observers (log only)       │
                          │   ~70 NervEventBusAdapter (outbound)      │
                          └──────┬──────────────────┬────────────────┘
                                 │                  │
              ┌──────────────────┘                  │
              ▼                                     ▼
┌────────────────────────────┐    ┌─────────────────────────────────┐
│ event-bus-observers.js     │    │   NervEventBusAdapter (L3)       │
│ 15 subscribers             │    │   ~70 outbound mappings          │
│ ✅ 10 now fire (hook fix)  │    │   EventBus → NERV envelope       │
│ Actions: log only          │    │                                  │
│ ⚠️ No metrics/health      │    │ + Inbound:                       │
└────────────────────────────┘    │   NERV 'COPILOT_COMMAND'         │
                                  │   → bus.emit('nerv:command:*')   │
                                  └──────────────┬──────────────────┘
                                                 │
                                                 ▼
                                  ┌─────────────────────────────────┐
                                  │   NERV Bus (externo)             │
                                  │   Recebe envelopes de 2 fontes:  │
                                  │   1. nerv-bridge (62, direto)    │
                                  │   2. NervAdapter (~70, via EB)   │
                                  │   ⚠️ 38 eventos DUPLICADOS!      │
                                  └─────────────────────────────────┘
```

---

## 2. Grafo de Emitters Locais (Não-EventBus)

```
┌─────────────────────────────────────────────────────────┐
│           EMITTERS LOCAIS (BaseEmitter / EventEmitter)   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  DialogLoopManager (13 types)                            │
│  ├── DLM bridge (8 types → EventBus)     ✅             │
│  └── event-wiring → Agent emitter (13 types)  ✅        │
│                                                          │
│  HandoffManager (3 types)                                │
│  └── HM bridge (3 types → EventBus)      ✅             │
│                                                          │
│  HookBus (6 + wildcard)                                  │
│  └── setEventBus bridge (L1)             ✅             │
│                                                          │
│  HubOrchestrator (6 types)                               │
│  └── hub.js bridgeEmitter                ✅             │
│                                                          │
│  PinnedFilesLoader (1 type: changed)                     │
│  └── terminal/index.js bridge            ✅             │
│                                                          │
│  EventFanout (canal events)              ❌ NOT BRIDGED  │
│  terminal/state.js (state changes)       ❌ NOT BRIDGED  │
│  core/shared-state.js (state events)     ❌ NOT BRIDGED  │
│  UserInputHandler (answer/cancel/timeout)❌ NOT BRIDGED  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Grafo de Duplicação: Os 28 Events Perdidos

```
SDK session.on(EVENT_X, handler)
    │
    ▼
event-handlers/sdk-responses.js
    │
    ├── emit('session.error')         ──→ agent ──→ ❌ NÃO no bridge ──→ PERDIDO
    ├── emit('session.shutdown')      ──→ agent ──→ ❌ NÃO no bridge ──→ PERDIDO
    ├── emit('session.handoff')       ──→ agent ──→ ❌ NÃO no bridge ──→ PERDIDO
    ├── emit('session.task_complete') ──→ agent ──→ ❌ NÃO no bridge ──→ PERDIDO
    ├── emit('assistant.turn_start')  ──→ agent ──→ ❌ NÃO no bridge ──→ PERDIDO
    ├── emit('assistant.turn_end')    ──→ agent ──→ ❌ NÃO no bridge ──→ PERDIDO
    ├── emit('abort')                 ──→ agent ──→ ❌ NÃO no bridge ──→ PERDIDO
    ├── emit('dialog.delta')          ──→ agent ──→ ❌ NÃO no bridge ──→ PERDIDO
    ├── emit('elicitation.pending')   ──→ agent ──→ ❌ NÃO no bridge ──→ PERDIDO
    ├── emit('subagent.*')            ──→ agent ──→ ❌ NÃO no bridge ──→ PERDIDO
    ├── emit('agent.background.*')    ──→ agent ──→ ❌ NÃO no bridge ──→ PERDIDO
    ├── emit('agent.shell.*')         ──→ agent ──→ ❌ NÃO no bridge ──→ PERDIDO
    ├── emit('assistant.intent')      ──→ agent ──→ ❌ NÃO no bridge ──→ PERDIDO
    ├── emit('assistant.reasoning_complete')→agent→ ❌ NÃO no bridge ──→ PERDIDO
    ├── emit('session.context_changed')──→ agent →  ❌ NÃO no bridge ──→ PERDIDO
    └── emit('session.truncation')    ──→ agent ──→ ❌ NÃO no bridge ──→ PERDIDO

event-handlers/boot-wiring.js (via ctx.emit)
    ├── emit('sdk.lifecycle')         ──→ agent ──→ ❌ PERDIDO
    ├── emit('session.cleanup')       ──→ agent ──→ ❌ PERDIDO
    ├── emit('mcp.reconnected')       ──→ agent ──→ ❌ PERDIDO
    ├── emit('quota.warning')         ──→ agent ──→ ❌ PERDIDO
    └── emit('dialog.boot_recovery')  ──→ agent ──→ ❌ PERDIDO

agent-messaging.js
    └── emit('steering.sent')         ──→ agent ──→ ❌ PERDIDO
```

---

## 4. Grafo Ideal Proposto (v2)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     SDK SESSION (74+ event types)                           │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │   event-handlers/ (25 evts)  │
              │   ÚNICO caminho SDK→Agent    │
              │   (SdkSessionBridge removido)│
              └──────────────┬──────────────┘
                             │ callbacks.emit()
                             ▼
              ┌──────────────────────────────┐
              │  AlwaysAliveAgent             │
              │  bridgeEmitter: TODOS ~52     │
              │  events (zero perdidos)       │
              └──────────────┬──────────────┘
                             │
                             ▼
              ┌──────────────────────────────────────────────────────┐
              │                  EventBus (SSOT Central)              │
              │                                                       │
              │  Middlewares: enricher → validator → rate-limiter      │
              │                                                       │
              │  Todas as fontes convergem aqui:                      │
              │   agent:*  (52 events via bridgeEmitter completo)     │
              │   hook:*   (6 events via HookBus bridge)              │
              │   hub:*    (6 events via orchestrator bridge)         │
              │   service:*(5 events direto)                          │
              │   system:* (5 events direto)                          │
              │   config:* (1 event)                                  │
              │   terminal:*(7 events — bridges novos)                │
              │   = ~82 event types, ZERO duplicação                  │
              │                                                       │
              │  Subscribers:                                          │
              │   event-bus-observers → métricas + health + alertas   │
              │   NervEventBusAdapter → NERV (ÚNICO caminho)          │
              │   OperationalSubscribers → actions (auto-heal, etc.)  │
              └──────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────────────────────┐
              │   NervEventBusAdapter (ÚNICO path para NERV)         │
              │   ~82 outbound mappings (full coverage)              │
              │   nerv-bridge.js REMOVIDO (legado eliminado)         │
              └──────────────────────────────────────────────────────┘
```

### Diferenças Chave Atual → Ideal:

| Aspecto                  | Atual (v2.0)             | Ideal                       |
| ------------------------ | ------------------------ | --------------------------- |
| SDK→EventBus caminhos    | 2 (A + B duplicados)     | 1 (event-handlers único)    |
| Events perdidos (agent)  | 28                       | 0                           |
| NERV outbound caminhos   | 2 (legado + adapter)     | 1 (adapter único)           |
| NERV envelope duplicação | 38 duplos                | 0 duplos                    |
| Observer acoplamento     | 2 (EB direto + EventBus) | 1 (EventBus único)          |
| Namespace separator      | 4 formatos (:, ., \_, /) | 1 formato (`:` SSOT)        |
| Event types no EventBus  | ~90 (com duplos)         | ~82 (sem duplos)            |
| Bus-observers ação       | log only                 | métricas + health + alertas |

---

## 5. Grafo de Namespace após Normalização

```
EventBus namespace tree:
├── agent:
│   ├── agent:ready
│   ├── agent:before-stop
│   ├── agent:stopped
│   ├── agent:shutdown
│   ├── agent:error
│   ├── agent:emitter.error
│   ├── agent:metrics
│   ├── agent:session:*         (keepalive, fatal, compaction_*, usage, ...)
│   ├── agent:task:*            (started, completed, delta, error, queued, reasoning)
│   ├── agent:dialog:*          (ready, turn_start/end, stalled, paused, ...)
│   ├── agent:tool:*            (execution_start/complete/progress)
│   ├── agent:question:*        (pending, answered)
│   ├── agent:permission:*      (mode_changed)
│   ├── agent:pr:*              (consumed, fallback_model)
│   ├── agent:handoff:*         (received, accepted, rejected)
│   ├── agent:context:*         (compacted)
│   ├── agent:system:*          (message)
│   ├── agent:assistant:*       [NOVO] (turn_start, turn_end, intent, reasoning_complete)
│   ├── agent:subagent:*        [NOVO] (started, completed, failed)
│   ├── agent:abort             [NOVO]
│   ├── agent:elicitation:*     [NOVO] (pending)
│   ├── agent:shell:*           [NOVO] (completed, detached_completed)
│   ├── agent:background:*      [NOVO] (completed, idle)
│   ├── agent:sdk:lifecycle     [NOVO]
│   ├── agent:mcp:reconnected   [NOVO]
│   └── agent:steering:sent     [NOVO]
│
├── hook:
│   ├── hook:pre_tool_use
│   ├── hook:post_tool_use
│   ├── hook:prompt_submitted
│   ├── hook:session_start
│   ├── hook:session_end
│   └── hook:error_occurred
│
├── hub:
│   ├── hub:session:created
│   ├── hub:session:closed
│   ├── hub:turn:sent
│   ├── hub:turn:complete
│   ├── hub:user:injected
│   └── hub:error
│
├── service:
│   ├── service:session:created
│   ├── service:session:disconnected
│   ├── service:session:resumed
│   ├── service:session:message
│   └── service:tool:invoked
│
├── system:
│   ├── system:shutdown:started
│   ├── system:shutdown:complete
│   ├── system:health:degraded
│   ├── system:health:recovered
│   └── system:config:pinned_files_changed
│
├── terminal:
│   ├── terminal:command:start
│   ├── terminal:command:complete
│   └── terminal:state:changed
│
└── nerv:
    ├── nerv:command:received
    ├── nerv:command:send_message
    ├── nerv:command:pause
    ├── nerv:command:resume
    └── nerv:command:restart
```

---

## 6. Matriz de Cobertura por Módulo

| Módulo          | Emitidos | Bridgeados | Perdidos | Cobertura |
| --------------- | -------- | ---------- | -------- | --------- |
| agent/lifecycle | 8        | 6          | 2        | 75%       |
| agent/dialog    | 13       | 13         | 0        | 100%      |
| agent/session   | 16       | 8          | 8        | 50%       |
| agent/messaging | 2        | 0          | 2        | 0%        |
| agent/infra     | 7        | 6          | 1        | 86%       |
| hooks           | 6        | 6          | 0        | 100%      |
| hub             | 6        | 6          | 0        | 100%      |
| services        | 5        | 5          | 0        | 100%      |
| system          | 5        | 5          | 0        | 100%      |
| **TOTAL**       | **68**   | **55**     | **13**   | **81%**   |

> Nota: Os 28 "perdidos" incluem variantes internas (\_\_processQueue, status) e eventos que não
> precisam de bridge (dialog.pre_stall_warning). Cobertura real após exclusão de internos: **~85%**

---

## 7. Legenda

- ✅ = Bridgeado ao EventBus
- ❌ = NÃO bridgeado (perdido)
- ⚠️ = Parcialmente coberto / duplicação
- 🔴 = Impacto ALTO (perda de visibilidade operacional)
- 🟡 = Impacto MÉDIO
- 🟢 = Impacto BAIXO
- ⚪ = Interno (não necessita bridge)
