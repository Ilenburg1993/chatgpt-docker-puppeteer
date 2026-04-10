# PARTE-17B — Proposta Arquitetural: Situação Ideal do SDK Wrapper

**Data**: 2026-03-20 (rev.4 — cobertura completa da API Surface do SDK)
**Escopo**: Redesign completo de `src/copilot/sdk/` + impactos em 14 módulos
**Base**: PARTE-17A rev.4 — inventário de 90+ tipos, 17 subsistemas RPC, 70+ events
**Autor**: Auditoria automatizada PARTE-17

---

## Sumário Executivo

A rev.4 expande drasticamente a proposta da rev.3 para cobrir **100% da API Surface do SDK**.
A rev.3 propunha 5 novos módulos e ~35 arquivos afetados. A rev.4 propõe **18+ novos módulos**,
expansão do sdk/ de ~3.252 para ~6.000 linhas, e ~60 arquivos afetados.

**Princípios arquiteturais (expandidos)**:
1. **Zero bypass** — toda interação com `@github/copilot-sdk` passa por `#copilot/sdk`
2. **Type completeness** — 100% dos tipos SDK re-exportados com JSDocg
3. **RPC facade** — todos os 17 subsistemas com wrappers ergonômicos
4. **Event type safety** — 70+ event types com typed handlers
5. **Feature expansion** — features ausentes do SDK expostas e integradas
6. **Future-proof** — features experimentais com flag para ativação gradual

---

## §1. Arquitetura Alvo — Visão Geral

### 1.1 Diagrama de Camadas

```
┌─────────────────────────────────────────────────────────────────┐
│                        CONSUMERS                                 │
│  agent/ · hooks/ · tools/ · api/ · bridges/ · channel/ · obs/   │
│  terminal/ · conversation-hub/ · audit/ · config/ · core/        │
└───────────────────────────┬─────────────────────────────────────┘
                            │ ONLY via #copilot/sdk aliases
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     sdk/ (FACADE LAYER)                          │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐       │
│  │ client   │ │ session  │ │ tools    │ │ permissions  │       │
│  │ .js      │ │ .js      │ │ .js      │ │ .js          │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐       │
│  │ rpc      │ │ events   │ │ models   │ │ config       │       │
│  │ .js      │ │ .js      │ │ .js      │ │ .js          │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐       │
│  │ system-  │ │ telemetry│ │ provider │ │ agents       │       │
│  │ message  │ │ .js      │ │ .js      │ │ .js          │       │
│  │ .js      │ └──────────┘ └──────────┘ └──────────────┘       │
│  └──────────┘                                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │ types    │ │ constants│ │ session-     │ │ health       │   │
│  │ .js      │ │ .js      │ │ lifecycle.js │ │ .js          │   │
│  └──────────┘ └──────────┘ └──────────────┘ └──────────────┘   │
│  ┌──────────────────────────┐                                    │
│  │ index.js (barrel export) │                                    │
│  └──────────────────────────┘                                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ ONLY sdk/* touches this
                            ▼
                ┌───────────────────────┐
                │  @github/copilot-sdk  │
                └───────────────────────┘
```

### 1.2 Módulos do sdk/ — Inventário Completo

| Módulo                 | Status  | Responsabilidade                                                   | Linhas est. |
| ---------------------- | ------- | ------------------------------------------------------------------ | ----------: |
| `index.js`             | REWRITE | Barrel export — re-exporta TUDO de sdk/                            |        ~120 |
| `client.js`            | REWRITE | Wrapper CopilotClient (15 métodos + server RPC + lifecycle events) |        ~450 |
| `session.js`           | REWRITE | Wrapper CopilotSession (12 métodos + typed event access)           |        ~400 |
| `tools.js`             | NEW     | `wrapTool()`, `defineSdkTool()` — substitui `defineTool` direto    |        ~180 |
| `permissions.js`       | NEW     | `createPermissionHandler()`, re-export `approveAll`                |        ~100 |
| `rpc.js`               | NEW     | Facade para todos os 17 subsistemas session RPC + 4 server RPC     |        ~600 |
| `events.js`            | NEW     | Event type map, typed `on()` helpers, payload extractors           |        ~500 |
| `models.js`            | REWRITE | `listModels()`, `ModelInfo` helpers, model capabilities utilities  |        ~200 |
| `agents.js`            | REWRITE | Custom agents config + runtime agent selection via RPC             |        ~180 |
| `config.js`            | NEW     | Unified `SessionConfig` builder (merge de 3 paths atuais)          |        ~350 |
| `system-message.js`    | NEW     | Builder para os 3 modos (append/replace/customize) + section utils |        ~280 |
| `telemetry.js`         | NEW     | `getTraceContext()` wrapper, `TelemetryConfig` builder             |        ~100 |
| `provider.js`          | NEW     | `ProviderConfig` builder/validator para BYOK                       |        ~150 |
| `session-lifecycle.js` | NEW     | Client lifecycle events typed + handler registration               |        ~120 |
| `health.js`            | NEW     | `ping()`, `getStatus()`, `getAuthStatus()`, `checkQuota()`         |        ~200 |
| `types.js`             | NEW     | Re-export e documentação de TODOS os 90+ tipos SDK                 |        ~600 |
| `constants.js`         | NEW     | Event type strings, section names, mode values, etc.               |        ~180 |
| `utils.js`             | EXIST   | Funções utilitárias (mantida)                                      |        ~100 |
| `tools-registry.js`    | DEPREC  | Migrar para `tools.js` — manter como re-export temporário          |         ~30 |
| **TOTAL**              |         |                                                                    |  **~4.840** |

