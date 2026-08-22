// @ts-check
/**
 * src/copilot/hooks/types.js
 *
 * Centraliza todos os typedefs do sistema de hooks do Copilot SDK.
 *
 * Este módulo é puro: apenas tipos/JSDoc, zero lógica executável. Importar aqui para tipagem; importar de index.js para
 * a API.
 *
 * @module copilot/hooks/types
 * @see EventBus
 */

// ─── Re-exports de tipos do SDK (via sdk/types.js como fonte canônica) ──────

/**
 * @typedef {import('#copilot/sdk/types').PermissionHandler} PermissionHandler
 *
 * @typedef {import('#copilot/sdk/types').PermissionRequest} PermissionRequest
 *
 * @typedef {import('#copilot/sdk/types').PermissionRequestResult} PermissionRequestResult
 */

// ─── Tipos dos 6 hooks SDK ────────────────────────────────────────────────────

/**
 * Conjunto de hooks para uma sessão Copilot SDK.
 *
 * @typedef {import('#copilot/sdk/types').SessionHooks} SessionHooks
 */

/**
 * @callback PreToolUseHandler
 * @param {PreToolUseHookInput} input
 * @param {InvocationContext} invocation
 * @returns {Promise<PreToolUseHookOutput | void> | PreToolUseHookOutput | void}
 */

/**
 * @typedef {import('#copilot/sdk/types').PreMcpToolCallHandler} PreMcpToolCallHandler
 */

/**
 * @callback PostToolUseHandler
 * @param {PostToolUseHookInput} input
 * @param {InvocationContext} invocation
 * @returns {Promise<PostToolUseHookOutput | void> | PostToolUseHookOutput | void}
 */

/**
 * @typedef {import('#copilot/sdk/types').PostToolUseFailureHandler} PostToolUseFailureHandler
 */

/**
 * @callback UserPromptSubmittedHandler
 * @param {UserPromptSubmittedHookInput} input
 * @param {InvocationContext} invocation
 * @returns {Promise<UserPromptSubmittedHookOutput | void> | UserPromptSubmittedHookOutput | void}
 */

/**
 * @callback SessionStartHandler
 * @param {SessionStartHookInput} input
 * @param {InvocationContext} invocation
 * @returns {Promise<SessionStartHookOutput | void> | SessionStartHookOutput | void}
 */

/**
 * @callback SessionEndHandler
 * @param {SessionEndHookInput} input
 * @param {InvocationContext} invocation
 * @returns {Promise<SessionEndHookOutput | void> | SessionEndHookOutput | void}
 */

/**
 * @callback ErrorOccurredHandler
 * @param {ErrorOccurredHookInput} input
 * @param {InvocationContext} invocation
 * @returns {Promise<ErrorOccurredHookOutput | void> | ErrorOccurredHookOutput | void}
 */

// ─── Inputs dos hooks ─────────────────────────────────────────────────────────

/**
 * @typedef {object} BaseHookInput
 * @property {string} [sessionId]
 * @property {Date | number} timestamp
 * @property {string} [workingDirectory]
 * @property {string} [cwd] Alias legado local para `workingDirectory`.
 */

/**
 * @typedef {import('#copilot/sdk/types').PreToolUseHookInput} PreToolUseHookInput
 */

/**
 * @typedef {object} PreMcpToolCallHookInput
 * @property {string} [sessionId]
 * @property {string} [toolCallId]
 * @property {string} serverName
 * @property {string} toolName
 * @property {unknown} arguments
 * @property {Record<string, unknown>} [_meta]
 * @property {Date | number} timestamp
 * @property {string} [workingDirectory]
 * @property {string} [cwd]
 * @property {string} [traceparent]
 * @property {string} [tracestate]
 */

/**
 * @typedef {object} PostToolUseHookInput
 * @property {string} [sessionId]
 * @property {string} toolName
 * @property {unknown} toolArgs
 * @property {import('#copilot/sdk/types').ToolResultObject} toolResult
 * @property {Date | number} timestamp
 * @property {string} [workingDirectory]
 * @property {string} [cwd]
 * @property {string} [traceparent]
 * @property {string} [tracestate]
 */

/**
 * @typedef {object} PostToolUseFailureHookInput
 * @property {string} [sessionId]
 * @property {string} toolName
 * @property {unknown} toolArgs
 * @property {string} error
 * @property {Date | number} timestamp
 * @property {string} [workingDirectory]
 * @property {string} [cwd]
 * @property {string} [traceparent]
 * @property {string} [tracestate]
 */

/**
 * @typedef {object} UserPromptSubmittedHookInput
 * @property {string} prompt
 * @property {Date | number} timestamp
 * @property {string} [workingDirectory]
 * @property {string} [cwd]
 */

/**
 * @typedef {object} SessionStartHookInput
 * @property {'startup' | 'resume' | 'new'} source
 * @property {string} [initialPrompt]
 * @property {Date | number} timestamp
 * @property {string} [workingDirectory]
 * @property {string} [cwd]
 */

