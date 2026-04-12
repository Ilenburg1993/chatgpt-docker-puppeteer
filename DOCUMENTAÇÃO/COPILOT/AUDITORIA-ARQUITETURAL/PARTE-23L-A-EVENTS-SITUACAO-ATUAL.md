# PARTE-23L-A — Events System: Auditoria Profunda — Situação Atual

**Data**: 2026-04-12 | **Status**: Auditoria | **Versão**: 1.0
**Contexto**: Subparte especial da PARTE-23 — foco exclusivo no sistema de eventos
**Precedente**: PARTE-23I-ROADMAP-EXPANDIDO-V2.md (FAIXA-2 concluída, commit `7193f74f`)

> Esta subparte analisa **toda** a infraestrutura de eventos do sistema Copilot: definições,
> emissores, consumidores, bridges, NERV, e gaps críticos.

---

## 1. Inventário de Sistemas de Eventos

O sistema Copilot possui **6 sistemas de eventos distintos** operando em paralelo:

### 1.1 EventBus (core/event-bus.js)

**Tipo**: Class-based, cross-module, com wildcards e middleware
**Capacidades**:
- `bus.on(type, handler)` → retorna `() => void` unsubscribe
- `bus.once(type, handler)` → unsubscribe automático
- `bus.emit({ type, ...payload })` → com middleware chain
- `bus.use(middleware)` → intercepta antes da entrega
- `bus.stats()` → contadores por event type
- Wildcards: `session:*` captura `session:start`, `session:end`, etc.
- Catch-all: `*` captura todos os eventos
- `bus.listenerCount` → número total de handlers
- `bus.dispose()` → cleanup completo

**Singleton**: registrado via DI token `EVENT_BUS` em `observability/bootstrap.js`
**Alias**: `#copilot/core` → re-exporta `EventBus, createEventBus, bridgeEmitter`

**Limitações identificadas**:
- ❌ Sem persistência de eventos (apenas in-memory)
- ❌ Sem replay para novos subscribers (latecomers perdem histórico)
- ❌ Sem prioridade de entrega entre handlers
- ❌ Sem circuit breaker por handler lento/bloqueante
- ❌ Sem timeout por handler (handler que nunca resolve = vazamento silencioso)
- ❌ `stats()` por tipo mas não por namespace (ex: `agent:*` total)
- ❌ Sem `diagnostics()` que lista todos os listeners registrados
- ❌ Sem `channels()` que retorna quais event types têm subscribers
- ❌ Sem rastreamento de quem fez o `on()` (stack trace, módulo)
- ❌ Middleware chain não tem acesso ao contexto de origem da emissão

### 1.2 BaseEmitter / EventEmitter local (core/create-emitter.js)

**Tipo**: Node.js EventEmitter wrapper
**Usuários** (28 arquivos com EventEmitter/BaseEmitter/createEmitter):

