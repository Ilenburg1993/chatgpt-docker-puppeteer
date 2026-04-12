# PARTE-23C — Services Layer, Sistemas Faltantes e Integração

**Data**: 2026-04-12 | **Status**: Proposta | **Versão**: 1.0
**Scope**: Expansão de services/ de 4→10+ facades + sistemas novos necessários
**Precedente**: PARTE-23A (diagnóstico real), PARTE-22B §3.6 (services ideal)

---

## 1. Estado Atual do Services Layer

### 1.1 Inventário (529 LoC total)

| Service                   | LoC | Completude | Operações                            |
| ------------------------- | --- | ---------- | ------------------------------------ |
| `session-service.js`      | 208 | 60%        | create, resume, close, compaction    |
| `audit-service.js`        | 112 | 50%        | logEvent, flush, getStats            |
| `conversation-service.js` | 87  | 30%        | sendMessage, getHistory (incompleto) |
| `tool-service.js`         | 86  | 40%        | buildToolSet, validate               |

### 1.2 Problema: Re-exports Raw no Barrel

```js
// services/index.js — 36 LoC — re-exports "bypass"
export { alwaysAliveAgent } from '#copilot/agent';
export { conversationHub } from '#copilot/conversation-hub';
```

Isso expõe instâncias cruas (singletons) direto, sem façade.
Consumidores (terminal/, api/) acessam `.start()`, `.stop()`, `.enqueue()` diretamente no agent,
sem validação, logging, ou event emission intermediária.

### 1.3 Quem Importa services/ (24 consumidores)

```
terminal/commands/*.js      — 12 arquivos (maioria dos comandos CLI)
api/routes/*.js             — 7 arquivos (REST endpoints)
api/sse/fanout.js           — 1
terminal/server.js          — 1
terminal/dialog/engine.js   — 1
bridges/nerv-bridge.js      — 1
hooks/presets/full.js       — 1
```

Boa adoção, mas os imports são misto: alguns usam facades (session-service.startSession),
outros usam os re-exports raw (alwaysAliveAgent.stop).

---

## 2. Services Faltantes — Proposta

### 2.1 Prioridade Alta

#### S1: `agent-service.js` (~150 LoC)
- **Encapsula**: AlwaysAliveAgent lifecycle (start, stop, restart, status)
- **Adiciona**: Validação pré-start, retry policy, event emission via EventBus
- **Elimina**: Import direto de `alwaysAliveAgent` singleton em terminal/api

```js
// Exemplo de interface proposta
export class AgentService {
    static async start(opts = {}) { ... }
    static async stop(graceful = true) { ... }
    static restart(delay = 0) { ... }
    static getStatus() { ... }  // → { state, uptime, taskCount, lastError }
    static isReady() { ... }    // → boolean
}
```

#### S2: `dialog-service.js` (~120 LoC)
- **Encapsula**: DialogLoopManager (startLoop, inject, pause, resume)
- **Adiciona**: Turn history, loop metrics, stall detection delegation
- **Elimina**: Import direto de loop-manager em terminal/dialog/engine

```js
export class DialogService {
    static async startLoop(sessionId, config) { ... }
    static async injectMessage(sessionId, text) { ... }
    static pauseLoop(sessionId) { ... }
    static resumeLoop(sessionId) { ... }
    static getLoopStatus(sessionId) { ... }
    static getHistory(sessionId, limit) { ... }
}
```

#### S3: `health-service.js` (~180 LoC)
- **Encapsula**: Circuit breakers, EventBus health, memory, uptime, dependencies
- **Adiciona**: Aggregated health endpoint, degradão gradual alertas
- **Integra**: `core/circuit-breaker.js`, `core/shutdown.js`, `observability/metrics.js`
- **Usado por**: api/routes/health.js, terminal/handlers/system-metrics.js

```js
export class HealthService {
    static async check() { ... }          // → { status, uptime, memory, circuits }
    static async checkDependencies() { ... } // → { sdk, db, browser, eventBus }
    static getCircuitBreakers() { ... }   // → Map<name, { state, failures, lastAttempt }>
    static getMetricsSummary() { ... }    // → { sessions, turns, errors, latency }
}
```

### 2.2 Prioridade Média

#### S4: `config-service.js` (~100 LoC)
- **Encapsula**: config/env.js, config/custom-agents.js, config/pinned-files.js
- **Adiciona**: Reload dinâmico, validação schema, merge strategy
- **Elimina**: Import direto de config/ em terminal/commands

