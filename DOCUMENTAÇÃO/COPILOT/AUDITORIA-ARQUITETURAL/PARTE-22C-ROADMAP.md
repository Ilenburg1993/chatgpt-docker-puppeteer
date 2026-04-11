# PARTE-22C — Roadmap v3: 4 Ondas, 22 Faixas, Transformação Profunda

**Data**: 2026-04-12 | **Status**: Canônico | **Versão**: 1.0  
**Scope**: Roadmap executável de `src/copilot` — da situação atual (22A) à ideal (22B)  
**Critério**: Zero relativização — cada faixa tem critérios de conclusão mensuráveis e verificáveis

---

## 0. Convenções do Roadmap

- **Faixa**: Conjunto coeso de tarefas com um objetivo arquitetural único
- **Subfase**: Tarefa atômica dentro de uma faixa, executável em ≤1 hora
- **Critério de conclusão**: Verificação executável (script, lint, test, verificação de LoC)
- **Risco**: Baixo (mudança isolada), Médio (mudança cross-file), Alto (mudança cross-módulo)
- **Dependências**: Faixas que devem ser concluídas antes

---

## 1. Visão Geral — 4 Ondas

```
Onda O: Deep Cleanup + Infra Core (faixas O1-O7)
├── O1: Resolver deep imports restantes (4 → 0)
├── O2: Expandir DI tokens (13 → 30+)
├── O3: Split agent/always-alive.js
├── O4: Split agent/dialog/loop-manager.js
├── O5: Corrigir 16 typecheck errors (rpc-ops, rpc-session)
├── O6: Core infra: cache, mutex, timer-registry
└── O7: Circuit breakers: SDK + NERV + webhooks

Onda P: EventBus + Services + God Files (faixas P1-P8)
├── P1: events/ module — schema central de eventos
├── P2: Migrar EventEmitter → EventBus (8 arquivos)
├── P3: services/ completo (5 novos services)
├── P4: Split conversation-hub/ (socket-ns, orchestrator, store)
├── P5: Split terminal/ (server, repl, handlers)
├── P6: Split observability/ (metrics, event-collector, observers)
├── P7: Split hooks/ + tools/ god files
└── P8: api/ routing-only refactor

Onda Q: Testes + Qualidade + Infra (faixas Q1-Q5)
├── Q1: Cobertura unitária agent/ (≥70%)
├── Q2: Cobertura unitária terminal/ + api/ (≥70%)
├── Q3: Cobertura unitária sdk/ + bridges/ + observability/ (≥70%)
├── Q4: Audit pipeline — event sourcing
└── Q5: OpenTelemetry completo + health/ module

Onda R: Events Schema + Multi-Agent Prep + Polish (faixas R1-R3)
├── R1: events/ module — adoção completa (100%)
├── R2: Multi-agent prep: DI.fork() + worker isolation
└── R3: Audit + metrics — validação final e polish
```

---

## 2. ONDA O — Deep Cleanup + Infra Core (Score: 24 → 42)

### Faixa O1 — Zero Deep Imports (4 → 0)

**Objetivo**: Eliminar os 4 deep imports reais restantes que bypassam barrels  
**Dependências**: Nenhuma  
**Critério de conclusão**: `node scripts/arch-health.mjs --json | jq '.deepImports.refined'` retorna `0`

| Sub | Arquivo com deep import   | Import problemático               | Solução                           | Risco |
|-----|---------------------------|-----------------------------------|------------------------------------|-------|
| O1-1 | Identificar os 4 arquivos | `node scripts/arch-health.mjs`   | Auditoria de baseline              | Baixo |
| O1-2 | Corrigir import 1         | Mover para barrel do módulo       | Editar 1 arquivo                   | Baixo |
| O1-3 | Corrigir import 2         | Mover para barrel do módulo       | Editar 1 arquivo                   | Baixo |
| O1-4 | Corrigir import 3         | Mover para barrel do módulo       | Editar 1 arquivo                   | Baixo |
| O1-5 | Corrigir import 4         | Mover para barrel do módulo       | Editar 1 arquivo                   | Baixo |
| O1-6 | Atualizar barrel exposto  | Verificar que barrel expõe símbolo| Editar barrel se necessário        | Baixo |
| O1-7 | Lint + test               | `npm run lint && npm run test:unit`| Validação                          | Baixo |

---

### Faixa O2 — Expandir DI Tokens (13 → 30)

**Objetivo**: Registrar os serviços mais críticos no container DI  
**Dependências**: Nenhuma (incremento sobre Faixa K existente)  
**Critério de conclusão**: `node scripts/arch-health.mjs --json | jq '.diTokens'` retorna ≥30

