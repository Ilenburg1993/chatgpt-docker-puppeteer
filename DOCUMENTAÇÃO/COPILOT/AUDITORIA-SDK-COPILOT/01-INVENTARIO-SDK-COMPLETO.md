# 01 — Inventário Completo: SDK `@github/copilot-sdk` vs `src/copilot`

**Data**: 2026-03-21 | **Revisado**: 2026-03-21
**Status**: Versão Definitiva (pós revisão crítica)
**Legenda**: ✅ = implementado | ⚠️ = parcial | ❌ = ausente | 🧪 = experimental (wrapper existe, sem exposição)

---

## 1. CopilotClient — Métodos de Instância

| Método SDK                           | Nosso Wrapper                        | Arquivo                        | Status                              |
| ------------------------------------ | ------------------------------------ | ------------------------------ | ----------------------------------- |
| `new CopilotClient(opts)`            | `buildClientOptions() + getClient()` | `sdk/session/client.js`        | ✅                                   |
| `client.start()`                     | Implícito via `getClient()` (lazy)   | `sdk/session/client.js`        | ✅                                   |
| `client.stop()`                      | `stopClient()`                       | `sdk/session/client.js`        | ✅                                   |
| `client.forceStop()`                 | `forceStopClient()`                  | `sdk/session/client.js`        | ✅                                   |
| `client.createSession(config)`       | `createClientSession()`              | `sdk/session/client.js`        | ✅                                   |
| `client.resumeSession(id, config)`   | `resumeClientSession()`              | `sdk/session/client.js`        | ✅                                   |
| `client.getState()`                  | `getClientState()`                   | `sdk/session/client.js`        | ✅                                   |
| `client.ping()`                      | `pingClient()`                       | `sdk/session/client.js`        | ✅                                   |
| `client.getStatus()`                 | `getClientStatus()`                  | `sdk/session/client.js`        | ✅                                   |
| `client.getAuthStatus()`             | `getAuthStatus()`                    | `sdk/session/client.js`        | ✅                                   |
| `client.listModels()`                | `listAvailableModels()`              | `sdk/session/client.js`        | ✅                                   |
| `client.getLastSessionId()`          | —                                    | —                              | ❌                                   |
| `client.deleteSession(id)`           | `deleteClientSession()`              | `sdk/session/client.js`        | ✅                                   |
| `client.listSessions(filter?)`       | `listAllClientSessions()`            | `sdk/session/client.js`        | ✅                                   |
| `client.getForegroundSessionId()`    | —                                    | —                              | ❌                                   |
| `client.setForegroundSessionId(id)`  | —                                    | —                              | ❌                                   |
| `client.on(lifecycleEvent, handler)` | Wrappers tipados                     | `sdk/session/client-events.js` | ⚠️ módulo existe, não-wired no agent |

### ClientOptions cobertura

| Opção                      | Status | Notas                              |
| -------------------------- | ------ | ---------------------------------- |
| `cliUrl`                   | ✅      | Via `COPILOT_CLI_URL` env          |
| `isChildProcess`           | ❌      | Não utilizado                      |
| `telemetry.captureContent` | ❌      | Não exposto                        |
| `telemetry.filePath`       | ❌      | Não configurado                    |
| `telemetry.exporterType`   | ✅      | Via OTLP em `buildClientOptions()` |
| `onGetTraceContext`        | ❌      | Não wired                          |

---

## 2. CopilotSession — Métodos de Instância

| Método SDK                               | Nosso Wrapper                      | Arquivo                                     | Status                          |
| ---------------------------------------- | ---------------------------------- | ------------------------------------------- | ------------------------------- |
| `session.send(options)`                  | Direto via `session.send()`        | `agent/dialog/turn-executor.js`             | ✅                               |
| `session.sendAndWait(options, timeout?)` | Direto via `session.sendAndWait()` | `agent/dialog/turn-executor.js`             | ✅                               |
| `session.on(eventType, handler)`         | `subscribeEvent()` + direto        | `sdk/session/events.js` + handlers          | ✅                               |
| `session.on(handler)` (catch-all)        | `subscribeCatchAll()`              | `agent/session/event-handlers/catch-all.js` | ✅                               |
| `session.abort()`                        | `abortSession()`                   | `sdk/session/wrapper.js`                    | ✅                               |
| `session.getMessages()`                  | Via session-tools                  | `tools/session-tools.js`                    | ✅                               |
| `session.disconnect()`                   | `disconnectSession()`              | `sdk/session/lifecycle.js`                  | ✅                               |
| `session.destroy()` (deprecated)         | Mapeado                            | `sdk/session/lifecycle.js`                  | ✅                               |
| `session.[Symbol.asyncDispose]()`        | Suporte via dispose pattern        | —                                           | ✅                               |
| `session.setModel(model, opts?)`         | —                                  | —                                           | ❌ (não exposto como tool/route) |
| `session.log(message, opts?)`            | Via `rpc.log()`                    | `sdk/rpc/ops.js`                            | ✅                               |
| `session.sessionId`                      | Utilizado em todo lugar            | —                                           | ✅                               |
| `session.rpc`                            | `createSessionRpcFacade()`         | `sdk/rpc/session.js`                        | ✅                               |

