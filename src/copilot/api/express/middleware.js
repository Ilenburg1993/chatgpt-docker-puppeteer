// @ts-check
/**
 * src/copilot/routes/middleware.js
 *
 * Middlewares Express compartilhados pelas rotas SDK.
 *
 * @module copilot/routes/middleware
 */

import { log } from '#copilot/observability/logger';

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
        log('ERROR', `[${prefix}] ${req.method} ${req.path} → ${e.message}`);
        if (!res.headersSent) {
            res.status(500).json({ ok: false, error: sanitizeErrorMessage(e.message) });
        }
    }
}
