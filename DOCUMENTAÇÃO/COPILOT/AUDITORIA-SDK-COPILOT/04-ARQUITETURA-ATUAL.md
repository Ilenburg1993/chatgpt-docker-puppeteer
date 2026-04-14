# 04 — Arquitetura Atual: `src/copilot`

**Data**: 2026-03-21 | **Revisado**: 2026-03-21
**Status**: Versão Definitiva (pós revisão crítica)

---

## 1. Visão Geral

O `src/copilot/` é um sistema de ~180 arquivos JS (ESM) que envelopa o `@github/copilot-sdk` para:
1. Orquestrar sessões de IA com controle granular
2. Expor funcionalidades via REST API + SSE
3. Manter um loop de agente always-alive com dialog loop, recovery e multi-sessão
4. Integrar com MCP servers, tools customizadas e hooks de segurança

### Organização em Camadas

```
┌─────────────────────────────────────────────────────────────────┐
│                        CAMADA 5 — API                          │
│  server/routes/  ·  server/sse/  ·  terminal/repl              │
│  Exposição HTTP, SSE, REPL interativo                          │
├─────────────────────────────────────────────────────────────────┤
│                     CAMADA 4 — ORQUESTRAÇÃO                    │
│  conversation-hub/  ·  agent/always-alive.js                   │
│  Multi-sessão, lifecycle do agente, dialog loop                │
├─────────────────────────────────────────────────────────────────┤
│                     CAMADA 3 — HOOKS + SECURITY                │
│  hooks/factory.js  ·  hooks/bus.js  ·  hooks/presets/          │
│  Permission pipeline, tool filtering, audit, error recovery    │
├─────────────────────────────────────────────────────────────────┤
│                    CAMADA 2 — TOOLS + BRIDGES                  │
│  tools/  ·  bridges/mcp  ·  bridges/github                    │
│  Tool definitions, MCP bridge, GH integration                  │
├─────────────────────────────────────────────────────────────────┤
│                     CAMADA 1 — SDK WRAPPER                     │
│  sdk/session/  ·  sdk/rpc/  ·  sdk/agent/  ·  sdk/types       │
│  Abstrações tipadas sobre CopilotClient + CopilotSession       │
├─────────────────────────────────────────────────────────────────┤
│                     CAMADA 0 — SDK NATIVO                      │
│  @github/copilot-sdk (node_modules)                            │
│  CopilotClient, CopilotSession, RPC, Types                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Módulos Detalhados

### 2.1 `sdk/` — Camada 1 (SDK Wrapper)

| Submódulo                       | Arquivos | Responsabilidade                                              |
| ------------------------------- | -------- | ------------------------------------------------------------- |
| `sdk/types.js`                  | 1        | Typedefs centralizados, re-exports de SDK types               |
| `sdk/constants.js`              | 1        | 100+ constantes: events, modes, reasoning, etc.               |
| `sdk/session/client.js`         | 1        | Singleton `CopilotClient` + registry de sessões               |
| `sdk/session/lifecycle.js`      | 1        | `createSession()`, `resumeSession()`, `resumeOrCreate()`      |
| `sdk/session/client-events.js`  | 1        | Lifecycle events tipados (`client.on()`)                      |
| `sdk/session/events.js`         | 1        | Session events tipados (`session.on()`)                       |
| `sdk/session/wrapper.js`        | 1        | `abortSession()`, wrappers utilitários                        |
| `sdk/session/system-message.js` | 1        | Builder de SystemMessageConfig (append/replace/customize)     |
| `sdk/session/permissions.js`    | 1        | `approveAll` + PermissionHandler factory                      |
| `sdk/session/provider.js`       | 1        | BYOK provider config (OpenAI, Azure, Anthropic)               |
| `sdk/session/client-facade.js`  | 1        | Facade simplificada para operações client                     |
| `sdk/rpc/ops.js`                | 1        | 20+ funções RPC individuais (model, mode, plan, workspace...) |
| `sdk/rpc/session.js`            | 1        | `createSessionRpcFacade()` — facade organizada por namespace  |
| `sdk/rpc/server.js`             | 1        | Server-scoped RPC wrappers                                    |
| `sdk/rpc/experimental.js`       | 1        | 19 funções para namespaces experimentais                      |
| `sdk/agent/agents.js`           | 1        | Factory de `CustomAgentConfig` + helpers                      |
| `sdk/tools/core.js`             | 1        | `createTool()` factory                                        |
| `sdk/tools/registry.js`         | 1        | `createRegistry()`                                            |
| `sdk/index.js`                  | 1        | Barrel (12 bandas temáticas)                                  |

**Pontos fortes**: Boa abstração. Tipagem JSDoc completa. Separação clara entre estável e experimental.
**Pontos fracos**: RPC experimental sem exposição. `lifecycle.js` usa `Record<string,unknown>` que anula tipagem.

### 2.2 `hooks/` — Camada 3

| Submódulo               | Responsabilidade                                                  |
| ----------------------- | ----------------------------------------------------------------- |
| `factory.js`            | Factory principal dos 6 SessionHooks                              |
| `bus.js`                | HookBus com bridge para EventBus global                           |
| `composer.js`           | Composição de múltiplos hooks                                     |
| `types.js`              | Typedefs de todos os hooks                                        |
| `permission-handler.js` | Permission handling avançado                                      |
| `tool-interceptor.js`   | Interceptação de chamadas de tool                                 |
| `prompt-transformer.js` | Transformação de prompts                                          |
| `user-input.js`         | Handler de input do usuário                                       |
| `session-hooks.js`      | Lifecycle hooks (session start/end/error)                         |
| `presets/` (7 arquivos) | Audit, deny-all, interactive, minimal, production, safe, profiles |
| `registry.js`           | Registry de hooks                                                 |

**Pontos fortes**: Arquitetura composável. Presets prontos para diferentes perfis de segurança. Bridge com EventBus.
**Pontos fracos**: Pode haver overlap com `availableTools`/`excludedTools` do SDK (ver GAP-E01).

### 2.3 `agent/` — Camada 4

| Submódulo                      | Responsabilidade                                      |
| ------------------------------ | ----------------------------------------------------- |
| `always-alive.js`              | Loop principal do agente (1 arquivo grande)           |
| `agent-context.js`             | Estado compartilhado do agente                        |
| `lifecycle/session-setup.js`   | Wiring de criação de sessão (tools + hooks + options) |
| `lifecycle/agent-lifecycle.js` | Start/stop/restart do agente                          |
| `dialog/turn-executor.js`      | Execução de turns (send/sendAndWait)                  |
| `dialog/user-input-handler.js` | Tratamento de input interativo                        |
| `session/event-handlers/`      | 8+ handlers para eventos da sessão                    |
| `session/boot-wiring.js`       | Wiring de boot da sessão                              |

**Pontos fortes**: Separação em lifecycle/dialog/session. Event handlers modulares.
**Pontos fracos**: `always-alive.js` é um God Module (~700 linhas). Muitos event handlers dependem de estado global em `AgentContext`.

### 2.4 `tools/` — Camada 2

| Submódulo                | Responsabilidade                                         |
| ------------------------ | -------------------------------------------------------- |
| `session-rpc-tools.js`   | Tools expostas para o agente (model/mode/plan/workspace) |
| `session-tools.js`       | Tools de sessão (getMessages, send)                      |
| `code-tools.js`          | Tools de código (read_file, write_file, etc.)            |
| `hub-tools.js`           | Tools do conversation-hub                                |
| `hook-tools.js`          | Tools de inspeção de hooks                               |
| `permission-tools.js`    | Tools de gestão de permissões                            |
| `shell/`                 | Tools de shell (exec, kill)                              |
| `file/`                  | Tools de filesystem                                      |
| `git/`                   | Tools de git                                             |
| `web-tools.js`           | Tools web (fetch, search)                                |
| `introspection-tools.js` | Tools de introspection do sistema                        |
| `task-tools.js`          | Tools de tasks/TODOs                                     |

**Pontos fortes**: Categorização clara. `tool-factory.js` para criação padronizada.
**Pontos fracos**: Nenhuma tool expõe os 19 wrappers experimentais de `experimental.js`.

### 2.5 `bridges/` — Camada 2

| Submódulo            | Responsabilidade       |
| -------------------- | ---------------------- |
| `mcp-tool-bridge.js` | Bridge MCP ↔ SDK tools |
| `github-bridge.js`   | Bridge GitHub ↔ SDK    |

### 2.6 `conversation-hub/` — Camada 4

| Submódulo        | Responsabilidade               |
| ---------------- | ------------------------------ |
| Hub central      | Gerenciamento multi-sessão     |
| Session registry | Rastreamento de sessões ativas |
| Hub tools        | Tools específicas do hub       |

**Pontos fracos**: Registry próprio duplica parcialmente `client.listSessions()` do SDK. Não usa lifecycle events do client para sincronização.

### 2.7 `server/` — Camada 5

| Submódulo   | Responsabilidade                  |
| ----------- | --------------------------------- |
| `routes/`   | REST endpoints                    |
| `sse/`      | Server-Sent Events para streaming |
| Express app | Server HTTP principal             |

---

## 3. Fluxo de Dados Principal

```
[Usuário/Frontend]
       │
       ▼ (REST API / SSE)
