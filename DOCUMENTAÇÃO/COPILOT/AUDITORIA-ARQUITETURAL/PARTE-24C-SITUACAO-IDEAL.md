# SITUAÇÃO ARQUITETURAL IDEAL — `src/copilot`

> **Documento**: PARTE-24C-SITUACAO-IDEAL.md **Versão**: 1.0 **Data**: 2026-04-12 **Escopo**:
> Arquitetura-alvo ideal para `src/copilot/` — sistema 100% autônomo **Pré-requisito**: PARTE-24A
> (PRÉ-AUDITORIA) + PARTE-24B (SITUAÇÃO ATUAL)

---

## 1. Princípios Fundamentais

A arquitetura ideal se baseia em 6 princípios não-negociáveis:

1. **Autonomia Total**: `src/copilot/` deve funcionar como pacote independente — zero imports de
   `#core/*`, `#infra/*`, `#driver/*`, `#server/*`
2. **Aciclic Layer Model**: Zero ciclos entre qualquer par de módulos. Dependências fluem
   **unidirecionalmente**, de camadas superiores para inferiores
3. **Contract-First**: Toda comunicação cross-module via interfaces/contracts tipados, nunca via
   implementações concretas
4. **Plug & Play**: Qualquer módulo pode ser substituído isoladamente sem impacto nos demais
5. **Observable by Default**: Minden módulo emite eventos no EventBus — observabilidade é emergente,
   não injetada
6. **Fail Safe**: Graceful degradation em todos os níveis — nenhuma falha isolada propaga cascata

---

## 2. Modelo de Camadas Ideal (6 camadas)

```
┌──────────────────────────────────────────────────────────────────┐
│  L5 — APPLICATION          terminal/ api/                        │
│  Entry points, REPL, HTTP routes, SSE, wiring                    │
├──────────────────────────────────────────────────────────────────┤
│  L4 — ORCHESTRATION        agent/ conversation-hub/ services/    │
│  Business logic, dialog loops, session orchestration             │
├──────────────────────────────────────────────────────────────────┤
│  L3 — CAPABILITY           tools/ bridges/ channel/ plugins/     │
│  External integrations, custom tools, communication channels     │
├──────────────────────────────────────────────────────────────────┤
│  L2 — FRAMEWORK            sdk/ hooks/ observability/ audit/     │
│  SDK abstraction, hook system, monitoring, audit trail           │
├──────────────────────────────────────────────────────────────────┤
│  L1 — INFRASTRUCTURE       config/ db/                           │
│  Configuration, persistence, environment                         │
├──────────────────────────────────────────────────────────────────┤
│  L0 — KERNEL               core/ events/ types/                  │
│  Primitives, DI, EventBus, types, error classes, schemas         │
└──────────────────────────────────────────────────────────────────┘

REGRA: Lx só pode importar de Ly onde y < x. NUNCA o contrário.
```

### 2.1. Mudanças em relação ao modelo atual

| Módulo              | Atual   | Ideal  | Justificativa                                                  |
| ------------------- | ------- | ------ | -------------------------------------------------------------- |
| `core/`             | L0      | L0     | Sem mudança                                                    |
| `events/`           | L0      | L0     | Sem mudança                                                    |
| `types/`            | L0      | L0     | Sem mudança — mas conteúdo redesenhado                         |
| `config/`           | L1      | L1     | Sem mudança — mas ciclos eliminados                            |
| `db/`               | L1      | L1     | Sem mudança — dependência externa eliminada                    |
| `sdk/`              | L2      | L2     | Sem mudança                                                    |
| `hooks/`            | L2      | L2     | Sem mudança — mas deps de L3 removidas                         |
| `observability/`    | L1 → L2 | **L2** | Sobe de camada. Obs depende de hooks e sdk (inaceitável em L1) |
| `audit/`            | L1 → L2 | **L2** | Sobe para L2. Não depende de sdk diretamente                   |
| `bridges/`          | L2      | L3     | Sobe: bridges usam tools e sdk, são capability                 |
| `channel/`          | L2      | L3     | Sobe: channel é capability de comunicação                      |
| `plugins/`          | L2      | L3     | Sobe: plugins usam tools e hooks                               |
| `agent/`            | L3      | **L4** | Sobe: agent é orchestrator, não capability                     |
| `conversation-hub/` | L3      | **L4** | Sobe: hub depende de db + channel + agent                      |
| `services/`         | L3      | **L4** | Sobe: facades de orquestração                                  |
| `tools/`            | L3      | L3     | Sem mudança                                                    |
| `api/`              | L4      | **L5** | Sobe: entry point HTTP                                         |
| `terminal/`         | L4      | **L5** | Sobe: entry point REPL                                         |

