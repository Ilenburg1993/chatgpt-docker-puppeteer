# 12 — Auditoria Arquitetural Profunda: `src/copilot/`

**Data**: 2026-03-21
**Escopo**: Todo `src/copilot/` — 408 arquivos JS, ~62.000 linhas, 21 módulos
**Referência**: [04-ARQUITETURA-ATUAL.md](./04-ARQUITETURA-ATUAL.md),
[05-ARQUITETURA-IDEAL.md](./05-ARQUITETURA-IDEAL.md),
[10-AGENT-SITUACAO-ATUAL.md](./10-AGENT-SITUACAO-ATUAL.md)

---

## 1. Inventário Quantitativo

| Módulo | Arquivos | Linhas | Camada | Responsabilidade |
|--------|----------|--------|--------|-----------------|
| `agent/` | 61 | 8.620 | L5 | Agente always-alive, dialog, lifecycle |
| `sdk/` | 41 | 8.096 | L1 | Wrapper @github/copilot-sdk |
| `terminal/` | 47 | 7.111 | L6 | REPL interativo, comandos, dialog |
| `tools/` | 32 | 6.928 | L3 | Custom Tools para o SDK |
| `observability/` | 32 | 5.757 | Cross | Logs, métricas, OTEL, error tracking |
| `hooks/` | 24 | 4.456 | L3 | Permissões, interceptors, presets |
| `core/` | 20 | 3.146 | L0 | Erros, retry, DI, EventBus, schemas |
| `server/` | 31 | 3.223 | L6 | Express HTTP + Socket.IO |
| `events/` | 20 | 2.299 | L0 | Constantes de eventos, schemas, middleware |
| `config/` | 23 | 2.349 | L2 | Env, system prompt, session/client config |
| `conversation-hub/` | 12 | 2.217 | L4 | Hub multi-sessão, store SQLite |
| `bridges/` | 13 | 2.171 | L2 | Git, GitHub CLI, MCP, NERV |
| `api/` | 10 | 1.937 | L6 | Express route handlers (legacy) |
| `channel/` | 8 | 1.437 | L4 | LLM-A ↔ LLM-B communication |
| `audit/` | 9 | 906 | Cross | Pipeline de auditoria, ring buffer |
| `infra/` | 10 | 790 | L0 | Queue, storage, lockfile, SSE |
| `services/` | 6 | 547 | L4 | Fachadas de alto nível |
| `db/` | 3 | 437 | L0 | SQLite + migrations |
| `plugins/` | 3 | 268 | L4 | Plugin registry (embrionário) |
| `types/` | 1 | 30 | L0 | Barrel de tipos |
| **Total** | **408** | **~62k** | | |

### Concentração de código

Os 4 maiores módulos (`agent`, `sdk`, `terminal`, `tools`) representam **~50%** do código total.
`agent/` sozinho é o maior módulo (14% do codebase), o que é desproporcional para uma camada
que deveria ser orquestração.

---

## 2. Mapa Real de Camadas (L0-L6)

```
L6 — Apresentação
├── server/          (3.223L)  Express HTTP + Socket.IO
├── terminal/        (7.111L)  REPL + commands + dialog engine
└── api/             (1.937L)  Express handlers (LEGACY — duplica server/)

L5 — Agente
└── agent/           (8.620L)  AlwaysAliveAgent + dialog + lifecycle + session + infra

L4 — Orquestração
├── conversation-hub/ (2.217L) Multi-sessão, store, broadcast
├── channel/          (1.437L) LLM-A ↔ LLM-B bridge
├── services/         (547L)   Fachadas de alto nível
└── plugins/          (268L)   Plugin registry

L3 — Hooks + Tools
├── hooks/            (4.456L) Permissões, interceptors, presets
└── tools/            (6.928L) Custom Tools (14 categorias)

L2 — Config + Bridges
├── config/           (2.349L) Env, system prompt, builders
└── bridges/          (2.171L) Git, GitHub, MCP, NERV

L1 — SDK Wrapper
└── sdk/              (8.096L) Wrapper tipado do @github/copilot-sdk

L0 — Core
├── core/             (3.146L) Erros, retry, DI, EventBus
├── events/           (2.299L) Constantes de eventos
├── infra/            (790L)   Queue, storage, lockfile
├── db/               (437L)   SQLite
└── types/            (30L)    Tipos

Cross-cutting
├── observability/    (5.757L) Logs, métricas, OTEL
└── audit/            (906L)   Pipeline de auditoria
```

