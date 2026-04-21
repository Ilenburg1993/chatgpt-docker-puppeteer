# PARTE-23H — Situação Ideal Completa

**Data**: 2026-04-12 | **Status**: Canônico | **Versão**: 1.0 **Scope**: Visão-alvo para TODOS os
subsistemas de `src/copilot/` — o que "done" significa **Precedente**: PARTE-23G (situação atual),
PARTE-23C (sistemas faltantes)

---

## 0. Premissas da Situação Ideal

1. **Não é rewrite** — Evolução incremental da base existente
2. **Não migra para TypeScript** — Mantém JSDoc `@ts-check`
3. **Não resolve god files** neste escopo (PARTE-22 já endereçou)
4. **Prioriza adoção** sobre criação — muitos subsistemas já existem e só precisam de wiring
5. **Score-alvo honest**: 75-80/100 (produção confiável), não 100 (overengineering)

---

## 1. core/ — Foundation (L0)

### Atual → Ideal

| Aspecto            | Atual                          | Ideal                                                          |
| ------------------ | ------------------------------ | -------------------------------------------------------------- |
| BaseEmitter        | Alias puro para EventEmitter   | Facade com typed events ou remoção (usar EventBus diretamente) |
| events.js no core/ | Legacy AGENT_EVENTS (189 LoC)  | Removido — migrado para events/index.js                        |
| constants.js       | Re-export de events.js legado  | Removido                                                       |
| shared-state.js    | Estado global compartilhado    | Migrado para DI container como singleton scoped                |
| create-emitter.js  | BaseEmitter = NodeEventEmitter | Se mantido: adicionar typed emit/on. Se não: remover           |
| di-container.js    | wireLegacySetters helper       | Removido após migração DI completa                             |

### Ações Concretas

1. Mover `core/events.js` → `events/legacy-agent.js` (re-export temporário em core/)
2. Deprecar `core/constants.js` (adicionar JSDoc `@deprecated`)
3. Converter `shared-state.js` em DI token resolvível

---

## 2. events/ — SSOT de Eventos (L0)

### Atual → Ideal

| Aspecto                 | Atual                                                         | Ideal                                                    |
| ----------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| Fontes de event strings | 4 paralelas (events/, types/, core/events.js, modules locais) | **1 SSOT**: events/index.js                              |
| Coverage                | 31 constantes exportadas                                      | ~80+ constantes (todos os eventos do sistema)            |
| Tipagem                 | Strings plain                                                 | Objetos com payload type: `{ name: string, payload: T }` |
| Documentação            | Nenhuma                                                       | Catálogo com source, payload shape, consumers            |

### Ações Concretas

1. Consolidar TODAS as constantes de evento em events/ (incluindo HUB_EVENTS, HOOK_EVENTS, etc.)
2. Cada módulo que define eventos locais deve exportar para events/
3. Criar events/catalog.md com listagem completa
4. Adicionar JSDoc payload types: `/** @param {{ sessionId: string }} payload */`

---

## 3. DI Container — Adoção Real

### Atual → Ideal

| Aspecto               | Atual                           | Ideal                                    |
| --------------------- | ------------------------------- | ---------------------------------------- |
| Tokens definidos      | 41                              | 41 (sem novos — limpar os 12 não usados) |
| Tokens registrados    | 12 (29%)                        | 25+ (60%+)                               |
| Tokens resolvidos     | 1 em 6 sites                    | 15+ em 30+ sites                         |
| CompositionRoot       | Inexistente (3 arquivos ad-hoc) | 1 arquivo: `core/composition-root.js`    |
| Singletons `let=null` | 25                              | <10 (migrados para DI singleton)         |

### Ações Concretas

1. Criar `core/composition-root.js` que centraliza TODOS os `container.register()` calls
2. Migrar registrations de bootstrap.js, entry.js, terminal/index.js para composition-root
3. Converter 10+ singletons `let=null` em DI singleton tokens
4. Remover 12 tokens que nunca são resolvidos (di-tokens.js cleanup)
5. NervBridge, MCPBridge, HookBus passam a resolver via DI

