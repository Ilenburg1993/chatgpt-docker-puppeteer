// @ts-check
/**
 * src/copilot/core/index.js — [L0] Utilitários puros, zero dependências internas.
 *
 * Barrel — ponto de entrada único para contratos centrais do módulo copilot. Nenhum módulo externo deve importar
 * sub-arquivos diretamente; use este barrel.
 *
 * ### Categorias de exports
 *
 * | Categoria          | Exports                                                        |
 * | ------------------ | -------------------------------------------------------------- |
 * | **Erros**          | CopilotError, SessionError, BridgeError, ToolError, ErrorCodes |
 * | **Resiliência**    | withRetry, withTimeout, CircuitBreaker, CircuitOpenError       |
 * | **Error handling** | isFatalError, isTransientError, logSwallowed, wrapAsync        |
 * | **Shutdown**       | registerShutdownHandler, runShutdown, isShuttingDown           |
 * | **JSON**           | safeJsonParse, safeJsonStringify, parseJsonOrThrow             |
 * | **Schemas**        | Zod schemas canônicos (via schemas.js)                         |
 * | **Constantes**     | LLM_B_TERMINAL_PORT, AGENT_EVENTS, etc. (via constants.js)     |
 * | **Structured msg** | StructuredMessage schema, builders, serializers, parser        |
 * | **Timers**         | registerTimer, cancelTimer, cancelAllTimers, activeTimerCount  |
 *
 * @module copilot/core
 *
 * @example
 *     ```js
 *     import { LLM_B_TERMINAL_PORT, CopilotError, AGENT_EVENTS } from '#copilot/core';
 *     import { buildStructuredRequest } from '#copilot/core/structured-message';
 *     ```;
 */

export { withTimeout } from './abort-utils.js';
export { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';
export * from './constants.js';
export * as ErrorCodes from './error-codes.js';
export { isFatalError, isTransientError, logSwallowed, wrapAsync } from './error-handlers.js';
export * from './errors.js';
export { withRetry } from './retry.js';
export { parseJsonOrThrow, safeJsonParse, safeJsonStringify } from './safe-json.js';
export * from './schemas.js';
export { isShuttingDown, registerShutdownHandler, runShutdown, setShutdownLogger } from './shutdown.js';
export * from './structured-message.js';
export {
    activeCount as activeTimerCount,
    cancelAll as cancelAllTimers,
    cancel as cancelTimer,
    registerTimer,
} from './timer-registry.js';
