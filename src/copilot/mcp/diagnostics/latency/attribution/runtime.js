// @ts-check
/**
 * Cross-layer latency attribution diagnostic operation for ChatGPT -> Cloudflare -> MCP.
 *
 * Owns evidence collection, fixed external probes, historical reconstruction, classification and compact projections.
 * Wire tools own schema/annotation/MCP result framing only.
 *
 * @module copilot/mcp/diagnostics/latency/attribution/runtime
 */

import { readBoundedResponseText } from '#copilot/infra/public/platform/http-response';
import {
    readCloudflaredMetricsSnapshot,
    readCloudflareHttpLatencyAnalytics,
} from '#copilot/mcp/public/cloudflare/observability';
import {
    compareOpenAiEndpointLatencyToBaseline,
    measureOpenAiEndpointLatency,
    readClientLatencyEvidence,
    readOpenAiEndpointLatencyHistory,
    readOpenAiEndpointLatencyMonitorState,
    summarizeClientLatencyEvidence,
    summarizeOpenAiEndpointLatencyHistory,
} from '#copilot/mcp/public/diagnostics/latency';
import { readMcpMetricsSnapshot } from '#copilot/mcp/public/observability';

const DEFAULT_TIMEOUT_MS = 2_500;
const MAX_STATUS_BODY_BYTES = 512 * 1024;
const MAX_STATUS_JSON_BYTES = 64 * 1024;
const MAX_RPC_P95_MS = 2_500;
const MIN_HA_CONNECTIONS = 4;
const LOCAL_HANDLER_PRESSURE_MS = 1_500;
const LOCAL_HANDLER_DEGRADED_MS = 3_000;
const INTER_TOOL_GAP_ELEVATED_MS = 3_000;
const INTER_TOOL_GAP_HIGH_MS = 8_000;
const ORIGIN_INTERNAL_PHASE_PRESSURE_MS = 500;
const ORIGIN_INTERNAL_PHASE_DEGRADED_MS = 1_500;
const LARGE_RESULT_BYTES = 64 * 1024;
const CONTEXT_PRESSURE_MODERATE_BYTES = 256 * 1024;
const CONTEXT_PRESSURE_HIGH_BYTES = 1024 * 1024;
const STATUS_SOURCE_FRESH_MS = 6 * 60 * 60 * 1000;
const STATUS_SOURCE_AGING_MS = 24 * 60 * 60 * 1000;
const MAX_INTERACTIVE_AUDIT_GAP_MS = 60_000;
const ACTIVE_WORK_CLUSTER_BREAK_MS = 30 * 60 * 1000;
const AUDIT_HISTORY_TAIL_BYTES = 4 * 1024 * 1024;
const AUDIT_HISTORY_MAX_EVENTS = 25_000;
const AUDIT_HISTORY_WINDOWS_MINUTES = Object.freeze([15, 60, 360, 1_440]);

/**
 * @typedef {{
 *     id: string;
 *     host: string;
 *     authority: 'observed-from-container';
 *     dns: { ok: boolean; durationMs: number; addressCount?: number; families?: number[]; error?: string };
 *     tls: { ok: boolean; durationMs: number; alpn?: string | null; authorized?: boolean; error?: string };
 *     http: { reachable: boolean; durationMs: number; status?: number; redirected?: boolean; error?: string };
 *     reachable: boolean;
 * }} FixedEndpointProbe
 */

/**
 * @type {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition}
 */

/**
 * Run the full latency attribution diagnostic without MCP wire framing.
 *
 * @param {{ reportedSlow?: boolean; clientSchemaProjectionStale?: boolean; timeoutMs?: number; includeDetails?: boolean }} input
 * @param {import('#copilot/mcp/public/cloudflare/environment-authority').CloudflareEnvironmentAuthority} cloudflareAuthority
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} cloudflareConfig
 * @param {Record<string, unknown> | undefined} sessionRuntimeState
 * @param {Pick<ReturnType<typeof import('#copilot/mcp/public/observability').createMcpAuditCapability>, 'readTail'>} audit
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runMcpLatencyAttributionDiagnostic(
    input,
    cloudflareAuthority,
    cloudflareConfig,
    sessionRuntimeState,
    audit,
) {
    if (!cloudflareAuthority) throw new TypeError('Latency attribution requires a Cloudflare environment authority.');
    if (!cloudflareConfig) throw new TypeError('Latency attribution requires a Cloudflare config projection.');
    if (!audit || typeof audit.readTail !== 'function')
        throw new TypeError('Latency attribution requires an audit capability.');
    const options = /** @type {Record<string, unknown>} */ (input);
    const timeoutMs = boundedInteger(options['timeoutMs'], DEFAULT_TIMEOUT_MS, 500, 5000);
    const reportedSlow = options['reportedSlow'] === true;
    const clientSchemaProjectionStale = options['clientSchemaProjectionStale'] === true;
    const includeDetails = options['includeDetails'] === true;
    const localMetrics = readMcpMetricsSnapshot();
    const sessionRuntime = sessionRuntimeState ?? {
        available: false,
        reason: 'http-session-runtime-not-owned-by-current-transport',
    };
    const endpointLatencyMonitor = readOpenAiEndpointLatencyMonitorState();

    const [
        cloudflareMetrics,
        cloudflareHttpAnalytics,
        publicMcpLoopback,
        endpointLatencyMeasurement,
        endpointLatencyHistory,
        clientLatencyEvidence,
        externalStatus,
        auditTail,
    ] = await Promise.all([
        readCloudflaredMetricsSnapshot({ timeoutMs, includeMetricNames: false }, cloudflareConfig),
        readCloudflareHttpLatencyAnalytics({
            windowMinutes: 30,
            timeoutMs: Math.max(timeoutMs, 3000),
            authority: cloudflareAuthority,
        }),
        measurePublicMcpLoopback(timeoutMs, cloudflareConfig),
        measureOpenAiEndpointLatency({ sampleCount: 3, timeoutMs }),
        readOpenAiEndpointLatencyHistory({ limit: 500 }),
        readClientLatencyEvidence({ limit: 1000 }),
        collectOfficialOpenAiAggregateStatus(timeoutMs),
        audit.readTail({ tailBytes: AUDIT_HISTORY_TAIL_BYTES, maxEvents: AUDIT_HISTORY_MAX_EVENTS }),
    ]);

    const local = summarizeLocalMcpMetrics(localMetrics);
    const historicalInterToolGap = summarizeAuditInterToolHistory(auditTail.events, Date.now(), {
        truncatedByBytes: auditTail.truncatedByBytes,
        tailBytesRead: auditTail.tailBytesRead,
        fileBytes: auditTail.fileBytes,
        invalidLines: auditTail.invalidLines,
        auditReadOk: auditTail.ok,
        auditReadError: auditTail.error,
    });
    const cloudflare = summarizeCloudflareMetrics(cloudflareMetrics);
    const endpointLatencyBaseline = summarizeOpenAiEndpointLatencyHistory(endpointLatencyHistory.entries);
    const endpointLatencyComparison = compareOpenAiEndpointLatencyToBaseline(
        endpointLatencyMeasurement.snapshot,
        endpointLatencyBaseline,
    );
    const clientLatencySummary = summarizeClientLatencyEvidence(clientLatencyEvidence.entries);
    const reachabilitySummary = summarizeEndpointLatencyReachability(endpointLatencyMeasurement.snapshot);
    const sessionRuntimeSummary = summarizeSessionRuntimePressure(sessionRuntime, local.handler.uptimeMs);
    const publicMcpLoopbackCorrelation = correlatePublicLoopback(local.originHttpBoundary, publicMcpLoopback);
    const attribution = classifyLatencyAttribution({
        reportedSlow,
        clientSchemaProjectionStale,
        local,
        cloudflare,
        cloudflareHttpAnalytics,
        sessionRuntime: sessionRuntimeSummary,
        publicMcpLoopback: publicMcpLoopbackCorrelation,
        reachability: reachabilitySummary,
        endpointLatencyComparison,
        externalStatus,
    });

    return {
        observedAt: new Date().toISOString(),
        reportedSlow,
        classification: attribution.classification,
        confidence: attribution.confidence,
        reasons: attribution.reasons,
        layers: {
            mcpHandler: local.handler,
            originHttpBoundary: local.originHttpBoundary,
            interToolGap: local.interToolGap,
            historicalInterToolGap: compactHistoricalGap(historicalInterToolGap),
            contextPressure: local.contextPressure,
            sessionRuntime: sessionRuntimeSummary,
            publicMcpLoopback: publicMcpLoopbackCorrelation,
            cloudflare,
            cloudflareHttpAnalytics: compactCloudflareHttpAnalytics(cloudflareHttpAnalytics),
            openAiReachability: reachabilitySummary,
            openAiEndpointLatency: {
                authority: endpointLatencyMeasurement.snapshot.authority,
                current: endpointLatencyMeasurement.snapshot.targets,
                baseline24h: endpointLatencyBaseline,
                comparison: endpointLatencyComparison,
                history: {
                    path: endpointLatencyHistory.path,
                    snapshotsRead: endpointLatencyHistory.entries.length,
                    truncatedByBytes: endpointLatencyHistory.truncatedByBytes,
                },
                monitor: endpointLatencyMonitor,
            },
            openAiAggregateStatus: compactExternalStatus(externalStatus),
            clientTtftEvidence: {
                authority: 'client-provided-sanitized-latency-evidence',
                history: {
                    path: clientLatencyEvidence.path,
                    entriesRead: clientLatencyEvidence.entries.length,
                    truncatedByBytes: clientLatencyEvidence.truncatedByBytes,
                },
                summary: clientLatencySummary,
            },
            clientModelPlane: {
                authority: 'not-observable-from-workspace',
                clientSchemaProjectionStale,
                note: 'Model inference, ChatGPT session scheduling, client websocket behavior and conversation token pressure are not directly observable from this MCP origin.',
            },
        },
        remediation: attribution.remediation,
        authority: {
            mcpHandler: 'observed-in-origin-process',
            originHttpBoundary: 'observed-at-http-origin-request-response-boundary',
            interToolGap: 'observed-at-origin-boundary-external-segment-proxy',
            historicalInterToolGap: 'reconstructed-from-persisted-origin-audit-events',
            contextPressure: 'workspace-result-byte-proxy-only',
            sessionRuntime: 'observed-in-origin-process',
            publicMcpLoopback: 'observed-container-public-mcp-self-loop-reference',
            cloudflare: 'observed-from-local-cloudflared-metrics',
            cloudflareHttpAnalytics: 'cloudflare-graphql-adaptive-aggregate',
            openAiReachability: 'observed-from-container',
            openAiEndpointLatency: 'observed-from-devcontainer-to-fixed-openai-endpoints',
            openAiAggregateStatus: 'official-aggregate-status-not-individual-session-health',
            clientTtftEvidence: 'client-provided-sanitized-latency-evidence',
            clientModelPlane: 'not-observable-from-workspace',
        },
        ...(includeDetails
            ? {
                  details: {
                      endpointLatencySamples: endpointLatencyMeasurement.samples,
                      endpointLatencyHistory,
                      clientLatencyEvidence,
                      externalStatus,
                      historicalInterToolGap,
                      localTopResultProducers: local.topResultProducers,
                      publicMcpLoopback,
                      cloudflareHttpAnalytics,
                      cloudflareRawCompact: compactCloudflareRaw(cloudflareMetrics),
                  },
              }
            : {}),
    };
}

