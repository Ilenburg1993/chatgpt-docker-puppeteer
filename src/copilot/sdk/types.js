// @ts-check
/**
 * src/copilot/sdk/types.js
 *
 * SSOT (Single Source of Truth) para todos os tipos do `@github/copilot-sdk` neste projeto.
 *
 * **Regras:**
 *
 * - Tipos públicos exportados pela raiz do SDK são importados via `@typedef {import('@github/copilot-sdk').TypeName}`.
 * - Tipos internos do SDK (presentes em `dist/types.d.ts`, mas não re-exportados na raiz) e tipos locais/projeto são
 *   definidos aqui e documentados como tal.
 * - Não contém runtime — apenas barrel de tipos para JSDoc.
 * - Consumers de tipos devem importar via `import('./types.js').NomeTipo` ou pelo barrel `#copilot/sdk`.
 *
 * @module copilot/sdk/types
 */

// ─── Core Client & Session ────────────────────────────────────────────────────

/**
 * Classe principal do SDK. Gerencia conexão com o CLI, autenticação, criação/resumo de sessões, metadata e lifecycle
 * events. Métodos principais: `start()`, `stop()`, `forceStop()`, `createSession()`, `resumeSession()`, `ping()`,
 * `getState()`, `getStatus()`, `getAuthStatus()`, `listModels()`, `getLastSessionId()`, `listSessions()`,
 * `getSessionMetadata()`, `deleteSession()`, `getForegroundSessionId()`, `setForegroundSessionId()` e `on()`
 * (lifecycle).
 *
 * @typedef {import('@github/copilot-sdk').CopilotClient} CopilotClient
 */

/**
 * Opções de criação do CopilotClient. Permite configurar: `cliPath`, `cliArgs`, `cwd`, `port`, `useStdio`,
 * `isChildProcess`, `cliUrl`, `logLevel`, `autoStart`, `autoRestart` (deprecated/no-op no SDK atual), `env`,
 * `gitHubToken`, `useLoggedInUser`, `onListModels`, `telemetry`, `onGetTraceContext`, `sessionFs` e
 * `sessionIdleTimeoutSeconds`.
 *
 * @typedef {import('@github/copilot-sdk').CopilotClientOptions} CopilotClientOptions
 */

/**
 * Sessão ativa do SDK. Expõe: `sendAndWait()`, `on()`, `abort()`, `setModel()` ou `switchModel()`, `rpc`, `sessionId`,
 * `workingDirectory`.
 *
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 */

/**
 * Configuração completa para criação de sessão. Campos principais: `sessionId?`, `clientName?`, `model?`,
 * `reasoningEffort?`, `modelCapabilities?`, `configDir?`, `enableConfigDiscovery?`, `tools?`, `commands?`,
 * `systemMessage?`, `availableTools?`, `excludedTools?`, `provider?`, `onPermissionRequest`, `onUserInputRequest?`,
 * `onElicitationRequest?`, `hooks?`, `workingDirectory?`, `streaming?`, `includeSubAgentStreamingEvents?`,
 * `mcpServers?`, `customAgents?`, `defaultAgent?`, `agent?`, `skillDirectories?`, `disabledSkills?`,
 * `infiniteSessions?`, `gitHubToken?`, `onEvent?` e `createSessionFsHandler?`.
 *
 * @typedef {import('@github/copilot-sdk').SessionConfig} SessionConfig
 */

/**
 * Configuração para retomar sessão existente. Subconjunto de `SessionConfig` que exclui `sessionId`, mas preserva os
 * principais knobs operacionais: `clientName?`, `model?`, `reasoningEffort?`, `modelCapabilities?`, `tools?`,
 * `commands?`, `systemMessage?`, `availableTools?`, `excludedTools?`, `provider?`, `workingDirectory?`, `streaming?`,
 * `includeSubAgentStreamingEvents?`, `mcpServers?`, `customAgents?`, `defaultAgent?`, `agent?`, `skillDirectories?`,
 * `disabledSkills?`, `infiniteSessions?`, `gitHubToken?`, `onEvent?` e `createSessionFsHandler?`. Adicionalmente aceita
 * `disableResume?: boolean` para reconectar sem emitir `session.resume`.
 *
 * @typedef {import('@github/copilot-sdk').ResumeSessionConfig} ResumeSessionConfig
 */

/**
 * Opções para `session.send(options)` e `session.sendAndWait(options, timeout?)`. Campos: `prompt`, `attachments?`
 * (file, directory, selection, blob), `mode?` ("enqueue" | "immediate") e `requestHeaders?` para headers por turno.
 * A borda runtime canônica valida esse objeto via `normalizeMessageOptions()` antes de chamar o SDK.
 *
 * @typedef {import('@github/copilot-sdk').MessageOptions} MessageOptions
 */

/**
 * Estado da conexão do client com o CLI server. Valores: `"disconnected"` | `"connecting"` | `"connected"` | `"error"`.
 *
 * @typedef {import('@github/copilot-sdk').ConnectionState} ConnectionState
 */

/**
 * Nível de esforço de reasoning para modelos que suportam (via `SessionConfig.reasoningEffort`). Valores: `"low"` |
 * `"medium"` | `"high"` | `"xhigh"`. Use `client.listModels()` para verificar se o modelo suporta reasoning effort.
 *
 * @typedef {'low' | 'medium' | 'high' | 'xhigh'} ReasoningEffort
 */

/**
 * Overrides granulares das capabilities de modelo em `SessionConfig.modelCapabilities`.
 *
 * @typedef {import('@github/copilot-sdk').ModelCapabilitiesOverride} ModelCapabilitiesOverride
 */

// ─── Tools ────────────────────────────────────────────────────────────────────

