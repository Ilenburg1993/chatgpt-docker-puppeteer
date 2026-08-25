// @ts-check
/** Exact public membrane for MCP tool-payload diagnostics. */

export {
    DEFAULT_MCP_TOOL_PAYLOAD_MAX_ENVELOPE_BYTES,
    DEFAULT_MCP_TOOL_PAYLOAD_TOP,
    MCP_TOOL_PAYLOAD_AUDIT_CONFIG_KIND,
    MCP_TOOL_PAYLOAD_AUDIT_CONFIG_SCHEMA_VERSION,
    readMcpToolPayloadAuditConfig,
} from '../config.js';
/** @typedef {import('../config.js').McpToolPayloadAuditConfig} McpToolPayloadAuditConfig */
export { buildToolPayloadAudit, buildToolSurfacePayloadComparison } from '../runtime.js';