*Nota: Inclui os ~3.252 existentes refatorados + ~1.600 new code. Total sdk/ estimado: ~5.500-6.000 linhas.*

---

## §2. Módulos Novos — Design Detalhado

### 2.1 `sdk/tools.js` — Tool Definition Facade

**Objetivo**: Substituir 11 imports diretos de `defineTool` e centralizar criação de tools.

```javascript
// sdk/tools.js — API Surface proposta
import { defineTool } from '@github/copilot-sdk';

/**
 * Cria uma tool SDK com metadata padrão do projeto.
 * @param {import('./types.js').ToolDefinitionOptions} options
 * @returns {import('@github/copilot-sdk').Tool}
 */
export function createTool(options) {
    const { name, description, schema, handler, ...rest } = options;
    return defineTool({
        name,
        description,
        schema,
        handler,
        ...rest
    });
}

/** Re-export para backward compatibility */
export { defineTool } from '@github/copilot-sdk';
```

**Consumers impactados**: 11 arquivos em `tools/` + 1 em `bridges/`.

### 2.2 `sdk/permissions.js` — Permission Handler Facade

**Objetivo**: Centralizar `approveAll` e oferecer permission handler compositions.

```javascript
// sdk/permissions.js — API Surface proposta
import { approveAll } from '@github/copilot-sdk';

/** @type {import('@github/copilot-sdk').PermissionHandler} */
export { approveAll };

/**
 * Cria permission handler com logging.
 * @param {object} options
 * @param {boolean} [options.autoApprove=true]
 * @param {Function} [options.onRequest]
 * @returns {import('@github/copilot-sdk').PermissionHandler}
 */
export function createPermissionHandler(options = {}) { /* ... */ }

/**
 * Cria permission handler com whitelist de tool names.
 * @param {string[]} allowedTools
 * @returns {import('@github/copilot-sdk').PermissionHandler}
 */
export function createAllowlistPermissionHandler(allowedTools) { /* ... */ }
```

**Consumers impactados**: 5 arquivos.

### 2.3 `sdk/rpc.js` — RPC Facade (NOVO rev.4 — feature central)

**Objetivo**: Expor TODOS os 17 subsistemas session RPC + 4 server RPC com wrappers ergonômicos,
error handling, e logging.

```javascript
// sdk/rpc.js — API Surface proposta

/**
 * Cria facade tipada para session RPC.
 * @param {import('@github/copilot-sdk').CopilotSession} session
 * @returns {SessionRpcFacade}
 */
export function createSessionRpc(session) {
    return {
        model: {
            getCurrent: () => session.rpc.model.getCurrent(),
            switchTo: (modelId, reasoningEffort) =>
                session.rpc.model.switchTo({ modelId, reasoningEffort }),
        },
        mode: {
            get: () => session.rpc.mode.get(),
            set: (mode) => session.rpc.mode.set({ mode }),
        },
        plan: {
            read: () => session.rpc.plan.read(),
            update: (content) => session.rpc.plan.update({ content }),
            delete: () => session.rpc.plan.delete(),
        },
        workspace: {
            listFiles: () => session.rpc.workspace.listFiles(),
            readFile: (path) => session.rpc.workspace.readFile({ path }),
            createFile: (path, content) =>
                session.rpc.workspace.createFile({ path, content }),
        },
        compaction: {
            compact: () => session.rpc.compaction.compact(),
        },
        shell: {
            exec: (command, options) =>
                session.rpc.shell.exec({ command, ...options }),
            kill: (processId, signal) =>
                session.rpc.shell.kill({ processId, signal }),
        },
        ui: {
            elicitation: (message, schema) =>
                session.rpc.ui.elicitation({ message, requestedSchema: schema }),
        },
        log: (message, options) =>
            session.rpc.log({ message, ...options }),
        // Experimental (gated por feature flag)
        fleet: { start: (prompt) => session.rpc.fleet.start({ prompt }) },
        agent: { /* list, getCurrent, select, deselect, reload */ },
        skills: { /* list, enable, disable, reload */ },
        mcp: { /* list, enable, disable, reload */ },
        plugins: { list: () => session.rpc.plugins.list() },
        extensions: { /* list, enable, disable, reload */ },
    };
}

/**
 * Cria facade tipada para server RPC.
 * @param {import('@github/copilot-sdk').CopilotClient} client
 * @returns {ServerRpcFacade}
 */
export function createServerRpc(client) {
    return {
        ping: (message) => client.rpc.ping({ message }),
        models: { list: () => client.rpc.models.list() },
        tools: { list: (model) => client.rpc.tools.list({ model }) },
        account: { getQuota: () => client.rpc.account.getQuota() },
    };
}
```

**Consumers impactados**: `session-rpc-tools.js`, `agent/`, `api/`, `observability/`.

### 2.4 `sdk/events.js` — Event Type Safety (NOVO rev.4)

**Objetivo**: Tipar os 70+ event types com typed handlers e utilitários.

