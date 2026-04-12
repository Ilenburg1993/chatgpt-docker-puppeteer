# PARTE-23L-C — Events System: Situação Ideal v2.0

**Data**: 2026-04-12 | **Status**: Design | **Versão**: 2.0 (pós-L1–L8)
**Precedente**: PARTE-23L-A v2.0 (re-auditoria) + PARTE-23L-B v2.0 (grafos)

---

## 1. Princípios (revisados)

1. **Single Source of Truth (SSOT)**: Toda constante de evento em `events/*.js`
2. **Single Path (SP)**: Cada evento segue UM ÚNICO caminho até o EventBus — zero duplicação
3. **Full Coverage (FC)**: Zero eventos perdidos — tudo que é emitido chega ao EventBus
4. **Single NERV Path (SNP)**: EventBus → NERV (adapter). Legado removido.
5. **Observer Migration (OM)**: Observers migram de EventEmitter direto → EventBus
6. **Namespace Consistency (NC)**: Tudo com separador `:`, formato `namespace:domain:action`
7. **Operational Intelligence (OI)**: Subscribers fazem mais que log — métricas, health, alertas

---

## 2. Arquitetura Ideal — Fluxo Unificado

### 2.1 Design: Single-Path SDK → EventBus

```
SDK Session (74+ events)
    │
    │ event-handlers/ (25 consumidos, callbacks.emit → host.emit)
    ▼
AlwaysAliveAgent EventEmitter (~52 events)
    │
    │ bridgeEmitter COMPLETO (52 → 52 SSOT constants, ZERO perdidos)
    ▼
EventBus (SSOT Central)
    │
    ├── Middlewares (pipeline)
    │   ├── timestamp-enricher (L6 existente)
    │   ├── schema-validator (L6 existente)
    │   ├── rate-limiter (L6 existente)
    │   ├── [NOVO] correlation-id-injector (rastreio end-to-end)
    │   └── [NOVO] otel-span-propagator (distributed tracing)
    │
    ├── Observers (via bus.on)
    │   ├── MetricsCollector → alimenta defaultMetrics
    │   ├── ErrorAlerter → alerta em session.error, session.fatal
    │   ├── HealthUpdater → atualiza health score em tempo real
    │   └── ActivityTracker → atualiza last-activity timestamps
    │
    └── NervEventBusAdapter (ÚNICO path, nerv-bridge REMOVIDO)
        └── ~82 outbound mappings → NERV bus
```

### 2.2 Eliminação do SdkSessionBridge

O SdkSessionBridge (L5) cria um **segundo caminho** SDK→EventBus que:
- Duplica eventos que já chegam via event-handlers→agent→bridge
- Usa namespace `sdk:*` diferente do `agent:*`
- Nunca teve `attach()` chamado em produção

**Decisão**: Remover SdkSessionBridge. Manter apenas o Caminho A (event-handlers → agent → bridge).
Os 18 eventos do SdkSessionBridge são um subconjunto dos 25 já consumidos por event-handlers.

### 2.3 Eliminação do nerv-bridge.js legado

Após o bridgeEmitter cobrir todos ~52 eventos do agent, o NervEventBusAdapter (via EventBus)
terá cobertura completa. O nerv-bridge.js direto pode ser removido:

**Antes** (duplicação):
```
Agent ──→ nerv-bridge (62 direto)  ──→ NERV (envelope 1)
Agent ──→ bridge ──→ EventBus ──→ NervAdapter ──→ NERV (envelope 2)
```

**Depois** (single path):
```
Agent ──→ bridge ──→ EventBus ──→ NervAdapter ──→ NERV (envelope único)
```

### 2.4 Migração de Observers para EventBus

Atualmente, `session-agent-handlers.js` e `dialog-task-handlers.js` escutam o Agent
EventEmitter diretamente (50 events). Na situação ideal:

```
ATUAL:
  agent.on('dialog.turn_start', handler)  ← observer
  + bus.on('agent:dialog:turn_start', handler)  ← event-bus-observer
  = DUPLICAÇÃO

IDEAL:
  bus.on('agent:dialog:turn_start', handler)  ← observer unificado (via EventBus)
  (agent.on removido para observers — só bridgeEmitter escuta direto)
```

---

