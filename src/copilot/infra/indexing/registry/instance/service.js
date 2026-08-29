// @ts-check
/**
 * Instance-owned persistent index runtime.
 *
 * This is the runtime/composition owner for SQLite index materialization, build coalescing, query counters,
 * invalidation-hook lifecycle and auto-refresh scheduling. No operational state escapes the factory closure.
 *
 * @module copilot/infra/indexing/registry/instance/service
 */

import { loadGitignoreMatcher } from '#copilot/infra/internal/indexing/scanner';
import { readEnvNonNegativeInt, readEnvPositiveInt } from '#copilot/infra/internal/platform/env';
import { relative, resolve } from 'node:path';
import {
    createIndexAutoRefreshDomain,
    executeIoIndexPathRefresh,
    filterIoIndexRefreshDomainPaths,
    isIndexRefreshDomainCandidate,
} from '../core/index.js';
import { createIoIndexSqlite } from '../sqlite/index.js';

/** @typedef {ReturnType<typeof createIoIndexSqlite>} IoIndexStore */

/** @param {NodeJS.ProcessEnv | Record<string,string|undefined>} [env] */
export function readIoIndexRuntimeConfig(env = {}) {
    const enabledRaw = String(env['IO_INDEX_AUTO_REFRESH_ENABLED'] ?? '1')
        .trim()
        .toLowerCase();
    return Object.freeze({
        enabled: String(env['IO_INDEX_ENABLED'] ?? '1').trim() !== '0',
        autoRefresh: Object.freeze({
            enabled: !['0', 'false', 'off'].includes(enabledRaw),
            debounceMs: readEnvNonNegativeInt('IO_INDEX_AUTO_REFRESH_DEBOUNCE_MS', 100, env),
            maxBatch: Math.min(512, readEnvPositiveInt('IO_INDEX_AUTO_REFRESH_MAX_BATCH', 64, env)),
            retryBaseMs: readEnvNonNegativeInt('IO_INDEX_AUTO_REFRESH_RETRY_BASE_MS', 250, env),
            retryMaxMs: Math.min(60_000, readEnvPositiveInt('IO_INDEX_AUTO_REFRESH_RETRY_MAX_MS', 10_000, env)),
            retryMaxAttempts: Math.min(20, readEnvPositiveInt('IO_INDEX_AUTO_REFRESH_RETRY_MAX_ATTEMPTS', 5, env)),
        }),
        scanner: Object.freeze({
            batchSize: readEnvPositiveInt('IO_SCAN_BATCH_SIZE', 512, env),
            hardMaxEntries: readEnvPositiveInt('IO_SCAN_HARD_MAX_ENTRIES', 20_000, env),
        }),
        build: Object.freeze({
            concurrency: 8,
            maxFiles: readEnvPositiveInt('IO_INDEX_BUILD_MAX_FILES', 10_000, env),
        }),
        refresh: Object.freeze({
            concurrency: Math.min(32, readEnvPositiveInt('IO_INDEX_REFRESH_CONCURRENCY', 8, env)),
        }),
        sqlite: Object.freeze({
            hashVerifyMaxBytes: readEnvPositiveInt('IO_INDEX_HASH_VERIFY_MAX_BYTES', 1024 * 1024, env),
            hashVerifyIntervalMs: readEnvNonNegativeInt('IO_INDEX_HASH_VERIFY_INTERVAL_MS', 6 * 60 * 60 * 1000, env),
            recheckUnchangedSnapshot: !['0', 'false', 'off'].includes(
                String(env['IO_INDEX_RECHECK_UNCHANGED_SNAPSHOT'] ?? '0')
                    .trim()
                    .toLowerCase(),
            ),
            snapshotRetries: 2,
            queryPolicy: Object.freeze({
                defaultMaxResults: readEnvPositiveInt('IO_INDEX_SEARCH_MAX_RESULTS', 50, env),
                hardMaxResults: readEnvPositiveInt('IO_INDEX_SEARCH_HARD_MAX_RESULTS', 500, env),
            }),
        }),
    });
}
/**
 * @typedef {{
 *   configured:boolean;
 *   revision:number;
 * }} DatabaseBindingStatus
 * @typedef {import('#copilot/infra/internal/database/port').InfraSqliteProviderReader} DatabaseBinding
 */