/**
 * Pure classifier, exported for deterministic tests.
 *
 * @param {{
 *     reportedSlow: boolean;
 *     clientSchemaProjectionStale: boolean;
 *     local: ReturnType<typeof summarizeLocalMcpMetrics>;
 *     cloudflare: ReturnType<typeof summarizeCloudflareMetrics>;
 *     cloudflareHttpAnalytics: Record<string, unknown> & { ok: boolean; available: boolean };
 *     sessionRuntime: Record<string, unknown>;
 *     publicMcpLoopback: ReturnType<typeof correlatePublicLoopback>;
 *     reachability: ReturnType<typeof summarizeReachability>;
 *     endpointLatencyComparison?: {
 *         id: string;
 *         regression: boolean;
 *         currentTtfbP50Ms: number | null;
 *         baselineTtfbP50Ms: number | null;
 *         ttfbRatio: number | null;
 *     }[];
 *     externalStatus: Awaited<ReturnType<typeof collectOfficialOpenAiAggregateStatus>>;
 * }} input
 */
export function classifyLatencyAttribution(input) {
    /** @type {string[]} */
    const reasons = [];
    /** @type {string[]} */
    const remediation = [];

    if (input.clientSchemaProjectionStale) {
        reasons.push('client-schema-projection-stale');
        remediation.push(
            'Refresh/reconnect the ChatGPT connector schema; restarting the MCP origin alone is not sufficient when the client still advertises an older descriptor.',
        );
    }

    if (input.local.handler.status === 'degraded') {
        reasons.push('mcp-handler-latency-degraded');
        remediation.push(
            'Inspect mcp_latency_dashboard slow phases and convert repeated single operations into bounded batch/index-backed operations before changing network transport.',
        );
    } else if (input.local.handler.status === 'pressure') {
        reasons.push('mcp-handler-latency-pressure');
        remediation.push('Prefer compact/batched tools and avoid composite diagnostics unless their detail is needed.');
    }

    if (input.local.originHttpBoundary.internalStatus === 'degraded') {
        reasons.push('origin-http-internal-processing-degraded');
        remediation.push(
            'Inspect origin pre-handler and post-handler phases before changing Cloudflare or blaming upstream; request parsing/SDK dispatch or response finalization is consuming material time inside the origin.',
        );
    } else if (input.local.originHttpBoundary.internalStatus === 'pressure') {
        reasons.push('origin-http-internal-processing-pressure');
    }

    if (input.local.originHttpBoundary.externalGapStatus === 'high') {
        reasons.push('high-origin-http-external-gap');
        remediation.push(
            'The measured response-finish → next-request-arrival gap is high while the origin is idle. This is stronger evidence that delay lies outside MCP execution, in network return/dispatch or ChatGPT/model/orchestrator time.',
        );
    } else if (input.local.originHttpBoundary.externalGapStatus === 'elevated') {
        reasons.push('elevated-origin-http-external-gap');
        remediation.push(
            'Compare origin HTTP external-gap p50/p95 against a known-fast period; this metric excludes request parsing, SDK dispatch, tool execution and response finalization inside the origin.',
        );
    }

    const silentGaps = input.local.originHttpBoundary.silentExternalGaps ?? {
        count: 0,
        p50Ms: null,
        p95Ms: null,
    };
    const auxiliaryCoverage = input.local.originHttpBoundary.auxiliaryCoverage ?? {
        overallCoverageRatio: 1,
    };
    if (
        silentGaps.count >= 3 &&
        (silentGaps.p50Ms ?? 0) >= INTER_TOOL_GAP_ELEVATED_MS &&
        auxiliaryCoverage.overallCoverageRatio <= 0.1
    ) {
        reasons.push('predominantly-silent-external-gap');
        remediation.push(
            'Most response-finish → next-request-arrival time contains no observable MCP/OAuth/connector request at the origin. Prioritize model/orchestrator scheduling, tool-planning and host control-plane hypotheses; auxiliary connector traffic is quantitatively insufficient to explain the gap.',
        );
    }

    const discreteAuxiliaryTiming = input.local.originHttpBoundary.discreteAuxiliaryTiming ?? {
        count: 0,
        firstDelayP50Ms: null,
        firstDelayToExternalP50Ratio: 0,
        lastFirstDiscreteRpcMethod: null,
    };
    if (
        discreteAuxiliaryTiming.count >= 3 &&
        (discreteAuxiliaryTiming.firstDelayP50Ms ?? 0) >= INTER_TOOL_GAP_ELEVATED_MS &&
        discreteAuxiliaryTiming.firstDelayToExternalP50Ratio >= 0.8
    ) {
        reasons.push('pre-discrete-session-work-silence-dominates');
        remediation.push(
            discreteAuxiliaryTiming.lastFirstDiscreteRpcMethod === 'initialize'
                ? 'The dominant delay occurs before the next discrete MCP initialize request reaches the origin, not inside session setup. This sharply raises the priority of host/model scheduling, reasoning and tool-planning hypotheses.'
                : 'The dominant delay occurs before the first discrete connector-control request reaches the origin. Prioritize upstream host/model scheduling and planning before tuning the MCP handshake.',
        );
    }

    const rpcActivity = input.local.originHttpBoundary.requestActivity?.byRpcMethod ?? {};
    const initializeCount = Number(rpcActivity['initialize'] ?? 0);
    const toolsCallRequestCount = Number(rpcActivity['tools/call'] ?? 0);
    const initializePerToolCall = toolsCallRequestCount > 0 ? initializeCount / toolsCallRequestCount : 0;
    if (toolsCallRequestCount >= 3 && initializeCount >= 3 && initializePerToolCall >= 0.8) {
        reasons.push('per-call-stateful-session-initialize-churn');
        remediation.push(
            'The client is initializing approximately one stateful MCP session per tools/call. Treat this as bounded connector overhead and a capacity/robustness concern; measure active-session accumulation before changing TTL or server-side reclamation policy.',
        );
    }
    const sessionRuntime = input.sessionRuntime ?? {};
    const activeSessions = numberOrNull(sessionRuntime['activeSessions']);
    const maxSessions = numberOrNull(sessionRuntime['maxSessions']);
    if (activeSessions !== null && maxSessions !== null && maxSessions > 0 && activeSessions / maxSessions >= 0.5) {
        reasons.push('stateful-session-capacity-pressure');
        remediation.push(
            'Stateful MCP active sessions exceed half of configured capacity. Inspect client session reuse/termination and expiration counters before raising maxSessions; reclaim only sessions proven abandoned.',
        );
    }
    const projectedCapacityRatio = numberOrNull(sessionRuntime['projectedCapacityRatio']);
    if (projectedCapacityRatio !== null && projectedCapacityRatio >= 0.75) {
        reasons.push(
            projectedCapacityRatio >= 1
                ? 'stateful-session-capacity-exhaustion-projected'
                : 'stateful-session-capacity-pressure-projected',
        );
        remediation.push(
            'At the observed session-registration rate, the current TTL projects material session-capacity pressure. Validate the rate with a longer controlled window before changing TTL/maxSessions; prefer client reuse or proven-abandoned-session reclamation over simply raising the ceiling.',
        );
    }

    if (input.local.interToolGap.status === 'high') {
        reasons.push('high-inter-tool-quiescent-gap');
        remediation.push(
            'The origin is spending long quiescent intervals between tool bursts while handlers are not active. Treat this as direct supporting evidence for delay outside MCP execution: response return, ChatGPT/model scheduling or reasoning, host orchestration, and next-call dispatch.',
        );
    } else if (input.local.interToolGap.status === 'elevated') {
        reasons.push('elevated-inter-tool-quiescent-gap');
        remediation.push(
            'Compare inter-tool gap p50/p95 with a known-fast period before changing local transport; elevated gaps are outside handler execution but can still include normal model reasoning.',
        );
    }

    if (input.local.contextPressure.level === 'high') {
        reasons.push('high-result-context-pressure-proxy');
        remediation.push(
            'Use compact tool results by default, persist large diagnostics locally, and start a fresh conversation with a concise persisted handoff when long-session context pressure becomes dominant.',
        );
    } else if (input.local.contextPressure.level === 'moderate') {
        reasons.push('moderate-result-context-pressure-proxy');
        remediation.push('Avoid includeDetails/large file reads unless they materially change the next decision.');
    }

    const cloudflareHttpAnalytics = input.cloudflareHttpAnalytics ?? {
        ok: false,
        available: false,
        reason: 'not-provided',
    };
    const cloudflareAnalyticsSummary = asRecord(cloudflareHttpAnalytics['summary']);
    const cloudflareEdgeTtfbMs = numberOrNull(cloudflareAnalyticsSummary?.['edgeTimeToFirstByteMs']);
    const externalGapP50Ms = input.local.originHttpBoundary.externalGaps.p50Ms;
    if (
        cloudflareHttpAnalytics.available === true &&
        cloudflareEdgeTtfbMs !== null &&
        externalGapP50Ms !== null &&
        externalGapP50Ms >= INTER_TOOL_GAP_ELEVATED_MS &&
        externalGapP50Ms >= cloudflareEdgeTtfbMs * 5
    ) {
        reasons.push('origin-external-gap-much-larger-than-cloudflare-edge-ttfb');
        remediation.push(
            'Cloudflare Adaptive Analytics reports edge TTFB far below the observed response-finish → next-request-arrival gap. Treat Cloudflare edge/origin processing as quantitatively insufficient to explain most of the delay, while preserving the sampling caveat.',
        );
    }

    if (
        input.publicMcpLoopback.status === 'ok' &&
        (input.publicMcpLoopback.externalGapToSelfLoopRatio ?? 0) >= 5 &&
        (input.publicMcpLoopback.externalGapP50Ms ?? 0) >= INTER_TOOL_GAP_ELEVATED_MS
    ) {
        reasons.push('origin-external-gap-much-larger-than-public-self-loop');
        remediation.push(
            'The external ChatGPT→next-request interval is many times larger than a full container→public-MCP→tunnel→origin self-loop. Treat the remaining seconds as not explained by this origin or its ordinary Cloudflare round trip.',
        );
    } else if (input.publicMcpLoopback.status === 'degraded') {
        reasons.push('public-mcp-self-loop-degraded');
        remediation.push(
            'The public MCP self-loop is failing from the container; re-check Cloudflare/origin transport before attributing the delay to ChatGPT/model orchestration.',
        );
    }

    if (input.cloudflare.status === 'degraded') {
        reasons.push('cloudflare-tunnel-degraded');
        remediation.push(
            'Run connector smoke and Cloudflare post-change gates; use the controlled QUIC/H2 comparison or reload only when HA/RTT/RPC evidence is actually degraded.',
        );
    }

    if (input.reachability.status === 'degraded') {
        reasons.push('openai-reachability-from-container-degraded');
        remediation.push(
            'Diagnose DNS/TLS/proxy policy for the failing fixed OpenAI host from the DevContainer; do not add OpenAI /etc/hosts pinning or mutate provider routes without provider-specific evidence.',
        );
    }

    const endpointLatencyRegressions = (input.endpointLatencyComparison ?? []).filter((row) => row.regression);
    if (endpointLatencyRegressions.length > 0) {
        reasons.push('openai-endpoint-ttfb-regression-from-container');
        remediation.push(
            'One or more fixed OpenAI/ChatGPT endpoints have a material DevContainer-side TTFB regression against the persisted 24h baseline. Correlate this with the pre-dispatch gap and client-network A/B before attributing the change to model scheduling alone.',
        );
    }

    if (input.externalStatus.status === 'aggregate-degraded') {
        if (input.externalStatus.chatgptAffected === false) {
            reasons.push('official-openai-aggregate-status-degraded-other-components');
            remediation.push(
                'The official aggregate status is degraded but the fresh component summary does not mark ChatGPT as affected; keep it as correlated upstream evidence, not a direct ChatGPT cause.',
            );
        } else {
            reasons.push('official-openai-aggregate-status-degraded');
            remediation.push(
                'Avoid repeated local restarts while the official aggregate status reports degradation; preserve evidence and retry later or use an unaffected model/product path when available.',
            );
        }
    } else if (input.externalStatus.status === 'inconclusive') {
        reasons.push('official-openai-status-evidence-inconclusive');
        remediation.push(
            'Treat status evidence as advisory and compare again later; do not infer individual-session health from stale aggregate metadata.',
        );
    }

    const localCritical =
        input.local.handler.status === 'degraded' || input.local.originHttpBoundary.internalStatus === 'degraded';
    const transportCritical = input.cloudflare.status === 'degraded' || input.publicMcpLoopback.status === 'degraded';
    const reachabilityCritical = input.reachability.status === 'degraded';
    const officialCritical =
        input.externalStatus.status === 'aggregate-degraded' && input.externalStatus.chatgptAffected !== false;

    if (localCritical) {
        return {
            classification: 'local-mcp-handler-pressure',
            confidence: 'high',
            reasons,
            remediation: dedupe(remediation),
        };
    }
    if (transportCritical) {
        return {
            classification: 'cloudflare-or-origin-transport-degraded',
            confidence: 'high',
            reasons,
            remediation: dedupe(remediation),
        };
    }
    if (reachabilityCritical) {
        return {
            classification: 'openai-network-reachability-degraded-from-container',
            confidence: 'medium',
            reasons,
            remediation: dedupe(remediation),
        };
    }
    if (officialCritical) {
        return {
            classification: 'openai-aggregate-incident-plausible',
            confidence: 'medium',
            reasons,
            remediation: dedupe(remediation),
        };
    }
    if (input.reportedSlow) {
        reasons.push('reported-slowness-not-explained-by-local-mcp-or-tunnel');
        remediation.push(
            'Treat the remaining delay as likely pre-MCP/client/model/session/upstream until contradicted by evidence; reduce context payload pressure and avoid unnecessary local restarts.',
        );
        const cloudflareAnalyticsSupportsExternal =
            cloudflareHttpAnalytics.available === true &&
            cloudflareEdgeTtfbMs !== null &&
            externalGapP50Ms !== null &&
            externalGapP50Ms >= INTER_TOOL_GAP_ELEVATED_MS &&
            externalGapP50Ms >= cloudflareEdgeTtfbMs * 5;
        const predominantlySilent =
            silentGaps.count >= 3 &&
            (silentGaps.p50Ms ?? 0) >= INTER_TOOL_GAP_ELEVATED_MS &&
            auxiliaryCoverage.overallCoverageRatio <= 0.1;
        const strongExternalBoundaryEvidence =
            input.publicMcpLoopback.status === 'ok' &&
            (input.publicMcpLoopback.externalGapToSelfLoopRatio ?? 0) >= 5 &&
            input.local.originHttpBoundary.internalStatus === 'ok' &&
            input.cloudflare.status === 'ok' &&
            predominantlySilent &&
            (input.cloudflareHttpAnalytics.available !== true || cloudflareAnalyticsSupportsExternal);
        return {
            classification: 'likely-pre-mcp-or-upstream-chatgpt',
            confidence: strongExternalBoundaryEvidence
                ? 'high'
                : input.externalStatus.status === 'aggregate-operational'
                  ? 'medium'
                  : 'low',
            reasons,
            remediation: dedupe(remediation),
        };
    }
    return {
        classification: 'no-local-degradation-detected',
        confidence: input.externalStatus.status === 'aggregate-operational' ? 'high' : 'medium',
        reasons,
        remediation: dedupe(remediation),
    };
}

