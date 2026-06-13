// @ts-check
/**
 * End-to-end MCP workspace smoke tool.
 *
 * @module copilot/mcp/tools/smoke-workspace
 */

import { parseFileForContext } from '#copilot/infra';
import { getIoIndexStats } from '#copilot/infra/public/indexing';
import { createWorkspaceIo } from '#copilot/infra/public/workspace-io';
import { WORKSPACE_ROOT } from '#copilot/tools';
import { readCloudflareTunnelConfig, readQuickTunnelState, summarizeQuickTunnelState } from '#copilot/mcp/cloudflare';
import {
    okResult,
    readMcpMetricsSnapshot,
    readOnlyAnnotations,
    recordMcpWorkspaceSmokeSummary,
    resolveReadPath,
} from '#copilot/mcp/control-plane';
import { projectDoctorTool } from './project-doctor.js';
import { repoStatusHandler } from './repo-status.js';

const { readText, scanDirectory, searchText, searchWorkspaceSymbols, statPath } = createWorkspaceIo({
    workspaceRoot: WORKSPACE_ROOT,
});

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpSmokeWorkspaceTool = {
    name: 'mcp_smoke_workspace',
    title: 'MCP workspace smoke',
    description: 'Run a read-only end-to-end smoke suite over the workspace MCP surface.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () => {
        /** @type {{ name: string; ok: boolean; durationMs: number; detail?: Record<string, unknown> }[]} */
        const checks = [];
        /** @type {string[]} */
        const warnings = [];
        const startedAt = Date.now();

        await runCheck(checks, 'repo_status', async () => {
            const result = await repoStatusHandler();
            const dirty = result.structuredContent?.['dirty'] === true;
            if (dirty) warnings.push('WORKSPACE_DIRTY: repository has uncommitted or untracked changes.');
            return { dirty };
        });
        await runCheck(checks, 'repo_tree_default', async () => {
            const resolved = await resolveReadPath('src/copilot');
            if (!resolved.ok) throw new Error(resolved.reason);
            const scan = await scanDirectory(resolved.resolved, { workspaceRoot: WORKSPACE_ROOT, depth: 1 });
            return { entries: scan.entries.length, blockedEntries: scan.blockedEntries };
        });
        await runCheck(checks, 'repo_root_tree_redaction', async () => {
            const resolved = await resolveReadPath('.');
            if (!resolved.ok) throw new Error(resolved.reason);
            const scan = await scanDirectory(resolved.resolved, {
                workspaceRoot: WORKSPACE_ROOT,
                depth: 1,
                showHidden: true,
            });
            return { entries: scan.entries.length, blockedEntries: scan.blockedEntries };
        });
        await runCheck(checks, 'secret_read_blocked', async () => {
            const denied = await resolveReadPath('.env.local');
            if (denied.ok) throw new Error('Expected .env.local to be blocked by path policy.');
            return { code: denied.code };
        });
        await runCheck(checks, 'repo_read_file', async () => {
            const resolved = await resolveReadPath('src/copilot/mcp/README.md');
            if (!resolved.ok) throw new Error(resolved.reason);
            const snapshot = await readText(resolved.resolved, { startLine: 1, endLine: 8 });
            return { bytes: snapshot.bytesRead, sha256: snapshot.contentHash };
        });
        await runCheck(checks, 'repo_file_stats', async () => {
            const resolved = await resolveReadPath('src/copilot/mcp/README.md');
            if (!resolved.ok) throw new Error(resolved.reason);
            const snapshot = await statPath(resolved.resolved);
            return { sizeBytes: snapshot.stats.size, engine: snapshot.io.engine };
        });
        await runCheck(checks, 'repo_search_text', async () => {
            const resolved = await resolveReadPath('src/copilot/mcp');
            if (!resolved.ok) throw new Error(resolved.reason);
            const result = await searchText(resolved.resolved, {
                workspaceRoot: WORKSPACE_ROOT,
                pattern: 'registerCanonicalMcpTools',
                contextLines: 2,
                maxResults: 10,
            });
            return { returnedMatchCount: result.returnedMatchCount ?? result.matchCount };
        });
        await runCheck(checks, 'repo_find_symbol_usages', async () => {
            const resolved = await resolveReadPath('src/copilot/mcp/tools/repo-read.js');
            if (!resolved.ok) throw new Error(resolved.reason);
            const result = await searchText(resolved.resolved, {
                workspaceRoot: WORKSPACE_ROOT,
                pattern: '\\brepoReadTools\\b',
                isRegex: true,
                caseSensitive: true,
                includePattern: '*.{js,ts,mjs,cjs}',
                contextLines: 0,
                maxResults: 10,
            });
            return { matchCount: result.matchCount };
        });
        await runCheck(checks, 'repo_symbol_search', async () => {
            const resolved = await resolveReadPath('src/copilot/mcp');
            if (!resolved.ok) throw new Error(resolved.reason);
            const result = await searchWorkspaceSymbols(resolved.resolved, {
                symbolName: 'registerCanonicalMcpTools',
                maxResults: 10,
            });
            return { matchCount: result.matchCount };
        });
        await runCheck(checks, 'repo_file_outline', async () => {
            const resolved = await resolveReadPath('src/copilot/mcp/registry.js');
            if (!resolved.ok) throw new Error(resolved.reason);
            const snapshot = await readText(resolved.resolved);
            const parsed = await parseFileForContext(resolved.resolved, snapshot.content);
            return { symbols: parsed.symbols.symbols.length, exports: parsed.symbols.exports.length };
        });
        await runCheck(checks, 'repo_index_status', async () => {
            const stats = getIoIndexStats();
            if (stats.enabled !== false && stats.available !== true) {
                warnings.push('INDEX_UNAVAILABLE: shared IO index is enabled but not available.');
            }
            return {
                enabled: stats.enabled,
                available: stats.available,
                files: 'files' in stats ? stats.files : 0,
            };
        });
        await runCheck(checks, 'project_doctor', async () => {
            const result = await projectDoctorTool.handler({ includeScripts: false });
            return { success: result.structuredContent?.['success'] === true };
        });
        await runCheck(checks, 'mcp_runtime_health', async () => {
            const metrics = readMcpMetricsSnapshot();
            const tunnelConfig = readCloudflareTunnelConfig();
            const tunnelState = await readQuickTunnelState(tunnelConfig.stateFile);
            const tunnel = summarizeQuickTunnelState(tunnelState, Date.now(), tunnelConfig.staleAfterMs);
            if (tunnelConfig.mode === 'temporary-quick' && tunnel.stale) {
                warnings.push('Temporary Cloudflare tunnel is stale.');
            }
            if (tunnel.lastSmokeOk === false) warnings.push('Last Cloudflare smoke failed.');
            return {
                metricsCalls: metrics.totals.calls,
                tunnelMode: tunnelConfig.mode,
                publicMcpUrl: tunnelConfig.publicMcpUrl ?? tunnel.connectorUrl ?? null,
                tunnelAction: tunnelConfig.mode === 'named-permanent' ? 'use-permanent-hostname' : tunnel.recommendedAction,
            };
        });

        const durationMs = Date.now() - startedAt;
        const failed = checks.filter((check) => !check.ok);
        const status = failed.length > 0 ? 'failed' : warnings.length > 0 ? 'degraded' : 'ok';
        const structured = {
            success: failed.length === 0,
            status,
            durationMs,
            checks,
            warnings,
            critical: failed.map((check) => check.name),
        };
        recordMcpWorkspaceSmokeSummary({
            checkedAt: new Date().toISOString(),
            success: structured.success,
            status,
            durationMs,
            checkCount: checks.length,
            failedChecks: failed.map((check) => check.name),
            warningCount: warnings.length,
            criticalCount: failed.length,
        });
        return okResult(structured);
    },
};

/**
 * @param {{ name: string; ok: boolean; durationMs: number; detail?: Record<string, unknown> }[]} checks
 * @param {string} name
 * @param {() => Promise<Record<string, unknown>>} fn
 * @returns {Promise<void>}
 */
async function runCheck(checks, name, fn) {
    const startedAt = Date.now();
    try {
        const detail = await fn();
        checks.push({ name, ok: true, durationMs: Date.now() - startedAt, detail });
    } catch (error) {
        checks.push({
            name,
            ok: false,
            durationMs: Date.now() - startedAt,
            detail: { error: error instanceof Error ? error.message : String(error) },
        });
    }
}
