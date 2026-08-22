// @ts-check
/** Tests for Cloudflare post-change gate evaluation. */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { evaluateGates } from '#copilot/testing/mcp/tools/cloudflare-post-change-gates';

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

    it('downgrades aggregate request error rate when fresh smoke and HA origin signals prove recovery', () => {
        const result = evaluateGates({
            tunnelStatus: {
                success: true,
                permanentTunnel: {
                    transportProtocol: 'quic',
                    lastSmokeFresh: true,
                    lastSmoke: { checkedAt: '2026-06-14T01:24:55.271Z' },
                    originDiagnostics: { recentOriginErrors: [] },
                },
            },
            remoteAudit: {
                ok: true,
                remote: { connections: { active: 4 } },
            },
            metrics: {
                ok: true,
                operational: { requestErrorRate: 0.092683, haConnections: 4 },
                latency: { rpcClientLatency: { p95Ms: 1170 } },
                quic: { present: true, smoothedRttMs: 22 },
            },
        });

        assert.deepEqual(result.critical, []);
        assert.ok(result.warnings.some((warning) => warning.includes('aggregate requestErrorRate is 0.092683')));
        assert.ok(result.passed.includes('no actionable origin errors after the latest smoke.'));
    });

    it('does not fail gates for recovered QUIC transport errors when smoke and HA metrics are healthy', () => {
        const result = evaluateGates({
            tunnelStatus: {
                success: true,
                permanentTunnel: {
                    transportProtocol: 'quic',
                    lastSmokeFresh: true,
                    lastSmoke: { checkedAt: '2026-06-10T16:10:44.358Z' },
                    originDiagnostics: {
                        recentOriginErrors: [],
                        recentTunnelTransportErrors: [
                            '2026-06-10T16:14:19Z ERR failed to accept incoming stream requests error="failed to accept QUIC stream: timeout: no recent network activity" connIndex=0',
                        ],
                    },
                },
            },
            remoteAudit: {
                ok: true,
                remote: { connections: { active: 4 } },
            },
            metrics: {
                ok: true,
                operational: { requestErrorRate: 0, haConnections: 4 },
                latency: { rpcClientLatency: { p95Ms: 50 } },
                quic: { present: true, smoothedRttMs: 31 },
            },
        });

        assert.deepEqual(result.critical, []);
        assert.ok(result.warnings.some((warning) => warning.includes('recent tunnel transport errors')));
    });

    it('does not fail origin gates for abrupt stream/client closes after latest smoke', () => {
        const result = evaluateGates({
            tunnelStatus: {
                success: true,
                permanentTunnel: {
                    transportProtocol: 'quic',
                    lastSmokeFresh: true,
                    lastSmoke: { checkedAt: '2026-06-14T01:45:00.000Z' },
                    originDiagnostics: {
                        recentOriginErrors: [
                            '2026-06-14T01:46:24Z ERR  error="unexpected eof" connIndex=3 event=1 ingressRule=0 originService=https://127.0.0.1:3333',
                        ],
                    },
                },
            },
            remoteAudit: {
                ok: true,
                remote: { connections: { active: 4 } },
            },
            metrics: {
                ok: true,
                operational: { requestErrorRate: 0, haConnections: 4 },
                latency: { rpcClientLatency: { p95Ms: 50 } },
                quic: { present: true, smoothedRttMs: 31 },
            },
        });

        assert.deepEqual(result.critical, []);
        assert.ok(result.passed.includes('no actionable origin errors after the latest smoke.'));
    });

    it('does not fail origin gates for context-canceled stream/client closes after latest smoke', () => {
        const result = evaluateGates({
            tunnelStatus: {
                success: true,
                permanentTunnel: {
                    transportProtocol: 'quic',
                    lastSmokeFresh: true,
                    lastSmoke: { checkedAt: '2026-06-13T09:20:00.000Z' },
                    originDiagnostics: {
                        recentOriginErrors: [
                            '2026-06-13T09:21:20Z ERR  error="context canceled" connIndex=1 event=1 ingressRule=0 originService=https://127.0.0.1:3333',
                        ],
                    },
                },
            },
            remoteAudit: {
                ok: true,
                remote: { connections: { active: 4 } },
            },
            metrics: {
                ok: true,
                operational: { requestErrorRate: 0, haConnections: 4 },
                latency: { rpcClientLatency: { p95Ms: 50 } },
                quic: { present: true, smoothedRttMs: 31 },
            },
        });

        assert.deepEqual(result.critical, []);
        assert.ok(result.passed.includes('no actionable origin errors after the latest smoke.'));
    });

    it('still fails gates for origin TLS/proxy errors after latest smoke', () => {
        const result = evaluateGates({
            tunnelStatus: {
                success: true,
                permanentTunnel: {
                    transportProtocol: 'quic',
                    lastSmokeFresh: true,
                    lastSmoke: { checkedAt: '2026-06-10T16:10:44.358Z' },
                    originDiagnostics: {
                        recentOriginErrors: [
                            '2026-06-10T16:14:19Z ERR failed to serve incoming request error="Failed to proxy HTTP: Unable to reach the origin service: tls: first record does not look like a TLS handshake"',
                        ],
                    },
                },
            },
            remoteAudit: {
                ok: true,
                remote: { connections: { active: 4 } },
            },
            metrics: {
                ok: true,
                operational: { requestErrorRate: 0, haConnections: 4 },
                latency: { rpcClientLatency: { p95Ms: 50 } },
                quic: { present: true, smoothedRttMs: 31 },
            },
        });

        assert.ok(result.critical.includes('actionable origin errors after latest smoke: 1.'));
    });
});
