# SITUAÇÃO ARQUITETURAL ATUAL — `src/copilot`

> **Documento**: PARTE-24B-SITUACAO-ATUAL.md
> **Versão**: 1.0
> **Data**: 2026-04-12
> **Escopo**: Análise profunda e exaustiva da situação arquitetural atual de `src/copilot/`
> **Pré-requisito**: PARTE-24A (PRÉ-AUDITORIA)

---

## 1. Visão Geral do Sistema

`src/copilot/` é um subsistema de **57.841 LOC** distribuídas em **345 arquivos** e **18 módulos**. É um sistema de orquestração de agentes LLM com automação de browser, construído sobre o `@github/copilot-sdk`.

### 1.1. Propósito

O sistema permite que um agente LLM ("LLM-B", Always-Alive) opere de forma permanente, com:
- Sessão SDK persistente com o GitHub Copilot
- Terminal REPL interativo (LLM-B)
- API HTTP/SSE para controle e observabilidade
- Sistema de hooks extensível
- Integração com MCP (Model Context Protocol), Git e GitHub CLI
- ConversationHub para persistência SQLite de diálogos

### 1.2. Modos de Operação

1. **Via Server** (`src/server/main.js`): O server Express do workspace inicia o copilot como subsistema, importando dinamicamente os módulos.
2. **Via Terminal** (`npm run terminal:llm-b`): Boot standalone direto — **atualmente quebrado** (bootstrap.js faltando).

---

## 2. Mapa de Módulos — Função e Responsabilidades

### 2.1. `core/` — Foundation (L0) | 23 arquivos, 3.301 LOC

**Responsabilidade**: Primitivas fundamentais — DI container, EventBus, error handling, circuit breaker, cache, retry patterns, JSON utils, shutdown manager, mutex, timer registry.

**Arquivos**:

| Arquivo                     | LOC | Função                                                                             |
| --------------------------- | --- | ---------------------------------------------------------------------------------- |
| `abort-utils.js`            | 43  | `withTimeout()` via AbortController                                                |
| `cache.js`                  | 184 | Cache LRU in-memory com TTL e tamanho máximo                                       |
| `circuit-breaker.js`        | 136 | Padrão Closed→Open→Half-Open para serviços remotos                                 |
| `constants.js`              | 15  | Constantes puras (COPILOT_VERSION)                                                 |
| `create-emitter.js`         | 29  | Factory para EventEmitter tipados                                                  |
| `di-container.js`           | 49  | Singleton DI container global                                                      |
| `di-tokens.js`              | 344 | Tokens DI canônicos do sistema (EVENT_BUS, HUB, etc.)                              |
| `di.js`                     | 260 | Container DI minimalista: tokens tipados, singleton/transient/scoped, child scopes |
| `error-codes.js`            | 77  | Catálogo de códigos de erro                                                        |
| `error-handlers.js`         | 154 | `wrapAsync()`, `logSwallowed()`, `isFatalError()`, `isTransientError()`            |
| `errors.js`                 | 145 | Classes de erro semântico: `CopilotError`, `ValidationError`, `TimeoutError`, etc. |
| `event-bus.js`              | 336 | Event Bus cross-module com wildcards e middleware pipeline                         |
| `events.js`                 | 204 | **LEGADO** — constantes de evento migradas para `events/`. Mantido para compat     |
| `index.js`                  | 78  | Barrel exports                                                                     |
| `mutex.js`                  | 151 | Mutex baseado em promise-chain                                                     |
| `retry.js`                  | 86  | Retry com backoff exponencial + jitter                                             |
| `safe-json.js`              | 62  | `safeJsonParse()`, `safeJsonStringify()`, `parseJsonOrThrow()`                     |
| `schemas.js`                | 128 | Schemas Zod para validação HTTP/persistência                                       |
| `security/url-validator.js` | 202 | Anti-SSRF URL validation (SSOT canônico)                                           |
| `shared-state.js`           | 43  | Estado mínimo compartilhado cross-module                                           |
| `shutdown.js`               | 110 | Graceful shutdown manager com prioridades                                          |
| `structured-message.js`     | 351 | Protocolo StructuredMessage (tipos de resposta LLM)                                |
| `timer-registry.js`         | 114 | Registro de timers com cleanup automático via shutdown                             |

