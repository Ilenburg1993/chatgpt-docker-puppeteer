// @ts-check
/**
 * MCP audit helpers. Stdout is intentionally never used because stdio transport reserves stdout for JSON-RPC frames.
 *
 * @module copilot/mcp/control-plane/audit
 */

import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsonlFileWriter } from '../../infra/io/jsonl-file-writer.js';

const MCP_AUDIT_DIR = fileURLToPath(new URL('../../.ai/audit/', import.meta.url));
const MAX_AUDIT_QUEUE_LINES = 10_000;
const DEFAULT_AUDIT_HISTORY_TAIL_BYTES = 4 * 1024 * 1024;
const MAX_AUDIT_HISTORY_TAIL_BYTES = 16 * 1024 * 1024;
const DEFAULT_AUDIT_HISTORY_EVENTS = 25_000;
const MAX_AUDIT_HISTORY_EVENTS = 100_000;

let auditBeforeExitHookInstalled = false;

/**
 * @returns {string}
 */
function getMcpAuditFile() {
    return process.env['COPILOT_MCP_AUDIT_FILE'] ?? path.join(MCP_AUDIT_DIR, 'mcp-tool-calls.jsonl');
}

const mcpAuditWriter = createJsonlFileWriter({
    filePath: getMcpAuditFile,
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
 * Read a bounded tail of persisted MCP audit events for longitudinal diagnostics.
 * This never exposes credentials and never accepts a caller-controlled path.
 *
 * @param {{ tailBytes?: number; maxEvents?: number }} [options]
 * @returns {Promise<{
 *   ok: boolean;
 *   fileBytes: number;
 *   tailBytesRead: number;
 *   truncatedByBytes: boolean;
 *   parsedEvents: number;
 *   invalidLines: number;
 *   events: Record<string, unknown>[];
 *   error: string | null;
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
    const auditFile = getMcpAuditFile();
    try {
        await mcpAuditWriter.flush();
        const stats = await lstat(auditFile);
        if (stats.isSymbolicLink() || !stats.isFile()) {
            return {
                ok: false,
                fileBytes: Number(stats.size ?? 0),
                tailBytesRead: 0,
                truncatedByBytes: false,
                parsedEvents: 0,
                invalidLines: 0,
                events: [],
                error: 'MCP audit path is not a regular file.',
            };
        }
        const fileBytes = Number(stats.size ?? 0);
        const bytesToRead = Math.min(fileBytes, tailBytes);
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
        const buffer = Buffer.allocUnsafe(bytesToRead);
        const offset = Math.max(0, fileBytes - bytesToRead);
        const handle = await open(auditFile, 'r');
        try {
            await handle.read(buffer, 0, bytesToRead, offset);
        } finally {
            await handle.close();
        }
        let text = buffer.toString('utf8');
        const truncatedByBytes = offset > 0;
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
