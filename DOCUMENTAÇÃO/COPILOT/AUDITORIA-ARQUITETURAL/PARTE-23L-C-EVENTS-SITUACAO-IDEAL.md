# PARTE-23L-C — Events System: Situação Ideal + Integração NERV

**Data**: 2026-04-12 | **Status**: Proposta | **Versão**: 1.0
**Contexto**: Subparte especial PARTE-23 — visão ideal do sistema de eventos robusto

---

## 1. Princípios do Sistema Ideal

### 1.1 Single Source of Truth (SSOT)
- ✅ Todas as strings de eventos definidas **exclusivamente** em `events/`
- ✅ Zero strings inline fora do barrel `#copilot/events`
- ✅ Namespaces consistentes: `namespace:action` ou `namespace:sub:action`

### 1.2 Bus Unificado como Backbone
- ✅ **EventBus é o backbone** — toda comunicação cross-module passa por ele
- ✅ NERV **integra via EventBus** (não via EventEmitter direto)
- ✅ HookBus bridgeado ao EventBus
- ✅ SDK events bridgeados ao EventBus (eventos selecionados)
- ✅ Wildcards e catch-all usados onde faz sentido

### 1.3 Observabilidade Completa
- ✅ Todos os eventos têm pelo menos 1 subscriber significativo (não só log)
- ✅ Middleware de tracing registrado no EventBus
- ✅ `bus.diagnostics()` disponível em runtime para auditoria
- ✅ Metrics para eventos críticos (não apenas contadores)

### 1.4 Operacionalidade (não só observabilidade)
- ✅ Subscribers que tomam **ação** além de logar
- ✅ Handlers de saúde: degraded events → health check trigger
- ✅ Handlers de shutdown: shutdown events → graceful teardown
- ✅ Handlers de alerting: error events → error tracker + alerter

### 1.5 Robustez
- ✅ Timeout por handler (handler lento não bloqueia)
- ✅ Circuit breaker por handler com muitos erros
- ✅ Dead letter: eventos que falham em todos os handlers → log estruturado
- ✅ Backpressure: buffer de eventos quando bus saturado

---

## 2. Arquitetura Ideal: Visão Geral

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ARQUITETURA IDEAL DE EVENTOS                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                    CAMADA DE EMISSORES                             │    │
│  │                                                                    │    │
│  │  AlwaysAliveAgent  DialogLoop  HandoffManager  HookBus            │    │
│  │  HubOrchestrator   PinnedFiles Services        SDK Session        │    │
│  │  SDK Client        EventFanout terminal/state  shared-state       │    │
│  └─────────────────────────┬──────────────────────────────────────────┘    │
│                             │ bridgeEmitter() ou bus.emit() direto          │
│  ┌──────────────────────────▼─────────────────────────────────────────┐    │
│  │                  MIDDLEWARE CHAIN (NOVO)                           │    │
│  │  [1] SchemaValidator  — valida shape do payload                    │    │
│  │  [2] TimestampEnricher — garante timestamp, correlationId          │    │
│  │  [3] TracingMiddleware — adiciona tracing se OpenTelemetry ativo   │    │
│  │  [4] RateLimiter      — limita eventos high-frequency no bus       │    │
│  └──────────────────────────┬─────────────────────────────────────────┘    │
│                             │                                              │
│  ┌──────────────────────────▼─────────────────────────────────────────┐    │
│  │                    EVENTBUS (CORE — MELHORADO)                     │    │
│  │                                                                    │    │
│  │  on(type, handler) → unsubscribe                                  │    │
│  │  once(type, handler)                                              │    │
│  │  emit({ type, ...payload })                                       │    │
│  │  use(middleware)                                                  │    │
│  │  stats() → contadores                                            │    │
│  │  diagnostics() → NOVO: mapa handlers registrados    ← NOVO       │    │
│  │  channels() → NOVO: tipos com subscribers           ← NOVO       │    │
│  │  replay(type, n) → NOVO: replay últimos n eventos   ← NOVO       │    │
│  │  pipe(targetBus) → NOVO: encaminhar eventos         ← NOVO       │    │
│  └──────────────────────────┬─────────────────────────────────────────┘    │
│                             │                                              │
│  ┌──────────────────────────▼─────────────────────────────────────────┐    │
│  │                    CAMADA DE CONSUMERS                             │    │
│  │                                                                    │    │
│  │  ┌────────────────┐  ┌───────────────────┐  ┌──────────────────┐ │    │
│  │  │ Observability  │  │  Operational      │  │  NERV Bridge     │ │    │
│  │  │ (log+metrics)  │  │  (health, alerts, │  │  (EventBus→NERV) │ │    │
│  │  │ 15+ subscribers│  │   shutdown, etc.) │  │  UNIFIED         │ │    │
│  │  └────────────────┘  └───────────────────┘  └──────────────────┘ │    │
│  │                                                                    │    │
│  │  ┌────────────────┐  ┌───────────────────┐  ┌──────────────────┐ │    │
│  │  │ SSE Fanout     │  │  Plugin Subscribe │  │  External        │ │    │
│  │  │ (EventBus→SSE) │  │  points           │  │  Webhooks        │ │    │
│  │  └────────────────┘  └───────────────────┘  └──────────────────┘ │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Design Ideal da Integração NERV

