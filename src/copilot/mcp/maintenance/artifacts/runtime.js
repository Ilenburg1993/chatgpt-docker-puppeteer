// @ts-check
/**
 * Diagnostics and bounded cleanup for transient MCP/ChatGPT artifacts under src/copilot/.ai.
 *
 * Cleanup defaults to dry-run and is structurally restricted to strict UUID-named files under `.ai/jobs`. A second,
 * explicit cleanup domain can purge only schema-valid rollback sidecars/pending files while automatic rollback is
 * disabled. OAuth stores, tunnel tokens, pid files, quarantine data and unknown names remain protected.
 *
 * @module copilot/mcp/maintenance/artifacts/runtime
 */

import path from 'node:path';

const STRICT_UUID_JOB_ARTIFACT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(json|log)$/u;
const ROLLBACK_SIDECAR_RE = /^(\d+)-([a-f0-9]{64})-([0-9a-f-]{36})\.rollback$/u;
const ROLLBACK_PENDING_RE = /^\.pending-(\d+)-(\d+)-([0-9a-f-]{36})$/u;
const DEFAULT_RETAIN_NEWEST = 240;
const DEFAULT_CLOUDFLARE_LOG_THRESHOLD_BYTES = 2 * 1024 * 1024;
const REPORT_CACHE_TTL_MS = 5 * 1000;
const MAX_ARTIFACT_STAT_CONCURRENCY = 32;

/**
 * @typedef {object} AiArtifactsReportOptions
 * @property {number} [retainNewest]
 * @property {number} [cloudflareLogThresholdBytes]
 *
 * @typedef {object} JobArtifactSummary
 * @property {string} name
 * @property {number} bytes
 * @property {number} mtimeMs
 * @property {boolean} strictUuidName
 */

/** @typedef {{ name: string; stats: import('node:fs').Stats }} AiArtifactDirEntry */
/** @typedef {ReturnType<typeof import('#copilot/infra/public/composition/filesystem/configured').createConfiguredFsIo>} AiArtifactsReadIo */
/** @typedef {{ directory:string; enabled:boolean; ttlMs:number; maxEntries:number; maxBytes:number }} AiArtifactsRollbackPolicy */
/** @typedef {{ cleanupSidecars:(options?:{nowMs?:number;scanLimit?:number;maxEntries?:number;maxBytes?:number;purgeAll?:boolean;enforceBudget?:boolean})=>Promise<Record<string,unknown>> }} AiArtifactsRollbackMaintenance */
/** @typedef {{ workspaceRoot:string; aiDir:string; jobsDir:string; cloudflareDir:string; mcpDir:string; rollbackDir:string; rollbackPolicy:AiArtifactsRollbackPolicy; rollbackMaintenance:AiArtifactsRollbackMaintenance|null; io:AiArtifactsReadIo }} AiArtifactsContext */
/** @typedef {{ cachedReport: { key:string; expiresAt:number; report:Record<string,unknown> } | null }} AiArtifactsCacheState */

/** @param {AiArtifactsContext} context @param {string} directory @returns {Promise<AiArtifactDirEntry[]>} */
async function readdirSafe(context, directory) {
    try {
        const names = (await context.io.listDirectoryNamesFresh(directory)).entries;
        const entries = [];
        for (let offset = 0; offset < names.length; offset += MAX_ARTIFACT_STAT_CONCURRENCY) {
            const batch = names.slice(offset, offset + MAX_ARTIFACT_STAT_CONCURRENCY);
            const resolved = await Promise.all(
                batch.map(async (name) => {
                    try {
                        const { stats } = await context.io.lstatPath(path.join(directory, name));
                        return { name, stats };
                    } catch {
                        // Concurrent cleanup may remove an entry between listing and lstat; configured IO also denies symlinks.
                        return null;
                    }
                }),
            );
            for (const entry of resolved) {
                if (entry) entries.push(entry);
            }
        }
        return entries;
    } catch {
        return [];
    }
}

/** @param {AiArtifactsContext} context @param {string} filePath @returns {Promise<import('node:fs').Stats | null>} */
async function statSafe(context, filePath) {
    try {
        return (await context.io.lstatPath(filePath)).stats;
    } catch {
        return null;
    }
}

