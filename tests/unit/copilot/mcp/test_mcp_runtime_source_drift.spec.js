// @ts-check

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'vitest';

import { inspectMcpRuntimeSourceDrift } from '#copilot/testing/mcp/diagnostics/runtime-source-drift';

/**
 * @param {Record<string, number>} mtimes
 * @returns {import('#copilot/mcp/public/workspace').McpWorkspaceCapability}
 */
function workspaceWithMtimes(mtimes) {
    return /** @type {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} */ (
        /** @type {unknown} */ ({
            workspaceRoot: '/repo',
            io: {
                /** @param {string} absolutePath */
                async statPath(absolutePath) {
                    const relativePath = path.relative('/repo', absolutePath).replaceAll('\\', '/');
                    if (!(relativePath in mtimes)) {
                        const error = /** @type {NodeJS.ErrnoException} */ (new Error('missing fixture'));
                        error.code = 'ENOENT';
                        throw error;
                    }
                    return {
                        stats: {
                            mtimeMs: mtimes[relativePath],
                            isFile: () => true,
                            isSymbolicLink: () => false,
                        },
                    };
                },
            },
        })
    );
}

describe('MCP runtime/source drift diagnostics', () => {
    it('reports runtime-critical source changed after the process generation without exposing file content', async () => {
        const registryPath = 'src/copilot/mcp/registry/runtime.js';
        const repoWritePath = 'src/copilot/mcp/tools/repo-write.js';
        const paths = [registryPath, repoWritePath];
        const result = await inspectMcpRuntimeSourceDrift(
            workspaceWithMtimes({
                [registryPath]: 900,
                [repoWritePath]: 1_100,
            }),
            { processStartedAtMs: 1_000, nowMs: 1_200, paths },
        );

        assert.equal(result.driftDetected, true);
        assert.equal(result.changedSinceProcessStartCount, 1);
        assert.deepEqual(result.changedPaths, ['src/copilot/mcp/tools/repo-write.js']);
        assert.equal(result.missingCount, 0);
        assert.equal(result.newestSourceMtimeMs, 1_100);
        assert.equal(JSON.stringify(result).includes('file content'), false);
    });

    it('reports a clean generation when sampled source predates process start and tracks missing samples separately', async () => {
        const registryPath = 'src/copilot/mcp/registry/runtime.js';
        const serverPath = 'src/copilot/mcp/server/runtime.js';
        const paths = [registryPath, serverPath];
        const result = await inspectMcpRuntimeSourceDrift(workspaceWithMtimes({ [registryPath]: 900 }), {
            processStartedAtMs: 1_000,
            nowMs: 1_200,
            paths,
        });

        assert.equal(result.driftDetected, false);
        assert.equal(result.changedSinceProcessStartCount, 0);
        assert.equal(result.missingCount, 1);
        assert.equal(result.sampledFileCount, 2);
    });
});