---

## 3. Problemas Arquiteturais Identificados

### 3.1 🔴 Duplicação de Responsabilidades — "Two of Everything"

O codebase tem **7 pares de conceitos duplicados ou sobrepostos**:

| # | Conceito | Módulo A | Módulo B | Diagnóstico |
|---|----------|----------|----------|-------------|
| D1 | Error handling | `core/error-handlers.js` (classificação, retry, toError) | `hooks/error-handler.js` (onErrorOccurred SDK) | **Complementar**, mas confuso. São camadas diferentes (L0 vs L3) mas o nome sugere duplicação. Faltam cross-references. |
| D2 | Error tracking | `observability/error-tracker.js` (ring buffer + stats) | `observability/error-alerting.js` (threshold alertas) | **Complementar**: tracker coleta, alerting consome. Mas `bus-actions/error-alerter.js` é um TERCEIRO ponto de tratamento de erro. 3 módulos para resolver 1 problema. |
| D3 | Session config | `sdk/config.js` (defaults, merge de SessionConfig) | `config/session-config.js` (SessionConfigBuilder) | **Sobreposição real**. Ambos constroem SessionConfig com defaults. `sdk/config.js` é legacy; `config/session-config.js` (Faixa C) é o novo builder. sdk/config.js deveria ser deprecado. |
| D4 | Session lifecycle | `sdk/session/lifecycle.js` (create/resume/delete puro) | `agent/session/initializer.js` (create com wiring de hooks/tools) | **Complementar**, mas a cadeia é longa: agent→initializer→sdk/lifecycle→@github/copilot-sdk. Um nível intermediário desnecessário? |
| D5 | Event handlers | `agent/session/event-handlers/` (12 arquivos, ~700L) | `observability/collectors/` (6 arquivos, ~500L) | **Duplicação operacional**: ambos escutam os mesmos eventos SDK da sessão. Agents reagem (dialog, reconnect), obs. coleta (métricas, logs). Mesma fonte de dados duplicada em 2 registrations. |
| D6 | Infra | `agent/infra/` (8 files: queue, executor, perms, webhook) | `infra/` (root: queue, storage, lockfile, SSE) | **Nome confuso**: `agent/infra/` é lógica do agente (task-executor, message-queue), `infra/` é infraestrutura genérica (file I/O, SSE). Mesma pasta, significados diferentes. |
| D7 | API routes | `api/express/` (10 files, 1937L) | `server/routes/` + `server/routes/copilot-api/` | **Duplicação funcional real**. Ambos expõem endpoints HTTP Express para o mesmo agente. `api/` parece ser versão anterior, `server/` a versão atual com middleware e auth. |

### 3.2 🔴 `agent/` é Desproporcionalmente Grande

O módulo `agent/` (8.620L, 61 arquivos) contém responsabilidades que deveriam estar em outras camadas:

| Responsabilidade no agent/ | Deveria estar em | Razão |
|---------------------------|------------------|-------|
| `agent/infra/webhook-manager.js` | `infra/` ou `bridges/` | Webhooks são infraestrutura, não agente |
| `agent/infra/tools-bootstrap.js` | `tools/` | Bootstrap de tools pertence à camada de tools |
| `agent/infra/permission-controller.js` | `hooks/` | Permission switching é concern de hooks |
| `agent/session/event-handlers/` (12 files) | `events/handlers/` | Event handling é cross-cutting, não agente |
| `agent/config.js` | `config/` | Config do agente deveria ser parte de config geral |
| `agent/infra/status-snapshot.js` | `observability/` | Snapshots de status são observability |
| `agent/infra/handoff-manager.js` | `orchestrator/` ou `plugins/` | Handoff é orquestração, não infra do agente |

