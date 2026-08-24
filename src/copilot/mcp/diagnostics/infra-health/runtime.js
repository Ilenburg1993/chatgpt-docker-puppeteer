// @ts-check
/**
 * Process-scoped diagnostic projection for Infra health.
 *
 * The MCP diagnostic owner stores only a reader supplied by composition. It does not know ApplicationInfraHost, boot
 * topology or how process/runtime resources are discovered.
 *
 * @module copilot/mcp/diagnostics/infra-health/runtime
 */

/**
 * @typedef {{
 *   runtime: ReturnType<typeof import('#copilot/infra/public/observability').readIoRuntimeHealthSnapshot>;
 *   process: ReturnType<typeof import('#copilot/infra/public/observability/process').readIoProcessHealthSnapshot>;
 * }} McpInfraHealthView
 */

/** @type {(() => McpInfraHealthView) | null} */
let reader = null;

/** @param {() => McpInfraHealthView} nextReader */
export function configureMcpInfraHealthReader(nextReader) {
    if (typeof nextReader !== 'function') throw new TypeError('MCP Infra health reader must be a function.');
    reader = nextReader;
    return () => {
        if (reader === nextReader) reader = null;
    };
}

/** @returns {McpInfraHealthView} */
export function readMcpInfraHealthView() {
    if (!reader) throw new Error('MCP Infra health reader has not been configured by process composition.');
    return reader();
}