| Módulo                               | Classe/instância                        | Eventos emitidos                                                                                                                                      |
| ------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent/dialog/loop-manager.js`       | `DialogLoopManager extends BaseEmitter` | ready, reply, stopped, paused, resumed, stalled, turn_start, turn_end, turn_timeout, changed, model.fallback, compaction.requested, pre_stall_warning |
| `agent/infra/handoff-manager.js`     | `HandoffManager extends BaseEmitter`    | handoff.received, handoff.accepted, handoff.rejected                                                                                                  |
| `hooks/bus.js`                       | `HookBus extends BaseEmitter`           | pre_tool_use, post_tool_use, prompt_submitted, session_start, session_end, error_occurred, *                                                          |
| `config/pinned-files.js`             | instância interna                       | changed                                                                                                                                               |
| `conversation-hub/orchestrator.js`   | `HubOrchestrator extends BaseEmitter`   | session_created, session_closed, turn_sent, turn_complete, user_injected, error                                                                       |
| `agent/dialog/user-input-handler.js` | instância                               | (answer, cancel, timeout)                                                                                                                             |
| `agent/dialog/turn-executor.js`      | instância                               | (turn eventos internos)                                                                                                                               |
| `terminal/state.js`                  | instância                               | (state changes)                                                                                                                                       |
| `api/sse/fanout.js`                  | `EventFanout` com `createEmitter()`     | (channel/*)                                                                                                                                           |
| `core/shared-state.js`               | instância                               | (state changes)                                                                                                                                       |
| `sdk/event-helpers.js`               | helpers sobre session                   | (proxy de SDK)                                                                                                                                        |

**Bridges ativos (pós FAIXA-2)**:
- `always-alive.js`: `alwaysAliveAgent` → EventBus (8 eventos)
- `always-alive.js`: `alwaysAliveAgent.ctx.dialogLoop` → EventBus (8 eventos)
- `always-alive.js`: `alwaysAliveAgent.ctx.handoff` → EventBus (3 eventos)
- `conversation-hub/hub.js`: `orchestrator` → EventBus (via bridgeEmitter, 6 eventos)
- `agent/lifecycle/entry.js`: `defaultBus` EventEmitter → EventBus global (bootstrap)
- `terminal/index.js`: `pinnedLoader` → EventBus (1 evento: CONFIG_PINNED_FILES_CHANGED)

**Emitters sem bridge** (6 restantes):
| Emitter                | Módulo                  | Eventos sem bridge                                |
| ---------------------- | ----------------------- | ------------------------------------------------- |
| `HookBus`              | `hooks/bus.js`          | 6 hook events (pre_tool_use, post_tool_use, etc.) |
| `EventFanout`          | `api/sse/fanout.js`     | channel events (publish/subscribe)                |
| `terminal/state.js`    | `terminal/state.js`     | state change events                               |
| `core/shared-state.js` | `core/shared-state.js`  | state events                                      |
| `DialogLoopManager`    | `loop-manager.js`       | (parcialmente — via agent bridge)                 |
| `UserInputHandler`     | `user-input-handler.js` | answer, cancel, timeout                           |

### 1.3 HookBus (hooks/bus.js)

**Tipo**: BaseEmitter especializado para o sistema de hooks
**Diferencial**: emite tanto o evento específico (`pre_tool_use`) quanto o wildcard `*`
**Problema**: Não está bridgeado ao EventBus → hooks são invisíveis para observers cross-module
**Consumers**: `hooks/factory.js`, `hooks/registry.js`, `api/express/hooks.js`

### 1.4 NERV Bridge (bridges/nerv-bridge.js)

**Tipo**: Bridge unidirecional AlwaysAliveAgent EventEmitter → instância NERV externa
**Escopo**: 62 eventos mapeados (EVENT_MAP)
**Direção**: Copilot → NERV (outbound) + NERV → Copilot (inbound via `COPILOT_COMMAND`)
**Inbound commands**: sendMessage, pause, resume, restart

**Problema crítico**: O nerv-bridge conecta **diretamente** ao `alwaysAliveAgent` (EventEmitter),
**não** ao `EventBus`. Isso significa:
- Eventos que passam pelo EventBus (ex: AGENT_READY via bridge) **não chegam ao NERV**
- Eventos que chegam via NERV `COPILOT_COMMAND` chamam o agent diretamente
- Há **dois caminhos** de eventos: EventEmitter (NERV) + EventBus (observability)

**Integração atual**:
```
AlwaysAliveAgent (EventEmitter)
    ├── → NERV via nerv-bridge (62 eventos diretos)
    └── → EventBus via bridgeEmitter (8 eventos selecionados)