### SessionConfig cobertura

| Opção                     | Passado em `session-setup.js`?   | Status |
| ------------------------- | -------------------------------- | ------ |
| `model`                   | ✅ `ctx.model`                    | ✅      |
| `reasoningEffort`         | ✅ `ctx.reasoningEffort`          | ✅      |
| `streaming`               | ✅ default `true` em lifecycle.js | ✅      |
| `onPermissionRequest`     | ✅ `ctx.permissions.handler`      | ✅      |
| `onUserInputRequest`      | ✅ `handleUserInputRequest()`     | ✅      |
| `hooks`                   | ✅ `busHooks` (attachBus)         | ✅      |
| `tools`                   | ✅ `bootstrapTools()`             | ✅      |
| `mcpServers`              | ✅ `buildMcpConfig()`             | ✅      |
| `workingDirectory`        | ✅ em `lifecycle.js`              | ✅      |
| `customAgents`            | ✅ em `lifecycle.js`              | ✅      |
| `infiniteSessions`        | ✅ em `lifecycle.js`              | ✅      |
| `systemMessage`           | ✅ em `lifecycle.js`              | ✅      |
| `sessionId`               | ✅ (para resume)                  | ✅      |
| `clientName`              | ❌ não passado                    | ❌      |
| `configDir`               | ❌                                | ❌      |
| `availableTools`          | ❌                                | ❌      |
| `excludedTools`           | ❌                                | ❌      |
| `provider` (BYOK)         | ✅ em `sdk/session/provider.js`   | ✅      |
| `agent` (initial agent)   | ❌                                | ❌      |
| `skillDirectories`        | ❌                                | ❌      |
| `disabledSkills`          | ❌                                | ❌      |
| `onEvent` (early handler) | ❌                                | ❌      |

---

## 3. Session RPC — Namespaces Estáveis

| Namespace                                            | Método                             | Wrapper          | Status |
| ---------------------------------------------------- | ---------------------------------- | ---------------- | ------ |
| `model.getCurrent()`                                 | `modelGetCurrent()`                | `sdk/rpc/ops.js` | ✅      |
| `model.switchTo(params)`                             | `modelSwitchTo()`                  | `sdk/rpc/ops.js` | ✅      |
| `mode.get()`                                         | `modeGet()`                        | `sdk/rpc/ops.js` | ✅      |
| `mode.set(params)`                                   | `modeSet()`                        | `sdk/rpc/ops.js` | ✅      |
| `plan.read()`                                        | `planRead()`                       | `sdk/rpc/ops.js` | ✅      |
| `plan.update(params)`                                | `planUpdate()`                     | `sdk/rpc/ops.js` | ✅      |
| `plan.delete()`                                      | `planDelete()`                     | `sdk/rpc/ops.js` | ✅      |
| `workspace.listFiles(params)`                        | `workspaceListFiles()`             | `sdk/rpc/ops.js` | ✅      |
| `workspace.readFile(params)`                         | `workspaceReadFile()`              | `sdk/rpc/ops.js` | ✅      |
| `workspace.createFile(params)`                       | `workspaceCreateFile()`            | `sdk/rpc/ops.js` | ✅      |
| `tools.handlePendingToolCall(params)`                | `handlePendingToolCall()`          | `sdk/rpc/ops.js` | ✅      |
| `commands.handlePendingCommand(params)`              | `handlePendingCommand()`           | `sdk/rpc/ops.js` | ✅      |
| `ui.elicitation(params)`                             | `uiElicitation()`                  | `sdk/rpc/ops.js` | ✅      |
| `permissions.handlePendingPermissionRequest(params)` | `handlePendingPermissionRequest()` | `sdk/rpc/ops.js` | ✅      |
| `log(params)`                                        | `rpcLog()`                         | `sdk/rpc/ops.js` | ✅      |
| `shell.exec(params)`                                 | `shellExec()`                      | `sdk/rpc/ops.js` | ✅      |
| `shell.kill(params)`                                 | `shellKill()`                      | `sdk/rpc/ops.js` | ✅      |
| `compaction.compact(params)`                         | `compactionCompact()`              | `sdk/rpc/ops.js` | ✅      |

