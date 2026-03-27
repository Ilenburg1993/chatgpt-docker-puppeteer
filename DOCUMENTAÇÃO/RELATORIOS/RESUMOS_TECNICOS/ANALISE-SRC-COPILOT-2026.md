# Relatório Técnico: `src/copilot`

**Repositório**: chatgpt-docker-puppeteer | **Data**: 2026 | **Escopo**: análise exaustiva do módulo
`src/copilot`

---

## 1. Estrutura de Pastas e Propósito dos Arquivos

```
src/copilot/
│
├── agent/                       # Núcleo do agente Always-Alive
│   ├── entry.js                 # Entry point PM2 (process "copilot-sdk-agent")
│   ├── always-alive.js          # Classe AlwaysAliveAgent — singleton central
│   ├── session-manager.js       # Persistência de estado de sessão SDK
│   ├── tools-bootstrap.js       # Registro de todas as Custom Tools por categoria
│   ├── events.js                # Constantes de nomes de eventos (26 eventos)
│   ├── task-executor.js         # Execução de tarefa única (extraído para testabilidade)
│   ├── dialog-watchdog.js       # Watchdog de inatividade do dialog loop
│   └── webhook-manager.js       # Gerenciamento de webhooks HTTP de notificação
│
├── api/                         # Camada REST — Express routers
│   ├── http-bridge.js           # Aggregator /api/copilot/* (monta os 4 sub-routers)
│   ├── copilot-router.js        # Re-export canônico de http-bridge.js
│   ├── sdk-api.js               # Aggregator /api/sdk/* (monta routes/)
│   ├── sdk-router.js            # Re-export canônico de sdk-api.js
│   ├── bridge-control.js        # GET /status /health /session · POST /start /stop
│   ├── bridge-dialog.js         # POST /dialog/start /dialog/turn /dialog/stop
│   ├── bridge-stream.js         # GET /stream (SSE global do agente)
│   └── bridge-tasks.js          # POST /send /answer
│
├── bridges/                     # Integrações com sistemas externos
│   ├── nerv-bridge.js           # Ponte AlwaysAliveAgent ↔ NERV event bus
│   ├── gh-bridge.js             # Wrapper `gh` CLI via execFile
│   ├── git-bridge.js            # Wrapper `git` CLI via execFile
│   ├── mcp-tool-bridge.js       # Ponte MCP Tool Registry (JSON-RPC 2.0)
│   ├── alias-store.js           # Gerenciamento de aliases do REPL terminal
│   ├── inject-llmb.js           # Re-export → channel/inject.js  (@deprecated)
│   └── llm-bridge-client.js     # Re-export → channel/client.js  (@deprecated)
│
├── channel/                     # Canal de comunicação LLM-A ↔ LLM-B
│   ├── index.js                 # Barrel export + constante CHANNEL_VERSION='1'
│   ├── client.js                # LlmBridgeClient — camada conversacional SDK in-process
│   ├── inject.js                # Canal HTTP injection → POST /inject (porta 3009)
│   └── audit.js                 # Auditoria JSONL de tool calls (logs/tool-audit.jsonl)
│
├── config/                      # Configuração de sessões e sistema
│   ├── index.js                 # Barrel export
│   ├── session-config.js        # Builders: buildAlwaysAliveConfig/ReadOnly/FullAccess
│   ├── system-prompt.js         # Constantes e builders do system prompt do LLM-B
│   ├── mcp-servers.js           # Configurações de MCP servers disponíveis
│   ├── tools-state.js           # Estado de habilitação de tools (undo/redo em runtime)
│   ├── custom-agents.js         # Configurações de CustomAgentConfig
│   ├── custom-tools-registry.js # Registry dinâmico de tools declarativas (persiste em custom-tools.json)
│   └── pinned-files-loader.js   # Carregador de arquivos fixos como contexto de sessão
│
├── conversation-hub/            # Ambiente permanente LLM-A ↔ LLM-B ↔ Usuário
│   ├── hub.js                   # ConversationHub singleton (compõe Store + Orchestrator + SocketNS)
│   ├── orchestrator.js          # HubOrchestrator — lógica de diálogo (extends EventEmitter)
│   ├── store.js                 # ConversationStore — SQLite (hub_sessions + conversation_turns + memories FTS5)
│   ├── socket-ns.js             # Namespace Socket.io /copilot (streaming real-time)
│   └── index.js                 # Barrel export
│
├── core/                        # Contratos centrais do módulo
│   ├── index.js                 # Barrel: constants + errors + types
│   ├── constants.js             # LLM_B_TERMINAL_PORT, MAX_QUEUE_SIZE, re-export AGENT_EVENTS
│   ├── errors.js                # CopilotError, SessionError, BridgeError
│   └── types.js                 # Re-export → types/index.js
│
├── lib/                         # Abstrações puras do Copilot SDK
│   ├── index.js                 # Barrel (exporta todos os 80+ símbolos dos sub-módulos)
│   ├── client.js                # CopilotClient singleton + registry de sessões ativas
│   ├── session.js               # createSession/resumeOrCreate/listSessions/deleteSession
│   ├── hooks.js                 # Factories de SessionHooks (createHooks, createAuditHooks…)
│   ├── permissions.js           # Factories de PermissionHandler (createApproveAllPermission…)
│   ├── agents.js                # Builders de CustomAgentConfig
│   ├── models.js                # Helpers de modelos (listModels, pickModel…)
│   ├── tools-registry.js        # ToolRegistry (createRegistry, registerTool, getToolsByCategory…)
│   └── telemetry.js             # Store de telemetria em memória (circular buffer, maxRecords=500)
│
├── routes/                      # Express routers para sdk-api (/api/sdk/*)
│   ├── agent.js                 # /agent/info /tools /telemetry /state /stream
│   ├── client.js                # /ping /status /auth /models /tools /client/*
│   ├── sessions.js              # /sessions/* (CRUD completo + stream por sessão)
│   └── webhooks.js              # /webhooks (CRUD de notificações)
│
├── terminal/                    # Terminal interativo LLM-B (porta 3009)
│   ├── index.js                 # startTerminalServer — orquestração do boot
│   ├── server.js                # HTTP Server (createInjectServer) — transporte puro
│   ├── repl.js                  # readline REPL — startRepl()
│   ├── dialog.js                # Motor de diálogo — sendTurn, broadcastSse, ensureDialogLoop
│   ├── http-handlers.js         # Handlers puros (Command Pattern) para todos os endpoints
│   ├── state.js                 # Estado global compartilhado do terminal
│   ├── file-context.js          # Builder de contexto de arquivo para injeção
│   ├── workspace-context.js     # Builder de contexto de workspace para injeção
│   └── commands/                # Handlers de comando do REPL
│       ├── index.js             # Barrel export
│       ├── alias.js             # /alias
│       ├── attach.js            # /attach
│       ├── config.js            # /model, /reasoning
│       ├── context.js           # /compact, /context
│       ├── gh.js                # /gh issues/prs/ci
│       ├── git.js               # /git status/log
│       ├── help.js              # /help
│       ├── memory.js            # /remember, /recall, /forget
│       ├── plan.js              # /plan
│       ├── resume.js            # /resume
│       ├── session.js           # /status /history /db-history /db-sessions /who /clear /answer /count /restart
│       └── skills.js            # /skills
│
├── tools/                       # Definições de Custom Tools SDK
│   ├── index.js                 # allTools aggregator
│   ├── task-tools.js            # get_tasks, add_task, update_task_status
│   ├── code-tools.js            # lint_check, run_tests, typecheck
│   ├── file-tools.js            # read_file_content, write_file, list_directory, search_in_files
│   ├── git-tools.js             # git_status, git_diff, git_log, git_commit
│   ├── hook-tools.js            # hook_get_audit_tail, request_user_input
│   ├── hub-tools.js             # hub_send_message, hub_get_history, hub_create_session
│   ├── introspection-tools.js   # get_agent_status, list_tools, get_telemetry
│   ├── session-tools.js         # get_session_state, set_model, compact_session
│   ├── shell-tools.js           # run_shell_command, run_npm_script, run_node_script
│   └── tool-factory.js          # buildTool() — factory genérica para tools declarativas
│
├── types/                       # Tipos do protocolo de comunicação
│   ├── index.js                 # Barrel
│   └── structured-message.js   # StructuredMessage schema Zod + builders + parser
│
│   ── Shims de compatibilidade na raiz (todos @deprecated) ──
├── agent.js                     → agent/entry.js
├── always-alive.js              → agent/always-alive.js
├── session-manager.js           → agent/session-manager.js
├── nerv-bridge.js               → bridges/nerv-bridge.js
├── gh-bridge.js                 → bridges/gh-bridge.js
├── git-bridge.js                → bridges/git-bridge.js
├── http-bridge.js               → api/http-bridge.js
├── inject-llmb.js               → channel/inject.js
├── llm-bridge-client.js         → channel/client.js
├── mcp-tool-bridge.js           → bridges/mcp-tool-bridge.js
├── sdk-api.js                   → api/sdk-api.js
├── sdk-client.js                → lib/client.js (com mapeamento de nomes)
└── alias-store.js               → bridges/alias-store.js
│
├── terminal-server.js           # Entry point wrapper histórico → terminal/index.js
└── LLM-A-COMMUNICATION-GUIDE.md # Guia de comunicação programática LLM-A → LLM-B
```