```

**Situação problemática**:
- Eventos no EventBus **não chegam ao NERV** automaticamente
- NERV e EventBus estão **desacoplados** — dois sistemas independentes
- Não há `EventBus → NERV` bridge

### 1.5 SDK Session Events (sdk/events.js + sdk/client-events.js)

**Tipo**: Proxy sobre `@github/copilot-sdk` session e client
**Escopo**:
- `session.on(type, handler)` — 74+ event types do SDK (TaskEvent, AssistantEvent, etc.)
- `client.on(type, handler)` — 5 lifecycle events (session.created/deleted/updated/foreground/background)
**Problema**: Estes eventos NUNCA são bridgeados ao EventBus — ficam isolados no SDK layer

### 1.6 ConversationHub / Socket.IO Events (conversation-hub/events.js)

**Tipo**: String constants para Socket.IO namespace events + internal bus events
**Bridge**: `hub.js` bridgeia HubOrchestrator → EventBus (via FAIXA-2A)
**Status**: Parcialmente integrado ao EventBus

---

## 2. Mapa de Fontes de Verdade (SSOT)

### 2.1 Fontes de constantes de eventos

| Fonte                          | Status       | Eventos                                          | Consumers                                           |
| ------------------------------ | ------------ | ------------------------------------------------ | --------------------------------------------------- |
| `events/agent-events.js`       | ✅ SSOT       | 22 constantes + AGENT_EVENTS array (~65 strings) | via barrel                                          |
| `events/hub-events.js`         | ✅ SSOT       | 9 constantes + HUB_EVENTS object                 | via barrel                                          |
| `events/hook-events.js`        | ✅ SSOT       | 6 constantes HOOK_*                              | via barrel                                          |
| `events/terminal-events.js`    | ✅ SSOT       | 7 constantes                                     | via barrel                                          |
| `events/system-events.js`      | ✅ SSOT       | 10 constantes                                    | via barrel                                          |
| `events/index.js`              | ✅ barrel     | re-exports + AGENT_EVENTS_MAP, HUB_EVENTS_MAP    | `#copilot/events`                                   |
| `core/events.js`               | ⚠️ DEPRECATED | AGENT_EVENTS array (backward-compat)             | agent-state.js, stream.js, terminal-agent-wiring.js |
| `conversation-hub/events.js`   | ⚠️ DEPRECATED | HUB_EVENTS object legacy                         | socket-ns.js, call-strategies.js                    |
| `types/events.js`              | ⚠️ DEPRECATED | EVENT_NAMES, EVENT_NAMESPACES                    | (re-exported pelo barrel)                           |
| `bridges/nerv-bridge.js`       | ⚠️ LOCAL      | EVENT_MAP (62 mappings AGENT→NERV)               | nerv-bridge apenas                                  |
| `agent/dialog/event-wiring.js` | ⚠️ LOCAL      | DLM_EVENTS, EVENT_MAP (13 forward-maps)          | agent/dialog apenas                                 |
| `sdk/constants.js`             | ⚠️ EXTERNAL   | SESSION_EVENTS (do SDK)                          | sdk/ apenas                                         |

### 2.2 Strings de eventos hardcoded (fora do SSOT)

Locais onde strings de eventos aparecem inline (NÃO importadas do SSOT):

| Arquivo                            | Eventos inline                                                         |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `services/session-service.js`      | `'session:create'`, `'session:disconnect'`, `'session:resume'`         |
| `services/conversation-service.js` | `'session:message'`                                                    |
| `services/tool-service.js`         | `'tool:build'`                                                         |
| `services/audit-service.js`        | `AUDIT_LOG` (import local)                                             |
| `hooks/bus.js`                     | `'pre_tool_use'`, `'post_tool_use'`, etc. (local, não importa do SSOT) |
| `agent/dialog/event-wiring.js`     | strings para forwarding (mapeamento local)                             |
| `terminal/state.js`                | strings locais                                                         |
| `api/sse/fanout.js`                | strings de canal                                                       |

**Violações C11 contabilizadas**: ~18 strings hardcoded fora do SSOT

---

## 3. Mapa de Emissores (Who emits what)

