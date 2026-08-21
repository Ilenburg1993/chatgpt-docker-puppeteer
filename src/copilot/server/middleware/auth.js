// @ts-check
/**
 * @module copilot/server/middleware/auth
 * @file Middleware de autenticação por token Bearer para o servidor copilot.
 *
 *   Middleware canônico de auth do servidor Copilot. Substitui a auth que existia no antigo terminal server.
 *
 *   src/copilot/server/middleware/auth.js
 */

import { defaultAuditLog } from '#copilot/audit';
import { readCopilotBootConfig } from '#copilot/boot';
import { toOwnedBuffer } from '#copilot/infra/public/platform';
import { timingSafeEqual } from 'node:crypto';

/**
 * Cria um middleware Express de autenticação Bearer timing-safe.
 *
 * Se o token canônico do boot não estiver definido, a rota é liberada sem auth. Rotas explicitamente públicas continuam
 * acessíveis pelo desenho do servidor local.
 *
 * @param {object} [opts]
 * @param {string} [opts.token] - Token override (para testes). Default: `readCopilotBootConfig().server.token`.
 * @returns {import('express').RequestHandler} Middleware Express
 */
export function createAuthMiddleware(opts) {
    const TERMINAL_TOKEN = opts?.token ?? readCopilotBootConfig().server.token;

    return function authMiddleware(req, res, next) {
        // Model Gateway ingress is SDK-facing and owns per-route local API key auth.
        if (req.path.startsWith('/v1/model-gateway-ingress/')) {
            return next();
        }

        // Sem token configurado → acesso livre (dev mode)
        if (!TERMINAL_TOKEN) {
            return next();
        }

        const authHeader = req.headers['authorization'] ?? '';
        const expected = `Bearer ${TERMINAL_TOKEN}`;

        // SEC-04: timingSafeEqual sem short-circuit para evitar timing leak
        const maxLen = Math.max(authHeader.length, expected.length);
        const providedBuf = toOwnedBuffer(authHeader.padEnd(maxLen));
        const expectedBuf = toOwnedBuffer(expected.padEnd(maxLen));
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