## 3. SSOT Completo — Constantes Necessárias

### 3.1 Constantes Faltantes (28 events perdidos → SSOT)

```javascript
// events/agent-events.js — adições necessárias

// ── Assistant (vindos do SDK) ──────────────────────────────────────────
export const AGENT_ASSISTANT_TURN_START = 'agent:assistant:turn_start';
export const AGENT_ASSISTANT_TURN_END = 'agent:assistant:turn_end';
export const AGENT_ASSISTANT_INTENT = 'agent:assistant:intent';
export const AGENT_ASSISTANT_REASONING_COMPLETE = 'agent:assistant:reasoning_complete';

// ── Session (vindos do SDK, não bridgeados) ───────────────────────────
export const AGENT_SESSION_ERROR = 'agent:session:error';
export const AGENT_SESSION_SHUTDOWN = 'agent:session:shutdown';
export const AGENT_SESSION_HANDOFF = 'agent:session:handoff';
export const AGENT_SESSION_TASK_COMPLETE = 'agent:session:task_complete';
export const AGENT_SESSION_CONTEXT_CHANGED = 'agent:session:context_changed';
export const AGENT_SESSION_TRUNCATION = 'agent:session:truncation';
export const AGENT_SESSION_CLEANUP = 'agent:session:cleanup';

// ── Subagent ──────────────────────────────────────────────────────────
export const AGENT_SUBAGENT_STARTED = 'agent:subagent:started';
export const AGENT_SUBAGENT_COMPLETED = 'agent:subagent:completed';
export const AGENT_SUBAGENT_FAILED = 'agent:subagent:failed';

// ── Dialog (faltantes) ───────────────────────────────────────────────
export const AGENT_DIALOG_DELTA = 'agent:dialog:delta';
export const AGENT_DIALOG_BOOT_RECOVERY = 'agent:dialog:boot_recovery';

// ── Abort / Elicitation ──────────────────────────────────────────────
export const AGENT_ABORT = 'agent:abort';
export const AGENT_ELICITATION_PENDING = 'agent:elicitation:pending';

// ── Background / Shell (system-notifications) ────────────────────────
export const AGENT_BACKGROUND_COMPLETED = 'agent:background:completed';
export const AGENT_BACKGROUND_IDLE = 'agent:background:idle';
export const AGENT_SHELL_COMPLETED = 'agent:shell:completed';
export const AGENT_SHELL_DETACHED_COMPLETED = 'agent:shell:detached_completed';

// ── Infra / Misc ─────────────────────────────────────────────────────
export const AGENT_SDK_LIFECYCLE = 'agent:sdk:lifecycle';
export const AGENT_MCP_RECONNECTED = 'agent:mcp:reconnected';
export const AGENT_QUOTA_WARNING = 'agent:quota:warning';
export const AGENT_STEERING_SENT = 'agent:steering:sent';
```

**Total**: 26 novas constantes (excluindo `__processQueue` e `status` que são internos)

### 3.2 Constantes a Remover (SDK namespace)

```javascript
// events/sdk-events.js — REMOVER INTEIRO (SdkSessionBridge será removido)
// SDK_SESSION_START, SDK_SESSION_IDLE, ... → todos removidos
// SDK_SESSION_TO_EVENTBUS → removido
```

### 3.3 BridgeEmitter Expandido (always-alive.js)

