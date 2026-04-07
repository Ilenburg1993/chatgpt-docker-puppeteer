// @ts-check
/**
 * src/copilot/api/express/session-middleware.js
 *
 * Middlewares e helpers compartilhados pelas rotas de sessão SDK.
 *
 * @module copilot/api/express/session-middleware
 */

import { log } from '#copilot/observability/logger';

/**
 * @typedef {import('express').Request} Req
 * @typedef {import('express').Response} Res
 */

// SEC-N05/N06 (fix): validação de model — prevenir injeção e garantir formato kosher
const MODEL_SAFE_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,99})$/;

/** @type {Map<string, { count: number; bucketStart: number }>} */
const _rlWindowMap = new Map();

/**
 * Middleware de rate limiting simples por IP (em memória, por processo).
 *
 * @param {number} maxPerMinute - Máximo de requisições por minuto
 * @param {string} label - Label para log
 * @returns {import('express').RequestHandler}
 */
export function rateLimitMiddleware(maxPerMinute, label) {
    const WINDOW_MS = 60_000;
    return (req, res, next) => {
        const ip = req.ip ?? 'unknown';
        const key = `${label}:${ip}`;
        const now = Date.now();
        // BUG-RF015 (fix): purgar entradas expiradas para evitar memory leak em uptime longo
        for (const [k, e] of _rlWindowMap) {
            if (now - e.bucketStart > WINDOW_MS) _rlWindowMap.delete(k);
        }
        const entry = _rlWindowMap.get(key);
        if (!entry || now - entry.bucketStart > WINDOW_MS) {
            _rlWindowMap.set(key, { count: 1, bucketStart: now });
            return next();
        }
        entry.count += 1;
        if (entry.count > maxPerMinute) {
            return res.status(429).json({ ok: false, error: 'Too many requests. Tente novamente em 1 minuto.' });
        }
        return next();
    };
}

/**
 * Valida e sanitiza o campo `model` recebido do body HTTP. Retorna o model normalizado (trim) ou null se inválido.
 *
 * @param {unknown} model
 * @returns {{ ok: true; model: string } | { ok: false; error: string }}
 */
export function validateModel(model) {
    if (!model || typeof model !== 'string') {
        return { ok: false, error: 'Campo "model" (string) é obrigatório.' };
    }
    const trimmed = model.trim();
    if (!MODEL_SAFE_RE.test(trimmed)) {
        return { ok: false, error: 'Campo "model" contém caracteres inválidos ou formato não permitido.' };
    }
    return { ok: true, model: trimmed };
}

/**
 * Wrapper que captura erros e retorna 500 padronizado.
 *
 * @param {Req} req
 * @param {Res} res
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<void>}
 */
export async function withErrorHandler(req, res, fn) {
    try {
        await fn();
    } catch (/** @type {any} */ e) {
        log('ERROR', `[sdk-api/sessions] ${req.method} ${req.path} → ${e.message}`);
        if (!res.headersSent) {
            res.status(500).json({ ok: false, error: e.message });
        }
    }
}
