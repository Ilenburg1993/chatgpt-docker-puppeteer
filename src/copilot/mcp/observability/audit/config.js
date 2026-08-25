// @ts-check
/**
 * Immutable process configuration for MCP audit persistence.
 *
 * File identity and write policy are process-generation decisions. The audit service consumes this projection and must
 * never rediscover them from ambient state while tool calls are executing.
 *
 * @module copilot/mcp/observability/audit/config
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MCP_AUDIT_PROCESS_CONFIG_SCHEMA_VERSION = 1;
export const MCP_AUDIT_PROCESS_CONFIG_KIND = 'copilot-mcp-audit-process-config';
export const DEFAULT_MCP_AUDIT_DIR = fileURLToPath(new URL('../../../.ai/audit/', import.meta.url));
export const DEFAULT_MCP_AUDIT_FILE = path.join(DEFAULT_MCP_AUDIT_DIR, 'mcp-tool-calls.jsonl');

/**
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-audit-process-config';
 *     filePath: string;
 *     disabled: boolean;
 *     sync: boolean;
 *     configKey: string;
 * }>} McpAuditProcessConfig
 */

/**
 * Capture one immutable audit process generation.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpAuditProcessConfig}
 */
export function readMcpAuditProcessConfig(env = process.env) {
    const filePath = path.resolve(
        String(env['COPILOT_MCP_AUDIT_FILE'] ?? DEFAULT_MCP_AUDIT_FILE).trim() || DEFAULT_MCP_AUDIT_FILE,
    );
    const disabled = readBoolean(env['COPILOT_MCP_AUDIT_DISABLED'], false);
    const sync = readBoolean(env['COPILOT_MCP_AUDIT_SYNC'], false);
    const configKey = createHash('sha256')
        .update(`${filePath}\n${disabled ? '1' : '0'}\n${sync ? '1' : '0'}`)
        .digest('hex');
    return Object.freeze({
        schemaVersion: MCP_AUDIT_PROCESS_CONFIG_SCHEMA_VERSION,
        kind: MCP_AUDIT_PROCESS_CONFIG_KIND,
        filePath,
        disabled,
        sync,
        configKey,
    });
}

/** @param {unknown} value @param {boolean} fallback */
function readBoolean(value, fallback) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}