#### S5: `metrics-service.js` (~100 LoC)
- **Encapsula**: observability/metrics.js, histogram, snapshot
- **Adiciona**: Aggregation windows (1m, 5m, 60m), percentile reporting
- **Elimina**: Import direto de observability/ em api/routes

### 2.3 Prioridade Futura

#### S6: `bridge-service.js` (~80 LoC)
- Status de todos os bridges (Nerv, MCP, etc.) num endpoint unificado

#### S7: `plugin-service.js` (~80 LoC)
- Wraps plugin-registry.js (atualmente órfão), adiciona discover/load/unload lifecycle

---

## 3. Sistemas Faltantes — Análise Completa

### 3.1 Sistemas que PARTE-22B Propôs e Não Existem

| Sistema                        | Status                 | Impacto se Ausente                             | Complexidade      |
| ------------------------------ | ---------------------- | ---------------------------------------------- | ----------------- |
| `health/` módulo dedicado      | ❌ Não existe           | Sem observabilidade de runtime                 | Baixa             |
| `workers/` (offload de CPU)    | ❌ Não existe           | Bloqueio de event loop em ferramentas pesadas  | Alta              |
| `rpc/` (inter-process)         | ❌ Não existe           | Sem communication channel para browser isolado | Alta              |
| `locking/` (distributed locks) | ✅ core/mutex.js existe | mutex.js simples, OK para single-process       | Baixa (já existe) |
| `caching/` (hot cache layer)   | ✅ core/cache.js existe | cache.js simples LRU, OK                       | Baixa (já existe) |

### 3.2 Sistemas que Deveriam Existir Mas Ninguém Propôs

#### SYS-1: **Rate Limiter centralizado**
- **Problema**: Cada módulo implementa seu próprio throttle (inject.js, conversation-hub/orchestrator.js, sempre ad-hoc)
- **Proposta**: `core/rate-limiter.js` — token bucket ou sliding window, DI-injectable
- **Impacto**: Previne abuse de API, normaliza delays entre turns

#### SYS-2: **Retry Policy registrado**
- **Problema**: Retries estão espalhados (sdk/client.js, bridges/nerv-bridge.js, mcp-tool-bridge.js) com lógicas incompatíveis
- **Proposta**: `core/retry-policy.js` — exponential backoff + jitter, composável com circuit breaker
- **Impacto**: Elimina retry duplicado, unifica timing strategy

#### SYS-3: **Request Context Propagation**
- **Problema**: Não há contexto propagado (requestId, sessionId, traceId) entre camadas
- **Proposta**: `core/context.js` usando AsyncLocalStorage (Node 24 nativo)
- **Impacto**: Permite correlation de logs cross-module, métricas per-request

#### SYS-4: **Graceful Shutdown Registry**
- **Problema**: `core/shutdown.js` existe mas é callback-based; bridges/agent adicionam handlers ad-hoc
- **Proposta**: Upgrade para `ShutdownRegistry` com prioridades, timeouts per-handler, dependência
- **Impacto**: Previne data loss em shutdown, garante flush de queues e sessions

#### SYS-5: **Feature Flags**
- **Problema**: `config.json` e `dynamic_rules.json` servem como flags mas sem API, sem toggle runtime
- **Proposta**: `core/feature-flags.js` — avalia flag por nome, default, override via env/config
- **Impacto**: Permite rollout gradual de features, A/B testing de strategies

#### SYS-6: **Dependency Graph Validator**
- **Problema**: Layer violations (L6→L2 direto) só são detectadas em auditoria manual
- **Proposta**: Script de CI/dev que parseia imports e valida contra regras de layer
- **Impacto**: Previne regressões de acoplamento automaticamente

---

## 4. Integração — O Grafo de Dependência Ideal

### 4.1 Fluxo Atual (Parcialmente Acoplado)

```
terminal/ ──→ services/ ──→ agent/ ──→ sdk/
     └──→ agent/ (bypass!)     └──→ core/
     └──→ observability/ (bypass!)

api/ ──→ services/ ──→ conversation-hub/ ──→ channel/
   └──→ agent/ (bypass!)
```

### 4.2 Fluxo Ideal (Services como Gateway)

```
terminal/ ──→ services/ ──→ agent/ ──→ sdk/ ──→ core/
                  │──→ conversation-hub/ ──→ channel/
                  │──→ observability/ (via metrics-service)
                  │──→ bridges/ (via bridge-service)
                  └──→ config/ (via config-service)

api/ ──→ services/ (mesma interface que terminal/)
              └──→ core/ (DI, EventBus, shutdown)
```

