// @ts-check
/**
 * @module copilot/server/middleware/auth
 * @file Middleware de autenticação por token Bearer para o servidor copilot.
 *
 *   Extrai auth de `terminal/server.js` (L54.1 — Onda 3.0). Usa comparação timing-safe para evitar timing attacks.
 *
 *   src/copilot/server/middleware/auth.js
 */

import { defaultAuditLog } from '#copilot/audit';
import { LLM_B_TERMINAL_TOKEN } from '#copilot/config';
import { timingSafeEqual } from 'node:crypto';

/**
 * Cria um middleware Express de autenticação Bearer timing-safe.
 *
 * Se `LLM_B_TERMINAL_TOKEN` não estiver definido, a rota é liberada sem auth. Rotas marcadas com `skipAuth=true` na
 * route-table são whitelistadas antes de chegar aqui.
 *
 * @param {object} [opts]
 * @param {string} [opts.token] - Token override (para testes). Default: `LLM_B_TERMINAL_TOKEN`.
 * @returns {import('express').RequestHandler} Middleware Express
 */
export function createAuthMiddleware(opts) {
    const TERMINAL_TOKEN = opts?.token ?? LLM_B_TERMINAL_TOKEN;

    return function authMiddleware(req, res, next) {
        // Sem token configurado → acesso livre (dev mode)
        if (!TERMINAL_TOKEN) {
            return next();
        }

        const authHeader = req.headers['authorization'] ?? '';
        const expected = `Bearer ${TERMINAL_TOKEN}`;

        // SEC-04: timingSafeEqual sem short-circuit para evitar timing leak
        const maxLen = Math.max(authHeader.length, expected.length);
        const providedBuf = Buffer.from(authHeader.padEnd(maxLen));
        const expectedBuf = Buffer.from(expected.padEnd(maxLen));
        const lengthMatch = authHeader.length === expected.length;
        const tokenMatch = timingSafeEqual(providedBuf, expectedBuf) && lengthMatch;

        if (!tokenMatch) {
            const requestId = res.getHeader('X-Request-ID') ?? 'unknown';
            const ip = req.socket?.remoteAddress ?? req.ip ?? 'unknown';

            // F15.3: registrar falha no audit log
            defaultAuditLog.record({
                type: 'auth.failure',
                data: { ip, path: req.path, requestId },
            });

            res.status(401).json({ ok: false, error: 'Unauthorized' });
            return;
        }

        return next();
    };
}
