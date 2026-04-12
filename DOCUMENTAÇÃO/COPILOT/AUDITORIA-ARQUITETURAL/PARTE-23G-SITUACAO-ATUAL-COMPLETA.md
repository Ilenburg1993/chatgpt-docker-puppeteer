# PARTE-23G — Situação Atual Completa

**Data**: 2026-04-12 | **Status**: Canônico | **Versão**: 1.0
**Scope**: Estado real de TODOS os subsistemas de `src/copilot/` com profundidade total
**Precedente**: PARTE-23A (diagnóstico sintético), PARTE-22A (situação anterior)

---

## 1. Visão Geral Absoluta

| Dimensão | Valor |
|----------|-------|
| Total de módulos | 20 |
| Total de arquivos .js (prod) | 320 |
| Total de LoC (prod) | ~52.557 |
| Total de spec files | 320 unit + 50 regression + 26 integration |
| Testes passando | ~21 spec files (com `import node:test`), ~299 falham (`test not defined`) |
| Health-check calibrado | 97/100 (A+) |
| Health-check honesto estimado | ~42/100 |
| TypeCheck errors | 0 ✅ |
| ESLint errors | 0 ✅ |
| Commit HEAD | `b27204d8` em `main` |
| Node.js | v24.14.0, ESM, `@ts-check` |

---

## 2. Estado Detalhado por Módulo

### 2.1 `core/` — L0, Foundation (23 arquivos, 3.221 LoC)

**O que faz**: Classes de erro, DI container, DI tokens, EventBus, circuit breaker, cache, mutex, shutdown, retry, timer registry, JSON utils, schemas.

**Estado real**:
- ✅ `di.js` (259 LoC) — Container funcional com singleton/transient/scoped + fork + dispose
- ✅ `di-tokens.js` (343 LoC) — 41 tokens organizados por layer (L0→L4+)
- ✅ `event-bus.js` (292 LoC) — Wildcards, middleware, counters, `bridgeEmitter()` helper
- ✅ `circuit-breaker.js` (135 LoC) — Closed→Open→Half-Open, `CircuitOpenError`
- ✅ `cache.js` (183 LoC) — LRU com TTL, stats (hits/misses)
- ✅ `mutex.js` (150 LoC) — Promise-chain serial, `withMutex()` helper
- ✅ `retry.js` (85 LoC) — Exponential backoff + jitter + abort signal + shouldRetry
- ✅ `shutdown.js` (109 LoC) — Priority-based handler registry, `runShutdown()`
- ✅ `timer-registry.js` (113 LoC) — Auto-cleanup via shutdown, dedup por ID
- ✅ `errors.js` (144 LoC) — CopilotError → SessionError, ConfigError, ToolError, BridgeError, TimeoutError
- ✅ `error-codes.js` (76 LoC) — Catálogo de 8 códigos semânticos
- ✅ `error-handlers.js` (153 LoC) — logSwallowed, safe wrappers
- ✅ `schemas.js` (127 LoC) — JSON schema validation helpers
- ✅ `safe-json.js` (61 LoC) — Parse seguro
- ✅ `structured-message.js` (350 LoC) — Builder de system messages
- ⚠️ `create-emitter.js` (28 LoC) — `BaseEmitter = NodeEventEmitter` (alias puro, não facade)
- ⚠️ `di-container.js` (48 LoC) — Wiring helper `wireLegacySetters` (transitório)
- ⚠️ `events.js` (189 LoC) — AGENT_EVENTS legacy (deveria migrar para events/)
- ⚠️ `constants.js` (14 LoC) — Re-exports de events.js (deveria ser events/)
- ⚠️ `shared-state.js` (42 LoC) — Estado compartilhado global (anti-pattern)

**Dúvidas resolvidas**:
- Q: `create-emitter.js` agrega algo? R: Não. É `export const BaseEmitter = NodeEventEmitter`. Zero lógica.
- Q: `retry.js` é usado pelo sistema? R: Sim — importado por `core/index.js`, usado por `agent/lifecycle/entry.js`.
- Q: `events.js` no core deveria existir? R: Não. É legado que deveria migrar para `events/`.

### 2.2 `events/` — L0, SSOT de Eventos (1 arquivo, 154 LoC)

**O que faz**: Constantes de strings de evento canônicas.