### Agent Lifecycle
```
AlwaysAliveAgent (agent-lifecycle.js):
├── emit('ready')                          → bridge: AGENT_READY
├── emit('before-stop')                    → bridge: AGENT_BEFORE_STOP
├── emit('stopped')                        → bridge: AGENT_STOPPED
├── emit('error', err)                     → bridge: AGENT_ERROR
├── emit('dialog.loop.changed', info)      → bridge: AGENT_DIALOG_LOOP_CHANGED
├── emit('session.keepalive')              → bridge: AGENT_SESSION_KEEPALIVE
├── emit('task.started', info)             → bridge: AGENT_TASK_STARTED
├── emit('task.delta', delta)              → bridge: AGENT_TASK_DELTA
└── emit(...muitos outros via AGENT_EVENTS → NERV: EVENT_MAP)
```

### DialogLoopManager (loop-manager.js)
```
├── emit('changed', info)                  → bridge(alwaysAlive→bus): AGENT_DIALOG_LOOP_CHANGED
├── emit('stalled', info)                  → bridge: AGENT_DIALOG_STALLED
├── emit('paused')                         → bridge: AGENT_DIALOG_PAUSED
├── emit('resumed')                        → bridge: AGENT_DIALOG_RESUMED
├── emit('stopped')                        → bridge: AGENT_DIALOG_STOPPED
├── emit('reply', msg)                     → bridge: AGENT_DIALOG_REPLY
├── emit('compaction.requested')           → bridge: AGENT_DIALOG_COMPACTION_REQUESTED
├── emit('turn_timeout')                   → bridge: AGENT_DIALOG_TURN_TIMEOUT
├── emit('ready') → forward para agent→'dialog.ready'
├── emit('turn_start') → forward para agent→'dialog.turn_start'
├── emit('turn_end') → forward para agent→'dialog.turn_end'
├── emit('model.fallback') → forward para agent→'pr.fallback_model'
└── emit('pre_stall_warning') → NOT BRIDGED
```

### HookBus (hooks/bus.js)
```
├── emitHook('pre_tool_use', sessionId, input)   → ❌ NOT BRIDGED to EventBus
├── emitHook('post_tool_use', sessionId, result) → ❌ NOT BRIDGED
├── emitHook('prompt_submitted', sessionId, msg) → ❌ NOT BRIDGED
├── emitHook('session_start', sessionId, ctx)    → ❌ NOT BRIDGED
├── emitHook('session_end', sessionId, ctx)      → ❌ NOT BRIDGED
└── emitHook('error_occurred', sessionId, err)   → ❌ NOT BRIDGED
```

> **Nota**: Há 15 subscribers no EventBus para HOOK_* events (criados em FAIXA-2D),
> mas o HookBus NUNCA chama `bus.emit()` — os subscribers nunca disparam.
> **Este é um BUG crítico descoberto durante esta auditoria.**

### ConversationHub (conversation-hub/hub.js)
```
HubOrchestrator (orchestrator.js):
├── emit('session_created', session)  → bridge→bus: HUB_SESSION_CREATED
├── emit('session_closed', sessionId) → bridge→bus: HUB_SESSION_CLOSED
├── emit('turn_sent', turn)           → bridge→bus: HUB_TURN_SENT
├── emit('turn_complete', turn)       → bridge→bus: HUB_TURN_COMPLETE
├── emit('user_injected', msg)        → bridge→bus: HUB_USER_INJECTED
└── emit('error', err)                → bridge→bus: HUB_ERROR
```

### Services (diretos ao EventBus)
```
services/session-service.js:
├── bus.emit({ type: 'session:create' })
├── bus.emit({ type: 'session:disconnect' })
└── bus.emit({ type: 'session:resume' })

services/conversation-service.js:
└── bus.emit({ type: 'session:message' })

services/tool-service.js:
└── bus.emit({ type: 'tool:build' })

services/audit-service.js:
└── bus.emit({ type: AUDIT_LOG })
```

### PinnedFilesLoader (config/pinned-files.js + terminal/index.js)
```
pinnedLoader.emit('changed', files) → bridge→bus: CONFIG_PINNED_FILES_CHANGED
```

---

