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
import { extname, relative, resolve } from 'node:path';
import pLimit from 'p-limit';
import { DEFAULT_INDEX_EXTENSIONS } from './index-store/index.js';
import { beginIoAdvisoryBudget } from './io-advisory-budget.js';
import { registerInvalidationHook } from './io-cache.js';
import { createIoIndexSqlite } from './io-index-sqlite.js';
import { readTextFileSnapshot } from './io/fs/read-text.js';
import { statPathSnapshot } from './io/fs/stat.js';
import { BABEL_PARSER_POLICY_VERSION } from './parse/babel-policy.js';
import { loadGitignoreMatcher } from './scan/gitignore.js';
import { matchesAnyPattern } from './scan/glob.js';
import { readEnvNonNegativeInt, readEnvPositiveInt } from './shared/env.js';
import { richFingerprintMatches } from './shared/fingerprint-match.js';

/** @type {ReturnType<typeof createIoIndexSqlite> | null} */
let _ioIndex = null;

/** @type {Map<string, Promise<unknown>>} */
const _inflightIndexBuilds = new Map();

/** @type {(() => void) | null} */
let _indexInvalidationUnregister = null;
/** @type {string | null} */
let _indexWorkspaceRoot = null;
/** @typedef {{
    scopeRoot: string;
    workspaceRoot: string;
    extensions: Set<string>;
    respectGitignore: boolean;
    include: string[];
    exclude: string[];
}} IndexAutoRefreshDomain */
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

/** Runtime configuration for the derived-state refresh scheduler. */
export function readIoIndexAutoRefreshConfig() {
    const enabledRaw = String(process.env['IO_INDEX_AUTO_REFRESH_ENABLED'] ?? '1')
        .trim()
        .toLowerCase();
    return {
        enabled: !['0', 'false', 'off'].includes(enabledRaw),
        debounceMs: readEnvNonNegativeInt('IO_INDEX_AUTO_REFRESH_DEBOUNCE_MS', 100),
        maxBatch: Math.min(512, readEnvPositiveInt('IO_INDEX_AUTO_REFRESH_MAX_BATCH', 64)),
    };
}

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

/**
 * @param {string} scopeRoot
 * @param {{
 *     workspaceRoot?: string;
 *     extensions?: readonly string[];
 *     respectGitignore?: boolean;
 *     include?: readonly string[];
 *     exclude?: readonly string[];
 * }} [options]
 * @returns {IndexAutoRefreshDomain}
 */
function createIndexAutoRefreshDomain(scopeRoot, options = {}) {
    const workspaceRoot = resolve(options.workspaceRoot ?? scopeRoot);
    return {
        scopeRoot: resolve(scopeRoot),
        workspaceRoot,
        extensions: new Set(
            (options.extensions ?? DEFAULT_INDEX_EXTENSIONS).map((extension) => String(extension).toLowerCase()),
        ),
        respectGitignore: options.respectGitignore !== false,
        include: [...(options.include ?? [])].map(String),
        exclude: [...(options.exclude ?? [])].map(String),
    };
}

/** @param {string} filePath @param {IndexAutoRefreshDomain} domain */
function isIndexRefreshDomainCandidate(filePath, domain) {
    const normalized = resolve(filePath);
    const relativeToScope = relative(domain.scopeRoot, normalized).replace(/\\/gu, '/');
    if (!relativeToScope || relativeToScope === '..' || relativeToScope.startsWith('../')) return false;
    if (relativeToScope.split('/').some((segment) => segment.startsWith('.') && segment.length > 1)) return false;
    if (!domain.extensions.has(extname(normalized).toLowerCase())) return false;
    if (domain.include.length > 0 && !matchesAnyPattern(normalized, domain.scopeRoot, domain.include)) return false;
    if (domain.exclude.length > 0 && matchesAnyPattern(normalized, domain.scopeRoot, domain.exclude)) return false;
    return true;
}

/** @param {string} filePath */
function isIndexAutoRefreshDomainCandidate(filePath) {
    const domain = _indexAutoRefreshDomain;
    return domain ? isIndexRefreshDomainCandidate(filePath, domain) : false;
}

