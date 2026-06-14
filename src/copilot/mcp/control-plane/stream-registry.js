// @ts-check
/**
 * Process-local registry for MCP Streamable HTTP SSE streams.
 *
 * The registry is observational and cleanup-oriented. It does not own transport delivery and does not persist raw
 * Mcp-Session-Id values; stream/session identifiers are hashed or generated locally.
 *
 * @module copilot/mcp/control-plane/stream-registry
 */

import { randomUUID } from 'node:crypto';
import { hashMcpHttpSessionId, previewMcpHttpSessionId, validateRawSessionId } from './session-runtime.js';

export const MCP_STREAM_REGISTRY_VERSION = '0.2.0';

/**
 * @typedef {'standalone-get-sse' | 'post-sse'} McpHttpStreamKind
 * @typedef {{ streamKey: string; sessionIdHash: string; sessionIdPreview: string; kind: McpHttpStreamKind; openedAtMs: number; lastSeenAtMs: number; closedAtMs: number | null; closeReason: string | null }} McpHttpStreamRecord
 * @typedef {{ now?: () => number }} McpHttpStreamRegistryOptions
 */

/**
 * @param {McpHttpStreamRegistryOptions} [options]
 */
export function createMcpHttpStreamRegistry(options = {}) {
    const now = options.now ?? (() => Date.now());
    /** @type {Map<string, McpHttpStreamRecord>} */
    const streams = new Map();
    const counters = { opened: 0, closed: 0, closedBySession: 0 };

    return {
        /**
         * @param {{ sessionId: string; kind: McpHttpStreamKind }} input
         * @returns {McpHttpStreamRecord}
         */
        open(input) {
            const sessionId = validateRawSessionId(input.sessionId);
            const current = now();
            const record = {
                streamKey: randomUUID(),
                sessionIdHash: hashMcpHttpSessionId(sessionId),
                sessionIdPreview: previewMcpHttpSessionId(sessionId),
                kind: input.kind,
                openedAtMs: current,
                lastSeenAtMs: current,
                closedAtMs: null,
                closeReason: null,
            };
            streams.set(record.streamKey, record);
            counters.opened += 1;
            return { ...record };
        },
        /**
         * @param {string} streamKey
         * @param {string} [reason]
         * @returns {boolean}
         */
        close(streamKey, reason = 'closed') {
            const record = streams.get(streamKey);
            if (!record) return false;
            markClosed(record, reason, now());
            streams.delete(streamKey);
            counters.closed += 1;
            return true;
        },
        /**
         * @param {string} sessionId
         * @param {string} [reason]
         * @returns {number}
         */
        closeBySession(sessionId, reason = 'session_closed') {
            const sessionIdHash = hashMcpHttpSessionId(validateRawSessionId(sessionId));
            let closed = 0;
            for (const [streamKey, record] of streams) {
                if (record.sessionIdHash !== sessionIdHash) continue;
                markClosed(record, reason, now());
                streams.delete(streamKey);
                counters.closed += 1;
                closed += 1;
            }
            counters.closedBySession += closed;
            return closed;
        },
        /**
         * @param {string} streamKey
         * @returns {boolean}
         */
        touch(streamKey) {
            const record = streams.get(streamKey);
            if (!record) return false;
            record.lastSeenAtMs = now();
            return true;
        },
        /**
         * @returns {Record<string, unknown>}
         */
        snapshot() {
            return {
                version: MCP_STREAM_REGISTRY_VERSION,
                activeStreams: streams.size,
                counters: { ...counters },
                streams: [...streams.values()].map((record) => ({ ...record })),
            };
        },
        /** @returns {void} */
        reset() {
            streams.clear();
            counters.opened = 0;
            counters.closed = 0;
            counters.closedBySession = 0;
        },
    };
}

const defaultMcpHttpStreamRegistry = createMcpHttpStreamRegistry();

/**
 * @returns {ReturnType<typeof createMcpHttpStreamRegistry>}
 */
export function getDefaultMcpHttpStreamRegistry() {
    return defaultMcpHttpStreamRegistry;
}

/**
 * @param {McpHttpStreamRecord} record
 * @param {string} reason
 * @param {number} nowMs
 * @returns {void}
 */
function markClosed(record, reason, nowMs) {
    record.lastSeenAtMs = nowMs;
    record.closedAtMs = nowMs;
    record.closeReason = reason;
}
