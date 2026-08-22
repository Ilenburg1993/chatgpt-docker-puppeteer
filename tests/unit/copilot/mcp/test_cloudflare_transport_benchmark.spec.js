// @ts-check
/** Tests for Cloudflare transport benchmark planning. */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';

import {
    buildCloudflareTransportBenchmarkPlan,
    summarizePersistedBenchmarkState,
} from '#copilot/testing/mcp/tools/cloudflare-transport-benchmark';

const previousProtocol = process.env['COPILOT_MCP_CLOUDFLARE_PROTOCOL'];
const previousTunnelProtocol = process.env['TUNNEL_TRANSPORT_PROTOCOL'];

afterEach(() => {
    restoreEnv('COPILOT_MCP_CLOUDFLARE_PROTOCOL', previousProtocol);
    restoreEnv('TUNNEL_TRANSPORT_PROTOCOL', previousTunnelProtocol);
});

describe('Cloudflare transport benchmark plan', () => {
    it('classifies HTTP/2 as rollback and QUIC as current control after strict QUIC promotion', async () => {
        process.env['COPILOT_MCP_CLOUDFLARE_PROTOCOL'] = 'quic';
        restoreEnv('TUNNEL_TRANSPORT_PROTOCOL', undefined);

        const plan = await buildCloudflareTransportBenchmarkPlan();
        const candidates = /** @type {{ protocol: string; role: string; recommendation: string; risk: string }[]} */ (
            plan['candidates']
        );
        const benchmarkDesign = /** @type {{
    sampleMetric: string;
    delegatedExecution: { mission: string; stateFile: string; autoPromotion: boolean };
    manualFallback: { env: string };
}} */ (plan['benchmarkDesign']);
        const decisionPolicy = /** @type {{ keepQuicWhen: string[] }} */ (plan['decisionPolicy']);
        const nextActions = /** @type {string[]} */ (plan['nextActions']);

        const current = /** @type {{ transportProtocol: string }} */ (plan['current']);
        assert.equal(current.transportProtocol, 'quic');
        assert.equal(candidates.find((candidate) => candidate.protocol === 'quic')?.role, 'control-current');
        const http2 = candidates.find((candidate) => candidate.protocol === 'http2');
        assert.equal(http2?.role, 'tcp-rollback-candidate');
        assert.match(http2?.recommendation ?? '', /TCP rollback\/baseline/u);
        assert.match(http2?.risk ?? '', /canonical TCP rollback baseline/u);
        assert.doesNotMatch(http2?.recommendation ?? '', /Unsupported candidate/u);
        assert.equal(candidates.find((candidate) => candidate.protocol === 'auto')?.role, 'fallback-capable-candidate');
        assert.match(benchmarkDesign.sampleMetric, /wall-clock duration/u);
        assert.equal(benchmarkDesign.delegatedExecution.mission, 'benchmark-transport');
        assert.equal(benchmarkDesign.delegatedExecution.autoPromotion, false);
        assert.equal(
            benchmarkDesign.delegatedExecution.stateFile,
            'src/copilot/.ai/mcp/transport-benchmark-state.json',
        );
        assert.equal(
            benchmarkDesign.manualFallback.env,
            'COPILOT_MCP_CLOUDFLARE_PROTOCOL or TUNNEL_TRANSPORT_PROTOCOL',
        );
        assert.ok(decisionPolicy.keepQuicWhen.includes('Cloudflare QUIC metrics remain present after restart'));
        assert.ok(nextActions.some((action) => action.includes('mission=benchmark-transport')));
        assert.ok(nextActions.some((action) => action.includes('Keep QUIC as the current control')));
    });

    it('compacts persisted benchmark evidence without returning individual smoke-run records', () => {
        const summary = summarizePersistedBenchmarkState({
            schemaVersion: 1,
            status: 'completed',
            requestId: 'mcp-transport-benchmark-example',
            controlProfile: 'quic',
            sampleCountPerProfile: 5,
            restoredControl: true,
            autoPromotion: false,
            windows: [
                {
                    profile: 'quic',
                    smokeRuns: [{ sample: 1, durationMs: 1000 }],
                    smokeLatency: { count: 5, p95Ms: 1100 },
                    metricDelta: { requestErrors: 0 },
                    allSmokesPassed: true,
                    comparable: true,
                    clean: true,
                    reviewRequired: false,
                },
            ],
        });

        assert.equal(summary?.['status'], 'completed');
        assert.equal(summary?.['restoredControl'], true);
        const windows = /** @type {Record<string, unknown>[]} */ (summary?.['windows']);
        assert.equal(windows.length, 1);
        assert.equal(windows[0]?.['profile'], 'quic');
        assert.equal('smokeRuns' in (windows[0] ?? {}), false);
    });
});

/** @param {string} name @param {string | undefined} value */
function restoreEnv(name, value) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
}
