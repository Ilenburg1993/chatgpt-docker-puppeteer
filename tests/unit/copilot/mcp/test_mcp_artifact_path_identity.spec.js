// @ts-check
/** Artifact path identity must remain stable when implementation owners move deeper in the MCP tree. */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'vitest';

import { IO_CACHE_BENCHMARK_STATE_PATH, getIoCacheBenchmarkStateFile } from '#copilot/mcp/public/diagnostics/io-cache';
import { MCP_WORKSPACE_ROOT, resolveMcpWorkspaceIdentityPath } from '#copilot/mcp/public/workspace';

describe('MCP artifact path identity', () => {
    it('keeps IO-cache benchmark state under canonical src/copilot/.ai', () => {
        const expected = path.join(MCP_WORKSPACE_ROOT, IO_CACHE_BENCHMARK_STATE_PATH);
        assert.equal(getIoCacheBenchmarkStateFile(), expected);
        assert.equal(IO_CACHE_BENCHMARK_STATE_PATH, 'src/copilot/.ai/mcp/io-cache-benchmark-state.json');
    });

    it('anchors relative configured paths to the module-derived workspace identity', () => {
        assert.equal(
            resolveMcpWorkspaceIdentityPath('src/copilot/.ai/mcp/example.json'),
            path.join(MCP_WORKSPACE_ROOT, 'src/copilot/.ai/mcp/example.json'),
        );
        assert.equal(resolveMcpWorkspaceIdentityPath(MCP_WORKSPACE_ROOT), MCP_WORKSPACE_ROOT);
        assert.throws(() => resolveMcpWorkspaceIdentityPath('bad\0path'), /single-line path/);
    });
});
