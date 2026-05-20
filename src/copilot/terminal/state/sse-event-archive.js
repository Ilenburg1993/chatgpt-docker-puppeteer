// @ts-check
/**
 * Archive JSONL canonico dos eventos publicos SSE do terminal.
 *
 * `broadcastSse()` e o fanout unico para delta, tools, user_input, usage, errors e lifecycle. Persistir nesse ponto
 * evita instrumentacao paralela por evento e garante que a auditoria duravel reflita exatamente o que foi publicado.
 *
 * @module copilot/terminal/state/sse-event-archive
 */

import { mkdir, appendFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { toError } from '../../core/error-handlers.js';

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
let _terminalSseEventArchiveError = null;
/** @type {string[]} */
let _terminalSseEventArchiveQueue = [];
let _terminalSseEventArchiveFlushScheduled = false;
let _terminalSseEventArchiveFlushInFlight = false;
/** @type {Promise<void> | null} */
let _terminalSseEventArchiveFlushPromise = null;
let _terminalSseEventArchiveEvents = 0;
let _terminalSseEventArchiveBytes = 0;
let _terminalSseEventArchiveFailedEvents = 0;
let _terminalSseEventArchiveDroppedEvents = 0;
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
    if (_terminalSseEventArchivePath) return _terminalSseEventArchivePath;
    const day = new Date().toISOString().slice(0, 10);
    _terminalSseEventArchivePath = join(resolveTerminalSseEventArchiveDir(), `terminal-sse-events-${day}.jsonl`);
    return _terminalSseEventArchivePath;
}

/**
 * @param {string} filePath
 * @param {number} [n=50]
 * @returns {Promise<string[]>}
 */
async function readLastNLines(filePath, n = 50) {
    const blockSize = 65_536;
    let fileHandle;
    try {
        fileHandle = await open(filePath, 'r');
        const { size } = await fileHandle.stat();
        if (size === 0) return [];
        let remaining = size;
        let tail = '';
        /** @type {string[]} */
        const lines = [];
        while (remaining > 0 && lines.length < n) {
            const readSize = Math.min(blockSize, remaining);
            remaining -= readSize;
            const buffer = Buffer.alloc(readSize);
            await fileHandle.read(buffer, 0, readSize, remaining);
            tail = buffer.toString('utf8') + tail;
            const split = tail.split('\n');
            for (let index = split.length - 1; index >= 1 && lines.length < n; index -= 1) {
                const line = split[index];
                if (line?.trim()) lines.unshift(line);
            }
            tail = split[0] ?? '';
        }
        if (tail.trim() && lines.length < n) lines.unshift(tail);
        return lines.slice(-n);
    } catch {
        return [];
    } finally {
        await fileHandle?.close();
    }
}

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
 * @param {number} [depth=0]
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
 * @returns {{ source: string | null; eventSource: string | null; traceId: string | null; turnId: string | null; hubSessionId: string | null }}
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
 * @returns {void}
 */
function scheduleTerminalSseEventArchiveFlush() {
    if (_terminalSseEventArchiveFlushScheduled || _terminalSseEventArchiveFlushInFlight) return;
    _terminalSseEventArchiveFlushScheduled = true;
    setImmediate(() => {
        _terminalSseEventArchiveFlushScheduled = false;
        void flushTerminalSseEventArchive();
    });
}

/**
 * @returns {Promise<void>}
 */
