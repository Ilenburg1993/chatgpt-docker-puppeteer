# 11 — Agent Module: Situação Ideal Proposta

**Data**: 2026-03-21
**Escopo**: `src/copilot/agent/` — proposta de arquitetura ideal
**Referência**: [09-AGENT-LOGICA-FLUXO.md](./09-AGENT-LOGICA-FLUXO.md),
[10-AGENT-SITUACAO-ATUAL.md](./10-AGENT-SITUACAO-ATUAL.md)

---

## 1. Princípios da Proposta

1. **Preservar a decomposição funcional existente** — não reescrever do zero
2. **Resolver dívida técnica por prioridade** — god object → testes → patterns
3. **Minimizar breaking changes** — API pública do `AlwaysAliveAgent` não muda
4. **Incrementalidade** — cada fase é deployable independentemente

---

## 2. Proposta K1: Particionamento do AgentContext

### Situação atual

`AgentContext` (254L) tem 30+ campos públicos mutáveis agrupados em 7 categorias comentadas, mas
sem separação formal.

### Proposta

Particionar `AgentContext` em domínios com interfaces de leitura:

```
AgentContext
  ├── session: SessionState        (client, session, unsubs, isReconnecting)
  ├── lifecycle: LifecycleState    (status, isResumed, sendCount)
  ├── dialog: DialogState          (dialogLoop, dialogLoopAttached)
  ├── config: AgentConfigState     (model, reasoningEffort)
  ├── metrics: MetricsState        (lastPrInfo, contextState, lastCheckpointPath)
  └── managers: ManagerRefs        (messageQueue, webhooks, permissions, toolsRegistry, ...)
```

Cada sub-estado exporia:
- **Getters** para leitura segura
- **Mutation methods** com validação (ex: `session.setSession(s)` valida non-null)
- **Eventos** de mudança para invalidação de cache

**Impacto**: módulos declarariam dependências explícitas (`ctx.session` vs `ctx`) reduzindo a
superfície de acoplamento.

**Estimativa**: 8h | **Prioridade**: 🔴

---

## 3. Proposta K2: Testes Unitários para Módulos Descobertos

### Gaps identificados (doc 10, seção 6.2)

| Prioridade | Módulo | Testes Necessários |
|------------|--------|--------------------|
| 🔴 P0 | `agent-context.js` | FSM transições, setStatus, construtor |
| 🔴 P0 | `infra/message-queue.js` | FIFO, abort, drain, size, shift |
| 🔴 P0 | `session/boot-wiring.js` | 12 etapas isoladas com mocks |
| 🟠 P1 | `lifecycle/agent-lifecycle.js` | agentStop, reconnect, initSession |
| 🟠 P1 | `dialog/loop-manager.js` | pause, resume, boot recovery, force deactivate |
| 🟠 P1 | `infra/task-executor.js` | retry após reconexão, abort, timeout |
| 🟡 P2 | `infra/permission-controller.js` | mode switching approve_all/selective |
| 🟡 P2 | `infra/webhook-manager.js` | register, dispatch, retry |
| 🟡 P2 | `lifecycle/entry.js` | IPC, shutdown handlers |

**Estimativa**: 12h | **Prioridade**: 🔴

---

## 4. Proposta K3: Error Handling Centralizado

### Situação atual

5+ padrões diferentes de error handling (seção 3.2 do doc 10).

### Proposta

Criar `agent/infra/error-policy.js` com:

```js
/**
 * @param {Error} error
 * @returns {'retry' | 'fatal' | 'ignore'}
 */
export function classifyAgentError(error) { ... }

/**
 * @param {() => Promise<void>} fn
 * @param {{ onError?: (e: Error) => void; classify?: typeof classifyAgentError }} [opts]
 */
export async function withAgentErrorPolicy(fn, opts) { ... }
```

Categorias:
- **retry**: erros de rede, session disconnected, timeout → tryReconnect
- **fatal**: auth expired, session deleted, out of quota → emit session.fatal
- **ignore**: AbortError, dialog stopped by user

