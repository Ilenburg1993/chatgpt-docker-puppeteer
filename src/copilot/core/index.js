// @ts-check
/**
 * src/copilot/core/index.js
 *
 * Barrel — ponto de entrada único para todos os contratos centrais do módulo copilot.
 *
 * Sub-módulos disponíveis:
 *
 * - `constants` — portas, limites e nomes de eventos canônicos
 * - `errors` — CopilotError, SessionError, BridgeError, ConfigError, ToolError
 * - `structured-message` — StructuredMessage schema, builders, serializers, parser
 * - `sdk-types` — JSDoc typedefs para SDK (@github/copilot-sdk)
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
export * from './constants.js';
export { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';
export * as ErrorCodes from './error-codes.js';
export * from './errors.js';
export { withRetry } from './retry.js';
export { parseJsonOrThrow, safeJsonParse, safeJsonStringify } from './safe-json.js';
export * from './schemas.js';
export { isShuttingDown, registerShutdownHandler, runShutdown } from './shutdown.js';
export * from './structured-message.js';
export { registerTimer, cancel as cancelTimer, cancelAll as cancelAllTimers, activeCount as activeTimerCount } from './timer-registry.js';
