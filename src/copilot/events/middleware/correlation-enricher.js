// @ts-check
/**
 * src/copilot/events/middleware/correlation-enricher.js
 *
 * FAIXA-L16 + L35 — Middleware que garante `correlationId` e `causationId` em todo evento do EventBus.
 *
 * - `correlationId`: ID de correlação compartilhado por todos os eventos de um mesmo fluxo.
 * - `causationId` (L35): ID do evento que causou este evento. Permite reconstruir a árvore de causalidade.
 *
 * Posição no pipeline: **antes** do timestampEnricher (primeiro middleware).
 *
 * @module copilot/events/middleware/correlation-enricher
 */

import { randomUUID } from 'node:crypto';

/** @type {string | undefined} */
let _currentCausation;

/**
 * Define o causationId para eventos emitidos dentro de um handler.
 * Usar antes de emitir eventos dentro de um listener para rastrear causalidade.
 *
 * @param {string | undefined} eventId
 */
export function setCausationContext(eventId) {
    _currentCausation = eventId;
}

/**
 * Retorna o causationId ativo.
 *
 * @returns {string | undefined}
 */
export function getCausationContext() {
    return _currentCausation;
}

/**
 * Middleware que enriquece todo evento com `correlationId` e `causationId`.
 *
 * @type {import('../../core/event-bus.js').Middleware}
 */
export function correlationEnricher(event, next) {
    if (!event.correlationId) {
        event.correlationId = randomUUID();
    }
    if (!event.eventId) {
        event.eventId = randomUUID();
    }
    if (!event.causationId && _currentCausation) {
        event.causationId = _currentCausation;
    }
    next();
}