---

## 3. Eliminação de Ciclos — Estratégias

### 3.1. Ciclo `core ↔ config` → **Inversão de Dependência**

**Problema**: `core/di-container.js` chama `wireLegacySetters()` que importa `config/env.js`.

**Solução**: `core/` define **interface** `IConfigProvider`. `config/` implementa e registra via DI.
`core/` consome via token DI, sem import direto.

```
ANTES:  core/di-container.js --import--> config/env.js
IDEAL:  core/ define IConfigProvider (interface)
        config/ implements & registers → DI_TOKEN.CONFIG_PROVIDER
        core/ resolves DI_TOKEN.CONFIG_PROVIDER (zero import)
```

### 3.2. Ciclo `config ↔ observability` → **Event-Driven**

**Problema**: `config/env.js` importa `observability/logger.js` e vice-versa.

**Solução**: Config emite `config:loaded` no EventBus. Observability subscreve. Logger é injetado
via DI, não importado.

### 3.3. Ciclo `events ↔ observability` → **Extrair dead-letter para `events/`**

**Problema**: `events/index.js` importa `observability/event-catalog.js` para dead letter tracking.

**Solução**: Dead-letter tracking pertence a `events/` (é funcionalidade do bus). Mover
`trackUnregistered()` para `events/dead-letter.js`.

### 3.4. Ciclo `hooks ↔ observability` → **DI + Event Bus**

**Problema**: `hooks/factory.js` importa OTel de `observability/`. `observability/` importa
`hooks/bus.js`.

**Solução**: OTel facade é contrato em `core/` injetado via DI. Hook bus é consumido via EventBus,
não import direto.

---

## 4. Autonomia Total — Eliminação de Dependências Externas

### 4.1. `#core/jwt_config` → Config interno

```
ANTES:  conversation-hub/socket-ns.js --import--> #core/jwt_config
IDEAL:  config/auth.js define JWT_CONFIG com defaults
        socket-ns.js importa de #copilot/config/auth
        Valor real pode ser overridden via DI no boot
```

### 4.2. `#core/config` → Config interno

```
ANTES:  db/sqlite.js --import--> #core/config (para DB_PATH)
IDEAL:  config/env.js define COPILOT_DB_PATH com default
        db/sqlite.js importa de #copilot/config/env
```

### 4.3. Boot Autônomo

```
ANTES:  server/main.js importa e inicializa módulos copilot
IDEAL:  terminal/bootstrap.js (CRIADO) é entry point autônomo
        copilot/bootstrap.js é entry point genérico que:
        1. Inicializa DI container
        2. Registra providers via Module pattern
        3. Resolve entry point (terminal ou server bridge)
        4. Inicia graceful shutdown listener

        server/main.js chama apenas:
        import { bootCopilot } from '#copilot/bootstrap'
        await bootCopilot({ mode: 'server', express: app })
```

---

## 5. Redesign de Módulos

### 5.1. `types/` → Contratos Puros (L0)

**Estado ideal**: `types/` contém APENAS JSDoc typedefs e interfaces — zero implementações.

```
types/
  ├── events.js          // BaseEvent, EventNamespace  (ATUAL — ✅)
  ├── config.js          // IConfigProvider, IEnvConfig (NOVO)
  ├── agent.js           // IAgent, IAgentSession      (NOVO)
  ├── observability.js   // ILogger, IMetrics, ITracer  (NOVO)
  ├── tools.js           // ITool, IToolRegistry        (NOVO)
  ├── hooks.js           // IHook, IHookFactory         (NOVO)
  └── index.js           // Barrel
```

### 5.2. `core/` → Primitivas Puras (L0)

**Mudanças**:

1. **Remover** `core/events.js` (legado — já migrado para `events/`)
2. **Mover** DI tokens de camadas superiores para cada módulo respectivo
3. `di-tokens.js` mantém apenas tokens L0 (EVENT_BUS, LOGGER, CONFIG)
4. Cada módulo registra seus próprios tokens via padrão Module

```
core/
  ├── di.js              // Container  (melhorado: Module pattern)
  ├── di-tokens.js       // APENAS tokens L0 (~20 líneas)
  ├── di-container.js    // Singleton global
  ├── event-bus.js       // EventBus  (sem mudança)
  ├── errors.js          // Hierarquia de erros
  ├── error-codes.js     // Catálogo
  ├── error-handlers.js  // Utilities
  ├── cache.js           // LRU cache
  ├── circuit-breaker.js // CB pattern
  ├── mutex.js           // Async mutex
  ├── retry.js           // Backoff + jitter
  ├── shutdown.js        // Graceful shutdown
  ├── timer-registry.js  // Timer cleanup
  ├── safe-json.js       // Parse seguro
  ├── schemas.js         // Zod schemas base
  ├── security/          // URL validator
  ├── structured-message.js  // Protocol types
  └── index.js           // Barrel
```

