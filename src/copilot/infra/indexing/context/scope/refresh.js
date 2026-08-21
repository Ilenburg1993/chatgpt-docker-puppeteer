// @ts-check
/** Invalidation, delta refresh and scope shutdown lifecycle. */

import { invalidateIoCoherencePath } from '#copilot/infra/internal/filesystem/invalidation/coherence';
import { parseAndCacheSymbols } from '#copilot/infra/internal/indexing/parser/cache';
import pLimit from 'p-limit';
import { warmCacheForPaths } from '../prefetch/index.js';
import { getScopeStats } from './query.js';
import {
    abortWarmForSession,
    isScopePathRemovalError,
    markScopeReady,
    normalizeScopePath,
    recordScopeFailure,
    releaseScopeInvalidationHookIfIdle,
    removeScopePath,
    scopeContainsPath,
    setScopeSymbols,
    touchScope,
} from './state.js';

/** @typedef {import('./types.js').ScopeStats} ScopeStats */

/**
 * Invalida L1 cache e símbolo cache para um path específico. Chamado automaticamente pelo io-engine após escritas —
 * pode ser chamado manualmente.
 *
 * @param {string} sessionId
 * @param {string} filePath
 * @param {import('./state.js').ScopeRuntimeState | undefined} runtime
 * @returns {void}
 */
export function invalidateScopePath(sessionId, filePath, runtime) {
    // O bus é o SSOT de coerência local: invalidar L1 publica sincronicamente para parser, todos os scopes e índice.
    // `sessionId` identifica a visão lógica do caller; o path físico pode ser compartilhado entre sessões.
    void sessionId;
    invalidateIoCoherencePath(filePath, {}, runtime?.invalidationBus ?? undefined);
}

/**
 * Atualiza somente o delta conhecido do working set. Sem modifiedPaths e sem invalidations pendentes, é no-op O(1);
 * refresh integral exige que o caller forneça explicitamente os paths.
 *
 * @param {string} sessionId
 * @param {string[] | undefined} modifiedPaths - Paths explicitamente alterados; quando omitido usa somente invalidatedPaths.
 * @param {import('./state.js').ScopeRuntimeState} runtime
 * @returns {Promise<{ refreshed: number; removed: number; failed: number; skipped: number }>}
 */
export async function refreshScope(sessionId, modifiedPaths, runtime) {
    const scope = runtime.registry.get(sessionId);
    const refreshIndexPaths = runtime.indexRegistry?.refreshPaths ?? null;
    if (!scope) return { refreshed: 0, removed: 0, failed: 0, skipped: 0 };
    touchScope(scope);

    const targets = [...new Set((modifiedPaths ?? [...scope.invalidatedPaths]).map(normalizeScopePath))];
    let refreshed = 0;
    let removed = 0;
    let failed = 0;
    let skipped = 0;
    if (targets.length === 0) return { refreshed, removed, failed, skipped };

    const limit = pLimit(scope.refreshConcurrency);
    await Promise.all(
        targets.map((p) =>
            limit(async () => {
                if (!scopeContainsPath(scope, p)) {
                    skipped++;
                    return;
                }
                const refreshKey = `${sessionId}\u0000${p}`;
                const inProgress = runtime.refreshingPaths.get(refreshKey);
                if (inProgress) {
                    await inProgress;
                    return;
                }
                const refreshPromise = (async () => {
                    try {
                        // Um único evento canônico limpa L1 e todo estado derivado (parser/scopes/index) no processo atual.
                        invalidateIoCoherencePath(p, {}, runtime.invalidationBus ?? undefined);
                        const warm = await warmCacheForPaths([p], {
                            concurrency: 1,
                            silent: false,
                            captureTextSnapshots: true,
                            cacheBytes: false,
                            ...(runtime.cacheRuntime ? { cacheRuntime: runtime.cacheRuntime } : {}),
                        });
                        const snapshot = warm.snapshots?.get(p);
                        if (!snapshot) throw new Error('scope refresh snapshot unavailable');
                        const symbols = await parseAndCacheSymbols(p, {
                            snapshot,
                            ...(runtime.parserCacheRuntime ? { parserCacheRuntime: runtime.parserCacheRuntime } : {}),
                        });
                        if (scope.indexMode !== 'off' && scope.workspaceRoot && refreshIndexPaths) {
                            const indexResult = await refreshIndexPaths([p], {
                                workspaceRoot: scope.workspaceRoot,
                                snapshots: new Map([[p, snapshot]]),
                                parsedSymbols: new Map([[p, symbols]]),
                            });
                            if (Number(indexResult.failed ?? 0) > 0) {
                                throw new Error('scope refresh index update failed');
                            }
                        }
                        setScopeSymbols(scope, p, symbols);
                        scope.invalidatedPaths.delete(p);
                        return /** @type {const} */ ('refreshed');
                    } catch (error) {
                        if (isScopePathRemovalError(error)) {
                            let indexFailed = false;
                            if (scope.indexMode !== 'off' && scope.workspaceRoot && refreshIndexPaths) {
                                try {
                                    const indexResult = await refreshIndexPaths([p], {
                                        workspaceRoot: scope.workspaceRoot,
                                    });
                                    if (Number(indexResult.failed ?? 0) > 0) {
                                        indexFailed = true;
                                        recordScopeFailure(
                                            scope,
                                            { code: 'EINDEXPARTIAL', name: 'ScopeIndexError' },
                                            'index',
                                            'índice do working set falhou ao convergir remoção',
                                        );
                                    }
                                } catch (indexError) {
                                    indexFailed = true;
                                    recordScopeFailure(
                                        scope,
                                        indexError,
                                        'index',
                                        'índice do working set falhou ao convergir remoção',
                                    );
                                }
                            }
                            removeScopePath(scope, p);
                            return indexFailed
                                ? /** @type {const} */ ('removed-failed')
                                : /** @type {const} */ ('removed');
                        }
                        recordScopeFailure(scope, error, 'refresh', 'atualização do escopo falhou');
                        return /** @type {const} */ ('failed');
                    }
                })();
                runtime.refreshingPaths.set(refreshKey, refreshPromise);
                try {
                    const outcome = await refreshPromise;
                    if (outcome === 'refreshed') refreshed++;
                    else if (outcome === 'removed') removed++;
                    else if (outcome === 'removed-failed') {
                        removed++;
                        failed++;
                    } else failed++;
                } finally {
                    if (runtime.refreshingPaths.get(refreshKey) === refreshPromise)
                        runtime.refreshingPaths.delete(refreshKey);
                }
            }),
        ),
    );

    scope.completedAt = Date.now();
    if (failed === 0 && scope.invalidatedPaths.size === 0) {
        markScopeReady(scope);
    } else {
        scope.ready = false;
        scope.degraded = failed > 0;
    }
    return { refreshed, removed, failed, skipped };
}

/**
 * Encerra escopo de sessão e libera recursos.
 *
 * @param {string} sessionId
 * @param {import('./state.js').ScopeRuntimeState} runtime
 * @returns {ScopeStats | null}
 */
export function closeScope(sessionId, runtime) {
    const stats = getScopeStats(sessionId, runtime);
    abortWarmForSession(sessionId, runtime);
    runtime.registry.delete(sessionId);
    runtime.warmPromises.delete(sessionId);
    runtime.prefetchSessions.end(sessionId);
    releaseScopeInvalidationHookIfIdle(runtime);
    return stats;
}