**Estado real**:
- `index.js` exporta 31 constantes flat (AGENT_READY, AGENT_STOPPED, etc.)
- Importa de `types/events.js` e `conversation-hub/events.js` para re-exportar
- **Apenas 5 arquivos** importam de events/ diretamente
- **bridgeEmitter** mapping em always-alive e hub/orchestrator usa constantes de events/

**Problema central**: events/ é SSOT declarado mas não é SSOT de fato. A maioria do código ainda importa de `#copilot/core` (AGENT_EVENTS) ou usa HUB_EVENTS localmente.

### 2.3 `types/` — L0, Tipagem (2 arquivos, 189 LoC)

**O que faz**: Definições de tipos JSDoc para eventos e interfaces.

**Estado real**:
- `events.js` (149 LoC) — Objetos tipados: `HOOK_EVENTS`, `SESSION_EVENTS`, `TOOL_EVENTS`, `SDK_EVENTS`, `AGENT_EVENTS`, `API_EVENTS`, `TERMINAL_EVENTS`, `AUDIT_EVENTS`, `BaseEvent` typedef
- `index.js` (40 LoC) — Re-exports
- **Importado por**: events/index.js (para re-export), core/event-bus.js (para BaseEvent type)
- **Nunca importado** via `#copilot/types` por nenhum módulo de negócio

**Veredicto**: Semi-órfão. A tipagem `BaseEvent` é útil (usada pelo EventBus), mas os objetos de constantes `HOOK_EVENTS` etc. duplicam events/index.js.

### 2.4 `db/` — L0, Persistência (3 arquivos, 439 LoC)

**O que faz**: SQLite wrapper + migrations.

**Estado real**:
- `sqlite.js` (234 LoC) — `getCopilotDb()` singleton, WAL mode, busy timeout 5s
- `migrations.js` (195 LoC) — Schema versioning para conversations, turns, memories, configs
- `index.js` (10 LoC) — Re-export
- 3 singletons (`let db = null`, `let migrated = false`, `let connectionPool = null`)

### 2.5 `sdk/` — L1, Wrapper @github/copilot-sdk (42 arquivos, 7.833 LoC)

**O que faz**: Facade sobre o SDK do GitHub Copilot. Client, session, tools, RPC, health, feature-flags.

**Estado real**:
- `client.js` (384 LoC) — CopilotClient singleton, autoInit, session management
- `types.js` (646 LoC) — Definições JSDoc extensivas (legítimo, não é god file)
- `feature-flags.js` (95 LoC) — SDK-specific flags (`fleet`, `agents`, `skills`, `mcp`, `plugins`, `extensions`)
- `rpc.js` + `rpc-ops.js` + `rpc-session.js` — RPC experimental (não production)
- `health.js` — SDK health check (auth validation, connectivity)
- 5 singletons (`let _client`, `let _session`, `let _agentStore`, `let _toolRegistry`, `let _turnManager`)
- **Fan-out**: 1 (só importa core/) — bem isolado

### 2.6 `audit/` — L1, Auditoria (8 arquivos, 876 LoC)

**O que faz**: Pipeline de auditoria, ring buffer, JSONL writer, permission logging.

**Estado real**:
- `pipeline-audit-log.js` (331 LoC) — Pipeline principal de audit log
- `pipeline-permission.js` (173 LoC) — Audit de permissões de ferramentas
- `ring-buffer.js` (80 LoC) — Buffer circular para logs recentes
- `logger.js` (66 LoC) — Audit logger helper
- 2 singletons

### 2.7 `observability/` — L2, Observabilidade (22 arquivos, 4.495 LoC)

**O que faz**: Logger, event collector, metrics store, error tracker, error alerting, OTEL config, observers.

**Estado real**:
- `logger.js` (340 LoC) — Logger principal, usado por **127 arquivos** em todo o sistema
- `metrics.js` (396 LoC) — MetricsStore com histogram, snapshot, latency tracking
- `error-tracker.js` (233 LoC) — Ring buffer de erros + global exception handlers
- `bootstrap.js` (90 LoC) — **Ponto de wiring central**: registra EVENT_BUS, loggers no DI container
- `observers/` — 4 arquivos de event handlers: session-agent (383), dialog-task (426), etc.
- `collectors/` — 4 arquivos de event collectors: session (393), tool, interaction, assistant
- **Fan-out**: 5 (core, events, audit, config, db) — Aceito para módulo de infraestrutura
- 3 singletons

