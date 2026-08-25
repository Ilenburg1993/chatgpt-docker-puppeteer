// @ts-check
/**
 * Process-generation vs source-on-disk drift diagnostics.
 *
 * This owner is observational only: it never reloads the process and never infers that newer source is safe to
 * promote. It answers one narrower question that matters during long MCP development sessions: did runtime-critical
 * source change after this Node process started?
 *
 * @module copilot/mcp/diagnostics/runtime-source-drift/runtime
 */

import path from 'node:path';

export const MCP_RUNTIME_SOURCE_DRIFT_VERSION = '1.0.0';
export const MCP_RUNTIME_SOURCE_DRIFT_CACHE_TTL_MS = 2_000;
export const MCP_RUNTIME_SOURCE_DRIFT_PATHS = Object.freeze([
    'src/copilot/mcp/registry/runtime.js',
    'src/copilot/mcp/server/runtime.js',
    'src/copilot/mcp/adapters/http/handler.js',
    'src/copilot/mcp/tools/repo-write.js',
    'src/copilot/mcp/protocol/tools/contracts/operation-context.js',
    'src/copilot/mcp/runtime/reload/runner.js',
    'src/copilot/mcp/auth/resource-server/service.js',
]);

/** @type {{ expiresAtMs: number; workspaceRoot: string; value: Record<string, unknown> } | null} */
let cached = null;

/**
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 * @param {{ processStartedAtMs?: number; nowMs?: number; paths?: readonly string[] }} [options]
 */
export async function inspectMcpRuntimeSourceDrift(workspace, options = {}) {
    if (!workspace) throw new TypeError('Runtime/source drift diagnostics require a workspace capability.');
    const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    const processStartedAtMs = Number.isFinite(options.processStartedAtMs)
        ? Number(options.processStartedAtMs)
        : Math.max(0, nowMs - process.uptime() * 1000);
    const paths = options.paths ?? MCP_RUNTIME_SOURCE_DRIFT_PATHS;
    const samples = [];
    let newestSourceMtimeMs = 0;
    let missingCount = 0;

    for (const relativePath of paths) {
        const absolutePath = path.resolve(workspace.workspaceRoot, relativePath);
        try {
            const stats = (await workspace.io.statPath(absolutePath)).stats;
            const regularFile = stats.isFile() && !stats.isSymbolicLink();
            const mtimeMs = regularFile ? Number(stats.mtimeMs) : null;
            if (mtimeMs !== null && Number.isFinite(mtimeMs))
                newestSourceMtimeMs = Math.max(newestSourceMtimeMs, mtimeMs);
            samples.push({
                path: relativePath,
                available: regularFile,
                mtimeMs,
                changedSinceProcessStart: regularFile && mtimeMs !== null && mtimeMs > processStartedAtMs,
            });
            if (!regularFile) missingCount += 1;
        } catch (error) {
            missingCount += 1;
            samples.push({
                path: relativePath,
                available: false,
                mtimeMs: null,
                changedSinceProcessStart: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    const changed = samples.filter((sample) => sample.changedSinceProcessStart === true);
    return Object.freeze({
        version: MCP_RUNTIME_SOURCE_DRIFT_VERSION,
        driftDetected: changed.length > 0,
        processStartedAtMs,
        processStartedAt: new Date(processStartedAtMs).toISOString(),
        checkedAtMs: nowMs,
        checkedAt: new Date(nowMs).toISOString(),
        sampledFileCount: samples.length,
        changedSinceProcessStartCount: changed.length,
        missingCount,
        newestSourceMtimeMs: newestSourceMtimeMs || null,
        newestSourceMtime: newestSourceMtimeMs > 0 ? new Date(newestSourceMtimeMs).toISOString() : null,
        changedPaths: changed.map((sample) => sample.path),
        samples,
        interpretation:
            changed.length > 0
                ? 'Runtime-critical source changed after this process started; loaded tool behavior may be older than source on disk.'
                : 'No sampled runtime-critical source is newer than this process generation.',
    });
}

/** @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace */
export async function readMcpRuntimeSourceDrift(workspace) {
    const nowMs = Date.now();
    if (cached && cached.workspaceRoot === workspace.workspaceRoot && cached.expiresAtMs > nowMs) return cached.value;
    const value = await inspectMcpRuntimeSourceDrift(workspace, { nowMs });
    cached = {
        workspaceRoot: workspace.workspaceRoot,
        expiresAtMs: nowMs + MCP_RUNTIME_SOURCE_DRIFT_CACHE_TTL_MS,
        value,
    };
    return value;
}