Migrar gradualmente os 5 padrões existentes para usar este classificador.

**Estimativa**: 4h | **Prioridade**: 🟠

---

## 5. Proposta K4: Background Task Tracker

### Situação atual

15+ `void writeStateAsync(...)` e outras operações fire-and-forget sem tracking.

### Proposta

Criar `agent/infra/background-tasks.js`:

```js
class BackgroundTaskTracker {
    /** @param {Promise<unknown>} p */
    track(p, label) { ... }

    /** Aguarda todas as tasks pendentes (para shutdown) */
    async drain(timeoutMs) { ... }

    /** Retorna contagem de tasks ativas para diagnóstico */
    get pendingCount() { ... }
}
```

Substituir `void writeStateAsync(...)` por `bgTasks.track(writeStateAsync(...), 'state.write')`.

Integrar `bgTasks.drain()` no shutdown do agente (hoje só `drainStateWrites` cobre writes de
state-io).

**Estimativa**: 3h | **Prioridade**: 🟠

---

## 6. Proposta K5: Decomposição do performBootWiring

### Situação atual

`performBootWiring()` (331L) com 12 etapas heterogêneas em uma função.

### Proposta

Extrair cada etapa como função nomeada e orquestrar via pipeline:

```js
const BOOT_PIPELINE = [
    wireSessionEventsStep,
    attachEventCollectorStep,
    attachLifecycleHandlersStep,
    attachAgentObserverStep,
    cleanupStaleSessionsStep,
    scheduleDialogRecoveryStep,
    startMetricsTimerStep,
    startMcpReconnectStep,
    startKeepaliveStep,
    startQuotaMonitorStep,
    wireHandoffStep,
    wireHookToolsRelayStep,
];

export function performBootWiring(client, session, isResumed, agentEmitter, ctx, options) {
    const result = { unsubs: [], ... };
    for (const step of BOOT_PIPELINE) {
        step(result, { client, session, isResumed, agentEmitter, ctx, options });
    }
    return result;
}
```

**Benefícios**: cada step testável isoladamente, adição de novos steps sem modificar a função
principal, logging por step.

**Estimativa**: 6h | **Prioridade**: 🟠

---

## 7. Proposta K6: Event Bridge Declarativo

### Situação atual

Bridge de ~80 eventos hardcoded no top-level de `always-alive.js` com correspondência manual
string → constant.

### Proposta

Extrair para `agent/event-bridge-map.js`:

```js
/** @type {ReadonlyArray<[localEvent: string, busEvent: symbol]>} */
export const AGENT_EVENT_BRIDGE_MAP = [
    ['ready', AGENT_READY],
    ['before-stop', AGENT_BEFORE_STOP],
    ['stopped', AGENT_STOPPED],
    // ...
];
```

E em `always-alive.js`:

```js
import { AGENT_EVENT_BRIDGE_MAP } from './event-bridge-map.js';
bridgeEmitter(alwaysAliveAgent, bus, Object.fromEntries(AGENT_EVENT_BRIDGE_MAP));
```

**Benefícios**: fonte única de verdade para mapeamento, testável, adição de eventos sem mudar
always-alive.js.

**Estimativa**: 4h | **Prioridade**: 🟡

---

## 8. Proposta K7: Health Check Formal

### Proposta

Criar `agent/infra/health-check.js`:

```js
/**
 * @typedef {Object} HealthCheckResult
 * @property {'healthy' | 'degraded' | 'unhealthy'} status
 * @property {HealthCheckItem[]} checks
 */

/**
 * @param {AgentContext} ctx
 * @returns {Promise<HealthCheckResult>}
 */
export async function runHealthCheck(ctx) {
    return {
        status: ...,
        checks: [
            { name: 'sdk_client', ok: ctx.client !== null },
            { name: 'session_active', ok: ctx.session !== null },
            { name: 'dialog_responsive', ok: !isDialogStalled(ctx) },
            { name: 'queue_not_starved', ok: !isQueueStarved(ctx) },
            { name: 'state_writable', ok: await canWriteState() },
        ],
    };
}
```

