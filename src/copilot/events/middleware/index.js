// @ts-check
/**
 * src/copilot/events/middleware/index.js
 *
 * FAIXA-L6 — Barrel + Middleware Registry.
 *
 * Exporta os 4 middleware built-in e a função `registerBuiltinMiddleware(bus)` que conecta tudo ao EventBus de forma
 * canônica.
 *
 * Ordem de instalação no pipeline:
 *
 * 1. correlationEnricher (garante correlationId — FAIXA-L16)
 * 2. timestampEnricher (garante metadados)
 * 3. schemaValidator (bloqueia eventos malformados)
 * 4. rateLimiter (suprime flood)
 *
 * @module copilot/events/middleware
 */

export { correlationEnricher } from './correlation-enricher.js';
export { createRateLimiter } from './rate-limiter.js';
export { schemaValidator } from './schema-validator.js';
export { timestampEnricher } from './timestamp-enricher.js';

import { BUILTIN_SCHEMAS } from '../schemas/builtin-schemas.js';
import { registerEventSchemas } from '../schemas/registry.js';
import { correlationEnricher } from './correlation-enricher.js';
import { createRateLimiter } from './rate-limiter.js';
import { schemaValidator } from './schema-validator.js';
import { timestampEnricher } from './timestamp-enricher.js';

/**
 * Registra os middleware built-in no EventBus fornecido. Deve ser chamado uma vez durante o bootstrap. Também registra
 * os schemas built-in (FAIXA-L18).
 *
 * @param {import('../../core/event-bus.js').EventBus} bus
 * @param {{ rateLimiterWindowMs?: number; rateLimiterMax?: number }} [options]
 */
export function registerBuiltinMiddleware(bus, options = {}) {
    // Registrar schemas built-in (L18)
    registerEventSchemas(BUILTIN_SCHEMAS);

    bus.use(correlationEnricher);
    bus.use(timestampEnricher);
    bus.use(schemaValidator);
    bus.use(
        createRateLimiter({
            windowMs: options.rateLimiterWindowMs ?? 1000,
            maxPerWindow: options.rateLimiterMax ?? 200,
        }),
    );
}
