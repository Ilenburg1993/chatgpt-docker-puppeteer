// @ts-check
/**
 * Fixed identities and argument contracts for the MCP IO-cache benchmark owner.
 *
 * @module copilot/mcp/diagnostics/io-cache/contracts
 */

export const IO_CACHE_BENCHMARK_LAUNCHER = 'src/copilot/mcp/scripts/scheduled-io-cache-benchmark-runner.js';
export const IO_CACHE_BENCHMARK_WORKER = 'src/copilot/mcp/diagnostics/io-cache/worker.js';
export const IO_CACHE_BENCHMARK_REQUEST_ID_RE = /^mcp-io-cache-benchmark-[a-z0-9-]{8,80}$/u;
export const IO_CACHE_BENCHMARK_WORKER_MODES = Object.freeze(['cold', 'l1', 'l2-prime', 'l2']);

/** @param {string} requestId */
export function assertIoCacheBenchmarkRequestId(requestId) {
    if (!IO_CACHE_BENCHMARK_REQUEST_ID_RE.test(requestId)) {
        throw new Error('Invalid generated IO cache benchmark request id.');
    }
    return requestId;
}

/** @param {string} mode */
export function assertIoCacheBenchmarkWorkerMode(mode) {
    if (!IO_CACHE_BENCHMARK_WORKER_MODES.includes(mode)) {
        throw new Error('Invalid IO cache benchmark worker mode.');
    }
    return /** @type {'cold' | 'l1' | 'l2-prime' | 'l2'} */ (mode);
}
