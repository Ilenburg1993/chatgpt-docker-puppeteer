// @ts-check
/**
 * MCP HTTP boot-time IO index auto-build.
 *
 * @module copilot/mcp/indexing/auto-build/runtime
 */

import { readCrossProcessInvalidationReplay } from '#copilot/infra/public/filesystem/invalidation/replay';
import { isAbsolute, relative, resolve } from 'node:path';
import {
    classifyIndexJournalReplayRows,
    planIndexStartup,
    readCommittedIndexChanges,
    readIndexGitSnapshot,
    readIndexStartupCheckpoint,
    writeIndexStartupCheckpoint,
} from './checkpoint.js';

/** @typedef {import('./config.js').McpIndexAutoBuildConfig} McpIndexAutoBuildConfig */

/**
 * @typedef {object} McpIndexAutoBuildState
 * @property {'unconfigured' | 'never-started' | 'disabled' | 'running' | 'completed' | 'failed' | 'skipped'} status
 * @property {string | null} startedAt
 * @property {string | null} completedAt
 * @property {string | null} reason
 * @property {Record<string, unknown> | null} result
 * @property {Record<string, unknown> | null} error
 * @property {McpIndexAutoBuildConfig | null} config
 * @property {Record<string, unknown>} stats
 */

const MAX_RETAINED_AUTO_BUILD_GENERATIONS = 8;
/** @type {Map<string, McpIndexAutoBuildState>} */
const autoBuildStates = new Map();
/** @type {Map<string, Promise<McpIndexAutoBuildState>>} */
const autoBuildPromises = new Map();

/**
 * Retain only a small process-local history of completed configuration generations. Running generations are never
 * evicted; if all retained slots are active, a new generation can still execute but its transient state is not retained
 * in this diagnostic history map.
 *
 * @param {string} generationKey
 * @param {McpIndexAutoBuildState} state
 */
function retainAutoBuildState(generationKey, state) {
    if (autoBuildStates.has(generationKey)) autoBuildStates.delete(generationKey);
    while (autoBuildStates.size >= MAX_RETAINED_AUTO_BUILD_GENERATIONS) {
        const evictable = [...autoBuildStates.entries()].find(
            ([key, candidate]) =>
                key !== generationKey && candidate.status !== 'running' && !autoBuildPromises.has(key),
        );
        if (!evictable) return false;
        autoBuildStates.delete(evictable[0]);
    }
    autoBuildStates.set(generationKey, state);
    return true;
}

/**
 * @param {{
 *     status: McpIndexAutoBuildState['status'];
 *     reason?: string | null;
 *     result?: Record<string, unknown> | null;
 *     error?: Record<string, unknown> | null;
 *     config?: McpIndexAutoBuildConfig;
 *     stats?: Record<string, unknown>;
 * }} input
 * @param {McpIndexAutoBuildConfig} config
 * @returns {McpIndexAutoBuildState}
 */
function makeState(input, config) {
    const previous = autoBuildStates.get(config.generationKey);
    const previousStartedAt = previous?.startedAt ?? null;
    return {
        status: input.status,
        startedAt: input.status === 'running' ? new Date().toISOString() : previousStartedAt,
        completedAt:
            input.status === 'completed' || input.status === 'failed' || input.status === 'skipped'
                ? new Date().toISOString()
                : null,
        reason: input.reason ?? null,
        result: input.result ?? null,
        error: input.error ?? null,
        config,
        stats: input.stats ?? previous?.stats ?? { available: false, reason: 'workspace-capability-not-observed' },
    };
}

/**
 * Read state for one exact process-config generation. An omitted config is reported honestly as unconfigured rather
 * than synthesizing ambient defaults from process.env.
 *
 * @param {McpIndexAutoBuildConfig | undefined} config
 * @returns {McpIndexAutoBuildState}
 */
export function readMcpIndexAutoBuildState(config) {
    if (!config) {
        return {
            status: 'unconfigured',
            startedAt: null,
            completedAt: null,
            reason: 'process-config-generation-unavailable',
            result: null,
            error: null,
            config: null,
            stats: { available: false, reason: 'workspace-capability-not-observed' },
        };
    }
    const state = autoBuildStates.get(config.generationKey);
    if (state) return cloneState(state);
    return makeState(
        {
            status: config.enabled ? 'never-started' : 'disabled',
            reason: config.enabled ? 'auto-build-enabled-but-not-started' : 'auto-build-disabled',
            config,
        },
        config,
    );
}

