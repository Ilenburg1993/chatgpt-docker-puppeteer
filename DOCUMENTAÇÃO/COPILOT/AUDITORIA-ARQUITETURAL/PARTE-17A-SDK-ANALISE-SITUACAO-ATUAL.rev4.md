# PARTE-17A — Análise Arquitetural Profunda: Situação Atual do SDK

**Data**: 2026-03-20 (rev.4 — inventário completo da API Surface do SDK + gap analysis) **Escopo**:
TODO `src/copilot/` (263 arquivos, ~46.525 linhas) + API Surface completa do
`@github/copilot-sdk@0.2.0` **SDK oficial**: `@github/copilot-sdk@0.2.0` (instalado) | `0.2.1` (NPM
latest) **Autor**: Auditoria automatizada PARTE-17

---

## Sumário Executivo

A revisão rev.4 expande significativamente a análise da rev.3 com a **leitura completa de todos os 9
arquivos de type declarations do SDK oficial** (`index.d.ts`, `client.d.ts`, `session.d.ts`,
`types.d.ts` — 1040 linhas, `telemetry.d.ts`, `extension.d.ts`, `generated/rpc.d.ts` — 1061 linhas,
`generated/session-events.d.ts` — 3404 linhas, `sdkProtocolVersion.d.ts`). Essa leitura revelou que
a superfície real do SDK é **vastamente maior** do que o inventariado na rev.3:

| Métrica                        | Rev.3 (estimava) | Rev.4 (real) |
| ------------------------------ | :--------------: | :----------: |
| Símbolos runtime exportados    |        ~6        |    **8+**    |
| Tipos/interfaces exportados    |       ~12        |   **90+**    |
| Métodos CopilotClient públicos |        ~5        |   **15+**    |
| Métodos CopilotSession         |        ~3        |   **12+**    |
| Session RPC subsistemas        |   não contado    |    **17**    |
| Server RPC subsistemas         |   não contado    |    **4**     |
| Session Event types            |   não contado    |   **70+**    |
| Campos SessionConfig           |       ~17        |   **23+**    |

A conclusão central da rev.3 permanece válida (wrapper incompleto + 20 bypasses), mas o **escopo da
transformação é MUITO maior** do que estimado: não basta migrar 20 imports — é necessário também
**expor ~50 métodos RPC, tipificar ~90 interfaces, e wrappar features inteiramente ausentes** do
projeto atual (fleet mode, extensions, plugins, compaction, shell via RPC, UI elicitation, model
switching, account quota, mode switching, plan management, etc.).

---

## §1. Mapa Arquitetural Completo de `src/copilot/`

### 1.1 Módulos e Escala

| Módulo              | Arquivos |      Linhas | Responsabilidade Principal                                        |
| ------------------- | -------: | ----------: | ----------------------------------------------------------------- |
| `agent/`            |       52 |     ~10.200 | AlwaysAliveAgent, lifecycle, dialog loop, session mgmt, infra     |
| `tools/`            |      ~40 |      ~6.195 | Custom tools (15 categorias), tool-factory, session-rpc           |
| `terminal/`         |      ~50 |      ~5.000 | CLI REPL, handlers, formatters                                    |
| `observability/`    |       21 |      ~4.458 | OTel, event-collector, metrics, tool-stats, error-tracking        |
| `hooks/`            |       19 |      ~3.499 | Hook factory, bus, registry, presets, types, permission, composer |
| `sdk/`              |       20 |      ~3.252 | SDK wrapper: client, session, tools-registry, models, agents      |
| `api/`              |       21 |      ~3.233 | Express routes, bridge HTTP→agent, SSE, session-crud              |
| `conversation-hub/` |       10 |      ~2.487 | Hub de conversação, store, orquestrador, socket.io                |
| `bridges/`          |       10 |      ~2.183 | NERV bridge, MCP tool bridge, git bridge, GitHub MCP              |
| `channel/`          |        7 |      ~1.497 | Injeção HTTP, SDK client mode, SSE streaming                      |
| `config/`           |        6 |      ~1.415 | env SSOT, session-config builders, system-prompt, custom-agents   |
| `core/`             |       14 |      ~1.400 | Errors, events, schemas, sdk-types, utils, abort, circuit-breaker |
| `audit/`            |        4 |        ~753 | Pipeline JSONL, ring-buffer, audit writers                        |
| `db/`               |        3 |        ~411 | SQLite persistence, migrations                                    |
| **TOTAL**           |  **263** | **~46.525** |                                                                   |

### 1.2 Grafo de Dependências de Alto Nível

```
┌──────────────────────────────────────────────────────────────┐
│                      @github/copilot-sdk                      │
│  CopilotClient · CopilotSession · defineTool · approveAll     │
│  SYSTEM_PROMPT_SECTIONS · joinSession · getTraceContext        │
│  ~90 tipos · 17 subsistemas RPC · 70+ event types             │
└─────────┬───────────────┬──────────────────────┬─────────────┘
          │ WRAPPER PATH  │ BYPASS PATH (20 files)│
     ┌────▼────┐     ┌────▼────────────────┐     │
     │ sdk/    │     │ tools/* (11 files)  │     │
     │ client  │     │ → defineTool       │     │
     │ session │     ├────────────────────┤     │
     │ tools-  │     │ config/* (2 files) │     │
     │ registry│     │ → approveAll,      │     │
     │ models  │     │   SYSTEM_PROMPT_*  │     │
     │ agents  │     ├────────────────────┤     │
     │ utils   │     │ hooks/* (1 file)   │     │
     └────┬────┘     │ → approveAll       │     │
          │          ├────────────────────┤     │
     ┌────▼────┐     │ agent/* (3 files)  │     │
     │ config/ │     │ → CopilotClient,   │     │
     │ hooks/  │◄────┤   approveAll       │     │
     │ agent/  │     ├────────────────────┤     │
     │ api/    │     │ api/* (1 file)     │     │
     │ bridges/│     │ → approveAll       │     │
     │ channel/│     ├────────────────────┤     │
     └─────────┘     │ bridges/* (1 file) │     │
                     │ → defineTool       │     │
                     ├────────────────────┤     │
                     │ audit/* (1 file)   │     │
                     │ → approveAll       │     │
                     └────────────────────┘     │
```