/**
 * Preflight explicit paths against the same semantic domain used by runtime auto-refresh, without mutating global
 * scheduler state. Intended for startup/checkpoint replay and other evidence-gathering callers.
 *
 * @param {readonly string[]} filePaths
 * @param {{
 *     scopeRoot: string;
 *     workspaceRoot?: string;
 *     extensions?: readonly string[];
 *     respectGitignore?: boolean;
 *     include?: readonly string[];
 *     exclude?: readonly string[];
 * }} options
 */
export async function filterIoIndexRefreshDomainPaths(filePaths, options) {
    const domain = createIndexAutoRefreshDomain(options.scopeRoot, options);
    const unique = [...new Set(filePaths.map((value) => resolve(value)))];
    const candidates = [];
    let domainSkipped = 0;
    for (const filePath of unique) {
        if (!isIndexRefreshDomainCandidate(filePath, domain)) {
            domainSkipped += 1;
            continue;
        }
        candidates.push(filePath);
    }
    if (!domain.respectGitignore || candidates.length === 0) {
        return { paths: candidates, requested: unique.length, domainSkipped, gitignoredSkipped: 0 };
    }
    const matcher = await loadGitignoreMatcher(domain.workspaceRoot);
    const paths = [];
    let gitignoredSkipped = 0;
    for (const filePath of candidates) {
        const relativePath = relative(domain.workspaceRoot, filePath).replace(/\\/gu, '/');
        if (relativePath && matcher.ignores(relativePath)) {
            gitignoredSkipped += 1;
            continue;
        }
        paths.push(filePath);
    }
    return { paths, requested: unique.length, domainSkipped, gitignoredSkipped };
}

