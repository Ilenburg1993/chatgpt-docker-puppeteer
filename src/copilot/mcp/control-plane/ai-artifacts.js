// @ts-check
/**
 * Read-only diagnostics for transient MCP/ChatGPT artifacts under src/copilot/.ai.
 *
 * This module intentionally reports only; it never deletes files. The report distinguishes cleanup candidates from
 * protected state such as OAuth stores, tunnel tokens, pid files and quarantine data.
 *
 * @module copilot/mcp/control-plane/ai-artifacts
 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { getMcpWorkspaceRoot } from './paths.js';

const STRICT_UUID_JOB_ARTIFACT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(json|log)$/u;
const DEFAULT_RETAIN_NEWEST = 240;
const DEFAULT_CLOUDFLARE_LOG_THRESHOLD_BYTES = 2 * 1024 * 1024;

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
    const workspaceRoot = getMcpWorkspaceRoot();
    const aiDir = path.join(workspaceRoot, 'src/copilot/.ai');
    const jobsDir = path.join(aiDir, 'jobs');
    const cloudflareDir = path.join(aiDir, 'cloudflare');
    const mcpDir = path.join(aiDir, 'mcp');
    const retainNewest = normalizePositiveInteger(options.retainNewest, DEFAULT_RETAIN_NEWEST, 20, 10_000);
    const cloudflareLogThresholdBytes = normalizePositiveInteger(
        options.cloudflareLogThresholdBytes,
        DEFAULT_CLOUDFLARE_LOG_THRESHOLD_BYTES,
        256 * 1024,
        256 * 1024 * 1024,
    );

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

    const mcpEntries = await readdirSafe(mcpDir);
    return {
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
        cleanupPlan: {
            applyInsideMcp: false,
            reason: 'MCP runtime reports candidates but does not delete artifacts; cleanup should be operator-initiated or implemented via a separately reviewed bounded tool.',
            manualScriptPath: 'scripts/maintenance/cleanup-ai-artifacts.cjs',
            scriptStatus: 'not-created-by-mcp-host; use an operator-reviewed local script if applying cleanup',
        },
        safety: {
            defaultAction: 'report-only',
            recommendedManualCleanup:
                'delete only strict UUID-named .json/.log validator artifacts beyond retention; never delete OAuth stores, tunnel token, pid files, quarantine, or unknown names',
        },
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
