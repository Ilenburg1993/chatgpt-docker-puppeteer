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

    it('bounds dynamic tool and phase cardinality and safely handles special keys', () => {
        for (let index = 0; index < 1100; index += 1) {
            recordMcpToolMetric(`dynamic_${index}`, {
                durationMs: index,
                isError: false,
            });
        }
        recordMcpToolMetric('__proto__', {
            durationMs: 1,
            isError: false,
            phases: Object.fromEntries([
                ...Array.from({ length: 70 }, (_, index) => [`phase_${index}`, index]),
                ['__proto__', 1],
            ]),
        });

        const snapshot = readMcpMetricsSnapshot();
        assert.equal(snapshot.totals.tools, 1000);
        assert.equal(snapshot.tools['dynamic_0'], undefined);
        assert.equal(snapshot.tools['__proto__'].calls, 1);
        assert.equal(Object.keys(snapshot.tools['__proto__'].phaseAverages).length, 64);
        assert.equal(snapshot.tools['__proto__'].phaseAverages['__proto__'].calls, 1);
    });
});
