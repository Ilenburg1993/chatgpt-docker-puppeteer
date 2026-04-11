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
 * @typedef {'low' | 'medium' | 'high' | 'xhigh'} ReasoningEffort
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
 * @typedef {{ type: 'binary'; mimeType: string; data: Buffer | Uint8Array }} ToolBinaryResult
 */

/**
 * Resultado de tool: string | ToolResultObject | ToolBinaryResult.
 *
 * @typedef {string | ToolResultObject | ToolBinaryResult} ToolResult
 */

/**
 * Tipo do resultado de tool (success, failure, rejected, denied).
 *
 * @typedef {'success' | 'failure' | 'rejected' | 'denied'} ToolResultType
 */

/**
 * Payload de requisição de tool call.
 *
 * @typedef {{ toolName: string; toolCallId: string; args: Record<string, unknown> }} ToolCallRequestPayload
 */

/**
 * Payload de resposta de tool call.
 *
 * @typedef {{ toolCallId: string; result: ToolResult; type?: ToolResultType }} ToolCallResponsePayload
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
 * @typedef {{
 *     title?: string;
 *     message?: string;
 *     fields: { id: string; label: string; type?: string; required?: boolean; default?: string }[];
 * }} UserInputRequest
 */

/**
 * Resposta do input interativo do usuário.
 *
 * @typedef {{ values: Record<string, string>; cancelled?: boolean }} UserInputResponse
 */

/**
 * Handler de input interativo do usuário.
 *
 * @typedef {(request: UserInputRequest) => Promise<UserInputResponse>} UserInputHandler
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
 * @typedef {{ sessionId: string; [key: string]: unknown }} BaseHookInput
 */

/**
 * Configuração de hooks de sessão (preToolUse, postToolUse, sessionStart, sessionEnd, etc.).
 *
 * @typedef {{
 *     preToolUse?: PreToolUseHandler;
 *     postToolUse?: PostToolUseHandler;
 *     userPromptSubmitted?: UserPromptSubmittedHandler;
 *     sessionStart?: SessionStartHandler;
 *     sessionEnd?: SessionEndHandler;
 *     errorOccurred?: ErrorOccurredHandler;
 * }} SessionHooks
 */

/**
 * Input do hook preToolUse (toolName, args, etc.).
 *
 * @typedef {BaseHookInput & { toolName: string; toolCallId: string; args: Record<string, unknown> }} PreToolUseHookInput
 */

/**
 * Output do hook preToolUse (allow, deny, modify).
 *
 * @typedef {{
 *     decision?: 'allow' | 'deny' | 'modify';
 *     modifiedArgs?: Record<string, unknown>;
 *     systemMessage?: string;
 *     [key: string]: unknown;
 * } | void} PreToolUseHookOutput
 */

/**
 * Handler do hook preToolUse.
 *
 * @typedef {(input: PreToolUseHookInput) => Promise<PreToolUseHookOutput> | PreToolUseHookOutput} PreToolUseHandler
 */

/**
 * Input do hook postToolUse (toolName, result, etc.).
 *
 * @typedef {BaseHookInput & { toolName: string; toolCallId: string; result: ToolResult }} PostToolUseHookInput
 */

/**
 * Output do hook postToolUse.
 *
 * @typedef {{ systemMessage?: string; [key: string]: unknown } | void} PostToolUseHookOutput
 */

/**
 * Handler do hook postToolUse.
 *
 * @typedef {(input: PostToolUseHookInput) => Promise<PostToolUseHookOutput> | PostToolUseHookOutput} PostToolUseHandler
 */

/**
 * Input do hook userPromptSubmitted (message text).
 *
 * @typedef {BaseHookInput & { message: string }} UserPromptSubmittedHookInput
 */

/**
 * Output do hook userPromptSubmitted.
 *
 * @typedef {{ systemMessage?: string; modifiedMessage?: string; [key: string]: unknown } | void} UserPromptSubmittedHookOutput
 */

/**
 * Handler do hook userPromptSubmitted.
 *
 * @typedef {(
 *     input: UserPromptSubmittedHookInput,
 * ) => Promise<UserPromptSubmittedHookOutput> | UserPromptSubmittedHookOutput} UserPromptSubmittedHandler
 */

/**
 * Input do hook sessionStart.
 *
 * @typedef {BaseHookInput & { model?: string }} SessionStartHookInput
 */

