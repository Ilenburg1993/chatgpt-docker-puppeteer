// @ts-check
/**
 * Fixed persisted state for detached Cloudflare transport benchmarks.
 *
 * @module copilot/mcp/cloudflare/transport-benchmark/state
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { MCP_WORKSPACE_ROOT } from '#copilot/mcp/public/workspace';
import { resolve } from 'node:path';

export const TRANSPORT_BENCHMARK_STATE_PATH = 'src/copilot/.ai/mcp/transport-benchmark-state.json';
const TRANSPORT_BENCHMARK_STATE_FILE = resolve(MCP_WORKSPACE_ROOT, TRANSPORT_BENCHMARK_STATE_PATH);
const TRANSPORT_BENCHMARK_STATE_IO = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'mcp.cloudflare.transport-benchmark-state',
        exactPaths: [TRANSPORT_BENCHMARK_STATE_FILE],
        operations: ['read', 'stat'],
        symlinkPolicy: 'deny',
    }),
);
const MAX_STATE_BYTES = 512 * 1024;

/** @returns {string} */
export function getTransportBenchmarkStateFile() {
    return TRANSPORT_BENCHMARK_STATE_FILE;
}

/**
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function readTransportBenchmarkState() {
    try {
        const stats = (await TRANSPORT_BENCHMARK_STATE_IO.lstatPath(TRANSPORT_BENCHMARK_STATE_FILE)).stats;
        if (stats.isSymbolicLink() || !stats.isFile()) {
            return { schemaVersion: 1, status: 'unreadable', error: 'Benchmark state is not a regular file.' };
        }
        if (stats.size > MAX_STATE_BYTES) {
            return {
                schemaVersion: 1,
                status: 'unreadable',
                error: `Benchmark state exceeds ${String(MAX_STATE_BYTES)} bytes.`,
            };
        }
        const parsed = JSON.parse(
            (await TRANSPORT_BENCHMARK_STATE_IO.readTextFresh(TRANSPORT_BENCHMARK_STATE_FILE)).content,
        );
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { schemaVersion: 1, status: 'unreadable', error: 'Benchmark state JSON is not an object.' };
        }
        return /** @type {Record<string, unknown>} */ (parsed);
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
        return {
            schemaVersion: 1,
            status: 'unreadable',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