/** @param {McpIndexAutoBuildState} state @returns {McpIndexAutoBuildState} */
function cloneState(state) {
    return {
        ...state,
        config: state.config ? { ...state.config } : null,
        stats: { ...state.stats },
        result: state.result ? { ...state.result } : null,
        error: state.error ? { ...state.error } : null,
    };
}

/**
 * @param {{
 *     workspace: import('#copilot/mcp/public/workspace').McpWorkspaceCapability;
 *     config: McpIndexAutoBuildConfig;
 *     gitConfig?: import('#copilot/mcp/public/workspace/git').McpGitProcessConfig;
 *     signal?: AbortSignal;
 *     reason?: string;
 *     db?: import('#copilot/infra/public/database/sqlite').SqliteDatabasePort;
 * }} options
 * @returns {Promise<McpIndexAutoBuildState>}
 */
export async function maybeStartMcpIndexAutoBuild(options) {
    if (!options?.workspace) throw new TypeError('MCP index auto-build requires a workspace capability.');
    const workspace = options.workspace;
    const config = options.config;
    if (!config) throw new TypeError('MCP index auto-build requires an explicit config generation.');
    const generationKey = config.generationKey;
    const readStats = () => /** @type {Record<string, unknown>} */ (workspace.indexRegistry.status());
    if (!config.enabled) {
        const disabled = makeState(
            { status: 'disabled', reason: 'auto-build-disabled', config, stats: readStats() },
            config,
        );
        retainAutoBuildState(generationKey, disabled);
        return cloneState(disabled);
    }
    if (!options.gitConfig) {
        const failed = makeState(
            {
                status: 'failed',
                reason: 'git-process-config-unavailable',
                error: { message: 'MCP index auto-build requires an explicit Git process config generation.' },
                config,
                stats: readStats(),
            },
            config,
        );
        retainAutoBuildState(generationKey, failed);
        return cloneState(failed);
    }
    if (options.signal?.aborted) {
        return cloneState(
            makeState(
                {
                    status: 'failed',
                    reason: 'aborted',
                    error: { message: abortMessage(options.signal) },
                    config,
                    stats: readStats(),
                },
                config,
            ),
        );
    }
    const activePromise = autoBuildPromises.get(generationKey);
    if (activePromise) return await activePromise;
    const existing = autoBuildStates.get(generationKey);
    if (existing?.status === 'completed' || existing?.status === 'running') return cloneState(existing);

    if (!options.db) {
        const failed = makeState(
            {
                status: 'failed',
                reason: 'database-capability-unavailable',
                error: { message: 'MCP index auto-build requires an injected database capability.' },
                config,
                stats: readStats(),
            },
            config,
        );
        retainAutoBuildState(generationKey, failed);
        return cloneState(failed);
    }

    const running = makeState(
        {
            status: 'running',
            reason: options.reason ?? 'mcp-http-start',
            config,
            stats: readStats(),
        },
        config,
    );
    retainAutoBuildState(generationKey, running);
    const buildPromise = runIndexAutoBuild(config, options.db, workspace, options.gitConfig, options.signal)
        .then((state) => {
            retainAutoBuildState(generationKey, state);
            return cloneState(state);
        })
        .finally(() => {
            if (autoBuildPromises.get(generationKey) === buildPromise) autoBuildPromises.delete(generationKey);
        });
    autoBuildPromises.set(generationKey, buildPromise);
    return await buildPromise;
}

/**
 * @param {McpIndexAutoBuildConfig} config
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {import('#copilot/mcp/public/workspace/git').McpGitProcessConfig} gitConfig
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<McpIndexAutoBuildState>}
 */