/**
 * @typedef {object} SessionEndHookInput
 * @property {'complete' | 'error' | 'abort' | 'timeout' | 'user_exit'} reason
 * @property {string} [finalMessage]
 * @property {string} [error]
 * @property {Date | number} timestamp
 * @property {string} [workingDirectory]
 * @property {string} [cwd]
 */

/**
 * @typedef {import('#copilot/sdk/types').ErrorOccurredHookInput} ErrorOccurredHookInput
 */

/**
 * @typedef {object} InvocationContext
 * @property {string} sessionId
 * @property {string} [agentName]
 * @property {{ name?: string }} [agent]
 */

// ─── Outputs dos hooks ────────────────────────────────────────────────────────

/**
 * @typedef {object} PreMcpToolCallHookOutput
 * @property {Record<string, unknown> | null} [metaToUse]
 */

/**
 * @typedef {object} PreToolUseHookOutput
 * @property {'allow' | 'deny' | 'ask'} [permissionDecision]
 * @property {string} [permissionDecisionReason] - Razão legível da decisão
 * @property {unknown} [modifiedArgs] - Args modificados para substituir os originais
 * @property {string} [additionalContext] - Contexto adicional injetado no modelo
 * @property {boolean} [suppressOutput] - Solicita supressão da saída do hook/tool
 */

/**
 * @typedef {object} PostToolUseFailureHookOutput
 * @property {string} [additionalContext] - Contexto adicional injetado no modelo após falha de tool
 */

/**
 * @typedef {object} PostToolUseHookOutput
 * @property {import('#copilot/sdk/types').ToolResultObject} [modifiedResult] - Resultado modificado pelo hook
 * @property {string} [additionalContext] - Contexto adicional injetado no modelo
 * @property {boolean} [suppressOutput] - Solicita supressão da saída do hook/tool
 */

/**
 * @typedef {object} UserPromptSubmittedHookOutput
 * @property {string} [modifiedPrompt] - Prompt modificado para substituir o original
 * @property {string} [additionalContext] - Contexto adicional injetado no modelo
 * @property {boolean} [suppressOutput] - Solicita supressão da saída do hook/tool
 */

/**
 * @typedef {object} SessionStartHookOutput
 * @property {string} [additionalContext] - Contexto adicional injetado no modelo ao iniciar
 * @property {Record<string, unknown>} [modifiedConfig] - Config complementar sugerida pelo hook
 */

/**
 * @typedef {object} SessionEndHookOutput
 * @property {boolean} [suppressOutput] - Solicita supressão da saída do encerramento
 * @property {string[]} [cleanupActions] - Ações de cleanup executadas/solicitadas
 * @property {string} [sessionSummary] - Sumário textual opcional da sessão
 */

/**
 * @typedef {object} ErrorOccurredHookOutput
 * @property {boolean} [suppressOutput] - Solicita supressão da saída do erro
 * @property {'retry' | 'skip' | 'abort'} [errorHandling]
 * @property {number} [retryCount]
 * @property {string} [userNotification] - Texto opcional recomendado ao operador/usuário
 */

// ─── Tipos da factory createHooks ────────────────────────────────────────────

/**
 * @typedef {object} HooksConfig
 * @property {boolean} [auditLog] - Loga todos os eventos em DEBUG. Default: false
 * @property {boolean} [debugTools] - Loga tools em DEBUG mesmo sem auditLog completo. Default: false
 * @property {string[]} [allowTools] - Whitelist de tools permitidas (deny se ausente)
 * @property {string[]} [denyTools] - Blacklist com precedência sobre allowTools
 * @property {RegExp[]} [denyPatterns] - Padrões regex: match → deny
 * @property {(toolName: string) => Promise<boolean>} [onPermissionAsk] - Callback de aprovação interativa para tools
 *   não listadas em allowTools/denyTools
 * @property {(toolName: string, args: object) => object | null | undefined} [argsModifier] - Callback para modificar
 *   args antes da execução. Retornar null/undefined para não modificar.
 * @property {PreToolUseHandler} [onPreToolUse] - Override completo do handler pré-tool
 * @property {PreMcpToolCallHandler} [onPreMcpToolCall] - Override do handler pré-MCP tool
 * @property {PostToolUseHandler} [onPostToolUse] - Override completo do handler pós-tool
 * @property {PostToolUseFailureHandler} [onPostToolUseFailure] - Override do handler pós-falha de tool
 * @property {UserPromptSubmittedHandler} [onUserPromptSubmitted] - Override do handler de prompt
 * @property {SessionStartHandler} [onSessionStart] - Override do handler de início de sessão
 * @property {SessionEndHandler} [onSessionEnd] - Override do handler de encerramento de sessão
 * @property {ErrorOccurredHandler} [onErrorOccurred] - Override do handler de erro
 * @property {import('./bus.js').HookBus} [bus] - HookBus para emissão de eventos de observação
 */

// ─── Tipos de PermissionHandler ───────────────────────────────────────────────

