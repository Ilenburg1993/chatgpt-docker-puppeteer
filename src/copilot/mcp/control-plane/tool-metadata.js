// @ts-check
/**
 * Registry-wide MCP tool metadata helpers.
 *
 * @module copilot/mcp/control-plane/tool-metadata
 */

import { z } from 'zod';
import { securitySchemesForMcpTool } from './auth.js';

/**
 * @typedef {{ type: 'noauth' } | { type: 'oauth2'; scopes: string[] }} McpSecurityScheme
 */

const NOAUTH = /** @type {const} */ ({ type: 'noauth' });

/**
 * Minimal schema used until each tool gets a fully specific output schema.
 *
 * It is intentionally permissive because several legacy tools return structured objects that do not yet share one exact
 * shape. This removes the missing-schema class of issue while allowing the next roadmap band to tighten schemas tool by
 * tool.
 *
 * @returns {import('zod').ZodType}
 */
export function baseMcpOutputSchema() {
    return z
        .object({
            success: z.boolean().optional(),
        })
        .passthrough();
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @returns {McpSecurityScheme[]}
 */
export function defaultSecuritySchemesForTool(tool) {
    return securitySchemesForMcpTool(tool).map((scheme) =>
        scheme.type === 'noauth' ? { ...NOAUTH } : { type: 'oauth2', scopes: [...scheme.scopes] },
    );
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @returns {Record<string, unknown>}
 */
export function buildToolMeta(tool) {
    return {
        ...(tool._meta ?? {}),
        securitySchemes: tool.securitySchemes ?? defaultSecuritySchemesForTool(tool),
        'openai/toolInvocation/invoking': tool._meta?.['openai/toolInvocation/invoking'] ?? `Running ${tool.name}`,
        'openai/toolInvocation/invoked': tool._meta?.['openai/toolInvocation/invoked'] ?? `Finished ${tool.name}`,
    };
}

/**
 * @param {import('../registry.js').McpToolDefinition} tool
 * @returns {import('../registry.js').McpToolDefinition}
 */
export function normalizeMcpToolDefinition(tool) {
    const securitySchemes = tool.securitySchemes ?? defaultSecuritySchemesForTool(tool);
    return {
        ...tool,
        outputSchema: tool.outputSchema ?? baseMcpOutputSchema(),
        securitySchemes,
        _meta: buildToolMeta({ ...tool, securitySchemes }),
    };
}

/**
 * @param {import('../registry.js').McpToolDefinition[]} tools
 * @returns {import('../registry.js').McpToolDefinition[]}
 */
export function normalizeMcpToolDefinitions(tools) {
    return tools.map(normalizeMcpToolDefinition);
}
