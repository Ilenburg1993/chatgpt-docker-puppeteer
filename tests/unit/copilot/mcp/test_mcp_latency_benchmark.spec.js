// @ts-check
/**
 * Tests for MCP latency benchmark helpers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { summarizeLatency } from '#copilot/mcp/scripts';

describe('MCP latency benchmark helpers', () => {
    it('summarizes successful latency samples with stable percentiles', () => {
        const summary = summarizeLatency([
            { ok: true, status: 200, durationMs: 10 },
            { ok: true, status: 200, durationMs: 20 },
            { ok: true, status: 200, durationMs: 30 },
            { ok: true, status: 200, durationMs: 40 },
            { ok: true, status: 200, durationMs: 50 },
        ]);

        assert.deepEqual(summary, {
            count: 5,
            ok: 5,
            failed: 0,
            minMs: 10,
            p50Ms: 30,
            p95Ms: 50,
            p99Ms: 50,
            maxMs: 50,
            averageMs: 30,
        });
    });

    it('keeps failures out of latency quantiles while reporting failure count', () => {
        const summary = summarizeLatency([
            { ok: false, durationMs: 100, error: 'timeout' },
            { ok: true, status: 200, durationMs: 20 },
            { ok: true, status: 200, durationMs: 40 },
        ]);

        assert.equal(summary.count, 3);
        assert.equal(summary.ok, 2);
        assert.equal(summary.failed, 1);
        assert.equal(summary.averageMs, 30);
        assert.equal(summary.p95Ms, 40);
    });
});