/**
 * Valor de decisão retornado pelo callback onRequest:
 *
 * - `true` - aprovado
 * - `false` ou `'deny'` - negado (denied-by-rules)
 * - `PermissionRequestResult` - resultado canônico do SDK, repassado sem tradução
 * - `undefined` - delega a lógica padrão do createPermissionHandler
 *
 * @callback OnPermissionRequestCallback
 * @param {PermissionRequest} request
 * @param {{ sessionId: string }} invocation
 * @returns {Promise<boolean | 'deny' | PermissionRequestResult | undefined>
 *     | boolean
 *     | 'deny'
 *     | PermissionRequestResult
 *     | undefined}
 */

/**
 * @typedef {object} PermissionHandlerConfig
 * @property {boolean} [allowAll] - Aprovar todas as requisições
 * @property {string[]} [allowTools] - Whitelist: apenas estas tools são aprovadas
 * @property {PermissionRequest['kind'][]} [denyKinds] - Blacklist por tipo canônico do SDK, ex.: `shell` ou `write`
 * @property {string[]} [denyTools] - Blacklist de tools negadas
 * @property {RegExp[]} [denyPatterns] - Regex: tools cujo nome corresponder são negadas
 * @property {boolean} [auditMode] - Loga cada decisão sem alterar o resultado
 * @property {OnPermissionRequestCallback} [onRequest] - Callback com precedência total
 */

// ─── Tipos do UserInputHandler ────────────────────────────────────────────────

/**
 * @typedef {object} UserInputRequest
 * @property {string} question
 * @property {string[]} [choices]
 * @property {boolean} [allowFreeform]
 */

/**
 * @typedef {object} UserInputResponse
 * @property {string} answer
 * @property {boolean} wasFreeform
 */

/**
 * @callback UserInputHandler
 * @param {UserInputRequest} request
 * @param {InvocationContext} invocation
 * @returns {Promise<UserInputResponse>}
 */

/**
 * @typedef {object} UserInputHandlerConfig
 * @property {(question: string, choices?: string[]) => Promise<string>} [resolver] - Resolver customizado
 * @property {number} [timeout] - Timeout em ms (default: 30000)
 * @property {string} [fallback] - Resposta de fallback se timeout
 */

// ─── Tipos do HookBus ─────────────────────────────────────────────────────────

/**
 * @typedef {object} HookBusEvent
 * @property {string} hookName - Nome do hook (ex: 'pre_tool_use')
 * @property {string} sessionId
 * @property {number} timestamp
 * @property {unknown} input
 * @property {unknown} [output]
 */

// ─── Tipos do HookRegistry ────────────────────────────────────────────────────

/**
 * @typedef {object} HookSchema
 * @property {string} name
 * @property {string} description
 * @property {string[]} inputFields
 * @property {string[]} outputFields
 * @property {boolean} canModifyInput - Se o hook pode modificar o input original
 * @property {boolean} canAbort - Se o hook pode abortar a operação
 */

// ─── Tipos do Composer ────────────────────────────────────────────────────────

/**
 * Middleware genérico de pipeline de hooks.
 *
 * @template TInput, TOutput
 * @callback HookMiddleware
 * @param {TInput} input
 * @param {InvocationContext} invocation
 * @param {(input: TInput, invocation: InvocationContext) => Promise<TOutput | void>} next
 * @returns {Promise<TOutput | void>}
 */

// ─── Tipos do SessionLifecycle ────────────────────────────────────────────────

/**
 * Dependências injetadas para o factory de session lifecycle hooks.
 *
 * @typedef {object} SessionLifecycleContext
 * @property {(event: string, payload: object) => Promise<void>} emitWebhook
 * @property {() => string | undefined} getModel
 * @property {(fallbackModel: string) => void} scheduleFallback
 * @property {(event: string, payload: object) => void} emit
 * @property {() => object} [getContextSnapshot] - Opcional: retorna snapshot de contexto para additionalContext
 * @property {{ recordSessionStart: () => void; recordSessionEnd: () => void }} [metrics]
 *
 *   - Opcional: coletor de métricas injetado pela camada superior (agent/, server/).
 */

// ─── Tipos do Audit (Gap 10) ──────────────────────────────────────────────────

/**
 * Entrada de auditoria de uma chamada de ferramenta SDK capturada via `onPostToolUse`.
 *
 * @typedef {object} AuditEntry
 * @property {string} toolName - Nome da ferramenta invocada
 * @property {unknown} toolArgs - Argumentos recebidos pela ferramenta
 * @property {unknown} toolResult - Resultado retornado pela ferramenta
 * @property {string} sessionId - Identificador da sessão Copilot SDK
 * @property {string} ts - Timestamp ISO 8601 da captura
 * @property {number} durationMs - Duração aproximada da execução (ms) se disponível; 0 caso contrário
 */

/**
 * Configuração do `AuditRingBuffer`.
 *
 * @typedef {object} AuditRingBufferConfig
 * @property {number} [capacity] - Tamanho máximo do buffer (default: 500)
 */

export {};