**Impacto**: O agent/ absorve funcionalidade como um god module. Novos features são adicionados nele
por conveniência (proximidade com AgentContext), não por design.

### 3.3 🟠 Cadeia de Delegação Excessiva

Para enviar uma mensagem, a cadeia é:

```
terminal/dialog/engine.js
  → agent/messaging/agent-messaging.js
    → agent/queue-processor.js
      → agent/infra/task-executor.js
        → agent/dialog/turn-executor.js
          → sdk/session/lifecycle.js (sendAndWait)
            → @github/copilot-sdk (session.send)
```

**7 níveis de indireção** entre o input do usuário e a chamada SDK. Cada nível adiciona pouco
valor individual. O valor real está concentrado em:
- Enfileiramento (queue-processor)
- Streaming + OTEL (task-executor/turn-executor)
- A chamada SDK (sendAndWait)

Os outros 4 níveis são passthrough.

### 3.4 🟠 `sdk/` vs `agent/` — Fronteira Nebulosa

O `sdk/` (L1) deveria ser abstração pura sobre `@github/copilot-sdk`. Mas:

- `sdk/session/client.js` (386L) mantém um **session registry** (`_sessions` Map) com estado
  mutable. Isso é orquestração (L4/L5), não wrapping (L1).
- `sdk/agent/agents.js` tem lógica de custom agents — pertence a config/ ou agent/.
- `sdk/rpc/` (4 files, ~800L) tem wrappers RPC que são usados por tools/ via
  `experimental-rpc-tools.js`. A camada 1 (sdk) está servindo diretamente a camada 3 (tools),
  devia haver um intermediário.

**Consequência**: `sdk/` tem 8.096L — quase tão grande quanto `agent/` (8.620L). Para um wrapper
module, isso é excessivo.

### 3.5 🟠 `observability/` é Over-engineered

5.757L e 32 arquivos para observability incluem:

- Logger → poderia ser 1 arquivo com DI
- EventCollector → útil mas com 500+ linhas
- MetricsStore → histograma custom em vez de usar OpenTelemetry nativo
- ErrorTracker → ring buffer custom
- ErrorAlerting → threshold + alertas
- OTEL → wrapper custom
- ToolStats → métricas por ferramenta
- EventCatalog → catálogo de eventos com dead-letter queue
- AgentEventObserver → bridge agent→observer
- EventBusObservers → 6+ bus actions

**3 subsistemas paralelos** para o mesmo problema (coletar e reagir a eventos):
1. `agent/session/event-handlers/` — reagem operacionalmente
2. `observability/collectors/` — coletam métricas
3. `observability/bus-actions/` — reagem via EventBus

### 3.6 🟡 `events/` — Módulo Inflado com Pouco Valor Operacional

2.299L e 20 arquivos para definir constantes de eventos e middleware:

- 8 arquivos de constantes (`agent-events.js`, `emitter-events.js`, `hook-events.js`, etc.)
- 5 arquivos de middleware (correlation, rate-limiter, schema-validator, timestamp)
- 3 arquivos de schemas (registry, builtin-schemas)
- Barrel + factories

O middleware de eventos (correlation, timestamp) é smart mas raramente usado em produção. O schema
validator é defensive programming excessivo para eventos internos.

### 3.7 🟡 `services/` — Camada sem Propósito Claro

547L e 6 arquivos. `services/index.js` re-exporta de `#copilot/agent`, `#copilot/conversation-hub`
e `#copilot/channel`. É basicamente um barrel extra com 4 wrappers finos:

- `SessionService` — facade sobre sdk/session + hooks → usado por 2 routes
- `ConversationService` — facade sobre conversation-hub → usado por 1 route
- `ToolService` — facade sobre tools → usado por 1 route
- `AuditService` — facade sobre audit → usado por 1 route

**547L de indireção** com baixo valor. Routes poderiam importar diretamente dos módulos source.

### 3.8 🟡 `api/` vs `server/` — Duplicação Funcional