```javascript
// sdk/events.js — API Surface proposta

/**
 * Constantes de event types (evita magic strings).
 * @type {Record<string, string>}
 */
export const SESSION_EVENTS = {
    SESSION_START: 'session.start',
    SESSION_IDLE: 'session.idle',
    SESSION_ERROR: 'session.error',
    ASSISTANT_TURN_START: 'assistant.turn_start',
    ASSISTANT_MESSAGE: 'assistant.message',
    ASSISTANT_TURN_END: 'assistant.turn_end',
    TOOL_EXECUTION_START: 'tool.execution_start',
    TOOL_EXECUTION_COMPLETE: 'tool.execution_complete',
    // ... todos os 70+ types
};

/**
 * Registra handler tipado para um evento específico.
 * @template {keyof typeof SESSION_EVENTS} K
 * @param {import('@github/copilot-sdk').CopilotSession} session
 * @param {K} eventType
 * @param {TypedSessionEventHandler<K>} handler
 * @returns {void}
 */
export function onSessionEvent(session, eventType, handler) {
    session.on(eventType, handler);
}

/**
 * Registra handlers para múltiplos eventos.
 * @param {import('@github/copilot-sdk').CopilotSession} session
 * @param {Record<string, Function>} handlers
 * @returns {void}
 */
export function onSessionEvents(session, handlers) {
    for (const [type, handler] of Object.entries(handlers)) {
        session.on(type, handler);
    }
}

/**
 * Extraí payload tipado de um event.
 * @template T
 * @param {SessionEvent} event
 * @returns {T}
 */
export function getEventPayload(event) {
    return event.data;
}
```

### 2.5 `sdk/config.js` — Unified SessionConfig Builder (NOVO rev.4)

**Objetivo**: Merge dos 3 config paths atuais (P1) em um ÚNICO builder.

```javascript
// sdk/config.js — API Surface proposta

/**
 * @typedef {object} SessionConfigInput
 * @property {string} [model]
 * @property {import('./types.js').ReasoningEffort} [reasoningEffort]
 * @property {import('./types.js').SystemMessageConfig} [systemMessage]
 * @property {import('./types.js').Tool[]} [tools]
 * @property {import('./types.js').PermissionHandler} [onPermissionRequest]
 * @property {import('./types.js').UserInputHandler} [onUserInputRequest]
 * @property {import('./types.js').SessionHooks} [hooks]
 * @property {string} [workingDirectory]
 * @property {boolean} [streaming]
 * @property {Record<string, import('./types.js').MCPServerConfig>} [mcpServers]
 * @property {import('./types.js').CustomAgentConfig[]} [customAgents]
 * @property {string} [agent]
 * @property {string[]} [skillDirectories]
 * @property {string[]} [disabledSkills]
 * @property {string[]} [availableTools]
 * @property {string[]} [excludedTools]
 * @property {import('./types.js').InfiniteSessionConfig} [infiniteSessions]
 * @property {import('./types.js').ProviderConfig} [provider]
 * @property {string} [clientName]
 * @property {string} [configDir]
 * @property {string} [sessionId]
 * @property {import('./types.js').SessionEventHandler} [onEvent]
 */

/**
 * Constrói SessionConfig completa a partir de input parcial + defaults.
 * Substitui buildSessionConfig() atual e inline config da API.
 * @param {Partial<SessionConfigInput>} input
 * @param {object} [defaults] - Defaults centralizados do projeto
 * @returns {import('@github/copilot-sdk').SessionConfig}
 */
export function buildSessionConfig(input, defaults = getProjectDefaults()) {
    return {
        ...defaults,
        ...input,
        // Ensure required fields
        onPermissionRequest: input.onPermissionRequest ?? defaults.onPermissionRequest,
    };
}

/**
 * Defaults canônicos do projeto.
 * @returns {Partial<SessionConfigInput>}
 */
export function getProjectDefaults() { /* ... */ }
```

### 2.6 `sdk/system-message.js` — System Message Builder (NOVO rev.4)

**Objetivo**: Builder para os 3 modos do system message, especialmente o modo `customize`.

```javascript
// sdk/system-message.js — API Surface proposta
import { SYSTEM_PROMPT_SECTIONS } from '@github/copilot-sdk';

/** Re-export */
export { SYSTEM_PROMPT_SECTIONS };

/**
 * Seções do system prompt.
 * @type {readonly string[]}
 */
export const SECTION_NAMES = Object.keys(SYSTEM_PROMPT_SECTIONS);

/**
 * Cria system message em modo append (padrão).
 * @param {string} content - Conteúdo a adicionar ao final
 * @returns {import('./types.js').SystemMessageAppendConfig}
 */
export function appendSystemMessage(content) {
    return { type: 'append', content };
}

/**
 * Cria system message em modo replace (cuidado: remove guardrails).
 * @param {string} content - Conteúdo substituto completo
 * @returns {import('./types.js').SystemMessageReplaceConfig}
 */
export function replaceSystemMessage(content) {
    return { type: 'replace', content };
}

/**
 * Cria system message em modo customize (mais seguro e poderoso).
 * Permite override por seção individual.
 * @param {import('./types.js').SectionOverride[]} overrides
 * @returns {import('./types.js').SystemMessageCustomizeConfig}
 */
export function customizeSystemMessage(overrides) {
    return { type: 'customize', overrides };
}

/**
 * Helper para criar um section override.
 * @param {string} section - Nome da seção (identity, tone, guidelines, etc.)
 * @param {import('./types.js').SectionOverrideAction} action
 * @param {string} [content]
 * @param {import('./types.js').SectionTransformFn} [transform]
 * @returns {import('./types.js').SectionOverride}
 */
export function sectionOverride(section, action, content, transform) {
    return { section, action, content, transform };
}
```

### 2.7 `sdk/health.js` — Health Check Facade (NOVO rev.4)

**Objetivo**: Verificação de saúde do CLI server, autenticação, e quota.

