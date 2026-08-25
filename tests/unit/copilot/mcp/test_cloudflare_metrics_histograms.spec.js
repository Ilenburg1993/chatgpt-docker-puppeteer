// @ts-check
/** Cloudflared metrics histogram helpers. */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { summarizeCloudflaredLatencyHistograms } from '#copilot/mcp/public/cloudflare/observability';

describe('cloudflared metrics histograms', () => {
    it('uses the histogram count total instead of the last finite bucket', () => {
        const summary = summarizeCloudflaredLatencyHistograms([
            { name: 'cloudflared_rpc_client_latency_secs_bucket', labels: { le: '0.1' }, value: 10 },
            { name: 'cloudflared_rpc_client_latency_secs_bucket', labels: { le: '0.5' }, value: 90 },
            { name: 'cloudflared_rpc_client_latency_secs_bucket', labels: { le: '+Inf' }, value: 100 },
            { name: 'cloudflared_rpc_client_latency_secs_count', labels: {}, value: 100 },
            { name: 'cloudflared_rpc_client_latency_secs_sum', labels: {}, value: 20 },
        ]);

        const rpc = /** @type {{
    count: number;
    averageMs: number;
    p95Ms: number;
    finiteBucketCoverage: number;
    hasInfiniteBucket: boolean;
}} */ (summary['rpcClientLatency']);
        assert.equal(rpc.count, 100);
        assert.equal(rpc.averageMs, 200);
        assert.equal(rpc.p95Ms, 500);
        assert.equal(rpc.finiteBucketCoverage, 0.9);
        assert.equal(rpc.hasInfiniteBucket, true);
    });
});
