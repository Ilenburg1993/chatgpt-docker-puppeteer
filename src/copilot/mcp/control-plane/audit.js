// @ts-check
/**
 * MCP audit helpers. Stdout is intentionally never used because stdio transport reserves stdout for JSON-RPC frames.
 *
 * @module copilot/mcp/control-plane/audit
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsonlFileWriter } from '../../infra/io/jsonl-file-writer.js';

const MCP_AUDIT_DIR = fileURLToPath(new URL('../../.ai/audit/', import.meta.url));
const MAX_AUDIT_QUEUE_LINES = 10_000;

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
 * Flush all queued MCP audit events and wait for prior persistence.
 *
 * @returns {Promise<void>}
 */
export async function flushMcpAuditEvents() {
    await mcpAuditWriter.flush();
}

function installBeforeExitFlushHook() {
    if (auditBeforeExitHookInstalled) return;
    auditBeforeExitHookInstalled = true;
    process.once('beforeExit', () => {
        void flushMcpAuditEvents().catch(() => undefined);
    });
}