**Problema**: `config/` importa `observability/` para logging, e `observability/` importa `config/` → **ciclo real**

### 2.8 `config/` — L2, Configuração (7 arquivos, 1.272 LoC)

**O que faz**: Env vars, custom agents, pinned files, model mappings.

**Estado real**:
- `custom-agents.js` (325 LoC) — Agent config loader
- `pinned-files.js` (207 LoC) — `extends BaseEmitter` — emite `changed` event
- `env.js` (~200 LoC) — Variáveis de ambiente centralizadas
- **Ciclo com observability/** — config importa log de observability para logging

### 2.9 `hooks/` — L3, Sistema de Hooks (21 arquivos, 3.724 LoC)

**O que faz**: Hook system para SDK (preToolUse, postToolUse, sessionStart, etc.) + HookBus + presets.

**Estado real**:
- `factory.js` (417 LoC) — Factory dos 6 slot types do SDK
- `bus.js` (186 LoC) — `class HookBus extends BaseEmitter` — emit local, **sem bridge para EventBus**
- `presets/` — 8 presets: audit, deny-all, interactive, minimal, production, profiles, safe
- `types.js` — Definições de tipos para hooks
- `composer.js` — Composição de múltiplos presets
- **Sem bridgeEmitter** para EventBus (diferente de always-alive e orchestrator)

### 2.10 `tools/` — L3, Ferramentas (28 arquivos, 6.324 LoC)

**O que faz**: Tool definitions para o SDK — introspection, web, todo, GitHub, developer, hub tools.

**Estado real**:
- `introspection-tools.js` (408 LoC) — 8+ tool definitions
- `web-tools.js` (398 LoC) — HTTP tools
- `todo/store.js` — Todo persistence (SQLite)
- `hub-tools.js` — ConversationHub manipulation tools
- `hook-tools.js` — Hook management tools
- Organizado em subdirectories: `todo/`, `github/`

### 2.11 `bridges/` — L3, Bridges (12 arquivos, 2.366 LoC)

**O que faz**: Integração com NERV event bus, MCP bridge, Git operations.

**Estado real**:
- `nerv-bridge.js` (435 LoC) — Bridge para NERV global event bus. **5 singletons** (`_agent`, `_nerv`, `_inboundUnsub`, `_beforeStopRegistered`, `_pendingReadyHandler`)
- `mcp-tool-bridge.js` (432 LoC) — MCP tool discovery + health probe + circuit breaker. Retry com backoff **próprio** (não usa core/retry.js)
- `git-bridge-read.js` (293 LoC) — Git read operations
- `git-bridge-write.js` (227 LoC) — Git write operations
- **Problemas**: Retry ad-hoc em mcp-tool-bridge, singletons densos em nerv-bridge

### 2.12 `plugins/` — L3, Plugin System (2 arquivos, 255 LoC) — **ÓRFÃO**

**O que faz**: Registry de plugins com discover/load/install lifecycle.

**Estado real**:
- `plugin-registry.js` (225 LoC) — `class PluginRegistry` com register, install, installAll, list, has, get, clear
- `index.js` (30 LoC) — Re-exports + `CopilotPlugin` typedef
- **discoverPlugins()** — Escaneia subdiretórios `tools/`, `hooks/`, `bridges/`, `services/` por JS files
- **Dependency resolution**: Plugin pode declarar `dependencies: ['other-plugin']` e install falha se dep não instalada
- **DI integration**: `plugin.install(container)` recebe o DI container
- **ZERO importadores** — Nenhum módulo chama PluginRegistry. Nunca integrado ao bootstrap.

**Dúvidas resolvidas**:
- Q: O plugin system funciona tecnicamente? R: Sim, código está completo e funcional. Falta wiring no entry point.
- Q: Quem deveria integrá-lo? R: `agent/lifecycle/entry.js` ou `observability/bootstrap.js` deveria chamar `discoverPlugins()` + `registry.installAll()`.
- Q: Existem plugins para descobrir? R: Não. Nenhum arquivo segue a convenção `plugins/tools/*.js` etc.

### 2.13 `services/` — L4, Facades (5 arquivos, 529 LoC) — **ANÊMICO**

**O que faz**: Facades de alto nível para subsistemas.

**Estado real**:
- `session-service.js` (208 LoC) — Facade sobre SDK sessions
  - ✅ startSession, closeSession, compactHistory
  - ⚠️ Emite via EventBus (resolve EVENT_BUS), mas não garante EventBus disponível
  - ❌ Sem resumeSession, getSessionStatus
- `audit-service.js` (112 LoC) — Facade sobre audit
  - ✅ logEvent, getStats
  - ❌ Sem flush, query, cleanup
- `conversation-service.js` (87 LoC) — Facade sobre conversation-hub
  - ✅ sendMessage
  - ❌ Sem getHistory, listSessions, getSessionStatus
- `tool-service.js` (86 LoC) — Facade sobre tools
  - ✅ buildToolSet, validate
  - ❌ Sem invoke, register, list
- `index.js` (36 LoC) — Barrel com **raw re-exports bypass**: `export { alwaysAliveAgent } from '#copilot/agent'`

### 2.14 `agent/` — L4, Agent Core (57 arquivos, 7.951 LoC)

**O que faz**: AlwaysAliveAgent, DialogLoopManager, task execution, handoff, lifecycle.

**Estado real**:
- `always-alive.js` (585 LoC) — State machine (dormant→starting→ready→stopping→stopped), queue, events
  - ✅ `bridgeEmitter()` conectado: 7 events → EventBus
  - ⚠️ God file: lifecycle + queue + events + bootstrap em 1 arquivo
- `dialog/loop-manager.js` (582 LoC) — Turn queue, watchdog, protocol, mutex
  - ❌ **Sem bridgeEmitter** para EventBus (dialog:* events só emitidos localmente)
- `lifecycle/entry.js` (212 LoC) — Bootstrap do agent process (DI register, shutdown, signal handlers)
- `infra/handoff-manager.js` — Agent handoff management
  - ❌ **Sem bridgeEmitter**
- 57 arquivos incluindo tasks, commands, strategies

### 2.15 `conversation-hub/` — L4, Hub de Conversas (12 arquivos, 2.566 LoC)

**O que faz**: Multi-session management, message routing, Socket.io broadcasting.

**Estado real**:
- `hub.js` — Hub principal
  - ✅ `bridgeEmitter()` conectado: 5 events → EventBus (SESSION_CREATED, SESSION_CLOSED, TURN_SENT, TURN_COMPLETE, USER_INJECTED)
- `orchestrator.js` (409 LoC) — `extends BaseEmitter`, gerencia sessions
  - Emitter local, events bridged via hub.js
- `store.js` (562 LoC) — SQLite persistence (god file)
- `socket-ns.js` (443 LoC) — Socket.io namespace handler
- `events.js` — HUB_EVENTS (23 constantes locais)

### 2.16 `channel/` — L4, Client Communication (7 arquivos, 1.382 LoC)

**O que faz**: Client connection, injection, SSE, dialog, history, structured messages.

**Estado real**:
- `client.js` (487 LoC) — God file: transport + dialog + reconnect
- `inject.js` (401 LoC) — Message injection com rate limiting **ad-hoc**
- `sse-client.js` (143 LoC) — SSE client
- `client-dialog.js` (115 LoC), `client-structured.js` (98 LoC), `client-history.js` (58 LoC)

### 2.17 `api/` — L5, HTTP/REST/SSE API (21 arquivos, 3.327 LoC)

**O que faz**: Express routes, middleware, SSE fanout, bridge API.

**Estado real**:
- `express/` — 10 arquivos: agent, client, hooks, middleware, observability, session-crud, session-messaging, sessions, webhooks
- `bridge/` — 4 arquivos: control, dialog, stream, tasks
- `sse/` — 4 arquivos: fanout, replay-buffer, utils
- **Sem health endpoint** — Nenhum `/health` route
- `fanout.js` usa `createEmitter()` para broadcast — **sem bridge** para EventBus

### 2.18 `terminal/` — L6, CLI/REPL (47 arquivos, 7.655 LoC)

**O que faz**: REPL interativa, servidor HTTP para inject, comandos CLI, dialog engine.

**Estado real**:
- `repl.js` (415 LoC) — Main loop + dispatch
- `server.js` (395 LoC) — HTTP routes + SSE + file upload
- `state.js` (353 LoC) — State emitter via `createEmitter()` — **sem bridge**
- `dialog/engine.js` (356 LoC) — Turn handling
- `commands/` — 15+ command files (gh.js 383 LoC máx)
- `handlers/` — system-metrics, session-display, etc.
- `index.js` (236 LoC) — Bootstrap: DI registrations, wiring
- **Fan-out**: 8 (no limite) — importa services, core, config, agent, conv-hub, observability, hooks, tools

---

## 3. Estado do Sistema de Eventos (Detalhe Total)

### 3.1 bridgeEmitter — Cobertura Real

| Emitter | Bridge? | Events Bridged | Events Locais |
|---------|---------|---------------|---------------|
| always-alive.js | ✅ | 7 (ready, before-stop, stopped, error, dialog.loop.changed, session.keepalive, task.started, task.delta) | 0 locais-only |
| hub/orchestrator.js | ✅ via hub.js | 5 (SESSION_CREATED, SESSION_CLOSED, TURN_SENT, TURN_COMPLETE, USER_INJECTED) | ~18 locais-only |
| loop-manager.js | ❌ | 0 | 6+ (turn_start, turn_end, stalled, timeout, tool_use, phase:changed) |
| hooks/bus.js | ❌ | 0 | 5+ (pre_tool_use, post_tool_use, session_start, session_end, error_occurred, prompt_submitted) |
| handoff-manager.js | ❌ | 0 | 2+ |
| pinned-files.js | ❌ | 0 | 1 (changed) |
| fanout.js | ❌ | 0 | 1 (data) |
| state.js | ❌ | 0 | 2+ (stateChanged) |

**Resumo**: 2/8 emitters bridged (25%), 12/35+ events bridged (~34%)

### 3.2 EventBus Subscribers (quem escuta via EventBus.on)

Nenhum subscriber cross-module via EventBus foi encontrado fora dos services.
Os services (session-service, audit-service, etc.) resolvem EVENT_BUS do DI, mas **não registram listeners** — eles emitem, não escutam.
Observability ** não escuta** via EventBus — escuta via `.on()` direto no emitter.

**Conclusão**: EventBus é unidirecional atualmente — só emite, ninguém escuta centralmente.

---

## 4. Estado do DI Container

### 4.1 Tokens Registrados no Runtime

| Token | Registrado em | Factory |
|-------|--------------|---------|
| SHUTDOWN_LOGGER | bootstrap.js | `() => log` |
| DB_LOGGER | bootstrap.js | `() => log` |
| SDK_LOGGER | bootstrap.js | `() => log` |
| AUDIT_LOGGER | bootstrap.js | `() => log` |
| EVENT_BUS | bootstrap.js | `() => createEventBus()` |
| TOOLS_BUILDER | bootstrap.js | `() => deps.buildTool` |
| AUDIT_BUS | entry.js | `() => defaultBus` |
| HUB | terminal/index.js | `() => conversationHub` |
| PERMISSION_AGENT | terminal/index.js | `() => alwaysAliveAgent` |
| FALLBACK_AGENT | terminal/index.js | `() => alwaysAliveAgent` |
| BRIDGE_AGENT | terminal/index.js | `() => alwaysAliveAgent` |
| NERV_BRIDGE_AGENT | terminal/index.js | `() => alwaysAliveAgent` |

**Registrados**: 12/41 tokens (29%)
**Não registrados**: 29 tokens definidos em di-tokens.js mas nunca chamam `container.register()`

### 4.2 Resolves no Runtime

| Token | Resolved em | Resultado |
|-------|------------|-----------|
| EVENT_BUS | services/*.js, always-alive.js, hub.js | EventBus singleton |

**Resolved**: 1 token (EVENT_BUS) em 6 call sites
**29 tokens nunca resolved** — são definições sem uso

---

## 5. Estado dos Testes

### 5.1 Causa Raiz das 575 Falhas

**`ReferenceError: test is not defined`** — 299 de 320 specs unitários não incluem `import { test, describe } from 'node:test'`.

No Node.js ≥24, `node --test file.js` **não injeta** `test()` como global quando o arquivo é um ES module. A função `test()` precisa ser importada explicitamente:

```js
// CORRETO:
import { test, describe, it } from 'node:test';
test('meu teste', () => { ... });

// INCORRETO (falha com test not defined):
test('meu teste', () => { ... });  // ← 299 arquivos fazem isso
```

### 5.2 Distribuição

| Grupo | Specs | Com `import node:test` | Sem import | Passing |
|-------|-------|----------------------|-----------|---------|
| tests/unit/copilot/ | 220 | ~15 | ~205 | ~15 |
| tests/unit/audit/ | 19 | ~2 | ~17 | ~2 |
| tests/unit/rag/ | 14 | 0 | 14 | 0 |
| tests/unit/server/ | 10 | 0 | 10 | 0 |
| tests/unit/core/ | 7 | 0 | 7 | 0 |
| tests/unit/* (outros) | 50 | ~4 | ~46 | ~4 |
| tests/regression/ | ~50 | ? | ~50 | ? |
| **Total** | **~370** | **~21** | **~299+** | **~21** |

### 5.3 Fix Pattern

```diff
+ import { test, describe, it, beforeEach, afterEach, mock } from 'node:test';
  import assert from 'node:assert/strict';
```

**Esforço estimado**: Um script de 10 linhas pode injetar o import ausente em todos os 299 arquivos.
**Risco**: Após o fix de import, muitos testes podem ter outros problemas (mocks obsoletos, imports quebrados para módulos renomeados). A estimativa é que ~50-60% passarão após o fix de import.

---

## 6. Estado do Error Handling

### 6.1 Hierarquia de Erros
```
Error
 └── CopilotError (code='COPILOT_ERROR')
      ├── SessionError (code='SESSION_ERROR')
      ├── ConfigError (code='CONFIG_ERROR')
      ├── ToolError (code='TOOL_ERROR')
      ├── BridgeError (code='BRIDGE_ERROR')
      ├── TimeoutError (code='TIMEOUT_ERROR')
      ├── CircuitOpenError (code='CIRCUIT_OPEN')
      └── RpcError (code='RPC_ERROR')
```

### 6.2 Global Exception Handlers
- `agent/lifecycle/entry.js`: `process.on('uncaughtException')` + `process.on('unhandledRejection')`
- `observability/error-tracker.js`: Optional global handlers via `registerGlobalHandlers()`
- **Duplicação**: entry.js e error-tracker ambos registram handlers. Entry.js ganha prioridade.

### 6.3 Try/Catch Coverage
- **368 try/catch blocks** em 320 arquivos
- Maioria segue pattern correto: `try { ... } catch (err) { logSwallowed(err, '...') }`
- Alguns bridges usam catch vazio (swallow silencioso)

---

## 7. Estado do Shutdown

### 7.1 Handlers Registrados
```
core/shutdown.js registerShutdownHandler():
  - 'agent-session-stop'  (priority 10, entry.js)
  - 'sdk-client-close'    (priority 20, entry.js)
  - 'timer-cleanup'       (priority 50, timer-registry.js - auto-registered)
```

### 7.2 Problemas
- Apenas 3 handlers registrados via API formal
- Bridges (nerv, mcp) fazem cleanup ad-hoc (não usam registerShutdownHandler)
- DB close não é registrado
- EventBus dispose não é registrado
- terminal/server close não é registrado

---

## 8. Estado do Bootstrap/Wiring

### 8.1 Boot Sequence Atual
```
1. main.js                → Maestro boot (NERV, BrowserPool, KERNEL) — 2173 LoC
2. agent/lifecycle/entry.js → Agent boot (DI register, CopilotClient, signals)
3. observability/bootstrap.js → Late deps (EVENT_BUS, loggers, TOOLS_BUILDER)
4. terminal/index.js       → Terminal boot (DI register HUB, agents, REPL, server)
```

### 8.2 Problemas no Bootstrap
- `main.js` (2173 LoC) é um mega-bootstrap do sistema legado (não-copilot)
- `entry.js` e `terminal/index.js` fazem DI registrations ad-hoc
- **Sem CompositionRoot** — registrations espalhadas em 3+ arquivos
- **PluginRegistry nunca chamado** — discoverPlugins() nunca executado
- Ordem de boot implícita (não declarada)

---

## 9. Dúvidas Exaustivas — Todas Respondidas

### Q1: O sistema de feature flags genérico existe?
**R**: Parcial. `sdk/feature-flags.js` (95 LoC) tem flags específicas do SDK (`fleet`, `agents`, `skills`, `mcp`, `plugins`, `extensions`). Não é genérico — só funciona para experimental features do SDK. Não há feature flags runtime para o sistema como um todo.

### Q2: Existe rate limiting além de throttle ad-hoc?
**R**: Não. `channel/inject.js` e `conversation-hub/orchestrator.js` implementam delays ad-hoc com setTimeout. Não há token bucket, sliding window, ou rate limiter reutilizável.

### Q3: O retry do core/retry.js é usado por bridges?
**R**: Não. `core/retry.js` exporta `withRetry()`, mas `mcp-tool-bridge.js` implementa seu próprio backoff (linhas 97-154). `nerv-bridge.js` não tem retry formal. Apenas `agent/lifecycle/entry.js` usa `withRetry()`.

### Q4: AsyncLocalStorage existe no sistema?
**R**: Apenas em `src/infra/proxy/chromeProxyService.js` (sistema legado, não copilot). Não existe em `src/copilot/`.

### Q5: Quantos DI tokens são realmente usados?
**R**: 12/41 são registrados, 1 (EVENT_BUS) é resolvido em 6 call sites. 29 tokens são definidos mas nunca registrados nem resolvidos.

### Q6: O EventBus tem subscribers cross-module?
**R**: Não. O EventBus emite events via `bridgeEmitter()` em 2 fontes, mas **ninguém subscreve** via `eventBus.on()` em outro módulo. Os services emitem no bus mas não lêem. Observability escuta via `.on()` direto no emitter local.

### Q7: Qual a relação entre main.js e copilot/?
**R**: `main.js` (2173 LoC) é o bootstrap do sistema legado (NERV, BrowserPool, KERNEL, missions). `src/copilot/` é um subsistema que main.js inicia via `agent/lifecycle/entry.js`. São dois mundos: legado (main.js) e novo (copilot/).

### Q8: O plugin system é funcional?
**R**: Tecnicamente sim. `PluginRegistry` implementa register, install, installAll, discover com dependency resolution e DI integration. Mas nunca é chamado — falta wiring no bootstrap.

### Q9: Existe health check de runtime?
**R**: Não. `sdk/health.js` verifica auth/connectivity do SDK, mas não há health check da aplicação (uptime, memory, circuit breakers, dependencies).

### Q10: Quantos módulos podem ser importados por todos?
**R**: `core/` (L0) pode ser importado por qualquer layer. `events/` (L0) também. Todos os outros têm restrições de layer (mas não enforcement).

### Q11: O ciclo config↔observability é real?
**R**: Sim. `config/*.js` importa `log` de `#copilot/observability`. `observability/bootstrap.js` importa configurações de `#copilot/config`. É um ciclo real que funciona porque Node ESM resolve circular imports em certos patterns, mas é fragil.

### Q12: bridgeEmitter já existe e funciona?
**R**: Sim. `core/event-bus.js` exporta `bridgeEmitter()` desde a PARTE-22. Está em uso em `always-alive.js` (7 events) e `hub.js` (5 events). Os outros 6 emitters não o utilizam. É o mecanismo certo — só falta expandir.

---

## 10. Resumo de Métricas Cross-Cutting

| Métrica | Valor |
|---------|-------|
| Módulos prod | 20 |
| Arquivos prod | 320 |
| LoC prod | ~52.557 |
| Spec files (total) | ~396 |
| Testes passando | ~21 (~5%) |
| DI tokens definidos | 41 |
| DI tokens registrados | 12 (29%) |
| DI tokens resolvidos | 1 (2.4%) |
| Singletons `let=null` | 25 |
| EventBus subscribers cross-module | 0 |
| bridgeEmitter connections | 2/8 emitters, 12/35+ events |
| Fontes de event strings | 4 paralelas |
| Services facades | 4 (anêmico) |
| Ciclos de dependência | 1 real (config↔observability) |
| Módulos órfãos | 3 (plugins, types, logs) |
| Health endpoint | inexistente |
| Rate limiter centralizado | inexistente |
| AsyncLocalStorage/context | inexistente em copilot/ |
| Feature flags runtime genérico | inexistente |
| Shutdown handlers registrados | 3 (de ~8 necessários) |
| God files >350 LoC | 24 |
| Circuit breakers | 6 instâncias em 14 arquivos |
| Try/catch blocks | 368 |
