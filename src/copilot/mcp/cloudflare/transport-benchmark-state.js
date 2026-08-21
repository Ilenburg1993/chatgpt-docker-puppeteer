// @ts-check
/**
 * Fixed persisted state for detached Cloudflare transport benchmarks.
 *
 * @module copilot/mcp/cloudflare/transport-benchmark-state
 */

import { lstatPathTrusted, readTextFreshTrusted } from '#copilot/infra/public/filesystem/trusted';
import { fileURLToPath } from 'node:url';

export const TRANSPORT_BENCHMARK_STATE_PATH = 'src/copilot/.ai/mcp/transport-benchmark-state.json';
const TRANSPORT_BENCHMARK_STATE_FILE = fileURLToPath(
    new URL('../../.ai/mcp/transport-benchmark-state.json', import.meta.url),
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
        const stats = (
            await lstatPathTrusted(TRANSPORT_BENCHMARK_STATE_FILE, {
                caller: 'mcp.cloudflare.transport-benchmark-state',
            })
        ).stats;
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
            (
                await readTextFreshTrusted(TRANSPORT_BENCHMARK_STATE_FILE, {
                    caller: 'mcp.cloudflare.transport-benchmark-state',
                })
            ).content,
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