---

## §2. Inventário COMPLETO da API Surface do SDK Oficial

### 2.1 Runtime Exports (from `index.d.ts`)

| Export                   | Tipo               | Descrição                                           | Usado no projeto? |
| ------------------------ | ------------------ | --------------------------------------------------- | :---------------: |
| `CopilotClient`          | Classe             | Client principal — gerencia CLI, conexão, sessões   |        ✅         |
| `CopilotSession`         | Classe             | Sessão de conversa — events, tools, send, RPC       |        ✅         |
| `defineTool`             | Função             | Helper para definir tool com type inference via Zod |        ✅         |
| `approveAll`             | PermissionHandler  | Aprova todas as permissões automaticamente          |        ✅         |
| `SYSTEM_PROMPT_SECTIONS` | Constante (Record) | Seções nomeadas do system prompt (10 seções)        |        ✅         |
| `AssistantMessageEvent`  | Tipo (re-export)   | Tipo extraído de `session.d.ts`                     |        ❌         |
| `getTraceContext`        | Função (telemetry) | Obtém W3C Trace Context do provider                 |        ❌         |
| `joinSession`            | Função (extension) | Joins foreground session (para extensions)          |        ❌         |

### 2.2 CopilotClient — Métodos Públicos Completos

| Método                                   | Descrição                               |  Wrapped em sdk/?  | Usado fora de sdk/? |
| ---------------------------------------- | --------------------------------------- | :----------------: | :-----------------: |
| `constructor(options?)`                  | Cria instância com CopilotClientOptions |    ✅ getClient    |    ✅ lifecycle     |
| `start()`                                | Inicia CLI server + conexão             |    ✅ (interno)    |          —          |
| `stop()`                                 | Graceful shutdown                       |  ✅ stopClient()   |          —          |
| `forceStop()`                            | Force kill                              | ✅ forceStopClient |          —          |
| `createSession(config)`                  | Cria nova sessão                        |   ✅ createSess    |          —          |
| `resumeSession(id, config)`              | Retoma sessão existente                 |   ✅ resumeSess    |          —          |
| `getState()`                             | Estado de conexão                       | ✅ getClientState  |          —          |
| `ping(message?)`                         | Verifica conectividade CLI server       |         ❌         |         ❌          |
| `getStatus()`                            | Versão CLI + protocolo                  |         ❌         |         ❌          |
| `getAuthStatus()`                        | Status de autenticação GitHub           |         ❌         |         ❌          |
| `listModels()`                           | Lista modelos disponíveis com metadata  |    ✅ (models/)    |          —          |
| `getLastSessionId()`                     | ID da sessão mais recente               |         ❌         |   ✅ session-crud   |
| `deleteSession(id)`                      | Deleta sessão e dados permanentemente   |         ❌         |         ❌          |
| `listSessions(filter?)`                  | Lista sessões com filtro                |  ✅ (session.js)   |   ✅ session-crud   |
| `getForegroundSessionId()`               | ID da sessão em foreground (TUI mode)   |         ❌         |   ✅ session-crud   |
| `setForegroundSessionId(id)`             | Muda sessão foreground                  |         ❌         |   ✅ session-crud   |
| `on(eventType, handler)` / `on(handler)` | Subscribe lifecycle events              |         ❌         |   ✅ boot-wiring    |
| `rpc` (getter)                           | Server-scoped RPC methods               |         ❌         |         ❌          |

**Server RPC (client.rpc) — NÃO exposto pelo wrapper:**

| RPC                      | Descrição                                       | Usado? |
| ------------------------ | ----------------------------------------------- | :----: |
| `rpc.ping(params)`       | Ping com timestamp                              |   ❌   |
| `rpc.models.list()`      | Lista modelos (alternativa a client.listModels) |   ❌   |
| `rpc.tools.list(params)` | Lista tools built-in por modelo                 |   ❌   |
| `rpc.account.getQuota()` | Quota da conta GitHub Copilot                   |   ❌   |

### 2.3 CopilotSession — Métodos Públicos Completos

| Método                                   | Descrição                             | Wrapped? |       Onde?       |
| ---------------------------------------- | ------------------------------------- | :------: | :---------------: |
| `send(options)`                          | Envia mensagem (não espera idle)      |    ✅    |     messaging     |
| `sendAndWait(options, timeout?)`         | Envia e espera resposta completa      |    ✅    |  always-alive.js  |
| `on(eventType, handler)` / `on(handler)` | Subscribe session events              |    ✅    |  event-wirer.js   |
| `disconnect()`                           | Libera recursos in-memory             |    ✅    |  agent-lifecycle  |
| `destroy()` ⚠️ DEPRECATED                | Alias de disconnect                   |    ❌    |         —         |
| `abort()`                                | Cancela mensagem em processamento     |    ❌    |         —         |
| `setModel(model, options?)`              | Muda modelo mid-session               |    ❌    |         —         |
| `log(message, options?)`                 | Log na timeline da sessão             |    ✅    |  always-alive.js  |
| `getMessages()`                          | Retorna todo histórico da sessão      |    ❌    |         —         |
| `registerTools(tools?)`                  | Registra tools (interno)              |    —     |     (interno)     |
| `registerPermissionHandler(handler?)`    | Registra permission handler (interno) |    —     |     (interno)     |
| `registerUserInputHandler(handler?)`     | Registra user input handler (interno) |    —     |     (interno)     |
| `registerHooks(hooks?)`                  | Registra hooks (interno)              |    —     |     (interno)     |
| `registerTransformCallbacks(cbs?)`       | Registra section transform callbacks  |    —     |     (interno)     |
| `workspacePath` (getter)                 | Path do workspace da sessão           |    ❌    |         —         |
| `rpc` (getter)                           | Session-scoped RPC methods            | parcial  | session-rpc-tools |
| `sessionId` (readonly)                   | ID da sessão                          |    ✅    |      vários       |
| `[Symbol.asyncDispose]()`                | Suporte a `await using session`       |    ❌    |         —         |

### 2.4 Session RPC — 17 Subsistemas (via `session.rpc`)

Este é o inventário mais significativamente **AUSENTE** da rev.3. O SDK expõe **17 subsistemas RPC**
através de `session.rpc`:

| Subsistema        | Métodos                                                               | Status       | Usado? |
| ----------------- | --------------------------------------------------------------------- | ------------ | :----: |
| `rpc.model`       | `getCurrent()`, `switchTo({modelId, reasoningEffort})`                | Estável      |   ❌   |
| `rpc.mode`        | `get()`, `set({mode})` [interactive/plan/autopilot]                   | Estável      |   ❌   |
| `rpc.plan`        | `read()`, `update({content})`, `delete()`                             | Estável      |   ❌   |
| `rpc.workspace`   | `listFiles()`, `readFile({path})`, `createFile({path,content})`       | Estável      |   ❌   |
| `rpc.fleet`       | `start({prompt?})`                                                    | EXPERIMENTAL |   ❌   |
| `rpc.agent`       | `list()`, `getCurrent()`, `select({name})`, `deselect()`, `reload()`  | EXPERIMENTAL |   ❌   |
| `rpc.skills`      | `list()`, `enable({name})`, `disable({name})`, `reload()`             | EXPERIMENTAL |   ❌   |
| `rpc.mcp`         | `list()`, `enable({serverName})`, `disable({serverName})`, `reload()` | EXPERIMENTAL |   ❌   |
| `rpc.plugins`     | `list()`                                                              | EXPERIMENTAL |   ❌   |
| `rpc.extensions`  | `list()`, `enable({id})`, `disable({id})`, `reload()`                 | EXPERIMENTAL |   ❌   |
| `rpc.compaction`  | `compact()` → `{success, tokensRemoved, messagesRemoved}`             | EXPERIMENTAL |   ❌   |
| `rpc.tools`       | `handlePendingToolCall({requestId, result, error})`                   | Estável      |   ❌   |
| `rpc.commands`    | `handlePendingCommand({requestId, error?})`                           | Estável      |   ❌   |
| `rpc.ui`          | `elicitation({message, requestedSchema})`                             | Estável      |   ❌   |
| `rpc.permissions` | `handlePendingPermissionRequest({requestId, result})`                 | Estável      |   ❌   |
| `rpc.log`         | `log({message, level?, ephemeral?, url?})`                            | Estável      |   ✅   |
| `rpc.shell`       | `exec({command, cwd?, timeout?})`, `kill({processId, signal?})`       | Estável      |   ❌   |

**Observação critica**: `session.rpc.log` é o ÚNICO subsistema RPC em uso — via `session.log()` que
é um convenience wrapper do SDK. O `session-rpc-tools.js` expõe ALGUMAS operações como tools ao
agente, mas faz isso via chamadas ad-hoc, sem wrappers centralizados no `sdk/`.

### 2.5 Session Events — 70+ Tipos (via `generated/session-events.d.ts`)

O SDK define **70+ tipos** de session events em `generated/session-events.d.ts` (3404 linhas). Cada
tipo possui payload específico com campos tipados.

| Categoria            | Eventos                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Session**          | `session.start`, `session.resume`, `session.error`, `session.idle`, `session.title_changed`, `session.info`, `session.warning`       |
| **Session (cont)**   | `session.model_change`, `session.mode_changed`, `session.plan_changed`, `session.workspace_file_changed`, `session.handoff`          |
| **Session (cont)**   | `session.truncation`, `session.snapshot_rewind`, `session.shutdown`, `session.context_changed`, `session.usage_info`                 |
| **Session (cont)**   | `session.compaction_start`, `session.compaction_complete`, `session.task_complete`                                                   |
| **Session (state)**  | `session.tools_updated`, `session.background_tasks_changed`, `session.skills_loaded`, `session.mcp_servers_loaded`                   |
| **Session (state)**  | `session.mcp_server_status_changed`, `session.extensions_loaded`                                                                     |
| **User**             | `user.message`                                                                                                                       |
| **Pending**          | `pending_messages.modified`                                                                                                          |
| **Assistant**        | `assistant.turn_start`, `assistant.intent`, `assistant.reasoning`, `assistant.reasoning_delta`, `assistant.streaming_delta`          |
| **Assistant (cont)** | `assistant.message`, `assistant.message_delta`, `assistant.turn_end`, `assistant.usage`                                              |
| **Control**          | `abort`                                                                                                                              |
| **Tool**             | `tool.user_requested`, `tool.execution_start`, `tool.execution_partial_result`, `tool.execution_progress`, `tool.execution_complete` |
| **Skill**            | `skill.invoked`                                                                                                                      |
| **Subagent**         | `subagent.started`, `subagent.completed`, `subagent.failed`, `subagent.selected`, `subagent.deselected`                              |
| **Hook**             | `hook.start`, `hook.end`                                                                                                             |
| **System**           | `system.message`, `system.notification` (subtypes: agent_completed, agent_idle, shell_completed, shell_detached_completed)           |
| **Permission**       | `permission.requested`, `permission.completed`                                                                                       |
| **User Input**       | `user_input.requested`, `user_input.completed`                                                                                       |
| **Elicitation**      | `elicitation.requested`, `elicitation.completed`                                                                                     |
| **MCP**              | `mcp.oauth_required`, `mcp.oauth_completed`                                                                                          |
| **External Tool**    | `external_tool.requested`, `external_tool.completed`                                                                                 |
| **Command**          | `command.queued`, `command.execute`, `command.completed`, `commands.changed`                                                         |
| **Plan Exit**        | `exit_plan_mode.requested`, `exit_plan_mode.completed`                                                                               |

**Status no projeto**: O `observability/event-collector.js` registra listeners para a maioria destes
eventos. O `bridges/nerv-bridge.js` mapeia ~55 event types para o bus NERV. Mas o **modelo de dados
dos eventos NÃO está tipificado** — handlers usam `event.data` como `any`.

### 2.6 SessionConfig — Campos COMPLETOS (23+ campos)