**Problemas identificados**:
- ⚠️ `core/events.js` (204 LOC) é **legado** — duplica constantes que já estão em `events/`. Deve ser removido
- ⚠️ `di-tokens.js` (344 LOC) é desproporcionalmente grande — define tokens de TODOS os módulos, acoplando core a conceitos de camadas superiores
- 🔴 `core → config` (bidirectional cycle) — `core/index.js` importa de `config/` via `di-container.js` e `schemas.js`

**Score**: 7/10

---

### 2.2. `events/` — Event System (L0) | 17 arquivos, 2.109 LOC

**Responsabilidade**: Constantes SSOT de eventos, schemas, middleware pipeline, registry.

**Arquivos**:

| Arquivo                              | LOC | Função                                                       |
| ------------------------------------ | --- | ------------------------------------------------------------ |
| `agent-events.js`                    | 363 | 81 constantes SSOT de eventos do agente (`AGENT_*`)          |
| `emitter-events.js`                  | 100 | 56 constantes de eventos internos EventEmitter (`EMITTER_*`) |
| `hook-events.js`                     | 25  | 6 constantes de eventos de hooks (`HOOK_*`)                  |
| `hub-events.js`                      | 71  | 8 constantes de eventos do hub (`HUB_*`)                     |
| `nerv-events.js`                     | 273 | 5 constantes NERV + mapeamento bidirecional EventBus↔NERV    |
| `service-events.js`                  | 18  | 5 constantes de eventos de serviços (`SERVICE_*`)            |
| `system-events.js`                   | 44  | 10 constantes de eventos de sistema (`SYSTEM_*`)             |
| `terminal-events.js`                 | 32  | 7 constantes de eventos do terminal (`TERMINAL_*`)           |
| `index.js`                           | 343 | Barrel SSOT com re-exports organizados + bridge helpers      |
| `middleware/correlation-enricher.js` | 56  | Middleware: correlationId + causationId                      |
| `middleware/index.js`                | 53  | Barrel + middleware pipeline setup                           |
| `middleware/rate-limiter.js`         | 57  | Middleware: rate limiting por event type                     |
| `middleware/schema-validator.js`     | 97  | Middleware: validação de schema (strict mode)                |
| `middleware/timestamp-enricher.js`   | 31  | Middleware: enriquecimento de timestamp                      |
| `schemas/builtin-schemas.js`         | 399 | 122 schemas SSOT (100% cobertura)                            |
| `schemas/index.js`                   | 21  | Barrel + inicialização de schemas                            |
| `schemas/registry.js`                | 126 | Schema registry com validação                                |

**Problemas identificados**:
- ⚠️ `nerv-events.js` (273 LOC) é desproporcionalmente grande — inclui lógica de mapeamento que deveria estar em `bridges/`
- 🔴 `events → observability` (ciclo) — `events/index.js` importa de `observability/` para dead letter tracking

**Score**: 8/10

---

### 2.3. `types/` — Type Definitions (L0) | 2 arquivos, 195 LOC

**Responsabilidade**: Typedefs centralizados e re-exports de DI primitivas.

| Arquivo     | LOC | Função                                                                  |
| ----------- | --- | ----------------------------------------------------------------------- |
| `events.js` | 143 | BaseEvent, EVENT_NAMES, EVENT_NAMESPACES                                |
| `index.js`  | 52  | Re-exports de `core/di-container`, `core/di`, `core/event-bus` + events |

**Problemas identificados**:
- ⚠️ `types/index.js` re-exporta implementações concretas de `core/` — deveria exportar apenas tipos
- ⚠️ Módulo sub-utilizado — apenas `events` e `channel` importam dele

**Score**: 6/10

---

### 2.4. `config/` — Configuration (L1) | 7 arquivos, 1.279 LOC

**Responsabilidade**: Variáveis de ambiente, system prompts, MCP servers, pinned files, custom agents.

| Arquivo             | LOC | Função                                                  |
| ------------------- | --- | ------------------------------------------------------- |
| `env.js`            | 201 | SSOT variáveis de ambiente                              |
| `system-prompt.js`  | 241 | Builders de system prompt                               |
| `custom-agents.js`  | 327 | Profiles de agentes customizados                        |
| `pinned-files.js`   | 282 | Loader + fs.watch de arquivos pinned                    |
| `mcp-servers.js`    | 147 | Configuração de servidores MCP                          |
| `session-config.js` | 36  | **Shim** — redireciona para `hooks/presets/profiles.js` |
| `index.js`          | 45  | Barrel                                                  |

