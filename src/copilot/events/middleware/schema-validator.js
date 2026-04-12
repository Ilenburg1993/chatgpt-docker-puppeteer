// @ts-check
/**
 * src/copilot/events/middleware/schema-validator.js
 *
 * FAIXA-L6 + L18 — Middleware que valida estrutura mínima de eventos e, opcionalmente, schema do registry (FAIXA-L18).
 *
 * - Validação base: `type` (string) e `timestamp` (number) sao obrigatórios.
 * - Validação estendida (L18): se houver schema registrado, valida campos required e tipos. Em dev: log WARN. Em prod:
 *   log WARN (nao bloqueia).
 *
 * @module copilot/events/middleware/schema-validator
 */

import { log } from '#copilot/observability';
import { validateEvent } from '../schemas/registry.js';

const IS_DEV = process.env.NODE_ENV !== 'production';

/**
 * Middleware de validação de schema.
 *
 * @type {import('../../core/event-bus.js').Middleware}
 */
export function schemaValidator(event, next) {
    // ── Base validation (L6) ─────────────────────────────
    if (typeof event.type !== 'string' || event.type.length === 0) {
        log('WARN', `[schema-validator] Evento bloqueado - type inválido: ${JSON.stringify(event.type)}`);
        return; // não chama next() → evento descartado
    }
    if (typeof event.timestamp !== 'number') {
        log('WARN', `[schema-validator] Evento ${event.type} - timestamp inválido, auto-corrigido.`);
        event.timestamp = Date.now();
    }

    // ── Extended validation (L18) ────────────────────────
    const result = validateEvent(event);
    if (!result.valid) {
        const msg = `[schema-validator] ${event.type}: ${result.errors.join('; ')}`;
        if (IS_DEV) {
            log('WARN', msg);
            // Em dev: passa mas avisa
        } else {
            log('WARN', msg);
        }
    }

    next();
}
