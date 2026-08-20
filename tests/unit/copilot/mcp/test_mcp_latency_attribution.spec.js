// @ts-check

import {
    classifyLatencyAttribution,
    resolveOfficialAggregateStatus,
    summarizeAuditInterToolHistory,
    summarizeCloudflareMetrics,
    summarizeReachability,
} from '#copilot/mcp/tools';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

function healthyLocal(overrides = {}) {
    return {
        handler: { status: 'ok', averageMs: 80, calls: 10, toolCalls: 10, errors: 0, errorRate: 0, uptimeMs: 60_000 },
        originHttpBoundary: {
            authority: 'observed-at-http-origin-request-response-boundary',
            internalStatus: 'ok',
            externalGapStatus: 'normal',
            activeRequests: 0,
            requestCount: 10,
            burstCount: 10,
            overlapCount: 0,
            externalGaps: {
                count: 9,
                totalMs: 7_200,
                averageMs: 800,
                p50Ms: 750,
                p95Ms: 1_400,
                p99Ms: 1_400,
                lastMs: 700,
                maxMs: 1_400,
            },
            preHandler: { count: 10, averageMs: 8, p50Ms: 7, p95Ms: 15, p99Ms: 15, lastMs: 8, maxMs: 15 },
            postHandler: { count: 10, averageMs: 5, p50Ms: 4, p95Ms: 10, p99Ms: 10, lastMs: 5, maxMs: 10 },
            lastTransition: null,
            maxTransition: null,
            thresholdsMs: {
                externalElevated: 3_000,
                externalHigh: 8_000,
                internalPressure: 500,
                internalDegraded: 1_500,
            },
            note: 'fixture',
        },
        interToolGap: {
            status: 'normal',
            authority: 'observed-at-origin-boundary-external-segment-proxy',
            burstCount: 10,
            activeCalls: 0,
            count: 9,
            averageMs: 900,
            p50Ms: 800,
            p95Ms: 1_500,
            p99Ms: 1_500,
            lastMs: 700,
            maxMs: 1_500,
            lastTransition: null,
            maxTransition: null,
            thresholdsMs: { elevated: 3_000, high: 8_000 },
            note: 'fixture',
        },
        contextPressure: {
            level: 'low',
            proxyOnly: true,
            resultBytesSinceRestart: 64_000,
            averageResultBytes: 6_400,
            largeResultCalls: 0,
            thresholdBytes: { moderate: 262_144, high: 1_048_576 },
        },
        topResultProducers: [],
        ...overrides,
    };
}

function healthyCloudflare(overrides = {}) {
    return {
        status: 'ok',
        authority: 'observed-from-local-cloudflared-metrics',
        haConnections: 4,
        quicRttMs: 35,
        rpcP95Ms: 1_200,
        requestErrorRate: 0,
        reasons: [],
        ...overrides,
    };
}

function healthyPublicLoopback(overrides = {}) {
    return {
        status: 'ok',
        authority: 'observed-container-public-mcp-self-loop-reference',
        samples: 3,
        successful: 3,
        p50Ms: 250,
        p95Ms: 300,
        maxMs: 300,
        httpStatuses: [200, 200, 200],
        note: 'fixture',
        externalGapP50Ms: 750,
        unexplainedBeyondSelfLoopP50Ms: 500,
        externalGapToSelfLoopRatio: 3,
        ...overrides,
    };
}

function healthyReachability(overrides = {}) {
    return {
        status: 'ok',
        authority: 'observed-from-container',
        endpointCount: 4,
        reachableCount: 4,
        failedEndpointIds: [],
        note: 'fixture',
        ...overrides,
    };
}

function aggregateOperational(overrides = {}) {
    return {
        status: 'aggregate-operational',
        authority: 'official-openai-aggregate-status-not-individual-session-health',
        observedAt: new Date().toISOString(),
        root: {
            source: 'status-root',
            reachable: true,
            httpStatus: 200,
            signal: 'operational',
            durationMs: 10,
            error: null,
        },
        statusApi: {
            source: 'status-api',
            reachable: true,
            httpStatus: 200,
            indicator: 'none',
            description: 'All Systems Operational',
            sourceUpdatedAt: new Date().toISOString(),
            freshness: 'fresh',
            durationMs: 10,
            error: null,
        },
        caveat: 'fixture',
        ...overrides,
    };
}

