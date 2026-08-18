// @ts-check
/**
 * MCP HTTP boot-time IO index auto-build.
 *
 * @module copilot/mcp/control-plane/index-auto-build
 */

import {
    buildIoIndexForDirectory,
    getIoIndexStats,
    reconcileIoIndexAutoRefreshDomain,
    refreshIoIndexPaths,
} from '#copilot/infra/public/indexing';
import { WORKSPACE_ROOT } from '#copilot/tools';
import { isAbsolute, relative, resolve } from 'node:path';
import {
    planIndexStartup,
    readCommittedIndexChanges,
    readIndexGitSnapshot,
    readIndexStartupCheckpoint,
    writeIndexStartupCheckpoint,
} from './index-auto-build-checkpoint.js';
import { resolveReadPath } from './paths.js';

/**
 * @typedef {object} McpIndexAutoBuildConfig
 * @property {boolean} enabled
 * @property {string} path
 * @property {number} maxFiles
 * @property {number} depth
 * @property {number} concurrency
 * @property {boolean} respectGitignore
 * @property {number} fullReconcileIntervalMs
 */

/**
 * @typedef {object} McpIndexAutoBuildState
 * @property {'never-started' | 'disabled' | 'running' | 'completed' | 'failed' | 'skipped'} status
 * @property {string | null} startedAt
 * @property {string | null} completedAt
 * @property {string | null} reason
 * @property {Record<string, unknown> | null} result
 * @property {Record<string, unknown> | null} error
 * @property {McpIndexAutoBuildConfig} config
 * @property {Record<string, unknown>} stats
 */

const DEFAULT_AUTO_BUILD_PATH = 'src/copilot';
const DEFAULT_AUTO_BUILD_MAX_FILES = 5000;
const DEFAULT_AUTO_BUILD_DEPTH = 20;
const DEFAULT_AUTO_BUILD_CONCURRENCY = 4;
const DEFAULT_FULL_RECONCILE_INTERVAL_MS = 30 * 60 * 1000;

/** @type {McpIndexAutoBuildState | null} */
let autoBuildState = null;
/** @type {Promise<McpIndexAutoBuildState> | null} */
let autoBuildPromise = null;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function envBool(value) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function envBoolWithDefault(value, fallback) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    if (!normalized) return fallback;
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
    return envBool(normalized);
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {{ min: number; max: number }} range
 * @returns {number}
 */
function envInt(value, fallback, range) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return fallback;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(range.max, Math.max(range.min, Math.round(parsed)));
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {McpIndexAutoBuildConfig}
 */
export function readMcpIndexAutoBuildConfig(env = process.env) {
    return {
        enabled: envBoolWithDefault(env['COPILOT_MCP_INDEX_AUTO_BUILD'], true),
        path:
            String(env['COPILOT_MCP_INDEX_AUTO_BUILD_PATH'] ?? DEFAULT_AUTO_BUILD_PATH).trim() ||
            DEFAULT_AUTO_BUILD_PATH,
        maxFiles: envInt(env['COPILOT_MCP_INDEX_AUTO_BUILD_MAX_FILES'], DEFAULT_AUTO_BUILD_MAX_FILES, {
            min: 1,
            max: 25_000,
        }),
        depth: envInt(env['COPILOT_MCP_INDEX_AUTO_BUILD_DEPTH'], DEFAULT_AUTO_BUILD_DEPTH, { min: 1, max: 50 }),
        concurrency: envInt(env['COPILOT_MCP_INDEX_AUTO_BUILD_CONCURRENCY'], DEFAULT_AUTO_BUILD_CONCURRENCY, {
            min: 1,
            max: 32,
        }),
        respectGitignore: !envBool(env['COPILOT_MCP_INDEX_AUTO_BUILD_IGNORE_GITIGNORE']),
        fullReconcileIntervalMs: envInt(
            env['COPILOT_MCP_INDEX_FULL_RECONCILE_INTERVAL_MS'],
            DEFAULT_FULL_RECONCILE_INTERVAL_MS,
            { min: 60_000, max: 24 * 60 * 60 * 1000 },
        ),
    };
}