```javascript
// sdk/health.js — API Surface proposta

/**
 * Verifica conectividade com CLI server.
 * @param {import('@github/copilot-sdk').CopilotClient} client
 * @returns {Promise<{ok: boolean, latencyMs: number}>}
 */
export async function ping(client) {
    const start = Date.now();
    try {
        await client.ping();
        return { ok: true, latencyMs: Date.now() - start };
    } catch {
        return { ok: false, latencyMs: Date.now() - start };
    }
}

/**
 * Verifica status do CLI server (versão, protocolo).
 * @param {import('@github/copilot-sdk').CopilotClient} client
 * @returns {Promise<import('./types.js').GetStatusResponse>}
 */
export async function getServerStatus(client) {
    return client.getStatus();
}

/**
 * Verifica autenticação GitHub Copilot.
 * @param {import('@github/copilot-sdk').CopilotClient} client
 * @returns {Promise<import('./types.js').GetAuthStatusResponse>}
 */
export async function getAuthStatus(client) {
    return client.getAuthStatus();
}

/**
 * Verifica quota da conta Copilot.
 * @param {import('@github/copilot-sdk').CopilotClient} client
 * @returns {Promise<import('./types.js').AccountGetQuotaResult>}
 */
export async function getQuota(client) {
    return client.rpc.account.getQuota();
}

/**
 * Health check completo: ping + auth + quota.
 * @param {import('@github/copilot-sdk').CopilotClient} client
 * @returns {Promise<HealthCheckResult>}
 */
export async function fullHealthCheck(client) { /* ... */ }
```

### 2.8 `sdk/provider.js` — BYOK Provider Config (NOVO rev.4)

**Objetivo**: Builder e validator para `ProviderConfig` (OpenAI, Azure, Anthropic).

```javascript
// sdk/provider.js — API Surface proposta

/**
 * Cria ProviderConfig para OpenAI.
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} [options.baseUrl]
 * @returns {import('./types.js').ProviderConfig}
 */
export function openaiProvider({ apiKey, baseUrl }) {
    return { type: 'openai', apiKey, baseUrl };
}

/**
 * Cria ProviderConfig para Azure OpenAI.
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.baseUrl
 * @param {string} [options.apiVersion]
 * @param {string} [options.deployment]
 * @returns {import('./types.js').ProviderConfig}
 */
export function azureProvider(options) {
    return { type: 'azure', ...options };
}

/**
 * Cria ProviderConfig para Anthropic.
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} [options.baseUrl]
 * @returns {import('./types.js').ProviderConfig}
 */
export function anthropicProvider({ apiKey, baseUrl }) {
    return { type: 'anthropic', apiKey, baseUrl };
}
```

### 2.9 `sdk/telemetry.js` — Telemetry Facade (NOVO rev.4)

```javascript
// sdk/telemetry.js
import { getTraceContext } from '@github/copilot-sdk';

export { getTraceContext };

/**
 * Cria TelemetryConfig para o projeto.
 * @param {Partial<import('./types.js').TelemetryConfig>} [overrides]
 * @returns {import('./types.js').TelemetryConfig}
 */
export function createTelemetryConfig(overrides = {}) {
    return {
        sourceName: 'chatgpt-docker-puppeteer',
        exporterType: 'otlp',
        ...overrides,
    };
}
```

### 2.10 `sdk/session-lifecycle.js` — Client Lifecycle Events (NOVO rev.4)

```javascript
// sdk/session-lifecycle.js

/**
 * Lifecycle event types.
 * @type {Record<string, import('./types.js').SessionLifecycleEventType>}
 */
export const LIFECYCLE_EVENTS = {
    CREATED: 'session.created',
    DELETED: 'session.deleted',
    UPDATED: 'session.updated',
    FOREGROUND: 'session.foreground',
    BACKGROUND: 'session.background',
};

/**
 * Registra handler tipado para lifecycle events no client.
 * @param {import('@github/copilot-sdk').CopilotClient} client
 * @param {import('./types.js').SessionLifecycleEventType} eventType
 * @param {import('./types.js').SessionLifecycleHandler} handler
 */
export function onLifecycleEvent(client, eventType, handler) {
    client.on(eventType, handler);
}
```

### 2.11 `sdk/types.js` — Type Re-exports Completos (NOVO rev.4)

**Objetivo**: TODOS os 90+ tipos do SDK re-exportados com JSDoc aprimorado.