**Problemas identificados**:
- 🔴 Ciclo bidirecional `config ↔ core` e `config ↔ observability`
- ⚠️ `config → sdk` (violação L1→L2) — `env.js` importa de `sdk/constants.js` para defaults de modelo
- ⚠️ `custom-agents.js` (327 LOC) contém lógica de domínio (tool selection, prompt building) que pertence a L3

**Score**: 6/10

---

### 2.5. `db/` — Database (L1) | 3 arquivos, 442 LOC

**Responsabilidade**: SQLite isolado para o módulo copilot.

| Arquivo         | LOC | Função                                          |
| --------------- | --- | ----------------------------------------------- |
| `sqlite.js`     | 235 | Singleton SQLite via better-sqlite3             |
| `migrations.js` | 196 | DDL migrations (conversations, turns, memories) |
| `index.js`      | 11  | Barrel                                          |

**Problemas identificados**:
- 🔴 `db/sqlite.js` importa `#core/config` (dependência EXTERNA ao src/copilot) — quebra autonomia
- ⚠️ Sem connection pooling — singleton global

**Score**: 5/10

---

### 2.6. `audit/` — Audit Pipeline (L1) | 8 arquivos, 884 LOC

**Responsabilidade**: Ring buffer em memória, JSONL persistence, audit logging de tools e permissões.

| Arquivo                  | LOC | Função                                  |
| ------------------------ | --- | --------------------------------------- |
| `ring-buffer.js`         | 81  | Buffer circular O(1) push               |
| `jsonl-writer.js`        | 81  | Escrita assíncrona JSONL com batch      |
| `pipeline-audit-log.js`  | 332 | General audit log (ring buffer + JSONL) |
| `pipeline-permission.js` | 174 | Audit de decisões de permissão          |
| `pipeline-sdk-buffer.js` | 82  | Ring buffer de tool calls SDK           |
| `pipeline.js`            | 32  | Barrel do pipeline                      |
| `logger.js`              | 67  | Proxy local de logger                   |
| `index.js`               | 35  | Barrel                                  |

**Problemas identificados**:
- ⚠️ `audit → sdk` (violação L1→L2) — `pipeline-audit-log.js` importa tipos de `sdk/`
- ⚠️ `pipeline-audit-log.js` (332 LOC) contém tanto lógica de buffer quanto I/O — SRP violado

**Score**: 7/10

---

### 2.7. `observability/` — Monitoring & Logging (L1) | 31 arquivos, 5.645 LOC

**Responsabilidade**: Logger, métricas, error tracking, alerting, event collection, bus-actions, OpenTelemetry.

**Sub-módulos**:

| Sub-módulo     | Arquivos | LOC   | Função                                                   |
| -------------- | -------- | ----- | -------------------------------------------------------- |
| `bus-actions/` | 7        | 570   | Subscribers do EventBus: métricas, logs, health, alertas |
| `collectors/`  | 5        | 792   | Handlers de coleta por tipo de evento                    |
| `observers/`   | 5        | 998   | Observadores do agent EventEmitter                       |
| (raiz)         | 14       | 3.285 | Logger, métricas, error tracker, alerting, OTel          |

**Problemas identificados**:
- 🔴 7 dependências de saída — muito alto para L1
- 🔴 `observability → hooks` e `observability → sdk` (violações L1→L2)
- ⚠️ `metrics.js` (397 LOC) e `event-collector.js` (368 LOC) sem descrição — possíveis God Modules
- ⚠️ `event-bus-observers.js` (224 LOC) e `bus-actions/*.js` — provável duplicação de funcionalidade
- ⚠️ `bootstrap.js` injeta deps de obs em `core/` via setters — coupling implícito

**Score**: 5/10

---

### 2.8. `sdk/` — SDK Wrapper (L2) | 42 arquivos, 7.875 LOC

**Responsabilidade**: Abstração do `@github/copilot-sdk` — client, sessions, tools, RPC, models, feature flags, health checks.

**Sub-módulos**:

| Sub-módulo | Arquivos | LOC   | Função                                          |
| ---------- | -------- | ----- | ----------------------------------------------- |
| `models/`  | 5        | 1.092 | Multi-model selection pool                      |
| (raiz)     | 37       | 6.783 | Client, session, tools, RPC, configs, contracts |

