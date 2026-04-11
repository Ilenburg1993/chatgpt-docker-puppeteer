// @ts-check
/**
 * src/copilot/core/error-handlers.js
 *
 * Utilitários padronizados para tratamento de erros em catch blocks.
 *
 * - `logSwallowed(err, context)` — loga (DEBUG) + registra no ErrorTracker sem rethrow
 * - `wrapAsync(fn, context)` — wrapper que captura, loga via logSwallowed e retorna undefined
 * - `isFatalError(err)` — classifica erros em fatal vs recoverable
 * - `isTransientError(err)` — identifica erros retriáveis (rede, timeout, 502/503)
 *
 * @module copilot/core/error-handlers
 */

import { CircuitOpenError } from './circuit-breaker.js';
import { BridgeError, CopilotError } from './errors.js';

// ─── Handlers injetáveis (bootstrap via observability/bootstrap.js) ───────────

/**
 * @typedef {'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'} CoreLogLevel
 */

/**
 * @typedef {object} ErrorHandlerDeps
 * @property {(level: CoreLogLevel, msg: string) => void} log - Função de log.
 * @property {{ trackError: (err: unknown, opts?: Record<string, unknown>) => unknown }} tracker - ErrorTracker.
 */

/** @type {ErrorHandlerDeps} */
let _deps = {
    log: (_level, msg) => console.error('[core:error-handlers]', msg), // fallback mínimo
    tracker: { trackError: () => undefined },
};

/**
 * Registra as dependências de log e tracking para error-handlers.
 * Deve ser chamado pelo observability bootstrap antes de qualquer uso em runtime.
 *
 * @param {ErrorHandlerDeps} deps
 * @returns {void}
 */
export function registerErrorHandlerDeps(deps) {
    _deps = deps;
}

/** @returns {ErrorHandlerDeps} */
export function getErrorHandlerDeps() {
    return _deps;
}

// ─── logSwallowed ─────────────────────────────────────────────────────────────

/**
 * Loga um erro silenciado com nível DEBUG e registra no ErrorTracker. Substitui catches comment-only que perdem
 * informação de diagnóstico.
 *
 * @param {unknown} err - Erro capturado (pode ser qualquer coisa).
 * @param {string} context - Identificador do local (ex: 'tool:git_status', 'bridge.mcp.connect').
 * @returns {void}
 */
export function logSwallowed(err, context) {
    const message = err instanceof Error ? err.message : String(err);
    _deps.log('DEBUG', `[swallowed:${context}] ${message}`);
    _deps.tracker.trackError(err, { source: `swallowed:${context}` });
}

// ─── wrapAsync ────────────────────────────────────────────────────────────────

/**
 * Envolve uma função async para capturar erros e logá-los via logSwallowed. Retorna undefined em caso de erro — uso
 * para operações best-effort.
 *
 * @template T
 * @param {() => Promise<T>} fn - Função async a executar.
 * @param {string} context - Identificador do local para logging.
 * @returns {Promise<T | undefined>}
 */
export async function wrapAsync(fn, context) {
    try {
        return await fn();
    } catch (err) {
        logSwallowed(err, context);
        return undefined;
    }
}

// ─── isFatalError ─────────────────────────────────────────────────────────────

/** @type {ReadonlySet<string>} */
const FATAL_CODES = new Set(['SESSION_FATAL', 'ERR_SOCKET_CLOSED', 'ERR_IPC_CHANNEL_CLOSED', 'ERR_IPC_DISCONNECTED']);

/**
 * Determina se um erro é fatal (irrecuperável) e deve causar shutdown/session.fatal.
 *
 * Fatal:
 *
 * - `SessionError` com code `SESSION_FATAL`
 * - `CircuitOpenError` (circuit breaker aberto)
 * - Erros com codes de socket/IPC fechado
 *
 * @param {unknown} err - Erro a classificar.
 * @returns {boolean} `true` se o erro é fatal.
 */
export function isFatalError(err) {
    if (err instanceof CircuitOpenError) return true;
    if (err instanceof CopilotError && typeof err.code === 'string' && FATAL_CODES.has(err.code)) return true;
    if (err instanceof Error) {
        const code = /** @type {any} */ (err).code;
        if (typeof code === 'string' && FATAL_CODES.has(code)) return true;
    }
    return false;
}

// ─── isTransientError ─────────────────────────────────────────────────────────

/** @type {ReadonlySet<string>} */
const TRANSIENT_CODES = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'EAI_AGAIN',
    'UND_ERR_CONNECT_TIMEOUT',
    'TIMEOUT',
]);

/** @type {ReadonlySet<number>} */
const TRANSIENT_HTTP_CODES = new Set([429, 502, 503, 504]);

/**
 * Determina se um erro é transiente e pode ser retriado.
 *
 * Transiente:
 *
 * - `BridgeError` (erros de comunicação externa)
 * - Erros com codes de rede (`ECONNREFUSED`, `ETIMEDOUT`, etc.)
 * - Erros HTTP com status 429, 502, 503, 504
 *
 * @param {unknown} err - Erro a classificar.
 * @returns {boolean} `true` se o erro é transiente.
 */
export function isTransientError(err) {
    if (err instanceof BridgeError) return true;
    if (err instanceof Error) {
        const code = /** @type {any} */ (err).code;
        if (typeof code === 'string' && TRANSIENT_CODES.has(code)) return true;
        const status = /** @type {any} */ (err).status ?? /** @type {any} */ (err).statusCode;
        if (typeof status === 'number' && TRANSIENT_HTTP_CODES.has(status)) return true;
    }
    return false;
}