---

## 4. Session RPC — Namespaces Experimentais

| Namespace                    | Método                | Wrapper                   | Exposição (tools/routes) | Status |
| ---------------------------- | --------------------- | ------------------------- | ------------------------ | ------ |
| `fleet.start(params)`        | `fleetStart()`        | `sdk/rpc/experimental.js` | ❌ sem tools/routes       | 🧪      |
| `agent.list()`               | `agentList()`         | `sdk/rpc/experimental.js` | ❌                        | 🧪      |
| `agent.select(params)`       | `agentSelect()`       | `sdk/rpc/experimental.js` | ❌                        | 🧪      |
| `agent.deselect()`           | `agentDeselect()`     | `sdk/rpc/experimental.js` | ❌                        | 🧪      |
| `agent.getStatus(params)`    | `agentGetStatus()`    | `sdk/rpc/experimental.js` | ❌                        | 🧪      |
| `agent.stop(params)`         | `agentStop()`         | `sdk/rpc/experimental.js` | ❌                        | 🧪      |
| `agent.getCurrent()`         | —                     | —                         | —                        | ❌      |
| `agent.reload()`             | —                     | —                         | —                        | ❌      |
| `skills.list()`              | `skillsList()`        | `sdk/rpc/experimental.js` | ❌                        | 🧪      |
| `skills.enable(params)`      | `skillsEnable()`      | `sdk/rpc/experimental.js` | ❌                        | 🧪      |
| `skills.disable(params)`     | `skillsDisable()`     | `sdk/rpc/experimental.js` | ❌                        | 🧪      |
| `skills.getStatus(params)`   | `skillsGetStatus()`   | `sdk/rpc/experimental.js` | ❌                        | 🧪      |
| `skills.reload()`            | —                     | —                         | —                        | ❌      |
| `mcp.list()`                 | `mcpList()`           | `sdk/rpc/experimental.js` | ❌                        | 🧪      |
| `mcp.enable(params)`         | `mcpEnable()`         | `sdk/rpc/experimental.js` | ❌                        | 🧪      |
| `mcp.disable(params)`        | `mcpDisable()`        | `sdk/rpc/experimental.js` | ❌                        | 🧪      |
| `mcp.getStatus(params)`      | `mcpGetStatus()`      | `sdk/rpc/experimental.js` | ❌                        | 🧪      |
| `mcp.reload()`               | —                     | —                         | —                        | ❌      |
| `plugins.list()`             | `pluginsList()`       | `sdk/rpc/experimental.js` | ❌                        | 🧪      |
| `extensions.list()`          | `extensionsList()`    | `sdk/rpc/experimental.js` | ❌                        | 🧪      |
| `extensions.enable(params)`  | `extensionsEnable()`  | `sdk/rpc/experimental.js` | ❌                        | 🧪      |
| `extensions.disable(params)` | `extensionsDisable()` | `sdk/rpc/experimental.js` | ❌                        | 🧪      |

---

## 5. Server RPC (client-scoped via `client.rpc`)

| Namespace            | Método                      | Wrapper                 | Status |
| -------------------- | --------------------------- | ----------------------- | ------ |
| `models.list()`      | Via `listAvailableModels()` | `sdk/session/client.js` | ✅      |
| `account.getQuota()` | —                           | —                       | ❌      |
| `tools.list(params)` | —                           | —                       | ❌      |

---

## 6. SessionHooks — 6 Slots do SDK

