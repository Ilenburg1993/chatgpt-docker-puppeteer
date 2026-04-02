# src/copilot — Mapa de Módulos

> Documento gerado em 2026-04-02. Mantido pela equipe de engenharia.

## Visão Geral

Arquitetura em camadas para orquestração do GitHub Copilot SDK:

```
┌─────────────────────────────────────────────────────────────┐
│  terminal/           ← interface CLI (REPL + HTTP inject)   │
├─────────────────────────────────────────────────────────────┤
│  api/ · routes/ · server/   ← HTTP REST + Socket.IO         │
├─────────────────────────────────────────────────────────────┤
│  agent/              ← AlwaysAliveAgent (executor central)  │
│  conversation-hub/   ← store + orchestrator + socket        │
├─────────────────────────────────────────────────────────────┤
│  tools/              ← 16 categorias de Custom Tools SDK    │
│  config/             ← session config, system prompt, tools │
│  bridges/            ← gh-bridge, git-bridge, mcp, alias    │
│  channel/            ← LlmBridgeClient (LLM-B comms)        │
├─────────────────────────────────────────────────────────────┤
│  lib/                ← SDK client, hooks, permissions, etc. │
│  core/               ← constantes, erros, tipos             │
│  types/              ← StructuredMessage schema (Zod)       │
│  db/                 ← SQLite (copilot.db)                   │
│  infra/              ← FS, storage, queue, locks            │
└─────────────────────────────────────────────────────────────┘
```

## Diretórios

### `agent/` — Agente Principal

| Arquivo                    | Responsabilidade                                        | LOC   |
| -------------------------- | ------------------------------------------------------- | ----- |
| `always-alive.js`          | `AlwaysAliveAgent` — orquestra sessão, tools, reconexão | ~1188 |
| `dialog-loop-manager.js`   | Protocolo de turno com LLM-B (start/stop/restart)       | ~494  |
| `dialog-turn-executor.js`  | Execução e resolução de um turno individual             | ~300  |
| `dialog-protocol.js`       | `DialogProtocol` enum de estados                        | ~60   |
| `dialog-watchdog.js`       | `DialogWatchdog` — detecta loop travado                 | ~80   |
| `dialog-loop-wirer.js`     | `wireDialogLoopEvents` — pipe de 11 eventos             | ~80   |
| `session-initializer.js`   | `initOrResumeSession`, context builders                 | ~200  |
| `session-event-wirer.js`   | Wire de eventos SDK por grupo (5 grupos)                | ~150  |
| `session-hooks.js`         | `createSessionHooks` factory callbacks                  | ~90   |
| `task-executor.js`         | `executeTask` — execução de tarefas com callbacks       | ~80   |
| `tools-bootstrap.js`       | `bootstrapTools` — registry por categoria + TOOL_GROUPS | ~120  |
| `tool-audit-logger.js`     | `isHighRiskTool`, `buildAuditingPermissionHandler`      | ~120  |
| `permission-controller.js` | `PermissionController` — approval flow                  | ~100  |
| `message-queue.js`         | `MessageQueue` — fila de mensagens com prioridade       | ~80   |
| `reconnect-policy.js`      | `tryReconnect` — backoff exponencial com jitter         | ~60   |
| `state-io.js`              | `readState`, `writeState`, `clearState` (persist)       | ~80   |
| `status-snapshot.js`       | `buildStatusSnapshot` — snapshot para diagnóstico       | ~60   |
| `webhook-manager.js`       | `WebhookManager` — disparo de webhooks externos         | ~100  |
| `events.js`                | `AGENT_EVENTS` — nomes de eventos canônicos             | ~40   |
| `entry.js`                 | Entrypoint para PM2 (importa `main.js`)                 | ~10   |
| `agent-contract.js`        | `IAlwaysAliveAgent` typedef                             | ~30   |
| `index.js`                 | **Barrel** — todos os públicos re-exportados            | ~50   |

