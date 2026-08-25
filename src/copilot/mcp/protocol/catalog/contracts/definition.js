// @ts-check
/**
 * Type-safe raw MCP tool definition boundary.
 *
 * A raw tool owns a Zod input shape and a handler whose argument type is inferred from that same shape. The canonical
 * catalog is heterogeneous, so this helper deliberately erases the per-tool generic only after the definition has been
 * type-checked. Runtime behavior is identity: MCP SDK/registry input validation remains the sole parser on the hot path.
 *
 * @module copilot/mcp/protocol/catalog/contracts/definition
 */

/**
 * @template {import('zod').ZodRawShape} TShape
 * @typedef {Omit<import('./types.js').McpRawToolDefinition, 'inputSchema' | 'handler'> & {
 *     inputSchema: TShape;
 *     handler: (
 *         args: import('zod').output<import('zod').ZodObject<TShape>>,
 *         operationContext?: import('#copilot/mcp/public/protocol/tools').McpToolOperationContext,
 *     ) =>
 *         | Promise<import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult>
 *         | import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult;
 * }} McpTypedRawToolDefinition
 */

/**
 * Define one raw MCP tool with handler arguments inferred directly from its Zod input shape.
 *
 * The `unknown` cast is the single heterogeneous-catalog erasure boundary. It does not assert unvalidated caller data
 * to a domain type at execution time; the canonical registry exposes the same input shape to the MCP SDK, which owns
 * runtime argument validation before invoking the stored handler.
 *
 * @template {import('zod').ZodRawShape} TShape
 * @param {McpTypedRawToolDefinition<TShape>} definition
 * @returns {import('./types.js').McpRawToolDefinition}
 */
export function defineMcpRawTool(definition) {
    return /** @type {import('./types.js').McpRawToolDefinition} */ (/** @type {unknown} */ (definition));
}
