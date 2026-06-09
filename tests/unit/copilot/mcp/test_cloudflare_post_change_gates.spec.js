// @ts-check
/** Tests for Cloudflare post-change gate evaluation. */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { evaluateGates } from '#copilot/mcp/tools/cloudflare-post-change-gates.js';

describe('Cloudflare post-change gates', () => {
    it('requires QUIC metrics when strict QUIC transport is active', () => {
        const result = evaluateGates({
            tunnelStatus: {
                success: true,
                permanentTunnel: {
                    transportProtocol: 'quic',
                    lastSmokeFresh: true,
                    lastSmoke: { checkedAt: '2026-06-09T10:00:00.000Z' },
                    originDiagnostics: { recentOriginErrors: [] },
                },
            },
            remoteAudit: {
                ok: true,
                remote: { connections: { active: 4 } },
            },
            metrics: {
                ok: true,
                operational: { requestErrorRate: 0, haConnections: 4 },
                latency: { rpcClientLatency: { p95Ms: 100 } },
                quic: { present: false },
            },
        });

        assert.ok(
            result.critical.includes('strict QUIC transport is configured, but quic_client_* metrics are missing.'),
        );
    });

    it('passes QUIC metrics gate when strict QUIC metrics are present', () => {
        const result = evaluateGates({
            tunnelStatus: {
                success: true,
                permanentTunnel: {
                    transportProtocol: 'quic',
                    lastSmokeFresh: true,
                    lastSmoke: { checkedAt: '2026-06-09T10:00:00.000Z' },
                    originDiagnostics: { recentOriginErrors: [] },
                },
            },
            remoteAudit: {
                ok: true,
                remote: { connections: { active: 4 } },
            },
            metrics: {
                ok: true,
                operational: { requestErrorRate: 0, haConnections: 4 },
                latency: { rpcClientLatency: { p95Ms: 100 } },
                quic: { present: true, smoothedRttMs: 40 },
            },
        });

        assert.deepEqual(result.critical, []);
        assert.ok(result.passed.includes('QUIC metrics are present for strict QUIC transport.'));
        assert.ok(result.passed.includes('QUIC RTT within budget: 40ms.'));
        assert.ok(result.passed.includes('rpcClientLatency.p95Ms within budget: 100ms.'));
    });

    it('warns when QUIC or RPC latency budgets are exceeded without failing HA gates', () => {
        const result = evaluateGates({
            tunnelStatus: {
                success: true,
                permanentTunnel: {
                    transportProtocol: 'quic',
                    lastSmokeFresh: true,
                    lastSmoke: { checkedAt: '2026-06-09T10:00:00.000Z' },
                    originDiagnostics: { recentOriginErrors: [] },
                },
            },
            remoteAudit: {
                ok: true,
                remote: { connections: { active: 4 } },
            },
            metrics: {
                ok: true,
                operational: { requestErrorRate: 0, haConnections: 4 },
                latency: { rpcClientLatency: { p95Ms: 3000 } },
                quic: { present: true, smoothedRttMs: 6000 },
            },
        });

        assert.deepEqual(result.critical, []);
        assert.ok(result.warnings.includes('QUIC RTT appears high: 6000ms.'));
        assert.ok(result.warnings.includes('rpcClientLatency.p95Ms above budget: 3000ms.'));
    });
});