/**
 * Definição de tool para o SDK. Campos: `name`, `description?`, `parameters?` (ZodSchema | JSON schema), `handler`,
 * `overridesBuiltInTool?` (bool — obrigatório se sobrescrever tool builtin), `skipPermission?` (bool — pula prompt de
 * permissão).
 *
 * @template [TArgs=unknown] Default is `unknown`
 * @typedef {import('@github/copilot-sdk').Tool<TArgs>} Tool
 */

/**
 * Handler de execução de tool. Recebe `(args: TArgs, invocation: ToolInvocation)`.
 *
 * @template [TArgs=unknown] Default is `unknown`
 * @typedef {import('@github/copilot-sdk').ToolHandler<TArgs>} ToolHandler
 */

/**
 * Entrada aceita pela factory canônica de tools para schemas de parâmetros.
 *
 * @template [T=unknown] Default is `unknown`
 * @typedef {import('./tools/core.js').ToolParameterInput<T>} ToolParameterInput
 */

/**
 * Contexto de invocação de tool. Campos: `sessionId`, `toolCallId`, `toolName`, `arguments`, `traceparent?` (W3C trace
 * — do span execute_tool do CLI), `tracestate?` (W3C trace).
 *
 * @typedef {import('@github/copilot-sdk').ToolInvocation} ToolInvocation
 */

/**
 * Resultado de tool como objeto estruturado. Campos: `textResultForLlm` (texto para o LLM), `binaryResultsForLlm?`
 * (array de `ToolBinaryResult`), `resultType` (`ToolResultType`), `error?`, `sessionLog?`, `toolTelemetry?`.
 *
 * @typedef {import('@github/copilot-sdk').ToolResultObject} ToolResultObject
 */

/**
 * Resultado de tool binário (embutido em `ToolResultObject.binaryResultsForLlm`). Campos: `data` (string base64),
 * `mimeType`, `type` (string), `description?`. Nota: NÃO é membro direto de `ToolResult` — está encapsulado dentro de
 * `ToolResultObject`.
 *
 * @typedef {{
 *     data: string;
 *     mimeType: string;
 *     type: string;
 *     description?: string;
 * }} ToolBinaryResult
 */

/**
 * Resultado de tool: string literal (retorno direto) ou `ToolResultObject` (resultado estruturado). `ToolBinaryResult`
 * é encapsulado dentro de `ToolResultObject.binaryResultsForLlm`, não é um membro direto desta union.
 *
 * @typedef {string | ToolResultObject} ToolResult
 */

/**
 * Tipo do resultado de tool. Valores: `"success"` | `"failure"` | `"rejected"` | `"denied"` | `"timeout"`.
 *
 * @typedef {'success' | 'failure' | 'rejected' | 'denied' | 'timeout'} ToolResultType
 */

/**
 * Payload de requisição de tool call. Campos: `sessionId`, `toolCallId`, `toolName`, `arguments` (unknown).
 *
 * @typedef {{
 *     sessionId: string;
 *     toolCallId: string;
 *     toolName: string;
 *     arguments: unknown;
 * }} ToolCallRequestPayload
 */

/**
 * Payload de resposta de tool call. Campo: `result` (`ToolResult`).
 *
 * @typedef {{ result: ToolResult }} ToolCallResponsePayload
 */

/**
 * Schema Zod-like usado pelo SDK para validação e inferência de tipos de parâmetros de tool. Requerido: método
 * `toJSONSchema()` e propriedade `_output` para inferência.
 *
 * @template [T=unknown] Default is `unknown`
 * @typedef {import('@github/copilot-sdk').ZodSchema<T>} ZodSchema
 */

/**
 * Registry canônico de tools local ao projeto.
 *
 * @typedef {import('./tools/registry.js').ToolRegistry} ToolRegistry
 */

/**
 * Entrada do registry canônico de tools.
 *
 * @typedef {import('./tools/registry.js').ToolEntry} ToolEntry
 */

/**
 * Contexto de tools isolado por sessão.
 *
 * @typedef {import('./session/tool-session-context.js').ToolSessionContext} ToolSessionContext
 */

/**
 * Handler de elicitation enfileirada usado por runtime/agent.
 *
 * @typedef {ReturnType<typeof import('./session/elicitation.js').createQueuedElicitationHandler>} QueuedElicitationHandler
 */

/**
 * Entrada pendente de elicitation enfileirada.
 *
 * @typedef {import('./session/elicitation.js').QueuedElicitationEntry} QueuedElicitationEntry
 */

/**
 * Entrada concluída de elicitation enfileirada.
 *
 * @typedef {import('./session/elicitation.js').CompletedQueuedElicitationEntry} CompletedQueuedElicitationEntry
 */

/**
 * Opções do handler de elicitation enfileirada.
 *
 * @typedef {import('./session/elicitation.js').QueuedElicitationHandlerOptions} QueuedElicitationHandlerOptions
 */

/**
 * Bus de hooks do SDK local.
 *
 * @typedef {import('./session/hook-bus.js').HookBus} HookBus
 */

// ─── Permissions ──────────────────────────────────────────────────────────────

/**
 * Pedido de permissão emitido pelo CLI quando uma tool quer executar ação protegida. Campo discriminador: `kind`
 * (`"shell"` | `"write"` | `"mcp"` | `"read"` | `"url"` | `"custom-tool"` | `"memory"` | `"hook"`). Campos adicionais
 * variam por kind.
 *
 * @typedef {import('@github/copilot-sdk').PermissionRequest} PermissionRequest
 */

/**
 * Resultado da decisão de permissão. No `@github/copilot-sdk@0.3.0`, essa union usa `approve-once`,
 * `approve-for-session`, `approve-for-location`, `reject`, `user-not-available` e `no-result`. Os nomes
 * `approved`/`denied-*` pertencem aos eventos `permission.completed`, não ao retorno do handler.
 *
 * @typedef {import('@github/copilot-sdk').PermissionRequestResult} PermissionRequestResult
 */

