// @ts-check
/** Artifact path identity must remain stable when implementation owners move deeper in the MCP tree. */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'vitest';

import { IO_CACHE_BENCHMARK_STATE_PATH, getIoCacheBenchmarkStateFile } from '#copilot/mcp/public/diagnostics/io-cache';

describe('MCP artifact path identity', () => {
    it('keeps IO-cache benchmark state under canonical src/copilot/.ai', () => {
        const expected = path.join(process.cwd(), IO_CACHE_BENCHMARK_STATE_PATH);
        assert.equal(getIoCacheBenchmarkStateFile(), expected);
        assert.equal(IO_CACHE_BENCHMARK_STATE_PATH, 'src/copilot/.ai/mcp/io-cache-benchmark-state.json');
    });
});
