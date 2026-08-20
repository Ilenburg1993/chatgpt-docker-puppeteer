# Auditoria Arquitetural Canônica — `src/copilot/`

> **Data:** 2026-05-10 **Auditor:** Kilo (automated) **Repositório:** `chatgpt-docker-puppeteer`
> **Escopo primário:** `src/copilot/tools/` (32 arquivos) — `src/copilot/sdk/` (~20 arquivos) —
> `src/copilot/terminal/` (~103 arquivos) — `src/copilot/hooks/` — `src/copilot/observability/` —
> `src/copilot/core/` **Versão:** Consolidação canônica final (Fase 1 + Fase 2)

---

## Atualização de status — revalidação profunda em 2026-05-11

> **Importante**: este documento nasceu como snapshot externo de 2026-05-10. As contagens agregadas
> e o texto das tabelas abaixo continuam úteis como **histórico de investigação**, mas **não são
> mais a fonte de verdade isolada** sobre o estado atual do código.
>
> A fonte operacional corrente passa a ser esta seção de revalidação + o roadmap canônico em
> `2026-05-10-ROADMAP-REBUILD-TOOLS-CANONICO.md`.

### Síntese executiva do estado atual

- O escopo `src/copilot` foi revalidado com:
  - `npm run typecheck:strict:src.copilot` ✅
  - `npm run typecheck:strict:tests.unit` ✅
  - `npx eslint src/copilot tests/unit/copilot tests/integration/copilot` ✅
  - `npm run test:copilot` ✅
- Parte importante dos achados desta auditoria externa ficou **corrigida**, **obsoleta** ou
  **reescopada**.
- Nesta rodada, o blind spot de observabilidade para denies no runtime canônico do agent foi fechado
  no plano principal de stats de tools.

### Matriz objetiva de reclassificação

| Item original                                                               | Estado em 2026-05-11                          | Evidência resumida                                                                                                                                                                                                                         | Leitura atual                                                                                                       |
| --------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `BUG-01` — `getAllTools(registry)` ignorado                                 | **Obsoleta / falso positivo no estado atual** | a topologia de bootstrap atual em `src/copilot/tools/bootstrap.js` usa agregação estática compatível (`getAllStaticTools()` + compat `getAllTools()`)                                                                                      | a claim não descreve mais o fluxo real atual                                                                        |
| `BUG-02` — timeout RPC morto/ignorado                                       | **Corrigida**                                 | `src/copilot/tools/session/session-rpc-tools.js` explicita semântica advisory sem dead code silencioso                                                                                                                                     | continua não-bloqueante por política, mas não é mais código morto                                                   |
| `BUG-03` — fallback da factory perde schema                                 | **Corrigida**                                 | `src/copilot/tools/infra/tool-factory.js` normaliza parâmetros antes do fallback plain tool                                                                                                                                                | o caminho recoverable preserva contrato de schema                                                                   |
| `BUG-06` — timer de input com race estrutural                               | **Corrigida / mitigada fortemente**           | `src/copilot/tools/hook/hook-tools.js` usa guarda por `_deletePendingInput(requestId)` + limpeza de timer no path bem-sucedido                                                                                                             | a race descrita não permanece no formato original                                                                   |
| `BUG-07` — parse JSON DDG sem tratamento dedicado                           | **Corrigida**                                 | `src/copilot/tools/web/web-tools.js` recebeu tratamento explícito do fallback JSON inválido                                                                                                                                                | achado deixou de estar ativo                                                                                        |
| `BUG-11` — pending input órfão no shutdown                                  | **Corrigida / mitigada fortemente**           | `src/copilot/agent/ports/tool-port.js` chama `cancelAllUserInputRequests()` no teardown; `hook-tools` integra cancelamento ao SDK                                                                                                          | o vazamento estrutural descrito foi fechado no runtime canônico                                                     |
| `BUG-12` — stale import de `isToolDisabled`                                 | **Falso positivo / claim desatualizada**      | `src/copilot/hooks/presets/production.js` aceita `isToolDisabled` injetável e o binding default não caracteriza sozinho stale reference operacional                                                                                        | não há evidência atual de bug real no fluxo canônico                                                                |
| `SEC-01` — `safeEnv._cache` frágil                                          | **Corrigida**                                 | `src/copilot/tools/shell/sandbox.js` usa `_safeEnvCache` privado de módulo com TTL explícito                                                                                                                                               | a vulnerabilidade não existe mais no formato descrito                                                               |
| `SEC-03` — requestId antes da checagem de capacidade                        | **Corrigida**                                 | `src/copilot/tools/hook/hook-tools.js` valida capacidade antes de `_nextInputId()`                                                                                                                                                         | janela de inconsistência eliminada                                                                                  |
| `SDK-BUG-01` / `OBS-BUG-02` — double wrapping factory↔SDK                   | **Reescopada e mitigada estruturalmente**     | `tool-factory` hoje usa `sdkCreateTool`; além disso, a telemetria de tools foi consolidada em `observability/tool-stats.js`, com `MetricsStore` delegando ao backend canônico e remoção de writers duplicados em terminal/collectors/shell | o risco residual deixou de ser dupla contagem generalizada e ficou concentrado no tier MCP fora da factory canônica |
| `SDK-BUG-03` — overwrite silencioso no registry                             | **Corrigida**                                 | `src/copilot/sdk/tools/registry.js` registra warning em sobrescrita                                                                                                                                                                        | duplicatas não são mais silenciosas                                                                                 |
| `SDK-BUG-04` — `_toolsConfig` sem reset                                     | **Corrigida**                                 | `src/copilot/sdk/tools/state.js` expõe `resetToolsConfigForTests()`                                                                                                                                                                        | isolamento de testes passou a existir                                                                               |
| `SDK-BUG-06` — dois sistemas paralelos de user-input                        | **Majoritariamente obsoleta**                 | o antigo `tools/user-input-state.js` deixou de ser a superfície canônica; `src/copilot/tools/hook/hook-tools.js` opera com `ToolSessionContext` e cancelamento integrado ao SDK                                                            | o problema foi largamente absorvido pela arquitetura atual                                                          |
| `BUG-18` / `SYS-GAP-12` / `SYS-GAP-16` — cobertura de eventos sem validação | **Parcialmente mitigada**                     | existe cobertura dedicada em `tests/unit/copilot/test_terminal_event_adapter_events.spec.js`                                                                                                                                               | ainda pode evoluir, mas a ausência total de validação não é mais verdadeira                                         |
| `OBS-BUG-03` / `SYS-GAP-04` — denies fora das métricas                      | **Corrigida no runtime canônico do agent**    | `src/copilot/agent/ports/hook-port.js` agora chama `recordBlockedToolCall()` em decisões `deny`; `src/copilot/observability/tool-stats.js` e `get_tool_health` passaram a expor `blocked/totalBlocked`                                     | o Always-Alive runtime deixa de ter blind spot quantitativo para denies                                             |
| `BUG-04` / `BUG-10` — limites `Infinity` nas file tools                     | **Ainda ativa**                               | `src/copilot/tools/file/shared.js` mantém limites operacionais não-bloqueantes por decisão policy-first                                                                                                                                    | continua sendo trade-off aberto e precisa de decisão arquitetural formal                                            |
| `BUG-24` — MCP bridge com state module-level mutável                        | **Ainda ativa**                               | `src/copilot/bridges/mcp-tool-bridge.js` mantém `_mcpHealth`, `_mcpCircuitOpen`, `_bootAttemptCount` etc. como estado de módulo                                                                                                            | segue como alvo estrutural prioritário                                                                              |
| `BUG-25` / `SYS-GAP-15` — MCP bridge fora da factory canônica               | **Ainda ativa**                               | MCP bridge continua usando `createTool` direto                                                                                                                                                                                             | ainda há dois tiers de qualidade/observabilidade                                                                    |
| `SYS-GAP-11` — terminal sem boundary enforcement suficiente                 | **Ainda ativa**                               | não há evidência de fechamento completo das regras de limite de módulo no terminal                                                                                                                                                         | backlog arquitetural permanece válido                                                                               |

### Novos recortes encontrados na investigação profunda

1. **O problema de observabilidade mudou de forma**
   - a claim antiga de “dupla métrica por duas factories” ficou desatualizada;
   - o risco principal já não é mais a coexistência de planos paralelos para tools nativas: o
     runtime principal agora converge em `observability/tool-stats.js`, com `MetricsStore` atuando
     como facade do mesmo backend.
   - o residual arquitetural ficou concentrado em duas frentes:
     - MCP bridge ainda fora da factory canônica (`createTool` direto);
     - warnings recoverable/TDZ-safe do `tool-factory` sob certos mocks SSR/Vitest.
   - isso gera drift de ownership e naming (`exec_command` vs `shell.exec_command` vs `sdk.<tool>`),
     não necessariamente double-counting universal.

2. **Persistem warnings TDZ-safe em certas árvores de import de teste**
   - em execuções completas ainda aparecem warnings recoverable do `tool-factory` durante alguns
     grafos de import SSR/mocks;
   - os testes passam porque o fallback atual é resiliente, mas o ruído evidencia oportunidade de
     endurecimento da normalização lazy de schema.

### Conclusão desta revalidação

O documento externo continua valioso como catálogo de hipóteses e de hotspots, mas o estado real em
2026-05-11 é:

- **estabilização funcional concluída** para boa parte dos P0/P1 originais;
- **blind spot de denies fechado** no runtime canônico do agent;
- **backlog ativo deslocado** para três eixos principais:
  1. política canônica para `Infinity` nas file tools;
  2. encapsulamento/normalização do MCP bridge;
  3. migração do MCP bridge para a surface canônica de factory/telemetria.

---

## Sumário Executivo

O módulo `src/copilot/tools/` é o **registry central de Custom Tools** do Always-Alive Agent, com 10
categorias funcionais (~55 tools), infraestrutura transversal (factory, DI tokens, logger, metrics
proxy, contract verifier) e integrações profundas com `sdk/`, `terminal/`, `hooks/` e
`observability/`. A arquitetura demonstra **maturidade moderada-alta** — padrões de DI por setter
injection são consistentes, a factory é uniforme e a separação leitura/escrita é explícita — mas
apresenta **déficits estruturais** mensuráveis: estado global mutável em 11+ variáveis module-level,
duas fábricas paralelas com lógica duplicada, ausência de limites de módulo formalizados e cinco
mecanismos de permissão não coordenados.

A auditoria identificou **34 bugs funcionais** (BUG-01 a BUG-34), **12 bugs de integração
SDK↔Tools** (SDK-BUG-01 a SDK-BUG-12), **3 bugs de observabilidade** (OBS-BUG-01 a OBS-BUG-03), **16
gaps sistêmicos** (SYS-GAP-01 a SYS-GAP-16), **4 problemas de segurança** (SEC-01 a SEC-04), **5
vazamentos de encapsulamento** (ENC-01 a ENC-05), **6 inconsistências técnicas** (INC-01 a INC-06) e
**5 gaps de testabilidade** (TEST-01 a TEST-05). Dois bugs foram corrigidos durante o
desenvolvimento (BUG-29, BUG-30); um não foi reproduzido (BUG-35, removido). Total de itens ativos:
**84**.

---

## Índice

