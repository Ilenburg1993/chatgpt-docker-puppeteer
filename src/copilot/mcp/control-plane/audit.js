// @ts-check
/**
 * MCP audit helpers. Stdout is intentionally never used because stdio transport reserves stdout for JSON-RPC frames.
 *
 * @module copilot/mcp/control-plane/audit
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { createJsonlBatchQueue } from '#copilot/infra/public/persistence/jsonl/queue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MCP_AUDIT_DIR = fileURLToPath(new URL('../../.ai/audit/', import.meta.url));
const MAX_AUDIT_QUEUE_LINES = 10_000;
const DEFAULT_AUDIT_HISTORY_TAIL_BYTES = 4 * 1024 * 1024;
const MAX_AUDIT_HISTORY_TAIL_BYTES = 16 * 1024 * 1024;
const DEFAULT_AUDIT_HISTORY_EVENTS = 25_000;
const MAX_AUDIT_HISTORY_EVENTS = 100_000;

let auditBeforeExitHookInstalled = false;

// Audit-file identity is a bootstrap decision. Reads and writes must never retarget themselves because process.env was
// mutated after the audit subsystem was initialized.
const MCP_AUDIT_FILE = path.resolve(
    process.env['COPILOT_MCP_AUDIT_FILE'] ?? path.join(MCP_AUDIT_DIR, 'mcp-tool-calls.jsonl'),
);
const MCP_AUDIT_FS = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'mcp.control-plane.audit',
        exactPaths: [MCP_AUDIT_FILE],
        operations: ['append', 'read'],
        symlinkPolicy: 'deny',
        durability: ['file-and-directory', 'none'],
    }),
);

const mcpAuditWriter = createJsonlBatchQueue({
    persistBatch: async (data) => {
        await MCP_AUDIT_FS.appendText(MCP_AUDIT_FILE, data, { mode: 0o600, durability: 'none' });
    },
    maxQueueLines: MAX_AUDIT_QUEUE_LINES,
    softQueueLines: MAX_AUDIT_QUEUE_LINES - 1,
    onError: (error) => {
        logMcp('WARN', 'Failed to append MCP audit event batch.', {
            error: error instanceof Error ? error.message : String(error),
        });
    },
});

/**
 * @param {'DEBUG' | 'INFO' | 'WARN' | 'ERROR'} level
 * @param {string} message
 * @param {Record<string, unknown>} [fields]
 * @returns {void}
 */
