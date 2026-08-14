// @ts-check
/**
 * Diagnostics and bounded cleanup for transient MCP/ChatGPT artifacts under src/copilot/.ai.
 *
 * Cleanup is structurally restricted to strict UUID-named files under `.ai/jobs`, defaults to dry-run and preserves
 * OAuth stores, tunnel tokens, pid files, quarantine data and unknown names.
 *
 * @module copilot/mcp/control-plane/ai-artifacts
 */

import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getMcpWorkspaceRoot } from './paths.js';

const STRICT_UUID_JOB_ARTIFACT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(json|log)$/u;
const ROLLBACK_SIDECAR_RE = /^(\d+)-([a-f0-9]{64})-([0-9a-f-]{36})\.rollback$/u;
const ROLLBACK_PENDING_RE = /^\.pending-(\d+)-(\d+)-([0-9a-f-]{36})$/u;
const DEFAULT_RETAIN_NEWEST = 240;
const DEFAULT_CLOUDFLARE_LOG_THRESHOLD_BYTES = 2 * 1024 * 1024;
const REPORT_CACHE_TTL_MS = 5 * 1000;

/** @type {{ key: string; expiresAt: number; report: Record<string, unknown> } | null} */
let cachedReport = null;

/**
 * @typedef {object} AiArtifactsReportOptions
 * @property {number} [retainNewest]
 * @property {number} [cloudflareLogThresholdBytes]
 * @property {string} [workspaceRoot]
 *
 * @typedef {object} JobArtifactSummary
 * @property {string} name
 * @property {number} bytes
 * @property {number} mtimeMs
 * @property {boolean} strictUuidName
 */

/**
 * @param {string} directory
 * @returns {Promise<import('node:fs').Dirent[]>}
 */
async function readdirSafe(directory) {
    try {
        return await readdir(directory, { withFileTypes: true });
    } catch {
        return [];
    }
}

/**
 * @param {string} filePath
 * @returns {Promise<import('node:fs').Stats | null>}
 */
async function statSafe(filePath) {
    try {
        return await stat(filePath);
    } catch {
        return null;
    }
}

/**
 * @param {AiArtifactsReportOptions} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildAiArtifactsReport(options = {}) {
    const workspaceRoot = options.workspaceRoot ?? getMcpWorkspaceRoot();
    const aiDir = path.join(workspaceRoot, 'src/copilot/.ai');
    const jobsDir = path.join(aiDir, 'jobs');
    const cloudflareDir = path.join(aiDir, 'cloudflare');
    const mcpDir = path.join(aiDir, 'mcp');
    const rollbackDir = path.join(aiDir, 'rollback');
    const retainNewest = normalizePositiveInteger(options.retainNewest, DEFAULT_RETAIN_NEWEST, 20, 10_000);
    const cloudflareLogThresholdBytes = normalizePositiveInteger(
        options.cloudflareLogThresholdBytes,
        DEFAULT_CLOUDFLARE_LOG_THRESHOLD_BYTES,
        256 * 1024,
        256 * 1024 * 1024,
    );
    const cacheKey = JSON.stringify({ workspaceRoot, retainNewest, cloudflareLogThresholdBytes });
    if (cachedReport && cachedReport.key === cacheKey && cachedReport.expiresAt > Date.now()) return cachedReport.report;

    const jobsEntries = await readdirSafe(jobsDir);
    /** @type {JobArtifactSummary[]} */
    const jobArtifacts = [];
    let ignoredJobFileCount = 0;
    for (const entry of jobsEntries) {
        if (!entry.isFile()) continue;
        if (!STRICT_UUID_JOB_ARTIFACT_RE.test(entry.name)) {
            ignoredJobFileCount += 1;
            continue;
        }
        const filePath = path.join(jobsDir, entry.name);
        const stats = await statSafe(filePath);
        if (!stats) continue;
        jobArtifacts.push({
            name: entry.name,
            bytes: stats.size,
            mtimeMs: stats.mtimeMs,
            strictUuidName: true,
        });
    }
    jobArtifacts.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
    const cleanupCandidates = jobArtifacts.slice(retainNewest);
    const cleanupCandidateSamples = cleanupCandidates.slice(0, 12).map((artifact) => ({ name: artifact.name, bytes: artifact.bytes }));

    const oversizedCloudflareLogs = [];
    for (const name of ['cloudflared.log', 'mcp-http.log']) {
        const stats = await statSafe(path.join(cloudflareDir, name));
        if (stats && stats.size > cloudflareLogThresholdBytes) oversizedCloudflareLogs.push({ name, bytes: stats.size });
    }

    const rollbackEntries = await readdirSafe(rollbackDir);
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
        if (!entry.isFile()) {
            ignoredRollbackEntryCount += 1;
            continue;
        }
        const sidecarMatch = ROLLBACK_SIDECAR_RE.exec(entry.name);
        const pendingMatch = ROLLBACK_PENDING_RE.exec(entry.name);
        if (!sidecarMatch && !pendingMatch) {
            ignoredRollbackEntryCount += 1;
            continue;
        }
        const stats = await statSafe(path.join(rollbackDir, entry.name));
        if (!stats) continue;
        rollbackOldestMtimeMs = rollbackOldestMtimeMs === null ? stats.mtimeMs : Math.min(rollbackOldestMtimeMs, stats.mtimeMs);
        rollbackNewestMtimeMs = rollbackNewestMtimeMs === null ? stats.mtimeMs : Math.max(rollbackNewestMtimeMs, stats.mtimeMs);
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

    const mcpEntries = await readdirSafe(mcpDir);
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
            protectedNames: ['*.pid', '*.pid.json', 'workspace-mcp-dev.token', 'connector-smoke.json', 'quick-tunnel.json'],
        },
        mcp: {
            entryCount: mcpEntries.length,
            protectedNames: ['oauth-clients.json', 'oauth-refresh-tokens.json'],
            appendOnlyHistories: ['latency-dashboard.jsonl'],
        },
        rollback: {
            path: path.relative(workspaceRoot, rollbackDir),
            sidecarCount: rollbackSidecarCount,
            sidecarBytes: rollbackSidecarBytes,
            expiredCount: rollbackExpiredCount,
            expiredBytes: rollbackExpiredBytes,
            pendingCount: rollbackPendingCount,
            pendingBytes: rollbackPendingBytes,
            ignoredEntryCount: ignoredRollbackEntryCount,
            oldestMtimeMs: rollbackOldestMtimeMs,
            newestMtimeMs: rollbackNewestMtimeMs,
            cleanupOwnedBy: 'infra/io/fs/rollback-sidecar.js TTL cleanup',
            maintenanceMutation: false,
        },
        cleanupPlan: {
            applyInsideMcp: true,
            tool: 'mcp_cleanup_ai_artifacts',
            defaultDryRun: true,
            maxDeleteCountPerCall: 500,
            deletionDomain: 'strict UUID-named .json/.log files under src/copilot/.ai/jobs only',
        },
        safety: {
            defaultAction: 'dry-run',
            cleanupPolicy:
                'delete only strict UUID-named .json/.log validator artifacts beyond retention; never delete OAuth stores, tunnel token, pid files, quarantine, or unknown names',
        },
    };
    cachedReport = { key: cacheKey, expiresAt: Date.now() + REPORT_CACHE_TTL_MS, report };
    return report;
}