---

## 2. Análise por Arquivo

### `agent/entry.js`

| Atributo             | Valor                                           |
| -------------------- | ----------------------------------------------- |
| **Responsabilidade** | Entry point do processo PM2 `copilot-sdk-agent` |
| **Exports**          | Nenhum (side-effect puro)                       |
| **Dependências**     | `agent/always-alive.js`, `#core/logger`         |
| **Padrão**           | Retry Pattern (max 5 tentativas, delay 5 s)     |
| **Status**           | Ativo, canônico v2                              |

Inicializa `alwaysAliveAgent.start()` com retry, registra signal handlers (`SIGTERM`, `SIGINT`) e
escuta eventos `'status'` e `'error'` do agente.

---

### `agent/always-alive.js`

| Atributo             | Valor                                                           |
| -------------------- | --------------------------------------------------------------- |
| **Responsabilidade** | Singleton central — gerencia todo o ciclo de vida de sessão SDK |
| **Exports**          | `AlwaysAliveAgent`, `alwaysAliveAgent` (singleton)              |
| **Padrão**           | Singleton, EventEmitter, Queue, Watchdog                        |
| **Status**           | Ativo, arquivo crítico                                          |

Campos privados: `#client`, `#session`, `#status`, `#queue`, `#pendingQuestion`,
`#dialogLoopActive`, `#watchdog`, `#sendCount`, `#contextState`, `#lastCheckpointPath`, `#webhooks`,
`#telemetry`, `#toolsRegistry`. Status:
`'idle' | 'processing' | 'waiting_for_input' | 'starting' | 'stopped'`. MAX_QUEUE_SIZE=100.
Watchdog: intervalo 5 min, stall 15 min. Token budget warning: 80% contínuo, 70% no resume.

---

### `agent/session-manager.js`

| Atributo               | Valor                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Responsabilidade**   | Persistência em disco do estado da sessão SDK e lógica de resume                                                             |
| **Exports**            | `readState`, `writeState`, `clearState`, `initOrResumeSession`, `buildHookSystemContext`, `setBackgroundCompactionThreshold` |
| **Arquivos de estado** | `.github/hooks/state/sdk-always-alive.json`, `logs/tool-audit.jsonl`                                                         |
| **Status**             | Ativo, canônico v2                                                                                                           |

Injeção de contexto do hook system no `systemMessage`. Auditoria JSONL de ferramentas de alto risco
(`bash`, `edit`, `create`, `git_apply_patch`). Background compaction threshold padrão: 0.75.

---

### `agent/tools-bootstrap.js`

| Atributo             | Valor                                                    |
| -------------------- | -------------------------------------------------------- |
| **Responsabilidade** | Registro de ferramentas por categoria no boot do agente  |
| **Exports**          | `bootstrapTools(registry, telemetry, mcpTools) → Tool[]` |
| **Status**           | Ativo                                                    |

Registra 11 categorias: task, code, git, session, hook, hub, introspection, fileRead, fileWrite,
shell, mcp, custom. Chama `registerForIntrospection(allTools)` e `setTelemetryStore(telemetry)`.

---

### `agent/events.js`

| Atributo             | Valor                                                       |
| -------------------- | ----------------------------------------------------------- |
| **Responsabilidade** | Constantes canônicas dos 26 eventos do `AlwaysAliveAgent`   |
| **Exports**          | `AGENT_EVENTS: readonly string[]`, typedef `AgentEventName` |
| **Status**           | Ativo                                                       |

---

### `agent/task-executor.js`

| Atributo             | Valor                                           |
| -------------------- | ----------------------------------------------- |
| **Responsabilidade** | Execução de tarefa individual da fila do agente |
| **Exports**          | `executeTask(session, task, callbacks)`         |
| **Padrão**           | Command Pattern, Callbacks                      |
| **Status**           | Ativo                                           |

Assina `assistant.message_delta` (streaming), `tool.execution_start/complete` (auditoria). Timeout
default 60 s via `session.sendAndWait()`.

---

### `agent/dialog-watchdog.js`