describe('MCP latency attribution', () => {
    it('reconstructs historical burst gaps, preserves concurrency and excludes long idle pauses', () => {
        const base = Date.parse('2026-08-18T10:00:00.000Z');
        /** @param {number} offsetMs @param {string} name @param {string} callId @param {string} tool @param {string |
  undefined} [edgeColo] */
        const event = (offsetMs, name, callId, tool, edgeColo) => ({
            ts: new Date(base + offsetMs).toISOString(),
            event: name,
            callId,
            tool,
            ...(edgeColo ? { edgeColo } : {}),
        });
        const history = summarizeAuditInterToolHistory(
            [
                event(0, 'tool_call_started', 'a', 'tool-a', 'GRU'),
                event(100, 'tool_call_completed', 'a', 'tool-a'),
                event(2_000, 'tool_call_started', 'b', 'tool-b', 'GRU'),
                event(2_100, 'tool_call_completed', 'b', 'tool-b'),
                event(3_000, 'tool_call_started', 'c', 'tool-c', 'GRU'),
                event(3_010, 'tool_call_started', 'd', 'tool-d', 'GRU'),
                event(3_100, 'tool_call_completed', 'c', 'tool-c'),
                event(3_200, 'tool_call_completed', 'd', 'tool-d'),
                event(78_200, 'tool_call_started', 'e', 'tool-e', 'IAD'),
                event(78_300, 'tool_call_completed', 'e', 'tool-e'),
                event(80_000, 'tool_call_started', 'f', 'tool-f', 'IAD'),
                event(80_100, 'tool_call_completed', 'f', 'tool-f'),
            ],
            base + 81_000,
            { auditReadOk: true, tailBytesRead: 1000, fileBytes: 1000 },
        );
        assert.equal(history.interactiveGapCount, 3);
        assert.equal(history.idleExcludedCount, 1);
        const window15m = history.windows['15m'];
        assert.ok(window15m);
        assert.equal(window15m.count, 3);
        assert.equal(window15m.idleExcluded, 1);
        assert.equal(window15m.averageMs, 1_500);
        assert.equal(window15m.p50Ms, 1_700);
        assert.equal(window15m.p95Ms, 1_900);
        assert.equal(history.fastBaselineP25Ms, 900);
        assert.equal(history.fastBaselineWindow, 'tail');
        assert.equal(history.hourlyUtc.length, 1);
        assert.equal(history.hourlyUtc[0]?.count, 3);
        assert.deepEqual(history.edgeColo24h, [
            { edgeColo: 'GRU', count: 2, averageMs: 1_400, p50Ms: 900, p95Ms: 1_900, maxMs: 1_900 },
            { edgeColo: 'IAD', count: 1, averageMs: 1_700, p50Ms: 1_700, p95Ms: 1_700, maxMs: 1_700 },
        ]);
        assert.deepEqual(history.topTransitions24h, [
            {
                from: 'tool-a',
                to: 'tool-b',
                count: 1,
                totalGapMs: 1_900,
                averageMs: 1_900,
                p50Ms: 1_900,
                p95Ms: 1_900,
                maxMs: 1_900,
            },
            {
                from: 'tool-e',
                to: 'tool-f',
                count: 1,
                totalGapMs: 1_700,
                averageMs: 1_700,
                p50Ms: 1_700,
                p95Ms: 1_700,
                maxMs: 1_700,
            },
            {
                from: 'tool-b',
                to: 'tool-c',
                count: 1,
                totalGapMs: 900,
                averageMs: 900,
                p50Ms: 900,
                p95Ms: 900,
                maxMs: 900,
            },
        ]);
    });

    it('groups only same-series latency pulses under sanitized experiment labels', () => {
        const base = Date.parse('2026-08-18T12:00:00.000Z');
        /** @param {number} offsetMs @param {string} callId @param {string} seriesId @param {Record<string, string>}
  [labels] */
        const pulseStart = (offsetMs, callId, seriesId, labels = {}) => ({
            ts: new Date(base + offsetMs).toISOString(),
            event: 'tool_call_started',
            callId,
            tool: 'mcp_latency_pulse',
            latencySeriesId: seriesId,
            ...labels,
        });
        /** @param {number} offsetMs @param {string} callId */
        const pulseEnd = (offsetMs, callId) => ({
            ts: new Date(base + offsetMs).toISOString(),
            event: 'tool_call_completed',
            callId,
            tool: 'mcp_latency_pulse',
        });
        const history = summarizeAuditInterToolHistory(
            [
                pulseStart(0, 'a1', 'wifi', { latencyNetworkLabel: 'wifi-home', latencyModelLabel: 'sol' }),
                pulseEnd(100, 'a1'),
                pulseStart(5_100, 'a2', 'wifi', { latencyNetworkLabel: 'wifi-home', latencyModelLabel: 'sol' }),
                pulseEnd(5_200, 'a2'),
                pulseStart(11_200, 'a3', 'wifi', { latencyNetworkLabel: 'wifi-home', latencyModelLabel: 'sol' }),
                pulseEnd(11_300, 'a3'),
                pulseStart(17_300, 'b1', 'hotspot', {
                    latencyNetworkLabel: 'hotspot-cellular',
                    latencyModelLabel: 'sol',
                }),
                pulseEnd(17_400, 'b1'),
                pulseStart(21_400, 'b2', 'hotspot', {
                    latencyNetworkLabel: 'hotspot-cellular',
                    latencyModelLabel: 'sol',
                }),
                pulseEnd(21_500, 'b2'),
                pulseStart(25_500, 'b3', 'hotspot', {
                    latencyNetworkLabel: 'hotspot-cellular',
                    latencyModelLabel: 'sol',
                }),
                pulseEnd(25_600, 'b3'),
            ],
            base + 26_000,
            { auditReadOk: true, tailBytesRead: 2000, fileBytes: 2000 },
        );
        assert.equal(history.controlledPulseSeries24h.length, 2);
        assert.deepEqual(history.controlledPulseSeries24h[0], {
            seriesId: 'hotspot',
            networkLabel: 'hotspot-cellular',
            modelLabel: 'sol',
            conversationLabel: null,
            clientLabel: null,
            vpnLabel: null,
            count: 2,
            averageMs: 4_000,
            p25Ms: 4_000,
            p50Ms: 4_000,
            p95Ms: 4_000,
            p99Ms: 4_000,
            minMs: 4_000,
            maxMs: 4_000,
        });
        assert.deepEqual(history.controlledPulseSeries24h[1], {
            seriesId: 'wifi',
            networkLabel: 'wifi-home',
            modelLabel: 'sol',
            conversationLabel: null,
            clientLabel: null,
            vpnLabel: null,
            count: 2,
            averageMs: 5_500,
            p25Ms: 5_000,
            p50Ms: 5_000,
            p95Ms: 6_000,
            p99Ms: 6_000,
            minMs: 5_000,
            maxMs: 6_000,
        });
    });

    it('lets fresh structured degraded status override a generic operational HTML banner', () => {
        const status = resolveOfficialAggregateStatus({
            rootSignal: 'operational',
            jsonIndicator: 'minor',
            jsonFreshness: 'fresh',
            summaryFreshness: 'stale',
            unresolvedIncidentCount: 0,
            degradedComponentCount: 0,
        });
        assert.equal(status.status, 'aggregate-degraded');
        assert.equal(status.reason, 'fresh-status-api-degraded');
        assert.equal(status.sourceConflict, true);
    });

    it('does not let stale structured status override a current operational banner', () => {
        const status = resolveOfficialAggregateStatus({
            rootSignal: 'operational',
            jsonIndicator: 'minor',
            jsonFreshness: 'stale',
            summaryFreshness: 'stale',
            unresolvedIncidentCount: 0,
            degradedComponentCount: 0,
        });
        assert.equal(status.status, 'aggregate-operational');
        assert.equal(status.reason, 'html-root-operational');
        assert.equal(status.sourceConflict, false);
    });

    it('attributes user-reported slowness to the pre-MCP/upstream zone when local layers are healthy', () => {
        const result = classifyLatencyAttribution(
            /** @type {any} */ ({
                reportedSlow: true,
                clientSchemaProjectionStale: false,
                local: healthyLocal(),
                cloudflare: healthyCloudflare(),
                publicMcpLoopback: healthyPublicLoopback(),
                reachability: healthyReachability(),
                externalStatus: aggregateOperational(),
            }),
        );
        assert.equal(result.classification, 'likely-pre-mcp-or-upstream-chatgpt');
        assert.equal(result.confidence, 'medium');
        assert.ok(result.reasons.includes('reported-slowness-not-explained-by-local-mcp-or-tunnel'));
        assert.ok(result.remediation.some((item) => item.includes('unnecessary local restarts')));
    });

    it('keeps fixed-endpoint TTFB regression as correlated evidence instead of overriding healthier higher-authority layers', () => {
        const result = classifyLatencyAttribution(
            /** @type {any} */ ({
                reportedSlow: true,
                clientSchemaProjectionStale: false,
                local: healthyLocal(),
                cloudflare: healthyCloudflare(),
                publicMcpLoopback: healthyPublicLoopback(),
                reachability: healthyReachability(),
                endpointLatencyComparison: [
                    {
                        id: 'chatgpt-web',
                        regression: true,
                        currentTtfbP50Ms: 520,
                        baselineTtfbP50Ms: 180,
                        ttfbRatio: 2.89,
                    },
                ],
                externalStatus: aggregateOperational(),
            }),
        );
        assert.equal(result.classification, 'likely-pre-mcp-or-upstream-chatgpt');
        assert.ok(result.reasons.includes('openai-endpoint-ttfb-regression-from-container'));
        assert.ok(result.remediation.some((item) => item.includes('persisted 24h baseline')));
    });

    it('surfaces high inter-tool gaps as direct evidence of delay outside active MCP handlers', () => {
        const result = classifyLatencyAttribution(
            /** @type {any} */ ({
                reportedSlow: true,
                clientSchemaProjectionStale: false,
                local: healthyLocal({
                    interToolGap: {
                        status: 'high',
                        authority: 'observed-at-origin-boundary-external-segment-proxy',
                        burstCount: 8,
                        activeCalls: 0,
                        count: 7,
                        averageMs: 9_500,
                        p50Ms: 8_900,
                        p95Ms: 14_000,
                        p99Ms: 14_000,
                        lastMs: 11_000,
                        maxMs: 14_000,
                        lastTransition: { from: 'repo_status', to: 'repo_read_file', gapMs: 11_000, observedAt: 1 },
                        maxTransition: { from: 'repo_search_text', to: 'repo_read_file', gapMs: 14_000, observedAt: 1 },
                        thresholdsMs: { elevated: 3_000, high: 8_000 },
                        note: 'fixture',
                    },
                }),
                cloudflare: healthyCloudflare(),
                publicMcpLoopback: healthyPublicLoopback(),
                reachability: healthyReachability(),
                externalStatus: aggregateOperational(),
            }),
        );
        assert.equal(result.classification, 'likely-pre-mcp-or-upstream-chatgpt');
        assert.ok(result.reasons.includes('high-inter-tool-quiescent-gap'));
        assert.ok(result.remediation.some((item) => item.includes('outside MCP execution')));
    });

    it('distinguishes predominantly silent external delay from per-call stateful initialization churn', () => {
        const baseLocal = healthyLocal();
        const result = classifyLatencyAttribution(
            /** @type {any} */ ({
                reportedSlow: true,
                clientSchemaProjectionStale: false,
                local: {
                    ...baseLocal,
                    originHttpBoundary: {
                        ...baseLocal.originHttpBoundary,
                        externalGapStatus: 'high',
                        externalGaps: {
                            count: 8,
                            totalMs: 64_000,
                            averageMs: 8_000,
                            p50Ms: 7_800,
                            p95Ms: 11_000,
                            p99Ms: 11_000,
                            lastMs: 8_200,
                            maxMs: 11_000,
                        },
                        silentExternalGaps: {
                            count: 8,
                            totalMs: 62_400,
                            averageMs: 7_800,
                            p50Ms: 7_600,
                            p95Ms: 10_800,
                            p99Ms: 10_800,
                            lastMs: 8_000,
                            maxMs: 10_800,
                        },
                        auxiliaryCoverage: {
                            count: 8,
                            totalMs: 1_600,
                            averageMs: 200,
                            p50Ms: 180,
                            p95Ms: 260,
                            lastMs: 200,
                            overallCoverageRatio: 0.025,
                        },
                        discreteAuxiliaryTiming: {
                            count: 8,
                            firstDelayP50Ms: 7_400,
                            firstDelayP95Ms: 10_400,
                            firstDelayLastMs: 8_000,
                            tailSilentP50Ms: 120,
                            tailSilentP95Ms: 250,
                            tailSilentLastMs: 140,
                            firstDelayToExternalP50Ratio: 0.949,
                            lastFirstDiscreteRpcMethod: 'initialize',
                            lastFirstDiscreteRoute: 'mcp',
                        },
                        requestActivity: {
                            totalRequests: 24,
                            completedRequests: 24,
                            activeRequests: 0,
                            byRoute: { mcp: 24 },
                            byRpcMethod: { initialize: 8, 'notifications/initialized': 8, 'tools/call': 8 },
                            lastCompleted: null,
                        },
                    },
                },
                cloudflare: healthyCloudflare(),
                cloudflareHttpAnalytics: { ok: false, available: false },
                sessionRuntime: { activeSessions: 8, maxSessions: 256 },
                publicMcpLoopback: healthyPublicLoopback({
                    p50Ms: 220,
                    externalGapP50Ms: 7_800,
                    externalGapToSelfLoopRatio: 35.45,
                }),
                reachability: healthyReachability(),
                externalStatus: aggregateOperational(),
            }),
        );
        assert.equal(result.classification, 'likely-pre-mcp-or-upstream-chatgpt');
        assert.equal(result.confidence, 'high');
        assert.ok(result.reasons.includes('predominantly-silent-external-gap'));
        assert.ok(result.reasons.includes('pre-discrete-session-work-silence-dominates'));
        assert.ok(result.reasons.includes('per-call-stateful-session-initialize-churn'));
        assert.equal(result.reasons.includes('stateful-session-capacity-pressure'), false);
    });

    it('prioritizes Cloudflare degradation over an otherwise healthy upstream picture', () => {
        const result = classifyLatencyAttribution(
            /** @type {any} */ ({
                reportedSlow: true,
                clientSchemaProjectionStale: false,
                local: healthyLocal(),
                cloudflare: healthyCloudflare({
                    status: 'degraded',
                    haConnections: 2,
                    reasons: ['ha-connections-below-4'],
                }),
                publicMcpLoopback: healthyPublicLoopback(),
                reachability: healthyReachability(),
                externalStatus: aggregateOperational(),
            }),
        );
        assert.equal(result.classification, 'cloudflare-or-origin-transport-degraded');
        assert.equal(result.confidence, 'high');
        assert.ok(result.reasons.includes('cloudflare-tunnel-degraded'));
    });

    it('reports context-pressure proxy and stale client schema without misclassifying them as a tunnel outage', () => {
        const result = classifyLatencyAttribution(
            /** @type {any} */ ({
                reportedSlow: true,
                clientSchemaProjectionStale: true,
                local: healthyLocal({
                    contextPressure: {
                        level: 'high',
                        proxyOnly: true,
                        resultBytesSinceRestart: 2_000_000,
                        averageResultBytes: 100_000,
                        largeResultCalls: 7,
                        thresholdBytes: { moderate: 262_144, high: 1_048_576 },
                    },
                }),
                cloudflare: healthyCloudflare(),
                publicMcpLoopback: healthyPublicLoopback(),
                reachability: healthyReachability(),
                externalStatus: aggregateOperational(),
            }),
        );
        assert.equal(result.classification, 'likely-pre-mcp-or-upstream-chatgpt');
        assert.ok(result.reasons.includes('client-schema-projection-stale'));
        assert.ok(result.reasons.includes('high-result-context-pressure-proxy'));
        assert.ok(result.remediation.some((item) => item.includes('fresh conversation')));
    });

    it('summarizes Cloudflare metrics using the same HA and RPC gates as the post-change policy', () => {
        const healthy = summarizeCloudflareMetrics(
            /** @type {any} */ ({
                ok: true,
                operational: { haConnections: 4, requestErrorRate: 0.1 },
                latency: { rpcClientLatency: { p95Ms: 1_260 } },
                quic: { smoothedRttMs: 33 },
            }),
        );
        assert.equal(healthy.status, 'ok');
        assert.equal(healthy.haConnections, 4);
        assert.equal(healthy.rpcP95Ms, 1260);

        const degraded = summarizeCloudflareMetrics(
            /** @type {any} */ ({
                ok: true,
                operational: { haConnections: 2 },
                latency: { rpcClientLatency: { p95Ms: 3_000 } },
                quic: { smoothedRttMs: 40 },
            }),
        );
        assert.equal(degraded.status, 'degraded');
        assert.ok(degraded.reasons.includes('ha-connections-below-4'));
        assert.ok(degraded.reasons.includes('rpc-client-p95-above-budget'));
    });

    it('never upgrades container reachability into client health authority', () => {
        const summary = summarizeReachability(
            /** @type {any} */ ([
                { id: 'chatgpt-web', reachable: true },
                { id: 'chatgpt-websocket-host', reachable: true },
                { id: 'openai-api', reachable: false },
            ]),
        );
        assert.equal(summary.status, 'degraded');
        assert.equal(summary.authority, 'observed-from-container');
        assert.deepEqual(summary.failedEndpointIds, ['openai-api']);
        assert.match(summary.note, /not ChatGPT client/i);
    });
});
