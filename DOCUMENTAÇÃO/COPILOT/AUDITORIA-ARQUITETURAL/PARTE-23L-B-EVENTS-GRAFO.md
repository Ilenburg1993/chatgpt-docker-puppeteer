# PARTE-23L-B — Events System: Grafo de Eventos Completo

**Data**: 2026-04-12 | **Status**: Auditoria | **Versão**: 1.0
**Contexto**: Subparte especial PARTE-23 — grafo de dependências e fluxos de eventos

---

## 1. Grafo de Emissores → EventBus (Fluxo Atual)

```
                          GRAFO DE EVENTOS — SITUAÇÃO ATUAL
                          ══════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────┐
│                           FONTES (EMISSORES)                                │
└─────────────────────────────────────────────────────────────────────────────┘

AlwaysAliveAgent ──────── bridgeEmitter ──→ EventBus
 (EventEmitter, ~65)       (8 eventos)       │
                                             │ AGENT_READY
                                             │ AGENT_BEFORE_STOP
                                             │ AGENT_STOPPED
                                             │ AGENT_ERROR
                                             │ AGENT_DIALOG_LOOP_CHANGED
                                             │ AGENT_SESSION_KEEPALIVE
                                             │ AGENT_TASK_STARTED
                                             │ AGENT_TASK_DELTA

DialogLoopManager ─────── bridgeEmitter ──→ EventBus
 (BaseEmitter, 13)         (8 eventos)       │
  via always-alive.js                        │ AGENT_DIALOG_LOOP_CHANGED
                                             │ AGENT_DIALOG_STALLED
                                             │ AGENT_DIALOG_PAUSED
                                             │ AGENT_DIALOG_RESUMED
                                             │ AGENT_DIALOG_STOPPED
                                             │ AGENT_DIALOG_REPLY
                                             │ AGENT_DIALOG_COMPACTION_REQUESTED
                                             │ AGENT_DIALOG_TURN_TIMEOUT

HandoffManager ─────────── bridgeEmitter ──→ EventBus
 (BaseEmitter, 3)          (3 eventos)       │
  via always-alive.js                        │ AGENT_HANDOFF_RECEIVED
                                             │ AGENT_HANDOFF_ACCEPTED
                                             │ AGENT_HANDOFF_REJECTED

HubOrchestrator ────────── bridgeEmitter ──→ EventBus
 (BaseEmitter, 6)          (6 eventos)       │
  via hub.js                                 │ HUB_SESSION_CREATED
                                             │ HUB_SESSION_CLOSED
                                             │ HUB_TURN_SENT
                                             │ HUB_TURN_COMPLETE
                                             │ HUB_USER_INJECTED
                                             │ HUB_ERROR

PinnedFilesLoader ─────── bridgeEmitter ──→ EventBus
 (EventEmitter, 1)         (1 evento)        │
  via terminal/index.js                      │ CONFIG_PINNED_FILES_CHANGED

Services (direto) ──────────────────────→ EventBus
  session-service.js                        │ 'session:create'
  session-service.js                        │ 'session:disconnect'
  session-service.js                        │ 'session:resume'
  conversation-service.js                   │ 'session:message'
  tool-service.js                           │ 'tool:build'
  audit-service.js                          │ AUDIT_LOG (via import)

entry.js (bootstrap) ──── bridgeEmitter ──→ EventBus
  defaultBus EventEmitter    (???eventos)   │ (startup events)


┌─────────────────────────────────────────────────────────────────────────────┐
│                          DESCONECTADOS (SEM BRIDGE)                         │
└─────────────────────────────────────────────────────────────────────────────┘

HookBus ───────────────── ❌ SEM BRIDGE ──→ (NUNCA chega ao EventBus)
 pre_tool_use                               5 subscribers esperando em vão
 post_tool_use
 prompt_submitted
 session_start
 session_end
 error_occurred

SDK Session (74 events) ── ❌ SEM BRIDGE ──→ (invisíveis ao sistema)
 task.queued, task.started, completed...
 assistant.streaming_text...
 tool.pre_invoke, post_invoke...

SDK Client (5 events) ──── ❌ SEM BRIDGE ──→ (invisíveis ao sistema)
 session.created, deleted, updated...

EventFanout (SSE) ──────── ❌ SEM BRIDGE ──→ (isolado, publish/subscribe local)
 channel events

terminal/state.js ──────── ❌ SEM BRIDGE ──→ (state changes invisíveis)

core/shared-state.js ───── ❌ SEM BRIDGE ──→ (state changes invisíveis)


┌─────────────────────────────────────────────────────────────────────────────┐
│                          NERV (SISTEMA PARALELO)                            │
└─────────────────────────────────────────────────────────────────────────────┘

AlwaysAliveAgent ──────── nerv-bridge ───→ NERV external bus
 (EventEmitter)           EVENT_MAP         (62 eventos mapeados)
                          (direto, sem      COPILOT_AGENT_READY
                           passar pelo      COPILOT_TASK_STARTED
                           EventBus)        COPILOT_DIALOG_STALLED
                                            ... (59 outros)

NERV external bus ──────── nerv-bridge ──→ Agent.sendMessage/pause/resume
 COPILOT_COMMAND            inbound          (sem passar pelo EventBus)


┌─────────────────────────────────────────────────────────────────────────────┐
│                          CONSUMIDORES DO EVENTBUS                           │
└─────────────────────────────────────────────────────────────────────────────┘

EventBus ──→ event-bus-observers.js (15 subscribers, log-only)
  AGENT_READY              → log INFO
  AGENT_DIALOG_LOOP_CHANGED→ log DEBUG
  AGENT_DIALOG_STALLED     → log WARN
  AGENT_DIALOG_TURN_TIMEOUT→ log WARN
  HOOK_PRE_TOOL_USE        → ❌ NUNCA DISPARA (HookBus gap)
  HOOK_POST_TOOL_USE       → ❌ NUNCA DISPARA
  HOOK_SESSION_START       → ❌ NUNCA DISPARA
  HOOK_SESSION_END         → ❌ NUNCA DISPARA
  HOOK_ERROR_OCCURRED      → ❌ NUNCA DISPARA
  AGENT_HANDOFF_RECEIVED   → log INFO
  AGENT_HANDOFF_ACCEPTED   → log INFO
  AGENT_HANDOFF_REJECTED   → log WARN
  HUB_SESSION_CREATED      → log INFO
  HUB_SESSION_CLOSED       → log INFO
  CONFIG_PINNED_FILES_CHANGED → log INFO

EventBus ──→ nenhum subscriber para:
  AGENT_BEFORE_STOP, AGENT_STOPPED, AGENT_ERROR, AGENT_SESSION_FATAL,
  AGENT_TASK_STARTED, AGENT_TASK_DELTA, AGENT_TASK_ERROR,
  HUB_TURN_SENT, HUB_TURN_COMPLETE, HUB_USER_INJECTED,
  TERMINAL_STARTED, TERMINAL_STOPPED, TERMINAL_COMMAND,
  SYSTEM_SHUTDOWN_STARTED, SYSTEM_SHUTDOWN_COMPLETE,
  CONFIG_CHANGED, HEALTH_CHECK, HEALTH_DEGRADED, HEALTH_RECOVERED,
  BRIDGE_NERV_CONNECTED, BRIDGE_NERV_DISCONNECTED,
  AUDIT_ENTRY, AUDIT_FLUSH, AUDIT_QUICK,
  'session:create', 'session:disconnect', 'session:resume',
  'session:message', 'tool:build'
```

