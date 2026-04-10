# PARTE-17A — Análise Completa da Situação Atual do SDK

**Data**: 2026-03-20 (rev.2 — integração completa)
**Escopo**: `src/copilot/sdk/` (20 arquivos, ~3.252 linhas) + API Express (21 arquivos, ~3.233 linhas) + Agent layer (52 arquivos, ~10.200 linhas) + Observability (21 arquivos, ~4.400 linhas) + Bridges (10 arquivos, ~2.183 linhas) + Channel (7 arquivos, ~1.497 linhas)
**SDK oficial**: `@github/copilot-sdk@0.2.0` (instalado) | `0.2.1` (NPM latest)
**Autor**: Auditoria automatizada PARTE-17

---

## 1. Inventário Completo do SDK Layer

### 1.1 Arquivos e Linhas

| Arquivo                       | Linhas     | Responsabilidade                                |
| ----------------------------- | ---------- | ----------------------------------------------- |
| `sdk/index.js`                | 119        | Barrel de re-exportação                         |
| `sdk/client.js`               | 414        | CopilotClient singleton + session registry      |
| `sdk/session.js`              | 300        | Session CRUD + config builders                  |
| `sdk/agents.js`               | 175        | Agent factories (presets)                       |
| `sdk/tools-registry.js`       | 262        | ToolRegistry com CRUD e composição              |
| `sdk/event-helpers.js`        | 140        | waitForEvent/raceEvents                         |
| `sdk/agent-contract.js`       | 76         | AgentPlugin typedef                             |
| `sdk/bridge-contract.js`      | 55         | EventBridge/ToolBridge/CommandBridge typedefs   |
| `sdk/channel-contract.js`     | 55         | ChannelPlugin typedef                           |
| `sdk/custom-tools.js`         | 327        | Custom tools declarativas + BUILTIN_HANDLER_MAP |
| `sdk/http-request.js`         | 61         | HTTP helper (loopback)                          |
| `sdk/url-validator.js`        | 100        | Validação anti-SSRF                             |
| `sdk/tools-state.js`          | 151        | Allow/deny lists de ferramentas                 |
| `sdk/utils.js`                | 37         | pickDefined helper                              |
| `sdk/models/index.js`         | 40         | Barrel modelos                                  |
| `sdk/models/helpers.js`       | 254        | listModels, pickModel, buildReasoningConfig     |
| `sdk/models/known-models.js`  | 130        | Catálogo estático (11 modelos)                  |
| `sdk/models/registry.js`      | 215        | ModelRegistry + singletons                      |
| `sdk/models/selector.js`      | 216        | ModelSelector + AutoDowngradeDetector           |
| `sdk/models/stats-tracker.js` | 125        | ModelStatsTracker                               |
| **Total**                     | **~3.252** |                                                 |

### 1.2 API Express Derivada

