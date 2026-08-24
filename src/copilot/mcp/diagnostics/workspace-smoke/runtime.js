// @ts-check
/**
 * Read-only end-to-end MCP workspace smoke operation.
 *
 * The operation returns domain data. It intentionally does not call any MCP wire-tool handler, so startup maintenance,
 * autonomous diagnostics and the mcp_smoke_workspace adapter all share one implementation without reversing the
 * dependency direction from runtime into tools.
 *
 * @module copilot/mcp/diagnostics/workspace-smoke/runtime
 */

import { readCloudflareTunnelConfig } from '#copilot/mcp/public/cloudflare/config';
import { createCloudflareStateStore, summarizeQuickTunnelState } from '#copilot/mcp/public/cloudflare/state';
import { readMcpProjectDoctor } from '#copilot/mcp/public/diagnostics/project-doctor';
import { readMcpMetricsSnapshot } from '#copilot/mcp/public/observability';
import { readRepositoryStatus } from '#copilot/mcp/public/workspace/repository/status';
import { recordMcpWorkspaceSmokeSummary } from './state.js';

/**
 * @returns {Promise<{
 *     success: boolean;
 *     status: 'failed'|'degraded'|'ok';
 *     durationMs: number;
 *     checks: { name: string; ok: boolean; durationMs: number; detail?: Record<string, unknown> }[];
 *     warnings: string[];
 *     critical: string[];
 * }>}
 * @param {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} workspace
 */
export async function runMcpWorkspaceSmoke(workspace) {
    if (!workspace) throw new TypeError('Workspace smoke requires a workspace capability.');
    const workspaceRoot = workspace.workspaceRoot;
    const readIoIndexStatus = workspace.indexRegistry.status;
    const { readTextValidated, statPathValidated } = workspace.io;
    const { parseFileForContext, scanDirectoryValidated, searchTextValidated, searchWorkspaceSymbolsValidated } =
        workspace.indexing;
    /** @type {{ name: string; ok: boolean; durationMs: number; detail?: Record<string, unknown> }[]} */
    const checks = [];
    /** @type {string[]} */
    const warnings = [];
    const startedAt = Date.now();

    await runCheck(checks, 'repo_status', async () => {
        const result = await readRepositoryStatus({ workspaceRoot });
        if (!result.success) throw new Error(result.error);
        if (result.dirty) warnings.push('WORKSPACE_DIRTY: repository has uncommitted or untracked changes.');
        return { dirty: result.dirty };
    });
    await runCheck(checks, 'repo_tree_default', async () => {
        const resolved = await workspace.resolveValidatedReadPath('src/copilot');
        if (!resolved.ok) throw new Error(resolved.reason);
        const scan = await scanDirectoryValidated(resolved.validatedReadPath, { depth: 1 });
        return { entries: scan.entries.length, blockedEntries: scan.blockedEntries };
    });
    await runCheck(checks, 'repo_root_tree_redaction', async () => {
        const resolved = await workspace.resolveValidatedReadPath('.');
        if (!resolved.ok) throw new Error(resolved.reason);
        const scan = await scanDirectoryValidated(resolved.validatedReadPath, { depth: 1, showHidden: true });
        return { entries: scan.entries.length, blockedEntries: scan.blockedEntries };
    });
    await runCheck(checks, 'secret_read_blocked', async () => {
        const denied = await workspace.resolveReadPath('.env.local');
        if (denied.ok) throw new Error('Expected .env.local to be blocked by path policy.');
        return { code: denied.code };
    });
    await runCheck(checks, 'repo_read_file', async () => {
        const resolved = await workspace.resolveValidatedReadPath('src/copilot/mcp/README.md');
        if (!resolved.ok) throw new Error(resolved.reason);
        const snapshot = await readTextValidated(resolved.validatedReadPath, { startLine: 1, endLine: 8 });
        return { bytes: snapshot.bytesRead, sha256: snapshot.contentHash };
    });
    await runCheck(checks, 'repo_file_stats', async () => {
        const resolved = await workspace.resolveValidatedReadPath('src/copilot/mcp/README.md');
        if (!resolved.ok) throw new Error(resolved.reason);
        const snapshot = await statPathValidated(resolved.validatedReadPath);
        return { sizeBytes: snapshot.stats.size, engine: snapshot.io.engine };
    });
    await runCheck(checks, 'repo_search_text', async () => {
        const resolved = await workspace.resolveValidatedReadPath('src/copilot/mcp');
        if (!resolved.ok) throw new Error(resolved.reason);
        const result = await searchTextValidated(resolved.validatedReadPath, {
            workspaceRoot,
            pattern: 'registerCanonicalMcpTools',
            contextLines: 2,
            maxResults: 10,
        });
        return { returnedMatchCount: result.returnedMatchCount ?? result.matchCount };
    });
    await runCheck(checks, 'repo_find_symbol_usages', async () => {
        const resolved = await workspace.resolveValidatedReadPath('src/copilot/mcp/tools/repo-read.js');
        if (!resolved.ok) throw new Error(resolved.reason);
        const result = await searchTextValidated(resolved.validatedReadPath, {
            workspaceRoot,
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
        const resolved = await workspace.resolveValidatedReadPath('src/copilot/mcp');
        if (!resolved.ok) throw new Error(resolved.reason);
        const result = await searchWorkspaceSymbolsValidated(resolved.validatedReadPath, {
            symbolName: 'registerCanonicalMcpTools',
            maxResults: 10,
        });
        return { matchCount: result.matchCount };
    });
    await runCheck(checks, 'repo_file_outline', async () => {
        const resolved = await workspace.resolveValidatedReadPath('src/copilot/mcp/registry/runtime.js');
        if (!resolved.ok) throw new Error(resolved.reason);
        const snapshot = await readTextValidated(resolved.validatedReadPath);
        const parsed = await parseFileForContext(resolved.resolved, snapshot.content, {
            ...(typeof snapshot.contentHash === 'string' ? { contentHash: snapshot.contentHash } : {}),
        });
        return { symbols: parsed.symbols.symbols.length, exports: parsed.symbols.exports.length };
    });
    await runCheck(checks, 'repo_index_status', async () => {
        const stats = readIoIndexStatus();
        if (stats.enabled !== false && stats.available !== true) {
            warnings.push('INDEX_UNAVAILABLE: shared IO index is enabled but not available.');
        }
        return {
            enabled: stats.enabled,
            available: stats.available,
            files: 'files' in stats ? stats.files : 0,
        };
    });
    await runCheck(checks, 'project_doctor', async () => ({
        success: (await readMcpProjectDoctor(workspace, { includeScripts: false })).success,
    }));
    await runCheck(checks, 'mcp_runtime_health', async () => {
        const metrics = readMcpMetricsSnapshot();
        const tunnelConfig = readCloudflareTunnelConfig();
        const tunnelState = await createCloudflareStateStore(tunnelConfig).readQuickTunnelState();
        const tunnel = summarizeQuickTunnelState(tunnelState, Date.now(), tunnelConfig.staleAfterMs);
        if (tunnelConfig.mode === 'temporary-quick' && tunnel.stale)
            warnings.push('Temporary Cloudflare tunnel is stale.');
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
    const status = /** @type {'failed'|'degraded'|'ok'} */ (
        failed.length > 0 ? 'failed' : warnings.length > 0 ? 'degraded' : 'ok'
    );
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
    return structured;
}

/**
 * @param {{ name: string; ok: boolean; durationMs: number; detail?: Record<string, unknown> }[]} checks
 * @param {string} name
 * @param {() => Promise<Record<string, unknown>>} fn
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
