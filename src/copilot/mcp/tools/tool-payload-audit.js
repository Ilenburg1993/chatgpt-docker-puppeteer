// @ts-check
/**
 * Read-only self-audit of the MCP tools/list wire payload.
 *
 * Dynamic import avoids a static registry cycle: the underlying SDK in-memory audit imports the canonical registry only
 * after registry initialization has completed.
 *
 * @module copilot/mcp/tools/tool-payload-audit
 */

import { buildToolPayloadAudit } from '#copilot/mcp/public/diagnostics/tool-payload';
import { okResult, readOnlyAnnotations } from '#copilot/mcp/public/protocol/tools';
import { z } from 'zod';

/** @type {() => import('#copilot/mcp/public/protocol/catalog').McpToolDefinition[]} */
let toolsProvider = () => [];

/**
 * A registry injeta a superfície já normalizada depois de construí-la; assim o auditor não depende de volta da
 * registry.
 *
 * @param {() => import('#copilot/mcp/public/protocol/catalog').McpToolDefinition[]} provider
 * @returns {void}
 */
export function bindMcpToolPayloadAuditProvider(provider) {
    toolsProvider = provider;
}

/** @type {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition} */
export const mcpToolPayloadAuditTool = {
    name: 'mcp_tool_payload_audit',
    title: 'MCP tool payload audit',
    description: 'Measure tools/list wire bytes and rank the largest descriptors without network calls.',
    inputSchema: {
        top: z.number().int().min(1).max(50).optional()['describe']('Largest tool descriptors to return. Default: 20.'),
    },
    annotations: readOnlyAnnotations(),
    handler: async ({ top }) => {
        return okResult(
            await buildToolPayloadAudit({
                tools: toolsProvider(),
                ...(top === undefined ? {} : { top }),
            }),
        );
    },
};