1. [Mapa Arquitetural](#1-mapa-arquitetural)
2. [Análise da Situação Atual](#2-análise-da-situação-atual)
3. [Catálogo de Bugs Funcionais](#3-catálogo-de-bugs-funcionais)
4. [Bugs de Integração SDK↔Tools](#4-bugs-de-integração-sdktools)
5. [Bugs de Observabilidade](#5-bugs-de-observabilidade)
6. [Problemas de Segurança](#6-problemas-de-segurança)
7. [Vazamentos de Estado e Encapsulamento](#7-vazamentos-de-estado-e-encapsulamento)
8. [Inconsistências e Dívida Técnica](#8-inconsistências-e-dívida-técnica)
9. [Gaps de Testabilidade](#9-gaps-de-testabilidade)
10. [Gaps Arquiteturais Sistêmicos](#10-gaps-arquiteturais-sistêmicos)
11. [Análises Temáticas Profundas](#11-análises-temáticas-profundas)
12. [Situação Atual vs. Situação Ideal](#12-situação-atual-vs-situação-ideal)
13. [Roadmap de Evolução](#13-roadmap-de-evolução)
14. [Registros de Decisões Arquiteturais (ADRs)](#14-registros-de-decisões-arquiteturais-adrs)
15. [Priorização Consolidada](#15-priorização-consolidada)
16. [Métricas do Módulo](#16-métricas-do-módulo)

---

## 1. Mapa Arquitetural

### 1.1 Consumidores externos de `#copilot/tools`

```
src/copilot/
├── bootstrap.js                    → { TOOLS_LOGGER, TOOLS_METRICS }
├── observability/bootstrap.js      → { TOOLS_LOGGER, TOOLS_METRICS }
├── server/routes/sdk/deps.js       → getAllTools()
├── agent/ports/tool-port.js        → { isToolDisabled, readStore }
├── hooks/presets/production.js     → isToolDisabled
├── terminal/commands/sdk.js        → { fileReadTools, fileWriteTools }
├── terminal/commands/fs.js         → { fileReadTools, fileWriteTools }
├── terminal/commands/tools.js      → readIntrospectionRegistrySnapshot
└── terminal/commands/resume.js     → { fileReadTools }
```

### 1.2 Dependências externas de `tools/` (imports `#copilot/*`)

| Namespace                | Arquivos dependentes                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#copilot/config`        | bootstrap, session-rpc, experimental-rpc, web-tools, task-tools, shell/sandbox, shell/executor, tool-factory, introspection (9 arqs)                                         |
| `#copilot/sdk`           | bootstrap, session-rpc, experimental-rpc, git/index, introspection, shell/index, task-tools, todo/query, todo/crud, todo/todo-write, todo/bulk, file/read-tools-io (12 arqs) |
| `#copilot/core`          | bootstrap, permission-tools, session-rpc, experimental-rpc, web-tools, file/shared, task-tools, todo/store, session-tools, hook-tools (10 arqs)                              |
| `#copilot/boot`          | git/index, shell/sandbox, file/shared, code-tools, session-tools, todo/store, file/write-tools (6 arqs)                                                                      |
| `#copilot/audit`         | hook-tools, shell/index (2 arqs)                                                                                                                                             |
| `#copilot/observability` | bootstrap (1 arq)                                                                                                                                                            |
| `#copilot/db`            | todo/store (1 arq)                                                                                                                                                           |
| `#copilot/infra`         | file/scope-tools, file/read-tools-io, file/write-tools, file/read-tools-search, file/symbol-search-tool (5 arqs — violação de camada; ver SYS-GAP-01)                        |

### 1.3 Dependências `node:*` por subdomínio

| Subdomínio               | Módulos Node                                          |
| ------------------------ | ----------------------------------------------------- |
| `shell/*`                | `child_process`, `path`, `util`                       |
| `file/shared.js`         | `buffer`, `child_process`, `path`, `util`             |
| `file/read-tools-io.js`  | `fs/promises`                                         |
| `hook-tools.js`          | `child_process`, `fs/promises`, `path`, `url`, `util` |
| `task-tools.js`          | `fs/promises`, `path`, `url`                          |
| `session-tools.js`       | `child_process`, `fs/promises`, `path`                |
| `code-tools.js`          | `child_process`, `fs`, `path`, `util`                 |
| `git/index.js`           | `child_process`, `util`                               |
| `todo/store.js`          | `fs`                                                  |
| `introspection-tools.js` | `module`                                              |
| `tool-factory.js`        | `module`                                              |

### 1.4 Grafo de Dependências Internas (`tools/`)

```
index.js (barrel — exporta tudo)
│
├── Infraestrutura transversal
│   ├── tool-factory.js          → config, sdk, zod, ./logger.js
│   ├── tool-contract-verifier.js → (autossuficiente)
│   ├── bootstrap.js             → observability, sdk, todos os subdomínios
│   ├── di-tokens.js             → core/di.js
│   ├── logger.js                → (nenhuma dep interna)
│   └── metrics-proxy.js         → observability/metrics-histogram (tipo)
│
├── Subdomínios core
│   ├── hub-tools.js             → zod, config, core, ./logger, ./tool-factory
│   ├── permission-tools.js      → audit, core, zod
│   ├── hook-tools.js            → audit, core, zod, user-input-state
│   ├── session-tools.js         → boot, core, sdk, zod
│   ├── session-rpc-tools.js     → config, core, sdk, zod
│   ├── experimental-rpc-tools.js→ config, core, sdk, zod, ./logger, ./tool-factory
│   ├── task-tools.js            → config, sdk, core, zod
│   ├── code-tools.js            → boot, core, zod
│   ├── web-tools.js             → config, core, zod, infra/io-*, ./logger, ./tool-factory
│   ├── introspection-tools.js   → config, sdk, zod, ./metrics-proxy, ./tool-contract-verifier, ./tool-factory
│   └── user-input-state.js      → (nenhuma dep interna)
│
├── git/index.js                 → boot, sdk, zod, ../../core/error-handlers
│
├── shell/
│   ├── index.js                 → audit, config, sdk, ./executor, ./sandbox
│   ├── executor.js              → config, ../../core/error-handlers, ./sandbox
│   └── sandbox.js               → boot, config
│
├── file/
│   ├── index.js (barrel)
│   ├── read-tools.js (barrel)   → read-tools-io, read-tools-search, symbol-search-tool
│   ├── read-tools-io.js         → core/error-handlers, core/io-contracts, core/io-policy, infra/io-engine, infra/io-prefetch, infra/io-scanner, ./shared
│   ├── read-tools-search.js     → core/*, infra/io-engine, infra/io-index-registry, infra/io-observability, ./shared
│   ├── symbol-search-tool.js    → core/*, infra/io-observability, ./shared
│   ├── write-tools.js           → core/error-handlers, core/io-contracts, infra/io-engine, ./shared
│   ├── index-tools.js           → infra/index.js, ../tool-factory
│   ├── scope-tools.js           → #copilot/infra/io-session-scope, ../tool-factory
│   └── shared.js                → boot, core
│
└── todo/
    ├── index.js (barrel)
    ├── todo-schema.js           → zod
    ├── store.js                 → boot, core, db, ./todo-schema
    ├── crud-tools.js            → sdk, ../tool-factory, ./store
    ├── todo-write-tools.js      → sdk, ../logger, ../tool-factory, ./store
    ├── query-tools.js           → sdk, ../tool-factory, ./store
    └── bulk-tools.js            → sdk, ../logger, ./store
```

### 1.5 Pontes SDK ↔ Tools

```
sdk/tools/custom.js   ←→  tools/tool-factory.js
    (via setCustomToolsBuilder / TOOLS_BUILDER DI token)

sdk/di-tokens.js      ←→  tools/di-tokens.js
    (TOOLS_LOGGER, TOOLS_METRICS registrados no container DI compartilhado)

sdk/tools/state.js    ←→  tools/tool-contract-verifier.js
    (domínios distintos; gerenciam configuração de tools independentemente)

sdk/rpc/ops.js        ←→  tools/shell/index.js
    (shellExec RPC → execução real de shell)

sdk/session/user-input.js  ←→  tools/hook-tools.js
    (onUserInputRequest → user-input-state.js — dois sistemas em paralelo; ver §11.3)

sdk/session/events.js      ←→  tools/introspection-tools.js
    (onToolCall events → metrics-proxy.js)
```

### 1.6 Arquitetura do Terminal

O módulo `src/copilot/terminal/` contém **103+ arquivos** organizados em:

```
terminal/
├── commands/        → CLI commands (sdk, fs, tools, session, memory, git, gh, etc.)
├── events/          → Event adapters, passthrough, task streams, lifecycle
├── frontend/        → Gateways HTTP (agent-runtime, sdk-session, hub, dialog) + projections
├── state/           → Registries, interactions, activity, tracing, question replay
├── stores/          → Alias store, display policy
├── handlers/        → HTTP handlers (agent, dialog, system-config, system-metrics, shared)
├── repl/            → Readline REPL (routing, banner, lifecycle, multiline, input delivery)
├── dialog/          → Dialog management, SSE broadcast, engine, persistence, turn display
├── terminal-phases/ → Boot phases (init, aliases, hub, HTTP, listeners, shutdown, etc.)
└── wiring/          → Terminal-agent wiring
```

Fluxo de inicialização:

```
startTerminalServer()
  ├─ createTerminalBootContext()       → valida deps obrigatórias
  ├─ runTerminalInitPhase()            → display preset + log
  ├─ runTerminalAliasesPhase()         → loadAliasesAsync()
  ├─ runTerminalRuntimeConfigPhase()   → wireRuntime() + preflight
  ├─ runTerminalPinnedContextPhase()
  ├─ runTerminalConversationHubPhase()
  ├─ runTerminalHttpServerPhase()
  ├─ runTerminalRuntimeListenersPhase()
  │    ├─ registerAgentEventListeners() ← wiring/terminal-agent-wiring.js
  │    ├─ startReflectionLoop()
  │    ├─ attachTerminalHubSocketIO()
  │    └─ broadcastSse('terminal.started')
  └─ runTerminalReplPhase()            → startRepl()
```

### 1.7 Pipeline de Eventos do Terminal

Duas fontes de eventos paralelas alimentam o SSE para o frontend:

```
Agent EventEmitter
  ├─ event-adapters.js (composition root)
  │    ├─ setupTerminalSdkSessionEventListeners()   → sdk-session-events.js  (1103 lin)
  │    ├─ setupTerminalAgentRuntimeEventListeners() → agent-runtime-events.js (691 lin)
  │    └─ cleanup on teardown
  ├─ io-activity-events.js   → diagnostics channel
  ├─ task-stream-events.js   → task.* events
  └─ agent-sse-passthrough.js → fallback para eventos sem adapter dedicado
```

Matriz de cobertura de eventos (definida em `event-adapter-events.js`):

| Categoria                                                    | Quantidade |
| ------------------------------------------------------------ | ---------- |
| `TERMINAL_EXPLICIT_AGENT_EVENTS` (adapter dedicado)          | 74         |
| `TERMINAL_AGENT_SSE_PASSTHROUGH_EVENTS` (passthrough direto) | 22         |
| Ignorados (sem handler)                                      | ~9         |

### 1.8 Arquitetura de Observabilidade (Core)

```
src/copilot/core/
├── di.js (275 lin)              → Container DI formal (createToken, createContainer, fork, dispose)
├── di-container.js (20 lin)    → Singleton global do container
├── error-handlers.js (233 lin) → logSwallowed, wrapAsync, isFatalError, isTransientError
├── mutex.js (151 lin)          → createMutex, createMutexPool, withMutex
├── circuit-breaker.js (164 lin)→ CircuitOpenError; estados closed → open → half-open
├── event-bus.js (383 lin)      → Bus canônico (namespaces, wildcards, middleware)
├── shutdown.js (367 lin)       → Priority-based handlers, per-handler timeout (5s)
└── interfaces.js (321 lin)     → IAgent, IEventBus, IStateStore, IToolRegistry,
                                   IHooksPipeline, IConfigProvider, IMetricsCollector
```

---

## 2. Análise da Situação Atual

### 2.1 Forças

**DI por setter injection consistente.** O padrão
`let _x = null; export function setX(v) { _x = v; }` é aplicado uniformemente em todos os
subdomínios que requerem serviço externo (`setHub`, `setPermissionAgent`, `setSessionRpc`,
`setExperimentalSession`, `setToolsLogger`, `setToolsMetrics`, `configureHookTools`), evitando
import cycles.

**Factory pattern uniforme.** Quase todas as tools usam `buildTool()` do `tool-factory.js`, que
encapsula `defineTool` do SDK com logging automático, conversão Zod→JSON Schema e semântica
`skipPermission`.

**Separação explícita leitura/escrita.** `todoReadTools` vs `todoWriteTools`, `fileReadTools` vs
`fileWriteTools`, `withSkipPermission()` aplicado consistentemente em tools read-only.

**Barrels organizados.** Cada subdomínio tem `index.js` barrel com exports explícitos.

**Tool Contract Verifier.** Mecanismo maduro de validação de metadados em runtime
(`tool-contract-verifier.js`).

**Observabilidade integrada.** `metrics-proxy.js` e `logger.js` com injeção — sem dependência direta
de `observability/`.

### 2.2 Fraquezas Estruturais

**Problema 1 — `file/` é um God Module.** 8 arquivos, 28+ tools, ~40% do módulo total. Mistura IO de
baixo nível, busca/indexação, escopo de sessão e infraestrutura compartilhada em um único namespace
sem subdivisão formal.

**Problema 2 — `todo/store.js` mistura domínio e transporte.** Um único arquivo acumula:
persistência SQLite, migração legada (JSON→SQLite), lógica de domínio (validação de transições,
geração de IDs), helpers puros e agendamento de cleanup. Store não pode ser reutilizado fora do
contexto de tools.

**Problema 3 — Estado global mutável em 11+ variáveis module-level.**

| Módulo                      | Variável(is)                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `introspection-tools.js`    | `_registeredTools`, `_disabledTools`, `_CATEGORY_TOOL_MAP_DYNAMIC`, `_toolNameToMetadataMap`, `_toolContractReport` |
| `user-input-state.js`       | `_pendingInputResolvers`, `_pendingInputSeq`                                                                        |
| `hook-tools.js`             | `_broadcastSse`                                                                                                     |
| `hub-tools.js`              | `_injectedHub`                                                                                                      |
| `permission-tools.js`       | `_agent`                                                                                                            |
| `session-rpc-tools.js`      | `_rpc`                                                                                                              |
| `experimental-rpc-tools.js` | `_session`                                                                                                          |
| `metrics-proxy.js`          | `_impl`                                                                                                             |
| `logger.js`                 | `_injectedLogger`                                                                                                   |
| `web-tools.js`              | `RATE_WINDOW`                                                                                                       |

**Problema 4 — `tool-factory.js` é um God Object (345 linhas, 5+ responsabilidades).** Além de
`buildTool()` e `withSkipPermission()`, contém: loading dinâmico de `zod-to-json-schema`, fallback
para Zod v4 nativo, validação de schema, detecção de erros recuperáveis, logger local.

**Problema 5 — Ausência de limites de módulo formalizados.** Arquivos em `tools/file/` importam
diretamente de `../../infra/*` e `../../db/*` sem nenhuma regra declarativa (ESLint
`no-restricted-imports` ou equivalente), permitindo degradação arquitetural silenciosa.

**Problema 6 — Inconsistência `createTool` vs `buildTool`.** ~5 arquivos usam `createTool`
diretamente do SDK (sem logging automático, sem conversão Zod, sem tratamento de factory errors),
enquanto ~10 arquivos usam `buildTool`. Cria disparidade de observabilidade.

**Problema 7 — `user-input-state.js` é um singleton global frágil.** Estado de pending inputs em
variáveis module-level sem mecanismo de reset entre sessões. Em ambientes multi-sessão, IDs colidem
e resolvers antigos persistem.

**Problema 8 — Barrels expõem detalhes de implementação.** `tools/index.js` exporta `readStore`
(acesso direto ao SQLite), `TOOLS_LOGGER`, `TOOLS_METRICS` e funções de reset para testes — detalhes
que consumidores externos não deveriam acessar diretamente.

---

## 3. Catálogo de Bugs Funcionais

_Classificação: CRITICAL > HIGH > MEDIUM > LOW_

| ID         | Arquivo                                                    | Severidade                       | Descrição                                                                                                                                                                                                                                                                                                                                                                                | Correção Sugerida                                                                                                  |
| ---------- | ---------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **BUG-01** | `bootstrap.js:132`                                         | **CRITICAL**                     | `getAllTools(registry)` passa `registry` como argumento, mas `getAllTools()` em `index.js:80` não declara parâmetro algum. O argumento é silenciosamente ignorado. Tools registradas dinamicamente no registry após o bootstrap não são incluídas no array retornado — contrato quebrado.                                                                                                | Alterar `getAllTools()` para aceitar `(registry?)` e mesclar tools dinâmicas; ou remover o argumento da chamada.   |
| **BUG-02** | `session-rpc-tools.js:86-89`                               | **CRITICAL**                     | `resolveRpcTimeoutMs()` é código morto: recebe `timeoutMs`, aplica `void timeoutMs` (sem efeito), retorna sempre `null`. O retorno nunca é usado em `wrapRpc()`. Timeouts por-call passados individualmente por cada tool são **completamente ignorados**.                                                                                                                               | Remover o parâmetro `opts` de `wrapRpc` ou implementar `resolveRpcTimeoutMs` funcionalmente.                       |
| **BUG-03** | `tool-factory.js:193-206`                                  | **HIGH**                         | Na fallback path de `createTool()`, quando `sdkCreateTool` falha com erro recuperável, `makePlainTool` é chamado passando `options.parameters` sem normalização. Schema Zod propagado como objeto bruto sem conversão para JSON Schema — tools criadas durante fallback window ficam com contrato invisível para o modelo.                                                               | Aplicar `normalizeParameters` antes de `makePlainTool` no fallback.                                                |
| **BUG-04** | `file/shared.js:25-34`                                     | **HIGH**                         | Todas as constantes de limite (`MAX_CONTENT_BYTES`, `MAX_SEARCH_OUTPUT`, `MAX_LIST_ENTRIES`, `MAX_DIFF_OUTPUT`) são `Number.POSITIVE_INFINITY`. Arquivo de 10GB pode ser lido e retornado sem truncamento, causando OOM no processo.                                                                                                                                                     | Definir valores concretos (ex: 5MB para content, 1M para search, 10K para list) com truncamento informativo.       |
| **BUG-05** | `file/read-tools-io.js:84-89`                              | **MEDIUM**                       | `warmReadThroughContext()` é chamado incondicionalmente para toda leitura, inclusive arquivos binários (`encoding: 'base64'`) ou muito pequenos. Prefetch desnecessário gera I/O extra sem benefício.                                                                                                                                                                                    | Condicionar: executar apenas se `encoding !== 'base64'` E `stats.size > MIN_SIZE_THRESHOLD` (ex: 1024 bytes).      |
| **BUG-06** | `hook-tools.js:274-288`                                    | **MEDIUM**                       | `autoCleanupTimer` de 10 minutos resolve a promise com status `'timeout'`. Se o usuário responder após o timer disparar mas antes do event loop processar o callback, a resposta chega a uma promise já resolvida e é perdida. Se `resolvePendingUserInput` for chamada manualmente antes do timer, `deletePendingUserInputResolver` já removeu a entry — o timer falha silenciosamente. | Adicionar guarda atômica antes de resolver no timer; usar `clearTimeout` no path de resolução manual bem-sucedida. |
| **BUG-07** | `web-tools.js:339-446`                                     | **MEDIUM**                       | Quando a DDG JSON API retorna HTTP 200 com body não-JSON, `response.json()` na linha 354 lança `SyntaxError` não capturado pelo catch externo (pois o check `response.ok` já entrou no bloco try interno). Erro de parse propaga como erro genérico sem informação diagnóstica.                                                                                                          | Adicionar try/catch específico ao redor de `response.json()`.                                                      |
| **BUG-08** | `git/index.js:35-52`                                       | **LOW**                          | `safeGitArgs` não aplica timeout real — apenas loga `advisoryTimeoutMs`. O `execAsync` não recebe sinal de abort. Comandos git em repos gigantes podem travar indefinidamente. Os nomes `ADVISORY_GIT_CMD_TIMEOUT_MS` e `ADVISORY_GIT_PUSH_TIMEOUT_MS` são enganosos.                                                                                                                    | Implementar timeout real via `AbortController` + `signal`; ou documentar explicitamente que são advisory.          |
| **BUG-09** | `tool-factory.js:68`                                       | **MEDIUM**                       | `logToolFactory()` usa `console.error/warn/info/debug` diretamente, ignorando o logger injetado via `setToolsLogger`. Logs da factory durante cold-start vão para console raw sem integração com o pipeline de observabilidade.                                                                                                                                                          | `logToolFactory` deve delegar ao logger injetado, ou ser removido em favor de `./logger.js`.                       |
| **BUG-10** | `file/shared.js` + `file/read-tools-io.js`                 | **HIGH**                         | Limites `Infinity` (BUG-04) combinados com ausência de streaming significam que `read_file_content` de um arquivo de 2GB aloca 2GB em memória de uma vez. O protocolo SDK não suporta chunked response.                                                                                                                                                                                  | Implementar limite máximo concreto (5MB) e retornar erro informativo quando excedido.                              |
| **BUG-11** | `hook-tools.js:252-287`                                    | **HIGH**                         | `request_user_input` cria Promise que só resolve quando `resolveUserInput()` é chamado externamente. Se o agent for interrompido enquanto a promise está pendente, o resolver nunca é chamado — memory leak da promise e do timer de 10 min.                                                                                                                                             | Rejeitar todas as promises pendentes no shutdown path (`unbindAgentSessionTools()` ou equivalente).                |
| **BUG-12** | `hooks/presets/production.js:24`                           | **MEDIUM**                       | Importa `isToolDisabled` de `#copilot/tools` com binding direto ao module-level state de `introspection-tools.js`. Se a introspecção for resetada em testes, o import fica stale com referência antiga.                                                                                                                                                                                  | Injetar a função via configuração de hooks; ou garantir que o binding seja dinâmico.                               |
| **BUG-13** | `sdk/tools/custom.js:315`                                  | **MEDIUM**                       | `_registry.set(def.name, ...)` não valida `handlerId` contra `BUILTIN_HANDLER_MAP` **antes** de persistir. O erro só aparece quando `buildCustomTools()` é chamado. Se o mapa for alterado posteriormente, dados inválidos sobrevivem.                                                                                                                                                   | Versionar `BUILTIN_HANDLER_MAP`; validar em `registerCustomTool()` com snapshot do mapa atual.                     |
| **BUG-14** | `sdk/tools/agent-policy.js:53`                             | **LOW**                          | `normalizeAgentToolList()` adiciona `null` ao `Set` quando `resolveToolName()` retorna `null` para nomes desconhecidos, criando entrada fantasma.                                                                                                                                                                                                                                        | Filtrar antes de criar o Set: `.filter(Boolean)`.                                                                  |
| **BUG-15** | `sdk/tools/state.js:48`                                    | **MEDIUM**                       | `_toolsConfig = { allowlist: result.data.allowlist, denylist: result.data.denylist }` é shallow reference. Arrays originais podem ser mutados externamente por quem recebe `getToolsConfig()`.                                                                                                                                                                                           | Deep clone na entrada e saída de `patchToolsConfig`.                                                               |
| **BUG-16** | `sdk/session/user-input.js:221`                            | **LOW**                          | `answerNext()` faz `queue.shift()` com race condition assíncrona: dois consumers podem resolver o mesmo `pending` antes que o state seja atualizado.                                                                                                                                                                                                                                     | Adicionar guard `if (pending)` após `shift()`, ou usar mutex.                                                      |
| **BUG-17** | `todo/store.js:178`                                        | **LOW**                          | `generateId()` usa `Math.random()` (não criptográfico). Em alta carga, probabilidade não-zero de colisão — o `upsert` SQLite sobrescreve silenciosamente.                                                                                                                                                                                                                                | Usar `crypto.randomUUID()` (Node 19+) ou UUID prefixado.                                                           |
| **BUG-18** | `terminal/events/event-adapter-events.js`                  | **MEDIUM**                       | Event coverage matrix: 74 explicit + 22 passthrough + ~9 ignorados. Nenhum mecanismo garante em build-time que todo evento tenha tratamento.                                                                                                                                                                                                                                             | Adicionar teste CI que verifica `listTerminalIgnoredAgentEvents()` está vazio ou documentado.                      |
| **BUG-19** | `terminal/state/active-tool-call-registry.js`              | **MEDIUM**                       | Module-level singleton subverte o design session-scoped de `tool-call-registry.js`. Em cenários multi-sessão, active calls vazam entre sessões.                                                                                                                                                                                                                                          | Converter para session-scoped ou injetar instância por sessão.                                                     |
| **BUG-20** | `terminal/events/sdk-session-events.js`                    | **MEDIUM**                       | 1103 linhas, 30+ listeners registrados em um único arquivo — God Object de tradução de eventos SDK para terminal. Manutenção e teste são extremamente prejudicados.                                                                                                                                                                                                                      | Segmentar em módulos menores por categoria de evento.                                                              |
| **BUG-21** | `terminal/events/agent-runtime-events.js`                  | **MEDIUM**                       | 691 linhas, ~15 listeners — segundo maior arquivo do pipeline, com as mesmas características de God Object.                                                                                                                                                                                                                                                                              | Segmentar por domínio (tool events, session events, subagent events).                                              |
| **BUG-22** | `terminal/events/io-activity-events.js`                    | **MEDIUM**                       | Diagnostics channel listener sem tratamento de erro. Falhas no listener propagam sem log.                                                                                                                                                                                                                                                                                                | Adicionar try/catch com logging por evento.                                                                        |
| **BUG-23** | `terminal/wiring/terminal-agent-wiring.js`                 | **MEDIUM**                       | Acoplamento forte a internals do `AlwaysAliveAgent` sem layer de abstração. Mudanças no agent requerem mudanças paralelas no wiring.                                                                                                                                                                                                                                                     | Definir interface de abstração entre wiring e agent.                                                               |
| **BUG-24** | `bridges/mcp-tool-bridge.js`                               | **HIGH**                         | `_mcpCircuitOpen` e `_mcpHealth` são variáveis module-level mutáveis para o circuit breaker. Em cenários de concorrência, estado pode ser corrompido. Além disso, o circuit breaker não pode ser reiniciado entre sessões.                                                                                                                                                               | Encapsular em classe com instância injetável por sessão.                                                           |
| **BUG-25** | `bridges/mcp-tool-bridge.js`                               | **MEDIUM**                       | MCP tools são criadas via `createTool()` (SDK raw), não via `buildTool()` (tool factory). Sem logging automático, conversão Zod, tratamento de factory errors — nível de observabilidade degradado.                                                                                                                                                                                      | Avaliar migração para `buildTool()`; ou documentar a exceção.                                                      |
| **BUG-26** | `bridges/mcp-tool-bridge.js`                               | **MEDIUM**                       | `AbortSignal.timeout(8000)` + `withRetry(3, 200ms)`: se o abort disparar durante uma tentativa de retry, o `AbortError` pode ser engolido pelo handler de retry, que tentará novamente um request já abortado.                                                                                                                                                                           | Tratar `AbortError` explicitamente no `withRetry`: propagar imediatamente sem nova tentativa.                      |
| **BUG-27** | `server/routes/sdk/deps.js`                                | **LOW**                          | `getAllTools()` é chamado a cada invocação de rota sem cache. Em alta frequência, recalcula o array de tools desnecessariamente.                                                                                                                                                                                                                                                         | Adicionar memoização com invalidação por evento de registro/remoção de tool.                                       |
| **BUG-28** | `sdk/session/hook-bus.js` (re-exportado em `hooks/bus.js`) | **MEDIUM**                       | `defaultBus` é um singleton module-level compartilhado entre todas as instâncias de servidor. Múltiplas sessões compartilham o mesmo bus, causando cross-session event bleed.                                                                                                                                                                                                            | Injetar instância de `HookBus` por servidor/sessão via DI.                                                         |
| **BUG-29** | `hooks/composer.js:42`                                     | **LOW — PARCIALMENTE CORRIGIDO** | `composeHandlers` verificava a condição `result !== undefined && result !== null` — corrige early exit para `null`/`undefined`. `{}` vazio ainda requer campos de decisão (`permissionDecision`, `modifiedPrompt`, etc.) para encerrar a cadeia; comportamento com `{}` permanece ambíguo.                                                                                               | Verificar comportamento esperado para `{}` e documentar contrato explicitamente.                                   |
| **BUG-30** | `hooks/composer.js:80`                                     | **— CORRIGIDO**                  | ~~`pipeline` swallowava null signals.~~ A verificação `if (result && typeof result === 'object')` filtra `null` corretamente. Bug corrigido na versão atual.                                                                                                                                                                                                                             | N/A                                                                                                                |
| **BUG-31** | `hooks/audit-trail.js`                                     | **LOW**                          | Race condition entre `record()` e `toJSON()` sobre Array compartilhado. Snapshot pode incluir entrada parcialmente escrita.                                                                                                                                                                                                                                                              | Usar abordagem imutável (spread antes de retornar snapshot).                                                       |
| **BUG-32** | `hooks/tool-interceptor.js`                                | **LOW**                          | `createRuntimeDisableHook` não possui fallback para retorno `null` quando o check de disabled retorna inesperadamente.                                                                                                                                                                                                                                                                   | Adicionar fallback seguro com valor-padrão explícito.                                                              |
| **BUG-33** | `hooks/presets/audit.js`                                   | **MEDIUM**                       | O AuditPreset registra `onPreToolUse` como `permissionDecision: 'allow'` para todas as ferramentas, mesmo quando o permission handler real decidiu `'deny'`. O audit trail reporta acesso permitido a tools bloqueadas.                                                                                                                                                                  | Corrigir: registrar a decisão real (propagada pelo pipeline) em vez de `'allow'` hardcoded.                        |
| **BUG-34** | `hooks/index.js:10-29`                                     | **LOW**                          | A tabela de API pública do JSDoc está duplicada: linhas 10–19 são idênticas às linhas 21–29, com truncamento na segunda ocorrência (`                                                                                                                                                                                                                                                    | r,` em vez da linha completa). Documentação JSDoc confusa e inconsistente.                                         | Remover a segunda ocorrência (linhas 20–29), manter apenas uma tabela. |

---

## 4. Bugs de Integração SDK↔Tools

O projeto possui duas factories de tools com responsabilidades sobrepostas e lógica quase idêntica
de conversão Zod→JSON Schema, mantidas em sincronia manualmente:

```
sdk/tools/core.js (Fábrica SDK)
├── createTool() / createToolSync()
├── tryZodToJsonSchema()     ← conversão Zod v3/v4 → JSON Schema
├── loadZodToJsonSchema()    ← carrega zod-to-json-schema (CJS require)
├── defineToolSafe()         ← wrapper com fallback para mocks
└── wrappedHandler()         ← logging DEBUG básico (sessionId)

tools/tool-factory.js (Fábrica Tools)
├── buildTool()              ← wrapper de convenção do projeto
├── normalizeParameters()    ← mesma lógica Zod v3/v4→JSON Schema (DUPLICADA)
├── tryZodV4ToJsonSchema()   ← DUPLICADA de sdk/tools/core.js
├── makePlainTool()          ← fallback plain object (TDZ-safe)
└── wrappedHandler() + logToolFactory() ← CONFLITANTE com sdk/tools/core.js
```

| ID             | Severidade   | Descrição                                                                                                                                                                                                                                                                                                                                        | Arquivos                                                              | Correção Sugerida                                                                                                                |
| -------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **SDK-BUG-01** | **CRITICAL** | `tools/buildTool()` não usa `sdk/createTool()` internamente — usa `sdk/defineTool` diretamente. Cada tool passa por **dois layers de wrapping**: factory handler log (tool-factory) + SDK handler log (sdk/tools/core). Resultado: 2 entradas de log DEBUG e potencialmente 2 chamadas ao sistema de métricas por invocação.                     | `tools/tool-factory.js:193` × `sdk/tools/core.js:239`                 | Definir claramente qual layer é o único responsável por observabilidade antes de fundir as factories.                            |
| **SDK-BUG-02** | **HIGH**     | `sdk/tools/custom.js:351` usa `_buildTool ?? createToolSync`. `_buildTool` é injetado via `setCustomToolsBuilder()` em `observability/bootstrap.js:218`. Se `bootstrapLateDeps()` for chamado antes de `setToolsLogger/Metrics`, o builder terá dependências não-inicializadas. Ordem de bootstrap frágil e não documentada.                     | `sdk/tools/custom.js:351` × `observability/bootstrap.js:215-219`      | Documentar a ordem obrigatória de bootstrap; adicionar verificação de dependências no builder.                                   |
| **SDK-BUG-03** | **HIGH**     | `sdk/tools/registry.js:76` — `registerTool()` sobrescreve silenciosamente tools com mesmo nome (`Map.set`). A detecção de duplicatas em `bootstrap.js:150-160` ocorre **após** o registro. Se o registry for usado antes do bootstrap completar (ex: em testes), duplicatas passam despercebidas.                                                | `sdk/tools/registry.js:76`                                            | Adicionar warning no `registerTool()` quando key já existir.                                                                     |
| **SDK-BUG-04** | **HIGH**     | `sdk/tools/state.js:30` — `_toolsConfig` é module-level mutable state sem mecanismo de reset para testes (ao contrário de `custom.js` que tem `_resetRegistry()`). Testes que verificam policy de tools não conseguem isolar estado.                                                                                                             | `sdk/tools/state.js:30`                                               | Adicionar `_resetToolsConfig()` export para testes.                                                                              |
| **SDK-BUG-05** | **MEDIUM**   | `sdk/rpc/ops.js` executa `toolsHandlePendingCall` sobre o ToolRegistry sem documentar como o registry é sincronizado entre sessões. Tools podem vazar entre sessões se o registry for compartilhado.                                                                                                                                             | `sdk/rpc/ops.js:57` × `sdk/tools/registry.js`                         | Garantir registry isolado por sessão, ou documentar o modelo de compartilhamento explicitamente.                                 |
| **SDK-BUG-06** | **MEDIUM**   | Dois sistemas paralelos gerenciam "o usuário precisa fornecer input" (ver §11.3): `sdk/session/user-input.js` (moderno) e `tools/user-input-state.js` (legado via `hook-tools.js`). Um usuário respondendo via Path B não resolve pending input do Path A.                                                                                       | `sdk/session/user-input.js` × `tools/user-input-state.js`             | Depreciar Path A; delegar `request_user_input` ao `createQueuedInputHandler()` do SDK.                                           |
| **SDK-BUG-07** | **MEDIUM**   | `sdk/tools/custom.js:89-123` expõe valores de env vars via handler `env_read` enquanto `shell/sandbox.js` remove env vars sensíveis via `safeEnv()`. Inconsistência de security posture: o modelo pode obter um valor via `env_read` e tentar usá-lo em `exec_command`, mas o subprocesso não o verá. Comportamento correto mas não documentado. | `sdk/tools/custom.js:89` × `tools/shell/sandbox.js:213`               | Documentar escopo de cada mecanismo e a interação entre eles.                                                                    |
| **SDK-BUG-08** | **MEDIUM**   | `observability/tool-stats.js:97-118` — `wrapWithStats()` registra métrica de latência imediatamente ao completar o handler async. Para `request_user_input` (que retorna Promise suspensa até o usuário responder), a métrica de latência é enganosa: registra apenas o tempo de criação da Promise, não o tempo real decorrido.                 | `observability/tool-stats.js:108-110` × `tools/hook-tools.js:251-297` | Filtrar tools interativas do stats wrapping, ou registrar métricas após resolução real da Promise.                               |
| **SDK-BUG-09** | **MEDIUM**   | `sdk/tools/core.js:49-61` — `loadZodToJsonSchema()` usa `createRequire(import.meta.url)` para carregar `zod-to-json-schema`. Em ambientes ESM puros sem CJS interop, `requireFromHere` falha com `ERR_REQUIRE_ESM`. O catch é vazio — tools com Zod ficam sem JSON Schema silenciosamente.                                                       | `sdk/tools/core.js:49-61`                                             | Adicionar fallback para `import('zod-to-json-schema')` dinâmico antes de desistir.                                               |
| **SDK-BUG-10** | **LOW**      | `sdk/tools/core.js:141` — `tryZodToJsonSchema` verifica `'_def' in schema                                                                                                                                                                                                                                                                        |                                                                       | '_zod' in schema`. Objeto literal com propriedade `_def`(ex:`{ _def: 'test' }`) é falso-positivamente detectado como Zod schema. | `sdk/tools/core.js:141` | Verificação mais robusta: `schema instanceof z.ZodType` ou checar estrutura interna específica de Zod. |
| **SDK-BUG-11** | **MEDIUM**   | `sdk/tools/state.js:30` — `_toolsConfig` compartilhado. Se `patchToolsConfig` for chamado de dois lugares simultaneamente, há race condition no estado (last-write-wins sem atomicidade).                                                                                                                                                        | `sdk/tools/state.js:30`                                               | Usar mutex ou snapshot isolation para updates concorrentes.                                                                      |
| **SDK-BUG-12** | **HIGH**     | Não há heartbeat/health-check entre SDK e tools. Se um tool handler travar (ex: infinite loop em `exec_command`), o SDK não tem mecanismo de timeout ou circuit-breaker. O timeout advisory de 120s em `ADVISORY_TIMEOUT_MS` é puramente informativo.                                                                                            | `sdk/rpc/ops.js` (implícito)                                          | Implementar health-check periódico e circuit-breaker para chamadas de tools de longa duração.                                    |

---

## 5. Bugs de Observabilidade

| ID             | Severidade | Descrição                                                                                                                                                                                   | Status                |
| -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **OBS-BUG-01** | **MEDIUM** | `logToolFactory()` verifica `typeof log === 'function'` antes de usar logger injetado, mas cai para `console.*` se a verificação falhar. Logs durante cold-start podem ir para console raw. | Mitigado parcialmente |
| **OBS-BUG-02** | **HIGH**   | `wrapWithStats()` dupla: `observability/tool-stats.js` + `sdk/tools/core.js` acumulam logs e métricas para cada invocação de tool (duplo counting). Diretamente relacionado a SDK-BUG-01.   | Ativo                 |
| **OBS-BUG-03** | **MEDIUM** | `hooks/tool-interceptor.js` não chama `recordToolCall()` para decisões `deny`. Tools bloqueadas não aparecem nos dashboards de métricas, criando blind spot de segurança (ver SYS-GAP-04).  | Ativo                 |

Gaps de observabilidade adicionais:

| ID             | Severidade | Descrição                                                                                                                                                                                 | Status                          |
| -------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **OBS-GAP-01** | **MEDIUM** | `EventBus` não conectado a `HookBus` até bootstrap via `defaultHookBus.setEventBus(bus)` em `bootstrap.js:146`. Hooks disparados antes do bootstrap ficam sem propagação ao bus canônico. | Mitigado por ordem de bootstrap |
| **OBS-GAP-02** | **LOW**    | `defaultBus` singleton em `sdk/session/hook-bus.js` compartilhado cross-session (ver BUG-28). Eventos de hooks de uma sessão propagam para listeners de outra sessão.                     | Ativo                           |

---

## 6. Problemas de Segurança

| ID         | Arquivo                    | Severidade | Descrição                                                                                                                                                                                                                                                                                                                                                                                         | Correção Sugerida                                                                                                    |
| ---------- | -------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **SEC-01** | `shell/sandbox.js:214-254` | **HIGH**   | `safeEnv()` usa `_cache` como propriedade da própria função (`safeEnv._cache`) — frágil e corrompível por qualquer código com referência à função. Cache TTL de **1 segundo** é excessivamente agressivo: em workloads de alta frequência, reconstrução a cada segundo; durante reconstrução, todas as chamadas compartilham snapshot que pode incluir credenciais já removidas de `process.env`. | Mover cache para variável module-level privada; aumentar TTL para 5–10s ou invalidar por evento de mudança do env.   |
| **SEC-02** | `shell/sandbox.js:196-203` | **MEDIUM** | `checkCommandBlocklist` usa regex com `\b` e flags case-insensitive que podem sofrer ReDoS em inputs adversarialmente longos.                                                                                                                                                                                                                                                                     | Testar patterns contra inputs longos; considerar regex com atomic groups ou possessive quantifiers.                  |
| **SEC-03** | `hook-tools.js:245-252`    | **MEDIUM** | Limite de 5 requests pendentes simultâneos (`getPendingUserInputCount() >= 5`) verificado APÓS geração do `requestId`. Janela de race condition permite que dois requests criados em paralelo passem na checagem antes que o counter seja atualizado.                                                                                                                                             | Mover checagem de limite para antes da geração do requestId; ou usar lock/mutex para atomicidade.                    |
| **SEC-04** | `web-tools.js:198-202`     | **MEDIUM** | Parâmetros `maxBytes` e `timeoutMs` na tool `web_fetch_local` são documentados como "informativos" mas têm nomes que sugerem controle real. Usuário pode ser enganado achando que está protegendo contra consumo excessivo de recursos.                                                                                                                                                           | Renomear para `advisoryMaxBytes` e `advisoryTimeoutMs` (consistência com shell tools); ou implementar limites reais. |

---

## 7. Vazamentos de Estado e Encapsulamento

| ID         | Arquivo                        | Severidade | Descrição                                                                                                                                                                                                                                         | Correção Sugerida                                                                                    |
| ---------- | ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **ENC-01** | `introspection-tools.js:87`    | **HIGH**   | `_toolNameToMetadataMap` é exportado como `export const` de um `Map` mutável. Qualquer consumer pode chamar `_toolNameToMetadataMap.clear()` ou alterar entradas, corrompendo o estado interno de introspecção. O prefixo `_` é apenas convenção. | Remover export; expor apenas funções de acesso controlado (`getToolMetadata`, `recordToolCategory`). |
| **ENC-02** | `introspection-tools.js:42-80` | **HIGH**   | Cinco variáveis module-level mutáveis (`_registeredTools`, `_disabledTools`, `_CATEGORY_TOOL_MAP_DYNAMIC`, `_toolNameToMetadataMap`, `_toolContractReport`) compartilham escopo de módulo. Em ambiente multi-sessão, estados colidem.             | Encapsular em classe `IntrospectionRegistry` com instância injetável.                                |
| **ENC-03** | `todo/store.js:87`             | **HIGH**   | `_storeMutex` é uma promise encadeada module-level. Se `release()` nunca for chamado no `finally` (em caso de erro inesperado), todo o chain de mutex trava permanentemente (deadlock sem timeout de fallback).                                   | Adicionar timeout ao mutex: se `prev` não resolver em N segundos, force-release com log de warning.  |
| **ENC-04** | `user-input-state.js:15-18`    | **MEDIUM** | `_pendingInputResolvers` e `_pendingInputSeq` são module-level sem mecanismo de reset entre sessões. Agente parado e reiniciado no mesmo processo: IDs sequenciais continuam e resolvers antigos podem colidir.                                   | Adicionar `resetAll()` export chamada no stop do agente.                                             |
| **ENC-05** | `permission-tools.js:39-58`    | **MEDIUM** | `_agent` module-level comporta UMA única instância de agent. `setPermissionAgent` tem flag `force`, mas o padrão protege contra sobrescrita. Single point of failure para futuros cenários multi-agent.                                           | Documentar que apenas um agente é suportado; ou refatorar para map indexado por agent ID.            |

---

## 8. Inconsistências e Dívida Técnica

| ID         | Arquivos                                                                                                             | Severidade | Descrição                                                                                                                                                                                                                                                            | Correção Sugerida                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **INC-01** | `tool-factory.js`, `introspection-tools.js`, `session-tools.js`, `session-rpc-tools.js`, `experimental-rpc-tools.js` | **MEDIUM** | 5 arquivos usam `createTool` direto do SDK (~15 tools sem logging automático, sem conversão Zod, sem tratamento de factory errors), enquanto ~10 arquivos usam `buildTool` (~40 tools com observabilidade completa). Disparidade de comportamento e observabilidade. | Converter todas as tools para `buildTool`; verificar se divergências são legado ou intencionais. |
| **INC-02** | `todo/query-tools.js:14`                                                                                             | **LOW**    | Importa `zPriority` e `zStatus` de `./store.js` para uso em schemas de filtro. Esses schemas deveriam estar em `todo-schema.js`. Acoplamento desnecessário ao store.                                                                                                 | Mover `zPriority` e `zStatus` para `todo-schema.js`.                                             |
| **INC-03** | `web-tools.js:156-159`                                                                                               | **LOW**    | Parâmetros `maxBytes` e `timeoutMs` têm nomes que sugerem controle real mas são apenas informativos. `shell/index.js` usa o prefixo `advisory` explicitamente.                                                                                                       | Renomear para `advisoryMaxBytes` e `advisoryTimeoutMs`.                                          |
| **INC-04** | `todo/store.js:80-84`                                                                                                | **MEDIUM** | `_migrateJsonLegacy()` roda sincronamente no top-level do módulo durante import. Se `todos.json` for grande, `fs.readFileSync` + `JSON.parse` + loop de inserts bloqueará o event loop durante o boot.                                                               | Tornar assíncrona; ou usar batch com `setImmediate`.                                             |
| **INC-05** | `bootstrap.js:135`                                                                                                   | **LOW**    | `wrapWithStats` é aplicado a todas as tools após `getAllTools()`. Se uma tool falhar durante `wrapWithStats`, ela é silenciosamente removida do array instrumentado mas permanece registrada no registry — estado inconsistente.                                     | Adicionar try/catch individual com logging por tool durante instrumentation.                     |
| **INC-06** | `terminal/commands/sdk.js`, `terminal/commands/fs.js`                                                                | **MEDIUM** | Terminal commands importam `#copilot/tools` diretamente (`fileReadTools`, `fileWriteTools`), bypassando a abstração do agent em `agent/ports/tool-port.js`. Acoplamento direto que deve ser explicitamente documentado ou eliminado.                                 | Rotear acesso às tools via `tool-port.js`; ou documentar a exceção de forma explícita.           |

---

## 9. Gaps de Testabilidade

| ID          | Descrição                                                                                                                                       | Impacto                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **TEST-01** | 11+ variáveis module-level mutáveis precisam de funções de reset — presentes para algumas, ausentes para outras.                                | Testes de integração não conseguem isolar módulos sem monkey-patching. |
| **TEST-02** | `safeEnv()` usa `_cache` como propriedade de função — impossível de mockar sem `Object.defineProperty`.                                         | Testes de shell tools não conseguem controlar o ambiente sanitizado.   |
| **TEST-03** | `bootstrap()` orquestra 17 categorias de tools em uma única função sem granularidade. Testar falha de uma categoria requer executar todas.      | Boot test é frágil e lento.                                            |
| **TEST-04** | `todo/store.js` depende de SQLite real (`getCopilotDb()`). Não há abstração de storage para injeção de mock.                                    | Testes de todo tools requerem banco de dados real.                     |
| **TEST-05** | `getAllTools(registry)` em `bootstrap.js` ignora o parâmetro (BUG-01), tornando impossível testar a interação bootstrap↔registry via argumento. | Cobertura de bootstrap limitada.                                       |

---

## 10. Gaps Arquiteturais Sistêmicos

| ID             | Severidade | Descrição                                                                                                                                                                                                                                                                                        |
| -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SYS-GAP-01** | **HIGH**   | Falta de contrato formal via interface/protocolo entre SDK e Tools. O SDK define `Tool`, `ToolHandler`, `ToolRegistry` como types; as tools implementam ad-hoc. Sem validação em build-time. Bugs de tipo só são detectados em runtime.                                                          |
| **SYS-GAP-02** | **HIGH**   | Dois registries com funcionalidades sobrepostas: `sdk/tools/registry.js` (funcional, baseado em Map) e `tools/introspection-tools.js` (module-level state, derivado do registry). Modificações no registry Map não propagam automaticamente para a introspecção — estado stale.                  |
| **SYS-GAP-03** | **MEDIUM** | Nenhum mecanismo de versionamento de tools. Quando o SDK é atualizado, tools internas não podem declarar versão mínima do SDK ou compatibilidade. Atualizações podem quebrar tools silenciosamente.                                                                                              |
| **SYS-GAP-04** | **HIGH**   | Blind spot de observabilidade no interceptor: `tool-interceptor.js` bloqueia tools ANTES da execução com `permissionDecision: 'deny'`, mas `wrapWithStats()` nunca as contabiliza. Tentativas bloqueadas são invisíveis no dashboard de métricas — vetor de ataque de enumeração não detectável. |
| **SYS-GAP-05** | **LOW**    | Load path circular em testes: `tools/tool-factory.js` → `sdk/createTool` → `@github/copilot-sdk`. Mockar uma dessas dependências requer setup complexo com risco de TDZ errors.                                                                                                                  |
| **SYS-GAP-06** | **LOW**    | Sem health-check por domínio de tools. `get_system_health` é genérico — não verifica se o subsistema de filesystem tools está saudável, se o registry de custom tools está carregado, etc.                                                                                                       |
| **SYS-GAP-07** | **HIGH**   | Nenhum health-check granular por subsistema: não verifica "mutex do todo store íntegro?", "safeEnv cache funcional?", "registry de custom tools carregado?".                                                                                                                                     |
| **SYS-GAP-08** | **MEDIUM** | Sem circuit-breaker para hangs em tools internas. O SDK tem circuit-breaker para erros de rede mas não para hangs de tool handlers. `exec_command` travado não é detectado.                                                                                                                      |
| **SYS-GAP-09** | **LOW**    | Segurança fragmentada: `safeEnv()` (shell), `BLOCKED_PATTERNS_SECRETS` (file), allowlist de `env_read` (custom tools) e `checkCommandBlocklist` (shell) são implementações independentes sem coordenação central.                                                                                |
| **SYS-GAP-10** | **MEDIUM** | Sem versionamento semântico das tools. Quando o SDK atualiza, `buildCustomTools()` tenta instanciar todas — se uma API do SDK mudar, custom tools podem quebrar silenciosamente.                                                                                                                 |
| **SYS-GAP-11** | **HIGH**   | Terminal sem regras de limite de módulo. Nenhum ESLint `no-restricted-imports` ou equivalente. Qualquer arquivo do terminal pode importar de qualquer subsistema, degradando a arquitetura silenciosamente.                                                                                      |
| **SYS-GAP-12** | **HIGH**   | Event adapter coverage sem validação em build-time. Não há garantia de que todos os eventos do agent tenham tratamento no terminal. Eventos adicionados ao agent sem adapter correspondente são silenciosamente ignorados.                                                                       |
| **SYS-GAP-13** | **MEDIUM** | Dois sistemas paralelos de tradução de eventos no terminal (`sdk-session-events.js` e `agent-runtime-events.js`) sem camada de deduplication. Evento que cruza os dois sistemas pode ser processado duas vezes.                                                                                  |
| **SYS-GAP-14** | **HIGH**   | `active-tool-call-registry.js` é singleton module-level enquanto `tool-call-registry.js` é session-scoped. A convivência dos dois em produção subverte o design de isolamento por sessão.                                                                                                        |
| **SYS-GAP-15** | **MEDIUM** | MCP bridge não usa `buildTool()` (tool factory). MCP tools têm nível de observabilidade degradado em relação às tools internas — dois tiers de qualidade.                                                                                                                                        |
| **SYS-GAP-16** | **MEDIUM** | Event adapter coverage não verificado em CI. `listTerminalIgnoredAgentEvents()` existe mas não é invocado em nenhum teste automatizado.                                                                                                                                                          |

---

## 11. Análises Temáticas Profundas

### 11.1 As Duas Fábricas Paralelas

O projeto mantém **duas implementações quase idênticas** de normalização Zod→JSON Schema:

```
sdk/tools/core.js:tryZodToJsonSchema()
    1. Detecta Zod v4 (propriedade _zod) → tryZodV4ToJsonSchema()
    2. Fallback: CJS require('zod-to-json-schema')
    3. Fallback: schema.toJSONSchema() (Zod v4 nativo)

tools/tool-factory.js:normalizeParameters()
    1. Detecta Zod v4 (propriedade _zod) → tryZodV4ToJsonSchema() [DUPLICATA]
    2. Fallback: CJS require('zod-to-json-schema')
    3. Fallback: schema.toJSONSchema() (Zod v4 nativo)
```

Qualquer correção na lógica de conversão deve ser aplicada em dois lugares. A fusão é factível mas
requer resolver: (a) dependência circular entre SDK e tools; (b) TDZ em ESM; (c) `buildTool()`
adiciona lógica específica do projeto (`withSkipPermission`) que `createTool()` do SDK não tem.

**Inconsistências de nomenclatura entre SDK e Tools:**

| Aspecto         | Convenção SDK                                 | Convenção Tools                            | Conflito                                                    |
| --------------- | --------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| Nomes de tools  | `camelCase` (implícito)                       | `snake_case`                               | Sem enforcement                                             |
| Skip permission | `skipPermission` (propriedade direta)         | `withSkipPermission()` (wrapper)           | Dois mecanismos equivalentes                                |
| Error handling  | SDK lança exceções                            | Tools retornam `{ success: false, error }` | Mismatch — erros em tools podem não ser capturados pelo SDK |
| Parameters      | `Record<string, unknown>`                     | Zod schema ou plain object                 | Conversão duplicada                                         |
| Categorização   | `namespace.action` (ex: `shell.exec_command`) | `snake_case` flat (ex: `exec_command`)     | Categorização inconsistente em `tool-stats.js`              |

### 11.2 Fragmentação da Camada de Permissões

O sistema possui **cinco mecanismos independentes** de enforcement de permissões que não se
coordenam:

| #   | Mecanismo                     | Origem                                                                   | Escopo                                                                                          |
| --- | ----------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 1   | `tools/permission-tools.js`   | `_agent` via `setPermissionAgent()`                                      | Permissão baseada em agente                                                                     |
| 2   | `hooks/presets/production.js` | `createProductionHooks()` + `isToolDisabled`                             | Allow/deny lists + toggle runtime                                                               |
| 3   | `hooks/tool-interceptor.js`   | `createRuntimeDisableHook`, `createBlocklistHook`, `createAllowlistHook` | Interceptação de hooks                                                                          |
| 4   | `sdk/session/permissions.js`  | `createPermissionHandler()`                                              | Hierarquia estruturada (denyKinds → denyPatterns → denyTools → allowTools → allowAll → default) |
| 5   | `sdk/tools/agent-policy.js`   | `AgentToolPolicy` class                                                  | Per-agent allowlists + global allow/deny                                                        |

**Problemas:**

- Decisões contraditórias possíveis: tool permitida pelo mecanismo 3 pode ser bloqueada pelo 5 sem
  chain of authority definida.
- Auditoria fragmentada: cada mecanismo registra decisões em seu próprio log/sistema — sem audit
  trail unificado.
- Tools desabilitadas via `toggle_tool` são removidas de `_registeredTools` mas **permanecem** no
  `ToolRegistry` do SDK — bypass via RPC ainda as encontra.

**Correção recomendada:** Fundir em um único engine de políticas estendendo
`createPermissionHandler()` do SDK para receber decisões de `AgentToolPolicy` como pre-processor e
consultar `introspection-tools` para estado de toggle.

### 11.3 O Sistema Duplo de User-Input

Dois caminhos paralelos gerenciam o mesmo conceito:

**Path A — `tools/user-input-state.js` (legado)**

- `requestUserInput()` cria pending resolver em `_pendingInputResolvers`
- `resolveUserInput()` chamado de `tool-port.js:resolveAgentUserInput()`
- Auto-cleanup por timer hardcoded de 10 minutos
- Usado por `hook-tools.js:request_user_input`

**Path B — `sdk/session/user-input.js` (moderno)**

- `createQueuedInputHandler()` — fila com maxSize configurável
- `createReadlineInputHandler()` — readline de terminal
- `createStaticInputHandler()` — para testes
- Normaliza eventos via `normalizeUserInputRequestedEvent()` / `normalizeUserInputCompletedEvent()`
- Integrado ao lifecycle de sessão do SDK

**Incompatibilidades:** Usuário respondendo via Path B não resolve pending input do Path A. Path A
não normaliza eventos. Timeout de 10 min hardcoded sem configuração via SDK.

**Correção recomendada:** Depreciar Path A. `user-input-state.js` deve se tornar adapter fino para
compatibilidade reversa, delegando ao `createQueuedInputHandler()` do SDK.

### 11.4 O Blind Spot do tool-interceptor

`hooks/tool-interceptor.js` bloqueia tools ANTES da execução retornando
`{ permissionDecision: 'deny' }`. Consequências:

1. Tools bloqueadas nunca executam → `wrapWithStats()` nunca as registra
2. Não há contador de "tentativas bloqueadas"
3. Atacante pode enumerar tools observando padrão de sucesso vs. deny — **blind spot de segurança
   invisível no dashboard**
4. Tools desabilitadas em runtime ainda aparecem em `list_tools` (introspecção mostra todas as
   registradas)

**Correção recomendada:** Adicionar `recordBlockedToolCall()` em `observability/tool-stats.js` e
chamar do interceptor em decisões deny.

### 11.5 Conflito de Logging (Três Fontes)

| Fonte                              | Mecanismo                    | Fallback                                                 |
| ---------------------------------- | ---------------------------- | -------------------------------------------------------- |
| `tools/logger.js`                  | Proxy via `setToolsLogger()` | `console.*`                                              |
| `sdk/logger.js`                    | Proxy via `setSdkLogger()`   | Apenas `console.warn/console.error` (suprime INFO/DEBUG) |
| `tool-factory.js:logToolFactory()` | `console.*` direto           | — (sem logger injetado)                                  |

`logToolFactory()` ignora `tools/logger.js` e `sdk/logger.js`. Logs da factory durante cold-start
vão para console raw sem rotação de nível consistente nem integração com observabilidade.

### 11.6 Conflito de Métricas (Dois Sistemas)

| Sistema     | Arquivo                       | Função                                                     |
| ----------- | ----------------------------- | ---------------------------------------------------------- |
| SDK-level   | `observability/tool-stats.js` | `wrapWithStats()` — rastreia latência/erros                |
| Tools-level | `tools/metrics-proxy.js`      | `recordToolCall()` — proxy para `observability/metrics.js` |

As mesmas tools são rastreadas nos dois sistemas com granularidades diferentes. A categorização
também é inconsistente: `tool-stats.js:136-141` usa `name.split('.')[0]` para inferir categoria, mas
tools registradas via introspecção usam `snake_case` flat (ex: `git_status` em vez de `git.status`).

### 11.7 Terminal Bypassa a Abstração do Agent

`terminal/commands/sdk.js` e `terminal/commands/fs.js` importam diretamente de `#copilot/tools`,
usando `findTool()` e `getToolHandler()` sobre as arrays de tools, em vez de usar
`agent/ports/tool-port.js`. Isso quebra a abstração pretendida:

```javascript
// Padrão atual (incorreto arquiteturalmente)
const tool = findTool(fileReadTools, '/read/file');
const handler = getToolHandler(tool);
return handler(args, invocation);

// Padrão correto
return toolPort.executeFileTool('/read/file', args, invocation);
```

---

## 12. Situação Atual vs. Situação Ideal

| Aspecto                          | Situação Atual                                          | Situação Ideal                                                               |
| -------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Estrutura de módulos**         | 1 diretório monolítico com 12+ subdomínios sem limites  | Domínios separados com limites explícitos via ESLint                         |
| **Gestão de estado**             | Module-level singletons (11+ variáveis globais)         | Instâncias injetáveis com lifecycle explícito                                |
| **Factory**                      | God Object (345 linhas, 5+ responsabilidades)           | Factory + validadores + utilidades separados; uma factory canônica           |
| **File tools**                   | 8 arquivos, 28+ tools em 1 namespace                    | 3 submódulos: `io/`, `search/`, `scope/`                                     |
| **Todo tools**                   | `store.js` mistura domínio + persistência + agendamento | `domain.js` (domínio puro) + `repository.js` (persistência) + `scheduler.js` |
| **Injeção de dependência**       | Convenção informal `setXxx()`                           | Container DI explícito com interfaces formais                                |
| **Testabilidade**                | ~40% (requer monkey-patching)                           | Injeção limpa, mocks naturais                                                |
| **Limites de módulo**            | Não definidos                                           | `no-restricted-imports` ESLint + madge CI                                    |
| **Consistência de factory**      | Mix `createTool`/`buildTool`                            | `buildTool` padrão universal                                                 |
| **Permissões**                   | 5 mecanismos independentes                              | 1 engine unificado com audit trail central                                   |
| **User-input**                   | 2 sistemas paralelos incompatíveis                      | 1 sistema (SDK moderno) com adapter legado                                   |
| **Métricas**                     | Duplo counting (2 sistemas)                             | 1 sistema com layer bem-definido                                             |
| **Observabilidade de bloqueios** | Blind spot total                                        | `recordBlockedToolCall()` com dashboard                                      |

---

## 13. Roadmap de Evolução

### Fase 1 — Estabilização Crítica (Semanas 1–2)

Objetivo: Corrigir bugs P0 e P1 sem mudar a estrutura de diretórios.

| Ação                                                                             | Bugs Resolvidos        | Esforço |
| -------------------------------------------------------------------------------- | ---------------------- | ------- |
| Corrigir `getAllTools(registry)` — aceitar parâmetro ou remover argumento        | BUG-01                 | Baixo   |
| Aplicar limites concretos em `file/shared.js` (5MB content, 1M search, 10K list) | BUG-04, BUG-10         | Médio   |
| Corrigir `resolveRpcTimeoutMs()` — remover código morto ou implementar           | BUG-02                 | Baixo   |
| Corrigir deadlock potencial no mutex de `todo/store.js` (timeout de fallback)    | ENC-03                 | Médio   |
| Corrigir memory leak de promises pendentes no shutdown                           | BUG-11                 | Médio   |
| Adicionar `no-restricted-imports` ESLint para `tools/` → `infra/*` e `db/*`      | SYS-GAP-01             | Baixo   |
| Adicionar `recordBlockedToolCall()` no interceptor                               | SYS-GAP-04, OBS-BUG-03 | Médio   |
| Encapsular circuit breaker do MCP bridge em classe                               | BUG-24                 | Médio   |
| Corrigir race condition no `autoCleanupTimer` de `hook-tools.js`                 | BUG-06                 | Médio   |
| Corrigir `safeEnv()` cache frágil — variável privada + TTL razoável              | SEC-01                 | Baixo   |

### Fase 2 — Reestruturação de Domínios (Semanas 3–6)

Objetivo: Separar `file/` e `todo/` em submódulos coesos; padronizar factory.

| Ação                                                                    | Bugs Resolvidos     | Esforço                  |
| ----------------------------------------------------------------------- | ------------------- | ------------------------ |
| Criar `tools/file/io/`, `tools/file/search/`, `tools/file/scope/`       | Problema 1          | Baixo (move de arquivos) |
| Extrair `todo/domain.js` (lógica de domínio pura)                       | Problema 2, INC-04  | Médio                    |
| Extrair `todo/repository.js` (SQLite, migração, `withStore`)            | Problema 2, TEST-04 | Médio                    |
| Criar `todo/scheduler.js` (cleanup job)                                 | Problema 2          | Baixo                    |
| Padronizar `buildTool()` universalmente (converter `createTool` direto) | INC-01, SDK-BUG-01  | Médio                    |
| Depreciar Path A de user-input; delegar ao SDK moderno                  | SDK-BUG-06          | Médio                    |
| Fundir 5 mecanismos de permissão em engine unificado                    | §11.2               | Alto                     |
| Corrigir `logToolFactory()` para usar logger injetado                   | BUG-09, OBS-BUG-01  | Baixo                    |

### Fase 3 — DI Formal (Semanas 7–8)

Objetivo: Substituir singletons por injeção explícita.

| Ação                                                                                 | Bugs Resolvidos    | Esforço |
| ------------------------------------------------------------------------------------ | ------------------ | ------- |
| Criar `tools/container.js` — factory que instancia cada submódulo com deps injetadas | Problemas 3, 7     | Alto    |
| Migrar todos os `setXxx()` para uso do container                                     | ENC-01 a ENC-05    | Alto    |
| Introduzir interfaces TypeScript (`@typedef` JSDoc) para todos os contratos          | SYS-GAP-01         | Médio   |
| Refatorar `introspection-tools.js` para receber registry via injeção                 | ENC-02             | Médio   |
| Converter `active-tool-call-registry` para session-scoped                            | BUG-19, SYS-GAP-14 | Médio   |
| Injetar instância de `HookBus` por servidor/sessão                                   | BUG-28, OBS-GAP-02 | Médio   |

### Fase 4 — Observabilidade & Contratos (Semanas 9–10)

| Ação                                                               | Bugs Resolvidos        | Esforço |
| ------------------------------------------------------------------ | ---------------------- | ------- |
| Gerar JSON Schema formal para cada tool                            | SYS-GAP-01             | Alto    |
| Adicionar health-check granular por subsistema                     | SYS-GAP-07             | Baixo   |
| Implementar rate-limiting real (token bucket) para web-tools       | SEC-04                 | Médio   |
| Dashboard de dependências automático (import-linter + madge) em CI | SYS-GAP-11             | Baixo   |
| Adicionar teste CI que verifica cobertura de event adapters        | SYS-GAP-12, SYS-GAP-16 | Baixo   |
| Implementar circuit-breaker real para tool handlers                | SYS-GAP-08, SDK-BUG-12 | Médio   |

---

## 14. Registros de Decisões Arquiteturais (ADRs)

### ADR-001 — Duas Fábricas de Tools

**Contexto:** O projeto tem `tools/tool-factory.js` e `sdk/tools/core.js`, ambas implementando
normalização Zod→JSON Schema, logging e fallback.

**Decisão:** Manter as duas separadas inicialmente. A fusão requer resolver: (a) dependência
circular SDK↔tools, (b) TDZ em ESM, (c) `buildTool()` adiciona lógica específica do projeto
(`withSkipPermission`) que `createTool()` do SDK não tem.

**Consequência:** Correções na lógica de conversão devem ser aplicadas em dois lugares. Risco de
divergência permanente.

**Reversibilidade:** Média. A fusão pode ser feita movendo toda a lógica para `sdk/tools/core.js` e
fazendo `tools/buildTool` ser um thin wrapper.

### ADR-002 — Module-Level State em vez de DI Container

**Contexto:** `_session`, `_rpc`, `_agent` e outras variáveis module-level são o padrão dominante em
vez de constructor injection.

**Decisão:** Manter o padrão atual. Constructor injection é incompatível com as constraints do
runtime ESM do SDK, onde module evaluation order é não-determinístico (TDZ).

**Consequência:** Testes requerem monkey-patching. Race conditions possíveis em cenários
multi-sessão.

**Reversibilidade:** Baixa. Os DI tokens (`di-tokens.js`) já existem como passo intermediário — a
injeção real ainda é feita via setters.

### ADR-003 — Interceptação de Hooks Fora de `tools/`

**Contexto:** `hooks/tool-interceptor.js` implementa `onPreToolUse`/`onPostToolUse` hooks em
`src/copilot/hooks/`, não em `src/copilot/tools/`.

**Decisão:** Manter separação. Hooks são compostos independentemente das tools
(`createProductionHooks()`, `createHooks()`), enquanto tools podem ser registradas sem conhecimento
do sistema de hooks.

**Consequência:** Duas fontes de verdade sobre permissões. O blind spot de observabilidade
(SYS-GAP-04) é consequência direta desta separação.

**Reversibilidade:** Média. Mover lógica de interceptação para dentro de `tools/` quebraria a
composição de hooks que dependem de `hooks/bus.js`.

---

## 15. Priorização Consolidada

_Legenda: 🔴 P0 (crítico/imediato) — 🟠 P1 (alto/sprint dedicado) — 🟡 P2 (médio/backlog priorizado)
— 🟢 P3 (baixo/melhoria contínua)_

| #   | Prioridade | ID              | Item                                                                    | Esforço | Impacto                                     |
| --- | ---------- | --------------- | ----------------------------------------------------------------------- | ------- | ------------------------------------------- |
| 1   | 🔴 P0      | BUG-01          | `getAllTools(registry)` ignora parâmetro — contrato quebrado            | Baixo   | Tools dinâmicas perdidas silenciosamente    |
| 2   | 🔴 P0      | BUG-04 / BUG-10 | Limites `Infinity` → OOM no `read_file_content`                         | Médio   | Produção down com arquivos grandes          |
| 3   | 🔴 P0      | SDK-BUG-01      | Double-wrapping logging/metrics entre as duas factories                 | Médio   | Dados de observabilidade incorretos         |
| 4   | 🔴 P0      | BUG-02          | `resolveRpcTimeoutMs()` é código morto — timeouts RPC inoperantes       | Baixo   | Timeouts RPC completamente ignorados        |
| 5   | 🔴 P0      | BUG-24          | MCP circuit breaker: state mutable module-level                         | Médio   | Corrupção de estado em concorrência         |
| 6   | 🟠 P1      | SEC-01          | `safeEnv()` cache frágil + TTL 1s                                       | Baixo   | Credenciais expostas entre reconstruções    |
| 7   | 🟠 P1      | ENC-03          | Deadlock potencial no mutex do todo store                               | Médio   | Agente trava permanentemente                |
| 8   | 🟠 P1      | BUG-11          | Memory leak em promises pendentes no shutdown                           | Médio   | Vazamento de memória acumulativo            |
| 9   | 🟠 P1      | BUG-03          | Fallback no factory sem normalização Zod                                | Médio   | Tools quebram no cold start                 |
| 10  | 🟠 P1      | SYS-GAP-01      | Sem contrato formal SDK↔Tools                                           | Médio   | Bugs de tipo em runtime                     |
| 11  | 🟠 P1      | SYS-GAP-04      | Blind spot: bloqueios não rastreados em métricas                        | Médio   | Ataques de enumeração invisíveis            |
| 12  | 🟠 P1      | SYS-GAP-02      | Dois registries desatualizados (registry Map vs introspecção)           | Médio   | Introspecção mostra estado stale            |
| 13  | 🟠 P1      | BUG-12          | `production.js` importa `isToolDisabled` diretamente — stale reference  | Médio   | Stale reference em testes e reloads         |
| 14  | 🟠 P1      | SYS-GAP-14      | `active-tool-call-registry` singleton vs session-scoped                 | Médio   | Vazamento cross-session                     |
| 15  | 🟠 P1      | SYS-GAP-11      | Terminal sem limites de módulo (nenhuma ESLint rule)                    | Médio   | Degradação arquitetural livre               |
| 16  | 🟠 P1      | SYS-GAP-12      | Event adapter coverage sem validação build-time                         | Médio   | Eventos silenciosamente ignorados           |
| 17  | 🟠 P1      | BUG-25          | MCP tools sem `buildTool` wrapper (observabilidade degradada)           | Médio   | Dois tiers de qualidade de tools            |
| 18  | 🟠 P1      | BUG-33          | Audit preset registra "allow" para hooks denied                         | Médio   | Auditoria enganosa                          |
| 19  | 🟠 P1      | SDK-BUG-12      | Sem circuit-breaker para hangs em tools                                 | Médio   | Tools podem travar indefinidamente          |
| 20  | 🟠 P1      | SDK-BUG-02      | Ordem de bootstrap frágil para custom tools builder                     | Médio   | Custom tools inicializam sem logger/metrics |
| 21  | 🟠 P1      | SDK-BUG-03      | `registerTool()` sobrescreve silenciosamente duplicatas                 | Médio   | Sem detecção de duplicatas em testes        |
| 22  | 🟠 P1      | SDK-BUG-04      | `_toolsConfig` sem mecanismo de reset para testes                       | Baixo   | Isolamento de testes comprometido           |
| 23  | 🟠 P1      | OBS-BUG-02      | Double-wrapping de métricas entre as duas factories                     | Médio   | Double counting de métricas                 |
| 24  | 🟡 P2      | INC-01          | Padronizar `buildTool` universalmente                                   | Médio   | Observabilidade inconsistente               |
| 25  | 🟡 P2      | SYS-GAP-05      | Sem versionamento semântico das tools                                   | Baixo   | Quebras silenciosas em updates SDK          |
| 26  | 🟡 P2      | BUG-13          | `custom.js` persiste `handlerId` inválido                               | Médio   | Custom tools falham em build                |
| 27  | 🟡 P2      | BUG-15          | Shallow copy em `state.js` — corrupção de estado                        | Baixo   | Arrays mutáveis compartilhados              |
| 28  | 🟡 P2      | BUG-07          | JSON parse sem try/catch específico (DDG fallback)                      | Baixo   | Erro genérico sem informação diagnóstica    |
| 29  | 🟡 P2      | TEST-04         | Abstrair storage do todo store para injeção de mock                     | Médio   | Testabilidade                               |
| 30  | 🟡 P2      | SYS-GAP-13      | Dois sistemas paralelos de eventos no terminal                          | Baixo   | Duplicação de lógica de tradução            |
| 31  | 🟡 P2      | SYS-GAP-15      | MCP bridge não usa `buildTool` — dois tiers de tools                    | Médio   | Inconsistência de qualidade                 |
| 32  | 🟡 P2      | SYS-GAP-16      | Event adapter coverage não testado em CI                                | Baixo   | Cobertura não verificada                    |
| 33  | 🟡 P2      | INC-06          | Terminal bypassa agent facade para acessar tools                        | Médio   | Acoplamento direto                          |
| 34  | 🟡 P2      | SDK-BUG-05      | ToolRegistry compartilhado entre sessões sem documentação               | Médio   | Ferramentas podem vazar entre sessões       |
| 35  | 🟡 P2      | SDK-BUG-06      | Dois sistemas paralelos de user-input incompatíveis                     | Médio   | Respostas perdidas entre os dois paths      |
| 36  | 🟡 P2      | SDK-BUG-09      | `loadZodToJsonSchema()` usa CJS require — falha em ESM puro             | Baixo   | Tools com Zod ficam sem JSON Schema         |
| 37  | 🟡 P2      | SDK-BUG-11      | Race condition em `_toolsConfig` concorrente                            | Baixo   | Corrupção de estado                         |
| 38  | 🟡 P2      | INC-04          | Migração `_migrateJsonLegacy()` síncrona e bloqueante                   | Baixo   | Boot lento com arquivos grandes             |
| 39  | 🟡 P2      | BUG-20          | `sdk-session-events.js` 1103 linhas — God Object                        | Médio   | Manutenção e teste prejudicados             |
| 40  | 🟡 P2      | BUG-21          | `agent-runtime-events.js` 691 linhas — God Object                       | Médio   | Manutenção e teste prejudicados             |
| 41  | 🟢 P3      | SEC-02          | `checkCommandBlocklist` regex — risco de ReDoS                          | Baixo   | Edge case adversarial                       |
| 42  | 🟢 P3      | SEC-03          | Race no limite de requests de user-input                                | Baixo   | Edge case raro                              |
| 43  | 🟢 P3      | SEC-04          | Parâmetros advisory mal nomeados em `web-tools`                         | Baixo   | Confusão do usuário                         |
| 44  | 🟢 P3      | BUG-08          | Timeout git apenas advisory — comandos podem travar                     | Baixo   | Repos gigantes                              |
| 45  | 🟢 P3      | BUG-14          | `normalizeAgentToolList` não filtra null                                | Baixo   | Entrada fantasma em Set                     |
| 46  | 🟢 P3      | BUG-16          | Race condition em `answerNext()`                                        | Baixo   | Double-consume assíncrono                   |
| 47  | 🟢 P3      | BUG-17          | `generateId()` usa `Math.random()`                                      | Baixo   | Colisão remota de IDs de todo               |
| 48  | 🟢 P3      | BUG-22          | `io-activity-events.js` sem tratamento de erro                          | Baixo   | Falhas silenciosas no listener              |
| 49  | 🟢 P3      | BUG-23          | Acoplamento forte em `terminal-agent-wiring.js`                         | Baixo   | Fragilidade a mudanças no agent             |
| 50  | 🟢 P3      | BUG-26          | AbortSignal + withRetry interação defeituosa                            | Baixo   | Erro engolido em retry                      |
| 51  | 🟢 P3      | BUG-27          | `getAllTools()` sem cache em `deps.js`                                  | Baixo   | Recomputação por request HTTP               |
| 52  | 🟢 P3      | BUG-28          | `defaultBus` singleton cross-session                                    | Baixo   | Event bleed entre sessões                   |
| 53  | 🟢 P3      | BUG-29          | `composeHandlers` — semântica de `{}` ambígua (parcialmente corrigido)  | Baixo   | Verificar e documentar contrato             |
| 54  | 🟢 P3      | BUG-31          | `AuditTrail` race condition read/write                                  | Baixo   | Snapshot potencialmente corrompido          |
| 55  | 🟢 P3      | BUG-32          | `createRuntimeDisableHook` sem fallback null                            | Baixo   | Crash se null inesperado                    |
| 56  | 🟢 P3      | BUG-34          | `hooks/index.js` JSDoc duplicado                                        | Baixo   | Documentação confusa                        |
| 57  | 🟢 P3      | INC-02          | `zPriority`/`zStatus` em `store.js` em vez de `todo-schema.js`          | Baixo   | Acoplamento desnecessário                   |
| 58  | 🟢 P3      | INC-03          | `maxBytes`/`timeoutMs` sem prefixo `advisory`                           | Baixo   | Inconsistência de nomenclatura              |
| 59  | 🟢 P3      | INC-05          | `wrapWithStats` sem try/catch individual por tool                       | Baixo   | Falha silenciosa de instrumentação          |
| 60  | 🟢 P3      | SDK-BUG-07      | Inconsistência de security posture entre `env_read` e `safeEnv`         | Baixo   | Comportamento não documentado               |
| 61  | 🟢 P3      | SDK-BUG-08      | Métrica de latência enganosa para `request_user_input`                  | Baixo   | Latência reportada incorretamente           |
| 62  | 🟢 P3      | SDK-BUG-10      | Falso positivo na detecção de Zod (propriedade `_def`)                  | Baixo   | Erro silencioso de conversão                |
| 63  | 🟢 P3      | SYS-GAP-03      | Sem versionamento de compatibilidade de tools com SDK                   | Baixo   | Quebras silenciosas em updates              |
| 64  | 🟢 P3      | SYS-GAP-06      | Sem health-check por domínio de tools                                   | Baixo   | Diagnóstico manual                          |
| 65  | 🟢 P3      | SYS-GAP-07      | Sem health-check granular por subsistema                                | Baixo   | Diagnóstico manual                          |
| 66  | 🟢 P3      | SYS-GAP-08      | Sem circuit-breaker para hangs em tools internas                        | Baixo   | Tools podem travar indefinidamente          |
| 67  | 🟢 P3      | SYS-GAP-09      | Segurança fragmentada (safeEnv, BLOCKED_PATTERNS, allowlist, blocklist) | Baixo   | Inconsistência defensiva                    |
| 68  | 🟢 P3      | SYS-GAP-10      | Sem versionamento semântico das tools para o SDK                        | Baixo   | Quebras silenciosas                         |
| 69  | 🟢 P3      | OBS-BUG-01      | `logToolFactory()` cai para `console.*`                                 | Baixo   | Logs perdidos durante cold-start            |
| 70  | 🟢 P3      | OBS-GAP-01      | EventBus desconectado de HookBus até bootstrap                          | Baixo   | Mitigado por ordem de bootstrap             |
| 71  | 🟢 P3      | OBS-GAP-02      | `defaultBus` singleton causa event bleed cross-session                  | Baixo   | Relacionado a BUG-28                        |

---

## 16. Métricas do Módulo

### 16.1 `src/copilot/tools/` (Escopo Primário)

| Métrica                                        | Valor                                                                                                                      |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Arquivos totais                                | 32                                                                                                                         |
| Tools registradas                              | ~55                                                                                                                        |
| Subdomínios funcionais                         | 14 (task, code, git, session, session-rpc, hook, hub, introspection, file, shell, web, todo, permission, experimental-rpc) |
| Imports `#copilot/*` (cross-boundary)          | 38 referências                                                                                                             |
| Imports `node:*`                               | 12 arquivos                                                                                                                |
| Variáveis module-level mutáveis                | 11+                                                                                                                        |
| Tools usando `createTool` direto (sem factory) | ~5 arquivos, ~15 tools                                                                                                     |
| Tools usando `buildTool` (com factory)         | ~10 arquivos, ~40 tools                                                                                                    |
| Linhas totais                                  | ~2.800                                                                                                                     |
| Cobertura JSDoc                                | ~85% (parcial nos handlers)                                                                                                |
| Testabilidade estimada                         | ~40% (requer monkey-patching)                                                                                              |

### 16.2 Métricas de Acoplamento (`tools/`)

| Métrica                                                    | Valor                       | Avaliação             |
| ---------------------------------------------------------- | --------------------------- | --------------------- |
| Fan-out médio por arquivo                                  | 4.2 imports externos        | Moderado              |
| Fan-in máximo                                              | `bootstrap.js` (12 imports) | Alto ⚠️               |
| Arquivos com >5 imports externos                           | 8                           | ⚠️                    |
| Módulos `#copilot/infra` acessados diretamente de `tools/` | 6 violações                 | ⚠️ Violação de camada |
| Estado global mutável (module-level)                       | 11 variáveis                | Alto ⚠️               |

### 16.3 Escopo Total da Auditoria

| Módulo                       | Arquivos Analisados                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/copilot/tools/`         | 32                                                                                             |
| `src/copilot/sdk/`           | ~20                                                                                            |
| `src/copilot/terminal/`      | ~103                                                                                           |
| `src/copilot/hooks/`         | ~15                                                                                            |
| `src/copilot/observability/` | ~30                                                                                            |
| `src/copilot/core/`          | 8 (~2.070 linhas: di, error-handlers, mutex, circuit-breaker, event-bus, shutdown, interfaces) |
| **Total**                    | **~210+**                                                                                      |

### 16.4 Resumo de Itens por Categoria

| Categoria              | Sigla   | Total Ativo                            | P0  | P1  | P2  | P3  |
| ---------------------- | ------- | -------------------------------------- | --- | --- | --- | --- |
| Bugs funcionais        | BUG     | 33 (BUG-35 removido; BUG-30 corrigido) | 5   | 13  | 8   | 7   |
| Bugs SDK↔Tools         | SDK-BUG | 12                                     | 1   | 5   | 4   | 2   |
| Bugs observabilidade   | OBS-BUG | 3                                      | —   | 1   | 1   | 1   |
| Problemas de segurança | SEC     | 4                                      | —   | —   | —   | 4   |
| Encapsulamento         | ENC     | 5                                      | —   | 3   | 2   | —   |
| Inconsistências        | INC     | 6                                      | —   | —   | 4   | 2   |
| Gaps sistêmicos        | SYS-GAP | 16                                     | —   | 7   | 5   | 4   |
| Gaps observabilidade   | OBS-GAP | 2                                      | —   | —   | —   | 2   |
| Gaps testabilidade     | TEST    | 5                                      | —   | —   | 5   | —   |

---

## Riscos e Dependências

| Risco                                                       | Probabilidade | Impacto | Mitigação                                       |
| ----------------------------------------------------------- | ------------- | ------- | ----------------------------------------------- |
| Quebra de backward compatibility ao renomear paths          | Alta          | Alto    | Manter barrels de compatibilidade por 2 versões |
| Feature flags do SDK bloquearem `experimental-rpc-tools`    | Média         | Médio   | Fallback graceful já implementado via `wrapExp` |
| Race conditions em module-level state com múltiplas sessões | Média         | Alto    | Fase 3 (DI formal) resolve                      |
| Regressão de segurança ao mover arquivos de `file/`         | Baixa         | Alto    | Testes de regressão + lint CI                   |
| Divergência permanente entre as duas factories              | Alta          | Médio   | Fusão planejada para Fase 2                     |

---

_Documento canônico consolidado gerado em 2026-05-10._ _Inclui análise completa de Fase 1 (tools +
SDK) e Fase 2 (terminal, hooks, events, bridges, observability, core)._ _BUG-30 CORRIGIDO na versão
atual do código. BUG-35 NÃO REPRODUZIDO (removido). BUG-29 PARCIALMENTE CORRIGIDO._ _Auditor: Kilo
(automated) — Repositório: chatgpt-docker-puppeteer_