### 3.1 Problema atual

```
ATUAL (problemático):
AlwaysAliveAgent.EventEmitter → nerv-bridge → NERV
                ↕ (sem conexão)
EventBus → observers (silos)
```

### 3.2 Solução ideal: NERV como Consumer do EventBus

```
IDEAL:
AlwaysAliveAgent.EventEmitter → bridges → EventBus ────────────→ NERV
                                         ↑              via NervEventBusAdapter
HookBus → bridge → EventBus ────────────┘
SDK Session → adapter → EventBus ───────┘
Hub → bridge → EventBus ────────────────┤
                                         └────────────→ Observability
                                         └────────────→ SSE Fanout
                                         └────────────→ Other consumers
```

### 3.3 NervEventBusAdapter (módulo a criar)

**Localização**: `bridges/nerv-event-bus-adapter.js`

**Responsabilidades**:
1. Subscrever ao EventBus para eventos selecionados
2. Converter de `{ type: 'agent:ready', ...payload }` para `{ actionCode: 'COPILOT_AGENT_READY', actor: 'COPILOT', ... }`
3. Chamar `nerv.emitEvent(envelope)` para cada evento recebido
4. Receber comandos inbound do NERV e emitir no EventBus (direção oposta)
5. Inbound NERV → EventBus → Agent (em vez de NERV → Agent direto)

**Mapa de conversão** (EventBus type → NERV actionCode):
```javascript
const EVENTBUS_TO_NERV = {
  [AGENT_READY]:                'COPILOT_AGENT_READY',
  [AGENT_BEFORE_STOP]:          'COPILOT_AGENT_BEFORE_STOP',
  [AGENT_STOPPED]:              'COPILOT_SESSION_STOPPED',
  [AGENT_ERROR]:                'COPILOT_AGENT_ERROR',
  [AGENT_DIALOG_STALLED]:       'COPILOT_DIALOG_STALLED',
  [AGENT_DIALOG_LOOP_CHANGED]:  'COPILOT_DIALOG_LOOP_CHANGED',
  [AGENT_HANDOFF_RECEIVED]:     'COPILOT_HANDOFF_RECEIVED',
  [HUB_SESSION_CREATED]:        'COPILOT_HUB_SESSION_CREATED',
  [HUB_SESSION_CLOSED]:         'COPILOT_HUB_SESSION_CLOSED',
  [HOOK_PRE_TOOL_USE]:          'COPILOT_HOOK_PRE_TOOL_USE',
  [HOOK_POST_TOOL_USE]:         'COPILOT_HOOK_POST_TOOL_USE',
  [HOOK_ERROR_OCCURRED]:        'COPILOT_HOOK_ERROR_OCCURRED',
  [CONFIG_PINNED_FILES_CHANGED]:'COPILOT_CONFIG_CHANGED',
  [HEALTH_DEGRADED]:            'COPILOT_HEALTH_DEGRADED',
  [SYSTEM_SHUTDOWN_STARTED]:    'COPILOT_SHUTDOWN_STARTED',
};
```

**Inbound NERV → EventBus** (novo):
```javascript
// NERV 'COPILOT_COMMAND' → EventBus 'nerv:command:{command}'
nerv.onEvent('COPILOT_COMMAND', envelope => {
  bus.emit({
    type: `nerv:command:${envelope.payload.command}`,
    ...envelope.payload
  });
});
```

### 3.4 Benefícios da arquitetura unificada

| Aspecto                      | Atual                     | Ideal            |
| ---------------------------- | ------------------------- | ---------------- |
| Caminhos de evento           | 2 (EventEmitter+EventBus) | 1 (só EventBus)  |
| NERV recebe Hub events       | ❌                         | ✅                |
| NERV recebe Hook events      | ❌                         | ✅                |
| NERV recebe Config events    | ❌                         | ✅                |
| Inbound NERV auditável       | ❌ (direto ao agent)       | ✅ (via EventBus) |
| Middleware trata NERV events | ❌                         | ✅                |
| NERV como plugin plugável    | ❌                         | ✅                |

