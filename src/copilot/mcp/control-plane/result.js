// @ts-check
/**
 * Result helpers for MCP tool responses.
 *
 * @module copilot/mcp/control-plane/result
 */

/**
 * @typedef {import('@modelcontextprotocol/sdk/types.js').CallToolResult} CallToolResult
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function stringifyForModel(value) {
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
}

/**
 * @param {unknown} structuredContent
 * @param {string} [text]
 * @param {Record<string, unknown>} [meta]
 * @returns {CallToolResult}
 */
export function okResult(structuredContent, text, meta) {
    const normalizedStructuredContent = asRecord(structuredContent);
    return {
        content: [{ type: 'text', text: text ?? stringifyForModel(normalizedStructuredContent) }],
        structuredContent: normalizedStructuredContent,
        ...(meta ? { _meta: meta } : {}),
    };
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {CallToolResult}
 */
export function errorResult(message, details) {
    return {
        isError: true,
        content: [{ type: 'text', text: message }],
        structuredContent: {
            success: false,
            error: message,
            ...(details ? { details } : {}),
        },
    };
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function asRecord(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return /** @type {Record<string, unknown>} */ (value);
    }
    return { value };
}