/**
 * Handler de permissão do SDK. Assinatura: `(request: PermissionRequest, invocation: { sessionId: string }) =>
 * Promise<PermissionRequestResult> | PermissionRequestResult`. Disponível o helper runtime `approveAll` (em
 * `sdk/index.js`) para desenvolvimento/testes.
 *
 * @typedef {import('@github/copilot-sdk').PermissionHandler} PermissionHandler
 */

/**
 * Evento genérico de métrica emitido pela SDK Wrapper Layer. É transportado por um emitter injetável para evitar
 * dependência direta de L1 → L2.
 *
 * @typedef {object} SdkOperationMetric
 * @property {string} operation
 * @property {'started' | 'succeeded' | 'failed'} status
 * @property {string} [sessionId]
 * @property {number} [durationMs]
 * @property {Record<string, unknown>} [attributes]
 */

/**
 * Callback opcional de observabilidade para métricas da SDK Wrapper Layer.
 *
 * @typedef {(metric: SdkOperationMetric) => void} SdkMetricEmitter
 */

/**
 * Política operacional derivada de `SdkErrorKind`, usada para governar retry/backoff, reconnect e integração com
 * circuit breaker no boundary SDK.
 *
 * @typedef {object} SdkRecoveryPolicy
 * @property {import('./errors.js').SdkErrorKind} kind
 * @property {'connection' | 'session'} scope
 * @property {boolean} retryable
 * @property {boolean} allowReconnect
 * @property {boolean} tripCircuit
 * @property {boolean} resetCircuit
 * @property {number} backoffMs
 * @property {string} reason
 */

// ─── User Input ───────────────────────────────────────────────────────────────

/**
 * Pedido de input interativo do usuário. Habilita a tool `ask_user`. Campos: `question`, `choices?` (múltipla escolha),
 * `allowFreeform?` (default `true`).
 *
 * @typedef {{
 *     question: string;
 *     choices?: string[];
 *     allowFreeform?: boolean;
 * }} UserInputRequest
 */

/**
 * Resposta do input interativo do usuário. Campos: `answer` (string), `wasFreeform` (bool).
 *
 * @typedef {{
 *     answer: string;
 *     wasFreeform: boolean;
 * }} UserInputResponse
 */

/**
 * Handler de input interativo. Assinatura: `(request: UserInputRequest, invocation: { sessionId: string }) =>
 * Promise<UserInputResponse> | UserInputResponse`.
 *
 * @typedef {(
 *     request: UserInputRequest,
 *     invocation: { sessionId: string },
 * ) => Promise<UserInputResponse> | UserInputResponse} UserInputHandler
 */

// ─── Elicitation / Session UI ────────────────────────────────────────────────

/**
 * Contexto recebido por `onElicitationRequest`: `sessionId`, `message`, `requestedSchema?`, `mode?`,
 * `elicitationSource?`, `url?`.
 *
 * @typedef {import('@github/copilot-sdk').ElicitationContext} ElicitationContext
 */

/**
 * Handler de elicitation: permite que o cliente atue como provider de formulários/URL estruturados para o SDK.
 *
 * @typedef {import('@github/copilot-sdk').ElicitationHandler} ElicitationHandler
 */

/**
 * Valor primitivo aceito no conteúdo de uma resposta de elicitation.
 *
 * @typedef {import('@github/copilot-sdk').ElicitationFieldValue} ElicitationFieldValue
 */

/**
 * Campo individual do schema JSON usado em elicitation.
 *
 * @typedef {import('@github/copilot-sdk').ElicitationSchemaField} ElicitationSchemaField
 */

/**
 * Schema de formulário para elicitation. Formato MCP/SDK: `{ type: 'object', properties, required? }`.
 *
 * @typedef {import('@github/copilot-sdk').ElicitationSchema} ElicitationSchema
 */

/**
 * Parâmetros da operação `session.ui.elicitation()`.
 *
 * @typedef {import('@github/copilot-sdk').ElicitationParams} ElicitationParams
 */

/**
 * Resultado de `session.ui.elicitation()` ou de `onElicitationRequest`: `{ action: 'accept' | 'decline' | 'cancel',
 * content? }`.
 *
 * @typedef {import('@github/copilot-sdk').ElicitationResult} ElicitationResult
 */

/**
 * Opções da conveniência `session.ui.input()`.
 *
 * @typedef {import('@github/copilot-sdk').InputOptions} InputOptions
 */

/**
 * API de UI interativa exposta em `session.ui`: `elicitation()`, `confirm()`, `select()`, `input()`.
 *
 * @typedef {import('@github/copilot-sdk').SessionUiApi} SessionUiApi
 */

/**
 * Capabilities da sessão. Atualmente cobre `ui.elicitation` e é atualizada automaticamente pelo SDK em eventos
 * `capabilities.changed`.
 *
 * @typedef {import('@github/copilot-sdk').SessionCapabilities} SessionCapabilities
 */

// ─── Commands ────────────────────────────────────────────────────────────────

/**
 * Contexto entregue ao handler de slash command do SDK.
 *
 * @typedef {import('@github/copilot-sdk').CommandContext} CommandContext
 */

/**
 * Handler de slash command.
 *
 * @typedef {import('@github/copilot-sdk').CommandHandler} CommandHandler
 */

/**
 * Definição de slash command registrada na sessão.
 *
 * @typedef {import('@github/copilot-sdk').CommandDefinition} CommandDefinition
 */

/**
 * Configuração do default agent do SDK.
 *
 * @typedef {import('@github/copilot-sdk').DefaultAgentConfig} DefaultAgentConfig
 */

// ─── System Message ───────────────────────────────────────────────────────────

/**
 * Configuração de system message (union: `SystemMessageAppendConfig` | `SystemMessageReplaceConfig`
 *
 * | `SystemMessageCustomizeConfig`).
 *
 * @typedef {import('@github/copilot-sdk').SystemMessageConfig} SystemMessageConfig
 */

