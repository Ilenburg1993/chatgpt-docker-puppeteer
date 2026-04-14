// @ts-check
/**
 * @module copilot/server/middleware/rate-limiter
 * @file Rate limiters em memória para o servidor copilot.
 *
 *   Extrai os 3 rate limiters de `terminal/server.js` (L54.2 — Onda 3.0). Disponibiliza middlewares Express prontos para
 *   montar por rota.
 *
 *   src/copilot/server/middleware/rate-limiter.js
 */

import {
    LLM_B_INJECT_RATE_MAX,
    LLM_B_INJECT_RATE_WINDOW_MS,
    LLM_B_SSE_RATE_MAX,
    LLM_B_SSE_RATE_WINDOW_MS,
} from '#copilot/config';
import { log } from '#copilot/observability';

// SEC-V06: rate limiters em memória — zerados a cada restart.
// Em produção, use redis ou implemente na camada de reverse proxy.

/**
 * Cria um rate limiter em memória por chave (IP, IP+endpoint, etc.).
 *
 * @param {number} max - Máximo de requisições por janela
 * @param {number} windowMs - Duração da janela em ms
 * @returns {{ check: (key: string) => { allowed: boolean; remaining: number; resetIn: number }; clear: () => void }}
 */
function createRateLimiter(max, windowMs) {
    /** @type {Map<string, { count: number; resetAt: number }>} */
    const store = new Map();
    return {
        check(key) {
            const now = Date.now();
            // BUG-N03: purgar entradas expiradas para evitar memory leak em uptime longo
            for (const [k, bucket] of store) {
                if (now >= bucket.resetAt) store.delete(k);
            }
            let bucket = store.get(key);
            if (!bucket || now >= bucket.resetAt) {
                bucket = { count: 0, resetAt: now + windowMs };
                store.set(key, bucket);
            }
            bucket.count++;
            return {
                allowed: bucket.count <= max,
                remaining: Math.max(0, max - bucket.count),
                resetIn: Math.ceil((bucket.resetAt - now) / 1000),
            };
        },
        clear() {
            store.clear();
        },
    };
}

// ── Instâncias singleton dos 3 rate limiters ───────────────────────────────

/** Rate limiter para POST /inject — janela configurável via env */
export const injectRateLimiter = createRateLimiter(LLM_B_INJECT_RATE_MAX, LLM_B_INJECT_RATE_WINDOW_MS);

/** Rate limiter para endpoints de escrita (/pipeline, /memory, /attach, /context-send) */
export const writeRateLimiter = createRateLimiter(
    5, // mais restritivo que /inject — SEC-N02
    60_000,
);

/** Rate limiter para conexões SSE (/events, /events/critical) */
export const sseRateLimiter = createRateLimiter(LLM_B_SSE_RATE_MAX, LLM_B_SSE_RATE_WINDOW_MS);

/**
 * Limpa todos os rate limiters (usado no emergency-reset).
 *
 * @returns {void}
 */
export function clearAllRateLimiters() {
    injectRateLimiter.clear();
    writeRateLimiter.clear();
    sseRateLimiter.clear();
    log('INFO', '[CopilotServer] Rate limiters resetados.');
}

// ── Middlewares Express por tipo de limiter ────────────────────────────────

/**
 * Middleware Express: rate limit para endpoints de inject.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
export function injectRateMiddleware(req, res, next) {
    const ip = req.socket?.remoteAddress ?? req.ip ?? 'unknown';
    const result = injectRateLimiter.check(ip);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetIn);
    if (!result.allowed) {
        res.status(429).json({ ok: false, error: 'Too many requests', resetIn: result.resetIn });
        return;
    }
    next();
}

/**
 * Middleware Express: rate limit para endpoints de escrita. A chave inclui o path para isolamento por rota.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
export function writeRateMiddleware(req, res, next) {
    const ip = req.socket?.remoteAddress ?? req.ip ?? 'unknown';
    const result = writeRateLimiter.check(`${ip}:${req.path}`);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetIn);
    if (!result.allowed) {
        res.status(429).json({ ok: false, error: 'Too many requests', resetIn: result.resetIn });
        return;
    }
    next();
}

/**
 * Middleware Express: rate limit para conexões SSE.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
export function sseRateMiddleware(req, res, next) {
    const ip = req.socket?.remoteAddress ?? req.ip ?? 'unknown';
    const result = sseRateLimiter.check(`sse:${ip}`);
    if (!result.allowed) {
        res.status(429).json({ ok: false, error: 'Too many SSE connections', resetIn: result.resetIn });
        return;
    }
    next();
}
