// @ts-check
/**
 * Tests for MCP runtime metrics.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';

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
        assert.ok(result.structuredContent.indexStats);
        assert.equal(/** @type {{ totals: { calls: number } }} */ (result.structuredContent.metrics).totals.calls, 1);
    });
});
