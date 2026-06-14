// @ts-check
/**
 * Archive JSONL canonico dos eventos publicos SSE do terminal.
 *
 * `broadcastSse()` e o fanout unico para delta, tools, user_input, usage, errors e lifecycle. Persistir nesse ponto
 * evita instrumentacao paralela por evento e garante que a auditoria duravel reflita exatamente o que foi publicado.
 *
 * @module copilot/terminal/state/sse-event-archive
 */

import { join } from 'node:path';
import { toError } from '../../core/error-handlers.js';
import { redactSecretRecord } from '../../core/security/redaction.js';
import { createJsonlFileWriter } from '../../infra/io/jsonl-file-writer.js';
import { readJsonlTail } from '../../infra/io/jsonl-reader.js';

const DEFAULT_TERMINAL_SSE_EVENT_ARCHIVE_DIR = join(process.cwd(), 'data', 'copilot-terminal', 'sse-events');
const TERMINAL_SSE_EVENT_ARCHIVE_SOFT_QUEUE = 10_000;
const TERMINAL_SSE_EVENT_ARCHIVE_CATASTROPHIC_QUEUE = 100_000;
const TERMINAL_SSE_EVENT_ARCHIVE_BATCH_LINES = 256;

/**
 * @typedef {{
 *     schemaVersion: 1;
 *     ts: string;
 *     timestamp: number;
 *     event: string;
 *     eventId: number;
 *     source: string | null;
 *     eventSource: string | null;
 *     traceId: string | null;
 *     turnId: string | null;
 *     hubSessionId: string | null;
 *     payload: Record<string, unknown>;
 * }} TerminalSseEventArchiveEntry
 */

/** @type {string | null} */
let _terminalSseEventArchivePath = null;
/** @type {string | null} */
let _terminalSseEventArchiveDay = null;
/** @type {string | null} */
let _terminalSseEventArchiveError = null;
let _terminalSseEventArchiveEvents = 0;
let _terminalSseEventArchiveRejectedEvents = 0;
let _terminalSseEventArchiveLastEventId = /** @type {number | null} */ (null);

/**
 * @returns {boolean}
 */
function isTerminalSseEventArchiveEnabled() {
    return process.env['TERMINAL_SSE_EVENT_ARCHIVE_DISABLED'] !== 'true';
}

/**
 * @returns {string}
 */
function resolveTerminalSseEventArchiveDir() {
    const configured = process.env['TERMINAL_SSE_EVENT_ARCHIVE_DIR'];
    return typeof configured === 'string' && configured.trim() ? configured : DEFAULT_TERMINAL_SSE_EVENT_ARCHIVE_DIR;
}

/**
 * @returns {string}
 */
function resolveTerminalSseEventArchivePath() {
    const day = new Date().toISOString().slice(0, 10);
    if (_terminalSseEventArchivePath && _terminalSseEventArchiveDay === day) return _terminalSseEventArchivePath;
    _terminalSseEventArchiveDay = day;
    _terminalSseEventArchivePath = join(resolveTerminalSseEventArchiveDir(), `terminal-sse-events-${day}.jsonl`);
    return _terminalSseEventArchivePath;
}

const terminalSseEventArchiveWriter = createJsonlFileWriter({
    filePath: resolveTerminalSseEventArchivePath,
    batchLines: TERMINAL_SSE_EVENT_ARCHIVE_BATCH_LINES,
    maxQueueLines: TERMINAL_SSE_EVENT_ARCHIVE_CATASTROPHIC_QUEUE,
    softQueueLines: TERMINAL_SSE_EVENT_ARCHIVE_SOFT_QUEUE,
    onError: (error) => {
        _terminalSseEventArchiveError = toError(error).message;
    },
    onSuccess: () => {
        _terminalSseEventArchiveError = null;
    },
});

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function readOptionalString(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string[]} fieldNames
 * @param {number} [depth=0] Default is `0`
 * @returns {string | null}
 */