/** @param {string} filePath @param {{ recursive?: boolean; source?: string }} [event] */
function scheduleIoIndexAutoRefresh(filePath, event = {}) {
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
        _inflightIndexBuilds.size > 0 ||
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
    if (_inflightIndexBuilds.size > 0) {
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
                ? await refreshIoIndexPaths(refreshPaths, {
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
    const index = getIoIndex();
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
 * @param {Parameters<NonNullable<ReturnType<typeof getIoIndex>>['indexDirectory']>[1] & {
 *     adoptAutoRefreshDomain?: boolean;
 * }} [options]
 */
export async function buildIoIndexForDirectory(directory, options = {}) {
    if (options.adoptAutoRefreshDomain === true) configureIndexAutoRefreshDomain(directory, options);
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
            if (_pendingIndexRefreshPaths.size > 0)
                armIoIndexAutoRefreshTimer(readIoIndexAutoRefreshConfig().debounceMs);
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
 * @param {{
 *     workspaceRoot: string;
 *     scopeRoot?: string;
 *     extensions?: readonly string[];
 *     respectGitignore?: boolean;
 *     include?: readonly string[];
 *     exclude?: readonly string[];
 *     snapshots?: ReadonlyMap<string, import('./io/fs/read-text.js').TextFileSnapshot>;
 *     parsedSymbols?: ReadonlyMap<string, import('./io-parser.js').FileSymbols>;
 *     concurrency?: number;
 *     signal?: AbortSignal;
 * }} options
 */
export async function refreshIoIndexPaths(filePaths, options) {
    if (options.scopeRoot) configureIndexAutoRefreshDomain(options.scopeRoot, options);
    else _indexWorkspaceRoot = resolve(options.workspaceRoot);
    const index = getIoIndex();
    if (!index) {
        return {
            available: false,
            requested: filePaths.length,
            indexed: 0,
            invalidated: 0,
            unchanged: 0,
            snapshotReuses: 0,
            parsedSymbolReuses: 0,
            parsedSymbolPolicyRejects: 0,
            skipped: 0,
            failed: 0,
            concurrency: 0,
            durationMs: 0,
        };
    }
    const workspaceRoot = resolve(options.workspaceRoot);
    const extensions = new Set(
        (options.extensions ?? DEFAULT_INDEX_EXTENSIONS).map((value) => String(value).toLowerCase()),
    );
    const domain = options.scopeRoot ? _indexAutoRefreshDomain : null;
    const gitignore = domain?.respectGitignore ? await loadGitignoreMatcher(domain.workspaceRoot) : null;
    let indexed = 0;
    let invalidated = 0;
    let unchanged = 0;
    let snapshotReuses = 0;
    let parsedSymbolReuses = 0;
    let parsedSymbolPolicyRejects = 0;
    let skipped = 0;
    let failed = 0;
    const startedAt = Date.now();
    const concurrency = Math.min(
        32,
        Number.isFinite(options.concurrency) && Number(options.concurrency) > 0
            ? Math.max(1, Math.floor(Number(options.concurrency)))
            : readEnvPositiveInt('IO_INDEX_REFRESH_CONCURRENCY', 8),
    );
    const limit = pLimit(concurrency);
    const uniquePaths = [...new Set(filePaths.map((value) => resolve(value)))];
    await Promise.all(
        uniquePaths.map((rawPath) =>
            limit(async () => {
                options.signal?.throwIfAborted();
                if (domain && !isIndexAutoRefreshDomainCandidate(rawPath)) {
                    if (index.invalidatePath(rawPath)) invalidated += 1;
                    skipped += 1;
                    settlePendingIndexAutoRefresh(rawPath);
                    return;
                }
                if (gitignore) {
                    const relativePath = relative(domain?.workspaceRoot ?? workspaceRoot, rawPath).replace(/\\/gu, '/');
                    if (relativePath && gitignore.ignores(relativePath)) {
                        if (index.invalidatePath(rawPath)) invalidated += 1;
                        skipped += 1;
                        settlePendingIndexAutoRefresh(rawPath);
                        return;
                    }
                }
                if (!extensions.has(extname(rawPath).toLowerCase())) {
                    if (index.invalidatePath(rawPath)) invalidated += 1;
                    skipped += 1;
                    settlePendingIndexAutoRefresh(rawPath);
                    return;
                }
                try {
                    const stat = await statPathSnapshot(rawPath);
                    if (!stat.isFile()) {
                        if (index.invalidatePath(rawPath)) invalidated += 1;
                        skipped += 1;
                        settlePendingIndexAutoRefresh(rawPath);
                        return;
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
                        settlePendingIndexAutoRefresh(rawPath);
                        return;
                    }
                    const suppliedSnapshot = options.snapshots?.get(rawPath) ?? null;
                    const snapshot =
                        suppliedSnapshot &&
                        richFingerprintMatches(
                            {
                                sizeBytes: suppliedSnapshot.sizeBytes,
                                mtimeMs: suppliedSnapshot.mtimeMs,
                                ctimeMs: suppliedSnapshot.ctimeMs,
                                dev: suppliedSnapshot.dev,
                                ino: suppliedSnapshot.ino,
                            },
                            {
                                sizeBytes: stat.size,
                                mtimeMs: stat.mtimeMs,
                                ctimeMs: stat.ctimeMs,
                                dev: Number(stat.dev),
                                ino: Number(stat.ino),
                            },
                            { mtimeToleranceMs: 0 },
                        )
                            ? suppliedSnapshot
                            : await readTextFileSnapshot(rawPath, options.signal ? { signal: options.signal } : {});
                    if (snapshot === suppliedSnapshot) snapshotReuses += 1;
                    const candidateSymbols =
                        snapshot === suppliedSnapshot ? options.parsedSymbols?.get(rawPath) : undefined;
                    const suppliedSymbols =
                        candidateSymbols?.parserPolicyVersion === BABEL_PARSER_POLICY_VERSION
                            ? candidateSymbols
                            : undefined;
                    if (suppliedSymbols) parsedSymbolReuses += 1;
                    else if (candidateSymbols) parsedSymbolPolicyRejects += 1;
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
                        {
                            ...(options.signal ? { signal: options.signal } : {}),
                            ...(suppliedSymbols ? { parsedSymbols: suppliedSymbols } : {}),
                        },
                    );
                    indexed += 1;
                    settlePendingIndexAutoRefresh(rawPath);
                } catch (error) {
                    options.signal?.throwIfAborted();
                    const code = error && typeof error === 'object' && 'code' in error ? String(error.code ?? '') : '';
                    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
                        if (index.invalidatePath(rawPath)) invalidated += 1;
                        settlePendingIndexAutoRefresh(rawPath);
                        return;
                    }
                    failed += 1;
                }
            }),
        ),
    );
    return {
        available: true,
        requested: filePaths.length,
        indexed,
        invalidated,
        unchanged,
        snapshotReuses,
        parsedSymbolReuses,
        parsedSymbolPolicyRejects,
        skipped,
        failed,
        concurrency,
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
    });
    _indexInvalidationUnregister?.();
    _indexInvalidationUnregister = null;
}
