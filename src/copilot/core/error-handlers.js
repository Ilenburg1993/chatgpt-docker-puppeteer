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
 * @see EventBus
 */

import { CircuitOpenError } from './circuit-breaker.js';
import { BridgeError, CopilotError } from './errors.js';

const errorCtor = /** @type {{ isError?: (value: unknown) => boolean }} */ (Error);
const isError =
    typeof errorCtor.isError === 'function'
        ? /** @type {(value: unknown) => boolean} */ (errorCtor.isError.bind(Error))
        : /** @type {(value: unknown) => boolean} */ ((value) => value instanceof Error);

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
 * Registra as dependências de log e tracking para error-handlers. Deve ser chamado pelo observability bootstrap antes
 * de qualquer uso em runtime.
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

// ─── toError ──────────────────────────────────────────────────────────────────

/**
 * Erro normalizado com `.code` opcional (compatível com `NodeJS.ErrnoException`).
 *
 * @typedef {Error & { code?: string | number }} NormalizedError
 */

/**
 * Normaliza um valor desconhecido capturado em `catch` para {@link NormalizedError}. Útil para acessar `.message`,
 * `.stack`, `.code` de forma segura sem recorrer a `@type {any}`.
 *
 * @param {unknown} value - Valor capturado (pode ser string, objeto, etc.).
 * @returns {NormalizedError} Instância de Error garantida (com `.code` quando presente).
 */
export function toError(value) {
    if (isError(value)) {
        return /** @type {NormalizedError} */ (value);
    }
    if (typeof value === 'string') return /** @type {NormalizedError} */ (new Error(value));
    if (typeof value === 'object' && value !== null && 'message' in value) {
        const err = /** @type {NormalizedError} */ (
            new Error(String(/** @type {{ message: unknown }} */ (value).message))
        );
        if ('stack' in value) err.stack = String(/** @type {{ stack: unknown }} */ (value).stack);
        if ('code' in value) err.code = /** @type {string | number} */ (/** @type {{ code: unknown }} */ (value).code);
        return err;
    }
    return /** @type {NormalizedError} */ (new Error(String(value)));
}

// ─── ExecError ────────────────────────────────────────────────────────────────

/**
 * Shape para erros de `child_process.exec/execFile` que incluem `stdout`, `stderr`, `code` e `status`.
 *
 * @typedef {object} ExecError
 * @property {string} message
 * @property {string | undefined} [stdout]
 * @property {string | undefined} [stderr]
 * @property {number | string | undefined} [code]
 * @property {number | undefined} [status]
 * @property {string | undefined} [stack]
 */

/**
 * Normaliza um valor desconhecido capturado em `catch` de `child_process.exec` para `ExecError`. Preserva `.stdout`,
 * `.stderr`, `.code`, `.status`.
 *
 * @param {unknown} value - Valor capturado.
 * @returns {ExecError}
 */
export function toExecError(value) {
    if (isError(value)) {
        const asErr = /** @type {Error} */ (value);
        const v = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (value));
        return {
            message: asErr.message,
            stdout: typeof v['stdout'] === 'string' ? v['stdout'] : undefined,
            stderr: typeof v['stderr'] === 'string' ? v['stderr'] : undefined,
            code: typeof v['code'] === 'number' || typeof v['code'] === 'string' ? v['code'] : undefined,
            status: typeof v['status'] === 'number' ? v['status'] : undefined,
            stack: asErr.stack,
        };
    }
    if (typeof value === 'object' && value !== null) {
        const v = /** @type {Record<string, unknown>} */ (value);
        return {
            message: typeof v['message'] === 'string' ? v['message'] : String(value),
            stdout: typeof v['stdout'] === 'string' ? v['stdout'] : undefined,
            stderr: typeof v['stderr'] === 'string' ? v['stderr'] : undefined,
            code: typeof v['code'] === 'number' || typeof v['code'] === 'string' ? v['code'] : undefined,
            status: typeof v['status'] === 'number' ? v['status'] : undefined,
            stack: typeof v['stack'] === 'string' ? v['stack'] : undefined,
        };
    }
    return { message: String(value) };
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
    const message = isError(err) ? /** @type {Error} */ (err).message : String(err);
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
    if (isError(err)) {
        const code = /** @type {Error & { code?: string }} */ (err).code;
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
    if (isError(err)) {
        const code = /** @type {Error & { code?: string }} */ (err).code;
        if (typeof code === 'string' && TRANSIENT_CODES.has(code)) return true;
        const status =
            /** @type {Error & { status?: number; statusCode?: number }} */ (err).status ??
            /** @type {Error & { status?: number; statusCode?: number }} */ (err).statusCode;
        if (typeof status === 'number' && TRANSIENT_HTTP_CODES.has(status)) return true;
    }
    return false;
}