---

## 4. EventBus — Unificação Real

### Actual → Ideal

| Aspecto                    | Atual                          | Ideal                                  |
| -------------------------- | ------------------------------ | -------------------------------------- |
| bridgeEmitter active       | 2/8 (25%)                      | 8/8 (100%)                             |
| Events bridged             | 12/35+                         | 35+/35+                                |
| Subscribers cross-module   | 0                              | 10+ (observability, audit, metrics)    |
| Observability via EventBus | Não (escuta direto no emitter) | Sim (observers migrados para EventBus) |

### Ações Concretas (por prioridade)

1. **Fase E1**: Bridge os 6 emitters restantes:
   - `loop-manager.js` → bridgeEmitter(loopManager, bus, dialogEventMap)
   - `hooks/bus.js` → bridgeEmitter(hookBus, bus, hookEventMap)
   - `handoff-manager.js` → bridgeEmitter(handoffManager, bus, handoffEventMap)
   - `pinned-files.js` → bridgeEmitter(pinnedFiles, bus, configEventMap)
   - `fanout.js` → bridgeEmitter(fanout, bus, apiEventMap)
   - `state.js` → bridgeEmitter(terminalState, bus, terminalEventMap)
2. **Fase E2**: Subscribers cross-module — observability observers migrados para EventBus.on()
3. **Fase E3**: Remover BaseEmitter de módulos que só precisam de EventBus (hooks/bus.js → pure
   listener)

---

## 5. Plugin System — Ativação

### Atual → Ideal

| Aspecto            | Atual                        | Ideal                                        |
| ------------------ | ---------------------------- | -------------------------------------------- |
| PluginRegistry     | Completo (225 LoC) mas órfão | Integrado no bootstrap                       |
| Plugins existentes | 0                            | 3-5 (hooks-preset, audit-preset, mcp-preset) |
| discoverPlugins()  | Nunca chamado                | Chamado no boot                              |
| Feature flag       | Não há                       | `sdk/feature-flags.js` → `plugins: true`     |

### Ações Concretas

1. Wiring: `entry.js` ou `composition-root.js` chama `discoverPlugins()` +
   `registry.installAll(container)`
2. Feature flag: `isExperimental('plugins')` guarda o load
3. Converter 3 subsistemas existentes em plugins canônicos:
   - `plugins/builtin/audit-plugin.js` → instala pipeline-audit-log
   - `plugins/builtin/mcp-plugin.js` → instala mcp-tool-bridge
   - `plugins/builtin/hooks-plugin.js` → instala presets
4. Documentar API de plugin: `{ name, version, dependencies, install(container) }`

---

## 6. Services — De Anêmico a Feature-Complete

### Atual → Ideal

| Service              | Atual (LoC) | Métodos Atuais         | Métodos Ideais                                       |
| -------------------- | ----------- | ---------------------- | ---------------------------------------------------- |
| session-service      | 208         | start, close, compact  | + resume, getStatus, listActive, getMetrics          |
| audit-service        | 112         | logEvent, getStats     | + flush, query, cleanup, rotate                      |
| conversation-service | 87          | sendMessage            | + getHistory, listSessions, getSessionStatus, search |
| tool-service         | 86          | buildToolSet, validate | + invoke, register, list, getSchema                  |
| **Novos**            |             |                        |                                                      |
| health-service       | 0           | —                      | checkAll, checkComponent, getMetrics, getUptime      |
| bridge-service       | 0           | —                      | status, reconnect, getMetrics (NERV + MCP)           |
| config-service       | 0           | —                      | get, set, validate, watch                            |
| plugin-service       | 0           | —                      | list, install, uninstall, getStatus                  |

### Ações Concretas