export async function flushTerminalSseEventArchive() {
    if (_terminalSseEventArchiveFlushInFlight) {
        await _terminalSseEventArchiveFlushPromise;
        if (_terminalSseEventArchiveQueue.length === 0) return;
    }
    if (_terminalSseEventArchiveQueue.length === 0) return;
    _terminalSseEventArchiveFlushInFlight = true;
    const flushPromise = (async () => {
        try {
            await mkdir(resolveTerminalSseEventArchiveDir(), { recursive: true });
            while (_terminalSseEventArchiveQueue.length > 0) {
                const batch = _terminalSseEventArchiveQueue.splice(0, TERMINAL_SSE_EVENT_ARCHIVE_BATCH_LINES);
                if (batch.length === 0) break;
                const content = batch.join('');
                await appendFile(resolveTerminalSseEventArchivePath(), content, 'utf8');
                _terminalSseEventArchiveBytes += Buffer.byteLength(content, 'utf8');
            }
            _terminalSseEventArchiveError = null;
        } catch (error) {
            _terminalSseEventArchiveError = toError(error).message;
            _terminalSseEventArchiveFailedEvents += 1;
        } finally {
            _terminalSseEventArchiveFlushInFlight = false;
            if (_terminalSseEventArchiveQueue.length > 0) scheduleTerminalSseEventArchiveFlush();
        }
    })();
    _terminalSseEventArchiveFlushPromise = flushPromise;
    try {
        await flushPromise;
    } finally {
        if (_terminalSseEventArchiveFlushPromise === flushPromise) {
            _terminalSseEventArchiveFlushPromise = null;
        }
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
    const data = input.data && typeof input.data === 'object' ? /** @type {Record<string, unknown>} */ (input.data) : {};
    const timestamp = input.timestamp ?? Date.now();
    const envelope = projectTerminalSseEventEnvelope(data);
    try {
        const record = {
            schemaVersion: 1,
            ts: new Date(timestamp).toISOString(),
            timestamp,
            event: input.event,
            eventId: input.eventId,
            ...envelope,
            payload: data,
        };
        const line = `${JSON.stringify(record)}\n`;
        _terminalSseEventArchiveQueue.push(line);
        _terminalSseEventArchiveEvents += 1;
        _terminalSseEventArchiveLastEventId = input.eventId;

        if (_terminalSseEventArchiveQueue.length > TERMINAL_SSE_EVENT_ARCHIVE_CATASTROPHIC_QUEUE) {
            const overflow = _terminalSseEventArchiveQueue.length - TERMINAL_SSE_EVENT_ARCHIVE_SOFT_QUEUE;
            _terminalSseEventArchiveQueue.splice(0, Math.max(0, overflow));
            _terminalSseEventArchiveDroppedEvents += Math.max(0, overflow);
        }

        scheduleTerminalSseEventArchiveFlush();
        return { queued: true, path: resolveTerminalSseEventArchivePath(), error: null };
    } catch (error) {
        _terminalSseEventArchiveError = toError(error).message;
        _terminalSseEventArchiveFailedEvents += 1;
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
    return {
        enabled: isTerminalSseEventArchiveEnabled(),
        path: _terminalSseEventArchivePath,
        error: _terminalSseEventArchiveError,
        events: _terminalSseEventArchiveEvents,
        bytes: _terminalSseEventArchiveBytes,
        queueDepth: _terminalSseEventArchiveQueue.length,
        flushScheduled: _terminalSseEventArchiveFlushScheduled,
        flushInFlight: _terminalSseEventArchiveFlushInFlight,
        failedEvents: _terminalSseEventArchiveFailedEvents,
        droppedEvents: _terminalSseEventArchiveDroppedEvents,
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
 * @returns {Promise<{ entries: TerminalSseEventArchiveEntry[]; state: ReturnType<typeof readTerminalSseEventArchiveState>; filters: { limit: number; event: string | null; traceId: string | null; turnId: string | null; source: string | null; toolCallId: string | null; requestId: string | null; hubSessionId: string | null } }>}
 */
export async function readTerminalSseEventArchiveTail(input = {}) {
    await flushTerminalSseEventArchive();
    const limit = Number.isFinite(input.limit) && Number(input.limit) > 0 ? Math.min(500, Math.floor(Number(input.limit))) : 20;
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
        return { entries: [], state: readTerminalSseEventArchiveState(), filters };
    }
    const hasFilter = Object.entries(filters).some(([key, value]) => key !== 'limit' && Boolean(value));
    const fetchCount = hasFilter ? limit * 20 : limit;
    const lines = await readLastNLines(path, fetchCount);
    /** @type {TerminalSseEventArchiveEntry[]} */
    const matchedEntries = [];
    for (const line of lines) {
        try {
            const entry = /** @type {TerminalSseEventArchiveEntry} */ (JSON.parse(line));
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
        } catch {
            // JSONL truncado/corrompido não deve quebrar a UX do terminal.
        }
    }
    const entries = matchedEntries.slice(-limit);
    return {
        entries,
        state: readTerminalSseEventArchiveState(),
        filters,
    };
}

/**
 * @returns {void}
 */
export function resetTerminalSseEventArchiveForTests() {
    _terminalSseEventArchivePath = null;
    _terminalSseEventArchiveError = null;
    _terminalSseEventArchiveQueue = [];
    _terminalSseEventArchiveFlushScheduled = false;
    _terminalSseEventArchiveFlushInFlight = false;
    _terminalSseEventArchiveFlushPromise = null;
    _terminalSseEventArchiveEvents = 0;
    _terminalSseEventArchiveBytes = 0;
    _terminalSseEventArchiveFailedEvents = 0;
    _terminalSseEventArchiveDroppedEvents = 0;
    _terminalSseEventArchiveLastEventId = null;
}