## 4. Mapa de Consumidores (Who listens to what)

### Via EventBus.on() (registros em event-bus-observers.js)
```
AGENT_READY             → log INFO
AGENT_DIALOG_LOOP_CHANGED → log DEBUG
AGENT_DIALOG_STALLED    → log WARN
AGENT_DIALOG_TURN_TIMEOUT → log WARN
HOOK_PRE_TOOL_USE       → ❌ NUNCA DISPARA (HookBus não bridgeado)
HOOK_POST_TOOL_USE      → ❌ NUNCA DISPARA
HOOK_SESSION_START      → ❌ NUNCA DISPARA
HOOK_SESSION_END        → ❌ NUNCA DISPARA
HOOK_ERROR_OCCURRED     → ❌ NUNCA DISPARA
AGENT_HANDOFF_RECEIVED  → log INFO
AGENT_HANDOFF_ACCEPTED  → log INFO
AGENT_HANDOFF_REJECTED  → log WARN
HUB_SESSION_CREATED     → log INFO
HUB_SESSION_CLOSED      → log INFO
CONFIG_PINNED_FILES_CHANGED → log INFO
```

### Via AlwaysAliveAgent EventEmitter (agent-event-observer.js)
```
dialog.turn_start   → metrics: dialog turn counter
dialog.turn_end     → metrics: dialog turn duration
dialog.stalled      → metrics: stall counter
dialog.turn_timeout → metrics: timeout counter
task.completed      → metrics: task success counter
task.error          → metrics: task error counter
permission.mode_changed → metrics: permission changes
session.fatal       → metrics: fatal counter
agent.metrics       → metrics: sync
```

### Via NERV bridge (bridges/nerv-bridge.js)
```
62 eventos do AlwaysAliveAgent → NERV.emitEvent(envelope)
NERV 'COPILOT_COMMAND' → agent.[sendMessage|pause|resume|restart]()
```

### Via observability/observers/ (collectors)
```
dialog-task-handlers.js:  dialog.turn_start/end, task.*
session-agent-handlers.js: session.*, agent.*
context.js: context manipulation events
```

---

## 5. Análise de Gaps Críticos

### GAP-EVENTS-01: HookBus desconectado do EventBus (CRÍTICO)
**Problema**: `hooks/bus.js` emite eventos localmente via `BaseEmitter`, mas nunca chama
`bus.emit()`. Os 5 subscribers de HOOK_* em `event-bus-observers.js` **nunca disparam**.
**Impacto**: Observabilidade de hooks completamente cega no EventBus.
**Solução**: Bridge `HookBus → EventBus` após cada `emitHook()` call.

### GAP-EVENTS-02: NERV e EventBus operam em silos (ALTO)
**Problema**: NERV bridge conecta ao `AlwaysAliveAgent` diretamente via EventEmitter.
O EventBus é um sistema paralelo sem conexão ao NERV.
**Impacto**:
- Eventos do EventBus não chegam ao NERV
- Comandos do NERV vão diretamente para o agent sem passar pelo EventBus
- Impossível monitorar via EventBus o que o NERV está fazendo
**Solução**: Bridge `EventBus → NERV` para eventos selecionados + `NERV → EventBus` para inbounds

### GAP-EVENTS-03: SDK events invisíveis (MÉDIO)
**Problema**: 74 tipos de eventos do SDK (session.on) e 5 lifecycle events (client.on)
nunca chegam ao EventBus.
**Impacto**: Impossível observar streaming, tool execution, assistant responses via EventBus.
**Solução**: `sdk/session-event-bridge.js` que bridgeia eventos selecionados ao EventBus.

### GAP-EVENTS-04: Strings hardcoded em services (MÉDIO)
**Problema**: `services/` emit eventos com strings inline (`'session:create'`, `'tool:build'`).
Estes eventos não estão no SSOT `events/index.js`.
**Impacto**: Strings espalhadas, inconsistência de naming (namespace `:` vs `.` vs `_`).
**Solução**: Adicionar `SERVICE_SESSION_CREATE`, `SERVICE_TOOL_BUILD`, etc. ao SSOT.

