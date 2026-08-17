// @ts-check
/**
 * Registry do índice L2 de I/O.
 *
 * O índice é lazy e local ao processo. Ele usa `copilot.sqlite`, mas permanece separado do cache blob L2: cache acelera
 * payloads; índice responde perguntas de descoberta, busca e navegação simbólica.
 *
 * @module copilot/infra/io-index-registry
 */

import { getCopilotDb } from '#copilot/db';
import { extname, resolve } from 'node:path';
import { beginIoAdvisoryBudget } from './io-advisory-budget.js';
import { registerInvalidationHook } from './io-cache.js';
import { DEFAULT_INDEX_EXTENSIONS } from './index-store/index.js';
import { readTextFileSnapshot } from './io/fs/read-text.js';
import { statPathSnapshot } from './io/fs/stat.js';
import { createIoIndexSqlite } from './io-index-sqlite.js';
import { readEnvNonNegativeInt, readEnvPositiveInt } from './shared/env.js';

/** @type {ReturnType<typeof createIoIndexSqlite> | null} */
let _ioIndex = null;

/** @type {Map<string, Promise<unknown>>} */
const _inflightIndexBuilds = new Map();

/** @type {(() => void) | null} */
let _indexInvalidationUnregister = null;
/** @type {string | null} */
let _indexWorkspaceRoot = null;
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
};

/** Runtime configuration for the derived-state refresh scheduler. */
export function readIoIndexAutoRefreshConfig() {
    const enabledRaw = String(process.env['IO_INDEX_AUTO_REFRESH_ENABLED'] ?? '1').trim().toLowerCase();
    return {
        enabled: !['0', 'false', 'off'].includes(enabledRaw),
        debounceMs: readEnvNonNegativeInt('IO_INDEX_AUTO_REFRESH_DEBOUNCE_MS', 100),
        maxBatch: Math.min(512, readEnvPositiveInt('IO_INDEX_AUTO_REFRESH_MAX_BATCH', 64)),
    };
}

/** @param {string} filePath @param {{ recursive?: boolean; source?: string }} [event] */
function scheduleIoIndexAutoRefresh(filePath, event = {}) {
    const config = readIoIndexAutoRefreshConfig();
    if (!config.enabled) return;
    if (event.recursive === true) {
        _indexAutoRefreshStats.recursiveSkipped += 1;
        return;
    }
    if (!_indexWorkspaceRoot) {
        _indexAutoRefreshStats.missingWorkspaceRoot += 1;
        return;
    }
    const normalized = resolve(filePath);
    if (_pendingIndexRefreshPaths.has(normalized)) _indexAutoRefreshStats.coalesced += 1;
    else {
        _pendingIndexRefreshPaths.set(normalized, Date.now());
        _indexAutoRefreshStats.queued += 1;
        _indexAutoRefreshStats.highWater = Math.max(_indexAutoRefreshStats.highWater, _pendingIndexRefreshPaths.size);
    }
    armIoIndexAutoRefreshTimer(config.debounceMs);
}

