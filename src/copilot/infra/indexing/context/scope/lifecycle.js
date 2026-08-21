// @ts-check
/** Scope declaration orchestration across bounded selection, parsing and selected-index convergence. */
import { allocateScope } from './declaration.js';
import { convergeScopeIndex } from './index-convergence.js';
import { materializeScopeSymbols } from './materialization.js';
import { getScopeStats } from './query.js';
import { selectAndWarmScopePaths } from './selection.js';
import { MAX_ACTIVE_SCOPES, _warmControllers, _warmPromises, markScopeReady, recordScopeFailure } from './state.js';

/** @typedef {import('./types.js').ScopeDeclareOptions} ScopeDeclareOptions */
/** @typedef {import('./types.js').ScopeStats} ScopeStats */

/**
 * Declares a bounded session working set and starts warm/parse/index convergence in the background.
 * @param {ScopeDeclareOptions} opts
 * @returns {{ sessionId: string; ready: boolean; awaitReady: () => Promise<ScopeStats> }}
 */
export function declareScope(opts) {
    const { scope, warmController, previousWarmPromise } = allocateScope(opts);
    const silent = opts.silent ?? true;
    const parseSymbols = opts.parseSymbols ?? true;
    const sessionId = opts.sessionId;

    const warmPromise = (async () => {
        try {
            if (previousWarmPromise) await previousWarmPromise.catch(() => undefined);
            const { resolvedPaths, warmSnapshots } = await selectAndWarmScopePaths(scope, opts, warmController.signal);
            if (warmController.signal.aborted) return;
            await materializeScopeSymbols(scope, resolvedPaths, warmSnapshots, {
                parseSymbols,
                silent,
                signal: warmController.signal,
            });
            if (warmController.signal.aborted) return;
            await convergeScopeIndex(scope, resolvedPaths, warmSnapshots, opts, warmController.signal);
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
            if (_warmControllers.get(sessionId) === warmController) _warmControllers.delete(sessionId);
        }
    })();
    _warmPromises.set(sessionId, warmPromise);

    return {
        sessionId,
        ready: false,
        awaitReady: async () => {
            await (_warmPromises.get(sessionId) ?? Promise.resolve());
            return (
                getScopeStats(sessionId) ?? {
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
                        code: 'ESCOPECLOSED',
                        name: 'ScopeLifecycleError',
                        summary: 'escopo fechado antes do snapshot de prontidão',
                        atMs: Date.now(),
                    },
                    startedAt: scope.startedAt,
                    completedAt: Date.now(),
                    maxActiveScopes: MAX_ACTIVE_SCOPES,
                }
            );
        },
    };
}
