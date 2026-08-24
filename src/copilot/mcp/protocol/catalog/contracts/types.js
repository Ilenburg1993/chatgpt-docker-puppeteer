// @ts-check
/**
 * Canonical MCP tool descriptor contract.
 *
 * The registry consumes this contract; tool implementations, auth, protocol adapters and diagnostics must not import
 * registry.js merely to name a descriptor shape.
 *
 * @module copilot/mcp/protocol/catalog/contracts/types
 */

/**
 * @typedef {object} McpToolDefinition
 * @property {string} name
 * @property {string} title
 * @property {string} description
 * @property {Record<string, import('zod').ZodType>} inputSchema
 * @property {import('zod').ZodType | Record<string, import('zod').ZodType>} [outputSchema]
 * @property {Record<string, unknown>[]} [securitySchemes]
 * @property {Record<string, unknown>} [_meta]
 * @property {number} [maxResultBytes] Internal per-tool result ceiling; never exposed in the wire descriptor.
 * @property {import('@modelcontextprotocol/server').ToolAnnotations} annotations
 * @property {(
 *     args: any,
 *     operationContext?: import('#copilot/mcp/public/protocol/tools').McpToolOperationContext,
 * ) =>
 *     | Promise<import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult>
 *     | import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult} handler
 */

export {};
