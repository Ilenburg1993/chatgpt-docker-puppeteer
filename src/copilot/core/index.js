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
 * | **Constantes**     | AGENT_EVENTS, DIALOG_LOOP_EVENTS, etc. (via constants.js)      |
 * | **Structured msg** | StructuredMessage schema, builders, serializers, parser        |
 * | **Timers**         | registerTimer, cancelTimer, cancelAllTimers, activeTimerCount  |
 *
 * @module copilot/core
 *
 * @example
 *     ```js
 *     import { CopilotError, AGENT_EVENTS } from '#copilot/core';
 *     import { LLM_B_TERMINAL_PORT } from '#copilot/config';
 *     import { buildStructuredRequest } from '#copilot/core';
 *     ```;
 */

export { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';
/** @typedef {import('../events/agent-events.js').AgentEventName} AgentEventName */
export * as ErrorCodes from './error-codes.js';
export { isFatalError, isTransientError, logSwallowed, toError, toExecError, wrapAsync } from './error-handlers.js';
export * from './errors.js';
export { withRetry, withTimeout } from './retry.js';
export { parseJsonOrThrow, safeJsonParse, safeJsonStringify } from './safe-json.js';
export * from './schemas.js';
export { SHUTDOWN_PRIORITY } from './shutdown-priorities.js';
export {
    getLastShutdownReport,
    getShutdownLifecycleMetrics,
    isShuttingDown,
    listShutdownHandlers,
    registerShutdownHandler,
    runShutdown,
    setShutdownEventEmitter,
    setShutdownLogger,
} from './shutdown.js';
export * from './structured-message.js';
export {
    activeCount as activeTimerCount,
    cancelAll as cancelAllTimers,
    cancel as cancelTimer,
    listActiveTimers,
    registerInterval,
    registerTimeout,
    registerTimer,
    sleepMs,
} from './timer-registry.js';
export { TOOL_NAME_RE, sanitizeToolNames } from './tool-name-policy.js';

// ─── DI Container ─────────────────────────────────────────────────────────────
export { container } from './di-container.js';
export * from './di-tokens.js';
export { createContainer, createToken } from './di.js';

// ─── Event Bus ────────────────────────────────────────────────────────────────
export { EventBus, bridgeEmitter, createEventBus } from './event-bus.js';

// ─── Security ─────────────────────────────────────────────────────────────────
export {
    checkResolvedIp,
    isPrivateIp,
    validateUrl,
    validateUrlString,
    validateWebhookUrl,
} from './security/url-validator.js';

// ─── Shared State ─────────────────────────────────────────────────────────────
export {
    clearSharedSessionBinding,
    getHubSessionId,
    getSharedSdkSessionId,
    getSharedSessionBinding,
    setSharedHubSessionId,
    setSharedSdkSessionId,
} from './shared-state.js';

// ─── Cache ────────────────────────────────────────────────────────────────────
export { createCache } from './cache.js';
export {
    IO_POLICY_VERSION,
    buildIoMeta,
    createIoTraceId,
    ioFail,
    ioOk,
    toIoError,
    withIoMeta,
} from './io-contracts.js';
export {
    DEFAULT_BLOCKED_PATH_SEGMENTS,
    DEFAULT_BLOCKED_READ_PATH_PATTERNS,
    DEFAULT_BLOCKED_WRITE_PATH_PATTERNS,
    IO_POLICY_VERSION as IO_PATH_POLICY_VERSION,
    IO_URL_MAX_REDIRECTS,
    evaluateIoPathPolicy,
    evaluateIoPathPolicyAsync,
    evaluateIoUrlPolicy,
    resolveIoAdvisoryLimits,
    sanitizeIoTextOutput,
} from './io-policy.js';
export {
    CANONICAL_LOCAL_EXEC_TOOL_NAMES,
    CANONICAL_LOCAL_FS_TOOL_NAMES,
    COMPAT_SDK_LOCAL_FS_TOOL_NAMES,
    LEGACY_SDK_LOCAL_FS_TOOL_NAMES,
    LEGACY_SDK_SHELL_TOOL_NAMES,
    buildCanonicalLocalFsExcludedTools,
    buildCanonicalLocalSurfaceExcludedTools,
    decideSdkFsRouting,
    hasCanonicalLocalExecTools,
    hasCanonicalLocalFsTools,
} from './sdk-fs-routing.js';

export { normalizeUserInputBridgeContract } from './tool-contracts.js';

// ─── Timeouts ─────────────────────────────────────────────────────────────────
export {
    computeAdaptiveDialogTimeout,
    computeAdaptiveTransportTimeout,
    resolveOptionalDialogTimeout,
    resolveOptionalTransportTimeout,
} from './dialog-timeout-policy.js';

// ─── Mutex ────────────────────────────────────────────────────────────────────
export { createMutex, createMutexPool, withMutex } from './mutex.js';

// ─── Interfaces (AC-5 — Faixa 3.2) ───────────────────────────────────────────
export {} from './interfaces.js'; // tipagens puras — zero runtime, usado via @typedef JSDoc
