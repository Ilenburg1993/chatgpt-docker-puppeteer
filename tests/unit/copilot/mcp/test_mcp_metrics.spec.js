// @ts-check
/** Tests for MCP runtime metrics. */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';

import { readMcpMetricsSnapshot, recordMcpToolMetric, resetMcpMetricsForTests } from '#copilot/mcp/control-plane';

beforeEach(() => {
    resetMcpMetricsForTests();
});

describe('MCP runtime metrics', () => {
    it('records per-tool phase latency without changing aggregate call metrics', () => {
        recordMcpToolMetric('repo_status', {
            durationMs: 20,
            isError: false,
            phases: {
                authorization: 2,
                handler: 15,
                auditCompletion: 1,
            },
        });
        recordMcpToolMetric('repo_status', {
            durationMs: 40,
            isError: true,
            phases: {
                authorization: 4,
                handler: 30,
                auditCompletion: 2,
            },
        });

        const snapshot = readMcpMetricsSnapshot();
        const metric = snapshot.tools['repo_status'];
        assert.equal(metric.calls, 2);
        assert.equal(metric.errors, 1);
        assert.equal(metric.averageDurationMs, 30);
        assert.equal(metric.phaseAverages['authorization'].averageDurationMs, 3);
        assert.equal(metric.phaseAverages['handler'].averageDurationMs, 23);
        assert.equal(metric.phaseAverages['auditCompletion'].averageDurationMs, 2);
    });
});