---

## 2. Grafo de Dependências entre Módulos de Eventos

```
                    DEPENDÊNCIAS DE MÓDULOS DE EVENTOS
                    ════════════════════════════════════

events/agent-events.js ──────→ (imported by)
  events/index.js             (re-export)
  events/catalog.md           (documentation)
  agent/always-alive.js       (AGENT_READY, AGENT_BEFORE_STOP, etc.)
  observability/event-bus-observers.js (subscribers)
  observability/agent-event-observer.js (implicit strings)

events/hub-events.js ─────────→
  events/index.js             (re-export)
  conversation-hub/hub.js     (HUB_EVENTS object)
  observability/event-bus-observers.js (HUB_SESSION_*)

events/hook-events.js ────────→
  events/index.js             (re-export)
  observability/event-bus-observers.js (HOOK_* - broken subscribers)

events/system-events.js ──────→
  events/index.js             (re-export)
  terminal/index.js           (CONFIG_PINNED_FILES_CHANGED)

events/terminal-events.js ────→
  events/index.js             (re-export)
  services/audit-service.js   (AUDIT_LOG)

core/event-bus.js ────────────→
  core/index.js               (re-export via barrel)
  agent/always-alive.js       (bridgeEmitter)
  agent/lifecycle/entry.js    (bridgeEmitter)
  conversation-hub/hub.js     (bridgeEmitter)
  terminal/index.js           (bridgeEmitter + EVENT_BUS token)
  observability/bootstrap.js  (container.register EVENT_BUS)
  observability/event-bus-observers.js (bus.on)
  services/session-service.js (bus.emit)
  services/audit-service.js   (bus.emit)

core/events.js (DEPRECATED) ──→
  agent/state/agent-state.js  (AGENT_EVENTS array - for loop)
  api/bridge/stream.js        (AGENT_EVENTS array)
  terminal/terminal-agent-wiring.js (AGENT_EVENTS array)

conversation-hub/events.js ───→ (DEPRECATED)
  conversation-hub/socket-ns.js  (HUB_EVENTS object)
  conversation-hub/call-strategies.js (HUB_EVENTS object)
```