**Destaques positivos**:
- ✅ Instabilidade 0.13 (muito estável) — muitos dependem, poucos deps de saída
- ✅ 39 testes dedicados — melhor ratio do sistema
- ✅ Bem organizado com barrels e tipagem

**Problemas identificados**:
- ⚠️ `types.js` (647 LOC) — enorme arquivo de re-exportação de tipos
- ⚠️ `index.js` (353 LOC) — barrel gigante com ~120 exports
- ⚠️ `experimental-rpc.js` (352 LOC) — "experimental" ainda em produção?
- ⚠️ Shims de compat: `url-validator.js` (14 LOC), `session-lifecycle.js` (14 LOC)

**Score**: 8/10

---

### 2.9. `bridges/` — External Integrations (L2) | 12 arquivos, 2.142 LOC

**Responsabilidade**: Integração com Git, GitHub CLI, MCP e NERV.

**Sub-módulos**:

| Sub-módulo | Arquivos | LOC   | Função                              |
| ---------- | -------- | ----- | ----------------------------------- |
| `gh/`      | 5        | 785   | GitHub CLI bridge (issues, PRs, CI) |
| (raiz)     | 7        | 1.357 | Git, MCP, NERV adapter, barrels     |

**Problemas identificados**:
- ⚠️ `nerv-event-bus-adapter.js` ainda referencia "nerv-bridge.js" em comentários
- ⚠️ `mcp-tool-bridge.js` (428 LOC) — maior arquivo, acumula registro, auto-reconnect, status, conversão

**Score**: 7/10

---

### 2.10. `channel/` — LLM-A ↔ LLM-B Communication (L2) | 7 arquivos, 1.416 LOC

**Responsabilidade**: Cliente de comunicação bidirecional entre LLM-A (GitHub Copilot) e LLM-B (terminal local).

| Arquivo                | LOC | Função                                 |
| ---------------------- | --- | -------------------------------------- |
| `client.js`            | 508 | LlmBridgeClient — God Module principal |
| `inject.js`            | 402 | Handler de injeção HTTP                |
| `sse-client.js`        | 144 | Cliente SSE com reconnect              |
| `client-dialog.js`     | 123 | Dialog mode extraído                   |
| `client-structured.js` | 99  | Protocolo chatStructured               |
| `client-history.js`    | 59  | Helpers de histórico                   |
| `index.js`             | 81  | Barrel                                 |

**Problemas identificados**:
- 🔴 `channel/index.js` tem imports estranhos: `import * as _reexport from '#copilot/channel/client'` — barrel suspeito
- ⚠️ `client.js` (508 LOC) é God Module — acumula dialog, bridge, config, state
- ⚠️ `inject.js` (402 LOC) sem descrição — handler monolítico

**Score**: 5/10

---

### 2.11. `hooks/` — SDK Hook System (L2) | 21 arquivos, 3.788 LOC

**Responsabilidade**: Sistema de hooks para os 6 slots do SDK: permission, tool intercept, prompt transform, error handling, user input, session lifecycle.

**Sub-módulos**:

| Sub-módulo | Arquivos | LOC   | Função                                                        |
| ---------- | -------- | ----- | ------------------------------------------------------------- |
| `presets/` | 9        | 1.166 | Configurações pré-definidas (production, safe, minimal, etc.) |
| (raiz)     | 12       | 2.622 | Factory, bus, registry, types, handlers                       |

**Problemas identificados**:
- 🔴 `hooks → tools` (violação L2→L3) — hooks depende de tools para inspeção
- 🔴 `hooks ↔ observability` (ciclo bidirecional)
- ⚠️ `factory.js` (418 LOC) — maior arquivo, responsabilidade excessiva
- ⚠️ `types.js` (311 LOC) — typedefs gigante
- ⚠️ `presets/profiles.js` — movido de config mas conceitualmente ainda L1

**Score**: 6/10

---

### 2.12. `plugins/` — Plugin System (L2) | 2 arquivos, 257 LOC

**Responsabilidade**: Registry de plugins com descoberta e ativação automática.

**Problemas identificados**:
- ⚠️ 0 testes
- ⚠️ Módulo minimalista — quase não usado em produção
- ⚠️ Apenas `plugins → observability` como dependência