---

## 4. HookBus Bridge (fix crítico)

### 4.1 Módulo atual

```javascript
// hooks/bus.js (atual — BUGADO)
emitHook(hookName, sessionId, input, output) {
    const event = { hookName, sessionId, timestamp: Date.now(), input, output };
    try {
        this.emit(hookName, event);  // só local
        this.emit('*', event);       // só local
    } catch (e) { ... }
    // ❌ nunca chama bus.emit()
}
```

### 4.2 Fix proposto

```javascript
// hooks/bus.js (ideal — com bridge)
/** @type {import('../core/event-bus.js').EventBus | null} */
#eventBus = null;

/** @param {EventBus} bus */
setEventBus(bus) { this.#eventBus = bus; }

emitHook(hookName, sessionId, input, output) {
    const event = { hookName, sessionId, timestamp: Date.now(), input, output };
    try {
        this.emit(hookName, event);
        this.emit('*', event);
        // ✅ bridge ao EventBus
        this.#eventBus?.emit({ type: HOOK_NAME_TO_EVENTBUS[hookName], ...event });
    } catch (e) { ... }
}

const HOOK_NAME_TO_EVENTBUS = {
    pre_tool_use:     HOOK_PRE_TOOL_USE,
    post_tool_use:    HOOK_POST_TOOL_USE,
    prompt_submitted: HOOK_PROMPT_SUBMITTED,
    session_start:    HOOK_SESSION_START,
    session_end:      HOOK_SESSION_END,
    error_occurred:   HOOK_ERROR_OCCURRED,
};
```

### 4.3 Wiring em observability/bootstrap.js

```javascript
// Após registrar EVENT_BUS:
const bus = container.resolve(EVENT_BUS);
const hookBusInst = container.resolve(HOOK_BUS);  // se registrado no DI
hookBusInst?.setEventBus(bus);
```

---

## 5. SDK Session Bridge (novo módulo)

### 5.1 Problema

74 tipos de evento do SDK session nunca chegam ao EventBus.
Streaming, tool invocations, assistant responses são invisíveis ao sistema de observabilidade.

### 5.2 Módulo proposto: sdk/session-event-bridge.js

```javascript
/**
 * Seleciona e bridgeia eventos da SDK session para o EventBus.
 *
 * Apenas eventos de alto valor são bridgeados (não todos os 74 para evitar overhead).
 */
const SDK_TO_EVENTBUS = {
    // Tool events
    'tool_call': 'sdk:tool:call',
    'tool_result': 'sdk:tool:result',
    // Session lifecycle
    'session.started': 'sdk:session:started',
    'session.stopped': 'sdk:session:stopped',
    // Streaming
    'message.complete': 'sdk:message:complete',
    'message.error': 'sdk:message:error',
    // Usage
    'session.usage': 'sdk:session:usage',
    // Compaction
    'context.compacted': 'sdk:context:compacted',
};

export function bridgeSdkSession(session, bus) {
    const unsubscribers = [];
    for (const [sdkEvent, busType] of Object.entries(SDK_TO_EVENTBUS)) {
        const handler = (payload) => {
            bus.emit({ type: busType, ...payload });
        };
        session.on(sdkEvent, handler);
        unsubscribers.push(() => session.off(sdkEvent, handler));
    }
    return () => unsubscribers.forEach(fn => fn());
}
```

---

## 6. EventBus Melhorado (EventBus v2)

### 6.1 Novas capacidades necessárias

#### diagnostics()
```javascript
/**
 * Retorna diagnóstico completo do bus em runtime.
 * @returns {{ type: string; listenerCount: number }[]}
 */
diagnostics() {
    return Array.from(this.#listeners.entries()).map(([type, set]) => ({
        type,
        listenerCount: set.size,
    }));
}
```

#### channels()
```javascript
/**
 * Retorna lista de event types com pelo menos 1 subscriber.
 * @returns {string[]}
 */
channels() {
    return Array.from(this.#listeners.keys()).filter(k => this.#listeners.get(k)?.size > 0);
}
```

#### replay() com circular buffer
```javascript
// EventBus mantém um circular buffer dos últimos N eventos por tipo
// Permite que subscribers "atrasados" recuperem estado recente
replay(type, n = 10) {
    return this.#eventBuffer.get(type)?.slice(-n) ?? [];
}
```