| Hook Slot               | Factory default              | Custom override                   | Bus bridge      | Status |
| ----------------------- | ---------------------------- | --------------------------------- | --------------- | ------ |
| `onPreToolUse`          | ✅ `buildPreToolUseHandler()` | ✅ via `cfg.onPreToolUse`          | ✅ `attachBus()` | ✅      |
| `onPostToolUse`         | ✅ audit logging              | ✅ via `cfg.onPostToolUse`         | ✅ `attachBus()` | ✅      |
| `onUserPromptSubmitted` | ✅ audit logging              | ✅ via `cfg.onUserPromptSubmitted` | ✅ `attachBus()` | ✅      |
| `onSessionStart`        | ✅ lifecycle hooks            | ✅ via `cfg.onSessionStart`        | ✅ `attachBus()` | ✅      |
| `onSessionEnd`          | ✅ lifecycle hooks            | ✅ via `cfg.onSessionEnd`          | ✅ `attachBus()` | ✅      |
| `onErrorOccurred`       | ✅ retry/skip/abort           | ✅ via `cfg.onErrorOccurred`       | ✅ `attachBus()` | ✅      |

---

## 7. System Message — Modos

| Modo SDK                            | Wrapper                         | Status                            |
| ----------------------------------- | ------------------------------- | --------------------------------- |
| `append` (default)                  | `appendSystemMessage()`         | ✅ `sdk/session/system-message.js` |
| `replace`                           | `replaceSystemMessage()`        | ✅                                 |
| `customize` (sections + transforms) | `customizeSystemMessage()`      | ✅ (módulo existe)                 |
| `SectionTransformFn` callbacks      | ❓ (suportado no tipo, testado?) | ⚠️                                 |
| `SYSTEM_PROMPT_SECTIONS` re-export  | ✅                               | ✅                                 |

---

## 8. Session Events — Cobertura de Handlers

### ✅ Handlers confirmados (com `session.on()`)

| Evento                        | Handler           | Arquivo                                 |
| ----------------------------- | ----------------- | --------------------------------------- |
| `session.start`               | lifecycle handler | `sdk-responses.js` + `session-hooks.js` |
| `session.idle`                | idle detection    | `sdk-responses.js`                      |
| `session.error`               | error logging     | `sdk-responses.js`                      |
| `session.resume`              | resume detection  | lifecycle handler                       |
| `session.shutdown`            | shutdown handler  | `sdk-responses.js`                      |
| `session.mode_changed`        | mode tracking     | `mode-and-tools.js`                     |
| `session.plan_changed`        | plan tracking     | via hooks                               |
| `session.title_changed`       | title update      | `sdk-responses.js`                      |
| `session.context_changed`     | context tracking  | `sdk-responses.js`                      |
| `session.compaction_start`    | compaction start  | `compaction.js`                         |
| `session.compaction_complete` | compaction done   | `compaction.js`                         |
| `session.truncation`          | truncation alarm  | `sdk-responses.js`                      |
| `session.usage_info`          | token budget      | `token-budget.js`                       |
| `session.task_complete`       | task tracking     | `sdk-responses.js`                      |
| `session.snapshot_rewind`     | snapshot rewind   | `sdk-responses.js`                      |
| `session.handoff`             | handoff detection | `sdk-responses.js`                      |
| `assistant.turn_start`        | turn tracking     | `sdk-responses.js`                      |
| `assistant.turn_end`          | turn tracking     | `sdk-responses.js`                      |
| `assistant.message`           | message capture   | catch-all + streaming                   |
| `assistant.message_delta`     | streaming delta   | `streaming.js`                          |
| `assistant.streaming_delta`   | streaming         | `streaming.js`                          |
| `assistant.intent`            | intent detection  | `sdk-responses.js`                      |
| `assistant.reasoning`         | reasoning capture | `sdk-responses.js`                      |
| `assistant.reasoning_delta`   | reasoning stream  | `streaming.js`                          |
| `assistant.usage`             | token usage       | `usage.js`                              |
| `tool.execution_start`        | tool tracking     | catch-all                               |
| `tool.execution_complete`     | tool tracking     | catch-all                               |
| `subagent.started`            | subagent tracking | `sdk-responses.js`                      |
| `subagent.completed`          | subagent tracking | `sdk-responses.js`                      |
| `subagent.failed`             | subagent error    | `sdk-responses.js`                      |
| `elicitation.requested`       | elicitation       | `sdk-responses.js`                      |
| `abort`                       | abort handler     | `sdk-responses.js`                      |
| `system.notification`         | notification      | `system-notifications.js`               |
| Catch-all `(evt)`             | all events logger | `catch-all.js`                          |

### ❌ Eventos SEM handler específico (catch-all os captura, mas sem lógica dedicada)