| Campo                 | Tipo SDK                           | Em wrapper? | Em agent? | Em API? | Análise                                         |
| --------------------- | ---------------------------------- | :---------: | :-------: | :-----: | ----------------------------------------------- |
| `sessionId`           | `string?`                          |     ❌      |    ❌     |   ✅    | API passa, agent não (gerado pelo SDK)          |
| `clientName`          | `string?`                          |     ❌      |    ❌     |   ✅    | Apenas API usa; deveria ser default no agent    |
| `model`               | `string?`                          |     ✅      |    ✅     |   ✅    | OK                                              |
| `reasoningEffort`     | `ReasoningEffort?`                 |     ✅      |    ✅     |   ✅    | OK                                              |
| `configDir`           | `string?`                          |     ❌      |    ❌     |   ❌    | Não usado em nenhum lugar                       |
| `tools`               | `Tool<any>[]?`                     |     ✅      |    ✅     |   ❌    | API não injeta tools — só agent                 |
| `systemMessage`       | `SystemMessageConfig?`             |     ✅      |    ✅     |   ✅    | OK mas modo `customize` não explorado           |
| `availableTools`      | `string[]?`                        |     ❌      |    ✅     |   ✅    | Agent e API usam, mas wrapper não aceita        |
| `excludedTools`       | `string[]?`                        |     ❌      |    ✅     |   ✅    | Agent e API usam, mas wrapper não aceita        |
| `provider`            | `ProviderConfig?`                  |     ❌      |    ❌     |   ✅    | Só API (BYOK); deveria estar no wrapper         |
| `onPermissionRequest` | `PermissionHandler`                |     ✅      |    ✅     |   ✅    | OK — obrigatório                                |
| `onUserInputRequest`  | `UserInputHandler?`                |     ✅      |    ✅     |   ❌    | Agent usa; API não                              |
| `hooks`               | `SessionHooks?`                    |     ✅      |    ✅     |   ❌    | Agent usa; API não                              |
| `workingDirectory`    | `string?`                          |     ✅      |    ✅     |   ✅    | OK                                              |
| `streaming`           | `boolean?`                         |     ✅      |    ✅     |   ✅    | OK                                              |
| `mcpServers`          | `Record<string, MCPServerConfig>?` |     ✅      |    ✅     |   ❌    | Agent usa; API não                              |
| `customAgents`        | `CustomAgentConfig[]?`             |     ✅      |    ✅     |   ✅    | OK                                              |
| `agent`               | `string?`                          |     ❌      |    ❌     |   ❌    | Nome do custom agent ativo — NÃO USADO          |
| `skillDirectories`    | `string[]?`                        |     ❌      |    ✅     |   ❌    | Agent usa; wrapper ignora                       |
| `disabledSkills`      | `string[]?`                        |     ❌      |    ❌     |   ❌    | NÃO USADO em nenhum lugar                       |
| `infiniteSessions`    | `InfiniteSessionConfig?`           |     ✅      |    ✅     |   ✅    | OK mas thresholds não padronizados centralmente |
| `onEvent`             | `SessionEventHandler?`             |     ❌      |    ❌     |   ❌    | Handler de events early-binding — NÃO USADO     |

**`ResumeSessionConfig`** é `Pick<SessionConfig, ...>` + `{ disableResume?: boolean }` — aceita
quase todos os campos exceto `sessionId`.

### 2.7 Tipos/Interfaces Completos Exportados pelo SDK (~90+)

#### Core

- `CopilotClientOptions`, `SessionConfig`, `ResumeSessionConfig`, `MessageOptions`
- `ConnectionState` ("disconnected"|"connecting"|"connected"|"error")
- `ReasoningEffort` ("low"|"medium"|"high"|"xhigh")

#### Tools

- `Tool<T>`, `ToolHandler<T>`, `ToolInvocation`, `ToolResult`, `ToolResultType`
- `ToolResultObject`, `ToolBinaryResult` (data, mimeType, type, description)
- `ToolCallRequestPayload`, `ToolCallResponsePayload`, `ZodSchema`

#### Permission

- `PermissionHandler`, `PermissionRequest` (6 kinds), `PermissionRequestResult`

#### User Input

- `UserInputHandler`, `UserInputRequest`, `UserInputResponse`

#### System Message

- `SystemMessageConfig` (union de 3 modos)
- `SystemMessageAppendConfig`, `SystemMessageReplaceConfig`, `SystemMessageCustomizeConfig`
- `SystemPromptSection` (10 seções: identity, tone, guidelines, codeGeneration, testing, tools,
  security, accessibility, output, behavioral)
- `SectionOverride`, `SectionOverrideAction` (prepend|append|replace|remove|wrap)
- `SectionTransformFn`

#### Hooks (6 tipos completos com I/O)

- `SessionHooks`, `BaseHookInput`
- `PreToolUseHandler` + `PreToolUseHookInput` + `PreToolUseHookOutput`
- `PostToolUseHandler` + `PostToolUseHookInput` + `PostToolUseHookOutput`
- `UserPromptSubmittedHandler` + `UserPromptSubmittedHookInput` + `UserPromptSubmittedHookOutput`
- `SessionStartHandler` + `SessionStartHookInput` + `SessionStartHookOutput`
- `SessionEndHandler` + `SessionEndHookInput` + `SessionEndHookOutput`
- `ErrorOccurredHandler` + `ErrorOccurredHookInput` + `ErrorOccurredHookOutput`

#### Session Events

- `SessionEvent` (union de 70+ tipos), `SessionEventType`
- `SessionEventPayload<T>`, `SessionEventHandler`, `TypedSessionEventHandler<T>`
- `AssistantMessageEvent`

#### Session Lifecycle

- `SessionLifecycleEvent`, `SessionLifecycleEventType` (5 tipos:
  created/deleted/updated/foreground/background)
- `SessionLifecycleHandler`, `TypedSessionLifecycleHandler<K>`

#### Model

- `ModelInfo` (id, name, capabilities, policy, billing, supportedReasoningEfforts,
  defaultReasoningEffort)
- `ModelCapabilities` (supports: vision + reasoningEffort; limits: maxTokens + maxVisionImages)
- `ModelPolicy` (state: enabled|disabled|unconfigured; terms)
- `ModelBilling` (multiplier)

#### MCP

- `MCPServerConfig` (union), `MCPLocalServerConfig` (command, args, env, cwd)
- `MCPRemoteServerConfig` (url, headers, type: "http"|"sse")

#### Custom Agents