/** @param {ReturnType<typeof readMcpMetricsSnapshot>} metrics */
export function summarizeLocalMcpMetrics(metrics) {
    const toolRows = Object.entries(metrics.tools);
    let handlerCalls = 0;
    let handlerTotalMs = 0;
    let resultBytes = 0;
    let resultCalls = 0;
    let largeResultCalls = 0;
    /** @type {{ name: string; totalBytes: number; averageBytes: number; calls: number }[]} */
    const topResultProducers = [];

    for (const [name, metric] of toolRows) {
        const handler = metric.phases['handler'];
        if (handler) {
            handlerCalls += handler.calls;
            handlerTotalMs += handler.totalDurationMs;
        }
        const bytes = metric.resultSize.totalBytes;
        resultBytes += bytes;
        resultCalls += metric.calls;
        if ((metric.resultSize.lastBytes ?? 0) >= LARGE_RESULT_BYTES) largeResultCalls += 1;
        if (bytes > 0) {
            topResultProducers.push({
                name,
                totalBytes: bytes,
                averageBytes: metric.calls > 0 ? Math.round(bytes / metric.calls) : 0,
                calls: metric.calls,
            });
        }
    }
    topResultProducers.sort((left, right) => right.totalBytes - left.totalBytes);
    const handlerAverageMs = handlerCalls > 0 ? Math.round(handlerTotalMs / handlerCalls) : 0;
    const handlerStatus =
        handlerAverageMs >= LOCAL_HANDLER_DEGRADED_MS
            ? 'degraded'
            : handlerAverageMs >= LOCAL_HANDLER_PRESSURE_MS
              ? 'pressure'
              : 'ok';
    const errorRate = metrics.totals.calls > 0 ? metrics.totals.errors / metrics.totals.calls : 0;
    const contextLevel =
        resultBytes >= CONTEXT_PRESSURE_HIGH_BYTES
            ? 'high'
            : resultBytes >= CONTEXT_PRESSURE_MODERATE_BYTES
              ? 'moderate'
              : 'low';
    const interaction = metrics.interaction;
    const gapP95Ms = interaction.gaps.p95Ms;
    const gapStatus =
        interaction.gaps.count === 0
            ? 'insufficient-data'
            : (gapP95Ms ?? 0) >= INTER_TOOL_GAP_HIGH_MS
              ? 'high'
              : (gapP95Ms ?? 0) >= INTER_TOOL_GAP_ELEVATED_MS
                ? 'elevated'
                : 'normal';
    const originBoundary = interaction.originBoundary;
    const externalGapP95Ms = originBoundary.externalGaps.p95Ms;
    const externalGapStatus =
        originBoundary.externalGaps.count === 0
            ? 'insufficient-data'
            : (externalGapP95Ms ?? 0) >= INTER_TOOL_GAP_HIGH_MS
              ? 'high'
              : (externalGapP95Ms ?? 0) >= INTER_TOOL_GAP_ELEVATED_MS
                ? 'elevated'
                : 'normal';
    const internalP95Ms = Math.max(originBoundary.preHandler.p95Ms ?? 0, originBoundary.postHandler.p95Ms ?? 0);
    const internalStatus =
        originBoundary.preHandler.count === 0 && originBoundary.postHandler.count === 0
            ? 'insufficient-data'
            : internalP95Ms >= ORIGIN_INTERNAL_PHASE_DEGRADED_MS
              ? 'degraded'
              : internalP95Ms >= ORIGIN_INTERNAL_PHASE_PRESSURE_MS
                ? 'pressure'
                : 'ok';
    return {
        handler: {
            status: errorRate > 0.01 ? 'degraded' : handlerStatus,
            averageMs: handlerAverageMs,
            calls: handlerCalls,
            toolCalls: metrics.totals.calls,
            errors: metrics.totals.errors,
            errorRate: roundRatio(errorRate),
            uptimeMs: metrics.uptimeMs,
        },
        originHttpBoundary: {
            authority: 'observed-at-http-origin-request-response-boundary',
            internalStatus,
            externalGapStatus,
            activeRequests: originBoundary.activeRequests,
            requestCount: originBoundary.requestCount,
            burstCount: originBoundary.burstCount,
            overlapCount: originBoundary.overlapCount,
            externalGaps: originBoundary.externalGaps,
            silentExternalGaps: originBoundary.silentExternalGaps,
            auxiliaryCoverage: originBoundary.auxiliaryCoverage,
            discreteAuxiliaryTiming: originBoundary.discreteAuxiliaryTiming,
            preHandler: originBoundary.preHandler,
            postHandler: originBoundary.postHandler,
            lastCompletedEdgeColo: originBoundary.lastCompletedEdgeColo,
            edgeColoCounts: originBoundary.edgeColoCounts,
            externalGapsByEdgeColo: originBoundary.externalGapsByEdgeColo,
            requestActivity: originBoundary.requestActivity,
            lastTransition: originBoundary.lastTransition,
            maxTransition: originBoundary.maxTransition,
            thresholdsMs: {
                externalElevated: INTER_TOOL_GAP_ELEVATED_MS,
                externalHigh: INTER_TOOL_GAP_HIGH_MS,
                internalPressure: ORIGIN_INTERNAL_PHASE_PRESSURE_MS,
                internalDegraded: ORIGIN_INTERNAL_PHASE_DEGRADED_MS,
            },
            note: 'externalGaps measures previous tools/call response finish → next tools/call request arrival. preHandler covers request arrival → guarded tool dispatch; postHandler covers guarded tool return → response finish.',
        },
        interToolGap: {
            status: gapStatus,
            authority: 'observed-at-origin-boundary-external-segment-proxy',
            burstCount: interaction.burstCount,
            activeCalls: interaction.activeCalls,
            count: interaction.gaps.count,
            averageMs: interaction.gaps.averageMs,
            p50Ms: interaction.gaps.p50Ms,
            p95Ms: interaction.gaps.p95Ms,
            p99Ms: interaction.gaps.p99Ms,
            lastMs: interaction.gaps.lastMs,
            maxMs: interaction.gaps.maxMs,
            lastTransition: interaction.lastTransition,
            maxTransition: interaction.maxTransition,
            thresholdsMs: { elevated: INTER_TOOL_GAP_ELEVATED_MS, high: INTER_TOOL_GAP_HIGH_MS },
            note: 'Measures quiescent time from completion of one tool-call burst at the origin until the next tool handler begins. It excludes active MCP handler time but includes response return, client/model/orchestrator work, dispatch, transit, and potentially normal reasoning.',
        },
        contextPressure: {
            level: contextLevel,
            proxyOnly: true,
            resultBytesSinceRestart: resultBytes,
            averageResultBytes: resultCalls > 0 ? Math.round(resultBytes / resultCalls) : 0,
            largeResultCalls,
            thresholdBytes: {
                moderate: CONTEXT_PRESSURE_MODERATE_BYTES,
                high: CONTEXT_PRESSURE_HIGH_BYTES,
            },
        },
        topResultProducers: topResultProducers.slice(0, 5),
    };
}