---

## 3. Grafo de Fluxo de Dados Por Evento

### Fluxo: "Usuário envia mensagem" (send turn)

```
User HTTP POST /sessions/:id/send
│
├─→ api/express/sessions.js
│   └─→ agent.sendMessage(text)
│       └─→ AlwaysAliveAgent.sendMessage()
│           └─→ taskExecutor.execute()
│               ├─→ emit('task.started', info)
│               │   ├─→ nerv-bridge → NERV: COPILOT_TASK_STARTED
│               │   └─→ EventBus: AGENT_TASK_STARTED [subscriber: LOG]
│               ├─→ emit('task.delta', delta) [hot-path, high frequency]
│               │   ├─→ nerv-bridge → NERV: COPILOT_TASK_DELTA
│               │   ├─→ EventBus: AGENT_TASK_DELTA [NO SUBSCRIBER]
│               │   └─→ api/sse/fanout → SSE clients
│               └─→ emit('task.completed', result)
│                   ├─→ nerv-bridge → NERV: COPILOT_TASK_COMPLETED
│                   └─→ EventBus: ??? [NOT BRIDGED]
│
└─→ conversation-hub/hub.js (if via Hub)
    └─→ orchestrator.emit('turn_sent')
        └─→ bridge → EventBus: HUB_TURN_SENT [NO SUBSCRIBER]
```

### Fluxo: "Hook pre_tool_use intercepta ferramenta"

```
SDK pre_tool_use callback
│
└─→ hooks/factory.js handles hook
    └─→ hookBus.emitHook('pre_tool_use', sessionId, input)
        ├─→ HookBus.emit('pre_tool_use', event) [local only]
        │   └─→ api/express/hooks.js (SSE)  [FUNCIONA]
        │   └─→ any HookBus.on() subscriber [FUNCIONA]
        └─→ ❌ EventBus NUNCA recebe este evento
            └─→ event-bus-observers.js subscriber HOOK_PRE_TOOL_USE
                ❌ NUNCA DISPARA
```

### Fluxo: "Agent pronto após inicialização"

```
agent/lifecycle/agent-lifecycle.js:
└─→ agent.emit('ready')
    ├─→ nerv-bridge → NERV: COPILOT_AGENT_READY  [FUNCIONA]
    ├─→ EventBus.emit({ type: AGENT_READY })      [FUNCIONA via bridge]
    │   └─→ event-bus-observers: log INFO         [FUNCIONA]
    └─→ agent-event-observer (via agent.on())     [FUNCIONA]
```

### Fluxo: "Dialog loop trava (stall)"

```
agent/dialog/loop-manager.js:
└─→ this.emit('stalled', info)
    ├─→ event-wiring.js forward→ agent.emit('dialog.stalled')
    │   ├─→ nerv-bridge → NERV: COPILOT_DIALOG_STALLED       [FUNCIONA]
    │   └─→ agent-event-observer (via agent.on('dialog.stalled'))
    │       └─→ metrics: stall counter                        [FUNCIONA]
    └─→ (bridge via always-alive.js)
        └─→ EventBus.emit({ type: AGENT_DIALOG_STALLED })     [FUNCIONA]
            └─→ event-bus-observers: log WARN                  [FUNCIONA]
```

### Fluxo: "Sessão criada no Hub"

