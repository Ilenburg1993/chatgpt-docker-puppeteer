// @ts-check
/**
 * Result helpers for MCP tool responses.
 *
 * @module copilot/mcp/control-plane/result
 */

/**
 * @typedef {import('@modelcontextprotocol/sdk/types.js').CallToolResult} CallToolResult
 * @typedef {CallToolResult & {
 *     content: { type: 'text'; text: string }[];
 *     structuredContent: Record<string, any>;
 * }} StructuredCallToolResult
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
 * @returns {StructuredCallToolResult}
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
 * @param {Record<string, unknown>} [meta]
 * @returns {StructuredCallToolResult}
 */
export function errorResult(message, details, meta) {
    const code =
        details && typeof details['code'] === 'string' && details['code'].trim() ? details['code'].trim() : undefined;
    const hint =
        details && typeof details['hint'] === 'string' && details['hint'].trim() ? details['hint'].trim() : undefined;
    return {
        isError: true,
        content: [{ type: 'text', text: message }],
        structuredContent: {
            success: false,
            ...(code ? { code } : {}),
            error: message,
            ...(hint ? { hint } : {}),
            ...(details ? { details } : {}),
        },
        ...(meta ? { _meta: meta } : {}),
    };
}

/**
 * @param {unknown} value
 * @returns {Record<string, any>}
 */
export function asRecord(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return /** @type {Record<string, unknown>} */ (value);
    }
    return { value };
}