/**
 * System message em modo **append** (padrão). Adiciona `content?` após as seções gerenciadas pelo SDK. Campo `mode?:
 * "append"`.
 *
 * @typedef {import('@github/copilot-sdk').SystemMessageAppendConfig} SystemMessageAppendConfig
 */

/**
 * System message em modo **replace**. Substitui todo o prompt — remove guardrails de segurança. Campos: `mode:
 * "replace"`, `content: string`.
 *
 * @typedef {import('@github/copilot-sdk').SystemMessageReplaceConfig} SystemMessageReplaceConfig
 */

/**
 * System message em modo **customize**. Override por seção — mais seguro e preciso. Campos: `mode: "customize"`,
 * `sections?: Partial<Record<SystemPromptSection, SectionOverride>>`, `content?` (appended após todas as seções).
 *
 * @typedef {import('@github/copilot-sdk').SystemMessageCustomizeConfig} SystemMessageCustomizeConfig
 */

/**
 * Nome de seção do system prompt. Valores: `"identity"` | `"tone"` | `"tool_efficiency"` | `"environment_context"` |
 * `"code_change_rules"` | `"guidelines"` | `"safety"` | `"tool_instructions"` | `"custom_instructions"` |
 * `"last_instructions"`.
 *
 * @typedef {import('@github/copilot-sdk').SystemPromptSection} SystemPromptSection
 */

/**
 * Override de uma seção específica do system prompt. Campos: `action` (`SectionOverrideAction`), `content?` (string).
 *
 * @typedef {import('@github/copilot-sdk').SectionOverride} SectionOverride
 */

/**
 * Ação de override de seção. Valores: `"replace"` | `"remove"` | `"append"` | `"prepend"` | `SectionTransformFn`.
 *
 * @typedef {import('@github/copilot-sdk').SectionOverrideAction} SectionOverrideAction
 */

/**
 * Função de transformação de seção: `(currentContent: string) => string | Promise<string>`.
 *
 * @typedef {import('@github/copilot-sdk').SectionTransformFn} SectionTransformFn
 */

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Campos base compartilhados por todos os hook inputs. Campos: `timestamp` (number — ms epoch), `cwd` (string).
 *
 * @typedef {{
 *     timestamp: number;
 *     cwd: string;
 * }} BaseHookInput
 */

/**
 * Configuração de hooks de sessão. Todos os handlers são opcionais. Campos: `onPreToolUse?`, `onPostToolUse?`,
 * `onUserPromptSubmitted?`, `onSessionStart?`, `onSessionEnd?`, `onErrorOccurred?`.
 *
 * @typedef {{
 *     onPreToolUse?: PreToolUseHandler;
 *     onPostToolUse?: PostToolUseHandler;
 *     onUserPromptSubmitted?: UserPromptSubmittedHandler;
 *     onSessionStart?: SessionStartHandler;
 *     onSessionEnd?: SessionEndHandler;
 *     onErrorOccurred?: ErrorOccurredHandler;
 * }} SessionHooks
 */

/**
 * Input do hook `preToolUse`. Campos herdados de `BaseHookInput` + `toolName`, `toolArgs` (unknown).
 *
 * @typedef {BaseHookInput & {
 *     toolName: string;
 *     toolArgs: unknown;
 * }} PreToolUseHookInput
 */

/**
 * Output do hook `preToolUse`. Campos opcionais: `permissionDecision` (`"allow"` | `"deny"` | `"ask"`),
 * `permissionDecisionReason?`, `modifiedArgs?`, `additionalContext?`, `suppressOutput?`.
 *
 * @typedef {{
 *     permissionDecision?: 'allow' | 'deny' | 'ask';
 *     permissionDecisionReason?: string;
 *     modifiedArgs?: unknown;
 *     additionalContext?: string;
 *     suppressOutput?: boolean;
 * }} PreToolUseHookOutput
 */

/**
 * Handler do hook `preToolUse`. Assinatura: `(input: PreToolUseHookInput, invocation: { sessionId: string }) =>
 * Promise<PreToolUseHookOutput | void> | PreToolUseHookOutput | void`.
 *
 * @typedef {(
 *     input: PreToolUseHookInput,
 *     invocation: { sessionId: string },
 * ) => Promise<PreToolUseHookOutput | void> | PreToolUseHookOutput | void} PreToolUseHandler
 */

/**
 * Input do hook `postToolUse`. Campos: `toolName`, `toolArgs`, `toolResult` (`ToolResultObject`)
 *
 * - campos de `BaseHookInput`.
 *
 * @typedef {BaseHookInput & {
 *     toolName: string;
 *     toolArgs: unknown;
 *     toolResult: ToolResultObject;
 * }} PostToolUseHookInput
 */

/**
 * Output do hook `postToolUse`. Campos opcionais: `modifiedResult?` (`ToolResultObject`), `additionalContext?`,
 * `suppressOutput?`.
 *
 * @typedef {{
 *     modifiedResult?: ToolResultObject;
 *     additionalContext?: string;
 *     suppressOutput?: boolean;
 * }} PostToolUseHookOutput
 */

/**
 * Handler do hook `postToolUse`. Assinatura: `(input: PostToolUseHookInput, invocation: { sessionId: string }) =>
 * Promise<PostToolUseHookOutput | void> | PostToolUseHookOutput | void`.
 *
 * @typedef {(
 *     input: PostToolUseHookInput,
 *     invocation: { sessionId: string },
 * ) => Promise<PostToolUseHookOutput | void> | PostToolUseHookOutput | void} PostToolUseHandler
 */

/**
 * Input do hook `userPromptSubmitted`. Campos: `prompt` (string) + campos de `BaseHookInput`.
 *
 * @typedef {BaseHookInput & { prompt: string }} UserPromptSubmittedHookInput
 */

