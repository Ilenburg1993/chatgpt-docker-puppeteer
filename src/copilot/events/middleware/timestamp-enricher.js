// @ts-check
/**
 * src/copilot/events/middleware/timestamp-enricher.js
 *
 * FAIXA-L6 — Middleware que garante campo `_enriched` com metadados padronizados.
 *
 * Adiciona `_source` (hostname/pid) e normaliza `timestamp` se ausente. Leve e fire-through — não bloqueia o pipeline.
 *
 * @module copilot/events/middleware/timestamp-enricher
 */

import { hostname } from 'node:os';

const _hostname = hostname();
const _pid = process.pid;

/**
 * Middleware que enriquece todo evento com metadados de origem.
 *
 * @param {import('../base-events.js').BaseEvent} event
 * @param {() => void | Promise<void>} next
 * @returns {void | Promise<void>}
 */
export function timestampEnricher(event, next) {
    if (!event.timestamp) {
        event.timestamp = Date.now();
    }
    if (!event._source) {
        event._source = `${_hostname}:${_pid}`;
    }
    return next();
}
