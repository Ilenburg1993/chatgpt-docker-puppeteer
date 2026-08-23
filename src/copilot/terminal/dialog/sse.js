// @ts-check
/**
 * src/copilot/terminal/dialog/sse.js
 *
 * Transmissão SSE e Socket.io para o motor de diálogo do Terminal Permanente LLM-B.
 *
 * @module copilot/terminal/dialog/sse
 * @see EventBus
 */

import { MAX_SSE_CONTENT_CHARS } from '#copilot/config';
import { broadcastGlobal, broadcastToSession } from '#copilot/conversation-hub';
import { redactSecretRecord } from '#copilot/infra/public/observability/redaction';
import {
    attachSseReplayEventId,
    eventFanout,
    getSseClients,
    getSseCriticalClients,
    getTerminalReplayBuffer,
} from '#copilot/presentation/realtime';
import { log } from '../../observability/index.js';
import { CRITICAL_EVENTS, getHubSessionId } from '../../presentation/state/index.js';
import { recordTerminalSseEventArchive } from '../state/events/index.js';

export { CRITICAL_EVENTS } from '../../presentation/state/index.js';

/**
 * Contador monotônico de IDs para eventos SSE do terminal.
 *
 * @type {number}
 */
let _sseEventIdCounter = 0;

const MAX_SSE_NORMALIZE_DEPTH = 8;
const MAX_SSE_ARRAY_ITEMS = 200;

/**
 * @param {unknown} value
 * @param {{ depth: number; seen: WeakSet<object> }} ctx
 * @returns {unknown}
 */
function normalizeSseValue(value, ctx) {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') {
        return value.length > MAX_SSE_CONTENT_CHARS
            ? `${value.slice(0, MAX_SSE_CONTENT_CHARS)} [\u2026truncado]`
            : value;
    }
    if (value === null || typeof value !== 'object') return value;
    if (ctx.seen.has(value)) return '[Circular]';
    if (ctx.depth >= MAX_SSE_NORMALIZE_DEPTH) return '[MaxDepth]';
    ctx.seen.add(value);
    if (Array.isArray(value)) {
        const items = value
            .slice(0, MAX_SSE_ARRAY_ITEMS)
            .map((item) => normalizeSseValue(item, { depth: ctx.depth + 1, seen: ctx.seen }));
        if (value.length > MAX_SSE_ARRAY_ITEMS)
            items.push(`[\u2026${value.length - MAX_SSE_ARRAY_ITEMS} itens truncados]`);
        return items;
    }
    /** @type {Record<string, unknown>} */
    const output = {};
    for (const [key, item] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
        output[key] = normalizeSseValue(item, { depth: ctx.depth + 1, seen: ctx.seen });
    }
    return output;
}

/**
 * Normaliza payloads antes de replay/archive/raw SSE/socket/fanout. O ponto único de fanout não deve cair por BigInt,
 * ciclos, strings gigantes ou objetos hostis.
 *
 * @param {unknown} data
 * @returns {Record<string, unknown>}
 */
export function normalizeSsePayloadForTransport(data) {
    const normalized = normalizeSseValue(data, { depth: 0, seen: new WeakSet() });
    return normalized !== null && typeof normalized === 'object' && !Array.isArray(normalized)
        ? /** @type {Record<string, unknown>} */ (normalized)
        : { value: normalized };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stringifyJsonStrict(value) {
    try {
        return JSON.stringify(normalizeSseValue(value, { depth: 0, seen: new WeakSet() }));
    } catch (error) {
        return JSON.stringify({
            serializationError: error instanceof Error ? error.message : String(error),
            value: '[Unserializable]',
        });
    }
}

/**
 * Gera o próximo ID SSE monotônico.
 *
 * @returns {number}
 */
export function nextSseEventId() {
    return ++_sseEventIdCounter;
}

/**
 * Transmite um evento para todos os canais de saída conectados.
 *
 * @param {string} event - Tipo do evento
 * @param {object} data - Payload JSON serializável
 * @returns {void}
 */
export function broadcastSse(event, data) {
    const _sseClients = getSseClients();
    const _sseCriticalClients = getSseCriticalClients();

    const hubSessionId = getHubSessionId();
    const safeEvent = String(event).replace(/[\r\n]/g, '_');
    const transportData = normalizeSsePayloadForTransport(data);
    const enrichedData = redactSecretRecord({ ...transportData, hubSessionId: hubSessionId ?? null });
    const eventId = getTerminalReplayBuffer().push(safeEvent, enrichedData);
    try {
        recordTerminalSseEventArchive({
            event: safeEvent,
            eventId,
            data: enrichedData,
        });
    } catch (error) {
        log(
            'WARN',
            `[terminal:sse] falha ao arquivar evento ${safeEvent}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    emitSse(_sseClients, _sseCriticalClients, safeEvent, enrichedData, eventId);
    emitSocket(safeEvent, enrichedData);

    try {
        eventFanout.publish('terminal', safeEvent, attachSseReplayEventId(enrichedData, eventId));
    } catch (error) {
        log(
            'WARN',
            `[terminal:sse] falha no fanout do evento ${safeEvent}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

/**
 * Escreve um evento SSE formatado para um único client raw (node:http).
 *
 * @param {import('node:http').ServerResponse} client
 * @param {string} event
 * @param {object} data
 * @param {{
 *     hubSessionId?: string | null;
 *     eventId?: number;
 * }} [ctx]
 * @returns {boolean}
 */
function writeSseEvent(client, event, data, ctx = {}) {
    const safeEvent = String(event).replace(/[\r\n]/g, '_');
    const enrichedData = { ...data, hubSessionId: ctx.hubSessionId ?? null };
    const eventId = Number.isFinite(ctx.eventId) ? Number(ctx.eventId) : nextSseEventId();
    const payload = `id: ${eventId}\nevent: ${safeEvent}\ndata: ${stringifyJsonStrict(enrichedData)}\n\n`;
    try {
        return client.write(payload) !== false;
    } catch {
        return false;
    }
}

/**
 * Envia um evento SSE para clientes raw.
 *
 * @param {Set<import('node:http').ServerResponse>} clients
 * @param {Set<import('node:http').ServerResponse>} criticalClients
 * @param {string} event
 * @param {object} data
 * @param {number} eventId
 * @returns {void}
 */
function emitSse(clients, criticalClients, event, data, eventId) {
    if (clients.size === 0 && criticalClients.size === 0) return;

    const ctx = { hubSessionId: getHubSessionId(), eventId };

    for (const client of clients) {
        if (!writeSseEvent(client, event, data, ctx)) {
            clients.delete(client);
        }
    }
    if (CRITICAL_EVENTS.has(event)) {
        for (const client of criticalClients) {
            if (!writeSseEvent(client, event, data, ctx)) {
                criticalClients.delete(client);
            }
        }
    }
}

/**
 * Emite evento via Socket.io namespace `/copilot`.
 *
 * @param {string} event
 * @param {object} data
 * @returns {void}
 */
function emitSocket(event, data) {
    const hubSessionId = getHubSessionId();
    if (hubSessionId) {
        broadcastToSession(hubSessionId, event, { ...data, hubSessionId });
    } else {
        const SYSTEM_EVENTS = new Set(['dialog.ready', 'dialog.stalled', 'dialog.stopped', 'fatal', 'busy']);
        if (SYSTEM_EVENTS.has(event)) {
            broadcastGlobal(event, { ...data, hubSessionId: null });
        }
    }
}