```
conversation-hub/orchestrator.js:
└─→ this.emit('session_created', session)
    └─→ bridge (hub.js) → EventBus.emit({ type: HUB_SESSION_CREATED })
        └─→ event-bus-observers: log INFO [FUNCIONA]
        └─→ ❌ NERV NÃO recebe este evento
```

---

## 4. Grafo NERV ↔ EventBus (Gap Crítico)

```
                    SILO ENTRE NERV E EVENTBUS
                    ═══════════════════════════

┌─────────────────────────────────────────────────────────┐
│                    NERV (externo)                       │
│                                                         │
│  emitEvent({ actionCode: 'COPILOT_AGENT_READY', ... }) │
│  onEvent('COPILOT_COMMAND', handler)                    │
│                                                         │
└──────────────────┬──────────────────────────────────────┘
                   │ ↕ nerv-bridge.js
                   │ (direto ao EventEmitter)
┌──────────────────▼──────────────────────────────────────┐
│              AlwaysAliveAgent                           │
│              (EventEmitter, ~65 events)                 │
│                                                         │
│  ← recebe: COPILOT_COMMAND (inbound)                   │
│  → emite: todos os ~65 eventos ao NERV via EVENT_MAP   │
└──────────────────┬──────────────────────────────────────┘
                   │ ↕ (SILO — SEM CONEXÃO DIRETA)
┌──────────────────▼──────────────────────────────────────┐
│                  EventBus (core)                        │
│                                                         │
│  ← recebe: 26 eventos via 6 bridges ativas             │
│  → entrega: 15 subscribers (5 quebrados/hook gap)      │
│  → ❌ NÃO envia nada para NERV                         │
│  ← ❌ NÃO recebe nada do NERV                          │
└─────────────────────────────────────────────────────────┘

RESULTADO: EventBus e NERV são SILOS independentes.
Eventos do Hub, Config, Hooks que chegam ao EventBus
NUNCA chegam ao NERV.
```

---

## 5. Grafo de Namespaces de Eventos

```
NAMESPACES PRESENTES NO SISTEMA (todos coexistindo):

1. SSOT (events/agent-events.js): "agent:*"
   agent:ready, agent:before-stop, agent:stopped, agent:shutdown
   agent:error, agent:emitter.error
   agent:session:keepalive, agent:session.fatal
   agent:task:started, agent:task:delta, agent:task.error
   agent:dialog:loop:changed, agent:dialog.turn_timeout
   agent:dialog:stalled, agent:dialog:paused, agent:dialog:resumed
   agent:dialog:stopped, agent:dialog:reply
   agent:dialog:compaction:requested
   agent:handoff:received, agent:handoff:accepted, agent:handoff:rejected

2. SSOT (events/hub-events.js): "hub:*"
   hub:session:created, hub:session:closed, hub:turn:sent
   hub:turn:complete, hub:turn:delta, hub:turn:user:pending
   hub:user:injected, hub:error

3. SSOT (events/hook-events.js): "hook:*"
   hook:pre_tool_use, hook:post_tool_use, hook:prompt_submitted
   hook:session_start, hook:session_end, hook:error_occurred

4. SSOT (events/terminal-events.js): "terminal:*", "audit:*"
   terminal:started, terminal:stopped, terminal:command
   audit:entry, audit:flush, audit:log, audit:quick

5. SSOT (events/system-events.js): "system:*", "config:*", "health:*", "bridge:*"
   system:shutdown:started, system:shutdown:complete
   config:pinned_files:changed, config:changed
   health:check, health:degraded, health:recovered
   bridge:mcp:reconnected, bridge:nerv:connected, bridge:nerv:disconnected

6. LEGACY (AGENT_EVENTS array): sem namespace, ponto-separado
   ready, before-stop, stopped, error, task.started, task.delta
   dialog.stalled, dialog.reply, session.keepalive, session.fatal
   ... (~65 strings)

7. LEGACY (HookBus local): snake_case sem namespace
   pre_tool_use, post_tool_use, prompt_submitted
   session_start, session_end, error_occurred

8. NERV (nerv-bridge): UPPER_SNAKE_CASE com COPILOT_ prefix
   COPILOT_AGENT_READY, COPILOT_TASK_STARTED, COPILOT_DIALOG_STALLED
   COPILOT_SESSION_FATAL, COPILOT_COMPACTION_PROACTIVE_REQUEST
   ... (62 mappings)

9. SERVICES inline (sem constante): "namespace:action"
   session:create, session:disconnect, session:resume
   session:message, tool:build

TOTAL: 5 formatos distintos coexistindo
```

