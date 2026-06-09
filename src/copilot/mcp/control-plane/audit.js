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
const MAX_AUDIT_QUEUE_LINES = 10_000;

/** @type {string[]} */
const auditQueue = [];
/** @type {Promise<void>} */
let auditFlushChain = Promise.resolve();
/** @type {{ dir: string; promise: Promise<string | undefined> } | null} */
let auditDirReady = null;
let auditFlushScheduled = false;
let auditBeforeExitHookInstalled = false;

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
    const line = `${JSON.stringify(payload)}\n`;
    if (process.env['COPILOT_MCP_AUDIT_SYNC'] === 'true') {
        await appendAuditLines([line]);
        return;
    }
    enqueueAuditLine(line);
}

/**
 * @param {string} line
 * @returns {void}
 */
function enqueueAuditLine(line) {
    if (auditQueue.length >= MAX_AUDIT_QUEUE_LINES) auditQueue.shift();
    auditQueue.push(line);
    installBeforeExitFlushHook();
    scheduleAuditFlush();
}

function scheduleAuditFlush() {
    if (auditFlushScheduled) return;
    auditFlushScheduled = true;
    setImmediate(() => {
        auditFlushScheduled = false;
        const lines = auditQueue.splice(0);
        if (lines.length === 0) return;
        auditFlushChain = auditFlushChain
            .then(() => appendAuditLines(lines))
            .catch((error) => {
                logMcp('WARN', 'Failed to append MCP audit event batch.', {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
    });
}

function installBeforeExitFlushHook() {
    if (auditBeforeExitHookInstalled) return;
    auditBeforeExitHookInstalled = true;
    process.once('beforeExit', () => {
        const lines = auditQueue.splice(0);
        if (lines.length === 0) return;
        auditFlushChain = auditFlushChain.then(() => appendAuditLines(lines)).catch(() => undefined);
    });
}

/**
 * @param {string[]} lines
 * @returns {Promise<void>}
 */
async function appendAuditLines(lines) {
    if (lines.length === 0) return;
    const auditFile = getMcpAuditFile();
    const dir = path.dirname(auditFile);
    if (!auditDirReady || auditDirReady.dir !== dir) {
        auditDirReady = { dir, promise: mkdir(dir, { recursive: true }) };
    }
    await auditDirReady.promise;
    await appendFile(auditFile, lines.join(''), 'utf8');
}
