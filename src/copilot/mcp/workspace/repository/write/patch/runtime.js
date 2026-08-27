// @ts-check
/** Repository-write bridge to the canonical repository patch owner. */

import { runRepositoryPatchTargetGroups } from '#copilot/mcp/public/workspace/repository/patch';

/** @typedef {import('../contracts.js').RepoWriteRuntime} RepoWriteRuntime */

/**
 * Run canonical repository patch target groups without exposing workspace/signal internals to the wire adapter.
 *
 * @param {RepoWriteRuntime} runtime
 * @param {import('#copilot/mcp/public/workspace/repository/patch').RepositoryPatchTarget[]} targets
 * @param {boolean} dryRun
 * @param {{ failureMode?: 'best-effort' | 'fail-fast'; concurrency?: number; maxTargets?: number }} [options]
 */
export function runRepoWritePatchTargetGroups(runtime, targets, dryRun, options = {}) {
    return runRepositoryPatchTargetGroups(runtime.workspace, targets, dryRun, {
        ...options,
        repositoryPatchConfig: runtime.repositoryPatchConfig,
        ...(runtime.signal ? { signal: runtime.signal } : {}),
    });
}