/**
 * Output do hook `userPromptSubmitted`. Campos opcionais: `modifiedPrompt?`, `additionalContext?`, `suppressOutput?`.
 *
 * @typedef {{
 *     modifiedPrompt?: string;
 *     additionalContext?: string;
 *     suppressOutput?: boolean;
 * }} UserPromptSubmittedHookOutput
 */

/**
 * Handler do hook `userPromptSubmitted`. Assinatura: `(input: UserPromptSubmittedHookInput, invocation: { sessionId:
 * string }) => Promise<UserPromptSubmittedHookOutput | void> | UserPromptSubmittedHookOutput | void`.
 *
 * @typedef {(
 *     input: UserPromptSubmittedHookInput,
 *     invocation: { sessionId: string },
 * ) => Promise<UserPromptSubmittedHookOutput | void> | UserPromptSubmittedHookOutput | void} UserPromptSubmittedHandler
 */

/**
 * Input do hook `sessionStart`. Campos: `source` (`"startup"` | `"resume"` | `"new"`), `initialPrompt?` + campos de
 * `BaseHookInput`.
 *
 * @typedef {BaseHookInput & {
 *     source: 'startup' | 'resume' | 'new';
 *     initialPrompt?: string;
 * }} SessionStartHookInput
 */

/**
 * Output do hook `sessionStart`. Campos opcionais: `additionalContext?`, `modifiedConfig?` (`Record<string, unknown>`).
 *
 * @typedef {{
 *     additionalContext?: string;
 *     modifiedConfig?: Record<string, unknown>;
 * }} SessionStartHookOutput
 */

/**
 * Handler do hook `sessionStart`. Assinatura: `(input: SessionStartHookInput, invocation: { sessionId: string }) =>
 * Promise<SessionStartHookOutput | void> | SessionStartHookOutput | void`.
 *
 * @typedef {(
 *     input: SessionStartHookInput,
 *     invocation: { sessionId: string },
 * ) => Promise<SessionStartHookOutput | void> | SessionStartHookOutput | void} SessionStartHandler
 */

/**
 * Input do hook `sessionEnd`. Campos: `reason` (`"complete"` | `"error"` | `"abort"` | `"timeout"` | `"user_exit"`),
 * `finalMessage?`, `error?` + campos de `BaseHookInput`.
 *
 * @typedef {BaseHookInput & {
 *     reason: 'complete' | 'error' | 'abort' | 'timeout' | 'user_exit';
 *     finalMessage?: string;
 *     error?: string;
 * }} SessionEndHookInput
 */

/**
 * Output do hook `sessionEnd`. Campos opcionais: `suppressOutput?`, `cleanupActions?` (string[]), `sessionSummary?`.
 *
 * @typedef {{
 *     suppressOutput?: boolean;
 *     cleanupActions?: string[];
 *     sessionSummary?: string;
 * }} SessionEndHookOutput
 */

/**
 * Handler do hook `sessionEnd`. Assinatura: `(input: SessionEndHookInput, invocation: { sessionId: string }) =>
 * Promise<SessionEndHookOutput | void> | SessionEndHookOutput | void`.
 *
 * @typedef {(
 *     input: SessionEndHookInput,
 *     invocation: { sessionId: string },
 * ) => Promise<SessionEndHookOutput | void> | SessionEndHookOutput | void} SessionEndHandler
 */

/**
 * Input do hook `errorOccurred`. Campos: `error` (string), `errorContext` (`"model_call"` | `"tool_execution"` |
 * `"system"` | `"user_input"`), `recoverable` (bool) + `BaseHookInput`.
 *
 * @typedef {BaseHookInput & {
 *     error: string;
 *     errorContext: 'model_call' | 'tool_execution' | 'system' | 'user_input';
 *     recoverable: boolean;
 * }} ErrorOccurredHookInput
 */

/**
 * Output do hook `errorOccurred`. Campos opcionais: `suppressOutput?`, `errorHandling?` (`"retry"` | `"skip"` |
 * `"abort"`), `retryCount?`, `userNotification?`.
 *
 * @typedef {{
 *     suppressOutput?: boolean;
 *     errorHandling?: 'retry' | 'skip' | 'abort';
 *     retryCount?: number;
 *     userNotification?: string;
 * }} ErrorOccurredHookOutput
 */

/**
 * Handler do hook `errorOccurred`. Assinatura: `(input: ErrorOccurredHookInput, invocation: { sessionId: string }) =>
 * Promise<ErrorOccurredHookOutput | void> | ErrorOccurredHookOutput | void`.
 *
 * @typedef {(
 *     input: ErrorOccurredHookInput,
 *     invocation: { sessionId: string },
 * ) => Promise<ErrorOccurredHookOutput | void> | ErrorOccurredHookOutput | void} ErrorOccurredHandler
 */

// ─── Events ───────────────────────────────────────────────────────────────────

/**
 * Evento genérico da sessão SDK (union discriminada pelo campo `type`). Inclui 70+ tipos de eventos: session.start,
 * session.end, tool.execute, model.call, compaction, etc. Gerado automaticamente em
 * `@github/copilot-sdk/dist/generated/session-events.d.ts`.
 *
 * @typedef {import('@github/copilot-sdk').SessionEvent} SessionEvent
 */

/**
 * Tipo de evento da sessão SDK (string literal union derivada de `SessionEvent["type"]`).
 *
 * @typedef {import('@github/copilot-sdk').SessionEventType} SessionEventType
 */

/**
 * Extrai o payload tipado para um tipo de evento específico via `Extract<SessionEvent, {type: T}>`.
 *
 * @template {import('@github/copilot-sdk').SessionEventType} T
 * @typedef {import('@github/copilot-sdk').SessionEventPayload<T>} SessionEventPayload
 */

/**
 * Handler tipado para um tipo de evento específico. Assinatura: `(event: SessionEventPayload<T>) => void`.
 *
 * @template {import('@github/copilot-sdk').SessionEventType} T
 * @typedef {import('@github/copilot-sdk').TypedSessionEventHandler<T>} TypedSessionEventHandler
 */