#### pipe() para composição de buses
```javascript
// Encaminha todos os eventos deste bus para outro (sem ciclos)
pipe(targetBus, filter = null) {
    return this.on('*', (event) => {
        if (!filter || filter(event)) targetBus.emit(event);
    });
}
```

#### Timeout por handler
```javascript
// Na entrega, timeout de 5s por handler assíncrono
async #deliverWithTimeout(handler, event, timeoutMs = 5000) {
    return Promise.race([
        handler(event),
        new Promise((_, rej) => setTimeout(() => rej(new Error('handler timeout')), timeoutMs))
    ]);
}
```

### 6.2 EventBus com namespace stats

```javascript
/**
 * Agrupa contadores por namespace (antes do ':').
 * @returns {Record<string, number>}
 */
statsBy Namespace() {
    const result = {};
    for (const [type, count] of this.#counters) {
        const ns = type.includes(':') ? type.split(':')[0] : '_global';
        result[ns] = (result[ns] ?? 0) + count;
    }
    return result;
}
```

---

## 7. Padronização de Namespaces (Migration Plan)

### 7.1 Padrão a adotar: snake_case com `:` (namespace:action ou namespace:sub:action)

```
Nível 1: namespace:action
  agent:ready, agent:stopped, hub:error, hook:pre_tool_use

Nível 2: namespace:domain:action (para eventos aninhados)
  agent:dialog:stalled, agent:handoff:received, hub:session:created

Nível 3: namespace:domain:sub:action (raramente necessário)
  agent:dialog:compaction:requested
```

### 7.2 Migração do AGENT_EVENTS legacy array

O array `AGENT_EVENTS` em `core/events.js` usa strings **sem namespace** (`ready`, `task.started`).
Estes são os eventos que o AlwaysAliveAgent emite via `this.emit('ready', ...)`.

**Duas opções**:

**Opção A (conservadora)**: Manter array legacy para loop dinâmico, adicionar constantes SSOT
para bridge. Atual approach — funciona mas mantém inconsistência.

**Opção B (ideal)**: Migrar TODAS as strings do array para formato `agent:*`.
Custo: ~65 strings em `alwaysAliveAgent.emit()` precisam mudar + todos os consumidores.
Benefício: Consistência total, wildcards funcionam melhor.

> **Recomendação**: Opção A no curto prazo (preservar backward-compat), Opção B como
> meta de longo prazo (FAIXA-6 ou posterior).

### 7.3 Normas para novos eventos

```javascript
// ✅ CORRETO
export const AGENT_DIALOG_STALLED = 'agent:dialog:stalled';
export const HOOK_PRE_TOOL_USE = 'hook:pre_tool_use';
export const SDK_SESSION_USAGE = 'sdk:session:usage';

// ❌ INCORRETO
const MY_EVENT = 'myEvent';          // camelCase, sem namespace
const MY_EVENT = 'my_event';        // snake_case sem namespace
const MY_EVENT = 'MY:EVENT';        // UPPER_CASE
```

---

## 8. Operational Subscribers (não só logging)

### 8.1 Categorias de subscribers operacionais

#### Health Subscribers
```javascript
bus.on(HEALTH_DEGRADED, () => {
    errorTracker.track(new Error('health degraded'), 'health-monitor');
});
bus.on('agent:*', (event) => {
    if (event.type === AGENT_ERROR) errorAlerter.alert(event.data);
});
```

#### Metrics Subscribers
```javascript
bus.on(AGENT_TASK_STARTED, (e) => metrics.inc('tasks.started'));
bus.on(AGENT_DIALOG_STALLED, (e) => metrics.inc('dialog.stalls'));
bus.on(HUB_SESSION_CREATED, (e) => metrics.inc('hub.sessions.created'));
bus.on(HOOK_ERROR_OCCURRED, (e) => metrics.inc('hooks.errors'));
```

#### Cascade Subscribers
```javascript
bus.on(SYSTEM_SHUTDOWN_STARTED, () => {
    // Trigger graceful cleanup cascade via EventBus
    bus.emit({ type: AGENT_SHUTDOWN });
    bus.emit({ type: TERMINAL_STOPPED });
});
```

#### Fanout Subscribers
```javascript
bus.on('agent:*', (event) => {
    sseClients.broadcast('agent', event);
});
bus.on('hub:*', (event) => {
    sseClients.broadcast('hub', event);
});
```

---

## 9. Design de events/index.js Ideal (v3)