/** @param {Record<string, unknown> & { ok: boolean }} snapshot */
export function summarizeCloudflareMetrics(snapshot) {
    const operational = asRecord(snapshot['operational']);
    const latency = asRecord(snapshot['latency']);
    const rpc = asRecord(latency?.['rpcClientLatency']);
    const quic = asRecord(snapshot['quic']);
    const haConnections = numberOrNull(operational?.['haConnections']);
    const rpcP95Ms = numberOrNull(rpc?.['p95Ms']);
    const quicRttMs = numberOrNull(quic?.['smoothedRttMs']);
    const reasons = [];
    if (!snapshot.ok) reasons.push('metrics-unavailable');
    if (haConnections !== null && haConnections < MIN_HA_CONNECTIONS) reasons.push('ha-connections-below-4');
    if (rpcP95Ms !== null && rpcP95Ms > MAX_RPC_P95_MS) reasons.push('rpc-client-p95-above-budget');
    return {
        status: reasons.length > 0 ? 'degraded' : 'ok',
        authority: 'observed-from-local-cloudflared-metrics',
        haConnections,
        quicRttMs,
        rpcP95Ms,
        requestErrorRate: numberOrNull(operational?.['requestErrorRate']),
        reasons,
    };
}

/** @param {FixedEndpointProbe[]} probes */
export function summarizeReachability(probes) {
    const failed = probes.filter((probe) => !probe.reachable);
    return {
        status: failed.length > 0 ? 'degraded' : 'ok',
        authority: 'observed-from-container',
        endpointCount: probes.length,
        reachableCount: probes.length - failed.length,
        failedEndpointIds: failed.map((probe) => probe.id),
        note: 'This proves only container-side DNS/TLS/HTTP reachability, not ChatGPT client or model-session health.',
    };
}

/** @param {{ targets: { id: string; successRate: number }[] }} snapshot */
export function summarizeEndpointLatencyReachability(snapshot) {
    const failed = snapshot.targets.filter((target) => target.successRate < 1);
    return {
        status: failed.length > 0 ? 'degraded' : 'ok',
        authority: 'observed-from-container',
        endpointCount: snapshot.targets.length,
        reachableCount: snapshot.targets.length - failed.length,
        failedEndpointIds: failed.map((target) => target.id),
        note: 'This proves only DevContainer-side fixed-endpoint HTTPS reachability and timing, not ChatGPT client or model-session health.',
    };
}

/**
 * Measure a fixed public self-loop through the configured Cloudflare hostname and back to this origin. This is a
 * transport reference, not a model/session probe.
 *
 * @param {number} timeoutMs
 * @param {import('#copilot/mcp/public/cloudflare/config').CloudflareTunnelConfig} config
 */
async function measurePublicMcpLoopback(timeoutMs, config) {
    if (!config.publicMcpUrl) {
        return {
            status: 'unavailable',
            authority: 'observed-container-public-mcp-self-loop-reference',
            samples: 0,
            successful: 0,
            p50Ms: null,
            p95Ms: null,
            maxMs: null,
            httpStatuses: [],
            note: 'No configured public MCP URL is available for a fixed self-loop reference.',
        };
    }
    const publicOrigin = new URL(config.publicMcpUrl).origin;
    const url = `${publicOrigin}/.well-known/oauth-protected-resource`;
    const results = await Promise.all(
        Array.from({ length: 3 }, () => fetchBoundedText(url, timeoutMs, MAX_STATUS_JSON_BYTES)),
    );
    const successfulDurations = results
        .filter((result) => result.ok)
        .map((result) => result.durationMs)
        .sort((left, right) => left - right);
    return {
        status:
            successfulDurations.length === results.length
                ? 'ok'
                : successfulDurations.length > 0
                  ? 'partial'
                  : 'degraded',
        authority: 'observed-container-public-mcp-self-loop-reference',
        samples: results.length,
        successful: successfulDurations.length,
        p50Ms: historicalPercentile(successfulDurations, 0.5),
        p95Ms: historicalPercentile(successfulDurations, 0.95),
        maxMs: successfulDurations.at(-1) ?? null,
        httpStatuses: results.map((result) => result.status),
        note: 'Container → public Cloudflare hostname → tunnel → origin → container reference. It does not traverse the ChatGPT/model control plane and is not the same network path as OpenAI backend traffic.',
    };
}

