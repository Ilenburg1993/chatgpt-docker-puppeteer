// @ts-check
/**
 * src/copilot/events/middleware/schema-validator.js
 *
 * FAIXA-L6 + L18 + L33 — Middleware de validação de schema para EventBus.
 *
 * - Validação base: `type` (string) e `timestamp` (number) são obrigatórios.
 * - Validação estendida (L18): se houver schema registrado, valida campos required e tipos.
 * - Strict mode (L33): contadores de violações, tracking de eventos sem schema, e opção STRICT_SCHEMA=1 para bloquear em
 *   dev.
 *
 * @module copilot/events/middleware/schema-validator
 */

import { getEventSchema, validateEvent } from '../schemas/registry.js';

const IS_DEV = process.env.NODE_ENV !== 'production';
const STRICT = process.env.STRICT_SCHEMA === '1';

// ── L33: Counters & diagnostics ──────────────────────────

/** @type {{ blocked: number; warned: number; unregistered: number; corrected: number }} */
const _counters = { blocked: 0, warned: 0, unregistered: 0, corrected: 0 };

/** @type {Set<string>} - Types seen without a registered schema */
const _unregisteredTypes = new Set();

/**
 * Retorna snapshot dos contadores de validação.
 *
 * @returns {{
 *     blocked: number;
 *     warned: number;
 *     unregistered: number;
 *     corrected: number;
 *     unregisteredTypes: string[];
 * }}
 */
export function getValidationStats() {
    return {
        ..._counters,
        unregisteredTypes: [..._unregisteredTypes].sort(),
    };
}

/**
 * Reseta contadores (para testes).
 */
export function resetValidationStats() {
    _counters.blocked = 0;
    _counters.warned = 0;
    _counters.unregistered = 0;
    _counters.corrected = 0;
    _unregisteredTypes.clear();
}

/**
 * Middleware de validação de schema.
 *
 * @type {import('../../core/event-bus.js').Middleware}
 */
export function schemaValidator(event, next) {
    // ── Base validation (L6) ─────────────────────────────
    if (typeof event.type !== 'string' || event.type.length === 0) {
        console.warn(`[schema-validator] Evento bloqueado - type inválido: ${JSON.stringify(event.type)}`);
        _counters.blocked++;
        return; // não chama next() → evento descartado
    }
    if (typeof event.timestamp !== 'number') {
        console.warn(`[schema-validator] Evento ${event.type} - timestamp inválido, auto-corrigido.`);
        event.timestamp = Date.now();
        _counters.corrected++;
    }

    // ── L33: Track unregistered types ────────────────────
    if (!getEventSchema(event.type)) {
        _unregisteredTypes.add(event.type);
        _counters.unregistered++;
    }

    // ── Extended validation (L18 + L33 strict) ───────────
    const result = validateEvent(event);
    if (!result.valid) {
        const msg = `[schema-validator] ${event.type}: ${result.errors.join('; ')}`;
        _counters.warned++;
        if (STRICT && IS_DEV) {
            console.warn(`${msg} [BLOCKED: STRICT_SCHEMA=1]`);
            _counters.blocked++;
            return; // bloqueia em strict mode
        }
        console.warn(msg);
    }

    next();
}