O bridgeEmitter deve incluir TODOS os 52 events:
```javascript
bridgeEmitter(alwaysAliveAgent, bus, {
    // ... (38 existentes) ...
    // + 26 novos:
    'assistant.turn_start': AGENT_ASSISTANT_TURN_START,
    'assistant.turn_end': AGENT_ASSISTANT_TURN_END,
    'assistant.intent': AGENT_ASSISTANT_INTENT,
    'assistant.reasoning_complete': AGENT_ASSISTANT_REASONING_COMPLETE,
    'session.error': AGENT_SESSION_ERROR,
    'session.shutdown': AGENT_SESSION_SHUTDOWN,
    'session.handoff': AGENT_SESSION_HANDOFF,
    'session.task_complete': AGENT_SESSION_TASK_COMPLETE,
    'session.context_changed': AGENT_SESSION_CONTEXT_CHANGED,
    'session.truncation': AGENT_SESSION_TRUNCATION,
    'session.cleanup': AGENT_SESSION_CLEANUP,
    'subagent.started': AGENT_SUBAGENT_STARTED,
    'subagent.completed': AGENT_SUBAGENT_COMPLETED,
    'subagent.failed': AGENT_SUBAGENT_FAILED,
    'dialog.delta': AGENT_DIALOG_DELTA,
    'dialog.boot_recovery': AGENT_DIALOG_BOOT_RECOVERY,
    'abort': AGENT_ABORT,
    'elicitation.pending': AGENT_ELICITATION_PENDING,
    'agent.background.completed': AGENT_BACKGROUND_COMPLETED,
    'agent.background.idle': AGENT_BACKGROUND_IDLE,
    'agent.shell.completed': AGENT_SHELL_COMPLETED,
    'agent.shell.detached_completed': AGENT_SHELL_DETACHED_COMPLETED,
    'sdk.lifecycle': AGENT_SDK_LIFECYCLE,
    'mcp.reconnected': AGENT_MCP_RECONNECTED,
    'quota.warning': AGENT_QUOTA_WARNING,
    'steering.sent': AGENT_STEERING_SENT,
});
```

---

## 4. NERV Map Expandido (nerv-events.js)

O EVENTBUS_TO_NERV deve incluir as 26 novas constantes:

```javascript
// Adições ao EVENTBUS_TO_NERV (nerv-events.js):
[AGENT_ASSISTANT_TURN_START]: 'COPILOT_ASSISTANT_TURN_START',
[AGENT_ASSISTANT_TURN_END]: 'COPILOT_ASSISTANT_TURN_END',
[AGENT_ASSISTANT_INTENT]: 'COPILOT_ASSISTANT_INTENT',
[AGENT_ASSISTANT_REASONING_COMPLETE]: 'COPILOT_ASSISTANT_REASONING_COMPLETE',
[AGENT_SESSION_ERROR]: 'COPILOT_SESSION_ERROR',
[AGENT_SESSION_SHUTDOWN]: 'COPILOT_SESSION_SHUTDOWN',
[AGENT_SESSION_HANDOFF]: 'COPILOT_SESSION_HANDOFF',
[AGENT_SESSION_TASK_COMPLETE]: 'COPILOT_SESSION_TASK_COMPLETE',
[AGENT_SESSION_CONTEXT_CHANGED]: 'COPILOT_SESSION_CONTEXT_CHANGED',
[AGENT_SESSION_TRUNCATION]: 'COPILOT_SESSION_TRUNCATION',
[AGENT_SESSION_CLEANUP]: 'COPILOT_SESSION_CLEANUP',
[AGENT_SUBAGENT_STARTED]: 'COPILOT_SUBAGENT_STARTED',
[AGENT_SUBAGENT_COMPLETED]: 'COPILOT_SUBAGENT_COMPLETED',
[AGENT_SUBAGENT_FAILED]: 'COPILOT_SUBAGENT_FAILED',
[AGENT_DIALOG_DELTA]: 'COPILOT_DIALOG_DELTA',
[AGENT_DIALOG_BOOT_RECOVERY]: 'COPILOT_DIALOG_BOOT_RECOVERY',
[AGENT_ABORT]: 'COPILOT_ABORT',
[AGENT_ELICITATION_PENDING]: 'COPILOT_ELICITATION_PENDING',
[AGENT_BACKGROUND_COMPLETED]: 'COPILOT_AGENT_BACKGROUND_COMPLETED',
[AGENT_BACKGROUND_IDLE]: 'COPILOT_AGENT_BACKGROUND_IDLE',
[AGENT_SHELL_COMPLETED]: 'COPILOT_SHELL_COMPLETED',
[AGENT_SHELL_DETACHED_COMPLETED]: 'COPILOT_SHELL_DETACHED_COMPLETED',
[AGENT_SDK_LIFECYCLE]: 'COPILOT_SDK_LIFECYCLE',
[AGENT_MCP_RECONNECTED]: 'COPILOT_MCP_RECONNECTED',
[AGENT_QUOTA_WARNING]: 'COPILOT_QUOTA_WARNING',
[AGENT_STEERING_SENT]: 'COPILOT_STEERING_SENT',
```

