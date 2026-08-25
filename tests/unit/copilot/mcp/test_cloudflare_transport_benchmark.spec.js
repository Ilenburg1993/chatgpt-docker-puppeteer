// @ts-check
/** Tests for Cloudflare transport benchmark planning. */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'vitest';

import { readCloudflareTunnelConfig } from '#copilot/mcp/public/cloudflare/config';
import {
    buildCloudflareTransportBenchmarkPlan,
    spawnCloudflareTransportBenchmarkWithDependencies,
    summarizePersistedBenchmarkState,
} from '#copilot/testing/mcp/cloudflare/transport-benchmark';

describe('Cloudflare transport benchmark plan', () => {
    it('classifies HTTP/2 as rollback and QUIC as current control after strict QUIC promotion', async () => {
        const config = readCloudflareTunnelConfig({
            COPILOT_MCP_CLOUDFLARE_PROTOCOL: 'quic',
            COPILOT_MCP_CLOUDFLARE_MODE: 'named-permanent',
            COPILOT_MCP_CLOUDFLARE_ZONE: 'example.com',
            COPILOT_MCP_CLOUDFLARE_PUBLIC_HOSTNAME: 'mcp.example.com',
            COPILOT_MCP_CLOUDFLARE_PUBLIC_URL: 'https://mcp.example.com/mcp',
        });
        const plan = await buildCloudflareTransportBenchmarkPlan({}, config);
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

    it('kills and observes close when caller cancellation wins before detached benchmark acceptance', async () => {
        class FakeChild extends EventEmitter {
            pid = 43210;
            killed = false;
            unrefCalled = false;
            unref() {
                this.unrefCalled = true;
            }
            /** @param {NodeJS.Signals} _signal */
            kill(_signal) {
                this.killed = true;
                queueMicrotask(() => this.emit('close', null, 'SIGTERM'));
                return true;
            }
        }
        const child = new FakeChild();
        const controller = new AbortController();
        const pending = spawnCloudflareTransportBenchmarkWithDependencies(
            {
                requestId: 'mcp-transport-benchmark-12345678',
                controlProfile: 'quic',
                parentEnv: {},
                signal: controller.signal,
            },
            { spawnChild: /** @type {typeof import('node:child_process').spawn} */ (() => /** @type {any} */ (child)) },
        );
        controller.abort(new Error('cancel-before-acceptance'));
        queueMicrotask(() => child.emit('spawn'));
        await assert.rejects(pending, /cancel-before-acceptance/u);
        assert.equal(child.killed, true);
        assert.equal(child.unrefCalled, false);
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
