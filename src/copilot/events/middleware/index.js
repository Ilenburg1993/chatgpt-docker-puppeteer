// @ts-check
/**
 * src/copilot/events/middleware/index.js
 *
 * FAIXA-L6 — Barrel + Middleware Registry.
 *
 * Exporta os 3 middleware built-in e a função `registerBuiltinMiddleware(bus)` que conecta tudo ao EventBus de forma
 * canônica.
 *
 * Ordem de instalação no pipeline:
 *
 * 1. timestampEnricher (garante metadados)
 * 2. schemaValidator (bloqueia eventos malformados)
 * 3. rateLimiter (suprime flood)
 *
 * @module copilot/events/middleware
 */

export { createRateLimiter } from './rate-limiter.js';
export { schemaValidator } from './schema-validator.js';
export { timestampEnricher } from './timestamp-enricher.js';

import { createRateLimiter } from './rate-limiter.js';
import { schemaValidator } from './schema-validator.js';
import { timestampEnricher } from './timestamp-enricher.js';

/**
 * Registra os middleware built-in no EventBus fornecido. Deve ser chamado uma vez durante o bootstrap.
 *
 * @param {import('../../core/event-bus.js').EventBus} bus
 * @param {{ rateLimiterWindowMs?: number; rateLimiterMax?: number }} [options]
 */
export function registerBuiltinMiddleware(bus, options = {}) {
    bus.use(timestampEnricher);
    bus.use(schemaValidator);
    bus.use(
        createRateLimiter({
            windowMs: options.rateLimiterWindowMs ?? 1000,
            maxPerWindow: options.rateLimiterMax ?? 200,
        }),
    );
}