/**
 * Output do hook sessionStart.
 *
 * @typedef {{ systemMessage?: string; [key: string]: unknown } | void} SessionStartHookOutput
 */

/**
 * Handler do hook sessionStart.
 *
 * @typedef {(input: SessionStartHookInput) => Promise<SessionStartHookOutput> | SessionStartHookOutput} SessionStartHandler
 */

/**
 * Input do hook sessionEnd.
 *
 * @typedef {BaseHookInput & { reason?: string }} SessionEndHookInput
 */

/**
 * Output do hook sessionEnd.
 *
 * @typedef {{ [key: string]: unknown } | void} SessionEndHookOutput
 */

/**
 * Handler do hook sessionEnd.
 *
 * @typedef {(input: SessionEndHookInput) => Promise<SessionEndHookOutput> | SessionEndHookOutput} SessionEndHandler
 */

/**
 * Input do hook errorOccurred.
 *
 * @typedef {BaseHookInput & { error: Error | unknown; context?: string }} ErrorOccurredHookInput
 */

/**
 * Output do hook errorOccurred.
 *
 * @typedef {{ handled?: boolean; [key: string]: unknown } | void} ErrorOccurredHookOutput
 */

/**
 * Handler do hook errorOccurred.
 *
 * @typedef {(input: ErrorOccurredHookInput) => Promise<ErrorOccurredHookOutput> | ErrorOccurredHookOutput} ErrorOccurredHandler
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
 * @typedef {{
 *     provider: 'openai' | 'azure' | 'anthropic' | string;
 *     apiKey?: string;
 *     baseUrl?: string;
 *     model?: string;
 *     [key: string]: unknown;
 * }} ProviderConfig
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

// ─── RPC Result Types ─────────────────────────────────────────────────────────
// Tipos de retorno das chamadas RPC do sdk/rpc-ops.js e sdk/rpc-session.js.
// O SDK não exporta esses tipos — definidos localmente como objetos genéricos.

/**
 * Resultado de shell.exec() — contém processId, stdout, stderr, exitCode.
 * @typedef {{ processId: string; stdout?: string; stderr?: string; exitCode?: number; [k: string]: unknown }} ShellExecResult
 */

/**
 * Resultado de shell.kill() — confirmação de sinal enviado.
 * @typedef {{ killed: boolean; [k: string]: unknown }} ShellKillResult
 */

/**
 * Resultado de ui.elicitation() — resposta do formulário pelo usuário.
 * @typedef {{ action: 'accept' | 'dismiss' | 'cancel'; content?: Record<string, unknown>; [k: string]: unknown }} ElicitationResult
 */

/**
 * Resultado genérico de handlers RPC (commands, permissions, tools).
 * @typedef {{ success: boolean; [k: string]: unknown }} HandleResult
 */

/**
 * Resultado de model.getCurrent() — modelo ativo da sessão.
 * @typedef {{ modelId: string; [k: string]: unknown }} ModelCurrentResult
 */

/**
 * Resultado de model.switchTo() — confirmação de troca de modelo.
 * @typedef {{ modelId: string; [k: string]: unknown }} ModelSwitchResult
 */

/**
 * Modo atual da sessão (interactive, plan, autopilot).
 * @typedef {'interactive' | 'plan' | 'autopilot'} SessionMode
 */

/**
 * Resultado de mode.get() / mode.set() — modo atual após a operação.
 * @typedef {{ mode: SessionMode; [k: string]: unknown }} ModeResult
 */

/**
 * Resultado de plan.read() — conteúdo do plan.md da sessão.
 * @typedef {{ content: string; [k: string]: unknown }} PlanReadResult
 */

/**
 * Resultado de workspace.listFiles() — lista de arquivos no workspace.
 * @typedef {{ files: string[]; [k: string]: unknown }} WorkspaceListResult
 */

/**
 * Resultado de workspace.readFile() — conteúdo de um arquivo do workspace.
 * @typedef {{ content: string; [k: string]: unknown }} WorkspaceReadResult
 */

/**
 * Resultado de session.log() — confirmação de log emitido.
 * @typedef {{ logId?: string; [k: string]: unknown }} LogResult
 */

// ─── Runtime re-exports (non-type) ───────────────────────────────────────────
// Nota: defineTool, approveAll, SYSTEM_PROMPT_SECTIONS são runtime values.
// Re-exportados aqui para conveniência; consumers de runtime DEVEM usar
// o barrel sdk/index.js.

export {};