| Atributo             | Valor                                              |
| -------------------- | -------------------------------------------------- |
| **Responsabilidade** | Monitor de inatividade isolado do dialog loop      |
| **Exports**          | `class DialogWatchdog { start(), stop(), ping() }` |
| **Status**           | Ativo                                              |

Extraído de `always-alive.js` para facilitar testes. Callback `onStall(stalledMs)` disparado quando
inactividade > `stallMs`.

---

### `agent/webhook-manager.js`

| Atributo             | Valor                                                               |
| -------------------- | ------------------------------------------------------------------- |
| **Responsabilidade** | Gerenciamento de webhooks de notificação HTTP                       |
| **Exports**          | `class WebhookManager { register(), unregister(), list(), emit() }` |
| **Status**           | Ativo                                                               |

Fire-and-forget via `Promise.allSettled`. ID gerado como `wh_{timestamp}_{random}`.

---

### `api/http-bridge.js`

| Atributo             | Valor                                         |
| -------------------- | --------------------------------------------- |
| **Responsabilidade** | Aggregator do Express router `/api/copilot/*` |
| **Exports**          | `default bridge` — Express Router             |
| **Status**           | Ativo, canônico                               |

Monta 4 sub-routers: `bridge-control`, `bridge-tasks`, `bridge-stream`, `bridge-dialog`. O
`copilot-router.js` é seu alias.

---

### `api/bridge-control.js`

| Atributo             | Valor                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| **Responsabilidade** | Rotas de controle: `GET /status /health /session`, `POST /start /stop` |
| **Exports**          | `registerControlRoutes(bridge, agent)`                                 |
| **Status**           | Ativo                                                                  |

`/health` retorna `ok` apenas quando `status === 'idle' || 'processing'`. Inclui snapshot do
ConversationStore na resposta `/health`.

---

### `api/bridge-dialog.js`

| Atributo             | Valor                                                                          |
| -------------------- | ------------------------------------------------------------------------------ |
| **Responsabilidade** | Dialog Loop §15.8: `POST /dialog/start /dialog/turn /dialog/stop`              |
| **Exports**          | `registerDialogRoutes(bridge, agent)`                                          |
| **Nota**             | Padrão §15.8 — todas as iterações reutilizam o mesmo PR (zero custo por turno) |
| **Status**           | Ativo                                                                          |

---

### `api/bridge-stream.js`

| Atributo             | Valor                                                            |
| -------------------- | ---------------------------------------------------------------- |
| **Responsabilidade** | SSE global `GET /stream` — push de todos os 26 eventos do agente |
| **Exports**          | `registerStreamRoutes(bridge, agent)`                            |
| **Status**           | Ativo                                                            |

Heartbeat a cada 15 s. Assina dinamicamente todos os `AGENT_EVENTS`. Remove listeners ao
desconectar.

---

### `api/bridge-tasks.js`

| Atributo             | Valor                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| **Responsabilidade** | `POST /send` (enfileirar mensagem) + `POST /answer` (responder pergunta) |
| **Exports**          | `registerTaskRoutes(bridge, agent)`                                      |
| **Status**           | Ativo                                                                    |

`/send` suporta modo síncrono (`waitForResponse=true`) com `Promise.race` + timeout. Verificação
proativa de `MAX_QUEUE_SIZE` (GAP-03) antes de retornar `ok:true`.

---

### `api/sdk-api.js`

| Atributo             | Valor                                                               |
| -------------------- | ------------------------------------------------------------------- |
| **Responsabilidade** | Aggregator do router `/api/sdk/*` — monta os 4 routers de `routes/` |
| **Exports**          | `default router` — Express Router                                   |
| **Status**           | Ativo, canônico                                                     |

Subsets: `clientRouter`, `sessionsRouter`, `agentRouter`, `webhooksRouter`.

---

### `bridges/nerv-bridge.js`

| Atributo             | Valor                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------- |
| **Responsabilidade** | Ponte event-driven entre `AlwaysAliveAgent` e NERV bus                                      |
| **Exports**          | `copilotNervBridge { mount(nerv), unmount(), isActive() }`, `emitNerv(actionCode, payload)` |
| **Status**           | Ativo                                                                                       |

EVENT_MAP cobre todos os 25 eventos. Envelope:
`{ actor: 'COPILOT', actionCode, messageType: 'EVENT', payload, timestamp }`. `safeEmit()` é
fire-and-forget.

---

### `bridges/mcp-tool-bridge.js`

| Atributo             | Valor                                                       |
| -------------------- | ----------------------------------------------------------- |
| **Responsabilidade** | Carregamento dinâmico de ferramentas via MCP (JSON-RPC 2.0) |
| **Exports**          | `listMcpTools()`, `buildMcpTools()`                         |
| **Status**           | Ativo                                                       |

Converte JSON Schema → Zod via `buildZodSchema()`. Timeout de 8 s via `AbortSignal.timeout`.
Suporta: `enum`, objetos aninhados, arrays.

---

### `bridges/alias-store.js`

| Atributo             | Valor                                                                      |
| -------------------- | -------------------------------------------------------------------------- |
| **Responsabilidade** | Aliases do REPL — 10 embutidos + persistência em `~/.copilot-aliases.json` |
| **Exports**          | `loadAliases`, `resolve`, `defineAlias`, `removeAlias`, `listAliases`      |
| **Status**           | Ativo                                                                      |

Resolução em cadeia até 5 níveis. Aliases embutidos: `/issues`, `/prs`, `/runs`, `/ci`, `/log`,
`/st`, `/diff`, `/gst`, `/glog`, `/glog1`.

---

### `channel/index.js`

| Atributo             | Valor                                                     |
| -------------------- | --------------------------------------------------------- |
| **Responsabilidade** | Barrel + `CHANNEL_VERSION = '1'`                          |
| **Dois modos**       | HTTP injection (terminal ativo) + SDK client (standalone) |
| **Status**           | Ativo, canônico                                           |

---

### `channel/client.js`

| Atributo             | Valor                                                              |
| -------------------- | ------------------------------------------------------------------ |
| **Responsabilidade** | `LlmBridgeClient` — camada conversacional sobre `AlwaysAliveAgent` |
| **Exports**          | `class LlmBridgeClient`, `llmBridgeClient` (instância padrão)      |
| **Padrão**           | Façade, History Buffer                                             |
| **Status**           | Ativo                                                              |

Mantém `#history` (turn-by-turn) e `#turnCount`. Suporta streaming via `task.delta`.
`chatStructured()` usa protocolo StructuredMessage. Timeout padrão 60 s.

---

### `channel/inject.js`