**Removidos**: `events.js` (legado), `shared-state.js` (move para DI), `constants.js` (merge em
config), `create-emitter.js` (move para events), `abort-utils.js` (merge em retry)

### 5.3. `observability/` → L2 (redesenhado)

**Mudanças radicais**:

1. **Promover para L2** (depende de sdk para OTel contexts)
2. **Eliminar** `bootstrap.js` — injeção via DI Module pattern
3. **Consolidar** `bus-actions/` + `event-bus-observers.js` — atualmente duplicados
4. **Extrair** `observers/` para `agent/` (são handlers de eventos do agent)

```
observability/
  ├── logger.js            // Logger isolado        (sem mudança)
  ├── metrics.js           // MetricsStore          (refactored, descrição)
  ├── metrics-histogram.js // Histograma            (sem mudança)
  ├── error-tracker.js     // ErrorTracker          (sem mudança)
  ├── error-alerting.js    // Alertas proativos     (sem mudança)
  ├── event-collector.js   // Collector             (refactored, descrição)
  ├── event-catalog.js     // Catálogo dinâmico     (sem mudança)
  ├── otel.js              // OpenTelemetry facade   (sem mudança)
  ├── tool-stats.js        // Métricas por tool     (sem mudança)
  ├── bus-subscribers/     // RENOMEADO de bus-actions/
  │   ├── activity-tracker.js
  │   ├── correlation-tracer.js
  │   ├── error-alerter.js
  │   ├── health-updater.js
  │   ├── log-observer.js
  │   ├── metrics-collector.js
  │   └── index.js
  ├── collectors/          // Event collector handlers
  │   ├── assistant-handlers.js
  │   ├── session-handlers.js
  │   ├── interaction-handlers.js
  │   ├── tool-handlers.js
  │   └── index.js
  └── index.js

REMOVIDOS:
  - bootstrap.js → DI Module pattern
  - event-bus-observers.js → consolidado em bus-subscribers/
  - observers/ → movido para agent/observers/
```

### 5.4. `agent/` → Lean Orchestrator (L4)

**Mudanças**:

1. **always-alive.js** quebrado em 3 módulos: `agent-core.js` (300 LOC), `agent-bus.js` (200 LOC),
   `agent-state.js` (200 LOC)
2. **Absorver** `observers/` de observability (são handlers do agent)
3. **Consolidar** lifecycle/ em 2 arquivos: `lifecycle.js` + `reconnect.js`
4. **Remover** `lifecycle/entry.js` — PM2 usa bootstrap.js

```
agent/
  ├── agent-core.js        // Singleton, sendMessage, pause/resume
  ├── agent-bus.js         // Event emission, bus wiring
  ├── agent-state.js       // State management, snapshots
  ├── config.js            // Agent-specific config
  ├── context.js           // Context builders
  ├── types.js             // Typedefs
  ├── dialog/              // 10 arquivos (sem mudança)
  ├── facades/             // REMOVIDO — inline em agent-core.js
  ├── infra/               // 9 arquivos (sem mudança)
  ├── lifecycle/           // SIMPLIFICADO: 2 arquivos
  │   ├── lifecycle.js     // start/stop/initSession
  │   └── reconnect.js     // Reconnect strategy
  ├── messaging/           // 2 arquivos (sem mudança)
  ├── observers/           // ABSORVIDO de observability/observers/
  │   ├── dialog-task-handlers.js
  │   ├── session-agent-handlers.js
  │   ├── event-name-map.js
  │   ├── context.js
  │   └── index.js
  ├── session/             // Simplificado: ~12 arquivos
  │   ├── boot-wiring.js
  │   ├── cleanup.js
  │   ├── event-handlers/ (8)
  │   ├── initializer.js
  │   └── snapshot.js
  └── index.js
```

### 5.5. `terminal/` → Entry Point Autônomo (L5)

**Mudanças radicais**:

1. **CRIAR** `bootstrap.js` — entry point standalone
2. **Extrair** `server.js` → `http-server.js` (server) + `middleware.js` (middleware)
3. **Extrair** `repl.js` → `repl-core.js` + `repl-renderer.js`
4. **Extrair** `state.js` → `terminal-state.js` com API limpa
5. **Agrupar** `commands/` em sub-barrels por categoria