function findNestedStringField(value, fieldNames, depth = 0) {
    if (!isRecord(value) || depth > 2) return null;
    for (const fieldName of fieldNames) {
        const fieldValue = value[fieldName];
        if (typeof fieldValue === 'string' && fieldValue.length > 0) return fieldValue;
    }
    for (const nestedKey of ['data', 'payload', 'request', 'invocation', 'context', 'toolCall', 'permission']) {
        const nested = value[nestedKey];
        const found = findNestedStringField(nested, fieldNames, depth + 1);
        if (found) return found;
    }
    return null;
}

/**
 * @param {Record<string, unknown>} data
 * @returns {{
 *     source: string | null;
 *     eventSource: string | null;
 *     traceId: string | null;
 *     turnId: string | null;
 *     hubSessionId: string | null;
 * }}
 */
function projectTerminalSseEventEnvelope(data) {
    return {
        source: readOptionalString(data['source']),
        eventSource: readOptionalString(data['eventSource']),
        traceId: readOptionalString(data['traceId']),
        turnId: readOptionalString(data['turnId']),
        hubSessionId: readOptionalString(data['hubSessionId']),
    };
}

/**
 * @returns {Promise<void>}
 */
export async function flushTerminalSseEventArchive() {
    try {
        await terminalSseEventArchiveWriter.flush();
        _terminalSseEventArchiveError = null;
    } catch (error) {
        _terminalSseEventArchiveError = toError(error).message;
    }
}

/**
 * @param {{
 *     event: string;
 *     eventId: number;
 *     data: object;
 *     timestamp?: number;
 * }} input
 * @returns {{ queued: boolean; path: string | null; error: string | null }}
 */
export function recordTerminalSseEventArchive(input) {
    if (!isTerminalSseEventArchiveEnabled()) return { queued: false, path: null, error: null };
    const data =
        input.data && typeof input.data === 'object' ? /** @type {Record<string, unknown>} */ (input.data) : {};
    const safeData = redactSecretRecord(data);
    const timestamp = input.timestamp ?? Date.now();
    const envelope = projectTerminalSseEventEnvelope(safeData);
    try {
        const record = {
            schemaVersion: 1,
            ts: new Date(timestamp).toISOString(),
            timestamp,
            event: input.event,
            eventId: input.eventId,
            ...envelope,
            payload: safeData,
        };
        const line = `${JSON.stringify(record)}\n`;
        terminalSseEventArchiveWriter.enqueueLine(line);
        _terminalSseEventArchiveEvents += 1;
        _terminalSseEventArchiveLastEventId = input.eventId;
        return { queued: true, path: resolveTerminalSseEventArchivePath(), error: null };
    } catch (error) {
        _terminalSseEventArchiveError = toError(error).message;
        _terminalSseEventArchiveRejectedEvents += 1;
        return { queued: false, path: _terminalSseEventArchivePath, error: _terminalSseEventArchiveError };
    }
}

/**
 * @returns {{
 *     enabled: boolean;
 *     path: string | null;
 *     error: string | null;
 *     events: number;
 *     bytes: number;
 *     queueDepth: number;
 *     flushScheduled: boolean;
 *     flushInFlight: boolean;
 *     failedEvents: number;
 *     droppedEvents: number;
 *     lastEventId: number | null;
 * }}
 */
export function readTerminalSseEventArchiveState() {
    const writerState = terminalSseEventArchiveWriter.getState();
    return {
        enabled: isTerminalSseEventArchiveEnabled(),
        path: _terminalSseEventArchivePath,
        error: _terminalSseEventArchiveError,
        events: _terminalSseEventArchiveEvents,
        bytes: writerState.persistedBytes,
        queueDepth: writerState.queueDepth,
        flushScheduled: writerState.scheduled,
        flushInFlight: writerState.inFlight,
        failedEvents: writerState.failedBatches + _terminalSseEventArchiveRejectedEvents,
        droppedEvents: writerState.droppedLines,
        lastEventId: _terminalSseEventArchiveLastEventId,
    };
}