**Score**: 4/10

---

### 2.13. `agent/` — Agent Core (L3) | 57 arquivos, 8.274 LOC

**Responsabilidade**: AlwaysAliveAgent — singleton que orquestra sessão SDK, dialog loop, message queue, lifecycle, state, facades, webhooks.

**Sub-módulos**:

| Sub-módulo                | Arquivos | LOC   | Função                                                                                             |
| ------------------------- | -------- | ----- | -------------------------------------------------------------------------------------------------- |
| `dialog/`                 | 10       | 1.693 | Dialog loop: controller, backpressure, watchdog, model fallback                                    |
| `facades/`                | 3        | 193   | Facades thin: model config, session ops, webhook ops                                               |
| `infra/`                  | 9        | 1.113 | Message queue, handoff, permissions, task executor, tools bootstrap                                |
| `lifecycle/`              | 6        | 1.181 | Start/stop, session setup, reconnect, state I/O, entry point PM2                                   |
| `messaging/`              | 2        | 177   | Send/receive extraído                                                                              |
| `session/`                | 17       | 2.197 | Boot wiring, cleanup, event handlers (8), history sync, initializer, keepalive, rotation, snapshot |
| `session/event-handlers/` | 8        | 530   | Handlers por tipo de evento SDK                                                                    |
| `state/`                  | 2        | 84    | Estado e snapshot                                                                                  |
| (raiz)                    | 8        | 1.636 | always-alive.js (745 LOC!), config, context, queue-processor, types, index                         |

**Problemas identificados**:
- 🔴 `always-alive.js` (745 LOC) — **God Module**. Mesmo após extração em ~50 sub-módulos, ainda concentra demais
- ⚠️ 10 dependências de saída — depende de quase todo o sistema
- ⚠️ Baixa cobertura de testes (2 testes dedicados na pasta `agent/`, ~20 em nível raiz)
- ⚠️ `lifecycle/entry.js` (250 LOC) — entry point PM2 com lógica de boot duplicada

**Score**: 6/10

---

### 2.14. `conversation-hub/` — Persistent Conversations (L3) | 12 arquivos, 2.589 LOC

**Responsabilidade**: ConversationHub — persistência SQLite de diálogos, socket.io namespace, orquestração de mensagens.

| Arquivo              | LOC    | Função                                |
| -------------------- | ------ | ------------------------------------- |
| `hub.js`             | 328    | Singleton compositor                  |
| `store.js`           | 563    | ConversationStore — God Module SQLite |
| `orchestrator.js`    | 410    | Orquestração de mensagens             |
| `socket-ns.js`       | 444    | Socket.io namespace                   |
| `send-pipeline.js`   | 189    | Pipeline de envio                     |
| `store-*.js`         | 4×~120 | Funções extraídas do Store            |
| `call-strategies.js` | 117    | Estratégias de chamada LLM-B          |
| `events.js`          | 50     | Constantes de evento                  |
| `index.js`           | 15     | Barrel                                |

**Problemas identificados**:
- 🔴 `socket-ns.js` importa `#core/jwt_config` — dependência EXTERNA ao src/copilot
- ⚠️ `store.js` (563 LOC) ainda é God Module apesar de extrações
- ⚠️ `orchestrator.js` (410 LOC) sem descrição

**Score**: 5/10

---

### 2.15. `tools/` — Agent Custom Tools (L3) | 28 arquivos, 6.352 LOC

**Responsabilidade**: 60+ custom tools para o agente: file ops, git, shell, hub, hooks, introspection, session RPC, TODO, code quality.

**Sub-módulos**:

| Sub-módulo | Arquivos | LOC   | Função                                                                          |
| ---------- | -------- | ----- | ------------------------------------------------------------------------------- |
| `file/`    | 6        | 963   | File read/write/search tools                                                    |
| `git/`     | 1        | 274   | Git tools                                                                       |
| `shell/`   | 3        | 430   | Shell execution tools (com sandbox)                                             |
| `todo/`    | 7        | 865   | Todo list CRUD + store + schema                                                 |
| (raiz)     | 11       | 3.820 | Hub, hook, introspection, permission, session, code, web, task, factory, barrel |