| Atributo             | Valor                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Responsabilidade** | Canal HTTP: LLM-A → POST `/inject` do terminal ativo (porta 3009)                                                 |
| **Exports**          | `injectToLlmB`, `checkLlmBHealth`, `injectPipeline`, `subscribeLlmB`, `subscribeLlmBCritical`, `waitForLlmBReady` |
| **Status**           | Ativo                                                                                                             |

Usa `http.request` nativo (sem `fetch`). Timeout padrão: `LLM_B_TURN_TIMEOUT` ?? 130 000 ms. Rate:
`INJECT_RATE_MAX=10/60s` no servidor.

---

### `channel/audit.js`

| Atributo             | Valor                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| **Responsabilidade** | Auditoria JSONL de tool calls (início + conclusão)                       |
| **Exports**          | `auditToolStart(entry)`, `auditToolComplete(entry)`, `getAuditSummary()` |
| **Rotação**          | Ao atingir 10 MB → renomeia para `tool-audit.jsonl.1`                    |
| **Status**           | Ativo                                                                    |

Fila em memória `_pending: Map<toolCallId, …>` para correlacionar start/complete.

---

### `conversation-hub/store.js`

| Atributo             | Valor                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| **Responsabilidade** | Persistência SQLite — `copilot_hub_sessions`, `copilot_conversation_turns`, `copilot_memories` |
| **Exports**          | `class ConversationStore`, `conversationStore` (singleton)                                     |
| **DB**               | Usa `getDb()` do projeto (arquivo `maestro.sqlite`)                                            |
| **Status**           | Ativo                                                                                          |

DDL idempotente (`CREATE TABLE IF NOT EXISTS`). `copilot_memories` usa FTS5 com tokenizer
`porter unicode61 remove_diacritics 1` (PERF-03). Triggers para sincronizar FTS5 em
insert/update/delete. Índice em `user_read = 0` para polling de mensagens não lidas.

---

### `conversation-hub/hub.js`

| Atributo             | Valor                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------ |
| **Responsabilidade** | Singleton `ConversationHub` — ponto de entrada único para ambiente LLM-A ↔ LLM-B ↔ Usuário |
| **Exports**          | `class ConversationHub`, `conversationHub` (singleton)                                     |
| **Padrão**           | Facade, Template Method                                                                    |
| **Status**           | Ativo                                                                                      |

`init({ io, nerv })` idempotente — inicializa Store → Orchestrator → Socket.io namespace → (opt)
NERV bridge. Atalhos de API: `createSession()`, `sendToLlmB()`, `injectUserMessage()`,
`pollUserMessages()`.

---

### `conversation-hub/orchestrator.js`

| Atributo             | Valor                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| **Responsabilidade** | Lógica de diálogo entre LLM-A, LLM-B e Usuário                                                            |
| **Exports**          | `class HubOrchestrator extends EventEmitter`                                                              |
| **Eventos emitidos** | `turn:sent`, `turn:delta`, `turn:complete`, `user:injected`, `session:created`, `session:closed`, `error` |
| **Status**           | Ativo                                                                                                     |

Mantém `#turnCounters: Map<hubSessionId, nextTurnNumber>`. Restaura contadores das sessões ativas no
`init()` para continuidade após restart.

---

### `conversation-hub/socket-ns.js`

| Atributo             | Valor                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Responsabilidade** | Namespace Socket.io `/copilot` — streaming real-time da conversa                                                       |
| **Exports**          | `mountCopilotNamespace(io, orchestrator, store)`, `getCopilotNamespace()`, `broadcastToSession()`, `broadcastGlobal()` |
| **Autenticação**     | Controlada por `COPILOT_HUB_SOCKET_AUTH_REQUIRED` (override) ou `DASHBOARD_SOCKET_AUTH_REQUIRED`                       |
| **Status**           | Ativo                                                                                                                  |

Eventos recebidos do cliente: `join:session`, `inject:message`, `get:history`.

---

### `core/errors.js`

| Atributo             | Valor                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------- |
| **Responsabilidade** | Hierarquia de erros tipados                                                             |
| **Exports**          | `CopilotError`, `SessionError extends CopilotError`, `BridgeError extends CopilotError` |
| **Status**           | Ativo                                                                                   |

---

### `lib/tools-registry.js`

| Atributo             | Valor                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsabilidade** | Registry de Custom Tools com metadados (categoria, tags, readOnly)                                                                                                                      |
| **Exports**          | `createRegistry`, `registerTool`, `registerTools`, `getAllTools`, `getToolsByCategory`, `getToolsByTag`, `filterByNames`, `excludeByNames`, `mergeRegistries`, `inspectRegistry` e mais |
| **Status**           | Ativo                                                                                                                                                                                   |

---

### `lib/telemetry.js`

| Atributo             | Valor                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Responsabilidade** | Store de telemetria em memória — tool calls, sessões, latências                                                                    |
| **Exports**          | `createTelemetry`, `recordToolCall`, `recordSessionStart/End`, `getSummary`, `getCallsByTool`, `getErrorCount`, `startSpan` e mais |
| **Buffer**           | Circular — `maxRecords = 500`                                                                                                      |
| **Status**           | Ativo                                                                                                                              |

---

### `tools/shell-tools.js`

| Atributo             | Valor                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsabilidade** | Ferramentas de shell com restrições de segurança embutidas                                                                               |
| **Security**         | Blocklist 20+ padrões perigosos, cwd restrito a `/workspaces/`, whitelist npm scripts, env vars sensíveis removidas, verificação de root |
| **Status**           | Ativo                                                                                                                                    |

`ALLOWED_NPM_SCRIPTS` é whitelist explícita. `MAX_OUTPUT_BYTES = 10 000`. `MAX_TIMEOUT_MS = 120 s`.

---

### `types/structured-message.js`

| Atributo             | Valor                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsabilidade** | Protocolo StructuredMessage — Sprint A                                                                                                                                             |
| **Exports**          | `StructuredMessageSchema (Zod)`, `buildStructuredRequest`, `buildStructuredResponse`, `parseStructuredResponse`, `serializeStructuredMessage`, `RESPONSE_TYPES`, `PRIORITY_LEVELS` |
| **Status**           | Ativo                                                                                                                                                                              |

`RESPONSE_TYPES`: `diagnostic | plan | code | question | confirmation | error`. `PRIORITY_LEVELS`:
`low | medium | high | critical`. Parser tem fallback gracioso (texto puro → `null`).

---

### `config/system-prompt.js`