`api/express/` (10 files, 1937L) e `server/` (31 files, 3223L) ambos proveem HTTP endpoints:

- `api/express/agent.js` vs `server/routes/agent.js`
- `api/express/sessions.js` vs `server/routes/sessions.js`
- `api/express/hooks.js` vs `server/routes/config.js`

`api/` parece ser uma versão anterior que não foi removida quando `server/` foi criado.

---

## 4. Violações de Camada Detectadas

### 4.1 Layer Violations (import direction)

| Violação | De | Para | Tipo |
|---------|-----|------|------|
| V1 | `config/session-config.js` | `@github/copilot-sdk` (direto) | L2→L0 bypass L1. Deveria importar de `#copilot/sdk` |
| V2 | `sdk/session/lifecycle.js` | `@github/copilot-sdk` (direto) | OK — sdk/ é o único que deve importar SDK nativo |
| V3 | `agent/session/boot-wiring.js` | `../../sdk/session/client-events.js` (path relativo) | L5→L1 via path relativo em vez de alias `#copilot/sdk` |
| V4 | `config/system-prompt/*.js` | `#copilot/sdk` | L2→L1 OK (acesso a constantes SDK) |

### 4.2 Import Pattern Analysis

```
agent/ importa de:
  - #copilot/sdk (19 refs) .............. OK (L5→L1)
  - #copilot/config (7 refs) ............ OK (L5→L2)
  - #copilot/core (17 refs) ............. OK (L5→L0)
  - #copilot/hooks (3 refs) ............. OK (L5→L3)
  - #copilot/observability (20+ refs) ... Cross-cutting (aceito)
  - ../../sdk/ (1 ref) .................. ⚠️ Use alias instead

sdk/ importa de:
  - @github/copilot-sdk (6 files) ....... OK (L1→L0)
  - ../../core/ (2 refs) ................ OK (L1→L0 core)
  - Nada de hooks/ ou agent/ ............ ✅ Clean
  - ./agent/agents.js (re-export) ....... ⚠️ sdk/agent/ é misplaced
```

---

## 5. DI Container — Estado Atual

### 5.1 Tokens Registrados

| Módulo | Tokens | Descrição |
|--------|--------|-----------|
| `core/` | SHUTDOWN_LOGGER, DB_LOGGER, EVENT_BUS | Infra base |
| `sdk/` | SDK_LOGGER, TOOLS_BUILDER | Logger e factory |
| `hooks/` | HOOKS_LOGGER | Logger |
| `audit/` | AUDIT_LOGGER, AUDIT_BUS | Logger e bus |
| `agent/` | ALWAYS_ALIVE_AGENT | Agent singleton |
| `bridges/` | BRIDGE_AGENT, FALLBACK_AGENT, PERMISSION_AGENT, NERV_BRIDGE_AGENT | 4 refs ao mesmo tipo |
| `conversation-hub/` | HUB, SESSION_RPC, CONVERSATION_STORE | Hub central |
| `services/` | (vazio — tokens especulativos removidos) | — |

**Observações**:
- `bridges/di-tokens.js` declara 4 tokens que são **todos** do tipo `AlwaysAliveAgent`. Isso sugere
  que bridges não deveria ter referência direta ao agent — quebra o princípio de inversão.
- 11 tokens ao todo. Para 408 arquivos, a DI é subutilizada. A maioria dos módulos usa import
  direto + singletons mutáveis em vez de DI.

---

## 6. Error Handling — Análise Transversal

O codebase tem **5 camadas** de error handling que se sobrepõem:

```
Camada 1: core/errors.js
  └── Hierarquia de erros: CopilotError, SessionError, BridgeError, ToolError, ConfigError

Camada 2: core/error-handlers.js
  └── toError(), logSwallowed(), wrapAsync(), isFatalError(), isTransientError()

Camada 3: hooks/error-handler.js
  └── createErrorHandler(), createCircuitBreakerHandler() — SDK onErrorOccurred

Camada 4: observability/error-tracker.js
  └── Ring buffer + stats + global handlers (uncaughtException/unhandledRejection)

Camada 5: observability/error-alerting.js + bus-actions/error-alerter.js
  └── Threshold + alertas + NERV + webhook
```