```javascript
// sdk/types.js — Re-export de TODOS os tipos SDK

/**
 * @typedef {import('@github/copilot-sdk').CopilotClientOptions} CopilotClientOptions
 * @typedef {import('@github/copilot-sdk').SessionConfig} SessionConfig
 * @typedef {import('@github/copilot-sdk').ResumeSessionConfig} ResumeSessionConfig
 * @typedef {import('@github/copilot-sdk').MessageOptions} MessageOptions
 * @typedef {import('@github/copilot-sdk').ConnectionState} ConnectionState
 * @typedef {import('@github/copilot-sdk').ReasoningEffort} ReasoningEffort
 *
 * @typedef {import('@github/copilot-sdk').Tool} Tool
 * @typedef {import('@github/copilot-sdk').ToolHandler} ToolHandler
 * @typedef {import('@github/copilot-sdk').ToolInvocation} ToolInvocation
 * @typedef {import('@github/copilot-sdk').ToolResult} ToolResult
 * @typedef {import('@github/copilot-sdk').ToolResultType} ToolResultType
 * @typedef {import('@github/copilot-sdk').ToolResultObject} ToolResultObject
 * @typedef {import('@github/copilot-sdk').ToolBinaryResult} ToolBinaryResult
 *
 * @typedef {import('@github/copilot-sdk').PermissionHandler} PermissionHandler
 * @typedef {import('@github/copilot-sdk').PermissionRequest} PermissionRequest
 * @typedef {import('@github/copilot-sdk').PermissionRequestResult} PermissionRequestResult
 *
 * @typedef {import('@github/copilot-sdk').UserInputHandler} UserInputHandler
 * @typedef {import('@github/copilot-sdk').UserInputRequest} UserInputRequest
 * @typedef {import('@github/copilot-sdk').UserInputResponse} UserInputResponse
 *
 * @typedef {import('@github/copilot-sdk').SystemMessageConfig} SystemMessageConfig
 * @typedef {import('@github/copilot-sdk').SystemMessageAppendConfig} SystemMessageAppendConfig
 * @typedef {import('@github/copilot-sdk').SystemMessageReplaceConfig} SystemMessageReplaceConfig
 * @typedef {import('@github/copilot-sdk').SystemMessageCustomizeConfig} SystemMessageCustomizeConfig
 * @typedef {import('@github/copilot-sdk').SectionOverride} SectionOverride
 * @typedef {import('@github/copilot-sdk').SectionOverrideAction} SectionOverrideAction
 * @typedef {import('@github/copilot-sdk').SectionTransformFn} SectionTransformFn
 *
 * @typedef {import('@github/copilot-sdk').SessionHooks} SessionHooks
 * @typedef {import('@github/copilot-sdk').PreToolUseHandler} PreToolUseHandler
 * @typedef {import('@github/copilot-sdk').PreToolUseHookInput} PreToolUseHookInput
 * @typedef {import('@github/copilot-sdk').PreToolUseHookOutput} PreToolUseHookOutput
 * @typedef {import('@github/copilot-sdk').PostToolUseHandler} PostToolUseHandler
 * @typedef {import('@github/copilot-sdk').PostToolUseHookInput} PostToolUseHookInput
 * @typedef {import('@github/copilot-sdk').PostToolUseHookOutput} PostToolUseHookOutput
 * @typedef {import('@github/copilot-sdk').UserPromptSubmittedHandler} UserPromptSubmittedHandler
 * @typedef {import('@github/copilot-sdk').UserPromptSubmittedHookInput} UserPromptSubmittedHookInput
 * @typedef {import('@github/copilot-sdk').UserPromptSubmittedHookOutput} UserPromptSubmittedHookOutput
 * @typedef {import('@github/copilot-sdk').SessionStartHandler} SessionStartHandler
 * @typedef {import('@github/copilot-sdk').SessionStartHookInput} SessionStartHookInput
 * @typedef {import('@github/copilot-sdk').SessionStartHookOutput} SessionStartHookOutput
 * @typedef {import('@github/copilot-sdk').SessionEndHandler} SessionEndHandler
 * @typedef {import('@github/copilot-sdk').SessionEndHookInput} SessionEndHookInput
 * @typedef {import('@github/copilot-sdk').SessionEndHookOutput} SessionEndHookOutput
 * @typedef {import('@github/copilot-sdk').ErrorOccurredHandler} ErrorOccurredHandler
 * @typedef {import('@github/copilot-sdk').ErrorOccurredHookInput} ErrorOccurredHookInput
 * @typedef {import('@github/copilot-sdk').ErrorOccurredHookOutput} ErrorOccurredHookOutput
 *
 * @typedef {import('@github/copilot-sdk').ModelInfo} ModelInfo
 * @typedef {import('@github/copilot-sdk').ModelCapabilities} ModelCapabilities
 * @typedef {import('@github/copilot-sdk').ModelPolicy} ModelPolicy
 * @typedef {import('@github/copilot-sdk').ModelBilling} ModelBilling
 *
 * @typedef {import('@github/copilot-sdk').MCPServerConfig} MCPServerConfig
 * @typedef {import('@github/copilot-sdk').MCPLocalServerConfig} MCPLocalServerConfig
 * @typedef {import('@github/copilot-sdk').MCPRemoteServerConfig} MCPRemoteServerConfig
 *
 * @typedef {import('@github/copilot-sdk').CustomAgentConfig} CustomAgentConfig
 * @typedef {import('@github/copilot-sdk').InfiniteSessionConfig} InfiniteSessionConfig
 * @typedef {import('@github/copilot-sdk').ProviderConfig} ProviderConfig
 *
 * @typedef {import('@github/copilot-sdk').SessionContext} SessionContext
 * @typedef {import('@github/copilot-sdk').SessionMetadata} SessionMetadata
 * @typedef {import('@github/copilot-sdk').SessionListFilter} SessionListFilter
 * @typedef {import('@github/copilot-sdk').ForegroundSessionInfo} ForegroundSessionInfo
 *
 * @typedef {import('@github/copilot-sdk').TelemetryConfig} TelemetryConfig
 * @typedef {import('@github/copilot-sdk').TraceContext} TraceContext
 * @typedef {import('@github/copilot-sdk').TraceContextProvider} TraceContextProvider
 *
 * @typedef {import('@github/copilot-sdk').GetStatusResponse} GetStatusResponse
 * @typedef {import('@github/copilot-sdk').GetAuthStatusResponse} GetAuthStatusResponse
 *
 * @typedef {import('@github/copilot-sdk').SessionEvent} SessionEvent
 * @typedef {import('@github/copilot-sdk').SessionEventType} SessionEventType
 * @typedef {import('@github/copilot-sdk').SessionEventHandler} SessionEventHandler
 * @typedef {import('@github/copilot-sdk').AssistantMessageEvent} AssistantMessageEvent
 * @typedef {import('@github/copilot-sdk').SessionLifecycleEventType} SessionLifecycleEventType
 * @typedef {import('@github/copilot-sdk').SessionLifecycleEvent} SessionLifecycleEvent
 */

export {};
```

### 2.12 `sdk/constants.js` — Constantes Centralizadas (NOVO rev.4)