/**
 * Build one AI-artifact runtime around already-authorized metadata IO. The factory cannot mint or widen filesystem
 * authority: workspace identity, rollback policy and cache lifetime are fixed once by the composition root.
 *
 * @param {{ workspaceRoot:string; rollbackPolicy:AiArtifactsRollbackPolicy; rollbackMaintenance?:AiArtifactsRollbackMaintenance|null; io:AiArtifactsReadIo }} binding
 */
export function createAiArtifactsRuntime(binding) {
    if (!path.isAbsolute(binding.workspaceRoot) || !path.isAbsolute(binding.rollbackPolicy.directory)) {
        throw new TypeError('AI artifact runtime requires absolute workspace and rollback identity bindings.');
    }
    const workspaceRoot = path.normalize(binding.workspaceRoot);
    const aiDir = path.join(workspaceRoot, 'src/copilot/.ai');
    /** @type {AiArtifactsContext} */
    const context = Object.freeze({
        workspaceRoot,
        aiDir,
        jobsDir: path.join(aiDir, 'jobs'),
        cloudflareDir: path.join(aiDir, 'cloudflare'),
        mcpDir: path.join(aiDir, 'mcp'),
        rollbackDir: path.normalize(binding.rollbackPolicy.directory),
        rollbackPolicy: binding.rollbackPolicy,
        rollbackMaintenance: binding.rollbackMaintenance ?? null,
        io: binding.io,
    });
    /** @type {AiArtifactsCacheState} */
    const state = { cachedReport: null };
    return Object.freeze({
        context,
        readPressure: (/** @type {AiArtifactsReportOptions} */ options = {}) =>
            readAiArtifactsPressureForRuntime(context, options),
        buildReport: (/** @type {AiArtifactsReportOptions} */ options = {}) =>
            buildAiArtifactsReportForRuntime(context, state, options),
        cleanup: (
            /** @type {AiArtifactsReportOptions & {dryRun?:boolean;maxDeleteCount?:number;purgeDisabledRollback?:boolean}} */ options = {},
        ) => cleanupAiArtifactsForRuntime(context, state, options),
        clearCache: () => {
            state.cachedReport = null;
        },
    });
}

