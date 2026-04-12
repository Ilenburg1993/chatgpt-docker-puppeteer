// @ts-check
/**
 * src/copilot/events/middleware/correlation-enricher.js
 *
 * FAIXA-L16 — Middleware que garante `correlationId` em todo evento do EventBus.
 *
 * Se o evento já possui `correlationId`, preserva; caso contrário, gera um UUID v4 via `crypto.randomUUID()`.
 *
 * Posição no pipeline: **antes** do timestampEnricher (primeiro middleware), para que todos os middleware e handlers
 * subsequentes já tenham acesso ao correlationId.
 *
 * @module copilot/events/middleware/correlation-enricher
 */

import { randomUUID } from 'node:crypto';

/**
 * Middleware que enriquece todo evento com `correlationId`.
 *
 * @type {import('../../core/event-bus.js').Middleware}
 */
export function correlationEnricher(event, next) {
    if (!event.correlationId) {
        event.correlationId = randomUUID();
    }
    next();
}