```javascript
// sdk/constants.js

/** Session modes */
export const SESSION_MODES = /** @type {const} */ ({
    INTERACTIVE: 'interactive',
    PLAN: 'plan',
    AUTOPILOT: 'autopilot',
});

/** Reasoning effort levels */
export const REASONING_EFFORTS = /** @type {const} */ ({
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    XHIGH: 'xhigh',
});

/** Connection states */
export const CONNECTION_STATES = /** @type {const} */ ({
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    ERROR: 'error',
});

/** Section override actions */
export const SECTION_ACTIONS = /** @type {const} */ ({
    PREPEND: 'prepend',
    APPEND: 'append',
    REPLACE: 'replace',
    REMOVE: 'remove',
    WRAP: 'wrap',
});

/** Permission request result kinds */
export const PERMISSION_RESULTS = /** @type {const} */ ({
    ALLOW: 'allow',
    DENY: 'deny',
    ALLOW_ALWAYS: 'allowAlways',
    DENY_ALWAYS: 'denyAlways',
    DISMISS: 'dismiss',
});

/** Provider types */
export const PROVIDER_TYPES = /** @type {const} */ ({
    OPENAI: 'openai',
    AZURE: 'azure',
    ANTHROPIC: 'anthropic',
});

/** Default infinite session thresholds */
export const INFINITE_SESSION_DEFAULTS = /** @type {const} */ ({
    BACKGROUND_COMPACTION_THRESHOLD: 0.80,
    BUFFER_EXHAUSTION_THRESHOLD: 0.95,
});
```

---

## §3. Refactoring de Módulos Existentes

### 3.1 `sdk/client.js` — Expansão para 15 Métodos

**Adicionar ao wrapper:**

| Método                               | Ação                  |
| ------------------------------------ | --------------------- |
| `ping(message?)`                     | Nova função wrapper   |
| `getStatus()`                        | Nova função wrapper   |
| `getAuthStatus()`                    | Nova função wrapper   |
| `getLastSessionId()`                 | Nova função wrapper   |
| `deleteSession(id)`                  | Nova função wrapper   |
| `getForegroundSessionId()`           | Nova função wrapper   |
| `setForegroundSessionId(id)`         | Nova função wrapper   |
| `on(eventType, handler)`             | Nova função wrapper   |
| `rpc` (getter → `createServerRpc()`) | Delegar para `rpc.js` |

**Merge do Map de sessões**: Consolidar o `Map` interno com `session.js` (resolver P2).

### 3.2 `sdk/session.js` — Expansão para 12 Métodos

**Adicionar ao wrapper:**

| Método                                | Ação                     |
| ------------------------------------- | ------------------------ |
| `abort()`                             | Nova função wrapper      |
| `setModel(model, options?)`           | Nova função wrapper      |
| `getMessages()`                       | Nova função wrapper      |
| `workspacePath` (getter)              | Expor via wrapper        |
| `rpc` (getter → `createSessionRpc()`) | Delegar para `rpc.js`    |
| `[Symbol.asyncDispose]()`             | Expor para `await using` |

**Merge do registro**: `createSession()` e `resumeSession()` devem atualizar o `Map` do client
(resolver P2).

### 3.3 `sdk/models.js` — Expansão

**Adicionar:**
- Helpers para `ModelCapabilities` (hasVision, hasReasoningEffort, getMaxTokens)
- `getModelById()` — busca em cache
- `getSupportedReasoningEfforts(modelId)` — filtra por capacidade

### 3.4 `sdk/agents.js` — Expansão com RPC

**Adicionar:**
- `listAgents(session)` → `session.rpc.agent.list()`
- `selectAgent(session, name)` → `session.rpc.agent.select()`
- `deselectAgent(session)` → `session.rpc.agent.deselect()`
- `reloadAgents(session)` → `session.rpc.agent.reload()`

### 3.5 `sdk/index.js` — Barrel Completo

```javascript
// sdk/index.js — Barrel export de TODAS as facets do SDK

// Classes/instances
export { getClient, stopClient, forceStopClient } from './client.js';
export { createSession, resumeSession, getSession } from './session.js';

// Tools
export { createTool, defineTool } from './tools.js';

// Permissions
export { approveAll, createPermissionHandler } from './permissions.js';

// Config
export { buildSessionConfig, getProjectDefaults } from './config.js';

// System Message
export {
    SYSTEM_PROMPT_SECTIONS, SECTION_NAMES,
    appendSystemMessage, replaceSystemMessage, customizeSystemMessage,
    sectionOverride,
} from './system-message.js';

// RPC
export { createSessionRpc, createServerRpc } from './rpc.js';

// Events
export { SESSION_EVENTS, onSessionEvent, onSessionEvents } from './events.js';

// Models
export { listModels, getModelById } from './models.js';

// Agents
export { listAgents, selectAgent, deselectAgent } from './agents.js';

// Health
export { ping, getServerStatus, getAuthStatus, getQuota, fullHealthCheck } from './health.js';

// Provider (BYOK)
export { openaiProvider, azureProvider, anthropicProvider } from './provider.js';

// Telemetry
export { getTraceContext, createTelemetryConfig } from './telemetry.js';

// Lifecycle
export { LIFECYCLE_EVENTS, onLifecycleEvent } from './session-lifecycle.js';

// Constants
export * from './constants.js';

// Types (JSDoc re-exports — import via sdk/types.js)
```

---

## §4. Migração de Importações (Plano Detalhado)

### 4.1 Fase 1 — `defineTool` (11 arquivos)

```
ANTES: import { defineTool } from '@github/copilot-sdk';
DEPOIS: import { createTool } from '#copilot/sdk';
```

OU (para backward compatibility durante transição):

```
ANTES: import { defineTool } from '@github/copilot-sdk';
DEPOIS: import { defineTool } from '#copilot/sdk';  // re-export
```

### 4.2 Fase 2 — `approveAll` (5 arquivos)

