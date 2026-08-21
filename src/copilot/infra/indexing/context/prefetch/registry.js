// @ts-check
/**
 * Instance-local prefetch session registry.
 *
 * Workspace scope runtimes own one registry instance and provide the runtime-owned L1 cache explicitly.
 *
 * @module copilot/infra/indexing/context/prefetch/registry
 */

import { warmCacheForPaths } from './cache-warm.js';

/** @typedef {import('./types.js').PrefetchOptions} PrefetchOptions */
/** @typedef {import('./types.js').SessionScopeStats} SessionScopeStats */
/** @typedef {import('./types.js')._SessionScope} _SessionScope */

/** @param {{cacheRuntime:NonNullable<import('./types.js').PrefetchOptions['cacheRuntime']>}} options */
export function createPrefetchSessionRegistry(options) {
    if (!options?.cacheRuntime) {
        throw new TypeError('createPrefetchSessionRegistry requires a runtime-owned cacheRuntime.');
    }
    /** @type {Map<string, _SessionScope>} */
    const scopes = new Map();

    /** @param {_SessionScope} scope @returns {SessionScopeStats} */
    function closeScope(scope) {
        if (scope.state === 'closed') return toStats(scope, (scope.endedAt ?? Date.now()) - scope.startedAt);
        scope.state = 'closing';
        scope.active = false;
        scope.endedAt = Date.now();
        scope.state = 'closed';
        if (scopes.get(scope.sessionId) === scope) scopes.delete(scope.sessionId);
        return toStats(scope, scope.endedAt - scope.startedAt);
    }

    /**
     * @param {string} sessionId
     * @param {string[]} paths
     * @param {PrefetchOptions} [opts]
     */
    async function start(sessionId, paths, opts = {}) {
        const normalizedSessionId = String(sessionId ?? '').trim();
        if (!normalizedSessionId) throw new TypeError('startSessionScope requires a non-empty sessionId.');
        if (scopes.has(normalizedSessionId)) {
            const error = /** @type {Error & { code?: string }} */ (
                new Error(`Prefetch session scope already active: ${normalizedSessionId}`)
            );
            error.code = 'ESESSION_SCOPE_ACTIVE';
            throw error;
        }
        /** @type {_SessionScope} */
        const scope = {
            sessionId: normalizedSessionId,
            paths: [...paths],
            preloaded: 0,
            failed: 0,
            skipped: 0,
            startedAt: Date.now(),
            endedAt: null,
            active: true,
            state: 'opening',
        };
        scopes.set(normalizedSessionId, scope);
        try {
            const result = await warmCacheForPaths(paths, {
                ...opts,
                cacheRuntime: options.cacheRuntime,
            });
            scope.preloaded = result.preloaded;
            scope.failed = result.failed;
            scope.skipped = result.skipped;
            scope.state = result.failed > 0 ? 'degraded' : 'ready';
            return {
                ...toStats(scope, result.durationMs),
                ...(result.snapshots ? { snapshots: result.snapshots } : {}),
            };
        } catch (error) {
            closeScope(scope);
            throw error;
        }
    }

    /** @param {string} sessionId */
    function getStats(sessionId) {
        const scope = scopes.get(sessionId);
        if (!scope) return null;
        return toStats(
            scope,
            scope.active ? Date.now() - scope.startedAt : (scope.endedAt ?? Date.now()) - scope.startedAt,
        );
    }

    /** @param {string} sessionId */
    function end(sessionId) {
        const scope = scopes.get(sessionId);
        return scope ? closeScope(scope) : null;
    }

    function list() {
        return [...scopes.keys()];
    }

    function dispose() {
        for (const scope of [...scopes.values()]) closeScope(scope);
    }

    return Object.freeze({ start, getStats, end, list, dispose });
}

/** @param {_SessionScope} scope @param {number} durationMs @returns {SessionScopeStats} */
function toStats(scope, durationMs) {
    return {
        sessionId: scope.sessionId,
        preloaded: scope.preloaded,
        failed: scope.failed,
        skipped: scope.skipped,
        durationMs,
        pathCount: scope.paths.length,
        active: scope.active,
        state: scope.state,
    };
}
