// @ts-check
/**
 * Canonical per-invocation context for MCP tool operations.
 *
 * This contract is deliberately below the catalog/registry and wire adapters. It preserves the
 * official MCP request cancellation signal and request identity while adding the local deadline
 * budget used by workspace operations. Tool handlers may ignore the optional second argument during
 * migration, but new/rewritten operations must propagate its signal downstream.
 *
 * @module copilot/mcp/protocol/tools/contracts/operation-context
 */

export const MCP_TOOL_OPERATION_CONTEXT_VERSION = '1.0.0';

/**
 * @typedef {'2025' | '2026' | 'unknown'} McpProtocolEra
 *
 * @typedef {{
 *     sessionId?: string;
 *     mcpReq: {
 *         id: string | number;
 *         method: string;
 *         signal: AbortSignal;
 *         _meta?: Record<string, unknown>;
 *         envelope?: Record<string, unknown>;
 *     };
 *     http?: { authInfo?: import('@modelcontextprotocol/server').AuthInfo };
 * }} McpSdkRequestContext
 *
 * @typedef {Readonly<{
 *     version: string;
 *     signal: AbortSignal;
 *     callerSignal: AbortSignal;
 *     requestId: string;
 *     method: string;
 *     protocolEra: McpProtocolEra;
 *     sessionId?: string;
 *     requestMeta?: Readonly<Record<string, unknown>>;
 *     requestEnvelope?: Readonly<Record<string, unknown>>;
 *     authInfo?: import('@modelcontextprotocol/server').AuthInfo;
 *     workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     startedAtMs: number;
 *     deadlineAtMs: number | null;
 *     remainingBudgetMs: () => number | null;
 *     cancellationSource: () => 'caller' | 'deadline' | null;
 * }>} McpToolOperationContext
 *
 * @typedef {{
 *     workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     timeoutMs?: number;
 *     now?: () => number;
 * }} McpToolOperationContextOptions
 */

/**
 * Build the immutable operation context passed from the MCP SDK boundary to tool/application code.
 *
 * The SDK's caller signal is never replaced. A local deadline is composed with it so downstream
 * operations can cooperatively abort. `cancellationSource()` distinguishes an upstream/client abort
 * from the local deadline without relying on exception-message parsing.
 *
 * @param {McpSdkRequestContext} serverContext
 * @param {McpToolOperationContextOptions} [options]
 * @returns {McpToolOperationContext}
 */
export function createMcpToolOperationContext(serverContext, options) {
    if (!options?.workspace) throw new TypeError('MCP tool operation context requires a workspace capability.');
    const now = options.now ?? (() => Date.now());
    const startedAtMs = now();
    const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    const deadlineAtMs = timeoutMs === null ? null : startedAtMs + timeoutMs;
    const deadlineSignal = timeoutMs === null ? null : AbortSignal.timeout(timeoutMs);
    const callerSignal = serverContext.mcpReq.signal;
    const signal = deadlineSignal ? AbortSignal.any([callerSignal, deadlineSignal]) : callerSignal;
    const requestMeta = freezeRecord(serverContext.mcpReq._meta);
    const requestEnvelope = freezeRecord(serverContext.mcpReq.envelope);
    const protocolEra = inferProtocolEra(serverContext, requestEnvelope);

    return Object.freeze({
        version: MCP_TOOL_OPERATION_CONTEXT_VERSION,
        signal,
        callerSignal,
        requestId: String(serverContext.mcpReq.id),
        method: serverContext.mcpReq.method,
        protocolEra,
        ...(serverContext.sessionId ? { sessionId: serverContext.sessionId } : {}),
        ...(requestMeta ? { requestMeta } : {}),
        ...(requestEnvelope ? { requestEnvelope } : {}),
        ...(serverContext.http?.authInfo ? { authInfo: serverContext.http.authInfo } : {}),
        workspace: options.workspace,
        startedAtMs,
        deadlineAtMs,
        remainingBudgetMs: () => (deadlineAtMs === null ? null : Math.max(0, deadlineAtMs - now())),
        cancellationSource: () => {
            if (callerSignal.aborted) return 'caller';
            if (deadlineSignal?.aborted) return 'deadline';
            return null;
        },
    });
}

/**
 * Require the composition-owned workspace capability at a migrated wire boundary.
 *
 * Handler context remains optional in the transitional registry type so legacy handlers can migrate incrementally;
 * rewritten handlers must call this guard rather than inventing a fallback locator.
 *
 * @param {McpToolOperationContext | undefined} operationContext
 * @returns {import('#copilot/mcp/public/workspace').McpWorkspaceCapability}
 */
export function requireMcpToolWorkspace(operationContext) {
    if (!operationContext?.workspace) throw new TypeError('MCP tool execution requires a workspace capability.');
    return operationContext.workspace;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeTimeoutMs(value) {
    if (value === undefined || value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, unknown>> | undefined}
 */
function freezeRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return Object.freeze({ .../** @type {Record<string, unknown>} */ (value) });
}

/**
 * @param {McpSdkRequestContext} serverContext
 * @param {Readonly<Record<string, unknown>> | undefined} envelope
 * @returns {McpProtocolEra}
 */
function inferProtocolEra(serverContext, envelope) {
    if (envelope) return '2026';
    if (serverContext.sessionId) return '2025';
    return 'unknown';
}
