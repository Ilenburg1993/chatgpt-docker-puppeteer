# `src/copilot` — Documentação Oficial do Módulo

**Versão**: 2.0 (pós-Fase AI) | **Data**: 2026-03-15 | **Status**: ✅ Canônico

> Este documento é a referência oficial e completa para o módulo `src/copilot`. Substitui análises parciais em arquivos anteriores. Baseado na inspeção exaustiva do código-fonte combinada com o histórico de fases de desenvolvimento (AE → AI).

---

## Índice

1. [Visão Geral e Propósito](#1-visão-geral-e-propósito)
2. [Estrutura de Pastas](#2-estrutura-de-pastas)
3. [Camadas Arquiteturais](#3-camadas-arquiteturais)
4. [Análise Detalhada por Módulo](#4-análise-detalhada-por-módulo)
5. [Fluxos Operacionais](#5-fluxos-operacionais)
6. [API Surface (Endpoints HTTP)](#6-api-surface-endpoints-http)
7. [Eventos do Sistema](#7-eventos-do-sistema)
8. [Persistência e Estado](#8-persistência-e-estado)
9. [Segurança](#9-segurança)
10. [Diagnóstico: Shims Legados](#10-diagnóstico-shims-legados)
11. [Issues e Pontos de Atenção](#11-issues-e-pontos-de-atenção)
12. [Inventário Completo de Arquivos](#12-inventário-completo-de-arquivos)

---

## 1. Visão Geral e Propósito

O módulo `src/copilot` é um **sistema autônomo de orquestração de agente LLM** construído sobre o SDK oficial `@github/copilot-sdk`. Suas responsabilidades centrais são:

- Manter uma sessão SDK de longa duração (Always-Alive) com persistência e recovery automático
- Expor interfaces de comunicação duplas: **HTTP REST** (para LLM-A e sistemas externos) e **REPL interativo** (terminal)
- Orquestrar conversas multi-turno entre LLM-A ↔ LLM-B ↔ Usuário com persistência SQLite
- Registrar e executar Custom Tools (SDK nativo + MCP + declarativas via API)
- Integrar com o barramento de eventos NERV e broadcast SSE/Socket.io em tempo real

**Tecnologias-chave**: Node.js >=24, ESM, `@github/copilot-sdk`, better-sqlite3, Socket.io, readline.

---

## 2. Estrutura de Pastas

```
src/copilot/
│
├── agent/              # Núcleo do agente Always-Alive
├── api/                # Camada REST — Express routers
├── bridges/            # Integrações externas (NERV, git, gh, MCP, aliases)
├── channel/            # Canal de comunicação LLM-A ↔ LLM-B
├── config/             # Configuração de sessões, ferramentas e sistema
├── conversation-hub/   # Ambiente de conversa persistente (SQLite + Socket.io)
├── core/               # Contratos centrais (erros, constantes, types)
├── lib/                # Abstrações puras sobre o Copilot SDK
├── routes/             # Express routers para /api/sdk/*
├── terminal/           # Terminal interativo LLM-B (porta 3009)
├── tools/              # Definições de Custom Tools SDK
├── types/              # Tipos do protocolo de comunicação
│
│   ── Shims de compatibilidade na raiz (@deprecated) ──
├── agent.js            → agent/entry.js
├── always-alive.js     → agent/always-alive.js
├── session-manager.js  → agent/session-manager.js
├── nerv-bridge.js      → bridges/nerv-bridge.js
├── gh-bridge.js        → bridges/gh-bridge.js
├── git-bridge.js       → bridges/git-bridge.js
├── http-bridge.js      → api/http-bridge.js
├── inject-llmb.js      → channel/inject.js
├── llm-bridge-client.js→ channel/client.js
├── mcp-tool-bridge.js  → bridges/mcp-tool-bridge.js
├── sdk-api.js          → api/sdk-api.js
├── sdk-client.js       → lib/client.js (com mapeamento de nomes)
├── alias-store.js      → bridges/alias-store.js
│
└── terminal-server.js  # Entry point histórico → terminal/index.js
```

### Arquivos na raiz `src/copilot/`

| Arquivo                | Tipo         | Aponta para                  | Status      |
| ---------------------- | ------------ | ---------------------------- | ----------- |
| `agent.js`             | Re-export    | `agent/entry.js`             | @deprecated |
| `always-alive.js`      | Re-export    | `agent/always-alive.js`      | @deprecated |
| `session-manager.js`   | Re-export    | `agent/session-manager.js`   | @deprecated |
| `nerv-bridge.js`       | Re-export    | `bridges/nerv-bridge.js`     | @deprecated |
| `gh-bridge.js`         | Re-export    | `bridges/gh-bridge.js`       | @deprecated |
| `git-bridge.js`        | Re-export    | `bridges/git-bridge.js`      | @deprecated |
| `http-bridge.js`       | Re-export    | `api/http-bridge.js`         | @deprecated |
| `inject-llmb.js`       | Re-export    | `channel/inject.js`          | @deprecated |
| `llm-bridge-client.js` | Re-export    | `channel/client.js`          | @deprecated |
| `mcp-tool-bridge.js`   | Re-export    | `bridges/mcp-tool-bridge.js` | @deprecated |
| `sdk-api.js`           | Re-export    | `api/sdk-api.js`             | @deprecated |
| `alias-store.js`       | Re-export    | `bridges/alias-store.js`     | @deprecated |
| `sdk-client.js`        | Wrapper      | `lib/client.js`              | @deprecated |
| `terminal-server.js`   | Entry legacy | `terminal/index.js`          | @deprecated |

> **Ação necessária**: todos os 14 arquivos raiz são candidatos a remoção. Ver [Issue 9.1](#91-13-shims-legados-na-raiz).

---

## 3. Camadas Arquiteturais

O módulo é organizado em 12 níveis, do mais abstrato ao mais concreto:

| Nível | Camada                   | Pacotes/Módulos                                                                                                                                                   |
| :---: | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   0   | **Contratos Centrais**   | `core/` — `errors.js`, `constants.js`, `types.js`                                                                                                                 |
|   1   | **Abstrações SDK**       | `lib/` — `client.js`, `session.js`, `hooks.js`, `permissions.js`, `models.js`, `tools-registry.js`, `telemetry.js`, `agents.js`                                   |
|   2   | **Tipos de Protocolo**   | `types/` — `structured-message.js`, `index.js`                                                                                                                    |
|   3   | **Agente Core**          | `agent/` — `always-alive.js`, `session-manager.js`, `tools-bootstrap.js`, `events.js`, `task-executor.js`, `dialog-watchdog.js`, `webhook-manager.js`             |
|   4   | **Custom Tools**         | `tools/` — 9 categorias + `tool-factory.js`                                                                                                                       |
|   5   | **Canal de Comunicação** | `channel/` — `client.js`, `inject.js`, `audit.js`                                                                                                                 |
|   6   | **Configuração**         | `config/` — `session-config.js`, `system-prompt.js`, `mcp-servers.js`, `tools-state.js`, `custom-tools-registry.js`, `custom-agents.js`, `pinned-files-loader.js` |
|   7   | **Hub de Conversa**      | `conversation-hub/` — `hub.js`, `orchestrator.js`, `store.js`, `socket-ns.js`                                                                                     |
|   8   | **Integrações Externas** | `bridges/` — `nerv-bridge.js`, `gh-bridge.js`, `git-bridge.js`, `mcp-tool-bridge.js`, `alias-store.js`                                                            |
|   9   | **API REST**             | `api/` — `http-bridge.js` (4 sub-routers) + `sdk-api.js` (4 routers de `routes/`)                                                                                 |
|  10   | **Routers Express**      | `routes/` — `agent.js`, `client.js`, `sessions.js`, `webhooks.js`                                                                                                 |
|  11   | **Terminal Interativo**  | `terminal/` — `server.js`, `repl.js`, `dialog.js`, `http-handlers.js`, `state.js`, `file-context.js`, `workspace-context.js`, `commands/`                         |
|  12   | **Entry Points**         | `agent/entry.js`, `terminal/index.js`                                                                                                                             |

---

## 4. Análise Detalhada por Módulo

### 4.1 `agent/` — Núcleo do Agente

#### `agent/always-alive.js` ⭐ ARQUIVO CRÍTICO

**Responsabilidade**: Singleton central. Gerencia todo o ciclo de vida da sessão SDK: inicialização, execução de tarefas, dialog loop, reconexão, compaction e encerramento.

**Classe**: `AlwaysAliveAgent extends EventEmitter`

**Singleton exportado**: `alwaysAliveAgent`

**Campos privados**:

| Campo                 | Tipo                                        | Propósito                                          |
| --------------------- | ------------------------------------------- | -------------------------------------------------- |
| `#client`             | `CopilotClient \| null`                     | Instância do SDK client                            |
| `#session`            | `CopilotSession \| null`                    | Sessão SDK ativa                                   |
| `#status`             | `AgentStatus`                               | idle/processing/waiting_for_input/starting/stopped |
| `#queue`              | `AgentTask[]`                               | Fila de tarefas pendentes (MAX=100)                |
| `#pendingQuestion`    | `{resolve, reject} \| null`                 | Pergunta pendente do modelo                        |
| `#dialogLoopActive`   | `boolean`                                   | Flag do dialog loop                                |
| `#watchdog`           | `DialogWatchdog \| null`                    | Monitor de estagnação                              |
| `#sendCount`          | `number`                                    | Contador persistido de mensagens enviadas          |
| `#contextState`       | `{tokens, tokenLimit, utilization} \| null` | Estado atual do context window                     |
| `#lastCheckpointPath` | `string \| null`                            | Último checkpoint de compaction                    |
| `#telemetry`          | `TelemetryStore \| null`                    | Store de telemetria da sessão                      |
| `#toolsRegistry`      | `ToolRegistry \| null`                      | Registry de tools da sessão                        |
| `#isResumed`          | `boolean`                                   | Indica se sessão foi retomada                      |

**Constantes**:
- `MAX_QUEUE_SIZE = 100`
- Watchdog: intervalo 5 min, stall 15 min

**Métodos públicos**:

| Método                               | Descrição                                             |
| ------------------------------------ | ----------------------------------------------------- |
| `start()`                            | Inicializa cliente, tools, sessão e wiring de eventos |
| `stop({ shutdownTimeoutMs })`        | Para graciosamente (aguarda tarefa ativa)             |
| `sendMessage(message, opts)`         | Enfileira mensagem com optional attachments           |
| `startDialogLoop()`                  | Inicia dialog loop infinito (mode §15.8)              |
| `sendDialogTurn(message, opts)`      | Injeta turno no dialog loop ativo                     |
| `stopDialogLoop()`                   | Encerra dialog loop                                   |
| `answerPendingQuestion(answer)`      | Responde pergunta pendente do modelo                  |
| `getStatusSnapshot()`                | Retorna snapshot completo do estado                   |
| `setModel(model)`                    | Altera modelo em runtime                              |
| `setReasoningEffort(effort)`         | Altera modo de raciocínio em runtime                  |
| `compactSession()`                   | Aciona compaction manual da sessão                    |
| `registerWebhook(url, events, opts)` | Registra webhook de notificação                       |
| `unregisterWebhook(id)`              | Remove webhook                                        |
| `listWebhooks()`                     | Lista webhooks ativos                                 |

**Método privado crítico**: `#syncSdkHistory(session)` — sincroniza histórico SDK → SQLite após retomada (AI.4).

---

#### `agent/session-manager.js`

**Responsabilidade**: Persistência do estado de sessão SDK em disco; lógica de `initOrResumeSession`.

**Arquivo de estado**: `.github/hooks/state/sdk-always-alive.json`

**Exports principais**:

| Export                                  | Descrição                                       |
| --------------------------------------- | ----------------------------------------------- |
| `readState()`                           | Lê estado em disco (null se inexistente)        |
| `writeState(data)`                      | Persiste estado em disco                        |
| `clearState()`                          | Remove arquivo de estado                        |
| `initOrResumeSession(client, opts)`     | Tenta resumir sessão salva, cria nova se falhar |
| `buildHookSystemContext()`              | Injeta contexto dos hooks no system message     |
| `setBackgroundCompactionThreshold(val)` | Configura limiar de compaction automática       |
| `loadToolsConfig()`                     | Carrega `tools-config.json` (AI.1)              |

**Schema de estado** (`sdk-always-alive.json`):
```json
{
  "sessionId": "string",
  "status": "active",
  "lastUpdated": "ISO8601",
  "sendCount": 0,
  "model": "string"
}
```

**Auditoria JSONL**: tool calls de alto risco (`bash`, `edit`, `create`, `git_apply_patch`) são auditadas em `logs/tool-audit.jsonl` com rotação a 10 MB. Background compaction threshold padrão: 0.75.

---

#### `agent/events.js`

**Responsabilidade**: Constantes canônicas de nomes de eventos (26 eventos).

**`AGENT_EVENTS`** (array readonly):

| Categoria | Eventos                                                                                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task      | `task.queued`, `task.started`, `task.completed`, `task.error`, `task.delta`, `task.reasoning`                                                                                                            |
| Question  | `question.pending`, `question.answered`                                                                                                                                                                  |
| Session   | `session.compaction_start`, `session.compaction_complete`, `session.fatal`, `session.usage`, `session.token_budget_warning`, `session.mode_changed`, `session.context_changed`, `session.history_synced` |
| Dialog    | `dialog.ready`, `dialog.reply`, `dialog.stopped`, `dialog.stalled`                                                                                                                                       |
| Tool      | `tool.execution.start`, `tool.execution.complete`                                                                                                                                                        |
| Misc      | `status`, `stopped`, `ready`, `error`                                                                                                                                                                    |

---

#### `agent/tools-bootstrap.js`

**Responsabilidade**: Registra todas as Custom Tools por categoria no boot do agente.

**Função**: `bootstrapTools(registry, telemetry, mcpTools) → Tool[]`

**Categorias registradas** (11+custom):

| Categoria       | Arquivo origem                    | Tools                                                       |
| --------------- | --------------------------------- | ----------------------------------------------------------- |
| `task`          | `tools/task-tools.js`             | `get_tasks`, `add_task`, `update_task_status`               |
| `code`          | `tools/code-tools.js`             | `lint_check`, `run_tests`, `typecheck`                      |
| `git`           | `tools/git-tools.js`              | `git_status`, `git_diff`, `git_log`, `git_commit`           |
| `session`       | `tools/session-tools.js`          | `get_session_state`, `set_model`, `compact_session`         |
| `hook`          | `tools/hook-tools.js`             | `hook_get_audit_tail`, `request_user_input`                 |
| `hub`           | `tools/hub-tools.js`              | `hub_send_message`, `hub_get_history`, `hub_create_session` |
| `introspection` | `tools/introspection-tools.js`    | `get_agent_status`, `list_tools`, `get_telemetry`           |
| `fileRead`      | `tools/file-tools.js`             | `read_file_content`, `list_directory`, `search_in_files`    |
| `fileWrite`     | `tools/file-tools.js`             | `write_file`                                                |
| `shell`         | `tools/shell-tools.js`            | `run_shell_command`, `run_npm_script`, `run_node_script`    |
| `mcp`           | `bridges/mcp-tool-bridge.js`      | tools carregadas dinamicamente via MCP                      |
| `custom`        | `config/custom-tools-registry.js` | tools registradas via API em runtime                        |

---

#### `agent/task-executor.js`

**Responsabilidade**: Extrai a execução de tarefa individual da classe `AlwaysAliveAgent` para testabilidade.

**Função**: `executeTask(session, task, callbacks)`

- Assina `assistant.message_delta` (streaming delta → `task.delta`)
- Assina `tool.execution_start/complete` (auditoria)
- `session.sendAndWait({ prompt, attachments? })` com timeout default 60 s
- Callbacks: `onDelta(chunk)`, `onReasoning(chunk)`, `onToolStart(evt)`, `onToolComplete(evt)`, `onReconnect()`

---

#### `agent/dialog-watchdog.js`

**Responsabilidade**: Monitor de inatividade isolado para o dialog loop.

**Classe**: `DialogWatchdog`

**API**: `start()`, `stop()`, `ping()` — callback `onStall(stalledMs)` disparado quando `now - lastPing > stallMs`.

---

#### `agent/webhook-manager.js`

**Responsabilidade**: Gerenciamento de webhooks HTTP de notificação.

**Classe**: `WebhookManager`

**API**: `register(url, events, meta)`, `unregister(id)`, `list()`, `emit(eventName, payload)`.

- ID gerado: `wh_{timestamp}_{random5chars}`
- Fire-and-forget via `Promise.allSettled`
- Filtra por lista de eventos configurada por webhook

---

### 4.2 `lib/` — Abstrações Puras do SDK

Camada de wrappers sem side-effects — nenhum singleton é inicializado no `import`.

| Arquivo             | Responsabilidade                                       | Exports-chave                                                                                                             |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `client.js`         | `CopilotClient` singleton + registry de sessões ativas | `getClient()`, `getActiveSessions()`, `registerSession()`                                                                 |
| `session.js`        | Ciclo de vida de sessões SDK                           | `createSession()`, `resumeOrCreate()`, `listSessions()`, `deleteSession()`                                                |
| `hooks.js`          | Factories de `SessionHooks`                            | `createHooks()`, `createAuditHooks()`, `createMinimalHooks()`                                                             |
| `permissions.js`    | Factories de `PermissionHandler`                       | `createApproveAllPermission()`, `createAuditPermission()`, `createSafePermission()`                                       |
| `agents.js`         | Builders de `CustomAgentConfig`                        | `createAgent()`, `createReadOnlyAgent()`, `createFullAccessAgent()`                                                       |
| `models.js`         | Helpers de modelos                                     | `listModels()`, `pickModel()`, `buildReasoningConfig()`                                                                   |
| `tools-registry.js` | Registry com metadados (categoria, tags, readOnly)     | `createRegistry()`, `registerTools()`, `getToolsByCategory()`, `filterByNames()`, `excludeByNames()`, `mergeRegistries()` |
| `telemetry.js`      | Store em memória (buffer circular, maxRecords=500)     | `createTelemetry()`, `recordToolCall()`, `recordSessionStart/End()`, `getSummary()`, `startSpan()`                        |

**`startSpan(name, attrs, fn)` (AI.3)**: wrapper OTEL com graceful degradation — tenta usar `@opentelemetry/sdk-trace-node` se instalado; caso contrário executa `fn()` diretamente com logging de latência.

---

### 4.3 `channel/` — Canal de Comunicação

Dois modos complementares de LLM-A → LLM-B:

| Modo               | Arquivo     | Quando usar                                               |
| ------------------ | ----------- | --------------------------------------------------------- |
| **HTTP injection** | `inject.js` | Terminal LLM-B já ativo em processo separado (porta 3009) |
| **SDK in-process** | `client.js` | Scripts standalone que iniciam sessão SDK diretamente     |

#### `channel/inject.js`

**Função principal**: `injectToLlmB(message, actor, opts)` — HTTP POST para `/inject`

**Outras exports**: `checkLlmBHealth()`, `injectPipeline(steps)`, `subscribeLlmB(url, handler)`, `subscribeLlmBCritical(url, handler)`, `waitForLlmBReady(timeoutMs)`

- Usa `http.request` nativo (sem fetch)
- Timeout: `LLM_B_TURN_TIMEOUT ?? 120_000` ms (centralizado em `core/constants.js` — `LLM_B_TURN_TIMEOUT_MS`)
- Rate: `INJECT_RATE_MAX = 10 req/IP/60 s` (controlado no servidor)

#### `channel/client.js`

**Classe**: `LlmBridgeClient`

- `#history`: buffer turn-by-turn
- `chat(message)`: envio simples — retorna resposta completa
- `chatStructured(request)`: usa protocolo `StructuredMessage`
- `dialogTurn(message, opts)`: turno único no dialog loop ativo
- `turnCount`: getter do contador de turnos

#### `channel/audit.js`

**Responsabilidade**: Auditoria JSONL de tool calls (correlação start/complete).

- `auditToolStart(entry)`, `auditToolComplete(entry)`, `getAuditSummary()`
- Rotação: ao atingir 10 MB → renomeia `tool-audit.jsonl` → `tool-audit.jsonl.1`
- `_pending: Map<toolCallId, …>` para correlação

---

### 4.4 `config/` — Configuração

| Arquivo                    | Responsabilidade                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `session-config.js`        | Builders de `SessionConfig` — `buildAlwaysAliveConfig()`, `buildReadOnlyConfig()`, `buildFullAccessConfig()`                        |
| `system-prompt.js`         | Constantes e builders do system prompt: `AGENT_IDENTITY`, `AGENT_TONE`, `buildAppendSystemMessage()`, `buildReplaceSystemMessage()` |
| `mcp-servers.js`           | `buildMcpConfig()` — array de configurações de MCP servers                                                                          |
| `tools-state.js`           | Estado de habilitação de tools em runtime; persistência em `tools-config.json` (AI.1)                                               |
| `custom-tools-registry.js` | Registry dinâmico de tools via API; persistência em `custom-tools.json` (AI.2)                                                      |
| `custom-agents.js`         | `CustomAgentConfig` builders                                                                                                        |
| `pinned-files-loader.js`   | Carrega arquivos fixos como contexto de sessão                                                                                      |

#### `config/tools-state.js` (AI.1)

**Estado**: `{ allowlist: string[] | null, denylist: string[] }`

**Persistência**: `tools-config.json` na raiz do projeto

**Exports**: `getToolsConfig()`, `patchToolsConfig(updates)`, `loadToolsConfig()`, `saveToolsConfig()`

#### `config/custom-tools-registry.js` (AI.2)

**Handlers embutidos** (`BUILTIN_HANDLER_MAP`):

| Key         | Comportamento                       |
| ----------- | ----------------------------------- |
| `echo`      | Retorna a mensagem de input         |
| `timestamp` | Retorna ISO8601 do momento          |
| `env_read`  | Lê variável de ambiente (allowlist) |

**Exports**: `loadCustomToolsRegistry()`, `getCustomTools()`, `listCustomToolEntries()`, `registerCustomTool(entry)`, `unregisterCustomTool(name)`, `buildCustomTools()`, `getCustomToolDefinitions()`

---

### 4.5 `conversation-hub/` — Hub de Conversa

#### `conversation-hub/hub.js`

**Singleton**: `conversationHub`

**Método principal**: `init({ io, nerv })` — idempotente, inicializa Store → Orchestrator → Socket.io NS

**Atalhos de API**:
- `createSession(metadata)` → `store.createHubSession(metadata)`
- `sendToLlmB(hubSessionId, message)` → `orchestrator.sendToLlmB(...)`
- `injectUserMessage(hubSessionId, content)` → `orchestrator.injectUserMessage(...)`
- `pollUserMessages(hubSessionId, since)` → `store.getPendingUserMessages(...)`

#### `conversation-hub/store.js`

**Banco**: `maestro.sqlite` (shared com o projeto)

**Tabelas**:

| Tabela                       | Propósito                                       |
| ---------------------------- | ----------------------------------------------- |
| `copilot_hub_sessions`       | Sessões de conversa (hub-level)                 |
| `copilot_conversation_turns` | Turnos individuais (FK cascade)                 |
| `copilot_memories`           | Memórias persistentes + FTS5 (Porter unicode61) |

**Métodos principais**:

| Método                                                     | Descrição                              |
| ---------------------------------------------------------- | -------------------------------------- |
| `createHubSession(metadata)`                               | Cria nova hub session                  |
| `writeTurn(hubSessionId, turnData)`                        | Insere turno na conversa               |
| `getSessionTurns(hubSessionId, limit)`                     | Retorna turnos paginados               |
| `writeMemory(hubSessionId, content, tags)`                 | Persiste memória                       |
| `searchMemories(query, limit)`                             | Busca FTS5 (Porter stemmer)            |
| `syncFromSdkHistory(hubSessionId, sdkSessionId, messages)` | AI.4 — sincroniza histórico SDK→SQLite |

#### `conversation-hub/orchestrator.js`

**Classe**: `HubOrchestrator extends EventEmitter`

**Eventos emitidos**: `turn:sent`, `turn:delta`, `turn:complete`, `user:injected`, `session:created`, `session:closed`, `error`

**Mantém**: `#turnCounters: Map<hubSessionId, nextTurnNumber>` — restaurados do DB no `init()`

#### `conversation-hub/socket-ns.js`

**Namespace Socket.io**: `/copilot`

**Autenticação**: controlada por `COPILOT_HUB_SOCKET_AUTH_REQUIRED` (override) ou `DASHBOARD_SOCKET_AUTH_REQUIRED`

**Eventos recebidos do cliente**: `join:session`, `inject:message`, `get:history`

---

### 4.6 `bridges/` — Integrações Externas

| Arquivo              | Responsabilidade                                                 |
| -------------------- | ---------------------------------------------------------------- |
| `nerv-bridge.js`     | Ponte AlwaysAliveAgent ↔ NERV event bus (25 eventos mapeados)    |
| `gh-bridge.js`       | Wrapper `gh` CLI via `execFile`                                  |
| `git-bridge.js`      | Wrapper `git` CLI via `execFile`                                 |
| `mcp-tool-bridge.js` | Carregamento dinâmico de tools via MCP JSON-RPC 2.0              |
| `alias-store.js`     | 10 aliases embutidos + persistência em `~/.copilot-aliases.json` |

#### `bridges/nerv-bridge.js`

**Exports**: `copilotNervBridge { mount(nerv), unmount(), isActive() }`, `emitNerv(actionCode, payload)`

**Envelope**: `{ actor: 'COPILOT', actionCode, messageType: 'EVENT', payload, timestamp }`

**ACTION_CODES incluem**: `COPILOT_STATUS`, `COPILOT_READY`, `COPILOT_TASK_*`, `COPILOT_SESSION_*`, `COPILOT_TOOL_*`, `COPILOT_SESSION_HISTORY_SYNCED` (AI.4)

#### `bridges/mcp-tool-bridge.js`

- Timeout: 8 s (`AbortSignal.timeout`)
- Converte JSON Schema → Zod (`buildZodSchema()`)
- Suporte a: `enum`, objetos aninhados, arrays

---

### 4.7 `api/` — Camada REST Express

Dois aggregators principais:

```
api/http-bridge.js (/api/copilot/*)
    ├── bridge-control.js  → GET /status /health /session; POST /start /stop
    ├── bridge-tasks.js    → POST /send /answer
    ├── bridge-stream.js   → GET /stream (SSE + heartbeat 15 s)
    └── bridge-dialog.js   → POST /dialog/start /dialog/turn /dialog/stop

api/sdk-api.js (/api/sdk/*)
    ├── routes/agent.js    → GET /agent/info /tools /telemetry /state /stream
    ├── routes/client.js   → GET /ping /status /auth /models /tools; POST /client/*
    ├── routes/sessions.js → CRUD /sessions/*
    └── routes/webhooks.js → CRUD /webhooks
```

> **Nota**: `copilot-router.js` e `sdk-router.js` são apenas re-exports de `http-bridge.js` e `sdk-api.js` respectivamente.

---

### 4.8 `terminal/` — Terminal Interativo (Porta 3009)

| Arquivo                | Responsabilidade                                                       |
| ---------------------- | ---------------------------------------------------------------------- |
| `index.js`             | `startTerminalServer()` — orquestração do boot completo                |
| `server.js`            | `createInjectServer()` — HTTP server raw (`node:http`)                 |
| `repl.js`              | `startRepl()` — readline REPL interativo                               |
| `dialog.js`            | Motor de diálogo: `sendTurn()`, `broadcastSse()`, `ensureDialogLoop()` |
| `http-handlers.js`     | Command Pattern — handlers puros para todos os endpoints               |
| `state.js`             | Estado global compartilhado do terminal                                |
| `file-context.js`      | Builder de contexto de arquivo para injeção                            |
| `workspace-context.js` | Builder de contexto de workspace para injeção                          |

#### `terminal/state.js` — Estado Global

| Getter/Setter             | Tipo                  | Propósito                                   |
| ------------------------- | --------------------- | ------------------------------------------- |
| `getHubSessionId()`       | `string \| null`      | Hub session ativa                           |
| `getBusy()` / `setBusy()` | `boolean`             | Flag de turno em processamento              |
| `getRl()` / `setRl()`     | `readline \| null`    | Instância readline ativa                    |
| `getAttachmentQueue()`    | `string[]`            | Fila de arquivos a embutir no próximo turno |
| `getPlanMode()`           | `boolean`             | Prefácio de planejamento ativo              |
| `getSseClients()`         | `Set<ServerResponse>` | Clientes SSE conectados                     |
| `getSseCriticalClients()` | `Set<ServerResponse>` | Clientes SSE nível crítico                  |

#### `terminal/http-handlers.js` — Endpoints

| Handler                  | Método | Rota                         |
| ------------------------ | ------ | ---------------------------- |
| `handleStatus`           | GET    | `/health`                    |
| `handleGetConfig`        | GET    | `/config`                    |
| `handleGetSkills`        | GET    | `/config/skills`             |
| `handlePostSkills`       | PUT    | `/config/skills`             |
| `handleGetTools`         | GET    | `/config/tools`              |
| `handlePutTools`         | PUT    | `/config/tools`              |
| `handleGetCustomTools`   | GET    | `/config/tools/custom`       |
| `handlePostCustomTool`   | POST   | `/config/tools/custom`       |
| `handleDeleteCustomTool` | DELETE | `/config/tools/custom/:name` |
| `handleInfiniteSession`  | PUT    | `/config/infinite-session`   |
| `handleInject`           | POST   | `/inject`                    |
| `handlePipeline`         | POST   | `/pipeline`                  |
| `handleMemoryPost`       | POST   | `/memory`                    |
| `handleMemoryGet`        | GET    | `/memory`                    |
| `handleMemoryDelete`     | DELETE | `/memory/:id`                |
| `handleGetSessions`      | GET    | `/sessions`                  |
| `handleGetSessionTurns`  | GET    | `/sessions/:id/turns`        |
| `handleGhIssues`         | GET    | `/gh/issues`                 |
| `handleGhPrs`            | GET    | `/gh/prs`                    |
| `handleGhCi`             | GET    | `/gh/ci`                     |
| `handleGitStatus`        | GET    | `/git/status`                |
| `handleGitLog`           | GET    | `/git/log`                   |

#### `terminal/commands/` — Comandos REPL

| Arquivo      | Comandos REPL disponíveis                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `alias.js`   | `/alias list`, `/alias add`, `/alias remove`                                                            |
| `attach.js`  | `/attach <caminho>` — adiciona arquivo à fila de contexto                                               |
| `config.js`  | `/model <nome>`, `/reasoning <effort>`                                                                  |
| `context.js` | `/compact`, `/context`                                                                                  |
| `gh.js`      | `/gh issues`, `/gh prs`, `/gh ci`                                                                       |
| `git.js`     | `/git status`, `/git log`                                                                               |
| `help.js`    | `/help`                                                                                                 |
| `memory.js`  | `/remember <texto>`, `/recall <query>`, `/forget <id>`                                                  |
| `plan.js`    | `/plan on`, `/plan off`                                                                                 |
| `resume.js`  | `/resume`                                                                                               |
| `session.js` | `/status`, `/history`, `/db-history`, `/db-sessions`, `/who`, `/clear`, `/answer`, `/count`, `/restart` |
| `skills.js`  | `/skills`                                                                                               |

---

### 4.9 `tools/` — Custom Tools SDK

**Segurança de `shell-tools.js`**:
- Blocklist: 20+ padrões perigosos (`rm -rf`, `drop table`, `curl`, etc.)
- `cwd` restrito a `/workspaces/`
- `ALLOWED_NPM_SCRIPTS` whitelistados explicitamente
- Env vars sensíveis removidas do ambiente filho
- Verificação de root bloqueada
- `MAX_OUTPUT_BYTES = 10_000`, `MAX_TIMEOUT_MS = 120_000`

**`tool-factory.js`**: `buildTool(name, description, schema, handler)` — factory genérica para tools declarativas.

---

### 4.10 `types/structured-message.js`

**Protocolo** para comunicação LLM-A ↔ LLM-B tipada.

**Schema Zod**: `StructuredMessageSchema`

**Tipos de resposta** (`RESPONSE_TYPES`): `diagnostic | plan | code | question | confirmation | error`

**Prioridades** (`PRIORITY_LEVELS`): `low | medium | high | critical`

**Builders**: `buildStructuredRequest(opts)`, `buildStructuredResponse(opts)`

**Parser**: `parseStructuredResponse(text)` — fallback gracioso (texto puro → `null`)

---

## 5. Fluxos Operacionais

### 5.1 Fluxo de Inicialização

```
PM2 → agent/entry.js → startWithRetry()
    └── alwaysAliveAgent.start()
            │
            ├─ 1. new CopilotClient()
            ├─ 2. buildMcpTools()            ← JSON-RPC → MCP servers
            ├─ 3. createRegistry() + createTelemetry()
            ├─ 4. bootstrapTools(registry, telemetry, mcpTools)
            │       └── registra 11+ categorias de tools
            ├─ 5. startSpan('session.boot') →
            │       initOrResumeSession(client, opts)
            │               ├── readState()  ← sdk-always-alive.json
            │               ├── buildHookSystemContext()
            │               ├── try resumeSession(savedSessionId)
            │               │       ↳ falha → createSession()
            │               └── writeState({ sessionId, status: 'active' })
            ├─ 6. Wiring de eventos SDK:
            │       session.on('compaction_*') → emit()
            │       session.on('usage_info')   → #contextState + budget warnings
            │       session.on('mode_changed') → emit()
            ├─ 7. #watchdog.start()
            ├─ 8. [isResumed] → #syncSdkHistory(session) (fire-and-forget, AI.4)
            └─ 9. emit('ready', { sessionId, isResumed })
```

### 5.2 Fluxo de uma Mensagem (POST /inject)

```
POST :3009/inject { message, from, attachments? }
    │
    ▼ terminal/server.js → rate limiter (10 req/IP/60 s)
    ▼ terminal/http-handlers.js → handleInject(body)
        │
        ├─ Se attachments nativos (type=file|directory|selection):
        │       alwaysAliveAgent.sendMessage(msg, { attachments })
        └─ Senão:
                dialog.sendTurn(enrichedMessage, from)
                    │
                    ├─ setBusy(true)
                    ├─ conversationHub.store.writeTurn(hubSession, user)
                    ├─ ensureDialogLoop()
                    ├─ startSpan('dialog.send_turn') →
                    │       llmBridgeClient.dialogTurn(message, timeout)
                    │               → alwaysAliveAgent.sendDialogTurn()
                    │                       → task-executor.js
                    │                               session.sendAndWait()
                    ├─ conversationHub.store.writeTurn(hubSession, llm_b)
                    ├─ broadcastSse('turn:complete')
                    └─ setBusy(false)
```

### 5.3 Fluxo do Terminal REPL

```
startTerminalServer() → terminal/index.js
    ├── loadAliases()
    ├── createInjectServer()  ← HTTP :3009
    ├── store.createHubSession() → setHubSessionId()
    ├── dialog.stalled watchdog
    └── startRepl()
            ├── setupAgentListeners()
            ├── readline.createInterface(stdin, stdout)
            └── loop readline.question(PROMPT_USER)
                    ├── '/' prefixo → dispatchCmd()
                    │       └── commands/index.js lookup
                    └── texto puro → dialog.sendTurn(line, 'user')
```

### 5.4 Fluxo de Reconexão

```
'session.fatal' ou stall do watchdog
    │
    └── #reconnect()
            ├── stop()  ← limpa sessão + watchdog
            ├── delay exponencial (1s, 2s, 4s, 8s, 16s — máx 5 tentativas)
            └── start()
                    └── initOrResumeSession()
                            ├── try resumeSession(savedSessionId)  ← checkpoint
                            └── falha → createSession()
```

---

## 6. API Surface (Endpoints HTTP)

### Terminal (porta 3009 — `node:http` raw)

| Método | Rota                         | Handler                  | Rate limit     |
| ------ | ---------------------------- | ------------------------ | -------------- |
| GET    | `/health`                    | `handleStatus`           | —              |
| GET    | `/config`                    | `handleGetConfig`        | —              |
| GET    | `/config/skills`             | `handleGetSkills`        | —              |
| PUT    | `/config/skills`             | `handlePostSkills`       | —              |
| GET    | `/config/tools`              | `handleGetTools`         | —              |
| PUT    | `/config/tools`              | `handlePutTools`         | —              |
| GET    | `/config/tools/custom`       | `handleGetCustomTools`   | — (AI.2)       |
| POST   | `/config/tools/custom`       | `handlePostCustomTool`   | — (AI.2)       |
| DELETE | `/config/tools/custom/:name` | `handleDeleteCustomTool` | — (AI.2)       |
| PUT    | `/config/infinite-session`   | `handleInfiniteSession`  | —              |
| POST   | `/inject`                    | `handleInject`           | 10 req/IP/60 s |
| POST   | `/pipeline`                  | `handlePipeline`         | —              |
| POST   | `/memory`                    | `handleMemoryPost`       | —              |
| GET    | `/memory`                    | `handleMemoryGet`        | —              |
| DELETE | `/memory/:id`                | `handleMemoryDelete`     | —              |
| GET    | `/sessions`                  | `handleGetSessions`      | —              |
| GET    | `/sessions/:id/turns`        | `handleGetSessionTurns`  | —              |
| GET    | `/events`                    | SSE (todos eventos)      | —              |
| GET    | `/events?level=critical`     | SSE (eventos críticos)   | —              |
| GET    | `/gh/issues`                 | `handleGhIssues`         | —              |
| GET    | `/gh/prs`                    | `handleGhPrs`            | —              |
| GET    | `/gh/ci`                     | `handleGhCi`             | —              |
| GET    | `/git/status`                | `handleGitStatus`        | —              |
| GET    | `/git/log`                   | `handleGitLog`           | —              |

### API Express — `/api/copilot/*`

| Método | Rota            | Descrição                      |
| ------ | --------------- | ------------------------------ |
| GET    | `/status`       | Snapshot do agente             |
| GET    | `/health`       | Saúde (idle/processing only)   |
| GET    | `/session`      | Info da sessão SDK atual       |
| POST   | `/start`        | Inicia agente                  |
| POST   | `/stop`         | Para agente                    |
| POST   | `/send`         | Enfileira mensagem (sync opt.) |
| POST   | `/answer`       | Responde pergunta pendente     |
| GET    | `/stream`       | SSE — todos os 26 eventos      |
| POST   | `/dialog/start` | Inicia dialog loop             |
| POST   | `/dialog/turn`  | Injeta turno no dialog loop    |
| POST   | `/dialog/stop`  | Encerra dialog loop            |

### API Express — `/api/sdk/*`

| Grupo       | Rotas principais                                            |
| ----------- | ----------------------------------------------------------- |
| `/agent`    | `GET /info /tools /telemetry /state /stream`                |
| `/client`   | `GET /ping /status /auth /models /tools; POST /start /stop` |
| `/sessions` | CRUD completo `GET/POST/DELETE /sessions[/:id]`             |
| `/webhooks` | CRUD `GET/POST/DELETE /webhooks[/:id]`                      |

---

## 7. Eventos do Sistema

### `AlwaysAliveAgent` → NERV bridge (`bridge/nerv-bridge.js`)

| Evento copilot             | Action Code NERV                        |
| -------------------------- | --------------------------------------- |
| `status`                   | `COPILOT_STATUS`                        |
| `ready`                    | `COPILOT_READY`                         |
| `task.queued`              | `COPILOT_TASK_QUEUED`                   |
| `task.started`             | `COPILOT_TASK_STARTED`                  |
| `task.completed`           | `COPILOT_TASK_COMPLETED`                |
| `task.error`               | `COPILOT_TASK_ERROR`                    |
| `session.history_synced`   | `COPILOT_SESSION_HISTORY_SYNCED` (AI.4) |
| ... (25 mapeamentos total) | ...                                     |

### `HubOrchestrator` → Socket.io `/copilot`

| Evento            | Descrição                    |
| ----------------- | ---------------------------- |
| `turn:sent`       | Turno enviado à LLM-B        |
| `turn:delta`      | Chunk de streaming recebido  |
| `turn:complete`   | Resposta completa            |
| `user:injected`   | Mensagem do usuário injetada |
| `session:created` | Nova hub session criada      |
| `session:closed`  | Hub session encerrada        |

---

## 8. Persistência e Estado

| Arquivo                                     | Conteúdo                                     | Escopo                  |
| ------------------------------------------- | -------------------------------------------- | ----------------------- |
| `.github/hooks/state/sdk-always-alive.json` | Estado da sessão SDK activa                  | Agente                  |
| `tools-config.json` (raiz)                  | Allowlist/denylist de tools (AI.1)           | Configuração de runtime |
| `custom-tools.json` (raiz)                  | Registry de custom tools declarativas (AI.2) | Configuração de runtime |
| `~/.copilot-aliases.json`                   | Aliases do REPL                              | Usuário                 |
| `maestro.sqlite`                            | Hub sessions + turns + memories FTS5         | Banco de dados          |
| `logs/tool-audit.jsonl`                     | Auditoria JSONL de tool calls arriscados     | Logs (rotação a 10 MB)  |

---

## 9. Segurança

### `tools/shell-tools.js` — Proteções embutidas

1. **Blocklist de comandos perigosos**: `rm -rf`, `drop table`, `truncate`, `format`, `mkfs`, `dd`, `chmod 777`, `sudo`, `su`, e outros
2. **Whitelist de npm scripts**: apenas scripts pré-aprovados podem ser executados
3. **CWD restrito**: apenas `/workspaces/` é permitido como diretório de trabalho
4. **Env vars removidas**: `SECRET_*`, `TOKEN_*`, `PASSWORD_*`, `API_KEY_*` são removidas do ambiente filho
5. **Bloqueio de root**: verificação de `process.getuid() === 0` bloqueia execução como root
6. **Limites de saída**: `MAX_OUTPUT_BYTES = 10_000`, `MAX_TIMEOUT_MS = 120_000`

### `config/custom-tools-registry.js` — Segurança

- **Sem eval**: handlers são identificados por `handlerKey` (string ID) em mapa pré-autorizado (`BUILTIN_HANDLER_MAP`)
- **Sem código dinâmico**: nenhuma execução de código enviado via API

### `terminal/server.js` — Rate Limiting

- `/inject`: 10 requisições por IP por 60 segundos

---

## 10. Diagnóstico: Shims Legados

Os 14 arquivos na raiz do módulo são **shims de compatibilidade** criados durante fases de refatoração e nunca removidos. Todos são candidatos a remoção em um PR dedicado de limpeza.

**Exceção**: `sdk-client.js` não é um re-export puro — contém mapeamento de nomes (`createSdkSession()` → `lib/client.createClientSession()`). Requer análise de callers antes da remoção.

**Cadeias de dois níveis** (require atenção especial):
- `inject-llmb.js` → `bridges/inject-llmb.js` → `channel/inject.js`
- `llm-bridge-client.js` → `bridges/llm-bridge-client.js` → `channel/client.js`

---

## 11. Issues e Pontos de Atenção

| #    | Issue                                                     | Impacto                     | Arquivo                                      | Status                                                                   |
| ---- | --------------------------------------------------------- | --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| 9.1  | 13 shims legados na raiz                                  | DX                          | `src/copilot/*.js` (raiz)                    | Pendente (Fase 3)                                                        |
| 9.2  | `sdk-client.js` oculta mapeamento                         | DX                          | `sdk-client.js`                              | Pendente (Fase 3)                                                        |
| 9.3  | `terminal-server.js` vs `terminal/server.js`              | Confusão                    | ambos                                        | Pendente (Fase 3)                                                        |
| 9.4  | `orchestrator.js` importava shim deprecated               | Médio                       | `conversation-hub/orchestrator.js`           | ✅ **Corrigido** — agora importa `../channel/client.js`                   |
| 9.5  | `routes/agent.js` acessa campos privados via cast `any`   | Médio                       | `routes/agent.js`                            | Pendente (Fase 2/D1)                                                     |
| 9.6  | `task-tools.js` usava `execSync + curl`                   | Médio (bloqueia event loop) | `tools/task-tools.js`                        | ✅ **Corrigido** — substituído por `http.request` nativo                  |
| 9.7  | Timeouts inconsistentes (120 s vs 130 s)                  | Baixo                       | `terminal/dialog.js` vs `channel/inject.js`  | ✅ **Corrigido** — centralizados em `core/constants.js`                   |
| 9.8  | `BUILTIN_HANDLER_MAP` mínimo (3 handlers)                 | Funcional                   | `config/custom-tools-registry.js`            | Pendente (Fase 2/I1)                                                     |
| 9.9  | Estado global mutável sem observers em `state.js`         | Race condition potencial    | `terminal/state.js`                          | Pendente (Fase 2/F1)                                                     |
| 9.10 | Sem limite de clientes SSE                                | Memory leak potencial       | `terminal/server.js`, `routes/agent.js`      | ✅ **Corrigido** — `MAX_SSE_CLIENTS` aplicado (HTTP 429)                  |
| 9.11 | `copilot-router.js` e `sdk-router.js` são aliases inúteis | DX                          | `api/copilot-router.js`, `api/sdk-router.js` | Pendente (Fase 2/A1)                                                     |
| 9.12 | Migração FTS5 a cada `init()`                             | Risco DDL                   | `conversation-hub/store.js`                  | ✅ **Revisado** — guard `#initialized` + função idempotente já existentes |

---

## 12. Inventário Completo de Arquivos

### Ativos (canônicos)

| Arquivo                            | Camada | Status              |
| ---------------------------------- | ------ | ------------------- |
| `agent/entry.js`                   | 12     | ✅ Ativo             |
| `agent/always-alive.js`            | 3      | ✅ Crítico           |
| `agent/session-manager.js`         | 3      | ✅ Ativo             |
| `agent/tools-bootstrap.js`         | 3      | ✅ Ativo             |
| `agent/events.js`                  | 3      | ✅ Ativo             |
| `agent/task-executor.js`           | 3      | ✅ Ativo             |
| `agent/dialog-watchdog.js`         | 3      | ✅ Ativo             |
| `agent/webhook-manager.js`         | 3      | ✅ Ativo             |
| `api/http-bridge.js`               | 9      | ✅ Ativo             |
| `api/sdk-api.js`                   | 9      | ✅ Ativo             |
| `api/bridge-control.js`            | 9      | ✅ Ativo             |
| `api/bridge-dialog.js`             | 9      | ✅ Ativo             |
| `api/bridge-stream.js`             | 9      | ✅ Ativo             |
| `api/bridge-tasks.js`              | 9      | ✅ Ativo             |
| `bridges/nerv-bridge.js`           | 8      | ✅ Ativo             |
| `bridges/gh-bridge.js`             | 8      | ✅ Ativo             |
| `bridges/git-bridge.js`            | 8      | ✅ Ativo             |
| `bridges/mcp-tool-bridge.js`       | 8      | ✅ Ativo             |
| `bridges/alias-store.js`           | 8      | ✅ Ativo             |
| `channel/client.js`                | 5      | ✅ Ativo             |
| `channel/inject.js`                | 5      | ✅ Ativo             |
| `channel/audit.js`                 | 5      | ✅ Ativo             |
| `channel/index.js`                 | 5      | ✅ Ativo             |
| `config/session-config.js`         | 6      | ✅ Ativo             |
| `config/system-prompt.js`          | 6      | ✅ Ativo             |
| `config/mcp-servers.js`            | 6      | ✅ Ativo             |
| `config/tools-state.js`            | 6      | ✅ Ativo (AI.1)      |
| `config/custom-tools-registry.js`  | 6      | ✅ Ativo (AI.2)      |
| `config/custom-agents.js`          | 6      | ✅ Ativo             |
| `config/pinned-files-loader.js`    | 6      | ✅ Ativo             |
| `config/index.js`                  | 6      | ✅ Ativo             |
| `conversation-hub/hub.js`          | 7      | ✅ Ativo             |
| `conversation-hub/orchestrator.js` | 7      | ✅ Ativo             |
| `conversation-hub/store.js`        | 7      | ✅ Ativo             |
| `conversation-hub/socket-ns.js`    | 7      | ✅ Ativo             |
| `conversation-hub/index.js`        | 7      | ✅ Ativo             |
| `core/constants.js`                | 0      | ✅ Ativo             |
| `core/errors.js`                   | 0      | ✅ Ativo             |
| `core/types.js`                    | 0      | ✅ Ativo             |
| `core/index.js`                    | 0      | ✅ Ativo             |
| `lib/client.js`                    | 1      | ✅ Ativo             |
| `lib/session.js`                   | 1      | ✅ Ativo             |
| `lib/hooks.js`                     | 1      | ✅ Ativo             |
| `lib/permissions.js`               | 1      | ✅ Ativo             |
| `lib/agents.js`                    | 1      | ✅ Ativo             |
| `lib/models.js`                    | 1      | ✅ Ativo             |
| `lib/tools-registry.js`            | 1      | ✅ Ativo             |
| `lib/telemetry.js`                 | 1      | ✅ Ativo (AI.3)      |
| `lib/index.js`                     | 1      | ✅ Ativo             |
| `routes/agent.js`                  | 10     | ✅ Ativo             |
| `routes/client.js`                 | 10     | ✅ Ativo             |
| `routes/sessions.js`               | 10     | ✅ Ativo             |
| `routes/webhooks.js`               | 10     | ✅ Ativo             |
| `terminal/index.js`                | 12     | ✅ Ativo             |
| `terminal/server.js`               | 11     | ✅ Ativo             |
| `terminal/repl.js`                 | 11     | ✅ Ativo             |
| `terminal/dialog.js`               | 11     | ✅ Ativo             |
| `terminal/http-handlers.js`        | 11     | ✅ Ativo (AI.2/AI.5) |
| `terminal/state.js`                | 11     | ✅ Ativo             |
| `terminal/file-context.js`         | 11     | ✅ Ativo             |
| `terminal/workspace-context.js`    | 11     | ✅ Ativo             |
| `terminal/commands/index.js`       | 11     | ✅ Ativo             |
| `terminal/commands/alias.js`       | 11     | ✅ Ativo             |
| `terminal/commands/attach.js`      | 11     | ✅ Ativo             |
| `terminal/commands/config.js`      | 11     | ✅ Ativo             |
| `terminal/commands/context.js`     | 11     | ✅ Ativo             |
| `terminal/commands/gh.js`          | 11     | ✅ Ativo             |
| `terminal/commands/git.js`         | 11     | ✅ Ativo             |
| `terminal/commands/help.js`        | 11     | ✅ Ativo             |
| `terminal/commands/memory.js`      | 11     | ✅ Ativo             |
| `terminal/commands/plan.js`        | 11     | ✅ Ativo             |
| `terminal/commands/resume.js`      | 11     | ✅ Ativo             |
| `terminal/commands/session.js`     | 11     | ✅ Ativo             |
| `terminal/commands/skills.js`      | 11     | ✅ Ativo             |
| `tools/task-tools.js`              | 4      | ✅ Ativo             |
| `tools/code-tools.js`              | 4      | ✅ Ativo             |
| `tools/file-tools.js`              | 4      | ✅ Ativo             |
| `tools/git-tools.js`               | 4      | ✅ Ativo             |
| `tools/hook-tools.js`              | 4      | ✅ Ativo             |
| `tools/hub-tools.js`               | 4      | ✅ Ativo             |
| `tools/introspection-tools.js`     | 4      | ✅ Ativo             |
| `tools/session-tools.js`           | 4      | ✅ Ativo             |
| `tools/shell-tools.js`             | 4      | ✅ Ativo             |
| `tools/tool-factory.js`            | 4      | ✅ Ativo             |
| `tools/index.js`                   | 4      | ✅ Ativo             |
| `types/structured-message.js`      | 2      | ✅ Ativo             |
| `types/index.js`                   | 2      | ✅ Ativo             |

### Legados / Candidatos a Remoção

| Arquivo                        | Aponta para                  | Ação                    |
| ------------------------------ | ---------------------------- | ----------------------- |
| `agent.js`                     | `agent/entry.js`             | Remover                 |
| `always-alive.js`              | `agent/always-alive.js`      | Remover                 |
| `session-manager.js`           | `agent/session-manager.js`   | Remover                 |
| `nerv-bridge.js`               | `bridges/nerv-bridge.js`     | Remover                 |
| `gh-bridge.js`                 | `bridges/gh-bridge.js`       | Remover                 |
| `git-bridge.js`                | `bridges/git-bridge.js`      | Remover                 |
| `http-bridge.js`               | `api/http-bridge.js`         | Remover                 |
| `inject-llmb.js`               | `channel/inject.js`          | Remover                 |
| `llm-bridge-client.js`         | `channel/client.js`          | Remover                 |
| `mcp-tool-bridge.js`           | `bridges/mcp-tool-bridge.js` | Remover                 |
| `sdk-api.js`                   | `api/sdk-api.js`             | Remover                 |
| `alias-store.js`               | `bridges/alias-store.js`     | Remover                 |
| `sdk-client.js`                | `lib/client.js` (wrapper)    | Migrar callers primeiro |
| `terminal-server.js`           | `terminal/index.js`          | Remover                 |
| `api/copilot-router.js`        | `api/http-bridge.js`         | Remover                 |
| `api/sdk-router.js`            | `api/sdk-api.js`             | Remover                 |
| `bridges/inject-llmb.js`       | `channel/inject.js`          | Remover                 |
| `bridges/llm-bridge-client.js` | `channel/client.js`          | Remover                 |

---

*Gerado em: 2026-03-15 · Baseado na inspeção do código-fonte pós-Fase AI (AI.1–AI.5)*
