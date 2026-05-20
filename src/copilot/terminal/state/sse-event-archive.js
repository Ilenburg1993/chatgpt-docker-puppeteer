// @ts-check
/**
 * Archive JSONL canonico dos eventos publicos SSE do terminal.
 *
 * `broadcastSse()` e o fanout unico para delta, tools, user_input, usage, errors e lifecycle. Persistir nesse ponto
 * evita instrumentacao paralela por evento e garante que a auditoria duravel reflita exatamente o que foi publicado.
 *
 * @module copilot/terminal/state/sse-event-archive
 */

import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toError } from '../../core/error-handlers.js';

const TERMINAL_SSE_EVENT_ARCHIVE_DIR = join(process.cwd(), 'data', 'copilot-terminal', 'sse-events');
const TERMINAL_SSE_EVENT_ARCHIVE_SOFT_QUEUE = 10_000;
const TERMINAL_SSE_EVENT_ARCHIVE_CATASTROPHIC_QUEUE = 100_000;
const TERMINAL_SSE_EVENT_ARCHIVE_BATCH_LINES = 256;

/** @type {string | null} */
let _terminalSseEventArchivePath = null;
/** @type {string | null} */
let _terminalSseEventArchiveError = null;
/** @type {string[]} */
let _terminalSseEventArchiveQueue = [];
let _terminalSseEventArchiveFlushScheduled = false;
let _terminalSseEventArchiveFlushInFlight = false;
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
function resolveTerminalSseEventArchivePath() {
    if (_terminalSseEventArchivePath) return _terminalSseEventArchivePath;
    const day = new Date().toISOString().slice(0, 10);
    _terminalSseEventArchivePath = join(TERMINAL_SSE_EVENT_ARCHIVE_DIR, `terminal-sse-events-${day}.jsonl`);
    return _terminalSseEventArchivePath;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function readOptionalString(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
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
    if (_terminalSseEventArchiveFlushInFlight || _terminalSseEventArchiveQueue.length === 0) return;
    _terminalSseEventArchiveFlushInFlight = true;
    try {
        const batch = _terminalSseEventArchiveQueue.splice(0, TERMINAL_SSE_EVENT_ARCHIVE_BATCH_LINES);
        if (batch.length === 0) return;
        await mkdir(TERMINAL_SSE_EVENT_ARCHIVE_DIR, { recursive: true });
        const content = batch.join('');
        await appendFile(resolveTerminalSseEventArchivePath(), content, 'utf8');
        _terminalSseEventArchiveBytes += Buffer.byteLength(content, 'utf8');
        _terminalSseEventArchiveError = null;
    } catch (error) {
        _terminalSseEventArchiveError = toError(error).message;
        _terminalSseEventArchiveFailedEvents += 1;
    } finally {
        _terminalSseEventArchiveFlushInFlight = false;
        if (_terminalSseEventArchiveQueue.length > 0) scheduleTerminalSseEventArchiveFlush();
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
 * @returns {void}
 */
export function resetTerminalSseEventArchiveForTests() {
    _terminalSseEventArchivePath = null;
    _terminalSseEventArchiveError = null;
    _terminalSseEventArchiveQueue = [];
    _terminalSseEventArchiveFlushScheduled = false;
    _terminalSseEventArchiveFlushInFlight = false;
    _terminalSseEventArchiveEvents = 0;
    _terminalSseEventArchiveBytes = 0;
    _terminalSseEventArchiveFailedEvents = 0;
    _terminalSseEventArchiveDroppedEvents = 0;
    _terminalSseEventArchiveLastEventId = null;
}
