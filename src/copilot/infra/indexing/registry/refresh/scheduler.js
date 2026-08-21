// @ts-check
/** Invalidation-driven index refresh domain, debounce queue and convergence scheduler. */
import { loadGitignoreMatcher } from '#copilot/infra/internal/indexing/scanner';
import { relative, resolve } from 'node:path';
import { getIoIndexInstance, inflightIndexBuilds } from '../state/index.js';
import { createIndexAutoRefreshDomain, isIndexRefreshDomainCandidate, readIoIndexAutoRefreshConfig } from './domain.js';
import { executeIoIndexPathRefresh } from './paths.js';
/** @typedef {import('./domain.js').IndexAutoRefreshDomain} IndexAutoRefreshDomain */

/** @type {string | null} */
let _indexWorkspaceRoot = null;

/** @type {IndexAutoRefreshDomain | null} */
let _indexAutoRefreshDomain = null;
/** @type {Map<string, number>} */
const _pendingIndexRefreshPaths = new Map();
/** @type {NodeJS.Timeout | null} */
let _indexRefreshTimer = null;
let _indexRefreshRunning = false;
const _indexAutoRefreshStats = {
    queued: 0,
    coalesced: 0,
    recursiveSkipped: 0,
    missingWorkspaceRoot: 0,
    domainSkipped: 0,
    gitignoredSkipped: 0,
    domainReconciliations: 0,
    domainPruned: 0,
    batches: 0,
    requested: 0,
    indexed: 0,
    invalidated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    lastDurationMs: /** @type {number | null} */ (null),
    lastLagMs: /** @type {number | null} */ (null),
    maxLagMs: 0,
    highWater: 0,
    explicitConvergences: 0,
};

/**
 * Keep runtime refresh inside the exact semantic domain of the last canonical build/startup refresh.
 *
 * @param {string} scopeRoot
 * @param {{
 *     workspaceRoot?: string;
 *     extensions?: readonly string[];
 *     respectGitignore?: boolean;
 *     include?: readonly string[];
 *     exclude?: readonly string[];
 * }} [options]
 */
function configureIndexAutoRefreshDomain(scopeRoot, options = {}) {
    const domain = createIndexAutoRefreshDomain(scopeRoot, options);
    _indexWorkspaceRoot = domain.workspaceRoot;
    _indexAutoRefreshDomain = domain;
}

/** @param {string} filePath */
function isIndexAutoRefreshDomainCandidate(filePath) {
    const domain = _indexAutoRefreshDomain;
    return domain ? isIndexRefreshDomainCandidate(filePath, domain) : false;
}

/** @param {string} filePath @param {{ recursive?: boolean; source?: string }} [event] */
export function scheduleIoIndexAutoRefresh(filePath, event = {}) {
    const config = readIoIndexAutoRefreshConfig();
    if (!config.enabled) return;
    if (event.recursive === true) {
        _indexAutoRefreshStats.recursiveSkipped += 1;
        return;
    }
    if (!_indexWorkspaceRoot || !_indexAutoRefreshDomain) {
        _indexAutoRefreshStats.missingWorkspaceRoot += 1;
        return;
    }
    const normalized = resolve(filePath);
    if (!isIndexAutoRefreshDomainCandidate(normalized)) {
        _indexAutoRefreshStats.domainSkipped += 1;
        return;
    }
    if (_pendingIndexRefreshPaths.has(normalized)) _indexAutoRefreshStats.coalesced += 1;
    else {
        _pendingIndexRefreshPaths.set(normalized, Date.now());
        _indexAutoRefreshStats.queued += 1;
        _indexAutoRefreshStats.highWater = Math.max(_indexAutoRefreshStats.highWater, _pendingIndexRefreshPaths.size);
    }
    armIoIndexAutoRefreshTimer(config.debounceMs);
}

/**
 * Remove do scheduler um path que já convergiu por refresh explícito. Isso evita que scope/startup façam o mesmo
 * refresh novamente depois do debounce. Falhas não chamam este helper e permanecem elegíveis ao retry assíncrono.
 *
 * @param {string} filePath
 */
