// @ts-check
/**
 * src/copilot/sdk/types.js
 *
 * Re-exportação COMPLETA de todos os tipos do `@github/copilot-sdk`. Este módulo é o SSOT (Single Source of Truth) para
 * tipos SDK no projeto.
 *
 * Consumers devem importar tipos via `import('./types.js').NomeTipo` ou via `import('#copilot/sdk').NomeTipo` (pelo
 * barrel).
 *
 * **Não contém runtime** — puro barrel de tipos para JSDoc.
 *
 * @module copilot/sdk/types
 */

// ─── Core Client & Session ────────────────────────────────────────────────────

/**
 * Classe principal do SDK. Gerencia conexão com o CLI, autenticação, criação/resumo de sessões e lifecycle events.
 *
 * @typedef {import('@github/copilot-sdk').CopilotClient} CopilotClient
 */

/**
 * Opções para criação do CopilotClient (cliPath, port, transport, telemetry, etc.).
 *
 * @typedef {import('@github/copilot-sdk').CopilotClientOptions} CopilotClientOptions
 */

/**
 * Sessão ativa do SDK. Expõe sendAndWait, on, abort, setModel, rpc, etc.
 *
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 */

/**
 * Configuração completa para criação de sessão (model, tools, hooks, etc.).
 *
 * @typedef {import('@github/copilot-sdk').SessionConfig} SessionConfig
 */

/**
 * Configuração para retomar sessão existente (subset de SessionConfig + sessionId).
 *
 * @typedef {import('@github/copilot-sdk').ResumeSessionConfig} ResumeSessionConfig
 */

/**
 * Opções para session.sendAndWait(message, options).
 *
 * @typedef {import('@github/copilot-sdk').MessageOptions} MessageOptions
 */

/**
 * Estado da conexão do client com o CLI server.
 *
 * @typedef {import('@github/copilot-sdk').ConnectionState} ConnectionState
 */

/**
 * Nível de esforço de reasoning (low, medium, high, xhigh).
 *
 * @typedef {import('@github/copilot-sdk').ReasoningEffort} ReasoningEffort
 */

// ─── Tools ────────────────────────────────────────────────────────────────────

/**
 * Definição de tool para o SDK (retornada por defineTool).
 *
 * @template [TArgs=unknown] Default is `unknown`
 * @typedef {import('@github/copilot-sdk').Tool<TArgs>} Tool
 */

/**
 * Handler de execução de tool.
 *
 * @template [TArgs=unknown] Default is `unknown`
 * @typedef {import('@github/copilot-sdk').ToolHandler<TArgs>} ToolHandler
 */

/**
 * Contexto de invocação de tool (sessionId, toolCallId, etc.).
 *
 * @typedef {import('@github/copilot-sdk').ToolInvocation} ToolInvocation
 */

/**
 * Resultado de tool como objeto (type + content ou data).
 *
 * @typedef {import('@github/copilot-sdk').ToolResultObject} ToolResultObject
 */

/**
 * Resultado de tool binário.
 *
 * @typedef {import('@github/copilot-sdk').ToolBinaryResult} ToolBinaryResult
 */

/**
 * Resultado de tool: string | ToolResultObject.
 *
 * @typedef {import('@github/copilot-sdk').ToolResult} ToolResult
 */

/**
 * Tipo do resultado de tool (success, failure, rejected, denied).
 *
 * @typedef {import('@github/copilot-sdk').ToolResultType} ToolResultType
 */

/**
 * Payload de requisição de tool call.
 *
 * @typedef {import('@github/copilot-sdk').ToolCallRequestPayload} ToolCallRequestPayload
 */

/**
 * Payload de resposta de tool call.
 *
 * @typedef {import('@github/copilot-sdk').ToolCallResponsePayload} ToolCallResponsePayload
 */

/**
 * Schema Zod usado pelo SDK para validação de parâmetros de tool.
 *
 * @template [T=unknown] Default is `unknown`
 * @typedef {import('@github/copilot-sdk').ZodSchema<T>} ZodSchema
 */

// ─── Permissions ──────────────────────────────────────────────────────────────

/**
 * Pedido de permissão emitido pelo SDK quando uma tool quer executar ação protegida.
 *
 * @typedef {import('@github/copilot-sdk').PermissionRequest} PermissionRequest
 */