1. Expandir 4 services existentes com métodos essenciais
2. Criar health-service (facade sobre sdk/health + bridges + DB + EventBus)
3. Criar bridge-service (facade sobre nerv-bridge + mcp-tool-bridge)
4. Services SEMPRE resolvem dependências via DI (nunca importam diretamente)
5. `services/index.js` limpo — sem re-exports bypass

---

## 7. Bridges — Padronização

### Atual → Ideal

| Aspecto         | Atual                                        | Ideal                                                    |
| --------------- | -------------------------------------------- | -------------------------------------------------------- |
| Retry           | mcp-bridge tem custom (ignora core/retry.js) | Todos usam `withRetry()` de core/retry.js                |
| Circuit breaker | mcp-bridge ad-hoc                            | Todos usam `CircuitBreaker` de core/circuit-breaker.js   |
| Singletons      | nerv-bridge tem 5 `let` vars                 | Migrados para DI singleton                               |
| Shutdown        | Ad-hoc cleanup                               | registerShutdownHandler() com priority                   |
| Health          | Sem health endpoint                          | health-service.checkBridge('nerv') / .checkBridge('mcp') |

### Ações Concretas

1. `mcp-tool-bridge.js`: Substituir retry ad-hoc por `withRetry()` de core/retry.js
2. `mcp-tool-bridge.js`: Substituir circuit breaker ad-hoc por `CircuitBreaker` de core/
3. `nerv-bridge.js`: 5 singletons → DI tokens (NERV_BRIDGE, NERV_AGENT, etc.)
4. Ambos: `registerShutdownHandler('nerv-disconnect', fn, 20)` e `('mcp-disconnect', fn, 20)`

---

## 8. Testes — De 5% a 70%+

### Atual → Ideal

| Aspecto         | Atual        | Ideal                                              |
| --------------- | ------------ | -------------------------------------------------- |
| Specs passando  | ~21 (5%)     | 224+ (70%)                                         |
| Root cause fix  | Não aplicado | `import { test } from 'node:test'` em 299 files    |
| Secondary fixes | —            | Mocks atualizados, imports corrigidos              |
| Coverage tool   | Inexistente  | `c8` ou `node --test --experimental-test-coverage` |
| CI pipeline     | Inexistente  | GitHub Actions com lint + typecheck + test         |

### Fases de Fix

1. **T1** (1 script): Injetar `import { test, describe, it } from 'node:test'` em 299 files
2. **T2** (por módulo): Corrigir imports quebrados (módulos renomeados na PARTE-22)
3. **T3** (por módulo): Atualizar mocks obsoletos
4. **T4**: Adicionar `c8` para coverage reporting
5. **Alvo**: 70%+ specs passando, 50%+ line coverage

---

## 9. Error Handling — Convergência

### Atual → Ideal

| Aspecto            | Atual                                    | Ideal                           |
| ------------------ | ---------------------------------------- | ------------------------------- |
| Global handlers    | Duplicados (entry.js + error-tracker.js) | 1 ponto: error-tracker.js       |
| process.exit calls | 6 em entry.js                            | 1 (após shutdown completo)      |
| Error hierarchy    | Existe (CopilotError) mas pouco usada    | Adotada em todos os throw sites |
| Swallowed errors   | catch vazio em bridges                   | Sempre `logSwallowed()`         |

### Ações Concretas

1. Remover process.on('uncaughtException') de entry.js — manter só em error-tracker
2. Reduzir process.exit a 1 call (após runShutdown)
3. Grep catch vazio → substituir por logSwallowed
4. Bridges: usar CopilotError/BridgeError em vez de throw Error()

---

## 10. Shutdown — Cobertura Completa

### Atual → Ideal