| Sub | Token a criar              | Módulo destino       | Quem injeta         | Quem resolve         | Risco |
|-----|----------------------------|----------------------|---------------------|----------------------|-------|
| O2-1 | `CONVERSATION_STORE`      | conv-hub/store.js    | entry/ ou terminal  | services/, api/      | Médio |
| O2-2 | `METRICS_STORE`           | observability/metrics| observability/boot  | services/, api/      | Médio |
| O2-3 | `AUDIT_PIPELINE`          | audit/pipeline.js    | audit/boot          | services/audit       | Médio |
| O2-4 | `ERROR_TRACKER`           | observability/error-tracker | bootstrap  | alert manager        | Baixo |
| O2-5 | `EVENT_COLLECTOR`         | observability/event-collector | bootstrap | observers          | Baixo |
| O2-6 | `INJECT_SERVER`           | terminal/server.js   | terminal/boot       | terminal/index       | Médio |
| O2-7 | `RATE_LIMITER`            | conv-hub/socket-ns   | entry/              | api/, socket-ns      | Médio |
| O2-8 | `DIALOG_ENGINE`           | terminal/dialog/engine | terminal/boot     | terminal/handlers    | Alto  |
| O2-9 | `SESSION_SERVICE` DI      | services/session     | entry/              | api/express          | Médio |
| O2-10| `CONVERSATION_SERVICE` DI | services/conversation| entry/              | api/express          | Médio |
| O2-11| `AGENT_SERVICE` (novo)    | services/agent       | entry/              | terminal/, api/      | Alto  |
| O2-12| `DIALOG_SERVICE` (novo)   | services/dialog      | entry/              | terminal/, api/      | Alto  |
| O2-13| `SOCKET_NAMESPACE`        | conv-hub/socket-ns   | entry/              | api/, socket-ns      | Médio |
| O2-14| `PLUGIN_REGISTRY` DI      | plugins/plugin-registry | entry/           | tools/, bridges/     | Baixo |
| O2-15| `ALERTS_MANAGER`          | observability/error-alerting | bootstrap  | multiple          | Baixo |
| O2-16| `OTEL_TRACER`             | observability/otel   | bootstrap           | múltiplos            | Baixo |
| O2-17| Atualizar `di-tokens.js`  | core/di-tokens.js    | —                   | —                    | Baixo |
| O2-18| Atualizar `arch-health.mjs` para contar novos tokens | scripts/ | — | —          | Baixo |

---

### Faixa O3 — Split `agent/always-alive.js` (623 → ≤150 LoC)

**Objetivo**: Eliminar o maior god file do sistema  
**Dependências**: O2 (para wiring DI)  
**Critério de conclusão**: `wc -l src/copilot/agent/always-alive.js` ≤ 150

| Sub | Ação                                          | Destino                                  | Risco |
|-----|-----------------------------------------------|------------------------------------------|-------|
| O3-1 | Extrair `_setupEventHandlers` + `_handleAgentEvent` | `agent/event-wiring.js` (≤120 LoC) | Alto |
| O3-2 | Extrair lógica de queue orchestration         | `agent/queue-processor.js` (já existe — expandir) | Médio |
| O3-3 | Extrair `getStatusSnapshot` + `listenerDiagnostics` | já existem em `state/agent-state.js` — remover dup | Médio |
| O3-4 | Extrair `_exportAgentContext` (start/stop context) | `agent/agent-context.js` (já existe) | Baixo |
| O3-5 | Remover `extends EventEmitter` — usar EventBus| Depende de P2 (pode preparar sem migrar) | Alto |
| O3-6 | `always-alive.js`: apenas delegação pura      | ≤150 LoC de orchestation                | Alto |
| O3-7 | Atualizar todos os imports afetados           | Múltiplos arquivos                       | Médio |
| O3-8 | Testes: verificar que interface pública mantida | `npm run test:unit`                    | Baixo |

---

### Faixa O4 — Split `agent/dialog/loop-manager.js` (599 → ≤150 LoC)

**Objetivo**: Decompor o segundo maior god file  
**Dependências**: O3  
**Critério de conclusão**: `wc -l src/copilot/agent/dialog/loop-manager.js` ≤ 150

| Sub | Ação                                           | Destino                                 | Risco |
|-----|------------------------------------------------|-----------------------------------------|-------|
| O4-1 | Extrair lógica de pause/resume state          | `agent/dialog/pause-state.js` (novo)    | Alto  |
| O4-2 | Extrair orchestração de turn execution        | Reforçar `turn-executor.js` como destino| Alto  |
| O4-3 | Extrair event emission handlers               | `agent/dialog/event-wiring.js` (novo)   | Alto  |
| O4-4 | Extrair mutex/serialização de turno           | `agent/dialog/turn-mutex.js` (novo)     | Alto  |
| O4-5 | `loop-manager.js`: apenas coordenação de fluxo| ≤150 LoC                                | Alto  |
| O4-6 | Atualizar imports + index.js do diretório     | `agent/dialog/index.js`                 | Médio |
| O4-7 | Validar: testes unit do loop-manager passam   | `npm run test:unit`                     | Baixo |

---

### Faixa O5 — Zero TypeCheck Errors (16 → 0)

**Objetivo**: Resolver todos os erros de typecheck baseline  
**Dependências**: Nenhuma  
**Critério de conclusão**: `npm run typecheck:node` retorna 0 errors