### GAP-EVENTS-05: EventFanout desconectado (MÉDIO)
**Problema**: `api/sse/fanout.js` tem seu próprio EventEmitter para multi-processo,
mas não está integrado ao EventBus.
**Impacto**: SSE fanout opera completamente isolado.
**Solução**: EventFanout pode subscrever ao EventBus e repassar para SSE clients.

### GAP-EVENTS-06: Inconsistência de namespace (MÉDIO)
**Problema**: Dois padrões coexistem:
- `events/agent-events.js`: prefixo `agent:` (SSOT correto)
- `AGENT_EVENTS` array (legacy): sem prefixo (`'ready'`, `'task.started'`, `'dialog.stalled'`)
- `services/`: namespace com `:` (session:create)
- `hooks/bus.js`: snake_case sem namespace (`pre_tool_use`)
- `nerv-bridge`: camelCase sem namespace (`COPILOT_AGENT_READY`)
**Impacto**: Handlers em diferentes sistemas usam formatos incompatíveis.
**Solução**: Padronizar todos para `namespace:action` (snake_case) no SSOT.

### GAP-EVENTS-07: Wildcards não aproveitados (BAIXO)
**Problema**: EventBus suporta `session:*` e `*`, mas nenhum consumer usa wildcards.
Todos os subscribers em `event-bus-observers.js` usam strings exatas.
**Impacto**: Perda de expressividade e legibilidade.
**Solução**: Refatorar observers para usar wildcards onde faz sentido.

### GAP-EVENTS-08: Middleware não utilizado (BAIXO)
**Problema**: EventBus tem suporte a middleware chain (`bus.use(fn)`), mas não há nenhum
middleware registrado em produção.
**Impacto**: Oportunidade perdida para logging, tracing, validação de schema.
**Solução**: Registrar middleware de logging condicional e tracing no EventBus.

### GAP-EVENTS-09: Sem diagnóstico de listeners (BAIXO)
**Problema**: `bus.listenerCount` retorna o total, mas não lista quais event types têm
handlers, nem quem os registrou.
**Impacto**: Impossível auditar o estado do EventBus em runtime.
**Solução**: Adicionar `bus.diagnostics()` que retorna mapa completo de listeners.

### GAP-EVENTS-10: Subscribers de FAIXA-2D só logam (MÉDIO)
**Problema**: Os 15 subscribers de `event-bus-observers.js` apenas fazem `log()`.
Não alimentam métricas, não atualizam estado, não reagem operacionalmente.
**Impacto**: EventBus observa mas não age — observabilidade sem consequência.
**Solução**: Conectar subscribers a MetricsStore, ErrorTracker, HealthCheck.

---

## 6. Inventário Numérico

| Métrica                                                   | Valor atual    |
| --------------------------------------------------------- | -------------- |
| Event types únicos no SSOT (`events/`)                    | 52 constantes  |
| Event strings no AGENT_EVENTS array (legacy)              | ~65 strings    |
| Eventos com bridge → EventBus                             | 26 (8+8+3+6+1) |
| Eventos sem bridge (emitters locais)                      | ~40+           |
| Event types no NERV EVENT_MAP                             | 62             |
| Subscribers no EventBus (event-bus-observers)             | 15             |
| Subscribers que NUNCA disparam (hook gap)                 | 5              |
| Subscribers que alimentam métricas (agent-event-observer) | 9              |
| Strings hardcoded fora do SSOT                            | ~18            |
| Middlewares registrados no EventBus                       | 0              |
| Wildcards em uso                                          | 0              |

---