Expor via `GET /health` na API HTTP.

**Estimativa**: 3h | **Prioridade**: 🟡

---

## 9. Proposta K8: Lazy Singleton

### Situação atual

```js
export const alwaysAliveAgent = new AlwaysAliveAgent(); // Executa no import
```

Side effects no import: instancia 8+ managers, faz leitura síncrona de disco, executa top-level
await bridge.

### Proposta

```js
/** @type {AlwaysAliveAgent | null} */
let _instance = null;

export function getAgent() {
    if (!_instance) _instance = new AlwaysAliveAgent();
    return _instance;
}

/** @internal Para testes */
export function resetAgent() {
    _instance = null;
}
```

O `getAgent()` já existe mas retorna o singleton eagerly-created. A mudança para lazy mantém
backward compat via re-export.

**Trade-off**: código que faz `import { alwaysAliveAgent }` precisaria migrar para `getAgent()`.
A migração pode ser feita incrementalmente com deprecation warning.

**Estimativa**: 3h | **Prioridade**: 🟡

---

## 10. Arquitetura Ideal — Diagrama

```
┌─────────────────────────────────────────────────────────┐
│                    AlwaysAliveAgent                       │
│  (Fachada pública — 0 lógica, 100% delegação)           │
│  - API methods → facades/                                │
│  - Lifecycle → lifecycle/                                │
│  - Dialog → dialog/agent-dialog-controller               │
│  - Events → event-bridge-map.js (declarativo)           │
└────────────┬────────────────────────────────────────────┘
             │
     ┌───────▼───────┐
     │ AgentContext   │  (particionado)
     │ ├── session    │  SessionState
     │ ├── lifecycle  │  LifecycleState
     │ ├── dialog     │  DialogState
     │ ├── config     │  AgentConfigState
     │ ├── metrics    │  MetricsState
     │ └── managers   │  ManagerRefs
     └───────┬───────┘
             │
    ┌────────┼────────┬──────────┬───────────┬───────────┐
    ▼        ▼        ▼          ▼           ▼           ▼
┌────────┐┌────────┐┌─────────┐┌──────────┐┌─────────┐┌───────┐
│dialog/ ││lifecy/ ││session/ ││messaging/││infra/   ││state/ │
│        ││        ││         ││          ││         ││       │
│ Loop   ││ Start  ││ Boot    ││ Enqueue  ││ Queue   ││Snap   │
│ Manager││ Stop   ││ Wiring  ││ Send     ││ Task    ││shot   │
│ Turn   ││ Entry  ││ Events  ││ Steer    ││ Webhook ││Diag   │
│ Exec   ││ Reconn ││ Init    ││ Answer   ││ Perms   ││       │
│ Watch  ││ Setup  ││ Keepalv ││          ││ Handoff ││       │
│ Proto  ││ State  ││ History ││          ││ Health  ││       │
│ BPress ││ IO     ││ Rotate  ││          ││ BgTasks ││       │
│ Fallbk ││        ││ Cleanup ││          ││ ErrPol  ││       │
└────────┘└────────┘└─────────┘└──────────┘└─────────┘└───────┘
```

### Novos componentes (propostos):

- `infra/health-check.js` — K7
- `infra/background-tasks.js` — K4
- `infra/error-policy.js` — K3
- `event-bridge-map.js` — K6

### Componentes refatorados:

- `agent-context.js` — K1 (particionamento)
- `session/boot-wiring.js` — K5 (pipeline)
- `always-alive.js` — K6 (bridge declarativo) + K8 (lazy singleton)

---

## 11. Plano de Execução: Faixa K

### Fase K1 — AgentContext Partitioning (8h) 🔴

