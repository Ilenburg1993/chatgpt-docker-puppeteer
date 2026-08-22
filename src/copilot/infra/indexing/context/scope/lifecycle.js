// @ts-check
/** Scope declaration orchestration across bounded selection, parsing and selected-index convergence. */
import { allocateScope } from './declaration.js';
import { convergeScopeIndex } from './index-convergence.js';
import { materializeScopeSymbols } from './materialization.js';
import { getScopeStats } from './query.js';
import { selectAndWarmScopePaths } from './selection.js';
import { markScopeReady, recordScopeFailure } from './state.js';

/** @typedef {import('./types.js').ScopeDeclareOptions} ScopeDeclareOptions */
/** @typedef {import('./types.js').ScopeStats} ScopeStats */

/**
 * Declares a bounded session working set and starts warm/parse/index convergence in the background.
 * @param {ScopeDeclareOptions} opts
 * @param {import('./state.js').ScopeRuntimeState} runtime
 * @returns {{ sessionId: string; scope: import('./types.js')._InternalScope; awaitReady: () => Promise<ScopeStats> }}
 */
export function declareScope(opts, runtime) {
    const { scope, warmController, previousWarmPromise } = allocateScope(opts, runtime);
    const silent = opts.silent ?? true;
    const parseSymbols = opts.parseSymbols ?? true;
    const sessionId = opts.sessionId;

    const warmPromise = (async () => {
        try {
            if (previousWarmPromise) await previousWarmPromise.catch(() => undefined);
            const { resolvedPaths, warmSnapshots } = await selectAndWarmScopePaths(
                scope,
                opts,
                warmController.signal,
                runtime,
            );
            if (warmController.signal.aborted) return;
            await materializeScopeSymbols(scope, resolvedPaths, warmSnapshots, {
                parseSymbols,
                silent,
                signal: warmController.signal,
                ...(runtime.parserCacheRuntime ? { parserCacheRuntime: runtime.parserCacheRuntime } : {}),
            });
            if (warmController.signal.aborted) return;
            await convergeScopeIndex(scope, resolvedPaths, warmSnapshots, opts, warmController.signal, runtime);
            if (warmController.signal.aborted) return;
            if (scope.failed > 0) {
                if (!scope.degraded) {
                    recordScopeFailure(
                        scope,
                        { code: 'ESCOPEPARTIAL', name: 'ScopeWarmError' },
                        'warm',
                        'aquecimento do escopo terminou com falhas',
                    );
                }
                scope.completedAt = Date.now();
            } else {
                markScopeReady(scope);
            }
        } catch (error) {
            if (!warmController.signal.aborted) {
                scope.failed += 1;
                recordScopeFailure(scope, error, 'warm', 'aquecimento do escopo falhou');
                scope.completedAt = Date.now();
            }
        } finally {
            if (runtime.warmControllers.get(sessionId) === warmController) runtime.warmControllers.delete(sessionId);
        }
    })();
    runtime.warmPromises.set(sessionId, warmPromise);

    return {
        sessionId,
        scope,
        awaitReady: async () => {
            // Await the exact generation declared above. Looking the promise up again by sessionId would allow an old
            // handle to observe a newer redeclaration that happens to reuse the same logical identity.
            await warmPromise;
            return (
                (runtime.registry.get(sessionId) === scope ? getScopeStats(sessionId, runtime) : null) ?? {
                    sessionId,
                    pathCount: 0,
                    candidateFiles: 0,
                    selectedFiles: 0,
                    hardLimitReached: false,
                    selection: { ...scope.selection },
                    preloaded: 0,
                    parsed: 0,
                    failed: 0,
                    invalidated: 0,
                    index: null,
                    symbolBytes: 0,
                    warmDurationMs: 0,
                    ready: false,
                    degraded: true,
                    status: /** @type {const} */ ('degraded'),
                    lastError: {
                        phase: /** @type {const} */ ('lifecycle'),
                        code: 'ESCOPEGENERATIONCLOSED',
                        name: 'ScopeLifecycleError',
                        summary: 'geração do escopo fechada ou substituída antes do snapshot de prontidão',
                        atMs: Date.now(),
                    },
                    startedAt: scope.startedAt,
                    completedAt: Date.now(),
                    maxActiveScopes: runtime.maxActiveScopes,
                }
            );
        },
    };
}
