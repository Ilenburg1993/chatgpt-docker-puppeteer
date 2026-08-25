// @ts-check
/**
 * Read-only capability contract for process-scoped Infra health diagnostics.
 *
 * The diagnostic owner no longer stores a process-global reader. Composition creates one opaque capability bound to
 * the concrete Application Infra host and transports it through OperationContext.
 *
 * @module copilot/mcp/diagnostics/infra-health/runtime
 */

/**
 * @typedef {{
 *   runtime: ReturnType<typeof import('#copilot/infra/public/observability').readIoRuntimeHealthSnapshot>;
 *   process: ReturnType<typeof import('#copilot/infra/public/observability/process').readIoProcessHealthSnapshot>;
 * }} McpInfraHealthView
 *
 * @typedef {Readonly<{ read: () => McpInfraHealthView }>} McpInfraHealthCapability
 */

/**
 * @param {() => McpInfraHealthView} reader
 * @returns {McpInfraHealthCapability}
 */
export function createMcpInfraHealthCapability(reader) {
    if (typeof reader !== 'function') throw new TypeError('MCP Infra health capability requires a reader function.');
    return Object.freeze({ read: reader });
}