/**
 * @param {{
 *     limit?: number;
 *     event?: string | null;
 *     traceId?: string | null;
 *     turnId?: string | null;
 *     source?: string | null;
 *     toolCallId?: string | null;
 *     requestId?: string | null;
 *     hubSessionId?: string | null;
 * }} [input]
 * @returns {Promise<{
 *     entries: TerminalSseEventArchiveEntry[];
 *     state: ReturnType<typeof readTerminalSseEventArchiveState>;
 *     filters: {
 *         limit: number;
 *         event: string | null;
 *         traceId: string | null;
 *         turnId: string | null;
 *         source: string | null;
 *         toolCallId: string | null;
 *         requestId: string | null;
 *         hubSessionId: string | null;
 *     };
 *     tailRead: {
 *         bytesRead: number;
 *         maxBytes: number;
 *         truncatedByByteLimit: boolean;
 *     };
 * }>}
 */
export async function readTerminalSseEventArchiveTail(input = {}) {
    await flushTerminalSseEventArchive();
    const limit =
        Number.isFinite(input.limit) && Number(input.limit) > 0 ? Math.min(500, Math.floor(Number(input.limit))) : 20;
    const filters = {
        limit,
        event: readOptionalString(input.event),
        traceId: readOptionalString(input.traceId),
        turnId: readOptionalString(input.turnId),
        source: readOptionalString(input.source),
        toolCallId: readOptionalString(input.toolCallId),
        requestId: readOptionalString(input.requestId),
        hubSessionId: readOptionalString(input.hubSessionId),
    };
    const path = _terminalSseEventArchivePath;
    if (!path) {
        return {
            entries: [],
            state: readTerminalSseEventArchiveState(),
            filters,
            tailRead: { bytesRead: 0, maxBytes: 0, truncatedByByteLimit: false },
        };
    }
    const hasFilter = Object.entries(filters).some(([key, value]) => key !== 'limit' && Boolean(value));
    const fetchCount = hasFilter ? limit * 20 : limit;
    const { records, bytesRead, maxBytes, truncatedByByteLimit } = await readJsonlTail(path, {
        maxLines: fetchCount,
    });
    /** @type {TerminalSseEventArchiveEntry[]} */
    const matchedEntries = [];
    for (const record of records) {
        if (!isRecord(record)) continue;
        const entry = /** @type {TerminalSseEventArchiveEntry} */ (record);
        if (filters.event && entry.event !== filters.event) continue;
        if (filters.traceId && entry.traceId !== filters.traceId) continue;
        if (filters.turnId && entry.turnId !== filters.turnId) continue;
        if (filters.source && entry.source !== filters.source && entry.eventSource !== filters.source) continue;
        if (
            filters.hubSessionId &&
            entry.hubSessionId !== filters.hubSessionId &&
            findNestedStringField(entry.payload, ['hubSessionId', 'hub_session_id', 'sessionId']) !==
                filters.hubSessionId
        ) {
            continue;
        }
        if (
            filters.toolCallId &&
            findNestedStringField(entry.payload, ['toolCallId', 'tool_call_id', 'callId']) !== filters.toolCallId
        ) {
            continue;
        }
        if (
            filters.requestId &&
            findNestedStringField(entry.payload, ['requestId', 'request_id', 'pendingRequestId']) !== filters.requestId
        ) {
            continue;
        }
        matchedEntries.push(entry);
    }
    const entries = matchedEntries.slice(-limit);
    return {
        entries,
        state: readTerminalSseEventArchiveState(),
        filters,
        tailRead: { bytesRead, maxBytes, truncatedByByteLimit },
    };
}

/**
 * @returns {void}
 */
export function resetTerminalSseEventArchiveForTests() {
    _terminalSseEventArchivePath = null;
    _terminalSseEventArchiveDay = null;
    _terminalSseEventArchiveError = null;
    terminalSseEventArchiveWriter.reset();
    _terminalSseEventArchiveEvents = 0;
    _terminalSseEventArchiveRejectedEvents = 0;
    _terminalSseEventArchiveLastEventId = null;
}
