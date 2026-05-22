// @ts-check
/**
 * MCP audit helpers. Stdout is intentionally never used because stdio transport
 * reserves stdout for JSON-RPC frames.
 *
 * @module copilot/mcp/control-plane/audit
 */

import { mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MCP_AUDIT_DIR = fileURLToPath(new URL('../../.ai/audit/', import.meta.url));

/**
 * @returns {string}
 */
function getMcpAuditFile() {
    return process.env['COPILOT_MCP_AUDIT_FILE'] ?? path.join(MCP_AUDIT_DIR, 'mcp-tool-calls.jsonl');
}

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
    try {
        const auditFile = getMcpAuditFile();
        await mkdir(path.dirname(auditFile), { recursive: true });
        await appendFile(auditFile, `${JSON.stringify(payload)}\n`, 'utf8');
    } catch (error) {
        logMcp('WARN', 'Failed to append MCP audit event.', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