| Atributo             | Valor                                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Responsabilidade** | Definição e builders do system prompt do LLM-B                                                                                                                             |
| **Exports**          | `AGENT_IDENTITY`, `AGENT_TONE`, `TOOL_EFFICIENCY`, `AGENT_GUIDELINES`, `CODE_CHANGE_RULES`, `ENVIRONMENT_CONTEXT`, `LAST_INSTRUCTIONS`, `SYSTEM_PROMPT_SECTIONS`, builders |
| **Modos**            | `buildAppendSystemMessage()` (mode: append) e `buildReplaceSystemMessage()` (mode: replace)                                                                                |
| **Status**           | Ativo                                                                                                                                                                      |

---

### `config/custom-tools-registry.js`

| Atributo               | Valor                                                                             |
| ---------------------- | --------------------------------------------------------------------------------- |
| **Responsabilidade**   | Registry dinâmico de tools declarativas em runtime (sem reinicialização)          |
| **Segurança**          | Sem eval/código dinâmico — handlers referenciados por ID no `BUILTIN_HANDLER_MAP` |
| **Persistência**       | `custom-tools.json` na raiz do projeto                                            |
| **Handlers embutidos** | `echo`, `timestamp`, `env_read`                                                   |
| **Status**             | Ativo                                                                             |

---

### Shims de Compatibilidade na Raiz (todos @deprecated)

| Arquivo                | Aponta para                  | Tipo                                |
| ---------------------- | ---------------------------- | ----------------------------------- |
| `agent.js`             | `agent/entry.js`             | re-export puro                      |
| `always-alive.js`      | `agent/always-alive.js`      | re-export puro                      |
| `session-manager.js`   | `agent/session-manager.js`   | re-export puro                      |
| `nerv-bridge.js`       | `bridges/nerv-bridge.js`     | re-export puro                      |
| `gh-bridge.js`         | `bridges/gh-bridge.js`       | re-export puro                      |
| `git-bridge.js`        | `bridges/git-bridge.js`      | re-export puro                      |
| `http-bridge.js`       | `api/http-bridge.js`         | re-export puro                      |
| `inject-llmb.js`       | `channel/inject.js`          | re-export puro                      |
| `llm-bridge-client.js` | `channel/client.js`          | re-export puro                      |
| `mcp-tool-bridge.js`   | `bridges/mcp-tool-bridge.js` | re-export puro                      |
| `sdk-api.js`           | `api/sdk-api.js`             | re-export puro                      |
| `alias-store.js`       | `bridges/alias-store.js`     | re-export puro                      |
| `sdk-client.js`        | `lib/client.js`              | **wrapper com mapeamento de nomes** |

---

## 3. Fluxo de Inicialização (do entry point ao agente pronto)

```
PM2 start → agent/entry.js
    │
    ├── startWithRetry(attempt=1)
    │       └── alwaysAliveAgent.start()
    │               │
    │               ├─ 1. buildClientOptions()          ← verifica COPILOT_CLI_URL (modo cliUrl)
    │               ├─ 2. new CopilotClient(options)    ← @github/copilot-sdk
    │               ├─ 3. buildMcpTools()               ← mcp-tool-bridge.js: RPC para listar tools MCP
    │               ├─ 4. createRegistry()              ← lib/tools-registry.js
    │               ├─ 5. createTelemetry()             ← lib/telemetry.js
    │               ├─ 6. bootstrapTools(registry, tel, mcpTools)
    │               │       ├── registerTools(taskTools, codeTools, gitTools, ...)
    │               │       ├── registerForIntrospection(allTools)
    │               │       └── setTelemetryStore(telemetry)
    │               ├─ 7. initOrResumeSession(client, opts)
    │               │       ├── readState()             ← sdk-always-alive.json
    │               │       ├── buildHookSystemContext() ← session-briefing.md
    │               │       ├── try resumeSession(sessionId)
    │               │       │       ↳ se falhar: createSession() com config completa
    │               │       ├── writeState({ sessionId, status: 'active', … })
    │               │       └── return { session, isResumed }
    │               ├─ 8. Wiring de eventos SDK na sessão:
    │               │       session.on('compaction_start') → emit('session.compaction_start')
    │               │       session.on('compaction_complete') → #lastCheckpointPath
    │               │       session.on('usage_info') → #contextState + budget warnings
    │               │       session.on('mode_changed') → emit('session.mode_changed')
    │               ├─ 9. #watchdog.start()             ← DialogWatchdog
    │               └─10. emit('ready', { sessionId, isResumed })
    │
    └── agent.on('status', …) + agent.on('error', …)  ← monitoramento entry.js
```

---

## 4. Fluxo de Mensagem (POST /inject → resposta LLM-B)

```
Cliente HTTP
    │
    POST http://127.0.0.1:3009/inject
    │  { message: "...", from: "llm-a", attachments?: [...] }
    │
    ▼
terminal/server.js (createInjectServer)
    │  rate limiter: 10 req/IP/60s
    │
    ▼
terminal/http-handlers.js → handleInject(req, res)
    │  1. Verifica se agente está idle/ready
    │  2. Chama dialog.sendTurn(message, from)
    │
    ▼
terminal/dialog.js → sendTurn(message, from)
    │  1. setBusy(true)
    │  2. conversationHub.store.writeTurn({ role:'user', content: message, … })
    │  3. ensureDialogLoop()          ← inicia dialog loop se não ativo
    │  4. alwaysAliveAgent.sendDialogTurn(message, { timeout: 120000 })
    │        │
    │        ▼  (dentro do AlwaysAliveAgent)
    │        enqueue task → processQueue()
    │              │
    │              ▼
    │        task-executor.js → executeTask(session, task, callbacks)
    │              │  session.sendAndWait({ message, attachments })
    │              │  escuta assistant.message_delta (streaming)
    │              │  escuta tool.execution_start/complete (auditoria)
    │              └── retorna resposta completa
    │
    │  5. reply = await sendDialogTurn (aguarda até TURN_TIMEOUT_MS = 120 s)
    │  6. conversationHub.store.writeTurn({ role:'llm_b', content: reply, … })
    │  7. broadcastSse('turn:complete', { reply, durationMs })
    │       ├── SSE raw → GET /events (terminal)
    │       └── Socket.io /copilot namespace → turn:complete
    │  8. printExchange(...)         ← output REPL
    │  9. setBusy(false)
    │
    ▼
HTTP 200 { ok: true, reply: "...", durationMs: N }
    │
    └── Retorna ao cliente HTTP (LLM-A)
```

---

## 5. Fluxo do Terminal REPL