**Arquivos com erros:**
- `src/copilot/sdk/rpc-ops.js`: 7 erros (tipos faltando: `ShellExecResult`, etc.)
- `src/copilot/sdk/rpc-session.js`: 9 erros (tipos faltando: `ModelSwitchResult`, etc.)

| Sub | Ação                                              | Risco |
|-----|---------------------------------------------------|-------|
| O5-1 | Auditar `rpc-ops.js`: quais tipos faltam e de onde vêm | Baixo |
| O5-2 | Auditar `rpc-session.js`: quais tipos faltam     | Baixo |
| O5-3 | Adicionar typedefs faltantes em `sdk/types.js`   | Baixo |
| O5-4 | Adicionar `@param {session} CopilotSession` onde `any` | Baixo |
| O5-5 | Usar `@type {import('#copilot/sdk').X}` correto  | Baixo |
| O5-6 | Validar: `npm run typecheck:node` retorna 0 errors | Baixo |
| O5-7 | Atualizar contract tests com verificação typecheck | Baixo |

---

### Faixa O6 — Infra Core: Cache, Mutex, Timer Registry

**Objetivo**: Criar infraestrutura para eliminar singletons lazy-init  
**Dependências**: Nenhuma  
**Critério de conclusão**: 3 novos módulos com tests ≥5 each, usados em ≥5 locais

#### O6-1: `core/cache.js` — LRU/TTL Cache Manager

```js
// Interface alvo (src/copilot/core/cache.js):
export function createCache({ maxSize = 100, ttlMs = 0 } = {}) {
    return {
        get(key), set(key, value), has(key), delete(key), clear(), size(), entries()
    };
}
// Substituirá: _modelsCache, _rgAvailable, _zodToJsonSchema, etc.
```

| Sub | Ação                                              | Risco |
|-----|---------------------------------------------------|-------|
| O6-1a | Criar `core/cache.js` (≤150 LoC)                | Baixo |
| O6-1b | Criar 8+ testes unitários para CacheManager     | Baixo |
| O6-1c | Exportar via `core/index.js`                    | Baixo |
| O6-1d | Migrar `sdk/models/helpers.js` (_modelsCache)   | Baixo |
| O6-1e | Migrar `sdk/tools.js` (_zodToJsonSchema)        | Baixo |
| O6-1f | Migrar `tools/file/shared.js` (_rgAvailable)    | Baixo |
| O6-1g | Adicionar DI token `CACHE_MANAGER` (O2)         | Baixo |

#### O6-2: `core/mutex.js` — Mutex Pool com Timeout

```js
// Interface alvo:
export function createMutex(timeoutMs = 30000) {
    return { acquire(), release(), withLock(fn), isLocked() };
}
// Substituirá: _storeMutex, _sendTurnMutex, _writeQueue promise chains, etc.
```

| Sub | Ação                                              | Risco |
|-----|---------------------------------------------------|-------|
| O6-2a | Criar `core/mutex.js` (≤120 LoC)                | Baixo |
| O6-2b | Criar 6+ testes unitários                        | Baixo |
| O6-2c | Exportar via barrel                              | Baixo |
| O6-2d | Migrar `tools/todo/store.js` (_storeMutex)       | Médio |
| O6-2e | Migrar `terminal/dialog/engine.js` (_sendTurnMutex) | Alto |
| O6-2f | Migrar `agent/lifecycle/state-io.js` (_writeQueue) | Alto |

#### O6-3: `core/timer-registry.js` — Timer Lifecycle Manager

```js
// Interface alvo:
export function createTimerRegistry() {
    return { 
        setTimeout(fn, ms, key?), setInterval(fn, ms, key?),
        cancel(key), cancelAll(), activeCount()
    };
}
// Substituirá: _reflectionTimer, _backgroundCompactionThreshold timer, etc.
```

| Sub | Ação                                              | Risco |
|-----|---------------------------------------------------|-------|
| O6-3a | Criar `core/timer-registry.js` (≤120 LoC)       | Baixo |
| O6-3b | Criar 6+ testes unitários                        | Baixo |
| O6-3c | Exportar via barrel                              | Baixo |
| O6-3d | Migrar `terminal/index.js` (_reflectionTimer)    | Médio |
| O6-3e | Integrar com `shutdown.js` (cancelAll em shutdown) | Baixo |

---

### Faixa O7 — Circuit Breakers: SDK, NERV, Webhooks

**Objetivo**: Proteger todas as dependências externas com circuit breakers  
**Dependências**: O6 (para infraestrutura de estado)  
**Critério de conclusão**: 6 circuit breakers ativos, cada um com testes