/**
 * Project session accumulation at the current process-local registration rate. This is a capacity estimate, not a claim
 * that every session survives until TTL.
 *
 * @param {Record<string, unknown>} runtime
 * @param {number} uptimeMs
 */
function summarizeSessionRuntimePressure(runtime, uptimeMs) {
    const counters = asRecord(runtime['counters']) ?? {};
    const activeSessions = Math.max(0, numberOrNull(runtime['activeSessions']) ?? 0);
    const maxSessions = Math.max(0, numberOrNull(runtime['maxSessions']) ?? 0);
    const ttlMs = Math.max(0, numberOrNull(runtime['ttlMs']) ?? 0);
    const registered = Math.max(0, numberOrNull(counters['registered']) ?? 0);
    const safeUptimeMs = Math.max(0, Number(uptimeMs) || 0);
    const registrationsPerMinute =
        safeUptimeMs >= 10_000 ? Math.round((registered / safeUptimeMs) * 60_000 * 100) / 100 : null;
    const projectedSessionsAtTtl =
        registrationsPerMinute !== null && ttlMs > 0
            ? Math.round(registrationsPerMinute * (ttlMs / 60_000) * 10) / 10
            : null;
    const projectedCapacityRatio =
        projectedSessionsAtTtl !== null && maxSessions > 0
            ? Math.round((projectedSessionsAtTtl / maxSessions) * 10_000) / 10_000
            : null;
    return {
        ...runtime,
        capacityUsageRatio: maxSessions > 0 ? Math.round((activeSessions / maxSessions) * 10_000) / 10_000 : null,
        registrationsPerMinute,
        projectedSessionsAtTtl,
        projectedCapacityRatio,
        projectionStatus:
            projectedCapacityRatio === null
                ? 'insufficient-data'
                : projectedCapacityRatio >= 1
                  ? 'projected-capacity-exhaustion'
                  : projectedCapacityRatio >= 0.75
                    ? 'projected-capacity-pressure'
                    : 'headroom-ok',
        projectionCaveat:
            'Projection assumes the current registration rate persists and sessions survive for the configured TTL; actual client DELETEs, reuse and expiry timing can reduce active-session count.',
    };
}

/**
 * @param {ReturnType<typeof summarizeLocalMcpMetrics>['originHttpBoundary']} originBoundary
 * @param {Awaited<ReturnType<typeof measurePublicMcpLoopback>>} loopback
 */
function correlatePublicLoopback(originBoundary, loopback) {
    const externalP50Ms = originBoundary.externalGaps.p50Ms;
    const loopbackP50Ms = loopback.p50Ms;
    const ratio =
        externalP50Ms !== null && loopbackP50Ms !== null && loopbackP50Ms > 0
            ? Math.round((externalP50Ms / loopbackP50Ms) * 100) / 100
            : null;
    return {
        ...loopback,
        externalGapP50Ms: externalP50Ms,
        unexplainedBeyondSelfLoopP50Ms:
            externalP50Ms !== null && loopbackP50Ms !== null ? Math.max(0, externalP50Ms - loopbackP50Ms) : null,
        externalGapToSelfLoopRatio: ratio,
    };
}

/** @param {number} timeoutMs */
async function collectOfficialOpenAiAggregateStatus(timeoutMs) {
    const observedAt = Date.now();
    const [root, json, summary] = await Promise.all([
        fetchBoundedText('https://status.openai.com/', timeoutMs, MAX_STATUS_BODY_BYTES),
        fetchBoundedText('https://status.openai.com/api/v2/status.json', timeoutMs, MAX_STATUS_JSON_BYTES),
        fetchBoundedText('https://status.openai.com/api/v2/summary.json', timeoutMs, MAX_STATUS_BODY_BYTES),
    ]);
    const rootSignal = root.ok ? classifyStatusRootText(root.text) : 'unknown';
    let jsonIndicator = null;
    let jsonDescription = null;
    let sourceUpdatedAt = null;
    let jsonFreshness = 'unknown';
    if (json.ok) {
        try {
            const parsed = /** @type {Record<string, unknown>} */ (JSON.parse(json.text));
            const status = asRecord(parsed['status']);
            const page = asRecord(parsed['page']);
            jsonIndicator = typeof status?.['indicator'] === 'string' ? status['indicator'] : null;
            jsonDescription = typeof status?.['description'] === 'string' ? status['description'] : null;
            sourceUpdatedAt = typeof page?.['updated_at'] === 'string' ? page['updated_at'] : null;
            jsonFreshness = classifySourceFreshness(sourceUpdatedAt, observedAt);
        } catch {
            jsonFreshness = 'invalid-json';
        }
    }

    let summaryUpdatedAt = null;
    let summaryFreshness = 'unknown';
    /** @type {{ name: string; status: string | null; impact: string | null; updatedAt: string | null }[]} */
    let unresolvedIncidents = [];
    /** @type {{ name: string; status: string }[]} */
    let degradedComponents = [];
    if (summary.ok) {
        try {
            const parsed = /** @type {Record<string, unknown>} */ (JSON.parse(summary.text));
            const page = asRecord(parsed['page']);
            summaryUpdatedAt = typeof page?.['updated_at'] === 'string' ? page['updated_at'] : null;
            summaryFreshness = classifySourceFreshness(summaryUpdatedAt, observedAt);
            const incidents = Array.isArray(parsed['incidents']) ? parsed['incidents'] : [];
            unresolvedIncidents = incidents
                .map((incident) => asRecord(incident))
                .filter((incident) => incident && String(incident['status'] ?? '') !== 'resolved')
                .slice(0, 8)
                .map((incident) => ({
                    name: String(incident?.['name'] ?? 'unknown-incident'),
                    status: typeof incident?.['status'] === 'string' ? incident['status'] : null,
                    impact: typeof incident?.['impact'] === 'string' ? incident['impact'] : null,
                    updatedAt: typeof incident?.['updated_at'] === 'string' ? incident['updated_at'] : null,
                }));
            const components = Array.isArray(parsed['components']) ? parsed['components'] : [];
            degradedComponents = components
                .map((component) => asRecord(component))
                .filter((component) => {
                    const status = typeof component?.['status'] === 'string' ? component['status'] : '';
                    return Boolean(component) && status !== '' && status !== 'operational';
                })
                .slice(0, 16)
                .map((component) => ({
                    name: String(component?.['name'] ?? 'unknown-component'),
                    status: String(component?.['status'] ?? 'unknown'),
                }));
        } catch {
            summaryFreshness = 'invalid-json';
        }
    }

    const chatgptAffected =
        summaryFreshness === 'fresh' ? degradedComponents.some((component) => /chatgpt/iu.test(component.name)) : null;
    const fusion = resolveOfficialAggregateStatus({
        rootSignal,
        jsonIndicator,
        jsonFreshness,
        summaryFreshness,
        unresolvedIncidentCount: unresolvedIncidents.length,
        degradedComponentCount: degradedComponents.length,
    });

    return {
        status: fusion.status,
        statusReason: fusion.reason,
        sourceConflict: fusion.sourceConflict,
        chatgptAffected,
        authority: 'official-openai-aggregate-status-not-individual-session-health',
        observedAt: new Date(observedAt).toISOString(),
        root: {
            source: 'https://status.openai.com/',
            reachable: root.ok,
            httpStatus: root.status,
            signal: rootSignal,
            durationMs: root.durationMs,
            error: root.error ?? null,
        },
        statusApi: {
            source: 'https://status.openai.com/api/v2/status.json',
            reachable: json.ok,
            httpStatus: json.status,
            indicator: jsonIndicator,
            description: jsonDescription,
            sourceUpdatedAt,
            freshness: jsonFreshness,
            durationMs: json.durationMs,
            error: json.error ?? null,
        },
        summaryApi: {
            source: 'https://status.openai.com/api/v2/summary.json',
            reachable: summary.ok,
            httpStatus: summary.status,
            sourceUpdatedAt: summaryUpdatedAt,
            freshness: summaryFreshness,
            unresolvedIncidents,
            degradedComponents,
            durationMs: summary.durationMs,
            error: summary.error ?? null,
        },
        caveat: 'Aggregate Statuspage evidence can be stale or differ from an individual model/tier/session; fresh structured degraded signals take precedence over a generic operational banner, but component scope still matters.',
    };
}

/**
 * Fuse official status sources by freshness and specificity. Fresh structured degradation must not be overwritten by a
 * generic HTML banner.
 *
 * @param {{
 *     rootSignal: string;
 *     jsonIndicator: string | null;
 *     jsonFreshness: string;
 *     summaryFreshness: string;
 *     unresolvedIncidentCount: number;
 *     degradedComponentCount: number;
 * }} input
 */
