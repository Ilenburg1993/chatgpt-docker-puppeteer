// @ts-check
/**
 * MCP tool-surface status for ChatGPT autonomy planning.
 *
 * @module copilot/mcp/tools/tools-status
 */

import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { okResult } from '../control-plane/result.js';

/** @type {() => import('../registry.js').McpToolDefinition[]} */
let toolsProvider = () => [];

/**
 * @param {() => import('../registry.js').McpToolDefinition[]} provider
 * @returns {void}
 */
export function bindMcpToolsStatusProvider(provider) {
    toolsProvider = provider;
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 */
function summarizeTool(tool) {
    const annotations = tool.annotations;
    const readOnly = annotations.readOnlyHint === true;
    const destructive = annotations.destructiveHint === true;
    const openWorld = annotations.openWorldHint === true;
    const idempotent = annotations.idempotentHint === true;
    const riskClass = readOnly
        ? idempotent
            ? 'read-idempotent'
            : 'read'
        : destructive
          ? 'destructive'
          : openWorld
            ? 'open-world'
            : 'bounded-write';
    return {
        name: tool.name,
        title: tool.title,
        riskClass,
        annotations: {
            readOnlyHint: readOnly,
            destructiveHint: destructive,
            openWorldHint: openWorld,
            idempotentHint: idempotent,
        },
        hasOutputSchema: Boolean(tool.outputSchema),
        securitySchemes: tool.securitySchemes ?? tool._meta?.['securitySchemes'] ?? [],
        rememberApprovalCandidate: !readOnly && !destructive && !openWorld,
    };
}

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpToolsStatusTool = {
    name: 'mcp_tools_status',
    title: 'MCP tools status',
    description:
        'Return all MCP tools, annotations and risk classes so ChatGPT can choose low-friction tools and approval strategy.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => {
        const tools = toolsProvider();
        const summaries = tools.map(summarizeTool).sort((left, right) => left.name.localeCompare(right.name));
        const readOnly = summaries.filter((tool) => tool.annotations.readOnlyHint);
        const boundedWrite = summaries.filter((tool) => tool.riskClass === 'bounded-write');
        const destructive = summaries.filter((tool) => tool.riskClass === 'destructive');
        const openWorld = summaries.filter((tool) => tool.riskClass === 'open-world');
        return okResult({
            success: true,
            totalTools: summaries.length,
            readOnlyCount: readOnly.length,
            boundedWriteCount: boundedWrite.length,
            destructiveCount: destructive.length,
            openWorldCount: openWorld.length,
            idempotentReadCount: readOnly.filter((tool) => tool.annotations.idempotentHint).length,
            rememberApprovalCandidates: boundedWrite
                .filter((tool) => tool.rememberApprovalCandidate)
                .map((tool) => tool.name),
            destructiveTools: destructive.map((tool) => tool.name),
            openWorldTools: openWorld.map((tool) => tool.name),
            tools: summaries,
        });
    },
};