| Módulo                              | Linhas     | Endpoints                                         |
| ----------------------------------- | ---------- | ------------------------------------------------- |
| `api/express/client.js`             | 205        | /ping, /status, /auth, /models, /tools, /client/* |
| `api/express/sessions.js`           | 100        | Barrel + auth middleware                          |
| `api/express/session-crud.js`       | 371        | CRUD sessions + foreground                        |
| `api/express/session-messaging.js`  | 295        | /send, /stream, /model, /abort, /messages         |
| `api/express/session-middleware.js` | 159        | Session resolution middleware                     |
| `api/express/agent.js`              | 214        | /agent/* endpoints                                |
| `api/express/hooks.js`              | 120        | /hooks/* introspection                            |
| `api/express/observability.js`      | 310        | /metrics, /errors, /logs, /health                 |
| `api/express/webhooks.js`           | (variável) | /webhooks CRUD                                    |
| `api/express/middleware.js`         | 89         | withErrorHandler + ERROR_STATUS_MAP               |
| `api/bridge/*`                      | ~1.056     | Bridge API (control, dialog, stream, tasks)       |
| `api/sse/*`                         | ~500       | SSE fanout/replay                                 |

### 1.3 Hooks Layer (re-exportado via SDK barrel)

| Arquivo                       | Linhas     | Papel                                                               |
| ----------------------------- | ---------- | ------------------------------------------------------------------- |
| `hooks/factory.js`            | 416        | Factory principal de SessionHooks                                   |
| `hooks/types.js`              | 309        | Typedefs extensivas                                                 |
| `hooks/registry.js`           | 176        | Hook registry                                                       |
| `hooks/bus.js`                | 185        | Event bus hooks                                                     |
| `hooks/composer.js`           | 193        | Composição de hooks                                                 |
| `hooks/error-handler.js`      | 307        | Error hook handler                                                  |
| `hooks/tool-interceptor.js`   | 265        | Pre/post tool hooks                                                 |
| `hooks/permission-handler.js` | 217        | Permission hook                                                     |
| `hooks/session-lifecycle.js`  | 139        | Session start/end hooks                                             |
| `hooks/user-input.js`         | 176        | User input handler                                                  |
| `hooks/prompt-transformer.js` | 151        | Prompt transformation                                               |
| `hooks/presets/*`             | ~545       | 6 presets (production, safe, interactive, audit, deny-all, minimal) |
| **Total**                     | **~3.499** |                                                                     |

---

## 2. Mapeamento: API Oficial SDK vs. Nossa Implementação

### 2.1 CopilotClient — Cobertura

| Feature SDK Oficial                      | Nossa Implementação                                                   | Status                           |
| ---------------------------------------- | --------------------------------------------------------------------- | -------------------------------- |
| `new CopilotClient(options)`             | `getClient(overrides)` singleton                                      | ✅ Implementado                   |
| `client.start()`                         | Implícito via autoStart                                               | ✅ Via getClient                  |
| `client.stop()`                          | `stopClient()`                                                        | ✅ Implementado                   |
| `client.forceStop()`                     | `forceStopClient()`                                                   | ✅ Implementado                   |
| `client.createSession(config)`           | `createSession(client, opts)` → `createClientSession(config)`         | ✅ Implementado                   |
| `client.resumeSession(id, config)`       | `resumeSession(client, id, opts)` → `resumeClientSession(id, config)` | ✅ Implementado                   |
| `client.getState()`                      | `getClientState()`                                                    | ✅ Implementado                   |
| `client.ping()`                          | `pingClient()`                                                        | ✅ Implementado                   |
| `client.getStatus()`                     | `getClientStatus()`                                                   | ✅ Implementado                   |
| `client.getAuthStatus()`                 | `getAuthStatus()`                                                     | ✅ Implementado                   |
| `client.listModels()`                    | `listAvailableModels()`                                               | ✅ Implementado                   |
| `client.listSessions(filter)`            | `listAllClientSessions(filter)`                                       | ✅ Implementado                   |
| `client.deleteSession(id)`               | `deleteClientSession(id)`                                             | ✅ Implementado                   |
| `client.getLastSessionId()`              | ❌ Não exposto                                                         | ❌ **GAP**                        |
| `client.getForegroundSessionId()`        | Exposto via API route                                                 | ✅ Via API                        |
| `client.setForegroundSessionId(id)`      | Exposto via API route                                                 | ✅ Via API                        |
| `client.on(eventType, handler)`          | ❌ Não wrappado                                                        | ❌ **GAP**                        |
| `client.on(handler)` (all events)        | ❌ Não wrappado                                                        | ❌ **GAP**                        |
| `CopilotClientOptions.cliArgs`           | ❌ Não exposto                                                         | ❌ **GAP**                        |
| `CopilotClientOptions.cwd`               | ❌ Não exposto                                                         | ⚠️ Parcial (via workingDirectory) |
| `CopilotClientOptions.port`              | ❌ Não exposto                                                         | ❌ **GAP**                        |
| `CopilotClientOptions.useStdio`          | ❌ Não exposto                                                         | ❌ **GAP**                        |
| `CopilotClientOptions.isChildProcess`    | ❌ Não exposto                                                         | ❌ **GAP**                        |
| `CopilotClientOptions.logLevel`          | ❌ Não exposto                                                         | ❌ **GAP**                        |
| `CopilotClientOptions.autoStart`         | Sempre true                                                           | ⚠️ Hardcoded                      |
| `CopilotClientOptions.env`               | ❌ Não exposto                                                         | ❌ **GAP**                        |
| `CopilotClientOptions.githubToken`       | ❌ Não exposto                                                         | ❌ **GAP**                        |
| `CopilotClientOptions.useLoggedInUser`   | ❌ Não exposto                                                         | ❌ **GAP**                        |
| `CopilotClientOptions.onListModels`      | ❌ Não exposto                                                         | ❌ **GAP**                        |
| `CopilotClientOptions.telemetry`         | Parcial (OTEL endpoint)                                               | ⚠️ Parcial                        |
| `CopilotClientOptions.onGetTraceContext` | ❌ Não exposto                                                         | ❌ **GAP**                        |

### 2.2 CopilotSession — Cobertura

| Feature SDK Oficial                     | Nossa Implementação                      | Status                                |
| --------------------------------------- | ---------------------------------------- | ------------------------------------- |
| `session.send(options)`                 | Via API `/sessions/:id/send`             | ✅ Implementado                        |
| `session.sendAndWait(options, timeout)` | Via API `/sessions/:id/send` (sync mode) | ✅ Implementado                        |
| `session.on(eventType, handler)`        | Via SSE stream                           | ⚠️ Parcial (via SSE, não programático) |
| `session.on(handler)` (all events)      | Via SSE stream                           | ⚠️ Parcial                             |
| `session.abort()`                       | Via API `/sessions/:id/abort`            | ✅ Implementado                        |
| `session.disconnect()`                  | Via API `/sessions/:id/disconnect`       | ✅ Implementado                        |
| `session.getMessages()`                 | Via API `/sessions/:id/messages`         | ✅ Implementado                        |
| `session.setModel(model, opts)`         | Via API `/sessions/:id/model`            | ✅ Implementado                        |
| `session.log(message, opts)`            | ❌ Não implementado                       | ❌ **GAP**                             |
| `session.workspacePath`                 | ❌ Não exposto                            | ❌ **GAP**                             |
| `session.capabilities`                  | ❌ Não implementado                       | ❌ **GAP** (v0.2.1)                    |
| `session.ui` (elicitation)              | ❌ Não implementado                       | ❌ **GAP** (v0.2.1)                    |
| `session.rpc` (typed RPC)               | ❌ Não exposto                            | ❌ **GAP**                             |
| `Symbol.asyncDispose`                   | ❌ Não utilizado                          | ⚠️ Nice-to-have                        |

### 2.3 SessionConfig — Cobertura

| Config Option               | Nossa Implementação              | Status             |
| --------------------------- | -------------------------------- | ------------------ |
| `sessionId`                 | ❌ Não exposto                    | ❌ **GAP**          |
| `clientName`                | ❌ Não exposto                    | ❌ **GAP**          |
| `model`                     | ✅ Via buildSessionConfig         | ✅                  |
| `reasoningEffort`           | ✅ Via buildSessionConfig         | ✅                  |
| `configDir`                 | ❌ Não exposto                    | ❌ **GAP**          |
| `tools`                     | ✅ Via buildSessionConfig         | ✅                  |
| `systemMessage`             | ✅ Modo customize                 | ✅                  |
| `availableTools`            | ❌ Não implementado               | ❌ **GAP**          |
| `excludedTools`             | ❌ Não implementado               | ❌ **GAP**          |
| `provider` (BYOK)           | ❌ Não implementado               | ❌ **GAP CRÍTICO**  |
| `onPermissionRequest`       | ✅ Via hooks/permission           | ✅                  |
| `onUserInputRequest`        | ✅ Via hooks/user-input           | ✅                  |
| `onElicitationRequest`      | ❌ Não implementado               | ❌ **GAP** (v0.2.1) |
| `hooks`                     | ✅ Via hooks/factory              | ✅                  |
| `workingDirectory`          | ✅ Via buildSessionConfig         | ✅                  |
| `streaming`                 | ✅ Via buildSessionConfig         | ✅                  |
| `mcpServers`                | ✅ Via buildSessionConfig         | ✅                  |
| `customAgents`              | ✅ Via buildSessionConfig         | ✅                  |
| `agent` (auto-select)       | ❌ Não implementado               | ❌ **GAP**          |
| `skillDirectories`          | ❌ Não implementado               | ❌ **GAP**          |
| `disabledSkills`            | ❌ Não implementado               | ❌ **GAP**          |
| `infiniteSessions`          | ✅ Via buildInfiniteSessionConfig | ✅                  |
| `onEvent` (early handler)   | ❌ Não implementado               | ❌ **GAP**          |
| `commands` (slash commands) | ❌ Não implementado               | ❌ **GAP** (v0.2.1) |

### 2.4 Modelos — Cobertura

| Feature                        | Nossa Implementação          | Status              |
| ------------------------------ | ---------------------------- | ------------------- |
| listModels com cache           | ✅ 5min TTL                   | ✅                   |
| filterEnabled/Reasoning/Vision | ✅ Implementado               | ✅                   |
| pickModel com critérios        | ✅ Implementado               | ✅                   |
| resolveModelId com fallback    | ✅ Implementado               | ✅                   |
| buildReasoningConfig           | ✅ Implementado               | ✅                   |
| ModelRegistry (known-models)   | ✅ 11 modelos                 | ✅                   |
| enrichFromSdk                  | ✅ Implementado               | ✅                   |
| ModelSelector (heurístico)     | ✅ Score composto             | ✅                   |
| ModelStatsTracker              | ✅ Implementado               | ✅                   |
| AutoDowngradeDetector          | ✅ Implementado               | ✅                   |
| Catálogo desatualizado         | ⚠️ Falta gpt-5, claude-opus-4 | ⚠️ **DESATUALIZADO** |

### 2.5 Hooks — Cobertura

| Hook SDK Oficial        | Nossa Implementação                                       | Status |
| ----------------------- | --------------------------------------------------------- | ------ |
| `onPreToolUse`          | ✅ tool-interceptor.js + factory                           | ✅      |
| `onPostToolUse`         | ✅ tool-interceptor.js + factory                           | ✅      |
| `onUserPromptSubmitted` | ✅ prompt-transformer.js                                   | ✅      |
| `onSessionStart`        | ✅ session-lifecycle.js                                    | ✅      |
| `onSessionEnd`          | ✅ session-lifecycle.js                                    | ✅      |
| `onErrorOccurred`       | ✅ error-handler.js                                        | ✅      |
| Hook presets (6)        | ✅ production, safe, interactive, audit, deny-all, minimal | ✅      |
| Hook registry           | ✅ registry.js + bus.js                                    | ✅      |
| Hook composer           | ✅ composer.js                                             | ✅      |

### 2.6 Tools Layer — Cobertura

| Feature                     | Nossa Implementação                | Status |
| --------------------------- | ---------------------------------- | ------ |
| `defineTool` usage          | ✅ Via buildTool factory            | ✅      |
| skipPermission flag         | ✅ Suportado                        | ✅      |
| overridesBuiltInTool        | ❌ Não utilizado                    | ⚠️ GAP  |
| Custom tools (declarativas) | ✅ BUILTIN_HANDLER_MAP (6 handlers) | ✅      |
| Custom tools persistência   | ✅ custom-tools.json                | ✅      |
| tools-state (allow/deny)    | ✅ Implementado                     | ✅      |
| ToolRegistry composição     | ✅ merge/filter/exclude             | ✅      |
| Zod schema support          | ❌ Usa JSON Schema diretamente      | ⚠️ GAP  |

---

## 3. Bugs e Problemas Identificados

### 3.1 Bugs Confirmados

| ID         | Severidade | Arquivo                      | Descrição                                                                                                                                                                     |
| ---------- | ---------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-SDK-01 | **ALTA**   | `sdk/client.js`              | `forceStopClient` usa optional chaining no client mas não limpa `_sessions` Map → sessões orphan permanecem no registry                                                       |
| BUG-SDK-02 | **MÉDIA**  | `sdk/custom-tools.js`        | `loadCustomTools()` chamado na importação do módulo (side-effect) com FS sync. Se falhar, silenciosamente ignora — mas o `_registry` pode estar num estado corrompido parcial |
| BUG-SDK-03 | **MÉDIA**  | `sdk/tools-state.js`         | `loadToolsConfig()` chamado implicitamente. `patchToolsConfig()` usa `persistToolsConfig()` sync (deprecated, não async)                                                      |
| BUG-SDK-04 | **BAIXA**  | `sdk/custom-tools.js`        | `registerCustomTool()` chama `persistCustomTools()` (sync) — deveria chamar `_persistCustomToolsAsync()`                                                                      |
| BUG-SDK-05 | **BAIXA**  | `sdk/models/known-models.js` | Catálogo desatualizado: não inclui gpt-5, claude-opus-4, gemini-2.5-flash                                                                                                     |

### 3.2 Design Gaps Estruturais

| ID     | Impacto     | Descrição                                                                                                           |
| ------ | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| GAP-01 | **CRÍTICO** | Nenhum suporte a `ProviderConfig` (BYOK) — não é possível usar providers externos (Ollama, Azure, Anthropic direto) |
| GAP-02 | **ALTO**    | Não expõe `client.on()` — lifecycle events (session.created, etc.) não são acessíveis programaticamente             |
| GAP-03 | **ALTO**    | `session.log()` não implementado — impossível enviar log entries para a timeline                                    |
| GAP-04 | **ALTO**    | `availableTools` / `excludedTools` (filtros nativos SDK) não expostos — força uso do nosso tools-state custom       |
| GAP-05 | **ALTO**    | `session.capabilities` / `session.ui` não implementados — sem suporte a elicitation                                 |
| GAP-06 | **MÉDIO**   | `commands` (slash commands SDK) não implementados                                                                   |
| GAP-07 | **MÉDIO**   | `client.getLastSessionId()` não exposto                                                                             |
| GAP-08 | **MÉDIO**   | `sessionId`, `clientName`, `configDir` não passados na config                                                       |
| GAP-09 | **MÉDIO**   | `agent` auto-select em SessionConfig não implementado                                                               |
| GAP-10 | **MÉDIO**   | `skillDirectories` / `disabledSkills` não expostos                                                                  |
| GAP-11 | **MÉDIO**   | `onEvent` (early event handler) não passado                                                                         |
| GAP-12 | **BAIXO**   | `session.rpc` (typed RPC methods) não exposto                                                                       |
| GAP-13 | **BAIXO**   | `Symbol.asyncDispose` não utilizado                                                                                 |
| GAP-14 | **BAIXO**   | SDK 0.2.1 disponível (instalado: 0.2.0) — `onElicitationRequest`, `commands`, `capabilities.ui` requerem upgrade    |

### 3.3 Inconsistências de Tipagem

| ID     | Arquivo                 | Descrição                                                                                          |
| ------ | ----------------------- | -------------------------------------------------------------------------------------------------- |
| TYP-01 | `sdk/client.js`         | Typedef `SessionLifecycleHandler` importado do SDK mas não integrado com nosso wrapper             |
| TYP-02 | `sdk/session.js`        | Tipos `SessionCreateOptions` / `SessionResumeOptions` são nossos; não refletem novos campos do SDK |
| TYP-03 | `sdk/agents.js`         | `CustomAgentConfig` importado do SDK mas campos `infer` e `mcpServers` nunca testados              |
| TYP-04 | `sdk/models/helpers.js` | Tipos `ModelCapabilities`, `ModelPolicy`, `ModelBilling` importados mas not fully used             |
| TYP-05 | `sdk/tools-registry.js` | `ToolEntry.tool` é `unknown` — deveria ser `import('@github/copilot-sdk').Tool`                    |

### 3.4 Dívida Técnica

| ID      | Tipo           | Descrição                                                                                                                                            |
| ------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEBT-01 | FS Sync        | `loadCustomTools()` e `loadToolsConfig()` sync executados como side-effects na importação                                                            |
| DEBT-02 | Deprecated     | `persistCustomTools()` e `persistToolsConfig()` sync — já existem versões async mas não são usadas por `registerCustomTool()` / `patchToolsConfig()` |
| DEBT-03 | Module paths   | `@module` headers incorretos em vários arquivos (ex: `copilot/config/custom-tools-registry` em `sdk/custom-tools.js`)                                |
| DEBT-04 | Test isolation | `_resetRegistry()` e `_resetClientState()` são helpers de teste expostos como exports — não protegidos                                               |
| DEBT-05 | Session Map    | `_sessions` Map em client.js cresce sem bound — sem TTL ou eviction                                                                                  |

---

## 4. Cobertura de Testes do SDK Layer

Baseado na última execução: **3.101 testes passed, 335 arquivos.**

| Domínio                   | Arquivos de teste       | Status            |
| ------------------------- | ----------------------- | ----------------- |
| `sdk/client.js`           | ✅ Testado (Faixa 11)    | Cobertura boa     |
| `sdk/session.js`          | ✅ Testado (Faixa 11)    | Cobertura boa     |
| `sdk/agents.js`           | ✅ Testado (Faixa 11)    | Cobertura boa     |
| `sdk/tools-registry.js`   | ✅ Testado (Faixa 11)    | Cobertura boa     |
| `sdk/event-helpers.js`    | ✅ Testado               | Cobertura boa     |
| `sdk/custom-tools.js`     | ✅ Testado (Faixa 11)    | Cobertura parcial |
| `sdk/tools-state.js`      | ✅ Testado               | Cobertura parcial |
| `sdk/models/*`            | ✅ Testado (Faixa 9)     | Cobertura boa     |
| `sdk/url-validator.js`    | ✅ Testado               | Cobertura boa     |
| `sdk/http-request.js`     | ⚠️ Testado indiretamente | Cobertura fraca   |
| `sdk/utils.js`            | ✅ Simples               | Cobertura OK      |
| `sdk/agent-contract.js`   | N/A (apenas types)      | —                 |
| `sdk/bridge-contract.js`  | N/A (apenas types)      | —                 |
| `sdk/channel-contract.js` | N/A (apenas types)      | —                 |
| API Express routes        | ✅ Testado (Faixa 11)    | Cobertura parcial |
| Hooks layer               | ✅ Testado (Faixa 10)    | Cobertura boa     |

---

## 5. Resumo Quantitativo

| Métrica                        | Valor    |
| ------------------------------ | -------- |
| Features SDK oficiais mapeadas | 62       |
| ✅ Totalmente implementadas     | 35 (56%) |
| ⚠️ Parcialmente implementadas   | 9 (15%)  |
| ❌ Não implementadas (GAPs)     | 18 (29%) |
| Bugs confirmados               | 5        |
| Design gaps estruturais        | 14       |
| Inconsistências de tipagem     | 5        |
| Itens de dívida técnica        | 5        |

### Distribuição por severidade

| Severidade | Contagem                                                                     |
| ---------- | ---------------------------------------------------------------------------- |
| CRÍTICO    | 1 (BYOK/Provider)                                                            |
| ALTO       | 5 (lifecycle events, session.log, tools filtering, elicitation, version lag) |
| MÉDIO      | 9                                                                            |
| BAIXO      | 7                                                                            |

---

## 6. Conclusão

A implementação SDK cobre **~71%** (implementado + parcial) das features do `@github/copilot-sdk@0.2.0`, com boa profundidade nos módulos core (client, session, hooks, models). No entanto, existem **18 features não implementadas**, com destaque para:

1. **BYOK/Provider** — bloqueio total para uso com providers externos
2. **Lifecycle events** — sem observabilidade programática de eventos de sessão no client
3. **Elicitation/UI** — feature nova no 0.2.1, sem suporte
4. **Tools filtering nativo** (`availableTools`/`excludedTools`) — duplica lógica com nosso `tools-state`
5. **Commands** (slash commands) — feature nova, sem suporte

A parte de modelos está sólida (ModelRegistry, Selector, StatsTracker, AutoDowngrade), mas o catálogo de known-models precisa de atualização.

A dívida técnica principal é o uso de FS sync como side-effects na importação de módulos, e versões deprecated de persistência.

---

## 7. Integração Agent Layer ↔ SDK

### 7.1 Agent como Consumidor Principal

O `src/copilot/agent/` (52 arquivos, ~10.200 linhas) é o **consumidor principal** do SDK layer. A cadeia de integração:

```
agent/lifecycle/agent-lifecycle.js
  → CopilotClient(telemetry: buildTelemetryConfig())
  → initSession() via session-setup.js
    → buildSessionTools() → bootstrapTools(registry, mcpTools)
    → buildSessionHooks() → createHooks() + attachBus()
    → buildSessionOptions() → model, permissions, hooks, tools, mcpServers
  → session/initializer.js → resumeOrCreate()
    → availableTools, excludedTools, skillDirectories, customAgents, infiniteSessions
  → session-setup.js finalizeSessionInit()
    → setSessionRpc(session.rpc)
```

### 7.2 Features SDK usadas DIRETAMENTE pelo Agent (bypass do SDK wrapper)

**DESCOBERTA IMPORTANTE**: Várias features que foram listadas como "GAP" no SDK wrapper (seção 2.3) são na verdade **já usadas** pelo agent layer, que importa diretamente do `@github/copilot-sdk` ao invés de usar o wrapper `sdk/session.js`:

| Feature               | Onde é usado                            | Status real              |
| --------------------- | --------------------------------------- | ------------------------ |
| `availableTools`      | `agent/session/initializer.js` L140     | ✅ Usado (bypass wrapper) |
| `excludedTools`       | `agent/session/initializer.js` L139     | ✅ Usado (bypass wrapper) |
| `skillDirectories`    | `agent/session/initializer.js` L137     | ✅ Usado (bypass wrapper) |
| `customAgents`        | `agent/session/initializer.js` L149     | ✅ Usado (bypass wrapper) |
| `infiniteSessions`    | `agent/session/initializer.js` L135     | ✅ Usado (bypass wrapper) |
| `workingDirectory`    | `agent/session/initializer.js` L136     | ✅ Usado (bypass wrapper) |
| `session.rpc`         | `agent/lifecycle/session-setup.js` L115 | ✅ Usado (bypass wrapper) |
| `onUserInputRequest`  | `agent/dialog/user-input-handler.js`    | ✅ Usado (bypass wrapper) |
| `onPermissionRequest` | `agent/session/initializer.js` L148     | ✅ Usado (bypass wrapper) |
| `mcpServers`          | `agent/session/initializer.js` L146     | ✅ Usado (bypass wrapper) |

**Implicação**: O "GAP" real não é que estas features estão faltando, mas que o **SDK wrapper** (`sdk/session.js → buildSessionConfig`) **não as centraliza**. O agent as passa diretamente. Isso cria:

1. **Duplicação de lógica** — tools filtering é feito tanto por `tools-state.js` quanto pela passagem direta de `availableTools`/`excludedTools`
2. **Config não centralizada** — qualquer consumidor não-agent (API Express, terminal, channel) não tem acesso fácil a estas features
3. **Tipagem dispersa** — os tipos para `availableTools`, `excludedTools`, etc. estão em typedefs locais e não no barrel SDK
4. **Testabilidade reduzida** — não é possível testar o config-building isoladamente

### 7.3 Agent Sub-módulos e sua relação com SDK

| Sub-módulo Agent   | Arquivos     | SDK Features usadas                                                  |
| ------------------ | ------------ | -------------------------------------------------------------------- |
| `agent/lifecycle/` | 4 (~984L)    | CopilotClient, buildTelemetryConfig, initSession, session.rpc        |
| `agent/session/`   | 18 (~2.900L) | resumeOrCreate, session events, cleanup (listSessions/deleteSession) |
| `agent/dialog/`    | 8 (~1.670L)  | session.send (via EventEmitter), user-input handler, backpressure    |
| `agent/infra/`     | 8 (~1.295L)  | tools-registry, wrapWithStats, tools-bootstrap, permission           |
| `agent/messaging/` | 2 (~168L)    | MessageOptions attachments (SDK type)                                |
| `agent/state/`     | 2 (~80L)     | Não-SDK (state interno)                                              |

### 7.4 Session RPC — Uso extensivo

O `session-rpc-tools.js` (em `src/copilot/tools/`) expõe os RPCs internos do SDK como ferramentas do agente:

| RPC Method           | Tool Name                    | Funcionalidade                                |
| -------------------- | ---------------------------- | --------------------------------------------- |
| `agent/listAgents`   | `session_list_agents`        | Listar sub-agentes disponíveis                |
| `agent/selectAgent`  | `session_select_agent`       | Selecionar sub-agente ativo                   |
| `session/getMode`    | `session_get_mode`           | Obter modo atual (interactive/plan/autopilot) |
| `session/setMode`    | `session_set_mode`           | Mudar modo da sessão                          |
| `plan/read`          | `session_read_plan`          | Ler plan.md da sessão infinita                |
| `plan/update`        | `session_update_plan`        | Atualizar plan.md                             |
| `compaction/trigger` | `session_trigger_compaction` | Forçar compactação de contexto                |

---

## 8. Integração Observability ↔ SDK

### 8.1 Telemetria (OTEL)

`src/copilot/observability/otel.js` (230L) fornece:
- `buildTelemetryConfig()` — constrói `CopilotClientOptions.telemetry` com suporte a OTLP HTTP ou arquivo JSONL
- `startSpan(name, attrs, fn)` — instrumentação manual com graceful degradation (se `@opentelemetry/sdk-trace-node` não instalado, é no-op)
- `startSpanImmediate(name, attrs)` — span sem wrapper para event handlers

**Integração**: `agent-lifecycle.js` passa `buildTelemetryConfig()` ao `CopilotClient()` constructor.

**Gap**: O `TelemetryConfig` do nosso `otel.js` usa campos `{otlpEndpoint, filePath, exporterType, sourceName, captureContent}`, mas o SDK oficial aceita o tipo `TelemetryConfig` completo de `@github/copilot-sdk` que pode ter campos adicionais. Não há validação de paridade.

### 8.2 Event Collector

`src/copilot/observability/event-collector.js` (391L) captura **70+ tipos de eventos** do SDK via `session.on()`:
- Tool calls (start/complete) com latência e pending tracking
- Token usage (input/output/cache) por modelo
- Session lifecycle (start/resume/error/compaction)
- Assistant outputs (message/intent/reasoning)
- Elicitation e user input events
- Sub-agent events
- MCP OAuth events

**Integração**: O collector `.attach(session, sessionId)` é chamado em `boot-wiring.js` após a sessão ser criada.

**Gap/Bug**: O `DEFAULT_PERSIST_TYPES` Set inclui 55 tipos de eventos. Mas não há validação contra os tipos reais que o SDK 0.2.1 emite — novos tipos adicionados pelo SDK seriam silenciosamente ignorados.

### 8.3 Metrics Store

`src/copilot/observability/metrics.js` (425L) — `MetricsStore` com:
- Tool call latências (histogramas rolling p50/p95/p99)
- Token usage por modelo
- Session starts/ends/errors/rotations/cleanups/handoffs
- Dialog turns, stalls, timeouts
- Streaming chunks, question latencies
- Counters e gauges genéricos
- Periodic snapshot (JSONL) para análise off-line

**Integração**: Consumido por `event-collector` (alimenta métricas) e `agent-event-observer` (alimenta a partir do EventEmitter do agent).

### 8.4 Error Tracking & Alerting

- `error-tracker.js` (232L) — ring buffer de erros com taxa global
- `error-alerting.js` (239L) — alertas baseados em janela temporal (5 warns, 15 crits em 60s)
- `agent-event-observer.js` (130L) — observer pattern: attach/detach no EventEmitter do agent

### 8.5 Tool Stats

`tool-stats.js` (163L) — wrapper transparente via `wrapWithStats(tool)`:
- Captura latência, success/error por tool
- `getToolStats()` e `getStatsByCategory()`
- Aplicado a TODAS as tools em `bootstrapTools()`

### 8.6 Gaps de Observabilidade

| ID         | Impacto | Descrição                                                                                      |
| ---------- | ------- | ---------------------------------------------------------------------------------------------- |
| OBS-GAP-01 | ALTO    | Event types catalog desatualizado vs. SDK 0.2.1 — novos event types seriam ignorados           |
| OBS-GAP-02 | MÉDIO   | OTEL `TelemetryConfig` não validado contra types oficiais do SDK                               |
| OBS-GAP-03 | MÉDIO   | `session.capabilities` não monitorado — sem alertas quando features são desabilitadas          |
| OBS-GAP-04 | BAIXO   | Sem métricas de elicitation (pendentes no `DEFAULT_PERSIST_TYPES` mas sem histograma dedicado) |

---

## 9. Integração Bridges ↔ SDK

### 9.1 NERV Bridge

`src/copilot/bridges/nerv-bridge.js` (385L) — **52 event mappings** do agent EventEmitter para NERV envelope:
- Outbound: agent events → NERV `COPILOT_*` action codes
- Inbound: NERV commands → `sendMessage`, `pause`, `resume`, etc.
- Cobertura extensiva de eventos (session, dialog, tool, permission, subagent, streaming)

**Integração com SDK**: O nerv-bridge observa o `alwaysAliveAgent` EventEmitter (não a session SDK diretamente). Os eventos do SDK são primeiro capturados pelo `event-collector` e re-emitidos pelo agent.

### 9.2 MCP Tool Bridge

`src/copilot/bridges/mcp-tool-bridge.js` (432L):
- `buildMcpTools()` — lista tools de servidores MCP configurados
- `getMcpStatus()` / `listMcpTools()` — introspecção
- Auto-reconnect com backoff
- Usado por `tools-bootstrap.js` para injetar tools MCP na sessão SDK

### 9.3 Git Bridge

`src/copilot/bridges/git-bridge.js` (428L) + `gh/` (4 arquivos, ~633L):
- Operações Git completas (status, diff, commit, push, branch, stash)
- Integração GitHub via `gh` CLI (issues, PRs, CI, workflows)
- Usado pelas `gitTools` registradas via `tools-bootstrap.js`

### 9.4 Gaps de Bridges

| ID         | Impacto | Descrição                                                                                                            |
| ---------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| BRG-GAP-01 | MÉDIO   | NERV bridge não mapeia novos eventos do SDK 0.2.1 (elicitation.requested/completed, etc. — parcialmente adicionados) |
| BRG-GAP-02 | BAIXO   | MCP bridge não expõe `MCPServerConfig` completo do SDK (sem `oauthOptions`, sem `environmentVariables`)              |

---

## 10. Integração Channel ↔ SDK

### 10.1 Canal LLM-A ↔ LLM-B

`src/copilot/channel/` (7 arquivos, ~1.497L):
- **HTTP injection mode** (`inject.js`): envia mensagens ao terminal server LLM-B via `POST /inject`
- **SDK client mode** (`client.js`): `LlmBridgeClient` que usa o `AlwaysAliveAgent` em-processo
- `clientName` field do SDK usado indiretamente (via agent identity)
- Attachments suportados via `MessageOptions['attachments']` do SDK

### 10.2 Conversation Hub

`src/copilot/conversation-hub/` (10 arquivos, ~2.487L):
- Orchestrator com call strategies (multi-model)
- Store persistente (SQLite) com memories, queries, sync
- Socket.io namespace para streaming real-time

**Integração com SDK**: O hub usa o agent como backend, que por sua vez usa o SDK. A integração é indireta.

---

## 11. Resumo Quantitativo Revisado (com integração)

| Métrica                        | Valor Original | Valor Revisado                           |
| ------------------------------ | -------------- | ---------------------------------------- |
| Features SDK oficiais mapeadas | 62             | 62                                       |
| ✅ Totalmente implementadas     | 35 (56%)       | 44 (71%) ← 9 features "bypass"           |
| ⚠️ Parcialmente implementadas   | 9 (15%)        | 9 (15%)                                  |
| ❌ Não implementadas (GAPs)     | 18 (29%)       | 9 (14%)                                  |
| Bugs confirmados               | 5              | 5                                        |
| Design gaps estruturais        | 14             | 14 (+ 4 observability + 2 bridges)       |
| Archetype problems             | 0              | 3 (bypass, duplicação, tipagem dispersa) |

### Gaps REAIS remanescentes (não bypass)

| ID     | Severidade | Feature                                                                 |
| ------ | ---------- | ----------------------------------------------------------------------- |
| GAP-01 | CRÍTICO    | Provider/BYOK — sem suporte nativo                                      |
| GAP-02 | ALTO       | `client.on()` lifecycle events — não wrappado                           |
| GAP-03 | ALTO       | `session.log()` — não implementado                                      |
| GAP-05 | ALTO       | `session.capabilities` / `session.ui` (0.2.1)                           |
| GAP-06 | MÉDIO      | `commands` (slash commands) — não implementado                          |
| GAP-07 | MÉDIO      | `client.getLastSessionId()` — não exposto                               |
| GAP-08 | MÉDIO      | `sessionId` / `clientName` / `configDir` — não centralizados no wrapper |
| GAP-11 | MÉDIO      | `onEvent` (early handler) — não passado pelo wrapper                    |
| GAP-14 | BAIXO      | SDK 0.2.0 → 0.2.1 upgrade pendente                                      |

### Problemas Arquiteturais Identificados

| ID          | Impacto   | Descrição                                                                                                                  |
| ----------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| ARCH-INT-01 | **ALTO**  | Agent bypassando SDK wrapper — features configuradas diretamente no initializer.js ao invés de usar buildSessionConfig     |
| ARCH-INT-02 | **ALTO**  | Duplicação de lógica de tools filtering (tools-state.js + passagem direta de availableTools/excludedTools)                 |
| ARCH-INT-03 | **MÉDIO** | Tipagem dispersa — tipos como PermissionHandler, Tool, SessionConfig importados em ~20 arquivos com padrões inconsistentes |
| ARCH-INT-04 | **MÉDIO** | Observability event catalog (55 types) não validado contra SDK event emissions reais                                       |
| ARCH-INT-05 | **BAIXO** | OTEL TelemetryConfig não usa tipos oficiais do SDK                                                                         |