export function resolveOfficialAggregateStatus(input) {
    const jsonFreshDegraded =
        input.jsonFreshness === 'fresh' && Boolean(input.jsonIndicator) && input.jsonIndicator !== 'none';
    const summaryFreshDegraded =
        input.summaryFreshness === 'fresh' && (input.unresolvedIncidentCount > 0 || input.degradedComponentCount > 0);
    const structuredDegraded = jsonFreshDegraded || summaryFreshDegraded;
    if (structuredDegraded) {
        return {
            status: 'aggregate-degraded',
            reason: jsonFreshDegraded ? 'fresh-status-api-degraded' : 'fresh-summary-api-degraded',
            sourceConflict: input.rootSignal === 'operational',
        };
    }
    if (input.rootSignal === 'degraded') {
        return { status: 'aggregate-degraded', reason: 'html-root-degraded', sourceConflict: false };
    }
    if (input.jsonFreshness === 'fresh' && input.jsonIndicator === 'none') {
        return {
            status: 'aggregate-operational',
            reason: 'fresh-status-api-operational',
            sourceConflict: input.rootSignal === 'degraded',
        };
    }
    if (
        input.summaryFreshness === 'fresh' &&
        input.unresolvedIncidentCount === 0 &&
        input.degradedComponentCount === 0
    ) {
        return {
            status: 'aggregate-operational',
            reason: 'fresh-summary-api-operational',
            sourceConflict: input.rootSignal === 'degraded',
        };
    }
    if (input.rootSignal === 'operational') {
        return { status: 'aggregate-operational', reason: 'html-root-operational', sourceConflict: false };
    }
    return { status: 'inconclusive', reason: 'no-fresh-conclusive-source', sourceConflict: false };
}

/** @param {string} text */
function classifyStatusRootText(text) {
    const normalized = text.toLowerCase().replace(/\s+/gu, ' ');
    if (normalized.includes("we're fully operational") || normalized.includes('all systems operational'))
        return 'operational';
    if (
        normalized.includes('major outage') ||
        normalized.includes('partial outage') ||
        normalized.includes('degraded performance') ||
        normalized.includes('service disruption')
    )
        return 'degraded';
    return 'unknown';
}

/** @param {string | null} sourceUpdatedAt @param {number} observedAt */
function classifySourceFreshness(sourceUpdatedAt, observedAt) {
    if (!sourceUpdatedAt) return 'unknown';
    const parsed = Date.parse(sourceUpdatedAt);
    if (!Number.isFinite(parsed)) return 'invalid-date';
    const age = Math.max(0, observedAt - parsed);
    if (age <= STATUS_SOURCE_FRESH_MS) return 'fresh';
    if (age <= STATUS_SOURCE_AGING_MS) return 'aging';
    return 'stale';
}

