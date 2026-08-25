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
 * @typedef {'cancellable' | 'bounded-non-cancellable' | 'not-applicable'} McpToolCancellationPolicy
 * @typedef {'none' | 'bounded-write' | 'destructive'} McpToolMutationEffect
 * @typedef {'none' | 'guarded' | 'possible'} McpToolExternalSideEffects
 * @typedef {'idempotent' | 'stateful-read' | 'non-idempotent'} McpToolIdempotency
 * @typedef {'safe' | 'conditional' | 'manual-only'} McpToolRetryPolicy
 * @typedef {'read' | 'write' | 'validate' | 'admin'} McpToolCallerScope
 * @typedef {'local' | 'fixed-external' | 'open-world'} McpToolNetworkAuthority
 * @typedef {'none' | 'cloudflare-api' | 'git-upstream' | 'model-provider' | 'package-registry'} McpToolCredentialClass
 * @typedef {'specific' | 'intentional-untyped'} McpToolOutputContractClass
 *
 * @typedef {Readonly<{
 *     cancellation: McpToolCancellationPolicy;
 *     rationale: string;
 *     drainTimeoutMs?: number;
 *     continuationBoundMs?: number;
 * }>} McpToolExecutionContract
 *
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     effects: Readonly<{ mutation: McpToolMutationEffect; externalSideEffects: McpToolExternalSideEffects }>;
 *     authority: Readonly<{ callerScope: McpToolCallerScope; network: McpToolNetworkAuthority }>;
 *     credentials: readonly McpToolCredentialClass[];
 *     idempotency: McpToolIdempotency;
 *     retry: McpToolRetryPolicy;
 *     execution: McpToolExecutionContract;
 *     resultBudget: Readonly<{ mode: 'registry-default' | 'tool-specific'; maxBytes?: number }>;
 *     output: Readonly<{ class: McpToolOutputContractClass; rationale: string }>;
 * }>} McpToolContract
 *
 * @typedef {object} McpRawToolDefinition
 * @property {string} name
 * @property {string} title
 * @property {string} description
 * @property {Record<string, import('zod').ZodType>} inputSchema
 * @property {import('zod').ZodType | Record<string, import('zod').ZodType>} [outputSchema]
 * @property {Record<string, unknown>[]} [securitySchemes]
 * @property {Record<string, unknown>} [_meta]
 * @property {number} [maxResultBytes] Internal per-tool result ceiling; never exposed in the wire descriptor.
 * @property {(
 *     args: unknown,
 *     operationContext?: import('#copilot/mcp/public/protocol/tools').McpToolOperationContext,
 * ) =>
 *     | Promise<import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult>
 *     | import('#copilot/mcp/public/protocol/tools').StructuredCallToolResult} handler
 *
 * @typedef {McpRawToolDefinition & Readonly<{
 *     contract: McpToolContract;
 *     execution: McpToolExecutionContract;
 *     annotations: import('@modelcontextprotocol/server').ToolAnnotations;
 * }>} McpToolDefinition
 */

export {};
