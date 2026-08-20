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
        idempotentHint: true,
    };
}

/**
 * Read-only tools that contact a fixed external service boundary. The tool must still keep its inputs
 * closed/allowlisted; openWorldHint describes the observation boundary, not permission for arbitrary URLs or commands.
 *
 * @returns {ToolAnnotations}
 */
export function openWorldReadOnlyAnnotations() {
    return {
        readOnlyHint: true,
        openWorldHint: true,
        destructiveHint: false,
        idempotentHint: true,
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
        idempotentHint: false,
    };
}

/**
 * Bounded-write tools that contact fixed external service boundaries while persisting only local, sanitized diagnostic
 * state. Inputs must remain closed and must never accept arbitrary URLs, commands, credentials or destinations.
 *
 * @returns {ToolAnnotations}
 */
export function openWorldBoundedWriteAnnotations() {
    return {
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: false,
        idempotentHint: false,
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
        idempotentHint: false,
    };
}

/**
 * Arbitrary terminal/process and equivalent actions that can both mutate local state and contact external systems. This
 * annotation does not weaken OAuth/host approval; it accurately advertises the broad execution boundary.
 *
 * @returns {ToolAnnotations}
 */
export function openWorldDestructiveAnnotations() {
    return {
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: true,
        idempotentHint: false,
    };
}