```
terminal/
  ├── bootstrap.js            // NOVO — entry point standalone
  ├── index.js                // startTerminalServer()
  ├── http-server.js          // Express server creation
  ├── middleware.js            // Rate limiter, auth, CORS
  ├── route-table.js          // Declarative route table
  ├── repl-core.js            // REPL input/output loop
  ├── repl-renderer.js        // Display formatting
  ├── repl-listeners.js       // Agent event listeners
  ├── terminal-state.js       // State management
  ├── terminal-agent-wiring.js// Agent → terminal events
  ├── alias-store.js          // Alias management
  ├── file-context.js         // File context detection
  ├── workspace-context.js    // Workspace detection
  ├── rate-limiter-state.js   // Reset bridge
  ├── commands/
  │   ├── index.js            // Master barrel
  │   ├── system/             // help, config, display, diagnose
  │   ├── session/            // status, history, resume, session, clear
  │   ├── dialog/             // context, compact, thinking, plan, attach
  │   ├── data/               // search, memory, export, errors, metrics, usage
  │   ├── tools/              // tools, skills, audit, gh, git
  │   └── alias.js
  ├── dialog/                 // 5 arquivos (sem mudança)
  └── handlers/               // 5 arquivos (sem mudança)
```

### 5.6. Novo: `bootstrap.js` (L5 — Root Entry Point)

```js
// src/copilot/bootstrap.js — Entry point canônico
export async function bootCopilot(options = {}) {
  // 1. Inicializar DI container
  const container = initContainer();

  // 2. Registrar módulos (Module pattern)
  await registerCoreModule(container); // L0
  await registerEventsModule(container); // L0
  await registerConfigModule(container); // L1
  await registerDbModule(container); // L1
  await registerSdkModule(container); // L2
  await registerHooksModule(container); // L2
  await registerObsModule(container); // L2

  // 3. Entry point
  if (options.mode === 'server') {
    await registerServerBridge(container, options.express);
  } else {
    await registerTerminal(container);
  }

  // 4. Graceful shutdown
  registerShutdown(container);
  return container;
}
```

---

## 6. `conversation-hub/` → Lean Persistence (L4)

**Mudanças**:

1. **Eliminar** import de `#core/jwt_config` — JWT config via DI
2. **Quebrar** `store.js` (563 LOC) — já parcialmente extraído:
   - `store-core.js` (CRUD base) — ~200 LOC
   - `store-helpers.js` (existente)
   - `store-queries.js` (existente)
   - `store-memories.js` (existente)
   - `store-sync.js` (existente)
3. **Descrever** `orchestrator.js` e `socket-ns.js` com JSDoc

---

## 7. DI Module Pattern

Cada módulo L1+ define um `register()` function:

```js
// exemplo: config/module.js
export function registerConfigModule(container) {
  container.register(DI_TOKENS.CONFIG_PROVIDER, {
    lifecycle: 'singleton',
    factory: () => new EnvConfigProvider(),
  });
  container.register(DI_TOKENS.SYSTEM_PROMPT, {
    lifecycle: 'singleton',
    factory: () => new SystemPromptBuilder(),
  });
}
```

Benefícios:

- **Zero ciclos**: módulos não importam uns dos outros — apenas registram no container
- **Testável**: Mock via `container.register(TOKEN, { factory: () => fakeFn })`
- **Lazy**: Factories executadas no primeiro `resolve()`, não no import
- **Documentado**: Cada módulo declara explicitamente o que provê e consome

---

## 8. Model de Testes Ideal

```
tests/
  ├── unit/copilot/
  │   ├── core/         // Unit tests puros — zero DI, zero EventBus
  │   ├── events/       // Schema validation, middleware pipeline
  │   ├── config/       // Env parsing, prompt building
  │   ├── db/           // Migrations, queries
  │   ├── sdk/          // Client mocking, session lifecycle
  │   ├── hooks/        // Preset configs, factory output
  │   ├── observability// Logger, metrics, error tracker
  │   ├── audit/        // Ring buffer, JSONL writer
  │   ├── bridges/      // Git, MCP, NERV adapter
  │   ├── channel/      // Client, inject handler
  │   ├── plugins/      // Registry lifecycle
  │   ├── agent/        // Agent state, dialog, lifecycle
  │   ├── conversation-hub/ // Store, orchestrator
  │   ├── tools/        // Tool definitions, validation
  │   ├── services/     // Facade composition
  │   ├── api/          // Route handlers
  │   └── terminal/     // REPL, commands, dialog engine
  └── integration/copilot/
      ├── boot/         // Bootstrap sequence, DI wiring
      ├── flows/        // Dialog turn, event propagation
      ├── hub/          // ConversationHub e2e
      └── api/          // HTTP endpoint e2e
```

