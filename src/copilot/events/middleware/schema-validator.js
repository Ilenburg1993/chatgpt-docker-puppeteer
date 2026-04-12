// @ts-check
/**
 * src/copilot/events/middleware/schema-validator.js
 *
 * FAIXA-L6 — Middleware que valida estrutura mínima de eventos.
 *
 * Garante que todo evento que passe pelo pipeline tenha `type` (string)
 * e `timestamp` (number). Eventos inválidos são logados e bloqueados.
 *
 * @module copilot/events/middleware/schema-validator
 */

import { log } from '#copilot/observability';

/**
 * Middleware de validação de schema mínimo.
 *
 * @type {import('../../core/event-bus.js').Middleware}
 */
export function schemaValidator(event, next) {
    if (typeof event.type !== 'string' || event.type.length === 0) {
        log('WARN', `[schema-validator] Evento bloqueado — type inválido: ${JSON.stringify(event.type)}`);
        return; // não chama next() → evento descartado
    }
    if (typeof event.timestamp !== 'number') {
        log('WARN', `[schema-validator] Evento ${event.type} — timestamp inválido, auto-corrigido.`);
        event.timestamp = Date.now();
    }
    next();
}