/**
 * @param {{
 *     status: McpIndexAutoBuildState['status'];
 *     reason?: string | null;
 *     result?: Record<string, unknown> | null;
 *     error?: Record<string, unknown> | null;
 *     config?: McpIndexAutoBuildConfig;
 * }} input
 * @returns {McpIndexAutoBuildState}
 */
function makeState(input) {
    const previousStartedAt = autoBuildState?.startedAt ?? null;
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
        config: input.config ?? readMcpIndexAutoBuildConfig(),
        stats: /** @type {Record<string, unknown>} */ (getIoIndexStats()),
    };
}

/**
 * @returns {McpIndexAutoBuildState}
 */
export function readMcpIndexAutoBuildState() {
    if (autoBuildState) {
        return {
            ...autoBuildState,
            config: { ...autoBuildState.config },
            stats: /** @type {Record<string, unknown>} */ (getIoIndexStats()),
            result: autoBuildState.result ? { ...autoBuildState.result } : null,
            error: autoBuildState.error ? { ...autoBuildState.error } : null,
        };
    }
    const config = readMcpIndexAutoBuildConfig();
    return makeState({
        status: config.enabled ? 'never-started' : 'disabled',
        reason: config.enabled ? 'auto-build-enabled-but-not-started' : 'auto-build-disabled',
        config,
    });
}

/**
 * @param {{ reason?: string }} [options]
 * @returns {Promise<McpIndexAutoBuildState>}
 */
export async function maybeStartMcpIndexAutoBuild(options = {}) {
    const config = readMcpIndexAutoBuildConfig();
    if (!config.enabled) {
        autoBuildState = makeState({ status: 'disabled', reason: 'auto-build-disabled', config });
        return readMcpIndexAutoBuildState();
    }
    if (autoBuildPromise) return await autoBuildPromise;
    if (autoBuildState?.status === 'completed' || autoBuildState?.status === 'running') {
        return readMcpIndexAutoBuildState();
    }

    autoBuildState = makeState({ status: 'running', reason: options.reason ?? 'mcp-http-start', config });
    autoBuildPromise = runIndexAutoBuild(config)
        .then((state) => {
            autoBuildState = state;
            return readMcpIndexAutoBuildState();
        })
        .finally(() => {
            autoBuildPromise = null;
        });
    return await autoBuildPromise;
}

/**
 * @param {{ reason?: string }} [options]
 * @returns {void}
 */
export function startMcpIndexAutoBuildInBackground(options = {}) {
    void maybeStartMcpIndexAutoBuild(options);
}

/**
 * @param {McpIndexAutoBuildConfig} config
 * @returns {Promise<McpIndexAutoBuildState>}
 */
