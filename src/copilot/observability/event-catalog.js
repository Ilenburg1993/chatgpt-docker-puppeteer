// @ts-check
/**
 * src/copilot/observability/event-catalog.js — FAIXA-L25
 *
 * Catálogo dinâmico de eventos gerado a partir das constantes SSOT + emitter-events. Também mantém rastreamento de
 * dead-letters (eventos emitidos sem listener).
 *
 * @module copilot/observability/event-catalog
 * @see EventBus
 */

import * as agentEvents from '../events/agent-events.js';
import * as emitterEvents from '../events/emitter-events.js';
import * as hookEvents from '../events/hook-events.js';
import * as hubEvents from '../events/hub-events.js';
import * as nervEvents from '../events/nerv-events.js';
import * as serviceEvents from '../events/service-events.js';
import * as systemEvents from '../events/system-events.js';
import * as terminalEvents from '../events/terminal-events.js';
import { defaultMetrics } from './metrics.js';

// ─── Catálogo dinâmico ────────────────────────────────────────────────────────

/**
 * @typedef {object} CatalogEntry
 * @property {string} event - Nome do evento (valor da constante)
 * @property {string} constant - Nome da constante exportada
 * @property {string} origin - Módulo de origem (agent-events, hook-events, etc.)
 */

/**
 * Extrai entradas do catálogo de um módulo de constantes.
 *
 * @param {Record<string, unknown>} mod
 * @param {string} origin
 * @returns {CatalogEntry[]}
 */
function extractEntries(mod, origin) {
    return Object.entries(mod)
        .filter(([, v]) => typeof v === 'string')
        .map(([k, v]) => /** @type {CatalogEntry} */ ({ event: /** @type {string} */ (v), constant: k, origin }));
}

/** @type {CatalogEntry[] | null} */
let _cache = null;

// ─── Dead-letter tracking (L34: enhanced) ────────────────────────────────────

const MAX_DEAD_LETTERS = 500;

/**
 * @typedef {object} DeadLetterEntry
 * @property {string} event - Nome do evento sem listener
 * @property {number} count - Vezes emitido sem listener
 * @property {number} lastTs - Timestamp da última ocorrência
 * @property {string | undefined} [reason] - Motivo (no_listener, schema_blocked, etc.)
 * @property {string | undefined} [correlationId] - Correlation ID do primeiro evento
 */

/** @type {Map<string, DeadLetterEntry>} */
const _deadLetters = new Map();

/**
 * Registra um evento emitido sem listeners (dead-letter).
 *
 * @param {string} event - Nome do evento
 * @param {{ reason?: string; correlationId?: string }} [opts]
 */
export function recordDeadLetter(event, opts) {
    const existing = _deadLetters.get(event);
    if (existing) {
        existing.count++;
        existing.lastTs = Date.now();
        if (opts?.reason && !existing.reason) existing.reason = opts.reason;
    } else {
        if (_deadLetters.size >= MAX_DEAD_LETTERS) {
            // Evict oldest entry to prevent unbounded growth
            const oldest = [..._deadLetters.entries()].sort((a, b) => a[1].lastTs - b[1].lastTs)[0];
            if (oldest) _deadLetters.delete(oldest[0]);
        }
        _deadLetters.set(event, {
            event,
            count: 1,
            lastTs: Date.now(),
            reason: opts?.reason,
            correlationId: opts?.correlationId,
        });
    }
    defaultMetrics.recordCounter('copilot.events.dead_letter_total');
}

/**
 * Retorna o catálogo dinâmico de eventos, gerado a partir das constantes SSOT. O resultado é cacheado após a primeira
 * chamada.
 *
 * @returns {CatalogEntry[]}
 */
export function getCatalog() {
    if (_cache) return [..._cache];
    _cache = [
        ...extractEntries(agentEvents, 'agent-events'),
        ...extractEntries(hookEvents, 'hook-events'),
        ...extractEntries(hubEvents, 'hub-events'),
        ...extractEntries(terminalEvents, 'terminal-events'),
        ...extractEntries(systemEvents, 'system-events'),
        ...extractEntries(serviceEvents, 'service-events'),
        ...extractEntries(nervEvents, 'nerv-events'),
        ...extractEntries(emitterEvents, 'emitter-events'),
    ];
    return [..._cache];
}

/**
 * Retorna as dead-letters registradas.
 *
 * @param {number} [limit=50] - Número máximo de entradas. Default is `50`
 * @returns {DeadLetterEntry[]}
 */
export function getDeadLetters(limit = 50) {
    return [..._deadLetters.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

/**
 * Limpa as dead-letters registradas.
 *
 * @returns {void}
 */
export function clearDeadLetters() {
    _deadLetters.clear();
}