**Fluxo ideal**: Erro ocorre → Camada 1 tipifica → Camada 2 classifica → Camada 3 decide retry/skip
→ Camada 4 registra → Camada 5 alerta.

**Realidade**: Cada módulo escolhe ad-hoc quais camadas usar. `agent/` usa C1+C2 e ignora C3-C5
em muitos locais. Hooks usa C3. Terminal usa `try/catch` raw.

---

## 7. Event System — 3 Subsistemas Paralelos

### 7.1 EventBus (core/event-bus.js)
- Bus global com `on/off/emit` por string
- Bridge via `bridgeEmitter()` de agent→bus
- ~80 eventos bridgeados do agent
- Subscribers: observability bus-actions, terminal state

### 7.2 SDK Session Events (via session.on)
- 55+ event types do @github/copilot-sdk
- Registered em `agent/session/event-handlers/` (12 handlers)
- E TAMBÉM em `observability/collectors/` (6 collectors)
- **Duplicação de registration**: mesmo evento escutado por 2 handlers independentes

### 7.3 HookBus (hooks/bus.js)
- Bus separado para hooks (`emitHook(eventName, ...)`)
- Bridge para EventBus em `agent/lifecycle/entry.js`
- Usado por audit pipeline

**Problema**: 3 buses (EventBus, SDK events, HookBus), 3 sets de handlers, com bridges manuais
entre eles. Um evento pode fluir: SDK→handler→emit EventBus→bus-action→emit HookBus→audit.

---

## 8. Pontos Positivos da Arquitetura Atual

1. **Barrel discipline**: Cada módulo tem `index.js` e aliases `#copilot/*`
2. **JSDoc robusto**: Boa cobertura JSDoc com @param/@returns/@throws
3. **DI container**: Existe e funciona, mesmo subutilizado
4. **Presets de hooks**: Composabilidade real (audit, production, safe, minimal)
5. **System prompt modular**: Faixa I implementou 10 seções composáveis
6. **SessionConfigBuilder**: Builder pattern clean para SessionConfig
7. **Timer registry**: Gerenciamento centralizado de timers (cancelAll no shutdown)
8. **Security headers**: Middleware HTTP com headers de segurança

---

## 9. Métricas de Saúde

| Métrica | Valor Atual | Ideal |
|---------|-------------|-------|
| Total de arquivos | 408 | ~200 (após consolidação) |
| Total de linhas | ~62k | ~40k (após remoção dead code + consolidação) |
| God modules (>600L) | 3 (always-alive, sdk/index, loop-manager) | 0 |
| Módulos >5000L | 4 (agent, sdk, terminal, tools) | 2 (terminal, tools — UI-heavy) |
| Duplicação funcional | 7 pares identificados | 0 |
| Layer violations | 2 | 0 |
| DI tokens vs singletons | 11 vs ~20 | 25+ vs 0 |
| Buses de eventos | 3 | 1 (unificado) |
| Níveis de indireção (send msg) | 7 | 4 |
| Módulos sem consumer | ~2 (api/, services/) | 0 |

---

## 10. Resumo Executivo

O `src/copilot/` é um sistema funcional e bem documentado, mas sofre de **crescimento orgânico
não-governado**. A cada feature nova (hooks, tools, agent dialog, observability), um novo módulo
foi criado sem refatorar o existente, resultando em:

1. **Duplicação de conceitos** (7 pares identificados)
2. **God module** `agent/` que absorve tudo por conveniência
3. **3 subsistemas de eventos paralelos** com bridges manuais
4. **Cadeia de delegação excessiva** (7 níveis para enviar mensagem)
5. **`sdk/` com estado interno** que deveria estar em L4-L5
6. **`api/` obsoleto** que duplica `server/`
7. **`services/` e `plugins/`** quase vazios, sem propósito claro

A base é sólida (DI, EventBus, barrel discipline, JSDoc), mas precisa de consolidação
arquitetural antes de adicionar mais features.