async function runIndexAutoBuild(config, db, workspace, gitConfig, signal) {
    const { indexRegistry, workspaceRoot } = workspace;
    const filterIoIndexRefreshDomainPaths = indexRegistry.filterRefreshDomainPaths;
    const reconcileIoIndexAutoRefreshDomain = indexRegistry.reconcileAutoRefreshDomain;
    const refreshIoIndexPaths = indexRegistry.refreshPaths;
    const readIoIndexStatus = indexRegistry.status;
    /** @param {Parameters<typeof makeState>[0]} input */
    const makeRuntimeState = (input) =>
        makeState({ ...input, stats: /** @type {Record<string, unknown>} */ (readIoIndexStatus()) }, config);
    try {
        throwIfAborted(signal);
        const resolved = await workspace.resolveReadPath(config.path);
        if (!resolved.ok) {
            return makeRuntimeState({
                status: 'failed',
                reason: 'path-resolution-failed',
                error: { code: resolved.code, message: resolved.reason, hint: resolved.hint },
                config,
            });
        }
        const startupStartedAt = Date.now();
        const indexStats = /** @type {Record<string, unknown>} */ (readIoIndexStatus());
        const schemaVersion = Number(indexStats['schemaVersion'] ?? 0);
        const indexFiles = Number(indexStats['files'] ?? 0);
        const checkpoint = readIndexStartupCheckpoint(config.path, db);
        const journalReplay = readCrossProcessInvalidationReplay({
            afterSequence: checkpoint?.journalSequence ?? 0,
            maxRows: config.journalReplayMaxRows,
            db,
        });
        const journalScope = classifyIndexJournalReplayRows(journalReplay.rows, resolved.resolved);
        const journalDomain = await filterIoIndexRefreshDomainPaths(journalScope.paths, {
            scopeRoot: resolved.resolved,
            workspaceRoot,
            respectGitignore: config.respectGitignore,
        });
        const journalEvidence = {
            available: journalReplay.available,
            gapDetected: journalReplay.gapDetected,
            truncated: journalReplay.truncated,
            replayablePathCount: journalDomain.paths.length,
            recursiveScopeInvalidation: journalScope.recursiveScopeInvalidation,
            invalidPathRows: journalScope.invalidPathRows,
        };
        const journalSummary = {
            available: journalReplay.available,
            afterSequence: journalReplay.afterSequence,
            highWatermark: journalReplay.highWatermark,
            rowCount: journalReplay.rowCount,
            containedPathCount: journalScope.replayablePathCount,
            replayablePathCount: journalDomain.paths.length,
            outsideScopeRows: journalScope.outsideScopeRows,
            hiddenScopeRows: journalScope.hiddenScopeRows,
            domainSkippedRows: journalDomain.domainSkipped,
            gitignoredSkippedRows: journalDomain.gitignoredSkipped,
            invalidPathRows: journalScope.invalidPathRows,
            recursiveScopeInvalidation: journalScope.recursiveScopeInvalidation,
            gapDetected: journalReplay.gapDetected,
            truncated: journalReplay.truncated,
            error: journalReplay.error,
        };
        const checkpointJournalSequence = journalReplay.available ? journalReplay.highWatermark : undefined;
        throwIfAborted(signal);
        const gitSnapshot = await readIndexGitSnapshot({
            workspaceRoot,
            scopePath: config.path,
            gitConfig,
            ...(signal ? { signal } : {}),
        });
        throwIfAborted(signal);
        const plan = planIndexStartup({
            checkpoint,
            gitSnapshot,
            schemaVersion,
            indexFiles,
            fullReconcileIntervalMs: config.fullReconcileIntervalMs,
            journalReplay: journalEvidence,
        });

        if (plan.mode === 'skip' && gitSnapshot.head) {
            throwIfAborted(signal);
            const hashVerification = await indexRegistry.verifyHashSample(resolved.resolved, {
                cursor: checkpoint?.hashVerificationCursor ?? '',
                maxFiles: config.hashVerifySampleFiles,
                ...(signal ? { signal } : {}),
            });
            throwIfAborted(signal);
            const hashVerificationSummary = summarizeHashVerificationSample(hashVerification);
            if (hashVerification.available !== true || Number(hashVerification.mismatchCount ?? 0) > 0) {
                return await runFullReconcile(
                    config,
                    resolved.resolved,
                    gitSnapshot,
                    schemaVersion,
                    startupStartedAt,
                    {
                        fallbackReason:
                            hashVerification.available === true
                                ? 'bounded-hash-verification-mismatch'
                                : 'bounded-hash-verification-unavailable',
                        gitSnapshotDurationMs: gitSnapshot.durationMs,
                        journalReplay: journalSummary,
                        hashVerification: hashVerificationSummary,
                    },
                    checkpointJournalSequence,
                    db,
                    workspace,
                    signal,
                );
            }
            writeIndexStartupCheckpoint(
                {
                    scopePath: config.path,
                    head: gitSnapshot.head,
                    schemaVersion,
                    mode: 'skip',
                    ...(checkpointJournalSequence === undefined ? {} : { journalSequence: checkpointJournalSequence }),
                    hashVerificationCursor: String(hashVerification.nextCursor ?? ''),
                },
                db,
            );
            const durationMs = Math.max(0, Date.now() - startupStartedAt);
            return makeRuntimeState({
                status: 'skipped',
                reason: plan.reason,
                result: {
                    available: true,
                    mode: 'skip',
                    scannedEntries: 0,
                    candidateFiles: 0,
                    indexed: 0,
                    invalidated: 0,
                    hashVerifications: Number(hashVerification.hashVerifications ?? 0),
                    hashVerification: hashVerificationSummary,
                    journalReplay: journalSummary,
                    gitSnapshotDurationMs: gitSnapshot.durationMs,
                    noChangeSloMs: config.noChangeSloMs,
                    noChangeSloMet: durationMs <= config.noChangeSloMs,
                    durationMs,
                },
                config,
            });
        }

        if (plan.mode === 'incremental' && gitSnapshot.head && checkpoint) {
            let changes = [...plan.worktreeChanges];
            let committedDiffDurationMs = 0;
            if (plan.needsCommittedDiff) {
                const committed = await readCommittedIndexChanges({
                    workspaceRoot,
                    scopePath: config.path,
                    fromHead: checkpoint.head,
                    toHead: gitSnapshot.head,
                    gitConfig,
                    ...(signal ? { signal } : {}),
                });
                throwIfAborted(signal);
                committedDiffDurationMs = committed.durationMs;
                if (!committed.available || committed.uncertain) {
                    return await runFullReconcile(
                        config,
                        resolved.resolved,
                        gitSnapshot,
                        schemaVersion,
                        startupStartedAt,
                        {
                            fallbackReason: 'committed-diff-uncertain',
                            gitSnapshotDurationMs: gitSnapshot.durationMs,
                            journalReplay: journalSummary,
                        },
                        checkpointJournalSequence,
                        db,
                        workspace,
                        signal,
                    );
                }
                changes = [...changes, ...committed.changes];
            }
            const gitPaths = normalizeGitChangePaths(changes, config.path, workspaceRoot);
            const explicitPaths = [...new Set([...gitPaths, ...journalDomain.paths])];
            throwIfAborted(signal);
            const incremental = await refreshIoIndexPaths(explicitPaths, {
                workspaceRoot,
                scopeRoot: resolved.resolved,
                respectGitignore: config.respectGitignore,
                ...(signal ? { signal } : {}),
            });
            throwIfAborted(signal);
            const domainReconcile = await reconcileIoIndexAutoRefreshDomain(signal ? { signal } : {});
            throwIfAborted(signal);
            if (incremental.available === false || incremental.failed > 0) {
                return await runFullReconcile(
                    config,
                    resolved.resolved,
                    gitSnapshot,
                    schemaVersion,
                    startupStartedAt,
                    {
                        fallbackReason: 'incremental-refresh-failed',
                        gitSnapshotDurationMs: gitSnapshot.durationMs,
                        incrementalFailed: incremental.failed,
                        journalReplay: journalSummary,
                    },
                    checkpointJournalSequence,
                    db,
                    workspace,
                    signal,
                );
            }
            writeIndexStartupCheckpoint(
                {
                    scopePath: config.path,
                    head: gitSnapshot.head,
                    schemaVersion,
                    mode: 'incremental',
                    ...(checkpointJournalSequence === undefined ? {} : { journalSequence: checkpointJournalSequence }),
                },
                db,
            );
            return makeRuntimeState({
                status: 'completed',
                reason: plan.reason,
                result: {
                    ...incremental,
                    domainReconcile,
                    mode: 'incremental',
                    changedPathCount: explicitPaths.length,
                    gitChangedPathCount: gitPaths.length,
                    journalReplay: journalSummary,
                    journalReplayPathCount: journalDomain.paths.length,
                    journalOutsideScopeRows: journalScope.outsideScopeRows,
                    scannedEntries: 0,
                    candidateFiles: explicitPaths.length,
                    hashVerifications: 0,
                    gitSnapshotDurationMs: gitSnapshot.durationMs,
                    committedDiffDurationMs,
                    durationMs: Math.max(0, Date.now() - startupStartedAt),
                },
                config,
            });
        }

        return await runFullReconcile(
            config,
            resolved.resolved,
            gitSnapshot,
            schemaVersion,
            startupStartedAt,
            {
                fallbackReason: plan.reason,
                gitSnapshotDurationMs: gitSnapshot.durationMs,
                journalReplay: journalSummary,
            },
            checkpointJournalSequence,
            db,
            workspace,
            signal,
        );
    } catch (error) {
        return makeRuntimeState({
            status: 'failed',
            reason: signal?.aborted ? 'aborted' : 'exception',
            error: { message: error instanceof Error ? error.message : String(error) },
            config,
        });
    }
}