**Importação recomendada**: `import { AlwaysAliveAgent } from '#copilot/agent'`

---

### `conversation-hub/` — Hub de Conversas

| Arquivo            | Responsabilidade                                      |
| ------------------ | ----------------------------------------------------- |
| `hub.js`           | `ConversationHub` singleton — fachada pública         |
| `orchestrator.js`  | `ConversationOrchestrator` — roteamento de requests   |
| `socket-ns.js`     | `mountCopilotNamespace` — Socket.IO namespace         |
| `store.js`         | `ConversationStore` — CRUD de sessões/turnos (SQLite) |
| `store-helpers.js` | Helpers FTS5, tipos de query                          |

---

### `tools/` — Custom Tools SDK

16 categorias organizadas em sub-diretórios onde aplicável:

| Módulo                   | Categoria     | Nº de tools        |
| ------------------------ | ------------- | ------------------ |
| `task-tools.js`          | task          | ~5                 |
| `code-tools.js`          | code          | ~4                 |
| `git/index.js`           | git           | ~8                 |
| `session-tools.js`       | session       | ~4                 |
| `session-rpc-tools.js`   | session-rpc   | ~7                 |
| `hook-tools.js`          | hook          | ~5                 |
| `hub-tools.js`           | hub           | ~6                 |
| `introspection-tools.js` | introspection | ~4                 |
| `file/read-tools.js`     | file (read)   | ~5                 |
| `file/write-tools.js`    | file (write)  | ~4                 |
| `shell/index.js`         | shell         | ~6                 |
| `web-tools.js`           | web           | ~3                 |
| `todo/crud-tools.js`     | todo          | ~4                 |
| `todo/query-tools.js`    | todo          | ~4                 |
| `todo/bulk-tools.js`     | todo          | ~3                 |
| `permission-tools.js`    | permission    | ~3                 |
| `tool-factory.js`        | —             | builder utilitário |

**Importação recomendada**: `import { allTools, buildTool } from '#copilot/tools'`

---

### `lib/` — Camada de Biblioteca SDK

| Arquivo             | Exports principais                                           |
| ------------------- | ------------------------------------------------------------ |
| `sdk-client.js`     | `getClient`, `createClientSession`, `pingClient`, ...        |
| `hooks.js`          | `createHooks`, `createAuditHooks`, `createSafeHooks`, ...    |
| `permissions.js`    | `createPermissionHandler`, `createApproveAllPermission`, ... |
| `session.js`        | `createSession`, `resumeOrCreate`, `deleteSession`, ...      |
| `agents.js`         | `createAgent`, `createReadOnlyAgent`, `buildAgentList`, ...  |
| `models.js`         | `listModels`, `pickModel`, `buildReasoningConfig`, ...       |
| `tools-registry.js` | `createRegistry`, `registerTools`, `getAllTools`, ...        |
| `telemetry.js`      | `createTelemetry`, `recordToolCall`, `getSummary`, ...       |
| `event-helpers.js`  | `waitForEvent`, `raceEvents`                                 |
| `url-validator.js`  | `validateUrl`, `validateUrlString` (SSRF-safe)               |
| `http-request.js`   | `httpRequest` (fetch wrapper com timeout + SSRF guard)       |
| `utils.js`          | `pickDefined`                                                |

**Importação recomendada**: `import { createSession, createHooks } from '#copilot/lib'`

---

### `config/` — Configuração

| Arquivo                  | Responsabilidade                                       |
| ------------------------ | ------------------------------------------------------ |
| `session-config.js`      | Builders de config SDK (`buildAlwaysAliveConfig`, ...) |
| `system-prompt.js`       | Builders de system message e seções do prompt          |
| `custom-agents.js`       | Registry de Custom Agents declarativos                 |
| `pinned-files-loader.js` | `PinnedFilesLoader` — carrega arquivos para contexto   |
| `mcp-servers.js`         | Config dos MCP servers disponíveis                     |
| `tools/registry.js`      | Registry runtime de custom tools (persistência JSON)   |
| `tools/state.js`         | Estado de tools (enabled/disabled por sessão)          |