function settlePendingIndexAutoRefresh(filePath) {
    const normalized = resolve(filePath);
    if (!_pendingIndexRefreshPaths.delete(normalized)) return false;
    _indexAutoRefreshStats.explicitConvergences += 1;
    if (_pendingIndexRefreshPaths.size === 0 && _indexRefreshTimer && !_indexRefreshRunning) {
        clearTimeout(_indexRefreshTimer);
        _indexRefreshTimer = null;
    }
    return true;
}

/** @param {number} delayMs */
function armIoIndexAutoRefreshTimer(delayMs) {
    if (
        _indexRefreshTimer ||
        _indexRefreshRunning ||
        inflightIndexBuilds.size > 0 ||
        _pendingIndexRefreshPaths.size === 0
    )
        return;
    _indexRefreshTimer = setTimeout(
        () => {
            _indexRefreshTimer = null;
            void flushIoIndexAutoRefresh();
        },
        Math.max(0, delayMs),
    );
    _indexRefreshTimer.unref?.();
}

/**
 * Flush pending path refreshes. Canonical writers never await this function; it exists so lifecycle code/tests can
 * force convergence when needed without widening the write critical path.
 */
export async function flushIoIndexAutoRefresh() {
    if (_indexRefreshTimer) {
        clearTimeout(_indexRefreshTimer);
        _indexRefreshTimer = null;
    }
    if (_indexRefreshRunning || _pendingIndexRefreshPaths.size === 0 || !_indexWorkspaceRoot) return null;
    if (inflightIndexBuilds.size > 0) {
        armIoIndexAutoRefreshTimer(readIoIndexAutoRefreshConfig().debounceMs);
        return null;
    }

    const config = readIoIndexAutoRefreshConfig();
    const batchEntries = [..._pendingIndexRefreshPaths.entries()].slice(0, config.maxBatch);
    for (const [filePath] of batchEntries) _pendingIndexRefreshPaths.delete(filePath);
    const oldestQueuedAt = Math.min(...batchEntries.map(([, queuedAt]) => queuedAt));
    const lagMs = Math.max(0, Date.now() - oldestQueuedAt);
    const domain = _indexAutoRefreshDomain;
    let refreshPaths = batchEntries.map(([filePath]) => filePath);
    if (domain?.respectGitignore) {
        const matcher = await loadGitignoreMatcher(domain.workspaceRoot);
        refreshPaths = refreshPaths.filter((filePath) => {
            const relativePath = relative(domain.workspaceRoot, filePath).replace(/\\/gu, '/');
            const ignored = Boolean(relativePath && matcher.ignores(relativePath));
            if (ignored) _indexAutoRefreshStats.gitignoredSkipped += 1;
            return !ignored;
        });
    }
    _indexRefreshRunning = true;
    try {
        const result =
            refreshPaths.length > 0
                ? await refreshIoIndexPathsScheduled(refreshPaths, {
                      workspaceRoot: _indexWorkspaceRoot,
                      ...(domain ? { extensions: [...domain.extensions] } : {}),
                  })
                : {
                      available: true,
                      requested: 0,
                      indexed: 0,
                      invalidated: 0,
                      unchanged: 0,
                      skipped: 0,
                      failed: 0,
                      durationMs: 0,
                  };
        _indexAutoRefreshStats.batches += 1;
        _indexAutoRefreshStats.requested += refreshPaths.length;
        _indexAutoRefreshStats.indexed += Number(result.indexed ?? 0);
        _indexAutoRefreshStats.invalidated += Number(result.invalidated ?? 0);
        _indexAutoRefreshStats.unchanged += Number(result.unchanged ?? 0);
        _indexAutoRefreshStats.skipped += Number(result.skipped ?? 0);
        _indexAutoRefreshStats.failed += Number(result.failed ?? 0);
        _indexAutoRefreshStats.lastDurationMs = Number(result.durationMs ?? 0);
        _indexAutoRefreshStats.lastLagMs = lagMs;
        _indexAutoRefreshStats.maxLagMs = Math.max(_indexAutoRefreshStats.maxLagMs, lagMs);
        return result;
    } catch {
        _indexAutoRefreshStats.failed += batchEntries.length;
        return null;
    } finally {
        _indexRefreshRunning = false;
        if (_pendingIndexRefreshPaths.size > 0) armIoIndexAutoRefreshTimer(config.debounceMs);
    }
}