- `CustomAgentConfig` (name, displayName, description, tools, prompt, mcpServers, infer)

#### Sessions Metadata

- `SessionContext` (cwd, gitRoot, repository, branch)
- `SessionMetadata` (sessionId, startTime, modifiedTime, summary, isRemote, context)
- `SessionListFilter` (cwd, gitRoot, repository, branch)
- `ForegroundSessionInfo` (sessionId, workspacePath)
- `InfiniteSessionConfig` (enabled, backgroundCompactionThreshold: 0.80, bufferExhaustionThreshold:
  0.95)

#### Provider (BYOK)

- `ProviderConfig` (type: "openai"|"azure"|"anthropic"; wireApi, baseUrl, apiKey, bearerToken;
  azure-specific fields)

#### Telemetry

- `TelemetryConfig` (otlpEndpoint, filePath, exporterType, sourceName, captureContent)
- `TraceContext` (traceparent, tracestate), `TraceContextProvider`

#### Status/Auth

- `GetStatusResponse` (version, protocolVersion)
- `GetAuthStatusResponse` (isAuthenticated, authType, host, login, statusMessage)

#### Extension

- `JoinSessionConfig` (Omit<ResumeSessionConfig, ...>)

### 2.8 Exports NÃO Usados pelo Projeto (GAP List Prioriziada)

| Feature SDK                        | Tipo         | Impacto de não usar                            | Prioridade |
| ---------------------------------- | ------------ | ---------------------------------------------- | :--------: |
| `client.getAuthStatus()`           | Método       | Sem verificação de autenticação no boot        |   **P0**   |
| `session.abort()`                  | Método       | Impossível cancelar requests longos            |   **P0**   |
| `session.setModel()`               | Método       | Impossível trocar modelo mid-session           |   **P0**   |
| `session.rpc.mode.get/set()`       | RPC          | Sem suporte a modos interactive/plan/autopilot |   **P0**   |
| `SystemMessageCustomizeConfig`     | Tipo/Feature | Modo `customize` do system prompt não usado    |   **P0**   |
| `client.rpc.account.getQuota()`    | RPC          | Sem monitoramento de quota Copilot             |   **P0**   |
| `session.getMessages()`            | Método       | Sem acesso a histórico da sessão               |   **P1**   |
| `session.workspacePath`            | Getter       | Workspace de infinite sessions inacessível     |   **P1**   |
| `client.ping()`                    | Método       | Sem health check do CLI server                 |   **P1**   |
| `client.getStatus()`               | Método       | Sem versão/protocolo do CLI                    |   **P1**   |
| `client.deleteSession()`           | Método       | Sem cleanup de sessões antigas                 |   **P1**   |
| `client.rpc.tools.list()`          | RPC          | Sem listagem de built-in tools por modelo      |   **P1**   |
| `session.rpc.plan.*`               | RPC          | Sem plan management em infinite sessions       |   **P1**   |
| `session.rpc.workspace.*`          | RPC          | Sem acesso a workspace files da sessão         |   **P1**   |
| `session.rpc.agent.*`              | RPC (exp.)   | Sem seleção runtime de custom agents           |   **P1**   |
| `session.rpc.skills.*`             | RPC (exp.)   | Sem gestão runtime de skills                   |   **P1**   |
| `session.rpc.mcp.*`                | RPC (exp.)   | Sem gestão runtime de MCP servers              |   **P1**   |
| `session.rpc.compaction.compact()` | RPC (exp.)   | Sem compactação manual                         |   **P1**   |
| `session.rpc.shell.*`              | RPC          | Sem execução de shell via SDK RPC              |   **P1**   |
| `session.rpc.ui.elicitation()`     | RPC          | Sem formulários estruturados para usuário      |   **P1**   |
| `ProviderConfig` (BYOK)            | Tipo/Feature | BYOK só na API, não no wrapper                 |   **P1**   |
| `onEvent` em SessionConfig         | Campo        | Early event binding não utilizado              |   **P1**   |
| `agent` em SessionConfig           | Campo        | Auto-select de custom agent não utilizado      |   **P1**   |
| `clientName` em SessionConfig      | Campo        | Client name para User-Agent não padronizado    |   **P1**   |
| `disabledSkills` em SessionConfig  | Campo        | Desabilitar skills por nome não utilizado      |   **P1**   |
| `session.rpc.fleet.start()`        | RPC (exp.)   | Sem fleet mode (multi-agent orchestration)     |   **P2**   |
| `session.rpc.plugins.list()`       | RPC (exp.)   | Sem listagem de plugins                        |   **P2**   |
| `session.rpc.extensions.*`         | RPC (exp.)   | Sem gestão runtime de extensions               |   **P2**   |
| `joinSession()` (extension.js)     | Função       | Sem suporte a extensions joining sessions      |   **P2**   |
| `getTraceContext()` (telemetry.js) | Função       | Trace context manual não utilizado             |   **P2**   |
| `configDir` em SessionConfig       | Campo        | Config dir override não utilizado              |   **P2**   |
| `[Symbol.asyncDispose]()`          | Protocol     | Sem suporte a `await using session`            |   **P2**   |

---

## §3. Problemas Arquiteturais Identificados (P1–P18)

### 🔴 CRÍTICO

#### P1 — Dois Caminhos de Configuração de Sessão

Existem 3 config builders concorrentes:

1. `config/session-config.js` → `buildSessionConfig()` — usado pelo agent/lifecycle (10+ consumers)
2. `sdk/session.js` (chamada interna ao SDK) — adiciona defaults do SDK
3. `api/routes/sessions.js` → inline config building — ignora `buildSessionConfig()`

**Efeito**: É possível criar sessões com configs diferentes dependendo do entry point (agent vs
API), levando a comportamento inconsistente em hooks, systemMessage, e tools.

#### P2 — Dois Registros de Sessão Paralelos

1. `sdk/client.js` → `Map` interno com getSession/setSession → stateful singleton
2. `sdk/session.js` → funções `createSession()`/`resumeSession()` → stateless wrappers

Consumidores diferentes usam caminhos diferentes para acessar a "mesma" sessão.

#### P11 — 15 Subsistemas RPC Não-Expostos pelo Wrapper (NOVO rev.4)