/**
 * @param {McpIndexAutoBuildConfig} config
 * @param {string} resolvedPath
 * @param {Awaited<ReturnType<typeof readIndexGitSnapshot>>} gitSnapshot
 * @param {number} schemaVersion
 * @param {number} startupStartedAt
 * @param {Record<string, unknown>} evidence
 * @param {number | undefined} journalSequence
 * @param {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort} db
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {AbortSignal | undefined} signal
 */
async function runFullReconcile(
    config,
    resolvedPath,
    gitSnapshot,
    schemaVersion,
    startupStartedAt,
    evidence,
    journalSequence,
    db,
    workspace,
    signal,
) {
    throwIfAborted(signal);
    const buildIoIndexForDirectory = workspace.indexRegistry.buildDirectory;
    const reconcileIoIndexAutoRefreshDomain = workspace.indexRegistry.reconcileAutoRefreshDomain;
    const result = await buildIoIndexForDirectory(resolvedPath, {
        workspaceRoot: workspace.workspaceRoot,
        recursive: true,
        depth: config.depth,
        respectGitignore: config.respectGitignore,
        maxFiles: config.maxFiles,
        concurrency: config.concurrency,
        adoptAutoRefreshDomain: true,
        ...(signal ? { signal } : {}),
    });
    throwIfAborted(signal);
    const domainReconcile = await reconcileIoIndexAutoRefreshDomain(signal ? { signal } : {});
    throwIfAborted(signal);
    if (result.available !== false && gitSnapshot.head && !gitSnapshot.uncertain) {
        writeIndexStartupCheckpoint(
            {
                scopePath: config.path,
                head: gitSnapshot.head,
                schemaVersion,
                mode: 'full-reconcile',
                ...(journalSequence === undefined ? {} : { journalSequence }),
            },
            db,
        );
    }
    return makeState(
        {
            status: result.available === false ? 'failed' : 'completed',
            reason: result.available === false ? 'index-unavailable' : 'full-reconcile',
            result: /** @type {Record<string, unknown>} */ ({
                ...result,
                domainReconcile,
                mode: 'full-reconcile',
                ...evidence,
                durationMs: Math.max(0, Date.now() - startupStartedAt),
            }),
            config,
            stats: /** @type {Record<string, unknown>} */ (workspace.indexRegistry.status()),
        },
        config,
    );
}