/** @param {string} url @param {number} timeoutMs @param {number} maxBytes */
async function fetchBoundedText(url, timeoutMs, maxBytes) {
    const started = performance.now();
    try {
        const response = await fetch(url, {
            headers: {
                accept: 'text/html,application/json;q=0.9,*/*;q=0.1',
                'user-agent': 'workspace-mcp-latency-attribution/1.0',
            },
            signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await readBoundedResponseText(response, { maxBytes, label: `latency attribution ${url}` });
        return { ok: response.ok, status: response.status, text, durationMs: elapsedMs(started) };
    } catch (error) {
        return { ok: false, status: null, text: '', durationMs: elapsedMs(started), error: errorMessage(error) };
    }
}

/**
 * Reconstruct quiescent tool-burst gaps from persisted origin audit events. Gaps above MAX_INTERACTIVE_AUDIT_GAP_MS are
 * counted as idle pauses and excluded from the interactive latency distribution.
 *
 * @param {Record<string, unknown>[]} events
 * @param {number} observedAt
 * @param {{
 *     truncatedByBytes?: boolean;
 *     tailBytesRead?: number;
 *     fileBytes?: number;
 *     invalidLines?: number;
 *     auditReadOk?: boolean;
 *     auditReadError?: string | null;
 * }} [readMeta]
 * @returns {{
 *     authority: 'reconstructed-from-persisted-origin-audit-events';
 *     observedAt: string;
 *     eventCount: number;
 *     validTimelineEvents: number;
 *     ignoredTimelineEvents: number;
 *     interactiveGapCount: number;
 *     idleExcludedCount: number;
 *     maxInteractiveGapMs: number;
 *     windows: Record<string, ReturnType<typeof summarizeHistoricalGapRows>>;
 *     fastBaselineP25Ms: number | null;
 *     fastBaselineWindow: string | null;
 *     controlledPulse: ReturnType<typeof summarizeHistoricalGapRows>;
 *     controlledPulseSeries24h: {
 *         seriesId: string;
 *         networkLabel: string | null;
 *         modelLabel: string | null;
 *         conversationLabel: string | null;
 *         clientLabel: string | null;
 *         vpnLabel: string | null;
 *         count: number;
 *         averageMs: number;
 *         p25Ms: number | null;
 *         p50Ms: number | null;
 *         p95Ms: number | null;
 *         p99Ms: number | null;
 *         minMs: number | null;
 *         maxMs: number | null;
 *     }[];
 *     coverage: { firstEventAt: string | null; lastEventAt: string | null; spanMs: number | null };
 *     hourlyUtc: {
 *         hour: string;
 *         count: number;
 *         averageMs: number;
 *         p50Ms: number | null;
 *         p95Ms: number | null;
 *         maxMs: number | null;
 *     }[];
 *     edgeColo24h: {
 *         edgeColo: string;
 *         count: number;
 *         averageMs: number;
 *         p50Ms: number | null;
 *         p95Ms: number | null;
 *         maxMs: number | null;
 *     }[];
 *     topTransitions24h: {
 *         from: string;
 *         to: string;
 *         count: number;
 *         totalGapMs: number;
 *         averageMs: number;
 *         p50Ms: number | null;
 *         p95Ms: number | null;
 *         maxMs: number | null;
 *     }[];
 *     activeSessionAge24h: ReturnType<typeof summarizeActiveSessionAge>;
 *     read: {
 *         ok: boolean;
 *         truncatedByBytes: boolean;
 *         tailBytesRead: number;
 *         fileBytes: number;
 *         invalidLines: number;
 *         error: string | null;
 *     };
 *     note: string;
 * }}
 */
export function summarizeAuditInterToolHistory(events, observedAt, readMeta = {}) {
    const now = Number.isFinite(observedAt) ? Math.floor(observedAt) : Date.now();
    const terminalEvents = new Set([
        'tool_call_completed',
        'tool_call_failed',
        'tool_call_rate_limited',
        'tool_call_auth_denied',
        'tool_call_result_rejected',
    ]);
    /** @type {Map<string, { tool: string | null; edgeColo: string | null; seriesId: string | null }>} */
    const activeCalls = new Map();
    /** @type {{
    gapMs: number;
    observedAt: number;
    from: string | null;
    to: string | null;
    edgeColo: string | null;
    previousEdgeColo: string | null;
    sessionAgeMs: number;
    seriesId: string | null;
    previousSeriesId: string | null;
    networkLabel: string | null;
    modelLabel: string | null;
    conversationLabel: string | null;
    clientLabel: string | null;
    vpnLabel: string | null;
}[]} */
    const interactiveGaps = [];
    /** @type {{ gapMs: number; observedAt: number }[]} */
    const idleGaps = [];
    let lastBurstCompletedAt = null;
    let lastCompletedTool = null;
    let lastCompletedEdgeColo = null;
    let lastCompletedSeriesId = null;
    let activeClusterStartedAt = null;
    let activeClusterCount = 0;
    let validTimelineEvents = 0;
    let ignoredTimelineEvents = 0;
    let firstEventAt = null;
    let lastEventAt = null;

    const timeline = events
        .map((event, index) => {
            const eventName = typeof event['event'] === 'string' ? event['event'] : '';
            const callId = typeof event['callId'] === 'string' ? event['callId'] : '';
            const tool = typeof event['tool'] === 'string' ? event['tool'] : null;
            const rawEdgeColo = typeof event['edgeColo'] === 'string' ? event['edgeColo'].trim().toUpperCase() : '';
            const edgeColo = /^[A-Z0-9]{3,8}$/u.test(rawEdgeColo) ? rawEdgeColo : null;
            /** @param {string} key */
            const safeExperimentLabel = (key) => {
                const normalized = typeof event[key] === 'string' ? event[key].trim() : '';
                return /^[A-Za-z0-9._:-]{1,64}$/u.test(normalized) ? normalized : null;
            };
            const seriesId = safeExperimentLabel('latencySeriesId');
            const networkLabel = safeExperimentLabel('latencyNetworkLabel');
            const modelLabel = safeExperimentLabel('latencyModelLabel');
            const conversationLabel = safeExperimentLabel('latencyConversationLabel');
            const clientLabel = safeExperimentLabel('latencyClientLabel');
            const vpnLabel = safeExperimentLabel('latencyVpnLabel');
            const timestamp = typeof event['ts'] === 'string' ? Date.parse(event['ts']) : NaN;
            return {
                eventName,
                callId,
                tool,
                edgeColo,
                seriesId,
                networkLabel,
                modelLabel,
                conversationLabel,
                clientLabel,
                vpnLabel,
                timestamp,
                index,
            };
        })
        .filter((event) => {
            const relevant =
                Number.isFinite(event.timestamp) &&
                event.callId.length > 0 &&
                (event.eventName === 'tool_call_started' || terminalEvents.has(event.eventName));
            if (!relevant) ignoredTimelineEvents += 1;
            return relevant;
        })
        .sort((left, right) => left.timestamp - right.timestamp || left.index - right.index);

    for (const event of timeline) {
        validTimelineEvents += 1;
        firstEventAt = firstEventAt === null ? event.timestamp : Math.min(firstEventAt, event.timestamp);
        lastEventAt = lastEventAt === null ? event.timestamp : Math.max(lastEventAt, event.timestamp);
        if (event.eventName === 'tool_call_started') {
            if (activeCalls.size === 0) {
                const rawGapMs =
                    lastBurstCompletedAt === null ? null : Math.max(0, event.timestamp - lastBurstCompletedAt);
                if (activeClusterStartedAt === null || rawGapMs === null || rawGapMs > ACTIVE_WORK_CLUSTER_BREAK_MS) {
                    activeClusterStartedAt = event.timestamp;
                    activeClusterCount += 1;
                }
                if (rawGapMs !== null) {
                    if (rawGapMs <= MAX_INTERACTIVE_AUDIT_GAP_MS) {
                        interactiveGaps.push({
                            gapMs: rawGapMs,
                            observedAt: event.timestamp,
                            from: lastCompletedTool,
                            to: event.tool,
                            edgeColo: event.edgeColo,
                            previousEdgeColo: lastCompletedEdgeColo,
                            sessionAgeMs: Math.max(0, event.timestamp - activeClusterStartedAt),
                            seriesId: event.seriesId,
                            previousSeriesId: lastCompletedSeriesId,
                            networkLabel: event.networkLabel,
                            modelLabel: event.modelLabel,
                            conversationLabel: event.conversationLabel,
                            clientLabel: event.clientLabel,
                            vpnLabel: event.vpnLabel,
                        });
                    } else {
                        idleGaps.push({ gapMs: rawGapMs, observedAt: event.timestamp });
                    }
                }
            }
            activeCalls.set(event.callId, { tool: event.tool, edgeColo: event.edgeColo, seriesId: event.seriesId });
            continue;
        }
        if (!activeCalls.has(event.callId)) {
            // Tail may begin inside a burst; an unmatched terminal event must not establish false quiescence.
            continue;
        }
        const completedCall = activeCalls.get(event.callId) ?? null;
        activeCalls.delete(event.callId);
        if (activeCalls.size === 0) {
            lastBurstCompletedAt = event.timestamp;
            lastCompletedTool = completedCall?.tool ?? event.tool;
            lastCompletedEdgeColo = completedCall?.edgeColo ?? event.edgeColo;
            lastCompletedSeriesId = completedCall?.seriesId ?? event.seriesId;
        }
    }

    /** @type {Record<string, ReturnType<typeof summarizeHistoricalGapRows>>} */
    const windows = {};
    for (const minutes of AUDIT_HISTORY_WINDOWS_MINUTES) {
        const cutoff = now - minutes * 60 * 1000;
        const rows = interactiveGaps.filter((gap) => gap.observedAt >= cutoff && gap.observedAt <= now);
        const idleExcluded = idleGaps.filter((gap) => gap.observedAt >= cutoff && gap.observedAt <= now).length;
        windows[historicalWindowLabel(minutes)] = summarizeHistoricalGapRows(rows, idleExcluded);
    }

    const twentyFourHours = interactiveGaps
        .filter((gap) => gap.observedAt >= now - 24 * 60 * 60 * 1000 && gap.observedAt <= now)
        .map((gap) => gap.gapMs)
        .sort((left, right) => left - right);
    const allInteractiveValues = interactiveGaps.map((gap) => gap.gapMs).sort((left, right) => left - right);
    const baselineValues = twentyFourHours.length >= 5 ? twentyFourHours : allInteractiveValues;
    const fastBaselineWindow = twentyFourHours.length >= 5 ? '24h' : allInteractiveValues.length > 0 ? 'tail' : null;

    /** @type {Map<string, number[]>} */
    const hourlyBuckets = new Map();
    const hourlyCutoff = now - 24 * 60 * 60 * 1000;
    for (const gap of interactiveGaps) {
        if (gap.observedAt < hourlyCutoff || gap.observedAt > now) continue;
        const hour = new Date(gap.observedAt).toISOString().slice(0, 13) + ':00Z';
        const bucket = hourlyBuckets.get(hour) ?? [];
        bucket.push(gap.gapMs);
        hourlyBuckets.set(hour, bucket);
    }
    const hourlyUtc = [...hourlyBuckets.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([hour, values]) => {
            const sorted = [...values].sort((left, right) => left - right);
            return {
                hour,
                count: sorted.length,
                averageMs: average(sorted),
                p50Ms: historicalPercentile(sorted, 0.5),
                p95Ms: historicalPercentile(sorted, 0.95),
                maxMs: sorted.at(-1) ?? null,
            };
        });

    /** @type {Map<string, number[]>} */
    const edgeBuckets = new Map();
    for (const gap of interactiveGaps) {
        if (gap.observedAt < hourlyCutoff || gap.observedAt > now || !gap.edgeColo) continue;
        const bucket = edgeBuckets.get(gap.edgeColo) ?? [];
        bucket.push(gap.gapMs);
        edgeBuckets.set(gap.edgeColo, bucket);
    }
    const edgeColo24h = [...edgeBuckets.entries()]
        .map(([edgeColo, values]) => {
            const sorted = [...values].sort((left, right) => left - right);
            return {
                edgeColo,
                count: sorted.length,
                averageMs: average(sorted),
                p50Ms: historicalPercentile(sorted, 0.5),
                p95Ms: historicalPercentile(sorted, 0.95),
                maxMs: sorted.at(-1) ?? null,
            };
        })
        .sort((left, right) => right.count - left.count || left.edgeColo.localeCompare(right.edgeColo));

    const recent24hGaps = interactiveGaps.filter((gap) => gap.observedAt >= hourlyCutoff && gap.observedAt <= now);
    const activeSessionAge24h = summarizeActiveSessionAge(recent24hGaps, activeClusterCount);

    /** @type {Map<string, { from: string; to: string; values: number[] }>} */
    const transitionBuckets = new Map();
    for (const gap of recent24hGaps) {
        const from = gap.from ?? '(unknown)';
        const to = gap.to ?? '(unknown)';
        const key = `${from}\u0000${to}`;
        const bucket = transitionBuckets.get(key) ?? { from, to, values: [] };
        bucket.values.push(gap.gapMs);
        transitionBuckets.set(key, bucket);
    }
    const topTransitions24h = [...transitionBuckets.values()]
        .map((bucket) => {
            const sorted = [...bucket.values].sort((left, right) => left - right);
            const totalGapMs = sorted.reduce((sum, value) => sum + value, 0);
            return {
                from: bucket.from,
                to: bucket.to,
                count: sorted.length,
                totalGapMs,
                averageMs: average(sorted),
                p50Ms: historicalPercentile(sorted, 0.5),
                p95Ms: historicalPercentile(sorted, 0.95),
                maxMs: sorted.at(-1) ?? null,
            };
        })
        .sort((left, right) => right.totalGapMs - left.totalGapMs || right.count - left.count)
        .slice(0, 20);

    /** @type {Map<
    string,
    {
        seriesId: string;
        networkLabel: string | null;
        modelLabel: string | null;
        conversationLabel: string | null;
        clientLabel: string | null;
        vpnLabel: string | null;
        rows: typeof recent24hGaps;
    }
>} */
    const pulseSeriesBuckets = new Map();
    for (const gap of recent24hGaps) {
        if (
            gap.from !== 'mcp_latency_pulse' ||
            gap.to !== 'mcp_latency_pulse' ||
            !gap.seriesId ||
            gap.seriesId !== gap.previousSeriesId
        ) {
            continue;
        }
        const identity = {
            seriesId: gap.seriesId,
            networkLabel: gap.networkLabel,
            modelLabel: gap.modelLabel,
            conversationLabel: gap.conversationLabel,
            clientLabel: gap.clientLabel,
            vpnLabel: gap.vpnLabel,
        };
        const key = JSON.stringify(identity);
        const bucket = pulseSeriesBuckets.get(key) ?? { ...identity, rows: [] };
        bucket.rows.push(gap);
        pulseSeriesBuckets.set(key, bucket);
    }
    const controlledPulseSeries24h = [...pulseSeriesBuckets.values()]
        .map((bucket) => {
            const summary = summarizeHistoricalGapRows(bucket.rows, 0);
            return {
                seriesId: bucket.seriesId,
                networkLabel: bucket.networkLabel,
                modelLabel: bucket.modelLabel,
                conversationLabel: bucket.conversationLabel,
                clientLabel: bucket.clientLabel,
                vpnLabel: bucket.vpnLabel,
                count: summary.count,
                averageMs: summary.averageMs,
                p25Ms: summary.p25Ms,
                p50Ms: summary.p50Ms,
                p95Ms: summary.p95Ms,
                p99Ms: summary.p99Ms,
                minMs: summary.minMs,
                maxMs: summary.maxMs,
            };
        })
        .sort((left, right) => right.count - left.count || left.seriesId.localeCompare(right.seriesId));

    const maxInteractiveGapMs = interactiveGaps.reduce((maximum, gap) => Math.max(maximum, gap.gapMs), 0);
    const controlledPulseRows = interactiveGaps.filter(
        (gap) => gap.from === 'mcp_latency_pulse' && gap.to === 'mcp_latency_pulse',
    );
    return {
        authority: 'reconstructed-from-persisted-origin-audit-events',
        observedAt: new Date(now).toISOString(),
        eventCount: events.length,
        validTimelineEvents,
        ignoredTimelineEvents,
        interactiveGapCount: interactiveGaps.length,
        idleExcludedCount: idleGaps.length,
        maxInteractiveGapMs,
        windows,
        fastBaselineP25Ms: historicalPercentile(baselineValues, 0.25),
        fastBaselineWindow,
        controlledPulse: summarizeHistoricalGapRows(controlledPulseRows, 0),
        controlledPulseSeries24h,
        coverage: {
            firstEventAt: firstEventAt === null ? null : new Date(firstEventAt).toISOString(),
            lastEventAt: lastEventAt === null ? null : new Date(lastEventAt).toISOString(),
            spanMs: firstEventAt === null || lastEventAt === null ? null : Math.max(0, lastEventAt - firstEventAt),
        },
        hourlyUtc,
        edgeColo24h,
        topTransitions24h,
        activeSessionAge24h,
        read: {
            ok: readMeta.auditReadOk !== false,
            truncatedByBytes: readMeta.truncatedByBytes === true,
            tailBytesRead: Math.max(0, Number(readMeta.tailBytesRead ?? 0) || 0),
            fileBytes: Math.max(0, Number(readMeta.fileBytes ?? 0) || 0),
            invalidLines: Math.max(0, Number(readMeta.invalidLines ?? 0) || 0),
            error: typeof readMeta.auditReadError === 'string' ? readMeta.auditReadError : null,
        },
        note: 'Historical gaps are reconstructed from persisted tool-call audit events. Gaps above 60 seconds are classified as user/session idle and excluded from the interactive distribution; tail truncation can reduce historical coverage.',
    };
}

/**
 * Session-age heuristic for continuous work clusters. A new cluster starts after more than 30 minutes without a
 * tool-call burst; this is not a ChatGPT conversation ID.
 *
 * @param {{ gapMs: number; sessionAgeMs: number }[]} rows
 * @param {number} observedClusterCount
 */
function summarizeActiveSessionAge(rows, observedClusterCount) {
    const buckets = [
        { label: '0-30m', minMs: 0, maxMs: 30 * 60 * 1000 },
        { label: '30-60m', minMs: 30 * 60 * 1000, maxMs: 60 * 60 * 1000 },
        { label: '1-2h', minMs: 60 * 60 * 1000, maxMs: 2 * 60 * 60 * 1000 },
        { label: '2-4h', minMs: 2 * 60 * 60 * 1000, maxMs: 4 * 60 * 60 * 1000 },
        { label: '4h+', minMs: 4 * 60 * 60 * 1000, maxMs: Number.POSITIVE_INFINITY },
    ].map((bucket) => {
        const values = rows
            .filter((row) => row.sessionAgeMs >= bucket.minMs && row.sessionAgeMs < bucket.maxMs)
            .map((row) => row.gapMs)
            .sort((left, right) => left - right);
        return {
            label: bucket.label,
            count: values.length,
            averageMs: average(values),
            p25Ms: historicalPercentile(values, 0.25),
            p50Ms: historicalPercentile(values, 0.5),
            p95Ms: historicalPercentile(values, 0.95),
            maxMs: values.at(-1) ?? null,
        };
    });
    const early = buckets.find((bucket) => bucket.label === '0-30m') ?? null;
    const lateRows = rows.filter((row) => row.sessionAgeMs >= 2 * 60 * 60 * 1000);
    const lateValues = lateRows.map((row) => row.gapMs).sort((left, right) => left - right);
    const lateP50Ms = historicalPercentile(lateValues, 0.5);
    const earlyP50Ms = early?.p50Ms ?? null;
    const lateToEarlyP50Ratio =
        earlyP50Ms !== null && earlyP50Ms > 0 && lateP50Ms !== null
            ? Math.round((lateP50Ms / earlyP50Ms) * 100) / 100
            : null;
    const sufficientForTrend = (early?.count ?? 0) >= 20 && lateValues.length >= 20;
    let trend = 'insufficient-data';
    if (sufficientForTrend && lateToEarlyP50Ratio !== null) {
        trend =
            lateToEarlyP50Ratio >= 1.5 ? 'slower-late' : lateToEarlyP50Ratio <= 0.8 ? 'faster-late' : 'roughly-stable';
    }
    return {
        authority: 'heuristic-from-origin-audit-not-chatgpt-session-id',
        clusterBreakAfterMs: ACTIVE_WORK_CLUSTER_BREAK_MS,
        observedClusterCount,
        sampleCount: rows.length,
        buckets,
        earlyP50Ms,
        lateP50Ms,
        lateToEarlyP50Ratio,
        sufficientForTrend,
        trend,
        note: 'Work clusters are inferred from tool activity and split after >30 minutes without a tool-call burst. The result can support or weaken a long-session degradation hypothesis but cannot identify a real ChatGPT conversation/session internally.',
    };
}

/**
 * @param {{
 *     gapMs: number;
 *     observedAt: number;
 *     from: string | null;
 *     to: string | null;
 *     edgeColo?: string | null;
 *     previousEdgeColo?: string | null;
 *     sessionAgeMs?: number;
 * }[]} rows
 * @param {number} idleExcluded
 */
function summarizeHistoricalGapRows(rows, idleExcluded) {
    const values = rows.map((row) => row.gapMs).sort((left, right) => left - right);
    return {
        count: values.length,
        idleExcluded,
        averageMs: average(values),
        p25Ms: historicalPercentile(values, 0.25),
        p50Ms: historicalPercentile(values, 0.5),
        p95Ms: historicalPercentile(values, 0.95),
        p99Ms: historicalPercentile(values, 0.99),
        minMs: values[0] ?? null,
        maxMs: values.at(-1) ?? null,
    };
}

/** @param {number} minutes */
function historicalWindowLabel(minutes) {
    if (minutes < 60) return `${minutes}m`;
    if (minutes % 1_440 === 0) return `${minutes / 1_440}d`;
    return `${minutes / 60}h`;
}

/** @param {number[]} values */
function average(values) {
    return values.length > 0 ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

/** @param {number[]} sortedValues @param {number} quantile */
function historicalPercentile(sortedValues, quantile) {
    if (sortedValues.length === 0) return null;
    const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * quantile) - 1));
    return sortedValues[index] ?? null;
}