---

## 6. Grafo de Prioridade de Entrega

```
PIPELINE DE UM EVENTO (ex: AGENT_READY = 'agent:ready')

emit({ type: 'agent:ready', sessionId: 'abc', timestamp: 123 })
│
├─ [1] middleware chain (0 middlewares registrados → passa direto)
│
├─ [2] #deliver()
│   ├─ exact match: listeners('agent:ready') → handlers notificados
│   ├─ namespace wildcard: listeners('agent:*') → handlers notificados
│   └─ catch-all: listeners('*') → handlers notificados
│
└─ [3] contadores incrementados:
       #counters.set('agent:ready', n++)

TODOS os handlers são async-safe (try/catch por handler)
Ordem de entrega: exact > namespace-wildcard > catch-all
Handlers em PARALELO (sem await, sem fila)
```

---

## 7. Matriz de Cobertura de Eventos

| Namespace                     | SSOT definido | Bridge ativo | Subscriber | Ação operacional |
| ----------------------------- | :-----------: | :----------: | :--------: | :--------------: |
| `agent:ready`                 |       ✅       |      ✅       |   ✅ log    |    ❌ (só log)    |
| `agent:before-stop`           |       ✅       |      ✅       |     ❌      |        ❌         |
| `agent:stopped`               |       ✅       |      ✅       |     ❌      |        ❌         |
| `agent:error`                 |       ✅       |      ✅       |     ❌      |        ❌         |
| `agent:dialog:stalled`        |       ✅       |      ✅       |   ✅ log    |    ❌ (só log)    |
| `agent:dialog:loop:changed`   |       ✅       |      ✅       |   ✅ log    |        ❌         |
| `agent:dialog:turn_timeout`   |       ✅       |      ✅       |   ✅ log    |        ❌         |
| `agent:handoff:*`             |       ✅       |      ✅       |   ✅ log    |        ❌         |
| `agent:task:started`          |       ✅       |      ✅       |     ❌      |        ❌         |
| `agent:task:delta`            |       ✅       |      ✅       |     ❌      |        ❌         |
| `hook:pre_tool_use`           |       ✅       |    ❌ BUG     | ✅ (broken) |        ❌         |
| `hook:post_tool_use`          |       ✅       |    ❌ BUG     | ✅ (broken) |        ❌         |
| `hook:session_start`          |       ✅       |    ❌ BUG     | ✅ (broken) |        ❌         |
| `hook:session_end`            |       ✅       |    ❌ BUG     | ✅ (broken) |        ❌         |
| `hook:error_occurred`         |       ✅       |    ❌ BUG     | ✅ (broken) |        ❌         |
| `hub:session:created`         |       ✅       |      ✅       |   ✅ log    |        ❌         |
| `hub:session:closed`          |       ✅       |      ✅       |   ✅ log    |        ❌         |
| `hub:turn:sent`               |       ✅       |      ✅       |     ❌      |        ❌         |
| `hub:turn:complete`           |       ✅       |      ✅       |     ❌      |        ❌         |
| `config:pinned_files:changed` |       ✅       |      ✅       |   ✅ log    |        ❌         |
| `system:shutdown:*`           |       ✅       |      ❌       |     ❌      |        ❌         |
| `health:*`                    |       ✅       |      ❌       |     ❌      |        ❌         |
| `bridge:nerv:*`               |       ✅       |      ❌       |     ❌      |        ❌         |
| `terminal:*`                  |       ✅       |      ❌       |     ❌      |        ❌         |
| SDK events (74 tipos)         |       ❌       |      ❌       |     ❌      |        ❌         |
| `session:create` (service)    |       ❌       |      —       |     ❌      |        ❌         |
| `tool:build` (service)        |       ❌       |      —       |     ❌      |        ❌         |

**Cobertura atual**:
- SSOT definido: 52/~120 eventos únicos ≈ 43%
- Bridge ativo: 26/52 SSOT eventos ≈ 50%
- Subscriber presente: 15/26 bridgeados ≈ 58%
- Ação operacional: 0/15 ≈ 0% (apenas logging)

---

**Próximo documento**: [PARTE-23L-C-EVENTS-SITUACAO-IDEAL.md](PARTE-23L-C-EVENTS-SITUACAO-IDEAL.md)