O SDK expõe 17 subsistemas RPC via `session.rpc` e 4 RPCs server-scope via `client.rpc`. O projeto
só usa `session.rpc.log()` (via `session.log()` convenience). **15/17 subsistemas são completamente
inacessíveis** via wrapper. Features como mode switching (plan/autopilot), plan management,
workspace files, extensions, plugins, skills, compaction, shell execution, UI elicitation e account
quota — **não existem** para o projeto.

### 🔴 ALTO

#### P3 — Config Barrel Viola Fronteiras de Módulo

`config/index.js` re-exporta de `sdk/` → violação de dependency rule (config não deve depender de
sdk).

#### P4 — Sistema de Tipos Paralelo para Hooks

`hooks/types.js` (309 linhas) define tipos paralelos aos do SDK oficial (`PreToolUseHookInput`,
`PostToolUseHookOutput`, etc.). Os tipos locais divergem sutilmente dos SDK types (campos extras,
campos faltantes), causando inconsistência na interface de hooks.

#### P12 — 70+ Event Types Sem Tipagem Forte (NOVO rev.4)

O SDK define 70+ tipos de session events com payloads específicos. O projeto registra listeners via
`session.on(handler)` com handler genérico — os payloads são `event.data` sem tipo. O
`nerv-bridge.js` mapeia ~55 event types para NERV, sem type-safety nos payloads. O
`event-collector.js` coleta events para observabilidade, sem contracts nos dados.

### 🟡 MÉDIO

#### P5 — `defineTool` Usado Diretamente em 11+ Arquivos

11 arquivos em `tools/` e `bridges/` importam `defineTool` de `@github/copilot-sdk` diretamente,
bypassing o wrapper `sdk/tools-registry.js`.

#### P6 — `approveAll` Importado de 5 Módulos Independentes

5 módulos importam `approveAll` diretamente: `config/session-config.js`, `hooks/presets.js`,
`agent/lifecycle/initializer.js`, `api/routes/sessions.js`, `audit/pipeline.js`.

#### P7 — CopilotClient Instanciado Diretamente no Agent

`agent/lifecycle/initializer.js` e `agent/always-alive.js` instanciam `CopilotClient` diretamente,
bypassing o wrapper `sdk/client.js`.

#### P8 — API Routes Usam Features Não-Wrapped

`api/routes/sessions.js` acessa features SDK não wrapped (ex: `client.getLastSessionId()`,
`client.listSessions()`) via importação direta ou acesso ao singleton.

#### P13 — SystemMessage `customize` Mode Não Utilizado (NOVO rev.4)

O SDK suporta 3 modos de system message:

1. `append` (default) — **usado** ✅
2. `replace` — disponível mas perigoso (remove guardrails de segurança)
3. `customize` — **NÃO utilizado** — permite override por seção individual com 5 actions (prepend,
   append, replace, remove, wrap) + transform functions

O modo `customize` é o mais poderoso e seguro para customização granular. Permite alterar seções
específicas (identity, tone, guidelines, codeGeneration, etc.) sem tocar nas guardrails.

#### P14 — Nenhum Health Check do CLI Server (NOVO rev.4)

O SDK expõe `client.ping()` e `client.getStatus()` para verificar saúde da conexão. O projeto
implementa keepalive de sessão em `agent/infra/session-keepalive.js`, mas NÃO verifica a saúde do
CLI server. Se o CLI crashar, o sistema detecta apenas quando a próxima operação falha.

#### P15 — Sem Verificação de Autenticação no Boot (NOVO rev.4)

`client.getAuthStatus()` retorna `{ isAuthenticated, authType, login, host, statusMessage }`. O
projeto NÃO verifica autenticação no boot — assume que está autenticado. Token expirado ou
inexistente causa falhas silenciosas na criação de sessão.

#### P16 — Account Quota Não Monitorada (NOVO rev.4)

`client.rpc.account.getQuota()` retorna snapshots de quota por tipo (chat, completions,
premium_interactions) com: `entitlementRequests`, `usedRequests`, `remainingPercentage`, `overage`,
`resetDate`. O projeto opera 24/7 com múltiplas sessões mas NÃO monitora quota.

### 🟢 BAIXO

#### P9 — `SYSTEM_PROMPT_SECTIONS` Importado Diretamente

`config/system-prompt.js` importa `SYSTEM_PROMPT_SECTIONS` diretamente do SDK.

#### P10 — `core/sdk-types.js` Duplica Types

27 tipedefs em `core/sdk-types.js` duplicam types já definidos em `hooks/types.js` e no SDK.

#### P17 — `session.abort()` Não Exposto (NOVO rev.4)

Sem capacidade de cancelar requests longos graciosamente.

#### P18 — `joinSession()` Extension API Ignorada (NOVO rev.4)

`joinSession(config?)` de `@github/copilot-sdk/extension` não utilizada (projeto não é extension,
mas poderia usar para composição de sessões).

---

## §4. Fluxos de Dados Completos

### 4.1 Boot do Agent (Resumo)

```
main.js
  └─ agent/entry.js
       └─ agent/lifecycle/initializer.js
            ├─ new CopilotClient(options)  ← BYPASS (P7)
            ├─ client.start()
            ├─ config/session-config.js → buildSessionConfig()
            │    ├─ approveAll             ← BYPASS (P6)
            │    ├─ SYSTEM_PROMPT_SECTIONS ← BYPASS (P9)
            │    ├─ hooks factory          ← BYPASS (P4: tipos paralelos)
            │    └─ tools factory          ← BYPASS (P5: defineTool direto)
            ├─ client.createSession(config)
            │    └─ sdk/session.js → createSession() → SDK
            └─ event-wirer.js → session.on(handler)
                 └─ nerv-bridge.js → 55 event types → NERV bus
```

### 4.2 API Route — POST /sessions

```
api/routes/sessions.js
  ├─ sdk/client.js → getClient()
  ├─ inline config building                ← BYPASS (P1)
  │    ├─ approveAll                       ← BYPASS (P6)
  │    ├─ provider (ProviderConfig)        ← (P11: não wrapped)
  │    └─ model, reasoningEffort, etc.
  ├─ client.createSession(config)
  └─ SSE → channel/ → session events
```

