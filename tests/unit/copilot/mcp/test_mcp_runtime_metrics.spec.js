// @ts-check
/**
 * Tests for MCP runtime metrics.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';

import {
    readMcpIndexAutoBuildConfig,
    resetMcpIndexAutoBuildStateForTests,
} from '../../../../src/copilot/mcp/control-plane/index-auto-build.js';
import {
    readMcpMetricsSnapshot,
    recordMcpToolMetric,
    resetMcpMetricsForTests,
} from '../../../../src/copilot/mcp/control-plane/metrics.js';
import { resetMcpWorkspaceSmokeSummaryForTests } from '../../../../src/copilot/mcp/control-plane/smoke-state.js';
import { mcpRuntimeHealthTool } from '../../../../src/copilot/mcp/tools/runtime-health.js';

describe('copilot MCP runtime metrics', () => {
    beforeEach(() => {
        resetMcpMetricsForTests();
        resetMcpIndexAutoBuildStateForTests();
        resetMcpWorkspaceSmokeSummaryForTests();
    });

    it('records per-tool call counts, errors and average duration', () => {
        recordMcpToolMetric('repo_status', { durationMs: 10, isError: false });
        recordMcpToolMetric('repo_status', { durationMs: 20, isError: true });

        const snapshot = readMcpMetricsSnapshot();

        assert.equal(snapshot.totals.calls, 2);
        assert.equal(snapshot.totals.errors, 1);
        assert.equal(snapshot.tools.repo_status.calls, 2);
        assert.equal(snapshot.tools.repo_status.errors, 1);
        assert.equal(snapshot.tools.repo_status.averageDurationMs, 15);
    });

    it('exposes metrics through mcp_runtime_health', async () => {
        recordMcpToolMetric('git_status', { durationMs: 5, isError: false });

        const result = await mcpRuntimeHealthTool.handler({});

        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent.success, true);
        assert.equal(result.structuredContent.ok, true);
        assert.equal(typeof result.structuredContent.workspaceRoot, 'string');
        assert.ok(result.structuredContent.operationalSignals);
        assert.ok(result.structuredContent.operationalSignals.indexAutoBuild);
        assert.ok(result.structuredContent.indexStats);
        assert.equal(/** @type {{ totals: { calls: number } }} */ (result.structuredContent.metrics).totals.calls, 1);
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
