// @ts-check
/**
 * @module copilot/server/middleware/error-handler
 * @file Middleware de erro global Express para o servidor copilot.
 *
 *   Captura erros propagados via `next(err)` e retorna JSON padronizado. Onda 3.0 — L54.3.
 *
 *   src/copilot/server/middleware/error-handler.js
 */

import { log } from '#copilot/observability';

/**
 * @typedef {object} AppError
 * @property {string} message
 * @property {string} [code]
 * @property {number} [status]
 */

/**
 * Error handler Express (4 parâmetros obrigatórios para Express reconhecer como error middleware).
 *
 * @param {unknown} err - Erro lançado ou passado para `next(err)`
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
export function copilotErrorHandler(err, req, res, next) {
    void next;
    const error = /** @type {AppError & { status?: number; code?: string }} */ (err);
    const status = error?.status ?? 500;
    const message = error?.message ?? 'Internal server error';
    const code = error?.code ?? 'INTERNAL_ERROR';
    const requestId = res.getHeader('X-Request-ID') ?? 'unknown';

    if (status >= 500) {
        log('ERROR', `[CopilotServer] ${req.method} ${req.path} → ${status} [${requestId}]: ${message}`);
    }

    if (code === 'PAYLOAD_TOO_LARGE') {
        res.status(413).json({ ok: false, error: 'Payload too large', code });
        return;
    }

    res.status(status).json({ ok: false, error: message, code });
}