**Problemas identificados**:
- ⚠️ `index.js` (113 LOC) mas barrel está vazio para export
- ⚠️ `introspection-tools.js` (409 LOC) — God Module de diagnóstico
- ⚠️ `hub-tools.js` (346 LOC) e `hook-tools.js` (344 LOC) — grandes

**Score**: 6/10

---

### 2.16. `services/` — Service Facades (L3) | 5 arquivos, 537 LOC

**Responsabilidade**: Facades de alto nível que compõem módulos L2 em operações de use-case.

| Arquivo                   | LOC | Função                                              |
| ------------------------- | --- | --------------------------------------------------- |
| `session-service.js`      | 210 | Operações de sessão SDK                             |
| `audit-service.js`        | 113 | Operações de auditoria                              |
| `conversation-service.js` | 89  | Operações de conversação                            |
| `tool-service.js`         | 88  | Operações de ferramentas                            |
| `index.js`                | 37  | Barrel com re-exports de conversation-hub e channel |

**Problemas identificados**:
- ⚠️ `index.js` re-exporta diretamente de `#copilot/conversation-hub` e `#copilot/channel` — rompe encapsulamento
- ⚠️ 9 dependências de saída vs 2 de entrada — instabilidade 0.82 (muito instável)
- 🔴 0 testes dedicados

**Score**: 4/10

---

### 2.17. `api/` — HTTP API (L4) | 21 arquivos, 3.348 LOC

**Responsabilidade**: API REST/SSE para controle do agente e sessões.

**Sub-módulos**:

| Sub-módulo | Arquivos | LOC   | Função                                     |
| ---------- | -------- | ----- | ------------------------------------------ |
| `bridge/`  | 5        | 808   | API Bridge do AlwaysAliveAgent             |
| `express/` | 12       | 2.238 | Rotas Express (agent, session, hooks, obs) |
| `sse/`     | 4        | 481   | SSE fanout, replay buffer                  |
| (raiz)     | 1        | 21    | Barrel                                     |

**Problemas identificados**:
- ⚠️ Dois routers paralelos (`bridge/` e `express/`) com sobreposição funcional
- ⚠️ `express/session-crud.js` (350 LOC) sem descrição
- ⚠️ `express/session-messaging.js` (296 LOC) — messaging via HTTP REST

**Score**: 6/10

---

### 2.18. `terminal/` — Terminal REPL (L4) | 47 arquivos, 7.753 LOC

**Responsabilidade**: Terminal interativo permanente LLM-B com REPL, comandos, handlers HTTP, dialog engine, SSE.

**Sub-módulos**:

| Sub-módulo  | Arquivos | LOC   | Função                                                                     |
| ----------- | -------- | ----- | -------------------------------------------------------------------------- |
| `commands/` | 23       | 2.479 | 23 comandos REPL (/help, /status, /gh, /git, etc.)                         |
| `dialog/`   | 5        | 664   | Engine de diálogo, persistência, output                                    |
| `handlers/` | 5        | 1.300 | Handlers HTTP do inject server                                             |
| (raiz)      | 14       | 3.310 | index, repl, server, state, route-table, agent-wiring, file-context, alias |

**Problemas identificados**:
- 🔴 **bootstrap.js FALTANDO** — npm script `terminal:llm-b` não funciona
- 🔴 13 dependências de saída — depende de praticamente todo o sistema
- ⚠️ `repl.js` (422 LOC), `server.js` (396 LOC), `state.js` (354 LOC), `file-context.js` (346 LOC) — sem descrição, possíveis God Modules
- ⚠️ `commands/gh.js` (384 LOC) — maior comando, acumula 7 subcomandos
- ⚠️ `commands/session.js` (300 LOC) — 10+ subcomandos

**Score**: 5/10

---

## 3. Problemas Sistêmicos

### 3.1. Ciclos de Dependência

```
CICLO 1: core ↔ config
  core/index.js → config/env.js (via di-container → wireLegacySetters)
  config/env.js → core/constants.js

CICLO 2: config ↔ observability
  config/env.js → observability/logger.js (via LOG_DIR default)
  observability/bootstrap.js → config/env.js

CICLO 3: events ↔ observability
  events/index.js → observability/event-catalog.js (dead letter tracking)
  observability/*.js → events/index.js (constantes SSOT)

CICLO 4: hooks ↔ observability
  hooks/factory.js → observability/otel.js (telemetry)
  observability/agent-event-observer.js → hooks/bus.js (hook bus)
```

