// @ts-check
/** Immutable process policy for MCP tools/list payload diagnostics. */

import { MCP_TOOL_EXECUTION_LIMITS } from '#copilot/mcp/public/protocol/tools';

export const MCP_TOOL_PAYLOAD_AUDIT_CONFIG_SCHEMA_VERSION = 1;
export const MCP_TOOL_PAYLOAD_AUDIT_CONFIG_KIND = 'copilot-mcp-tool-payload-audit-config';
export const DEFAULT_MCP_TOOL_PAYLOAD_TOP = 20;
export const DEFAULT_MCP_TOOL_PAYLOAD_MAX_ENVELOPE_BYTES = MCP_TOOL_EXECUTION_LIMITS.toolsList.maxEnvelopeBytes;

/**
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-tool-payload-audit-config';
 *     top: number;
 *     maxEnvelopeBytes: number;
 * }>} McpToolPayloadAuditConfig
 */

/** @param {NodeJS.ProcessEnv} [env] @returns {McpToolPayloadAuditConfig} */
export function readMcpToolPayloadAuditConfig(env = process.env) {
    return Object.freeze({
        schemaVersion: MCP_TOOL_PAYLOAD_AUDIT_CONFIG_SCHEMA_VERSION,
        kind: MCP_TOOL_PAYLOAD_AUDIT_CONFIG_KIND,
        top: readPositiveInteger(env['COPILOT_MCP_TOOL_PAYLOAD_TOP'], DEFAULT_MCP_TOOL_PAYLOAD_TOP, 1, 200),
        maxEnvelopeBytes: readPositiveInteger(
            env['COPILOT_MCP_TOOL_PAYLOAD_MAX_BYTES'],
            DEFAULT_MCP_TOOL_PAYLOAD_MAX_ENVELOPE_BYTES,
            1024,
            16 * 1024 * 1024,
        ),
    });
}

/** @param {unknown} value @param {number} fallback @param {number} minimum @param {number} maximum */
function readPositiveInteger(value, fallback, minimum, maximum) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? Math.floor(parsed) : fallback;
}