```
startTerminalServer() [terminal/index.js]
    │
    ├─ 1. loadAliases()
    ├─ 2. createInjectServer()         ← HTTP porta 3009
    ├─ 3. conversationHub.store.createHubSession() → setHubSessionId()
    ├─ 4. dialog.stalled watchdog      ← auto-reinicia dialog loop ao travar
    ├─ 5. SSE broadcasting setup
    └─ 6. startRepl(injectServer, cleanup) [terminal/repl.js]
              │
              ├─ setupAgentListeners()  ← task.delta → println, question.pending → println
              ├─ rl = readline.createInterface(stdin, stdout)
              ├─ mostra BANNER (comandos disponíveis + endpoints HTTP)
              └─ loop readline.question(PROMPT_USER)
                        │
                        ├── Se iniciar com '/'  → dispatchCmd(line)
                        │       └── lookup em commands/index.js exports
                        │             ex: /status → cmdStatus(rl, dialog)
                        │                 /gh issues → cmdGh(…)
                        │                 /alias add /k "msg" → cmdAlias(…)
                        │
                        └── Senão  → dialog.sendTurn(line, 'user')
                                    └── segue fluxo do POST /inject acima
```

**Comandos REPL disponíveis**: `/status`, `/history`, `/db-history`, `/db-sessions`, `/remember`,
`/recall`, `/forget`, `/who`, `/clear`, `/answer`, `/count`, `/restart`, `/model`, `/reasoning`,
`/attach`, `/context`, `/compact`, `/plan`, `/resume`, `/gh`, `/git`, `/alias`, `/skills`, `/help`.

---

## 6. Fluxo de Reconexão de Sessão

```
AlwaysAliveAgent — evento 'session.fatal' ou watchdog stall
    │
    ├─ tryReconnect() [task-executor.js callback]
    │       │
    │       └─ alwaysAliveAgent.#reconnect()
    │               │
    │               ├─ stop() — limpa sessão atual + watchdog
    │               ├─ delay exponencial (1 s, 2 s, 4 s, 8 s, 16 s — máx 5 tentativas)
    │               └─ start()  ← recomeça fluxo de inicialização completo
    │                       │
    │                       └─ initOrResumeSession()
    │                               │
    │                               ├─ readState() → sessionId existente
    │                               ├─ try resumeSession(savedSessionId)
    │                               │       ↳ SDK carrega contexto do checkpoint
    │                               └─ se falhar → createSession() (sessão nova)
    │                                       └─ writeState({ sessionId: novoId, isResumed: false })
    │
    └─ emit('ready', { sessionId, isResumed: true/false })
```

Ponto de checagem: `#lastCheckpointPath` — atualizado a cada evento `session.compaction_complete`.

---

## 7. Mapa de Dependências Críticas

```
                    ┌─────────────────────────────┐
                    │      @github/copilot-sdk     │   (dependência externa)
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │       lib/client.js          │  CopilotClient singleton
                    │       lib/session.js         │  createSession / resumeOrCreate
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  agent/always-alive.js       │  ◄── NÚCLEO
                    │  (AlwaysAliveAgent singleton)│
                    └──┬──────────┬───────────────┘
                       │          │
          ┌────────────▼─┐  ┌────▼────────────────┐
          │session-manager│  │ tools-bootstrap.js   │
          │(estado disco) │  │ (11 categorias tools)│
          └───────────────┘  └─────────┬───────────┘
                                       │
                          ┌────────────▼──────────┐
                          │    tools/index.js      │
                          │  (allTools aggregator) │
                          └────────────────────────┘

  ┌─────────────────────────────────────────────────────┐
  │              API Layer                              │
  │  api/http-bridge → bridge-control/dialog/stream/tasks│
  │  api/sdk-api    → routes/agent/client/sessions/webhooks│
  └─────────────────────────────────────────────────────┘
         │                        │
  ┌──────▼──────┐          ┌──────▼───────────────────┐
  │ always-alive│          │  lib/client.js (getClient)│
  │  (direct)   │          │  (session CRUD)           │
  └─────────────┘          └──────────────────────────┘

  ┌─────────────────────────────────────────────────────┐
  │            conversation-hub/                        │
  │  hub → orchestrator → store (SQLite maestro.sqlite) │
  │        socket-ns (/copilot Socket.io namespace)     │
  └─────────────────────────────────────────────────────┘
         ▲           ▲
         │           │
  terminal/dialog.js  channel/client.js (LlmBridgeClient)

  ┌─────────────────────────────────────────────────────┐
  │            channel/                                 │
  │  inject.js (HTTP → :3009)  client.js (SDK in-proc) │
  │  audit.js (JSONL audit)                            │
  └─────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────┐
  │            bridges/                                 │
  │  nerv-bridge → NERV bus (opcional)                  │
  │  gh-bridge   → gh CLI                              │
  │  git-bridge  → git CLI                             │
  │  mcp-tool-bridge → MCP HTTP JSON-RPC :PORT/api/mcp │
  └─────────────────────────────────────────────────────┘
```

---

## 8. Camadas Arquiteturais

| Nível | Camada                   | Módulos                                                                                                  |
| ----- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| 0     | **Contratos Centrais**   | `core/` — erros, constantes, tipos                                                                       |
| 1     | **Abstrações SDK**       | `lib/` — client, session, hooks, permissions, models, tools-registry, telemetry                          |
| 2     | **Tipos de Protocolo**   | `types/` — StructuredMessage schema                                                                      |
| 3     | **Agente Core**          | `agent/` — AlwaysAliveAgent, session-manager, tools-bootstrap, events, task-executor, watchdog, webhooks |
| 4     | **Custom Tools**         | `tools/` — 11 categorias + tool-factory                                                                  |
| 5     | **Canal de Comunicação** | `channel/` — inject, client, audit                                                                       |
| 6     | **Configuração**         | `config/` — session-config, system-prompt, mcp-servers, custom-tools-registry                            |
| 7     | **Hub de Conversa**      | `conversation-hub/` — hub, orchestrator, store, socket-ns                                                |
| 8     | **Integrações Externas** | `bridges/` — nerv, gh, git, mcp, alias-store                                                             |
| 9     | **API REST**             | `api/` — http-bridge (sub-routers) + sdk-api (sub-routers)                                               |
| 10    | **Routers Express**      | `routes/` — agent, client, sessions, webhooks                                                            |
| 11    | **Terminal Interativo**  | `terminal/` — server, repl, dialog, handlers, state, commands                                            |
| 12    | **Entry Points**         | `agent/entry.js`, `terminal-server.js`                                                                   |

---

## 9. Problemas, Redundâncias e Issues Identificados

### 9.1 Poluição de shims na raiz (alto impacto na DX)

Os 13 arquivos shim na raiz do módulo (`agent.js`, `always-alive.js`, etc.) estão marcados como
`@deprecated` mas **nunca foram removidos**. Qualquer `import` incorreto do código externo passa
silenciosamente pelo shim e chega ao arquivo canônico. Não há mecanismo que force a migração.

**Código problemático**: dois shims formam cadeias de dois níveis:

- `inject-llmb.js` → `bridges/inject-llmb.js` → `channel/inject.js`
- `llm-bridge-client.js` → `bridges/llm-bridge-client.js` → `channel/client.js`

### 9.2 `sdk-client.js` é um wrapper, não só re-export

Enquanto todos os outros shims fazem `export * from`, o `sdk-client.js` remapeia nomes (p. ex.
`createSdkSession()` → `lib/client.createClientSession()`), criando uma camada de tradução oculta
que pode silenciosamente quebrar ao evoluir as assinaturas.

### 9.3 Dois arquivos `server` com nomes similares

- `terminal-server.js` (raiz): wrapper histórico, define `COPILOT_SDK_ENABLED=true`, re-exporta
  `startTerminalServer`
- `terminal/server.js`: implementação real do HTTP server

Causa confusão na navegação de código.

### 9.4 `HubOrchestrator` importa por caminhos deprecated

```js
// orchestrator.js
import { LlmBridgeClient } from '../llm-bridge-client.js'; // ← shim deprecated!
```

Deveria ser `'../channel/client.js'`.

### 9.5 Acoplamento em `routes/agent.js` via cast `any`

```js
const registry = /** @type {any} */ (alwaysAliveAgent).toolsRegistry;
const telemetry = /** @type {any} */ (alwaysAliveAgent).telemetry;
```

Campos privados acessados via cast inseguro — contorna encapsulamento. Solução: adicionar
`getToolsRegistry()` e `getTelemetry()` ao `AlwaysAliveAgent`.

### 9.6 `task-tools.js` usa `execSync + curl` para chamadas internas

Em vez de importar a camada de dados diretamente, usa curl sincronamente — bloqueia o event loop e
cria dependência de binário externo.

### 9.7 Timeout inconsistente entre `dialog.js` e `inject.js`

- `terminal/dialog.js`: `TURN_TIMEOUT_MS = 120 000 ms`
- `channel/inject.js`: `DEFAULT_TIMEOUT_MS = 130 000 ms`

Dois valores diferentes para "timeout de turno" sem origem em `core/constants.js`.

### 9.8 `config/custom-tools-registry.js` — BUILTIN_HANDLER_MAP mínimo

Apenas 3 handlers embutidos (`echo`, `timestamp`, `env_read`). Sem handlers práticos registráveis
via API sem editar código.

### 9.9 `terminal/state.js` — estado global mutável sem observers

Estado global (`_hubSessionId`, `_busy`, etc.) consultado por múltiplos módulos sem mecanismo de
observer — race condition potencial.

### 9.10 Sem limite máximo de clientes SSE em `bridge-stream.js`

Listeners do `AlwaysAliveAgent` acumulam para clientes SSE sem limite. Conexões zombie nunca
fechadas podem causar memory leak.

### 9.11 `copilot-router.js` e `sdk-router.js` são aliases sem valor

Cada um tem uma única linha de `export * from` — aumentam o inventário de arquivos sem benefício.

### 9.12 Migração FTS5 executada a cada `init()` do store

A migração `migrateMemoriesFtsTokenizer` em `store.js` executa lógica DDL potencialmente destrutiva
a cada inicialização — frágil em produção.

---

## 10. Análise dos Arquivos na Raiz do Módulo

Todos os 13 arquivos são **shims de compatibilidade** criados durante fases de refatoração e nunca
removidos. O único que difere é `sdk-client.js`: além de re-exportar, contém remapeamento de nomes —
é um **wrapper de tradução**, não um re-export puro.

---

## 11. Análise da Pasta `api/`

| Arquivo             | Rotas                                           | Responsabilidade                 |
| ------------------- | ----------------------------------------------- | -------------------------------- |
| `http-bridge.js`    | `/api/copilot/*`                                | Aggregator — monta 4 sub-routers |
| `copilot-router.js` | idem                                            | Alias de http-bridge.js          |
| `sdk-api.js`        | `/api/sdk/*`                                    | Aggregator — monta routes/       |
| `sdk-router.js`     | idem                                            | Alias de sdk-api.js              |
| `bridge-control.js` | GET /status /health /session; POST /start /stop | Controle do ciclo de vida        |
| `bridge-dialog.js`  | POST /dialog/start /dialog/turn /dialog/stop    | Dialog Loop §15.8                |
| `bridge-stream.js`  | GET /stream                                     | SSE global (heartbeat 15s)       |
| `bridge-tasks.js`   | POST /send /answer                              | Fila de tarefas                  |

Total: **14 endpoints REST** em `/api/copilot/*` + ~**20 endpoints SDK** em `/api/sdk/*` via
routes/.

---

## 12. Análise da Pasta `routes/`

| Arquivo       | Endpoints principais                                                                     |
| ------------- | ---------------------------------------------------------------------------------------- |
| `agent.js`    | GET /agent/info /tools /telemetry; POST /agent/telemetry/clear; GET /agent/state /stream |
| `client.js`   | GET /ping /status /auth /models /tools; POST /client/start /stop /force-stop             |
| `sessions.js` | GET/POST /sessions; GET/DELETE/POST /sessions/:id + 7 sub-rotas                          |
| `webhooks.js` | GET/POST /webhooks; DELETE /webhooks/:id                                                 |

Todos os routers usam `withErrorHandler(req, res, fn)` para captura uniforme de erros.

---

## 13. Análise da Pasta `channel/`

Dois modos complementares de comunicação entre LLM-A e LLM-B:

| Modo               | Arquivo     | Quando usar                                           |
| ------------------ | ----------- | ----------------------------------------------------- |
| **HTTP injection** | `inject.js` | Terminal LLM-B já ativo (`npm run terminal:llm-b`)    |
| **SDK in-process** | `client.js` | Scripts standalone que iniciam sessão SDK diretamente |

`CHANNEL_VERSION = '1'` — controle de evolução do protocolo.

`audit.js` é transversal — audita tool calls independente do canal via correlação `_pending Map`.

---

## 14. Análise da Pasta `lib/`

Camada de abstrações **puras e sem side effects** sobre o SDK. Nenhum singleton é iniciado no
import. Exporta ~80 símbolos via barrel.

| Sub-módulo          | Responsabilidade                                                           |
| ------------------- | -------------------------------------------------------------------------- |
| `client.js`         | `CopilotClient` singleton + registry em memória de sessões ativas          |
| `session.js`        | `createSession`, `resumeOrCreate`, `listSessions`, etc.                    |
| `hooks.js`          | Factories de `SessionHooks`                                                |
| `permissions.js`    | Factories de `PermissionHandler` (approveAll, auditOnly, safe, restricted) |
| `agents.js`         | `createAgent`, `createReadOnlyAgent`, `createFullAccessAgent`              |
| `models.js`         | `listModels`, `pickModel`, `buildReasoningConfig`                          |
| `tools-registry.js` | Registry com metadados (categoria, tags, readOnly)                         |
| `telemetry.js`      | Store circular buffer (500 records) — toolCalls, sessions, latência        |