export async function reconcileIoIndexAutoRefreshDomain() {
    const index = getIoIndexInstance();
    const domain = _indexAutoRefreshDomain;
    if (!index || !domain) {
        return {
            available: Boolean(index),
            domainKnown: Boolean(domain),
            inspected: 0,
            explicitRefreshRows: 0,
            pruned: 0,
        };
    }
    const matcher = domain.respectGitignore ? await loadGitignoreMatcher(domain.workspaceRoot) : null;
    const rows = index.listIndexedFiles();
    let explicitRefreshRows = 0;
    let pruned = 0;
    for (const row of rows) {
        /** @type {Record<string, unknown> | null} */
        let metadata;
        try {
            metadata = row.metadataJson ? JSON.parse(row.metadataJson) : null;
        } catch {
            continue;
        }
        if (!metadata || metadata['refreshMode'] !== 'explicit-path') continue;
        explicitRefreshRows += 1;
        const candidate = isIndexAutoRefreshDomainCandidate(row.filePath);
        const relativePath = relative(domain.workspaceRoot, row.filePath).replace(/\\/gu, '/');
        const ignored = Boolean(candidate && matcher && relativePath && matcher.ignores(relativePath));
        if (candidate && !ignored) continue;
        if (index.invalidatePath(row.filePath)) pruned += 1;
    }
    _indexAutoRefreshStats.domainReconciliations += 1;
    _indexAutoRefreshStats.domainPruned += pruned;
    return { available: true, domainKnown: true, inspected: rows.length, explicitRefreshRows, pruned };
}

export function getIoIndexAutoRefreshStats() {
    return {
        ..._indexAutoRefreshStats,
        enabled: readIoIndexAutoRefreshConfig().enabled,
        pending: _pendingIndexRefreshPaths.size,
        running: _indexRefreshRunning,
        workspaceRootKnown: Boolean(_indexWorkspaceRoot),
        debounceMs: readIoIndexAutoRefreshConfig().debounceMs,
        maxBatch: readIoIndexAutoRefreshConfig().maxBatch,
    };
}

/**
 * Scheduler-aware explicit path refresh. This is internal; `index-runtime` wraps it to activate the invalidation hook.
 * @param {readonly string[]} filePaths
 * @param {Parameters<typeof executeIoIndexPathRefresh>[2]} options
 */
export async function refreshIoIndexPathsScheduled(filePaths, options) {
    if (options.scopeRoot) configureIndexAutoRefreshDomain(options.scopeRoot, options);
    else _indexWorkspaceRoot = resolve(options.workspaceRoot);
    return executeIoIndexPathRefresh(getIoIndexInstance(), filePaths, options, {
        domain: options.scopeRoot ? _indexAutoRefreshDomain : null,
        settlePending: settlePendingIndexAutoRefresh,
    });
}

/** @param {string} scopeRoot @param {Parameters<typeof configureIndexAutoRefreshDomain>[1]} [options] */
export function adoptIoIndexAutoRefreshDomain(scopeRoot, options = {}) {
    configureIndexAutoRefreshDomain(scopeRoot, options);
}

export function requestIoIndexAutoRefreshDrain() {
    if (_pendingIndexRefreshPaths.size > 0) armIoIndexAutoRefreshTimer(readIoIndexAutoRefreshConfig().debounceMs);
}

export function resetIoIndexAutoRefreshSchedulerForTest() {
    _indexWorkspaceRoot = null;
    _indexAutoRefreshDomain = null;
    _pendingIndexRefreshPaths.clear();
    if (_indexRefreshTimer) {
        clearTimeout(_indexRefreshTimer);
        _indexRefreshTimer = null;
    }
    _indexRefreshRunning = false;
    Object.assign(_indexAutoRefreshStats, {
        queued: 0,
        coalesced: 0,
        recursiveSkipped: 0,
        missingWorkspaceRoot: 0,
        domainSkipped: 0,
        gitignoredSkipped: 0,
        domainReconciliations: 0,
        domainPruned: 0,
        batches: 0,
        requested: 0,
        indexed: 0,
        invalidated: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
        lastDurationMs: null,
        lastLagMs: null,
        maxLagMs: 0,
        highWater: 0,
        explicitConvergences: 0,
    });
}