/**
 * Resultado da decisão de permissão (allow, deny, allowAlways, denyAlways, dismiss).
 *
 * @typedef {import('@github/copilot-sdk').PermissionRequestResult} PermissionRequestResult
 */

/**
 * Handler de permissão do SDK. Recebe PermissionRequest, retorna PermissionRequestResult.
 *
 * @typedef {import('@github/copilot-sdk').PermissionHandler} PermissionHandler
 */

// ─── User Input ───────────────────────────────────────────────────────────────

/**
 * Pedido de input interativo do usuário (elicitation).
 *
 * @typedef {import('@github/copilot-sdk').UserInputRequest} UserInputRequest
 */

/**
 * Resposta do input interativo do usuário.
 *
 * @typedef {import('@github/copilot-sdk').UserInputResponse} UserInputResponse
 */

/**
 * Handler de input interativo do usuário.
 *
 * @typedef {import('@github/copilot-sdk').UserInputHandler} UserInputHandler
 */

// ─── System Message ───────────────────────────────────────────────────────────

/**
 * Configuração de system message (união: append | replace | customize).
 *
 * @typedef {import('@github/copilot-sdk').SystemMessageConfig} SystemMessageConfig
 */

/**
 * System message em modo append (adiciona ao final do prompt).
 *
 * @typedef {import('@github/copilot-sdk').SystemMessageAppendConfig} SystemMessageAppendConfig
 */

/**
 * System message em modo replace (substitui todo o prompt — cuidado: remove guardrails).
 *
 * @typedef {import('@github/copilot-sdk').SystemMessageReplaceConfig} SystemMessageReplaceConfig
 */

/**
 * System message em modo customize (override por seção — mais seguro e poderoso).
 *
 * @typedef {import('@github/copilot-sdk').SystemMessageCustomizeConfig} SystemMessageCustomizeConfig
 */

/**
 * Nome de seção do system prompt (identity, tone, guidelines, safety, etc.).
 *
 * @typedef {import('@github/copilot-sdk').SystemPromptSection} SystemPromptSection
 */

/**
 * Override de uma seção específica do system prompt.
 *
 * @typedef {import('@github/copilot-sdk').SectionOverride} SectionOverride
 */

/**
 * Ação de override de seção (replace, remove, append, prepend, ou transform fn).
 *
 * @typedef {import('@github/copilot-sdk').SectionOverrideAction} SectionOverrideAction
 */

/**
 * Função de transformação de seção: recebe conteúdo atual, retorna novo conteúdo.
 *
 * @typedef {import('@github/copilot-sdk').SectionTransformFn} SectionTransformFn
 */

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Campos base compartilhados por todos os hook inputs (sessionId, etc.).
 *
 * @typedef {import('@github/copilot-sdk').BaseHookInput} BaseHookInput
 */

/**
 * Configuração de hooks de sessão (preToolUse, postToolUse, sessionStart, sessionEnd, etc.).
 *
 * @typedef {import('@github/copilot-sdk').SessionHooks} SessionHooks
 */

/**
 * Input do hook preToolUse (toolName, args, etc.).
 *
 * @typedef {import('@github/copilot-sdk').PreToolUseHookInput} PreToolUseHookInput
 */

/**
 * Output do hook preToolUse (allow, deny, modify).
 *
 * @typedef {import('@github/copilot-sdk').PreToolUseHookOutput} PreToolUseHookOutput
 */

/**
 * Handler do hook preToolUse.
 *
 * @typedef {import('@github/copilot-sdk').PreToolUseHandler} PreToolUseHandler
 */

/**
 * Input do hook postToolUse (toolName, result, etc.).
 *
 * @typedef {import('@github/copilot-sdk').PostToolUseHookInput} PostToolUseHookInput
 */

/**
 * Output do hook postToolUse.
 *
 * @typedef {import('@github/copilot-sdk').PostToolUseHookOutput} PostToolUseHookOutput
 */

/**
 * Handler do hook postToolUse.
 *
 * @typedef {import('@github/copilot-sdk').PostToolUseHandler} PostToolUseHandler
 */

