// @ts-check
/**
 * Tests for MCP runtime metrics.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';

import {
    readMcpIndexAutoBuildConfig,
    readMcpMetricsSnapshot,
    recordMcpToolMetric,
    resetMcpIndexAutoBuildStateForTests,
    resetMcpMetricsForTests,
    resetMcpStartupMaintenanceForTests,
    resetMcpWorkspaceSmokeSummaryForTests,
} from '#copilot/mcp/control-plane';
import { mcpRuntimeHealthTool } from '#copilot/mcp/tools';

describe('copilot MCP runtime metrics', () => {
    beforeEach(() => {
        resetMcpMetricsForTests();
        resetMcpIndexAutoBuildStateForTests();
        resetMcpStartupMaintenanceForTests();
        resetMcpWorkspaceSmokeSummaryForTests();
    });

    it('records per-tool call counts, errors and average duration', () => {
        recordMcpToolMetric('repo_status', { durationMs: 10, isError: false });
        recordMcpToolMetric('repo_status', { durationMs: 20, isError: true });

        const snapshot = readMcpMetricsSnapshot();

        assert.equal(snapshot.totals.calls, 2);
        assert.equal(snapshot.totals.errors, 1);
        const repoStatus = snapshot.tools['repo_status'];
        assert.ok(repoStatus);
        assert.equal(repoStatus.calls, 2);
        assert.equal(repoStatus.errors, 1);
        assert.equal(repoStatus.averageDurationMs, 15);
    });

    it('records logical-operation compression separately from MCP call count', () => {
        recordMcpToolMetric('repo_read_file', {
            durationMs: 12,
            isError: false,
            execution: {
                logicalOperations: 12,
                failedOperations: 1,
                skippedOperations: 0,
                mode: 'read-batch:best-effort',
            },
        });
        recordMcpToolMetric('repo_status', { durationMs: 3, isError: false });

        const snapshot = readMcpMetricsSnapshot();
        const batch = snapshot.tools['repo_read_file'];
        const single = snapshot.tools['repo_status'];
        assert.ok(batch);
        assert.ok(single);
        assert.deepEqual(batch.execution, {
            batchCalls: 1,
            logicalOperations: 12,
            failedOperations: 1,
            skippedOperations: 0,
            lastLogicalOperations: 12,
            lastMode: 'read-batch:best-effort',
        });
        assert.equal(single.execution.logicalOperations, 1);
        assert.equal(single.execution.batchCalls, 0);
    });

    it('records per-tool phase averages', () => {
        recordMcpToolMetric('repo_status', {
            durationMs: 10,
            isError: false,
            phases: { authorization: 2, handler: 8 },
        });
        recordMcpToolMetric('repo_status', {
            durationMs: 30,
            isError: true,
            phases: { authorization: 4, handler: 26, invalid: Number.NaN },
        });

        const snapshot = readMcpMetricsSnapshot();
        const repoStatus = snapshot.tools['repo_status'];

        assert.ok(repoStatus);
        assert.deepEqual(repoStatus.phaseAverages['authorization'], {
            calls: 2,
            totalDurationMs: 6,
            lastDurationMs: 4,
            averageDurationMs: 3,
        });
        assert.deepEqual(repoStatus.phaseAverages['handler'], {
            calls: 2,
            totalDurationMs: 34,
            lastDurationMs: 26,
            averageDurationMs: 17,
        });
        assert.equal(repoStatus.phaseAverages['invalid'], undefined);
    });

    it('exposes metrics through mcp_runtime_health', async () => {
        recordMcpToolMetric('git_status', {
            durationMs: 5,
            isError: false,
            phases: { authorization: 1, handler: 4 },
        });
        recordMcpToolMetric('repo_status', {
            durationMs: 10,
            isError: false,
            phases: { authorization: 2, handler: 8 },
        });

        const result = await mcpRuntimeHealthTool.handler({});

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent.success, true);
        assert.equal(result.structuredContent.ok, true);
        assert.equal(typeof result.structuredContent.workspaceRoot, 'string');
        assert.ok(result.structuredContent.operationalSignals);
        assert.ok(result.structuredContent.operationalSignals.indexAutoBuild);
        assert.equal(typeof result.structuredContent.operationalSignals.nodeRuntime?.nodeVersion, 'string');
        assert.equal(
            typeof result.structuredContent.operationalSignals.nodeRuntime?.compileCache?.enabled,
            'boolean',
        );
        assert.equal(
            typeof result.structuredContent.operationalSignals.nodeRuntime?.compileCache?.directoryKnown,
            'boolean',
        );
        assert.deepEqual(result.structuredContent.operationalSignals.startupMaintenance, {
            scheduled: false,
            running: false,
            completed: false,
            scheduledAt: null,
            startedAt: null,
            completedAt: null,
            success: null,
            error: null,
            staleQuickTunnelStateRemoved: false,
            detachedLiveRunsReaped: 0,
            detachedLiveRunReaperFailures: 0,
        });
        assert.ok(result.structuredContent.indexStats);
        const metrics = /** @type {{
            totals: { calls: number };
            phaseTotals: Record<string, { calls: number; totalDurationMs: number; averageMs: number | null }>;
            slowestTool: { name: string; calls: number; averageMs: number | null } | null;
            slowestPhase: { tool: string; phase: string; calls: number; averageMs: number | null } | null;
            ioCache?: {
                l1?: Record<string, unknown>;
                coherence?: Record<string, unknown>;
                validatedReadPath?: Record<string, unknown>;
                validatedMutablePath?: Record<string, unknown>;
            };
            ioCachePlan?: { l2Decision?: string; recommendationCount?: number };
            ioParser?: {
                fileContextSize?: number;
                fileContextHashComputations?: number;
                fileContextHashReuses?: number;
                workerFailures?: number;
            };
            aiArtifacts?: { jobs?: Record<string, unknown>; rollback?: Record<string, unknown> };
        }} */ (result.structuredContent.metrics);
        assert.equal(metrics.totals.calls, 2);
        assert.equal(typeof metrics.ioCache?.l1?.['size'], 'number');
        assert.equal(typeof metrics.ioCache?.coherence?.['gapDetections'], 'number');
        assert.equal(typeof metrics.ioCache?.validatedMutablePath?.['accepted'], 'number');
        assert.ok(metrics.ioCachePlan);
        assert.equal(typeof metrics.ioCachePlan?.l2Decision, 'string');
        assert.equal(typeof metrics.ioCachePlan?.recommendationCount, 'number');
        assert.equal(typeof metrics.ioParser?.fileContextSize, 'number');
        assert.equal(typeof metrics.ioParser?.fileContextHashComputations, 'number');
        assert.equal(typeof metrics.ioParser?.fileContextHashReuses, 'number');
        assert.equal(typeof metrics.ioParser?.workerFailures, 'number');
        assert.equal(typeof metrics.aiArtifacts?.jobs?.['cleanupCandidateCount'], 'number');
        assert.equal(typeof metrics.aiArtifacts?.rollback?.['enabled'], 'boolean');
        assert.deepEqual(Object.keys(metrics.phaseTotals), ['handler', 'authorization']);
        assert.deepEqual(metrics.phaseTotals['handler'], {
            calls: 2,
            totalDurationMs: 12,
            averageMs: 6,
        });
        assert.deepEqual(metrics.phaseTotals['authorization'], {
            calls: 2,
            totalDurationMs: 3,
            averageMs: 2,
        });
        assert.deepEqual(metrics.slowestPhase, {
            tool: 'repo_status',
            phase: 'handler',
            calls: 1,
            averageMs: 8,
            lastMs: 8,
        });
        assert.equal(metrics.slowestTool?.name, 'repo_status');
        assert.equal(result.structuredContent.metrics?.['slowestTools'], undefined);
        assert.equal(result.structuredContent.metrics?.['slowestPhases'], undefined);
        assert.equal(result.structuredContent.metrics?.['ioCacheBenchmark'], undefined);
        assert.ok(Buffer.byteLength(JSON.stringify(result.structuredContent)) < 6 * 1024);

        const detailed = await mcpRuntimeHealthTool.handler({ includeDetails: true });
        assert.equal(detailed.isError, undefined);
        assert.equal(detailed.structuredContent?.['detailsAvailable'], undefined);
        const detailedMetrics = /** @type {Record<string, unknown>} */ (detailed.structuredContent?.['metrics']);
        assert.equal(typeof detailedMetrics['tools'], 'object');
        assert.equal(typeof detailedMetrics['ioCache'], 'object');
    });

    it('parses MCP index auto-build environment limits', () => {
        const config = readMcpIndexAutoBuildConfig({
            COPILOT_MCP_INDEX_AUTO_BUILD: 'true',
            COPILOT_MCP_INDEX_AUTO_BUILD_PATH: 'src/copilot/mcp',
            COPILOT_MCP_INDEX_AUTO_BUILD_MAX_FILES: '42',
            COPILOT_MCP_INDEX_AUTO_BUILD_DEPTH: '9',
            COPILOT_MCP_INDEX_AUTO_BUILD_CONCURRENCY: '3',
            COPILOT_MCP_INDEX_AUTO_BUILD_IGNORE_GITIGNORE: '1',
        });

        assert.equal(config.enabled, true);
        assert.equal(config.path, 'src/copilot/mcp');
        assert.equal(config.maxFiles, 42);
        assert.equal(config.depth, 9);
        assert.equal(config.concurrency, 3);
        assert.equal(config.respectGitignore, false);
    });
});
