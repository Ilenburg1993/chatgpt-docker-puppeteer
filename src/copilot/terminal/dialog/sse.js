// @ts-check
/**
 * src/copilot/terminal/dialog/sse.js
 *
 * Transmissão SSE e Socket.io para o motor de diálogo do Terminal Permanente LLM-B.
 *
 * @module copilot/terminal/dialog/sse
 */

import { eventFanout } from '#copilot/api/sse/fanout';
import { broadcastGlobal, broadcastToSession } from '#copilot/conversation-hub/socket-ns';
import { MAX_SSE_CONTENT_CHARS } from '#copilot/core/constants';
import { getHubSessionId, getSseClients, getSseCriticalClients, getTerminalReplayBuffer } from '../state.js';

/** Eventos considerados críticos para clientes em modo ?level=critical. */
export const CRITICAL_EVENTS = new Set(['dialog.stalled', 'fatal', 'system']);

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

    emitSse(_sseClients, _sseCriticalClients, event, safeData);
    emitSocket(event, safeData);

    eventFanout.publish('terminal', event, safeData);
}

/**
 * Escreve um evento SSE formatado para um único client raw (node:http).
 *
 * @param {import('node:http').ServerResponse} client
 * @param {string} event
 * @param {object} data
 * @param {{
 *     hubSessionId?: string | null;
 *     replayBuffer?: import('../../api/sse/replay-buffer.js').SseReplayBuffer;
 * }} [ctx]
 * @returns {boolean}
 */
function writeSseEvent(client, event, data, ctx = {}) {
    const safeEvent = String(event).replace(/[\r\n]/g, '_');
    const enrichedData = { ...data, hubSessionId: ctx.hubSessionId ?? null };
    const eventId = ctx.replayBuffer ? ctx.replayBuffer.push(safeEvent, enrichedData) : nextSseEventId();
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
 * @returns {void}
 */
function emitSse(clients, criticalClients, event, data) {
    if (clients.size === 0 && criticalClients.size === 0) return;

    const ctx = { hubSessionId: getHubSessionId(), replayBuffer: getTerminalReplayBuffer() };

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