## 7. Arquitetura de Eventos Atual (Diagrama Textual)

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SISTEMA DE EVENTOS ATUAL                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────┐    ┌─────────────────────┐               │
│  │  AlwaysAliveAgent   │    │   SDK Session (74   │               │
│  │  (BaseEmitter)      │    │   event types)      │               │
│  │  ~65 event strings  │    │   ❌ NOT BRIDGED     │               │
│  └────────┬────────────┘    └─────────────────────┘               │
│           │                                                         │
│      bridgeEmitter (8)    ┌──────────────────────┐                │
│           │               │ DialogLoopManager    │                 │
│           │         bridge│ (BaseEmitter, 8 evts)│                 │
│           │      (8 evts)─┤ via always-alive.js  │                 │
│           │               └──────────────────────┘                 │
│           │      bridgeEmitter (3)                                  │
│           │               ┌──────────────────────┐                │
│           │         bridge│ HandoffManager       │                 │
│           │      (3 evts)─┤ (BaseEmitter)        │                 │
│           │               └──────────────────────┘                 │
│           │                                                         │
│           │      ┌─────────────────────────────────┐              │
│           │      │         EventBus (SSOT)          │              │
│           └─────►│  on() → unsubscribe pattern     │              │
│                  │  wildcards: ns:*, *             │              │
│                  │  middleware: NONE (0 registered)│              │
│                  │  subscribers: 15 registered     │              │
│                  │  (5 NEVER FIRE — hook gap)      │              │
│                  └────────────┬────────────────────┘              │
│                               │                                     │
│         ┌─────────────────────┤                                     │
│         │                     │                                     │
│   event-bus-observers   agent-event-observer                       │
│   (log only, 15 subs)   (metrics, 9 subs via EventEmitter)        │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────┐             │
│  │ HookBus (6 events)   │    │ ConversationHub      │             │
│  │ ❌ NOT BRIDGED       │    │ (orchestrator)       │             │
│  │ to EventBus          │    │ bridged (6 events)   │             │
│  └──────────────────────┘    └──────────────────────┘             │
│                                                                     │
│  ┌──────────────────────────────────────────────────┐             │
│  │ NERV Bridge (nerv-bridge.js)                      │             │
│  │ AlwaysAliveAgent → NERV (62 events, outbound)     │             │
│  │ NERV → agent (COPILOT_COMMAND, inbound)           │             │
│  │ ❌ NÃO conectado ao EventBus                      │             │
│  │ ❌ EventBus events NÃO chegam ao NERV             │             │
│  └──────────────────────────────────────────────────┘             │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────┐             │
│  │ EventFanout (SSE)    │    │ terminal/state.js    │             │
│  │ ❌ NOT BRIDGED       │    │ ❌ NOT BRIDGED        │             │
│  └──────────────────────┘    └──────────────────────┘             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8. Inconsistências de Naming

### Padrões coexistentes (4 formatos distintos)

1. **SSOT (`events/`)**: `agent:ready`, `agent:dialog:stalled` — `namespace:action`
2. **Legacy AGENT_EVENTS array**: `ready`, `task.started`, `dialog.stalled` — `action` ou `domain.action`
3. **Services inline**: `session:create`, `tool:build` — `namespace:action` (coerente com SSOT mas sem constante)
4. **HookBus**: `pre_tool_use`, `session_start` — `snake_case` sem namespace
5. **NERV**: `COPILOT_AGENT_READY`, `COPILOT_TASK_STARTED` — `UPPER_SNAKE_CASE` com prefixo `COPILOT_`

### Conflitos identificados

| Evento no SSOT            | Equivalente legacy  | Equivalente NERV         |
| ------------------------- | ------------------- | ------------------------ |
| `agent:ready`             | `ready`             | `COPILOT_AGENT_READY`    |
| `agent:dialog:stalled`    | `dialog.stalled`    | `COPILOT_DIALOG_STALLED` |
| `agent:session:keepalive` | `session.keepalive` | —                        |
| `hook:pre_tool_use`       | `pre_tool_use`      | —                        |

---

**Próximo documento**: [PARTE-23L-B-EVENTS-GRAFO.md](PARTE-23L-B-EVENTS-GRAFO.md) — Grafo completo de dependências
