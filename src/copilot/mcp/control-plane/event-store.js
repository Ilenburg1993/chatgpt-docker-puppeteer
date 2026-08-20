// @ts-check
/**
 * Bounded MCP Streamable HTTP event stores.
 *
 * The SDK EventStore contract is intentionally small: persist a JSON-RPC message for a stream and replay messages after
 * a known event id by invoking a provided sender callback. This module keeps event IDs stream-scoped and avoids logging
 * JSON-RPC payloads.
 *
 * @module copilot/mcp/control-plane/event-store
 */

import { getCopilotDb } from '#copilot/db';
import { randomUUID } from 'node:crypto';

export const MCP_EVENT_STORE_VERSION = '0.1.0';
export const DEFAULT_MCP_EVENTS_PER_STREAM = 500;
export const DEFAULT_MCP_EVENT_TTL_MS = 10 * 60 * 1000;

const EVENT_ID_PATTERN = /^([^\s.]+)\.(\d+)\.([0-9a-f-]{36})$/u;

/**
 * @typedef {{ send: (message: import('@modelcontextprotocol/sdk/types.js').JSONRPCMessage) => Promise<void> | void }} McpEventReplaySink
 *
 * @typedef {{
 *     eventId: string;
 *     streamId: string;
 *     sequence: number;
 *     message: import('@modelcontextprotocol/sdk/types.js').JSONRPCMessage;
 *     createdAtMs: number;
 *     expiresAtMs: number;
 * }} McpStoredEvent
 *
 * @typedef {{ maxEventsPerStream?: number; eventTtlMs?: number; now?: () => number }} McpEventStoreOptions
 *
 * @typedef {{
 *     storeEvent(
 *         streamId: string,
 *         message: import('@modelcontextprotocol/sdk/types.js').JSONRPCMessage,
 *     ): Promise<string>;
 *     replayEventsAfter(lastEventId: string, sink: McpEventReplaySink): Promise<string>;
 * }} McpSdkCompatibleEventStore
 */

/**
 * @param {McpEventStoreOptions} [options]
 * @returns {McpSdkCompatibleEventStore & { snapshot(): Record<string, unknown>; clear(): void }}
 */
export function createMcpInMemoryEventStore(options = {}) {
    const maxEventsPerStream = normalizePositiveInteger(options.maxEventsPerStream, DEFAULT_MCP_EVENTS_PER_STREAM, 1);
    const eventTtlMs = normalizePositiveInteger(options.eventTtlMs, DEFAULT_MCP_EVENT_TTL_MS, 10_000);
    const now = options.now ?? (() => Date.now());
    /** @type {Map<string, McpStoredEvent[]>} */
    const streams = new Map();
    /** @type {Map<string, McpStoredEvent>} */
    const eventsById = new Map();

    return {
        async storeEvent(streamId, message) {
            const normalizedStreamId = normalizeStreamId(streamId);
            const events = streams.get(normalizedStreamId) ?? [];
            const sequence = Number(events[events.length - 1]?.sequence ?? 0) + 1;
            const event = {
                eventId: buildMcpEventId(normalizedStreamId, sequence),
                streamId: normalizedStreamId,
                sequence,
                message,
                createdAtMs: now(),
                expiresAtMs: now() + eventTtlMs,
            };
            events.push(event);
            streams.set(normalizedStreamId, trimStreamEvents(events, maxEventsPerStream, now()));
            rebuildEventIndex(streams, eventsById);
            return event.eventId;
        },
        async replayEventsAfter(lastEventId, sink) {
            const parsed = parseMcpEventId(lastEventId);
            const events = streams.get(parsed.streamId) ?? [];
            const replayable = events.filter((event) => event.sequence > parsed.sequence && event.expiresAtMs > now());
            for (const event of replayable) {
                await sink.send(event.message);
            }
            return parsed.streamId;
        },
        snapshot() {
            return {
                version: MCP_EVENT_STORE_VERSION,
                streamCount: streams.size,
                eventCount: eventsById.size,
                maxEventsPerStream,
                eventTtlMs,
                streams: [...streams.entries()].map(([streamId, events]) => ({
                    streamId,
                    eventCount: events.length,
                    firstSequence: events[0]?.sequence ?? 0,
                    lastSequence: events.at(-1)?.sequence ?? 0,
                })),
            };
        },
        clear() {
            streams.clear();
            eventsById.clear();
        },
    };
}

/**
 * @param {McpEventStoreOptions & { db?: import('better-sqlite3').Database }} [options]
 * @returns {McpSdkCompatibleEventStore & { snapshot(): Record<string, unknown>; clear(): void }}
 */