/**
 * Input do hook userPromptSubmitted (message text).
 *
 * @typedef {import('@github/copilot-sdk').UserPromptSubmittedHookInput} UserPromptSubmittedHookInput
 */

/**
 * Output do hook userPromptSubmitted.
 *
 * @typedef {import('@github/copilot-sdk').UserPromptSubmittedHookOutput} UserPromptSubmittedHookOutput
 */

/**
 * Handler do hook userPromptSubmitted.
 *
 * @typedef {import('@github/copilot-sdk').UserPromptSubmittedHandler} UserPromptSubmittedHandler
 */

/**
 * Input do hook sessionStart.
 *
 * @typedef {import('@github/copilot-sdk').SessionStartHookInput} SessionStartHookInput
 */

/**
 * Output do hook sessionStart.
 *
 * @typedef {import('@github/copilot-sdk').SessionStartHookOutput} SessionStartHookOutput
 */

/**
 * Handler do hook sessionStart.
 *
 * @typedef {import('@github/copilot-sdk').SessionStartHandler} SessionStartHandler
 */

/**
 * Input do hook sessionEnd.
 *
 * @typedef {import('@github/copilot-sdk').SessionEndHookInput} SessionEndHookInput
 */

/**
 * Output do hook sessionEnd.
 *
 * @typedef {import('@github/copilot-sdk').SessionEndHookOutput} SessionEndHookOutput
 */

/**
 * Handler do hook sessionEnd.
 *
 * @typedef {import('@github/copilot-sdk').SessionEndHandler} SessionEndHandler
 */

/**
 * Input do hook errorOccurred.
 *
 * @typedef {import('@github/copilot-sdk').ErrorOccurredHookInput} ErrorOccurredHookInput
 */

/**
 * Output do hook errorOccurred.
 *
 * @typedef {import('@github/copilot-sdk').ErrorOccurredHookOutput} ErrorOccurredHookOutput
 */

/**
 * Handler do hook errorOccurred.
 *
 * @typedef {import('@github/copilot-sdk').ErrorOccurredHandler} ErrorOccurredHandler
 */

// ─── Events ───────────────────────────────────────────────────────────────────

/**
 * Evento genérico da sessão SDK (união discriminada pelo campo type).
 *
 * @typedef {import('@github/copilot-sdk').SessionEvent} SessionEvent
 */

/**
 * Tipo de evento da sessão SDK (string literal union de 70+ eventos).
 *
 * @typedef {import('@github/copilot-sdk').SessionEventType} SessionEventType
 */

/**
 * Payload tipado para um tipo de evento específico.
 *
 * @template {import('@github/copilot-sdk').SessionEventType} T
 * @typedef {import('@github/copilot-sdk').SessionEventPayload<T>} SessionEventPayload
 */

/**
 * Handler tipado para um tipo de evento específico.
 *
 * @template {import('@github/copilot-sdk').SessionEventType} T
 * @typedef {import('@github/copilot-sdk').TypedSessionEventHandler<T>} TypedSessionEventHandler
 */

/**
 * Handler genérico para qualquer evento de sessão.
 *
 * @typedef {import('@github/copilot-sdk').SessionEventHandler} SessionEventHandler
 */

/**
 * Evento de mensagem do assistente (inclui content, role, etc.).
 *
 * @typedef {import('@github/copilot-sdk').AssistantMessageEvent} AssistantMessageEvent
 */

// ─── Session Lifecycle ────────────────────────────────────────────────────────

/**
 * Tipo de evento de lifecycle de sessão (created, deleted, updated, foreground, background).
 *
 * @typedef {import('@github/copilot-sdk').SessionLifecycleEventType} SessionLifecycleEventType
 */

/**
 * Evento de lifecycle de sessão emitido pelo client.
 *
 * @typedef {import('@github/copilot-sdk').SessionLifecycleEvent} SessionLifecycleEvent
 */

/**
 * Handler de lifecycle de sessão.
 *
 * @typedef {import('@github/copilot-sdk').SessionLifecycleHandler} SessionLifecycleHandler
 */

/**
 * Handler tipado de lifecycle de sessão para um tipo específico.
 *
 * @template {import('@github/copilot-sdk').SessionLifecycleEventType} K
 * @typedef {import('@github/copilot-sdk').TypedSessionLifecycleHandler<K>} TypedSessionLifecycleHandler
 */

