// @ts-check
/** Repository-write bridge to the canonical repository patch owner. */

import { runRepositoryPatchTargetGroups } from '#copilot/mcp/public/workspace/repository/patch';

/** @typedef {import('../contracts.js').RepoWriteRuntime} RepoWriteRuntime */

/**
 * Run canonical repository patch target groups without exposing workspace/signal internals to the wire adapter.
 *
 * @param {RepoWriteRuntime} runtime
 * @param {Record<string, unknown>[]} operations
 * @param {boolean} dryRun
 * @param {{ failureMode?: 'best-effort' | 'fail-fast'; concurrency?: number; maxTargets?: number }} [options]
 */
export function runRepoWritePatchTargetGroups(runtime, operations, dryRun, options = {}) {
    return runRepositoryPatchTargetGroups(runtime.workspace, operations, dryRun, {
        ...options,
        ...(runtime.signal ? { signal: runtime.signal } : {}),
    });
}