export function createSqliteMcpEventStore(options = {}) {
    const db = options.db ?? getCopilotDb();
    ensureMcpEventStoreSchema(db);
    const maxEventsPerStream = normalizePositiveInteger(options.maxEventsPerStream, DEFAULT_MCP_EVENTS_PER_STREAM, 1);
    const eventTtlMs = normalizePositiveInteger(options.eventTtlMs, DEFAULT_MCP_EVENT_TTL_MS, 10_000);
    const now = options.now ?? (() => Date.now());

    return {
        async storeEvent(streamId, message) {
            const normalizedStreamId = normalizeStreamId(streamId);
            const last = db
                .prepare(
                    'SELECT sequence FROM copilot_mcp_http_events WHERE stream_id = ? ORDER BY sequence DESC LIMIT 1',
                )
                .get(normalizedStreamId);
            const sequence = Number(/** @type {{ sequence?: number } | undefined} */ (last)?.sequence ?? 0) + 1;
            const eventId = buildMcpEventId(normalizedStreamId, sequence);
            db.prepare(
                `INSERT INTO copilot_mcp_http_events (
                    event_id, stream_id, sequence, message_json, created_at_ms, expires_at_ms
                 ) VALUES (?, ?, ?, ?, ?, ?)`,
            ).run(eventId, normalizedStreamId, sequence, JSON.stringify(message), now(), now() + eventTtlMs);
            pruneSqliteStream(db, normalizedStreamId, maxEventsPerStream, now());
            return eventId;
        },
        async replayEventsAfter(lastEventId, sink) {
            const parsed = parseMcpEventId(lastEventId);
            const rows = db
                .prepare(
                    `SELECT message_json FROM copilot_mcp_http_events
                     WHERE stream_id = ? AND sequence > ? AND expires_at_ms > ?
                     ORDER BY sequence ASC`,
                )
                .all(parsed.streamId, parsed.sequence, now());
            for (const row of rows) {
                const message = parseJsonRpcMessage(/** @type {{ message_json?: string }} */ (row).message_json);
                if (message) await sink.send(message);
            }
            return parsed.streamId;
        },
        snapshot() {
            const aggregate = db
                .prepare(
                    'SELECT COUNT(DISTINCT stream_id) AS streamCount, COUNT(*) AS eventCount FROM copilot_mcp_http_events',
                )
                .get();
            return {
                version: MCP_EVENT_STORE_VERSION,
                streamCount: Number(/** @type {{ streamCount?: number } | undefined} */ (aggregate)?.streamCount ?? 0),
                eventCount: Number(/** @type {{ eventCount?: number } | undefined} */ (aggregate)?.eventCount ?? 0),
                maxEventsPerStream,
                eventTtlMs,
                durable: true,
            };
        },
        clear() {
            db.prepare('DELETE FROM copilot_mcp_http_events').run();
        },
    };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {void}
 */
export function ensureMcpEventStoreSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS copilot_mcp_http_events (
            event_id      TEXT PRIMARY KEY,
            stream_id     TEXT NOT NULL,
            sequence      INTEGER NOT NULL,
            message_json  TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL,
            UNIQUE(stream_id, sequence)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idx_mcp_http_events_stream_seq
            ON copilot_mcp_http_events(stream_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_mcp_http_events_expires
            ON copilot_mcp_http_events(expires_at_ms);
    `);
}

/**
 * @param {string} streamId
 * @param {number} sequence
 * @returns {string}
 */
export function buildMcpEventId(streamId, sequence) {
    return `${normalizeStreamId(streamId)}.${Math.max(1, Math.floor(sequence))}.${randomUUID()}`;
}

/**
 * @param {string} eventId
 * @returns {{ streamId: string; sequence: number; nonce: string }}
 */
export function parseMcpEventId(eventId) {
    const match = EVENT_ID_PATTERN.exec(String(eventId ?? '').trim());
    if (!match) throw new Error('Invalid MCP event id.');
    return { streamId: String(match[1]), sequence: Number(match[2]), nonce: String(match[3]) };
}

/**
 * @param {string} streamId
 * @returns {string}
 */
export function normalizeStreamId(streamId) {
    const normalized = String(streamId ?? '').trim();
    if (!normalized) throw new Error('MCP stream id is required.');
    if (normalized.length > 192) throw new Error('MCP stream id is too long.');
    if (/\s|\./u.test(normalized)) throw new Error('MCP stream id contains unsupported characters.');
    return normalized;
}

/**
 * @param {McpStoredEvent[]} events
 * @param {number} maxEventsPerStream
 * @param {number} nowMs
 * @returns {McpStoredEvent[]}
 */
function trimStreamEvents(events, maxEventsPerStream, nowMs) {
    return events.filter((event) => event.expiresAtMs > nowMs).slice(-maxEventsPerStream);
}

/**
 * @param {Map<string, McpStoredEvent[]>} streams
 * @param {Map<string, McpStoredEvent>} eventsById
 * @returns {void}
 */
function rebuildEventIndex(streams, eventsById) {
    eventsById.clear();
    for (const events of streams.values()) {
        for (const event of events) eventsById.set(event.eventId, event);
    }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} streamId
 * @param {number} maxEventsPerStream
 * @param {number} nowMs
 * @returns {void}
 */
function pruneSqliteStream(db, streamId, maxEventsPerStream, nowMs) {
    db.prepare('DELETE FROM copilot_mcp_http_events WHERE expires_at_ms <= ?').run(nowMs);
    db.prepare(
        `DELETE FROM copilot_mcp_http_events
         WHERE stream_id = ? AND sequence NOT IN (
             SELECT sequence FROM copilot_mcp_http_events
             WHERE stream_id = ?
             ORDER BY sequence DESC
             LIMIT ?
         )`,
    ).run(streamId, streamId, maxEventsPerStream);
}

/**
 * @param {unknown} value
 * @returns {import('@modelcontextprotocol/sdk/types.js').JSONRPCMessage | null}
 */
function parseJsonRpcMessage(value) {
    try {
        const parsed = JSON.parse(String(value ?? 'null'));
        return parsed && typeof parsed === 'object'
            ? /** @type {import('@modelcontextprotocol/sdk/types.js').JSONRPCMessage} */ (parsed)
            : null;
    } catch {
        return null;
    }
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} minimum
 * @returns {number}
 */
function normalizePositiveInteger(value, fallback, minimum) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
}
