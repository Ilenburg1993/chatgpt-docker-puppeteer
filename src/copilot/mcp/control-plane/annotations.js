// @ts-check
/**
 * Helpers canonicos para annotations MCP.
 *
 * @module copilot/mcp/control-plane/annotations
 */

/**
 * @typedef {import('@modelcontextprotocol/sdk/types.js').ToolAnnotations} ToolAnnotations
 */

/**
 * @returns {ToolAnnotations}
 */
export function readOnlyAnnotations() {
    return {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
    };
}

/**
 * @returns {ToolAnnotations}
 */
export function boundedWriteAnnotations() {
    return {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
    };
}

/**
 * @returns {ToolAnnotations}
 */
export function destructiveAnnotations() {
    return {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: true,
    };
}