**Importação recomendada**: `import { buildAlwaysAliveConfig } from '#copilot/config'`

---

### `bridges/` — Bridges Externas

| Arquivo                                       | Responsabilidade                                    |
| --------------------------------------------- | --------------------------------------------------- |
| `gh-bridge.js`                                | Thin barrel → `gh/` (issues, PRs, CI, releases)     |
| `gh/issues.js`, `prs.js`, `ci.js`, `index.js` | GitHub CLI via `gh`                                 |
| `git-bridge.js`                               | Git via CLI subprocess                              |
| `mcp-tool-bridge.js`                          | Ponte MCP → Tool SDK                                |
| `alias-store.js`                              | `resolve`, `setAlias`, `removeAlias` — aliases REPL |
| `nerv-bridge.js`                              | Bridge para sistema NERV                            |

---

### `channel/` — Canal LLM-B

| Arquivo     | Responsabilidade                                  |
| ----------- | ------------------------------------------------- |
| `client.js` | `LlmBridgeClient` — conexão e protocolo com LLM-B |
| `inject.js` | `InjectClient` — API de injeção de mensagens      |

---

### `terminal/` — Terminal Permanente LLM-B

| Arquivo                       | Responsabilidade                                             |
| ----------------------------- | ------------------------------------------------------------ |
| `index.js` (= `bootstrap.js`) | `startTerminalServer` — bootstrap do terminal completo       |
| `repl.js`                     | REPL readline + `CMD_ROUTES` route table                     |
| `dialog.js`                   | `ensureDialogLoop`, `println`, SSE broadcast                 |
| `server.js`                   | `createInjectServer` — HTTP server de injeção                |
| `route-table.js`              | `ROUTE_TABLE`, `matchRoute`                                  |
| `http-handlers.js`            | Barrel → handlers-agent, handlers-dialog, handlers-system    |
| `handlers-agent.js`           | `handleInject`, `handlePipeline`, `handleGetContext`         |
| `handlers-dialog.js`          | `handleListSessions`, `handleListTurns`, `handleStoreMemory` |
| `handlers-system.js`          | `handleHealth`, `handleGetConfig`, SSE clients               |
| `state.js`                    | `getHubSessionId`, `getBusy`, `stateEmitter`                 |
| `file-context.js`             | `readFileContext`, `attachmentToEmbed`                       |
| `workspace-context.js`        | `getWorkspaceContext`                                        |

---

### `api/` — API REST Copilot

| Arquivo             | Responsabilidade                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `bridge-control.js` | `registerControlRoutes` — endpoints /status, /health, /session, /start, /stop, /permissions |

---

### `core/` — Contratos Centrais

```js
import { LLM_B_TERMINAL_PORT, CopilotError, StructuredMessage } from '#copilot/core';
```

- `constants.js` — portas, limites, nomes de eventos canônicos
- `errors.js` — `CopilotError`, `SessionError`, `BridgeError`
- `types/index.js` — `StructuredMessage` Zod schema + builders

---

## Aliases Disponíveis (package.json imports)

```json
"#copilot/agent":  "src/copilot/agent/index.js"
"#copilot/lib":    "src/copilot/lib/index.js"
"#copilot/tools":  "src/copilot/tools/index.js"
"#copilot/config": "src/copilot/config/index.js"
"#copilot/core":   "src/copilot/core/index.js"
```

## Dependências Circulares

```
✔ 0 ciclos (verificado com madge — 2026-04-02)
```

## Cobertura de Testes

```
Suite: 1962 testes | 1867 pass | 63 fail (falhas pré-existentes)
Novos desde Phase 8: +36 (alias-store, custom-tools-registry)
```