/**
 * Return a cheap operational-pressure snapshot without statting every artifact. Detailed size/mtime evidence remains the
 * responsibility of buildAiArtifactsReportForRuntime().
 *
 * @param {AiArtifactsContext} context
 * @param {AiArtifactsReportOptions} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
async function readAiArtifactsPressureForRuntime(context, options = {}) {
    const retainNewest = normalizePositiveInteger(options.retainNewest, DEFAULT_RETAIN_NEWEST, 20, 10_000);
    const names = await context.io
        .listDirectoryNamesFresh(context.jobsDir)
        .then((result) => result.entries)
        .catch(() => []);
    const strictArtifactCount = names.reduce(
        (count, name) => count + (STRICT_UUID_JOB_ARTIFACT_RE.test(name) ? 1 : 0),
        0,
    );
    return {
        jobs: {
            artifactCount: strictArtifactCount,
            cleanupCandidateCount: Math.max(0, strictArtifactCount - retainNewest),
            cleanupCandidateBytes: null,
            estimatedFromNames: true,
        },
        rollback: {
            enabled: context.rollbackPolicy.enabled,
            sidecarCount: null,
        },
    };
}

/**
 * @param {AiArtifactsContext} context
 * @param {AiArtifactsCacheState} state
 * @param {AiArtifactsReportOptions} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
async function buildAiArtifactsReportForRuntime(context, state, options = {}) {
    const { workspaceRoot, aiDir, jobsDir, cloudflareDir, mcpDir, rollbackDir, rollbackPolicy } = context;
    const retainNewest = normalizePositiveInteger(options.retainNewest, DEFAULT_RETAIN_NEWEST, 20, 10_000);
    const cloudflareLogThresholdBytes = normalizePositiveInteger(
        options.cloudflareLogThresholdBytes,
        DEFAULT_CLOUDFLARE_LOG_THRESHOLD_BYTES,
        256 * 1024,
        256 * 1024 * 1024,
    );
    const cacheKey = JSON.stringify({ retainNewest, cloudflareLogThresholdBytes });
    if (state.cachedReport && state.cachedReport.key === cacheKey && state.cachedReport.expiresAt > Date.now())
        return state.cachedReport.report;

    const jobsEntries = await readdirSafe(context, jobsDir);
    /** @type {JobArtifactSummary[]} */
    const jobArtifacts = [];
    let ignoredJobFileCount = 0;
    for (const entry of jobsEntries) {
        if (!entry.stats.isFile() || entry.stats.isSymbolicLink()) continue;
        if (!STRICT_UUID_JOB_ARTIFACT_RE.test(entry.name)) {
            ignoredJobFileCount += 1;
            continue;
        }
        jobArtifacts.push({
            name: entry.name,
            bytes: entry.stats.size,
            mtimeMs: entry.stats.mtimeMs,
            strictUuidName: true,
        });
    }
    jobArtifacts.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
    const cleanupCandidates = jobArtifacts.slice(retainNewest);
    const cleanupCandidateSamples = cleanupCandidates
        .slice(0, 12)
        .map((artifact) => ({ name: artifact.name, bytes: artifact.bytes }));

    const oversizedCloudflareLogs = [];
    for (const name of ['cloudflared.log', 'mcp-http.log']) {
        const stats = await statSafe(context, path.join(cloudflareDir, name));
        if (stats && stats.size > cloudflareLogThresholdBytes)
            oversizedCloudflareLogs.push({ name, bytes: stats.size });
    }

    const rollbackEntries = await readdirSafe(context, rollbackDir);
    const rollbackNowMs = Date.now();
    let rollbackSidecarCount = 0;
    let rollbackSidecarBytes = 0;
    let rollbackExpiredCount = 0;
    let rollbackExpiredBytes = 0;
    let rollbackPendingCount = 0;
    let rollbackPendingBytes = 0;
    let ignoredRollbackEntryCount = 0;
    let rollbackOldestMtimeMs = null;
    let rollbackNewestMtimeMs = null;
    for (const entry of rollbackEntries) {
        if (!entry.stats.isFile() || entry.stats.isSymbolicLink()) {
            ignoredRollbackEntryCount += 1;
            continue;
        }
        const sidecarMatch = ROLLBACK_SIDECAR_RE.exec(entry.name);
        const pendingMatch = ROLLBACK_PENDING_RE.exec(entry.name);
        if (!sidecarMatch && !pendingMatch) {
            ignoredRollbackEntryCount += 1;
            continue;
        }
        const stats = entry.stats;
        rollbackOldestMtimeMs =
            rollbackOldestMtimeMs === null ? stats.mtimeMs : Math.min(rollbackOldestMtimeMs, stats.mtimeMs);
        rollbackNewestMtimeMs =
            rollbackNewestMtimeMs === null ? stats.mtimeMs : Math.max(rollbackNewestMtimeMs, stats.mtimeMs);
        if (sidecarMatch) {
            rollbackSidecarCount += 1;
            rollbackSidecarBytes += stats.size;
            const expiresAtMs = Number(sidecarMatch[1]);
            if (Number.isFinite(expiresAtMs) && expiresAtMs <= rollbackNowMs) {
                rollbackExpiredCount += 1;
                rollbackExpiredBytes += stats.size;
            }
            continue;
        }
        rollbackPendingCount += 1;
        rollbackPendingBytes += stats.size;
    }

    const mcpEntries = await readdirSafe(context, mcpDir);
    const report = {
        aiPath: path.relative(workspaceRoot, aiDir),
        jobs: {
            artifactCount: jobArtifacts.length,
            artifactBytes: jobArtifacts.reduce((sum, artifact) => sum + artifact.bytes, 0),
            ignoredJobFileCount,
            retainNewest,
            overRetainCount: Math.max(0, jobArtifacts.length - retainNewest),
            cleanupCandidateCount: cleanupCandidates.length,
            cleanupCandidateBytes: cleanupCandidates.reduce((sum, artifact) => sum + artifact.bytes, 0),
            cleanupCandidateSamples,
            oldestRetainedCandidate: jobArtifacts[retainNewest - 1]?.name ?? null,
            newestCleanupCandidate: cleanupCandidates[0]?.name ?? null,
        },
        cloudflare: {
            oversizedLogThresholdBytes: cloudflareLogThresholdBytes,
            oversizedLogs: oversizedCloudflareLogs,
            protectedNames: [
                '*.pid',
                '*.pid.json',
                'workspace-mcp-dev.token',
                'connector-smoke.json',
                'quick-tunnel.json',
            ],
        },
        mcp: {
            entryCount: mcpEntries.length,
            protectedNames: ['oauth-clients.json', 'oauth-refresh-tokens.json'],
            appendOnlyHistories: ['latency-dashboard.jsonl'],
        },
        rollback: {
            path: path.relative(workspaceRoot, rollbackDir),
            enabled: rollbackPolicy.enabled,
            policy: {
                enabled: rollbackPolicy.enabled,
                ttlMs: rollbackPolicy.ttlMs,
                maxEntries: rollbackPolicy.maxEntries,
                maxBytes: rollbackPolicy.maxBytes,
            },
            sidecarCount: rollbackSidecarCount,
            sidecarBytes: rollbackSidecarBytes,
            expiredCount: rollbackExpiredCount,
            expiredBytes: rollbackExpiredBytes,
            pendingCount: rollbackPendingCount,
            pendingBytes: rollbackPendingBytes,
            ignoredEntryCount: ignoredRollbackEntryCount,
            oldestMtimeMs: rollbackOldestMtimeMs,
            newestMtimeMs: rollbackNewestMtimeMs,
            overBudgetCount: Math.max(0, rollbackSidecarCount - rollbackPolicy.maxEntries),
            overBudgetBytes: Math.max(0, rollbackSidecarBytes - rollbackPolicy.maxBytes),
            purgeCandidateCount: rollbackPolicy.enabled ? 0 : rollbackSidecarCount + rollbackPendingCount,
            purgeCandidateBytes: rollbackPolicy.enabled ? 0 : rollbackSidecarBytes + rollbackPendingBytes,
            cleanupOwnedBy: 'infra/filesystem/transaction/rollback/maintenance.js TTL + bounded retention cleanup',
            maintenanceMutation: 'explicit-only',
        },
        cleanupPlan: {
            applyInsideMcp: true,
            tool: 'mcp_cleanup_ai_artifacts',
            defaultDryRun: true,
            maxDeleteCountPerCall: 500,
            deletionDomain:
                'strict UUID-named .json/.log files under src/copilot/.ai/jobs; rollback sidecars only when explicitly requested while automatic rollback is disabled',
        },
        safety: {
            defaultAction: 'dry-run',
            cleanupPolicy:
                'delete only allowlisted validator artifacts beyond retention; rollback purge is explicit and schema-restricted; never delete OAuth stores, tunnel token, pid files, quarantine, or unknown names',
        },
    };
    state.cachedReport = { key: cacheKey, expiresAt: Date.now() + REPORT_CACHE_TTL_MS, report };
    return report;
}