### 3.2. Violações de Autonomia

| Módulo                          | Import Externo     | Impacto                            |
| ------------------------------- | ------------------ | ---------------------------------- |
| `conversation-hub/socket-ns.js` | `#core/jwt_config` | JWT config do server pai           |
| `db/sqlite.js`                  | `#core/config`     | Path do banco vem do config global |

### 3.3. God Modules (>400 LOC com responsabilidade mista)

| Arquivo                            | LOC | Problema                           |
| ---------------------------------- | --- | ---------------------------------- |
| `agent/always-alive.js`            | 745 | Orquestrador monolítico            |
| `sdk/types.js`                     | 647 | Re-export massivo                  |
| `conversation-hub/store.js`        | 563 | CRUD + search + sync               |
| `channel/client.js`                | 508 | Bridge + dialog + state            |
| `conversation-hub/socket-ns.js`    | 444 | Socket rooms + auth + broadcast    |
| `bridges/mcp-tool-bridge.js`       | 428 | Registry + reconnect + status      |
| `hooks/factory.js`                 | 418 | Factory de 6 hooks                 |
| `terminal/repl.js`                 | 422 | REPL + routing + display           |
| `conversation-hub/orchestrator.js` | 410 | Orquestração de mensagens          |
| `channel/inject.js`                | 402 | Handler HTTP monolítico            |
| `terminal/server.js`               | 396 | HTTP server + middleware + routing |
| `terminal/commands/gh.js`          | 384 | 7 subcomandos GitHub CLI           |

### 3.4. Arquivos Sem Descrição (JSDoc)

12 arquivos de >100 LOC sem JSDoc header:
- `agent/always-alive.js`, `agent/dialog/loop-manager.js`, `agent/dialog/turn-executor.js`
- `channel/client.js`, `channel/inject.js`
- `conversation-hub/orchestrator.js`, `conversation-hub/socket-ns.js`
- `observability/event-collector.js`, `observability/metrics.js`
- `terminal/repl.js`, `terminal/server.js`, `terminal/state.js`, `terminal/file-context.js`

### 3.5. Shims de Compatibilidade

5 shims de ≤14 LOC que apenas re-exportam:
- `agent/infra/url-validator.js` → `core/security/url-validator.js`
- `sdk/url-validator.js` → `core/security/url-validator.js`
- `sdk/session-lifecycle.js` → `sdk/sdk-session-wrapper.js`
- `hooks/session-lifecycle.js` → `hooks/session-hooks.js`
- `config/session-config.js` → `hooks/presets/profiles.js`

### 3.6. Barrels Problemáticos

| Barrel              | Problema                                                       |
| ------------------- | -------------------------------------------------------------- |
| `tools/index.js`    | 113 LOC mas não exporta API limpa — mistura registry e imports |
| `channel/index.js`  | Dynamic import com `* as _reexport`                            |
| `services/index.js` | Re-exporta de `conversation-hub` e `channel` diretamente       |
| `sdk/index.js`      | 353 LOC — ~120 exports, barrel massivo                         |

---

## 4. Fluxos de Dados Principais

### 4.1. Boot (via Server)

```
src/server/main.js
  ├→ import('#copilot/core')                    // DI container + EventBus
  ├→ import('#copilot/bridges/nerv-event-bus-adapter')  // NERV relay
  ├→ import('#copilot/events')                  // Schema registration
  ├→ import('#copilot/agent/always-alive')      // Agent singleton
  └→ import('#copilot/conversation-hub/hub')    // ConversationHub
```

### 4.2. Boot (via Terminal — QUEBRADO)

```
npm run terminal:llm-b
  └→ node src/copilot/terminal/bootstrap.js     ❌ FILE NOT FOUND
```

### 4.3. Dialog Turn Flow

```
User Input (REPL/HTTP inject)
  → terminal/dialog/engine.js → sendTurn()
  → agent/always-alive.js → sendMessage()
  → agent/messaging/agent-messaging.js
  → sdk/session.js → session.sendMessage()
  → @github/copilot-sdk (external)
  → SDK session events (streaming)
  → agent/session/event-handlers/*.js
  → EventBus.emit() → middleware pipeline
  → bus-actions (metrics, log, health)
  → terminal/dialog/turn-display.js (render)
```