[server/routes/]  ──────────────────────────────────────┐
       │                                                  │
       ▼ (encontra sessão ativa)                          │ (SSE stream)
[conversation-hub/]                                       │
       │                                                  │
       ▼ (delega para agente)                             │
[agent/always-alive.js]                                   │
       │                                                  │
       ├──► [agent/dialog/turn-executor.js]               │
       │         │                                        │
       │         ▼ (session.send/sendAndWait)             │
       │    [sdk/session/lifecycle.js]                     │
       │         │                                        │
       │         ▼                                        │
       │    [CopilotSession] ◄── [@github/copilot-sdk]   │
       │         │                                        │
       │         ├──► Events ──► [event-handlers/] ──────►│
       │         │                                        │
       │         ├──► Hooks ──► [hooks/factory.js]        │
       │         │         │                              │
       │         │         └──► [hooks/bus.js] → EventBus │
       │         │                                        │
       │         └──► RPC ──► [sdk/rpc/ops.js]            │
       │                                                  │
       └──► [tools/] ◄── tool calls from SDK              │
                │                                          │
                ├──► [bridges/mcp] → MCP servers           │
                ├──► [bridges/github] → GitHub API         │
                └──► [file/git/shell] → local ops          │
```

---

## 4. Padrões Arquiteturais Identificados

### 4.1 Singleton Client Pattern
`sdk/session/client.js` mantém um singleton de `CopilotClient` com lazy init. Sessões são registradas em `Map` interno. Vantagem: evita múltiplos processos CLI. Risco: single point of failure.

### 4.2 Hook Composition Pattern
`hooks/factory.js` + `hooks/bus.js` criam pipeline de hooks composável. Presets oferecem perfis prontos. Bridge com EventBus permite observabilidade global.

### 4.3 Event Handler Registration Pattern
`agent/session/event-handlers/` usa padrão de módulos que retornam unsubscribe functions. O catch-all captura eventos não tratados.

### 4.4 Tool Registry Pattern
Tools são definidas via `createTool()`, registradas em `createRegistry()`, e bootstrappadas via `bootstrapTools()`. Tools MCP são bridged no mesmo registry.

### 4.5 DI Container Pattern (parcial)
`core/di.js` + `core/di-container.js` fornecem IoC básico com tokens e registrations. Usado para resolução de serviços (metrics, logger, etc.) mas não para todas as dependências.

---

## 5. Acoplamentos Críticos

### 5.1 `always-alive.js` ↔ Everything
O módulo `always-alive.js` é o God Module do sistema. Importa diretamente de quase todas as camadas:
- `sdk/session/client.js` — para `getClient()`
- `sdk/rpc/` — para RPC operations
- `hooks/` — para hook setup
- `tools/` — para tool bootstrap
- `bridges/` — para MCP
- `server/` — para SSE emitters

Este alto fan-out torna mudanças arriscadas.

### 5.2 `AgentContext` como state bag
`agent-context.js` agrega todo o estado mutável do agente: sessão, modelo, status, caches, webhooks, dialog loop, pending questions. É compartilhado por referência entre todos os subsistemas.

### 5.3 `EventBus` global
O EventBus de `src/nerv/` é o canal de comunicação entre hooks, event handlers, e o server layer. Cross-cutting mas difícil de testar isoladamente. A bridge `HookBus → EventBus` via `attachBus()` funciona corretamente e é bem implementada (cada hook é wrappeado com emissão para ambos os bus: local EventEmitter + EventBus global).

---

## 6. Forças & Fraquezas

### Forças
1. **Tipagem JSDoc completa** — quase todos os exports têm `@param`/`@returns` documentados
2. **Separação SDK/hooks/agent/server** — camadas lógicas bem definidas
3. **Event handlers modulares** — fácil adicionar handler para novo evento
4. **Presets de hooks** — segurança configurável sem código boilerplate
5. **Constants centralizados** — sem magic strings nos consumers
6. **Experimental RPC isolado** — wrappers prontos para quando APIs estabilizarem

### Fraquezas
1. **God Module** (`always-alive.js`) — alto fan-out, difícil de testar
2. **Dead code** — lifecycle events e experimental RPC não wired (~420 linhas mortas)
3. **Hub sem sync de lifecycle** — `conversation-hub/` não recebe lifecycle events do client (`session.created/deleted/updated`), o que significa que sessões criadas/destruídas externamente não são refletidas no hub em tempo real
4. **Type evasion** — `Record<string,unknown>` em `lifecycle.js` derrota tipagem
5. **22+ events sem handler** — catch-all captura mas sem lógica específica
6. **Tool filtering duplicado** — hooks L3 reimplementam what SDK `availableTools`/`excludedTools` faz nativamente
7. **System message mode confusion** — `customize` usado onde `append` seria correto
