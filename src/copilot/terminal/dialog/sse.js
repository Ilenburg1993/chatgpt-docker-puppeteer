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
import { attachSseReplayEventId, eventFanout } from '../../infra/sse/index.js';
import { getSseClients, getSseCriticalClients, getTerminalReplayBuffer } from '../../infra/sse/state.js';
import { CRITICAL_EVENTS } from '../../presentation/state/index.js';
import { getHubSessionId } from '../../presentation/state/index.js';

export { CRITICAL_EVENTS } from '../../presentation/state/index.js';

/**
 * Contador monotônico de IDs para eventos SSE do terminal.
 *
 * @type {number}
 */
let _sseEventIdCounter = 0;

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

    /** @type {object} */
    let safeData = data;
    if (
        data !== null &&
        typeof data === 'object' &&
        typeof (/** @type {Record<string, unknown>} */ (data)['content']) === 'string' &&
        /** @type {{ content: string }} */ (data).content.length > MAX_SSE_CONTENT_CHARS
    ) {
        safeData = {
            ...data,
            content:
                /** @type {{ content: string }} */ (data).content.slice(0, MAX_SSE_CONTENT_CHARS) + ' [\u2026truncado]',
        };
    }

    const hubSessionId = getHubSessionId();
    const safeEvent = String(event).replace(/[\r\n]/g, '_');
    const enrichedData = { ...safeData, hubSessionId: hubSessionId ?? null };
    const eventId = getTerminalReplayBuffer().push(safeEvent, enrichedData);

    emitSse(_sseClients, _sseCriticalClients, safeEvent, enrichedData, eventId);
    emitSocket(safeEvent, enrichedData);

    eventFanout.publish('terminal', safeEvent, attachSseReplayEventId(enrichedData, eventId));
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
    const payload = `id: ${eventId}\nevent: ${safeEvent}\ndata: ${JSON.stringify(enrichedData)}\n\n`;
    try {
        client.write(payload);
        return true;
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