**Meta de cobertura**:

- L0 (core, events, types): >90% linhas
- L1 (config, db): >85%
- L2 (sdk, hooks, observability, audit): >80%
- L3 (tools, bridges, channel, plugins): >75%
- L4 (agent, conversation-hub, services): >70%
- L5 (api, terminal): >60%
- **Nenhum módulo com 0 testes** (services, plugins, types atualmente)

---

## 9. Segurança Ideal

### 9.1. Práticas Obrigatórias

- **URL validation** em todo endpoint HTTP e tool que aceita URL
- **Input sanitization** em todo inject handler
- **Rate limiting** por IP em todos os endpoints HTTP
- **JWT validation** em socket.io namespaces (com config interno, não externo)
- **Sandbox** para shell tools (già implementado em `tools/shell/`)
- **Audit trail** em toda operação destrutiva

### 9.2. Mudanças Necessárias

- Unificar path validation (atualmente disperso em `tools/file/shared.js` e
  `core/security/url-validator.js`)
- Adicionar CSP headers na API
- Implementar token rotation para sessões SDK longas

---

## 10. Métricas-Alvo

| Métrica                       | Atual  | Ideal    |
| ----------------------------- | ------ | -------- |
| Ciclos bidirecionais          | 4      | **0**    |
| Violações de camada           | 7      | **0**    |
| Dependências externas         | 2      | **0**    |
| God Modules (>400 LOC)        | 12     | **0**    |
| Módulos com 0 testes          | 3      | **0**    |
| Shims de compat sem deadline  | 5      | **0**    |
| Arquivos sem JSDoc (>100 LOC) | 13     | **0**    |
| Barrels problemáticos         | 4      | **0**    |
| Score global                  | 5.9/10 | **8.5+** |
| Boot standalone funcional     | ❌     | **✅**   |

---

## 11. Diagrama de Dependências Ideal

```
                        ┌─────────┐  ┌──────────┐
                L5      │terminal/│  │  api/     │
                        └─┬───┬───┘  └──┬───┬───┘
                          │   │         │   │
                  ┌───────┘   │    ┌────┘   │
                  ▼           ▼    ▼        ▼
                ┌─────┐  ┌────────────┐  ┌──────────┐
       L4       │agent│  │conv-hub    │  │services  │
                └──┬──┘  └─────┬──────┘  └────┬─────┘
                   │           │              │
          ┌────────┼───────────┼──────────────┘
          ▼        ▼           ▼
       ┌──────┐ ┌───────┐ ┌────────┐ ┌───────┐
  L3   │tools │ │bridges│ │channel │ │plugins│
       └──┬───┘ └───┬───┘ └───┬────┘ └───┬───┘
          │         │         │           │
          ▼         ▼         ▼           ▼
       ┌─────┐ ┌──────┐ ┌────────────┐ ┌──────┐
  L2   │ sdk │ │hooks │ │observab.   │ │audit │
       └──┬──┘ └──┬───┘ └─────┬──────┘ └──┬───┘
          │       │            │           │
          └───────┼────────────┼───────────┘
                  ▼            ▼
              ┌───────┐    ┌─────┐
  L1          │config │    │ db  │
              └───┬───┘    └──┬──┘
                  │           │
                  ▼           ▼
           ┌──────┐ ┌───────┐ ┌──────┐
  L0       │core  │ │events │ │types │
           └──────┘ └───────┘ └──────┘

  Todas as setas apontam para BAIXO. Zero ciclos.
```

---

## 12. Resumo

A arquitetura ideal transforma src/copilot de um subsistema acoplado ao workspace em um **pacote
autônomo** com:

- **6 camadas** claras (vs 5 com violações)
- **0 ciclos** (vs 4 bidirecionais + 32+ transitivos)
- **0 dependências externas** (vs 2)
- **Boot standalone** funcional (bootstrap.js criado)
- **DI Module pattern** para registros lazy e isolados
- **Score-alvo 8.5+/10** (vs 5.9 atual)

As mudanças são **progressivas** — cada onda do roadmap (PARTE-24D) entrega valor incremental sem
quebrar o sistema em produção.

---

## 13. Changelog

| Versão | Data       | Mudanças                      |
| ------ | ---------- | ----------------------------- |
| 1.0    | 2026-04-12 | Arquitetura ideal — 12 seções |