```
ANTES: import { approveAll } from '@github/copilot-sdk';
DEPOIS: import { approveAll } from '#copilot/sdk';
```

### 4.3 Fase 3 — `CopilotClient` (2 arquivos)

```
ANTES: import { CopilotClient } from '@github/copilot-sdk';
        const client = new CopilotClient(options);
DEPOIS: import { getClient } from '#copilot/sdk';
        const client = getClient(options);
```

### 4.4 Fase 4 — `SYSTEM_PROMPT_SECTIONS` (1 arquivo)

```
ANTES: import { SYSTEM_PROMPT_SECTIONS } from '@github/copilot-sdk';
DEPOIS: import { SYSTEM_PROMPT_SECTIONS } from '#copilot/sdk';
```

### 4.5 Fase 5 — API Routes (2 arquivos)

- `api/routes/sessions.js` → usar `buildSessionConfig()` do `sdk/config.js`
- `api/routes/sessions.js` → usar `openaiProvider()` etc. de `sdk/provider.js`

### 4.6 Fase 6 — Types e JSDoc (todos os arquivos)

- `core/sdk-types.js` → deprecar, apontar para `sdk/types.js`
- `hooks/types.js` → gradual: alinhar com SDK types, deprecar divergências

### 4.7 Enforcement ESLint

Regra `no-restricted-imports` para bloquear importações diretas:

```javascript
// eslint.config.mjs Addition
{
    rules: {
        'no-restricted-imports': ['error', {
            paths: [{
                name: '@github/copilot-sdk',
                message: 'Use #copilot/sdk instead.',
            }, {
                name: '@github/copilot-sdk/extension',
                message: 'Use #copilot/sdk instead.',
            }],
        }],
    },
    // Exceção: apenas sdk/*.js pode importar diretamente
    ignores: ['src/copilot/sdk/**'],
}
```

---

## §5. Unificação de Configuração (P1 → Resolvido)

### 5.1 Estado Atual (3 paths)

1. `config/session-config.js` → `buildSessionConfig()` — agent path
2. `sdk/session.js` (chamada interna) — SDK defaults
3. `api/routes/sessions.js` → inline config — API path

### 5.2 Estado Alvo (1 path)

Todos usam `sdk/config.js` → `buildSessionConfig()`:

```
Agent:  agent/lifecycle/initializer.js → sdk/config.js → sdk/session.js → SDK
API:    api/routes/sessions.js        → sdk/config.js → sdk/session.js → SDK
Hub:    conversation-hub/             → sdk/config.js → sdk/session.js → SDK
```

`config/session-config.js` é **deprecado** e se torna um re-export:
```javascript
// config/session-config.js (deprecated)
/** @deprecated Use import from '#copilot/sdk' */
export { buildSessionConfig } from '#copilot/sdk';
```

---

## §6. Unificação de Registros de Sessão (P2 → Resolvido)

### 6.1 Estado Atual

- `sdk/client.js` → `Map<string, CopilotSession>` (stateful singleton)
- `sdk/session.js` → funções sem state (stateless wrappers)

### 6.2 Estado Alvo

`sdk/client.js` mantém o Map como **Single Source of Truth**. `sdk/session.js` delega para
client.js para CRUD de sessões. Toda criação/resumo/acesso a sessão passa pelo Map.

```javascript
// sdk/session.js (refactored)
import { getClient } from './client.js';

export async function createSession(config) {
    const client = getClient();
    const session = await client.createSession(config);
    // Map é atualizado internamente pelo client.js
    return session;
}

export function getSession(sessionId) {
    const client = getClient();
    return client.sessions.get(sessionId);
}
```

---

## §7. Consolidação de Tipos (P4 + P10 → Resolvido)

### 7.1 Estado Atual

| Fonte               | Tipos definidos | Problema                                      |
| ------------------- | :-------------: | --------------------------------------------- |
| `hooks/types.js`    |       ~30       | Paralelos aos SDK types, divergem subtilmente |
| `core/sdk-types.js` |       ~27       | Duplicatas parciais de hooks/types.js         |
| SDK official types  |       90+       | Canônico, mas não re-exportado                |

### 7.2 Estado Alvo

```
sdk/types.js ← SSOT (re-exports de @github/copilot-sdk)
     ↑
hooks/types.js ← deprecar imports locais, alinhar com sdk/types.js
core/sdk-types.js ← deprecar, re-export de sdk/types.js
```

Hooks que adicionam campos extras (ex: project-specific metadata) mantêm tipos estendidos
via `@typedef` que `extends` os tipos SDK:

```javascript
/**
 * @typedef {import('#copilot/sdk').PreToolUseHookInput & {
 *   projectContext?: object;
 * }} ExtendedPreToolUseInput
 */
```

---

## §8. Impacto por Módulo Consumidor

| Módulo              | Mudanças                                                          | Arquivos |
| ------------------- | ----------------------------------------------------------------- | :------: |
| `agent/`            | getClient → sdk, lifecycle events, auth check, abort support      |    ~8    |
| `hooks/`            | Types → sdk/types.js, approveAll → sdk, permission compositions   |    ~5    |
| `tools/`            | defineTool → sdk/tools.js, session-rpc → sdk/rpc.js               |   ~13    |
| `api/`              | Config → sdk/config.js, provider → sdk/provider.js, sessions CRUD |    ~4    |
| `config/`           | session-config → deprecar, system-prompt → sdk/system-message.js  |    ~3    |
| `observability/`    | Events → sdk/events.js, quota monitoring via sdk/health.js        |    ~4    |
| `bridges/`          | defineTool → sdk/tools.js, nerv-bridge typed events               |    ~3    |
| `channel/`          | Client access → sdk/client.js                                     |    ~2    |
| `conversation-hub/` | Session config → sdk/config.js                                    |    ~2    |
| `core/`             | sdk-types → deprecar, events → sdk/events.js                      |    ~3    |
| `audit/`            | approveAll → sdk/permissions.js                                   |    ~1    |
| `terminal/`         | Session RPC → sdk/rpc.js                                          |    ~3    |
| **TOTAL**           |                                                                   | **~51**  |