// ─── Models ───────────────────────────────────────────────────────────────────

/**
 * Informações de modelo (id, name, capabilities, policy, billing).
 *
 * @typedef {import('@github/copilot-sdk').ModelInfo} ModelInfo
 */

/**
 * Capacidades do modelo (vision, reasoning, maxTokens, etc.).
 *
 * @typedef {import('@github/copilot-sdk').ModelCapabilities} ModelCapabilities
 */

/**
 * Política do modelo (limites, restrições).
 *
 * @typedef {import('@github/copilot-sdk').ModelPolicy} ModelPolicy
 */

/**
 * Billing info do modelo (custo, tier).
 *
 * @typedef {import('@github/copilot-sdk').ModelBilling} ModelBilling
 */

// ─── MCP ──────────────────────────────────────────────────────────────────────

/**
 * Configuração de MCP server (união: local | remote).
 *
 * @typedef {import('@github/copilot-sdk').MCPServerConfig} MCPServerConfig
 */

/**
 * Configuração de MCP server local (command + args).
 *
 * @typedef {import('@github/copilot-sdk').MCPLocalServerConfig} MCPLocalServerConfig
 */

/**
 * Configuração de MCP server remoto (url + headers).
 *
 * @typedef {import('@github/copilot-sdk').MCPRemoteServerConfig} MCPRemoteServerConfig
 */

// ─── Custom Agents ────────────────────────────────────────────────────────────

/**
 * Configuração de agente customizado.
 *
 * @typedef {import('@github/copilot-sdk').CustomAgentConfig} CustomAgentConfig
 */

// ─── Infinite Sessions ────────────────────────────────────────────────────────

/**
 * Configuração de sessão infinita (compaction thresholds).
 *
 * @typedef {import('@github/copilot-sdk').InfiniteSessionConfig} InfiniteSessionConfig
 */

// ─── Provider (BYOK) ─────────────────────────────────────────────────────────

/**
 * Configuração de provider externo (OpenAI, Azure, Anthropic).
 *
 * @typedef {import('@github/copilot-sdk').ProviderConfig} ProviderConfig
 */

// ─── Session Context & Metadata ───────────────────────────────────────────────

/**
 * Contexto da sessão (workspacePath, etc.).
 *
 * @typedef {import('@github/copilot-sdk').SessionContext} SessionContext
 */

/**
 * Metadados de sessão (id, model, status, etc.).
 *
 * @typedef {import('@github/copilot-sdk').SessionMetadata} SessionMetadata
 */

/**
 * Filtro para listagem de sessões.
 *
 * @typedef {import('@github/copilot-sdk').SessionListFilter} SessionListFilter
 */

/**
 * Info da sessão em foreground.
 *
 * @typedef {import('@github/copilot-sdk').ForegroundSessionInfo} ForegroundSessionInfo
 */

// ─── Telemetry ────────────────────────────────────────────────────────────────

/**
 * Configuração de telemetria OpenTelemetry.
 *
 * @typedef {import('@github/copilot-sdk').TelemetryConfig} TelemetryConfig
 */

/**
 * Contexto de trace W3C (traceparent, tracestate).
 *
 * @typedef {import('@github/copilot-sdk').TraceContext} TraceContext
 */

/**
 * Provider de trace context (retorna TraceContext).
 *
 * @typedef {import('@github/copilot-sdk').TraceContextProvider} TraceContextProvider
 */

// ─── Status & Auth ────────────────────────────────────────────────────────────

/**
 * Resposta de getStatus() do CLI server.
 *
 * @typedef {import('@github/copilot-sdk').GetStatusResponse} GetStatusResponse
 */

/**
 * Resposta de getAuthStatus() para verificação de autenticação GitHub Copilot.
 *
 * @typedef {import('@github/copilot-sdk').GetAuthStatusResponse} GetAuthStatusResponse
 */

// ─── Runtime re-exports (non-type) ───────────────────────────────────────────
// Nota: defineTool, approveAll, SYSTEM_PROMPT_SECTIONS são runtime values.
// Re-exportados aqui para conveniência; consumers de runtime DEVEM usar
// o barrel sdk/index.js.

export {};
