// @ts-check
/**
 * Fixed persisted state for the detached representative IO cache benchmark.
 *
 * @module copilot/mcp/control-plane/io-cache-benchmark-state
 */

import { lstat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const IO_CACHE_BENCHMARK_STATE_PATH = 'src/copilot/.ai/mcp/io-cache-benchmark-state.json';
const IO_CACHE_BENCHMARK_STATE_FILE = fileURLToPath(new URL('../../.ai/mcp/io-cache-benchmark-state.json', import.meta.url));
const MAX_STATE_BYTES = 512 * 1024;

export function getIoCacheBenchmarkStateFile() {
    return IO_CACHE_BENCHMARK_STATE_FILE;
}

/** @returns {Promise<Record<string, unknown> | null>} */
export async function readIoCacheBenchmarkState() {
    try {
        const stats = await lstat(IO_CACHE_BENCHMARK_STATE_FILE);
        if (stats.isSymbolicLink() || !stats.isFile()) {
            return { schemaVersion: 1, status: 'unreadable', error: 'IO cache benchmark state is not a regular file.' };
        }
        if (stats.size > MAX_STATE_BYTES) {
            return { schemaVersion: 1, status: 'unreadable', error: `IO cache benchmark state exceeds ${String(MAX_STATE_BYTES)} bytes.` };
        }
        const parsed = JSON.parse(await readFile(IO_CACHE_BENCHMARK_STATE_FILE, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { schemaVersion: 1, status: 'unreadable', error: 'IO cache benchmark state JSON is not an object.' };
        }
        return /** @type {Record<string, unknown>} */ (parsed);
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
        return { schemaVersion: 1, status: 'unreadable', error: error instanceof Error ? error.message : String(error) };
    }
}
