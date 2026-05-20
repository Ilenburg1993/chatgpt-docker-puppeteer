// @ts-check
/**
 * Comando `/events` — consulta o archive duravel de eventos SSE publicos do terminal.
 *
 * @module copilot/terminal/commands/events
 */

import { readTerminalSseEventArchiveTail } from '../state/index.js';

/**
 * @typedef {object} EventsContext
 * @property {(text: string) => void} println
 */

/**
 * @param {string} arg
 * @returns {{ limit: number; event: string | null; traceId: string | null; turnId: string | null; source: string | null; toolCallId: string | null; requestId: string | null; hubSessionId: string | null }}
 */
function parseEventsArg(arg) {
    const tokens = arg.trim().split(/\s+/u).filter(Boolean);
    let limit = 20;
    /** @type {string | null} */
    let event = null;
    /** @type {string | null} */
    let traceId = null;
    /** @type {string | null} */
    let turnId = null;
    /** @type {string | null} */
    let source = null;
    /** @type {string | null} */
    let toolCallId = null;
    /** @type {string | null} */
    let requestId = null;
    /** @type {string | null} */
    let hubSessionId = null;
    for (const token of tokens) {
        if (/^\d+$/u.test(token)) {
            limit = Math.min(500, Math.max(1, Number(token)));
        } else if (token.startsWith('event=')) {
            event = token.slice('event='.length) || null;
        } else if (token.startsWith('trace=')) {
            traceId = token.slice('trace='.length) || null;
        } else if (token.startsWith('traceId=')) {
            traceId = token.slice('traceId='.length) || null;
        } else if (token.startsWith('turn=')) {
            turnId = token.slice('turn='.length) || null;
        } else if (token.startsWith('turnId=')) {
            turnId = token.slice('turnId='.length) || null;
        } else if (token.startsWith('source=')) {
            source = token.slice('source='.length) || null;
        } else if (token.startsWith('tool=')) {
            toolCallId = token.slice('tool='.length) || null;
        } else if (token.startsWith('toolCall=')) {
            toolCallId = token.slice('toolCall='.length) || null;
        } else if (token.startsWith('toolCallId=')) {
            toolCallId = token.slice('toolCallId='.length) || null;
        } else if (token.startsWith('call=')) {
            toolCallId = token.slice('call='.length) || null;
        } else if (token.startsWith('request=')) {
            requestId = token.slice('request='.length) || null;
        } else if (token.startsWith('requestId=')) {
            requestId = token.slice('requestId='.length) || null;
        } else if (token.startsWith('req=')) {
            requestId = token.slice('req='.length) || null;
        } else if (token.startsWith('hub=')) {
            hubSessionId = token.slice('hub='.length) || null;
        } else if (token.startsWith('hubSession=')) {
            hubSessionId = token.slice('hubSession='.length) || null;
        } else if (token.startsWith('hubSessionId=')) {
            hubSessionId = token.slice('hubSessionId='.length) || null;
        } else if (!event) {
            event = token;
        }
    }
    return { limit, event, traceId, turnId, source, toolCallId, requestId, hubSessionId };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function compact(value) {
    const text = typeof value === 'string' ? value : value == null ? '' : String(value);
    return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function summarizePayload(payload) {
    const toolName = payload['toolName'] ?? payload['tool'];
    const toolCallId = payload['toolCallId'] ?? payload['callId'];
    const requestId = payload['requestId'] ?? payload['pendingRequestId'];
    const content = payload['content'] ?? payload['chunk'] ?? payload['question'] ?? payload['message'] ?? null;
    const status = payload['status'] ?? payload['type'] ?? payload['classification'] ?? null;
    return [
        toolName ? `tool=${compact(toolName)}` : null,
        toolCallId ? `call=${compact(toolCallId)}` : null,
        requestId ? `req=${compact(requestId)}` : null,
        status ? `status=${compact(status)}` : null,
        content ? compact(content) : null,
    ]
        .filter(Boolean)
        .join(' · ');
}

/**
 * @param {EventsContext} ctx
 * @param {string} [arg]
 * @returns {Promise<void>}
 */
export async function cmdEvents({ println }, arg = '') {
    const query = parseEventsArg(arg);
    const projection = await readTerminalSseEventArchiveTail(query);
    const { state, entries, filters } = projection;
    const filterParts = [
        filters.event ? `event=${filters.event}` : null,
        filters.traceId ? `trace=${filters.traceId}` : null,
        filters.turnId ? `turn=${filters.turnId}` : null,
        filters.source ? `source=${filters.source}` : null,
        filters.toolCallId ? `tool=${filters.toolCallId}` : null,
        filters.requestId ? `request=${filters.requestId}` : null,
        filters.hubSessionId ? `hub=${filters.hubSessionId}` : null,
    ].filter(Boolean);

    println(`\n  \x1b[36m🧾 Eventos SSE — últimas ${filters.limit}\x1b[0m`);
    println(
        `  \x1b[90marquivo=${state.path ?? '(sem arquivo)'} · eventos=${state.events} · fila=${state.queueDepth} · filtro=${filterParts.join(' ') || 'nenhum'}\x1b[0m`,
    );
    if (state.error) {
        println(`  \x1b[31merro=${state.error}\x1b[0m`);
    }
    if (entries.length === 0) {
        println('  \x1b[33mNenhum evento encontrado no archive SSE.\x1b[0m\n');
        return;
    }

    for (const entry of entries) {
        const time = new Date(entry.timestamp).toLocaleTimeString('pt-BR');
        const origin = entry.eventSource ?? entry.source ?? '-';
        const trace = entry.traceId ? ` · trace=${entry.traceId}` : '';
        const turn = entry.turnId ? ` · turn=${entry.turnId}` : '';
        const hub = entry.hubSessionId ? ` · hub=${entry.hubSessionId}` : '';
        const summary = summarizePayload(entry.payload ?? {});
        println(
            `    \x1b[90m${time}\x1b[0m  #${entry.eventId} \x1b[33m${entry.event}\x1b[0m  \x1b[90m${origin}${trace}${turn}${hub}\x1b[0m${summary ? ` — ${summary}` : ''}`,
        );
    }
    println('');
}