---

## 5. Observer Migration Plan

### 5.1 Fase 1: Criar EventBus-based observers

Criar `observability/observers/eventbus-metrics-handlers.js` que subscreve via `bus.on()`:

```javascript
export function attachEventBusMetricsHandlers(bus, metrics, errorTracker) {
    // Substitui session-agent-handlers + dialog-task-handlers
    // usando EventBus em vez de agent.on()
    bus.on('agent:dialog:turn_start', () => metrics.recordDialogTurnStart());
    bus.on('agent:dialog:turn_end', (evt) => metrics.recordDialogTurnDuration(evt.durationMs));
    bus.on('agent:task:completed', () => metrics.recordTaskSuccess());
    bus.on('agent:task:error', () => metrics.recordTaskError());
    bus.on('agent:session:fatal', (evt) => {
        metrics.recordFatal();
        errorTracker.track(evt);
    });
    // ... (todos os 50 events migrados)
}
```

### 5.2 Fase 2: Deprecar observers diretos

Marcar `session-agent-handlers.js` e `dialog-task-handlers.js` como deprecated:
- Manter por 1-2 releases como fallback
- Logging de warning se ambos estiverem ativos
- Remover quando todos os consumers migrarem

### 5.3 Fase 3: Remover observers diretos

Remover `attachSessionAgentHandlers` e `attachDialogTaskHandlers` completamente.
Remover `agent-event-observer.js` (factory que cria o observer).
O `boot-wiring.js` não precisa mais de `agentObserver.attach(agentEmitter)`.

---

## 6. Operational Subscribers Design

### 6.1 HealthSubscribers

```javascript
// Reage a eventos de saúde do sistema
bus.on('agent:session:error', () => healthManager.degrade('session_error'));
bus.on('agent:session:fatal', () => healthManager.critical('session_fatal'));
bus.on('agent:ready', () => healthManager.recover());
bus.on('agent:session:compaction_complete', (evt) => {
    if (!evt.success) healthManager.degrade('compaction_failed');
});
```

### 6.2 AutoHealSubscribers

```javascript
// Reações automáticas a condições adversas
bus.on('agent:dialog:stalled', (evt) => {
    if (evt.stalledMs > FORCE_RESTART_THRESHOLD) {
        bus.emit({ type: 'system:auto_heal', action: 'force_deactivate' });
    }
});
bus.on('agent:quota:warning', () => {
    bus.emit({ type: 'system:auto_heal', action: 'reduce_parallelism' });
});
```

### 6.3 AuditSubscribers

```javascript
// Log estruturado para auditoria
bus.on('agent:*', (evt) => {
    auditLogger.append({
        type: evt.type,
        timestamp: evt.timestamp,
        correlationId: evt._correlationId,
        source: evt._source,
    });
});
```

---

## 7. Métricas de Sucesso

| Métrica                                  | Atual | Ideal | Critério |
|------------------------------------------|-------|-------|----------|
| Events no EventBus (agent-emitted)       | 38/52 | 52/52 | 100%     |
| Events duplicados (sdk: + agent:)        | 6     | 0     | 0        |
| NERV outbound paths                      | 2     | 1     | 1        |
| NERV envelope duplicação                 | 38    | 0     | 0        |
| Observer paths (direto + EventBus)       | 2     | 1     | 1        |
| Namespace formatos                       | 4     | 1     | 1        |
| EventBus-observers com ação real         | 0/15  | 15/15 | 100%     |
| SSOT coverage (events/ vs inline)        | 85%   | 100%  | 100%     |

---

## 8. Riscos e Mitigações

| Risco                                        | Mitigação                                    |
|----------------------------------------------|----------------------------------------------|
| Remoção do nerv-bridge quebra NERV           | Teste de cobertura: verificar todos 62 events do legado estão no adapter |
| Remoção do SdkSessionBridge perde sdk:*      | Verificar que nenhum consumer depende de `sdk:*` events |
| Observer migration pode perder handlers      | Diff line-by-line entre old e new observers  |
| Rate-limiter suprime events legítimos        | Monitorar via diagnostics() e ajustar thresholds |
| bridgeEmitter com 52+ entries fica lento     | Benchmark: bridgeEmitter é O(1) lookup per emit |