| Handler                  | Atual | Ideal |
| ------------------------ | ----- | ----- |
| agent-session-stop (P10) | ✅    | ✅    |
| sdk-client-close (P20)   | ✅    | ✅    |
| nerv-disconnect (P20)    | ❌    | ✅    |
| mcp-disconnect (P20)     | ❌    | ✅    |
| db-close (P30)           | ❌    | ✅    |
| eventbus-dispose (P30)   | ❌    | ✅    |
| terminal-server (P40)    | ❌    | ✅    |
| timer-cleanup (P50)      | ✅    | ✅    |

### Ações Concretas

1. nerv-bridge: `registerShutdownHandler('nerv-disconnect', disconnectNerv, 20)`
2. mcp-bridge: `registerShutdownHandler('mcp-disconnect', disconnectMcp, 20)`
3. db/sqlite.js: `registerShutdownHandler('db-close', closeDb, 30)`
4. event-bus: `registerShutdownHandler('eventbus-dispose', bus.dispose, 30)`
5. terminal/server: `registerShutdownHandler('terminal-server', closeServer, 40)`

---

## 11. Observability — De Module-Scoped a System-Wide

### Atual → Ideal

| Aspecto             | Atual                         | Ideal                                |
| ------------------- | ----------------------------- | ------------------------------------ |
| Listeners           | Via `.on()` direto no emitter | Via EventBus (cross-module)          |
| Ciclo config↔observ | Existe                        | Quebrado (config não importa observ) |
| Health endpoint     | Inexistente                   | `/health` com JSON status            |
| Metrics endpoint    | Inexistente                   | `/metrics` com Prometheus format     |
| Request context     | Não há                        | AsyncLocalStorage com request-id     |

### Ações Concretas

1. Observers: migrar de `emitter.on()` para `eventBus.on()`
2. Quebrar ciclo: config/ usa DI token LOGGER em vez de import direto
3. Adicionar `/health` route em api/express/
4. Adicionar `/metrics` route com MetricsStore.snapshot()
5. (Longo prazo) AsyncLocalStorage para request-id propagation

---

## 12. Bootstrap — CompositionRoot

### Atual → Ideal

| Aspecto             | Atual                                 | Ideal                                                 |
| ------------------- | ------------------------------------- | ----------------------------------------------------- |
| Registration points | 3 (bootstrap.js, entry.js, terminal/) | 1 (composition-root.js)                               |
| Boot order          | Implícita                             | Declarativa (phases array)                            |
| Plugin load         | Não existe                            | discoverPlugins() → installAll()                      |
| Validation          | Nenhuma                               | Container.validate() — verifica tokens não resolvidos |

### Ações Concretas

1. Criar `core/composition-root.js`:

```js
export function composeContainer(container) {
  // Phase 1: Core infrastructure
  container.register(EVENT_BUS, () => createEventBus());
  container.register(SHUTDOWN, () => createShutdownManager());
  // Phase 2: Services
  container.register(SESSION_SERVICE, () => createSessionService());
  // Phase 3: Bridges
  container.register(NERV_BRIDGE, () => createNervBridge());
  // Phase 4: Plugins
  const registry = discoverPlugins(PLUGINS_DIR, pluginRegistry);
  registry.installAll(container);
}
```

2. entry.js e terminal/ chamam `composeContainer(container)` uma vez
3. Remover registrations ad-hoc dos 3 arquivos atuais

---

## 13. API — Health & Observability Endpoints

### Atual → Ideal

| Aspecto          | Atual       | Ideal                                       |
| ---------------- | ----------- | ------------------------------------------- |
| `/health`        | Não existe  | JSON: status, uptime, bridges, db, eventbus |
| `/metrics`       | Não existe  | MetricsStore.snapshot()                     |
| Error middleware | Básico      | CopilotError-aware com error codes          |
| Rate limiting    | Inexistente | Token bucket middleware (core/ class)       |

---

## 14. Mapa Visual — Atual vs Ideal

### Atual