---

## 15. Análise da Pasta `tools/`

11 arquivos de Custom Tools registradas via SDK `defineTool()`:

| Categoria             | Ferramentas                                                            |
| --------------------- | ---------------------------------------------------------------------- |
| `task-tools`          | `get_tasks`, `add_task`, `update_task_status`                          |
| `code-tools`          | `lint_check`, `run_tests`, `typecheck`                                 |
| `file-tools`          | `read_file_content`, `write_file`, `list_directory`, `search_in_files` |
| `git-tools`           | `git_status`, `git_diff`, `git_log`, `git_commit`                      |
| `hook-tools`          | `hook_get_audit_tail`, `request_user_input`                            |
| `hub-tools`           | `hub_send_message`, `hub_get_history`, `hub_create_session`            |
| `introspection-tools` | `get_agent_status`, `list_tools`, `get_telemetry`                      |
| `session-tools`       | `get_session_state`, `set_model`, `compact_session`                    |
| `shell-tools`         | `run_shell_command`, `run_npm_script`, `run_node_script`               |

`tool-factory.js` — `buildTool()`: factory genérica para tools declarativas. `skipPermission: true`
marcado via `withSkipPermission()` nas tools de leitura.

---

## 16. Arquitetura do ConversationHub

```
conversationHub (singleton — hub.js)
    │
    ├── init({ io, nerv })
    │       │
    │       ├── conversationStore.init()     ← DDL idempotente (store.js)
    │       │       └── maestro.sqlite
    │       │           ├── copilot_hub_sessions
    │       │           ├── copilot_conversation_turns (FK cascade)
    │       │           └── copilot_memories + FTS5 virtual table
    │       │
    │       ├── new HubOrchestrator(store)   ← orchestrator.js
    │       │       └── orchestrator.init()
    │       │               ├── new LlmBridgeClient()
    │       │               └── restaura turnCounters das sessões ativas do DB
    │       │
    │       └── mountCopilotNamespace(io, orchestrator, store)  ← socket-ns.js
    │               └── io.of('/copilot')
    │                   ├── middleware JWT (opcional)
    │                   └── events: join:session, inject:message, get:history
    │
    ├── hub.sendToLlmB(hubSessionId, message)
    │       └── orchestrator.sendToLlmB()
    │               ├── store.writeTurn({ role: 'llm_a', … })     emit('turn:sent')
    │               ├── bridge.chat(message) ou bridge.chatStructured()
    │               │       → LlmBridgeClient → AlwaysAliveAgent → SDK session
    │               ├── store.writeTurn({ role: 'llm_b', … })     emit('turn:complete')
    │               └── broadcastToSession(hubSessionId, 'turn:complete', …)
    │
    └── hub.injectUserMessage(hubSessionId, content)
            └── orchestrator.injectUserMessage()
                    ├── store.writeTurn({ role: 'user', user_read: 0, … })
                    └── emit('user:injected', …)
```

**Persistência**: usa `maestro.sqlite` compartilhado. Hub sessions são independentes das sessões SDK
— `sdk_session_id` é referência fraca.

---

## 17. Subsistema Terminal (Visão Consolidada)

```
Porta 3009 (terminal/server.js)
    │
    ├── GET  /health, /config, /config/skills, /config/tools
    ├── PUT  /config/infinite-session, /config/skills, /config/tools
    ├── POST /config/custom-tools, /memory, /pipeline, /inject (rate limited 10/IP/60s)
    ├── GET  /memory, /sessions, /sessions/:id/turns
    ├── DEL  /memory/:id, /config/custom-tools/:name
    ├── GET  /events (SSE — nível padrão + ?level=critical)
    └── GET  /gh/issues /gh/prs /gh/ci /git/status /git/log

State (terminal/state.js)
    ├── _hubSessionId     — ID da hub_session ativa
    ├── _busy             — flag de turno em andamento
    ├── _rl               — instância readline
    ├── _attachmentQueue  — fila de anexos pendentes
    ├── _planMode         — modo /plan ativo
    ├── _sseClients       — Set de clients SSE conectados
    └── _sseCriticalClients — Set de clients SSE nível crítico

REPL (terminal/repl.js)
    ├── PROMPT_USER = 'você› '
    ├── BANNER completo com todos os comandos e endpoints
    └── 14 handlers de comando em commands/

Dialog Motor (terminal/dialog.js)
    ├── TURN_TIMEOUT_MS = 120 000 ms
    ├── CRITICAL_EVENTS = { 'stalled', 'fatal', 'system' }
    ├── ensureDialogLoop() — inicia loop se não ativo
    ├── sendTurn() — orquestra turno completo com persistência + broadcast
    └── broadcastSse() — dual-emit: SSE raw + Socket.io /copilot
```

---

## Sumário Executivo

O módulo `src/copilot` é um sistema **maduro e bem estruturado** com 12 camadas arquiteturais bem
definidas, cobrindo desde contratos centrais até terminal interativo.

**Pontos fortes:**

- Sem side-effects no import em toda a camada `lib/`
- Segurança embutida nas shell-tools (blocklist, whitelist, cwd restrito)
- Auditoria JSONL com rotação automática de 10 MB
- StructuredMessage tipado com Zod (Sprint A)
- Dialog Loop §15.8 elimina custo por turno
- FTS5 com Porter stemmer para busca semântica em memórias

**Pontos de atenção críticos (por prioridade):**

| #    | Issue                                                   | Impacto        | Ação                                            |
| ---- | ------------------------------------------------------- | -------------- | ----------------------------------------------- |
| 9.4  | `orchestrator.js` importa por shim deprecated           | Médio          | Substituir por `channel/client.js`              |
| 9.5  | `routes/agent.js` acessa campos privados via cast `any` | Médio          | Adicionar getters públicos a `AlwaysAliveAgent` |
| 9.6  | `task-tools.js` usa `execSync + curl`                   | Médio          | Substituir por `http.request` nativo            |
| 9.7  | Timeouts inconsistentes (120s vs 130s)                  | Baixo          | Centralizar em `core/constants.js`              |
| 9.1  | 13 shims legados na raiz                                | DX             | Remover em PR de limpeza                        |
| 9.2  | `sdk-client.js` oculta mapeamento de nomes              | DX             | Documentar ou migrar chamadores                 |
| 9.10 | Sem limite de clientes SSE                              | Potencial leak | Adicionar controle de MAX_SSE_CLIENTS           |
| 9.12 | Migração FTS5 a cada `init()`                           | Risco          | Verificar versão antes de migrar                |
