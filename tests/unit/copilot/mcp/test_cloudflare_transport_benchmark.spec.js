// @ts-check
/** Tests for Cloudflare transport benchmark planning. */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';

import { buildCloudflareTransportBenchmarkPlan } from '#copilot/mcp/tools/cloudflare-transport-benchmark.js';

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
        const candidates = /** @type {{ protocol: string; role: string }[]} */ (plan['candidates']);
        const benchmarkDesign = /** @type {{ manualProtocolSwitch: { env: string } }} */ (plan['benchmarkDesign']);
        const decisionPolicy = /** @type {{ keepQuicWhen: string[] }} */ (plan['decisionPolicy']);
        const nextActions = /** @type {string[]} */ (plan['nextActions']);

        assert.equal(plan.current.transportProtocol, 'quic');
        assert.equal(candidates.find((candidate) => candidate.protocol === 'quic')?.role, 'control-current');
        assert.equal(candidates.find((candidate) => candidate.protocol === 'http2')?.role, 'tcp-rollback-candidate');
        assert.equal(candidates.find((candidate) => candidate.protocol === 'auto')?.role, 'fallback-capable-candidate');
        assert.equal(benchmarkDesign.manualProtocolSwitch.env, 'COPILOT_MCP_CLOUDFLARE_PROTOCOL or TUNNEL_TRANSPORT_PROTOCOL');
        assert.ok(decisionPolicy.keepQuicWhen.includes('Cloudflare QUIC metrics remain present after restart'));
        assert.ok(nextActions.some((action) => action.includes('Keep QUIC as the current control')));
    });
});

function restoreEnv(name, value) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
}
