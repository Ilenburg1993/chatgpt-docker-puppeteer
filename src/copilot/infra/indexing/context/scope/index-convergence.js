// @ts-check
/** Selected-path convergence from a scope working set into the global derived index. */
import { refreshIoIndexPaths } from '#copilot/infra/internal/indexing/registry';
import { recordScopeFailure } from './state.js';

/** @typedef {import('./types.js').ScopeDeclareOptions} ScopeDeclareOptions */
/** @typedef {import('./types.js')._InternalScope} _InternalScope */

/**
 * @param {_InternalScope} scope
 * @param {readonly string[]} resolvedPaths
 * @param {ReadonlyMap<string, import('#copilot/infra/internal/filesystem/read').TextFileSnapshot>} warmSnapshots
 * @param {ScopeDeclareOptions} opts
 * @param {AbortSignal} signal
 */
export async function convergeScopeIndex(scope, resolvedPaths, warmSnapshots, opts, signal) {
    const indexMode = opts.indexMode ?? 'auto';
    if (indexMode === 'off' || !scope.workspaceRoot || resolvedPaths.length === 0 || signal.aborted) return;
    const indexResult = await refreshIoIndexPaths(resolvedPaths, {
        workspaceRoot: scope.workspaceRoot,
        ...(opts.extensions !== undefined ? { extensions: opts.extensions } : {}),
        snapshots: warmSnapshots,
        parsedSymbols: scope.symbolIndex,
        signal,
    });
    scope.index = {
        available: Boolean(indexResult.available),
        requested: Number(indexResult.requested ?? resolvedPaths.length),
        indexed: Number(indexResult.indexed ?? 0),
        unchanged: Number(indexResult.unchanged ?? 0),
        invalidated: Number(indexResult.invalidated ?? 0),
        snapshotReuses: Number(indexResult.snapshotReuses ?? 0),
        parsedSymbolReuses: Number(indexResult.parsedSymbolReuses ?? 0),
        parsedSymbolPolicyRejects: Number(indexResult.parsedSymbolPolicyRejects ?? 0),
        failed: Number(indexResult.failed ?? 0),
        durationMs: Number(indexResult.durationMs ?? 0),
        mode: 'selected-path-refresh',
    };
    if (scope.index.failed > 0) {
        scope.failed += scope.index.failed;
        recordScopeFailure(
            scope,
            { code: 'EINDEXPARTIAL', name: 'ScopeIndexError' },
            'index',
            'índice do working set terminou com falhas',
        );
    }
}