**Nenhum módulo de L5-L6 (terminal, api) deveria importar L2-L4 diretamente.**

### 4.3 Enforcement

1. ESLint `no-restricted-imports` expandido:
   ```js
   // Proibir terminal/* e api/* de importar diretamente:
   '#copilot/agent',
   '#copilot/agent/*',
   '#copilot/conversation-hub',
   '#copilot/conversation-hub/*',
   '#copilot/observability',
   '#copilot/bridges',
   '#copilot/bridges/*',
   ```
2. Exceção: `services/index.js` pode importar qualquer layer
3. Exceção: `core/` pode ser importado por qualquer layer

---

## 5. Plano de Rollout — Services

### Fase S1: Agent + Dialog Services (Alta Prioridade)
1. Criar `services/agent-service.js` com facade sobre AlwaysAliveAgent
2. Criar `services/dialog-service.js` com facade sobre DialogLoopManager
3. Atualizar `services/index.js` — remover re-exports raw
4. Migrar terminal/commands que usam alwaysAliveAgent direto → agent-service

### Fase S2: Health + Metrics Services
1. Criar `services/health-service.js` — agregar circuit breakers + uptime + memory
2. Criar `services/metrics-service.js` — facade sobre observability/metrics
3. Criar/atualizar api/routes/health.js → usar health-service

### Fase S3: Config + Bridge
1. Criar `services/config-service.js` — facade sobre config/*
2. Criar `services/bridge-service.js` — status aggregado de bridges
3. Atualizar terminal/ para usar config-service ao invés de config/ direto

### Fase S4: Enforcement
1. Expandir ESLint rules para proibir bypass
2. CI gate: `arch-health.mjs` valida fan-in de services/

---

## 6. Sistemas Core Faltantes — Plano

### Fase CORE1: Request Context + Rate Limiter
1. `core/context.js` — AsyncLocalStorage, requestId, sessionId, traceId propagation
2. `core/rate-limiter.js` — Token bucket, per-key, configurable

### Fase CORE2: Retry + Shutdown upgrade
1. ~~`core/retry-policy.js` — Composable com circuit breaker~~ → **JÁ EXISTE**: `core/retry.js` (85 LoC)
2. ~~`core/shutdown.js` upgrade — Priority-based, timeout per handler~~ → **JÁ EXISTE**: shutdown.js é priority-based (10-50)

> **ERRATA v1.1**: As propostas acima foram feitas sem auditoria profunda. Na realidade:
> - `core/retry.js` já implementa `withRetry(fn, opts)` com exponential backoff + jitter + abort signal
> - `core/shutdown.js` já implementa priority-based handlers (P10-P50)
> - O problema real é **ADOÇÃO**: bridges não usam retry.js, e só 3/8 handlers de shutdown estão registrados
> - **Ação correta**: adotar core/retry.js nas bridges (Fase 4A) e registrar +5 shutdown handlers (Fase 0C)

### Fase CORE3: Feature Flags + Dep Graph Validator
1. ~~`core/feature-flags.js` — Flag registry, runtime toggle~~ → **PARCIAL**: `sdk/feature-flags.js` já existe (95 LoC, SDK-scoped)
2. `scripts/validate-layers.mjs` — Parseia imports, valida contra layer rules

> **ERRATA v1.1**: `sdk/feature-flags.js` já implementa flags experimentais (fleet, agents, skills, mcp, plugins, extensions) com env var override. É SDK-scoped mas reutilizável para V1 do sistema. Para V2, criar `core/feature-flags.js` system-wide.

---

## 7. Métricas de Sucesso

| Critério                           | Atual       | Pós S1-S2          | Pós S3-S4 (target)         |
| ---------------------------------- | ----------- | ------------------ | -------------------------- |
| Services count                     | 4           | 6                  | 10                         |
| Services total LoC                 | 529         | ~900               | ~1.400                     |
| Raw bypasses em services/index     | 2+          | 0                  | 0                          |
| terminal/ importando agent/ direto | ~5          | 0                  | 0                          |
| api/ importando agent/ direto      | ~2          | 0                  | 0                          |
| Health endpoint                    | inexistente | `/health` básico   | `/health` + `/health/deep` |
| Rate limiting centralizado         | 0           | 1 (core/)          | 1 (DI-injectable)          |
| Request context propagation        | 0%          | pilot em 2 módulos | system-wide                |