/**
 * Handler genérico para qualquer evento de sessão. Assinatura: `(event: SessionEvent) => void`.
 *
 * @typedef {import('@github/copilot-sdk').SessionEventHandler} SessionEventHandler
 */

/**
 * Evento de mensagem do assistente. Contém conteúdo e metadata da resposta do modelo.
 *
 * @typedef {import('@github/copilot-sdk').AssistantMessageEvent} AssistantMessageEvent
 */

// ─── Session Lifecycle ────────────────────────────────────────────────────────

/**
 * Tipo de evento de lifecycle de sessão emitido pelo `CopilotClient` (não pela sessão). Valores: `"session.created"` |
 * `"session.deleted"` | `"session.updated"` | `"session.foreground"` | `"session.background"`.
 *
 * @typedef {import('@github/copilot-sdk').SessionLifecycleEventType} SessionLifecycleEventType
 */

/**
 * Evento de lifecycle de sessão. Campos: `type` (`SessionLifecycleEventType`), `sessionId`, `metadata?` (`{ startTime:
 * string; modifiedTime: string; summary?: string }`).
 *
 * @typedef {import('@github/copilot-sdk').SessionLifecycleEvent} SessionLifecycleEvent
 */

/**
 * Handler de lifecycle de sessão. Assinatura: `(event: SessionLifecycleEvent) => void`.
 *
 * @typedef {import('@github/copilot-sdk').SessionLifecycleHandler} SessionLifecycleHandler
 */

/**
 * Handler tipado de lifecycle de sessão para um tipo específico. Assinatura: `(event: SessionLifecycleEvent & {type:
 * K}) => void`.
 *
 * @template {import('@github/copilot-sdk').SessionLifecycleEventType} K
 * @typedef {import('@github/copilot-sdk').TypedSessionLifecycleHandler<K>} TypedSessionLifecycleHandler
 */

// ─── Models ───────────────────────────────────────────────────────────────────

/**
 * Informações de modelo retornadas por `client.listModels()`. Campos: `id`, `name`, `capabilities`
 * (`ModelCapabilities`), `policy?` (`ModelPolicy`), `billing?` (`ModelBilling`), `supportedReasoningEfforts?`
 * (`ReasoningEffort[]`), `defaultReasoningEffort?` (`ReasoningEffort`).
 *
 * @typedef {import('@github/copilot-sdk').ModelInfo} ModelInfo
 */

/**
 * Capacidades do modelo. Campos: `supports.vision` (bool), `supports.reasoningEffort` (bool),
 * `limits.max_prompt_tokens?`, `limits.max_context_window_tokens`, `limits.vision?` (supported_media_types,
 * max_prompt_images, max_prompt_image_size).
 *
 * @typedef {import('@github/copilot-sdk').ModelCapabilities} ModelCapabilities
 */

/**
 * Política do modelo. Campos: `state` (`"enabled"` | `"disabled"` | `"unconfigured"`), `terms`.
 *
 * @typedef {import('@github/copilot-sdk').ModelPolicy} ModelPolicy
 */

/**
 * Informações de billing do modelo. Campo: `multiplier` (number).
 *
 * @typedef {import('@github/copilot-sdk').ModelBilling} ModelBilling
 */

// ─── MCP ──────────────────────────────────────────────────────────────────────

/**
 * Configuração de MCP server (union: `MCPStdioServerConfig` | `MCPHTTPServerConfig`).
 *
 * @typedef {import('@github/copilot-sdk').MCPServerConfig} MCPServerConfig
 */

/**
 * Configuração de MCP server local/stdio. Campos: `command`, `args` (string[]), `tools` (string[] — `[]` = nenhum,
 * `"*"` = todos), `type?` (`"local"` | `"stdio"`), `timeout?` (ms), `env?` (`Record<string, string>`), `cwd?`.
 *
 * @typedef {import('@github/copilot-sdk').MCPStdioServerConfig} MCPStdioServerConfig
 */

/**
 * Configuração de MCP server remoto (HTTP ou SSE). Campos: `url`, `tools` (string[] | `"*"`), `type` (`"http"` |
 * `"sse"`), `timeout?` (ms), `headers?` (`Record<string, string>`).
 *
 * @typedef {import('@github/copilot-sdk').MCPHTTPServerConfig} MCPHTTPServerConfig
 */

// ─── Custom Agents ────────────────────────────────────────────────────────────

/**
 * Configuração de agente customizado. Campos: `name` (único), `displayName?`, `description?`, `tools?` (string[] | null
 * — null/omitido = todas as tools disponíveis), `prompt` (conteúdo do agente), `mcpServers?` (`Record<string,
 * MCPServerConfig>`), `infer?` (bool, default `true`) e `skills?` (`string[]` — preload explícito resolvido contra
 * `skillDirectories` da sessão).
 *
 * @typedef {import('@github/copilot-sdk').CustomAgentConfig} CustomAgentConfig
 */

// ─── Infinite Sessions ────────────────────────────────────────────────────────

/**
 * Configuração de sessão infinita (compaction automático + persistência de workspace). Campos: `enabled?` (bool,
 * default `true`), `backgroundCompactionThreshold?` (float 0..1, default 0.80 — inicia compaction assíncrono),
 * `bufferExhaustionThreshold?` (float 0..1, default 0.95 — bloqueia até compaction completar para evitar overflow de
 * contexto).
 *
 * @typedef {import('@github/copilot-sdk').InfiniteSessionConfig} InfiniteSessionConfig
 */

// ─── Provider (BYOK) ─────────────────────────────────────────────────────────

