// @ts-check
/**
 * src/copilot/events/middleware/rate-limiter.js
 *
 * FAIXA-L6 — Middleware que aplica rate limiting por event type.
 *
 * Previne flood de eventos repetitivos (ex.: `agent:task:delta` em loops rápidos). Configurável via
 * `createRateLimiter({ windowMs, maxPerWindow })`.
 *
 * @module copilot/events/middleware/rate-limiter
 */

import { log } from '#copilot/observability';

/**
 * @typedef {object} RateLimiterOptions
 * @property {number} [windowMs=1000] - Janela de tempo em ms. Default is `1000`
 * @property {number} [maxPerWindow=100] - Máximo de emissões por type por janela. Default is `100`
 */

/**
 * Cria um middleware de rate limiting parametrizável.
 *
 * @param {RateLimiterOptions} [options]
 * @returns {import('../../core/event-bus.js').Middleware}
 */
export function createRateLimiter(options = {}) {
    const windowMs = options.windowMs ?? 1000;
    const maxPerWindow = options.maxPerWindow ?? 100;

    /** @type {Map<string, { count: number; windowStart: number }>} */
    const counters = new Map();

    return function rateLimiter(event, next) {
        const now = Date.now();
        const type = event.type;

        let entry = counters.get(type);
        if (!entry || now - entry.windowStart >= windowMs) {
            entry = { count: 0, windowStart: now };
            counters.set(type, entry);
        }

        entry.count++;

        if (entry.count > maxPerWindow) {
            // Log apenas na primeira vez que excede
            if (entry.count === maxPerWindow + 1) {
                log('WARN', `[rate-limiter] ${type} excedeu ${maxPerWindow}/${windowMs}ms — eventos suprimidos.`);
            }
            return; // não chama next() → evento suprimido
        }

        next();
    };
}
