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
 */

// ─── Re-exports de tipos do SDK ───────────────────────────────────────────────

/**
 * @typedef {import('@github/copilot-sdk').PermissionHandler} PermissionHandler
 *
 * @typedef {import('@github/copilot-sdk').PermissionRequest} PermissionRequest
 *
 * @typedef {import('@github/copilot-sdk').PermissionRequestResult} PermissionRequestResult
 */

// ─── Tipos dos 6 hooks SDK ────────────────────────────────────────────────────

/**
 * Conjunto de hooks para uma sessão Copilot SDK.
 *
 * @typedef {object} SessionHooks
 * @property {PreToolUseHandler} [onPreToolUse]
 * @property {PostToolUseHandler} [onPostToolUse]
 * @property {UserPromptSubmittedHandler} [onUserPromptSubmitted]
 * @property {SessionStartHandler} [onSessionStart]
 * @property {SessionEndHandler} [onSessionEnd]
 * @property {ErrorOccurredHandler} [onErrorOccurred]
 */

/**
 * @callback PreToolUseHandler
 * @param {PreToolUseHookInput} input
 * @param {InvocationContext} invocation
 * @returns {Promise<PreToolUseHookOutput | void> | PreToolUseHookOutput | void}
 */

/**
 * @callback PostToolUseHandler
 * @param {PostToolUseHookInput} input
 * @param {InvocationContext} invocation
 * @returns {Promise<PostToolUseHookOutput | void> | PostToolUseHookOutput | void}
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
 * @returns {Promise<void> | void}
 */

/**
 * @callback ErrorOccurredHandler
 * @param {ErrorOccurredHookInput} input
 * @param {InvocationContext} invocation
 * @returns {Promise<ErrorOccurredHookOutput | void> | ErrorOccurredHookOutput | void}
 */

// ─── Inputs dos hooks ─────────────────────────────────────────────────────────

/**
 * @typedef {object} PreToolUseHookInput
 * @property {string} toolName
 * @property {object} toolArgs
 * @property {number} timestamp
 * @property {string} cwd
 */

/**
 * @typedef {object} PostToolUseHookInput
 * @property {string} toolName
 * @property {object} toolArgs
 * @property {unknown} toolResult
 * @property {number} timestamp
 * @property {string} cwd
 */

/**
 * @typedef {object} UserPromptSubmittedHookInput
 * @property {string} prompt
 * @property {number} timestamp
 * @property {string} cwd
 */

/**
 * @typedef {object} SessionStartHookInput
 * @property {'startup' | 'resume' | 'new'} source
 * @property {string} [initialPrompt]
 * @property {number} timestamp
 * @property {string} cwd
 */

/**
 * @typedef {object} SessionEndHookInput
 * @property {string} reason
 * @property {string} [finalMessage]
 * @property {Error} [error]
 * @property {number} timestamp
 * @property {string} cwd
 */

/**
 * @typedef {object} ErrorOccurredHookInput
 * @property {Error | string} error
 * @property {string} errorContext
 * @property {boolean} recoverable
 * @property {number} timestamp
 * @property {string} cwd
 */

/**
 * @typedef {object} InvocationContext
 * @property {string} sessionId
 */

// ─── Outputs dos hooks ────────────────────────────────────────────────────────

/**
 * @typedef {object} PreToolUseHookOutput
 * @property {'allow' | 'deny' | 'ask'} [permissionDecision]
 * @property {object} [modifiedArgs] - Args modificados para substituir os originais
 * @property {string} [additionalContext] - Contexto adicional injetado no modelo
 */

/**
 * @typedef {object} PostToolUseHookOutput
 * @property {string} [additionalContext] - Contexto adicional injetado no modelo
 */

/**
 * @typedef {object} UserPromptSubmittedHookOutput
 * @property {string} [modifiedPrompt] - Prompt modificado para substituir o original
 */

/**
 * @typedef {object} SessionStartHookOutput
 * @property {string} [additionalContext] - Contexto adicional injetado no modelo ao iniciar
 */

/**
 * @typedef {object} ErrorOccurredHookOutput
 * @property {'retry' | 'skip' | 'abort'} errorHandling
 * @property {number} [retryCount]
 */

// ─── Tipos da factory createHooks ────────────────────────────────────────────

/**
 * @typedef {object} HooksConfig
 * @property {boolean} [auditLog] - Loga todos os eventos em DEBUG. Default: false
 * @property {boolean} [debugTools] - Loga tools em DEBUG mesmo sem auditLog completo. Default: false
 * @property {string[]} [allowTools] - Whitelist de tools permitidas (deny se ausente)
 * @property {string[]} [denyTools] - Blacklist com precedência sobre allowTools
 * @property {RegExp[]} [denyPatterns] - Padrões regex: match → deny
 * @property {(toolName: string) => Promise<boolean>} [onPermissionAsk] - Callback de aprovação interativa
 * @property {PreToolUseHandler} [onPreToolUse] - Override completo do handler pré-tool
 * @property {PostToolUseHandler} [onPostToolUse] - Override completo do handler pós-tool
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
 * - `undefined` - delega a lógica padrão do createPermissionHandler
 *
 * @callback OnPermissionRequestCallback
 * @param {PermissionRequest} request
 * @returns {Promise<boolean | 'deny' | undefined> | boolean | 'deny' | undefined}
 */

/**
 * @typedef {object} PermissionHandlerConfig
 * @property {boolean} [allowAll] - Aprovar todas as requisições
 * @property {string[]} [allowTools] - Whitelist: apenas estas tools são aprovadas
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
 * @property {() => import('#copilot/lib/telemetry').TelemetryStore} getTelemetry
 * @property {(event: string, payload: object) => Promise<void>} emitWebhook
 * @property {() => string | undefined} getModel
 * @property {(fallbackModel: string) => void} scheduleFallback
 * @property {(event: string, payload: object) => void} emit
 * @property {() => object} [getContextSnapshot] - Opcional: retorna snapshot de contexto para additionalContext
 */