### 4.3 Fluxo de Dados — RPC Subsystems (NOVO rev.4)

```
CopilotSession.rpc (17 subsistemas):
  ├── model.getCurrent()        → RPC "session.model.getCurrent"       → CLI server
  ├── model.switchTo({...})     → RPC "session.model.switchTo"         → CLI server
  ├── mode.get()                → RPC "session.mode.get"               → CLI server
  ├── mode.set({mode})          → RPC "session.mode.set"               → CLI server
  ├── plan.read()               → RPC "session.plan.read"              → CLI server
  ├── plan.update({content})    → RPC "session.plan.update"            → CLI server
  ├── plan.delete()             → RPC "session.plan.delete"            → CLI server
  ├── workspace.listFiles()     → RPC "session.workspace.listFiles"    → CLI server
  ├── workspace.readFile({})    → RPC "session.workspace.readFile"     → CLI server
  ├── workspace.createFile({})  → RPC "session.workspace.createFile"   → CLI server
  ├── fleet.start({prompt?})    → RPC "session.fleet.start"            → CLI server [EXPERIMENTAL]
  ├── agent.*                   → RPC "session.agent.*"                → CLI server [EXPERIMENTAL]
  ├── skills.*                  → RPC "session.skills.*"               → CLI server [EXPERIMENTAL]
  ├── mcp.*                     → RPC "session.mcp.*"                  → CLI server [EXPERIMENTAL]
  ├── compaction.compact()      → RPC "session.compaction.compact"     → CLI server [EXPERIMENTAL]
  ├── shell.exec({command})     → RPC "session.shell.exec"             → CLI server
  ├── shell.kill({processId})   → RPC "session.shell.kill"             → CLI server
  ├── ui.elicitation({...})     → RPC "session.ui.elicitation"         → CLI server
  ├── log({message, level})     → RPC "session.log"                    → CLI server  [ÚNICO USADO]
  ├── tools.handlePending({})   → RPC "session.tools.handlePending"    → CLI server
  ├── commands.handlePending({})→ RPC "session.commands.handlePending"  → CLI server
  └── permissions.handle({})    → RPC "session.permissions.handle"     → CLI server

CopilotClient.rpc (4 métodos):
  ├── ping({message?})          → RPC "server.ping"                    → CLI server
  ├── models.list()             → RPC "server.models.list"             → CLI server
  ├── tools.list({model?})      → RPC "server.tools.list"             → CLI server
  └── account.getQuota()        → RPC "server.account.getQuota"       → CLI server
```

---

## §5. Catálogo de Bypass Completo

### 5.1 `defineTool` (11 arquivos)

Todos em `src/copilot/tools/` e `bridges/`:

1. `tools/file-tools.js`
2. `tools/search-tools.js`
3. `tools/shell-tools.js`
4. `tools/edit-tools.js`
5. `tools/git-tools.js`
6. `tools/browser-tools.js`
7. `tools/task-tools.js`
8. `tools/communication-tools.js`
9. `tools/diagnostics-tools.js`
10. `tools/analysis-tools.js`
11. `bridges/mcp-tool-bridge.js`

### 5.2 `approveAll` (5 arquivos)

1. `config/session-config.js`
2. `hooks/presets.js`
3. `agent/lifecycle/initializer.js`
4. `api/routes/sessions.js`
5. `audit/pipeline.js`

### 5.3 `CopilotClient` (2 arquivos)

1. `agent/lifecycle/initializer.js` — `new CopilotClient(options)`
2. `agent/always-alive.js` — acesso via referência direta

### 5.4 `SYSTEM_PROMPT_SECTIONS` (1 arquivo)

1. `config/system-prompt.js` — acesso direto a seções

### 5.5 SessionConfig campos sem wrapper (bypass implícito)

Estes campos são passados ao SDK sem intermediação do wrapper `sdk/`:

- `sessionId` — passado pela API diretamente
- `clientName` — hardcoded na API
- `availableTools` — construído ad-hoc no agent e API
- `excludedTools` — construído ad-hoc no agent e API
- `provider` — passado pela API (BYOK)
- `skillDirectories` — passado pelo agent diretamente
- `agent` — nunca utilizado
- `disabledSkills` — nunca utilizado
- `configDir` — nunca utilizado
- `onEvent` — nunca utilizado

---

## §6. Análise por Camada

### 6.1 Agent Layer (52 arquivos, ~10.200L)

- **AlwaysAliveAgent** (620L) — loop principal, usa `session.sendAndWait()` e `session.log()`
- **Lifecycle** — boot, shutdown, reconnect — instancia CopilotClient diretamente (P7)
- **Session management** — cria/retoma sessões via paths mistos (P1, P2)
- **Infra** — keepalive, retry, circuit-breaker — NÃO verifica auth ou quota (P15, P16)

### 6.2 Hooks Layer (19 arquivos, ~3.499L)

- **Types paralelos** (309L) — `hooks/types.js` diverge do SDK official types (P4)
- **Factory + bus + registry** — robustos, mas tipam hooks com tipos locais
- **Permission handler** — usa `approveAll` diretamente em presets (P6)

### 6.3 Tools Layer (~40 arquivos, ~6.195L)

- **11 arquivos** importam `defineTool` diretamente (P5)
- **session-rpc-tools.js** — acessa `session.rpc` ad-hoc, sem wrapper centralizado (P11)
- **tool-factory.js** — aggregator, não filtra via wrapper

### 6.4 API Layer (21 arquivos, ~3.233L)

- **sessions.js** — config building inline, bypasses wrapper (P1)
- **BYOK** via `ProviderConfig` — passado sem validação/wrapper (P11)
- **SSE streaming** — events sem tipagem forte (P12)

### 6.5 Observability Layer (21 arquivos, ~4.458L)

- **event-collector.js** — registra listeners para ~55 event types sem tipagem (P12)
- **tool-stats.js** — coleta métricas de tools sem typed payloads
- **Sem quota monitoring** (P16) — deveria ser responsabilidade desta camada

### 6.6 Bridges Layer (10 arquivos, ~2.183L)

- **nerv-bridge.js** — mapeia ~55 session events → NERV bus sem tipagem forte (P12)
- **mcp-tool-bridge.js** — usa `defineTool` diretamente (P5)
- **git-bridge.js** — independente do SDK