| Evento                                          | Impacto                          | Prioridade |
| ----------------------------------------------- | -------------------------------- | ---------- |
| `session.info`                                  | Informacional                    | BAIXO      |
| `session.warning`                               | Log de warnings                  | MÉDIO      |
| `session.model_change`                          | Tracking de mudança de modelo    | MÉDIO      |
| `session.tools_updated`                         | Tracking de atualização de tools | MÉDIO      |
| `session.skills_loaded`                         | Skills tracking                  | BAIXO      |
| `session.mcp_servers_loaded`                    | MCP tracking                     | MÉDIO      |
| `session.mcp_server_status_changed`             | MCP health                       | ALTO       |
| `session.extensions_loaded`                     | Extensions tracking              | BAIXO      |
| `session.background_tasks_changed`              | Background tasks                 | MÉDIO      |
| `session.workspace_file_changed`                | Workspace tracking               | BAIXO      |
| `hook.start` / `hook.end`                       | Hook observability               | BAIXO      |
| `skill.invoked`                                 | Skill tracking                   | MÉDIO      |
| `subagent.selected` / `subagent.deselected`     | Agent tracking                   | MÉDIO      |
| `tool.execution_progress`                       | Tool progress                    | MÉDIO      |
| `tool.execution_partial_result`                 | Partial results                  | BAIXO      |
| `tool.user_requested`                           | User tool request                | MÉDIO      |
| `permission.requested` / `permission.completed` | Permission tracking              | BAIXO      |
| `user_input.requested` / `user_input.completed` | Input tracking                   | BAIXO      |
| `command.queued/execute/completed`              | Command tracking                 | MÉDIO      |
| `commands.changed`                              | Commands tracking                | BAIXO      |
| `exit_plan_mode.requested/completed`            | Plan mode exit                   | BAIXO      |
| `shell_completed` / `shell_detached_completed`  | Shell tracking                   | MÉDIO      |
| `external_tool.requested/completed`             | External tools                   | BAIXO      |
| `mcp.oauth_required/completed`                  | MCP OAuth                        | ALTO       |
| `pending_messages.modified`                     | Pending messages                 | MÉDIO      |
| `custom`                                        | Custom events                    | BAIXO      |

---

## 9. Presets de Hooks

| Preset                | Função                        | Status                           |
| --------------------- | ----------------------------- | -------------------------------- |
| Minimal (debug tools) | `createMinimalHooks()`        | ✅ `hooks/factory.js`             |
| Audit (full logging)  | `createAuditHooks()`          | ✅ `hooks/factory.js`             |
| Deny-all (read-only)  | `createDenyAllHooks()`        | ✅ `hooks/factory.js`             |
| Safe (whitelist)      | `createSafeHooks()`           | ✅ `hooks/factory.js`             |
| Compose handlers      | `composePreToolUseHandlers()` | ✅ `hooks/factory.js`             |
| Error notifier        | `createErrorNotifierHook()`   | ✅ `hooks/factory.js`             |
| Interactive           | —                             | ✅ `hooks/presets/interactive.js` |
| Production            | —                             | ✅ `hooks/presets/production.js`  |
| Profile-based         | —                             | ✅ `hooks/presets/profiles.js`    |

---

## 10. Sumário Quantitativo

| Categoria               | Total SDK | ✅ Implementado | ⚠️ Parcial | 🧪 Wrapper sem exposição | ❌ Ausente               |
| ----------------------- | --------- | -------------- | --------- | ----------------------- | ----------------------- |
| Client methods          | 16        | 12             | 1         | 0                       | 3                       |
| Session methods         | 12        | 11             | 0         | 0                       | 1                       |
| SessionConfig options   | 21        | 14             | 0         | 0                       | 7                       |
| RPC estáveis            | 18        | 18             | 0         | 0                       | 0                       |
| RPC experimentais       | 23        | 0              | 0         | 19                      | 4                       |
| Server RPC              | 3         | 1              | 0         | 0                       | 2                       |
| SessionHooks            | 6         | 6              | 0         | 0                       | 0                       |
| System message modes    | 4         | 3              | 1         | 0                       | 0                       |
| Session events          | 55+       | 33             | 0         | 0                       | 22+ (catch-all captura) |
| Client lifecycle events | 5         | 0              | 5         | 0                       | 0                       |
| Hook presets            | 7+        | 7+             | 0         | 0                       | 0                       |

**Cobertura estimada**: ~75% (APIs estáveis: ~90%, APIs experimentais: ~0% exposto, events: ~60% com handler dedicado)