```
events/
├── agent-events.js      ✅ existente (lifecycle, session, task, dialog, handoff)
├── hook-events.js       ✅ existente (6 HOOK_*)
├── hub-events.js        ✅ existente (Hub/Socket.IO)
├── terminal-events.js   ✅ existente (terminal + audit)
├── system-events.js     ✅ existente (shutdown, config, health, bridges)
├── sdk-events.js        🆕 NOVO (eventos do SDK bridgeados ao EventBus)
├── service-events.js    🆕 NOVO (session:create, tool:build, etc.)
├── nerv-events.js       🆕 NOVO (mapeamento EventBus→NERV actionCodes)
├── catalog.md           ✅ existente (documentação)
└── index.js             📝 barrel atualizado
```

### events/sdk-events.js (novo)
```javascript
export const SDK_TOOL_CALL = 'sdk:tool:call';
export const SDK_TOOL_RESULT = 'sdk:tool:result';
export const SDK_SESSION_STARTED = 'sdk:session:started';
export const SDK_SESSION_STOPPED = 'sdk:session:stopped';
export const SDK_MESSAGE_COMPLETE = 'sdk:message:complete';
export const SDK_MESSAGE_ERROR = 'sdk:message:error';
export const SDK_SESSION_USAGE = 'sdk:session:usage';
export const SDK_CONTEXT_COMPACTED = 'sdk:context:compacted';
```

### events/service-events.js (novo)
```javascript
export const SERVICE_SESSION_CREATED = 'service:session:created';
export const SERVICE_SESSION_DISCONNECTED = 'service:session:disconnected';
export const SERVICE_SESSION_RESUMED = 'service:session:resumed';
export const SERVICE_SESSION_MESSAGE = 'service:session:message';
export const SERVICE_TOOL_INVOKED = 'service:tool:invoked';
export const SERVICE_AUDIT_LOGGED = 'service:audit:logged';
```

### events/nerv-events.js (novo)
```javascript
// Mapeamento bidirecional EventBus ↔ NERV para o NervEventBusAdapter
export const EVENTBUS_TO_NERV = { ... };
export const NERV_TO_EVENTBUS = { ... };
export const NERV_COMMAND_RECEIVED = 'nerv:command:received';
export const NERV_COMMAND_SENDMESSAGE = 'nerv:command:sendMessage';
export const NERV_COMMAND_PAUSE = 'nerv:command:pause';
export const NERV_COMMAND_RESUME = 'nerv:command:resume';
```

---

## 10. Resultado Esperado (Situação Ideal)

```
ARQUITETURA IDEAL — EVENTO PERCORRE UM CAMINHO ÚNICO

AlwaysAliveAgent.emit('ready')
        │
        ▼ (via bridgeEmitter já existente)
EventBus.emit({ type: 'agent:ready', ... })
        │
        ├── [middleware] ValidateSchema → ok
        ├── [middleware] EnrichCorrelationId → correlationId: 'abc'
        ├── [middleware] TracingMiddleware → span iniciado
        │
        ├── [subscriber] event-bus-observers: log INFO ✅
        ├── [subscriber] MetricsStore: inc('agent.ready') ✅
        ├── [subscriber] HealthMonitor: mark healthy ✅
        ├── [subscriber] SseSubscribers: push to SSE clients ✅
        └── [subscriber] NervEventBusAdapter:
                NERV.emitEvent({ actionCode: 'COPILOT_AGENT_READY', ... }) ✅

NERV.onEvent('COPILOT_COMMAND', envelope)
        │
        ▼ (via NervEventBusAdapter — NOVO)
EventBus.emit({ type: 'nerv:command:sendMessage', message: '...' })
        │
        ├── [subscriber] NervCommandHandler: agent.sendMessage(message) ✅
        └── [subscriber] AuditService: log inbound command ✅
```

| Métrica                        | Atual                            | Ideal                     |
| ------------------------------ | -------------------------------- | ------------------------- |
| Caminhos de evento             | 3 (EventEmitter, EventBus, NERV) | 1 (EventBus)              |
| Eventos bridgeados ao EventBus | 26/~120                          | ~80/~120                  |
| Subscribers operacionais       | 0                                | ≥30 (log+metrics+actions) |
| Hook events no EventBus        | 0 (BUG)                          | 6                         |
| Eventos SDK no EventBus        | 0                                | 8 (selecionados)          |
| NERV via EventBus              | ❌                                | ✅                         |
| Middleware ativos              | 0                                | 3-4                       |
| Diagnóstico runtime            | ❌                                | ✅ diagnostics()           |
| Wildcards em uso               | 0                                | ~5                        |
| Strings hardcoded              | ~18                              | 0                         |

---

**Próximo documento**: [PARTE-23L-D-EVENTS-ROADMAP.md](PARTE-23L-D-EVENTS-ROADMAP.md) — Roadmap de implementação
