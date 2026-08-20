// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { summarizeClientLatencyEvidence, summarizeClientLatencyNumbers } from '#copilot/mcp/control-plane';

/**
 * @param {string} sampleId
 * @param {import('../../../../src/copilot/mcp/control-plane/client-latency-evidence.js').ClientThinkingMode} thinkingMode
 * @param {number} ttftMs
 * @param {Partial<import('../../../../src/copilot/mcp/control-plane/client-latency-evidence.js').ClientLatencyEvidenceEntry>} [extra]
 * @returns {import('../../../../src/copilot/mcp/control-plane/client-latency-evidence.js').ClientLatencyEvidenceEntry}
 */
function row(sampleId, thinkingMode, ttftMs, extra = {}) {
    return {
        schemaVersion: 1,
        sampleId,
        recordedAt: '2026-08-18T21:00:00.000Z',
        observedAt: '2026-08-18T21:00:00.000Z',
        source: 'manual',
        ttftMs,
        firstToolDispatchMs: null,
        turnCompleteMs: null,
        conditions: {
            thinkingMode,
            modelLabel: 'gpt-5.6-sol',
            networkLabel: 'wifi-home',
            conversationLabel: 'long-chat',
            clientLabel: 'desktop',
            vpnLabel: 'off',
            seriesId: 'ttft-ab',
        },
        ...extra,
    };
}

describe('client latency evidence', () => {
    it('keeps null timings out of percentile samples', () => {
        assert.deepEqual(summarizeClientLatencyNumbers([100, null, 200, undefined, 300]), {
            count: 3,
            averageMs: 200,
            p25Ms: 100,
            p50Ms: 200,
            p95Ms: 300,
            minMs: 100,
            maxMs: 300,
        });
    });

    it('summarizes TTFT by thinking mode and computes a directional high-vs-medium comparison', () => {
        const entries = [
            row('h1', 'high', 7000),
            row('h2', 'high', 6500),
            row('h3', 'high', 7200),
            row('h4', 'high', 6800),
            row('h5', 'high', 7100),
            row('m1', 'medium', 5000),
            row('m2', 'medium', 5200),
            row('m3', 'medium', 5100),
            row('m4', 'medium', 5300),
            row('m5', 'medium', 5400),
        ];
        const summary = summarizeClientLatencyEvidence(entries);
        assert.equal(summary.overall.count, 10);
        assert.equal(summary.thinkingHighVsMedium.highCount, 5);
        assert.equal(summary.thinkingHighVsMedium.mediumCount, 5);
        assert.equal(summary.thinkingHighVsMedium.highP50Ms, 7000);
        assert.equal(summary.thinkingHighVsMedium.mediumP50Ms, 5200);
        assert.equal(summary.thinkingHighVsMedium.deltaMs, 1800);
        assert.equal(summary.thinkingHighVsMedium.sufficientForDirectionalComparison, true);
        assert.ok((summary.thinkingHighVsMedium.ratio ?? 0) > 1.3);
    });

    it('does not claim a sufficient comparison with sparse evidence', () => {
        const summary = summarizeClientLatencyEvidence([row('h1', 'high', 7000), row('m1', 'medium', 5000)]);
        assert.equal(summary.thinkingHighVsMedium.sufficientForDirectionalComparison, false);
    });
});