/**
 * Delete strict UUID-named validator artifacts beyond retention. Rollback sidecars remain unreachable unless
 * purgeDisabledRollback=true and the global automatic rollback policy is currently disabled.
 *
 * @param {AiArtifactsContext} context
 * @param {AiArtifactsCacheState} state
 * @param {AiArtifactsReportOptions & {
 *     dryRun?: boolean;
 *     maxDeleteCount?: number;
 *     purgeDisabledRollback?: boolean;
 * }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
async function cleanupAiArtifactsForRuntime(context, state, options = {}) {
    state.cachedReport = null;
    const { jobsDir, rollbackDir, rollbackPolicy } = context;
    const retainNewest = normalizePositiveInteger(options.retainNewest, DEFAULT_RETAIN_NEWEST, 20, 10_000);
    const maxDeleteCount = normalizePositiveInteger(options.maxDeleteCount, 100, 1, 500);
    const dryRun = options.dryRun !== false;
    const purgeDisabledRollback = options.purgeDisabledRollback === true;
    const entries = await readdirSafe(context, jobsDir);
    const artifacts = [];
    for (const entry of entries) {
        if (!entry.stats.isFile() || entry.stats.isSymbolicLink() || !STRICT_UUID_JOB_ARTIFACT_RE.test(entry.name))
            continue;
        artifacts.push({ name: entry.name, bytes: entry.stats.size, mtimeMs: entry.stats.mtimeMs });
    }
    artifacts.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
    const candidates = artifacts
        .slice(retainNewest)
        .sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name));
    const selected = candidates.slice(0, maxDeleteCount);
    const deleted = [];
    const failures = [];
    const rollbackCandidates = [];
    if (purgeDisabledRollback && !rollbackPolicy.enabled) {
        for (const entry of await readdirSafe(context, rollbackDir)) {
            if (!entry.stats.isFile() || entry.stats.isSymbolicLink()) continue;
            if (!ROLLBACK_SIDECAR_RE.test(entry.name) && !ROLLBACK_PENDING_RE.test(entry.name)) continue;
            rollbackCandidates.push({ name: entry.name, bytes: entry.stats.size, mtimeMs: entry.stats.mtimeMs });
        }
        rollbackCandidates.sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name));
    } else if (purgeDisabledRollback && rollbackPolicy.enabled) {
        failures.push({
            name: 'rollback',
            error: 'Rollback automático está habilitado; purge de sidecars ativos foi bloqueado.',
        });
    }
    const selectedRollback = rollbackCandidates.slice(0, maxDeleteCount);
    let rollbackCleanup = null;

    if (!dryRun) {
        for (const artifact of selected) {
            if (!STRICT_UUID_JOB_ARTIFACT_RE.test(artifact.name)) continue;
            try {
                await context.io.deleteFile(path.join(jobsDir, artifact.name));
                deleted.push(artifact);
            } catch (error) {
                failures.push({
                    name: artifact.name,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        if (purgeDisabledRollback && !rollbackPolicy.enabled && selectedRollback.length > 0) {
            if (!context.rollbackMaintenance) {
                failures.push({
                    name: 'rollback',
                    error: 'Rollback maintenance capability não foi vinculada a este runtime de artifacts.',
                });
            } else {
                rollbackCleanup = await context.rollbackMaintenance.cleanupSidecars({
                    purgeAll: true,
                    enforceBudget: false,
                    scanLimit: maxDeleteCount,
                });
                if (Number(rollbackCleanup['failed'] ?? 0) > 0) {
                    failures.push({
                        name: 'rollback',
                        error: `Falha ao remover ${String(rollbackCleanup['failed'])} sidecar(s) de rollback.`,
                    });
                }
            }
        }
    }

    state.cachedReport = null;
    const after = await buildAiArtifactsReportForRuntime(context, state, { ...options, retainNewest });
    return {
        success: failures.length === 0,
        dryRun,
        retainNewest,
        maxDeleteCount,
        candidateCount: candidates.length,
        selectedCount: selected.length,
        selectedBytes: selected.reduce((sum, artifact) => sum + artifact.bytes, 0),
        selected: selected.map((artifact) => artifact.name),
        deletedCount: deleted.length,
        deletedBytes: deleted.reduce((sum, artifact) => sum + artifact.bytes, 0),
        rollback: {
            requested: purgeDisabledRollback,
            allowed: purgeDisabledRollback && !rollbackPolicy.enabled,
            policy: {
                enabled: rollbackPolicy.enabled,
                ttlMs: rollbackPolicy.ttlMs,
                maxEntries: rollbackPolicy.maxEntries,
                maxBytes: rollbackPolicy.maxBytes,
            },
            candidateCount: rollbackCandidates.length,
            selectedCount: selectedRollback.length,
            selectedBytes: selectedRollback.reduce((sum, artifact) => sum + artifact.bytes, 0),
            cleanup: dryRun
                ? {
                      dryRun: true,
                      wouldRemove: selectedRollback.length,
                      wouldRemoveBytes: selectedRollback.reduce((sum, artifact) => sum + artifact.bytes, 0),
                  }
                : rollbackCleanup,
            remainingSidecarCount:
                /** @type {Record<string, unknown>} */ (after['rollback'] ?? {})['sidecarCount'] ?? null,
            remainingSidecarBytes:
                /** @type {Record<string, unknown>} */ (after['rollback'] ?? {})['sidecarBytes'] ?? null,
        },
        failures,
        remainingCandidateCount:
            /** @type {Record<string, unknown>} */ (after['jobs'] ?? {})['cleanupCandidateCount'] ?? null,
        protectedByDesign: [
            'non-UUID job filenames',
            'OAuth stores',
            'tunnel tokens and state',
            'pid files',
            'quarantine data',
            'rollback names outside the strict sidecar/pending schema',
            'all other paths outside the explicit cleanup domains',
        ],
    };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function normalizePositiveInteger(value, fallback, min, max) {
    const numeric = Number(value ?? fallback);
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.trunc(numeric))) : fallback;
}