---

## §9. Novas Features Integradas

### 9.1 Features P0 (integração imediata no boot/runtime)

| Feature              | Módulo SDK          | Consumers impactados        |
| -------------------- | ------------------- | --------------------------- |
| Auth verification    | `health.js`         | `agent/lifecycle/`, boot    |
| Quota monitoring     | `health.js`         | `observability/`, dashboard |
| Mode switching       | `rpc.js`            | `agent/`, `api/`, tools     |
| Model switching      | `session.js`        | `agent/`, `api/`            |
| Abort support        | `session.js`        | `agent/always-alive.js`     |
| Customize system msg | `system-message.js` | `config/system-prompt.js`   |

### 9.2 Features P1 (integração em faixas dedicadas)

| Feature             | Módulo SDK   | Consumers impactados     |
| ------------------- | ------------ | ------------------------ |
| Plan management     | `rpc.js`     | `agent/`, tools          |
| Workspace files     | `rpc.js`     | `agent/`, tools          |
| Agent selection     | `agents.js`  | `agent/`, `api/`         |
| Skills management   | `rpc.js`     | `agent/`, tools          |
| MCP management      | `rpc.js`     | `bridges/`, `agent/`     |
| Compaction control  | `rpc.js`     | `agent/infra/`           |
| Shell via RPC       | `rpc.js`     | `tools/shell-tools.js`   |
| UI elicitation      | `rpc.js`     | `tools/`, `agent/`       |
| Session messages    | `session.js` | `agent/`, `api/`         |
| Session deletion    | `client.js`  | `api/routes/sessions.js` |
| Health checks       | `health.js`  | `agent/infra/`           |
| Built-in tools list | `rpc.js`     | `tools/tool-factory.js`  |

### 9.3 Features P2 (experimental — com feature flag)

| Feature               | Módulo SDK     | Status SDK     |
| --------------------- | -------------- | -------------- |
| Fleet mode            | `rpc.js`       | EXPERIMENTAL   |
| Plugins listing       | `rpc.js`       | EXPERIMENTAL   |
| Extensions management | `rpc.js`       | EXPERIMENTAL   |
| joinSession()         | Não no wrapper | Extension-only |

---

## §10. Métricas Alvo

| Métrica                          | Antes (atual) | Depois (alvo) |
| -------------------------------- | :-----------: | :-----------: |
| Bypasses (imports diretos SDK)   |      20       |       0       |
| Cobertura tipos SDK              |     ~14%      |   **100%**    |
| Cobertura RPC subsistemas        |      ~6%      |   **100%**    |
| Cobertura CopilotClient métodos  |     ~47%      |   **100%**    |
| Cobertura CopilotSession métodos |     ~42%      |   **100%**    |
| Config paths para SessionConfig  |       3       |       1       |
| Session registries               |       2       |       1       |
| Hook type sources                |       3       |       1       |
| Features SDK integradas (P0+P1)  |     ~30%      |   **95%+**    |
| Event types tipados              |       0       |    **70+**    |

---

## §11. Riscos e Mitigações

| Risco                                           | Impacto | Mitigação                                                      |
| ----------------------------------------------- | :-----: | -------------------------------------------------------------- |
| Breaking changes em consumers durante migração  |  Alto   | Fases graduais + re-exports temporários de backward compat     |
| SDK 0.2.1→0.3.0 muda API durante implementação  |  Médio  | Pin versão 0.2.0, upgrade em faixa dedicada                    |
| RPC subsistemas experimentais mudam/removidos   |  Médio  | Feature flags + abstração (facade absorve mudanças)            |
| Complexidade do barrel export (index.js) cresce |  Baixo  | Tree-shaking garante que consumers importam só o que usam      |
| tools-registry.js deprecação quebra consumers   |  Médio  | Re-export temporário por 2 faixas                              |
| Performance: wrappers adicionam overhead        |  Baixo  | Wrappers são thin (delegam diretamente); sem serialização/copy |
| Types re-export: tsserver resolução mais lenta  |  Baixo  | Re-exports diretos sem transformação                           |

---

## §12. Resumo da Proposta

| Dimensão          | Rev.3                                            | Rev.4 (expandida)                                                                           |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Novos módulos     | 5 (tools, permissions, config, types, constants) | **18** (+ rpc, events, system-message, health, provider, telemetry, session-lifecycle, ...) |
| Módulos rewrite   | 3 (client, session, index)                       | **5** (+ models, agents)                                                                    |
| Arquivos afetados | ~35                                              | **~51**                                                                                     |
| Linhas sdk/ alvo  | ~4.000                                           | **~5.500-6.000**                                                                            |
| Problemas resolve | P1-P10                                           | **P1-P16** (P17-P18 parcial)                                                                |
| Features novas    | 0 (apenas migração)                              | **20+ features SDK integradas**                                                             |
| Testes estimados  | ~250                                             | **~500+**                                                                                   |
| Faixas roadmap    | 12                                               | **22+**                                                                                     |

---

*Documento gerado pela auditoria PARTE-17, rev.4. Proposta alinhada com a API Surface completa
do SDK (9 arquivos de declaração, 4.498 linhas). Revisões anteriores preservadas em .rev2.md
e .rev3.md.*