async function runIndexAutoBuild(config) {
    try {
        const resolved = await resolveReadPath(config.path);
        if (!resolved.ok) {
            return makeState({
                status: 'failed',
                reason: 'path-resolution-failed',
                error: { code: resolved.code, message: resolved.reason, hint: resolved.hint },
                config,
            });
        }
        const startupStartedAt = Date.now();
        const indexStats = /** @type {Record<string, unknown>} */ (getIoIndexStats());
        const schemaVersion = Number(indexStats['schemaVersion'] ?? 0);
        const indexFiles = Number(indexStats['files'] ?? 0);
        const gitSnapshot = await readIndexGitSnapshot({ workspaceRoot: WORKSPACE_ROOT, scopePath: config.path });
        const checkpoint = readIndexStartupCheckpoint(config.path);
        const plan = planIndexStartup({
            checkpoint,
            gitSnapshot,
            schemaVersion,
            indexFiles,
            fullReconcileIntervalMs: config.fullReconcileIntervalMs,
        });

        if (plan.mode === 'skip' && gitSnapshot.head) {
            writeIndexStartupCheckpoint({
                scopePath: config.path,
                head: gitSnapshot.head,
                schemaVersion,
                mode: 'skip',
            });
            return makeState({
                status: 'skipped',
                reason: plan.reason,
                result: {
                    available: true,
                    mode: 'skip',
                    scannedEntries: 0,
                    candidateFiles: 0,
                    indexed: 0,
                    invalidated: 0,
                    hashVerifications: 0,
                    gitSnapshotDurationMs: gitSnapshot.durationMs,
                    durationMs: Math.max(0, Date.now() - startupStartedAt),
                },
                config,
            });
        }

        if (plan.mode === 'incremental' && gitSnapshot.head && checkpoint) {
            let changes = [...plan.worktreeChanges];
            let committedDiffDurationMs = 0;
            if (plan.needsCommittedDiff) {
                const committed = await readCommittedIndexChanges({
                    workspaceRoot: WORKSPACE_ROOT,
                    scopePath: config.path,
                    fromHead: checkpoint.head,
                    toHead: gitSnapshot.head,
                });
                committedDiffDurationMs = committed.durationMs;
                if (!committed.available || committed.uncertain) {
                    return await runFullReconcile(config, resolved.resolved, gitSnapshot, schemaVersion, startupStartedAt, {
                        fallbackReason: 'committed-diff-uncertain',
                        gitSnapshotDurationMs: gitSnapshot.durationMs,
                    });
                }
                changes = [...changes, ...committed.changes];
            }
            const explicitPaths = normalizeGitChangePaths(changes, config.path);
            const incremental = await refreshIoIndexPaths(explicitPaths, {
                workspaceRoot: WORKSPACE_ROOT,
                scopeRoot: resolved.resolved,
                respectGitignore: config.respectGitignore,
            });
            const domainReconcile = await reconcileIoIndexAutoRefreshDomain();
            if (incremental.available === false || incremental.failed > 0) {
                return await runFullReconcile(config, resolved.resolved, gitSnapshot, schemaVersion, startupStartedAt, {
                    fallbackReason: 'incremental-refresh-failed',
                    gitSnapshotDurationMs: gitSnapshot.durationMs,
                    incrementalFailed: incremental.failed,
                });
            }
            writeIndexStartupCheckpoint({
                scopePath: config.path,
                head: gitSnapshot.head,
                schemaVersion,
                mode: 'incremental',
            });
            return makeState({
                status: 'completed',
                reason: plan.reason,
                result: {
                    ...incremental,
                    domainReconcile,
                    mode: 'incremental',
                    changedPathCount: explicitPaths.length,
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

        return await runFullReconcile(config, resolved.resolved, gitSnapshot, schemaVersion, startupStartedAt, {
            fallbackReason: plan.reason,
            gitSnapshotDurationMs: gitSnapshot.durationMs,
        });
    } catch (error) {
        return makeState({
            status: 'failed',
            reason: 'exception',
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
 */
async function runFullReconcile(config, resolvedPath, gitSnapshot, schemaVersion, startupStartedAt, evidence) {
    const result = await buildIoIndexForDirectory(resolvedPath, {
        workspaceRoot: WORKSPACE_ROOT,
        recursive: true,
        depth: config.depth,
        respectGitignore: config.respectGitignore,
        maxFiles: config.maxFiles,
        concurrency: config.concurrency,
        adoptAutoRefreshDomain: true,
    });
    const domainReconcile = await reconcileIoIndexAutoRefreshDomain();
    if (result.available !== false && gitSnapshot.head && !gitSnapshot.uncertain) {
        writeIndexStartupCheckpoint({
            scopePath: config.path,
            head: gitSnapshot.head,
            schemaVersion,
            mode: 'full-reconcile',
        });
    }
    return makeState({
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
    });
}

/**
 * Convert Git evidence into validated repo-absolute paths. Git output is internally generated and already scoped, but we
 * still enforce scope containment before handing paths to the index refresh primitive.
 *
 * @param {Array<{ path: string }>} changes
 * @param {string} scopePath
 */
function normalizeGitChangePaths(changes, scopePath) {
    const scopeRoot = resolve(WORKSPACE_ROOT, scopePath);
    const unique = new Set();
    for (const change of changes) {
        const candidate = resolve(WORKSPACE_ROOT, change.path);
        const rel = relative(scopeRoot, candidate);
        if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) unique.add(candidate);
    }
    return [...unique];
}

/**
 * @returns {void}
 */
export function resetMcpIndexAutoBuildStateForTests() {
    autoBuildState = null;
    autoBuildPromise = null;
}