| # | Subfase | Estimativa |
|---|---------|------------|
| K1.1 | Definir interfaces SessionState, LifecycleState, etc. | 2h |
| K1.2 | Refatorar AgentContext para compor sub-estados | 3h |
| K1.3 | Migrar consumidores para acessar via sub-estado | 2h |
| K1.4 | Testes de regressão | 1h |

### Fase K2 — Test Coverage Sprint (12h) 🔴

| # | Subfase | Estimativa |
|---|---------|------------|
| K2.1 | Testes AgentContext FSM | 2h |
| K2.2 | Testes MessageQueue (FIFO, abort, drain) | 2h |
| K2.3 | Testes performBootWiring (12 etapas mockadas) | 3h |
| K2.4 | Testes agentStop + agentTryReconnect | 2h |
| K2.5 | Testes DialogLoopManager pause/resume/recovery | 2h |
| K2.6 | Testes TaskExecutor retry | 1h |

### Fase K3 — Error Handling Centralizado (4h) 🟠

| # | Subfase | Estimativa |
|---|---------|------------|
| K3.1 | Criar error-policy.js com classificador | 2h |
| K3.2 | Migrar task-executor e queue-processor | 1h |
| K3.3 | Testes de classificação + policy | 1h |

### Fase K4 — Background Task Tracker (3h) 🟠

| # | Subfase | Estimativa |
|---|---------|------------|
| K4.1 | Criar background-tasks.js | 1h |
| K4.2 | Migrar void writeStateAsync → bgTasks.track | 1h |
| K4.3 | Integrar drain no shutdown + testes | 1h |

### Fase K5 — Boot Wiring Pipeline (6h) 🟠

| # | Subfase | Estimativa |
|---|---------|------------|
| K5.1 | Extrair 12 etapas como funções nomeadas | 3h |
| K5.2 | Criar pipeline runner | 1h |
| K5.3 | Testes de cada step isolado | 2h |

### Fase K6 — Event Bridge Declarativo (4h) 🟡

| # | Subfase | Estimativa |
|---|---------|------------|
| K6.1 | Criar event-bridge-map.js | 1h |
| K6.2 | Migrar always-alive.js para usar o mapa | 2h |
| K6.3 | Testes de completude do bridge | 1h |

### Fase K7 — Health Check (3h) 🟡

| # | Subfase | Estimativa |
|---|---------|------------|
| K7.1 | Criar health-check.js | 1.5h |
| K7.2 | Expor via GET /health + testes | 1.5h |

### Fase K8 — Lazy Singleton (3h) 🟡

| # | Subfase | Estimativa |
|---|---------|------------|
| K8.1 | Refatorar para lazy init + resetAgent | 1h |
| K8.2 | Migrar imports diretos para getAgent() | 1h |
| K8.3 | Testes + deprecation warning | 1h |

---

## 12. Resumo de Estimativas

| Fase | Nome | Prioridade | Horas |
|------|------|-----------|-------|
| K1 | AgentContext Partitioning | 🔴 P0 | 8h |
| K2 | Test Coverage Sprint | 🔴 P0 | 12h |
| K3 | Error Handling Centralizado | 🟠 P1 | 4h |
| K4 | Background Task Tracker | 🟠 P1 | 3h |
| K5 | Boot Wiring Pipeline | 🟠 P1 | 6h |
| K6 | Event Bridge Declarativo | 🟡 P2 | 4h |
| K7 | Health Check Formal | 🟡 P2 | 3h |
| K8 | Lazy Singleton | 🟡 P2 | 3h |
| **Total** | | | **43h** |

### Sprint Sugerido

| Sprint | Fases | Horas | Foco |
|--------|-------|-------|------|
| K-Sprint 1 | K1 + K2 | 20h | Fundação: estado + testes |
| K-Sprint 2 | K3 + K4 + K5 | 13h | Patterns: erros + boot |
| K-Sprint 3 | K6 + K7 + K8 | 10h | Polish: events + health + DX |