/**
 * Configuração de provider externo (BYOK — Bring Your Own Key). Campos: `baseUrl` (obrigatório), `type?` (`"openai"` |
 * `"azure"` | `"anthropic"`, default `"openai"`), `wireApi?` (`"completions"` | `"responses"`, default `"completions"`
 * — apenas openai/azure), `apiKey?`, `bearerToken?` (toma precedência sobre `apiKey` no header `Authorization`),
 * `azure?` (`{ apiVersion?: string }` — default `"2024-10-21"`).
 *
 * @typedef {{
 *     type?: 'openai' | 'azure' | 'anthropic';
 *     wireApi?: 'completions' | 'responses';
 *     baseUrl: string;
 *     apiKey?: string;
 *     bearerToken?: string;
 *     azure?: { apiVersion?: string };
 *     headers?: Record<string, string>;
 * }} ProviderConfig
 */

/**
 * Provider de filesystem de sessão do SDK. É usado quando `CopilotClientOptions.sessionFs` está configurado para
 * redirecionar I/O de sessão para uma implementação customizada.
 *
 * @typedef {import('@github/copilot-sdk').SessionFsProvider} SessionFsProvider
 */

/**
 * Factory opcional de handler de session filesystem por sessão. Assinatura: `(session: CopilotSession) =>
 * SessionFsProvider`.
 *
 * @typedef {(session: CopilotSession) => SessionFsProvider} CreateSessionFsHandler
 */

// ─── Session Context & Metadata ───────────────────────────────────────────────

/**
 * Contexto de workspace da sessão. Campos: `cwd`, `gitRoot?`, `repository?` (owner/repo), `branch?`.
 *
 * @typedef {import('@github/copilot-sdk').SessionContext} SessionContext
 */

/**
 * Metadados de sessão. Campos: `sessionId`, `startTime` (Date), `modifiedTime` (Date), `summary?`, `isRemote` (bool),
 * `context?` (`SessionContext`).
 *
 * @typedef {import('@github/copilot-sdk').SessionMetadata} SessionMetadata
 */

/**
 * Filtro para listagem de sessões. Campos opcionais: `cwd?`, `gitRoot?`, `repository?`, `branch?`.
 *
 * @typedef {import('@github/copilot-sdk').SessionListFilter} SessionListFilter
 */

/**
 * Info da sessão em foreground (modo TUI+server). Campos: `sessionId?`, `workspacePath?`.
 *
 * @typedef {import('@github/copilot-sdk').ForegroundSessionInfo} ForegroundSessionInfo
 */

// ─── Telemetry ────────────────────────────────────────────────────────────────

/**
 * Configuração de telemetria OpenTelemetry para o CLI. Campos: `otlpEndpoint?`, `filePath?`, `exporterType?`
 * (`"otlp-http"` | `"file"`), `sourceName?`, `captureContent?` (bool — captura prompts/respostas nos traces).
 *
 * @typedef {import('@github/copilot-sdk').TelemetryConfig} TelemetryConfig
 */

/**
 * Contexto de trace W3C para propagação de traces distribuídos. Campos: `traceparent?`, `tracestate?`. Injetado em
 * `session.create`, `session.resume` e `session.send`.
 *
 * @typedef {import('@github/copilot-sdk').TraceContext} TraceContext
 */

/**
 * Provider de trace context. Assinatura: `() => TraceContext | Promise<TraceContext>`.
 *
 * @typedef {import('@github/copilot-sdk').TraceContextProvider} TraceContextProvider
 */

/**
 * Snapshot de quota normalizado pelo RPC server local.
 *
 * @typedef {import('./telemetry/quota-monitor.js').QuotaSnapshot} QuotaSnapshot
 */

/**
 * Opções do monitor canônico de quota.
 *
 * @typedef {import('./telemetry/quota-monitor.js').QuotaMonitorOptions} QuotaMonitorOptions
 */

/**
 * Monitor canônico de quota.
 *
 * @typedef {import('./telemetry/quota-monitor.js').QuotaMonitor} QuotaMonitor
 */

// ─── Status & Auth ────────────────────────────────────────────────────────────

/**
 * Resposta de `client.getStatus()` — verifica versão do CLI e compatibilidade de protocolo. Campos: `version` (string,
 * ex: `"1.0.0"`), `protocolVersion` (number).
 *
 * @typedef {import('@github/copilot-sdk').GetStatusResponse} GetStatusResponse
 */

/**
 * Resposta de `client.getAuthStatus()` — verifica autenticação do usuário no GitHub Copilot. Campos: `isAuthenticated`
 * (bool), `authType?` (`"user"` | `"env"` | `"gh-cli"` | `"hmac"` | `"api-key"` | `"token"` | `"copilot-api-token"`),
 * `host?`, `login?`, `statusMessage?`.
 *
 * @typedef {import('@github/copilot-sdk').GetAuthStatusResponse} GetAuthStatusResponse
 */

// ─── Extension Subpath ────────────────────────────────────────────────────────

/**
 * Configuração para `joinSession()` do subpath `@github/copilot-sdk/extension`. Equivalente a
 * `Omit<ResumeSessionConfig, "onPermissionRequest"> & { onPermissionRequest?: PermissionHandler }`. Permite adicionar
 * tools/hooks à sessão ativa em foreground sem exigir `onPermissionRequest`.
 *
 * @typedef {import('@github/copilot-sdk/extension').JoinSessionConfig} JoinSessionConfig
 */

// ─── RPC Result Types (projeto-local) ────────────────────────────────────────
// Tipos de retorno das chamadas RPC do sdk/rpc-ops.js e sdk/rpc-session.js.
// Não são exportados pelo SDK — definidos localmente com base nos contratos observados em
// node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts.

/**
 * Resultado de `shell.exec()` — contém `processId`, `stdout`, `stderr`, `exitCode`.
 *
 * @typedef {{ processId: string; stdout?: string; stderr?: string; exitCode?: number; [k: string]: unknown }} ShellExecResult
 */

/**
 * Resultado de `shell.kill()` — confirmação de sinal enviado.
 *
 * @typedef {{ killed: boolean; [k: string]: unknown }} ShellKillResult
 */