/** @param {ReturnType<typeof summarizeAuditInterToolHistory>} history */
function compactHistoricalGap(history) {
    return {
        authority: history.authority,
        auditReadOk: history.read.ok,
        truncatedByBytes: history.read.truncatedByBytes,
        eventCount: history.eventCount,
        validTimelineEvents: history.validTimelineEvents,
        interactiveGapCount: history.interactiveGapCount,
        idleExcludedCount: history.idleExcludedCount,
        fastBaselineP25Ms: history.fastBaselineP25Ms,
        fastBaselineWindow: history.fastBaselineWindow,
        controlledPulse: history.controlledPulse,
        controlledPulseSeries24h: history.controlledPulseSeries24h,
        coverage: history.coverage,
        windows: history.windows,
        edgeColo24h: history.edgeColo24h,
        topTransitions24h: history.topTransitions24h,
        activeSessionAge24h: history.activeSessionAge24h,
        note: history.note,
    };
}

/** @param {Awaited<ReturnType<typeof collectOfficialOpenAiAggregateStatus>>} status */
function compactExternalStatus(status) {
    return {
        status: status.status,
        authority: status.authority,
        observedAt: status.observedAt,
        rootSignal: status.root.signal,
        rootReachable: status.root.reachable,
        statusApiIndicator: status.statusApi.indicator,
        statusApiSourceUpdatedAt: status.statusApi.sourceUpdatedAt,
        statusApiFreshness: status.statusApi.freshness,
        statusReason: status.statusReason,
        sourceConflict: status.sourceConflict,
        chatgptAffected: status.chatgptAffected,
        summaryApiFreshness: status.summaryApi.freshness,
        unresolvedIncidentNames: status.summaryApi.unresolvedIncidents.map((incident) => incident.name),
        degradedComponents: status.summaryApi.degradedComponents,
        caveat: status.caveat,
    };
}

/** @param {Record<string, unknown> & { ok: boolean; available: boolean }} analytics */
function compactCloudflareHttpAnalytics(analytics) {
    const summary = asRecord(analytics['summary']);
    return {
        ok: analytics.ok,
        available: analytics.available,
        reason: analytics['reason'] ?? null,
        authority: analytics['authority'] ?? 'cloudflare-graphql-adaptive-aggregate',
        observedAt: analytics['observedAt'] ?? null,
        window: analytics['window'] ?? null,
        requestCount: analytics['requestCount'] ?? null,
        edgeTimeToFirstByteMs: summary?.['edgeTimeToFirstByteMs'] ?? null,
        originResponseDurationMs: summary?.['originResponseDurationMs'] ?? null,
        clientTCPRttMs: summary?.['clientTCPRttMs'] ?? null,
        colos: summary?.['colos'] ?? [],
        graphqlErrors: analytics['graphqlErrors'] ?? [],
        note: analytics['sampling'] ?? analytics['note'] ?? null,
    };
}

/** @param {Record<string, unknown> & { ok: boolean }} snapshot */
function compactCloudflareRaw(snapshot) {
    return {
        ok: snapshot.ok,
        status: snapshot['status'] ?? null,
        metricsAddr: snapshot['metricsAddr'] ?? null,
        latency: snapshot['latency'] ?? null,
        operational: snapshot['operational'] ?? null,
        quic: snapshot['quic'] ?? null,
        error: snapshot['error'] ?? null,
    };
}

/** @param {unknown} value */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/** @param {unknown} value */
function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function boundedInteger(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

/** @param {number} started */
function elapsedMs(started) {
    return Math.max(0, Math.round(performance.now() - started));
}

/** @param {unknown} error */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/** @param {string[]} values */
function dedupe(values) {
    return [...new Set(values)];
}

/** @param {number} value */
function roundRatio(value) {
    return Math.round(value * 1_000_000) / 1_000_000;
}
