// @ts-check
/**
 * @module copilot/server/middleware/request-id
 * @file Middleware de geração e propagação de X-Request-ID.
 *
 *   Garante rastreabilidade de cada request. Usa o header existente se presente (máx 64 chars), ou gera um novo no
 *   formato `llmb-<timestamp>-<random>`. Onda 3.0 — L54.5.
 *
 *   src/copilot/server/middleware/request-id.js
 */

/**
 * Middleware Express: propaga ou gera X-Request-ID por request.
 *
 * UPG-N23 (fix): rastreabilidade de requests.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
export function requestIdMiddleware(req, res, next) {
    const existing = req.headers['x-request-id'];
    const requestId = existing
        ? String(existing).slice(0, 64)
        : `llmb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    res.setHeader('X-Request-ID', requestId);
    next();
}