/** @param {number} delayMs */
function armIoIndexAutoRefreshTimer(delayMs) {
    if (
        _indexRefreshTimer ||
        _indexRefreshRunning ||
        _inflightIndexBuilds.size > 0 ||
        _pendingIndexRefreshPaths.size === 0
    )
        return;
    _indexRefreshTimer = setTimeout(() => {
        _indexRefreshTimer = null;
        void flushIoIndexAutoRefresh();
    }, Math.max(0, delayMs));
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
    if (_inflightIndexBuilds.size > 0) {
        armIoIndexAutoRefreshTimer(readIoIndexAutoRefreshConfig().debounceMs);
        return null;
    }

    const config = readIoIndexAutoRefreshConfig();
    const batchEntries = [..._pendingIndexRefreshPaths.entries()].slice(0, config.maxBatch);
    for (const [filePath] of batchEntries) _pendingIndexRefreshPaths.delete(filePath);
    const oldestQueuedAt = Math.min(...batchEntries.map(([, queuedAt]) => queuedAt));
    const lagMs = Math.max(0, Date.now() - oldestQueuedAt);
    _indexRefreshRunning = true;
    try {
        const result = await refreshIoIndexPaths(
            batchEntries.map(([filePath]) => filePath),
            { workspaceRoot: _indexWorkspaceRoot },
        );
        _indexAutoRefreshStats.batches += 1;
        _indexAutoRefreshStats.requested += batchEntries.length;
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

function ensureIndexInvalidationHook() {
    if (_indexInvalidationUnregister) return;
    _indexInvalidationUnregister =
        registerInvalidationHook((filePath, event) => {
            try {
                getIoIndex()?.invalidatePath(filePath);
                scheduleIoIndexAutoRefresh(filePath, event);
            } catch {
                /* invalidation hooks não devem derrubar o writer */
            }
        }) ?? null;
}

function isDisabled() {
    return String(process.env['IO_INDEX_ENABLED'] ?? '1').trim() === '0';
}

export function getIoIndex() {
    ensureIndexInvalidationHook();
    if (isDisabled()) return null;
    if (_ioIndex) return _ioIndex;
    try {
        _ioIndex = createIoIndexSqlite({ db: getCopilotDb() });
        return _ioIndex;
    } catch {
        return null;
    }
}

export function getIoIndexStats() {
    const index = getIoIndex();
    if (!index) {
        return {
            enabled: false,
            available: false,
            reason: isDisabled() ? 'disabled-via-env' : 'unavailable',
            autoRefresh: getIoIndexAutoRefreshStats(),
        };
    }
    return { ...index.getStats(), autoRefresh: getIoIndexAutoRefreshStats() };
}

/**
 * @param {string} directory
 * @param {Parameters<NonNullable<ReturnType<typeof getIoIndex>>['indexDirectory']>[1]} [options]
 */
export async function buildIoIndexForDirectory(directory, options = {}) {
    _indexWorkspaceRoot = resolve(options.workspaceRoot ?? directory);
    const index = getIoIndex();
    if (!index) {
        return {
            available: false,
            indexed: 0,
            skipped: 0,
            failed: 0,
            durationMs: 0,
            reason: 'index-unavailable',
        };
    }

    const normalizedDirectory = resolve(directory);
    const key = JSON.stringify([
        normalizedDirectory,
        options.workspaceRoot ? resolve(options.workspaceRoot) : null,
        options.recursive ?? null,
        options.depth ?? null,
        options.respectGitignore ?? null,
        options.concurrency ?? null,
        options.maxFiles ?? null,
        options.pruneMissing ?? null,
        options.extensions ? [...options.extensions].map((ext) => String(ext).toLowerCase()).sort() : null,
        options.include ? [...options.include].map(String).sort() : null,
        options.exclude ? [...options.exclude].map(String).sort() : null,
    ]);

    const mayCoalesce = options.signal === undefined;
    const inflight = mayCoalesce ? _inflightIndexBuilds.get(key) : null;
    if (inflight) {
        return /** @type {Awaited<ReturnType<typeof index.indexDirectory>>} */ (await inflight);
    }

    const budget = beginIoAdvisoryBudget({
        operation: 'index.build',
    });
    const buildPromise = (async () => {
        try {
            return await index.indexDirectory(directory, options);
        } finally {
            budget.finish();
            if (mayCoalesce) _inflightIndexBuilds.delete(key);
            if (_pendingIndexRefreshPaths.size > 0) armIoIndexAutoRefreshTimer(readIoIndexAutoRefreshConfig().debounceMs);
        }
    })();

    if (mayCoalesce) _inflightIndexBuilds.set(key, buildPromise);
    return await buildPromise;
}

/**
 * Refresh only explicit files in the shared index. Missing/non-indexable paths are invalidated. This is the primitive
 * used by incremental startup so MCP/LLM-B edits do not require a directory-wide scan.
 *
 * @param {readonly string[]} filePaths
 * @param {{ workspaceRoot: string; extensions?: readonly string[]; signal?: AbortSignal }} options
 */
export async function refreshIoIndexPaths(filePaths, options) {
    _indexWorkspaceRoot = resolve(options.workspaceRoot);
    const index = getIoIndex();
    if (!index) return { available: false, requested: filePaths.length, indexed: 0, invalidated: 0, skipped: 0, failed: 0 };
    const workspaceRoot = resolve(options.workspaceRoot);
    const extensions = new Set((options.extensions ?? DEFAULT_INDEX_EXTENSIONS).map((value) => String(value).toLowerCase()));
    let indexed = 0;
    let invalidated = 0;
    let unchanged = 0;
    let skipped = 0;
    let failed = 0;
    const startedAt = Date.now();
    for (const rawPath of new Set(filePaths.map((value) => resolve(value)))) {
        options.signal?.throwIfAborted();
        if (!extensions.has(extname(rawPath).toLowerCase())) {
            if (index.invalidatePath(rawPath)) invalidated += 1;
            skipped += 1;
            continue;
        }
        try {
            const stat = await statPathSnapshot(rawPath);
            if (!stat.isFile()) {
                if (index.invalidatePath(rawPath)) invalidated += 1;
                skipped += 1;
                continue;
            }
            if (
                index.matchesFileFingerprint(rawPath, {
                    sizeBytes: stat.size,
                    mtimeMs: stat.mtimeMs,
                    ctimeMs: stat.ctimeMs,
                    dev: Number(stat.dev),
                    ino: Number(stat.ino),
                })
            ) {
                unchanged += 1;
                continue;
            }
            const snapshot = await readTextFileSnapshot(rawPath, options.signal ? { signal: options.signal } : {});
            await index.indexTextFile(
                {
                    filePath: rawPath,
                    workspaceRoot,
                    content: snapshot.content,
                    sizeBytes: snapshot.sizeBytes,
                    mtimeMs: snapshot.mtimeMs,
                    ctimeMs: snapshot.ctimeMs,
                    dev: snapshot.dev,
                    ino: snapshot.ino,
                    metadata: { refreshMode: 'explicit-path' },
                },
                options.signal ? { signal: options.signal } : {},
            );
            indexed += 1;
        } catch (error) {
            options.signal?.throwIfAborted();
            const code = error && typeof error === 'object' && 'code' in error ? String(error.code ?? '') : '';
            if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
                if (index.invalidatePath(rawPath)) invalidated += 1;
                continue;
            }
            failed += 1;
        }
    }
    return {
        available: true,
        requested: filePaths.length,
        indexed,
        invalidated,
        unchanged,
        skipped,
        failed,
        durationMs: Math.max(0, Date.now() - startedAt),
    };
}

/**
 * @param {string} query
 * @param {Parameters<NonNullable<ReturnType<typeof getIoIndex>>['search']>[1]} [options]
 */
export function searchIoIndex(query, options = {}) {
    return getIoIndex()?.search(query, options) ?? [];
}

/**
 * Search exact literal substrings in raw indexed chunks without spawning an external grep process.
 *
 * @param {string} query
 * @param {Parameters<NonNullable<ReturnType<typeof getIoIndex>>['searchLiteral']>[1]} [options]
 */
export function searchIoIndexLiteral(query, options = {}) {
    return getIoIndex()?.searchLiteral(query, options) ?? [];
}

/**
 * @param {string} name
 * @param {Parameters<NonNullable<ReturnType<typeof getIoIndex>>['findSymbol']>[1]} [options]
 */
export function findIoIndexSymbol(name, options = {}) {
    return getIoIndex()?.findSymbol(name, options) ?? [];
}

/**
 * @param {string} source
 * @param {{ maxResults?: number; exactSource?: boolean }} [options]
 */
export function findIoIndexImports(source, options = {}) {
    return getIoIndex()?.findImports(source, options) ?? [];
}

/**
 * @param {string} pathPrefix
 * @returns {ReturnType<NonNullable<ReturnType<typeof getIoIndex>>['findImportsByPath']>}
 */
export function findIoIndexImportsByPath(pathPrefix) {
    return getIoIndex()?.findImportsByPath(pathPrefix) ?? [];
}

/**
 * @param {string} filePath
 */
export function invalidateIoIndexPath(filePath) {
    return getIoIndex()?.invalidatePath(filePath) ?? false;
}

export function resetIoIndexForTest() {
    _ioIndex = null;
    _inflightIndexBuilds.clear();
    _indexWorkspaceRoot = null;
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
    });
    _indexInvalidationUnregister?.();
    _indexInvalidationUnregister = null;
}
