// @ts-check
/**
 * Cloudflare Tunnel transport benchmark planning tools.
 *
 * @module copilot/mcp/tools/cloudflare-transport-benchmark
 */

import { z } from 'zod';
import { readCloudflaredMetricsSnapshot, readCloudflareTunnelConfig } from '#copilot/mcp/cloudflare';
import { okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';

const CANDIDATES = ['http2', 'auto', 'quic'];
const DEFAULT_MIN_SAMPLES = 5;
const DEFAULT_MAX_P95_REGRESSION_PERCENT = 10;

/** @type {import('../registry.js').McpToolDefinition} */
export const mcpCloudflareTransportBenchmarkPlanTool = {
    name: 'mcp_cloudflare_transport_benchmark_plan',
    title: 'Cloudflare transport benchmark plan',
    description:
        'Build a read-only plan for a controlled Cloudflare Tunnel transport benchmark: current http2 control versus auto/quic candidates.',
    inputSchema: {
        includeMetricsBaseline: z.boolean().optional().describe('Include a current cloudflared metrics baseline.'),
        timeoutMs: z.number().int().min(500).max(10000).optional().describe('Metrics fetch timeout in milliseconds.'),
    },
    annotations: readOnlyAnnotations(),
    handler: async ({ includeMetricsBaseline, timeoutMs }) =>
        okResult(await buildCloudflareTransportBenchmarkPlan({ includeMetricsBaseline, timeoutMs })),
};

/**
 * @param {{ includeMetricsBaseline?: boolean; timeoutMs?: number }} input
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildCloudflareTransportBenchmarkPlan(input = {}) {
    const config = readCloudflareTunnelConfig();
    const metrics = input.includeMetricsBaseline === true ? await safeMetricsSnapshot(input.timeoutMs) : null;
    const currentProtocol = config.transportProtocol;
    const candidates = CANDIDATES.map((candidate) => ({
        protocol: candidate,
        role: candidate === currentProtocol ? 'control-current' : candidate === 'auto' ? 'primary-candidate' : 'udp-only-candidate',
        recommendation: recommendationForProtocol(candidate, currentProtocol),
        risk: riskForProtocol(candidate),
    }));
    return {
        ok: true,
        success: true,
        mode: 'read-only-transport-benchmark-plan',
        appliesChanges: false,
        current: {
            tunnelName: config.tunnelName,
            publicHostname: config.publicHostname,
            publicMcpUrl: config.publicMcpUrl,
            originUrl: config.originUrl,
            metricsAddr: config.metricsAddr,
            loglevel: config.loglevel,
            transportProtocol: currentProtocol,
        },
        candidates,
        metricsBaseline: metrics,
        benchmarkDesign: {
            minimumSamplesPerProtocol: DEFAULT_MIN_SAMPLES,
            protocolOrder: buildProtocolOrder(currentProtocol),
            requiredGates: [
                'mcp_connector_smoke_refresh ok=true after each protocol switch',
                'mcp_tunnel_status shows permanent tunnel healthy and lastSmokeFresh=true',
                'mcp_cloudflare_metrics_snapshot returns requestErrorRate=0',
                'haConnections remains 4',
                `rpcClientLatency.p95Ms does not regress more than ${DEFAULT_MAX_P95_REGRESSION_PERCENT}% versus control`,
                'recentOriginErrors remains empty',
            ],
            stopConditions: [
                'OAuth failure',
                'tool list mismatch',
                'requestErrorRate > 0',
                'haConnections < 4 after warmup',
                'repeated connector network errors',
                'proxy/rpc p95 materially worse than http2 control',
            ],
            manualProtocolSwitch: {
                note: 'This plan is read-only. Protocol switching must be done by the existing Cloudflare restart/run workflow with explicit review.',
                env: 'COPILOT_MCP_CLOUDFLARE_TRANSPORT_PROTOCOL or TUNNEL_TRANSPORT_PROTOCOL',
                values: CANDIDATES,
            },
        },
        decisionPolicy: {
            keepHttp2When: [
                'auto/quic cannot preserve 4 HA connections',
                'UDP egress is unreliable in DevContainer or host network',
                'p95/p99 are similar or worse than http2',
            ],
            promoteAutoWhen: [
                'smoke and OAuth remain stable',
                'requestErrorRate remains 0',
                'haConnections remains 4',
                'p95 and p99 improve or stay within the regression budget',
            ],
            avoidQuicWhen: [
                'auto already falls back to http2',
                'UDP path is blocked or unstable',
                'Cloudflare connector reconnects increase',
            ],
        },
        nextActions: [
            'Keep current http2 as the control baseline.',
            'After restart tooling is available, test auto first; test quic only if auto proves UDP is healthy.',
            'Record metrics before and after each protocol switch in the roadmap.',
        ],
    };
}

/**
 * @param {number | undefined} timeoutMs
 * @returns {Promise<Record<string, unknown>>}
 */
async function safeMetricsSnapshot(timeoutMs) {
    try {
        return await readCloudflaredMetricsSnapshot(timeoutMs === undefined ? {} : { timeoutMs });
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * @param {string} currentProtocol
 * @returns {string[]}
 */
function buildProtocolOrder(currentProtocol) {
    return [currentProtocol, ...CANDIDATES.filter((candidate) => candidate !== currentProtocol)];
}

/**
 * @param {string} candidate
 * @param {string} currentProtocol
 * @returns {string}
 */
function recommendationForProtocol(candidate, currentProtocol) {
    if (candidate === currentProtocol) return 'Use as control baseline.';
    if (candidate === 'auto') return 'Best first candidate; can try QUIC and fall back to HTTP/2.';
    if (candidate === 'quic') return 'Test only after auto indicates UDP/QUIC is healthy.';
    return 'Unsupported candidate.';
}

/**
 * @param {string} candidate
 * @returns {string}
 */
function riskForProtocol(candidate) {
    if (candidate === 'http2') return 'lowest for DevContainer/TCP egress; current stable baseline';
    if (candidate === 'auto') return 'medium; should fall back when UDP is unavailable';
    if (candidate === 'quic') return 'highest; depends on stable UDP egress';
    return 'unknown';
}
