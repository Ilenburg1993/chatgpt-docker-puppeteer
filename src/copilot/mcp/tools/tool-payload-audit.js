// @ts-check
/**
 * Read-only self-audit of the MCP tools/list wire payload.
 *
 * Dynamic import avoids a static registry cycle: the underlying SDK in-memory audit imports the canonical registry only
 * after registry initialization has completed.
 *
 * @module copilot/mcp/tools/tool-payload-audit
 */

import { z } from 'zod';
import { okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';

/** @type {import('../registry.js').McpToolDefinition} */
export const mcpToolPayloadAuditTool = {
    name: 'mcp_tool_payload_audit',
    title: 'MCP tool payload audit',
    description: 'Measure tools/list wire bytes and rank the largest descriptors without network calls.',
    inputSchema: {
        top: z.number().int().min(1).max(50).optional().describe('Largest tool descriptors to return. Default: 20.'),
    },
    annotations: readOnlyAnnotations(),
    handler: async ({ top }) => {
        const { buildToolPayloadAudit } = await import('../scripts/tool-payload-audit.js');
        return okResult(await buildToolPayloadAudit(top === undefined ? {} : { top }));
    },
};
