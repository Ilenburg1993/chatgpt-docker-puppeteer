// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { summarizeCloudflaredOperationalCounters } from '../../../../src/copilot/mcp/cloudflare/metrics-histograms.js';
import {
    buildComparison,
    buildTransportMetricDelta,
    classifyTransportWindow,
} from '../../../../src/copilot/mcp/scripts/scheduled-transport-benchmark-runner.js';
import { buildDevcontainerNetworkFindings } from '../../../../src/copilot/mcp/tools/devcontainer-network-posture.js';

describe('MCP network resilience semantics', () => {
    it('parses cloudflared response_by_code status_code labels and accumulates duplicate samples', () => {
        const operational = summarizeCloudflaredOperationalCounters([
            { name: 'cloudflared_tunnel_total_requests', labels: {}, value: 45 },
            { name: 'cloudflared_tunnel_request_errors', labels: {}, value: 4 },
            { name: 'cloudflared_tunnel_ha_connections', labels: {}, value: 4 },
            { name: 'cloudflared_tunnel_response_by_code', labels: { status_code: '200', conn_index: '0' }, value: 20 },
            { name: 'cloudflared_tunnel_response_by_code', labels: { status_code: '200', conn_index: '1' }, value: 7 },
            { name: 'cloudflared_tunnel_response_by_code', labels: { status_code: '401' }, value: 2 },
            { name: 'cloudflared_tunnel_response_by_code', labels: { code: '202' }, value: 5 },
        ]);

        assert.deepEqual(operational['responseCodes'], { 200: 27, 401: 2, 202: 5 });
        assert.equal(operational['requestErrors'], 4);
    });

    it('keeps requestErrors advisory while preserving response-code deltas for forensic review', () => {
        const delta = buildTransportMetricDelta(
            {
                totalRequests: 134,
                requestErrors: 25,
                responseCodes: { 200: 71, 201: 2, 202: 27, 204: 2, 302: 3, 401: 2 },
            },
            {
                totalRequests: 179,
                requestErrors: 29,
                responseCodes: { 200: 98, 201: 4, 202: 32, 204: 4, 302: 6, 401: 4 },
            },
        );
        assert.deepEqual(delta, {
            totalRequests: 45,
            requestErrors: 4,
            responseCodes: { 200: 27, 201: 2, 202: 5, 204: 2, 302: 3, 401: 2 },
        });

        const health = classifyTransportWindow({
            allSmokesPassed: true,
            smokeSampleCount: 3,
            requiredSampleCount: 3,
            beforeOk: true,
            afterOk: true,
            haConnections: 4,
            requestErrorsDelta: 4,
        });
        assert.equal(health.comparable, true);
        assert.equal(health.clean, false);
        assert.equal(health.reviewRequired, true);
        assert.equal(health.requestErrorSignal, 'changed-advisory');

        const comparison = buildComparison(
            [
                {
                    profile: 'quic',
                    smokeLatency: { p95Ms: 1000 },
                    comparable: true,
                    clean: false,
                    reviewRequired: true,
                },
                {
                    profile: 'http2',
                    smokeLatency: { p95Ms: 1000 },
                    comparable: true,
                    clean: false,
                    reviewRequired: true,
                },
            ],
            'quic',
        );
        const candidates = /** @type {Record<string, unknown>[]} */ (comparison.candidates);
        assert.equal(candidates[0]?.['eligibleForDecision'], true);
        assert.equal(candidates[1]?.['eligibleForDecision'], true);
        assert.equal(candidates[1]?.['requestErrorReview'], true);

        const hardFailure = classifyTransportWindow({
            allSmokesPassed: true,
            smokeSampleCount: 3,
            requiredSampleCount: 3,
            beforeOk: true,
            afterOk: true,
            haConnections: 3,
            requestErrorsDelta: 0,
        });
        assert.equal(hardFailure.comparable, false);
        assert.equal(hardFailure.hardGatesPassed, false);
    });

    it('treats managed legacy DNS ownership and canonical fallback as observations, not false network faults', () => {
        const findings = buildDevcontainerNetworkFindings(
            {
                status: 'ok',
                resolv_conf_drift: 'false',
                resolv_conf_points_to_cache: 'true',
                local_probe_proven: 'true',
                dnsmasq_target_port_conflict_status: 'in-use',
                dnsmasq_process_status: 'running-managed',
                dnsmasq_port_status: 'bound-managed',
                docker_embedded_split_status: 'disabled',
                docker_embedded_resolver_detected: 'false',
                warmup_failed_count: '0',
                runtime_effective: 'true',
                resolver_effective: 'true',
            },
            { status: 'ok' },
            {
                enabled: true,
                configuredScriptReadable: false,
                canonicalScriptReadable: true,
                fallbackActive: true,
                expectedVersionMismatch: true,
                expectedVersion: '1.0.0',
                canonicalVersion: '1.1.0',
            },
        );

        assert.deepEqual(findings.critical, []);
        assert.deepEqual(findings.warnings, []);
        assert.ok(findings.observations.some((message) => message.includes('managed dnsmasq')));
        assert.ok(findings.observations.some((message) => message.includes('no embedded resolver')));
        assert.ok(findings.observations.some((message) => message.includes('self-heal')));
        assert.ok(findings.observations.some((message) => message.includes('expects network-control-plane 1.0.0')));
    });
});
