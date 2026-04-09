// @ts-check
/**
 * src/copilot/routes/middleware.js
 *
 * Middlewares Express compartilhados pelas rotas SDK.
 *
 * @module copilot/routes/middleware
 */

import { CopilotError } from '#copilot/core/errors';
import { log } from '#copilot/observability/logger';

/**
 * F245.3: Mapa de CopilotError subclasses → HTTP status codes.
 *
 * @type {ReadonlyMap<string, number>}
 */
const ERROR_STATUS_MAP = new Map([
    ['ValidationError', 400],
    ['ConfigError', 400],
    ['ToolError', 422],
    ['SessionError', 409],
    ['TimeoutError', 504],
    ['CircuitOpenError', 503],
    ['BridgeError', 502],
    ['StateTransitionError', 409],
]);

/**
 * F245.3: Resolve HTTP status code a partir de uma instância de erro.
 *
 * @param {unknown} err
 * @returns {number}
 */
function resolveHttpStatus(err) {
    if (err instanceof CopilotError) {
        return ERROR_STATUS_MAP.get(err.name) ?? 500;
    }
    return 500;
}

/**
 * F245.2: Resolve error code string a partir de erro.
 *
 * @param {unknown} err
 * @returns {string}
 */
function resolveErrorCode(err) {
    if (err instanceof CopilotError && typeof err.code === 'string') {
        return err.code;
    }
    return 'INTERNAL_ERROR';
}

/**
 * F136: Sanitiza mensagem de erro para resposta HTTP — strip stack traces e paths internos.
 *
 * @param {string} message
 * @returns {string}
 */
function sanitizeErrorMessage(message) {
    if (process.env.NODE_ENV === 'production') {
        return 'Internal server error';
    }
    // Mesmo em dev, remover paths absolutos do sistema
    return message.replace(/\/workspaces\/[^\s)]+/g, '<workspace>').replace(/\/home\/[^\s)]+/g, '<home>');
}

/**
 * Wrapper que captura erros assíncronos e retorna resposta 500 padronizada.
 *
 * @param {string} prefix - Prefixo para a mensagem de log (ex: 'sdk-api/agent')
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<void>}
 */
export async function withErrorHandler(prefix, req, res, fn) {
    try {
        await fn();
    } catch (/** @type {any} */ e) {
        const status = resolveHttpStatus(e);
        const code = resolveErrorCode(e);
        log('ERROR', `[${prefix}] ${req.method} ${req.path} → ${status} ${code}: ${e.message}`);
        if (!res.headersSent) {
            res.status(status).json({ ok: false, error: sanitizeErrorMessage(e.message), code, status });
        }
    }
}
