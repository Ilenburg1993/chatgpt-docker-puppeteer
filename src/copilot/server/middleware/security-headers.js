// @ts-check
/**
 * @module copilot/server/middleware/security-headers
 * @file Middleware de security headers para o servidor copilot.
 *
 * Equivalente leve ao `helmet` — define cabeçalhos de segurança sem dependência externa.
 * S-A-09 fix (Faixa 0).
 *
 * src/copilot/server/middleware/security-headers.js
 */

/**
 * Middleware que adiciona security headers essenciais a cada resposta.
 *
 * @param {import('express').Request} _req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
export function securityHeadersMiddleware(_req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    next();
}