export function logMcp(level, message, fields) {
    const payload = {
        ts: new Date().toISOString(),
        level,
        component: 'copilot-mcp',
        message,
        ...(fields ? { fields } : {}),
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
}

/**
 * @param {Record<string, unknown>} event
 * @returns {Promise<void>}
 */
export async function appendMcpAuditEvent(event) {
    if (process.env['COPILOT_MCP_AUDIT_DISABLED'] === 'true') return;
    const payload = {
        ts: new Date().toISOString(),
        component: 'copilot-mcp',
        ...event,
    };
    const line = `${JSON.stringify(payload)}\n`;
    mcpAuditWriter.enqueueLine(line);
    installBeforeExitFlushHook();
    if (process.env['COPILOT_MCP_AUDIT_SYNC'] === 'true') {
        await mcpAuditWriter.flush();
        return;
    }
}

/**
 * Read a bounded tail of persisted MCP audit events for longitudinal diagnostics. This never exposes credentials and
 * never accepts a caller-controlled path.
 *
 * @param {{ tailBytes?: number; maxEvents?: number }} [options]
 * @returns {Promise<{
 *     ok: boolean;
 *     fileBytes: number;
 *     tailBytesRead: number;
 *     truncatedByBytes: boolean;
 *     parsedEvents: number;
 *     invalidLines: number;
 *     events: Record<string, unknown>[];
 *     error: string | null;
 * }>}
 */
export async function readMcpAuditEventTail(options = {}) {
    const tailBytes = boundedInteger(
        options.tailBytes,
        DEFAULT_AUDIT_HISTORY_TAIL_BYTES,
        64 * 1024,
        MAX_AUDIT_HISTORY_TAIL_BYTES,
    );
    const maxEvents = boundedInteger(options.maxEvents, DEFAULT_AUDIT_HISTORY_EVENTS, 100, MAX_AUDIT_HISTORY_EVENTS);
    const auditFile = MCP_AUDIT_FILE;
    try {
        await mcpAuditWriter.flush();
        const snapshot = await MCP_AUDIT_FS.readBytesRangeFresh(auditFile, {
            maxBytes: tailBytes,
            fromEnd: true,
            rejectSymlink: true,
        });
        const fileBytes = snapshot.sizeBytes;
        const bytesToRead = snapshot.bytesRead;
        if (bytesToRead <= 0) {
            return {
                ok: true,
                fileBytes,
                tailBytesRead: 0,
                truncatedByBytes: false,
                parsedEvents: 0,
                invalidLines: 0,
                events: [],
                error: null,
            };
        }
        let text = snapshot.content.toString('utf8');
        const truncatedByBytes = snapshot.truncatedBefore;
        if (truncatedByBytes) {
            const firstNewline = text.indexOf('\n');
            text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
        }
        /** @type {Record<string, unknown>[]} */
        const parsed = [];
        let invalidLines = 0;
        for (const line of text.split(/\r?\n/u)) {
            if (!line.trim()) continue;
            try {
                const value = JSON.parse(line);
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    parsed.push(/** @type {Record<string, unknown>} */ (value));
                } else invalidLines += 1;
            } catch {
                invalidLines += 1;
            }
        }
        const events = parsed.slice(-maxEvents);
        return {
            ok: true,
            fileBytes,
            tailBytesRead: bytesToRead,
            truncatedByBytes,
            parsedEvents: events.length,
            invalidLines,
            events,
            error: null,
        };
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (code === 'ENOENT') {
            return {
                ok: true,
                fileBytes: 0,
                tailBytesRead: 0,
                truncatedByBytes: false,
                parsedEvents: 0,
                invalidLines: 0,
                events: [],
                error: null,
            };
        }
        return {
            ok: false,
            fileBytes: 0,
            tailBytesRead: 0,
            truncatedByBytes: false,
            parsedEvents: 0,
            invalidLines: 0,
            events: [],
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Read a bounded, newline-aligned audit slice beginning at an exact byte offset. The returned nextOffset always points
 * immediately after the last complete newline, so callers can checkpoint it without reparsing or skipping a partial
 * JSON line. The file identity lets derived indexes detect rotation/replacement.
 *
 * @param {{ offset?: number; maxBytes?: number; maxEvents?: number }} [options]
 */
export async function readMcpAuditEventSlice(options = {}) {
    const requestedOffset = Math.max(0, Math.floor(Number(options.offset ?? 0) || 0));
    const maxBytes = boundedInteger(options.maxBytes, 4 * 1024 * 1024, 64 * 1024, 16 * 1024 * 1024);
    const maxEvents = boundedInteger(options.maxEvents, 50_000, 100, 200_000);
    const auditFile = MCP_AUDIT_FILE;
    try {
        await mcpAuditWriter.flush();
        let snapshot = await MCP_AUDIT_FS.readBytesRangeFresh(auditFile, {
            start: requestedOffset,
            maxBytes,
            rejectSymlink: true,
        });
        const resetRequired = requestedOffset > snapshot.sizeBytes;
        if (resetRequired) {
            snapshot = await MCP_AUDIT_FS.readBytesRangeFresh(auditFile, {
                start: 0,
                maxBytes,
                rejectSymlink: true,
            });
        }
        const fileBytes = snapshot.sizeBytes;
        const fileIdentity = `${String(snapshot.dev)}:${String(snapshot.ino)}`;
        const startOffset = resetRequired ? 0 : requestedOffset;
        const bytesToRead = snapshot.bytesRead;
        if (bytesToRead <= 0) {
            return {
                ok: true,
                fileIdentity,
                fileBytes,
                requestedOffset,
                startOffset,
                nextOffset: startOffset,
                bytesRead: 0,
                complete: startOffset >= fileBytes,
                resetRequired,
                parsedEvents: 0,
                invalidLines: 0,
                events: [],
                error: null,
            };
        }

        const buffer = snapshot.content;
        let completeBytes = bytesToRead;
        const reachedEof = !snapshot.truncatedAfter;
        if (!reachedEof) {
            const lastNewline = buffer.lastIndexOf(0x0a);
            completeBytes = lastNewline >= 0 ? lastNewline + 1 : 0;
        }
        const text = completeBytes > 0 ? buffer.subarray(0, completeBytes).toString('utf8') : '';
        /** @type {Record<string, unknown>[]} */
        const events = [];
        /** @type {{ sourceOffset: number; event: Record<string, unknown> }[]} */
        const entries = [];
        let invalidLines = 0;
        let lineOffset = startOffset;
        for (const rawLine of text.split('\n')) {
            const lineBytes = Buffer.byteLength(rawLine, 'utf8') + 1;
            const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
            if (line.trim()) {
                try {
                    const value = JSON.parse(line);
                    if (value && typeof value === 'object' && !Array.isArray(value)) {
                        if (events.length < maxEvents) {
                            const event = /** @type {Record<string, unknown>} */ (value);
                            events.push(event);
                            entries.push({ sourceOffset: lineOffset, event });
                        }
                    } else invalidLines += 1;
                } catch {
                    invalidLines += 1;
                }
            }
            lineOffset += lineBytes;
        }
        const nextOffset = startOffset + completeBytes;
        return {
            ok: true,
            fileIdentity,
            fileBytes,
            requestedOffset,
            startOffset,
            nextOffset,
            bytesRead: completeBytes,
            complete: nextOffset >= fileBytes,
            resetRequired,
            parsedEvents: events.length,
            invalidLines,
            events,
            entries,
            error: null,
        };
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (code === 'ENOENT') {
            return {
                ok: true,
                fileIdentity: null,
                fileBytes: 0,
                requestedOffset,
                startOffset: 0,
                nextOffset: 0,
                bytesRead: 0,
                complete: true,
                resetRequired: requestedOffset > 0,
                parsedEvents: 0,
                invalidLines: 0,
                events: [],
                error: null,
            };
        }
        return {
            ok: false,
            fileIdentity: null,
            fileBytes: 0,
            requestedOffset,
            startOffset: 0,
            nextOffset: 0,
            bytesRead: 0,
            complete: false,
            resetRequired: false,
            parsedEvents: 0,
            invalidLines: 0,
            events: [],
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Flush all queued MCP audit events and wait for prior persistence.
 *
 * @returns {Promise<void>}
 */
export async function flushMcpAuditEvents() {
    await mcpAuditWriter.flush();
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function boundedInteger(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function installBeforeExitFlushHook() {
    if (auditBeforeExitHookInstalled) return;
    auditBeforeExitHookInstalled = true;
    process.once('beforeExit', () => {
        void flushMcpAuditEvents().catch(() => undefined);
    });
}