/**
 * Keep bounded hash verification diagnostics compact and path-agnostic. Mismatch paths are intentionally not retained
 * in the process state: the full reconcile is the repair authority, while counts/reasons are enough for health/SLO
 * diagnostics.
 *
 * @param {Awaited<ReturnType<import('#copilot/mcp/public/workspace').McpWorkspaceCapability['indexRegistry']['verifyHashSample']>>} result
 */
function summarizeHashVerificationSample(result) {
    const reasonCounts = new Map();
    for (const mismatch of Array.isArray(result.mismatches) ? result.mismatches : []) {
        const reason = String(mismatch?.reason ?? 'unknown');
        reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
    return {
        available: result.available === true,
        maxFiles: Number(result.maxFiles ?? 0),
        candidateCount: Number(result.candidateCount ?? 0),
        wrapped: result.wrapped === true,
        hashVerifications: Number(result.hashVerifications ?? 0),
        hashVerificationHits: Number(result.hashVerificationHits ?? 0),
        hashVerificationMisses: Number(result.hashVerificationMisses ?? 0),
        metadataMismatches: Number(result.metadataMismatches ?? 0),
        errors: Number(result.errors ?? 0),
        mismatchCount: Number(result.mismatchCount ?? 0),
        mismatchReasons: Object.fromEntries(reasonCounts),
        durationMs: Number(result.durationMs ?? 0),
    };
}

/** @param {AbortSignal | undefined} signal */
function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    const reason = signal.reason;
    throw reason instanceof Error
        ? reason
        : new Error(reason === undefined ? 'MCP index auto-build aborted.' : String(reason));
}

/** @param {AbortSignal} signal */
function abortMessage(signal) {
    const reason = signal.reason;
    return reason instanceof Error
        ? reason.message
        : reason === undefined
          ? 'MCP index auto-build aborted.'
          : String(reason);
}

/**
 * Convert Git evidence into validated repo-absolute paths. Git output is internally generated and already scoped, but
 * we still enforce scope containment before handing paths to the index refresh primitive.
 *
 * @param {{ path: string }[]} changes
 * @param {string} scopePath
 * @param {string} workspaceRoot
 */
function normalizeGitChangePaths(changes, scopePath, workspaceRoot) {
    const scopeRoot = resolve(workspaceRoot, scopePath);
    const unique = new Set();
    for (const change of changes) {
        const candidate = resolve(workspaceRoot, change.path);
        const rel = relative(scopeRoot, candidate);
        if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) unique.add(candidate);
    }
    return [...unique];
}

/**
 * @returns {void}
 */
export function resetMcpIndexAutoBuildStateForTests() {
    autoBuildStates.clear();
    autoBuildPromises.clear();
}
