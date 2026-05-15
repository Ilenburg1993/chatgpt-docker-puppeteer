// @ts-check
/**
 * src/copilot/routes/middleware.js
 *
 * Middlewares Express compartilhados pelas rotas SDK.
 *
 * @module copilot/routes/middleware
 * @see EventBus
 */

import { CopilotError, toError } from '#copilot/core';
import { log } from '#copilot/observability';
import { sanitizeHttpErrorMessage } from '../../middleware/error-handler.js';
import { buildSdkMissingRuntimeRouteMeta, resolveSdkRequestedRuntimeId } from './deps.js';

/**
 * F245.3: Mapa de CopilotError subclasses → HTTP status codes.
 *
 * @type {ReadonlyMap<string, number>}
 */
const ERROR_STATUS_MAP = new Map([
    ['ValidationError', 400],
    ['ConfigError', 400],
    ['NotFoundError', 404],
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
    const status = /** @type {{ status?: unknown }} */ (/** @type {unknown} */ (err)).status;
    if (typeof status === 'number' && Number.isFinite(status)) {
        return status;
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
    const code = /** @type {{ code?: unknown }} */ (/** @type {unknown} */ (err)).code;
    if (typeof code === 'string') {
        return code;
    }
    return 'INTERNAL_ERROR';
}

/**
 * @param {import('express').Request} req
 * @param {unknown} err
 * @returns {{ requestedRuntimeId?: string | null; runtimeFound?: boolean; usedDefaultRuntimeFallback?: boolean }}
 */
export function buildSdkRuntimeErrorMeta(req, err) {
    if (resolveErrorCode(err) !== 'AGENT_RUNTIME_NOT_FOUND') {
        return {};
    }
    return buildSdkMissingRuntimeRouteMeta(resolveSdkRequestedRuntimeId(req));
}

/**
 * @param {import('express').Request} req
 * @param {unknown} err
 * @returns {{
 *     status: number;
 *     body: {
 *         ok: false;
 *         error: string;
 *         code: string;
 *         status: number;
 *         requestedRuntimeId?: string | null;
 *         runtimeFound?: boolean;
 *         usedDefaultRuntimeFallback?: boolean;
 *     };
 * }}
 */
export function projectSdkHttpError(req, err) {
    const status = resolveHttpStatus(err);
    const code = resolveErrorCode(err);
    return {
        status,
        body: {
            ok: false,
            ...buildSdkRuntimeErrorMeta(req, err),
            error: sanitizeHttpErrorMessage(toError(err).message, status),
            code,
            status,
        },
    };
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
    } catch (e) {
        const projection = projectSdkHttpError(req, e);
        const { status, body } = projection;
        const code = body.code;
        log('ERROR', `[${prefix}] ${req.method} ${req.path} → ${status} ${code}: ${toError(e).message}`);
        if (!res.headersSent) {
            res.status(status).json(body);
        }
    }
}