```
main.js ──→ entry.js ──→ always-alive ──→ dialog/loop-manager
                │            │ (bridgeEmitter ✅)
                │            └→ events (7→EventBus)
                │
                ├→ bootstrap.js ──→ DI: EVENT_BUS, loggers
                │
                └→ terminal/ ──→ DI: HUB, agents
                     │
                     └→ hub.js ──→ orchestrator (bridgeEmitter ✅)
                                    └→ events (5→EventBus)

[loop-manager, hooks/bus, handoff, pinned, fanout, state] → eventos LOCAIS ONLY ❌
[nerv-bridge, mcp-bridge] → retry AD-HOC, shutdown AD-HOC ❌
[plugins/] → ÓRFÃO ❌
[services/] → ANÊMICO ❌
[tests/] → 95% FALHANDO ❌
```

### Ideal

```
main.js ──→ composition-root.js ──→ DI container (ALL tokens)
                │                        │
                ├→ Phase 1: core/         ├→ EVENT_BUS
                ├→ Phase 2: services/     ├→ SESSION_SERVICE
                ├→ Phase 3: bridges/      ├→ NERV_BRIDGE, MCP_BRIDGE
                ├→ Phase 4: plugins/      └→ PLUGIN_REGISTRY
                │
                └→ entry.js / terminal/ (consumers only, zero registrations)

[ALL 8 emitters] ──bridgeEmitter──→ EventBus ──→ [observers, audit, metrics] ✅
[ALL bridges] ──→ core/retry.js + core/circuit-breaker.js ✅
[ALL shutdown] ──→ core/shutdown.js (8 handlers, priority) ✅
[plugins/] ──→ 3+ builtin plugins, discoverPlugins() on boot ✅
[services/] ──→ 8 feature-complete facades ✅
[tests/] ──→ 70%+ PASSANDO ✅
[/health, /metrics] ──→ JSON status endpoints ✅
```

---

## 15. Gap Score — Atual vs Ideal

| Dimensão                 | Atual      | Ideal              | Gap     |
| ------------------------ | ---------- | ------------------ | ------- |
| DI adoption              | 29%        | 60%+               | Médio   |
| Event unification        | 25%        | 100%               | Alto    |
| Test pass rate           | 5%         | 70%+               | Crítico |
| Shutdown coverage        | 3/8        | 8/8                | Médio   |
| Service completeness     | 4 anêmicos | 8 feature-complete | Alto    |
| Plugin integration       | 0%         | 100%               | Alto    |
| Bridge standardization   | 0%         | 100%               | Alto    |
| Health endpoints         | 0%         | 100%               | Médio   |
| Error convergence        | 50%        | 95%                | Médio   |
| Bootstrap centralization | 33%        | 100%               | Médio   |

**Score composto**: Atual ~35/100 → Ideal ~80/100 (gap de 45 pontos)

---

## 16. Prioridades de Fechamento de Gap (Impacto × Esforço)

| #   | Gap                          | Impacto    | Esforço               | ROI   |
| --- | ---------------------------- | ---------- | --------------------- | ----- |
| 1   | Test fix (import)            | Muito Alto | Baixo (1 script)      | ★★★★★ |
| 2   | bridgeEmitter 6 restantes    | Alto       | Baixo (6 edits)       | ★★★★★ |
| 3   | Bridge retry → core/retry.js | Alto       | Baixo (1 edit)        | ★★★★☆ |
| 4   | CompositionRoot              | Alto       | Médio                 | ★★★★☆ |
| 5   | Shutdown handlers +5         | Médio      | Baixo (5 linhas each) | ★★★★☆ |
| 6   | Plugin wiring                | Médio      | Baixo (10 linhas)     | ★★★☆☆ |
| 7   | Health endpoint              | Médio      | Médio                 | ★★★☆☆ |
| 8   | Services expansion           | Médio      | Alto                  | ★★☆☆☆ |
| 9   | Event SSOT consolidation     | Alto       | Alto                  | ★★☆☆☆ |
| 10  | Error handler dedup          | Baixo      | Baixo                 | ★★★☆☆ |