/**
 * Resultado local legado de `ui.elicitation()` em wrappers RPC antigos.
 *
 * @typedef {{ action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown>; [k: string]: unknown }} RpcElicitationResult
 */

/**
 * Resultado genérico de handlers RPC (commands, permissions, tools).
 *
 * @typedef {{ success: boolean; [k: string]: unknown }} HandleResult
 */

/**
 * Resultado de `model.getCurrent()` — modelo ativo da sessão.
 *
 * @typedef {{ modelId: string; [k: string]: unknown }} ModelCurrentResult
 */

/**
 * Resultado de `model.switchTo()` — confirmação de troca de modelo.
 *
 * @typedef {{ modelId: string; [k: string]: unknown }} ModelSwitchResult
 */

/**
 * Modo atual da sessão (projeto-local — não exportado diretamente pelo SDK).
 *
 * @typedef {'interactive' | 'plan' | 'autopilot'} SessionMode
 */

/**
 * Resultado de `mode.get()` / `mode.set()` — modo atual após a operação.
 *
 * @typedef {{ mode: SessionMode; [k: string]: unknown }} ModeResult
 */

/**
 * Resultado de `plan.read()` — conteúdo do `plan.md` da sessão.
 *
 * @typedef {{ exists: boolean; content: string | null; path: string | null; [k: string]: unknown }} PlanReadResult
 */

/**
 * Resultado de `workspace.listFiles()` — lista de arquivos no workspace.
 *
 * @typedef {{ files: string[]; [k: string]: unknown }} WorkspaceListResult
 */

/**
 * Resultado de `workspace.readFile()` — conteúdo de um arquivo do workspace.
 *
 * @typedef {{ content: string; [k: string]: unknown }} WorkspaceReadResult
 */

/**
 * Resultado de `session.log()` — confirmação de log emitido.
 *
 * @typedef {{ eventId: string; [k: string]: unknown }} LogResult
 */

/**
 * Relatório canônico de preflight do SDK/CLI executado no boot.
 *
 * @typedef {object} CopilotSdkBootPreflightReport
 * @property {boolean} ok
 * @property {boolean} pingOk
 * @property {boolean | null} authenticated
 * @property {string | null} modelConfigured
 * @property {boolean | null} modelValidated
 * @property {string[]} warnings
 * @property {string[]} errors
 */

// ─── Loose-typed SDK interfaces (projeto-local) ───────────────────────────────
// Interfaces com assinaturas relaxadas para wrappers dinâmicos que precisam aceitar
// strings arbitrárias em lugar de literal unions (necessário em event-wirer.js, etc.).

/**
 * Interface loose-typed para `CopilotSession.on()`. Permite `.on(eventType: string, handler)` sem exigir literal
 * `SessionEventType`. O overload sem eventType registra handler para todos os eventos e retorna unsubscribe function.
 *
 * @typedef {object} SessionEventSubscriber
 * @property {((eventType: string, handler: (event: SessionEvent) => void) => () => void) &
 *     ((handler: (event: SessionEvent) => void) => () => void)} on
 */

/**
 * Interface loose-typed para `CopilotClient.on()`. Permite `.on(eventType: string, handler)` sem exigir literal
 * `SessionLifecycleEventType`.
 *
 * @typedef {object} ClientEventSubscriber
 * @property {((eventType: string, handler: (event: SessionLifecycleEvent) => void) => () => void) &
 *     ((handler: (event: SessionLifecycleEvent) => void) => () => void)} on
 */

/**
 * Interface para namespace RPC experimental do SDK. Cobre namespaces `fleet`, `skills`, `mcp`, `plugins`, `extensions`.
 * Alinhado com `createSessionRpc()` do SDK.
 *
 * Cada namespace usa apenas um subconjunto dos métodos. O typedef é uma union de todos os métodos possíveis para
 * simplificar o cast — cada função wrapper já valida feature flag e sessão antes de invocar.
 *
 * @typedef {object} ExperimentalRpcNamespace
 * @property {(params?: Record<string, unknown>) => Promise<unknown>} [start]
 * @property {(params?: Record<string, unknown>) => Promise<unknown>} [list]
 * @property {(params?: Record<string, unknown>) => Promise<unknown>} [getCurrent]
 * @property {(params?: Record<string, unknown>) => Promise<unknown>} [enable]
 * @property {(params?: Record<string, unknown>) => Promise<unknown>} [disable]
 * @property {(params?: Record<string, unknown>) => Promise<unknown>} [select]
 * @property {(params?: Record<string, unknown>) => Promise<unknown>} [deselect]
 * @property {(params?: Record<string, unknown>) => Promise<unknown>} [reload]
 * @property {(params?: Record<string, unknown>) => Promise<unknown>} [truncate]
 * @property {(params?: Record<string, unknown>) => Promise<unknown>} [getMetrics]
 * @property {(params?: Record<string, unknown>) => Promise<unknown>} [login]
 * @property {ExperimentalRpcNamespace} [oauth]
 */

/**
 * Sessão com surface de RPC experimental. Campo `rpc` expõe namespaces experimentais do SDK.
 *
 * @typedef {object} ExperimentalSession
 * @property {{
 *     fleet: ExperimentalRpcNamespace;
 *     skills: ExperimentalRpcNamespace;
 *     mcp: ExperimentalRpcNamespace;
 *     plugins: ExperimentalRpcNamespace;
 *     extensions: ExperimentalRpcNamespace;
 *     history: ExperimentalRpcNamespace;
 *     usage: ExperimentalRpcNamespace;
 * }} rpc
 */

// ─── Runtime re-exports (non-type) ───────────────────────────────────────────
// Nota: `defineTool`, `approveAll`, `SYSTEM_PROMPT_SECTIONS` são runtime values.
// Re-exportados no barrel sdk/index.js — consumers de runtime DEVEM usar #copilot/sdk.

export {};