| Sub | Ação                                              | Destino                     | Risco |
|-----|---------------------------------------------------|-----------------------------|-------|
| O7-1 | Circuit breaker no SDK client (sdk/client.js)    | Usa `core/circuit-breaker.js` (já existe) | Alto |
| O7-2 | Circuit breaker no NERV bridge (nerv-bridge.js)  | Adaptar CB existente do MCP | Alto  |
| O7-3 | Circuit breaker em webhooks (error-alerting.js)  | Novo CB para HTTP calls      | Médio |
| O7-4 | Circuit breaker em GitHub CLI (bridges/gh/*)     | Novo CB para gh commands     | Médio |
| O7-5 | Circuit breaker em SSE fanout (api/sse/fanout.js)| CB por connection + global  | Médio |
| O7-6 | Circuit breaker em SQLite writes (db/sqlite.js)  | CB para disk errors          | Médio |
| O7-7 | Health endpoint para status de CBs               | `api/bridge/health.js`       | Baixo |
| O7-8 | DI token: CIRCUIT_BREAKER_REGISTRY               | core/di-tokens.js            | Baixo |
| O7-9 | Testes: 3+ testes por circuit breaker            | tests/unit/                  | Médio |

---

## 3. ONDA P — EventBus + Services + God Files (Score: 42 → 62)

### Faixa P1 — `events/` Module — Schema Central

**Objetivo**: Criar SSOT para todos os eventos do sistema  
**Dependências**: O1, O2  
**Critério de conclusão**: `src/copilot/events/` criado, todos os HUB_EVENTS/AGENT_EVENTS importados de lá

| Sub | Ação                                              | Risco |
|-----|---------------------------------------------------|-------|
| P1-1 | Criar `src/copilot/events/` com index.js         | Baixo |
| P1-2 | Criar `events/hub-events.js` (migrar HUB_EVENTS) | Baixo |
| P1-3 | Criar `events/agent-events.js` (migrar AGENT_EVENTS) | Baixo |
| P1-4 | Criar `events/dialog-events.js` (novos eventos dialog) | Baixo |
| P1-5 | Criar `events/terminal-events.js` (terminal state events) | Baixo |
| P1-6 | Criar `events/system-events.js` (shutdown, error, etc.) | Baixo |
| P1-7 | Criar `events/audit-events.js` (audit pipeline events) | Baixo |
| P1-8 | Adicionar `events/` ao `tsconfig.node.json` paths | Baixo |
| P1-9 | Registrar alias `#copilot/events` no package.json | Baixo |
| P1-10 | Atualizar arquivos que usam HUB_EVENTS → `#copilot/events` | Médio |
| P1-11 | Atualizar arquivos que usam AGENT_EVENTS → `#copilot/events` | Médio |
| P1-12 | Lint + contract test para events/               | Baixo |
| P1-13 | Adicionar `events/` ao layer hierarchy check CI | Baixo |

---

### Faixa P2 — Migrar EventEmitter Direto → EventBus (8 → 0 arquivos)

**Objetivo**: Eliminar todos os EventEmitter diretos cross-module  
**Dependências**: P1 (events/ module), O2 (DI tokens)  
**Critério de conclusão**: `grep -r 'new EventEmitter\|extends EventEmitter' src/copilot/ | wc -l` = 0

| Sub | Arquivo                              | Solução EventBus                                      | Risco |
|-----|--------------------------------------|-------------------------------------------------------|-------|
| P2-1 | `terminal/state.js`                 | Usar EventBus namespace `terminal:state:*`            | Alto  |
| P2-2 | `agent/infra/handoff-manager.js`    | Usar EventBus `agent:handoff:*`                       | Alto  |
| P2-3 | `api/sse/fanout.js`                 | Usar EventBus `api:sse:*` + backpressure pattern      | Alto  |
| P2-4 | `config/pinned-files.js`            | Usar EventBus `config:files:changed`                  | Médio |
| P2-5 | `agent/dialog/loop-manager.js`      | Usar EventBus (depende de O4)                         | Alto  |
| P2-6 | `agent/always-alive.js`             | Usar EventBus bridgeEmitter (depende de O3)           | Alto  |
| P2-7 | `conversation-hub/orchestrator.js`  | Usar EventBus `hub:*` (depende de P4)                 | Alto  |
| P2-8 | `hooks/bus.js`                      | Usar EventBus namespace `hooks:*`                     | Médio |
| P2-9 | Testes: verificar EventBus eventos enviados corretamente | Mockar EventBus                        | Médio |

---

### Faixa P3 — `services/` Completo (5 novos services)

**Objetivo**: services/ deve cobrir 100% dos casos de uso de L5/L6  
**Dependências**: O2 (DI tokens para services)  
**Critério de conclusão**: 9 services totais, api/ e terminal/ importam APENAS de services/

| Sub | Service                         | Ação                                                | Risco |
|-----|---------------------------------|-----------------------------------------------------|-------|
| P3-1 | Revisar `session-service.js`   | Expandir para full CRUD + lifecycle (≤200 LoC)      | Médio |
| P3-2 | Revisar `conversation-service.js` | Expandir messaging + hub ops (≤200 LoC)          | Médio |
| P3-3 | Criar `services/agent-service.js` | start/stop/status/restart (≤200 LoC)             | Alto  |
| P3-4 | Criar `services/dialog-service.js` | sendTurn/steer/answer/pause/resume (≤200 LoC)   | Alto  |
| P3-5 | Criar `services/metrics-service.js` | getSummary/reset/query (≤150 LoC)              | Médio |
| P3-6 | Criar `services/config-service.js` | runtime config mutation API (≤150 LoC)          | Médio |
| P3-7 | Criar `services/health-service.js` | system health probes (≤150 LoC)                 | Médio |
| P3-8 | Atualizar `services/index.js`   | Exportar todos os services                          | Baixo |
| P3-9 | Migrar api/ para usar agent-service + dialog-service | api/express/session-messaging.js | Alto  |
| P3-10| Migrar terminal/ repl commands para usar dialog-service | terminal/index.js, repl.js    | Alto  |
| P3-11| Testes: 5+ testes por service   | tests/unit/copilot/services/                        | Médio |

---

### Faixa P4 — Split `conversation-hub/` God Files

**Objetivo**: Nenhum arquivo em conv-hub com >250 LoC  
**Dependências**: P1, P2  
**Critério de conclusão**: `find src/copilot/conversation-hub/ -name '*.js' | xargs wc -l | awk '$1>250' | grep -v total` vazio

| Sub | Arquivo                   | LoC | Splits                                               | Risco |
|-----|---------------------------|-----|------------------------------------------------------|-------|
| P4-1 | `store.js` (561 LoC)     | 561 | store-queries.js já existe — extract store-writes.js | Alto  |
| P4-2 | `socket-ns.js` (482 LoC) | 482 | socket-ns-auth.js, socket-ns-handlers.js, socket-ns-broadcasts.js | Alto |
| P4-3 | `orchestrator.js` (438 LoC)| 438 | orchestrator-session.js (CRUD), orchestrator-events.js | Alto |
| P4-4 | Atualizar `conversation-hub/index.js` barrels | — | Manter API pública               | Médio |
| P4-5 | Lint + testes             | —   | —                                                    | Baixo |

---

### Faixa P5 — Split `terminal/` God Files

**Objetivo**: server.js, repl.js, handlers/ abaixo de 250 LoC  
**Dependências**: P3 (para usar dialog-service no repl)  
**Critério de conclusão**: Todos os arquivos de lógica em terminal/ ≤ 250 LoC

| Sub | Arquivo                          | LoC | Ação                                     | Risco |
|-----|----------------------------------|-----|------------------------------------------|-------|
| P5-1 | `server.js` (452 LoC)           | 452 | Extract server-routes.js + server-sse.js | Alto  |
| P5-2 | `repl.js` (437 LoC)             | 437 | Extract repl-inline-cmds.js              | Médio |
| P5-3 | `handlers/system-metrics.js` (395)| 395 | Extract metrics-display.js              | Médio |
| P5-4 | `dialog/engine.js` (370 LoC)    | 370 | Extract engine-turn-handler.js           | Alto  |
| P5-5 | `state.js` (361 LoC)            | 361 | Com migração EventBus (depende de P2-1)  | Alto  |
| P5-6 | `file-context.js` (382 LoC)     | 382 | Extract file-context-embed.js            | Médio |
| P5-7 | `commands/gh.js` (382 LoC)      | 382 | Extract gh-issues.js + gh-prs.js + gh-ci.js | Médio |
| P5-8 | Lint + testes                    | —   | —                                        | Baixo |

---

### Faixa P6 — Split `observability/` God Files

**Objetivo**: metrics.js, event-collector.js, observers abaixo de 250 LoC  
**Dependências**: O6 (cache e mutex para metrics)  
**Critério de conclusão**: Todos os arquivos observability/ ≤ 250 LoC

| Sub | Arquivo                                             | LoC | Ação                                    | Risco |
|-----|-----------------------------------------------------|-----|-----------------------------------------|-------|
| P6-1 | `metrics.js` (426 LoC)                             | 426 | Extract metrics-periodic-snapshot.js    | Médio |
| P6-2 | `event-collector.js` (405 LoC)                     | 405 | Extract event-collector-flush.js + singleton removal | Alto |
| P6-3 | `observers/dialog-task-handlers.js` (424 LoC)      | 424 | Extract dialog-task-spans.js            | Alto  |
| P6-4 | `observers/session-agent-handlers.js` (381 LoC)    | 381 | Extract session-agent-lifecycle-handlers.js | Alto |
| P6-5 | `collectors/session-handlers.js` (392 LoC)         | 392 | Extract session-event-forwarder.js      | Alto  |
| P6-6 | Lint + testes                                       | —   | —                                       | Baixo |

---

### Faixa P7 — Split `hooks/` + `tools/` God Files

**Objetivo**: factory.js, introspection-tools.js abaixo de 250 LoC  
**Dependências**: Nenhuma  
**Critério de conclusão**: Todos arquivos logic ≤ 250 LoC

| Sub | Arquivo                                    | LoC | Ação                                       | Risco |
|-----|--------------------------------------------|-----|--------------------------------------------|-------|
| P7-1 | `hooks/factory.js` (416 LoC)              | 416 | Extract hooks/factory-slot-builders.js     | Alto  |
| P7-2 | `tools/introspection-tools.js` (407 LoC)  | 407 | Split por tool type (introspect/query/exec)| Médio |
| P7-3 | `tools/web-tools.js` (397 LoC)            | 397 | Extract web-tools-http.js + web-tools-dom.js | Médio |
| P7-4 | `tools/shell/index.js` (369 LoC)          | 369 | Extract shell-security.js + shell-exec.js  | Médio |
| P7-5 | `bridges/nerv-bridge.js` (434 LoC)        | 434 | Extract nerv-bridge-lifecycle.js + nerv-bridge-events.js | Alto |
| P7-6 | `bridges/mcp-tool-bridge.js` (431 LoC)    | 431 | Extract mcp-tool-discovery.js              | Alto  |
| P7-7 | Lint + testes                              | —   | —                                          | Baixo |

---

### Faixa P8 — `api/` Routing-Only Refactor

**Objetivo**: api/ routes apenas chamam services/ — sem lógica de negócio inline  
**Dependências**: P3 (services completos)  
**Critério de conclusão**: Nenhum arquivo em `api/express/` >150 LoC

| Sub | Ação                                                          | Risco |
|-----|---------------------------------------------------------------|-------|
| P8-1 | Auditar `api/express/session-crud.js` (351 LoC) — extrair lógica para services/ | Alto |
| P8-2 | Auditar `api/express/session-messaging.js` — usar dialog-service               | Alto |
| P8-3 | Auditar `api/express/observability.js` — usar metrics-service                  | Médio |
| P8-4 | Auditar `api/bridge/control.js` — usar agent-service                           | Alto  |
| P8-5 | Verificar fan-out api/ ≤ 6 após migração                                       | Baixo |
| P8-6 | Lint + testes                                                                   | Baixo |

---

## 4. ONDA Q — Testes + Qualidade + Infra (Score: 62 → 82)

### Faixa Q1 — Cobertura agent/ (0% → ≥70%)

**Objetivo**: Escrita de testes unitários reais para agent/  
**Dependências**: O3, O4 (god files split — necessário para testabilidade)  
**Critério de conclusão**: Coverage ≥70% nos arquivos críticos de agent/

| Sub | Arquivo/Grupo                      | Testes necessários                              | Risco |
|-----|------------------------------------|--------------------------------------------------|-------|
| Q1-1 | `agent/queue-processor.js`        | 5+ testes: enqueue, dequeue, overflow, empty    | Baixo |
| Q1-2 | `agent/dialog/turn-executor.js`   | 5+ testes: success, error, timeout, retry       | Médio |
| Q1-3 | `agent/dialog/backpressure.js`    | 5+ testes: queue bounds, drain, overflow        | Baixo |
| Q1-4 | `agent/dialog/watchdog.js`        | 4+ testes: stall detection, reset, timeout      | Médio |
| Q1-5 | `agent/dialog/model-fallback.js`  | 4+ testes: schedule, execute, revert            | Médio |
| Q1-6 | `agent/lifecycle/reconnect-policy.js` | 5+ testes: retry delay, max-attempts, reset | Baixo |
| Q1-7 | `agent/lifecycle/agent-lifecycle.js`  | 5+ testes: start, stop, error cases        | Alto  |
| Q1-8 | `agent/state/agent-state.js`      | 4+ testes: snapshot, diagnostics                | Baixo |
| Q1-9 | `agent/always-alive.js` (pós-split)| 3+ testes: integration lite                     | Médio |
| Q1-10| CI: cobertura gate para agent/    | Script ou vitest coverage                        | Médio |

---

### Faixa Q2 — Cobertura terminal/ + api/ (0% → ≥70%)

**Dependências**: P5 (terminal split), P8 (api routing-only)  
**Critério de conclusão**: Coverage ≥70% em arquivos de lógica

| Sub | Módulo/Grupo                    | Quantidade testes                   | Risco |
|-----|---------------------------------|--------------------------------------|-------|
| Q2-1 | `terminal/dialog/engine.js`   | 6+ testes: turn, pause, resume       | Alto  |
| Q2-2 | `terminal/dialog/engine-persistence.js` | 4+ testes: save, load, corrupt | Médio |
| Q2-3 | `services/agent-service.js`   | 5+ testes: start, stop, status       | Alto  |
| Q2-4 | `services/dialog-service.js`  | 5+ testes: send, pause, resume       | Alto  |
| Q2-5 | `api/express/` (post-refactor)| 10+ testes de integração HTTP        | Alto  |
| Q2-6 | `services/health-service.js`  | 4+ testes: healthy, degraded, down   | Médio |

---

### Faixa Q3 — Cobertura sdk/ + bridges/ + observability/ (0-7% → ≥70%)

**Dependências**: O5 (typecheck zero), O7 (circuit breakers)  
**Critério de conclusão**: Coverage ≥70% nas áreas críticas

| Sub | Módulo/Grupo                    | Quantidade testes                              | Risco |
|-----|---------------------------------|------------------------------------------------|-------|
| Q3-1 | `sdk/client.js` (pós-split)   | 5+ testes: connect, disconnect, error          | Alto  |
| Q3-2 | `sdk/rpc/rpc-ops.js` (pós-O5) | 6+ testes por operação RPC                     | Médio |
| Q3-3 | `sdk/rpc/rpc-session.js` (pós)| 6+ testes por operação RPC                     | Médio |
| Q3-4 | `bridges/nerv-bridge.js` (split)| 5+ testes: connect, reconnect, circuit break  | Alto  |
| Q3-5 | `bridges/mcp-tool-bridge.js` (split)| 5+ testes: CB, health, discovery          | Alto  |
| Q3-6 | `observability/metrics.js`    | 8+ testes: record, histogram, snapshot         | Médio |
| Q3-7 | `observability/error-tracker.js` | 5+ testes: record, threshold, rate          | Baixo |
| Q3-8 | `observability/otel.js` (full)| 4+ testes: trace, span, export                 | Médio |

---

### Faixa Q4 — Audit Pipeline: Event Sourcing

**Objetivo**: audit/ imutável, replay, query por range  
**Dependências**: P1 (audit-events schema)  
**Critério de conclusão**: audit/pipeline implementa append-only + replay + query

| Sub | Ação                                              | Risco |
|-----|---------------------------------------------------|-------|
| Q4-1 | Criar `audit/pipeline-wal.js` — append-only WAL  | Alto  |
| Q4-2 | Criar `audit/pipeline-replay.js` — replay events  | Alto  |
| Q4-3 | Criar `audit/pipeline-query.js` — query by range  | Médio |
| Q4-4 | Criar `audit/pipeline-archive.js` — compaction    | Alto  |
| Q4-5 | Migrar `audit/pipeline.js` para usar WAL          | Alto  |
| Q4-6 | Adicionar DI token `AUDIT_PIPELINE_WAL`            | Baixo |
| Q4-7 | 8+ testes: append, replay, query, archive         | Médio |
| Q4-8 | Lint + validar imutabilidade                      | Baixo |

---

### Faixa Q5 — OpenTelemetry Completo + `health/` Module

**Objetivo**: Telemetria real + health probes funcionais  
**Dependências**: O2 (OTEL_TRACER token), P3 (health-service)  
**Critério de conclusão**: otel.js integrado em ≥5 módulos, health endpoint retorna JSON estruturado

| Sub | Ação                                              | Risco |
|-----|---------------------------------------------------|-------|
| Q5-1 | Completar `observability/otel.js` (atual = esqueleto) | Alto |
| Q5-2 | Instrumentar `agent/dialog/turn-executor.js`     | Médio |
| Q5-3 | Instrumentar `sdk/client.js`                     | Médio |
| Q5-4 | Instrumentar `services/session-service.js`       | Médio |
| Q5-5 | Criar `src/copilot/health/` module (ou expandir `services/health-service.js`) | Médio |
| Q5-6 | Health endpoint: `GET /health` retorna status de todos CBs, DB, SDK | Médio |
| Q5-7 | 5+ testes para health probes                      | Medio |

---

## 5. ONDA R — Events Schema + Multi-Agent Prep + Polish (Score: 82 → 98)

### Faixa R1 — events/ Module — Adoção 100%

**Objetivo**: ZERO strings literais de eventos em código de produção  
**Dependências**: P1 (criação), P2 (migração parcial)  
**Critério de conclusão**: Nenhuma string inline de evento em módulos de produção

| Sub | Ação                                              | Risco |
|-----|---------------------------------------------------|-------|
| R1-1 | Audit: `grep -rn "'agent:\|'hub:\|'terminal:\|'phase:" src/copilot/` | Baixo |
| R1-2 | Migrar cada string encontrada para `events/`     | Médio |
| R1-3 | Adicionar ESLint rule para prevenir strings de evento inline | Médio |
| R1-4 | Documentar: event schema reference no README      | Baixo |

---

### Faixa R2 — Multi-Agent Prep: DI.fork() + Worker Isolation

**Objetivo**: Preparar arquitetura para múltiplos agentes simultâneos  
**Dependências**: O2, O3, O4, P2  
**Critério de conclusão**: `container.fork()` funciona, AlwaysAliveAgent não usa module-scope state

| Sub | Ação                                              | Risco |
|-----|---------------------------------------------------|-------|
| R2-1 | Adicionar `fork()` ao DI container               | Alto  |
| R2-2 | Garantir que `always-alive.js` não usa module-scope state (pós O3) | Alto |
| R2-3 | Garantir que `loop-manager.js` não usa module-scope state (pós O4) | Alto |
| R2-4 | Criar `services/agent-service.js` com multi-instance support | Alto |
| R2-5 | Proof-of-concept: 2 agents em paralelo (test)    | Alto  |
| R2-6 | Documentar invariantes de isolamento             | Baixo |

---

### Faixa R3 — Validação Final + Polish

**Objetivo**: Verificar que todos os critérios PARTE-22 foram atingidos  
**Dependências**: Todas as faixas anteriores  
**Critério de conclusão**: Score PARTE-22 ≥ 90/100

| Sub | Verificação                                        | Script/Método              |
|-----|----------------------------------------------------|----------------------------|
| R3-1 | Zero god files (>300 LoC lógica)                  | `find src/ | xargs wc -l | awk '$1>300'` |
| R3-2 | Zero EventEmitter direto                           | `grep -r 'new EventEmitter' src/copilot/` |
| R3-3 | DI tokens ≥ 40                                     | `arch-health.mjs --json`   |
| R3-4 | Deep imports = 0                                   | `arch-health.mjs`          |
| R3-5 | Typecheck errors = 0                               | `npm run typecheck:node`   |
| R3-6 | Test coverage ≥ 70% por módulo                    | Coverage report            |
| R3-7 | Fan-out ≤ 8 por módulo                            | `arch-health.mjs`          |
| R3-8 | services/ cobertura = 100%                        | Revisar importadores       |
| R3-9 | events/ module = 100% adoção                      | grep de strings inline     |
| R3-10| Circuit breakers ≥ 6 ativos                       | health/ endpoint           |
| R3-11| Atualizar PARTE-22F com resultados finais          | Documentação               |

---

## 6. Dependências Entre Faixas (Grafo)

```
O1 → O2 → O3 → O4
O1 → O2 → O7
O2 → P1 → P2 → P3 → P8
O2 → O5
O6 → O7
O2 → O6 → P6
O3 → P2 → Q1
O4 → P2 → Q1
P1 → P2 → Q2
P3 → P8 → Q2
P4 → Q2
P5 → Q2
P6 → Q3
P7 → Q3
O5 → Q3
O7 → Q3
Q1 → R2
Q2 → R2
Q3 → R1 → R3
Q4 → R3
Q5 → R3
```

**Caminho crítico** (depende de mais coisas):
```
O1 → O2 → O3 → O4 → P2 → Q1 → R2 → R3
```

**Faixas paralelizáveis:**
- O1, O5, O6 (podem rodar em paralelo — independentes)
- P4, P5, P6, P7 (podem rodar em paralelo após O1/O2)
- Q1, Q2, Q3 (podem rodar em paralelo após respectivos splits)

---

## 7. Resumo de Volume de Trabalho

| Onda | Faixas | Subfases | Arquivos afetados (est.) | Score |
|------|--------|----------|--------------------------|-------|
| O    | 7      | 75       | ~30                      | 24→42 |
| P    | 8      | 100      | ~80                      | 42→62 |
| Q    | 5      | 60       | ~50 (novos tests)        | 62→82 |
| R    | 3      | 25       | ~20                      | 82→98 |
| **Total** | **23** | **260** | **~180** | **24→98** |

---

## 8. Métricas de Progresso — Checkpoints

| Checkpoint | Após Faixa | Score PARTE-22 | Indicador chave              |
|------------|------------|----------------|------------------------------|
| CP-1       | O4         | ~35            | God files ≤10                |
| CP-2       | P2         | ~45            | 0 EventEmitter direto        |
| CP-3       | P8         | ~62            | services/ cobre 80%          |
| CP-4       | Q3         | ~80            | Coverage 50%+ em módulos críticos |
| CP-5       | R3         | ~98            | Todos critérios PARTE-22 atingidos |

---

## 9. Status de Execução

| Faixa | Status    | Commit | Observação              |
|-------|-----------|--------|-------------------------|
| O1    | ⏳ Pendente | —      | Próxima a executar      |
| O2    | ⏳ Pendente | —      | —                       |
| O3    | ⏳ Pendente | —      | —                       |
| O4    | ⏳ Pendente | —      | —                       |
| O5    | ⏳ Pendente | —      | —                       |
| O6    | ⏳ Pendente | —      | —                       |
| O7    | ⏳ Pendente | —      | —                       |
| P1    | ⏳ Pendente | —      | —                       |
| P2    | ⏳ Pendente | —      | —                       |
| P3    | ⏳ Pendente | —      | —                       |
| P4    | ⏳ Pendente | —      | —                       |
| P5    | ⏳ Pendente | —      | —                       |
| P6    | ⏳ Pendente | —      | —                       |
| P7    | ⏳ Pendente | —      | —                       |
| P8    | ⏳ Pendente | —      | —                       |
| Q1    | ⏳ Pendente | —      | —                       |
| Q2    | ⏳ Pendente | —      | —                       |
| Q3    | ⏳ Pendente | —      | —                       |
| Q4    | ⏳ Pendente | —      | —                       |
| Q5    | ⏳ Pendente | —      | —                       |
| R1    | ⏳ Pendente | —      | —                       |
| R2    | ⏳ Pendente | —      | —                       |
| R3    | ⏳ Pendente | —      | —                       |