export function clearAiArtifactsReportCache() {
    cachedReport = null;
}

/**
 * Delete only strict UUID-named validator artifacts beyond retention. Unknown names and all state outside `.ai/jobs`
 * are structurally unreachable from this operation.
 *
 * @param {AiArtifactsReportOptions & { dryRun?: boolean; maxDeleteCount?: number }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function cleanupAiArtifacts(options = {}) {
    clearAiArtifactsReportCache();
    const workspaceRoot = options.workspaceRoot ?? getMcpWorkspaceRoot();
    const retainNewest = normalizePositiveInteger(options.retainNewest, DEFAULT_RETAIN_NEWEST, 20, 10_000);
    const maxDeleteCount = normalizePositiveInteger(options.maxDeleteCount, 100, 1, 500);
    const dryRun = options.dryRun !== false;
    const jobsDir = path.join(workspaceRoot, 'src/copilot/.ai/jobs');
    const entries = await readdirSafe(jobsDir);
    const artifacts = [];
    for (const entry of entries) {
        if (!entry.isFile() || !STRICT_UUID_JOB_ARTIFACT_RE.test(entry.name)) continue;
        const stats = await statSafe(path.join(jobsDir, entry.name));
        if (!stats) continue;
        artifacts.push({ name: entry.name, bytes: stats.size, mtimeMs: stats.mtimeMs });
    }
    artifacts.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
    const candidates = artifacts
        .slice(retainNewest)
        .sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name));
    const selected = candidates.slice(0, maxDeleteCount);
    const deleted = [];
    const failures = [];

    if (!dryRun) {
        for (const artifact of selected) {
            if (!STRICT_UUID_JOB_ARTIFACT_RE.test(artifact.name)) continue;
            try {
                await unlink(path.join(jobsDir, artifact.name));
                deleted.push(artifact);
            } catch (error) {
                failures.push({
                    name: artifact.name,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    const after = await buildAiArtifactsReport({ ...options, workspaceRoot, retainNewest });
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
        failures,
        remainingCandidateCount:
            /** @type {Record<string, unknown>} */ (after['jobs'] ?? {})['cleanupCandidateCount'] ?? null,
        protectedByDesign: [
            'non-UUID job filenames',
            'OAuth stores',
            'tunnel tokens and state',
            'pid files',
            'quarantine data',
            'all paths outside src/copilot/.ai/jobs',
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