/** @returns {{
 * queued:number; coalesced:number; recursiveSkipped:number; missingWorkspaceRoot:number; domainSkipped:number;
 * gitignoredSkipped:number; domainReconciliations:number; domainPruned:number; batches:number; requested:number;
 * indexed:number; invalidated:number; unchanged:number; skipped:number; failed:number; lastDurationMs:number|null;
 * lastLagMs:number|null; maxLagMs:number; highWater:number; explicitConvergences:number; attempted:number;
 * succeeded:number; transientFailed:number; retried:number; exhausted:number; lastRetryDelayMs:number|null; maxPendingAgeMs:number;
 * }} */
function createAutoRefreshCounters() {
    return {
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
        attempted: 0,
        succeeded: 0,
        transientFailed: 0,
        retried: 0,
        exhausted: 0,
        lastRetryDelayMs: null,
        maxPendingAgeMs: 0,
    };
}

/** @param {string} filePath */
function deterministicRetryJitter(filePath) {
    let hash = 2166136261;
    for (let index = 0; index < filePath.length; index += 1) {
        hash ^= filePath.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return ((hash % 401) - 200) / 1000;
}

/** @param {string} filePath @param {number} attempt @param {{retryBaseMs:number;retryMaxMs:number}} config */
function retryDelayMs(filePath, attempt, config) {
    if (config.retryBaseMs <= 0) return 0;
    const exponential = Math.min(config.retryMaxMs, config.retryBaseMs * 2 ** Math.max(0, attempt - 1));
    return Math.max(0, Math.round(exponential * (1 + deterministicRetryJitter(filePath))));
}

/** @param {{debounceMs:number;retryBaseMs:number;retryMaxMs:number;retryMaxAttempts:number}} config */
function autoRefreshStaleAfterMs(config) {
    let retryBudgetMs = 0;
    // retryMaxAttempts counts the initial attempt, so only N-1 delays can occur while an item remains pending.
    for (let attempt = 1; attempt < config.retryMaxAttempts; attempt += 1) {
        const nominal =
            config.retryBaseMs <= 0 ? 0 : Math.min(config.retryMaxMs, config.retryBaseMs * 2 ** (attempt - 1));
        retryBudgetMs += Math.ceil(nominal * 1.2); // deterministic jitter is bounded to +20%.
    }
    return Math.max(10_000, Math.ceil((config.debounceMs + retryBudgetMs) * 1.5));
}

/** @param {DatabaseBinding} database @param {ReturnType<typeof createLifecycleSnapshot>} lifecycle @param {number} queries @param {{enabled:boolean;autoRefresh:ReturnType<typeof readIoIndexRuntimeConfig>['autoRefresh']}} runtimeConfig */
function readDatabaseStatus(database, lifecycle, queries, runtimeConfig) {
    const enabled = runtimeConfig.enabled;
    const config = runtimeConfig.autoRefresh;
    /** @param {string} reason */
    const unavailable = (reason) => ({
        enabled,
        available: false,
        schemaPrepared: false,
        schemaVersion: 0,
        files: 0,
        freshFiles: 0,
        staleFiles: 0,
        failedFiles: 0,
        bytesIndexed: 0,
        symbols: 0,
        imports: 0,
        chunks: 0,
        latestIndexedAtMs: null,
        freshness: 'unavailable',
        reason,
        searches: queries,
        lifecycle,
        autoRefreshConfig: config,
    });
    if (!enabled) return unavailable('disabled-via-env');
    if (!database.status().configured) return unavailable('db-provider-unconfigured');
    try {
        const db = database.get();
        const migration = /** @type {{version?:unknown}|undefined} */ (
            db.prepare('SELECT MAX(version) AS version FROM copilot_io_index_schema_migrations').get()
        );
        const schemaVersion = Number(migration?.version ?? 0);
        if (!Number.isSafeInteger(schemaVersion) || schemaVersion <= 0) return unavailable('schema-unprepared');
        const files = /** @type {{total?:unknown;fresh?:unknown;stale?:unknown;failed?:unknown;bytes?:unknown}} */ (
            db
                .prepare(
                    `
                SELECT COUNT(*) as total,
                    SUM(CASE WHEN status = 'fresh' THEN 1 ELSE 0 END) as fresh,
                    SUM(CASE WHEN status = 'stale' THEN 1 ELSE 0 END) as stale,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                    COALESCE(SUM(size_bytes), 0) as bytes
                FROM copilot_io_index_files
            `,
                )
                .get() ?? {}
        );
        const symbols = /** @type {{total?:unknown}} */ (
            db.prepare('SELECT COUNT(*) as total FROM copilot_io_index_symbols').get() ?? {}
        );
        const imports = /** @type {{total?:unknown}} */ (
            db.prepare('SELECT COUNT(*) as total FROM copilot_io_index_imports').get() ?? {}
        );
        const chunks = /** @type {{total?:unknown}} */ (
            db.prepare('SELECT COUNT(*) as total FROM copilot_io_index_chunks').get() ?? {}
        );
        const latest = /** @type {{latest?:unknown}} */ (
            db.prepare('SELECT MAX(refreshed_at_ms) as latest FROM copilot_io_index_files').get() ?? {}
        );
        const totalFiles = Number(files.total ?? 0);
        const latestIndexedAtMs = Number(latest.latest ?? 0) || null;
        return {
            enabled: true,
            available: totalFiles > 0,
            schemaPrepared: true,
            schemaVersion,
            files: totalFiles,
            freshFiles: Number(files.fresh ?? 0),
            staleFiles: Number(files.stale ?? 0),
            failedFiles: Number(files.failed ?? 0),
            bytesIndexed: Number(files.bytes ?? 0),
            symbols: Number(symbols.total ?? 0),
            imports: Number(imports.total ?? 0),
            chunks: Number(chunks.total ?? 0),
            latestIndexedAtMs,
            freshness: latestIndexedAtMs ? 'fresh-or-aging' : 'empty',
            reason: totalFiles > 0 ? null : 'empty',
            searches: queries,
            lifecycle,
            autoRefreshConfig: config,
        };
    } catch (error) {
        const code =
            error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null;
        return unavailable(code === 'SQLITE_ERROR' ? 'schema-unprepared' : 'status-read-failed');
    }
}

/** @param {{materialized:boolean;materializations:number;materializationFailures:number;lastFailureCode:string|null}} state */
function createLifecycleSnapshot(state) {
    return Object.freeze({ ...state });
}

/**
 * @param {{ database:DatabaseBinding; runtimeId?:string; invalidationBus?:{registerHook:(hook:(filePath:string,event:{recursive:boolean;source:string})=>void)=>()=>void}; telemetryRuntime?:ReturnType<typeof import('#copilot/infra/internal/telemetry').createIoTelemetryRuntime>; parserWorkerRuntime?:ReturnType<typeof import('../../parser/worker/index.js').createParserWorkerRuntime>; config?:ReturnType<typeof readIoIndexRuntimeConfig> }} options
 */
export function createIoIndexRegistryRuntime(options) {
    if (
        !options?.database ||
        typeof options.database.get !== 'function' ||
        typeof options.database.status !== 'function'
    ) {
        throw new TypeError('createIoIndexRegistryRuntime requires a database binding.');
    }
    const runtimeId = options.runtimeId?.trim() || 'io-index-runtime';
    const database = options.database;
    const runtimeConfig = options.config ?? readIoIndexRuntimeConfig({});
    const autoRefreshConfig = runtimeConfig.autoRefresh;
    /** @type {IoIndexStore | null} */
    let index = null;
    let indexRevision = -1;
    let queryCount = 0;
    let disposed = false;
    /** @type {(() => void) | null} */
    let invalidationUnregister = null;
    /** @type {Map<string, Promise<Awaited<ReturnType<IoIndexStore['indexDirectory']>>>>} */
    const inflightBuilds = new Map();
    const lifecycle = {
        materialized: false,
        materializations: 0,
        materializationFailures: 0,
        lastFailureCode: /** @type {string|null} */ (null),
    };
    const auto = {
        workspaceRoot: /** @type {string|null} */ (null),
        domain: /** @type {ReturnType<typeof createIndexAutoRefreshDomain>|null} */ (null),
        pendingPaths:
            /** @type {Map<string,{queuedAt:number;attempt:number;nextEligibleAt:number;lastFailureAt:number|null}>} */ (
                new Map()
            ),
        timer: /** @type {NodeJS.Timeout|null} */ (null),
        running: false,
        stats: createAutoRefreshCounters(),
    };

    function assertActive() {
        if (disposed) throw new Error(`IoIndexRegistryRuntime(${runtimeId}) is disposed.`);
    }

    function resetMaterializationForDatabaseRevision() {
        const revision = database.status().revision;
        if (indexRevision === -1 || indexRevision === revision) return;
        index = null;
        indexRevision = -1;
        inflightBuilds.clear();
        auto.pendingPaths.clear();
        if (auto.timer) clearTimeout(auto.timer);
        auto.timer = null;
        auto.running = false;
    }

    function ensureIndex() {
        assertActive();
        resetMaterializationForDatabaseRevision();
        if (!runtimeConfig.enabled) return null;
        if (index) return index;
        if (!database.status().configured) return null;
        try {
            index = createIoIndexSqlite({
                db: database.get(),
                ...runtimeConfig.sqlite,
                buildConfig: runtimeConfig.build,
                scannerConfig: runtimeConfig.scanner,
                ...(options.parserWorkerRuntime ? { parserWorkerRuntime: options.parserWorkerRuntime } : {}),
            });
            indexRevision = database.status().revision;
            lifecycle.materialized = true;
            lifecycle.materializations += 1;
            lifecycle.lastFailureCode = null;
            ensureInvalidationHook();
            return index;
        } catch (error) {
            lifecycle.materializationFailures += 1;
            lifecycle.lastFailureCode =
                error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
                    ? error.code
                    : 'unknown';
            return null;
        }
    }

    /** @param {string} scopeRoot @param {Parameters<typeof createIndexAutoRefreshDomain>[1]} [domainOptions] */
    function configureDomain(scopeRoot, domainOptions = {}) {
        const domain = createIndexAutoRefreshDomain(scopeRoot, domainOptions);
        auto.workspaceRoot = domain.workspaceRoot;
        auto.domain = domain;
        return domain;
    }

    /** @param {{queuedAt:number}} entry @param {number} [now] */
    function observePendingAge(entry, now = Date.now()) {
        const ageMs = Math.max(0, now - entry.queuedAt);
        auto.stats.maxPendingAgeMs = Math.max(auto.stats.maxPendingAgeMs, ageMs);
        return ageMs;
    }

    function autoRefreshSnapshot() {
        const config = autoRefreshConfig;
        const now = Date.now();
        const staleAfterMs = autoRefreshStaleAfterMs(config);
        const pendingAges = [...auto.pendingPaths.values()].map((entry) => Math.max(0, now - entry.queuedAt));
        const oldestPendingAgeMs = pendingAges.length > 0 ? Math.max(...pendingAges) : 0;
        const stalePending = pendingAges.filter((ageMs) => ageMs > staleAfterMs).length;
        return Object.freeze({
            ...auto.stats,
            maxPendingAgeMs: Math.max(auto.stats.maxPendingAgeMs, oldestPendingAgeMs),
            enabled: config.enabled,
            pending: auto.pendingPaths.size,
            stalePending,
            staleAfterMs,
            oldestPendingAgeMs,
            running: auto.running,
            timerPending: auto.timer !== null,
            materialized: index !== null,
            workspaceRootKnown: Boolean(auto.workspaceRoot),
            debounceMs: config.debounceMs,
            maxBatch: config.maxBatch,
            retryBaseMs: config.retryBaseMs,
            retryMaxMs: config.retryMaxMs,
            retryMaxAttempts: config.retryMaxAttempts,
        });
    }

    /** @param {string} filePath @param {boolean} [explicitConvergence] */
    function settlePending(filePath, explicitConvergence = true) {
        const normalized = resolve(filePath);
        const entry = auto.pendingPaths.get(normalized);
        if (!entry) return false;
        observePendingAge(entry);
        auto.pendingPaths.delete(normalized);
        if (explicitConvergence) auto.stats.explicitConvergences += 1;
        if (auto.pendingPaths.size === 0 && auto.timer && !auto.running) {
            clearTimeout(auto.timer);
            auto.timer = null;
        }
        return true;
    }

    /** @param {number} fallbackDelayMs */
    function armAutoRefreshTimer(fallbackDelayMs) {
        if (disposed || auto.timer || auto.running || inflightBuilds.size > 0 || auto.pendingPaths.size === 0) return;
        const now = Date.now();
        const nextEligibleAt = Math.min(...[...auto.pendingPaths.values()].map((entry) => entry.nextEligibleAt));
        const delayMs = Number.isFinite(nextEligibleAt)
            ? Math.max(0, nextEligibleAt - now)
            : Math.max(0, fallbackDelayMs);
        auto.timer = setTimeout(() => {
            auto.timer = null;
            void flushAutoRefresh({ respectBackoff: true });
        }, delayMs);
        auto.timer.unref?.();
    }

    /** @param {string} filePath @param {{recursive?:boolean}} [event] */
    function scheduleAutoRefresh(filePath, event = {}) {
        const config = autoRefreshConfig;
        if (!config.enabled || disposed) return;
        if (event.recursive === true) {
            auto.stats.recursiveSkipped += 1;
            return;
        }
        if (!auto.workspaceRoot || !auto.domain) {
            auto.stats.missingWorkspaceRoot += 1;
            return;
        }
        const normalized = resolve(filePath);
        if (!isIndexRefreshDomainCandidate(normalized, auto.domain)) {
            auto.stats.domainSkipped += 1;
            return;
        }
        if (auto.pendingPaths.has(normalized)) auto.stats.coalesced += 1;
        else {
            const queuedAt = Date.now();
            auto.pendingPaths.set(normalized, {
                queuedAt,
                attempt: 0,
                nextEligibleAt: queuedAt + config.debounceMs,
                lastFailureAt: null,
            });
            auto.stats.queued += 1;
            auto.stats.highWater = Math.max(auto.stats.highWater, auto.pendingPaths.size);
        }
        armAutoRefreshTimer(config.debounceMs);
    }

    function ensureInvalidationHook() {
        if (invalidationUnregister || disposed) return;
        if (!options.invalidationBus) return;
        invalidationUnregister =
            options.invalidationBus.registerHook((filePath, event) => {
                try {
                    index?.invalidatePath(filePath);
                    scheduleAutoRefresh(filePath, event);
                } catch {
                    // Writer-critical invalidation remains best-effort.
                }
            }) ?? null;
    }

    /** @param {readonly string[]} paths @param {{retryBaseMs:number;retryMaxMs:number;retryMaxAttempts:number}} config */
    function recordPendingFailures(paths, config) {
        const now = Date.now();
        let retried = 0;
        let exhausted = 0;
        for (const filePath of new Set(paths)) {
            const entry = auto.pendingPaths.get(filePath);
            if (!entry) continue;
            observePendingAge(entry, now);
            entry.attempt += 1;
            entry.lastFailureAt = now;
            auto.stats.transientFailed += 1;
            if (entry.attempt >= config.retryMaxAttempts) {
                auto.pendingPaths.delete(filePath);
                auto.stats.exhausted += 1;
                exhausted += 1;
                continue;
            }
            const delayMs = retryDelayMs(filePath, entry.attempt, config);
            entry.nextEligibleAt = now + delayMs;
            auto.stats.retried += 1;
            auto.stats.lastRetryDelayMs = delayMs;
            retried += 1;
        }
        return { retried, exhausted };
    }

    /** @param {{respectBackoff?:boolean}} [flushOptions] */
    async function flushAutoRefresh(flushOptions = {}) {
        assertActive();
        if (auto.timer) {
            clearTimeout(auto.timer);
            auto.timer = null;
        }
        if (auto.running || auto.pendingPaths.size === 0 || !auto.workspaceRoot) return null;
        const config = autoRefreshConfig;
        if (inflightBuilds.size > 0) {
            armAutoRefreshTimer(config.debounceMs);
            return null;
        }
        const now = Date.now();
        const batchEntries = [...auto.pendingPaths.entries()]
            .filter(([, entry]) => flushOptions.respectBackoff !== true || entry.nextEligibleAt <= now)
            .slice(0, config.maxBatch);
        if (batchEntries.length === 0) {
            armAutoRefreshTimer(config.debounceMs);
            return null;
        }
        const oldestQueuedAt = Math.min(...batchEntries.map(([, entry]) => entry.queuedAt));
        const lagMs = Math.max(0, now - oldestQueuedAt);
        const batchPaths = batchEntries.map(([filePath]) => filePath);
        let refreshPaths = [...batchPaths];
        auto.running = true;
        auto.stats.attempted += batchPaths.length;
        try {
            if (auto.domain?.respectGitignore) {
                const matcher = await loadGitignoreMatcher(auto.domain.workspaceRoot);
                refreshPaths = refreshPaths.filter((filePath) => {
                    const relativePath = relative(
                        auto.domain?.workspaceRoot ?? auto.workspaceRoot ?? '',
                        filePath,
                    ).replace(/\\/gu, '/');
                    const ignored = Boolean(relativePath && matcher.ignores(relativePath));
                    if (ignored) {
                        auto.stats.gitignoredSkipped += 1;
                        settlePending(filePath, false);
                    }
                    return !ignored;
                });
            }
            const result = refreshPaths.length
                ? await refreshPathsInternal(
                      refreshPaths,
                      {
                          workspaceRoot: auto.workspaceRoot,
                          ...(auto.domain ? { extensions: [...auto.domain.extensions] } : {}),
                      },
                      false,
                  )
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
            const failedPaths = batchPaths.filter((filePath) => auto.pendingPaths.has(filePath));
            const retry = recordPendingFailures(failedPaths, config);
            const succeeded = batchPaths.length - failedPaths.length;
            auto.stats.batches += 1;
            auto.stats.requested += refreshPaths.length;
            auto.stats.succeeded += succeeded;
            auto.stats.indexed += Number(result.indexed ?? 0);
            auto.stats.invalidated += Number(result.invalidated ?? 0);
            auto.stats.unchanged += Number(result.unchanged ?? 0);
            auto.stats.skipped += Number(result.skipped ?? 0);
            auto.stats.failed += Number(result.failed ?? 0);
            auto.stats.lastDurationMs = Number(result.durationMs ?? 0);
            auto.stats.lastLagMs = lagMs;
            auto.stats.maxLagMs = Math.max(auto.stats.maxLagMs, lagMs);
            return { ...result, retryPending: retry.retried, exhausted: retry.exhausted };
        } catch {
            const failedPaths = batchPaths.filter((filePath) => auto.pendingPaths.has(filePath));
            const retry = recordPendingFailures(failedPaths, config);
            auto.stats.failed += failedPaths.length;
            return {
                available: false,
                requested: batchPaths.length,
                indexed: 0,
                invalidated: 0,
                unchanged: 0,
                skipped: 0,
                failed: failedPaths.length,
                durationMs: 0,
                retryPending: retry.retried,
                exhausted: retry.exhausted,
            };
        } finally {
            auto.running = false;
            if (auto.pendingPaths.size > 0) armAutoRefreshTimer(config.debounceMs);
        }
    }

    /** @param {readonly string[]} filePaths @param {Parameters<typeof executeIoIndexPathRefresh>[2]} refreshOptions @param {boolean} explicitConvergence */
    async function refreshPathsInternal(filePaths, refreshOptions, explicitConvergence) {
        const store = ensureIndex();
        if (refreshOptions.scopeRoot) configureDomain(refreshOptions.scopeRoot, refreshOptions);
        else auto.workspaceRoot = resolve(refreshOptions.workspaceRoot);
        return executeIoIndexPathRefresh(
            store,
            filePaths,
            {
                ...refreshOptions,
                concurrency: refreshOptions.concurrency ?? runtimeConfig.refresh.concurrency,
            },
            {
                domain: refreshOptions.scopeRoot ? auto.domain : null,
                settlePending: (filePath) => settlePending(filePath, explicitConvergence),
            },
        );
    }

    const api = Object.freeze({
        runtimeId,
        database,
        getIndex() {
            return ensureIndex();
        },
        status() {
            resetMaterializationForDatabaseRevision();
            const status = readDatabaseStatus(database, createLifecycleSnapshot(lifecycle), queryCount, runtimeConfig);
            return Object.freeze({ ...status, config: runtimeConfig, autoRefresh: autoRefreshSnapshot() });
        },
        stats() {
            const store = ensureIndex();
            if (!store) return api.status();
            return Object.freeze({
                ...store.getStats(),
                searches: queryCount,
                config: runtimeConfig,
                autoRefresh: autoRefreshSnapshot(),
            });
        },
        /** @param {string} query @param {Parameters<IoIndexStore['search']>[1]} [queryOptions] */
        search(query, queryOptions = {}) {
            const store = ensureIndex();
            if (!store) return [];
            queryCount += 1;
            return store.search(query, queryOptions);
        },
        /** @param {string} query @param {Parameters<IoIndexStore['searchLiteral']>[1]} [queryOptions] */
        searchLiteral(query, queryOptions = {}) {
            const store = ensureIndex();
            if (!store) return [];
            queryCount += 1;
            return store.searchLiteral(query, queryOptions);
        },
        /** @param {string} name @param {Parameters<IoIndexStore['findSymbol']>[1]} [queryOptions] */
        findSymbol(name, queryOptions = {}) {
            const store = ensureIndex();
            if (!store) return [];
            queryCount += 1;
            return store.findSymbol(name, queryOptions);
        },
        /** @param {string} source @param {Parameters<IoIndexStore['findImports']>[1]} [queryOptions] */
        findImports(source, queryOptions = {}) {
            const store = ensureIndex();
            if (!store) return [];
            queryCount += 1;
            return store.findImports(source, queryOptions);
        },
        /** @param {string} pathPrefix */
        findImportsByPath(pathPrefix) {
            const store = ensureIndex();
            if (!store) return [];
            queryCount += 1;
            return store.findImportsByPath(pathPrefix);
        },
        listFiles() {
            const store = ensureIndex();
            if (!store) return [];
            queryCount += 1;
            return store.listIndexedFiles();
        },
        /** @param {string} directory @param {Parameters<IoIndexStore['indexDirectory']>[1] & {adoptAutoRefreshDomain?:boolean}} [buildOptions] */
        async buildDirectory(directory, buildOptions = {}) {
            assertActive();
            if (buildOptions.adoptAutoRefreshDomain === true) configureDomain(directory, buildOptions);
            const store = ensureIndex();
            if (!store)
                return {
                    available: false,
                    indexed: 0,
                    skipped: 0,
                    failed: 0,
                    durationMs: 0,
                    reason: 'index-unavailable',
                };
            const normalizedDirectory = resolve(directory);
            const key = JSON.stringify([
                normalizedDirectory,
                buildOptions.workspaceRoot ? resolve(buildOptions.workspaceRoot) : null,
                buildOptions.recursive ?? null,
                buildOptions.depth ?? null,
                buildOptions.respectGitignore ?? null,
                buildOptions.concurrency ?? null,
                buildOptions.maxFiles ?? null,
                buildOptions.pruneMissing ?? null,
                buildOptions.extensions
                    ? [...buildOptions.extensions].map((ext) => String(ext).toLowerCase()).sort()
                    : null,
                buildOptions.include ? [...buildOptions.include].map(String).sort() : null,
                buildOptions.exclude ? [...buildOptions.exclude].map(String).sort() : null,
            ]);
            const mayCoalesce = buildOptions.signal === undefined;
            const existing = mayCoalesce ? inflightBuilds.get(key) : null;
            if (existing) return await existing;
            const budget = options.telemetryRuntime
                ? options.telemetryRuntime.advisoryBudget.begin({
                      operation: 'index.build',
                  })
                : Object.freeze({ id: 0, pressured: false, finish() {} });
            const buildPromise = (async () => {
                try {
                    return await store.indexDirectory(directory, buildOptions);
                } finally {
                    budget.finish();
                    if (mayCoalesce) inflightBuilds.delete(key);
                    if (auto.pendingPaths.size > 0) armAutoRefreshTimer(autoRefreshConfig.debounceMs);
                }
            })();
            if (mayCoalesce) inflightBuilds.set(key, buildPromise);
            return await buildPromise;
        },
        /** @param {string} scopeRoot @param {Parameters<IoIndexStore['verifyHashSample']>[1]} [verifyOptions] */
        async verifyHashSample(scopeRoot, verifyOptions = {}) {
            assertActive();
            const store = ensureIndex();
            if (!store) {
                return {
                    available: false,
                    scopeRoot: resolve(scopeRoot),
                    cursor: verifyOptions.cursor ?? '',
                    nextCursor: verifyOptions.cursor ?? '',
                    maxFiles: verifyOptions.maxFiles ?? 0,
                    candidateCount: 0,
                    wrapped: false,
                    hashVerifications: 0,
                    hashVerificationHits: 0,
                    hashVerificationMisses: 0,
                    metadataMismatches: 0,
                    errors: 0,
                    mismatchCount: 0,
                    mismatches: [],
                    durationMs: 0,
                    reason: 'index-unavailable',
                };
            }
            return await store.verifyHashSample(scopeRoot, verifyOptions);
        },
        /** @param {readonly string[]} filePaths @param {Parameters<typeof executeIoIndexPathRefresh>[2]} refreshOptions */
        refreshPaths(filePaths, refreshOptions) {
            return refreshPathsInternal(filePaths, refreshOptions, true);
        },
        /** @param {string} filePath */
        invalidatePath(filePath) {
            return ensureIndex()?.invalidatePath(filePath) ?? false;
        },
        clear() {
            const store = ensureIndex();
            if (!store) return false;
            store.clearAll();
            return true;
        },
        /** @param {string} scopeRoot @param {Parameters<typeof createIndexAutoRefreshDomain>[1]} [domainOptions] */
        adoptAutoRefreshDomain(scopeRoot, domainOptions = {}) {
            configureDomain(scopeRoot, domainOptions);
        },
        flushAutoRefresh,
        /** @param {{ signal?: AbortSignal }} [reconcileOptions] */
        async reconcileAutoRefreshDomain(reconcileOptions = {}) {
            assertActive();
            reconcileOptions.signal?.throwIfAborted();
            const store = ensureIndex();
            const domain = auto.domain;
            if (!store || !domain)
                return {
                    available: Boolean(store),
                    domainKnown: Boolean(domain),
                    inspected: 0,
                    explicitRefreshRows: 0,
                    pruned: 0,
                };
            const matcher = domain.respectGitignore ? await loadGitignoreMatcher(domain.workspaceRoot) : null;
            reconcileOptions.signal?.throwIfAborted();
            const rows = store.listIndexedFiles();
            let explicitRefreshRows = 0;
            let pruned = 0;
            for (const row of rows) {
                reconcileOptions.signal?.throwIfAborted();
                let metadata;
                try {
                    metadata = /** @type {Record<string,unknown>|null} */ (
                        row.metadataJson ? JSON.parse(row.metadataJson) : null
                    );
                } catch {
                    continue;
                }
                if (!metadata || metadata['refreshMode'] !== 'explicit-path') continue;
                explicitRefreshRows += 1;
                const candidate = isIndexRefreshDomainCandidate(row.filePath, domain);
                const relativePath = relative(domain.workspaceRoot, row.filePath).replace(/\\/gu, '/');
                const ignored = Boolean(candidate && matcher && relativePath && matcher.ignores(relativePath));
                if (candidate && !ignored) continue;
                if (store.invalidatePath(row.filePath)) pruned += 1;
            }
            auto.stats.domainReconciliations += 1;
            auto.stats.domainPruned += pruned;
            return { available: true, domainKnown: true, inspected: rows.length, explicitRefreshRows, pruned };
        },
        /** @param {readonly string[]} filePaths @param {Parameters<typeof filterIoIndexRefreshDomainPaths>[1]} filterOptions */
        filterRefreshDomainPaths(filePaths, filterOptions) {
            return filterIoIndexRefreshDomainPaths(filePaths, filterOptions);
        },
        autoRefreshStats() {
            return autoRefreshSnapshot();
        },
        snapshot() {
            return Object.freeze({
                runtimeId,
                disposed,
                database: database.status(),
                lifecycle: createLifecycleSnapshot(lifecycle),
                queries: queryCount,
                inflightBuilds: inflightBuilds.size,
                autoRefresh: autoRefreshSnapshot(),
            });
        },
        async dispose() {
            if (disposed) return;
            disposed = true;
            if (auto.timer) clearTimeout(auto.timer);
            auto.timer = null;
            auto.pendingPaths.clear();
            invalidationUnregister?.();
            invalidationUnregister = null;
            await Promise.allSettled([...inflightBuilds.values()]);
            inflightBuilds.clear();
            index = null;
        },
    });
    return api;
}