### 4.4. Event Flow

```
Agent EventEmitter (.emit)
  → observability/agent-event-observer.js (bridge)
  → EventBus.emit()
  → middleware: correlationEnricher → timestampEnricher → schemaValidator → rateLimiter
  → subscribers: bus-actions/*, event-bus-observers.js
  → SSE fanout (api/sse/fanout.js)
```

---

## 5. Scoring Consolidado

| Módulo             | Coesão | Acoplamento | Tipagem | Testes | API | Errors | Docs | Security | **TOTAL** |
| ------------------ | ------ | ----------- | ------- | ------ | --- | ------ | ---- | -------- | --------- |
| `core`             | 7      | 5           | 8       | 7      | 7   | 8      | 7    | 8        | **7.0**   |
| `events`           | 9      | 6           | 9       | 4      | 9   | 8      | 8    | N/A      | **8.0**   |
| `types`            | 5      | 7           | 8       | 1      | 4   | N/A    | 5    | N/A      | **6.0**   |
| `config`           | 6      | 4           | 7       | 2      | 6   | 5      | 7    | 5        | **6.0**   |
| `db`               | 7      | 3           | 6       | 5      | 6   | 6      | 6    | 6        | **5.0**   |
| `audit`            | 7      | 6           | 7       | 2      | 7   | 7      | 7    | N/A      | **7.0**   |
| `observability`    | 5      | 3           | 6       | 5      | 5   | 6      | 4    | N/A      | **5.0**   |
| `sdk`              | 8      | 9           | 8       | 9      | 7   | 7      | 7    | 7        | **8.0**   |
| `bridges`          | 7      | 6           | 7       | 5      | 7   | 6      | 6    | 6        | **7.0**   |
| `channel`          | 5      | 5           | 5       | 4      | 3   | 5      | 3    | 5        | **5.0**   |
| `hooks`            | 6      | 4           | 7       | 2      | 6   | 7      | 6    | 7        | **6.0**   |
| `plugins`          | 6      | 8           | 5       | 1      | 5   | 4      | 4    | N/A      | **4.0**   |
| `agent`            | 5      | 3           | 6       | 4      | 5   | 6      | 4    | 5        | **6.0**   |
| `conversation-hub` | 5      | 4           | 6       | 5      | 5   | 5      | 4    | 4        | **5.0**   |
| `tools`            | 7      | 5           | 6       | 5      | 4   | 6      | 5    | 7        | **6.0**   |
| `services`         | 6      | 2           | 5       | 1      | 3   | 5      | 4    | N/A      | **4.0**   |
| `api`              | 6      | 6           | 6       | 3      | 5   | 6      | 5    | 6        | **6.0**   |
| `terminal`         | 5      | 2           | 5       | 3      | 4   | 5      | 3    | 5        | **5.0**   |

**Score Global**: **5.9/10** (mediana ponderada por LOC)

---

## 6. Resumo de Achados

### Críticos (bloqueantes) 🔴
1. **bootstrap.js faltando** — terminal não inicia standalone
2. **4 ciclos bidirecionais** — core↔config, config↔observability, events↔observability, hooks↔observability
3. **2 dependências externas** — `#core/jwt_config`, `#core/config` — quebram autonomia

### Altos (impacto estrutural) 🟠
4. **7 violações de camada** — L0→L1, L1→L2, L2→L3
5. **12 God Modules** (>400 LOC com responsabilidade mista)
6. **0 testes** em services/ e plugins/
7. **core/events.js legado** — 204 LOC de duplicação

### Médios (melhorias de qualidade) 🟡
8. **13 arquivos sem JSDoc** header (>100 LOC)
9. **5 shims de compatibilidade** sem prazo de remoção
10. **4 barrels problemáticos** (tools, channel, services, sdk)
11. **metrics.js e event-collector.js** sem descrição — desconhecidos

### Baixos (cleanup) 🟢
12. **nerv-events.js** com lógica de mapeamento que pertence a bridges
13. **.github/hooks/state/** dentro de src/copilot — runtime data em source tree
14. **Comentários referenciando nerv-bridge.js** (removido em L36)

---

## 7. Changelog

| Versão | Data       | Mudanças                      |
| ------ | ---------- | ----------------------------- |
| 1.0    | 2026-04-12 | Análise completa — 18 módulos |
