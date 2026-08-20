// @ts-check
/**
 * Cloudflare Tunnel transport benchmark planning tools.
 *
 * @module copilot/mcp/tools/cloudflare-transport-benchmark
 */

import {
    readCloudflaredMetricsSnapshot,
    readCloudflareTunnelConfig,
    readTransportBenchmarkState,
    TRANSPORT_BENCHMARK_STATE_PATH,
} from '#copilot/mcp/cloudflare';
import { okResult, readOnlyAnnotations } from '#copilot/mcp/control-plane';
import { z } from 'zod';

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
        includeMetricsBaseline: z.boolean().optional()['describe']('Include a current cloudflared metrics baseline.'),
        timeoutMs: z
            .number()
            .int()
            .min(500)
            .max(10000)
            .optional()
            ['describe']('Metrics fetch timeout in milliseconds.'),
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
    const lastRun = summarizePersistedBenchmarkState(await readTransportBenchmarkState());
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
        lastRun,
        benchmarkDesign: {
            minimumSamplesPerProtocol: DEFAULT_MIN_SAMPLES,
            sampleMetric: 'wall-clock duration of the canonical OAuth/connector smoke workload',
            protocolOrder: buildProtocolOrder(currentProtocol),
            requiredGates: [
                `${String(DEFAULT_MIN_SAMPLES)} successful identical connector-smoke samples per protocol`,
                'OAuth/tools-list/SSE smoke exit code is 0 for every sample',
                'before/after cloudflared request-error counter delta is 0 for a clean comparison window; positive deltas remain review-required rather than auto-classified',
                'haConnections remains 4 after warmup',
                `smokeLatency.p95Ms does not regress more than ${DEFAULT_MAX_P95_REGRESSION_PERCENT}% versus control for decision eligibility`,
                'cloudflared RPC/proxy latency and QUIC RTT remain secondary diagnostics rather than the benchmark sample count',
            ],
            stopConditions: [
                'connector smoke failure',
                'restart failure',
                'metrics endpoint unavailable after bounded retry',
                'control profile cannot be restored',
            ],
            delegatedExecution: {
                mission: 'benchmark-transport',
                tool: 'delegate_to_repo_autonomy_runner',
                detached: true,
                autoPromotion: false,
                restoresInitialControl: true,
                stateFile: TRANSPORT_BENCHMARK_STATE_PATH,
                workload: `${String(DEFAULT_MIN_SAMPLES)} canonical connector smokes per protocol`,
            },
            manualFallback: {
                note: 'Manual protocol switching remains a fallback; the preferred executor is the detached bounded benchmark mission.',
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
        nextActions: [
            'Use delegate_to_repo_autonomy_runner mission=benchmark-transport dryRun=true to review the fixed detached sequence.',
            'Run the same mission with dryRun=false only when a controlled multi-restart measurement window is acceptable; the runner restores the initial control and never auto-promotes a candidate.',
            ...nextActionsForProtocol(currentProtocol),
        ],
    };
}

/**
 * Keep persisted benchmark evidence compact in ChatGPT responses.
 *
 * @param {Record<string, unknown> | null} state
 * @returns {Record<string, unknown> | null}
 */
export function summarizePersistedBenchmarkState(state) {
    if (!state) return null;
    const windows = Array.isArray(state['windows'])
        ? state['windows'].map((value) => {
              const window = recordOrEmpty(value);
              return {
                  profile: window['profile'] ?? null,
                  smokeLatency: window['smokeLatency'] ?? null,
                  metricDelta: window['metricDelta'] ?? null,
                  metricsAfter: window['metricsAfter'] ?? null,
                  allSmokesPassed: window['allSmokesPassed'] === true,
                  comparable: window['comparable'] === true,
                  clean: window['clean'] === true,
                  reviewRequired: window['reviewRequired'] === true,
              };
          })
        : [];
    return {
        schemaVersion: state['schemaVersion'] ?? null,
        status: state['status'] ?? null,
        requestId: state['requestId'] ?? null,
        startedAt: state['startedAt'] ?? null,
        completedAt: state['completedAt'] ?? null,
        durationMs: state['durationMs'] ?? null,
        controlProfile: state['controlProfile'] ?? null,
        currentProfile: state['currentProfile'] ?? null,
        profileOrder: state['profileOrder'] ?? null,
        sampleCountPerProfile: state['sampleCountPerProfile'] ?? null,
        windows,
        comparison: state['comparison'] ?? null,
        restoredControl: state['restoredControl'] ?? null,
        restoreSmoke: state['restoreSmoke'] ?? null,
        autoPromotion: state['autoPromotion'] === true,
        error: state['error'] ?? null,
    };
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function recordOrEmpty(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
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
    if (candidate === 'http2')
        return 'Use as the explicit TCP rollback/baseline candidate when comparing QUIC and auto.';
    if (candidate === 'auto') return 'Best first fallback-capable candidate; can try QUIC and fall back to HTTP/2.';
    if (candidate === 'quic') return 'Test strict QUIC against the comparable HTTP/2/auto baselines.';
    return 'Unsupported candidate.';
}

/**
 * @param {string} candidate
 * @returns {string}
 */
function riskForProtocol(candidate) {
    if (candidate === 'http2')
        return 'lowest transport risk for DevContainer/TCP egress; canonical TCP rollback baseline';
    if (candidate === 'auto') return 'medium; should fall back when UDP is unavailable';
    if (candidate === 'quic') return 'highest; depends on stable UDP egress';
    return 'unknown';
}