---

## §7. Métricas de Acoplamento

### 7.1 Cobertura do Wrapper vs Superfície SDK Real

| Dimensão                      | Total SDK | Wrapped | Cobertura |
| ----------------------------- | --------: | ------: | --------: |
| CopilotClient métodos         |       15+ |       7 |      ~47% |
| CopilotSession métodos        |       12+ |       5 |      ~42% |
| Session RPC subsistemas       |        17 |       1 |       ~6% |
| Server RPC subsistemas        |         4 |       0 |        0% |
| SessionConfig campos          |       23+ |      13 |      ~57% |
| Tipos/interfaces              |       90+ |      13 |      ~14% |
| Session Event types (tipados) |       70+ |       0 |        0% |
| Runtime exports               |         8 |       5 |      ~63% |

### 7.2 Importações Diretas vs Wrapper

| Mecanismo                             | Arquivos | Proporção |
| ------------------------------------- | -------: | --------: |
| `from '@github/copilot-sdk'` (bypass) |       20 |       48% |
| `from '#copilot/sdk'` (wrapper)       |       21 |       52% |
| **Total arquivos com SDK access**     |   **41** |  **100%** |

### 7.3 Features Inteiramente Ausentes (0% cobertura)

Estas features do SDK NÃO existem no projeto — nem no wrapper, nem como bypass:

1. Mode switching (interactive/plan/autopilot)
2. Plan management (read/update/delete)
3. Workspace files (list/read/create)
4. Fleet mode (multi-agent orchestration)
5. Extensions management (list/enable/disable/reload)
6. Plugins management (list)
7. Skills runtime management (list/enable/disable/reload)
8. MCP runtime management (list/enable/disable/reload)
9. Compaction control (manual trigger)
10. UI elicitation (structured input forms)
11. Shell execution via RPC
12. Account quota monitoring
13. Auth status verification
14. CLI server health check (ping/status)
15. Session deletion
16. Model switching mid-session
17. Message history retrieval
18. Session abort (cancel in-flight)
19. System message customize mode (per-section transforms)
20. Built-in tools listing by model

---

## §8. Resumo de Achados por Severidade

| ID  | Severidade | Achado                                                          | Arquivos Impactados |
| --- | :--------: | --------------------------------------------------------------- | :-----------------: |
| P1  | 🔴 CRÍTICO | Dois caminhos de config: buildSessionConfig vs initializer.js   |          3          |
| P2  | 🔴 CRÍTICO | Dois registros de sessão: client.js Map vs session.js stateless |  2 + consumidores   |
| P11 | 🔴 CRÍTICO | 15 subsistemas RPC não expostos pelo wrapper                    |  sdk/ + consumers   |
| P3  |  🔴 ALTO   | Config barrel importa de sdk/ — violação de boundaries          |  1 + consumidores   |
| P4  |  🔴 ALTO   | Tipos de hooks paralelos a tipos SDK                            | 1 + 19 hooks files  |
| P12 |  🔴 ALTO   | 70+ event types sem tipagem forte nos payloads                  | event handlers all  |
| P5  |  🟡 MÉDIO  | `defineTool` usado diretamente em 11 arquivos                   |         11          |
| P6  |  🟡 MÉDIO  | `approveAll` importado diretamente em 5 arquivos                |          5          |
| P7  |  🟡 MÉDIO  | `CopilotClient` instanciado fora do wrapper                     |          2          |
| P8  |  🟡 MÉDIO  | API routes usam features SDK não-wrapped                        |          2          |
| P13 |  🟡 MÉDIO  | SystemMessage `customize` mode não utilizado                    |  config/system-\*   |
| P14 |  🟡 MÉDIO  | Nenhum health check do CLI server                               |     agent/infra     |
| P15 |  🟡 MÉDIO  | Sem verificação de autenticação no boot                         |     agent/boot      |
| P16 |  🟡 MÉDIO  | Account quota não monitorada (operação 24/7)                    |    observability    |
| P9  |  🟢 BAIXO  | `SYSTEM_PROMPT_SECTIONS` importado diretamente                  |          1          |
| P10 |  🟢 BAIXO  | `core/sdk-types.js` duplica tipos já em hooks/types.js          |          2          |
| P17 |  🟢 BAIXO  | `session.abort()` não exposto                                   |          —          |
| P18 |  🟢 BAIXO  | `joinSession()` extension API ignorada                          |          —          |

---

## §9. Conclusão e Recomendação

A análise rev.4 revela que o problema é **significativamente maior** do que estimado na rev.3:

1. **O wrapper cobre apenas ~14% dos tipos e ~6% dos subsistemas RPC do SDK**
2. **20 features inteiras do SDK** são INVISÍVEIS para o projeto
3. **70+ event types** não têm tipagem forte — handlers operam em `any`
4. **A transformação não é apenas de imports** — é uma **expansão massiva de funcionalidade**

A proposta da PARTE-17B rev.4 deve:

1. _(da rev.3)_ Completar o wrapper com TODOS os símbolos SDK usados
2. _(da rev.3)_ Tornar o wrapper o ÚNICO ponto de acesso
3. _(da rev.3)_ Unificar configuração de sessão e registros
4. _(da rev.3)_ Consolidar tipos
5. **(NOVO)** Expor todos os 17 subsistemas RPC via wrappers ergonômicos
6. **(NOVO)** Tipar todos os 70+ event types com typed handlers
7. **(NOVO)** Implementar novas features: auth checking, quota monitoring, health checks, abort
   support, model switching, mode control, plan management
8. **(NOVO)** Criar infraestrutura de extensibilidade para features experimentais do SDK

**Estimativa revisada**: sdk/ precisa crescer de ~3.252 para **~5.500-6.500 linhas**. ~50-60
arquivos precisam de mudanças. 15+ novos módulos/wrappers no sdk/.

---

_Documento gerado pela auditoria PARTE-17, rev.4. Base: leitura completa de 263 arquivos de
src/copilot/ + leitura completa de 9 arquivos de type declarations do SDK oficial (4.498 linhas).
Revisões anteriores preservadas em .rev2.md e .rev3.md._
