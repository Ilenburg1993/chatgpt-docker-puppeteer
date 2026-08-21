// @ts-check
/** Lightweight registry for explicit prefetch sessions. */

import { warmCacheForPaths } from './cache-warm.js';

/** @typedef {import('./types.js').PrefetchOptions} PrefetchOptions */
/** @typedef {import('./types.js').SessionScopeStats} SessionScopeStats */
/** @typedef {import('./types.js')._SessionScope} _SessionScope */

/** @type {Map<string, _SessionScope>} */
const _scopes = new Map();

/**
 * @param {string} sessionId
 * @param {string[]} paths
 * @param {PrefetchOptions} [opts]
 * @returns {Promise<
 *     SessionScopeStats & { snapshots?: Map<string, import('#copilot/infra/internal/filesystem/read').TextFileSnapshot> }
 * >}
 */
export async function startSessionScope(sessionId, paths, opts = {}) {
    /** @type {_SessionScope} */
    const scope = {
        sessionId,
        paths: [...paths],
        preloaded: 0,
        failed: 0,
        skipped: 0,
        startedAt: Date.now(),
        endedAt: null,
        active: true,
    };
    _scopes.set(sessionId, scope);

    const result = await warmCacheForPaths(paths, opts);
    scope.preloaded = result.preloaded;
    scope.failed = result.failed;
    scope.skipped = result.skipped;

    return {
        ..._toStats(scope, result.durationMs),
        ...(result.snapshots ? { snapshots: result.snapshots } : {}),
    };
}

/**
 * @param {string} sessionId
 * @returns {SessionScopeStats | null}
 */
export function getSessionScopeStats(sessionId) {
    const scope = _scopes.get(sessionId);
    if (!scope) return null;
    return _toStats(
        scope,
        scope.active ? Date.now() - scope.startedAt : (scope.endedAt ?? Date.now()) - scope.startedAt,
    );
}

/**
 * @param {string} sessionId
 * @returns {SessionScopeStats | null}
 */
export function endSessionScope(sessionId) {
    const scope = _scopes.get(sessionId);
    if (!scope) return null;
    scope.active = false;
    scope.endedAt = Date.now();
    const stats = _toStats(scope, scope.endedAt - scope.startedAt);
    _scopes.delete(sessionId);
    return stats;
}

/**
 * @returns {string[]}
 */
export function listSessionScopes() {
    return [..._scopes.keys()];
}

/**
 * @param {_SessionScope} scope
 * @param {number} durationMs
 * @returns {SessionScopeStats}
 */
function _toStats(scope, durationMs) {
    return {
        sessionId: scope.sessionId,
        preloaded: scope.preloaded,
        failed: scope.failed,
        skipped: scope.skipped,
        durationMs,
        pathCount: scope.paths.length,
        active: scope.active,
    };
}
