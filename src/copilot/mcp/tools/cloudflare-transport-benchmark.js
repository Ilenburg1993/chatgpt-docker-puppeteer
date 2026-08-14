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
        'Build a read-only plan for a controlled Cloudflare Tunnel transport benchmark across quic, auto and http2 profiles.',
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
        role: roleForProtocol(candidate, currentProtocol),
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
                'before/after cloudflared request-error counter delta for the measurement window is 0, or every increment is explained by a classified benign client/stream cancellation',
                'haConnections remains 4',
                `rpcClientLatency.p95Ms does not regress more than ${DEFAULT_MAX_P95_REGRESSION_PERCENT}% versus control`,
                'no actionable origin errors are observed after the fresh connector smoke',
            ],
            stopConditions: [
                'OAuth failure',
                'tool list mismatch',
                'unexplained request-error counter increments during the measurement window',
                'haConnections < 4 after warmup',
                'repeated connector network errors',
                'proxy/rpc p95 materially worse than the selected control protocol',
            ],
            manualProtocolSwitch: {
                note: 'This plan is read-only. Protocol switching must be done by the existing Cloudflare restart/run workflow with explicit review.',
                env: 'COPILOT_MCP_CLOUDFLARE_PROTOCOL or TUNNEL_TRANSPORT_PROTOCOL',
                values: CANDIDATES,
            },
        },
        decisionPolicy: {
            keepOrRollbackToHttp2When: [
                'auto/quic cannot preserve 4 HA connections',
                'UDP egress is unreliable in DevContainer or host network',
                'p95/p99 are materially worse than the selected control protocol',
            ],
            promoteAutoWhen: [
                'strict QUIC is not required but UDP succeeds often enough to improve latency',
                'smoke and OAuth remain stable',
                'measurement-window request-error deltas remain zero or fully classified as benign cancellations',
                'haConnections remains 4',
            ],
            keepQuicWhen: [
                'strict QUIC canary passes after warmup',
                'measurement-window request-error deltas remain zero or fully classified as benign cancellations',
                'haConnections remains 4',
                'Cloudflare QUIC metrics remain present after restart',
            ],
        },
        nextActions: nextActionsForProtocol(currentProtocol),
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
function roleForProtocol(candidate, currentProtocol) {
    if (candidate === currentProtocol) return 'control-current';
    if (candidate === 'quic') return 'strict-udp-candidate';
    if (candidate === 'auto') return 'fallback-capable-candidate';
    if (candidate === 'http2') return 'tcp-rollback-candidate';
    return 'unsupported-candidate';
}

/**
 * @param {string} currentProtocol
 * @returns {string[]}
 */
function nextActionsForProtocol(currentProtocol) {
    if (currentProtocol === 'quic') {
        return [
            'Keep QUIC as the current control while smoke, OAuth, HA connections, actionable-origin diagnostics and measurement-window error deltas remain healthy.',
            'Use npm run copilot:mcp:quic:rollback if UDP or Cloudflare connector stability regresses.',
            'Record metrics before and after any protocol switch in the roadmap.',
        ];
    }
    if (currentProtocol === 'auto') {
        return [
            'Use auto as a safe candidate while UDP quality is still being observed.',
            'Promote to strict QUIC only after canary and metrics gates pass repeatedly.',
            'Record metrics before and after any protocol switch in the roadmap.',
        ];
    }
    return [
        'Keep HTTP/2 as the TCP rollback baseline.',
        'Test auto before strict QUIC when UDP quality is unknown.',
        'Record metrics before and after each protocol switch in the roadmap.',
    ];
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
